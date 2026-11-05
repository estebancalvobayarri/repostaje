// Inicio de sesión (Supabase) y pantalla de Flota.
// La clave publicable no es secreta: lo que protege los datos son las reglas
// de seguridad por filas de la base de datos (cada empresa solo ve lo suyo).
'use strict';

const SUPABASE_URL = 'https://sqtgnlfsydcecpxtumol.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jlUCcinmm04OR4euF_p8fw_ZBPV-c96';
const WEB = 'https://estebancalvobayarri.github.io/repostaje/';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const q = id => document.getElementById(id);
const escH = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let perfil = null, camiones = [], rutaArrancada = false, esAdmin = false;
// Si se llega desde un enlace de invitación o de recuperar contraseña, primero se elige contraseña
const modoNueva = /type=(invite|recovery)/.test(location.hash);

function mensaje(id, texto, tipo = 'error') {
  const el = q(id); el.hidden = !texto; el.className = 'msg ' + tipo; el.textContent = texto || '';
}

// ---------- pantallas ----------
function verEntrada(modo = 'entrar') {
  try { const aviso = sessionStorage.getItem('avisoEntrada'); if (aviso) { sessionStorage.removeItem('avisoEntrada'); setTimeout(() => mensaje('msg-entrar', aviso), 0); } } catch (e) {}
  q('pantalla-app').hidden = true; q('pantalla-entrar').hidden = false;
  q('f-entrar').hidden = modo !== 'entrar'; q('f-nueva').hidden = modo !== 'nueva';
}

// Al cambiar de usuario se recarga la página: así no queda nada (precios, estaciones elegidas,
// camiones) del usuario anterior, que puede ser de otra empresa
let usuarioActual = null;
async function verApp(session) {
  if (usuarioActual && usuarioActual !== session.user.id) { location.reload(); return; }
  usuarioActual = session.user.id;
  const [{ data, error }, { data: adm }] = await Promise.all([
    sb.from('perfiles').select('empresa_id, rol, nombre, empresas(nombre, alias, reenvio)').eq('id', session.user.id).maybeSingle(),
    sb.from('administradores').select('user_id').eq('user_id', session.user.id).maybeSingle(),
  ]);
  esAdmin = !!adm;
  q('t-admin').hidden = !esAdmin;
  q('t-flota').hidden = !data;
  q('t-ahorro').hidden = !data;
  // Administrador sin empresa: solo el panel de administración, sin mapa ni ruta
  q('pantalla-app').toggleAttribute('data-solo-admin', esAdmin && !data);
  q('t-ruta').hidden = esAdmin && !data;
  if (esAdmin && !data) {
    perfil = null;
    q('empresa').textContent = 'Administración';
    q('usuario').textContent = session.user.email;
    q('fecha').textContent = 'Panel de administración: empresas, usuarios, flotas e informes de ahorro';
    q('pantalla-entrar').hidden = true; q('pantalla-app').hidden = false;
    camiones = [];
    pestaña('admin');
    return;
  }
  if (error || !data) {
    try { sessionStorage.setItem('avisoEntrada', 'Tu usuario no está asociado a ninguna empresa todavía. Pide que te den de alta y vuelve a entrar.'); } catch (e) {}
    await sb.auth.signOut();
    return;
  }
  perfil = data;
  // La primera vez (y con cada versión nueva de los textos) hay que aceptar las condiciones
  if (!(await aceptarCondiciones(session.user.id))) return;
  q('empresa').textContent = data.empresas?.nombre || '';
  q('usuario').textContent = session.user.email;
  q('flota-aviso').hidden = data.rol === 'gestor';
  q('b-nuevo').hidden = data.rol !== 'gestor';
  q('pantalla-entrar').hidden = true; q('pantalla-app').hidden = false;
  await cargarCamiones();
  cargarCorreos();
  if (esAdmin) cargarAdmin();
  if (!rutaArrancada) { rutaArrancada = true; window.Ruta.iniciar(camiones); }
  else window.Ruta.ponerCamiones(camiones);
}

// ---------- aceptación de condiciones y privacidad ----------
const VERSION_LEGAL = '1.0';
async function aceptarCondiciones(userId) {
  const { data, error } = await sb.from('aceptaciones_legales').select('version').eq('user_id', userId).eq('version', VERSION_LEGAL).maybeSingle();
  if (data || error) return true;   // si no se puede comprobar, no se bloquea la app
  q('pantalla-entrar').hidden = true;
  q('aceptar').hidden = false;
  return new Promise((resolver) => {
    q('f-aceptar').onsubmit = async (ev) => {
      ev.preventDefault(); mensaje('msg-aceptar', '');
      q('b-aceptar').disabled = true;
      const { error: e } = await sb.from('aceptaciones_legales').insert({ user_id: userId, version: VERSION_LEGAL, empresa_id: perfil?.empresa_id || null });
      q('b-aceptar').disabled = false;
      if (e && !/duplicate/i.test(e.message)) return mensaje('msg-aceptar', 'No se ha podido guardar: ' + e.message);
      q('aceptar').hidden = true;
      resolver(true);
    };
    q('b-no-acepto').onclick = async () => { q('aceptar').hidden = true; resolver(false); await sb.auth.signOut(); };
  });
}

// ---------- entrar / salir / contraseña ----------
q('f-entrar').addEventListener('submit', async (e) => {
  e.preventDefault(); mensaje('msg-entrar', '');
  q('b-entrar').disabled = true; q('b-entrar').textContent = 'Entrando…';
  const { error } = await sb.auth.signInWithPassword({ email: q('email').value.trim(), password: q('pass').value });
  q('b-entrar').disabled = false; q('b-entrar').textContent = 'Entrar';
  if (error) mensaje('msg-entrar', error.message.includes('Invalid login') ? 'El email o la contraseña no son correctos.' : 'No se ha podido entrar: ' + error.message);
});

