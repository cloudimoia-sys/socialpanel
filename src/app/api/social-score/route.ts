import { computeSocialScore } from "@/domain/social-score";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";
import { credentialFor, publishProvider } from "@/providers/registry";

export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    const db = adminClient();
    const now = Date.now();

    const [{ data: last30 }, { data: winnerSample }] = await Promise.all([
      db
        .from("posts")
        .select("created_at")
        .eq("tenant_id", tenant.tenantId)
        .is("deleted_at", null)
        .gte("created_at", new Date(now - 30 * 86_400_000).toISOString()),
      // Ventana amplia (90 días) y no solo 30: con una sola muestra de un mes
      // "cero ganadores marcados todavía" y "cero ganadores porque nada
      // funcionó" se confundirían. Con más margen, un tenant activo que
      // simplemente aún no ha usado la estrella tiene más ocasión de que se
      // note la diferencia frente a quien sí la usa y le sale bajo de verdad.
      db
        .from("posts")
        .select("is_winner")
        .eq("tenant_id", tenant.tenantId)
        .is("deleted_at", null)
        .gte("created_at", new Date(now - 90 * 86_400_000).toISOString()),
    ]);

    const postsLast30 = last30?.length ?? 0;

    // Semanas de las últimas 4 con al menos un post: se calcula por índice de
    // semana relativo a hoy, no por semana natural — así no depende de en qué
    // día caiga el corte del mes.
    const weekBuckets = new Set<number>();
    for (const row of last30 ?? []) {
      const days = (now - new Date(row.created_at).getTime()) / 86_400_000;
      const week = Math.floor(days / 7);
      if (week >= 0 && week < 4) weekBuckets.add(week);
    }

    const winnersInSample = (winnerSample ?? []).filter((p) => p.is_winner).length;
    const winnerRatio =
      winnersInSample === 0 || !winnerSample?.length ? null : winnersInSample / winnerSample.length;

    // Mismas llamadas que /api/metrics: la interacción tiene que salir de los
    // mismos números que el cliente ya ve en esa pantalla.
    let engagementRates: number[] = [];
    try {
      const cred = await credentialFor(tenant.tenantId, "upload_post");
      const provider = publishProvider();
      const accounts = await provider.listAccounts(tenant.tenantId, cred);
      const metrics = await provider.accountMetrics(
        tenant.tenantId,
        accounts.map((a) => a.platform),
        cred,
      );

      engagementRates = metrics
        .filter((m) => !m.unavailable && m.impressions !== null && m.impressions > 0)
        .map((m) => {
          const interactions = (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0);
          return interactions / m.impressions!;
        });
    } catch {
      // Sin cuentas conectadas o sin credencial: la interacción queda sin
      // datos (lista vacía), no es un motivo para tumbar todo el cálculo.
      engagementRates = [];
    }

    const score = computeSocialScore({
      postsLast30,
      weeksWithPost: weekBuckets.size,
      engagementRates,
      winnerRatio,
    });

    return score;
  });
}
