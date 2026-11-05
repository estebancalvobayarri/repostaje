// Recibe los emails de precios (los envía el script de Gmail), lee los precios
// con el lector de cada proveedor y los guarda en la empresa correspondiente.
//
// POST con cabecera x-ingesta-token. Cuerpo:
//   { accion: 'alias' }                         -> { buzon, aliases: [...] }
//   { alias, remitente, asunto, fecha, texto, html, adjuntos: [{ nombre, tipo, base64 }] }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getDocumentProxy } from 'npm:unpdf@0.12.1';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Precio = { codigo: string; nombre: string; sin_iva: number; con_iva: number | null; zona?: string };
type Lectura = { proveedor: string; fecha: string | null; cliente?: string; precios: Precio[] };

// ---------- utilidades de texto ----------
const numero = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.'));
const fechaIso = (d: string) => { const [dd, mm, yy] = d.split('/'); return `${yy}-${mm}-${dd}`; };
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const slug = (s: string) => sinAcentos(s.toUpperCase()).replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const limpiar = (s: string) => s.replace(/\s{2,}/g, ' ').trim();

const ENTIDADES: Record<string, string> = { nbsp: ' ', euro: '€', amp: '&', lt: '<', gt: '>', quot: '"', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', ordm: 'º', ordf: 'ª' };
function htmlATexto(html: string): string {
  return html
    .replace(/\r\n?/g, '\n')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(tr|p|div|li|h\d)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENTIDADES[n] ?? m)
    .replace(/[ \t]*\n[ \t]*/g, '\n');
}

// Texto de un PDF, una línea por fila (agrupando por altura en la página)
async function textoPdf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const filas: { y: number; items: { x: number; s: string }[] }[] = [];
    for (const it of tc.items as { str?: string; transform?: number[] }[]) {
      if (!it.str || !it.str.trim() || !it.transform) continue;
      const y = it.transform[5], x = it.transform[4];
      let f = filas.find((r) => Math.abs(r.y - y) <= 2.5);
      if (!f) { f = { y, items: [] }; filas.push(f); }
      f.items.push({ x, s: it.str });
    }
    filas.sort((a, b) => b.y - a.y);
    for (const f of filas) out.push(f.items.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join('  '));
  }
  return out.join('\n');
}

