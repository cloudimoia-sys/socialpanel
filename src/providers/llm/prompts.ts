import { LIMITS_BY_PLATFORM } from "@/domain/platform-rules";
import { AppError } from "@/lib/logger";
import type { CaptionRequest, NewsItem, PlanIdea, PlanRequest, StudioPiece, StudioRequest } from "../types";

/**
 * Prompts compartidos por todos los proveedores de texto.
 *
 * Viven aquí y no dentro de cada adaptador para que cambiar de modelo no
 * cambie la voz del producto: si el prompt estuviera duplicado, Claude y Gemini
 * escribirían distinto y el cliente lo notaría al cambiar de plan.
 */

export const CAPTION_SYSTEM = `Eres el redactor de redes sociales de un negocio concreto.
Escribes como escribiría ese negocio, no como una IA.

Prohibido: abrir con "¿Sabías que...?", "Descubre", "En el mundo de hoy" o
"¡No te lo pierdas!". Nada de emojis decorativos en cada línea ni de entusiasmo
de folleto. Frases cortas. Detalles concretos (precios, horarios, nombres) por
encima de adjetivos.

Si se te da una NOTICIA DE REFERENCIA, el comentario es tuyo: nunca resumas el
titular ni lo cites textualmente, y nunca inventes datos, cifras o detalles de
esa noticia que no estén en lo que se te da. No la uses de excusa para vender
el producto o servicio del negocio — es contenido de opinión que aporta valor
y posiciona al negocio como informado, no un anuncio disfrazado.

Devuelves SIEMPRE un único objeto JSON válido, sin markdown ni texto alrededor:
{"caption": string, "hashtags": string[], "perPlatform": {"<plataforma>": string}}

- "caption": versión base en el idioma pedido.
- "hashtags": entre 3 y 8, sin almohadilla, específicos del sector y la zona.
  Nada de #love #instagood.
- "perPlatform": una entrada por plataforma pedida, adaptada a su estilo y
  respetando su límite de caracteres.`;

export const PLAN_SYSTEM = `Eres el estratega de contenidos de un negocio concreto.
Propones ideas que ese negocio puede ejecutar de verdad, no campañas de marca
grande.

Cada idea debe ser accionable: algo que se pueda fotografiar, contar o anunciar
esta semana. Nada de "comparte tu historia de marca" ni "conecta con tu
audiencia".

Varía los formatos a lo largo del plan: producto, detrás de cámaras, cliente,
educativo, oferta, novedad, fecha señalada, actualidad del sector. No repitas
el mismo ángulo dos veces.

Si se te da una lista numerada de NOTICIAS DEL SECTOR, puedes usar COMO MUCHO
UNA para generar una idea de actualidad. Reglas estrictas para esa idea, sin
excepción:
- El comentario es tuyo, no un resumen de la noticia ni una cita textual.
- Nunca vende el producto o servicio del negocio a partir de la noticia. Es
  contenido de relleno que aporta valor y posiciona al negocio como informado
  del sector, no un anuncio disfrazado.
- "sourceIndex" debe ser el número exacto de esa noticia en la lista (1, 2,
  3...), nunca su URL ni su titular. Si ninguna noticia encaja de verdad con
  el negocio, no fuerces ninguna: pon "sourceIndex": 0.
- PROHIBIDO inventar una noticia, un estudio, un dato o una fuente que no esté
  en la lista proporcionada. Si no hay lista o ninguna sirve, todas las ideas
  son atemporales y "sourceIndex" es 0.

Devuelves SIEMPRE un único objeto JSON válido, sin markdown ni texto alrededor:
{"ideas": [{"idea": string, "headline": string, "rationale": string,
"visual": string, "suggestedPlatforms": string[],
"suggestedMedia": "none"|"image"|"video", "scheduledFor": "YYYY-MM-DD",
"sourceIndex": number}]}

- "idea": qué publicar, en una o dos frases concretas.
- "sourceIndex": el número de la noticia comentada según la lista numerada,
  o 0 si la idea no es de actualidad.
- "headline": el mismo mensaje en MENOS DE 60 CARACTERES, para ir superpuesto
  sobre la imagen. Directo y legible de un vistazo, sin punto final. No es un
  resumen de la idea: es lo que leería alguien pasando el dedo por el móvil.
- "rationale": por qué encaja con este negocio, en una frase.
- "scheduledFor": una fecha dentro del periodo, repartidas de forma regular.
- "visual": descripción de UNA FOTOGRAFÍA, en inglés, para un generador de
  imágenes. Reglas estrictas:
    * Describe una escena real fotografiable: personas, objetos, lugar, luz.
    * NUNCA describas un póster, infografía, cartel, gráfico, diagrama, collage,
      captura de pantalla ni nada con texto. El texto se añade después con
      tipografía real.
    * Nada de logos ni marcas comerciales.
    * Ejemplo correcto: "two colleagues reviewing paperwork at a desk in a small
      office, warm afternoon light, shallow depth of field, documentary style".
    * Ejemplo INCORRECTO: "infographic showing 4 signs your company outgrew
      Excel" — eso es un póster, no una foto.`;

