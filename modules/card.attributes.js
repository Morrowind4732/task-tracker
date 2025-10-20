// ================================
// FILE: modules/card.attributes.js
// Card Attributes System (V1.2)
// ================================
// Adds editable per-card attributes (types, effects, counters, P/T mods, notes)
// synced via Supabase and rendered as floating overlays.
//
// Updates in V1.2:
// - Counters stack bottom-left (square rounded), PT stays bottom-right, effects/types bottom-center.
// - Icon + text for effects and counters via ManaMaster (<i class="ms ms-[slug]">), with normalization.
// - Prevent blank counter rows on reopen.
// - Overlays remain readable when zoomed out (inverse-scale).
// - Counter UI: decrement/increment buttons around the numeric field.
// - Watcher only refreshes PT per-frame; reapply happens on actual changes.
// ================================

import Overlays from './overlays.js';
import { supaReady } from './env.supabase.js';
let supabase = null;
supaReady.then(c => { supabase = c; });

// ──────────────────────────────────────────────────────────────────────────────
// PT helpers (unified & robust)
// ──────────────────────────────────────────────────────────────────────────────
// near the top (after helpers), add:
const SCALE_MAX = (window.CardAttrScaleMax ?? 3.25); // was 1.75; bump to 3.25 (tweakable)


function parseBasePTFromEl(el){
  const pick = (...keys) => {
    for (const k of keys){
      const v = el?.dataset?.[k] ?? el?.getAttribute?.(`data-${k}`);
      if (v != null) return String(v).trim();
    }
    return null;
  };
  const rawP = pick('baseP','basep','power','pow');
  const rawT = pick('baseT','baset','toughness','tgh');

  const toNum = (s)=>{
    if (s == null) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN; // "*" -> NaN
  };

  return { p: toNum(rawP), t: toNum(rawT) };
}

function tryNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}



function deepClone(o){
  // structuredClone if available (fast), else JSON fallback
  if (typeof structuredClone === 'function') return structuredClone(o);
  return JSON.parse(JSON.stringify(o ?? null));
}

// --- Minimal Scryfall fill (mirrors tooltip.js) ---
async function fetchMissingFieldsByName_CARDATTR(name){
  try{
    const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error('scryfall');
    const d = await res.json();
    const face = Array.isArray(d.card_faces) && d.card_faces[0] ? d.card_faces[0] : null;
    return {
      name: d.name || name,
      mana_cost: d.mana_cost || '',
      type_line: d.type_line || '',
      oracle_text: d.oracle_text || (face?.oracle_text || ''),
      power:      (d.power ?? face?.power ?? ''),
      toughness:  (d.toughness ?? face?.toughness ?? ''),
      loyalty:    (d.loyalty ?? face?.loyalty ?? ''),
    };
  }catch{ return null; }
}

// Auto-seed dataset so PT can render with no interaction.
// We only stamp P/T for real creatures.
async function autoSeedMissingPT(el, cid){
  if (!(el instanceof Element)) return;
  // Try to determine if we already have enough to render
  const name = el.dataset?.name || el.querySelector('img')?.alt || '';
  const tlFromDom = el.dataset?.type_line || '';
  const tlFromMeta = (window.Zones?.getCardDataById?.(cid)?.type_line) || '';
  const tl = tlFromDom || tlFromMeta;

  // If we already know it's a creature and either baseP/baseT or power/toughness exist, nothing to do.
  const alreadyCreature = /\bCreature\b/i.test(tl);
  const hasAnyPT = (el.dataset.power ?? '') !== '' || (el.dataset.baseP ?? '') !== '';
  if (alreadyCreature && hasAnyPT) return;

  // If Zones can give us OG P/T, stamp those first (fast path)
  try{
    const meta = window.Zones?.getCardDataById?.(cid);
    const mp = Number(meta?.ogpower);
    const mt = Number(meta?.ogtoughness);
    const mtl = String(meta?.type_line || '');
    if (mtl && !el.dataset.type_line) el.dataset.type_line = mtl;
    if (/\bCreature\b/i.test(mtl) && Number.isFinite(mp) && Number.isFinite(mt)){
      el.dataset.baseP = String(mp);
      el.dataset.baseT = String(mt);
      return;
    }
  }catch{}

  // Fallback: fetch by name (only if we know the name)
  if (!name) return;
  const filled = await fetchMissingFieldsByName_CARDATTR(name);
  if (!filled) return;

  if (!el.dataset.type_line && filled.type_line) el.dataset.type_line = filled.type_line;
  const isCreature = /\bCreature\b/i.test(filled.type_line || '');
  const hasPT = (filled.power ?? '') !== '' && (filled.toughness ?? '') !== '';
  if (isCreature && hasPT){
    // prefer baseP/baseT so later mods stack correctly
    el.dataset.baseP = String(filled.power);
    el.dataset.baseT = String(filled.toughness);
  }
  // Loyalty for planeswalkers
  if ((filled.loyalty ?? '') !== '') el.dataset.loyalty = String(filled.loyalty);
}



// Prefer stored original base; then DOM; then Snapshot OGs; then Snapshot P/T.
function resolveBasePT(cid, el, attrs){
  let p = tryNum(attrs?.ptMod?.ogpow);
  let t = tryNum(attrs?.ptMod?.ogtgh);

  if (!Number.isFinite(p) || !Number.isFinite(t)){
    const fromDom = parseBasePTFromEl(el);
    p = Number.isFinite(p) ? p : fromDom.p;
    t = Number.isFinite(t) ? t : fromDom.t;
  }

  if ((!Number.isFinite(p) || !Number.isFinite(t)) && window.Zones?.getCardDataById){
    const meta = window.Zones.getCardDataById(cid);
    if (meta){
      const mp = tryNum(meta.ogpower);
      const mt = tryNum(meta.ogtoughness);
      if (!Number.isFinite(p) && Number.isFinite(mp)) p = mp;
      if (!Number.isFinite(t) && Number.isFinite(mt)) t = mt;
      if (!Number.isFinite(p)) p = tryNum(meta.power);
      if (!Number.isFinite(t)) t = tryNum(meta.toughness);
    }
  }

  return { p, t };
}

function combinePT(baseP, baseT, attrs){
  const modP = Number(attrs?.ptMod?.pow ?? 0);
  const modT = Number(attrs?.ptMod?.tgh ?? 0);
  const p = Number.isFinite(baseP) ? baseP + modP : null;
  const t = Number.isFinite(baseT) ? baseT + modT : null;
  return { p, t };
}

// Always update ONE badge class: .cardAttrPT (matches CSS below)
function ensurePtBadge(el){
  let badge = el.querySelector('.cardAttrPT');
  if (!badge){
    badge = document.createElement('div');
    badge.className = 'cardAttrPT';
    el.appendChild(badge);
  }
  return badge;
}

