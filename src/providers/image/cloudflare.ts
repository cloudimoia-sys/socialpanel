import { serverEnv } from "@/lib/env";
import { AppError, log } from "@/lib/logger";
import type { Credential, ImageProvider, ImageRequest, ImageResult } from "../types";

/**
 * Imágenes con Cloudflare Workers AI (FLUX).
 *
 * Es el camino gratuito: 10.000 neuronas al día por cuenta, sin tarjeta, y con
 * uso comercial permitido. Sirve para desarrollar y para demos sin gastar,
 * mientras que Gemini exige facturación activada para generar imágenes.
 *
 * Limitación real: FLUX schnell no acepta imágenes de referencia, así que el
 * caso "sube una foto y la IA la edita" NO funciona aquí. Para eso hace falta
 * Gemini (o FLUX.2, que sí soporta referencias). El adaptador lo dice en claro
 * en vez de devolver algo que ignore la referencia en silencio.
 */

const API = "https://api.cloudflare.com/client/v4/accounts";

/**
 * Verificado contra la API real: flux-1-schnell SOLO acepta `prompt` y `steps`.
 * Mandarle `width`, `height` o `seed` da 400. La salida es siempre 1024x1024
 * JPEG, así que este proveedor no puede hacer vertical ni horizontal.
 */
/**
 * Guard negativo del prompt. Cubre dos problemas distintos:
 *
 * 1. Ningún modelo de difusión rápido sabe escribir. Produce formas con aspecto
 *    de letras que no significan nada, y en español peor. El texto va en el
 *    caption o superpuesto con tipografía real, nunca dibujado por el modelo.
 *
 * 2. Se inventan marcas comerciales. flux-schnell dibujó un logo de Apple en
 *    una prueba. Publicar una marca falsificada en el post de un cliente es un
 *    riesgo legal, no un defecto estético.
 */
const NEGATIVE_GUARD =
  ", photograph, real scene, no text, no letters, no words, no signage, " +
  "no watermarks, no brand logos, no trademarks, " +
  "not a poster, not an infographic, not a diagram, not a collage, " +
  "not a screenshot, not graphic design";

/** Solo los modelos FLUX aceptan `steps`; a los demás les da un 400. */
const STEPS_BY_MODEL: Record<string, number> = {
  "@cf/black-forest-labs/flux-1-schnell": 8,
};

// Aproximado: ~10.000 neuronas/día cubren unos cientos de imágenes, y por
// encima son 0,011 $ / 1.000 neuronas. Sirve para medir consumo, no para
// facturar al céntimo.
const CENTS_PER_IMAGE = 0.5;

export class CloudflareImage implements ImageProvider {
  readonly name = "cloudflare";

  async generateImage(req: ImageRequest, cred: Credential): Promise<ImageResult> {
    const env = serverEnv();
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;

    if (!accountId) {
      throw new AppError("Falta configurar CLOUDFLARE_ACCOUNT_ID.", 500);
    }

    if (req.references?.length) {
      throw new AppError(
        "El generador gratuito no admite imágenes de referencia. " +
          "Para editar una foto tuya, cambia el perfil de proveedores a Gemini.",
        400,
      );
    }

    // Preferimos decirlo a devolver un cuadrado cuando han pedido vertical.
    if (req.aspectRatio && req.aspectRatio !== "1:1") {
      throw new AppError(
        "El generador gratuito solo produce imágenes cuadradas (1:1). " +
          "Para vertical u horizontal, cambia el perfil de proveedores a Gemini.",
        400,
      );
    }

    const model = env.CLOUDFLARE_IMAGE_MODEL;
    const steps = STEPS_BY_MODEL[model];

    const response = await fetch(`${API}/${accountId}/ai/run/${model}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cred.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: req.prompt + NEGATIVE_GUARD,
        ...(steps ? { steps } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      log.error("cloudflare image failed", { status: response.status, model, body });

      if (response.status === 429) {
        throw new AppError(
          "Se ha agotado la cuota gratuita diaria de imágenes. Se renueva a las 00:00 UTC.",
          429,
        );
      }

      // El clasificador de contenido de Cloudflare es propenso a falsos
      // positivos con descripciones cortas y abstractas. Merece un mensaje
      // propio porque la solución del usuario es concreta: describir más.
      if (/NSFW/i.test(body)) {
        throw new AppError(
          "El filtro de contenido ha rechazado la descripción. Suele pasar con " +
            "descripciones muy cortas o abstractas: prueba a ser más concreto.",
          400,
        );
      }

      throw new AppError("El generador de imágenes no está disponible ahora mismo.", 502);
    }

    // Workers AI responde de dos formas según el modelo: JSON con la imagen en
    // base64, o los bytes de la imagen directamente. Aceptamos ambas.
    const contentType = response.headers.get("content-type") ?? "";
    let data: Buffer;
    let mimeType = "image/png";

    if (contentType.includes("application/json")) {
      const json = (await response.json()) as {
        success?: boolean;
        result?: { image?: string };
        errors?: { message?: string }[];
      };

      if (!json.success || !json.result?.image) {
        log.error("cloudflare image empty", { errors: json.errors });
        throw new AppError("No se pudo generar la imagen con esa descripción.", 502);
      }
      data = Buffer.from(json.result.image, "base64");
      mimeType = "image/jpeg";
    } else {
      data = Buffer.from(await response.arrayBuffer());
      mimeType = contentType.startsWith("image/") ? contentType : "image/png";
    }

    if (data.byteLength === 0) {
      throw new AppError("El generador devolvió una imagen vacía.", 502);
    }

    return {
      mimeType,
      data,
      cost: {
        provider: this.name,
        model,
        units: 1,
        cents: CENTS_PER_IMAGE,
        byok: cred.byok,
      },
    };
  }
}
