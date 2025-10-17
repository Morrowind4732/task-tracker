// modules/activated.abilities.js
// v1 — Generic activation overlay (targets, effect builder, durations)
// Writes to your `card_attributes` table shape: { room_id, cid, owner_seat, json, updated_by_seat }
// No reliance on an `id` column or upsert onConflict; includes EOT / LINKED cleanup helpers.

import { supaReady } from './env.supabase.js';
import * as AD from './ability.detect.js'; // ← uses your 1:1 parser/actions

let supabase = null; supaReady.then(c => supabase = c);

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
  const base = existing?.json || {};
  const next = updater(base) || base;

  // prefer existing owner if present, else provided ownerSeat, else 1
  const owner_seat = Number(existing?.owner_seat ?? ownerSeat ?? 1);

  const payload = {
    room_id,
    cid,
    owner_seat,
    json: next,
    updated_by_seat: owner_seat
  };

  // Supabase upsert without explicit onConflict relies on PK/unique in your schema.
  const { error } = await supabase.from('card_attributes').upsert(payload);
  if (error) console.error('[Activated] upsert error', error);
  return next;
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
  te.push({ id, ability: String(ability||'').toLowerCase(), sourceCid: sourceCid||null, mode }); // 'EOT'|'LINKED'
  return id;
}

function addPermanentCounter(json, kind, n){
  const arr = ensure(json, 'counters', () => []);
  const name = String(kind || '+1/+1');
  const add  = Number(n) || 0;

  const idx = arr.findIndex(c => c && String(c.name || '').toLowerCase() === name.toLowerCase());
  if (idx >= 0) {
    arr[idx].qty = Math.max(0, Number(arr[idx].qty || 0) + add);
  } else {
    arr.push({ name, qty: Math.max(0, add) });
  }
  // prune zeros so nothing renders when qty==0
  json.counters = arr.filter(c => Number(c.qty) > 0);
}


function addPermanentAbility(json, ability){
  const a = ensure(json, 'effects', ()=>[]);
  const norm = String(ability||'').toLowerCase();
  if (norm && !a.includes(norm)) a.push(norm);
}

