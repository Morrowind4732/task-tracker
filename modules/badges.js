// modules/badges.js
// Always-on badges for card Types / Abilities / Effects + live P/T sticker.
// - Anchored panel on the RIGHT of each table card (drag-safe).
// - Live P/T sticker overlaps bottom-right of the card itself (drag-safe).
// - Innate data from dataset.typeLine / dataset.oracle.
// - Granted data from CardAttributes or el.dataset.remoteAttrs (RTC).
// - Dynamic buffs from RulesStore (EOT, etc).
// - P/T from RulesStore final -> CardAttributes -> dataset.ptCurrent -> base face PT.
// - Renders on spawn / attrs / flip and follows via rAF, without blocking input.

import { manaCostHtml } from './mana.master.js';

// [SETTINGS HOOK]
// We’re going to read live tuning values from UserInterface._UISettingsDraft
// (while you're previewing sliders) OR fallback to sane defaults if UI not mounted yet.
//
// We DO NOT cache them at module load. We read them at runtime so changing sliders
// instantly affects layout/scale with no reload.
function _getUISettingsDraftSafe() {
  const ui = window?.UserInterface;
  if (!ui) return null;
  // we exposed _UISettingsDraft in user.interface.js return {}
  return ui._UISettingsDraft || null;
}

// helpers that pull dynamic numbers from settings draft/live
function cfgBadgePanelScale() {
  const s = _getUISettingsDraftSafe();
  return (s && Number.isFinite(s.badgePanelScale)) ? s.badgePanelScale : 1.0;
}
function cfgBadgeOffsetX() {
  const s = _getUISettingsDraftSafe();
  return (s && Number.isFinite(s.badgeOffsetX)) ? s.badgeOffsetX : 16;
}
function cfgBadgeOffsetY() {
  const s = _getUISettingsDraftSafe();
  return (s && Number.isFinite(s.badgeOffsetY)) ? s.badgeOffsetY : 0;
}
function cfgPTScale() {
  const s = _getUISettingsDraftSafe();
  return (s && Number.isFinite(s.ptStickerScale)) ? s.ptStickerScale : 1.0;
}
function cfgPTOffsetX() {
  const s = _getUISettingsDraftSafe();
  return (s && Number.isFinite(s.ptStickerOffsetX)) ? s.ptStickerOffsetX : 0;
}
function cfgPTOffsetY() {
  const s = _getUISettingsDraftSafe();
  return (s && Number.isFinite(s.ptStickerOffsetY)) ? s.ptStickerOffsetY : 0;
}

// Loyalty sticker (independent knobs; fall back to PT values if not present)
function cfgLOYScale() {
  const s = _getUISettingsDraftSafe();
  if (s && Number.isFinite(s.loyStickerScale)) return s.loyStickerScale;
  return (s && Number.isFinite(s.ptStickerScale)) ? s.ptStickerScale : 1.0;
}
function cfgLOYOffsetX() {
  const s = _getUISettingsDraftSafe();
  if (s && Number.isFinite(s.loyStickerOffsetX)) return s.loyStickerOffsetX;
  return 0;
}
function cfgLOYOffsetY() {
  const s = _getUISettingsDraftSafe();
  if (s && Number.isFinite(s.loyStickerOffsetY)) return s.loyStickerOffsetY;
  return 0;
}


// STATIC limits / behavior
const PANEL_MAX_WIDTH  = 220;

// these are *relative scaling clamps* based on the actual on-screen card height vs 180px.
// We'll still honor them, but the base result then multiplies by badgePanelScale() / ptStickerScale()
const PANEL_SCALE_MIN = 0.45;
const PANEL_SCALE_MAX = 1.00;
const STICKER_SCALE_MIN = 0.55;
const STICKER_SCALE_MAX = 1.20;

// --- Badge fade vs Camera scale (opacity only affects the RIGHT badge panel)
// Badges start fading as we approach the cutoff, and are fully invisible at/under it.
const BADGE_FADE_CUTOFF = 0.4067789490223631; // fully invisible at/under this scale
const BADGE_FADE_RANGE  = 0.12;                // start fading at (cutoff + range)

// --- Sticker fade vs Camera scale (P/T + Loyalty + buff bubble)
// Stickers start fading as we approach the cutoff, and are fully invisible at/under it.
// (Set independently from BADGE_* so you can tune them separately.)
const STICKER_FADE_CUTOFF = 0.40567789490223631;
const STICKER_FADE_RANGE  = 0.12;


// --- Visibility gating (must be well on-screen to show)
const VIS_SHOW_RATIO = 0.60; // need ≥60% of the card visible to show
const VIS_HIDE_RATIO = 0.40; // hide when it falls ≤40% visible
const VIS_EDGE_PAD   = 16;   // treat viewport as inset by this many px

// Left-side buttons: wand / tap
const LBTN_SIZE_BASE   = 40;  // base px before scale
const LBTN_GAP_PX      = 12;  // (not currently used in final layout, we hug edges)
const LBTN_BOTTOM_GAP  = 10;  // px below card bottom, unscaled

// --- Tap animation extras
const TAP_LOCK_MS = 220;           // how long to freeze positions during rotate
const TAPPED_STICKER_BOOST = 1.25; // scale multiplier for P/T sticker while tapped


// --- [tap:helpers] smooth tap/untap animation (rotate)
let _tapAnimCSSInjected = false;
function ensureTapAnimCSS(){
  if (_tapAnimCSSInjected) return;
  const style = document.createElement('style');
  style.id = 'tap-anim-style';
  style.textContent = `
    @supports (rotate: 0deg) {
      .tap-anim { transition: rotate 180ms cubic-bezier(.2,.8,.2,1); }
      .tap-anim-fast { transition: rotate 140ms cubic-bezier(.2,.8,.2,1); }
    }
  `;
  document.head.appendChild(style);
  _tapAnimCSSInjected = true;
}

function animateTap(el, toTapped){
  ensureTapAnimCSS();
  el.classList.add('tap-anim');
  el.dataset.tapped = toTapped ? '1' : '0';
  el.style.rotate   = toTapped ? '90deg' : '0deg';
  el.classList.toggle('is-tapped', toTapped);
}

const store = new Map(); // cid -> {panel, sticker, btnWand, btnTap, buffWrap, raf, anchor, sig, ...}


// ---------- Buff/debuff floating stack helpers ----------

function _ensureBuffWrap(el){
  const cid = el?.dataset?.cid;
  if (!cid) return null;

  if (!el._buffWrap){
    const wrap = document.createElement('div');
    wrap.className = 'buff-sticker-wrap';
    wrap.dataset.cid = cid;

    Object.assign(wrap.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483646',

      background: 'linear-gradient(180deg, var(--ui-deep-3), var(--ui-deep-2))',
      border: '1px solid var(--ui-border)',
      borderRadius: '10px',
      boxShadow: '0 12px 32px rgba(0,0,0,.7)',

      padding: '6px 8px',

      display: 'none',

      display: 'flex',
      flexDirection: 'column-reverse',
      rowGap: '2px',

      fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
      fontWeight: '700',
      lineHeight: '1.2',
      fontSize: '12px',
      color: '#e7f2ff',
      textShadow: '0 0 4px rgba(0,0,0,.8)',
      whiteSpace: 'nowrap',

      transformOrigin: 'right bottom',
      transform: 'translateZ(0) scale(1)',
    });

    document.body.appendChild(wrap);
    el._buffWrap = wrap;

    //console.log('[BuffWrap] created for cid', cid, wrap);
  }

  return el._buffWrap;
}

