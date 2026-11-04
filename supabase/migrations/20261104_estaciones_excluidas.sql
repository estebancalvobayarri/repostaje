-- Estaciones que el gestor ha quitado del mapa y de las rutas de su empresa.
-- Se guardan las excluidas para que las estaciones nuevas aparezcan por defecto.
create table public.estaciones_excluidas (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  estacion_id uuid not null references public.estaciones(id) on delete cascade,
  creado timestamptz not null default now(),
  primary key (empresa_id, estacion_id)
);
create index on public.estaciones_excluidas (estacion_id);
alter table public.estaciones_excluidas enable row level security;
create policy "ver excluidas de mi empresa" on public.estaciones_excluidas for select to authenticated
  using (empresa_id = (select privado.mi_empresa()));
create policy "gestor excluye estaciones" on public.estaciones_excluidas for insert to authenticated
  with check (empresa_id = (select privado.mi_empresa()) and (select privado.soy_gestor()));
create policy "gestor vuelve a incluir estaciones" on public.estaciones_excluidas for delete to authenticated
  using (empresa_id = (select privado.mi_empresa()) and (select privado.soy_gestor()));
grant select, insert, delete on public.estaciones_excluidas to authenticated;
