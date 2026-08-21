import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import { AppError } from "@/lib/logger";
import type {
  CaptionRequest,
  CaptionResult,
  Credential,
  LLMProvider,
  PlanRequest,
  PlanResult,
  StudioRequest,
  StudioResult,
} from "../types";
import {
  CAPTION_SYSTEM,
  PLAN_SYSTEM,
  STUDIO_SYSTEM,
  captionPrompt,
  parseCaption,
  parsePlan,
  parseStudio,
  planPrompt,
  studioPrompt,
} from "./prompts";

// Precio por millón de tokens, en céntimos de euro (aprox.). Para medir consumo.
const IN_CENTS_PER_MTOK = 300;
const OUT_CENTS_PER_MTOK = 1500;

export class AnthropicLLM implements LLMProvider {
  readonly name = "anthropic";

  private async call(system: string, prompt: string, maxTokens: number, cred: Credential) {
    const model = serverEnv().ANTHROPIC_MODEL;
    const client = new Anthropic({ apiKey: cred.apiKey });

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    });

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new AppError("No se pudo generar el texto. Inténtalo de nuevo.", 502);
    }

    return {
      text: block.text,
      cost: {
        provider: this.name,
        model,
        units: response.usage.input_tokens + response.usage.output_tokens,
        cents:
          (response.usage.input_tokens / 1_000_000) * IN_CENTS_PER_MTOK +
          (response.usage.output_tokens / 1_000_000) * OUT_CENTS_PER_MTOK,
        byok: cred.byok,
      },
    };
  }

  async generateCaption(req: CaptionRequest, cred: Credential): Promise<CaptionResult> {
    const { text, cost } = await this.call(CAPTION_SYSTEM, captionPrompt(req), 2000, cred);
    return { ...parseCaption(text), cost };
  }

  async generatePlan(req: PlanRequest, cred: Credential): Promise<PlanResult> {
    const { text, cost } = await this.call(PLAN_SYSTEM, planPrompt(req), 8000, cred);
    return { ideas: parsePlan(text, req.news ?? []), cost };
  }

  async generateStudio(req: StudioRequest, cred: Credential): Promise<StudioResult> {
    // Más margen que un caption suelto: aquí es una pieza completa por cada
    // red pedida, hasta nueve a la vez.
    const { text, cost } = await this.call(STUDIO_SYSTEM, studioPrompt(req), 4000, cred);
    return { ...parseStudio(text, req.platforms), cost };
  }
}
