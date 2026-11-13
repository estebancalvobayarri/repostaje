// Repostaje en ruta — webapp para el gestor de tráfico.
// Datos: precios de la empresa en Supabase (los carga auth.js), camiones de la Flota. Rutas: OSRM. Buscador: Photon (OpenStreetMap).
'use strict';

const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const PHOTON = 'https://photon.komoot.io/api/';
const MAX_DESVIOS_REALES = 8;   // estaciones a las que se calcula el desvío real
const RESERVA = 0.10;           // no planificar por debajo del 10 % del depósito
// Tiempo de camión a partir de la ruta de OSRM (que da tiempos de turismo)
const V_CAMION = 85;            // km/h de crucero máximo (limitador a 90)
const FACTOR_CAMION = 0.9;      // fuera de autovía, un 10 % más lento que un turismo
const CONDUCCION_MAX = 270;     // min de conducción seguida (4 h 30)
const PAUSA = 45;               // min de pausa obligatoria

const $ = id => document.getElementById(id);
const fmt = n => n.toFixed(3).replace('.', ',');
const eur = n => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const ent = n => Math.round(n).toLocaleString('es-ES');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let elegida = null; // parada elegida por el gestor para enviar al conductor (SIN = sin parada)
const SIN = 'sin';
let preferida = null;   // parada que hay que volver a elegir al abrir una ruta guardada
let abierta = null;     // id de la ruta guardada abierta en el mapa: al enviarla o guardarla otra vez se quita de la lista
const CONSULTA = 'La cuenta está en modo consulta por una factura vencida: no se pueden enviar rutas hasta que se pague.';
let D, map, capaRuta, marcadores = new Map(), ruta = null, lugares = { origen: null, destino: null };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const leer = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };

// ---------- colores por precio ----------
let pMin = 0, pTop = 1;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mezcla = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function colorPrecio(p) {
  const t = Math.max(0, Math.min(1, (p - pMin) / Math.max(0.001, pTop - pMin)));
  const [c, m, d] = [rgb(css('--cheap')), rgb(css('--mid')), rgb(css('--dear'))];
  return `rgb(${(t < .5 ? mezcla(c, m, t * 2) : mezcla(m, d, (t - .5) * 2)).join(',')})`;
}

// ---------- geometría ----------
function km(a, b) {
  const R = 6371, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// distancia de un punto a la polilínea y km recorridos hasta el punto más cercano
function sobreRuta(pt, coords, acum) {
  let mejor = { d: Infinity, k: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1], kx = 111.32 * Math.cos(a[0] * Math.PI / 180), ky = 110.57;
    const bx = (b[1] - a[1]) * kx, by = (b[0] - a[0]) * ky, px = (pt[1] - a[1]) * kx, py = (pt[0] - a[0]) * ky;
    const L2 = bx * bx + by * by, t = L2 ? Math.max(0, Math.min(1, (px * bx + py * by) / L2)) : 0;
    const d = Math.hypot(px - t * bx, py - t * by);
    if (d < mejor.d) mejor = { d, k: acum[i] + t * Math.sqrt(L2) };
  }
  return mejor;
}

// ---------- camión ----------
// Camiones de la empresa (vienen de Supabase, pantalla Flota)
let CAMIONES = [];
const SIN_CAMION = { id: null, m: 'Sin camiones', d: 'Añade tus camiones en la pestaña Flota. Mientras, se calcula con un depósito de 1.000 l.', cap: 1000, con: 35 };
const camionActual = () => CAMIONES[$('camion').value] || CAMIONES[0] || SIN_CAMION;
function ponerCamiones(lista) {
  CAMIONES = lista.filter(c => c.activo).map(c => ({ id: c.id, m: c.matricula, d: c.descripcion || '', cap: c.capacidad_litros, con: +c.consumo_l_100km }));
  $('camion').innerHTML = CAMIONES.length
    ? CAMIONES.map((c, i) => `<option value="${i}">${esc(c.m)} · ${ent(c.cap)} l</option>`).join('')
    : '<option value="0">Sin camiones · 1.000 l</option>';
  const g = leer('camion');
  if (g) { const i = CAMIONES.findIndex(c => c.id === g.id); if (i >= 0) $('camion').value = i; if (g.n != null) $('nivel').value = g.n; }
  pintarCamion();
}
const litrosQueLleva = () => camionActual().cap * $('nivel').value / 100;
function pintarCamion() {
  const c = camionActual(), n = $('nivel').value;
  $('nivel-o').textContent = n + ' %';
  $('gauge').style.width = n + '%';
  $('lleva').textContent = `Lleva unos ${ent(litrosQueLleva())} l de ${ent(c.cap)} l · consume ${String(c.con).replace('.', ',')} l/100 km. ${c.d}`;
  guardar('camion', { id: c.id, n });
  if (ruta) evaluar();
}

