-- Red de referencia para el Panel: sin esto, un KPI de "alcance" tendría que
-- sumar o promediar entre redes que miden cosas distintas (alcance real,
-- reproducciones, impresiones…), lo que da un número que no significa nada.
-- Se guarda una sola red elegida por el tenant y se muestra su dato real, sin
-- mezclar.
alter table brand_profiles
  add column if not exists primary_platform text;
