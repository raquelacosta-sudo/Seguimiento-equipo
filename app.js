/* =====================================================================
   Seguimiento Equipo · Rappi MX
   Lee data/seguimiento.json (snapshot generado por build_data.py desde
   Snowflake) y arma el tablero de seguimiento del equipo.
   ===================================================================== */
'use strict';

let D = null;                 // payload completo
let M = [];                   // meses (ISO)
let I = {};                   // indices clave
const CH = {};                // instancias de Chart.js

const S = {                   // estado de filtros
  kam: 'all', cat: 'all', ciudad: 'all', canal: 'all',
  view: 'resumen', estado: 'all', q: '',
  marca: null,
  sort: { cuentas: { k: 'dAbs', dir: 1 }, kam: { k: 'gmv', dir: -1 } },
};

/* ------------------------------------------------- utilidades de formato */
const MESES_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const nf = (n, d = 0) => n == null || !isFinite(n) ? '—'
  : n.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });

const F = {
  usd: n => n == null || !isFinite(n) ? '—' : '$' + nf(Math.round(n)),
  usdK: n => n == null || !isFinite(n) ? '—'
    : Math.abs(n) >= 1e6 ? '$' + nf(n / 1e6, 2) + 'M'
      : Math.abs(n) >= 1e3 ? '$' + nf(n / 1e3, Math.abs(n) >= 1e4 ? 0 : 1) + 'K'
        : '$' + nf(n),
  num: n => n == null || !isFinite(n) ? '—' : nf(Math.round(n)),
  numK: n => n == null || !isFinite(n) ? '—'
    : Math.abs(n) >= 1e6 ? nf(n / 1e6, 2) + 'M'
      : Math.abs(n) >= 1e3 ? nf(n / 1e3, 0) + 'K' : nf(n),
  dec: (n, d = 2) => n == null || !isFinite(n) ? '—' : nf(n, d),
  /** Moneda con decimales; devuelve «—» en vez de «$—» cuando no hay dato. */
  usdDec: n => n == null || !isFinite(n) ? '—' : '$' + nf(n, 2),
  /** ROAS; sin dato no imprime el «×» suelto. */
  roas: n => n == null || !isFinite(n) ? '—' : nf(n, 1) + '×',
  pct: n => n == null || !isFinite(n) ? '—' : (n >= 0 ? '+' : '') + nf(n, 1) + '%',
  pctAbs: (n, d = 1) => n == null || !isFinite(n) ? '—' : nf(n, d) + '%',
  mes: iso => {
    if (!iso) return '';
    const [y, m] = iso.split('-');
    return MESES_ABBR[+m - 1] + '-' + y.slice(2);
  },
  fecha: iso => {
    if (!iso) return '';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${+d} ${MESES_ABBR[+m - 1]} ${y.slice(2)}`;
  },
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pct = (a, b) => (a == null || b == null || !b) ? null : (a / b - 1) * 100;
const div = (a, b) => (a == null || b == null || !b) ? null : a / b;
/** a÷b en porcentaje, preservando null (div(...)*100 convertiría null en 0). */
const pctOf = (a, b) => { const v = div(a, b); return v == null ? null : v * 100; };
const cls = p => p == null ? 'flat' : p >= 1.5 ? 'up' : p <= -1.5 ? 'down' : 'flat';
const arrow = p => p == null ? '' : p >= 1.5 ? '▲' : p <= -1.5 ? '▼' : '▬';
const deltaHTML = (p, suf = '') => `<span class="${cls(p)}">${arrow(p)} ${F.pct(p)}${suf}</span>`;

const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const SERIES = () => [cssv('--s1'), cssv('--s2'), cssv('--s3'), cssv('--s4'), cssv('--s5'), cssv('--s6')];
const RAMP_BLUE = () => document.documentElement.dataset.theme === 'dark' || prefersDark()
  ? ['#184f95', '#256abf', '#3987e5', '#86b6ef']
  : ['#86b6ef', '#5598e7', '#2a78d6', '#184f95'];
const prefersDark = () => document.documentElement.dataset.theme !== 'light'
  && matchMedia('(prefers-color-scheme: dark)').matches;

/* ------------------------------------------------------------ agregación */
const METRICS = ['ord', 'usr', 'gmv', 'ss', 'atc', 'vc', 'op', 'opc',
  'new', 'ret', 'rct', 'mkd', 'bka', 'rva', 'oa', 'ts'];

function filtered() {
  return D.brands.filter(b =>
    (S.kam === 'all' || b.kam === S.kam) &&
    (S.cat === 'all' || b.categoria === S.cat) &&
    (S.canal === 'all' || b.canal === S.canal) &&
    (S.ciudad === 'all' || b.ciudades.includes(S.ciudad)));
}

/** Suma las series mensuales de un conjunto de marcas. */
function agg(brands) {
  const o = {};
  for (const m of METRICS) o[m] = new Array(M.length).fill(0);
  for (const b of brands)
    for (const m of METRICS)
      for (let i = 0; i < M.length; i++) o[m][i] += b[m][i] || 0;
  return o;
}

function aggMTD(brands) {
  const o = { mtd: {}, mtd_pm: {}, mtd_ly: {} };
  for (const k of Object.keys(o))
    for (const f of ['gmv', 'ord', 'usr', 'ss', 'op', 'mkd']) o[k][f] = 0;
  for (const b of brands)
    for (const k of Object.keys(o))
      if (b.mtd[k]) for (const f of ['gmv', 'ord', 'usr', 'ss', 'op', 'mkd']) o[k][f] += b.mtd[k][f] || 0;
  return o;
}

/** Suma un rango [a,b] inclusive de una serie. */
const sum = (arr, a, b) => {
  let t = 0;
  for (let i = Math.max(0, a); i <= Math.min(arr.length - 1, b); i++) t += arr[i] || 0;
  return t;
};

/* ------------------------------------------------- clasificación cuentas */
function estadoDe(b) {
  const g0 = b.gmv[I.cur] || 0, g1 = b.gmv[I.prev] || 0;
  let first = -1;
  for (let i = 0; i < M.length; i++) if ((b.gmv[i] || 0) > 0) { first = i; break; }
  const mom = pct(g0, g1);
  const t3 = sum(b.gmv, I.cur - 2, I.cur), t3p = sum(b.gmv, I.cur - 5, I.cur - 3);
  const tend = pct(t3, t3p);

  let key, label, tone;
  if (g0 <= 0 && g1 > 0) { key = 'riesgo'; label = 'Dejó de facturar'; tone = 'critical'; }
  else if (first >= 0 && first > I.cur - 3) { key = 'nueva'; label = 'Nueva'; tone = 'neutral'; }
  else if (mom != null && mom <= -15) { key = 'cae'; label = tend != null && tend <= -10 ? 'Caída sostenida' : 'Cae'; tone = 'critical'; }
  else if (mom != null && mom <= -5) { key = 'cae'; label = 'Desacelera'; tone = 'serious'; }
  else if (mom != null && mom >= 10) { key = 'crece'; label = 'Crece'; tone = 'good'; }
  else { key = 'estable'; label = 'Estable'; tone = 'neutral'; }
  return { key, label, tone, mom, tend, g0, g1, dAbs: g0 - g1 };
}

/* ============================================================= ARRANQUE */
async function init() {
  try {
    const r = await fetch('data/seguimiento.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    D = await r.json();
  } catch (e) {
    document.querySelector('.wrap').innerHTML =
      `<div class="banner critical"><span class="ic">⛔</span><div><b>No se pudo cargar la información.</b><br>
       ${esc(e.message)} — revisa que exista <code>data/seguimiento.json</code> junto a esta página.</div></div>`;
    return;
  }

  M = D.meta.meses;
  I.cur = M.indexOf(D.meta.ultimo_cerrado);
  if (I.cur < 0) I.cur = M.length - 1;
  I.prev = I.cur - 1;
  I.yoy = I.cur - 12;
  I.partial = D.meta.mes_parcial ? M.length - 1 : -1;
  I.yearStart = M.findIndex(m => m.slice(0, 4) === M[I.cur].slice(0, 4));

  // tema guardado
  const t = localStorage.getItem('seg_theme');
  if (t) document.documentElement.dataset.theme = t;

  buildChrome();
  buildFilters();
  bind();
  renderAll();
}

function buildChrome() {
  const m = D.meta;
  document.getElementById('sub').textContent =
    `${m.lider} · ${D.brands.length} series de marca · datos hasta ${F.fecha(m.data_hasta)}`;

  const pf = document.getElementById('pill-fuente');
  pf.textContent = m.fuente === 'snowflake' ? '● Snowflake' : '● Google Sheet';
  pf.className = 'pill ' + (m.fuente === 'snowflake' ? 'ok' : 'warn');
  pf.title = m.fuente === 'snowflake'
    ? 'Los números vienen directo de Snowflake.'
    : 'Respaldo desde el Google Sheet: revisa la pestaña Datos y QA.';

  const dias = Math.floor((Date.now() - new Date(m.generated_at).getTime()) / 864e5);
  const pfr = document.getElementById('pill-fresh');
  pfr.textContent = dias <= 0 ? 'Actualizado hoy' : `Hace ${dias} día${dias === 1 ? '' : 's'}`;
  pfr.className = 'pill ' + (dias <= 3 ? 'ok' : dias <= 10 ? 'warn' : 'bad');
  pfr.title = 'Snapshot generado el ' + F.fecha(m.generated_at);

  document.getElementById('foot').innerHTML =
    `Seguimiento Equipo · ${esc(m.lider)} · Rappi MX &nbsp;·&nbsp; snapshot ${esc(m.generated_at.replace('T', ' '))} `
    + `&nbsp;·&nbsp; fuente: ${esc(m.fuente)} &nbsp;·&nbsp; ventana ${F.mes(M[0])} → ${F.mes(M[M.length - 1])}`;
}

function buildFilters() {
  const fill = (id, vals) => {
    const s = document.getElementById(id);
    for (const v of vals) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v; s.appendChild(o);
    }
  };
  fill('f-kam', D.meta.kams);
  fill('f-cat', D.meta.categorias);
  fill('f-ciudad', D.meta.ciudades);
}

function bind() {
  document.querySelectorAll('#tabs .tab').forEach(t =>
    t.addEventListener('click', () => {
      S.view = t.dataset.view;
      document.querySelectorAll('#tabs .tab').forEach(x => x.classList.toggle('active', x === t));
      document.querySelectorAll('.view').forEach(v =>
        v.classList.toggle('active', v.id === 'v-' + S.view));
      renderAll();
    }));

  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on('f-kam', 'change', e => { S.kam = e.target.value; renderAll(); });
  on('f-cat', 'change', e => { S.cat = e.target.value; renderAll(); });
  on('f-ciudad', 'change', e => { S.ciudad = e.target.value; renderAll(); });

  document.querySelectorAll('#f-canal button').forEach(b =>
    b.addEventListener('click', () => {
      S.canal = b.dataset.canal;
      document.querySelectorAll('#f-canal button').forEach(x => x.classList.toggle('active', x === b));
      renderAll();
    }));
  document.querySelectorAll('#f-estado button').forEach(b =>
    b.addEventListener('click', () => {
      S.estado = b.dataset.estado;
      document.querySelectorAll('#f-estado button').forEach(x => x.classList.toggle('active', x === b));
      renderCuentas();
    }));

  on('q-marca', 'input', e => { S.q = e.target.value.toLowerCase(); renderCuentas(); });
  on('sel-marca', 'change', e => { S.marca = e.target.value; renderMarca(); });
  on('btn-csv', 'click', exportCSV);
  on('btn-print', 'click', () => window.print());
  on('btn-reset', 'click', () => {
    Object.assign(S, { kam: 'all', cat: 'all', ciudad: 'all', canal: 'all', estado: 'all', q: '' });
    ['f-kam', 'f-cat', 'f-ciudad'].forEach(i => document.getElementById(i).value = 'all');
    document.getElementById('q-marca').value = '';
    document.querySelectorAll('#f-canal button').forEach(x => x.classList.toggle('active', x.dataset.canal === 'all'));
    document.querySelectorAll('#f-estado button').forEach(x => x.classList.toggle('active', x.dataset.estado === 'all'));
    renderAll();
  });
  on('btn-theme', 'click', () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('seg_theme', next);
    renderAll();
  });
}

function renderAll() {
  const n = filtered().length;
  const parts = [];
  if (S.kam !== 'all') parts.push(S.kam);
  if (S.cat !== 'all') parts.push(S.cat);
  if (S.ciudad !== 'all') parts.push(S.ciudad);
  if (S.canal !== 'all') parts.push(S.canal);
  document.getElementById('f-hint').textContent =
    `${n} series${parts.length ? ' · ' + parts.join(' · ') : ' · cartera completa'}`;

  if (S.view === 'resumen') renderResumen();
  if (S.view === 'equipo') renderEquipo();
  if (S.view === 'cuentas') renderCuentas();
  if (S.view === 'marca') renderMarca();
  if (S.view === 'compromisos') renderCompromisos();
  if (S.view === 'datos') renderDatos();
}

/* ================================================== CHART.JS: base común */
function baseOpts(extra = {}) {
  const ink = cssv('--ink-2'), muted = cssv('--ink-muted'), grid = cssv('--grid');
  return Object.assign({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cssv('--panel'), titleColor: cssv('--ink'), bodyColor: ink,
        borderColor: cssv('--border-strong'), borderWidth: 1, padding: 10,
        titleFont: { weight: '700' }, cornerRadius: 8, displayColors: true, boxPadding: 4,
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: cssv('--axis') }, ticks: { color: muted, font: { size: 10.5 } } },
      y: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: muted, font: { size: 10.5 } } },
    },
  }, extra);
}

function draw(id, cfg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (CH[id]) CH[id].destroy();
  CH[id] = new Chart(el, cfg);
}

function legendHTML(items) {
  return items.map(i =>
    `<span><i style="background:${i.c}${i.dash ? ';outline:1px dashed ' + i.c + ';outline-offset:1px' : ''}"></i>${esc(i.t)}</span>`).join('');
}

/* ===================================================== VISTA · RESUMEN */
function renderResumen() {
  const B = filtered(), a = agg(B), mtd = aggMTD(B);
  const i = I.cur, p = I.prev, y = I.yoy;

  /* -------- alertas -------- */
  const al = [];
  const gMoM = pct(a.gmv[i], a.gmv[p]);
  const gYoY = y >= 0 ? pct(a.gmv[i], a.gmv[y]) : null;

  // Si la cartera cambió de dueño entre snapshots, el histórico se reescribe
  // entero. Hay que decirlo antes de que alguien lea la caída como desempeño.
  const cc = D.meta.cartera_cambios;
  if (cc && (cc.salieron.length || cc.entraron.length)) {
    const lista = a => a.slice(0, 5).map(x =>
      `${esc(x.marca)} (${F.usdK(x.gmv)}${x.kam ? ', ' + esc(x.kam) : ''})`).join(', ')
      + (a.length > 5 ? ` y ${a.length - 5} más` : '');
    const partes = [];
    if (cc.salieron.length) partes.push(`<b>${cc.salieron.length} cuentas salieron</b> de la cartera,
      que en ${F.mes(cc.mes_referencia)} valían ${F.usdK(cc.gmv_que_salio)}: ${lista(cc.salieron)}`);
    if (cc.entraron.length) partes.push(`<b>${cc.entraron.length} entraron</b>
      (${F.usdK(cc.gmv_que_entro)}): ${lista(cc.entraron)}`);
    al.push(['warning', '🔀', `<b>La cartera cambió desde la última actualización.</b> ${partes.join('. ')}.
      Ojo: el histórico se arma con los dueños de hoy, así que <b>los meses pasados también cambiaron de valor</b>.
      Si un mes ya cerrado se ve más bajo que la semana pasada, es por esto y no por desempeño.`]);
  }

  if (D.meta.mes_parcial) {
    al.push(['info', 'ℹ️', `<b>${F.mes(M[M.length - 1])} va en curso.</b> Hay ${D.meta.dias_transcurridos} de
      ${D.meta.dias_del_mes} días. Todas las comparaciones de esta pestaña usan
      <b>${F.mes(M[i])}</b>, el último mes cerrado; el mes en curso se compara aparte contra la misma ventana de días.`]);
  }
  if (gMoM != null && gMoM <= -5) {
    al.push(['critical', '🔻', `<b>La cartera cae ${F.pctAbs(Math.abs(gMoM))} contra ${F.mes(M[p])}</b>
      (${F.usdK(a.gmv[i] - a.gmv[p])}). Revisa «Quién mueve la aguja» para ver de dónde sale el hueco.`]);
  } else if (gMoM != null && gMoM >= 5) {
    al.push(['good', '🔺', `<b>La cartera crece ${F.pctAbs(gMoM)} contra ${F.mes(M[p])}</b> (${F.usdK(a.gmv[i] - a.gmv[p])}).`]);
  }

  const est = B.map(b => ({ b, e: estadoDe(b) }));
  const cayendo = est.filter(x => x.e.key === 'cae' && x.e.dAbs < 0).sort((x, z) => x.e.dAbs - z.e.dAbs);
  const churn = est.filter(x => x.e.key === 'riesgo');
  if (cayendo.length) {
    const top = cayendo.slice(0, 3).map(x => `${esc(x.b.marca)} (${F.usdK(x.e.dAbs)})`).join(', ');
    al.push(['serious', '⚠️', `<b>${cayendo.length} cuentas caen contra el mes anterior.</b> Las que más pesan: ${top}.`]);
  }
  if (churn.length) {
    al.push(['critical', '🛑', `<b>${churn.length === 1 ? '1 cuenta dejó' : churn.length + ' cuentas dejaron'} de facturar</b> en ${F.mes(M[i])}:
      ${churn.slice(0, 6).map(x => esc(x.b.marca)).join(', ')}${churn.length > 6 ? '…' : ''}.`]);
  }
  const mkdPct = div(a.mkd[i], a.gmv[i]);
  if (mkdPct != null && mkdPct > 0.12) {
    al.push(['warning', '💸', `<b>El markdown se llevó ${F.pctAbs(mkdPct * 100)} del GMV</b> en ${F.mes(M[i])}. Vale la pena revisar rentabilidad.`]);
  }

  document.getElementById('r-banners').innerHTML = al.map(([tone, ic, html]) =>
    `<div class="banner ${tone}"><span class="ic">${ic}</span><div>${html}</div></div>`).join('');

  /* -------- KPIs -------- */
  const kpi = (lbl, val, extra) => `<div class="kpi"><div class="lbl">${lbl}</div>
    <div class="val">${val}</div><div class="row">${extra}</div></div>`;
  const ytd = sum(a.gmv, I.yearStart, i);
  const ytdPrev = sum(a.gmv, I.yearStart - 12, i - 12);

  document.getElementById('r-kpis').innerHTML = [
    kpi(`GMV · ${F.mes(M[i])}`, F.usdK(a.gmv[i]),
      `<span>MoM ${deltaHTML(gMoM)}</span><span>YoY ${deltaHTML(gYoY)}</span>`),
    kpi('Órdenes', F.numK(a.ord[i]),
      `<span>MoM ${deltaHTML(pct(a.ord[i], a.ord[p]))}</span><span>YoY ${deltaHTML(y >= 0 ? pct(a.ord[i], a.ord[y]) : null)}</span>`),
    kpi('Usuarios', F.numK(a.usr[i]),
      `<span>MoM ${deltaHTML(pct(a.usr[i], a.usr[p]))}</span>`),
    kpi('Ticket promedio', F.usdDec(div(a.gmv[i], a.ord[i])),
      `<span>MoM ${deltaHTML(pct(div(a.gmv[i], a.ord[i]), div(a.gmv[p], a.ord[p])))}</span>`),
    kpi('Conversión (orden ÷ visita)', F.pctAbs(pctOf(a.opc[i], a.ss[i]), 2),
      `<span>MoM ${deltaHTML(pct(div(a.opc[i], a.ss[i]), div(a.opc[p], a.ss[p])))}</span>`),
    kpi('Tiendas activas', F.num(a.ts[i]),
      `<span>MoM ${deltaHTML(pct(a.ts[i], a.ts[p]))}</span>`),
    kpi('Markdown % del GMV', F.pctAbs(mkdPct * 100, 1),
      `<span>${F.usdK(a.mkd[i])}</span><span>MoM ${deltaHTML(pct(div(a.mkd[i], a.gmv[i]), div(a.mkd[p], a.gmv[p])))}</span>`),
    kpi('ROAS de ads', F.roas(div(a.bka[i], a.rva[i])),
      `<span>inv. ${F.usdK(a.rva[i])}</span>`),
    kpi(`YTD ${M[i].slice(0, 4)}`, F.usdK(ytd),
      `<span>vs ${+M[i].slice(0, 4) - 1} ${deltaHTML(pct(ytd, ytdPrev))}</span>`),
  ].join('');

  /* -------- mes en curso (MTD comparable) -------- */
  const mp = M[M.length - 1];
  const dMoM = pct(mtd.mtd.gmv, mtd.mtd_pm.gmv), dYoY = pct(mtd.mtd.gmv, mtd.mtd_ly.gmv);
  document.getElementById('r-mtd-desc').textContent = D.meta.mes_parcial
    ? `Del 1 al ${D.meta.dias_transcurridos} de ${F.mes(mp)}, contra los mismos días del mes anterior y del año pasado. Así el mes incompleto no se lee como caída.`
    : 'El último mes está cerrado: no hay ventana parcial que comparar.';

  if (D.meta.mes_parcial && mtd.mtd.gmv) {
    const proy = mtd.mtd.gmv / D.meta.dias_transcurridos * D.meta.dias_del_mes;
    document.getElementById('r-mtd').innerHTML = `<div class="kpis">
      ${kpi(`GMV al día ${D.meta.dias_transcurridos}`, F.usdK(mtd.mtd.gmv),
      `<span>vs mismo tramo mes ant. ${deltaHTML(dMoM)}</span>`)}
      ${kpi('Mismos días del año pasado', F.usdK(mtd.mtd_ly.gmv), `<span>YoY ${deltaHTML(dYoY)}</span>`)}
      ${kpi('Órdenes al corte', F.numK(mtd.mtd.ord), `<span>vs mes ant. ${deltaHTML(pct(mtd.mtd.ord, mtd.mtd_pm.ord))}</span>`)}
      ${kpi('Cierre proyectado', F.usdK(proy),
        `<span>a ritmo actual · vs ${F.mes(M[i])} ${deltaHTML(pct(proy, a.gmv[i]))}</span>`)}
    </div>`;
  } else {
    document.getElementById('r-mtd').innerHTML = '<div class="empty">Sin mes en curso que comparar.</div>';
  }

  /* -------- GMV mensual -------- */
  const closed = M.map((_, k) => k === I.partial ? null : a.gmv[k]);
  const partial = M.map((_, k) => k === I.partial ? a.gmv[k] : null);
  const ma = M.map((_, k) => k < 2 || k === I.partial ? null : (a.gmv[k] + a.gmv[k - 1] + a.gmv[k - 2]) / 3);
  const c1 = SERIES()[0], c2 = SERIES()[1];

  draw('c-gmv', {
    data: {
      labels: M.map(F.mes),
      datasets: [
        { type: 'bar', label: 'GMV (mes cerrado)', data: closed, backgroundColor: c1, borderRadius: 4, borderSkipped: 'bottom', order: 2 },
        {
          type: 'bar', label: 'GMV (mes en curso)', data: partial, backgroundColor: 'transparent',
          borderColor: c1, borderWidth: 2, borderDash: [4, 3], borderRadius: 4, borderSkipped: 'bottom', order: 2,
        },
        {
          type: 'line', label: 'Promedio móvil 3 meses', data: ma, borderColor: c2, borderWidth: 2,
          pointRadius: 0, pointHoverRadius: 5, tension: .3, order: 1, backgroundColor: c2,
        },
      ],
    },
    options: baseOpts({
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(baseOpts().plugins.tooltip, {
          callbacks: { label: c => `${c.dataset.label}: ${F.usd(c.parsed.y)}` },
        }),
      },
      scales: {
        x: baseOpts().scales.x,
        y: Object.assign({}, baseOpts().scales.y, {
          beginAtZero: true, ticks: { color: cssv('--ink-muted'), font: { size: 10.5 }, callback: v => F.usdK(v) },
        }),
      },
    }),
  });
  document.getElementById('l-gmv').innerHTML = legendHTML([
    { c: c1, t: 'GMV del mes (cerrado)' },
    { c: c1, t: `${F.mes(mp)} · en curso, ${D.meta.dias_transcurridos}/${D.meta.dias_del_mes} días`, dash: 1 },
    { c: c2, t: 'Promedio móvil 3 meses' },
  ]);

  /* -------- waterfall: contribución al delta -------- */
  const porKam = S.kam === 'all';
  const grupos = {};
  for (const b of B) {
    const k = porKam ? b.kam : b.marca;
    grupos[k] = (grupos[k] || 0) + ((b.gmv[i] || 0) - (b.gmv[p] || 0));
  }
  const wf = Object.entries(grupos).sort((x, z) => z[1] - x[1]).slice(0, 14);
  document.getElementById('r-wf-desc').textContent =
    `Cambio de GMV en dólares entre ${F.mes(M[p])} y ${F.mes(M[i])}, por ${porKam ? 'KAM' : 'marca'}. `
    + 'El total de la cartera es la suma de estas barras.';

  draw('c-waterfall', {
    type: 'bar',
    data: {
      labels: wf.map(x => x[0]),
      datasets: [{
        label: 'Δ GMV',
        data: wf.map(x => x[1]),
        backgroundColor: wf.map(x => x[1] >= 0 ? cssv('--good') : cssv('--critical')),
        borderRadius: 4, borderSkipped: false,
      }],
    },
    options: baseOpts({
      indexAxis: 'y',
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(baseOpts().plugins.tooltip, {
          callbacks: { label: c => `${c.parsed.x >= 0 ? 'Suma' : 'Resta'} ${F.usd(Math.abs(c.parsed.x))}` },
        }),
      },
      scales: {
        y: { grid: { display: false }, border: { display: false }, ticks: { color: cssv('--ink-2'), font: { size: 11 } } },
        x: {
          grid: { color: cssv('--grid') }, border: { display: false },
          ticks: { color: cssv('--ink-muted'), font: { size: 10.5 }, callback: v => F.usdK(v) },
        },
      },
    }),
  });

  /* -------- órdenes vs ticket (indexado) -------- */
  const base = k => { for (let j = 0; j < M.length; j++) if (k[j]) return k[j]; return 1; };
  const aovS = M.map((_, k) => div(a.gmv[k], a.ord[k]));
  const idx = (arr) => { const b0 = base(arr); return arr.map(v => v == null ? null : v / b0 * 100); };
  const c3 = SERIES()[2];

  draw('c-ordaov', {
    type: 'line',
    data: {
      labels: M.map(F.mes),
      datasets: [
        { label: 'Órdenes (índice 100)', data: idx(a.ord), borderColor: c1, backgroundColor: c1, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 },
        { label: 'Ticket promedio (índice 100)', data: idx(aovS), borderColor: c3, backgroundColor: c3, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 },
      ],
    },
    options: baseOpts({
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(baseOpts().plugins.tooltip, {
          callbacks: {
            label: c => {
              const real = c.datasetIndex === 0 ? F.num(a.ord[c.dataIndex]) : F.usdDec(aovS[c.dataIndex]);
              return `${c.dataset.label.replace(' (índice 100)', '')}: ${real}  ·  índice ${F.dec(c.parsed.y, 0)}`;
            },
          },
        }),
      },
    }),
  });
  document.getElementById('l-ordaov').innerHTML = legendHTML([
    { c: c1, t: 'Órdenes' }, { c: c3, t: 'Ticket promedio' },
  ]) + '<span style="color:var(--ink-muted)">ambos = 100 en ' + F.mes(M[0]) + '</span>';

  /* -------- embudo -------- */
  const ramp = RAMP_BLUE();
  const pasos = [
    ['Visitas a tienda', a.ss[i]], ['Agregó al carrito', a.atc[i]],
    ['Orden puesta', a.op[i]], ['Orden confirmada', a.opc[i]],
  ];
  draw('c-funnel', {
    type: 'bar',
    data: {
      labels: pasos.map(x => x[0]),
      datasets: [{ label: 'Usuarios', data: pasos.map(x => x[1]), backgroundColor: ramp, borderRadius: 4, borderSkipped: false }],
    },
    options: baseOpts({
      indexAxis: 'y',
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(baseOpts().plugins.tooltip, {
          callbacks: {
            label: c => {
              const v = c.parsed.x, prev = c.dataIndex ? pasos[c.dataIndex - 1][1] : null;
              return F.num(v) + (prev ? `  ·  ${F.pctAbs(v / prev * 100)} del paso anterior` : '')
                + `  ·  ${F.pctAbs(v / pasos[0][1] * 100, 2)} de las visitas`;
            },
          },
        }),
      },
      scales: {
        y: { grid: { display: false }, border: { display: false }, ticks: { color: cssv('--ink-2'), font: { size: 11 } } },
        x: { grid: { color: cssv('--grid') }, border: { display: false }, ticks: { color: cssv('--ink-muted'), font: { size: 10.5 }, callback: v => F.numK(v) } },
      },
    }),
  });

  /* -------- inversión (% del GMV) -------- */
  const mkdS = M.map((_, k) => pctOf(a.mkd[k], a.gmv[k]));
  const rvaS = M.map((_, k) => pctOf(a.rva[k], a.gmv[k]));
  draw('c-inv', {
    type: 'line',
    data: {
      labels: M.map(F.mes),
      datasets: [
        { label: 'Markdown', data: mkdS, borderColor: c2, backgroundColor: c2, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 },
        { label: 'Ads cobrados', data: rvaS, borderColor: SERIES()[4], backgroundColor: SERIES()[4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 },
      ],
    },
    options: baseOpts({
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(baseOpts().plugins.tooltip, {
          callbacks: { label: c => `${c.dataset.label}: ${F.pctAbs(c.parsed.y, 2)} del GMV` },
        }),
      },
      scales: {
        x: baseOpts().scales.x,
        y: Object.assign({}, baseOpts().scales.y, {
          beginAtZero: true, ticks: { color: cssv('--ink-muted'), font: { size: 10.5 }, callback: v => nf(v, 0) + '%' },
        }),
      },
    }),
  });
  document.getElementById('l-inv').innerHTML = legendHTML([
    { c: c2, t: 'Markdown / GMV' }, { c: SERIES()[4], t: 'Ads cobrados / GMV' },
  ]);

  /* -------- semáforo por KAM -------- */
  document.getElementById('r-sem-desc').textContent =
    `${F.mes(M[i])} contra ${F.mes(M[p])} y contra ${y >= 0 ? F.mes(M[y]) : 'el año pasado'}.`;
  const kams = [...new Set(B.map(b => b.kam))].sort();
  const rows = kams.map(k => {
    const ak = agg(B.filter(b => b.kam === k));
    const e = B.filter(b => b.kam === k).map(estadoDe);
    return {
      k, gmv: ak.gmv[i], mom: pct(ak.gmv[i], ak.gmv[p]),
      yoy: y >= 0 ? pct(ak.gmv[i], ak.gmv[y]) : null,
      dAbs: ak.gmv[i] - ak.gmv[p],
      crece: e.filter(x => x.key === 'crece').length,
      cae: e.filter(x => x.key === 'cae' || x.key === 'riesgo').length,
      n: e.length,
    };
  }).sort((x, z) => z.gmv - x.gmv);

  document.getElementById('t-sem').innerHTML = `
    <thead><tr><th class="l nosort">KAM</th><th class="num nosort">GMV</th><th class="num nosort">MoM</th>
      <th class="num nosort">YoY</th><th class="num nosort">Δ abs</th>
      <th class="num nosort">Cuentas</th><th class="num nosort">Crecen</th><th class="num nosort">Caen</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="l"><b>${esc(r.k)}</b></td>
      <td class="num">${F.usdK(r.gmv)}</td>
      <td class="num">${deltaHTML(r.mom)}</td>
      <td class="num">${deltaHTML(r.yoy)}</td>
      <td class="num ${r.dAbs >= 0 ? 'up' : 'down'}">${F.usdK(r.dAbs)}</td>
      <td class="num">${r.n}</td>
      <td class="num"><span class="chip good">▲ ${r.crece}</span></td>
      <td class="num"><span class="chip critical">▼ ${r.cae}</span></td></tr>`).join('')}</tbody>
    <tfoot><tr><td class="l">Total</td>
      <td class="num">${F.usdK(a.gmv[i])}</td><td class="num">${deltaHTML(gMoM)}</td>
      <td class="num">${deltaHTML(gYoY)}</td>
      <td class="num ${a.gmv[i] - a.gmv[p] >= 0 ? 'up' : 'down'}">${F.usdK(a.gmv[i] - a.gmv[p])}</td>
      <td class="num">${B.length}</td>
      <td class="num">${rows.reduce((s, r) => s + r.crece, 0)}</td>
      <td class="num">${rows.reduce((s, r) => s + r.cae, 0)}</td></tr></tfoot>`;
}

/* ====================================================== VISTA · EQUIPO */
function renderEquipo() {
  const B = filtered(), i = I.cur, p = I.prev, y = I.yoy;
  const kams = [...new Set(B.map(b => b.kam))].sort();
  const S6 = SERIES();

  document.getElementById('e-desc').textContent =
    `${F.mes(M[i])} (último mes cerrado) contra ${F.mes(M[p])} y contra el mismo mes del año pasado. `
    + `YTD compara ${M[i].slice(0, 4)} contra ${+M[i].slice(0, 4) - 1} hasta el mismo mes. `
    + 'Una «cuenta» es una marca en un canal: las marcas que operan regular y turbo cuentan doble.';

  const rows = kams.map(k => {
    const bs = B.filter(b => b.kam === k), ak = agg(bs), e = bs.map(estadoDe);
    return {
      kam: k, marcas: new Set(bs.map(b => b.marca)).size, cuentas: bs.length,
      gmv: ak.gmv[i], mom: pct(ak.gmv[i], ak.gmv[p]),
      yoy: y >= 0 ? pct(ak.gmv[i], ak.gmv[y]) : null,
      dAbs: ak.gmv[i] - ak.gmv[p],
      ytd: pct(sum(ak.gmv, I.yearStart, i), sum(ak.gmv, I.yearStart - 12, i - 12)),
      ord: ak.ord[i], aov: div(ak.gmv[i], ak.ord[i]),
      cvr: pctOf(ak.opc[i], ak.ss[i]),
      mkd: pctOf(ak.mkd[i], ak.gmv[i]),
      roas: div(ak.bka[i], ak.rva[i]),
      ts: ak.ts[i],
      crece: e.filter(x => x.key === 'crece').length,
      cae: e.filter(x => x.key === 'cae' || x.key === 'riesgo').length,
    };
  });

  const COLS = [
    ['kam', 'KAM', 'l', r => `<b>${esc(r.kam)}</b>`],
    ['marcas', 'Marcas', 'num', r => F.num(r.marcas)],
    ['cuentas', 'Cuentas', 'num', r => F.num(r.cuentas)],
    ['gmv', 'GMV', 'num', r => F.usdK(r.gmv)],
    ['mom', 'MoM', 'num', r => deltaHTML(r.mom)],
    ['yoy', 'YoY', 'num', r => deltaHTML(r.yoy)],
    ['ytd', 'YTD', 'num', r => deltaHTML(r.ytd)],
    ['dAbs', 'Δ abs', 'num', r => `<span class="${r.dAbs >= 0 ? 'up' : 'down'}">${F.usdK(r.dAbs)}</span>`],
    ['ord', 'Órdenes', 'num', r => F.numK(r.ord)],
    ['aov', 'Ticket', 'num', r => F.usdDec(r.aov)],
    ['cvr', 'Conv.', 'num', r => F.pctAbs(r.cvr, 2)],
    ['mkd', 'Mkd %', 'num', r => F.pctAbs(r.mkd, 1)],
    ['roas', 'ROAS', 'num', r => F.roas(r.roas)],
    ['ts', 'Tiendas', 'num', r => F.num(r.ts)],
    ['crece', 'Crecen', 'num', r => `<span class="chip good">${r.crece}</span>`],
    ['cae', 'Caen', 'num', r => `<span class="chip critical">${r.cae}</span>`],
  ];
  sortTable('t-kam', COLS, rows, 'kam', renderEquipo);

  /* GMV por KAM */
  draw('c-kam', {
    type: 'line',
    data: {
      labels: M.map(F.mes),
      datasets: kams.slice(0, 6).map((k, n) => {
        const ak = agg(B.filter(b => b.kam === k));
        return {
          label: k, data: ak.gmv, borderColor: S6[n], backgroundColor: S6[n],
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3,
          borderDash: [], segment: { borderDash: c => c.p1DataIndex === I.partial ? [4, 3] : undefined },
        };
      }),
    },
    options: baseOpts({
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(baseOpts().plugins.tooltip, {
          callbacks: { label: c => `${c.dataset.label}: ${F.usd(c.parsed.y)}` },
        }),
      },
      scales: {
        x: baseOpts().scales.x,
        y: Object.assign({}, baseOpts().scales.y, {
          beginAtZero: true, ticks: { color: cssv('--ink-muted'), font: { size: 10.5 }, callback: v => F.usdK(v) },
        }),
      },
    }),
  });
  document.getElementById('l-kam').innerHTML =
    legendHTML(kams.slice(0, 6).map((k, n) => ({ c: S6[n], t: k })))
    + '<span style="color:var(--ink-muted)">tramo punteado = mes en curso</span>';

  /* salud de cartera */
  const salud = kams.map(k => {
    const e = B.filter(b => b.kam === k).map(estadoDe);
    return {
      k,
      crece: e.filter(x => x.key === 'crece').length,
      estable: e.filter(x => x.key === 'estable' || x.key === 'nueva').length,
      cae: e.filter(x => x.key === 'cae' || x.key === 'riesgo').length,
    };
  });
  const gap = { borderColor: cssv('--panel'), borderWidth: 2, borderRadius: 3, borderSkipped: false };
  draw('c-salud', {
    type: 'bar',
    data: {
      labels: salud.map(s => s.k),
      datasets: [
        Object.assign({ label: 'Crecen', data: salud.map(s => s.crece), backgroundColor: cssv('--good') }, gap),
        Object.assign({ label: 'Estables o nuevas', data: salud.map(s => s.estable), backgroundColor: cssv('--ink-muted') }, gap),
        Object.assign({ label: 'Caen o pararon', data: salud.map(s => s.cae), backgroundColor: cssv('--critical') }, gap),
      ],
    },
    options: baseOpts({
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: baseOpts().plugins.tooltip },
      scales: {
        y: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: cssv('--ink-2'), font: { size: 11 } } },
        x: { stacked: true, grid: { color: cssv('--grid') }, border: { display: false }, ticks: { color: cssv('--ink-muted'), font: { size: 10.5 }, precision: 0 } },
      },
    }),
  });
  document.getElementById('l-salud').innerHTML = legendHTML([
    { c: cssv('--good'), t: 'Crecen (≥ +10%)' },
    { c: cssv('--ink-muted'), t: 'Estables o nuevas' },
    { c: cssv('--critical'), t: 'Caen (≤ −5%) o dejaron de facturar' },
  ]);

  /* concentración */
  const conc = kams.map(k => {
    const bs = B.filter(b => b.kam === k);
    const tot = bs.reduce((s, b) => s + (b.gmv[i] || 0), 0);
    // «(turbo)» y no «· turbo»: el punto medio ya separa los elementos de la lista.
    const top = bs.map(b => ({ m: b.marca + (b.canal === 'turbo' ? ' (turbo)' : ''), g: b.gmv[i] || 0 }))
      .sort((x, z) => z.g - x.g).slice(0, 5);
    return { k, tot, top, sh: tot ? top.reduce((s, t) => s + t.g, 0) / tot * 100 : 0 };
  }).sort((x, z) => z.tot - x.tot);

  document.getElementById('t-conc').innerHTML = `
    <thead><tr><th class="l nosort">KAM</th><th class="l nosort">Top 5 cuentas</th><th class="num nosort">Peso</th></tr></thead>
    <tbody>${conc.map(c => `<tr>
      <td class="l"><b>${esc(c.k)}</b></td>
      <td class="l" style="white-space:normal;font-size:11.5px;color:var(--ink-2)">${c.top.map(t => esc(t.m)).join(' · ')}</td>
      <td class="num"><span class="chip ${c.sh > 80 ? 'critical' : c.sh > 60 ? 'warning' : 'neutral'}">${F.pctAbs(c.sh, 0)}</span></td>
    </tr>`).join('')}</tbody>`;
}

