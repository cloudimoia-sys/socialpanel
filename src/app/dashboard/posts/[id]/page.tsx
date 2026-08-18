"use client";

import { use, useCallback, useEffect, useState } from "react";
import { IconAlert, IconArrowLeft, IconCalendar, IconCheck, IconExternal } from "@/app/icons";

interface Target {
  platform: string;
  status: string;
  remote_url: string | null;
  error: string | null;
}

interface PostState {
  id: string;
  status:
    | "draft"
    | "generating"
    | "ready"
    | "scheduled"
    | "publishing"
    | "published"
    | "failed";
  caption: string | null;
  hashtags: string[];
  error: string | null;
  scheduledAt: string | null;
  scheduledPlatforms: string[];
  mediaUrl: string | null;
  mediaKind: "image" | "video" | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  targets: Target[];
}

const LABEL: Record<PostState["status"], { text: string; badge: string }> = {
  draft: { text: "Borrador", badge: "badge" },
  generating: { text: "Generando", badge: "badge badge-brand" },
  ready: { text: "Listo para revisar", badge: "badge badge-ok" },
  scheduled: { text: "Programado", badge: "badge badge-brand" },
  publishing: { text: "Publicando", badge: "badge badge-brand" },
  published: { text: "Publicado", badge: "badge badge-ok" },
  failed: { text: "Falló", badge: "badge badge-danger" },
};

