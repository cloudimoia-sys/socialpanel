import { z } from "zod";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";

const bodySchema = z.object({
  followers: z.number().int().min(0).max(1_000_000_000).optional(),
  postsPerWeek: z.number().min(0).max(200).optional(),
  bestFormat: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

/** Un punto manual nuevo para un competidor — quien lo mete ya lo está mirando en la app oficial de esa red. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return run(async () => {
    const { id } = await ctx.params;
    const competitorId = z.string().uuid().parse(id);
    const body = bodySchema.parse(await request.json());
    const tenant = await requireCurrentTenant();
    await enforceRateLimit("competitor", `snapshot:${tenant.tenantId}`);

    if (
      body.followers === undefined &&
      body.postsPerWeek === undefined &&
      !body.bestFormat &&
      !body.notes
    ) {
      throw new AppError("Escribe al menos un dato.", 400);
    }

    const db = adminClient();
    // Re-valida que el competidor es de este tenant antes de escribir: el id
    // de la URL no basta por sí solo, igual que en cualquier otro recurso.
    const { data: competitor } = await db
      .from("competitors")
      .select("id")
      .eq("id", competitorId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle();
    if (!competitor) throw new AppError("Competidor no encontrado.", 404);

    const { data, error } = await db
      .from("competitor_snapshots")
      // Un punto por día: si ya se añadió uno hoy, esto lo actualiza en vez
      // de crear un segundo punto en la misma fecha.
      .upsert(
        {
          competitor_id: competitorId,
          tenant_id: tenant.tenantId,
          followers: body.followers ?? null,
          posts_per_week: body.postsPerWeek ?? null,
          best_format: body.bestFormat ?? null,
          notes: body.notes ?? null,
          source: "manual",
        },
        { onConflict: "competitor_id,snapshot_date" },
      )
      .select("*")
      .single();

    if (error || !data) throw error ?? new AppError("No se pudo guardar.", 500);
    return { snapshot: data };
  });
}
