// Administración de la app: crear empresas, invitar a sus usuarios y ver su flota e informes.
// Usa la clave secreta del proyecto (solo existe en el servidor) y comprueba
// en cada llamada que quien la hace está en la tabla de administradores.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PLANES, type Plan, esPlan, esPago, conPagados, planPara, cuotaMensual, cuotaExtra, tramosExtra, facturables, precioStripe, tramosLegibles } from '../_shared/planes.ts';
import { stripe, idPrecio, precioPorClave, centimos, inicioMesMadrid, hayClaveStripe, ErrorStripe, sumarMeses, tsDia1 } from '../_shared/stripe.ts';

const WEB = 'https://fuelfy.app/app/';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const url = Deno.env.get('SUPABASE_URL')!;
const secreta = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(url, secreta, { auth: { persistSession: false, autoRefreshToken: false } });

const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
// Alias para la dirección de reenvío: minúsculas, sin acentos ni símbolos
const PALABRAS_VACIAS = /\b(sl|sa|slu|sll|scoop|s l|s a|transportes|transporte|trans|y|de|del|la|las|los|el)\b/g;
function aliasDe(texto: string) {
  const base = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').replace(PALABRAS_VACIAS, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('');
  return (base || 'empresa').slice(0, 24);
}
async function aliasLibre(deseado: string) {
  let a = deseado, n = 2;
  while (true) {
    const { data } = await sb.from('empresas').select('id').eq('alias', a).maybeSingle();
    if (!data) return a;
    a = `${deseado}${n++}`;
  }
}

// ---------- facturación ----------
// Precios por plan en ../_shared/planes.ts (los mismos que la web, las condiciones y Stripe).
const hoyMadrid = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const COLS_SUSCRIPCION = 'plan, pago, fundadora, camiones_pagados, suscripcion_desde, suscripcion_estado, stripe_customer_id, stripe_sub, stripe_sub_uso, facturacion';

// Estado de la suscripción y últimas facturas, leídos de Stripe (si hay clave; si falla, no rompe la pantalla)
async function datosStripe(emp: Record<string, any>) {
  if (!emp.stripe_customer_id || !hayClaveStripe()) return null;
  try {
    const [sub, uso, facturas] = await Promise.all([
      emp.stripe_sub ? stripe('GET', `subscriptions/${emp.stripe_sub}`) : null,
      emp.stripe_sub_uso && emp.stripe_sub_uso !== emp.stripe_sub ? stripe('GET', `subscriptions/${emp.stripe_sub_uso}`) : null,
      stripe('GET', 'invoices', { customer: emp.stripe_customer_id, limit: 12 }),
    ]);
    const resumen = (s: any) => s && { id: s.id, estado: s.status, baja_al_final: !!s.cancel_at_period_end || !!s.cancel_at,
      termina: s.cancel_at ? new Date(s.cancel_at * 1000).toISOString() : null, cobro: s.collection_method,
      empieza: s.trial_end ? new Date(s.trial_end * 1000).toISOString() : null };
    return {
      sub: resumen(sub), sub_uso: resumen(uso),
      facturas: (facturas?.data || []).map((f: any) => ({ numero: f.number, estado: f.status, total: f.total / 100, vence: f.due_date ? new Date(f.due_date * 1000).toISOString() : null,
        creada: new Date(f.created * 1000).toISOString(), url: f.hosted_invoice_url })),
    };
  } catch (err) { return { error: (err as Error).message }; }
}

