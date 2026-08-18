"use client";

import { useCallback, useEffect, useState } from "react";
import { IconAlert, IconCheck, IconPlus } from "@/app/icons";

interface Invitation {
  email: string;
  note: string | null;
  created_at: string;
  claimed_at: string | null;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });

export function InvitationsClient() {
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/invitations");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudieron cargar las invitaciones.");
      setInvitations([]);
      return;
    }
    setInvitations(json.invitations);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const res = await fetch("/api/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, note: note || undefined }),
    });
    const json = await res.json();
    setBusy(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo crear la invitación.");
      return;
    }

    setEmail("");
    setNote("");
    await load();
  }

  async function revoke(target: string) {
    setError("");

    const res = await fetch(`/api/invitations?email=${encodeURIComponent(target)}`, {
      method: "DELETE",
    });
    const json = await res.json();

    if (!res.ok) {
      setError(json.error ?? "No se pudo retirar la invitación.");
      return;
    }
    await load();
  }

  return (
    <main>
      <header className="page-head">
        <h1>Invitaciones</h1>
        <p>Solo entra en SocialPanel quien esté en esta lista.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      <form onSubmit={invite} className="card">
        <div className="row">
          <div className="field">
            <label htmlFor="email">Correo a invitar</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@ejemplo.com"
            />
          </div>
          <div className="field">
            <label htmlFor="note">Quién es (opcional)</label>
            <input
              id="note"
              type="text"
              maxLength={120}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Peluquería Ana"
            />
          </div>
        </div>

        <button type="submit" className="btn" disabled={busy}>
          <IconPlus />
          {busy ? "Invitando…" : "Invitar"}
        </button>

        <p className="hint">
          Tiene que ser el mismo correo con el que vaya a entrar. Si usa Google, el de su
          cuenta de Google.
        </p>
      </form>

      <section className="card">
        {invitations === null ? (
          <>
            <div className="skeleton" style={{ width: "45%" }} />
            <div className="skeleton" style={{ width: "60%" }} />
          </>
        ) : invitations.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Todavía no has invitado a nadie.
          </p>
        ) : (
          <ul className="list">
            {invitations.map((i) => (
              <li key={i.email}>
                {i.claimed_at ? (
                  <span className="badge badge-ok">
                    <IconCheck />
                    dentro
                  </span>
                ) : (
                  <span className="badge">pendiente</span>
                )}

                <strong className="truncate">{i.email}</strong>
                {i.note && <span className="muted truncate">{i.note}</span>}

                <span className="spacer" style={{ display: "flex", alignItems: "center", gap: "var(--s3)" }}>
                  <span className="muted">
                    {i.claimed_at ? `entró el ${formatDate(i.claimed_at)}` : formatDate(i.created_at)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => revoke(i.email)}
                  >
                    Retirar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="hint">
        Retirar una invitación pendiente impide que esa persona entre. Pero si ya figura
        como <strong>dentro</strong>, su cuenta sigue funcionando: retirarla solo evita que
        vuelva a darse de alta. Para cerrarle el acceso de verdad hay que eliminar su
        cuenta.
      </p>
    </main>
  );
}
