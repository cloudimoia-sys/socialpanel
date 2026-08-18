import { assertNetworkQuota } from "@/domain/quota";
import { serverEnv } from "@/lib/env";
import { run } from "@/lib/route";
import { requireCurrentTenant, requireTenantRole } from "@/lib/tenant";
import { credentialFor, publishProvider } from "@/providers/registry";

/**
 * Devuelve la URL alojada donde el cliente conecta sus redes por OAuth.
 *
 * El `redirect_url` se construye en el servidor a partir de APP_URL y nunca se
 * acepta del cliente: si lo aceptara, sería un open redirect por el que sacar
 * al usuario del flujo hacia un dominio de terceros.
 */
export async function POST() {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    // Cada perfil conectado nos cuesta dinero en Upload-Post, así que el plan
    // decide cuántas redes caben.
    await assertNetworkQuota(tenant.tenantId);

    const cred = await credentialFor(tenant.tenantId, "upload_post");
    const url = await publishProvider().connectUrl(
      tenant.tenantId,
      `${serverEnv().APP_URL}/dashboard/accounts?connected=1`,
      cred,
    );

    return { url };
  });
}
