// Reconoce los emails con los que un proveedor de correo (Gmail, one.com, Outlook, Zoho…) pide confirmar
// que se reenvíe el correo a fuelfy@fuelfy.app. Sin dependencias, para poder probarlo aparte.

// «reenvío» y «confirmar» en los idiomas habituales de los proveedores (es, en, da/no/sv de one.com, de, fr, it, pt, nl)
const REENVIO = String.raw`(?:reenv[ií]|redirecci|redirig|forward|videresend|vidarebefordr|weiterleit|transf[eé]r|r[eé]exp[eé]di|inoltr|reencaminh|encaminh|doorstur)`;
const CONFIRMAR = String.raw`(?:confirm|verifi|valid|aprob|autoriz|acept|accept|approv|activ|bekr[æa]ft|bestätig|best[aä]tig|bevestig|conferm|confirmer)`;
const CERCA = 120;   // caracteres como mucho entre una palabra y la otra
const RE_CONFIRMACION = new RegExp(`${REENVIO}[\\s\\S]{0,${CERCA}}${CONFIRMAR}|${CONFIRMAR}[\\s\\S]{0,${CERCA}}${REENVIO}`, 'i');
// Remitentes que solo mandan este tipo de avisos
const REMITENTES_CONOCIDOS = /^(forwarding-noreply@google\.com|.*forward.*@|.*noreply@one\.com)$/i;
// Si aparece la marca de un proveedor de precios, es un email de precios aunque lo hayan reenviado con un texto de confirmación
const MARCAS_PRECIOS = /VALCARCE\s+TARJETA|dstfuelcard|DIESEL SERVICES & TRUCKS|staroil\.es|PRECIOS STAROIL|andamur\.com|Andamur, precios para/i;

const ENT: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', aelig: 'æ', oslash: 'ø', aring: 'å', uuml: 'ü', ouml: 'ö', auml: 'ä' };
const desHtml = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
function htmlATexto(html: string) {
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
