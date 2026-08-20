import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { IMPRESSIONS_LABEL } from "./metric-labels";

/**
 * Informe mensual en PDF, dibujado directamente con `pdf-lib` — sin
 * lanzar un navegador.
 *
 * Es la misma filosofía que `compose.ts` y el vídeo infograma: código en vez
 * de un modelo o un motor de renderizado pesado. Un PDF con texto de verdad
 * (copiable, buscable) no necesita Chromium detrás, y evitarlo aquí importa
 * más que en el folleto suelto: esto se genera en cada petición de un
 * endpoint real, en el mismo proceso serverless que sirve la app — no en una
 * terminal de desarrollo.
 *
 * Fuentes estándar (Helvetica) y no las TTF de `assets/fonts/`: su
 * codificación WinAnsi ya cubre tildes, eñes y ¿¡ del español, y evita
 * arrastrar aquí el mismo problema de codificación que dio el folleto en
 * HTML cuando faltó declarar el charset — con una fuente estándar no hay
 * charset que declarar mal.
 */

export interface ReportPlatformStat {
  platform: string;
  followers: number | null;
  impressions: number | null;
}

export interface ReportData {
  businessName: string;
  periodLabel: string;
  generatedAt: Date;
  postsCreated: number;
  postsPublished: number;
  postsScheduled: number;
  platforms: ReportPlatformStat[];
  winners: string[];
}

const PAGE_W = 595.28; // A4 a 72 dpi
const PAGE_H = 841.89;
const MARGIN = 50;
const ACCENT = rgb(0.243, 0.608, 0.878); // #3E9BE0
const INK = rgb(0.05, 0.07, 0.1);
const MUTED = rgb(0.45, 0.48, 0.52);

const fmtNum = (n: number | null) => (n === null ? "—" : Math.round(n).toLocaleString("es-ES"));

/** Envuelve texto a un ancho máximo, midiendo con la fuente real. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderMonthlyReport(data: ReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Informe — ${data.businessName}`);
  doc.setProducer("SocialPanel");

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const maxWidth = PAGE_W - MARGIN * 2;

  /** Nueva página cuando no queda sitio, para no dibujar fuera del papel. */
  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  }

  function heading(text: string, size = 18) {
    ensureSpace(size + 10);
    page.drawText(text, { x: MARGIN, y, size, font: bold, color: INK });
    y -= size + 10;
  }

  function subheading(text: string) {
    ensureSpace(24);
    page.drawText(text.toUpperCase(), { x: MARGIN, y, size: 10, font: bold, color: ACCENT });
    y -= 20;
  }

  function paragraph(text: string, size = 10, color = MUTED) {
    for (const line of wrap(text, regular, size, maxWidth)) {
      ensureSpace(size + 6);
      page.drawText(line, { x: MARGIN, y, size, font: regular, color });
      y -= size + 6;
    }
  }

  function rule() {
    ensureSpace(16);
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: rgb(0.85, 0.87, 0.89),
    });
    y -= 16;
  }

  // --- Cabecera ---------------------------------------------------------
  page.drawRectangle({ x: MARGIN, y: y - 4, width: 14, height: 14, color: ACCENT });
  page.drawText(data.businessName, { x: MARGIN + 22, y, size: 14, font: bold, color: INK });
  y -= 26;
  paragraph(`Informe mensual · ${data.periodLabel}`, 10, MUTED);
  y -= 10;
  rule();

  // --- KPIs ---------------------------------------------------------------
  const kpis: [string, string][] = [
    ["Publicaciones creadas", String(data.postsCreated)],
    ["Publicadas", String(data.postsPublished)],
    ["Programadas", String(data.postsScheduled)],
  ];
  const colW = maxWidth / kpis.length;
  ensureSpace(50);
  const kpiTop = y;
  kpis.forEach(([label, value], i) => {
    const x = MARGIN + i * colW;
    page.drawText(value, { x, y: kpiTop, size: 22, font: bold, color: INK });
    page.drawText(label, { x, y: kpiTop - 18, size: 9, font: regular, color: MUTED });
  });
  y = kpiTop - 40;
  rule();

  // --- Redes ----------------------------------------------------------------
  subheading("Redes sociales");
  if (data.platforms.length === 0) {
    paragraph("Ninguna cuenta conectada todavía.");
  } else {
    const rowH = 22;
    for (const p of data.platforms) {
      ensureSpace(rowH);
      const label = IMPRESSIONS_LABEL[p.platform] ?? "Visualizaciones";
      page.drawText(p.platform, { x: MARGIN, y, size: 10, font: bold, color: INK });
      page.drawText(`${fmtNum(p.followers)} seguidores`, {
        x: MARGIN + 130,
        y,
        size: 10,
        font: regular,
        color: MUTED,
      });
      page.drawText(`${fmtNum(p.impressions)} · ${label}`, {
        x: MARGIN + 300,
        y,
        size: 10,
        font: regular,
        color: MUTED,
      });
      y -= rowH;
    }
  }
  y -= 10;
  rule();

  // --- Ganadores --------------------------------------------------------
  subheading("Contenido marcado como ganador");
  if (data.winners.length === 0) {
    paragraph("Nada marcado todavía. Se marca a mano desde la biblioteca de contenido.");
  } else {
    for (const title of data.winners) {
      const lines = wrap(title, regular, 10, maxWidth - 14);
      for (const [i, line] of lines.entries()) {
        ensureSpace(15);
        // El bullet va solo en la primera línea; las siguientes quedan
        // indentadas bajo ella, como una sangría francesa.
        if (i === 0) page.drawText("•", { x: MARGIN, y, size: 10, font: regular, color: ACCENT });
        page.drawText(line, { x: MARGIN + 14, y, size: 10, font: regular, color: INK });
        y -= 15;
      }
    }
  }

  // --- Pie en todas las páginas -------------------------------------------
  const footer = `Generado el ${data.generatedAt.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })} · SocialPanel`;
  for (const p of doc.getPages()) {
    p.drawText(footer, { x: MARGIN, y: 24, size: 8, font: regular, color: MUTED });
  }

  return doc.save();
}