function _rebuildBuffRows(el, info){
  const cid = el?.dataset?.cid;
  if (!cid) return;
  const wrap = _ensureBuffWrap(el);
  if (!wrap) return;

  // raw buffs from RulesStore.resolveForCard(cid).tempBuffs
  const buffs = Array.isArray(info?.__rulesBuffs) ? info.__rulesBuffs : [];
  wrap.innerHTML = '';

  // Build a quick lookup of live counters so we can EXCLUDE them from the buff bubble.
  // Counters should render ONLY as right-side badges.
  const countersArr = Array.isArray(info?.__grant?.counters) ? info.__grant.counters : [];
  const counterKinds = new Set(
    countersArr
      .map(c => String(c?.kind || c?.name || '').trim().toLowerCase())
      .filter(Boolean)
  );

  for (const b of buffs){
    const raw = String(b?.text || '').trim();
    if (!raw) continue;

    const rawLower = raw.toLowerCase();

    // --- Counter exclusion rules ---
    // 1) If text explicitly mentions "counter"/"counters", skip it (e.g., "+1/+1 counter", "add a stun counter").
    if (/\bcounters?\b/.test(rawLower)) {
      continue;
    }
    // 2) If it looks like a known counter kind (e.g., "Stun", "Shield", "Loyalty") appearing in this line, skip it.
    //    This avoids duplicates like "Stun ×1" appearing as a sticker.
    let looksLikeKnownCounter = false;
    for (const kind of counterKinds) {
      // loose contain check with word bound—handles variants like "Stun ×1", "add a Stun", etc.
      const re = new RegExp(`\\b${kind.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(raw)) { looksLikeKnownCounter = true; break; }
    }
    if (looksLikeKnownCounter) {
      continue;
    }

   // -------------------------------------------------
// Keep ONLY true stat buffs/debuffs here:
// require a real P/T delta pattern with a slash, e.g. "+3/+3", "-2/-0"
// This excludes "Stun x2 PERM", "Shield ×1", etc.
// -------------------------------------------------
const isStatBuff = /(?:^|\s)[+-]?\d+\s*\/\s*[+-]?\d+/.test(raw);

// If it looks like a multiplier (x2/×2) and has no P/T slash, treat as counter-like → drop.
const hasMultiplier = /[x×]\s*\d+/.test(raw);

if (!isStatBuff || hasMultiplier) {
  continue;
}


    // visual styling
    const isPos = raw.startsWith('+');
    const isNeg = raw.startsWith('-');

    const row = document.createElement('div');
    row.textContent = raw;
    row.style.color = isPos ? '#4ade80' : (isNeg ? '#f87171' : '#e7f2ff');
    row.style.fontWeight = '700';
    row.style.textShadow = '0 0 4px rgba(0,0,0,.8)';
    wrap.appendChild(row);
  }

  wrap.style.display = wrap.childElementCount ? '' : 'none';
}


function _followBuffWrapViewport(info){
  const wrap    = info?.buffWrap;
  const sticker = info?.sticker;
  if (!wrap || !sticker) return;
  if (!document.body.contains(wrap) || !document.body.contains(sticker)) return;

  const stRect = sticker.getBoundingClientRect();

  const GAP_Y = 6;
  const rightX = stRect.right;
  const topY   = stRect.top;

  wrap.style.left = rightX + 'px';
  wrap.style.top  = (topY - GAP_Y) + 'px';

  // match sticker scale
  const s = info.__stickerScale || 1;
  wrap.style.transformOrigin = 'right bottom';
  wrap.style.transform       = `translate(-100%, -100%) scale(${s})`;
}


// Token-aware meta fetcher: prefer prints that match our typeLine hint,
// and among those prefer ones with an empty oracle (no built-in abilities).
async function _fetchBestTokenMeta(name, typeLineHint=''){
  const key = `tok:${(name||'').toLowerCase()}|${(typeLineHint||'').toLowerCase()}`;
  if (_MetaCache.has(key)) return _MetaCache.get(key);

  const enc = encodeURIComponent;
  const url =
    `https://api.scryfall.com/cards/search?` +
    `q=!"${enc(name)}"+is:token&unique=prints&include_extras=true&order=released`;

  try{
    const r = await fetch(url, { cache:'no-store' });
    if (!r.ok) throw new Error('scryfall');
    const j = await r.json();
    const data = Array.isArray(j.data) ? j.data : [];

    const norm = s => String(s||'').trim().toLowerCase();
    const tHint = norm(typeLineHint);

    // score candidates: match typeline → prefer empty oracle → newest first
    let best = null, bestScore = -1;
    for (const card of data){
      const face0 = (Array.isArray(card.card_faces) && card.card_faces[0]) ? card.card_faces[0] : null;
      const typeLine  = norm(face0?.type_line ?? card.type_line ?? '');
      const oracleTxt = String(face0?.oracle_text ?? card.oracle_text ?? '');
      const power     = face0?.power ?? card.power ?? '';
      const tough     = face0?.toughness ?? card.toughness ?? '';
      const loyalty   = face0?.loyalty ?? card.loyalty ?? '';

      let score = 0;
      if (tHint && typeLine === tHint) score += 10;
      if (!oracleTxt.trim())           score += 2;   // no abilities → plainest token
      // newer prints will naturally appear later; tiny bias to later items
      score += 0.001;

      if (score > bestScore){
        bestScore = score;
        best = { typeLine: face0?.type_line ?? card.type_line ?? '',
                 oracle:   oracleTxt,
                 power, toughness, loyalty };
      }
    }

    if (best){
      _MetaCache.set(key, best);
      return best;
    }
  }catch(e){ /* fall through to name-only */ }

  // fallback to the name-only fetch you already had
  return _fetchMetaByName(name);
}

async function _fetchMetaById(id){
  if (!id) return null;
  const key = `id:${id}`;
  if (_MetaCache.has(key)) return _MetaCache.get(key);
  try{
    const r = await fetch(`https://api.scryfall.com/cards/${id}`, { cache:'no-store' });
    if (!r.ok) throw new Error('scryfall');
    const j = await r.json();
    const face0 = (Array.isArray(j.card_faces) && j.card_faces[0]) ? j.card_faces[0] : null;
    const meta = {
      typeLine:  face0?.type_line   ?? j.type_line   ?? '',
      oracle:    face0?.oracle_text ?? j.oracle_text ?? '',
      power:     (face0?.power     ?? j.power     ?? ''),
      toughness: (face0?.toughness ?? j.toughness ?? ''),
      loyalty:   (face0?.loyalty   ?? j.loyalty   ?? '')
    };
    _MetaCache.set(key, meta);
    return meta;
  } catch { return null; }
}

function _scryIdFromImg(el){
  const src = el?.currentSrc || el?.src || '';
  // Art urls, png/jpg: they often contain a UUID segment.
  const m = src.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}



// ---------- Meta hydration ------------
const _MetaCache = new Map();
async function _fetchMetaByName(name){
  const key = String(name||'').toLowerCase();
  if (!key) return null;
  if (_MetaCache.has(key)) return _MetaCache.get(key);
  try{
    const r = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`, {cache:'no-store'});
    if (!r.ok) throw new Error('scryfall');
    const j = await r.json();
    const face0 = (Array.isArray(j.card_faces) && j.card_faces[0]) ? j.card_faces[0] : null;
    const meta = {
  typeLine:  face0?.type_line   ?? j.type_line   ?? '',
  oracle:    face0?.oracle_text ?? j.oracle_text ?? '',
  power:     (face0?.power     ?? j.power     ?? ''),
  toughness: (face0?.toughness ?? j.toughness ?? ''),
  // loyalty is only on planeswalker faces; safe to default empty
  loyalty:   (face0?.loyalty   ?? j.loyalty   ?? '')
};

    _MetaCache.set(key, meta);
    return meta;
  } catch {
    return null;
  }
}

// --- match tooltip's numeric safety ---
function _safePTNumber(str){
  const raw = String(str ?? '').trim();
  if (raw === '') return null;        // "no P/T on this face"
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  return 1;                           // "*", "X", "1+*", etc. -> default 1
}
function _safeLoyaltyNumber(str){
  const raw = String(str ?? '').trim();
  if (raw === '') return null;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  return null;
}

// Optional: fill base types/abilities if deck spawn didn't set them
function _deriveBaseTypes(typeLine){
  if (!typeLine) return [];
  return typeLine.replace(/—/g,' ').split(/\s+/).map(s=>s.trim()).filter(Boolean);
}
function _deriveBaseAbilities(oracleText){
  if (!oracleText) return [];
  const ABILITIES = ['flying','first strike','double strike','vigilance','lifelink','deathtouch','trample','haste','reach','defender','hexproof','indestructible','menace','ward','battle cry','exalted'];
  const VERB_GUARD = /\b(gets?|gains?|has|have|loses?|becomes?|gain|give|grants?)\b/i;
  const out = new Set();
  const lines = String(oracleText).split(/\r?\n+/).map(l=>l.trim()).filter(Boolean);
  for (const line of lines){
    const low = line.toLowerCase();
    if (/^(as long as|whenever|when |at the beginning|if |while |other |each other |creatures? you control |your creatures |tokens you control |all creatures you control )/i.test(line)) continue;
    if (!ABILITIES.some(kw=>low.startsWith(kw))) continue;
    let head = line.split('(')[0].split('.')[0].trim();
    if (!head || VERB_GUARD.test(head)) continue;
    for (const part of head.split(/[;,]/).map(s=>s.trim()).filter(Boolean)){
      const p = part.toLowerCase();
      if (p.startsWith('hexproof ') || /^protection\s+from\b/i.test(part) || /\bas long as\b|\bif\b|\bwhile\b/i.test(part)) continue;
      const match = ABILITIES.find(kw=>p.startsWith(kw));
      if (match) out.add(match.replace(/\b\w/g,m=>m.toUpperCase()));
    }
  }
  return [...out];
}


async function ensureHydratedDatasets(el){
  const hasType    = !!(el.dataset.typeLine && el.dataset.typeLine.trim());
  const hasOracle  = !!(el.dataset.oracle && el.dataset.oracle.trim());
  const hasPower   = el.dataset.power != null && el.dataset.power !== '';
  const hasTough   = el.dataset.toughness != null && el.dataset.toughness !== '';
  const hasPTcur   = el.dataset.ptCurrent != null && el.dataset.ptCurrent !== '';
  const hasLoy     = el.dataset.loyalty != null && el.dataset.loyalty !== '';
  const hasLoyCur  = el.dataset.loyaltyCurrent != null && el.dataset.loyaltyCurrent !== '';

  // If we already have everything a sticker needs, bail early.
  if (hasType && hasOracle && hasPower && hasTough && hasPTcur) return;

  const name = el.dataset.name || el.title || el.alt || '';
  if (!name) return;

  // -----------------------------------------------
  // 0) Guard: if this card is a "Copy", never stamp PT from Scryfall.
  //    We'll let RulesStore / CardAttributes drive PT (or hide sticker).
  // -----------------------------------------------
  let isCopyGrant = false;
  try {
    // local CardAttributes.grants
    const row = window.CardAttributes?.get?.(el.dataset.cid);
    const grantsLocal = Array.isArray(row?.grants) ? row.grants : [];
    // remoteAttrs.grants
    const remote = el.dataset.remoteAttrs ? JSON.parse(el.dataset.remoteAttrs) : null;
    const grantsRemote = Array.isArray(remote?.grants) ? remote.grants : [];

    const anyGrants = [...grantsLocal, ...grantsRemote];
    isCopyGrant = anyGrants.some(g => String(g?.kind || 'type').toLowerCase() === 'type'
                                   && String(g?.name || '').trim().toLowerCase() === 'copy');
  } catch {}

  // If it's a Copy, strip any stale PT so the sticker doesn't default to random token prints.
  if (isCopyGrant) {
    delete el.dataset.ptCurrent;
    delete el.dataset.power;
    delete el.dataset.toughness;
    // Still allow typeline/oracle hydration below, but skip PT entirely.
  }
  
  

const sfId = _scryIdFromImg(el);
let meta = null;
if (sfId) {
  meta = await _fetchMetaById(sfId);
}
if (!meta) {
  meta = await _fetchBestTokenMeta(name, el.dataset.typeLine || '');
}
if (!meta) return;


  // Do not overwrite fields that are already present
  if (!hasType)   el.dataset.typeLine  = meta.typeLine || '';
  if (!hasOracle) el.dataset.oracle    = meta.oracle   || '';

  // -----------------------------------------------
  // 1) Only hydrate PT if the meta face is actually creature-like.
  //    This is the key to avoid the rogue "3/1" token print.
  // -----------------------------------------------
  const typeLineMeta = (meta.typeLine || '').toLowerCase();
  const isCreatureishMeta = /\b(creature|vehicle)\b/.test(typeLineMeta);

  // Compute safe printed P/T (numbers or null)
  const pSafe = _safePTNumber(meta.power);
  const tSafe = _safePTNumber(meta.toughness);

  // If Copy, or non-creatureish, we do not stamp PT.
  const allowStampPT = !isCopyGrant && isCreatureishMeta;

  if (allowStampPT) {
    if (!hasPower || !hasTough){
      if (pSafe === null && tSafe === null) {
        delete el.dataset.power;
        delete el.dataset.toughness;
        delete el.dataset.ptCurrent;
      } else {
        const p = (pSafe === null ? 1 : pSafe);
        const t = (tSafe === null ? 1 : tSafe);
        if (!hasPower) el.dataset.power     = String(p);
        if (!hasTough) el.dataset.toughness = String(t);
        if (!hasPTcur) el.dataset.ptCurrent = `${p}/${t}`;
      }
    } else if (!hasPTcur) {
      el.dataset.ptCurrent = `${el.dataset.power}/${el.dataset.toughness}`;
    }
  } else {
    // Explicitly clear stale PT if meta says it's not creatureish or this is a Copy.
    delete el.dataset.ptCurrent;
    delete el.dataset.power;
    delete el.dataset.toughness;
  }

  // Loyalty (for walkers)
  if (!hasLoy || !hasLoyCur){
    const L = _safeLoyaltyNumber(meta.loyalty);
    if (L == null){
      delete el.dataset.loyalty;
      delete el.dataset.loyaltyCurrent;
    } else {
      if (!hasLoy)    el.dataset.loyalty        = String(L);
      if (!hasLoyCur) el.dataset.loyaltyCurrent = String(L);
    }
  }

  // Seed base types/abilities if deck loader didn’t
  if (!el.dataset.baseTypes)     el.dataset.baseTypes     = JSON.stringify(_deriveBaseTypes(el.dataset.typeLine || ''));
  if (!el.dataset.baseAbilities) el.dataset.baseAbilities = JSON.stringify(_deriveBaseAbilities(el.dataset.oracle || ''));
}



// ---------- misc helpers ----------
function byCid(el){ return el?.dataset?.cid || null; }
function stopRAF(info){ if (info?.raf) cancelAnimationFrame(info.raf); info.raf = 0; }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

// readBaseAbilities(el)
// Return the safe, pre-parsed evergreen abilities that we captured at deck load time.
// This is STRICT: first-line-only, no "…from white", no conditionals, no token text.
// If nothing is available, returns an empty Set (not a guess).

function readBaseAbilities(el){
  if (!el) return new Set();
  let arr = [];

  // We'll prefer dataset.baseAbilities if it exists.
  // Expecting it to be something like '["Haste","First Strike"]'
  try {
    if (el.dataset.baseAbilities) {
      const parsed = JSON.parse(el.dataset.baseAbilities);
      if (Array.isArray(parsed)) {
        arr = parsed.slice();
      }
    }
  } catch {
    // bad JSON? fine, fall back to empty
  }

  // Normalize capitalization for pills:
  const normed = arr
    .map(a => String(a || '').trim())
    .filter(Boolean)
    .map(a => a.replace(/\b\w/g, m => m.toUpperCase()));

  return new Set(normed);
}


function parseTypeBadges(typeline = '') {
  const [leftRaw = '', rightRaw = ''] = String(typeline).split(/—|-/);
  const leftTokens  = leftRaw.split(/\s+/).filter(Boolean);
  const rightTokens = rightRaw.split(/\s+/).filter(Boolean);

  const SUPER = new Set(['Legendary','Basic','Snow','World','Ongoing','Token','Tribal']);
  const CORE  = new Set(['Artifact','Creature','Enchantment','Instant','Land','Planeswalker','Sorcery','Battle']);

  const out = [];
  const seen = new Set();
  const push = (t) => {
    const k = String(t).trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };

  for (const t of leftTokens) if (SUPER.has(t)) push(t);
  for (const t of leftTokens) if (CORE.has(t))  push(t);
  for (const t of leftTokens) if (!SUPER.has(t) && !CORE.has(t)) push(t);
  for (const t of rightTokens) push(t);

  return out;
}

async function getGrantedFromStore(el){
  const cid = byCid(el);
  const out = {
    abilities: [], types: [], counters: [],
    grants: [],           // NEW
    _pow: undefined, _tou: undefined, _loyalty: undefined
  };

  // Local CardAttributes row (authoritative if present)
  try {
    //const mod = await import('./card.attributes.js');
    const row = mod.CardAttributes?.get?.(cid);
    if (row) {
      if (Array.isArray(row.abilities)) out.abilities = row.abilities.slice();
if (Array.isArray(row.types))     out.types     = row.types.slice();
if (Array.isArray(row.counters))  out.counters  = row.counters.slice();
if (Array.isArray(row.grants))    out.grants    = row.grants.slice();   // NEW
if (Array.isArray(row.buffs))     out.buffs     = row.buffs.slice();    // NEW: plain-text buffs like "Deathtouch EOT"


      out._pow = row.pow;
      out._tou = row.tou;

      // roll up loyalty...
      try {
        const loy = out.counters
          .filter(c => String(c?.kind || c?.name || '').toLowerCase() === 'loyalty')
          .reduce((s,c)=> s + (Number(c?.qty)||0), 0);
        if (Number.isFinite(loy)) out._loyalty = loy;
      } catch {}

      return out;
    }
  } catch {}

  // RTC remoteAttrs fallback
try {
  const raw = el.dataset.remoteAttrs ? JSON.parse(el.dataset.remoteAttrs) : null;

  // helpers: case-insensitive union for strings, and by-kind union for counters
  const _unionCI = (a = [], b = []) => {
    const seen = new Set(a.map(s => String(s).trim().toLowerCase()));
    const out  = a.slice();
    (b || []).forEach(s => {
      const t = String(s || '').trim();
      if (!t) return;
      const k = t.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(t); }
    });
    return out;
  };
  const _unionCounters = (a = [], b = []) => {
    const by = new Map();
    (a || []).forEach(c => {
      const k = String(c?.kind || c?.name || '').trim().toLowerCase();
      if (k) by.set(k, { kind: c.kind || c.name, qty: Number(c.qty || 0) });
    });
    (b || []).forEach(c => {
      const k = String(c?.kind || c?.name || '').trim().toLowerCase();
      if (!k) return;
      // NEW should overwrite OLD
      by.set(k, { kind: c.kind || c.name, qty: Number(c.qty || 0) });
    });
    return Array.from(by.values());
  };
  const _mergeGrants = (a = [], b = []) => {
    const by = new Map();
    const key = s => String(s || '').trim().toLowerCase();
    (a || []).forEach(g => { if (g?.name) by.set(key(g.name), g); });
    (b || []).forEach(g => { if (g?.name) by.set(key(g.name), g); }); // remote wins
    return Array.from(by.values());
  };

  if (raw) {
    if (Array.isArray(raw.abilities)) out.abilities = _unionCI(out.abilities, raw.abilities);
    if (Array.isArray(raw.types))     out.types     = _unionCI(out.types,     raw.types);
    if (Array.isArray(raw.counters))  out.counters  = _unionCounters(out.counters, raw.counters);
    if (Array.isArray(raw.grants))    out.grants    = _mergeGrants(out.grants, raw.grants); // keep both Elf & Wizard
    if (Array.isArray(raw.buffs))     out.buffs     = raw.buffs.slice(); // legacy passthrough

    if (raw.pt && typeof raw.pt === 'string'){
        const [p,t] = raw.pt.split('/').map(x=>Number(x));
        if (Number.isFinite(p)) out._pow = p;
        if (Number.isFinite(t)) out._tou = t;
      }

      try {
        const loy = out.counters
          .filter(c => String(c?.kind || c?.name || '').toLowerCase() === 'loyalty')
          .reduce((s,c)=> s + (Number(c?.qty)||0), 0);
        if (Number.isFinite(loy)) out._loyalty = loy;
      } catch {}
    }
  } catch {}

  return out;
}


function toPill(text){
  const s = String(text || '').trim();
  if (!s) return null;
  const pill = document.createElement('div');
  pill.textContent = s;
  pill.style.cssText = `
    display:inline-flex; align-items:center; gap:6px;
    padding:6px 10px; border-radius:10px; border:1px solid var(--ui-border);
    background:linear-gradient(180deg, var(--ui-deep-3), var(--ui-deep-2));
    white-space:nowrap;
  `;
  return pill;
}

// Infer duration from short text tokens if no structured duration is present.
function _inferDurFromText(s){
  const t = String(s || '').toUpperCase();
  if (!t) return '';
  if (/\(E\)|\bUNTIL END OF TURN\b|\bTHIS TURN\b/.test(t)) return 'EOT';
  if (/\(L\)|\bLINKED\b|\bLINKED SOURCE\b/.test(t))        return 'SOURCE';
  return '';
}


/**
 * Extract *structured* adds from RulesStore tempBuffs.
 * We only trust explicit fields on the buff objects to avoid false positives.
 * Supported shapes (any optional):
 *   - b.typeAdd or b.type      -> push to types
 *   - b.ability                -> push to abilities
 *   - b.counter {kind|name, qty|amount} -> push to counters
 */
function _extractRulesAdds(buffs){
  // Now carries duration so we can suffix pills like "(E)" / "(L)"
  // Shape:
  //   out.types     = [ { name, duration }, ... ]
  //   out.abilities = [ { name, duration }, ... ]
  //   out.counters  = [ { kind, qty } ]  (unchanged)
  const out = { types: [], abilities: [], counters: [] };
  if (!Array.isArray(buffs)) return out;

  const normDur = (b) => {
    // 1) explicit field wins
    const dRaw = String(b?.duration || '').trim().toUpperCase();
    if (dRaw) return dRaw;

    // 2) structured flags
    if (b?.untilEOT || b?.untilEndOfTurn) return 'EOT';
    if (b?.linkedSource || b?.sourceCid || b?.source) return 'SOURCE';

    // 3) textual shorthands in b.text (e.g., "Flying (E)" or "(L)")
    const txt = String(b?.text || '').toUpperCase();
    if (/\(E\)|\bUNTIL END OF TURN\b|\bTHIS TURN\b/.test(txt)) return 'EOT';
    if (/\(L\)|\bLINKED\b|\bLINKED SOURCE\b/.test(txt))        return 'SOURCE';

    return ''; // permanent/unspecified
  };


  for (const b of buffs){
    if (!b || typeof b !== 'object') continue;
    const duration = normDur(b);

    // types
    const t1 = (b.typeAdd != null) ? String(b.typeAdd).trim() : '';
    const t2 = (b.type    != null) ? String(b.type).trim()    : '';
    if (t1) out.types.push({ name: t1, duration });
    if (t2) out.types.push({ name: t2, duration });

    // abilities
    const a = (b.ability != null) ? String(b.ability).trim() : '';
    if (a) out.abilities.push({ name: a, duration });

    // counters (no duration—counters display as plain “Kind ×N”)
    const c = (b.counter && typeof b.counter === 'object') ? b.counter : null;
    if (c){
      const kind = String(c.kind || c.name || '').trim();
      const qty  = Number(c.qty ?? c.amount ?? 0);
      if (kind && Number.isFinite(qty) && qty !== 0){
        out.counters.push({ kind, qty });
      }
    }
  }
  return out;
}




// ensurePanelFor --------------------------------------------------------------
function ensurePanelFor(el){
  const cid = byCid(el); if (!cid) return null;

  let info = store.get(cid);
  if (
    info?.panel && document.body.contains(info.panel) &&
    info?.sticker && document.body.contains(info.sticker) &&
    info?.btnWand && document.body.contains(info.btnWand) &&
    info?.btnTap  && document.body.contains(info.btnTap)
  ){
    return info;
  }

  if (!info) {
    info = {
      panel:null,
      sticker:null,
      btnWand:null,
      btnTap:null,
      buffWrap:null,
      raf:0,
      anchor:el,
      sig:'',
    };
  }

  // RIGHT panel
  if (!info.panel){
    const panel = document.createElement('div');
    panel.className = 'badge-panel';
    panel.dataset.cid = cid;
    panel.style.cssText = `
      position:fixed; left:0; top:0;
      max-width:${PANEL_MAX_WIDTH}px;
      background:transparent;
      border:none;
      box-shadow:none;
      padding:0;
      border-radius:0;
      color:var(--ui-text);
      font: 600 13px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      display:flex; flex-direction:column; gap:6px; z-index:900;
      pointer-events:none;
      transform-origin: left center;
    `;
    panel.innerHTML = `<div class="rows" style="display:flex; flex-direction:column; gap:8px;"></div>`;
    document.body.appendChild(panel);
    info.panel = panel;
  }

  // P/T sticker
  if (!info.sticker){
    const st = document.createElement('div');
    st.className = 'pt-sticker';
    st.dataset.cid = cid;
    st.textContent = '';
    st.style.cssText = `
  position:fixed; z-index:900; pointer-events:none;
  background:linear-gradient(180deg, var(--ui-deep-3), var(--ui-deep-2));
  color:var(--ui-text); border:1px solid var(--ui-border);
  border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,.45);
  font-weight:900; font-variant-numeric: tabular-nums;
  padding:4px 8px; min-width:44px; text-align:center;
  transform:translateZ(0); transform-origin: left top; /* top-left anchoring */
  display:none;
`;

    document.body.appendChild(st);
    info.sticker = st;

    // Loyalty sticker (gold)
    if (!info.loySticker){
      const ls = document.createElement('div');
      ls.className = 'loy-sticker';
      ls.dataset.cid = cid;
      ls.textContent = '';
      ls.style.cssText = `
        position:fixed; z-index:900; pointer-events:none;
        background:linear-gradient(180deg, rgba(60,45,10,.9), rgba(40,30,8,.9));
        color:#fff; border:1px solid #fbbf24; /* amber-400 */
        border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,.45);
        font-weight:900; font-variant-numeric: tabular-nums;
        padding:4px 8px; min-width:32px; text-align:center;
        transform:translateZ(0); transform-origin: left top;
        display:none;
      `;
      document.body.appendChild(ls);
      info.loySticker = ls;
    }

  }

  // Buff bubble
  if (!info.buffWrap){
    const bw = _ensureBuffWrap(el);
    info.buffWrap = bw || null;
  }

  // LEFT floating buttons (🪄 and {T})
  if (!info.btnWand || !info.btnTap){
    const makeBtn = (label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.cid = cid;
      b.style.cssText = `
        position:fixed; z-index:900;
        width:${LBTN_SIZE_BASE}px; height:${LBTN_SIZE_BASE}px;
        border-radius:999px; display:flex; align-items:center; justify-content:center;
        border:1px solid var(--ui-border);
        background:linear-gradient(180deg, var(--ui-deep-3), var(--ui-deep-2));
        color:var(--ui-text); font-weight:800; font-size:16px;
        box-shadow:0 8px 24px rgba(0,0,0,.45);
        cursor:pointer; pointer-events:auto;
        transform:translateZ(0);
        /* NOTE: transform-origin is set per button (left/right) below */
        user-select:none;
      `;
      b.addEventListener('mousedown', e => e.stopPropagation());
      b.addEventListener('touchstart', e => { e.stopPropagation(); }, { passive:false });
      return b;
    };

    // Wand
const btnWand = makeBtn('🪄');
btnWand.title = 'Abilities / Attributes';
// Anchor to TOP-LEFT so vertical top baseline never moves while scaling
btnWand.style.transformOrigin = 'left top';


    btnWand.addEventListener('click', async (e) => {
      e.stopPropagation();
      async function tryImport(relPath) {
        const url = new URL(relPath, import.meta.url).href;
        //console.log('[Badges] tryImport ->', url);
        try { const mod = await import(/* @vite-ignore */ url); return mod || {}; }
        catch (err) { console.warn('[Badges] import failed:', url, err); return {}; }
      }
      const candidates = [
        './card.attributes.overlay.ui.js',
        './card.attributes.overlay.js',
        '../modules/card.attributes.overlay.ui.js',
        '../modules/card.attributes.overlay.js',
        './overlay/card.attributes.overlay.ui.js',
        './overlay/card.attributes.overlay.js',
      ];
      function pickOpenFn(mod) {
        if (!mod) return null;
        if (mod.CardOverlayUI) {
          mod.CardOverlayUI.mount?.();
          return mod.CardOverlayUI.openForCard || mod.CardOverlayUI.openFor || null;
        }
        if (typeof mod.openForCard === 'function') return mod.openForCard;
        return null;
      }
      async function injectScript(relPath) {
        const url = new URL(relPath, import.meta.url).href;
        return new Promise((resolve) => {
          //console.log('[Badges] injecting module script ->', url);
          const s = document.createElement('script');
          s.type = 'module';
          s.crossOrigin = 'anonymous';
          s.onload = () => resolve(true);
          s.onerror = () => resolve(false);
          s.textContent = `
            import * as M from '${url}';
            (window.CardOverlayUI?.mount||M.CardOverlayUI?.mount)?.();
            window.CardOverlayUI = window.CardOverlayUI || M.CardOverlayUI || M.default || window.CardOverlayUI;
          `;
          document.head.appendChild(s);
        });
      }

      try {
        let openFn = null;
        let loadedFrom = null;
        for (const rel of candidates) {
          const mod = await tryImport(rel);
          openFn = pickOpenFn(mod);
          if (openFn) { loadedFrom = rel; break; }
        }
        if (!openFn) {
          for (const rel of candidates) {
            const ok = await injectScript(rel);
            if (ok && window.CardOverlayUI?.openForCard) {
              window.CardOverlayUI.mount?.();
              openFn = window.CardOverlayUI.openForCard;
              loadedFrom = rel + ' (injected)';
              break;
            }
          }
        }
        if (!openFn) {
          window.CardOverlayUI?.mount?.();
          openFn = window.CardOverlayUI?.openForCard
                || window.CardAttributesOverlay?.openFor;
          if (openFn) loadedFrom = 'global window.*';
        }
        if (!openFn) throw new Error('No overlay module found');

        //console.log('[Badges] overlay opener ready from:', loadedFrom);
        openFn(el);
      } catch (err) {
       // console.error('[Badges] overlay open failed:', err);
      }
    });

    // Tap
const btnTap = makeBtn('{T}');
btnTap.title = 'Tap / Untap';
// Anchor to TOP-RIGHT so vertical top baseline never moves while scaling
btnTap.style.transformOrigin = 'right top';


    btnTap.dataset.mana = '{T}';
    try {
      if (window.manaCostHtml) {
        btnTap.innerHTML = window.manaCostHtml('{T}');
      } else if (window.ManaMaster?.renderInline) {
        window.ManaMaster.renderInline(btnTap, '{T}');
      }
    } catch {}

    btnTap.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cid = byCid(el);
      const nowTapped = !(el.dataset.tapped === '1' || el.classList.contains('is-tapped'));

      // snapshot for lock
      const snap = el.getBoundingClientRect();
      info.lockRect  = { left:snap.left, top:snap.top, right:snap.right, bottom:snap.bottom, width:snap.width, height:snap.height };
      info.lockUntil = (performance.now ? performance.now() : Date.now()) + TAP_LOCK_MS;

      let handled = false;
      try {
        if (window.CardActions?.tapUntap) { ensureTapAnimCSS(); el.classList.add('tap-anim'); window.CardActions.tapUntap(el, nowTapped); handled = true; }
        else if (window.tapCard)          { ensureTapAnimCSS(); el.classList.add('tap-anim'); window.tapCard(el, nowTapped); handled = true; }
      } catch {}

      if (!handled) animateTap(el, nowTapped);

      try {
        const owner = (window.mySeat?.() ?? 1);
        (window.rtcSend || window.peer?.send)?.({ type:'tap', cid, tapped: nowTapped ? 1 : 0, owner });
      } catch {}
    });

    document.body.appendChild(btnWand);
    document.body.appendChild(btnTap);

    // Let ManaMaster colorize glyph if available
    try { window.ManaMaster?.scan?.(btnTap); } catch {}

    info.btnWand = btnWand;
    info.btnTap  = btnTap;
  }

  store.set(cid, info);
  return info;
}


// rules.store.js hydration ----------------------------------------------------
async function hydrateFromRulesStore(info, el){
  const cid = byCid(el);
  if (!cid) return;

  let Rules = null;
  try {
    const mod = await import('./rules.store.js');
    Rules = mod.RulesStore || mod.default || null;
  } catch {
    Rules = null;
  }
  if (!Rules || !Rules.resolveForCard) {
    try { _rebuildBuffRows(el, null); } catch {}
    return;
  }

  const snap = Rules.resolveForCard(cid);
  if (!snap) {
    // ensure we don't keep an old PT from a prior render
    info.__rulesPT   = null;
    info.__rulesBuffs = [];
    try { _rebuildBuffRows(el, null); } catch {}
    return;
  }


  info.__rulesPT = {
    powFinal: snap.powFinal,
    touFinal: snap.touFinal,
    powBase:  snap.powBase,
    touBase:  snap.touBase
  };
  info.__rulesBuffs = Array.isArray(snap.tempBuffs) ? snap.tempBuffs.slice() : [];

  try { _rebuildBuffRows(el, info); } catch {}
}


// panel render ----------------------------------------------------------------

// NOTE: abilities come ONLY from two places now:
//  1. dataset.baseAbilities (stamped at deck load / spawn time, first-line keywords only)
//  2. granted abilities from CardAttributes / remoteAttrs (player-added stuff)
//
// We do NOT scrape oracle text anymore. That was causing false positives like
// giving "First Strike" just because "first strike" showed up in reminder text
// for "Double strike". That is dead forever.

function renderPanel(el, info){
  // ensure rows container exists, then clear it for fresh render
  let rows = info.panel.querySelector('.rows');
  if (!rows) {
    info.panel.innerHTML = `<div class="rows" style="display:flex; flex-direction:column; gap:8px;"></div>`;
    rows = info.panel.querySelector('.rows');
  }
  rows.innerHTML = '';

  // render counter
  let count = 0;

  // pull what we know about the card itself
  const typeLine = el.dataset.typeLine || '';

  // TYPES (BASE)
  let baseTypesArr = [];
  try {
    if (el.dataset.baseTypes) {
      const parsedT = JSON.parse(el.dataset.baseTypes);
      if (Array.isArray(parsedT)) {
        baseTypesArr = parsedT
          .slice()
          .map(t => String(t).trim())
          .filter(Boolean);
      }
    }
  } catch {}
  if (!baseTypesArr.length) {
    baseTypesArr = parseTypeBadges(typeLine);
  }

  // BASE ABILITIES (strict, from dataset.baseAbilities)
  let baseAbilitiesSet = readBaseAbilities(el); // Set([...]) or empty Set()
  if (!(baseAbilitiesSet instanceof Set)) baseAbilitiesSet = new Set();

  // GRANTS FROM CARD ATTRIBUTES / RTC
  const grant = info.__grant || { abilities: [], types: [], counters: [], grants: [], _pow:undefined, _tou:undefined, _loyalty:undefined };

  // TEMPORARY BUFFS FROM RULES STORE (WITH DURATION)
  const rulesAdds = _extractRulesAdds(info?.__rulesBuffs);

  // Helpers
  const titleCase = s => String(s||'').trim().replace(/\s+/g,' ').replace(/\b\w/g, m => m.toUpperCase());
  const suffixFor = (dur) => (String(dur||'').toUpperCase() === 'EOT' ? ' (E)'
                   : String(dur||'').toUpperCase() === 'SOURCE' ? ' (L)'
                   : '');

  // Build final base type list
  const finalTypeList = baseTypesArr.slice();

  // Legacy granted types (no duration)
  const legacyGrantedTypes = (Array.isArray(grant.types) ? grant.types : [])
    .map(t => String(t).trim()).filter(Boolean);

  // Legacy granted abilities (no duration, Title Case)
  const legacyGrantedAbilities = (Array.isArray(grant.abilities) ? grant.abilities : [])
    .map(a => titleCase(a)).filter(Boolean);

  // Duration-based adds from RulesStore
  const durTypesFromRules = (rulesAdds.types || []).map(o => ({ name: titleCase(o.name), duration: o.duration || '' }));
  const durAbilsFromRules = (rulesAdds.abilities || []).map(o => ({ name: titleCase(o.name), duration: o.duration || '' }));

  // Duration-based grants from CardAttributes.grants
const durGrantsFromAttrs = (Array.isArray(grant.grants) ? grant.grants : [])
  .map(g => ({
    kind: String(g?.kind || 'ability'),
    name: titleCase(g?.name || ''),
    duration: String(g?.duration || '').toUpperCase(),
    source: g?.source
  }))
  .filter(g => g.name);



  // 🔹 Seed a local name→duration map so legacy strings can pick up durations
  const _durByName = new Map();
  for (const a of durAbilsFromRules)  { if (a?.name) _durByName.set(a.name, a.duration || ''); }
  for (const g of durGrantsFromAttrs) { if (g?.name) _durByName.set(g.name, g.duration || ''); }

  // Dedup tracking (canonical keys for dedup ONLY; never used for display)
  const canon = s => String(s || '').trim().toLowerCase();


  // For types/abilities we seed "seen" with canonical forms of base lists
  const seenBaseType = new Set(finalTypeList.map(t => canon(t)));
  const seenBaseAbil = new Set(Array.from(baseAbilitiesSet, a => canon(a)));

  // 🔹 NEW: cross-source pill deduper (prevents duplicates across RulesStore/Attrs/etc.)
  const seenPill = new Set();
  const makeKey = (kind, name, dur='') => `${kind}|${canon(name)}|${String(dur||'').toUpperCase()}`;
  const appendPillUnique = (rowsEl, kind, name, dur='', sourceCid=null) => {
    const key = makeKey(kind, name, dur);
    if (seenPill.has(key)) return false;
    seenPill.add(key);
    const pill = dur ? toDurPill(name, dur, sourceCid) : toPill(name);
    if (pill) rowsEl.appendChild(pill);
    return !!pill;
  };


  // ---- RENDER TYPES (BASE) -------------------------------------------------
  if (Array.isArray(finalTypeList) && finalTypeList.length) {
    for (const tRaw of finalTypeList) {
      const t = String(tRaw).trim();
      if (!t) continue;
      // Mark as seen for both base-type dedupe AND cross-source pill dedupe
      seenPill.add(makeKey('type', t, ''));
      const pill = toPill(t);
      if (pill) { rows.appendChild(pill); count++; }
    }
  }

  // ---- RENDER ABILITIES (BASE) ---------------------------------------------
  if (baseAbilitiesSet && baseAbilitiesSet.size) {
    for (const aRaw of baseAbilitiesSet) {
      const a = String(aRaw).trim();
      if (!a) continue;
      // Mark as seen for both base-ability dedupe AND cross-source pill dedupe
      seenPill.add(makeKey('abil', a, ''));
      const pill = toPill(a);
      if (pill) { rows.appendChild(pill); count++; }
    }
  }


  // Small helper to make a duration pill with optional (L) click (for linked SOURCE)
  function toDurPill(name, duration, sourceCid){
    const sfx = suffixFor(duration);
    const pill = document.createElement('div');
    pill.style.cssText = `
      display:inline-flex; align-items:center; gap:6px;
      padding:6px 10px; border-radius:10px; border:1px solid var(--ui-border);
      background:linear-gradient(180deg, var(--ui-deep-3), var(--ui-deep-2));
      white-space:nowrap;
    `;
    const label = document.createElement('span');
    label.textContent = name;
    pill.appendChild(label);
    if (sfx) {
      const suf = document.createElement('span');
      suf.textContent = sfx;
      suf.style.cssText = 'opacity:.9; font-weight:700; cursor:' + (String(duration).toUpperCase()==='SOURCE' ? 'pointer' : 'default');
      if (String(duration).toUpperCase()==='SOURCE' && sourceCid){
        suf.title = 'Show the linked source';
        suf.addEventListener('click', (ev)=>{
          ev.stopPropagation();
          try {
            const srcEl = document.querySelector(`img.table-card[data-cid="${sourceCid}"]`);
            if (srcEl && window.Tooltip?.showForCard) {
              window.Tooltip.showForCard(srcEl, srcEl, { mode:'right' });
            } else if (srcEl) {
              srcEl.style.outline = '2px solid #61d095';
              setTimeout(()=> srcEl.style.outline = '', 700);
            }
          } catch {}
        });
      }
      pill.appendChild(suf);
    }
    return pill;
  }

  // ---- RENDER LEGACY GRANTED TYPES (no duration metadata) -------------------
// DISABLED: Type pills must come from RulesStore so EOT / Linked cleanup works.
// (We still accept base typeline and RulesStore duration types below.)
/* no-op */


  // ---- RENDER RULES TYPES WITH DURATION ------------------------------------
for (const t of durTypesFromRules){
  if (appendPillUnique(rows, 'type', t.name, t.duration)) { count++; }
}

// ---- RENDER ATTRS TYPE-GRANTS (persistent or with duration) --------------
// We now allow structured type-grants from CardAttributes/remoteAttrs.grants.
// This enables persistent “Copy” and “Token” pills for spawned copies.
for (const g of durGrantsFromAttrs){
  if (String(g.kind||'').toLowerCase() !== 'type') continue;
  // g.duration: '' (persistent), 'EOT', or 'SOURCE'
  if (appendPillUnique(rows, 'type', g.name, g.duration || '', g.source || null)) { count++; }
}


  // ---- RENDER LEGACY GRANTED ABILITIES (no duration metadata) --------------
  for (const aRaw of legacyGrantedAbilities){
    const a = String(aRaw).trim();
    if (!a || seenBaseAbil.has(canon(a))) continue;

    // Detect trailing "(E)" or "(L)" if already present in the raw string
    const m = a.match(/^(.*?)(?:\s*\((E|L)\))?$/i);
    const name = (m && m[1]) ? m[1].trim() : a;
    let dur    = (m && m[2]) ? (m[2].toUpperCase() === 'E' ? 'EOT' : 'SOURCE') : '';

    // If no explicit tag, try structured lookups, then raw text inference
    if (!dur) dur = _durByName.get(name) || _inferDurFromText(name);

    seenBaseAbil.add(canon(a));
    if (appendPillUnique(rows, 'abil', name, dur)) { count++; }
  }

  // ---- RENDER RULES ABILITIES WITH DURATION --------------------------------
  for (const a of durAbilsFromRules){
    if (appendPillUnique(rows, 'abil', a.name, a.duration)) { count++; }
  }

  // ---- RENDER ATTRS.GRANTS WITH DURATION + LINKED SOURCE -------------------
// Only render ability-style grants from attrs; type grants must mirror RulesStore.
// This ensures type adds vanish when RulesStore clears them.
for (const g of durGrantsFromAttrs){
  if (String(g.kind).toLowerCase() === 'type') continue; // ignore type grants from attrs
  if (appendPillUnique(rows, 'abil', g.name, g.duration, g.source || null)) { count++; }
}




  // --- COUNTERS (loyalty / +1/+1 / etc.) ---  [DEDUPED + GUARDED]
  const countersArr = Array.isArray(info?.__grant?.counters)
    ? info.__grant.counters
    : [];

  // Build a map by kind (lowercased) so we never render duplicates,
  // and the last write wins if something upstream double-pushes.
  const byKind = new Map();
  for (const c of countersArr) {
    const kind = String(c?.kind || c?.name || '').trim();
    const qty  = Number(c?.qty || 0);
    if (!kind || !Number.isFinite(qty) || qty === 0) continue;
    byKind.set(kind.toLowerCase(), { kind, qty });
  }

  // 🔹 merge RulesStore counters (temporary)
  for (const c of (rulesAdds.counters || [])) {
    const kind = String(c?.kind || c?.name || '').trim();
    const qty  = Number(c?.qty || 0);
    if (!kind || !Number.isFinite(qty) || qty === 0) continue;
    byKind.set(kind.toLowerCase(), { kind, qty });
  }

  // Synthetic Loyalty only if not already present
  const hasLoyCounter = byKind.has('loyalty');
  if (!hasLoyCounter) {
    const loyText = liveLOY(el, info.__grant);
    const loyNum = Number(loyText);
    if (Number.isFinite(loyNum) && loyNum > 0) {
      byKind.set('loyalty', { kind: 'Loyalty', qty: loyNum });
    }
  }

  // ---- RENDER COUNTERS ---------------------------------------------
  for (const { kind, qty } of byKind.values()) {
    const label = `${kind} ×${qty}`;
    const pill = toPill(label);
    if (pill) {
      rows.appendChild(pill);
      count++;
    }
  }

  info.panel.style.display = count ? '' : 'none';
  info.__hasRows = count > 0;
  return count;
}






// sticker helpers -------------------------------------------------------------
function livePT(el, grant){
  const hasGrantPT = Number.isFinite(grant?._pow) && Number.isFinite(grant?._tou);
  if (hasGrantPT) return `${grant._pow|0}/${grant._tou|0}`;

  const baseP = el.dataset.power, baseT = el.dataset.toughness;
  const faceHasBasePT = (baseP != null && baseP !== '' && baseT != null && baseT !== '');

  if (faceHasBasePT) {
    if (el.dataset.ptCurrent) return String(el.dataset.ptCurrent);
    return `${baseP}/${baseT}`;
  }

  return '';
}

function liveLOY(el, grant){
  // 1) CardAttributes/remote grant roll-up takes precedence if present
  if (grant && Number.isFinite(grant._loyalty)) {
    return String(grant._loyalty|0);
  }
  // 2) dataset current → base
  const cur = el?.dataset?.loyaltyCurrent;
  if (cur != null && String(cur).trim() !== '') return String(cur).trim();
  const base = el?.dataset?.loyalty;
  if (base != null && String(base).trim() !== '') return String(base).trim();
  return '';
}

function isPlaneswalkerLike(info, el){
  const baseTypesArr   = parseTypeBadges(el?.dataset?.typeLine || '');
  const grantTypesArr  = Array.isArray(info?.__grant?.types) ? info.__grant.types : [];
  const all = [...baseTypesArr, ...grantTypesArr].map(t => String(t).toLowerCase());
  return all.includes('planeswalker');
}


function isCreatureLike(info, el){
  if (!el) return false;

  // 1. Read the live types off the CURRENT FACE (plus any granted types).
  //    This reflects flips/transforms. If it's now "Enchantment — Aura",
  //    this array will NOT contain "Creature".
  const baseTypesArr = parseTypeBadges(el.dataset.typeLine || '');
  const grantTypesArr = Array.isArray(info?.__grant?.types)
    ? info.__grant.types.slice()
    : [];

  const allTypesLower = [...baseTypesArr, ...grantTypesArr].map(t => String(t).toLowerCase());

  // 2. Only show a sticker if it's explicitly creature-ish *right now*.
  //    We do NOT fall back to "but RulesStore still has 13/13" because
  //    that lets an Aura keep a power/toughness bubble.
  const creatureishKeywords = ['creature','vehicle'];
  for (const keyword of creatureishKeywords){
    if (allTypesLower.includes(keyword)) {
      return true;
    }
  }

  // If the current face isn't creature/vehicle, it's not creature-like.
  // Even if RulesStore/grants still have PT numbers from before.
  return false;
}



// FOLLOW LOOP -----------------------------------------------------------------
function followLoop(info){
  if (!info) return;
  const el = info.anchor;

  if (!el || !document.body.contains(el)) {
    if (info.raf) cancelAnimationFrame(info.raf);
    info.raf = 0;
    return;
  }
  if (typeof info.__visible !== 'boolean') info.__visible = false;

  const tick = () => {
    if (!el || !document.body.contains(el)) { info.raf = 0; return; }

    // lock position during tap anim
    const liveRect = el.getBoundingClientRect();
    const now = performance.now ? performance.now() : Date.now();
    if (info.lockUntil && now > info.lockUntil) {
      info.lockRect = null;
      info.lockUntil = 0;
    }
    const r = info.lockRect ? info.lockRect : liveRect;

    // visibility gate
    const vp = {
      left:   VIS_EDGE_PAD,
      top:    VIS_EDGE_PAD,
      right:  window.innerWidth  - VIS_EDGE_PAD,
      bottom: window.innerHeight - VIS_EDGE_PAD
    };
    const ix = Math.max(0, Math.min(r.right, vp.right) - Math.max(r.left, vp.left));
    const iy = Math.max(0, Math.min(r.bottom, vp.bottom) - Math.max(r.top, vp.top));
    const interArea = ix * iy;
    const visRatio  = interArea / Math.max(1, r.width * r.height);

    if (!info.__visible && visRatio >= VIS_SHOW_RATIO) info.__visible = true;
    if (info.__visible && visRatio <= VIS_HIDE_RATIO)  info.__visible = false;

    if (!info.__visible) {
  info.panel.style.display   = 'none';
  info.sticker.style.display = 'none';
  if (info.loySticker) info.loySticker.style.display = 'none';
  if (info.buffWrap)  info.buffWrap.style.display  = 'none';
  if (info.btnWand)   info.btnWand.style.display   = 'none';
  if (info.btnTap)    info.btnTap.style.display    = 'none';
  info.raf = requestAnimationFrame(tick);
  return;
} else {
  info.panel.style.display = info.__hasRows ? '' : 'none';
  if (info.loySticker) info.loySticker.style.display = '';
  if (info.buffWrap)  info.buffWrap.style.display  = '';
  if (info.btnWand)   info.btnWand.style.display   = '';
  if (info.btnTap)    info.btnTap.style.display    = '';
}


    // --- SCALING
    // base scale from physical card height vs 180
    const baseScale = r.height / 180;
    // user tuning multipliers from Settings Draft (live-preview!)
    const userPanelScale    = cfgBadgePanelScale();
    const userStickerScale  = cfgPTScale();

    let sPanelRaw   = baseScale;
    let sStickerRaw = baseScale;

    // clamp raw
    sPanelRaw   = clamp(sPanelRaw,   PANEL_SCALE_MIN,   PANEL_SCALE_MAX);
    sStickerRaw = clamp(sStickerRaw, STICKER_SCALE_MIN, STICKER_SCALE_MAX);

    // apply user multipliers
    const sPanel   = sPanelRaw   * userPanelScale;
    let   sSticker = sStickerRaw * userStickerScale;

    // tapped boost
    const isTapped = (el.dataset.tapped === '1') || el.classList.contains('is-tapped');
    if (isTapped) {
      sSticker = clamp(sSticker * TAPPED_STICKER_BOOST, STICKER_SCALE_MIN, STICKER_SCALE_MAX * TAPPED_STICKER_BOOST);
    }

    // --- RIGHT BADGE PANEL POSITION
info.panel.style.transform = `scale(${sPanel})`;

// Fade the RIGHT badge panel based on Camera zoom
{
  const camScale = (window.Camera?.state?.scale ?? 1);
  // Linear fade: 1.0 when camScale >= cutoff+range, 0.0 when camScale <= cutoff
  let alpha = (camScale - BADGE_FADE_CUTOFF) / BADGE_FADE_RANGE;
  alpha = clamp(alpha, 0, 1);
  info.panel.style.opacity = String(alpha);
}

// Fade STICKERS (P/T + Loyalty) and the buff bubble independently
{
  const camScale = (window.Camera?.state?.scale ?? 1);
  let alphaS = (camScale - STICKER_FADE_CUTOFF) / STICKER_FADE_RANGE;
  alphaS = clamp(alphaS, 0, 1);

  // PT sticker
  if (info.sticker) {
    info.sticker.style.opacity = String(alphaS);
  }
  // Loyalty sticker
  if (info.loySticker) {
    info.loySticker.style.opacity = String(alphaS);
  }
  // Buff bubble follows stickers so it fades with them too
  if (info.buffWrap) {
    info.buffWrap.style.opacity = String(alphaS);
  }
}



    // panel center Y target = card center
    const desiredCY = (r.top + r.bottom) / 2;
    const pH = info.panel.offsetHeight;
    const panelX = clamp(
      r.right + cfgBadgeOffsetX(),
      8,
      window.innerWidth - 8
    );
    const panelY = clamp(
      desiredCY - (pH / 2) + cfgBadgeOffsetY(),
      8,
      window.innerHeight - 8
    );

    info.panel.style.left = `${panelX}px`;
    info.panel.style.top  = `${panelY}px`;
    info.panel.style.right = '';
    info.panel.style.bottom = '';

    // --- LEFT/RIGHT BUTTONS BELOW CARD
    if (info.btnWand && info.btnTap){
      // buttons scale with panel scale so they "feel" locked to zoom
      const sButtons = baseScale * userPanelScale; // <-- no clamp, tracks the card exactly

      const sizeUnscaled = LBTN_SIZE_BASE;
      const btnY = clamp(
        r.bottom + LBTN_BOTTOM_GAP,
        8,
        window.innerHeight - sizeUnscaled - 8
      );

      // wand hugs left edge
      {
        const b = info.btnWand;
        b.style.transform = `translateZ(0) scale(${sButtons})`;
        const xLeft = clamp(
          r.left,
          8,
          window.innerWidth - sizeUnscaled - 8
        );
        b.style.left   = `${xLeft}px`;
        b.style.top    = `${btnY}px`;
        b.style.right  = '';
        b.style.bottom = '';
        b.style.display = info.__visible ? '' : 'none';
      }

      // tap hugs right edge
      {
        const b = info.btnTap;
        b.style.transform = `translateZ(0) scale(${sButtons})`;
        const xRight = clamp(
          r.right - sizeUnscaled,
          8,
          window.innerWidth - sizeUnscaled - 8
        );
        b.style.left   = `${xRight}px`;
        b.style.top    = `${btnY}px`;
        b.style.right  = '';
        b.style.bottom = '';
        b.style.display = info.__visible ? '' : 'none';
      }
    }

    // --- PT STICKER
    // compute text + colorOverride
    let text = '';
    let colorOverride = '';

    try {
      if (info.__rulesPT
          && Number.isFinite(info.__rulesPT.powFinal)
          && Number.isFinite(info.__rulesPT.touFinal)) {

        const pf = info.__rulesPT.powFinal | 0;
        const tf = info.__rulesPT.touFinal | 0;

        const pb = Number.isFinite(info.__rulesPT.powBase) ? (info.__rulesPT.powBase|0) : pf;
        const tb = Number.isFinite(info.__rulesPT.touBase) ? (info.__rulesPT.touBase|0) : tf;

        const hasDelta = (pf !== pb) || (tf !== tb);

        // ✅ Only use RulesStore PT if it actually differs from base PT.
        if (hasDelta) {
          text = `${pf}/${tf}`;
          const boosted = (pf > pb) || (tf > tb);
          const nerfed  = (pf < pb) || (tf < tb);
          if (boosted) colorOverride = '#4ade80';
          if (nerfed)  colorOverride = '#f87171';
        }
      }


      if (!text && Number.isFinite(info?.__grant?._pow) && Number.isFinite(info?.__grant?._tou)) {
        const gp = info.__grant._pow|0;
        const gt = info.__grant._tou|0;
        text = `${gp}/${gt}`;
      }

      if (!text && typeof livePT === 'function') {
        text = livePT(el, info.__grant);
      }

      if (!text) {
        text = el?.dataset?.ptCurrent || '';
      }

      if (!text && window.CardAttributes?.get) {
        const rec = window.CardAttributes.get(el.dataset.cid);
        if (rec && Number.isFinite(rec.pow) && Number.isFinite(rec.tou)) {
          text = `${rec.pow|0}/${rec.tou|0}`;
        }
      }

      if (!text && el?.dataset?.power && el?.dataset?.toughness) {
        text = `${el.dataset.power|0}/${el.dataset.toughness|0}`;
      }
    } catch {}

    const shouldShowSticker = !!text && isCreatureLike(info, el);

    if (!shouldShowSticker) {
      info.sticker.style.display = 'none';
    } else {
      info.sticker.style.display = '';
      info.sticker.textContent = text;

      const boostedOrNerfedColor = colorOverride;

      const baseTextColor   = '#fff';
      const baseBorderColor = '#fff';

      info.sticker.style.color = boostedOrNerfedColor || baseTextColor;
      info.sticker.style.borderColor = boostedOrNerfedColor || baseBorderColor;
    }

    // Scale only via transform. Keep intrinsic metrics constant so offsetWidth/Height
// stay unscaled and our math (× sSticker) is exact.
info.sticker.style.transform = `translateZ(0) scale(${sSticker})`;
info.sticker.style.fontSize  = `18px`;
info.sticker.style.padding   = `4px 8px`;


// position sticker near card corner with user offsets
const inset = 6;
const stWUnscaled = info.sticker.offsetWidth;   // unscaled box
const stHUnscaled = info.sticker.offsetHeight;

const stWScaled = stWUnscaled * sSticker;
const stHScaled = stHUnscaled * sSticker;

// Because transform-origin is TOP-LEFT, compute top-left that yields a bottom-right hug
const sxBase = r.right  - stWScaled - inset;
const syBase = r.bottom - stHScaled - inset;

const sx = clamp(sxBase + cfgPTOffsetX(), 0, window.innerWidth  - stWScaled);
const sy = clamp(syBase + cfgPTOffsetY(), 0, window.innerHeight - stHScaled);

info.sticker.style.left = `${sx}px`;
info.sticker.style.top  = `${sy}px`;

// expose scale for buff bubble to match PT sticker’s visual size
info.__stickerScale = sSticker;


// expose scale for buff bubble
info.__stickerScale = sSticker;


    // --- LOYALTY STICKER (gold, bottom-right stacked above PT)
try {
  const loyText = liveLOY(el, info.__grant);     // '' if none
  const isPW    = isPlaneswalkerLike(info, el);  // planeswalker gate
  const showLOY = !!loyText && (isPW || el?.dataset?.loyalty || el?.dataset?.loyaltyCurrent);

  if (!showLOY) {
    if (info.loySticker) info.loySticker.style.display = 'none';
  } else {
    const ls = info.loySticker;
    if (ls) {
      // scale similar to PT, but keep its own knob
      let sLoy = clamp((r.height / 180), STICKER_SCALE_MIN, STICKER_SCALE_MAX) * cfgLOYScale();

ls.style.display = '';
ls.textContent   = loyText;

ls.style.color       = '#fff';
ls.style.borderColor = '#fbbf24';

// Same principle: transform handles visual scale; keep base metrics fixed
ls.style.transform = `translateZ(0) scale(${sLoy})`;
ls.style.fontSize  = `16px`;
ls.style.padding   = `4px 8px`;


// position at bottom-right, stacked just ABOVE the PT sticker (scale-aware)
const STACK_GAP = 4;

// Read unscaled sizes then convert to *visual* scaled sizes
const loyWUnscaled = ls.offsetWidth;
const loyHUnscaled = ls.offsetHeight;
const loyWScaled   = loyWUnscaled * sLoy;
const loyHScaled   = loyHUnscaled * sLoy;

// We already computed PT (sx, sy) and scaled dims (stWScaled, stHScaled) above
const lxBase = sx + (stWScaled - loyWScaled);   // right-align with scaled PT
const lyBase = sy - loyHScaled - STACK_GAP;     // stacked above scaled PT

const lx = clamp(lxBase + cfgLOYOffsetX(), 0, window.innerWidth  - loyWScaled);
const ly = clamp(lyBase + cfgLOYOffsetY(), 0, window.innerHeight - loyHScaled);

ls.style.left = `${lx}px`;
ls.style.top  = `${ly}px`;

    }
  }
} catch {}



    // buff bubble anchored to sticker
    try {
      if (info.buffWrap) {
        if (!info.buffWrap.childElementCount) {
          info.buffWrap.style.display = 'none';
        } else {
          info.buffWrap.style.display = info.__visible ? '' : 'none';
          _followBuffWrapViewport(info);
        }
      }
    } catch {}

    info.raf = requestAnimationFrame(tick);
  };

  if (info.raf) cancelAnimationFrame(info.raf);
  info.raf = requestAnimationFrame(tick);
}


// PUBLIC API ------------------------------------------------------------------
export const Badges = {

  attach(el){
    if (!el || !el.classList?.contains('table-card') || !el.dataset?.cid) return;

    try {
      const zoneEl = el.closest?.('[data-zone]');
      //onsole.log('%c[Badges.attach]', 'color:#6cf',
      // {
      //   cid: el.dataset.cid,
      //   name: el.dataset.name || el.title || el.alt || '',
      //   zone: zoneEl ? (zoneEl.dataset.zone || zoneEl.id || '') : null,
      //   isDeckVisual: !!(el.classList.contains('deck-visual') || el.dataset.deckVisual === '1'),
      //   src: el.currentSrc || el.src || ''
      // });
    } catch {}

    const info = ensurePanelFor(el);
    if (!info) return;
    info.anchor = el;

    // bind tap lock listeners once
    if (!info._boundTapLock) {
      info._boundTapLock = true;
      const onStart = (ev) => {
        if (ev.propertyName && ev.propertyName !== 'rotate' && ev.propertyName !== 'transform') return;
        const snap = el.getBoundingClientRect();
        info.lockRect  = { left:snap.left, top:snap.top, right:snap.right, bottom:snap.bottom, width:snap.width, height:snap.height };
        info.lockUntil = (performance.now ? performance.now() : Date.now()) + TAP_LOCK_MS;
      };
      const onEnd = () => {
        info.lockUntil = 0;
        info.lockRect  = null;
      };
      el.addEventListener('transitionstart', onStart);
      el.addEventListener('transitionend',   onEnd);
      info._tapLockStart = onStart;
      info._tapLockEnd   = onEnd;
    }

    followLoop(info);
  },

  detach(el) {
    const cid = byCid(el);
    if (!cid) {
      console.warn('[Badges.detach] no cid for element', el);
      return;
    }

    const info = store.get(cid);
    console.warn('[Badges.detach] cleaning up for cid:', cid, info);

    if (info) {
      stopRAF(info);

      try { info.panel?.remove(); }    catch {}
      try { info.sticker?.remove(); }  catch {}
      try { info.btnWand?.remove(); }  catch {}
      try { info.btnTap?.remove(); }   catch {}
      try { info.buffWrap?.remove(); } catch {}

      store.delete(cid);
    }

    try {
      document.querySelectorAll(
        '.card-badges, .pt-sticker, .buff-sticker-wrap, button'
      ).forEach(node => {
        const nodeCid = node.dataset?.cid || node.getAttribute('data-cid');
        if (nodeCid === cid) {
          console.warn('[Badges.detach] removing leftover overlay/button:', node);
          node.remove();
        }
      });
    } catch (err) {
      console.warn('[Badges.detach] fallback cleanup error:', err);
    }
  },

  async render(el){
    const cid = byCid(el); if (!cid) return;
    const info = ensurePanelFor(el);
    if (!info) return;

    await ensureHydratedDatasets(el);

    info.__grant = await getGrantedFromStore(el);

    await hydrateFromRulesStore(info, el);

    const shown = renderPanel(el, info);

    try {
     //console.log('%c[Badges.render]', 'color:#6cf', {
     //  cid,
     //  name: el.dataset.name || el.title || '',
     //  shown,
     //  hasType: !!(el.dataset.typeLine && el.dataset.typeLine.trim()),
     //  hasOracle: !!(el.dataset.oracle && el.dataset.oracle.trim()),
     //  basePT: `${el.dataset.power ?? ''}/${el.dataset.toughness ?? ''}`,
     //  currentPT: el.dataset.ptCurrent || '',
     //  grant: info.__grant,
     //  rulesPT: info.__rulesPT,
     //  buffs: info.__rulesBuffs
     //});
    } catch {}

    followLoop(info);

    if (!shown) {
      setTimeout(async () => {
        await ensureHydratedDatasets(el);
        info.__grant = await getGrantedFromStore(el);
        await hydrateFromRulesStore(info, el);
        const n = renderPanel(el, info);
        try {
         //console.log('%c[Badges.render:retry]', 'color:#6cf', {
         //  cid,
         //  name: el.dataset.name || el.title || '',
         //  shown: n
         //});
        } catch {}
        if (n) followLoop(info);
      }, 120);
    }
  },

  // Force a single card to recompute badges + sticker RIGHT NOW.
  refreshFor(cid){
    if (!cid) return;
    const info = store.get(cid);
    if (!info || !info.anchor || !document.body.contains(info.anchor)) return;
    Badges.render(info.anchor);
  },

  // Re-run followLoop for everything (position/scale sync).
  // This is what Settings preview should call whenever Draft sliders change.
  refreshAll(){
    for (const [,info] of store) {
      followLoop(info);
    }
  }
};

(function autoWatch(){
  const obs = new MutationObserver(muts=>{
    for (const m of muts){
      for (const n of m.addedNodes){
        if (n?.nodeType===1 && n.matches?.('img.table-card[data-cid]')) {
          try {
           // console.log('%c[Badges:auto]', 'color:#6cf',
           //   { cid: n.dataset.cid, name: n.dataset.name || n.title || '', src: n.currentSrc || n.src || '' });
          } catch {}
          Badges.attach(n);
          Badges.render(n);
        }
      }
    }
  });
  obs.observe(document.documentElement, { childList:true, subtree:true });
})();

window.Badges = Badges;


/* ------------------------------------------------------------------
   DEBUG / CONSOLE HELPERS
   ------------------------------------------------------------------
   These give you live inspection in DevTools:
   - cidUnderMouse()
   - badgesForCid(cid)
   - badgesUnderMouse()
------------------------------------------------------------------ */

// track last known mouse position so we can query what’s under it
;(function(){
  let _mx = 0;
  let _my = 0;

  window.addEventListener('mousemove', (e)=>{
    _mx = e.clientX;
    _my = e.clientY;
  }, {passive:true});

  // Helper: walk up DOM to find nearest .table-card[data-cid]
  function _findCardAtPoint(x, y){
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return el.closest?.('img.table-card[data-cid]') || null;
  }

  // 1) Get cid under the current mouse position.
  // Usage in console:
  //    cidUnderMouse()
  //
  window.cidUnderMouse = function cidUnderMouse(){
    const cardEl = _findCardAtPoint(_mx, _my);
    if (!cardEl) return null;
    return cardEl.dataset.cid || null;
  };

  // internal helper to summarize panel/buffs/etc for an info record
  function _summarizeInfo(info){
  if (!info) return null;
  const el = info.anchor;

  // TYPES
  const typeLine = el?.dataset?.typeLine || '';
  let baseTypeList = [];
  try {
    if (el?.dataset?.baseTypes) {
      const parsedT = JSON.parse(el.dataset.baseTypes);
      if (Array.isArray(parsedT)) {
        baseTypeList = parsedT
          .slice()
          .map(t => String(t).trim())
          .filter(Boolean);
      }
    }
  } catch {}
  if (!baseTypeList.length) {
    baseTypeList = parseTypeBadges(typeLine);
  }

  // ABILITIES
  // same strict rule: only deck-stamped + granted
  let abilSet = readBaseAbilities(el); // Set([...])
  if (!(abilSet instanceof Set)) {
    abilSet = new Set();
  }

  // granted (CardAttributes / remoteAttrs)
  const grant = info.__grant || { abilities: [], types: [] };

  // merge granted types
  const typeSeen = new Set(baseTypeList.map(t => String(t)));
  const mergedTypes = baseTypeList.slice();
  for (const t of (grant.types || [])) {
    const k = String(t).trim();
    if (k && !typeSeen.has(k)) {
      typeSeen.add(k);
      mergedTypes.push(k);
    }
  }

  // merge granted abilities (Title Case)
  for (const a of (grant.abilities || [])) {
    const k = String(a).trim();
    if (k) {
      abilSet.add(k.replace(/\b\w/g, m => m.toUpperCase()));
    }
  }

  // buffs/debuffs (unchanged)
  const buffsRaw = Array.isArray(info.__rulesBuffs) ? info.__rulesBuffs.slice() : [];
  const buffsPretty = buffsRaw.map(b => {
    const txt = String(b?.text || '').trim();
    if (!txt) return null;
    return txt;
  }).filter(Boolean);

  // final PT snapshot (unchanged)
  let finalPT = '';
  if (info.__rulesPT
      && Number.isFinite(info.__rulesPT.powFinal)
      && Number.isFinite(info.__rulesPT.touFinal)) {
    finalPT = `${info.__rulesPT.powFinal|0}/${info.__rulesPT.touFinal|0}`;
  } else if (Number.isFinite(info?.__grant?._pow) && Number.isFinite(info?.__grant?._tou)) {
    finalPT = `${info.__grant._pow|0}/${info.__grant._tou|0}`;
  } else if (el?.dataset?.ptCurrent) {
    finalPT = el.dataset.ptCurrent;
  } else if (
    el?.dataset?.power !== undefined &&
    el?.dataset?.power !== '' &&
    el?.dataset?.toughness !== undefined &&
    el?.dataset?.toughness !== ''
  ) {
    finalPT = `${el.dataset.power|0}/${el.dataset.toughness|0}`;
  }

  return {
    cid: el?.dataset?.cid || null,
    name: el?.dataset?.name || el?.title || el?.alt || '',
    types: mergedTypes,
    abilities: Array.from(abilSet),
    buffs: buffsPretty,
    ptFinal: finalPT,
    rulesPT: info.__rulesPT || null,
    grant: info.__grant || null
  };
}


  // 2) Given a cid, dump everything Badges knows for that card
  // Usage in console:
  //    badgesForCid("abc123")
  //
  window.badgesForCid = function badgesForCid(cid){
    if (!cid) return null;
    const info = (window.Badges && window.Badges._storeDebug)
      ? window.Badges._storeDebug(cid)
      : (function(){ return (window.__BadgesStoreShim && window.__BadgesStoreShim[cid]) || null; })();

    // fallback if we didn't expose _storeDebug yet:
    const realInfo = info || (function(){
      // try direct access to `store` Map inside this closure
      try {
        // `store` is in module scope, we can’t reach it from window unless we expose it.
        return null;
      } catch { return null; }
    })();

    return _summarizeInfo(realInfo);
  };

  // 3) Shortcut: what’s under the mouse RIGHT NOW, fully summarized?
  // Usage in console:
  //    badgesUnderMouse()
  //
  window.badgesUnderMouse = function badgesUnderMouse(){
    const cid = window.cidUnderMouse();
    if (!cid) return null;
    return window.badgesForCid(cid);
  };

  // ---- expose internal Map `store` in a read-only-ish way ----
  // We can't just leak the Map directly because it's module-scoped.
  // So we provide a little getter on Badges.
  if (!window.Badges._storeDebug) {
    window.Badges._storeDebug = function(cid){
      try {
        // `store` is closed over above in badges.js.
        // We create a bridge by referencing it here in-scope.
        return store.get(cid) || null;
      } catch {
        return null;
      }
    };
  }

  // Also expose a snapshot of EVERYTHING if you want to eyeball it:
  if (!window.Badges.dumpAllDebug) {
    window.Badges.dumpAllDebug = function(){
      const out = {};
      try {
        for (const [cid,info] of store.entries()) {
          out[cid] = _summarizeInfo(info);
        }
      } catch (err) {
        console.warn('[Badges.dumpAllDebug] failed', err);
      }
      return out;
    };
  }

})();

