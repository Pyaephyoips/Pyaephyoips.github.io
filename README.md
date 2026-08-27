# Skybridge Business Solution Website

A static GitHub Pages site for Skybridge Business Solution.

## Files

- `index.html` contains the page structure and content.
- `style.css` contains the complete responsive design.
- `assets/skybridge-erp-hero.png` is the generated hero image.
- `pos.html` / `cashflow.html` are local-only demo tools (browser storage, no backend).
- `executive-dashboard.html`, `sales-dashboard.html`, `financial-dashboard.html`,
  `inventory-dashboard.html`, `purchase-dashboard.html`, `manufacturing-dashboard.html`
  are Odoo-backed ERP dashboards (see below).
- `odoo-course.html` is a full 8-week instructor-ready curriculum for teaching
  Odoo Sale, CRM, Accounting, and Project — session plans, labs, a capstone
  project, and grading/certification guidance.

## Customize

Update the contact information, client list, services, and wording directly in `index.html`.

## Odoo dashboards

Six dashboards pull live data from Odoo: an **Executive Dashboard**
(cross-functional KPI summary, health status, financial ratios) plus five
detail dashboards (Sales, Balance Sheet & P&L, Inventory, Purchase,
Manufacturing). Because GitHub Pages is a static host, there are two ways
to connect them to Odoo:

**Multi-company:** if your Odoo database has more than one company, each
dashboard shows a company switcher next to its controls — pick a single
company to filter every KPI/chart to it, or leave it on "All Companies
(Consolidated)" for a combined view across everything the connected user
can see. The selection is remembered per browser and applies across all
six pages.

**Date ranges:** Sales, Purchase, and Manufacturing offer month-count
presets (3/6/12/24) plus a custom From/To date picker; Balance Sheet & P&L
offers quarter/year/last-12-months presets plus the same custom picker.
Picking a custom range overrides the preset until you pick a preset again.

**Exporting:** every dashboard has an **⬇ Excel** button, which downloads
the currently loaded data as a multi-sheet `.xlsx` workbook (one sheet per
table/section), and a **🖨 PDF** button, which opens the browser's print
dialog with the controls/nav hidden — choose "Save as PDF" as the
destination. Both export exactly what's on screen, so apply your company
and date-range filters first, then export.

### Option A — Direct connection (no backend to deploy)

Open any dashboard page and use the **Connect to Odoo** form it shows —
enter your Odoo URL, database, username, and API key. These are saved only
in *your own browser's* local storage: never written into the site's
source, never committed to the repo, never sent anywhere but your Odoo
server. This is the quickest way to get started and needs nothing beyond
an Odoo API key.

**Requirement:** your Odoo server must send CORS headers allowing
`https://pyaephyoips.github.io` (or wherever this site is hosted), because
the browser calls Odoo's `/jsonrpc` endpoint cross-origin. Odoo does not do
this out of the box — see "Enabling CORS on Odoo" below. If you can't
change the Odoo server's web-facing config (e.g. it's Odoo Online SaaS),
use Option B instead.

### Option B — Cloudflare Worker proxy (no CORS changes needed)

A small proxy holds the Odoo API key server-side and avoids the CORS
requirement entirely, at the cost of deploying a (free) Cloudflare Worker.
See `odoo-proxy/README.md` for the one-time setup:

1. Deploy the Cloudflare Worker in `odoo-proxy/` and give it your Odoo URL,
   database, and API key as secrets.
2. Set `ODOO_PROXY_CONFIG.baseUrl` / `.token` in `assets/odoo-dashboard.js`.
3. Open any of the dashboard pages — until step 1–2 are done, each one shows
   a connect form instead of erroring.

If both are configured, the proxy (Option B) takes priority.

Shared dashboard styling/JS lives in `assets/odoo-dashboard.css`,
`assets/odoo-dashboard.js` (proxy mode + shared UI), and
`assets/odoo-client.js` (direct mode).

### Enabling CORS on Odoo (needed for Option A)

If you run Odoo behind nginx, add something like this to the location
block that proxies to Odoo (adjust the origin to match where this site is
hosted):

```nginx
location / {
    if ($request_method = OPTIONS) {
        add_header 'Access-Control-Allow-Origin' 'https://pyaephyoips.github.io' always;
        add_header 'Access-Control-Allow-Methods' 'POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type' always;
        add_header 'Content-Length' 0;
        return 204;
    }
    add_header 'Access-Control-Allow-Origin' 'https://pyaephyoips.github.io' always;
    proxy_pass http://127.0.0.1:8069;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

If you're on Odoo.sh, submissions to their support with this requirement
(or a custom nginx config in your branch, if your plan allows it) are the
way to get this added. If Odoo isn't behind a config you control at all,
use Option B (Cloudflare proxy) instead — it needs no Odoo-side changes.