// ---------- buscador de lugares ----------
function buscador(campo) {
  const input = $(campo), lista = $('sugg-' + campo);
  let t, items = [], act = -1;
  const cerrar = () => { lista.hidden = true; act = -1; };
  const elegir = (it) => { lugares[campo] = it; input.value = it.label; cerrar(); abierta = null; if (lugares.origen && lugares.destino) calcular(); };
  input.addEventListener('input', () => {
    lugares[campo] = null; clearTimeout(t);
    const q = input.value.trim(); if (q.length < 3) return cerrar();
    t = setTimeout(async () => {
      try {
        const r = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&lang=default&limit=6&bbox=-10,35.5,4.6,44`);
        const j = await r.json();
        if (!j.features) throw new Error('buscador');
        items = j.features.map(f => {
          const p = f.properties, sub = [p.city || p.county, p.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
          return { label: [p.name, p.city && p.city !== p.name ? p.city : ''].filter(Boolean).join(', '), sub, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
        });
        lista.innerHTML = items.map((it, i) => `<li role="option" id="${campo}-op${i}">${esc(it.label)}<small>${esc(it.sub)}</small></li>`).join('') || '<li>No encuentro ese lugar</li>';
        lista.hidden = false;
        [...lista.children].forEach((li, i) => li.onmousedown = (e) => { e.preventDefault(); if (items[i]) elegir(items[i]); });
      } catch (e) { lista.innerHTML = '<li>El buscador no responde. Prueba otra vez en unos segundos.</li>'; lista.hidden = false; }
    }, 300);
  });
  input.addEventListener('keydown', (e) => {
    if (lista.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      [...lista.children].forEach((li, i) => li.setAttribute('aria-selected', i === act));
    } else if (e.key === 'Enter' && act >= 0) { e.preventDefault(); elegir(items[act]); }
    else if (e.key === 'Escape') cerrar();
  });
  input.addEventListener('blur', () => setTimeout(cerrar, 150));
}

// ---------- rutas ----------
async function osrm(puntos) {
  const url = OSRM + puntos.map(p => `${p.lon},${p.lat}`).join(';') + '?overview=full&geometries=geojson&annotations=distance,duration';
  const r = await fetch(url);
  if (!r.ok) throw new Error('OSRM ' + r.status);
  const j = await r.json();
  if (j.code !== 'Ok') throw new Error(j.code);
  return j.routes[0];
}
// Minutos de conducción de un camión: cada tramo a la velocidad del turismo × FACTOR_CAMION, sin pasar de V_CAMION
function conduccionCamion(r) {
  let seg = 0;
  for (const leg of r.legs || []) {
    const a = leg.annotation;
    if (!a || !a.distance || !a.duration) return Math.max(r.duration / FACTOR_CAMION, r.distance / (V_CAMION / 3.6)) / 60;
    for (let i = 0; i < a.distance.length; i++) seg += Math.max(a.duration[i] / FACTOR_CAMION, a.distance[i] / (V_CAMION / 3.6));
  }
  return seg / 60;
}
// Minutos totales: conducción más una pausa de 45 min por cada 4 h 30 de conducción que haya que superar
const conPausas = min => min + Math.max(0, Math.ceil(min / CONDUCCION_MAX) - 1) * PAUSA;
const hm = min => { const t = Math.round(min); return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, '0')}`; };
const espera = ms => new Promise(r => setTimeout(r, ms));

// La ruta se calcula sola al elegir origen y destino, al intercambiarlos y al abrir una ruta guardada.
// No hay botón «Calcular ruta»: recalcular quitaba la parada elegida por el gestor y volvía a poner la mejor.
let pedidaRuta = 0;   // solo vale la respuesta de la última ruta pedida
async function calcular() {
  const { origen, destino } = lugares;
  if (!origen || !destino) { $('stops').innerHTML = '<p class="empty">Elige origen y destino de la lista de sugerencias.</p>'; return; }
  const n = ++pedidaRuta;
  $('stops').innerHTML = '<p class="empty">Calculando la ruta…</p>';
  try {
    const r = await osrm([origen, destino]);
    if (n !== pedidaRuta) return;
    const coords = r.geometry.coordinates.map(([lo, la]) => [la, lo]);
    const acum = [0]; for (let i = 1; i < coords.length; i++) acum.push(acum[i - 1] + km(coords[i - 1], coords[i]));
    const conduce = conduccionCamion(r);
    ruta = { coords, acum, km: r.distance / 1000, conduce, min: conPausas(conduce), desvios: new Map() };
    elegida = null;
    evaluar();
    dibujarRuta();
    await desviosReales();
  } catch (err) {
    if (n !== pedidaRuta) return;
    $('stops').innerHTML = '<p class="empty">No he podido calcular la ruta: el servicio de rutas no responde. <button type="button" class="btn ghost" id="reintentar">Reintentar</button></p>';
    $('reintentar').onclick = calcular;
  }
}

function dibujarRuta() {
  capaRuta.clearLayers();
  const linea = L.polyline(ruta.coords, { color: css('--route'), weight: 5, opacity: .85 }).addTo(capaRuta);
  [['origen', false], ['destino', true]].forEach(([k, lleno]) => L.circleMarker([lugares[k].lat, lugares[k].lon], {
    radius: 7, color: css('--route'), weight: 3, fillColor: lleno ? css('--route') : css('--panel'), fillOpacity: 1 }).bindTooltip(lugares[k].label).addTo(capaRuta));
  map.fitBounds(linea.getBounds(), { paddingTopLeft: [30, 30 + altoFlot()], paddingBottomRight: [30, 30] });
}

// Desvío real: ruta pasando por la estación menos ruta directa
async function desviosReales() {
  const cand = candidatas().slice(0, MAX_DESVIOS_REALES);
  for (const c of cand) {
    if (ruta.desvios.has(c.e.id)) continue;
    try {
      const r = await osrm([lugares.origen, { lat: c.e.lat, lon: c.e.lon }, lugares.destino]);
      ruta.desvios.set(c.e.id, { km: Math.max(0, r.distance / 1000 - ruta.km), min: Math.max(0, conduccionCamion(r) - ruta.conduce) });
      evaluar();
    } catch (e) { /* se queda con la estimación */ }
    await espera(350); // el servidor público de OSRM pide no saturarlo
  }
}

// Estaciones cerca de la ruta, con litros que caben al llegar y coste
function candidatas() {
  if (!ruta) return [];
  const c = camionActual(), radio = +$('radio').value, lleva = litrosQueLleva();
  const out = [];
  for (const e of D.est) {
    if (excluidas.has(e.id)) continue;
    const s = sobreRuta([e.lat, e.lon], ruta.coords, ruta.acum);
    if (s.d > radio) continue;
    const real = ruta.desvios.get(e.id);
    const desvio = real ? real.km : s.d * 2 * 1.3;          // estimación: ida y vuelta x factor de carretera
    const quedan = lleva - (s.k + desvio / 2) * c.con / 100; // litros al llegar a la estación
    const alcanzable = quedan >= c.cap * RESERVA * 0.5;
    const caben = Math.max(0, c.cap - Math.max(0, quedan));
    const litros = litrosManual != null ? Math.min(litrosManual, caben) : caben;   // lo que elige el gestor, si cabe
    const costeDesvio = desvio * c.con / 100 * e.p;
    const efectivo = litros > 0 ? e.p + costeDesvio / litros : Infinity; // €/l con el desvío repartido
    out.push({ e, k: s.k, d: s.d, desvio, real: !!real, min: real ? real.min : null, quedan, alcanzable, caben, litros, coste: litros * e.p + costeDesvio, efectivo });
  }
  return out.sort((a, b) => (b.alcanzable - a.alcanzable) || a.efectivo - b.efectivo);
}

function evaluar() {
  const c = camionActual(), lleva = litrosQueLleva(), necesita = ruta.km * c.con / 100;
  $('resumen').hidden = false;
  $('k-km').textContent = ent(ruta.km);
  $('k-t').textContent = hm(ruta.min);
  $('k-l').textContent = ent(necesita);
  const sobra = lleva - necesita, reserva = c.cap * RESERVA, v = $('verdict');
  if (sobra >= reserva) {
    v.className = 'verdict ok';
    v.innerHTML = `Llega sin repostar, con unos <b>${ent(sobra)} l</b> (${Math.round(sobra / c.cap * 100)} %). Repostar en ruta solo si compensa el precio.`;
  } else {
    const kmMax = Math.max(0, (lleva - reserva) / c.con * 100);
    v.className = 'verdict need';
    v.innerHTML = `No llega con reserva: necesita <b>${ent(necesita)} l</b> y lleva <b>${ent(lleva)} l</b>. Debe repostar antes del <b>km ${ent(kmMax)}</b>.`;
  }

  const lista = candidatas();
  const ok = lista.filter(x => x.alcanzable);
  const mejor = ok[0];
  if (preferida) {
    if (preferida === SIN || lista.some(x => x.e.id === preferida && x.alcanzable)) elegida = preferida;
    preferida = null;
  }
  if (elegida !== SIN && !lista.some(x => x.e.id === elegida && x.alcanzable)) elegida = mejor ? mejor.e.id : SIN;
  $('stops-n').textContent = lista.length ? `${lista.length} a menos de ${$('radio').value} km` : '';
  // Primera opción de la lista: mandar la ruta sin parada de repostaje
  const sinSel = elegida === SIN;
  const filaSin = `<div class="stop sin${sinSel ? ' elegida' : ''}" tabindex="0" role="radio" aria-checked="${sinSel}" data-id="${SIN}" data-ok="1">
        <span class="radio" aria-hidden="true"></span><div class="km" aria-hidden="true">—</div>
        <div style="min-width:0"><div class="nm">Sin parada en esta ruta</div><div class="sub">Se manda solo la ruta, sin repostar</div></div><div class="pr"></div></div>`;
  {
    const scrollPrevio = $('stops').scrollTop;
    $('stops').innerHTML = filaSin + (!lista.length
      ? `<p class="empty">Ninguna estación de vuestras tarjetas a menos de ${$('radio').value} km de esta ruta. Amplía la distancia o revisa el depósito antes de salir.</p>`
      : lista.sort((a, b) => a.k - b.k).map(x => {
      const dif = mejor && x !== mejor && x.alcanzable ? (x.efectivo - mejor.efectivo) * x.litros : 0;
      const des = `${x.real ? '' : '≈'}${x.desvio < 0.5 ? '0' : ent(x.desvio)} km de desvío${x.min != null ? ` · +${Math.round(x.min)} min` : ''}`;
      const sel = x.e.id === elegida;
      return `<div class="stop${x === mejor ? ' best' : ''}${x.alcanzable ? '' : ' off'}${sel ? ' elegida' : ''}" tabindex="0" role="radio" aria-checked="${sel}" data-id="${esc(x.e.id)}" data-ok="${x.alcanzable ? 1 : 0}">
        <span class="radio" aria-hidden="true"></span>
        <div class="km"><b>${ent(x.k)}</b>km</div>
        <div style="min-width:0"><div class="nm">${esc(x.e.n)}</div>
          <div class="sub">${x.e.t} · ${des}${x.alcanzable ? ` · caben ${ent(x.caben)} l` : ' · no llega con reserva'}</div></div>
        <div class="pr"><b style="color:${colorPrecio(x.e.p)}">${fmt(x.e.p)}</b>
          <small>${x === mejor ? '<span class="tagb">Mejor</span>' : x.alcanzable ? '+' + eur(dif) : '—'}</small></div>
      </div>`;
    }).join(''));
    [...$('stops').querySelectorAll('.stop')].forEach(el => {
      const abrir = () => {
        if (el.dataset.ok === '1') { elegida = el.dataset.id; evaluar(); }
        const m = marcadores.get(el.dataset.id); if (!m) return;
        map.setView(m.getLatLng(), Math.max(map.getZoom(), 12)); m.openPopup();
      };
      el.onclick = abrir; el.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } };
    });
    $('stops').scrollTop = scrollPrevio;   // al elegir otra parada la lista no salta arriba
  }
  avisoMas();
  pintarEnvio(elegida === SIN ? SIN : lista.find(x => x.e.id === elegida), ok);
  const ids = new Set(lista.map(x => x.e.id));
  for (const [id, m] of marcadores) {
    const el = m.getElement && m.getElement(); if (!el) continue;
    el.querySelector('.pin').classList.toggle('on', ids.has(id));
    el.querySelector('.pin').classList.toggle('dim', ruta && !ids.has(id));
  }
}

// Si la lista de paradas tiene scroll, se avisa de cuántas quedan por debajo
function avisoMas() {
  const lista = $('stops'), b = $('mas-paradas');
  const fondo = lista.getBoundingClientRect().top + lista.clientHeight;
  const ocultas = lista.scrollHeight > lista.clientHeight + 2
    ? [...lista.querySelectorAll('.stop')].filter(el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 > fondo; }).length : 0;
  b.hidden = !ocultas;
  b.textContent = ocultas === 1 ? '1 parada más ↓' : `${ocultas} paradas más ↓`;
  $('stops-sec').toggleAttribute('data-mas', ocultas > 0);
}

// ---------- enviar la ruta al conductor ----------
// El mensaje no lleva el enlace de la ruta en Google Maps
function mensajeRuta(x, litros) {
  const c = camionActual(), o = lugares.origen, d = lugares.destino;
  return [
    `*Ruta:* ${o.label} → ${d.label}`,
    `${ent(ruta.km)} km · ${hm(ruta.min)} min aprox.`,
    c.id ? `*Camión:* ${c.m}` : null,
    '',
    `*Repostar en:* ${x.e.n}`,
    `Tarjeta ${x.e.t} · km ${ent(x.k)} de la ruta`,
    `Precio: ${fmt(x.e.p)} €/l sin IVA · echar ${ent(litros)} l`,
    x.e.dir ? `Dirección: ${x.e.dir}, ${x.e.mun}` : null,
  ].filter(v => v !== null).join('\n');
}

function mensajeSinParada() {
  const c = camionActual(), o = lugares.origen, d = lugares.destino;
  return [
    `*Ruta:* ${o.label} → ${d.label}`,
    `${ent(ruta.km)} km · ${hm(ruta.min)} min aprox.`,
    c.id ? `*Camión:* ${c.m}` : null,
    '',
    'Sin parada de repostaje en esta ruta.',
  ].filter(v => v !== null).join('\n');
}

// Las rutas guardadas antes de este cambio llevan el enlace en el mensaje: se quita al enviarlas
function sinEnlaceRuta(m) {
  return String(m || '')
    .replace(/\n*(Ruta con la parada en Google Maps|Ruta en Google Maps):\n\S+\s*$/, '')
    .trimEnd();
}

// Referencia del ahorro: media de precios de las otras paradas de la ruta a las que llega
// (solo estaciones habilitadas por la empresa, porque las quitadas ya no entran en la lista)
let envioActual = null;
let litrosManual = null;   // null = llenar el depósito
function pintarEnvio(x, alcanzables = []) {
  const box = $('envio');
  if (!x) { box.hidden = true; envioActual = null; return; }
  const secLitros = $('sec-litros');
  $('caja-litros').hidden = x === SIN; if (secLitros) secLitros.hidden = x === SIN;
  if (x === SIN) { pintarSinParada(); return; }
  const otras = alcanzables.filter(y => y.e.id !== x.e.id);
  const media = otras.length ? otras.reduce((t, y) => t + y.e.p, 0) / otras.length : null;
  const cara = otras.reduce((m, y) => (!m || y.e.p > m.e.p ? y : m), null);
  // Litros: los que pone el gestor (si caben al llegar) o, por defecto, llenar el depósito
  const caben = Math.floor(x.caben / 10) * 10, c = camionActual();
  const litros = litrosManual != null ? Math.min(litrosManual, Math.floor(x.caben)) : caben;
  if (document.activeElement !== $('litros')) $('litros').value = litros;
  $('litros').max = Math.floor(x.caben);
  $('litros-lleno').hidden = litrosManual == null;
  $('litros-nota').textContent = litrosManual == null
    ? `Por defecto, llenar el depósito: al llegar caben unos ${ent(caben)} l.`
    : litrosManual > x.caben
      ? `Al llegar solo caben unos ${ent(x.caben)} l: se cuentan ${ent(litros)} l.`
      : `Al llegar caben unos ${ent(caben)} l.`;
  envioActual = {
    fecha_precios: D.fecha, camion_id: c.id, matricula: c.id ? c.m : null,
    origen: lugares.origen.label, destino: lugares.destino.label, km_ruta: Math.round(ruta.km * 10) / 10,
    estacion_id: x.e.id, estacion_nombre: x.e.n, tarjeta: x.e.t, precio_elegido: x.e.p, litros,
    estacion_cara_nombre: cara ? cara.e.n : null, precio_cara: cara ? cara.e.p : x.e.p,
    precio_referencia: media != null ? Math.round(media * 10000) / 10000 : x.e.p, n_referencia: otras.length, referencia: 'media',
  };
  box.hidden = false;
  $('envio-txt').innerHTML = `Parada elegida: <b>${esc(x.e.n)}</b> (${x.e.t}, km ${ent(x.k)}, ${fmt(x.e.p)} €/l). Pulsa otra parada de la lista para cambiarla.`;
  const texto = mensajeRuta(x, litros);
  $('b-wa').href = 'https://wa.me/?text=' + encodeURIComponent(texto);
  const ahorro = Math.round((envioActual.precio_referencia - envioActual.precio_elegido) * litros * 100) / 100;
  const frente = `frente a la media de ${otras.length === 1 ? 'la otra parada' : `las otras ${otras.length} paradas`} de la ruta (${fmt(media ?? x.e.p)} €/l).`;
  $('envio-ahorro').classList.toggle('extra', ahorro < 0);
  $('envio-ahorro').textContent = !otras.length
    ? 'Es la única parada de la ruta: no hay ahorro que comparar.'
    : ahorro < 0 ? `Coste extra estimado: ${eur(-ahorro)} ${frente}` : `Ahorro estimado: ${eur(ahorro)} ${frente}`;
  $('b-guardar-ruta').onclick = () => guardarSinEnviar(texto, { ...envioActual }, x, litros);
  $('b-wa').onclick = (ev) => alEnviar(ev, null, { ...envioActual });
  $('b-copiar').onclick = (ev) => alEnviar(ev, texto, { ...envioActual });
}
function avisoEnvio(texto, ok = true, ms = 6000) {
  $('msg-envio').className = 'msg ' + (ok ? 'ok' : 'error'); $('msg-envio').textContent = texto;
  $('msg-envio').hidden = false; clearTimeout(avisoEnvio.t); avisoEnvio.t = setTimeout(() => { $('msg-envio').hidden = true; }, ms);
}

// «Enviar por WhatsApp» y «Copiar mensaje» cuentan igual: los dos apuntan la ruta en el informe de ahorro
// (si lleva parada), la quitan de «rutas guardadas» si venía de ahí y la borran de la pantalla en 10 minutos.
// texto = null: WhatsApp (el enlace se abre solo); con texto: se copia al portapapeles.
async function alEnviar(ev, texto, datos) {
  if (window.Cuenta?.consulta) { ev.preventDefault(); avisoEnvio(CONSULTA, false); return; }
  let pre = '';
  if (texto != null) {
    try { await navigator.clipboard.writeText(texto); pre = 'Mensaje copiado. Pégalo en el chat del conductor. '; }
    catch (e) { avisoEnvio('No se ha podido copiar el mensaje, así que no se ha apuntado en el informe. Prueba otra vez.', false); return; }
  }
  const tras = ` La ruta se quitará de la pantalla en ${MIN_BORRAR} minutos.`;
  if (!datos || !datos.estacion_id) {   // sin parada: no cuenta en el informe
    await quitarAbierta();
    borrarRuta = { clave: claveRuta(), t: Date.now() + MIN_BORRAR * 60 * 1000 };
    avisoEnvio(pre + 'Ruta sin parada: no cuenta en el informe de ahorro.' + tras);
    return;
  }
  try {
    const r = await registrarEnvio(datos);
    await quitarAbierta();
    borrarRuta = { clave: claveRuta(), t: Date.now() + MIN_BORRAR * 60 * 1000 };
    avisoEnvio(pre + textoRegistro(r, datos) + tras, true, 8000);
  } catch (e) {
    avisoEnvio(pre + (texto == null ? 'Se ha abierto WhatsApp, pero ' : '') + 'no se ha podido guardar en el informe: ' + e.message, false, 8000);
  }
}
const ahorroDe = d => Math.round((d.precio_referencia - d.precio_elegido) * d.litros * 100) / 100;
function textoRegistro(r, d) {
  if (r.estado === 'ya') return 'Esta ruta ya estaba en el informe de ahorro: no se cuenta dos veces.';
  const a = ahorroDe(d), cifra = a < 0 ? `coste extra de ${eur(-a)}` : eur(a);
  if (r.estado === 'cambiado') return `Actualizada en el informe de ahorro con la nueva parada o litros (${cifra}); no se cuenta dos veces.`;
  if (r.estado === 'doble') return `Guardado en el informe (${cifra}), pero no se ha podido quitar el envío anterior de esta ruta: bórralo a mano en el informe.`;
  return `Guardado en el informe de ahorro (${cifra}).`;
}

// Una ruta (mismo camión, origen, destino y día de precios) solo se apunta una vez en el informe.
// Si se vuelve a mandar o copiar en los 30 minutos siguientes:
//  - con la misma parada y litros, no se guarda otra vez;
//  - con otra parada u otros litros, se sustituye el envío anterior por el nuevo.
// Mientras se guarda, un segundo clic espera al primero en vez de guardar otra fila.
const VENTANA_ENVIO_MIN = 30;
let registrando = null;
function registrarEnvio(datos) {
  if (registrando) return registrando;
  registrando = (async () => {
    const previo = await window.Registro.reciente(datos, VENTANA_ENVIO_MIN);
    if (previo && previo.estacion_id === datos.estacion_id && +previo.litros === +datos.litros) return { estado: 'ya' };
    await window.Registro.guardar(datos);
    if (!previo) return { estado: 'nuevo' };
    try { await window.Registro.borrar(previo.id); return { estado: 'cambiado' }; }
    catch (e) { return { estado: 'doble' }; }
  })().finally(() => { registrando = null; });
  return registrando;
}

// Sin parada: se manda solo la ruta y no cuenta en el informe de ahorro
function pintarSinParada() {
  envioActual = null;
  const c = camionActual(), necesita = ruta.km * c.con / 100, llega = litrosQueLleva() - necesita >= c.cap * RESERVA;
  $('envio').hidden = false;
  $('envio-txt').innerHTML = 'Sin parada: se manda solo la ruta. Pulsa una estación de la lista para añadir una parada.'
    + (llega ? '' : ' <b>Ojo: con el combustible que lleva no llega con reserva.</b>');
  $('envio-ahorro').classList.remove('extra');
  $('envio-ahorro').textContent = 'Sin parada no hay repostaje, así que no cuenta en el informe de ahorro.';
  const texto = mensajeSinParada();
  $('b-wa').href = 'https://wa.me/?text=' + encodeURIComponent(texto);
  $('b-wa').onclick = (ev) => alEnviar(ev, null, null);
  $('b-guardar-ruta').onclick = () => guardarSinEnviar(texto, null, null, null);
  $('b-copiar').onclick = (ev) => alEnviar(ev, texto, null);
}

// ---------- rutas guardadas sin enviar ----------
// El gestor prepara rutas para más adelante («Guardar sin enviar») y las manda luego desde «Ver rutas guardadas».
let rutasG = [], ultimaGuardada = null;
const fechaCorta = f => { const [y, m, d] = String(f).split('-'); return `${d}/${m}/${y}`; };
async function quitarAbierta() {
  if (!abierta) return;
  const id = abierta; abierta = null;
  try { await window.RutasGuardadas.borrar(id); } catch (e) { /* se queda en la lista; se puede borrar a mano */ }
  cargarGuardadas();
}
async function guardarSinEnviar(texto, datosEnvio, x, litros) {
  if (window.Cuenta?.consulta) { avisoEnvio(CONSULTA, false); return; }
  const c = camionActual();
  const clave = [c.id, lugares.origen.label, lugares.destino.label, x ? x.e.id : SIN, litros].join('|');
  if (ultimaGuardada === clave) { avisoEnvio('Esta ruta ya está guardada. La tienes en «Ver rutas guardadas».'); return; }
  const fila = {
    fecha_precios: D.fecha, camion_id: c.id, matricula: c.id ? c.m : null,
    origen: lugares.origen.label, destino: lugares.destino.label,
    km_ruta: Math.round(ruta.km * 10) / 10, min_ruta: Math.round(ruta.min),
    estacion_id: x ? x.e.id : null, estacion_nombre: x ? x.e.n : null, tarjeta: x ? x.e.t : null,
    precio: x ? x.e.p : null, litros: x ? litros : null,
    mensaje: texto, envio: datosEnvio,
    plan: { origen: lugares.origen, destino: lugares.destino, nivel: +$('nivel').value, litros: litrosManual, radio: +$('radio').value },
  };
  $('b-guardar-ruta').disabled = true;
  try {
    await window.RutasGuardadas.guardar(fila);
    const anterior = abierta; abierta = null;   // si era una ruta guardada abierta, la nueva versión la sustituye
    if (anterior) { try { await window.RutasGuardadas.borrar(anterior); } catch (e) {} }
    ultimaGuardada = clave;
    await cargarGuardadas();
    avisoEnvio('Ruta guardada sin enviar. La tienes en «Ver rutas guardadas» para mandarla cuando quieras.');
  } catch (e) { avisoEnvio('No se ha podido guardar la ruta: ' + e.message, false); }
  $('b-guardar-ruta').disabled = false;
}
async function cargarGuardadas() {
  try { rutasG = await window.RutasGuardadas.listar(); } catch (e) { /* se queda la lista anterior */ }
  $('guardadas-n').textContent = rutasG.length;
  if (!$('guardadas').hidden) pintarGuardadas();
}
function avisoGuardadas(texto, ok = true) {
  const m = $('msg-guardadas'); m.className = 'msg ' + (ok ? 'ok' : 'error'); m.textContent = texto; m.hidden = false;
  clearTimeout(avisoGuardadas.t); avisoGuardadas.t = setTimeout(() => { m.hidden = true; }, 7000);
}
function pintarGuardadas() {
  const caja = $('guardadas-lista');
  if (!rutasG.length) { caja.innerHTML = '<p class="small">No hay rutas guardadas. Usa «Guardar sin enviar» al preparar una ruta.</p>'; return; }
  const ico = $('b-wa').querySelector('svg').outerHTML;
  caja.innerHTML = rutasG.map(g => {
    const cuando = new Date(g.creado).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const t = g.min_ruta != null ? ` · ${hm(g.min_ruta)}` : '';
    const parada = g.estacion_id
      ? `Parada: <b>${esc(g.estacion_nombre)}</b> (${esc(g.tarjeta || '')}, ${fmt(+g.precio)} €/l, ${ent(+g.litros)} l)`
      : 'Sin parada';
    const viejos = g.estacion_id && D.fecha && g.fecha_precios && g.fecha_precios < D.fecha;
    return `<div class="rg" data-id="${esc(g.id)}">
      <div class="rg-ruta">${esc(g.origen)} → ${esc(g.destino)}</div>
      <div class="small">${g.matricula ? esc(g.matricula) + ' · ' : ''}${g.km_ruta != null ? ent(+g.km_ruta) + ' km' : ''}${t} · guardada el ${cuando}</div>
      <div class="small">${parada}</div>
      ${viejos ? `<div class="small aviso">Precios del ${fechaCorta(g.fecha_precios)}: ya hay precios más nuevos. Ábrela en el mapa para recalcularla.</div>` : ''}
      <div class="row2">
        <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(sinEnlaceRuta(g.mensaje))}" target="_blank" rel="noopener" data-enviar>${ico}Enviar ahora</a>
        <button class="mini" type="button" data-abrir>Abrir en el mapa</button>
        <button class="mini" type="button" data-borrar>Borrar</button>
      </div></div>`;
  }).join('');
}
async function enviarGuardada(g) {
  // WhatsApp se abre con el enlace; a la vez se apunta en el informe (si lleva parada) y se quita de la lista
  try {
    if (g.envio) await registrarEnvio(g.envio);   // tampoco cuenta dos veces si ya se mandó
    await window.RutasGuardadas.borrar(g.id);
    if (abierta === g.id) abierta = null;
    avisoGuardadas(g.envio ? 'Ruta enviada y apuntada en el informe de ahorro.' : 'Ruta enviada (sin parada).');
  } catch (e) { avisoGuardadas('Se ha abierto WhatsApp, pero no se ha podido apuntar el envío: ' + e.message, false); }
  cargarGuardadas();
}
function abrirGuardada(g) {
  const p = g.plan || {};
  cerrarGuardadas();
  const i = CAMIONES.findIndex(c => c.id === g.camion_id);
  if (i >= 0) $('camion').value = i;
  if (p.nivel != null) $('nivel').value = p.nivel;
  pintarCamion();
  if (p.radio) { $('radio').value = p.radio; $('radio-n').value = p.radio; }
  lugares = { origen: p.origen, destino: p.destino };
  $('origen').value = p.origen.label; $('destino').value = p.destino.label;
  litrosManual = p.litros ?? null;
  preferida = g.estacion_id || SIN;
  abierta = g.id; ultimaGuardada = null;
  calcular();
}
function abrirGuardadas() { $('guardadas').hidden = false; pintarGuardadas(); cargarGuardadas(); $('guardadas-x').focus(); }
function cerrarGuardadas() { $('guardadas').hidden = true; $('b-guardadas').focus(); }
function montarGuardadas() {
  $('b-guardadas').onclick = abrirGuardadas;
  $('guardadas-x').onclick = cerrarGuardadas;
  $('guardadas').addEventListener('click', ev => { if (ev.target === $('guardadas')) cerrarGuardadas(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('guardadas').hidden) cerrarGuardadas(); });
  $('guardadas-lista').addEventListener('click', ev => {
    const fila = ev.target.closest('.rg'); if (!fila) return;
    const g = rutasG.find(r => r.id === fila.dataset.id); if (!g) return;
    if (ev.target.closest('[data-enviar]')) {
      if (window.Cuenta?.consulta) { ev.preventDefault(); avisoGuardadas(CONSULTA, false); return; }
      enviarGuardada(g);
    } else if (ev.target.closest('[data-abrir]')) abrirGuardada(g);
    else if (ev.target.closest('[data-borrar]')) {
      const b = ev.target.closest('[data-borrar]');
      if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = '¿Borrar? Pulsa otra vez'; return; }
      window.RutasGuardadas.borrar(g.id).then(() => { if (abierta === g.id) abierta = null; avisoGuardadas('Ruta borrada.'); cargarGuardadas(); })
        .catch(e => avisoGuardadas('No se ha podido borrar: ' + e.message, false));
    }
  });
  cargarGuardadas();
}

// ---------- popups ----------
function popup(e) {
  const c = camionActual(), litros = Math.round(c.cap - litrosQueLleva());
  const x = candidatas().find(y => y.e.id === e.id);
  return `<div class="pop"><div style="font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">Tarjeta ${e.t}</div>
    <h3>${esc(e.n)}</h3>
    <div class="big" style="color:${colorPrecio(e.p)}">${fmt(e.p)} <span style="font:400 .85rem var(--f-body);color:var(--muted)">€/l sin IVA · ${fmt(e.pi)} con IVA</span></div>
    <dl>${x ? `<dt>Km de la ruta</dt><dd>${ent(x.k)}</dd><dt>Desvío${x.real ? '' : ' (estimado)'}</dt><dd>${ent(x.desvio)} km</dd><dt>Caben al llegar</dt><dd>${ent(x.litros)} l</dd><dt>Coste con desvío</dt><dd>${eur(x.coste)}</dd>`
      : `<dt>Llenar ${ent(litros)} l ahora</dt><dd>${eur(litros * e.p)}</dd>`}</dl>
    <div style="color:var(--muted);font-size:.85rem">${esc(e.dir)} · ${esc(e.mun)}</div>
    ${e.c === 'media' ? '<div style="color:var(--mid);font-size:.85rem">Ubicación probable: confirmar antes de mandar un camión.</div>' : ''}
    <a href="https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lon}" target="_blank" rel="noopener">Abrir en Google Maps ↗</a></div>`;
}

// Forma del marcador por tarjeta: círculo, rombo, cuadrado, triángulo
const PROVEEDORES = ['Valcarce', 'DST', 'Staroil', 'Andamur'];
const TRIANGULO = '<svg viewBox="0 0 16 15" width="16" height="15"><path d="M8 1.5 14.8 13.6H1.2z" fill="var(--c)" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
const forma = t => ({ Valcarce: 'v', DST: 'd', Staroil: 's', Andamur: 'a' }[t] || 'v');

// ---------- qué estaciones se ven (solo escritorio) ----------
// El gestor puede quitar estaciones del mapa y de las rutas. Se guarda para toda la empresa;
// las estaciones nuevas que lleguen por email aparecen marcadas.
let excluidas = new Set(), guardadas = new Set(), tGuardar;
function aplicarSeleccion() {
  for (const e of D.est) {
    const m = marcadores.get(e.id); if (!m) continue;
    if (excluidas.has(e.id)) m.remove(); else if (!map.hasLayer(m)) m.addTo(map);
  }
  const n = D.est.filter(e => !excluidas.has(e.id)).length;
  $('sel-cuenta').textContent = n === D.est.length ? 'todas' : `${n} de ${D.est.length}`;
  if (ruta) evaluar();
  clearTimeout(tGuardar); tGuardar = setTimeout(guardarSeleccion, 700);
}
async function guardarSeleccion() {
  const quitar = [...excluidas].filter(id => !guardadas.has(id)), poner = [...guardadas].filter(id => !excluidas.has(id));
  if (!quitar.length && !poner.length) return;
  const estado = $('sel-estado');
  estado.textContent = 'Guardando…'; estado.className = 'sel-estado';
  try {
    await window.Seleccion.guardar(quitar, poner);
    guardadas = new Set(excluidas);
    estado.textContent = 'Guardado para toda la empresa'; estado.className = 'sel-estado ok';
  } catch (e) { estado.textContent = 'No se ha podido guardar: ' + e.message; estado.className = 'sel-estado error'; }
}
function montarSeleccion() {
  const panel = L.control({ position: 'bottomleft' });
  panel.onAdd = () => {
    const div = L.DomUtil.create('div', 'sel-est'); div.id = 'sel-est'; div.hidden = true;
    div.setAttribute('role', 'dialog'); div.setAttribute('aria-label', 'Estaciones en el mapa');
    div.innerHTML = `<div class="sel-cab"><b>Estaciones en el mapa</b><span id="sel-n"></span><button type="button" class="sel-x" id="sel-x" aria-label="Cerrar">×</button></div>
      <input type="search" id="sel-buscar" placeholder="Buscar estación, población o tarjeta" autocomplete="off">
      <label class="sel-todas"><input type="checkbox" id="sel-todas"> <span id="sel-todas-t">Seleccionar todas</span></label>
      <div class="sel-lista" id="sel-lista"></div>
      <p class="sel-pie"><span id="sel-estado" class="sel-estado"></span><span id="sel-nota">Solo las marcadas salen en el mapa y en las paradas de las rutas. Las estaciones nuevas aparecen marcadas.</span></p>`;
    L.DomEvent.disableClickPropagation(div); L.DomEvent.disableScrollPropagation(div);
    return div;
  };
  panel.addTo(map);
  const editar = window.Seleccion.puedeEditar();
  if (!editar) $('sel-nota').textContent = 'Solo un gestor puede cambiar qué estaciones se ven.';
  const lista = D.est.slice().sort((a, b) => PROVEEDORES.indexOf(a.t) - PROVEEDORES.indexOf(b.t) || a.n.localeCompare(b.n, 'es'));
  const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const visibles = () => { const q = norm($('sel-buscar').value.trim()); return q ? lista.filter(e => norm(`${e.n} ${e.mun} ${e.prov} ${e.t}`).includes(q)) : lista; };
  const pintar = () => {
    const vis = visibles(), marcadas = vis.filter(e => !excluidas.has(e.id)).length;
    const todas = $('sel-todas');
    todas.checked = vis.length > 0 && marcadas === vis.length; todas.indeterminate = marcadas > 0 && marcadas < vis.length;
    todas.disabled = !editar || !vis.length;
    const filtro = vis.length !== lista.length ? ` (${vis.length})` : '';
    $('sel-todas-t').textContent = (todas.checked ? 'Deseleccionar todas' : 'Seleccionar todas') + filtro;
    $('sel-n').textContent = `${lista.filter(e => !excluidas.has(e.id)).length} de ${lista.length}`;
    let html = '', grupo = null;
    for (const e of vis) {
      if (e.t !== grupo) {
        grupo = e.t; const g = vis.filter(x => x.t === grupo), gm = g.filter(x => !excluidas.has(x.id)).length;
        html += `<div class="sel-grupo"><i class="${forma(grupo)}"></i>${esc(grupo)}<span>${gm} de ${g.length}</span></div>`;
      }
      html += `<label class="sel-item"><input type="checkbox" data-id="${esc(e.id)}"${excluidas.has(e.id) ? '' : ' checked'}${editar ? '' : ' disabled'}>
        <span class="sel-nm">${esc(e.n)}<small>${esc([e.mun, e.prov].filter(Boolean).join(' · '))}</small></span><span class="sel-pr">${fmt(e.p)}</span></label>`;
    }
    const caja = $('sel-lista'), arriba = caja.scrollTop;
    caja.innerHTML = html || '<p class="sel-vacio">Ninguna estación coincide con la búsqueda.</p>';
    caja.scrollTop = arriba;
  };
  const abrir = (si) => {
    $('sel-est').hidden = !si; $('b-sel').setAttribute('aria-expanded', si);
    $('b-sel').querySelector('span').textContent = si ? '▾' : '▴';
    if (si) { pintar(); $('sel-buscar').focus(); }
  };
  $('b-sel').onclick = () => abrir($('sel-est').hidden);
  $('sel-x').onclick = () => abrir(false);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('sel-est').hidden) abrir(false); });
  $('sel-buscar').oninput = pintar;
  $('sel-todas').onchange = () => {
    const vis = visibles(), marcar = $('sel-todas').checked;
    for (const e of vis) marcar ? excluidas.delete(e.id) : excluidas.add(e.id);
    pintar(); aplicarSeleccion();
  };
  $('sel-lista').onchange = ev => {
    const c = ev.target.closest('input[data-id]'); if (!c) return;
    c.checked ? excluidas.delete(c.dataset.id) : excluidas.add(c.dataset.id);
    pintar(); aplicarSeleccion();
  };
  const n = D.est.filter(e => !excluidas.has(e.id)).length;
  $('sel-cuenta').textContent = n === D.est.length ? 'todas' : `${n} de ${D.est.length}`;
}

