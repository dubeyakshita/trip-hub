import { db, auth, provider } from "./firebase-config.js";
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, getDoc, getDocs, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── State ────────────────────────────────────────────────────
let currentUser  = null;
let currentGroup = null;  // { id, name, passwordHash, members, adminIds, budget }
let unsubs       = [];
let state = { bookings:[], packing:[], activities:[], expenses:[], photos:[], members:[] };

let bkFilter       = "all";
let packFilter     = "all";
let currentCity    = "";
let pendingDelete  = null;
let editingBookingId  = null;
let editingPackId     = null;
let editingActivityId = null;
let editingExpenseId  = null;
let pendingAttachments = [];  // array of { name, type, data }
let currentBkType  = "flight";

const typeIcons = { flight:"✈", train:"🚆", hotel:"🏨", experience:"🎭" };
const catColors = { Transport:"#7b6ff0", Hotels:"#e8915a", Food:"#5bbf8a", Experiences:"#e07ab0", Shopping:"#e8c97e", Other:"#9b97a8" };

// ── Helpers ──────────────────────────────────────────────────
const el    = id => document.getElementById(id);
const show  = id => el(id).classList.remove("hidden");
const hide  = id => el(id).classList.add("hidden");
const groupCol  = name      => collection(db,"groups",currentGroup.id,name);
const groupDoc  = (name,id) => doc(db,"groups",currentGroup.id,name,id);
const mapsUrl   = loc => "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(loc);
const openModal = id  => el(id).classList.add("open");
const closeModal= id  => el(id).classList.remove("open");
const isAdmin   = ()  => currentGroup && (currentGroup.adminIds||[]).includes(currentUser?.uid);

function initials(name){ return (name||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2); }
const avatarColors = ["av-0","av-1","av-2","av-3","av-4","av-5"];

function getBudget(){ return currentGroup?.budget || 0; }

async function hashPassword(pw){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function inviteLink(){
  return window.location.href.split("?")[0]+"?join="+encodeURIComponent(currentGroup.name);
}

// ── URL invite pre-fill ──────────────────────────────────────
function checkInviteUrl(){
  const p = new URLSearchParams(window.location.search);
  const j = p.get("join");
  if (j){
    document.querySelectorAll(".group-tab").forEach(b=>b.classList.remove("active"));
    document.querySelector('[data-gtab="join"]').classList.add("active");
    hide("gtab-create"); show("gtab-join");
    el("g-join-name").value = decodeURIComponent(j);
    show("join-prefill-banner");
    window.history.replaceState({},""  ,window.location.pathname);
  }
}

// ── Auth ─────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  hide("loader");
  if (!user){ showAuthScreen(); return; }
  currentUser = user;
  const groupId = localStorage.getItem("groupId_"+user.uid);
  if (groupId){
    const gSnap = await getDoc(doc(db,"groups",groupId));
    if (gSnap.exists() && gSnap.data().members.includes(user.uid)){
      currentGroup = { id:gSnap.id, ...gSnap.data() };
      launchApp(); return;
    }
    localStorage.removeItem("groupId_"+user.uid);
  }
  showGroupScreen();
});

function showAuthScreen(){ hide("screen-app"); hide("screen-group"); show("screen-auth"); }
function showGroupScreen(){
  hide("screen-auth"); hide("screen-app"); show("screen-group");
  el("group-welcome").textContent = "Welcome, "+(currentUser.displayName||currentUser.email)+"!";
  el("g-trip-name").value=""; el("g-trip-password").value="";
  el("g-join-name").value=""; el("g-join-password").value="";
  checkInviteUrl();
}

el("btn-google-signin").addEventListener("click", async ()=>{
  try{ await signInWithPopup(auth,provider); }
  catch(e){ alert("Sign-in failed: "+e.message); }
});

document.querySelectorAll(".group-tab").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".group-tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    hide("gtab-create"); hide("gtab-join");
    show("gtab-"+btn.dataset.gtab);
  });
});

