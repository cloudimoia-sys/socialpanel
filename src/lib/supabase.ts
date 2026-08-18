import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { publicEnv, serverEnv } from "./env";

/**
 * Dos clientes, dos propósitos. No los mezcles.
 *
 *  - `userClient()`  → actúa como el usuario logueado. RLS activo. Es el que
 *                      debes usar en el 99% de los casos.
 *  - `adminClient()` → service role, SALTA TODO EL RLS. Solo para workers de
 *                      la cola y para leer credenciales cifradas. Cada uso
 *                      obliga a filtrar por tenant_id a mano.
 */

export async function userClient() {
  const store = await cookies();
  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Server Component: la sesión la refresca el middleware.
          }
        },
      },
    },
  );
}

let admin: ReturnType<typeof createClient<Database>> | null = null;

export function adminClient() {
  if (typeof window !== "undefined") {
    throw new Error("adminClient() no puede usarse en el navegador");
  }
  if (!admin) {
    admin = createClient<Database>(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv().SUPABASE_SECRET_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return admin;
}
