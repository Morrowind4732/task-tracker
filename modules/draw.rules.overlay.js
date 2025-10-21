// modules/draw.rules.overlay.js
// Draw Rules Overlay — uses Activated Abilities-style spinners + radial counter picker
// Exposes: window.DrawRules.open(), window.DrawRules.close()

const TAG = '[DrawRules]';
const log  = (...a)=>{ try{ console.log(TAG, ...a); }catch{} };
const warn = (...a)=>{ try{ console.warn(TAG, ...a); }catch{} };

const Z = 10050;
const ROOT_ID = 'draw-rules-overlay-root';
const DECK_IMG = 'https://i.imgur.com/LdOBU1I.jpeg'; // deck thumbnail

const COUNTER_TYPES = [
  '+1/+1','-1/-1','+1/+0','+0/+1',
  'Flying','First strike','Double strike','Deathtouch','Lifelink',
  'Menace','Reach','Trample','Vigilance','Hexproof','Indestructible',
  'Prowess','Ward','Shield','Stun','Oil','Time','Energy','Experience',
  'Infection','Slime','Aim','Brick','Charge','Level','Gold','Quest','Verse'
];

// ---------- DOM helpers ----------
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
const rootEl = ()=> document.getElementById(ROOT_ID);

// ---------- UI: radial quick picker ----------
function makeRadialPicker(anchorBtn, items, title, onPick){
  const scrim = document.createElement('div');
  Object.assign(scrim.style, { position:'fixed', inset:0, zIndex:Z+100, background:'transparent' });

  const r = document.createElement('div');
  Object.assign(r.style, {
    position:'absolute', width:'560px', height:'560px', borderRadius:'50%',
    display:'grid', placeItems:'center', pointerEvents:'auto',
    filter:'drop-shadow(0 10px 28px rgba(0,0,0,.5))'
  });

  const ring = document.createElement('div');
  Object.assign(ring.style, { position:'absolute', inset:0, borderRadius:'50%', background:'#0f1829', border:'1px solid #2b3f63' });

  const alpha = document.createElement('div');
  Object.assign(alpha.style, { position:'absolute', inset:'10px', borderRadius:'50%' });

  const panel = document.createElement('div');
  panel.innerHTML = `<h4 style="margin:0 0 8px 0;font-size:18px;font-weight:900;color:#cfe1ff">${title||'Select'}</h4><div class="grid"></div>`;
  Object.assign(panel.style, {
    position:'absolute', width:'360px', maxHeight:'320px', overflow:'auto',
    top:'50%', left:'50%', transform:'translate(-50%, -50%)',
    background:'#101a2c', border:'1px solid #2b3f63', borderRadius:'14px', padding:'10px', display:'none'
  });

  r.append(ring, alpha, panel);
  scrim.appendChild(r); document.body.appendChild(scrim);

  const SIZE = 560, HALF = SIZE/2, BTN_OFFSET = 86, RADIUS = HALF - BTN_OFFSET;
  const rect = anchorBtn.getBoundingClientRect();
  let cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
  const vw = Math.max(document.documentElement.clientWidth, window.innerWidth||0);
  const vh = Math.max(document.documentElement.clientHeight, window.innerHeight||0);
  const pad = 20;
  cx = Math.min(Math.max(cx, HALF+pad), vw - HALF - pad);
  cy = Math.min(Math.max(cy, HALF+pad), vh - HALF - pad);
  Object.assign(r.style, { left: (cx-HALF)+'px', top:(cy-HALF)+'px' });

  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((ch, idx)=>{
    const b = document.createElement('button');
    b.type='button'; b.textContent=ch;
    Object.assign(b.style, {
      position:'absolute', width:'64px', height:'64px', borderRadius:'50%',
      border:'1px solid #2b3f63', background:'#142039', color:'#cfe1ff',
      fontWeight:900, cursor:'pointer', lineHeight:'64px', textAlign:'center',
      fontSize:'24px', transform:'translate(-50%,-50%)', boxShadow:'0 2px 6px rgba(0,0,0,.35)'
    });
    const angle = (idx/26)*Math.PI*2 - Math.PI/2;
    const x = HALF + Math.cos(angle)*RADIUS;
    const y = HALF + Math.sin(angle)*RADIUS;
    b.style.left = x+'px'; b.style.top = y+'px';

    b.onclick = ()=>{
      const grid = panel.querySelector('.grid');
      grid.innerHTML = '';
      Object.assign(grid.style, { display:'grid', gridTemplateColumns:'1fr', gap:'6px' });
      items.filter(it=>it.toLowerCase().startsWith(ch.toLowerCase()))
           .slice(0,400)
           .forEach(it=>{
             const item = document.createElement('div');
             item.textContent = it;
             Object.assign(item.style, {
               padding:'8px 10px', border:'1px solid #2b3f63', borderRadius:'10px',
               background:'#0f1829', color:'#d9e8ff', cursor:'pointer', fontSize:'18px', fontWeight:700
             });
             item.onclick = ()=>{ onPick?.(it); try{ scrim.remove(); }catch{} };
             grid.appendChild(item);
           });
      panel.style.display='block';
    };

    alpha.appendChild(b);
  });

  scrim.addEventListener('click', (e)=>{ if(e.target===scrim) try{scrim.remove();}catch{}; }, {capture:true});
}

