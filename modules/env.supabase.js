// modules/env.supabase.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// hardcode for now (you said you'll rotate after testing)
const SUPABASE_URL = "https://uvrnxrmwoyhswzldhcul.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2cm54cm13b3loc3d6bGRoY3VsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4NDgyMDgsImV4cCI6MjA3NTQyNDIwOH0.vOefq7j90s4IF951U1P2-69xhLb5Z5rvdAZ875A1cXo";

// 2) Create a client
let supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 3) Expose globally so other modules (combat.store.js) can use it or fall back to REST
window.supabase     = supa;
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_KEY = SUPABASE_ANON_KEY;

// keep a copy in window.env for consistency
window.env = Object.assign({}, window.env, {
  supabase: { url: SUPABASE_URL, key: SUPABASE_ANON_KEY }
});

// 4) Optional: helper you can import elsewhere if you want
export { supa as supabase };
const subs = new Map();

export async function initStorage(){
  supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

window.supabase = supa;                           // so CombatStore can use realtime or queries
window.SUPABASE_URL = SUPABASE_URL;               // so CombatStore REST fallback works
window.SUPABASE_KEY = SUPABASE_ANON_KEY;
window.env = Object.assign({}, window.env, { supabase: {
  url: SUPABASE_URL, key: SUPABASE_ANON_KEY
}});

// ---- Turn state (live) -----------------------------------
export async function saveTurnState(gameId, { turnSeat, turnIndex }){
  if (!gameId) return null;
  const payload = {
    game_id: gameId,
    turn_seat: Number(turnSeat || 0),
    turn_index: Number(turnIndex || 0),
    updated_at: new Date().toISOString()
  };
  const { error } = await supa.from('turn_state').upsert(payload);
  if (error) console.warn('[saveTurnState]', error);
  return payload;
}

export async function readTurnState(gameId){
  const { data, error } = await supa
    .from('turn_state')
    .select('*')
    .eq('game_id', gameId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116' && error.code !== 'PGRST123') {
    console.warn('[readTurnState]', error);
  }
  return data || null;
}

// Realtime watcher for live turn seat changes
export function startTurnWatcher(gameId, cb){
  const key = `turn:${gameId}`;
  stop(key);
  const ch = supa.channel(key).on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'turn_state', filter: `game_id=eq.${gameId}` },
    (payload) => cb(payload.new || payload.old || null)
  ).subscribe();
  subs.set(key, ch);
  return () => stop(key);
}

// ---- Turn snapshots (history) ----------------------------
// snapshot shape = whatever you store in player_states.state
export async function writeTurnSnapshot(gameId, turnIndex, seat, snapshot){
  const row = {
    game_id: gameId,
    turn_index: Number(turnIndex || 0),
    seat: Number(seat || 0),
    snapshot: snapshot || {},
    created_at: new Date().toISOString()
  };
  const { error } = await supa.from('turn_snapshots').upsert(row);
  if (error) console.warn('[writeTurnSnapshot]', error);
  return row;
}

// Convenience: persist snapshots for ALL seats for a given turn
// env.supabase.js
export async function snapshotAllSeatsToTable(gameId, turnIndex){
  const players = Number(window.AppState?.playerCount || 2);
  const rows = [];
  for (let s = 1; s <= players; s++){
    const doc = await loadPlayerState(gameId, s) || {};
    const snap = {
      Deck:      doc.Deck      ?? doc.deck      ?? [],
      Hand:      doc.Hand      ?? doc.hand      ?? [],
      Table:     doc.Table     ?? doc.table     ?? [],
      Graveyard: doc.Graveyard ?? doc.gy        ?? doc.graveyard ?? [],
      Exile:     doc.Exile     ?? doc.exile     ?? [],
      Commander: doc.Commander ?? doc.tableCommander ?? null,
      Turn:      Number(doc.Turn || 0)
    };
    rows.push({
      game_id: gameId, turn_index: Number(turnIndex||0), seat: s,
      snapshot: snap, created_at: new Date().toISOString()
    });
  }
  const { error } = await supa.from('turn_snapshots').upsert(rows);
  if (error) console.warn('[snapshotAllSeatsToTable]', error);
  return rows.length;
}



/* ------------ Player state (per seat) ------------ */
export async function savePlayerStateDebounced(gameId, seat, payload){
  const { error } = await supa
    .from("player_states")
    .upsert({
      game_id: gameId,
      seat,
      state: payload,
      updated_at: new Date().toISOString()
    })
    .eq("game_id", gameId).eq("seat", seat);
  if (error) console.error("[supabase upsert]", error);
}

export async function loadPlayerState(gameId, seat){
  const { data, error } = await supa
    .from("player_states")
    .select("state")
    .eq("game_id", gameId).eq("seat", seat).single();
  if (error && error.code !== "PGRST116") console.error("[supabase select]", error);
  return data?.state || null;
}

export async function deletePlayerState(gameId, seat){
  await supa.from("player_states").delete().eq("game_id", gameId).eq("seat", seat);
}
export async function wipePlayerState(gameId, seat, blank){
  await savePlayerStateDebounced(gameId, seat, blank || {});
}

