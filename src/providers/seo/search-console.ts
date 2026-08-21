import { serverEnv } from "@/lib/env";
import { AppError, log } from "@/lib/logger";

/**
 * Google Search Console.
 *
 * Único sitio del módulo SEO que habla con la API de Google, igual que el
 * resto de `providers/`. Sin SDK: son tres endpoints REST y el SDK oficial
 * de Google arrastra decenas de megas de dependencias para esto.
 *
 * Da datos de la web DEL PROPIO CLIENTE (por eso es gratis y oficial): qué
 * busca la gente que acaba entrando, cuántas veces aparece, cuántos clics y
 * en qué posición media. No da posiciones de keywords arbitrarias ni datos de
 * la competencia — eso no lo publica ninguna API de Google.
 */

const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://searchconsole.googleapis.com/webmasters/v3";

/** Solo lectura: la app nunca necesita modificar nada en Search Console. */
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export interface SearchRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchTotals {
  clicks: number;
  impressions: number;
  /** Fracción 0-1, tal cual la devuelve Google. */
  ctr: number;
  position: number;
}

function credentials(): { clientId: string; clientSecret: string } {
  const env = serverEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new AppError("La conexión con Google no está configurada en el servidor.", 503);
  }
  return { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET };
}

export const searchConsoleConfigured = (): boolean => {
  const env = serverEnv();
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
};

export const redirectUri = (): string => `${serverEnv().APP_URL}/api/seo/callback`;

/**
 * URL a la que se manda al usuario para que autorice.
 *
 * `access_type=offline` + `prompt=consent` son lo que hace que Google
 * devuelva un refresh token: sin ellos solo llega un access token de una hora
 * y la conexión se caería sola al día siguiente. `prompt=consent` además
 * fuerza que lo devuelva también al reconectar — Google omite el refresh
 * token en autorizaciones repetidas si no se le pide explícitamente.
 */
export function authUrl(state: string): string {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${OAUTH_AUTH}?${params}`;
}

/** Cambia el código de un solo uso por un refresh token duradero. */
export async function exchangeCode(code: string): Promise<string> {
  const { clientId, clientSecret } = credentials();

  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const json = await res.json();
  if (!res.ok || !json.refresh_token) {
    // El detalle va al log (redactado) y al usuario un mensaje útil: el fallo
    // habitual aquí es que la URI de redirección no coincide con la del
    // cliente de OAuth, y decir "error 400" no ayuda a nadie a arreglarlo.
    log.warn("Google no devolvió refresh token", { status: res.status, error: json.error });
    throw new AppError("Google no completó la conexión. Vuelve a intentarlo.", 502);
  }

  return json.refresh_token as string;
}

/**
 * Un access token nuevo a partir del refresh token.
 *
 * Se pide en cada uso en vez de guardarlo: dura una hora, y cachearlo
 * obligaría a guardar un segundo secreto con su caducidad para ahorrar una
 * llamada que tarda milisegundos.
 */
async function accessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = credentials();

  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const json = await res.json();
  if (!res.ok || !json.access_token) {
    log.warn("no se pudo renovar el token de Google", { status: res.status, error: json.error });
    // 401 y no 502: lo normal es que el cliente retirase el permiso desde su
    // cuenta de Google, y lo que toca es reconectar, no reintentar.
    throw new AppError("La conexión con Google ha caducado. Vuelve a conectarla.", 401);
  }

  return json.access_token as string;
}

async function call<T>(path: string, refreshToken: string, init?: RequestInit): Promise<T> {
  const token = await accessToken(refreshToken);

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    log.warn("Search Console respondió con error", { path, status: res.status });
    if (res.status === 403) {
      throw new AppError("Esa cuenta de Google no tiene acceso a esa web en Search Console.", 403);
    }
    throw new AppError("Search Console no respondió. Inténtalo en un rato.", 502, detail);
  }

  return res.json() as Promise<T>;
}

/** Propiedades a las que esa cuenta de Google tiene acceso. */
export async function listSites(
  refreshToken: string,
): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const body = await call<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(
    "/sites",
    refreshToken,
  );
  return (body.siteEntry ?? [])
    // Sin permiso no se pueden leer métricas: enseñarla solo llevaría a un
    // 403 después de elegirla.
    .filter((s) => s.permissionLevel !== "siteUnverifiedUser");
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Dónde aparece el resultado. Google los cuenta por separado y no se suman:
 * Discover sobre todo suele traer un volumen que nadie mira porque en la
 * pantalla por defecto de Search Console no sale.
 */
export type SearchType = "web" | "image" | "video" | "discover" | "googleNews";

export const SEARCH_TYPES: { id: SearchType; label: string }[] = [
  { id: "web", label: "Web" },
  { id: "image", label: "Imágenes" },
  { id: "video", label: "Vídeo" },
  { id: "discover", label: "Discover" },
  { id: "googleNews", label: "Noticias" },
];

export type Dimension = "query" | "page" | "date" | "country" | "device";

/**
 * Discover y Google News no tienen consultas de búsqueda: nadie escribe nada,
 * es un feed. Pedir la dimensión "query" ahí devuelve error de la API, así
 * que hay que saberlo antes de preguntar.
 */
export function supportsDimension(type: SearchType, dimension: Dimension): boolean {
  if (type === "discover" || type === "googleNews") return dimension !== "query";
  return true;
}

/**
 * Datos de rendimiento de una web.
 *
 * `dimension` vacía devuelve los totales del periodo; con una dimensión,
 * el desglose por ella.
 *
 * Ojo con el desfase: Search Console tarda 2-3 días en consolidar. Por eso el
 * rango termina hace 3 días y no hoy — pedir hasta hoy devuelve los últimos
 * días a cero y parece una caída en picado.
 *
 * `offsetDays` desplaza la ventana hacia atrás para pedir el periodo anterior
 * con el que comparar, sin duplicar la lógica de fechas.
 */
export async function performance(
  refreshToken: string,
  siteUrl: string,
  {
    days = 28,
    dimension,
    limit = 10,
    type = "web",
    offsetDays = 0,
  }: {
    days?: number;
    dimension?: Dimension;
    limit?: number;
    type?: SearchType;
    offsetDays?: number;
  } = {},
): Promise<{ totals: SearchTotals; rows: SearchRow[] }> {
  const end = new Date(Date.now() - (3 + offsetDays) * 86_400_000);
  const start = new Date(end.getTime() - days * 86_400_000);

  const body = await call<{
    rows?: { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }[];
  }>(`/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, refreshToken, {
    method: "POST",
    body: JSON.stringify({
      startDate: isoDay(start),
      endDate: isoDay(end),
      dimensions: dimension ? [dimension] : [],
      rowLimit: dimension ? limit : 1,
      type,
    }),
  });

  const rows = (body.rows ?? []).map((r) => ({
    key: r.keys?.[0] ?? "",
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));

  // Sin dimensión, Google devuelve una única fila con los totales. Sin datos
  // (web recién verificada) no devuelve ninguna: ceros, que aquí sí son
  // ciertos — la web existe y no ha tenido impresiones.
  const totals: SearchTotals = dimension
    ? rows.reduce(
        (acc, r) => ({
          clicks: acc.clicks + r.clicks,
          impressions: acc.impressions + r.impressions,
          ctr: 0,
          position: 0,
        }),
        { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      )
    : {
        clicks: rows[0]?.clicks ?? 0,
        impressions: rows[0]?.impressions ?? 0,
        ctr: rows[0]?.ctr ?? 0,
        position: rows[0]?.position ?? 0,
      };

  return { totals, rows };
}
