import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, log } from "./logger";

/**
 * Envoltorio para route handlers.
 *
 * Garantiza que ningún stack trace, ruta interna ni mensaje de la base de datos
 * llegue al cliente: al usuario le va un mensaje seguro, el detalle técnico
 * queda en el log.
 */
export function handler<T>(fn: () => Promise<T>) {
  return async (): Promise<NextResponse> => {
    try {
      return NextResponse.json(await fn());
    } catch (error) {
      if (error instanceof AppError) {
        log.warn(error.publicMessage, { status: error.status, internal: error.internal });
        return NextResponse.json({ error: error.publicMessage }, { status: error.status });
      }
      if (error instanceof ZodError) {
        // "Datos inválidos" a secas obliga al usuario a adivinar qué campo
        // falla. Decimos cuál y por qué; no hay nada sensible en el nombre de
        // un campo ni en el motivo del rechazo.
        const details = error.issues
          .map((issue) => {
            const field = issue.path.join(".");
            return field ? `${field}: ${issue.message}` : issue.message;
          })
          .join(" · ");

        return NextResponse.json(
          { error: `Revisa estos campos — ${details}`, issues: error.issues },
          { status: 422 },
        );
      }
      log.error("error no controlado", { error: String(error) });
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  };
}

export async function run<T>(fn: () => Promise<T>): Promise<NextResponse> {
  return handler(fn)();
}
