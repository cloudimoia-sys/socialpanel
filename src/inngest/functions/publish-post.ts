import { NonRetriableError } from "inngest";
import { validateTargets } from "@/domain/platform-rules";
import { recordUsage } from "@/domain/usage";
import { AppError, log } from "@/lib/logger";
import { adminClient } from "@/lib/supabase";
import { credentialFor, publishProvider } from "@/providers/registry";
import { inngest, publishRequested } from "../client";

/**
 * Publica un post en cada red por separado.
 *
 * Cada plataforma es su propio `step.run`: si Instagram falla, LinkedIn y X ya
 * han salido y no se vuelven a publicar al reintentar. Publicar dos veces por
 * un reintento es peor que no publicar.
 */
export const publishPost = inngest.createFunction(
  {
    id: "publish-post",
    triggers: [publishRequested],
    retries: 3,
    concurrency: [{ key: "event.data.tenantId", limit: 3 }],
    onFailure: async ({ event }) => {
      const { tenantId, postId } = event.data.event.data;
      await adminClient()
        .from("posts")
        .update({ status: "failed", error: "La publicación falló." })
        .eq("id", postId)
        .eq("tenant_id", tenantId);
    },
  },
  async ({ event, step }) => {
    const { tenantId, postId, platforms } = event.data;
    const db = adminClient();

    const post = await step.run("cargar-post", async () => {
      const { data } = await db
        .from("posts")
        .select("id, caption, hashtags, status, asset_id, scheduled_at")
        .eq("id", postId)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .maybeSingle();

      if (!data) throw new NonRetriableError("Post no encontrado");
      if (data.status === "published") throw new NonRetriableError("El post ya está publicado");
      return data;
    });

    // El asset se lee aparte en vez de con un join embebido: filtrar por
    // tenant_id explícitamente aquí es más difícil de romper por accidente.
    const asset = post.asset_id
      ? await step.run("cargar-asset", async () => {
          const { data } = await db
            .from("assets")
            .select("kind, storage_path, bytes, duration_ms")
            .eq("id", post.asset_id!)
            .eq("tenant_id", tenantId)
            .maybeSingle();
          return data;
        })
      : null;

    // Validar contra las reglas de cada red antes de llamar a nadie.
    const { valid, violations } = validateTargets({
      platforms,
      caption: post.caption ?? "",
      hashtags: post.hashtags ?? [],
      media: asset
        ? {
            kind: asset.kind,
            bytes: asset.bytes,
            durationSeconds: asset.duration_ms ? asset.duration_ms / 1000 : undefined,
          }
        : undefined,
    });

    await step.run("registrar-descartes", async () => {
      for (const v of violations) {
        await db.from("post_targets").upsert(
          {
            post_id: postId,
            tenant_id: tenantId,
            platform: v.platform,
            status: "skipped",
            error: v.reason,
          },
          { onConflict: "post_id,platform" },
        );
      }
    });

    if (valid.length === 0) {
      await step.run("sin-destinos", async () => {
        await db
          .from("posts")
          .update({ status: "failed", error: "Ninguna red admite este contenido." })
          .eq("id", postId)
          .eq("tenant_id", tenantId);
      });
      throw new NonRetriableError("Ninguna plataforma válida");
    }

    await step.run("marcar-publicando", async () => {
      await db.from("posts").update({ status: "publishing" }).eq("id", postId).eq("tenant_id", tenantId);
    });

    // URL firmada de vida corta; el bucket sigue siendo privado.
    const mediaUrl = asset
      ? await step.run("firmar-media", async () => {
          const { data } = await db.storage.from("media").createSignedUrl(asset.storage_path, 3600);
          return data?.signedUrl ?? null;
        })
      : null;

    const caption = [post.caption, ((post.hashtags as string[]) ?? []).map((h) => `#${h}`).join(" ")]
      .filter(Boolean)
      .join("\n\n");

    // Idempotencia: qué redes tienen ya publicación registrada.
    //
    // Sin esto, un reintento republica. Y los reintentos son frecuentes porque
    // la API puede devolver "fallo" cuando la red SÍ publicó — nos pasó con
    // Instagram: dos respuestas de error y dos posts reales.
    const alreadyPublished = await step.run("ya-publicadas", async () => {
      const { data } = await db
        .from("post_targets")
        .select("platform, status")
        .eq("post_id", postId)
        .eq("tenant_id", tenantId);

      return (data ?? [])
        .filter((t) => t.status === "published" || t.status === "unknown")
        .map((t) => t.platform);
    });

    let succeeded = 0;

    for (const platform of valid) {
      if (alreadyPublished.includes(platform)) {
        log.warn("se omite: ya hay publicacion registrada", { postId, platform });
        continue;
      }

      const ok = await step.run(`publicar-${platform}`, async () => {
        try {
          const cred = await credentialFor(tenantId, "upload_post");
          const result = await publishProvider().publish(
            {
              platform,
              accountRef: `${tenantId}:${platform}`,
              caption,
              mediaUrl: mediaUrl ?? undefined,
              mediaKind: asset?.kind,
              scheduledAt: post.scheduled_at ? new Date(post.scheduled_at as string) : undefined,
            },
            tenantId,
            cred,
          );

          await db.from("post_targets").upsert(
            {
              post_id: postId,
              tenant_id: tenantId,
              platform,
              status: "published",
              remote_id: result.remoteId,
              remote_url: result.remoteUrl ?? null,
              published_at: new Date().toISOString(),
            },
            { onConflict: "post_id,platform" },
          );

          await recordUsage(tenantId, "publish", result.cost, postId);
          return true;
        } catch (error) {
          // Un fallo en una red no debe abortar el resto: se anota y se sigue.
          // El motivo concreto se guarda en `post_targets.error` para que se
          // vea en la interfaz; antes se perdía y solo quedaba "no se pudo".
          const reason =
            error instanceof AppError
              ? error.publicMessage
              : "No se pudo publicar en esta red.";

          log.error("fallo al publicar", { tenantId, postId, platform, reason });

          // Estado `unknown`, no `failed`: la petición SÍ salió, así que la red
          // puede haber publicado igualmente. Marcarlo como fallo invitaría a
          // reintentar, y reintentar sobre algo ya publicado duplica el post.
          // Ante una acción irreversible, la duda no es un "no".
          await db.from("post_targets").upsert(
            {
              post_id: postId,
              tenant_id: tenantId,
              platform,
              status: "unknown",
              error: `${reason} Comprueba en ${platform} antes de reintentar: puede haberse publicado igualmente.`,
            },
            { onConflict: "post_id,platform" },
          );
          return false;
        }
      });
      if (ok) succeeded++;
    }

    await step.run("cerrar-post", async () => {
      await db
        .from("posts")
        .update({
          status: succeeded > 0 ? "published" : "failed",
          error: succeeded > 0 ? null : "No se pudo publicar en ninguna red.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId)
        .eq("tenant_id", tenantId);

      await db.from("audit_log").insert({
        tenant_id: tenantId,
        action: "post.published",
        target: postId,
        metadata: { platforms: valid, succeeded, skipped: violations.length },
      });
    });

    return { postId, published: succeeded, skipped: violations.length };
  },
);
