-- =============================================================================
-- Contenido de actualidad, anclado a noticias reales.
--
-- Por qué no dejar que el modelo "recuerde" novedades del sector: preguntarle
-- directamente qué hay de nuevo produce alucinaciones, y publicar una noticia
-- inventada con la marca de un cliente es de los peores fallos posibles aquí.
--
-- En su lugar: se buscan artículos reales (Google News RSS, gratis y sin
-- clave) sobre los temas que define la marca, se le dan al modelo como lista
-- cerrada, y se le prohíbe citar cualquier URL que no esté en esa lista. El
-- parseo valida la URL devuelta contra la lista real antes de guardarla.
-- =============================================================================

alter table brand_profiles
  add column if not exists news_topics text[] not null default '{}';

alter table content_plan_items
  add column if not exists source_url   text,
  add column if not exists source_title text;
