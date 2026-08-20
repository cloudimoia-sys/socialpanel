"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { usePlatforms } from "@/app/dashboard/use-platforms";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";
import { browserClient } from "@/lib/supabase-browser";

type MediaMode = "none" | "upload" | "generate-image" | "generate-video" | "generate-infographic";

/**
 * `useSearchParams()` exige un límite de Suspense en el App Router — sin él,
 * Next intenta pre-renderizar la página entera de forma estática y falla en
 * build. Por eso el composer real vive aparte y este solo lo envuelve.
 */
export default function ComposerPage() {
  return (
    <Suspense fallback={null}>
      <ComposerForm />
    </Suspense>
  );
}

function ComposerForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reuseFromId = searchParams.get("from");

  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [reusingFrom, setReusingFrom] = useState<{ id: string; text: string } | null>(null);
  const connected = usePlatforms();

  // Reciclaje de contenido: precarga la idea con el texto de un post ya
  // marcado como ganador, para reutilizarlo en otro formato. No se copia el
  // formato original (imagen, vídeo…) a propósito — el punto de reciclar es
  // justo cambiarlo, y copiarlo habría hecho falta adivinar cuál conservar.
  useEffect(() => {
    if (!reuseFromId) return;

    void (async () => {
      const res = await fetch(`/api/posts/${reuseFromId}`);
      const json = await res.json();
      if (!res.ok) return;

      const text = json.caption ?? json.brief ?? "";
      if (text) {
        setBrief(text);
        setReusingFrom({ id: reuseFromId, text });
      }
    })();
  }, [reuseFromId]);

  useEffect(() => {
    if (connected.names.length > 0) setPlatforms(connected.names);
  }, [connected.names.join(",")]);
  const [mode, setMode] = useState<MediaMode>("none");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("1:1");
  const [duration, setDuration] = useState(5);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [overlayText, setOverlayText] = useState("");
  const [overlaySub, setOverlaySub] = useState("");
  const [template, setTemplate] = useState<"band" | "headline" | "corner">("band");
  const [infoTitle, setInfoTitle] = useState("");
  const [stat1Value, setStat1Value] = useState("");
  const [stat1Label, setStat1Label] = useState("");
  const [stat2Value, setStat2Value] = useState("");
  const [stat2Label, setStat2Label] = useState("");
  const [infoFooter, setInfoFooter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (p: string) =>
    setPlatforms((current) =>
      current.includes(p) ? current.filter((x) => x !== p) : [...current, p],
    );

  // Subida en dos pasos: el archivo va del navegador a Supabase Storage
  // directamente, no por esta app. Vercel limita a 4.5 MB el cuerpo de una
  // petición a una function, muy por debajo de los 50 MB que admitimos —
  // mandarlo aquí primero rompería con cualquier vídeo real en producción.
  async function upload(file: File) {
    setUploading(true);
    setError("");

    const signRes = await fetch("/api/uploads/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: file.type, bytes: file.size }),
    });
    const signJson = await signRes.json();
    if (!signRes.ok) {
      setUploading(false);
      setError(signJson.error ?? "No se pudo preparar la subida.");
      return;
    }

    const { error: uploadError } = await browserClient()
      .storage.from("media")
      .uploadToSignedUrl(signJson.path, signJson.token, file);

    if (uploadError) {
      setUploading(false);
      setError("No se pudo subir el archivo.");
      return;
    }

    const finalizeRes = await fetch("/api/uploads/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: signJson.path }),
    });
    const finalizeJson = await finalizeRes.json();
    setUploading(false);

    if (!finalizeRes.ok) {
      setError(finalizeJson.error ?? "No se pudo registrar el archivo.");
      return;
    }
    setAssetId(finalizeJson.id);
  }

  // El texto va superpuesto con tipografía real, nunca dentro del prompt: los
  // modelos de imagen no saben escribir.
  const overlay = overlayText.trim()
    ? { text: overlayText.trim(), subtext: overlaySub.trim() || undefined, template }
    : undefined;

  function buildMedia() {
    if (mode === "upload") {
      return assetId ? { mode: "existing" as const, assetId, overlay } : null;
    }
    if (mode === "generate-image") {
      return { mode: "generate-image" as const, prompt, aspectRatio: aspect, overlay };
    }
    if (mode === "generate-video") {
      return {
        mode: "generate-video" as const,
        prompt,
        durationSeconds: duration,
        aspectRatio: aspect === "1:1" ? "1:1" : aspect === "16:9" ? "16:9" : "9:16",
      };
    }
    if (mode === "generate-infographic") {
      return {
        mode: "generate-infographic" as const,
        title: infoTitle,
        stat1Value,
        stat1Label,
        stat2Value,
        stat2Label,
        footer: infoFooter,
      };
    }
    return { mode: "none" as const };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    const media = buildMedia();
    if (!media) {
      setError("Sube un archivo antes de continuar.");
      return;
    }

    setBusy(true);
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief,
        platforms,
        language: "es",
        tone: tone || undefined,
        media,
        sourceUrl: sourceUrl.trim() || undefined,
      }),
    });
    const json = await res.json();

    if (!res.ok) {
      setBusy(false);
      setError(json.error ?? "No se pudo crear el post.");
      return;
    }

    router.push(`/dashboard/posts/${json.id}`);
  }

  // El vídeo es con diferencia lo más caro: ~0,10 $ por segundo.
  const videoCost = (duration * 0.1).toFixed(2);

  return (
    <main>
      <header className="page-head">
        <h1>Nuevo post</h1>
        <p>Describe la idea y elige dónde publicarla.</p>
      </header>

      {reusingFrom && (
        <p className="hint" style={{ marginTop: 0 }}>
          Reutilizando el texto de{" "}
          <a href={`/dashboard/posts/${reusingFrom.id}`}>un post que ya funcionó</a>. Cámbialo
          y elige un formato distinto abajo — es un post nuevo, el original no se toca.
        </p>
      )}

      <form onSubmit={submit}>
        <div className="card">
          <div className="field">
            <label htmlFor="brief">Idea</label>
            <textarea
              id="brief"
              required
              minLength={5}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Ej: anunciar que abrimos los domingos de 9 a 14, con desayunos por 6 €"
            />
          </div>

          <div className="field">
            <label htmlFor="sourceUrl">Basar en una noticia (opcional)</label>
            <input
              id="sourceUrl"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
            />
            <p className="hint">
              Pega el enlace de la noticia que quieres comentar. La leemos del sitio real:
              el comentario será tuyo, nunca un resumen ni una cita textual, y el enlace
              queda guardado en el post para que lo revises antes de aprobar.
            </p>
          </div>

          <div className="field">
            <label htmlFor="tone">Tono (opcional)</label>
            <input
              id="tone"
              type="text"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="cercano, directo, sin emojis…"
            />
          </div>
        </div>

        <div className="card">
          <label>Publicar en</label>
          {connected.loading ? (
            <div className="skeleton" style={{ width: "60%", height: "2rem" }} />
          ) : connected.names.length === 0 ? (
            <p className="hint" style={{ marginTop: 0 }}>
              No tienes ninguna red conectada.{" "}
              <a href="/dashboard/accounts">Conéctalas primero</a> y vuelve aquí.
            </p>
          ) : (
            <>
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
              {platforms.length === 0 && (
                <p className="hint" style={{ marginBottom: 0 }}>
                  Elige al menos una red.
                </p>
              )}
            </>
          )}
        </div>

        <div className="card">
          <label htmlFor="mode">Contenido visual</label>
          <select
            id="mode"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as MediaMode);
              setAssetId(null);
            }}
          >
            <option value="none">Solo texto</option>
            <option value="upload">Subir foto o vídeo</option>
            <option value="generate-image">Generar imagen con IA</option>
            <option value="generate-video">Generar vídeo con IA</option>
            <option value="generate-infographic">Infograma de datos (gratis)</option>
          </select>

          {mode === "upload" && (
            <div className="field" style={{ marginTop: "1rem" }}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <p className="muted" style={{ marginBottom: 0 }}>
                {uploading
                  ? "Subiendo…"
                  : assetId
                    ? "Archivo listo."
                    : "JPG, PNG, WebP, MP4 o MOV. Máximo 50 MB."}
              </p>
            </div>
          )}

          {(mode === "generate-image" || mode === "generate-video") && (
            <>
              <div className="field" style={{ marginTop: "1rem" }}>
                <label htmlFor="prompt">Qué quieres ver</label>
                <textarea
                  id="prompt"
                  required
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ej: mesa de madera con café y tostadas, luz de mañana, vista cenital"
                />
              </div>

              <div className="field">
                <label htmlFor="aspect">Formato</label>
                <select id="aspect" value={aspect} onChange={(e) => setAspect(e.target.value)}>
                  <option value="1:1">Cuadrado (1:1)</option>
                  <option value="9:16">Vertical (9:16)</option>
                  <option value="16:9">Horizontal (16:9)</option>
                  {mode === "generate-image" && <option value="4:5">Retrato (4:5)</option>}
                </select>
              </div>

              {mode === "generate-video" && (
                <div className="field">
                  <label htmlFor="duration">Duración: {duration} s</label>
                  <input
                    id="duration"
                    type="range"
                    min={3}
                    max={10}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Coste estimado: ~{videoCost} $. El vídeo es lo más caro con diferencia.
                  </p>
                </div>
              )}
            </>
          )}

          {mode === "generate-infographic" && (
            <>
              <p className="hint" style={{ marginTop: "1rem" }}>
                Vídeo de 5 s con dos cifras animadas. El texto se dibuja con código, no
                lo genera ninguna IA — por eso sale siempre correcto y no cuesta nada.
              </p>

              <div className="field">
                <label htmlFor="infoTitle">Titular</label>
                <input
                  id="infoTitle"
                  type="text"
                  required
                  maxLength={120}
                  value={infoTitle}
                  onChange={(e) => setInfoTitle(e.target.value)}
                  placeholder="Solo el 9% de las pymes españolas usa tecnología avanzada"
                />
              </div>

              <div className="row">
                <div className="field">
                  <label htmlFor="stat1Value">Cifra 1</label>
                  <input
                    id="stat1Value"
                    type="text"
                    required
                    maxLength={12}
                    value={stat1Value}
                    onChange={(e) => setStat1Value(e.target.value)}
                    placeholder="9%"
                  />
                </div>
                <div className="field">
                  <label htmlFor="stat1Label">Etiqueta 1</label>
                  <input
                    id="stat1Label"
                    type="text"
                    required
                    maxLength={40}
                    value={stat1Label}
                    onChange={(e) => setStat1Label(e.target.value)}
                    placeholder="digitalmente avanzadas"
                  />
                </div>
              </div>

              <div className="row">
                <div className="field">
                  <label htmlFor="stat2Value">Cifra 2</label>
                  <input
                    id="stat2Value"
                    type="text"
                    required
                    maxLength={12}
                    value={stat2Value}
                    onChange={(e) => setStat2Value(e.target.value)}
                    placeholder="91%"
                  />
                </div>
                <div className="field">
                  <label htmlFor="stat2Label">Etiqueta 2</label>
                  <input
                    id="stat2Label"
                    type="text"
                    required
                    maxLength={40}
                    value={stat2Label}
                    onChange={(e) => setStat2Label(e.target.value)}
                    placeholder="con margen de mejora"
                  />
                </div>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="infoFooter">Pie (tu web o marca)</label>
                <input
                  id="infoFooter"
                  type="text"
                  required
                  maxLength={60}
                  value={infoFooter}
                  onChange={(e) => setInfoFooter(e.target.value)}
                  placeholder="cloudimo.es"
                />
              </div>
            </>
          )}
        </div>

        {(mode === "upload" || mode === "generate-image") && (
          <div className="card">
            <div className="field">
              <label htmlFor="overlay">Texto sobre la imagen (opcional)</label>
              <input
                id="overlay"
                type="text"
                maxLength={120}
                value={overlayText}
                onChange={(e) => setOverlayText(e.target.value)}
                placeholder="¿Tu pyme ha superado la capacidad de Excel?"
              />
              <p className="muted" style={{ marginBottom: 0 }}>
                Se compone con tu tipografía y tus colores, no lo dibuja la IA. Por eso
                sale siempre correcto, con tildes y todo.
              </p>
            </div>

            {overlayText && (
              <>
                <div className="field">
                  <label htmlFor="overlaysub">Segunda línea (opcional)</label>
                  <input
                    id="overlaysub"
                    type="text"
                    maxLength={80}
                    value={overlaySub}
                    onChange={(e) => setOverlaySub(e.target.value)}
                    placeholder="cloudimo.es"
                  />
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Plantilla</label>
                  <div className="chips">
                    {(
                      [
                        ["band", "Banda inferior"],
                        ["headline", "Titular centrado"],
                        ["corner", "Esquina"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className="chip"
                        aria-pressed={template === value}
                        onClick={() => setTemplate(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <button
          type="submit"
          className="btn"
          disabled={busy || uploading || platforms.length === 0}
        >
          {busy ? "Generando…" : "Generar"}
        </button>
      </form>
    </main>
  );
}