// ---------- Build overlay root ----------
function buildRoot(){
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `
  <style>
    #${ROOT_ID}{ position:fixed; inset:0; z-index:${Z}; }
    #${ROOT_ID} .dr-scrim{ position:absolute; inset:0; background:rgba(0,0,0,.55); }
    #${ROOT_ID} .dr-wrap{ position:absolute; inset:6% 8%; background:#0d1524; border:1px solid #2b3f63; border-radius:14px; display:flex; flex-direction:column; z-index:${Z+1}; box-shadow:0 10px 40px rgba(0,0,0,.6) }
    #${ROOT_ID} .dr-head{ display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid #1e2a44 }
    #${ROOT_ID} .dr-title{ font-weight:900; color:#e7f0ff }
    #${ROOT_ID} .dr-x{ margin-left:auto; background:#1b2b4b; color:#cfe1ff; border:1px solid #2b3f63; border-radius:10px; width:36px; height:32px; cursor:pointer }

    #${ROOT_ID} .dr-body{
  display:grid;
  grid-template-columns: 1fr;   /* one column */
  grid-template-rows: auto 1fr; /* decks row, then rules */
  gap:12px; padding:12px; height:100%;
}

    
    #${ROOT_ID} .dr-label{ font-weight:900; opacity:.9; margin-bottom:6px; color:#cfe1ff }

#${ROOT_ID} .dr-left, #${ROOT_ID} .dr-right{ min-height:0; display:flex; flex-direction:column }
#${ROOT_ID} .dr-left{ grid-row:1 }   /* deck row first */
#${ROOT_ID} .dr-right{ grid-row:2 }  /* rules second */

#${ROOT_ID} .dr-decks{
  display:flex; flex-wrap:nowrap; gap:10px;
  overflow:auto; padding-right:4px; scrollbar-width:thin;
}
#${ROOT_ID} .dr-chip{
  display:flex; align-items:center; gap:10px; padding:10px 12px;
  min-width:260px; /* nice chip width for horizontal row */
  border:1px solid #2b3f63; border-radius:12px; background:#0f1829; color:#cfe1ff; cursor:pointer;
  flex:0 0 auto;
}

    #${ROOT_ID} .dr-chip.sel{ outline:2px solid #3d6df0 }
    #${ROOT_ID} .dr-chip .img{ width:44px; height:60px; border-radius:8px; background:#142136; background-image:url('${DECK_IMG}'); background-size:cover; background-position:center; box-shadow:0 2px 6px rgba(0,0,0,.35) }

    #${ROOT_ID} .dr-rules{ display:flex; flex-direction:column; gap:10px; overflow:auto; padding-right:4px; min-height:0 }
    #${ROOT_ID} .dr-row{ display:grid; gap:10px; grid-template-columns:min-content 1fr min-content; align-items:center; border:1px solid #2b3f63; border-radius:12px; background:#0f1829; padding:8px }
    #${ROOT_ID} .dr-pill{ display:inline-flex; align-items:center; gap:8px; border:1px solid #2b3f63; border-radius:999px; background:#0f1829; color:#cfe1ff; padding:6px 10px; white-space:nowrap }
    #${ROOT_ID} .dr-kind{ display:flex; gap:8px; flex-wrap:wrap }
    #${ROOT_ID} .dr-hide{ display:none !important }

    #${ROOT_ID} .dr-actions{ display:flex; gap:10px; align-items:center; margin-top:8px }
    #${ROOT_ID} .dr-add, #${ROOT_ID} .dr-save{ border:1px solid #2b3f63; border-radius:999px; background:#18304f; color:#e7f0ff; padding:6px 12px; cursor:pointer }
    #${ROOT_ID} .dr-del{ border:1px solid #854040; border-radius:999px; background:#2b0f14; color:#ffd7d7; padding:6px 10px; cursor:pointer }

    /* Toggle buttons (also used for > and =) */
    #${ROOT_ID} .toggle{ border:1px solid #2b3f63; border-radius:10px; background:#0f1829; color:#cfe1ff; padding:4px 8px; cursor:pointer }
    #${ROOT_ID} .toggle.sel{ background:#18304f; color:#e7f0ff; box-shadow:0 0 0 2px #284e9b inset }

    /* Vertical operator toggle */
    #${ROOT_ID} .dr-vtoggle{ display:flex; flex-direction:column; gap:4px; margin:0 6px }
    #${ROOT_ID} .dr-vtoggle .toggle{ width:36px; height:22px; line-height:20px; text-align:center; padding:0; border-radius:8px }

    /* Number spinner (matches Activated Abilities)  — source style referenced from activated.abilities.js */
    #${ROOT_ID} .nspin{ display:inline-flex; align-items:center; gap:6px; background:#0f1829; border:1px solid #2b3f63; border-radius:999px; padding:4px 6px; }
    #${ROOT_ID} .nspin .nbtn{ width:30px; height:30px; border-radius:50%; border:1px solid #2b3f63; background:#142039; color:#cfe1ff; font-weight:900; line-height:28px; text-align:center; cursor:pointer; user-select:none; }
    #${ROOT_ID} .nspin .nbtn:hover{ background:#1b2b4b; }
    #${ROOT_ID} .nspin .nbtn:active{ background:#234065; transform:scale(.98); }
    #${ROOT_ID} .nspin-input{ width:68px; text-align:center; font-weight:900; font-size:18px; color:#cfe1ff; background:transparent; border:0; -webkit-text-fill-color:#cfe1ff; caret-color:transparent; pointer-events:none; }
    @media (pointer:coarse){ #${ROOT_ID} .nspin .nbtn{ width:36px; height:36px; line-height:34px } #${ROOT_ID} .nspin-input{ width:76px; font-size:20px } }

    /* Keep stacked layout on touch too */
@media (pointer:coarse){
  #${ROOT_ID} .dr-body{
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
}

  </style>

  <div class="dr-scrim" data-dr="scrim"></div>
  <div class="dr-wrap" data-dr="wrap" role="dialog" aria-label="Draw Rules">
    <div class="dr-head">
      <div class="dr-title">Draw Rules</div>
      <button class="dr-x" data-dr="close" aria-label="Close">✕</button>
    </div>

    <div class="dr-body">
      <div class="dr-left">
        <div class="dr-label">Choose Deck</div>
        <div class="dr-decks" data-dr="decks"></div>
      </div>

      <div class="dr-right">
        <div class="dr-label">Rules</div>
        <div class="dr-rules" data-dr="rules"></div>
        <div class="dr-actions">
          <button class="dr-add" data-dr="add">＋ Add rule</button>
          <div style="flex:1"></div>
          <button class="dr-save" data-dr="save">Save</button>
        </div>
      </div>
    </div>
  </div>`;
  return root;
}