q('b-olvido').addEventListener('click', async () => {
  const email = q('email').value.trim();
  if (!email) return mensaje('msg-entrar', 'Escribe tu email arriba y vuelve a pulsar "He olvidado mi contraseña".');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: WEB });
  mensaje('msg-entrar', error ? 'No se ha podido enviar el email: ' + error.message
    : 'Si ese email tiene usuario, recibirás un enlace para crear una contraseña nueva.', error ? 'error' : 'ok');
});

q('f-nueva').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: q('pass-nueva').value });
  if (error) return mensaje('msg-nueva', 'No se ha podido guardar: ' + error.message);
  const { data } = await sb.auth.getSession();
  history.replaceState(null, '', location.pathname);
  if (data.session) verApp(data.session);
});

q('b-salir').addEventListener('click', async () => { await sb.auth.signOut(); });

sb.auth.onAuthStateChange((evento, session) => {
  if (evento === 'PASSWORD_RECOVERY') return verEntrada('nueva');
  if (evento === 'SIGNED_OUT') { q('pass').value = ''; q('pantalla-app').hidden = true; location.reload(); return; }
  if (evento === 'SIGNED_IN' && session && !modoNueva && q('f-nueva').hidden) verApp(session);
});

(async () => {
  if (modoNueva) return verEntrada('nueva');
  const { data } = await sb.auth.getSession();
  if (data.session) verApp(data.session); else verEntrada();
})();

// ---------- pestañas ----------
function pestaña(cual) {
  q('pantalla-app').dataset.vista = cual;
  if (cual !== 'admin') devolverDash();
  for (const t of ['ruta', 'flota', 'ahorro', 'admin']) {
    q('t-' + t).setAttribute('aria-selected', cual === t);
    q('vista-' + t).hidden = cual !== t;
  }
  if (cual === 'admin') cargarAdmin();
  // En Ahorro, el cuadro de mando ocupa el sitio del mapa
  q('map').hidden = cual === 'ahorro';
  q('dash').hidden = cual !== 'ahorro';
  if (cual === 'ahorro') cargarAhorro();
  // En móvil, si las pestañas ya están fijas arriba, la sección nueva se ve desde su principio
  if (matchMedia('(max-width: 820px)').matches) {
    const tope = document.querySelector('#pantalla-app .head').getBoundingClientRect().bottom + window.scrollY;
    if (window.scrollY > tope) window.scrollTo({ top: tope });
  }
  else window.Ruta.refrescarMapa();
}
q('t-ruta').onclick = () => pestaña('ruta');
q('t-flota').onclick = () => pestaña('flota');
q('t-admin').onclick = () => pestaña('admin');
q('t-ahorro').onclick = () => pestaña('ahorro');

// ---------- flota ----------
async function cargarCamiones() {
  const { data, error } = await sb.from('camiones').select('*').order('activo', { ascending: false }).order('matricula');
  if (error) { q('flota').innerHTML = `<p class="empty">No se han podido cargar los camiones: ${escH(error.message)}</p>`; return; }
  camiones = data;
  pintarFlota();
}

function pintarFlota() {
  const gestor = perfil?.rol === 'gestor';
  const activos = camiones.filter(c => c.activo).length;
  q('flota-n').textContent = camiones.length ? `${activos} en servicio${camiones.length > activos ? ` · ${camiones.length - activos} de baja` : ''}` : '';
  if (!camiones.length) {
    q('flota').innerHTML = `<p class="empty">Todavía no hay camiones. ${gestor ? 'Pulsa "Añadir camión" y escribe su matrícula y la capacidad del depósito.' : 'El gestor de la empresa puede darlos de alta.'}</p>`;
    return;
  }
  q('flota').innerHTML = camiones.map(c => `
    <div class="cam${c.activo ? '' : ' inactivo'}" data-id="${c.id}">
      <div style="min-width:0"><div class="mat">${escH(c.matricula)}</div>
        <div class="sub">${c.capacidad_litros.toLocaleString('es-ES')} l · ${String(c.consumo_l_100km).replace('.', ',')} l/100 km${c.activo ? '' : ' · de baja'}${c.descripcion ? ' · ' + escH(c.descripcion) : ''}</div></div>
      ${gestor ? `<div class="acc"><button class="mini" data-acc="editar" type="button">Editar</button><button class="mini peligro" data-acc="borrar" type="button">Borrar</button></div>` : ''}
    </div>`).join('');
  q('flota').querySelectorAll('button[data-acc]').forEach(b => b.onclick = () => {
    const fila = b.closest('.cam'), cam = camiones.find(c => c.id === fila.dataset.id);
    if (b.dataset.acc === 'editar') abrirForm(cam);
    else confirmarBorrado(fila, cam);
  });
}

function abrirForm(cam) {
  mensaje('msg-cam', '');
  q('cam-id').value = cam?.id || '';
  q('cam-mat').value = cam?.matricula || '';
  q('cam-cap').value = cam?.capacidad_litros || '';
  q('cam-con').value = cam?.consumo_l_100km ?? 35;
  q('cam-desc').value = cam?.descripcion || '';
  q('cam-activo').checked = cam ? cam.activo : true;
  q('b-guardar').textContent = cam ? 'Guardar cambios' : 'Añadir camión';
  q('f-cam').hidden = false; q('cam-mat').focus();
}
q('b-nuevo').onclick = () => abrirForm(null);
q('b-cancelar').onclick = () => { q('f-cam').hidden = true; };

