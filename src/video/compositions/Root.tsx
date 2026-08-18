import { Composition } from "remotion";
import { Stats, type StatsProps } from "./Stats";

/**
 * Registro de plantillas de vídeo.
 *
 * `id` es lo que se referencia desde `renderInfographic()`. Añadir una
 * plantilla nueva es un componente más aquí, sin tocar el resto del pipeline.
 */
const DEFAULT_STATS: StatsProps = {
  title: "Título de ejemplo",
  stat1Value: "9%",
  stat1Label: "etiqueta",
  stat2Value: "91%",
  stat2Label: "etiqueta",
  footer: "marca.es",
  bg: "#0b0e12",
  accent: "#3E9BE0",
  accentDeep: "#1B5FA9",
  textColor: "#e8edf2",
  mutedColor: "#93a3b4",
  fontFamily: "Poppins",
};

export const RemotionRoot = () => (
  <>
    <Composition
      id="Stats"
      component={Stats}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1080}
      defaultProps={DEFAULT_STATS}
    />
  </>
);
