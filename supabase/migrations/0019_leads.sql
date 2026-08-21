-- Social CRM: de "alguien escribió interesado" a un lead con estado, en vez
-- de que ese mensaje se pierda en el hilo del inbox. `value_cents` es
-- opcional y deliberadamente amplio (nadie lo rellena al crear el lead,
-- normalmente): deja el terreno preparado para el ROI de redes (Redes →
-- Leads → Clientes → Facturación) sin otra migración cuando llegue ese punto.
create table leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text,
  platform text,
  handle text,
  message text,
  company text,
  status text not null default 'nuevo'
    check (status in ('nuevo', 'contactado', 'presupuesto', 'ganado', 'perdido')),
  value_cents integer,
  -- 'inbox' cuando nace de una conversación real (un clic sobre un mensaje
  -- de Mensajes, no una IA clasificando en segundo plano: detectar intención
  -- mal sobre un mensaje real, en un cliente de pago, cuesta más credibilidad
  -- de la que ahorra automatizarlo). 'manual' para leads que llegan por
  -- teléfono, en persona o un comentario, no por DM.
  source text not null default 'manual' check (source in ('manual', 'inbox')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_tenant_status on leads (tenant_id, status);

alter table leads enable row level security;

-- Igual que posts/competitors: cualquier miembro del tenant lee y escribe,
-- sin restringir por rol — es una herramienta de trabajo compartida.
create policy leads_select on leads for select
  using (tenant_id in (select private.auth_tenant_ids()));
create policy leads_insert on leads for insert
  with check (tenant_id in (select private.auth_tenant_ids()));
create policy leads_update on leads for update
  using (tenant_id in (select private.auth_tenant_ids()))
  with check (tenant_id in (select private.auth_tenant_ids()));
create policy leads_delete on leads for delete
  using (tenant_id in (select private.auth_tenant_ids()));
