# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run dev         # Next.js dev server (Turbopack)
npm run inngest     # cola de jobs — TIENE que estar corriendo o los posts se
                     # quedan en "generating" para siempre
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm run build       # build de producción
```

No hay suite de tests. La verificación es `npm run typecheck` + `npm run build`
(el build corre tsc también) y, para cambios de UI, probar en el navegador.

`npm install` no basta para `inngest-cli`: npm bloquea su postinstall (es el
que descarga el binario). Hace falta:

```bash
npm install-scripts approve inngest-cli && npm rebuild --ignore-scripts=false inngest-cli
```

Ver [README.md](README.md) para la puesta en marcha completa (migraciones de
Supabase, `.env.local`, generación de la clave de cifrado, Stripe CLI local).

## Arquitectura

Next.js 16 (App Router) · React 19 · Supabase (Postgres + Auth + Storage) ·
Inngest 4 · TypeScript. Multi-tenant desde el primer commit.

```
src/
  providers/    ← la ÚNICA capa que importa SDKs externos
    llm/        anthropic · gemini
    image/      cloudflare (gratis) · gemini (de pago)
    video/      fal (Kling/Veo/Higgsfield vía un solo agregador)
    news/       google-news (RSS, tema del plan) · article (URL manual)
    publish/    upload-post (~20 redes + analítica)
  domain/       reglas de negocio puras: platform-rules, quota, usage, plans,
                schedule, compose (texto/carrusel sobre imagen), brand
  inngest/      cola: generate-content, publish-post, publish-due (cron)
  lib/          env, crypto, supabase (admin/user client), tenant, admin,
                ratelimit, logger, route (wrapper de handlers)
  app/api/      route handlers: validan (zod) → autorizan → encolan o mutan
  app/dashboard/ UI del panel, protegida por proxy.ts + requireCurrentTenant()
