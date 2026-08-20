import { z } from "zod";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { requireCurrentTenant } from "@/lib/tenant";
import { credentialFor, publishProvider } from "@/providers/registry";

/**
 * Bandeja de mensajes directos.
 *
 * Solo Instagram lo soporta hoy (comprobado contra la API real, no supuesto):
 * el proveedor ya devuelve una lista vacía para el resto sin que haga falta
 * que esta ruta sepa distinguir redes.
 */
export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    const cred = await credentialFor(tenant.tenantId, "upload_post");
    const conversations = await publishProvider().listConversations(tenant.tenantId, cred);
    return { conversations };
  });
}

const sendSchema = z.object({
  platform: z.string().min(1).max(40),
  recipientId: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
});

export async function POST(request: Request) {
  return run(async () => {
    const body = sendSchema.parse(await request.json());
    const tenant = await requireCurrentTenant();
    // Cubo de publicación: mandar un DM es una acción que sale de verdad
    // hacia un cliente real, igual de sensible al abuso que publicar un post.
    await enforceRateLimit("publish", tenant.tenantId);

    const cred = await credentialFor(tenant.tenantId, "upload_post");

    try {
      await publishProvider().sendMessage(
        tenant.tenantId,
        body.platform,
        body.recipientId,
        body.message,
        cred,
      );
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw new AppError("No se pudo enviar el mensaje.", 502, cause);
    }

    return { ok: true };
  });
}
