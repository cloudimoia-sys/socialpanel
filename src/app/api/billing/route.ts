import { PLANS, planFor } from "@/domain/plans";
import { usageThisMonth } from "@/domain/quota";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";

/** Estado de suscripción y consumo del mes. */
export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();

    const [{ data }, usage] = await Promise.all([
      adminClient()
        .from("tenants")
        .select("plan, plan_status, current_period_end, stripe_customer_id")
        .eq("id", tenant.tenantId)
        .single(),
      usageThisMonth(tenant.tenantId),
    ]);

    return {
      plan: planFor(data?.plan ?? "trial"),
      status: data?.plan_status ?? "none",
      renewsAt: data?.current_period_end ?? null,
      hasSubscription: Boolean(data?.stripe_customer_id),
      usage,
      catalog: Object.values(PLANS),
    };
  });
}
