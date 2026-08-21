import { AppError } from "@/lib/logger";
import { adminClient } from "@/lib/supabase";
import {
  MODULE_LABEL,
  moduleEnabled,
  planFor,
  TRIAL_BUDGET_CENTS,
  type ModuleId,
  type Plan,
} from "./plans";

/**
 * Cuotas por plan.
 *
 * Se comprueban ANTES de gastar, no después. Un tope que se detecta al
 * facturar no es un tope: es una factura sorpresa.
 *
 * Todo se cuenta contra el mes natural en curso, que es el mismo periodo con
 * el que se factura, para que el cliente vea lo mismo que le cobramos.
 */

export interface Usage {
  posts: number;
  images: number;
  videoSeconds: number;
  spentCents: number;
}

function monthStart(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function usageThisMonth(tenantId: string): Promise<Usage> {
  const db = adminClient();
  const since = monthStart();

  const [{ data: events, error }, { count: posts }] = await Promise.all([
    db
      .from("usage_events")
      .select("kind, units, cost_cents, byok")
      .eq("tenant_id", tenantId)
      .gte("created_at", since),
    db
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", since),
  ]);

  if (error) {
    // Ante la duda, no dejamos pasar consumo que no podemos contabilizar.
    throw new AppError("No se pudo comprobar tu consumo. Inténtalo de nuevo.", 503, error.message);
  }

  const usage: Usage = { posts: posts ?? 0, images: 0, videoSeconds: 0, spentCents: 0 };

  for (const e of events ?? []) {
    if (e.kind === "image") usage.images += Number(e.units);
    if (e.kind === "video") usage.videoSeconds += Number(e.units);
    // El consumo BYOK lo paga el cliente a su proveedor: se registra para que
    // lo vea, pero no cuenta contra nuestro techo de gasto.
    if (!e.byok) usage.spentCents += Number(e.cost_cents);
  }

  return usage;
}

async function tenantPlan(tenantId: string): Promise<{ plan: Plan; active: boolean }> {
  const { data, error } = await adminClient()
    .from("tenants")
    .select("plan, plan_status")
    .eq("id", tenantId)
    .single();

  if (error || !data) throw new AppError("Cuenta no encontrada.", 404, error?.message);

  const plan = planFor(data.plan);

  // Durante la prueba se aplica el plan completo en cuotas pero con techo de
  // gasto reducido: la tarjeta frena el abuso masivo, no el de una tarjeta
  // virtual de un solo uso que agota el vídeo del plan Pro y cancela.
  const effective =
    data.plan_status === "trialing"
      ? { ...plan, budgetCents: Math.min(plan.budgetCents, TRIAL_BUDGET_CENTS) }
      : plan;

  return {
    plan: effective,
    // `none` es la cuenta recién creada, que aún no ha pasado por Stripe.
    // `past_due` y `canceled` bloquean: si no paga, no gasta nuestro dinero.
    active:
      data.plan_status === "active" ||
      data.plan_status === "trialing" ||
      data.plan_status === "none",
  };
}

/**
 * Comprueba que la operación cabe en el plan antes de ejecutarla.
 *
 * `videoSeconds` se pasa al pedir vídeo, para que el tope se aplique sobre lo
 * que se va a consumir y no sobre lo ya consumido.
 */
export async function assertQuota(
  tenantId: string,
  kind: "post" | "image" | "video",
  videoSeconds = 0,
): Promise<void> {
  const [{ plan, active }, usage] = await Promise.all([
    tenantPlan(tenantId),
    usageThisMonth(tenantId),
  ]);

  if (!active) {
    throw new AppError(
      "Tu suscripción no está activa. Actualiza el pago para seguir publicando.",
      402,
    );
  }

  if (usage.spentCents >= plan.budgetCents) {
    throw new AppError(
      `Has alcanzado el techo de consumo del plan ${plan.name} este mes. ` +
        "Cambia de plan o añade tu propia API key en Ajustes.",
      402,
    );
  }

  if (kind === "post" && usage.posts >= plan.social.posts) {
    throw new AppError(
      `Has agotado las ${plan.social.posts} publicaciones del plan ${plan.name} este mes.`,
      402,
    );
  }

  if (kind === "image" && usage.images >= plan.social.images) {
    throw new AppError(
      `Has agotado las ${plan.social.images} imágenes del plan ${plan.name} este mes.`,
      402,
    );
  }

  if (kind === "video") {
    if (plan.social.videoSeconds === 0) {
      throw new AppError(`El plan ${plan.name} no incluye generación de vídeo.`, 402);
    }
    if (usage.videoSeconds + videoSeconds > plan.social.videoSeconds) {
      const left = Math.max(0, plan.social.videoSeconds - usage.videoSeconds);
      throw new AppError(
        `Te quedan ${left} s de vídeo este mes en el plan ${plan.name}.`,
        402,
      );
    }
  }
}

/**
 * Corta si el plan del tenant no incluye ese módulo.
 *
 * Es la primera línea de CADA endpoint de un módulo de pago, antes de tocar
 * nada: ocultar la sección en el menú no es control de acceso, la URL sigue
 * siendo alcanzable a mano. Se comprueba aquí y no en la interfaz por la
 * misma razón que el rate limiting vive en el backend.
 */
export async function assertModule(tenantId: string, module: ModuleId): Promise<void> {
  const { plan, active } = await tenantPlan(tenantId);

  if (!active) {
    throw new AppError("Tu suscripción no está activa.", 402);
  }

  if (!moduleEnabled(plan, module)) {
    throw new AppError(
      `El plan ${plan.name} no incluye ${MODULE_LABEL[module]}. Cambia de plan para activarlo.`,
      402,
    );
  }
}

/** Si el plan del tenant incluye un módulo. Para decidir qué pintar, no para autorizar. */
export async function tenantModules(tenantId: string): Promise<ModuleId[]> {
  const { plan } = await tenantPlan(tenantId);
  return (["social", "seo", "email"] as const).filter((m) => moduleEnabled(plan, m));
}

/** Cuántas redes puede conectar todavía. */
export async function assertNetworkQuota(tenantId: string): Promise<void> {
  const { plan } = await tenantPlan(tenantId);

  const { count } = await adminClient()
    .from("social_accounts")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if ((count ?? 0) >= plan.social.networks) {
    throw new AppError(
      `El plan ${plan.name} permite ${plan.social.networks} redes conectadas.`,
      402,
    );
  }
}
