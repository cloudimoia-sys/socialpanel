import localFont from "next/font/local";

/**
 * Poppins servida desde el propio proyecto.
 *
 * Es la misma familia que usa el compositor de imágenes, así que la interfaz y
 * las piezas generadas hablan el mismo idioma tipográfico. Servirla en local y
 * no desde Google Fonts evita una petición a un tercero en cada carga y que la
 * interfaz dependa de que ese tercero esté disponible.
 */
export const poppins = localFont({
  src: [
    { path: "../../assets/fonts/Poppins-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../assets/fonts/Poppins-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../../assets/fonts/Poppins-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});
