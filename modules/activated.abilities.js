// modules/activated.abilities.js
// v1 — Generic activation overlay (targets, effect builder, durations)
// Writes to your `card_attributes` table shape: { room_id, cid, owner_seat, json, updated_by_seat }
// No reliance on an `id` column or upsert onConflict; includes EOT / LINKED cleanup helpers.

import { supaReady } from './env.supabase.js';
import * as AD from './ability.detect.js'; // ← uses your 1:1 parser/actions
import { manaToHtml } from './tooltip.js';
let supabase = null; supaReady.then(c => supabase = c);
import './draw.rules.overlay.js';

// -------------------------------
// Small DOM helpers
// -------------------------------
const $$  = (s,r=document)=>Array.from(r.querySelectorAll(s));
const bySel = (s,r=document)=>r.querySelector(s);
const esc = (v)=>CSS.escape(String(v));
const findCardEl = (cid)=>document.querySelector(`.card[data-cid="${esc(cid)}"]`);
const mySeat = ()=> Number(document.getElementById('mySeat')?.value || window.AppState?.mySeat || '1');
const currentRoom = () =>
  window.CardAttributes?.roomId ||            // authoritative once init() ran
  window.ROOM_ID ||                           // what v3.html sets
  window.RTC?.roomId ||                       // if your RTC wrapper exposes it
  document.getElementById('roomId')?.value ||
  window.AppState?.room_id || 'room1';
const activeSeats = ()=>{
  const sel = document.getElementById('playerCount');
  const raw = sel?.value ?? sel?.dataset?.value ?? sel?.selectedOptions?.[0]?.textContent;
  const n = Number(raw);
  return Array.from({length: (Number.isFinite(n)&&n>=1)?n:2}, (_,i)=>i+1);
};



// Robust Oracle text getter (supports dash/underscore + cache fallbacks)
function getOracleForCid(cid){
  const el = findCardEl(cid);
  const a =
    el?.dataset?.oracle_text ||
    el?.getAttribute?.('data-oracle_text') ||
    el?.dataset?.oracleText ||
    el?.getAttribute?.('data-oracle-text') ||
    el?.dataset?.oracle ||
    el?.getAttribute?.('data-oracle') ||
    window.Zones?.getCardDataById?.(cid)?.oracle_text ||
    window.Zones?.getCardDataById?.(cid)?.oracle ||
    window.getCardDataById?.(cid)?.oracle_text ||
    window.getCardDataById?.(cid)?.oracle ||
    '';
  const s = String(a || '').trim();
  if (!s) console.warn('[Scan] No oracle text resolved for cid', cid, 'element:', el);
  return s;
}