```

**Regla que sostiene todo:** nada fuera de `src/providers/` importa un SDK de
proveedor externo. Cambiar de proveedor de vídeo es escribir una clase que
implemente `VideoProvider` (`src/providers/types.ts`) y registrarla en
`src/providers/registry.ts`; el resto de la app no se entera. `registry.ts`
también resuelve la credencial a usar (BYOK del tenant, cifrada, o la de
plataforma) y el perfil `free`/`paid` (`PROVIDER_PROFILE`) que decide qué
proveedor usa cada capacidad.

### Convención de route handlers

Todo handler en `src/app/api/**/route.ts` sigue:

```ts
export async function POST(request: Request) {
  return run(async () => {
    const body = schema.parse(await request.json()); // zod
    const tenant = await requireCurrentTenant();      // nunca tenantId del payload
    // ...
    throw new AppError("mensaje seguro para el usuario", 400);
  });
}
```

`run()` (`src/lib/route.ts`) captura `AppError` (mensaje público + status,
detalle a log), `ZodError` (lista qué campo falló) y cualquier otro error
(500 genérico). `src/lib/logger.ts` redacta API keys/tokens/JWT por patrón
antes de loguear — nunca añadas un `console.log` que esquive `log.*`.

### Multi-tenant y autenticación

- El tenant activo sale **siempre** de la sesión vía `requireCurrentTenant()`
  (`src/lib/tenant.ts`), nunca de un campo del payload — no existe la clase de
  bug IDOR "cambia el tenantId".
- Alta atómica en `ensure_tenant()` (función Postgres, `security definer`,
  sin permiso para `anon`/`authenticated`): resuelve la membresía existente o
  crea tenant + membership en una sola transacción con lock por usuario
  (evitó una condición de carrera que llegó a crear 110 tenants para una
  cuenta).
- **Acceso por invitación.** `ensure_tenant()` solo da de alta si el correo
  está en `allowed_signups`; si no, devuelve `null` y `tenant.ts` lo traduce
  en `AppError("NOT_INVITED", 403)`, que `/dashboard/page.tsx` intercepta y
  manda a `/sin-acceso`. Quien ya tiene cuenta entra igual aunque lo
  retiren de la lista — cerrar la puerta no expulsa a quien ya estaba dentro.
- Login con contraseña (alta, entrar, recuperar) más Google OAuth opcional.
  El botón de Google solo se pinta si `auth/v1/settings` confirma el
  proveedor habilitado en Supabase — `signInWithOAuth` no devuelve error si
  está desactivado, saca al usuario del sitio y lo deja en un JSON crudo de
  Supabase sin vuelta atrás.
- **Admin de plataforma ≠ rol de tenant.** `memberships.role` (`owner` /
  `admin` / `member`) es *dentro* de un tenant; todo cliente es `owner` del
  suyo. Quién puede invitar a otros clientes (`/dashboard/invitations`,
  `src/app/api/invitations/`) lo decide `PLATFORM_ADMIN_EMAILS` (env, lista
  de correos separados por coma) vía `src/lib/admin.ts` — deliberadamente
  fuera de la base de datos, para que un fallo de RLS no sea escalada de
  privilegios. Vacío = nadie es admin (falla cerrado).

### Seguridad — decisiones a propósito, no las deshagas sin pensarlo

- RLS en todas las tablas; helpers de RLS en el esquema `private` (en
  `public`, PostgREST los publica como endpoint).
- `provider_credentials` sin política de SELECT — las claves BYOK se cifran
  con AES-256-GCM (`tenant_id` como AAD, `src/lib/crypto.ts`) y solo las lee
  el backend con `service_role`.
- `allowed_signups` con RLS activo y **sin ninguna política** — solo
  alcanzable con `service_role`, nunca desde el cliente.
- Los uploads se validan por los bytes reales (`src/domain/file-types.ts`,
  magic numbers), nunca por extensión ni `Content-Type`.
- `assertBudget()` corre *antes* de cada llamada que cuesta dinero, no
  después — un tope que se detecta al facturar es una factura sorpresa.
- Publicar es idempotente por red (comprobación previa + `status: unknown`
  cuando la respuesta del proveedor es ambigua, nunca `failed` a ciegas):
  Upload-Post devolvió `success: false` para Instagram dos veces seguidas y
  las dos veces publicó igual.

### Generación de contenido

El plan (`src/app/api/plans/route.ts`) genera ideas con **tres campos
separados** por una razón concreta: `idea` alimenta el copy, `visual`
alimenta el generador de imágenes (una escena fotografiable, nunca un
póster — pasarle `idea` produce infografías con texto y logos inventados),
`headline` va superpuesto con tipografía real. La actualidad del sector usa
noticias reales (`providers/news/google-news.ts`, RSS) referenciadas por
**índice** en el prompt, no por URL — pedirle al modelo que reproduzca una
URL de Google News (cientos de caracteres opacos) para verificarla después
descartaba aciertos por errores de copiado.

`src/domain/compose.ts` es donde el modelo deja de escribir: pone el fondo,
nosotros el texto, con tipografía real (nunca confiar en que un modelo de
difusión sepa escribir). Dos modos:

- **Overlay** sobre una imagen generada (`composeOverlay`, 3 plantillas).
- **Carrusel** de diapositivas sin imagen (`composeSlide`) — texto puro
  sobre fondo de marca, con `*resaltado*` en el color de acento. Coste cero
  de IA por diapositiva. Publica varias `photos[]` en la misma llamada a
  Upload-Post y monta el carrusel solo (hasta 10 en Instagram).

Catorce familias tipográficas en `assets/fonts/` (SIL OFL), elegibles por
`brand_profiles.font_family`. **No borres nada de esa carpeta** — un
contenedor Linux no tiene fuentes del sistema, y sin ninguna registrada el
texto se renderiza vacío sin lanzar error. Las manuscritas (`script: true`
en `FONT_FAMILIES`) conservan minúsculas — pasarlas a versales las hace
ilegibles.

El vídeo infograma (`src/video/`, Remotion) vive fuera de `providers/` a
propósito: no es un adaptador de API externa, es cómputo local, y forzarlo
en la interfaz `VideoProvider` (pensada para el ciclo start/poll asíncrono)
encajaría mal. Cuesta `0` y cuenta contra la cuota de **imágenes**, no la de
vídeo (que representa segundos facturados de verdad a fal.ai).

### Subida de archivos

Dos pasos (`src/app/api/uploads/sign` + `/finalize`), no uno: Vercel limita a
4.5 MB el cuerpo de una Serverless Function, muy por debajo de los 50 MB que
admite la app. El navegador sube directo a Supabase Storage con una URL
firmada; `/finalize` vuelve a descargar el objeto y valida los bytes reales
antes de registrar el asset — la firma no sustituye esa validación, porque
el tipo declarado al pedir la URL lo controla el cliente.

### Planes, cuotas y Stripe

Catálogo en `src/domain/plans.ts`, en código y no en base de datos — precio y
cuotas son decisiones de producto que viajan con el despliegue. El plan de
un tenant lo escribe **solo** el webhook de Stripe con `service_role`; si el
cliente pudiera tocarlo, el auto-servicio sería auto-regalo. El webhook
verifica firma, es idempotente (`processed_webhooks`, marca insertada antes
de actuar) y devuelve 200 aunque el evento no interese (un error hace que
Stripe reintente días y desactive el endpoint).

### Programación de publicaciones

Cron de Inngest (`publish-due.ts`) cada 5 min. La reserva evita duplicados:
`UPDATE ... WHERE status = 'scheduled'` y solo se continúa con las filas que
el propio `UPDATE` consiguió cambiar — dos barridos simultáneos, el primero
reserva y el segundo no encuentra nada. Horas en UTC (`timestamptz`);
conversión de huso en `src/domain/schedule.ts` (mide el desfase real del día
concreto, sin dependencias — contempla horario de verano).

### Métricas

`src/app/api/metrics/` usa la propia API de analítica de Upload-Post — no un
proveedor externo — porque las cuentas ya están conectadas ahí y evita que
el cliente las conecte dos veces. Cada red nombra distinto su métrica de
visibilidad (Instagram "alcance", TikTok "reproducciones", X "impresiones");
se traduce **por red**, no por nombre de campo, porque el mismo campo
(`impressions`) significa cosas distintas según la red. Facebook exige un
`page_id` que se resuelve solo contra `/uploadposts/facebook/pages` — pedirlo
a mano no funciona porque el ID que Facebook muestra en la URL del navegador
no es el que acepta su API.
