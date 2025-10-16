// ================================
// FILE: modules/turn.upkeep.js
// Turn/Upkeep helpers
// - Hooks End Turn button
// - Untaps opponent's tapped cards
// - Skips cards whose Oracle text says "doesn't/does not untap"
// ================================

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
  btn.addEventListener('click', () => {
    try { runAutoUntapOpponent(); } catch (e) { console.error('[turn.upkeep] run failed', e); }
  });
}

export default { initTurnUpkeep, runAutoUntapOpponent };
