/**
 * Odoo JSON-RPC helpers for the Cloud Functions sync job.
 *
 * Mirrors odoo-proxy/worker.js and assets/odoo-client.js exactly, just
 * running in Node (Cloud Functions runtime) instead of a Cloudflare Worker
 * or the browser. Node 18+ (this project targets Node 20) has a global
 * `fetch`, so no extra HTTP dependency is needed.
 */
'use strict';

async function jsonRpc(cfg, service, method, args) {
  const res = await fetch(`${cfg.url}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: Math.floor(Math.random() * 1e9),
    }),
  });
  const body = await res.json();
  if (body.error) {
    throw new Error(body.error.data?.message || body.error.message || 'Odoo RPC error');
  }
  return body.result;
}

async function authenticate(cfg) {
  const uid = await jsonRpc(cfg, 'common', 'authenticate', [cfg.db, cfg.username, cfg.apiKey, {}]);
  if (!uid) throw new Error('Odoo authentication failed — check ODOO_DB/ODOO_USERNAME/ODOO_API_KEY');
  return uid;
}

async function executeKw(cfg, uid, model, method, args = [], kwargs = {}) {
  return jsonRpc(cfg, 'object', 'execute_kw', [cfg.db, uid, cfg.apiKey, model, method, args, kwargs]);
}

async function readGroup(cfg, uid, model, domain, fields, groupby, opts = {}) {
  return executeKw(cfg, uid, model, 'read_group', [domain, fields, groupby], opts);
}

// Sort + cap read_group results client-side instead of passing `orderby` to
// Odoo — some Odoo versions reject ordering read_group by an aggregated
// measure ("Order term '<field> desc' is not a valid aggregate nor valid
// groupby"), so this avoids relying on that syntax at all.
function topN(groups, field, n = 10) {
  return [...groups].sort((a, b) => (b[field] || 0) - (a[field] || 0)).slice(0, n);
}

async function searchRead(cfg, uid, model, domain, fields, opts = {}) {
  return executeKw(cfg, uid, model, 'search_read', [domain, fields], opts);
}

async function searchCount(cfg, uid, model, domain) {
  return executeKw(cfg, uid, model, 'search_count', [domain]);
}

// Every model used by these reports (sale/purchase orders + lines,
// account.move.line, stock.quant/move/picking, mrp.production) carries its
// own direct company_id field, so a single leaf works everywhere — no
// dotted/related paths needed.
function withCompany(domain, companyId) {
  return companyId ? [...domain, ['company_id', '=', companyId]] : domain;
}

function isoDate(d) { return d.toISOString().slice(0, 10); }
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return isoDate(d);
}
function today() { return isoDate(new Date()); }
function startOfYear() { return `${new Date().getFullYear()}-01-01`; }

module.exports = {
  jsonRpc, authenticate, executeKw, readGroup, topN, searchRead, searchCount,
  withCompany, isoDate, monthsAgo, today, startOfYear,
};
