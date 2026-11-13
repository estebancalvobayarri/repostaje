// Fuelfy · webhook de Stripe
//
// Stripe avisa aquí de los cambios en suscripciones y facturas. Con eso:
//   - empresas.suscripcion_estado sigue a Stripe (activa, baja_al_final, impagada, cancelada) y, cuando una suscripción
//     termina de verdad, se borra su id: el aviso diario de camiones deja de mandarse a una suscripción cancelada;
//   - cada factura queda en la tabla stripe_facturas; si una sigue pendiente 7 días después de vencer,
//     la empresa pasa a modo consulta (privado.en_consulta) hasta que se pague;
//   - pago en cuotas: cuando el cliente guarda la tarjeta con el enlace de Checkout (modo «setup»), queda como medio de
//     pago por defecto y sus suscripciones pasan a cargo automático.
//
// Eventos: customer.subscription.updated, customer.subscription.deleted, invoice.finalized, invoice.updated,
//          invoice.paid, invoice.voided, invoice.marked_uncollectible, invoice.overdue, checkout.session.completed.
// Secretos: STRIPE_WEBHOOK_SECRET (el «signing secret» del endpoint, whsec_…) y STRIPE_SECRET_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { stripe } from '../_shared/stripe.ts';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ---------- firma de Stripe (cabecera Stripe-Signature: t=…,v1=…) ----------
const TOLERANCIA_S = 300;
async function firmaValida(cuerpo: string, cabecera: string, secreto: string) {
  const partes = cabecera.split(',').map((p) => p.split('='));
  const t = partes.find(([k]) => k === 't')?.[1];
  const firmas = partes.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !firmas.length || Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCIA_S) return false;
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(`${t}.${cuerpo}`)));
  const esperada = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Comparación en tiempo constante
  return firmas.some((f) => f.length === esperada.length && [...f].reduce((d, c, i) => d | (c.charCodeAt(0) ^ esperada.charCodeAt(i)), 0) === 0);
}

const fecha = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);

// ---------- empresa a la que pertenece un objeto de Stripe ----------
async function empresaDe(o: { customer?: string | null; metadata?: Record<string, string> | null }) {
  const porMeta = o.metadata?.empresa_id;
  const { data } = porMeta
    ? await sb.from('empresas').select('id, stripe_sub, stripe_sub_uso, suscripcion_estado').eq('id', porMeta).maybeSingle()
    : await sb.from('empresas').select('id, stripe_sub, stripe_sub_uso, suscripcion_estado').eq('stripe_customer_id', o.customer || '').maybeSingle();
  return data as { id: string; stripe_sub: string | null; stripe_sub_uso: string | null; suscripcion_estado: string | null } | null;
}

// ---------- suscripciones ----------
// El estado que se enseña en la app sale de la suscripción principal (stripe_sub)
function estadoDe(s: any) {
  if (s.status === 'canceled') return 'cancelada';
  if (s.status === 'past_due' || s.status === 'unpaid') return 'impagada';
  if (s.cancel_at_period_end || s.cancel_at) return 'baja_al_final';
  return 'activa';   // trialing (programada) o active
}

async function suscripcion(s: any, borrada: boolean) {
  const emp = await empresaDe(s);
  if (!emp) return 'empresa no encontrada';
  const cambio: Record<string, unknown> = {};
  if (borrada || s.status === 'canceled') {
    // Termina de verdad: se olvida su id (y el aviso diario deja de mandarse a ella)
    if (emp.stripe_sub_uso === s.id) cambio.stripe_sub_uso = null;
    if (emp.stripe_sub === s.id) cambio.stripe_sub = null;
    const quedaPrincipal = emp.stripe_sub && emp.stripe_sub !== s.id;
    const quedaUso = emp.stripe_sub_uso && emp.stripe_sub_uso !== s.id;
    if (!quedaPrincipal && !quedaUso) Object.assign(cambio, { suscripcion_estado: 'cancelada', fundadora: false });
  } else if (emp.stripe_sub === s.id) {
    cambio.suscripcion_estado = estadoDe(s);
  } else if (emp.stripe_sub_uso !== s.id) {
    return 'suscripción que no es de esta empresa';
  }
  if (!Object.keys(cambio).length) return null;
  const { error } = await sb.from('empresas').update(cambio).eq('id', emp.id);
  return error ? error.message : null;
}

