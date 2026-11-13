-- Pago anual en 12 cuotas (decisión del 13 nov 2026): contrato de 12 meses al precio anual, pagado en 12 cuotas
-- mensuales por adelantado con cargo automático. empresas.pago admite 'cuotas'.
-- El fin del contrato no se guarda: sale de suscripcion_desde (periodos de 12 meses que se renuevan solos).
-- En empresas.facturacion (jsonb) se añaden enlace_tarjeta { url, caduca } y cargo_automatico { desde, medio }.
alter table public.empresas drop constraint if exists empresas_pago_check;
alter table public.empresas add constraint empresas_pago_check check (pago in ('mensual', 'anual', 'cuotas'));