async function facturacion(empresa_id: string) {
  const hoy = hoyMadrid(), mesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const primero = new Date(hoy.getFullYear(), hoy.getMonth() - 6, 1);
  const [{ data: emp, error: e0 }, { data: filas, error: e1 }, { data: pagos, error: e2 }, { data: eventos, error: e3 }, { count, error: e4 }, { data: usos, error: e5 }, { count: fundadoras, error: e6 }] = await Promise.all([
    sb.from('empresas').select(`id, nombre, cif, prueba_hasta, creado, ${COLS_SUSCRIPCION}`).eq('id', empresa_id).single(),
    sb.from('camiones_mes').select('mes, maximo, actual').eq('empresa_id', empresa_id).order('mes'),
    sb.from('pagos_mes').select('mes, camiones, importe, pagado_el, nota').eq('empresa_id', empresa_id),
    sb.from('camiones_eventos').select('matricula, evento, en_servicio, creado').eq('empresa_id', empresa_id).order('creado', { ascending: false }).limit(300),
    sb.from('camiones').select('id', { count: 'exact', head: true }).eq('empresa_id', empresa_id).eq('activo', true),
    sb.from('stripe_uso').select('dia, mes, maximo, valor, enviado, error').eq('empresa_id', empresa_id).order('dia', { ascending: false }).limit(5),
    sb.from('empresas').select('id', { count: 'exact', head: true }).eq('fundadora', true),
  ]);
  if (e0 || e1 || e2 || e3 || e4 || e5 || e6) throw e0 || e1 || e2 || e3 || e4 || e5 || e6;
  const porMes = new Map((filas || []).map((f) => [f.mes, f]));
  const pagado = new Map((pagos || []).map((p) => [p.mes, p]));
  const prueba = emp.prueba_hasta as string | null;
  const desdeStripe = emp.stripe_sub ? emp.suscripcion_desde as string : null;   // meses que ya cobra Stripe
  const creadoMes = new Date(new Date(emp.creado).getFullYear(), new Date(emp.creado).getMonth(), 1);
  const meses = [];
  let arrastre: number | null = null;   // camiones en servicio al acabar el mes anterior con datos
  for (let d = new Date(primero); d <= mesActual; d.setMonth(d.getMonth() + 1)) {
    const k = isoDia(d), f = porMes.get(k);
    const maximo = f ? f.maximo : arrastre;
    if (f) arrastre = f.actual;
    if (d < creadoMes && maximo == null) continue;
    const enCurso = +d === +mesActual;
    // Un mes se cobra si la prueba terminó antes de que empezara (el mes en que acaba la prueba no se cobra)
    const enPrueba = !prueba || prueba >= k;
    const plan: Plan = esPlan(emp.plan) ? emp.plan : planPara(maximo || 0);
    // Pago mensual (o sin suscripción todavía): máximo del mes con el mínimo del plan.
    // Pago anual (de una vez o en cuotas): solo los camiones de más, cada uno al precio de su tramo y con el descuento de fundadora si lo tiene.
    const pagados = emp.camiones_pagados || 0;
    const importe = maximo == null || enPrueba ? 0
      : conPagados(emp.pago) ? cuotaExtra(plan, pagados, Math.max(0, maximo - pagados), !!emp.fundadora)
      : cuotaMensual(plan, facturables(plan, maximo));
    meses.push({ mes: k, maximo, plan, importe, en_prueba: enPrueba, en_curso: enCurso, sin_datos: maximo == null,
      en_stripe: !!desdeStripe && k >= desdeStripe, pago: pagado.get(k) || null });
  }
  const hoyIso = isoDia(hoy);
  const pendientes = meses.filter((m) => !m.en_curso && !m.en_prueba && !m.sin_datos && !m.en_stripe && m.importe > 0 && !m.pago);
  const estado = emp.stripe_sub ? 'stripe' : !prueba || prueba >= hoyIso ? 'prueba' : pendientes.length ? 'pendiente' : 'al_dia';
  return {
    prueba_hasta: prueba, estado, en_servicio: count || 0, meses: meses.reverse(), eventos: eventos || [],
    suscripcion: {
      plan: emp.plan, pago: emp.pago, fundadora: emp.fundadora, camiones_pagados: emp.camiones_pagados, desde: emp.suscripcion_desde,
      compromiso_hasta: emp.stripe_sub && conPagados(emp.pago) ? finCompromiso(emp.suscripcion_desde).hasta : null,
      estado: emp.suscripcion_estado, customer: emp.stripe_customer_id, sub: emp.stripe_sub, sub_uso: emp.stripe_sub_uso,
      facturacion: emp.facturacion, cif: emp.cif, usos: usos || [], stripe: await datosStripe(emp),
    },
    hay_clave_stripe: hayClaveStripe(),
    fundadoras_libres: Math.max(0, 15 - (fundadoras || 0)),
    planes: Object.fromEntries((Object.keys(PLANES) as Plan[]).map((p) => [p, { nombre: PLANES[p].nombre, min: PLANES[p].min, max: PLANES[p].max === Infinity ? null : PLANES[p].max, tramos: tramosLegibles(p) }])),
  };
}

