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
