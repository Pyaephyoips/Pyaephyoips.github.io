# Password manager — Firebase setup

`password-manager.html` stores accounts and encrypted vaults in your own
Firebase project (Authentication + Firestore) instead of only in browser
`localStorage`, so a vault syncs across devices. Firebase never receives your
master password or any plaintext vault data — see "How the encryption works"
below.

## 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and
   create a new project (the free "Spark" plan is enough).
2. In **Build → Authentication → Sign-in method**, enable the **Email/Password**
   provider.
3. In **Build → Firestore Database**, click **Create database** (production
   mode is fine — the rules below lock it down).
4. In **Project settings → General → Your apps**, click the web icon (`</>`)
   to register a web app, and copy the `firebaseConfig` object it gives you.

## 2. Apply the Firestore security rules

In **Build → Firestore Database → Rules**, replace the default rules with the
contents of [`firestore.rules`](./firestore.rules) in this folder, then
publish. This restricts every vault document so only the matching signed-in
user can read or write it — no user can ever reach another user's data,
regardless of any bug in the client code.

## 3. Add your config to the page

Open `password-manager.html` and find the `firebaseConfig` object near the
top of the `<script type="module">` block. Replace the placeholder values
with the ones from step 1:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

These values identify your Firebase project publicly — they are not secret,
and it's normal/expected for them to be visible in client-side code. Actual
access control comes from the Firestore rules in step 2 and from Firebase
Authentication, not from hiding this config.

Commit and deploy, and the page will show a sign-up/log-in screen instead of
the "Firebase isn't configured yet" message.

## How the encryption works

Nothing about the crypto model changed from the local-only version — only
where the encrypted bytes are stored. For each user:

1. `masterKey = PBKDF2-SHA256(masterPassword, salt = lowercase(email), 600000 iterations)`
   — a per-user salt without needing a lookup before the user is authenticated
   (the same technique Bitwarden uses).
2. Two independent secrets are derived from `masterKey` via HKDF with
   different context strings:
   - `authPassword` — sent to Firebase Authentication as the account's
     password. This is what Firebase verifies and stores (hashed, on
     Google's servers) — it can't be used to derive the vault key.
   - `vaultKey` — an AES-256-GCM key used only in the browser to
     encrypt/decrypt the vault. It is never transmitted anywhere.
3. Firestore stores only `{ iv, data }` — the AES-GCM ciphertext of the vault
   entries and its initialization vector — under `vaults/{uid}`.

Because `authPassword` and `vaultKey` are derived independently, Firebase (or
anyone who dumps the Firestore database) never has enough information to
decrypt a vault, even with full database access. The tradeoff, as with any
true zero-knowledge design, is that **there is no password reset**: if a user
forgets their master password, that vault is permanently unreadable. The
only way to free up that email address again is for the project's Firebase
console owner to manually delete the Auth user (Authentication → Users) and
its `vaults/{uid}` document — this discards the old (already unreadable)
data, it does not recover it.

## Limitations / possible follow-ups

- No email verification on sign-up.
- No rate limiting beyond what Firebase Authentication applies by default.
- No shared/team vaults — one vault per account.
- Consider Firebase App Check if you want to restrict API usage to requests
  that actually come from your deployed page.
