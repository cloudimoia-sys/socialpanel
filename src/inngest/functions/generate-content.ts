import { NonRetriableError } from "inngest";
import { brandContext, loadBrand, loadBrandLogo } from "@/domain/brand";
import { composeOverlay } from "@/domain/compose";
import { assertBudget, recordUsage } from "@/domain/usage";
import { adminClient } from "@/lib/supabase";
import { AppError, log } from "@/lib/logger";
import {
  credentialFor,
  imageProvider,
  llmFor,
  videoProvider,
  type ProviderKind,
} from "@/providers/registry";
import { estimateVideoCents } from "@/providers/video/fal";
import { darken } from "@/video/color";
import { renderStats } from "@/video/render";
import { generateRequested, inngest } from "../client";

/**
 * Genera el contenido de un post: copy siempre, y media según lo pedido.
 *
 * Cada paso es un `step.run` para que un fallo en el vídeo no obligue a pagar
 * otra vez por el texto al reintentar.
 */
export const generateContent = inngest.createFunction(
  {
    id: "generate-content",
    triggers: [generateRequested],
    retries: 2,
    concurrency: [{ key: "event.data.tenantId", limit: 2 }],
    onFailure: async ({ event }) => {
      const { tenantId, postId } = event.data.event.data;
      await adminClient()
        .from("posts")
        .update({ status: "failed", error: "No se pudo generar el contenido." })
        .eq("id", postId)
        .eq("tenant_id", tenantId);
    },
  },
  async ({ event, step }) => {
    const { tenantId, postId, brief, platforms, language, tone, media, news } = event.data;
    const db = adminClient();

    // Filtrar por tenant_id además de por id: el service role salta el RLS,
    // así que el aislamiento aquí es responsabilidad nuestra.
    await step.run("marcar-generando", async () => {
      await db
        .from("posts")
        .update({ status: "generating", error: null, updated_at: new Date().toISOString() })
        .eq("id", postId)
        .eq("tenant_id", tenantId);
    });

    // ---- 1. Copy -------------------------------------------------------------
    const copy = await step.run("generar-copy", async () => {
      const provider = llmFor();
      const cred = await credentialFor(tenantId, provider.name as ProviderKind);
      await assertBudget(tenantId, 5, cred.byok);

      // La memoria de marca es lo que hace que el copy suene al negocio y no a
      // IA genérica. Si no hay perfil todavía, se genera igual, solo que peor.
      const brand = brandContext(await loadBrand(tenantId));

      const result = await provider.generateCaption(
        { brief, platforms, language, tone, brand: brand || undefined, news },
        cred,
      );
      await recordUsage(tenantId, "llm", result.cost, postId);
      return { caption: result.caption, hashtags: result.hashtags };
    });

    // ---- 2. Media ------------------------------------------------------------
    let assetId: string | null = null;

    if (media?.mode === "existing") {
      assetId = await step.run("preparar-asset", async () => {
        const { data } = await db
          .from("assets")
          .select("id, kind, storage_path, mime_type")
          .eq("id", media.assetId)
          .eq("tenant_id", tenantId)
          .maybeSingle();

        // Si el asset no es de este tenant, no existe para nosotros.
        if (!data) throw new NonRetriableError("Asset no encontrado");

        // Sin texto que superponer, o siendo vídeo, se usa tal cual.
        if (!media.overlay || data.kind !== "image") return data.id;

        const { data: file, error: downloadError } = await db.storage
          .from("media")
          .download(data.storage_path);
        if (downloadError || !file) throw new Error("no se pudo leer el archivo original");

        const brand = await loadBrand(tenantId);
        const composed = await composeOverlay({
          image: Buffer.from(await file.arrayBuffer()),
          text: media.overlay.text,
          subtext: media.overlay.subtext,
          template: media.overlay.template,
          accent: brand?.accent_color ?? "#1B5FA9",
          textColor: brand?.text_color ?? "#FFFFFF",
          fontFamily: brand?.font_family ?? "Poppins-Bold",
          logo: (await loadBrandLogo(tenantId, brand?.logo_asset_id ?? null)) ?? undefined,
        });

        // Se guarda como asset nuevo: el original del cliente no se toca, por
        // si quiere reutilizarlo con otro texto.
        const path = `${tenantId}/${postId}/${crypto.randomUUID()}.png`;
        const { error } = await db.storage
          .from("media")
          .upload(path, composed, { contentType: "image/png", upsert: false });
        if (error) throw new Error(`storage: ${error.message}`);

        const { data: created, error: insertError } = await db
          .from("assets")
          .insert({
            tenant_id: tenantId,
            kind: "image",
            origin: "generated",
            storage_path: path,
            mime_type: "image/png",
            bytes: composed.byteLength,
          })
          .select("id")
          .single();
        if (insertError) throw new Error(insertError.message);

        return created.id;
      });
    }

    if (media?.mode === "generate-image") {
      assetId = await step.run("generar-imagen", async () => {
        // El proveedor lo decide el registry según el perfil; la credencial
        // tiene que ser la SUYA, no una fija.
        const provider = imageProvider();
        const cred = await credentialFor(tenantId, provider.name as ProviderKind);
        await assertBudget(tenantId, 5, cred.byok);

        const image = await provider.generateImage(
          { prompt: media.prompt, aspectRatio: media.aspectRatio },
          cred,
        );
        await recordUsage(tenantId, "image", image.cost, postId);

        // El texto se compone después, con tipografía real y los colores de la
        // marca. Si la composición falla NO perdemos la imagen: se guarda sin
        // texto. Es peor pieza, pero ya está pagada y sigue siendo usable.
        let bytes = image.data;
        let mime = image.mimeType;

        if (media.overlay) {
          try {
            const brand = await loadBrand(tenantId);
            bytes = await composeOverlay({
              image: image.data,
              text: media.overlay.text,
              subtext: media.overlay.subtext,
              template: media.overlay.template,
              accent: brand?.accent_color ?? "#1B5FA9",
              textColor: brand?.text_color ?? "#FFFFFF",
              fontFamily: brand?.font_family ?? "Poppins-Bold",
              logo: (await loadBrandLogo(tenantId, brand?.logo_asset_id ?? null)) ?? undefined,
            });
            mime = "image/png";
          } catch (cause) {
            log.error("no se pudo componer el texto", { postId, error: String(cause) });
          }
        }

        const extension = mime === "image/jpeg" ? "jpg" : "png";
        const path = `${tenantId}/${postId}/${crypto.randomUUID()}.${extension}`;
        const { error } = await db.storage
          .from("media")
          .upload(path, bytes, { contentType: mime, upsert: false });
        if (error) throw new Error(`storage: ${error.message}`);

        const { data, error: insertError } = await db
          .from("assets")
          .insert({
            tenant_id: tenantId,
            kind: "image",
            origin: "generated",
            storage_path: path,
            mime_type: mime,
            bytes: bytes.byteLength,
          })
          .select("id")
          .single();
        if (insertError) throw new Error(insertError.message);

        return data.id as string;
      });
    }

    if (media?.mode === "generate-video") {
      // El vídeo es el 80% del coste variable: se comprueba presupuesto con el
      // importe estimado ANTES de arrancar nada.
      const job = await step.run("arrancar-video", async () => {
        const cred = await credentialFor(tenantId, "fal");
        await assertBudget(tenantId, estimateVideoCents(media.durationSeconds), cred.byok);

        let imageUrl: string | undefined;
        if (media.sourceAssetId) {
          const { data } = await db
            .from("assets")
            .select("storage_path")
            .eq("id", media.sourceAssetId)
            .eq("tenant_id", tenantId)
            .maybeSingle();
          if (!data) throw new NonRetriableError("Asset de origen no encontrado");
          // URL firmada y de vida corta: el bucket es privado.
          const { data: signed } = await db.storage
            .from("media")
            .createSignedUrl(data.storage_path as string, 3600);
          imageUrl = signed?.signedUrl;
        }

        return videoProvider().startVideo(
          {
            prompt: media.prompt,
            durationSeconds: media.durationSeconds,
            aspectRatio: media.aspectRatio,
            imageUrl,
          },
          cred,
        );
      });

      // Sondeo con espera real entre intentos, no un bucle apretado.
      let status = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        await step.sleep(`espera-${attempt}`, "20s");
        status = await step.run(`comprobar-video-${attempt}`, async () => {
          const cred = await credentialFor(tenantId, "fal");
          return videoProvider().checkVideo(job, cred);
        });
        if (status.state !== "pending") break;
      }

      if (!status || status.state !== "done" || !status.url) {
        throw new NonRetriableError(status?.error ?? "El vídeo tardó demasiado.");
      }

      const doneStatus = status;
      assetId = await step.run("guardar-video", async () => {
        if (doneStatus.cost) await recordUsage(tenantId, "video", doneStatus.cost, postId);

        const response = await fetch(doneStatus.url!);
        const buffer = Buffer.from(await response.arrayBuffer());
        const path = `${tenantId}/${postId}/${crypto.randomUUID()}.mp4`;

        const { error } = await db.storage
          .from("media")
          .upload(path, buffer, { contentType: "video/mp4", upsert: false });
        if (error) throw new Error(`storage: ${error.message}`);

        const { data, error: insertError } = await db
          .from("assets")
          .insert({
            tenant_id: tenantId,
            kind: "video",
            origin: "generated",
            storage_path: path,
            mime_type: "video/mp4",
            bytes: buffer.byteLength,
            duration_ms: media.durationSeconds * 1000,
          })
          .select("id")
          .single();
        if (insertError) throw new Error(insertError.message);

        return data.id as string;
      });
    }

    if (media?.mode === "generate-infographic") {
      assetId = await step.run("renderizar-infograma", async () => {
        // Sin coste de proveedor: es cómputo local, no una llamada a una API de
        // pago. Aun así cuenta contra la cuota de IMÁGENES del plan (no la de
        // vídeo, que representa segundos facturados de verdad) — es la forma de
        // acotar el cómputo gratuito sin tratarlo como vídeo caro de fal.
        const brand = await loadBrand(tenantId);
        const accent = brand?.accent_color ?? "#3E9BE0";

        const rendered = await renderStats({
          title: media.title,
          stat1Value: media.stat1Value,
          stat1Label: media.stat1Label,
          stat2Value: media.stat2Value,
          stat2Label: media.stat2Label,
          footer: media.footer,
          bg: "#0b0e12",
          accent,
          accentDeep: darken(accent),
          textColor: brand?.text_color ?? "#e8edf2",
          mutedColor: "#93a3b4",
          fontFamily: "Poppins",
        });

        await recordUsage(
          tenantId,
          "image",
          { provider: "remotion", units: 1, cents: 0, byok: false },
          postId,
        );

        const path = `${tenantId}/${postId}/${crypto.randomUUID()}.mp4`;
        const { error } = await db.storage
          .from("media")
          .upload(path, rendered.data, { contentType: "video/mp4", upsert: false });
        if (error) throw new Error(`storage: ${error.message}`);

        const { data, error: insertError } = await db
          .from("assets")
          .insert({
            tenant_id: tenantId,
            kind: "video",
            origin: "generated",
            storage_path: path,
            mime_type: "video/mp4",
            bytes: rendered.data.byteLength,
            duration_ms: rendered.durationSeconds * 1000,
          })
          .select("id")
          .single();
        if (insertError) throw new Error(insertError.message);

        return data.id as string;
      });
    }

    // ---- 3. Listo, o programado si venía con fecha --------------------------
    const finalStatus = await step.run("marcar-listo", async () => {
      // Si el post se creó desde el plan con fecha propuesta, pasa directo a
      // programado. La intención se guardó al aprobar; se aplica aquí porque
      // hasta ahora no había contenido que publicar.
      const { data: current } = await db
        .from("posts")
        .select("scheduled_at, scheduled_platforms")
        .eq("id", postId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      const due = current?.scheduled_at ? new Date(current.scheduled_at) : null;
      const scheduled =
        due !== null && due.getTime() > Date.now() && (current?.scheduled_platforms.length ?? 0) > 0;

      await db
        .from("posts")
        .update({
          status: scheduled ? "scheduled" : "ready",
          caption: copy.caption,
          hashtags: copy.hashtags,
          asset_id: assetId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId)
        .eq("tenant_id", tenantId);

      return scheduled ? "scheduled" : "ready";
    });

    log.info("contenido generado", {
      tenantId,
      postId,
      hasMedia: Boolean(assetId),
      status: finalStatus,
    });
    return { postId, assetId, status: finalStatus };
  },
);

export function isExpectedError(error: unknown): error is AppError {
  return error instanceof AppError;
}
