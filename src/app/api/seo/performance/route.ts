import { z } from "zod";
import { assertModule } from "@/domain/quota";
import { requireSearchConsoleToken } from "@/domain/seo";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";
import {
  performance,
  supportsDimension,
  type SearchRow,
  type SearchType,
} from "@/providers/seo/search-console";

const PERIOD_DAYS = 28;

/**
 * Rendimiento en Google de una de las webs del cliente.
 *
 * La API de Search Console devuelve una sola dimensión por consulta, así que
 * cada desglose es una llamada. Van todas en paralelo: en serie, la pantalla
 * tardaría siete veces más para exactamente el mismo resultado.
 */
export async function GET(request: Request) {
  return run(async () => {
    const url = new URL(request.url);
    const siteId = z.string().uuid().parse(url.searchParams.get("siteId"));
    const type = z
      .enum(["web", "image", "video", "discover", "googleNews"])
      .default("web")
      .parse(url.searchParams.get("type") ?? "web") as SearchType;

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
    const site_url = site.site_url;
    const base = { type, days: PERIOD_DAYS };

    /**
     * Un desglose que falla no debe tumbar la pantalla entera.
     *
     * Google no documenta qué dimensiones admite cada tipo de propiedad, y
     * desde julio de 2026 existen las "platform properties" (Instagram,
     * TikTok, X, YouTube) que la documentación de la API todavía no recoge.
     * Antes que adivinar qué acepta cada una, se piden todas y la que Google
     * rechace se queda vacía: la pantalla enseña lo que sí hay en vez de un
     * error por una dimensión secundaria.
     */
    const safeRows = async (opts: Parameters<typeof performance>[2]) => {
      try {
        return (await performance(token, site_url, opts)).rows;
      } catch {
        return [] as SearchRow[];
      }
    };

    // Discover y Noticias no tienen consultas de búsqueda: eso sí está
    // documentado, así que ni se piden.
    const wantsQueries = supportsDimension(type, "query");

    const [totals, previous, daily, queries, pages, devices, countries] = await Promise.all([
      // Los totales sí son obligatorios: sin ellos no hay pantalla que pintar.
      performance(token, site_url, base),
      // Mismo periodo, 28 días antes: es lo que permite decir "sube un 12%"
      // en vez de enseñar un número suelto sin referencia.
      performance(token, site_url, { ...base, offsetDays: PERIOD_DAYS }),
      safeRows({ ...base, dimension: "date", limit: 90 }),
      wantsQueries ? safeRows({ ...base, dimension: "query", limit: 10 }) : Promise.resolve([]),
      safeRows({ ...base, dimension: "page", limit: 10 }),
      safeRows({ ...base, dimension: "device", limit: 5 }),
      safeRows({ ...base, dimension: "country", limit: 8 }),
    ]);

    return {
      siteUrl: site_url,
      type,
      totals: totals.totals,
      previous: previous.totals,
      // Google devuelve las fechas sin orden garantizado; la gráfica necesita
      // la serie cronológica.
      daily: [...daily].sort((a, b) => a.key.localeCompare(b.key)),
      queries,
      pages,
      devices,
      countries,
    };
  });
}
