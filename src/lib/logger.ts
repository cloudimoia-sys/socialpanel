/**
 * Logging con redacción obligatoria.
 *
 * Nunca debe salir por aquí una API key, un token ni una contraseña: los logs
 * acaban en un proveedor externo y se conservan meses.
 */

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // Anthropic / OpenAI
  /AIza[0-9A-Za-z_-]{20,}/g, // Google
  /key-[A-Za-z0-9_-]{16,}/g, // fal
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /\bv1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+/g, // nuestro ciphertext
];

const SECRET_KEYS = /^(.*(api_?key|token|secret|password|authorization|ciphertext).*)$/i;

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, "[REDACTED]"), value);
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[REDACTED]" : redact(v)]),
    );
  }
  return value;
}

type Level = "info" | "warn" | "error";

function emit(level: Level, message: string, context: Record<string, unknown> = {}) {
  const line = JSON.stringify({
    level,
    message,
    ts: new Date().toISOString(),
    ...(redact(context) as Record<string, unknown>),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (m: string, c?: Record<string, unknown>) => emit("info", m, c),
  warn: (m: string, c?: Record<string, unknown>) => emit("warn", m, c),
  error: (m: string, c?: Record<string, unknown>) => emit("error", m, c),
};

/**
 * Error con mensaje seguro para el usuario. El detalle técnico va a `internal`
 * y solo se registra en logs, nunca se devuelve en la respuesta HTTP.
 */
export class AppError extends Error {
  constructor(
    public readonly publicMessage: string,
    public readonly status = 400,
    public readonly internal?: unknown,
  ) {
    super(publicMessage);
    this.name = "AppError";
  }
}
