import { z } from "zod";
import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES } from "@/domain/file-types";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";

const bodySchema = z.object({
  mimeType: z.string().max(100),
  bytes: z.number().int().positive(),
});

/**
 * Primer paso de la subida: firma un hueco en Storage para que el navegador
 * suba el archivo directo, sin pasar por esta function.
 *
 * Vercel limita a 4.5 MB el cuerpo de una petición a una Serverless Function,
 * muy por debajo de los 50 MB que admitimos aquí. Antes el archivo entero
 * pasaba por `/api/uploads`; en producción eso da 413 con cualquier vídeo de
 * verdad. Con la URL firmada, el archivo va del navegador a Supabase Storage
 * directamente y solo el registro final (`/api/uploads/finalize`) toca esta
 * app — con los bytes reales ya en Storage, no en tránsito por aquí.
 *
 * El tipo y tamaño que se declaran aquí son solo para elegir la extensión del
 * objeto y descartar cuanto antes lo obviamente inválido: no sustituyen la
 * validación por bytes reales de `finalize`, porque esto lo manda el cliente
 * y nadie se fía de eso.
 */
export async function POST(request: Request) {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    await enforceRateLimit("upload", tenant.tenantId);

    const body = bodySchema.parse(await request.json());

    const extension = ALLOWED_UPLOAD_MIME[body.mimeType];
    if (!extension) throw new AppError("Formato no admitido. Usa JPG, PNG, WebP, MP4 o MOV.", 415);
    if (body.bytes > MAX_UPLOAD_BYTES) throw new AppError("El archivo supera los 50 MB.", 413);

    const path = `${tenant.tenantId}/uploads/${crypto.randomUUID()}.${extension}`;
    const { data, error } = await adminClient().storage.from("media").createSignedUploadUrl(path);

    if (error || !data) throw new AppError("No se pudo preparar la subida.", 500, error?.message);

    return { path: data.path, token: data.token };
  });
}