// ---------- lectores, uno por proveedor ----------
const LECTORES: { proveedor: string; marca: RegExp; leer: (t: string) => Lectura }[] = [
  {
    proveedor: 'Valcarce',
    marca: /VALCARCE\s+TARJETA\s+TRANSPORTE/i,
    leer(t) {
      const f = t.match(/Precios de compra:\s*(\d{2}\/\d{2}\/\d{4})/i);
      const c = t.match(/^\s*(\d{3,})\s+-\s+(.+?)\s*$/m);
      const precios: Precio[] = [];
      for (const linea of t.split('\n')) {
        const m = linea.match(/^\s*(\d{6})\s+(.+?)\s+(\d+,\d{3})\s+(\d+,\d{3})\s*$/);
        if (m) precios.push({ codigo: m[1], nombre: limpiar(m[2]), sin_iva: numero(m[3]), con_iva: numero(m[4]) });
      }
      return { proveedor: 'Valcarce', fecha: f ? fechaIso(f[1]) : null, cliente: c ? `${c[1]} - ${c[2]}` : undefined, precios };
    },
  },
  {
    proveedor: 'DST',
    marca: /dstfuelcard|DIESEL SERVICES & TRUCKS/i,
    leer(t) {
      const f = t.match(/entrada en vigor GAS.LEO A:\s*(\d{2}\/\d{2}\/\d{4})/i);
      const precios: Precio[] = [];
      // Nombre de la estación y dos precios con €; las celdas pueden venir en líneas distintas
      const re = /^[ \t>*]*([^\n€]*?[A-Za-zÁÉÍÓÚÑ][^\n€]*?)[ \t]*(?:\n[ \t>*]*)?(\d+,\d{3})\s*€[ \t]*(?:\n[ \t>*]*)?(\d+,\d{3})\s*€/gm;
      for (const m of t.matchAll(re)) {
        const nombre = limpiar(m[1].replace(/\t/g, ' '));
        if (/precio|establecimiento/i.test(nombre)) continue;
        precios.push({ codigo: slug(nombre), nombre, sin_iva: numero(m[2]), con_iva: numero(m[3]) });
      }
      return { proveedor: 'DST', fecha: f ? fechaIso(f[1]) : null, precios };
    },
  },
  {
    proveedor: 'Staroil',
    marca: /staroil\.es|PRECIOS STAROIL|email de precios Staroil/i,
    leer(t) {
      const f = t.match(/PRECIOS DE GAS.LEO A[\s\S]{0,200}?Fecha:\s*(\d{2}\/\d{2}\/\d{4})/i) || t.match(/Fecha:\s*(\d{2}\/\d{2}\/\d{4})/i);
      // Una celda por línea (texto) o por tabulador (HTML): nombre, comunidad, provincia, PVP, dto., con IVA, sin IVA
      const celdas = t.split(/[\n\t]/).map((l) => l.replace(/\r/g, '').replace(/^[\s>]+/, '').trim()).filter(Boolean);
      const esPrecio = (c: string) => /^\d+,\d{3}\s*€?$/.test(c);
      const precios: Precio[] = [];
      for (let i = 3; i + 3 < celdas.length; i++) {
        if (![0, 1, 2, 3].every((k) => esPrecio(celdas[i + k])) || [1, 2, 3].some((k) => esPrecio(celdas[i - k]))) continue;
        const nombre = limpiar(celdas[i - 3]);
        if (/area servicio|sin iva/i.test(nombre)) continue;
        precios.push({ codigo: slug(nombre), nombre, sin_iva: numero(celdas[i + 3]), con_iva: numero(celdas[i + 2]), zona: `${celdas[i - 1]} (${celdas[i - 2]})` });
        i += 3;
      }
      return { proveedor: 'Staroil', fecha: f ? fechaIso(f[1]) : null, precios };
    },
  },
  {
    proveedor: 'Andamur',
    marca: /andamur\.com|Andamur, precios para/i,
    leer(t) {
      const f = t.match(/Validez desde\s*(\d{2})-(\d{2})-(\d{4})/i);
      const c = t.match(/Andamur, precios para\s+([^\r\n]+)/i);
      // Por fila: estación, vía, localidad, provincia y precio sin IVA
      const celdas = t.split(/[\n\t]/).map((l) => l.replace(/\r/g, '').replace(/^[\s>]+/, '').trim()).filter(Boolean);
      const esPrecio = (x: string) => /^\d+,\d{3}$/.test(x);
      const cabecera = /^(VIA|LOCALIDAD|PROVINCIA|PRECIO)\b/i;
      const precios: Precio[] = [];
      for (let i = 4; i < celdas.length; i++) {
        if (!esPrecio(celdas[i]) || [1, 2, 3, 4].some((k) => esPrecio(celdas[i - k]) || cabecera.test(celdas[i - k]))) continue;
        const [nombre, via, localidad, provincia] = [celdas[i - 4], celdas[i - 3], celdas[i - 2], celdas[i - 1]].map(limpiar);
        const sin = numero(celdas[i]);
        precios.push({ codigo: slug(`${nombre} ${localidad}`), nombre, sin_iva: sin, con_iva: Math.round(sin * 1.21 * 1000) / 1000, zona: `${localidad} (${provincia}) · ${via}` });
      }
      return { proveedor: 'Andamur', fecha: f ? `${f[3]}-${f[2]}-${f[1]}` : null, cliente: c ? limpiar(c[1]) : undefined, precios };
    },
  },
];

