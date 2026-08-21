import { decryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/logger";
import { adminClient } from "@/lib/supabase";

/**
 * El refresh token de Google de un tenant, descifrado.
 *
 * Se lee con service_role porque `provider_credentials` no tiene política de
 * SELECT — el ciphertext no debe poder salir nunca por la API pública. Por eso
 * el filtro por `tenant_id` es obligatorio y no decorativo: es lo único que
 * separa las credenciales de un cliente de las de otro.
 */
export async function searchConsoleToken(tenantId: string): Promise<string | null> {
  const { data } = await adminClient()
    .from("provider_credentials")
    .select("ciphertext")
    .eq("tenant_id", tenantId)
    .eq("provider", "google_search_console")
    .maybeSingle();

  if (!data?.ciphertext) return null;
  return decryptSecret(data.ciphertext as string, tenantId);
}

/** Igual, pero exige que exista: para endpoints que no tienen nada que hacer sin ella. */
export async function requireSearchConsoleToken(tenantId: string): Promise<string> {
  const token = await searchConsoleToken(tenantId);
  if (!token) throw new AppError("Conecta tu cuenta de Search Console primero.", 409);
  return token;
}
