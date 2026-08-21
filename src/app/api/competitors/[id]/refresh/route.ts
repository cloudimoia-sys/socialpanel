import { z } from "zod";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";
import { youtubeCompetitors } from "@/providers/competitor/youtube";

/** Vuelve a consultar la API de YouTube y guarda el punto de hoy. Solo para competidores de esa red. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await ctx.params;
    const competitorId = z.string().uuid().parse(id);
    const tenant = await requireCurrentTenant();
    await enforceRateLimit("competitor", `refresh:${tenant.tenantId}`);

    if (!youtubeCompetitors.configured) {
      throw new AppError("El seguimiento automático de YouTube no está configurado.", 400);
    }

    const db = adminClient();
    const { data: competitor } = await db
      .from("competitors")
      .select("id, platform, handle")
      .eq("id", competitorId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle();
    if (!competitor) throw new AppError("Competidor no encontrado.", 404);
    if (competitor.platform !== "youtube") {
      throw new AppError("Solo YouTube se actualiza automáticamente.", 400);
    }

    const stats = await youtubeCompetitors.lookupChannel(competitor.handle);
    if (!stats) {
      throw new AppError("No se pudo consultar ese canal ahora mismo. Inténtalo de nuevo en un rato.", 502);
    }

    const { data, error } = await db
      .from("competitor_snapshots")
      .upsert(
        {
          competitor_id: competitorId,
          tenant_id: tenant.tenantId,
          followers: stats.subscribers,
          source: "youtube_api",
          notes: stats.videoCount ? `${stats.videoCount} vídeos publicados` : null,
        },
        { onConflict: "competitor_id,snapshot_date" },
      )
      .select("*")
      .single();

    if (error || !data) throw error ?? new AppError("No se pudo guardar.", 500);
    return { snapshot: data };
  });
}