// ---------- Number spinner behavior ----------
function wireSpinner(spinner){
  if (!spinner) return;
  const input = spinner.querySelector('.nspin-input');
  const sub = spinner.querySelector('.nsub');
  const add = spinner.querySelector('.nadd');
  const clamp = v => isFinite(v) ? Math.max(-9999, Math.min(9999, v)) : 0;
  function bump(d){
    const cur = parseInt(input.value||'0',10) || 0;
    input.value = String(clamp(cur + d));
    input.dispatchEvent(new Event('input', {bubbles:true}));
  }
  sub?.addEventListener('click', ()=> bump(-1));
  add?.addEventListener('click', ()=> bump(+1));
}

// ---------- Rule row ----------
function mkRow(){
  const group = 'act-' + Math.random().toString(36).slice(2);
  const row = document.createElement('div');
  row.className = 'dr-row';
  row.innerHTML = `
    <!-- Condition: Draw # [> / =] N -->
    <label class="dr-pill dr-cond">
      <span>Draw&nbsp;#</span>
      <div class="dr-vtoggle">
        <button type="button" class="toggle js-op-gt sel">&gt;</button>
        <button type="button" class="toggle js-op-eq sel">=</button>
      </div>
      <div class="nspin" data-field="at">
        <button type="button" class="nbtn nsub" aria-label="decrease">−</button>
        <input type="number" class="js-at nspin-input" value="1" inputmode="numeric" readonly />
        <button type="button" class="nbtn nadd" aria-label="increase">+</button>
      </div>
    </label>

    <!-- Kind radios -->
    <div class="dr-kind">
      <label class="dr-pill"><input type="radio" name="${group}" value="heal" checked/> Heal</label>
      <label class="dr-pill"><input type="radio" name="${group}" value="token"/> Token</label>
      <label class="dr-pill"><input type="radio" name="${group}" value="counter"/> Counter</label>
      <label class="dr-pill"><input type="radio" name="${group}" value="pt"/> P/T</label>

      <!-- HEAL -->
      <div class="dr-heal">
        <label class="dr-pill">Amount
          <div class="nspin" data-field="hqty">
            <button type="button" class="nbtn nsub" aria-label="decrease">−</button>
            <input type="number" class="js-hqty nspin-input" value="1" inputmode="numeric" readonly />
            <button type="button" class="nbtn nadd" aria-label="increase">+</button>
          </div>
        </label>
      </div>

      <!-- TOKEN -->
      <div class="dr-token dr-hide">
        <label class="dr-pill">Token name
          <input class="js-tname" type="text" placeholder="Clue / Food / Custom" style="min-width:160px;background:transparent;border:0;color:#cfe1ff"/>
        </label>
      </div>

      <!-- COUNTER -->
      <div class="dr-counter dr-hide">
        <label class="dr-pill">Kind
          <input class="js-ckind" type="text" value="+1/+1" placeholder="+1/+1" style="min-width:120px;background:transparent;border:0;color:#cfe1ff"/>
          <button type="button" class="toggle js-ckind-pick" title="Pick a counter">＋</button>
        </label>
        <label class="dr-pill">Qty
          <div class="nspin" data-field="cqty">
            <button type="button" class="nbtn nsub" aria-label="decrease">−</button>
            <input type="number" class="js-cqty nspin-input" value="1" inputmode="numeric" readonly />
            <button type="button" class="nbtn nadd" aria-label="increase">+</button>
          </div>
        </label>
      </div>

      <!-- P/T -->
      <div class="dr-pt dr-hide">
        <label class="dr-pill">P
          <div class="nspin" data-field="dp">
            <button type="button" class="nbtn nsub" aria-label="decrease">−</button>
            <input type="number" class="js-dp nspin-input" value="1" inputmode="numeric" readonly />
            <button type="button" class="nbtn nadd" aria-label="increase">+</button>
          </div>
        </label>
        <label class="dr-pill">T
          <div class="nspin" data-field="dt">
            <button type="button" class="nbtn nsub" aria-label="decrease">−</button>
            <input type="number" class="js-dt nspin-input" value="1" inputmode="numeric" readonly />
            <button type="button" class="nbtn nadd" aria-label="increase">+</button>
          </div>
        </label>
      </div>
    </div>

    <button class="dr-del">Delete</button>
  `;

  // Wire spinners in this row
  $$('.nspin', row).forEach(wireSpinner);

  // Operator toggle logic: both ON => 'ge'; only '=' => 'eq'; only '>' => 'gt'
  const opGT = $('.js-op-gt', row);
  const opEQ = $('.js-op-eq', row);
  const toggleSel = (btn)=> btn.classList.toggle('sel');
  opGT.addEventListener('click', ()=> toggleSel(opGT));
  opEQ.addEventListener('click', ()=> toggleSel(opEQ));
  row.getCmp = function(){
    const gt = opGT.classList.contains('sel');
    const eq = opEQ.classList.contains('sel');
    if (gt && eq) return 'ge';
    if (eq && !gt) return 'eq';
    if (gt && !eq) return 'gt';
    return 'eq';
  };

  // Radio show/hide
  const updateKind = ()=>{
    const kind = $(`input[type="radio"][name="${group}"]:checked`, row)?.value || 'heal';
    $('.dr-heal', row).classList.toggle('dr-hide', kind!=='heal');
    $('.dr-token', row).classList.toggle('dr-hide', kind!=='token');
    $('.dr-counter', row).classList.toggle('dr-hide', kind!=='counter');
    $('.dr-pt', row).classList.toggle('dr-hide', kind!=='pt');
  };
  $$(`input[type="radio"][name="${group}"]`, row).forEach(r => r.addEventListener('change', updateKind));
  updateKind();

  // Counter kind quick picker
  $('.js-ckind-pick', row)?.addEventListener('click', (ev)=>{
    const input = $('.js-ckind', row);
    makeRadialPicker(ev.currentTarget, COUNTER_TYPES, 'Pick counter kind', picked=>{
      input.value = picked; input.dispatchEvent(new Event('input', {bubbles:true}));
    });
  });

  // Delete
  $('.dr-del', row).onclick = ()=> row.remove();

  return row;
}

