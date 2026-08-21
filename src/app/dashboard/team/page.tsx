"use client";

import { useCallback, useEffect, useState } from "react";
import { IconAlert, IconPlus } from "@/app/icons";

interface Member {
  userId: string;
  role: "owner" | "admin" | "member";
  email: string;
  isMe: boolean;
}

interface Invitation {
  id: string;
  email: string;
  role: "admin" | "member";
  created_at: string;
}

const ROLE_LABEL: Record<Member["role"], string> = {
  owner: "Propietario",
  admin: "Administrador",
  member: "Miembro",
};

export default function TeamPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [myRole, setMyRole] = useState<Member["role"] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/team");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo cargar el equipo.");
      return;
    }
    setMembers(json.members);
    setInvitations(json.invitations ?? []);
    setMyRole(json.myRole);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(userId: string, role: Member["role"]) {
    setBusy(userId);
    setError("");

    const res = await fetch("/api/team", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    const json = await res.json();
    setBusy(null);

    if (!res.ok) {
      setError(json.error ?? "No se pudo cambiar el rol.");
      return;
    }
    await load();
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setInviting(true);
    setError("");

    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const json = await res.json();
    setInviting(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo invitar.");
      return;
    }
    setInviteEmail("");
    setInviteRole("member");
    setShowInvite(false);
    await load();
  }

  async function cancelInvitation(id: string) {
    setBusy(id);
    setError("");

    const res = await fetch(`/api/team?invitationId=${id}`, { method: "DELETE" });
    const json = await res.json();
    setBusy(null);

    if (!res.ok) {
      setError(json.error ?? "No se pudo cancelar la invitación.");
      return;
    }
    await load();
  }

  async function remove(userId: string) {
    setBusy(userId);
    setError("");

    const res = await fetch(`/api/team?userId=${userId}`, { method: "DELETE" });
    const json = await res.json();
    setBusy(null);

    if (!res.ok) {
      setError(json.error ?? "No se pudo quitar a esa persona.");
      return;
    }
    await load();
  }

  const canManage = myRole === "owner" || myRole === "admin";

  return (
    <main>
      <header className="page-head">
        <h1>Equipo</h1>
        <p>Quién tiene acceso a esta cuenta y qué puede hacer.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      <section className="card">
        {members === null ? (
          <div className="skeleton" style={{ width: "60%" }} />
        ) : (
          <ul className="list">
            {members.map((m) => (
              <li key={m.userId}>
                <strong className="truncate">
                  {m.email}
                  {m.isMe && <span className="muted"> (tú)</span>}
                </strong>

                <span className="spacer" style={{ display: "flex", alignItems: "center", gap: "var(--s3)" }}>
                  {/* Solo un owner puede tocar el rol owner (mismo límite que
                      impone la política de RLS): sin permiso se enseña texto,
                      con permiso un selector. */}
                  {canManage && !m.isMe && (myRole === "owner" || m.role !== "owner") ? (
                    <select
                      aria-label={`Rol de ${m.email}`}
                      value={m.role}
                      disabled={busy === m.userId}
                      onChange={(e) => changeRole(m.userId, e.target.value as Member["role"])}
                      style={{ width: "auto" }}
                    >
                      {(["owner", "admin", "member"] as const)
                        .filter((r) => r !== "owner" || myRole === "owner")
                        .map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <span className="badge">{ROLE_LABEL[m.role]}</span>
                  )}

                  {canManage && !m.isMe && (myRole === "owner" || m.role !== "owner") && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy === m.userId}
                      onClick={() => remove(m.userId)}
                    >
                      Quitar
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && (
        <>
          {!showInvite ? (
            <button type="button" className="btn" onClick={() => setShowInvite(true)}>
              <IconPlus />
              Invitar a alguien
            </button>
          ) : (
            <form onSubmit={invite} className="card">
              <h2 className="card-title">Invitar a alguien</h2>
              <div className="row">
                <div className="field" style={{ flex: 2 }}>
                  <label htmlFor="inviteEmail">Correo electrónico</label>
                  <input
                    id="inviteEmail"
                    type="email"
                    required
                    autoFocus
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="persona@empresa.com"
                  />
                </div>
                <div className="field">
                  <label htmlFor="inviteRole">Rol</label>
                  <select
                    id="inviteRole"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                  >
                    <option value="member">Miembro</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              </div>
              <p className="hint">
                No se envía ningún correo automático: avísale tú. Entrará a este equipo al
                registrarse o iniciar sesión con ese mismo correo.
              </p>
              <div className="actions" style={{ marginTop: "var(--s4)" }}>
                <button type="submit" className="btn" disabled={inviting}>
                  {inviting ? "Invitando…" : "Invitar"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowInvite(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {invitations.length > 0 && (
        <section className="card">
          <h2 className="card-title">Invitaciones pendientes</h2>
          <ul className="list">
            {invitations.map((i) => (
              <li key={i.id}>
                <strong className="truncate">{i.email}</strong>
                <span className="spacer" style={{ display: "flex", alignItems: "center", gap: "var(--s3)" }}>
                  <span className="badge">{ROLE_LABEL[i.role]}</span>
                  {canManage && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy === i.id}
                      onClick={() => cancelInvitation(i.id)}
                    >
                      Cancelar
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="hint" style={{ marginBottom: 0 }}>
            Se convierten en acceso real en cuanto esa persona entra con ese correo.
          </p>
        </section>
      )}
    </main>
  );
}
