-- Cobros con Stripe (opción B: el administrador activa la suscripción desde Administración).
--
-- · empresas: plan, forma de pago y los identificadores de Stripe de cada empresa.
--   - stripe_sub: suscripción principal (mensual por uso, o anual por adelantado).
--   - stripe_sub_uso: suscripción que cobra por el medidor «camiones_en_servicio». En pago mensual es la
--     misma que stripe_sub; en pago anual es una aparte que solo cobra los camiones por encima de los pagados.
-- · stripe_uso: registro de lo que la función enviar-uso le manda cada día al medidor (se guarda 13 meses).
-- · Tarea diaria «enviar-uso» (pg_cron) a las 21:00 UTC (22:00/23:00 en Madrid), antes de que cierre el mes
--   en Stripe (las suscripciones empiezan el día 1 a las 00:00 de Madrid).

alter table public.empresas
  add column if not exists plan text check (plan in ('esencial', 'pro', 'flota')),
  add column if not exists pago text check (pago in ('mensual', 'anual')),
  add column if not exists fundadora boolean not null default false,
  add column if not exists camiones_pagados integer check (camiones_pagados > 0),
  add column if not exists suscripcion_desde date,
  add column if not exists suscripcion_estado text,
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_sub text,
  add column if not exists stripe_sub_uso text,
  add column if not exists facturacion jsonb;   -- { email, direccion, cp, ciudad, forma_pago }

-- Las empresas solo leen su propia fila con las políticas que ya existen; estas columnas
-- las escribe solo el servidor (funciones admin y enviar-uso, con la clave secreta).

create table if not exists public.stripe_uso (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  dia date not null,
  mes date not null,
  maximo integer not null,
  valor integer not null,          -- lo que se manda al medidor (máximo ajustado al mínimo del plan, o exceso)
  enviado timestamptz,
  error text,
  primary key (empresa_id, dia)
);
alter table public.stripe_uso enable row level security;   -- sin políticas: solo el servidor

-- Token con el que pg_cron llama a enviar-uso: se genera aquí, se guarda en Vault y solo su hash queda en ajustes.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'enviar_uso_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'enviar_uso_token',
                                'Token con el que pg_cron llama a la función enviar-uso');
  end if;
end $$;
delete from public.ajustes where clave = 'enviar_uso_token_sha256';
insert into public.ajustes (clave, valor)
select 'enviar_uso_token_sha256', encode(extensions.digest(decrypted_secret, 'sha256'), 'hex')
from vault.decrypted_secrets where name = 'enviar_uso_token';

-- Llama a enviar-uso (la usa la tarea programada; a mano: select public.enviar_uso_ahora();)
create or replace function public.enviar_uso_ahora(p_origen text default 'manual')
returns bigint
language sql
security definer
set search_path = public
as $$
  select net.http_post(
    url := 'https://sqtgnlfsydcecpxtumol.supabase.co/functions/v1/enviar-uso',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-uso-token', (select decrypted_secret from vault.decrypted_secrets where name = 'enviar_uso_token')),
    body := jsonb_build_object('origen', p_origen),
    timeout_milliseconds := 30000
  );
$$;
revoke all on function public.enviar_uso_ahora(text) from public, anon, authenticated;

-- Cada día a las 21:00 UTC
select cron.unschedule('enviar-uso') where exists (select 1 from cron.job where jobname = 'enviar-uso');
select cron.schedule('enviar-uso', '0 21 * * *', $$ select public.enviar_uso_ahora('cron') $$);