// ---------- reparto de la pantalla en escritorio ----------
// Escritorio ancho: litros y paradas van al panel (debajo del formulario de la ruta) y el resumen
// y el envío flotan sobre la parte de arriba del mapa. En móvil todo queda como siempre.
const altoFlot = () => (document.getElementById('flotante')?.offsetHeight || 0);
const ANCHO = matchMedia('(min-width: 1100px)');
const MOVIBLES = ['caja-litros', 'stops-sec', 'resumen', 'envio'];
const sitios = new Map();
function repartir() {
  const sec = (id) => { let s = $(id); if (!s) { s = document.createElement('section'); s.className = 'block'; s.id = id; } return s; };
  if (!sitios.size) for (const id of MOVIBLES) { const el = $(id), a = document.createComment(id); el.before(a); sitios.set(id, a); }
  if (ANCHO.matches) {
    const litros = sec('sec-litros');
    litros.append($('caja-litros'));
    $('ruta').after(litros); litros.after($('stops-sec'));
    $('flotante').append($('resumen'), $('envio'));
  } else {
    for (const [id, a] of sitios) a.after($(id));
    $('sec-litros')?.remove();
  }
  if (map) { map.invalidateSize(); }
}
ANCHO.addEventListener('change', repartir);
new ResizeObserver(() => {
  const h = altoFlot(), app = $('pantalla-app');
  app.style.setProperty('--alto-flot', h + 'px'); app.toggleAttribute('data-flot', h > 0);
}).observe(document.getElementById('flotante'));

