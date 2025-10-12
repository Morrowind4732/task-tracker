// modules/tooltip.js
// Public API:
//   initTooltipSystem, attachTooltip, followTooltip, reflowAll
//   showCardTooltip, hideCardTooltip
//   manaToHtml, clearSelection
//   attachHandAutoTooltip

/* -----------------------------
   Mana icons → HTML helpers
----------------------------- */
export function manaToHtml(src = '', { asCost = false } = {}) {
  if (!src) return '';
  return String(src).replace(/\{([^}]+)\}/gi, (_, raw) => {
    const t = raw.trim().toUpperCase();
    const SIMPLE = { W:'w', U:'u', B:'b', R:'r', G:'g', C:'c', S:'s', X:'x', Y:'y', Z:'z', T:'tap', Q:'untap', E:'e', '∞':'inf', INF:'inf' };
    if (SIMPLE[t]) return icon(SIMPLE[t], asCost);
    if (/^\d+$/.test(t)) return icon(t, asCost);
    if (/^[WUBRG]\/[WUBRG]$/.test(t)) return icon((t[0]+t[2]).toLowerCase(), asCost);
    if (/^2\/[WUBRG]$/.test(t))       return icon(`2${t[2].toLowerCase()}`, asCost);
    if (/^[WUBRG]\/P$/.test(t))       return icon(`${t[0].toLowerCase()}p`, asCost);
    if (/^[WUBRG]{2}$/.test(t))       return icon(t.toLowerCase(), asCost);
    return `{${raw}}`;
  });
  function icon(cls, asCost){ return `<i class="ms ms-${escapeHtml(cls)}${asCost ? ' ms-cost' : ''}"></i>`; }
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* -----------------------------
   Scryfall fill-in (when needed)
