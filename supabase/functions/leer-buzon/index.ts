// Fuelfy · lector del buzón de precios (fuelfy@fuelfy.app, Hostinger)
//
// Lo llama pg_cron cada 5 minutos (tarea «leer-buzon»). Entra por IMAP en el buzón y, por cada email
// de la bandeja de entrada:
//   1. averigua desde qué direcciones se reenvió (cada empresa da de alta las suyas en la app),
//   2. manda texto, HTML y adjuntos a la función recibir-precios,
//   3. lo mueve a la carpeta «Procesados» (o «Sin empresa» si no es de ninguna).
// Los emails con los que un proveedor de correo pide confirmar el reenvío automático (Gmail, one.com…) no son de precios:
// van a la carpeta «Confirmaciones», donde el administrador los abre y los confirma.
// Si recibir-precios no responde, el email se queda en la bandeja y se reintenta en la siguiente pasada.
//
// POST con cabecera x-buzon-token (el token está en Vault como «leer_buzon_token»; su hash, en ajustes.buzon_token_sha256).
//   Cuerpo opcional: { origen?: 'cron' | 'manual', esperar?: true, solo_listar?: true }
//   - esperar: responde al terminar, con el resumen (si no, responde enseguida y trabaja en segundo plano).
//   - solo_listar: entra en el buzón y cuenta los emails, sin procesar ni mover nada.
// Secretos: IMAP_PASSWORD (obligatorio). Opcionales: IMAP_HOST, IMAP_USER, DOMINIO.
import { createClient } from 'npm:@supabase/supabase-js@2';
import PostalMime from 'npm:postal-mime@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import { esConfirmacion } from './confirmaciones.ts';

const IMAP_HOST = Deno.env.get('IMAP_HOST') || 'imap.hostinger.com';
const IMAP_USER = Deno.env.get('IMAP_USER') || 'fuelfy@fuelfy.app';
const DOMINIO = Deno.env.get('DOMINIO') || 'fuelfy.app';
const API = `${Deno.env.get('SUPABASE_URL')}/functions/v1/recibir-precios`;
const MAX_ADJUNTO = 8 * 1024 * 1024;
const PRESUPUESTO_MS = 100_000;   // a partir de aquí no se empiezan emails nuevos (quedan para la siguiente pasada)

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function sha256(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------------------------
// Cliente IMAP mínimo (IMAP4rev1 sobre TLS): solo lo necesario para este buzón
// ---------------------------------------------------------------------------------------------
type Respuesta = { texto: string; literales: Uint8Array[] };   // una respuesta, con los literales {n} que traiga

class Imap {
  private conn!: Deno.TlsConn;
  private buf = new Uint8Array(0);
  private n = 0;
  private enc = new TextEncoder();
  private dec = new TextDecoder('latin1');
  capacidades = new Set<string>();

  async conectar(host: string, puerto = 993) {
    this.conn = await Deno.connectTls({ hostname: host, port: puerto });
    const saludo = await this.leerRespuesta();
    if (!/^\* (OK|PREAUTH)/i.test(saludo.texto)) throw new Error(`Saludo IMAP inesperado: ${saludo.texto.slice(0, 120)}`);
  }

  private async llenar() {
    const trozo = new Uint8Array(64 * 1024);
    const leidos = await this.conn.read(trozo);
    if (leidos === null) throw new Error('El servidor IMAP cerró la conexión');
    const nuevo = new Uint8Array(this.buf.length + leidos);
    nuevo.set(this.buf); nuevo.set(trozo.subarray(0, leidos), this.buf.length);
    this.buf = nuevo;
  }

  private async leerLinea(): Promise<string> {
    for (;;) {
      for (let i = 0; i + 1 < this.buf.length; i++) {
        if (this.buf[i] === 13 && this.buf[i + 1] === 10) {
          const linea = this.dec.decode(this.buf.subarray(0, i));
          this.buf = this.buf.slice(i + 2);
          return linea;
        }
      }
      await this.llenar();
    }
  }

  // Lee n bytes directamente en su destino (los emails con PDF pueden ocupar varios MB)
  private async leerBytes(n: number): Promise<Uint8Array> {
    const out = new Uint8Array(n);
    let lleno = Math.min(n, this.buf.length);
    out.set(this.buf.subarray(0, lleno));
    this.buf = this.buf.slice(lleno);
    while (lleno < n) {
      const leidos = await this.conn.read(out.subarray(lleno));
      if (leidos === null) throw new Error('El servidor IMAP cerró la conexión');
      lleno += leidos;
    }
    return out;
  }

  // Una respuesta completa: si la línea acaba en {n}, se leen n bytes y se sigue con el resto de la línea
  private async leerRespuesta(): Promise<Respuesta> {
    let texto = '';
    const literales: Uint8Array[] = [];
    for (;;) {
      const linea = await this.leerLinea();
      const m = linea.match(/\{(\d+)\}$/);
      if (!m) return { texto: texto + linea, literales };
      texto += linea;
      literales.push(await this.leerBytes(+m[1]));
    }
  }

  private async escribir(s: string | Uint8Array) {
    let datos = typeof s === 'string' ? this.enc.encode(s) : s;
    while (datos.length) datos = datos.subarray(await this.conn.write(datos));
  }

  // Manda un comando (con literales opcionales, que esperan la continuación «+») y recoge las respuestas
  async comando(partes: (string | { literal: Uint8Array })[]): Promise<Respuesta[]> {
    const etiqueta = `F${++this.n}`;
    const respuestas: Respuesta[] = [];
    let linea = `${etiqueta} `;
    for (const p of partes) {
      if (typeof p === 'string') { linea += p; continue; }
      await this.escribir(`${linea}{${p.literal.length}}\r\n`);
      for (;;) {
        const r = await this.leerRespuesta();
        if (r.texto.startsWith('+')) break;
        if (r.texto.startsWith(etiqueta)) throw new Error(`IMAP rechazó el comando: ${r.texto.slice(etiqueta.length + 1, 200)}`);
        respuestas.push(r);
      }
      await this.escribir(p.literal);
      linea = '';
    }
    await this.escribir(`${linea}\r\n`);
    for (;;) {
      const r = await this.leerRespuesta();
      if (r.texto.startsWith(`${etiqueta} `)) {
        const estado = r.texto.slice(etiqueta.length + 1);
        if (!/^OK/i.test(estado)) throw new ErrorImap(estado);
        const cap = estado.match(/\[CAPABILITY ([^\]]+)\]/i);
        if (cap) this.capacidades = new Set(cap[1].toUpperCase().split(' '));
        return respuestas;
      }
      const cap = r.texto.match(/^\* CAPABILITY (.+)$/i);
      if (cap) this.capacidades = new Set(cap[1].toUpperCase().split(' '));
      respuestas.push(r);
    }
  }

  async cerrar() {
    try { await this.comando(['LOGOUT']); } catch { /* da igual */ }
    try { this.conn.close(); } catch { /* ya cerrada */ }
  }
}
class ErrorImap extends Error {}

