import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { AppError, log } from "@/lib/logger";
import { FONT_FAMILIES } from "./fonts";

export type { FontFamily } from "./fonts";
export { FONT_FAMILIES } from "./fonts";

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

/**
 * Una diapositiva de carrusel.
 *
 * No lleva imagen: el carrusel se dibuja entero con tipografía sobre un fondo
 * de marca. Es lo que hace que salga gratis y al instante, frente a generar
 * seis imágenes con IA — y además garantiza que las seis parezcan de la misma
 * marca, cosa que seis llamadas a un modelo no garantizan.
 */
export interface Slide {
  /** Etiqueta pequeña arriba: "El problema", "Lo que pasó"… */
  kicker?: string;
  /** Titular. Lo que vaya *entre asteriscos* se resalta sobre el color de acento. */
  title: string;
  /** Párrafo de apoyo, opcional. */
  body?: string;
}

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
  /** Logo del negocio, si lo ha subido. Nunca bloquea la pieza si falla. */
  logo?: Buffer;
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
 * Resuelve la pareja de pesos de una familia.
 *
 * Antes había dos funciones sueltas y la del peso ligero estaba fijada a
 * Poppins, así que un cliente que eligiera Playfair tenía titulares Playfair
 * con el cuerpo en Poppins. Resolviendo la familia entera de una vez, los dos
 * pesos vienen siempre del mismo sitio.
 *
 * Las familias de un solo peso (Anton, Bebas Neue, Archivo Black, Pacifico)
 * caen a su único archivo para ambos: ya son pesadas de por sí.
 */
function resolveFamily(preferred: string): { bold: string; regular: string; script: boolean } {
  ensureFonts();
  const available = new Set(GlobalFonts.families.map((f) => f.family));

  // Tolera valores antiguos como "Poppins-Bold": el campo guardaba el archivo
  // y ahora guarda la familia, y no merece una migración romper las piezas.
  const base = (preferred || "Poppins").replace(/-(Bold|SemiBold|Regular|Medium|Light)$/i, "");
  const pick = (...candidates: string[]) => candidates.find((c) => available.has(c));

  const fallback = GlobalFonts.families[0]?.family ?? "sans-serif";
  const entry = FONT_FAMILIES.find((f) => f.id === base);

  return {
    bold:
      pick(`${base}-Bold`, `${base}-SemiBold`, `${base}-Regular`, base, "Poppins-Bold", "Arial") ??
      fallback,
    regular:
      pick(`${base}-Regular`, `${base}-Bold`, base, "Poppins-Regular", "Arial") ?? fallback,
    script: entry?.script === true,
  };
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
// Carrusel
// -----------------------------------------------------------------------------

interface Word {
  text: string;
  highlight: boolean;
}

/**
 * Parte el titular en palabras marcando cuáles van resaltadas.
 *
 * Se trocea antes de medir, y no se mide el texto con los asteriscos dentro,
 * porque esos dos caracteres ensanchan la línea lo justo para que el ajuste
 * automático parta donde no toca.
 */
function parseWords(text: string): Word[] {
  const words: Word[] = [];

  for (const [index, chunk] of text.split("*").entries()) {
    // Los trozos impares son los que estaban entre asteriscos.
    const highlight = index % 2 === 1;
    for (const word of chunk.split(/\s+/).filter(Boolean)) {
      words.push({ text: word, highlight });
    }
  }

  return words;
}

/** Reparte las palabras en líneas que quepan en `maxWidth`. */
function wrapWords(ctx: Ctx, words: Word[], maxWidth: number): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  let width = 0;
  const space = ctx.measureText(" ").width;

  for (const word of words) {
    const wordWidth = ctx.measureText(word.text).width;
    const needed = line.length === 0 ? wordWidth : width + space + wordWidth;

    if (needed > maxWidth && line.length > 0) {
      lines.push(line);
      line = [word];
      width = wordWidth;
    } else {
      line.push(word);
      width = needed;
    }
  }

  if (line.length > 0) lines.push(line);
  return lines;
}

/** Baja el cuerpo hasta que el titular cabe, igual que `fitText` pero con resaltados. */
function fitWords(
  ctx: Ctx,
  words: Word[],
  font: string,
  maxWidth: number,
  maxHeight: number,
  startSize: number,
): { lines: Word[][]; size: number; lineHeight: number } {
  for (let size = startSize; size >= 24; size -= 2) {
    ctx.font = `700 ${size}px "${font}"`;
    const lines = wrapWords(ctx, words, maxWidth);
    const lineHeight = size * 1.1;
    if (lines.length * lineHeight <= maxHeight) return { lines, size, lineHeight };
  }

  ctx.font = `700 24px "${font}"`;
  return { lines: wrapWords(ctx, words, maxWidth), size: 24, lineHeight: 24 * 1.1 };
}

