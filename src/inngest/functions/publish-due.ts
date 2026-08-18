import { cron } from "inngest";
import { log } from "@/lib/logger";
import { adminClient } from "@/lib/supabase";
import { inngest } from "../client";

/**
 * Publica los posts programados que ya han vencido.
 *
 * Un barrido periódico en vez de un temporizador por post, a propósito:
 *
 *  - Si la aplicación estuvo caída a la hora exacta, el siguiente barrido lo
 *    recupera. Un temporizador perdido no vuelve.
 *  - Cancelar es cambiar un estado en la base, no localizar y matar un job.
 *  - Reprogramar es un UPDATE, no borrar y recrear.
 *
 * Cada 5 minutos: suficiente precisión para redes sociales, y poca carga.
 */
export const publishDuePosts = inngest.createFunction(
  { id: "publish-due-posts", triggers: [cron("*/5 * * * *")], retries: 1 },
  async ({ step }) => {
    const db = adminClient();

    const due = await step.run("buscar-vencidos", async () => {
      const { data, error } = await db
        .from("posts")
        .select("id, tenant_id, scheduled_platforms")
        .eq("status", "scheduled")
        .lte("scheduled_at", new Date().toISOString())
        .is("deleted_at", null)
        // Tope por barrido: si algo se acumula, se reparte entre ciclos en vez
        // de intentar publicar cientos de posts de golpe.
        .limit(50);

      if (error) throw new Error(error.message);
      return data ?? [];
    });

    if (due.length === 0) return { publicados: 0 };

    // Se marca ANTES de encolar. Si se hiciera después, el barrido siguiente
    // podría encontrarlos todavía como "scheduled" y encolarlos otra vez:
    // publicar dos veces es el fallo que ya nos costó tres posts en Instagram.
    const claimed = await step.run("reservar", async () => {
      const ids = due.map((p) => p.id);
      const { data, error } = await db
        .from("posts")
        .update({ status: "publishing", updated_at: new Date().toISOString() })
        .in("id", ids)
        .eq("status", "scheduled")
        .select("id");

      if (error) throw new Error(error.message);
      // Solo seguimos con los que hemos conseguido reservar: si otro barrido
      // se adelantó, su UPDATE no encontró la fila en estado "scheduled".
      return (data ?? []).map((p) => p.id);
    });

    for (const post of due.filter((p) => claimed.includes(p.id))) {
      const platforms = post.scheduled_platforms;

      if (platforms.length === 0) {
        await step.run(`sin-redes-${post.id}`, async () => {
          await db
            .from("posts")
            .update({ status: "failed", error: "No había redes seleccionadas." })
            .eq("id", post.id);
        });
        continue;
      }

      await step.sendEvent(`publicar-${post.id}`, {
        name: "post/publish.requested",
        data: { tenantId: post.tenant_id, postId: post.id, platforms },
      });
    }

    log.info("posts programados encolados", { encolados: claimed.length });
    return { publicados: claimed.length };
  },
);
