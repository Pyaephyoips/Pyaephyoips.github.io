# Skybridge Business Solution Website

A static GitHub Pages site for Skybridge Business Solution.

## Files

- `index.html` contains the page structure and content.
- `style.css` contains the complete responsive design.
- `assets/skybridge-erp-hero.png` is the generated hero image.
- `pos.html` / `cashflow.html` are local-only demo tools (browser storage, no backend).
- `sales-dashboard.html`, `financial-dashboard.html`, `inventory-dashboard.html`,
  `purchase-dashboard.html`, `manufacturing-dashboard.html` are Odoo-backed
  ERP dashboards (see below).

## Customize

Update the contact information, client list, services, and wording directly in `index.html`.

## Odoo dashboards

Five dashboards pull live data from Odoo (Sales, Balance Sheet & P&L,
Inventory, Purchase, Manufacturing). Because GitHub Pages is a static host,
they don't talk to Odoo directly — they go through a small proxy that keeps
the Odoo API key off the public site. See `odoo-proxy/README.md` for the
one-time setup:

1. Deploy the Cloudflare Worker in `odoo-proxy/` and give it your Odoo URL,
   database, and API key as secrets.
2. Set `ODOO_PROXY_CONFIG.baseUrl` / `.token` in `assets/odoo-dashboard.js`.
3. Open any of the dashboard pages — until step 1–2 are done, each one shows
   a setup banner instead of erroring.

Shared dashboard styling/JS lives in `assets/odoo-dashboard.css` and
`assets/odoo-dashboard.js`.
