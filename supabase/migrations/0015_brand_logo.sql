-- =============================================================================
-- Logo del negocio, enlazado a un asset ya subido y validado.
--
-- No se guarda la imagen aquí: `logo_asset_id` apunta a `assets`, que ya
-- tiene su propia validación por bytes reales (magic numbers) y su propia
-- URL firmada de Storage. Duplicar eso en brand_profiles sería mantener dos
-- copias de la misma verdad.
-- =============================================================================

alter table brand_profiles
  add column if not exists logo_asset_id uuid references assets (id) on delete set null;