// ---------- Open / Close ----------
function open(){
  log('open()');
  try{ rootEl()?.remove(); }catch{}

  const root = buildRoot();
  document.body.appendChild(root);

  const scrim   = $('[data-dr="scrim"]', root);
  const wrap    = $('[data-dr="wrap"]', root);
  const decks   = $('[data-dr="decks"]', root);
  const rulesEl = $('[data-dr="rules"]', root);
  const btnAdd  = $('[data-dr="add"]', root);
  const btnSave = $('[data-dr="save"]', root);
  const btnX    = $('[data-dr="close"]', root);

  // protect from external overlay closers
// Only the SCRIM should close; don't intercept clicks inside the wrap.
scrim.addEventListener('click', (ev)=>{ ev.stopPropagation?.(); close(); }, true);
// wrap listener removed so buttons/spinners receive their own click handlers

  // Deck chips
  const seats = (window.activeSeats?.() || [1,2]);
  seats.forEach(seat=>{
    const chip = document.createElement('div');
    chip.className = 'dr-chip';
    chip.dataset.seat = String(seat);
    chip.innerHTML = `<div class="img"></div><div>Seat ${seat} Deck</div>`;
    chip.onclick = ()=>{
      $$('.dr-chip', decks).forEach(c=>c.classList.remove('sel'));
      chip.classList.add('sel');
    };
    if (!$('.dr-chip', decks)) chip.classList.add('sel');
    decks.appendChild(chip);
  });

  const addRow = ()=> rulesEl.appendChild(mkRow());
  btnAdd.onclick = addRow; addRow();

  btnSave.onclick = ()=>{
    const selSeat = Number($('.dr-chip.sel', decks)?.dataset.seat || 1);
    const rules = $$('.dr-row', rulesEl).map(row=>{
      const cmp = typeof row.getCmp === 'function' ? row.getCmp() : 'ge';
      const at  = parseInt($('.js-at', row)?.value||'1',10) || 1;
      const kind = $(`input[type="radio"][name^="act-"]:checked`, row)?.value || 'heal';
      const out = { cmp, at, kind };
      if (kind==='heal'){
        out.qty = parseInt($('.js-hqty', row)?.value||'1',10) || 1;
      } else if (kind==='token'){
        out.tokenName = String($('.js-tname', row)?.value||'').trim() || 'Token';
      } else if (kind==='counter'){
        out.qty   = parseInt($('.js-cqty', row)?.value||'1',10) || 1;
        out.ckind = String($('.js-ckind', row)?.value||'+1/+1').trim() || '+1/+1';
      } else if (kind==='pt'){
        out.p = parseInt($('.js-dp', row)?.value||'0',10) || 0;
        out.t = parseInt($('.js-dt', row)?.value||'0',10) || 0;
      }
      return out;
    });
    log('SAVE → seat', selSeat, 'rules', rules);
// [ADD DrawRulesEval] persist rules per seat
try { window.DrawRulesEval?.save?.(selSeat, rules); } catch {}

// Persist for evaluator
try { 
  window.DrawRulesEval = window.DrawRulesEval || { store:{} };
  window.DrawRulesEval.store[selSeat] = rules;
} catch {}

try { window.notify?.(`Saved ${rules.length} rule${rules.length!==1?'s':''} for Seat ${selSeat}.`); } catch {}
close();

  };

  btnX.onclick = close;
}

