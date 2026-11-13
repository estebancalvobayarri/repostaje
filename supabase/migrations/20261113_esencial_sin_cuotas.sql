-- Esencial no se paga en 12 cuotas (decisión del 13 nov 2026): solo mes a mes o el año de una vez.
alter table public.empresas drop constraint if exists empresas_esencial_sin_cuotas;
alter table public.empresas add constraint empresas_esencial_sin_cuotas check (not (plan = 'esencial' and pago = 'cuotas'));