// Small badge above the PT badge that shows temporary P/T deltas (EOT/Linked)
function ensurePtTempBadge(el){
  let badge = el.querySelector('.cardAttrPTTemp');
  if (!badge){
    badge = document.createElement('div');
    badge.className = 'cardAttrPTTemp';
    el.appendChild(badge);
  }
  return badge;
}


// ──────────────────────────────────────────────────────────────────────────────
// Icon + name helpers (ManaMaster)
// ──────────────────────────────────────────────────────────────────────────────

// Many common abilities and counters.
// Keys are normalized to lowercase, hyphen/space collapsed, etc.
const ICON_MAP_EFFECT = {
  // evergreen / common
  'flying':'flying',
  'lifelink':'lifelink',
  'deathtouch':'deathtouch',
  'hexproof':'hexproof',
  'indestructible':'indestructible',
  'menace':'menace',
  'trample':'trample',
  'haste':'haste',
  'reach':'reach',
  'vigilance':'vigilance',
  'firststrike':'first-strike',
  'double strike':'double-strike',
  'doublestrike':'double-strike',
  'prowess':'prowess',
  'ward':'ward',
  'defender':'defender',
  'flash':'flash',
  'fear':'fear',
  'intimidate':'intimidate',
  'shroud':'shroud',
  // misc / popular
  'cascade':'cascade',
  'convoke':'convoke',
  'cycling':'cycling',
  'prowl':'prowl',
  'delve':'delve',
  'exalted':'exalted',
  'landwalk':'landwalk',
  'islandwalk':'landwalk',
  'forestwalk':'landwalk',
  'mountainwalk':'landwalk',
  'swampwalk':'landwalk',
  'plainswalk':'landwalk',
  // plus more room for additions later…
};

const ICON_MAP_COUNTER = {
  'shield':'shield',
  'stun':'stun',
  'infect':'infect',
  'energy':'energy',
  'experience':'experience',
  'poison':'poison',
  'loyalty':'loyalty',
  'charge':'charge',
  'aim':'aim',
  'finality':'finality',
  // add as you see them in ManaMaster set…
};

// Normalize arbitrary text to a key for icon maps.
// - lowercases
// - trims
// - collapses spaces/dashes/underscores
function normKey(s=''){
  return String(s).toLowerCase().trim()
    .replace(/counters?$/,'')            // e.g. "shield counter" -> "shield"
    .replace(/\s*counter$/, '')
    .replace(/\s+/g,' ')                 // collapse whitespace
    .replace(/[_\s]+/g,'-')              // to hyphen
    .replace(/-+/g,'-');
}

// "Protection from X": return slug 'protection' and text 'Protection from X'
function matchProtection(txt){
  const m = String(txt).trim().match(/^protection\s+from\s+(.+)$/i);
  if (!m) return null;
  // We’ll render a generic protection icon if available, and show full text.
  return { slug: 'protection', from: m[1] };
}

function iconHTML(slug){
  if (!slug) return '';
  const cls = `ms ms-${ICON_VARIANT}${slug}`;
  return `<i class="${cls}"></i>`;
}

// --- Helpers: read type_line & loyalty cleanly (DOM → Zones meta fallback) ---
function getTypeLine(el, cid){
  const fromDom  = el?.dataset?.type_line || el?.getAttribute?.('data-type_line') || '';
  if (fromDom) return String(fromDom);
  try {
    const meta = window.Zones?.getCardDataById ? window.Zones.getCardDataById(cid) : null;
    return String(meta?.type_line || '');
  } catch { return ''; }
}

function getLoyalty(el, cid){
  const fromDom = el?.dataset?.ogloyalty ?? el?.dataset?.loyalty ?? el?.getAttribute?.('data-ogloyalty') ?? el?.getAttribute?.('data-loyalty');
  if (fromDom != null && String(fromDom).trim() !== '' && String(fromDom).trim() !== '?') return String(fromDom).trim();
  try {
    const meta = window.Zones?.getCardDataById ? window.Zones.getCardDataById(cid) : null;
    const val = meta?.ogloyalty ?? meta?.loyalty;
    return (val != null && String(val).trim() !== '' && String(val).trim() !== '?') ? String(val).trim() : '';
  } catch { return ''; }
}


let ICON_VARIANT = ''; // '' or 'ability-'

// Try a known glyph and see which class family paints a width > 0.
function detectManaVariant(){
  try{
    const test = document.createElement('i');
    test.className = 'ms';
    test.style.position = 'absolute';
    test.style.opacity = '0';
    test.style.pointerEvents = 'none';
    document.body.appendChild(test);

    const tryClass = (cls) => {
      test.className = 'ms ' + cls;
      const w = test.getBoundingClientRect().width;
      return w && w > 0.1;
    };

    if (tryClass('ms-lifelink')) ICON_VARIANT = '';
    else if (tryClass('ms-ability-lifelink')) ICON_VARIANT = 'ability-';
    else ICON_VARIANT = ''; // fallback: we’ll still show text

    document.body.removeChild(test);
  } catch {}
}

// Parse types from an MTG type_line, e.g. "Legendary Creature — Elf Druid"
function parseTypesFromTypeLine(tl=''){
  const s = String(tl || '').trim();
  if (!s) return [];
  const [left, right] = s.split('—').map(x => (x||'').trim());
  const leftParts = left ? left.split(/\s+/).filter(Boolean) : [];
  const supertypes = leftParts.filter(x => /^(Basic|Legendary|Ongoing|Snow|World)$/i.test(x));
  const cardTypes  = leftParts.filter(x => /^(Artifact|Battle|Creature|Conspiracy|Dungeon|Enchantment|Instant|Land|Monster|Phenomenon|Plane|Planeswalker|Scheme|Sorcery|Tribal|Vanguard)$/i.test(x));
  const subtypes   = right ? right.split(/\s+/).filter(Boolean) : [];
  return [...supertypes, ...cardTypes, ...subtypes];
}

// Read OG Types/Effects for a card from dataset or meta
function readOgTypesEffects(el, cid){
  // 1) dataset (fast path)
  try{
    const t = el?.dataset?.ogTypes ? JSON.parse(el.dataset.ogTypes) : [];
    const e = el?.dataset?.ogEffects ? JSON.parse(el.dataset.ogEffects) : [];
    if (Array.isArray(t) || Array.isArray(e)) return {
      ogTypes: Array.isArray(t) ? t : [],
      ogEffects: Array.isArray(e) ? e : []
    };
  }catch{}

  // 2) meta from Zones (if you passed them through in CID_DATA)
  try{
    const meta = window.Zones?.getCardDataById ? window.Zones.getCardDataById(cid) : null;
    if (meta){
      const ogTypes   = Array.isArray(meta.ogTypes)   ? meta.ogTypes.slice()   : parseTypesFromTypeLine(meta.type_line || '');
      const ogEffects = Array.isArray(meta.ogEffects) ? meta.ogEffects.slice() : (Array.isArray(meta.keywords) ? meta.keywords.slice() : []);
      return { ogTypes, ogEffects };
    }
  }catch{}

  // 3) nothing cached → empty (types will still parse below if needed)
  return { ogTypes: [], ogEffects: [] };
}

