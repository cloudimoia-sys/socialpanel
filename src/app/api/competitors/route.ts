import { z } from "zod";
import { LIMITS_BY_PLATFORM } from "@/domain/platform-rules";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import type { CompetitorSnapshot } from "@/lib/database.types";
import { requireCurrentTenant } from "@/lib/tenant";
import { youtubeCompetitors } from "@/providers/competitor/youtube";

const platformEnum = z.enum(Object.keys(LIMITS_BY_PLATFORM) as [string, ...string[]]);

const createSchema = z.object({
  platform: platformEnum,
  handle: z.string().min(1).max(80),
  displayName: z.string().max(120).optional(),
  // Primer punto, para las redes sin API: si el cliente ya tiene el dato a
  // mano al darlo de alta, que no tenga que dar dos pasos para lo mismo.
  followers: z.number().int().min(0).max(1_000_000_000).optional(),
  postsPerWeek: z.number().min(0).max(200).optional(),
  bestFormat: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * Competidores. Solo YouTube se rellena solo (API oficial gratuita); el
 * resto de redes no tienen vía sin scrapear —contra sus términos de
 * servicio— así que el dato lo mete quien ya lo está mirando en la app
 * oficial de esa red, igual que la noticia de una URL pegada a mano.
 */
export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    const db = adminClient();

    const { data: competitors, error } = await db
      .from("competitors")
      .select("id, platform, handle, display_name, created_at")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!competitors || competitors.length === 0) return { competitors: [] };

    const { data: snapshots } = await db
      .from("competitor_snapshots")
      .select("*")
      .eq("tenant_id", tenant.tenantId)
      .in(
        "competitor_id",
        competitors.map((c) => c.id),
      )
      .order("snapshot_date", { ascending: false });

    // Última y penúltima por competidor, para poder dibujar una variación
    // sin traer toda la serie — la lista de competidores no necesita más.
    const byCompetitor = new Map<string, CompetitorSnapshot[]>();
    for (const s of snapshots ?? []) {
      const list = byCompetitor.get(s.competitor_id) ?? [];
      if (list.length < 2) list.push(s);
      byCompetitor.set(s.competitor_id, list);
    }

    return {
      competitors: competitors.map((c) => {
        const [latest, previous] = byCompetitor.get(c.id) ?? [];
        return { ...c, latest: latest ?? null, previous: previous ?? null };
      }),
    };
  });
}

export async function POST(request: Request) {
  return run(async () => {
    const body = createSchema.parse(await request.json());
    const tenant = await requireCurrentTenant();
    await enforceRateLimit("competitor", `create:${tenant.tenantId}`);

    const db = adminClient();
    const { data: competitor, error } = await db
      .from("competitors")
      .insert({
        tenant_id: tenant.tenantId,
        platform: body.platform,
        handle: body.handle,
        display_name: body.displayName ?? null,
        created_by: tenant.userId,
      })
      .select("id, platform, handle, display_name, created_at")
      .single();
    if (error || !competitor) throw error ?? new Error("No se pudo crear el competidor.");

    // YouTube: se rellena solo con el dato real de hoy, si hay clave
    // configurada. Cualquier otra red: el snapshot inicial es el que el
    // cliente ya escribió en el propio formulario de alta, si escribió algo.
    let latest: CompetitorSnapshot | null = null;

    if (body.platform === "youtube" && youtubeCompetitors.configured) {
      const stats = await youtubeCompetitors.lookupChannel(body.handle);
      if (stats) {
        const { data } = await db
          .from("competitor_snapshots")
          .insert({
            competitor_id: competitor.id,
            tenant_id: tenant.tenantId,
            followers: stats.subscribers,
            source: "youtube_api",
            notes: stats.videoCount ? `${stats.videoCount} vídeos publicados` : null,
          })
          .select("*")
          .single();
        latest = data ?? null;
      }
    } else if (body.followers !== undefined || body.postsPerWeek !== undefined || body.bestFormat || body.notes) {
      const { data } = await db
        .from("competitor_snapshots")
        .insert({
          competitor_id: competitor.id,
          tenant_id: tenant.tenantId,
          followers: body.followers ?? null,
          posts_per_week: body.postsPerWeek ?? null,
          best_format: body.bestFormat ?? null,
          notes: body.notes ?? null,
          source: "manual",
        })
        .select("*")
        .single();
      latest = data ?? null;
    }

    return { competitor: { ...competitor, latest, previous: null } };
  });
}