// ---------- facturas ----------
const FINALES = new Set(['paid', 'void', 'uncollectible']);
async function factura(f: any) {
  if (f.status === 'draft') return null;   // los borradores no se guardan: llegan al finalizarse
  const subId = f.parent?.subscription_details?.subscription ?? f.subscription ?? null;
  const emp = await empresaDe({ customer: f.customer, metadata: f.parent?.subscription_details?.metadata ?? null });
  // Un evento antiguo que llega tarde no deshace un estado final (pagada, anulada, incobrable)
  const { data: previa } = await sb.from('stripe_facturas').select('estado').eq('id', f.id).maybeSingle();
  if (previa && FINALES.has(previa.estado) && !FINALES.has(f.status)) return null;
  const { error } = await sb.from('stripe_facturas').upsert({
    id: f.id, empresa_id: emp?.id ?? null, customer: f.customer, suscripcion: subId, numero: f.number,
    estado: f.status, total: (f.total ?? 0) / 100, vence: fecha(f.due_date), url: f.hosted_invoice_url,
    creada: fecha(f.created), actualizado: new Date().toISOString(),
  });
  if (error) return error.message;
  return emp ? null : 'factura de un cliente sin empresa';
}

// ---------- tarjeta guardada (pago en cuotas) ----------
async function tarjetaGuardada(cs: any) {
  if (cs.mode !== 'setup' || cs.metadata?.uso !== 'cargo_automatico') return null;
  const emp = await empresaDe(cs);
  if (!emp) return 'empresa no encontrada';
  const si = await stripe('GET', `setup_intents/${cs.setup_intent}`);
  const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
  if (!pm) return 'la sesión no ha guardado ningún medio de pago';
  await stripe('POST', `customers/${cs.customer}`, { invoice_settings: {
    default_payment_method: pm, footer: 'Fuelfy · fuelfy.app · Cuota cobrada automáticamente con el medio de pago guardado.' } });
  for (const id of [...new Set([emp.stripe_sub, emp.stripe_sub_uso].filter(Boolean))] as string[])
    await stripe('POST', `subscriptions/${id}`, { collection_method: 'charge_automatically', default_payment_method: pm });
  const { data: f } = await sb.from('empresas').select('facturacion').eq('id', emp.id).single();
  const { enlace_tarjeta: _, ...resto } = (f?.facturacion || {}) as Record<string, unknown>;
  const { error } = await sb.from('empresas').update({ facturacion: { ...resto, cargo_automatico: { desde: new Date().toISOString(), medio: pm } } }).eq('id', emp.id);
  return error ? error.message : null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const secreto = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secreto) return json({ error: 'Falta el secreto STRIPE_WEBHOOK_SECRET' }, 500);
  const cuerpo = await req.text();
  if (!(await firmaValida(cuerpo, req.headers.get('stripe-signature') || '', secreto))) return json({ error: 'Firma no válida' }, 400);

  const ev = JSON.parse(cuerpo);
  // Cada evento se procesa una vez (Stripe puede repetirlo)
  const { error: ya } = await sb.from('stripe_eventos').insert({ id: ev.id, tipo: ev.type, objeto: ev.data?.object?.id ?? null });
  if (ya) {
    if (ya.code === '23505') return json({ ok: true, repetido: true });
    return json({ error: ya.message }, 500);
  }

  let problema: string | null = null;
  try {
    const o = ev.data.object;
    if (ev.type === 'customer.subscription.updated') problema = await suscripcion(o, false);
    else if (ev.type === 'customer.subscription.deleted') problema = await suscripcion(o, true);
    else if (ev.type.startsWith('invoice.')) problema = await factura(o);
    else if (ev.type === 'checkout.session.completed') problema = await tarjetaGuardada(o);
  } catch (err) {
    problema = (err as Error).message;
  }
  await sb.from('stripe_eventos').update({ error: problema }).eq('id', ev.id);
  // Se borran los eventos de más de 90 días
  await sb.from('stripe_eventos').delete().lt('recibido', new Date(Date.now() - 90 * 864e5).toISOString());
  // Un fallo de base de datos se devuelve como error para que Stripe lo reintente; lo demás se apunta y se responde bien
  if (problema && !/no encontrada|sin empresa|no es de esta empresa/.test(problema)) {
    await sb.from('stripe_eventos').delete().eq('id', ev.id);   // para que el reintento se procese
    return json({ error: problema }, 500);
  }
  return json({ ok: true, aviso: problema });
});
