// ==============================================
// FILE: modules/card.stacking.js
// Simplified stacking system (3×3 grid logic)
// L/R = placement-only (never linked); U/D = true stack
// Robust detach + de-dup + z-order-by-screen-Y
// ==============================================

const _ST = {
  stacks: Object.create(null),   // stackId -> { dir, order:[cid,] }
  idxByCid: Object.create(null), // cid -> { stackId, idx }
  idSeq: 1
};

// Movement threshold guard (shared by Zones)
const MOVE_THRESH = 6; // px

function _movedEnough(el){
  const startX = parseFloat(el.dataset.startLeft || 0);
  const startY = parseFloat(el.dataset.startTop  || 0);
  const nowX   = parseFloat(el.style.left || 0);
  const nowY   = parseFloat(el.style.top  || 0);
  return Math.hypot(nowX - startX, nowY - startY) > MOVE_THRESH;
}

function _metaFor(el){
  const cid = el?.dataset?.cid || '';
  const domName = el?.dataset?.name || '';
  // 🔁 Tooltip caches oracle as `dataset.oracle_text` (not `oracle`)
  const domOracle = el?.dataset?.oracle_text || el?.dataset?.oracle || '';

  let metaName = domName;
  let metaOracle = domOracle;

  try{
    // Light, sync fallback to your card store
    const meta = window.Zones?.getCardDataById?.(cid);
    if (!metaName && meta?.name) metaName = String(meta.name);
    if (!metaOracle && (meta?.oracle_text || meta?.oracle)) {
      metaOracle = String(meta.oracle_text || meta.oracle);
    }
  }catch{}

  return { cid, name: metaName || cid, oracle: metaOracle || '' };
}


