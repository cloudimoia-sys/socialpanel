import { AppError, log } from "@/lib/logger";
import { adminClient } from "@/lib/supabase";
import type { Cost } from "@/providers/types";
import { planFor, TRIAL_BUDGET_CENTS } from "./plans";

/**
 * Medición de consumo y tope de gasto.
 *
 * Va desde el primer día porque añadirlo después obliga a reescribir todos los
 * flujos. Sin esto no sabes tu margen y un bucle accidental puede gastar cientos
 * de euros antes de que nadie lo note.
 *
 * El consumo BYOK (clave del propio cliente) se registra pero no cuenta contra
 * el presupuesto: lo paga él directamente a su proveedor.
 */

export async function recordUsage(
  tenantId: string,
  kind: "llm" | "image" | "video" | "publish",
  cost: Cost,
  postId?: string,
): Promise<void> {
  const { error } = await adminClient().from("usage_events").insert({
    tenant_id: tenantId,
    kind,
    provider: cost.provider,
    model: cost.model ?? null,
    units: cost.units,
    cost_cents: cost.cents,
    byok: cost.byok,
    post_id: postId ?? null,
  });

  // Registrar consumo nunca debe tumbar una operación que ya se ha pagado.
  if (error) log.error("no se pudo registrar el consumo", { tenantId, kind, error: error.message });
}

export async function spentThisMonthCents(tenantId: string): Promise<number> {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const { data, error } = await adminClient()
    .from("usage_events")
    .select("cost_cents")
    .eq("tenant_id", tenantId)
    .eq("byok", false)
    .gte("created_at", since.toISOString());

  if (error) {
    // Ante la duda, no dejamos pasar gasto que no podemos contabilizar.
    throw new AppError("No se pudo comprobar el consumo. Inténtalo de nuevo.", 503, error.message);
  }

  return (data ?? []).reduce((sum, row) => sum + Number(row.cost_cents ?? 0), 0);
}

/**
 * Se llama ANTES de cualquier operación que cueste dinero, con el coste
 * estimado. Las de vídeo son las que de verdad importan aquí.
 */
export async function assertBudget(
  tenantId: string,
  estimatedCents: number,
  byok: boolean,
): Promise<void> {
  if (byok) return;

  const { data, error } = await adminClient()
    .from("tenants")
    .select("plan, plan_status, budget_cents")
    .eq("id", tenantId)
    .single();

  if (error || !data) throw new AppError("Cuenta no encontrada.", 404, error?.message);

  // El techo efectivo es el menor de los tres: el del plan, el de la cuenta y
  // —si está en prueba— el de prueba. Así un presupuesto puesto a mano nunca
  // excede lo que el plan permite, y bajar de plan aprieta el tope al instante.
  const budget = Math.min(
    planFor(data.plan).budgetCents,
    Number(data.budget_cents),
    data.plan_status === "trialing" ? TRIAL_BUDGET_CENTS : Number.MAX_SAFE_INTEGER,
  );
  const spent = await spentThisMonthCents(tenantId);

  if (spent + estimatedCents > budget) {
    throw new AppError(
      "Has agotado el presupuesto de este mes. Cambia de plan o añade tu propia API key.",
      402,
    );
  }
}