export const STUDIO_SYSTEM = `Eres el redactor de redes sociales de un negocio concreto. A partir de UN
único brief, adaptas el mensaje al formato real de cada red — no es la misma
frase recortada, cada red tiene su propio texto pensado para cómo se consume
ahí.

Mismas prohibiciones que siempre: nada de "¿Sabías que...?", "Descubre" ni
entusiasmo de folleto. Frases cortas, detalles concretos por encima de
adjetivos. Cada pieza suena a este negocio, no a una IA genérica.

Devuelves SIEMPRE un único objeto JSON válido, sin markdown ni texto alrededor:
{"pieces": [{"platform": string, "copy": string, "script": string, "title": string,
"hashtags": string[], "cta": string}], "imageIdea": string, "videoIdea": string}

Una entrada en "pieces" por cada red pedida, con "platform" exactamente como
se te dio. Según la red:
- instagram, facebook, linkedin, threads, pinterest, bluesky, x: usa "copy"
  (el post completo, respetando el límite de caracteres de esa red) y deja
  "script" y "title" vacíos ("").
- tiktok: usa "script" (guion corto de vídeo: gancho de los primeros 2
  segundos, qué se dice o se muestra, cierre) y deja "copy" a modo de
  descripción breve para acompañar el vídeo. "title" vacío.
- youtube: usa "title" (menos de 70 caracteres, pensado para que hagan clic)
  y "copy" como descripción del vídeo. "script" vacío.

- "hashtags": entre 3 y 8 por red, sin almohadilla, específicos del sector.
- "cta": una llamada a la acción concreta para esa red (comentar, guardar,
  visitar la web, escribir por privado…), no genérica.
- "imageIdea": UNA descripción de foto real (no póster ni infografía) que
  sirva para todo el brief, en español, pensada para acompañar las piezas de
  imagen.
- "videoIdea": UNA idea de vídeo corto (qué se graba, en qué orden) que sirva
  de base común para tiktok/reels/shorts.`;

