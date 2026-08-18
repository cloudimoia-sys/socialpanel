"use client";

import { useState } from "react";
import { Credit } from "@/app/credit";
import { IconCheck } from "@/app/icons";
import { browserClient } from "@/lib/supabase-browser";

/**
 * Login por enlace mágico.
 *
 * Sin contraseñas a propósito: no almacenamos ninguna, así que no hay hashes
 * que proteger, ni flujo de recuperación que abusar, ni fuerza bruta contra la
 * que defenderse.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

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
        <form onSubmit={submit} className="card">
          <h1 style={{ fontSize: "1.25rem", marginBottom: "var(--s2)" }}>Entrar</h1>
          <p className="muted" style={{ marginBottom: "var(--s4)" }}>
            Te enviamos un enlace de acceso. Sin contraseñas.
          </p>

          <div className="field">
            <label htmlFor="email">Correo electrónico</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
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

          <button type="submit" className="btn" disabled={state === "sending"} style={{ width: "100%" }}>
            {state === "sending" ? "Enviando…" : "Enviar enlace"}
          </button>
        </form>
      )}

      <Credit />
    </main>
  );
}
