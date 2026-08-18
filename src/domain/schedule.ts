/**
 * Conversión de "una fecha y una hora local" al instante UTC correspondiente.
 *
 * Hace falta porque las ideas del plan traen solo una fecha (`2026-09-12`) y la
 * marca define a qué hora publica y en qué huso. Guardar la hora local sin
 * convertir haría que el post saliera desplazado según dónde corriera el
 * servidor — y en Vercel no está en España.
 */

/**
 * Devuelve el instante UTC en el que, en `timeZone`, son las `hour:00` del día
 * `date` (YYYY-MM-DD).
 *
 * El truco: se parte de una suposición ingenua en UTC y se mide cuánto se
 * desvía esa misma marca al leerla en la zona destino. Esa diferencia es el
 * desplazamiento real de ese día concreto, así que el horario de verano queda
 * contemplado sin tablas ni dependencias.
 */
export function zonedDateToUtc(date: string, hour: number, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const guess = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  if (Number.isNaN(guess.getTime())) return null;

  try {
    const inZone = new Date(guess.toLocaleString("en-US", { timeZone }));
    const inUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
    return new Date(guess.getTime() - (inZone.getTime() - inUtc.getTime()));
  } catch {
    // Zona horaria inválida: mejor no programar que programar a deshora.
    return null;
  }
}

/** Solo tiene sentido programar hacia el futuro, con un margen mínimo. */
export function isSchedulable(when: Date | null): when is Date {
  return when !== null && when.getTime() > Date.now() + 60_000;
}
