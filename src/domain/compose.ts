import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { AppError, log } from "@/lib/logger";

/**
 * Composición de texto sobre la imagen generada.
 *
 * Por qué existe: ningún modelo de difusión sabe escribir. Aunque alguno
 * acierte las letras, elige él la tipografía y la posición, así que dos piezas
 * de la misma marca salen distintas. Aquí el modelo pone el fondo y nosotros
 * ponemos el texto con tipografía real: siempre correcto, siempre la misma
 * fuente, en cualquier idioma, y cambiarlo no cuesta regenerar nada.
 */

export type Template = "headline" | "band" | "corner";

export interface ComposeOptions {
  image: Buffer;
  text: string;
  /** Segunda línea opcional: precio, fecha, web. */
  subtext?: string;
  template: Template;
  /** Color de acento de la marca. */
  accent: string;
  textColor: string;
  fontFamily: string;
}

// -----------------------------------------------------------------------------
// Fuentes
// -----------------------------------------------------------------------------

let fontsReady = false;

/**
 * Registra las fuentes de `assets/fonts/`.
 *
 * En local hay fuentes del sistema, pero un contenedor de Linux no tiene
 * ninguna: si no se registra nada, el texto sale vacío en producción sin dar
 * error. Por eso la fuente se versiona con el proyecto.
 */
function ensureFonts(): void {
  if (fontsReady) return;

  const dir = path.join(process.cwd(), "assets", "fonts");
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (/\.(ttf|otf)$/i.test(file)) {
        GlobalFonts.registerFromPath(path.join(dir, file), path.parse(file).name);
      }
    }
  }

  if (GlobalFonts.families.length === 0) {
    log.error("no hay ninguna fuente disponible: el texto saldrá vacío");
  }

  fontsReady = true;
}

/**
 * La primera familia disponible de la lista, para no renderizar en blanco.
 *
 * Poppins va primero porque es la de `assets/fonts/` y la que se parece a la
 * marca; el resto son redes de seguridad para entornos donde falte.
 */
function resolveFont(preferred: string): string {
  ensureFonts();
  const available = new Set(GlobalFonts.families.map((f) => f.family));
  const candidates = [
    preferred,
    "Poppins-Bold",
    "Poppins-SemiBold",
    "Poppins",
    "Inter",
    "Segoe UI",
    "Arial",
    "DejaVu Sans",
  ];
  return candidates.find((c) => available.has(c)) ?? GlobalFonts.families[0]?.family ?? "sans-serif";
}

/** Peso ligero para subtítulos; cae al principal si no está disponible. */
function resolveLightFont(): string {
  ensureFonts();
  const available = new Set(GlobalFonts.families.map((f) => f.family));
  return ["Poppins-Regular", "Poppins-SemiBold", "Inter", "Segoe UI", "Arial"].find((c) =>
    available.has(c),
  ) ?? resolveFont("");
}

// -----------------------------------------------------------------------------
// Ajuste de texto
// -----------------------------------------------------------------------------

type Ctx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }

  return lines;
}

/**
 * Baja el cuerpo de letra hasta que el texto cabe en el espacio disponible.
 *
 * Preferimos texto más pequeño a texto recortado: una pieza con el titular
 * cortado a la mitad no se puede publicar, una con la letra algo menor sí.
 */
function fitText(
  ctx: Ctx,
  text: string,
  font: string,
  maxWidth: number,
  maxHeight: number,
  startSize: number,
): { lines: string[]; size: number; lineHeight: number } {
  for (let size = startSize; size >= 18; size -= 2) {
    ctx.font = `700 ${size}px "${font}"`;
    const lines = wrap(ctx, text, maxWidth);
    const lineHeight = size * 1.18;
    if (lines.length * lineHeight <= maxHeight) return { lines, size, lineHeight };
  }

  ctx.font = `700 18px "${font}"`;
  return { lines: wrap(ctx, text, maxWidth), size: 18, lineHeight: 18 * 1.18 };
}

// -----------------------------------------------------------------------------

export async function composeOverlay(options: ComposeOptions): Promise<Buffer> {
  const font = resolveFont(options.fontFamily);
  const lightFont = resolveLightFont();

  let image;
  try {
    image = await loadImage(options.image);
  } catch (cause) {
    throw new AppError("No se pudo leer la imagen para componer el texto.", 500, cause);
  }

  const width = image.width;
  const height = image.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(image, 0, 0, width, height);

  const pad = Math.round(width * 0.08);
  const maxWidth = width - pad * 2;

  if (options.template === "band") {
    drawBand(ctx, options, font, lightFont, width, height, pad, maxWidth);
  } else if (options.template === "corner") {
    drawCorner(ctx, options, font, lightFont, width, height, pad, maxWidth);
  } else {
    drawHeadline(ctx, options, font, lightFont, width, height, pad, maxWidth);
  }

  return canvas.toBuffer("image/png");
}

