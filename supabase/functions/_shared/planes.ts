// Planes y precios de Fuelfy (sin IVA). Deben coincidir con docs/legal/condiciones.html (apartado 5),
// la calculadora de la portada y los precios de Stripe (lookup_key entre paréntesis).
export type Plan = 'esencial' | 'pro' | 'flota';
export type Pago = 'mensual' | 'anual';

// Tramos graduados por camión y mes: [último camión del tramo, precio]
export const PLANES: Record<Plan, { nombre: string; min: number; max: number; tramos: [number, number][] }> = {
  esencial: { nombre: 'Esencial', min: 2, max: 5, tramos: [[Infinity, 20]] },               // esencial_mensual / esencial_anual
  pro: { nombre: 'Pro', min: 5, max: 49, tramos: [[25, 30], [Infinity, 27]] },               // pro_mensual / pro_anual
  flota: { nombre: 'Flota', min: 50, max: Infinity, tramos: [[74, 25], [99, 20], [Infinity, 17.5]] },   // flota_mensual / flota_anual
};
export const MESES_PAGADOS_ANUAL = 10;   // pagando el año: dos meses gratis
export const DESCUENTO_FUNDADORAS = 0.25; // en lugar de los dos meses gratis (cupón FUNDADORAS)

export const esPlan = (p: unknown): p is Plan => p === 'esencial' || p === 'pro' || p === 'flota';
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

/** lookup_key del precio de Stripe. */
export const precioStripe = (plan: Plan, pago: Pago, fundadora = false) =>
  pago === 'mensual' ? `${plan}_mensual` : fundadora ? `${plan}_anual_fundadoras` : `${plan}_anual`;

/** Valor que se manda al medidor cada día: en mensual, los camiones facturables; en anual, los que pasan de lo pagado. */
export function valorMedidor(plan: Plan, pago: Pago, maximo: number, pagados: number | null) {
  return pago === 'mensual' ? facturables(plan, maximo) : Math.max(0, maximo - (pagados || 0));
}

export const tramosLegibles = (plan: Plan) =>
  PLANES[plan].tramos.map(([hasta, precio], i, t) => ({ desde: i ? t[i - 1][0] + 1 : 1, hasta: hasta === Infinity ? null : hasta, precio }));
