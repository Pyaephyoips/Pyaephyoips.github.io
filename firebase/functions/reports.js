/**
 * Report builders for the scheduled Odoo -> Firestore sync.
 *
 * sales/financials/inventory/purchase/manufacturing mirror
 * odoo-proxy/worker.js exactly (same Odoo queries, same shape), computed
 * with each dashboard's default view (12 trailing months for
 * sales/purchase/manufacturing, year-to-date for financials, a live
 * snapshot for inventory) since the sync has no per-viewer date range to
 * work from. Dashboards fall back to a live Odoo call (proxy or direct)
 * whenever someone picks a different period or custom date range.
 *
 * accounting and warehouse are new report types with no proxy/direct
 * equivalent history — see odoo-proxy/worker.js's buildAccountingReport /
 * buildWarehouseReport (added alongside this) for the browser-facing twin
 * used when Firestore isn't configured.
 */
'use strict';

const {
  executeKw, readGroup, topN, searchRead, searchCount,
  withCompany, monthsAgo, today, startOfYear,
} = require('./odoo');

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

async function buildCompaniesReport(cfg, uid) {
  const companies = await searchRead(cfg, uid, 'res.company', [], ['id', 'name'], { order: 'name' });
  return { companies };
}

async function buildSalesReport(cfg, uid, companyId) {
  const dateTo = today();
  const dateFrom = monthsAgo(11);
  const soldStates = ['sale', 'done'];

  const [totals, monthly, byProduct, byCustomer, bySalesperson, pendingCount] = await Promise.all([
    readGroup(cfg, uid, 'sale.order',
      withCompany([['state', 'in', soldStates], ['date_order', '>=', dateFrom], ['date_order', '<=', dateTo]], companyId),
      ['amount_total'], []),
    readGroup(cfg, uid, 'sale.order',
      withCompany([['state', 'in', soldStates], ['date_order', '>=', dateFrom], ['date_order', '<=', dateTo]], companyId),
      ['amount_total'], ['date_order:month']),
    readGroup(cfg, uid, 'sale.order.line',
      withCompany([['order_id.state', 'in', soldStates], ['order_id.date_order', '>=', dateFrom], ['order_id.date_order', '<=', dateTo], ['display_type', '=', false]], companyId),
      ['price_subtotal', 'product_uom_qty'], ['product_id']),
    readGroup(cfg, uid, 'sale.order',
      withCompany([['state', 'in', soldStates], ['date_order', '>=', dateFrom], ['date_order', '<=', dateTo]], companyId),
      ['amount_total'], ['partner_id']),
    readGroup(cfg, uid, 'sale.order',
      withCompany([['state', 'in', soldStates], ['date_order', '>=', dateFrom], ['date_order', '<=', dateTo]], companyId),
      ['amount_total'], ['user_id']),
    searchCount(cfg, uid, 'sale.order', withCompany([['state', 'in', ['draft', 'sent']]], companyId)),
  ]);

  const totalSales = totals[0]?.amount_total || 0;
  const orderCount = totals[0]?.__count || 0;

  const soldProductIds = byProduct.filter(r => r.product_id).map(r => r.product_id[0]);
  const soldProducts = soldProductIds.length
    ? await executeKw(cfg, uid, 'product.product', 'read', [soldProductIds, ['categ_id']])
    : [];
  const categById = Object.fromEntries(soldProducts.map(p => [p.id, p.categ_id ? p.categ_id[1] : 'Uncategorized']));

  const byCategory = {};
  for (const r of byProduct) {
    if (!r.product_id) continue;
    const cat = categById[r.product_id[0]] || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = { total: 0, qty: 0 };
    byCategory[cat].total += r.price_subtotal || 0;
    byCategory[cat].qty += r.product_uom_qty || 0;
  }

  return {
    period: { date_from: dateFrom, date_to: dateTo },
    kpis: {
      total_sales: totalSales,
      order_count: orderCount,
      avg_order_value: orderCount ? totalSales / orderCount : 0,
      pending_quotations: pendingCount,
    },
    monthly_trend: monthly.map(r => ({ month: r['date_order:month'], total: r.amount_total, count: r.__count })),
    top_products: topN(byProduct, 'price_subtotal').map(r => ({
      product: r.product_id ? r.product_id[1] : 'Unknown',
      category: r.product_id ? (categById[r.product_id[0]] || 'Uncategorized') : 'Uncategorized',
      total: r.price_subtotal, qty: r.product_uom_qty,
    })),
    by_category: Object.entries(byCategory)
      .map(([category, v]) => ({ category, total: v.total, qty: v.qty }))
      .sort((a, b) => b.total - a.total),
    top_customers: topN(byCustomer, 'amount_total').map(r => ({ customer: r.partner_id ? r.partner_id[1] : 'Unknown', total: r.amount_total, count: r.__count })),
    by_salesperson: topN(bySalesperson, 'amount_total').map(r => ({ salesperson: r.user_id ? r.user_id[1] : 'Unassigned', total: r.amount_total, count: r.__count })),
  };
}