----------------------------- */
const SCRY = 'https://api.scryfall.com';
async function fetchMissingFieldsByName(name){
  const res = await fetch(`${SCRY}/cards/named?fuzzy=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error('Scryfall error for '+name);
  const d = await res.json();
  const face = Array.isArray(d.card_faces) && d.card_faces[0] ? d.card_faces[0] : null;
  return {
    name: d.name || name,
    mana_cost: d.mana_cost || '',
    type_line: d.type_line || '',
    oracle_text: d.oracle_text || (face?.oracle_text || ''),
  };
}

/* -----------------------------
   Tooltip state/DOM
----------------------------- */
let tipEl = null;
let lastPos = { x: 0, y: 0 };
let anchorEl = null;

const VP_MARGIN = 8;     // viewport breathing room
const TIP_GAP   = 12;    // gap between card and tooltip

function ensureTip(){
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'cardTooltip';
  tipEl.style.position = 'absolute';
  tipEl.style.display  = 'none';
  tipEl.setAttribute('role','dialog');
  document.body.appendChild(tipEl);
  return tipEl;
}

function renderTooltipHtml(card){
  const name  = escapeHtml(card?.name ?? '');
  const cost  = manaToHtml(card?.mana_cost ?? '', { asCost: true });
  const tline = escapeHtml(card?.type_line ?? '');
  const text  = manaToHtml(card?.oracle_text ?? '');
  return `
    <h3>${name}</h3>
    ${cost ? `<div class="cost">${cost}</div>` : ''}
    ${tline ? `<div class="typeLine">${tline}</div>` : ''}
    ${text ? `<div class="oracle">${text}</div>` : ''}
  `;
}

/* -----------------------------------------
   Non-overlapping placement (top-center)
   Clamps to viewport & flips below if needed
----------------------------------------- */
function positionTooltip(el, centerX, anchorTop, anchorBottom, preferAbove = true) {
  if (!el) return;

  // measure
  el.style.visibility = 'hidden';
  el.style.display = 'block';

  const tipRect  = el.getBoundingClientRect();
  const vpLeft   = 0;
  const vpTop    = 0;
  const vpRight  = window.innerWidth;
  const vpBottom = window.innerHeight;

  // Horizontal: center then clamp
  let left = Math.round(centerX - tipRect.width / 2);
  left = Math.max(vpLeft + VP_MARGIN, Math.min(left, vpRight - VP_MARGIN - tipRect.width));

  // Vertical: prefer above; flip if not enough room
  let top;
  if (preferAbove) {
    top = Math.round(anchorTop - TIP_GAP - tipRect.height);
    if (top < vpTop + VP_MARGIN) {
      top = Math.round(anchorBottom + TIP_GAP);
    }
  } else {
    top = Math.round(anchorBottom + TIP_GAP);
    if (top + tipRect.height > vpBottom - VP_MARGIN) {
      top = Math.round(anchorTop - TIP_GAP - tipRect.height);
    }
  }

  el.style.left = `${left}px`;
  el.style.top  = `${top}px`;
  el.style.visibility = 'visible';
  el.dataset.placement = (top + tipRect.height <= anchorTop) ? 'above' : 'below';

  // remember center for reflow fallback
  lastPos = { x: left + tipRect.width/2, y: top + tipRect.height/2 };
}

/* -----------------------------
   Public: init / follow / reflow
----------------------------- */
export function initTooltipSystem(){
  ensureTip();
  // click/tap empty background clears selection + hides tooltip
  document.addEventListener('pointerdown', (e)=>{
    if (e.target.closest('.card') || e.target.closest('.cardTooltip')) return;
    clearSelection(); hideTooltip();
  });
  window.addEventListener('resize', ()=> reflowAll());
}

export function followTooltip(target) {
  if (!tipEl || tipEl.style.display === 'none') return;

  // Case A: anchor to a DOM element
  if (target instanceof Element) {
    anchorEl = target;
    const r = anchorEl.getBoundingClientRect();
    const centerX = r.left + (r.width / 2);
    positionTooltip(tipEl, centerX, r.top, r.bottom, /*preferAbove*/ true);
    return;
  }

  // Case B: legacy coords (treat as center point)
  anchorEl = null;
  const cx = Number(target?.x ?? target) || 0;
  const cy = Number(target?.y) || 0;
  positionTooltip(tipEl, cx, cy, cy, true);
}

export function reflowAll(){
  if (!tipEl || tipEl.style.display === 'none') return;
  if (anchorEl && document.body.contains(anchorEl)) {
    followTooltip(anchorEl);
  } else {
    // re-place around last center
    positionTooltip(tipEl, lastPos.x, lastPos.y - 1, lastPos.y + 1, true);
  }
}

/* -----------------------------
   Public: selection helpers
----------------------------- */
export function clearSelection(){
  document.querySelectorAll('.card.selected').forEach(n => n.classList.remove('selected'));
}
export function hideTooltip(){ if (tipEl) tipEl.style.display = 'none'; }

/* -----------------------------
   Public: show/hide (legacy names)
----------------------------- */
export async function showCardTooltip(cardOrEl, screenX, screenY){
  const el = ensureTip();

  // A) DOM element path (preferred)
  if (cardOrEl instanceof Element) {
    const r = cardOrEl.getBoundingClientRect();
    const centerX = r.left + (r.width / 2);

    // use dataset / alt, then fill missing via Scryfall
    let data = {
      name:        cardOrEl.dataset?.name        || cardOrEl.querySelector('img')?.alt || '',
      mana_cost:   cardOrEl.dataset?.mana_cost   || '',
      type_line:   cardOrEl.dataset?.type_line   || '',
      oracle_text: cardOrEl.dataset?.oracle_text || ''
    };
    if (data.name && (!data.mana_cost || !data.type_line || !data.oracle_text)) {
      try {
        const filled = await fetchMissingFieldsByName(data.name);
        data = { ...data, ...filled };
        // cache back on the element
        cardOrEl.dataset.mana_cost   = data.mana_cost   || '';
        cardOrEl.dataset.type_line   = data.type_line   || '';
        cardOrEl.dataset.oracle_text = data.oracle_text || '';
      } catch {}
    }

    el.innerHTML = renderTooltipHtml(data);
    el.style.display = 'block';
    anchorEl = cardOrEl;
    positionTooltip(el, centerX, r.top, r.bottom, true);
    return;
  }

  // B) Data object path (legacy)
  const dataObj = cardOrEl || {};
  el.innerHTML = renderTooltipHtml({
    name:        dataObj.name        || '',
    mana_cost:   dataObj.mana_cost   || dataObj.cost || '',
    type_line:   dataObj.type_line   || dataObj.typeLine || '',
    oracle_text: dataObj.oracle_text || dataObj.oracle || ''
  });
  el.style.display = 'block';
  anchorEl = null;

  const cx = Number(screenX) || 0;
  const cy = Number(screenY) || 0;
  positionTooltip(el, cx, cy - 1, cy + 1, true);
}

export function hideCardTooltip(){ hideTooltip(); }

/* -----------------------------
   Public: attach to a card
----------------------------- */
export function attachTooltip(cardEl, getCardData, opts = {}){
  const holdMs    = opts.holdMs ?? 350;
  const moveTol   = opts.moveTol ?? 6;
  const singleTap = opts.singleTap !== false; // default true

  async function resolveData(){
    // function OR object; else fall back to dataset name
    let base =
      (typeof getCardData === 'function' ? await getCardData() :
       (getCardData && typeof getCardData === 'object' ? getCardData :
        { name: cardEl?.dataset?.name || '' })) || {};

    // normalize legacy field names
    const normalized = {
      name:        base.name || '',
      mana_cost:   base.mana_cost || base.cost || '',
      type_line:   base.type_line || base.typeLine || '',
      oracle_text: base.oracle_text || base.oracle || '',
    };

    // fill via Scryfall if needed
    if ((!normalized.mana_cost || !normalized.oracle_text || !normalized.type_line) && normalized.name){
      try {
        const filled = await fetchMissingFieldsByName(normalized.name);
        return { ...normalized, ...filled };
      } catch { /* ignore */ }
    }
    return normalized;
  }

  async function showFromPoint(){
    clearSelection();
    cardEl.classList.add('selected');

    // cache on the element for instant future tooltips
    const data = await resolveData();
    if (data) {
      if (data.mana_cost)   cardEl.dataset.mana_cost   = data.mana_cost;
      if (data.type_line)   cardEl.dataset.type_line   = data.type_line;
      if (data.oracle_text) cardEl.dataset.oracle_text = data.oracle_text;
    }

    // show anchored to the element (top-center, non-overlapping)
    showCardTooltip(cardEl);
  }

  // Long-press
  let holdTimer = null;
  function clearHold(){ if (holdTimer){ clearTimeout(holdTimer); holdTimer = null; } }

  cardEl.addEventListener('pointerdown', (e)=>{
    const startX = e.clientX, startY = e.clientY;
    let moved = false;

    const onMove = (me)=>{
      if (!moved && (Math.abs(me.clientX - startX) > moveTol || Math.abs(me.clientY - startY) > moveTol)){
        moved = true;
      }
    };
    const onUp = ()=>{
      clearHold();
      cardEl.removeEventListener('pointermove', onMove);
      cardEl.removeEventListener('pointerup', onUp);
      cardEl.removeEventListener('pointercancel', onUp);
    };

    cardEl.addEventListener('pointermove', onMove, {passive:true});
    cardEl.addEventListener('pointerup', onUp);
    cardEl.addEventListener('pointercancel', onUp);

    clearHold();
    holdTimer = setTimeout(()=>{ if (!moved) showFromPoint(); }, holdMs);
  });

  // Single-tap to show
  if (singleTap){
    let tdx=0, tdy=0, moved=false;
    cardEl.addEventListener('pointerdown', (e)=>{ tdx=e.clientX; tdy=e.clientY; moved=false; }, {capture:true});
    cardEl.addEventListener('pointermove', (e)=>{
      if (!moved && (Math.abs(e.clientX - tdx) > moveTol || Math.abs(e.clientY - tdy) > moveTol)){ moved = true; }
    }, {passive:true});
    cardEl.addEventListener('pointerup', (e)=>{ if (!moved) showFromPoint(); });
  }
} // end attachTooltip

/* -------------------------------------------
   Auto-tooltip for the hand carousel
   Shows centered card without tapping
------------------------------------------- */
// Auto-tooltip for the hand carousel: real-time while swiping (no lift needed)
export function attachHandAutoTooltip(handEl, { selector = '.card' } = {}){
  if (!handEl) return;

  let lastEl = null;
  let rafId = null;
  let tracking = false;

  const pickCenterCard = () => {
    const handRect = handEl.getBoundingClientRect();
    const midX = handRect.left + handRect.width / 2;
    const cards = Array.from(handEl.querySelectorAll(selector));
    if (!cards.length) return null;

    let best = null, bestDist = Infinity;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const d  = Math.abs(cx - midX);
      if (d < bestDist) { best = c; bestDist = d; }
    }
    return best;
  };

  const update = () => {
    const el = pickCenterCard();
    if (!el) return;

    // make sure tooltip DOM exists
    if (!tipEl) ensureTip();

    if (el === lastEl) {
      // Same centered card: just keep the tooltip glued as the list moves
      if (tipEl && tipEl.style.display !== 'none') followTooltip(el);
    } else {
      // New centered card: render (hydrates dataset if needed) and anchor to it
      lastEl = el;
      showCardTooltip(el);
    }
  };

  const loop = () => {
    rafId = requestAnimationFrame(() => {
      update();
      if (tracking) loop();
    });
  };

  const start = () => {
    if (tracking) return;
    tracking = true;
    loop();
  };

  const stop = () => {
    tracking = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    // final snap after momentum ends
    update();
  };

  // While finger is down/moving, or while scrolling with inertia → keep updating
  handEl.addEventListener('pointerdown',  start, { passive: true });
  handEl.addEventListener('pointermove',  start, { passive: true });
  handEl.addEventListener('pointerup',    stop,  { passive: true });
  handEl.addEventListener('pointercancel',stop,  { passive: true });
  handEl.addEventListener('pointerleave', stop,  { passive: true });

  // Wheel/scroll can happen without pointer events (e.g., momentum)
  handEl.addEventListener('scroll', start, { passive: true });
  handEl.addEventListener('wheel',  start, { passive: true });

  // Initial draw for the currently centered card
  update();
}
