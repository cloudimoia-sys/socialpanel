import { AppError, log } from "@/lib/logger";
import type {
  ConnectedAccount,
  Credential,
  PlatformMetrics,
  PublishProvider,
  PublishRequest,
  PublishResult,
} from "../types";

/**
 * Upload-Post: una sola integración para ~22 redes.
 *
 * Es deliberadamente la pieza que NO construimos nosotros. Hacer OAuth nativo
 * de TikTok, Instagram, YouTube y LinkedIn son meses de trabajo más revisión
 * de app en cada plataforma.
 *
 * Modelo de datos de Upload-Post: bajo una clave de API hay N "perfiles", y
 * cada perfil agrupa las cuentas sociales conectadas de un usuario. Usamos el
 * `tenant_id` como nombre de perfil, de forma que las cuentas de un cliente
 * nunca sean alcanzables desde la sesión de otro.
 *
 * OJO: el perfil hay que crearlo explícitamente antes de publicar o de generar
 * el enlace de conexión. Si no existe, la API responde "Username not associated
 * with any profile".
 */

const API = "https://api.upload-post.com/api";

/**
 * Ojo con `social_accounts`: una red sin conectar viene como cadena vacía, y
 * una conectada como objeto con sus datos. Verificado contra la API real.
 */
type SocialAccountValue =
  | string
  | { display_name?: string; handle?: string; reauth_required?: boolean };

interface Profile {
  username: string;
  social_accounts?: Record<string, SocialAccountValue>;
  blocked?: boolean;
}

/**
 * Respuesta de analítica por red. O trae métricas, o trae `success: false`
 * con el motivo — comprobado contra la API real: una cuenta de LinkedIn con
 * la sesión caducada convive con un Instagram que responde perfectamente.
 */
type AnalyticsEntry = {
  success?: boolean;
  message?: string;
  followers?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  reach_timeseries?: { date?: string; value?: number }[];
  /** Qué campo considera esta red su métrica canónica de visibilidad. */
  primary_impressions_field?: string;
  metric_labels?: Record<string, string>;
} & Record<string, unknown>;

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Los motivos vienen en inglés y en jerga de la API. Los dos que aparecen de
 * verdad se traducen a algo accionable; el resto se deja pasar tal cual antes
 * que inventarse un diagnóstico que no tenemos.
 */
function readableReason(message: string): string {
  if (/page_id/i.test(message)) return "Falta indicar qué página de Facebook medir.";
  if (/expired|reconnect|refresh failed/i.test(message)) {
    return "La sesión con esta red caducó. Reconecta la cuenta en Redes.";
  }
  return message;
}

async function call<T>(path: string, cred: Credential, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `ApiKey ${cred.apiKey}`,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    log.error("upload-post call failed", { path, status: response.status, body: text });
    if (response.status === 429) {
      throw new AppError("Se ha alcanzado el límite de publicaciones del plan.", 429);
    }
    throw new AppError("No se pudo contactar con el servicio de publicación.", 502, text);
  }

  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new AppError("Respuesta inesperada del servicio de publicación.", 502, cause);
  }
}

export class UploadPostPublisher implements PublishProvider {
  readonly name = "upload_post";

  /**
   * Crea el perfil si no existe. Idempotente: se puede llamar siempre.
   *
   * El plan gratuito de Upload-Post admite un número limitado de perfiles
   * (`limit` en la respuesta del listado), así que un fallo aquí suele ser haber
   * llegado al tope, no un error transitorio.
   */
  private async ensureProfile(tenantRef: string, cred: Credential): Promise<Profile> {
    const listed = await call<{ profiles?: Profile[]; limit?: number }>(
      "/uploadposts/users",
      cred,
    );

    const existing = listed.profiles?.find((p) => p.username === tenantRef);
    if (existing) return existing;

    if (listed.limit !== undefined && (listed.profiles?.length ?? 0) >= listed.limit) {
      throw new AppError(
        `Has alcanzado el límite de ${listed.limit} perfiles de tu plan de Upload-Post.`,
        402,
      );
    }

    const created = await call<{ profile?: Profile }>("/uploadposts/users", cred, {
      method: "POST",
      body: JSON.stringify({ username: tenantRef }),
    });

    if (!created.profile) throw new AppError("No se pudo crear el perfil de publicación.", 502);
    return created.profile;
  }

