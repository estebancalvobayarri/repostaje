-- Prueba gratis: como máximo 5 camiones en servicio mientras la empresa no tenga suscripción en Stripe
-- (decisión del 13 nov 2026). El límite es por empresa (columna max_camiones_prueba) para poder hacer excepciones:
-- GES TRANS mantiene sus 8 camiones.
alter table public.empresas add column if not exists max_camiones_prueba integer not null default 5 check (max_camiones_prueba between 1 and 1000);
comment on column public.empresas.max_camiones_prueba is 'Camiones en servicio que puede tener la empresa durante la prueba (sin suscripción). Por defecto 5.';
update public.empresas set max_camiones_prueba = 8 where id = 'b41c55c4-00b7-4ebd-b277-b4db87b9ff4f';   -- GES TRANS HERMANOS ALVAREZ SL

create or replace function privado.limite_camiones_prueba() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  emp record;
  en_servicio integer;
begin
  if not new.activo then return new; end if;
  if tg_op = 'UPDATE' and old.activo and old.empresa_id = new.empresa_id then return new; end if;   -- ya contaba
  -- bloquea la fila de la empresa para que dos altas a la vez no se salten el límite
  select stripe_sub, max_camiones_prueba into emp from public.empresas where id = new.empresa_id for update;
  if emp.stripe_sub is not null then return new; end if;   -- con suscripción no hay límite
  select count(*) into en_servicio from public.camiones where empresa_id = new.empresa_id and activo and id <> new.id;
  if en_servicio >= emp.max_camiones_prueba then
    raise exception 'LIMITE_PRUEBA: durante la prueba puedes tener como máximo % camiones en servicio', emp.max_camiones_prueba
      using errcode = 'P0001', hint = 'Contrata un plan para dar de alta el resto de la flota.';
  end if;
  return new;
end $$;
revoke all on function privado.limite_camiones_prueba() from public;

drop trigger if exists camiones_limite_prueba on public.camiones;
create trigger camiones_limite_prueba before insert or update of activo, empresa_id on public.camiones
  for each row execute function privado.limite_camiones_prueba();
