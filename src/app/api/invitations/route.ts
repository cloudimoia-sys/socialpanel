import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin";
import { AppError } from "@/lib/logger";
import { run } from "@/lib/route";
import { adminClient } from "@/lib/supabase";

/**
 * Gestión de invitaciones. Solo para administradores de la plataforma.
 *
 * Cada handler vuelve a comprobar el permiso por su cuenta: esconder el enlace
 * en el menú es comodidad visual, no seguridad — la URL de la API es pública y
 * adivinable.
 *
 * Se usa el cliente de servicio porque `allowed_signups` tiene RLS activo sin
 * ninguna política: es deliberado, así la tabla que decide quién entra no es
 * alcanzable desde el navegador ni con una sesión válida.
 */

const createSchema = z.object({
  email: z.string().email().max(200),
  note: z.string().max(120).optional(),
});

export async function GET() {
  return run(async () => {
    await requirePlatformAdmin();

    const { data, error } = await adminClient()
      .from("allowed_signups")
      .select("email, note, created_at, claimed_at")
      .order("created_at", { ascending: false });

    if (error) throw new AppError("No se pudieron cargar las invitaciones.", 500, error.message);

    return { invitations: data ?? [] };
  });
}

export async function POST(request: Request) {
  return run(async () => {
    await requirePlatformAdmin();

    const body = createSchema.parse(await request.json());
    // La columna exige minúsculas por CHECK: normalizar aquí evita que la
    // invitación falle por un correo escrito con mayúsculas.
    const email = body.email.trim().toLowerCase();

    const { error } = await adminClient()
      .from("allowed_signups")
      .insert({ email, note: body.note?.trim() || null });

    if (error) {
      // 23505 = clave duplicada. No es un fallo del sistema, es que ya estaba
      // invitado, y merece decirlo en vez de un error genérico.
      if (error.code === "23505") {
        throw new AppError("Ese correo ya estaba invitado.", 409);
      }
      throw new AppError("No se pudo crear la invitación.", 500, error.message);
    }

    return { email };
  });
}

export async function DELETE(request: Request) {
  return run(async () => {
    await requirePlatformAdmin();

    const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase();
    if (!email) throw new AppError("Falta el correo a retirar.", 400);

    const { error } = await adminClient().from("allowed_signups").delete().eq("email", email);

    if (error) throw new AppError("No se pudo retirar la invitación.", 500, error.message);

    return { email };
  });
}
