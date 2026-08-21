"use client";

import { useEffect, useState } from "react";
import { IconAlert, IconTrash, IconUsers } from "@/app/icons";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";
import { LIMITS_BY_PLATFORM } from "@/domain/platform-rules";

interface Snapshot {
  id: string;
  snapshot_date: string;
  followers: number | null;
  posts_per_week: number | null;
  best_format: string | null;
  notes: string | null;
  source: "manual" | "youtube_api";
}

interface Competitor {
  id: string;
  platform: string;
  handle: string;
  display_name: string | null;
  latest: Snapshot | null;
  previous: Snapshot | null;
}

const PLATFORMS = Object.keys(LIMITS_BY_PLATFORM);
const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("es-ES"));

function FollowerDelta({ latest, previous }: { latest: Snapshot | null; previous: Snapshot | null }) {
  if (!latest || !previous || latest.followers === null || previous.followers === null) return null;
  if (previous.followers === 0) return null;
  const pct = Math.round(((latest.followers - previous.followers) / previous.followers) * 100);
  if (pct === 0) return null;
  return (
    <span className={pct > 0 ? "delta delta-up" : "delta delta-down"}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

interface ManualValues {
  followers: string;
  postsPerWeek: string;
  bestFormat: string;
  notes: string;
}

/** Formulario de un nuevo punto manual: seguidores, ritmo, formato que mejor le funciona. */
function ManualFields({
  values,
  onChange,
}: {
  values: ManualValues;
  onChange: (values: ManualValues) => void;
}) {
  return (
    <div className="row">
      <div className="field">
        <label>Seguidores</label>
        <input
          type="number"
          min={0}
          value={values.followers}
          onChange={(e) => onChange({ ...values, followers: e.target.value })}
          placeholder="12400"
        />
      </div>
      <div className="field">
        <label>Posts/semana</label>
        <input
          type="number"
          min={0}
          step="0.5"
          value={values.postsPerWeek}
          onChange={(e) => onChange({ ...values, postsPerWeek: e.target.value })}
          placeholder="4"
        />
      </div>
      <div className="field" style={{ flex: 2 }}>
        <label>Qué le funciona</label>
        <input
          type="text"
          value={values.bestFormat}
          onChange={(e) => onChange({ ...values, bestFormat: e.target.value })}
          placeholder="Reels de antes/después"
        />
      </div>
    </div>
  );
}

const emptyManual = { followers: "", postsPerWeek: "", bestFormat: "", notes: "" };

export default function CompetitorsPage() {
  const [competitors, setCompetitors] = useState<Competitor[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [platform, setPlatform] = useState("instagram");
  const [handle, setHandle] = useState("");
  const [manual, setManual] = useState(emptyManual);

  const [updating, setUpdating] = useState<string | null>(null);
  const [updateFields, setUpdateFields] = useState(emptyManual);

  async function load() {
    const res = await fetch("/api/competitors");
    const json = await res.json();
    if (res.ok) setCompetitors(json.competitors);
  }

  useEffect(() => {
    void load();
  }, []);

  async function addCompetitor(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const res = await fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        handle,
        followers: manual.followers ? Number(manual.followers) : undefined,
        postsPerWeek: manual.postsPerWeek ? Number(manual.postsPerWeek) : undefined,
        bestFormat: manual.bestFormat || undefined,
        notes: manual.notes || undefined,
      }),
    });
    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo añadir el competidor.");
      return;
    }
    setHandle("");
    setManual(emptyManual);
    await load();
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar este competidor y todo su histórico?")) return;
    const res = await fetch(`/api/competitors/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  async function refreshYoutube(id: string) {
    setUpdating(id);
    setError("");
    const res = await fetch(`/api/competitors/${id}/refresh`, { method: "POST" });
    const json = await res.json();
    setUpdating(null);
    if (!res.ok) {
      setError(json.error ?? "No se pudo actualizar.");
      return;
    }
    await load();
  }

  async function addSnapshot(id: string) {
    setUpdating(id);
    setError("");
    const res = await fetch(`/api/competitors/${id}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        followers: updateFields.followers ? Number(updateFields.followers) : undefined,
        postsPerWeek: updateFields.postsPerWeek ? Number(updateFields.postsPerWeek) : undefined,
        bestFormat: updateFields.bestFormat || undefined,
        notes: updateFields.notes || undefined,
      }),
    });
    const json = await res.json();
    setUpdating(null);
    if (!res.ok) {
      setError(json.error ?? "No se pudo guardar.");
      return;
    }
    setUpdateFields(emptyManual);
    await load();
  }

  return (
    <main>
      <header className="page-head">
        <h1>Competidores</h1>
        <p>
          YouTube se actualiza solo (API oficial). El resto de redes no tienen esa vía sin
          saltarse sus condiciones de uso, así que el dato lo escribes tú, cuando ya lo estás
          mirando en la app de esa red.
        </p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      <form onSubmit={addCompetitor} className="card">
        <h2 className="card-title">Añadir competidor</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="platform">Red</label>
            <select id="platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {platformLabel(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="handle">Usuario o canal</label>
            <input
              id="handle"
              type="text"
              required
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder={platform === "youtube" ? "@canal" : "@usuario"}
            />
          </div>
        </div>

        {platform === "youtube" ? (
          <p className="hint" style={{ marginBottom: 0 }}>
            Se consulta la API de YouTube al guardar — no hace falta rellenar nada más.
          </p>
        ) : (
          <>
            <p className="hint">Opcional: si ya tienes el dato a mano, ahórrate el segundo paso.</p>
            <ManualFields values={manual} onChange={setManual} />
          </>
        )}

        <div style={{ marginTop: "var(--s4)" }}>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Añadiendo…" : "Añadir"}
          </button>
        </div>
      </form>

      {competitors === null ? (
        <section className="card">
          <div className="skeleton" style={{ width: "60%" }} />
        </section>
      ) : competitors.length === 0 ? (
        <section className="card">
          <div className="empty">
            <IconUsers />
            <p>Todavía no has añadido ningún competidor.</p>
          </div>
        </section>
      ) : (
        <div className="grid-2">
          {competitors.map((c) => (
            <section className="card" key={c.id}>
              <div className="card-head">
                <span style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
                  <PlatformIcon platform={c.platform} size={20} />
                  <strong>{c.display_name || c.handle}</strong>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => remove(c.id)}
                  aria-label="Eliminar competidor"
                  title="Eliminar competidor"
                >
                  <IconTrash />
                </button>
              </div>
              <p className="muted" style={{ marginTop: 0, marginBottom: "var(--s3)" }}>
                {c.handle}
              </p>

              {c.latest ? (
                <>
                  <div className="metrics">
                    <div>
                      <span className="stat">
                        {fmt(c.latest.followers)} <FollowerDelta latest={c.latest} previous={c.previous} />
                      </span>
                      <span className="muted">Seguidores</span>
                    </div>
                    {c.latest.posts_per_week !== null && (
                      <div>
                        <span className="stat">{c.latest.posts_per_week}</span>
                        <span className="muted">Posts/semana</span>
                      </div>
                    )}
                  </div>
                  {c.latest.best_format && <p style={{ marginBottom: "var(--s2)" }}>{c.latest.best_format}</p>}
                  {c.latest.notes && (
                    <p className="muted" style={{ marginBottom: "var(--s2)" }}>
                      {c.latest.notes}
                    </p>
                  )}
                  <p className="hint" style={{ marginBottom: 0 }}>
                    {c.latest.source === "youtube_api" ? "Automático" : "Manual"} ·{" "}
                    {new Date(`${c.latest.snapshot_date}T12:00:00`).toLocaleDateString("es-ES", {
                      day: "numeric",
                      month: "short",
                    })}
                  </p>
                </>
              ) : (
                <p className="hint" style={{ marginBottom: "var(--s3)" }}>
                  Sin ningún dato todavía.
                </p>
              )}

              <div style={{ marginTop: "var(--s3)" }}>
                {c.platform === "youtube" ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={updating === c.id}
                    onClick={() => refreshYoutube(c.id)}
                  >
                    {updating === c.id ? "Actualizando…" : "Actualizar"}
                  </button>
                ) : updating === c.id ? (
                  <>
                    <ManualFields values={updateFields} onChange={setUpdateFields} />
                    <div className="actions" style={{ marginTop: "var(--s2)" }}>
                      <button type="button" className="btn btn-sm" onClick={() => addSnapshot(c.id)}>
                        Guardar
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setUpdating(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setUpdateFields(emptyManual);
                      setUpdating(c.id);
                    }}
                  >
                    Añadir dato
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
