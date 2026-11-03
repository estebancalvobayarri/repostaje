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
let perfil = null, camiones = [], rutaArrancada = false;

function mensaje(id, texto, tipo = 'error') {
  const el = q(id); el.hidden = !texto; el.className = 'msg ' + tipo; el.textContent = texto || '';
}

// ---------- pantallas ----------
function verEntrada(modo = 'entrar') {
  q('pantalla-app').hidden = true; q('pantalla-entrar').hidden = false;
  q('f-entrar').hidden = modo !== 'entrar'; q('f-nueva').hidden = modo !== 'nueva';
}

async function verApp(session) {
  const { data, error } = await sb.from('perfiles').select('empresa_id, rol, nombre, empresas(nombre)').eq('id', session.user.id).maybeSingle();
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
  if (data.session) verApp(data.session);
});

q('b-salir').addEventListener('click', async () => { await sb.auth.signOut(); });

sb.auth.onAuthStateChange((evento, session) => {
  if (evento === 'PASSWORD_RECOVERY') return verEntrada('nueva');
  if (evento === 'SIGNED_OUT') { perfil = null; q('pass').value = ''; return verEntrada(); }
  if (evento === 'SIGNED_IN' && session && q('f-nueva').hidden) verApp(session);
});

(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session && !location.hash.includes('type=recovery')) verApp(data.session);
  else if (!location.hash.includes('type=recovery')) verEntrada();
})();

// ---------- pestañas ----------
function pestaña(cual) {
  q('t-ruta').setAttribute('aria-selected', cual === 'ruta');
  q('t-flota').setAttribute('aria-selected', cual === 'flota');
  q('vista-ruta').hidden = cual !== 'ruta';
  q('vista-flota').hidden = cual !== 'flota';
  window.Ruta.refrescarMapa();
}
q('t-ruta').onclick = () => pestaña('ruta');
q('t-flota').onclick = () => pestaña('flota');

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
