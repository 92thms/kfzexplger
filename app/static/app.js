'use strict';

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  year: '',
  category: '',
  hsn: '',
  hersteller: '',
  tsn: '',
  handelsname: '',
  searchQ: '',
};

// ── Chart instances ──────────────────────────────────────────────────────────

const charts = {};

// ── Colors ───────────────────────────────────────────────────────────────────

const CAT_COLORS = {
  KFZ:              '#00c8ff',
  NFZ:              '#7c5cfc',
  KRAD:             '#00e5a0',
  'Anhänger':       '#ffb347',
  Landwirtschaft:   '#4ade80',
  Sonderkraftfahrzeug: '#f87171',
};

const PALETTE = [
  '#00c8ff','#7c5cfc','#00e5a0','#ffb347','#4ade80','#f87171',
  '#38bdf8','#a78bfa','#34d399','#fb923c','#86efac','#fca5a5',
  '#67e8f9','#c4b5fd','#6ee7b7',
];

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Chart defaults ───────────────────────────────────────────────────────────

Chart.defaults.color = '#545870';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size = 11;

function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a1e2a',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        padding: 10,
        titleColor: '#e8eaf2',
        bodyColor: '#8b90a4',
        callbacks: {},
      },
    },
    ...extra,
  };
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function api(path, params = {}) {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== null && v !== undefined) url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

function fmt(n) {
  if (n == null) return '–';
  return Number(n).toLocaleString('de-DE');
}

// ── Destroy & recreate chart ─────────────────────────────────────────────────

function mkChart(id, type, data, options) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  const ctx = document.getElementById(id).getContext('2d');
  charts[id] = new Chart(ctx, { type, data, options });
  return charts[id];
}

// ── Stats strip ──────────────────────────────────────────────────────────────

async function loadStats() {
  const data = await api('/api/stats');
  const yearData = state.year
    ? data.by_year.find(r => r.year === +state.year)
    : { total: data.by_year.reduce((s, r) => s + r.total, 0) };
  document.getElementById('chip-total-val').textContent = fmt(yearData?.total ?? 0);
  document.getElementById('chip-mfr-val').textContent = fmt(data.total_manufacturers);
  document.getElementById('chip-models-val').textContent = fmt(data.total_models);
}

// ── Trend chart ──────────────────────────────────────────────────────────────

async function loadTrend() {
  const params = {
    hsn: state.hsn,
    tsn: state.tsn,
    manufacturer: state.hersteller,
    model: state.handelsname,
    category: state.category,
  };
  const data = await api('/api/chart/yearly-trend', params);
  const years = data.map(r => r.year);
  const vals  = data.map(r => r.total);
  const color = state.category ? (CAT_COLORS[state.category] || '#00c8ff') : '#00c8ff';

  const gradient = charts['chart-trend']
    ? null
    : (() => {
        const ctx = document.getElementById('chart-trend').getContext('2d');
        const g = ctx.createLinearGradient(0, 0, 0, 240);
        g.addColorStop(0, hexToRgba(color, 0.3));
        g.addColorStop(1, hexToRgba(color, 0.01));
        return g;
      })();

  const ctx2 = document.getElementById('chart-trend').getContext('2d');
  const g2 = ctx2.createLinearGradient(0, 0, 0, 240);
  g2.addColorStop(0, hexToRgba(color, 0.25));
  g2.addColorStop(1, hexToRgba(color, 0.01));

  mkChart('chart-trend', 'line', {
    labels: years,
    datasets: [{
      data: vals,
      borderColor: color,
      backgroundColor: g2,
      borderWidth: 2,
      pointRadius: 4,
      pointBackgroundColor: color,
      pointBorderColor: '#090b10',
      pointBorderWidth: 2,
      fill: true,
      tension: 0.4,
    }],
  }, baseOptions({
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#545870' } },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: {
          color: '#545870',
          callback: v => fmt(v),
        },
      },
    },
    plugins: {
      ...baseOptions().plugins,
      tooltip: {
        ...baseOptions().plugins.tooltip,
        callbacks: { label: ctx => ` ${fmt(ctx.parsed.y)} Fahrzeuge` },
      },
    },
  }));
}

// ── Category donut ───────────────────────────────────────────────────────────