// === Apply-tab prefill (radio + field, then switch to Apply tab) =======
function prefillApply(
  { mode = 'ability', value = '', camt = 1, dp = 0, dt = 0 },
  root = document
){
  // 1) switch to Apply tab
  const applyTabBtn = root.querySelector('.js-tab[data-tab="apply"]');
  applyTabBtn?.click?.();

  // 2) scope everything to the Apply pane
  const pane = root.querySelector('.pane-apply') || root;

  // 3) flip the Effect radio
  const radio = pane.querySelector(`input[name="mode"][value="${mode}"]`);
  if (radio){
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // 4) prefill fields per mode
  if (mode === 'ability'){
    const input = pane.querySelector('.js-abil');
    if (input){
      input.value = String(value || '').trim();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  if (mode === 'type'){
    const input = pane.querySelector('.js-typegrant-input');
    if (input){
      input.value = String(value || '').trim();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  if (mode === 'counter'){
    const kIn = pane.querySelector('.js-ckind');
    const nIn = pane.querySelector('.js-camt');
    if (kIn) kIn.value = String(value || '+1/+1').trim();
    if (nIn) nIn.value = String(Number.isFinite(+camt) ? +camt : 1);

    // ensure only the counter section is visible
    const show = sel => { const el = pane.querySelector(sel); if (el) el.style.display = '';   };
    const hide = sel => { const el = pane.querySelector(sel); if (el) el.style.display = 'none';};
    show('.js-counter'); hide('.js-pt'); hide('.js-ability'); hide('.js-typegrant');
  }

  if (mode === 'pt'){
    const pIn = pane.querySelector('.js-dp');
    const tIn = pane.querySelector('.js-dt');
    if (pIn) pIn.value = String(Number.isFinite(+dp) ? +dp : 0);
    if (tIn) tIn.value = String(Number.isFinite(+dt) ? +dt : 0);

    const show = sel => { const el = pane.querySelector(sel); if (el) el.style.display = '';   };
    const hide = sel => { const el = pane.querySelector(sel); if (el) el.style.display = 'none';};
    show('.js-pt'); hide('.js-counter'); hide('.js-ability'); hide('.js-typegrant');
  }
}


// === Token spawn shim (uses your normal V3 spawn path) =================
// NOTE: V3 already spawns to table via window.spawnCardAtViewCenter(card, seat)
//       We build a minimal "token card" payload with just a name. Replace
//       art/type fields later if you want full token art.
async function spawnTokenOnTable(tokenName, seat = mySeat()){
  const card = {
    id: `token:${tokenName}:${Date.now()}`,
    name: String(tokenName),          // ← no " Token" suffix
    type_line: 'Token',
    mana_cost: '',
    oracle_text: '',
    img: ''
  };
  window.spawnCardAtViewCenter?.(card, Number(seat) || 1);
}


// Search helpers: look up cards by an exact name, WITHOUT adding "token"
async function findCardCandidatesByName(raw){
  const q = String(raw||'').trim();
  if (!q) return [];
  const nameEq = (c)=> String(c?.name||'').toLowerCase() === q.toLowerCase();
  let res = [];

  // A) Zones-backed indices (prefer primary source if you have one)
  try{
    const Z = window.Zones;
    if (Z?.searchByName){
      const out = await Z.searchByName(q);
      if (Array.isArray(out)) res = out.slice();
    } else if (Z?.cardIndex?.byName && Z?.getCardDataById){
      const ids = Z.cardIndex.byName[q.toLowerCase()] || [];
      res = ids.map(id => Z.getCardDataById(id)).filter(Boolean);
    }
  }catch{}

  // B) Fallback pools (arrays or object maps)
  if (!res.length){
    try{
      const pools = [window.AllCards, window.CardDB, window.CARDS, window.Pool].filter(Boolean);
      for (const pool of pools){
        const arr = Array.isArray(pool) ? pool : Object.values(pool||{});
        res.push(...arr.filter(nameEq));
      }
    }catch{}
  }

  // C) If still nothing, query Scryfall (exact name + include tokens/extras)
  if (!res.length){
    try{
      // Prefer /cards/search with exact operator and token allowance
      const qstr =
        `!"${q}" (is:token or t:token) lang:en`; // exact name; make sure tokens are eligible
      const url =
        `https://api.scryfall.com/cards/search?order=set&dir=desc&include_extras=true&q=${encodeURIComponent(qstr)}`;
      const r = await fetch(url);
      if (r.ok){
        const j = await r.json();
        const data = Array.isArray(j.data) ? j.data : [];

        // Normalize to the shape your spawners expect
        const toPayload = (c)=>({
          id: c.id,
          name: c.name,
          set: c.set,
          collector_number: c.collector_number,
          type_line: c.type_line,
          mana_cost: c.mana_cost || '',
          oracle_text: c.oracle_text || '',
          image_uris: c.image_uris,
          img: (c.image_uris?.normal) ||
               (Array.isArray(c.card_faces) && c.card_faces[0]?.image_uris?.normal) || ''
        });

        res = data.map(toPayload);
      }
    }catch(e){
      console.warn('[Scryfall] search failed for', q, e);
    }
  }

  // D) De-dupe by (name|set|collector|id)
  const seen = new Set();
  res = res.filter(c=>{
    const key = [c?.name, c?.set, c?.collector_number, c?.id].filter(Boolean).join('|').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  return res;
}

// Lightweight picker overlay for found cards
function openNamePickOverlay({ query, candidates, copies=1, seat = mySeat(), onPick }){
  const grid = candidates.map((c,i)=>{
    const img = c.image_uris?.normal || c.img || c.image || '';
    const set = c.set?.toUpperCase?.() || '';
    const num = c.collector_number || '';
    return `
      <button class="cardpick" data-i="${i}" style="
        text-align:left; border:1px solid #2b3f63; border-radius:12px; padding:8px; background:#0f1829; color:#e7f0ff;
        display:grid; grid-template-columns:48px 1fr; gap:10px; cursor:pointer;">
        <span style="width:48px;height:64px;background:${img?`url('${img}') center/cover`:'#222'};border-radius:6px"></span>
        <span>
          <div style="font-weight:900">${c.name||'Card'}</div>
          <div style="opacity:.8;font-size:12px">${[set,num].filter(Boolean).join(' • ')}</div>
        </span>
      </button>`;
  }).join('');

  const html = `
    <div style="display:flex;align-items:center;gap:8px;justify-content:space-between">
      <div>Results for “${query}”</div>
      <div class="pill" title="How many to create" style="display:flex;gap:6px;align-items:center">
        × <input type="number" class="js-copies" value="${copies}" min="1" style="width:70px">
      </div>
    </div>
    <div class="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin-top:8px">
      ${grid || '<div style="opacity:.8">No results.</div>'}
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:8px">
      <button class="pill js-fallback" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
        Use simple “${query}”
      </button>
    </div>`;

  const panel = openPanel({
    title: `Choose “${query}”`,
    html,
    onAttach: (pnl)=>{
      const copiesInput = pnl.querySelector('.js-copies');
      pnl.querySelectorAll('.cardpick').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const idx = Number(btn.dataset.i||0);
          const n = Math.max(1, Number(copiesInput?.value||1)|0);
          const chosen = candidates[idx];
          try{
            for (let i=0;i<n;i++){
              if (typeof window.spawnCardAtViewCenter === 'function'){
                window.spawnCardAtViewCenter(chosen, Number(seat)||1);
              } else if (window.Zones?.spawnToTable){
                window.Zones.spawnToTable(chosen, Number(seat)||1);
              }
            }
          } finally {
            onPick?.(chosen, n);
            pnl._close?.();
          }
        });
      });
      pnl.querySelector('.js-fallback')?.addEventListener('click', ()=>{
        const n = Math.max(1, Number(copiesInput?.value||1)|0);
        for (let i=0;i<n;i++){
          spawnTokenOnTable(query, Number(seat)||1); // fallback stub
        }
        onPick?.(null, n);
        pnl._close?.();
      });
    }
  });

  return panel;
}


// === Health fallback UI (heal/hurt any seat with one amount picker) ====
function renderHealthFallback({ host, seats = activeSeats(), defaultAmount = 1 }){
  if (!host) return;
  // prevent duplicates if re-rendered
  if (host.querySelector('[data-health-fallback="1"]')) return;

  const wrap = document.createElement('div');
  wrap.dataset.healthFallback = '1';
  Object.assign(wrap.style, { display:'grid', gap:'8px', marginTop:'8px' });

  const title = document.createElement('div');
  title.textContent = 'Health Controls';
  Object.assign(title.style, { fontWeight: 900, opacity:.9 });
  wrap.appendChild(title);

  // single amount input (+ quick bumps) — keyboardless friendly
  const row = document.createElement('div');
  Object.assign(row.style, { display:'grid', gridTemplateColumns:'1fr auto auto', gap:'8px', alignItems:'center' });
  const amt = document.createElement('input'); amt.type='number'; amt.min='1'; amt.value=String(defaultAmount);
  Object.assign(amt.style, { background:'#0f1829', color:'#e7f0ff', border:'1px solid #2b3f63', borderRadius:'10px', padding:'8px' });
  const plus1 = document.createElement('button'); plus1.textContent = '+1';
  const plus5 = document.createElement('button'); plus5.textContent = '+5';
  [plus1, plus5].forEach(b=>{
    Object.assign(b.style, { background:'#1a2a45', color:'#cfe1ff', border:'1px solid #2b3f63', borderRadius:'10px', padding:'6px 10px', fontWeight:900, cursor:'pointer' });
  });
  plus1.onclick = ()=> amt.value = String((Number(amt.value||0)|0) + 1);
  plus5.onclick = ()=> amt.value = String((Number(amt.value||0)|0) + 5);
  row.append(amt, plus1, plus5);
  wrap.appendChild(row);

  const grid = document.createElement('div');
  Object.assign(grid.style, { display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:'8px' });
  wrap.appendChild(grid);

  const applyDelta = (seat, deltaSign)=>{
    const v = Math.max(1, Number(amt.value||0) | 0);
    const delta = deltaSign > 0 ? v : -v;
    // Use your existing adjuster if present; otherwise broadcast
    if (typeof window.adjustHealth === 'function'){
      window.adjustHealth(seat, delta);
    } else {
      window.sendRTC?.({ type:'health_delta', seat, delta });
    }
  };

  seats.forEach(s=>{
    const heal = document.createElement('button'); heal.textContent = `Heal P${s}`;
    const hurt = document.createElement('button'); hurt.textContent = `Hurt P${s}`;
    [heal,hurt].forEach(b=>{
      Object.assign(b.style, { background:'#1a2a45', color:'#cfe1ff', border:'1px solid #2b3f63', borderRadius:'10px', padding:'6px 10px', fontWeight:900, cursor:'pointer' });
    });
    heal.onclick = ()=> applyDelta(s, +1);
    hurt.onclick = ()=> applyDelta(s, -1);
    grid.append(heal, hurt);
  });

  host.appendChild(wrap);
  return wrap;
}


// -------------------------------
// Supabase row helpers
// -------------------------------
// NOTE: your table does NOT have `id`, and requires owner_seat NOT NULL.
// We mirror CardAttributes.set behavior: select/write { room_id, cid, json, owner_seat, updated_by_seat }.
async function ensureSupabase(){
  if (!supabase) supabase = await supaReady;
  return supabase;
}

async function fetchRow(room_id, cid){
  await ensureSupabase();
  const { data, error } = await supabase
    .from('card_attributes')
    .select('room_id, cid, json, owner_seat, updated_by_seat')
    .eq('room_id', room_id)
    .eq('cid', cid)
    .maybeSingle();
  if (error) {
    console.warn('[Activated] fetchRow error', error);
    return null;
  }
  return data || null;
}

// Update or Insert, always including owner_seat & updated_by_seat
async function upsertRow(room_id, cid, ownerSeat, updater){
  await ensureSupabase();
  const existing = await fetchRow(room_id, cid);

  const base0 = existing?.json;
  const base = (base0 && typeof base0 === 'object' && !Array.isArray(base0)) ? base0 : {};

  let next = updater(base) || base;
  if (!next || typeof next !== 'object' || Array.isArray(next)) next = {};

  const owner_seat = Number(existing?.owner_seat ?? ownerSeat ?? 1);

  const payload = {
    room_id,
    cid,
    owner_seat,
    json: next,
    updated_by_seat: Number(ownerSeat ?? mySeat() ?? owner_seat)
  };

  const { error } = await supabase.from('card_attributes').upsert(payload);
  if (error) console.error('[Activated] upsert error', error);
  return next;
}

function ensurePlainObject(v){
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}


// -------------------------------
/* JSON shape helpers (we keep it simple + reversible for temp) */
// -------------------------------
const ensure = (obj, key, init)=> (obj[key] ??= (typeof init === 'function' ? init() : init));

function appendTempPT(json, { pow=0, tgh=0, sourceCid, mode }){
  const tp = ensure(json, 'tempPT', ()=>[]);
  const id = 'tpt_'+Math.random().toString(36).slice(2);
  tp.push({ id, pow:Number(pow)||0, tgh:Number(tgh)||0, sourceCid: sourceCid||null, mode }); // mode: 'EOT'|'LINKED'
  // also apply to ptMod so existing PT() sees it immediately
  const pm = ensure(json, 'ptMod', ()=>({ pow:0, tgh:0 }));
  pm.pow = (Number(pm.pow)||0) + (Number(pow)||0);
  pm.tgh = (Number(pm.tgh)||0) + (Number(tgh)||0);
  return id;
}

function appendTempAbility(json, { ability, sourceCid, mode }){
  const te = ensure(json, 'tempEffects', ()=>[]);
  const id = 'tef_'+Math.random().toString(36).slice(2);
  const cap = String(ability||'')
    .trim()
    .split(/\s+/).map(w => w ? (w[0].toUpperCase()+w.slice(1).toLowerCase()) : '').join(' ');
  te.push({ id, ability: cap, sourceCid: sourceCid||null, mode }); // 'EOT'|'LINKED'
  return id;
}

function addPermanentCounter(json, kind, n){
  Object.assign(json, ensurePlainObject(json));

  let arr = json.counters;
  if (Array.isArray(arr)) {
    // ok
  } else if (arr && typeof arr === 'object') {
    arr = Object.entries(arr).map(([name, qty]) => ({ name, qty:Number(qty)||0 }));
  } else {
    arr = [];
  }

  const name = String(kind || '+1/+1');
  const add  = Number(n) || 0;

  const idx = arr.findIndex(c => c && String(c.name || '').toLowerCase() === name.toLowerCase());
  if (idx >= 0) {
    arr[idx].qty = Math.max(0, Number(arr[idx].qty || 0) + add);
  } else {
    arr.push({ name, qty: Math.max(0, add) });
  }

  json.counters = arr.filter(c => Number(c.qty) > 0);
  return json;
}




function addPermanentAbility(json, ability){
  Object.assign(json, ensurePlainObject(json));
  const a = ensure(json, 'effects', ()=>[]);
  const cap = String(ability||'')
    .trim()
    .split(/\s+/).map(w => w ? (w[0].toUpperCase()+w.slice(1).toLowerCase()) : '').join(' ');
  const has = a.some(x => String(x).toLowerCase() === cap.toLowerCase());
  if (cap && !has) a.push(cap);
}


function removePermanentAbility(json, ability){
  Object.assign(json, ensurePlainObject(json));
  const a = ensure(json, 'effects', ()=>[]);
  const norm = String(ability||'').toLowerCase();
  const i = a.findIndex(v => String(v).toLowerCase() === norm);
  if (i >= 0) a.splice(i, 1);
}


// -------------------------------
// Overlay UI
// -------------------------------
function openPanel({ title, html, onAttach, footer }){
  const scrim = document.createElement('div'); scrim.className='scrim';
  const panel = document.createElement('div'); panel.className='panel';
  Object.assign(scrim.style, { position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:9999, display:'grid', placeItems:'center' });
  Object.assign(panel.style, { width:'min(740px, 92vw)', maxHeight:'82vh', overflow:'auto',
    background:'#151a2b', color:'#e7f0ff', border:'1px solid #2b3f63', borderRadius:'14px', padding:'12px', boxShadow:'0 12px 40px rgba(0,0,0,.4)' });

  panel.innerHTML = `
    <div class="row" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <strong style="font-weight:900">${title||'Activate Ability'}</strong>
      <button class="pill js-close" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">Close</button>
    </div>
    <div class="panel-body" style="margin-top:10px;display:grid;gap:12px">${html||''}</div>
    ${footer?`<div class="row" style="margin-top:10px;display:flex;justify-content:flex-end;gap:8px">${footer}</div>`:''}
  `;
  document.body.appendChild(scrim); scrim.appendChild(panel);
  const close = ()=>{ try{scrim.remove();}catch{} };
  panel.querySelector('.js-close').onclick = close;
  scrim.addEventListener('click', e=>{ if(e.target===scrim) close(); });
  panel._close = close;
  onAttach?.(panel);
  return panel;
}

function cardChipHtml(el){
  const cid = el.dataset.cid, name = el.dataset.name || cid;
  const img = el.querySelector('.face.front img')?.src || '';
  return `
    <label class="tgt" data-cid="${cid}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #2b3f63;border-radius:10px;cursor:pointer">
      <input type="checkbox" style="transform:scale(1.15)"/>
      <span style="width:28px;height:40px;background:${img?`url('${img}') center/cover`: '#222'};border-radius:4px;flex:0 0 auto"></span>
      <span style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px">${name}</span>
    </label>
  `;
}

function listCardsForSeat(seat){
  return $$(`.card[data-cid]`).filter(el => {
    const host = el.closest('[data-seat],[data-owner],[data-owner-seat]');
    const s = Number(host?.dataset?.seat ?? host?.dataset?.owner ?? host?.dataset?.ownerSeat);
    return s === Number(seat);
  });
}

// -------------------------------
// Public API
// -------------------------------
// -------------------------------
// LINKED-source watcher: cleans LINKED effects if source leaves battlefield
// -------------------------------
function ensureLinkedWatcher(room_id, sourceCid){
  if (!room_id || !sourceCid) return;

  // de-dupe per source
  window.__linkedWatchers ||= {};
  if (window.__linkedWatchers[sourceCid]) return;

  // Observe DOM for the source card disappearing or becoming non-table
  const checkAlive = ()=>{
    const el = findCardEl(sourceCid);
    if (!el) return false;
    // Heuristic: require it to be in a battlefield/table-like host; if your layout
    // tags zones, prefer a selector like [data-zone="table"] ancestor.
    const host = el.closest('[data-zone],[data-owner],[data-seat]');
    const zone = host?.getAttribute?.('data-zone') || '';
    return !!el && (zone ? /table|battlefield/i.test(zone) : true);
  };

  const cleanupIfGone = async ()=>{
    if (checkAlive()) return;
    try {
      await ActivatedAbilities.clearLinkedBySource(room_id, sourceCid);
      // refresh visuals for all known applyTo tickets for this source
      const tickets = (window.__linkedEffectTickets||[]).filter(t => t.room_id===room_id && String(t.sourceCid)===String(sourceCid));
      const touched = new Set(tickets.flatMap(t => t.applyTo));
      for (const tcid of touched){
        try {
          await window.CardAttributes?.fetchIfMissing?.(tcid);
          window.CardAttributes?.applyToDom?.(tcid);
          window.CardAttributes?.refreshPT?.(tcid);
        } catch {}
      }
    } finally {
      if (observer) observer.disconnect();
      clearInterval(poller);
      delete window.__linkedWatchers[sourceCid];

      // NEW: stop any ongoing type watchers for this source
      try{
        const W = window.__ongoingTypeWatchers || {};
        for (const k of Object.keys(W)){
          if (k.startsWith(`${room_id}:${sourceCid}:`)){
            try { W[k].mo.disconnect(); } catch {}
            try { clearInterval(W[k].poll); } catch {}
            delete W[k];
          }
        }
      }catch{}
    }

  };

  // 1) Fast polling guard (covers cross-container moves)
  const poller = setInterval(cleanupIfGone, 800);

  // 2) Broad DOM observer as a backstop
  const observer = new MutationObserver(()=> cleanupIfGone());
  observer.observe(document.body, { subtree:true, childList:true });

  window.__linkedWatchers[sourceCid] = { poller, observer };
}


function openCardAttributesFor(cid){
  const el  = findCardEl(cid);
  // try an on-card cog/button if present
  const cog = el?.querySelector?.(
    '.js-attrs, .btn-attrs, [data-action="attributes"], [data-action="attrs"], [title*="Attributes" i]'
  );
  if (cog) { cog.click?.(); return true; }

  // fallbacks people often expose:
  if (window.CardAttributes?.open) { window.CardAttributes.open(cid); return true; }
  if (window.CardAttributes?.openPanelForCard) { window.CardAttributes.openPanelForCard(cid); return true; }
  if (window.openCardAttributes) { window.openCardAttributes(cid); return true; }
  return false;
}



const ActivatedAbilities = {
  open({ cid, seat, anchorEl }){
    const me = Number(seat)||mySeat();
    const seats = activeSeats();
    const opp = seats.find(s => s!==me) || (me===1?2:1);

    const html = `
  <div class="tabs" style="display:flex;gap:8px;align-items:center;border-bottom:1px solid #2b3f63;padding-bottom:6px">
    <button title="Scan" class="pill js-tab active" data-tab="scan"   style="border:1px solid #2b3f63;border-radius:999px;background:#18304f;color:#e7f0ff;padding:6px 10px">🔎 Scan</button>
    <button class="pill js-tab"        data-tab="apply"  style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">Apply</button>
    <button class="pill js-tab"        data-tab="active" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">Active</button>
    <button class="pill js-tab" data-tab="settings"
      style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">⚙️</button>

    <!-- NEW: right-aligned Send to... -->
    <button class="pill js-sendto"
      style="margin-left:auto;border:1px solid #2b3f63;border-radius:999px;background:#12240f;color:#d7ffd7;padding:6px 10px">
      Send to…
    </button>
  </div>


  <style>
    /* Scoped to THIS ability panel only */
    .pane-apply input[type="text"],
    .pane-apply input[type="number"]{
      color:#cfe1ff !important;
      -webkit-text-fill-color:#cfe1ff !important; /* beats WebKit text-fill */
      caret-color:#cfe1ff !important;
      background:#0f1829 !important;
    }
    .pane-apply input::placeholder{
      color:#9fb8e6 !important;
      opacity:1 !important;
    }
    .pane-apply input{ opacity:1 !important; }

    /* Radial picker */
    .radial-scrim{
      position:fixed; inset:0; z-index:10000;
      background:transparent;
    }
   
    .radial .ring{
      position:absolute; inset:0; border-radius:50%;
      background:#0f1829; border:1px solid #2b3f63;
    }
    .radial .alpha{
      position:absolute; inset:10px; border-radius:50%;
    }
   
    
	
    .radial .panel h4{
      margin:0 0 6px 0; font-size:12px; letter-spacing:.08em; opacity:.85; text-transform:uppercase;
    }
    .radial .panel .grid{
      display:grid; grid-template-columns:1fr; gap:6px;
    }
    .radial .panel .item{
      padding:6px 8px; border:1px solid #2b3f63; border-radius:8px; cursor:pointer;
      background:#0f1829; color:#e7f0ff;
    }
    .radial .panel .item:hover{ background:#18304f; }
	
	    .radial{
      position:absolute; width:560px; height:560px;
      border-radius:50%; pointer-events:auto;
      display:grid; place-items:center;
      filter:drop-shadow(0 10px 28px rgba(0,0,0,.5));
      z-index:10000;
    }
    .radial .alpha button{
      position:absolute; width:64px; height:64px; border-radius:50%;
      border:1px solid #2b3f63; background:#142039; color:#cfe1ff;
      font-weight:900; cursor:pointer; line-height:64px; text-align:center;
      font-size:24px;
      transform:translate(-50%, -50%);
      transition:transform .06s ease, background .06s ease, box-shadow .06s ease;
      box-shadow:0 2px 6px rgba(0,0,0,.35);
    }
    .radial .alpha button:hover{ background:#1b2b4b; transform:translate(-50%, -50%) scale(1.06); }
    .radial .alpha button:active{ background:#234065; transform:translate(-50%, -50%) scale(0.98); }

    .radial .panel{
      position:absolute; width:360px; max-height:320px; overflow:auto;
      top:50%; left:50%; transform:translate(-50%, -50%);
      background:#101a2c; border:1px solid #2b3f63; border-radius:14px; padding:10px; display:none;
    }
    .radial .panel h4{
      margin:0 0 8px 0; font-size:18px; font-weight:900; color:#cfe1ff;
    }
    .radial .panel .grid{ display:grid; grid-template-columns:1fr; gap:6px; }
    .radial .panel .item{
      padding:8px 10px; border:1px solid #2b3f63; border-radius:10px;
      background:#0f1829; color:#d9e8ff; cursor:pointer; font-size:18px; font-weight:700;
    }
    .radial .panel .item:hover{ background:#18304f; }

/* Number spinner (no keyboard) */
.nspin{
  display:inline-flex; align-items:center; gap:6px;
  background:#0f1829; border:1px solid #2b3f63; border-radius:999px;
  padding:4px 6px;
}
.nspin .nbtn{
  width:30px; height:30px; border-radius:50%;
  border:1px solid #2b3f63; background:#142039; color:#cfe1ff;
  font-weight:900; line-height:28px; text-align:center; cursor:pointer;
  user-select:none;
}
.nspin .nbtn:hover{ background:#1b2b4b; }
.nspin .nbtn:active{ background:#234065; transform:scale(.98); }

.nspin-input{
  width:68px; text-align:center; font-weight:900; font-size:18px;
  color:#cfe1ff !important; background:transparent !important; border:0 !important;
  -webkit-text-fill-color:#cfe1ff !important; caret-color:transparent !important;
  pointer-events:none; /* click doesn’t focus, no keyboard */
}

@media (pointer:coarse){
  .nspin .nbtn{ width:36px; height:36px; line-height:34px; }
  .nspin-input{ width:76px; font-size:20px; }
}

  </style>



  <div class="pane pane-scan" style="margin-top:10px">
    <div class="box" style="border:1px solid #2b3f63;border-radius:10px;padding:10px">
<div style="display:flex;align-items:flex-start;gap:8px;justify-content:space-between">
  <div style="font-weight:900;flex:0 0 auto">Scanned Oracle text</div>

  <!-- Oracle text grows as needed; no 'Oracle:' label -->
  <div style="display:flex;align-items:flex-start;gap:8px;flex:1 1 auto;max-width:100%">
    <div class="pill"
         style="flex:1 1 auto;max-width:100%;
                white-space:normal;overflow:visible;text-overflow:clip;
                word-break:break-word;display:block">
      <span class="js-oracle" style="font-weight:700;white-space:normal"></span>
    </div>
    <button class="pill js-rescan" title="Re-scan Oracle" style="flex:0 0 auto">Rescan</button>
  </div>
</div>

</div>

      <div class="scanWrap" style="margin-top:8px;display:grid;gap:8px"></div>
      <div class="note" style="opacity:.8;margin-top:6px">
        Honor system on mana. Will auto-tap if the ability requires tapping.
      </div>
    </div>
  </div>

  <div class="pane pane-apply"  style="display:none; margin-top:10px">
    <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <!-- Targets -->
      <div class="box box-apply-targets" style="border:1px solid #2b3f63;border-radius:10px;padding:10px">
        <!-- [TARGET BUTTONS] -->
<div style="font-weight:900;margin-bottom:6px">Targets</div>
<div class="row" style="display:flex;gap:6px;flex-wrap:wrap">
  <button class="pill js-scope" data-scope="mine">My cards</button>
  <button class="pill js-scope" data-scope="opponent">Opponent</button>
  <button class="pill js-scope" data-scope="both">Both</button>
  <button class="pill js-scope" data-scope="deck">Deck</button> <!-- NEW -->
</div>
<div class="tgtWrap" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"></div>


<!-- Target by creature type (filters the pool before applying) -->
<div class="box" style="margin-top:10px;border:1px dashed #2b3f63;border-radius:10px;padding:10px">
  <div style="font-weight:900;margin-bottom:6px">Target by creature type</div>
  <div class="pill" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <span>Type</span>
    <input type="text" class="js-type" placeholder="e.g. Zombie (optional)" style="min-width:220px;padding:4px 8px;background:#0f1829;color:#cfe1ff;-webkit-text-fill-color:#cfe1ff;border:1px solid #2b3f63;border-radius:8px;caret-color:#cfe1ff;opacity:1"/>
    <button type="button" class="pill js-type-plus"  title="Add type via radial"  style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 8px">＋</button>
    <button type="button" class="pill js-type-minus" title="Remove last type"      style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 8px">－</button>
  </div>
  <div style="opacity:.8;margin-top:6px">If set, applies the effect to <b>all creatures</b> of that type within the chosen scope.</div>
  <label class="pill" style="display:flex;align-items:center;gap:6px;margin-top:8px">
  <input type="checkbox" class="js-include-source" checked />
  Include source card when applying
</label>

</div>


      </div>

      <!-- Effect -->
      <div class="box" style="border:1px solid #2b3f63;border-radius:10px;padding:10px">
        <div style="font-weight:900;margin-bottom:6px">Effect</div>
        <div class="row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
  <!-- first row -->
  <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
    <input type="radio" name="mode" value="pt" checked/> Power/Toughness
  </label>
  <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
    <input type="radio" name="mode" value="counter"/> Counters
  </label>
  <!-- second row -->
  <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
    <input type="radio" name="mode" value="ability"/> Grant ability
  </label>
  <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
    <input type="radio" name="mode" value="type"/> Grant type
  </label>
</div>


        <div class="js-pt" style="display:grid;grid-template-columns:1fr;gap:8px">

  <label class="pill" style="display:flex;align-items:center;gap:8px;justify-content:space-between">
    <span>Power</span>
    <div class="nspin" data-field="dp">
      <button type="button" class="nbtn nsub" aria-label="decrease">−</button>
      <input type="number" class="js-dp nspin-input" value="1" inputmode="numeric" readonly />
      <button type="button" class="nbtn nadd" aria-label="increase">+</button>
    </div>
  </label>
  <label class="pill" style="display:flex;align-items:center;gap:8px;justify-content:space-between">
    <span>Toughness</span>
    <div class="nspin" data-field="dt">
      <button type="button" class="nbtn nsub" aria-label="decrease">−</button>
      <input type="number" class="js-dt nspin-input" value="1" inputmode="numeric" readonly />
      <button type="button" class="nbtn nadd" aria-label="increase">+</button>
    </div>
  </label>
</div>

        <div class="js-ability" style="display:none;margin-top:8px">
  <div class="pill" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <span>Ability</span>
    <input type="text" class="js-abil" placeholder="e.g. flying" style="min-width:220px;padding:4px 8px;background:#0f1829;color:#cfe1ff;-webkit-text-fill-color:#cfe1ff;border:1px solid #2b3f63;border-radius:8px;caret-color:#cfe1ff;opacity:1"/>
    <button type="button" class="pill js-abil-plus"  title="Add ability via radial"  style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 8px">＋</button>
    <button type="button" class="pill js-abil-minus" title="Remove last ability"     style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 8px">－</button>
  </div>
</div>

		<div class="js-typegrant" style="display:none;margin-top:8px">
  <div class="pill" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <span>Type</span>
    <input type="text" class="js-typegrant-input" placeholder="e.g. Zombie" style="min-width:220px;padding:4px 8px;background:#0f1829;color:#cfe1ff;-webkit-text-fill-color:#cfe1ff;border:1px solid #2b3f63;border-radius:8px;caret-color:#cfe1ff;opacity:1"/>
    <button type="button" class="pill js-typegrant-plus"  title="Add type via radial"  style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 8px">＋</button>
    <button type="button" class="pill js-typegrant-minus" title="Remove last type"     style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 8px">－</button>
  </div>
</div>


        <div class="js-counter" style="display:none;grid-template-columns:1fr;gap:8px">
  <!-- line 1: counter kind + radial +/- -->
  <div class="pill" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <span>Counter kind</span>
    <input type="text" class="js-ckind" value="+1/+1" placeholder="+1/+1"
           style="min-width:220px;padding:4px 8px;background:#0f1829;color:#cfe1ff;-webkit-text-fill-color:#cfe1ff;border:1px solid #2b3f63;border-radius:8px;caret-color:#cfe1ff;opacity:1"/>
    <button type="button" class="pill js-ckind-plus"  title="Pick a stock counter"
            style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 8px">＋</button>
    <button type="button" class="pill js-ckind-minus" title="Clear"
            style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 8px">－</button>
  </div>

  <!-- line 2: amount spinner (same component as P/T) -->
  <label class="pill" style="display:flex;align-items:center;gap:8px;justify-content:space-between">
    <span>Amount</span>
    <div class="nspin" data-field="camt">
      <button type="button" class="nbtn nsub" aria-label="decrease">−</button>
      <input type="number" class="js-camt nspin-input" value="1" inputmode="numeric" readonly />
      <button type="button" class="nbtn nadd" aria-label="increase">+</button>
    </div>
  </label>
</div>


        <div style="margin-top:8px">
  <div style="font-weight:900;margin-bottom:6px">Duration</div>
  <div style="display:grid;grid-template-columns:1fr;gap:6px">
    <label class="pill" style="display:flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
      <input type="radio" name="dur" value="EOT" checked/> Until end of turn
    </label>
    <label class="pill" style="display:flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
      <input type="radio" name="dur" value="LINKED"/> While source remains on battlefield
    </label>
    <label class="pill" style="display:flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
      <input type="radio" name="dur" value="PERM"/> Persistent (manual remove)
    </label>
  </div>
</div>

        <!-- NEW: Application flow -->
        <div style="margin-top:8px">
          <div style="font-weight:900;margin-bottom:6px">Application</div>
          <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px;margin-right:6px">
            <input type="radio" name="applyflow" value="current" checked/> Current
          </label>
          <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
            <input type="radio" name="applyflow" value="ongoing"/> Ongoing
          </label>
          <div style="opacity:.8;margin-top:6px">“Ongoing” will auto-apply to future matching cards while the source remains.</div>
        </div>

      </div>
    </div>
  </div>

  <div class="pane pane-active" style="display:none; margin-top:10px">
    <div class="box" style="border:1px solid #2b3f63;border-radius:10px;padding:10px">
      <div style="font-weight:900;margin-bottom:8px">Active effects on selected targets</div>

      <div class="row" style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <button class="pill js-ascope" data-scope="mine" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 10px">My Cards</button>
        <button class="pill js-ascope" data-scope="opponent" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 10px">Opponent</button>
        <button class="pill js-ascope" data-scope="both" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 10px">Both</button>
        <button class="pill js-refreshActive" style="margin-left:auto;border:1px solid #2b3f63;border-radius:999px;background:#18304f;color:#e7f0ff;padding:4px 10px">Refresh</button>
      </div>

      <div class="activeWrap" style="display:grid;gap:8px"></div>
    </div>
  </div>
    <!-- NEW: Settings (⚙️) — full in-pane tab, Layout A -->
  <div class="pane pane-settings" style="display:none; margin-top:10px">
    <div class="box" style="border:1px solid #2b3f63;border-radius:10px;padding:10px; display:grid; gap:12px">
      
      <!-- Force Types -->
      <div style="display:grid; gap:6px">
        <div style="font-weight:900; opacity:.9">Force Types</div>
        <div style="display:flex; gap:6px; align-items:center">
          <input class="js-set-type input" type="text" placeholder="Type (e.g., Elf)" style="flex:1; padding:8px 10px; border:1px solid #2b3f63; border-radius:8px; background:#0f1829; color:#cfe1ff">
          <button type="button" class="pill js-set-type-plus"  title="Radial picker (+)" style="border:1px solid #2b3f63;border-radius:999px;background:#142039;color:#cfe1ff;padding:6px 10px">＋</button>
          <button type="button" class="pill js-set-type-minus" title="Remove last token" style="border:1px solid #2b3f63;border-radius:999px;background:#142039;color:#cfe1ff;padding:6px 10px">—</button>
        </div>
        <div style="display:flex; gap:8px">
          <button type="button" class="pill js-set-type-add"    style="border:1px solid #2b3f63;border-radius:999px;background:#18304f;color:#e7f0ff;padding:6px 12px">Add</button>
          <button type="button" class="pill js-set-type-remove" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 12px">Remove</button>
        </div>
      </div>

      <!-- Force Effects / Abilities -->
      <div style="display:grid; gap:6px">
        <div style="font-weight:900; opacity:.9">Force Effects / Abilities</div>
        <div style="display:flex; gap:6px; align-items:center">
          <input class="js-set-abil input" type="text" placeholder="Ability (e.g., Flying)" style="flex:1; padding:8px 10px; border:1px solid #2b3f63; border-radius:8px; background:#0f1829; color:#cfe1ff">
          <button type="button" class="pill js-set-abil-plus"  title="Radial picker (+)" style="border:1px solid #2b3f63;border-radius:999px;background:#142039;color:#cfe1ff;padding:6px 10px">＋</button>
          <button type="button" class="pill js-set-abil-minus" title="Remove last token" style="border:1px solid #2b3f63;border-radius:999px;background:#142039;color:#cfe1ff;padding:6px 10px">—</button>
        </div>
        <div style="display:flex; gap:8px">
          <button type="button" class="pill js-set-abil-add"    style="border:1px solid #2b3f63;border-radius:999px;background:#18304f;color:#e7f0ff;padding:6px 12px">Add</button>
          <button type="button" class="pill js-set-abil-remove" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 12px">Remove</button>
        </div>
      </div>

      <!-- Force Counters -->
      <div style="display:grid; gap:6px">
        <div style="font-weight:900; opacity:.9">Force Counters</div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap">
          <input class="js-set-ckind input" type="text" placeholder="Counter kind (e.g., +1/+1)" style="flex:1; min-width:220px; padding:8px 10px; border:1px solid #2b3f63; border-radius:8px; background:#0f1829; color:#cfe1ff">
          <button type="button" class="pill js-set-ckind-plus"  title="Radial picker (+)" style="border:1px solid #2b3f63;border-radius:999px;background:#142039;color:#cfe1ff;padding:6px 10px">＋</button>
          <button type="button" class="pill js-set-ckind-minus" title="Clear kind"       style="border:1px solid #2b3f63;border-radius:999px;background:#142039;color:#cfe1ff;padding:6px 10px">—</button>

<!-- quantity box -->
<div class="nspin js-set-qty" data-field="setqty" style="margin-left:auto">
  <button type="button" class="nbtn nsub" aria-label="decrease">−</button>
  <input type="number" class="nspin-input js-set-qty-input" value="1" inputmode="numeric" readonly />
  <button type="button" class="nbtn nadd" aria-label="increase">+</button>
</div>

        </div>
        <div style="display:flex; gap:8px">
          <button type="button" class="pill js-set-ctr-add"    style="border:1px solid #2b3f63;border-radius:999px;background:#18304f;color:#e7f0ff;padding:6px 12px">Add</button>
          <button type="button" class="pill js-set-ctr-remove" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 12px">Remove</button>
        </div>
      </div>

      <!-- Bottom row buttons: Delete • Repair • Save (no Clear) -->
      <div style="display:flex; gap:8px; justify-content:flex-end; border-top:1px solid #22385c; padding-top:10px; margin-top:4px">
        <button type="button" class="pill js-cs-delete" style="border:1px solid #854040;border-radius:999px;background:#2b0f14;color:#ffd7d7;padding:6px 12px">Delete</button>
        <button type="button" class="pill js-cs-repair" style="border:1px solid #355a2f;border-radius:999px;background:#12240f;color:#d7ffd7;padding:6px 12px">Repair</button>
        <button type="button" class="pill js-cs-save"   style="border:1px solid #2b3f63;border-radius:999px;background:#18304f;color:#e7f0ff;padding:6px 12px">Save</button>
      </div>

    </div>
  </div>

`;



    const panel = openPanel({
      title: 'Activate Ability',
      html,
      footer: `<button class="pill js-apply" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:8px 14px">Apply</button>`,
      onAttach: (p)=>{
        const tgtWrap = bySel('.tgtWrap', p);
        const scopeBtns = $$('.js-scope', p);
        const modeRadios = $$('input[name="mode"]', p);
        const ptRow = bySel('.js-pt', p);
        const abRow = bySel('.js-ability', p);
        const ctRow = bySel('.js-counter', p);
// ensure default is ON even if browser restores form state
const incSrc = bySel('.js-include-source', p);
if (incSrc) incSrc.checked = true;
// Mount universal Health controls into the Scan pane
const scanWrap = bySel('.scanWrap', p);
try { renderHealthFallback({ host: scanWrap, seats: activeSeats(), defaultAmount: 1 }); } catch {}

// Prefill delegator (for buttons we render that carry data-prefill-*)
p.addEventListener?.('click', (ev)=>{

  const btn = ev.target?.closest?.('[data-prefill-mode]');
  if (!btn) return;
  const mode  = btn.getAttribute('data-prefill-mode');   // 'ability' | 'type'
  const value = btn.getAttribute('data-prefill-value')||'';
  prefillApply({ mode, value }, p);
});

function refreshTargets(scope){
  if (scope === 'deck'){
    try { p?._close?.(); } catch {}
    window.DrawRules?.open?.();
    return;
  }

  const meCards = listCardsForSeat(me);
  const opCards = listCardsForSeat(opp);
  let list = [];
  if (scope==='mine') list = meCards;
  else if (scope==='opponent') list = opCards;
  else list = meCards.concat(opCards);
  tgtWrap.innerHTML = list.map(cardChipHtml).join('');
}


        scopeBtns.forEach(b => b.onclick = ()=>{
          scopeBtns.forEach(x=>{
            x.classList.toggle('active', x===b);
            x.style.background = (x===b) ? '#18304f' : '#0f1829';
          });
          refreshTargets(b.dataset.scope);
        });
        // set initial visual state
        (()=>{
          const first = scopeBtns[0];
          if (first){
            first.classList.add('active');
            first.style.background = '#18304f';
          }
        })();
        refreshTargets('mine');
		// ===== Radial pickers: data sources =====
const CREATURE_TYPES = [
  'Advisor','Aetherborn','Ally','Angel','Antelope','Ape','Archer','Archon','Artificer','Assassin',
  'Assembly-Worker','Atog','Aurochs','Avatar','Azra','Badger','Barbarian','Bard','Basilisk','Bat',
  'Bear','Beast','Beeble','Berserker','Bird','Blinkmoth','Boar','Bringer','Brushwagg','Camarid',
  'Camel','Caribou','Carrier','Cat','Centaur','Cephalid','Chimera','Citizen','Cleric','Cockatrice',
  'Construct','Coward','Crab','Crocodile','Cyclops','Dauthi','Demigod','Demon','Deserter','Devil',
  'Dinosaur','Djinn','Dog','Dragon','Drake','Dreadnought','Drone','Druid','Dryad','Dwarf','Efreet',
  'Egg','Elder','Eldrazi','Elemental','Elephant','Elf','Elk','Eye','Faerie','Ferret','Fish','Flagbearer',
  'Fox','Frog','Fungus','Gargoyle','Germ','Giant','Gnome','Goat','Goblin','God','Golem','Gorgon',
  'Gremlin','Griffin','Hag','Halfling','Hamster','Harpy','Hellion','Hippo','Hippogriff','Homarid',
  'Homunculus','Horror','Horse','Hound','Human','Hydra','Hyena','Illusion','Imp','Incarnation','Insect',
  'Jackal','Jellyfish','Juggernaut','Kavu','Kirin','Kithkin','Knight','Kobold','Kor','Kraken','Lamia',
  'Lammasu','Leech','Leviathan','Lhurgoyf','Licid','Lizard','Manticore','Masticore','Mercenary',
  'Merfolk','Metathran','Minion','Minotaur','Mite','Mole','Monger','Mongoose','Monk','Monkey','Moonfolk',
  'Mouse','Mutant','Myr','Mystic','Naga','Nautilus','Nephilim','Nightmare','Nightstalker','Ninja','Noble',
  'Noggle','Nomad','Nymph','Octopus','Ogre','Ooze','Orb','Orc','Orgg','Otter','Ouphe','Ox','Oyster',
  'Pangolin','Pegasus','Pentavite','Pest','Phelddagrif','Phoenix','Phyrexian','Pilot','Pincher','Pirate',
  'Plant','Porcupine','Possum','Praetor','Prism','Processor','Rabbit','Rat','Rebel','Reflection','Rhino',
  'Rigger','Rogue','Sable','Salamander','Samurai','Sand','Saproling','Satyr','Scarecrow','Scion',
  'Scorpion','Scout','Serf','Serpent','Shaman','Shapeshifter','Shark','Sheep','Siren','Skeleton','Slith',
  'Sliver','Slug','Snake','Soldier','Soltari','Spawn','Specter','Spellshaper','Sphinx','Spider','Spike',
  'Spirit','Splinter','Sponge','Squid','Squirrel','Starfish','Surrakar','Survivor','Tentacle','Tetravite',
  'Thalakos','Thopter','Thrull','Tiefling','Treefolk','Trilobite','Triskelavite','Troll','Turtle',
  'Unicorn','Vampire','Vedalken','Viashino','Volver','WALL','Warlock','Warrior','Weird','Werewolf',
  'Whale','Wizard','Wolf','Wolverine','Wombat','Worm','Wraith','Wurm','Yeti','Zombie'
];

const ABILITIES_LIST = [
  'Deathtouch','Defender','Double Strike','First Strike','Flash','Flying','Haste','Hexproof',
  'Indestructible','Lifelink','Menace','Prowess','Reach','Trample','Vigilance','Ward {1}',
  'Ward {2}','Ward—Discard a card','Ward—Pay 3 life'
];

const COUNTER_TYPES = [
  '+1/+1','-1/-1',
  '+1/+0','+0/+1',
  'Flying','First strike','Double strike','Deathtouch','Lifelink','Menace',
  'Reach','Trample','Vigilance','Hexproof','Indestructible','Prowess','Ward',
  'Shield','Stun','Oil','Time','Energy','Experience','Infection','Slime',
  'Aim','Brick','Charge','Level','Gold','Quest','Verse'
];

// ===== Text token helpers (comma-separated multi) =====
function tokenizeCSV(v){
  return String(v||'')
    .split(',')
    .map(s=>s.trim())
    .filter(Boolean);
}
function stringifyCSV(arr){
  return arr.join(', ');
}
function addTokenToInput(input, token){
  const cur = tokenizeCSV(input.value);
  cur.push(token);
  input.value = stringifyCSV(cur);
  input.dispatchEvent(new Event('input', {bubbles:true}));
}
function removeLastTokenFromInput(input){
  const cur = tokenizeCSV(input.value);
  cur.pop();
  input.value = stringifyCSV(cur);
  input.dispatchEvent(new Event('input', {bubbles:true}));
}

// ===== Radial picker UI =====
function makeRadialPicker(anchorBtn, items, title, onPick){
  const scrim = document.createElement('div');
  scrim.className = 'radial-scrim';

  const r = document.createElement('div');
  r.className = 'radial';

  const ring = document.createElement('div'); ring.className='ring';
  const alpha = document.createElement('div'); alpha.className='alpha';
  const panel = document.createElement('div'); panel.className='panel';
  panel.innerHTML = `<h4>${title||'Select'}</h4><div class="grid"></div>`;

  r.appendChild(ring); r.appendChild(alpha); r.appendChild(panel);
  scrim.appendChild(r);
  document.body.appendChild(scrim);

  // --- BIG geometry ---
  const SIZE = 560;         // overall radial size (px)
  const HALF = SIZE / 2;    // center
  const BTN_OFFSET = 86;    // inward offset so 64px buttons don't clip
  const RADIUS = HALF - BTN_OFFSET;

  // Position: center on the trigger button, but keep on-screen
  const rect = anchorBtn.getBoundingClientRect();
  let cx = rect.left + rect.width/2;
  let cy = rect.top  + rect.height/2;

  // clamp to viewport so the big wheel stays visible
  const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
  const pad = 20;
  cx = Math.min(Math.max(cx, HALF + pad), vw - HALF - pad);
  cy = Math.min(Math.max(cy, HALF + pad), vh - HALF - pad);

  r.style.left = (cx - HALF) + 'px';
  r.style.top  = (cy - HALF) + 'px';

  // 26 letters around the circle
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  letters.forEach((ch, idx)=>{
    const btn = document.createElement('button');
    btn.type='button';
    btn.textContent = ch;

    const angle = (idx / letters.length) * Math.PI*2 - Math.PI/2; // start at top
    const x = HALF + Math.cos(angle)*RADIUS;
    const y = HALF + Math.sin(angle)*RADIUS;

    btn.style.left = x + 'px';
    btn.style.top  = y + 'px';

    btn.addEventListener('click', ()=>{
      const grid = panel.querySelector('.grid');
      grid.innerHTML = '';
      const subset = items.filter(it => it.toLowerCase().startsWith(ch.toLowerCase()));
      subset.slice(0,400).forEach(it=>{
        const div = document.createElement('div');
        div.className='item';
        div.textContent = it;
        div.addEventListener('click', ()=>{
          onPick?.(it);
          try{ document.body.removeChild(scrim); }catch{}
        });
        grid.appendChild(div);
      });
      panel.style.display = 'block';
    });

    alpha.appendChild(btn);
  });

  // close when clicking outside the radial
  scrim.addEventListener('click', (e)=>{
    if (e.target === scrim){
      try{ document.body.removeChild(scrim); }catch{}
    }
  }, {capture:true});
}

// ===== Wire: Effect → Counter kind (+ / -) =====
const ckindInput = bySel('.js-ckind', p);
bySel('.js-ckind-plus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  makeRadialPicker(ev.currentTarget, COUNTER_TYPES, 'Pick counter kind', (picked)=>{
    // single selection: replace the value (not CSV)
    ckindInput.value = picked;
    ckindInput.dispatchEvent(new Event('input', {bubbles:true}));
  });
});
bySel('.js-ckind-minus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  ckindInput.value = '';
  ckindInput.dispatchEvent(new Event('input', {bubbles:true}));
});



// ===== Wire: Targets → Type (+ / -) =====
const typeInput = bySel('.js-type', p);
bySel('.js-type-plus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  makeRadialPicker(ev.currentTarget, CREATURE_TYPES, 'Add type', (picked)=>{
    addTokenToInput(typeInput, picked);
  });
});
bySel('.js-type-minus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  removeLastTokenFromInput(typeInput);
});

