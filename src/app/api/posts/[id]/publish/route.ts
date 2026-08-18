import { z } from "zod";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { userClient } from "@/lib/supabase";
import { requireCurrentTenant, requireTenantRole } from "@/lib/tenant";
import { LIMITS_BY_PLATFORM } from "@/domain/platform-rules";
import { inngest } from "@/inngest/client";

const bodySchema = z.object({
  platforms: z
    .array(z.enum(Object.keys(LIMITS_BY_PLATFORM) as [string, ...string[]]))
    .min(1)
    .max(9),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await ctx.params;
    const postId = z.string().uuid().parse(id);
    const body = bodySchema.parse(await request.json());

    const tenant = await requireCurrentTenant();
    // Publicar es irreversible de cara al público: no lo hace cualquier miembro.
    requireTenantRole(tenant, ["owner", "admin"]);
    await enforceRateLimit("publish", tenant.tenantId);

    // Lectura con el cliente de usuario: el RLS confirma que el post es suyo.
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

    // `failed` puede significar dos cosas distintas: que falló la generación
    // (no hay nada que publicar) o que falló la publicación (sí lo hay, y
    // reintentar es legítimo). Lo que decide es si existe contenido.
    const publishable = post.status === "ready" || (post.status === "failed" && post.caption);
    if (!publishable) {
      throw new AppError("El post todavía no está listo para publicar.", 409);
    }

    try {
      await inngest.send({
        name: "post/publish.requested",
        data: { tenantId: tenant.tenantId, postId, platforms: body.platforms },
      });
    } catch (cause) {
      throw new AppError(
        "El servicio de publicación no está disponible. Comprueba que la cola esté arrancada.",
        503,
        cause,
      );
    }

    return { id: postId, status: "publishing" };
  });
}
