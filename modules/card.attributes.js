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
    ids.forEach(cid => { this.applyToDom(cid); this.refreshPT(cid); });
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
    s.id = 'attr-style';
    s.textContent = `
	/* inside injectCss() -> s.textContent, add near the top */
:root{
  --overlayScaleMin: 1;      /* never smaller than normal size */
  --overlayScaleMax: 3.5;    /* <- bump this to 3.5x (tweak to taste) */
}

/* (optional) nudge font sizes so they benefit more from scaling */
.cardAttrPT        { font-size: 1.2em; }
.cardAttrCounter   { font-size: 0.9em;  }
.cardAttrEffects   { /* container only */ }
.cardAttrEffect    { font-size: 0.9em;  }

      /* ───── PT badge (unchanged position) ───── */
      .cardAttrPT {
        position:absolute;
        bottom:6px; right:8px;
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
        z-index: 3;
        transform: scale(var(--overlayScale,1));
        transform-origin: bottom right;
      }

      /* ───── Root overlay container that inverse-scales with world zoom ───── */
      .cardAttrRoot {
  position:absolute;
  inset:0;
  pointer-events:none;
  z-index:4; /* was 2; must beat transformed .cardInner on all clients */
  transform: scale(var(--overlayScale,1));
  transform-origin: bottom left;
}


      /* ───── Counters → bottom-left stacked upward ───── */
      .cardAttrCounters {
        position:absolute;
        left:6px; bottom:6px;
        display:flex;
        flex-direction:column-reverse; /* newest appears above previous */
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
      .cardAttrEffects {
        position:absolute;
        left:50%; bottom:6px;
        transform: translateX(-50%);
        display:flex; flex-wrap:wrap;
        justify-content:center;
        gap:6px;
        max-width: 80%;
      }
      .cardAttrEffect {
        display:flex; align-items:center; gap:6px;
        background:rgba(0,0,0,0.55);
        color:#fff;
        padding:4px 8px;
        border-radius:10px;
        border:1px solid rgba(255,255,255,0.25);
        box-shadow:0 2px 6px rgba(0,0,0,0.45);
        font-size:0.8em;
        line-height:1;
        pointer-events:none;
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
    `;
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
            ensureOverlayRoot(el);
            this.refreshPT(cid);
            requestAnimationFrame(()=> this.refreshPT(cid));

     this.applyToDom(cid);
this._pending.delete(cid);

          }
        }

        // ➋ Attribute changes → a card just got its data-cid set
        if (m.type === 'attributes' && m.attributeName === 'data-cid'){
          const el = m.target;
          if (el instanceof Element && el.classList.contains('card')){
            const cid = el.getAttribute('data-cid');
            if (cid){
              ensurePtBadge(el);
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
        console.warn('[Attr] applyToDom timeout (no element for cid)', cid);
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
    (data.counters || []).forEach(c=>{
      if (!c || !String(c.name||'').trim()) return;
      const qty = Math.max(1, Number(c.qty||1));
      const n = document.createElement('div');
      n.className = 'cardAttrCounter';

      const key = normKey(c.name);
      const prot = matchProtection(c.name); // counters rarely "protection", but just in case
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
const mergedTypes   = dedupeKeepFirst([...(ogTypes || []), ...(Array.isArray(data.types) ? data.types : [])]);
const mergedEffects = dedupeKeepFirst([...(ogEffects || []), ...(Array.isArray(data.effects) ? data.effects : [])]);
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

    // seed DOM base from snapshot OGs once if missing
    try {
      const hasBase = el.dataset.baseP != null && el.dataset.baseT != null;
      if (!hasBase && window.Zones?.getCardDataById){
        const meta = window.Zones.getCardDataById(cid);
        const mp = tryNum(meta?.ogpower);
        const mt = tryNum(meta?.ogtoughness);
        if (Number.isFinite(mp)) el.dataset.baseP = String(mp);
        if (Number.isFinite(mt)) el.dataset.baseT = String(mt);
      }
    } catch {}

    const attrs = this.cache?.[cid] || {};
    const { p: baseP, t: baseT } = resolveBasePT(cid, el, attrs);
    const { p, t } = combinePT(baseP, baseT, attrs);
    const badge = ensurePtBadge(el);

    if (p == null || t == null){
      const modP = Number(attrs?.ptMod?.pow ?? 0);
      const modT = Number(attrs?.ptMod?.tgh ?? 0);

      const meta = window.Zones?.getCardDataById ? window.Zones.getCardDataById(cid) : null;
      const mOgP = tryNum(meta?.ogpower);
      const mOgT = tryNum(meta?.ogtoughness);

      const ogP = tryNum(attrs?.ptMod?.ogpow);
      const ogT = tryNum(attrs?.ptMod?.ogtgh);

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

    // keep PT badge readable during zoom
    badge.style.setProperty('--overlayScale', getComputedStyle(el.querySelector('.cardAttrRoot'))?.getPropertyValue('--overlayScale') || '1');

    return true;
  },

  reapplyAll(){
    const cards = document.querySelectorAll('.card[data-cid]');
    cards.forEach(card => {
      ensurePtBadge(card);
      ensureOverlayRoot(card);
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
  return Math.min(Math.max(inv, MIN), MAX);    // clamp to tunables
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