// ===== Wire: Effect → Ability (+ / -) =====
const abilInput = bySel('.js-abil', p);
bySel('.js-abil-plus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  makeRadialPicker(ev.currentTarget, ABILITIES_LIST, 'Add ability', (picked)=>{
    addTokenToInput(abilInput, picked);
  });
});
bySel('.js-abil-minus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  removeLastTokenFromInput(abilInput);
});

// ===== Wire: Effect → Type grant (+ / -) =====
const typeGrantInput = bySel('.js-typegrant-input', p);
bySel('.js-typegrant-plus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  makeRadialPicker(ev.currentTarget, CREATURE_TYPES, 'Add type', (picked)=>{
    addTokenToInput(typeGrantInput, picked);
  });
});
bySel('.js-typegrant-minus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  removeLastTokenFromInput(typeGrantInput);
});


// ===== SETTINGS (⚙️) tab — radial (+/−) wiring =====
// Reuse the same CREATURE_TYPES / ABILITIES_LIST / COUNTER_TYPES and helpers

// Force Types
const setTypeInput = bySel('.js-set-type', p);
bySel('.js-set-type-plus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  makeRadialPicker(ev.currentTarget, CREATURE_TYPES, 'Add type', (picked)=>{
    addTokenToInput(setTypeInput, picked); // CSV-style (can add multiple)
  });
});
bySel('.js-set-type-minus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  removeLastTokenFromInput(setTypeInput);
});

