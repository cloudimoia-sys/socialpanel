/**
 * Catálogo de planes.
 *
 * Vive en código y no en base de datos a propósito: los precios y las cuotas
 * son decisiones de producto que deben viajar con el despliegue y quedar en el
 * historial de git, no cambiarse con un UPDATE a las tres de la mañana.
 *
 * Las cuotas son el mecanismo que hace posible el auto-servicio. Sin ellas,
 * cualquiera que se registre gasta nuestras claves de API sin tope; con ellas,
 * el peor caso está acotado por diseño y no hace falta vigilar a nadie.
 */

export type PlanId = "trial" | "starter" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  /** Precio de venta al cliente, en céntimos de euro. */
  priceCents: number;
  /** Publicaciones al mes. */
  posts: number;
  /** Imágenes generadas al mes. */
  images: number;
  /** Segundos de vídeo al mes. El vídeo es el 80% del coste variable. */
  videoSeconds: number;
  /** Redes conectables. */
  networks: number;
  /**
   * Techo de gasto en proveedores para este plan, en céntimos.
   *
   * Es la última red de seguridad: aunque las cuotas por tipo estén bien, un
   * cambio de precios del proveedor o un modelo más caro no puede convertir a
   * un cliente de 29 € en uno de 200 €.
   */
  budgetCents: number;
}

export const PLANS: Record<PlanId, Plan> = {
  trial: {
    id: "trial",
    name: "Prueba",
    priceCents: 0,
    posts: 5,
    images: 5,
    videoSeconds: 0,
    networks: 3,
    // 2 € cubre de sobra una prueba real y acota el abuso de altas masivas.
    budgetCents: 200,
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceCents: 2900,
    posts: 30,
    images: 30,
    videoSeconds: 60,
    networks: 5,
    budgetCents: 1200,
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 7900,
    posts: 120,
    images: 120,
    videoSeconds: 300,
    networks: 9,
    budgetCents: 4000,
  },
};

export const planFor = (id: string): Plan => PLANS[id as PlanId] ?? PLANS.trial;

/** Días de prueba con tarjeta ya registrada. */
export const TRIAL_DAYS = 7;

/**
 * Techo de gasto durante la prueba, aunque el plan contratado permita más.
 *
 * La tarjeta obligatoria frena el abuso masivo, pero no el de una tarjeta
 * virtual de un solo uso: sin este tope, alguien podría agotar los 300 s de
 * vídeo del plan Pro en la prueba y cancelar antes del primer cobro. 5 € es
 * suficiente para valorar el producto y poco para que salga a cuenta abusarlo.
 */
export const TRIAL_BUDGET_CENTS = 500;

/**
 * Margen bruto estimado del plan, descontando el coste de proveedores en el
 * peor caso (cliente que agota todas sus cuotas).
 *
 * Sirve para no fijar un precio por debajo de coste sin darse cuenta.
 */
export function worstCaseMarginCents(plan: Plan): number {
  // ~2 $ por perfil de Upload-Post en el plan Professional, más el techo de
  // gasto en IA de este plan.
  const distributionCents = 190;
  return plan.priceCents - plan.budgetCents - distributionCents;
}
