// modules/tooltip.js
// Click-only tooltip (drag-safe) with flip support + RTC send.
// Uses lazy Scryfall fetch + cache by name. No global pointerdown hooks.

import { manaCostHtml } from './mana.master.js';

const Cache = new Map(); // key: "<nameLower>|<imageUrlLower>" or "<nameLower>"


// --- tiny util ---
function getLiveUISettings(){
  // pull live settings from UserInterface if mounted, else fall back defaults
  const ui = window.UserInterface?._UISettingsLive || {};
  return {
    tooltipFontSize:      ui.tooltipFontSize      ?? 14,
    tooltipMaxWidth:      ui.tooltipMaxWidth      ?? 260,
    tooltipPreviewHeight: ui.tooltipPreviewHeight ?? 160,
    tooltipButtonSize:    ui.tooltipButtonSize    ?? 24,
    tooltipDockEdge:      ui.tooltipDockEdge      ?? 'right'
  };
}

// Build a stronger cache key so "Dog" with different art doesn't collide.
function _cacheKeyFrom(name, imgUrl){
  const n = String(name || '').toLowerCase();
  const i = String(imgUrl || '').toLowerCase();
  return i ? `${n}|${i}` : n;
}

// Try to extract the Scryfall UUID from a cards.scryfall.io URL.
// Works for .../art_crop/front/..../<uuid>.jpg and other sizes, with or without query.
function _extractScryIdFromImgUrl(url){
  if (!url) return null;
  // match 8-4-4-4-12 hex UUID anywhere in the path
  const m = String(url).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

// Fetch the exact printing by ID. We NEVER override the chosen art (imgHint).
async function _fetchMetaById(id, imgHint){
  const key = _cacheKeyFrom(id, imgHint || '');
  if (Cache.has(key)) return Cache.get(key);
  if (!id) return null;

  try{
    const r = await fetch(`https://api.scryfall.com/cards/${id}`, { cache:'no-store' });
    if (!r.ok) throw new Error('scryfall id fetch error');
    const j = await r.json();

    let faces = [];
    if (Array.isArray(j.card_faces) && j.card_faces.length){
      faces = j.card_faces.map(f => ({
        title: f.name || j.name || '',
        cost:  f.mana_cost || '',
        type:  f.type_line || j.type_line || '',
        oracle:f.oracle_text || '',
        power: f.power ?? '',
        toughness: f.toughness ?? '',
        loyalty: f.loyalty ?? '',
        img:   imgHint || f.image_uris?.normal || ''
      }));
    } else {
      faces = [{
        title: j.name || '',
        cost:  j.mana_cost || '',
        type:  j.type_line || '',
        oracle:j.oracle_text || '',
        power: j.power ?? '',
        toughness: j.toughness ?? '',
        loyalty: j.loyalty ?? '',
        img:   imgHint || j.image_uris?.normal || ''
      }];
    }
    const meta = { faces, hasBack: faces.length > 1 };
    Cache.set(key, meta);
    return meta;
  }catch(e){
    console.warn('[Tooltip] scryfall id fetch failed', id, e);
    const meta = { faces: [{ title:'', cost:'', type:'', oracle:'', power:'', toughness:'', loyalty:'', img: imgHint || '' }], hasBack:false };
    Cache.set(key, meta);
    return meta;
  }
}


// Fallback: fetch by NAME (never override the chosen art; we only fill text fields)
async function _fetchMetaByName(name, imgHint){
  const key = _cacheKeyFrom(name, imgHint);
  if (Cache.has(key)) return Cache.get(key);
  if (!name) return null;

  try{
    const r = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`, { cache:'no-store' });
    if (!r.ok) throw new Error('scryfall error');
    const j = await r.json();

    let faces = [];
    if (Array.isArray(j.card_faces) && j.card_faces.length){
      faces = j.card_faces.map(f => ({
        title: f.name || j.name || name,
        cost:  f.mana_cost || '',
        type:  f.type_line || j.type_line || '',
        oracle:f.oracle_text || '',
        power: f.power ?? '',
        toughness: f.toughness ?? '',
        loyalty: f.loyalty ?? '',
        // IMPORTANT: keep the art the user actually spawned (imgHint) if we have it
        img:   imgHint || f.image_uris?.normal || ''
      }));
    } else {
      faces = [{
        title: j.name || name,
        cost:  j.mana_cost || '',
        type:  j.type_line || '',
        oracle:j.oracle_text || '',
        power: j.power ?? '',
        toughness: j.toughness ?? '',
        loyalty: j.loyalty ?? '',
        img:   imgHint || j.image_uris?.normal || ''
      }];
    }

    const meta = { faces, hasBack: faces.length > 1 };
    Cache.set(key, meta);
    return meta;
  } catch(e){
    console.warn('[Tooltip] scryfall fetch failed', name, e);
    const meta = { faces: [{ title: name, cost:'', type:'', oracle:'', power:'', toughness:'', loyalty:'', img: imgHint || '' }], hasBack:false };
    Cache.set(key, meta);
    return meta;
  }
}

// Primary entry: prefer the <img> we actually spawned (datasets + src) and only fill gaps.
// Primary entry: prefer the <img> we actually spawned (datasets + src) and only fill gaps.
async function fetchMetaForEl(el){
  if (!el) return null;

  const name   = el.dataset?.name || el.title || el.alt || '';
  const imgUrl = el.currentSrc || el.src || el.dataset?.imageUrl || '';
  const key    = _cacheKeyFrom(name || el.dataset?.scryfallId || '', imgUrl);
  if (Cache.has(key)) return Cache.get(key);

  // 0) If the image URL contains a Scryfall ID, fetch that exact printing first.
  const idFromImg = _extractScryIdFromImgUrl(imgUrl);
  if (idFromImg){
    const byId = await _fetchMetaById(idFromImg, imgUrl);
    if (byId && Array.isArray(byId.faces) && byId.faces.length){
      Cache.set(key, byId);
      return byId;
    }
  }

  // 1) If we already have rich datasets on the element, synthesize meta without fetching.
  const ds = el.dataset || {};
  const faceFromDatasets = {
    title:  name,
    cost:   ds.manaCostRaw || ds.manaCost || '',
    type:   ds.typeLine || '',
    oracle: ds.oracle || '',
    power:  ds.power ?? '',
    toughness: ds.toughness ?? '',
    loyalty: ds.loyalty ?? '',
    img:    imgUrl || ''
  };

  const hasEnough =
    (faceFromDatasets.type && faceFromDatasets.oracle) ||
    (faceFromDatasets.cost !== '' || (faceFromDatasets.power !== '' && faceFromDatasets.toughness !== ''));

  if (hasEnough){
    const meta = { faces: [faceFromDatasets], hasBack: !!(ds.hasFlip || ds.faceIndex) };
    Cache.set(key, meta);
    return meta;
  }

  // 2) Otherwise, fall back to NAME (never override the chosen art).
  const fetched = await _fetchMetaByName(name, imgUrl);
  Cache.set(key, fetched);
  return fetched;
}



function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

// ------------------------------------------------------------
// NEW HELPERS FOR BADGES SYNC
// ------------------------------------------------------------

// split a type line like "Legendary Artifact — Vehicle" into tokens
function _deriveBaseTypes(typeLine){
  if (!typeLine) return [];
  return typeLine
    .replace(/—/g,' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// pull evergreen-ish static combat keywords from this face's oracle text.
// We want to match what Badges.render() expects to live in dataset.baseAbilities.
// We'll Title Case them before storing.
function _deriveBaseAbilities(oracleText){
  if (!oracleText) return [];

  const ABILITIES = [
    'flying',
    'first strike',
    'double strike',
    'vigilance',
    'lifelink',
    'deathtouch',
    'trample',
    'haste',
    'reach',
    'defender',
    'hexproof',
    'indestructible',
    'menace',
    'ward',
    'battle cry',
    'exalted'
  ];

  // words that indicate something is being granted / modified,
  // not baked-in. we only apply this AFTER we strip reminder text.
  const VERB_GUARD = /\b(gets?|gains?|has|have|loses?|becomes?|gain|give|grants?)\b/i;

  const out = new Set();

  const lines = oracleText
    .split(/\r?\n+/)
    .map(l => l.trim())
    .filter(Boolean);

  lineLoop:
  for (const line of lines) {
    const lowered = line.toLowerCase();

    // 1. reject "conditional/granted" lead-ins
    if (/^(as long as|whenever|when |at the beginning|if |while |other |each other |creatures? you control |your creatures |tokens you control |all creatures you control )/i.test(line)) {
      continue lineLoop;
    }

    // 2. only consider lines that START with a known ability keyword
    const startsWithKnown = ABILITIES.some(kw => lowered.startsWith(kw));
    if (!startsWithKnown) {
      continue lineLoop;
    }

    // 3. strip reminder text and trailing extra sentences
    let head = line.split('(')[0];
    head = head.split('.')[0];
    head = head.trim();
    if (!head) continue lineLoop;

    // 4. NOW apply the verb guard to the clean header only.
    // this prevents us from throwing out "Lifelink" just because
    // the reminder text said "gain life", and prevents us from
    // throwing out "Battle cry" / "Exalted" for "gets +1/+0"
    // that only lives in parentheses.
    if (VERB_GUARD.test(head)) {
      continue lineLoop;
    }

    // 5. split multi-ability headers like
    // "First strike, lifelink"
    const parts = head
      .split(/[;,]/)
      .map(s => s.trim())
      .filter(Boolean);

    for (let part of parts) {
      const pLow = part.toLowerCase();

      // reject "hexproof from X"
      if (pLow.startsWith('hexproof')) {
        const after = pLow.slice('hexproof'.length).trim(); // "from white"
        if (after.length > 0) {
          continue;
        }
      }

      // Ward {2} -> "Ward"
      if (pLow.startsWith('ward')) {
        out.add('Ward');
        continue;
      }

      // skip "Protection from ..."
      if (/^(protection\s+from\b)/i.test(part)) {
        continue;
      }

      // skip inline conditionals that somehow snuck in
      if (/\bas long as\b|\bif\b|\bwhile\b/i.test(part)) {
        continue;
      }

      // whitelist match at start
      const matchKw = ABILITIES.find(kw => pLow.startsWith(kw));
      if (matchKw) {
        const pretty = matchKw.replace(/\b\w/g, m => m.toUpperCase());
        out.add(pretty);
      }
    }
  }

  return Array.from(out);
}




// helper: turn Scryfall power/toughness text into a usable combat number.
// rules:
// - if it's a plain integer string (like "2", "-1", "13") => use that number
// - anything else ( "*", "1+*", "X", "" ) => default to 1
function safePTNumber(str){
  const raw = String(str ?? '').trim();
  if (raw === '') return null;          // means "this card doesn't even HAVE P/T"
  if (/^-?\d+$/.test(raw)) {            // pure integer, keep it
    return parseInt(raw, 10);
  }
  // not a clean number (like "1+*", "*", "X", etc.) => fallback 1
  return 1;
}

// loyalty is always an integer on planeswalker faces; if missing => null
function safeLoyaltyNumber(str){
  const raw = String(str ?? '').trim();
  if (raw === '') return null;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  return null;
}


// stamp face data (cost/type/oracle/PT/baseAbilities/baseTypes) onto the <img.table-card>
// and then tell Badges to re-render WITHOUT tearing it down.
function _stampFaceOnEl(face, el){
  if (!el || !face) return;

  // update core data the rest of the app relies on
  if (face.title) {
    // keep the original requested name (e.g., "Treasure") so future fetches
    // remain unambiguous; only set it if missing
    if (!el.dataset.name) el.dataset.name = face.title;
    el.title = face.title;
  }

  el.dataset.manaCost     = face.cost || '';
  el.dataset.manaCostRaw  = face.cost || '';
  el.dataset.typeLine     = face.type || '';
  el.dataset.oracle       = face.oracle || '';

  // base types / abilities for the right-side pills
  const baseTypesArr     = _deriveBaseTypes(face.type || '');
  const baseAbilitiesArr = _deriveBaseAbilities(face.oracle || '');
  el.dataset.baseTypes      = JSON.stringify(baseTypesArr);
  el.dataset.baseAbilities  = JSON.stringify(baseAbilitiesArr);

  // --- P/T stamping with fallback ---
  // "printed" stuff from Scryfall:
  const rawP = (face.power ?? '');
  const rawT = (face.toughness ?? '');

  // convert to safe combat numbers
  const safeP = safePTNumber(rawP);
  const safeT = safePTNumber(rawT);

  // If both sides came back null, this isn't a creature (like an Aura etc.)
  // -> wipe any stale P/T from previous face
  if (safeP === null && safeT === null) {
    delete el.dataset.power;
    delete el.dataset.toughness;
    delete el.dataset.ptCurrent;
  } else {
    // We have at least "something" that can behave like a body.
    // If one side is null (super weird), still default it to 1 so combat math won't NaN.
    const finalP = (safeP === null ? 1 : safeP);
    const finalT = (safeT === null ? 1 : safeT);

    el.dataset.power     = String(finalP);
    el.dataset.toughness = String(finalT);
    el.dataset.ptCurrent = `${finalP}/${finalT}`;
  }
  
    // --- Loyalty stamping ---
  // If this face has printed loyalty, seed datasets so badges/overlays can sync.
  const rawLoyal = (face.loyalty ?? '');
  const safeL = safeLoyaltyNumber(rawLoyal);

  if (safeL === null) {
    delete el.dataset.loyalty;
    delete el.dataset.loyaltyCurrent;
  } else {
    el.dataset.loyalty = String(safeL);
    // initialize current to printed if not already being tracked
    if (!el.dataset.loyaltyCurrent) {
      el.dataset.loyaltyCurrent = String(safeL);
    }
  }


  // ask badges to refresh if this is a real table card with cid
  const isRealEl      = el && typeof el === 'object' && el.nodeType === 1;
  const hasClassList  = isRealEl && el.classList && typeof el.classList.contains === 'function';
  const isTableCard   = hasClassList && el.classList.contains('table-card');
  const hasCid        = !!el.dataset?.cid;
  const canBadges     = !!window.Badges;

  if (isRealEl && hasClassList && isTableCard && hasCid && canBadges){
    try {
      if (typeof window.Badges.refreshFor === 'function'){
        window.Badges.refreshFor(el.dataset.cid);
      } else if (typeof window.Badges.render === 'function'){
        window.Badges.render(el);
      }
    } catch(err){
      console.warn('[Tooltip] Badges.refreshFor failed', err);
    }
  }
}

// ------------------------------------------------------------
// MAIN TOOLTIP MODULE
// ------------------------------------------------------------
export const Tooltip = (() => {
  // DOM refs
let root, nameN, costN, typeN, oraN, ogPT, livePT, ogLOY, liveLOY, flipBtn;


  // follow machinery state
  let followAnchorEl = null;
  let followRAF = 0;

  // track which card we're currently showing so we can resume follow after lowProfile=false
  let activeEl = null;

  // low-profile dock flag
  let LOW_PROFILE = false;

  // NEW: battle-mode (forces slim regardless of LOW_PROFILE)
  let BATTLE_MODE = false;
  const _isSlim = () => (BATTLE_MODE || LOW_PROFILE);


  // -----------------------
  // INTERNAL STYLE APPLY
  // -----------------------
  function _applySizingForMode(){
    if (!root) return;
    const {
      tooltipFontSize,
      tooltipMaxWidth,
      tooltipPreviewHeight,
      tooltipButtonSize
    } = getLiveUISettings();

    // base visual tuning (affects both normal + slim)
    root.style.setProperty('--tt-font-size',      tooltipFontSize + 'px');
    root.style.setProperty('--tt-max-width',      tooltipMaxWidth + 'px');
    root.style.setProperty('--tt-preview-h',      tooltipPreviewHeight + 'px');
    root.style.setProperty('--tt-btn-size',       tooltipButtonSize + 'px');

    // mode-specific constraints
    if (LOW_PROFILE){
      // slim dock panel
      root.style.maxWidth   = tooltipMaxWidth + 'px';
      root.style.width      = tooltipMaxWidth + 'px';
      root.style.maxHeight  = '80vh';
      root.style.overflowY  = 'auto';
      root.style.fontSize   = tooltipFontSize + 'px';
    } else {
      // free-floating bubble
      root.style.width      = '';
      root.style.maxWidth   = `min(${tooltipMaxWidth}px, 92vw)`;
      root.style.maxHeight  = 'min(80vh, 680px)';
      root.style.overflowY  = 'auto';
      root.style.fontSize   = tooltipFontSize + 'px';
    }
  }

  // figure out where to pin when LOW_PROFILE == true
  // NOW: avoid overlapping HUD rails (drawer/cross/end) by downshifting (and, if needed, shoving left of the rail).
  function _dockLowProfile(){
    if (!root) return;
    const { tooltipDockEdge } = getLiveUISettings();

    // ensure sizing is up to date so offsetWidth/Height are correct
    _applySizingForMode();

    // Reset all anchors
    root.style.position = 'fixed';
    root.style.transform = '';
    root.style.left   = '';
    root.style.right  = '';
    root.style.top    = '';
    root.style.bottom = '';

    // Measure tooltip (ensure it's display:block for measurement)
    const prevDisplay = root.style.display;
    if (prevDisplay === 'none') root.style.display = 'block';

    const tipW = root.offsetWidth || 0;
    const tipH = root.offsetHeight || 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Helper builders
    const clampXY = ({x,y}) => ({
      x: Math.max(8, Math.min(x, vw - tipW - 8)),
      y: Math.max(8, Math.min(y, vh - tipH - 8)),
    });
    const makeRect = ({x,y}) => ({ left:x, top:y, right:x+tipW, bottom:y+tipH });
    const obstacles = _getHudObstacleRects();
    const hitsHud = (r)=> obstacles.some(ob => _rectsIntersect(r, ob));

    // Base dock positions (pixel coords instead of 50% + translate)
    let xy;
    if (tooltipDockEdge === 'left'){
      xy = { x: 16, y: (vh - tipH) / 2 };
    } else if (tooltipDockEdge === 'top'){
      xy = { x: (vw - tipW) / 2, y: 16 };
    } else if (tooltipDockEdge === 'bottom'){
      xy = { x: (vw - tipW) / 2, y: vh - tipH - 16 };
    } else {
      // default 'right'
      xy = { x: vw - tipW - 16, y: (vh - tipH) / 2 };
    }
    xy = clampXY(xy);
    let tipRect = makeRect(xy);

    // === Avoid HUD rails (downshift-first strategy) ===

    // 1) Try vertical downshift below deepest overlapping obstacle
    let guard = 0;
    while (guard < 4 && hitsHud(tipRect)) {
      let maxBottom = null;
      for (const ob of obstacles) {
        if (_rectsIntersect(tipRect, ob)) {
          maxBottom = Math.max(maxBottom ?? -Infinity, ob.bottom);
        }
      }
      if (maxBottom != null) {
        xy.y = maxBottom + 12;
        xy = clampXY(xy);
        tipRect = makeRect(xy);
      }
      guard++;
    }

    // 2) If still colliding, try parking above the top-most overlapping obstacle
    if (hitsHud(tipRect)) {
      let highestTop = Infinity;
      for (const ob of obstacles) {
        if (_rectsIntersect(tipRect, ob)) {
          highestTop = Math.min(highestTop, ob.top);
        }
      }
      if (Number.isFinite(highestTop)) {
        xy.y = (highestTop - tipH) - 12;
        xy = clampXY(xy);
        tipRect = makeRect(xy);
      }
    }

    // 3) If still colliding and dock edge is a side (right/left), shove horizontally away from the rail stack
    if (hitsHud(tipRect) && (tooltipDockEdge === 'right' || tooltipDockEdge === undefined)) {
      // Find the rightmost left edge among overlapping obstacles and park to its left
      let rightmostLeft = -Infinity;
      for (const ob of obstacles) {
        if (_rectsIntersect(tipRect, ob)) {
          rightmostLeft = Math.max(rightmostLeft, ob.left);
        }
      }
      if (rightmostLeft > -Infinity) {
        xy.x = (rightmostLeft - tipW) - 12;
        xy = clampXY(xy);
        tipRect = makeRect(xy);
      }
    } else if (hitsHud(tipRect) && tooltipDockEdge === 'left') {
      // Mirror for left rail: park to the right of the leftmost overlapping obstacle
      let leftmostRight = Infinity;
      for (const ob of obstacles) {
        if (_rectsIntersect(tipRect, ob)) {
          leftmostRight = Math.min(leftmostRight, ob.right);
        }
      }
      if (Number.isFinite(leftmostRight)) {
        xy.x = leftmostRight + 12;
        xy = clampXY(xy);
        tipRect = makeRect(xy);
      }
    }

    // 4) Final fallback for tiny screens: pin to top-left gutter
    if (hitsHud(tipRect)) {
      xy = clampXY({ x: 8, y: 8 });
      tipRect = makeRect(xy);
    }

    // Commit style (no transforms for slim mode)
    root.style.left = `${Math.round(xy.x)}px`;
    root.style.top  = `${Math.round(xy.y)}px`;
    root.style.right = '';
    root.style.bottom = '';
    root.style.transform = '';

    // restore prior display state if needed
    if (prevDisplay === 'none') root.style.display = 'none';
  }


  // helper we expose so settings sliders/dropdowns can force a re-dock live
  function redockIfSlim(){
    if (!_isSlim() || !root || root.style.display === 'none') return;
    _applySizingForMode();
    _dockLowProfile();
  }


  // -----------------------
  // follow helpers
  // -----------------------
  function stopFollowing(){
    followAnchorEl = null;
    if (followRAF) cancelAnimationFrame(followRAF);
    followRAF = 0;
  }

  function tickFollow(){
    if (!followAnchorEl || !document.body.contains(followAnchorEl) || !root || root.style.display === 'none'){
      followRAF = 0;
      return;
    }
    // normal mode: stick near card bottom
    positionNear(followAnchorEl, { mode:'bottom' });
    followRAF = requestAnimationFrame(tickFollow);
  }

  function startFollowing(anchorEl){
    followAnchorEl = anchorEl || null;
    if (followRAF) cancelAnimationFrame(followRAF);
    if (!followAnchorEl){
      followRAF = 0;
      return;
    }
    followRAF = requestAnimationFrame(tickFollow);
  }

  // -----------------------
  // setLowProfile (called by drag logic)
  // -----------------------
  function setLowProfile(v /*bool*/, draggedEl /*optional*/) {
    LOW_PROFILE = !!v;

    _applySizingForMode();

    if (_isSlim()) {
      // slim dock (battle mode or low-profile): stop following and pin to edge
      stopFollowing();
      if (root && root.style.display !== 'none') {
        _dockLowProfile();
      }
    } else {
      // leaving slim: go back to following the card if possible
      const target = (draggedEl && draggedEl.isConnected) ? draggedEl
                    : (activeEl   && activeEl.isConnected) ? activeEl
                    : null;
      if (target) {
        positionNear(target, { mode:'bottom' });
        startFollowing(target);
      }
    }
  }


  // -----------------------
  // mount
  // -----------------------
  function mount(){
    if (root) return root;
    root = document.createElement('div');
    root.id = 'tooltip';
    root.innerHTML = `
      <style>
  :root{
    /* uses your UI palette from user.interface.js */
    --ui-deep-0:#0a1b2c; --ui-deep-1:#0d2742; --ui-deep-2:#103255; --ui-deep-3:#0b1f37;
    --ui-text:#e8f1ff; --ui-muted:#a7bedb; --ui-accent:#2f8dff; --ui-border:rgba(255,255,255,.12);

    /* live-tunable vars */
    --tt-font-size:14px;
    --tt-max-width:260px;
    --tt-preview-h:160px;
    --tt-btn-size:24px;
  }
  #tooltip{
    position:fixed; display:none;
    background:linear-gradient(180deg, var(--ui-deep-2), var(--ui-deep-1));
    color:var(--ui-text); border:1px solid var(--ui-border);
    border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,.55); z-index:11000;
    max-width:min(var(--tt-max-width), 92vw); max-height:min(80vh, 680px); overflow:auto;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    font-size:var(--tt-font-size);
    padding:12px 12px 16px 12px;
    -webkit-user-select:none;
    user-select:none;
    touch-action:none;
  }
  /* Title row */
  #tooltip .title{
    display:flex; align-items:flex-start; gap:12px;
  }
  #tooltip .leftcol{ display:flex; flex-direction:column; gap:2px; min-width:0; }
  #tooltip .name{
    font-weight:800; letter-spacing:.2px;
    font-size:calc(var(--tt-font-size) + 2px);
    line-height:1.2;
  }
  #tooltip .mc{
    opacity:.95; white-space:nowrap; font-weight:800; line-height:1.2;
  }
  #tooltip .tl{
    margin-top:6px; color:var(--ui-muted);
    font-size:calc(var(--tt-font-size) - 2px);
    line-height:1.3;
  }
  #tooltip .ora{
    margin-top:8px;
    font-size:var(--tt-font-size);
    line-height:1.35;
    white-space:pre-wrap;
  }
  #tooltip .ptrow{
    margin-top:10px;
    display:flex;
    align-items:center;
    justify-content:space-between;
  }
  #tooltip .ogpt{
    font-size:calc(var(--tt-font-size) - 3px);
    opacity:.9;
  }
  #tooltip .livept{
    font-weight:900;
    padding:4px 8px;
    border-radius:10px;
    border:1px solid var(--ui-border);
    font-variant-numeric: tabular-nums;
    background:linear-gradient(180deg, var(--ui-deep-3), var(--ui-deep-2));
    font-size:calc(var(--tt-font-size) - 1px);
    line-height:1.2;
  }
  #tooltip .flip{
    margin-left:auto; align-self:flex-start;
    padding:6px 10px;
    border-radius:10px;
    border:1px solid var(--ui-border);
    font-size:calc(var(--tt-font-size) - 2px);
    background:linear-gradient(180deg, var(--ui-deep-3), var(--ui-deep-2));
    cursor:pointer;
    user-select:none;
    color:white;
    min-height:var(--tt-btn-size);
    display:flex;
    align-items:center;
    touch-action:none;
  }
