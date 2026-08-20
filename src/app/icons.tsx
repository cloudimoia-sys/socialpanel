/**
 * Iconos SVG en línea.
 *
 * SVG y no emoji: los emoji cambian de aspecto en cada sistema operativo, no
 * heredan el color del texto y los lectores de pantalla los leen en voz alta
 * con nombres absurdos. `currentColor` hace que sigan el color del contenedor
 * sin duplicar variantes.
 *
 * Trazo de Lucide (MIT).
 */

type Props = { className?: string; size?: number | string };

/**
 * Un SVG en línea sin `width`/`height` no tiene tamaño intrínseco: el
 * navegador cae a su default de reemplazo (300×150px). Sin esta base, un
 * icono colocado donde nadie definió `svg { width; height }` en CSS se pinta
 * enorme — pasó con el triángulo de aviso y los checks de precios.
 *
 * `1em` los liga al tamaño de fuente del contenedor (como un icon-font), así
 * que heredan el tamaño de texto de alrededor sin que cada sitio de uso tenga
 * que fijarlo. `size` permite un valor concreto cuando 1em no encaja.
 */
const base = {
  viewBox: "0 0 24 24",
  width: "1em",
  height: "1em",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  style: { flexShrink: 0 },
  "aria-hidden": true,
};

function iconProps({ size, ...rest }: Props) {
  return size !== undefined ? { ...rest, width: size, height: size } : rest;
}

export const IconHome = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </svg>
);

export const IconBuilding = (p: Props) => (
  <svg {...base} {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h6" />
  </svg>
);

export const IconCalendar = (p: Props) => (
  <svg {...base} {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const IconPlus = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconShare = (p: Props) => (
  <svg {...base} {...p}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);

export const IconLogout = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M15 17l5-5-5-5M20 12H9M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
  </svg>
);

export const IconInbox = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M3 12h5l2 3h4l2-3h5" />
    <path d="M5.5 5h13l2.5 7v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7z" />
  </svg>
);

export const IconAlert = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </svg>
);

export const IconCheck = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconExternal = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M15 3h6v6M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

export const IconCard = (p: Props) => (
  <svg {...base} {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20M6 15h4" />
  </svg>
);

export const IconList = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </svg>
);

export const IconMail = (p: Props) => (
  <svg {...base} {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </svg>
);

export const IconChart = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="M7 15l3.5-4 3 2.5L20 7" />
  </svg>
);

export const IconArrowLeft = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);
