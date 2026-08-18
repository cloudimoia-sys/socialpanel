-- =============================================================================
-- Storage: acceso al bucket privado `media`.
--
-- El bucket se crea con la API de Storage (ver README), no con un INSERT en
-- storage.buckets: el insert directo falla en proyectos donde ese esquema
-- pertenece a supabase_storage_admin.
--
-- Regla: la primera carpeta de la ruta es el tenant_id, así que un usuario solo
-- alcanza `media/<su_tenant_id>/...`. Requiere 0001_init.sql aplicado, porque
-- usa la función auth_tenant_ids().
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do update set public = false;

drop policy if exists media_read on storage.objects;
drop policy if exists media_write on storage.objects;
drop policy if exists media_update on storage.objects;
drop policy if exists media_delete on storage.objects;

create policy media_read on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select auth_tenant_ids()::text)
  );

create policy media_write on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select auth_tenant_ids()::text)
  );

create policy media_update on storage.objects for update
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select auth_tenant_ids()::text)
  );

create policy media_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select auth_tenant_ids()::text)
  );
