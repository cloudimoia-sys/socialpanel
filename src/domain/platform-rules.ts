/**
 * Restricciones por red social.
 *
 * Esta tabla es la que evita la mayoría de fallos en producción. Publicar es
 * fácil; lo que rompe es mandar un vídeo de 90 s a TikTok en 16:9 o un caption
 * de 3.000 caracteres a X. Se valida ANTES de gastar dinero generando el
 * contenido, no después de que la API lo rechace.
 */

export interface PlatformRules {
  captionMax: number;
  hashtagMax: number;
  supports: ("text" | "image" | "video")[];
  video?: { maxSeconds: number; aspectRatios: string[] };
  image?: { aspectRatios: string[]; maxBytes: number };
  /** Requiere que el archivo esté en una URL pública alcanzable por la plataforma. */
  requiresPublicUrl?: boolean;
  notes?: string;
}

const MB = 1024 * 1024;

export const LIMITS_BY_PLATFORM: Record<string, PlatformRules> = {
  instagram: {
    captionMax: 2200,
    hashtagMax: 30,
    supports: ["image", "video"],
    video: { maxSeconds: 90, aspectRatios: ["9:16", "1:1", "4:5"] },
    image: { aspectRatios: ["1:1", "4:5", "9:16"], maxBytes: 8 * MB },
    requiresPublicUrl: true,
    notes: "No admite publicaciones solo de texto.",
  },
  tiktok: {
    captionMax: 2200,
    hashtagMax: 20,
    supports: ["video", "image"],
    video: { maxSeconds: 600, aspectRatios: ["9:16"] },
    image: { aspectRatios: ["9:16", "1:1"], maxBytes: 20 * MB },
    notes: "Requiere verificación de dominio en el portal de desarrolladores.",
  },
  youtube: {
    captionMax: 5000,
    hashtagMax: 15,
    supports: ["video"],
    video: { maxSeconds: 60, aspectRatios: ["9:16"] },
    notes: "Shorts: 60 s como máximo y vertical.",
  },
  x: {
    captionMax: 280,
    hashtagMax: 5,
    supports: ["text", "image", "video"],
    video: { maxSeconds: 140, aspectRatios: ["16:9", "1:1", "9:16"] },
    image: { aspectRatios: ["16:9", "1:1", "4:5"], maxBytes: 5 * MB },
  },
  linkedin: {
    captionMax: 3000,
    hashtagMax: 10,
    supports: ["text", "image", "video"],
    video: { maxSeconds: 600, aspectRatios: ["16:9", "1:1", "9:16"] },
    image: { aspectRatios: ["16:9", "1:1", "4:5"], maxBytes: 10 * MB },
  },
  facebook: {
    captionMax: 5000,
    hashtagMax: 10,
    supports: ["text", "image", "video"],
    video: { maxSeconds: 240, aspectRatios: ["16:9", "1:1", "9:16"] },
    image: { aspectRatios: ["16:9", "1:1", "4:5"], maxBytes: 10 * MB },
  },
  threads: {
    captionMax: 500,
    hashtagMax: 1,
    supports: ["text", "image", "video"],
    video: { maxSeconds: 300, aspectRatios: ["9:16", "1:1"] },
    image: { aspectRatios: ["1:1", "4:5"], maxBytes: 8 * MB },
  },
  pinterest: {
    captionMax: 500,
    hashtagMax: 20,
    supports: ["image", "video"],
    image: { aspectRatios: ["2:3", "9:16"], maxBytes: 20 * MB },
  },
  bluesky: {
    captionMax: 300,
    hashtagMax: 5,
    supports: ["text", "image"],
    image: { aspectRatios: ["16:9", "1:1"], maxBytes: 1 * MB },
  },
};

export interface Violation {
  platform: string;
  reason: string;
}

/**
 * Comprueba un post contra cada plataforma destino.
 *
 * Devuelve las plataformas válidas y los motivos de descarte del resto, para
 * poder publicar en las que sí encajan en vez de fallar el lote entero.
 */
export function validateTargets(input: {
  platforms: string[];
  caption: string;
  hashtags: string[];
  media?: { kind: "image" | "video"; aspectRatio?: string; durationSeconds?: number; bytes?: number };
}): { valid: string[]; violations: Violation[] } {
  const valid: string[] = [];
  const violations: Violation[] = [];

  for (const platform of input.platforms) {
    const rules = LIMITS_BY_PLATFORM[platform];
    if (!rules) {
      violations.push({ platform, reason: "Plataforma no soportada." });
      continue;
    }

    const kind = input.media?.kind ?? "text";
    if (!rules.supports.includes(kind)) {
      violations.push({ platform, reason: `No admite contenido de tipo "${kind}".` });
      continue;
    }

    const fullLength = input.caption.length + input.hashtags.join(" #").length + 1;
    if (fullLength > rules.captionMax) {
      violations.push({
        platform,
        reason: `El texto ocupa ${fullLength} caracteres y el máximo es ${rules.captionMax}.`,
      });
      continue;
    }

    if (input.hashtags.length > rules.hashtagMax) {
      violations.push({ platform, reason: `Máximo ${rules.hashtagMax} hashtags.` });
      continue;
    }

    const media = input.media;
    if (media?.kind === "video" && rules.video) {
      if (media.durationSeconds && media.durationSeconds > rules.video.maxSeconds) {
        violations.push({
          platform,
          reason: `El vídeo dura ${media.durationSeconds}s y el máximo es ${rules.video.maxSeconds}s.`,
        });
        continue;
      }
      if (media.aspectRatio && !rules.video.aspectRatios.includes(media.aspectRatio)) {
        violations.push({
          platform,
          reason: `Formato ${media.aspectRatio} no admitido (usa ${rules.video.aspectRatios.join(", ")}).`,
        });
        continue;
      }
    }

    if (media?.kind === "image" && rules.image) {
      if (media.bytes && media.bytes > rules.image.maxBytes) {
        violations.push({
          platform,
          reason: `La imagen pesa más de ${Math.round(rules.image.maxBytes / MB)} MB.`,
        });
        continue;
      }
    }

    valid.push(platform);
  }

  return { valid, violations };
}
