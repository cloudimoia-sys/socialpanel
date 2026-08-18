import type { ReactNode } from "react";
import { Credit } from "@/app/credit";
import { IconLogout } from "@/app/icons";
import { NavLinks } from "@/app/dashboard/nav";
import { isPlatformAdmin } from "@/lib/admin";

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

  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="/dashboard" className="brandmark">
          <span className="dot" />
          SocialPanel
        </a>

        <NavLinks admin={admin} />

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