export interface ComposeSlideOptions {
  slide: Slide;
  /** Empieza en 0. Se usa para numerar y para saber si es la portada. */
  index: number;
  total: number;
  accent: string;
  background: string;
  textColor: string;
  mutedColor: string;
  fontFamily: string;
  /** Marca o web, en el pie. */
  footer?: string;
  /** 4:5 ocupa más alto en el muro que 1:1, así que rinde mejor. */
  ratio?: "1:1" | "4:5";
  /**
   * Logo del negocio, si lo ha subido. Abajo a la derecha y no arriba: esa
   * esquina la ocupa ya la numeración "X/Y" de la diapositiva.
   */
  logo?: Buffer;
}

/**
 * Dibuja una diapositiva completa.
 *
 * El tamaño es fijo (1080 de ancho) porque es el que piden las redes y porque
 * componer a resolución final evita reescalados que emborronan la tipografía.
 */
export async function composeSlide(options: ComposeSlideOptions): Promise<Buffer> {
  const { bold: font, regular: lightFont, script } = resolveFamily(options.fontFamily);

  // Las manuscritas en versales son ilegibles: la ele mayuscula de Pacifico se
  // confunde con una ce. Se dejan tal cual las escribio el cliente.
  const cased = (text: string) => (script ? text : text.toUpperCase());

  const width = 1080;
  const height = options.ratio === "1:1" ? 1080 : 1350;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, width, height);

  const pad = Math.round(width * 0.085);
  const maxWidth = width - pad * 2;

  // --- Cabecera: etiqueta y numeración -------------------------------------
  const kickerSize = Math.round(width * 0.032);
  ctx.font = `700 ${kickerSize}px "${lightFont}"`;
  ctx.textAlign = "left";

  if (options.slide.kicker) {
    ctx.fillStyle = options.accent;
    ctx.fillText(cased(options.slide.kicker), pad, pad + kickerSize);
  }

  if (options.total > 1) {
    ctx.textAlign = "right";
    ctx.fillStyle = options.mutedColor;
    ctx.fillText(`${options.index + 1}/${options.total}`, width - pad, pad + kickerSize);
    ctx.textAlign = "left";
  }

  // --- Titular --------------------------------------------------------------
  const words = parseWords(options.slide.title);
  // La portada manda más grande: es la única que se ve sin deslizar, así que
  // es la que decide si alguien sigue mirando.
  const startSize = Math.round(width * (options.index === 0 ? 0.115 : 0.092));
  const { lines, size, lineHeight } = fitWords(
    ctx,
    words,
    font,
    maxWidth,
    height * (options.slide.body ? 0.42 : 0.6),
    startSize,
  );

  // El cuerpo se mide ANTES de dibujar nada: para centrar el bloque hay que
  // conocer su altura total, y eso incluye el párrafo.
  const bodySize = Math.round(size * 0.4);
  const bodyLineHeight = bodySize * 1.45;
  let bodyLines: string[] = [];

  if (options.slide.body) {
    ctx.font = `500 ${bodySize}px "${lightFont}"`;
    bodyLines = wrap(ctx, options.slide.body, maxWidth);
  }

  const gap = bodyLines.length > 0 ? bodySize * 1.6 : 0;
  const blockHeight = lines.length * lineHeight + gap + bodyLines.length * bodyLineHeight;

  // Centrado en el hueco entre la cabecera y el pie. Alineado arriba dejaba
  // media diapositiva vacía cuando el texto era corto, que es casi siempre.
  //
  // Reparte el aire sobrante 42/58 y no a la mitad: el centro óptico está por
  // encima del geométrico, y clavado al centro exacto el bloque parece caído.
  const areaTop = pad + kickerSize * 2.8;
  const areaBottom = height - pad - kickerSize * 3.4;
  const slack = Math.max(0, areaBottom - areaTop - blockHeight);
  let y = areaTop + slack * 0.42 + lineHeight * 0.78;

  ctx.font = `700 ${size}px "${font}"`;
  const space = ctx.measureText(" ").width;

  for (const line of lines) {
    // Posiciones primero, dibujo después: hace falta saber dónde acaba cada
    // palabra para poder pintar un único recuadro bajo las que van seguidas.
    const placed: { word: Word; x: number; width: number }[] = [];
    let x = pad;

    for (const word of line) {
      const wordWidth = ctx.measureText(word.text).width;
      placed.push({ word, x, width: wordWidth });
      x += wordWidth + space;
    }

    // Altura del recuadro a partir de las métricas REALES de esta línea, no de
    // proporciones fijas: cada familia tiene ascendentes distintos y unas
    // constantes calibradas para Poppins recortaban las letras altas de Anton.
    // Se mide la línea entera para que todos los recuadros midan igual.
    const lineMetrics = ctx.measureText(line.map((w) => w.text).join(" "));
    const ascent = lineMetrics.actualBoundingBoxAscent || size * 0.72;
    const descent = lineMetrics.actualBoundingBoxDescent || size * 0.2;
    const boxPad = size * 0.13;

    // Un recuadro por RACHA de palabras resaltadas, no por palabra: una caja
    // por palabra deja una costura visible entre ellas y se lee como dos
    // etiquetas sueltas en vez de una frase destacada.
    let i = 0;
    while (i < placed.length) {
      if (!placed[i]!.word.highlight) {
        i += 1;
        continue;
      }

      let end = i;
      while (end + 1 < placed.length && placed[end + 1]!.word.highlight) end += 1;

      const from = placed[i]!.x;
      const to = placed[end]!.x + placed[end]!.width;

      ctx.fillStyle = options.accent;
      ctx.fillRect(
        from - boxPad,
        y - ascent - boxPad,
        to - from + boxPad * 2,
        ascent + descent + boxPad * 2,
      );

      i = end + 1;
    }

    for (const { word, x: wordX } of placed) {
      // Sobre el acento se escribe con el color de fondo, que es el que
      // contrasta con él por construcción.
      ctx.fillStyle = word.highlight ? options.background : options.textColor;
      ctx.fillText(word.text, wordX, y);
    }

    y += lineHeight;
  }

  // --- Cuerpo ---------------------------------------------------------------
  if (bodyLines.length > 0) {
    ctx.font = `500 ${bodySize}px "${lightFont}"`;
    ctx.fillStyle = options.mutedColor;

    let by = y - lineHeight + gap + bodySize;
    for (const line of bodyLines) {
      ctx.fillText(line, pad, by);
      by += bodyLineHeight;
    }
  }

  // --- Pie ------------------------------------------------------------------
  const ruleY = height - pad - kickerSize * 1.6;
  ctx.fillStyle = options.accent;
  ctx.fillRect(pad, ruleY, width * 0.11, Math.max(4, width * 0.007));

  if (options.footer) {
    ctx.font = `700 ${Math.round(kickerSize * 0.85)}px "${lightFont}"`;
    ctx.fillStyle = options.mutedColor;
    ctx.fillText(cased(options.footer), pad, height - pad);
  }

  if (options.logo) {
    try {
      await drawLogo(ctx, options.logo, width, height, pad, "bottom-right");
    } catch (cause) {
      log.warn("no se pudo componer el logo en la diapositiva", { error: String(cause) });
    }
  }

  return canvas.toBuffer("image/png");
}

