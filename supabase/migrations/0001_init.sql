-- =============================================================================
-- SocialPanel — esquema inicial multi-tenant
--
-- Regla de oro: NINGUNA tabla es accesible sin RLS. El aislamiento entre
-- tenants se hace en la base de datos, no en el código de la aplicación, de
-- forma que un bug en un endpoint no pueda filtrar datos de otro cliente.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tenants y pertenencia
-- -----------------------------------------------------------------------------
create table tenants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  plan         text not null default 'trial' check (plan in ('trial','starter','pro')),
  -- Presupuesto mensual en céntimos. Corta la generación al superarse.
  budget_cents integer not null default 500 check (budget_cents >= 0),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table memberships (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index on memberships (user_id);

-- Función de pertenencia. SECURITY DEFINER para que las políticas puedan
-- consultarla sin caer en recursión de RLS sobre la propia tabla.
--
-- OJO: 0003_private_helpers.sql las mueve al esquema `private` y borra estas.
-- Estar en `public` las publicaba como /rest/v1/rpc/<nombre>. Si escribes una
-- migración nueva, usa `private.auth_tenant_ids()`.
create or replace function auth_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from memberships where user_id = auth.uid()
$$;

create or replace function auth_has_role(t uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where tenant_id = t and user_id = auth.uid() and role = any(roles)
  )
$$;

-- -----------------------------------------------------------------------------
-- Credenciales BYOK — el cliente trae su propia API key
--
-- El valor va cifrado con AES-256-GCM en la aplicación ANTES de llegar aquí.
-- La base de datos nunca ve el texto plano y ninguna política permite SELECT
-- del ciphertext desde el cliente: solo el service role (backend) lo lee.
-- -----------------------------------------------------------------------------
create table provider_credentials (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  provider    text not null check (provider in ('anthropic','gemini','fal','upload_post')),
  ciphertext  text not null,
  -- Últimos 4 caracteres, solo para que el usuario reconozca la clave en la UI.
  hint        text not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, provider)
);

-- -----------------------------------------------------------------------------
-- Cuentas sociales conectadas (el OAuth real lo gestiona Upload-Post)
-- -----------------------------------------------------------------------------
create table social_accounts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  platform     text not null,
  handle       text,
  external_ref text not null,
  status       text not null default 'active' check (status in ('active','expired','revoked')),
  connected_at timestamptz not null default now(),
  unique (tenant_id, platform, external_ref)
);

-- -----------------------------------------------------------------------------
-- Assets (subidos por el usuario o generados por IA)
-- -----------------------------------------------------------------------------
create table assets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  kind         text not null check (kind in ('image','video')),
  origin       text not null check (origin in ('upload','generated')),
  storage_path text not null,
  mime_type    text not null,
  bytes        bigint not null check (bytes > 0),
  width        integer,
  height       integer,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);

create index on assets (tenant_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Posts y sus destinos
-- -----------------------------------------------------------------------------
create table posts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  status       text not null default 'draft'
               check (status in ('draft','generating','ready','publishing','published','failed')),
  brief        text,
  caption      text,
  hashtags     text[] not null default '{}',
  asset_id     uuid references assets(id) on delete set null,
  scheduled_at timestamptz,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz            -- soft delete: nunca borramos de verdad
);

create index on posts (tenant_id, status, created_at desc);

create table post_targets (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references posts(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  platform     text not null,
  status       text not null default 'pending'
               check (status in ('pending','published','failed','skipped')),
  remote_id    text,
  remote_url   text,
  error        text,
  published_at timestamptz,
  unique (post_id, platform)
);

-- -----------------------------------------------------------------------------
-- Consumo — se mide desde el día uno o nunca sabrás tu margen
-- -----------------------------------------------------------------------------
create table usage_events (
  id          bigserial primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  kind        text not null check (kind in ('llm','image','video','publish')),
  provider    text not null,
  model       text,
  units       numeric not null default 1,
  cost_cents  numeric not null default 0,
  byok        boolean not null default false,
  post_id     uuid references posts(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index on usage_events (tenant_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Auditoría de acciones críticas
-- -----------------------------------------------------------------------------
create table audit_log (
  id         bigserial primary key,
  tenant_id  uuid references tenants(id) on delete set null,
  actor_id   uuid references auth.users(id) on delete set null,
  action     text not null,
  target     text,
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index on audit_log (tenant_id, created_at desc);

-- =============================================================================
-- RLS — activado en TODAS las tablas
-- =============================================================================
alter table tenants              enable row level security;
alter table memberships          enable row level security;
alter table provider_credentials enable row level security;
alter table social_accounts      enable row level security;
alter table assets               enable row level security;
alter table posts                enable row level security;
alter table post_targets         enable row level security;
alter table usage_events         enable row level security;
alter table audit_log            enable row level security;

-- tenants: ves el tuyo; solo owner/admin lo modifican.
create policy tenants_select on tenants for select
  using (id in (select auth_tenant_ids()) and deleted_at is null);
create policy tenants_update on tenants for update
  using (auth_has_role(id, array['owner','admin']))
  with check (auth_has_role(id, array['owner','admin']));

-- memberships: ves las de tus tenants; solo owner/admin gestionan miembros.
create policy memberships_select on memberships for select
  using (tenant_id in (select auth_tenant_ids()));
create policy memberships_write on memberships for all
  using (auth_has_role(tenant_id, array['owner','admin']))
  with check (auth_has_role(tenant_id, array['owner','admin']));

-- provider_credentials: SIN política de SELECT a propósito.
-- El ciphertext solo lo lee el backend con service role. El cliente consulta
-- el "hint" a través de un endpoint, nunca leyendo la tabla.
create policy credentials_insert on provider_credentials for insert
  with check (auth_has_role(tenant_id, array['owner','admin']));
create policy credentials_delete on provider_credentials for delete
  using (auth_has_role(tenant_id, array['owner','admin']));

-- social_accounts
create policy social_select on social_accounts for select
  using (tenant_id in (select auth_tenant_ids()));
create policy social_write on social_accounts for all
  using (auth_has_role(tenant_id, array['owner','admin']))
  with check (auth_has_role(tenant_id, array['owner','admin']));

-- assets
create policy assets_select on assets for select
  using (tenant_id in (select auth_tenant_ids()));
create policy assets_insert on assets for insert
  with check (tenant_id in (select auth_tenant_ids()));

-- posts: el borrado real está prohibido para todo el mundo; se usa deleted_at.
create policy posts_select on posts for select
  using (tenant_id in (select auth_tenant_ids()) and deleted_at is null);
create policy posts_insert on posts for insert
  with check (tenant_id in (select auth_tenant_ids()));
create policy posts_update on posts for update
  using (tenant_id in (select auth_tenant_ids()))
  with check (tenant_id in (select auth_tenant_ids()));

-- post_targets: solo lectura desde el cliente; las escribe el worker.
create policy targets_select on post_targets for select
  using (tenant_id in (select auth_tenant_ids()));

-- usage_events / audit_log: solo lectura, y el log solo para owner/admin.
create policy usage_select on usage_events for select
  using (tenant_id in (select auth_tenant_ids()));
create policy audit_select on audit_log for select
  using (auth_has_role(tenant_id, array['owner','admin']));

-- Las políticas de storage van en 0002_storage.sql: tocan `storage.objects`,
-- que pertenece a otro rol y puede fallar por permisos. Separarlas evita que un
-- error ahí haga rollback de todo el esquema.
