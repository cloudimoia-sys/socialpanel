import { z } from "zod";
import { assertModule } from "@/domain/quota";
import { requireSearchConsoleToken } from "@/domain/seo";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";
import { performance } from "@/providers/seo/search-console";

/**
 * Rendimiento en Google de una de las webs del cliente.
 *
 * Cuatro consultas a Search Console (totales, evolución diaria, búsquedas y
 * páginas) porque su API devuelve una dimensión por consulta. Van en paralelo:
 * en serie, la pantalla tardaría cuatro veces más para el mismo resultado.
 */
export async function GET(request: Request) {
  return run(async () => {
    const siteId = z.string().uuid().parse(new URL(request.url).searchParams.get("siteId"));
    const tenant = await requireCurrentTenant();
    await assertModule(tenant.tenantId, "seo");
    await enforceRateLimit("competitor", `seo-perf:${tenant.tenantId}`);

    // La web se resuelve por su id Y por tenant_id: nunca se acepta la URL
    // suelta del cliente, que sería pedirle datos de un dominio ajeno a
    // nombre de este tenant.
    const { data: site } = await adminClient()
      .from("seo_sites")
      .select("site_url")
      .eq("id", siteId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle();

    if (!site) throw new AppError("Web no encontrada.", 404);

    const token = await requireSearchConsoleToken(tenant.tenantId);

    const [totals, daily, queries, pages] = await Promise.all([
      performance(token, site.site_url),
      performance(token, site.site_url, { dimension: "date", limit: 90 }),
      performance(token, site.site_url, { dimension: "query", limit: 10 }),
      performance(token, site.site_url, { dimension: "page", limit: 10 }),
    ]);

    return {
      siteUrl: site.site_url,
      totals: totals.totals,
      // Google devuelve las fechas sin orden garantizado; la gráfica necesita
      // la serie cronológica.
      daily: daily.rows.sort((a, b) => a.key.localeCompare(b.key)),
      queries: queries.rows,
      pages: pages.rows,
    };
  });
}
