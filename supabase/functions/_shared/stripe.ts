// Llamadas mínimas a la API de Stripe (sin SDK). Necesita el secreto STRIPE_SECRET_KEY en Supabase: una clave restringida
// con escritura en Customers, Subscriptions, Prices (para el precio de camiones de más de cada cliente anual)
// y Billing meter events, y lectura en Invoices.

export class ErrorStripe extends Error {
  constructor(public status: number, mensaje: string, public codigo?: string) { super(mensaje); }
}

export const hayClaveStripe = () => !!Deno.env.get('STRIPE_SECRET_KEY');

// Convierte { a: { b: 1 }, c: [ { d: 2 } ] } en a[b]=1&c[0][d]=2, como espera Stripe
function aplanar(obj: unknown, prefijo: string, salida: URLSearchParams) {
  if (obj === undefined || obj === null) return;
  if (Array.isArray(obj)) obj.forEach((v, i) => aplanar(v, `${prefijo}[${i}]`, salida));
  else if (typeof obj === 'object') for (const [k, v] of Object.entries(obj as Record<string, unknown>)) aplanar(v, prefijo ? `${prefijo}[${k}]` : k, salida);
  else salida.append(prefijo, String(obj));
}

export async function stripe<T = any>(metodo: 'GET' | 'POST' | 'DELETE', ruta: string, params?: Record<string, unknown>, idempotencia?: string): Promise<T> {
  const clave = Deno.env.get('STRIPE_SECRET_KEY');
  if (!clave) throw new ErrorStripe(500, 'Falta la clave de Stripe (secreto STRIPE_SECRET_KEY en Supabase).');
  const datos = new URLSearchParams();
  if (params) aplanar(params, '', datos);
  const url = `https://api.stripe.com/v1/${ruta}${metodo === 'GET' && params ? `?${datos}` : ''}`;
  const cab: Record<string, string> = { Authorization: `Bearer ${clave}`, 'Stripe-Version': '2025-03-31.basil' };
  if (metodo !== 'GET') cab['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencia) cab['Idempotency-Key'] = idempotencia;
  const r = await fetch(url, { method: metodo, headers: cab, body: metodo === 'GET' ? undefined : datos });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorStripe(r.status, `Stripe: ${j?.error?.message || r.statusText}`, j?.error?.code);
  return j as T;
}

/** Precio a partir de su lookup_key (id, producto y medidor). */
export async function precioPorClave(lookup: string): Promise<{ id: string; product: string; recurring?: { meter?: string | null } }> {
  const r = await stripe<{ data: { id: string; product: string; recurring?: { meter?: string | null } }[] }>('GET', 'prices', { 'lookup_keys': [lookup], active: true });
  if (!r.data?.length) throw new ErrorStripe(400, `No existe en Stripe el precio «${lookup}».`);
  return r.data[0];
}
/** Id de un precio a partir de su lookup_key. */
export const idPrecio = async (lookup: string) => (await precioPorClave(lookup)).id;

/** Importe en céntimos para Stripe, con decimales si hace falta (13,125 € -> «1312.5»). */
export const centimos = (euros: number) => String(Math.round(euros * 100000) / 1000);

/** Marca de tiempo (segundos) del día 1 de un mes a las 00:00 en Madrid. */
export function inicioMesMadrid(anio: number, mes0: number) {
  // Probamos con UTC+1 y UTC+2 y nos quedamos con el que en Madrid da las 00:00 del día 1
  for (const desfase of [1, 2]) {
    const t = Date.UTC(anio, mes0, 1, 0, 0) - desfase * 3600_000;
    const partes = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
    const dia = partes.find((p) => p.type === 'day')?.value, hora = partes.find((p) => p.type === 'hour')?.value;
    if (dia === '01' && hora === '00') return Math.floor(t / 1000);
  }
  return Math.floor((Date.UTC(anio, mes0, 1) - 3600_000) / 1000);
}