  async listAccounts(tenantRef: string, cred: Credential): Promise<ConnectedAccount[]> {
    const listed = await call<{ profiles?: Profile[] }>("/uploadposts/users", cred);
    const profile = listed.profiles?.find((p) => p.username === tenantRef);

    const accounts: ConnectedAccount[] = [];

    for (const [platform, value] of Object.entries(profile?.social_accounts ?? {})) {
      // Cadena vacía = red disponible pero sin conectar. No es una cuenta.
      if (!value) continue;

      const handle =
        typeof value === "string" ? value : (value.handle ?? value.display_name ?? "");
      if (!handle) continue;

      accounts.push({
        platform,
        handle,
        externalRef: `${tenantRef}:${platform}`,
        needsReauth: typeof value === "object" && value.reauth_required === true,
      });
    }

    return accounts;
  }

  /**
   * Métricas de cada red conectada.
   *
   * La API responde un objeto con una entrada por red, y cada una puede fallar
   * por su cuenta. Se traduce a una lista donde el fallo es un campo más
   * (`unavailable`) y no una excepción: si LinkedIn caducó, el cliente sigue
   * teniendo derecho a ver sus números de Instagram.
   */
  async accountMetrics(
    tenantRef: string,
    platforms: string[],
    cred: Credential,
  ): Promise<PlatformMetrics[]> {
    if (platforms.length === 0) return [];

    const query = new URLSearchParams({ platforms: platforms.join(",") });
    const body = await call<Record<string, AnalyticsEntry>>(
      `/analytics/${encodeURIComponent(tenantRef)}?${query}`,
      cred,
    );

    return platforms.map((platform) => {
      const entry = body[platform];

      if (!entry || entry.success === false) {
        return {
          platform,
          followers: null,
          impressions: null,
          impressionsLabel: "",
          likes: null,
          comments: null,
          shares: null,
          timeseries: [],
          unavailable: readableReason(entry?.message ?? "Esta red no devolvió datos."),
        };
      }

      // Cada red nombra distinto su métrica de visibilidad y la propia API
      // dice cuál es la suya. Elegir un campo fijo daría cero en la mitad de
      // las redes, que es peor que no enseñar nada.
      const field = entry.primary_impressions_field ?? "impressions";

      return {
        platform,
        followers: numberOrNull(entry.followers),
        impressions: numberOrNull(entry[field]),
        impressionsLabel: entry.metric_labels?.[field] ?? "Visualizaciones",
        likes: numberOrNull(entry.likes),
        comments: numberOrNull(entry.comments),
        shares: numberOrNull(entry.shares),
        timeseries: (entry.reach_timeseries ?? [])
          .filter((point) => typeof point?.date === "string")
          .map((point) => ({ date: point.date as string, value: point.value ?? 0 })),
      };
    });
  }

  async connectUrl(tenantRef: string, redirectTo: string, cred: Credential): Promise<string> {
    await this.ensureProfile(tenantRef, cred);

    const body = await call<{ access_url?: string }>("/uploadposts/users/generate-jwt", cred, {
      method: "POST",
      body: JSON.stringify({ username: tenantRef, redirect_url: redirectTo }),
    });

    if (!body.access_url) throw new AppError("No se pudo abrir la conexión de cuentas.", 502);
    return body.access_url;
  }

  async publish(
    req: PublishRequest,
    tenantRef: string,
    cred: Credential,
  ): Promise<PublishResult> {
    const form = new FormData();
    form.append("user", tenantRef);
    form.append("platform[]", req.platform);
    form.append("title", req.caption);
    if (req.mediaUrl) {
      form.append(req.mediaKind === "video" ? "video" : "photos[]", req.mediaUrl);
    }
    if (req.scheduledAt) {
      form.append("scheduled_date", req.scheduledAt.toISOString());
    }

    const endpoint =
      req.mediaKind === "video"
        ? "/upload"
        : req.mediaKind === "image"
          ? "/upload_photos"
          : "/upload_text";

    const body = await call<{
      results?: Record<
        string,
        { success?: boolean; post_id?: string; url?: string; error?: string }
      >;
    }>(endpoint, cred, { method: "POST", body: form });

    const result = body.results?.[req.platform];
    if (!result?.success) {
      // El motivo lo da la red, no nuestra infraestructura: es información
      // segura y accionable ("la imagen es demasiado grande", "el token
      // caducó"). Ocultarla detrás de un mensaje genérico deja al usuario sin
      // nada que hacer, y a nosotros sin nada que depurar.
      log.error("la red rechazo la publicacion", {
        platform: req.platform,
        detail: result?.error ?? "(sin detalle)",
        raw: JSON.stringify(body).slice(0, 500),
      });

      throw new AppError(
        result?.error
          ? `${req.platform} rechazó la publicación: ${result.error}`
          : `${req.platform} rechazó la publicación sin dar motivo. Suele ser temporal: reinténtalo.`,
        502,
      );
    }

    return {
      remoteId: result.post_id ?? "unknown",
      remoteUrl: result.url,
      cost: { provider: this.name, units: 1, cents: 0, byok: cred.byok },
    };
  }
}
