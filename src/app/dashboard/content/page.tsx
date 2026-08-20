"use client";

import { useCallback, useEffect, useState } from "react";
import { IconAlert, IconInbox, IconStar, IconTrophy } from "@/app/icons";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";

interface Post {
  id: string;
  status: string;
  caption: string | null;
  brief: string | null;
  scheduled_at: string | null;
  scheduled_platforms: string[];
  is_favorite: boolean;
  is_winner: boolean;
  created_at: string;
}

type Filter = "all" | "favorite" | "winner";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  draft: { text: "borrador", cls: "badge" },
  generating: { text: "generando", cls: "badge badge-brand" },
  ready: { text: "listo", cls: "badge badge-ok" },
  scheduled: { text: "programado", cls: "badge badge-brand" },
  publishing: { text: "publicando", cls: "badge badge-brand" },
  published: { text: "publicado", cls: "badge badge-ok" },
  failed: { text: "falló", cls: "badge badge-danger" },
};

export default function ContentLibraryPage() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  // Cambios optimistas en curso, para no dejar el botón pulsable dos veces
  // mientras la petición sigue en el aire.
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async (f: Filter) => {
    const query = f === "all" ? "" : `?flag=${f}`;
    const res = await fetch(`/api/posts${query}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo cargar la biblioteca.");
      setPosts([]);
      return;
    }
    setPosts(json.posts);
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function toggle(post: Post, key: "is_favorite" | "is_winner") {
    setBusy((b) => new Set(b).add(post.id));
    setError("");

    const field = key === "is_favorite" ? "isFavorite" : "isWinner";
    const res = await fetch(`/api/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: !post[key] }),
    });
    const json = await res.json();

    setBusy((b) => {
      const next = new Set(b);
      next.delete(post.id);
      return next;
    });

    if (!res.ok) {
      setError(json.error ?? "No se pudo guardar el cambio.");
      return;
    }

    // El filtro activo puede dejar de incluir este post (p. ej. quitar el
    // favorito estando en la pestaña Favoritos): recargar es más simple y más
    // correcto que llevar dos copias del estado sincronizadas a mano.
    if (filter !== "all") await load(filter);
    else setPosts((current) => (current ?? []).map((p) => (p.id === post.id ? { ...p, ...json } : p)));
  }

  return (
    <main>
      <header className="page-head">
        <h1>Contenido</h1>
        <p>Todo lo que se ha generado, en un solo sitio.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      <div className="chips" style={{ marginBottom: "var(--s4)" }}>
        {(
          [
            ["all", "Todos"],
            ["favorite", "Favoritos"],
            ["winner", "Ganadores"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {posts === null ? (
        <section className="card">
          <div className="skeleton" style={{ width: "70%" }} />
          <div className="skeleton" style={{ width: "50%" }} />
        </section>
      ) : posts.length === 0 ? (
        <section className="card">
          <div className="empty">
            <IconInbox />
            <p>
              {filter === "all"
                ? "Todavía no has generado ningún post."
                : "Nada marcado por aquí de momento."}
            </p>
            {filter === "all" && (
              <a href="/dashboard/new" className="btn">
                Crear el primero
              </a>
            )}
          </div>
        </section>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Contenido</th>
                <th>Redes</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => {
                const status = STATUS_LABEL[p.status] ?? { text: p.status, cls: "badge" };
                const disabled = busy.has(p.id);
                return (
                  <tr key={p.id}>
                    <td style={{ maxWidth: "20rem" }}>
                      <a href={`/dashboard/posts/${p.id}`} className="truncate">
                        <strong>{(p.caption ?? p.brief ?? "(sin texto)").slice(0, 90)}</strong>
                      </a>
                    </td>
                    <td>
                      <span style={{ display: "flex", gap: ".3rem" }}>
                        {p.scheduled_platforms.map((platform) => (
                          <PlatformIcon key={platform} platform={platform} size={16} />
                        ))}
                      </span>
                    </td>
                    <td>
                      <span className={status.cls}>{status.text}</span>
                    </td>
                    <td>
                      {new Date(p.scheduled_at ?? p.created_at).toLocaleDateString("es-ES", {
                        day: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td className="num">
                      <div className="actions" style={{ justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm icon-toggle"
                          disabled={disabled}
                          aria-pressed={p.is_favorite}
                          aria-label={p.is_favorite ? "Quitar de favoritos" : "Marcar como favorito"}
                          title={p.is_favorite ? "Quitar de favoritos" : "Marcar como favorito"}
                          onClick={() => toggle(p, "is_favorite")}
                        >
                          <IconStar />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm icon-toggle"
                          disabled={disabled}
                          aria-pressed={p.is_winner}
                          aria-label={p.is_winner ? "Quitar de ganadores" : "Marcar como ganador"}
                          title={p.is_winner ? "Quitar de ganadores" : "Marcar como ganador"}
                          onClick={() => toggle(p, "is_winner")}
                        >
                          <IconTrophy />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
