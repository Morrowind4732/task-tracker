// ================================
// FILE: modules/battle.ui.js
// Battle UI System (V2.1) — Multi-party Confirm
// ================================
// - Keeps your current UI flow
// - Outcome overlay appears for EVERYONE
// - Requires ALL seats to confirm before apply
// - Supabase phases: waiting_for_blocks → outcome_ready → applying → done
// ================================
import Overlays from './overlays.js';
import CardAttributes from './card.attributes.js';
import { supaReady } from './env.supabase.js';
import Zones from './zones.js'; // uses the public API in zones.js

let supabase = null; supaReady.then(c => supabase = c);

// --- Fresh combat-time attributes (DB snapshot) -----------------
const _battleAttrs = new Map(); // cid -> json snapshot { effects, tempEffects, addedTypes, tempTypes, ptMod, ... }

async function _fetchAttrsRow(room_id, cid){
  const c = await sb();
  try{
    const { data, error } = await c
      .from('card_attributes')
      .select('json')
      .eq('room_id', room_id)
      .eq('cid', String(cid))
      .maybeSingle();
    if (error) { console.warn('[Battle] fetch attrs error', { cid, error }); return null; }
    return data?.json || null;
  } catch(e){
    console.warn('[Battle] fetch attrs exception', { cid, e });
    return null;
  }
}

async function _preloadBattleAttrs(cids){
  const room_id = BattleUI?.roomId || window.CardAttributes?.roomId || window.ROOM_ID || 'room1';
  const uniq = Array.from(new Set(cids.map(String)));
  const rows = await Promise.all(uniq.map(async cid => {
    const j = await _fetchAttrsRow(room_id, cid);
    if (j) _battleAttrs.set(String(cid), j);
    return !!j;
  }));
  return rows.some(Boolean);
}


(function injectCss(){
  if (document.getElementById('battle-style')) return;
  const s = document.createElement('style');
  s.id = 'battle-style';
  s.textContent = `
    .battleGrid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:10px; }
    .bcard{ border:1px solid #24324a; background:#101623; border-radius:10px; overflow:hidden; cursor:pointer; user-select:none; box-shadow:0 6px 16px rgba(0,0,0,.35) inset; }
    .bcard .art{ width:100%; padding-top:140%; background:center/cover no-repeat; }
    .bcard .meta{ padding:6px 8px; display:flex; justify-content:space-between; align-items:center; font-weight:800; color:#e7f0ff; gap:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .bcard.selected{ outline:2px solid var(--accent, #6aa9ff); outline-offset:2px; }
    .blkBtn{ background:#1a2a45; color:#cfe1ff; border:1px solid #2b3f63; border-radius:10px; padding:6px 10px; font-weight:800; cursor:pointer; }
    .blkBtn[disabled]{ opacity:.4; cursor:not-allowed; }
    .blkBtn.active{ box-shadow:0 0 0 2px var(--accent, #6aa9ff) inset; }
    .blkBtn.warn{ background:#2a1730; border-color:#5e2a6a; }
    .outcome-who{ display:flex; gap:8px; flex-wrap:wrap; margin:8px 0; }
    .outcome-who .seatBadge{ padding:6px 10px; border-radius:999px; font-weight:800; border:1px solid #2b3f63; }
    .seatBadge.confirmed{ background:#15371e; border-color:#2f6b40; color:#b7ffd0; }
    .seatBadge.pending{ background:#2a1e19; border-color:#6b3a2f; color:#ffd0b7; }
.bcard .kw {
  padding:0 8px 8px;
  color:#9fb7d8;
  font-size:18px;
  line-height:1.25;
  white-space:normal;        /* allow multi-line */
  overflow:visible;
  text-overflow:clip;
  opacity:.95;
  font-style:italic;
}
.bcard .kw > div {           /* each keyword on its own line */
  display:block;
}

/* Blocker keyword lines */
.blkBtn .blkMeta{
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:2px;
}
.blkBtn .blkMeta .blkName{
  font-weight:800;
  color:#e7f0ff;
  line-height:1.2;
}
.blkBtn .kw{
  padding:0;
  color:#9fb7d8;
  font-size:14px;
  line-height:1.25;
  white-space:normal;      /* allow multi-line */
  overflow:visible;
  text-overflow:clip;
  opacity:.95;
  font-style:italic;
}
.blkBtn .kw > div{         /* each keyword on its own line */
  display:block;
}

/* P/T pill + name row for blockers */
.blkBtn .blkMeta .blkTop{
  display:flex; align-items:center; gap:6px; line-height:1.2;
}
.blkBtn .blkMeta .blkPT{
  font-weight:800;
  padding:2px 6px;
  border-radius:6px;
  border:1px solid #2f6b40;
  background:#15371e;
  color:#b7ffd0;
  font-size:13px;
}

/* outcome rows with checkboxes */
.outRow{
  display:flex; align-items:flex-start; gap:10px; padding:8px; margin-bottom:6px;
}
.outRow input[type="checkbox"]{
  margin-top:4px; transform:scale(1.2);
}
.outRow.disabled{ opacity:.55; pointer-events:none; }


  `;
  document.head.appendChild(s);
})();

