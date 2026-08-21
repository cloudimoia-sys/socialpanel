import { cron } from "inngest";
import { log } from "@/lib/logger";
import { adminClient } from "@/lib/supabase";
import { credentialFor, publishProvider } from "@/providers/registry";
import { inngest } from "../client";

/**
 * Guarda un punto diario por tenant/red con la métrica que Upload-Post
 * expone (un total móvil de "últimos 30 días", no un valor del día).
 *
 * Existe porque esa API no deja preguntar por una ventana pasada: solo da el
 * total DE HOY. Sin este histórico propio, "tu alcance subió un 8%" sería una
 * cifra inventada — con un punto por día, dentro de un mes se puede comparar
 * el total de hoy contra el de hace 30 días de verdad.
 *
 * Una vez al día basta: es un total de 30 días, no cambia hora a hora, y
 * correr más a menudo solo gastaría llamadas a Upload-Post sin aportar nada.
 */
export const snapshotMetrics = inngest.createFunction(
  { id: "snapshot-metrics", triggers: [cron("30 3 * * *")], retries: 1 },
  async ({ step }) => {
    const db = adminClient();

    const accounts = await step.run("cuentas-activas", async () => {
      const { data, error } = await db
        .from("social_accounts")
        .select("tenant_id, platform")
        .eq("status", "active");
      if (error) throw new Error(error.message);
      return data ?? [];
    });

    if (accounts.length === 0) return { guardados: 0, fallos: 0 };

    const today = new Date().toISOString().slice(0, 10);
    let guardados = 0;
    let fallos = 0;

    for (const { tenant_id: tenantId, platform } of accounts) {
      // Cada cuenta en su propio step: si Upload-Post falla o el token de UN
      // tenant caducó, ese punto se pierde por hoy pero el resto de la ronda
      // sigue — un fallo aislado no debe tumbar el histórico de todos.
      const ok = await step.run(`snapshot-${tenantId}-${platform}`, async () => {
        try {
          const cred = await credentialFor(tenantId, "upload_post");
          const [metrics] = await publishProvider().accountMetrics(tenantId, [platform], cred);

          if (!metrics || metrics.unavailable) return false;

          const { error } = await db.from("metric_snapshots").upsert(
            {
              tenant_id: tenantId,
              platform,
              snapshot_date: today,
              followers: metrics.followers,
              impressions: metrics.impressions,
              likes: metrics.likes,
              comments: metrics.comments,
              shares: metrics.shares,
            },
            { onConflict: "tenant_id,platform,snapshot_date" },
          );
          if (error) throw new Error(error.message);
          return true;
        } catch (cause) {
          log.warn("no se pudo guardar el snapshot de métricas", { tenantId, platform, cause });
          return false;
        }
      });

      if (ok) guardados += 1;
      else fallos += 1;
    }

    log.info("snapshot de métricas completado", { guardados, fallos, total: accounts.length });
    return { guardados, fallos };
  },
);
