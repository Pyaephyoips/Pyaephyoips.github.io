/**
 * Shared client for the Odoo dashboard pages.
 *
 * Two connection modes, tried in this order:
 *  1. Cloudflare Worker proxy (ODOO_PROXY_CONFIG below) — most secure, the
 *     Odoo API key never reaches the browser. See odoo-proxy/README.md.
 *  2. Direct-to-Odoo (assets/odoo-client.js) — no backend to deploy, but
 *     needs CORS enabled on your Odoo server, and the API key is entered
 *     once and kept only in this browser's localStorage. See "Enabling
 *     CORS on Odoo" in the root README.
 *
 * If neither is configured, dashboards show a connect form instead of
 * trying (and failing) to fetch.
 */
const ODOO_PROXY_CONFIG = {
  baseUrl: '', // e.g. 'https://odoo-dashboard-proxy.<your-subdomain>.workers.dev'
  token: '',   // the PROXY_TOKEN secret you set on the Worker
};

function odooProxyConfigured() {
  return Boolean(ODOO_PROXY_CONFIG.baseUrl && ODOO_PROXY_CONFIG.token);
}

function odooConfigured() {
  return odooProxyConfigured() || Boolean(getDirectConfig());
}

// ── Multi-company ─────────────────────────────────────────────────────────
const ODOO_COMPANY_STORAGE_KEY = 'odoo_selected_company_id';

function getSelectedCompanyId() {
  return localStorage.getItem(ODOO_COMPANY_STORAGE_KEY) || '';
}

function setSelectedCompanyId(id) {
  if (id) localStorage.setItem(ODOO_COMPANY_STORAGE_KEY, id);
  else localStorage.removeItem(ODOO_COMPANY_STORAGE_KEY);
}

function onCompanyChange(id) {
  setSelectedCompanyId(id);
  if (typeof load === 'function') load();
}

// Fetches the company list and renders a <select> into containerId, with an
// "All Companies (Consolidated)" option alongside each individual company.
// Selecting one persists to localStorage (read by fetchOdooReport below)
// and re-runs the page's load() function, if it defines one.
async function renderCompanySwitcher(containerId) {
  const el = document.getElementById(containerId);
  if (!el || !odooConfigured()) return;
  try {
    const { companies } = await fetchOdooReport('/api/companies');
    if (!companies || companies.length < 2) { el.innerHTML = ''; return; }
    const current = getSelectedCompanyId();
    const options = ['<option value="">All Companies (Consolidated)</option>']
      .concat(companies.map(c => `<option value="${c.id}" ${String(c.id) === String(current) ? 'selected' : ''}>${c.name}</option>`));
    el.innerHTML = `<select class="company-select" onchange="onCompanyChange(this.value)">${options.join('')}</select>`;
  } catch (err) {
    // Non-fatal — leave the switcher empty (e.g. the Odoo user lacks
    // multi-company access); the reports themselves still work.
    el.innerHTML = '';
  }
}

async function fetchOdooReport(path, params = {}) {
  const companyId = getSelectedCompanyId();
  const finalParams = (companyId && params.company_id === undefined) ? { ...params, company_id: companyId } : params;
  if (odooProxyConfigured()) {
    const url = new URL(ODOO_PROXY_CONFIG.baseUrl.replace(/\/$/, '') + path);
    Object.entries(finalParams).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
    const res = await fetch(url.toString(), {
      headers: { 'X-Proxy-Token': ODOO_PROXY_CONFIG.token },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }
  const directCfg = getDirectConfig();
  if (directCfg) {
    return fetchOdooReportDirect(path, finalParams, directCfg);
  }
  throw new Error('SETUP_REQUIRED');
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
  const cfg = getDirectConfig() || {};
  el.innerHTML = `
    <strong>⚙️ Connect this dashboard to Odoo</strong>
    <p style="margin:0.5rem 0">
      Enter your Odoo connection details below. They're saved only in
      <em>this browser's</em> local storage — never written into the site's
      source and never sent anywhere except your own Odoo server.
    </p>
    <div class="connect-form">
      <input id="cfgUrl" placeholder="Odoo URL, e.g. https://your-odoo.example.com" value="${cfg.url || ''}">
      <input id="cfgDb" placeholder="Database name" value="${cfg.db || ''}">
      <input id="cfgUser" placeholder="Username / email" value="${cfg.username || ''}">
      <input id="cfgKey" type="password" placeholder="API key" value="${cfg.apiKey || ''}">
      <div style="display:flex;gap:0.5rem">
        <button class="btn-connect" onclick="saveDirectConfigFromForm()">Save &amp; Connect</button>
        ${cfg.url ? `<button class="btn-disconnect" onclick="clearDirectConfig();location.reload()">Disconnect</button>` : ''}
      </div>
    </div>
    <p style="margin-top:0.75rem;font-size:0.78rem">
      This requires your Odoo server to allow cross-origin requests from
      this site (CORS) — see "Enabling CORS on Odoo" in the repo's README.
      If you can't change the Odoo server's config, deploy the
      <a href="https://github.com/Pyaephyoips/Pyaephyoips.github.io/tree/main/odoo-proxy" target="_blank" rel="noreferrer">Cloudflare Worker proxy</a>
      instead — it avoids the CORS requirement entirely.
    </p>`;
}

function saveDirectConfigFromForm() {
  const cfg = {
    url: document.getElementById('cfgUrl').value.trim().replace(/\/$/, ''),
    db: document.getElementById('cfgDb').value.trim(),
    username: document.getElementById('cfgUser').value.trim(),
    apiKey: document.getElementById('cfgKey').value.trim(),
  };
  if (!cfg.url || !cfg.db || !cfg.username || !cfg.apiKey) {
    alert('Please fill in all fields.');
    return;
  }
  saveDirectConfig(cfg);
  location.reload();
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

// ── Sparkline (compact stat-tile trend) ──────────────────────────────────
function renderSparkline(svgId, values, opts = {}) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  const W = svg.clientWidth || 100, H = 32;
  if (!values || values.length < 2) { svg.innerHTML = ''; return; }
  const minV = Math.min(...values), maxV = Math.max(...values);
  const range = (maxV - minV) || 1;
  const pad = 3;
  const xStep = (W - pad * 2) / (values.length - 1);
  const yScale = v => pad + (1 - (v - minV) / range) * (H - pad * 2);
  const pts = values.map((v, i) => `${pad + i * xStep},${yScale(v)}`).join(' ');
  const lastX = pad + (values.length - 1) * xStep, lastY = yScale(values[values.length - 1]);
  const color = opts.color || '#38bdf8';
  svg.innerHTML = `
    <polyline points="${pts}" fill="none" stroke="#475569" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lastX}" cy="${lastY}" r="4" fill="${color}" stroke="#1e293b" stroke-width="2"/>
  `;
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