function getCardImgSrc(cidOrEl){
  const cid = typeof cidOrEl === 'string' ? cidOrEl : cidOrEl?.dataset?.cid;
  // 1) v3 cache (fast path)
  try {
    const fromMap = window.getCardDataById?.(cid);
    if (fromMap?.img) return fromMap.img;            // ← v3’s CID_DATA store
  } catch {}

  // 2) DOM <img> inside the front face
  const el = typeof cidOrEl === 'string' ? findCardEl(cidOrEl) : cidOrEl;
  const img = el?.querySelector('.face.front img') || el?.querySelector('img');
  if (img?.src) return img.src;

  // 3) Fallback: any background-image on the face
  const f = el?.querySelector('.face.front') || el;
  let bg = f?.style?.backgroundImage;
  if (!bg || bg === 'none') { try { bg = getComputedStyle(f).backgroundImage; } catch{} }
  const m = /url\(["']?(.*?)["']?\)/i.exec(bg || '');
  return m ? m[1] : '';
}


function openPanel({ title, html, footer, onAttach }){
  const scrim = document.createElement('div'); scrim.className='scrim';
  const panel = document.createElement('div'); panel.className='panel';
  panel.innerHTML = `
    <div class="row" style="justify-content:space-between; align-items:center;">
      <strong>${title||'Panel'}</strong>
      <button class="pill js-close">Close</button>
    </div>
    <div class="panel-body">${html||''}</div>
    ${footer?`<div class="row" style="margin-top:10px; justify-content:flex-end; gap:8px;">${footer}</div>`:''}
  `;
  scrim.appendChild(panel); document.body.appendChild(scrim); scrim.style.display='block';
  const close=()=>{ try{document.body.removeChild(scrim);}catch{} };
  panel.querySelector('.js-close')?.addEventListener('click', close);
  scrim.addEventListener('click', e=>{ if(e.target===scrim) close(); });
  panel._close = close;
  onAttach?.(panel);
  return panel;
}
const closePanel = (p)=>{ try{p?._close?.();}catch{} };

const $$  = (s,r=document)=>Array.from(r.querySelectorAll(s));
const findCardEl = (cid)=>document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
const getFaceBG = (el)=>{ const f=el?.querySelector('.face.front')||el; let bg=f.style.backgroundImage; try{ if(!bg) bg=getComputedStyle(f).backgroundImage; }catch{} return bg||'none'; };


// --- FS/DS helpers (DS implies FS) ---
const _hasFS = (s)=> s.has('first strike') || s.has('firststrike') || s.has('double strike') || s.has('doublestrike');
const _hasDS = (s)=> s.has('double strike') || s.has('doublestrike');



function PT(cid){
  const el   = findCardEl(cid);
  const meta = window.getCardDataById?.(cid) || {};
  const a    = CardAttributes.get?.(cid) || {};

  const num = (v)=>{
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Prefer explicit “original” stamps from attributes, then DOM, then meta
  const ogP = num(a?.ptMod?.ogpow ?? el?.dataset?.baseP ?? meta.baseP ?? meta.power);
  const ogT = num(a?.ptMod?.ogtgh ?? el?.dataset?.baseT ?? meta.baseT ?? meta.toughness);

  const mP  = num(a?.ptMod?.pow);
  const mT  = num(a?.ptMod?.tgh);

  return { p: ogP + mP, t: ogT + mT };
}

function eff(cid){
  // accepts array of strings _or_ array of { ability }
  const lower = (arr)=> (arr||[]).map(v => {
    const s = (v && typeof v === 'object') ? v.ability : v;
    return String(s ?? '').toLowerCase().trim();
  });

  // Innate from DOM/meta (never changes)
  const innate = lower(getInnateEffects(cid));

  // Attributes module (may be stale unless CardAttributes re-fetched)
  const a = (CardAttributes.get?.(cid)) || {};
  const ogEff = lower(a.ogEffects);
  const perm  = lower(a.effects);
  const temps = lower(a.tempEffects);

  // Fresh DB snapshot if we preloaded it for combat (takes precedence)
  const snap = _battleAttrs.get(String(cid)) || {};
  const permFresh  = lower(snap.effects);
  const tempsFresh = lower(snap.tempEffects);

  const merged = [
    ...innate,
    ...ogEff,
    ...perm,  ...permFresh,
    ...temps, ...tempsFresh,
  ].filter(Boolean);



  // normalize common variants so checks never miss
  // e.g., "FirstStrike", "first-strike", "firststrike" → "first strike"
  const out = new Set();
  for (const k of merged){
    const t = k.replace(/[-_]/g,' ').replace(/\s+/g,' ').trim();
    if (t === 'firststrike')      out.add('first strike');
    else if (t === 'doublestrike')out.add('double strike');
    else                          out.add(t);
  }
  return out;
}

// --- Deterministic + Idempotent helpers ---
function _deathList(outcomes){
  const deaths = new Set();
  (outcomes||[]).forEach(o=>{
    if (o?.aDies && o?.attacker?.cid) deaths.add(String(o.attacker.cid));
    (o?.blockers||[]).forEach(b=>{ if (b?.dies && b?.cid) deaths.add(String(b.cid)); });
  });
  return Array.from(deaths);
}

// Every client runs local apply exactly once per (applyToken, hash)
async function _markLocalApplied(ctx, token, hash){
  ctx._applied = ctx._applied || new Set();
  const key = `${token}::${hash}`;
  if (ctx._applied.has(key)) return false;
  ctx._applied.add(key);
  return true;
}


function _outcomeHash(outcomes, selected){
  try {
    const key = (outcomes||[]).map((o,i)=>{
      const sel = (selected?.[i] === false) ? '0' : '1';
      const a = `${o?.attacker?.cid||''}:${o?.aDies?'1':'0'}`;
      const bs = (o?.blockers||[]).map(b=>`${b?.cid||''}:${b?.dies?'1':'0'}`).sort().join('|');
      const pl = `${o?.toPlayer||0}:${o?.poisonToPlayer||0}:${o?.lifeGain||0}`;
      return `${sel}::${a}::${bs}::${pl}`;
    }).sort().join('||');
    let h = 0; for (let i=0;i<key.length;i++){ h = ((h<<5)-h) + key.charCodeAt(i); h|=0; }
    return String(h);
  } catch { return '0'; }
}



function types(cid){
  const el   = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
  const meta = window.getCardDataById?.(cid) || {};
  const a    = CardAttributes.get?.(cid) || {};
  const snap = _battleAttrs.get(String(cid)) || {};

  // 1) DOM data-types (e.g., "Legendary Creature — Elf Druid" might also be split elsewhere)
  const domTypes = String(el?.dataset?.types || el?.getAttribute?.('data-types') || '')
    .split(/[ ,/]+/)
    .filter(Boolean);

  // 2) Parse from type_line ("Legendary Creature — Elf Druid")
  const typeLine = String(
    el?.dataset?.type_line ||
    el?.getAttribute?.('data-type_line') ||
    meta?.type_line || ''
  );
  const parsedTL = (()=> {
    if (!typeLine) return [];
    const [left, right] = typeLine.split('—').map(x => (x||'').trim());
    const supertypesAndTypes = left ? left.split(/\s+/).filter(Boolean) : [];
    const subtypes           = right ? right.split(/\s+/).filter(Boolean) : [];
    return [...supertypesAndTypes, ...subtypes];
  })();

  // 3) Attributes module
  const og   = Array.isArray(a.ogTypes)   ? a.ogTypes   : [];
  const cur  = Array.isArray(a.types)     ? a.types     : [];   // if you ever populate it
  const add  = Array.isArray(a.addedTypes)? a.addedTypes: [];
  const tmpA = Array.isArray(a.tempTypes) ? a.tempTypes.map(t => t?.type).filter(Boolean) : [];

  // 4) Fresh DB snapshot (combat-time)
  const addF  = Array.isArray(snap.addedTypes)? snap.addedTypes : [];
  const tmpF  = Array.isArray(snap.tempTypes) ? snap.tempTypes.map(t => t?.type).filter(Boolean) : [];

  // 5) Meta cache (some lists stamp an array already)
  const metaArr = Array.isArray(meta.types) ? meta.types : [];

  const all = [
    ...og, ...cur, ...add, ...tmpA,
    ...addF, ...tmpF,
    ...domTypes, ...parsedTL,
    ...metaArr,
  ].filter(Boolean).map(s => String(s).toLowerCase());

  return new Set(all);
}


function isCreature(cid){
  return types(cid).has('creature');
}

function hasLoyalty(cid){
  // Checks common stamps; harmless if absent
  try {
    const el = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
    if (el && el.dataset && (el.dataset.loyalty != null)) return true;

    const meta = window.getCardDataById?.(cid) || {};
    if (meta.loyalty != null) return true;

    // Some lists stamp 'planeswalker' types; if you want to allow those, keep this:
    if (types(cid).has('planeswalker')) return true;
  } catch {}
  return false;
}


function canAttack(cid){
  const e = eff(cid);
  const el = findCardEl(cid);
  if (!el || isTapped(el)) return false;

  // Require explicit creature type only (no artifacts, enchantments, etc.)
  if (!isCreature(cid)) return false;

  // Defender and summoning sickness gates
  if (e.has('defender')) return false;
  if (e.has('summoning sickness') && !e.has('haste')) return false;

  return true;
}


function canBlock(blockerCid, attackerCid){
  const ae = eff(attackerCid), be = eff(blockerCid);
  if (ae.has('flying') && !(be.has('flying') || be.has('reach'))) return false;
  return true;
}

// --- replace activeSeats() with this pair ---
// Build the same kind of payload Zones sees during drag/drop
function _cardPayloadForZone(cid){
  const el   = findCardEl(cid);
  const meta = window.getCardDataById?.(cid) || {};
  const attr = CardAttributes.get?.(cid) || {};

  // Base P/T stamped on the DOM when the card was created
  const baseP = (el && el.dataset.baseP != null) ? String(el.dataset.baseP) : (meta.baseP ?? meta.power ?? null);
  const baseT = (el && el.dataset.baseT != null) ? String(el.dataset.baseT) : (meta.baseT ?? meta.toughness ?? null);

  // Effects & types from DOM/attributes/cache
  const ogEffects = Array.isArray(getInnateEffects(cid)) ? getInnateEffects(cid) : (meta.ogEffects || []);
  const ogTypes   = Array.isArray(attr.ogTypes) ? attr.ogTypes : (meta.ogTypes || meta.types || []);

  return {
    id: String(cid),
    cid: String(cid),
    name: el?.dataset?.name || meta.name || String(cid),
    img:  getCardImgSrc(cid),
    baseP: baseP,             // string (can be "*", "?", etc.)
    baseT: baseT,             // string
    ogEffects,
    ogTypes,
    // keep a snapshot of current mods so resurrects still show right away
    ptMod: attr.ptMod ? { ...attr.ptMod } : undefined,
    types: ogTypes,           // Zones/open overlays expect .types sometimes
    seat: seatOfCard(cid) || getCardSeatFromDom(el) || mySeat()
  };
}


// Move via Zones; try known shapes, then fall back
async function _moveToZone(cid, to='graveyard'){
  const card = _cardPayloadForZone(cid);
  const seat = card.seat || mySeat();

  try {
    // v3 API (preferred)
    if (typeof Zones?.moveFromZone === 'function'){
      await Zones.moveFromZone({ seat, from:'table', to, card });
      return true;
    }
    // alt: single-call "move"
    if (typeof Zones?.move === 'function'){
      await Zones.move({ seat, from:'table', to, card });
      return true;
    }
    // alt: explicit remove/add pair
    if (typeof Zones?.remove === 'function' && typeof Zones?.add === 'function'){
      await Zones.remove({ seat, zone:'table', cid });
      await Zones.add({ seat, zone:to, card });
      return true;
    }
  } catch (err){
    console.warn('[Battle] Zones move error', { cid, to, seat, err });
  }

  // Last resort so combat can still proceed visually
  findCardEl(cid)?.remove();
  return false;
}



function seatCountFromV3(){
  // Drawer select is the source of truth in v3
  const sel = document.getElementById('playerCount');
  // try value, data-value, or selected option text
  const raw = sel?.value ?? sel?.dataset?.value ?? sel?.selectedOptions?.[0]?.textContent;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1) return n;

  // Fallback ➊: window.AppState (if you later expose one)
  try { if (Number.isFinite(window.AppState?.playerCount)) return window.AppState.playerCount; } catch {}

  // Fallback ➋: old heuristic (life-strip present seats)
  const seats = Array.from(document.querySelectorAll('[data-seat][data-field="life"]'))
    .map(n => Number(n.dataset.seat))
    .filter(Number.isFinite);
  return Math.max(1, ...seats, 2); // default to 2 if nothing found
}

function activeSeats(){
  const n = seatCountFromV3();
  return Array.from({ length: n }, (_, i) => i + 1);
}

function mySeat(){
  return Number(document.getElementById('mySeat')?.value || '1');
}
function resolveDefenderSeat(attackerSeat){
  const seats = activeSeats().filter(s=>s!==attackerSeat);
  return seats[0] || 2;
}

async function sb(){ return supabase || (supabase = await supaReady); }
const TABLE = 'battle_state';

// place this above `const BattleUI = {`
function getInnateEffects(cid){
  const el = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
  // 1) DOM dataset ogEffects (JSON)
  try {
    const raw = el?.dataset?.ogEffects ? JSON.parse(el.dataset.ogEffects) : [];
    if (Array.isArray(raw)) return raw;
  } catch {}
  // 2) v3 CID cache
  try {
    const meta = window.getCardDataById?.(cid);
    const raw = Array.isArray(meta?.ogEffects) ? meta.ogEffects : [];
    return raw;
  } catch {}
  return [];
}

// keep the old API for tooltips/titles
function innateEffectsLine(cid){
  return getInnateEffects(cid).join(' • ');
}

// --- Seat + tap helpers (robust) ---
function getCardSeatFromDom(el){
  if (!el) return NaN;
  // card-level stamps (prefer these)
  if (el.dataset?.seat)   return Number(el.dataset.seat);
  if (el.dataset?.owner)  return Number(el.dataset.owner);     // v3 stamp
  if (el.dataset?.ownerSeat) return Number(el.dataset.ownerSeat);
  // inherit from nearest wrapper
  const host = el.closest('[data-seat],[data-owner],[data-owner-seat]');
  const v = host?.dataset?.seat ?? host?.dataset?.owner ?? host?.dataset?.ownerSeat;
  return v ? Number(v) : NaN;
}
function seatOfCard(cid){
  const el = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
  const s = getCardSeatFromDom(el);
  if (Number.isFinite(s)) return s;
  try {
    const z = window.Zones?.seatOfCard?.(cid);
    if (Number.isFinite(z)) return z;
  } catch {}
  return NaN;
}
function isTapped(el){
  if (!el) return false;
  if (el.classList.contains('tapped')) return true;        // normal path
  // fallback: check the CSS var used for rotation in v3
  const v = el.style.getPropertyValue('--tap-rot') ||
            getComputedStyle(el).getPropertyValue('--tap-rot');
  if (!v) return false;
  const t = String(v).trim();
  return t !== '' && t !== '0' && t !== '0deg';
}

function tapCard(cid, on = true){
  const el = findCardEl(cid);
  if (!el) return;

  const wasTapped = el.classList.contains('tapped');
  if (on){
    el.classList.add('tapped');
    try { el.style.setProperty('--tap-rot', '90deg'); } catch{}
  } else {
    el.classList.remove('tapped');
    try { el.style.setProperty('--tap-rot', '0deg'); } catch{}
  }

  // broadcast only if the state actually changed
  if (wasTapped !== !!on){
    try { window.RTC?.send?.({ type:'tap', cid, tapped:on }); } catch{}
  }
}


const BattleUI = {
  roomId:null, seat:1, role:null,
  attackers:[], blockers:{},
  _poll:null, _outcomePanel:null, _lastStateHash:'',

  async init({ roomId, seat }){
    this.roomId = roomId; this.seat = Number(seat)||1;
    document.getElementById('battleBtn')?.addEventListener('click', ()=>this.openRolePrompt());
    this._ensurePoller(); // global watcher so everyone sees outcome overlays
    console.log('[Battle] init', { roomId, seat:this.seat });
  },

async _maybeLocalApply(state, precomputedHash){
  const token = state?.meta?.applyToken || state?.meta?.createdAt || '0';
  const hash  = precomputedHash || _outcomeHash(state?.outcomes || [], state?.selected || []);
  const ok = await _markLocalApplied(this, token, hash);
  if (!ok) return; // already applied locally

  try {
    await this._apply(state); // does DOM/Zones/Life work locally
    console.log('[Battle][Apply] Local apply complete on seat', this.seat, 'token:', token, 'hash:', hash);
  } catch (e){
    console.warn('[Battle][Apply] Local apply failed', e);
  }
},


  openRolePrompt(){
    openPanel({
      title:'Combat',
      html:`<div class="row" style="flex-direction:column;gap:10px">
        <button class="pill" data-r="attacker">⚔️ I am Attacking</button>
        <button class="pill" data-r="defender">🛡️ I am Defending</button>
      </div>`,
      onAttach:(p)=>{
        p.querySelector('[data-r="attacker"]').onclick=()=>{ closePanel(p); this.role='attacker'; this.pickAttackers(); };
        p.querySelector('[data-r="defender"]').onclick=()=>{ closePanel(p); this.role='defender'; this.waitForAttackers(); };
      }
    });
  },




async pickAttackers(){
    const mySeat = this.seat;
    const pool = $$(`.card[data-cid]`).filter(el =>
      getCardSeatFromDom(el) === mySeat &&
      !isTapped(el) &&
      canAttack(el.dataset.cid)
    );

await _preloadBattleAttrs(pool.map(el => el.dataset.cid));

    if (!pool.length){ Overlays.notify?.('warn','No untapped creatures can attack.'); return; }

    const html = `<div class="battleGrid">${
      pool.map(el=>{
        const cid = el.dataset.cid, name = el.dataset.name || cid, pt = PT(cid);
        const src = getCardImgSrc(cid);
        const kws = Array.from(eff(cid));
        return `<div class="bcard js-b" data-cid="${cid}" title="${name}">
          <div class="art" style="background-image:${src ? `url('${src}')` : 'none'}"></div>
          <div class="meta"><span>${pt.p}/${pt.t}</span><span>${name}</span></div>
          ${kws.length ? `<div class="kw">${kws.map(k=>`<div>${k}</div>`).join('')}</div>` : ''}
        </div>`;
      }).join('')
    }</div>`;

    const panel = openPanel({ title:'Choose Attackers', html, footer:`<button class="pill" id="ok">Confirm Attackers</button>` });

    $$('.js-b', panel).forEach(n=>{
      n.onclick = ()=>{
        const cid = n.dataset.cid;
        if (seatOfCard(cid) !== this.seat) return; // ignore wrong-seat clicks
        n.classList.toggle('selected');
      };
    });

    panel.querySelector('#ok').onclick = async ()=>{
      const sel = $$('.js-b.selected', panel).map(n=>n.dataset.cid);
      if (!sel.length) return Overlays.notify?.('warn','Pick at least one attacker.');

      closePanel(panel);
      this.attackers = sel;

      // Persist the combat start with the ATTACKER'S SEAT recorded
      await this._save({
        phase: 'waiting_for_blocks',
        attackers: sel,
        attackerSeat: this.seat,
        blockers: {},
        outcomes: [],
        confirmations: {},
        applyBy: null,
        meta: { createdAt: Date.now() }
      });

      // Heads-up for the other client(s)
      try { window.RTC?.send?.({ type:'combat_init', bySeat: this.seat, attackers: sel }); } catch {}

      this.waitForBlocks();
    };
  },


  waitForAttackers(){
    Overlays.notify?.('info','Waiting for attackers…');
    const tid = setInterval(async ()=>{
      const s = await this._load();
      if (s?.phase === 'waiting_for_blocks' && Array.isArray(s.attackers) && s.attackers.length){
        clearInterval(tid);
        this.attackers = s.attackers;
        this.pickBlockers();
      }
    }, 1200);
  },

  // Attacker-side: after choosing attackers, just wait for the defender to assign blocks.
  waitForBlocks(){
    Overlays.notify?.('info','Waiting for blocks…');

    // Poll until the defender publishes outcomes.
    const tid = setInterval(async () => {
      const s = await this._load();
      if (!s) return;

      // Defender will move the phase to 'outcome_ready' after locking blocks.
      if (s.phase === 'outcome_ready') {
        clearInterval(tid);
        // Store any synced pieces so reopens are consistent
        if (Array.isArray(s.attackers)) this.attackers = s.attackers;
        if (s.blockers) this.blockers = s.blockers;
        this._openOrRefreshOutcomeOverlay(s);
      }
    }, 1200);
  },


async pickBlockers(){
const attackers = this.attackers.slice();
const mySeat = this.seat;

const blockersAll = $$(`.card[data-cid]`).filter(el =>
  getCardSeatFromDom(el) === mySeat &&
  !isTapped(el) &&
  isCreature(el.dataset.cid)
);


// NEW: make sure we read current keywords (e.g., removed Flying) for both sides
await _preloadBattleAttrs([...attackers, ...blockersAll.map(b => b.dataset.cid)]);


  const chosen = {}; // atk -> [blk order]


  const html = attackers.map(atk=>{
    const name = findCardEl(atk)?.dataset?.name || window.getCardDataById?.(atk)?.name || atk;

    const pt   = PT(atk);
    const akws = Array.from(eff(atk));  // ← attacker effects (normalized)

    const buttons = blockersAll.map(b=>{
      const bid = b.dataset.cid;
      const ok = canBlock(bid, atk);
      const src = getCardImgSrc(bid);
      const kws = Array.from(eff(bid));
      const bpt = PT(bid);

      return `
        <button class="blkBtn js-assign" data-atk="${atk}" data-blk="${bid}" ${ok?'':'disabled'}
                style="display:flex;align-items:flex-start;gap:8px">
          <span style="
            width:28px;height:40px;flex:0 0 28px;
            background:${src ? `url('${src}')` : '#222'};
            background-size:cover;background-position:center;
            border-radius:4px"></span>
          <span class="blkMeta">
            <div class="blkTop">
              <span class="blkPT">${bpt.p}/${bpt.t}</span>
              <span class="blkName">${b.dataset?.name || window.getCardDataById?.(bid)?.name || bid}</span>

            </div>
            ${kws.length ? `<div class="kw">${kws.map(k=>`<div>${k}</div>`).join('')}</div>` : ''}
          </span>
        </button>`;
    }).join('') + `<button class="blkBtn warn js-none" data-atk="${atk}">No blocks</button>`;

    return `<div class="atk-row" data-atk="${atk}" style="margin-bottom:10px">
      <div style="font-weight:900;margin-bottom:4px">${name} — ${pt.p}/${pt.t}</div>
      ${akws.length ? `<div class="kw" style="margin:0 0 6px 0">${akws.map(k=>`<div>${k}</div>`).join('')}</div>` : ''}
      <div class="row" style="gap:6px;flex-wrap:wrap">${buttons}</div>
    </div>`;
  }).join('');

  const panel = openPanel({
    title:'Assign Blockers (click order = damage order)',
    html, footer:`<button class="pill" id="ok">Confirm Blocks</button>`,
    onAttach:(p)=>{
      const used = new Set();

      $$('.js-assign', p).forEach(btn=>{
        btn.onclick = ()=>{
          const atk=btn.dataset.atk, blk=btn.dataset.blk;
          if (used.has(blk) && !btn.classList.contains('active')) return;
          chosen[atk] = chosen[atk] || [];
          if (btn.classList.toggle('active')){ chosen[atk].push(blk); used.add(blk); }
          else { chosen[atk] = chosen[atk].filter(x=>x!==blk); used.delete(blk); }
        };
      });

      $$('.js-none', p).forEach(btn=>{
        btn.onclick=()=>{
          const atk=btn.dataset.atk;
          (chosen[atk]||[]).forEach(blk=>{
            used.delete(blk);
            p.querySelector(`.js-assign[data-atk="${atk}"][data-blk="${blk}"]`)?.classList.remove('active');
          });
          chosen[atk]=[];
        };
      });

      p.querySelector('#ok').onclick = async ()=>{
        closePanel(p);
        this.blockers = chosen;

        // Keep the original attacker's seat (state set by attacker)
        const stateBefore = await this._load();
        const attackerSeat = Number(stateBefore?.attackerSeat) || Number(this.seat) || 1;

        const outcomes = this._computeAll();

        // defaults: everything checked, confirmations reset
        const seats = activeSeats();
        const confirmations = Object.fromEntries(seats.map(s => [String(s), false]));
        const selected = outcomes.map(() => true);
        const deathList = _deathList(outcomes);

        await this._save({
          phase: 'outcome_ready',
          attackers,
          attackerSeat,
          blockers: chosen,
          outcomes,
          selected,
          confirmations,
          applyBy: null,
          deathList,
          meta: { createdAt: Date.now(), appliedHash: null, applyToken: null }
        });

        Overlays.notify?.('ok','Blocks locked. Waiting for everyone to confirm outcome…');
      };
    }
  });
},


  // ===== Outcome engine (supports FS/DS/Trample/Lifelink/Deathtouch/Indestructible/Infect) =====
  _calcOneBattle(attackerCid, blkList){
    const A = { cid: attackerCid, name: findCardEl(attackerCid)?.dataset.name||attackerCid, pt: PT(attackerCid), eff: eff(attackerCid), types: types(attackerCid) };
    const Bs = (blkList||[]).map(cid=>({ cid, name: findCardEl(cid)?.dataset.name||cid, pt: PT(cid), eff: eff(cid), types: types(cid) }));

    const steps = [];
    let toPlayer = 0, poisonToPlayer = 0, lifeGain = 0;

    const deathtouch = (s)=>s.has('deathtouch');
    const indestruct = (s)=>s.has('indestructible');
    const lifelink = (s)=>s.has('lifelink');
    const first = A.eff.has('first strike') || A.eff.has('firststrike');
    const dbl = A.eff.has('double strike') || A.eff.has('doublestrike');
    const infect = A.eff.has('infect') || A.eff.has('wither');
    const trample = A.eff.has('trample');

    function dealFromAttacker(ptPower, phase){
  let dealtThisStep = 0;

  if (!Bs.length){
    if (infect){ poisonToPlayer += ptPower; }
    else       { toPlayer       += ptPower; }
    dealtThisStep += ptPower;
    steps.push(`[${phase}] ${A.name} deals ${ptPower}${infect?' infect (poison)':''} to player`);
  } else {
    let dmgLeft = ptPower;
    for (const B of Bs){
      if (dmgLeft<=0) break;

      // sustained damage across steps/orders
      const already = Math.max(0, B._taken || 0);
      const remainingToughness = Math.max(0, (B.pt.t|0) - already);
      const lethal = deathtouch(A.eff) ? 1 : remainingToughness;
      const assign = Math.min(dmgLeft, lethal);
      if (assign <= 0) continue;

      B._taken = already + assign;
if (deathtouch(A.eff) && assign > 0) B._touchedByDT = true;  // ← lethal touch mark
dmgLeft -= assign;
dealtThisStep += assign;

steps.push(`[${phase}] ${A.name} assigns ${assign} to ${B.name}${deathtouch(A.eff)?' (deathtouch)':''}` +
           (remainingToughness>0 ? ` [remaining→${Math.max(0, remainingToughness-assign)}]` : ''));

    }

    // excess goes to player only if trample
    if (trample && dmgLeft>0){
      if (infect){ poisonToPlayer += dmgLeft; }
      else       { toPlayer       += dmgLeft; }
      dealtThisStep += dmgLeft;
      steps.push(`[${phase}] trample → ${dmgLeft}${infect?' infect (poison)':''} to player`);
    }
  }

  // lifelink = life gained equals actual damage dealt this step
  if (lifelink(A.eff) && dealtThisStep>0){
    lifeGain += dealtThisStep;
    steps.push(`[${phase}] Attacker gains ${dealtThisStep} life (lifelink)`);
  }
}




    function blockersStrike(phase, { onlyFS=false, normalStep=false } = {}){
  for (const B of Bs){
    if (B._deadFirst && normalStep) continue;

    const hasFS = _hasFS(B.eff);
    const hasDS = _hasDS(B.eff);

    if (onlyFS && !hasFS) continue;
    if (normalStep && hasFS && !hasDS) continue;

    const power = Math.max(0, B.pt.p);
    if (power<=0) continue;

    A._taken = (A._taken||0) + power;
    if (deathtouch(B.eff) && power>0) A._touchOfDeath = true;   // ← add this

    steps.push(`[${phase}] ${B.name} deals ${power} to ${A.name}${deathtouch(B.eff)?' (deathtouch)':''}`);
  }
}




    const atkHasFS = _hasFS(A.eff);
const atkHasDS = _hasDS(A.eff);
const anyBlkFS = Bs.some(b => _hasFS(b.eff));

// First-strike step
if (atkHasFS) dealFromAttacker(Math.max(0, A.pt.p), 'first');
if (anyBlkFS) blockersStrike('first', { onlyFS:true });

// Mark deaths after first-strike
Bs.forEach(B=>{
  B._deadFirst = !indestruct(B.eff) && ( ((B._taken||0) >= B.pt.t) || !!B._touchedByDT );
});
const aDeadFirst = !indestruct(A.eff) && ( ((A._taken||0) >= A.pt.t) || !!A._touchOfDeath );



// Normal step
// Attacker swings in normal if:
//  - it didn't have FS, OR it has DS; AND
//  - it survived first-strike
if ((!atkHasFS || atkHasDS) && !aDeadFirst){
  dealFromAttacker(Math.max(0, A.pt.p), 'normal');
}

// Blockers swing in normal if they are:
//  - alive after first-strike, AND
//  - either (no FS) OR (have DS)
if (!aDeadFirst){
  blockersStrike('normal', { normalStep:true });
}

// Final death flags
const aDies = !indestruct(A.eff) && ( ((A._taken||0) >= A.pt.t) || !!A._touchOfDeath );

Bs.forEach(B=>{
  B.dies = !indestruct(B.eff) && ( ((B._taken||0) >= B.pt.t) || !!B._touchedByDT );
});




    return { attacker:A, blockers:Bs, toPlayer, poisonToPlayer, lifeGain, aDies, steps };
  },



  _computeAll(){
    const results = [];
    for (const atk of this.attackers){
      results.push(this._calcOneBattle(atk, this.blockers[atk] || []));
    }
    return results;
  },

  // ---------- GLOBAL POLLER: opens/updates outcome overlay for everyone ----------
  _ensurePoller(){
    if (this._poll) return;
    this._poll = setInterval(async ()=>{
      const s = await this._load();
      if (!s) return;

      const hash = JSON.stringify(s);
      if (hash === this._lastStateHash) return;
      this._lastStateHash = hash;

      // keep our local refs in sync (helps re-open/refresh overlays)
      if (Array.isArray(s.attackers)) this.attackers = s.attackers;
      if (s.blockers) this.blockers = s.blockers;

      if (s.phase === 'outcome_ready'){
        this._openOrRefreshOutcomeOverlay(s);
      } else if (s.phase === 'applying'){
  if (this._outcomePanel) {
    this._renderOutcomeOverlay(this._outcomePanel, s, { locked:true });
  }

  // Every client applies locally once per token/hash
  const applyHash = _outcomeHash(s.outcomes || [], s.selected || []);
  this._maybeLocalApply(s, applyHash);

  // Watchdog: if applying is stuck > 8000ms, try to finalize as follower
  try {
    const started = Number(s?.meta?.applyStartedAt) || 0;
    if (started && (Date.now() - started > 8000)) {
      // If appliedHash already set, just flip to done
      if (s?.meta?.appliedHash && s.meta.appliedHash === applyHash) {
        await this._save({ ...s, phase:'done' });
      } else {
        // We rerun local apply (idempotent) and finalize
        await this._maybeLocalApply(s, applyHash);
        await this._save({ ...s, phase:'done', meta: { ...(s.meta||{}), appliedHash: applyHash } });
      }
    }
  } catch (e){
    console.warn('[Battle][Watchdog] finalize error', e);
  }

} else if (s.phase === 'done'){

        if (this._outcomePanel){ closePanel(this._outcomePanel); this._outcomePanel = null; }
      }
    }, 1000);
  },

  _openOrRefreshOutcomeOverlay(state){
    // If our cached panel was closed/removed, forget it so we can recreate
    if (this._outcomePanel && !this._outcomePanel.isConnected){
      this._outcomePanel = null;
    }

    if (!this._outcomePanel){
      this._outcomePanel = openPanel({
        title:'Combat Outcome (All players must confirm)',
        html:`<div class="outcome"></div>`,
        onAttach:(p)=>{
          // When user clicks the panel's Close, it will be removed from DOM.
          // Next poll tick sees isConnected === false and will recreate.
          this._renderOutcomeOverlay(p, state);
        }
      });
    } else {
      this._renderOutcomeOverlay(this._outcomePanel, state);
    }
  },


  _renderOutcomeOverlay(panel, state, { locked=false } = {}){
  const wrap = panel.querySelector('.outcome');
  if (!wrap) return;

  const outcomes = state.outcomes || [];
  const seats = activeSeats();
  const conf = state.confirmations || {};
  const allConfirmed = seats.every(s => !!conf[String(s)]);
  const attackerSeat = Number(state?.attackerSeat) || 1;

  // use mask; default to all true
  const selected = Array.isArray(state.selected) ? state.selected.slice() : outcomes.map(()=>true);

  // normalize lengths
  while (selected.length < outcomes.length) selected.push(true);
  if (selected.length > outcomes.length) selected.length = outcomes.length;

  // live “what dies” if applied now
  const filtered = outcomes.filter((_,i) => selected[i] !== false);
  const liveDeathList = _deathList(filtered); // eslint helper var (kept for debug)

  const rows = outcomes.map((o, i)=>{
    const checked = selected[i] !== false;
    // helper to print "P# Name"
const _pn = (cid, fallback) => {
  const el = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
  const seat = getCardSeatFromDom(el) || seatOfCard(cid) || '?';
  const name = el?.dataset?.name || window.getCardDataById?.(cid)?.name || fallback || String(cid);
  return `P${seat} ${name}`;
};

const name = _pn(o.attacker.cid, o.attacker.name);
const blkNames = (o.blockers||[]).map(b=>_pn(b.cid, b.name)).join(', ') || 'Unblocked';
const deaths = [
  (o.aDies ? `${_pn(o.attacker.cid, o.attacker.name)} dies` : null),
  ...(o.blockers||[])
    .filter(b=>b.dies)
    .map(b=>`${_pn(b.cid, b.name)} dies`)
].filter(Boolean).join(' • ') || 'No deaths';

    const playerLine = (o.poisonToPlayer>0) ? `Player gets ${o.poisonToPlayer} poison`
                       : (o.toPlayer>0)     ? `Player takes ${o.toPlayer} damage`
                       : 'No player damage';
    const ll = o.lifeGain>0 ? `Attacker gains ${o.lifeGain} life` : '';
    return `
      <label class="outRow ${locked?'disabled':''}">
        <input type="checkbox" data-oi="${i}" ${checked?'checked':''} ${locked?'disabled':''}/>
        <div class="pill" style="display:block; flex:1; padding:8px;">
          <div style="font-weight:800">${name} vs ${blkNames}</div>
          <div>${playerLine}${ll?` — ${ll}`:''}</div>
          <div>${deaths}</div>
        </div>
      </label>
    `;
  }).join('');

  const who = seats.map(s=>{
    const ok = !!conf[String(s)];
    return `<span class="seatBadge ${ok?'confirmed':'pending'}">P${s}: ${ok?'Confirmed':'Pending'}</span>`;
  }).join('');

  const buttons = seats.map(s=>{
    const mine = (s === this.seat);
    const ok = !!conf[String(s)];
    const dis = (locked || ok) ? 'disabled' : '';
    return `<button class="pill" data-seat="${s}" ${mine?'':'disabled'} ${dis}>Confirm P${s}</button>`;
  }).join(' ');

  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      ${rows || '<div>No outcome computed.</div>'}
      <div class="outcome-who">${who}</div>
      <div class="row" style="gap:8px;justify-content:flex-end">${buttons}</div>
      ${locked?'<div style="opacity:.8">Applying…</div>':''}
      ${allConfirmed && !locked?'<div style="opacity:.8">All confirmed. Waiting for apply…</div>':''}
    </div>
  `;

  // checkbox behavior: save mask + recompute deathList + reset confirmations
wrap.querySelectorAll('input[type="checkbox"][data-oi]').forEach(chk=>{
  chk.onchange = async ()=>{
    const idx = Number(chk.dataset.oi);
    const cur = await this._load() || {};
    const sel = Array.isArray(cur.selected) ? cur.selected.slice() : (cur.outcomes||[]).map(()=>true);
    sel[idx] = !!chk.checked;

    // Recompute deaths based on current selection
    const filt = (cur.outcomes||[]).filter((_,i)=> sel[i] !== false);
    const newDeaths = _deathList(filt);

    // Reset confirmations (everyone must re-confirm after a change)
    const seats = activeSeats();
    const resetConf = Object.fromEntries(seats.map(s => [String(s), false]));

    // Persist
    await this._save({
      ...cur,
      phase: 'outcome_ready',
      selected: sel,
      deathList: newDeaths,
      confirmations: resetConf,
      // scrub any prior apply metadata to be safe
      meta: { ...(cur.meta||{}), appliedHash: null, applyToken: null, applyStartedAt: null }
    });

    // Re-render
    const again = await this._load();
    this._renderOutcomeOverlay(panel, again, { locked:false });
  };
});


  // my confirm button (same flow, but hashes include selected)
  wrap.querySelectorAll('button[data-seat]').forEach(btn=>{
    const seat = Number(btn.dataset.seat);
    if (seat !== this.seat) return;

    btn.onclick = async ()=>{
      const s1 = await this._load() || {};
      const conf2 = { ...(s1.confirmations||{}) };
      conf2[String(this.seat)] = true;
      await this._save({ ...s1, phase:'outcome_ready', confirmations: conf2 });

      const s2 = await this._load();
      const seatsAll = activeSeats();
      const allNow = seatsAll.every(x => !!s2?.confirmations?.[String(x)]);
      if (!allNow) return;

      const hash = _outcomeHash(s2.outcomes || [], s2.selected || []);
      const token = s2?.meta?.applyToken || (s2?.meta?.createdAt || Date.now());

      if (s2?.meta?.appliedHash && s2.meta.appliedHash === hash){
        await this._save({ ...s2, phase:'done' });
        return;
      }

      await this._save({
        ...s2,
        phase:'applying',
        applyBy: this.seat,
        meta: { ...(s2.meta||{}), applyToken: token, applyStartedAt: Date.now() }
      });

      try {
        window.RTC?.send?.({
          type: 'battle:apply',
          hash,
          state: await this._load()
        });
      } catch(e){ console.warn('[RTC] send battle:apply failed', e); }

      const s3 = await this._load();
      if (!s3 || s3.phase !== 'applying') return;
      const leaderSeat = s3.applyBy;

      await this._maybeLocalApply(s3, hash);

      if (this.seat === leaderSeat){
        await this._save({ ...s3, phase:'done', meta: { ...(s3.meta||{}), appliedHash: hash } });
        try { window.RTC?.send?.({ type: 'battle:done', hash }); } catch(e){}
      }
    };
  });
},


  // ----- APPLY (life/poison + deaths) -----
// ----- APPLY (life/poison + deaths) -----
// Pass full state to ensure seat correctness + idempotency
async _apply(state){
  // Use only CHECKED outcomes
  const selected = Array.isArray(state?.selected) ? state.selected : (state?.outcomes||[]).map(()=>true);
  const outcomesAll = state?.outcomes || [];
  const outcomes = outcomesAll.filter((_,i)=> selected[i] !== false);

  const attackerSeat = Number(state?.attackerSeat) || 1;
  const defenderSeat = resolveDefenderSeat(attackerSeat);
  const attackersRecorded = Array.isArray(state?.attackers) ? state.attackers.slice() : (this.attackers||[]);

  // death list from FILTERED outcomes (or use precomputed)
  const intendedDeaths = Array.isArray(state?.deathList)
    ? state.deathList.slice()
    : _deathList(outcomes);

  console.groupCollapsed('[Battle][Apply] Start');
  console.log('roomId:', this.roomId, 'applyBy seat:', this.seat, 'attackerSeat:', attackerSeat, 'defenderSeat:', defenderSeat);
  console.log('phase:', state?.phase, 'applyToken:', state?.meta?.applyToken);
  console.table(intendedDeaths.map(cid=>{
    const el = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
    const name = el?.dataset?.name || window.getCardDataById?.(cid)?.name || cid;
    return { cid, name, existsInDom: !!el, seat: getCardSeatFromDom(el) || seatOfCard(cid) || null };
  }));
  console.groupEnd();

  for (const cid of intendedDeaths){
    try { await _moveToZone(cid, 'graveyard'); }
    catch (err){ console.warn('[Battle][Apply] moveToZone failed', { cid, err }); }
  }

  let dmg=0, poison=0, heal=0;
  outcomes.forEach(o=>{ dmg+=o.toPlayer|0; poison+=o.poisonToPlayer|0; heal+=o.lifeGain|0; });

  // Only the apply leader mutates life/poison totals.
  // This prevents double application when multiple clients reach the 'applying' phase.
  const iAmLeader = Number(state?.applyBy) === Number(this.seat);

  try {
    if (iAmLeader) {
      if (poison>0){
        const cur = window.Life.get(defenderSeat);
        window.Life.set(defenderSeat, { poison: Math.max(0, (cur?.poison||0) + poison) });
      }
      if (dmg>0){
        const cur = window.Life.get(defenderSeat);
        window.Life.set(defenderSeat, { life: Math.max(0, (cur?.life||0) - dmg) });
      }
      if (heal>0){
        const cur = window.Life.get(attackerSeat);
        window.Life.set(attackerSeat, { life: (cur?.life||0) + heal });
      }
      console.log('[Battle][Apply] Leader applied totals', { dmg, poison, heal });
    } else {
      console.log('[Battle][Apply] Skipping life/poison (not leader)', { leader: state?.applyBy, me: this.seat });
    }
  } catch (err){
    console.warn('[Battle][Apply] life/poison update error', err);
  }


  const deadSet = new Set(intendedDeaths.map(String));
  attackersRecorded.forEach(cid=>{
    if (deadSet.has(String(cid))) return;
    const hasVigilance = eff(cid).has('vigilance');
    if (!hasVigilance) tapCard(cid, true);
  });

  console.groupCollapsed('[Battle][Apply] After');
  console.table(intendedDeaths.map(cid=>{
    const el = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
    const name = el?.dataset?.name || window.getCardDataById?.(cid)?.name || cid;
    return { cid, name, stillInDom: !!el };
  }));
  console.log('dmg:', dmg, 'poison:', poison, 'heal:', heal);
  console.groupEnd();

  Overlays.notify?.('ok','Combat applied.');
},



  // ----- Supabase -----
  async _save(patch){
    const c = await sb();
    // We only patch the JSON blob; keep one row per room
    const existing = await this._load();
    const json = { ...(existing||{}), ...patch };
    await c.from(TABLE).upsert({ room_id:this.roomId, json, updated_at:new Date().toISOString() }, { onConflict:'room_id' });
  },
  async _load(){
    const c = await sb();
    const { data } = await c.from(TABLE).select('*').eq('room_id', this.roomId).maybeSingle();
    return data?.json || null;
  }
};

window.BattleUI = BattleUI;
export default BattleUI;
