-- Módulo SEO, primera pieza: Google Search Console.
--
-- Es la única fuente de datos SEO que es a la vez oficial, gratuita y sin
-- límite de negociación: da impresiones, clics, CTR y posición media de la
-- web DEL PROPIO CLIENTE. Rastrear posiciones de keywords arbitrarias (lo que
-- vende cualquier herramienta SEO) no lo ofrece ninguna API de Google y solo
-- se consigue con APIs de pago por consulta — por eso va aparte y más tarde.
--
-- A diferencia de las métricas de redes, aquí NO hace falta un cron que
-- guarde un punto al día: Search Console sí deja consultar rangos de fechas
-- pasados, así que el histórico ya lo tiene Google y se le pide cuando hace
-- falta.

-- El refresh token de Google se guarda como una credencial más: cifrado con
-- AES-256-GCM y `tenant_id` como AAD, sin política de SELECT, legible solo
-- por el backend con service_role. Es exactamente el mismo tratamiento que
-- una API key de proveedor, que es lo que es.
alter table provider_credentials
  drop constraint if exists provider_credentials_provider_check;

alter table provider_credentials
  add constraint provider_credentials_provider_check
  check (provider in (
    'anthropic', 'gemini', 'fal', 'upload_post', 'cloudflare', 'google_search_console'
  ));

-- Propiedades de Search Console que el cliente ha elegido seguir. Una cuenta
-- de Google puede tener docenas (cada web, cada subdominio, cada variante
-- http/https), y traerlas todas a las pantallas sería ruido: se elige.
create table seo_sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- Tal cual lo identifica Search Console: "sc-domain:ejemplo.com" para una
  -- propiedad de dominio, o "https://ejemplo.com/" para una de prefijo de
  -- URL. Se guarda literal porque es lo que hay que reenviarle a su API.
  site_url text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, site_url)
);

alter table seo_sites enable row level security;

create policy seo_sites_select on seo_sites for select
  using (tenant_id in (select private.auth_tenant_ids()));
create policy seo_sites_insert on seo_sites for insert
  with check (tenant_id in (select private.auth_tenant_ids()));
create policy seo_sites_delete on seo_sites for delete
  using (tenant_id in (select private.auth_tenant_ids()));
