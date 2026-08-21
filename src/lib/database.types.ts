/**
 * Tipos de la base de datos.
 *
 * Escrito a mano para arrancar. En cuanto el esquema se mueva, regenéralo:
 *
 *   npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts
 *
 * Mantenerlo tipado no es cosmético: es lo que hace que un `select` con un
 * campo mal escrito o un insert incompleto salte en compilación.
 *
 * Nota: todo son `type` y no `interface` a propósito. Supabase exige que cada
 * fila encaje en `Record<string, unknown>`, y las interfaces no tienen índice
 * implícito: con `interface` todas las tablas se resuelven a `never`.
 */

type Timestamptz = string;

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Tenant = {
  id: string;
  name: string;
  plan: "trial" | "starter" | "pro";
  budget_cents: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_status: "none" | "trialing" | "active" | "past_due" | "canceled";
  current_period_end: Timestamptz | null;
  created_at: Timestamptz;
  deleted_at: Timestamptz | null;
};

export type ProcessedWebhook = {
  id: string;
  source: string;
  processed_at: Timestamptz;
};

export type Membership = {
  tenant_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  created_at: Timestamptz;
};

export type ProviderCredential = {
  id: string;
  tenant_id: string;
  provider: "anthropic" | "gemini" | "fal" | "upload_post" | "cloudflare";
  ciphertext: string;
  hint: string;
  created_at: Timestamptz;
};

export type SocialAccount = {
  id: string;
  tenant_id: string;
  platform: string;
  handle: string | null;
  external_ref: string;
  status: "active" | "expired" | "revoked";
  connected_at: Timestamptz;
};

export type Asset = {
  id: string;
  tenant_id: string;
  kind: "image" | "video";
  origin: "upload" | "generated";
  storage_path: string;
  mime_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  created_at: Timestamptz;
};

export type Post = {
  id: string;
  tenant_id: string;
  created_by: string | null;
  status:
    | "draft"
    | "generating"
    | "ready"
    | "scheduled"
    | "publishing"
    | "published"
    | "failed";
  scheduled_platforms: string[];
  brief: string | null;
  caption: string | null;
  hashtags: string[];
  asset_id: string | null;
  scheduled_at: Timestamptz | null;
  error: string | null;
  /** Presente solo si el post se creó a partir de una noticia elegida a mano. */
  source_url: string | null;
  source_title: string | null;
  /** Marcado a mano por el operador para encontrarlo rápido. */
  is_favorite: boolean;
  /** Funcionó bien y merece reutilizarse. Ver 0013_library_and_slots.sql. */
  is_winner: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
  deleted_at: Timestamptz | null;
};

/**
 * Rejilla semanal de publicación por red.
 *
 * `at_time` es hora local del negocio sin zona: un hueco recurrente es un
 * acuerdo de reloj de pared y guardarlo en UTC lo desplazaría al cambiar la
 * hora. Ver 0013_library_and_slots.sql.
 */
export type PublishSlot = {
  id: string;
  tenant_id: string;
  platform: string;
  /** 0 = domingo … 6 = sábado, igual que `Date.getDay()`. */
  weekday: number;
  /** "HH:MM:SS" */
  at_time: string;
  created_at: Timestamptz;
};

export type PostTarget = {
  id: string;
  post_id: string;
  tenant_id: string;
  platform: string;
  /**
   * `unknown` = la petición salió pero la respuesta no confirma el resultado.
   * Reintentar puede duplicar. Distinto de `failed`, que sí es seguro repetir.
   */
  status: "pending" | "published" | "failed" | "skipped" | "unknown";
  remote_id: string | null;
  remote_url: string | null;
  error: string | null;
  published_at: Timestamptz | null;
};

export type UsageEvent = {
  id: number;
  tenant_id: string;
  kind: "llm" | "image" | "video" | "publish";
  provider: string;
  model: string | null;
  units: number;
  cost_cents: number;
  byok: boolean;
  post_id: string | null;
  created_at: Timestamptz;
};

export type MetricSnapshot = {
  id: string;
  tenant_id: string;
  platform: string;
  snapshot_date: string;
  followers: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  created_at: Timestamptz;
};

