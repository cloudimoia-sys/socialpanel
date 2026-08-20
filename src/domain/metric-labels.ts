/**
 * La métrica principal de cada red, en castellano llano.
 *
 * La API de Upload-Post devuelve la etiqueta de cada red en su jerga y en
 * inglés ("Unique Reach", "Video Views"), que no dice nada a quien lleva una
 * peluquería.
 *
 * Se traduce por RED y no por nombre de campo porque el campo miente: TikTok
 * y X mandan los dos `impressions`, pero en TikTok son reproducciones de un
 * vídeo y en X veces que apareció en pantalla. Unificarlas por nombre de
 * campo sería más cómodo y menos cierto.
 *
 * Vive en `domain/` y no en la página de Métricas porque el informe en PDF
 * necesita la misma traducción exacta — si cada sitio tradujera por su
 * cuenta, acabarían divergiendo con el tiempo.
 */
export const IMPRESSIONS_LABEL: Record<string, string> = {
  instagram: "Personas alcanzadas",
  facebook: "Personas alcanzadas",
  linkedin: "Personas alcanzadas",
  threads: "Personas alcanzadas",
  tiktok: "Reproducciones",
  youtube: "Reproducciones",
  x: "Veces que se vio",
  pinterest: "Veces que se vio",
};
