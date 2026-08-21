-- Invitar a alguien nuevo al equipo de un tenant (no confundir con
-- allowed_signups, que es la puerta de la PLATAFORMA para crear un tenant
-- propio). Antes de esto no existía ninguna vía: ensure_tenant() siempre
-- creaba un tenant nuevo para cualquier alta, así que ni siquiera dar de alta
-- manualmente una fila en memberships servía para un usuario que aún no
-- existía.
create table team_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  email text not null check (email = lower(trim(email))),
  -- Nunca 'owner': una invitación no puede fabricar un segundo propietario,
  -- mismo límite que ya impone memberships_write (0014_team_management.sql).
  role text not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null
);

-- Único índice parcial (no una unique() de tabla): permite reinvitar a
-- alguien después de que una invitación anterior ya se aceptase o se borrase,
-- solo bloquea tener DOS invitaciones pendientes a la vez a la misma persona.
create unique index team_invitations_pending_uniq
  on team_invitations (tenant_id, email)
  where accepted_at is null;

alter table team_invitations enable row level security;

-- Mismo nivel que memberships_write: solo owner/admin del tenant.
create policy team_invitations_select on team_invitations for select
  using (private.auth_has_role(tenant_id, array['owner', 'admin']));
create policy team_invitations_insert on team_invitations for insert
  with check (private.auth_has_role(tenant_id, array['owner', 'admin']));
create policy team_invitations_delete on team_invitations for delete
  using (private.auth_has_role(tenant_id, array['owner', 'admin']));

-- -----------------------------------------------------------------------------
-- ensure_tenant(): procesa invitaciones de equipo pendientes antes de decidir
-- qué tenant devolver. Se mantiene el resto de la función intacta (mismo
-- candado pg_advisory_xact_lock que ya evitó la condición de carrera que creó
-- 110 tenants para una cuenta) — solo se añade el bloque de invitaciones
-- entre "ya tiene membresía" y "está en allowed_signups".
-- -----------------------------------------------------------------------------
create or replace function public.ensure_tenant(p_user uuid, p_name text, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_invite record;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));

  select m.tenant_id into v_tenant
  from memberships m
  join tenants t on t.id = m.tenant_id
  where m.user_id = p_user and t.deleted_at is null
  order by m.created_at asc
  limit 1;

  -- Cualquier invitación de equipo pendiente para este correo se acepta aquí,
  -- tenga o no ya el usuario un tenant propio: puede pertenecer a varios (el
  -- selector de cuenta ya existe para moverse entre ellos). Se procesa ANTES
  -- de decidir qué devolver porque si es un alta nueva sin cuenta todavía, la
  -- invitación debe unirlo a ESE tenant en vez de crearle uno propio.
  for v_invite in
    select ti.id, ti.tenant_id, ti.role
    from team_invitations ti
    join tenants t on t.id = ti.tenant_id and t.deleted_at is null
    where ti.email = v_email and ti.accepted_at is null
  loop
    insert into memberships (tenant_id, user_id, role)
    values (v_invite.tenant_id, p_user, v_invite.role)
    on conflict (tenant_id, user_id) do nothing;

    update team_invitations
    set accepted_at = now(), accepted_by = p_user
    where id = v_invite.id;

    if v_tenant is null then
      v_tenant := v_invite.tenant_id;
    end if;
  end loop;

  -- Ya tiene tenant (propio o recién unido por invitación): entra.
  if v_tenant is not null then
    return v_tenant;
  end if;

  -- Alta nueva sin invitación de equipo: solo si está en la lista de la
  -- plataforma. Se devuelve null en vez de lanzar para que la aplicación
  -- distinga "no invitado" de "fallo de base de datos".
  if not exists (select 1 from allowed_signups a where a.email = v_email) then
    return null;
  end if;

  insert into tenants (name, plan, budget_cents)
  values (coalesce(nullif(trim(p_name), ''), 'Mi cuenta'), 'trial', 500)
  returning id into v_tenant;

  insert into memberships (tenant_id, user_id, role)
  values (v_tenant, p_user, 'owner');

  update allowed_signups
  set claimed_at = now(), claimed_by = p_user
  where email = v_email and claimed_at is null;

  insert into audit_log (tenant_id, actor_id, action, target)
  values (v_tenant, p_user, 'tenant.created', v_tenant::text);

  return v_tenant;
end;
$$;
