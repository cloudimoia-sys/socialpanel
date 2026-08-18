/**
 * Las cuatro interfaces sobre las que se apoya todo el producto.
 *
 * Nada fuera de src/providers/ debe importar el SDK de Anthropic, Google, fal
 * ni Upload-Post. Si mañana el vídeo de fal sale más caro que el de otro sitio,
 * se escribe un adaptador nuevo y se cambia una variable de entorno: el resto
 * de la aplicación no se entera.
 *
 * Cada método devuelve `cost` para que el consumo se registre en el mismo sitio
 * donde ocurre, sin tener que acordarse de medirlo aparte.
 */

export interface Cost {
  provider: string;
  model?: string;
  units: number;
  cents: number;
  /** true si se usó la API key del propio cliente (BYOK) y no la nuestra. */
  byok: boolean;
}

export interface Credential {
  apiKey: string;
  byok: boolean;
}

// -----------------------------------------------------------------------------

export interface CaptionRequest {
  brief: string;
  platforms: string[];
  language: string;
  tone?: string;
  /** Descripción del asset adjunto, si lo hay, para que el copy encaje. */
  assetDescription?: string;
  /** Contexto persistente del negocio. Ver `domain/brand.ts`. */
  brand?: string;
  /**
   * Noticia real que el operador eligió a mano (URL pegada en el composer),
   * a diferencia de `PlanRequest.news`, que es una lista que el modelo filtra
   * él solo. Aquí ya no hay que validar cuál usar: solo una, la que trajo el
   * operador, verificada por `providers/news/article.ts` antes de llegar aquí.
   */
  news?: NewsItem;
}

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

export interface PlanRequest {
  brand: string;
  /** Cuántas ideas generar. */
  count: number;
  periodStart: string;
  periodEnd: string;
  platforms: string[];
  language: string;
  /** Notas del operador para esta tanda: campañas, efemérides, novedades. */
  notes?: string;
  /**
   * Noticias reales del sector, de una fuente verificable. El modelo puede
   * comentar UNA de estas en el plan, nunca inventarse una propia: mezclarlas
   * con lo real es el riesgo grande de esta función.
   */
  news?: NewsItem[];
}

export interface PlanIdea {
  idea: string;
  /**
   * Si esta idea comenta una noticia real, la URL exacta que se le pasó en
   * `PlanRequest.news`. El backend la valida contra esa lista: si no coincide,
   * se descarta como comentario de actualidad para no publicar una fuente que
   * nadie verificó.
   */
  sourceUrl?: string;
  /** Menos de 60 caracteres: va superpuesto sobre la imagen. */
  headline: string;
  rationale: string;
  /**
   * Descripción de una FOTOGRAFÍA para el generador de imágenes.
   *
   * Va separada de `idea` a propósito: pasarle la idea de contenido directamente
   * al modelo de imagen produce pósters infográficos llenos de texto falso y
   * logos inventados, porque eso es lo que has pedido literalmente.
   */
  visual: string;
  suggestedPlatforms: string[];
  suggestedMedia: "none" | "image" | "video";
  scheduledFor: string | null;
}

export interface PlanResult {
  ideas: PlanIdea[];
  cost: Cost;
}

export interface CaptionResult {
  caption: string;
  hashtags: string[];
  /** Variante recortada por plataforma cuando el límite de caracteres aprieta. */
  perPlatform: Record<string, string>;
  cost: Cost;
}

export interface LLMProvider {
  readonly name: string;
  generateCaption(req: CaptionRequest, cred: Credential): Promise<CaptionResult>;
  /** Propone un lote de ideas para un periodo, a partir de la marca. */
  generatePlan(req: PlanRequest, cred: Credential): Promise<PlanResult>;
}

// -----------------------------------------------------------------------------

export interface ImageRequest {
  prompt: string;
  /** Imágenes de referencia en base64 — para editar una foto que sube el usuario. */
  references?: { mimeType: string; data: string }[];
  aspectRatio?: "1:1" | "4:5" | "9:16" | "16:9";
}

export interface ImageResult {
  mimeType: string;
  data: Buffer;
  cost: Cost;
}

export interface ImageProvider {
  readonly name: string;
  generateImage(req: ImageRequest, cred: Credential): Promise<ImageResult>;
}

// -----------------------------------------------------------------------------

export interface VideoRequest {
  prompt: string;
  durationSeconds: number;
  aspectRatio: "9:16" | "1:1" | "16:9";
  /** URL pública de la imagen de partida para image-to-video. */
  imageUrl?: string;
}

/** El vídeo tarda minutos: se arranca y se consulta, nunca se espera bloqueando. */
export interface VideoJob {
  externalId: string;
  provider: string;
}

export interface VideoStatus {
  state: "pending" | "done" | "failed";
  url?: string;
  error?: string;
  cost?: Cost;
}

export interface VideoProvider {
  readonly name: string;
  startVideo(req: VideoRequest, cred: Credential): Promise<VideoJob>;
  checkVideo(job: VideoJob, cred: Credential): Promise<VideoStatus>;
}

// -----------------------------------------------------------------------------

export interface PublishRequest {
  platform: string;
  /** Identificador de la cuenta conectada en el proveedor de publicación. */
  accountRef: string;
  caption: string;
  mediaUrl?: string;
  mediaKind?: "image" | "video";
  scheduledAt?: Date;
}

export interface PublishResult {
  remoteId: string;
  remoteUrl?: string;
  cost: Cost;
}

export interface ConnectedAccount {
  platform: string;
  handle: string;
  externalRef: string;
  /** El token caducó: la cuenta figura conectada pero fallará al publicar. */
  needsReauth?: boolean;
}

/**
 * Métricas de una cuenta en una red.
 *
 * Cada red mide cosas distintas y las llama distinto: Instagram da "alcance
 * único", X da "impresiones", TikTok ninguna de las dos. En vez de inventar
 * una media que no significa nada, se normaliza el CONCEPTO (cuánta gente lo
 * vio) y se conserva la etiqueta real de esa red para enseñarla tal cual.
 *
 * Todo campo puede ser `null`: una red que no expone una métrica no es lo
 * mismo que una red que la expone y vale cero, y pintar 0 donde no hay dato
 * es mentir en un panel del que el cliente saca conclusiones.
 */
export interface PlatformMetrics {
  platform: string;
  followers: number | null;
  /** Métrica principal de visibilidad, la que esa red considera canónica. */
  impressions: number | null;
  /** Cómo llama esa red a lo anterior: "Unique Reach", "Impressions"… */
  impressionsLabel: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  /** Serie diaria de la métrica principal, para dibujar la tendencia. */
  timeseries: { date: string; value: number }[];
  /**
   * Motivo por el que esta red no devolvió datos (sesión caducada, falta
   * configurar la página…). Que una red falle no invalida a las demás, así
   * que se informa por red en vez de tumbar la consulta entera.
   */
  unavailable?: string;
}

export interface PublishProvider {
  readonly name: string;
  listAccounts(tenantRef: string, cred: Credential): Promise<ConnectedAccount[]>;
  publish(req: PublishRequest, tenantRef: string, cred: Credential): Promise<PublishResult>;
  /** URL alojada donde el cliente conecta sus redes por OAuth. */
  connectUrl(tenantRef: string, redirectTo: string, cred: Credential): Promise<string>;
  /** Métricas por red de las cuentas conectadas de este tenant. */
  accountMetrics(
    tenantRef: string,
    platforms: string[],
    cred: Credential,
  ): Promise<PlatformMetrics[]>;
}
