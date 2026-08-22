# Odoo Dashboard Proxy

This is a small [Cloudflare Worker](https://workers.cloudflare.com/) that sits
between the static dashboards in this repo and your Odoo instance.

**This is optional.** The dashboards can also connect straight to Odoo from
the browser (see "Option A" in the root README) — no deployment needed, but
it requires enabling CORS on your Odoo server and the API key lives in
whoever's browser configures it. Use this Worker instead if you can't (or
don't want to) change Odoo's CORS config, e.g. on Odoo Online SaaS.

**Why a proxy at all?** GitHub Pages only serves static files — there's no
server to keep secrets on. If the dashboards called Odoo directly from the
browser with an API key baked into the page source, that key (and the sales/
P&L/inventory data behind it) would be visible to anyone who opens the page
and views source. This Worker holds the Odoo API key as a server-side secret
and only ever returns pre-aggregated report numbers (totals, top-10 lists,
monthly trends) — never raw records or the key itself.

**Important caveat:** this is still a *public* static site. The `PROXY_TOKEN`
shipped in the dashboard pages' source is a light deterrent against casual
scraping, not real authentication — anyone with the token can call these
report endpoints. If these numbers are sensitive, put this Worker behind
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
(free for small teams) so only your logged-in team can reach it, or host the
dashboards somewhere with real login instead of GitHub Pages.

## 1. Get an Odoo API key

In Odoo: **Settings → Users & Companies → Users** → open the user the
dashboards should read as → **Account Security** tab → **New API Key**.
Use a dedicated read-only-ish user if possible (Odoo API keys inherit that
user's access rights and record rules).

## 2. Deploy the Worker

```bash
cd odoo-proxy
npm install -g wrangler   # if you don't have it
wrangler login
wrangler deploy
```

Then set the secrets (you'll be prompted for each value):

```bash
wrangler secret put ODOO_URL       # e.g. https://your-odoo-host.example.com (no trailing slash)
wrangler secret put ODOO_DB        # Odoo database name
wrangler secret put ODOO_USERNAME  # the login/email that owns the API key
wrangler secret put ODOO_API_KEY   # the API key from step 1
wrangler secret put PROXY_TOKEN    # any long random string, e.g. `openssl rand -hex 32`
wrangler secret put ALLOWED_ORIGIN # https://pyaephyoips.github.io
```

`wrangler deploy` prints the Worker's URL, e.g.
`https://odoo-dashboard-proxy.<your-subdomain>.workers.dev`.

If your Odoo instance is self-hosted behind a firewall, make sure it's
reachable over HTTPS from Cloudflare's network (i.e. it has a public HTTPS
endpoint) — the Worker calls it the same way a browser would, just from
Cloudflare's servers instead of the visitor's.

## 3. Point the dashboards at your Worker

Open `assets/odoo-dashboard.js` in the repo root and set:

```js
const ODOO_PROXY_CONFIG = {
  baseUrl: 'https://odoo-dashboard-proxy.<your-subdomain>.workers.dev',
  token: '<the same PROXY_TOKEN you set above>',
};
```

Commit that change and the dashboards (`sales-dashboard.html`,
`financial-dashboard.html`, `inventory-dashboard.html`,
`purchase-dashboard.html`, `manufacturing-dashboard.html`) will start
pulling live data.

## Endpoints

All endpoints require the header `X-Proxy-Token: <PROXY_TOKEN>` (or a
`?token=` query param) and return JSON.

| Endpoint             | Query params           | Returns                                   |
|----------------------|-------------------------|--------------------------------------------|
| `/api/sales`         | `months` (default 12)   | Sales KPIs, monthly trend, top products/customers/salespeople |
| `/api/financials`    | `date_from`, `date_to`  | Simplified P&L and Balance Sheet           |
| `/api/inventory`     | —                        | Stock value, low-stock list, value by category, movement counts |
| `/api/purchase`      | `months` (default 12)   | Purchase KPIs, monthly trend, top suppliers/products |
| `/api/manufacturing` | `months` (default 12)   | MO counts by state, monthly trend, top produced items |

## Notes on the numbers

- `/api/financials` derives Revenue/COGS/Opex/Assets/Liabilities/Equity by
  summing `account.move.line` balances grouped by `account_type`. This is a
  reasonable approximation but is **not** a substitute for Odoo's built-in
  Accounting → Reporting → Balance Sheet / Profit and Loss, which account
  for things like multi-currency, analytic rules, and prior-year retained
  earnings more precisely. Reconcile before using these for filings.
- `/api/inventory` values stock as `quantity × standard_price` when the
  Odoo version doesn't expose `stock.quant.value` directly.
