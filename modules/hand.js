// modules/hand.js
// Hand UI (fan) + draw-in animation + swipe-up to play onto table.
// - Center-pivot fan with dome arc
// - Draw from DeckStore via fly animation from deck zone
// - Auto-fetch Scryfall art if imageUrl is missing
// - Swipe up on a hand card -> spawn on table at pointer via CardPlacement.spawnCardAtPointer

import { CardPlacement } from './card.placement.math.js';

// pull current live UI tuning from UserInterface settings panel
function getLiveSettings(){
  // falls back to sane defaults if UI hasn't mounted yet
  const live = (window.UserInterface?._UISettingsLive) || {};
  return {
    handCardHeight:      live.handCardHeight      ?? 190,
    handSpreadPx:        live.handSpreadPx        ?? 64,
    tooltipOnDragExit:   live.showTooltipOnDragExitHand ?? true,
    // these next two are still good as hard tunables, but we'll keep them here
    scrubPxPerStep:      46,
    upThresholdPx:       36,
  };
}

// Public globals (convenience)
export const handCards = [];           // Array<HTMLImageElement> in the hand
let focus = -1;                        // index of focused card
let GHOST_AT = -1;                     // ghost slot index during draw

// ---- Tunables (dynamic via settings + static) ----
// CARD_H, GAP, SCRUB_PX_PER_STEP, UP_THRESH all now come from getLiveSettings()
// ROT_PER / ROT_CAP stay static curve style for now
const ROT_PER = 10;                    // deg per step from center
const ROT_CAP = 16;                    // clamp


//// ---- Tunables ----
//const CARD_H = 190;                    // CSS height for hand cards
//const GAP    = 64;                     // spacing between slots
//const ROT_PER = 10;                    // deg per step from center
//const ROT_CAP = 16;                    // clamp
//const SCRUB_PX_PER_STEP = 46;          // horizontal pixels -> 1 focus step
//const UP_THRESH = 36;                  // px upward before starting swipe-up play

// Tooltip follow
let handTooltipActive = false;

// Scryfall cache for art lookups on demand
const ScryCache = new Map(); // name -> imageUrl(normal)

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
  if (!handCards.length) return;
  focus = handCards.length - 1;
  renderHand();
}

export function refanAll(){
  // re-apply base style/height to every card in case size changed
  for (const img of handCards){
    styleHandCardBase(img);
  }
  renderHand();

  // also resize the handZone height based on settings so the reserve bar grows/shrinks
  const live = getLiveSettings();
  const hz = document.getElementById('handZone');
  if (hz){
    // UserInterface.applyLiveSettingsToCSSVars() will also set --hand-zone-height,
    // but we double-set here inline so you see it instantly even if CSS var lagged.
    hz.style.height = live.handZoneHeight ? `${live.handZoneHeight}px` : hz.style.height;
  }
}


