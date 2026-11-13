// Planes y precios de Fuelfy (sin IVA). Deben coincidir con docs/legal/condiciones.html (apartado 5),
// la calculadora de la portada y los precios de Stripe (lookup_key entre paréntesis).
export type Plan = 'esencial' | 'pro' | 'flota';
// mensual: a mes vencido por uso · anual: el año por adelantado en una factura · cuotas: el año (contrato de 12 meses,
// mismo precio que el anual) pagado en 12 cuotas mensuales por adelantado, con cargo automático
export type Pago = 'mensual' | 'anual' | 'cuotas';

// Tramos graduados por camión y mes: [último camión del tramo, precio]
export const PLANES: Record<Plan, { nombre: string; min: number; max: number; tramos: [number, number][] }> = {
  esencial: { nombre: 'Esencial', min: 2, max: 5, tramos: [[Infinity, 20]] },               // esencial_mensual / esencial_anual
  pro: { nombre: 'Pro', min: 5, max: 49, tramos: [[25, 30], [Infinity, 27]] },               // pro_mensual / pro_anual
  flota: { nombre: 'Flota', min: 50, max: Infinity, tramos: [[74, 25], [99, 20], [Infinity, 17.5]] },   // flota_mensual / flota_anual
};
export const MESES_PAGADOS_ANUAL = 10;   // pagando el año: dos meses gratis
export const DESCUENTO_FUNDADORAS = 0.25; // en lugar de los dos meses gratis (cupón FUNDADORAS)

export const esPlan = (p: unknown): p is Plan => p === 'esencial' || p === 'pro' || p === 'flota';
export const esPago = (p: unknown): p is Pago => p === 'mensual' || p === 'anual' || p === 'cuotas';
/** Pagos con contrato de 12 meses por un número fijo de camiones (los de más se cobran aparte, por uso). */
export const conPagados = (pago: unknown) => pago === 'anual' || pago === 'cuotas';
/** Formas de pago de cada plan: Esencial no se paga en cuotas (decisión del 13 nov 2026). */
export const pagoPermitido = (plan: Plan, pago: Pago) => !(plan === 'esencial' && pago === 'cuotas');
export const NOMBRE_PAGO: Record<Pago, string> = { mensual: 'mes a mes', anual: 'anual, de una vez', cuotas: 'anual, en 12 cuotas' };
export const planPara = (camiones: number): Plan => (camiones < 5 ? 'esencial' : camiones < 50 ? 'pro' : 'flota');

/** Cuota mensual de un número de camiones con los tramos de un plan (sin aplicar el mínimo). */
export function cuotaMensual(plan: Plan, camiones: number) {
  let total = 0, desde = 0;
  for (const [hasta, precio] of PLANES[plan].tramos) {
    const n = Math.max(0, Math.min(camiones, hasta) - desde);
    total += n * precio; desde = hasta;
    if (camiones <= hasta) break;
  }
  return Math.round(total * 100) / 100;
}

/** Camiones que se facturan en pago mensual: el máximo del mes, como mínimo el del plan. */
export const facturables = (plan: Plan, maximo: number) => Math.max(maximo, PLANES[plan].min);

/** Importe del año pagando por adelantado (normal: 10 meses; fundadora: 12 meses con un 25 % menos). */
export function cuotaAnual(plan: Plan, camiones: number, fundadora: boolean) {
  const mes = cuotaMensual(plan, camiones);
  return Math.round((fundadora ? mes * 12 * (1 - DESCUENTO_FUNDADORAS) : mes * MESES_PAGADOS_ANUAL) * 100) / 100;
}

/** Cuota de cada uno de los 12 meses pagando el año en cuotas: el importe anual entre 12 (sin redondear: Stripe
 *  guarda el precio por camión con decimales y redondea cada factura al céntimo). */
export const cuotaPlazo = (plan: Plan, camiones: number, fundadora: boolean) => cuotaAnual(plan, camiones, fundadora) / 12;

/** lookup_key del precio de Stripe. Cuotas: <plan>_cuotas = precio anual / 12, por mes y por adelantado;
 *  <plan>_cuotas_fundadoras = precio mensual, para usar con el cupón FUNDADORAS (−25 %). */
export const precioStripe = (plan: Plan, pago: Pago, fundadora = false) =>
  pago === 'mensual' ? `${plan}_mensual` : `${plan}_${pago}${fundadora ? '_fundadoras' : ''}`;

/** Descuento que se aplica a los camiones de más de un cliente con pago anual (de una vez o en cuotas): el 25 % si es fundadora; si no, ninguno. */
export const factorExtra = (fundadora: boolean) => (fundadora ? 1 - DESCUENTO_FUNDADORAS : 1);

/** Tramos de los camiones de más en pago anual: cada camión de más paga el precio mensual del tramo en el que cae
 *  (el primero de más es el camión pagados + 1), con el descuento del cliente. up_to = null en el último tramo. */
export function tramosExtra(plan: Plan, pagados: number, fundadora: boolean) {
  const f = factorExtra(fundadora), salida: { up_to: number | null; precio: number }[] = [];
  for (const [hasta, precio] of PLANES[plan].tramos) {
    if (hasta !== Infinity && hasta <= pagados) continue;   // tramo ya cubierto por los camiones pagados
    salida.push({ up_to: hasta === Infinity ? null : hasta - pagados, precio: Math.round(precio * f * 1000) / 1000 });
  }
  return salida;
}

/** Cuota de un mes por los camiones de más en pago anual (la misma cuenta que hace Stripe con tramosExtra). */
export function cuotaExtra(plan: Plan, pagados: number, extra: number, fundadora: boolean) {
  let total = 0, desde = 0;
  for (const t of tramosExtra(plan, pagados, fundadora)) {
    const hasta = t.up_to ?? Infinity, n = Math.max(0, Math.min(extra, hasta) - desde);
    total += n * t.precio; desde = hasta;
    if (extra <= hasta) break;
  }
  return Math.round(total * 100) / 100;
}

/** Valor que se manda al medidor cada día: en mensual, los camiones facturables; en anual o cuotas, los que pasan de lo pagado. */
export function valorMedidor(plan: Plan, pago: Pago, maximo: number, pagados: number | null) {
  return pago === 'mensual' ? facturables(plan, maximo) : Math.max(0, maximo - (pagados || 0));
}

export const tramosLegibles = (plan: Plan) =>
  PLANES[plan].tramos.map(([hasta, precio], i, t) => ({ desde: i ? t[i - 1][0] + 1 : 1, hasta: hasta === Infinity ? null : hasta, precio }));
