import { z } from "zod";
import { TRIAL_DAYS } from "@/domain/plans";
import { serverEnv } from "@/lib/env";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { priceFor, stripe } from "@/lib/stripe";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant, requireTenantRole } from "@/lib/tenant";

/**
 * Abre el checkout de Stripe para contratar un plan.
 *
 * El cliente manda solo el identificador del plan; el precio lo resuelve el
 * servidor. Aceptar un price id del navegador permitiría suscribirse al plan
 * Pro pagando el precio que uno quisiera.
 */
export async function POST(request: Request) {
  return run(async () => {
    const { plan } = z
      .object({ plan: z.enum(["starter", "pro"]) })
      .parse(await request.json());

    const tenant = await requireCurrentTenant();
    // Contratar compromete dinero: no lo hace cualquier miembro del equipo.
    requireTenantRole(tenant, ["owner", "admin"]);
    await enforceRateLimit("credentials", `billing:${tenant.tenantId}`);

    const db = adminClient();
    const { data: row } = await db
      .from("tenants")
      .select("stripe_customer_id")
      .eq("id", tenant.tenantId)
      .single();

    let customerId = row?.stripe_customer_id ?? null;

    if (!customerId) {
      const customer = await stripe().customers.create({
        email: tenant.email,
        name: tenant.tenantName,
        // El tenant viaja en metadata para poder reconciliar si algo se
        // desincroniza entre Stripe y nuestra base.
        metadata: { tenant_id: tenant.tenantId },
      });
      customerId = customer.id;

      await db
        .from("tenants")
        .update({ stripe_customer_id: customerId })
        .eq("id", tenant.tenantId);
    }

    const appUrl = serverEnv().APP_URL;

    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceFor(plan), quantity: 1 }],
      success_url: `${appUrl}/dashboard/billing?estado=ok`,
      cancel_url: `${appUrl}/dashboard/billing?estado=cancelado`,
      // Tarjeta obligatoria también durante la prueba. Sin ella, cada alta
      // falsa consume presupuesto nuestro; con ella, abusar exige una tarjeta
      // real por cada intento.
      payment_method_collection: "always",
      subscription_data: {
        // También en la suscripción: el webhook lee de aquí para saber a qué
        // tenant aplicar el plan sin depender de una búsqueda por cliente.
        metadata: { tenant_id: tenant.tenantId },
        trial_period_days: TRIAL_DAYS,
        trial_settings: {
          // Si al acabar la prueba la tarjeta no sirve, se cancela en vez de
          // quedarse en un limbo impagado consumiendo recursos.
          end_behavior: { missing_payment_method: "cancel" },
        },
      },
      client_reference_id: tenant.tenantId,
      allow_promotion_codes: true,
      // Stripe Tax exige tener configurada la dirección de origen y el registro
      // fiscal. Si se activa sin eso, la creación del checkout falla — así que
      // va detrás de una variable en vez de romper el primer intento.
      automatic_tax: { enabled: serverEnv().STRIPE_AUTOMATIC_TAX === "true" },
    });

    if (!session.url) throw new AppError("No se pudo abrir el pago.", 502);

    return { url: session.url };
  });
}
