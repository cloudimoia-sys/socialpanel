import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Credit } from "@/app/credit";
import { IconLogout } from "@/app/icons";
import { NavLinks } from "@/app/dashboard/nav";
import { TenantSwitcher } from "@/app/dashboard/tenant-switcher";
import { tenantModules } from "@/domain/quota";
import { isPlatformAdmin } from "@/lib/admin";
import { AppError } from "@/lib/logger";
import { currentTenant, listMyTenants } from "@/lib/tenant";

/**
 * Estructura común del panel.
 *
 * La navegación va aquí y no en cada página para que ninguna pantalla nueva
 * pueda quedarse sin salida — es un fallo que ya cometí una vez poniendo el
 * "volver" a mano en cada sitio.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Solo decide si se PINTA el enlace. Quien lo esconde de verdad es la API,
  // que vuelve a comprobar el permiso: la URL es adivinable y un menú no es
  // un control de acceso.
  const admin = await isPlatformAdmin();

  // El layout envuelve TODAS las páginas de /dashboard, incluida la que ya
  // capturaba NOT_INVITED para mandar a /sin-acceso. Sin este mismo try/catch
  // aquí, ese lanzamiento escapa del layout antes de que la página llegue a
  // ejecutarse, y quien no está invitado ve un error genérico en vez de la
  // explicación — se descubrió construyendo el selector, no lo tenía antes.
  let tenant;
  try {
    tenant = await currentTenant();
  } catch (cause) {
    if (cause instanceof AppError && cause.publicMessage === "NOT_INVITED") {
      redirect("/sin-acceso");
    }
    throw cause;
  }

  // Sin tenant resuelto no hay nada que listar todavía; evita una consulta
  // que solo importaría si hubiera selector que pintar.
  const tenants = tenant ? await listMyTenants() : [];

  // Qué módulos incluye su plan. Igual que `admin`: decide qué se PINTA, no
  // qué se puede usar — de eso se encarga `assertModule()` en cada endpoint.
  const modules = tenant ? await tenantModules(tenant.tenantId) : ["social" as const];

  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="/dashboard" className="brandmark">
          <span className="dot" />
          SocialPanel
        </a>

        {/* Solo con más de un tenant: es la única situación (agencias) en la
            que hace falta elegir, y para el resto sería ruido. */}
        {tenant && tenants.length > 1 && (
          <TenantSwitcher tenants={tenants} activeId={tenant.tenantId} />
        )}

        <NavLinks admin={admin} modules={modules} />

        <div className="sidebar-foot">
          <form action="/auth/signout" method="post">
            <button type="submit" className="navlink" aria-label="Cerrar sesión">
              <IconLogout />
              <span>Salir</span>
            </button>
          </form>
          <Credit className="credit-sidebar" />
        </div>
      </aside>

      {children}
    </div>
  );
}