q('f-cam').addEventListener('submit', async (e) => {
  e.preventDefault(); mensaje('msg-cam', '');
  const id = q('cam-id').value;
  const fila = {
    matricula: q('cam-mat').value.trim().toUpperCase().replace(/\s+/g, ' '),
    capacidad_litros: Math.round(+q('cam-cap').value),
    consumo_l_100km: +q('cam-con').value,
    descripcion: q('cam-desc').value.trim() || null,
    activo: q('cam-activo').checked,
  };
  if (!id) fila.empresa_id = perfil.empresa_id;
  const { error } = id ? await sb.from('camiones').update(fila).eq('id', id) : await sb.from('camiones').insert(fila);
  if (error) {
    const dup = error.code === '23505';
    return mensaje('msg-cam', dup ? `Ya hay un camión con la matrícula ${fila.matricula}.` : 'No se ha podido guardar: revisa que la capacidad esté entre 50 y 3.000 l y el consumo entre 10 y 80 l/100 km.');
  }
  q('f-cam').hidden = true;
  await cargarCamiones();
  window.Ruta.ponerCamiones(camiones);
});

// Confirmación dentro de la página (la web no usa ventanas emergentes)
function confirmarBorrado(fila, cam) {
  const acc = fila.querySelector('.acc');
  acc.innerHTML = `<span class="sub">¿Borrar ${escH(cam.matricula)}?</span><button class="mini peligro" type="button" data-si>Sí, borrar</button><button class="mini" type="button" data-no>No</button>`;
  acc.querySelector('[data-no]').onclick = pintarFlota;
  acc.querySelector('[data-si]').onclick = async () => {
    const { error } = await sb.from('camiones').delete().eq('id', cam.id);
    if (error) { acc.innerHTML = '<span class="sub">No se ha podido borrar.</span>'; return; }
    await cargarCamiones();
    window.Ruta.ponerCamiones(camiones);
  };
}

// ---------- administración (solo administradores) ----------
async function llamarAdmin(cuerpo) {
  const { data, error } = await sb.functions.invoke('admin', { body: cuerpo });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  return data;
}

async function cargarAdmin() {
  if (!esAdmin) return;
  try {
    const { empresas } = await llamarAdmin({ accion: 'listar' });
    pintarAdmin(empresas);
  } catch (e) { q('admin-lista').innerHTML = `<p class="empty">No se han podido cargar las empresas: ${escH(e.message)}</p>`; }
}

// Estado del acordeón: la lista de empresas y como mucho una empresa abierta
let listaAbierta = false, empAbierta = null, empSub = 'usuarios', ultimasEmpresas = [];
const camionesTxt = n => `${n} ${n === 1 ? 'camión' : 'camiones'}`;

q('nueva-toggle').onclick = () => {
  const abrir = q('f-empresa').hidden;
  q('f-empresa').hidden = !abrir;
  q('nueva-toggle').setAttribute('aria-expanded', abrir);
  if (abrir) q('emp-nombre').focus();
};

q('admin-toggle').onclick = () => {
  listaAbierta = !listaAbierta;
  q('admin-toggle').setAttribute('aria-expanded', listaAbierta);
  q('admin-lista').hidden = !listaAbierta;
};

