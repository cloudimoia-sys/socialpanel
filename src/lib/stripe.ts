import Stripe from "stripe";
import { serverEnv } from "./env";
import { AppError } from "./logger";
import type { PlanId } from "@/domain/plans";

let client: Stripe | null = null;

export function stripe(): Stripe {
  const key = serverEnv().STRIPE_SECRET_KEY;
  if (!key) throw new AppError("La facturación no está configurada.", 503);
  if (!client) client = new Stripe(key);
  return client;
}

/**
 * Traducción plan → price de Stripe, resuelta SIEMPRE en el servidor.
 *
 * El cliente manda un identificador de plan ("starter"), nunca un price id. Si
 * aceptáramos el price directamente, cualquiera podría pasar el de 0 € y
 * suscribirse gratis al plan Pro.
 */
export function priceFor(plan: PlanId): string {
  const env = serverEnv();
  const prices: Partial<Record<PlanId, string | undefined>> = {
    starter: env.STRIPE_PRICE_STARTER,
    pro: env.STRIPE_PRICE_PRO,
  };

  const price = prices[plan];
  if (!price) throw new AppError("Ese plan no está disponible ahora mismo.", 400);
  return price;
}

/** Camino inverso: del price que manda Stripe al plan que aplicamos. */
export function planForPrice(priceId: string | null | undefined): PlanId | null {
  const env = serverEnv();
  if (priceId && priceId === env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId && priceId === env.STRIPE_PRICE_PRO) return "pro";
  return null;
}
