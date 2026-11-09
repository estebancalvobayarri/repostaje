-- El lector de Gmail (Apps Script) ya no existe: los precios llegan solo por leer-buzon (fuelfy@fuelfy.app).
-- La dirección de reenvío es la común (ajuste buzon_precios); se quita el caso buzon+alias@gmail.
create or replace function privado.calcular_reenvio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select valor into new.reenvio from public.ajustes where clave = 'buzon_precios';
  return new;
end $$;

delete from public.ajustes where clave in ('buzon', 'ingesta_token_sha256');
