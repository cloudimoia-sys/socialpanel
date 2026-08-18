# SocialPanel

Panel de creación de contenido y publicación multi-red. Multi-tenant desde el
primer commit, con los proveedores de IA detrás de adaptadores para poder
empezar en tiers gratuitos y escalar cambiando una variable de entorno.

## Arquitectura

Stack: Next.js 16 · React 19 · Supabase · Inngest 4 · TypeScript.

```
Next.js (App Router)
  ├─ /api/*            route handlers: validan, autorizan y encolan
  ├─ proxy.ts          refresco de sesión (conveniencia, no seguridad)
  └─ src/
     ├─ providers/     ← la única capa que conoce SDKs externos
     │   ├─ llm/       anthropic · gemini
     │   ├─ image/     cloudflare (gratis) · gemini (de pago)
     │   ├─ video/     fal (agregador: Kling, Veo, Higgsfield…)
     │   └─ publish/   upload-post (~22 redes)
     ├─ domain/        reglas por plataforma · medición de consumo
     ├─ inngest/       cola: generar contenido · publicar
     └─ lib/           env · crypto · supabase · auth · ratelimit · logger
```

**La regla que sostiene todo:** nada fuera de `src/providers/` importa un SDK
externo. Cambiar de modelo de vídeo es escribir una clase nueva que implemente
`VideoProvider`; el resto del código no se entera.

## Puesta en marcha

```bash
npm install
```

npm bloquea el postinstall de `inngest-cli` por política de scripts, y ese
postinstall es el que descarga el binario. Aprobarlo no basta: hay que
reconstruir después.

```bash
npm install-scripts approve inngest-cli && npm rebuild --ignore-scripts=false inngest-cli
```

Comprueba con `npx inngest-cli version`.

1. Crea un proyecto en Supabase y aplica las migraciones de `supabase/migrations/`
   en orden numérico, desde el SQL Editor o con el MCP de Supabase. Van separadas
   porque `0002` toca `storage.objects`, que puede fallar por permisos, y no
   queremos que arrastre al esquema entero en el rollback.
2. `cp .env.example .env.local` y rellena los valores.
3. Genera la clave de cifrado:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

4. Arranca la app y la cola en dos terminales:

```bash
npm run dev
```

```bash
npm run inngest
```

## Escalón gratuito → pago

`PROVIDER_PROFILE=free` usa Gemini para texto y **Cloudflare Workers AI** para
imagen; `paid` cambia el texto a Claude y la imagen a Gemini. El vídeo siempre es
de pago: no existe tier gratuito real de vídeo por API.

Por qué Cloudflare para las imágenes gratis: **la generación de imágenes de
Gemini no tiene plan gratuito** — sin facturación activada devuelve 429, que
parece un límite alcanzado cuando en realidad la cuenta no puede generar
imágenes en absoluto. Cloudflare da 10.000 neuronas/día sin tarjeta y permite
uso comercial.

Limitaciones del camino gratuito, verificadas contra la API real:

- **Solo cuadrado.** Los modelos de Cloudflare no aceptan `width`/`height`:
  devuelven cuadrado. Nada de vertical para Reels o TikTok.
- **Ningún modelo de difusión sabe escribir.** El prompt lleva un guard negativo
  contra texto y contra logos de marca — `flux-1-schnell` llegó a dibujar un
  logo de Apple, que en el post de un cliente es un problema legal, no estético.
  El texto de una pieza va en el caption o superpuesto con tipografía real.
- **Sin imágenes de referencia.** El caso "sube una foto y la IA la edita" solo
  funciona con Gemini.
- **El filtro de contenido tiene falsos positivos** con descripciones cortas y
  abstractas ("un círculo azul sobre fondo blanco" se rechaza como NSFW). Con
  descripciones concretas de escenas reales no da problemas. No depende del
  idioma: falla igual en español y en inglés.

En los tres casos el adaptador lanza un error explicando qué hacer, en vez de
devolver algo distinto de lo pedido en silencio.

`@cf/black-forest-labs/flux-2-klein-9b` sí soportaría más, pero usa un formato de
petición distinto (`multipart`); queda pendiente si hace falta vertical gratis.

