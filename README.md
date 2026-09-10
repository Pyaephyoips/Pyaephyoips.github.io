# Skybridge Business Solution Website

A static GitHub Pages site for Skybridge Business Solution.

## Files

- `index.html` contains the page structure and content.
- `style.css` contains the complete responsive design.
- `assets/skybridge-erp-hero.png` is the generated hero image.
- `pos.html` / `cashflow.html` are local-only demo tools (browser storage, no backend).
- `password-manager.html` is an open-source, client-side password manager (see below).
- `ai-content-writer.html` / `ai-voice-assistant.html` are client-side AI tools
  backed by your own Google AI (Gemini) API key (see below).
- `executive-dashboard.html`, `sales-dashboard.html`, `financial-dashboard.html`,
  `inventory-dashboard.html`, `purchase-dashboard.html`, `manufacturing-dashboard.html`,
  `accounting-dashboard.html`, `warehouse-dashboard.html`
  are Odoo-backed ERP dashboards (see below).
- `firebase/` is an optional Cloud Functions project that syncs Odoo data into
  Firestore so the dashboards load instantly from a cache (see "Firebase
  caching" below).
- `odoo-course.html` is a full 8-week instructor-ready curriculum for teaching
  Odoo Sale, CRM, Accounting, and Project — session plans, labs, a capstone
  project, and grading/certification guidance.

## Password manager

`password-manager.html` is an open-source password manager with multi-user
accounts and cloud sync, backed by your own Firebase project (Authentication
+ Firestore) — see [`password-manager/README.md`](password-manager/README.md)
for the one-time Firebase setup (create a project, apply the Firestore
security rules, paste your config into the page).

- **Zero-knowledge encryption, even in the cloud.** Your master password is
  stretched locally (PBKDF2-SHA256, 600,000 iterations, salted with your
  email) into two independent secrets: one Firebase uses to authenticate
  you, and a separate AES-256-GCM key that only ever exists in your browser
  and encrypts/decrypts your vault. The database stores nothing but
  ciphertext — never your master password, never a plaintext entry.
- **Accounts, not just one local vault.** Sign up with an email + master
  password; your encrypted vault follows you across any browser/device you
  log in from.
- **Password generator** using `crypto.getRandomValues` (rejection sampling,
  no modulo bias), a strength estimator, per-entry search, show/hide and
  copy-to-clipboard (auto-cleared after 20 seconds), auto-lock after 5
  minutes of inactivity (re-prompts for your master password without
  signing you out), master password change, encrypted local backup
  export/import, and account deletion.
- **No recovery.** Forgetting the master password means the vault can never
  be decrypted again, by you, the site owner, or Firebase — there is
  deliberately no "forgot password" reset, since one would mean the server
  could get you back in without your master password.

This is an educational/self-hosted tool, not an independently audited
security product. For high-value credentials, consider a maintained, audited
password manager instead.

## AI Content Writer & AI Voice Assistant

`ai-content-writer.html` and `ai-voice-assistant.html` are static, client-side
tools powered by Google AI's Gemini API. Like the Odoo dashboards' direct
connection mode, each visitor pastes their own free Gemini API key (get one
at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)); the key
is saved only in that browser's local storage and calls go straight from the
browser to Google's `generativelanguage.googleapis.com` API — never through
this site or its repo. Both pages share the same saved key/model, so
connecting once covers both tools.

- **AI Content Writer** — pick a content type (blog post, social caption,
  product description, marketing email, ad copy, press release, landing page
  copy), tone, and length, describe the topic, and generate a draft with
  copy-to-clipboard and regenerate.
- **AI Voice Assistant** — a conversational voice chat: tap the microphone
  (Web Speech API, Chrome/Edge) or type a message, get a reply shown in the
  chat log and read aloud (`speechSynthesis`), with a toggle to mute spoken
  replies and a button to clear the conversation. Browsers without
  `SpeechRecognition` support fall back to the text box.

Because this uses your own API key with no backend, usage is billed to your
own Google AI account (Gemini has a free tier) and the key is visible in your
browser's network requests to Google — treat it like any client-side API key
and rotate it if you suspect it leaked.

## Customize

Update the contact information, client list, services, and wording directly in `index.html`.

## Odoo dashboards

Eight dashboards pull data from Odoo: an **Executive Dashboard**
(cross-functional KPI summary, health status, financial ratios) plus seven
detail dashboards (Sales, Balance Sheet & P&L, Inventory, Purchase,
Manufacturing, Accounting, Warehouse). Because GitHub Pages is a static
host, there are three ways to connect them to Odoo:

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

### Option C — Firebase caching (optional, on top of A or B)

Both options above hit Odoo live on every page load. Deploying the
Cloud Function in `firebase/functions/` instead syncs each dashboard's
default view into Firestore on a schedule (every 60 minutes), so the
default view loads instantly with **no Odoo round-trip and no API key in
the browser at all**. Any period button, custom date range, or the
**↻ Refresh** button still bypasses the cache and hits Odoo live (via
whichever of Option A/B is configured) — Firebase only accelerates the
default view.

Because the cached data is real business data, every dashboard requires a
signed-in Firebase user once Firebase is configured — sites that skip this
option keep today's fully open behavior.

**Setup:**

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com),
   enable **Firestore** (any region), and enable **Authentication > Sign-in
   method > Email/Password**. Then create at least one user under
   **Authentication > Users** — that's who can view the dashboards.
2. Upgrade the project to the **Blaze (pay-as-you-go)** plan — required for
   scheduled Cloud Functions that make outbound network calls (to Odoo).
   Actual usage for a handful of hourly syncs is normally within or just
   above the free tier.
3. Install the [Firebase CLI](https://firebase.google.com/docs/cli)
   (`npm install -g firebase-tools`), then from the `firebase/` directory:
   ```
   firebase login
   firebase use --add          # pick your project, or edit .firebaserc directly
   cd functions && npm install && cd ..
   firebase deploy --only firestore:rules,functions
   ```
4. Set the Odoo connection as Cloud Functions secrets (one-time; you'll be
   prompted for each value):
   ```
   firebase functions:secrets:set ODOO_URL
   firebase functions:secrets:set ODOO_DB
   firebase functions:secrets:set ODOO_USERNAME
   firebase functions:secrets:set ODOO_API_KEY
   firebase functions:secrets:set SYNC_TOKEN   # any random string; protects the manual-sync endpoint
   ```
   Re-run `firebase deploy --only functions` after setting secrets so the
   functions pick them up.
5. Trigger a first sync manually instead of waiting up to an hour — call the
   `syncNow` HTTPS function it just deployed:
   ```
   curl -X POST -H "X-Sync-Token: <the SYNC_TOKEN value you set>" \
     https://<region>-<project-id>.cloudfunctions.net/syncNow
   ```
6. Fill in `assets/firebase-config.js` with your project's Web app config
   (Firebase Console > Project settings > General > "Your apps" > Web app).
   This value is a public identifier, not a secret, but the dashboards
   still only work for signed-in users because `firebase/firestore.rules`
   requires it.

Leave `assets/firebase-config.js` blank (as shipped) to skip this option
entirely — every dashboard falls back to live Odoo fetches with no login
gate, exactly as before. The Executive dashboard always fetches Odoo live
(its multi-period view doesn't cache as a single snapshot) even when
Firebase is configured elsewhere.

Shared dashboard styling/JS lives in `assets/odoo-dashboard.css`,
`assets/odoo-dashboard.js` (proxy mode + shared UI), `assets/odoo-client.js`
(direct mode), and `assets/firebase-client.js` / `assets/firebase-config.js`
(optional Firestore caching + auth gate).

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
