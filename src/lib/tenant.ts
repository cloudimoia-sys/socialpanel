import { AppError, log } from "./logger";
import { adminClient, userClient } from "./supabase";

/**
 * Resolución del tenant activo del usuario.
 *
 * El alta se hace con el cliente de servicio a propósito: `tenants` no tiene
 * política de INSERT, así que nadie puede crearse tenants desde el cliente ni
 * inventarse un plan o un presupuesto. La única vía es esta función.
 */

export interface ActiveTenant {
  userId: string;
  email: string;
  tenantId: string;
  tenantName: string;
  role: "owner" | "admin" | "member";
  budgetCents: number;
}

/**
 * Igual que `currentTenant()` pero lanza si no hay sesión.
 *
 * Es lo que usan los endpoints: el tenant sale SIEMPRE de la sesión y nunca de
 * un campo del payload. Así no existe la posibilidad de que alguien opere sobre
 * otro tenant cambiando un ID, porque no hay ID que cambiar.
 */
export async function requireCurrentTenant(): Promise<ActiveTenant> {
  const tenant = await currentTenant();
  if (!tenant) throw new AppError("No autenticado", 401);
  return tenant;
}

export function requireTenantRole(
  tenant: ActiveTenant,
  roles: ActiveTenant["role"][],
): void {
  if (!roles.includes(tenant.role)) throw new AppError("No autorizado", 403);
}

export async function currentUser() {
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Devuelve el tenant del usuario, creándolo en su primer acceso.
 *
 * Si el usuario ya pertenece a varios, se queda con el más antiguo. La
 * selección explícita de tenant se añadirá cuando haga falta.
 */
export async function currentTenant(): Promise<ActiveTenant | null> {
  const user = await currentUser();
  if (!user) return null;

  const db = adminClient();

  // Buscar-o-crear en una sola llamada atómica. Hacerlo en dos sentencias desde
  // aquí abría una ventana en la que varias peticiones concurrentes del mismo
  // usuario creaban cada una su tenant: llegaron a salir 110 para una cuenta.
  const { data: tenantId, error } = await db.rpc("ensure_tenant", {
    p_user: user.id,
    p_name: user.email?.split("@")[0] ?? "Mi cuenta",
    p_email: user.email ?? "",
  });

  if (error) {
    throw new AppError("No se pudo cargar tu cuenta.", 500, error.message);
  }

  // Autenticado pero sin invitación: la función devuelve null en vez de crear
  // nada. Se distingue del fallo técnico a propósito, porque lo que procede es
  // explicarlo, no enseñar un error.
  if (!tenantId) {
    log.info("acceso sin invitacion", { email: user.email });
    throw new AppError("NOT_INVITED", 403);
  }

  const [{ data: tenant }, { data: membership }] = await Promise.all([
    db.from("tenants").select("id, name, budget_cents").eq("id", tenantId).maybeSingle(),
    db
      .from("memberships")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (!tenant) return null;

  return {
    userId: user.id,
    email: user.email ?? "",
    tenantId: tenant.id,
    tenantName: tenant.name,
    role: (membership?.role ?? "owner") as ActiveTenant["role"],
    budgetCents: tenant.budget_cents,
  };
}
