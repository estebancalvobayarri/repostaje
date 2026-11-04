// Repostaje en ruta — webapp para el gestor de tráfico.
// Datos: precios de la empresa en Supabase (los carga auth.js), camiones de la Flota. Rutas: OSRM. Buscador: Photon (OpenStreetMap).
'use strict';

const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const PHOTON = 'https://photon.komoot.io/api/';
const MAX_DESVIOS_REALES = 8;   // estaciones a las que se calcula el desvío real
const RESERVA = 0.10;           // no planificar por debajo del 10 % del depósito

const $ = id => document.getElementById(id);
const fmt = n => n.toFixed(3).replace('.', ',');
const eur = n => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const ent = n => Math.round(n).toLocaleString('es-ES');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let elegida = null; // parada elegida por el gestor para enviar al conductor
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
  const elegir = (it) => { lugares[campo] = it; input.value = it.label; cerrar(); guardar('lugares', lugares); if (lugares.origen && lugares.destino) calcular(); };
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
  const url = OSRM + puntos.map(p => `${p.lon},${p.lat}`).join(';') + '?overview=full&geometries=geojson';
  const r = await fetch(url);
  if (!r.ok) throw new Error('OSRM ' + r.status);
  const j = await r.json();
  if (j.code !== 'Ok') throw new Error(j.code);
  return j.routes[0];
}
const espera = ms => new Promise(r => setTimeout(r, ms));

async function calcular(e) {
  e && e.preventDefault();
  const { origen, destino } = lugares;
  if (!origen || !destino) { $('stops').innerHTML = '<p class="empty">Elige origen y destino de la lista de sugerencias.</p>'; return; }
  $('calc').disabled = true; $('calc').textContent = 'Calculando…';
  try {
    const r = await osrm([origen, destino]);
    const coords = r.geometry.coordinates.map(([lo, la]) => [la, lo]);
    const acum = [0]; for (let i = 1; i < coords.length; i++) acum.push(acum[i - 1] + km(coords[i - 1], coords[i]));
    ruta = { coords, acum, km: r.distance / 1000, min: r.duration / 60, desvios: new Map() };
    elegida = null;
    dibujarRuta();
    evaluar();
    await desviosReales();
  } catch (err) {
    $('stops').innerHTML = '<p class="empty">No he podido calcular la ruta: el servicio de rutas no responde. Vuelve a intentarlo en un momento.</p>';
  } finally { $('calc').disabled = false; $('calc').textContent = 'Calcular ruta'; }
}

function dibujarRuta() {
  capaRuta.clearLayers();
  const linea = L.polyline(ruta.coords, { color: css('--route'), weight: 5, opacity: .85 }).addTo(capaRuta);
  [['origen', false], ['destino', true]].forEach(([k, lleno]) => L.circleMarker([lugares[k].lat, lugares[k].lon], {
    radius: 7, color: css('--route'), weight: 3, fillColor: lleno ? css('--route') : css('--panel'), fillOpacity: 1 }).bindTooltip(lugares[k].label).addTo(capaRuta));
  map.fitBounds(linea.getBounds(), { padding: [30, 30] });
}