async function loadCatDonut() {
  const data = await api('/api/chart/category-distribution', { year: state.year });
  const total = data.reduce((s, r) => s + r.total, 0);
  document.getElementById('donut-total-val').textContent = fmt(total);
  document.getElementById('cat-year-label').textContent =
    state.year ? `Jahr ${state.year}` : 'Alle Jahre';

  mkChart('chart-cat', 'doughnut', {
    labels: data.map(r => r.label),
    datasets: [{
      data: data.map(r => r.total),
      backgroundColor: data.map(r => hexToRgba(CAT_COLORS[r.kategorie] || '#00c8ff', 0.85)),
      borderColor: data.map(r => CAT_COLORS[r.kategorie] || '#00c8ff'),
      borderWidth: 1.5,
      hoverOffset: 6,
    }],
  }, {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '72%',
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          color: '#8b90a4',
          font: { size: 10 },
          padding: 10,
          boxWidth: 10,
          boxHeight: 10,
        },
      },
      tooltip: {
        backgroundColor: '#1a1e2a',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        callbacks: {
          label: ctx => ` ${fmt(ctx.parsed)} (${((ctx.parsed/total)*100).toFixed(1)}%)`,
        },
      },
    },
  });
}

// ── Top manufacturers bar ────────────────────────────────────────────────────

async function loadTopMfr() {
  const data = await api('/api/chart/top-manufacturers', {
    year: state.year,
    category: state.category,
    limit: 15,
  });
  const labels = data.map(r => r.hersteller.length > 20 ? r.hersteller.slice(0,18)+'…' : r.hersteller);
  const vals   = data.map(r => r.total);

  mkChart('chart-mfr', 'bar', {
    labels,
    datasets: [{
      data: vals,
      backgroundColor: vals.map((_, i) => hexToRgba(PALETTE[i % PALETTE.length], 0.7)),
      borderColor: vals.map((_, i) => PALETTE[i % PALETTE.length]),
      borderWidth: 1,
      borderRadius: 4,
      borderSkipped: false,
    }],
  }, baseOptions({
    indexAxis: 'y',
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#545870', callback: v => fmt(v) },
      },
      y: { grid: { display: false }, ticks: { color: '#8b90a4', font: { size: 10.5 } } },
    },
    plugins: {
      ...baseOptions().plugins,
      tooltip: {
        ...baseOptions().plugins.tooltip,
        callbacks: { label: ctx => ` ${fmt(ctx.parsed.x)} Fahrzeuge` },
      },
    },
    onClick: (evt, els) => {
      if (!els.length) return;
      const idx = els[0].index;
      const full = data[idx];
      selectManufacturer(full.hersteller);
    },
  }));
}

// ── Top models bar ───────────────────────────────────────────────────────────

async function loadTopModels() {
  const data = await api('/api/chart/top-models', {
    year: state.year,
    manufacturer: state.hersteller,
    hsn: state.hsn,
    category: state.category,
    limit: 15,
  });
  const labels = data.map(r => {
    const label = r.handelsname || r.tsn;
    return label.length > 22 ? label.slice(0,20)+'…' : label;
  });
  const vals = data.map(r => r.total);
  const color = state.category ? (CAT_COLORS[state.category] || '#7c5cfc') : '#7c5cfc';

  mkChart('chart-models', 'bar', {
    labels,
    datasets: [{
      data: vals,
      backgroundColor: hexToRgba(color, 0.55),
      borderColor: color,
      borderWidth: 1,
      borderRadius: 4,
      borderSkipped: false,
    }],
  }, baseOptions({
    scales: {
      x: { grid: { display: false }, ticks: { color: '#8b90a4', font: { size: 10 }, maxRotation: 35 } },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#545870', callback: v => fmt(v) },
      },
    },
    plugins: {
      ...baseOptions().plugins,
      tooltip: {
        ...baseOptions().plugins.tooltip,
        callbacks: { label: ctx => ` ${fmt(ctx.parsed.y)} Fahrzeuge` },
      },
    },
  }));
}

// ── Category trends line ─────────────────────────────────────────────────────

