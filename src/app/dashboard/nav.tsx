"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ModuleId } from "@/domain/plans";
import {
  IconBuilding,
  IconCalendar,
  IconCard,
  IconChart,
  IconChat,
  IconChevron,
  IconCoin,
  IconDocument,
  IconFolder,
  IconFunnel,
  IconHome,
  IconInbox,
  IconLayout,
  IconList,
  IconMail,
  IconPlus,
  IconSearch,
  IconShare,
  IconSparkle,
  IconTarget,
  IconUsers,
} from "@/app/icons";

/**
 * Navegación por MÓDULOS.
 *
 * Antes agrupaba por "para qué sirve" (General / Inteligencia / Cuenta), que
 * funcionó hasta las 19 entradas. Con el producto creciendo hacia SEO y email
 * esa división se rompe: una entrada de "Keywords" no es ni más ni menos
 * "general" que "Calendario", pertenece a otro módulo distinto.
 *
 * Cada grupo con `module` solo se pinta si el plan lo incluye. Esto decide
 * únicamente lo que se VE: quien autoriza de verdad es `assertModule()` en el
 * backend, porque la URL es adivinable y un menú nunca es control de acceso.
 *
 * Los grupos se pliegan y la elección se recuerda: con un solo módulo caben
 * todas las entradas abiertas, pero quien tenga tres no quiere ver treinta
 * enlaces a la vez para llegar al que usa cada día.
 */

interface NavGroup {
  label: string;
  /** Ausente = grupo transversal, visible siempre. */
  module?: ModuleId;
  links: { href: string; label: string; Icon: (p: { className?: string }) => React.JSX.Element }[];
}

const GROUPS: NavGroup[] = [
  {
    label: "General",
    links: [
      { href: "/dashboard", label: "Panel", Icon: IconHome },
      { href: "/dashboard/reports", label: "Informes", Icon: IconDocument },
    ],
  },
  {
    label: "Redes sociales",
    module: "social",
    links: [
      { href: "/dashboard/calendar", label: "Calendario", Icon: IconCalendar },
      { href: "/dashboard/plan", label: "Plan", Icon: IconInbox },
      { href: "/dashboard/new", label: "Nuevo post", Icon: IconPlus },
      { href: "/dashboard/studio", label: "Content Studio", Icon: IconSparkle },
      { href: "/dashboard/queue", label: "Cola", Icon: IconList },
      { href: "/dashboard/content", label: "Contenido", Icon: IconFolder },
      { href: "/dashboard/kanban", label: "Tablero", Icon: IconLayout },
      { href: "/dashboard/inbox", label: "Mensajes", Icon: IconChat },
      { href: "/dashboard/metrics", label: "Métricas", Icon: IconChart },
      { href: "/dashboard/competitors", label: "Competidores", Icon: IconTarget },
      // "Cuentas" a secas y no "Cuentas conectadas": dentro del grupo "Redes
      // sociales" ya se entiende, y el nombre largo partía en dos líneas.
      { href: "/dashboard/accounts", label: "Cuentas", Icon: IconShare },
    ],
  },
  {
    label: "SEO",
    module: "seo",
    links: [{ href: "/dashboard/seo", label: "Búsquedas", Icon: IconSearch }],
  },
  {
    // Transversal a propósito: un lead puede venir de redes, de SEO o de una
    // campaña de email, y el ROI los compara entre sí. Meterlo dentro de un
    // módulo lo ataría a un solo canal justo cuando su valor es lo contrario.
    label: "Clientes",
    links: [
      { href: "/dashboard/leads", label: "Leads", Icon: IconFunnel },
      { href: "/dashboard/roi", label: "ROI", Icon: IconCoin },
    ],
  },
  {
    label: "Cuenta",
    links: [
      { href: "/dashboard/brand", label: "Empresa", Icon: IconBuilding },
      { href: "/dashboard/team", label: "Equipo", Icon: IconUsers },
      { href: "/dashboard/billing", label: "Suscripción", Icon: IconCard },
    ],
  },
];

/** Solo para administradores de la plataforma, no para los clientes. */
const ADMIN_GROUP: NavGroup = {
  label: "Administración",
  links: [{ href: "/dashboard/invitations", label: "Invitaciones", Icon: IconMail }],
};

const STORAGE_KEY = "nav-collapsed";

export function NavLinks({
  admin = false,
  modules = ["social"],
}: {
  admin?: boolean;
  modules?: ModuleId[];
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // La preferencia se lee DESPUÉS del primer render, no durante: el servidor no
  // tiene localStorage y leerlo al pintar daría un HTML distinto al del cliente.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setCollapsed(JSON.parse(saved));
    } catch {
      // Un localStorage lleno o bloqueado no debe dejar sin menú a nadie.
    }
  }, []);

  function toggle(label: string) {
    setCollapsed((current) => {
      const next = { ...current, [label]: !current[label] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Igual que arriba: si no se puede guardar, se pliega solo esta vez.
      }
      return next;
    });
  }

  const groups = [...GROUPS, ...(admin ? [ADMIN_GROUP] : [])].filter(
    (g) => !g.module || modules.includes(g.module),
  );

  return (
    <nav className="nav" aria-label="Secciones">
      {groups.map((group) => {
        const isActive = (href: string) =>
          href === "/dashboard" ? pathname === href : pathname.startsWith(href);
        // Un grupo que contiene la página actual no se pliega aunque estuviera
        // guardado como plegado: esconder dónde estás deja el menú sin nada
        // marcado y parece que te has salido de la aplicación.
        const hasActive = group.links.some((l) => isActive(l.href));
        const open = hasActive || !collapsed[group.label];

        // Plegar se marca con un atributo y lo aplica el CSS, en vez de no
        // renderizar los enlaces: en móvil la barra es horizontal y los
        // rótulos de grupo se ocultan, así que un grupo plegado en escritorio
        // dejaría esos enlaces inalcanzables allí, sin ningún botón visible
        // para recuperarlos. Con CSS, el móvil los fuerza visibles.
        // `display: none` además los saca del árbol de accesibilidad, así que
        // concuerda con el aria-expanded del botón.
        return (
          <div className="nav-group" key={group.label} data-collapsed={open ? undefined : true}>
            <button
              type="button"
              className="nav-group-label"
              // El nombre accesible explícito: el texto va dentro de un <span>
              // que el CSS puede ocultar, y sin esto el lector de pantalla
              // solo anuncia "botón".
              aria-label={group.label}
              aria-expanded={open}
              onClick={() => toggle(group.label)}
            >
              <span>{group.label}</span>
              <IconChevron className={open ? "chev chev-open" : "chev"} />
            </button>

            {group.links.map(({ href, label, Icon }) => (
              <a
                key={href}
                href={href}
                className="navlink"
                // En móvil el texto se oculta por CSS y quedaría un enlace con solo
                // un icono, sin nombre accesible. El aria-label lo garantiza
                // siempre, sin depender del ancho de la ventana.
                aria-label={label}
                aria-current={isActive(href) ? "page" : undefined}
              >
                <Icon />
                <span>{label}</span>
              </a>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
