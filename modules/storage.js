// modules/storage.js (pure JS ES module)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
// modules/storage.js
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";



/* Firebase init */
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

export async function deletePlayerState(gameId, seat) {
  const db = getFirestore();
  const ref = doc(db, "games", gameId, "players", String(seat));
  await deleteDoc(ref);
}


export async function wipePlayerState(gameId, seat, payload = {}) {
  const db = getFirestore();
  const ref = doc(db, `games/${gameId}/players`, String(seat));
  const blank = {
    Deck: [],
    Hand: [],
    Table: [],
    Graveyard: [],
    Exile: [],
    Commander: null,
    Turn: 0,
    updatedAt: serverTimestamp(),
    ...payload
  };
  await setDoc(ref, blank, { merge: false }); // full overwrite
}

export async function initStorage(){
  app  = initializeApp(firebaseConfig);
  db   = getFirestore(app);
  auth = getAuth(app);
  await signInAnonymously(auth).catch(console.error);
  return { app, db, auth };
}

const playerRef = (gameId, seat) => doc(db, "games", gameId, "players", String(seat));
const metaRef   = (gameId)       => doc(db, "games", gameId, "meta", "meta");

const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

function normalizeCardForSave(c){
  if(!c) return null;
  const base = pick(c, [
    "id","name","frontImg","backImg","face","tapped","pt",
    "types","additionalEffects","power","toughness","_scry","x","y","z"
  ]);
  base.img  = c.frontImg || c.img || "";
  base.back = c.backImg  || c.back || "";
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

export async function saveSnapshot(gameId, seat, state){
  const payload = buildPlayerPayloadFromState(state);
  await setDoc(playerRef(gameId, seat), payload, { merge: true });
}

const _debouncers = new Map();
export function savePlayerStateDebounced(gameId, seat, state, ms=300){
  const key = `${gameId}::${seat}`;
  clearTimeout(_debouncers.get(key));
  _debouncers.set(key, setTimeout(()=> saveSnapshot(gameId, seat, state).catch(console.error), ms));
}

export async function loadPlayerState(gameId, seat){
  const snap = await getDoc(playerRef(gameId, seat));
  return snap.exists() ? snap.data() : null;
}

export async function loadMeta(gameId){
  const snap = await getDoc(metaRef(gameId));
  return snap.exists() ? snap.data() : null;
}

export async function saveMeta(gameId, patch){
  await setDoc(metaRef(gameId), { ...patch, timestamp: Date.now() }, { merge: true });
}

export function startPlayerPollers(gameId, mySeat, playerCount, onSeatData, {intervalMs=100, cardBackUrl} = {}){
  const t = setInterval(async ()=>{
    if(!gameId) return;
    for(let s=1; s<=playerCount; s++){
      if(s === mySeat) continue;
      const data = await loadPlayerState(gameId, s);
      if(!data) continue;
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

export function startMetaPoller(gameId, onMeta, intervalMs=100){
  const t = setInterval(async ()=>{
    if(!gameId) return;
    const m = await loadMeta(gameId);
    if(m) onMeta?.(m);
  }, intervalMs);
  return ()=> clearInterval(t);
}


const combatRef = (gameId) => doc(getFirestore(), "games", gameId, "combat", "current");

export async function readCombat(gameId){
  if (!gameId) return null;
  const snap = await getDoc(combatRef(gameId));
  return snap.exists() ? snap.data() : null;
}

export async function writeCombat(gameId, patch){
  if (!gameId) return;
  await setDoc(combatRef(gameId), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
}

export async function resetCombat(gameId){
  if (!gameId) return;
  await deleteDoc(combatRef(gameId)).catch(()=>{});
}

export async function writeCombatInitiated(gameId, attackingSeat){
  await writeCombat(gameId, { combatInitiated: 1, attackingSeat: Number(attackingSeat)||0 });
}


export async function saveAttacks(gameId, attacks){
  // attacks: { [attackerCid]: { defenderSeat, power, cardMeta } }
  await writeCombat(gameId, { attacks });
}

export async function saveBlocks(gameId, defenderSeat, blocksForSeat){
  // blocksForSeat: { [attackerCid]: [blockerCid, ...] } (ordered)
  await writeCombat(gameId, { 
    blocksByDefender: { [defenderSeat]: blocksForSeat }
  });
}

export async function saveOutcome(gameId, outcome){
  // outcome: { deadCids:[], playerDamage:{seat:delta}, lifelinkGains:{seat:+}, notes:[] }
  await writeCombat(gameId, { outcome });
}

// modules/storage.js
export async function clearCombatInitiated(gameId){
  return saveMeta(gameId, {
    combatInitiated: 0,
    attackerSeat: 0,
    attacks: null,
    blocksByDefender: null,
    outcome: null,
    combatUpdatedAt: Date.now()
  });
}

// (handy too)
export async function setCombatInitiated(gameId, attackerSeat, payload = {}){
  return saveMeta(gameId, {
    combatInitiated: 1,
    attackerSeat,
    ...payload,
    combatUpdatedAt: Date.now()
  });
}
