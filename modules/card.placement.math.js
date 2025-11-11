// modules/card.placement.math.js
// Placement + drag + RTC sync with vertical mirroring around the combat gap.
// Adds detailed console tracing so you can see EXACTLY how spawn/move math is decided.
//
// Public API (also on window.CardPlacement):
//   CardPlacement.spawnCommanderLocal({ name, img })
//   CardPlacement.spawnCardLocal({ name, img, x?, y? }) // x,y optional (top-left, world px)
//   CardPlacement.applyRemoteSpawn(msg)  // {type:'spawn', cid, name, img, x, y, owner, zone?}
//   CardPlacement.applyRemoteMove(msg)   // {type:'move',  cid, x,   y,   owner}
//
// Local drag lock: while I’m dragging a cid, ignore all remote move echoes for it.

import { Zones } from './zones.js';   // ⬅️ NEW: so we can call Zones.recordCardToZone()
import { extractInnateAbilities } from './oracle.innate.js'; // ⬅️ innate ability parser for RTC spawn
import { DeckLoading } from './deck.loading.js';            // ⬅️ use module, not window.*

const localDragLock = new Set();


export const CardPlacement = (() => {
  // ---------- Debug toggles ----------
  const DBG = {
    on: true,            // master switch
    stream: true,        // log every throttled move send
    recv: true,          // log applyRemote* receive paths
    gapOncePerFrame: true
  };
  // Expose a quick toggle in console: window.MirrorDebug(false) to silence
  window.MirrorDebug = (v=true) => { DBG.on = !!v; console.log('[Place] debug:', DBG); };

  // ---------- CSS-driven card size ----------
  const CSS_CARD_H = () =>
    parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--card-height-table')) || 180;
  const CSS_CARD_W = () =>
    parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--card-width-table')) || (CSS_CARD_H() * 0.714);

  // ---------- Camera helpers ----------
  function getCam() {
    const cam = (window.Camera && window.Camera.state) || { x: 0, y: 0, scale: 1 };
    return { x: cam.x|0, y: cam.y|0, scale: +cam.scale || 1 };
  }
  function screenToWorld(sx, sy) {
    const { x, y, scale } = getCam();
    return { wx: (sx - x) / scale, wy: (sy - y) / scale };
  }
  
  window._screenToWorld = screenToWorld;


// Snapshot rules for a card element with strong fallbacks.
// Prefers current face (currentSide) → dataset.* → front*/back* → derive/compute.
function _snapshotRules(el){
  const d = el?.dataset || {};
  const side = (d.currentSide === 'back') ? 'back' : 'front';

  const pick = (key) => {
    // Try active face first (frontTypeLine/backTypeLine), then generic, then the other face
    return d[side + key] || d[key.toLowerCase()] || d[(side === 'back' ? 'front' : 'back') + key] || '';
  };

  // Type line / Oracle with fallbacks
  const typeLine = d.typeLine || pick('TypeLine') || '';
  const oracle   = d.oracle   || pick('Oracle')   || '';

  // Base types
  let baseTypes = [];
  if (d.baseTypes) {
    try { const arr = JSON.parse(d.baseTypes); if (Array.isArray(arr)) baseTypes = arr.slice(); } catch {}
  }
  if (!baseTypes.length) {
    const faceKey = side + 'BaseTypes';
    if (d[faceKey]) { try { const arr = JSON.parse(d[faceKey]); if (Array.isArray(arr)) baseTypes = arr.slice(); } catch {} }
  }
  if (!baseTypes.length && typeLine) {
    baseTypes = _deriveBaseTypesFromTypeLine(typeLine);
  }

  // Base abilities
  let baseAbilities = [];
  if (d.baseAbilities) {
    try { const arr = JSON.parse(d.baseAbilities); if (Array.isArray(arr)) baseAbilities = arr.slice(); } catch {}
  }
  if (!baseAbilities.length) {
    const faceKey = side + 'BaseAbilities';
    if (d[faceKey]) { try { const arr = JSON.parse(d[faceKey]); if (Array.isArray(arr)) baseAbilities = arr.slice(); } catch {} }
  }
  if (!baseAbilities.length && oracle) {
    baseAbilities = extractInnateAbilities(oracle);
  }

  return { typeLine, oracle, baseTypes, baseAbilities };
}


  // ---------- Combat gap edges (WORLD) ----------
  let _lastGapLogFrame = -1;
  function gapEdgesWorld() {
  const gap = document.querySelector('.mid-gap');
  if (!gap) {
    //console.warn('[Mirror] .mid-gap NOT FOUND — mirroring will be disabled (using 0,0).');
    return { top: 0, bottom: 0 };
  }
  const r   = gap.getBoundingClientRect();
  const topW = screenToWorld(r.left, r.top).wy;
  const botW = screenToWorld(r.left, r.bottom).wy;

  //console.log('[Mirror] gapEdgesWorld:',
    //{ domTop: r.top, domBottom: r.bottom, worldTop: topW, worldBottom: botW, sum: topW + botW });

  return { top: topW, bottom: botW };
}


  // Mirror a TOP-LEFT Y across the combat gap using card height:
  //   y' = (GAP_TOP + GAP_BOTTOM) - y - CARD_HEIGHT
function mirrorTopY(yTop, cardH) {
  const { top: gapTop, bottom: gapBottom } = gapEdgesWorld();
  const sum = gapTop + gapBottom;
  const yOut = (sum) - yTop - cardH;

 // console.log('[Mirror] mirrorTopY formula:',
 //   {
 //     input_yTop: yTop,
 //     cardH,
 //     gapTop,
 //     gapBottom,
 //     sum,
 //     formula: 'yOut = (gapTop + gapBottom) - yTop - cardH',
 //     yOut
 //   });

  return yOut;
}


  // ---------- World & zone helpers ----------
  function worldEl() {
    return document.getElementById('world');
  }
  function worldCenterOf(el) {
    if (!el) return { wx: 0, wy: 0 };
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    return screenToWorld(cx, cy);
  }

    // ---------- Element factory ----------
  // makeCardEl(cid, name, img, meta?)
  // meta is OPTIONAL. When provided from DeckLoading it should look like:
  // {
  //   typeLine: "Creature — Dragon",
  //   oracle: "Flying ...",
  //   baseTypes: ["Creature","Dragon"],
  //   baseAbilities: ["Flying"],
  //   power: "4",
  //   toughness: "3"
  // }
  //
  // We will stamp these onto dataset so badges.js can render pills immediately.
  function makeCardEl(cid, name, img, meta) {
    const el = document.createElement('img');
    el.className = 'table-card';

    // --- identity / base visuals ---
    el.dataset.cid  = cid;
    el.dataset.name = name || '';
    el.alt   = name || '';
    el.title = name || '';
    if (img) el.src = img;

    // --- full rules / face metadata (matches what Hand now passes in metaPayload) ---
    // meta may look like:
    // {
    //   name,
    //   currentSide: 'front' | 'back',
    //
    //   // "current face" snapshot:
    //   typeLine, oracle,
    //   baseTypes: [...],
    //   baseAbilities: [...],
    //
    //   untapsDuringUntapStep: true/false,
    //
    //   // front canonical:
    //   frontTypeLine, frontOracle,
    //   frontBaseTypes: [...],
    //   frontBaseAbilities: [...],
    //
    //   // back canonical:
    //   backTypeLine, backOracle,
    //   backBaseTypes: [...],
    //   backBaseAbilities: [...],
    //
    //   imgFront, imgBack,
    //
    //   // MAYBE (commander path / future expansion):
    //   power, toughness
    // }

    if (meta) {
      // Which face we're currently showing on table.
      el.dataset.currentSide = meta.currentSide || 'front';

      // Snapshot of the active face for tooltip/badges-on-spawn.
      if (meta.typeLine)            el.dataset.typeLine = meta.typeLine;
      if (meta.oracle)              el.dataset.oracle   = meta.oracle;

      if (Array.isArray(meta.baseTypes)) {
        el.dataset.baseTypes = JSON.stringify(meta.baseTypes);
      }
      if (Array.isArray(meta.baseAbilities)) {
        el.dataset.baseAbilities = JSON.stringify(meta.baseAbilities);
      }

      // Untap rule flag
      if (typeof meta.untapsDuringUntapStep !== 'undefined') {
        el.dataset.untapsDuringUntapStep = meta.untapsDuringUntapStep ? 'true' : 'false';
      }

      // Store BOTH faces so flip logic / tooltip / badges can update later.
      if (meta.frontTypeLine)          el.dataset.frontTypeLine = meta.frontTypeLine;
      if (meta.frontOracle)            el.dataset.frontOracle   = meta.frontOracle;
      if (Array.isArray(meta.frontBaseTypes)) {
        el.dataset.frontBaseTypes = JSON.stringify(meta.frontBaseTypes);
      }
      if (Array.isArray(meta.frontBaseAbilities)) {
        el.dataset.frontBaseAbilities = JSON.stringify(meta.frontBaseAbilities);
      }

      if (meta.backTypeLine)           el.dataset.backTypeLine = meta.backTypeLine;
      if (meta.backOracle)             el.dataset.backOracle   = meta.backOracle;
      if (Array.isArray(meta.backBaseTypes)) {
        el.dataset.backBaseTypes = JSON.stringify(meta.backBaseTypes);
      }
      if (Array.isArray(meta.backBaseAbilities)) {
        el.dataset.backBaseAbilities = JSON.stringify(meta.backBaseAbilities);
      }

      // Art refs for each face
      if (meta.imgFront)               el.dataset.imgFront = meta.imgFront;
      if (meta.imgBack)                el.dataset.imgBack  = meta.imgBack;

      // Baseline P/T (mainly commander or creatures where we already know it)
      if (meta.power != null && meta.power !== '') {
        el.dataset.power = String(meta.power);
      }
      if (meta.toughness != null && meta.toughness !== '') {
        el.dataset.toughness = String(meta.toughness);
      }
      if (
        meta.power != null && meta.power !== '' &&
        meta.toughness != null && meta.toughness !== ''
      ) {
        el.dataset.ptCurrent = `${meta.power}/${meta.toughness}`;
      }
    }

    // Default table positioning style
    el.style.position = 'absolute';
    el.style.height   = 'var(--card-height-table)';
    el.style.left     = '0px';
    el.style.top      = '0px';
    el.draggable      = false; // we manage drag logic ourselves

    return el;
  }



  // Build the mana/color payload we want to RTC out with every packet.
  // - manaCostRaw: first try dataset.manaCostRaw, fall back to dataset.manaCost, else "".
  // - colors: if dataset.colors exists and is JSON, use it. Otherwise derive from manaCostRaw.
  function _calcManaColorPayload(el){
    const d = el?.dataset || {};
    const rawCost = d.manaCostRaw || d.manaCost || '';

    // Try to use existing dataset.colors (already JSON stringified on remote side).
    let colsArr = [];
    if (d.colors) {
      try {
        const parsed = JSON.parse(d.colors);
        if (Array.isArray(parsed)) colsArr = parsed.slice();
      } catch {}
    }

    // If we still don't have colors, derive from rawCost like "{U}{B}{R}" → ['U','B','R']
    if (!colsArr.length && rawCost) {
      const m = String(rawCost).match(/\{([WUBRG])\}/g) || [];
      const uniq = new Set();
      for (const token of m){
        const c = token.replace(/[{}]/g,'');
        if (c && 'WUBRG'.includes(c)) uniq.add(c);
      }
      colsArr = Array.from(uniq);
    }

    return {
      manaCostRaw: String(rawCost || ''),
      colors: colsArr
    };
  }
  
  // Land detector: catches "Land" in type line or baseTypes list
function _looksLikeLand(el){
  try {
    const tl = (el?.dataset?.typeLine || '').toLowerCase();
    if (/\bland\b/.test(tl)) return true;
    if (el?.dataset?.baseTypes){
      try {
        const bt = JSON.parse(el.dataset.baseTypes);
        if (Array.isArray(bt) && bt.some(t => String(t).toLowerCase()==='land')) return true;
      } catch {}
    }
  } catch {}
  return false;
}


  function placeTopLeft(el, x, y) {
    const w = worldEl();
    if (!w) return;
    if (el.parentNode !== w) w.appendChild(el);
    el.style.left = `${x}px`;
    el.style.top  = `${y}px`;
  }


  function placeAtWorldCenter(el, wx, wy) {
    const x = wx - CSS_CARD_W() / 2;
    const y = wy - CSS_CARD_H() / 2;
    placeTopLeft(el, x, y);
  }
  
  
    // Build a MOVE packet for a given card element `el` and world coords x,y.
  //
  // full === false  -> "lite" streaming packet while dragging
  // full === true   -> full state sync (ownership, zones, sickness, mana/colors)
  //
  // Why:
  //   Streaming every ~16ms with the giant payload was choking the RTC channel,
  //   so the remote only saw the last packet (looked like a snap). Lite packets
  //   keep the channel fluid again.
  function _buildMovePacketFor(el, x, y, full = false) {
    const ownerNow = el.dataset.ownerCurrent || el.dataset.owner || String(mySeat());

    // base packet (always sent)
    const pkt = {
      type        : 'move',
      cid         : el.dataset.cid,
      x,
      y,
      owner       : ownerNow,                     // who controls the card
      senderSeat  : String(mySeat()) || '1'       // who is SENDING this packet
    };


    if (full) {
      // enrich with all the state-y stuff we actually care about AFTER drop
      const sick = (el.dataset.hasSummoningSickness === 'true') ? 'true' : 'false';
      const mc   = _calcManaColorPayload(el);

      pkt.ownerOriginal        = el.dataset.ownerOriginal || null;
      pkt.ownerCurrent         = el.dataset.ownerCurrent  || ownerNow || null;
      pkt.fieldSide            = el.dataset.fieldSide     || null;
      pkt.inCommandZone        = el.dataset.inCommandZone || null;
      pkt.hasSummoningSickness = sick;

      pkt.manaCostRaw          = mc.manaCostRaw;
      pkt.colors               = mc.colors;
    }

    return pkt;
  }


  // Call this AFTER you receive the opponent's End Turn packet
  // (meaning: it's now YOUR turn again).
  //
  // Behavior:
  // - Walk every card on table.
  // - If it's mine AND hasSummoningSickness === "true":
  //     flip it to "false"
  //     broadcast a move packet with updated state so opponent syncs.
  //
  // NOTE: we reuse the card's current DOM left/top for the move packet.
  function clearSummoningSicknessForMyBoard() {
    const me = String(mySeat ? mySeat() : 1);

    document.querySelectorAll('img.table-card[data-cid]').forEach(el => {
      if (!el || !el.dataset) return;

      const isMine = (el.dataset.ownerCurrent || el.dataset.owner) === me;
      if (!isMine) return;

      if (el.dataset.hasSummoningSickness === 'true') {
        // flip local
        el.dataset.hasSummoningSickness = 'false';

        // now broadcast an updated move so the other side knows
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top)  || 0;
        try {
          // full=true because we WANT them to know sickness flipped
          const pkt = _buildMovePacketFor(el, x, y, /*full=*/true);
          (window.rtcSend || window.peer?.send)?.(pkt);
          // if (DBG.on) console.log('%c[SummonSick→cleared→send move]', 'color:#9f6', pkt);
        } catch(e) {
          console.warn('[SummonSick] failed to send sync packet', e);
        }

      }
    });
  }

  
  // --- Cast helpers ----------------------------------------------------------
const CARD_SUPERTYPES = ['Creature','Artifact','Instant','Sorcery','Enchantment','Land','Planeswalker','Battle'];

// Land detection with belts & suspenders:
// - baseTypes includes 'Land'
// - typeLine contains 'Land'
// - badges (baseAbilities) very unlikely to include Land, but we check anyway
function _isLandCard(el) {
  try {
    const tline = (el.dataset.typeLine || '').toLowerCase();
    if (tline.includes('land')) return true;

    const baseTypes = JSON.parse(el.dataset.baseTypes || '[]');
    if (Array.isArray(baseTypes) && baseTypes.some(t => String(t).toLowerCase() === 'land')) {
      return true;
    }

    const baseAbilities = JSON.parse(el.dataset.baseAbilities || '[]');
    if (Array.isArray(baseAbilities) && baseAbilities.some(a => String(a).toLowerCase() === 'land')) {
      return true;
    }
  } catch {}
  return false;
}

// Pull the "primary" card type (Creature/Artifact/Instant/...)
// If multiple exist, prefer the first in CARD_SUPERTYPES order.
function _primaryCardType(el){
  const tline = String(el.dataset.typeLine || '');
  const left  = tline.split('—')[0] || tline; // text before em-dash
  // normalize words like "Legendary Creature Artifact ..." etc.
  const words = left.split(/\s+/).map(w => w.replace(/[^A-Za-z]/g,''));
  for (const supertype of CARD_SUPERTYPES) {
    if (words.includes(supertype)) return supertype;
  }
  // fallback: first capitalized token that looks like a type
  const guess = words.find(w => /^[A-Z][a-z]+$/.test(w));
  return guess || (tline ? tline.trim() : 'Unknown');
}

function _collectAllTypes(el){
  try {
    const baseTypes = JSON.parse(el.dataset.baseTypes || '[]');
    if (Array.isArray(baseTypes) && baseTypes.length) return baseTypes.slice();
  } catch {}
  const tline = String(el.dataset.typeLine || '');
  const left  = tline.split('—')[0] || tline;
  return left.split(/\s+/).filter(Boolean);
}

// Derive base types from a type line (left of em-dash), stripped to words.
function _deriveBaseTypesFromTypeLine(typeLine){
  const left = String(typeLine || '').split('—')[0] || '';
  return left
    .split(/\s+/)
    .map(w => w.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean);
}


// Build + emit the cast event (local call AND optional RTC mirror already handled via origin flag)
function _emitCastFor(el, fromSeat){
  if (!el) return;
  if (_isLandCard(el)) {
    try { window.TurnUpkeep?.noteLandPlay?.({ seat: fromSeat }); } catch {}
    return; // lands are NOT spells
  }


  const mc = _calcManaColorPayload(el);
  const payload = {
    seat: Number(fromSeat) || 1,
    cid:  el.dataset.cid,
    name: el.dataset.name || el.title || '',
    typeLine: el.dataset.typeLine || '',
    primaryType: _primaryCardType(el),
    types: _collectAllTypes(el),
    colors: mc.colors || [],
    manaCostRaw: mc.manaCostRaw || ''
  };
  try { window.TurnUpkeep?.noteCast?.(payload); } catch {}
}

  
  // Spawn at pointer (screen coords) with center alignment, broadcast spawn.
// This is called when we "pull" a card out of hand onto the table.
// We now ALSO immediately hydrate overlays (badges / wand+tap buttons)
// and bring up the tooltip in low-profile dock so we can see the card text
// while dragging BEFORE drop.
function spawnCardAtPointer({ name, img, sx, sy, meta }) {
  const w = worldEl();
  if (!w) return null;

  const id = cid();

  // ⬇ create the element WITH meta so dataset gets all faces, base abilities, etc.
  const el = makeCardEl(id, name, img, meta || null);

  // 🔴 OWNER STAMP (local ownership + summoning sickness on entry)
  try {
    const mine = String(mySeat());

    // birth owner
    el.dataset.owner = mine;

    if (!el.dataset.ownerOriginal) {
      el.dataset.ownerOriginal = mine;
    }
    if (!el.dataset.ownerCurrent) {
      el.dataset.ownerCurrent = mine;
    }

    // brand new permanent hits the table → summoning sickness TRUE
    el.dataset.hasSummoningSickness = 'true';
  } catch {}

  // Convert pointer coords → world center placement
  const { wx, wy } = screenToWorld(sx, sy);
  placeAtWorldCenter(el, wx, wy);

  // Register BEFORE enabling drag (so drag code can look us up in state.byCid if it wants)
  state.byCid.set(id, { el });

  // Make it draggable / network-synced
  enableDrag(el);

  // Attach badges now that dataset already has baseTypes/baseAbilities/currentSide/etc.
  try {
    if (window.Badges && typeof window.Badges.attach === 'function') {
      window.Badges.attach(el);
    }
  } catch(e){
    console.warn('[Place:spawnCardAtPointer] Badges.attach failed', e);
  }

  // Pop tooltip immediately in low-profile mode during drag
  try {
    if (window.Tooltip && typeof window.Tooltip.showForCard === 'function') {
      window.Tooltip.showForCard(el, el, { mode:'bottom' });
      if (typeof window.Tooltip.setLowProfile === 'function') {
        window.Tooltip.setLowProfile(true, el);
      }
    }
  } catch(e){
    console.warn('[Place:spawnCardAtPointer] Tooltip.showForCard failed', e);
  }
  
  // Stamp which turn this permanent hit the table (used by snapshot.estimatedCastsThisTurn)
try{
  const tnow = window.TurnUpkeep?.state?.().turn;
  if (tnow != null) el.dataset.playTurn = String(tnow);
}catch{}


  // Defer spawn broadcast until we know the final drop.
  // This prevents leaking the card if the user drags it back over the hand.
  try {
    el.dataset.pendingSpawn = 'true';
    el._finalizeSpawn = () => {
      if (el.dataset.pendingSpawn !== 'true') return; // already finalized/cancelled
      el.dataset.pendingSpawn = 'false';

      const ownerNow = el.dataset.ownerCurrent || el.dataset.owner || String(mySeat());
      const px = parseFloat(el.style.left) || 0;
      const py = parseFloat(el.style.top)  || 0;

      const mc   = _calcManaColorPayload(el);
      const sick = (el.dataset.hasSummoningSickness === 'true') ? 'true' : 'false';
      const snap = _snapshotRules(el);

      const pkt = {
        senderSeat       : String(mySeat()) || '1',
        type                 : 'spawn',
        origin               : 'hand',
        cid                  : id,
        name,
        img,
        x                    : px,
        y                    : py,
        owner                : ownerNow,
        ownerOriginal        : el.dataset.ownerOriginal || null,
        ownerCurrent         : el.dataset.ownerCurrent  || ownerNow || null,
        fieldSide            : el.dataset.fieldSide     || null,
        inCommandZone        : el.dataset.inCommandZone || null,
        hasSummoningSickness : sick,
        manaCostRaw          : mc.manaCostRaw,
        colors               : mc.colors,
        typeLine             : snap.typeLine || null,
        oracle               : snap.oracle   || null,
        baseAbilities        : snap.baseAbilities || [],
        baseTypes            : snap.baseTypes     || []
      };

      console.log('%c[RTC:spawn SEND]', 'color:#0cf;font-weight:bold',
        { cid:id, name, baseAbilities:pkt.baseAbilities, baseTypes:pkt.baseTypes, typeLine:pkt.typeLine });

      (window.rtcSend || window.peer?.send)?.(pkt);

      // LOCAL: count cast immediately (lands auto-skipped)
      _emitCastFor(el, mySeat());
    };
  } catch {}



  return el;
}









  // ---------- CID ----------
  function cid() { return 'c_' + Math.random().toString(36).slice(2, 10); }

  // ---------- State ----------
  const state = {
    byCid: new Map(), // cid -> { el }
  };

  function mySeat() {
    try { return Number((typeof window.mySeat === 'function') ? window.mySeat() : 1); }
    catch { return 1; }
  }
  
  // get the "other guy"
function _otherSeatNum(seatNum) {
  return (Number(seatNum) === 1) ? 2 : 1;
}

// Decide if a dropped card is on "bottom" or "top" half of the screen.
// For v1 we just use window.innerHeight midpoint.
// Later we can change this to use the actual combat gap / mirror line.
function _calcFieldSideFor(el){
  if (!el) return 'bottom';

  const rect = el.getBoundingClientRect();
  const centerY = rect.top + rect.height / 2;

  // 🟦 Use the combat midline (top bar of half-guide) instead of screen midpoint
  const midBar = document.querySelector('.half-guide.top');
  const midRect = midBar?.getBoundingClientRect();
  const midlineY = midRect?.top ?? (window.innerHeight / 2);

  return (centerY < midlineY) ? 'top' : 'bottom';
}


// Stamp/refresh dataset ownership + side info on drop.
// - ownerOriginal: who spawned it originally (never changes once set)
// - ownerCurrent:  who controls it right now (CAN change)
// - fieldSide:     "bottom" or "top"
function _applyOwnershipAfterDrop(el) {
  if (!el) return;

  const my = mySeat();
  const other = _otherSeatNum(my);

  // figure out which half it's on now
  const side = _calcFieldSideFor(el); // "bottom" or "top"
  el.dataset.fieldSide = side;

  // ensure permanent birth owner is recorded
  if (!el.dataset.ownerOriginal) {
    // prefer explicit stamp if we already had one
    if (el.dataset.ownerCurrent) {
      el.dataset.ownerOriginal = el.dataset.ownerCurrent;
    } else if (el.dataset.owner) {
      el.dataset.ownerOriginal = el.dataset.owner;
    } else {
      el.dataset.ownerOriginal = String(my);
    }
  }

  // control logic (strict):
// - Only change ownership if the card's CENTER passes *below* the bottom bar.
// - Anything between the top bar and bottom bar = neutral → no transfer zone.
let newController = el.dataset.ownerCurrent || String(my);

// Determine top and bottom bar Y positions
const topBar  = document.querySelector('.half-guide.top');
const botBar  = document.querySelector('.half-guide.bottom');
const topRect = topBar?.getBoundingClientRect();
const botRect = botBar?.getBoundingClientRect();

// Compute card center Y
const rect = el.getBoundingClientRect();
const centerY = rect.top + rect.height / 2;

// Default: neutral zone → retain current owner
if (botRect && centerY > botRect.top) {
  // Below bottom bar = belongs to me
  newController = String(my);
} else if (topRect && centerY < topRect.bottom) {
  // Above top bar = belongs to opponent
  newController = String(other);
} else {
  // Between bars = neutral, no change
  //if (DBG.on) console.log('[OWNERSHIP] Neutral zone: ownership unchanged');
}

el.dataset.ownerCurrent = newController;


  // sync legacy .dataset.owner so older code still works
  el.dataset.owner = newController;

 //if (DBG.on) console.log('[OWNERSHIP] post-drop', {
 //  cid: el.dataset.cid,
 //  fieldSide: el.dataset.fieldSide,
 //  ownerOriginal: el.dataset.ownerOriginal,
 //  ownerCurrent: el.dataset.ownerCurrent
 //});

  return {
    ownerOriginal: el.dataset.ownerOriginal,
    ownerCurrent : el.dataset.ownerCurrent,
    fieldSide    : el.dataset.fieldSide
  };
}

// NEW: check if card center is overlapping the commander zone.
// - Stamps el.dataset.inCommandZone = "true"/"false"
// - RETURNS boolean inZone
function _markCommanderZoneStatus(el){
  if (!el) return false;

  // Card center in screen space
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width  / 2;
  const cy = rect.top  + rect.height / 2;

  // Commander zone rect
  const cmd = document.getElementById('pl-commander');
  let inZone = false;
  if (cmd) {
    const rz = cmd.getBoundingClientRect();
    inZone = (cx >= rz.left && cx <= rz.right && cy >= rz.top && cy <= rz.bottom);
  }

  el.dataset.inCommandZone = inZone ? 'true' : 'false';

  //if (DBG.on) {
  //  console.log('[COMMANDER-ZONE] stamp', {
  //    cid: el.dataset.cid,
  //    inCommandZone: el.dataset.inCommandZone
  //  });
  //}

  return inZone;
}

// NEW: if we're in/over the commander zone, snap the card
// to the visual center of that zone.
function _snapToCommanderZone(el){
  if (!el) return;
  const cmd = document.getElementById('pl-commander');
  if (!cmd) return;

  const c = worldCenterOf(cmd);
  placeAtWorldCenter(el, c.wx, c.wy);

  //if (DBG.on) {
  //  console.log('[COMMANDER-ZONE] snap', {
  //    cid: el.dataset.cid,
  //    wx: c.wx,
  //    wy: c.wy
  //  });
  //}
}

// ↓↓↓ ADD THIS HELPER (shared by enableDrag() and hand.js promoted drops)
function __overZoneCenter(el, zoneId) {
  const z = document.getElementById(zoneId);
  if (!z) return false;
  const zr = z.getBoundingClientRect();
  const cr = el.getBoundingClientRect();
  const cx = cr.left + cr.width/2;
  const cy = cr.top  + cr.height/2;
  return (cx >= zr.left && cx <= zr.right && cy >= zr.top && cy <= zr.bottom);
}

// rectangle intersection test with optional upward tolerance
function __overZoneByIntersect(el, zoneId, tol = 0) {
  const z = document.getElementById(zoneId);
  if (!z) return false;
  const zr = z.getBoundingClientRect();
  const cr = el.getBoundingClientRect();

  const zl = zr.left, zrgt = zr.right;
  const zt = zr.top - tol, zb = zr.bottom;

  const cl = cr.left, crgt = cr.right;
  const ct = cr.top,  cb  = cr.bottom;

  const horiz = (cl < zrgt) && (crgt > zl);
  const vert  = (ct < zb)   && (cb > zt);
  return horiz && vert;
}

// Public-ish helper that evaluates drop routing *as if* finalizeDrop() ran.
// It finalizes pending spawn, handles "back to hand", pl/op grave/exile, and pl-deck popup.
function evaluateDropZones(el) {
  if (!el || !el.classList.contains('table-card')) return;

  // If spawn was deferred while dragging from hand, finalize it now
  const inHandNow = __overZoneByIntersect(el, 'handZone', /*tol*/12);
  if (el.dataset.pendingSpawn === 'true' && !inHandNow) {
    try { el._finalizeSpawn?.(); } catch {}
  }

  // 1) Back to MY hand (intersection + tolerance)
  if (inHandNow) {
    try {
      window.Tooltip?.hide?.();
      window.flyDrawToHand?.(
        { name: el.title || '', imageUrl: el.currentSrc || el.src },
        null
      );
    } catch {}
    // mirror finalizeDrop's removeCard(null,'player')
    try {
      (function removeToHand() {
        const cidVal = el.dataset.cid;
        try { window.Badges?.detach?.(el); } catch {}
        try { el.remove(); } catch {}
        try { (window.CardPlacement || {}).state?.byCid?.delete?.(cidVal); } catch {}
        (window.rtcSend || window.peer?.send)?.({ type: 'remove', cid: cidVal, zone: '', ownerSide:'player' });
      })();
    } catch {}
    return;
  }

  // helpers that mirror finalizeDrop’s internals:
  const sendRemove = (finalZone, ownerSide) => {
    const cidVal = el.dataset.cid;
    // Stamp owner to match target pile
    try {
      const my = (typeof window.mySeat === 'function') ? String(window.mySeat()) : '1';
      const other = (my === '1' ? '2' : '1');
      el.dataset.ownerCurrent = (ownerSide === 'player') ? my : other;
      el.dataset.owner        = el.dataset.ownerCurrent;
    } catch {}

    // Record to Zones for grave/exile visual browser
    try {
      if (finalZone === 'graveyard' || finalZone === 'exile') {
        window.Zones?.recordCardToZone?.(ownerSide, finalZone, el);
      }
    } catch {}

    try { window.Tooltip?.hide?.(); } catch {}
    try { window.Badges?.detach?.(el); } catch {}
    try { el.remove(); } catch {}
    try { (window.CardPlacement || {}).state?.byCid?.delete?.(cidVal); } catch {}

    (window.rtcSend || window.peer?.send)?.({
      type: 'remove', cid: cidVal, zone: finalZone, ownerSide
    });
  };

  // 2) MY graveyard / exile
  if (__overZoneCenter(el, 'pl-graveyard')) {
    try { window.TurnUpkeep?.noteGrave?.(); } catch {}
    return sendRemove('graveyard','player');
  }
  if (__overZoneCenter(el, 'pl-exile')) {
    try { window.TurnUpkeep?.noteExile?.(); } catch {}
    return sendRemove('exile','player');
  }

  // 3) OPPONENT graveyard / exile
  if (__overZoneCenter(el, 'op-graveyard')) {
    try { window.TurnUpkeep?.noteGrave?.(); } catch {}
    return sendRemove('graveyard','opponent');
  }
  if (__overZoneCenter(el, 'op-exile')) {
    try { window.TurnUpkeep?.noteExile?.(); } catch {}
    return sendRemove('exile','opponent');
  }

  // 4) MY deck: open modal then remove to 'deck'
  if (__overZoneCenter(el, 'pl-deck')) {
    // re-use existing modal helper if present on this module
    try {
      // Existing showDeckInsertOptions closure lives inside enableDrag,
      // so we fall back to the DeckLoading API directly:
      const pos = 'top'; // default top if no popup available here
      let ok = false;
      if (typeof window.DeckLoading?.insertFromTable === 'function') {
        ok = !!window.DeckLoading.insertFromTable(el, pos);
      }
      if (!ok) console.warn('[DropZones] insertFromTable failed; still removing');
    } catch(e) {
      console.warn('[DropZones] deck insert failed', e);
    }
    return sendRemove('deck','player');
  }
}


// NEW: pull mana cost + color identity for this card so we can include it in RTC packets.
// - manaCostRaw: string like "{1}{U}{B}{R}" (or "")
// - colors: ['U','B','R'] deduped, order is whatever Set iteration gives us
function _extractCostAndColors(el){
  if (!el) {
    return { manaCostRaw: '', colors: [] };
  }

  // Tooltip (showForCard) already seeds dataset.manaCost on first open,
  // and flip() updates it. We'll respect either `manaCost` or `manaCostRaw`.
  const raw = el.dataset.manaCost || el.dataset.manaCostRaw || '';

  const colorSet = new Set();
  // Look inside every {...} group and grab base WUBRG letters anywhere in it.
  raw.replace(/\{([^}]+)\}/g, (_, sym) => {
    if (sym.includes('W')) colorSet.add('W');
    if (sym.includes('U')) colorSet.add('U');
    if (sym.includes('B')) colorSet.add('B');
    if (sym.includes('R')) colorSet.add('R');
    if (sym.includes('G')) colorSet.add('G');
  });

  return {
    manaCostRaw: raw || '',
    colors: Array.from(colorSet) // ex: ['U','B','R']
  };
}

