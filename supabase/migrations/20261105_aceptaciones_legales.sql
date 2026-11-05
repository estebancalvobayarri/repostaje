-- Constancia de que cada usuario ha aceptado las condiciones y la política de privacidad (por versión)
create table public.aceptaciones_legales (
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null,
  empresa_id uuid references public.empresas(id) on delete set null,
  aceptado timestamptz not null default now(),
  primary key (user_id, version)
);
alter table public.aceptaciones_legales enable row level security;
create policy "ver mis aceptaciones" on public.aceptaciones_legales for select to authenticated
  using (user_id = (select auth.uid()));
create policy "registrar mi aceptacion" on public.aceptaciones_legales for insert to authenticated
  with check (user_id = (select auth.uid()) and (empresa_id is null or empresa_id = (select privado.mi_empresa())));
grant select, insert on public.aceptaciones_legales to authenticated;
