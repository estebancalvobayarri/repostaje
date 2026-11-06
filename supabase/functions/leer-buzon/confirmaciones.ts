// Reconoce los emails con los que un proveedor de correo (Gmail, one.com, Outlook, Zoho…) pide confirmar
// que se reenvíe el correo a fuelfy@fuelfy.app, y saca de ellos el enlace y el código de confirmación.
// Sin dependencias, para poder probarlo aparte.

// «reenvío» y «confirmar» en los idiomas habituales de los proveedores (es, en, da/no/sv de one.com, de, fr, it, pt, nl)
const REENVIO = String.raw`(?:reenv[ií]|redirecci|redirig|forward|videresend|vidarebefordr|weiterleit|transf[eé]r|r[eé]exp[eé]di|inoltr|reencaminh|encaminh|doorstur)`;
const CONFIRMAR = String.raw`(?:confirm|verifi|valid|aprob|autoriz|acept|accept|approv|activ|bekr[æa]ft|bestätig|best[aä]tig|bevestig|conferm|confirmer)`;
const CERCA = 120;   // caracteres como mucho entre una palabra y la otra
const RE_CONFIRMACION = new RegExp(`${REENVIO}[\\s\\S]{0,${CERCA}}${CONFIRMAR}|${CONFIRMAR}[\\s\\S]{0,${CERCA}}${REENVIO}`, 'i');
// Remitentes que solo mandan este tipo de avisos
const REMITENTES_CONOCIDOS = /^(forwarding-noreply@google\.com|.*forward.*@|.*noreply@one\.com)$/i;
// Si aparece la marca de un proveedor de precios, es un email de precios aunque lo hayan reenviado con un texto de confirmación
const MARCAS_PRECIOS = /VALCARCE\s+TARJETA|dstfuelcard|DIESEL SERVICES & TRUCKS|staroil\.es|PRECIOS STAROIL|andamur\.com|Andamur, precios para/i;

export type Confirmacion = { enlaces: string[]; codigo: string | null; direcciones: string[]; texto: string };

const ENT: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', aelig: 'æ', oslash: 'ø', aring: 'å', uuml: 'ü', ouml: 'ö', auml: 'ä' };
const desHtml = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
export function htmlATexto(html: string) {
  return desHtml(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function esConfirmacion(p: { remitente: string; asunto: string; texto: string; html: string; nAdjuntosPdf: number }) {
  const cuerpo = p.texto || htmlATexto(p.html);
  if (MARCAS_PRECIOS.test(`${p.asunto}\n${cuerpo}\n${p.html}`)) return false;
  if (p.nAdjuntosPdf > 0) return false;                       // los avisos de confirmación no traen PDF
  if (RE_CONFIRMACION.test(p.asunto)) return true;
  if (REMITENTES_CONOCIDOS.test(p.remitente) && /\b(?:https?:\/\/|\d{6,})/.test(cuerpo)) return true;
  // En el cuerpo: tiene que ser un email corto y traer un enlace o un código
  return cuerpo.length < 8000 && RE_CONFIRMACION.test(cuerpo) && (/https?:\/\//.test(cuerpo + p.html) || /\b\d{5,10}\b/.test(cuerpo));
}

const URL_RE = /https?:\/\/[^\s"'<>()]+/gi;
const ENLACE_BUENO = /confirm|verif|valid|accept|aprob|approv|activ|forward|reenv|token|code|codigo|key|bekr|bestaet|best%C3%A4|auth/i;
const ENLACE_MALO = /unsubscribe|baja|privacy|privacidad|terms|support\.|help\.|\/help|soporte|\.(png|jpe?g|gif|svg|css)(\?|$)|fonts\.|schema\.org|w3\.org/i;

export function extraer(p: { asunto: string; texto: string; html: string; dominioPropio: string; remitente: string }): Confirmacion {
  const texto = p.texto || htmlATexto(p.html);
  // Enlaces: los href del HTML y las URL del texto, sin repetir; primero los que parecen de confirmación
  const crudos = [...(p.html.match(/href\s*=\s*["']([^"']+)["']/gi) || []).map((h) => desHtml(h.replace(/^href\s*=\s*["']|["']$/gi, ''))), ...(texto.match(URL_RE) || [])]
    .map((u) => u.replace(/[.,;:!?)\]]+$/, '')).filter((u) => /^https?:\/\//i.test(u) && !ENLACE_MALO.test(u));
  const unicos = [...new Set(crudos)];
  const buenos = unicos.filter((u) => ENLACE_BUENO.test(u));
  const enlaces = (buenos.length ? buenos : unicos).slice(0, 4);

  // Código: «código de confirmación: 123456», «Confirmation code: 123456789», «kode: AB12CD»…
  let codigo: string | null = null;
  const m = texto.match(/(?:c[oó]digo|code|kode|c[oó]d\.|pin|token)\b[^\n\d]{0,40}?([A-Z0-9]{4,12}(?:-[A-Z0-9]{2,8})?)\b/i)
    || `${p.asunto}`.match(/#?\b(\d{6,10})\b/);
  if (m && /\d/.test(m[1])) codigo = m[1];

  // Direcciones que aparecen (la que pidió el reenvío suele estar en el texto), sin las nuestras ni la del proveedor
  const direcciones = [...new Set(`${p.asunto}\n${texto}`.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [])]
    .map((d) => d.toLowerCase()).filter((d) => !d.endsWith('@' + p.dominioPropio) && d !== p.remitente.toLowerCase()).slice(0, 10);

  return { enlaces, codigo, direcciones, texto: texto.slice(0, 4000) };
}
