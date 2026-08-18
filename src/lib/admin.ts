import { serverEnv } from "./env";
import { AppError } from "./logger";
import { currentUser } from "./tenant";

/**
 * Administrador de la PLATAFORMA, que no es lo mismo que el rol dentro de un
 * tenant.
 *
 * `memberships.role` distingue quién manda dentro de una cuenta de cliente, y
 * todo cliente es "owner" de la suya. Usar ese rol para decidir quién puede
 * invitar convertiría a cada cliente en portero de la plataforma entera. Son
 * dos preguntas distintas y merecen dos mecanismos distintos.
 */

function adminEmails(): string[] {
  return (serverEnv().PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function isPlatformAdmin(): Promise<boolean> {
  const user = await currentUser();
  const email = user?.email?.trim().toLowerCase();
  if (!email) return false;

  const admins = adminEmails();
  // Sin lista configurada no hay administradores. Devolver `true` aquí sería
  // abrir la puerta entera por no haber puesto una variable de entorno.
  if (admins.length === 0) return false;

  return admins.includes(email);
}

export async function requirePlatformAdmin(): Promise<void> {
  if (!(await isPlatformAdmin())) throw new AppError("No autorizado", 403);
}
