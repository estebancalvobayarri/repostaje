-- Rutas guardadas sin enviar: el gestor prepara rutas para más adelante y las manda luego por WhatsApp.
-- Al enviarla, la app la apunta en «envios» (si lleva parada) y la borra de aquí.
create table public.rutas_guardadas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid default auth.uid() references auth.users(id) on delete set null,
  creado timestamptz not null default now(),
  fecha_precios date,
  camion_id uuid references public.camiones(id) on delete set null,
  matricula text,
  origen text not null,
  destino text not null,
  km_ruta numeric,
  min_ruta numeric,
  estacion_id text,          -- null = sin parada en esta ruta
  estacion_nombre text,
  tarjeta text,
  precio numeric,
  litros numeric,
  mensaje text not null,     -- texto para WhatsApp tal como se guardó
  envio jsonb,               -- fila para «envios» al mandarla (null si va sin parada)
  plan jsonb not null        -- para reabrirla en el mapa: origen y destino con coordenadas, nivel, litros
);
create index rutas_guardadas_empresa_creado on public.rutas_guardadas (empresa_id, creado desc);
create index rutas_guardadas_usuario on public.rutas_guardadas (usuario_id);
create index rutas_guardadas_camion on public.rutas_guardadas (camion_id);

alter table public.rutas_guardadas enable row level security;
create policy "ver rutas guardadas de mi empresa" on public.rutas_guardadas for select to authenticated
  using (empresa_id = (select privado.mi_empresa()));
create policy "guardar rutas de mi empresa" on public.rutas_guardadas for insert to authenticated
  with check (empresa_id = (select privado.mi_empresa()) and usuario_id = (select auth.uid())
              and not (select privado.en_consulta(privado.mi_empresa())));
create policy "borrar rutas guardadas de mi empresa" on public.rutas_guardadas for delete to authenticated
  using (empresa_id = (select privado.mi_empresa()));
