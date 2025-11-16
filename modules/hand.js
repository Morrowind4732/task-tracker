// modules/hand.js
// Hand UI (fan) + draw-in animation + swipe-up to play onto table.
// + Opening hand (auto 7) with Mulligan overlay driven by a draw interceptor.
//
// - Center-pivot fan with dome arc
// - Draw from DeckLoading via fly animation from deck zone
// - Auto-fetch Scryfall art if imageUrl is missing
// - Swipe up on a hand card -> spawn on table at pointer via CardPlacement.spawnCardAtPointer
// - First attempted 1-card draw is intercepted to run Opening Hand (7 + Mulligan)
// - Press "No (Keep)" to resume normal single draws

import { CardPlacement } from './card.placement.math.js';

// ───────────────────────────────── Opening Hand + Mulligan (interceptor flow) ──────────────────────────────
const DECK_EL_ID = 'pl-deck';

let __openingHandDone    = false; // user has kept a hand?

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

 // AFTER — ensureMulliganOverlay() centered wrapper
 function ensureMulliganOverlay(){
   if (document.getElementById('mulliganOverlay')) return;

   // Centered, non-blocking wrapper (no silhouette)
   const wrap = document.createElement('div');
   wrap.id = 'mulliganOverlay';
   Object.assign(wrap.style, {
     position: 'fixed',
     inset: '0',                 // fill viewport
     display: 'none',            // toggled to 'flex' when shown
     alignItems: 'center',       // vertical center
     justifyContent: 'center',   // horizontal center
     pointerEvents: 'none',      // wrapper does NOT block the table
     zIndex: 100000
   });

   const panel = document.createElement('div');
   panel.className = 'panel';
   panel.setAttribute('role', 'dialog');
   panel.setAttribute('aria-label', 'Mulligan');
   Object.assign(panel.style, {
     width: 'min(460px, 92vw)',
     background: 'linear-gradient(180deg,#151a22,#0d1117)',
     color: '#eaf2ff',
     border: '1px solid rgba(255,255,255,.12)',
     borderRadius: '12px',
     boxShadow: '0 24px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(0,128,255,.12) inset',
     padding: '16px',
     fontFamily: 'ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial',
     pointerEvents: 'auto'       // only the panel receives clicks
   });

   panel.innerHTML = `
     <div style="font-size:16px;font-weight:800;letter-spacing:.02em;margin-bottom:8px;text-align:center">
       Mulligan?
     </div>
     <div style="font-size:13px;opacity:.9;text-align:center;margin-bottom:12px">
       Draw 7 cards. If you don’t like it, reshuffle and draw 7 again.
     </div>
     <div style="display:flex;gap:10px;justify-content:center">
       <button id="btnMullYes" style="padding:8px 14px;border:0;border-radius:9px;background:#d6452e;color:#fff;font-weight:800;cursor:pointer">Yes (Reshuffle)</button>
       <button id="btnMullNo"  style="padding:8px 14px;border:0;border-radius:9px;background:#2e7dd6;color:#fff;font-weight:800;cursor:pointer">No (Keep)</button>
     </div>
   `;

   wrap.appendChild(panel);
   document.body.appendChild(wrap);
 }



function showMulliganOverlay(){ ensureMulliganOverlay(); const el = document.getElementById('mulliganOverlay'); if (el) el.style.display = 'flex'; }
function hideMulliganOverlay(){ const el = document.getElementById('mulliganOverlay'); if (el) el.style.display = 'none'; }

async function drawNToHand(n, deckEl){
  const DL = window.DeckLoading;
  const deckNode = deckEl || document.getElementById(DECK_EL_ID);
  if (!DL) { console.warn('[OpeningHand] DeckLoading missing'); return; }

  const hasDrawOne       = typeof DL.drawOne === 'function';
  const hasDrawOneToHand = typeof DL.drawOneToHand === 'function';

  if (!hasDrawOne && !hasDrawOneToHand) {
    console.warn('[OpeningHand] No draw API found on DeckLoading (need drawOne or drawOneToHand)');
    return;
  }

  for (let i = 0; i < n; i++) {
  let drew = false;

  if (hasDrawOne) {
    const card = DL.drawOne();
    if (!card || !card.name) {
      console.warn('[OpeningHand] library empty or card invalid at i=', i);
      break;
    }
    await flyDrawToHand(card, deckNode);
    drew = true;
  } else {
    const ok = DL.drawOneToHand(deckNode);
    if (!ok) {
      console.warn('[OpeningHand] drawOneToHand failed at i=', i);
      break;
    }
    drew = true;
    await wait(60);
  }

  // 🔵 NEW: tell TurnUpkeep a real draw happened → flips Upkeep/Draw → Main 1
  try {
    const seatNow = (typeof window.mySeat === 'function') ? Number(window.mySeat()) : 1;
    window.TurnUpkeep?.recordDraw?.(seatNow, 1);
    window.dispatchEvent(new CustomEvent('turn:localDraw', { detail: { seat: seatNow }}));
  } catch {}

  try { window.dispatchEvent(new CustomEvent('deckloading:changed')); } catch {}
  await wait(60);
}

}



