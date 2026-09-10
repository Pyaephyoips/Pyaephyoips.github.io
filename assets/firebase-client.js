/**
 * Firebase glue for the dashboards: an auth gate (Firestore holds real
 * business figures, so every dashboard requires a signed-in user once
 * Firebase is configured) plus read helpers for the cached report
 * snapshots the scheduled Cloud Function writes to Firestore.
 *
 * Everything here degrades to a no-op when assets/firebase-config.js is
 * left blank, so sites that don't set up Firebase keep working exactly as
 * before (live Odoo fetches only, no login gate).
 */

function firebaseConfigured() {
  return typeof FIREBASE_CONFIG !== 'undefined' && Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
}

let _fbApp = null;
function fbApp() {
  if (!_fbApp) _fbApp = firebase.initializeApp(FIREBASE_CONFIG);
  return _fbApp;
}

// Maps each cacheable report endpoint to the field name the sync function
// (firebase/functions/index.js) writes it under in snapshots/{companyKey}.
// The Executive dashboard isn't cached (its multi-period live view doesn't
// map onto one snapshot) and always fetches Odoo directly.
const REPORT_FIELD_BY_PATH = {
  '/api/sales': 'sales',
  '/api/financials': 'financials',
  '/api/inventory': 'inventory',
  '/api/purchase': 'purchase',
  '/api/manufacturing': 'manufacturing',
  '/api/accounting': 'accounting',
  '/api/warehouse': 'warehouse',
  '/api/inventory-movement': 'inventoryMovement',
};

async function fetchFirestoreReport(path, companyId) {
  const field = REPORT_FIELD_BY_PATH[path];
  if (!field) throw new Error('NO_CACHE_FOR_PATH');
  const db = fbApp().firestore();
  const key = companyId || 'all';
  const snap = await db.collection('snapshots').doc(key).get();
  if (!snap.exists) throw new Error('No cached snapshot yet — the sync function may not have run yet.');
  const data = snap.data()[field];
  if (!data) throw new Error(`No cached "${field}" data in this snapshot yet.`);
  if (data._error) throw new Error(data._error);
  return data;
}

async function fetchFirestoreCompanies() {
  const db = fbApp().firestore();
  const snap = await db.collection('meta').doc('companies').get();
  if (!snap.exists) throw new Error('No cached company list yet.');
  return snap.data().companies || [];
}

// ── Auth gate ──────────────────────────────────────────────────────────
// onSignedIn runs once a user is signed in (immediately, with no gate at
// all, if Firebase isn't configured — preserving today's fully-open
// behavior for sites that don't opt into Firebase).
function requireFirebaseAuth(onSignedIn) {
  if (!firebaseConfigured()) { onSignedIn(); return; }
  fbApp().auth().onAuthStateChanged(user => {
    if (user) {
      hideLoginGate();
      onSignedIn();
    } else {
      renderLoginGate();
    }
  });
}

function hideLoginGate() {
  const el = document.getElementById('fbLoginGate');
  if (el) el.style.display = 'none';
}

function renderLoginGate() {
  let el = document.getElementById('fbLoginGate');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fbLoginGate';
    el.className = 'fb-login-gate';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="fb-login-box">
      <h2>🔒 Sign in required</h2>
      <p>This dashboard reads cached business data from Firebase. Sign in with the account your admin created for you.</p>
      <div class="connect-form">
        <input id="fbEmail" type="email" placeholder="Email" autocomplete="username">
        <input id="fbPassword" type="password" placeholder="Password" autocomplete="current-password">
        <div class="fb-error" id="fbLoginError"></div>
        <button class="btn-connect" onclick="fbSignIn()">Sign in</button>
      </div>
    </div>`;
  el.style.display = 'flex';
  const pwField = document.getElementById('fbPassword');
  if (pwField) pwField.addEventListener('keydown', e => { if (e.key === 'Enter') fbSignIn(); });
}

async function fbSignIn() {
  const email = document.getElementById('fbEmail').value.trim();
  const password = document.getElementById('fbPassword').value;
  const errEl = document.getElementById('fbLoginError');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Enter your email and password.'; return; }
  try {
    await fbApp().auth().signInWithEmailAndPassword(email, password);
  } catch (err) {
    errEl.textContent = err.message || 'Sign-in failed.';
  }
}

function fbSignOut() {
  if (!firebaseConfigured()) return;
  fbApp().auth().signOut().then(() => location.reload());
}
