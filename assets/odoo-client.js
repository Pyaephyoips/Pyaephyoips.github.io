/**
 * Direct-to-Odoo client (no backend/proxy required).
 *
 * Calls Odoo's /jsonrpc endpoint straight from the browser using an API key
 * you enter once — it's stored ONLY in this browser's localStorage
 * (`odoo_direct_config`), never written into the site's source and never
 * sent anywhere except your own Odoo server.
 *
 * Trade-off vs. the Cloudflare proxy in odoo-proxy/: this mode requires your
 * Odoo server to send CORS headers allowing this site's origin, because the
 * browser is calling Odoo cross-origin. Odoo does not do this by default —
 * see "Enabling CORS on Odoo" in the root README for an nginx snippet. If
 * you don't control the Odoo server's web-facing config, use the Cloudflare
 * proxy instead (it doesn't need Odoo-side CORS changes).
 *
 * The report-building logic here mirrors odoo-proxy/worker.js exactly, just
 * running in the browser instead of on a server.
 */

const ODOO_DIRECT_STORAGE_KEY = 'odoo_direct_config';

function getDirectConfig() {
  try {
    const raw = localStorage.getItem(ODOO_DIRECT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDirectConfig(cfg) {
  localStorage.setItem(ODOO_DIRECT_STORAGE_KEY, JSON.stringify(cfg));
}

function clearDirectConfig() {
  localStorage.removeItem(ODOO_DIRECT_STORAGE_KEY);
}

// ── Odoo JSON-RPC helpers (browser-side) ─────────────────────────────────
async function directJsonRpc(cfg, service, method, args) {
  let res;
  try {
    res = await fetch(`${cfg.url.replace(/\/$/, '')}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args },
        id: Math.floor(Math.random() * 1e9),
      }),
    });
  } catch (e) {
    throw new Error(
      `Could not reach ${cfg.url}. This usually means CORS isn't enabled on your ` +
      `Odoo server for this site's origin — see "Enabling CORS on Odoo" in the README.`
    );
  }
  const rawText = await res.text();
  let body;
  try {
    body = JSON.parse(rawText);
  } catch (e) {
    const snippet = rawText.replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(
      `Odoo returned a non-JSON response (HTTP ${res.status}) instead of a JSON-RPC result. ` +
      `This usually means the request wasn't routed to Odoo's /jsonrpc endpoint (check the ` +
      `nginx location block) or Odoo returned an error page. Response started with: "${snippet}"`
    );
  }
  if (body.error) {
    throw new Error(body.error.data?.message || body.error.message || 'Odoo RPC error');
  }
  return body.result;
}

async function directAuthenticate(cfg) {
  const uid = await directJsonRpc(cfg, 'common', 'authenticate', [cfg.db, cfg.username, cfg.apiKey, {}]);
  if (!uid) throw new Error('Odoo authentication failed — check database, username, and API key.');
  return uid;
}

async function directExecuteKw(cfg, uid, model, method, args = [], kwargs = {}) {
  return directJsonRpc(cfg, 'object', 'execute_kw', [cfg.db, uid, cfg.apiKey, model, method, args, kwargs]);
}

async function directReadGroup(cfg, uid, model, domain, fields, groupby, opts = {}) {
  return directExecuteKw(cfg, uid, model, 'read_group', [domain, fields, groupby], opts);
}

async function directSearchRead(cfg, uid, model, domain, fields, opts = {}) {
  return directExecuteKw(cfg, uid, model, 'search_read', [domain, fields], opts);
}

async function directSearchCount(cfg, uid, model, domain) {
  return directExecuteKw(cfg, uid, model, 'search_count', [domain]);
}

// ── Date helpers ──────────────────────────────────────────────────────────
function directIsoDate(d) { return d.toISOString().slice(0, 10); }
function directMonthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return directIsoDate(d);
}
function directToday() { return directIsoDate(new Date()); }

// ── Report builders (mirrors odoo-proxy/worker.js) ───────────────────────
const DIRECT_PL_INCOME_TYPES = ['income', 'income_other'];
const DIRECT_PL_COGS_TYPES = ['expense_direct_cost'];
const DIRECT_PL_OPEX_TYPES = ['expense', 'expense_depreciation'];
const DIRECT_BS_ASSET_TYPES = ['asset_receivable', 'asset_cash', 'asset_current', 'asset_non_current', 'asset_fixed', 'asset_prepayments'];
const DIRECT_BS_LIABILITY_TYPES = ['liability_payable', 'liability_current', 'liability_non_current', 'liability_credit_card'];
const DIRECT_BS_EQUITY_TYPES = ['equity', 'equity_unaffected'];

async function directBuildSalesReport(cfg, uid, params) {
  const months = Math.min(parseInt(params.months || '12', 10), 36);
  const dateFrom = directMonthsAgo(months - 1);
  const soldStates = ['sale', 'done'];

  const [totals, monthly, byProduct, byCustomer, bySalesperson, pendingCount] = await Promise.all([
    directReadGroup(cfg, uid, 'sale.order', [['state', 'in', soldStates], ['date_order', '>=', dateFrom]], ['amount_total'], []),
    directReadGroup(cfg, uid, 'sale.order', [['state', 'in', soldStates], ['date_order', '>=', dateFrom]], ['amount_total'], ['date_order:month']),
    directReadGroup(cfg, uid, 'sale.order.line', [['order_id.state', 'in', soldStates], ['order_id.date_order', '>=', dateFrom], ['display_type', '=', false]], ['price_subtotal', 'product_uom_qty'], ['product_id'], { orderby: 'price_subtotal desc', limit: 10 }),
    directReadGroup(cfg, uid, 'sale.order', [['state', 'in', soldStates], ['date_order', '>=', dateFrom]], ['amount_total'], ['partner_id'], { orderby: 'amount_total desc', limit: 10 }),
    directReadGroup(cfg, uid, 'sale.order', [['state', 'in', soldStates], ['date_order', '>=', dateFrom]], ['amount_total'], ['user_id'], { orderby: 'amount_total desc', limit: 10 }),
    directSearchCount(cfg, uid, 'sale.order', [['state', 'in', ['draft', 'sent']]]),
  ]);

  const totalSales = totals[0]?.amount_total || 0;
  const orderCount = totals[0]?.__count || 0;

  return {
    kpis: {
      total_sales: totalSales,
      order_count: orderCount,
      avg_order_value: orderCount ? totalSales / orderCount : 0,
      pending_quotations: pendingCount,
    },
    monthly_trend: monthly.map(r => ({ month: r['date_order:month'], total: r.amount_total, count: r.__count })),
    top_products: byProduct.map(r => ({ product: r.product_id ? r.product_id[1] : 'Unknown', total: r.price_subtotal, qty: r.product_uom_qty })),
    top_customers: byCustomer.map(r => ({ customer: r.partner_id ? r.partner_id[1] : 'Unknown', total: r.amount_total, count: r.__count })),
    by_salesperson: bySalesperson.map(r => ({ salesperson: r.user_id ? r.user_id[1] : 'Unassigned', total: r.amount_total, count: r.__count })),
  };
}

async function directBuildFinancialsReport(cfg, uid, params) {
  const dateFrom = params.date_from || directMonthsAgo(11);
  const dateTo = params.date_to || directToday();

  const [plGroups, bsGroups] = await Promise.all([
    directReadGroup(cfg, uid, 'account.move.line',
      [['parent_state', '=', 'posted'], ['date', '>=', dateFrom], ['date', '<=', dateTo],
       ['account_id.account_type', 'in', [...DIRECT_PL_INCOME_TYPES, ...DIRECT_PL_COGS_TYPES, ...DIRECT_PL_OPEX_TYPES]]],
      ['balance'], ['account_id.account_type']),
    directReadGroup(cfg, uid, 'account.move.line',
      [['parent_state', '=', 'posted'], ['date', '<=', dateTo],
       ['account_id.account_type', 'in', [...DIRECT_BS_ASSET_TYPES, ...DIRECT_BS_LIABILITY_TYPES, ...DIRECT_BS_EQUITY_TYPES]]],
      ['balance'], ['account_id.account_type']),
  ]);

  const sumByTypes = (groups, types) => groups
    .filter(g => types.includes(g['account_id.account_type']))
    .reduce((s, g) => s + (g.balance || 0), 0);

  const revenue = -sumByTypes(plGroups, DIRECT_PL_INCOME_TYPES);
  const cogs = sumByTypes(plGroups, DIRECT_PL_COGS_TYPES);
  const opex = sumByTypes(plGroups, DIRECT_PL_OPEX_TYPES);
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - opex;

  const assets = sumByTypes(bsGroups, DIRECT_BS_ASSET_TYPES);
  const liabilities = -sumByTypes(bsGroups, DIRECT_BS_LIABILITY_TYPES);
  const equity = -sumByTypes(bsGroups, DIRECT_BS_EQUITY_TYPES);

  return {
    period: { date_from: dateFrom, date_to: dateTo },
    profit_and_loss: { revenue, cogs, gross_profit: grossProfit, operating_expenses: opex, net_profit: netProfit },
    balance_sheet: {
      as_of: dateTo, assets, liabilities,
      equity: equity + netProfit,
      liabilities_and_equity: liabilities + equity + netProfit,
    },
    note: 'Simplified approximation from account.move.line balances grouped by account type. ' +
          'Verify against Odoo Accounting > Reporting > Balance Sheet / Profit and Loss for audited figures.',
  };
}

async function directBuildInventoryReport(cfg, uid) {
  const internalDomain = [['location_id.usage', '=', 'internal']];

  let byProduct;
  let hasValueField = true;
  try {
    byProduct = await directReadGroup(cfg, uid, 'stock.quant', internalDomain, ['quantity', 'value'], ['product_id']);
  } catch (e) {
    hasValueField = false;
    byProduct = await directReadGroup(cfg, uid, 'stock.quant', internalDomain, ['quantity'], ['product_id']);
  }

  let totalValue = 0;
  let enriched = byProduct;
  if (!hasValueField && byProduct.length) {
    const productIds = byProduct.map(r => r.product_id[0]);
    const products = await directExecuteKw(cfg, uid, 'product.product', 'read', [productIds, ['standard_price', 'categ_id']]);
    const priceById = Object.fromEntries(products.map(p => [p.id, p.standard_price]));
    const categById = Object.fromEntries(products.map(p => [p.id, p.categ_id ? p.categ_id[1] : 'Uncategorized']));
    enriched = byProduct.map(r => {
      const price = priceById[r.product_id[0]] || 0;
      const value = r.quantity * price;
      totalValue += value;
      return { ...r, value, categ: categById[r.product_id[0]] };
    });
  } else {
    totalValue = byProduct.reduce((s, r) => s + (r.value || 0), 0);
    const productIds = byProduct.map(r => r.product_id[0]);
    if (productIds.length) {
      const products = await directExecuteKw(cfg, uid, 'product.product', 'read', [productIds, ['categ_id']]);
      const categById = Object.fromEntries(products.map(p => [p.id, p.categ_id ? p.categ_id[1] : 'Uncategorized']));
      enriched = byProduct.map(r => ({ ...r, categ: categById[r.product_id[0]] }));
    }
  }

  const byCategory = {};
  for (const r of enriched) {
    const cat = r.categ || 'Uncategorized';
    byCategory[cat] = (byCategory[cat] || 0) + (r.value || 0);
  }

  const topByValue = [...enriched]
    .sort((a, b) => (b.value || 0) - (a.value || 0))
    .slice(0, 10)
    .map(r => ({ product: r.product_id[1], quantity: r.quantity, value: r.value || 0 }));

  const [lowStock, last30In, last30Out] = await Promise.all([
    directSearchRead(cfg, uid, 'stock.warehouse.orderpoint', [['qty_to_order', '>', 0]], ['product_id', 'qty_to_order', 'product_min_qty'], { limit: 20 }),
    directSearchCount(cfg, uid, 'stock.move', [['state', '=', 'done'], ['date', '>=', directMonthsAgo(1)], ['picking_type_id.code', '=', 'incoming']]),
    directSearchCount(cfg, uid, 'stock.move', [['state', '=', 'done'], ['date', '>=', directMonthsAgo(1)], ['picking_type_id.code', '=', 'outgoing']]),
  ]);

  return {
    kpis: {
      total_inventory_value: totalValue,
      distinct_products_on_hand: enriched.length,
      low_stock_items: lowStock.length,
      moves_last_30d_in: last30In,
      moves_last_30d_out: last30Out,
    },
    value_by_category: Object.entries(byCategory).map(([category, value]) => ({ category, value })),
    top_by_value: topByValue,
    low_stock: lowStock.map(r => ({
      product: r.product_id ? r.product_id[1] : 'Unknown',
      to_order: r.qty_to_order,
      min_qty: r.product_min_qty,
    })),
  };
}

async function directBuildPurchaseReport(cfg, uid, params) {
  const months = Math.min(parseInt(params.months || '12', 10), 36);
  const dateFrom = directMonthsAgo(months - 1);
  const purchasedStates = ['purchase', 'done'];

  const [totals, monthly, byProduct, bySupplier, pendingCount] = await Promise.all([
    directReadGroup(cfg, uid, 'purchase.order', [['state', 'in', purchasedStates], ['date_order', '>=', dateFrom]], ['amount_total'], []),
    directReadGroup(cfg, uid, 'purchase.order', [['state', 'in', purchasedStates], ['date_order', '>=', dateFrom]], ['amount_total'], ['date_order:month']),
    directReadGroup(cfg, uid, 'purchase.order.line', [['order_id.state', 'in', purchasedStates], ['order_id.date_order', '>=', dateFrom], ['display_type', '=', false]], ['price_subtotal', 'product_qty'], ['product_id'], { orderby: 'price_subtotal desc', limit: 10 }),
    directReadGroup(cfg, uid, 'purchase.order', [['state', 'in', purchasedStates], ['date_order', '>=', dateFrom]], ['amount_total'], ['partner_id'], { orderby: 'amount_total desc', limit: 10 }),
    directSearchCount(cfg, uid, 'purchase.order', [['state', 'in', ['draft', 'sent', 'to approve']]]),
  ]);

  const totalSpend = totals[0]?.amount_total || 0;
  const orderCount = totals[0]?.__count || 0;

  return {
    kpis: {
      total_spend: totalSpend,
      order_count: orderCount,
      avg_order_value: orderCount ? totalSpend / orderCount : 0,
      pending_orders: pendingCount,
    },
    monthly_trend: monthly.map(r => ({ month: r['date_order:month'], total: r.amount_total, count: r.__count })),
    top_products: byProduct.map(r => ({ product: r.product_id ? r.product_id[1] : 'Unknown', total: r.price_subtotal, qty: r.product_qty })),
    top_suppliers: bySupplier.map(r => ({ supplier: r.partner_id ? r.partner_id[1] : 'Unknown', total: r.amount_total, count: r.__count })),
  };
}

async function directBuildManufacturingReport(cfg, uid, params) {
  const months = Math.min(parseInt(params.months || '12', 10), 36);
  const dateFrom = directMonthsAgo(months - 1);

  const [byState, monthly, byProduct, delayedCount] = await Promise.all([
    directReadGroup(cfg, uid, 'mrp.production', [['date_start', '>=', dateFrom]], ['product_qty'], ['state']),
    directReadGroup(cfg, uid, 'mrp.production', [['date_start', '>=', dateFrom], ['state', '!=', 'cancel']], ['product_qty'], ['date_start:month']),
    directReadGroup(cfg, uid, 'mrp.production', [['state', '=', 'done'], ['date_start', '>=', dateFrom]], ['product_qty', 'qty_produced'], ['product_id'], { orderby: 'qty_produced desc', limit: 10 }),
    directSearchCount(cfg, uid, 'mrp.production', [['date_planned_start', '<', directToday()], ['state', 'not in', ['done', 'cancel']]]),
  ]);

  return {
    kpis: {
      total_orders: byState.reduce((s, r) => s + r.__count, 0),
      done: byState.find(r => r.state === 'done')?.__count || 0,
      in_progress: byState.find(r => r.state === 'progress')?.__count || 0,
      delayed: delayedCount,
    },
    by_state: byState.map(r => ({ state: r.state, count: r.__count })),
    monthly_trend: monthly.map(r => ({ month: r['date_start:month'], count: r.__count, qty: r.product_qty })),
    top_products: byProduct.map(r => ({ product: r.product_id ? r.product_id[1] : 'Unknown', qty_produced: r.qty_produced })),
  };
}

async function fetchOdooReportDirect(path, params, cfg) {
  const uid = await directAuthenticate(cfg);
  switch (path) {
    case '/api/sales': return directBuildSalesReport(cfg, uid, params);
    case '/api/financials': return directBuildFinancialsReport(cfg, uid, params);
    case '/api/inventory': return directBuildInventoryReport(cfg, uid);
    case '/api/purchase': return directBuildPurchaseReport(cfg, uid, params);
    case '/api/manufacturing': return directBuildManufacturingReport(cfg, uid, params);
    default: throw new Error(`Unknown report path: ${path}`);
  }
}