// Draw one (card: {name, imageUrl?} or {faces:[{name,imageUrl}]})
export async function flyDrawToHand(card, deckEl){
  // Normalize shape
  const name = card?.faces?.[0]?.name || card?.name || '';
  let url    = card?.faces?.[0]?.imageUrl || card?.imageUrl || '';

  if (!name) return;

  // If no image provided, fetch from Scryfall now
  if (!url) url = await fetchCardImage(name);

  // Insert ghost to the right of focus (or index 0 if empty)
  const insertAt = clamp((focus < 0) ? 0 : focus + 1, 0, handCards.length);
  insertGhostAt(insertAt);
  renderHand();

  // Compute fly animation endpoints (screen coords)
  const from = deckCenterScreenPoint(deckEl);
  const to   = handCatchPoint({ toGhost:true });

  await flyCardToHand({ name, url, from, to });

  // Swap ghost -> real element
  const img = document.createElement('img');
  img.className = 'hand-card';
  img.src = url;
  img.alt = img.title = name;
  img.draggable = false;
  styleHandCardBase(img);
  attachHandGestures(img);

  // 🔵 STASH FULL METADATA FOR BOTH FACES ON THE HAND CARD
  // Everything here comes straight from DeckLoading's cardEntry:
  //   {
  //     name,
  //     imageUrl,
  //     untapsDuringUntapStep,
  //     baseTypes, baseAbilities,                // current face
  //     frontBaseTypes, frontBaseAbilities,
  //     backBaseTypes,  backBaseAbilities,
  //     frontTypeLine,  backTypeLine,
  //     frontOracle,    backOracle,
  //     imgFront,       imgBack,
  //     currentSide: 'front' | 'back'
  //   }

  try {
    // raw identity
    if (card.name)              img.dataset.cardName = card.name;

    // which face is active in-hand (DeckLoading sets 'front' initially)
    img.dataset.currentSide = card.currentSide || 'front';

    // CURRENT FACE snapshot (mirrors how we'll badge it on table spawn)
    // These are convenience mirrors so Tooltip/Baddies can just read data-* without guessing side.
    if (card.typeLine)          img.dataset.typeLine = card.typeLine;
    if (card.oracle)            img.dataset.oracle   = card.oracle;
    if (card.baseTypes)         img.dataset.baseTypes = JSON.stringify(card.baseTypes);
    if (card.baseAbilities)     img.dataset.baseAbilities = JSON.stringify(card.baseAbilities);

    // UNTAP rule flag
    if (card.untapsDuringUntapStep !== undefined) {
      img.dataset.untapsDuringUntapStep = card.untapsDuringUntapStep ? 'true' : 'false';
    }

    // --- BOTH FACES, for flip logic once it's on the table ---
    // front face canonical info
    if (card.frontTypeLine)         img.dataset.frontTypeLine = card.frontTypeLine;
    if (card.frontOracle)           img.dataset.frontOracle   = card.frontOracle;
    if (card.frontBaseTypes)        img.dataset.frontBaseTypes = JSON.stringify(card.frontBaseTypes);
    if (card.frontBaseAbilities)    img.dataset.frontBaseAbilities = JSON.stringify(card.frontBaseAbilities);

    // back face canonical info
    if (card.backTypeLine)          img.dataset.backTypeLine = card.backTypeLine;
    if (card.backOracle)            img.dataset.backOracle   = card.backOracle;
    if (card.backBaseTypes)         img.dataset.backBaseTypes = JSON.stringify(card.backBaseTypes);
    if (card.backBaseAbilities)     img.dataset.backBaseAbilities = JSON.stringify(card.backBaseAbilities);

    // art for each face
    if (card.imgFront)              img.dataset.imgFront = card.imgFront;
    if (card.imgBack)               img.dataset.imgBack  = card.imgBack;
  } catch(e){
    console.warn('[Hand] failed to stash card metadata on hand img', e, card);
  }


  // Place into DOM & array
  document.getElementById('handZone')?.appendChild(img);
  handCards.splice(insertAt, 0, img);
  clearGhost();

  // refocus and redraw now that ghost is gone
  focus = insertAt;
  renderHand();
}




// Bind a simple “Draw 1” helper (optional)
if (!window.Hand) window.Hand = {};
Object.assign(window.Hand, {
  handCards,
  updateHandFan,
  setHandFocus,
  focusLastDrawn,
  flyDrawToHand,
  refanAll
});