export type BrandProfile = {
  tenant_id: string;
  business_name: string;
  business_type: string;
  description: string;
  audience: string;
  tone: string;
  language: string;
  offerings: string;
  keywords: string[];
  avoid: string;
  website: string | null;
  accent_color: string;
  text_color: string;
  font_family: string;
  logo_asset_id: string | null;
  primary_platform: string | null;
  timezone: string;
  publish_hour: number;
  news_topics: string[];
  updated_at: Timestamptz;
};

export type ContentPlan = {
  id: string;
  tenant_id: string;
  title: string;
  period_start: string;
  period_end: string;
  status: "draft" | "active" | "archived";
  created_by: string | null;
  created_at: Timestamptz;
};

export type ContentPlanItem = {
  id: string;
  plan_id: string;
  tenant_id: string;
  idea: string;
  headline: string;
  rationale: string;
  visual_prompt: string;
  suggested_platforms: string[];
  suggested_media: "none" | "image" | "video";
  scheduled_for: string | null;
  source_url: string | null;
  source_title: string | null;
  position: number;
  status: "idea" | "approved" | "dismissed" | "created";
  post_id: string | null;
  created_at: Timestamptz;
};

export type AuditLog = {
  id: number;
  tenant_id: string | null;
  actor_id: string | null;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
  created_at: Timestamptz;
};

/** Lista de correos con permiso para darse de alta. Ver 0012_invite_only.sql. */
export type AllowedSignup = {
  email: string;
  note: string | null;
  created_at: Timestamptz;
  claimed_at: Timestamptz | null;
  claimed_by: string | null;
};

export type Database = {
  public: {
    Tables: {
      allowed_signups: Table<AllowedSignup, Pick<AllowedSignup, "email"> & Partial<AllowedSignup>>;
      publish_slots: Table<
        PublishSlot,
        Pick<PublishSlot, "tenant_id" | "platform" | "weekday" | "at_time"> & Partial<PublishSlot>
      >;
      tenants: Table<Tenant, Pick<Tenant, "name"> & Partial<Tenant>>;
      memberships: Table<Membership, Omit<Membership, "created_at"> & Partial<Membership>>;
      provider_credentials: Table<
        ProviderCredential,
        Omit<ProviderCredential, "id" | "created_at"> & Partial<ProviderCredential>
      >;
      social_accounts: Table<
        SocialAccount,
        Omit<SocialAccount, "id" | "connected_at"> & Partial<SocialAccount>
      >;
      assets: Table<
        Asset,
        Omit<Asset, "id" | "created_at" | "width" | "height" | "duration_ms"> & Partial<Asset>
      >;
      posts: Table<Post, Pick<Post, "tenant_id"> & Partial<Post>>;
      post_targets: Table<
        PostTarget,
        Omit<PostTarget, "id" | "remote_id" | "remote_url" | "error" | "published_at" | "status"> &
          Partial<PostTarget>
      >;
      usage_events: Table<UsageEvent, Omit<UsageEvent, "id" | "created_at"> & Partial<UsageEvent>>;
      metric_snapshots: Table<
        MetricSnapshot,
        Omit<MetricSnapshot, "id" | "created_at"> & Partial<MetricSnapshot>
      >;
      audit_log: Table<AuditLog, Pick<AuditLog, "action"> & Partial<AuditLog>>;
      processed_webhooks: Table<ProcessedWebhook, Pick<ProcessedWebhook, "id"> & Partial<ProcessedWebhook>>;
      brand_profiles: Table<
        BrandProfile,
        Pick<BrandProfile, "tenant_id" | "business_name" | "business_type"> &
          Partial<BrandProfile>
      >;
      content_plans: Table<
        ContentPlan,
        Pick<ContentPlan, "tenant_id" | "title" | "period_start" | "period_end"> &
          Partial<ContentPlan>
      >;
      content_plan_items: Table<
        ContentPlanItem,
        Pick<ContentPlanItem, "plan_id" | "tenant_id" | "idea"> & Partial<ContentPlanItem>
      >;
    };
    Views: Record<string, never>;
    Functions: {
      ensure_tenant: {
        Args: { p_user: string; p_name: string; p_email: string };
        // `null` no es un fallo: significa que el correo no está invitado y no
        // se ha creado ningún tenant. Ver 0012_invite_only.sql.
        Returns: string | null;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