function _entryFromHandImg(img){
  // Mirrors the card entry shape used by DeckLoading.library items
  const parseA = (s)=>{ try{ const v=JSON.parse(s||'[]'); return Array.isArray(v)?v:[]; }catch{ return []; } };
  const name = img.dataset.cardName || img.dataset.name || img.title || img.alt || 'Card';
  const imageUrl = img.currentSrc || img.src || (img.dataset.imgFront || '');

  return {
    name,
    imageUrl,
    typeLine: img.dataset.typeLine || '',
    oracle:   img.dataset.oracle   || '',
    power:     img.dataset.power     || '',
    toughness: img.dataset.toughness || '',
    loyalty:   img.dataset.loyalty   || '',
    backLoyalty: img.dataset.backLoyalty || '',
    untapsDuringUntapStep: (img.dataset.untapsDuringUntapStep !== 'false'),
    baseTypes:     parseA(img.dataset.baseTypes),
    baseAbilities: parseA(img.dataset.baseAbilities),
    frontBaseTypes:      parseA(img.dataset.frontBaseTypes),
    frontBaseAbilities:  parseA(img.dataset.frontBaseAbilities),
    backBaseTypes:       parseA(img.dataset.backBaseTypes),
    backBaseAbilities:   parseA(img.dataset.backBaseAbilities),
    frontTypeLine: img.dataset.frontTypeLine || img.dataset.typeLine || '',
    backTypeLine:  img.dataset.backTypeLine  || '',
    frontOracle:   img.dataset.frontOracle   || img.dataset.oracle   || '',
    backOracle:    img.dataset.backOracle    || '',
    imgFront:      img.dataset.imgFront || imageUrl,
    imgBack:       img.dataset.imgBack  || '',
    currentSide:   img.dataset.currentSide || 'front'
  };
}

async function returnEntireHandToLibrary({ shuffleAfter = true } = {}){
  const DL = window.DeckLoading;
  if (!DL || !DL.state) return;

  // Use the module-scoped truth, not window.Hand.handCards
  const toReturn = [...handCards];
  const lib = DL.state.library || [];

  for (const img of toReturn){
    lib.unshift(_entryFromHandImg(img));  // put back on top (then shuffle)
    try {
      const idx = handCards.indexOf(img);
      if (idx >= 0) handCards.splice(idx, 1);
      img.remove();
    } catch {}
  }

  // re-fan (now empty) and shuffle if requested
  try { updateHandFan(); } catch {}

  if (shuffleAfter && typeof DL.shuffleLibrary === 'function'){
    DL.shuffleLibrary();
  }

  try { window.dispatchEvent(new CustomEvent('deckloading:changed')); } catch {}
}


async function drawOpeningHandLoop(){
  const deckEl = document.getElementById(DECK_EL_ID);

  // First deal of 7
  await drawNToHand(7, deckEl);
  showMulliganOverlay();

  // Wire overlay buttons (idempotent each loop enter)
  const root = document.getElementById('mulliganOverlay');
  const yes  = root?.querySelector('#btnMullYes');
  const no   = root?.querySelector('#btnMullNo');
  if (!yes || !no) return;

  let busy = false;

  yes.onclick = async () => {
    if (busy) return;
    busy = true;
    try {
      await returnEntireHandToLibrary({ shuffleAfter: true });
      await wait(100);
      await drawNToHand(7, deckEl);
    } finally { busy = false; }
  };

  no.onclick = () => {
    hideMulliganOverlay();
    __openingHandDone = true;
    console.log('[OpeningHand] Kept hand — normal draw enabled');
  };
}

// Intercept the *first real draw click on the deck box* AFTER the deck card-back appears.
// Zones sets this via: deckZone.dataset.hasDeck = '1' and adds .has-deck + background image.
// Ignore clicks on the deck's button cluster (.deck-cluster) — those should never trigger Mulligan.

function deckIsMounted(){
  const el = document.getElementById(DECK_EL_ID);
  return !!el && el.dataset.hasDeck === '1';
}
function clickIsFromDeckCluster(ev){
  return !!(ev?.target && ev.target.closest('.deck-cluster'));
}

