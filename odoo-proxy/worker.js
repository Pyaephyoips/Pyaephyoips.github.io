/**
 * Odoo Dashboard Proxy — Cloudflare Worker
 *
 * Holds the Odoo API key server-side and exposes a small set of read-only,
 * pre-aggregated report endpoints for the static dashboards in this repo.
 * The dashboards never talk to Odoo directly (avoids CORS issues and never
 * ships the Odoo API key to the browser).
 *
 * Required secrets/vars (set with `wrangler secret put <NAME>` or in the
 * Cloudflare dashboard — see README.md in this folder):
 *   ODOO_URL       e.g. https://your-odoo-host.example.com  (no trailing slash)
 *   ODOO_DB        Odoo database name
 *   ODOO_USERNAME  Odoo login (email) the API key belongs to
 *   ODOO_API_KEY   Odoo API key (Settings > Users > this user > API Keys)
 *   PROXY_TOKEN    A random string only your dashboard pages know, required
 *                  on every request via the X-Proxy-Token header. This does
 *                  NOT make the endpoint private (it's a public static site,
 *                  the token ships in the page source) — it only stops
 *                  casual scraping/link-sharing. Put this Worker behind
 *                  Cloudflare Access if you need real access control.
 *   ALLOWED_ORIGIN e.g. https://pyaephyoips.github.io  (CORS allow-list)
 */

const PL_INCOME_TYPES = ['income', 'income_other'];
const PL_COGS_TYPES = ['expense_direct_cost'];
const PL_OPEX_TYPES = ['expense', 'expense_depreciation'];
const BS_ASSET_TYPES = [
  'asset_receivable', 'asset_cash', 'asset_current',
  'asset_non_current', 'asset_fixed', 'asset_prepayments',
];
const BS_LIABILITY_TYPES = [
  'liability_payable', 'liability_current', 'liability_non_current', 'liability_credit_card',
];
const BS_EQUITY_TYPES = ['equity', 'equity_unaffected'];

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Token',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

