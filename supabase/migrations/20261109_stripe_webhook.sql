-- Webhook de Stripe: facturas, estado de las suscripciones y modo consulta por impago.
--
-- La función stripe-webhook guarda aquí cada factura que Stripe emite o cambia, y actualiza empresas.suscripcion_estado.
-- Una empresa pasa a modo consulta (puede ver el mapa, la flota y los informes, pero no enviar rutas) cuando tiene
-- una factura pendiente que venció hace más de 7 días (condiciones, apartado 7). Al pagarla, vuelve a la normalidad.

create table if not exists public.stripe_facturas (
  id text primary key,                         -- in_… de Stripe
  empresa_id uuid references public.empresas(id) on delete cascade,
  customer text,
  suscripcion text,
  numero text,
  estado text not null,                        -- draft, open, paid, void, uncollectible
  total numeric(12,2),                         -- en euros, con IVA
  vence timestamptz,
  url text,
  creada timestamptz,
  actualizado timestamptz not null default now()
);
create index if not exists stripe_facturas_empresa on public.stripe_facturas (empresa_id, estado);
alter table public.stripe_facturas enable row level security;
drop policy if exists "ver facturas de mi empresa" on public.stripe_facturas;
create policy "ver facturas de mi empresa" on public.stripe_facturas for select to authenticated
  using (empresa_id = (select privado.mi_empresa()));

-- Registro de eventos recibidos (para no procesar dos veces el mismo y para revisar errores). Se guardan 90 días.
create table if not exists public.stripe_eventos (
  id text primary key,                         -- evt_… de Stripe
  tipo text not null,
  objeto text,
  recibido timestamptz not null default now(),
  error text
);
alter table public.stripe_eventos enable row level security;   -- sin políticas: solo el servidor

-- ¿Está la empresa en modo consulta por una factura vencida hace más de 7 días?
create or replace function privado.en_consulta(emp uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.stripe_facturas f
    where f.empresa_id = emp and f.estado = 'open' and f.vence < now() - interval '7 days'
  );
$$;
revoke all on function privado.en_consulta(uuid) from public, anon;
grant execute on function privado.en_consulta(uuid) to authenticated;

-- Lo que la app necesita saber de la cuenta de quien ha entrado
create or replace function public.estado_cuenta() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'consulta', privado.en_consulta(privado.mi_empresa()),
    'vencidas', coalesce((
      select jsonb_agg(jsonb_build_object('numero', f.numero, 'total', f.total, 'vence', f.vence, 'url', f.url) order by f.vence)
      from public.stripe_facturas f
      where f.empresa_id = privado.mi_empresa() and f.estado = 'open' and f.vence < now()
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.estado_cuenta() from public, anon;
grant execute on function public.estado_cuenta() to authenticated;

-- En modo consulta no se pueden registrar rutas nuevas
drop policy if exists "registrar envios de mi empresa" on public.envios;
create policy "registrar envios de mi empresa" on public.envios for insert to authenticated
  with check (
    empresa_id = (select privado.mi_empresa())
    and usuario_id = (select auth.uid())
    and not (select privado.en_consulta(privado.mi_empresa()))
  );

-- (migración estado_cuenta_invoker) estado_cuenta() no necesita privilegios propios:
-- las facturas ya se leen con la política de stripe_facturas
alter function public.estado_cuenta() security invoker;
