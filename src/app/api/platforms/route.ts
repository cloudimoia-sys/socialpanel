import { LIMITS_BY_PLATFORM } from "@/domain/platform-rules";
import { log } from "@/lib/logger";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";
import { credentialFor, publishProvider } from "@/providers/registry";

/**
 * Redes conectadas del tenant, para los selectores.
 *
 * Lee de nuestra tabla, que es rápida y no depende de que la API de
 * Upload-Post responda. Solo si está vacía consulta en vivo: es el caso de
 * quien conectó sus cuentas y aún no ha pasado por la pantalla de Redes, y sin
 * ese respaldo vería un selector vacío teniendo cuentas.
 */
export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    const db = adminClient();

    const { data } = await db
      .from("social_accounts")
      .select("platform, handle, status")
      .eq("tenant_id", tenant.tenantId)
      .eq("status", "active");

    let accounts = data ?? [];

    if (accounts.length === 0) {
      try {
        const cred = await credentialFor(tenant.tenantId, "upload_post");
        const live = await publishProvider().listAccounts(tenant.tenantId, cred);

        if (live.length > 0) {
          await db.from("social_accounts").upsert(
            live.map((a) => ({
              tenant_id: tenant.tenantId,
              platform: a.platform,
              handle: a.handle,
              external_ref: a.externalRef,
              status: a.needsReauth ? ("expired" as const) : ("active" as const),
            })),
            { onConflict: "tenant_id,platform,external_ref" },
          );
          accounts = live
            .filter((a) => !a.needsReauth)
            .map((a) => ({ platform: a.platform, handle: a.handle, status: "active" as const }));
        }
      } catch (cause) {
        // Que falle la sincronización no debe romper el selector: se devuelve
        // lo que haya y el usuario puede ir a Redes a revisarlo.
        log.warn("no se pudo sincronizar redes en vivo", { error: String(cause) });
      }
    }

    // Solo las que sabemos publicar. Upload-Post soporta más redes de las que
    // tenemos reglas de formato, y ofrecer una sin reglas es publicar a ciegas.
    const platforms = accounts
      .filter((a) => a.platform in LIMITS_BY_PLATFORM)
      .map((a) => ({ platform: a.platform, handle: a.handle }));

    return { platforms };
  });
}
