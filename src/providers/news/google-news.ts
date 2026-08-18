import { log } from "@/lib/logger";

/**
 * Actualidad del sector, desde el RSS público de Google News.
 *
 * Por qué esta fuente y no que el modelo "recuerde" noticias: un modelo al que
 * le preguntas qué hay nuevo se lo inventa, y publicar una noticia falsa con la
 * marca de un cliente es el peor fallo que puede cometer este producto. Aquí
 * los titulares vienen de medios reales, con enlace y fecha comprobables.
 *
 * Gratis y sin clave, a diferencia del anclaje en búsqueda de Gemini, que
 * exige facturación activada.
 *
 * Solo se usan titular, medio, fecha y enlace. El texto del artículo no se
 * copia: el post es comentario propio que enlaza a la fuente.
 */

export interface Article {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

const FEED = "https://news.google.com/rss/search";

function extract(block: string, tag: string): string | undefined {
  const m = block.match(
    new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`),
  );
  return m?.[1]?.trim();
}

/** Los titulares de Google News acaban en " - Medio"; sobra al citarlos. */
function cleanTitle(title: string, source: string): string {
  const suffix = ` - ${source}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

export class GoogleNews {
  readonly name = "google_news";

  async search(
    topic: string,
    { language = "es", country = "ES", maxAgeDays = 21, limit = 6 } = {},
  ): Promise<Article[]> {
    const url =
      `${FEED}?q=${encodeURIComponent(topic)}` +
      `&hl=${language}&gl=${country}&ceid=${country}:${language}`;

    let xml: string;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SocialPanel/1.0)" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (cause) {
      // Sin actualidad se generan ideas igualmente: es un extra, no un
      // requisito. Bloquear el plan entero por un feed caído sería peor.
      log.warn("no se pudo leer la actualidad", { topic, error: String(cause) });
      return [];
    }

    const cutoff = Date.now() - maxAgeDays * 86_400_000;

    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .map((m) => {
        const block = m[1] ?? "";
        const source = extract(block, "source") ?? "";
        const title = extract(block, "title") ?? "";
        return {
          title: cleanTitle(title, source),
          url: extract(block, "link") ?? "",
          source,
          publishedAt: extract(block, "pubDate") ?? "",
        };
      })
      .filter((a) => {
        if (!a.title || !a.url) return false;
        const at = Date.parse(a.publishedAt);
        // Una noticia de hace meses no es actualidad: publicarla como novedad
        // deja al cliente en evidencia.
        return !Number.isNaN(at) && at >= cutoff;
      })
      .slice(0, limit);
  }

  /** Une varios temas y reparte el cupo entre ellos. */
  async searchMany(topics: string[], limitPerTopic = 4): Promise<Article[]> {
    const results = await Promise.all(
      topics.slice(0, 4).map((t) => this.search(t, { limit: limitPerTopic })),
    );

    const seen = new Set<string>();
    return results.flat().filter((a) => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });
  }
}

export const news = new GoogleNews();
