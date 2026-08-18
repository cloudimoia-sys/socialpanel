/**
 * Detección del tipo real de un archivo por sus bytes de cabecera.
 *
 * No nos fiamos ni de la extensión ni del Content-Type que manda el navegador:
 * los dos los controla quien sube el archivo. Un .jpg puede ser cualquier cosa,
 * y "cualquier cosa" acaba servido desde nuestro dominio y enviado a las APIs
 * de las redes sociales.
 */

export interface DetectedType {
  mime: string;
  kind: "image" | "video";
  extension: string;
}

const startsWith = (buf: Uint8Array, bytes: number[], offset = 0) =>
  bytes.every((b, i) => buf[offset + i] === b);

export function detectType(buf: Uint8Array): DetectedType | null {
  // JPEG: FF D8 FF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    return { mime: "image/jpeg", kind: "image", extension: "jpg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", kind: "image", extension: "png" };
  }

  // WebP: "RIFF" ... "WEBP"
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { mime: "image/webp", kind: "image", extension: "webp" };
  }

  // ISO-BMFF (mp4 / mov): en el offset 4 va "ftyp", y la marca concreta después.
  if (startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...buf.slice(8, 12));
    if (brand === "qt  ") return { mime: "video/quicktime", kind: "video", extension: "mov" };
    return { mime: "video/mp4", kind: "video", extension: "mp4" };
  }

  return null;
}

/** 50 MB: es el tope del plan gratuito de Supabase Storage. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Extensión por tipo declarado, para nombrar el objeto al firmar la subida
 * directa (`/api/uploads/sign`). Es solo para elegir el nombre de archivo:
 * la validación real llega después, con `detectType` sobre los bytes ya
 * subidos a Storage — este mapa no sustituye esa comprobación.
 */
export const ALLOWED_UPLOAD_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};
