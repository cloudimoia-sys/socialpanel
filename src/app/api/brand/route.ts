import { z } from "zod";
import { FONT_FAMILIES } from "@/domain/fonts";
import { AppError } from "@/lib/logger";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant, requireTenantRole } from "@/lib/tenant";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "color en formato #RRGGBB");
const fontIds = FONT_FAMILIES.map((f) => f.id) as [string, ...string[]];

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
  accent_color: hex.default("#1B5FA9"),
  text_color: hex.default("#FFFFFF"),
  // Contra la lista real de assets/fonts/, no texto libre: un valor inventado
  // aquí haría que compose.ts cayera en silencio a Poppins, y el cliente no
  // tendría forma de saber por qué su tipografía elegida nunca aparece.
  font_family: z.enum(fontIds).default("Poppins"),
  logo_asset_id: z.string().uuid().nullable().default(null),
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
    const db = adminClient();

    const { data } = await db
      .from("brand_profiles")
      .select("*")
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle();

    let logoUrl: string | null = null;
    if (data?.logo_asset_id) {
      const { data: asset } = await db
        .from("assets")
        .select("storage_path")
        // Filtro por tenant además del id: aunque logo_asset_id ya se validó
        // al guardarlo, esta lectura no confía en esa validación pasada — si
        // algún día ese dato llegara mal por otra vía, aquí no se sirve.
        .eq("id", data.logo_asset_id)
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle();

      if (asset) {
        const { data: signed } = await db.storage.from("media").createSignedUrl(asset.storage_path, 3600);
        logoUrl = signed?.signedUrl ?? null;
      }
    }

    return { brand: data, logoUrl };
  });
}

export async function PUT(request: Request) {
  return run(async () => {
    const body = bodySchema.parse(await request.json());
    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    const db = adminClient();

    // El asset tiene que ser de este tenant. Sin esta comprobación, alguien
    // podría apuntar logo_asset_id al asset de OTRO cliente con solo conocer
    // su UUID, y sus piezas generadas empezarían a llevar un logo ajeno.
    if (body.logo_asset_id) {
      const { data: asset } = await db
        .from("assets")
        .select("id, kind")
        .eq("id", body.logo_asset_id)
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle();

      if (!asset) throw new AppError("Ese archivo no pertenece a tu cuenta.", 403);
      // El logo se dibuja con `loadImage()` en compose.ts: un vídeo ahí no
      // fallaría con un mensaje claro, fallaría dentro del renderizador de
      // la próxima pieza que se generase.
      if (asset.kind !== "image") throw new AppError("El logo tiene que ser una imagen.", 400);
    }

    const { error } = await db
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