window.flyDrawToHand = flyDrawToHand; // convenience for Zones

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

  // pull live tuning
  const live = getLiveSettings();
  const GAP  = live.handSpreadPx;

  for (let i = 0, phys = 0; i < handCards.length; i++, phys++){
    if (GHOST_AT >= 0 && phys === GHOST_AT) phys++;   // skip a slot for the ghost
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


/// ---------- Gestures (mouse + touch unified) ----------
function attachHandGestures(img) {
  img.addEventListener('pointerdown', (ev) => onHandPointerDown(ev, img), { passive: false });
}

let scrubActive = false;
let scrubStartX = 0, scrubAccum = 0;

function onHandPointerDown(ev, img) {
  // Ignore multitouch (only one finger)
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

  // Show tooltip for selected card
  handTooltipActive = true;
  try { window.Tooltip?.showForHandFocus(handCards[focus]); } catch {}

  const pointerId = ev.pointerId;
  ev.target.setPointerCapture(pointerId);

  const onMove = (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) moved = true;

    // Swipe-up → play onto table
    if (dy <= -UP_THRESH_PX) {
      scrubActive = false;
      cleanup();
      startGhostDrag(img, e, { SHOW_TOOLTIP_EARLY });
      return;
    }

    // Horizontal scrub for focus
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

    // Prevent page scroll during drag
    if (e.cancelable) e.preventDefault();
  };

  const onUp = (e) => {
    if (e.pointerId !== pointerId) return;
    cleanup();
    scrubActive = false;
    ev.target.releasePointerCapture(pointerId);

    // simple tap → refocus
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
// Swipe-up → floating ghost follows pointer; release outside hand → spawn
function startGhostDrag(img, ev, opts = {}){
  const name = img.title || '';
  const url  = img.currentSrc || img.src;

  const live = getLiveSettings();

  // size info for the ghost visual while still over the hand
  const HAND_H   = parseFloat(getComputedStyle(img).height) || live.handCardHeight || 140;
  const TABLE_H  = getTableBaseHeightPx() * getCameraScaleForGhost();

  // track whether we've "promoted" to a real table card yet
  let promoted = false;
  let spawnedEl = null; // the real table-card once created

  // build the temporary ghost (this is only used BEFORE promotion)
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

  // we ALWAYS hide tooltip while finger is still in the hand zone starting drag
  handTooltipActive = false;
  try { window.Tooltip?.hide(); } catch {}

  // fade card still sitting in hand so you know it's "picked up"
  img.style.opacity = '0.28';

  // live pointer
  let sx = ev.clientX, sy = ev.clientY;


  // we tap into Pointer Capture style drag: we already got pointerdown on the hand card,
  // so now pointermove on document will drive either ghost or spawnedEl.
  const onMove = (e) => {
    sx = e.clientX;
    sy = e.clientY;

    const stillOverHand = isOverHandZone(sx, sy);

    // CASE 1: not promoted yet, still dragging the ghost
    if (!promoted) {
      // move ghost under cursor
      ghost.style.transform = `translate(${sx}px, ${sy}px) translate(-50%,-50%)`;

      // first moment we LEAVE the hand area => PROMOTE
      if (!stillOverHand) {
        promoted = true;

        ghost.style.height = `${TABLE_H}px`;

        // pull the FULL metadata we stashed in flyDrawToHand()
        const metaPayload = {
          // identity
          name:                          img.dataset.cardName || name || '',
          currentSide:                   img.dataset.currentSide || 'front',

          // convenience "current face" snapshot
          typeLine:                      img.dataset.typeLine || '',
          oracle:                        img.dataset.oracle || '',
          baseTypes:                     safeJsonParseArray(img.dataset.baseTypes),
          baseAbilities:                 safeJsonParseArray(img.dataset.baseAbilities),

          // untap rule for upkeep logic
          untapsDuringUntapStep:         (img.dataset.untapsDuringUntapStep === 'true'),

          // front face canonical info
          frontTypeLine:                 img.dataset.frontTypeLine || '',
          frontOracle:                   img.dataset.frontOracle || '',
          frontBaseTypes:                safeJsonParseArray(img.dataset.frontBaseTypes),
          frontBaseAbilities:            safeJsonParseArray(img.dataset.frontBaseAbilities),

          // back face canonical info
          backTypeLine:                  img.dataset.backTypeLine || '',
          backOracle:                    img.dataset.backOracle || '',
          backBaseTypes:                 safeJsonParseArray(img.dataset.backBaseTypes),
          backBaseAbilities:             safeJsonParseArray(img.dataset.backBaseAbilities),

          // art for both faces
          imgFront:                      img.dataset.imgFront || url || '',
          imgBack:                       img.dataset.imgBack  || ''
        };

        try {
          spawnedEl = CardPlacement.spawnCardAtPointer({
            name,
            img: url,   // this is the art we’re currently dragging (front face at draw time)
            sx,
            sy,
            meta: metaPayload
          });
        } catch (err) {
          console.warn('[Hand→Table] spawn failed during promote', err);
          spawnedEl = null;
        }

        try { ghost.remove(); } catch {}

        // remove original from hand immediately
        const idx = handCards.indexOf(img);
        if (idx >= 0) handCards.splice(idx, 1);
        try { img.remove(); } catch {}
        if (handCards.length === 0) {
          focus = -1;
        } else if (idx <= focus) {
          focus = clamp(focus - 1, 0, Math.max(0, handCards.length - 1));
        }
        renderHand();

        // spawnedEl is now a legit table card (CardPlacement registered it,
        // should've stamped datasets, badges hooked, etc.)

        if (spawnedEl && opts.SHOW_TOOLTIP_EARLY){
          try {
            if (window.Tooltip && typeof window.Tooltip.setLowProfile === 'function') {
              // lowProfile true while dragging so it hugs the card
              window.Tooltip.setLowProfile(true, spawnedEl);
            }
          } catch(e){}
        }

        // actively drag the real thing under cursor
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

        return; // done with unpromoted branch
      }



      return; // done with unpromoted branch
    }

    // CASE 2: we've already promoted -> keep moving the REAL CARD
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

    // If we never promoted (user released while still over hand = cancel)
    if (!promoted) {
      try { ghost.remove(); } catch {}
      img.style.opacity = '';
      renderHand();
      return;
    }

    // We DID promote. spawnedEl is already a legit table card, registered in CardPlacement,
    // Badges + tooltip lowProfile already attached, and we manually dragged it.
    // Now we just need to "drop" it like a normal table drag release.

    if (spawnedEl) {
      // simulate the tail end of enableDrag()'s onUp() so ownership etc gets stamped,
      // lowProfile tooltip flips off, and RTC final move/owner-swap goes out.
      try {
        // hand off to the real drag system by faking a mouseup at its current spot:
        // We can't directly call that inner onUp() from here (it's closed over),
        // BUT spawnedEl is now sitting still and user lifted,
        // so we just clear the dragging visuals + finalize ownership manually.

        spawnedEl.classList.remove('is-dragging');
        document.body.style.cursor = '';

        // ownership / broadcast like enableDrag.onUp
        const ownershipSnapshot = window._applyOwnershipAfterDrop?.(spawnedEl);
        try {
          const ownerNow = ownershipSnapshot?.ownerCurrent || mySeat();
          const x = parseFloat(spawnedEl.style.left) || 0;
          const y = parseFloat(spawnedEl.style.top)  || 0;
          const packetMove = {
            type: 'move',
            cid : spawnedEl.dataset.cid,
            x,
            y,
            owner: ownerNow
          };
          (window.rtcSend || window.peer?.send)?.(packetMove);
          if (DBG.on) console.log('%c[Place:drag→send final move(promote)]', 'color:#6cf', packetMove);
        } catch(e){}

        try {
          const ownershipSnapshot2 = window._applyOwnershipAfterDrop?.(spawnedEl);
          const packetSwap = {
            type: 'owner-swap',
            cid : spawnedEl.dataset.cid,
            ownerOriginal: ownershipSnapshot2?.ownerOriginal || null,
            ownerCurrent : ownershipSnapshot2?.ownerCurrent  || null,
            fieldSide    : ownershipSnapshot2?.fieldSide     || null
          };
          (window.rtcSend || window.peer?.send)?.(packetSwap);
          if (DBG.on) console.log('%c[Place:drag→send owner-swap(promote)]', 'color:#fc6', packetSwap);
        } catch(e){}

        // exit low-profile mode so tooltip snaps under the card
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
    return {
      x: zr.left + zr.width / 2,
      y: zr.bottom
    };
  }

  // which logical slot are we aiming for? (ghost slot while animating in)
  const targetIndex = (toGhost && GHOST_AT >= 0) ? GHOST_AT : focus;

  // how far from current focus is that slot
  const rel = targetIndex - focus;

  // pull the current user-tuned spread
  const live = getLiveSettings();
  const GAP  = live.handSpreadPx;

  // same dome arc math renderHand() uses
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

// NEW: true camera scale for matching on-table visual size during hand drag
function getCameraScaleForGhost(){
  // 1. Preferred: Camera.state.scale (what card.placement.math.js uses to scale <world>)
  if (window.Camera && window.Camera.state && typeof window.Camera.state.scale === 'number'){
    const s = window.Camera.state.scale;
    if (s > 0) return s;
  }

  // 2. Fallback: legacy window.scale if something older is still updating that
  if (typeof window.scale === 'number' && window.scale > 0){
    return window.scale;
  }

  // 3. Safety default
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
    return ''; // fallback -> will still draw with missing art if necessary
  }
}
