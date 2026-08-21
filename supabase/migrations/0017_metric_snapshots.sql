-- Histórico de métricas: hoy solo se consulta la API de Upload-Post al vuelo,
-- que da un total móvil de "últimos 30 días" pero no deja preguntar por una
-- ventana pasada. Sin guardar un punto por día no hay forma de saber qué
-- valía esa misma métrica hace 30 días, así que cualquier "▲ 8%" sería
-- inventado. Un snapshot diario por tenant/red es lo mínimo para poder
-- comparar de verdad más adelante.
create table metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  platform text not null,
  snapshot_date date not null,
  followers integer,
  impressions integer,
  likes integer,
  comments integer,
  shares integer,
  created_at timestamptz not null default now(),
  -- Un punto por tenant/red/día: si el cron corriera dos veces el mismo día
  -- (reintento, dos regiones), se sobrescribe en vez de duplicar la serie.
  unique (tenant_id, platform, snapshot_date)
);

create index metric_snapshots_lookup on metric_snapshots (tenant_id, platform, snapshot_date desc);

alter table metric_snapshots enable row level security;

-- Solo lectura para quien pertenece al tenant. Sin política de escritura a
-- propósito: el cron escribe con service_role (que salta RLS), y no hay
-- motivo para que un cliente pueda insertar o alterar su propio histórico —
-- sería tan fácil de falsear como el propio Social Score.
create policy metric_snapshots_select on metric_snapshots for select
  using (tenant_id in (select private.auth_tenant_ids()));
