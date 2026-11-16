-- Aviso por email de cada solicitud de prueba de la portada (16 nov 2026).
-- Al insertar una solicitud, el trigger llama con pg_net a la función avisar-solicitud, que manda un email
-- desde fuelfy@fuelfy.app a hola@fuelfy.app. Si el aviso falla, la solicitud se guarda igual.
-- Reenviar a mano: select privado.avisar_solicitud('<id>', true);
alter table public.solicitudes
  add column if not exists aviso_enviado timestamptz,
  add column if not exists aviso_error text;

-- Desde la web no se pueden rellenar las columnas del aviso
drop policy if exists "enviar solicitud desde la web" on public.solicitudes;
create policy "enviar solicitud desde la web" on public.solicitudes for insert
  with check (atendida = false and nota is null and aviso_enviado is null and aviso_error is null);

-- Token para que solo la base de datos pueda llamar a la función (en Vault; su hash, en ajustes)
do $$
declare t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not exists (select 1 from vault.secrets where name = 'aviso_solicitud_token') then
    perform vault.create_secret(t, 'aviso_solicitud_token', 'Token de la función avisar-solicitud');
    insert into public.ajustes (clave, valor) values ('aviso_token_sha256', encode(extensions.digest(t, 'sha256'), 'hex'))
      on conflict (clave) do update set valor = excluded.valor;
  end if;
end $$;

create or replace function privado.avisar_solicitud(p_id uuid, p_repetir boolean default false)
returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://sqtgnlfsydcecpxtumol.supabase.co/functions/v1/avisar-solicitud',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-aviso-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aviso_solicitud_token')),
    body := jsonb_build_object('id', p_id, 'repetir', p_repetir),
    timeout_milliseconds := 30000
  );
$$;
revoke all on function privado.avisar_solicitud(uuid, boolean) from public, anon, authenticated;

create or replace function privado.solicitudes_avisar_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform privado.avisar_solicitud(new.id);
  return new;
exception when others then
  -- Si falla el aviso, la solicitud se guarda igual
  raise warning 'No se ha podido lanzar el aviso de la solicitud %: %', new.id, sqlerrm;
  return new;
end $$;
revoke all on function privado.solicitudes_avisar_trg() from public, anon, authenticated;

drop trigger if exists solicitudes_avisar on public.solicitudes;
create trigger solicitudes_avisar after insert on public.solicitudes
  for each row execute function privado.solicitudes_avisar_trg();