export function studioPrompt(req: StudioRequest): string {
  const limits = req.platforms
    .map((p) => `- ${p}: máximo ${LIMITS_BY_PLATFORM[p]?.captionMax ?? 2200} caracteres`)
    .join("\n");

  return [
    req.brand ? `CONTEXTO DEL NEGOCIO\n${req.brand}\n` : null,
    `Idioma: ${req.language}`,
    `Redes pedidas y sus límites:\n${limits}`,
    `\nBRIEF\n${req.brief}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseStudio(
  raw: string,
  platforms: string[],
): { pieces: StudioPiece[]; imageIdea: string; videoIdea: string } {
  const obj = cleanJson(raw) as { pieces?: unknown[]; imageIdea?: unknown; videoIdea?: unknown };
  if (!Array.isArray(obj.pieces)) {
    throw new AppError("El modelo no devolvió ningún contenido.", 502);
  }

  const byPlatform = new Map(
    obj.pieces.map((entry) => {
      const p = entry as Record<string, unknown>;
      return [String(p.platform ?? ""), p];
    }),
  );

  // Una pieza por red PEDIDA, en ese orden — si el modelo se salta una o
  // inventa una que no se pidió, la interfaz no debe mostrar un hueco raro
  // ni una red de más.
  const pieces = platforms.map((platform) => {
    const p = byPlatform.get(platform) ?? {};
    return {
      platform,
      copy: String(p.copy ?? ""),
      script: String(p.script ?? "") || undefined,
      title: String(p.title ?? "") || undefined,
      hashtags: Array.isArray(p.hashtags) ? p.hashtags.map(String) : [],
      cta: String(p.cta ?? ""),
    };
  });

  return {
    pieces,
    imageIdea: String(obj.imageIdea ?? ""),
    videoIdea: String(obj.videoIdea ?? ""),
  };
}

export function captionPrompt(req: CaptionRequest): string {
  const limits = req.platforms
    .map((p) => `- ${p}: máximo ${LIMITS_BY_PLATFORM[p]?.captionMax ?? 2200} caracteres`)
    .join("\n");

  return [
    req.brand ? `CONTEXTO DEL NEGOCIO\n${req.brand}\n` : null,
    `Idioma: ${req.language}`,
    req.tone ? `Tono para este post: ${req.tone}` : null,
    req.assetDescription ? `Contenido visual adjunto: ${req.assetDescription}` : null,
    req.news
      ? `NOTICIA DE REFERENCIA\n[${req.news.source}] ${req.news.title}\nURL: ${req.news.url}`
      : null,
    `Plataformas y límites:\n${limits}`,
    `\nQUÉ ANUNCIAR\n${req.brief}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function planPrompt(req: PlanRequest): string {
  const news =
    req.news && req.news.length > 0
      ? `NOTICIAS DEL SECTOR (usa como mucho una, referenciada por su número):\n` +
        req.news
          .map((n, idx) => `${idx + 1}. [${n.source}] ${n.title}\n   URL: ${n.url}`)
          .join("\n")
      : null;

  return [
    `CONTEXTO DEL NEGOCIO\n${req.brand}\n`,
    `Idioma: ${req.language}`,
    `Periodo: del ${req.periodStart} al ${req.periodEnd}`,
    `Redes disponibles: ${req.platforms.join(", ")}`,
    req.notes ? `Notas para esta tanda: ${req.notes}` : null,
    news,
    `\nPropón exactamente ${req.count} ideas distintas, repartidas por el periodo.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Los modelos a veces envuelven el JSON en un bloque de código. */
function cleanJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch (cause) {
    throw new AppError("Respuesta del modelo con formato inesperado.", 502, cause);
  }
}

export function parseCaption(raw: string): {
  caption: string;
  hashtags: string[];
  perPlatform: Record<string, string>;
} {
  const obj = cleanJson(raw) as Record<string, unknown>;
  return {
    caption: String(obj.caption ?? ""),
    hashtags: Array.isArray(obj.hashtags) ? obj.hashtags.map(String) : [],
    perPlatform:
      typeof obj.perPlatform === "object" && obj.perPlatform
        ? (obj.perPlatform as Record<string, string>)
        : {},
  };
}

/**
 * `news` es la misma lista, en el mismo orden, que se numeró en `planPrompt`.
 * El modelo referencia una noticia por su número (`sourceIndex`) en vez de
 * copiar su URL: las URLs de Google News son tokens opacos de cientos de
 * caracteres, y pedirle al modelo que los reproduzca letra a letra solo para
 * verificarlos después descartaba casi cualquier acierto por un desliz al
 * copiar. Un índice fuera de rango (o 0) se trata como "sin noticia": el
 * modelo no puede inventar una fuente que no esté en la lista real.
 */
export function parsePlan(raw: string, news: NewsItem[] = []): PlanIdea[] {
  const obj = cleanJson(raw) as { ideas?: unknown[] };
  if (!Array.isArray(obj.ideas)) {
    throw new AppError("El modelo no devolvió ninguna idea.", 502);
  }

  return obj.ideas.map((entry) => {
    const i = entry as Record<string, unknown>;
    const media = String(i.suggestedMedia ?? "none");
    const index = Number(i.sourceIndex);
    const article =
      Number.isInteger(index) && index >= 1 && index <= news.length
        ? news[index - 1]
        : undefined;

    return {
      idea: String(i.idea ?? ""),
      // Tope duro: un titular largo se encoge tanto al ajustarse que deja de
      // leerse de un vistazo, que es justo su única función.
      headline: String(i.headline ?? "").slice(0, 80),
      rationale: String(i.rationale ?? ""),
      visual: String(i.visual ?? ""),
      suggestedPlatforms: Array.isArray(i.suggestedPlatforms)
        ? i.suggestedPlatforms.map(String)
        : [],
      suggestedMedia: (["none", "image", "video"].includes(media) ? media : "none") as
        | "none"
        | "image"
        | "video",
      scheduledFor: typeof i.scheduledFor === "string" ? i.scheduledFor : null,
      sourceUrl: article?.url,
    };
  });
}