// Día 1 del mes siguiente al último día de prueba (o a hoy, si es más tarde), a las 00:00 de Madrid
function inicioSuscripcion(prueba_hasta: string | null) {
  const hoy = isoDia(hoyMadrid());
  const base = prueba_hasta && prueba_hasta > hoy ? prueba_hasta : hoy;
  const [y, m] = base.split('-').map(Number);
  const anio = m === 12 ? y + 1 : y, mes0 = m === 12 ? 0 : m;   // m va de 1 a 12: el mes siguiente, en base 0, es m
  return { ts: inicioMesMadrid(anio, mes0), iso: `${anio}-${String(mes0 + 1).padStart(2, '0')}-01` };
}

// Contrato de 12 meses (pago anual, de una vez o en cuotas): se renueva solo por periodos de 12 meses desde el día en
// que empezó a cobrar. finCompromiso da el día 1 en que termina el periodo en curso (corte) y el último día cubierto (hasta).
function finCompromiso(desde: string) {
  const hoy = isoDia(hoyMadrid());
  let corte = sumarMeses(desde, 12);
  while (corte <= hoy) corte = sumarMeses(corte, 12);
  const d = new Date(`${corte}T12:00:00Z`); d.setUTCDate(0);
  return { corte, hasta: d.toISOString().slice(0, 10) };
}

// Formas de pago de las facturas: tarjeta, domiciliación SEPA y transferencia, las que estén activas en la cuenta de Stripe
// (configuración de medios de pago por defecto). Así la página de pago de la factura no ofrece Klarna, Bizum, etc.
const FORMAS = ['card', 'sepa_debit', 'customer_balance'] as const;
async function mediosActivos(avisos: string[]) {
  let activas: string[] = ['card'];
  try {
    const r = await stripe<{ data: any[] }>('GET', 'payment_method_configurations', { limit: 20 });
    const pmc = r.data.find((c) => c.is_default && !c.application) || r.data.find((c) => c.is_default);
    if (pmc) activas = FORMAS.filter((t) => pmc[t]?.available && pmc[t]?.display_preference?.value === 'on');
  } catch (err) { avisos.push(`No se han podido leer los medios de pago de Stripe (${(err as Error).message}): solo tarjeta.`); }
  if (!activas.includes('sepa_debit')) avisos.push('La domiciliación SEPA no está activa en Stripe: las facturas se podrán pagar con tarjeta o transferencia.');
  if (!activas.length) activas = ['card'];
  return activas;
}
// customer_balance = transferencia bancaria (Stripe da al cliente un IBAN propio para cada factura)
const formasDePago = async (avisos: string[]) => ({ payment_method_types: await mediosActivos(avisos) });

// Pago en cuotas: enlace de Stripe (Checkout en modo «setup») para que el cliente guarde su tarjeta (o la domiciliación
// SEPA, cuando esté activa). Al guardarla, el webhook pone sus suscripciones con cargo automático. El enlace caduca en 24 h.
async function enlaceTarjeta(empresa_id: string) {
  const { data: emp, error } = await sb.from('empresas').select('id, stripe_customer_id, stripe_sub, facturacion').eq('id', empresa_id).single();
  if (error) throw error;
  if (!emp.stripe_customer_id || !emp.stripe_sub) return { error: 'Esta empresa no tiene suscripción en Stripe.' };
  const tipos = (await mediosActivos([])).filter((t) => t === 'card' || t === 'sepa_debit');
  const s = await stripe('POST', 'checkout/sessions', {
    mode: 'setup', customer: emp.stripe_customer_id, payment_method_types: tipos.length ? tipos : ['card'], locale: 'es',
    success_url: 'https://fuelfy.app/pago/?guardada=1', cancel_url: 'https://fuelfy.app/pago/?cancelado=1',
    metadata: { empresa_id, uso: 'cargo_automatico' }, setup_intent_data: { metadata: { empresa_id, uso: 'cargo_automatico' } },
  });
  const enlace = { url: s.url, caduca: new Date(s.expires_at * 1000).toISOString() };
  const { error: eu } = await sb.from('empresas').update({ facturacion: { ...(emp.facturacion || {}), enlace_tarjeta: enlace } }).eq('id', empresa_id);
  if (eu) throw eu;
  return enlace;
}