function armOpeningHandOnce(){
  if (__openingHandDone) return;

  const deckEl = document.getElementById(DECK_EL_ID);
  if (!deckEl) { setTimeout(armOpeningHandOnce, 100); return; }

  const handler = (ev) => {
    if (__openingHandDone) { detach(); return; }

    // If the deck isn't mounted yet, this click is the "open deck loader" — pass through.
    if (!deckIsMounted()) return;

    // If the click is on the cluster (Draw X / Cascade X / 🔍 / ➕), ignore it.
    if (clickIsFromDeckCluster(ev)) return;

    // This is the first *draw* click on the actual deck card-back. Intercept and run Mulligan.
    try { ev.stopImmediatePropagation(); } catch {}
    try { ev.stopPropagation(); } catch {}
    if (ev.cancelable) ev.preventDefault();

    detach();
    drawOpeningHandLoop();
  };

  function detach(){
    deckEl.removeEventListener('touchstart', handler, true);
    deckEl.removeEventListener('pointerdown', handler, true);
    deckEl.removeEventListener('click',       handler, true);
  }

  // Capture-phase listeners so we pre-empt Zones' own click handlers.
  // Use touchstart + pointerdown + click to cover mobile + desktop.
  deckEl.addEventListener('touchstart', handler, { capture: true, passive: false });
  deckEl.addEventListener('pointerdown', handler, { capture: true });
  deckEl.addEventListener('click',       handler, { capture: true });

  console.log('[OpeningHand] armed — waiting for first deck card-back click (dataset.hasDeck="1")');
}

// Re-arm when the deck inventory changes (Zones emits this) and on module load.
window.addEventListener('deckloading:changed', () => setTimeout(armOpeningHandOnce, 0));
setTimeout(armOpeningHandOnce, 0);




// Optional manual hook
if (!window.Hand) window.Hand = {};
window.Hand.armOpeningHandOnce = armOpeningHandOnce;


// ───────────────────────────────────────── Hand UI / Fan / Gestures ───────────────────────────────────────

// pull current live UI tuning from UserInterface settings panel
function getLiveSettings(){
  const live = (window.UserInterface?._UISettingsLive) || {};
  return {
    handCardHeight:      live.handCardHeight      ?? 190,
    handSpreadPx:        live.handSpreadPx        ?? 64,
    tooltipOnDragExit:   live.showTooltipOnDragExitHand ?? true,
    scrubPxPerStep:      46,
    upThresholdPx:       36,
  };
}

// Public globals (convenience)
export const handCards = [];
let focus = -1;
let GHOST_AT = -1;

// static fan tunables
const ROT_PER = 10;
const ROT_CAP = 16;

let handTooltipActive = false;

// Scryfall cache
const ScryCache = new Map(); // name -> imageUrl(normal)

// Unique id for hand cards so Save can find them
function uniqueCid(){
  return 'h_' + Math.random().toString(36).slice(2,10);
}

// ---------- Public API ----------
export function updateHandFan(){ renderHand(); }
export function setHandFocus(target){
  if (typeof target === 'number'){
    focus = clamp(target, 0, Math.max(0, handCards.length - 1));
  } else {
    const i = handCards.indexOf(target);
    if (i >= 0) focus = i;
  }
  renderHand();
}
export function focusLastDrawn(){
	  // 🔵 Inform TurnUpkeep that a local draw completed
  try { window.dispatchEvent(new CustomEvent('turn:localDraw')); } catch {}
  if (!handCards.length) return;
  focus = handCards.length - 1;
  renderHand();
}

export function refanAll(){
  for (const img of handCards){ styleHandCardBase(img); }
  renderHand();

  const live = getLiveSettings();
  const hz = document.getElementById('handZone');
  if (hz){
    hz.style.height = live.handZoneHeight ? `${live.handZoneHeight}px` : hz.style.height;
  }
}

