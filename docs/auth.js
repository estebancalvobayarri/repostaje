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
  q('pantalla-app').hidden = true; q('pantalla-entrar').hidden = false;
  q('f-entrar').hidden = modo !== 'entrar'; q('f-nueva').hidden = modo !== 'nueva';
}

async function verApp(session) {
  const [{ data, error }, { data: adm }] = await Promise.all([
    sb.from('perfiles').select('empresa_id, rol, nombre, empresas(nombre)').eq('id', session.user.id).maybeSingle(),
    sb.from('administradores').select('user_id').eq('user_id', session.user.id).maybeSingle(),
  ]);
  esAdmin = !!adm;
  q('t-admin').hidden = !esAdmin;
  q('t-flota').hidden = !data;
  if (esAdmin && !data) {
    perfil = null;
    q('empresa').textContent = 'Administración';
    q('usuario').textContent = session.user.email;
    q('pantalla-entrar').hidden = true; q('pantalla-app').hidden = false;
    camiones = [];
    if (!rutaArrancada) { rutaArrancada = true; window.Ruta.iniciar([]); }
    pestaña('admin');
    return;
  }
  if (error || !data) {
    verEntrada();
    mensaje('msg-entrar', 'Tu usuario no está asociado a ninguna empresa todavía. Pide que te den de alta y vuelve a entrar.');
    await sb.auth.signOut();
    return;
  }
  perfil = data;
  q('empresa').textContent = data.empresas?.nombre || '';
  q('usuario').textContent = session.user.email;
  q('flota-aviso').hidden = data.rol === 'gestor';
  q('b-nuevo').hidden = data.rol !== 'gestor';
  q('pantalla-entrar').hidden = true; q('pantalla-app').hidden = false;
  await cargarCamiones();
  if (esAdmin) cargarAdmin();
  if (!rutaArrancada) { rutaArrancada = true; window.Ruta.iniciar(camiones); }
  else window.Ruta.ponerCamiones(camiones);
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
  if (evento === 'SIGNED_OUT') { perfil = null; q('pass').value = ''; return verEntrada(); }
  if (evento === 'SIGNED_IN' && session && !modoNueva && q('f-nueva').hidden) verApp(session);
});

(async () => {
  if (modoNueva) return verEntrada('nueva');
  const { data } = await sb.auth.getSession();
  if (data.session) verApp(data.session); else verEntrada();
})();

// ---------- pestañas ----------
function pestaña(cual) {
  for (const t of ['ruta', 'flota', 'admin']) {
    q('t-' + t).setAttribute('aria-selected', cual === t);
    q('vista-' + t).hidden = cual !== t;
  }
  if (cual === 'admin') cargarAdmin();
  window.Ruta.refrescarMapa();
}
q('t-ruta').onclick = () => pestaña('ruta');
q('t-flota').onclick = () => pestaña('flota');
q('t-admin').onclick = () => pestaña('admin');

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
let listaAbierta = false, empAbierta = null, ultimasEmpresas = [];
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
  });

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
