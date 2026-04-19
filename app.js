import { db, auth, provider } from "./firebase-config.js";
import {
  signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, setDoc, getDoc, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── State ───────────────────────────────────────────────────
let currentUser  = null;
let currentGroup = null;   // { id, name, inviteCode, members: [...uids] }
let unsubs       = [];     // Firestore listener unsubscribers

let state = { bookings:[], packing:[], activities:[], expenses:[], photos:[], members:[] };

const BUDGET = 4000;
let bkFilter   = "all";
let packFilter = "all";
let currentCity = "";
let currentModalType = "";

const typeIcons = { flight:"✈", train:"🚆", hotel:"🏨", experience:"🎭" };
const catColors = {
  Transport:"#7b6ff0", Hotels:"#e8915a", Food:"#5bbf8a",
  Experiences:"#e07ab0", Shopping:"#e8c97e", Other:"#9b97a8"
};

// ── Helpers ──────────────────────────────────────────────────
function show(id)  { document.getElementById(id).classList.remove("hidden"); }
function hide(id)  { document.getElementById(id).classList.add("hidden"); }
function el(id)    { return document.getElementById(id); }

function groupCol(name) {
  return collection(db, "groups", currentGroup.id, name);
}
function groupDoc(name, id) {
  return doc(db, "groups", currentGroup.id, name, id);
}

function randomCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function initials(name) {
  return (name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

const avatarColors = ["av-0","av-1","av-2","av-3","av-4","av-5"];

// ── Auth flow ────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  hide("loader");
  if (!user) {
    showAuthScreen();
    return;
  }
  currentUser = user;
  // Check if user belongs to a group
  const groupId = localStorage.getItem("groupId_" + user.uid);
  if (groupId) {
    const gSnap = await getDoc(doc(db, "groups", groupId));
    if (gSnap.exists() && gSnap.data().members.includes(user.uid)) {
      currentGroup = { id: gSnap.id, ...gSnap.data() };
      launchApp();
      return;
    }
    localStorage.removeItem("groupId_" + user.uid);
  }
  showGroupScreen(user);
});

function showAuthScreen() {
  hide("screen-app");
  hide("screen-group");
  show("screen-auth");
}

function showGroupScreen(user) {
  hide("screen-auth");
  hide("screen-app");
  show("screen-group");
  el("group-welcome").textContent = "Welcome, " + (user.displayName || user.email) + "!";
}

// ── Google sign-in ───────────────────────────────────────────
el("btn-google-signin").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
    // onAuthStateChanged handles the rest
  } catch (e) {
    alert("Sign-in failed: " + e.message);
  }
});

// ── Group tabs ───────────────────────────────────────────────
document.querySelectorAll(".group-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".group-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    hide("gtab-create"); hide("gtab-join");
    show("gtab-" + btn.dataset.gtab);
  });
});

// ── Create trip group ────────────────────────────────────────
el("btn-create-group").addEventListener("click", async () => {
  const name = el("g-trip-name").value.trim();
  if (!name) return alert("Please enter a trip name.");
  const inviteCode = randomCode();
  const gRef = await addDoc(collection(db, "groups"), {
    name,
    inviteCode,
    members: [currentUser.uid],
    createdBy: currentUser.uid,
    createdAt: serverTimestamp()
  });
  // Save user profile in group
  await setDoc(doc(db, "groups", gRef.id, "memberProfiles", currentUser.uid), {
    uid:         currentUser.uid,
    displayName: currentUser.displayName || currentUser.email,
    photoURL:    currentUser.photoURL || "",
    joinedAt:    serverTimestamp()
  });
  localStorage.setItem("groupId_" + currentUser.uid, gRef.id);
  currentGroup = { id: gRef.id, name, inviteCode, members: [currentUser.uid] };
  await seedGroupData();
  launchApp();
});