// Draw one (card: {name, imageUrl?} or {faces:[{name,imageUrl}]})
export async function flyDrawToHand(card, deckEl){
  const name = card?.faces?.[0]?.name || card?.name || '';
  let url    = card?.faces?.[0]?.imageUrl || card?.imageUrl || '';
  if (!name) return;

  if (!url) url = await fetchCardImage(name);

  const insertAt = clamp((focus < 0) ? 0 : focus + 1, 0, handCards.length);
  insertGhostAt(insertAt);
  renderHand();

  const from = deckCenterScreenPoint(deckEl);
  const to   = handCatchPoint({ toGhost:true });

  await flyCardToHand({ name, url, from, to });

  const img = document.createElement('img');
  img.className = 'hand-card';
  img.src = url;
  img.alt = img.title = name;
  img.draggable = false;

  // REQUIRED so Save.state can detect & serialize hand cards:
  img.dataset.cid   = uniqueCid();
  img.dataset.owner = String((typeof window.mySeat === 'function' ? window.mySeat() : (window.__LOCAL_SEAT||1)));
  img.dataset.name  = name;

  // STASH FULL METADATA FOR BOTH FACES ON THE HAND CARD
  try {
    if (card.name)              img.dataset.cardName = card.name;
    img.dataset.currentSide = card.currentSide || 'front';
    if (card.typeLine)          img.dataset.typeLine = card.typeLine;
    if (card.oracle)            img.dataset.oracle   = card.oracle;
    if (card.baseTypes)         img.dataset.baseTypes = JSON.stringify(card.baseTypes);
    if (card.baseAbilities)     img.dataset.baseAbilities = JSON.stringify(card.baseAbilities);

    if (card.untapsDuringUntapStep !== undefined) {
      img.dataset.untapsDuringUntapStep = card.untapsDuringUntapStep ? 'true' : 'false';
    }

    if (card.frontTypeLine)         img.dataset.frontTypeLine = card.frontTypeLine;
    if (card.frontOracle)           img.dataset.frontOracle   = card.frontOracle;
    if (card.frontBaseTypes)        img.dataset.frontBaseTypes = JSON.stringify(card.frontBaseTypes);
    if (card.frontBaseAbilities)    img.dataset.frontBaseAbilities = JSON.stringify(card.frontBaseAbilities);

    if (card.backTypeLine)          img.dataset.backTypeLine = card.backTypeLine;
    if (card.backOracle)            img.dataset.backOracle   = card.backOracle;
    if (card.backBaseTypes)         img.dataset.backBaseTypes = JSON.stringify(card.backBaseTypes);
    if (card.backBaseAbilities)     img.dataset.backBaseAbilities = JSON.stringify(card.backBaseAbilities);

    if (card.imgFront)              img.dataset.imgFront = card.imgFront;
    if (card.imgBack)               img.dataset.imgBack  = card.imgBack;
  } catch(e){
    console.warn('[Hand] failed to stash card metadata on hand img', e, card);
  }

  document.getElementById('handZone')?.appendChild(img);
  handCards.splice(insertAt, 0, img);
  clearGhost();

  focus = insertAt;
  styleHandCardBase(img);
  attachHandGestures(img);
  renderHand();
}

window.flyDrawToHand = flyDrawToHand; // convenience for Zones

// === Hand snapshot for Save/Restore ========================================
export function exportHandSnapshot(ownerKey = 'player'){
  if (ownerKey !== 'player') return [];
  return handCards.map(img => ({
    cid    : img.dataset.cid || '',
    owner  : Number(img.dataset.owner || (typeof window.mySeat === 'function' ? window.mySeat() : 1)),
    name   : img.title || img.alt || img.dataset.name || '',
    img    : img.currentSrc || img.src || '',
    // carry along metadata so the opponent can recreate correctly on restore
    rules: {
      currentSide: img.dataset.currentSide || 'front',
      typeLine   : img.dataset.typeLine   || '',
      oracle     : img.dataset.oracle     || '',
      baseTypes  : safeJsonParseArray(img.dataset.baseTypes),
      baseAbilities: safeJsonParseArray(img.dataset.baseAbilities),
      front: {
        typeLine      : img.dataset.frontTypeLine || '',
        oracle        : img.dataset.frontOracle   || '',
        baseTypes     : safeJsonParseArray(img.dataset.frontBaseTypes),
        baseAbilities : safeJsonParseArray(img.dataset.frontBaseAbilities),
        img           : img.dataset.imgFront || ''
      },
      back: {
        typeLine      : img.dataset.backTypeLine || '',
        oracle        : img.dataset.backOracle   || '',
        baseTypes     : safeJsonParseArray(img.dataset.backBaseTypes),
        baseAbilities : safeJsonParseArray(img.dataset.backBaseAbilities),
        img           : img.dataset.imgBack || ''
      }
    }
  }));
}

window.exportHandSnapshot = exportHandSnapshot;

