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
 *
 * ---------------------------------------------------------------------------
 * Cuotas POR MÓDULO
 *
 * Cada módulo tiene una forma de coste distinta y no se pueden medir con la
 * misma vara: redes se mide en publicaciones y segundos de vídeo, SEO en
 * keywords rastreadas al día (coste recurrente de una API de pago) y email en
 * envíos al mes. Un único contador para todo dejaría, por ejemplo, que un
 * cliente de 29 € mandara 50.000 correos sin pasar de "una publicación".
 *
 * REGLA: un módulo AUSENTE del plan no está incluido. No hay una lista de
 * módulos aparte de las cuotas — sería una segunda fuente de verdad que
 * acabaría contradiciéndolas. Para saber si un plan incluye algo se usa
 * `moduleEnabled()`, nunca se leen las cuotas directamente.
 */

export type PlanId = "trial" | "starter" | "pro";

/**
 * Módulos del producto.
 *
 * `social` es el núcleo y está en todos los planes. El resto se añaden aquí
 * conforme se construyen — y hasta que su bloque de cuotas no aparezca en un
 * plan, `moduleEnabled()` devuelve false y la aplicación se comporta como si
 * no existieran.
 */
export type ModuleId = "social" | "seo" | "email";

export const MODULE_LABEL: Record<ModuleId, string> = {
  social: "Redes sociales",
  seo: "SEO",
  email: "Email marketing",
};

export interface SocialQuotas {
  /** Publicaciones al mes. */
  posts: number;
  /** Imágenes generadas al mes. */
  images: number;
  /** Segundos de vídeo al mes. El vídeo es el 80% del coste variable. */
  videoSeconds: number;
  /** Redes conectables. */
  networks: number;
}

export interface SeoQuotas {
  /** Webs conectadas a Search Console. Leerlas es gratis (API oficial). */
  sites: number;
  /**
   * Keywords con seguimiento de posición. Esta cuota SÍ cuesta dinero
   * recurrente: no existe API gratuita de posiciones, así que cada keyword
   * rastreada es una consulta de pago al día, todos los días del mes.
   */
  trackedKeywords: number;
  /** Auditorías completas del sitio al mes. Cómputo propio, coste ~0. */
  auditsPerMonth: number;
}

export interface EmailQuotas {
  /** Envíos al mes. Es la unidad que factura el proveedor de entrega. */
  sends: number;
  /** Contactos guardados en las listas. */
  contacts: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Precio de venta al cliente, en céntimos de euro. */
  priceCents: number;
  /**
   * Techo de gasto en proveedores para este plan, en céntimos.
   *
   * Es la última red de seguridad, transversal a todos los módulos: aunque
   * las cuotas por tipo estén bien, un cambio de precios del proveedor o un
   * modelo más caro no puede convertir a un cliente de 29 € en uno de 200 €.
   */
  budgetCents: number;

  /** Núcleo del producto: presente en todos los planes. */
  social: SocialQuotas;
  /** Ausente = el plan no incluye SEO. */
  seo?: SeoQuotas;
  /** Ausente = el plan no incluye email marketing. */
  email?: EmailQuotas;
}

/**
 * El bloque `email` está definido como tipo pero no aparece en ningún plan:
 * ese módulo no existe aún, y anunciarlo aquí sería vender lo que no se puede
 * usar.
 *
 * `seo` sí está en los tres planes, incluido el gratuito, por un motivo
 * concreto: leer Search Console es una API oficial y GRATIS, así que no hay
 * coste que recuperar. Se cobra lo que cuesta dinero. `trackedKeywords` va a
 * 0 en todos porque el rastreo de posiciones —lo único de SEO con coste
 * recurrente— todavía no está construido.
 */
export const PLANS: Record<PlanId, Plan> = {
  trial: {
    id: "trial",
    name: "Prueba",
    priceCents: 0,
    // 2 € cubre de sobra una prueba real y acota el abuso de altas masivas.
    budgetCents: 200,
    social: { posts: 5, images: 5, videoSeconds: 0, networks: 3 },
    seo: { sites: 1, trackedKeywords: 0, auditsPerMonth: 1 },
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceCents: 2900,
    budgetCents: 1200,
    social: { posts: 30, images: 30, videoSeconds: 60, networks: 5 },
    seo: { sites: 1, trackedKeywords: 0, auditsPerMonth: 4 },
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 7900,
    budgetCents: 4000,
    social: { posts: 120, images: 120, videoSeconds: 300, networks: 9 },
    seo: { sites: 5, trackedKeywords: 0, auditsPerMonth: 30 },
  },
};

export const planFor = (id: string): Plan => PLANS[id as PlanId] ?? PLANS.trial;

/**
 * Si un plan incluye un módulo.
 *
 * Única forma admitida de comprobarlo: leer las cuotas de un módulo sin pasar
 * antes por aquí es cómo se cuela una función de pago en un plan que no la
 * tiene contratada.
 */
export function moduleEnabled(plan: Plan, module: ModuleId): boolean {
  if (module === "social") return true;
  return plan[module] !== undefined;
}

/** Módulos incluidos en un plan, para pintarlos en la pantalla de suscripción. */
export function modulesOf(plan: Plan): ModuleId[] {
  return (["social", "seo", "email"] as const).filter((m) => moduleEnabled(plan, m));
}

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
 * Sirve para no fijar un precio por debajo de coste sin darse cuenta. El coste
 * de distribución se desglosa por módulo porque cada uno tiene su proveedor
 * con su propia forma de cobrar — meterlos en una sola constante escondería
 * cuál de ellos se come el margen cuando deje de cuadrar.
 */
export function worstCaseMarginCents(plan: Plan): number {
  // ~2 $ por perfil de Upload-Post en el plan Professional.
  const socialCents = 190;

  // Sin API gratuita de posiciones: cada keyword es una consulta de pago al
  // día. ~0,02 € por consulta × 30 días es el orden de magnitud a batir al
  // elegir proveedor.
  const seoCents = plan.seo ? Math.round(plan.seo.trackedKeywords * 2 * 30) : 0;

  // Los proveedores de entrega rondan 0,03-0,10 € por cada 100 envíos.
  const emailCents = plan.email ? Math.round((plan.email.sends / 100) * 5) : 0;

  return plan.priceCents - plan.budgetCents - socialCents - seoCents - emailCents;
}