// Create group — creator becomes first admin
el("btn-create-group").addEventListener("click", async ()=>{
  const name = el("g-trip-name").value.trim();
  const pw   = el("g-trip-password").value.trim();
  if (!name)        return alert("Please enter a trip name.");
  if (pw.length<4)  return alert("Password must be at least 4 characters.");
  const passwordHash = await hashPassword(pw);
  const gRef = await addDoc(collection(db,"groups"),{
    name, passwordHash,
    members:[currentUser.uid],
    adminIds:[currentUser.uid],   // creator = admin
    budget:0,                      // configurable later
    createdBy:currentUser.uid,
    createdAt:serverTimestamp()
  });
  await setDoc(doc(db,"groups",gRef.id,"memberProfiles",currentUser.uid),{
    uid:currentUser.uid, displayName:currentUser.displayName||currentUser.email,
    photoURL:currentUser.photoURL||"", joinedAt:serverTimestamp()
  });
  localStorage.setItem("groupId_"+currentUser.uid, gRef.id);
  currentGroup = { id:gRef.id, name, passwordHash, members:[currentUser.uid], adminIds:[currentUser.uid], budget:0 };
  el("g-trip-name").value=""; el("g-trip-password").value="";
  launchApp();
});

// Join group
el("btn-join-group").addEventListener("click", async ()=>{
  const name = el("g-join-name").value.trim();
  const pw   = el("g-join-password").value.trim();
  if (!name) return alert("Enter the exact trip name.");
  if (!pw)   return alert("Enter the trip password.");
  try{
    const passwordHash = await hashPassword(pw);
    const q    = query(collection(db,"groups"),where("name","==",name));
    const snap = await getDocs(q);
    if (snap.empty) return alert("No trip found with that name.");
    const match = snap.docs.find(d=>d.data().passwordHash===passwordHash);
    if (!match) return alert("Incorrect password.");
    const groupId = match.id, gData = match.data();
    if (!gData.members.includes(currentUser.uid)){
      await updateDoc(doc(db,"groups",groupId),{ members:[...gData.members,currentUser.uid] });
      await setDoc(doc(db,"groups",groupId,"memberProfiles",currentUser.uid),{
        uid:currentUser.uid, displayName:currentUser.displayName||currentUser.email,
        photoURL:currentUser.photoURL||"", joinedAt:serverTimestamp()
      });
    }
    localStorage.setItem("groupId_"+currentUser.uid, groupId);
    currentGroup = { id:groupId, ...gData, members:[...gData.members,currentUser.uid] };
    el("g-join-name").value=""; el("g-join-password").value="";
    launchApp();
  } catch(e){ alert("Could not join: "+e.message); }
});

async function doSignOut(){
  unsubs.forEach(u=>u()); unsubs=[]; currentGroup=null;
  await signOut(auth);
}
el("btn-signout-group").addEventListener("click", doSignOut);
el("menu-signout").addEventListener("click",()=>{ hideMenu(); doSignOut(); });

el("menu-leave").addEventListener("click", async ()=>{
  hideMenu();
  if (!confirm("Leave this trip?")) return;
  localStorage.removeItem("groupId_"+currentUser.uid);
  const newM = currentGroup.members.filter(m=>m!==currentUser.uid);
  const newA = (currentGroup.adminIds||[]).filter(a=>a!==currentUser.uid);
  await updateDoc(doc(db,"groups",currentGroup.id),{ members:newM, adminIds:newA });
  unsubs.forEach(u=>u()); unsubs=[]; currentGroup=null;
  showGroupScreen();
});

// ── Launch ────────────────────────────────────────────────────
function launchApp(){
  hide("screen-auth"); hide("screen-group"); show("screen-app");
  el("app-trip-name").innerHTML = currentGroup.name+' <span>✈</span>';
  el("invite-link-display").textContent = inviteLink();
  // Show settings only for admins
  el("menu-settings").style.display = isAdmin() ? "block" : "none";
  subscribeAll();
}

// ── Real-time group updates (budget, adminIds) ────────────────
function subscribeGroup(){
  return onSnapshot(doc(db,"groups",currentGroup.id), snap=>{
    if (!snap.exists()) return;
    currentGroup = { id:snap.id, ...snap.data() };
    el("menu-settings").style.display = isAdmin() ? "block" : "none";
    renderExpenses(); // re-render with new budget
  });
}

// ── Listeners ─────────────────────────────────────────────────
function subscribeAll(){
  unsubs.forEach(u=>u()); unsubs=[];
  unsubs.push(subscribeGroup());
  unsubs.push(onSnapshot(groupCol("bookings"),snap=>{
    state.bookings=snap.docs.map(d=>({id:d.id,...d.data()}));
    state.bookings.sort((a,b)=>a.date.localeCompare(b.date));
    renderBookings(); renderProgress();
  }));
  unsubs.push(onSnapshot(groupCol("packing"),snap=>{
    state.packing=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderPacking();
  }));
  unsubs.push(onSnapshot(groupCol("activities"),snap=>{
    state.activities=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderPlanner();
  }));
  unsubs.push(onSnapshot(groupCol("expenses"),snap=>{
    state.expenses=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderExpenses();
  }));
  unsubs.push(onSnapshot(groupCol("photos"),snap=>{
    state.photos=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderPhotos();
  }));
  unsubs.push(onSnapshot(groupCol("memberProfiles"),snap=>{
    state.members=snap.docs.map(d=>d.data());
    renderMembers();
  }));
}

