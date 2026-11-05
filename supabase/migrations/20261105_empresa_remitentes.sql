-- Direcciones desde las que cada empresa reenvía los emails de precios a fuelfy@fuelfy.app.
-- Cada dirección solo puede ser de una empresa (clave primaria).
create table public.empresa_remitentes (
  remitente text primary key check (remitente = lower(remitente) and remitente ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  creado timestamptz not null default now()
);
-- + RLS (el gestor ve, añade y quita las de su empresa) y privado.calcular_reenvio() con el ajuste 'buzon_precios'
