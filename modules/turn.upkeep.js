// ================================
// FILE: modules/turn.upkeep.js
// Turn/Upkeep helpers
// - Hooks End Turn button
// - Untaps opponent's tapped cards
// - Skips cards whose Oracle text says "doesn't/does not untap"
// ================================

// ✨ ADDED: imports for global EOT cleanup (kept non-breaking)
import ActivatedAbilities from './activated.abilities.js';
import { supaReady } from './env.supabase.js';
let supabase = null; supaReady.then(c => { supabase = c; });

// ✨ ADDED: tiny helper to resolve current room consistently
function currentRoom(){
  return window.CardAttributes?.roomId ||
         window.ROOM_ID ||
         window.RTC?.roomId ||
         document.getElementById('roomId')?.value ||
         window.AppState?.room_id || 'room1';
}

/** Liberal matcher for "doesn't/does not untap" in oracle text */
const NO_UNTAP_RE = /\b(does\s*not|doesn[’']?t)\s+untap\b/i;

/** Returns true if oracle text indicates the card shouldn't untap. */
function textSaysDoesNotUntap(oracle = '') {
  return !!oracle && NO_UNTAP_RE.test(oracle);
}

/** Try to read oracle text from DOM or CID cache. */
function getOracleFor(el) {
  if (!el) return '';
  // 1) dataset from DOM
  if (el.dataset && el.dataset.oracle) return el.dataset.oracle;

  // 2) CID cache via global helper (your app exposes this)
  const cid = el.dataset?.cid;
  if (cid && typeof window.getCardDataById === 'function') {
    const data = window.getCardDataById(cid);
    if (data?.oracle_text) return data.oracle_text;
  }
  return '';
}

/** Local untap + optional RTC broadcast so peers mirror it. */
function untapEl(el, broadcast = true) {
  el.classList.remove('tapped');
  el.style.setProperty('--tap-rot', '0deg');
  const cid = el?.dataset?.cid;
  if (broadcast && cid && window.RTC && typeof window.RTC.send === 'function') {
    window.RTC.send({ type: 'tap', cid, tapped: false });
  }
}

/** Determine opponent seat from your AppState */
function getOpponentSeat() {
  // Preferred: AppState.mySeat (1-based)
  const mySeat = window.AppState?.mySeat;
  if (typeof mySeat === 'number') return mySeat === 1 ? 2 : 1;

  // Fallback helper if you expose one
  if (typeof window.otherSeat === 'function') return window.otherSeat();

  // Default to 2 if unknown
  return 2;
}

/** Core action: untap all opponent cards unless oracle forbids it. */
export function runAutoUntapOpponent() {
  const opp = getOpponentSeat();
  const tappedOpp = document.querySelectorAll(`.card.tapped[data-owner="${opp}"]`);
  for (const el of tappedOpp) {
    const oracle = getOracleFor(el);
    if (textSaysDoesNotUntap(oracle)) continue;
    untapEl(el, true);
  }
}

// ✨ ADDED: global EOT scrub (server sweep; idempotent)
async function clearAllEOTInRoom(room_id){
  try{
    if (!supabase) supabase = await supaReady;

    // fetch all rows for this room
    const { data: rows, error } = await supabase
      .from('card_attributes')
      .select('cid, owner_seat, json')
      .eq('room_id', room_id);

    if (error) { console.warn('[turn.upkeep] fetch card_attributes error', error); return; }

    for (const row of (rows||[])){
      const json = { ...(row?.json || {}) };

      // strip tempEffects with mode==='EOT'
      if (Array.isArray(json.tempEffects)) {
        json.tempEffects = json.tempEffects.filter(e => e?.mode !== 'EOT');
      }

      // revert tempPT with mode==='EOT' and strip them
      if (Array.isArray(json.tempPT) && json.tempPT.length){
        let dP = 0, dT = 0;
        for (const eff of json.tempPT){
          if (eff?.mode === 'EOT'){
            dP += Number(eff?.pow || 0);
            dT += Number(eff?.tgh || 0);
          }
        }
        if (dP !== 0 || dT !== 0){
          const pm = json.ptMod || (json.ptMod = { pow:0, tgh:0 });
          pm.pow = Number(pm.pow||0) - dP;
          pm.tgh = Number(pm.tgh||0) - dT;
        }
        json.tempPT = json.tempPT.filter(e => e?.mode !== 'EOT');
      }

      // Only write if something changed
      // (Quick check: if both arrays are absent/empty, nothing to do)
      const hadTemp =
        (Array.isArray(row?.json?.tempEffects) && row.json.tempEffects.some(e=>e?.mode==='EOT')) ||
        (Array.isArray(row?.json?.tempPT) && row.json.tempPT.some(e=>e?.mode==='EOT'));

      if (hadTemp){
        await supabase.from('card_attributes').upsert({
          room_id,
          cid: row.cid,
          owner_seat: row.owner_seat || 1,
          json,
          updated_by_seat: row.owner_seat || 1
        });
      }
    }
  } catch(e){
    console.warn('[turn.upkeep] clearAllEOTInRoom failed', e);
  }
}

// ✨ ADDED: one call that performs both fast-path + sweep
async function endTurnEOTCleanup(){
  const rid = currentRoom();

  // Fast path: let ActivatedAbilities do its thing (uses local tickets)
  try { await ActivatedAbilities?.clearEOT?.(rid); } catch(e){ console.warn('[turn.upkeep] clearEOT (tickets) failed', e); }

  // Authoritative sweep: ensure ALL EOT effects in room are removed
  await clearAllEOTInRoom(rid);

  try { window.RTC?.send?.({ type:'turn:end', room_id: rid }); } catch {}
}

/**
 * Wire once to the End Turn button.
 * @param {Object} opts
 * @param {string} opts.endTurnBtnSelector - CSS selector for your End Turn button
 */
export function initTurnUpkeep({ endTurnBtnSelector = '#endTurnBtn' } = {}) {
  const btn = document.querySelector(endTurnBtnSelector);
  if (!btn) return;

  // Idempotent: avoid double-binding on hot reloads
  if (btn.dataset.turnUpkeepBound === '1') return;
  btn.dataset.turnUpkeepBound = '1';

  // Append behavior after your existing click handlers
  // [END TURN HANDLER]
btn.addEventListener('click', async () => {
  try { runAutoUntapOpponent(); } catch (e) { console.error('[turn.upkeep] run failed', e); }
  // ✨ ADDED: clear all EOT effects for BOTH players (entire room)
  try { await endTurnEOTCleanup(); } catch (e) { console.error('[turn.upkeep] EOT cleanup failed', e); }
  try { ActivatedAbilities?.resetDrawCounters?.(); } catch {}    // NEW: reset per-turn draw counters
});

}

export default { initTurnUpkeep, runAutoUntapOpponent };