// ---------- Render (fan) ----------
function renderHand(){
  const zone = document.getElementById('handZone');
  if (!zone) return;

  const n = handCards.length + (GHOST_AT >= 0 ? 1 : 0);
  if (n === 0){ focus = -1; return; }

  if (focus < 0 || focus > handCards.length - 1) {
    focus = Math.floor((handCards.length - 1) / 2);
  }

  const zr = zone.getBoundingClientRect();
  const cx = Math.floor(zr.width / 2);

  const live = getLiveSettings();
  const GAP  = live.handSpreadPx;

  for (let i = 0, phys = 0; i < handCards.length; i++, phys++){
    if (GHOST_AT >= 0 && phys === GHOST_AT) phys++;
    const el = handCards[i];
    const rel = phys - focus;

    const xOff = rel * GAP;
    const yOff = -Math.max(0, 26 - 6 * (rel * rel));  // dome arc
    const rot  = clampDeg(rel * ROT_PER, -ROT_CAP, ROT_CAP);
    const z    = 100 - Math.abs(rel);

    Object.assign(el.style, {
      position: 'absolute',
      left: `${cx}px`,
      bottom: '0px',
      transform: `translate(-50%,0) translate(${xOff}px, ${yOff}px) rotate(${rot}deg)`,
      zIndex: String(z),
    });
  }

  if (handTooltipActive) {
    try { window.Tooltip?.showForHandFocus(handCards[focus]); } catch {}
  }
}

// ---------- Gestures (mouse + touch unified) ----------
function attachHandGestures(img) {
  img.addEventListener('pointerdown', (ev) => onHandPointerDown(ev, img), { passive: false });
}

let scrubActive = false;
let scrubStartX = 0, scrubAccum = 0;

function onHandPointerDown(ev, img) {
  if (ev.pointerType === 'touch' && ev.isPrimary === false) return;
  ev.preventDefault(); ev.stopPropagation();

  const idx = handCards.indexOf(img);
  if (idx < 0) return;

  const live = getLiveSettings();
  const UP_THRESH_PX = live.upThresholdPx;
  const SCRUB_STEP_PIXELS = live.scrubPxPerStep;
  const SHOW_TOOLTIP_EARLY = live.tooltipOnDragExit;

  let moved = false;
  const startX = ev.clientX, startY = ev.clientY;
  let lastX = startX;

  scrubActive = true;
  scrubStartX = startX;
  scrubAccum = 0;

  handTooltipActive = true;
  try { window.Tooltip?.showForHandFocus(handCards[focus]); } catch {}

  const pointerId = ev.pointerId;
  ev.target.setPointerCapture(pointerId);

  const onMove = (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) moved = true;

    if (dy <= -UP_THRESH_PX) {
      scrubActive = false;
      cleanup();
      startGhostDrag(img, e, { SHOW_TOOLTIP_EARLY });
      return;
    }

    if (scrubActive) {
      const stepDx = e.clientX - lastX;
      lastX = e.clientX;
      scrubAccum += stepDx;
      const steps = Math.trunc(scrubAccum / SCRUB_STEP_PIXELS);
      if (steps !== 0) {
        scrubAccum -= steps * SCRUB_STEP_PIXELS;
        focus = clamp(focus - steps, 0, Math.max(0, handCards.length - 1));
        renderHand();
        try { window.Tooltip?.showForHandFocus(handCards[focus]); } catch {}
      }
    }

    if (e.cancelable) e.preventDefault();
  };

  const onUp = (e) => {
    if (e.pointerId !== pointerId) return;
    cleanup();
    scrubActive = false;
    ev.target.releasePointerCapture(pointerId);

    if (!moved) {
      const i = handCards.indexOf(img);
      if (i >= 0) {
        focus = i;
        renderHand();
      }
    }
  };

  function cleanup() {
    document.removeEventListener('pointermove', onMove, { passive: false });
    document.removeEventListener('pointerup', onUp, { passive: true });
    document.removeEventListener('pointercancel', onUp, { passive: true });
  }

  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onUp, { passive: true });
  document.addEventListener('pointercancel', onUp, { passive: true });
}

