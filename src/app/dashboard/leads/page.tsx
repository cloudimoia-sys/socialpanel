"use client";

import { useEffect, useState } from "react";
import { IconAlert, IconPlus, IconTrash } from "@/app/icons";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";
import { LIMITS_BY_PLATFORM } from "@/domain/platform-rules";

type Status = "nuevo" | "contactado" | "presupuesto" | "ganado" | "perdido";

interface Lead {
  id: string;
  name: string | null;
  platform: string | null;
  handle: string | null;
  message: string | null;
  company: string | null;
  status: Status;
  value_cents: number | null;
  source: "manual" | "inbox";
  created_at: string;
}

const COLUMNS: { status: Status; label: string }[] = [
  { status: "nuevo", label: "Nuevo" },
  { status: "contactado", label: "Contactado" },
  { status: "presupuesto", label: "Presupuesto" },
  { status: "ganado", label: "Ganado" },
  { status: "perdido", label: "Perdido" },
];

const PLATFORMS = Object.keys(LIMITS_BY_PLATFORM);
const euros = (cents: number | null) => (cents === null ? null : `${(cents / 100).toFixed(0)} €`);

const emptyForm = { name: "", platform: "", handle: "", company: "", message: "", valueCents: "" };

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  async function load() {
    const res = await fetch("/api/leads");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo cargar el pipeline.");
      setLeads([]);
      return;
    }
    setLeads(json.leads);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name || undefined,
        platform: form.platform || undefined,
        handle: form.handle || undefined,
        company: form.company || undefined,
        message: form.message || undefined,
        valueCents: form.valueCents ? Math.round(Number(form.valueCents) * 100) : undefined,
      }),
    });
    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo crear el lead.");
      return;
    }
    setForm(emptyForm);
    setShowForm(false);
    await load();
  }

  async function changeStatus(lead: Lead, status: Status) {
    setBusy((b) => new Set(b).add(lead.id));
    setLeads((current) =>
      (current ?? []).map((l) => (l.id === lead.id ? { ...l, status } : l)),
    );

    const res = await fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    setBusy((b) => {
      const next = new Set(b);
      next.delete(lead.id);
      return next;
    });

    if (!res.ok) {
      setError("No se pudo mover el lead. Recargando.");
      await load();
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar este lead?")) return;
    const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  const byStatus = (status: Status) => (leads ?? []).filter((l) => l.status === status);

  return (
    <main>
      <header className="page-head">
        <h1>Leads</h1>
        <p>Contactos con intención real de contratar, con estado, no mensajes perdidos en un hilo.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      {!showForm ? (
        <button type="button" className="btn" onClick={() => setShowForm(true)} style={{ marginBottom: "var(--s4)" }}>
          <IconPlus />
          Nuevo lead
        </button>
      ) : (
        <form onSubmit={create} className="card">
          <div className="row">
            <div className="field">
              <label>Nombre</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Empresa</label>
              <input type="text" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Red</label>
              <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                <option value="">Otro / no aplica</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {platformLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Usuario o contacto</label>
              <input type="text" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} />
            </div>
            <div className="field">
              <label>Valor estimado (€)</label>
              <input
                type="number"
                min={0}
                value={form.valueCents}
                onChange={(e) => setForm({ ...form, valueCents: e.target.value })}
              />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Mensaje o nota</label>
            <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={2} />
          </div>
          <div className="actions" style={{ marginTop: "var(--s4)" }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {leads === null ? (
        <section className="card">
          <div className="skeleton" style={{ width: "60%" }} />
        </section>
      ) : (
        <div className="kanban-scroll">
          <div className="kanban">
            {COLUMNS.map((col) => {
              const items = byStatus(col.status);
              return (
                <div className="kanban-col" key={col.status}>
                  <div className="kanban-col-head">
                    <strong>{col.label}</strong>
                    <span className="muted">{items.length}</span>
                  </div>

                  {items.length === 0 ? (
                    <p className="hint" style={{ margin: 0 }}>
                      Nada aquí.
                    </p>
                  ) : (
                    items.map((l) => (
                      <div className="kanban-card" key={l.id}>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
                          {l.platform && <PlatformIcon platform={l.platform} size={14} />}
                          <p className="truncate" style={{ margin: 0, fontWeight: 600, fontSize: ".875rem", flex: 1 }}>
                            {l.name || l.handle || "Sin nombre"}
                          </p>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => remove(l.id)}
                            aria-label="Eliminar lead"
                            title="Eliminar lead"
                          >
                            <IconTrash />
                          </button>
                        </div>
                        {l.company && (
                          <p className="muted" style={{ margin: "var(--s1) 0 0", fontSize: ".75rem" }}>
                            {l.company}
                          </p>
                        )}
                        {l.message && (
                          <p className="muted truncate" style={{ margin: "var(--s1) 0 0", fontSize: ".75rem" }}>
                            {l.message}
                          </p>
                        )}
                        {l.value_cents !== null && (
                          <p style={{ margin: "var(--s1) 0 0", fontSize: ".8125rem", fontWeight: 600 }}>
                            {euros(l.value_cents)}
                          </p>
                        )}
                        <select
                          value={l.status}
                          disabled={busy.has(l.id)}
                          onChange={(e) => changeStatus(l, e.target.value as Status)}
                          style={{ marginTop: "var(--s2)", width: "100%", fontSize: ".75rem" }}
                        >
                          {COLUMNS.map((c) => (
                            <option key={c.status} value={c.status}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