function _openEquipSuggestUI({ sourceEl, targetEl, source, target }){
  const xHost = document.createElement('div');
  Object.assign(xHost.style, {
    position:'fixed', inset:'auto 12px 12px auto', zIndex: 9999,
    background:'#151a2b', color:'#e7f0ff', border:'1px solid #2b3f63',
    borderRadius:'12px', padding:'10px', boxShadow:'0 12px 30px rgba(0,0,0,.45)'
  });

  // Shallow parse for +P/+T and keyword picks
  const tx = String(source.oracle||'');
  const m = tx.match(/gets?\s*\+(\d+|X)\s*\/\s*\+(\d+|X)/i);
  const kw = [];
  if (/lifelink/i.test(tx))     kw.push('Lifelink');
  if (/deathtouch/i.test(tx))   kw.push('Deathtouch');
  if (/flying/i.test(tx))       kw.push('Flying');
  if (/trample/i.test(tx))      kw.push('Trample');
  if (/haste/i.test(tx))        kw.push('Haste');
  if (/menace/i.test(tx))       kw.push('Menace');
  if (/vigilance/i.test(tx))    kw.push('Vigilance');
  if (/(^|[^-])first strike/i.test(tx))  kw.push('First Strike');
  if (/double[- ]?strike/i.test(tx))     kw.push('Double Strike');
  if (/hexproof/i.test(tx))     kw.push('Hexproof');
  if (/indestructible/i.test(tx)) kw.push('Indestructible');

  const hasPT = !!m;
  const p0 = (m && m[1]) || '0';
  const t0 = (m && m[2]) || '0';

  xHost.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <strong>Apply from <em>${source.name}</em> → <em>${target.name}</em></strong>
      <button class="pill js-close" style="margin-left:auto;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 10px">Close</button>
    </div>
    <div style="display:grid;gap:8px">
      ${hasPT ? `
        <div style="display:flex;gap:8px;align-items:center">
          <span class="pill" style="opacity:.9">+P/+T</span>
          <input class="js-p" type="number" value="${p0==='X' ? 1 : Number(p0)||0}" style="width:72px;background:#0f1829;color:#cfe1ff;border:1px solid #2b3f63;border-radius:8px;padding:4px 6px"/>
          <span style="opacity:.8">/</span>
          <input class="js-t" type="number" value="${t0==='X' ? 1 : Number(t0)||0}" style="width:72px;background:#0f1829;color:#cfe1ff;border:1px solid #2b3f63;border-radius:8px;padding:4px 6px"/>
          <button class="pill js-apply-pt" style="border:1px solid #2b3f63;border-radius:999px;background:#18304f;color:#e7f0ff;padding:4px 10px">Apply +P/+T (Linked)</button>
        </div>
      ` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${(kw.length?kw:['Lifelink','Deathtouch','Flying','Trample','Haste','Menace','Vigilance','First Strike','Double Strike','Hexproof','Indestructible'])
          .map(k=>`<button class="pill js-kw" data-kw="${k}" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 10px">${k}</button>`).join('')}
        <label class="pill" style="display:flex;align-items:center;gap:6px;border:1px dashed #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 10px">
          Other <input class="js-otherkw" type="text" placeholder="e.g. Reach" style="min-width:140px;background:#0f1829;color:#cfe1ff;border:1px solid #2b3f63;border-radius:8px;padding:2px 6px"/>
          <button class="pill js-apply-kw" style="border:1px solid #2b3f63;border-radius:999px;background:#18304f;color:#e7f0ff;padding:2px 10px">Grant</button>
        </label>
      </div>
    </div>
  `;

  const close = ()=> { try{xHost.remove();}catch{} };
  xHost.querySelector('.js-close').onclick = close;

  const sourceCid = sourceEl.dataset.cid;
  const targetCid = targetEl.dataset.cid;

  async function applyLinkedPT(dp, dt){
    try{
      const CA = window.CardAttributes;
      if (!CA) return;
      await CA.fetchIfMissing(targetCid);
      const cur = (CA.cache && CA.cache[targetCid]) || {};
      const temp = Array.isArray(cur.tempPT) ? cur.tempPT.slice() : [];
      const id = 'tpt_'+Math.random().toString(36).slice(2);
      temp.push({ id, pow:Number(dp)||0, tgh:Number(dt)||0, sourceCid: sourceCid, mode:'LINKED' });
      const pm = { pow: (Number(cur.ptMod?.pow)||0) + Number(dp||0),
                   tgh: (Number(cur.ptMod?.tgh)||0) + Number(dt||0) };
      await CA.set(targetCid, { tempPT: temp, ptMod: pm });
      // track for cleanup
      window.__linkedEffectTickets ||= [];
      window.__linkedEffectTickets.push({ room_id: CA.roomId, sourceCid, applyTo:[targetCid] });
      // refresh
      CA.applyToDom?.(targetCid); CA.refreshPT?.(targetCid);
    }catch(e){ console.warn('[EquipSuggest] PT apply failed', e); }
  }

  async function applyLinkedKW(kw){
    try{
      const CA = window.CardAttributes;
      if (!CA) return;
      await CA.fetchIfMissing(targetCid);
      const cur = (CA.cache && CA.cache[targetCid]) || {};
      const temp = Array.isArray(cur.tempEffects) ? cur.tempEffects.slice() : [];
      const id = 'tef_'+Math.random().toString(36).slice(2);
      // capitalize like Activated does
      const cap = String(kw||'').trim().split(/\s+/).map(w=>w? (w[0].toUpperCase()+w.slice(1).toLowerCase()) : '').join(' ');
      temp.push({ id, ability: cap, sourceCid: sourceCid, mode:'LINKED' });
      await CA.set(targetCid, { tempEffects: temp });
      window.__linkedEffectTickets ||= [];
      window.__linkedEffectTickets.push({ room_id: CA.roomId, sourceCid, applyTo:[targetCid] });
      CA.applyToDom?.(targetCid); CA.refreshPT?.(targetCid);
    }catch(e){ console.warn('[EquipSuggest] KW apply failed', e); }
  }

  xHost.querySelector('.js-apply-pt')?.addEventListener('click', ()=>{
    const dp = Number(xHost.querySelector('.js-p')?.value||0);
    const dt = Number(xHost.querySelector('.js-t')?.value||0);
    applyLinkedPT(dp, dt);
  });

  xHost.querySelectorAll('.js-kw').forEach(btn=>{
    btn.addEventListener('click', ()=> applyLinkedKW(btn.dataset.kw));
  });
  xHost.querySelector('.js-apply-kw')?.addEventListener('click', ()=>{
    const v = xHost.querySelector('.js-otherkw')?.value || '';
    if (v.trim()) applyLinkedKW(v.trim());
  });

  document.body.appendChild(xHost);
}



// ---- Tunables (feel free to tweak) ----
const MIN_INTERSECT_RATIO = 0.03; // 3% overlap required
export const PAD_X = 400;         // horizontal spacing for L/R placement
export const PAD_Y = 30;          // vertical spacing for U/D stacks

// ---------------- Public API -----------------
const Stacking = {
  /**
   * Try to consume a drop as a stacking/placement action.
   * Returns true if we handled it, false if caller should do default placement.
   */
onDrop({ draggedEl, targetEl } = {}) {
  if (!draggedEl) return false;

  // 🚫 Skip if this was a tap (defensive guard)
  if (draggedEl.dataset.justTapped === '1') return false;
  // 🚫 Ignore trivial movement (no actual drag)
  if (!_movedEnough(draggedEl)) return false;

  // Find overlap target by area if not explicitly passed
  let tgt = targetEl || _findOverlapTarget(draggedEl);

  // 🚫 If the target is part of the SAME stack, treat as "no target"
  if (tgt) {
    const dCid = draggedEl.dataset?.cid;
    const tCid = tgt.dataset?.cid;
    const dRec = _ST.idxByCid[dCid];
    const tRec = _ST.idxByCid[tCid];
    if (dRec && tRec && dRec.stackId === tRec.stackId) {
      // Same-stack translation: move base so the dragged slot lands at current coords
      const st = _ST.stacks[dRec.stackId];
      if (st && (st.dir === 'up' || st.dir === 'down')) {
        const rootCid = st.order[0];
        const rootEl  = document.querySelector(`.card[data-cid="${CSS.escape(String(rootCid))}"]`);
        const currL   = parseFloat(draggedEl.style.left) || 0;
        const currT   = parseFloat(draggedEl.style.top)  || 0;
        const offsetY = dRec.idx * PAD_Y * (st.dir === 'down' ? 1 : -1);
        if (rootEl) {
          rootEl.style.left = `${currL}px`;
          rootEl.style.top  = `${currT - offsetY}px`;
        }
        _layoutStack(dRec.stackId);
        return true;
      }
      // Not a vertical stack? fall through as if no target:
      return false;
    }
  }

  // === No overlap target → translate the WHOLE vertical stack (stay linked) ===
  // === No overlap target → DETACH the moving slice (so linked buffs clear) ===
if (!tgt || tgt === draggedEl) {
  const moving = Stacking.sliceFrom(draggedEl.dataset?.cid) || [];
  for (const mcid of moving) _removeFromAllStacks(mcid); // clears LINKED via _clearLinkedEffects
  return false; // let caller do default free placement
}


const dir = _detectGridDirection(draggedEl, tgt);
if (!dir) return false;
const vdir = (dir==='down' ? 'up' : dir);

// L/R = placement only (never linked)
if (vdir === 'left' || vdir === 'right') {
  // 🔊 LOG: dropped card oracle + target name
  try {
    const src = _metaFor(draggedEl);
    const dst = _metaFor(tgt);
    console.log(`[Drop] ${src.name} → ${dst.name} | Oracle: ${src.oracle}`);
  } catch {}

  _removeFromAllStacks(draggedEl);
  _placeBesideStackBottom({ draggedEl, targetEl: tgt, dir: vdir });
  _scrubStackAttrs(draggedEl);
  return true;
}

// U/D = true stacks — move the entire slice as a unit
const movingCids = Stacking.sliceFrom(draggedEl.dataset?.cid) || [];
for (const mcid of movingCids) _removeFromAllStacks(mcid);

// 🔊 LOG: dropped card oracle + target name
try {
  const src = _metaFor(draggedEl);
  const dst = _metaFor(tgt);
  console.log(`[Drop] ${src.name} → ${dst.name} | Oracle: ${src.oracle}`);
} catch {}

// Offer quick suggestions when the dropped card looks like Equipment/Aura buffs
try {
  const src = _metaFor(draggedEl);
  const dst = _metaFor(tgt);
  if (src.oracle && /equipped|enchanted|gets\s*\+\d+\/\+\d+|lifelink|deathtouch|flying|trample|haste|menace|vigilance|first strike|double strike|hexproof|indestructible/i.test(src.oracle)) {
    _openEquipSuggestUI({ sourceEl: draggedEl, targetEl: tgt, source: src, target: dst });
  }
} catch {}
if (vdir === 'up') {
  const bottom = _bottomOfStackEl(tgt);
  if (bottom) tgt = bottom; // ensure we attach to the bottom-most card
}


const stackId = _ensureStackFor(tgt, vdir);
const st = _ST.stacks[stackId];
if (st && (vdir==='up' || vdir==='down') && (st.dir==='up' || st.dir==='down') && st.dir !== vdir) {
  st.dir = vdir; // will always set to 'up' if it was 'down'
}
_insertGroupIntoStack(stackId, tgt, movingCids, vdir);

_layoutStack(stackId);
_reindex(stackId);
return true;

},




  /**
   * Split an existing stack at the card with cid (keeps 0..idx-1; moves idx..end to new stack).
   */
  splitOnDrag(cid) {
    const rec = _ST.idxByCid[cid];
    if (!rec) return null;
    const st = _ST.stacks[rec.stackId];
    const lower = st.order.slice(0, rec.idx);
    const upper = st.order.slice(rec.idx);

    st.order = lower;
    _reindex(rec.stackId);

    const movedId = _newStackId();
    _ST.stacks[movedId] = { dir: st.dir, order: upper.slice() };
    for (const movedCid of upper) {
      const el = document.querySelector(`.card[data-cid="${CSS.escape(movedCid)}"]`);
      if (el) {
        el.dataset.stackId = movedId;
        el.dataset.stackDir = st.dir;
      }
    }
    _reindex(movedId);
    _layoutStack(rec.stackId);
    _layoutStack(movedId);
    return { keptStackId: rec.stackId, movedStackId: movedId };
  },

  /**
   * Explicitly detach a card from any stack (public so Zones can call on plain drops).
   */
  detach(el) { _detachFromAnyStack(el); },

  /**
   * Recompute z for all stacks (useful after mass moves).
   */
  recomputeAllZ() {
    for (const id of Object.keys(_ST.stacks)) _applyZ(id);
  },
  
    /**
   * Return the moving slice starting at cid (cid..top of that stack).
   * If the card isn't in a stack, returns [cid].
   */
  sliceFrom(cid){
    const rec = _ST.idxByCid[cid];
    if (!rec) return cid ? [cid] : [];
    const st = _ST.stacks[rec.stackId];
    if (!st) return [cid];
    return st.order.slice(rec.idx);
  },

};

export default Stacking;
window.Stacking = Stacking;

// ---------------- Internals ------------------
function _newStackId() { return 'stk_' + (_ST.idSeq++); }
function _rect(el) { return el.getBoundingClientRect(); }
function _allCards() { return Array.from(document.querySelectorAll('.card[data-cid]')); }

function _findOverlapTarget(draggedEl) {
  const rD = _rect(draggedEl);

  // Get dragged's stack id (if any) so we can ignore same-stack cards
  const dCid = draggedEl?.dataset?.cid;
  const dRec = dCid ? _ST.idxByCid[dCid] : null;
  const dStack = dRec ? dRec.stackId : null;

  let best = null, bestArea = 0;
  for (const el of _allCards()) {
    if (el === draggedEl) continue;

    // 🚫 NEW: ignore cards that are in the SAME stack as the dragged card
    if (dStack) {
      const tCid = el.dataset?.cid;
      const tRec = tCid ? _ST.idxByCid[tCid] : null;
      if (tRec && tRec.stackId === dStack) continue;
    }

    const rT = _rect(el);
    const area = _areaOverlap(rD, rT);
    const ratio = area / (rD.width * rD.height);
    if (ratio > MIN_INTERSECT_RATIO && area > bestArea) {
      best = el; bestArea = area;
    }
  }
  return best;
}


function _areaOverlap(a, b) {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  const w = Math.max(0, right - left);
  const h = Math.max(0, bottom - top);
  return w * h;
}

// 3×3-ish quadrant detection (returns 'left'|'right'|'up'|'down' or null)
function _detectGridDirection(draggedEl, targetEl) {
  const d = _rect(draggedEl);
  const t = _rect(targetEl);

  const midX = t.left + t.width / 2;
  const midY = t.top + t.height / 2;

  const leftArea   = _areaOverlap(d, { left:t.left, right:midX, top:t.top, bottom:t.bottom });
  const rightArea  = _areaOverlap(d, { left:midX, right:t.right, top:t.top, bottom:t.bottom });
  const topArea    = _areaOverlap(d, { left:t.left, right:t.right, top:t.top, bottom:midY });
  const bottomArea = _areaOverlap(d, { left:t.left, right:t.right, top:midY, bottom:t.bottom });

  const ranked = [
    ['left', leftArea],
    ['right', rightArea],
    ['up', topArea],
    ['down', bottomArea],
  ].sort((a,b)=> b[1]-a[1]);

  const [dir, area] = ranked[0];
  return area > 0 ? dir : null;
}

// -------- L/R placement-only logic (no stacks) --------
function _placeBesideStackBottom({ draggedEl, targetEl, dir }) {
  // Anchor = bottom of stack if target is stacked; otherwise the target itself
  const anchorEl = _bottomOfStackEl(targetEl) || targetEl;

  const rootL = parseFloat(anchorEl.style.left) || 0;
  const rootT = parseFloat(anchorEl.style.top) || 0;

  const dx = dir === 'right' ? PAD_X : -PAD_X;
  const dy = 0;

  draggedEl.style.left = (rootL + dx) + 'px';
  draggedEl.style.top  = (rootT + dy) + 'px';

  _scrubStackAttrs(draggedEl);
  draggedEl.style.zIndex = '100'; // neutral z, not part of a stack ladder
}

function _bottomOfStackEl(el) {
  const cid = el?.dataset?.cid;
  if (!cid) return null;
  const rec = _ST.idxByCid[cid];
  if (!rec) return null; // not in a stack
  const st = _ST.stacks[rec.stackId];
  const baseCid = st?.order?.[0];
  if (!baseCid) return null;
  return document.querySelector(`.card[data-cid="${CSS.escape(String(baseCid))}"]`);
}

function _scrubStackAttrs(el){
  delete el.dataset.stackId;
  delete el.dataset.stackIdx;
  delete el.dataset.stackDir;
}

function _removeFromAllStacks(elOrCid){
  const cid = typeof elOrCid === 'string' ? elOrCid : elOrCid?.dataset?.cid;
  if (!cid) return;
  const rec = _ST.idxByCid[cid];
  if (!rec) {
  _clearLinkedEffects(cid); // new helper below
  return;
}
const st = _ST.stacks[rec.stackId];
if (!st) {
  delete _ST.idxByCid[cid];
  _clearLinkedEffects(cid); // new helper below
  return;
}


  // Remove this cid if present
  const i = st.order.indexOf(cid);
  if (i >= 0) st.order.splice(i, 1);

  // Clean attrs on the removed element
  const el = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
  if (el) _scrubStackAttrs(el);

  // --- Normalize destination stack ---
  if (st.order.length <= 0) {
    // fully empty → delete
    delete _ST.stacks[rec.stackId];

  } else if (st.order.length === 1) {
    // 👈 KEY FIX: a single card should NOT keep a stack wrapper
    const loneCid = st.order[0];
    delete _ST.idxByCid[loneCid];
    const loneEl = document.querySelector(`.card[data-cid="${CSS.escape(loneCid)}"]`);
	
    if (loneEl) _scrubStackAttrs(loneEl);
	if (loneEl) loneEl.dataset.stackDir = ''; // clear lingering direction

    delete _ST.stacks[rec.stackId];

  } else {
    // still multiple → reindex + re-layout
    _reindex(rec.stackId);
    _layoutStack(rec.stackId);
  }

_clearLinkedEffects(cid);


}


function _detachFromAnyStack(el) { _removeFromAllStacks(el); }

function _clearLinkedEffects(cid){
  (async ()=>{
    try{
      const CA = window.CardAttributes;
      const room_id = CA?.roomId;
      if (!(room_id && cid)) return;
      const tickets = (window.__linkedEffectTickets||[])
        .filter(t => t.room_id===room_id && String(t.sourceCid)===String(cid));
      const applyTo = new Set(tickets.flatMap(t => t.applyTo));
      for (const tcid of applyTo){
        await CA?.fetchIfMissing?.(tcid);
        const cur = (CA?.cache && CA.cache[tcid]) || {};
        let tempPT = Array.isArray(cur.tempPT) ? cur.tempPT.slice() : [];
        const pm = { pow: Number(cur.ptMod?.pow)||0, tgh: Number(cur.ptMod?.tgh)||0 };
        for (const e of tempPT){
          if (e?.mode==='LINKED' && String(e.sourceCid)===String(cid)){
            pm.pow -= Number(e.pow||0);
            pm.tgh -= Number(e.tgh||0);
          }
        }
        tempPT = tempPT.filter(e => !(e?.mode==='LINKED' && String(e.sourceCid)===String(cid)));
        const tempEffects = (Array.isArray(cur.tempEffects)?cur.tempEffects:[])
          .filter(e => !(e?.mode==='LINKED' && String(e.sourceCid)===String(cid)));
        const tempTypes = (Array.isArray(cur.tempTypes)?cur.tempTypes:[])
          .filter(e => !(e?.mode==='LINKED' && String(e.sourceCid)===String(cid)));
        await CA?.set?.(tcid, { tempPT, tempEffects, tempTypes, ptMod: pm });
        CA?.applyToDom?.(tcid);
        CA?.refreshPT?.(tcid);
      }
      window.__linkedEffectTickets = (window.__linkedEffectTickets||[])
        .filter(t => !(t.room_id===room_id && String(t.sourceCid)===String(cid)));
    }catch(e){ console.warn('[EquipSuggest] linked cleanup failed', e); }
  })();
}


// -------- U/D true stacking logic --------
function _ensureStackFor(targetEl, dir) {
  const tCid = targetEl.dataset.cid;
  const rec = _ST.idxByCid[tCid];

  if (rec) return rec.stackId;

  // If the DOM still has stale stack attrs but no index, scrub them
  if (targetEl.dataset.stackId || targetEl.dataset.stackIdx || targetEl.dataset.stackDir) {
    _scrubStackAttrs(targetEl);
  }

  const id = _newStackId();
  _ST.stacks[id] = { dir, order:[tCid] };
  targetEl.dataset.stackId = id;
  targetEl.dataset.stackDir = dir;
  _ST.idxByCid[tCid] = { stackId:id, idx:0 };
  return id;
}


function _insertIntoStack(stackId, targetEl, draggedEl, dir) {
  const st = _ST.stacks[stackId];
  const tCid = targetEl.dataset.cid;
  const dCid = draggedEl.dataset.cid;

  // Safety: if dCid somehow already lives in this stack, remove it first (no duplicates).
  const prev = st.order.indexOf(dCid);
  if (prev >= 0) st.order.splice(prev, 1);

  const at = Math.max(0, st.order.indexOf(tCid) + 1);
  st.order.splice(at, 0, dCid);

  draggedEl.dataset.stackId = stackId;
  draggedEl.dataset.stackDir = dir;
  _reindex(stackId);
}

function _insertGroupIntoStack(stackId, targetEl, movingCids = [], dir) {
  const st = _ST.stacks[stackId];
  if (!st) return;

  const tCid = targetEl.dataset.cid;
  let at = Math.max(0, st.order.indexOf(tCid) + 1);

  for (const mcid of movingCids) {
    // De-dup within destination
    const prev = st.order.indexOf(mcid);
    if (prev >= 0) {
      st.order.splice(prev, 1);
      if (prev < at) at--; // keep cursor stable
    }
    st.order.splice(at, 0, mcid);
    at++;

    // Tag DOM for each inserted element
    const el = document.querySelector(`.card[data-cid="${CSS.escape(String(mcid))}"]`);
    if (el) {
      el.dataset.stackId  = stackId;
      el.dataset.stackDir = dir;
    }
  }
  _reindex(stackId);
}



function _reindex(stackId) {
  const st = _ST.stacks[stackId];
  if (!st) return;
  for (let i = 0; i < st.order.length; i++) {
    const cid = st.order[i];
    _ST.idxByCid[cid] = { stackId, idx: i };
    const el = document.querySelector(`.card[data-cid="${CSS.escape(cid)}"]`);
    if (el) el.dataset.stackIdx = i;
  }
}

function _layoutStack(stackId) {
  const st = _ST.stacks[stackId];
  if (!st || !st.order.length) return;
  const rootCid = st.order[0];
  const rootEl = document.querySelector(`.card[data-cid="${CSS.escape(rootCid)}"]`);
  if (!rootEl) return;

  const rootL = parseFloat(rootEl.style.left) || 0;
  const rootT = parseFloat(rootEl.style.top) || 0;

  for (let i = 0; i < st.order.length; i++) {
    const el = document.querySelector(`.card[data-cid="${CSS.escape(st.order[i])}"]`);
    if (!el) continue;
    let dx = 0, dy = 0;
    switch (st.dir) {
      case 'right': dx = i * PAD_X; break;
      case 'left':  dx = -i * PAD_X; break;
      case 'down':  dy = i * PAD_Y; break;
      case 'up':    dy = -i * PAD_Y; break;
    }
    el.style.left = (rootL + dx) + 'px';
    el.style.top  = (rootT + dy) + 'px';
    el.dataset.stackDir = st.dir;
  }

  // 🔧 NEW: refresh stack index after every layout so future drags see up-to-date mapping
  _reindex(stackId);
  _applyZ(stackId);
}


/**
 * Z-layering by actual screen Y:
 *  - We read each card's current `top` (world coords), and assign higher z to larger Y (visually lower).
 *  - This satisfies “lower down the screen sits on top of higher ones”.
 */
function _applyZ(stackId) {
  const st = _ST.stacks[stackId];
  if (!st) return;

  const els = st.order
    .map(cid => document.querySelector(`.card[data-cid="${CSS.escape(cid)}"]`))
    .filter(Boolean);

  // Sort by numeric top (ascending) and assign z in that order so larger Y = larger z
  els.sort((a,b) => (parseFloat(a.style.top)||0) - (parseFloat(b.style.top)||0));
  for (let i = 0; i < els.length; i++) {
    els[i].style.zIndex = String(100 + i);
  }
}