// ---------- arranque ----------
async function iniciar(camiones) {
  D = await window.Precios.cargar();
  try { excluidas = await window.Seleccion.cargar(); guardadas = new Set(excluidas); } catch (e) { excluidas = new Set(); }
  if (!D.est.length) {
    $('fecha').textContent = 'Todavía no hay precios: reenvía los emails de tus proveedores a la dirección de la pestaña Flota.';
    D.est = [];
  } else {
    const [y, m, d] = D.fecha.split('-');
    $('fecha').textContent = `Precios para el ${d}/${m}/${y} · ${D.est.length} estaciones de vuestras tarjetas`;
  }
  const ps = D.est.length ? D.est.map(e => e.p).sort((a, b) => a - b) : [0];
  pMin = ps[0]; pTop = ps[Math.floor(ps.length * .9)];

    map = L.map('map', { zoomControl: true }).setView([40.2, -3.6], 6);
  map.on('popupopen', ev => { ev.popup.options.autoPanPaddingTopLeft = L.point(20, altoFlot() + 20); ev.popup.update(); });
  repartir();
  $('stops').addEventListener('scroll', avisoMas, { passive: true });
  new ResizeObserver(avisoMas).observe($('stops'));
  $('mas-paradas').onclick = () => $('stops').scrollBy({ top: $('stops').clientHeight * .8, behavior: 'smooth' });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  capaRuta = L.layerGroup().addTo(map);
  const zoomClase = () => $('map').classList.toggle('zoomed-out', map.getZoom() < 8);
  map.on('zoomend', zoomClase); zoomClase();

  for (const e of D.est) {
    const icon = L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7],
      html: `<span class="pin ${forma(e.t)}" style="--c:${colorPrecio(e.p)}">${forma(e.t) === 'a' ? TRIANGULO : ''}</span><span class="ptag">${fmt(e.p)}</span>` });
    const mk = L.marker([e.lat, e.lon], { icon, title: `${e.n} · ${fmt(e.p)} €/l`, riseOnHover: true });
    if (!excluidas.has(e.id)) mk.addTo(map);
    mk.bindPopup(() => popup(e), { maxWidth: 300 });
    marcadores.set(e.id, mk);
  }
  const ley = L.control({ position: 'bottomleft' });
  ley.onAdd = () => { const div = L.DomUtil.create('div', 'legend');
    div.innerHTML = `<span>${fmt(pMin)}</span><span class="ramp"></span><span>${fmt(ps.at(-1))} €/l</span>${PROVEEDORES.filter(p => D.est.some(e => e.t === p)).map(p => `<span><i class="${forma(p)}"></i>${p}</span>`).join('')}
    <button type="button" class="b-sel" id="b-sel" aria-expanded="false" aria-controls="sel-est">Estaciones <b id="sel-cuenta"></b> <span aria-hidden="true">▴</span></button>`;
    L.DomEvent.disableClickPropagation(div); return div; };
  ley.addTo(map);
  montarSeleccion();

  ponerCamiones(camiones);
  $('camion').onchange = () => { litrosManual = null; pintarCamion(); }; $('nivel').oninput = pintarCamion;
  // Litros a repostar: el gestor los decide en cada ruta
  let tLitros;
  $('litros').oninput = () => {
    clearTimeout(tLitros);
    tLitros = setTimeout(() => {
      const v = Math.round(+$('litros').value);
      if ($('litros').value === '' || !(v > 0)) return;
      litrosManual = v; if (ruta) evaluar();
    }, 300);
  };
  $('litros').onchange = () => { if ($('litros').value === '' || !(+$('litros').value > 0)) litrosManual = null; };
  $('litros').onblur = () => { clearTimeout(tLitros); const v = Math.round(+$('litros').value); if (v > 0) litrosManual = v; if (ruta) evaluar(); };
  $('litros-lleno').onclick = () => { litrosManual = null; $('litros').blur(); if (ruta) evaluar(); };
  // Distancia a la ruta: barra y casilla sincronizadas
  let tRadio;
  const ponerRadio = (v, desde) => {
    v = Math.max(1, Math.min(30, Math.round(+v || 8)));
    if (desde !== 'barra') $('radio').value = v;
    if (desde !== 'casilla') $('radio-n').value = v;
    guardar('radio', v);
    if (ruta) { evaluar(); clearTimeout(tRadio); tRadio = setTimeout(desviosReales, 600); }
  };
  $('radio').oninput = () => ponerRadio($('radio').value, 'barra');
  $('radio-n').oninput = () => { if ($('radio-n').value !== '') ponerRadio($('radio-n').value, 'casilla'); };
  $('radio-n').onchange = () => ponerRadio($('radio-n').value);
  const r0 = leer('radio'); if (r0) ponerRadio(r0);
  buscador('origen'); buscador('destino');
  $('ruta').onsubmit = (e) => e.preventDefault();   // Intro en el formulario no recarga ni recalcula
  $('swap').onclick = () => { [lugares.origen, lugares.destino] = [lugares.destino, lugares.origen];
    $('origen').value = lugares.origen ? lugares.origen.label : ''; $('destino').value = lugares.destino ? lugares.destino.label : '';
    if (lugares.origen && lugares.destino) calcular(); };

  montarGuardadas();

  // Al entrar, la pantalla empieza sin origen ni destino
  try { localStorage.removeItem('lugares'); } catch (e) {}
  $('origen').value = ''; $('destino').value = '';
  setInterval(() => { if (borrarRuta && Date.now() >= borrarRuta.t) { if (claveRuta() === borrarRuta.clave) limpiarRuta(); borrarRuta = null; } }, 15000);
}

