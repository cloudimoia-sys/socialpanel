import { z } from "zod";
import { AppError } from "@/lib/logger";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant, requireTenantRole } from "@/lib/tenant";

/**
 * Perfil de marca: el formulario que rellena la empresa una vez y alimenta
 * todas las generaciones posteriores.
 */

const bodySchema = z.object({
  business_name: z.string().min(2).max(120),
  business_type: z.string().min(2).max(120),
  description: z.string().max(2000).default(""),
  audience: z.string().max(1000).default(""),
  tone: z.string().max(500).default(""),
  language: z.string().min(2).max(20).default("es"),
  offerings: z.string().max(3000).default(""),
  keywords: z.array(z.string().min(1).max(60)).max(30).default([]),
  avoid: z.string().max(2000).default(""),
  // Se valida contra la lista real del sistema: una zona inventada haría que
  // la conversión fallara y el post no se programara, en silencio.
  timezone: z
    .string()
    .max(60)
    .refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), {
      message: "zona horaria desconocida",
    })
    .default("Europe/Madrid"),
  publish_hour: z.number().int().min(0).max(23).default(10),
  // Consultas de búsqueda, no categorías: "implantes dentales nueva técnica"
  // da mejores resultados que "odontología".
  news_topics: z.array(z.string().min(2).max(120)).max(6).default([]),
  // La gente escribe "cloudimo.es", no "https://cloudimo.es". Normalizamos
  // antes de validar en vez de rechazarlo: exigir el esquema es hacerle al
  // usuario el trabajo de la máquina.
  website: z
    .string()
    .max(300)
    .trim()
    .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
    .refine((v) => v === "" || z.string().url().safeParse(v).success, {
      message: "no parece una dirección web válida",
    })
    .optional()
    .default(""),
});

export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();

    const { data } = await adminClient()
      .from("brand_profiles")
      .select("*")
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle();

    return { brand: data };
  });
}

export async function PUT(request: Request) {
  return run(async () => {
    const body = bodySchema.parse(await request.json());
    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    const { error } = await adminClient()
      .from("brand_profiles")
      .upsert(
        {
          ...body,
          website: body.website || null,
          tenant_id: tenant.tenantId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" },
      );

    if (error) throw new AppError("No se pudo guardar el perfil.", 500, error.message);

    return { ok: true };
  });
}