// ── Join trip group ──────────────────────────────────────────
el("btn-join-group").addEventListener("click", async () => {
  const code = el("g-invite-code").value.trim().toUpperCase();
  if (code.length !== 6) return alert("Enter a valid 6-character code.");
  const q = query(collection(db, "groups"), where("inviteCode", "==", code));
  const snap = await getDocs(q);
  if (snap.empty) return alert("No trip found with that code. Check with the trip creator.");
  const gDoc = snap.docs[0];
  const gData = gDoc.data();
  if (!gData.members.includes(currentUser.uid)) {
    const newMembers = [...gData.members, currentUser.uid];
    await updateDoc(doc(db, "groups", gDoc.id), { members: newMembers });
    await setDoc(doc(db, "groups", gDoc.id, "memberProfiles", currentUser.uid), {
      uid:         currentUser.uid,
      displayName: currentUser.displayName || currentUser.email,
      photoURL:    currentUser.photoURL || "",
      joinedAt:    serverTimestamp()
    });
  }
  localStorage.setItem("groupId_" + currentUser.uid, gDoc.id);
  currentGroup = { id: gDoc.id, ...gData };
  launchApp();
});

// ── Sign out ─────────────────────────────────────────────────
async function doSignOut() {
  unsubs.forEach(u => u());
  unsubs = [];
  currentGroup = null;
  await signOut(auth);
}
el("btn-signout-group").addEventListener("click", doSignOut);
el("menu-signout").addEventListener("click", () => { hideMenu(); doSignOut(); });

// ── Leave trip ───────────────────────────────────────────────
el("menu-leave").addEventListener("click", async () => {
  hideMenu();
  if (!confirm("Leave this trip? You can rejoin with the invite code.")) return;
  localStorage.removeItem("groupId_" + currentUser.uid);
  const newMembers = currentGroup.members.filter(m => m !== currentUser.uid);
  await updateDoc(doc(db, "groups", currentGroup.id), { members: newMembers });
  unsubs.forEach(u => u());
  unsubs = [];
  currentGroup = null;
  showGroupScreen(currentUser);
});

// ── Seed initial data for a new group ───────────────────────
async function seedGroupData() {
  const bookings = [
    {type:"flight",  title:"Bengaluru → Berlin (Parents)", ref:"BLR-TXL-001",  date:"2025-06-05", status:"upcoming"},
    {type:"hotel",   title:"Hotel Charlottenburg Berlin",  ref:"HTLCBLN",       date:"2025-06-05", status:"upcoming"},
    {type:"flight",  title:"Berlin → Paris",               ref:"BER-CDG-22",    date:"2025-06-08", status:"upcoming"},
    {type:"train",   title:"Paris → Amsterdam",            ref:"THA-PA-55",     date:"2025-06-11", status:"upcoming"},
    {type:"hotel",   title:"Le Marais Airbnb Paris",       ref:"AIRBNB-PM3",    date:"2025-06-08", status:"upcoming"},
    {type:"experience",title:"Eiffel Tower summit tickets",ref:"ET-TOP-44",     date:"2025-06-09", status:"upcoming"},
    {type:"experience",title:"Louvre Museum entry",        ref:"LV-ENT-99",     date:"2025-06-10", status:"upcoming"},
    {type:"hotel",   title:"Hotel Canal Amsterdam",        ref:"HAMS22",        date:"2025-06-11", status:"upcoming"},
    {type:"experience",title:"Anne Frank House",           ref:"AFH-88",        date:"2025-06-12", status:"upcoming"},
    {type:"flight",  title:"Amsterdam → Bengaluru (Parents)",ref:"AMS-BLR-RET",date:"2025-06-15", status:"upcoming"},
  ];
  const packing = [
    {cat:"Documents",  label:"Passports (all 4)",            done:false},
    {cat:"Documents",  label:"Schengen visas (parents)",     done:false},
    {cat:"Documents",  label:"Travel insurance docs",        done:false},
    {cat:"Documents",  label:"Hotel & flight printouts",     done:false},
    {cat:"Electronics",label:"Universal adapter (India→EU)", done:false},
    {cat:"Electronics",label:"Power bank",                   done:false},
    {cat:"Clothing",   label:"Warm jacket (for parents)",    done:false},
    {cat:"Clothing",   label:"Rain jacket or umbrella",      done:false},
    {cat:"Medicines",  label:"Motion sickness tablets",      done:false},
    {cat:"Medicines",  label:"Parents' regular medicines",   done:false},
    {cat:"Misc",       label:"Indian snacks for the flight", done:false},
  ];
  const activities = [
    {city:"Berlin",    date:"2025-06-06", slot:"Morning",   label:"Brandenburg Gate walk"},
    {city:"Berlin",    date:"2025-06-06", slot:"Afternoon", label:"East Side Gallery"},
    {city:"Paris",     date:"2025-06-09", slot:"Morning",   label:"Eiffel Tower summit"},
    {city:"Paris",     date:"2025-06-09", slot:"Afternoon", label:"Seine river cruise"},
    {city:"Amsterdam", date:"2025-06-12", slot:"Morning",   label:"Anne Frank House"},
    {city:"Amsterdam", date:"2025-06-13", slot:"Afternoon", label:"Canal boat tour"},
  ];
  const expenses = [
    {cat:"Transport",   city:"Berlin", label:"Train BER-CDG",   amount:280},
    {cat:"Hotels",      city:"Paris",  label:"Airbnb 3 nights", amount:420},
    {cat:"Food",        city:"Paris",  label:"Dinner Montmartre",amount:95},
    {cat:"Experiences", city:"Paris",  label:"Eiffel Tower x4", amount:120},
  ];
  for (const b of bookings)   await addDoc(groupCol("bookings"),   b);
  for (const p of packing)    await addDoc(groupCol("packing"),    p);
  for (const a of activities) await addDoc(groupCol("activities"), a);
  for (const e of expenses)   await addDoc(groupCol("expenses"),   e);
}

