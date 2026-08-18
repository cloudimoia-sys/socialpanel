-- =============================================================================
-- Memoria de marca y planes de contenido.
--
-- Esto es lo que separa el producto de un publicador como Upload-Post: no
-- genera "un post", genera contenido de UN negocio concreto, y propone un
-- calendario en vez de esperar a que se le ocurra algo al usuario.
--
--  - brand_profiles     contexto persistente del cliente (voz, oferta, vetos)
--  - content_plans      lote de ideas para un periodo
--  - content_plan_items cada idea, revisable y convertible en post
-- =============================================================================

create table brand_profiles (
  tenant_id     uuid primary key references tenants(id) on delete cascade,
  business_name text not null,
  business_type text not null,
  description   text not null default '',
  audience      text not null default '',
  tone          text not null default '',
  language      text not null default 'es',
  offerings     text not null default '',
  keywords      text[] not null default '{}',
  -- Lo que NUNCA debe decir. Tan importante como lo que sí: aquí van las
  -- promesas que el negocio no puede hacer legalmente y los tópicos vetados.
  avoid         text not null default '',
  website       text,
  updated_at    timestamptz not null default now()
);

create table content_plans (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  period_start date not null,
  period_end   date not null,
  status       text not null default 'draft' check (status in ('draft','active','archived')),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index on content_plans (tenant_id, created_at desc);

create table content_plan_items (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             uuid not null references content_plans(id) on delete cascade,
  tenant_id           uuid not null references tenants(id) on delete cascade,
  idea                text not null,
  rationale           text not null default '',
  suggested_platforms text[] not null default '{}',
  suggested_media     text not null default 'none' check (suggested_media in ('none','image','video')),
  scheduled_for       date,
  position            integer not null default 0,
  status              text not null default 'idea' check (status in ('idea','approved','dismissed','created')),
  post_id             uuid references posts(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index on content_plan_items (plan_id, position);
create index on content_plan_items (tenant_id, status);

alter table brand_profiles     enable row level security;
alter table content_plans      enable row level security;
alter table content_plan_items enable row level security;

create policy brand_select on brand_profiles for select
  using (tenant_id in (select private.auth_tenant_ids()));
create policy brand_write on brand_profiles for all
  using (private.auth_has_role(tenant_id, array['owner','admin']))
  with check (private.auth_has_role(tenant_id, array['owner','admin']));

create policy plans_select on content_plans for select
  using (tenant_id in (select private.auth_tenant_ids()));
create policy plans_write on content_plans for all
  using (private.auth_has_role(tenant_id, array['owner','admin']))
  with check (private.auth_has_role(tenant_id, array['owner','admin']));

create policy plan_items_select on content_plan_items for select
  using (tenant_id in (select private.auth_tenant_ids()));
create policy plan_items_write on content_plan_items for all
  using (private.auth_has_role(tenant_id, array['owner','admin']))
  with check (private.auth_has_role(tenant_id, array['owner','admin']));
