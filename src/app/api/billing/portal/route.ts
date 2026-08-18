import { serverEnv } from "@/lib/env";
import { AppError } from "@/lib/logger";
import { run } from "@/lib/route";
import { stripe } from "@/lib/stripe";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant, requireTenantRole } from "@/lib/tenant";

/**
 * Portal de cliente de Stripe.
 *
 * Cambiar de plan, actualizar la tarjeta, ver facturas y cancelar ocurren ahí,
 * no aquí. Reimplementar eso sería asumir IVA por país, reintentos de cobro y
 * normativa de facturación — meses de trabajo y responsabilidad legal para
 * reproducir algo que ya existe.
 */
export async function POST() {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    const { data } = await adminClient()
      .from("tenants")
      .select("stripe_customer_id")
      .eq("id", tenant.tenantId)
      .single();

    if (!data?.stripe_customer_id) {
      throw new AppError("Todavía no tienes ninguna suscripción.", 409);
    }

    const session = await stripe().billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${serverEnv().APP_URL}/dashboard/billing`,
    });

    return { url: session.url };
  });
}