/* ===================================================== VISTA · CUENTAS */
function cuentasRows() {
  const i = I.cur, p = I.prev, y = I.yoy;
  return filtered().map(b => {
    const e = estadoDe(b);
    return {
      b, marca: b.marca, canal: b.canal, kam: b.kam, categoria: b.categoria,
      ciudad: b.ciudades[0] || '—', nCiudades: b.ciudades.length,
      gmv: b.gmv[i] || 0, mom: e.mom, dAbs: e.dAbs,
      yoy: y >= 0 ? pct(b.gmv[i], b.gmv[y]) : null,
      tend: e.tend, estado: e,
      ord: b.ord[i] || 0, aov: div(b.gmv[i], b.ord[i]),
      mkd: pctOf(b.mkd[i], b.gmv[i]),
      roas: div(b.bka[i], b.rva[i]),
      ts: b.ts[i] || 0,
      serie: b.gmv,
    };
  });
}

function renderCuentas() {
  const i = I.cur, p = I.prev;
  let rows = cuentasRows();
  const all = rows.slice();

  const nCrece = all.filter(r => r.estado.key === 'crece').length;
  const nCae = all.filter(r => r.estado.key === 'cae').length;
  const nRiesgo = all.filter(r => r.estado.key === 'riesgo').length;
  const nNueva = all.filter(r => r.estado.key === 'nueva').length;
  const dPos = all.filter(r => r.dAbs > 0).reduce((s, r) => s + r.dAbs, 0);
  const dNeg = all.filter(r => r.dAbs < 0).reduce((s, r) => s + r.dAbs, 0);

  const kpi = (l, v, e) => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div><div class="row">${e}</div></div>`;
  document.getElementById('c-kpis').innerHTML = [
    kpi('Cuentas en seguimiento', F.num(all.length), `<span>${new Set(all.map(r => r.marca)).size} marcas</span>`),
    kpi('Crecen', F.num(nCrece), `<span class="up">+${F.usdK(dPos)}</span>`),
    kpi('Caen', F.num(nCae + nRiesgo), `<span class="down">${F.usdK(dNeg)}</span>`),
    kpi('Nuevas', F.num(nNueva), `<span>últimos 3 meses</span>`),
    kpi('Efecto neto', F.usdK(dPos + dNeg), `<span>${F.mes(M[p])} → ${F.mes(M[i])}</span>`),
  ].join('');

  const ban = [];
  if (nRiesgo) ban.push(['critical', '🛑',
    `<b>${nRiesgo} cuenta${nRiesgo === 1 ? '' : 's'} sin facturación en ${F.mes(M[i])}</b> después de haber facturado antes. Es lo primero que hay que resolver en la junta.`]);
  const sostenida = all.filter(r => r.estado.label === 'Caída sostenida');
  if (sostenida.length) ban.push(['serious', '📉',
    `<b>${sostenida.length} cuentas llevan más de un mes cayendo</b> (el trimestre también va a la baja): ${sostenida.slice(0, 5).map(r => esc(r.marca)).join(', ')}${sostenida.length > 5 ? '…' : ''}.`]);
  document.getElementById('c-banners').innerHTML = ban.map(([t, ic, h]) =>
    `<div class="banner ${t}"><span class="ic">${ic}</span><div>${h}</div></div>`).join('');

  /* top movimientos en dólares */
  const byAbs = all.slice().sort((x, z) => x.dAbs - z.dAbs);
  const dec = byAbs.filter(r => r.dAbs < 0).slice(0, 10);
  const inc = byAbs.filter(r => r.dAbs > 0).slice(-10).reverse();
  document.getElementById('c-dec-desc').textContent =
    `Cuánto GMV perdió cada cuenta entre ${F.mes(M[p])} y ${F.mes(M[i])}. Ordenado por dólares, no por porcentaje.`;
  document.getElementById('c-inc-desc').textContent =
    `Cuánto GMV ganó cada cuenta en el mismo periodo.`;

  const barra = (id, data, color) => draw(id, {
    type: 'bar',
    data: {
      labels: data.map(r => r.marca + (r.canal === 'turbo' ? ' · turbo' : '')),
      datasets: [{ label: 'Δ GMV', data: data.map(r => r.dAbs), backgroundColor: color, borderRadius: 4, borderSkipped: false }],
    },
    options: baseOpts({
      indexAxis: 'y',
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(baseOpts().plugins.tooltip, {
          callbacks: {
            label: c => {
              const r = data[c.dataIndex];
              return `${F.usd(r.dAbs)}  ·  ${F.usdK(r.estado.g1)} → ${F.usdK(r.estado.g0)}  (${F.pct(r.mom)})`;
            },
          },
        }),
      },
      scales: {
        y: { grid: { display: false }, border: { display: false }, ticks: { color: cssv('--ink-2'), font: { size: 11 } } },
        x: { grid: { color: cssv('--grid') }, border: { display: false }, ticks: { color: cssv('--ink-muted'), font: { size: 10.5 }, callback: v => F.usdK(v) } },
      },
    }),
  });
  barra('c-top-dec', dec, cssv('--critical'));
  barra('c-top-inc', inc, cssv('--good'));

  /* tabla */
  if (S.estado !== 'all') rows = rows.filter(r => r.estado.key === S.estado);
  if (S.q) rows = rows.filter(r => r.marca.toLowerCase().includes(S.q));

  const COLS = [
    ['marca', 'Marca', 'l', r => `<span class="linkish" data-marca="${esc(r.marca + '|' + r.canal + '|' + r.kam)}">${esc(r.marca)}</span>`
      + (r.canal === 'turbo' ? ' <span class="chip neutral">turbo</span>' : '')],
    ['kam', 'KAM', 'l', r => esc(r.kam)],
    ['categoria', 'Categoría', 'l', r => esc(r.categoria)],
    ['ciudad', 'Ciudad', 'l', r => esc(r.ciudad) + (r.nCiudades > 1 ? ` +${r.nCiudades - 1}` : '')],
    ['estadoK', 'Estado', 'l', r => `<span class="chip ${r.estado.tone}">${esc(r.estado.label)}</span>`],
    ['gmv', 'GMV', 'num', r => F.usdK(r.gmv)],
    ['mom', 'MoM', 'num', r => deltaHTML(r.mom)],
    ['dAbs', 'Δ abs', 'num', r => `<span class="${r.dAbs >= 0 ? 'up' : 'down'}">${F.usdK(r.dAbs)}</span>`],
    ['yoy', 'YoY', 'num', r => deltaHTML(r.yoy)],
    ['tend', 'Tend. 3m', 'num', r => deltaHTML(r.tend)],
    ['sparkline', 'Tendencia', 'l', r => sparkline(r.serie)],
    ['ord', 'Órdenes', 'num', r => F.numK(r.ord)],
    ['aov', 'Ticket', 'num', r => F.usdDec(r.aov)],
    ['mkd', 'Mkd %', 'num', r => F.pctAbs(r.mkd, 1)],
    ['roas', 'ROAS', 'num', r => F.roas(r.roas)],
    ['ts', 'Tiendas', 'num', r => F.num(r.ts)],
  ];
  rows.forEach(r => r.estadoK = r.estado.label);
  sortTable('t-cuentas', COLS, rows, 'cuentas', renderCuentas, true);

  document.querySelectorAll('#t-cuentas .linkish').forEach(el =>
    el.addEventListener('click', () => {
      S.marca = el.dataset.marca;
      document.querySelector('#tabs .tab[data-view="marca"]').click();
    }));
}

/** Mini-serie en SVG, sin ejes: solo la forma de la tendencia. */
function sparkline(serie) {
  const v = serie.map(x => x || 0), n = v.length;
  const max = Math.max(...v, 1), min = Math.min(...v, 0);
  const w = 78, h = 20, r = max - min || 1;
  const pts = v.map((x, k) => `${(k / (n - 1) * w).toFixed(1)},${(h - (x - min) / r * h).toFixed(1)}`).join(' ');
  const up = v[I.cur] >= v[I.prev];
  const col = up ? 'var(--good)' : 'var(--critical)';
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

/* ======================================================= VISTA · MARCA */
function renderMarca() {
  const sel = document.getElementById('sel-marca');
  const opts = filtered().map(b => ({ v: `${b.marca}|${b.canal}|${b.kam}`, t: `${b.marca}${b.canal === 'turbo' ? ' · turbo' : ''} — ${b.kam}` }))
    .sort((a, z) => a.t.localeCompare(z.t, 'es'));
  if (!opts.length) {
    document.getElementById('m-diag').innerHTML = '<div class="empty">Ninguna marca cumple los filtros actuales.</div>';
    return;
  }
  // Al entrar sin selección previa, abre la cuenta más grande: es la que
  // normalmente arranca la conversación, no la primera del alfabeto.
  if (!S.marca || !opts.some(o => o.v === S.marca)) {
    const mayor = filtered().slice().sort((a, z) => (z.gmv[I.cur] || 0) - (a.gmv[I.cur] || 0))[0];
    S.marca = mayor ? `${mayor.marca}|${mayor.canal}|${mayor.kam}` : opts[0].v;
  }
  sel.innerHTML = opts.map(o => `<option value="${esc(o.v)}"${o.v === S.marca ? ' selected' : ''}>${esc(o.t)}</option>`).join('');

  const [marca, canal, kam] = S.marca.split('|');
  const b = D.brands.find(x => x.marca === marca && x.canal === canal && x.kam === kam);
  if (!b) return;
  const i = I.cur, p = I.prev, y = I.yoy, e = estadoDe(b);

  document.getElementById('m-badges').innerHTML =
    `<span class="chip ${e.tone}">${esc(e.label)}</span>
     <span class="chip neutral">${esc(b.categoria)}</span>
     <span class="chip neutral">${esc(b.kam)}</span>
     <span class="chip neutral">${b.ciudades.length} ciudad${b.ciudades.length === 1 ? '' : 'es'}</span>`;

  /* diagnóstico automático */
  const d = [];
  const cvr0 = div(b.opc[i], b.ss[i]), cvr1 = div(b.opc[p], b.ss[p]);
  const dTraf = pct(b.ss[i], b.ss[p]), dCvr = pct(cvr0, cvr1), dAov = pct(div(b.gmv[i], b.ord[i]), div(b.gmv[p], b.ord[p]));
  if (e.mom != null && e.mom <= -5) {
    const causas = [];
    if (dTraf != null && dTraf <= -5) causas.push(`el tráfico cayó ${F.pctAbs(Math.abs(dTraf))}`);
    if (dCvr != null && dCvr <= -5) causas.push(`la conversión cayó ${F.pctAbs(Math.abs(dCvr))}`);
    if (dAov != null && dAov <= -5) causas.push(`el ticket bajó ${F.pctAbs(Math.abs(dAov))}`);
    d.push(['critical', '🔻', `<b>Cae ${F.pctAbs(Math.abs(e.mom))} contra ${F.mes(M[p])}</b> (${F.usdK(e.dAbs)}).`
      + (causas.length ? ` Explicación: ${causas.join(' y ')}.` : ' El desglose no señala una causa única: revisa tiendas activas y disponibilidad.')]);
  } else if (e.mom != null && e.mom >= 10) {
    const causas = [];
    if (dTraf != null && dTraf >= 5) causas.push(`más tráfico (${F.pct(dTraf)})`);
    if (dCvr != null && dCvr >= 5) causas.push(`mejor conversión (${F.pct(dCvr)})`);
    if (pct(b.ts[i], b.ts[p]) > 0) causas.push(`más tiendas (${b.ts[p]} → ${b.ts[i]})`);
    d.push(['good', '🔺', `<b>Crece ${F.pctAbs(e.mom)} contra ${F.mes(M[p])}</b> (${F.usdK(e.dAbs)}).`
      + (causas.length ? ` Viene de ${causas.join(' y ')}.` : '')]);
  }
  const mk = div(b.mkd[i], b.gmv[i]);
  if (mk != null && mk > 0.15) d.push(['warning', '💸',
    `<b>El markdown se lleva ${F.pctAbs(mk * 100)} del GMV.</b> Si el crecimiento depende de esto, no es sostenible.`]);
  const ro = div(b.bka[i], b.rva[i]);
  if (ro != null && ro > 0 && ro < 3) d.push(['warning', '📣',
    `<b>ROAS de ${F.dec(ro, 1)}×</b>: la inversión en ads está rindiendo poco.`]);
  if (b.ts[i] < b.ts[p]) d.push(['serious', '🏪',
    `<b>Perdió tiendas activas</b>: ${b.ts[p]} → ${b.ts[i]}. Revisa cierres o disponibilidad antes que la demanda.`]);
  if (!d.length) d.push(['info', '✅', `<b>Sin señales de alerta</b> en ${F.mes(M[i])}.`]);
  document.getElementById('m-diag').innerHTML = d.map(([t, ic, h]) =>
    `<div class="banner ${t}"><span class="ic">${ic}</span><div>${h}</div></div>`).join('');

  /* KPIs */
  const kpi = (l, v, ex) => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div><div class="row">${ex}</div></div>`;
  document.getElementById('m-kpis').innerHTML = [
    kpi(`GMV · ${F.mes(M[i])}`, F.usdK(b.gmv[i]), `<span>MoM ${deltaHTML(e.mom)}</span><span>YoY ${deltaHTML(y >= 0 ? pct(b.gmv[i], b.gmv[y]) : null)}</span>`),
    kpi('Órdenes', F.numK(b.ord[i]), `<span>MoM ${deltaHTML(pct(b.ord[i], b.ord[p]))}</span>`),
    kpi('Usuarios', F.numK(b.usr[i]), `<span>MoM ${deltaHTML(pct(b.usr[i], b.usr[p]))}</span>`),
    kpi('Ticket promedio', F.usdDec(div(b.gmv[i], b.ord[i])), `<span>MoM ${deltaHTML(dAov)}</span>`),
    kpi('Visitas a tienda', F.numK(b.ss[i]), `<span>MoM ${deltaHTML(dTraf)}</span>`),
    kpi('Conversión', F.pctAbs(cvr0 * 100, 2), `<span>MoM ${deltaHTML(dCvr)}</span>`),
    kpi('Tiendas activas', F.num(b.ts[i]), `<span>MoM ${deltaHTML(pct(b.ts[i], b.ts[p]))}</span>`),
    kpi('Markdown % del GMV', F.pctAbs(mk * 100, 1), `<span>${F.usdK(b.mkd[i])}</span>`),
    kpi('ROAS de ads', F.roas(ro), `<span>inv. ${F.usdK(b.rva[i])}</span><span>${F.pctAbs(pctOf(b.oa[i], b.ord[i]), 0)} de órdenes</span>`),
  ].join('');

  const S6 = SERIES(), c1 = S6[0], c2 = S6[1], c3 = S6[2];
  const first = b.gmv.findIndex(v => v);
  const idxFrom = arr => {
    const b0 = arr[first] || arr.find(v => v) || 1;
    return arr.map((v, k) => k < first ? null : v == null ? null : v / b0 * 100);
  };
  const aovS = M.map((_, k) => div(b.gmv[k], b.ord[k]));
  const dash = { segment: { borderDash: c => c.p1DataIndex === I.partial ? [4, 3] : undefined } };

  draw('m-c-gmv', {
    type: 'line',
    data: {
      labels: M.map(F.mes),
      datasets: [
        Object.assign({ label: 'GMV', data: idxFrom(b.gmv), borderColor: c1, backgroundColor: c1, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 }, dash),
        Object.assign({ label: 'Órdenes', data: idxFrom(b.ord), borderColor: c2, backgroundColor: c2, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 }, dash),
        Object.assign({ label: 'Usuarios', data: idxFrom(b.usr), borderColor: c3, backgroundColor: c3, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 }, dash),
      ],
    },
    options: baseOpts({
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(baseOpts().plugins.tooltip, {
          callbacks: {
            label: c => {
              const k = c.dataIndex;
              const real = c.datasetIndex === 0 ? F.usd(b.gmv[k]) : c.datasetIndex === 1 ? F.num(b.ord[k]) : F.num(b.usr[k]);
              return `${c.dataset.label}: ${real}  ·  índice ${F.dec(c.parsed.y, 0)}`;
            },
          },
        }),
      },
    }),
  });
  document.getElementById('m-l-gmv').innerHTML = legendHTML([
    { c: c1, t: 'GMV' }, { c: c2, t: 'Órdenes' }, { c: c3, t: 'Usuarios' },
  ]) + `<span style="color:var(--ink-muted)">100 = ${F.mes(M[Math.max(first, 0)])}</span>`;

  /* embudo mes a mes */
  draw('m-c-funnel', {
    type: 'line',
    data: {
      labels: M.map(F.mes),
      datasets: [
        Object.assign({ label: 'Carrito ÷ visitas', data: M.map((_, k) => pctOf(b.atc[k], b.ss[k])), borderColor: c1, backgroundColor: c1, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 }, dash),
        Object.assign({ label: 'Orden ÷ carrito', data: M.map((_, k) => pctOf(b.op[k], b.atc[k])), borderColor: c2, backgroundColor: c2, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 }, dash),
        Object.assign({ label: 'Confirmada ÷ visitas', data: M.map((_, k) => pctOf(b.opc[k], b.ss[k])), borderColor: c3, backgroundColor: c3, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 }, dash),
      ],
    },
    options: baseOpts({
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(baseOpts().plugins.tooltip, { callbacks: { label: c => `${c.dataset.label}: ${F.pctAbs(c.parsed.y, 2)}` } }),
      },
      scales: {
        x: baseOpts().scales.x,
        y: Object.assign({}, baseOpts().scales.y, { beginAtZero: true, ticks: { color: cssv('--ink-muted'), font: { size: 10.5 }, callback: v => nf(v, 0) + '%' } }),
      },
    }),
  });
  document.getElementById('m-l-funnel').innerHTML = legendHTML([
    { c: c1, t: 'Carrito ÷ visitas' }, { c: c2, t: 'Orden ÷ carrito' }, { c: c3, t: 'Confirmada ÷ visitas' },
  ]);

  /* inversión */
  draw('m-c-inv', {
    type: 'line',
    data: {
      labels: M.map(F.mes),
      datasets: [
        Object.assign({ label: 'Markdown / GMV', data: M.map((_, k) => pctOf(b.mkd[k], b.gmv[k])), borderColor: c2, backgroundColor: c2, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 }, dash),
        Object.assign({ label: 'Ads cobrados / GMV', data: M.map((_, k) => pctOf(b.rva[k], b.gmv[k])), borderColor: S6[4], backgroundColor: S6[4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 }, dash),
        Object.assign({ label: 'Órdenes de ads / órdenes', data: M.map((_, k) => pctOf(b.oa[k], b.ord[k])), borderColor: c1, backgroundColor: c1, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 }, dash),
      ],
    },
    options: baseOpts({
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(baseOpts().plugins.tooltip, { callbacks: { label: c => `${c.dataset.label}: ${F.pctAbs(c.parsed.y, 2)}` } }),
      },
      scales: {
        x: baseOpts().scales.x,
        y: Object.assign({}, baseOpts().scales.y, { beginAtZero: true, ticks: { color: cssv('--ink-muted'), font: { size: 10.5 }, callback: v => nf(v, 0) + '%' } }),
      },
    }),
  });
  document.getElementById('m-l-inv').innerHTML = legendHTML([
    { c: c2, t: 'Markdown / GMV' }, { c: S6[4], t: 'Ads cobrados / GMV' }, { c: c1, t: 'Órdenes de ads / órdenes' },
  ]);

  /* tiendas */
  const opt = M.map((_, k) => div(b.ord[k], b.ts[k]));
  draw('m-c-stores', {
    type: 'line',
    data: {
      labels: M.map(F.mes),
      datasets: [
        Object.assign({ label: 'Tiendas activas', data: idxFrom(b.ts), borderColor: c1, backgroundColor: c1, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 }, dash),
        Object.assign({ label: 'Órdenes por tienda', data: idxFrom(opt), borderColor: c3, backgroundColor: c3, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 }, dash),
        Object.assign({ label: 'Ticket promedio', data: idxFrom(aovS), borderColor: S6[3], backgroundColor: S6[3], borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .3 }, dash),
      ],
    },
    options: baseOpts({
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(baseOpts().plugins.tooltip, {
          callbacks: {
            label: c => {
              const k = c.dataIndex;
              const real = c.datasetIndex === 0 ? F.num(b.ts[k]) : c.datasetIndex === 1 ? F.dec(opt[k], 0) : F.usdDec(aovS[k]);
              return `${c.dataset.label}: ${real}  ·  índice ${F.dec(c.parsed.y, 0)}`;
            },
          },
        }),
      },
    }),
  });
  document.getElementById('m-l-stores').innerHTML = legendHTML([
    { c: c1, t: 'Tiendas activas' }, { c: c3, t: 'Órdenes por tienda' }, { c: S6[3], t: 'Ticket promedio' },
  ]) + `<span style="color:var(--ink-muted)">100 = ${F.mes(M[Math.max(first, 0)])}</span>`;

  /* tabla mensual */
  const head = ['Mes', 'GMV', 'MoM', 'Órdenes', 'Usuarios', 'Ticket', 'Visitas', 'Conv.', 'Mkd %', 'ROAS', 'Tiendas'];
  document.getElementById('m-tabla').innerHTML = `
    <thead><tr>${head.map((h, n) => `<th class="${n ? 'num' : 'l'} nosort">${h}</th>`).join('')}</tr></thead>
    <tbody>${M.map((m, k) => `<tr>
      <td class="l">${F.mes(m)}${k === I.partial ? ' <span class="chip warning">en curso</span>' : ''}</td>
      <td class="num">${F.usdK(b.gmv[k])}</td>
      <td class="num">${deltaHTML(k ? pct(b.gmv[k], b.gmv[k - 1]) : null)}</td>
      <td class="num">${F.num(b.ord[k])}</td>
      <td class="num">${F.num(b.usr[k])}</td>
      <td class="num">${F.usdDec(aovS[k])}</td>
      <td class="num">${F.numK(b.ss[k])}</td>
      <td class="num">${F.pctAbs(pctOf(b.opc[k], b.ss[k]), 2)}</td>
      <td class="num">${F.pctAbs(pctOf(b.mkd[k], b.gmv[k]), 1)}</td>
      <td class="num">${F.roas(div(b.bka[k], b.rva[k]))}</td>
      <td class="num">${F.num(b.ts[k])}</td></tr>`).reverse().join('')}</tbody>`;
}

