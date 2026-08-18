-- =============================================================================
-- Post creado a mano a partir de una noticia elegida por el operador.
--
-- El plan automático (0010_news_content.sql) hace que el modelo elija la
-- noticia entre una lista cerrada. Aquí es al revés: el operador ya sabe qué
-- noticia quiere comentar y pega la URL directamente. El servidor la vuelve a
-- descargar para sacar el titular real (nunca se confía en lo que mande el
-- cliente), así que sigue habiendo una fuente verificada detrás del post.
-- =============================================================================

alter table posts
  add column if not exists source_url   text,
  add column if not exists source_title text;
