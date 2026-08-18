import { z } from "zod";
import { MAX_UPLOAD_BYTES, detectType } from "@/domain/file-types";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";

const bodySchema = z.object({ path: z.string().min(1).max(300) });

/**
 * Segundo paso: el archivo ya está en Storage, subido directo desde el
 * navegador con la URL de `/api/uploads/sign`. Aquí se valida de verdad —
 * igual que hacía la subida antigua de un solo paso, solo que ahora los bytes
 * ya estaban en Storage en vez de venir en el cuerpo de esta petición.
 *
 * Ni la extensión del nombre ni el tipo declarado al firmar bastan: se
 * vuelve a descargar el objeto y se sniffean sus bytes reales. Si no
 * corresponden a un formato admitido, se borra — no se deja un archivo
 * huérfano y sin validar ocupando el bucket.
 */
export async function POST(request: Request) {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    await enforceRateLimit("upload", tenant.tenantId);

    const { path } = bodySchema.parse(await request.json());

    // El path lo generó `/sign` con el tenant delante: si no encaja, no es
    // una subida nuestra y no se toca.
    if (!path.startsWith(`${tenant.tenantId}/uploads/`)) {
      throw new AppError("Ruta de subida inválida.", 400);
    }

    const db = adminClient();
    const { data: file, error: downloadError } = await db.storage.from("media").download(path);

    if (downloadError || !file) {
      throw new AppError("No encontramos el archivo subido. Inténtalo de nuevo.", 404);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
      await db.storage.from("media").remove([path]);
      throw new AppError("El archivo supera los 50 MB.", 413);
    }

    const detected = detectType(bytes.slice(0, 32));
    if (!detected) {
      await db.storage.from("media").remove([path]);
      throw new AppError("Formato no admitido. Usa JPG, PNG, WebP, MP4 o MOV.", 415);
    }

    const { data, error } = await db
      .from("assets")
      .insert({
        tenant_id: tenant.tenantId,
        kind: detected.kind,
        origin: "upload",
        storage_path: path,
        mime_type: detected.mime,
        bytes: bytes.byteLength,
      })
      .select("id")
      .single();

    if (error || !data) {
      // Si no podemos registrarlo, no dejamos el archivo huérfano en storage.
      await db.storage.from("media").remove([path]);
      throw new AppError("No se pudo registrar el archivo.", 500, error?.message);
    }

    return { id: data.id, kind: detected.kind, mime: detected.mime, bytes: bytes.byteLength };
  });
}