// -----------------------------------------------------------------------------

export async function composeOverlay(options: ComposeOptions): Promise<Buffer> {
  const { bold: font, regular: lightFont } = resolveFamily(options.fontFamily);

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

  // Después de la plantilla y no antes: siempre encima del velo o la banda,
  // nunca tapado por ellos. Un logo que falla no debe tirar la pieza entera
  // — ya está pagada la generación de la imagen de fondo.
  if (options.logo) {
    try {
      await drawLogo(ctx, options.logo, width, height, pad, "top-right");
    } catch (cause) {
      log.warn("no se pudo componer el logo", { error: String(cause) });
    }
  }

  return canvas.toBuffer("image/png");
}

/**
 * Insignia del logo en la esquina superior derecha.
 *
 * Ese hueco queda libre en las tres plantillas: `headline` centra el texto,
 * `band` lo deja abajo, y `corner` lo pone arriba a la IZQUIERDA — las tres
 * dejan la esquina superior derecha sin nada encima.
 *
 * La placa semitransparente detrás no es decorativa: un logo sin fondo propio
 * (PNG transparente, o claro) desaparecería sobre una foto clara, igual que
 * el velo de `drawHeadline` existe para que el texto blanco no desaparezca.
 */
async function drawLogo(
  ctx: Ctx,
  logo: Buffer,
  width: number,
  height: number,
  pad: number,
  corner: "top-right" | "bottom-right" = "top-right",
): Promise<void> {
  const image = await loadImage(logo);

  const badge = Math.round(width * 0.11);
  const plate = Math.round(badge * 1.35);
  const x = width - pad - plate;
  const y = corner === "top-right" ? pad * 0.6 : height - pad * 0.6 - plate;

  ctx.fillStyle = "rgba(9, 11, 14, 0.55)";
  ctx.fillRect(x, y, plate, plate);

  // El logo puede no ser cuadrado: se ajusta al hueco conservando su
  // proporción real en vez de deformarlo para llenar la placa.
  const ratio = image.width / image.height;
  const inner = plate - Math.round(plate * 0.22);
  const [dw, dh] = ratio > 1 ? [inner, inner / ratio] : [inner * ratio, inner];
  const dx = x + (plate - dw) / 2;
  const dy = y + (plate - dh) / 2;

  ctx.drawImage(image, dx, dy, dw, dh);
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