// Alta en Stripe: cliente + suscripción (mensual por uso; o anual, de una vez o en 12 cuotas, + otra por uso para los camiones de más)
async function suscribir(body: Record<string, unknown>) {
  const empresa_id = String(body.empresa_id || '');
  const plan = body.plan, pago = esPago(body.pago) ? body.pago : null;
  const fundadora = !!body.fundadora;
  const email = String(body.email || '').trim().toLowerCase();
  const direccion = String(body.direccion || '').trim(), cp = String(body.cp || '').trim(), ciudad = String(body.ciudad || '').trim();
  const forma_pago = pago === 'cuotas' ? 'cargo_automatico'
    : ['domiciliacion', 'tarjeta', 'transferencia'].includes(String(body.forma_pago)) ? String(body.forma_pago) : 'domiciliacion';
  if (!esPlan(plan)) return { error: 'Elige un plan' };
  if (!pago) return { error: 'Elige si paga mes a mes, el año de una vez o el año en 12 cuotas' };
  if (!emailValido(email)) return { error: 'Escribe el email al que se mandan las facturas' };
  if (direccion.length < 4 || !/^\d{5}$/.test(cp) || ciudad.length < 2) return { error: 'Completa la dirección fiscal: calle, código postal (5 cifras) y población' };
  const camiones = conPagados(pago) ? Math.round(Number(body.camiones)) : null;
  if (conPagados(pago) && !(camiones! >= PLANES[plan].min)) return { error: `En ${PLANES[plan].nombre} con pago anual hay que pagar al menos ${PLANES[plan].min} camiones` };
  if (fundadora && (plan === 'esencial' || !conPagados(pago))) return { error: 'La oferta de fundadoras es solo para Pro o Flota con contrato anual (de una vez o en cuotas)' };
  if (!hayClaveStripe()) return { error: 'Falta la clave de Stripe en Supabase (secreto STRIPE_SECRET_KEY).' };

  const { data: emp, error } = await sb.from('empresas').select(`id, nombre, cif, prueba_hasta, ${COLS_SUSCRIPCION}`).eq('id', empresa_id).single();
  if (error) throw error;
  if (emp.stripe_sub) return { error: 'Esta empresa ya tiene una suscripción. Dala de baja antes de crear otra.' };
  if (!emp.cif) return { error: 'Falta el CIF de la empresa: hace falta para las facturas.' };
  if (fundadora) {
    const { count } = await sb.from('empresas').select('id', { count: 'exact', head: true }).eq('fundadora', true);
    if ((count || 0) >= 15) return { error: 'Ya no quedan plazas de fundadoras (15).' };
  }
  const avisos: string[] = [];

  // 1. Cliente (si ya existía de un alta anterior, se actualiza)
  const datosCliente = {
    name: emp.nombre, email, preferred_locales: ['es'],
    address: { line1: direccion, postal_code: cp, city: ciudad, country: 'ES' },
    metadata: { empresa_id }, invoice_settings: { footer: 'Fuelfy · fuelfy.app · Pago en 15 días por domiciliación, transferencia o tarjeta.' },
  };
  let customer = emp.stripe_customer_id as string | null;
  if (customer) await stripe('POST', `customers/${customer}`, datosCliente);
  else {
    try {
      customer = (await stripe('POST', 'customers', { ...datosCliente, tax_id_data: [{ type: 'es_cif', value: emp.cif }] }, `cliente-${empresa_id}`)).id;
    } catch (err) {
      if ((err as ErrorStripe).codigo !== 'tax_id_invalid') throw err;
      customer = (await stripe('POST', 'customers', datosCliente, `cliente-sin-cif-${empresa_id}`)).id;
      avisos.push(`Stripe no ha aceptado el CIF «${emp.cif}»: el cliente se ha creado sin él. Revísalo en Stripe.`);
    }
    const { error: ec } = await sb.from('empresas').update({ stripe_customer_id: customer }).eq('id', empresa_id);
    if (ec) throw ec;
  }

  // 2. Suscripciones: empiezan el día 1 del mes siguiente al fin de la prueba (hasta entonces Stripe las tiene «en prueba»)
  const inicio = inicioSuscripcion(emp.prueba_hasta);
  const primeroDeEsteMes = isoDia(hoyMadrid()).slice(0, 8) + '01';
  if (emp.prueba_hasta && emp.prueba_hasta < primeroDeEsteMes)
    avisos.push('La prueba terminó antes de este mes: Stripe empieza a cobrar el mes que viene. Los meses anteriores, márcalos a mano.');
  const comun = {
    customer, collection_method: 'send_invoice', days_until_due: 15, automatic_tax: { enabled: true },
    trial_end: inicio.ts, proration_behavior: 'none', metadata: { empresa_id, plan, pago },
    payment_settings: await formasDePago(avisos),
  };
  const clave = `${empresa_id}-${inicio.iso}-${plan}-${pago}-${fundadora ? 'f' : 'n'}-${camiones || 0}`;
  const mensual = await precioPorClave(precioStripe(plan, 'mensual'));
  let sub: string, subUso: string;
  if (pago === 'mensual') {
    sub = subUso = (await stripe('POST', 'subscriptions', { ...comun, items: [{ price: mensual.id }] }, `sub-${clave}`)).id;
  } else {
    // Anual: un precio por año. Cuotas: un precio por mes (el anual entre 12) y el mismo contrato de 12 meses.
    // Las cuotas empiezan con factura por email; cuando el cliente guarda la tarjeta, el webhook las pasa a cargo automático.
    const precioAnual = await idPrecio(precioStripe(plan, pago, fundadora));
    sub = (await stripe('POST', 'subscriptions', {
      ...comun, items: [{ price: precioAnual, quantity: camiones }], ...(fundadora ? { discounts: [{ coupon: 'FUNDADORAS' }] } : {}),
    }, `sub-${clave}`)).id;
    // Camiones de más: un precio propio de este cliente, por el mismo medidor, con los tramos desplazados por los camiones
    // pagados (el primero de más paga el precio del tramo del camión pagados + 1) y el 25 % si es fundadora.
    // Así el cupón FUNDADORAS no se gasta dos veces.
    const tramos = tramosExtra(plan, camiones!, fundadora);
    const precioExtra = (await stripe('POST', 'prices', {
      product: mensual.product, currency: 'eur', tax_behavior: 'exclusive',
      billing_scheme: 'tiered', tiers_mode: 'graduated',
      tiers: tramos.map((t) => ({ up_to: t.up_to ?? 'inf', unit_amount_decimal: centimos(t.precio) })),
      recurring: { interval: 'month', usage_type: 'metered', meter: mensual.recurring?.meter },
      nickname: `${emp.nombre}: camiones de más sobre ${camiones} pagados (${PLANES[plan].nombre}${fundadora ? ', fundadora −25 %' : ''})`,
      metadata: { empresa_id, plan, pagados: String(camiones), fundadora: fundadora ? 'si' : 'no', uso: 'camiones_de_mas' },
    }, `precio-extra-${clave}`)).id;
    subUso = (await stripe('POST', 'subscriptions', { ...comun, metadata: { ...comun.metadata, uso: 'camiones_de_mas' }, items: [{ price: precioExtra }] }, `uso-${clave}`)).id;
  }

  const { error: eu } = await sb.from('empresas').update({
    plan, pago, fundadora, camiones_pagados: camiones, suscripcion_desde: inicio.iso, suscripcion_estado: 'activa',
    stripe_sub: sub, stripe_sub_uso: subUso, facturacion: { email, direccion, cp, ciudad, forma_pago },
  }).eq('id', empresa_id);
  if (eu) throw eu;
  if (pago === 'cuotas') {
    try {
      await enlaceTarjeta(empresa_id);
      avisos.push('Manda al cliente el enlace para guardar la tarjeta (abajo). Hasta que lo haga, las cuotas le llegan por email con 15 días para pagar.');
    } catch (err) { avisos.push(`No se ha podido crear el enlace para guardar la tarjeta (${(err as Error).message}). Créalo desde el botón de abajo.`); }
  }
  return { ...(await facturacion(empresa_id)), avisos };
}

