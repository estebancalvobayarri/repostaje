-- Emails con los que el proveedor de correo de una empresa pide confirmar el reenvío automático a fuelfy@fuelfy.app
-- (Gmail, one.com…). Los detecta la función leer-buzon, los guarda aquí y los mueve a la carpeta «Confirmaciones».
-- El gestor de la empresa los ve en Flota (con el enlace o el código) y el administrador, todos en Administración.
create table if not exists public.confirmaciones_reenvio (
  id bigserial primary key,
  recibido timestamptz not null default now(),
  empresa_id uuid references public.empresas(id) on delete cascade,   -- null si no se ha podido saber de quién es
  remitente text,             -- quien manda el email (el proveedor de correo)
  asunto text,
  direcciones text[] not null default '{}',   -- direcciones que aparecen en el email (la que pidió el reenvío suele estar)
  enlaces text[] not null default '{}',       -- enlaces de confirmación
  codigo text,                                -- código de confirmación, si lo trae
  texto text,                                 -- el texto del email, recortado
  resuelta boolean not null default false,
  creado timestamptz not null default now()
);
create index if not exists confirmaciones_reenvio_empresa on public.confirmaciones_reenvio (empresa_id, resuelta);
alter table public.confirmaciones_reenvio enable row level security;

drop policy if exists "ver confirmaciones de mi empresa" on public.confirmaciones_reenvio;
create policy "ver confirmaciones de mi empresa" on public.confirmaciones_reenvio for select to authenticated
  using (empresa_id = (select privado.mi_empresa()) and (select privado.soy_gestor()));
drop policy if exists "gestor marca confirmaciones" on public.confirmaciones_reenvio;
create policy "gestor marca confirmaciones" on public.confirmaciones_reenvio for update to authenticated
  using (empresa_id = (select privado.mi_empresa()) and (select privado.soy_gestor()))
  with check (empresa_id = (select privado.mi_empresa()));

revoke all on public.confirmaciones_reenvio from anon, authenticated;
grant select on public.confirmaciones_reenvio to authenticated;
grant update (resuelta) on public.confirmaciones_reenvio to authenticated;