// ── Odoo JSON-RPC helpers ──────────────────────────────────────────────
async function jsonRpc(env, service, method, args) {
  const res = await fetch(`${env.ODOO_URL}/jsonrpc`, {
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

async function odooAuthenticate(env) {
  const uid = await jsonRpc(env, 'common', 'authenticate', [
    env.ODOO_DB, env.ODOO_USERNAME, env.ODOO_API_KEY, {},
  ]);
  if (!uid) throw new Error('Odoo authentication failed — check ODOO_DB/ODOO_USERNAME/ODOO_API_KEY');
  return uid;
}

async function executeKw(env, uid, model, method, args = [], kwargs = {}) {
  return jsonRpc(env, 'object', 'execute_kw', [
    env.ODOO_DB, uid, env.ODOO_API_KEY, model, method, args, kwargs,
  ]);
}

async function readGroup(env, uid, model, domain, fields, groupby, opts = {}) {
  return executeKw(env, uid, model, 'read_group', [domain, fields, groupby], opts);
}

async function searchRead(env, uid, model, domain, fields, opts = {}) {
  return executeKw(env, uid, model, 'search_read', [domain, fields], opts);
}

async function searchCount(env, uid, model, domain) {
  return executeKw(env, uid, model, 'search_count', [domain]);
}

// ── Date helpers ────────────────────────────────────────────────────────
function isoDate(d) { return d.toISOString().slice(0, 10); }
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return isoDate(d);
}
function today() { return isoDate(new Date()); }

// ── Report builders ─────────────────────────────────────────────────────
async function buildSalesReport(env, uid, params) {
  const months = Math.min(parseInt(params.get('months') || '12', 10), 36);
  const dateFrom = monthsAgo(months - 1);
  const soldStates = ['sale', 'done'];

  const [totals, monthly, byProduct, byCustomer, bySalesperson, pendingCount] = await Promise.all([
    readGroup(env, uid, 'sale.order',
      [['state', 'in', soldStates], ['date_order', '>=', dateFrom]],
      ['amount_total'], []),
    readGroup(env, uid, 'sale.order',
      [['state', 'in', soldStates], ['date_order', '>=', dateFrom]],
      ['amount_total'], ['date_order:month']),
    readGroup(env, uid, 'sale.order.line',
      [['order_id.state', 'in', soldStates], ['order_id.date_order', '>=', dateFrom], ['display_type', '=', false]],
      ['price_subtotal', 'product_uom_qty'], ['product_id'], { orderby: 'price_subtotal desc', limit: 10 }),
    readGroup(env, uid, 'sale.order',
      [['state', 'in', soldStates], ['date_order', '>=', dateFrom]],
      ['amount_total'], ['partner_id'], { orderby: 'amount_total desc', limit: 10 }),
    readGroup(env, uid, 'sale.order',
      [['state', 'in', soldStates], ['date_order', '>=', dateFrom]],
      ['amount_total'], ['user_id'], { orderby: 'amount_total desc', limit: 10 }),
    searchCount(env, uid, 'sale.order', [['state', 'in', ['draft', 'sent']]]),
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

async function buildFinancialsReport(env, uid, params) {
  const dateFrom = params.get('date_from') || monthsAgo(11);
  const dateTo = params.get('date_to') || today();

  // Group by account_id only (not the related account_type) — some Odoo
  // versions reject filtering/grouping account.move.line by a dotted
  // account_id.account_type path ("Property name ... has to be used on a
  // property field"). account_type is read directly from account.account
  // below instead, which is always a plain field access.
  const [plByAccount, bsByAccount] = await Promise.all([
    readGroup(env, uid, 'account.move.line',
      [['parent_state', '=', 'posted'], ['date', '>=', dateFrom], ['date', '<=', dateTo]],
      ['balance'], ['account_id']),
    readGroup(env, uid, 'account.move.line',
      [['parent_state', '=', 'posted'], ['date', '<=', dateTo]],
      ['balance'], ['account_id']),
  ]);

  const accountIds = [...new Set(
    [...plByAccount, ...bsByAccount].filter(g => g.account_id).map(g => g.account_id[0])
  )];
  const accounts = accountIds.length
    ? await executeKw(env, uid, 'account.account', 'read', [accountIds, ['account_type']])
    : [];
  const typeById = Object.fromEntries(accounts.map(a => [a.id, a.account_type]));

  const sumByTypes = (groups, types) => groups
    .filter(g => g.account_id && types.includes(typeById[g.account_id[0]]))
    .reduce((s, g) => s + (g.balance || 0), 0);

  const revenue = -sumByTypes(plByAccount, PL_INCOME_TYPES);
  const cogs = sumByTypes(plByAccount, PL_COGS_TYPES);
  const opex = sumByTypes(plByAccount, PL_OPEX_TYPES);
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - opex;

  const assets = sumByTypes(bsByAccount, BS_ASSET_TYPES);
  const liabilities = -sumByTypes(bsByAccount, BS_LIABILITY_TYPES);
  const equity = -sumByTypes(bsByAccount, BS_EQUITY_TYPES);

  return {
    period: { date_from: dateFrom, date_to: dateTo },
    profit_and_loss: { revenue, cogs, gross_profit: grossProfit, operating_expenses: opex, net_profit: netProfit },
    balance_sheet: {
      as_of: dateTo, assets, liabilities,
      equity: equity + netProfit, // approximate: fold current-period earnings into equity
      liabilities_and_equity: liabilities + equity + netProfit,
    },
    note: 'Simplified approximation from account.move.line balances grouped by account type. ' +
          'Verify against Odoo Accounting > Reporting > Balance Sheet / Profit and Loss for audited figures.',
  };
}

async function buildInventoryReport(env, uid) {
  const internalDomain = [['location_id.usage', '=', 'internal']];

  let byProduct;
  let hasValueField = true;
  try {
    byProduct = await readGroup(env, uid, 'stock.quant', internalDomain, ['quantity', 'value'], ['product_id']);
  } catch (e) {
    hasValueField = false;
    byProduct = await readGroup(env, uid, 'stock.quant', internalDomain, ['quantity'], ['product_id']);
  }

  let totalValue = 0;
  let enriched = byProduct;
  if (!hasValueField && byProduct.length) {
    const productIds = byProduct.map(r => r.product_id[0]);
    const products = await executeKw(env, uid, 'product.product', 'read', [productIds, ['standard_price', 'categ_id']]);
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
      const products = await executeKw(env, uid, 'product.product', 'read', [productIds, ['categ_id']]);
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
    searchRead(env, uid, 'stock.warehouse.orderpoint',
      [['qty_to_order', '>', 0]], ['product_id', 'qty_to_order', 'product_min_qty'], { limit: 20 }),
    searchCount(env, uid, 'stock.move',
      [['state', '=', 'done'], ['date', '>=', monthsAgo(1)], ['picking_type_id.code', '=', 'incoming']]),
    searchCount(env, uid, 'stock.move',
      [['state', '=', 'done'], ['date', '>=', monthsAgo(1)], ['picking_type_id.code', '=', 'outgoing']]),
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

async function buildPurchaseReport(env, uid, params) {
  const months = Math.min(parseInt(params.get('months') || '12', 10), 36);
  const dateFrom = monthsAgo(months - 1);
  const purchasedStates = ['purchase', 'done'];

  const [totals, monthly, byProduct, bySupplier, pendingCount] = await Promise.all([
    readGroup(env, uid, 'purchase.order',
      [['state', 'in', purchasedStates], ['date_order', '>=', dateFrom]],
      ['amount_total'], []),
    readGroup(env, uid, 'purchase.order',
      [['state', 'in', purchasedStates], ['date_order', '>=', dateFrom]],
      ['amount_total'], ['date_order:month']),
    readGroup(env, uid, 'purchase.order.line',
      [['order_id.state', 'in', purchasedStates], ['order_id.date_order', '>=', dateFrom], ['display_type', '=', false]],
      ['price_subtotal', 'product_qty'], ['product_id'], { orderby: 'price_subtotal desc', limit: 10 }),
    readGroup(env, uid, 'purchase.order',
      [['state', 'in', purchasedStates], ['date_order', '>=', dateFrom]],
      ['amount_total'], ['partner_id'], { orderby: 'amount_total desc', limit: 10 }),
    searchCount(env, uid, 'purchase.order', [['state', 'in', ['draft', 'sent', 'to approve']]]),
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

async function buildManufacturingReport(env, uid, params) {
  const months = Math.min(parseInt(params.get('months') || '12', 10), 36);
  const dateFrom = monthsAgo(months - 1);

  const [byState, monthly, byProduct, delayedCount] = await Promise.all([
    readGroup(env, uid, 'mrp.production',
      [['date_start', '>=', dateFrom]], ['product_qty'], ['state']),
    readGroup(env, uid, 'mrp.production',
      [['date_start', '>=', dateFrom], ['state', '!=', 'cancel']],
      ['product_qty'], ['date_start:month']),
    readGroup(env, uid, 'mrp.production',
      [['state', '=', 'done'], ['date_start', '>=', dateFrom]],
      ['product_qty', 'qty_produced'], ['product_id'], { orderby: 'qty_produced desc', limit: 10 }),
    searchCount(env, uid, 'mrp.production',
      [['date_planned_start', '<', today()], ['state', 'not in', ['done', 'cancel']]]),
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

// ── Router ───────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    const token = request.headers.get('X-Proxy-Token') || url.searchParams.get('token');
    if (!env.PROXY_TOKEN || token !== env.PROXY_TOKEN) {
      return json(env, { error: 'Unauthorized' }, 401);
    }

    try {
      const uid = await odooAuthenticate(env);
      let result;
      switch (url.pathname) {
        case '/api/sales':
          result = await buildSalesReport(env, uid, url.searchParams);
          break;
        case '/api/financials':
          result = await buildFinancialsReport(env, uid, url.searchParams);
          break;
        case '/api/inventory':
          result = await buildInventoryReport(env, uid);
          break;
        case '/api/purchase':
          result = await buildPurchaseReport(env, uid, url.searchParams);
          break;
        case '/api/manufacturing':
          result = await buildManufacturingReport(env, uid, url.searchParams);
          break;
        default:
          return json(env, { error: 'Not found' }, 404);
      }
      return json(env, result);
    } catch (err) {
      return json(env, { error: err.message || String(err) }, 500);
    }
  },
};
