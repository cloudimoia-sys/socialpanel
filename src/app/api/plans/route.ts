import { z } from "zod";
import { brandContext, loadBrand } from "@/domain/brand";
import { LIMITS_BY_PLATFORM } from "@/domain/platform-rules";
import { assertBudget, recordUsage } from "@/domain/usage";
import { AppError } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant, requireTenantRole } from "@/lib/tenant";
import { credentialFor, llmFor, type ProviderKind } from "@/providers/registry";
import { news } from "@/providers/news/google-news";

const bodySchema = z.object({
  title: z.string().min(2).max(120),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().min(3).max(20),
  platforms: z
    .array(z.enum(Object.keys(LIMITS_BY_PLATFORM) as [string, ...string[]]))
    .min(1)
    .max(9),
  notes: z.string().max(1000).optional(),
});

export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();

    const { data } = await adminClient()
      .from("content_plans")
      .select("id, title, period_start, period_end, status, created_at")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false })
      .limit(20);

    return { plans: data ?? [] };
  });
}

/**
 * Genera un plan de contenido completo.
 *
 * Va síncrono y no por la cola: son unos segundos, y el operador está mirando
 * la pantalla esperando las ideas. Meterlo en la cola añadiría sondeo sin
 * ganar nada, al contrario que el vídeo, que sí tarda minutos.
 */
export async function POST(request: Request) {
  return run(async () => {
    const body = bodySchema.parse(await request.json());
    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);
    await enforceRateLimit("generate", `plan:${tenant.tenantId}`);

    if (body.periodEnd < body.periodStart) {
      throw new AppError("La fecha de fin es anterior a la de inicio.", 400);
    }

    const brand = await loadBrand(tenant.tenantId);
    if (!brand) {
      throw new AppError(
        "Completa primero el perfil de la empresa: sin él las ideas son genéricas.",
        409,
      );
    }

    const provider = llmFor();
    const cred = await credentialFor(tenant.tenantId, provider.name as ProviderKind);
    await assertBudget(tenant.tenantId, 15, cred.byok);

    // Actualidad real del sector, de una fuente verificable. Es un extra: si
    // el feed falla o no hay temas configurados, el plan se genera igual, solo
    // que sin la idea de actualidad.
    const articles =
      brand.news_topics.length > 0 ? await news.searchMany(brand.news_topics) : [];

    const result = await provider.generatePlan(
      {
        brand: brandContext(brand),
        count: body.count,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        platforms: body.platforms,
        language: brand.language,
        notes: body.notes,
        news: articles,
      },
      cred,
    );

    await recordUsage(tenant.tenantId, "llm", result.cost);

    const db = adminClient();
    const { data: plan, error } = await db
      .from("content_plans")
      .insert({
        tenant_id: tenant.tenantId,
        title: body.title,
        period_start: body.periodStart,
        period_end: body.periodEnd,
        created_by: tenant.userId,
      })
      .select("id")
      .single();

    if (error || !plan) throw new AppError("No se pudo guardar el plan.", 500, error?.message);

    const items = result.ideas.map((idea, index) => ({
      plan_id: plan.id,
      tenant_id: tenant.tenantId,
      idea: idea.idea,
      headline: idea.headline,
      rationale: idea.rationale,
      visual_prompt: idea.visual,
      // El modelo puede inventarse nombres de red: nos quedamos con las válidas.
      suggested_platforms: idea.suggestedPlatforms.filter((p) => p in LIMITS_BY_PLATFORM),
      suggested_media: idea.suggestedMedia,
      scheduled_for: idea.scheduledFor,
      position: index,
      // `parsePlan` ya descartó cualquier URL que no viniera en la lista real:
      // si `sourceUrl` llega hasta aquí, es una noticia verificada.
      source_url: idea.sourceUrl ?? null,
      source_title: idea.sourceUrl
        ? (articles.find((a) => a.url === idea.sourceUrl)?.title ?? null)
        : null,
    }));

    const { error: itemsError } = await db.from("content_plan_items").insert(items);
    if (itemsError) {
      throw new AppError("No se pudieron guardar las ideas.", 500, itemsError.message);
    }

    return {
      id: plan.id,
      count: items.length,
      // Para que la interfaz pueda decir "no encontramos ninguna noticia que
      // encajase" en vez de dejar la ausencia sin explicar.
      newsFound: articles.length,
      newsUsed: items.filter((i) => i.source_url).length,
    };
  });
}
