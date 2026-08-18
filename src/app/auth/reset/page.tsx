"use client";

import { useEffect, useState } from "react";
import { Credit } from "@/app/credit";
import { browserClient } from "@/lib/supabase-browser";

/**
 * Fija una contraseña nueva.
 *
 * Se llega desde el correo de recuperación: pasa antes por /auth/callback, que
 * canjea el código por una sesión. Es decir, aquí ya se llega autenticado y
 * basta con `updateUser` — no hace falta pedir la contraseña anterior, que es
 * justo la que no se recuerda.
 *
 * Sirve también para que quien entró con enlace mágico o con Google se ponga
 * una contraseña por primera vez: para Supabase es la misma operación.
 */

const MIN_PASSWORD = 8;

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<boolean | null>(null);

  /**
   * Sin sesión no hay nada que cambiar: pasa si el enlace caducó o si alguien
   * llega a esta URL directamente. Se comprueba antes de enseñar el formulario
   * para no dejarle escribir una contraseña que no se va a poder guardar.
   */
  useEffect(() => {
    void browserClient()
      .auth.getSession()
      .then(({ data }) => setReady(Boolean(data.session)));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (password.length < MIN_PASSWORD) {
      setError(`La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (password !== repeat) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }

    setBusy(true);
    const { error: failure } = await browserClient().auth.updateUser({ password });
    setBusy(false);

    if (failure) {
      setError("No se pudo guardar la contraseña. Pide el enlace otra vez.");
      return;
    }
    window.location.assign("/dashboard");
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

      <div className="card">
        <h1 style={{ fontSize: "1.25rem", marginBottom: "var(--s4)" }}>Nueva contraseña</h1>

        {ready === false ? (
          <>
            <p style={{ margin: "0 0 var(--s4)" }}>
              Este enlace ya no vale. Pide uno nuevo desde la pantalla de acceso.
            </p>
            <a href="/login" className="btn" style={{ width: "100%" }}>
              Volver a entrar
            </a>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`Mínimo ${MIN_PASSWORD} caracteres`}
              />
            </div>

            <div className="field">
              <label htmlFor="repeat">Repítela</label>
              <input
                id="repeat"
                type="password"
                required
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="btn"
              disabled={busy || ready === null}
              style={{ width: "100%" }}
            >
              {busy ? "Guardando…" : "Guardar y entrar"}
            </button>
          </form>
        )}
      </div>

      <Credit />
    </main>
  );
}
