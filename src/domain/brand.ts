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