// Swipe-up → floating ghost follows pointer; release outside hand → spawn
function startGhostDrag(img, ev, opts = {}){
  const name = img.title || '';
  const url  = img.currentSrc || img.src;

  const live = getLiveSettings();
  const HAND_H   = parseFloat(getComputedStyle(img).height) || live.handCardHeight || 140;
  const TABLE_H  = getTableBaseHeightPx() * getCameraScaleForGhost();

  let promoted = false;
  let spawnedEl = null;

  const ghost = document.createElement('img');
  ghost.className = 'hand-drag-ghost';
  Object.assign(ghost.style, {
    position: 'fixed',
    left: '0px',
    top:  '0px',
    transform: `translate(${ev.clientX}px, ${ev.clientY}px) translate(-50%,-50%)`,
    height: `${HAND_H}px`,
    zIndex: '99999',
    pointerEvents: 'none'
  });
  ghost.src = url;
  ghost.alt = name;
  document.body.appendChild(ghost);

  handTooltipActive = false;
  try { window.Tooltip?.hide(); } catch {}

  img.style.opacity = '0.28';

  let sx = ev.clientX, sy = ev.clientY;

  const onMove = (e) => {
    sx = e.clientX;
    sy = e.clientY;

    const stillOverHand = isOverHandZone(sx, sy);

    if (!promoted) {
      ghost.style.transform = `translate(${sx}px, ${sy}px) translate(-50%,-50%)`;

      if (!stillOverHand) {
        promoted = true;
        ghost.style.height = `${TABLE_H}px`;

        const metaPayload = {
          name:                          img.dataset.cardName || name || '',
          currentSide:                   img.dataset.currentSide || 'front',

          typeLine:                      img.dataset.typeLine || '',
          oracle:                        img.dataset.oracle || '',
          baseTypes:                     safeJsonParseArray(img.dataset.baseTypes),
          baseAbilities:                 safeJsonParseArray(img.dataset.baseAbilities),

          untapsDuringUntapStep:         (img.dataset.untapsDuringUntapStep === 'true'),

          frontTypeLine:                 img.dataset.frontTypeLine || '',
          frontOracle:                   img.dataset.frontOracle || '',
          frontBaseTypes:                safeJsonParseArray(img.dataset.frontBaseTypes),
          frontBaseAbilities:            safeJsonParseArray(img.dataset.frontBaseAbilities),

          backTypeLine:                  img.dataset.backTypeLine || '',
          backOracle:                    img.dataset.backOracle || '',
          backBaseTypes:                 safeJsonParseArray(img.dataset.backBaseTypes),
          backBaseAbilities:             safeJsonParseArray(img.dataset.backBaseAbilities),

          imgFront:                      img.dataset.imgFront || url || '',
          imgBack:                       img.dataset.imgBack  || ''
        };

        try {
          spawnedEl = CardPlacement.spawnCardAtPointer({
            name,
            img: url,
            sx,
            sy,
            meta: metaPayload
          });
        } catch (err) {
          console.warn('[Hand→Table] spawn failed during promote', err);
          spawnedEl = null;
        }

        try { ghost.remove(); } catch {}

        const idx = handCards.indexOf(img);
if (idx >= 0) handCards.splice(idx, 1);

// 🔹 Count a DECREASE from hand when promoting to table
try { window.TurnUpkeep?.noteHand?.(-1, { reason: 'leave-hand', via: 'promote' }); } catch {}

try { img.remove(); } catch {}
if (handCards.length === 0) {
  focus = -1;
} else if (idx <= focus) {
  focus = clamp(focus - 1, 0, Math.max(0, handCards.length - 1));
}
renderHand();


        if (spawnedEl && opts.SHOW_TOOLTIP_EARLY){
          try {
            if (window.Tooltip && typeof window.Tooltip.setLowProfile === 'function') {
              window.Tooltip.setLowProfile(true, spawnedEl);
            }
          } catch(e){}
        }

        if (spawnedEl) {
          const worldPos = CardPlacement._screenToWorld
            ? CardPlacement._screenToWorld(sx, sy)
            : _screenToWorld(sx, sy);

          if (worldPos) {
            const cardH = getTableBaseHeightPx();
            const cardW = cardH * 0.714;
            spawnedEl.style.left = (worldPos.wx - cardW/2) + 'px';
            spawnedEl.style.top  = (worldPos.wy - cardH/2) + 'px';
          }
          spawnedEl.classList.add('is-dragging');
        }

        return;
      }

      return;
    }

    if (spawnedEl) {
      const worldPos = CardPlacement._screenToWorld
        ? CardPlacement._screenToWorld(sx, sy)
        : _screenToWorld(sx, sy);

      if (worldPos) {
        const cardH = getTableBaseHeightPx();
        const cardW = cardH * 0.714;
        spawnedEl.style.left = (worldPos.wx - cardW/2) + 'px';
        spawnedEl.style.top  = (worldPos.wy - cardH/2) + 'px';
      }
    }
  };

  const onUp = () => {
  cleanup();

  if (!promoted) {
    try { ghost.remove(); } catch {}
    img.style.opacity = '';
    renderHand();
    return;
  }

  if (spawnedEl) {
    try {
      spawnedEl.classList.remove('is-dragging');
      document.body.style.cursor = '';

      // Ownership snapshot + a final lite move (kept)
      const ownershipSnapshot = window._applyOwnershipAfterDrop?.(spawnedEl);
      try {
        const ownerNow = ownershipSnapshot?.ownerCurrent || mySeat();
        const x = parseFloat(spawnedEl.style.left) || 0;
        const y = parseFloat(spawnedEl.style.top)  || 0;
        const packetMove = { type: 'move', cid: spawnedEl.dataset.cid, x, y, owner: ownerNow };
        (window.rtcSend || window.peer?.send)?.(packetMove);
      } catch(e){}

      // Owner-swap echo (kept)
      try {
        const o2 = window._applyOwnershipAfterDrop?.(spawnedEl);
        const packetSwap = {
          type: 'owner-swap',
          cid : spawnedEl.dataset.cid,
          ownerOriginal: o2?.ownerOriginal || null,
          ownerCurrent : o2?.ownerCurrent  || null,
          fieldSide    : o2?.fieldSide     || null
        };
        (window.rtcSend || window.peer?.send)?.(packetSwap);
      } catch(e){}

      // ⬅️ NEW: run the SAME zone routing finalizeDrop uses
      try {
        const CP = window.CardPlacement || {};
        if (typeof CP.evaluateDropZones === 'function') {
          CP.evaluateDropZones(spawnedEl);
        } else {
          // Fallback to local helper if export missing (shouldn’t happen after patch)
          window.evaluateDropZones?.(spawnedEl);
        }
      } catch (e) {
        console.warn('[Hand→Table] evaluateDropZones failed', e);
      }

      // Tooltip cleanup
      try {
        if (window.Tooltip && typeof window.Tooltip.setLowProfile === 'function') {
          window.Tooltip.setLowProfile(false, spawnedEl);
        }
      } catch(e){}
    } catch(e){
      console.warn('[Hand→Table] finalize drop failed', e);
    }
  }
};

  function cleanup(){
    document.removeEventListener('pointermove', onMove, { passive:false });
    document.removeEventListener('pointerup',   onUp,   { passive:true  });
  }

  document.addEventListener('pointermove', onMove, { passive:false });
  document.addEventListener('pointerup',   onUp,   { passive:true  });
}