// Baja: si aún no ha empezado a cobrar se cancela ya; si no, al final del periodo pagado (mes o año).
// Pago en cuotas: al final del contrato de 12 meses en curso (la penalización por baja anticipada, si procede, se factura aparte).
async function darDeBaja(empresa_id: string) {
  const { data: emp, error } = await sb.from('empresas').select(`id, ${COLS_SUSCRIPCION}`).eq('id', empresa_id).single();
  if (error) throw error;
  if (!emp.stripe_sub) return { error: 'Esta empresa no tiene suscripción.' };
  let todasCanceladas = true;
  for (const id of [...new Set([emp.stripe_sub, emp.stripe_sub_uso].filter(Boolean))] as string[]) {
    const s = await stripe('GET', `subscriptions/${id}`);
    if (s.status === 'canceled') continue;
    if (s.status === 'trialing') await stripe('DELETE', `subscriptions/${id}`);
    else if (emp.pago === 'cuotas') {
      await stripe('POST', `subscriptions/${id}`, { cancel_at: tsDia1(finCompromiso(emp.suscripcion_desde).corte), proration_behavior: 'none' });
      todasCanceladas = false;
    } else { await stripe('POST', `subscriptions/${id}`, { cancel_at_period_end: true }); todasCanceladas = false; }
  }
  const cambio = todasCanceladas
    ? { stripe_sub: null, stripe_sub_uso: null, suscripcion_estado: 'cancelada', fundadora: false }
    : { suscripcion_estado: 'baja_al_final' };
  const { error: eu } = await sb.from('empresas').update(cambio).eq('id', empresa_id);
  if (eu) throw eu;
  return await facturacion(empresa_id);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  // 1. Quién llama
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Falta la sesión' }, 401);
  const { data: u, error: eu } = await sb.auth.getUser(token);
  if (eu || !u?.user) return json({ error: 'Sesión no válida' }, 401);
  const { data: adm } = await sb.from('administradores').select('user_id').eq('user_id', u.user.id).maybeSingle();
  if (!adm) return json({ error: 'Solo los administradores pueden hacer esto' }, 403);

  // 2. Qué quiere hacer
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Petición no válida' }, 400); }
  const accion = String(body.accion || '');

  try {
    if (accion === 'listar') {
      const [{ data: empresas, error: e1 }, { data: perfiles, error: e2 }, { data: camiones, error: e3 }] = await Promise.all([
        sb.from('empresas').select('id, nombre, cif, alias, reenvio, creado').order('nombre'),
        sb.from('perfiles').select('id, empresa_id, nombre, rol, creado'),
        sb.from('camiones').select('empresa_id, activo'),
      ]);
      if (e1 || e2 || e3) throw e1 || e2 || e3;
      const { data: lista, error: e4 } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (e4) throw e4;
      const usuarios = new Map(lista.users.map((x) => [x.id, x]));
      return json({
        empresas: (empresas || []).map((e) => ({
          ...e,
          camiones: (camiones || []).filter((c) => c.empresa_id === e.id && c.activo).length,
          usuarios: (perfiles || []).filter((p) => p.empresa_id === e.id).map((p) => {
            const au = usuarios.get(p.id);
            return { ...p, email: au?.email, ha_entrado: !!au?.last_sign_in_at, ultimo_acceso: au?.last_sign_in_at || null };
          }),
        })),
      });
    }

    // Flota y emails de precios de una empresa (para verlos desde Administración)
    if (accion === 'empresa') {
      const empresa_id = String(body.empresa_id || '');
      const [{ data: camiones, error: e1 }, { data: correos, error: e2 }, { data: rem, error: e3 }] = await Promise.all([
        sb.from('camiones').select('id, matricula, descripcion, capacidad_litros, consumo_l_100km, activo').eq('empresa_id', empresa_id).order('activo', { ascending: false }).order('matricula'),
        sb.from('correos').select('recibido, remitente, proveedor, fecha_precios, n_precios, n_sin_ubicar, estado').eq('empresa_id', empresa_id).order('recibido', { ascending: false }).limit(10),
        sb.from('empresa_remitentes').select('remitente').eq('empresa_id', empresa_id).order('remitente'),
      ]);
      if (e1 || e2 || e3) throw e1 || e2 || e3;
      return json({ camiones: camiones || [], correos: correos || [], remitentes: (rem || []).map((r) => r.remitente) });
    }

    // Añadir o quitar una dirección desde la que la empresa reenvía los precios
    if (accion === 'remitente') {
      const empresa_id = String(body.empresa_id || ''), remitente = String(body.remitente || '').trim().toLowerCase();
      if (!emailValido(remitente)) return json({ error: 'Escribe una dirección de email válida' }, 400);
      if (body.quitar) {
        const { error } = await sb.from('empresa_remitentes').delete().eq('remitente', remitente).eq('empresa_id', empresa_id);
        if (error) throw error;
      } else {
        const { data: ya } = await sb.from('empresa_remitentes').select('empresa_id, empresas(nombre)').eq('remitente', remitente).maybeSingle();
        if (ya && ya.empresa_id !== empresa_id) return json({ error: `Esa dirección ya es de otra empresa (${(ya as any).empresas?.nombre || '?'})` }, 409);
        if (!ya) { const { error } = await sb.from('empresa_remitentes').insert({ remitente, empresa_id }); if (error) throw error; }
      }
      const { data: rem, error: e } = await sb.from('empresa_remitentes').select('remitente').eq('empresa_id', empresa_id).order('remitente');
      if (e) throw e;
      return json({ remitentes: (rem || []).map((r) => r.remitente) });
    }

    // Repostajes enviados por una empresa en un periodo (informe de ahorro)
    if (accion === 'informe') {
      const empresa_id = String(body.empresa_id || '');
      let consulta = sb.from('envios').select('*').eq('empresa_id', empresa_id).order('creado', { ascending: false }).limit(5000);
      if (body.desde) consulta = consulta.gte('creado', String(body.desde));
      if (body.hasta) consulta = consulta.lt('creado', String(body.hasta));
      const { data, error } = await consulta;
      if (error) throw error;
      return json({ envios: data || [] });
    }

    // Todas las rutas enviadas por todas las empresas en un periodo (máximo un año atrás)
    if (accion === 'exportar') {
      const limite = new Date(); limite.setFullYear(limite.getFullYear() - 1); limite.setHours(0, 0, 0, 0);
      const desde = new Date(String(body.desde || ''));
      const hasta = body.hasta ? new Date(String(body.hasta)) : new Date();
      if (isNaN(+desde) || isNaN(+hasta)) return json({ error: 'Las fechas no son válidas' }, 400);
      if (desde < limite) return json({ error: 'Solo se pueden descargar rutas de hasta un año atrás' }, 400);
      if (hasta <= desde) return json({ error: 'La fecha final tiene que ser posterior a la inicial' }, 400);
      const [{ data: envios, error: e1 }, { data: empresas, error: e2 }, { data: lista, error: e3 }] = await Promise.all([
        sb.from('envios').select('*').gte('creado', desde.toISOString()).lt('creado', hasta.toISOString()).order('creado').limit(20000),
        sb.from('empresas').select('id, nombre'),
        sb.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ]);
      if (e1 || e2 || e3) throw e1 || e2 || e3;
      const nombreEmpresa = new Map((empresas || []).map((e) => [e.id, e.nombre]));
      const emailUsuario = new Map(lista.users.map((x) => [x.id, x.email]));
      return json({ envios: (envios || []).map((e) => ({ ...e, empresa: nombreEmpresa.get(e.empresa_id) || '', enviado_por: emailUsuario.get(e.usuario_id) || '' })) });
    }

    if (accion === 'facturacion') return json(await facturacion(String(body.empresa_id || '')));

    // Solicitudes de prueba que llegan desde la portada
    if (accion === 'solicitudes') {
      const { data, error } = await sb.from('solicitudes').select('*').order('creado', { ascending: false }).limit(200);
      if (error) throw error;
      return json({ solicitudes: data || [] });
    }
    if (accion === 'solicitud') {
      const id = String(body.id || '');
      const cambio: Record<string, unknown> = {};
      if ('atendida' in body) cambio.atendida = !!body.atendida;
      if ('nota' in body) cambio.nota = body.nota ? String(body.nota).slice(0, 500) : null;
      if (body.borrar) {
        const { error } = await sb.from('solicitudes').delete().eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await sb.from('solicitudes').update(cambio).eq('id', id);
        if (error) throw error;
      }
      const { data } = await sb.from('solicitudes').select('*').order('creado', { ascending: false }).limit(200);
      return json({ solicitudes: data || [] });
    }

    // Fin de la prueba gratis (vacío = sin fecha: la empresa sigue en prueba)
    if (accion === 'prueba') {
      const empresa_id = String(body.empresa_id || '');
      const hasta = body.hasta ? String(body.hasta) : null;
      if (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return json({ error: 'La fecha no es válida' }, 400);
      const { error } = await sb.from('empresas').update({ prueba_hasta: hasta }).eq('id', empresa_id);
      if (error) throw error;
      return json(await facturacion(empresa_id));
    }

    // Marcar un mes como cobrado (o deshacerlo). El importe lo calcula el servidor.
    if (accion === 'pago') {
      const empresa_id = String(body.empresa_id || ''), mes = String(body.mes || '');
      if (body.pagado) {
        const f = await facturacion(empresa_id);
        const m = f.meses.find((x) => x.mes === mes);
        if (!m || m.en_curso || m.en_prueba || m.sin_datos || m.en_stripe) return json({ error: 'Ese mes no se puede marcar como cobrado' }, 400);
        const { error } = await sb.from('pagos_mes').upsert({ empresa_id, mes, camiones: m.maximo, importe: m.importe, nota: body.nota ? String(body.nota).slice(0, 200) : null });
        if (error) throw error;
      } else {
        const { error } = await sb.from('pagos_mes').delete().eq('empresa_id', empresa_id).eq('mes', mes);
        if (error) throw error;
      }
      return json(await facturacion(empresa_id));
    }

    // Suscripción en Stripe: alta, baja y aviso de camiones a mano
    if (accion === 'suscribir') {
      const r = await suscribir(body);
      return 'error' in r && typeof r.error === 'string' ? json({ error: r.error }, 400) : json(r);
    }
    if (accion === 'baja_suscripcion') {
      const r = await darDeBaja(String(body.empresa_id || ''));
      return 'error' in r && typeof r.error === 'string' ? json({ error: r.error }, 400) : json(r);
    }
    if (accion === 'enlace_tarjeta') {
      const empresa_id = String(body.empresa_id || '');
      const r = await enlaceTarjeta(empresa_id);
      return 'error' in r ? json({ error: r.error }, 400) : json(await facturacion(empresa_id));
    }
    if (accion === 'enviar_uso') {
      const { error } = await sb.rpc('enviar_uso_ahora', { p_origen: 'admin' });
      if (error) throw error;
      await new Promise((r) => setTimeout(r, 4000));   // da tiempo a que enviar-uso termine
      return json(await facturacion(String(body.empresa_id || '')));
    }

    if (accion === 'crear_empresa') {
      const nombre = String(body.nombre || '').trim();
      const cif = String(body.cif || '').trim().toUpperCase() || null;
      if (nombre.length < 2) return json({ error: 'Escribe el nombre de la empresa' }, 400);
      const alias = await aliasLibre(aliasDe(String(body.alias || '').trim() || nombre));
      const { data, error } = await sb.from('empresas').insert({ nombre, cif, alias }).select().single();
      if (error) throw error;
      return json({ empresa: data });
    }

    if (accion === 'invitar') {
      const email = String(body.email || '').trim().toLowerCase();
      const empresa_id = String(body.empresa_id || '');
      const nombre = String(body.nombre || '').trim() || null;
      const rol = body.rol === 'conductor' ? 'conductor' : 'gestor';
      if (!emailValido(email)) return json({ error: 'El email no es válido' }, 400);
      const { data: emp } = await sb.from('empresas').select('id').eq('id', empresa_id).maybeSingle();
      if (!emp) return json({ error: 'La empresa no existe' }, 400);

      // ¿Ya tiene cuenta? (p. ej. creada desde el panel de Supabase)
      const { data: lista } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      let usuario = lista?.users.find((x) => x.email?.toLowerCase() === email);
      let invitado = false;
      if (!usuario) {
        const { data, error } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo: WEB, data: { nombre } });
        if (error) throw error;
        usuario = data.user; invitado = true;
      }
      const { data: ya } = await sb.from('perfiles').select('empresa_id').eq('id', usuario!.id).maybeSingle();
      if (ya && ya.empresa_id !== empresa_id) return json({ error: 'Ese email ya pertenece a otra empresa' }, 409);
      const { error: ep } = await sb.from('perfiles').upsert({ id: usuario!.id, empresa_id, nombre, rol });
      if (ep) throw ep;
      return json({ ok: true, invitado });
    }

    if (accion === 'reenviar') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!emailValido(email)) return json({ error: 'El email no es válido' }, 400);
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: WEB });
      if (error) throw error;
      return json({ ok: true });
    }

    if (accion === 'quitar_usuario') {
      const id = String(body.user_id || '');
      if (id === u.user.id) return json({ error: 'No puedes quitarte a ti mismo' }, 400);
      const { data: esAdm } = await sb.from('administradores').select('user_id').eq('user_id', id).maybeSingle();
      if (esAdm) return json({ error: 'No se puede quitar a otro administrador desde aquí' }, 400);
      const { error } = await sb.auth.admin.deleteUser(id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'Acción desconocida' }, 400);
  } catch (err) {
    const msg = (err as { message?: string })?.message || String(err);
    const amable = /rate limit/i.test(msg)
      ? 'Se ha alcanzado el límite de emails por hora de Supabase. Prueba dentro de un rato.'
      : msg;
    return json({ error: amable }, 500);
  }
});
