/**
 * Shared client for the Odoo dashboard pages.
 *
 * All dashboards call the Cloudflare Worker proxy in odoo-proxy/ instead of
 * Odoo directly (the proxy holds the Odoo API key server-side — see
 * odoo-proxy/README.md for why and how to deploy it).
 *
 * Fill in baseUrl/token below once your proxy is deployed. Until then, every
 * dashboard shows a setup banner instead of trying (and failing) to fetch.
 */
const ODOO_PROXY_CONFIG = {
  baseUrl: 'https://www.waihinmyanmarmart.com/', // e.g. 'https://odoo-dashboard-proxy.<your-subdomain>.workers.dev'
  token: '4e82bd3a741003e1796b82925262071026a2d570',   // the PROXY_TOKEN secret you set on the Worker
};

function odooProxyConfigured() {
  return Boolean(ODOO_PROXY_CONFIG.baseUrl && ODOO_PROXY_CONFIG.token);
}

async function fetchOdooReport(path, params = {}) {
  if (!odooProxyConfigured()) {
    throw new Error('SETUP_REQUIRED');
  }
  const url = new URL(ODOO_PROXY_CONFIG.baseUrl.replace(/\/$/, '') + path);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
  const res = await fetch(url.toString(), {
    headers: { 'X-Proxy-Token': ODOO_PROXY_CONFIG.token },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

// ── Formatting ──────────────────────────────────────────────────────────
function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtCompact(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}
function fmtInt(n) { return (Number(n) || 0).toLocaleString('en-US'); }

// ── State banner (loading / error / setup) ──────────────────────────────
function showState(containerId, kind, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.style.display = 'flex';
  if (kind === 'loading') {
    el.className = 'state-banner';
    el.innerHTML = `<span class="spinner"></span> ${message || 'Loading from Odoo…'}`;
  } else if (kind === 'error') {
    el.className = 'state-banner error';
    el.innerHTML = `⚠️ ${message}`;
  } else {
    el.style.display = 'none';
  }
}

function renderSetupNote(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `
    <strong>⚙️ Connect this dashboard to Odoo</strong><br><br>
    This page pulls data through a small proxy so your Odoo API key never
    ships to the browser. To wire it up:
    <ol style="margin:0.5rem 0 0 1.25rem;padding:0">
      <li>Deploy the Cloudflare Worker in <code>odoo-proxy/</code> (see its README).</li>
      <li>Open <code>assets/odoo-dashboard.js</code> and set <code>ODOO_PROXY_CONFIG.baseUrl</code> and <code>.token</code>.</li>
      <li>Reload this page.</li>
    </ol>`;
}

// ── KPI row ──────────────────────────────────────────────────────────────
function renderKpis(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.map(k => `
    <div class="kpi">
      <div class="label">${k.label}</div>
      <div class="value ${k.cls || ''}">${k.value}</div>
    </div>
  `).join('');
}

// ── Ranked horizontal bar list (top products/customers/suppliers/etc) ────
function renderRankBars(containerId, rows, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!rows.length) { el.innerHTML = `<div class="empty-state">No data for this period</div>`; return; }
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 1);
  el.innerHTML = rows.map(r => {
    const color = opts.colorFn ? opts.colorFn(r) : null;
    return `
    <div class="rank-bar-row">
      <div class="rank-bar-label" title="${r.label}">${r.label}</div>
      <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${Math.round(Math.abs(r.value) / max * 100)}%${color ? `;background:${color}` : ''}"></div></div>
      <div class="rank-bar-val"${color ? ` style="color:${color}"` : ''}>${opts.prefix || ''}${r.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}${opts.suffix || ''}</div>
    </div>`;
  }).join('');
}

// ── Generic table ──────────────────────────────────────────────────────
function renderTable(bodyId, rows, renderRow, colspan) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${colspan || 5}" class="empty-state">No entries</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(renderRow).join('');
}

// ── Line/area trend chart (SVG) ──────────────────────────────────────────
function renderTrendChart(svgId, points, opts = {}) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  const W = svg.clientWidth || 600, H = 160;
  if (points.length < 2) {
    svg.innerHTML = `<text x="50%" y="50%" fill="#94a3b8" font-size="13" text-anchor="middle" dominant-baseline="middle">Not enough data yet</text>`;
    return;
  }
  const vals = points.map(p => p.value);
  const minV = Math.min(0, ...vals), maxV = Math.max(1, ...vals);
  const range = maxV - minV || 1;
  const pad = { l: 10, r: 10, t: 10, b: 26 };
  const xStep = (W - pad.l - pad.r) / (points.length - 1);
  const yScale = v => pad.t + (1 - (v - minV) / range) * (H - pad.t - pad.b);
  const zero = yScale(0);
  const color = opts.color || '#22c55e';
  const pts = vals.map((v, i) => `${pad.l + i * xStep},${yScale(v)}`).join(' ');
  const area = `${pad.l},${zero} ` + pts + ` ${pad.l + (points.length - 1) * xStep},${zero}`;
  const gradId = svgId + 'Grad';
  svg.innerHTML = `
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
    </linearGradient></defs>
    <line x1="${pad.l}" y1="${zero}" x2="${W - pad.r}" y2="${zero}" stroke="#334155" stroke-width="1"/>
    <polygon points="${area}" fill="url(#${gradId})"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    ${vals.map((v, i) => `<circle cx="${pad.l + i * xStep}" cy="${yScale(v)}" r="3" fill="${color}"/>`).join('')}
    ${points.map((p, i) => `<text x="${pad.l + i * xStep}" y="${H - 6}" fill="#94a3b8" font-size="10" text-anchor="middle">${p.label}</text>`).join('')}
  `;
}
