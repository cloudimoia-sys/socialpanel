import { zonedDateToUtc } from "./schedule";

/**
 * Próximo hueco libre de la rejilla semanal de publicación.
 *
 * Los huecos se guardan como reloj de pared ("los lunes a las 18:00") y aquí
 * se convierten a un instante concreto. Toda la aritmética se hace sobre
 * fechas EN LA ZONA DEL NEGOCIO, no en la del servidor: en Vercel el proceso
 * corre en UTC, y a las 23:30 UTC de un lunes ya es martes en Madrid — mirar
 * el día de la semana del servidor daría el hueco equivocado.
 */

export interface Slot {
  platform: string;
  /** 0 = domingo … 6 = sábado, igual que `Date.getDay()`. */
  weekday: number;
  /** "HH:MM:SS" en hora local del negocio. */
  at_time: string;
}

/** Fecha de hoy (YYYY-MM-DD) tal como se ve en esa zona horaria. */
function todayIn(timeZone: string, from: Date): string | null {
  try {
    // "en-CA" da exactamente YYYY-MM-DD, que es el formato que espera
    // `zonedDateToUtc` y evita tener que recomponerlo a mano.
    return from.toLocaleDateString("en-CA", { timeZone });
  } catch {
    return null;
  }
}

/** Suma días a una fecha YYYY-MM-DD sin salir del calendario. */
function addDays(date: string, days: number): string {
  // Mediodía UTC: cualquier hora cercana a medianoche podría caer en el día
  // anterior o siguiente al formatear, y aquí solo interesa el calendario.
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Día de la semana de una fecha YYYY-MM-DD, con la convención de `Date.getDay()`. */
function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/**
 * Devuelve el instante UTC del siguiente hueco de `platform` posterior a
 * `from`, o `null` si esa red no tiene ninguno configurado.
 *
 * Se recorren quince días y no siete: con siete, un hueco que cae hoy pero ya
 * ha pasado no encontraría su repetición de la semana que viene.
 */
export function nextSlot(
  slots: Slot[],
  platform: string,
  timeZone: string,
  from: Date = new Date(),
): Date | null {
  const mine = slots.filter((s) => s.platform === platform);
  if (mine.length === 0) return null;

  const today = todayIn(timeZone, from);
  if (today === null) return null;

  for (let offset = 0; offset <= 15; offset += 1) {
    const date = addDays(today, offset);
    const weekday = weekdayOf(date);

    // Varios huecos el mismo día se ordenan por hora para quedarse con el
    // primero que aún no ha pasado, no con uno cualquiera.
    const candidates = mine
      .filter((s) => s.weekday === weekday)
      .sort((a, b) => a.at_time.localeCompare(b.at_time));

    for (const slot of candidates) {
      const [hour, minute] = slot.at_time.split(":").map(Number);
      if (hour === undefined || minute === undefined) continue;

      const when = zonedDateToUtc(date, hour, timeZone, minute);
      if (when && when.getTime() > from.getTime()) return when;
    }
  }

  return null;
}

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "Lunes · 18:00", para enseñar el hueco sin repetir la fecha completa. */
export function describeSlot(slot: Slot): string {
  const name = DAY_NAMES[slot.weekday] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} · ${slot.at_time.slice(0, 5)}`;
}