// Desvío real: ruta pasando por la estación menos ruta directa
async function desviosReales() {
  const cand = candidatas().slice(0, MAX_DESVIOS_REALES);
  for (const c of cand) {
    if (ruta.desvios.has(c.e.id)) continue;
    try {
      const r = await osrm([lugares.origen, { lat: c.e.lat, lon: c.e.lon }, lugares.destino]);
      ruta.desvios.set(c.e.id, { km: Math.max(0, r.distance / 1000 - ruta.km), min: Math.max(0, r.duration / 60 - ruta.min) });
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
  $('k-t').textContent = `${Math.floor(ruta.min / 60)} h ${String(Math.round(ruta.min % 60)).padStart(2, '0')}`;
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
  if (!lista.some(x => x.e.id === elegida && x.alcanzable)) elegida = mejor ? mejor.e.id : null;
  $('stops-n').textContent = lista.length ? `${lista.length} a menos de ${$('radio').value} km` : '';
  if (!lista.length) {
    $('stops').innerHTML = `<p class="empty">Ninguna estación de vuestras tarjetas a menos de ${$('radio').value} km de esta ruta. Amplía la distancia o revisa el depósito antes de salir.</p>`;
  } else {
    $('stops').innerHTML = lista.sort((a, b) => a.k - b.k).map(x => {
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
    }).join('');
    [...$('stops').children].forEach(el => {
      const abrir = () => {
        if (el.dataset.ok === '1') { elegida = el.dataset.id; evaluar(); }
        const m = marcadores.get(el.dataset.id); map.setView(m.getLatLng(), Math.max(map.getZoom(), 12)); m.openPopup();
      };
      el.onclick = abrir; el.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } };
    });
  }
  pintarEnvio(lista.find(x => x.e.id === elegida), ok);
  const ids = new Set(lista.map(x => x.e.id));
  for (const [id, m] of marcadores) {
    const el = m.getElement && m.getElement(); if (!el) continue;
    el.querySelector('.pin').classList.toggle('on', ids.has(id));
    el.querySelector('.pin').classList.toggle('dim', ruta && !ids.has(id));
  }
}

// ---------- enviar la ruta al conductor ----------
function mensajeRuta(x, litros) {
  const c = camionActual(), o = lugares.origen, d = lugares.destino;
  const maps = `https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lon}&destination=${d.lat},${d.lon}&waypoints=${x.e.lat},${x.e.lon}&travelmode=driving`;
  const h = Math.floor(ruta.min / 60), m = String(Math.round(ruta.min % 60)).padStart(2, '0');
  return [
    `*Ruta:* ${o.label} → ${d.label}`,
    `${ent(ruta.km)} km · ${h} h ${m} min`,
    c.id ? `*Camión:* ${c.m}` : null,
    '',
    `*Repostar en:* ${x.e.n}`,
    `Tarjeta ${x.e.t} · km ${ent(x.k)} de la ruta`,
    `Precio: ${fmt(x.e.p)} €/l sin IVA · echar ${ent(litros)} l`,
    x.e.dir ? `Dirección: ${x.e.dir}, ${x.e.mun}` : null,
    '',
    `Ruta con la parada en Google Maps:`,
    maps,
  ].filter(v => v !== null).join('\n');
}

// La parada más cara de la ruta sirve de referencia para el ahorro
let envioActual = null;
let litrosManual = null;   // null = llenar el depósito
function pintarEnvio(x, alcanzables = []) {
  const box = $('envio');
  if (!x) { box.hidden = true; envioActual = null; return; }
  const cara = alcanzables.reduce((m, y) => (!m || y.e.p > m.e.p ? y : m), null);
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
  };
  box.hidden = false;
  $('envio-txt').innerHTML = `Parada elegida: <b>${esc(x.e.n)}</b> (${x.e.t}, km ${ent(x.k)}, ${fmt(x.e.p)} €/l). Pulsa otra parada de la lista para cambiarla.`;
  const texto = mensajeRuta(x, litros);
  $('b-wa').href = 'https://wa.me/?text=' + encodeURIComponent(texto);
  const ahorro = Math.max(0, envioActual.precio_cara - envioActual.precio_elegido) * litros;
  $('envio-ahorro').textContent = cara && cara !== x
    ? `Ahorro estimado: ${eur(ahorro)} frente a la parada más cara de la ruta (${cara.e.n}, ${fmt(cara.e.p)} €/l).`
    : 'Es la única parada de la ruta: no hay ahorro que comparar.';
  $('b-wa').onclick = async () => {
    // El enlace se abre igual; el registro se guarda a la vez
    const datos = { ...envioActual };
    const clave = [datos.camion_id, datos.origen, datos.destino, datos.estacion_id].join('|');
    const previo = leer('ultimoEnvio');
    if (previo && previo.clave === clave && Date.now() - previo.t < 10 * 60 * 1000) {
      $('msg-envio').className = 'msg ok';
      $('msg-envio').textContent = 'Esta ruta ya estaba guardada en el informe de ahorro: no se cuenta dos veces.';
      $('msg-envio').hidden = false; setTimeout(() => { $('msg-envio').hidden = true; }, 6000);
      return;
    }
    try {
      await window.Registro.guardar(datos);
      guardar('ultimoEnvio', { clave, t: Date.now() });
      $('msg-envio').className = 'msg ok';
      $('msg-envio').textContent = `Guardado en el informe de ahorro (${eur(ahorro)}).`;
    } catch (e) {
      $('msg-envio').className = 'msg error';
      $('msg-envio').textContent = 'Se ha abierto WhatsApp, pero no se ha podido guardar en el informe: ' + e.message;
    }
    $('msg-envio').hidden = false;
    setTimeout(() => { $('msg-envio').hidden = true; }, 6000);
  };
  $('b-copiar').onclick = async () => {
    try { await navigator.clipboard.writeText(texto); $('msg-envio').className = 'msg ok'; $('msg-envio').textContent = 'Mensaje copiado. Pégalo en el chat del conductor.'; }
    catch (e) { $('msg-envio').className = 'msg error'; $('msg-envio').textContent = 'No se ha podido copiar automáticamente.'; }
    $('msg-envio').hidden = false;
    setTimeout(() => { $('msg-envio').hidden = true; }, 4000);
  };
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

