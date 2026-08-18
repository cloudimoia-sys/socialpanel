/**
 * El perfil de marca solo guarda un color de acento, no un "acento oscuro"
 * para degradados. Se deriva aquí en vez de guardar un segundo campo: así el
 * degradado siempre combina con el color real del cliente en vez de caer a un
 * azul fijo que desentonaría con una marca roja o verde.
 */
export function darken(hex: string, amount = 0.35): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return hex;

  const channel = (shift: number) =>
    Math.round(((num >> shift) & 255) * (1 - amount))
      .toString(16)
      .padStart(2, "0");

  return `#${channel(16)}${channel(8)}${channel(0)}`;
}
