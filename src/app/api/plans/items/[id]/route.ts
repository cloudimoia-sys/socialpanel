import { z } from "zod";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant, requireTenantRole } from "@/lib/tenant";
import { loadBrand } from "@/domain/brand";
import { assertQuota } from "@/domain/quota";
import { isSchedulable, zonedDateToUtc } from "@/domain/schedule";
import { inngest } from "@/inngest/client";

const bodySchema = z.object({
  action: z.enum(["approve", "dismiss"]),
  // Fecha y hora concretas para este post. Si no viene, se usa la fecha
  // propuesta con la hora por defecto de la marca.
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
});

/**
 * Aprobar una idea la convierte en post y lanza su generación.
 *
 * Es el paso que une el plan con el contenido real: el operador revisa la
 * tanda, descarta lo que no encaja y aprueba lo demás sin volver a escribir
 * nada.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await ctx.params;
    const itemId = z.string().uuid().parse(id);
    const { action, scheduledAt } = bodySchema.parse(await request.json());

    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    const db = adminClient();

    const { data: item } = await db
      .from("content_plan_items")
      .select(
        "id, idea, headline, visual_prompt, suggested_platforms, suggested_media, scheduled_for, status, post_id",
      )
      .eq("id", itemId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle();

    if (!item) throw new AppError("Idea no encontrada.", 404);

    if (action === "dismiss") {
      await db.from("content_plan_items").update({ status: "dismissed" }).eq("id", itemId);
      return { status: "dismissed" };
    }

    if (item.status === "created" && item.post_id) {
      // Ya se materializó: devolvemos el post existente en vez de duplicarlo.
      return { status: "created", postId: item.post_id };
    }

    await enforceRateLimit("generate", `${tenant.tenantId}:${tenant.userId}`);
    await assertQuota(tenant.tenantId, "post");
    if (item.suggested_media === "image" && item.visual_prompt) {
      await assertQuota(tenant.tenantId, "image");
    }

    const platforms =
      item.suggested_platforms.length > 0 ? item.suggested_platforms : ["instagram"];

    // La idea trae la fecha propuesta; la marca dice a qué hora y en qué huso.
    // Si esa fecha ya pasó (plan generado para un periodo empezado), no se
    // programa: el post queda listo para revisar y publicar a mano.
    const brand = await loadBrand(tenant.tenantId);
    const when = scheduledAt
      ? new Date(scheduledAt)
      : item.scheduled_for
        ? zonedDateToUtc(
            item.scheduled_for,
            brand?.publish_hour ?? 10,
            brand?.timezone ?? "Europe/Madrid",
          )
        : null;
    const willSchedule = isSchedulable(when);

    const { data: post, error } = await db
      .from("posts")
      .insert({
        tenant_id: tenant.tenantId,
        created_by: tenant.userId,
        status: "generating",
        brief: item.idea,
        // La intención de programar se guarda ya. `generate-content` la aplica
        // al terminar: hasta entonces no hay nada que publicar.
        scheduled_at: willSchedule ? when.toISOString() : null,
        scheduled_platforms: willSchedule ? platforms : [],
      })
      .select("id")
      .single();

    if (error || !post) throw new AppError("No se pudo crear el post.", 500, error?.message);

    // El prompt de imagen es `visual_prompt` (una escena fotografiable), NUNCA
    // `idea`. Pasarle la idea de contenido al modelo de imagen produce pósters
    // infográficos con texto y logos inventados: es literalmente lo que se le
    // ha pedido. Si no hay visual, no se genera imagen.
    const media =
      item.suggested_media === "image" && item.visual_prompt
        ? {
            mode: "generate-image" as const,
            prompt: item.visual_prompt,
            aspectRatio: "1:1" as const,
            // El titular corto va superpuesto con tipografía real. Si el modelo
            // no lo generó, la imagen sale limpia en vez de con la idea entera
            // encima, que sería ilegible.
            ...(item.headline
              ? { overlay: { text: item.headline, template: "band" as const } }
              : {}),
          }
        : { mode: "none" as const };

    try {
      await inngest.send({
        name: "post/generate.requested",
        data: {
          tenantId: tenant.tenantId,
          postId: post.id,
          brief: item.idea,
          platforms,
          language: "es",
          media,
        },
      });
    } catch (cause) {
      await db
        .from("posts")
        .update({ status: "failed", error: "No se pudo encolar la generación." })
        .eq("id", post.id)
        .eq("tenant_id", tenant.tenantId);
      throw new AppError(
        "El servicio de generación no está disponible. Comprueba que la cola esté arrancada.",
        503,
        cause,
      );
    }

    await db
      .from("content_plan_items")
      .update({ status: "created", post_id: post.id })
      .eq("id", itemId)
      .eq("tenant_id", tenant.tenantId);

    return {
      status: "created",
      postId: post.id,
      scheduledAt: willSchedule ? when.toISOString() : null,
    };
  });
}