/* ================================================= VISTA · COMPROMISOS */
const FB_URL = 'https://dashboard-comercial-semanal-default-rtdb.firebaseio.com';
const NS_KAM = 'compromisos_v2';          // namespace histórico — no se toca el esquema
const NS_MARCA = 'compromisos_marca_v1';
const LS_KEY = 'rappi_compromisos_kam_v2';
let _cache = { kam: {}, marca: {} };

const fbKey = s => String(s).replace(/[.#$\[\]\/ ]/g, '_');

async function fbLoad(ns) {
  try {
    const r = await fetch(`${FB_URL}/${ns}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return (await r.json()) || {};
  } catch (e) {
    console.warn('Firebase no responde para', ns, e);
    if (ns === NS_KAM) { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }
    return {};
  }
}

async function fbSave(ns, key, field, value) {
  const k = fbKey(key);
  const store = ns === NS_KAM ? _cache.kam : _cache.marca;
  store[k] = store[k] || {};
  store[k][field] = value;
  if (ns === NS_KAM) { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { } }
  try {
    const r = await fetch(`${FB_URL}/${ns}/${k}.json`, {
      method: 'PATCH',
      body: JSON.stringify({ [field]: value, _updated: new Date().toISOString(), _label: key }),
      headers: { 'Content-Type': 'application/json' },
    });
    return r.ok;
  } catch { return false; }
}

function textareaCard(ns, key, title, badges, stats, data) {
  const id = fbKey(key);
  return `<div class="ccard">
    <div class="chead"><div class="cname">${esc(title)}</div><div>${badges}</div></div>
    <div class="cstats">${stats}</div>
    <label for="ta-c-${id}">💬 Qué está pasando</label>
    <textarea id="ta-c-${id}" data-ns="${ns}" data-key="${esc(key)}" data-field="comentarios"
      placeholder="Contexto, causas, lo que ya se intentó…">${esc(data.comentarios || '')}</textarea>
    <label for="ta-p-${id}">🎯 Compromisos y próximos pasos</label>
    <textarea id="ta-p-${id}" data-ns="${ns}" data-key="${esc(key)}" data-field="compromisos"
      placeholder="Acción · responsable · fecha">${esc(data.compromisos || '')}</textarea>
    <div class="status" id="st-${id}"></div>
  </div>`;
}

function wireTextareas(root) {
  root.querySelectorAll('textarea').forEach(ta => {
    let t;
    ta.addEventListener('input', () => {
      const st = document.getElementById('st-' + fbKey(ta.dataset.key));
      if (st) { st.textContent = '○ escribiendo…'; st.style.color = 'var(--ink-muted)'; }
      clearTimeout(t);
      t = setTimeout(async () => {
        const ok = await fbSave(ta.dataset.ns, ta.dataset.key, ta.dataset.field, ta.value);
        if (st) {
          st.textContent = ok ? '✓ guardado en la nube' : '⚠ guardado solo en este equipo';
          st.style.color = ok ? 'var(--good-text)' : 'var(--warning)';
          clearTimeout(st._t); st._t = setTimeout(() => { st.textContent = ''; }, 2500);
        }
      }, 600);
    });
  });
}

async function renderCompromisos() {
  const kc = document.getElementById('k-cards'), bc = document.getElementById('b-cards');
  kc.innerHTML = '<div class="empty">Cargando…</div>';
  bc.innerHTML = '';
  [_cache.kam, _cache.marca] = await Promise.all([fbLoad(NS_KAM), fbLoad(NS_MARCA)]);

  const B = filtered(), i = I.cur, p = I.prev, y = I.yoy;
  document.getElementById('k-desc').textContent =
    `Contexto de ${F.mes(M[i])}, el último mes cerrado. Se guarda solo mientras escribes.`;

  const kams = [...new Set(B.map(b => b.kam))].sort();
  kc.innerHTML = kams.map(k => {
    const ak = agg(B.filter(b => b.kam === k));
    const mom = pct(ak.gmv[i], ak.gmv[p]);
    const stats = `
      <div class="cstat"><span class="v">${F.usdK(ak.gmv[i])}</span><span class="l">GMV ${F.mes(M[i])}</span></div>
      <div class="cstat"><span class="v ${cls(mom)}">${F.pct(mom)}</span><span class="l">vs mes ant.</span></div>
      <div class="cstat"><span class="v ${cls(y >= 0 ? pct(ak.gmv[i], ak.gmv[y]) : null)}">${F.pct(y >= 0 ? pct(ak.gmv[i], ak.gmv[y]) : null)}</span><span class="l">vs año ant.</span></div>`;
    const badge = `<span class="chip ${mom >= 0 ? 'good' : 'critical'}">${arrow(mom)} ${F.pct(mom)}</span>`;
    return textareaCard(NS_KAM, k, k, badge, stats, _cache.kam[fbKey(k)] || {});
  }).join('');
  wireTextareas(kc);

  /* cuentas que piden plan: mayores caídas + mayores crecimientos */
  const rows = cuentasRows().sort((a, z) => a.dAbs - z.dAbs);
  const foco = [...rows.filter(r => r.dAbs < 0).slice(0, 6), ...rows.filter(r => r.dAbs > 0).slice(-3)];
  bc.innerHTML = foco.map(r => {
    const key = `${r.marca}|${r.canal}|${r.kam}`;
    const stats = `
      <div class="cstat"><span class="v">${F.usdK(r.gmv)}</span><span class="l">GMV ${F.mes(M[i])}</span></div>
      <div class="cstat"><span class="v ${cls(r.mom)}">${F.pct(r.mom)}</span><span class="l">vs mes ant.</span></div>
      <div class="cstat"><span class="v ${r.dAbs >= 0 ? 'up' : 'down'}">${F.usdK(r.dAbs)}</span><span class="l">Δ en dólares</span></div>`;
    const badge = `<span class="chip ${r.estado.tone}">${esc(r.estado.label)}</span> <span class="chip neutral">${esc(r.kam)}</span>`;
    return textareaCard(NS_MARCA, key, r.marca + (r.canal === 'turbo' ? ' · turbo' : ''), badge, stats,
      _cache.marca[fbKey(key)] || {});
  }).join('');
  wireTextareas(bc);
}

/* ====================================================== VISTA · DATOS */
function renderDatos() {
  const m = D.meta, q = D.qa;
  const ban = [];
  const dias = Math.floor((Date.now() - new Date(m.generated_at).getTime()) / 864e5);
  if (m.fuente !== 'snowflake') ban.push(['warning', '⚠️',
    `<b>Estos números vienen del Google Sheet, no de Snowflake.</b> El Sheet tiene el idioma configurado en español de España,
     lo que hace que Google reinterprete algunos decimales. Se aplica una corrección automática, pero la fuente confiable es Snowflake.`]);
  if (dias > 10) ban.push(['serious', '🕐',
    `<b>El snapshot tiene ${dias} días.</b> Corre <code>refresh.ps1</code> para actualizarlo.`]);
  if (!ban.length) ban.push(['good', '✅',
    `<b>Todo en orden.</b> Datos de ${m.fuente} hasta el ${F.fecha(m.data_hasta)}, generados hace ${dias <= 0 ? 'menos de un día' : dias + ' día' + (dias === 1 ? '' : 's')}.`]);
  document.getElementById('d-banners').innerHTML = ban.map(([t, ic, h]) =>
    `<div class="banner ${t}"><span class="ic">${ic}</span><div>${h}</div></div>`).join('');

  const meta = [
    ['Fuente', m.fuente === 'snowflake'
      ? 'Snowflake · RP_SILVER_DB_PROD.RESTAURANTES_RADS.FOLLOW_UP_GROWTH_METRICS_DIMENSIONS'
      : 'Google Sheet «Seguimiento equipo» (respaldo)'],
    ['Cartera', `marcas con BRAND_OWNER_LEADER = ${m.lider_email}`],
    ['Snapshot generado', m.generated_at.replace('T', ' ')],
    ['Datos disponibles hasta', F.fecha(m.data_hasta)],
    ['Último mes cerrado', F.mes(m.ultimo_cerrado)],
    ['Mes en curso', m.mes_parcial ? `${F.mes(M[M.length - 1])} · ${m.dias_transcurridos} de ${m.dias_del_mes} días` : 'ninguno'],
    ['Ventana histórica', `${M.length} meses · ${F.mes(M[0])} → ${F.mes(M[M.length - 1])}`],
    ['Series (marca × canal)', F.num(D.brands.length)],
    ['Marcas', F.num(q.marcas)],
    ['KAMs', m.kams.join(', ')],
    ['Categorías', F.num(m.categorias.length)],
    ['Ciudades', F.num(m.ciudades.length)],
  ];
  document.getElementById('t-meta').innerHTML =
    `<tbody>${meta.map(([k, v]) => `<tr><td class="l" style="width:230px;color:var(--ink-muted)">${esc(k)}</td>
      <td class="l" style="white-space:normal">${esc(v)}</td></tr>`).join('')}</tbody>`;

  const dupKeys = new Set(D.brands.map(b => b.kam + '|' + b.marca + '|' + b.canal));
  const badLen = D.brands.filter(b => METRICS.some(k => b[k].length !== M.length)).length;
  const checks = [
    ['Llave única por marca × canal × KAM', dupKeys.size === D.brands.length, `${dupKeys.size} de ${D.brands.length}`],
    ['Todas las series cubren los 25 meses', badLen === 0, `${badLen} con longitud distinta`],
    ['Marcas con categoría asignada', q.sin_categoria.length === 0,
      q.sin_categoria.length ? `${q.sin_categoria.length} sin categoría` : 'todas'],
    ['Sin GMV negativo', q.gmv_negativo.length === 0,
      q.gmv_negativo.length ? `${q.gmv_negativo.length} celdas` : 'ninguna'],
    ['Ticket promedio dentro de rango razonable',
      !D.brands.some(b => M.some((_, k) => b.ord[k] > 30 && div(b.gmv[k], b.ord[k]) > 120)), 'entre $3 y $120'],
    ['Embudo consistente (carrito ≤ visitas)',
      !D.brands.some(b => M.some((_, k) => (b.atc[k] || 0) > (b.ss[k] || 0))), 'ATC ≤ SS'],
  ];
  document.getElementById('t-qa').innerHTML = `
    <thead><tr><th class="l nosort">Control</th><th class="l nosort">Resultado</th><th class="l nosort">Detalle</th></tr></thead>
    <tbody>${checks.map(([n, ok, d]) => `<tr>
      <td class="l">${esc(n)}</td>
      <td class="l"><span class="chip ${ok ? 'good' : 'warning'}">${ok ? '✓ pasa' : '! revisar'}</span></td>
      <td class="l" style="color:var(--ink-muted)">${esc(d)}</td></tr>`).join('')}</tbody>`;

  const defs = [
    ['GMV', 'Valor bruto de las órdenes, en dólares (GMV_USD_). Es la métrica de cabecera de la cartera.'],
    ['Órdenes / Usuarios', 'Órdenes totales y usuarios que compraron en el mes.'],
    ['Ticket promedio', 'GMV ÷ órdenes.'],
    ['Visitas a tienda', 'Sesiones en la página de la tienda (SS). Es la boca del embudo.'],
    ['Conversión', 'Órdenes confirmadas ÷ visitas. Si cae con tráfico estable, el problema está en la ficha, el precio o la disponibilidad.'],
    ['Markdown', 'Descuento absorbido en promociones. Se mira como % del GMV: mide cuánto cuesta comprar ese crecimiento.'],
    ['ROAS', 'Bookings atribuidos a ads ÷ inversión cobrada en ads. Por debajo de 3× la pauta rinde poco.'],
    ['Tiendas activas', 'Tiendas con al menos una orden en el mes. Sirve para separar crecimiento por aperturas de crecimiento real.'],
    ['Δ abs', 'Cambio en dólares contra el mes anterior. Es lo que mueve la aguja de la cartera; el porcentaje engaña en cuentas chicas.'],
    ['Tend. 3m', 'Últimos 3 meses contra los 3 previos. Filtra el ruido de un mes suelto.'],
    ['Mes en curso', 'El último mes aún no cierra. No entra en ninguna comparación mensual: se compara aparte contra la misma ventana de días.'],
    ['Estado de la cuenta', 'Crece ≥ +10%; Estable entre −5% y +10%; Desacelera de −5% a −15%; Cae por debajo de −15%; Caída sostenida si además el trimestre va a la baja; Dejó de facturar si el mes cerró en cero.'],
  ];
  document.getElementById('d-defs').innerHTML =
    defs.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('');
}

/* ======================================================= TABLAS + CSV */
function sortTable(id, cols, rows, sortKey, rerender, clickable) {
  const st = S.sort[sortKey] || (S.sort[sortKey] = { k: cols[0][0], dir: 1 });
  const val = r => {
    const v = r[st.k];
    return v == null ? (st.dir === 1 ? Infinity : -Infinity) : v;
  };
  rows.sort((a, b) => {
    const x = val(a), z = val(b);
    if (typeof x === 'string' || typeof z === 'string')
      return String(x).localeCompare(String(z), 'es') * st.dir;
    return (x - z) * st.dir;
  });

  const el = document.getElementById(id);
  el.innerHTML = `
    <thead><tr>${cols.map(([k, t, c]) =>
      `<th class="${c === 'num' ? 'num' : 'l'}${k === 'sparkline' ? ' nosort' : ''}" data-k="${k}">${esc(t)}${
        st.k === k ? `<span class="ar">${st.dir === 1 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(([k, t, c, f]) =>
      `<td class="${c === 'num' ? 'num' : 'l'}">${f(r)}</td>`).join('')}</tr>`).join('')}</tbody>`;

  el.querySelectorAll('thead th:not(.nosort)').forEach(th =>
    th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (st.k === k) st.dir *= -1; else { st.k = k; st.dir = ['marca', 'kam', 'categoria', 'ciudad', 'estadoK'].includes(k) ? 1 : -1; }
      rerender();
    }));
  el._rows = rows; el._cols = cols;
}

function exportCSV() {
  const el = document.getElementById('t-cuentas');
  const rows = el._rows || [], cols = el._cols || [];
  const head = ['marca', 'canal', 'kam', 'categoria', 'ciudades', 'estado', 'gmv', 'mom_pct',
    'delta_abs', 'yoy_pct', 'tend3m_pct', 'ordenes', 'ticket', 'markdown_pct', 'roas', 'tiendas'];
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const body = rows.map(r => [r.marca, r.canal, r.kam, r.categoria, r.b.ciudades.join('; '),
    r.estado.label, r.gmv, r.mom, r.dAbs, r.yoy, r.tend, r.ord, r.aov, r.mkd, r.roas, r.ts]
    .map(v => typeof v === 'number' ? (isFinite(v) ? v.toFixed(2) : '') : q(v)).join(','));
  const csv = '﻿' + head.join(',') + '\n' + body.join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `cuentas_${D.meta.ultimo_cerrado}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

init();
