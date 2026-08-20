/**
 * Catálogo de tipografías, en su propio módulo y sin dependencias nativas.
 *
 * `compose.ts` importa `@napi-rs/canvas` (un binario nativo por plataforma),
 * y este catálogo también lo necesita el formulario de empresa, que es un
 * componente de cliente. Si viviera dentro de `compose.ts`, el bundler
 * intentaría empaquetar `@napi-rs/canvas` para el navegador al importar el
 * catálogo desde allí — rompería el build o, peor, se colaría en el bundle
 * del cliente un binario que no puede correr ahí.
 */

export interface FontFamily {
  /** Coincide con el prefijo de los archivos en `assets/fonts/`. */
  id: string;
  name: string;
  note: string;
  group: string;
  /** Manuscrita: ni se pasa a versales ni aguanta titulares largos. */
  script?: boolean;
}

export const FONT_FAMILIES: FontFamily[] = [
  { id: "Poppins", name: "Poppins", note: "Moderna y cercana", group: "Modernas" },
  { id: "Montserrat", name: "Montserrat", note: "Versátil, la más usada", group: "Modernas" },
  { id: "Inter", name: "Inter", note: "Neutra y técnica", group: "Modernas" },
  { id: "Anton", name: "Anton", note: "Condensada muy pesada", group: "Impacto" },
  { id: "BebasNeue", name: "Bebas Neue", note: "Condensada en mayúsculas", group: "Impacto" },
  { id: "ArchivoBlack", name: "Archivo Black", note: "Muy pesada y ancha", group: "Impacto" },
  { id: "Oswald", name: "Oswald", note: "Condensada legible", group: "Impacto" },
  { id: "PlayfairDisplay", name: "Playfair Display", note: "Serif editorial", group: "Serif" },
  { id: "LibreBaskerville", name: "Libre Baskerville", note: "Clásica y seria", group: "Serif" },
  { id: "RobotoSlab", name: "Roboto Slab", note: "Robusta, de oficio", group: "Serif" },
  { id: "Nunito", name: "Nunito", note: "Redondeada y amable", group: "Amables" },
  { id: "Quicksand", name: "Quicksand", note: "Ligera y suave", group: "Amables" },
  {
    id: "Caveat",
    name: "Caveat",
    note: "Manuscrita — cuesta leerla en titulares largos",
    group: "Manuscritas",
    script: true,
  },
  {
    id: "Pacifico",
    name: "Pacifico",
    note: "Manuscrita retro — mejor en frases cortas",
    group: "Manuscritas",
    script: true,
  },
];