// ── Menu ─────────────────────────────────────────────────────
el("btn-menu").addEventListener("click",e=>{ e.stopPropagation(); el("app-menu").classList.toggle("hidden"); });
document.addEventListener("click",()=>hideMenu());
function hideMenu(){ el("app-menu").classList.add("hidden"); }

el("menu-invite").addEventListener("click",()=>{ hideMenu(); el("invite-link-display").textContent=inviteLink(); openModal("modal-invite"); });
el("close-invite").addEventListener("click",()=>closeModal("modal-invite"));
el("modal-invite").addEventListener("click",e=>{ if(e.target===el("modal-invite")) closeModal("modal-invite"); });
el("btn-copy-link").addEventListener("click",()=>{
  navigator.clipboard.writeText(inviteLink()).then(()=>{
    el("btn-copy-link").textContent="Copied!";
    setTimeout(()=>{ el("btn-copy-link").textContent="Copy link"; },2000);
  });
});

// ── Members modal ────────────────────────────────────────────
el("menu-members").addEventListener("click",()=>{ hideMenu(); renderMembersModal(); openModal("modal-members"); });
el("close-members").addEventListener("click",()=>closeModal("modal-members"));
el("modal-members").addEventListener("click",e=>{ if(e.target===el("modal-members")) closeModal("modal-members"); });

function renderMembersModal(){
  const adminIds = currentGroup.adminIds||[];
  const amAdmin  = isAdmin();
  el("members-list").innerHTML = state.members.map((m,i)=>{
    const isAd = adminIds.includes(m.uid);
    const isMe = m.uid === currentUser.uid;
    const canPromote = amAdmin && !isAd && !isMe;
    const canDemote  = amAdmin && isAd && !isMe && adminIds.length > 1;
    return `<div class="member-row">
      <div class="avatar ${avatarColors[i%avatarColors.length]}">${initials(m.displayName)}</div>
      <div class="member-info">
        <div class="member-name">${m.displayName}${isMe?' <span style="color:var(--text3);font-size:11px">(you)</span>':""}</div>
        <div class="member-role">${isAd?'<span class="badge-admin">Admin</span>':"Member"}</div>
      </div>
      <div style="display:flex;gap:6px">
        ${canPromote?`<button class="btn-promote" onclick="promoteUser('${m.uid}')">Make admin</button>`:""}
        ${canDemote ?`<button class="btn-demote"  onclick="demoteUser('${m.uid}')">Remove admin</button>`:""}
      </div>
    </div>`;
  }).join("") || '<div class="no-data">No members yet</div>';
}

window.promoteUser = async function(uid){
  const newAdmins = [...(currentGroup.adminIds||[]), uid];
  await updateDoc(doc(db,"groups",currentGroup.id),{ adminIds:newAdmins });
  renderMembersModal();
};
window.demoteUser = async function(uid){
  const newAdmins = (currentGroup.adminIds||[]).filter(a=>a!==uid);
  await updateDoc(doc(db,"groups",currentGroup.id),{ adminIds:newAdmins });
  renderMembersModal();
};

// ── Settings modal (admin only) ──────────────────────────────
el("menu-settings").addEventListener("click",()=>{
  hideMenu();
  if (!isAdmin()) return alert("Only admins can change trip settings.");
  el("s-budget").value = currentGroup.budget||"";
  openModal("modal-settings");
});
el("close-settings").addEventListener("click",()=>closeModal("modal-settings"));
el("cancel-settings").addEventListener("click",()=>closeModal("modal-settings"));
el("modal-settings").addEventListener("click",e=>{ if(e.target===el("modal-settings")) closeModal("modal-settings"); });
el("save-settings").addEventListener("click", async ()=>{
  if (!isAdmin()) return alert("Only admins can do this.");
  const budget = parseFloat(el("s-budget").value)||0;
  await updateDoc(doc(db,"groups",currentGroup.id),{ budget });
  closeModal("modal-settings");
});

