"use client";

import { useEffect, useState } from "react";
import { IconAlert, IconChart } from "@/app/icons";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";
import { AreaChart } from "@/app/dashboard/chart";

interface Metrics {
  platform: string;
  handle: string;
  followers: number | null;
  impressions: number | null;
  impressionsLabel: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  timeseries: { date: string; value: number }[];
  measuring?: string;
  unavailable?: string;
}

/** Una red que no expone una métrica no es una red con cero: se marca sin dato. */
const fmt = (value: number | null) =>
  value === null ? "—" : Math.round(value).toLocaleString("es-ES");

/**
 * La métrica principal, en castellano llano.
 *
 * La API devuelve la etiqueta de cada red en inglés y en su jerga ("Unique
 * Reach", "Video Views"), que no significa nada para quien lleva una peluquería.
 *
 * Se traduce por RED y no por nombre de campo porque el campo miente: TikTok y
 * X mandan los dos `impressions`, pero en TikTok son reproducciones de un vídeo
 * y en X veces que apareció en pantalla. Llamarlas igual sería más cómodo y
 * menos cierto.
 */
const IMPRESSIONS_LABEL: Record<string, string> = {
  instagram: "Personas alcanzadas",
  facebook: "Personas alcanzadas",
  linkedin: "Personas alcanzadas",
  threads: "Personas alcanzadas",
  tiktok: "Reproducciones",
  youtube: "Reproducciones",
  x: "Veces que se vio",
  pinterest: "Veces que se vio",
};

/**
 * Tendencia de la métrica principal, dibujada a mano.
 *
 * Sin librería de gráficas a propósito: son 30 puntos y una polilínea. Meter
 * una dependencia de charts por esto añadiría cientos de KB al bundle para
 * algo que cabe en diez líneas.
 */
function Sparkline({ points }: { points: { date: string; value: number }[] }) {
  const max = Math.max(0, ...points.map((p) => p.value));

  // Una cuenta recién conectada trae la serie entera a cero. Dibujarla sería
  // una raya plana clavada en el borde inferior: se lee como un borde suelto,
  // no como una gráfica, y no aporta nada que no diga ya el 0 de arriba.
  if (points.length < 2 || max === 0) return null;

  // Se deja aire arriba y abajo: con el rango completo 0-100 el pico toca el
  // borde y, al no escalarse el trazo, se derrama fuera del recuadro.
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 95 - (p.value / max) * 90;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={path} />
    </svg>
  );
}

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<Metrics[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/metrics");
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "No se pudieron cargar las métricas.");
        setMetrics([]);
        return;
      }
      setMetrics(json.metrics);
    })();
  }, []);

  return (
    <main>
      <header className="page-head">
        <h1>Métricas</h1>
        <p>Cómo van tus cuentas en cada red, de los últimos 30 días.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      {metrics === null ? (
        <section className="card">
          <div className="skeleton" style={{ width: "35%", height: "1.2rem" }} />
          <div className="skeleton" style={{ width: "80%" }} />
          <div className="skeleton" style={{ width: "55%" }} />
        </section>
      ) : metrics.length === 0 ? (
        <section className="card">
          <div className="empty">
            <IconChart />
            <p>No hay ninguna cuenta conectada de la que sacar métricas.</p>
            <a href="/dashboard/accounts" className="btn">
              Conectar cuentas
            </a>
          </div>
        </section>
      ) : (
        metrics.map((m) => (
          <article key={m.platform} className="card">
            <div className="card-head">
              <span style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
                <PlatformIcon platform={m.platform} size={20} />
                <strong>{platformLabel(m.platform)}</strong>
              </span>
              {/* Se enseña lo que de verdad producen estos números. En Facebook
                  la cuenta conectada lleva el nombre del perfil personal pero
                  las cifras son de la página: rotular con el perfil las
                  atribuiría a quien no las generó. */}
              <span className="muted truncate">{m.measuring ?? m.handle}</span>
            </div>

            {m.unavailable ? (
              <p className="hint" style={{ margin: 0 }}>
                {m.unavailable}
              </p>
            ) : (
              <>
                <div className="metrics">
                  <div>
                    <span className="stat">{fmt(m.impressions)}</span>
                    {/* El nombre original queda al pasar el ratón: quien conoce
                        la jerga de la red puede comprobar que cuadra con lo que
                        ve en la app oficial. */}
                    <span className="muted" title={`${platformLabel(m.platform)} lo llama "${m.impressionsLabel}"`}>
                      {IMPRESSIONS_LABEL[m.platform] ?? m.impressionsLabel}
                    </span>
                  </div>
                  <div>
                    <span className="stat">{fmt(m.followers)}</span>
                    <span className="muted">Seguidores</span>
                  </div>
                  <div>
                    <span className="stat">{fmt(m.likes)}</span>
                    <span className="muted">Me gusta</span>
                  </div>
                  <div>
                    <span className="stat">{fmt(m.comments)}</span>
                    <span className="muted">Comentarios</span>
                  </div>
                  <div>
                    <span className="stat">{fmt(m.shares)}</span>
                    <span className="muted">Compartidos</span>
                  </div>
                </div>

                {/* La gráfica grande solo cuando hay algo que enseñar; si la
                    serie está toda a cero cae a la minigráfica, que ya sabe
                    no dibujarse. */}
                {m.timeseries.some((p) => p.value > 0) ? (
                  <AreaChart
                    points={m.timeseries.map((p) => ({
                      label: new Date(`${p.date}T00:00:00`).toLocaleDateString("es-ES", {
                        day: "numeric",
                        month: "short",
                      }),
                      value: p.value,
                    }))}
                    height={200}
                    label={`Evolución de ${IMPRESSIONS_LABEL[m.platform] ?? "visibilidad"} en ${platformLabel(m.platform)}`}
                  />
                ) : (
                  <Sparkline points={m.timeseries} />
                )}
              </>
            )}
          </article>
        ))
      )}

      <p className="hint">
        Un guion (—) significa que esa red no publica ese dato, que no es lo mismo que
        cero. Los datos salen con el retraso de cada red, así que lo de hoy puede tardar
        en aparecer. Y como cada una mide a su manera, no sumamos entre redes: el total
        no significaría nada.
      </p>
    </main>
  );
}