// Force Abilities / Effects
const setAbilInput = bySel('.js-set-abil', p);
bySel('.js-set-abil-plus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  makeRadialPicker(ev.currentTarget, ABILITIES_LIST, 'Add ability', (picked)=>{
    addTokenToInput(setAbilInput, picked); // CSV-style (can add multiple)
  });
});
bySel('.js-set-abil-minus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  removeLastTokenFromInput(setAbilInput);
});

// Force Counters
const setCkindInput = bySel('.js-set-ckind', p);
bySel('.js-set-ckind-plus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  makeRadialPicker(ev.currentTarget, COUNTER_TYPES, 'Pick counter kind', (picked)=>{
    // single-value field (not CSV)
    setCkindInput.value = picked;
    setCkindInput.dispatchEvent(new Event('input', { bubbles:true }));
  });
});
bySel('.js-set-ckind-minus', p)?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  setCkindInput.value = '';
  setCkindInput.dispatchEvent(new Event('input', { bubbles:true }));
});

// NOTE: the quantity spinner in Settings uses .nspin and is already wired by wireNumberSpinner(p)
// ===== SETTINGS (⚙️) Add/Remove persistence =====
(function wireSettingsPersist(){
  const room_id   = currentRoom();
  const ownerSeat = me;              // same as other writes in this panel
  const refreshSelf = async ()=>{
    try{
      await window.CardAttributes?.fetchIfMissing?.(cid);
      window.CardAttributes?.applyToDom?.(cid);
      window.CardAttributes?.refreshPT?.(cid);
    }catch{}
  };

  // --- Force Types ---
  bySel('.js-set-type-add', p)?.addEventListener('click', async ()=>{
    const types = tokenizeCSV(bySel('.js-set-type', p)?.value || '');
    if (!types.length) return;
    await upsertRow(room_id, cid, ownerSeat, (json)=>{
      types.forEach(t => addPermanentType(json, t));
      return json;
    });
    await refreshSelf();
  });

  bySel('.js-set-type-remove', p)?.addEventListener('click', async ()=>{
    const types = tokenizeCSV(bySel('.js-set-type', p)?.value || '');
    if (!types.length) return;
    await upsertRow(room_id, cid, ownerSeat, (json)=>{
      types.forEach(t => removePermanentType(json, t));
      return json;
    });
    await refreshSelf();
  });

  // --- Force Effects / Abilities ---
  bySel('.js-set-abil-add', p)?.addEventListener('click', async ()=>{
    const abil = tokenizeCSV(bySel('.js-set-abil', p)?.value || '');
    if (!abil.length) return;
    await upsertRow(room_id, cid, ownerSeat, (json)=>{
      abil.forEach(a => addPermanentAbility(json, a));
      return json;
    });
    await refreshSelf();
  });

  bySel('.js-set-abil-remove', p)?.addEventListener('click', async ()=>{
    const abil = tokenizeCSV(bySel('.js-set-abil', p)?.value || '');
    if (!abil.length) return;
    await upsertRow(room_id, cid, ownerSeat, (json)=>{
      abil.forEach(a => removePermanentAbility(json, a));
      return json;
    });
    await refreshSelf();
  });

  // --- Force Counters (accumulate / decrement; delete at zero) ---
  function getSetQty(){
    const raw = bySel('.js-set-qty-input', p)?.value || '1';
    const n = Number(raw); return Number.isFinite(n) ? Math.max(1, n|0) : 1;
  }

  bySel('.js-set-ctr-add', p)?.addEventListener('click', async ()=>{
    const kind = (bySel('.js-set-ckind', p)?.value || '+1/+1').trim();
    const qty  = getSetQty();
    await upsertRow(room_id, cid, ownerSeat, (json)=>{
      addPermanentCounter(json, kind, +qty);   // accumulate
      return json;
    });
    await refreshSelf();
  });

  bySel('.js-set-ctr-remove', p)?.addEventListener('click', async ()=>{
    const kind = (bySel('.js-set-ckind', p)?.value || '+1/+1').trim();
    const qty  = getSetQty();
    await upsertRow(room_id, cid, ownerSeat, (json)=>{
      addPermanentCounter(json, kind, -qty);   // decrement (helper prunes <=0)
      return json;
    });
    await refreshSelf();
  });

  // --- Bottom "Save" just ensures DOM is refreshed now; changes are already saved by upserts above ---
  bySel('.js-cs-save', p)?.addEventListener('click', async ()=>{
    await refreshSelf();
    try { window.Overlays?.notify?.('ok', 'Saved.'); } catch {}
  });
})();


          // Optional type filter (matches current DOM types + card data if available)
          function cardMatchesType(cid, typeNorm){
            if (!typeNorm) return true;

            const el = findCardEl(cid);

            // 1) DOM-provided list (data-types)
            const domList = String(el?.dataset?.types || el?.getAttribute?.('data-types') || '')
              .split(/[ ,/]+/).filter(Boolean);

            // 2) Parse from type_line ("Legendary Creature — Elf Druid")
            const tl = String(
              el?.dataset?.type_line ||
              el?.getAttribute?.('data-type_line') ||
              window.Zones?.getCardDataById?.(cid)?.type_line || ''
            );
            const parsedTL = (()=> {
              if (!tl) return [];
              const [left, right] = tl.split('—').map(x => (x||'').trim());
              const leftParts = left ? left.split(/\s+/).filter(Boolean) : [];
              const subtypes  = right ? right.split(/\s+/).filter(Boolean) : [];
              return [...leftParts, ...subtypes];
            })();

            // 3) Attributes layer (addedTypes + tempTypes) from CardAttributes cache
            const attr = (window.CardAttributes?.get?.(cid)) || {};
            const added = Array.isArray(attr.addedTypes) ? attr.addedTypes : [];
            const temps = Array.isArray(attr.tempTypes)  ? attr.tempTypes.map(t => t?.type).filter(Boolean) : [];

            // 4) Zones meta (if you keep a 'types' array on the card data)
            let metaTypes = [];
            try{
              const meta = window.Zones?.getCardDataById?.(cid) || window.getCardDataById?.(cid);
              if (meta && Array.isArray(meta.types)) metaTypes = meta.types;
            }catch{}

            const all = [...domList, ...parsedTL, ...added, ...temps, ...metaTypes]
              .map(s => String(s||'').toLowerCase());

            return all.includes(typeNorm);
          }

          

        // NEW: Continuously watch for new matching cards while source remains
        function startOngoingTypeWatcher({ room_id, sourceCid, typeNorm, spec, seedSeen = [] }){
          window.__ongoingTypeWatchers ||= {};
          const key = `${room_id}:${sourceCid}:${typeNorm}:${spec.mode}:${spec.dur}`;

          // de-dupe
          if (window.__ongoingTypeWatchers[key]) return;

          // keep a set of cids we've already applied for this watcher
          const seen = new Set();
		  // mark already-applied cards so the first poll/scan won’t double-apply
   seedSeen.forEach(tcid => seen.add(String(tcid)));

          async function applyEffectToCid(tcid){
            if (seen.has(String(tcid))) return;
			// skip self unless explicitly included
if (!spec.includeSource && String(tcid) === String(sourceCid)) return;

            // respect scope (mine/opponent/both)
            const host = findCardEl(tcid)?.closest?.('[data-seat],[data-owner],[data-owner-seat]');
            const seat = Number(host?.dataset?.seat ?? host?.dataset?.owner ?? host?.dataset?.ownerSeat);
 if (!Number.isFinite(seat)) return;

            if (spec.scope === 'mine' && seat !== Number(spec.meSeat)) return;
            if (spec.scope === 'opponent' && seat === Number(spec.meSeat)) return;

            if (!cardMatchesType(tcid, typeNorm)) return;

            await upsertRow(room_id, tcid, spec.meSeat, (json)=>{
              if (spec.mode === 'pt'){
                if (spec.dur === 'PERM'){
                  const pm = (json.ptMod ||= { pow:0, tgh:0 });
                  pm.pow = (Number(pm.pow)||0) + (Number(spec.dp)||0);
                  pm.tgh = (Number(pm.tgh)||0) + (Number(spec.dt)||0);
                } else {
                  appendTempPT(json, { pow:Number(spec.dp)||0, tgh:Number(spec.dt)||0, sourceCid, mode: spec.dur });
                }
              } else if (spec.mode === 'ability'){
                const abil = String(spec.ability||'').trim();
                if (abil){
                  if (spec.dur === 'PERM') addPermanentAbility(json, abil);
                  else appendTempAbility(json, { ability: abil, sourceCid, mode: spec.dur });
                }
              } else if (spec.mode === 'counter'){
                const kind = String(spec.ckind||'+1/+1');
                const amt  = Number(spec.camt||1);
                addPermanentCounter(json, kind, amt);
              } else if (spec.mode === 'type'){
                const gt = String(spec.grantType||'').trim();
                if (gt){
                  if (spec.dur === 'PERM') addPermanentType(json, gt);
                  else appendTempType(json, { type: gt, sourceCid, mode: spec.dur });
                }
              }
              return json;
            });

            try {
              await window.CardAttributes?.fetchIfMissing?.(tcid);
              window.CardAttributes?.applyToDom?.(tcid);
              window.CardAttributes?.refreshPT?.(tcid);
            } catch {}

            seen.add(String(tcid));
          }

          // observe DOM for newly-added .card nodes
          const mo = new MutationObserver(muts=>{
            for (const m of muts){
              m.addedNodes.forEach(node=>{
                if (!(node instanceof Element)) return;
                const candidates = node.matches?.('.card[data-cid]') ? [node] : Array.from(node.querySelectorAll?.('.card[data-cid]')||[]);
                candidates.forEach(el=>{
                  const tcid = el?.dataset?.cid;
                  if (tcid) applyEffectToCid(tcid);
                });
              });
            }
          });
          mo.observe(document.body, { childList:true, subtree:true });

          // light poller as a backstop (covers non-typical DOM injections)
          const poll = setInterval(()=>{
            document.querySelectorAll('.card[data-cid]').forEach(el=>{
              const tcid = el?.dataset?.cid;
              if (tcid) applyEffectToCid(tcid);
            });
          }, 1200);

          window.__ongoingTypeWatchers[key] = { mo, poll, seen };
        }

function stopOngoingTypeWatcher({ room_id, sourceCid, typeNorm }){
  if (!room_id || !sourceCid) return;
  const W = (window.__ongoingTypeWatchers ||= {});
  const prefix = `${room_id}:${sourceCid}:${(typeNorm||'').toLowerCase()}:`;
  for (const key of Object.keys(W)){
    if (key.startsWith(prefix)){
      try { W[key].mo.disconnect(); } catch {}
      try { clearInterval(W[key].poll); } catch {}
      delete W[key];
    }
  }
}



function appendTempType(json, { type, sourceCid, mode }){
  const tt = ensure(json, 'tempTypes', ()=>[]);
  const id = 'tty_'+Math.random().toString(36).slice(2);
  const cap = String(type||'')
    .trim()
    .split(/\s+/).map(w => w ? (w[0].toUpperCase()+w.slice(1).toLowerCase()) : '').join(' ');
  tt.push({ id, type: cap, sourceCid: sourceCid||null, mode }); // 'EOT'|'LINKED'
  return id;
}
function addPermanentType(json, type){
  const arr = ensure(json, 'addedTypes', ()=>[]);
  const cap = String(type||'')
    .trim()
    .split(/\s+/).map(w => w ? (w[0].toUpperCase()+w.slice(1).toLowerCase()) : '').join(' ');
  const has = arr.some(x => String(x).toLowerCase() === cap.toLowerCase());
  if (cap && !has) arr.push(cap);
}

function removePermanentType(json, type){
  Object.assign(json, ensurePlainObject(json));
  const arr = ensure(json, 'addedTypes', ()=>[]);
  const norm = String(type||'').toLowerCase();
  const i = arr.findIndex(v => String(v).toLowerCase() === norm);
  if (i >= 0) arr.splice(i, 1);
}




        function setMode(m){
  ptRow.style.display = (m==='pt') ? 'grid' : 'none';
  abRow.style.display = (m==='ability') ? 'block' : 'none';
  ctRow.style.display = (m==='counter') ? 'grid' : 'none';
  const tg = bySel('.js-typegrant', p);
  if (tg) tg.style.display = (m==='type') ? 'block' : 'none';
}

        modeRadios.forEach(r => r.onchange = ()=> setMode(r.value));
        setMode('pt');
		// ===== Number spinner wiring (Power/Toughness) =====
function wireNumberSpinner(root){
  const spinners = root.querySelectorAll('.nspin');
  spinners.forEach(sp => {
    const field = sp.dataset.field; // "dp" or "dt"
    const input = sp.querySelector('.nspin-input');
    const btnAdd = sp.querySelector('.nadd');
    const btnSub = sp.querySelector('.nsub');

    // helpers
    const get = ()=> Number(input.value || 0);
    const set = (v)=>{ input.value = String(v); input.dispatchEvent(new Event('input', {bubbles:true})); };
    const step = (delta)=> set(get() + delta);

    // click
    btnAdd.addEventListener('click', e=>{ e.stopPropagation(); step(+1); });
    btnSub.addEventListener('click', e=>{ e.stopPropagation(); step(-1); });

    // long-press repeat
    function autoRepeat(btn, dir){
      let t=null, rep=null;
      const start = (e)=>{ e.preventDefault(); e.stopPropagation(); step(dir); t=setTimeout(()=>rep=setInterval(()=>step(dir), 60), 350); };
      const stop  = ()=>{ clearTimeout(t); clearInterval(rep); t=null; rep=null; };
      ['mousedown','touchstart'].forEach(ev=>btn.addEventListener(ev,start,{passive:false}));
      ['mouseup','mouseleave','touchend','touchcancel'].forEach(ev=>btn.addEventListener(ev,stop));
    }
    autoRepeat(btnAdd, +1);
    autoRepeat(btnSub, -1);

    // scroll wheel (desktop)
    sp.addEventListener('wheel', (e)=>{
      e.preventDefault();
      const mult = e.shiftKey ? 5 : 1;
      step(e.deltaY > 0 ? -1*mult : +1*mult);
    }, {passive:false});

    // vertical drag (scrub)
    let dragging=false, lastY=0, acc=0;
    const onDown = (e)=>{
      dragging=true;
      lastY = (e.touches?.[0]?.clientY ?? e.clientY);
      acc=0;
      e.preventDefault();
    };
    const onMove = (e)=>{
      if(!dragging) return;
      const y = (e.touches?.[0]?.clientY ?? e.clientY);
      const dy = y - lastY; lastY = y;
      acc += dy;
      const unit = 12; // px per step
      while (acc <= -unit){ step(+1); acc += unit; }
      while (acc >=  unit){ step(-1); acc -= unit; }
    };
    const onUp = ()=> dragging=false;

    ['mousedown','touchstart'].forEach(ev=>sp.addEventListener(ev,onDown,{passive:false}));
    ['mousemove','touchmove'].forEach(ev=>document.addEventListener(ev,onMove,{passive:false}));
    ['mouseup','touchend','touchcancel','mouseleave'].forEach(ev=>document.addEventListener(ev,onUp));

    // double-click center to reset to 0
    sp.addEventListener('dblclick', (e)=>{ e.stopPropagation(); set(0); });

    // context menu (right-click) to negate
    sp.addEventListener('contextmenu', (e)=>{ e.preventDefault(); set(get() * -1); });
  });
}

// run once on attach
wireNumberSpinner(p);

