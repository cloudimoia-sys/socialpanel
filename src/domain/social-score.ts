/**
 * Social Score: una cifra de 0 a 100 sobre cómo va la cuenta.
 *
 * Cuatro dimensiones, y solo cuatro, porque son las únicas que se pueden
 * calcular con datos reales de este producto. Deliberadamente NO incluye
 * "conversión" ni "crecimiento de leads" — no hay CRM en la app, y
 * fabricar esa cifra sería mentir con un número que parece objetivo.
 *
 * Cada dimensión que falta (sin redes conectadas, sin ningún post marcado
 * como ganador todavía) se EXCLUYE del total en vez de puntuar 0 — puntuar 0
 * algo que simplemente no se ha usado todavía penalizaría a quien no ha
 * adoptado esa función, no a quien lo hace mal.
 */

export interface ScoreInputs {
  /** Posts creados en los últimos 30 días. */
  postsLast30: number;
  /** De las últimas 4 semanas, cuántas tuvieron al menos un post (0-4). */
  weeksWithPost: number;
  /**
   * Tasa de interacción (me gusta+comentarios+compartidos / alcance) de cada
   * red que expone esos tres datos. Una lista vacía significa "sin datos
   * suficientes", no "cero interacción".
   */
  engagementRates: number[];
  /** null si el tenant nunca ha marcado ningún post como ganador. */
  winnerRatio: number | null;
}

export interface ScoreDimension {
  score: number | null;
  label: string;
  detail: string;
}

export interface SocialScore {
  total: number | null;
  dimensions: {
    frequency: ScoreDimension;
    consistency: ScoreDimension;
    engagement: ScoreDimension;
    quality: ScoreDimension;
  };
  tips: string[];
}

/**
 * 12 publicaciones al mes (~3/semana) como referencia de "100 en frecuencia".
 * Es una cadencia razonable para una pyme gestionando esto sola, no una cifra
 * derivada de ningún estudio — se documenta como lo que es: un valor de
 * partida sensato, ajustable si con el tiempo resulta que no encaja.
 */
const FREQUENCY_TARGET = 12;

/**
 * Referencia de interacción: 1% se considera aceptable en la mayoría de
 * redes, 3% ya es notable. Escala lineal entre 0% y 3%, tope en 100 a partir
 * de ahí. Como con FREQUENCY_TARGET, es una aproximación razonable y no una
 * cifra oficial de ninguna plataforma — no existe una API que dé "la tasa de
 * interacción media del sector" en tiempo real.
 */
const ENGAGEMENT_TARGET = 0.03;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function computeSocialScore(input: ScoreInputs): SocialScore {
  const frequency: ScoreDimension = {
    score: clamp((input.postsLast30 / FREQUENCY_TARGET) * 100),
    label: "Frecuencia",
    detail: `${input.postsLast30} publicaciones en 30 días (referencia: ${FREQUENCY_TARGET})`,
  };

  const consistency: ScoreDimension = {
    score: clamp((input.weeksWithPost / 4) * 100),
    label: "Constancia",
    detail: `${input.weeksWithPost} de las últimas 4 semanas con algo publicado`,
  };

  const engagement: ScoreDimension =
    input.engagementRates.length === 0
      ? {
          score: null,
          label: "Interacción",
          detail: "Sin datos todavía — hace falta alcance real en al menos una red",
        }
      : {
          score: clamp(
            (input.engagementRates.reduce((a, b) => a + b, 0) /
              input.engagementRates.length /
              ENGAGEMENT_TARGET) *
              100,
          ),
          label: "Interacción",
          detail: `${(
            (input.engagementRates.reduce((a, b) => a + b, 0) / input.engagementRates.length) *
            100
          ).toFixed(1)}% de media, sobre el alcance`,
        };

  const quality: ScoreDimension =
    input.winnerRatio === null
      ? {
          score: null,
          label: "Calidad marcada",
          detail: "Sin datos todavía — marca algún post como ganador en Contenido",
        }
      : {
          score: clamp(input.winnerRatio * 100),
          label: "Calidad marcada",
          detail: `${Math.round(input.winnerRatio * 100)}% de lo reciente, marcado como ganador`,
        };

  // Media ponderada solo de las dimensiones con dato real. Si faltan las dos
  // opcionales, el total sale solo de frecuencia y constancia — sigue siendo
  // honesto, solo que con menos información detrás.
  const weighted: [number | null, number][] = [
    [frequency.score, 0.3],
    [consistency.score, 0.25],
    [engagement.score, 0.25],
    [quality.score, 0.2],
  ];
  const available = weighted.filter((w): w is [number, number] => w[0] !== null);
  const weightSum = available.reduce((sum, [, w]) => sum + w, 0);
  const total = weightSum > 0 ? clamp(available.reduce((sum, [s, w]) => sum + s * w, 0) / weightSum) : null;

  const tips: string[] = [];
  if (engagement.score === null) {
    tips.push("Conecta una red con seguidores reales para ver la interacción aquí.");
  }
  if (quality.score === null) {
    tips.push("Marca algún post como ganador en Contenido para activar esta métrica.");
  }
  if (frequency.score !== null && frequency.score < 60) {
    tips.push(`Llevas ${input.postsLast30} publicaciones este mes. Sube el ritmo o configura huecos fijos en Cola.`);
  }
  if (consistency.score !== null && consistency.score < 75) {
    tips.push("Publicas de forma irregular — configura huecos semanales para no depender de acordarte.");
  }
  if (engagement.score !== null && engagement.score < 40) {
    tips.push("La interacción está baja respecto a lo esperable. Prueba formatos distintos y compara en Métricas.");
  }

  return {
    total,
    dimensions: { frequency, consistency, engagement, quality },
    tips: tips.slice(0, 3),
  };
}
