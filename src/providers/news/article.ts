import { log } from "@/lib/logger";
import type { NewsItem } from "../types";

/**
 * Noticia elegida a mano por el operador, en vez de la búsqueda automática
 * por tema (ver `google-news.ts`). El titular nunca se toma de lo que mande
 * el cliente: se vuelve a descargar la página aquí y se extrae de verdad, así
 * que un titular falso pegado a mano no puede colarse como si fuera real.
 */

const PRIVATE_HOST = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01]?)\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1$|\[::1\]$)/i;

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function extractMeta(html: string, property: string): string | undefined {
  // El orden de los atributos varía según el sitio: property/content o content/property.
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

export async function fetchArticle(rawUrl: string): Promise<NewsItem | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  // Solo páginas públicas de verdad: nada de que el servidor acabe pidiéndose
  // a sí mismo o a la red interna porque alguien pegó una URL rara.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (PRIVATE_HOST.test(url.hostname)) return null;

  let html: string;
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SocialPanel/1.0)" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (cause) {
    log.warn("no se pudo leer la noticia manual", { url: url.toString(), error: String(cause) });
    return null;
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = extractMeta(html, "og:title") ?? titleTag;
  if (!title) return null;

  const source = extractMeta(html, "og:site_name") ?? url.hostname.replace(/^www\./, "");

  return {
    title: decodeEntities(title).trim().slice(0, 200),
    url: url.toString(),
    source: decodeEntities(source).trim(),
    publishedAt: extractMeta(html, "article:published_time") ?? "",
  };
}