// Cadena IMAP: entre comillas si es ASCII sin saltos de línea; si no, como literal
const cadena = (s: string): string | { literal: Uint8Array } =>
  /^[\x20-\x7e]*$/.test(s) ? `"${s.replace(/[\\"]/g, (c) => '\\' + c)}"` : { literal: new TextEncoder().encode(s) };

// Nombres de las carpetas del LIST: «* LIST (\HasNoChildren) "." "INBOX.Procesados"»
function carpetasDe(respuestas: Respuesta[]) {
  const out: { nombre: string; sep: string }[] = [];
  for (const r of respuestas) {
    const m = r.texto.match(/^\* LIST \([^)]*\) (?:"((?:[^"\\]|\\.)*)"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))?$/i);
    if (!m) continue;
    const nombre = r.literales.length && !m[2] && !m[3] ? new TextDecoder().decode(r.literales[0]) : (m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1');
    out.push({ nombre, sep: (m[1] ?? '.').replace(/\\(.)/g, '$1') });
  }
  return out;
}

// Nombre real de la carpeta (Hostinger usa INBOX.<nombre>); la crea si no existe
async function carpeta(imap: Imap, existentes: { nombre: string; sep: string }[], nombre: string) {
  const sep = existentes.find((c) => c.sep)?.sep || '.';
  const candidatos = [`INBOX${sep}${nombre}`, nombre];
  const hay = candidatos.find((c) => existentes.some((e) => e.nombre.toLowerCase() === c.toLowerCase()));
  if (hay) return existentes.find((e) => e.nombre.toLowerCase() === hay.toLowerCase())!.nombre;
  for (const c of candidatos) {
    try { await imap.comando(['CREATE ', cadena(c) as string]); return c; } catch { /* se prueba el siguiente */ }
  }
  throw new Error(`No se ha podido crear la carpeta ${nombre}`);
}