function removePermanentAbility(json, ability){
  const a = ensure(json, 'effects', ()=>[]);
  const norm = String(ability||'').toLowerCase();
  const i = a.indexOf(norm);
  if (i>=0) a.splice(i,1);
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
    }
  };

  // 1) Fast polling guard (covers cross-container moves)
  const poller = setInterval(cleanupIfGone, 800);

  // 2) Broad DOM observer as a backstop
  const observer = new MutationObserver(()=> cleanupIfGone());
  observer.observe(document.body, { subtree:true, childList:true });

  window.__linkedWatchers[sourceCid] = { poller, observer };
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
  </style>


  <div class="pane pane-scan" style="margin-top:10px">
    <div class="box" style="border:1px solid #2b3f63;border-radius:10px;padding:10px">
      <div style="display:flex;align-items:center;gap:8px;justify-content:space-between">
        <div style="font-weight:900">Scanned abilities from Oracle</div>
        <div style="display:flex;gap:8px;align-items:center">
          <label class="pill" style="display:flex;gap:6px;align-items:center">
            X: <input type="number" class="js-xval" value="1" min="0" style="width:70px">
          </label>
          <label class="pill" style="display:flex;gap:6px;align-items:center">
            Pay life: <input type="number" class="js-xlife" value="0" min="0" style="width:70px">
          </label>
          <button class="pill js-rescan" title="Re-scan Oracle">Rescan</button>
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
        <div style="font-weight:900;margin-bottom:6px">Targets</div>
        <div class="row" style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <button class="pill js-scope" data-scope="mine" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 10px">My Cards</button>
          <button class="pill js-scope" data-scope="opponent" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 10px">Opponent</button>
          <button class="pill js-scope" data-scope="both" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 10px">Both</button>
        </div>
        <div class="tgtWrap" style="display:grid;gap:6px"></div>
      </div>

      <!-- Effect -->
      <div class="box" style="border:1px solid #2b3f63;border-radius:10px;padding:10px">
        <div style="font-weight:900;margin-bottom:6px">Effect</div>
        <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
            <input type="radio" name="mode" value="pt" checked/> Power/Toughness
          </label>
          <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
            <input type="radio" name="mode" value="ability"/> Grant ability
          </label>
          <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
            <input type="radio" name="mode" value="counter"/> Counters
          </label>
        </div>

        <div class="js-pt" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
          <label class="pill" style="display:flex;align-items:center;gap:6px">
            Power <input type="number" class="js-dp" value="1" style="width:90px;color:#cfe1ff"/>
          </label>
          <label class="pill" style="display:flex;align-items:center;gap:6px">
            Toughness <input type="number" class="js-dt" value="1" style="width:90px;color:#cfe1ff"/>
          </label>
        </div>

        <div class="js-ability" style="display:none;margin-top:8px">
          <label class="pill" style="display:flex;align-items:center;gap:6px">
            Ability <input type="text" class="js-abil" placeholder="e.g. flying" style="min-width:220px;padding:4px 8px;background:#0f1829;color:#cfe1ff;-webkit-text-fill-color:#cfe1ff;border:1px solid #2b3f63;border-radius:8px;caret-color:#cfe1ff;opacity:1"/>


          </label>
        </div>

        <div class="js-counter" style="display:none;grid-template-columns:1fr 120px;gap:8px">
          <label class="pill" style="display:flex;align-items:center;gap:6px">
            Counter kind <input type="text" class="js-ckind" value="+1/+1" placeholder="+1/+1" style="min-width:160px;padding:4px 8px;background:#0f1829;color:#cfe1ff;-webkit-text-fill-color:#cfe1ff;border:1px solid #2b3f63;border-radius:8px;caret-color:#cfe1ff;opacity:1"/>



          </label>
          <label class="pill" style="display:flex;align-items:center;gap:6px">
            Amount <input type="number" class="js-camt" value="1" min="1" style="width:90px;color:#cfe1ff"/>
          </label>
        </div>

        <div style="margin-top:8px">
          <div style="font-weight:900;margin-bottom:6px">Duration</div>
          <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px;margin-right:6px">
            <input type="radio" name="dur" value="EOT" checked/> Until end of turn
          </label>
          <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px;margin-right:6px">
            <input type="radio" name="dur" value="LINKED"/> While source remains on battlefield
          </label>
          <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
            <input type="radio" name="dur" value="PERM"/> Persistent (manual remove)
          </label>
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

        function refreshTargets(scope){
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


        function setMode(m){
          ptRow.style.display = (m==='pt') ? 'grid' : 'none';
          abRow.style.display = (m==='ability') ? 'block' : 'none';
          ctRow.style.display = (m==='counter') ? 'grid' : 'none';
        }
        modeRadios.forEach(r => r.onchange = ()=> setMode(r.value));
        setMode('pt');

        // Keep global hotkeys from swallowing keystrokes while typing in Apply inputs
        ['.js-abil','.js-ckind'].forEach(sel=>{
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
  tabBtns.forEach(b=>{
    const on = b.dataset.tab === which;
    b.classList.toggle('active', on);
    b.style.background = on ? '#18304f' : '#0f1829';
  });

  paneScan.style.display   = (which === 'scan')   ? '' : 'none';
  paneApply.style.display  = (which === 'apply')  ? '' : 'none';
  paneActive.style.display = (which === 'active') ? '' : 'none';

  // 👇 Add these calls to auto-refresh on tab swap
  if (which === 'scan')    renderScan();
  if (which === 'active')  renderActive();
}


tabBtns.forEach(b => b.onclick = ()=> switchTab(b.dataset.tab));
switchTab('scan');


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
      return { el, cid: tcid, json: row?.json || {} };
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
}

// ---------- SCAN tab ----------
function getOracleForCid(cid){
  const el = findCardEl(cid);
  const txt = el?.dataset?.oracle_text || el?.dataset?.oracle || '';
  return String(txt || '').trim();
}
function needsTap(text){
  return /\btap(?: this| it)?\:|^tap[, ]/i.test(text) || /\btap this\b/i.test(text);
}

function renderScan(){
  const host = bySel('.scanWrap', p);
  // One delegated handler for ALL action buttons inside the Scan pane
host.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn || !host.contains(btn)) return;
  ev.preventDefault();
  ev.stopPropagation();
  performActionFor(btn);        // uses the same logic as your old wireActionButton
});

  if (!host) return;
  host.innerHTML = '<div style="opacity:.85">Scanning…</div>';

  // inputs from the mini controls in the Scan tab header
  const xVal  = Number(bySel('.js-xval',  p)?.value || 1);

  // get oracle text from the focused card
  const cardEl = anchorEl || findCardEl(cid);
  const name   = cardEl?.dataset?.name || cid;
  const oracle = String(cardEl?.dataset?.oracle_text || cardEl?.dataset?.oracle || '').trim();
  if (!oracle){
    host.innerHTML = `<div style="opacity:.8">No Oracle text available for ${name}.</div>`;
    return;
  }

  // === Use your parser ===
  const { abilitiesOnly, innateTokens } = AD.detectAll(oracle);  // heads + split chain steps
  // helper: resolve "X" to UI value for concrete buttons
  const resolveX = (n) => (n === 'X' ? xVal : n);

  // build UI (one block per ability)
  const rows = abilitiesOnly.map((ab, i) => {
    const id = `scan-steps-${i}`;
    const reqId = `scan-req-${i}`;
    return `
      <div style="border:1px solid #2b3f63;border-radius:10px;padding:10px">
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div>
            <span class="pill gray" style="margin-right:6px">${ab.type.toUpperCase()}</span>
            <span style="opacity:.92">${escapeHtml(ab.raw)}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button id="${reqId}" class="togglebtn" aria-pressed="false">
              <span class="dot"></span><span>${escapeHtml(ab.cost ? `Pay cost: ${ab.cost}` : (ab.type==='activated' ? 'Pay activation cost' : 'Trigger happened'))}</span>
            </button>
            <button class="pill js-activate" data-i="${i}" disabled>Activate</button>
          </div>
        </div>
        <div id="${id}" class="steps" style="display:none"></div>
      </div>
    `;
  }).join('') || `<div style="opacity:.8">No activated/triggered abilities detected.</div>`;

  // optional: show innate token abilities (Food/Treasure/Clue etc.) under the list
  const innate = innateTokens.map((ta, j) => {
    const id = `scan-innate-${j}`;
    return `
      <div style="border:1px dashed #2a375a;border-radius:10px;padding:10px">
        <div>
          <span class="pill gray" style="margin-right:6px">INNATE</span>
          A ${escapeHtml(ta.token)} token is an artifact with “${escapeHtml(ta.cost)}: ${escapeHtml(ta.effect)}”
        </div>
        <div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:8px">
          <button class="togglebtn js-inn-cost" data-j="${j}" aria-pressed="false">
            <span class="dot"></span><span>Pay cost: ${escapeHtml(ta.cost)}</span>
          </button>
          <button class="pill js-inn-activate" data-j="${j}" disabled>Activate</button>
        </div>
        <div id="${id}" class="steps" style="display:none"></div>
      </div>
    `;
  }).join('');

  host.innerHTML = rows + (innate ? `<div style="margin-top:8px">${innate}</div>` : '');

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
// Turn a single choice option into a <button> that your existing
// wireActionButton() can execute (by setting data-* the same way
// actionRow() does for non-choice actions).
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
  if (opt.kind === 'add_mana'){
    const sym = (opt.symbols && opt.symbols[0]) ? opt.symbols[0] : '?';
    return `<button type="button" class="pill" data-act="add_mana" data-symbols="${opt.symbols.join(',')}">Add {${sym}}</button>`;
  }
  if (opt.kind === 'grant_keyword'){
    const lab = `Grant ${opt.keyword}${opt.untilEOT?' (EOT)':''}`;
    return `<button type="button" class="pill" disabled title="Handled via Apply tab">${lab}</button>`;
  }
  return `<button type="button" class="pill" disabled>${opt.kind}</button>`;
}