// ── Tab nav ───────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-section").forEach(s=>s.classList.remove("active"));
    btn.classList.add("active");
    el("tab-"+btn.dataset.tab).classList.add("active");
  });
});

// ── Delete confirm ────────────────────────────────────────────
function askDelete(col,id){ pendingDelete={col,id}; openModal("modal-delete"); }
el("cancel-delete").addEventListener("click",()=>{ pendingDelete=null; closeModal("modal-delete"); });
el("confirm-delete").addEventListener("click", async ()=>{
  if (!pendingDelete) return;
  await deleteDoc(groupDoc(pendingDelete.col,pendingDelete.id));
  pendingDelete=null; closeModal("modal-delete");
});
el("modal-delete").addEventListener("click",e=>{ if(e.target===el("modal-delete")){ pendingDelete=null; closeModal("modal-delete"); }});
window.askDelete = askDelete;

// ── Multiple attachments ──────────────────────────────────────
function fileToBase64(file){
  return new Promise((res,rej)=>{
    if (file.size>1.2*1024*1024){ rej(new Error(`"${file.name}" is too large. Max 1MB per file.`)); return; }
    const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file);
  });
}

function renderAttachmentsPreview(){
  const wrap = el("b-attachments-preview");
  wrap.innerHTML = pendingAttachments.map((a,i)=>`
    <div class="att-pill">
      <span class="att-name" onclick="previewPendingAtt(${i})">📎 ${a.name}</span>
      <span class="att-remove" onclick="removeAtt(${i})">✕</span>
    </div>`).join("");
}

window.removeAtt = function(i){
  pendingAttachments.splice(i,1);
  renderAttachmentsPreview();
};
window.previewPendingAtt = function(i){
  viewAttachment(pendingAttachments[i]);
};

el("b-file").addEventListener("change", async function(){
  const files = Array.from(this.files);
  const remaining = 5 - pendingAttachments.length;
  if (files.length > remaining) return alert(`You can attach up to 5 files. You have space for ${remaining} more.`);
  for (const file of files){
    try{
      const data = await fileToBase64(file);
      pendingAttachments.push({ name:file.name, type:file.type, data });
    } catch(e){ alert(e.message); }
  }
  renderAttachmentsPreview();
  this.value="";
});

function viewAttachment(att){
  el("pdf-title").textContent = att.name||"Attachment";
  const c = el("pdf-container");
  c.innerHTML = att.type==="application/pdf"
    ? `<iframe src="${att.data}" style="width:100%;height:55vh;border:none;border-radius:var(--radius-sm)"></iframe>`
    : `<img src="${att.data}" style="width:100%;border-radius:var(--radius-sm)">`;
  el("btn-download-pdf").onclick=()=>{ const a=document.createElement("a"); a.href=att.data; a.download=att.name; a.click(); };
  openModal("modal-pdf");
}
el("close-pdf").addEventListener("click",()=>{ el("pdf-container").innerHTML=""; closeModal("modal-pdf"); });
el("modal-pdf").addEventListener("click",e=>{ if(e.target===el("modal-pdf")){ el("pdf-container").innerHTML=""; closeModal("modal-pdf"); }});

// ── Booking type selector ────────────────────────────────────
function setBookingType(type){
  currentBkType=type;
  document.querySelectorAll(".type-btn").forEach(b=>b.classList.toggle("active",b.dataset.type===type));
  const isRoute = type==="flight"||type==="train";
  el("bk-route-fields").style.display   = isRoute?"block":"none";
  el("bk-location-field").style.display = isRoute?"none":"block";
  el("b-from-label").textContent = type==="flight"?"Departure airport":"Departure station";
  el("b-to-label").textContent   = type==="flight"?"Arrival airport":"Arrival station";
}
document.querySelectorAll(".type-btn").forEach(btn=>{
  btn.addEventListener("click",()=>setBookingType(btn.dataset.type));
});

