import { GoogleGenAI } from "@google/genai";
import { serverEnv } from "@/lib/env";
import { AppError } from "@/lib/logger";
import type { Credential, ImageProvider, ImageRequest, ImageResult } from "../types";

/**
 * Nano Banana (Gemini 2.5 Flash Image).
 *
 * Acepta imágenes de referencia, que es lo que permite el caso "subo una foto
 * y la IA la edita" sin cambiar de modelo.
 */

const CENTS_PER_IMAGE = 3.9;

export class GeminiImage implements ImageProvider {
  readonly name = "gemini";

  async generateImage(req: ImageRequest, cred: Credential): Promise<ImageResult> {
    const MODEL = serverEnv().GEMINI_IMAGE_MODEL;
    const client = new GoogleGenAI({ apiKey: cred.apiKey });

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    for (const ref of req.references ?? []) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
    }
    parts.push({ text: req.prompt });

    let response;
    try {
      response = await client.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts }],
        config: req.aspectRatio ? { imageConfig: { aspectRatio: req.aspectRatio } } : undefined,
      });
    } catch (cause) {
      // La generación de imágenes de Gemini no tiene tier gratuito: sin
      // facturación activada devuelve 429 y parece un límite de uso cuando en
      // realidad es que la cuenta no puede generar imágenes en absoluto.
      const message = String(cause);
      if (message.includes("429") || /quota/i.test(message)) {
        throw new AppError(
          "La generación de imágenes requiere facturación activada en tu cuenta de Google. " +
            "No tiene plan gratuito.",
          402,
          cause,
        );
      }
      throw new AppError("El generador de imágenes no está disponible ahora mismo.", 502, cause);
    }

    const image = response.candidates
      ?.at(0)
      ?.content?.parts?.find((p) => "inlineData" in p && p.inlineData?.data);

    if (!image || !("inlineData" in image) || !image.inlineData?.data) {
      // El modelo devuelve texto en vez de imagen cuando rechaza el prompt.
      throw new AppError("No se pudo generar la imagen con esa descripción.", 502);
    }

    return {
      mimeType: image.inlineData.mimeType ?? "image/png",
      data: Buffer.from(image.inlineData.data, "base64"),
      cost: {
        provider: this.name,
        model: MODEL,
        units: 1,
        cents: CENTS_PER_IMAGE,
        byok: cred.byok,
      },
    };
  }
}