// De-dupe while preserving first-seen original casing
function dedupeKeepFirst(arr){
  const seen = new Set();
  const out = [];
  for (const v of (arr || [])){
    const k = normKey(String(v||''));
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}



// ──────────────────────────────────────────────────────────────────────────────
// Overlay scale helpers (keep readable when zoomed out)
// ──────────────────────────────────────────────────────────────────────────────
function getWorldScale(){
  // Try to read CSS transform matrix on #worldWrap or #world
  const el = document.getElementById('worldWrap') || document.getElementById('world') || document.body;
  const st = getComputedStyle(el);
  const tr = st.transform || st.webkitTransform || 'matrix(1,0,0,1,0,0)';
  // matrix(a,b,c,d,tx,ty) => scaleX = a, scaleY = d
  const m = tr.match(/matrix\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(',').map(Number);
  const a = parts[0], d = parts[3];
  const sx = Number.isFinite(a) ? Math.abs(a) : 1;
  const sy = Number.isFinite(d) ? Math.abs(d) : 1;
  // if non-uniform, use average
  return (sx + sy) / 2 || 1;
}

function applyOverlayScale(containerEl){
  try{
    containerEl.style.setProperty('--overlayScale', String(computeOverlayScale()));
  } catch {}
}

// Ensure a single overlay root per card to hold all attribute UI (except PT).
function ensureOverlayRoot(el){
  let root = el.querySelector('.cardAttrRoot');
  if (!root){
    root = document.createElement('div');
    root.className = 'cardAttrRoot';
    el.appendChild(root);
  }
  applyOverlayScale(root);
  return root;
}

function ensureChild(root, cls){
  let el = root.querySelector('.' + cls);
  if (!el){
    el = document.createElement('div');
    el.className = cls;
    root.appendChild(el);
  }
  return el;
}

// ──────────────────────────────────────────────────────────────────────────────
const CardAttributes = {
  cache: {},
  roomId: null,
  seat: null,
  watcherActive: false,
  sub: null,
  _retry: null,
  _pending: new Set(),
  _observer: null,

  // hydration gate to avoid racing DOM creation during restore
  hydrating: false,
  _autoHydrationTimer: null,

  beginHydration(){
    this.hydrating = true;
    if (this._autoHydrationTimer) clearTimeout(this._autoHydrationTimer);
  },
  endHydration(){
    this.hydrating = false;
    this.flushPending();
  },
  flushPending(){
    if (!this._pending || !this._pending.size) return;
    const ids = Array.from(this._pending);
    this._pending.clear();
    ids.forEach(cid => { this.applyToDom(cid); this.refreshPT(cid); autoSeedMissingPT(document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`), cid);});
    requestAnimationFrame(()=> ids.forEach(cid => this.refreshPT(cid)));
  },

  async init({ roomId, seat }) {
    if (!supabase) supabase = await supaReady;

    this.roomId = roomId;
    this.seat   = seat;
    console.log('[Attr] init for room', roomId, 'seat', seat);

    // Enter hydration mode; we’ll automatically exit shortly or when DOM is ready.
    this.beginHydration();

    // Tear down old subscription
    if (this.sub) {
      try { await this.sub.unsubscribe(); } catch {}
      this.sub = null;
    }

    // Preload everything for this room (so UI has data immediately)
    await this.preloadRoom();

    // Realtime: keep cache warm
    this.sub = supabase
      .channel('card_attributes_room_' + roomId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'card_attributes', filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            delete this.cache[payload.old.cid];
            this._pending.add(payload.old.cid);
          } else {
            const row  = payload.new;
            const json = { ...(row?.json || {}) };
            if (row?.owner_seat && !json.owner_seat) json.owner_seat = row.owner_seat;
            this.cache[row.cid] = deepClone(json);
            this._pending.add(row.cid);
          }
          if (!this.hydrating){
            const cid = (payload.eventType === 'DELETE') ? payload.old.cid : payload.new.cid;
            this.applyToDom(cid);
            this.refreshPT(cid);
            requestAnimationFrame(()=> this.refreshPT(cid));
          }
        }
      )
      .subscribe();

    this.injectCss();
detectManaVariant();

    this.startDomObserver();
    this.startWatcher();

    // Auto-end hydration if app doesn't explicitly end it.
    this._autoHydrationTimer = setTimeout(()=> this.endHydration(), 1200);
    window.addEventListener('game:restored', () => this.endHydration(), { once: true });

    queueMicrotask(() => this.reapplyAll());
  },

  injectCss() {
    if (document.getElementById('attr-style')) return;
    const s = document.createElement('style');
	// Preserve caller/page values for overlay scale bounds.
// Only set defaults if not already defined in :root (e.g., v3.html).
{
  const rs = getComputedStyle(document.documentElement);
  const hasMin = rs.getPropertyValue('--overlayScaleMin').trim() !== '';
  const hasMax = rs.getPropertyValue('--overlayScaleMax').trim() !== '';
  if (!hasMin) document.documentElement.style.setProperty('--overlayScaleMin', '1');
  if (!hasMax) document.documentElement.style.setProperty('--overlayScaleMax', '3.5');
}

    s.id = 'attr-style';
    s.textContent = `
	/* inside injectCss() -> s.textContent, add near the top */


/* (optional) nudge font sizes so they benefit more from scaling */
.cardAttrPT        { font-size: 1.2em; }
.cardAttrCounter   { font-size: 0.9em;  }
.cardAttrEffects   { /* container only */ }
.cardAttrEffect    { font-size: 0.9em;  }

      /* ───── PT badge (unchanged position) ───── */
      .cardAttrPT {

        font-size:1.15em; font-weight:800; line-height:1;
        color:#fff;
        padding:2px 8px;
        border-radius:12px;
        background:rgba(0,0,0,0.65);
        border:1px solid rgba(255,255,255,0.25);
        box-shadow:
          0 2px 6px rgba(0,0,0,0.6),
          0 0 0 2px rgba(0,0,0,0.15) inset;
        backdrop-filter: blur(2px) saturate(1.1);
        -webkit-text-stroke: 0.5px rgba(0,0,0,0.85);
        text-shadow: 0 1px 1px rgba(0,0,0,0.6);
        pointer-events:none;
  position:absolute; bottom:6px; right:8px;
  transform-origin: bottom right;
  transform: scale(calc(var(--overlayScale,1) * var(--ptBadgeScale,1.35))) !important;
  z-index:4;
      }

      /* ───── Root overlay container that inverse-scales with world zoom ───── */
      .cardAttrRoot {
  position:absolute;
  inset:0;
  pointer-events:none;
  z-index:4; /* was 2; must beat transformed .cardInner on all clients */
  transform: scale(calc(var(--overlayScale,1) * var(--attrBoost,1.6)));

  transform-origin: bottom left;
}


      /* ───── Counters → bottom-left stacked upward ───── */
      .cardAttrCounters{
  position:absolute;
  /* anchor to same bottom-center as Effects row */
  left: calc(50% + var(--effects-offset-x, 0px));
  bottom: calc(6px + var(--effects-offset-y, 0px) + var(--effects-h, 0px) + var(--stack-gap, 6px));
  transform: translateX(-50%);

  display:flex;
  flex-direction:column;       /* build DOWN under effects */
  align-items:flex-start;
  gap:4px;
}

      .cardAttrCounter {
        display:flex; align-items:center; gap:6px;
        background:rgba(0,0,0,0.7);
        color:#fff;
        padding:4px 8px;
        border-radius:10px;   /* square with rounded corners */
        border:1px solid rgba(255,255,255,0.25);
        box-shadow:0 2px 6px rgba(0,0,0,0.5);
        font-size:0.85em;
        line-height:1;
        pointer-events:none;
        max-width: 140px;
        white-space:nowrap;
      }
      .cardAttrCounter i.ms { font-size:1.05em; }

      /* ───── Effects/Types → bottom-center row ───── */
.cardAttrEffects{
  position:absolute;
  left: calc(50% + var(--effects-offset-x, 0px));
  bottom: calc(6px + var(--effects-offset-y, 0px));
  transform: translateX(-50%);
  display:flex; flex-wrap:wrap; justify-content:center; gap:6px;
  max-width: calc(80% - var(--effects-right-safe, 0px));
  z-index:3;
        background:rgba(0,0,0,0.55);
        color:#fff;
 font-size: calc(0.8em * var(--effects-scale, 1)) !important;
  font-weight:800; color:#eaf2ff; background:#162338cc;
  padding:2px 6px; border-radius:8px;
  border:1px solid #2b3f63;
  white-space:nowrap; pointer-events:none;


        box-shadow:0 2px 6px rgba(0,0,0,0.45);

        line-height:1;

        white-space:nowrap;
      }
      .cardAttrEffect i.ms { font-size:1.1em; }

      /* ───── Notes icon (unchanged) ───── */
      .cardAttrNote {
        position:absolute;
        bottom:6px; left:6px;
        font-size:1em; opacity:0.8; pointer-events:none;
      }

      /* ───── Cog button (kept) ───── */
      .attrCogBtn { position:absolute; right:-18px; top:50%; transform:translateY(-50%); width:32px; height:32px; border-radius:50%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; color:white; font-size:1.2em; cursor:pointer; }
      .attrCogBtn:hover { background:rgba(255,255,255,0.2); }

      /* ───── Overlay UI fields ───── */
      .attrOverlay { display:flex; flex-direction:column; gap:6px; }
      .attrOverlay label { font-size:0.9em; color:var(--fg); }
      .attrOverlay input, .attrOverlay textarea { width:100%; background:var(--bg); color:var(--fg); border:1px solid var(--muted); border-radius:6px; padding:4px; }
      .attrOverlay button { background:var(--accent); color:white; border:none; border-radius:8px; padding:6px 12px; cursor:pointer; }

      /* ───── Counter row controls: name | ▼ | [qty] | ▲ | del ───── */
      .counterRow {
        display:grid;
        grid-template-columns: 1fr auto 64px auto auto;
        align-items:center;
        gap:6px;
        margin-bottom:6px;
      }
      .counterRow input[type="text"]{ min-width:0; }
      .counterRow input[type="number"]{ text-align:center; }
      .ctrBtn {
        background:rgba(255,255,255,0.08);
        color:#fff;
        border:1px solid rgba(255,255,255,0.2);
        border-radius:8px;
        padding:4px 8px;
        cursor:pointer;
        user-select:none;
      }
      .ctrBtn:active { transform: translateY(1px); }
      .delBtn {
        background:rgba(255,0,0,0.15);
        border:1px solid rgba(255,0,0,0.35);
        color:#fff;
        border-radius:8px;
        padding:4px 8px;
        cursor:pointer;
      }
	  
	  /* ───── TEMP effect chip (shows EOT / Linked) ───── */
.cardAttrEffect--temp{
  background:#2a1f0f !important;
  border-color:#b07a11 !important;
  color:#ffe9b3 !important;
  opacity:0.98;
}

/* ───── Small badge showing total TEMP P/T delta ───── */
.cardAttrPTTemp{
  position:absolute;
  right:8px;                 /* same right as PT */
  bottom:44px;               /* just above the PT badge */
  transform-origin: bottom right;
  transform: scale(calc(var(--overlayScale,1) * var(--ptBadgeScale,1.05))) !important;

  display:inline-flex;
  align-items:center;
  gap:6px;

  /* match PT badge BG/border, but with yellow text */
  background:rgba(0,0,0,0.65);
  border:1px solid rgba(255,255,255,0.25);
  color:#ffd58a;

  padding:2px 6px;
  border-radius:8px;
  font-weight:800;
  line-height:1;
  box-shadow:0 2px 6px rgba(0,0,0,0.45);
  z-index:4;
  pointer-events:none;
}
.cardAttrPTTemp .tag{
  font-size:.78em;
  opacity:.9;
  border:1px solid rgba(255,213,138,.35);
  padding:0 4px;
  border-radius:6px;
}


	  
    `;
	document.documentElement.style.setProperty('--attrBoost', '1.6');

    document.head.appendChild(s);
	
  },

  get(cid) {
    return this.cache[cid] || null;
  },

  // Load all rows for the room once at startup
  async preloadRoom(){
    if (!supabase) supabase = await supaReady;
    if (!this.roomId) return;

    const { data, error } = await supabase
      .from('card_attributes')
      .select('*')
      .eq('room_id', this.roomId);

    if (error) { console.warn('[Attr] preload error', error); return; }

    (data || []).forEach(row => {
      const json = { ...(row.json || {}) };
      if (row.owner_seat && !json.owner_seat) json.owner_seat = row.owner_seat;
      this.cache[row.cid] = deepClone(json);
      this._pending.add(row.cid);
    });

    console.log('[Attr] preloaded', (data || []).length, 'rows');
  },

  startDomObserver(){
    if (this._observer) return;
    const root = document.getElementById('world') || document.body;

    this._observer = new MutationObserver((mutations)=>{
      for (const m of mutations){

        // ➊ New nodes
        for (const n of (m.addedNodes || [])){
          if (!(n instanceof Element)) continue;
          const cards = n.matches?.('.card[data-cid]') ? [n] : Array.from(n.querySelectorAll?.('.card[data-cid]') || []);
          for (const el of cards){
            const cid = el.getAttribute('data-cid');
            if (!cid) continue;

            ensurePtBadge(el);
			ensurePtTempBadge(el);
ensureOverlayRoot(el);

// NEW: seed missing info so PT can render without interaction
autoSeedMissingPT(el, cid).finally(()=>{
  this.refreshPT(cid);
  requestAnimationFrame(()=> this.refreshPT(cid));
  this.applyToDom(cid);
  this._pending.delete(cid);
});


          }
        }

        // ➋ Attribute changes → a card just got its data-cid set
        if (m.type === 'attributes' && m.attributeName === 'data-cid'){
          const el = m.target;
          if (el instanceof Element && el.classList.contains('card')){
            const cid = el.getAttribute('data-cid');
            if (cid){
              ensurePtBadge(el);
			  ensurePtTempBadge(el);
              ensureOverlayRoot(el);
              this.refreshPT(cid);
              requestAnimationFrame(()=> this.refreshPT(cid));

// Render OG badges immediately, even with no cached row:
this.applyToDom(cid);
this._pending.delete(cid);

            }
          }
        }
      }
    });

    this._observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-cid']
    });
  },

  // Fetch a single card if not cached (used by overlay open)
  async fetchIfMissing(cid){
    if (this.cache[cid]) return this.cache[cid];
    if (!supabase) supabase = await supaReady;
    const { data, error } = await supabase
      .from('card_attributes')
      .select('*')
      .eq('room_id', this.roomId)
      .eq('cid', cid)
      .maybeSingle();

    if (error) { console.warn('[Attr] fetch one error', error); return null; }
    if (data) {
      const json = { ...(data.json || {}) };
      if (data.owner_seat && !json.owner_seat) json.owner_seat = data.owner_seat;
      this.cache[cid] = deepClone(json);
      this._pending.add(cid);
      if (!this.hydrating){
        this.applyToDom(cid);
        this.refreshPT(cid);
        requestAnimationFrame(()=> this.refreshPT(cid));
      }
      return json;
    }
    return null;
  },

  async set(cid, patch) {
    if (!supabase) supabase = await supaReady;

    const base = deepClone(this.cache[cid] || {});
const data = { ...base, ...deepClone(patch) };

this.cache[cid] = deepClone(data);

    console.log('[Attr] set', cid, data);
    const { error } = await supabase.from('card_attributes').upsert({
      room_id: this.roomId,
      cid,
      owner_seat: this.seat,
      json: data,
      updated_by_seat: this.seat
    });
    if (error) console.warn('[Attr] upsert error', error);

    this._pending.add(cid);
    if (!this.hydrating){
      this.applyToDom(cid);
      this.refreshPT(cid);
      requestAnimationFrame(()=> this.refreshPT(cid));
    }
  },

  async clear(cid) {
    if (!supabase) supabase = await supaReady;

    console.log('[Attr] clear', cid);
    delete this.cache[cid];
    const { error } = await supabase.from('card_attributes').delete().match({ room_id: this.roomId, cid });
    if (error) console.warn('[Attr] delete error', error);

    this._pending.add(cid);
    if (!this.hydrating){
      this.applyToDom(cid);
      this.refreshPT(cid);
      requestAnimationFrame(()=> this.refreshPT(cid));
    }
  },

  collectForSeat(seat) {
    const res = {};
    for (const [cid, data] of Object.entries(this.cache)) {
      if (data.owner_seat === seat) res[cid] = data;
    }
    console.log('[Attr] collectForSeat', seat, Object.keys(res).length);
    return res;
  },

  applyAll(seat, data) {
    console.log('[Attr] applyAll', seat, data);
    const cids = Object.keys(data || {});
    for (const cid of cids) {
      this.cache[cid] = deepClone(data[cid]);
      this._pending.add(cid);
      if (!this.hydrating){
        this.applyToDom(cid);
      }
    }
    if (!this.hydrating){
      requestAnimationFrame(() => {
        for (const cid of cids) this.refreshPT(cid);
      });
    }
  },

  // Render overlays (counters/effects/notes); PT handled separately
  applyToDom(cid){
    const sel = `.card[data-cid="${CSS.escape(cid)}"]`;
    const host = document.querySelector(sel);

    if (!host) {
      this._pending.add(cid);
      if (this.hydrating) return;

      this._retry ||= {};
      const n = (this._retry[cid] ||= 0);
      if (n < 300) {
        this._retry[cid] = n + 1;
        requestAnimationFrame(() => this.applyToDom(cid));
      } else {
        delete this._retry[cid];
        //console.warn('[Attr] applyToDom timeout (no element for cid)', cid);
      }
      return;
    }

    if (this._retry) delete this._retry[cid];
    this._pending.delete(cid);

    // Ensure PT badge and root
    ensurePtBadge(host);
    const root = ensureOverlayRoot(host);

    // Clear existing content containers (leave PT alone)
    root.innerHTML = '';

    const data = this.cache[cid] || {};

    // ── Counters container (bottom-left, stack up)
const countersWrap = ensureChild(root, 'cardAttrCounters');

// Accept both array form [{ name, qty }] and object form { "+1/+1": 2 }
let countersData = data.counters || [];
if (!Array.isArray(countersData) && countersData && typeof countersData === 'object') {
  countersData = Object.entries(countersData).map(([name, qty]) => ({ name, qty }));
}

countersData.forEach(c => {
  if (!c || !String(c.name || '').trim()) return;
  const qty = Math.max(1, Number(c.qty || 1));

  const n = document.createElement('div');
  n.className = 'cardAttrCounter';

  const key  = normKey(c.name);
  const prot = matchProtection(c.name); // usually not for counters, but safe
  const slug = prot ? 'protection' : ICON_MAP_COUNTER[key];

  const icon = slug ? iconHTML(slug) : '';
  n.innerHTML = icon
    ? `${icon} <span>${c.name}×${qty}</span>`
    : `<span>${c.name}×${qty}</span>`;

  countersWrap.appendChild(n);
});


    // ── Effects/types container (bottom-center)
const effWrap = ensureChild(root, 'cardAttrEffects');

// OG lists (dataset/meta), with a safe fallback to parse type_line
let { ogTypes, ogEffects } = readOgTypesEffects(host, cid);
if (!ogTypes || !ogTypes.length){
  const tl = host?.dataset?.typeLine || (window.Zones?.getCardDataById?.(cid)?.type_line) || '';
  ogTypes = parseTypesFromTypeLine(tl);
}

// Merge OG + user, then de-dupe (case/spacing agnostic, keep first casing)
const mergedTypes = dedupeKeepFirst([
  ...(ogTypes || []),
  ...(Array.isArray(data.types) ? data.types : []),
  ...(Array.isArray(data.addedTypes) ? data.addedTypes : []),   // ← show permanent "Grant type"
]);
const mergedEffects = dedupeKeepFirst([
  ...(ogEffects || []),
  ...(Array.isArray(data.effects) ? data.effects : []),
]);
const allEffects = [...mergedTypes, ...mergedEffects];


allEffects.forEach(raw => {
  const n = document.createElement('div');
  n.className = 'cardAttrEffect';

  const rawKey = String(raw);
  const prot = matchProtection(rawKey);
  if (prot){
    const icon = iconHTML('protection');
    n.innerHTML = icon ? `${icon} <span>Protection from ${prot.from}</span>` :
                         `<span>Protection from ${prot.from}</span>`;
  } else {
    const k1 = normKey(rawKey);           // "first-strike"
    const k2 = k1.replace(/-/g,'');       // "firststrike"
    const k3 = k1.replace(/-/g,' ');      // "first strike"
    const slug = ICON_MAP_EFFECT[k1] || ICON_MAP_EFFECT[k2] || ICON_MAP_EFFECT[k3] || null;
    const icon = slug ? iconHTML(slug) : '';
    n.innerHTML = icon ? `${icon} <span>${rawKey}</span>` : `<span>${rawKey}</span>`;
  }

  effWrap.appendChild(n);
});

// TEMP effects (from activation system): render with a different tint + mode label
const tempEffects = Array.isArray(data.tempEffects) ? data.tempEffects : [];
tempEffects.forEach(eff => {
  if (!eff || !eff.ability) return;
  const n = document.createElement('div');
  n.className = 'cardAttrEffect cardAttrEffect--temp';
  const modeTag = eff.mode === 'LINKED' ? 'Linked' : (eff.mode === 'EOT' ? 'EOT' : 'Temp');
  // try to show an icon if we know it; else plain text
  const k1 = normKey(String(eff.ability));
  const k2 = k1.replace(/-/g,'');    // doublestrike
  const k3 = k1.replace(/-/g,' ');   // double strike
  const slug = ICON_MAP_EFFECT[k1] || ICON_MAP_EFFECT[k2] || ICON_MAP_EFFECT[k3] || null;
  const icon = slug ? iconHTML(slug) : '';
  n.innerHTML = icon
    ? `${icon} <span>${eff.ability}</span> <span class="tag">${modeTag}</span>`
    : `<span>${eff.ability}</span> <span class="tag">${modeTag}</span>`;
  effWrap.appendChild(n);
});

// TEMP types (from activation system): same tint + mode label as temp abilities
const tempTypes = Array.isArray(data.tempTypes) ? data.tempTypes : [];
tempTypes.forEach(tt => {
  if (!tt || !tt.type) return;
  const n = document.createElement('div');
  n.className = 'cardAttrEffect cardAttrEffect--temp';
  const modeTag = tt.mode === 'LINKED' ? 'Linked' : (tt.mode === 'EOT' ? 'EOT' : 'Temp');

  // Show a generic “type” chip — keep text visible so players see the exact type
  n.innerHTML = `<span>${tt.type}</span> <span class="tag">${modeTag}</span>`;
  effWrap.appendChild(n);
});


// Make counters sit directly below effects
root.style.setProperty('--effects-h', (effWrap?.offsetHeight || 0) + 'px');

    // Notes (if you want the little 📝, keep as-is)
    if (data.notes) {
      const note = ensureChild(root, 'cardAttrNote');
      note.textContent = '📝';
    }

    // Keep overlays sized for current zoom
    applyOverlayScale(root);

    // PT refresh (do twice to catch late base stamps)
    this.refreshPT(cid);
    requestAnimationFrame(()=> this.refreshPT(cid));
  },

  refreshPT(cid){
  const el = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
  if (!el) return false;

  // Decide visibility first: only Creatures (PT) or Planeswalkers (loyalty)
  const tl   = getTypeLine(el, cid);
  const isCreature     = /\bCreature\b/i.test(tl);
  const isPlaneswalker = /\bPlaneswalker\b/i.test(tl);

  // Ensure we have (or create) the badge, but we’ll show/hide it explicitly.
  const badge = ensurePtBadge(el);

  // PLANEWALKER: render “L: N” and bail
  if (isPlaneswalker){
    const loy = getLoyalty(el, cid);
    if (loy){
      badge.style.display = 'block';
      badge.textContent = `L: ${loy}`;
      // keep readable under zoom
      try {
        const os = el.querySelector('.cardAttrRoot') || el;
        const scale = getComputedStyle(os).getPropertyValue('--overlayScale') || '1';
        badge.style.setProperty('--overlayScale', scale);
      } catch {}
      return true;
    }
    // no loyalty value → hide badge
    badge.style.display = 'none';
    return false;
  }

  // NOT A CREATURE → hide badge and bail
  if (!isCreature){
    badge.style.display = 'none';
    return false;
  }

  // --- Creature path: compute base + modifiers like before ---
  // seed DOM base from snapshot OGs once if missing
  try {
    const hasBase = el.dataset.baseP != null && el.dataset.baseT != null;
    if (!hasBase && window.Zones?.getCardDataById){
      const meta = window.Zones.getCardDataById(cid);
      const mp = (meta && Number(meta.ogpower));      // may be NaN
      const mt = (meta && Number(meta.ogtoughness));  // may be NaN
      if (Number.isFinite(mp)) el.dataset.baseP = String(mp);
      if (Number.isFinite(mt)) el.dataset.baseT = String(mt);
    }
  } catch {}

  const attrs = this.cache?.[cid] || {};
  const { p: baseP, t: baseT } = resolveBasePT(cid, el, attrs);
  const { p, t } = combinePT(baseP, baseT, attrs);

  badge.style.display = 'block';

  if (p == null || t == null){
    // fall back to og/base + modifier strings to avoid "?+5/?+1"
    const modP = Number(attrs?.ptMod?.pow ?? 0);
    const modT = Number(attrs?.ptMod?.tgh ?? 0);

    const meta = window.Zones?.getCardDataById ? window.Zones.getCardDataById(cid) : null;
    const mOgP = Number(meta?.ogpower);
    const mOgT = Number(meta?.ogtoughness);

    const ogP  = Number(attrs?.ptMod?.ogpow);
    const ogT  = Number(attrs?.ptMod?.ogtgh);

    const baseStrP =
      Number.isFinite(ogP)  ? String(ogP)  :
      Number.isFinite(baseP) ? String(baseP) :
      Number.isFinite(mOgP) ? String(mOgP) : '?';

    const baseStrT =
      Number.isFinite(ogT)  ? String(ogT)  :
      Number.isFinite(baseT) ? String(baseT) :
      Number.isFinite(mOgT) ? String(mOgT) : '?';

    const modStrP = modP ? (modP > 0 ? `+${modP}` : `${modP}`) : '';
    const modStrT = modT ? (modT > 0 ? `+${modT}` : `${modT}`) : '';
    badge.textContent = `${baseStrP}${modStrP}/${baseStrT}${modStrT}`;
   } else {
    badge.textContent = `${p}/${t}`;
  }

  // ───── TEMP P/T badge ─────
  const attrsForTemp = this.cache?.[cid] || {};
  const tempList = Array.isArray(attrsForTemp.tempPT) ? attrsForTemp.tempPT : [];
  let tPow = 0, tTgh = 0;
  let hasEOT = false, hasLinked = false;
  for (const e of tempList){
    tPow += Number(e?.pow || 0);
    tTgh += Number(e?.tgh || 0);
    if (e?.mode === 'EOT') hasEOT = true;
    if (e?.mode === 'LINKED') hasLinked = true;
  }
  const tBadge = ensurePtTempBadge(el);
  if ((tPow !== 0 || tTgh !== 0) && isCreature){
    const tag = hasEOT && hasLinked ? 'EOT+Linked' : (hasLinked ? 'Linked' : 'EOT');
    const pStr = (tPow >= 0 ? `+${tPow}` : `${tPow}`);
    const tStr = (tTgh >= 0 ? `+${tTgh}` : `${tTgh}`);
    tBadge.style.display = 'inline-flex';
    tBadge.innerHTML = `<span>${pStr}/${tStr}</span><span class="tag">${tag}</span>`;
    // keep zoom-consistent
    try {
      const os = el.querySelector('.cardAttrRoot') || el;
      const scale = getComputedStyle(os).getPropertyValue('--overlayScale') || '1';
      tBadge.style.setProperty('--overlayScale', scale);
    } catch {}
  } else {
    tBadge.style.display = 'none';
  }

  // keep PT badge readable during zoom
  try {
    const os = el.querySelector('.cardAttrRoot') || el;
    const scale = getComputedStyle(os).getPropertyValue('--overlayScale') || '1';
    badge.style.setProperty('--overlayScale', scale);
  } catch {}

  return true;
},


  reapplyAll(){
    const cards = document.querySelectorAll('.card[data-cid]');
    cards.forEach(card => {
      ensurePtBadge(card);
	  ensurePtTempBadge(el);
      ensureOverlayRoot(card);
	  autoSeedMissingPT(card, card.getAttribute('data-cid'));

      this.applyToDom(card.getAttribute('data-cid'));
    });
  },

  startWatcher() {
    if (this.watcherActive) return;
    this.watcherActive = true;
    console.log('[Attr] watcher started');

    const loop = () => {
  if (!this.hydrating){
    const cards = document.querySelectorAll('.card[data-cid]');
    const clamped = computeOverlayScale();   // ← use the shared helper
    cards.forEach(card=>{
      const cid = card.dataset.cid; if(!cid) return;
      const root = card.querySelector('.cardAttrRoot');
      if (root) root.style.setProperty('--overlayScale', String(clamped));
      this.refreshPT(cid);
    });
  }
  requestAnimationFrame(loop);
};

    requestAnimationFrame(loop);
  }
  
};

// add this helper once (near getWorldScale/applyOverlayScale)
function computeOverlayScale(){
  const s = getWorldScale();                   // world zoom factor (e.g., 0.25 when zoomed way out)
  const inv = 1 / Math.max(0.001, s);          // inverse scale keeps overlays readable
  const cs = getComputedStyle(document.documentElement);
  const MIN = parseFloat(cs.getPropertyValue('--overlayScaleMin')) || 1;
const MAX = parseFloat(cs.getPropertyValue('--overlayScaleMax')) || 3.5;
const base = Math.min(Math.max(inv, MIN), MAX);
const boost = parseFloat(cs.getPropertyValue('--attrBoost')) || 1;
return base * boost;

}




// ================================
// Overlay UI (robust open + fallback)
// ================================
Overlays.openCardAttributes = async function ({ cid, seat }) {
  console.log('[Attr][ui] open overlay for cid', cid, 'seat', seat);

  await CardAttributes.fetchIfMissing?.(cid);

  const scrim = document.getElementById('cardSettings');
  if (!scrim) { console.warn('[Attr][ui] #cardSettings not found'); return; }
  scrim.style.display = 'block';
  scrim.style.zIndex = String(10000);

  // controls
  const title   = document.getElementById('csTitle');
  const typesEl = document.getElementById('csTypesChips');
  const typesIn = document.getElementById('csTypesInput');
  const effEl   = document.getElementById('csEffectsChips');
  const effIn   = document.getElementById('csEffectsInput');
  const chosen  = document.getElementById('csChosenType');
  const powIn   = document.getElementById('csPowMod');
  const tghIn   = document.getElementById('csTghMod');
  const notes   = document.getElementById('csNotes');
  const countersWrap = document.getElementById('csCounters');
  const addName = document.getElementById('csNewCounterName');
  const addQty  = document.getElementById('csNewCounterQty');

  const data = deepClone(
  (window.CardAttributes && window.CardAttributes.get(cid)) ||
  { ptMod:{pow:0,tgh:0}, counters:[], effects:[], notes:'', chosenType:'', types:[] }
);


  // sanitize counters to avoid blank rows from prior sessions
  data.counters = (Array.isArray(data.counters) ? data.counters : []).filter(c => c && String(c.name||'').trim());

  if (title) title.textContent = `Card Settings — ${document.querySelector(`.card[data-cid="${CSS.escape(cid)}"]`)?.dataset?.name || ''}`;

  // chip render helpers
  const renderChips = (wrap, items) => {
    if (!wrap) return;
    wrap.innerHTML = '';
    (items || []).forEach((txt, i) => {
      const chip = document.createElement('div');
      chip.className = 'cs-chip';
      chip.textContent = txt;
      chip.title = 'Click to remove';
      chip.onclick = () => { items.splice(i,1); renderChips(wrap, items); };
      wrap.appendChild(chip);
    });
  };

  data.types   = Array.isArray(data.types)   ? data.types   : [];
  data.effects = Array.isArray(data.effects) ? data.effects : [];

  renderChips(typesEl, data.types);
  renderChips(effEl,   data.effects);

  if (typesIn) typesIn.onkeydown = (e)=>{ if(e.key==='Enter' && typesIn.value.trim()){ data.types.push(typesIn.value.trim()); typesIn.value=''; renderChips(typesEl, data.types); } };
  if (effIn)   effIn.onkeydown   = (e)=>{ if(e.key==='Enter' && effIn.value.trim()){ data.effects.push(effIn.value.trim()); effIn.value=''; renderChips(effEl, data.effects); } };

  if (chosen) chosen.value = data.chosenType || '';
  if (powIn)  powIn.value  = Number(data.ptMod?.pow || 0);
  if (tghIn)  tghIn.value  = Number(data.ptMod?.tgh || 0);
  if (notes)  notes.value  = data.notes || '';

  // counters list with decrement/increment buttons
  const renderCounters = ()=>{
    if (!countersWrap) return;
    countersWrap.innerHTML = '';
    (data.counters||[]).forEach((c, idx)=>{
      const row = document.createElement('div');
      row.className = 'counterRow';
      row.innerHTML = `
        <input type="text" value="${c.name||''}" />
        <button class="ctrBtn ctrDown">▼</button>
        <input type="number" min="1" value="${Math.max(1, Number(c.qty||1))}" />
        <button class="ctrBtn ctrUp">▲</button>
        <button class="delBtn">×</button>`;
      const [nameIn, downBtn, qtyIn, upBtn, del] = row.children;

      nameIn.oninput = ()=> c.name = nameIn.value.trim();
      qtyIn.oninput  = ()=> c.qty  = Math.max(1, parseInt(qtyIn.value||'1',10)) || 1;

      downBtn.onclick = ()=> { qtyIn.value = String(Math.max(1, (parseInt(qtyIn.value||'1',10)||1) - 1)); qtyIn.dispatchEvent(new Event('input')); };
      upBtn.onclick   = ()=> { qtyIn.value = String(Math.max(1, (parseInt(qtyIn.value||'1',10)||1) + 1)); qtyIn.dispatchEvent(new Event('input')); };

      del.onclick = ()=> { data.counters.splice(idx,1); renderCounters(); };
      countersWrap.appendChild(row);
    });
  };
  renderCounters();

  const addCounter = ()=> {
    const name = (addName?.value || '').trim();
    let qty  = Number(addQty?.value || 1);
    if (!name) return;
    qty = Math.max(1, qty);
    (data.counters ||= []).push({ name, qty });
    if (addName) addName.value = '';
    if (addQty)  addQty.value  = 1;
    renderCounters();
  };
  document.getElementById('csAddCounter')?.addEventListener('click', addCounter);

  // buttons
  document.getElementById('csClose')?.addEventListener('click', ()=>{ scrim.style.display='none'; }, { once:true });
  document.getElementById('csClear')?.addEventListener('click', async ()=>{
    await window.CardAttributes?.clear?.(cid);
    scrim.style.display = 'none';
  });

  document.getElementById('csSave')?.addEventListener('click', async ()=>{
    // 1) Types
    const typesWrap = document.getElementById('csTypesChips');
    const typesIn   = document.getElementById('csTypesInput');
    const types = [
      ...(typesWrap ? Array.from(typesWrap.querySelectorAll('.cs-chip')).map(n=>n.textContent.trim()).filter(Boolean) : []),
      ...(typesIn?.value.trim() ? [typesIn.value.trim()] : [])
    ];

    // 2) Effects
    const effWrap = document.getElementById('csEffectsChips');
    const effIn   = document.getElementById('csEffectsInput');
    const effects = [
      ...(effWrap ? Array.from(effWrap.querySelectorAll('.cs-chip')).map(n=>n.textContent.trim()).filter(Boolean) : []),
      ...(effIn?.value.trim() ? [effIn.value.trim()] : [])
    ];

    // 3) Counters (read rows; filter out blanks)
    const countersWrap = document.getElementById('csCounters');
    const addName = document.getElementById('csNewCounterName');
    const addQty  = document.getElementById('csNewCounterQty');
    const counters = [];
    if (countersWrap) {
      for (const row of countersWrap.querySelectorAll('.counterRow')) {
        const [nameIn, _down, qtyIn] = row.querySelectorAll('input,button');
        const name = (nameIn?.value || '').trim();
        const qty  = Math.max(1, parseInt(row.querySelector('input[type="number"]')?.value || '1', 10));
        if (name) counters.push({ name, qty });
      }
    }
    if (addName?.value.trim()) {
      counters.push({
        name: addName.value.trim(),
        qty: Math.max(1, parseInt(addQty?.value || '1', 10))
      });
    }

    // 4) Chosen type + P/T + notes
    const chosen   = (document.getElementById('csChosenType')?.value || '').trim();
    const pow      = parseInt(document.getElementById('csPowMod')?.value || '0', 10) || 0;
    const tgh      = parseInt(document.getElementById('csTghMod')?.value || '0', 10) || 0;
    const notes    = (document.getElementById('csNotes')?.value || '').trim();

    // 5) Capture ORIGINAL base P/T to store as og (prevents "?+X" cases)
    const cardEl = document.querySelector(`.card[data-cid="${CSS.escape(cid)}"]`);
    let ogp = NaN, ogt = NaN;
    if (cardEl){
      const fromDom = parseBasePTFromEl(cardEl);
      ogp = Number.isFinite(fromDom.p) ? fromDom.p : ogp;
      ogt = Number.isFinite(fromDom.t) ? fromDom.t : ogt;
    }
    if ((!Number.isFinite(ogp) || !Number.isFinite(ogt)) && window.Zones?.getCardDataById){
      const meta = window.Zones.getCardDataById(cid);
      if (meta){
        if (!Number.isFinite(ogp)) ogp = tryNum(meta.power);
        if (!Number.isFinite(ogt)) ogt = tryNum(meta.toughness);
      }
    }

    const patch = {
      ptMod: {
        pow,
        tgh,
        ...(Number.isFinite(ogp) ? { ogpow: ogp } : {}),
        ...(Number.isFinite(ogt) ? { ogtgh: ogt } : {}),
      },
      counters,
      effects,
      types,
      chosenType: chosen,
      notes,
      owner_seat: seat
    };

    console.log('[Attr][ui] save (DOM-sourced)', cid, patch);
    await window.CardAttributes?.set?.(cid, patch);
    document.getElementById('cardSettings').style.display = 'none';
  });
};

window.CardAttributes = CardAttributes;
export default CardAttributes;
