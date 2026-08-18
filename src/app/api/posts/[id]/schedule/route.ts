import { z } from "zod";
import { LIMITS_BY_PLATFORM } from "@/domain/platform-rules";
import { AppError } from "@/lib/logger";
import { run } from "@/lib/route";
import { adminClient, userClient } from "@/lib/supabase";
import { requireCurrentTenant, requireTenantRole } from "@/lib/tenant";

const bodySchema = z.object({
  // ISO con zona horaria. El navegador convierte su hora local antes de
  // enviarla: un "15:00" sin zona significaría cosas distintas según el
  // servidor, y el post saldría a deshora.
  scheduledAt: z.string().datetime({ offset: true }),
  platforms: z
    .array(z.enum(Object.keys(LIMITS_BY_PLATFORM) as [string, ...string[]]))
    .min(1)
    .max(9),
});

/** Programa la publicación de un post ya generado. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await ctx.params;
    const postId = z.string().uuid().parse(id);
    const body = bodySchema.parse(await request.json());

    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    const when = new Date(body.scheduledAt);
    // Un minuto de margen: programar "para ahora" es publicar, y para eso está
    // el botón de publicar.
    if (when.getTime() < Date.now() + 60_000) {
      throw new AppError("Elige una fecha al menos un minuto en el futuro.", 400);
    }

    const supabase = await userClient();
    const { data: post } = await supabase
      .from("posts")
      .select("id, status, caption")
      .eq("id", postId)
      .eq("tenant_id", tenant.tenantId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!post) throw new AppError("Post no encontrado.", 404);
    if (post.status === "published") throw new AppError("Este post ya está publicado.", 409);
    if (post.status === "publishing") throw new AppError("Ya se está publicando.", 409);
    if (!post.caption) {
      throw new AppError("El post todavía no tiene contenido que publicar.", 409);
    }

    await adminClient()
      .from("posts")
      .update({
        status: "scheduled",
        scheduled_at: when.toISOString(),
        scheduled_platforms: body.platforms,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId)
      .eq("tenant_id", tenant.tenantId);

    return { id: postId, status: "scheduled", scheduledAt: when.toISOString() };
  });
}

/** Cancela la programación y devuelve el post a revisión. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await ctx.params;
    const postId = z.string().uuid().parse(id);

    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    const db = adminClient();
    const { data: post } = await db
      .from("posts")
      .select("status")
      .eq("id", postId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle();

    if (!post) throw new AppError("Post no encontrado.", 404);
    if (post.status !== "scheduled") {
      throw new AppError("Este post no está programado.", 409);
    }

    await db
      .from("posts")
      .update({ status: "ready", scheduled_at: null, scheduled_platforms: [] })
      .eq("id", postId)
      .eq("tenant_id", tenant.tenantId);

    return { id: postId, status: "ready" };
  });
}
