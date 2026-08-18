import { GoogleGenAI } from "@google/genai";
import { serverEnv } from "@/lib/env";
import { AppError, log } from "@/lib/logger";
import type {
  CaptionRequest,
  CaptionResult,
  Credential,
  LLMProvider,
  PlanRequest,
  PlanResult,
} from "../types";
import {
  CAPTION_SYSTEM,
  PLAN_SYSTEM,
  captionPrompt,
  parseCaption,
  parsePlan,
  planPrompt,
} from "./prompts";

/**
 * Proveedor de texto del escalón gratuito.
 *
 * Aviso: el tier gratuito de Google puede usar el contenido para entrenar.
 * Sirve para desarrollo y demos con material propio; en cuanto entre contenido
 * real de un cliente hay que pasar a clave de pago o a Claude.
 */

const IN_CENTS_PER_MTOK = 28;
const OUT_CENTS_PER_MTOK = 230;

const CAPTION_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    perPlatform: { type: "object", additionalProperties: { type: "string" } },
  },
  required: ["caption", "hashtags", "perPlatform"],
};

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idea: { type: "string" },
          headline: { type: "string" },
          rationale: { type: "string" },
          visual: { type: "string" },
          suggestedPlatforms: { type: "array", items: { type: "string" } },
          suggestedMedia: { type: "string", enum: ["none", "image", "video"] },
          scheduledFor: { type: "string" },
          sourceIndex: { type: "integer" },
        },
        required: [
          "idea",
          "headline",
          "rationale",
          "visual",
          "suggestedPlatforms",
          "suggestedMedia",
          "scheduledFor",
          "sourceIndex",
        ],
      },
    },
  },
  required: ["ideas"],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 503 (saturado) y 429 (cuota) pasan solos; el resto no. */
function isTransient(error: unknown): boolean {
  const message = String(error);
  return /\b(503|429)\b|UNAVAILABLE|high demand|overloaded/i.test(message);
}

export class GeminiLLM implements LLMProvider {
  readonly name = "gemini";

  private async attempt(
    model: string,
    system: string,
    prompt: string,
    schema: object,
    maxTokens: number,
    cred: Credential,
  ) {
    const client = new GoogleGenAI({ apiKey: cred.apiKey });

    const response = await client.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: system,
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    if (!response.text) {
      throw new AppError("No se pudo generar el texto. Inténtalo de nuevo.", 502);
    }

    const usage = response.usageMetadata;
    return {
      text: response.text,
      cost: {
        provider: this.name,
        model,
        units: usage?.totalTokenCount ?? 0,
        cents:
          ((usage?.promptTokenCount ?? 0) / 1_000_000) * IN_CENTS_PER_MTOK +
          ((usage?.candidatesTokenCount ?? 0) / 1_000_000) * OUT_CENTS_PER_MTOK,
        byok: cred.byok,
      },
    };
  }

  /**
   * Reintenta con espera creciente ante saturación y, si el modelo principal
   * sigue caído, prueba el de respaldo.
   *
   * Los modelos de Google devuelven 503 por picos de demanda con bastante
   * frecuencia. Sin esto, un pico convierte una generación de plan en un error
   * para el usuario, cuando bastaba con esperar dos segundos.
   */
  private async call(
    system: string,
    prompt: string,
    schema: object,
    maxTokens: number,
    cred: Credential,
  ) {
    const env = serverEnv();
    const models = [env.GEMINI_TEXT_MODEL, env.GEMINI_TEXT_MODEL_FALLBACK].filter(
      (m, i, all) => m && all.indexOf(m) === i,
    );

    let last: unknown;

    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await this.attempt(model, system, prompt, schema, maxTokens, cred);
        } catch (error) {
          last = error;
          if (!isTransient(error)) {
            if (error instanceof AppError) throw error;
            throw new AppError("No se pudo generar el texto.", 502, error);
          }
          if (attempt < 2) await sleep(1000 * (attempt + 1) ** 2);
        }
      }
      log.warn("modelo saturado, probando el de respaldo", { model });
    }

    throw new AppError(
      "El modelo está saturado ahora mismo. Vuelve a intentarlo en un minuto.",
      503,
      last,
    );
  }

  async generateCaption(req: CaptionRequest, cred: Credential): Promise<CaptionResult> {
    const { text, cost } = await this.call(
      CAPTION_SYSTEM,
      captionPrompt(req),
      CAPTION_SCHEMA,
      2000,
      cred,
    );
    return { ...parseCaption(text), cost };
  }

  async generatePlan(req: PlanRequest, cred: Credential): Promise<PlanResult> {
    const { text, cost } = await this.call(
      PLAN_SYSTEM,
      planPrompt(req),
      PLAN_SCHEMA,
      // Un plan de 12 ideas con justificación necesita bastante más margen.
      8000,
      cred,
    );
    return { ideas: parsePlan(text, req.news ?? []), cost };
  }
}