async function loadCatTrends() {
  const data = await api('/api/chart/category-trends');
  const categories = [...new Set(data.map(r => r.kategorie))];
  const years = [...new Set(data.map(r => r.year))].sort();

  const datasets = categories.map(cat => {
    const color = CAT_COLORS[cat] || '#aaa';
    const catData = years.map(y => {
      const row = data.find(r => r.kategorie === cat && r.year === y);
      return row ? row.total : 0;
    });
    return {
      label: cat,
      data: catData,
      borderColor: color,
      backgroundColor: hexToRgba(color, 0.08),
      borderWidth: 1.5,
      pointRadius: 3,
      pointBackgroundColor: color,
      fill: false,
      tension: 0.35,
    };
  });

  mkChart('chart-cat-trends', 'line', {
    labels: years,
    datasets,
  }, {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#545870' } },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#545870', callback: v => fmt(v) },
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { color: '#8b90a4', font: { size: 10.5 }, padding: 14, boxWidth: 12, boxHeight: 12 },
      },
      tooltip: {
        backgroundColor: '#1a1e2a',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` },
      },
    },
  });
}

// ── Search results table ─────────────────────────────────────────────────────

let searchTimer = null;

async function runSearch(q) {
  const wrap = document.getElementById('search-results');
  if (!q && !state.hersteller && !state.hsn) {
    wrap.innerHTML = '<div class="table-placeholder">Suchbegriff eingeben oder Filter wählen</div>';
    return;
  }
  wrap.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>Suche…</span></div>';
  try {
    const data = await api('/api/search', {
      q: q || state.hersteller || '',
      category: state.category,
      year: state.year,
      limit: 50,
    });
    if (!data.length) {
      wrap.innerHTML = '<div class="table-placeholder">Keine Ergebnisse</div>';
      return;
    }
    wrap.innerHTML = renderTable(data);
  } catch(e) {
    wrap.innerHTML = `<div class="table-placeholder">Fehler: ${e.message}</div>`;
  }
}

function renderTable(rows) {
  const head = `<thead><tr>
    <th>HSN</th><th>TSN</th><th>Hersteller</th><th>Handelsname</th>
    <th>Kategorie</th><th style="text-align:right">Fahrzeuge</th>
  </tr></thead>`;
  const body = rows.map(r => {
    const cat = r.kategorie || '';
    const badgeCls = 'badge badge-' + cat.toLowerCase().replace(/[äöü]/g, c => ({ä:'ae',ö:'oe',ü:'ue'}[c]));
    return `<tr>
      <td class="monospace">${r.hsn}</td>
      <td class="monospace">${r.tsn}</td>
      <td class="bold" title="${r.hersteller}">${r.hersteller}</td>
      <td title="${r.handelsname}">${r.handelsname || '–'}</td>
      <td><span class="${badgeCls}">${cat}</span></td>
      <td class="num">${fmt(r.total)}</td>
    </tr>`;
  }).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

// ── Manufacturer autocomplete ────────────────────────────────────────────────

async function fetchManufacturerSuggestions(q) {
  return api('/api/manufacturers', { q, category: state.category, year: state.year, limit: 12 });
}

async function fetchModelSuggestions(q) {
  return api('/api/models', {
    q,
    hsn: state.hsn,
    manufacturer: state.hersteller,
    category: state.category,
    year: state.year,
    limit: 12,
  });
}

function openDropdown(el) { el.classList.add('open'); }
function closeDropdown(el) { el.classList.remove('open'); }

function setupAutocomplete(inputId, dropdownId, fetchFn, onSelect) {
  const input = document.getElementById(inputId);
  const dd = document.getElementById(dropdownId);
  let timer = null;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 1) { closeDropdown(dd); return; }
    timer = setTimeout(async () => {
      const results = await fetchFn(q);
      if (!results.length) { closeDropdown(dd); return; }
      dd.innerHTML = results.map(r => {
        const main = r.hersteller || `${r.hersteller} · ${r.handelsname}`;
        const sub = r.handelsname
          ? `${r.hersteller} · ${fmt(r.total)} Fz.`
          : `HSN ${r.hsn} · ${fmt(r.total)} Fz.`;
        return `<div class="dropdown-item" data-value="${encodeURIComponent(JSON.stringify(r))}">
          <span class="di-main">${main}${r.handelsname ? ' — '+r.handelsname : ''}</span>
          <span class="di-sub">${sub}</span>
        </div>`;
      }).join('');
      openDropdown(dd);
      dd.querySelectorAll('.dropdown-item').forEach(el => {
        el.addEventListener('mousedown', e => {
          e.preventDefault();
          const r = JSON.parse(decodeURIComponent(el.dataset.value));
          onSelect(r);
          input.value = '';
          closeDropdown(dd);
        });
      });
    }, 250);
  });

  input.addEventListener('blur', () => setTimeout(() => closeDropdown(dd), 200));
}

function selectManufacturer(name, hsn) {
  state.hersteller = name;
  state.hsn = hsn || '';
  document.getElementById('active-manufacturer-label').textContent =
    hsn ? `${name} (HSN ${hsn})` : name;
  document.getElementById('active-manufacturer').classList.remove('hidden');
  updateBreadcrumb();
  refresh();
}

function clearManufacturer() {
  state.hersteller = '';
  state.hsn = '';
  state.handelsname = '';
  state.tsn = '';
  document.getElementById('active-manufacturer').classList.add('hidden');
  document.getElementById('active-model').classList.add('hidden');
  updateBreadcrumb();
  refresh();
}

function selectModel(name, tsn) {
  state.handelsname = name;
  state.tsn = tsn || '';
  document.getElementById('active-model-label').textContent =
    tsn ? `${name} (TSN ${tsn})` : name;
  document.getElementById('active-model').classList.remove('hidden');
  updateBreadcrumb();
  refresh();
}

function clearModel() {
  state.handelsname = '';
  state.tsn = '';
  document.getElementById('active-model').classList.add('hidden');
  updateBreadcrumb();
  refresh();
}

// ── Breadcrumb ───────────────────────────────────────────────────────────────

function updateBreadcrumb() {
  const bcMfr  = document.getElementById('bc-mfr');
  const bcModel = document.getElementById('bc-model');
  document.getElementById('bc-mfr-name').textContent = state.hersteller;
  document.getElementById('bc-model-name').textContent = state.handelsname;
  bcMfr.classList.toggle('hidden', !state.hersteller);
  bcModel.classList.toggle('hidden', !state.handelsname);

  const sub = [
    state.year ? `${state.year}` : '',
    state.category || '',
  ].filter(Boolean).join(' · ');
  document.getElementById('trend-subtitle').textContent =
    sub || 'Zugelassene Fahrzeuge je Jahr';
  document.getElementById('mfr-subtitle').textContent =
    state.category ? `Kategorie: ${state.category}` : 'nach Bestand';
  document.getElementById('models-subtitle').textContent =
    state.hersteller ? state.hersteller : 'nach Bestand';
}

// ── Pill handlers ────────────────────────────────────────────────────────────

function setupPills(groupId, stateKey, onChange) {
  document.getElementById(groupId).addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    document.querySelectorAll(`#${groupId} .pill`).forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state[stateKey] = pill.dataset.value;
    onChange();
  });
}

