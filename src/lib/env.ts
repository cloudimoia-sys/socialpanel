import { z } from "zod";

/**
 * Validación de configuración al arranque.
 *
 * Separada en dos esquemas a propósito: `publicEnv` es lo único que puede
 * cruzar al navegador. Todo lo demás vive en `serverEnv`, que lanza si se
 * importa desde un componente de cliente.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  // Clave "publishable" (antes "anon"). Es pública por diseño: la protege el RLS.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

const serverSchema = z.object({
  // Clave "secret" (antes "service_role"). Salta todo el RLS.
  SUPABASE_SECRET_KEY: z.string().min(1),
  // 32 bytes en base64 = 44 caracteres.
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(44),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  FAL_API_KEY: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  UPLOAD_POST_API_KEY: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // --- Stripe ---------------------------------------------------------------
  // El secret de webhook es obligatorio en producción: sin él no se puede
  // verificar la firma, y un endpoint de facturación sin verificar es un
  // endpoint donde cualquiera se regala el plan Pro.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  // Activar solo cuando Stripe Tax esté configurado en el panel de Stripe.
  STRIPE_AUTOMATIC_TAX: z.enum(["true", "false"]).default("false"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  PROVIDER_PROFILE: z.enum(["free", "paid"]).default("free"),

  // Los modelos van en configuración, no en el código: Google retira versiones
  // sin previo aviso (gemini-2.5-flash dejó de admitir claves nuevas) y no
  // queremos un despliegue para cambiar un identificador.
  GEMINI_TEXT_MODEL: z.string().default("gemini-3.7-flash"),
  // Se usa cuando el principal devuelve 503 por saturación, que pasa a diario.
  GEMINI_TEXT_MODEL_FALLBACK: z.string().default("gemini-3.5-flash"),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-3.1-flash-image"),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),
  // lucid-origin gana la comparativa: anatomía limpia, sin logos inventados y
  // sin texto ilegible. flux-1-schnell es más rápido pero saca manos flotando
  // y se inventa marcas comerciales.
  CLOUDFLARE_IMAGE_MODEL: z.string().default("@cf/leonardo/lucid-origin"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

let cached: z.infer<typeof serverSchema> | null = null;

export function serverEnv() {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() no puede usarse en el navegador");
  }
  if (!cached) {
    // Una variable presente pero vacía en .env NO es `undefined`, así que
    // `.optional()` no la salva y el esquema falla al validarla (una
    // UPSTASH_REDIS_REST_URL="" reventaba contra .url()). Las tratamos como
    // ausentes, que es lo que significan.
    const present = Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ""),
    );
    cached = serverSchema.parse(present);
  }
  return cached;
}

export const isProd = () => serverEnv().NODE_ENV === "production";
