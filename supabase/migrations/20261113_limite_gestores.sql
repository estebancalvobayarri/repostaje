-- Un solo usuario gestor (decisión del 13 nov 2026): durante la prueba (sin suscripción en Stripe) y, para siempre,
-- en el plan Esencial. En Pro y Flota, usuarios ilimitados al contratar. Los gestores que ya existan no se tocan.
create or replace function privado.limite_gestores() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  emp record;
  otros integer;
begin
  if new.rol <> 'gestor' then return new; end if;
  if tg_op = 'UPDATE' and old.rol = 'gestor' and old.empresa_id = new.empresa_id then return new; end if;   -- ya contaba
  select stripe_sub, plan into emp from public.empresas where id = new.empresa_id for update;
  if emp.stripe_sub is not null and emp.plan is distinct from 'esencial' then return new; end if;   -- Pro o Flota contratado
  select count(*) into otros from public.perfiles where empresa_id = new.empresa_id and rol = 'gestor' and id <> new.id;
  if otros >= 1 then
    raise exception 'LIMITE_GESTORES: %', case when emp.stripe_sub is null
      then 'durante la prueba la empresa solo puede tener un usuario gestor'
      else 'el plan Esencial incluye un solo usuario gestor' end
      using errcode = 'P0001', hint = 'Los planes Pro y Flota tienen usuarios ilimitados.';
  end if;
  return new;
end $$;
revoke all on function privado.limite_gestores() from public;

drop trigger if exists perfiles_limite_gestores on public.perfiles;
create trigger perfiles_limite_gestores before insert or update of rol, empresa_id on public.perfiles
  for each row execute function privado.limite_gestores();
