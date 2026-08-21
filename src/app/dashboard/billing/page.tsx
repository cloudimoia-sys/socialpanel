"use client";

import { useCallback, useEffect, useState } from "react";
import { IconAlert, IconCheck } from "@/app/icons";
// El tipo real del dominio, no una copia a mano: `plans.ts` no importa nada
// (es dato puro), así que puede cruzar al cliente sin arrastrar el servidor.
// La copia que había aquí se quedó desfasada en cuanto las cuotas pasaron a
// agruparse por módulo, y el typecheck no podía avisar de la diferencia.
import type { Plan } from "@/domain/plans";

interface Billing {
  plan: Plan;
  status: string;
  renewsAt: string | null;
  hasSubscription: boolean;
  usage: { posts: number; images: number; videoSeconds: number; spentCents: number };
  catalog: Plan[];
}

const euros = (cents: number) => `${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)} €`;

const STATUS: Record<string, { label: string; className: string }> = {
  none: { label: "En prueba", className: "badge" },
  trialing: { label: "En prueba", className: "badge badge-brand" },
  active: { label: "Activa", className: "badge badge-ok" },
  past_due: { label: "Pago pendiente", className: "badge badge-danger" },
  canceled: { label: "Cancelada", className: "badge badge-warn" },
};

function Bar({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div style={{ marginBottom: "var(--s3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".8125rem" }}>
        <span>{label}</span>
        <span className="muted">
          {used} / {total}
        </span>
      </div>
      <div className="meter">
        <div style={{ width: `${pct}%`, background: pct > 85 ? "var(--warn)" : "var(--brand)" }} />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const [data, setData] = useState<Billing | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/billing");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo cargar la facturación.");
      return;
    }
    setData(json);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function go(path: string, body?: object, key = "") {
    setBusy(key);
    setError("");

    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();

    if (!res.ok) {
      setBusy("");
      setError(json.error ?? "No se pudo continuar.");
      return;
    }
    // El pago y la gestión ocurren en Stripe, no aquí.
    window.location.href = json.url;
  }

  if (!data) {
    return (
      <main>
        <div className="card">
          <div className="skeleton" style={{ width: "30%", height: "1rem" }} />
          <div className="skeleton" style={{ width: "60%" }} />
        </div>
      </main>
    );
  }

  const status = STATUS[data.status] ?? STATUS.none!;

  return (
    <main>
      <header className="page-head">
        <h1>Plan y consumo</h1>
        <p>Lo que incluye tu plan y cuánto llevas usado este mes.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      {data.status === "past_due" && (
        <section className="card notice-warn">
          <h2 className="card-title" style={{ color: "var(--warn)" }}>
            Pago pendiente
          </h2>
          <p style={{ margin: 0 }}>
            No hemos podido cobrar la última cuota. La generación está pausada hasta que se
            resuelva.
          </p>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Tu plan</h2>
          <span className={status.className}>{status.label}</span>
        </div>

        <div className="stat">
          {data.plan.name} · {euros(data.plan.priceCents)}
          {data.plan.priceCents > 0 && <span className="muted"> /mes</span>}
        </div>

        {data.renewsAt && (
          <p className="muted" style={{ marginBottom: "var(--s4)" }}>
            Se renueva el{" "}
            {new Date(data.renewsAt).toLocaleDateString("es-ES", {
              day: "numeric",
              month: "long",
            })}
          </p>
        )}

        <div style={{ marginTop: "var(--s4)" }}>
          <Bar used={data.usage.posts} total={data.plan.social.posts} label="Publicaciones" />
          <Bar used={data.usage.images} total={data.plan.social.images} label="Imágenes" />
          {data.plan.social.videoSeconds > 0 && (
            <Bar
              used={Math.round(data.usage.videoSeconds)}
              total={data.plan.social.videoSeconds}
              label="Segundos de vídeo"
            />
          )}
        </div>

        {data.hasSubscription && (
          <div className="actions" style={{ marginTop: "var(--s4)" }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => go("/api/billing/portal", undefined, "portal")}
              disabled={busy !== ""}
            >
              {busy === "portal" ? "Abriendo…" : "Gestionar suscripción"}
            </button>
            <span className="muted">Cambiar plan, tarjeta, facturas o cancelar.</span>
          </div>
        )}
      </section>

      <div className="grid-2">
        {data.catalog
          .filter((p) => p.priceCents > 0)
          .map((p) => {
            const current = p.id === data.plan.id;
            return (
              <section key={p.id} className="card" style={current ? { borderColor: "var(--brand)" } : undefined}>
                <div className="card-head">
                  <h2 className="card-title">{p.name}</h2>
                  {current && <span className="badge badge-brand">actual</span>}
                </div>

                <div className="stat">
                  {euros(p.priceCents)}
                  <span className="muted" style={{ fontSize: "0.875rem" }}> /mes</span>
                </div>

                <ul className="list" style={{ marginTop: "var(--s3)" }}>
                  <li>
                    <IconCheck className="" /> {p.social.posts} publicaciones al mes
                  </li>
                  <li>
                    <IconCheck className="" /> {p.social.images} imágenes
                  </li>
                  <li>
                    <IconCheck className="" />{" "}
                    {p.social.videoSeconds > 0 ? `${p.social.videoSeconds} s de vídeo` : "Sin vídeo"}
                  </li>
                  <li>
                    <IconCheck className="" /> {p.social.networks} redes conectadas
                  </li>
                  {/* Módulos de pago aparte del núcleo. Solo se listan los que
                      ese plan incluye de verdad: prometer aquí un módulo que
                      todavía no existe es vender lo que no se puede usar. */}
                  {p.seo && (
                    <li>
                      <IconCheck className="" /> SEO: {p.seo.sites}{" "}
                      {p.seo.sites === 1 ? "web" : "webs"} en Search Console
                    </li>
                  )}
                  {/* Solo si de verdad incluye rastreo de posiciones: "0
                      keywords rastreadas" no es una característica. */}
                  {p.seo && p.seo.trackedKeywords > 0 && (
                    <li>
                      <IconCheck className="" /> {p.seo.trackedKeywords} keywords rastreadas
                    </li>
                  )}
                  {p.email && (
                    <li>
                      <IconCheck className="" /> Email: {p.email.sends.toLocaleString("es-ES")} envíos al mes
                    </li>
                  )}
                </ul>

                {!current && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      style={{ marginTop: "var(--s4)", width: "100%" }}
                      onClick={() => go("/api/billing/checkout", { plan: p.id }, p.id)}
                      disabled={busy !== ""}
                    >
                      {busy === p.id ? "Abriendo…" : `Probar ${p.name} 7 días`}
                    </button>
                    <p className="hint" style={{ textAlign: "center" }}>
                      Gratis 7 días. Se pide tarjeta y no se cobra nada hasta el día 8.
                    </p>
                  </>
                )}
              </section>
            );
          })}
      </div>

      <p className="hint">
        El pago lo gestiona Stripe: no guardamos ni vemos los datos de tu tarjeta en ningún
        momento. Puedes cancelar durante la prueba desde «Gestionar suscripción» y no se
        cobrará nada.
      </p>
    </main>
  );
}
