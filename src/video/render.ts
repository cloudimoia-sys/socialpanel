import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError, log } from "@/lib/logger";
import type { StatsProps } from "./compositions/Stats";

/**
 * Renderizado de vídeo server-side con Remotion.
 *
 * A diferencia de los demás VideoProvider (fal.ai), esto no es una API
 * externa: es cómputo local. No hay job que consultar ni coste de proveedor —
 * por eso no implementa la interfaz `VideoProvider` con su ciclo start/poll,
 * que está pensado para llamadas asíncronas a terceros. Aquí se renderiza y se
 * devuelve, sin más.
 *
 * El bundle (la composición compilada) se cachea en memoria: recompilar en
 * cada vídeo añadiría varios segundos sin ganar nada, ya que el código de las
 * plantillas no cambia entre peticiones dentro del mismo proceso.
 */

let bundlePromise: Promise<string> | null = null;

function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: path.join(process.cwd(), "src/video/entry.ts"),
      // Mismo directorio que sirve Next.js: la fuente Poppins vive en
      // public/fonts y así no hace falta duplicarla.
      publicDir: path.join(process.cwd(), "public"),
      onProgress: () => {},
    }).catch((cause) => {
      // Si el bundle falla, no dejamos la promesa rota en caché: el siguiente
      // intento debe poder reintentar el bundling, no repetir el mismo fallo.
      bundlePromise = null;
      throw cause;
    });
  }
  return bundlePromise;
}

export interface RenderResult {
  data: Buffer;
  durationSeconds: number;
}

/** Renderiza la plantilla "Stats" (dos cifras) a un buffer MP4. */
export async function renderStats(props: StatsProps): Promise<RenderResult> {
  const serveUrl = await getBundle();

  let composition;
  try {
    composition = await selectComposition({ serveUrl, id: "Stats", inputProps: props });
  } catch (cause) {
    throw new AppError("No se pudo preparar la plantilla de vídeo.", 500, cause);
  }

  const outputPath = path.join(os.tmpdir(), `socialpanel-${randomUUID()}.mp4`);

  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outputPath,
      inputProps: props,
    });

    const data = await fs.readFile(outputPath);
    return { data, durationSeconds: composition.durationInFrames / composition.fps };
  } catch (cause) {
    log.error("fallo renderizando infograma", { error: String(cause) });
    throw new AppError("No se pudo generar el vídeo.", 500, cause);
  } finally {
    // Limpieza best-effort: un fallo aquí no debe tapar el error real de arriba.
    await fs.unlink(outputPath).catch(() => {});
  }
}