async function buildFinancialsReport(cfg, uid, companyId) {
  // Year-to-date, matching the Financial dashboard's default "This Year"
  // period button.
  const dateFrom = startOfYear();
  const dateTo = today();

  const [plByAccount, bsByAccount] = await Promise.all([
    readGroup(cfg, uid, 'account.move.line',
      withCompany([['parent_state', '=', 'posted'], ['date', '>=', dateFrom], ['date', '<=', dateTo]], companyId),
      ['balance'], ['account_id']),
    readGroup(cfg, uid, 'account.move.line',
      withCompany([['parent_state', '=', 'posted'], ['date', '<=', dateTo]], companyId),
      ['balance'], ['account_id']),
  ]);

  const accountIds = [...new Set(
    [...plByAccount, ...bsByAccount].filter(g => g.account_id).map(g => g.account_id[0])
  )];
  const accounts = accountIds.length
    ? await executeKw(cfg, uid, 'account.account', 'read', [accountIds, ['account_type', 'code', 'name']])
    : [];
  const typeById = Object.fromEntries(accounts.map(a => [a.id, a.account_type]));
  const codeById = Object.fromEntries(accounts.map(a => [a.id, a.code || '']));
  const nameById = Object.fromEntries(accounts.map(a => [a.id, a.name || 'Unknown']));

  const sumByTypes = (groups, types) => groups
    .filter(g => g.account_id && types.includes(typeById[g.account_id[0]]))
    .reduce((s, g) => s + (g.balance || 0), 0);

  const detailByTypes = (groups, types, negate) => groups
    .filter(g => g.account_id && types.includes(typeById[g.account_id[0]]))
    .map(g => ({
      account_id: g.account_id[0],
      code: codeById[g.account_id[0]],
      account: nameById[g.account_id[0]],
      balance: negate ? -(g.balance || 0) : (g.balance || 0),
    }))
    .filter(r => Math.abs(r.balance) > 0.005)
    .sort((a, b) => b.balance - a.balance);

  const revenue = -sumByTypes(plByAccount, PL_INCOME_TYPES);
  const cogs = sumByTypes(plByAccount, PL_COGS_TYPES);
  const opex = sumByTypes(plByAccount, PL_OPEX_TYPES);
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - opex;

  const assets = sumByTypes(bsByAccount, BS_ASSET_TYPES);
  const liabilities = -sumByTypes(bsByAccount, BS_LIABILITY_TYPES);
  const equity = -sumByTypes(bsByAccount, BS_EQUITY_TYPES);

  const byType = {};
  for (const t of [...BS_ASSET_TYPES, ...BS_LIABILITY_TYPES, ...BS_EQUITY_TYPES]) {
    const raw = sumByTypes(bsByAccount, [t]);
    byType[t] = BS_ASSET_TYPES.includes(t) ? raw : -raw;
  }

  return {
    period: { date_from: dateFrom, date_to: dateTo },
    profit_and_loss: { revenue, cogs, gross_profit: grossProfit, operating_expenses: opex, net_profit: netProfit },
    pl_detail: {
      revenue: detailByTypes(plByAccount, PL_INCOME_TYPES, true),
      cogs: detailByTypes(plByAccount, PL_COGS_TYPES, false),
      opex: detailByTypes(plByAccount, PL_OPEX_TYPES, false),
    },
    balance_sheet: {
      as_of: dateTo, assets, liabilities,
      equity: equity + netProfit,
      liabilities_and_equity: liabilities + equity + netProfit,
      by_type: byType,
    },
    note: 'Simplified approximation from account.move.line balances grouped by account type. ' +
          'Verify against Odoo Accounting > Reporting > Balance Sheet / Profit and Loss for audited figures.',
  };
}

