"use client";

import { useEffect, useState } from "react";
import { Credit } from "@/app/credit";
import { IconCheck } from "@/app/icons";
import { browserClient } from "@/lib/supabase-browser";

/**
 * Acceso con Google, y enlace mágico al correo como alternativa.
 *
 * Sin contraseñas a propósito: no almacenamos ninguna, así que no hay hashes
 * que proteger, ni flujo de recuperación que abusar, ni fuerza bruta contra la
 * que defenderse. Google resuelve además la pega real del enlace mágico —
 * tener que salir a buscar el correo cada vez que entras.
 */

/** La G va en sus colores de marca: Google no permite recolorearla. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [googleReady, setGoogleReady] = useState(false);

  /**
   * El botón de Google solo aparece si el proveedor está realmente habilitado
   * en Supabase.
   *
   * No es precaución teórica: `signInWithOAuth` NO devuelve error cuando el
   * proveedor está desactivado — saca al usuario del sitio y lo deja en un
   * JSON crudo de Supabase ("provider is not enabled") sin ningún camino de
   * vuelta. Como el error ocurre después de navegar, no hay forma de
   * capturarlo; la única defensa es no ofrecer el botón hasta que funcione.
   *
   * Se cura solo: en cuanto se active Google en Supabase, el botón sale sin
   * tocar código ni volver a desplegar.
   */
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return;

    void fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((res) => res.json())
      .then((settings) => setGoogleReady(settings?.external?.google === true))
      // Sin respuesta damos por hecho que no está: es preferible esconder un
      // botón que funciona a ofrecer uno que lleva a una pantalla sin salida.
      .catch(() => setGoogleReady(false));
  }, []);

  async function withGoogle() {
    await browserClient().auth.signInWithOAuth({
      provider: "google",
      // Misma ruta que el enlace mágico: los dos flujos acaban canjeando un
      // código por sesión, así que no hace falta un callback aparte.
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");

    const { error } = await browserClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    setState(error ? "error" : "sent");
  }

  return (
    <main
      style={{
        maxWidth: "22rem",
        margin: "0 auto",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div className="brandmark" style={{ marginBottom: "var(--s5)", padding: 0 }}>
        <span className="dot" />
        SocialPanel
      </div>

      {state === "sent" ? (
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Revisa tu correo</h2>
            <IconCheck className="" />
          </div>
          <p style={{ margin: 0 }}>
            Enlace enviado a <code>{email}</code>.
          </p>
          <p className="hint">Ábrelo desde este mismo navegador o la sesión no cuajará.</p>
        </div>
      ) : (
        <div className="card">
          <h1 style={{ fontSize: "1.25rem", marginBottom: "var(--s4)" }}>Entrar</h1>

          {googleReady && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={withGoogle}
                style={{ width: "100%" }}
              >
                <GoogleMark />
                Continuar con Google
              </button>

              <div className="separator">o con tu correo</div>
            </>
          )}

          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                aria-describedby={state === "error" ? "login-error" : undefined}
              />
            </div>

            {state === "error" && (
              <p className="error" id="login-error" role="alert">
                No se pudo enviar el enlace. Revisa el correo e inténtalo de nuevo.
              </p>
            )}

            <button
              type="submit"
              className="btn"
              disabled={state === "sending"}
              style={{ width: "100%" }}
            >
              {state === "sending" ? "Enviando…" : "Enviar enlace de acceso"}
            </button>
          </form>
        </div>
      )}

      <Credit />
    </main>
  );
}
