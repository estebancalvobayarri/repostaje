-- La lectura del buzón de precios pasa de GitHub Actions a Supabase:
-- pg_cron llama cada 5 minutos a la función leer-buzon.

create extension if not exists pg_cron;

-- Registro de cada pasada por el buzón (se guardan 7 días)
create table if not exists public.buzon_ejecuciones (
  id bigserial primary key,
  inicio timestamptz not null default now(),
  fin timestamptz,
  origen text,
  resumen jsonb,
  log text,
  error text
);
alter table public.buzon_ejecuciones enable row level security;   -- solo la usa la función (service_role)

-- Apunta una ejecución nueva, salvo que haya otra en marcha desde hace menos de 4 minutos (entonces devuelve null)
create or replace function public.buzon_empezar(p_origen text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  nuevo bigint;
begin
  perform pg_advisory_xact_lock(hashtext('buzon_empezar'));
  if exists (select 1 from buzon_ejecuciones where fin is null and inicio > now() - interval '4 minutes') then
    return null;
  end if;
  delete from buzon_ejecuciones where inicio < now() - interval '7 days';
  insert into buzon_ejecuciones (origen) values (p_origen) returning id into nuevo;
  return nuevo;
end;
$$;
revoke all on function public.buzon_empezar(text) from public, anon, authenticated;
grant execute on function public.buzon_empezar(text) to service_role;

-- Token con el que pg_cron llama a leer-buzon (y leer-buzon a recibir-precios): se genera aquí,
-- se guarda en Vault y solo su hash queda en ajustes. No lo ve nadie.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'leer_buzon_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'leer_buzon_token',
                                'Token con el que pg_cron llama a la función leer-buzon');
  end if;
end $$;
delete from public.ajustes where clave = 'buzon_token_sha256';
insert into public.ajustes (clave, valor)
select 'buzon_token_sha256', encode(extensions.digest(decrypted_secret, 'sha256'), 'hex')
from vault.decrypted_secrets where name = 'leer_buzon_token';

-- Función que llama a leer-buzon (la usa la tarea programada; también sirve para lanzarlo a mano: select public.leer_buzon_ahora();)
create or replace function public.leer_buzon_ahora(p_origen text default 'manual')
returns bigint
language sql
security definer
set search_path = public
as $$
  select net.http_post(
    url := 'https://sqtgnlfsydcecpxtumol.supabase.co/functions/v1/leer-buzon',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-buzon-token', (select decrypted_secret from vault.decrypted_secrets where name = 'leer_buzon_token')),
    body := jsonb_build_object('origen', p_origen),
    timeout_milliseconds := 15000
  );
$$;
revoke all on function public.leer_buzon_ahora(text) from public, anon, authenticated;

-- Cada 5 minutos
select cron.unschedule('leer-buzon') where exists (select 1 from cron.job where jobname = 'leer-buzon');
select cron.schedule('leer-buzon', '*/5 * * * *', $$ select public.leer_buzon_ahora('cron') $$);
