import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { PLANS, type PlanId } from "@/domain/plans";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { planForPrice, stripe } from "@/lib/stripe";
import { adminClient } from "@/lib/supabase";

/**
 * Webhook de Stripe: la ÚNICA vía por la que cambia el plan de un tenant.
 *
 * Tres reglas que sostienen esto:
 *
 * 1. Se verifica la firma. Sin verificar, este endpoint es un formulario
 *    público para regalarse el plan Pro.
 * 2. Es idempotente. Stripe reintenta ante cualquier duda de entrega, así que
 *    procesar dos veces tiene que ser inofensivo — es el mismo fallo que nos
 *    costó tres publicaciones en Instagram.
 * 3. Devolvemos 200 aunque el evento no nos interese. Un error hace que Stripe
 *    reintente durante días y acabe desactivando el endpoint.
 */

const RELEVANT = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

type PlanStatus = "trialing" | "active" | "past_due" | "canceled";

/** Estados de Stripe → los nuestros. Lo que no reconocemos, no cobra. */
function mapStatus(status: Stripe.Subscription.Status): PlanStatus {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "past_due" || status === "unpaid") return "past_due";
  return "canceled";
}

export async function POST(request: Request) {
  const env = serverEnv();
  const secret = env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");

  if (!secret || !signature) {
    log.error("webhook de stripe sin firma o sin secreto configurado");
    return NextResponse.json({ error: "no configurado" }, { status: 400 });
  }

  // Cuerpo en crudo: cualquier reserialización invalida la firma.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, secret);
  } catch (cause) {
    log.error("firma de webhook invalida", { error: String(cause) });
    return NextResponse.json({ error: "firma invalida" }, { status: 400 });
  }

  if (!RELEVANT.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  const db = adminClient();

  // Marca de procesado ANTES de actuar: la clave primaria hace de cerrojo, así
  // que dos entregas simultáneas del mismo evento no pueden aplicarse dos veces.
  const { error: dupe } = await db.from("processed_webhooks").insert({ id: event.id });
  if (dupe) {
    log.info("evento de stripe ya procesado", { id: event.id, type: event.type });
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    const subscription =
      event.type === "checkout.session.completed"
        ? await stripe().subscriptions.retrieve(
            String((event.data.object as Stripe.Checkout.Session).subscription),
          )
        : (event.data.object as Stripe.Subscription);

    const tenantId =
      subscription.metadata?.tenant_id ??
      (event.type === "checkout.session.completed"
        ? (event.data.object as Stripe.Checkout.Session).client_reference_id
        : null);

    if (!tenantId) {
      log.error("evento de stripe sin tenant_id", { id: event.id, type: event.type });
      return NextResponse.json({ received: true });
    }

    const priceId = subscription.items.data[0]?.price.id;
    const plan = planForPrice(priceId);
    const status = mapStatus(subscription.status);

    // Si no reconocemos el precio, no adivinamos: dejamos el plan como está y
    // avisamos. Adivinar aquí significa regalar o cobrar de más.
    if (!plan) {
      log.error("precio de stripe desconocido", { priceId, tenantId });
      return NextResponse.json({ received: true });
    }

    const effectivePlan: PlanId = status === "canceled" || status === "past_due" ? "trial" : plan;
    const periodEnd = subscription.items.data[0]?.current_period_end;

    await db
      .from("tenants")
      .update({
        plan: effectivePlan,
        plan_status: status,
        budget_cents: PLANS[effectivePlan].budgetCents,
        stripe_subscription_id: subscription.id,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      })
      .eq("id", tenantId);

    await db.from("audit_log").insert({
      tenant_id: tenantId,
      action: "subscription.updated",
      target: subscription.id,
      metadata: { plan: effectivePlan, status, event: event.type },
    });

    log.info("suscripcion actualizada", { tenantId, plan: effectivePlan, status });
  } catch (cause) {
    // Si falla al aplicar, se borra la marca para que el reintento de Stripe
    // pueda volver a intentarlo. Si no, el evento quedaría perdido.
    await db.from("processed_webhooks").delete().eq("id", event.id);
    log.error("fallo procesando webhook de stripe", { id: event.id, error: String(cause) });
    return NextResponse.json({ error: "error interno" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
