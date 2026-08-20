"use client";

import { useCallback, useEffect, useState } from "react";
import { IconAlert } from "@/app/icons";

interface Member {
  userId: string;
  role: "owner" | "admin" | "member";
  email: string;
  isMe: boolean;
}

const ROLE_LABEL: Record<Member["role"], string> = {
  owner: "Propietario",
  admin: "Administrador",
  member: "Miembro",
};

export default function TeamPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [myRole, setMyRole] = useState<Member["role"] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/team");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo cargar el equipo.");
      return;
    }
    setMembers(json.members);
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

      <p className="hint">
        Invitar a alguien nuevo todavía no tiene botón aquí: solo entra quien ya tenga
        cuenta y ya pertenezca a este equipo. Dilo si lo necesitas y lo añadimos.
      </p>
    </main>
  );
}
