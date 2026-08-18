import { AppError } from "./logger";
import { userClient } from "./supabase";

export type Role = "owner" | "admin" | "member";

export interface TenantContext {
  userId: string;
  tenantId: string;
  role: Role;
}

/**
 * Resuelve usuario + tenant + rol para una petición.
 *
 * El `tenantId` viene del cliente, así que NO se confía en él: se comprueba
 * contra la tabla de memberships antes de devolverlo. Sin esta comprobación
 * cualquiera podría operar sobre otro tenant cambiando un campo del payload.
 */
export async function requireTenant(tenantId: string): Promise<TenantContext> {
  const supabase = await userClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AppError("No autenticado", 401);

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();

  // Mismo error para "no existe" y "no eres miembro": no filtramos qué tenants existen.
  if (!membership) throw new AppError("No autorizado", 403);

  return { userId: user.id, tenantId, role: membership.role as Role };
}

export function requireRole(ctx: TenantContext, roles: Role[]): void {
  if (!roles.includes(ctx.role)) throw new AppError("No autorizado", 403);
}
