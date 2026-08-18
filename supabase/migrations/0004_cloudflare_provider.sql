-- =============================================================================
-- Añade 'cloudflare' a los proveedores admitidos en provider_credentials.
--
-- Cloudflare Workers AI es el generador de imágenes del perfil gratuito. Sin
-- esto, un cliente no puede guardar su propia clave de Cloudflare (BYOK): la
-- restricción CHECK rechaza el insert.
--
-- Leer no se ve afectado: una consulta por un proveedor que no existe
-- simplemente no devuelve filas y el registry cae a la clave de plataforma.
-- =============================================================================

alter table provider_credentials
  drop constraint if exists provider_credentials_provider_check;

alter table provider_credentials
  add constraint provider_credentials_provider_check
  check (provider in ('anthropic', 'gemini', 'fal', 'upload_post', 'cloudflare'));
