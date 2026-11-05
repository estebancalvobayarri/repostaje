// Cuadro de mando de ahorro (pestaña Ahorro). Gráficos con Chart.js.
'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const eur = (n, d = 0) => (+n).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' }) + ' €';
  const ent = n => Math.round(n).toLocaleString('es-ES', { useGrouping: 'always' });
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const graficos = {};

  // Color fijo por tarjeta (sigue a la tarjeta, no a su posición)
  const COLOR_TARJETA = { Valcarce: '--series-1', DST: '--series-2', Staroil: '--series-3', Andamur: '--series-4' };
  const colorTarjeta = t => css(COLOR_TARJETA[t] || '--series-5');

  function agrupar(env, clave) {
    const m = new Map();
    for (const e of env) {
      const k = clave(e) || 'Sin camión';
      const a = m.get(k) || { k, rutas: 0, km: 0, litros: 0, ahorro: 0 };
      a.rutas++; a.km += +e.km_ruta || 0; a.litros += +e.litros || 0; a.ahorro += +e.ahorro_eur || 0;
      m.set(k, a);
    }
    return [...m.values()];
  }

  // Meses del periodo, incluidos los que no tienen rutas
  function meses(env, desde) {
    const fin = new Date(); fin.setDate(1);
    let ini = desde ? new Date(desde) : (env.length ? new Date(Math.min(...env.map(e => +new Date(e.creado)))) : new Date());
    ini = new Date(ini.getFullYear(), ini.getMonth(), 1);
    const out = [];
    for (let d = new Date(ini); d <= fin && out.length < 36; d.setMonth(d.getMonth() + 1)) {
      out.push({ k: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, et: `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, ahorro: 0, rutas: 0 });
    }
    const idx = new Map(out.map(o => [o.k, o]));
    for (const e of env) {
      const d = new Date(e.creado), o = idx.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      if (o) { o.ahorro += +e.ahorro_eur; o.rutas++; }
    }
    return out;
  }

  function base(extra = {}) {
    const texto = css('--muted'), rejilla = css('--line');
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: css('--panel'), titleColor: css('--ink'), bodyColor: css('--ink'), borderColor: rejilla, borderWidth: 1, padding: 10, displayColors: false },
      },
      scales: {
        x: { grid: { display: false }, border: { color: rejilla }, ticks: { color: texto, font: { family: 'Manrope' } } },
        y: { beginAtZero: true, grid: { color: rejilla }, border: { display: false }, ticks: { color: texto, font: { family: 'Manrope' }, maxTicksLimit: 5 } },
      },
      ...extra,
    };
  }

  function dibujar(id, config) {
    if (graficos[id]) graficos[id].destroy();
    graficos[id] = new Chart($(id), config);
  }

  const barra = (color) => ({ backgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28, categoryPercentage: .7, barPercentage: .9 });

  function pintar(env, { desde, etiqueta, empresa }) {
    $('d-titulo').textContent = `Ahorro · ${empresa || ''}`;
    $('d-periodo').textContent = etiqueta;
    const vacio = !env.length;
    $('d-vacio').hidden = !vacio;
    $('d-contenido').hidden = vacio;
    if (vacio) return;

    const tot = agrupar(env, () => 'total')[0];
    $('k-ahorro').textContent = eur(tot.ahorro);
    $('k-rutas').textContent = ent(tot.rutas);
    $('k-kms').textContent = ent(tot.km);
    $('k-litros').textContent = ent(tot.litros);
    $('k-medio').textContent = eur(tot.ahorro / tot.rutas, 2);
    $('k-cts').textContent = (tot.litros ? tot.ahorro / tot.litros * 100 : 0).toFixed(1).replace('.', ',');

    const ms = meses(env, desde), ambar = css('--accent'), azulClaro = css('--bar-2');
    dibujar('g-ahorro-mes', { type: 'bar', data: { labels: ms.map(m => m.et), datasets: [{ label: 'Ahorro', data: ms.map(m => Math.round(m.ahorro * 100) / 100), ...barra(ambar) }] },
      options: base({ plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => 'Ahorro: ' + eur(c.raw, 2) } } } }) });
    dibujar('g-rutas-mes', { type: 'bar', data: { labels: ms.map(m => m.et), datasets: [{ label: 'Rutas', data: ms.map(m => m.rutas), ...barra(azulClaro) }] },
      options: base({ plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${c.raw} ruta${c.raw === 1 ? '' : 's'}` } } } }) });

    const cam = agrupar(env, e => e.matricula).sort((a, b) => b.ahorro - a.ahorro);
    $('g-camion-caja').style.height = Math.max(140, cam.length * 34 + 40) + 'px';
    dibujar('g-camion', { type: 'bar', data: { labels: cam.map(c => c.k), datasets: [{ label: 'Ahorro', data: cam.map(c => Math.round(c.ahorro * 100) / 100), ...barra(ambar) }] },
      options: base({ indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false },
        plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => { const x = cam[c.dataIndex]; return [`Ahorro: ${eur(x.ahorro, 2)}`, `${x.rutas} rutas · ${ent(x.km)} km`]; } } } },
        scales: { x: { ...base().scales.y, grid: { color: css('--line') } }, y: { ...base().scales.x } } }) });

    const tar = agrupar(env, e => e.tarjeta || 'Otra').sort((a, b) => b.litros - a.litros);
    $('g-tarjeta-caja').style.height = Math.max(120, tar.length * 40 + 40) + 'px';
    dibujar('g-tarjeta', { type: 'bar', data: { labels: tar.map(t => t.k), datasets: [{ label: 'Litros', data: tar.map(t => Math.round(t.litros)), ...barra(tar.map(t => colorTarjeta(t.k))) }] },
      options: base({ indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false },
        plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => { const x = tar[c.dataIndex]; return [`${ent(x.litros)} l`, `${x.rutas} rutas · ahorro ${eur(x.ahorro, 2)}`]; } } } },
        scales: { x: { ...base().scales.y, grid: { color: css('--line') } }, y: { ...base().scales.x } } }) });
    $('d-ley-tarjeta').innerHTML = tar.map(t => `<span><i style="background:${colorTarjeta(t.k)}"></i>${esc(t.k)}: ${ent(t.litros)} l (${Math.round(t.litros / tot.litros * 100)} %)</span>`).join('');

    const fila = (x, b = false) => `<tr${b ? ' class="tot"' : ''}><td>${esc(x.k)}</td><td>${ent(x.rutas)}</td><td>${ent(x.km)}</td><td>${ent(x.litros)}</td><td>${eur(x.ahorro, 2)}</td><td>${eur(x.ahorro / x.rutas, 2)}</td></tr>`;
    $('t-camiones').innerHTML = cam.map(c => fila(c)).join('') + fila({ ...tot, k: 'Total' }, true);

    const est = agrupar(env, e => e.estacion_nombre).sort((a, b) => b.rutas - a.rutas || b.ahorro - a.ahorro).slice(0, 8);
    $('t-estaciones').innerHTML = est.map(x => `<tr><td>${esc(x.k)}</td><td>${ent(x.rutas)}</td><td>${ent(x.litros)}</td><td>${eur(x.ahorro, 2)}</td></tr>`).join('');
  }

  window.Dash = { pintar, redimensionar: () => Object.values(graficos).forEach(g => g.resize()) };
})();
