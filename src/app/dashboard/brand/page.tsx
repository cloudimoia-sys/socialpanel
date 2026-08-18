"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * El formulario que rellena la empresa una vez.
 *
 * Es la pieza que hace que el contenido suene a ellos: sin esto, cualquier
 * generador de posts da lo mismo que ChatGPT.
 */
export default function BrandPage() {
  const [form, setForm] = useState({
    business_name: "",
    business_type: "",
    description: "",
    audience: "",
    tone: "",
    language: "es",
    offerings: "",
    keywords: "",
    avoid: "",
    website: "",
    timezone: "Europe/Madrid",
    publish_hour: 10,
    news_topics: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  // Si es el primer perfil, al guardar seguimos al plan; si está editando uno
  // que ya existía, se queda donde está. Sacarle de la página a la fuerza
  // cuando solo venía a corregir un dato es molesto.
  const [isFirstTime, setIsFirstTime] = useState(true);
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/brand");
      const json = await res.json();
      if (res.ok && json.brand) {
        setForm({
          ...json.brand,
          keywords: (json.brand.keywords ?? []).join(", "),
          news_topics: (json.brand.news_topics ?? []).join("\n"),
          website: json.brand.website ?? "",
        });
        setIsFirstTime(false);
      }
      setLoaded(true);
    })();
  }, []);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const res = await fetch("/api/brand", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        publish_hour: Number(form.publish_hour),
        keywords: form.keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        news_topics: form.news_topics
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    });
    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo guardar.");
      return;
    }

    setSaved(true);
    if (isFirstTime) router.push("/dashboard/plan");
  }

  if (!loaded) {
    return (
      <main>
        <div className="card">
          <div className="skeleton" style={{ width: "30%", height: "1rem" }} />
          <div className="skeleton" style={{ width: "100%", height: "2.2rem" }} />
          <div className="skeleton" style={{ width: "100%", height: "2.2rem" }} />
        </div>
      </main>
    );
  }

  return (
    <main>
      <header className="page-head">
        <h1>Perfil de la empresa</h1>
        <p>
          Se rellena una vez. Todo lo que generes después usa este contexto, así que
          cuanto más concreto seas, menos sonará a IA.
        </p>
      </header>

      <form onSubmit={submit}>
        <div className="card">
          <div className="field">
            <label htmlFor="business_name">Nombre del negocio</label>
            <input id="business_name" type="text" required value={form.business_name} onChange={set("business_name")} />
          </div>

          <div className="field">
            <label htmlFor="business_type">Sector</label>
            <input
              id="business_type"
              type="text"
              required
              value={form.business_type}
              onChange={set("business_type")}
              placeholder="consultora IT, restaurante, gimnasio…"
            />
          </div>

          <div className="field">
            <label htmlFor="description">Qué hacéis</label>
            <textarea
              id="description"
              value={form.description}
              onChange={set("description")}
              placeholder="Desarrollamos automatizaciones y software a medida para pymes."
            />
          </div>

          <div className="field">
            <label htmlFor="website">Web (opcional)</label>
            <input id="website" type="text" value={form.website} onChange={set("website")} placeholder="https://cloudimo.es" />
          </div>
        </div>

        <div className="card">
          <div className="field">
            <label htmlFor="audience">A quién os dirigís</label>
            <textarea
              id="audience"
              value={form.audience}
              onChange={set("audience")}
              placeholder="Pymes de 5 a 50 empleados que aún trabajan con hojas de cálculo."
            />
          </div>

          <div className="field">
            <label htmlFor="offerings">Servicios o productos</label>
            <textarea
              id="offerings"
              value={form.offerings}
              onChange={set("offerings")}
              placeholder="Automatización de procesos, integraciones, desarrollo a medida. Desde 1.500 €."
            />
          </div>

          <div className="field">
            <label htmlFor="tone">Cómo habláis</label>
            <input
              id="tone"
              type="text"
              value={form.tone}
              onChange={set("tone")}
              placeholder="directo, técnico pero claro, sin promesas exageradas"
            />
          </div>

          <div className="field">
            <label htmlFor="keywords">Términos propios (separados por comas)</label>
            <input
              id="keywords"
              type="text"
              value={form.keywords}
              onChange={set("keywords")}
              placeholder="automatización, pyme, integración, Cloudimo"
            />
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">Cuándo se publica</h2>
          <p className="hint" style={{ marginTop: 0, marginBottom: "var(--s4)" }}>
            Al aprobar una idea del plan se programa sola en su fecha, a esta hora y en
            esta zona horaria.
          </p>

          <div className="row">
            <div className="field">
              <label htmlFor="timezone">Zona horaria</label>
              <select id="timezone" value={form.timezone} onChange={set("timezone")}>
                {[
                  "Europe/Madrid",
                  "Atlantic/Canary",
                  "Europe/Lisbon",
                  "Europe/London",
                  "America/Mexico_City",
                  "America/Bogota",
                  "America/Argentina/Buenos_Aires",
                  "America/New_York",
                ].map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="publish_hour">Hora</label>
              <select id="publish_hour" value={form.publish_hour} onChange={set("publish_hour")}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">Actualidad del sector</h2>
          <p className="hint" style={{ marginTop: 0, marginBottom: "var(--s4)" }}>
            El plan puede proponer, como mucho, una idea comentando una noticia real de
            estos temas — nunca para vender, solo como contenido de relleno que os
            posiciona como informados. Cada noticia lleva su fuente para que la revises
            antes de aprobar.
          </p>

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="news_topics">Temas a vigilar (uno por línea)</label>
            <textarea
              id="news_topics"
              value={form.news_topics}
              onChange={set("news_topics")}
              placeholder={
                "inteligencia artificial empresas\nautomatización pymes\nciberseguridad España"
              }
            />
            <p className="hint" style={{ marginBottom: 0 }}>
              Como si buscaras en Google: cuanto más concreto, mejores noticias salen.
              Déjalo vacío si no quieres contenido de actualidad.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="avoid">Qué no debe decir nunca</label>
            <textarea
              id="avoid"
              value={form.avoid}
              onChange={set("avoid")}
              placeholder="No prometer plazos concretos. No decir que somos los más baratos. No mencionar clientes por nombre."
            />
            <p className="muted" style={{ marginBottom: 0 }}>
              Esto es tan importante como el resto: son las promesas que no puedes
              permitirte que aparezcan publicadas.
            </p>
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Guardando…" : saved ? "Guardado ✓" : "Guardar"}
          </button>

          {saved && (
            <a href="/dashboard/plan" style={{ color: "var(--accent)", fontWeight: 600 }}>
              Generar un plan de contenido →
            </a>
          )}
        </div>
      </form>
    </main>
  );
}
