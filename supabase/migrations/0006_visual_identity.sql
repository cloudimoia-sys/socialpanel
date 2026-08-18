-- =============================================================================
-- Identidad visual de la marca y prompt fotográfico de las ideas.
--
-- `visual_prompt` va separado de `idea` porque son cosas distintas: la idea
-- alimenta el copy, el visual alimenta el generador de imágenes. Pasarle la
-- idea al modelo de imagen produce pósters infográficos con texto y logos
-- inventados — es literalmente lo que se le está pidiendo.
--
-- Los colores y la fuente permiten que el compositor genere piezas coherentes
-- entre sí, que es lo que ningún modelo de imagen puede garantizar.
-- =============================================================================

alter table content_plan_items
  add column if not exists visual_prompt text not null default '',
  -- Titular corto (<60 car.) para superponer sobre la imagen. La idea completa
  -- no cabe: al ajustarse encogería tanto que dejaría de leerse de un vistazo.
  add column if not exists headline text not null default '';

alter table brand_profiles
  add column if not exists accent_color text not null default '#1B5FA9',
  add column if not exists text_color   text not null default '#FFFFFF',
  add column if not exists font_family  text not null default 'Poppins-Bold';