/**
 * Titular centrado sobre un velo oscuro.
 *
 * El velo no es decorativo: sin él, el texto blanco desaparece sobre las zonas
 * claras de la foto, y no sabemos qué foto va a generar el modelo.
 */
function drawHeadline(
  ctx: Ctx,
  o: ComposeOptions,
  font: string,
  lightFont: string,
  width: number,
  height: number,
  pad: number,
  maxWidth: number,
): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, width, height);

  const { lines, size, lineHeight } = fitText(
    ctx,
    o.text,
    font,
    maxWidth,
    height * 0.5,
    Math.round(width * 0.095),
  );

  const subSize = Math.round(size * 0.42);
  const subHeight = o.subtext ? subSize * 2.4 : 0;
  const totalHeight = lines.length * lineHeight + subHeight;
  let y = (height - totalHeight) / 2 + lineHeight * 0.8;

  ctx.textAlign = "center";
  ctx.fillStyle = o.textColor;
  ctx.font = `700 ${size}px "${font}"`;

  for (const line of lines) {
    ctx.fillText(line, width / 2, y);
    y += lineHeight;
  }

  if (o.subtext) {
    // Regla de acento bajo el titular: separa jerarquías sin añadir ruido.
    ctx.fillStyle = o.accent;
    ctx.fillRect(width / 2 - size * 0.6, y - lineHeight * 0.25, size * 1.2, Math.max(3, size * 0.05));

    ctx.font = `500 ${subSize}px "${lightFont}"`;
    ctx.fillStyle = o.textColor;
    ctx.fillText(o.subtext, width / 2, y + subSize * 1.3);
  }
}

/** Banda inferior sólida: la más legible, y la que mejor aguanta cualquier foto. */
function drawBand(
  ctx: Ctx,
  o: ComposeOptions,
  font: string,
  lightFont: string,
  width: number,
  height: number,
  pad: number,
  maxWidth: number,
): void {
  const { lines, size, lineHeight } = fitText(
    ctx,
    o.text,
    font,
    maxWidth,
    height * 0.28,
    Math.round(width * 0.07),
  );

  const subSize = Math.round(size * 0.45);
  const bandHeight = lines.length * lineHeight + pad * 1.6 + (o.subtext ? subSize * 1.8 : 0);
  const top = height - bandHeight;

  ctx.fillStyle = "rgba(9, 11, 14, 0.9)";
  ctx.fillRect(0, top, width, bandHeight);

  ctx.fillStyle = o.accent;
  ctx.fillRect(0, top, width, Math.max(4, height * 0.006));

  ctx.textAlign = "left";
  ctx.fillStyle = o.textColor;
  ctx.font = `700 ${size}px "${font}"`;

  let y = top + pad * 0.8 + lineHeight * 0.75;
  for (const line of lines) {
    ctx.fillText(line, pad, y);
    y += lineHeight;
  }

  if (o.subtext) {
    ctx.font = `500 ${subSize}px "${lightFont}"`;
    ctx.fillStyle = o.accent;
    ctx.fillText(o.subtext, pad, y + subSize * 0.3);
  }
}

/** Bloque superior izquierdo: deja ver la foto, para imágenes que valen por sí solas. */
function drawCorner(
  ctx: Ctx,
  o: ComposeOptions,
  font: string,
  lightFont: string,
  width: number,
  height: number,
  pad: number,
  maxWidth: number,
): void {
  const { lines, size, lineHeight } = fitText(
    ctx,
    o.text,
    font,
    maxWidth * 0.72,
    height * 0.34,
    Math.round(width * 0.075),
  );

  // Degradado en lugar de un rectángulo: el corte duro de una caja sobre una
  // foto se ve como un parche pegado.
  const gradient = ctx.createLinearGradient(0, 0, 0, height * 0.55);
  gradient.addColorStop(0, "rgba(9, 11, 14, 0.88)");
  gradient.addColorStop(1, "rgba(9, 11, 14, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height * 0.55);

  ctx.textAlign = "left";
  ctx.fillStyle = o.accent;
  ctx.fillRect(pad, pad, Math.max(4, width * 0.012), lines.length * lineHeight);

  ctx.fillStyle = o.textColor;
  ctx.font = `700 ${size}px "${font}"`;

  let y = pad + lineHeight * 0.78;
  const x = pad + Math.max(4, width * 0.012) + pad * 0.5;
  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }

  if (o.subtext) {
    const subSize = Math.round(size * 0.45);
    ctx.font = `500 ${subSize}px "${lightFont}"`;
    ctx.fillStyle = o.accent;
    ctx.fillText(o.subtext, x, y + subSize * 0.6);
  }
}
