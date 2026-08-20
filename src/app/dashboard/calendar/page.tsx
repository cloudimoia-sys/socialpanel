"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconAlert, IconArrowLeft } from "@/app/icons";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";

interface Post {
  id: string;
  status: string;
  caption: string | null;
  brief: string | null;
  scheduled_at: string | null;
  scheduled_platforms: string[];
}

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

const STATUS_LABEL: Record<string, string> = {
  draft: "borrador",
  generating: "generando",
  ready: "listo",
  scheduled: "programado",
  publishing: "publicando",
  published: "publicado",
  failed: "falló",
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function CalendarPage() {
  const [month, setMonth] = useState(() => new Date());
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  /**
   * Se piden los seis semanas completas que se pintan, no el mes natural: la
   * rejilla enseña días del mes anterior y del siguiente, y sin ellos esas
   * casillas saldrían vacías aunque tuvieran publicaciones.
   */
  const range = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - offset);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 41);
    return { start, end };
  }, [month]);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ from: isoDay(range.start), to: isoDay(range.end) });
    const res = await fetch(`/api/posts?${query}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo cargar el calendario.");
      setPosts([]);
      return;
    }
    setPosts(json.posts);
  }, [range.start, range.end]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Publicaciones agrupadas por día local, que es como se leen en la rejilla. */
  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const post of posts ?? []) {
      if (!post.scheduled_at) continue;
      const key = isoDay(new Date(post.scheduled_at));
      map.set(key, [...(map.get(key) ?? []), post]);
    }
    return map;
  }, [posts]);

  const weeks = useMemo(() => {
    const days = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(range.start);
      d.setDate(d.getDate() + i);
      return d;
    });
    return Array.from({ length: 6 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  }, [range.start]);

  const monthLabel = month.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const today = isoDay(new Date());
  const selectedPosts = selected ? (byDay.get(selected) ?? []) : [];

  return (
    <main>
      <header className="page-head">
        <h1>Calendario</h1>
        <p>Todo lo programado, mes a mes.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      <section className="card">
        <div className="card-head">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Mes anterior"
              onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            >
              <IconArrowLeft />
            </button>
            <strong style={{ textTransform: "capitalize", minWidth: "9rem" }}>{monthLabel}</strong>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Mes siguiente"
              style={{ transform: "rotate(180deg)" }}
              onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            >
              <IconArrowLeft />
            </button>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth(new Date())}>
            Hoy
          </button>
        </div>

        <div className="cal-weekdays">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div className="cal-week" key={wi}>
            {week.map((day) => {
              const key = isoDay(day);
              const items = byDay.get(key) ?? [];
              return (
                <button
                  type="button"
                  key={key}
                  className="cal-day"
                  data-outside={day.getMonth() !== month.getMonth() || undefined}
                  data-today={key === today || undefined}
                  data-selected={key === selected || undefined}
                  onClick={() => setSelected(key === selected ? null : key)}
                  aria-label={`${day.getDate()} — ${items.length} publicaciones`}
                >
                  <span className="cal-num">{day.getDate()}</span>
                  <span className="cal-dots">
                    {/* Como mucho cuatro marcas: más no caben y dejan de contarse
                        de un vistazo, que es para lo único que sirven. */}
                    {items.slice(0, 4).map((p) => (
                      <span key={p.id} className="cal-dot" data-status={p.status} />
                    ))}
                    {items.length > 4 && <span className="cal-more">+{items.length - 4}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </section>

      {selected && (
        <section className="card">
          <h2 className="card-title">
            {new Date(`${selected}T12:00:00`).toLocaleDateString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h2>

          {selectedPosts.length === 0 ? (
            <p className="hint" style={{ marginBottom: 0 }}>
              Nada programado ese día.{" "}
              <a href="/dashboard/new">Crear una publicación</a>.
            </p>
          ) : (
            <ul className="list" style={{ marginTop: "var(--s3)" }}>
              {selectedPosts.map((p) => (
                <li key={p.id}>
                  <span className="badge">{STATUS_LABEL[p.status] ?? p.status}</span>
                  <a href={`/dashboard/posts/${p.id}`} className="truncate">
                    <strong>{(p.caption ?? p.brief ?? "(sin texto)").slice(0, 70)}</strong>
                  </a>
                  <span className="spacer" style={{ display: "flex", gap: ".3rem" }}>
                    {p.scheduled_platforms.map((platform) => (
                      <span key={platform} title={platformLabel(platform)} style={{ display: "flex" }}>
                        <PlatformIcon platform={platform} size={16} />
                      </span>
                    ))}
                  </span>
                  <span className="muted">
                    {p.scheduled_at
                      ? new Date(p.scheduled_at).toLocaleTimeString("es-ES", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="hint">
        El color de cada marca indica el estado: gris para lo que aún se está generando, azul
        para lo programado, verde para lo publicado y rojo si algo falló.
      </p>
    </main>
  );
}
