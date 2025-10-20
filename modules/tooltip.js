// modules/tooltip.js
// Public API:
//   initTooltipSystem, attachTooltip, followTooltip, reflowAll
//   showCardTooltip, hideCardTooltip
//   manaToHtml, clearSelection
//   attachHandAutoTooltip
//
// ✨ Enhancements added:
//   - PT badge at bottom-right of tooltip (larger, like real cards).
//   - Anchored round cog button to the right of the card while tooltip is visible.
//     * Dispatches "card:cog" CustomEvent on click with { el: anchorEl }
//     * Also tries window.openCardSettings?.(anchorEl) if present.

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
    power:      (d.power ?? face?.power ?? ''),
    toughness:  (d.toughness ?? face?.toughness ?? ''),
    loyalty:    (d.loyalty ?? face?.loyalty ?? ''), // planeswalkers
  };
}

/* -----------------------------
   Tooltip + Cog state/DOM
----------------------------- */
let tipEl = null;
let lastPos = { x: 0, y: 0 };
let anchorEl = null;

// NEW: a small, floating cog button anchored to the right of the card
let cogEl = null;
// NEW: a mirrored magic-wand button anchored to the left of the card
let wandEl = null;

const COG_VISIBLE = false; // ← hide cog UI but keep all logic wired



const VP_MARGIN = 8;     // viewport breathing room
const TIP_GAP   = 12;    // gap between card and tooltip
// replace the COG_GAP line with these two constants:
const BTN_GAP   = 10;    // gap from card edge to button
const VSTACK_GAP = 8;    // vertical gap between wand and cog buttons    // gap between card's right edge and cog

function ensureTip(){
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'cardTooltip';
  tipEl.style.position = 'absolute';
  tipEl.style.display  = 'none';
  tipEl.setAttribute('role','dialog');

  // ⬇ add once: variable + CSS for tooltip text
  const rs = getComputedStyle(document.documentElement);
  if (!rs.getPropertyValue('--tooltipFontScale').trim()) {
    document.documentElement.style.setProperty('--tooltipFontScale', '1');
  }
  if (!document.getElementById('card-tooltip-style')) {
    const s = document.createElement('style');
    s.id = 'card-tooltip-style';
    s.textContent = `
      .cardTooltip{
        /* base 14px × adjustable scale */
        font-size: calc(14px * var(--tooltipFontScale, 1));
        line-height: 1.35;
      }
      .cardTooltip h3{
        margin:0 0 4px;
        font-weight:800;
        font-size: calc(16px * var(--tooltipFontScale, 1));
      }
      .cardTooltip .typeLine{ opacity:.9; margin:6px 0; }
      .cardTooltip .oracle{ white-space:pre-wrap; }
    `;
    document.head.appendChild(s);
  }
if (!document.getElementById('tooltip-font-style')) {
  const s = document.createElement('style');
  s.id = 'tooltip-font-style';
  s.textContent = `
    .cardTooltip {
      font-size: var(--tooltipFontSize, 13px);
      line-height: 1.4;
    }
    .cardTooltip h3 {
      font-size: calc(var(--tooltipFontSize, 13px) * 1.2);
    }
    .cardTooltip .typeLine,
    .cardTooltip .oracle {
      font-size: var(--tooltipFontSize, 13px);
    }
  `;
  document.head.appendChild(s);
}

  document.body.appendChild(tipEl);
  return tipEl;
}


