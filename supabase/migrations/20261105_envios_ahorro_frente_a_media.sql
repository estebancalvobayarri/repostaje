-- El ahorro pasa a calcularse frente a la media de precios de las otras paradas de la ruta
-- (solo estaciones habilitadas por la empresa). Los envíos antiguos conservan su cálculo
-- frente a la parada más cara (precio_referencia vacío -> se usa precio_cara).
alter table public.envios add column precio_referencia numeric;
alter table public.envios add column n_referencia integer;
alter table public.envios add column referencia text not null default 'mas_cara' check (referencia in ('media', 'mas_cara'));
alter table public.envios drop column ahorro_eur;
alter table public.envios add column ahorro_eur numeric generated always as
  (round((coalesce(precio_referencia, precio_cara, precio_elegido) - precio_elegido) * litros, 2)) stored;
comment on column public.envios.ahorro_eur is 'Ahorro estimado: (precio de referencia - precio elegido) x litros. Puede ser negativo si se elige una parada más cara que la media.';
