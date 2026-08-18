import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase";
import { log } from "@/lib/logger";

/**
 * Cierre del flujo de enlace mágico: canjea el código por una sesión.
 *
 * El destino se saca de `next`, pero solo se acepta si es una ruta relativa
 * ("/dashboard"). Sin esa comprobación cualquiera podría montar un enlace que
 * te loguea y te lanza a un dominio suyo — un open redirect de manual.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requested = url.searchParams.get("next") ?? "/dashboard";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }

  const supabase = await userClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    log.warn("fallo al canjear el codigo de acceso", { error: error.message });
    return NextResponse.redirect(new URL("/login?error=invalid_code", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
