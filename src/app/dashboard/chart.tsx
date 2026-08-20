"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Gráfica de área con trazo animado.
 *
 * Dibujada a mano y sin librería de gráficas, igual que los iconos y las
 * minigráficas de métricas: son unas decenas de puntos y una polilínea, y una
 * dependencia de charts añade cientos de KB al bundle para esto.
 *
 * Todo el dibujo vive en un `viewBox` fijo y el SVG se escala al ancho
 * disponible. Así el texto guarda su proporción con el trazo sin tener que
 * medir el contenedor ni recalcular en cada cambio de tamaño.
 */

export interface ChartPoint {
  /** Etiqueta del eje X. Solo se pintan la primera, la del medio y la última. */
  label: string;
  value: number;
}

interface Props {
  points: ChartPoint[];
  /** Alto en píxeles del recuadro dibujado. El ancho siempre es el disponible. */
  height?: number;
  /** Cómo se escribe un valor en el eje y en el globo. Por defecto, entero. */
  format?: (value: number) => string;
  /** Descripción para lectores de pantalla: la gráfica en sí es decorativa. */
  label: string;
}

const VIEW_W = 800;
const VIEW_H = 260;
const PAD = { top: 18, right: 12, bottom: 26, left: 46 };

const defaultFormat = (value: number) => Math.round(value).toLocaleString("es-ES");

/**
 * Catmull-Rom a Bézier cúbica: la misma polilínea, pero como curva suave.
 * Nexo (la referencia visual) usa curvas; una polilínea de pocos puntos se ve
 * angulosa y menos "de producto". Los valores no cambian, solo cómo se unen.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0]!.x},${pts[0]!.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

/**
 * Redondea el techo del eje a una cifra "limpia" (10, 25, 500, 2.000…).
 *
 * Con el máximo real como techo, el pico toca el borde superior y la gráfica
 * parece cortada; además las etiquetas salen con números arbitrarios como
 * "3.847" que no ayudan a leer nada.
 */
function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= max) return candidate;
  }
  return 10 * magnitude;
}

export function AreaChart({ points, height = 260, format = defaultFormat, label }: Props) {
  const gradientId = useId();
  const pathRef = useRef<SVGPathElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  /**
   * El trazo se anima con `stroke-dashoffset`, y para eso hace falta la
   * longitud real del camino — que solo la sabe el navegador una vez pintado.
   */
  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      path.style.strokeDasharray = "none";
      return;
    }

    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    // Forzar el reflujo antes de quitar el desfase: sin esto el navegador
    // agrupa las dos escrituras y no hay transición que animar.
    void path.getBoundingClientRect();
    path.style.transition = "stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)";
    path.style.strokeDashoffset = "0";
  }, [points]);

  if (points.length < 2) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Todavía no hay suficientes datos para dibujar una tendencia.
      </p>
    );
  }

  const values = points.map((p) => p.value);
  const top = niceCeiling(Math.max(...values));

  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = VIEW_H - PAD.top - PAD.bottom;

  const x = (index: number) => PAD.left + (index / (points.length - 1)) * plotW;
  const y = (value: number) => PAD.top + plotH - (value / top) * plotH;

  const coords = points.map((p, i) => ({ x: x(i), y: y(p.value) }));
  const line = smoothPath(coords);
  const area = `${line} L${x(points.length - 1)},${PAD.top + plotH} L${PAD.left},${PAD.top + plotH} Z`;

  const gridValues = [0, top / 2, top];
  const last = points.length - 1;
  // Segundo cinturón: aunque `hover` llegase fuera de rango, se cae al último
  // punto en vez de indexar un hueco. El coste es una comprobación; el fallo
  // que evita es la página en blanco.
  const active = hover !== null && points[hover] ? hover : last;

  return (
    <div className="chart" style={{ ["--chart-h" as string]: `${height}px` }}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={label}
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          // Ancho cero significa que el SVG no está maquetado todavía (dentro
          // de un panel plegado, o en el primer fotograma). Dividir por él da
          // NaN, y un índice NaN busca un punto que no existe y rompe el
          // render entero.
          if (box.width === 0) return;

          // De píxeles de pantalla a unidades del viewBox, y de ahí al índice
          // del punto más cercano.
          const withinView = ((event.clientX - box.left) / box.width) * VIEW_W;
          const ratio = (withinView - PAD.left) / plotW;
          const index = Math.round(ratio * (points.length - 1));
          if (!Number.isFinite(index)) return;

          setHover(Math.min(points.length - 1, Math.max(0, index)));
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={VIEW_W - PAD.right}
              y1={y(value)}
              y2={y(value)}
              className="chart-grid"
            />
            <text x={PAD.left - 8} y={y(value) + 4} className="chart-axis" textAnchor="end">
              {format(value)}
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#${gradientId})`} className="chart-area" />
        <path ref={pathRef} d={line} className="chart-line" />

        {[0, Math.floor(last / 2), last].map((index) => (
          <text key={index} x={x(index)} y={VIEW_H - 6} className="chart-axis" textAnchor="middle">
            {points[index]!.label}
          </text>
        ))}

        <line
          x1={x(active)}
          x2={x(active)}
          y1={PAD.top}
          y2={PAD.top + plotH}
          className="chart-cursor"
          data-visible={hover !== null || undefined}
        />
        <circle cx={x(active)} cy={y(points[active]!.value)} r="5" className="chart-dot" />

        <text
          x={Math.min(VIEW_W - PAD.right - 4, Math.max(PAD.left + 4, x(active)))}
          y={Math.max(14, y(points[active]!.value) - 14)}
          className="chart-value"
          textAnchor={active > last / 2 ? "end" : "start"}
        >
          {format(points[active]!.value)}
        </text>
      </svg>
    </div>
  );
}