function close(){ try{ rootEl()?.remove(); }catch{} }

// ===== Draw Rules evaluator (fires on each DrawCounter.inc) =====
(function(){
  const E = (window.DrawRulesEval = window.DrawRulesEval || { store:{} });

  E.getRulesForSeat = function(seat){ return this.store?.[seat] || []; };

  // count = draw number for the TURN (after the bump)
  // ===== Draw Rules evaluator (fires on each DrawCounter.inc)
E.onDraw = function(seat, count){
  const rules = E._rules || [];   // array of { after, kind, qty, tokenName, ... }
  console.log('[PROBE B-inline] onDraw seat=', seat, 'count=', count, 'rules=', rules);

  for (const r of rules){
    const ok = Number(count) >= Number(r.after || 0);
    console.log('[PROBE B-inline] check rule=', r, 'ok=', ok);
    if (!ok) continue;

    if (r.kind === 'heal'){
      console.log('[PROBE B-inline] HEAL hit qty=', r.qty);
      const cur = window.Life?.get?.(seat);
      if (cur){
        const next = (cur.life||0) + (Number(r.qty)||0);
        window.Life?.set?.(seat, { life: next });
      }
      continue;
    }

    if (r.kind === 'token'){
      const name = String(r.tokenName || 'Token').trim();
      console.log('[PROBE B-inline] TOKEN hit name=', name);
      try {
        window.Overlays?.openAddCard?.({
          seat: Number(seat)||1,
          presetQuery: name,
          presetType: 'Token',
          autoSearch: true
        });
      } catch(e){
        console.warn('[PROBE B-inline] openAddCard fail', e);
      }
      continue;
    }
  }
};

})();


