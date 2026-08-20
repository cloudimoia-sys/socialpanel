"use client";

import { useEffect, useState } from "react";

interface Dimension {
  score: number | null;
  label: string;
  detail: string;
}

interface Score {
  total: number | null;
  dimensions: { frequency: Dimension; consistency: Dimension; engagement: Dimension; quality: Dimension };
  tips: string[];
}

/**
 * Solo cuatro dimensiones, no las siete de un "social score" al uso: son las
 * únicas que se pueden calcular con datos reales de este producto. No hay
 * CRM aquí, así que "conversión" o "leads" tendrían que inventarse — y un
 * número que parece objetivo pero no lo es es peor que no tener número.
 */
export function SocialScoreCard() {
  const [score, setScore] = useState<Score | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/social-score");
      if (!res.ok) return;
      setScore(await res.json());
    })();
  }, []);

  if (!score) {
    return (
      <section className="card">
        <div className="skeleton" style={{ width: "30%", height: "2rem" }} />
      </section>
    );
  }

  const dims = Object.values(score.dimensions);

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Social Score</h2>
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          frecuencia · constancia · interacción · calidad marcada
        </span>
      </div>

      <div style={{ display: "flex", gap: "var(--s5)", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <div className="stat" style={{ fontSize: "2.5rem" }}>
            {score.total ?? "—"}
            <span className="muted" style={{ fontSize: "1rem", fontWeight: 500 }}>
              /100
            </span>
          </div>
        </div>

        <div className="kpis" style={{ flex: 1, minWidth: "16rem", marginBottom: 0 }}>
          {dims.map((d) => (
            <div className="kpi" key={d.label}>
              <div className="value" style={{ fontSize: "1.25rem" }}>
                {d.score ?? "—"}
              </div>
              <div className="label">{d.label}</div>
            </div>
          ))}
        </div>
      </div>

      {score.tips.length > 0 && (
        <ul style={{ margin: "var(--s4) 0 0", paddingLeft: "1.1rem" }}>
          {score.tips.map((tip) => (
            <li key={tip} className="muted" style={{ fontSize: "0.8125rem", marginBottom: "var(--s1)" }}>
              {tip}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
