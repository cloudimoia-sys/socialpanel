"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IconAlert, IconChart, IconTrash } from "@/app/icons";
import { AreaChart } from "@/app/dashboard/chart";

interface Site {
  id: string;
  site_url: string;
}

interface Row {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface Performance {
  siteUrl: string;
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  daily: Row[];
  queries: Row[];
  pages: Row[];
}

const num = (n: number) => Math.round(n).toLocaleString("es-ES");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** "sc-domain:cloudimo.es" es como lo llama Google, no como lo lee una persona. */
const prettySite = (url: string) =>
  url.startsWith("sc-domain:") ? url.slice("sc-domain:".length) : url.replace(/^https?:\/\//, "").replace(/\/$/, "");

function RowsTable({ rows, label }: { rows: Row[]; label: string }) {
  if (rows.length === 0) {
    return (
      <p className="hint" style={{ marginBottom: 0 }}>
        Sin datos todavía en este periodo.
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{label}</th>
            <th className="num">Clics</th>
            <th className="num">Impresiones</th>
            <th className="num">CTR</th>
            <th className="num">Posición</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ maxWidth: "22rem" }}>
                <span className="truncate" title={r.key}>
                  {r.key}
                </span>
              </td>
              <td className="num">{num(r.clicks)}</td>
              <td className="num">{num(r.impressions)}</td>
              <td className="num">{pct(r.ctr)}</td>
              <td className="num">{r.position.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SeoContent() {
  const params = useSearchParams();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [sites, setSites] = useState<Site[]>([]);
  const [available, setAvailable] = useState<{ siteUrl: string }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [perf, setPerf] = useState<Performance | null>(null);
  const [loadingPerf, setLoadingPerf] = useState(false);
  const [error, setError] = useState(params.get("error") ?? "");

  const load = useCallback(async () => {
    const res = await fetch("/api/seo/sites");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo cargar el módulo SEO.");
      setConnected(false);
      return;
    }
    setConnected(json.connected);
    setConfigured(json.configured);
    setSites(json.sites);
    setAvailable(json.available);
    setActive((current) => current ?? json.sites[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!active) {
      setPerf(null);
      return;
    }
    setLoadingPerf(true);
    void (async () => {
      const res = await fetch(`/api/seo/performance?siteId=${active}`);
      const json = await res.json();
      setLoadingPerf(false);
      if (!res.ok) {
        setError(json.error ?? "No se pudieron cargar los datos.");
        setPerf(null);
        return;
      }
      setPerf(json);
    })();
  }, [active]);

  async function addSite(siteUrl: string) {
    setError("");
    const res = await fetch("/api/seo/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteUrl }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo añadir la web.");
      return;
    }
    setActive(json.site.id);
    await load();
  }

  async function removeSite(id: string) {
    if (!confirm("¿Dejar de seguir esta web?")) return;
    const res = await fetch(`/api/seo/sites?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setActive((current) => (current === id ? null : current));
      await load();
    }
  }

  const notAdded = available.filter((a) => !sites.some((s) => s.site_url === a.siteUrl));

  return (
    <main className="main-wide">
      <header className="page-head">
        <h1>SEO</h1>
        <p>Cómo te encuentra la gente en Google, con los datos de tu propio Search Console.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      {params.get("conectado") && (
        <p className="hint">Cuenta de Google conectada.</p>
      )}

      {connected === null ? (
        <section className="card">
          <div className="skeleton" style={{ width: "60%" }} />
        </section>
      ) : !configured ? (
        <section className="card">
          <div className="empty">
            <IconChart />
            <p>La conexión con Google no está configurada en el servidor todavía.</p>
          </div>
        </section>
      ) : !connected ? (
        <section className="card">
          <div className="empty">
            <IconChart />
            <p>
              Conecta la cuenta de Google que tiene acceso a tu web en Search Console. Solo se
              pide permiso de <strong>lectura</strong>.
            </p>
            <a href="/api/seo/connect" className="btn">
              Conectar Search Console
            </a>
          </div>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Webs</h2>
              <a href="/api/seo/connect" className="btn btn-ghost btn-sm">
                Reconectar Google
              </a>
            </div>

            {sites.length > 0 && (
              <div className="chips" style={{ marginBottom: "var(--s3)" }}>
                {sites.map((s) => (
                  <span key={s.id} style={{ display: "flex", alignItems: "center", gap: ".25rem" }}>
                    <button
                      type="button"
                      className="chip"
                      aria-pressed={active === s.id}
                      onClick={() => setActive(s.id)}
                    >
                      {prettySite(s.site_url)}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeSite(s.id)}
                      aria-label={`Dejar de seguir ${prettySite(s.site_url)}`}
                      title="Dejar de seguir"
                    >
                      <IconTrash />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {notAdded.length > 0 ? (
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="add-site">Añadir una web de tu Search Console</label>
                <select
                  id="add-site"
                  value=""
                  onChange={(e) => e.target.value && addSite(e.target.value)}
                >
                  <option value="">Elegir…</option>
                  {notAdded.map((a) => (
                    <option key={a.siteUrl} value={a.siteUrl}>
                      {prettySite(a.siteUrl)}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              sites.length === 0 && (
                <p className="hint" style={{ marginBottom: 0 }}>
                  Esa cuenta de Google no tiene ninguna web verificada en Search Console.
                </p>
              )
            )}
          </section>

          {loadingPerf ? (
            <section className="card">
              <div className="skeleton" style={{ width: "50%" }} />
            </section>
          ) : perf ? (
            <>
              <div className="kpis">
                <div className="kpi">
                  <div className="kpi-head" />
                  <div className="value">{num(perf.totals.clicks)}</div>
                  <div className="label">Clics · 28 días</div>
                </div>
                <div className="kpi">
                  <div className="kpi-head" />
                  <div className="value">{num(perf.totals.impressions)}</div>
                  <div className="label">Impresiones</div>
                </div>
                <div className="kpi">
                  <div className="kpi-head" />
                  <div className="value">{pct(perf.totals.ctr)}</div>
                  <div className="label">CTR medio</div>
                </div>
                <div className="kpi">
                  <div className="kpi-head" />
                  <div className="value">{perf.totals.position.toFixed(1)}</div>
                  <div className="label">Posición media</div>
                </div>
              </div>

              {perf.daily.length > 1 && (
                <section className="card">
                  <h2 className="card-title">Clics por día</h2>
                  <div style={{ marginTop: "var(--s3)" }}>
                    <AreaChart
                      points={perf.daily.map((d) => ({
                        label: new Date(`${d.key}T12:00:00`).toLocaleDateString("es-ES", {
                          day: "numeric",
                          month: "short",
                        }),
                        value: d.clicks,
                      }))}
                      height={200}
                      label="Clics desde Google por día"
                    />
                  </div>
                </section>
              )}

              <section className="card">
                <h2 className="card-title">Qué buscan para encontrarte</h2>
                <div style={{ marginTop: "var(--s3)" }}>
                  <RowsTable rows={perf.queries} label="Búsqueda" />
                </div>
              </section>

              <section className="card">
                <h2 className="card-title">Páginas que más entran</h2>
                <div style={{ marginTop: "var(--s3)" }}>
                  <RowsTable rows={perf.pages} label="Página" />
                </div>
              </section>

              <p className="hint">
                Últimos 28 días, hasta hace tres: Search Console tarda un par de días en
                consolidar, y pedir hasta hoy devolvería los últimos días a cero como si
                hubieras caído en picado. La posición media es la del resultado en Google —
                cuanto más baja, mejor.
              </p>
            </>
          ) : (
            sites.length === 0 && (
              <section className="card">
                <div className="empty">
                  <IconChart />
                  <p>Elige una web arriba para ver sus datos.</p>
                </div>
              </section>
            )
          )}
        </>
      )}
    </main>
  );
}

export default function SeoPage() {
  // useSearchParams() obliga a un límite de Suspense: sin él, Next falla el
  // build de esta ruta al prerenderizarla.
  return (
    <Suspense fallback={<main className="main-wide" />}>
      <SeoContent />
    </Suspense>
  );
}
