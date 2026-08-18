"use client";

import { useEffect, useState } from "react";
import { IconAlert, IconCalendar, IconCheck, IconExternal } from "@/app/icons";

import { usePlatforms } from "@/app/dashboard/use-platforms";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";
import { DateTimePicker } from "./DateTimePicker";

interface Item {
  id: string;
  idea: string;
  headline: string;
  rationale: string;
  suggested_platforms: string[];
  suggested_media: "none" | "image" | "video";
  scheduled_for: string | null;
  status: "idea" | "approved" | "dismissed" | "created";
  post_id: string | null;
  /** Se rellena al aprobar, si la fecha propuesta sigue en el futuro. */
  scheduledAt?: string | null;
  /** Presente solo si esta idea comenta una noticia real y verificada. */
  source_url: string | null;
  source_title: string | null;
}

/** Una fecha pasada no se puede programar: el post quedará listo a secas. */
const isFuture = (iso: string | null) =>
  iso !== null && new Date(`${iso}T23:59:59`).getTime() > Date.now();

/** Valor para <input type="datetime-local">: hora local sin zona. */
const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" })
    : "";

export default function PlanPage() {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(inDays(30));
  const [count, setCount] = useState(8);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const connected = usePlatforms();

  // Al conocerse las conectadas se preseleccionan todas: son las únicas donde
  // se puede publicar, así que no hay motivo para empezar con ninguna fuera.
  useEffect(() => {
    if (connected.names.length > 0) setPlatforms(connected.names);
  }, [connected.names.join(",")]);

  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [defaultHour, setDefaultHour] = useState(10);
  // Hora elegida a mano para cada idea. Vacío = usar la propuesta del plan.
  const [times, setTimes] = useState<Record<string, string>>({});
  // Solo se conoce justo después de generar: cuántas noticias se comprobaron
  // y cuántas acabaron encajando. Sin esto, "ninguna idea de actualidad" es
  // indistinguible de "no se buscó nada".
  const [newsStats, setNewsStats] = useState<{ found: number; used: number } | null>(null);

  // Si ya hay planes, abrimos el último en vez de una pantalla vacía.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/plans");
      const json = await res.json();
      if (res.ok && json.plans?.[0]) void openPlan(json.plans[0].id);
    })();
  }, []);

  async function openPlan(id: string) {
    const res = await fetch(`/api/plans/${id}`);
    const json = await res.json();
    if (!res.ok) return;

    // Se reabre un plan ya existente: la estadística de la búsqueda era de
    // aquel momento y no se guarda, así que no se muestra un dato viejo.
    setNewsStats(null);
    setItems(json.items);
    setTitle(json.plan.title);
    setDefaultHour(json.defaults?.publishHour ?? 10);

    // Cada idea arranca con su fecha propuesta y la hora por defecto de la
    // marca. Cambiarla es opcional: lo normal es aprobar sin tocar nada.
    const hour = json.defaults?.publishHour ?? 10;
    setTimes(
      Object.fromEntries(
        (json.items as Item[])
          .filter((i) => i.scheduled_for)
          .map((i) => {
            const d = new Date(`${i.scheduled_for}T00:00:00`);
            d.setHours(hour, 0, 0, 0);
            return [i.id, toLocalInput(d)];
          }),
      ),
    );
  }

  const toggle = (p: string) =>
    setPlatforms((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]));

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const res = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        periodStart: start,
        periodEnd: end,
        count,
        platforms,
        notes: notes || undefined,
      }),
    });
    const json = await res.json();
    setBusy(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo generar el plan.");
      return;
    }

    await openPlan(json.id);
    // Después de openPlan porque este limpia newsStats a null: el dato de esta
    // generación concreta se pone justo después, no antes.
    if (typeof json.newsFound === "number") {
      setNewsStats({ found: json.newsFound, used: json.newsUsed ?? 0 });
    }
  }

  async function act(item: Item, action: "approve" | "dismiss") {
    setError("");

    const chosen = times[item.id];
    const res = await fetch(`/api/plans/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        // `new Date` interpreta el input como hora local y toISOString la pasa
        // a UTC, que es como se guarda.
        scheduledAt:
          action === "approve" && chosen ? new Date(chosen).toISOString() : undefined,
      }),
    });
    const json = await res.json();

    if (!res.ok) {
      setError(json.error ?? "No se pudo actualizar la idea.");
      return;
    }

    setItems((current) =>
      current.map((i) =>
        i.id === item.id
          ? {
              ...i,
              status: json.status,
              post_id: json.postId ?? i.post_id,
              scheduledAt: json.scheduledAt ?? null,
            }
          : i,
      ),
    );
  }

  const pending = items.filter((i) => i.status === "idea").length;
  // Dos columnas, como pediste: lo propio del negocio a un lado, lo anclado a
  // actualidad real al otro. Se distinguen por si el backend validó una fuente,
  // no por texto — así no hay forma de que se etiquete mal.
  const companyItems = items.filter((i) => !i.source_url);
  const newsItems = items.filter((i) => i.source_url);

  function renderCard(item: Item) {
    return (
      <article
        key={item.id}
        className="card"
        style={{ opacity: item.status === "dismissed" ? 0.4 : 1 }}
      >
        <div className="card-head" style={{ marginBottom: "var(--s2)" }}>
          <span className={item.source_url ? "badge badge-ok" : "badge"}>
            {item.source_url ? "Actualidad" : "Empresa"}
          </span>
          <span className="muted" style={{ display: "flex", gap: ".35rem", alignItems: "center" }}>
            <IconCalendar className="" />
            {formatDate(item.scheduled_for)}
          </span>
        </div>

        {item.headline && (
          <p style={{ fontWeight: 600, margin: "0 0 var(--s1)" }}>{item.headline}</p>
        )}

        <p style={{ margin: "0 0 var(--s2)" }}>{item.idea}</p>
        <p className="muted" style={{ margin: 0 }}>
          {item.rationale}
        </p>
        <p className="muted" style={{ margin: "var(--s2) 0 0" }}>
          {item.suggested_platforms.join(" · ")}
          {item.suggested_media !== "none" && ` · ${item.suggested_media}`}
        </p>

        {item.source_url && (
          <p className="hint" style={{ margin: "var(--s2) 0 0" }}>
            Fuente:{" "}
            <a
              href={item.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", gap: ".25rem", alignItems: "center" }}
            >
              {item.source_title ?? "ver noticia"}
              <IconExternal className="" />
            </a>
            . Revísala antes de aprobar.
          </p>
        )}

        {item.status === "idea" && (
          <>
            {isFuture(item.scheduled_for) && (
              <div className="field" style={{ marginTop: "var(--s4)", marginBottom: 0 }}>
                <label htmlFor={`when-${item.id}`}>Cuándo se publica</label>
                <div style={{ maxWidth: "16rem" }}>
                  <DateTimePicker
                    id={`when-${item.id}`}
                    value={times[item.id] ?? ""}
                    onChange={(v) => setTimes((t) => ({ ...t, [item.id]: v }))}
                  />
                </div>
                <p className="hint" style={{ marginBottom: 0 }}>
                  Prerrellenado con la fecha propuesta y tu hora habitual (
                  {String(defaultHour).padStart(2, "0")}:00). Cámbialo si quieres.
                </p>
              </div>
            )}

            <div className="actions" style={{ marginTop: "var(--s4)" }}>
              <button type="button" className="btn btn-sm" onClick={() => act(item, "approve")}>
                {isFuture(item.scheduled_for) ? "Aprobar y programar" : "Aprobar y generar"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => act(item, "dismiss")}
              >
                Descartar
              </button>
            </div>

            {!isFuture(item.scheduled_for) && (
              <p className="hint" style={{ marginBottom: 0 }}>
                Esa fecha ya pasó: quedará listo para publicar a mano.
              </p>
            )}
          </>
        )}

        {item.status === "created" && item.post_id && (
          <p style={{ margin: "var(--s4) 0 0" }}>
            <a href={`/dashboard/posts/${item.post_id}`}>
              {item.scheduledAt ? "Ver el post programado →" : "Ver el post generado →"}
            </a>
          </p>
        )}

        {item.status === "dismissed" && (
          <p className="muted" style={{ margin: "var(--s3) 0 0" }}>
            <IconCheck className="" /> Descartada
          </p>
        )}
      </article>
    );
  }

  return (
    <main>
      <header className="page-head">
        <h1>Plan de contenido</h1>
        <p>Genera una tanda de ideas para el periodo, revísalas y aprueba las que valgan.</p>
      </header>

      <form onSubmit={generate}>
        <section className="card">
          <div className="field">
            <label htmlFor="title">Nombre del plan</label>
            <input
              id="title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Septiembre 2026"
            />
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="start">Desde</label>
              <DateTimePicker id="start" value={start} onChange={setStart} withTime={false} />
            </div>
            <div className="field">
              <label htmlFor="end">Hasta</label>
              <DateTimePicker id="end" value={end} onChange={setEnd} withTime={false} />
            </div>
            <div className="field" style={{ maxWidth: "7rem" }}>
              <label htmlFor="count">Ideas</label>
              <input
                id="count"
                type="number"
                min={3}
                max={20}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="field">
            <label>Redes</label>
            {connected.loading ? (
              <div className="skeleton" style={{ width: "60%", height: "2rem" }} />
            ) : connected.names.length === 0 ? (
              <p className="hint" style={{ marginTop: 0 }}>
                No tienes ninguna red conectada.{" "}
                <a href="/dashboard/accounts">Conéctalas primero</a> y vuelve aquí.
              </p>
            ) : (
              <div className="chips">
                {connected.platforms!.map((p) => (
                  <button
                    key={p.platform}
                    type="button"
                    className="chip"
                    aria-pressed={platforms.includes(p.platform)}
                    onClick={() => toggle(p.platform)}
                    title={p.handle}
                  >
                    <PlatformIcon platform={p.platform} />
                    {platformLabel(p.platform)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="notes">Novedades o campañas de este periodo</label>
            <input
              id="notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="lanzamos el servicio de auditoría, estaremos en un evento el día 12"
            />
            <p className="hint">Opcional. Ayuda a que las ideas encajen con lo que pasa de verdad.</p>
          </div>
        </section>

        {error && (
          <p className="error" role="alert">
            <IconAlert />
            {error}
          </p>
        )}

        <button type="submit" className="btn" disabled={busy || platforms.length === 0}>
          {busy ? "Pensando ideas…" : "Generar plan"}
        </button>
      </form>

      {busy && (
        <section className="card" style={{ marginTop: "var(--s5)" }}>
          <div className="skeleton" style={{ width: "70%", height: "1rem" }} />
          <div className="skeleton" style={{ width: "90%" }} />
          <div className="skeleton" style={{ width: "45%" }} />
        </section>
      )}

      {items.length > 0 && (
        <section style={{ marginTop: "var(--s6)" }}>
          <div className="card-head">
            <h2>{title}</h2>
            <span className="badge">
              {pending} sin revisar de {items.length}
            </span>
          </div>

          {newsStats && (
            <p className="hint" style={{ marginTop: 0, marginBottom: "var(--s4)" }}>
              {newsStats.found === 0
                ? "No había temas de actualidad configurados, o no encontramos noticias recientes de ellos."
                : newsStats.used > 0
                  ? `Comprobamos ${newsStats.found} noticias de tus temas; ${newsStats.used} encajaba con el negocio.`
                  : `Comprobamos ${newsStats.found} noticias de tus temas y ninguna encajaba bien esta vez — es preferible eso a forzar una.`}
            </p>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "var(--s4)",
              alignItems: "start",
            }}
            className="plan-columns"
          >
            <div>
              <h3 style={{ fontSize: ".9rem", color: "var(--text-muted)", marginBottom: "var(--s3)" }}>
                Ideas de la empresa · {companyItems.length}
              </h3>
              {companyItems.length === 0 ? (
                <p className="hint">Ninguna en este plan.</p>
              ) : (
                companyItems.map(renderCard)
              )}
            </div>

            <div>
              <h3 style={{ fontSize: ".9rem", color: "var(--text-muted)", marginBottom: "var(--s3)" }}>
                Actualidad del sector · {newsItems.length}
              </h3>
              {newsItems.length === 0 ? (
                <p className="hint">
                  Ninguna esta vez. Añade o afina los temas en{" "}
                  <a href="/dashboard/brand">Empresa</a> para tener más donde elegir.
                </p>
              ) : (
                newsItems.map(renderCard)
              )}
            </div>
          </div>
        </section>
      )}

      <style>{`
        @media (max-width: 860px) {
          .plan-columns { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}
