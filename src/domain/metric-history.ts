import { adminClient } from "@/lib/supabase";
import type { MetricSnapshot } from "@/lib/database.types";

/**
 * Compara contra el histórico propio (`metric_snapshots`), no contra la API
 * de Upload-Post: esa API solo da el total de HOY, nunca el de hace 30 días.
 * Sin snapshot guardado en el rango, no hay con qué comparar — se devuelve
 * `null`, no un `0` que se leería como una caída real.
 */

const MSDAY = 86_400_000;

/**
 * El snapshot más cercano a "hace `daysAgo` días", dentro de una tolerancia
 * de una semana a cada lado. Un cron diario debería dejar un punto exacto,
 * pero un fallo puntual de Upload-Post (cuenta desconectada un día, límite
 * de peticiones) no debe dejar la comparación sin dato solo por caer justo
 * en ese hueco.
 */
export async function pastSnapshot(
  tenantId: string,
  platform: string,
  daysAgo: number,
  toleranceDays = 7,
): Promise<MetricSnapshot | null> {
  const target = new Date(Date.now() - daysAgo * MSDAY);
  const from = new Date(target.getTime() - toleranceDays * MSDAY).toISOString().slice(0, 10);
  const to = new Date(target.getTime() + toleranceDays * MSDAY).toISOString().slice(0, 10);

  const { data } = await adminClient()
    .from("metric_snapshots")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("platform", platform)
    .gte("snapshot_date", from)
    .lte("snapshot_date", to)
    // El más antiguo dentro del rango: el más cercano a "hace de verdad
    // `daysAgo` días" en vez del más reciente, que sesgaría la comparación
    // hacia un periodo más corto del pedido.
    .order("snapshot_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data;
}

/** `null` si falta cualquiera de los dos valores, o si la base es cero (no hay con qué dividir). */
export function pctDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function engagementRate(
  likes: number | null,
  comments: number | null,
  shares: number | null,
  impressions: number | null,
): number | null {
  if (!impressions || impressions <= 0) return null;
  return (((likes ?? 0) + (comments ?? 0) + (shares ?? 0)) / impressions) * 100;
}