async function mover(imap: Imap, uid: string, destino: string) {
  if (imap.capacidades.has('MOVE')) {
    await imap.comando([`UID MOVE ${uid} `, cadena(destino) as string]);
  } else {
    await imap.comando([`UID COPY ${uid} `, cadena(destino) as string]);
    await imap.comando([`UID STORE ${uid} +FLAGS.SILENT (\\Deleted)`]);
  }
}

// ---------------------------------------------------------------------------------------------
// Lectura del email (misma lógica que tenía el lector de Python)
// ---------------------------------------------------------------------------------------------
// Cabeceras con la cuenta que reenvió el email, de más fiable a menos. El «De:» va después de las
// que añaden los reenvíos automáticos, porque esos reenvíos a veces conservan el remitente original.
const CABECERAS_REMITENTE = ['resent-from', 'resent-sender', 'x-forwarded-for', 'x-original-sender', 'x-original-from',
  'sender', 'from', 'return-path'];
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

function remitentesDelEmail(cabeceras: { key: string; value: string }[]) {
  const vistos: string[] = [];
  const anadir = (d: string) => {
    d = d.trim().replace(/^<|>$/g, '').toLowerCase();
    if (d.includes('@') && !d.endsWith('@' + DOMINIO) && !vistos.includes(d)) vistos.push(d);
  };
  for (const cab of CABECERAS_REMITENTE) {
    for (const h of cabeceras.filter((x) => x.key.toLowerCase() === cab)) {
      const valor = String(h.value || '');
      // «Nombre <direccion>»: vale la de los <>; si no hay, cualquier dirección del valor
      const entreAngulos = [...valor.matchAll(/<([^<>\s]+@[^<>\s]+)>/g)].map((m) => m[1]);
      for (const d of entreAngulos.length ? entreAngulos : (valor.match(RE_EMAIL) || [])) anadir(d);
    }
  }
  return vistos;
}

type Contenido = { textos: string[]; htmls: string[]; adjuntos: { nombre: string; tipo: string; base64: string }[] };

// Texto, HTML y adjuntos. Incluye el contenido de los emails reenviados como adjunto (message/rfc822).
async function contenido(crudo: Uint8Array | ArrayBuffer, acc: Contenido = { textos: [], htmls: [], adjuntos: [] }, nivel = 0) {
  const msg = await PostalMime.parse(crudo);
  if (msg.text) acc.textos.push(msg.text);
  if (msg.html) acc.htmls.push(msg.html);
  for (const a of msg.attachments || []) {
    const bytes = typeof a.content === 'string' ? new TextEncoder().encode(a.content) : new Uint8Array(a.content as ArrayBuffer);
    if (/^message\/rfc822$/i.test(a.mimeType || '') && nivel < 3) {
      try { await contenido(bytes, acc, nivel + 1); continue; } catch { /* si no se puede leer, va como adjunto */ }
    }
    if (bytes.length && bytes.length < MAX_ADJUNTO) {
      acc.adjuntos.push({ nombre: a.filename || 'adjunto', tipo: a.mimeType || 'application/octet-stream', base64: encodeBase64(bytes) });
    }
  }
  return { msg, acc };
}

