"use client";

import { useCallback, useEffect, useState } from "react";
import { IconAlert, IconCalendar, IconExternal, IconPlus } from "@/app/icons";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";
import { usePlatforms } from "@/app/dashboard/use-platforms";

interface Row {
  postId: string;
  title: string;
  platform: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  status: string;
  remoteUrl: string | null;
  error: string | null;
}

interface Queue {
  timeZone: string;
  slots: { platform: string; next: string | null }[];
  grid: { platform: string; weekday: number; atTime: string }[];
  rows: Row[];
}

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const BADGE: Record<string, string> = {
  published: "badge badge-ok",
  scheduled: "badge badge-brand",
  publishing: "badge badge-brand",
  failed: "badge badge-danger",
  unknown: "badge badge-warn",
  pending: "badge",
  skipped: "badge",
};

const LABEL: Record<string, string> = {
  published: "publicado",
  scheduled: "programado",
  publishing: "publicando",
  failed: "falló",
  unknown: "sin confirmar",
  pending: "pendiente",
  skipped: "descartado",
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-ES", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export default function QueuePage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [platform, setPlatform] = useState("");
  const [weekday, setWeekday] = useState(1);
  const [atTime, setAtTime] = useState("10:00");
  const connected = usePlatforms();

  useEffect(() => {
    if (!platform && connected.names.length > 0) setPlatform(connected.names[0]!);
  }, [connected.names.join(","), platform]);

  const load = useCallback(async () => {
    const res = await fetch("/api/queue");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo cargar la cola.");
      return;
    }
    setQueue(json);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addSlot(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    const res = await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, weekday, atTime }),
    });
    const json = await res.json();

    if (!res.ok) {
      setError(json.error ?? "No se pudo guardar el hueco.");
      return;
    }
    setAdding(false);
    await load();
  }

  async function removeSlot(slot: { platform: string; weekday: number; atTime: string }) {
    const query = new URLSearchParams({
      platform: slot.platform,
      weekday: String(slot.weekday),
      atTime: slot.atTime.slice(0, 5),
    });
    await fetch(`/api/queue?${query}`, { method: "DELETE" });
    await load();
  }

  return (
    <main>
      <header className="page-head">
        <h1>Cola de publicación</h1>
        <p>Lo que va a salir, en qué red y cuándo.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Próximo hueco por red</h2>
          <button type="button" className="btn btn-sm" onClick={() => setAdding((a) => !a)}>
            <IconPlus />
            {adding ? "Cancelar" : "Configurar hueco"}
          </button>
        </div>

        {adding && (
          <form onSubmit={addSlot} className="row" style={{ marginBottom: "var(--s4)" }}>
            <div className="field">
              <label htmlFor="slot-platform">Red</label>
              <select
                id="slot-platform"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
              >
                {(connected.platforms ?? []).map((p) => (
                  <option key={p.platform} value={p.platform}>
                    {platformLabel(p.platform)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="slot-day">Día</label>
              <select
                id="slot-day"
                value={weekday}
                onChange={(e) => setWeekday(Number(e.target.value))}
              >
                {/* Se enseñan empezando en lunes, que es como se piensa la
                    semana aquí, aunque por dentro domingo sea el 0. */}
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <option key={d} value={d}>
                    {DAYS[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="slot-time">Hora</label>
              <input
                id="slot-time"
                type="time"
                value={atTime}
                onChange={(e) => setAtTime(e.target.value)}
              />
            </div>
            <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
              <button type="submit" className="btn" disabled={!platform}>
                Añadir
              </button>
            </div>
          </form>
        )}

        {queue === null ? (
          <div className="skeleton" style={{ width: "60%", height: "2rem" }} />
        ) : queue.slots.length === 0 ? (
          <p className="hint" style={{ marginTop: 0 }}>
            Todavía no has definido ningún hueco. Sin ellos hay que elegir fecha y hora a
            mano en cada publicación.
          </p>
        ) : (
          <div className="kpis">
            {queue.slots.map((s) => (
              <div className="kpi" key={s.platform}>
                <div className="kpi-head">
                  <span style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                    <PlatformIcon platform={s.platform} size={16} />
                    <strong style={{ fontSize: ".8125rem" }}>{platformLabel(s.platform)}</strong>
                  </span>
                </div>
                <div className="value" style={{ fontSize: "1.05rem" }}>
                  {when(s.next)}
                </div>
                <div className="label">Próximo hueco</div>
              </div>
            ))}
          </div>
        )}

        {queue && queue.grid.length > 0 && (
          <div className="chips" style={{ marginTop: "var(--s3)" }}>
            {queue.grid.map((g) => (
              <button
                key={`${g.platform}-${g.weekday}-${g.atTime}`}
                type="button"
                className="chip"
                onClick={() => removeSlot(g)}
                title="Quitar este hueco"
              >
                <PlatformIcon platform={g.platform} />
                {DAYS[g.weekday]} · {g.atTime.slice(0, 5)} ×
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">En cola</h2>

        {queue === null ? (
          <>
            <div className="skeleton" style={{ width: "80%" }} />
            <div className="skeleton" style={{ width: "60%" }} />
          </>
        ) : queue.rows.length === 0 ? (
          <div className="empty">
            <IconCalendar />
            <p>No hay nada programado ni publicado todavía.</p>
            <a href="/dashboard/plan" className="btn">
              Generar un plan
            </a>
          </div>
        ) : (
          <div className="table-wrap" style={{ marginTop: "var(--s3)" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Contenido</th>
                  <th>Red</th>
                  <th>Cuándo</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {queue.rows.map((r, i) => (
                  <tr key={`${r.postId}-${r.platform}-${i}`}>
                    <td>
                      <a href={`/dashboard/posts/${r.postId}`}>
                        <strong>{r.title || "(sin texto todavía)"}</strong>
                      </a>
                      {r.error && (
                        <div className="muted truncate" style={{ maxWidth: "22rem" }}>
                          {r.error}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                        <PlatformIcon platform={r.platform} size={16} />
                        {platformLabel(r.platform)}
                      </span>
                    </td>
                    <td>{when(r.publishedAt ?? r.scheduledAt)}</td>
                    <td>
                      <span className={BADGE[r.status] ?? "badge"}>
                        {LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="num">
                      {r.remoteUrl && (
                        <a
                          href={r.remoteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "inline-flex", gap: ".25rem", alignItems: "center" }}
                        >
                          Ver
                          <IconExternal />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {queue && (
        <p className="hint">
          Las horas se muestran en tu hora local y los huecos se guardan en la zona del
          negocio ({queue.timeZone}), así que un cambio de hora no los desplaza.
        </p>
      )}
    </main>
  );
}
