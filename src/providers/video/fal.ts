import { AppError, log } from "@/lib/logger";
import type { Credential, VideoJob, VideoProvider, VideoRequest, VideoStatus } from "../types";

/**
 * Vídeo vía fal.ai.
 *
 * Se usa fal como agregador y no un proveedor directo (Higgsfield, Veo, Kling)
 * a propósito: el mercado de vídeo cambia de líder cada pocos meses y los
 * precios se mueven mucho. Cambiar de modelo aquí es cambiar `MODEL_ENDPOINT`;
 * cambiar de proveedor entero es escribir otra clase que implemente
 * VideoProvider. El resto de la aplicación no se toca.
 *
 * Es también el componente más caro del sistema (~$0.10/segundo según modelo),
 * así que es el único que exige comprobar presupuesto antes de arrancar.
 */

const MODEL_ENDPOINT = "fal-ai/kling-video/v2/standard/image-to-video";
const CENTS_PER_SECOND = 10;

const API = "https://queue.fal.run";

export class FalVideo implements VideoProvider {
  readonly name = "fal";

  async startVideo(req: VideoRequest, cred: Credential): Promise<VideoJob> {
    const response = await fetch(`${API}/${MODEL_ENDPOINT}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${cred.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: req.prompt,
        image_url: req.imageUrl,
        duration: String(req.durationSeconds),
        aspect_ratio: req.aspectRatio,
      }),
    });

    if (!response.ok) {
      // El cuerpo puede traer detalles internos del proveedor: a logs, no al usuario.
      log.error("fal.startVideo failed", { status: response.status, body: await response.text() });
      throw new AppError("El generador de vídeo no está disponible ahora mismo.", 502);
    }

    const body = (await response.json()) as { request_id?: string };
    if (!body.request_id) throw new AppError("Respuesta inesperada del generador de vídeo.", 502);

    return { externalId: body.request_id, provider: this.name };
  }

  async checkVideo(job: VideoJob, cred: Credential): Promise<VideoStatus> {
    const response = await fetch(`${API}/${MODEL_ENDPOINT}/requests/${job.externalId}/status`, {
      headers: { Authorization: `Key ${cred.apiKey}` },
    });

    if (!response.ok) return { state: "pending" };

    const status = (await response.json()) as { status?: string };
    if (status.status === "IN_QUEUE" || status.status === "IN_PROGRESS") {
      return { state: "pending" };
    }
    if (status.status !== "COMPLETED") {
      return { state: "failed", error: "La generación de vídeo falló." };
    }

    const result = await fetch(`${API}/${MODEL_ENDPOINT}/requests/${job.externalId}`, {
      headers: { Authorization: `Key ${cred.apiKey}` },
    });
    const payload = (await result.json()) as {
      video?: { url?: string };
      duration?: number;
    };

    if (!payload.video?.url) return { state: "failed", error: "El vídeo llegó vacío." };

    const seconds = payload.duration ?? 5;
    return {
      state: "done",
      url: payload.video.url,
      cost: {
        provider: this.name,
        model: MODEL_ENDPOINT,
        units: seconds,
        cents: seconds * CENTS_PER_SECOND,
        byok: cred.byok,
      },
    };
  }
}

export function estimateVideoCents(durationSeconds: number): number {
  return durationSeconds * CENTS_PER_SECOND;
}
