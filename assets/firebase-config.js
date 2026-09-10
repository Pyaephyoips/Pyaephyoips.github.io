/**
 * Firebase Web SDK config. This is a public identifier, not a secret — see
 * https://firebase.google.com/docs/projects/api-keys — but the dashboards
 * still only work for signed-in users, because Firestore Security Rules
 * (firebase/firestore.rules) require request.auth != null for every read.
 *
 * Fill this in from Firebase Console > Project settings > General >
 * "Your apps" > Web app > SDK setup and configuration > Config. Leave it
 * blank (as shipped) to keep every dashboard on live Odoo fetches only —
 * see "Firebase caching (optional)" in the root README.
 */
const FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
