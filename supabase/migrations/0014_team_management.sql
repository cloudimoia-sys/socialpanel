-- =============================================================================
-- Gestión de equipo: cierra una escalada de privilegios en memberships.
--
-- La política actual (memberships_write, en 0003_private_helpers.sql) exige
-- ser owner o admin para escribir, pero no distingue QUÉ rol se está
-- escribiendo. Un admin puede hacer ahora mismo:
--
--   update memberships set role = 'owner' where user_id = auth.uid()
--
-- directamente contra la API REST de Supabase, sin pasar por ninguna pantalla
-- de la aplicación — autoascenderse a propietario del tenant. Se descubrió
-- diseñando la pantalla de Equipo, antes de construir nada encima.
--
-- La corrección va en la política, no solo en el backend de la app: RLS es el
-- límite real, y un control que solo viviera en un endpoint nuestro no
-- protegería frente a quien llame a la REST API de Supabase directamente.
-- =============================================================================

drop policy if exists memberships_write on memberships;

-- USING protege filas ya existentes con role = 'owner': quitar o degradar a
-- un propietario exige ser tú mismo propietario, no solo admin.
-- WITH CHECK protege la fila resultante: convertir a alguien en propietario
-- exige lo mismo. Un admin normal sigue pudiendo gestionar member/admin.
create policy memberships_write on memberships for all
  using (
    case
      when role = 'owner' then private.auth_has_role(tenant_id, array['owner'])
      else private.auth_has_role(tenant_id, array['owner', 'admin'])
    end
  )
  with check (
    case
      when role = 'owner' then private.auth_has_role(tenant_id, array['owner'])
      else private.auth_has_role(tenant_id, array['owner', 'admin'])
    end
  );
