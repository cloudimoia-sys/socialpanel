import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertModule } from "@/domain/quota";
import { encryptSecret, hintFor, safeEqual } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import { AppError, log } from "@/lib/logger";
import { adminClient } from "@/lib/supabase";
import { requireCurrentTenant } from "@/lib/tenant";
import { exchangeCode } from "@/providers/seo/search-console";
import { STATE_COOKIE } from "../connect/route";

/** Vuelta de Google tras autorizar. Redirige siempre, con o sin éxito. */
export async function GET(request: Request) {
  const back = (params: string) =>
    NextResponse.redirect(new URL(`/dashboard/seo?${params}`, serverEnv().APP_URL));

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const denied = url.searchParams.get("error");

    // El usuario pulsó "Cancelar" en la pantalla de Google. No es un fallo.
    if (denied) return back("error=" + encodeURIComponent("Has cancelado la conexión."));

    const jar = await cookies();
    const expected = jar.get(STATE_COOKIE)?.value;
    // Se borra siempre, acierte o falle: un state de un solo uso que sobrevive
    // al intento deja de ser de un solo uso.
    jar.delete(STATE_COOKIE);

    // Comparación en tiempo constante, como el resto de secretos de la app.
    if (!code || !state || !expected || !safeEqual(state, expected)) {
      log.warn("callback de Search Console con state inválido");
      throw new AppError("La conexión no se pudo verificar. Vuelve a intentarlo.", 400);
    }

    const tenant = await requireCurrentTenant();
    await assertModule(tenant.tenantId, "seo");

    const refreshToken = await exchangeCode(code);

    // Mismo tratamiento que cualquier API key: cifrado con el tenant como AAD
    // y guardado en la tabla que no tiene política de SELECT.
    const { error } = await adminClient()
      .from("provider_credentials")
      .upsert(
        {
          tenant_id: tenant.tenantId,
          provider: "google_search_console",
          ciphertext: encryptSecret(refreshToken, tenant.tenantId),
          hint: hintFor(refreshToken),
        },
        { onConflict: "tenant_id,provider" },
      );

    if (error) throw new AppError("No se pudo guardar la conexión.", 500, error.message);

    return back("conectado=1");
  } catch (error) {
    const message =
      error instanceof AppError ? error.publicMessage : "No se pudo completar la conexión.";
    return back("error=" + encodeURIComponent(message));
  }
}