// === [DrawRulesEval] persist + evaluate on draws ==========================
// Ctrl-F anchor: [ADD DrawRulesEval]
(function(){
  const STORE = 'drawRules.v1';
  const key = (seat)=> `${STORE}.seat${Number(seat)||1}`;

  function save(seat, rules){
    try{ localStorage.setItem(key(seat), JSON.stringify(rules||[])); }
    catch(e){ console.warn('[DrawRulesEval] save error', e); }
  }
  function load(seat){
    try{ return JSON.parse(localStorage.getItem(key(seat)) || '[]'); }
    catch{ return []; }
  }

 /** Apply one rule’s effect to the board (uses v3 Life API) */
function apply(rule, seat){
  if (!rule) return;

  if (rule.kind === 'heal'){
    const cur = window.Life?.get?.(seat);
    if (!cur) return;
    const next = (cur.life||0) + (Number(rule.qty)||0);
    window.Life?.set?.(seat, { life: next });     // realtime, broadcasts to peers
    console.log('[PROBE B-apply] HEAL +', rule.qty, '→ P'+seat);
    return;
  }

  if (rule.kind === 'token'){
    const name = String(rule.tokenName || 'Token').trim();
    console.log('[PROBE B-apply] TOKEN open overlay name=', name, 'seat=', seat);
    try {
      window.Overlays?.openAddCard?.({
        seat: Number(seat)||1,
        presetQuery: name,
        presetType: 'Token',
        autoSearch: true
      });
    } catch(e){
      console.warn('[PROBE B-apply] openAddCard fail', e);
    }
    return;
  }
}


  /** Evaluate saved rules for seat at current draw count */
  function onDraw(seat, count){
    seat = Number(seat)||1;
    const rules = load(seat);
    for (const r of rules){
      const ok =
        (r.cmp === 'ge' && count >= r.at) ||
        (r.cmp === 'gt' && count >  r.at) ||
        (r.cmp === 'eq' && count === r.at);
      if (ok) apply(r, seat);
    }
  }

  // expose a small public API
  window.DrawRulesEval = { save, load, onDraw };
})();


window.DrawRules = { open, close };
