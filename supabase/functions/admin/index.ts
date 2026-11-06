// Administración de la app: crear empresas, invitar a sus usuarios y ver su flota e informes.
// Usa la clave secreta del proyecto (solo existe en el servidor) y comprueba
// en cada llamada que quien la hace está en la tabla de administradores.
import { createClient } from 'npm:@supabase/supabase-js@2';

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
// Precio por camión y mes, escalonado por tramos (sin IVA): los 10 primeros a 5 €, del 11 al 25 a 4,50 €…
const TRAMOS: [number, number][] = [[10, 5], [25, 4.5], [50, 4], [100, 3.5], [Infinity, 3]];
function importe(camiones: number) {
  let total = 0, desde = 0;
  for (const [hasta, precio] of TRAMOS) {
    const n = Math.max(0, Math.min(camiones, hasta) - desde);
    total += n * precio; desde = hasta;
    if (camiones <= hasta) break;
  }
  return Math.round(total * 100) / 100;
}
const hoyMadrid = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function facturacion(empresa_id: string) {
  const hoy = hoyMadrid(), mesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const primero = new Date(hoy.getFullYear(), hoy.getMonth() - 6, 1);
  const [{ data: emp, error: e0 }, { data: filas, error: e1 }, { data: pagos, error: e2 }, { data: eventos, error: e3 }, { count, error: e4 }] = await Promise.all([
    sb.from('empresas').select('id, nombre, cif, prueba_hasta, creado').eq('id', empresa_id).single(),
    sb.from('camiones_mes').select('mes, maximo, actual').eq('empresa_id', empresa_id).order('mes'),
    sb.from('pagos_mes').select('mes, camiones, importe, pagado_el, nota').eq('empresa_id', empresa_id),
    sb.from('camiones_eventos').select('matricula, evento, en_servicio, creado').eq('empresa_id', empresa_id).order('creado', { ascending: false }).limit(300),
    sb.from('camiones').select('id', { count: 'exact', head: true }).eq('empresa_id', empresa_id).eq('activo', true),
  ]);
  if (e0 || e1 || e2 || e3 || e4) throw e0 || e1 || e2 || e3 || e4;
  const porMes = new Map((filas || []).map((f) => [f.mes, f]));
  const pagado = new Map((pagos || []).map((p) => [p.mes, p]));
  const prueba = emp.prueba_hasta as string | null;
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
    meses.push({ mes: k, maximo, importe: maximo == null || enPrueba ? 0 : importe(maximo), en_prueba: enPrueba, en_curso: enCurso, sin_datos: maximo == null, pago: pagado.get(k) || null });
  }
  const hoyIso = isoDia(hoy);
  const pendientes = meses.filter((m) => !m.en_curso && !m.en_prueba && !m.sin_datos && m.importe > 0 && !m.pago);
  const estado = !prueba || prueba >= hoyIso ? 'prueba' : pendientes.length ? 'pendiente' : 'al_dia';
  return { prueba_hasta: prueba, estado, en_servicio: count || 0, meses: meses.reverse(), eventos: eventos || [],
    tramos: TRAMOS.map(([hasta, precio], i) => ({ desde: i ? TRAMOS[i - 1][0] + 1 : 1, hasta: hasta === Infinity ? null : hasta, precio })) };
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

    // Emails con los que el proveedor de correo de una empresa pide confirmar el reenvío automático
    const listarConfirmaciones = async () => {
      const { data, error } = await sb.from('confirmaciones_reenvio')
        .select('id, recibido, empresa_id, remitente, asunto, direcciones, enlaces, codigo, texto, resuelta, empresas(nombre)')
        .order('recibido', { ascending: false }).limit(200);
      if (error) throw error;
      return (data || []).map((c: any) => ({ ...c, empresa: c.empresas?.nombre || null, empresas: undefined }));
    };
    if (accion === 'confirmaciones') return json({ confirmaciones: await listarConfirmaciones() });
    if (accion === 'confirmacion') {
      const id = Number(body.id);
      if (body.borrar) {
        const { error } = await sb.from('confirmaciones_reenvio').delete().eq('id', id);
        if (error) throw error;
      } else {
        const cambio: Record<string, unknown> = {};
        if ('resuelta' in body) cambio.resuelta = !!body.resuelta;
        if ('empresa_id' in body) cambio.empresa_id = body.empresa_id ? String(body.empresa_id) : null;
        const { error } = await sb.from('confirmaciones_reenvio').update(cambio).eq('id', id);
        if (error) throw error;
      }
      return json({ confirmaciones: await listarConfirmaciones() });
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
        if (!m || m.en_curso || m.en_prueba || m.sin_datos) return json({ error: 'Ese mes no se puede marcar como cobrado' }, 400);
        const { error } = await sb.from('pagos_mes').upsert({ empresa_id, mes, camiones: m.maximo, importe: m.importe, nota: body.nota ? String(body.nota).slice(0, 200) : null });
        if (error) throw error;
      } else {
        const { error } = await sb.from('pagos_mes').delete().eq('empresa_id', empresa_id).eq('mes', mes);
        if (error) throw error;
      }
      return json(await facturacion(empresa_id));
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
