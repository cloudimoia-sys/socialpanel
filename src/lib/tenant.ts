import { cookies } from "next/headers";
import { AppError, log } from "./logger";
import { adminClient, userClient } from "./supabase";

/**
 * Cookie de tenant activo, para quien pertenece a varios (agencias).
 *
 * Su valor NUNCA se usa sin comprobar antes que existe membership real para
 * (ese tenant, este usuario) — ver `currentTenant()`. Sin esa comprobación,
 * cambiar el valor de una cookie a mano sería la puerta de entrada a los
 * datos de un tenant ajeno: es justo la clase de bug que el resto de la app
 * evita no aceptando nunca un tenantId del cliente sin verificar.
 */
export const TENANT_COOKIE = "sp_tenant";

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
 * Por defecto es el más antiguo (`ensure_tenant`), pero quien pertenece a
 * varios (una agencia con varios clientes) puede haber elegido otro con el
 * selector — ver `TENANT_COOKIE`. Esa elección se vuelve a comprobar aquí en
 * cada carga contra `memberships`, nunca se da por buena solo porque la
 * cookie la nombre: es la única forma de que el selector no abra una vía para
 * leer datos de un tenant ajeno con solo cambiar una cookie a mano.
 */
export async function currentTenant(): Promise<ActiveTenant | null> {
  const user = await currentUser();
  if (!user) return null;

  const db = adminClient();

  // Buscar-o-crear en una sola llamada atómica. Hacerlo en dos sentencias desde
  // aquí abría una ventana en la que varias peticiones concurrentes del mismo
  // usuario creaban cada una su tenant: llegaron a salir 110 para una cuenta.
  const { data: defaultTenantId, error } = await db.rpc("ensure_tenant", {
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
  if (!defaultTenantId) {
    log.info("acceso sin invitacion", { email: user.email });
    throw new AppError("NOT_INVITED", 403);
  }

  let tenantId: string = defaultTenantId;

  const store = await cookies();
  const chosen = store.get(TENANT_COOKIE)?.value;

  if (chosen && chosen !== tenantId) {
    const { data: membership } = await db
      .from("memberships")
      .select("tenant_id")
      .eq("tenant_id", chosen)
      .eq("user_id", user.id)
      .maybeSingle();

    // Sin fila, esa cookie no corresponde a un tenant del que el usuario sea
    // miembro de verdad: se ignora y se sigue con el de por defecto, en vez
    // de fallar o de confiar en ella.
    if (membership) tenantId = chosen;
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

/**
 * Tenants a los que pertenece el usuario actual, para el selector.
 *
 * En dos consultas y no con un `select` embebido: `Database.Relationships`
 * está declarado vacío en `database.types.ts` (no hay generador de tipos
 * conectado a Supabase), así que el compilador no puede verificar un join
 * anidado — mejor dos consultas simples que forzar una sintaxis que el
 * propio tipo no puede comprobar.
 */
export async function listMyTenants(): Promise<{ id: string; name: string }[]> {
  const supabase = await userClient();

  // RLS (auth_tenant_ids()) ya limita esto a los propios: no hace falta
  // filtrar por user_id a mano, la política es el límite real.
  const { data: memberships } = await supabase
    .from("memberships")
    .select("tenant_id, created_at")
    .order("created_at", { ascending: true });

  if (!memberships || memberships.length === 0) return [];

  const ids = memberships.map((m) => m.tenant_id);
  const { data: tenants } = await supabase.from("tenants").select("id, name").in("id", ids);
  const byId = new Map((tenants ?? []).map((t) => [t.id, t.name]));

  // Se recorre `memberships` (ya en orden de alta) para conservar el orden;
  // el resultado de `.in()` no promete devolverlos en ningún orden concreto.
  return memberships
    .filter((m) => byId.has(m.tenant_id))
    .map((m) => ({ id: m.tenant_id, name: byId.get(m.tenant_id)! }));
}
