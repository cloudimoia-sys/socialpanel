"use client";

import { useEffect, useState } from "react";
import { IconAlert } from "@/app/icons";
import { PlatformIcon } from "@/app/platform-icons";

interface Post {
  id: string;
  status: string;
  caption: string | null;
  brief: string | null;
  scheduled_at: string | null;
  scheduled_platforms: string[];
}

/**
 * Tablero de estado, de solo lectura.
 *
 * No se puede arrastrar una tarjeta para cambiar su estado a propósito:
 * "publicado" solo es cierto si de verdad se llamó a la red y post_targets
 * quedó registrado. Un board que permitiera poner ese estado a mano podría
 * enseñar publicaciones "publicadas" que nunca salieron — la misma garantía
 * de idempotencia que protege el resto de la app. La acción real (aprobar,
 * programar, publicar) se hace en el detalle del post, al que cada tarjeta
 * enlaza.
 */
const COLUMNS: { status: string; label: string }[] = [
  { status: "draft", label: "Borrador" },
  { status: "generating", label: "Generando" },
  { status: "ready", label: "Listo" },
  { status: "scheduled", label: "Programado" },
  { status: "publishing", label: "Publicando" },
  { status: "published", label: "Publicado" },
  { status: "failed", label: "Falló" },
];

export default function KanbanPage() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/posts?limit=200");
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "No se pudo cargar el tablero.");
        setPosts([]);
        return;
      }
      setPosts(json.posts);
    })();
  }, []);

  const byStatus = (status: string) => (posts ?? []).filter((p) => p.status === status);

  return (
    <main className="main-wide">
      <header className="page-head">
        <h1>Tablero</h1>
        <p>El estado real de cada publicación, de un vistazo.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      {posts === null ? (
        <section className="card">
          <div className="skeleton" style={{ width: "60%" }} />
        </section>
      ) : (
        <div className="kanban-scroll">
          <div className="kanban">
            {COLUMNS.map((col) => {
              const items = byStatus(col.status);
              // Columnas vacías se ocultan salvo las tres que casi siempre
              // tienen algo: enseñar siete columnas fijas, la mitad vacías,
              // convierte el tablero en ruido.
              if (items.length === 0 && !["ready", "scheduled", "published"].includes(col.status)) {
                return null;
              }

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
                    items.map((p) => (
                      <a href={`/dashboard/posts/${p.id}`} className="kanban-card" key={p.id}>
                        <p className="truncate" style={{ margin: 0, fontWeight: 600, fontSize: ".875rem" }}>
                          {(p.caption ?? p.brief ?? "(sin texto)").slice(0, 70)}
                        </p>
                        <div style={{ display: "flex", gap: ".3rem", marginTop: "var(--s2)" }}>
                          {p.scheduled_platforms.map((platform) => (
                            <PlatformIcon key={platform} platform={platform} size={14} />
                          ))}
                        </div>
                      </a>
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
