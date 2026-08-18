import type { ReactNode } from "react";
import { Credit } from "@/app/credit";
import { IconLogout } from "@/app/icons";
import { NavLinks } from "@/app/dashboard/nav";

/**
 * Estructura común del panel.
 *
 * La navegación va aquí y no en cada página para que ninguna pantalla nueva
 * pueda quedarse sin salida — es un fallo que ya cometí una vez poniendo el
 * "volver" a mano en cada sitio.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="/dashboard" className="brandmark">
          <span className="dot" />
          SocialPanel
        </a>

        <NavLinks />

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
