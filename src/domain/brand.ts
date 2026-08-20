import { adminClient } from "@/lib/supabase";
import type { BrandProfile } from "@/lib/database.types";

/**
 * La memoria de marca es lo que separa "genera un post" de "genera un post de
 * ESTE negocio". Se inyecta en cada generación, así que el cliente no tiene que
 * repetir su contexto cada vez ni el copy suena a IA genérica.
 */

export async function loadBrand(tenantId: string): Promise<BrandProfile | null> {
  const { data } = await adminClient()
    .from("brand_profiles")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return data;
}

/**
 * Bytes del logo del negocio, listos para `compose.ts`.
 *
 * Filtra por `tenant_id` además del id del asset aunque `logo_asset_id` ya se
 * validó al guardarlo en `/api/brand` — esta lectura no confía en esa
 * validación pasada, por si ese dato llegara mal por otra vía en el futuro.
 * Sin logo, o si algo falla al leerlo, devuelve `null` en vez de lanzar: la
 * pieza se genera igual, solo que sin logo, que es preferible a que un logo
 * roto tumbe la generación entera.
 */
export async function loadBrandLogo(tenantId: string, logoAssetId: string | null): Promise<Buffer | null> {
  if (!logoAssetId) return null;

  const db = adminClient();
  const { data: asset } = await db
    .from("assets")
    .select("storage_path")
    .eq("id", logoAssetId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!asset) return null;

  const { data: file, error } = await db.storage.from("media").download(asset.storage_path);
  if (error || !file) return null;

  return Buffer.from(await file.arrayBuffer());
}

/**
 * Convierte el perfil en el bloque de contexto que ve el modelo.
 *
 * `avoid` va al final y en imperativo porque las restricciones colocadas al
 * final de la instrucción se respetan mejor que enterradas en medio.
 */
export function brandContext(brand: BrandProfile | null): string {
  if (!brand) return "";

  const lines = [
    `Negocio: ${brand.business_name} (${brand.business_type})`,
    brand.description && `Qué hace: ${brand.description}`,
    brand.audience && `Público: ${brand.audience}`,
    brand.offerings && `Oferta: ${brand.offerings}`,
    brand.tone && `Voz de marca: ${brand.tone}`,
    brand.keywords.length > 0 && `Términos propios: ${brand.keywords.join(", ")}`,
    brand.website && `Web: ${brand.website}`,
  ].filter(Boolean);

  if (brand.avoid) {
    lines.push(`\nNO menciones ni prometas nunca lo siguiente: ${brand.avoid}`);
  }

  return lines.join("\n");
}
