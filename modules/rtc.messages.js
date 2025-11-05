// modules/rtc.messages.js

// ---------- RTC helpers + logging ----------
function dcState(dc){
  try { return dc?.readyState || '(no-dc)'; } catch { return '(err)'; }
}

function rtcSend(msg){
  const dc = window.peer?.dataChannel || window.peer; // be flexible
  const state = dcState(dc);
  const pretty = JSON.stringify(msg);
  if (!window.peer || !window.peer.send){
    console.warn('[RTC:send:SKIP] no peer.send', {state, msg});
    return false;
  }
  try{
    window.peer.send(msg);
    //console.log('%c[RTC:send]', 'color:#0af', {state, msg});
    return true;
  }catch(err){
    console.error('[RTC:send:ERROR]', {state, msg, err});
    return false;
  }
}

// [RTC:export] make rtcSend available to UI modules (badges.js, etc.)
window.rtcSend = rtcSend;


// ==== FLIP BROADCAST ==================================================
// Helper: build the minimal payload for a given registry entry + face index
function buildFlipPayload(cid, card, faceIndex, el){
  const face  = card?.faces?.[faceIndex] || card?.faces?.[0] || {};
  const owner = (typeof window.mySeat === 'function' ? window.mySeat() : (window.__LOCAL_SEAT || 1));
  return {
    type: 'flip',
    cid,
    owner, // <--- include the sender's seat
    faceIndex: Number(faceIndex) || 0,
    name: face.name || card?.name || '',
    img:  face.imageUrl || el?.currentSrc || el?.src || '',
    manaCost:  face.manaCost  || '',
    typeLine:  face.typeLine  || '',
    oracle:    face.oracle    || '',
    power:     face.power     || '',
    toughness: face.toughness || '',
    hasFlip:   !!card?.hasFlip
  };
}


// Public convenience if you ever want to send manually from console/UI
window.sendFlipFor = function(cid){
  try{
    const reg = window.DeckData?.getRegisteredCard?.(cid);
    if (!reg) return false;
    const p = buildFlipPayload(cid, reg.card, reg.faceIndex, reg.el);
    return window.rtcSend?.(p) || false;
  }catch(e){ console.warn('[RTC] sendFlipFor error', e); return false; }
};

// Auto-broadcast when local flip happens (deck.load.js dispatches 'card:flipped')
window.addEventListener('card:flipped', (e) => {
  try{
    const { cid, card, faceIndex, el } = e?.detail || {};
    if (!cid || !card) return;
    const payload = buildFlipPayload(cid, card, faceIndex, el);
    window.rtcSend?.(payload);
  }catch(err){ console.warn('[RTC] flip broadcast failed', err); }
});


// --- Deck visual mirror ------------------------------------------------
(function wireDeckVisualMirror(){
  function onDeckVisual(msg){
    // Remote says "my player deck has X". On our screen that is the opponent deck.
    if (!msg || msg.type !== 'deck-visual') return;
    const which = (msg.who === 'player') ? 'oppo' : 'player';
    window.setDeckVisual?.(which, !!msg.hasDeck);
  }

  // Try to subscribe via your RTC bus (support both 'data' and 'message' if your bus differs)
  if (typeof window.rtcOn === 'function') {
    window.rtcOn('data',    onDeckVisual);
    window.rtcOn('message', onDeckVisual);
  }

  // Fallback: if your bus re-dispatches DOM events
  window.addEventListener?.('rtc:message', (e)=> onDeckVisual(e?.detail));
})();


// expose + sugar
window.rtcSend = rtcSend;

/** Convenience: broadcast deck visual change for my seat */
window.sendDeckVisual = function(has){
  const seatNum = String(typeof window.mySeat === 'function' ? window.mySeat() : 1).match(/\d+/)?.[0] || '1';
  const seatKey = `P${seatNum}`;
  rtcSend({ type: 'deck_visual', seat: seatKey, has: !!has });
};


/** Convenience: broadcast attackers sliding into the combat band */
window.sendCombatCharge = function(cids){
  if (!Array.isArray(cids)) cids = [];
  rtcSend({ type: 'combat_charge', cids });
};

/** Convenience: broadcast blocker layout mapping { attackerCid: [blockerCid...] } */
window.sendCombatBlocks = function(map){
  try {
    if (!map || typeof map !== 'object') map = {};
    window.rtcSend?.({ type: 'combat_blocks', map });
  } catch {}
};

// ---- Turn sync helpers --------------------------------------------
window.sendTurnSync = function(){
  try {
    const snap = window.Turn?.serialize?.();
    if (snap) window.rtcSend?.({ type: 'turn_sync', state: snap });
  } catch (e) { console.warn('[turn_sync] send failed', e); }
};

// Console helper: choose who attacks first this game, then broadcast
// Usage: setFirstAttacker('P2')  or  setFirstAttacker(2)
window.setFirstAttacker = function(seat){
  const n = String(seat).match(/\d+/)?.[0] || '1';
  window.Turn?.hydrate?.({ activeSeat: Number(n), turn: 1, phase: 'main1' });
  window.sendTurnSync?.();
};

