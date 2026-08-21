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

    // Invitaciones pendientes: van por userClient() igual que el resto, así
    // que RLS (owner/admin del tenant) es quien decide si se ven.
    const { data: invitations } = await supabase
      .from("team_invitations")
      .select("id, email, role, created_at")
      .eq("tenant_id", tenant.tenantId)
      .is("accepted_at", null)
      .order("created_at", { ascending: true });

    return { members: withEmail, invitations: invitations ?? [], myRole: tenant.role };
  });
}

const inviteSchema = z.object({
  email: z.string().email().max(200),
  // Nunca 'owner': una invitación no puede fabricar un segundo propietario,
  // mismo límite que impone el CHECK de la tabla y memberships_write.
  role: z.enum(["admin", "member"]).default("member"),
});

/**
 * Invita a alguien al equipo de este tenant.
 *
 * No manda ningún correo — la aplicación no tiene proveedor de email, igual
 * que las invitaciones de plataforma. Quien invita avisa por su cuenta; la
 * invitación se canjea sola cuando esa persona entra con ese mismo correo
 * (`ensure_tenant`, 0020_team_invitations.sql).
 */
export async function POST(request: Request) {
  return run(async () => {
    const body = inviteSchema.parse(await request.json());
    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    const email = body.email.toLowerCase().trim();
    const supabase = await userClient();

    const { error } = await supabase.from("team_invitations").insert({
      tenant_id: tenant.tenantId,
      email,
      role: body.role,
      invited_by: tenant.userId,
    });

    if (error) {
      // El índice parcial solo bloquea invitaciones PENDIENTES duplicadas:
      // reinvitar a quien ya la aceptó (y luego se quitó del equipo) sí vale.
      if (error.code === "23505") {
        throw new AppError("Ya hay una invitación pendiente para ese correo.", 409);
      }
      throw new AppError("No se pudo crear la invitación.", 500, error.message);
    }

    return { email, role: body.role };
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
    const params = new URL(request.url).searchParams;
    const tenant = await requireCurrentTenant();
    requireTenantRole(tenant, ["owner", "admin"]);

    // Cancelar una invitación pendiente es otra cosa que quitar a un miembro:
    // la persona todavía no existe en `memberships`, así que no hay rol que
    // comprobar ni riesgo de dejar el tenant sin propietario.
    const invitationId = params.get("invitationId");
    if (invitationId) {
      const id = z.string().uuid().parse(invitationId);
      const { error, count } = await (await userClient())
        .from("team_invitations")
        .delete({ count: "exact" })
        .eq("id", id)
        .eq("tenant_id", tenant.tenantId);

      if (error) throw new AppError("No se pudo cancelar la invitación.", 500, error.message);
      if (!count) throw new AppError("Esa invitación ya no existe.", 404);
      return { invitationId: id };
    }

    const userId = z.string().uuid().parse(params.get("userId"));

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
