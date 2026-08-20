import { run } from "@/lib/route";
import { listMyTenants, requireCurrentTenant } from "@/lib/tenant";

/** Tenants del usuario, para el selector de la barra lateral. */
export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    const tenants = await listMyTenants();
    return { tenants, activeId: tenant.tenantId };
  });
}
