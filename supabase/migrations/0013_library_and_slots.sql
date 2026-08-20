-- =============================================================================
-- Biblioteca de contenido y huecos de publicación.
--
-- Los dos cambios que necesitan las pantallas de Contenido y Cola. Van juntos
-- a propósito: es la única migración de toda la fase visible, y agruparlas
-- evita interrumpir el trabajo de interfaz a mitad para pedir otro SQL.
-- =============================================================================

-- --------------------------------------------------------------- biblioteca --

-- Dos banderas y no una columna de "etiquetas": se filtra por ellas
-- constantemente y un array obliga a recorrerlo en cada consulta.
--
-- `is_winner` lo marca hoy el operador a mano. Cuando exista el motor de
-- automatizaciones será él quien lo ponga al superarse un umbral de
-- interacción — por eso es un dato guardado y no algo calculado al vuelo:
-- que algo funcionara en su momento no deja de ser cierto porque las
-- métricas de hoy sean otras.
alter table posts
  add column if not exists is_favorite boolean not null default false,
  add column if not exists is_winner   boolean not null default false;

-- Índices parciales: solo indexan las filas marcadas, que son una minoría.
-- Un índice completo sobre un booleano casi siempre falso no lo usaría el
-- planificador y ocuparía sitio para nada.
create index if not exists posts_favorite_idx
  on posts (tenant_id, created_at desc) where is_favorite and deleted_at is null;

create index if not exists posts_winner_idx
  on posts (tenant_id, created_at desc) where is_winner and deleted_at is null;

-- ------------------------------------------------------------------ huecos --

-- Rejilla semanal de publicación por red: "los lunes a las 18:00 toca
-- Instagram". Es lo que permite a la Cola decir cuál es el próximo hueco
-- libre en vez de obligar a elegir fecha y hora a mano cada vez.
create table if not exists publish_slots (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants (id) on delete cascade,
  platform   text not null,

  -- 0 = domingo … 6 = sábado. Coincide con `Date.getDay()` de JavaScript y con
  -- `extract(dow)` de Postgres: cualquier otra convención obligaría a convertir
  -- en los dos lados, y ahí es donde se cuelan los errores de un día. La
  -- interfaz los ordena empezando en lunes, que es lo que se espera aquí.
  weekday    smallint not null check (weekday between 0 and 6),

  -- Hora LOCAL del negocio, sin zona, a propósito. Un hueco recurrente es un
  -- acuerdo de reloj de pared: "los lunes a las 18:00" significa las 18:00
  -- también cuando cambia la hora. Guardarlo en UTC lo desplazaría una hora
  -- dos veces al año. La zona sale de brand_profiles.timezone al calcular la
  -- fecha concreta, igual que ya hace domain/schedule.ts.
  at_time    time not null,

  created_at timestamptz not null default now(),

  unique (tenant_id, platform, weekday, at_time)
);

create index if not exists publish_slots_tenant_idx on publish_slots (tenant_id, platform);

alter table publish_slots enable row level security;

-- Mismo patrón que el resto: cualquiera del tenant los ve, solo owner/admin
-- los cambia. Los helpers viven en `private` porque en `public` PostgREST los
-- publicaría como endpoint.
create policy publish_slots_select on publish_slots for select
  using (tenant_id in (select private.auth_tenant_ids()));

create policy publish_slots_write on publish_slots for all
  using (private.auth_has_role(tenant_id, array['owner', 'admin']))
  with check (private.auth_has_role(tenant_id, array['owner', 'admin']));
