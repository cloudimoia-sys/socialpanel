import { computeRoi } from "@/domain/roi";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";

/**
 * ROI de redes: Redes → Leads → Clientes → Facturación, sobre los leads
 * reales del Social CRM. Nada que consultar a ningún proveedor externo —
 * todo sale de `leads`, así que esto es puro cálculo sobre datos propios.
 */
export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();

    const { data, error } = await adminClient()
      .from("leads")
      .select("*")
      .eq("tenant_id", tenant.tenantId);

    if (error) throw error;
    return computeRoi(data ?? []);
  });
}
