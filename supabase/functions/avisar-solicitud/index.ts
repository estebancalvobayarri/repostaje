// Fuelfy · aviso por email de cada solicitud de prueba que llega desde la portada
//
// La llama la base de datos (trigger «solicitudes_avisar», con pg_net) al insertar una fila en `solicitudes`.
// Lee la solicitud por su id (no se fía de lo que venga en la petición) y manda un email a AVISO_PARA
// desde el buzón de Hostinger (fuelfy@fuelfy.app) por SMTP. Responder al email contesta al solicitante.
// Apunta el resultado en solicitudes.aviso_enviado / aviso_error. Una solicitud ya avisada no se vuelve a mandar
// (salvo con { repetir: true }).
//
// POST con cabecera x-aviso-token (el token está en Vault como «aviso_solicitud_token»; su hash, en ajustes.aviso_token_sha256).
//   Cuerpo: { id: uuid, repetir?: true }
// Secretos: IMAP_PASSWORD (la del buzón; vale también para SMTP). Opcionales: IMAP_USER, SMTP_HOST, AVISO_PARA.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const SMTP_HOST = Deno.env.get('SMTP_HOST') || 'smtp.hostinger.com';
const SMTP_USER = Deno.env.get('IMAP_USER') || 'fuelfy@fuelfy.app';
const PARA = Deno.env.get('AVISO_PARA') || 'hola@fuelfy.app';
const ADMIN = 'https://fuelfy.app/app/';

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
// Cliente SMTP mínimo (TLS directo en el puerto 465, AUTH LOGIN)
// ---------------------------------------------------------------------------------------------
class Smtp {
  private conn!: Deno.TlsConn;
  private buf = '';
  private enc = new TextEncoder();
  private dec = new TextDecoder();

  async conectar(host: string, puerto = 465) {
    this.conn = await Deno.connectTls({ hostname: host, port: puerto });
    await this.esperar(220);
  }
  private async linea(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf('\r\n');
      if (i >= 0) { const l = this.buf.slice(0, i); this.buf = this.buf.slice(i + 2); return l; }
      const trozo = new Uint8Array(8192);
      const n = await this.conn.read(trozo);
      if (n === null) throw new Error('El servidor SMTP cerró la conexión');
      this.buf += this.dec.decode(trozo.subarray(0, n));
    }
  }
  // Respuesta (puede ser de varias líneas: «250-…» hasta «250 …»); falla si el código no es el esperado
  private async esperar(codigo: number) {
    let l: string, todo = '';
    do { l = await this.linea(); todo += l + '\n'; } while (/^\d{3}-/.test(l));
    if (!l.startsWith(String(codigo))) throw new Error(`SMTP: esperaba ${codigo} y ha respondido «${todo.trim().slice(0, 300)}»`);
    return todo;
  }
  private async escribir(s: string) {
    let d = this.enc.encode(s);
    while (d.length) d = d.subarray(await this.conn.write(d));
  }
  async cmd(s: string, codigo: number) { await this.escribir(s + '\r\n'); return await this.esperar(codigo); }

  async enviar(usuario: string, password: string, de: string, para: string, mensaje: string) {
    await this.cmd('EHLO fuelfy.app', 250);
    await this.cmd('AUTH LOGIN', 334);
    await this.cmd(encodeBase64(usuario), 334);
    await this.cmd(encodeBase64(password), 235);
    await this.cmd(`MAIL FROM:<${de}>`, 250);
    await this.cmd(`RCPT TO:<${para}>`, 250);
    await this.cmd('DATA', 354);
    // El cuerpo va en base64, así que ninguna línea empieza por «.»; aun así se escapan por si acaso
    await this.escribir(mensaje.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.\r\n');
    await this.esperar(250);
  }
  async cerrar() {
    try { await this.cmd('QUIT', 221); } catch { /* da igual */ }
    try { this.conn.close(); } catch { /* ya cerrada */ }
  }
}

// ---------------------------------------------------------------------------------------------
// El email
// ---------------------------------------------------------------------------------------------
const b64 = (s: string) => encodeBase64(new TextEncoder().encode(s));
const cabecera = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
const limpio = (s: unknown) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const envolver = (s: string) => s.match(/.{1,76}/g)?.join('\r\n') ?? '';

function redactar(s: Record<string, any>) {
  const fecha = new Date(s.creado).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'full', timeStyle: 'short' });
  const tarjetas = Array.isArray(s.tarjetas) && s.tarjetas.length ? s.tarjetas.join(', ') : '—';
  const texto = [
    'Nueva solicitud de prueba desde la portada de Fuelfy.',
    '',
    `Nombre:     ${limpio(s.nombre)}`,
    `Empresa:    ${limpio(s.empresa)}`,
    `Email:      ${limpio(s.email)}`,
    `Teléfono:   ${limpio(s.telefono) || '—'}`,
    `Camiones:   ${s.camiones ?? '—'}`,
    `Tarjetas:   ${tarjetas}`,
    `Recibida:   ${fecha}`,
    '',
    'Mensaje:',
    String(s.mensaje || '—').trim(),
    '',
    '—',
    `Responde a este email para contestar a ${limpio(s.nombre)} directamente.`,
    `Puedes marcarla como atendida en Administración › Solicitudes: ${ADMIN}`,
  ].join('\n');
  const asunto = `Nueva solicitud de prueba: ${limpio(s.empresa)} (${s.camiones ?? '?'} camiones)`;
  return [
    `From: ${cabecera('Fuelfy')} <${SMTP_USER}>`,
    `To: <${PARA}>`,
    `Reply-To: ${cabecera(limpio(s.nombre))} <${limpio(s.email)}>`,
    `Subject: ${cabecera(asunto)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <solicitud-${s.id}-${Date.now()}@fuelfy.app>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    envolver(b64(texto)),
  ].join('\r\n');
}

async function avisar(id: string, repetir: boolean) {
  const { data: s, error } = await sb.from('solicitudes').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!s) return { error: 'No existe esa solicitud', status: 404 };
  if (s.aviso_enviado && !repetir) return { ok: true, ya_enviado: s.aviso_enviado };

  const password = (Deno.env.get('IMAP_PASSWORD') || '').trim();
  try {
    if (!password) throw new Error('Falta el secreto IMAP_PASSWORD en Supabase');
    const smtp = new Smtp();
    await smtp.conectar(SMTP_HOST);
    try { await smtp.enviar(SMTP_USER, password, SMTP_USER, PARA, redactar(s)); }
    finally { await smtp.cerrar(); }
    const ahora = new Date().toISOString();
    await sb.from('solicitudes').update({ aviso_enviado: ahora, aviso_error: null }).eq('id', id);
    return { ok: true, enviado: ahora, para: PARA };
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 500);
    await sb.from('solicitudes').update({ aviso_error: msg }).eq('id', id);
    console.error('No se ha podido avisar de la solicitud', id, msg);
    return { error: msg, status: 502 };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const token = req.headers.get('x-aviso-token') || '';
  const { data: aj } = await sb.from('ajustes').select('valor').eq('clave', 'aviso_token_sha256').maybeSingle();
  if (!token || !aj?.valor || (await sha256(token)) !== aj.valor) return json({ error: 'No autorizado' }, 401);
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { /* sin cuerpo */ }
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Falta el id de la solicitud' }, 400);
  const r = await avisar(id, !!b.repetir);
  return json(r, (r as any).status || 200);
});
