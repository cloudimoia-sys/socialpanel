import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { AppError } from "./logger";
import { serverEnv } from "./env";

/**
 * Rate limiting por tenant.
 *
 * Los endpoints de generación llaman a APIs que cuestan dinero real: sin límite,
 * un bucle accidental (o un cliente malicioso) puede fundir el presupuesto en
 * minutos. El límite es en backend; ocultar el botón en la UI no cuenta.
 *
 * En dev, sin Upstash configurado, cae a un limitador en memoria que sirve
 * para desarrollar pero NO para producción con varias instancias.
 */

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt < now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1 };
  }
  entry.count += 1;
  return { success: entry.count <= limit, remaining: Math.max(0, limit - entry.count) };
}

let redis: Redis | null = null;
const limiters = new Map<string, Ratelimit>();

function limiterFor(name: string, limit: number, window: `${number} ${"s" | "m" | "h"}`) {
  const env = serverEnv();
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  if (!redis) {
    redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  let l = limiters.get(name);
  if (!l) {
    l = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix: `rl:${name}`,
    });
    limiters.set(name, l);
  }
  return l;
}

export const LIMITS = {
  generate: { limit: 20, window: "1 h", ms: 3_600_000 },
  publish: { limit: 30, window: "1 h", ms: 3_600_000 },
  upload: { limit: 60, window: "1 h", ms: 3_600_000 },
  credentials: { limit: 5, window: "1 h", ms: 3_600_000 },
} as const;

export async function enforceRateLimit(
  action: keyof typeof LIMITS,
  identifier: string,
): Promise<void> {
  const cfg = LIMITS[action];
  const limiter = limiterFor(action, cfg.limit, cfg.window as `${number} h`);

  const result = limiter
    ? await limiter.limit(identifier)
    : memoryLimit(`${action}:${identifier}`, cfg.limit, cfg.ms);

  if (!result.success) {
    throw new AppError("Has superado el límite de peticiones. Prueba en un rato.", 429);
  }
}
