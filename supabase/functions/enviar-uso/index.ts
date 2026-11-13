// Fuelfy · aviso diario de camiones a Stripe
//
// Lo llama pg_cron cada día a las 21:00 UTC (tarea «enviar-uso»). Por cada empresa con suscripción en Stripe:
//   1. mira el máximo de camiones en servicio del mes en curso (tabla camiones_mes),
//   2. calcula lo que se cobra: en pago mensual, ese máximo con el mínimo del plan (2, 5 o 50);
//      en pago anual (de una vez o en cuotas), solo los camiones que pasan de los pagados,
//   3. se lo manda al medidor «camiones_en_servicio» de Stripe, que se queda con el último valor del mes.
// Como el máximo del mes solo puede subir, el último aviso del mes es el que se cobra.
//
// POST con cabecera x-uso-token (el token está en Vault como «enviar_uso_token»; su hash, en ajustes.enviar_uso_token_sha256).
//   Cuerpo opcional: { origen?: 'cron' | 'manual' | 'admin', empresa_id?: string }
// Secretos: STRIPE_SECRET_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { esPlan, esPago, valorMedidor } from '../_shared/planes.ts';
import { stripe, hayClaveStripe } from '../_shared/stripe.ts';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function sha256(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const hoyMadrid = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const token = req.headers.get('x-uso-token') || '';
  const { data: aj } = await sb.from('ajustes').select('valor').eq('clave', 'enviar_uso_token_sha256').maybeSingle();
  if (!token || !aj?.valor || (await sha256(token)) !== aj.valor) return json({ error: 'No autorizado' }, 401);
  if (!hayClaveStripe()) return json({ error: 'Falta el secreto STRIPE_SECRET_KEY' }, 500);
  const body = await req.json().catch(() => ({}));

  const hoy = hoyMadrid(), dia = isoDia(hoy), mes = dia.slice(0, 8) + '01';
  let consulta = sb.from('empresas').select('id, nombre, plan, pago, camiones_pagados, suscripcion_desde, stripe_customer_id, stripe_sub_uso')
    .not('stripe_sub_uso', 'is', null).not('stripe_customer_id', 'is', null);
  if (body.empresa_id) consulta = consulta.eq('id', String(body.empresa_id));
  const { data: empresas, error } = await consulta;
  if (error) return json({ error: error.message }, 500);

  const resultado: Record<string, unknown>[] = [];
  for (const e of empresas || []) {
    if (!esPlan(e.plan) || !esPago(e.pago)) continue;
    // Máximo del mes: la fila de este mes; si este mes no ha habido cambios, los que había al acabar el último mes con datos
    const { data: filas } = await sb.from('camiones_mes').select('mes, maximo, actual').eq('empresa_id', e.id).lte('mes', mes).order('mes', { ascending: false }).limit(1);
    let maximo = 0;
    if (filas?.length) maximo = filas[0].mes === mes ? filas[0].maximo : filas[0].actual;
    else {
      const { count } = await sb.from('camiones').select('id', { count: 'exact', head: true }).eq('empresa_id', e.id).eq('activo', true);
      maximo = count || 0;
    }
    const valor = valorMedidor(e.plan, e.pago, maximo, e.camiones_pagados);
    const fila = { empresa_id: e.id, dia, mes, maximo, valor, enviado: null as string | null, error: null as string | null };
    try {
      await stripe('POST', 'billing/meter_events', {
        event_name: 'camiones_en_servicio',
        identifier: `${e.id}-${dia}-${valor}`,   // evita duplicados si se lanza dos veces el mismo día con el mismo valor
        payload: { stripe_customer_id: e.stripe_customer_id, value: valor },
      });
      fila.enviado = new Date().toISOString();
    } catch (err) {
      const msg = (err as Error).message;
      // Si ya se mandó hoy el mismo valor, Stripe lo rechaza por repetido: no es un error
      if (/identifier/i.test(msg) && /(already|duplicate|exist)/i.test(msg)) fila.enviado = new Date().toISOString();
      else fila.error = msg.slice(0, 500);
    }
    await sb.from('stripe_uso').upsert(fila);
    resultado.push({ empresa: e.nombre, maximo, valor, ok: !fila.error, error: fila.error });
  }
  // Se guardan 13 meses de avisos
  const limite = new Date(hoy.getFullYear() - 1, hoy.getMonth() - 1, 1);
  await sb.from('stripe_uso').delete().lt('dia', isoDia(limite));
  return json({ origen: body.origen || 'manual', dia, empresas: resultado });
});