/* ---------------------- Meta (seat 0) ---------------------- */
// env.supabase.js
export async function saveMeta(gameId, patch) {
  if (!gameId) return {};
  // Read current meta (tolerate no row)
  const { data: row, error: selErr } = await supa
    .from("player_states")
    .select("state")
    .eq("game_id", gameId)
    .eq("seat", 0)
    .maybeSingle(); // avoids 406s

  if (selErr && selErr.code !== "PGRST116" && selErr.code !== "PGRST123") {
    console.warn("[saveMeta select]", selErr);
  }

  const cur = row?.state ?? {};
  const patchObj = (typeof patch === "function") ? patch(cur) : patch;
  const next = { ...cur, ...patchObj };

  const { error: upErr } = await supa
    .from("player_states")
    .upsert({
      game_id: gameId,
      seat: 0,
      state: next,
      updated_at: new Date().toISOString(),
    });

  if (upErr) console.warn("[saveMeta upsert]", upErr);
  return next;
}

export async function loadMeta(gameId){
  const { data } = await supa
    .from("player_states")
    .select("state")
    .eq("game_id", gameId).eq("seat", 0).single();
  return data?.state || null;
}

/* -------------------- Realtime pollers -------------------- */
export function startPlayerPollers(gameId, onChange){
  const key = `players:${gameId}`;
  stop(key);
  const ch = supa.channel(key).on(
    "postgres_changes",
    { event: "*", schema: "public", table: "player_states", filter: `game_id=eq.${gameId}` },
    (payload) => {
      const row = payload.new ?? payload.old;
      if (!row) return;
      onChange(row.seat, payload.new?.state ?? null);
    }
  ).subscribe();
  subs.set(key, ch);
  return () => stop(key);
}

export function startMetaPoller(gameId, cb){
  const key = `meta:${gameId}`;
  stop(key);
  const ch = supa.channel(key).on(
    "postgres_changes",
    { event: "*", schema: "public", table: "player_states", filter: `game_id=eq.${gameId},seat=eq.0` },
    (payload) => cb(payload.new?.state ?? null)
  ).subscribe();
  subs.set(key, ch);
  return () => stop(key);
}

function stop(key){
  const ch = subs.get(key);
  if (ch){ supa.removeChannel(ch); subs.delete(key); }
}


export async function ensureCombatRow(gameId) {
  if (!gameId) return;

  // Is there already a row?
  const { data, error } = await supa
    .from("combats")
    .select("game_id")
    .eq("game_id", gameId)
    .maybeSingle();   // 0 rows -> { data: null, error: null }

  // Log only unexpected errors
  if (error && error.code !== "PGRST116" && error.code !== "PGRST123") {
    console.warn("[ensureCombatRow] select error", error);
  }

  // Create a blank row if missing (safe & idempotent)
  if (!data) {
    await supa
      .from("combats")
      .upsert({
        game_id: gameId,
        data: { combatInitiated: 0, attacks: null, blocksByDefender: null, outcome: null },
        updated_at: new Date().toISOString()
      }, { onConflict: "game_id" }); // important if game_id isn’t the PK
  }
}



/* ----------------- Combat (Supabase table) ----------------- */
async function readCombatRow(gameId){
  const { data, error } = await supa
  .from("combats")
  .select("data")
  .eq("game_id", gameId)
  .maybeSingle();               // <- tolerate 0 rows without 406

// suppress the “no rows” cases; log anything else
if (error && error.code !== "PGRST116" && error.code !== "PGRST123") {
  console.warn("[combat select]", error);
}
return data?.data ?? null;
}
async function writeCombatRow(gameId, patchObj){
  const cur = (await readCombatRow(gameId)) || {};
  const merged = { ...cur, ...patchObj };
  await supa.from("combats").upsert({
    game_id: gameId,
    data: merged,
    updated_at: new Date().toISOString()
  });
  return merged;
}

export async function readCombat(gameId){
  if (!gameId) return null;
  return readCombatRow(gameId);
}
export async function writeCombat(gameId, patch){
  if (!gameId) return;
  await writeCombatRow(gameId, { ...patch, updatedAt: Date.now() });
}
export async function resetCombat(gameId){
  if (!gameId) return;
  // keep the row; just clear fields so the next write doesn't 406
  await writeCombat(gameId, {
    attackingSeat: 0,
    attacks: {},
    blocksByDefender: {},
    recommendedOutcome: null,
    applied: {},
    phase: null,
    epoch: Date.now(),
  });
}

export async function writeCombatInitiated(gameId, attackingSeat){
  await writeCombat(gameId, { combatInitiated: 1, attackingSeat: Number(attackingSeat)||0 });
}
export async function saveAttacks(gameId, attacks){
  await writeCombat(gameId, { attacks });
}
export async function saveBlocks(gameId, defenderSeat, blocksForSeat){
  await writeCombat(gameId, { blocksByDefender: { [defenderSeat]: blocksForSeat } });
}
export async function saveOutcome(gameId, outcome){
  await writeCombat(gameId, { outcome });
}
export async function clearCombatInitiated(gameId){
  return saveMeta(gameId, {
    combatInitiated: 0, attackerSeat: 0, attacks: null, blocksByDefender: null, outcome: null,
    combatUpdatedAt: Date.now()
  });
}
export async function setCombatInitiated(gameId, attackerSeat, payload = {}){
  return saveMeta(gameId, {
    combatInitiated: 1,
    attackerSeat,
    ...payload,
    combatUpdatedAt: Date.now()
  });
}
