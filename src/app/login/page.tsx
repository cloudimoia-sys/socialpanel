"use client";

import { useEffect, useState } from "react";
import { Credit } from "@/app/credit";
import { IconCheck } from "@/app/icons";
import { browserClient } from "@/lib/supabase-browser";

/**
 * Acceso con contraseña o con Google.
 *
 * El enlace mágico suelto se ha retirado: obligaba a salir al correo CADA vez
 * que entrabas. Sigue habiendo correo donde toca —confirmar el alta y
 * recuperar la contraseña— pero ya no en el uso diario.
 *
 * Los tres modos viven en la misma pantalla a propósito. Separar "entrar" y
 * "crear cuenta" en dos páginas obliga a adivinar cuál te toca, y el error más
 * común es justo ese: intentar entrar sin tener cuenta todavía.
 */

type Mode = "signin" | "signup" | "recover";

const MIN_PASSWORD = 8;

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
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Mensaje de "mira tu correo": alta pendiente de confirmar o recuperación. */
  const [sent, setSent] = useState("");
  const [googleReady, setGoogleReady] = useState(false);

  /**
   * El botón de Google solo aparece si el proveedor está habilitado.
   *
   * `signInWithOAuth` NO devuelve error cuando está desactivado: saca al
   * usuario del sitio y lo deja en un JSON crudo de Supabase sin camino de
   * vuelta. Como el fallo ocurre después de navegar no hay forma de
   * capturarlo, así que la defensa es no ofrecer el botón hasta que funcione.
   */
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return;

    void fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((res) => res.json())
      .then((settings) => setGoogleReady(settings?.external?.google === true))
      .catch(() => setGoogleReady(false));
  }, []);

  function switchTo(next: Mode) {
    setMode(next);
    setError("");
    setSent("");
  }

  async function withGoogle() {
    await browserClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSent("");

    const supabase = browserClient();
    const origin = window.location.origin;

    if (mode === "recover") {
      // El correo de recuperación pasa por /auth/callback, que canjea el código
      // por sesión, y sigue hasta /auth/reset a poner la contraseña nueva. Ese
      // `next` lo valida el callback: solo acepta rutas relativas.
      const { error: failure } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/auth/callback?next=/auth/reset`,
      });
      setBusy(false);

      // Se responde igual exista o no la cuenta: decir "ese correo no está
      // registrado" convierte esta pantalla en un comprobador de quién es
      // cliente nuestro.
      if (failure) setError("No se pudo enviar el correo. Inténtalo de nuevo.");
      else setSent(`Si ${email} tiene cuenta, le hemos enviado un enlace para cambiar la contraseña.`);
      return;
    }

    if (mode === "signup") {
      if (password.length < MIN_PASSWORD) {
        setBusy(false);
        setError(`La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`);
        return;
      }

      const { data, error: failure } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${origin}/auth/callback` },
      });
      setBusy(false);

      if (failure) {
        setError(
          failure.message.includes("already")
            ? "Ese correo ya tiene cuenta. Entra con tu contraseña."
            : "No se pudo crear la cuenta. Revisa el correo e inténtalo de nuevo.",
        );
        return;
      }

      // Con la confirmación por correo activada no llega sesión: hay que
      // esperar a que abra el enlace. Sin ella entra directo. Se contemplan
      // los dos casos porque es un ajuste del panel de Supabase que puede
      // cambiar sin tocar este código.
      if (data.session) window.location.assign("/dashboard");
      else setSent(`Te hemos enviado un correo a ${email} para confirmar la cuenta.`);
      return;
    }

    const { error: failure } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);

    if (failure) {
      setError("Correo o contraseña incorrectos.");
      return;
    }
    window.location.assign("/dashboard");
  }

  const title = mode === "signup" ? "Crear cuenta" : mode === "recover" ? "Recuperar acceso" : "Entrar";

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

      {sent ? (
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Revisa tu correo</h2>
            <IconCheck className="" />
          </div>
          <p style={{ margin: 0 }}>{sent}</p>
          <p className="hint">Ábrelo desde este mismo navegador o la sesión no cuajará.</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => switchTo("signin")}
            style={{ width: "100%", marginTop: "var(--s4)" }}
          >
            Volver
          </button>
        </div>
      ) : (
        <div className="card">
          <h1 style={{ fontSize: "1.25rem", marginBottom: "var(--s4)" }}>{title}</h1>

          {googleReady && mode !== "recover" && (
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
              />
            </div>

            {mode !== "recover" && (
              <div className="field">
                <label htmlFor="password">Contraseña</label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={mode === "signup" ? MIN_PASSWORD : undefined}
                  // Le dice al gestor de contraseñas si debe ofrecer la
                  // guardada o proponer una nueva. Sin esto, al registrarse
                  // rellena la vieja y el usuario no entiende por qué falla.
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? `Mínimo ${MIN_PASSWORD} caracteres` : "••••••••"}
                />
              </div>
            )}

            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn" disabled={busy} style={{ width: "100%" }}>
              {busy
                ? "Un momento…"
                : mode === "signup"
                  ? "Crear cuenta"
                  : mode === "recover"
                    ? "Enviar enlace"
                    : "Entrar"}
            </button>
          </form>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "var(--s3)",
              marginTop: "var(--s4)",
            }}
          >
            {mode === "signin" ? (
              <>
                <button type="button" className="dtp-link" onClick={() => switchTo("signup")}>
                  Crear cuenta
                </button>
                <button type="button" className="dtp-link" onClick={() => switchTo("recover")}>
                  He olvidado la contraseña
                </button>
              </>
            ) : (
              <button type="button" className="dtp-link" onClick={() => switchTo("signin")}>
                Ya tengo cuenta
              </button>
            )}
          </div>
        </div>
      )}

      <Credit />
    </main>
  );
}
