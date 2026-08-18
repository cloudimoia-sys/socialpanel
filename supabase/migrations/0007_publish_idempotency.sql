-- =============================================================================
-- Estado `unknown` para destinos de publicación.
--
-- Motivo real: Upload-Post devolvió `success: false` para Instagram en dos
-- intentos y, sin embargo, Instagram publicó las dos veces. La interfaz decía
-- "falló", el usuario reintentó, y acabaron tres copias del mismo post.
--
-- La lección: para una acción irreversible y pública, una respuesta ambigua
-- significa "no lo sé", nunca "no ocurrió". `failed` invita a reintentar;
-- `unknown` obliga a comprobar primero.
-- =============================================================================

alter table post_targets
  drop constraint if exists post_targets_status_check;

alter table post_targets
  add constraint post_targets_status_check
  check (status in ('pending', 'published', 'failed', 'skipped', 'unknown'));