const MESES_IMAP = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
async function recuperarSinEmpresa(imap: Imap, nombre: string, log: string[]) {
  await imap.comando(['SELECT ', cadena(nombre) as string]);
  const d = new Date(Date.now() - 14 * 864e5);
  const desde = `${d.getUTCDate()}-${MESES_IMAP[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
  const r = await imap.comando([`UID SEARCH SINCE ${desde}`]);
  const uids = r.flatMap((x) => x.texto.match(/^\* SEARCH(.*)$/i)?.[1].trim().split(/\s+/).filter(Boolean) ?? []);
  if (!uids.length) return;
  const { data: altas, error } = await sb.from('empresa_remitentes').select('remitente');
  if (error) throw new Error(error.message);
  const dadas = new Set((altas || []).map((a) => String(a.remitente).toLowerCase()));
  let n = 0;
  for (const uid of uids) {
    const p = await imap.comando([`UID FETCH ${uid} (BODY.PEEK[HEADER])`]);
    const cab = p.find((x) => /FETCH/i.test(x.texto) && x.literales.length)?.literales[0];
    if (!cab) continue;
    const msg = await PostalMime.parse(cab);
    const rems = remitentesDelEmail((msg.headers || []) as { key: string; value: string }[]);
    if (!rems.some((x) => dadas.has(x))) continue;
    await mover(imap, uid, 'INBOX');
    log.push(`· Recuperado de «Sin empresa» (${rems.find((x) => dadas.has(x))} ya está dado de alta): «${String(msg.subject || '').slice(0, 80)}»`);
    n++;
  }
  if (n && !imap.capacidades.has('MOVE')) await imap.comando(['EXPUNGE']);
}

async function llamar(cuerpo: unknown, token: string): Promise<[number, Record<string, any>]> {
  try {
    const r = await fetch(API, {
      method: 'POST', body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(60_000),
      headers: { 'Content-Type': 'application/json', 'x-ingesta-token': token },
    });
    let datos: Record<string, any> = {};
    try { datos = await r.json(); } catch { /* sin cuerpo */ }
    return [r.status, datos];
  } catch (e) {
    return [0, { error: String(e) }];
  }
}

// ---------------------------------------------------------------------------------------------
// Una pasada por el buzón
// ---------------------------------------------------------------------------------------------
async function pasada(token: string, soloListar: boolean) {
  const inicio = Date.now();
  const log: string[] = [];
  const resumen = { ok: 0, sin_empresa: 0, confirmaciones: 0, reintentar: 0, pendientes: 0, en_bandeja: 0 };
  const bruta = Deno.env.get('IMAP_PASSWORD') || '';
  const password = bruta.trim();   // al pegarla en el panel a veces se cuela un espacio o un salto de línea
  if (!password) throw new Error('Falta el secreto IMAP_PASSWORD en Supabase (Edge Functions → Secrets)');
  if (password !== bruta) log.push('Aviso: la contraseña guardada tenía espacios o saltos de línea al principio o al final; se han quitado');

  const imap = new Imap();
  await imap.conectar(IMAP_HOST);
  try {
    try {
      await imap.comando(['LOGIN ', cadena(IMAP_USER) as string, ' ', cadena(password)]);
    } catch (e) {
      throw new Error(`${String(e)}${log.length ? ' · ' + log.join(' · ') : ''}`);
    }
    if (!imap.capacidades.size) await imap.comando(['CAPABILITY']);
    const existentes = carpetasDe(await imap.comando(['LIST "" "*"']));
    log.push(`Carpetas: ${existentes.map((c) => c.nombre).join(', ')}`);

    // Emails de las últimas 2 semanas que quedaron en «Sin empresa» y cuyo remitente ya se ha dado de alta en la app:
    // vuelven a la bandeja de entrada y se procesan en esta misma pasada
    const sinEmpresaExistente = existentes.find((c) => /^(INBOX[.\/])?Sin empresa$/i.test(c.nombre))?.nombre;
    if (sinEmpresaExistente && !soloListar) {
      try { await recuperarSinEmpresa(imap, sinEmpresaExistente, log); }
      catch (e) { if (e instanceof ErrorImap) throw e; log.push(`Aviso: no se ha podido revisar «Sin empresa» (${String(e).slice(0, 200)})`); }
    }

    await imap.comando(['SELECT INBOX']);
    const busqueda = await imap.comando(['UID SEARCH ALL']);
    const uids = busqueda.flatMap((r) => r.texto.match(/^\* SEARCH(.*)$/i)?.[1].trim().split(/\s+/).filter(Boolean) ?? []);
    resumen.en_bandeja = uids.length;
    log.push(`${uids.length} email(s) en la bandeja de entrada`);
    if (soloListar || !uids.length) return { resumen, log };

    const procesados = await carpeta(imap, existentes, 'Procesados');
    const sinEmpresa = await carpeta(imap, existentes, 'Sin empresa');
    let confirmaciones = '';   // se crea la primera vez que hace falta
    await imap.comando(['SELECT INBOX']);   // CREATE no cambia la carpeta abierta, pero por si acaso

    for (const uid of uids) {
      if (Date.now() - inicio > PRESUPUESTO_MS) { resumen.pendientes = uids.length - resumen.ok - resumen.sin_empresa - resumen.confirmaciones - resumen.reintentar; break; }
      const partes = await imap.comando([`UID FETCH ${uid} (BODY.PEEK[])`]);
      const crudo = partes.find((p) => /FETCH/i.test(p.texto) && p.literales.length)?.literales[0];
      if (!crudo) continue;

      let asunto = '?';
      try {
        const { msg, acc } = await contenido(crudo);
        asunto = String(msg.subject || '');
        const remitentes = remitentesDelEmail((msg.headers || []) as { key: string; value: string }[]);
        let fecha: string | null = null;
        if (msg.date) { const d = new Date(msg.date); if (!isNaN(+d)) fecha = d.toISOString(); }
        const de = msg.from ? (msg.from.name ? `${msg.from.name} <${msg.from.address}>` : String(msg.from.address || '')) : '';
        const texto = acc.textos.join('\n\n'), html = acc.htmls.join('\n');

        // ¿Es un aviso para confirmar el reenvío automático?
        const deDir = String(msg.from?.address || '').toLowerCase();
        const nPdf = acc.adjuntos.filter((a) => /pdf/i.test(a.tipo) || /\.pdf$/i.test(a.nombre)).length;
        if (esConfirmacion({ remitente: deDir, asunto, texto, html, nAdjuntosPdf: nPdf })) {
          if (!confirmaciones) confirmaciones = await carpeta(imap, existentes, 'Confirmaciones');
          await mover(imap, uid, confirmaciones);
          log.push(`· Confirmación de reenvío (${deDir || '?'}): «${asunto.slice(0, 80)}» → carpeta Confirmaciones`);
          resumen.confirmaciones++;
          continue;
        }
        const [codigo, datos] = await llamar({
          remitentes, remitente: de, asunto, fecha,
          texto, html, adjuntos: acc.adjuntos,
        }, token);
        const quien = remitentes[0] || '?';
        if (codigo === 404 && datos.sin_empresa) {
          log.push(`· Sin empresa (${remitentes.slice(0, 4).join(', ') || 'sin remitente'}): «${asunto.slice(0, 80)}» → carpeta Sin empresa`);
          await mover(imap, uid, sinEmpresa);
          resumen.sin_empresa++;
          continue;
        }
        if (codigo === 0 || codigo >= 500) {
          log.push(`· ${quien}: «${asunto.slice(0, 80)}» → la app no responde (${codigo}); se reintentará`);
          resumen.reintentar++;
          continue;
        }
        log.push(`· ${quien}: «${asunto.slice(0, 80)}» → ${codigo} ${JSON.stringify(datos).slice(0, 300)}`);
        await mover(imap, uid, procesados);
        resumen.ok++;
      } catch (e) {
        if (e instanceof ErrorImap) throw e;
        log.push(`· «${asunto.slice(0, 80)}» → no se ha podido leer (${String(e).slice(0, 200)}); se reintentará`);
        resumen.reintentar++;
      }
    }
    if (!imap.capacidades.has('MOVE')) await imap.comando(['EXPUNGE']);
    return { resumen, log };
  } finally {
    await imap.cerrar();
  }
}

async function ejecutar(token: string, origen: string, soloListar: boolean) {
  // Se apunta la ejecución; si hay otra en marcha (de hace menos de 4 minutos), no se hace nada
  const { data: id, error } = await sb.rpc('buzon_empezar', { p_origen: soloListar ? `${origen} (solo listar)` : origen });
  if (error) throw new Error(error.message);
  if (id === null) return { ocupado: true };
  try {
    const r = await pasada(token, soloListar);
    await sb.from('buzon_ejecuciones').update({ fin: new Date().toISOString(), resumen: r.resumen, log: r.log.join('\n') }).eq('id', id);
    console.log(JSON.stringify(r.resumen), '\n' + r.log.join('\n'));
    return r;
  } catch (e) {
    await sb.from('buzon_ejecuciones').update({ fin: new Date().toISOString(), error: String(e).slice(0, 1000) }).eq('id', id);
    console.error('Error leyendo el buzón:', e);
    return { error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const token = req.headers.get('x-buzon-token') || '';
  const { data: aj } = await sb.from('ajustes').select('valor').eq('clave', 'buzon_token_sha256').maybeSingle();
  if (!token || !aj?.valor || (await sha256(token)) !== aj.valor) return json({ error: 'No autorizado' }, 401);

  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { /* sin cuerpo */ }
  const origen = String(b.origen || 'manual').slice(0, 40);

  if (b.esperar) return json(await ejecutar(token, origen, !!b.solo_listar));
  // @ts-ignore EdgeRuntime existe en Supabase
  EdgeRuntime.waitUntil(ejecutar(token, origen, !!b.solo_listar));
  return json({ ok: true, en_marcha: true }, 202);
});
