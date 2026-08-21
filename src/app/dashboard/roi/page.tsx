"use client";

import { useEffect, useState } from "react";
import { IconAlert, IconChart } from "@/app/icons";
import { PlatformIcon, platformLabel } from "@/app/platform-icons";

interface RoiFunnel {
  platform: string | null;
  total: number;
  contactedOrMore: number;
  quotedOrMore: number;
  won: number;
  lost: number;
  revenueCents: number;
  wonWithValue: number;
}

const euros = (cents: number) => `${(cents / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;

function FunnelStats({ f }: { f: RoiFunnel }) {
  return (
    <div className="metrics">
      <div>
        <span className="stat">{f.total}</span>
        <span className="muted">Leads</span>
      </div>
      <div>
        <span className="stat">{f.contactedOrMore}</span>
        <span className="muted">Contactados o más</span>
      </div>
      <div>
        <span className="stat">{f.quotedOrMore}</span>
        <span className="muted">Con presupuesto o más</span>
      </div>
      <div>
        <span className="stat">{f.won}</span>
        <span className="muted">Clientes (ganados)</span>
      </div>
    </div>
  );
}

function Revenue({ f }: { f: RoiFunnel }) {
  if (f.won === 0) {
    return (
      <p className="hint" style={{ marginBottom: 0 }}>
        Todavía sin ningún lead ganado.
      </p>
    );
  }
  return (
    <p style={{ marginBottom: 0 }}>
      <strong style={{ fontSize: "1.125rem" }}>{euros(f.revenueCents)}</strong>{" "}
      <span className="muted">
        estimados · {f.wonWithValue} de {f.won} ganados con valor registrado
      </span>
    </p>
  );
}

export default function RoiPage() {
  const [data, setData] = useState<{ total: RoiFunnel; byPlatform: RoiFunnel[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/roi");
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "No se pudo calcular el ROI.");
        return;
      }
      setData(json);
    })();
  }, []);

  return (
    <main>
      <header className="page-head">
        <h1>ROI de redes</h1>
        <p>Redes → Leads → Clientes → Facturación, sobre tu pipeline real de Leads.</p>
      </header>

      {error && (
        <p className="error" role="alert">
          <IconAlert />
          {error}
        </p>
      )}

      {data === null ? (
        <section className="card">
          <div className="skeleton" style={{ width: "60%" }} />
        </section>
      ) : data.total.total === 0 ? (
        <section className="card">
          <div className="empty">
            <IconChart />
            <p>Todavía no hay ningún lead con el que calcular esto.</p>
            <a href="/dashboard/leads" className="btn">
              Ir a Leads
            </a>
          </div>
        </section>
      ) : (
        <>
          <section className="card">
            <h2 className="card-title">Total</h2>
            <FunnelStats f={data.total} />
            <div style={{ marginTop: "var(--s3)" }}>
              <Revenue f={data.total} />
            </div>
            {data.total.lost > 0 && (
              <p className="hint" style={{ marginTop: "var(--s2)", marginBottom: 0 }}>
                {data.total.lost} marcados como perdidos, no incluidos arriba.
              </p>
            )}
          </section>

          <div className="grid-2">
            {data.byPlatform.map((f) => (
              <section className="card" key={f.platform ?? "sin-red"}>
                <div className="card-head">
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
                    {f.platform && <PlatformIcon platform={f.platform} size={20} />}
                    <strong>{f.platform ? platformLabel(f.platform) : "Sin red"}</strong>
                  </span>
                </div>
                <FunnelStats f={f} />
                <div style={{ marginTop: "var(--s3)" }}>
                  <Revenue f={f} />
                </div>
              </section>
            ))}
          </div>

          <p className="hint">
            Se calcula sobre el estado ACTUAL de cada lead, no sobre un historial de por dónde
            pasó: esta app no guarda cada cambio de estado, solo el de hoy. Un lead perdido que
            llegó a tener presupuesto ya no cuenta ahí. La facturación es la suma de lo que se
            registró a mano en los leads ganados — puede ser un mínimo, no el total real, si
            falta rellenar el valor en alguno.
          </p>
        </>
      )}
    </main>
  );
}
