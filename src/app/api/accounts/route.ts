import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";
import { credentialFor, publishProvider } from "@/providers/registry";

/**
 * Cuentas conectadas del tenant.
 *
 * La fuente de verdad es Upload-Post; aquí sincronizamos a `social_accounts`
 * para poder mostrarlas sin depender de que su API responda en cada carga.
 */
export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();

    const cred = await credentialFor(tenant.tenantId, "upload_post");
    const accounts = await publishProvider().listAccounts(tenant.tenantId, cred);

    const db = adminClient();

    if (accounts.length > 0) {
      await db.from("social_accounts").upsert(
        accounts.map((a) => ({
          tenant_id: tenant.tenantId,
          platform: a.platform,
          handle: a.handle,
          external_ref: a.externalRef,
          status: a.needsReauth ? ("expired" as const) : ("active" as const),
        })),
        { onConflict: "tenant_id,platform,external_ref" },
      );
    }

    return {
      accounts: accounts.map((a) => ({
        platform: a.platform,
        handle: a.handle,
        needsReauth: a.needsReauth ?? false,
      })),
    };
  });
}