function pintarAdmin(empresas) {
  devolverDash();
  ultimasEmpresas = empresas;
  q('admin-n').textContent = `${empresas.length} empresa${empresas.length === 1 ? '' : 's'}`;
  if (!empresas.length) { q('admin-lista').innerHTML = '<p class="empty">Todavía no hay empresas. Crea la primera arriba.</p>'; return; }
  q('admin-lista').innerHTML = empresas.map(e => {
    const abierta = e.id === empAbierta;
    return `
    <section class="emp" data-emp="${e.id}">
      <button class="emp-row" type="button" aria-expanded="${abierta}" aria-controls="emp-${e.id}">
        <span class="chev" aria-hidden="true"></span><b>${escH(e.nombre)}</b><span class="small">${camionesTxt(e.camiones)}</span>
      </button>
      <div class="emp-body" id="emp-${e.id}" ${abierta ? '' : 'hidden'}>
        <div class="emp-meta">${e.cif ? 'CIF ' + escH(e.cif) + ' · ' : ''}${e.usuarios.length} usuario${e.usuarios.length === 1 ? '' : 's'}</div>
        <div class="emp-tabs" role="tablist" aria-label="Secciones de ${escH(e.nombre)}">
          ${[['usuarios', 'Usuarios'], ['flota', 'Flota y precios'], ['informes', 'Informes de ahorro'], ['facturacion', 'Facturación']].map(([k, t]) =>
            `<button class="emp-tab" type="button" role="tab" data-sub="${k}" aria-selected="${empSub === k}">${t}</button>`).join('')}
        </div>
        <div class="emp-panel" data-panel="usuarios" ${empSub === 'usuarios' ? '' : 'hidden'}>
        <div class="area usuarios">
          <h3>Usuarios con acceso</h3>
          ${e.usuarios.length ? e.usuarios.map(u => `
            <div class="usr" data-user="${u.id}" data-email="${escH(u.email)}">
              <div style="min-width:0"><div class="em">${escH(u.email || '(sin email)')}</div>
                <div class="small">${u.nombre ? escH(u.nombre) : 'Sin nombre'}<span class="pill ${u.rol}">${u.rol}</span>${u.ha_entrado ? '' : '<span class="pill pend">Invitación pendiente</span>'}</div></div>
              <div class="acc"><button class="mini" type="button" data-acc="reenviar">${u.ha_entrado ? 'Restablecer contraseña' : 'Reenviar invitación'}</button><button class="mini peligro" type="button" data-acc="quitar">Quitar acceso</button></div>
            </div>`).join('') : '<p class="small">Todavía no tiene usuarios. Invita al gestor de la empresa aquí debajo.</p>'}
        </div>

        <form class="area nuevo inv" data-inv="${e.id}">
          <h3>Añadir usuario</h3>
          <div class="seg" role="radiogroup" aria-label="Rol">
            <label><input type="radio" name="rol-${e.id}" value="gestor" checked><span>Gestor</span></label>
            <label><input type="radio" name="rol-${e.id}" value="conductor"><span>Conductor</span></label>
          </div>
          <input type="email" required placeholder="email@empresa.es" aria-label="Email del usuario">
          <input type="text" placeholder="Nombre (opcional)" aria-label="Nombre del usuario" maxlength="80">
          <button class="btn" type="submit">Enviar invitación</button>
          <p class="small" style="margin:0">Recibirá un email con un enlace para elegir su contraseña.</p>
          <div class="msg" hidden></div>
        </form>
        </div>
        <div class="emp-panel" data-panel="flota" ${empSub === 'flota' ? '' : 'hidden'}><p class="small">Cargando…</p></div>
        <div class="emp-panel emp-informes" data-panel="informes" ${empSub === 'informes' ? '' : 'hidden'}></div>
        <div class="emp-panel" data-panel="facturacion" ${empSub === 'facturacion' ? '' : 'hidden'}><p class="small">Cargando…</p></div>
      </div>
    </section>`;
  }).join('');

  // Abrir una empresa cierra la que estuviera abierta
  q('admin-lista').querySelectorAll('.emp-row').forEach(b => b.onclick = () => {
    const id = b.closest('.emp').dataset.emp;
    empAbierta = empAbierta === id ? null : id;
    q('admin-lista').querySelectorAll('.emp').forEach(sec => {
      const on = sec.dataset.emp === empAbierta;
      sec.querySelector('.emp-row').setAttribute('aria-expanded', on);
      sec.querySelector('.emp-body').hidden = !on;
    });
    abrirSub(empSub);
  });
  q('admin-lista').querySelectorAll('.emp-tab').forEach(b => b.onclick = () => abrirSub(b.dataset.sub));
  if (empAbierta) abrirSub(empSub);

  q('admin-lista').querySelectorAll('form[data-inv]').forEach(f => f.onsubmit = async (ev) => {
    ev.preventDefault();
    const email = f.querySelector('input[type=email]'), nombre = f.querySelector('input[type=text]');
    const rol = f.querySelector('input[type=radio]:checked').value, msg = f.querySelector('.msg'), b = f.querySelector('button');
    b.disabled = true; b.textContent = 'Enviando…';
    try {
      const r = await llamarAdmin({ accion: 'invitar', empresa_id: f.dataset.inv, email: email.value, nombre: nombre.value, rol });
      await cargarAdmin();
      const m = q('admin-lista').querySelector(`form[data-inv="${f.dataset.inv}"] .msg`);
      if (m) { m.hidden = false; m.className = 'msg ok'; m.textContent = r.invitado ? `Invitación enviada a ${email.value}.` : `${email.value} ya tenía cuenta: ahora tiene acceso a esta empresa.`; }
    } catch (e) { msg.hidden = false; msg.className = 'msg error'; msg.textContent = e.message; b.disabled = false; b.textContent = 'Enviar invitación'; }
  });

  q('admin-lista').querySelectorAll('.usr button[data-acc]').forEach(b => b.onclick = async () => {
    const fila = b.closest('.usr'), acc = fila.querySelector('.acc'), email = fila.dataset.email;
    if (b.dataset.acc === 'reenviar') {
      b.disabled = true;
      try { await llamarAdmin({ accion: 'reenviar', email }); acc.innerHTML = `<span class="small">Email enviado a ${escH(email)}</span>`; }
      catch (e) { acc.innerHTML = `<span class="small">${escH(e.message)}</span>`; }
      return;
    }
    acc.innerHTML = `<span class="small">¿Quitar el acceso a ${escH(email)}?</span><button class="mini peligro" type="button" data-si>Sí, quitar</button><button class="mini" type="button" data-no>No</button>`;
    acc.querySelector('[data-no]').onclick = () => pintarAdmin(ultimasEmpresas);
    acc.querySelector('[data-si]').onclick = async () => {
      try { await llamarAdmin({ accion: 'quitar_usuario', user_id: fila.dataset.user }); cargarAdmin(); }
      catch (e) { acc.innerHTML = `<span class="small">${escH(e.message)}</span>`; }
    };
  });
}

// Pestañas dentro de la empresa abierta: usuarios, flota y precios, informes de ahorro
function abrirSub(sub) {
  empSub = sub;
  const sec = empAbierta && q('admin-lista').querySelector(`.emp[data-emp="${empAbierta}"]`);
  if (!sec) { devolverDash(); return; }
  sec.querySelectorAll('.emp-tab').forEach(b => b.setAttribute('aria-selected', b.dataset.sub === sub));
  sec.querySelectorAll('.emp-panel').forEach(p => { p.hidden = p.dataset.panel !== sub; });
  if (sub === 'flota') cargarFlotaAdmin(sec);
  if (sub === 'facturacion') cargarFacturacion(sec);
  if (sub === 'informes') { sec.querySelector('.emp-informes').append(q('dash')); q('dash').hidden = false; cargarInformeAdmin(); }
  else devolverDash();
}

