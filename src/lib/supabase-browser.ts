"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente de navegador. Solo lleva la publishable key, que es pública por
 * diseño: lo que protege los datos es el RLS, no el secreto de esta clave.
 *
 * Nunca importes aquí nada de `env.ts` que no sea `publicEnv`.
 */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
