/**
 * Scheduled sync: pulls the default view of every Odoo report into
 * Firestore so the dashboards can load instantly without hitting Odoo
 * (and without shipping an Odoo API key to the browser).
 *
 * Dashboards still fall back to a live Odoo call (proxy or direct, see
 * odoo-proxy/worker.js / assets/odoo-client.js) for any period, custom
 * date range, or explicit refresh that isn't this cached default view.
 */
'use strict';

const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const { authenticate } = require('./odoo');
const {
  buildCompaniesReport,
  buildSalesReport,
  buildFinancialsReport,
  buildInventoryReport,
  buildPurchaseReport,
  buildManufacturingReport,
  buildAccountingReport,
  buildWarehouseReport,
  buildInventoryMovementReport,
} = require('./reports');

admin.initializeApp();
const db = admin.firestore();

const ODOO_URL = defineSecret('ODOO_URL');
const ODOO_DB = defineSecret('ODOO_DB');
const ODOO_USERNAME = defineSecret('ODOO_USERNAME');
const ODOO_API_KEY = defineSecret('ODOO_API_KEY');
const SYNC_TOKEN = defineSecret('SYNC_TOKEN');

const REPORT_BUILDERS = {
  sales: buildSalesReport,
  financials: buildFinancialsReport,
  inventory: buildInventoryReport,
  purchase: buildPurchaseReport,
  manufacturing: buildManufacturingReport,
  accounting: buildAccountingReport,
  warehouse: buildWarehouseReport,
  inventoryMovement: buildInventoryMovementReport,
};

async function syncTarget(cfg, uid, key, companyId) {
  const entries = Object.entries(REPORT_BUILDERS);
  const results = await Promise.allSettled(entries.map(([, fn]) => fn(cfg, uid, companyId)));

  const doc = { updated_at: admin.firestore.FieldValue.serverTimestamp() };
  results.forEach((result, i) => {
    const [name] = entries[i];
    if (result.status === 'fulfilled') {
      doc[name] = result.value;
    } else {
      doc[name] = { _error: result.reason?.message || String(result.reason) };
    }
  });

  await db.collection('snapshots').doc(key).set(doc, { merge: false });
}

async function runSync(cfg) {
  const uid = await authenticate(cfg);

  const { companies } = await buildCompaniesReport(cfg, uid);
  await db.collection('meta').doc('companies').set({
    companies,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  const targets = [{ key: 'all', companyId: null }];
  if (companies.length > 1) {
    for (const c of companies) targets.push({ key: String(c.id), companyId: c.id });
  }

  for (const t of targets) {
    await syncTarget(cfg, uid, t.key, t.companyId);
  }
}

function cfgFromSecrets() {
  return {
    url: ODOO_URL.value(),
    db: ODOO_DB.value(),
    username: ODOO_USERNAME.value(),
    apiKey: ODOO_API_KEY.value(),
  };
}

exports.syncOdooToFirestore = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeoutSeconds: 300,
    memory: '512MiB',
    secrets: [ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY],
  },
  async () => {
    await runSync(cfgFromSecrets());
  }
);

exports.syncNow = onRequest(
  {
    timeoutSeconds: 300,
    memory: '512MiB',
    secrets: [ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, SYNC_TOKEN],
  },
  async (req, res) => {
    if (req.get('X-Sync-Token') !== SYNC_TOKEN.value()) {
      res.status(403).send('Forbidden');
      return;
    }
    try {
      await runSync(cfgFromSecrets());
      res.status(200).send('OK');
    } catch (err) {
      res.status(500).send(err.message || String(err));
    }
  }
);
