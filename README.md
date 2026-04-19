# Europe Trip Hub — Setup Guide

Real-time shared trip planner with Google sign-in and group-level privacy.
One URL, multiple families, completely isolated data.

---

## How it works

- Everyone signs in with **Google**
- The trip creator creates a **trip group** → gets a 6-character invite code
- Family members open the URL, sign in, tap **"Join trip"**, enter the code
- Everyone sees the same live data — bookings, packing, expenses, photos
- **Other groups cannot see your data** — enforced by Firebase Security Rules server-side

---

## Setup (~15 minutes, all free)

### Step 1 — Firebase project

1. Go to https://console.firebase.google.com
2. **Add project** → name it (e.g. `europe-trip-2025`) → Create
3. Disable Google Analytics → Continue

#### Enable Authentication
4. Sidebar: **Build → Authentication → Get started**
5. **Sign-in method** tab → Enable **Google** → Save

#### Enable Firestore
6. Sidebar: **Build → Firestore Database → Create database**
7. Choose **Production mode** (you'll add the security rules below)
8. Pick any region → Done

#### Enable Storage (for photos)
9. Sidebar: **Build → Storage → Get started → Production mode** → Done

#### Get your config
10. **Project Settings** (gear icon) → scroll to **Your apps** → click **`</>`**
11. Register as `trip-hub` → copy the `firebaseConfig` object

---

### Step 2 — Add your config

Open `firebase-config.js`, replace the placeholder values with your real config:

```js
const firebaseConfig = {
  apiKey:            "AIza...",
  authDomain:        "europe-trip-2025.firebaseapp.com",
  projectId:         "europe-trip-2025",
  storageBucket:     "europe-trip-2025.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc"
};
```

---

### Step 3 — Apply Security Rules

This is what keeps each family's data private.

**Firestore rules:**
1. Firebase Console → Firestore → **Rules** tab
2. Replace all content with the rules from `firestore.rules` (the section under `service cloud.firestore`)
3. Click **Publish**

**Storage rules:**
1. Firebase Console → Storage → **Rules** tab
2. Replace all content with the storage rules from `firestore.rules` (the commented section at the bottom — uncomment it first)
3. Click **Publish**

---

### Step 4 — Add your domain to Firebase Auth

When deployed, you need to whitelist your domain:

1. Firebase Console → Authentication → **Settings** → **Authorized domains**
2. Add your GitHub Pages domain: `YOUR-USERNAME.github.io`

---

### Step 5 — Deploy to GitHub Pages

1. Create a new public repo at https://github.com/new (e.g. `europe-trip-hub`)
2. Upload all files: `index.html`, `style.css`, `app.js`, `firebase-config.js`, `manifest.json`
3. Repo **Settings → Pages → Source: main / root → Save**
4. URL will be: `https://YOUR-USERNAME.github.io/europe-trip-hub`

---

### Step 6 — Share with family

Send the URL. Flow for each person:
1. Open URL on phone
2. Tap **"Sign in with Google"**
3. Tap **"Join trip"** tab → enter the 6-character code from the trip creator
4. They're in — data syncs in real time

**On iPhone:** Safari → Share → "Add to Home Screen" → installs like a native app
**On Android:** Chrome → menu → "Add to Home Screen"

---

## Multiple trips / groups

This app supports multiple independent trips. Each trip is a separate group with its own invite code. A user with a different Google account (e.g. your parents' account) would create or join a completely separate group — their data is invisible to your group.

---

## Customise

**Budget:** Edit `app.js`, change `const BUDGET = 4000;`

**Traveller names:** The avatars are auto-generated from Google profile names when people join.

**Trip name:** Set when creating the group — editable by messaging the developer.