// ── BOOKINGS ─────────────────────────────────────────────────
function renderBookings(){
  const list = el("bk-list");
  const filtered = bkFilter==="all"?state.bookings:state.bookings.filter(b=>b.type===bkFilter);
  if (!filtered.length){ list.innerHTML='<div class="no-data">No bookings yet</div>'; return; }
  list.innerHTML = filtered.map(b=>{
    const timeStr   = b.time?` · ${b.time}`:"";
    const routeHtml = (b.type==="flight"||b.type==="train")&&(b.from||b.to)
      ?`<div style="font-size:12px;color:var(--text2);margin-top:3px">📍 ${b.from||"?"} → ${b.to||"?"}</div>`:"";
    const locHtml   = b.location
      ?`<a class="location-link" href="${mapsUrl(b.location)}" target="_blank">📍 ${b.location}</a>`:"";
    const atts = b.attachments||[];
    const attHtml = atts.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${atts.map((a,i)=>
          `<span class="attachment-btn" onclick="viewBkAtt('${b.id}',${i})">📎 ${a.name}</span>`
        ).join("")}</div>` : "";
    return `<div class="bk-card ${b.type}">
      <span class="bk-icon">${typeIcons[b.type]||"📌"}</span>
      <div class="bk-body">
        <div class="bk-title">${b.title}</div>
        <div class="bk-meta">${b.date}${timeStr} · <span style="font-family:monospace;font-size:11px">${b.ref}</span></div>
        ${routeHtml}${locHtml}${attHtml}
        <div class="item-actions">
          <button class="toggle-btn" onclick="cycleStatus('${b.id}','${b.status}')">${b.status} →</button>
          <button class="btn-edit" onclick="editBooking('${b.id}')">Edit</button>
          <button class="btn-delete" onclick="askDelete('bookings','${b.id}')">Delete</button>
        </div>
      </div>
      <span class="badge badge-${b.status}">${b.status}</span>
    </div>`;
  }).join("");
}

window.cycleStatus = async function(id,status){
  const cycle=["upcoming","today","done","cancelled"];
  await updateDoc(groupDoc("bookings",id),{status:cycle[(cycle.indexOf(status)+1)%cycle.length]});
};
window.viewBkAtt = function(id,i){
  const b=state.bookings.find(x=>x.id===id);
  if (b&&b.attachments&&b.attachments[i]) viewAttachment(b.attachments[i]);
};

function openBookingModal(bk=null){
  editingBookingId = bk?bk.id:null;
  pendingAttachments = bk&&bk.attachments ? [...bk.attachments] : [];
  el("modal-booking-title").textContent = bk?"Edit booking":"Add booking";
  const type = bk?bk.type:"flight";
  setBookingType(type);
  el("b-title").value    = bk?bk.title:"";
  el("b-ref").value      = bk?bk.ref:"";
  el("b-date").value     = bk?bk.date:"";
  el("b-time").value     = bk?(bk.time||""):"";
  el("b-from").value     = bk?(bk.from||""):"";
  el("b-to").value       = bk?(bk.to||""):"";
  el("b-location").value = bk?(bk.location||""):"";
  el("b-file").value     = "";
  renderAttachmentsPreview();
  openModal("modal-booking");
}
window.editBooking = id=>openBookingModal(state.bookings.find(b=>b.id===id));
el("btn-add-booking").addEventListener("click",()=>openBookingModal());
el("close-booking").addEventListener("click",()=>closeModal("modal-booking"));
el("cancel-booking").addEventListener("click",()=>closeModal("modal-booking"));
el("modal-booking").addEventListener("click",e=>{ if(e.target===el("modal-booking")) closeModal("modal-booking"); });

el("save-booking").addEventListener("click", async ()=>{
  const title=el("b-title").value.trim(), date=el("b-date").value;
  if (!title||!date) return alert("Title and date are required.");
  const isRoute = currentBkType==="flight"||currentBkType==="train";
  const data = {
    type:currentBkType, title, ref:el("b-ref").value.trim()||"—", date,
    time:el("b-time").value||"",
    from:isRoute?el("b-from").value.trim():"",
    to:  isRoute?el("b-to").value.trim():"",
    location:isRoute?"":el("b-location").value.trim(),
    attachments:[...pendingAttachments],
    addedBy:currentUser.uid
  };
  try{
    if (editingBookingId){ await updateDoc(groupDoc("bookings",editingBookingId),data); }
    else { data.status="upcoming"; await addDoc(groupCol("bookings"),data); }
    closeModal("modal-booking");
  } catch(e){ alert("Error saving: "+e.message); }
});

document.querySelectorAll("#bk-filters .chip").forEach(btn=>{
  btn.addEventListener("click",()=>{
    bkFilter=btn.dataset.filter;
    document.querySelectorAll("#bk-filters .chip").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active"); renderBookings();
  });
});

// ── PROGRESS ─────────────────────────────────────────────────
function renderProgress(){
  const total=state.bookings.length, done=state.bookings.filter(b=>b.status==="done").length;
  const pct=total?Math.round(done/total*100):0;
  el("prog-pct").textContent=pct+"%"; el("prog-bar").style.width=pct+"%";
  el("prog-done-lbl").textContent=done+" done"; el("prog-left-lbl").textContent=(total-done)+" remaining";
  const types=["flight","train","hotel","experience"];
  el("prog-metrics").innerHTML=types.map(t=>{
    const all=state.bookings.filter(b=>b.type===t), d=all.filter(b=>b.status==="done").length;
    return `<div class="metric"><div class="metric-val">${d}/${all.length}</div><div class="metric-lbl">${typeIcons[t]} ${t}s</div></div>`;
  }).join("");
  el("prog-timeline").innerHTML=state.bookings.map(b=>`
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:18px">${typeIcons[b.type]||"📌"}</span>
      <div style="flex:1;font-size:13px">${b.title}</div>
      <span style="font-size:12px;color:var(--text2)">${b.date}${b.time?" "+b.time:""}</span>
      <span class="badge badge-${b.status}">${b.status}</span>
    </div>`).join("");
}

// ── PACKING ──────────────────────────────────────────────────
function renderPacking(){
  const items=packFilter==="all"?state.packing:state.packing.filter(p=>p.cat===packFilter);
  const done=state.packing.filter(p=>p.done).length;
  const pct=state.packing.length?Math.round(done/state.packing.length*100):0;
  el("pack-pct").textContent=pct+"%"; el("pack-bar").style.width=pct+"%";
  const list=el("pack-list");
  if (!items.length){ list.innerHTML='<div class="no-data">No items</div>'; return; }
  list.innerHTML=items.map(p=>`
    <div class="check-item">
      <input type="checkbox" id="pk${p.id}" ${p.done?"checked":""} onchange="togglePack('${p.id}',${p.done})">
      <label for="pk${p.id}" class="${p.done?"done":""}">${p.label}</label>
      <span class="item-cat">${p.cat}</span>
      <div class="pack-item-actions">
        <button class="btn-edit" onclick="editPack('${p.id}')">Edit</button>
        <button class="btn-delete" onclick="askDelete('packing','${p.id}')">Del</button>
      </div>
    </div>`).join("");
}
window.togglePack = async (id,current)=>{ await updateDoc(groupDoc("packing",id),{done:!current}); };

function openPackModal(p=null){
  editingPackId=p?p.id:null;
  el("modal-pack-title").textContent=p?"Edit item":"Add item";
  el("p-label").value=p?p.label:""; el("p-cat").value=p?p.cat:"Documents";
  openModal("modal-pack");
}
window.editPack = id=>openPackModal(state.packing.find(p=>p.id===id));
el("btn-add-pack").addEventListener("click",()=>openPackModal());
el("close-pack").addEventListener("click",()=>closeModal("modal-pack"));
el("cancel-pack").addEventListener("click",()=>closeModal("modal-pack"));
el("modal-pack").addEventListener("click",e=>{ if(e.target===el("modal-pack")) closeModal("modal-pack"); });
el("save-pack").addEventListener("click", async ()=>{
  const label=el("p-label").value.trim(); if(!label) return alert("Item name required.");
  const data={cat:el("p-cat").value,label,addedBy:currentUser.uid};
  if (editingPackId){ await updateDoc(groupDoc("packing",editingPackId),data); }
  else { data.done=false; await addDoc(groupCol("packing"),data); }
  closeModal("modal-pack");
});
document.querySelectorAll("#pack-filters .chip").forEach(btn=>{
  btn.addEventListener("click",()=>{
    packFilter=btn.dataset.filter;
    document.querySelectorAll("#pack-filters .chip").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active"); renderPacking();
  });
});

// ── PLANNER ──────────────────────────────────────────────────
function renderPlanner(){
  const cities=[...new Set(state.activities.map(a=>a.city))].sort();
  if (!currentCity&&cities.length) currentCity=cities[0];
  el("city-pills").innerHTML=cities.map(c=>
    `<button class="city-pill ${c===currentCity?"active":""}" onclick="selectCity('${c}')">${c}</button>`
  ).join("");
  const byDate={};
  state.activities.filter(a=>a.city===currentCity).forEach(a=>{
    if (!byDate[a.date]) byDate[a.date]={};
    if (!byDate[a.date][a.slot]) byDate[a.date][a.slot]=[];
    byDate[a.date][a.slot].push(a);
  });
  const listEl=el("planner-list");
  if (!Object.keys(byDate).length){ listEl.innerHTML='<div class="no-data">No activities for this city yet</div>'; return; }
  listEl.innerHTML=Object.keys(byDate).sort().map(d=>`
    <div class="day-card">
      <div class="day-title">${d}</div>
      ${["Morning","Afternoon","Evening"].filter(s=>byDate[d][s]).map(s=>`
        <div class="slot-label">${s}</div>
        ${byDate[d][s].map(a=>`
          <div class="activity-item">
            ${a.label}${a.time?` <span style="font-size:11px;color:var(--text3)">· ${a.time}</span>`:""}
            ${a.location?`<br><a class="location-link" href="${mapsUrl(a.location)}" target="_blank">📍 ${a.location}</a>`:""}
            <div class="activity-actions">
              <button class="btn-edit" onclick="editActivity('${a.id}')">Edit</button>
              <button class="btn-delete" onclick="askDelete('activities','${a.id}')">Delete</button>
            </div>
          </div>`).join("")}
      `).join("")}
    </div>`).join("");
}
window.selectCity = c=>{ currentCity=c; renderPlanner(); };

function openActivityModal(a=null){
  editingActivityId=a?a.id:null;
  el("modal-activity-title").textContent=a?"Edit activity":"Add activity";
  el("a-label").value=a?a.label:""; el("a-city").value=a?a.city:"";
  el("a-date").value=a?a.date:""; el("a-time").value=a?(a.time||""):"";
  el("a-slot").value=a?a.slot:"Morning"; el("a-location").value=a?(a.location||""):"";
  openModal("modal-activity");
}
window.editActivity = id=>openActivityModal(state.activities.find(a=>a.id===id));
el("btn-add-activity").addEventListener("click",()=>openActivityModal());
el("close-activity").addEventListener("click",()=>closeModal("modal-activity"));
el("cancel-activity").addEventListener("click",()=>closeModal("modal-activity"));
el("modal-activity").addEventListener("click",e=>{ if(e.target===el("modal-activity")) closeModal("modal-activity"); });
el("save-activity").addEventListener("click", async ()=>{
  const label=el("a-label").value.trim(), city=el("a-city").value.trim(), date=el("a-date").value;
  if (!label||!city||!date) return alert("Name, city and date are required.");
  currentCity=city;
  const data={city,date,slot:el("a-slot").value,label,time:el("a-time").value||"",location:el("a-location").value.trim()||"",addedBy:currentUser.uid};
  if (editingActivityId){ await updateDoc(groupDoc("activities",editingActivityId),data); }
  else { await addDoc(groupCol("activities"),data); }
  closeModal("modal-activity");
});

// ── EXPENSES ─────────────────────────────────────────────────
function renderExpenses(){
  const total  = state.expenses.reduce((s,e)=>s+(e.amount||0),0);
  const budget = getBudget();
  const budgetSet = budget > 0;
  el("exp-metrics").innerHTML=`
    <div class="metric"><div class="metric-val">€${total.toLocaleString()}</div><div class="metric-lbl">Total spent</div></div>
    <div class="metric"><div class="metric-val">€${Math.round(total/(state.members.length||1)).toLocaleString()}</div><div class="metric-lbl">Per person</div></div>
    <div class="metric ${!budgetSet?"metric-unset":""}">
      <div class="metric-val">${budgetSet?"€"+(budget-total).toLocaleString():'<span style="font-size:14px;color:var(--text3)">Not set</span>'}</div>
      <div class="metric-lbl">Budget left ${isAdmin()?'<span onclick="openBudgetSettings()" style="cursor:pointer;color:var(--accent);font-size:11px">✏️</span>':""}</div>
    </div>
    <div class="metric">
      <div class="metric-val">${budgetSet?Math.round(total/budget*100)+"%":'—'}</div>
      <div class="metric-lbl">Of budget</div>
    </div>`;
  const byCat={};
  state.expenses.forEach(e=>{ byCat[e.cat]=(byCat[e.cat]||0)+(e.amount||0); });
  const maxVal=Math.max(...Object.values(byCat),1);
  el("exp-chart").innerHTML=Object.entries(byCat).map(([cat,amt])=>`
    <div class="cat-bar-row">
      <span class="cat-bar-label">${cat}</span>
      <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${Math.round(amt/maxVal*100)}%;background:${catColors[cat]||"#888"}"></div></div>
      <span class="cat-bar-amt">€${amt}</span>
    </div>`).join("")||'<div class="no-data" style="padding:8px 0">No expenses yet</div>';
  el("exp-list").innerHTML=state.expenses.length?state.expenses.map(e=>`
    <div class="expense-row">
      <div><div class="exp-label">${e.label}</div><div class="exp-meta">${e.cat} · ${e.city}</div></div>
      <div class="exp-actions">
        <div class="exp-amt">€${e.amount}</div>
        <div style="display:flex;gap:4px">
          <button class="btn-edit" onclick="editExpense('${e.id}')">Edit</button>
          <button class="btn-delete" onclick="askDelete('expenses','${e.id}')">Del</button>
        </div>
      </div>
    </div>`).join(""):'<div class="no-data">No expenses yet</div>';
}

window.openBudgetSettings = function(){
  if (!isAdmin()) return;
  el("s-budget").value = currentGroup.budget||"";
  openModal("modal-settings");
};

function openExpenseModal(e=null){
  editingExpenseId=e?e.id:null;
  el("modal-expense-title").textContent=e?"Edit expense":"Add expense";
  el("e-label").value=e?e.label:""; el("e-amount").value=e?e.amount:"";
  el("e-city").value=e?e.city:""; el("e-cat").value=e?e.cat:"Transport";
  openModal("modal-expense");
}
window.editExpense = id=>openExpenseModal(state.expenses.find(e=>e.id===id));
el("btn-add-expense").addEventListener("click",()=>openExpenseModal());
el("close-expense").addEventListener("click",()=>closeModal("modal-expense"));
el("cancel-expense").addEventListener("click",()=>closeModal("modal-expense"));
el("modal-expense").addEventListener("click",e=>{ if(e.target===el("modal-expense")) closeModal("modal-expense"); });
el("save-expense").addEventListener("click", async ()=>{
  const label=el("e-label").value.trim(), amount=el("e-amount").value;
  if (!label||!amount) return alert("Description and amount required.");
  const data={cat:el("e-cat").value,city:el("e-city").value.trim()||"—",label,amount:parseFloat(amount),addedBy:currentUser.uid};
  if (editingExpenseId){ await updateDoc(groupDoc("expenses",editingExpenseId),data); }
  else { await addDoc(groupCol("expenses"),data); }
  closeModal("modal-expense");
});

// ── MEMBERS (header avatars) ──────────────────────────────────
function renderMembers(){
  el("app-avatars").innerHTML=state.members.slice(0,5).map((m,i)=>
    `<div class="avatar ${avatarColors[i%avatarColors.length]}" title="${m.displayName}">${initials(m.displayName)}</div>`
  ).join("");
  el("app-trip-sub").textContent=state.members.length+" traveller"+(state.members.length!==1?"s":"");
}

// ── PHOTOS ───────────────────────────────────────────────────
function renderPhotos(){
  const grid=el("photo-grid"), noP=el("no-photos");
  if (!state.photos.length){ grid.innerHTML=""; noP.style.display="block"; return; }
  noP.style.display="none";
  grid.innerHTML=state.photos.map(p=>`
    <div style="position:relative">
      <div class="photo-thumb" onclick="viewPhoto('${p.id}')"><img src="${p.url}" alt="${p.label}" loading="lazy"></div>
      <button onclick="askDelete('photos','${p.id}')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);border:none;color:#fff;border-radius:50%;width:22px;height:22px;font-size:11px;cursor:pointer">✕</button>
    </div>`).join("");
}
window.viewPhoto = function(id){
  const p=state.photos.find(x=>x.id===id); if(!p) return;
  viewAttachment({name:p.label,type:"image/jpeg",data:p.url});
};

function compressToBase64(file,maxWidth=800,quality=0.7){
  return new Promise((res,rej)=>{
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      const scale=Math.min(1,maxWidth/img.width);
      const canvas=document.createElement("canvas");
      canvas.width=Math.round(img.width*scale); canvas.height=Math.round(img.height*scale);
      canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
      res(canvas.toDataURL("image/jpeg",quality));
    };
    img.onerror=rej; img.src=url;
  });
}

el("photo-input").addEventListener("change", async function(){
  const label=document.querySelector("label.photo-label");
  if (label) label.childNodes[0].textContent="Saving…";
  for (const file of this.files){
    try{
      const base64=await compressToBase64(file);
      await addDoc(groupCol("photos"),{url:base64,label:file.name.replace(/\.[^.]+$/,""),uploadedBy:currentUser.uid,at:serverTimestamp()});
    } catch(e){ alert("Could not save photo: "+e.message); }
  }
  if (label) label.childNodes[0].textContent="+ Photo";
  this.value="";
});