// ── Launch main app ──────────────────────────────────────────
function launchApp() {
  hide("screen-auth");
  hide("screen-group");
  show("screen-app");
  el("app-trip-name").innerHTML = currentGroup.name + ' <span>✈</span>';
  el("invite-code-display").textContent = currentGroup.inviteCode;
  subscribeAll();
}

// ── Firestore real-time listeners (group-scoped) ─────────────
function subscribeAll() {
  unsubs.forEach(u => u());
  unsubs = [];

  unsubs.push(onSnapshot(groupCol("bookings"), snap => {
    state.bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.bookings.sort((a, b) => a.date.localeCompare(b.date));
    renderBookings(); renderProgress();
  }));

  unsubs.push(onSnapshot(groupCol("packing"), snap => {
    state.packing = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPacking();
  }));

  unsubs.push(onSnapshot(groupCol("activities"), snap => {
    state.activities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPlanner();
  }));

  unsubs.push(onSnapshot(groupCol("expenses"), snap => {
    state.expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderExpenses();
  }));

  unsubs.push(onSnapshot(groupCol("photos"), snap => {
    state.photos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPhotos();
  }));

  unsubs.push(onSnapshot(groupCol("memberProfiles"), snap => {
    state.members = snap.docs.map(d => d.data());
    renderMembers();
  }));
}

// ── MENU ────────────────────────────────────────────────────
el("btn-menu").addEventListener("click", e => {
  e.stopPropagation();
  el("app-menu").classList.toggle("hidden");
});
document.addEventListener("click", () => hideMenu());
function hideMenu() { el("app-menu").classList.add("hidden"); }

el("menu-invite").addEventListener("click", () => {
  hideMenu();
  el("modal-invite").classList.add("open");
});
el("close-invite").addEventListener("click", () => el("modal-invite").classList.remove("open"));
el("btn-copy-code").addEventListener("click", () => {
  navigator.clipboard.writeText(currentGroup.inviteCode).then(() => {
    el("btn-copy-code").textContent = "Copied!";
    setTimeout(() => { el("btn-copy-code").textContent = "Copy code"; }, 2000);
  });
});

