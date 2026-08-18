-- =============================================================================
-- Suscripciones y control de gasto para auto-servicio.
--
-- El auto-servicio no significa dejar de vigilar el uso: significa construir
-- los topes por adelantado para no tener que vigilarlo. Sin cuotas, cualquiera
-- que se registre gasta nuestras claves de API sin límite.
--
-- El plan y su estado los escribe SOLO el webhook de Stripe con la clave de
-- servicio. Si el cliente pudiera tocar su propio plan, el auto-servicio sería
-- auto-regalo.
-- =============================================================================

alter table tenants
  add column if not exists stripe_customer_id     text unique,
  add column if not exists stripe_subscription_id text unique,
  add column if not exists plan_status            text not null default 'none'
    check (plan_status in ('none','trialing','active','past_due','canceled')),
  add column if not exists current_period_end     timestamptz;

create index if not exists tenants_stripe_customer_idx on tenants (stripe_customer_id);

-- Stripe reintenta los webhooks ante cualquier duda de entrega. Sin registro
-- de lo ya procesado, un reintento duplicaría el cambio de plan — es el mismo
-- error de idempotencia que ya nos costó tres publicaciones en Instagram.
create table if not exists processed_webhooks (
  id           text primary key,
  source       text not null default 'stripe',
  processed_at timestamptz not null default now()
);

alter table processed_webhooks enable row level security;
-- Sin políticas a propósito: solo el backend con service_role la toca.
