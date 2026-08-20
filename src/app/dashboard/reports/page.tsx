"use client";

import { useState } from "react";
import { IconAlert, IconCard } from "@/app/icons";

/**
 * No se enlaza directo a /api/reports con un <a href>: así el error de la
 * API (403 sin cuenta, 429 por límite) se quedaría en una pestaña nueva en
 * blanco sin que el usuario supiera qué pasó. Se pide con fetch para poder
 * enseñar el mensaje si algo falla, y solo se dispara la descarga si
 * realmente llegó un PDF.
 */
export default function ReportsPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setError("");

    const res = await fetch("/api/reports");

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setBusy(false);
      setError(json.error ?? "No se pudo generar el informe.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `informe-${new Date().toISOString().slice(0, 10)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    setBusy(false);
  }

  return (
    <main>
      <header className="page-head">
        <h1>Informes</h1>
        <p>Un PDF con lo que ha pasado en los últimos 30 días, listo para enviar.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Informe mensual</h2>
          <IconCard />
        </div>
        <p className="muted" style={{ marginBottom: "var(--s4)" }}>
          Publicaciones creadas y publicadas, seguidores y alcance por red, y el contenido
          que hayas marcado como ganador en la biblioteca.
        </p>
        <button type="button" className="btn" onClick={generate} disabled={busy}>
          {busy ? "Generando…" : "Generar y descargar"}
        </button>
      </section>
    </main>
  );
}
