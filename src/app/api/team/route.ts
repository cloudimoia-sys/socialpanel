import { z } from "zod";
import { AppError } from "@/lib/logger";
import { run } from "@/lib/route";
import { adminClient, userClient } from "@/lib/supabase";
import { requireCurrentTenant, requireTenantRole } from "@/lib/tenant";

/**
 * Gestión del equipo del tenant actual.
 *
 * Todas las escrituras van por `userClient()` (con la sesión del usuario, no
 * con la clave de servicio) a propósito: así RLS —endurecido en
 * 0014_team_management.sql para que solo un owner pueda tocar el rol
 * `owner`— es quien de verdad impide la escalada, no una comprobación de la
 * aplicación que podría tener un fallo. `requireTenantRole` es la primera
 * capa; RLS es la que de verdad importa.
 */

const ROLES = ["owner", "admin", "member"] as const;

export async function GET() {
  return run(async () => {
    const tenant = await requireCurrentTenant();
    const supabase = await userClient();

    const { data: members, error } = await supabase
      .from("memberships")
      .select("user_id, role, created_at")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: true });

    if (error) throw new AppError("No se pudo cargar el equipo.", 500, error.message);

    // El correo no vive en `memberships`: sale de Auth con la clave de
    // servicio. Solo se piden los IDs que ya vinieron de una consulta
    // filtrada por este tenant, así que no hay forma de asomarse a usuarios
    // de otro cliente por esta vía.
    const db = adminClient();
    const withEmail = await Promise.all(
      (members ?? []).map(async (m) => {
        const { data } = await db.auth.admin.getUserById(m.user_id);
        return {
          userId: m.user_id,
          role: m.role,
          email: data.user?.email ?? "(usuario eliminado)",
          isMe: m.user_id === tenant.userId,
        };
      }),
    );

    return { members: withEmail, myRole: tenant.role };
  });
}

const patchSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLES),
});

/** Cuántos owners tiene el tenant — para no dejarlo sin ninguno. */
async function ownerCount(tenantId: string): Promise<number> {
  const { count } = await adminClient()
    .from("memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("role", "owner");
  return count ?? 0;
}

export async function PATCH(request: Request) {
  return run(async () => {
    const body = patchSchema.parse(await request.json());
    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    // Solo un owner puede tocar el rol owner, en ida o en vuelta — igual que
    // exige la política de RLS. Comprobarlo aquí también da un mensaje claro
    // en vez de que la escritura desaparezca en silencio contra la base.
    const { data: target } = await (await userClient())
      .from("memberships")
      .select("role")
      .eq("tenant_id", tenant.tenantId)
      .eq("user_id", body.userId)
      .maybeSingle();

    if (!target) throw new AppError("Esa persona no está en tu equipo.", 404);

    const touchesOwner = target.role === "owner" || body.role === "owner";
    if (touchesOwner && tenant.role !== "owner") {
      throw new AppError("Solo un propietario puede ceder o quitar la propiedad.", 403);
    }

    // Sin esto, degradar al último owner deja el tenant sin nadie que pueda
    // gestionar el equipo — ni siquiera para deshacer el propio cambio.
    if (target.role === "owner" && body.role !== "owner" && (await ownerCount(tenant.tenantId)) <= 1) {
      throw new AppError("Es el único propietario. Nombra otro antes de cambiarle el rol.", 409);
    }

    const { error } = await (await userClient())
      .from("memberships")
      .update({ role: body.role })
      .eq("tenant_id", tenant.tenantId)
      .eq("user_id", body.userId);

    if (error) throw new AppError("No se pudo cambiar el rol.", 500, error.message);

    return { userId: body.userId, role: body.role };
  });
}

export async function DELETE(request: Request) {
  return run(async () => {
    const userId = z.string().uuid().parse(new URL(request.url).searchParams.get("userId"));
    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    if (userId === tenant.userId) {
      throw new AppError("No puedes quitarte a ti mismo. Pídeselo a otro propietario.", 400);
    }

    const { data: target } = await (await userClient())
      .from("memberships")
      .select("role")
      .eq("tenant_id", tenant.tenantId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!target) throw new AppError("Esa persona no está en tu equipo.", 404);

    if (target.role === "owner" && tenant.role !== "owner") {
      throw new AppError("Solo un propietario puede quitar a otro propietario.", 403);
    }
    if (target.role === "owner" && (await ownerCount(tenant.tenantId)) <= 1) {
      throw new AppError("Es el único propietario. Nombra otro antes de quitarlo.", 409);
    }

    const { error } = await (await userClient())
      .from("memberships")
      .delete()
      .eq("tenant_id", tenant.tenantId)
      .eq("user_id", userId);

    if (error) throw new AppError("No se pudo quitar a esa persona.", 500, error.message);

    return { userId };
  });
}
