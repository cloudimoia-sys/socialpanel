-- =============================================================================
-- Acceso solo por invitación.
--
-- Hasta ahora `ensure_tenant` daba de alta a cualquiera que se autenticase, con
-- 5 € de presupuesto contra las claves de IA de la plataforma. Con el dominio
-- público y Google activado, eso es una barra libre: cada desconocido cuesta
-- dinero real y consume perfiles de Upload-Post, que van por plan.
--
-- El control va aquí y no en la aplicación porque `ensure_tenant` es el ÚNICO
-- sitio donde nace un tenant, y ya se ejecuta con service_role de forma
-- atómica. Cerrando este embudo no queda ninguna ruta que lo rodee: da igual
-- que el alta venga de Google, del enlace mágico o de un endpoint futuro.
--
-- Ojo con quien YA tiene cuenta: la función sale antes si encuentra membresía,
-- así que los usuarios existentes siguen entrando aunque no estén en la lista.
-- La puerta se cierra solo para altas nuevas.
-- =============================================================================

create table if not exists allowed_signups (
  -- Siempre en minúsculas: Google devuelve el correo tal cual lo escribió el
  -- usuario, y una mayúscula no puede ser la diferencia entre entrar o no.
  email       text primary key check (email = lower(trim(email))),
  note        text,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  claimed_by  uuid references auth.users (id) on delete set null
);

-- Sin políticas: RLS activo y ninguna regla significa que nadie llega desde el
-- cliente. Solo el backend con service_role, que es quien invoca la función.
alter table allowed_signups enable row level security;

-- Quien ya está dentro antes de cerrar la puerta. Sin esto, iniciar sesión con
-- Google crearía un usuario nuevo (distinto del del enlace mágico) que se
-- quedaría fuera de su propia aplicación.
insert into allowed_signups (email, note)
values
  ('cloudimo.ia@gmail.com', 'propietario'),
  ('enlazai2026@gmail.com', 'propietario')
on conflict (email) do nothing;

-- -----------------------------------------------------------------------------

-- Cambia la firma (ahora necesita el correo), así que se retira la versión
-- anterior: dejarla viva sería mantener abierta una puerta sin control.
drop function if exists public.ensure_tenant(uuid, text);

create or replace function public.ensure_tenant(p_user uuid, p_name text, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_email  text := lower(trim(coalesce(p_email, '')));
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));

  select m.tenant_id into v_tenant
  from memberships m
  join tenants t on t.id = m.tenant_id
  where m.user_id = p_user and t.deleted_at is null
  order by m.created_at asc
  limit 1;

  -- Ya tiene cuenta: entra, esté o no en la lista de invitados.
  if v_tenant is not null then
    return v_tenant;
  end if;

  -- Alta nueva: solo si está invitado. Se devuelve null en vez de lanzar para
  -- que la aplicación distinga "no invitado" de "fallo de base de datos" y
  -- pueda enseñar un mensaje útil en lugar de un error genérico.
  if not exists (select 1 from allowed_signups a where a.email = v_email) then
    return null;
  end if;

  insert into tenants (name, plan, budget_cents)
  values (coalesce(nullif(trim(p_name), ''), 'Mi cuenta'), 'trial', 500)
  returning id into v_tenant;

  insert into memberships (tenant_id, user_id, role)
  values (v_tenant, p_user, 'owner');

  -- Deja constancia de qué invitación se usó y quién la consumió.
  update allowed_signups
  set claimed_at = now(), claimed_by = p_user
  where email = v_email and claimed_at is null;

  insert into audit_log (tenant_id, actor_id, action, target)
  values (v_tenant, p_user, 'tenant.created', v_tenant::text);

  return v_tenant;
end;
$$;

revoke all on function public.ensure_tenant(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ensure_tenant(uuid, text, text) to service_role;
