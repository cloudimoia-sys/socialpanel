"use client";

import { usePathname } from "next/navigation";
import {
  IconBuilding,
  IconCalendar,
  IconCard,
  IconChart,
  IconHome,
  IconInbox,
  IconList,
  IconMail,
  IconPlus,
  IconShare,
} from "@/app/icons";

/**
 * Navegación agrupada por para qué sirve cada sección.
 *
 * "General" es el trabajo del día, "Inteligencia" lo que hay que mirar para
 * decidir y "Cuenta" lo que se toca de vez en cuando. Con la lista plana
 * anterior había que releerla entera para encontrar una sección; agrupada,
 * el ojo va directo al bloque.
 */

const GROUPS = [
  {
    label: "General",
    links: [
      { href: "/dashboard", label: "Panel", Icon: IconHome },
      { href: "/dashboard/calendar", label: "Calendario", Icon: IconCalendar },
      { href: "/dashboard/plan", label: "Plan", Icon: IconInbox },
      { href: "/dashboard/new", label: "Nuevo post", Icon: IconPlus },
      { href: "/dashboard/queue", label: "Cola", Icon: IconList },
    ],
  },
  {
    label: "Inteligencia",
    links: [{ href: "/dashboard/metrics", label: "Métricas", Icon: IconChart }],
  },
  {
    label: "Cuenta",
    links: [
      { href: "/dashboard/brand", label: "Empresa", Icon: IconBuilding },
      { href: "/dashboard/accounts", label: "Redes", Icon: IconShare },
      { href: "/dashboard/billing", label: "Suscripción", Icon: IconCard },
    ],
  },
];

/** Solo para administradores de la plataforma, no para los clientes. */
const ADMIN_GROUP = {
  label: "Administración",
  links: [{ href: "/dashboard/invitations", label: "Invitaciones", Icon: IconMail }],
};

export function NavLinks({ admin = false }: { admin?: boolean }) {
  const pathname = usePathname();
  const groups = admin ? [...GROUPS, ADMIN_GROUP] : GROUPS;

  return (
    <nav className="nav" aria-label="Secciones">
      {groups.map((group) => (
        <div className="nav-group" key={group.label}>
          {/* aria-hidden: el rótulo es una ayuda visual para agrupar, y
              leerlo antes de cada enlace solo alarga la navegación por voz. */}
          <p className="nav-group-label" aria-hidden="true">
            {group.label}
          </p>

          {group.links.map(({ href, label, Icon }) => {
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
        </div>
      ))}
    </nav>
  );
}