async function buildInventoryReport(cfg, uid, companyId) {
  const internalDomain = withCompany([['location_id.usage', '=', 'internal']], companyId);
  const byProduct = await readGroup(cfg, uid, 'stock.quant', internalDomain, ['quantity'], ['product_id']);

  let totalValue = 0;
  const productIds = byProduct.filter(r => r.product_id).map(r => r.product_id[0]);
  const products = productIds.length
    ? await executeKw(cfg, uid, 'product.product', 'read', [productIds, ['standard_price', 'categ_id']])
    : [];
  const priceById = Object.fromEntries(products.map(p => [p.id, p.standard_price]));
  const categById = Object.fromEntries(products.map(p => [p.id, p.categ_id ? p.categ_id[1] : 'Uncategorized']));
  const enriched = byProduct.filter(r => r.product_id).map(r => {
    const price = priceById[r.product_id[0]] || 0;
    const value = r.quantity * price;
    totalValue += value;
    return { ...r, value, categ: categById[r.product_id[0]] };
  });

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
    searchRead(cfg, uid, 'stock.warehouse.orderpoint',
      withCompany([['qty_to_order', '>', 0]], companyId), ['product_id', 'qty_to_order', 'product_min_qty'], { limit: 20 }),
    searchCount(cfg, uid, 'stock.move',
      withCompany([['state', '=', 'done'], ['date', '>=', monthsAgo(1)], ['picking_type_id.code', '=', 'incoming']], companyId)),
    searchCount(cfg, uid, 'stock.move',
      withCompany([['state', '=', 'done'], ['date', '>=', monthsAgo(1)], ['picking_type_id.code', '=', 'outgoing']], companyId)),
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

async function buildPurchaseReport(cfg, uid, companyId) {
  const dateTo = today();
  const dateFrom = monthsAgo(11);
  const purchasedStates = ['purchase', 'done'];

  const [totals, monthly, byProduct, bySupplier, pendingCount] = await Promise.all([
    readGroup(cfg, uid, 'purchase.order',
      withCompany([['state', 'in', purchasedStates], ['date_order', '>=', dateFrom], ['date_order', '<=', dateTo]], companyId),
      ['amount_total'], []),
    readGroup(cfg, uid, 'purchase.order',
      withCompany([['state', 'in', purchasedStates], ['date_order', '>=', dateFrom], ['date_order', '<=', dateTo]], companyId),
      ['amount_total'], ['date_order:month']),
    readGroup(cfg, uid, 'purchase.order.line',
      withCompany([['order_id.state', 'in', purchasedStates], ['order_id.date_order', '>=', dateFrom], ['order_id.date_order', '<=', dateTo], ['display_type', '=', false]], companyId),
      ['price_subtotal', 'product_qty'], ['product_id']),
    readGroup(cfg, uid, 'purchase.order',
      withCompany([['state', 'in', purchasedStates], ['date_order', '>=', dateFrom], ['date_order', '<=', dateTo]], companyId),
      ['amount_total'], ['partner_id']),
    searchCount(cfg, uid, 'purchase.order', withCompany([['state', 'in', ['draft', 'sent', 'to approve']]], companyId)),
  ]);

  const totalSpend = totals[0]?.amount_total || 0;
  const orderCount = totals[0]?.__count || 0;

  return {
    period: { date_from: dateFrom, date_to: dateTo },
    kpis: {
      total_spend: totalSpend,
      order_count: orderCount,
      avg_order_value: orderCount ? totalSpend / orderCount : 0,
      pending_orders: pendingCount,
    },
    monthly_trend: monthly.map(r => ({ month: r['date_order:month'], total: r.amount_total, count: r.__count })),
    top_products: topN(byProduct, 'price_subtotal').map(r => ({ product: r.product_id ? r.product_id[1] : 'Unknown', total: r.price_subtotal, qty: r.product_qty })),
    top_suppliers: topN(bySupplier, 'amount_total').map(r => ({ supplier: r.partner_id ? r.partner_id[1] : 'Unknown', total: r.amount_total, count: r.__count })),
  };
}

async function buildManufacturingReport(cfg, uid, companyId) {
  const dateTo = today();
  const dateFrom = monthsAgo(11);

  const [byState, monthly, byProduct, delayedCount] = await Promise.all([
    readGroup(cfg, uid, 'mrp.production',
      withCompany([['date_start', '>=', dateFrom], ['date_start', '<=', dateTo]], companyId), ['product_qty'], ['state']),
    readGroup(cfg, uid, 'mrp.production',
      withCompany([['date_start', '>=', dateFrom], ['date_start', '<=', dateTo], ['state', '!=', 'cancel']], companyId),
      ['product_qty'], ['date_start:month']),
    readGroup(cfg, uid, 'mrp.production',
      withCompany([['state', '=', 'done'], ['date_start', '>=', dateFrom], ['date_start', '<=', dateTo]], companyId),
      ['product_qty', 'qty_produced'], ['product_id']),
    searchCount(cfg, uid, 'mrp.production',
      withCompany([['date_start', '<', today()], ['state', 'not in', ['done', 'cancel']]], companyId)),
  ]);

  return {
    period: { date_from: dateFrom, date_to: dateTo },
    kpis: {
      total_orders: byState.reduce((s, r) => s + r.__count, 0),
      done: byState.find(r => r.state === 'done')?.__count || 0,
      in_progress: byState.find(r => r.state === 'progress')?.__count || 0,
      delayed: delayedCount,
    },
    by_state: byState.map(r => ({ state: r.state, count: r.__count })),
    monthly_trend: monthly.map(r => ({ month: r['date_start:month'], count: r.__count, qty: r.product_qty })),
    top_products: topN(byProduct, 'qty_produced').map(r => ({ product: r.product_id ? r.product_id[1] : 'Unknown', qty_produced: r.qty_produced })),
  };
}

function ageBucket(dateStr, dueStr) {
  const due = dueStr || dateStr;
  if (!due) return 'current';
  const days = Math.floor((new Date(today()) - new Date(due)) / 86400000);
  if (days <= 0) return 'current';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return 'over_90';
}

function buildAging(lines) {
  const buckets = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, over_90: 0 };
  const byPartner = {};
  for (const l of lines) {
    const amt = Math.abs(l.amount_residual || 0);
    const bucket = ageBucket(l.date, l.date_maturity);
    buckets[bucket] += amt;
    const partner = l.partner_id ? l.partner_id[1] : 'Unknown';
    byPartner[partner] = (byPartner[partner] || 0) + amt;
  }
  const total = Object.values(buckets).reduce((s, v) => s + v, 0);
  const overdue = total - buckets.current;
  const top = Object.entries(byPartner)
    .map(([partner, amount]) => ({ partner, total: amount }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  return { total, overdue, buckets, top };
}

async function buildAccountingReport(cfg, uid, companyId) {
  const [receivableAccounts, payableAccounts] = await Promise.all([
    searchRead(cfg, uid, 'account.account', [['account_type', '=', 'asset_receivable']], ['id']),
    searchRead(cfg, uid, 'account.account', [['account_type', '=', 'liability_payable']], ['id']),
  ]);
  const receivableIds = receivableAccounts.map(a => a.id);
  const payableIds = payableAccounts.map(a => a.id);

  const openLineFields = ['partner_id', 'amount_residual', 'date_maturity', 'date'];
  const [arLines, apLines, journalActivity] = await Promise.all([
    receivableIds.length
      ? searchRead(cfg, uid, 'account.move.line',
          withCompany([['account_id', 'in', receivableIds], ['parent_state', '=', 'posted'], ['reconciled', '=', false], ['amount_residual', '!=', 0]], companyId),
          openLineFields, { limit: 2000 })
      : [],
    payableIds.length
      ? searchRead(cfg, uid, 'account.move.line',
          withCompany([['account_id', 'in', payableIds], ['parent_state', '=', 'posted'], ['reconciled', '=', false], ['amount_residual', '!=', 0]], companyId),
          openLineFields, { limit: 2000 })
      : [],
    readGroup(cfg, uid, 'account.move',
      withCompany([['state', '=', 'posted'], ['date', '>=', monthsAgo(0)]], companyId), ['amount_total'], ['move_type']),
  ]);

  return {
    as_of: today(),
    receivables: buildAging(arLines),
    payables: buildAging(apLines),
    journal_activity_this_month: journalActivity.map(r => ({ move_type: r.move_type, total: r.amount_total, count: r.__count })),
    note: 'Aging is estimated from open (unreconciled) account.move.line residuals, bucketed by ' +
          'days past the due date (or entry date when no due date is set).',
  };
}

async function buildWarehouseReport(cfg, uid, companyId) {
  const warehouses = await searchRead(cfg, uid, 'stock.warehouse', withCompany([], companyId), ['id', 'name', 'code']);

  const internalDomain = withCompany([['location_id.usage', '=', 'internal']], companyId);
  const quants = await searchRead(cfg, uid, 'stock.quant', internalDomain, ['warehouse_id', 'product_id', 'quantity'], { limit: 20000 });

  const productIds = [...new Set(quants.filter(q => q.product_id).map(q => q.product_id[0]))];
  const products = productIds.length
    ? await executeKw(cfg, uid, 'product.product', 'read', [productIds, ['standard_price']])
    : [];
  const priceById = Object.fromEntries(products.map(p => [p.id, p.standard_price]));

  const byWarehouse = {};
  for (const q of quants) {
    const wh = q.warehouse_id ? q.warehouse_id[1] : 'Unassigned';
    const price = q.product_id ? (priceById[q.product_id[0]] || 0) : 0;
    if (!byWarehouse[wh]) byWarehouse[wh] = { quantity: 0, value: 0 };
    byWarehouse[wh].quantity += q.quantity || 0;
    byWarehouse[wh].value += (q.quantity || 0) * price;
  }

  const [transfersLast30, pendingTransfers] = await Promise.all([
    readGroup(cfg, uid, 'stock.picking',
      withCompany([['state', '=', 'done'], ['date_done', '>=', monthsAgo(1)]], companyId), [], ['picking_type_id']),
    searchCount(cfg, uid, 'stock.picking',
      withCompany([['state', 'in', ['confirmed', 'assigned', 'waiting']]], companyId)),
  ]);

  return {
    as_of: today(),
    warehouses: warehouses.map(w => ({ id: w.id, name: w.name, code: w.code })),
    by_warehouse: Object.entries(byWarehouse)
      .map(([warehouse, v]) => ({ warehouse, quantity: v.quantity, value: v.value }))
      .sort((a, b) => b.value - a.value),
    transfer_activity_last_30d: transfersLast30.map(r => ({ picking_type: r.picking_type_id ? r.picking_type_id[1] : 'Unknown', count: r.__count })),
    pending_transfers: pendingTransfers,
  };
}

// See buildInventoryMovementReport in odoo-proxy/worker.js for the full
// rationale behind each category's domain and the quantity field choice.
// Default period matches the Movement tab's default preset: trailing 12
// months.
async function buildInventoryMovementReport(cfg, uid, companyId) {
  const dateTo = today();
  const dateFrom = monthsAgo(11);
  const doneWindow = [['state', '=', 'done'], ['date', '>=', dateFrom], ['date', '<=', dateTo]];

  const grnDomain = withCompany([...doneWindow, ['picking_type_id.code', '=', 'incoming'], ['origin_returned_move_id', '=', false]], companyId);
  const ginDomain = withCompany([...doneWindow, ['picking_type_id.code', '=', 'outgoing'], ['origin_returned_move_id', '=', false]], companyId);
  const returnedDomain = withCompany([...doneWindow, ['origin_returned_move_id', '!=', false]], companyId);
  const adjustmentDomain = withCompany([
    ...doneWindow, ['picking_id', '=', false],
    '|', ['location_dest_id.usage', '=', 'inventory'], ['location_id.usage', '=', 'inventory'],
  ], companyId);
  const scrapDomain = withCompany([['state', '=', 'done'], ['date_done', '>=', dateFrom], ['date_done', '<=', dateTo]], companyId);

  const [
    grnTotals, grnMonthly, grnByProduct,
    ginTotals, ginMonthly, ginByProduct,
    returnedTotals, returnedMonthly,
    adjustmentTotals, adjustmentMonthly,
    scrapTotals, scrapMonthly, scrapByProduct,
  ] = await Promise.all([
    readGroup(cfg, uid, 'stock.move', grnDomain, ['product_qty'], []),
    readGroup(cfg, uid, 'stock.move', grnDomain, ['product_qty'], ['date:month']),
    readGroup(cfg, uid, 'stock.move', grnDomain, ['product_qty'], ['product_id']),
    readGroup(cfg, uid, 'stock.move', ginDomain, ['product_qty'], []),
    readGroup(cfg, uid, 'stock.move', ginDomain, ['product_qty'], ['date:month']),
    readGroup(cfg, uid, 'stock.move', ginDomain, ['product_qty'], ['product_id']),
    readGroup(cfg, uid, 'stock.move', returnedDomain, ['product_qty'], []),
    readGroup(cfg, uid, 'stock.move', returnedDomain, ['product_qty'], ['date:month']),
    readGroup(cfg, uid, 'stock.move', adjustmentDomain, ['product_qty'], []),
    readGroup(cfg, uid, 'stock.move', adjustmentDomain, ['product_qty'], ['date:month']),
    readGroup(cfg, uid, 'stock.scrap', scrapDomain, ['scrap_qty'], []),
    readGroup(cfg, uid, 'stock.scrap', scrapDomain, ['scrap_qty'], ['date_done:month']),
    readGroup(cfg, uid, 'stock.scrap', scrapDomain, ['scrap_qty'], ['product_id']),
  ]);

  const totals = (rows, field) => ({ count: rows[0]?.__count || 0, qty: rows[0]?.[field] || 0 });

  const monthMap = {};
  const addMonthly = (rows, key, dateKey, qtyField) => {
    for (const r of rows) {
      const month = r[dateKey];
      if (!month) continue;
      if (!monthMap[month]) monthMap[month] = { month, grn_qty: 0, gin_qty: 0, returned_qty: 0, scrap_qty: 0, adjustment_qty: 0 };
      monthMap[month][key] += r[qtyField] || 0;
    }
  };
  addMonthly(grnMonthly, 'grn_qty', 'date:month', 'product_qty');
  addMonthly(ginMonthly, 'gin_qty', 'date:month', 'product_qty');
  addMonthly(returnedMonthly, 'returned_qty', 'date:month', 'product_qty');
  addMonthly(adjustmentMonthly, 'adjustment_qty', 'date:month', 'product_qty');
  addMonthly(scrapMonthly, 'scrap_qty', 'date_done:month', 'scrap_qty');
  const monthlyTrend = Object.values(monthMap).sort((a, b) => new Date(a.month) - new Date(b.month));

  const productLabel = (rows, qtyField) => topN(rows, qtyField).map(r => ({
    product: r.product_id ? r.product_id[1] : 'Unknown', qty: r[qtyField],
  }));

  return {
    period: { date_from: dateFrom, date_to: dateTo },
    kpis: {
      grn: totals(grnTotals, 'product_qty'),
      gin: totals(ginTotals, 'product_qty'),
      returned: totals(returnedTotals, 'product_qty'),
      scrap: totals(scrapTotals, 'scrap_qty'),
      adjustment: totals(adjustmentTotals, 'product_qty'),
    },
    monthly_trend: monthlyTrend,
    top_received: productLabel(grnByProduct, 'product_qty'),
    top_issued: productLabel(ginByProduct, 'product_qty'),
    top_scrapped: productLabel(scrapByProduct, 'scrap_qty'),
    note: 'GRN = incoming receipts, GIN = outgoing issues, Returned = either direction where Odoo\'s ' +
          'return-tracking field marks a move as reversing an earlier one, Adjustment = stock changes with ' +
          'no transfer (counted-quantity corrections), Scrap = the Scrap Orders (stock.scrap) model. ' +
          'Quantities are each record\'s demand/counted quantity, not a valuation.',
  };
}

module.exports = {
  buildCompaniesReport,
  buildSalesReport,
  buildFinancialsReport,
  buildInventoryReport,
  buildPurchaseReport,
  buildManufacturingReport,
  buildAccountingReport,
  buildWarehouseReport,
  buildInventoryMovementReport,
};
