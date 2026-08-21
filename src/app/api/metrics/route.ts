import { pastSnapshot, pctDelta } from "@/domain/metric-history";
import { run } from "@/lib/route";
import { requireCurrentTenant } from "@/lib/tenant";
import { credentialFor, publishProvider } from "@/providers/registry";

/**
 * Métricas de las redes conectadas del tenant.
 *
 * Se piden solo las redes que el tenant tiene conectadas de verdad, no la
 * lista fija de plataformas: preguntar por una red sin conectar gasta una
 * llamada para recibir un error garantizado.
 *
 * El aislamiento entre clientes lo da el propio identificador: el perfil de
 * Upload-Post ES el `tenant_id`, así que aquí nunca se puede consultar el
 * perfil de otro — no hay ningún parámetro de entrada que manipular.
 */
export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();

    const provider = publishProvider();
    const cred = await credentialFor(tenant.tenantId, "upload_post");

    const accounts = await provider.listAccounts(tenant.tenantId, cred);
    const platforms = accounts.map((a) => a.platform);

    const metrics = await provider.accountMetrics(tenant.tenantId, platforms, cred);

    // Variación real contra el histórico propio (metric_snapshots), no un
    // recálculo con datos de la propia llamada: la API de Upload-Post solo
    // da el total de hoy, así que "hace 30 días" solo existe si el cron
    // snapshot-metrics ya dejó un punto guardado ese día.
    const withDelta = await Promise.all(
      metrics.map(async (m) => {
        if (m.unavailable || m.impressions === null) {
          return { ...m, impressionsDeltaPct: null as number | null };
        }
        const past = await pastSnapshot(tenant.tenantId, m.platform, 30);
        return { ...m, impressionsDeltaPct: past ? pctDelta(m.impressions, past.impressions) : null };
      }),
    );

    return {
      metrics: withDelta.map((m) => ({
        ...m,
        handle: accounts.find((a) => a.platform === m.platform)?.handle ?? "",
      })),
    };
  });
}
