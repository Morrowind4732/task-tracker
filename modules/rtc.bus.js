// modules/rtc.bus.js
// RTC Join Popup UI and connection bootstrap
// Public API: initRTCConnectionUI()

import { createPeerRoom } from './net.rtc.js';
import { RTCApply } from './rtc.rules.js';
import { DeckLoading } from './deck.loading.js';

const __MOD = (import.meta?.url || 'unknown').split('/').pop();
window.__modTime(__MOD, 'start');

// Ensure RTCApply exists on both sides before we handle buff/buffRemove.
async function ensureRTCApply() {
  if (window.RTCApply?.recvBuff && window.RTCApply?.recvBuffRemove) return window.RTCApply;
  try {
    if (!window.RTCApply) {
      const mod = await import('./rtc.rules.js');
      window.RTCApply = mod.RTCApply || window.RTCApply;
    }
  } catch (e) {
    console.warn('[RTC] ensureRTCApply failed to import rtc.rules.js', e);
  }
  return window.RTCApply || {};
}

// Force Scryfall card-image URLs to portrait art_crop
function __toArtCrop(url){
  try{
    const u = new URL(url, window.location.href);
    if (u.hostname.endsWith('scryfall.io')){
      u.pathname = u.pathname.replace(/\/(small|normal|large|png|border_crop|art_crop)\//, '/art_crop/');
    }
    return u.toString();
  }catch{
    return url;
  }
}

// === Overlay presence helpers (do NOT force-open) ===========================
// Idempotent: init exactly once per session; never reset _dice/_rolled mid-session.
// Always (re)inject sendDiceRTC so rolls broadcast even if overlay was inited elsewhere.
async function __ensureOverlayReadyNoOpen(){
  try {
    const mod = await import('./portrait.dice.overlay.js');
    const { PortraitOverlay } = mod;

    // Always inject/refresh the sender (safe to call multiple times)
    try {
      PortraitOverlay.setSendDiceRTC((packet) => {
        try {
          console.log('%c[RTC:send overlay:d20]', 'color:#09f;font-weight:bold', packet);
          window.peer?.send?.(packet);
        } catch (e) {
          console.warn('[RTC] failed to send overlay:d20', e, packet);
        }
      });
    } catch (e) {
      console.warn('[RTC] setSendDiceRTC not available yet', e);
    }

    // If overlay already constructed/ready, mark ready and bail (no reset).
    if (PortraitOverlay?.isReady?.() || PortraitOverlay?.isOpen?.()) {
      window.__PORTRAIT_READY = true;
      return;
    }

    // First/only init
    await PortraitOverlay.init({
      autoRandomIfUnset: false,      // no forced-open/auto-roll
      autoCloseOnBothRolled: true,   // harmless if overlay ignores
      sendDiceRTC: (packet) => {
        try {
          console.log('%c[RTC:send overlay:d20]', 'color:#09f;font-weight:bold', packet);
          window.peer?.send?.(packet);
        } catch (e) {
          console.warn('[RTC] failed to send overlay:d20', e, packet);
        }
      },
    });

    // Mark as ready so future calls NO-OP (prevents wiping _dice/_rolled)
    window.__PORTRAIT_READY = true;
  } catch (e) {
    console.warn('[RTC] __ensureOverlayReadyNoOpen failed', e);
  }
}


function __overlayIsOpen(){
  try {
    const { PortraitOverlay } = window.__PORTRAIT_OVERLAY_CACHE || {};
    if (PortraitOverlay && typeof PortraitOverlay.isOpen === 'function') {
      return !!PortraitOverlay.isOpen();
    }
  } catch {}
  // fallback: accept either #portraitOverlay or .portrait-overlay
  try {
    const el = document.getElementById('portraitOverlay') || document.querySelector('.portrait-overlay');
    if (el) {
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }
  } catch {}
  return false;
}


// cache module so __overlayIsOpen() can use it without re-importing
(async () => {
  try {
    const mod = await import('./portrait.dice.overlay.js');
    const { PortraitOverlay } = mod;
    window.__PORTRAIT_OVERLAY_CACHE = { PortraitOverlay };

    // Inject/refresh the sender immediately (safe if peer not ready yet)
    try {
      PortraitOverlay.setSendDiceRTC((packet) => {
        try {
          console.log('%c[RTC:send overlay:d20]', 'color:#09f;font-weight:bold', packet);
          window.peer?.send?.(packet);
        } catch (e) {
          console.warn('[RTC] failed to send overlay:d20', e, packet);
        }
      });
    } catch (e) {
      console.warn('[RTC] setSendDiceRTC not available yet (cache bootstrap)', e);
    }

    // If another path already initialized it, mark the flag so we don't re-init here.
    try {
      if (PortraitOverlay?.isReady?.() || PortraitOverlay?.isOpen?.()) {
        window.__PORTRAIT_READY = true;
      }
    } catch {}
  } catch {}
})();



// ────────────────────────────────────────────────────────────
// Portrait render queue: serialize setPortrait calls to avoid
// re-entrancy freezes when the overlay is already processing.
// ────────────────────────────────────────────────────────────
(function installPortraitQueue(){
  if (window.__PORTRAIT_QUEUE_INSTALLED) return;
  window.__PORTRAIT_QUEUE_INSTALLED = true;

  const Q = [];
  let BUSY = false;

  async function drain(){
    if (BUSY) return;
    BUSY = true;
    try {
      while (Q.length) {
        const { side, url } = Q.shift();
        await new Promise(r => requestAnimationFrame(r));
        try {
          const cache = window.__PORTRAIT_OVERLAY_CACHE || {};
          let PortraitOverlay = cache.PortraitOverlay;
          if (!PortraitOverlay) {
            const mod = await import('./portrait.dice.overlay.js');
            PortraitOverlay = mod.PortraitOverlay;
          }
          await PortraitOverlay.setPortrait(side, url); // do not echo here
          await new Promise(r => setTimeout(r, 0));
        } catch (e) {
          console.warn('[PortraitQueue] setPortrait failed', { side, url }, e);
        }
      }
    } finally {
      BUSY = false;
    }
  }

  window.__enqueuePortrait = function(side, url){
    if (!side || !url) return;
    Q.push({ side, url });
    drain();
  };
})();

try { window.__isPortraitOverlayOpen = __overlayIsOpen; } catch {}


// --- Seat assignment helper (Host=1, Join=2) ---
// CTRL-F anchor: [RTC:seat]
function setSeat(n) {
  const seat = Number(n) || 1;
  window.mySeat = () => seat;
  console.log('%c[RTC:seat]', 'color:#f90', { seat });
}

// Build my private snapshot (only MY side knows my hand/deck)
function __buildSavePrivatePayload() {
  const hand = (typeof window.exportHandSnapshot === 'function')
    ? window.exportHandSnapshot('player')
    : [];
  const deck = (typeof DeckLoading?.exportLibrarySnapshot === 'function')
    ? (DeckLoading.exportLibrarySnapshot() || { remaining: [], all: [] })
    : { remaining: [], all: [] };
  return { hand, deck };
}

// ────────────────────────────────────────────────────────────
// Remote art cache (by printed/face name, case-insensitive)
// ────────────────────────────────────────────────────────────
const __REMOTE_ART = {
  map: new Map(), // key = name.toLowerCase() -> { imgFront, imgBack }
  set(name, imgFront, imgBack){
    if (!name) return;
    this.map.set(String(name).toLowerCase(), {
      imgFront: imgFront || '',
      imgBack : imgBack  || ''
    });
  },
  get(name){
    if (!name) return null;
    return this.map.get(String(name).toLowerCase()) || null;
  },
  clear(){ this.map.clear(); }
};
try { window.__DECK_ART_REMOTE = __REMOTE_ART; } catch {}



// --- Apply a full resolved card state received over RTC ---
async function applyFullCardStateFromRTC(cid, state){
  if (!cid || !state) return;

  // 1) Ensure a table-card element exists
  let el = document.querySelector(`img.table-card[data-cid="${cid}"]`);
  if (!el){
    const name = state.title || 'Card';
    const img  = state.img   || '';
    el = document.createElement('img');
    el.className = 'table-card';
    el.dataset.cid = cid;
    el.title = name;
    el.src = img;

    // 🔴 OWNER STAMP (full-state): prefer state.owner if provided
    if (state.owner != null) {
      el.dataset.owner = String(state.owner);
    }

    Object.assign(el.style, {
      position:'absolute',
      height:'var(--card-height-table)'
    });
    (document.getElementById('world') || document.body).appendChild(el);
    try { window.ensureCardSideButtons?.(el); } catch {}
  } else {
    // If element pre-existed but lacks owner, hydrate from state
    if (!el.dataset.owner && state.owner != null) {
      el.dataset.owner = String(state.owner);
    }
  }


  // 2) CardAttributes store ← state
  try {
    const { CardAttributes } = await import('./card.attributes.js');
    const row = CardAttributes.get?.(cid) || {};

    if (state.pt){
      const [p,t] = String(state.pt).split('/').map(Number);
      if (Number.isFinite(p)) row.pow = p;
      if (Number.isFinite(t)) row.tou = t;
    }
    if (Array.isArray(state.abilities)) row.abilities = state.abilities.slice();
    if (state.counters && typeof state.counters === 'object') row.counters = { ...state.counters };
    if (Array.isArray(state.types)) row.types = state.types.slice();
    if (state.temp && typeof state.temp === 'object') row.temp = { ...state.temp }; // debug-only

    CardAttributes.set?.(cid, row);
  } catch (e){
    console.warn('[RTC apply] CardAttributes set failed', e);
  }

  // 3) Mirror into dataset so overlays/tooltips read immediately
  try {
    el.dataset.remoteAttrs = JSON.stringify({
      pt: state.pt || '',
      abilities: state.abilities || [],
      counters: state.counters || {},
      types: state.types || []
    });
	
    if (state.pt) el.dataset.ptCurrent = String(state.pt);
  } catch {}

  // 4) Render attributes overlay (not just reflow)
  try {
    const { AttributesOverlay } = await import('./card.attributes.overlay.js');
    AttributesOverlay.attach(el);
    AttributesOverlay.render(el);
  } catch {}

  // 5) Keep tooltip in sync if visible
  try { window.Tooltip?.showForCard?.(el, el, { mode:'right' }); } catch {}

  console.log('[RTC] applied full state', { cid, pt: el.dataset.ptCurrent });
}

// [RTC:tap-css] local helper so remote taps animate just like local
let __tapAnimStyleInjected = false;
function ensureTapAnimCSS(){
  if (__tapAnimStyleInjected) return;
  const style = document.createElement('style');
  style.textContent = `
    @supports (rotate: 0deg) {
      .tap-anim { transition: rotate 180ms cubic-bezier(.2,.8,.2,1); }
    }
  `;
  document.head.appendChild(style);
  __tapAnimStyleInjected = true;
}
function applyTapToEl(el, tapped){
  ensureTapAnimCSS();
  el.classList.add('tap-anim');
  el.dataset.tapped = tapped ? '1' : '0';
  el.style.rotate   = tapped ? '90deg' : '0deg';
  el.classList.toggle('is-tapped', tapped);
  // keep tooltip/badges feeling fresh
  try { window.Tooltip?.showForCard?.(el, el, { mode:'right' }); } catch {}
  try { (async () => { (await import('./badges.js')).Badges.render(el); })(); } catch {}
}

// [DEBUG] Disable portrait overlay when room is exactly "debug" (any casing)
async function __disablePortraitOverlayIfDebug(roomName) {
  try {
    const isDebug = !!String(roomName || '').trim().match(/^debug$/i);
    window.__ROOM_ID = String(roomName || '').trim();
    window.__DEBUG_ROOM = isDebug;

    if (!isDebug) return;

    // Patch the overlay module so any calls from other modules are harmless
    const mod = await import('./portrait.dice.overlay.js');
    const PO = mod?.PortraitOverlay || mod?.default;
    if (!PO) return;

    const noop = () => {};
    const noopAsync = async () => {};

    // Mark disabled and override public API
    PO.__disabled = true;
    PO.setSendDiceRTC?.(noop);
    PO.init = noopAsync;          // ignore init requests
    PO.show = noop;               // never open UI
    PO.hide = noop;
    PO.destroy = noop;
    PO.setPortrait = noopAsync;   // ignore portrait setting
    PO.roll = noop;
    PO.rollForMySeat = noop;
    PO.applyRemoteDice = noop;

    // Pretend we're "ready" so callers don't try to init/show
    PO.isReady = () => true;
    // Report closed; some code checks this but we never open anyway
    PO.isOpen = () => false;

    // Optional: announce for debugging
    console.log('%c[DEBUG MODE] PortraitOverlay disabled for room "debug".', 'color:#f90;font-weight:bold');
  } catch (e) {
    console.warn('[RTC] failed to disable PortraitOverlay for debug room', e);
  }
}

// ── Opponent cascade popup (read-only, dismissible) ──
// CTRL-F anchor: [CASCADE:oppPopup]
function showOpponentCascadePopup(name, img){
  let wrap = document.getElementById('oppCascadePopup');
  if (!wrap){
    wrap = document.createElement('div');
    wrap.id = 'oppCascadePopup';
    wrap.style.cssText =
      'position:fixed; right:16px; bottom:16px; z-index:999999; display:grid; gap:12px;';
    document.body.appendChild(wrap);
  }
  const card = document.createElement('div');
  card.className = 'opp-cascade-card';
  card.style.cssText =
    'width:min(320px,40vw); background:#0c1a2b; border:1px solid rgba(255,255,255,.2); ' +
    'border-radius:12px; color:#eaf2ff; box-shadow:0 18px 36px rgba(0,0,0,.6); overflow:hidden;';
  const head = document.createElement('div');
  head.style.cssText =
    'display:flex; align-items:center; justify-content:space-between; padding:10px 12px; font-weight:800;';
  head.innerHTML = `<span>${name || 'Card'}</span>`;
  const close = document.createElement('button');
  close.textContent = '×';
  Object.assign(close.style, {
    background:'transparent', color:'#eaf2ff', border:'0', fontSize:'20px',
    cursor:'pointer', lineHeight:'1'
  });
  close.onclick = () => card.remove();
  head.appendChild(close);

  const imgEl = document.createElement('img');
  imgEl.src = img || '';
  imgEl.alt = name || '';
  imgEl.style.cssText = 'width:100%; display:block; border-top:1px solid rgba(255,255,255,.15)';

  card.append(head, imgEl);
  wrap.appendChild(card);
}


export function initRTCConnectionUI() {

  const popup = document.createElement('div');
  popup.id = 'joinPopup';
  popup.innerHTML = `
    <style>
      #joinPopup {
        position: fixed;
        top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: #222;
        border: 2px solid #444;
        border-radius: 10px;
        padding: 20px;
        z-index: 9999;
        width: 300px;
        font-family: sans-serif;
        color: white;
        box-shadow: 0 0 30px black;
      }
      #joinPopup input, #joinPopup select, #joinPopup button {
        display: block;
        width: 100%;
        margin: 8px 0;
        padding: 8px;
        font-size: 16px;
        border-radius: 6px;
        border: none;
      }
      #joinPopup .row { display:flex; gap:8px; }
      #joinPopup button {
        background: #4499ee;
        color: white;
        font-weight: bold;
        cursor: pointer;
      }
      #joinPopup .host { background:#2ecc71; }
      #joinPopup .join { background:#e67e22; }
    </style>

    <label>Room Name</label>
    <input type="text" id="roomInput" value="dev-room">

    <div class="row">
      <button class="host" id="hostBtn">Host (P1)</button>
      <button class="join" id="joinBtn">Join (P2)</button>
    </div>
  `;
  document.body.appendChild(popup);

  const connect = async (role) => {
  const roomId = document.getElementById('roomInput').value.trim() || 'dev-room';
  const seat   = (role === 'host') ? 1 : 2;  // 🔒 force mapping Host→P1, Join→P2

  // 🔶 If room is exactly "debug", neuter the portrait overlay entirely.
  await __disablePortraitOverlayIfDebug(roomId);

  // flip life bar sides now (no flicker, no waiting on RTC)
  try { window.UserInterface?.setSeatRole(seat, role); } catch {}

  popup.remove();



    // Remember our seat for UI perspective logic
    window.__LOCAL_SEAT = seat;

    // 🔧 NEW: publish mySeat() so placement/mirroring can compare owner vs local
    // CTRL-F anchor: [RTC:seat]
    try { setSeat(seat); } catch (_) {}
    console.log('%c[RTC] local seat ready', 'color:#f90', { seat, hasMySeatFn: typeof window.mySeat === 'function' });

    window.peer = await createPeerRoom({
      roomId,
      role,
      seat,
      onMessage: async (msg) => {

        console.log('%c[RTC:recv]', 'color:#0f0', msg);
        // ---- DECK ART SYNC ------------------------------------------------
        if (msg?.type === 'deck-art-sync') {
          try {
            const list      = Array.isArray(msg.deck) ? msg.deck : [];
            const commander = (msg.commander && typeof msg.commander === 'object') ? msg.commander : {};

            // reset cache, then load commander + deck entries
            __REMOTE_ART.clear();
            if (commander?.name) {
              __REMOTE_ART.set(commander.name, commander.imgFront, commander.imgBack);
            }
            for (const row of list) {
              if (!row) continue;
              __REMOTE_ART.set(row.name, row.imgFront, row.imgBack);
            }

            // prewarm images so first spawn isn't blank
            try {
              const preload = [];
              const add = (u) => { if (u) { const im = new Image(); im.src = u; preload.push(im); } };
              if (commander?.imgFront) add(commander.imgFront);
              if (commander?.imgBack)  add(commander.imgBack);
              for (const r of list) { add(r?.imgFront); add(r?.imgBack); }
            } catch {}

            // let other modules know (e.g., tooltip/badges could react if they want)
            try {
              window.dispatchEvent(new CustomEvent('deck:art-sync', {
                detail: { fromSeat: msg.seat, count: __REMOTE_ART.map.size }
              }));
            } catch {}

            console.log('%c[RTC:deck-art-sync→cached]', 'color:#6cf', {
              fromSeat: msg.seat, entries: __REMOTE_ART.map.size
            });
          } catch (e) {
            console.warn('[RTC:deck-art-sync] handler failed', e, msg);
          }
          return;

        // 🔵 NEW: remote dice roll (deterministic)
        } else if (msg?.type === 'overlay:d20') {
  try {
    // idempotent guard → will not re-init (so it won't clear _dice/_rolled)
    await __ensureOverlayReadyNoOpen();

    const { PortraitOverlay } = await import('./portrait.dice.overlay.js');
    PortraitOverlay.applyRemoteDice(msg);

    console.log('%c[RTC:overlay:d20→applied]', 'color:#6cf', { seat: msg.seat, side: msg.side, value: msg.value });
  } catch (e) {
    console.warn('[RTC:overlay:d20] handler failed', e, msg);
  }
  return;


        } else if (msg?.type === 'overlay:ready') {
          try {
            const seat = Number(msg.seat) || 0;
            const side = (seat === 1) ? 'left' : 'right';
            const art  = msg.artUrl ? __toArtCrop(String(msg.artUrl)) : null;

            // Ensure overlay runtime exists (do NOT force open)
            await __ensureOverlayReadyNoOpen();

            if (art) {
              if (__overlayIsOpen()) {
                // Queue portrait work to avoid re-entrancy while overlay is active
                window.__enqueuePortrait?.(side, art);
                console.log('%c[RTC:overlay:ready→queued (overlay open)]', 'color:#6cf', { seat, side, art });
              } else {
                // Overlay closed: store pending until it opens
                window.__DICE_PENDING = window.__DICE_PENDING || { left: null, right: null };
                window.__DICE_PENDING[side] = art;
                console.log('%c[RTC:overlay:ready→stored (overlay closed)]', 'color:#fc6', { seat, side, art });
              }
            }
          } catch (e) {
            console.warn('[RTC:overlay:ready] handler failed', e, msg);
          }
          return;

        } else if (msg?.type === 'overlay:rolled') {
  // Legacy fallback: respect idempotent init to avoid state resets.
  try {
    const seat = Number(msg.seat) || 0;
    const side = (seat === 1) ? 'left' : 'right';

    await __ensureOverlayReadyNoOpen(); // ← safe, won’t wipe values

    const { PortraitOverlay } = await import('./portrait.dice.overlay.js');
    PortraitOverlay.roll(side);

    console.log('%c[RTC:overlay:rolled→fallback roll]', 'color:#6cf', { seat, side });
  } catch (e) {
    console.warn('[RTC:overlay:rolled] handler failed', e, msg);
  }
  return;


        }


        // ---- SAVE SNAPSHOT EXCHANGE ---------------------------------------
        if (msg?.type === 'save:request') {
          // Pre-warm: send my private payload immediately so the saver already has it in-flight
          try {
            const payload = __buildSavePrivatePayload();
            window.peer?.send?.({ type: 'save:private', saveId: msg.saveId, fromSeat: (typeof window.mySeat==='function'? window.mySeat():1), payload });
            console.log('%c[RTC:send save:private (prewarm)]', 'color:#6cf', {
              saveId: msg.saveId, hand: payload.hand.length, deckRem: payload.deck.remaining.length
            });
          } catch (e) {
            console.warn('[RTC] prewarm save:private failed', e);
          }
          // Also fan this to save.state (mirroring / ack logic lives there)
          try {
            const { GameSave } = await import('./save.state.js');
            await GameSave.handleIncomingSaveRequest?.(msg);
          } catch (e) {
            console.warn('[RTC] save:request → GameSave handler failed', e);
          }
          return;
        }

        if (msg?.type === 'save:need-private') {
          try {
            const payload = __buildSavePrivatePayload();
            window.peer?.send?.({ type: 'save:private', saveId: msg.saveId, fromSeat: (typeof window.mySeat==='function'? window.mySeat():1), payload });
            console.log('%c[RTC:send save:private]', 'color:#6cf', {
              saveId: msg.saveId, hand: payload.hand.length, deckRem: payload.deck.remaining.length
            });
          } catch (e) {
            console.warn('[RTC] save:need-private → send save:private failed', e);
          }
          return;
        }

        if (msg?.type === 'save:private') {
          try {
            const { GameSave } = await import('./save.state.js');
            await GameSave.handleIncomingPrivate?.(msg);
            console.log('%c[RTC:recv save:private→delivered]', 'color:#6f6', {
              saveId: msg.saveId,
              hand: Array.isArray(msg?.payload?.hand) ? msg.payload.hand.length : 0,
              deckRem: Array.isArray(msg?.payload?.deck?.remaining) ? msg.payload.deck.remaining.length : 0
            });
          } catch (e) {
            console.warn('[RTC] save:private → GameSave handler failed', e, msg);
          }
          return;
        }

        if (msg?.type === 'save:ack') {
          console.log('%c[RTC:recv save:ack]', 'color:#6f6', msg);
          return;
        }
        // ---- END SAVE SNAPSHOT EXCHANGE -----------------------------------
        // CTRL-F anchor: [RTC:hand:replace]
        if (msg?.type === 'hand:replace') {
          // Only apply if it's meant for me (optional check)
          try {
            const tgt = Number(msg.toSeat);
            if (!tgt || (typeof window.mySeat === 'function' && tgt !== Number(window.mySeat()))) {
              // not for me → ignore
            } else {
              const arr = Array.isArray(msg.hand) ? msg.hand : [];
              const { restoreHandFromSnapshot } = await import('./hand.js');
              restoreHandFromSnapshot(arr, { append: false });
              console.log('%c[RTC:hand:replace→applied]', 'color:#6f6', { count: arr.length });
            }
          } catch (e) {
            console.warn('[RTC:hand:replace] failed', e, msg);
          }
          return;
        }

        // CTRL-F anchor: [RTC:deck:replace]
        if (msg?.type === 'deck:replace') {
          try {
            const tgt = Number(msg.toSeat);
            if (!tgt || (typeof window.mySeat === 'function' && tgt !== Number(window.mySeat()))) {
              // not for me → ignore
            } else {
              const deck = (msg.deck && typeof msg.deck === 'object') ? msg.deck : { all:[], remaining:[] };
              const { DeckLoading } = await import('./deck.loading.js');
              DeckLoading?.importLibrarySnapshot?.({
                all: Array.isArray(deck.all) ? deck.all : [],
                remaining: Array.isArray(deck.remaining) ? deck.remaining : []
              });

              // make my deck-zone show "has deck"
              try {
                const deckZone =
                  document.getElementById('pl-deck') ||
                  document.querySelector('.deck-zone.player') ||
                  document.querySelector('.deck-zone[data-owner="player"]');
                if (deckZone){
                  deckZone.dataset.hasDeck = '1';
                  deckZone.classList.add('has-deck');
                  deckZone.dataset.owner = String(typeof window.mySeat==='function' ? window.mySeat() : 1);
                  try { (await import('./zones.js')).Zones?.markDeckPresent?.(deckZone, true); } catch {}
                  try { (await import('./zones.js')).Zones?.sendDeckVisual?.(true); } catch {}
                }
              } catch {}

              console.log('%c[RTC:deck:replace→applied]', 'color:#6f6', {
                all: deck?.all?.length || 0,
                remaining: deck?.remaining?.length || 0
              });
            }
          } catch (e) {
            console.warn('[RTC:deck:replace] failed', e, msg);
          }
          return;
        }


        // ---- TURN PASS / TURN SYNC --------------------------------------
        // turn_pass = opponent hit End Turn and is telling us new turn state
        // turn_sync = (future use) a "here's current turn" broadcast
        if (msg?.type === 'turn_pass' || msg?.type === 'turn_sync') {
          try {
            const UI = window.UserInterface;
            try { (await import('./turn.upkeep.js')).TurnUpkeep.applyTurnPassFromRTC(msg); } catch {}

            if (UI && UI._STATE) {
              const S = UI._STATE;

              // pull data from the message
              if (Number.isFinite(msg.turn)) {
                S.turn = msg.turn;
              }
              if (Number.isFinite(msg.activeSeat)) {
                S.activeSeat = msg.activeSeat;
              }
              if (msg.playerLabel) {
                S.playerLabel = msg.playerLabel;
              } else {
                // fallback label if not provided
                S.playerLabel = (S.activeSeat === 1) ? 'Player 1' : 'Player 2';
              }

              // update the pill at the top: "Turn: X – Player Y"
              try {
                UI.setTurn(S.turn, S.playerLabel);
              } catch(e){
                console.warn('[RTC turn_pass] setTurn failed', e);
              }

              // Now style MY local controls for attack / defend
              // S.seat = who am I? (1 = host, 2 = join). We already keep that in setSeatRole.
              if (S.activeSeat === S.seat) {
                // It is NOW my turn. I'm the active seat.
                UI._markAttackerUI();   // ⚔️ Battle + End Turn enabled

                // 🔴 NEW: clear summoning sickness on MY cards now that my turn begins.
                // This flips dataset.hasSummoningSickness to "false" for my creatures
                // and broadcasts 'move' packets with hasSummoningSickness:'false'
                // so opponent syncs them.
                try {
                  window.CardPlacement?.clearSummoningSicknessForMyBoard?.();
                } catch (err2) {
                  console.warn('[RTC turn_pass] clearSummoningSicknessForMyBoard failed', err2);
                }

              } else {
                // It's NOT my turn. I'm the defender.
                UI._markDefenderUI();   // 🛡️ Block + End Turn disabled
              }
            }
          } catch (err){
            console.warn('[RTC turn_pass] handler error', err, msg);
          }

          // we've fully handled this message, don't fall through to card logic
          return;

        // ---- PHASE SET ---------------------------------------------------
        } else if (msg?.type === 'phase:set') {
          try {
            // Preferred: delegate to UI’s dedicated phase receiver
            if (typeof window.__applyRemotePhaseSet === 'function') {
              window.__applyRemotePhaseSet(msg);
            } else if (window.UserInterface) {
              // Fallback: minimal application using existing UI APIs
              const seat  = Number(msg.seat)  || 1;
              const phase = String(msg.phase || '');
              // keep active-seat ring correct
              window.UserInterface.setTurn?.(undefined, undefined, seat);
              // let UI map the label if it supports the key, else set raw
              window.UserInterface.setPhase?.(phase);
            }
            console.log('%c[RTC:recv phase:set→UI]', 'color:#9cf', msg);
          } catch (e){
            console.warn('[RTC phase:set] handler error', e, msg);
          }
          return;

        // ---- LIFE UPDATE -------------------------------------------------
        } else if (msg?.type === 'life:update') {

          try {
            // Preferred: delegate to the UI module’s dedicated handler (no re-broadcast).
            if (typeof window.__applyRemoteLifeUpdate === 'function') {
              window.__applyRemoteLifeUpdate(msg);
            } else if (window.UserInterface) {
              // Fallback: apply directly to the life bar without broadcasting.
              const p1 = msg.p1 || {};
              const p2 = msg.p2 || {};
              // Use existing setters; undefined args keep previous values.
              window.UserInterface.setP1(
                Number.isFinite(p1.total)  ? p1.total  : undefined,
                Number.isFinite(p1.mid)    ? p1.mid    : undefined,
                Number.isFinite(p1.poison) ? p1.poison : undefined
              );
              window.UserInterface.setP2(
                Number.isFinite(p2.total)  ? p2.total  : undefined,
                Number.isFinite(p2.mid)    ? p2.mid    : undefined,
                Number.isFinite(p2.poison) ? p2.poison : undefined
              );
            }
            console.log('%c[RTC:life:update→applied]', 'color:#6cf', {
              from: msg.from, reason: msg.reason, p1: msg.p1, p2: msg.p2
            });
          } catch (err) {
            console.warn('[RTC:life:update] handler error', err, msg);
          }
          return;


        // ---- CARD SPAWN / MOVE ------------------------------------------
        } else if (msg?.type === 'spawn') {
          window.CardPlacement?.applyRemoteSpawn?.(msg);

          // After the element exists, hydrate datasets (owner info, command zone, mana, colors, etc.)
          try {
            requestAnimationFrame(() => {
              const el = document.querySelector(`img.table-card[data-cid="${msg.cid}"]`);
              if (!el) return;

              // 🔵 ART FALLBACK: if src is empty/broken, fill from remote art cache by name
              try {
                const needArt = (!el.src || el.src === '' || el.naturalWidth === 0);
                if (needArt && msg.name && window.__DECK_ART_REMOTE?.get) {
                  const art = window.__DECK_ART_REMOTE.get(msg.name);
                  if (art?.imgFront) {
                    el.src = art.imgFront;
                  }
                }
              } catch {}

              // --- OWNERSHIP SYNC ---
              // ownerCurrent wins. Fallback to msg.owner, then leave existing.
              if (msg.ownerOriginal != null) {
                el.dataset.ownerOriginal = String(msg.ownerOriginal);
              }

              if (msg.ownerCurrent != null) {
                el.dataset.ownerCurrent = String(msg.ownerCurrent);
              }
              if (msg.owner != null && !el.dataset.ownerCurrent) {
                el.dataset.ownerCurrent = String(msg.owner);
              }

              // legacy `owner` mirror (selection logic elsewhere still checks .dataset.owner)
              if (msg.owner != null) {
                el.dataset.owner = String(msg.owner);
              } else if (msg.ownerCurrent != null) {
                el.dataset.owner = String(msg.ownerCurrent);
              } else if (!el.dataset.owner) {
                el.dataset.owner = '-1';
              }

              // --- FIELD SIDE / COMMAND ZONE SYNC ---
              if (msg.fieldSide != null) {
                el.dataset.fieldSide = msg.fieldSide; // "top"/"bottom"
              }
              if (msg.inCommandZone != null) {
                el.dataset.inCommandZone =
                  (msg.inCommandZone === 'true' || msg.inCommandZone === true)
                  ? 'true'
                  : 'false';
              }

              // 🔴 NEW: SUMMONING SICKNESS SYNC ON SPAWN
              // carry over hasSummoningSickness from remote spawn packet
              if (msg.hasSummoningSickness != null) {
                el.dataset.hasSummoningSickness =
                  (msg.hasSummoningSickness === 'true' || msg.hasSummoningSickness === true)
                    ? 'true'
                    : 'false';
              }

              // --- NAME / RULES TEXT / STATS SYNC ---
              if (msg.name && !el.dataset.name) el.dataset.name = String(msg.name);
              if (msg.name && !el.title)        el.title        = String(msg.name);

              if (msg.typeLine)  el.dataset.typeLine  = String(msg.typeLine);
              if (msg.oracle)    el.dataset.oracle    = String(msg.oracle);
              if (msg.power != null)     el.dataset.power     = String(msg.power);
              if (msg.toughness != null) el.dataset.toughness = String(msg.toughness);
              if (msg.pt)                el.dataset.ptCurrent = String(msg.pt);

              // 🔵 NEW: mirror deck-stamped identity so Badges can show innate abilities remotely
              if (Array.isArray(msg.baseAbilities)) {
                try { el.dataset.baseAbilities = JSON.stringify(msg.baseAbilities); } catch {}
              }
              if (Array.isArray(msg.baseTypes)) {
                try { el.dataset.baseTypes = JSON.stringify(msg.baseTypes); } catch {}
              }


              // --- MANA COST / COLOR IDENTITY SYNC ---
              // We're including this so the mirrored side has cost+colors in dataset
              // immediately for tooltip, commander snapshot, etc.
              if (msg.manaCostRaw != null) {
                el.dataset.manaCost    = String(msg.manaCostRaw);
                el.dataset.manaCostRaw = String(msg.manaCostRaw);
              }
              if (msg.colors) {
                try {
                  el.dataset.colors = JSON.stringify(msg.colors); // ['U','B','R']
                } catch(_) {
                  el.dataset.colors = '[]';
                }
              }

              const hasIdentity = () =>
                !!(el.dataset.typeLine?.trim() || el.dataset.name?.trim() || el.title?.trim());

              const doRender = async () => {
                try {
                  const { Badges } = await import('./badges.js');
                  await Badges.render(el);
                } catch (err) {
                  console.warn('[RTC:spawn→badges] render failed', err);
                }
              };

              // Grace period for async metadata seeding
              const start = Date.now();
              const waitForIdentity = (resolve) => {
                if (hasIdentity() || Date.now() - start > 800) return resolve();
                setTimeout(() => waitForIdentity(resolve), 100);
              };

              new Promise(waitForIdentity).then(() => {
                // Wait for art to load before badges, but don't stall forever
                if (el.complete && el.naturalWidth > 0) {
                  setTimeout(doRender, 60);
                } else {
                  el.addEventListener('load', () => setTimeout(doRender, 60), { once: true });
                  setTimeout(doRender, 900);
                }
              });
            });
          } catch {}


        } else if (msg?.type === 'owner-swap') {
          try {
            const sel = `img.table-card[data-cid="${msg.cid}"]`;
            const el  = document.querySelector(sel);
            if (!el) {
              console.warn('[RTC:owner-swap] no element for', msg.cid, msg);
            } else {
              if (msg.ownerOriginal != null) {
                el.dataset.ownerOriginal = String(msg.ownerOriginal);
              }
              if (msg.ownerCurrent  != null) {
                el.dataset.ownerCurrent = String(msg.ownerCurrent);
                el.dataset.owner        = String(msg.ownerCurrent); // legacy sync for selection
              }
              if (msg.fieldSide != null) {
                el.dataset.fieldSide = msg.fieldSide;
              }
              if (msg.inCommandZone != null) {
                el.dataset.inCommandZone =
                  (msg.inCommandZone === 'true' || msg.inCommandZone === true)
                  ? 'true'
                  : 'false';
              }

              // 🔵 carry mana cost + colors on owner-swap too
              if (msg.manaCostRaw != null) {
                el.dataset.manaCost    = String(msg.manaCostRaw);
                el.dataset.manaCostRaw = String(msg.manaCostRaw);
              }
              if (msg.colors) {
                try {
                  el.dataset.colors = JSON.stringify(msg.colors);
                } catch(_) {
                  el.dataset.colors = '[]';
                }
              }

              console.log('%c[RTC:owner-swap→applied]', 'color:#fc6', {
                cid           : msg.cid,
                ownerOriginal : el.dataset.ownerOriginal,
                ownerCurrent  : el.dataset.ownerCurrent,
                fieldSide     : el.dataset.fieldSide,
                inCommandZone : el.dataset.inCommandZone,
                manaCostRaw   : el.dataset.manaCost,
                colors        : el.dataset.colors
              });
            }
          } catch (err) {
            console.warn('[RTC:owner-swap] handler error', err, msg);
          }


        } else if (msg?.type === 'move') {
          // 🔊 DEBUG: log full inbound move packet so we can see colors / manaCostRaw / etc.
          console.log(
            '%c[RTC:recv MOVE]', 'color:#0ff;font-weight:bold',
            {
              cid: msg.cid,
              x: msg.x,
              y: msg.y,
              owner: msg.owner,
              ownerOriginal: msg.ownerOriginal,
              ownerCurrent: msg.ownerCurrent,
              fieldSide: msg.fieldSide,
              inCommandZone: msg.inCommandZone,

              // 🔴 NEW: include sickness in debug so we can watch it clear
              hasSummoningSickness: msg.hasSummoningSickness,

              manaCostRaw: msg.manaCostRaw,
              colors: msg.colors,
              raw: msg
            }
          );

          window.CardPlacement?.applyRemoteMove?.(msg);

} else if (msg?.type === 'remove') {
  try {
    const z = (msg.zone || '').toString().toLowerCase().trim();
    const finalZone = (z === 'grave' || z === 'gy') ? 'graveyard'
                    : (z === 'exiled')               ? 'exile'
                    : z;

    // Deck-origin removal: no DOM node / no cid → record snapshot directly
    if (!msg.cid) {
      const seatNum = Number(msg.seat || 1);
      const payload = (msg.card && typeof msg.card === 'object') ? msg.card : null;
      if (payload && (finalZone === 'graveyard' || finalZone === 'exile')) {
        window.Zones?.moveCardToZone?.(payload, finalZone, seatNum);
        console.log('%c[RTC:remove→deck-snapshot]', 'color:#f66',
          { seat: seatNum, zone: finalZone, name: payload.name || '' });
      } else {
        console.warn('[RTC:remove] missing payload or invalid zone for deck discard', msg);
      }
      return; // deck path handled
    }

    // ✅ Define cid before using it
    const cid = String(msg.cid);

    // 🔒 Safe selector (CSS.escape may not exist in all engines)
    const esc = (window.CSS && typeof CSS.escape === 'function')
      ? CSS.escape(cid)
      : cid.replace(/"/g, '\\"');
    const sel = `img.table-card[data-cid="${esc}"]`;

    const node = document.querySelector(sel);

    if (!node) {
      console.warn('[RTC:remove] element not found; selector miss?', { sel, cid, zone: finalZone, msg });
    } else {
      // Figure out who *owned* that card, from this client's POV.
      let snapBucket = null;
      const shouldSnapshot = (finalZone === 'graveyard' || finalZone === 'exile');

      if (shouldSnapshot) {
        try {
          const ownerSeatStr = (node.dataset.ownerCurrent
                             || node.dataset.owner
                             || (msg.ownerCurrent != null ? String(msg.ownerCurrent)
                                : (msg.owner != null ? String(msg.owner) : ''))
                             || '').trim();

          const meSeatNum = (function(){
            try { return String(typeof window.mySeat === 'function' ? window.mySeat() : 1).trim(); }
            catch { return '1'; }
          })();

          snapBucket = (ownerSeatStr && meSeatNum && ownerSeatStr === meSeatNum) ? 'player' : 'opponent';

          window.Zones?.recordCardToZone?.(snapBucket, finalZone, node);

          console.log('[RTC:remove] recorded zone snapshot', {
            bucket    : snapBucket,
            zone      : finalZone,
            cid,
            ownerSeat : ownerSeatStr,
            meSeatNum,
            name      : node?.dataset?.name || node?.title || '',
            img       : node?.currentSrc    || node?.src || '',
            typeLine  : node?.dataset?.typeLine || ''
          });
        } catch (zoneErr) {
          console.warn('[RTC:remove] recordCardToZone failed', zoneErr, { cid, finalZone });
        }
      }

      // Clean up overlays before removing
      try { window.Tooltip?.hide?.(); } catch {}
      try { window.Badges?.detach?.(node); } catch (e) { console.warn('[RTC:remove] Badges.detach fail', e); }

      // Remove the actual mirrored DOM card
      try { node.remove(); } catch {}

      // Safety: kill any legacy .card elements with same cid
      try {
        document.querySelectorAll(`.card[data-cid="${esc}"]`).forEach(n => n.remove());
      } catch {}
    }

    console.log('%c[RTC:remove→applied]', 'color:#f66', { cid, zone: finalZone, hadNode: !!node, raw: msg });
  } catch (err) {
    console.warn('[RTC:remove] handler error', err, msg);
  }



                // ── CASCADE MIRRORING ─────────────────────────────────────────────
        } else if (msg?.type === 'cascade:reveal') {
          // Opponent revealed this index/name/img
          try {
            const mySeat = (typeof window.mySeat === 'function') ? Number(window.mySeat()) : 1;
            // Only mirror opponent’s reveals
            if (Number(msg.seat) !== mySeat) {
              window.__CascadeRemote?.spawn(Number(msg.idx)||0, String(msg.name||''), String(msg.img||''));
            }
          } catch (e) {
            console.warn('[RTC:cascade:reveal] failed', e, msg);
          }
          return;

        } else if (msg?.type === 'cascade:prompt') {
  try {
    const mySeat = (typeof window.mySeat === 'function') ? Number(window.mySeat()) : 1;
    if (Number(msg.seat) !== mySeat) {
      const n = String(msg.name || '');
      const u = String(msg.img  || '');
      // Show a dismissible, non-blocking popup for the opponent
      showOpponentCascadePopup(n, u); // [CASCADE:oppPopup]
    }
  } catch (e) {
    console.warn('[RTC:cascade:prompt] failed', e, msg);
  }
  return;
}
 else if (msg?.type === 'cascade:result') {
          try {
            const mySeat = (typeof window.mySeat === 'function') ? Number(window.mySeat()) : 1;
            if (Number(msg.seat) !== mySeat) {
              // Clear mirrored reveals and banner. We do not mutate zones/hand here.
              window.__CascadeRemote?.clear();
              // Optional: toast
              try {
                const casted = !!msg.cast && msg?.chosen?.name;
                if (casted) {
                  console.log('[RTC] Opponent cast for free:', msg.chosen.name);
                } else {
                  console.log('[RTC] Opponent declined or no hit; others sent to:', msg.dest);
                }
              } catch {}
            }
          } catch (e) {
            console.warn('[RTC:cascade:result] failed', e, msg);
          }
          return;
		} else if (msg?.type === 'attrs') {
          try {
            const el = document.querySelector(`img.table-card[data-cid="${msg.cid}"]`);
            if (el && msg.attrs) {
              console.groupCollapsed('%c[RTC:attrs→el]', 'color:#0ff', { cid: msg.cid, attrs: msg.attrs });
              el.dataset.remoteAttrs = JSON.stringify(msg.attrs);
              if (msg.attrs.pt) el.dataset.ptCurrent = String(msg.attrs.pt);
              console.log('[RTC:attrs] set dataset:', {
                ptCurrent: el.dataset.ptCurrent,
                remoteAttrsLen: (el.dataset.remoteAttrs||'').length
              });
              const mod = await import('./card.attributes.overlay.ui.js');
              console.log('[RTC:attrs] calling AttributesOverlay.render');
              mod.AttributesOverlay.render(el);

              // ⬇️ NEW: refresh right-side badges immediately
              try { (await import('./badges.js')).Badges.render(el); } catch {}

              console.groupEnd();
            } else {
              console.warn('[RTC:attrs] no element for cid or no attrs', { cid: msg?.cid, hasEl: !!el });
            }
          } catch (err) {
            console.error('[RTC:attrs] handler error', err);
          }


        } else if (msg?.type === 'buff') {
          try {
            console.log('%c[RTC:recv buff]', 'color:#0ff', msg);
            await ensureRTCApply();
            if (window.RTCApply?.recvBuff) {
              window.RTCApply.recvBuff(msg); // ensure the effect is registered with effectId on BOTH sides
            } else {
              console.warn('[RTC:recv buff] RTCApply.recvBuff missing after ensure, fallback may be incomplete');
            }
          } catch (err) {
            console.warn('[RTC:recv buff] handler error', err, msg);
          }

        } else if (msg.type === 'card.state.full') {
          Promise
            .resolve(applyFullCardStateFromRTC(msg.cid, msg.state))
            .catch(err => console.warn('[RTC] failed to apply card.state.full', err, msg));
          return;
        } else if (msg?.type === 'buffRemove') {
          try {
            console.log('%c[RTC:recv buffRemove]', 'color:#f55', msg);

            // Always ensure handler is present on both sides
            await ensureRTCApply();

            // Preferred path: central bridge knows how to unapply & notify RulesStore/Badges
            if (window.RTCApply?.recvBuffRemove) {
              window.RTCApply.recvBuffRemove(msg);
              return;
            }

            // ---- Hardened fallback (works even if IDs diverge) ----
            const { RulesStore } = await import('./rules.store.js');

            // 1) Remove from RulesStore by id (if present) AND by signature match (if provided)
            const sig = (msg.signature || '').toString();
            const effId = msg.effectId != null ? String(msg.effectId) : null;

            if (effId && typeof RulesStore.removeEffect === 'function') {
              RulesStore.removeEffect(effId);
            }

            if (sig && typeof RulesStore.listActiveEffectsGroupedByCard === 'function' && typeof RulesStore.removeEffect === 'function') {
              // scan all effects and remove any whose computed signature matches
              try {
                const all = RulesStore.listActiveEffectsGroupedByCard(/* seatFilter? */);
                // all is { [cid]: [effects...] }
                Object.keys(all || {}).forEach(k => {
                  (all[k] || []).forEach(e => {
                    const s = (e.signature || e.sig || '').toString();
                    if (s && s === sig) {
                      RulesStore.removeEffect(e.id);
                    }
                  });
                });
              } catch (e) {
                console.warn('[RTC:buffRemove] signature sweep failed', e);
              }
            }

            // 2) Determine target card
            const cid =
              (msg.targetCid != null ? String(msg.targetCid) : null) ||
              (effId && RulesStore.get?.(effId)?.targetCid) ||
              (effId && RulesStore.get?.(effId)?.attachCid) ||
              (Array.isArray(RulesStore.get?.(effId)?.targets) ? RulesStore.get(effId).targets[0] : null) ||
              (msg.cid != null ? String(msg.cid) : null);

            if (!cid) {
              console.warn('[RTC:buffRemove] no cid resolved; brute badge refresh all');
              const { Badges } = await import('./badges.js');
              document.querySelectorAll('img.table-card[data-cid]').forEach(n => Badges.refreshFor?.(n.dataset.cid));
              return;
            }

            const el = document.querySelector(`img.table-card[data-cid="${CSS.escape(cid)}"]`);
            if (!el) {
              console.warn('[RTC:buffRemove] no element for cid', { cid, msg });
              return;
            }

            // 3) Prune dataset.remoteAttrs deterministically
            let attrs = {};
            try { attrs = JSON.parse(el.dataset.remoteAttrs || '{}'); } catch { attrs = {}; }

            // Normalize shapes
            if (!Array.isArray(attrs.abilities)) attrs.abilities = attrs.abilities ? [].concat(attrs.abilities) : [];
            if (!Array.isArray(attrs.types))     attrs.types     = attrs.types     ? [].concat(attrs.types)     : [];
            if (!attrs.counters || typeof attrs.counters !== 'object') attrs.counters = {};
            if (!Array.isArray(attrs.grants))    attrs.grants    = attrs.grants    ? [].concat(attrs.grants)    : [];

            const abilityName = (msg.ability || '').toString().trim();
            const counterKind = (msg.counter || '').toString().trim();
            const typeName    = (msg.typeName || '').toString().trim();
            const ptStr       = (msg.pt || '').toString().trim();

            // Remove by explicit fields first
            if (abilityName) {
              attrs.abilities = attrs.abilities.filter(a => String(a) !== abilityName);
              // also drop any grant rows that mention this ability (if you encode grants with .ability/.name)
              attrs.grants = attrs.grants.filter(g => {
                try {
                  const name = (g?.ability || g?.name || '').toString();
                  return name !== abilityName;
                } catch { return true; }
              });
            }

            if (typeName) {
              attrs.types = attrs.types.filter(t => String(t) !== typeName);
              // also drop any grant rows that added this type (if you encode with .type/.addType)
              attrs.grants = attrs.grants.filter(g => {
                try {
                  const t = (g?.type || g?.addType || '').toString();
                  return t !== typeName;
                } catch { return true; }
              });
            }

            if (counterKind) {
              if (Object.prototype.hasOwnProperty.call(attrs.counters, counterKind)) {
                delete attrs.counters[counterKind];
              }
              // drop grant rows tied to this counter kind if your grant rows store .counter
              attrs.grants = attrs.grants.filter(g => {
                try {
                  const k = (g?.counter || '').toString();
                  return k !== counterKind;
                } catch { return true; }
              });
              // special-case loyalty visual if you track it on the element
              if (counterKind === 'loyalty') {
                try { delete el.dataset.loyaltyCurrent; } catch {}
              }
            }

            if (ptStr) {
              if ((attrs.pt || '').toString() === ptStr) {
                delete attrs.pt;
              }
              try { delete el.dataset.ptCurrent; } catch {}
            }

            // Remove by signature fallback (handles generic "ability:Foo", "counter:Bar", "type:Baz")
            if (sig) {
              const m = sig.match(/^(\w+):(.*)$/);
              if (m) {
                const kind = m[1];
                const val  = m[2];
                if (kind === 'ability') {
                  attrs.abilities = attrs.abilities.filter(a => String(a) !== val);
                  attrs.grants    = attrs.grants.filter(g => (g?.ability || g?.name) !== val);
                } else if (kind === 'type') {
                  attrs.types     = attrs.types.filter(t => String(t) !== val);
                  attrs.grants    = attrs.grants.filter(g => (g?.type || g?.addType) !== val);
                } else if (kind === 'counter') {
                  if (Object.prototype.hasOwnProperty.call(attrs.counters, val)) {
                    delete attrs.counters[val];
                  }
                  attrs.grants = attrs.grants.filter(g => (g?.counter) !== val);
                  if (val === 'loyalty') {
                    try { delete el.dataset.loyaltyCurrent; } catch {}
                  }
                } else if (kind === 'label') {
                  // If you encode ad-hoc label grants, remove grant rows that match label
                  attrs.grants = attrs.grants.filter(g => (g?.label) !== val);
                }
              }
            }

            // 4) Write back and re-render
            el.dataset.remoteAttrs = JSON.stringify(attrs);

            const { Badges } = await import('./badges.js');
            Badges.refreshFor?.(cid);

          } catch (err) {
            console.warn('[RTC:recv buffRemove] handler error', err, msg);
          }


        // ---- TAP / UNTAP -------------------------------------------------
        } else if (msg?.type === 'tap') {
          try {
            const sel = `img.table-card[data-cid="${msg.cid}"]`;
            const el  = document.querySelector(sel);
            if (!el) { console.warn('[RTC:tap] no element for', msg.cid); return; }

            // --- OWNERSHIP / CONTROL / COMMAND ZONE SYNC ---
            if (msg.ownerOriginal != null) {
              el.dataset.ownerOriginal = String(msg.ownerOriginal);
            }
            if (msg.ownerCurrent  != null) {
              el.dataset.ownerCurrent = String(msg.ownerCurrent);
              el.dataset.owner        = String(msg.ownerCurrent); // legacy
            } else if (msg.owner != null) {
              el.dataset.owner        = String(msg.owner);
              if (!el.dataset.ownerCurrent) {
                el.dataset.ownerCurrent = String(msg.owner);
              }
            }
            if (msg.fieldSide != null) {
              el.dataset.fieldSide = msg.fieldSide;
            }
            if (msg.inCommandZone != null) {
              el.dataset.inCommandZone = msg.inCommandZone === 'true' ? 'true'
                                       : msg.inCommandZone === true   ? 'true'
                                       : 'false';
            }

            // apply animated tap state
            applyTapToEl(el, !!msg.tapped);

            console.log('%c[RTC:tap→applied]', 'color:#6f6', {
              cid           : msg.cid,
              tapped        : !!msg.tapped,
              ownerOriginal : el.dataset.ownerOriginal,
              ownerCurrent  : el.dataset.ownerCurrent,
              fieldSide     : el.dataset.fieldSide,
              inCommandZone : el.dataset.inCommandZone
            });
          } catch (e) {
            console.warn('[RTC:tap] apply failed', e, msg);
          }
        } else if (msg?.type === 'combat_charge') {
          const list = Array.isArray(msg.cids) ? msg.cids
                   : Array.isArray(msg.attackers) ? msg.attackers : [];
          window.Battle?.applyRemoteCharge?.(list);

        // ---- COMBAT: BLOCKERS LAYOUT ------------------------------------
        } else if (msg?.type === 'combat_blocks') {
          const map = (msg.map && typeof msg.map === 'object') ? msg.map : {};
          window.Battle?.applyRemoteBlocks?.(map);

        // 🔵 NEW: explicit end-of-combat → advance phase on both clients
        } else if (msg?.type === 'combat:end') {
          try {
            (await import('./turn.upkeep.js')).TurnUpkeep?.onCombatFinishedFromRTC?.(msg);
          } catch (e) {
            console.warn('[RTC:combat:end] handler error', e, msg);
          }
          return;

        // 🔔 NEW: Opponent "Combat Initiated" zoom-pop notification (click/tap/keydown to dismiss)
        } else if (msg?.type === 'notify:combat') { // CTRL-F anchor: [RTC:notify:combat]
          try {
            const mod = await import('./notification.js');
            const Notif = mod?.Notification || mod?.default?.Notification || mod?.default;
            if (Notif && typeof Notif.show === 'function') {
              const handle = Notif.show({
                top     : msg.top    || 'COMBAT',
                bottom  : msg.bottom || 'INITIATED',
                accent  : '#ffd700',
                backdrop: 'rgba(0,0,0,.25)',
                keep    : true // stay open until user action
              }); // keep/remove API lives here: notification.js show() → returns handle.remove()
              // Dismiss on first user interaction anywhere
              const dismiss = () => {
                try { handle?.remove?.(); } catch {}
                window.removeEventListener('pointerdown', dismiss, true);
                window.removeEventListener('touchstart', dismiss, true);
                window.removeEventListener('keydown', dismiss, true);
              };
              window.addEventListener('pointerdown', dismiss, { once:true, capture:true });
              window.addEventListener('touchstart', dismiss, { once:true, capture:true });
              window.addEventListener('keydown',     dismiss, { once:true, capture:true });
            }
          } catch (e) {
            console.warn('[RTC:notify:combat] failed', e, msg);
          }
          return;

        // 🔔 NEW: Opponent "TURN PASSED" notification (click/tap/keydown to dismiss)
        } else if (msg?.type === 'notify:turn') { // CTRL-F anchor: [RTC:notify:turn]
          try {
            const mod = await import('./notification.js');
            const Notif = mod?.Notification || mod?.default?.Notification || mod?.default;
            if (Notif && typeof Notif.show === 'function') {
              const handle = Notif.show({
                top     : msg.top    || 'TURN',
                bottom  : msg.bottom || 'PASSED',
                accent  : '#7cdfff',
                backdrop: 'rgba(0,0,0,.25)',
                keep    : true
              });
              const dismiss = () => {
                try { handle?.remove?.(); } catch {}
                window.removeEventListener('pointerdown', dismiss, true);
                window.removeEventListener('touchstart', dismiss, true);
                window.removeEventListener('keydown', dismiss, true);
              };
              window.addEventListener('pointerdown', dismiss, { once:true, capture:true });
              window.addEventListener('touchstart', dismiss, { once:true, capture:true });
              window.addEventListener('keydown',     dismiss, { once:true, capture:true });
            }
          } catch (e) {
            console.warn('[RTC:notify:turn] failed', e, msg);
          }
          return;

        // ---- TURN SYNC ---------------------------------------------------
        } else if (msg?.type === 'turn_sync') {
          window.Turn?.hydrate?.(msg.state);


        // ---- (Legacy) TURN seat/turn pair --------------------------------
        } else if (msg?.type === 'turn') {
          const n = String(msg.seat).match(/\d+/)?.[0] || '1';
          window.Turn?.hydrate?.({ activeSeat: Number(n), turn: Number(msg.turn)||1 });

        // ---- DECK VISUAL TOGGLE ------------------------------------------
        } else if (msg?.type === 'deck_visual' || msg?.type === 'deck-visual') {
          // --- Decide whose zone to toggle (mirror like cards)
          const mySeatNum    = String(typeof window.mySeat === 'function' ? window.mySeat() : 1).match(/\d+/)?.[0];
          const seatStr      = (msg.seat != null) ? String(msg.seat) : null;
          const theirSeatNum = seatStr?.match(/\d+/)?.[0] ?? null;

          const fromWhoRaw   = (msg.who ?? '').toString().toLowerCase();
          const fromWho      = (fromWhoRaw === 'player' || fromWhoRaw === 'opponent') ? fromWhoRaw : null;

          const has = (msg.has != null) ? !!msg.has
                    : (msg.hasDeck != null) ? !!msg.hasDeck
                    : false;

          let which;
          if (theirSeatNum && mySeatNum) {
            which = (theirSeatNum === mySeatNum) ? 'player' : 'oppo';
          } else if (fromWho) {
            which = (fromWho === 'player') ? 'oppo' : 'player';
          } else {
            which = 'oppo';
          }

          // --- Render: replace legacy dot with a real deck-back image in the zone
          // Source order of precedence for the image:
          //   1) msg.url
          //   2) window.DECK_BACK_URL (set once anywhere)
          //   3) data-deck-back on the deck zone
          //   4) transparent fallback (won’t show anything if missing)
          const map = { player: 'pl-deck', oppo: 'op-deck' };
          const zoneId = map[which];
          const zone   = zoneId ? document.getElementById(zoneId) : null;

          // Clean up any legacy dot
          try { document.querySelectorAll('.deck-visual-dot').forEach(n => n.remove()); } catch {}

          if (!zone) {
            console.warn('[deck-visual] zone not found for', which, { zoneId, msg });
            return;
          }

          // Ensure a single <img> child we control (NOT .table-card -> won’t trigger badges)
          let img = zone.querySelector(':scope > img.deck-visual-img');
          if (!img) {
            img = document.createElement('img');
            img.className = 'deck-visual-img';
            // styling: centered in zone, sized like a deck, non-interactive, behind cards/buttons
            img.style.cssText = `
              position:absolute; inset:0; margin:auto;
              height: var(--card-height-table);
              aspect-ratio: var(--card-aspect, 0.714);
              object-fit: cover; pointer-events: none;
              filter: drop-shadow(0 6px 18px rgba(0,0,0,.35));
              z-index: 1; opacity: 0.95;
            `;
            zone.style.position = zone.style.position || 'relative';
            zone.appendChild(img);
          }

          if (has) {
            // Pick URL (allow sender to pass msg.url). If still empty, we hide silently.
            const url = msg.url
              || window.DECK_BACK_URL
              || zone.getAttribute('data-deck-back')
              || '';

            if (url) {
              img.src = url;
              img.style.display = '';
            } else {
              // nothing to show
              img.remove();
            }
          } else {
            // Hide/remove visual when deck is gone
            if (img) img.remove();
          }

          console.log('%c[RTC:recv:deck-visual→IMG]', 'color:#0a0', { which, has, url: img?.src || null, raw: msg });
          return;

        } else if (msg?.type === 'zones:sync') {
          try {
            const mySeatNum   = (typeof window.mySeat === 'function') ? Number(window.mySeat()) : 1;
            const senderSeat  = Number(msg.fromSeat);
            const ownerKey    = (senderSeat === mySeatNum) ? 'player' : 'opponent';

            const gy = Array.isArray(msg.graveyard) ? msg.graveyard : [];
            const ex = Array.isArray(msg.exile)     ? msg.exile     : [];

            if (typeof window.Zones?.importOwnerZone === 'function') {
              window.Zones.importOwnerZone(ownerKey, 'graveyard', gy);
              window.Zones.importOwnerZone(ownerKey, 'exile',     ex);
            }

            console.log('%c[RTC:recv zones:sync→applied]', 'color:#6c6', {
              fromSeat: senderSeat,
              ownerKey,
              counts: { graveyard: gy.length, exile: ex.length }
            });
          } catch (e) {
            console.warn('[RTC:zones:sync] apply failed', e, msg);
          }

        } else if (msg?.type === 'life:update') {
          try {
            // Forward to UI’s receiver (idempotent & safe)
            window.__applyRemoteLifeUpdate?.(msg);
            console.log('%c[RTC:recv life:update→applied]', 'color:#6cf', { from: msg.from, p1: msg.p1, p2: msg.p2 });
          } catch (e) {
            console.warn('[RTC:life:update] apply failed', e, msg);
          }
          return;
        } else {


          console.log('[RTC:recv] unhandled message', msg);
        }
      }
    });



    console.log(`[RTC] Connected as ${role} (seat ${seat}) to room "${roomId}"`,
            { hasSend: !!window.peer?.send });

    // ensure UI is correct post-connect too
    try { window.UserInterface?.setSeatRole(seat, role); } catch {}


    if (role === 'host') {
      try { window.sendTurnSync?.(); } catch {}
    }
  };

  document.getElementById('hostBtn').onclick = () => {
    try { window.UserInterface?.setSeatRole(1, 'host'); } catch {}
    connect('host');
  };
  document.getElementById('joinBtn').onclick = () => {
    try { window.UserInterface?.setSeatRole(2, 'join'); } catch {}
    connect('join');
  };

}

// === [SAVE PAIRING WIRE-UP] =================================================
(async function wireSavePairing(){
  try {
    const { GameSave } = await import('./save.state.js');

    const handler = async (msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'save:request'){
        console.log('%c[RTC:recv save:request]', 'color:#6f6', msg);
        try { await GameSave.handleIncomingSaveRequest(msg); } catch(e){ console.warn('[SavePair] mirror failed', e); }
      }
      if (msg.type === 'save:ack'){
        console.log('%c[RTC:recv save:ack]', 'color:#6f6', msg);
      }
    };

    if (typeof window.rtcOn === 'function'){
      window.rtcOn('data', handler);
      window.rtcOn('message', handler);
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('rtc:message', (e) => handler(e && e.detail));
    }

  } catch(e){
    console.warn('[RTC.bus] save pairing wiring failed', e);
  }
})();
window.__modTime(__MOD, 'end');

// ────────────────────────────────────────────────────────────
// Cascade RTC sender injection (safe to re-run)
// ────────────────────────────────────────────────────────────
(async () => {
  try {
    const mod = await import('./cascade.engine.js');
    const { Cascade } = mod;
    Cascade?.setSendCascadeRTC?.((packet) => {
      try {
        console.log('%c[RTC:send cascade]', 'color:#09f;font-weight:bold', packet);
        window.peer?.send?.(packet);
      } catch(e) {
        console.warn('[RTC] failed to send cascade', e, packet);
      }
    });
  } catch (e) {
    console.warn('[RTC] cascade sender inject failed', e);
  }
})();

// -----------------------------
// RTC RECEIVE: discard (mirror zone snapshot)
// -----------------------------
(function installRecvDiscard(){
  try {
    function recvDiscard(msg){
      if (!msg || msg.type !== 'discard') return;
      const zone = (msg.zone === 'exile') ? 'exile' : 'graveyard';
      const seat = Number(msg.seat || 1);
      const card = msg.card || null;
      if (!card) return;
      window.Zones?.moveCardToZone?.(card, zone, seat); // snapshot push:contentReference[oaicite:4]{index=4}
    }
    window.RTCApply = window.RTCApply || {};
    window.RTCApply.recvDiscard = recvDiscard;

    if (!window.__ZonesDiscardHookInstalled) {
      window.__ZonesDiscardHookInstalled = true;
      const oldRecv = window.RTCApply.recv || null;
      window.RTCApply.recv = function(msg){
        try { recvDiscard(msg); } catch {}
        if (typeof oldRecv === 'function') return oldRecv(msg);
      };
    }
  } catch (e) {
    console.warn('[Zones] installRecvDiscard failed', e);
  }
})();


// ────────────────────────────────────────────────────────────
// Remote Cascade visuals (read-only mirror)
// ────────────────────────────────────────────────────────────
(function installRemoteCascadeMirror(){
  if (window.__REMOTE_CASCADE_INSTALLED) return;
  window.__REMOTE_CASCADE_INSTALLED = true;

  const NODES = [];  // [{el, idx}]
  const ZBASE = 49000;
  const OFFSET_X = -32;

  function combatAnchor(){
    const sel = '.mid-gap';
    const a = document.querySelector(sel);
    if (!a) return document.body;
    const cs = getComputedStyle(a);
    if (cs.position === 'static') a.style.position = 'relative';
    return a;
  }

  function spawn(idx, name, img){
    const anchor = combatAnchor();
    const el = document.createElement('img');
    el.className = 'cascade-reveal-remote';
    el.alt = name || '';
    el.title = name || '';
    el.draggable = false;
    el.src = img || '';
    Object.assign(el.style, {
  position:'absolute',
  left:'50%', top:'50%',
  transform:`translate(-50%, -50%) translateX(${idx * OFFSET_X}px)`,
  height:'var(--card-height-table)',
  width:'auto',
  aspectRatio:'var(--card-aspect, 0.714)',
  objectFit:'cover',
  borderRadius:'8px',
  border:'1px solid rgba(255,255,255,.28)',
  boxShadow:'0 18px 36px rgba(0,0,0,.7)',
  zIndex: String(ZBASE + idx),
  pointerEvents:'none',
  userSelect:'none',
  opacity:'0.96'
});

    anchor.appendChild(el);
    NODES.push({ el, idx });
  }

  function clear(){
    while (NODES.length){
      try { NODES.pop().el.remove(); } catch {}
    }
    try {
      document.querySelectorAll('.cascade-remote-banner').forEach(n=>n.remove());
    } catch {}
  }

  function banner(text){
    // passive banner; not interactive, dismissed on result
    const dim = document.createElement('div');
    dim.className = 'cascade-remote-banner';
    Object.assign(dim.style, {
      position:'fixed', inset:0, display:'grid', placeItems:'center',
      background:'rgba(0,0,0,.35)', zIndex: 999998, pointerEvents:'none'
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background:'#0c1a2b', color:'#eaf2ff',
      border:'1px solid rgba(255,255,255,.2)',
      borderRadius:'12px', padding:'12px 16px', fontWeight:'700'
    });
    panel.textContent = text;
    dim.appendChild(panel);
    document.body.appendChild(dim);
  }

  window.__CascadeRemote = { spawn, clear, banner };
})();
