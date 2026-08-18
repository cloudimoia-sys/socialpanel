import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { poppins } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "SocialPanel",
  description: "Creación y publicación de contenido en redes sociales.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Sin maximumScale ni userScalable: bloquear el zoom rompe la accesibilidad
  // para quien necesita ampliar.
  themeColor: "#0b0e12",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={poppins.variable}>
      <body>{children}</body>
    </html>
  );
}