</style>

<div class="title">
  <div class="leftcol">
    <div class="name" id="ttName"></div>
    <div class="mc"   id="ttCost"></div>
  </div>
  <button class="flip" id="ttFlip" style="display:none">Flip</button>
</div>

<div class="tl"     id="ttType"></div>
<div class="ora"    id="ttOracle"></div>
<div class="ptrow">
  <div class="ogpt"  id="ttOgPT"></div>
  <div class="livept"id="ttLivePT"></div>
</div>

<div class="ptrow loyrow">
  <div class="ogpt"  id="ttOgLOY"></div>
  <div class="livept"id="ttLiveLOY"></div>
</div>

    `;
    document.body.appendChild(root);

    nameN  = root.querySelector('#ttName');
costN  = root.querySelector('#ttCost');
typeN  = root.querySelector('#ttType');
oraN   = root.querySelector('#ttOracle');
ogPT   = root.querySelector('#ttOgPT');
livePT = root.querySelector('#ttLivePT');
ogLOY  = root.querySelector('#ttOgLOY');
liveLOY= root.querySelector('#ttLiveLOY');
flipBtn= root.querySelector('#ttFlip');



    // Stop taps inside tooltip from bubbling out and closing it.
    root.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
    }, { passive: true });

    // GLOBAL LISTENER #1: tap/click OUTSIDE tooltip and not on a card -> hide tooltip
    document.addEventListener('pointerdown', (ev)=>{
      if (ev.button && ev.button !== 0) return;
      const t = ev.target;
      const isCard = !!t.closest?.('img.table-card, img.hand-card');
      const isTip  = !!t.closest?.('#tooltip');
      if (!isCard && !isTip) hide();
    }, { passive: true });

    // GLOBAL LISTENER #2: tap/click ON a table card -> open tooltip for that card.
    document.addEventListener('pointerdown', (ev)=>{
      if (ev.button && ev.button !== 0) return;
      const card = ev.target.closest?.('img.table-card');
      if (!card) return;
      showForCard(card, card, { mode:'right' });
    }, { passive: true });

    return root;
  }


  // -----------------------
  // hide
  // -----------------------
  function hide(){
    if (root) root.style.display = 'none';
    stopFollowing();
  }
  
  // Collect visible HUD button rects (drawer tab, combat, end turn) on both rails.
function _getHudObstacleRects(){
  const sels = [
    '#ui-tab-toggle-a', '#ui-btn-cross-a', '#ui-btn-end-a',
    '#ui-tab-toggle-b', '#ui-btn-cross-b', '#ui-btn-end-b'
  ];
  const els = sels
    .map(s => document.querySelector(s))
    .filter(el =>
      el &&
      el.isConnected &&
      el.offsetParent !== null &&                       // not display:none / detached
      getComputedStyle(el).visibility !== 'hidden'      // not visibility:hidden
    );

  return els.map(el => el.getBoundingClientRect());
}

// Basic rect intersection helper (same semantics as your local one).
function _rectsIntersect(a, b){
  return !(b.left >= a.right || b.right <= a.left || b.top >= a.bottom || b.bottom <= a.top);
}


// -----------------------
// positionNear (normal mode) — auto-flips + avoids HUD buttons (Y + X shove)
// -----------------------
function positionNear(anchorEl, { mode = 'right' } = {}){
  if (!root) return;

  // Slim / battle mode: just dock
  if (_isSlim()){
    _applySizingForMode();
    _dockLowProfile();
    return;
  }

  _applySizingForMode();
  if (!anchorEl) return;

  const cardRect = anchorEl.getBoundingClientRect();
  const tipW = root.offsetWidth;
  const tipH = root.offsetHeight;

  const calcXY = (m) => {
    if (m === 'bottom') {
      const extraGap = 48;
      return { x: (cardRect.left + cardRect.right)/2 - tipW/2, y: cardRect.bottom + extraGap };
    }
    if (m === 'top')   return { x: cardRect.left,              y: cardRect.top - tipH - 12 };
    if (m === 'left')  return { x: cardRect.left - tipW - 12,  y: cardRect.top };
    /* right */        return { x: cardRect.right + 12,        y: cardRect.top };
  };

  const clampXY = ({x,y}) => ({
    x: Math.max(8, Math.min(x, window.innerWidth  - tipW - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - tipH - 8)),
  });

  const makeRect = ({x,y}) => ({ left:x, top:y, right:x+tipW, bottom:y+tipH });
  const overlaps = (a,b)=>!(b.left>=a.right||b.right<=a.left||b.top>=a.bottom||b.bottom<=a.top);

  let preferred = mode || 'right';
  let xy = clampXY(calcXY(preferred));
  let tipRect = makeRect(xy);

  // Flip for vertical overlap with the card
  if ((preferred==='bottom'||preferred==='top') && overlaps(cardRect, tipRect)){
    const alt = preferred==='bottom' ? 'top' : 'bottom';
    const xyAlt = clampXY(calcXY(alt));
    const rectAlt = makeRect(xyAlt);
    if (!overlaps(cardRect, rectAlt)){ preferred = alt; xy = xyAlt; tipRect = rectAlt; }
  }

  // Avoid HUD: drawer tab, Combat, End Turn (both rails)
  const obstacles = _getHudObstacleRects();
  const hitsHud = (r)=> obstacles.some(ob => _rectsIntersect(r, ob));

  // 1) Try vertical downshift below deepest obstacle
  let tries = 0;
  while (tries < 3 && hitsHud(tipRect)) {
    let maxBottom = null;
    for (const ob of obstacles) if (_rectsIntersect(tipRect, ob))
      maxBottom = Math.max(maxBottom ?? -Infinity, ob.bottom);
    if (maxBottom != null) {
      xy.y = maxBottom + 12;
      xy = clampXY(xy);
      tipRect = makeRect(xy);
    }
    tries++;
  }

  // 2) If still colliding, try above the top-most obstacle
  if (hitsHud(tipRect)) {
    let highestTop = Infinity;
    for (const ob of obstacles) if (_rectsIntersect(tipRect, ob))
      highestTop = Math.min(highestTop, ob.top);
    if (Number.isFinite(highestTop)) {
      xy.y = (highestTop - tipH) - 12;
      xy = clampXY(xy);
      tipRect = makeRect(xy);
    }
  }

  // 3) If we STILL collide (common case near right rail), shove LEFT of the rail.
  if (hitsHud(tipRect)) {
    // Find the rightmost obstacle we collide with and park to its left.
    let rightmostLeft = -Infinity;
    for (const ob of obstacles) {
      if (_rectsIntersect(tipRect, ob)) {
        rightmostLeft = Math.max(rightmostLeft, ob.left);
      }
    }
    if (rightmostLeft > -Infinity) {
      xy.x = (rightmostLeft - tipW) - 12;  // move left of rail stack
      xy = clampXY(xy);
      tipRect = makeRect(xy);
    }
  }

  // 4) Final fallback: if still intersecting (tiny screens), shove to extreme left gutter.
  if (hitsHud(tipRect)) {
    xy.x = 8;
    xy = clampXY(xy);
    tipRect = makeRect(xy);
  }

  root.style.position = 'fixed';
  root.style.left = `${xy.x}px`;
  root.style.top  = `${xy.y}px`;
  root.style.right = '';
  root.style.bottom = '';
  root.style.transform = '';
}



  // -----------------------
  // helpers
  // -----------------------
  function readPT(el){
    const cur = el?.dataset?.ptCurrent;
    if (cur) return cur;
    const p = el?.dataset?.power ?? '';
    const t = el?.dataset?.toughness ?? '';
    return (p!=='' && t!=='') ? `${p}/${t}` : '—';
  }
  
  function readLoyalty(el){
  const cur = el?.dataset?.loyaltyCurrent;
  if (cur != null && cur !== '') return String(cur);
  const base = el?.dataset?.loyalty;
  return (base != null && base !== '') ? String(base) : '—';
}


  // -----------------------
  // showForCard
  // -----------------------
  async function showForCard(elOrCid, anchorEl, opts={}){
    mount();
    const el = typeof elOrCid === 'string'
      ? document.querySelector(`img.table-card[data-cid="${elOrCid}"]`)
      : elOrCid;
    if (!el) return;

    activeEl = el; // track current card being inspected

    const name = el.dataset.name || el.title || el.alt || '';
    if (!name) return;

// Fetch meta using the actual element (image + datasets) to avoid name collisions
const meta = await fetchMetaForEl(el);

    
 const faces = Array.isArray(meta?.faces) && meta.faces.length
   ? meta.faces
   : [{ title:name, cost:'', type:'', oracle:'', power:'', toughness:'', img: el.currentSrc || el.src || '' }];

    const hasBack = faces.length > 1;
// Choose the most appropriate face for first render.
let faceIdx;
const parsedIdx = parseInt(el.dataset.faceIndex ?? '', 10);
if (Number.isFinite(parsedIdx)) {
  faceIdx = clamp(parsedIdx, 0, faces.length - 1);
} else {
  // No prior index: try to match by face title, then by currentSide, then by type heuristic.
  faceIdx = 0;
  const wantName = (el.dataset.name || name || '').toLowerCase();
  const exactIdx = faces.findIndex(f => String(f.title || '').toLowerCase() === wantName);
  if (exactIdx >= 0) {
    faceIdx = exactIdx;
  } else if ((el.dataset.currentSide === 'back') && faces.length > 1) {
    faceIdx = 1;
  } else {
    const tl = String(el.dataset.typeLine || '').toLowerCase();
    if (tl.includes('treasure')) {
      const tIdx = faces.findIndex(f => /treasure/i.test(String(f.type || '')));
      if (tIdx >= 0) faceIdx = tIdx;
    }
  }
  el.dataset.faceIndex = String(faceIdx);
}
const face = faces[faceIdx] || faces[0];


    // sync this face's info into the card element and refresh badges (no detach)
    _stampFaceOnEl(face, el);

    // Fill missing datasets as fallback (kept from your stable baseline)
    el.dataset.hasFlip = hasBack ? '1' : '';
    if (el.dataset.manaCost == null)  el.dataset.manaCost  = face.cost || '';
    if (el.dataset.typeLine == null)  el.dataset.typeLine  = face.type || '';
    if (el.dataset.oracle == null)    el.dataset.oracle    = face.oracle || '';
    if (el.dataset.power == null)     el.dataset.power     = face.power ?? '';
    if (el.dataset.toughness == null) el.dataset.toughness = face.toughness ?? '';

    // Render tooltip text
    nameN.textContent = face.title || name;

    const replaceBraces = txt =>
      String(txt || '').replace(/\{([^}]+)\}/g, (m, sym) => manaCostHtml(`{${sym}}`));

    costN.innerHTML = replaceBraces(face.cost);
    typeN.textContent = face.type || '';
    oraN.innerHTML = replaceBraces(face.oracle).replace(/\r?\n/g, '<br>');

// P/T row
const hasPT = (face.power!=='' && face.toughness!=='');
ogPT.textContent  = hasPT ? `Original: ${face.power}/${face.toughness}` : 'Original: —';
livePT.textContent = readPT(el);
const ptRow = ogPT.closest('.ptrow');
if (ptRow) ptRow.style.display = hasPT ? '' : 'none';

// Loyalty row
const hasLOYPrinted = (String(face.loyalty ?? '') !== '');
if (ogLOY && liveLOY) {
  ogLOY.textContent   = hasLOYPrinted ? `Original: ${face.loyalty}` : 'Original: —';
  liveLOY.textContent = readLoyalty(el);
  const loyRow = ogLOY.closest('.loyrow');
  if (loyRow) loyRow.style.display = (hasLOYPrinted || (el.dataset.loyalty || el.dataset.loyaltyCurrent)) ? '' : 'none';
}


    // Flip button
    flipBtn.style.display = hasBack ? '' : 'none';
    flipBtn.onclick = () => doFlip(el, meta);

    root.style.display = 'block';

// make sure we are NOT stuck in slim/docked mode after a prior drag
if (!BATTLE_MODE && LOW_PROFILE) {
  LOW_PROFILE = false;
}

// refresh sizing for current mode
_applySizingForMode();

// anchor + follow
const anchor = anchorEl || el;
const isTableCard = !!anchor?.classList?.contains('table-card');



    // position immediately
    positionNear(anchor, { mode: isTableCard ? 'bottom' : (opts.mode || 'right') });

    // follow if table-card AND not in low-profile
    if (isTableCard && !LOW_PROFILE){
      startFollowing(anchor);
    } else {
      stopFollowing();
    }
  }

  // -----------------------
  // doFlip
  // -----------------------
  async function doFlip(el, meta){
    try{
      const faces = meta?.faces || [];
      if (!faces.length) return;
      const next = (parseInt(el.dataset.faceIndex||'0',10)||0) + 1;
      const idx  = next % faces.length;
      const f    = faces[idx];

      // visually flip img + index
      if (f.img) el.src = f.img;
      el.title = f.title || el.title;
      el.dataset.faceIndex = String(idx);
      el.dataset.hasFlip   = faces.length > 1 ? '1' : '';

      // stamp new face into datasets and update badges
      _stampFaceOnEl(f, el);

      // update tooltip UI live without closing
      if (root && root.style.display !== 'none') {
        activeEl = el;

        const replaceBraces = txt =>
          String(txt || '').replace(/\{([^}]+)\}/g, (m, sym) => manaCostHtml(`{${sym}}`));

        nameN.textContent = f.title || el.title || '';
        costN.innerHTML   = replaceBraces(f.cost || '');
        typeN.textContent = f.type || '';
        oraN.innerHTML    = replaceBraces(f.oracle || '').replace(/\r?\n/g, '<br>');

        // P/T
const hasPT = (f.power!=='' && f.toughness!=='');
ogPT.textContent  = hasPT ? `Original: ${f.power}/${f.toughness}` : 'Original: —';
livePT.textContent = readPT(el);
const ptRow = ogPT.closest('.ptrow');
if (ptRow) ptRow.style.display = hasPT ? '' : 'none';

// Loyalty
const hasLOYPrinted = (String(f.loyalty ?? '') !== '');
if (typeof ogLOY !== 'undefined' && typeof liveLOY !== 'undefined') {
  ogLOY.textContent   = hasLOYPrinted ? `Original: ${f.loyalty}` : 'Original: —';
  liveLOY.textContent = readLoyalty(el);
  const loyRow = ogLOY.closest('.loyrow');
  if (loyRow) loyRow.style.display = (hasLOYPrinted || (el.dataset.loyalty || el.dataset.loyaltyCurrent)) ? '' : 'none';
}

      }

      // Broadcast RTC flip using selected face data
      try{
        const owner = (typeof window.mySeat === 'function') ? window.mySeat() : 1;
        const pkt = {
  type: 'flip',
  cid: el.dataset.cid,
  owner,
  faceIndex: idx,
  img: f.img || '',
  name: f.title || '',
  manaCost: f.cost || '',
  typeLine: f.type || '',
  oracle: f.oracle || '',
  power: f.power ?? '',
  toughness: f.toughness ?? '',
  loyalty: f.loyalty ?? '',
  hasFlip: faces.length > 1
};

        (window.rtcSend || window.peer?.send)?.(pkt);
      }catch(e){}
    }catch(e){
      console.warn('[Tooltip] flip failed', e);
    }
  }

  // -----------------------
  // showForHandFocus (hand preview helper)
  // -----------------------
  async function showForHandFocus(imgEl){
    const name = imgEl?.title || imgEl?.alt || '';
    if (!name) return;
    return showForCard({ dataset:{ name, faceIndex:'0' }, title:name }, imgEl, { mode:'top' });
  }

  // -----------------------
  // setBattleMode (forces slim while true)
  // -----------------------
  function setBattleMode(on){
    BATTLE_MODE = !!on;
    _applySizingForMode();

    if (_isSlim()){
      // force dock
      stopFollowing();
      if (root && root.style.display !== 'none') {
        _dockLowProfile();
      }
    } else {
      // return to normal follow if a card is active
      const target = (activeEl && activeEl.isConnected) ? activeEl : null;
      if (target && root && root.style.display !== 'none') {
        positionNear(target, { mode:'bottom' });
        startFollowing(target);
      }
    }
  }


  // -----------------------
  // public API
  // -----------------------
    return {
    mount,
    hide,
    showForCard,
    showForHandFocus,
    setLowProfile,
    redockIfSlim,
    setBattleMode   // ← NEW
  };

})();

// expose globally
if (!window.Tooltip) window.Tooltip = {};
Object.assign(window.Tooltip, {
  mount: Tooltip.mount,
  hide: Tooltip.hide,
  showForCard: Tooltip.showForCard,
  showForHandFocus: Tooltip.showForHandFocus,
  setLowProfile: Tooltip.setLowProfile,
  redockIfSlim: Tooltip.redockIfSlim,
  setBattleMode: Tooltip.setBattleMode   // ← NEW
});

Tooltip.mount();
