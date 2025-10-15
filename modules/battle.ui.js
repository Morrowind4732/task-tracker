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





function PT(cid){
  const a = CardAttributes.get(cid) || {};
  const ogP = Number(a?.ptMod?.ogpow ?? findCardEl(cid)?.dataset.baseP ?? 0);
  const ogT = Number(a?.ptMod?.ogtgh ?? findCardEl(cid)?.dataset.baseT ?? 0);
  const mP  = Number(a?.ptMod?.pow  ?? 0), mT = Number(a?.ptMod?.tgh ?? 0);
  return { p: ogP + mP, t: ogT + mT };
}
function eff(cid){
  const lower = (arr)=> (arr||[]).map(s => String(s).toLowerCase().trim());

  // pull from DOM/v3 cache (our reliable innate source)
  const innate = lower(getInnateEffects(cid));

  // also merge anything the attributes module might be tracking
  const a = (CardAttributes.get?.(cid)) || {};
  const merged = [
    ...innate,
    ...lower(a.ogEffects),
    ...lower(a.effects),
    ...lower(a.tempEffects),
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

function types(cid){
  const list = (CardAttributes.get(cid)?.ogTypes || []).map(s=>String(s).toLowerCase());
  return new Set(list);
}
function canAttack(cid){
  const e = eff(cid);
  const el = findCardEl(cid);
  if (!el || isTapped(el)) return false;
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
  return {
    cid,
    name: el?.dataset?.name || meta.name || String(cid),
    img:  getCardImgSrc(cid),
    types: Array.isArray(CardAttributes.get(cid)?.ogTypes)
      ? CardAttributes.get(cid).ogTypes
      : (meta.types || []),
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




  pickAttackers(){
   const mySeat = this.seat;
   const pool = $$(`.card[data-cid]`).filter(el =>
     getCardSeatFromDom(el) === mySeat &&
     !isTapped(el) &&
     canAttack(el.dataset.cid)
   );

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
      await this._save({
  phase: 'waiting_for_blocks',
  attackers: sel,
  blockers: {},
  outcomes: [],
  confirmations: {},
  applyBy: null,
  meta: { createdAt: Date.now() }
});

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


  pickBlockers(){
    const attackers = this.attackers.slice();
      const mySeat = this.seat; // I'm the defender when this UI opens
  const blockersAll = $$(`.card[data-cid]`).filter(el =>
    getCardSeatFromDom(el) === mySeat && !isTapped(el)
  );
    const chosen = {}; // atk -> [blk order]

    const html = attackers.map(atk=>{
      const name = findCardEl(atk)?.dataset.name || atk; const pt=PT(atk);
      const buttons = blockersAll.map(b=>{
  const bid = b.dataset.cid, ok = canBlock(bid, atk);
  const src = getCardImgSrc(bid);
  const kws = Array.from(eff(bid));
   // ← same helper used for attackers
  return `
    <button class="blkBtn js-assign" data-atk="${atk}" data-blk="${bid}" ${ok?'':'disabled'}
            style="display:flex;align-items:flex-start;gap:8px">
      <span style="
        width:28px;height:40px;flex:0 0 28px;
        background:${src ? `url('${src}')` : '#222'};
        background-size:cover;background-position:center;
        border-radius:4px"></span>
      <span class="blkMeta">
        <div class="blkName">${b.dataset.name || bid}</div>
        ${kws.length ? `<div class="kw">${kws.map(k=>`<div>${k}</div>`).join('')}</div>` : ''}
      </span>
    </button>`;
}).join('') + `<button class="blkBtn warn js-none" data-atk="${atk}">No blocks</button>`;


      return `<div class="atk-row" data-atk="${atk}" style="margin-bottom:10px">
        <div style="font-weight:900;margin-bottom:6px">${name} — ${pt.p}/${pt.t}</div>
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

  // Compute outcomes here (defender), then publish for everyone
  const outcomes = this._computeAll();
  const seats = activeSeats();
  const confirmations = Object.fromEntries(seats.map(s => [String(s), false]));

  await this._save({
    phase: 'outcome_ready',
    attackers,          // from pickBlockers() scope (const attackers = this.attackers.slice();)
    blockers: chosen,
    outcomes,
    confirmations,
    applyBy: null,
    meta: { createdAt: Date.now() }
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
      if (!Bs.length){
        if (infect){ poisonToPlayer += ptPower; steps.push(`[${phase}] ${A.name} deals ${ptPower} infect (poison) to player`); }
        else       { toPlayer += ptPower;       steps.push(`[${phase}] ${A.name} deals ${ptPower} to player`); }
        if (lifelink(A.eff)) { lifeGain += ptPower; steps.push(`[${phase}] Attacker gains ${ptPower} life (lifelink)`); }
        return;
      }
      let dmgLeft = ptPower;
      for (const B of Bs){
        if (dmgLeft<=0) break;
        const lethal = deathtouch(A.eff) ? 1 : Math.max(0, B.pt.t);
        const assign = Math.min(dmgLeft, lethal);
        B._taken = (B._taken||0) + assign;
        dmgLeft -= assign;
        steps.push(`[${phase}] ${A.name} assigns ${assign} to ${B.name}${deathtouch(A.eff)?' (deathtouch)':''}`);
      }
      if (trample && dmgLeft>0){
        if (infect){ poisonToPlayer += dmgLeft; steps.push(`[${phase}] trample → ${dmgLeft} infect to player`); }
        else       { toPlayer += dmgLeft;       steps.push(`[${phase}] trample → ${dmgLeft} to player`); }
      }
      if (lifelink(A.eff)) { lifeGain += ptPower; steps.push(`[${phase}] Attacker gains ${ptPower} life (lifelink)`); }
    }

    function blockersStrike(phase){
      for (const B of Bs){
        const power = Math.max(0, B.pt.p);
        if (power<=0) continue;
        A._taken = (A._taken||0) + power;
        steps.push(`[${phase}] ${B.name} deals ${power} to ${A.name}${deathtouch(B.eff)?' (deathtouch)':''}`);
      }
    }

    if (first){ dealFromAttacker(Math.max(0,A.pt.p), 'first'); }
    if (Bs.some(b=>b.eff.has('first strike')||b.eff.has('firststrike'))) blockersStrike('first');

    Bs.forEach(B=>{ B._deadFirst = (B._taken||0) >= B.pt.t && !indestruct(B.eff); });
    const aDeadFirst = (A._taken||0) >= A.pt.t && !indestruct(A.eff);

    if (!first || dbl){ dealFromAttacker(Math.max(0,A.pt.p), 'normal'); }
    if (!aDeadFirst){
      const livingBlockers = Bs.filter(b=>!b._deadFirst);
      for (const B of livingBlockers){
        if (B.eff.has('first strike')||B.eff.has('firststrike')) continue;
        const power = Math.max(0, B.pt.p);
        if (power<=0) continue;
        A._taken = (A._taken||0) + power;
        steps.push(`[normal] ${B.name} deals ${power} to ${A.name}${deathtouch(B.eff)?' (deathtouch)':''}`);
      }
    }

    const aDies = (A._taken||0) >= A.pt.t && !indestruct(A.eff);
    Bs.forEach(B=>B.dies = ((B._taken||0) >= B.pt.t) && !indestruct(B.eff));

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
        // make sure overlay shows "applying..." and disables controls
        if (this._outcomePanel) this._renderOutcomeOverlay(this._outcomePanel, s, { locked:true });
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

    const rows = outcomes.map((o)=>{
      const name = o.attacker.name;
      const blkNames = (o.blockers||[]).map(b=>b.name).join(', ') || 'Unblocked';
      const deaths = [
        o.aDies ? `${name} dies` : null,
        ...(o.blockers||[]).filter(b=>b.dies).map(b=>`${b.name} dies`)
      ].filter(Boolean).join(' • ') || 'No deaths';
      const playerLine = (o.poisonToPlayer>0) ? `Player gets ${o.poisonToPlayer} poison`
                         : (o.toPlayer>0)     ? `Player takes ${o.toPlayer} damage`
                         : 'No player damage';
      const ll = o.lifeGain>0 ? `Attacker gains ${o.lifeGain} life` : '';
      return `
        <div class="pill" style="display:block; padding:8px; margin-bottom:6px">
          <div style="font-weight:800">${name} vs ${blkNames}</div>
          <div>${playerLine}${ll?` — ${ll}`:''}</div>
          <div>${deaths}</div>
        </div>
      `;
    }).join('');

    const who = activeSeats().map(s=>{
      const ok = !!conf[String(s)];
      return `<span class="seatBadge ${ok?'confirmed':'pending'}">P${s}: ${ok?'Confirmed':'Pending'}</span>`;
    }).join('');

    const buttons = activeSeats().map(s=>{
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

    // bind my confirm button only
    wrap.querySelectorAll('button[data-seat]').forEach(btn=>{
      const seat = Number(btn.dataset.seat);
      if (seat !== this.seat) return;
      btn.onclick = async ()=>{
        // toggle to true (cannot unconfirm for now)
        const s = await this._load() || {};
        const conf2 = { ...(s.confirmations||{}) };
        conf2[String(this.seat)] = true;

        // if all confirmed after we set ours → try to apply
        const all = activeSeats().every(x => !!conf2[String(x)]);

        await this._save({
  ...s,
  // stay in outcome_ready while adding my confirmation
  phase: 'outcome_ready',
  confirmations: conf2
});

if (all){
  // --- Leader election and double-apply guard ---
  // 1) Re-read; only proceed if still outcome_ready
  const before = await this._load();
  if (!before || before.phase !== 'outcome_ready') return;

  // 2) Try to become the apply leader
  const leaderSeat = this.seat;
  await this._save({ ...before, phase:'applying', applyBy: leaderSeat });

  // 3) Verify we actually became leader
  const now = await this._load();
  if (!now || now.phase !== 'applying' || now.applyBy !== leaderSeat) return;

  // 4) Guard against re-entry
  this._applyGuardId = now?.meta?.createdAt || Date.now();
  if (this._lastAppliedId === this._applyGuardId) return;
  this._lastAppliedId = this._applyGuardId;

  try {
    await this._apply(now.outcomes || []);
    await this._save({ phase:'done' });
  } catch (e){
    console.warn('apply error', e);
    Overlays.notify?.('danger','Apply failed; finalizing round.');
    await this._save({ phase:'done' });
  }
}


      };
    });
  },

  // ----- APPLY (life/poison + deaths) -----
async _apply(chosen){
  // 1) Gather all deaths
  const deaths = [];
  chosen.forEach(o=>{
    if (o.aDies) deaths.push(o.attacker.cid);
    (o.blockers||[]).forEach(b=>{ if (b.dies) deaths.push(b.cid); });
  });

  // 2) Move each corpse from battlefield → graveyard through Zones (persists & syncs)
  for (const cid of deaths){
    await _moveToZone(cid, 'graveyard');
  }

  // 3) Life / poison / heal
  const atkSeat = this.seat;
  const defSeat = resolveDefenderSeat(atkSeat);
  let dmg=0, poison=0, heal=0;
  chosen.forEach(o=>{ dmg+=o.toPlayer; poison+=o.poisonToPlayer; heal+=o.lifeGain; });

  if (poison>0){
    const cur = window.Life.get(defSeat);
    window.Life.set(defSeat, { poison: Math.max(0, cur.poison + poison) });
  }
  if (dmg>0){
    const cur = window.Life.get(defSeat);
    window.Life.set(defSeat, { life: cur.life - dmg });
  }
  if (heal>0){
    const cur = window.Life.get(atkSeat);
    window.Life.set(atkSeat, { life: cur.life + heal });
  }

 // 4) Tap surviving attackers (unless they have Vigilance)
  const deadSet = new Set();
  chosen.forEach(o=>{
    if (o.aDies) deadSet.add(o.attacker.cid);
    (o.blockers || []).forEach(b => { if (b.dies) deadSet.add(b.cid); });
  });

  // Use the attackers that were recorded for this combat
  (this.attackers || []).forEach(cid => {
    if (deadSet.has(cid)) return;                  // died → don't tap (already moved)
    const hasVigilance = eff(cid).has('vigilance');
    if (!hasVigilance) tapCard(cid, true);         // rotate/tap
  });

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
