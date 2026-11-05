-- Facturación: fin de la prueba gratis por empresa, historial de altas y bajas de camiones
-- (6 meses) y máximo de camiones en servicio por mes, que es lo que se cobra.
-- (Aplicada en Supabase el 5/11/2026; ver el SQL completo en la migración "facturacion_camiones".)
alter table public.empresas add column prueba_hasta date;
create table public.camiones_eventos (id bigint generated always as identity primary key, empresa_id uuid not null references public.empresas(id) on delete cascade,
  camion_id uuid, matricula text, evento text not null check (evento in ('alta', 'baja', 'borrado', 'inicio')), en_servicio integer not null, creado timestamptz not null default now());
create table public.camiones_mes (empresa_id uuid not null references public.empresas(id) on delete cascade, mes date not null, maximo integer not null default 0, actual integer not null default 0, primary key (empresa_id, mes));
create table public.pagos_mes (empresa_id uuid not null references public.empresas(id) on delete cascade, mes date not null, camiones integer not null, importe numeric(10, 2) not null,
  pagado_el date not null default (now() at time zone 'Europe/Madrid')::date, nota text, primary key (empresa_id, mes));
-- + RLS sin políticas (solo el servidor) y el disparador privado.registrar_camiones() sobre public.camiones
