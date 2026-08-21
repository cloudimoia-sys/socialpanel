import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertModule } from "@/domain/quota";
import { AppError } from "@/lib/logger";
import { requireCurrentTenant } from "@/lib/tenant";
import { authUrl, searchConsoleConfigured } from "@/providers/seo/search-console";

export const STATE_COOKIE = "seo_oauth_state";

/**
 * Manda al usuario a autorizar el acceso a su Search Console.
 *
 * Devuelve una redirección y no JSON, así que no puede usar `run()`: el
 * navegador tiene que seguir el 302 a Google.
 *
 * El `state` no es decorativo. Sin él, alguien podría preparar un enlace de
 * vuelta con SU código de autorización y, si un cliente autenticado lo
 * abriera, quedaría conectada la cuenta de Google del atacante al tenant de
 * la víctima — y con ella los datos SEO que se enseñan dentro. Se guarda en
 * una cookie httpOnly y se compara al volver.
 */
export async function GET() {
  try {
    const tenant = await requireCurrentTenant();
    await assertModule(tenant.tenantId, "seo");

    if (!searchConsoleConfigured()) {
      throw new AppError("La conexión con Google no está configurada en el servidor.", 503);
    }

    const state = randomBytes(32).toString("base64url");

    (await cookies()).set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      // Diez minutos: lo que tarda una autorización con margen de sobra. Un
      // state que sobrevive días es un state que alguien puede reutilizar.
      maxAge: 600,
    });

    return NextResponse.redirect(authUrl(state));
  } catch (error) {
    const message =
      error instanceof AppError ? error.publicMessage : "No se pudo iniciar la conexión.";
    return NextResponse.redirect(
      new URL(`/dashboard/seo?error=${encodeURIComponent(message)}`, process.env.APP_URL ?? "http://localhost:3000"),
    );
  }
}