window._applyOwnershipAfterDrop = _applyOwnershipAfterDrop;



  // ---------- Dragging (mouse + touch) with real-time move stream ----------
  function enableDrag(el) {
    const w = worldEl(); if (!w) return;

    // --- drag state ---
    let dragging       = false;
    let didMove        = false;   // did we actually translate the card?
    let startSx        = 0;
    let startSy        = 0;
    let startLeft      = 0;
    let startTop       = 0;
    let activePointer  = null;    // "mouse" or touch identifier number
    let streamRAF      = 0;
    let lastSentX      = NaN;
    let lastSentY      = NaN;
    let lastSendTs     = 0;
    const MIN_SEND_MS  = 16;
    const MOVE_TOLERANCE_PX = 4; // below this = tap, above this = real drag

    function streamKick() {
      if (streamRAF) return;
      const loop = (t) => {
        if (!dragging) { streamStop(); return; }

        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top)  || 0;

        // throttle so we don't spam identical coords
        if ((x !== lastSentX || y !== lastSentY) && (t - lastSendTs >= MIN_SEND_MS)) {
          lastSendTs = t;
          lastSentX = x;
          lastSentY = y;
          try {
            // LITE packet during drag (full = false)
            const packet = _buildMovePacketFor(el, x, y, /*full=*/false);
            (window.rtcSend || window.peer?.send)?.(packet);
            if (DBG.on && DBG.stream) {
              // console.log('%c[Place:drag→send move*lite]', 'color:#6cf', packet);
            }
          } catch (e) {
            // swallow to avoid killing the loop
          }
        }

        streamRAF = requestAnimationFrame(loop);
      };
      streamRAF = requestAnimationFrame(loop);
    }


    function streamStop() {
      if (streamRAF) cancelAnimationFrame(streamRAF);
      streamRAF = 0;
      lastSentX = lastSentY = NaN;
    }

    // -------------------------------------------------
    // BEGIN DRAG
    // -------------------------------------------------
    const onDown = (sx, sy, target, pointerId) => {
      // don't start drag if clicking UI overlay elements on the card
      if (target.closest?.('.ui-block')) return false;

      // if we're already dragging with some pointer, ignore extras (2nd finger, etc.)
      if (dragging && activePointer !== null && activePointer !== pointerId) {
        return false;
      }

      dragging      = true;
      didMove       = false;
      activePointer = pointerId; // "mouse" or touch identifier #
      startSx       = sx;
      startSy       = sy;
      startLeft     = parseFloat(el.style.left) || 0;
      startTop      = parseFloat(el.style.top)  || 0;

      document.body.style.cursor = 'grabbing';
      el.classList.add('is-dragging');
      el.classList.remove('remote-smooth');
      localDragLock.add(el.dataset.cid);
      streamKick();

      // ALWAYS POP TOOLTIP IMMEDIATELY WHEN WE TOUCH / CLICK
      try {
        if (window.Tooltip && typeof window.Tooltip.showForCard === 'function') {
          window.Tooltip.showForCard(el, el, { mode: 'bottom' });
        }
      } catch (e) {
        console.warn('[Place:drag] Tooltip.showForCard failed at pointerdown', e);
      }

      // Dock tooltip low-profile DURING drag so it doesn't cover
      try {
        if (window.Tooltip && typeof window.Tooltip.setLowProfile === 'function') {
          window.Tooltip.setLowProfile(true, el);
        }
      } catch (e) {
        console.warn('[Place:drag] failed to enter lowProfile tooltip mode', e);
      }

      //if (DBG.on) {
      //  console.log('%c[Place:drag] down', 'color:#bbb', {
      //    cid: el.dataset.cid,
      //    startLeft,
      //    startTop,
      //    pointerId
      //  });
      //}

      return true;
    };

    // -------------------------------------------------
    // DRAG MOVE
    // -------------------------------------------------
    const onMove = (sx, sy, pointerId, evOptional) => {
      if (!dragging) return;
      if (activePointer !== pointerId) return;

      const { scale } = getCam();
      const dxScreen  = sx - startSx;
      const dyScreen  = sy - startSy;

      // track if we moved far enough to count as a drag
      if (!didMove) {
        const distSq = dxScreen*dxScreen + dyScreen*dyScreen;
        if (distSq > (MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX)) {
          didMove = true;
        }
      }

      // convert to world delta
      const dx = dxScreen / scale;
      const dy = dyScreen / scale;

      el.style.left = (startLeft + dx) + 'px';
      el.style.top  = (startTop  + dy) + 'px';

      // while dragging with touch, block page scroll/zoom
      if (evOptional && evOptional.cancelable) {
        evOptional.preventDefault();
      }
    };

    // -------------------------------------------------
    // DROP / RELEASE
    // -------------------------------------------------
    // popup helper lives OUTSIDE finalizeDrop just like before
    const showDeckInsertOptions = (cardEl, onDone) => {
  // guard: only one at a time
  if (document.getElementById('deckInsertBackdrop')) return;

  // backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'deckInsertBackdrop';
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(2, 6, 23, 0.55)',            // slate-950-ish w/ alpha
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    zIndex: '99998'
  });

  // modal shell
  const modal = document.createElement('div');
  modal.id = 'deckInsertModal';
  Object.assign(modal.style, {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%,-50%)',
    width: 'min(420px, 92vw)',
    borderRadius: '16px',
    background: 'linear-gradient(180deg, rgba(30,41,59,.95), rgba(15,23,42,.95))', // glassy slate
    boxShadow: '0 20px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(148,163,184,.15)',
    color: '#e2e8f0',
    zIndex: '99999',
    padding: '18px'
  });

  // title + hint
  const header = document.createElement('div');
  header.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;">
      <h3 style="margin:0;font-size:16px;font-weight:700;letter-spacing:.2px;">Put card into library</h3>
      <span style="opacity:.75;font-size:12px;">T / B / R • Esc</span>
    </div>
    <p style="margin:0 0 12px;font-size:13px;line-height:1.35;color:#cbd5e1;opacity:.9">
      Choose where to place it. You can shuffle after <em>Random</em>.
    </p>
  `;

  // options grid
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '10px'
  });

  const mkBtn = (label, sub, key, variant = 'primary') => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'deckInsertBtn';
    btn.dataset.choice = label;
    Object.assign(btn.style, {
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '12px 14px',
      borderRadius: '12px',
      border: '1px solid rgba(148,163,184,.18)',
      background: variant === 'ghost'
        ? 'rgba(15,23,42,.6)'
        : 'linear-gradient(180deg, rgba(51,65,85,.9), rgba(30,41,59,.9))',
      color: '#e5e7eb',
      fontWeight: 700,
      fontSize: '14px',
      cursor: 'pointer',
      transition: 'transform .06s ease, background .12s ease, border-color .12s ease'
    });
    btn.onmouseenter = () => {
      btn.style.transform = 'translateY(-1px)';
      btn.style.borderColor = 'rgba(148,163,184,.35)';
    };
    btn.onmouseleave = () => {
      btn.style.transform = 'none';
      btn.style.borderColor = 'rgba(148,163,184,.18)';
    };
    btn.onmousedown = () => (btn.style.transform = 'translateY(0)');
    btn.onmouseup = () => (btn.style.transform = 'translateY(-1px)');

    btn.innerHTML = `
      <span style="display:flex;align-items:center;gap:10px">
        <span>${
          label === 'Top'    ? '⬆️' :
          label === 'Bottom' ? '⬇️' :
          label === 'Random' ? '🔀' : '✖️'
        }</span>
        <span>${label}</span>
        <span style="opacity:.75;font-size:12px;font-weight:600">${sub || ''}</span>
      </span>
      ${key ? `<kbd style="
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size:12px;padding:2px 6px;border-radius:6px;
        background: rgba(2,6,23,.6); border:1px solid rgba(148,163,184,.25);
        color:#cbd5e1; letter-spacing:.3px;">${key}</kbd>` : ''}
    `;
    return btn;
  };

  const btnTop    = mkBtn('Top',    'Place on top of library',     'T');
  const btnBottom = mkBtn('Bottom', 'Place on bottom of library',  'B');
  const btnRandom = mkBtn('Random', 'Insert at random position',   'R');
  const btnCancel = mkBtn('Cancel', 'Close without changes',       'Esc', 'ghost');

  [btnTop, btnBottom, btnRandom, btnCancel].forEach(b => grid.appendChild(b));

  modal.appendChild(header);
  modal.appendChild(grid);

  // attach
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);

  // focus management
  btnTop.focus();

  // close helpers
  const teardown = (why = 'cancel') => {
    try { modal.remove(); } catch {}
    try { backdrop.remove(); } catch {}
    console.log('[Deck] Insert', why === 'cancel' ? 'canceled' : `→ ${why}`);
  };

  const act = async (choice) => {
    if (!choice || choice === 'Cancel') { teardown('cancel'); return; }

    if (choice === 'Random') {
      const ok = confirm('Shuffle after placing randomly?');
      if (ok) console.log('[Deck] Shuffle after random insert (requested)');
    }

    console.log(`[Deck] Insert card to: ${choice}`);
    teardown(choice);
    onDone(choice);
  };

  // events
  backdrop.addEventListener('click', () => teardown('cancel'));
  btnTop.addEventListener('click',    () => act('Top'));
  btnBottom.addEventListener('click', () => act('Bottom'));
  btnRandom.addEventListener('click', () => act('Random'));
  btnCancel.addEventListener('click', () => teardown('cancel'));

  // keyboard shortcuts
  const onKey = (e) => {
    if (!document.body.contains(modal)) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.preventDefault(); teardown('cancel'); return; }
    if (k === 't') { e.preventDefault(); act('Top'); return; }
    if (k === 'b') { e.preventDefault(); act('Bottom'); return; }
    if (k === 'r') { e.preventDefault(); act('Random'); return; }
  };
  window.addEventListener('keydown', onKey, { passive: true });
};


    const finalizeDrop = () => {
      // same body you already had in onUp(), but we'll conditionally skip
      // zone moves / ownership spam if this was just a tap (didMove === false)

      // turn off visual drag state
      document.body.style.cursor = '';
      el.classList.remove('is-dragging');
      streamStop();

      // If it was a drag (we actually moved):
      if (didMove) {
        // leave low-profile mode now that we've dropped
        try {
          if (window.Tooltip && typeof window.Tooltip.setLowProfile === 'function') {
            window.Tooltip.setLowProfile(false, el);
          }
        } catch (e) {
          console.warn('[Place:drag] failed to exit lowProfile tooltip mode', e);
        }

        // final XY where it landed
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top)  || 0;

        // 1) Recompute control/side now that it's dropped
        const ownershipSnapshot = _applyOwnershipAfterDrop(el);
        // 1.5) Commander zone snap
        const wasInCommander = _markCommanderZoneStatus(el);
        if (wasInCommander) {
          _snapToCommanderZone(el);
          _markCommanderZoneStatus(el);
        }

        // 2) Broadcast final MOVE
        try {
          const mc = _calcManaColorPayload(el);
         //console.log(
         //  '%c[COLOR FINAL MOVE]', 'color:#ff0;font-weight:bold',
         //  {
         //    cid: el.dataset.cid,
         //    sendingColors: mc.colors,
         //    manaCostRaw: mc.manaCostRaw
         //  }
         //);

          // full=true so we include control, zones, sickness, mana/colors etc.
          const packetMove = _buildMovePacketFor(el, x, y, /*full=*/true);

          // make sure ownership/side reflect where it actually landed
          packetMove.ownerOriginal = ownershipSnapshot?.ownerOriginal
                                   || el.dataset.ownerOriginal
                                   || packetMove.ownerOriginal
                                   || null;

          packetMove.ownerCurrent  = ownershipSnapshot?.ownerCurrent
                                   || el.dataset.ownerCurrent
                                   || packetMove.ownerCurrent
                                   || null;

          packetMove.fieldSide     = ownershipSnapshot?.fieldSide
                                   || el.dataset.fieldSide
                                   || packetMove.fieldSide
                                   || null;

          packetMove.inCommandZone = el.dataset.inCommandZone
                                   || packetMove.inCommandZone
                                   || null;

          (window.rtcSend || window.peer?.send)?.(packetMove);

          //if (DBG.on) {
          //  console.log('%c[Place:drag→send final move]', 'color:#6cf', packetMove);
          //}
        } catch (e) {
          console.warn('[Place:onUp] final move send failed', e);
        }

        // 3) ALSO broadcast owner control swap info
        try {
          const mc2 = _calcManaColorPayload(el);
          const packetSwap = {
  type          : 'owner-swap',
  cid           : el.dataset.cid,

  // NEW: who sent this
  senderSeat    : String(mySeat()) || '1',

  ownerOriginal : ownershipSnapshot?.ownerOriginal || el.dataset.ownerOriginal || null,
  ownerCurrent  : ownershipSnapshot?.ownerCurrent  || el.dataset.ownerCurrent  || null,
  fieldSide     : ownershipSnapshot?.fieldSide     || el.dataset.fieldSide     || null,
  inCommandZone : el.dataset.inCommandZone         || null,
  manaCostRaw   : mc2.manaCostRaw,
  colors        : mc2.colors
};

          (window.rtcSend || window.peer?.send)?.(packetSwap);
          //if (DBG.on) {
          //  console.log('%c[Place:drag→send owner-swap]', 'color:#fc6', packetSwap);
          //}
        } catch (e) {
          console.warn('[Place:onUp] owner-swap send failed', e);
        }

        // 🔍 ZONE DROP CHECK (grave/exile/deck/hand)
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width/2;
        const cy = rect.top  + rect.height/2;

        const isOver = id => {
          const zone = document.getElementById(id);
          if (!zone) return false;
          const r = zone.getBoundingClientRect();
          return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
        };

        const removeCard = (finalZone = null, finalOwner = 'player') => {
  // finalZone: 'graveyard' | 'exile' | 'deck' | null
  // finalOwner: 'player' | 'opponent'
  const cidVal = el.dataset.cid;
  // console.warn('[REMOVE] cleanup', { cidVal, finalZone, finalOwner });

  // If we're explicitly sending this to a zone (grave/exile/etc),
  // update ownership snapshot on the element first so the state we
  // broadcast + record matches reality.
  if (finalOwner === 'player') {
    el.dataset.ownerCurrent = String(mySeat());
    el.dataset.owner        = String(mySeat());
  } else if (finalOwner === 'opponent') {
    const otherSeat = _otherSeatNum(mySeat());
    el.dataset.ownerCurrent = String(otherSeat);
    el.dataset.owner        = String(otherSeat);
  }

  // Record to the correct zone list
  try {
    if (
      (finalZone === 'graveyard' || finalZone === 'exile') &&
      (finalOwner === 'player' || finalOwner === 'opponent')
    ) {
      Zones?.recordCardToZone?.(finalOwner, finalZone, el);

      // console.log('[REMOVE] Zones.recordCardToZone stored', {
      //   ownerSide: finalOwner,
      //   zone: finalZone,
      //   cid: cidVal,
      //   name: el.dataset.name || el.title || '',
      //   img: el.currentSrc || el.src || '',
      //   typeLine: el.dataset.typeLine || ''
      // });
    }
  } catch (err) {
    console.warn('[REMOVE] recordCardToZone failed', err);
  }

  // Kill tooltip
  try {
    window.Tooltip?.hide?.();
  } catch (e) {
    console.warn('[REMOVE] Tooltip cleanup error:', e);
  }

  // Detach badges/overlays so we don't leak DOM junk
  try {
    if (window.Badges?.detach) {
      window.Badges.detach(el);
    } else {
      // console.warn('[REMOVE] Badges.detach not available');
    }
  } catch (e) {
    console.warn('[REMOVE] Badges cleanup error:', e);
  }

  // Physically remove card from table
  try { el.remove(); } catch {}
  state.byCid.delete(cidVal);

  // Broadcast remove so opponent mirrors it.
  // IMPORTANT: include both zone and who got it.
  try {
    const packetRemove = {
      type: 'remove',
      cid: cidVal,
      zone: finalZone || '',
      ownerSide: finalOwner // <-- tells remote whose pile it went to
    };
    (window.rtcSend || window.peer?.send)?.(packetRemove);
    // if (DBG.on) console.log('[Place:remove→send]', packetRemove);
  } catch (e) {
    console.warn('[REMOVE] RTC send failed:', e);
  }
};


        // ---- DROP DEST DESTINATION LOGIC ----
        // ---- DROP DEST DESTINATION LOGIC ----
        // Recheck card center after drop
        const rect2 = el.getBoundingClientRect();
        const cx2 = rect2.left + rect2.width / 2;
        const cy2 = rect2.top  + rect2.height / 2;

        // helper: generic center-point test (kept for most zones)
const overZoneCenter = (zoneId) => {
  const z = document.getElementById(zoneId);
  if (!z) return false;
  const zr = z.getBoundingClientRect();
  return (
    cx2 >= zr.left &&
    cx2 <= zr.right &&
    cy2 >= zr.top &&
    cy2 <= zr.bottom
  );
};

// helper: rectangle intersection test between the card and a zone
// tol expands the zone upward a bit (so near-edge drops still count)
const overZoneByIntersect = (zoneId, tol = 0) => {
  const z = document.getElementById(zoneId);
  if (!z) return false;

  const zr = z.getBoundingClientRect();
  const cr = el.getBoundingClientRect();

  // expand zone upward by tol to make catching easier at top edge
  const zl = zr.left;
  const zrgt = zr.right;
  const zt = zr.top - tol;
  const zb = zr.bottom;

  const cl = cr.left;
  const crgt = cr.right;
  const ct = cr.top;
  const cb = cr.bottom;

  const horiz = (cl < zrgt) && (crgt > zl);
  const vert  = (ct < zb)   && (cb > zt);
  return horiz && vert;
};


        // Before any zone action, if spawn is still pending and we're NOT in hand, finalize it.
if (el.dataset.pendingSpawn === 'true' && !overZoneByIntersect('handZone', 12)) {
  try { el._finalizeSpawn?.(); } catch {}
}


// 1. Hand (goes back to MY hand, not anyone's grave/exile)
// Use rectangle intersection for Hand so drops near the top edge still count.
if (overZoneByIntersect('handZone', /*tol=*/12)) {
  if (el.dataset.pendingSpawn === 'true') {
    // CANCEL the spawn entirely: do NOT broadcast spawn or send a remove.
    // Just clean up the temp table element and animate back to hand.
    try { window.Tooltip?.hide?.(); } catch {}
    try {
      window.flyDrawToHand?.(
        { name: el.title || '', imageUrl: el.currentSrc || el.src },
        null
      );
    } catch {}
    try { el.remove(); } catch {}
    try { state.byCid.delete(el.dataset.cid); } catch {}
    el.dataset.pendingSpawn = 'false'; // consumed
    return; // short-circuit: nothing else to do
  } else {
    // Normal path (card had already been spawned): send a remove packet like before.
    try {
      window.flyDrawToHand?.(
        { name: el.title || '', imageUrl: el.currentSrc || el.src },
        null
      );
    } catch {}
    removeCard(null, 'player'); // no zone tag but conceptually "back to me"
  }
}



        // 2. MY graveyard / exile
        else if (overZoneCenter('pl-graveyard')) {
  removeCard('graveyard', 'player');
  try { window.TurnUpkeep?.noteGrave?.(); } catch {}
}


else if (overZoneCenter('pl-exile')) {
  removeCard('exile', 'player');
  try { window.TurnUpkeep?.noteExile?.(); } catch {}
}



        // 3. OPPONENT graveyard / exile
        //    NOTE: zones.js builds ids "op-graveyard" / "op-exile"
        //    (NOT "opp-...")
        else if (overZoneCenter('op-graveyard')) {
  removeCard('graveyard', 'opponent');
  try { window.TurnUpkeep?.noteGrave?.(); } catch {}
}


        else if (overZoneCenter('op-exile')) {
  removeCard('exile', 'opponent');
  try { window.TurnUpkeep?.noteExile?.(); } catch {}
}



        // 4. MY deck (top/bottom/random popup then remove from table)
else if (overZoneCenter('pl-deck')) {
  showDeckInsertOptions(el, (choice) => {
    const pos = String(choice || 'top').toLowerCase(); // 'top' | 'bottom' | 'random'
    let ok = false;
    try {
      if (typeof DeckLoading?.insertFromTable === 'function') {
  ok = !!DeckLoading.insertFromTable(el, pos);
} else {
  console.warn('[Deck] DeckLoading.insertFromTable not found (module import missing?)');
}

if (pos === 'random' && typeof DeckLoading?.shuffleLibrary === 'function') {
        // only shuffle if user confirmed in the popup; log already printed there
        // window.DeckLoading.shuffleLibrary();
      }
    } catch (e) {
      console.warn('[Deck] insertFromTable threw:', e);
    }

    if (!ok) {
      console.warn('[Deck] insertFromTable failed — removing from table anyway');
    }
    removeCard('deck', 'player'); // keep visual state in sync
  });
}

        // (future: if you want to let me tuck into opponent's deck, mirror this with 'op-deck')

      } else {
        // TAP ONLY (no movement)
        // We ALREADY showed tooltip.onDown and set lowProfile(true).
        // For a tap we actually want to UN-dock it so you can read it.
        try {
          if (window.Tooltip && typeof window.Tooltip.setLowProfile === 'function') {
            window.Tooltip.setLowProfile(false, el);
          }
        } catch (e) {
          console.warn('[Place:tap] failed to exit lowProfile tooltip mode', e);
        }
        // We intentionally do NOT do owner-swap / zone-drop / move broadcast on pure tap.
      }

      // unlock so remote can move it again
      localDragLock.delete(el.dataset.cid);
    };

    const onUp = (pointerId) => {
      if (!dragging) return;
      if (activePointer !== pointerId) return;

      dragging = false;

      // cleanup state
      finalizeDrop();

      // reset pointer tracking
      activePointer = null;
    };

    // -------------------------------------------------
    // POINTER BINDINGS
    // -------------------------------------------------

    // MOUSE
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (!onDown(e.clientX, e.clientY, e.target, 'mouse')) return;
      e.preventDefault();

      const mm = (ev) => {
        // mousemove can feed into onMove(), which may call preventDefault
        // so this MUST be from a non-passive listener.
        onMove(ev.clientX, ev.clientY, 'mouse', ev);
      };
      const mu = (ev) => {
        // remove with the same passive:false we used when adding
        window.removeEventListener('mousemove', mm, { passive: false });
        window.removeEventListener('mouseup',   mu);
        onUp('mouse');
      };

      // IMPORTANT: passive:false so preventDefault() is allowed without console error
      window.addEventListener('mousemove', mm, { passive: false });
      window.addEventListener('mouseup',   mu);
    });


    // TOUCH
    el.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length === 0) return;

      // we only ever track the first touch in the list for this drag
      const t = e.touches[0];
      const pid = t.identifier;

      if (!onDown(t.clientX, t.clientY, e.target, pid)) return;

      // IMPORTANT: block browser starting scroll right away
      e.preventDefault();
    }, { passive: false });

    const touchMoveHandler = (e) => {
      if (!dragging) return;
      if (!e.touches || e.touches.length === 0) return;

      // find the touch with activePointer id
      let t = null;
      for (let i=0; i<e.touches.length; i++) {
        if (e.touches[i].identifier === activePointer) {
          t = e.touches[i];
          break;
        }
      }
      if (!t) return; // pointer that ended already but we didn't see touchend yet

      onMove(t.clientX, t.clientY, activePointer, e);
      // we already preventDefault() in onMove, but just in case:
      if (e.cancelable) e.preventDefault();
    };

    const touchEndHandler = (e) => {
      // Did our tracked finger lift?
      let stillDown = false;
      if (e.touches && e.touches.length > 0) {
        for (let i=0; i<e.touches.length; i++) {
          if (e.touches[i].identifier === activePointer) {
            stillDown = true;
            break;
          }
        }
      }
      if (stillDown) return;

      onUp(activePointer);
    };

    // We attach these to window so you can drag off the card
    window.addEventListener('touchmove',   touchMoveHandler, { passive: false });
    window.addEventListener('touchend',    touchEndHandler,  { passive: false });
    window.addEventListener('touchcancel', touchEndHandler,  { passive: false });
  }






  // ---------- Public: general local spawn ----------
  function spawnCardLocal({ name, img, x, y, meta }) {
  const w = worldEl();
  if (!w) { console.warn('[Place:spawnLocal] missing #world'); return null; }

  const id = cid();

  // PASS META INTO makeCardEl so dataset gets baseAbilities/baseTypes/etc.
  const el = makeCardEl(id, name, img, meta || null);

  // 🔴 OWNER STAMP (local)
  try { el.dataset.owner = String(mySeat()); } catch {}

  if (typeof x === 'number' && typeof y === 'number') {
    placeTopLeft(el, x, y);
  } else {
    const rect = w.getBoundingClientRect();
    const mid = screenToWorld(rect.left + rect.width/2, rect.top + rect.height/2);
    placeAtWorldCenter(el, mid.wx, mid.wy);
  }

  enableDrag(el);
  state.byCid.set(id, { el });

  // Broadcast 'spawn'
  try {
    const ownerNow = el.dataset.ownerCurrent || el.dataset.owner || String(mySeat());
    const px = parseFloat(el.style.left) || 0;
    const py = parseFloat(el.style.top)  || 0;

    const sendSpawnLocal = () => {
  const mc = _calcManaColorPayload(el);
  const snap = _snapshotRules(el);

  const pkt = {
    senderSeat       : String(mySeat()) || '1',
    type          : 'spawn',
    cid           : id,
    name,
    img,
    x             : px,
    y             : py,
    owner         : ownerNow,
    ownerOriginal : el.dataset.ownerOriginal || null,
    ownerCurrent  : el.dataset.ownerCurrent  || ownerNow || null,
    fieldSide     : el.dataset.fieldSide     || null,
    inCommandZone : el.dataset.inCommandZone || null,

    manaCostRaw   : mc.manaCostRaw,
    colors        : mc.colors,

    // rules snapshot
    typeLine      : snap.typeLine || null,
    oracle        : snap.oracle   || null,
    baseAbilities : snap.baseAbilities || [],
    baseTypes     : snap.baseTypes     || []
  };

  console.log('%c[RTC:spawnLocal SEND]', 'color:#0cf;font-weight:bold',
    { cid:id, name, baseAbilities:pkt.baseAbilities, baseTypes:pkt.baseTypes, typeLine:pkt.typeLine });

  (window.rtcSend || window.peer?.send)?.(pkt);
};

// If you want symmetry with pointer path, delay a frame; otherwise call immediately.
requestAnimationFrame(sendSpawnLocal);

    //if (DBG.on) console.log('%c[Place:spawn→send]', 'color:#6cf', pkt);
  } catch (e) { /* ignore */ }

  return id;
}



  // ---------- Public: local spawn in Commander zone ----------
function spawnCommanderLocal({ name, img, commanderMeta }) {
  const w = worldEl();
  const myCmd = document.getElementById('pl-commander');
  if (!w || !myCmd) { console.warn('[Place:spawnCommanderLocal] missing world or pl-commander'); return null; }

  const id = cid();

  // ⬇⬇ pass commanderMeta into makeCardEl so we seed dataset up front
  const el = makeCardEl(id, name, img, commanderMeta || null);

  // 🔴 OWNER STAMP (local)
  try {
    const mine = String(mySeat());

    el.dataset.owner = mine;

    if (!el.dataset.ownerOriginal) {
      el.dataset.ownerOriginal = mine;
    }
    if (!el.dataset.ownerCurrent) {
      el.dataset.ownerCurrent = mine;
    }

    el.dataset.inCommandZone = 'true';
    el.dataset.fieldSide     = 'bottom';

    // Commander should NOT start summoning sick on board-in-commander-zone by default,
    // but if you want him sick until first move to battlefield you can flip this to 'true'.
    el.dataset.hasSummoningSickness = 'false';
  } catch {}

  // 🔵 EXTRA: if commanderMeta didn't have power/toughness stitched in,
  // we still try to form ptCurrent like spawnCardAtPointer does.
  try {
    if (commanderMeta) {
      if (commanderMeta.power != null && commanderMeta.power !== '') {
        el.dataset.power = String(commanderMeta.power);
      }
      if (commanderMeta.toughness != null && commanderMeta.toughness !== '') {
        el.dataset.toughness = String(commanderMeta.toughness);
      }
      if (
        commanderMeta.power != null && commanderMeta.power !== '' &&
        commanderMeta.toughness != null && commanderMeta.toughness !== ''
      ) {
        el.dataset.ptCurrent = `${commanderMeta.power}/${commanderMeta.toughness}`;
      }

      // Also mirror the stuff spawnCardAtPointer stamps:
      if (Array.isArray(commanderMeta.baseAbilities)) {
        el.dataset.baseAbilities = JSON.stringify(commanderMeta.baseAbilities);
      }
      if (Array.isArray(commanderMeta.baseTypes)) {
        el.dataset.baseTypes = JSON.stringify(commanderMeta.baseTypes);
      }
      if (typeof commanderMeta.untapsDuringUntapStep !== 'undefined') {
        el.dataset.untapsDuringUntapStep = commanderMeta.untapsDuringUntapStep ? 'true' : 'false';
      }
      if (commanderMeta.typeLine) {
        el.dataset.typeLine = commanderMeta.typeLine;
      }
      if (commanderMeta.oracle) {
        el.dataset.oracle = commanderMeta.oracle;
      }
    }
  } catch (e) {
    console.warn('[Place:spawnCommanderLocal] failed to stamp commanderMeta extras', e);
  }

  // Physically place it in the center of the commander zone.
  const c = worldCenterOf(myCmd);
  placeAtWorldCenter(el, c.wx, c.wy);

  // Register and make it draggable
  enableDrag(el);
  state.byCid.set(id, { el });

  // 🔵 Attach badges NOW that dataset has baseAbilities/baseTypes/PT
  try {
    if (window.Badges && typeof window.Badges.attach === 'function') {
      window.Badges.attach(el);
    }
  } catch (e) {
    console.warn('[Place:spawnCommanderLocal] Badges.attach failed', e);
  }

  // 🔵 Hydrate tooltip before send so manaCost/typeLine/etc. get stamped, same as before
  try {
    if (window.Tooltip && typeof window.Tooltip.showForCard === 'function') {
      window.Tooltip.showForCard(el, el, { mode:'bottom' });

      if (typeof window.Tooltip.setLowProfile === 'function') {
        window.Tooltip.setLowProfile(true, el);
      }
    }
  } catch (e) {
    console.warn('[Place:spawnCommanderLocal] Tooltip hydration failed', e);
  }

  // Send commander spawn after 1 frame with full rules snapshot so remote has abilities/types
  try {
    requestAnimationFrame(() => {
      const ownerNow = el.dataset.ownerCurrent || el.dataset.owner || String(mySeat());
      const x = parseFloat(el.style.left) || 0;
      const y = parseFloat(el.style.top)  || 0;

      const mc   = _calcManaColorPayload(el);
      const snap = _snapshotRules(el);

      const pkt = {
        senderSeat       : String(mySeat()) || '1',

        type                 : 'spawn',
        cid                  : id,
        name,
        img,
        x,
        y,
        owner                : ownerNow,
        zone                 : 'commander',
        ownerOriginal        : el.dataset.ownerOriginal || null,
        ownerCurrent         : el.dataset.ownerCurrent  || ownerNow || null,
        fieldSide            : el.dataset.fieldSide     || null,
        inCommandZone        : el.dataset.inCommandZone || null,
        hasSummoningSickness : (el.dataset.hasSummoningSickness === 'true') ? 'true' : 'false',

        manaCostRaw          : mc.manaCostRaw,
        colors               : mc.colors,

        // 🔵 include rules so remote can badge immediately
        typeLine             : snap.typeLine || null,
        oracle               : snap.oracle   || null,
        baseAbilities        : snap.baseAbilities || [],
        baseTypes            : snap.baseTypes     || []
      };

      console.log('%c[RTC:spawnCommander SEND]', 'color:#0cf;font-weight:bold',
        { cid:id, name, baseAbilities:pkt.baseAbilities, baseTypes:pkt.baseTypes, typeLine:pkt.typeLine });

      (window.rtcSend || window.peer?.send)?.(pkt);
    });
  } catch (e) { /* ignore */ }

  return id;
}






  // ---------- Public: apply remote spawn (mirror Y if from other seat) ----------
function applyRemoteSpawn(msg) {
  const w = worldEl(); if (!w) return;

  // who am I
  const mineSeat   = Number((typeof window.mySeat === 'function') ? window.mySeat() : 1);

  // who SENT this packet (new), fall back to msg.owner for old packets
  const senderSeat = Number(
    msg.senderSeat != null
      ? msg.senderSeat
      : msg.owner
  );

  // did someone ELSE send this?
  const fromOther  = senderSeat !== mineSeat;

  // ⛔ echo guard: if I'M the sender, ignore
  if (!fromOther) {
    return;
  }

  // who CONTROLS the permanent
  const ownerSeat  = Number(msg.owner);
  const isTheirs   = (ownerSeat !== mineSeat);

  // Parse incoming top-left (world px)
  const inX = Number.isFinite(+msg.x) ? +msg.x : 0;
  const inY = Number.isFinite(+msg.y) ? +msg.y : 0;

  const cardH = CSS_CARD_H();
  const FORCE_MIRROR_TEST = false;

// Decide Y (mirror or pass-through) — mirror if packet came from the other seat
const willMirror = FORCE_MIRROR_TEST ? true : fromOther;
const outY = willMirror ? mirrorTopY(inY, cardH) : inY;

  // Build/update element
  let el = document.querySelector(`img.table-card[data-cid="${msg.cid}"]`);
  if (!el) {
    el = makeCardEl(msg.cid, msg.name, msg.img);
    w.appendChild(el);
    enableDrag(el);
  } else {
    if (msg.img)  el.src = msg.img;
    if (msg.name) { el.title = msg.name; el.dataset.name = msg.name; }
  }

  el.classList.add('remote-smooth');
  el.style.left = `${inX}px`;
  el.style.top  = `${outY}px`;

  // sync datasets (ownerCurrent, manaCostRaw, etc.) ... [rest of the body you already have stays the same]
  // ...


// 🔵 NEW: hydrate ownership / command zone / mana / colors / sickness coming from sender
if (msg.ownerOriginal != null) {
  el.dataset.ownerOriginal = String(msg.ownerOriginal);
}
if (msg.ownerCurrent != null) {
  el.dataset.ownerCurrent  = String(msg.ownerCurrent);
  el.dataset.owner         = String(msg.ownerCurrent); // legacy sync
} else if (msg.owner != null) {
  el.dataset.owner         = String(msg.owner);
  if (!el.dataset.ownerCurrent) {
    el.dataset.ownerCurrent = String(msg.owner);
  }
}
if (msg.fieldSide != null) {
  el.dataset.fieldSide = msg.fieldSide;
}
if (msg.inCommandZone != null) {
  el.dataset.inCommandZone = (msg.inCommandZone === 'true' || msg.inCommandZone === true)
    ? 'true'
    : 'false';
}

// ⬇⬇ NEW PART: summoning sickness sync
if (msg.hasSummoningSickness != null) {
  el.dataset.hasSummoningSickness =
    (msg.hasSummoningSickness === 'true' || msg.hasSummoningSickness === true)
      ? 'true'
      : 'false';
}

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

// 🔵 NEW: rules/identity hydration
if (msg.typeLine)  el.dataset.typeLine = String(msg.typeLine);
if (msg.oracle)    el.dataset.oracle   = String(msg.oracle);

if (Array.isArray(msg.baseAbilities)) {
  try { el.dataset.baseAbilities = JSON.stringify(msg.baseAbilities); } catch {}
} else if (el.dataset.oracle && !el.dataset.baseAbilities) {
  // Fallback compute when sender omitted; matches tooltip pipeline
  const computed = extractInnateAbilities(el.dataset.oracle);
  try { el.dataset.baseAbilities = JSON.stringify(computed); } catch {}
}

if (Array.isArray(msg.baseTypes)) {
  try { el.dataset.baseTypes = JSON.stringify(msg.baseTypes); } catch {}
} else if (el.dataset.typeLine && !el.dataset.baseTypes) {
  const derived = _deriveBaseTypesFromTypeLine(el.dataset.typeLine);
  try { el.dataset.baseTypes = JSON.stringify(derived); } catch {}
}

// --- Cast mirror: if they spawned from hand, tally their cast on my side too
try {
  const cameFromHand = String(msg.origin || '') === 'hand';
  if (cameFromHand) {
    if (msg.typeLine) el.dataset.typeLine = msg.typeLine;

  // Mark estimated-cast for this turn on the receiver, too
  try{
    const tnow = window.TurnUpkeep?.state?.().turn;
    if (tnow != null) el.dataset.playTurn = String(tnow);
  }catch{}
  const seatOfCaster = Number(msg.senderSeat != null ? msg.senderSeat : msg.owner) || 1;
  _emitCastFor(el, seatOfCaster);
}

} catch {}


//console.log('[Spawn:APPLY]', {
//  cid: msg.cid,
//  applied: { left: el.style.left, top: el.style.top },
//  ownerOriginal        : el.dataset.ownerOriginal,
//  ownerCurrent         : el.dataset.ownerCurrent,
//  fieldSide            : el.dataset.fieldSide,
//  inCommandZone        : el.dataset.inCommandZone,
//  hasSummoningSickness : el.dataset.hasSummoningSickness,
//  manaCostRaw          : el.dataset.manaCost,
//  colors               : el.dataset.colors
//});

state.byCid.set(msg.cid, { el });
console.log('%c[RTC:spawn APPLY]', 'color:#8f8',
  { cid: msg.cid, baseAbilities: el.dataset.baseAbilities, baseTypes: el.dataset.baseTypes, typeLine: el.dataset.typeLine, oracle: el.dataset.oracle });

}



  // ---------- Public: apply remote move (mirror Y if from other seat) ----------
function applyRemoteMove(msg) {
  const el = document.querySelector(`img.table-card[data-cid="${msg.cid}"]`);
  if (!el) return;

  // --- identify seats -------------------------------------------------
  const mySeatNum = Number(
    (typeof window.mySeat === 'function')
      ? window.mySeat()
      : 1
  );

  // who SENT this packet
  const senderSeatNum = Number(
    msg.senderSeat != null
      ? msg.senderSeat
      : (msg.owner != null ? msg.owner : mySeatNum) // fallback for legacy/no-senderSeat packets
  );

  const iSentThis = (senderSeatNum === mySeatNum);

  // --- ignore rules ---------------------------------------------------
  // 1. if I'm actively dragging this cid locally, don't let remote snap it
  if (localDragLock.has(msg.cid)) {
    return;
  }

  // 2. if I was the sender, it's just my echo, ignore
  if (iSentThis) {
    return;
  }

// --- sender vs me (for mirror math) ---------------------------------
const fromOther = (senderSeatNum !== mySeatNum);

  // --- OWNERSHIP / STATE SYNC ----------------------------------------
  if (msg.ownerOriginal != null) {
    el.dataset.ownerOriginal = String(msg.ownerOriginal);
  }
  if (msg.ownerCurrent != null) {
    el.dataset.ownerCurrent = String(msg.ownerCurrent);
    el.dataset.owner        = String(msg.ownerCurrent); // legacy sync
  } else if (msg.owner != null) {
    el.dataset.owner        = String(msg.owner);
    if (!el.dataset.ownerCurrent) {
      el.dataset.ownerCurrent = String(msg.owner);
    }
  }

  if (msg.fieldSide != null) {
    el.dataset.fieldSide = msg.fieldSide; // "top" / "bottom"
  }

  if (msg.inCommandZone != null) {
    el.dataset.inCommandZone = (
      msg.inCommandZone === 'true' ||
      msg.inCommandZone === true
    ) ? 'true' : 'false';
  }

  if (msg.hasSummoningSickness != null) {
    el.dataset.hasSummoningSickness = (
      msg.hasSummoningSickness === 'true' ||
      msg.hasSummoningSickness === true
    ) ? 'true' : 'false';
  }

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

  // --- POSITION / MIRROR MATH ----------------------------------------
  const inX = Number.isFinite(+msg.x) ? +msg.x : 0;
  const inY = Number.isFinite(+msg.y) ? +msg.y : 0;
  const cardH = CSS_CARD_H();
  const FORCE_MIRROR_TEST = false;

  // don't mirror blockers mid-block so combat lines don't flip under you
  const isBlockerContext = el.classList.contains('battle-blocker');

const willMirror = FORCE_MIRROR_TEST
  ? true
  : (fromOther && !isBlockerContext);
  
  const outY = willMirror ? mirrorTopY(inY, cardH) : inY;

  // --- apply position -------------------------------------------------
  el.classList.add('remote-smooth');
  el.style.left = `${inX}px`;
  el.style.top  = `${outY}px`;
}







  // -------------------------------------------------
// INTERNAL: force remove a card to graveyard (player or opponent)
// Mirrors finalizeDrop() → removeCard('graveyard', ownerSide)
// so it behaves exactly like you dragged the card onto the
// correct graveyard zone.
//
// Usage:
//   forceSendToGraveyard(el)                      // → my graveyard (default)
//   forceSendToGraveyard(el, 'opponent')          // → opponent graveyard
//
// Notes:
// - Stamps ownerCurrent to the target seat before recording
// - Records to Zones with ('player'|'opponent', 'graveyard')
// - Detaches UI, removes DOM, and broadcasts { type:'remove', zone:'graveyard', ownerSide }
function forceSendToGraveyard(el, ownerSide = 'player'){
  if (!el) return;
  const cidVal = el.dataset?.cid;

  // Only operate on real table cards
  if (!cidVal || !el.classList.contains('table-card')) return;

  // --- stamp ownership like removeCard() does before recording ------------
  try {
    const my = (typeof mySeat === 'function') ? Number(mySeat()) : 1;
    const other = (typeof _otherSeatNum === 'function') ? _otherSeatNum(my) : (my === 1 ? 2 : 1);

    if (ownerSide === 'player') {
      el.dataset.ownerCurrent = String(my);
      el.dataset.owner        = String(my);
    } else if (ownerSide === 'opponent') {
      el.dataset.ownerCurrent = String(other);
      el.dataset.owner        = String(other);
    }
  } catch (e) {
    console.warn('[AUTO-GRAVE] ownership stamp failed', e);
  }

  // --- record to zone model ------------------------------------------------
  try {
    Zones?.recordCardToZone?.(ownerSide, 'graveyard', el);
    // console.log('[AUTO-GRAVE] Zones.recordCardToZone stored', {
    //   ownerSide, zone: 'graveyard', cid: cidVal,
    //   name: el.dataset.name || el.title || '',
    //   img: el.currentSrc || el.src || '',
    //   typeLine: el.dataset.typeLine || ''
    // });
  } catch (err) {
    console.warn('[AUTO-GRAVE] recordCardToZone failed', err);
  }

  // --- hide tooltip --------------------------------------------------------
  try { window.Tooltip?.hide?.(); } catch (e) {
    console.warn('[AUTO-GRAVE] Tooltip cleanup error:', e);
  }

  // --- detach badges/overlays ---------------------------------------------
  try {
    if (window.Badges?.detach) {
      window.Badges.detach(el);
    }
  } catch (e) {
    console.warn('[AUTO-GRAVE] Badges cleanup error:', e);
  }

  // --- remove DOM + local index -------------------------------------------
  try { el.remove(); } catch {}
  try { state.byCid.delete(cidVal); } catch {}

  // --- broadcast remove with ownerSide (matches finalizeDrop/removeCard) ---
  try {
    const packetRemove = {
      type: 'remove',
      cid: cidVal,
      zone: 'graveyard',
      ownerSide: ownerSide // 'player' | 'opponent'
    };
    (window.rtcSend || window.peer?.send)?.(packetRemove);
    // if (DBG?.on) console.log('[AUTO-GRAVE] remove→send', packetRemove);
  } catch (e) {
    console.warn('[AUTO-GRAVE] RTC send failed:', e);
  }
}


  // ---------- export ----------
  const api = {
    spawnCommanderLocal,
    spawnCardLocal,
    spawnCardAtPointer,
    applyRemoteSpawn,
    applyRemoteMove,

    // NEW: call this when opponent ends their turn and it's now my turn.
    clearSummoningSicknessForMyBoard,

    // NEW: let combat resolver clean up deaths after combat
    sendToGraveyardLocal: forceSendToGraveyard,
    evaluateDropZones 
  };

  window.CardPlacement = api;
  return api;
})();