// Ensure clicks reach textboxes even if globals listen on body
function shieldTextInputsFromGlobalClicks(root){
  root.querySelectorAll('input[type="text"], input[type="number"]').forEach(el=>{
    // Stop bubbling so outer handlers can’t hijack focus
    ['mousedown','click'].forEach(evt=>{
      el.addEventListener(evt, ev => ev.stopPropagation(), { capture:true });
    });
  });
}
shieldTextInputsFromGlobalClicks(p);

        // Keep global hotkeys from swallowing keystrokes while typing in Apply inputs
        ['.js-abil','.js-ckind','.js-typegrant-input'].forEach(sel=>{
          const el = bySel(sel, p);
          if (!el) return;
          ['keydown','keypress','keyup'].forEach(evt=>{
            el.addEventListener(evt, ev => ev.stopPropagation()); // DO NOT preventDefault
          });
        });

		
		// Tabs
const tabBtns    = $$('.js-tab', p);
const paneScan   = bySel('.pane-scan', p);
const paneApply  = bySel('.pane-apply', p);
const paneActive = bySel('.pane-active', p);


function switchTab(which){
  // Highlight the active tab button
  tabBtns.forEach(b => {
    const on = (b.dataset.tab === which);
    b.classList.toggle('active', on);
    b.style.background = on ? '#18304f' : '#0f1829';
  });

  // Show exactly one pane; reuse existing pane refs to avoid scope issues
  if (paneScan)     paneScan.style.display     = (which === 'scan')     ? '' : 'none';
  if (paneApply)    paneApply.style.display    = (which === 'apply')    ? '' : 'none';
  if (paneActive)   paneActive.style.display   = (which === 'active')   ? '' : 'none';

  // Settings pane is optional (new fourth pane living inside the wand)
  const paneSettings = bySel('.pane-settings', p);
  if (paneSettings) paneSettings.style.display = (which === 'settings') ? '' : 'none';

  // Ensure typing works normally inside textboxes on these tabs
  if (which === 'apply' || which === 'scan' || which === 'settings'){
    shieldTextInputsFromGlobalClicks(p);
  }

  // Per-tab refresh hooks (unchanged behavior)
  if (which === 'scan')   { try { renderScan();   } catch(e){ console.warn('[Scan] render failed', e); } }
  if (which === 'active') { try { renderActive(); } catch(e){ console.warn('[Active] render failed', e); } }

  // Nice-to-have: focus first input when opening Settings
  if (which === 'settings'){
    const firstInput =
      bySel('.pane-settings input[type="text"]', p) ||
      bySel('.pane-settings input[type="number"]', p) ||
      bySel('.pane-settings textarea', p);
    try { firstInput?.focus?.(); } catch {}
  }
}



tabBtns.forEach(b => b.onclick = ()=> switchTab(b.dataset.tab));
switchTab('scan');

// --- Send to... (radial 1/2/3) -------------------------------------------
const sendBtn = bySel('.js-sendto', p);

function openSendRadial(anchorBtn){
  // Simple radial with 3 seats; reuse your radial styles already in this file
  const scrim = document.createElement('div');
  scrim.className = 'radial-scrim';

  const r = document.createElement('div');
  r.className = 'radial';

  const ring  = document.createElement('div'); ring.className = 'ring';
  const alpha = document.createElement('div'); alpha.className = 'alpha';
  r.append(ring, alpha);
  scrim.appendChild(r);
  document.body.appendChild(scrim);

  // geometry (same as your other radial)
  const SIZE = 560, HALF = SIZE/2, BTN_OFFSET = 86, RADIUS = HALF - BTN_OFFSET;
  const rect = anchorBtn.getBoundingClientRect();
  const vw = Math.max(document.documentElement.clientWidth,  window.innerWidth  || 0);
  const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
  const pad = 20;
  let cx = Math.min(Math.max(rect.left + rect.width/2,  HALF + pad), vw - HALF - pad);
  let cy = Math.min(Math.max(rect.top  + rect.height/2, HALF + pad), vh - HALF - pad);
  Object.assign(r.style, { left:(cx-HALF)+'px', top:(cy-HALF)+'px' });

  const seats = activeSeats(); // e.g., [1,2] or [1,2,3,4]; we only render 1..3 per request
  [1,2,3].forEach((s, idx)=>{
    if (!seats.includes(s)) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(s);
    b.style.position = 'absolute';
    b.style.width = b.style.height = '64px';
    b.style.borderRadius = '50%';
    b.style.border = '1px solid #2b3f63';
    b.style.background = '#142039';
    b.style.color = '#cfe1ff';
    b.style.fontWeight = '900';
    b.style.lineHeight = '64px';
    b.style.textAlign = 'center';
    const angle = (idx / 3) * Math.PI*2 - Math.PI/2; // 3 buttons
    const x = HALF + Math.cos(angle)*RADIUS;
    const y = HALF + Math.sin(angle)*RADIUS;
    b.style.left = x + 'px';
    b.style.top  = y + 'px';

    b.addEventListener('click', ()=>{
  try {
    // Resolve source card (this panel’s card)
    const cid = String(anchorEl?.dataset?.cid || bySel('[data-cid]', p)?.dataset?.cid || '').trim();

    // Prefer Zones → then dataset fallback
    const el = cid ? findCardEl(cid) : null;
    const zc = window.Zones?.getCardDataById?.(cid) || null;
    const cardData = zc || (el ? {
      id:           el.dataset.id || cid,
      name:         el.dataset.name || 'Card',
      type_line:    el.dataset.type_line || el.dataset.type || '',
      mana_cost:    el.dataset.mana_cost || '',
      oracle_text:  el.dataset.oracle_text || '',
      img:          el.querySelector('.face.front img')?.src || ''
    } : null) || { id:`copy:${Date.now()}`, name:'Card', type_line:'', mana_cost:'', oracle_text:'', img:'' };

    // Unique cid for the spawned copy
    const newCid = (crypto?.randomUUID?.() || Math.random().toString(36)).slice(0,12);

    // Pick a sensible drop point (center of current viewport)
    const vr = document.querySelector('#worldWrap, #table, body').getBoundingClientRect?.() || { left:0, top:0, width:window.innerWidth||800, height:window.innerHeight||600 };
    const cx = vr.left + vr.width  * 0.5;
    const cy = vr.top  + vr.height * 0.45; // slightly high so hands don’t cover
    // If you have a screen→world helper, prefer it; else send screen coords (receiver sets style.left/top)
    const x = Math.round(cx);
    const y = Math.round(cy);

    // RTC packet that your net.rtc.js expects (msg.type === 'spawn')
    const msg = {
      type:        'spawn',
      owner:       Number(s),           // seat to spawn for
      cid:         newCid,              // unique cid
      name:        cardData.name || '',
      img:         cardData.img  || cardData.image || '',
      type_line:   cardData.type_line   || '',
      mana_cost:   cardData.mana_cost   || '',
      oracle_text: cardData.oracle_text || '',
      x, y
    };

    // Send via DC (drops gracefully if DC not open)
    (window.RTC?.send?.(msg) ?? window.sendRTC?.(msg));

  } finally {
    try { document.body.removeChild(scrim); } catch {}
  }
});


    alpha.appendChild(b);
  });

  scrim.addEventListener('click', (e)=>{ if (e.target === scrim) try { document.body.removeChild(scrim); } catch{}; }, {capture:true});
}

sendBtn?.addEventListener('click', (ev)=>{
  ev.stopPropagation();
  openSendRadial(ev.currentTarget);
});


