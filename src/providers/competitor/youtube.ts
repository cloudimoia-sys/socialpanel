import { log } from "@/lib/logger";
import { serverEnv } from "@/lib/env";

/**
 * Únicos datos de competidores 100% automáticos: la API de datos de YouTube
 * es oficial, gratuita (cuota diaria) y no exige negociar acceso. El resto
 * de redes (TikTok, Instagram, LinkedIn) no tienen vía equivalente sin
 * scrapear —contra sus términos de servicio, y frágil— así que ahí el
 * seguimiento es manual (ver `domain/competitors.ts`).
 */

export interface ChannelStats {
  name: string;
  subscribers: number | null;
  videoCount: number | null;
  viewCount: number | null;
}

/** Acepta "@handle", una URL completa o el handle a secas. */
function normalizeHandle(input: string): string {
  const match = input.match(/@[\w.-]+/);
  if (match) return match[0];
  const trimmed = input.trim();
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

export class YouTubeCompetitors {
  readonly name = "youtube";

  get configured(): boolean {
    return Boolean(serverEnv().YOUTUBE_API_KEY);
  }

  async lookupChannel(input: string): Promise<ChannelStats | null> {
    const key = serverEnv().YOUTUBE_API_KEY;
    if (!key) return null;

    const handle = normalizeHandle(input);
    const url =
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics` +
      `&forHandle=${encodeURIComponent(handle)}&key=${key}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        log.warn("YouTube Data API respondió con error", { handle, status: res.status });
        return null;
      }
      const json = await res.json();
      const item = json.items?.[0];
      if (!item) return null;

      const stats = item.statistics ?? {};
      return {
        name: item.snippet?.title ?? handle,
        // Un canal puede ocultar su número de suscriptores; distinguirlo de
        // "cero suscriptores" importa tanto como en las métricas propias.
        subscribers: stats.hiddenSubscriberCount ? null : (Number(stats.subscriberCount) || null),
        videoCount: Number(stats.videoCount) || null,
        viewCount: Number(stats.viewCount) || null,
      };
    } catch (cause) {
      log.warn("no se pudo consultar el canal de YouTube", { handle, error: String(cause) });
      return null;
    }
  }
}

export const youtubeCompetitors = new YouTubeCompetitors();
