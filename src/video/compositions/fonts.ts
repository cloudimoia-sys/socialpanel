import { staticFile } from "remotion";

/**
 * Poppins local — la misma fuente que usa el compositor de imágenes
 * (src/domain/compose.ts), para que vídeo e imagen hablen el mismo idioma
 * tipográfico. Se carga explícitamente y no se depende de fuentes del
 * sistema: el navegador sin interfaz que renderiza cada fotograma no tiene
 * por qué tenerlas instaladas.
 */
export function fontFaceCss(): string {
  const face = (weight: number, file: string) => `
    @font-face {
      font-family: 'Poppins';
      font-weight: ${weight};
      src: url('${staticFile(file)}') format('truetype');
    }
  `;
  return [
    face(400, "fonts/Poppins-Regular.ttf"),
    face(600, "fonts/Poppins-SemiBold.ttf"),
    face(700, "fonts/Poppins-Bold.ttf"),
  ].join("\n");
}
