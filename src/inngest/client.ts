import { Inngest, eventType } from "inngest";
import { z } from "zod";

/**
 * La cola no es opcional: generar un vídeo tarda entre 1 y 5 minutos, lo que
 * no cabe en un request HTTP ni en una serverless function. Todo lo que llame
 * a un modelo pasa por aquí.
 *
 * Los eventos se declaran con `eventType` + esquema zod, así que el payload se
 * valida también al entrar en la cola, no solo en el endpoint HTTP.
 */

/**
 * Texto superpuesto con tipografía real.
 *
 * Va aquí y no dentro del prompt de imagen a propósito: el modelo genera el
 * fondo, nosotros ponemos el texto. Ningún modelo de difusión escribe bien, y
 * aunque acertara elegiría él la tipografía.
 */
// `template` va sin `.default()` a propósito: Inngest rechaza esquemas cuyo
// tipo de entrada y salida difieran, y un default es exactamente eso. El valor
// por defecto lo pone quien construye el evento.
export const overlaySpec = z.object({
  text: z.string().min(2).max(120),
  subtext: z.string().max(80).optional(),
  template: z.enum(["headline", "band", "corner"]),
});

/**
 * Infograma renderizado con código (Remotion), no con un modelo generativo.
 *
 * Existe porque ningún modelo de vídeo renderiza texto de forma fiable — el
 * mismo problema que ya resolvimos en imagen con el compositor, pero aquí no
 * hay ni fondo generado: todo el vídeo es texto y datos, así que directamente
 * evitamos el modelo. Coste: cómputo local, cero llamadas a APIs de pago.
 */
export const infographicSpec = z.object({
  mode: z.literal("generate-infographic"),
  title: z.string().min(2).max(120),
  stat1Value: z.string().min(1).max(12),
  stat1Label: z.string().min(1).max(40),
  stat2Value: z.string().min(1).max(12),
  stat2Label: z.string().min(1).max(40),
  footer: z.string().min(1).max(60),
});

export const mediaSpec = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({
    mode: z.literal("generate-image"),
    prompt: z.string().min(3).max(1500),
    aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]),
    overlay: overlaySpec.optional(),
  }),
  z.object({
    mode: z.literal("generate-video"),
    prompt: z.string().min(3).max(1500),
    // Tope duro: cada segundo de vídeo cuesta dinero real.
    durationSeconds: z.number().int().min(3).max(10),
    aspectRatio: z.enum(["9:16", "1:1", "16:9"]),
    sourceAssetId: z.string().uuid().optional(),
  }),
  infographicSpec,
  z.object({
    mode: z.literal("existing"),
    assetId: z.string().uuid(),
    overlay: overlaySpec.optional(),
  }),
]);

export type MediaSpec = z.infer<typeof mediaSpec>;

/** Noticia real ya verificada (ver `providers/news/article.ts`), no lo que mandó el cliente sin comprobar. */
const newsItemSpec = z.object({
  title: z.string(),
  url: z.string(),
  source: z.string(),
  publishedAt: z.string(),
});

export const generateRequested = eventType("post/generate.requested", {
  schema: z.object({
    tenantId: z.string().uuid(),
    postId: z.string().uuid(),
    brief: z.string().min(5).max(4000),
    platforms: z.array(z.string()).min(1).max(9),
    language: z.string().min(2).max(20),
    tone: z.string().max(100).optional(),
    media: mediaSpec,
    news: newsItemSpec.optional(),
  }),
});

export const publishRequested = eventType("post/publish.requested", {
  schema: z.object({
    tenantId: z.string().uuid(),
    postId: z.string().uuid(),
    platforms: z.array(z.string()).min(1).max(9),
  }),
});

/**
 * `isDev` explícito: en desarrollo el SDK habla con el dev server local
 * (localhost:8288) y no necesita clave. Sin esto busca INNGEST_EVENT_KEY y falla
 * al encolar. En producción vuelve al comportamiento normal con clave.
 */
export const inngest = new Inngest({
  id: "socialpanel",
  isDev: process.env.NODE_ENV !== "production",
});
