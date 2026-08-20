import { z } from "zod";
import { AppError } from "@/lib/logger";
import { run } from "@/lib/route";
import { adminClient, userClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";

/** Estado de un post. Lo consulta el composer mientras se genera. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await ctx.params;
    const postId = z.string().uuid().parse(id);
    const tenant = await requireCurrentTenant();

    const supabase = await userClient();
    const { data: post } = await supabase
      .from("posts")
      .select(
        "id, status, caption, hashtags, error, asset_id, created_at, scheduled_at, scheduled_platforms, source_url, source_title",
      )
      .eq("id", postId)
      .eq("tenant_id", tenant.tenantId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!post) throw new AppError("Post no encontrado.", 404);

    let mediaUrl: string | null = null;
    let mediaKind: "image" | "video" | null = null;

    if (post.asset_id) {
      const db = adminClient();
      const { data: asset } = await db
        .from("assets")
        .select("kind, storage_path")
        .eq("id", post.asset_id)
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle();

      if (asset) {
        mediaKind = asset.kind;
        // URL firmada de 1 hora: el bucket es privado y así sigue.
        const { data: signed } = await db.storage
          .from("media")
          .createSignedUrl(asset.storage_path, 3600);
        mediaUrl = signed?.signedUrl ?? null;
      }
    }

    const { data: targets } = await supabase
      .from("post_targets")
      .select("platform, status, remote_url, error")
      .eq("post_id", postId)
      .eq("tenant_id", tenant.tenantId);

    return {
      id: post.id,
      status: post.status,
      caption: post.caption,
      hashtags: post.hashtags ?? [],
      error: post.error,
      scheduledAt: post.scheduled_at,
      scheduledPlatforms: post.scheduled_platforms ?? [],
      mediaUrl,
      mediaKind,
      sourceUrl: post.source_url,
      sourceTitle: post.source_title,
      targets: targets ?? [],
    };
  });
}

const flagsSchema = z.object({
  isFavorite: z.boolean().optional(),
  isWinner: z.boolean().optional(),
});

/**
 * Marca un post como favorito o como ganador.
 *
 * Solo dos banderas: el cuerpo se valida con una lista cerrada para que no se
 * pueda colar otro campo del post (por ejemplo `status` o `tenant_id`) en la
 * misma petición. El tenant sale de la sesión y se filtra explícitamente
 * además del RLS — un post de otro cliente no existe para esta ruta.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await ctx.params;
    const postId = z.string().uuid().parse(id);
    const body = flagsSchema.parse(await request.json());
    const tenant = await requireCurrentTenant();

    const patch: { is_favorite?: boolean; is_winner?: boolean } = {};
    if (body.isFavorite !== undefined) patch.is_favorite = body.isFavorite;
    if (body.isWinner !== undefined) patch.is_winner = body.isWinner;
    if (Object.keys(patch).length === 0) throw new AppError("No hay nada que cambiar.", 400);

    const { data, error } = await (await userClient())
      .from("posts")
      .update(patch)
      .eq("id", postId)
      .eq("tenant_id", tenant.tenantId)
      .is("deleted_at", null)
      .select("id, is_favorite, is_winner")
      .maybeSingle();

    if (error) throw new AppError("No se pudo guardar la marca.", 500, error.message);
    // Sin fila devuelta, el post no es de este tenant o no existe. Se responde
    // igual en los dos casos: distinguirlos revelaría qué IDs existen.
    if (!data) throw new AppError("Post no encontrado.", 404);

    return data;
  });
}
