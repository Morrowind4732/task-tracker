<!-- modules/storage.js -->
<script type="module">
/* Storage module for GitHub Pages + Firestore (v10) */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* ================= Firebase init ================= */
const firebaseConfig = {
  apiKey: "AIzaSyAqPT52Us-vWv4GNRYPgGCQ2I1SdsLsXyI",
  authDomain: "task-tracker-73b77.firebaseapp.com",
  projectId: "task-tracker-73b77",
  storageBucket: "task-tracker-73b77.firebasestorage.app",
  messagingSenderId: "795274673000",
  appId: "1:795274673000:web:0ea07130e45c72384134dd",
  measurementId: "G-VLW5KLY4FF"
};

let app, db, auth;

/* Public: call once from V2.html */
async function initStorage(){
  app  = initializeApp(firebaseConfig);
  db   = getFirestore(app);
  auth = getAuth(app);
  await signInAnonymously(auth).catch(console.error);
  return { app, db, auth };
}

/* ================= Firestore paths ================= */
const playerRef = (gameId, seat) => doc(db, "games", gameId, "players", String(seat));
const metaRef   = (gameId)       => doc(db, "games", gameId, "meta", "meta");

/* ================= Helpers ================= */
const pick = (obj, keys) => {
  const out = {};
  for(const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

function normalizeCardForSave(c){
  if(!c) return null;
  // keep only what we need to perfectly restore the view
  const base = pick(c, [
    "id","name","frontImg","backImg","face","tapped","pt",
    "types","additionalEffects","power","toughness","_scry"
  ]);
  // standardize image keys for storage
  base.img  = c.frontImg || c.img || "";
  base.back = c.backImg  || c.back || "";
  // world placement (for table/commander)
  if (c.x !== undefined) base.x = c.x;
  if (c.y !== undefined) base.y = c.y;
  if (c.z !== undefined) base.z = c.z;
  return base;
}

function buildPlayerPayloadFromState(state){
  return {
    Seat: state.mySeat,
    Deck:      (state.deck  || []).map(normalizeCardForSave),
    Hand:      (state.hand  || []).map(normalizeCardForSave),
    Table:     (state.table || []).map(normalizeCardForSave),
    Graveyard: (state.gy    || []).map(normalizeCardForSave),
    Exile:     (state.exile || []).map(normalizeCardForSave),
    Commander: state.tableCommander ? normalizeCardForSave(state.tableCommander) : null,
    updatedAt: serverTimestamp()
  };
}

/* ================= Saves & Loads ================= */
async function saveSnapshot(gameId, seat, state){
  const payload = buildPlayerPayloadFromState(state);
  await setDoc(playerRef(gameId, seat), payload, { merge: true });
}

const _debouncers = new Map();
function savePlayerStateDebounced(gameId, seat, state, ms=300){
  const key = `${gameId}::${seat}`;
  clearTimeout(_debouncers.get(key));
  _debouncers.set(key, setTimeout(()=> saveSnapshot(gameId, seat, state).catch(console.error), ms));
}

async function loadPlayerState(gameId, seat){
  const snap = await getDoc(playerRef(gameId, seat));
  return snap.exists() ? snap.data() : null;
}

async function loadMeta(gameId){
  const snap = await getDoc(metaRef(gameId));
  return snap.exists() ? snap.data() : null;
}

async function saveMeta(gameId, patch){
  await setDoc(metaRef(gameId), { ...patch, timestamp: Date.now() }, { merge: true });
}

/* ================= Pollers (optional) ================= */
function startPlayerPollers(gameId, mySeat, playerCount, onSeatData, {intervalMs=100, cardBackUrl} = {}){
  const t = setInterval(async ()=>{
    if(!gameId) return;
    for(let s=1; s<=playerCount; s++){
      if(s === mySeat) continue;
      const data = await loadPlayerState(gameId, s);
      if(!data) continue;

      // mask opponent hand with backs only
      const masked = { ...data };
      if (Array.isArray(masked.Hand)){
        masked.Hand = masked.Hand.map(h => ({
          id: h?.id || `h_${Math.random().toString(36).slice(2)}`,
          img: cardBackUrl || h?.back || h?.img || "",
          back: cardBackUrl || h?.back || h?.img || ""
        }));
      }
      onSeatData?.(s, masked);
    }
  }, intervalMs);
  return ()=> clearInterval(t);
}

function startMetaPoller(gameId, onMeta, intervalMs=100){
  const t = setInterval(async ()=>{
    if(!gameId) return;
    const m = await loadMeta(gameId);
    if(m) onMeta?.(m);
  }, intervalMs);
  return ()=> clearInterval(t);
}

/* Exports */
export {
  initStorage,
  saveSnapshot,
  savePlayerStateDebounced,
  loadPlayerState,
  loadMeta,
  saveMeta,
  startPlayerPollers,
  startMetaPoller
};
</script>
