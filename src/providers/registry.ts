import { decryptSecret } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import { AppError } from "@/lib/logger";
import { adminClient } from "@/lib/supabase";
import type {
  Credential,
  ImageProvider,
  LLMProvider,
  PublishProvider,
  VideoProvider,
} from "./types";

import { AnthropicLLM } from "./llm/anthropic";
import { GeminiLLM } from "./llm/gemini";
import { CloudflareImage } from "./image/cloudflare";
import { GeminiImage } from "./image/gemini";
import { FalVideo } from "./video/fal";
import { UploadPostPublisher } from "./publish/uploadpost";

/**
 * Aquí se decide qué proveedor usa cada tenant y con qué clave.
 *
 * El perfil "free" apunta a los tiers gratuitos (Gemini para texto e imagen);
 * "paid" usa Claude para texto. Cambiar de escalón es cambiar PROVIDER_PROFILE,
 * no tocar código.
 */

export type ProviderKind = "anthropic" | "gemini" | "fal" | "upload_post" | "cloudflare";

const LLM: Record<string, LLMProvider> = {
  anthropic: new AnthropicLLM(),
  gemini: new GeminiLLM(),
};

const IMAGE: Record<string, ImageProvider> = {
  gemini: new GeminiImage(),
  cloudflare: new CloudflareImage(),
};
const VIDEO: Record<string, VideoProvider> = { fal: new FalVideo() };
const PUBLISH: Record<string, PublishProvider> = { upload_post: new UploadPostPublisher() };

export function llmFor(profile = serverEnv().PROVIDER_PROFILE): LLMProvider {
  return profile === "paid" ? LLM.anthropic! : LLM.gemini!;
}

/**
 * En "free" las imágenes van por Cloudflare (10.000 neuronas/día sin tarjeta);
 * en "paid" por Gemini, que da mejor calidad y admite referencias pero exige
 * facturación activada.
 *
 * Si el perfil gratuito no está configurado, cae a Gemini en vez de fallar: es
 * preferible que funcione cobrando a que no funcione.
 */
export function imageProvider(profile = serverEnv().PROVIDER_PROFILE): ImageProvider {
  if (profile === "free" && serverEnv().CLOUDFLARE_ACCOUNT_ID) return IMAGE.cloudflare!;
  return IMAGE.gemini!;
}
export const videoProvider = (): VideoProvider => VIDEO.fal!;
export const publishProvider = (): PublishProvider => PUBLISH.upload_post!;

/**
 * Devuelve la credencial a usar: la del cliente si la tiene guardada (BYOK),
 * si no la nuestra de plataforma.
 *
 * Lee con service role porque la tabla no tiene política de SELECT — el
 * ciphertext no debe poder salir nunca por la API pública. Por eso el filtro
 * por tenant_id aquí es obligatorio y no decorativo.
 */
export async function credentialFor(
  tenantId: string,
  provider: ProviderKind,
): Promise<Credential> {
  const { data } = await adminClient()
    .from("provider_credentials")
    .select("ciphertext")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .maybeSingle();

  if (data?.ciphertext) {
    return { apiKey: decryptSecret(data.ciphertext as string, tenantId), byok: true };
  }

  const env = serverEnv();
  const fallback: Record<ProviderKind, string | undefined> = {
    anthropic: env.ANTHROPIC_API_KEY,
    gemini: env.GEMINI_API_KEY,
    fal: env.FAL_API_KEY,
    upload_post: env.UPLOAD_POST_API_KEY,
    cloudflare: env.CLOUDFLARE_API_TOKEN,
  };

  const apiKey = fallback[provider];
  if (!apiKey) {
    throw new AppError(
      `Falta configurar la conexión con ${provider}. Añade tu clave en Ajustes.`,
      400,
    );
  }
  return { apiKey, byok: false };
}