// ---------- borrar la ruta de la pantalla 10 minutos después de enviarla ----------
// (el envío queda guardado en la base de datos para el informe de ahorro)
const MIN_BORRAR = 10;
let borrarRuta = null;
const claveRuta = () => ruta && lugares.origen && lugares.destino ? `${lugares.origen.label}|${lugares.destino.label}|${Math.round(ruta.km)}` : null;
function limpiarRuta() {
  ruta = null; elegida = null; preferida = null; abierta = null; lugares = { origen: null, destino: null }; litrosManual = null;
  $('origen').value = ''; $('destino').value = '';
  capaRuta.clearLayers();
  $('resumen').hidden = true;
  pintarEnvio(null);
  $('stops').innerHTML = '<p class="empty">Elige origen y destino para ver qué estaciones de vuestras tarjetas pillan de camino.</p>';
  $('stops-n').textContent = '';
  $('litros').value = ''; $('litros-nota').textContent = ''; $('litros-lleno').hidden = true;
  for (const m of marcadores.values()) { const el = m.getElement && m.getElement(); if (el) el.querySelector('.pin').classList.remove('on', 'dim'); }
  avisoMas();
}
// Lo arranca auth.js cuando el usuario ha entrado
window.Ruta = {
  iniciar: (camiones) => iniciar(camiones).catch(() => { $('fecha').textContent = 'No se han podido cargar los precios. Recarga la página.'; }),
  ponerCamiones,
  refrescarMapa: () => map && map.invalidateSize(),
};