| Pieza | Gratis | Cuándo pasar a pago |
|---|---|---|
| Vercel | Hobby | **Al primer cliente que paga** — Hobby prohíbe uso comercial |
| Supabase | Free | Al primer cliente: Free pausa el proyecto tras ~1 semana inactivo y no tiene backups |
| Gemini | free tier | **Antes de tocar contenido real de un cliente**: el tier gratuito puede usarse para entrenar |
| Upload-Post | 10 uploads/mes | Al pasar de las demos ($24/mes, ilimitado) |
| fal.ai | $10 iniciales | Se agotan en ~50-100 vídeos |
| Upstash | — | Obligatorio en producción: sin él el rate limiting es en memoria y no vale con varias instancias |

## Decisiones de seguridad

Están tomadas a propósito y conviene no deshacerlas sin pensarlo:

- **RLS en todas las tablas.** El aislamiento entre clientes vive en la base de
  datos, no en el código, para que un endpoint mal escrito no filtre datos.
- **Los helpers de RLS viven en el esquema `private`.** En `public`, PostgREST
  los publicaba como `/rest/v1/rpc/auth_tenant_ids`. Cualquier función nueva que
  usen las políticas va ahí, nunca en `public`.
- **`provider_credentials` no tiene política de SELECT.** Las API keys de los
  clientes se cifran con AES-256-GCM (con el `tenant_id` como AAD) y solo las lee
  el backend. No hay ningún endpoint que las devuelva, ni siquiera a su dueño.
- **`service_role` solo en workers.** Salta el RLS, así que cada consulta filtra
  por `tenant_id` explícitamente.
- **El tenant sale de la sesión, nunca del payload.** Los endpoints usan
  `requireCurrentTenant()`; no aceptan un `tenantId` del cliente, así que no hay
  ID que manipular y la clase entera de IDOR desaparece.
- **Los archivos subidos se validan por sus bytes**, no por extensión ni
  `Content-Type` (los dos los controla quien sube). La ruta en storage la
  construimos con el tenant y un UUID: el nombre original nunca se usa.
- **Presupuesto antes de gastar.** `assertBudget()` corre antes de cada llamada
  que cuesta dinero, con el importe estimado. El vídeo tiene tope duro de 10 s.
- **Rate limiting en backend** en generación, publicación, subidas y guardado de
  credenciales.
- **Errores redactados.** El usuario recibe un mensaje seguro; el detalle va al
  log, que redacta claves y tokens por patrón.
- **Soft delete** en posts; el bucket de media es privado y se sirve con URLs
  firmadas de una hora.
- **Publicar es idempotente por red.** Antes de enviar se comprueba si esa red
  ya tiene publicación registrada, y una respuesta ambigua deja el destino en
  `unknown`, no en `failed`.

  Esto no es teórico: Upload-Post devolvió `success: false` para Instagram dos
  veces seguidas y las dos veces Instagram publicó. La interfaz decía "falló",
  se reintentó, y salieron tres copias del mismo post. Para una acción
  irreversible y pública, una respuesta ambigua significa *no lo sé*, nunca
  *no ocurrió*.

## Autenticación

Login por enlace mágico (`/login`), sin contraseñas: no hay hashes que proteger
ni flujo de recuperación que abusar. En el primer acceso se crea el tenant y la
pertenencia como `owner`, con 5 € de presupuesto inicial.

El alta va con el cliente de servicio a propósito: `tenants` no tiene política de
INSERT, así que nadie puede crearse un tenant desde el cliente ni asignarse un
plan o un presupuesto.

En Supabase → **Authentication → URL Configuration** hay que dejar:

- Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/**`

Sin eso el enlace del correo rebota.

## Composición de texto

El modelo pone el fondo; el texto lo ponemos nosotros con tipografía real
([src/domain/compose.ts](src/domain/compose.ts)). Tres plantillas: banda
inferior, titular centrado y esquina.

Por qué, y no dejar que lo escriba el modelo: ningún modelo de difusión sabe
escribir, y aunque acertara elegiría él la tipografía, así que dos piezas de la
misma marca saldrían distintas. Además el texto se puede cambiar sin regenerar
la imagen — ni coste ni espera.

La fuente (Poppins, licencia OFL) va versionada en `assets/fonts/`. **No la
quites**: un contenedor Linux no tiene fuentes del sistema, y sin ninguna
registrada el texto se renderiza vacío *sin lanzar error*.

`@napi-rs/canvas` está declarado en `serverExternalPackages` porque carga un
binario nativo por plataforma que el bundler no sabe empaquetar.

## Flujo actual

`/dashboard/brand` (una vez) → `/dashboard/plan` genera ideas con titular, prompt
fotográfico y fecha → apruebas una y se convierte en post → `/dashboard/posts/<id>`
sondea el estado y, cuando está `ready`, permite publicar.

O directo: `/dashboard/new` → idea + redes + media + texto superpuesto.

El plan genera **tres campos distintos** por idea, y la separación importa:
`idea` alimenta el copy, `visual` alimenta el generador de imágenes (una escena
fotografiable, nunca un póster), y `headline` va superpuesto. Pasarle la idea al
modelo de imagen produce infografías con texto y logos inventados: es
literalmente lo que se le está pidiendo.

**La cola tiene que estar corriendo** (`npm run inngest`) o el post se queda en
`generating` para siempre.

## Planes y facturación

El catálogo vive en [src/domain/plans.ts](src/domain/plans.ts) — en código, no en
base de datos: los precios y las cuotas son decisiones de producto que deben
viajar con el despliegue y quedar en el historial de git.

Las cuotas son lo que hace posible el auto-servicio. Se comprueban **antes** de
gastar, en los cuatro puntos donde hay coste: crear post, generar imagen,
generar vídeo y conectar red. Un tope que se detecta al facturar no es un tope,
es una factura sorpresa.

El plan de un tenant lo escribe **solo** el webhook de Stripe con la clave de
servicio. Si el cliente pudiera tocarlo, el auto-servicio sería auto-regalo.

### Puesta en marcha de Stripe

1. Crea dos precios recurrentes en Stripe (Starter y Pro) y copia sus
   `price_...` — no los `prod_...`.
2. Rellena `STRIPE_SECRET_KEY`, `STRIPE_PRICE_STARTER` y `STRIPE_PRICE_PRO`.
3. Para probar el webhook en local:

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

El comando imprime un `whsec_...`: ese es `STRIPE_WEBHOOK_SECRET`.

`STRIPE_AUTOMATIC_TAX` queda en `false` hasta que configures Stripe Tax en su
panel; activarlo sin dirección fiscal registrada hace fallar el checkout.

### Prueba con tarjeta

7 días gratis pero con tarjeta obligatoria (`payment_method_collection: always`).
Si al acabar la prueba la tarjeta no sirve, la suscripción se **cancela** en vez
de quedarse impagada consumiendo recursos.

Durante la prueba se aplican las cuotas completas del plan pero con el techo de
gasto recortado a `TRIAL_BUDGET_CENTS` (5 €). La tarjeta frena el abuso masivo,
no el de una tarjeta virtual de un solo uso: sin ese tope, alguien podría agotar
los 300 s de vídeo del plan Pro y cancelar antes del primer cobro.

### Reglas del webhook

- **Verifica la firma.** Un endpoint de facturación sin verificar es un
  formulario público para regalarse el plan Pro.
- **Es idempotente.** La marca en `processed_webhooks` se inserta *antes* de
  actuar, y la clave primaria hace de cerrojo. Stripe reintenta ante cualquier
  duda de entrega.
- **Devuelve 200 aunque el evento no interese.** Un error hace que Stripe
  reintente durante días y acabe desactivando el endpoint.
- **Si no reconoce el precio, no adivina.** Adivinar aquí es regalar o cobrar
  de más.

## Programación de publicaciones

Un post `ready` se puede programar con fecha y hora. Un cron de Inngest barre
cada 5 minutos los vencidos y los encola por el mismo camino que la publicación
manual — misma validación por plataforma y misma idempotencia.

**Por qué un barrido y no delegarlo en Upload-Post**, que también lo soporta:

- Si la app estuvo caída a la hora exacta, el siguiente barrido lo recupera. Un
  temporizador perdido no vuelve.
- Cancelar y reprogramar son un `UPDATE`, no localizar y matar un job en un
  sistema ajeno.
- El post pasa por nuestras reglas de plataforma y nuestro registro de consumo
  antes de salir. Delegándolo, se publicaría sin pasar por ninguna de las dos.

**La reserva es lo que evita duplicados.** El barrido marca `publishing` con un
`UPDATE ... WHERE status = 'scheduled'` y solo continúa con las filas que
consiguió cambiar. Dos barridos simultáneos: el primero reserva, el segundo no
encuentra nada. Verificado.

Las horas se guardan en UTC (`timestamptz`) y el navegador convierte desde la
hora local del usuario. Mandar "15:00" sin zona significaría cosas distintas
según dónde corra el servidor.

### Aprobar una idea la programa sola

Las ideas del plan traen fecha propuesta. Al aprobarlas, el post se crea con esa
fecha ya puesta y, cuando termina de generarse, pasa directo a `scheduled` en
lugar de a `ready`. Si la fecha ya pasó, queda listo para publicar a mano.

La fecha viene sin hora, así que el huso y la hora salen del perfil de marca
(`timezone`, `publish_hour`). La conversión está en
[src/domain/schedule.ts](src/domain/schedule.ts) y contempla el horario de
verano midiendo el desfase real de ese día concreto, sin dependencias.

Verificado: 10:00 en Madrid son las 08:00 UTC en septiembre y las 09:00 en
diciembre; en Canarias, las 09:00; en Ciudad de México, las 16:00. Una zona
inválida no programa en vez de programar a deshora.

## Vídeo infograma (Remotion)

`src/video/` — vídeos de datos (dos cifras animadas) renderizados con código,
no con un modelo generativo. Vive fuera de `src/providers/` a propósito: no es
un adaptador de una API externa, es cómputo local, y forzarlo en la interfaz
`VideoProvider` (pensada para el ciclo start/poll de una llamada asíncrona a
terceros) habría sido encajar mal una pieza que es fundamentalmente distinta.

**Por qué existe en vez de usar un modelo de vídeo generativo para esto:**
verificado que ni Veo 3.1 ni Kling renderizan texto en pantalla de forma
fiable — el mismo problema que ya resolvimos en imagen con el compositor de
[src/domain/compose.ts](src/domain/compose.ts), pero peor en vídeo porque
además tiene que mantenerse estable entre fotogramas. Un infograma **es**
texto y datos, así que pedírselo a un modelo de vídeo iba a fallar por la
misma razón que fallaban los carteles en imagen.

- `compositions/Stats.tsx` — la plantilla. Añadir una nueva es un componente
  más en `compositions/Root.tsx`, sin tocar el resto del pipeline.
- `render.ts` — bundlea una vez por proceso (recompilar en cada vídeo cuesta
  segundos sin ganar nada) y renderiza a un archivo temporal que se lee y se
  borra.
- `color.ts` — el perfil de marca solo guarda un color de acento, no un
  "acento oscuro" para el degradado; se deriva con `darken()` en vez de
  guardar un segundo campo, así el degradado siempre combina con el color real
  del cliente.

**Coste: cero.** No hay llamada a ninguna API de pago — por eso se registra en
`usage_events` con `cost_cents: 0` y cuenta contra la cuota de **imágenes** del
plan, no la de vídeo (que representa segundos facturados de verdad a fal.ai).
Tratarlo como vídeo penalizaría un recurso que en realidad es gratis.

`@remotion/bundler` y `@remotion/renderer` van en `serverExternalPackages` de
`next.config.ts`: lanzan Chromium sin interfaz y hacen su propio bundling con
esbuild, y Turbopack rompe esos binarios si intenta empaquetarlos — el mismo
problema que ya tuvimos con `@napi-rs/canvas`.

La primera vez que se renderiza algo en una máquina, Remotion descarga
Chromium sin interfaz (~113 MB) a una caché de usuario compartida entre
proyectos; no vuelve a descargarlo.

## Pendiente

- Ajustes: BYOK y conexión de cuentas desde la interfaz.
- Más plantillas de infograma (checklist animado, cita destacada, comparativa).
- Que el plan de contenido pueda pedir un infograma como `suggestedMedia`, con
  el LLM extrayendo el titular y las dos cifras del brief — hoy los campos del
  infograma se rellenan a mano en el composer.
- Verificación explícita de origen (CSRF) en los POST cuando se añadan formularios
  clásicos: ahora mismo dependemos de `SameSite` de la cookie de Supabase.
- Transcodificado por plataforma (recorte de aspect ratio y duración).
- Analíticas de Upload-Post (ya incluidas en el plan y sin usar).
- Programar desde el propio plan de contenido: cada idea ya trae `scheduled_for`
  con la fecha propuesta, pero al aprobarla no se programa todavía.
