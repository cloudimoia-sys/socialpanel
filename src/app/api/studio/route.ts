import { z } from "zod";
import { brandContext, loadBrand } from "@/domain/brand";
import { LIMITS_BY_PLATFORM } from "@/domain/platform-rules";
import { assertBudget, recordUsage } from "@/domain/usage";
import { enforceRateLimit } from "@/lib/ratelimit";
import { run } from "@/lib/route";
import { requireCurrentTenant, requireTenantRole } from "@/lib/tenant";
import { credentialFor, llmFor, type ProviderKind } from "@/providers/registry";

const bodySchema = z.object({
  brief: z.string().min(10).max(2000),
  platforms: z
    .array(z.enum(Object.keys(LIMITS_BY_PLATFORM) as [string, ...string[]]))
    .min(1)
    .max(9),
});

/**
 * Content Studio: de un solo brief a una pieza adaptada por red.
 *
 * Síncrono, igual que /api/plans — son segundos de espera con el operador
 * mirando la pantalla, no minutos de vídeo que justifiquen la cola. No
 * persiste nada: es una herramienta de redacción, no un post — para publicar
 * cualquiera de las piezas, el operador la lleva a Nuevo post.
 */
export async function POST(request: Request) {
  return run(async () => {
    const body = bodySchema.parse(await request.json());
    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);
    await enforceRateLimit("generate", `studio:${tenant.tenantId}`);

    const brand = await loadBrand(tenant.tenantId);

    const provider = llmFor();
    const cred = await credentialFor(tenant.tenantId, provider.name as ProviderKind);
    await assertBudget(tenant.tenantId, 15, cred.byok);

    const result = await provider.generateStudio(
      {
        brief: body.brief,
        platforms: body.platforms,
        language: brand?.language ?? "es",
        brand: brandContext(brand),
      },
      cred,
    );

    await recordUsage(tenant.tenantId, "llm", result.cost);

    return {
      pieces: result.pieces,
      imageIdea: result.imageIdea,
      videoIdea: result.videoIdea,
    };
  });
}