async function sha256(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function ajuste(clave: string) {
  const { data } = await sb.from('ajustes').select('valor').eq('clave', clave).maybeSingle();
  return data?.valor as string | undefined;
}
const deBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const token = req.headers.get('x-ingesta-token') || '';
  const esperado = await ajuste('ingesta_token_sha256');
  if (!token || !esperado || (await sha256(token)) !== esperado) return json({ error: 'No autorizado' }, 401);

  let b: Record<string, any>;
  try { b = await req.json(); } catch { return json({ error: 'Petición no válida' }, 400); }

  // Leer un email guardado sin lector (para preparar su lector)
  if (b.accion === 'ver_guardado') {
    const { data, error } = await sb.storage.from('correos').download(String(b.ruta || ''));
    if (error || !data) return json({ error: 'No encontrado' }, 404);
    const e = JSON.parse(await data.text());
    return json({ remitente: e.remitente, asunto: e.asunto, texto: e.texto, html_texto: e.html ? htmlATexto(e.html) : null });
  }

  // Volver a procesar un email guardado sin lector (cuando ya existe su lector)
  if (b.accion === 'reprocesar') {
    const ruta = String(b.ruta || ''), [empresaId, correoId] = ruta.split('/');
    const { data, error } = await sb.storage.from('correos').download(ruta);
    if (error || !data) return json({ error: 'No encontrado' }, 404);
    const e = JSON.parse(await data.text());
    const { data: emp } = await sb.from('empresas').select('alias').eq('id', empresaId).maybeSingle();
    if (!emp) return json({ error: 'Empresa no encontrada' }, 404);
    b = { alias: emp.alias, remitente: e.remitente, asunto: e.asunto, fecha: e.fecha, texto: e.texto, html: e.html, adjuntos: [], _guardado: { ruta, correoId } };
  }

  if (b.accion === 'alias') {
    const { data } = await sb.from('empresas').select('alias').not('alias', 'is', null);
    return json({ buzon: await ajuste('buzon'), aliases: (data || []).map((e) => e.alias) });
  }

  const alias = String(b.alias || '').toLowerCase();
  const { data: empresa } = await sb.from('empresas').select('id, nombre').eq('alias', alias).maybeSingle();
  if (!empresa) return json({ error: `No hay ninguna empresa con el alias "${alias}"` }, 404);

  const remitente = String(b.remitente || '').slice(0, 300), asunto = String(b.asunto || '').slice(0, 300);
  const recibido = b.fecha ? new Date(b.fecha) : new Date();

  // Textos de donde leer: cuerpo, cuerpo HTML y cada PDF adjunto
  const fuentes: { origen: string; texto: string }[] = [];
  // Los saltos de línea de Windows (\r\n) se igualan: algunos reenvíos los traen y descolocaban las tablas
  if (b.texto) fuentes.push({ origen: 'cuerpo', texto: String(b.texto).replace(/\r\n?/g, '\n') });
  if (b.html) fuentes.push({ origen: 'html', texto: htmlATexto(String(b.html)) });
  const adjuntos = Array.isArray(b.adjuntos) ? b.adjuntos.slice(0, 10) : [];
  for (const a of adjuntos) {
    if (!/pdf/i.test(a.tipo || '') && !/\.pdf$/i.test(a.nombre || '')) continue;
    try { fuentes.push({ origen: a.nombre, texto: await textoPdf(deBase64(a.base64)) }); }
    catch (e) { fuentes.push({ origen: a.nombre, texto: '' }); console.error('PDF ilegible', a.nombre, e); }
  }

  // Cada lector se prueba en cada fuente; se queda la lectura con más precios
  const contexto = `${remitente}\n${asunto}`;
  const lecturas: Lectura[] = [];
  for (const l of LECTORES) {
    let mejor: Lectura | null = null;
    for (const f of fuentes) {
      if (!l.marca.test(f.texto) && !l.marca.test(contexto) && !fuentes.some((g) => l.marca.test(g.texto))) continue;
      const r = l.leer(f.texto);
      if (!r.fecha) { const otra = fuentes.map((g) => l.leer(g.texto).fecha).find(Boolean); if (otra) r.fecha = otra; }
      if (r.precios.length && (!mejor || r.precios.length > mejor.precios.length)) mejor = r;
    }
    if (mejor) lecturas.push(mejor);
  }

  if (!lecturas.length) {
    if (b._guardado) return json({ ok: false, estado: 'sin_lector', mensaje: 'Sigue sin haber un lector para este email' });
    const { data: c } = await sb.from('correos').insert({
      empresa_id: empresa.id, recibido, remitente, asunto, estado: 'sin_lector',
      detalle: `Ningún lector reconoce este email. Adjuntos: ${adjuntos.map((a: any) => a.nombre).join(', ') || 'ninguno'}`,
    }).select('id').single();
    // Se guarda para poder preparar su lector
    const carpeta = `${empresa.id}/${c?.id}`;
    await sb.storage.from('correos').upload(`${carpeta}/email.json`,
      new Blob([JSON.stringify({ remitente, asunto, fecha: recibido, texto: b.texto, html: b.html })], { type: 'application/json' }));
    for (const a of adjuntos) {
      await sb.storage.from('correos').upload(`${carpeta}/${String(a.nombre).replace(/[^\w.-]+/g, '_')}`, deBase64(a.base64), { contentType: a.tipo || 'application/octet-stream' });
    }
    return json({ ok: false, estado: 'sin_lector', mensaje: 'Proveedor no reconocido todavía; email guardado para revisarlo' });
  }

  const resumen = [];
  for (const l of lecturas) {
    const fecha = l.fecha || recibido.toISOString().slice(0, 10);
    // Algunas estaciones salen repetidas (en varias zonas): se queda la primera
    l.precios = l.precios.filter((p, i, a) => a.findIndex((q) => q.codigo === p.codigo) === i);
    // Estaciones: las nuevas entran pendientes de ubicar
    const codigos = [...new Set(l.precios.map((p) => p.codigo))];
    const nuevas = l.precios.filter((p, i, a) => a.findIndex((q) => q.codigo === p.codigo) === i)
      .map((p) => ({ proveedor: l.proveedor, codigo: p.codigo, nombre: p.nombre, provincia: p.zona ?? null }));
    await sb.from('estaciones').upsert(nuevas, { onConflict: 'proveedor,codigo', ignoreDuplicates: true });
    const { data: est, error: ee } = await sb.from('estaciones').select('id, codigo, confianza').eq('proveedor', l.proveedor).in('codigo', codigos);
    if (ee) return json({ error: ee.message }, 500);
    const porCodigo = new Map((est || []).map((e) => [e.codigo, e]));
    const sinUbicar = (est || []).filter((e) => e.confianza === 'pendiente').length;

    const { data: correo, error: ec } = await sb.from('correos').insert({
      empresa_id: empresa.id, recibido, remitente, asunto, proveedor: l.proveedor, fecha_precios: fecha,
      n_precios: l.precios.length, n_sin_ubicar: sinUbicar, estado: 'ok', detalle: l.cliente ? `Cliente en el documento: ${l.cliente}` : null,
    }).select('id').single();
    if (ec) return json({ error: ec.message }, 500);

    const filas = l.precios.map((p) => ({
      empresa_id: empresa.id, estacion_id: porCodigo.get(p.codigo)!.id, fecha,
      precio_sin_iva: p.sin_iva, precio_con_iva: p.con_iva, correo_id: correo.id,
    }));
    const { error: ep } = await sb.from('precios').upsert(filas, { onConflict: 'empresa_id,estacion_id,fecha' });
    if (ep) {
      await sb.from('correos').update({ estado: 'error', detalle: ep.message }).eq('id', correo.id);
      return json({ error: ep.message }, 500);
    }
    resumen.push({ proveedor: l.proveedor, fecha, precios: l.precios.length, sin_ubicar: sinUbicar });
  }
  // Si venía de un email guardado, se borra su registro de "sin lector" y la copia
  if (b._guardado) {
    await sb.from('correos').delete().eq('id', b._guardado.correoId).eq('estado', 'sin_lector');
    const { data: lista } = await sb.storage.from('correos').list(b._guardado.ruta.split('/').slice(0, 2).join('/'));
    await sb.storage.from('correos').remove((lista || []).map((o) => `${b._guardado.ruta.split('/').slice(0, 2).join('/')}/${o.name}`));
  }
  return json({ ok: true, empresa: empresa.nombre, resumen });
});
