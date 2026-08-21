"use client";

import { useEffect, useState } from "react";
import { IconAlert, IconSparkle } from "@/app/icons";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";
import { usePlatforms } from "@/app/dashboard/use-platforms";
import { LIMITS_BY_PLATFORM } from "@/domain/platform-rules";

interface Piece {
  platform: string;
  copy: string;
  script?: string;
  title?: string;
  hashtags: string[];
  cta: string;
}

const ALL_PLATFORMS = Object.keys(LIMITS_BY_PLATFORM);

/** Copia al portapapeles el texto principal de la pieza más los hashtags. */
function pieceText(p: Piece): string {
  const body = p.title ? `${p.title}\n\n${p.copy}` : p.script || p.copy;
  const tags = p.hashtags.length > 0 ? `\n\n${p.hashtags.map((h) => `#${h}`).join(" ")}` : "";
  return `${body}${tags}`;
}

export default function StudioPage() {
  const [brief, setBrief] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ pieces: Piece[]; imageIdea: string; videoIdea: string } | null>(
    null,
  );
  const [copied, setCopied] = useState<string | null>(null);

  const connected = usePlatforms();

  useEffect(() => {
    if (connected.names.length > 0) setPlatforms(connected.names);
  }, [connected.names.join(",")]);

  function toggle(platform: string) {
    setPlatforms((current) =>
      current.includes(platform) ? current.filter((p) => p !== platform) : [...current, platform],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    const res = await fetch("/api/studio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief, platforms }),
    });
    const json = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo generar el contenido.");
      return;
    }
    setResult(json);
  }

  async function copy(platform: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(platform);
    setTimeout(() => setCopied((c) => (c === platform ? null : c)), 2000);
  }

  return (
    <main>
      <header className="page-head">
        <h1>Content Studio</h1>
        <p>Un brief, una pieza adaptada de verdad a cada red — no el mismo texto recortado.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      <form onSubmit={submit} className="card">
        <div className="field">
          <label htmlFor="brief">Qué quieres anunciar</label>
          <textarea
            id="brief"
            required
            minLength={10}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Reforma integral de cocina: antes y después de un proyecto reciente, presupuesto desde 8.000 €."
            rows={3}
          />
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>Redes</label>
          <div className="chips">
            {ALL_PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                className="chip"
                aria-pressed={platforms.includes(p)}
                onClick={() => toggle(p)}
                style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
              >
                <PlatformIcon platform={p} size={14} />
                {platformLabel(p)}
              </button>
            ))}
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            No hace falta tenerlas conectadas: esto solo redacta, no publica.
          </p>
        </div>

        <div style={{ marginTop: "var(--s4)" }}>
          <button type="submit" className="btn" disabled={loading || platforms.length === 0}>
            {loading ? "Generando…" : "Generar"}
          </button>
        </div>
      </form>

      {result && (
        <>
          {(result.imageIdea || result.videoIdea) && (
            <section className="card">
              <h2 className="card-title">Ideas para el material</h2>
              {result.imageIdea && (
                <p style={{ marginBottom: "var(--s2)" }}>
                  <strong>Imagen:</strong> {result.imageIdea}
                </p>
              )}
              {result.videoIdea && (
                <p style={{ marginBottom: 0 }}>
                  <strong>Vídeo:</strong> {result.videoIdea}
                </p>
              )}
            </section>
          )}

          <div className="grid-2">
            {result.pieces.map((p) => (
              <section className="card" key={p.platform}>
                <div className="card-head">
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
                    <PlatformIcon platform={p.platform} size={20} />
                    <strong>{platformLabel(p.platform)}</strong>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => copy(p.platform, pieceText(p))}
                  >
                    {copied === p.platform ? "Copiado ✓" : "Copiar"}
                  </button>
                </div>

                {p.title && (
                  <p style={{ marginBottom: "var(--s2)" }}>
                    <strong>{p.title}</strong>
                  </p>
                )}
                <p style={{ whiteSpace: "pre-wrap", marginBottom: "var(--s2)" }}>
                  {p.script ?? p.copy}
                </p>
                {p.hashtags.length > 0 && (
                  <p className="muted" style={{ marginBottom: "var(--s2)" }}>
                    {p.hashtags.map((h) => `#${h}`).join(" ")}
                  </p>
                )}
                <p className="hint" style={{ marginBottom: 0 }}>
                  CTA: {p.cta}
                </p>
              </section>
            ))}
          </div>

          <p className="hint">
            Para publicar cualquiera de estas piezas, cópiala y pégala en{" "}
            <a href="/dashboard/new">Nuevo post</a>.
          </p>
        </>
      )}

      {!result && !loading && (
        <div className="empty">
          <IconSparkle />
          <p>Escribe el brief y elige redes para generar el contenido.</p>
        </div>
      )}
    </main>
  );
}