// ---------- Ghost helpers ----------
function insertGhostAt(i){ GHOST_AT = clamp(i, 0, handCards.length); }
function clearGhost(){ GHOST_AT = -1; }

// ---------- Geometry / utils ----------
function handCatchPoint({ toGhost } = {}){
  const zone = document.getElementById('handZone');
  const zr = zone.getBoundingClientRect();

  const n = handCards.length + (GHOST_AT >= 0 ? 1 : 0);
  if (n === 0){
    return { x: zr.left + zr.width / 2, y: zr.bottom };
  }

  const targetIndex = (toGhost && GHOST_AT >= 0) ? GHOST_AT : focus;
  const rel = targetIndex - focus;

  const live = getLiveSettings();
  const GAP  = live.handSpreadPx;

  const xOff = rel * GAP;
  const yOff = -Math.max(0, 26 - 6 * (rel * rel));

  const x = (zr.left + zr.width/2) + xOff;
  const y = zr.bottom + yOff;

  return { x, y };
}

function deckCenterScreenPoint(deckEl){
  const el = deckEl || document.getElementById('pl-deck');
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width/2, y: r.top + r.height/2 };
}
function flyCardToHand({ name, url, from, to }){
  return new Promise((resolve) => {
    const live = getLiveSettings();
    const CARD_H = live.handCardHeight;

    const el = document.createElement('img');
    el.className = 'fly-card';
    el.src = url; el.alt = name || ''; el.draggable = false;
    Object.assign(el.style, {
      position: 'fixed', left: '0px', top: '0px',
      transform: `translate(${from.x}px, ${from.y}px) translate(-50%,-50%)`,
      height: `${CARD_H}px`,
      pointerEvents: 'none', zIndex: '99999'
    });
    document.body.appendChild(el);
    const anim = el.animate([
      { transform: `translate(${from.x}px, ${from.y}px) translate(-50%,-50%)` },
      { transform: `translate(${to.x}px, ${to.y}px) translate(-50%,-50%)` }
    ], { duration: 220, easing: 'cubic-bezier(.25,.7,.2,1)' });
    anim.finished.then(()=>{ el.remove(); resolve(); }).catch(()=>{ el.remove(); resolve(); });
  });
}

function styleHandCardBase(img){
  const live = getLiveSettings();
  const CARD_H = live.handCardHeight;

  img.style.height = `${CARD_H}px`;
  img.style.transformOrigin = 'center bottom';
  img.style.pointerEvents = 'auto';
  img.style.cursor = 'grab';
  img.style.userSelect = 'none';
  img.style.webkitUserDrag = 'none';
}