// ADD directly below optionBtnHtml(opt){...}

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
    case 'draw_cards': {
      const n = num(a.amount || 1);
      return pill(`data-act="draw_cards" data-n="${n}"`, `Draw ${n}`);
    }
    case 'deal_damage': {
      const n = num(a.amount || 1);
      return pill(`data-act="deal_damage" data-n="${n}"`, `Deal ${n} damage`);
    }
    case 'put_counters': {
      const n = num(a.amount || 1);
      const kind = a.counter || '+1/+1';
      const s = n === 1 ? '' : 's';
      return pill(`data-act="put_counters" data-n="${n}" data-counter="${kind}"`, `Put ${n} ${kind} counter${s}`);
    }
    case 'pt_mod': {
      const dp  = num(a.power);
      const dt  = num(a.toughness);
      const eot = a.untilEOT ? 1 : 0;
      const lab = `${dp>=0?'+':''}${dp}/${dt>=0?'+':''}${dt}${eot?' (EOT)':''}`;
      return pill(`data-act="pt_mod" data-dp="${dp}" data-dt="${dt}" data-eot="${eot}"`, lab);
    }
    case 'add_mana': {
      const syms = a.symbols || [];
      const sym  = syms[0] || '?';
      return pill(`data-act="add_mana" data-symbols="${syms.join(',')}"`, `Add {${sym}}`);
    }
    case 'grant_keyword': {
      const eot = a.untilEOT ? 1 : 0;
      const kw  = a.keyword || '';
      return pill(`data-act="grant_keyword" data-keyword="${kw}" data-eot="${eot}"`, `Grant ${kw}${eot?' (EOT)':''}`);
    }
    case 'set_color': {
      const eot = a.untilEOT ? 1 : 0;
      const cs  = (a.colors || []).join(',');
      return pill(`data-act="set_color" data-colors="${cs}" data-eot="${eot}"`, `Set color`);
    }
    case 'set_creature_type': {
      const eot = a.untilEOT ? 1 : 0;
      const t   = a.type || '';
      return pill(`data-act="set_creature_type" data-type="${t}" data-eot="${eot}"`, `Set creature type`);
    }
    case 'bounce':        return pill(`data-act="bounce"`,        `Return target to hand`);
    case 'reanimate':     return pill(`data-act="reanimate"`,     `Return target from graveyard`);
    case 'exile':         return pill(`data-act="exile"`,         `Exile target`);
    case 'sacrifice': {
      const n = num(a.amount || 1);
      return pill(`data-act="sacrifice" data-n="${n}"`, `Sacrifice ${n}`);
    }
    case 'destroy':       return pill(`data-act="destroy"`,       `Destroy target`);
    case 'gain_control':  return pill(`data-act="gain_control"`,  `Gain control`);
    case 'fight':         return pill(`data-act="fight"`,         `Fight`);
    case 'choice':        // choices are expanded elsewhere
      return '';
    default:
      return `<div class="pill gray" title="Unknown action">${a.kind || 'unknown'}</div>`;
  }
}