async function cargarFlotaAdmin(sec) {
  const panel = sec.querySelector('[data-panel="flota"]'), e = ultimasEmpresas.find(x => x.id === empAbierta);
  try {
    const { camiones: cam, correos } = await llamarAdmin({ accion: 'empresa', empresa_id: empAbierta });
    const num = (n, d = 0) => (+n).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' });
    const activos = cam.filter(c => c.activo).length;
    panel.innerHTML = `
      <div class="area usuarios">
        <h3>Camiones · ${activos} en servicio${cam.length > activos ? ` de ${cam.length}` : ''}</h3>
        ${cam.length ? `<div class="tabla"><table><thead><tr><th>Matrícula</th><th>Descripción</th><th>Depósito</th><th>Consumo</th><th>Estado</th></tr></thead><tbody>
          ${cam.map(c => `<tr${c.activo ? '' : ' class="baja"'}><td><b>${escH(c.matricula)}</b></td><td style="text-align:left">${escH(c.descripcion || '—')}</td><td>${num(c.capacidad_litros)} l</td><td>${num(c.consumo_l_100km, 1)} l/100 km</td><td>${c.activo ? 'En servicio' : 'De baja'}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="small">Esta empresa todavía no ha dado de alta camiones.</p>'}
      </div>
      <div class="area usuarios">
        <h3>Precios de los proveedores</h3>
        ${e?.reenvio ? `<div class="reenvio"><span class="lbl">Dirección para reenviar los precios</span><code>${escH(e.reenvio)}</code></div>` : '<p class="small">Sin dirección de reenvío.</p>'}
        <div class="lista-correos">${htmlCorreos(correos)}</div>
      </div>`;
  } catch (err) { panel.innerHTML = `<p class="small">No se ha podido cargar la flota: ${escH(err.message)}</p>`; }
}

// ---------- facturación de la empresa abierta ----------
const eur2 = n => (+n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }) + ' €';
const fechaEs = iso => iso ? new Date(iso.length === 10 ? iso + 'T12:00' : iso).toLocaleDateString('es-ES') : '';
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = iso => { const [y, m] = iso.split('-'); return `${MESES_ES[+m - 1]} ${y}`; };
const IVA = 0.21;

async function cargarFacturacion(sec, accion = { accion: 'facturacion' }) {
  const panel = sec.querySelector('[data-panel="facturacion"]'), empresa_id = empAbierta;
  let f;
  try { f = await llamarAdmin({ ...accion, empresa_id }); }
  catch (err) { panel.querySelector('.msg-fact') ? (panel.querySelector('.msg-fact').hidden = false, panel.querySelector('.msg-fact').textContent = err.message) : (panel.innerHTML = `<p class="small">No se ha podido cargar la facturación: ${escH(err.message)}</p>`); return; }
  if (empAbierta !== empresa_id) return;
  const actual = f.meses.find(m => m.en_curso) || { maximo: f.en_servicio, importe: 0, en_prueba: true };
  const pendientes = f.meses.filter(m => !m.en_curso && !m.en_prueba && !m.sin_datos && m.importe > 0 && !m.pago);
  const deuda = pendientes.reduce((t, m) => t + m.importe, 0);
  const ESTADO = {
    prueba: ['prueba', f.prueba_hasta ? `En prueba hasta el ${fechaEs(f.prueba_hasta)}` : 'En prueba, sin fecha de fin'],
    al_dia: ['ok', 'Al día'],
    pendiente: ['mal', `Pendiente: ${pendientes.length} ${pendientes.length === 1 ? 'mes' : 'meses'} · ${eur2(deuda)} + IVA`],
  }[f.estado];
  const estimado = actual.en_prueba ? 0 : (actual.importe || 0);
  const hoy = new Date(), masUnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, hoy.getDate());
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const finDeMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  const EVENTO = { alta: 'Alta', baja: 'Baja', borrado: 'Borrado', inicio: 'Situación inicial' };

  panel.innerHTML = `
    <div class="fact-cab"><span class="estado-fact ${ESTADO[0]}">${escH(ESTADO[1])}</span>
      <span class="small">Se cobra a mes vencido el máximo de camiones que ha tenido en servicio a la vez durante el mes.</span></div>
    <div class="fact-grid">
      <div class="area usuarios">
        <h3>Prueba gratis</h3>
        <form class="prueba-f">
          <label class="lbl" for="prueba-${empresa_id}">Gratis hasta (incluido)</label>
          <div class="fila-prueba"><input type="date" id="prueba-${empresa_id}" value="${f.prueba_hasta || ''}"><button class="btn" type="submit">Guardar</button></div>
          <div class="rapido-prueba">
            <button class="mini" type="button" data-hasta="${iso(finDeMes)}">Hasta fin de este mes</button>
            <button class="mini" type="button" data-hasta="${iso(masUnMes)}">1 mes desde hoy</button>
            ${f.prueba_hasta ? '<button class="mini" type="button" data-hasta="">Quitar fecha</button>' : ''}
          </div>
          <p class="small" style="margin:0">El mes en que termina la prueba no se cobra; se empieza a cobrar el mes siguiente. Sin fecha, la empresa sigue en prueba.</p>
        </form>
      </div>
      <div class="area usuarios">
        <h3>Mes en curso · ${escH(nombreMes(f.meses[0]?.mes || iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1))))}</h3>
        <div class="kpis-fact">
          <div><b>${f.en_servicio}</b><span>en servicio ahora</span></div>
          <div><b>${actual.maximo ?? f.en_servicio}</b><span>máximo del mes</span></div>
          <div><b>${actual.en_prueba ? '0 €' : eur2(estimado)}</b><span>${actual.en_prueba ? 'en prueba' : `+ IVA · ${eur2(estimado * (1 + IVA))} con IVA`}</span></div>
        </div>
        <p class="small" style="margin:0">Estimación: el importe se cierra el último día del mes.</p>
      </div>
    </div>
    <div class="area usuarios">
      <h3>Meses</h3>
      <div class="tabla"><table><thead><tr><th>Mes</th><th>Camiones</th><th>Importe</th><th>Con IVA</th><th>Estado</th><th></th></tr></thead><tbody>
      ${f.meses.map(m => {
        const estado = m.en_curso ? 'En curso' : m.sin_datos ? 'Sin datos' : m.en_prueba ? 'En prueba' : m.pago ? `Cobrado el ${fechaEs(m.pago.pagado_el)}` : m.importe > 0 ? '<span class="pill pend">Pendiente</span>' : 'Sin camiones';
        const accion = m.pago ? `<button class="mini" type="button" data-mes="${m.mes}" data-pagado="0">Deshacer</button>`
          : !m.en_curso && !m.en_prueba && !m.sin_datos && m.importe > 0 ? `<button class="mini" type="button" data-mes="${m.mes}" data-pagado="1">Marcar cobrado</button>` : '';
        const imp = m.pago ? m.pago.importe : m.importe;
        return `<tr><td style="text-transform:capitalize">${nombreMes(m.mes)}</td><td>${m.sin_datos ? '—' : (m.pago ? m.pago.camiones : m.maximo)}</td>
          <td>${m.sin_datos || m.en_prueba ? '—' : eur2(imp)}</td><td>${m.sin_datos || m.en_prueba ? '—' : eur2(imp * (1 + IVA))}</td><td>${estado}</td><td>${accion}</td></tr>`;
      }).join('')}
      </tbody></table></div>
      <div class="msg msg-fact" hidden></div>
    </div>
    <div class="fact-grid">
      <div class="area usuarios">
        <h3>Tarifa por camión y mes (sin IVA)</h3>
        <div class="tabla"><table><tbody>
          ${f.tramos.map(t => `<tr><td>${t.hasta ? `Del ${t.desde} al ${t.hasta}` : `Más de ${t.desde - 1}`}</td><td>${eur2(t.precio)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="small" style="margin:0">Escalonado: cada camión paga el precio de su tramo. 20 camiones = 10 × 5 € + 10 × 4,50 € = 95 €.</p>
      </div>
      <div class="area usuarios">
        <h3>Altas y bajas de camiones · últimos 6 meses</h3>
        ${f.eventos.length ? `<div class="tabla eventos"><table><thead><tr><th>Fecha</th><th>Camión</th><th>Cambio</th><th>En servicio</th></tr></thead><tbody>
          ${f.eventos.map(e => `<tr><td>${new Date(e.creado).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td style="text-align:left">${escH(e.matricula || '—')}</td><td>${EVENTO[e.evento] || e.evento}</td><td>${e.en_servicio}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="small">Todavía no hay cambios.</p>'}
      </div>
    </div>`;

  const guardarPrueba = hasta => cargarFacturacion(sec, { accion: 'prueba', hasta });
  panel.querySelector('.prueba-f').onsubmit = ev => { ev.preventDefault(); guardarPrueba(panel.querySelector('input[type=date]').value || null); };
  panel.querySelectorAll('[data-hasta]').forEach(b => b.onclick = () => guardarPrueba(b.dataset.hasta || null));
  panel.querySelectorAll('button[data-mes]').forEach(b => b.onclick = () => { b.disabled = true; cargarFacturacion(sec, { accion: 'pago', mes: b.dataset.mes, pagado: b.dataset.pagado === '1' }); });
}

async function cargarInformeAdmin() {
  const e = ultimasEmpresas.find(x => x.id === empAbierta); if (!e) return;
  const [desde, hasta] = rangoPeriodo(q('periodo').value);
  try {
    const { envios } = await llamarAdmin({ accion: 'informe', empresa_id: e.id, desde: desde && desde.toISOString(), hasta: hasta && hasta.toISOString() });
    const etiqueta = q('periodo').selectedOptions[0].textContent + (desde ? ` · desde el ${desde.toLocaleDateString('es-ES')}` : '');
    window.Dash.pintar(envios, { desde, etiqueta, empresa: e.nombre });
    window.Dash.redimensionar();
  } catch (err) { q('d-periodo').textContent = 'No se ha podido cargar el informe: ' + err.message; }
}

// El cuadro de mando es uno solo: en Administración se coloca dentro de la empresa abierta
let sitioDash = null;
function devolverDash() {
  if (!sitioDash) { sitioDash = document.createComment('dash'); q('dash').before(sitioDash); }
  if (q('dash').parentNode !== sitioDash.parentNode || q('dash').previousSibling !== sitioDash) sitioDash.after(q('dash'));
  q('dash').hidden = q('pantalla-app').dataset.vista !== 'ahorro';
}

q('f-empresa').addEventListener('submit', async (e) => {
  e.preventDefault(); mensaje('msg-empresa', '');
  q('b-empresa').disabled = true;
  try {
    const { empresa } = await llamarAdmin({ accion: 'crear_empresa', nombre: q('emp-nombre').value, cif: q('emp-cif').value });
    q('emp-nombre').value = ''; q('emp-cif').value = '';
    mensaje('msg-empresa', `Empresa "${empresa.nombre}" creada. Invita a su gestor en la lista de empresas.`, 'ok');
    empAbierta = empresa.id;
    if (!listaAbierta) q('admin-toggle').click();
    await cargarAdmin();
  } catch (err) { mensaje('msg-empresa', err.message); }
  q('b-empresa').disabled = false;
});

// ---------- registro de envíos e informe de ahorro ----------
window.Registro = {
  async guardar(datos) {
    if (!perfil) throw new Error('tu usuario no pertenece a ninguna empresa');
    const { error } = await sb.from('envios').insert({ ...datos, empresa_id: perfil.empresa_id });
    if (error) throw new Error(error.message);
  },
};

const eurA = n => (+n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
let enviosPeriodo = [];

function rangoPeriodo(v) {
  const h = new Date(), y = h.getFullYear(), m = h.getMonth();
  if (v === 'mes') return [new Date(y, m, 1), null];
  if (v === 'mes-ant') return [new Date(y, m - 1, 1), new Date(y, m, 1)];
  if (v === '3m') return [new Date(y, m - 2, 1), null];
  if (v === '6m') return [new Date(y, m - 5, 1), null];
  if (v === 'anio') return [new Date(y, 0, 1), null];
  return [null, null];
}

async function cargarAhorro() {
  if (!perfil) return;
  const [desde, hasta] = rangoPeriodo(q('periodo').value);
  let consulta = sb.from('envios').select('*').order('creado', { ascending: false }).limit(5000);
  if (desde) consulta = consulta.gte('creado', desde.toISOString());
  if (hasta) consulta = consulta.lt('creado', hasta.toISOString());
  const { data, error } = await consulta;
  if (error) { q('a-lista').innerHTML = `<p class="empty">No se ha podido cargar el informe: ${escH(error.message)}</p>`; return; }
  enviosPeriodo = data;
  pintarAhorro(data);
}
q('periodo').onchange = () => (q('dash').closest('.emp-informes') ? cargarInformeAdmin() : cargarAhorro());

function pintarAhorro(env) {
  const [desde] = rangoPeriodo(q('periodo').value);
  const etiqueta = q('periodo').selectedOptions[0].textContent + (desde ? ` · desde el ${desde.toLocaleDateString('es-ES')}` : '');
  window.Dash.pintar(env, { desde, etiqueta, empresa: perfil?.empresas?.nombre });
  q('a-lista').innerHTML = env.length ? env.map(e => {
    const d = new Date(e.creado);
    return `<div class="env">
      <div class="nm">${escH(e.estacion_nombre)}</div><div class="ah${+e.ahorro_eur < 0 ? ' extra' : ''}" title="${e.referencia === 'media' ? 'Frente a la media de las otras paradas de la ruta' : 'Frente a la parada más cara de la ruta (cálculo anterior)'}">${eurA(e.ahorro_eur)}</div>
      <div class="sub">${d.toLocaleDateString('es-ES')} · ${escH(e.matricula || 'sin camión')} · ${escH(e.origen)} → ${escH(e.destino)}</div>
      <div class="sub" style="text-align:right">${(+e.precio_elegido).toFixed(3).replace('.', ',')} €/l · ${Math.round(e.litros)} l</div>
    </div>`;
  }).join('') : '<p class="empty">Todavía no hay repostajes en este periodo. Se guardan al pulsar "Enviar por WhatsApp" en la pestaña Ruta.</p>';
}

// CSV de repostajes enviados (separado por «;» y con coma decimal, para abrirlo en Excel)
function csvEnvios(envios, general = false) {
  const cab = [...(general ? ['empresa', 'enviado_por'] : []), 'fecha', 'matricula', 'origen', 'destino', 'km_ruta', 'estacion', 'tarjeta', 'precio_elegido', 'litros', 'referencia', 'precio_referencia', 'paradas_en_la_media', 'estacion_mas_cara', 'precio_mas_cara', 'ahorro_eur'];
  const celda = v => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const num = v => v == null ? '' : String(v).replace('.', ',');
  const filas = envios.map(e => [...(general ? [e.empresa, e.enviado_por] : []), new Date(e.creado).toLocaleString('es-ES'), e.matricula, e.origen, e.destino, num(e.km_ruta), e.estacion_nombre, e.tarjeta,
    num(e.precio_elegido), num(e.litros), e.referencia === 'media' ? 'media de la ruta' : 'parada más cara', num(e.precio_referencia ?? e.precio_cara), e.n_referencia ?? '', e.estacion_cara_nombre, num(e.precio_cara), num(e.ahorro_eur)].map(celda).join(';'));
  return '\ufeff' + [cab.join(';'), ...filas].join('\r\n');
}
function descargar(nombre, texto) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
q('b-csv').onclick = () => descargar(`ahorro-${q('periodo').value}-${new Date().toISOString().slice(0, 10)}.csv`, csvEnvios(enviosPeriodo));

// ---------- administración: CSV con las rutas de todas las empresas ----------
(() => {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hoy = new Date(), limite = new Date(hoy); limite.setFullYear(hoy.getFullYear() - 1);
  const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  q('exp-desde').min = q('exp-hasta').min = iso(limite);
  q('exp-desde').max = q('exp-hasta').max = iso(hoy);
  q('exp-desde').value = iso(ini); q('exp-hasta').value = iso(hoy);
  const PRESETS = { mes: [ini, hoy], 'mes-ant': [new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), new Date(hoy.getFullYear(), hoy.getMonth(), 0)],
    '3m': [new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1), hoy], '6m': [new Date(hoy.getFullYear(), hoy.getMonth() - 5, 1), hoy],
    anio: [new Date(hoy.getFullYear(), 0, 1), hoy], '12m': [limite, hoy] };
  q('exp-rapido').querySelectorAll('button').forEach(b => b.onclick = () => {
    const [d, h] = PRESETS[b.dataset.p]; q('exp-desde').value = iso(d < limite ? limite : d); q('exp-hasta').value = iso(h);
    q('exp-rapido').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  [q('exp-desde'), q('exp-hasta')].forEach(i => i.oninput = () => q('exp-rapido').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false')));
  q('exp-toggle').onclick = () => {
    const abrir = q('f-exportar').hidden;
    q('f-exportar').hidden = !abrir; q('exp-toggle').setAttribute('aria-expanded', abrir);
  };
  q('f-exportar').addEventListener('submit', async (ev) => {
    ev.preventDefault(); mensaje('msg-exportar', '');
    const d = q('exp-desde').value, h = q('exp-hasta').value;
    if (!d || !h) return mensaje('msg-exportar', 'Elige las dos fechas.');
    if (d < q('exp-desde').min) return mensaje('msg-exportar', `Solo se pueden descargar rutas de hasta un año atrás (desde el ${new Date(q('exp-desde').min + 'T12:00').toLocaleDateString('es-ES')}).`);
    if (h < d) return mensaje('msg-exportar', 'La fecha final tiene que ser igual o posterior a la inicial.');
    const desde = new Date(d + 'T00:00'), hasta = new Date(h + 'T00:00'); hasta.setDate(hasta.getDate() + 1);
    q('b-exportar').disabled = true; q('b-exportar').textContent = 'Preparando…';
    try {
      const { envios } = await llamarAdmin({ accion: 'exportar', desde: desde.toISOString(), hasta: hasta.toISOString() });
      if (!envios.length) mensaje('msg-exportar', 'No hay rutas enviadas en ese periodo.', 'ok');
      else {
        descargar(`rutas-todas-las-empresas-${d}-a-${h}.csv`, csvEnvios(envios, true));
        const empresas = new Set(envios.map(e => e.empresa)).size;
        mensaje('msg-exportar', `Descargado: ${envios.length} ruta${envios.length === 1 ? '' : 's'} de ${empresas} empresa${empresas === 1 ? '' : 's'}.`, 'ok');
      }
    } catch (e) { mensaje('msg-exportar', e.message); }
    q('b-exportar').disabled = false; q('b-exportar').textContent = 'Descargar CSV';
  });
})();

// ---------- precios de la empresa (Supabase) ----------
window.Precios = {
  async cargar() {
    const desde = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const { data, error } = await sb.from('precios')
      .select('fecha, precio_sin_iva, precio_con_iva, estaciones(id, proveedor, codigo, nombre, direccion, municipio, provincia, lat, lon, confianza)')
      .gte('fecha', desde).order('fecha', { ascending: false }).limit(5000);
    if (error) throw error;
    // De cada proveedor, los precios de su último día
    const ultima = new Map();
    for (const r of data) { const pr = r.estaciones.proveedor; if (!ultima.has(pr)) ultima.set(pr, r.fecha); }
    const est = [], sin = [], vistas = new Set();
    for (const r of data) {
      const e = r.estaciones;
      if (r.fecha !== ultima.get(e.proveedor) || vistas.has(e.id)) continue;
      vistas.add(e.id);
      const d = { id: e.id, n: e.nombre, t: e.proveedor, p: +r.precio_sin_iva, pi: +(r.precio_con_iva ?? r.precio_sin_iva * 1.21) };
      if (e.lat != null && e.confianza !== 'pendiente') est.push({ ...d, lat: e.lat, lon: e.lon, dir: e.direccion || '', mun: e.municipio || '', prov: e.provincia || '', c: e.confianza });
      else sin.push(d);
    }
    const fecha = [...ultima.values()].sort().at(-1) || null;
    return { est, sin, fecha, fechas: Object.fromEntries(ultima) };
  },
};

// ---------- estaciones quitadas del mapa por el gestor (toda la empresa) ----------
window.Seleccion = {
  puedeEditar: () => perfil?.rol === 'gestor',
  async cargar() {
    if (!perfil) return new Set();
    const { data, error } = await sb.from('estaciones_excluidas').select('estacion_id');
    if (error) throw error;
    return new Set(data.map(r => r.estacion_id));
  },
  async guardar(quitar, poner) {
    if (quitar.length) {
      const { error } = await sb.from('estaciones_excluidas').upsert(quitar.map(id => ({ empresa_id: perfil.empresa_id, estacion_id: id })), { onConflict: 'empresa_id,estacion_id', ignoreDuplicates: true });
      if (error) throw error;
    }
    if (poner.length) {
      const { error } = await sb.from('estaciones_excluidas').delete().in('estacion_id', poner);
      if (error) throw error;
    }
  },
};

// ---------- emails de precios recibidos (pestaña Flota) ----------
async function cargarCorreos() {
  const emp = perfil?.empresas;
  q('reenvio-dir').textContent = emp?.reenvio || 'Pide al administrador que te asigne una dirección';
  const { data, error } = await sb.from('correos').select('recibido, remitente, proveedor, fecha_precios, n_precios, n_sin_ubicar, estado').order('recibido', { ascending: false }).limit(10);
  if (error) { q('correos-n').textContent = ''; q('correos').innerHTML = `<p class="empty">No se han podido cargar: ${escH(error.message)}</p>`; return; }
  const avisos = data.filter(c => c.estado !== 'ok' || c.n_sin_ubicar).length;
  q('correos-n').textContent = data.length ? `${data.length} último${data.length === 1 ? '' : 's'}${avisos ? ` · ${avisos} con aviso${avisos === 1 ? '' : 's'}` : ''}` : '';
  q('correos').innerHTML = htmlCorreos(data);
}
function htmlCorreos(data) {
  return data.length ? data.map(c => {
    const d = new Date(c.recibido);
    const estado = c.estado === 'ok'
      ? `${c.n_precios} precios${c.n_sin_ubicar ? ` · <span class="pill pend">${c.n_sin_ubicar} sin ubicar</span>` : ''}`
      : c.estado === 'sin_lector' ? '<span class="pill pend">Proveedor aún no reconocido</span>' : '<span class="pill pend">Error al leerlo</span>';
    return `<div class="env"><div class="nm">${escH(c.proveedor || c.remitente || 'Email')}</div><div class="sub" style="text-align:right">${d.toLocaleDateString('es-ES')} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="sub">${c.fecha_precios ? 'Precios del ' + new Date(c.fecha_precios + 'T12:00').toLocaleDateString('es-ES') + ' · ' : ''}${estado}</div></div>`;
  }).join('') : '<p class="empty">Todavía no ha llegado ningún email de precios.</p>';
}

q('correos-toggle').onclick = () => {
  const abrir = q('correos').hidden;
  q('correos').hidden = !abrir;
  q('correos-toggle').setAttribute('aria-expanded', abrir);
};

q('b-copiar-reenvio').onclick = async () => {
  try { await navigator.clipboard.writeText(q('reenvio-dir').textContent); q('b-copiar-reenvio').textContent = 'Copiada'; }
  catch (e) { const r = document.createRange(); r.selectNodeContents(q('reenvio-dir')); getSelection().removeAllRanges(); getSelection().addRange(r); }
  setTimeout(() => { q('b-copiar-reenvio').textContent = 'Copiar'; }, 2000);
};
