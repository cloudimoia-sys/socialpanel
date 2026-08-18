import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontFaceCss } from "./fonts";

/**
 * Plantilla "dos cifras": el infograma más simple y el más reutilizable — el
 * dato suelto es el formato de actualidad de sector más habitual
 * ("9% de pymes están digitalmente avanzadas", "53% pierde ROI por falta de
 * contexto en IA"...).
 *
 * Texto dibujado con CSS, no generado: ningún modelo de vídeo renderiza texto
 * de forma fiable, así que el texto nunca pasa por un modelo. Cambiar una
 * cifra es cambiar props, no volver a generar nada.
 */

// `type` y no `interface` a propósito: Remotion serializa las props como
// Record<string, unknown> para pasarlas al navegador sin interfaz, y una
// `interface` no es estructuralmente asignable a eso aunque todos sus campos
// encajen — el mismo problema que ya nos dio Supabase con sus tipos de tabla.
export type StatsProps = {
  title: string;
  stat1Value: string;
  stat1Label: string;
  stat2Value: string;
  stat2Label: string;
  footer: string;
  bg: string;
  accent: string;
  accentDeep: string;
  textColor: string;
  mutedColor: string;
  /** Nombre de familia ya registrado vía @remotion/fonts antes del render. */
  fontFamily: string;
};

function fadeUp(frame: number, fps: number, delay: number) {
  const local = frame - delay;
  const opacity = interpolate(local, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = spring({ frame: local, fps, config: { damping: 200 }, from: 24, to: 0 });
  return { opacity, transform: `translateY(${y}px)` };
}

function Stat({
  value,
  label,
  delay,
  accent,
  muted,
  fontFamily,
}: {
  value: string;
  label: string;
  delay: number;
  accent: string;
  muted: string;
  fontFamily: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const style = fadeUp(frame, fps, delay);

  return (
    <div style={{ ...style, textAlign: "center" }}>
      <div style={{ fontSize: 96, fontWeight: 700, color: accent, fontFamily, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 28, color: muted, fontFamily, marginTop: 12 }}>{label}</div>
    </div>
  );
}

export function Stats(props: StatsProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const title = fadeUp(frame, fps, 0);
  const bar = interpolate(frame, [40, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const footer = interpolate(frame, [80, 100], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: props.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 48,
        padding: 80,
      }}
    >
      {/* La hoja @font-face va inline en el propio frame: así el navegador
          sin cabeza que renderiza cada fotograma la ve siempre. */}
      <style>{fontFaceCss()}</style>

      <div
        style={{
          ...title,
          fontSize: 44,
          fontWeight: 700,
          color: props.textColor,
          fontFamily: props.fontFamily,
          textAlign: "center",
          whiteSpace: "pre-line",
        }}
      >
        {props.title}
      </div>

      <div style={{ display: "flex", gap: 96 }}>
        <Stat
          value={props.stat1Value}
          label={props.stat1Label}
          delay={20}
          accent={props.accent}
          muted={props.mutedColor}
          fontFamily={props.fontFamily}
        />
        <Stat
          value={props.stat2Value}
          label={props.stat2Label}
          delay={30}
          accent={props.accent}
          muted={props.mutedColor}
          fontFamily={props.fontFamily}
        />
      </div>

      <div
        style={{
          width: 700,
          height: 8,
          background: "rgba(255,255,255,0.08)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${bar * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${props.accentDeep}, ${props.accent})`,
          }}
        />
      </div>

      <div
        style={{
          opacity: footer,
          fontSize: 24,
          color: props.accent,
          fontFamily: props.fontFamily,
          fontWeight: 600,
        }}
      >
        {props.footer}
      </div>
    </AbsoluteFill>
  );
}