// NEW: Build/ensure the anchored cog button once
function ensureCog(){
  if (cogEl) return cogEl;
  cogEl = document.createElement('button');
  cogEl.type = 'button';
  cogEl.className = 'cardCogBtn';
  cogEl.style.position = 'absolute';
  cogEl.style.display = 'none';
  cogEl.style.zIndex = '1000';  // above tooltip/actions
  cogEl.style.width = '42px';
  cogEl.style.height = '42px';
  cogEl.style.borderRadius = '50%';
  cogEl.style.background = '#0f1725';
  cogEl.style.color = '#cfe1ff';
  cogEl.style.border = '1px solid #2b3f63';
  cogEl.style.boxShadow = '0 8px 20px rgba(106,169,255,.18)';
  cogEl.style.display = 'none';
  cogEl.style.alignItems = 'center';
  cogEl.style.justifyContent = 'center';
  cogEl.style.display = 'none';
  cogEl.style.cursor = 'pointer';

  cogEl.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true" style="width:22px;height:22px;display:block;">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3 12a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 6.82 7c.56 0 1.08-.21 1.51-.58A1.65 1.65 0 0 0 9.84 5H10a2 2 0 1 1 4 0h.16a1.65 1.65 0 0 0 1.51 1.42c.43.04.84.21 1.16.53l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.32.32-.49.73-.53 1.16z"></path>
    </svg>
  `;

  // Click → fire a semantic event and try any existing settings hook
  cogEl.addEventListener('click', () => {
    try {
      // semantic event for anyone listening
      const ev = new CustomEvent('card:cog', { detail: { el: anchorEl }, bubbles: true });
      (anchorEl || document).dispatchEvent(ev);
    } catch {}
    try {
      // app-provided helper (optional)
      window.openCardSettings?.(anchorEl);
    } catch {}
  });

  document.body.appendChild(cogEl);
  return cogEl;
}

// NEW: Build/ensure the anchored wand button once
function ensureWand(){
  if (wandEl) return wandEl;
  wandEl = document.createElement('button');
  wandEl.type = 'button';
  wandEl.className = 'cardActBtn';
  wandEl.style.position = 'absolute';
  wandEl.style.display = 'none';
  wandEl.style.zIndex = '1000';  // above tooltip/actions
  wandEl.style.width = '42px';
  wandEl.style.height = '42px';
  wandEl.style.borderRadius = '50%';
  wandEl.style.background = '#0f1725';
  wandEl.style.color = '#cfe1ff';
  wandEl.style.border = '1px solid #2b3f63';
  wandEl.style.boxShadow = '0 8px 20px rgba(106,169,255,.18)';
  wandEl.style.alignItems = 'center';
  wandEl.style.justifyContent = 'center';
  wandEl.style.cursor = 'pointer';
  // Magic wand (fallback ✨ if 🪄 unsupported)
  wandEl.textContent = '🪄';

  // Keep clicks reliable (no event swallowing)
  wandEl.addEventListener('pointerdown', (e)=> e.stopPropagation());
  wandEl.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      const ev = new CustomEvent('card:activate', { detail: { el: anchorEl }, bubbles: true });
      (anchorEl || document).dispatchEvent(ev);
    } catch {}
  });

  document.body.appendChild(wandEl);
  return wandEl;
}

// NEW: position the wand relative to the anchored card (left side)
function positionWand(targetEl){
  if (!wandEl || !targetEl) return;
  const r = targetEl.getBoundingClientRect();
  const x = Math.round(r.left - (BTN_GAP + 42)); // 42 = button width
  const y = Math.round(r.top);                   // top-aligned
  wandEl.style.left = `${x}px`;
  wandEl.style.top  = `${y}px`;
  wandEl.style.display = 'grid';
}


function hideWand(){
  if (wandEl) wandEl.style.display = 'none';
}


// NEW: position the cog relative to the anchored card
function positionCog(targetEl){
  if (!cogEl || !targetEl) return;
  if (!COG_VISIBLE) { hideCog(); return; }
  const r = targetEl.getBoundingClientRect();
  const x = Math.round(r.left - (BTN_GAP + 42));
  const y = Math.round(r.top + 42 + VSTACK_GAP); // wand height (42) + gap
  cogEl.style.left = `${x}px`;
  cogEl.style.top  = `${y}px`;
  cogEl.style.display = 'grid';
}


function hideCog(){
  if (cogEl) cogEl.style.display = 'none';
}

function renderTooltipHtml(card){
  const name  = escapeHtml(card?.name ?? '');
  const cost  = manaToHtml(card?.mana_cost ?? '', { asCost: true });
  const tline = escapeHtml(card?.type_line ?? '');
  const text  = manaToHtml(card?.oracle_text ?? '', { asCost: true });

  // show P/T only for real creatures; planeswalkers use loyalty
  const isCreature = /\bCreature\b/i.test(card?.type_line || '');
  const showPT = isCreature && (card?.power ?? '') !== '' && (card?.toughness ?? '') !== '';
  const showL  = !showPT && (card?.loyalty ?? '') !== '';


  const ptBadge = showPT
    ? `<div class="ptBadge"
         style="
           position:absolute; right:10px; bottom:8px;
           font-weight:900;
           font-size:calc(22px * var(--tooltipBadgeScale, 1.6));
           line-height:1;
           background:rgba(20,33,54,.92); border:1px solid #35527d;
           color:#e9f2ff; border-radius:10px; padding:2px 8px; pointer-events:none;">
         ${escapeHtml(card.power)}/${escapeHtml(card.toughness)}
       </div>`
    : (showL
        ? `<div class="ptBadge"
             style="
               position:absolute; right:10px; bottom:8px;
               font-weight:900;
               font-size:calc(22px * var(--tooltipBadgeScale, 1.6));
               line-height:1;
               background:rgba(20,33,54,.92); border:1px solid #35527d;
               color:#e9f2ff; border-radius:10px; padding:2px 8px; pointer-events:none;">
             L: ${escapeHtml(card.loyalty)}
           </div>`
        : '');

  // Bottom padding so text doesn't collide with the badge
  const padStyle = `style="padding-bottom:28px;"`;

  return `
    <div ${padStyle}>
      <h3>${name}</h3>
      ${cost ? `<div class="cost">${cost}</div>` : ''}
      ${tline ? `<div class="typeLine">${tline}</div>` : ''}
      ${text ? `<div class="oracle">${text}</div>` : ''}
      ${ptBadge}
    </div>
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
ensureCog();
ensureWand();
hideCog();
cogEl.addEventListener('pointerdown', (e)=> e.stopPropagation());
wandEl.addEventListener('pointerdown', (e)=> e.stopPropagation());

// click/tap empty background clears selection + hides tooltip + buttons
document.addEventListener('pointerdown', (e)=>{
  if (
    e.target.closest('.card') ||
    e.target.closest('.cardTooltip') ||
    e.target.closest('.cardCogBtn') ||   // allow clicks anywhere inside the cog
    e.target.closest('.cardActBtn')      // allow clicks anywhere inside the wand
  ) return;
  clearSelection(); hideTooltip(); hideCog(); hideWand();
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

    // keep the buttons glued to the card’s edges
    ensureCog(); ensureWand();
    if (COG_VISIBLE) { positionCog(anchorEl); } else { hideCog(); }
    positionWand(anchorEl);
    return;

  }

  // Case B: legacy coords (treat as center point)
  anchorEl = null;
  const cx = Number(target?.x ?? target) || 0;
  const cy = Number(target?.y) || 0;
  positionTooltip(tipEl, cx, cy, cy, true);

// No card element to anchor → hide the buttons
hideCog(); hideWand();

}

export function reflowAll(){
  if (!tipEl || tipEl.style.display === 'none') return;
  if (anchorEl && document.body.contains(anchorEl)) {
    followTooltip(anchorEl);
  } else {
    // re-place around last center
positionTooltip(tipEl, lastPos.x, lastPos.y - 1, lastPos.y + 1, true);
hideCog(); hideWand();

  }
}

/* -----------------------------
   Public: selection helpers
----------------------------- */
export function clearSelection(){
  document.querySelectorAll('.card.selected').forEach(n => n.classList.remove('selected'));
}
export function hideTooltip(){ if (tipEl) tipEl.style.display = 'none'; hideCog(); hideWand(); }


/* -----------------------------
   Public: show/hide (legacy names)
----------------------------- */
export async function showCardTooltip(cardOrEl, screenX, screenY){
  const el = ensureTip();
  ensureCog();

  // A) DOM element path (preferred)
  if (cardOrEl instanceof Element) {
    const r = cardOrEl.getBoundingClientRect();
    const centerX = r.left + (r.width / 2);

    // Read everything we can from dataset first (incl. P/T & loyalty)
    let data = {
      name:        cardOrEl.dataset?.name        || cardOrEl.querySelector('img')?.alt || '',
      mana_cost:   cardOrEl.dataset?.mana_cost   || '',
      type_line:   cardOrEl.dataset?.type_line   || '',
      oracle_text: cardOrEl.dataset?.oracle_text || '',
      power:       cardOrEl.dataset?.power       || '',
      toughness:   cardOrEl.dataset?.toughness   || '',
      loyalty:     cardOrEl.dataset?.loyalty     || '',
    };

    // Fetch if ANY key field is missing (incl. P/T unless loyalty exists)
    const needsFill =
      !data.mana_cost || !data.type_line || !data.oracle_text ||
      (!data.loyalty && (data.power === '' || data.toughness === ''));

    if (data.name && needsFill) {
      try {
        const filled = await fetchMissingFieldsByName(data.name);
        data = { ...data, ...filled };

        // cache everything back onto the element
        cardOrEl.dataset.mana_cost   = data.mana_cost   || '';
        cardOrEl.dataset.type_line   = data.type_line   || '';
        cardOrEl.dataset.oracle_text = data.oracle_text || '';

        // Only stamp P/T for REAL creatures (not vehicles/auras/etc)
        const isCreature = /\bCreature\b/i.test(data.type_line || '');
        const hasPT = (data.power ?? '') !== '' && (data.toughness ?? '') !== '';
        if (isCreature && hasPT) {
          cardOrEl.dataset.power     = String(data.power);
          cardOrEl.dataset.toughness = String(data.toughness);
        } else {
          delete cardOrEl.dataset.power;
          delete cardOrEl.dataset.toughness;
        }

        // Loyalty (planeswalkers) may exist without P/T
        cardOrEl.dataset.loyalty = (data.loyalty ?? '') + '';

      } catch {}
    }

    el.innerHTML = renderTooltipHtml(data);
    el.style.display = 'block';
    anchorEl = cardOrEl;
    positionTooltip(el, centerX, r.top, r.bottom, true);

    // show/position the buttons next to the card
positionCog(anchorEl);
positionWand(anchorEl);
return;

  }

  // B) Data object path (legacy)
  const dataObj = cardOrEl || {};
  el.innerHTML = renderTooltipHtml({
    name:        dataObj.name        || '',
    mana_cost:   dataObj.mana_cost   || dataObj.cost || '',
    type_line:   dataObj.type_line   || dataObj.typeLine || '',
    oracle_text: dataObj.oracle_text || dataObj.oracle || '',
    power:       dataObj.power       ?? '',
    toughness:   dataObj.toughness   ?? '',
    loyalty:     dataObj.loyalty     ?? '',
  });
  el.style.display = 'block';
  anchorEl = null;

  const cx = Number(screenX) || 0;
  const cy = Number(screenY) || 0;
  positionTooltip(el, cx, cy - 1, cy + 1, true);

  // no DOM anchor → hide the buttons
hideCog(); hideWand();

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

    // normalize legacy + include P/T/loyalty (respect existing dataset caches)
    const normalized = {
      name:        base.name || '',
      mana_cost:   base.mana_cost || base.cost || '',
      type_line:   base.type_line || base.typeLine || '',
      oracle_text: base.oracle_text || base.oracle || '',
      power:       base.power ?? cardEl.dataset?.power ?? '',
      toughness:   base.toughness ?? cardEl.dataset?.toughness ?? '',
      loyalty:     base.loyalty ?? cardEl.dataset?.loyalty ?? '',
    };

    // fill via Scryfall if ANY core field missing (incl. P/T unless loyalty exists)
    const needsFill =
      !normalized.mana_cost || !normalized.oracle_text || !normalized.type_line ||
      (!normalized.loyalty && (normalized.power === '' || normalized.toughness === ''));

    if (needsFill && normalized.name){
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

    // cache on the element for instant future tooltips (guard P/T by type)
    const data = await resolveData();
    if (data) {
      if (data.mana_cost)   cardEl.dataset.mana_cost   = data.mana_cost;
      if (data.type_line)   cardEl.dataset.type_line   = data.type_line;
      if (data.oracle_text) cardEl.dataset.oracle_text = data.oracle_text;

// also stamp legacy/fallback attributes so other modules can read it
cardEl.setAttribute('data-oracle_text', data.oracle_text);
cardEl.dataset.oracle = data.oracle_text;
cardEl.setAttribute('data-oracle', data.oracle_text);
cardEl.dataset.oracleText = data.oracle_text;
cardEl.setAttribute('data-oracle-text', data.oracle_text);


      const isCreature = /\bCreature\b/i.test(data.type_line || '');
      const hasPT = (data.power ?? '') !== '' && (data.toughness ?? '') !== '';
      if (isCreature && hasPT) {
        cardEl.dataset.power     = String(data.power);
        cardEl.dataset.toughness = String(data.toughness);
      } else {
        delete cardEl.dataset.power;
        delete cardEl.dataset.toughness;
      }

      cardEl.dataset.loyalty = (data.loyalty ?? '') + '';
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
    ensureCog();

    if (el === lastEl) {
      // Same centered card: just keep the tooltip & cog glued as the list moves
      if (tipEl && tipEl.style.display !== 'none') {
        followTooltip(el); // will position both tooltip and cog
      }
    } else {
      // New centered card: render (hydrates dataset if needed) and anchor to it
      lastEl = el;
      showCardTooltip(el); // will also position cog
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
