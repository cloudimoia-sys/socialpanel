-- =============================================================================
-- Alta de tenant atómica.
--
-- Antes vivía en la aplicación: SELECT de la membresía y, si no había, INSERT
-- del tenant. Entre esas dos sentencias caben N peticiones concurrentes del
-- mismo usuario, y cada una crea su propio tenant. No es teórico: salieron 110
-- tenants para una sola cuenta en tres minutos.
--
-- La lección general: crear recursos como efecto secundario de una lectura es
-- frágil. Si hay que hacerlo, que sea atómico y en un único viaje a la base.
--
-- Vive en `public` porque PostgREST solo expone ese esquema y la aplicación la
-- invoca por RPC. Lo que la protege no es esconderla, sino que `anon` y
-- `authenticated` no tienen EXECUTE: solo el backend con service_role.
-- =============================================================================

create or replace function public.ensure_tenant(p_user uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));

  select m.tenant_id into v_tenant
  from memberships m
  join tenants t on t.id = m.tenant_id
  where m.user_id = p_user and t.deleted_at is null
  order by m.created_at asc
  limit 1;

  if v_tenant is not null then
    return v_tenant;
  end if;

  insert into tenants (name, plan, budget_cents)
  values (coalesce(nullif(trim(p_name), ''), 'Mi cuenta'), 'trial', 500)
  returning id into v_tenant;

  insert into memberships (tenant_id, user_id, role)
  values (v_tenant, p_user, 'owner');

  insert into audit_log (tenant_id, actor_id, action, target)
  values (v_tenant, p_user, 'tenant.created', v_tenant::text);

  return v_tenant;
end;
$$;

revoke all on function public.ensure_tenant(uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_tenant(uuid, text) to service_role;