/** Valor para <input type="datetime-local">: hora local sin zona. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

const TARGET_BADGE: Record<string, string> = {
  published: "badge badge-ok",
  failed: "badge badge-danger",
  unknown: "badge badge-warn",
  skipped: "badge",
  pending: "badge",
};

import { usePlatforms } from "@/app/dashboard/use-platforms";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";

export default function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [post, setPost] = useState<PostState | null>(null);
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const [rescheduling, setRescheduling] = useState(false);
  const connected = usePlatforms();

  useEffect(() => {
    if (connected.names.length > 0) setPlatforms(connected.names);
  }, [connected.names.join(",")]);
  // Por defecto, mañana a las 10:00 — hora razonable para redes y lo bastante
  // lejos como para poder cancelar sin prisa.
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 86400000);
    d.setHours(10, 0, 0, 0);
    return toLocalInput(d);
  });

  const load = useCallback(async () => {
    const res = await fetch(`/api/posts/${id}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo cargar el post.");
      return null;
    }
    setPost(json);
    return json as PostState;
  }, [id]);

  // Sondeo mientras haya trabajo en curso. Se para solo al terminar, para no
  // dejar una pestaña golpeando el servidor indefinidamente.
  useEffect(() => {
    let active = true;

    const tick = async () => {
      const current = await load();
      if (!active || !current) return;
      if (current.status === "generating" || current.status === "publishing") {
        setTimeout(tick, 3000);
      }
    };

    void tick();
    return () => {
      active = false;
    };
  }, [load, round]);

  async function publish() {
    setPublishing(true);
    setError("");

    const res = await fetch(`/api/posts/${id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platforms }),
    });
    const json = await res.json();
    setPublishing(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo publicar.");
      return;
    }
    setRound((r) => r + 1);
  }

  async function schedule() {
    setPublishing(true);
    setError("");

    const res = await fetch(`/api/posts/${id}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `new Date` interpreta el valor del input como hora LOCAL y toISOString
      // lo pasa a UTC. Mandar la cadena sin convertir programaría a otra hora.
      body: JSON.stringify({ scheduledAt: new Date(when).toISOString(), platforms }),
    });
    const json = await res.json();
    setPublishing(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo programar.");
      return;
    }
    setRescheduling(false);
    setRound((r) => r + 1);
  }

  async function cancelSchedule() {
    setPublishing(true);
    setError("");

    const res = await fetch(`/api/posts/${id}/schedule`, { method: "DELETE" });
    const json = await res.json();
    setPublishing(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo cancelar.");
      return;
    }
    setRound((r) => r + 1);
  }

  const toggle = (p: string) =>
    setPlatforms((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]));

  if (!post) {
    return (
      <main>
        <div className="card">
          <div className="skeleton" style={{ width: "35%", height: "1.2rem" }} />
          <div className="skeleton" style={{ width: "90%" }} />
          <div className="skeleton" style={{ width: "70%" }} />
        </div>
        {error && (
          <p className="error" role="alert">
            <IconAlert />
            {error}
          </p>
        )}
      </main>
    );
  }

  const state = LABEL[post.status];
  const working = post.status === "generating" || post.status === "publishing";
  // Redes cuyo resultado no está confirmado: reintentar sobre ellas puede
  // duplicar el post.
  const unconfirmed = post.targets.filter((t) => t.status === "unknown").map((t) => t.platform);
  const canPublish = post.status === "ready" || (post.status === "failed" && post.caption);

  // Resumen directo de dónde acabó publicado de verdad. La lista de abajo
  // (con insignia por red) sigue estando para el detalle, pero "publicado en
  // instagram, facebook" es la respuesta que se busca de un vistazo, no algo
  // que haya que deducir leyendo insignias una a una.
  const publishedIn = post.targets.filter((t) => t.status === "published").map((t) => t.platform);
  const notPublishedIn = post.targets.filter((t) => t.status !== "published");

  return (
    <main>
      <a href="/dashboard" className="muted" style={{ display: "inline-flex", gap: ".35rem", alignItems: "center" }}>
        <IconArrowLeft className="" />
        Volver al panel
      </a>

      <header className="page-head" style={{ marginTop: "var(--s3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)" }}>
          <h1>{state.text}</h1>
          {working && <span className={state.badge}>en curso</span>}
        </div>
        {working && <p>Esto puede tardar unos minutos si lleva vídeo.</p>}
      </header>

      {post.status === "published" && (
        <section className="card" style={{ borderColor: "var(--ok)" }}>
          <div className="card-head">
            <h2 className="card-title" style={{ color: "var(--ok)" }}>
              Publicado en
            </h2>
            <IconCheck className="" />
          </div>

          {publishedIn.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s3)" }}>
              {publishedIn.map((platform) => (
                <span
                  key={platform}
                  style={{ display: "inline-flex", alignItems: "center", gap: ".4rem", fontWeight: 600 }}
                >
                  <PlatformIcon platform={platform} size={18} />
                  {platformLabel(platform)}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No se completó ninguna publicación — mira el detalle abajo.
            </p>
          )}

          {notPublishedIn.length > 0 && (
            <p className="hint" style={{ marginTop: "var(--s2)", marginBottom: 0 }}>
              No en {notPublishedIn.map((t) => platformLabel(t.platform)).join(", ")} — detalle
              más abajo.
            </p>
          )}
        </section>
      )}

      {post.error && (
        <p className="error" role="alert">
          <IconAlert />
          {post.error}
        </p>
      )}

      {working && !post.caption && (
        <div className="card">
          <div className="skeleton" style={{ width: "80%" }} />
          <div className="skeleton" style={{ width: "95%" }} />
          <div className="skeleton" style={{ width: "60%" }} />
        </div>
      )}

      {post.caption && (
        <section className="card">
          <h2 className="card-title">Texto</h2>
          <p style={{ whiteSpace: "pre-wrap", margin: "var(--s2) 0 0" }}>{post.caption}</p>
          {post.hashtags.length > 0 && (
            <p className="muted" style={{ margin: "var(--s3) 0 0" }}>
              {post.hashtags.map((h) => `#${h}`).join(" ")}
            </p>
          )}
          {post.sourceUrl && (
            <p className="hint" style={{ margin: "var(--s3) 0 0" }}>
              Fuente:{" "}
              <a
                href={post.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", gap: ".25rem", alignItems: "center" }}
              >
                {post.sourceTitle ?? "ver noticia"}
                <IconExternal className="" />
              </a>
              . Revísala antes de aprobar.
            </p>
          )}
        </section>
      )}

      {post.mediaUrl && (
        <section className="card">
          <h2 className="card-title">Pieza</h2>
          <div style={{ marginTop: "var(--s3)" }}>
            {post.mediaKind === "video" ? (
              <video
                src={post.mediaUrl}
                controls
                style={{ width: "100%", borderRadius: "var(--r2)", display: "block" }}
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={post.mediaUrl}
                alt="Pieza generada para el post"
                style={{ width: "100%", borderRadius: "var(--r2)", display: "block" }}
              />
            )}
          </div>
        </section>
      )}

      {post.targets.length > 0 && (
        <section className="card">
          <h2 className="card-title">Resultado por red</h2>
          <ul className="list">
            {post.targets.map((t) => (
              <li key={t.platform}>
                <span className={TARGET_BADGE[t.status] ?? "badge"}>
                  {t.status === "unknown" ? "sin confirmar" : t.status}
                </span>
                <PlatformIcon platform={t.platform} size={18} />
                <span>{platformLabel(t.platform)}</span>
                {t.error && <span className="muted truncate">{t.error}</span>}
                {t.remote_url && (
                  <a
                    href={t.remote_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="spacer"
                    style={{ display: "inline-flex", gap: ".3rem", alignItems: "center" }}
                  >
                    Ver
                    <IconExternal className="" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {unconfirmed.length > 0 && (
        <section className="card notice-warn">
          <div className="card-head">
            <h2 className="card-title" style={{ color: "var(--warn)" }}>
              Comprueba antes de reintentar
            </h2>
            <IconAlert className="" />
          </div>
          <p style={{ margin: 0 }}>
            No hemos podido confirmar el resultado en <strong>{unconfirmed.join(", ")}</strong>.
            La petición sí salió, así que puede haberse publicado igualmente. Míralo en la red
            antes de volver a intentarlo o acabarás con el post duplicado.
          </p>
        </section>
      )}

      {post.status === "scheduled" && post.scheduledAt && (
        <section className="card" style={{ borderColor: "var(--brand)" }}>
          <div className="card-head">
            <h2 className="card-title">Programado</h2>
            <IconCalendar className="" />
          </div>
          <p style={{ margin: "0 0 var(--s2)" }}>
            Se publicará el <strong>{formatWhen(post.scheduledAt)}</strong> en{" "}
            {post.scheduledPlatforms.join(", ")}.
          </p>
          <p className="muted" style={{ marginBottom: "var(--s4)" }}>
            La comprobación es cada 5 minutos, así que puede salir con unos minutos de
            margen.
          </p>

          {rescheduling ? (
            <>
              <div className="field">
                <label>Redes</label>
                <div className="chips">
                  {(connected.platforms ?? []).map((p) => (
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
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="rewhen">Nueva fecha y hora</label>
                <div className="row">
                  <input
                    id="rewhen"
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={schedule}
                    disabled={publishing || platforms.length === 0}
                    style={{ flex: "0 0 auto" }}
                  >
                    {publishing ? "Guardando…" : "Guardar cambio"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setRescheduling(false)}
                    disabled={publishing}
                    style={{ flex: "0 0 auto" }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  // Se parte de lo que ya tiene programado, no de un valor por
                  // defecto: reprogramar suele ser mover un poco, no empezar
                  // de cero.
                  setWhen(toLocalInput(new Date(post.scheduledAt!)));
                  setPlatforms(post.scheduledPlatforms);
                  setRescheduling(true);
                }}
                disabled={publishing}
              >
                Reprogramar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={cancelSchedule}
                disabled={publishing}
              >
                {publishing ? "Cancelando…" : "Cancelar programación"}
              </button>
            </div>
          )}
        </section>
      )}

      {canPublish && (
        <section className="card">
          <h2 className="card-title">
            {post.status === "failed" ? "Reintentar publicación en" : "Publicar en"}
          </h2>

          {connected.loading ? (
            <div className="skeleton" style={{ width: "60%", height: "2rem", marginTop: "var(--s3)" }} />
          ) : connected.names.length === 0 ? (
            <p className="hint">
              No tienes ninguna red conectada.{" "}
              <a href="/dashboard/accounts">Conéctalas primero</a>.
            </p>
          ) : (
            <div className="chips" style={{ marginTop: "var(--s3)" }}>
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

          <div className="actions" style={{ marginTop: "var(--s4)" }}>
            <button
              type="button"
              className="btn"
              onClick={publish}
              disabled={publishing || platforms.length === 0}
            >
              {publishing ? "Enviando…" : "Publicar ahora"}
            </button>
            <span className="muted">Se descartan las redes cuyo formato no encaje.</span>
          </div>

          <div className="field" style={{ marginTop: "var(--s5)", marginBottom: 0 }}>
            <label htmlFor="when">O programar para más tarde</label>
            <div className="row">
              <input
                id="when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={schedule}
                disabled={publishing || platforms.length === 0}
                style={{ flex: "0 0 auto" }}
              >
                Programar
              </button>
            </div>
            <p className="hint">
              En tu hora local. Puedes cancelarlo en cualquier momento antes de que salga.
            </p>
          </div>
        </section>
      )}

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}
    </main>
  );
}
