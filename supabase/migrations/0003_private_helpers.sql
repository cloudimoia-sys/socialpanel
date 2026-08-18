-- =============================================================================
-- Mueve los helpers de RLS a un esquema no expuesto por la API.
--
-- Motivo: `auth_tenant_ids()` y `auth_has_role()` son SECURITY DEFINER y vivían
-- en `public`, así que PostgREST las publicaba como /rest/v1/rpc/<nombre> y
-- cualquiera podía invocarlas. No filtran nada (solo hablan del propio
-- llamante), pero son maquinaria interna del RLS y no deben ser parte de la
-- superficie pública.
--
-- PostgREST solo expone los esquemas de su configuración (`public`), de modo
-- que en `private` siguen funcionando dentro de las políticas pero dejan de ser
-- alcanzables desde fuera.
--
-- Las políticas se recrean porque dependen de estas funciones y hay que
-- reapuntarlas antes de poder borrar las antiguas.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from anon, authenticated, public;
grant usage on schema private to authenticated, service_role;

create or replace function private.auth_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from memberships where user_id = auth.uid()
$$;

create or replace function private.auth_has_role(t uuid, roles text[])
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

-- Las políticas se evalúan con los privilegios de quien consulta, así que el
-- rol `authenticated` necesita EXECUTE. `anon` no: nunca pasa por aquí.
revoke all on function private.auth_tenant_ids() from public, anon;
revoke all on function private.auth_has_role(uuid, text[]) from public, anon;
grant execute on function private.auth_tenant_ids() to authenticated, service_role;
grant execute on function private.auth_has_role(uuid, text[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Recreación de políticas apuntando a private.*
-- -----------------------------------------------------------------------------

drop policy if exists tenants_select on tenants;
create policy tenants_select on tenants for select
  using (id in (select private.auth_tenant_ids()) and deleted_at is null);

drop policy if exists tenants_update on tenants;
create policy tenants_update on tenants for update
  using (private.auth_has_role(id, array['owner','admin']))
  with check (private.auth_has_role(id, array['owner','admin']));

drop policy if exists memberships_select on memberships;
create policy memberships_select on memberships for select
  using (tenant_id in (select private.auth_tenant_ids()));

drop policy if exists memberships_write on memberships;
create policy memberships_write on memberships for all
  using (private.auth_has_role(tenant_id, array['owner','admin']))
  with check (private.auth_has_role(tenant_id, array['owner','admin']));

drop policy if exists credentials_insert on provider_credentials;
create policy credentials_insert on provider_credentials for insert
  with check (private.auth_has_role(tenant_id, array['owner','admin']));

drop policy if exists credentials_delete on provider_credentials;
create policy credentials_delete on provider_credentials for delete
  using (private.auth_has_role(tenant_id, array['owner','admin']));

drop policy if exists social_select on social_accounts;
create policy social_select on social_accounts for select
  using (tenant_id in (select private.auth_tenant_ids()));

drop policy if exists social_write on social_accounts;
create policy social_write on social_accounts for all
  using (private.auth_has_role(tenant_id, array['owner','admin']))
  with check (private.auth_has_role(tenant_id, array['owner','admin']));

drop policy if exists assets_select on assets;
create policy assets_select on assets for select
  using (tenant_id in (select private.auth_tenant_ids()));

drop policy if exists assets_insert on assets;
create policy assets_insert on assets for insert
  with check (tenant_id in (select private.auth_tenant_ids()));

drop policy if exists posts_select on posts;
create policy posts_select on posts for select
  using (tenant_id in (select private.auth_tenant_ids()) and deleted_at is null);

drop policy if exists posts_insert on posts;
create policy posts_insert on posts for insert
  with check (tenant_id in (select private.auth_tenant_ids()));

drop policy if exists posts_update on posts;
create policy posts_update on posts for update
  using (tenant_id in (select private.auth_tenant_ids()))
  with check (tenant_id in (select private.auth_tenant_ids()));

drop policy if exists targets_select on post_targets;
create policy targets_select on post_targets for select
  using (tenant_id in (select private.auth_tenant_ids()));

drop policy if exists usage_select on usage_events;
create policy usage_select on usage_events for select
  using (tenant_id in (select private.auth_tenant_ids()));

drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select
  using (private.auth_has_role(tenant_id, array['owner','admin']));

-- Storage
drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select private.auth_tenant_ids()::text)
  );

drop policy if exists media_write on storage.objects;
create policy media_write on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select private.auth_tenant_ids()::text)
  );

drop policy if exists media_update on storage.objects;
create policy media_update on storage.objects for update
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select private.auth_tenant_ids()::text)
  );

drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select private.auth_tenant_ids()::text)
  );

-- Ya sin dependencias: fuera de la superficie pública.
drop function if exists public.auth_tenant_ids();
drop function if exists public.auth_has_role(uuid, text[]);