// ---------- arranque ----------
async function iniciar(camiones) {
  D = await window.Precios.cargar();
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
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  capaRuta = L.layerGroup().addTo(map);
  const zoomClase = () => $('map').classList.toggle('zoomed-out', map.getZoom() < 8);
  map.on('zoomend', zoomClase); zoomClase();

  for (const e of D.est) {
    const icon = L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7],
      html: `<span class="pin ${forma(e.t)}" style="--c:${colorPrecio(e.p)}">${forma(e.t) === 'a' ? TRIANGULO : ''}</span><span class="ptag">${fmt(e.p)}</span>` });
    const mk = L.marker([e.lat, e.lon], { icon, title: `${e.n} · ${fmt(e.p)} €/l`, riseOnHover: true }).addTo(map);
    mk.bindPopup(() => popup(e), { maxWidth: 300 });
    marcadores.set(e.id, mk);
  }
  const ley = L.control({ position: 'bottomleft' });
  ley.onAdd = () => { const div = L.DomUtil.create('div', 'legend');
    div.innerHTML = `<span>${fmt(pMin)}</span><span class="ramp"></span><span>${fmt(ps.at(-1))} €/l</span>${PROVEEDORES.filter(p => D.est.some(e => e.t === p)).map(p => `<span><i class="${forma(p)}"></i>${p}</span>`).join('')}`; return div; };
  ley.addTo(map);

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
  $('ruta').onsubmit = calcular;
  $('swap').onclick = () => { [lugares.origen, lugares.destino] = [lugares.destino, lugares.origen];
    $('origen').value = lugares.origen ? lugares.origen.label : ''; $('destino').value = lugares.destino ? lugares.destino.label : '';
    guardar('lugares', lugares); if (lugares.origen && lugares.destino) calcular(); };

  // Abre con una ruta real del piloto para que se vea cómo funciona
  const prev = leer('lugares');
  lugares = prev && prev.origen && prev.destino ? prev : {
    origen: { label: 'Riba-roja de Túria, Valencia', lat: 39.5444, lon: -0.5707 },
    destino: { label: 'Cartagena, Murcia', lat: 37.6253, lon: -0.9972 } };
  $('origen').value = lugares.origen.label; $('destino').value = lugares.destino.label;
  calcular();
}
// Lo arranca auth.js cuando el usuario ha entrado
window.Ruta = {
  iniciar: (camiones) => iniciar(camiones).catch(() => { $('fecha').textContent = 'No se han podido cargar los precios. Recarga la página.'; }),
  ponerCamiones,
  refrescarMapa: () => map && map.invalidateSize(),
};
