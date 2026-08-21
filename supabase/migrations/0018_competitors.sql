-- Seguimiento de competidores. Solo YouTube tiene API oficial y gratuita
-- (channels.list, part=statistics); TikTok/Instagram/LinkedIn no tienen vía
-- sin scrapear —contra sus términos de servicio, y frágil para un producto
-- que corre sin vigilancia sobre cuentas de clientes reales— así que ahí el
-- dato lo mete a mano quien ya lo está mirando en la app oficial de esa red.
-- `source` distingue cuál es cuál para que la interfaz pueda decirlo.
create table competitors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  platform text not null,
  handle text not null,
  display_name text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors (id) on delete cascade,
  -- Denormalizado a propósito: permite filtrar por tenant_id directamente en
  -- RLS sin un subselect a competitors en cada fila.
  tenant_id uuid not null references tenants (id) on delete cascade,
  snapshot_date date not null default current_date,
  followers integer,
  posts_per_week numeric,
  best_format text,
  notes text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  -- Como máximo un punto por día por competidor: reintentar "Actualizar" el
  -- mismo día en YouTube sobrescribe en vez de duplicar la serie.
  unique (competitor_id, snapshot_date)
);

create index competitor_snapshots_lookup on competitor_snapshots (competitor_id, snapshot_date desc);

alter table competitors enable row level security;
alter table competitor_snapshots enable row level security;

-- Igual que posts: cualquier miembro del tenant puede leer y escribir, sin
-- restringir por rol — es una herramienta de trabajo compartida, no algo
-- sensible como las credenciales de redes.
create policy competitors_select on competitors for select
  using (tenant_id in (select private.auth_tenant_ids()));
create policy competitors_insert on competitors for insert
  with check (tenant_id in (select private.auth_tenant_ids()));
create policy competitors_delete on competitors for delete
  using (tenant_id in (select private.auth_tenant_ids()));

create policy competitor_snapshots_select on competitor_snapshots for select
  using (tenant_id in (select private.auth_tenant_ids()));
create policy competitor_snapshots_insert on competitor_snapshots for insert
  with check (tenant_id in (select private.auth_tenant_ids()));