function isOverHandZone(sx, sy){
  const zone = document.getElementById('handZone');
  const r = zone.getBoundingClientRect();
  const top = r.top + 10; // shrink cancel region
  return sx >= r.left && sx <= r.right && sy >= top && sy <= r.bottom;
}
function getTableBaseHeightPx(){
  const cs = getComputedStyle(document.documentElement);
  const v = cs.getPropertyValue('--card-height-table').trim();
  const n = parseFloat(v || '180');
  return Number.isFinite(n) ? n : 180;
}
function getWorldScale(){
  return (typeof window.scale === 'number' && window.scale > 0) ? window.scale : 1;
}

// true camera scale for matching on-table visual size during hand drag
function getCameraScaleForGhost(){
  if (window.Camera && window.Camera.state && typeof window.Camera.state.scale === 'number'){
    const s = window.Camera.state.scale;
    if (s > 0) return s;
  }
  if (typeof window.scale === 'number' && window.scale > 0){
    return window.scale;
  }
  return 1;
}

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function clampDeg(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

function safeJsonParseArray(str){
  if (!str) return [];
  try {
    const v = JSON.parse(str);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ---------- Scryfall helper ----------
async function fetchCardImage(name){
  if (ScryCache.has(name)) return ScryCache.get(name);
  try{
    const r = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('scryfall error');
    const j = await r.json();
    let url = '';
    if (j.image_uris?.normal) url = j.image_uris.normal;
    else if (Array.isArray(j.card_faces) && j.card_faces[0]?.image_uris?.normal) url = j.card_faces[0].image_uris.normal;
    if (!url) throw new Error('no image');
    ScryCache.set(name, url);
    return url;
  } catch (e) {
    console.warn('[Hand] scryfall fetch failed for', name, e);
    return '';
  }
}

// ===== RESTORE: rebuild the hand from a saved snapshot (keeps order & fan) =====
export function restoreHandFromSnapshot(handList, { append = false } = {}){
  const zone = document.getElementById('handZone');
  if (!zone) return;

  if (!append){
    for (const el of handCards.splice(0)){
      try { el.remove(); } catch {}
    }
    focus = -1;
  }

  const seat = (typeof window.mySeat === 'function' ? window.mySeat() : (window.__LOCAL_SEAT || 1));

  for (const h of (handList || [])){
    const img = document.createElement('img');
    img.className = 'hand-card';
    img.src = h.img || h?.rules?.front?.img || h?.rules?.back?.img || '';
    img.alt = img.title = h.name || '';
    img.draggable = false;

    img.dataset.cid   = h.cid   || ('h_' + Math.random().toString(36).slice(2,10));
    img.dataset.owner = String(h.owner ?? seat);
    img.dataset.name  = h.name || '';

    const r = h.rules || {};
    img.dataset.currentSide = r.currentSide || 'front';
    if (r.typeLine)      img.dataset.typeLine = r.typeLine;
    if (r.oracle)        img.dataset.oracle   = r.oracle;
    if (r.baseTypes)     img.dataset.baseTypes = JSON.stringify(r.baseTypes);
    if (r.baseAbilities) img.dataset.baseAbilities = JSON.stringify(r.baseAbilities);

    if (r.front){
      if (r.front.typeLine)       img.dataset.frontTypeLine = r.front.typeLine;
      if (r.front.oracle)         img.dataset.frontOracle = r.front.oracle;
      if (r.front.baseTypes)      img.dataset.frontBaseTypes = JSON.stringify(r.front.baseTypes);
      if (r.front.baseAbilities)  img.dataset.frontBaseAbilities = JSON.stringify(r.front.baseAbilities);
      if (r.front.img)            img.dataset.imgFront = r.front.img;
    }
    if (r.back){
      if (r.back.typeLine)        img.dataset.backTypeLine = r.back.typeLine;
      if (r.back.oracle)          img.dataset.backOracle = r.back.oracle;
      if (r.back.baseTypes)       img.dataset.backBaseTypes = JSON.stringify(r.back.baseTypes);
      if (r.back.baseAbilities)   img.dataset.backBaseAbilities = JSON.stringify(r.back.baseAbilities);
      if (r.back.img)             img.dataset.imgBack = r.back.img;
    }

    styleHandCardBase(img);
    attachHandGestures(img);
    zone.appendChild(img);
    handCards.push(img);
  }

  if (handCards.length){
    focus = handCards.length - 1;
  }
  renderHand();
}

// expose debug/global helpers
if (!window.Hand) window.Hand = {};
Object.assign(window.Hand, {
  handCards,
  updateHandFan,
  setHandFocus,
  focusLastDrawn,
  flyDrawToHand,
  refanAll,
  restoreHandFromSnapshot,

  // Opening hand helper (new)
  armOpeningHandOnce,
});