// Render a whole "choice" row: label + option buttons
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

box.innerHTML = actions.map(a => {
  if (a.kind === 'choice') return choiceRow(a);       // ← expand choices into concrete buttons
  return actionRow(a);                                 // existing rows for normal actions
}).join('') || '<div style="opacity:.8">No concrete actions.</div>';

// delegated .scanWrap click handler handles all [data-act] buttons (no per-button wiring here)



    });
  });

  // Innate: same flow, but we only parse the token effect text
  host.querySelectorAll('.js-inn-cost').forEach(btn => {
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', String(!on));
      const j = Number(btn.dataset.j);
      const act = host.querySelector(`.js-inn-activate[data-j="${j}"]`);
      if (act) act.disabled = on;
    });
  });
  host.querySelectorAll('.js-inn-activate').forEach(btn => {
    btn.addEventListener('click', () => {
      const j = Number(btn.dataset.j);
      const ta = innateTokens[j];
      const box = bySel(`#scan-innate-${j}`, host);
      const steps = bySel(`#scan-innate-${j}`, host).parentElement.querySelector('.steps');
      steps.style.display = 'block';
      const actions = AD.inferActionsFromText(ta.effect).map(a => {
        if (a.amount === 'X') a.amount = resolveX(a.amount);
        return a;
      });
      steps.innerHTML = actions.map(a => actionRow(a)).join('') || '<div style="opacity:.8">No concrete actions.</div>';
      
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
      const label = btn.dataset.token || 'Token';
      for (let i=0;i<n;i++) Zones?.spawnToTable?.({ name: label, img: '' }, meSeat);
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
          const chosenFiltered = chosen.filter(cid=>{
            if (!typeNorm) return true;
            const el = findCardEl(cid);
            const types = (el?.dataset?.types || el?.getAttribute('data-types') || '')
                          .toLowerCase().split(/[ ,/]+/).filter(Boolean);
            try {
              const meta = window.getCardDataById?.(cid);
              if (Array.isArray(meta?.types) && meta.types.map(s=>s.toLowerCase()).includes(typeNorm)) return true;
            } catch {}
            return types.includes(typeNorm);
          });


          if (!chosenFiltered.length){
            console.warn('[Activate] No targets matched the chosen type.');
            try { window.Overlays?.notify?.('warn','No targets matched chosen type.'); } catch {}
            return;
          }

          const room_id = currentRoom();
          await ensureSupabase();

          for (const tcid of chosenFiltered){
            await upsertRow(room_id, tcid, me, (json)=>{
              if (mode === 'pt'){
                const dp = Number(bySel('.js-dp', p)?.value || 0);
                const dt = Number(bySel('.js-dt', p)?.value || 0);
                if (dur === 'PERM'){
                  const pm = ensure(json, 'ptMod', ()=>({ pow:0, tgh:0 }));
                  pm.pow = (Number(pm.pow)||0) + dp;
                  pm.tgh = (Number(pm.tgh)||0) + dt;
                } else {
                  appendTempPT(json, { pow:dp, tgh:dt, sourceCid: cid, mode: dur });
                }
              } else if (mode === 'ability'){
                const abil = bySel('.js-abil', p)?.value?.trim();
                if (!abil) return json;
                if (dur === 'PERM') addPermanentAbility(json, abil);
                else appendTempAbility(json, { ability: abil, sourceCid: cid, mode: dur });
              } else if (mode === 'counter'){
                const kind = bySel('.js-ckind', p)?.value?.trim() || '+1/+1';
                const amt  = Number(bySel('.js-camt', p)?.value || 1);
                addPermanentCounter(json, kind, amt);
              }
              return json;
            });
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


          try { window.Overlays?.notify?.('ok', 'Effect applied.'); } catch {}
          panel._close?.();
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
    const touched = Array.from(window.__eotEffectTouched || []);
    window.__eotEffectTouched = new Set();

    for (const key of touched){
      const [rid, cid] = key.split(':');
      if (rid !== room_id) continue;

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
        return json;
      });
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
        return json;
      });
    }

    // prune memory tickets
    window.__linkedEffectTickets = (window.__linkedEffectTickets||[]).filter(t => !(t.room_id===room_id && String(t.sourceCid)===String(sourceCid)));
  }
};

export default ActivatedAbilities;
