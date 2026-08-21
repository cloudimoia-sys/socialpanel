import type { Lead, LeadStatus } from "@/lib/database.types";

/**
 * ROI de redes sociales: Redes → Leads → Clientes → Facturación.
 *
 * Se calcula sobre el ESTADO ACTUAL de cada lead, no sobre un historial de
 * por dónde pasó — esta app no guarda cambios de estado, solo el estado de
 * hoy. Un lead "perdido" que llegó a tener presupuesto ya no cuenta en
 * "con presupuesto o más": se sale de la cadena en el momento en que se
 * marca perdido. Es una aproximación razonable con los datos que hay, y se
 * explica así en la propia pantalla en vez de aparentar precisión que no
 * existe.
 *
 * La facturación es la suma de `value_cents` de los leads GANADOS que
 * tienen ese dato relleno — no todos lo tienen (es opcional al crear el
 * lead), así que se acompaña siempre de cuántos ganados llevan valor, para
 * que quede claro que puede ser un mínimo, no el total real.
 */

const REACHED: Record<Exclude<LeadStatus, "perdido">, LeadStatus[]> = {
  nuevo: ["nuevo", "contactado", "presupuesto", "ganado"],
  contactado: ["contactado", "presupuesto", "ganado"],
  presupuesto: ["presupuesto", "ganado"],
  ganado: ["ganado"],
};

export interface RoiFunnel {
  /** `null` agrupa los leads sin red asociada (alta manual sin elegir una). */
  platform: string | null;
  total: number;
  contactedOrMore: number;
  quotedOrMore: number;
  won: number;
  lost: number;
  revenueCents: number;
  wonWithValue: number;
}

function summarize(leads: Lead[], platform: string | null): RoiFunnel {
  const won = leads.filter((l) => l.status === "ganado");
  return {
    platform,
    total: leads.length,
    contactedOrMore: leads.filter((l) => REACHED.contactado.includes(l.status)).length,
    quotedOrMore: leads.filter((l) => REACHED.presupuesto.includes(l.status)).length,
    won: won.length,
    lost: leads.filter((l) => l.status === "perdido").length,
    revenueCents: won.reduce((sum, l) => sum + (l.value_cents ?? 0), 0),
    wonWithValue: won.filter((l) => l.value_cents !== null).length,
  };
}

export function computeRoi(leads: Lead[]): { total: RoiFunnel; byPlatform: RoiFunnel[] } {
  const groups = new Map<string | null, Lead[]>();
  for (const lead of leads) {
    const key = lead.platform;
    const group = groups.get(key);
    if (group) group.push(lead);
    else groups.set(key, [lead]);
  }

  const byPlatform = [...groups.entries()]
    .map(([platform, group]) => summarize(group, platform))
    .sort((a, b) => b.total - a.total);

  return { total: summarize(leads, null), byPlatform };
}
