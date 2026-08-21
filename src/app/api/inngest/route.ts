import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { generateContent } from "@/inngest/functions/generate-content";
import { publishDuePosts } from "@/inngest/functions/publish-due";
import { publishPost } from "@/inngest/functions/publish-post";
import { snapshotMetrics } from "@/inngest/functions/snapshot-metrics";

/**
 * Endpoint de la cola.
 *
 * Inngest firma cada petición y el SDK la verifica leyendo INNGEST_SIGNING_KEY
 * del entorno. Sin esa variable en producción cualquiera podría disparar jobs
 * que cuestan dinero, así que no la dejes vacía al desplegar.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateContent, publishPost, publishDuePosts, snapshotMetrics],
});