// Run one automatic scan the first time this overlay mounts
if (!p.dataset.scanInit) {
  p.dataset.scanInit = '1';
  queueMicrotask(() => {
	  // SETTINGS (⚙️) actions — mirror cog overlay Repair/Delete behavior 1:1
// Source parity: tooltip.cog.patch.js  (performDelete / performRepair and helpers)

(function wireSettingsActions(){
  const btnRepair = bySel('.js-cs-repair', p);
  const btnDelete = bySel('.js-cs-delete', p);
  if (!btnRepair && !btnDelete) return;

  const sendRTC = (msg) => (window.RTC?.send?.(msg) ?? window.sendRTC?.(msg));

  const getEl = () => {
    const sel = `.card[data-cid="${CSS.escape(String(cid))}"]`;
    return document.querySelector(sel) || null;
  };

  function scryPayloadFromEl(el){
    const tcid = el?.dataset?.cid || '';
    const og   = (typeof window.getCardDataById === 'function' && tcid)
      ? (window.getCardDataById(tcid) || {})
      : {};
    return {
      cid: tcid,
      name:        og.name        ?? el?.dataset?.name        ?? '',
      img:         og.img         ?? el?.dataset?.img         ?? (el?.querySelector('img')?.src || ''),
      type_line:   og.type_line   ?? el?.dataset?.type_line   ?? '',
      mana_cost:   og.mana_cost   ?? el?.dataset?.mana_cost   ?? '',
      oracle_text: og.oracle_text ?? el?.dataset?.oracle_text ?? '',
      ogpower:     og.baseP ?? og.power ?? el?.dataset?.baseP ?? el?.dataset?.ogpower ?? '',
      ogtoughness: og.baseT ?? og.toughness ?? el?.dataset?.baseT ?? el?.dataset?.ogtoughness ?? '',
      ogTypes:     Array.isArray(og.ogTypes)   ? og.ogTypes   : tryJson(el?.dataset?.ogTypes)   || [],
      ogEffects:   Array.isArray(og.ogEffects) ? og.ogEffects : tryJson(el?.dataset?.ogEffects) || []
    };
  }
  function tryJson(s){ try{ return JSON.parse(s || ''); }catch{ return null; } }

  function hydrateCardNode(node, seat, payload){
    if (!node) return;
    if (Number.isFinite(+payload.ogpower))     node.dataset.baseP = String(+payload.ogpower);
    if (Number.isFinite(+payload.ogtoughness)) node.dataset.baseT = String(+payload.ogtoughness);
    if (payload.ogEffects) node.dataset.ogEffects = JSON.stringify(payload.ogEffects || []);
    if (payload.ogTypes)   node.dataset.ogTypes   = JSON.stringify(payload.ogTypes   || []);
    node.dataset.name      = payload.name        || node.dataset.name || '';
    node.dataset.type_line = payload.type_line   || node.dataset.type_line || '';
    node.dataset.typeLine  = payload.type_line   || node.dataset.typeLine  || '';
    if (payload.mana_cost)   node.dataset.mana_cost = String(payload.mana_cost);
    if (payload.oracle_text) node.dataset.oracle    = String(payload.oracle_text);
    if (!node.dataset.owner && seat != null) node.dataset.owner = String(seat);

    try {
      if (typeof attachTooltip === 'function') {
        attachTooltip(node, {
          name: node.dataset.name || '',
          typeLine: node.dataset.type_line || '',
          costHTML: '',
          oracle: node.dataset.oracle || ''
        });
      }
    } catch {}

    try {
      window.CardAttributes?.applyToDom?.(cid);
      window.CardAttributes?.refreshPT?.(cid);
      requestAnimationFrame(() => window.CardAttributes?.refreshPT?.(cid));
    } catch {}

    try { window.reflowAll?.(); } catch {}
  }

  function respawnAt({ cid, seat, x, y, payload }){
    const cardObj = {
      name: payload.name || '',
      img:  payload.img  || '',
      type_line:   payload.type_line   || '',
      mana_cost:   payload.mana_cost   || '',
      oracle_text: payload.oracle_text || '',
      ogpower:     Number.isFinite(+payload.ogpower)     ? (+payload.ogpower)     : undefined,
      ogtoughness: Number.isFinite(+payload.ogtoughness) ? (+payload.ogtoughness) : undefined,
      ogTypes:     Array.isArray(payload.ogTypes)   ? payload.ogTypes   : [],
      ogEffects:   Array.isArray(payload.ogEffects) ? payload.ogEffects : [],
      power:'', toughness:'', loyalty:''
    };

    let node = null;
    if (typeof window.spawnTableCard === 'function'){
      node = window.spawnTableCard(cardObj, x, y, { cid, owner: seat }) || null;
      if (!node){
        node = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`) || null;
      }
    } else if (typeof window.Zones?.spawnToTable === 'function'){
      window.Zones.spawnToTable({ ...cardObj, cid }, seat);
      const sel = `.card[data-cid="${CSS.escape(String(cid))}"]`;
      requestAnimationFrame(() => {
        const n = document.querySelector(sel);
        if (n){ n.style.left = `${x}px`; n.style.top = `${y}px`; }
      });
    }

    try {
      sendRTC?.({
        type: 'spawn',
        cid, owner: seat,
        name: cardObj.name, img: cardObj.img,
        x, y,
        ogpower: cardObj.ogpower, ogtoughness: cardObj.ogtoughness,
        ogTypes: cardObj.ogTypes, ogEffects: cardObj.ogEffects,
        type_line: cardObj.type_line, mana_cost: cardObj.mana_cost, oracle_text: cardObj.oracle_text,
        power:'', toughness:'', loyalty:''
      });
    } catch(e){ console.warn('[SETTINGS][NET] spawn failed', e); }

    if (node) hydrateCardNode(node, seat, payload);
    else {
      const sel = `.card[data-cid="${CSS.escape(String(cid))}"]`;
      requestAnimationFrame(() => {
        const n = document.querySelector(sel);
        if (n){ n.style.left = `${x}px`; n.style.top = `${y}px`; }
        hydrateCardNode(n, seat, payload);
      });
    }
  }

  async function performDelete(el){
    if (!el) return;
    const dcid = el.dataset.cid; if (!dcid) return;

    try { window.Stacking?.detach?.(el); } catch {}

    try {
      const kill = document.querySelector(`.card[data-cid="${CSS.escape(dcid)}"]`);
      kill?.remove();
      window.Zones?.cfg?.removeTableCardDomById?.(dcid);
    } catch(e){ console.warn('local hard delete failed', e); }

    try { sendRTC?.({ type:'card:delete', cid: dcid }); } catch(e){
      console.warn('[SETTINGS][NET] delete failed', e);
    }
  }

  async function fetchCardFromScryfallByName(name){
    const base = 'https://api.scryfall.com/cards/named?exact=';
    const url  = base + encodeURIComponent(String(name || '').trim());
    const res  = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('Scryfall lookup failed: ' + res.status);
    const j = await res.json();

    const face = Array.isArray(j.card_faces) && j.card_faces.length ? j.card_faces[0] : j;
    let img = j.image_uris?.normal || j.image_uris?.png ||
              face.image_uris?.normal || face.image_uris?.png || '';

    return {
      cid: '',
      name:        j.name || face.name || '',
      type_line:   j.type_line || face.type_line || '',
      mana_cost:   j.mana_cost || face.mana_cost || '',
      oracle_text: j.oracle_text || face.oracle_text || '',
      ogpower:     Number.isFinite(+j.power) ? +j.power :
                   (Number.isFinite(+face.power) ? +face.power : undefined),
      ogtoughness: Number.isFinite(+j.toughness) ? +j.toughness :
                   (Number.isFinite(+face.toughness) ? +face.toughness : undefined),
      ogTypes:     [],
      ogEffects:   [],
      img
    };
  }

  async function performRepair(el){
    if (!el) return;

    const rcid  = el.dataset?.cid || '';
    const seat  = Number(el.dataset?.owner || mySeat());
    const left  = parseFloat(el.style.left || '0');
    const top   = parseFloat(el.style.top  || '0');
    const fromDom = scryPayloadFromEl(el) || {};
    const name    = (fromDom.name || el.dataset?.name || '').trim();
    if (!rcid) return;

    await performDelete(el);

    let payload = fromDom;
    if (name) {
      try {
        const sc = await fetchCardFromScryfallByName(name);
        payload = { ...sc, img: sc.img || fromDom.img || '' };
      } catch (e) {
        console.warn('[Repair] Scryfall lookup failed; using DOM payload', e);
      }
    }

    try {
      document.querySelectorAll(`.card[data-cid="${CSS.escape(rcid)}"]`).forEach(n => n.remove());
      window.Zones?.cfg?.removeTableCardDomById?.(rcid);
    } catch {}

    respawnAt({ cid: rcid, seat, x:left, y:top, payload });

    try { window.Overlays?.notify?.('ok', 'Card repaired.'); } catch {}
  }

  // Wire the two buttons
  btnDelete?.addEventListener('click', ()=>{
    const el = getEl(); if (!el) return;
    performDelete(el);
  });
  btnRepair?.addEventListener('click', ()=>{
    const el = getEl(); if (!el) return;
    performRepair(el);
  });
})();

// =============================
// SETTINGS: Add / Remove (Types, Abilities, Counters) with suppression
// =============================
(function wireSettingsAddRemove(){
  const room_id = currentRoom();
  const sourceEl = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
  const targetCid = sourceEl?.dataset?.cid || cid;
  if (!targetCid) return;

  // helpers
  const norm = s => String(s||'').trim().toLowerCase();
  const cap  = s => String(s||'')
    .trim()
    .split(/\s+/).map(w => w ? (w[0].toUpperCase()+w.slice(1).toLowerCase()) : '').join(' ');

  const ensureObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  const ensureArr = v => Array.isArray(v) ? v : [];

  async function writeJson(updater){
    await ensureSupabase();
    await upsertRow(room_id, targetCid, mySeat(), (json) => {
      const j = ensureObj(json);
      j.suppress = ensureObj(j.suppress);
      j.suppress.types   = ensureArr(j.suppress.types);
      j.suppress.effects = ensureArr(j.suppress.effects);
      j.suppress.counters= ensureArr(j.suppress.counters);
      return updater(j) || j;
    });
    // repaint
    try{
      await window.CardAttributes?.fetchIfMissing?.(targetCid);
      window.CardAttributes?.applyToDom?.(targetCid);
      window.CardAttributes?.refreshPT?.(targetCid);
      postFilterDomBySuppression(targetCid); // immediate visual parity
    }catch{}
  }

  // Remove badges/icons that are suppressed (in case applyToDom doesn't yet know)
  function postFilterDomBySuppression(cid){
    try{
      const row = window.CardAttributes?.get?.(cid) || {};
      const sup = ensureObj(row.suppress);
      const sTypes   = new Set(ensureArr(sup.types  ).map(norm));
      const sEffects = new Set(ensureArr(sup.effects).map(norm));
      const host = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
      if (!host) return;

      // types: look for badges with text content
      host.querySelectorAll('[data-badge="type"], .badge.type, .type-badge').forEach(b=>{
        const t = norm(b.textContent);
        if (sTypes.has(t)) b.remove();
      });

      // effects: ability badges/keywords
      host.querySelectorAll('[data-badge="effect"], .badge.effect, .badge.keyword').forEach(b=>{
        const t = norm(b.textContent);
        if (sEffects.has(t)) b.remove();
      });
    }catch{}
  }

  // ---------- TYPE add/remove ----------
  const typeInput  = bySel('.js-set-type', p);
  const btnTypeAdd = bySel('.js-set-type-add', p);
  const btnTypeRem = bySel('.js-set-type-remove', p);

  btnTypeAdd?.addEventListener('click', () => {
    const raw = typeInput?.value || '';
    const val = cap(raw); const key = norm(raw);
    if (!val) return;

    writeJson(j => {
      // clear suppression first
      j.suppress.types = ensureArr(j.suppress.types).filter(x => norm(x) !== key);
      // add to permanent list if not already present
      j.addedTypes = ensureArr(j.addedTypes);
      const has = j.addedTypes.some(x => norm(x) === key);
      if (!has) j.addedTypes.push(val);
      return j;
    });
  });

  btnTypeRem?.addEventListener('click', () => {
    const raw = typeInput?.value || '';
    const val = cap(raw); const key = norm(raw);
    if (!val) return;

    writeJson(j => {
      // try remove from addedTypes first
      j.addedTypes = ensureArr(j.addedTypes).filter(x => norm(x) !== key);
      // if it wasn’t an added type, suppress the innate one
      const s = new Set(ensureArr(j.suppress.types).map(norm));
      if (!s.has(key)) j.suppress.types.push(val);
      return j;
    });
  });

  // ---------- ABILITY add/remove ----------
  const abilInput  = bySel('.js-set-abil', p);
  const btnAbAdd   = bySel('.js-set-abil-add', p);
  const btnAbRem   = bySel('.js-set-abil-remove', p);

  btnAbAdd?.addEventListener('click', () => {
    const raw = abilInput?.value || '';
    const val = cap(raw); const key = norm(raw);
    if (!val) return;

    writeJson(j => {
      j.suppress.effects = ensureArr(j.suppress.effects).filter(x => norm(x) !== key);
      j.effects = ensureArr(j.effects);
      const has = j.effects.some(x => norm(x) === key);
      if (!has) j.effects.push(val);
      return j;
    });
  });

  btnAbRem?.addEventListener('click', () => {
    const raw = abilInput?.value || '';
    const val = cap(raw); const key = norm(raw);
    if (!val) return;

    writeJson(j => {
      j.effects = ensureArr(j.effects).filter(x => norm(x) !== key);
      const s = new Set(ensureArr(j.suppress.effects).map(norm));
      if (!s.has(key)) j.suppress.effects.push(val);
      return j;
    });
  });

  // ---------- COUNTERS add/remove ----------
  const ckindInput = bySel('.js-set-ckind', p);
  const qtyEl      = bySel('.js-set-qty-input', p);
  const btnCtrAdd  = bySel('.js-set-ctr-add', p);
  const btnCtrRem  = bySel('.js-set-ctr-remove', p);

  function setCounter(json, name, delta){
    const arr = Array.isArray(json.counters) ? json.counters
      : (json.counters && typeof json.counters==='object'
         ? Object.entries(json.counters).map(([n,q])=>({name:n, qty:+q||0}))
         : []);
    const key = norm(name);
    const idx = arr.findIndex(c => norm(c.name) === key);
    if (idx >= 0){
      arr[idx].qty = Math.max(0, (Number(arr[idx].qty)||0) + delta);
    } else if (delta > 0){
      arr.push({ name: cap(name), qty: delta });
    }
    json.counters = arr.filter(c => Number(c.qty) > 0);
  }

  btnCtrAdd?.addEventListener('click', () => {
    const raw = ckindInput?.value || '+1/+1';
    const n   = Math.max(1, Number(qtyEl?.value || 1)|0);
    if (!raw) return;

    writeJson(j => {
      // counters rarely have “innate” baselines, but support suppression parity anyway
      j.suppress.counters = ensureArr(j.suppress.counters).filter(x => norm(x) !== norm(raw));
      setCounter(j, raw, +n);
      return j;
    });
  });

  btnCtrRem?.addEventListener('click', () => {
    const raw = ckindInput?.value || '+1/+1';
    const n   = Math.max(1, Number(qtyEl?.value || 1)|0);
    if (!raw) return;

    writeJson(j => {
      setCounter(j, raw, -n);
      // if nothing left and you want to *hide* default/baseline counters that may appear elsewhere:
      if (!ensureArr(j.counters).some(c => norm(c.name) === norm(raw))) {
        const s = new Set(ensureArr(j.suppress.counters).map(norm));
        if (!s.has(norm(raw))) j.suppress.counters.push(cap(raw));
      }
      return j;
    });
  });

  // initial post-filter pass for the card visible right now
  try { postFilterDomBySuppression(targetCid); } catch {}
})();


    try { renderScan(); }
    catch (e) { console.error('[Scan] autoscan failed:', e); }
  });
}

bySel('.js-rescan', p)?.addEventListener('click', renderScan);



// ACTIVE tab controls
const aWrap = bySel('.activeWrap', p);
const aScopeBtns = $$('.js-ascope', p);
let aScope = 'mine';
aScopeBtns.forEach(b => b.onclick = ()=>{ aScope = b.dataset.scope; renderActive(); });
bySel('.js-refreshActive', p).onclick = ()=> renderActive();

async function renderActive(){
  if (!aWrap) return;
  aWrap.innerHTML = '<div style="opacity:.85">Loading…</div>';

  const meCards = listCardsForSeat(me);
  const opCards = listCardsForSeat(opp);
  let list = aScope==='mine' ? meCards : (aScope==='opponent' ? opCards : meCards.concat(opCards));
  if (!list.length){ aWrap.innerHTML = '<div style="opacity:.8">No cards in view.</div>'; return; }

  const room_id = currentRoom();

  // parallel fetch with timeout guard per card
  const withTimeout = (p, ms=5000)=>Promise.race([
    p, new Promise(res=>setTimeout(()=>res(null), ms))
  ]);

  const rows = await Promise.all(list.map(async (el)=>{
    const tcid = el.dataset.cid;
    try{
      const row = await withTimeout(fetchRow(room_id, tcid));
const j0   = row?.json;
const json = (j0 && typeof j0 === 'object' && !Array.isArray(j0)) ? j0 : {};
return { el, cid: tcid, json };

    }catch(e){
      console.warn('[Activated] active tab row fetch failed', e, tcid);
      return { el, cid: tcid, json: {} };
    }
  }));

  // Build UI
  const html = rows.map(({el,cid,json})=>{
    const name = el.dataset.name || cid;
    const tempEff = Array.isArray(json.tempEffects) ? json.tempEffects : [];
    const tempPT  = Array.isArray(json.tempPT) ? json.tempPT : [];
    const effects = Array.isArray(json.effects) ? json.effects : [];
    const countersArr = Array.isArray(json.counters) ? json.counters
                        : (json.counters && typeof json.counters==='object'
                          ? Object.entries(json.counters).map(([name,qty])=>({name,qty})) : []);
    const blocks = [];

    if (tempEff.length){
      blocks.push(
        `<div><div style="font-weight:800;margin-bottom:4px">Temp Abilities</div>
          ${tempEff.map(e=>`
            <div style="display:flex;align-items:center;gap:8px;margin:4px 0">
              <span>${e.ability} <span style="opacity:.75">(${e.mode || 'TEMP'})</span></span>
              <button class="pill js-rm-tef" data-cid="${cid}" data-id="${e.id}"
                      style="margin-left:auto;border:1px solid #7c2f2f;border-radius:999px;background:#3a1a1a;color:#ffd1d1;padding:2px 8px">Remove</button>
            </div>`).join('')}
        </div>`
      );
    }

    if (tempPT.length){
      blocks.push(
        `<div style="margin-top:6px"><div style="font-weight:800;margin-bottom:4px">Temp P/T</div>
          ${tempPT.map(e=>`
            <div style="display:flex;align-items:center;gap:8px;margin:4px 0">
              <span>${e.pow>=0?`+${e.pow}`:e.pow}/${e.tgh>=0?`+${e.tgh}`:e.tgh} <span style="opacity:.75">(${e.mode || 'TEMP'})</span></span>
              <button class="pill js-rm-tpt" data-cid="${cid}" data-id="${e.id}" data-dp="${e.pow||0}" data-dt="${e.tgh||0}"
                      style="margin-left:auto;border:1px solid #7c2f2f;border-radius:999px;background:#3a1a1a;color:#ffd1d1;padding:2px 8px">Remove</button>
            </div>`).join('')}
        </div>`
      );
    }
	
	    // Temp Types (EOT / LINKED)
    const tempTypes = Array.isArray(json.tempTypes) ? json.tempTypes : [];
    if (tempTypes.length){
      blocks.push(
        `<div style="margin-top:6px"><div style="font-weight:800;margin-bottom:4px">Temp Types</div>
          ${tempTypes.map(e=>`
            <div style="display:flex;align-items:center;gap:8px;margin:4px 0">
              <span>${e.type} <span style="opacity:.75">(${e.mode || 'TEMP'})</span></span>
              <button class="pill js-rm-ttyp" data-cid="${cid}" data-id="${e.id}"
                      style="margin-left:auto;border:1px solid #7c2f2f;border-radius:999px;background:#3a1a1a;color:#ffd1d1;padding:2px 8px">Remove</button>
            </div>`).join('')}
        </div>`
      );
    }


    if (effects.length){
      blocks.push(
        `<div style="margin-top:6px"><div style="font-weight:800;margin-bottom:4px">Permanent Effects</div>
          ${effects.map(a=>`
            <div style="display:flex;align-items:center;gap:8px;margin:4px 0">
              <span>${a}</span>
              <button class="pill js-rm-pef" data-cid="${cid}" data-ability="${a}"
                      style="margin-left:auto;border:1px solid #7c2f2f;border-radius:999px;background:#3a1a1a;color:#ffd1d1;padding:2px 8px">Remove</button>
            </div>`).join('')}
        </div>`
      );
    }
	
	    // Added Types (Permanent)
    const addedTypes = Array.isArray(json.addedTypes) ? json.addedTypes : [];
    if (addedTypes.length){
      blocks.push(
        `<div style="margin-top:6px"><div style="font-weight:800;margin-bottom:4px">Added Types (Permanent)</div>
          ${addedTypes.map(t=>`
            <div style="display:flex;align-items:center;gap:8px;margin:4px 0">
              <span>${t}</span>
              <button class="pill js-rm-atyp" data-cid="${cid}" data-type="${t}"
                      style="margin-left:auto;border:1px solid #7c2f2f;border-radius:999px;background:#3a1a1a;color:#ffd1d1;padding:2px 8px">Remove</button>
            </div>`).join('')}
        </div>`
      );
    }


    if (countersArr.length){
      blocks.push(
        `<div style="margin-top:6px"><div style="font-weight:800;margin-bottom:4px">Counters</div>
          ${countersArr.map(c=>`
            <div style="display:flex;align-items:center;gap:8px;margin:4px 0">
              <span>${c.name} × ${c.qty}</span>
              <button class="pill js-rm-ctr" data-cid="${cid}" data-name="${c.name}"
                      style="margin-left:auto;border:1px solid #7c2f2f;border-radius:999px;background:#3a1a1a;color:#ffd1d1;padding:2px 8px">Remove</button>
            </div>`).join('')}
        </div>`
      );
    }

    const body = blocks.length ? blocks.join('') : '<div style="opacity:.8">No active effects.</div>';
    return `
      <div style="border:1px solid #2b3f63;border-radius:10px;padding:8px">
        <div style="font-weight:900;margin-bottom:6px">${name}</div>
        ${body}
      </div>`;
  }).join('');

  aWrap.innerHTML = html || '<div style="opacity:.8">No cards/effects found.</div>';

  // removal bindings
  aWrap.querySelectorAll('.js-rm-tef').forEach(btn => btn.onclick = async ()=>{
    const cid = btn.dataset.cid, id = btn.dataset.id, room_id = currentRoom();
    await upsertRow(room_id, cid, /*owner*/ undefined, (json)=>{
      json.tempEffects = (json.tempEffects||[]).filter(e => e.id !== id);
      return json;
    });
    try {
      await window.CardAttributes?.fetchIfMissing?.(cid);
      window.CardAttributes?.applyToDom?.(cid);
      window.CardAttributes?.refreshPT?.(cid);
    } catch {}
    renderActive();
  });

  aWrap.querySelectorAll('.js-rm-tpt').forEach(btn => btn.onclick = async ()=>{
    const cid = btn.dataset.cid, id = btn.dataset.id, room_id = currentRoom();
    const dp = Number(btn.dataset.dp||0), dt = Number(btn.dataset.dt||0);
    await upsertRow(room_id, cid, /*owner*/ undefined, (json)=>{
      const pm = (json.ptMod ||= { pow:0, tgh:0 });
      pm.pow = (Number(pm.pow)||0) - dp;
      pm.tgh = (Number(pm.tgh)||0) - dt;
      json.tempPT = (json.tempPT||[]).filter(e => e.id !== id);
      return json;
    });
    try {
      await window.CardAttributes?.fetchIfMissing?.(cid);
      window.CardAttributes?.applyToDom?.(cid);
      window.CardAttributes?.refreshPT?.(cid);
    } catch {}
    renderActive();
  });

  aWrap.querySelectorAll('.js-rm-pef').forEach(btn => btn.onclick = async ()=>{
    const cid = btn.dataset.cid, ability = String(btn.dataset.ability||'').toLowerCase(), room_id = currentRoom();
    await upsertRow(room_id, cid, /*owner*/ undefined, (json)=>{
      json.effects = (json.effects||[]).filter(a => String(a).toLowerCase() !== ability);
      return json;
    });
    try {
      await window.CardAttributes?.fetchIfMissing?.(cid);
      window.CardAttributes?.applyToDom?.(cid);
      window.CardAttributes?.refreshPT?.(cid);
    } catch {}
    renderActive();
  });

  aWrap.querySelectorAll('.js-rm-ctr').forEach(btn => btn.onclick = async ()=>{
    const cid = btn.dataset.cid, name = btn.dataset.name, room_id = currentRoom();
    await upsertRow(room_id, cid, /*owner*/ undefined, (json)=>{
      let arr = Array.isArray(json.counters) ? json.counters
        : (json.counters && typeof json.counters==='object'
           ? Object.entries(json.counters).map(([n,q])=>({name:n, qty:q})) : []);
      arr = arr.filter(c => String(c.name).toLowerCase() !== String(name).toLowerCase());
      json.counters = arr;
      return json;
    });
    try {
      await window.CardAttributes?.fetchIfMissing?.(cid);
      window.CardAttributes?.applyToDom?.(cid);
      window.CardAttributes?.refreshPT?.(cid);
    } catch {}
    renderActive();
  });
    // Remove a Temp Type entry
  aWrap.querySelectorAll('.js-rm-ttyp').forEach(btn => btn.onclick = async ()=>{
    const cid = btn.dataset.cid, id = btn.dataset.id, room_id = currentRoom();
    await upsertRow(room_id, cid, /*owner*/ undefined, (json)=>{
      json.tempTypes = (json.tempTypes||[]).filter(e => e.id !== id);
      return json;
    });
    try {
      await window.CardAttributes?.fetchIfMissing?.(cid);
      window.CardAttributes?.applyToDom?.(cid);
      window.CardAttributes?.refreshPT?.(cid);
    } catch {}
    renderActive();
  });

  // Remove a Permanent Added Type
  aWrap.querySelectorAll('.js-rm-atyp').forEach(btn => btn.onclick = async ()=>{
    const cid = btn.dataset.cid, t = String(btn.dataset.type||'').toLowerCase(), room_id = currentRoom();
    await upsertRow(room_id, cid, /*owner*/ undefined, (json)=>{
      json.addedTypes = (json.addedTypes||[]).filter(x => String(x).toLowerCase() !== t);
      return json;
    });
    try {
      await window.CardAttributes?.fetchIfMissing?.(cid);
      window.CardAttributes?.applyToDom?.(cid);
      window.CardAttributes?.refreshPT?.(cid);
    } catch {}
    renderActive();
  });

}

// ---------- SCAN tab ----------
(async function repairBadJson(room_id, cid, ownerSeat){
  await ensureSupabase();
  await upsertRow(room_id, cid, ownerSeat, (json)=>{
    return (json && typeof json === 'object' && !Array.isArray(json)) ? json : {};
  });
  try {
    await window.CardAttributes?.fetchIfMissing?.(cid);
    window.CardAttributes?.applyToDom?.(cid);
    window.CardAttributes?.refreshPT?.(cid);
  } catch {}
})(currentRoom(), '<THE_BAD_CID>', mySeat());


function needsTap(text){
  return /\btap(?: this| it)?\:|^tap[, ]/i.test(text) || /\btap this\b/i.test(text);
}

function addCreateTokenFallback(actions, fullOracle){
  // If we already have a create_tokens action, don’t duplicate
  const hasCreate = actions.some(a => a.kind === 'create_tokens');
  if (hasCreate) return actions;

  // Look for literal “Create a/an/1 … token” anywhere in the oracle (incl. reminder () text)
  const m = fullOracle.match(/\bcreate\b[^.]*?\b(?:a|an|one|1|\d+|X)?\s*([A-Z][A-Za-z-]*(?:\s+[A-Z][A-Za-z-]*)*)\s+token\b/i);
  if (!m) return actions;

  const tok = (m[1] || '').replace(/\s+tokens?$/i,'').trim();
  const amtMatch = fullOracle.match(/\bcreate\s+(X|a|an|one|1|\d+)\b/i);
  let n = 1;
  if (amtMatch) {
    const t = amtMatch[1];
    n = /^x$/i.test(t) ? 'X' : (isNaN(+t) ? 1 : +t);
  }
  actions = actions.concat([{ kind:'create_tokens', amount:n, token:tok, controller:'you' }]);
  return actions;
}


function renderScan(){
  // ---------- Resolve card + oracle FIRST (avoid TDZ on `oracle`) ----------
  const cardEl = anchorEl || findCardEl(cid);
  const name   = cardEl?.dataset?.name || cid;
  const oracle = getOracleForCid(cid);

  // Show the Oracle text (pretty if manaToHtml is available)
  const oracleEl = bySel('.js-oracle', p);
// inside renderScan(), where you populate .js-oracle
if (oracleEl){
  try { oracleEl.innerHTML = manaToHtml(oracle, { colored: true }); }
  catch { oracleEl.textContent = oracle; }
}


  const host = bySel('.scanWrap', p);
  if (!host) return;

  // If no oracle, bail early with a friendly message
  if (!oracle){
    host.innerHTML = `<div style="opacity:.8">No Oracle text available for ${name}.</div>`;
    return;
  }

  // ---------- Helpers local to renderScan ----------
  function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[m])); }

 // Render a quick one-off option button (used inside choice rows)
function optionBtnHtml(opt){
  if (opt.kind === 'pt_mod'){
    const label = `${opt.power>=0?'+':''}${opt.power}/${opt.toughness>=0?'+':''}${opt.toughness}${opt.untilEOT?' (EOT)':''}`;
    const eot = opt.untilEOT ? 1 : 0;
    return `<button type="button" class="pill" data-act="pt_mod" data-dp="${opt.power}" data-dt="${opt.toughness}" data-eot="${eot}">${label}</button>`;
  }
  if (opt.kind === 'create_tokens'){
    const n = opt.amount ?? 1;
    const lab = `Create ${n} ${opt.token}${n===1?'':'s'}`;
    return `<button type="button" class="pill" data-act="create_tokens" data-n="${n}" data-token="${opt.token}">${lab}</button>`;
  }
// in optionBtnHtml
if (opt.kind === 'add_mana'){
  const syms = opt.symbols || [];
  const manaHtml = syms.length
    ? syms.map(s => manaToHtml(`{${s}}`, { colored:true })).join(' ')
    : manaToHtml('{?}', { colored:true });
  return `<button type="button" class="pill" data-act="add_mana" data-symbols="${syms.join(',')}">Add ${manaHtml}</button>`;
}

// Search buttons for choice options
if (opt.kind === 'open_zone_filter') {
  const z = String(opt.zone || 'library').toLowerCase();
  const nice = z.charAt(0).toUpperCase() + z.slice(1);
  const q = String(opt.query || '').trim();
  const label = q ? `Search your ${nice} for ${escapeHtml(q)}` : `Search your ${nice}`;
  return `<button type="button" class="pill" data-act="open_zone_filter" data-zone="${escapeHtml(z)}" data-q="${escapeHtml(q)}">${label}</button>`;
}

// Legacy fallback some detectors may produce
if (opt.kind === 'search_library') {
  return `<button type="button" class="pill" data-act="open_zone_filter" data-zone="library" data-q="">Search your Library</button>`;
}


  if (opt.kind === 'grant_keyword'){
    const lab = `Prefill: ${opt.keyword}${opt.untilEOT?' (EOT)':''}`;
    return `<button type="button" class="pill" data-prefill-mode="ability" data-prefill-value="${escapeHtml(opt.keyword||'')}">${lab}</button>`;
  }
  return `<button type="button" class="pill" disabled>${opt.kind}</button>`;
}

// Render a concrete action row button
function actionRow(a){
  const pill = (attrs, label) => `<button type="button" class="pill" ${attrs}>${label}</button>`;
  const num  = v => Number(v ?? 0);

  switch (a.kind) {



	  
    case 'gain_life': {
      const n = num(a.amount || 1);
      return pill(`data-act="gain_life" data-n="${n}"`, `Gain ${n} life`);
    }
    case 'lose_life': {
      const n = num(a.amount || 1);
      return pill(`data-act="lose_life" data-n="${n}"`, `Lose ${n} life`);
    }
	
case 'open_zone_filter': {
  const z = String(a.zone || 'library');
  const nice = z.charAt(0).toUpperCase() + z.slice(1);
  const q = String(a.query || '').trim();
  const label = q ? `Search your ${nice} for ${escapeHtml(q)}` : `Search your ${nice}`;
  return pill(`data-act="open_zone_filter" data-zone="${escapeHtml(z)}" data-q="${escapeHtml(q)}"`, label);
}



    case 'draw_cards': {
      const n = num(a.amount || 1);
      return pill(`data-act="draw_cards" data-n="${n}"`, `Draw ${n}`);
    }
    case 'deal_damage': {
      const n = num(a.amount || 1);
      return pill(`data-act="deal_damage" data-n="${n}"`, `Deal ${n} damage`);
    }
    case 'put_counters': {
      const n    = num(a.amount || 1);
      const kind = a.counter || '+1/+1';
      const s    = n === 1 ? '' : 's';
      return pill(
        `data-prefill-mode="counter" data-prefill-ckind="${escapeHtml(kind)}" data-prefill-camt="${n}"`,
        `Prefill ${n} ${kind} counter${s}`
      );
    }
    case 'pt_mod': {
      const dp  = num(a.power);
      const dt  = num(a.toughness);
      const lab = `${dp>=0?'+':''}${dp}/${dt>=0?'+':''}${dt}${a.untilEOT?' (EOT)':''}`;
      return pill(
        `data-prefill-mode="pt" data-prefill-dp="${dp}" data-prefill-dt="${dt}" data-prefill-eot="${a.untilEOT?1:0}"`,
        `Prefill ${lab}`
      );
    }
case 'add_mana': {
  const syms = a.symbols || [];
  const manaHtml = syms.length
    ? syms.map(s => manaToHtml(`{${s}}`, { colored:true })).join(' ')
    : manaToHtml('{?}', { colored:true });
  return pill(`data-act="add_mana" data-symbols="${syms.join(',')}"`, `Add ${manaHtml}`);
}
    case 'create_tokens': {
      const n = num(a.amount || 1);
      const lab = `Create ${n} ${a.token}${n===1?'':'s'}`;
      return `<button type="button" class="pill" data-act="create_tokens" data-n="${n}" data-token="${a.token}">${lab}</button>`;
    }
    case 'grant_keyword': {
      const kw = a.keyword || '';
      const eot = a.untilEOT ? ' (EOT)' : '';
      return `<button type="button" class="pill" data-prefill-mode="ability" data-prefill-value="${escapeHtml(kw)}">Prefill: ${escapeHtml(kw)}${eot}</button>`;
    }
    case 'set_color': {
      const eot = a.untilEOT ? 1 : 0;
      const cs  = (a.colors || []).join(',');
      return pill(`data-act="set_color" data-colors="${cs}" data-eot="${eot}"`, `Set color`);
    }
    case 'set_creature_type': {
      const t = a.type || '';
      return `<button type="button" class="pill" data-prefill-mode="type" data-prefill-value="${escapeHtml(t)}">Prefill: type = ${escapeHtml(t)}</button>`;
    }
    case 'choice':
      return ''; // expanded elsewhere
    default:
      return `<div class="pill gray" title="Unknown action">${a.kind || 'unknown'}</div>`;
  }
}


function choiceRow(choice){
  const label = choice.label ? `Choose one — ${choice.label}` : 'Choose one';
  const buttons = (choice.options || []).map(optionBtnHtml).join(' ');
  return `
    <div style="border:1px dashed #2a375a;border-radius:10px;padding:10px;margin:6px 0">
      <div class="pill gray" style="margin-bottom:8px">${label}</div>
      <div class="row" style="display:flex;flex-wrap:wrap;gap:8px">${buttons}</div>
    </div>
  `;
}

 
  if (!host) return;
  // One delegated handler; bind once
  if (!host._bound) {
   host._bound = true;
   host.addEventListener('click', (ev) => {
      const actBtn = ev.target.closest('button[data-act]');
     const pfBtn  = ev.target.closest('button[data-prefill-mode]');
     if (pfBtn && host.contains(pfBtn)) {
       ev.preventDefault(); ev.stopPropagation();
       const mode   = pfBtn.dataset.prefillMode;
       // counters
       if (mode === 'counter') {
         prefillApply({ mode: 'counter',
                        value: pfBtn.dataset.prefillCkind || '+1/+1',
                        camt:  Number(pfBtn.dataset.prefillCamt || 1) });
         switchTab('apply');
         return;
       }
       // ability/type are already supported below; keep working:
     }
     if (!actBtn || !host.contains(actBtn)) return;
     ev.preventDefault(); ev.stopPropagation();
     performActionFor(actBtn);    // uses the same logic as your old wireActionButton
});
 }

  if (!host) return;
  host.innerHTML = '<div style="opacity:.85">Scanning…</div>';

  // inputs from the mini controls in the Scan tab header

const xVal = 1; // silent default; we still concretize X=1 for actionable buttons
const resolveX = (n) => (n === 'X' ? xVal : n);



console.log('[Scan] cardEl?', !!cardEl, 'cid:', cid, 'dataset:', cardEl?.dataset);
console.log('[Scan] oracle for', cid, ':', (oracle||'').slice(0,120));


  if (!oracle){
    host.innerHTML = `<div style="opacity:.8">No Oracle text available for ${name}.</div>`;
    return;
  }

  // === Use your parser ===
const { abilitiesOnly, innateTokens } = AD.detectAll(oracle);  // heads + split chain steps

// --- NEW: coalesce trailing “note-only” lines into the previous ability ---
function isNoteOnly(item){
  // If inferActionsFromText returns at least one action and all are 'note', treat as note-only
  const acts = AD.inferActionsFromText(item.effect ?? item.raw);
  return acts.length > 0 && acts.every(a => a?.kind === 'note');
}

// Produce a grouped list where note-only items are appended to the last non-note ability
const grouped = [];
for (const item of abilitiesOnly){
  if (grouped.length && isNoteOnly(item)) {
    const prev = grouped[grouped.length - 1];
    const joiner = /[.?!:]$/.test((prev.effect ?? prev.raw ?? '').trim()) ? ' ' : '. ';
    const noteText = (item.raw || '').trim();

    if (prev.effect) prev.effect = (prev.effect || '') + joiner + noteText;
    else             prev.raw    = (prev.raw    || '') + joiner + noteText;

    // keep a list of merged notes (optional UI below)
    prev._notes = (prev._notes || []).concat(noteText);
    continue;
  }
  grouped.push({ ...item });
}

// helper: resolve "X" to UI value for concrete buttons
// build UI (one block per ability) — always expanded, no toggles/buttons
const rows = grouped.map((ab, i) => {
  // ---- Infer concrete actions right away ----
  let actions = AD.inferActionsFromText(ab.effect ?? ab.raw)
    .map(a => {
      if (a.kind === 'deal_damage' || a.kind === 'draw_cards' || a.kind === 'gain_life' ||
          a.kind === 'lose_life'   || a.kind === 'put_counters' || a.kind === 'scry' || a.kind === 'surveil') {
        if (a.amount === 'X') a.amount = resolveX(a.amount);
      }
      if (a.kind === 'pt_mod') {
        if (a.power === 'X')     a.power = resolveX(a.power);
        if (a.toughness === 'X') a.toughness = resolveX(a.toughness);
      }
      if (a.kind === 'create_tokens' && a.amount === 'X') a.amount = resolveX(a.amount);
      return a;
    });

  // ---- Fallback: if reminder text said “Create a <Token> token”, add it ----
  actions = addCreateTokenFallback(actions, oracle);

  const stepsHtml = actions
    .map(a => (a.kind === 'choice' ? choiceRow(a) : actionRow(a)))
    .join('') || '<div style="opacity:.8">No concrete actions.</div>';

  // Optional: show the appended note(s) as muted subtext (useful for debugging/visibility)
  const notesHtml = (ab._notes && ab._notes.length)
    ? `<div style="margin-top:6px;opacity:.75;font-size:.92em">${ab._notes.map(n=>escapeHtml(n)).join(' ')}</div>`
    : '';

  return `
  <div style="border:1px solid #2b3f63;border-radius:10px;padding:10px">
    <div style="margin-bottom:6px">
      <span style="opacity:.92">${manaToHtml(ab.raw, { asCost: true, colored: true })}</span>
    </div>
    <div class="steps">${stepsHtml}</div>
    ${notesHtml}
  </div>
`;
}).join('') || `<div style="opacity:.8">No activated/triggered abilities detected.</div>`;



  // Innate token abilities (Food/Treasure/Clue etc.) — auto-expanded, no toggles
  const innate = innateTokens.map((ta, j) => {
    // Precompute concrete actions (resolve X the same way as for heads)
    let actions = AD.inferActionsFromText(ta.effect).map(a => {
      if (a?.amount === 'X') a.amount = resolveX(a.amount);
      return a;
    });
    const stepsHtml = actions.map(a => actionRow(a)).join('')
                     || '<div style="opacity:.8">No concrete actions.</div>';

    return `
      <div style="border:1px dashed #2a375a;border-radius:10px;padding:10px">
        <div style="margin-bottom:6px">
          <span class="pill gray" style="margin-right:6px">INNATE</span>
          A ${escapeHtml(ta.token)} token is an artifact with “${escapeHtml(ta.cost)}: ${escapeHtml(ta.effect)}”
        </div>
        <div class="steps">${stepsHtml}</div>
      </div>
    `;
  }).join('');

  host.innerHTML = rows + (innate ? `<div style="margin-top:8px">${innate}</div>` : '');

// After: host.innerHTML = rows + (innate ? `<div style="margin-top:8px">${innate}</div>` : '');
abilitiesOnly.forEach((ab, i) => {
  // 1) Pretend the requirement happened (for triggered) / cost acknowledged (for activated)
  const req = bySel(`#scan-req-${i}`, host);
  if (req) req.setAttribute('aria-pressed', 'true');

  // 2) Enable "Activate" and auto-open the action steps
  const act = host.querySelector(`.js-activate[data-i="${i}"]`);
  if (act) {
    act.disabled = false;
    act.click(); // auto-expand immediately
  }
});


  // requirement toggles enable each Activate
  abilitiesOnly.forEach((ab, i) => {
    const req = bySel(`#scan-req-${i}`, host);
    const act = host.querySelector(`.js-activate[data-i="${i}"]`);
    req?.addEventListener('click', () => {
      const on = req.getAttribute('aria-pressed') === 'true';
      req.setAttribute('aria-pressed', String(!on));
      act.disabled = on;
    });
  });

  // Activate = infer actions via module, render as your clickable rows
  host.querySelectorAll('.js-activate').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      const ab = abilitiesOnly[i];
      const box = bySel(`#scan-steps-${i}`, host);
      if (!box) return;
      box.style.display = 'block';

      // infer actions for this clause (effect if present, else raw)
      const actions = AD.inferActionsFromText(ab.effect ?? ab.raw)
        .map(a => {
          // concretize X here for your buttons
          if (a.kind === 'deal_damage' || a.kind === 'draw_cards' || a.kind === 'gain_life' ||
              a.kind === 'lose_life'   || a.kind === 'put_counters' || a.kind === 'scry' || a.kind === 'surveil') {
            if (a.amount === 'X') a.amount = resolveX(a.amount);
          }
          if (a.kind === 'pt_mod') {
            if (a.power === 'X')     a.power = resolveX(a.power);
            if (a.toughness === 'X') a.toughness = resolveX(a.toughness);
          }
          if (a.kind === 'create_tokens' && a.amount === 'X') a.amount = resolveX(a.amount);
          return a;
        });
		
		// --- Token booster: add a create_tokens action if the text clearly says so ---
(function addTokenFallback(){
  const raw = String(ab.effect ?? ab.raw ?? '');
  // common tokens people expect to “just work”
  const TOKENS = ['Food','Blood','Treasure','Clue','Map','Powerstone','Gold','Clue Artifact','Food Artifact'];
  // regex: create (a|one|1) <token> token
  const m = raw.match(/\bcreate\b[^.]*?\b(?:a|one|1)?\s*(food|blood|treasure|clue|map|powerstone|gold)\s+token\b/i);
  if (!m) return;
  const tokenCap = m[1][0].toUpperCase()+m[1].slice(1).toLowerCase(); // Food, Blood, etc.
  const already = actions.some(x => x.kind==='create_tokens' && String(x.token||'').toLowerCase()===tokenCap.toLowerCase());
  if (!already) actions.push({ kind:'create_tokens', amount: 1, token: tokenCap });
})();







box.innerHTML = actions.map(a => {
  if (a.kind === 'choice') return choiceRow(a);       // ← expand choices into concrete buttons
  return actionRow(a);                                 // existing rows for normal actions
}).join('') || '<div style="opacity:.8">No concrete actions.</div>';

// delegated .scanWrap click handler handles all [data-act] buttons (no per-button wiring here)



    });
  });


  
  async function performActionFor(btn){
  const kind   = btn.dataset.act;
  const meSeat = Number(seat)||mySeat();
  const seats  = activeSeats();
  const opp    = seats.find(s => s!==meSeat) || (meSeat===1?2:1);
  const targetCid = (anchorEl||findCardEl(cid))?.dataset?.cid || cid;
  const room_id = currentRoom();

  try{
	  if (kind === 'open_zone_filter') {
  const zone = (btn.dataset.zone || 'library').toLowerCase();
  const query = (btn.dataset.q || '').trim();
  const targetSeat = Number(seat) || mySeat();

  try {
    if (zone === 'graveyard' || zone === 'exile') {
      // open your existing zone overlay
      Zones?.openZone?.(zone, targetSeat);
      // try to fill its filter box shortly after it mounts
      setTimeout(() => {
        const overlay = document.querySelector('.overlays, .overlay, .panel, .zone-overlay') || document;
        const sels = [
          '.js-zone-filter input','input.js-zone-filter','input[name="zoneFilter"]',
          '.zone-filter input','input[placeholder*="filter" i]','input[placeholder*="search" i]'
        ];
        for (const s of sels) {
          const el = overlay.querySelector(s);
          if (el) { el.value = query; el.dispatchEvent(new Event('input', { bubbles: true })); break; }
        }
      }, 80);
    } else if (zone === 'library' || zone === 'deck') {
      // prefer a deck/library search overlay if you have one
      if (window.Overlays?.openDeckSearch) {
        window.Overlays.openDeckSearch({ initialQuery: query });
      } else {
        console.warn('[Scan] Deck/library search UI not available');
      }
    } else if (zone === 'hand') {
      // stub: wire up when you add a hand overlay
      console.warn('[Scan] Hand search UI not available');
    }
  } catch (e) {
    console.warn('[Scan] open_zone_filter failed', e);
  }
  return;
}


    if (kind === 'gain_life'){
      const n = Number(btn.dataset.n||1);
      window.Life?.set(meSeat, { life: window.Life.get(meSeat).life + n });
    }
    if (kind === 'lose_life'){
      const n = Number(btn.dataset.n||1);
      window.Life?.set(meSeat, { life: window.Life.get(meSeat).life - n });
    }
    if (kind === 'draw_cards'){
      const n = Number(btn.dataset.n||1);
      await window.drawXCards?.(meSeat, n);
    }
    if (kind === 'deal_damage'){
      const n = Number(btn.dataset.n||1);
      window.Life?.set(opp, { life: window.Life.get(opp).life - n });
    }
    if (kind === 'create_tokens'){
  const n = Number(btn.dataset.n||1);
  const label = btn.dataset.token || 'Token'; // e.g., "Clue" / "Food" / "Treasure"

  // 1) Try to find exact-name matches (WITHOUT adding "token")
  const hits = await findCardCandidatesByName(label);

  // 2) If there is exactly one hit, spawn it n times
  if (hits.length === 1){
    const card = hits[0];
    for (let i = 0; i < n; i++){
      if (typeof window.spawnCardAtViewCenter === 'function'){
        window.spawnCardAtViewCenter(card, meSeat);
      } else if (Zones?.spawnToTable){
        Zones.spawnToTable(card, meSeat);
      }
    }
    return;
  }

  // 3) If multiple (or 0) results, pop an overlay to choose or fallback
  openNamePickOverlay({
    query: label,
    candidates: hits,
    copies: n,
    seat: meSeat,
    onPick(){ /* no-op; we already spawned in the overlay */ }
  });
  return;
}


    if (kind === 'put_counters' || kind === 'pt_mod'){
      await ensureSupabase();
      await upsertRow(room_id, String(targetCid), meSeat, (json)=>{
        if (kind === 'put_counters'){
          const counter = btn.dataset.counter || '+1/+1';
          const amount  = Number(btn.dataset.n||1);
          addPermanentCounter(json, counter, amount);
        } else {
          const dp   = Number(btn.dataset.dp||0);
const dt   = Number(btn.dataset.dt||0);
const until= btn.dataset.eot==='1' ? 'EOT' : 'PERM';
if (until === 'PERM'){
  const pm = ensure(json, 'ptMod', ()=>({pow:0,tgh:0}));
  pm.pow = (Number(pm.pow)||0) + dp;
  pm.tgh = (Number(pm.tgh)||0) + dt;
} else {
  appendTempPT(json, { pow:dp, tgh:dt, sourceCid: targetCid, mode: 'EOT' });
  // NEW: remember this card for end-of-turn cleanup
  try {
    window.__eotEffectTouched ||= new Set();
    window.__eotEffectTouched.add(`${currentRoom()}:${String(targetCid)}`);
  } catch {}
}

        }
        return json;
      });
      try{
        window.CardAttributes?.fetchIfMissing?.(targetCid);
        window.CardAttributes?.applyToDom?.(targetCid);
        window.CardAttributes?.refreshPT?.(targetCid);
      }catch{}
    }

    // auto-tap if the ability’s cost includes "tap:"
    if (/\btap[^:]*:\s*/i.test(abilitiesOnly?.[0]?.cost || '')){
      try { (anchorEl||findCardEl(cid))?.classList.add('tapped'); } catch {}
    }
  }catch(e){
    console.warn('[Scan] performAction failed', e);
    try{ window.Overlays?.notify?.('warn', 'Action failed.'); }catch{}
  }
}



  function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[m])); }
}






        p.querySelector('.js-apply').onclick = async ()=>{
          const typeTxt = bySel('.js-type', p)?.value?.trim();
          const mode = p.querySelector('input[name="mode"]:checked')?.value || 'pt';
          const dur  = p.querySelector('input[name="dur"]:checked')?.value || 'EOT';

          // Determine current scope from the active Targets tab buttons
          const activeScopeBtn = $$('.js-scope', p).find(b => {
            return b.style?.background === 'rgb(24, 48, 79)' || b.classList.contains('active');
          });
          const scope = activeScopeBtn?.dataset?.scope || 'mine';

          // Build a list of candidate CIDs from the scope when a type is provided.
          // If no type is provided, fall back to the checked targets behavior.
          let chosen = [];
          const typeNorm = typeTxt ? String(typeTxt).toLowerCase().trim() : '';

          if (typeNorm) {
            const meCards = listCardsForSeat(me);
            const opCards = listCardsForSeat(opp);
            let pool = scope==='mine' ? meCards : (scope==='opponent' ? opCards : meCards.concat(opCards));
            chosen = pool.map(el => el.dataset.cid).filter(Boolean);
          } else {
            chosen = $$(`.tgtWrap .tgt input[type="checkbox"]`, p).map((c)=>{
              if (!c.checked) return null;
              const host = c.closest('.tgt'); return host?.dataset?.cid || null;
            }).filter(Boolean);
            if (!chosen.length){
              console.warn('[Activate] No targets selected.');
              try { window.Overlays?.notify?.('warn','No targets selected.'); } catch {}
              return;
            }
          }

          // Optional type filter (matches current DOM types + card data if available)
          let chosenFiltered = chosen.filter(cid => {
  if (!typeNorm) return true;

  const el = findCardEl(cid);

  // 1) DOM-provided list (data-types)
  const domList = String(el?.dataset?.types || el?.getAttribute?.('data-types') || '')
    .split(/[ ,/]+/).filter(Boolean);

  // 2) Parse from type_line ("Legendary Creature — Elf Druid")
  const tl = String(
    el?.dataset?.type_line ||
    el?.getAttribute?.('data-type_line') ||
    window.Zones?.getCardDataById?.(cid)?.type_line || ''
  );
  const parsedTL = (()=> {
    if (!tl) return [];
    const [left, right] = tl.split('—').map(x => (x||'').trim());
    const leftParts = left ? left.split(/\s+/).filter(Boolean) : [];
    const subtypes  = right ? right.split(/\s+/).filter(Boolean) : [];
    return [...leftParts, ...subtypes];
  })();

  // 3) Attributes layer (addedTypes + tempTypes) from CardAttributes cache
  const attr = (window.CardAttributes?.get?.(cid)) || {};
  const added = Array.isArray(attr.addedTypes) ? attr.addedTypes : [];
  const temps = Array.isArray(attr.tempTypes)  ? attr.tempTypes.map(t => t?.type).filter(Boolean) : [];

  // 4) Zones meta (if you keep a 'types' array on the card data)
  let metaTypes = [];
  try{
    const meta = window.Zones?.getCardDataById?.(cid) || window.getCardDataById?.(cid);
    if (meta && Array.isArray(meta.types)) metaTypes = meta.types;
  }catch{}

  const all = [...domList, ...parsedTL, ...added, ...temps, ...metaTypes]
    .map(s => String(s||'').toLowerCase());

  return all.includes(typeNorm);
});


          if (!chosenFiltered.length){
            console.warn('[Activate] No targets matched the chosen type.');
            try { window.Overlays?.notify?.('warn','No targets matched chosen type.'); } catch {}
            return;
          }

// Read this BEFORE we possibly remove the source
 const includeSource = bySel('.js-include-source', p)?.checked || false;

          const room_id = currentRoom();
          await ensureSupabase();
// Remove source if not including self
 if (!includeSource) {
   chosenFiltered = chosenFiltered.filter(x => String(x) !== String(cid));
 }

          for (const tcid of chosenFiltered) {
           await upsertRow(room_id, tcid, me, (json) => {
             if (mode === 'pt') {
               const dp = Number(bySel('.js-dp', p)?.value || 0);
               const dt = Number(bySel('.js-dt', p)?.value || 0);
               if (dur === 'PERM') {
                 const pm = ensure(json, 'ptMod', () => ({ pow: 0, tgh: 0 }));
                 pm.pow = (Number(pm.pow) || 0) + dp;
                 pm.tgh = (Number(pm.tgh) || 0) + dt;
               } else {
                 appendTempPT(json, { pow: dp, tgh: dt, sourceCid: cid, mode: dur });
               }
             } else if (mode === 'ability') {
               const abil = bySel('.js-abil', p)?.value?.trim();
               if (!abil) return json;
               if (dur === 'PERM') addPermanentAbility(json, abil);
               else appendTempAbility(json, { ability: abil, sourceCid: cid, mode: dur });
             } else if (mode === 'counter') {
               const kind = bySel('.js-ckind', p)?.value?.trim() || '+1/+1';
               const amt  = Number(bySel('.js-camt', p)?.value || 1);
               addPermanentCounter(json, kind, amt);
             } else if (mode === 'type') {
               const grantType = bySel('.js-typegrant-input', p)?.value?.trim();
               if (!grantType) return json;
               if (dur === 'PERM') addPermanentType(json, grantType);
               else appendTempType(json, { type: grantType, sourceCid: cid, mode: dur });
             }
 return json;
  });

  // ensure UI updates right away
  try {
    await window.CardAttributes?.fetchIfMissing?.(tcid);
    window.CardAttributes?.applyToDom?.(tcid);
    window.CardAttributes?.refreshPT?.(tcid);
  } catch {}

         }
		
          // Track LINKED + EOT tickets in-memory for faster cleanup
          if (dur === 'LINKED'){
            const room_id_now = currentRoom();
            window.__linkedEffectTickets ||= [];
            window.__linkedEffectTickets.push({ sourceCid: cid, applyTo: chosenFiltered.slice(), room_id: room_id_now });
            // start watcher for this source to auto-clean when it leaves battlefield
            ensureLinkedWatcher(room_id_now, cid);
          }
          if (dur === 'EOT'){
            window.__eotEffectTouched ||= new Set();
            chosenFiltered.forEach(x => window.__eotEffectTouched.add(`${currentRoom()}:${x}`));
          }


          const applyFlow = p.querySelector('input[name="applyflow"]:checked')?.value || 'current';

// Stop any ongoing watchers if user chose "Current"
if (applyFlow === 'current' && typeNorm) {
  stopOngoingTypeWatcher({
    room_id: currentRoom(),
    sourceCid: cid,
    typeNorm: typeNorm
  });
}


          if (applyFlow === 'ongoing' && typeNorm){
            // capture the exact spec we just applied
            const spec = { mode, dur, scope, meSeat: me };
			spec.includeSource = includeSource;
            if (mode === 'pt'){
              spec.dp = Number(bySel('.js-dp', p)?.value || 0);
              spec.dt = Number(bySel('.js-dt', p)?.value || 0);
            } else if (mode === 'ability'){
              spec.ability = bySel('.js-abil', p)?.value?.trim() || '';
            } else if (mode === 'counter'){
              spec.ckind = bySel('.js-ckind', p)?.value?.trim() || '+1/+1';
              spec.camt  = Number(bySel('.js-camt', p)?.value || 1);
            } else if (mode === 'type'){
              spec.grantType = bySel('.js-typegrant-input', p)?.value?.trim() || '';
            }

startOngoingTypeWatcher({
   room_id: currentRoom(),
   sourceCid: cid,
   typeNorm,
   spec,
   seedSeen: chosenFiltered.slice() // avoid immediate re-apply
});
          }

          try { window.Overlays?.notify?.('ok', 'Effect applied.'); } catch {}
          p._close?.();


        };
      }
    });
	// initial populate for Active tab (uses default 'mine' scope)


    return panel;
  },

  // -------------------------------
  // Cleanup helpers (call from end-turn & when source leaves battlefield)
  // -------------------------------
  async clearEOT(room_id){
  await ensureSupabase();

  // drain set first
  const touched = Array.from(window.__eotEffectTouched || []);
  window.__eotEffectTouched = new Set();

  // If nothing was tracked (e.g., came from Scan before this fix or manual edits),
  // do a conservative sweep across visible cards.
  let candidates = touched;
  if (!candidates.length){
    const cids = Array.from(document.querySelectorAll('.card[data-cid]'))
      .map(el => `${room_id}:${el.dataset.cid}`)
      .filter(Boolean);
    candidates = cids;
  }

  for (const key of candidates){
    const [rid, cid] = key.split(':');
    if (rid !== room_id || !cid) continue;

    await upsertRow(room_id, cid, /*ownerSeat*/ undefined, (json)=>{
      // revert tempPT EOT deltas and drop them
      if (Array.isArray(json.tempPT)){
        for (const eff of json.tempPT){
          if (eff?.mode === 'EOT'){
            const pm = ensure(json, 'ptMod', ()=>({ pow:0, tgh:0 }));
            pm.pow = (Number(pm.pow)||0) - (Number(eff.pow)||0);
            pm.tgh = (Number(pm.tgh)||0) - (Number(eff.tgh)||0);
          }
        }
        json.tempPT = json.tempPT.filter(e => e?.mode !== 'EOT');
      }
      // drop tempEffects with EOT
      if (Array.isArray(json.tempEffects)){
        json.tempEffects = json.tempEffects.filter(e => e?.mode !== 'EOT');
      }
      // drop tempTypes with EOT
      if (Array.isArray(json.tempTypes)){
        json.tempTypes = json.tempTypes.filter(e => e?.mode !== 'EOT');
      }
      return json;
    });

    // Repaint if that card is on the board
    try{
      await window.CardAttributes?.fetchIfMissing?.(cid);
      window.CardAttributes?.applyToDom?.(cid);
      window.CardAttributes?.refreshPT?.(cid);
    }catch{}
  }
},


  async clearLinkedBySource(room_id, sourceCid){
    await ensureSupabase();
    const tickets = (window.__linkedEffectTickets||[]).filter(t => t.room_id===room_id && String(t.sourceCid)===String(sourceCid));
    const applyTo = new Set(tickets.flatMap(t => t.applyTo));

    for (const tcid of applyTo){
      await upsertRow(room_id, tcid, /*ownerSeat*/ undefined, (json)=>{
        if (Array.isArray(json.tempPT)){
          for (const eff of json.tempPT){
            if (eff?.mode==='LINKED' && String(eff.sourceCid)===String(sourceCid)){
              const pm = ensure(json, 'ptMod', ()=>({ pow:0, tgh:0 }));
              pm.pow = (Number(pm.pow)||0) - (Number(eff.pow)||0);
              pm.tgh = (Number(pm.tgh)||0) - (Number(eff.tgh)||0);
            }
          }
          json.tempPT = json.tempPT.filter(e => !(e?.mode==='LINKED' && String(e.sourceCid)===String(sourceCid)));
        }
        if (Array.isArray(json.tempEffects)){
          json.tempEffects = json.tempEffects.filter(e => !(e?.mode==='LINKED' && String(e.sourceCid)===String(sourceCid)));
        }
        if (Array.isArray(json.tempTypes)){
          json.tempTypes = json.tempTypes.filter(e => !(e?.mode==='LINKED' && String(e.sourceCid)===String(sourceCid)));
        }
        return json;

      });
    }
	
	// NEW: stop any ongoing type watchers for this source
try{
  const W = window.__ongoingTypeWatchers || {};
  for (const k of Object.keys(W)){
    if (k.startsWith(`${room_id}:${sourceCid}:`)){
      try { W[k].mo.disconnect(); } catch {}
      try { clearInterval(W[k].poll); } catch {}
      delete W[k];
    }
  }
}catch{}


    // prune memory tickets
    window.__linkedEffectTickets = (window.__linkedEffectTickets||[]).filter(t => !(t.room_id===room_id && String(t.sourceCid)===String(sourceCid)));
  }
};

export default ActivatedAbilities;