// ── TAB NAV ──────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-section").forEach(s => s.classList.remove("active"));
    btn.classList.add("active");
    el("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// ── RENDER: MEMBERS ─────────────────────────────────────────
function renderMembers() {
  const container = el("app-avatars");
  container.innerHTML = state.members.slice(0, 5).map((m, i) => {
    const init = initials(m.displayName);
    return `<div class="avatar ${avatarColors[i % avatarColors.length]}" title="${m.displayName}">${init}</div>`;
  }).join("");
  const sub = state.members.length + " traveller" + (state.members.length !== 1 ? "s" : "");
  el("app-trip-sub").textContent = sub;
}

// ── RENDER: BOOKINGS ────────────────────────────────────────
function renderBookings() {
  const list = el("bk-list");
  const filtered = bkFilter === "all" ? state.bookings : state.bookings.filter(b => b.type === bkFilter);
  if (!filtered.length) { list.innerHTML = '<div class="no-data">No bookings yet</div>'; return; }
  list.innerHTML = filtered.map(b => `
    <div class="bk-card ${b.type}">
      <span class="bk-icon">${typeIcons[b.type] || "📌"}</span>
      <div class="bk-body">
        <div class="bk-title">${b.title}</div>
        <div class="bk-meta">${b.date}</div>
        <div class="bk-ref">${b.ref}</div>
      </div>
      <div class="bk-right">
        <span class="badge badge-${b.status}">${b.status}</span>
        <button class="toggle-btn" onclick="cycleStatus('${b.id}','${b.status}')">toggle</button>
      </div>
    </div>`).join("");
}

window.cycleStatus = async function(id, status) {
  const cycle = ["upcoming","today","done","cancelled"];
  const next  = cycle[(cycle.indexOf(status) + 1) % cycle.length];
  await updateDoc(groupDoc("bookings", id), { status: next });
};

document.querySelectorAll("#bk-filters .chip").forEach(btn => {
  btn.addEventListener("click", () => {
    bkFilter = btn.dataset.filter;
    document.querySelectorAll("#bk-filters .chip").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderBookings();
  });
});

// ── RENDER: PROGRESS ────────────────────────────────────────
function renderProgress() {
  const total = state.bookings.length;
  const done  = state.bookings.filter(b => b.status === "done").length;
  const pct   = total ? Math.round(done / total * 100) : 0;
  el("prog-pct").textContent  = pct + "%";
  el("prog-bar").style.width  = pct + "%";
  el("prog-done-lbl").textContent  = done + " done";
  el("prog-left-lbl").textContent  = (total - done) + " remaining";

  const types = ["flight","train","hotel","experience"];
  el("prog-metrics").innerHTML = types.map(t => {
    const all = state.bookings.filter(b => b.type === t);
    const d   = all.filter(b => b.status === "done").length;
    return `<div class="metric"><div class="metric-val">${d}/${all.length}</div><div class="metric-lbl">${typeIcons[t]} ${t}s</div></div>`;
  }).join("");

  el("prog-timeline").innerHTML = state.bookings.map(b => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:18px">${typeIcons[b.type] || "📌"}</span>
      <div style="flex:1;font-size:13px">${b.title}</div>
      <span style="font-size:12px;color:var(--text2)">${b.date}</span>
      <span class="badge badge-${b.status}">${b.status}</span>
    </div>`).join("");
}

// ── RENDER: PACKING ─────────────────────────────────────────
function renderPacking() {
  const items = packFilter === "all" ? state.packing : state.packing.filter(p => p.cat === packFilter);
  const done  = state.packing.filter(p => p.done).length;
  const pct   = state.packing.length ? Math.round(done / state.packing.length * 100) : 0;
  el("pack-pct").textContent = pct + "%";
  el("pack-bar").style.width = pct + "%";
  const list = el("pack-list");
  if (!items.length) { list.innerHTML = '<div class="no-data">No items</div>'; return; }
  list.innerHTML = items.map(p => `
    <div class="check-item">
      <input type="checkbox" id="pk${p.id}" ${p.done ? "checked" : ""} onchange="togglePack('${p.id}',${p.done})">
      <label for="pk${p.id}" class="${p.done ? "done" : ""}">${p.label}</label>
      <span class="item-cat">${p.cat}</span>
    </div>`).join("");
}

window.togglePack = async function(id, current) {
  await updateDoc(groupDoc("packing", id), { done: !current });
};

document.querySelectorAll("#pack-filters .chip").forEach(btn => {
  btn.addEventListener("click", () => {
    packFilter = btn.dataset.filter;
    document.querySelectorAll("#pack-filters .chip").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderPacking();
  });
});

// ── RENDER: PLANNER ─────────────────────────────────────────
function renderPlanner() {
  const cities = [...new Set(state.activities.map(a => a.city))].sort();
  if (!currentCity && cities.length) currentCity = cities[0];
  el("city-pills").innerHTML = cities.map(c =>
    `<button class="city-pill ${c === currentCity ? "active" : ""}" onclick="selectCity('${c}')">${c}</button>`
  ).join("");

  const byDate = {};
  state.activities.filter(a => a.city === currentCity).forEach(a => {
    if (!byDate[a.date]) byDate[a.date] = {};
    if (!byDate[a.date][a.slot]) byDate[a.date][a.slot] = [];
    byDate[a.date][a.slot].push(a);
  });

  const listEl = el("planner-list");
  if (!Object.keys(byDate).length) { listEl.innerHTML = '<div class="no-data">No activities for this city yet</div>'; return; }
  listEl.innerHTML = Object.keys(byDate).sort().map(d => `
    <div class="day-card">
      <div class="day-title">${d}</div>
      ${["Morning","Afternoon","Evening"].filter(s => byDate[d][s]).map(s => `
        <div class="slot-label">${s}</div>
        ${byDate[d][s].map(a => `<div class="activity-item">${a.label}</div>`).join("")}
      `).join("")}
    </div>`).join("");
}

window.selectCity = function(c) { currentCity = c; renderPlanner(); };

// ── RENDER: EXPENSES ────────────────────────────────────────
function renderExpenses() {
  const total = state.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  el("exp-metrics").innerHTML = `
    <div class="metric"><div class="metric-val">€${total.toLocaleString()}</div><div class="metric-lbl">Total spent</div></div>
    <div class="metric"><div class="metric-val">€${Math.round(total / (state.members.length || 4)).toLocaleString()}</div><div class="metric-lbl">Per person</div></div>
    <div class="metric"><div class="metric-val">€${(BUDGET - total).toLocaleString()}</div><div class="metric-lbl">Budget left</div></div>
    <div class="metric"><div class="metric-val">${Math.round(total / BUDGET * 100)}%</div><div class="metric-lbl">Of budget</div></div>
  `;
  const byCat = {};
  state.expenses.forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + (e.amount || 0); });
  const maxVal = Math.max(...Object.values(byCat), 1);
  el("exp-chart").innerHTML = Object.entries(byCat).map(([cat, amt]) => `
    <div class="cat-bar-row">
      <span class="cat-bar-label">${cat}</span>
      <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${Math.round(amt/maxVal*100)}%;background:${catColors[cat]||"#888"}"></div></div>
      <span class="cat-bar-amt">€${amt}</span>
    </div>`).join("") || '<div class="no-data" style="padding:8px 0">No expenses yet</div>';

  el("exp-list").innerHTML = state.expenses.length ? state.expenses.map(e => `
    <div class="expense-row">
      <div><div class="exp-label">${e.label}</div><div class="exp-meta">${e.cat} · ${e.city}</div></div>
      <div class="exp-amt">€${e.amount}</div>
    </div>`).join("") : '<div class="no-data">No expenses yet</div>';
}

// ── RENDER: PHOTOS ──────────────────────────────────────────
function renderPhotos() {
  const grid = el("photo-grid");
  const noP  = el("no-photos");
  if (!state.photos.length) { grid.innerHTML = ""; noP.style.display = "block"; return; }
  noP.style.display = "none";
  grid.innerHTML = state.photos.map(p => `
    <div class="photo-thumb"><img src="${p.url}" alt="${p.label}" loading="lazy"></div>`).join("");
}

// Compress image to base64 — keeps each photo under ~100KB so Firestore is happy
function compressToBase64(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale  = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

el("photo-input").addEventListener("change", async function() {
  const btn = document.querySelector("label.btn-add");
  const origText = btn ? btn.childNodes[0].textContent : "";
  for (const file of this.files) {
    try {
      if (btn) btn.childNodes[0].textContent = "Saving…";
      const base64 = await compressToBase64(file);
      await addDoc(groupCol("photos"), {
        url:        base64,
        label:      file.name.replace(/\.[^.]+$/, ""),
        uploadedBy: currentUser.uid,
        at:         serverTimestamp()
      });
    } catch (e) {
      alert("Could not save photo: " + e.message);
    }
  }
  if (btn) btn.childNodes[0].textContent = origText;
  this.value = "";
});

// ── MODAL ───────────────────────────────────────────────────
const modalBg = el("modal-bg");
const modalBodies = {
  booking: `
    <div class="field"><label>Title</label><input id="m-title" placeholder="e.g. Paris → Rome flight"/></div>
    <div class="field"><label>Booking ref / PNR</label><input id="m-ref" placeholder="ABC123"/></div>
    <div class="field"><label>Date</label><input id="m-date" type="date"/></div>
    <div class="field"><label>Type</label><select id="m-type">
      <option value="flight">✈ Flight</option>
      <option value="train">🚆 Train</option>
      <option value="hotel">🏨 Hotel / Airbnb</option>
      <option value="experience">🎭 Experience</option>
    </select></div>`,
  pack: `
    <div class="field"><label>Item name</label><input id="m-label" placeholder="e.g. Sunscreen"/></div>
    <div class="field"><label>Category</label><select id="m-cat">
      <option>Documents</option><option>Clothing</option>
      <option>Electronics</option><option>Medicines</option><option>Misc</option>
    </select></div>`,
  activity: `
    <div class="field"><label>Activity name</label><input id="m-label" placeholder="e.g. Canal boat tour"/></div>
    <div class="field"><label>City</label><input id="m-city" placeholder="e.g. Amsterdam"/></div>
    <div class="field"><label>Date</label><input id="m-date" type="date"/></div>
    <div class="field"><label>Time slot</label><select id="m-slot">
      <option>Morning</option><option>Afternoon</option><option>Evening</option>
    </select></div>`,
  expense: `
    <div class="field"><label>Description</label><input id="m-label" placeholder="e.g. Dinner canal side"/></div>
    <div class="field"><label>Amount (€)</label><input id="m-amount" type="number" placeholder="0"/></div>
    <div class="field"><label>City</label><input id="m-city" placeholder="e.g. Amsterdam"/></div>
    <div class="field"><label>Category</label><select id="m-cat">
      <option>Transport</option><option>Hotels</option><option>Food</option>
      <option>Experiences</option><option>Shopping</option><option>Other</option>
    </select></div>`
};
const modalTitles = { booking:"Add booking", pack:"Add packing item", activity:"Add activity", expense:"Add expense" };

function openModal(type) {
  currentModalType = type;
  el("modal-title").textContent = modalTitles[type];
  el("modal-body").innerHTML = modalBodies[type];
  modalBg.classList.add("open");
}
function closeModal() { modalBg.classList.remove("open"); }

el("modal-close").addEventListener("click", closeModal);
el("btn-cancel").addEventListener("click", closeModal);
modalBg.addEventListener("click", e => { if (e.target === modalBg) closeModal(); });

el("btn-save").addEventListener("click", async () => {
  const g = id => { const x = document.getElementById(id); return x ? x.value.trim() : ""; };
  try {
    if (currentModalType === "booking") {
      if (!g("m-title") || !g("m-date")) return alert("Title and date are required.");
      await addDoc(groupCol("bookings"), {
        type: g("m-type"), title: g("m-title"), ref: g("m-ref") || "—",
        date: g("m-date"), status: "upcoming", addedBy: currentUser.uid
      });
    } else if (currentModalType === "pack") {
      if (!g("m-label")) return alert("Item name required.");
      await addDoc(groupCol("packing"), { cat: g("m-cat"), label: g("m-label"), done: false, addedBy: currentUser.uid });
    } else if (currentModalType === "activity") {
      if (!g("m-label") || !g("m-city") || !g("m-date")) return alert("All fields required.");
      currentCity = g("m-city");
      await addDoc(groupCol("activities"), {
        city: g("m-city"), date: g("m-date"), slot: g("m-slot"), label: g("m-label"), addedBy: currentUser.uid
      });
    } else if (currentModalType === "expense") {
      if (!g("m-label") || !g("m-amount")) return alert("Description and amount required.");
      await addDoc(groupCol("expenses"), {
        cat: g("m-cat"), city: g("m-city") || "—",
        label: g("m-label"), amount: parseFloat(g("m-amount")), addedBy: currentUser.uid
      });
    }
    closeModal();
  } catch (e) {
    alert("Error saving: " + e.message);
  }
});

el("btn-add-booking").addEventListener("click",  () => openModal("booking"));
el("btn-add-pack").addEventListener("click",     () => openModal("pack"));
el("btn-add-activity").addEventListener("click", () => openModal("activity"));
el("btn-add-expense").addEventListener("click",  () => openModal("expense"));

// ── Modal base (used by invite and data modals) ──────────────
const dataModal   = el("modal-bg");
const inviteModal = el("modal-invite");
inviteModal.addEventListener("click", e => { if (e.target === inviteModal) inviteModal.classList.remove("open"); });