// ── Main refresh ─────────────────────────────────────────────────────────────

async function refresh() {
  updateBreadcrumb();
  await Promise.all([
    loadStats().catch(console.error),
    loadTrend().catch(console.error),
    loadCatDonut().catch(console.error),
    loadTopMfr().catch(console.error),
    loadTopModels().catch(console.error),
  ]);
  if (state.hersteller || state.hsn || state.searchQ) {
    runSearch(state.searchQ).catch(console.error);
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

  // Pill filters
  setupPills('year-pills', 'year', refresh);
  setupPills('cat-pills', 'category', refresh);

  // Clear buttons
  document.getElementById('clear-manufacturer').addEventListener('click', clearManufacturer);
  document.getElementById('clear-model').addEventListener('click', clearModel);

  // Manufacturer autocomplete
  setupAutocomplete('hsn-input', 'hsn-dropdown', fetchManufacturerSuggestions, r => {
    selectManufacturer(r.hersteller, r.hsn);
  });

  // Model autocomplete
  setupAutocomplete('tsn-input', 'tsn-dropdown', fetchModelSuggestions, r => {
    selectModel(r.handelsname || r.tsn, r.tsn);
  });

  // Global search
  const globalSearch = document.getElementById('global-search');
  globalSearch.addEventListener('input', () => {
    state.searchQ = globalSearch.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(state.searchQ), 350);
  });

  // Initial load
  await Promise.all([
    refresh(),
    loadCatTrends().catch(console.error),
  ]);
});
