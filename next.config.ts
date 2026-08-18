import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,

  // @napi-rs/canvas carga un binario `.node` propio de cada plataforma. Si el
  // bundler intenta empaquetarlo, no resuelve la dependencia nativa y falla al
  // importar. Declararlo externo hace que se cargue en tiempo de ejecución.
  //
  // @remotion/bundler y @remotion/renderer lanzan Chromium sin interfaz y
  // hacen su propio bundling con esbuild internamente: empaquetarlos con
  // Turbopack rompe esos binarios exactamente igual.
  serverExternalPackages: ["@napi-rs/canvas", "@remotion/bundler", "@remotion/renderer", "remotion"],

  // Cabeceras de seguridad por defecto en todas las rutas.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default config;
