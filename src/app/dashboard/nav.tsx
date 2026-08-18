"use client";

import { usePathname } from "next/navigation";
import {
  IconBuilding,
  IconCalendar,
  IconCard,
  IconChart,
  IconHome,
  IconPlus,
  IconShare,
} from "@/app/icons";

const LINKS = [
  { href: "/dashboard", label: "Panel", Icon: IconHome },
  { href: "/dashboard/brand", label: "Empresa", Icon: IconBuilding },
  { href: "/dashboard/plan", label: "Plan", Icon: IconCalendar },
  { href: "/dashboard/new", label: "Nuevo post", Icon: IconPlus },
  { href: "/dashboard/metrics", label: "Métricas", Icon: IconChart },
  { href: "/dashboard/accounts", label: "Redes", Icon: IconShare },
  { href: "/dashboard/billing", label: "Suscripción", Icon: IconCard },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Secciones">
      {LINKS.map(({ href, label, Icon }) => {
        // "/dashboard" solo se marca en exacto; el resto también en sus subrutas.
        const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);

        return (
          <a
            key={href}
            href={href}
            className="navlink"
            // En móvil el texto se oculta por CSS y quedaría un enlace con solo
            // un icono, sin nombre accesible. El aria-label lo garantiza
            // siempre, sin depender del ancho de la ventana.
            aria-label={label}
            aria-current={active ? "page" : undefined}
          >
            <Icon />
            <span>{label}</span>
          </a>
        );
      })}
    </nav>
  );
}
