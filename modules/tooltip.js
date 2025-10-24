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
	  .tip-btn {
  background: rgba(20,25,35,0.92);
  color: #e6eefc;
  border: 1px solid rgba(110,140,180,0.35);
  border-radius: 8px;
  font: 600 14px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0,0,0,0.35);
  user-select: none;
  -webkit-user-select: none;
}
.tip-btn:hover { filter: brightness(1.1); }
.tip-btn:active { transform: translateY(1px); }

#tip-flip { /* middle slot icon */
  letter-spacing: 0.02em;
}

#tip-tap .tap-glyph {
  display: inline-block;
  transform: translateY(1px);
  font-weight: 700;
}

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

// --- button singletons
let tipFlipBtn = null;
let tipTapBtn  = null;

function applyActionBtnStyle(b){
  // match the wand look 1:1
  Object.assign(b.style, {
    position: 'fixed',
    display: 'none',
    zIndex: '3000',
    width: '42px',
    height: '42px',
    borderRadius: '50%',
    background: '#0f1725',
    color: '#cfe1ff',
    border: '1px solid #2b3f63',
    boxShadow: '0 8px 20px rgba(106,169,255,.18)',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
  });
  // keep pointer events from bubbling into the card drag handlers
  b.addEventListener('pointerdown', e => e.stopPropagation());
}

function ensureFlipButton(){
  if (tipFlipBtn) return tipFlipBtn;
  const b = document.createElement('button');
  b.id = 'tip-flip';
  b.type = 'button';
  b.setAttribute('aria-label', 'Flip');
  b.textContent = '⇄'; // simple, clear flip icon
  applyActionBtnStyle(b);
  b.addEventListener('click', ()=>{
    try {
      const el = anchorEl;
      const cid = el?.dataset?.cid;
      if (cid) flipCard(cid);
    } catch(e){ console.warn('[flipBtn]', e); }
  });
  document.body.appendChild(b);
  tipFlipBtn = b;
  return b;
}

function ensureTapButton(){
  if (tipTapBtn) return tipTapBtn;
  const b = document.createElement('button');
  b.id = 'tip-tap';
  b.type = 'button';
  b.setAttribute('aria-label', 'Tap / Untap');

  // ManaMaster {T} glyph
  b.innerHTML = '<i class="ms ms-tap"></i>';
  applyActionBtnStyle(b);

  // SINGLE handler → one source of truth
  b.addEventListener('click', ()=>{
    try {
      const el = anchorEl;
      const cid = el?.dataset?.cid;
      if (!cid) return;
      toggleTap(cid);   // ← only this
    } catch (e) {
      console.warn('[tapBtn]', e);
    }
  });

  document.body.appendChild(b);
  tipTapBtn = b;
  return b;
}




// Toggle a card's tapped state. If your engine provides an official method,
// we call that. Otherwise we do a safe, networked fallback.
// Toggle a card's tapped state (DOM + RTC) with safe fallbacks
export function toggleTap(cid, force /* true|false|null */){
  try {
    // Prefer engine helpers if you have them
    if (typeof Zones?.toggleTap === 'function') { Zones.toggleTap(cid, force); return; }
    if (typeof Zones?.tapCard === 'function') {
      const el0 = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
      const wantTap = (force == null) ? (el0?.getAttribute('data-tapped') !== '1') : !!force;
      Zones.tapCard(cid, wantTap);
      return;
    }

    // ---- v3-style local toggle (matches turn.upkeep.js) ----
    const el = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
    if (!el) return console.warn('[tap] no card element for', cid);

    const nextTapped = (force == null)
      ? (el.getAttribute('data-tapped') !== '1')
      : !!force;

    // 1) Update DOM state (class + css var used by table CSS)
    el.setAttribute('data-tapped', nextTapped ? '1' : '0');
    el.classList.toggle('tapped', nextTapped);
    el.style.setProperty('--tap-rot', nextTapped ? '90deg' : '0deg');

    // 2) (Optional) keep a tiny local cache
    if (!(window.CID_DATA instanceof Map)) window.CID_DATA = new Map();
    const rec = window.CID_DATA.get(String(cid)) || { id: String(cid) };
    rec.tapped = nextTapped ? 1 : 0;
    window.CID_DATA.set(String(cid), rec);

    // 3) (Optional) persist into seat state if your engine supports it
    try {
      const seat = Zones?.getViewSeat?.() ?? (typeof mySeat === 'function' ? mySeat() : 1);
      const st   = Zones?._ensureSeatState?.(seat);
      if (typeof Zones?.setCardAttr === 'function') {
        Zones.setCardAttr(cid, 'tapped', nextTapped ? 1 : 0);
      } else if (st && Array.isArray(st.table)) {
        const row = st.table.find(c => String(c?.cid) === String(cid));
        if (row) row.tapped = nextTapped ? 1 : 0;
        Zones?._saveSeatState?.(seat, st);
      }
    } catch {}

    // 4) Broadcast so peers mirror the tap (matches v3)
    try { window.RTC?.send?.({ type: 'tap', cid, tapped: nextTapped ? 1 : 0 }); } catch {}

    // 5) Light repaint (no CardAttributes.refreshPT — that’s what crashed)
    (window.applyToDom || window.Zones?.applyToDom)?.(cid);

    console.log('[tap] toggled', cid, '→', nextTapped ? 'tapped' : 'untapped');
  } catch (e) {
    console.warn('[tap] error', e);
  }
}






export function hideFlip(){ if (tipFlipBtn){ tipFlipBtn.style.display = 'none'; } }
export function hideTap(){  if (tipTapBtn){  tipTapBtn.style.display  = 'none'; } }

function renderFlipButton(cardEl, flippable){
  const b = ensureFlipButton();
  positionFlip(cardEl);               // always position (reserves space)
  b.style.display = flippable ? 'flex' : 'none';
}

// Build fast-lookup maps from st.flip / st.flipDeck
function _ensureFlipIndices(st){
  if (!st) return;
  if (!Array.isArray(st.flipDeck)) {
    // prefer flipDeck if you already wrote it; else use legacy st.flip
    st.flipDeck = Array.isArray(st.flip) ? st.flip.slice() : [];
  }
  if (!st.flipDeckByFrontKey) st.flipDeckByFrontKey = Object.create(null);
  if (!st.flipDeckByFront)    st.flipDeckByFront    = Object.create(null);

  // rebuild by frontKey
  st.flipDeckByFrontKey = Object.create(null);
  for (const b of st.flipDeck) {
    const fk = b.link_front_key || b.frontKey || b._frontKey || null;
    if (fk) st.flipDeckByFrontKey[fk] = b;
  }
}

// Re-link backs to CURRENT front CIDs by walking the DOM
export function rehydrateFlipDeckForSeat(seat){
  try {
    const st = Zones?._ensureSeatState?.(seat);
    if (!st) return;

    _ensureFlipIndices(st);

    // clear cid map; we'll repopulate from DOM
    st.flipDeckByFront = Object.create(null);

    // any card elements for this seat that have frontKey → link
    const cards = document.querySelectorAll(`.card[data-owner="${seat}"]`);
    for (const el of cards) {
      const fk  = el.dataset.frontKey;
      const cid = el.dataset.cid;
      if (!fk || !cid) continue;

      const back = st.flipDeckByFrontKey[fk];
      if (back) {
        back.link_front_id = cid;               // persist link
        st.flipDeckByFront[cid] = back;         // quick lookup by cid
      }
    }

    Zones?._saveSeatState?.(seat, st); // persist for next reload too
    console.info('[flip] rehydrated', Object.keys(st.flipDeckByFront).length, 'front->back links');
  } catch(e){
    console.warn('[flip] rehydrate failed', e);
  }
}


function renderTapButton(cardEl){
  const b = ensureTapButton();
  positionTap(cardEl);
  b.style.display = 'flex';
}

// S2 spacing layout: top(wand) / middle(flip slot) / bottom(tap)
export function positionFlip(cardEl){
  if (!tipFlipBtn) return;
  const r = cardEl.getBoundingClientRect();
  const BTN = 28;         // size
  const GAP = 10;         // S2 medium feel
  const left = Math.max(4, r.left - BTN - 8); // left outside of card
  const top  = r.top + (r.height/2) - (BTN/2); // middle slot (reserved even if hidden)
  Object.assign(tipFlipBtn.style, {
    position:'fixed', left:`${left}px`, top:`${top}px`,
    width:`${BTN}px`, height:`${BTN}px`, display:'flex',
    alignItems:'center', justifyContent:'center', zIndex: 3000
  });
}

export function positionTap(cardEl){
  if (!tipTapBtn) return;
  const r = cardEl.getBoundingClientRect();
  const BTN = 28;
  const left = Math.max(4, r.left - BTN - 8);
  const top  = r.bottom - BTN - 8; // bottom slot; spacing remains even if flip hidden
  Object.assign(tipTapBtn.style, {
    position:'fixed', left:`${left}px`, top:`${top}px`,
    width:`${BTN}px`, height:`${BTN}px`, display:'flex',
    alignItems:'center', justifyContent:'center', zIndex: 3000
  });
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


const seat = Zones?.getViewSeat?.() ?? (typeof mySeat === 'function' ? mySeat() : 1);
  // defer to let the table render first
  setTimeout(()=> rehydrateFlipDeckForSeat(seat), 0);
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
positionFlip(anchorEl);   // <-- add
positionTap(anchorEl);    // <-- add

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
  positionFlip(anchorEl);   // <-- add
  positionTap(anchorEl);    // <-- add
} else {
  positionTooltip(tipEl, lastPos.x, lastPos.y - 1, lastPos.y + 1, true);
  hideCog(); hideWand();
  hideFlip(); hideTap();
}

}

/* -----------------------------
   Public: selection helpers
----------------------------- */
export function clearSelection(){
  document.querySelectorAll('.card.selected').forEach(n => n.classList.remove('selected'));
}
export function hideTooltip(){
  if (tipEl) tipEl.style.display = 'none';
  hideCog(); hideWand(); hideFlip(); hideTap();
}



/* -----------------------------
   Public: show/hide (legacy names)
----------------------------- */
export async function showCardTooltip(cardOrEl, screenX, screenY){
  const el = ensureTip();
  ensureCog(); // your existing gear/wand infra

  // --- local helper: fetch the *back* face by the exact name we have
  async function fetchBackFaceFieldsByName(exactName){
    const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(exactName)}`;
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const faces = Array.isArray(json?.card_faces) ? json.card_faces : null;
    const face  = faces ? (faces.find(f => norm(f?.name) === norm(exactName)) || faces[1] || null) : null;
    if (!face) return null;

    return {
      name:        face.name || exactName,
      type_line:   face.type_line   ?? '',
      oracle_text: face.oracle_text ?? '',
      mana_cost:   face.mana_cost   ?? '',
      power:       face.power != null ? String(face.power) : '',
      toughness:   face.toughness != null ? String(face.toughness) : '',
      loyalty:     face.loyalty != null ? String(face.loyalty) : '',
      img:         face.image_uris?.large || face.image_uris?.normal || '',
    };
  }

  // --- helper: can this card flip?
  function isFlippableElement(elm){
    try {
      const cid = elm?.dataset?.cid;
      const seat = (typeof Zones?.getViewSeat === 'function') ? Zones.getViewSeat()
                  : (typeof mySeat === 'function') ? mySeat()
                  : (Number.isFinite(+window.mySeat) ? +window.mySeat : 1);
      const st = Zones?._ensureSeatState?.(seat);
      const hasBackByCid      = cid && st?.flipDeckByFront?.[cid];
      const hasBackByFrontKey = elm?.dataset?.frontKey && st?.flipDeckByFrontKey?.[elm.dataset.frontKey];
      const nameHasSlash      = String(elm?.dataset?.name || '').includes('//');
      const facesLen          = (window.CID_DATA instanceof Map && CID_DATA.get(String(cid))?.card_faces?.length) || 0;
      return !!(hasBackByCid || hasBackByFrontKey || nameHasSlash || facesLen >= 2);
    } catch { return false; }
  }

  // A) DOM element path (preferred)
  if (cardOrEl instanceof Element) {
    const r = cardOrEl.getBoundingClientRect();
    const centerX = r.left + (r.width / 2);

    // Read everything we can from dataset first (incl. P/T & loyalty)
    let data = {
      name:        cardOrEl.dataset?.name        || cardOrEl.querySelector('img')?.alt || '',
      mana_cost:   cardOrEl.dataset?.mana_cost   || cardOrEl.dataset?.mana || '',
      type_line:   cardOrEl.dataset?.type_line   || cardOrEl.dataset?.type || '',
      oracle_text: cardOrEl.dataset?.oracle_text || cardOrEl.dataset?.oracle || '',
      power:       cardOrEl.dataset?.power       ?? '',
      toughness:   cardOrEl.dataset?.toughness   ?? '',
      loyalty:     cardOrEl.dataset?.loyalty     ?? '',
    };

    const isBackFace = cardOrEl.dataset.face === 'back';
    const needsFill =
      !data.mana_cost || !data.type_line || !data.oracle_text ||
      (!data.loyalty && (data.power === '' || data.toughness === ''));

    if (data.name && needsFill) {
      try {
        if (isBackFace) {
          // SMART back-face fetch (Option B)
          const backFilled = await fetchBackFaceFieldsByName(data.name);
          if (backFilled) {
            if (!data.type_line)   data.type_line   = backFilled.type_line;
            if (!data.oracle_text) data.oracle_text = backFilled.oracle_text;
            if (!data.mana_cost)   data.mana_cost   = backFilled.mana_cost;
            if (data.power === '')     data.power     = backFilled.power;
            if (data.toughness === '') data.toughness = backFilled.toughness;
            if (!data.loyalty)     data.loyalty     = backFilled.loyalty;
            if (!cardOrEl.dataset?.img && backFilled.img){
              cardOrEl.dataset.img = backFilled.img;
            }
          }
        } else {
          // Front/unknown face → original front-face fetch
          const filled = await fetchMissingFieldsByName?.(data.name);
          if (filled) {
            if (!data.type_line)   data.type_line   = filled.type_line;
            if (!data.oracle_text) data.oracle_text = filled.oracle_text;
            if (!data.mana_cost)   data.mana_cost   = filled.mana_cost;
            if (data.power === '')     data.power     = filled.power ?? '';
            if (data.toughness === '') data.toughness = filled.toughness ?? '';
            if (!data.loyalty)     data.loyalty     = filled.loyalty ?? '';
          }
        }

        // cache everything back onto the element
        cardOrEl.dataset.mana_cost   = data.mana_cost   || '';
        cardOrEl.dataset.type_line   = data.type_line   || '';
        cardOrEl.dataset.oracle_text = data.oracle_text || '';
        // legacy aliases
        cardOrEl.dataset.mana   = data.mana_cost   || '';
        cardOrEl.dataset.type   = data.type_line   || '';
        cardOrEl.dataset.oracle = data.oracle_text || '';

        // Only stamp P/T for REAL creatures
        const isCreature = /\bCreature\b/i.test(data.type_line || '');
        const hasPT = (data.power ?? '') !== '' && (data.toughness ?? '') !== '';
        if (isCreature && hasPT) {
          cardOrEl.dataset.power     = String(data.power);
          cardOrEl.dataset.toughness = String(data.toughness);
        } else {
          delete cardOrEl.dataset.power;
          delete cardOrEl.dataset.toughness;
        }

        cardOrEl.dataset.loyalty = (data.loyalty ?? '') + '';
      } catch {}
    }

    // render tooltip html
    el.innerHTML = renderTooltipHtml(data);
    el.style.display = 'block';
    anchorEl = cardOrEl;
    positionTooltip(el, centerX, r.top, r.bottom, true);

    // === BUTTONS: wand (existing), flip (⇄), tap ({T}) =======================
    // wand stays as-is in your code:
    positionCog(anchorEl);
    positionWand(anchorEl);

const flippable = isFlippableElement(cardOrEl);
ensureFlipButton();
ensureTapButton();
renderFlipButton(anchorEl, flippable);  // positions the middle slot, shows only if flippable
renderTapButton(anchorEl);              // positions bottom slot (always shown)


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
  hideFlip(); hideTap();
}



export function hideCardTooltip(){ hideTooltip(); }

/* -----------------------------
   Public: attach to a card
----------------------------- */
export function attachTooltip(cardEl, getCardData, opts = {}){
  const holdMs    = opts.holdMs ?? 350;
  const moveTol   = opts.moveTol ?? 6;
  const singleTap = opts.singleTap !== false; // default true

  // --- local helper: fetch the *back* face by the exact name we have
  async function fetchBackFaceFieldsByName(exactName){
    const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(exactName)}`;
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const faces = Array.isArray(json?.card_faces) ? json.card_faces : null;
    const face  = faces ? (faces.find(f => norm(f?.name) === norm(exactName)) || faces[1] || null) : null;
    if (!face) return null;

    return {
      name:        face.name || exactName,
      type_line:   face.type_line   ?? '',
      oracle_text: face.oracle_text ?? '',
      mana_cost:   face.mana_cost   ?? '',
      power:       face.power != null ? String(face.power) : '',
      toughness:   face.toughness != null ? String(face.toughness) : '',
      loyalty:     face.loyalty != null ? String(face.loyalty) : '',
      img:         face.image_uris?.large || face.image_uris?.normal || '',
    };
  }

  async function resolveData(){
    // function OR object; else fall back to dataset name
    let base =
      (typeof getCardData === 'function' ? await getCardData() :
       (getCardData && typeof getCardData === 'object' ? getCardData :
        { name: cardEl?.dataset?.name || '' })) || {};

    // normalize + include P/T/loyalty (respect existing dataset caches)
    const normalized = {
      name:        base.name || '',
      mana_cost:   base.mana_cost || base.cost || cardEl.dataset?.mana_cost || cardEl.dataset?.mana || '',
      type_line:   base.type_line || base.typeLine || cardEl.dataset?.type_line || cardEl.dataset?.type || '',
      oracle_text: base.oracle_text || base.oracle || cardEl.dataset?.oracle_text || cardEl.dataset?.oracle || '',
      power:       base.power ?? cardEl.dataset?.power ?? '',
      toughness:   base.toughness ?? cardEl.dataset?.toughness ?? '',
      loyalty:     base.loyalty ?? cardEl.dataset?.loyalty ?? '',
    };

    const isBackFace = cardEl.dataset?.face === 'back';
    const needsFill =
      !normalized.mana_cost || !normalized.type_line || !normalized.oracle_text ||
      (!normalized.loyalty && (normalized.power === '' || normalized.toughness === ''));

    if (needsFill && normalized.name){
      try {
        if (isBackFace) {
          const backFilled = await fetchBackFaceFieldsByName(normalized.name);
          if (backFilled) {
            return {
              ...normalized,
              type_line:   normalized.type_line   || backFilled.type_line,
              oracle_text: normalized.oracle_text || backFilled.oracle_text,
              mana_cost:   normalized.mana_cost   || backFilled.mana_cost,
              power:       normalized.power       !== '' ? normalized.power       : backFilled.power,
              toughness:   normalized.toughness   !== '' ? normalized.toughness   : backFilled.toughness,
              loyalty:     normalized.loyalty     || backFilled.loyalty,
            };
          }
        } else {
          const filled = await fetchMissingFieldsByName?.(normalized.name);
          if (filled) return { ...normalized, ...filled };
        }
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

      // legacy aliases so other modules can read it
      cardEl.dataset.mana   = data.mana_cost   || '';
      cardEl.dataset.type   = data.type_line   || '';
      cardEl.dataset.oracle = data.oracle_text || '';
      cardEl.setAttribute('data-oracle_text', data.oracle_text || '');
      cardEl.setAttribute('data-oracle',      data.oracle_text || '');
      cardEl.setAttribute('data-oracle-text', data.oracle_text || '');

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

// Fetch the *other* face for a double-faced/transform card by name.
// If the card has faces A/B and you pass A, you’ll get B (and vice-versa).
async function fetchOppositeFaceByName(exactName){
  const url = `${SCRY}/cards/named?exact=${encodeURIComponent(exactName)}`;
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`Scryfall HTTP ${res.status} for ${exactName}`);
  const d = await res.json();

  // If the single-face card comes back, there is no opposite face.
  const faces = Array.isArray(d.card_faces) ? d.card_faces : null;
  if (!faces || faces.length < 2) return null;

  // Normalize and pick "the other face" compared to the name we asked for.
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const idx  = faces.findIndex(f => norm(f?.name) === norm(exactName));
  const other = (idx === 0) ? faces[1] : (idx > 0 ? faces[0] : faces[1]);

  if (!other) return null;

  return {
    name:        other.name || '',
    type_line:   other.type_line   || '',
    oracle_text: other.oracle_text || '',
    mana_cost:   other.mana_cost   || '',
    power:       other.power != null ? String(other.power) : '',
    toughness:   other.toughness != null ? String(other.toughness) : '',
    loyalty:     other.loyalty != null ? String(other.loyalty) : '',
    img:         other.image_uris?.large || other.image_uris?.normal || ''
  };
}

export async function flipCard(cid){
  try {
    const seat = (typeof Zones?.getViewSeat === 'function') ? Zones.getViewSeat()
                : (typeof mySeat === 'function') ? mySeat()
                : (Number.isFinite(+window.mySeat) ? +window.mySeat : 1);
    const st = Zones?._ensureSeatState?.(seat);
    const el = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
    if (!el) return console.warn('[flipCard] missing card element for', cid);

    // ensure a cache entry for this cid
    if (!(window.CID_DATA instanceof Map)) window.CID_DATA = new Map();
    const rec = window.CID_DATA.get(String(cid)) || {
      id: String(cid),
      name: el.dataset.name || '',
      img:  el.querySelector('img')?.src || el.style.backgroundImage?.replace(/^url\(|\)$/g,'') || '',
      type_line: el.dataset.type || el.dataset.type_line || '',
      mana_cost: el.dataset.mana || el.dataset.mana_cost || '',
      oracle_text: el.dataset.oracle || el.dataset.oracle_text || '',
      power: el.dataset.power ?? '',
      toughness: el.dataset.toughness ?? '',
      loyalty: el.dataset.loyalty ?? ''
    };

    const isCurrentlyBack = (el.dataset.face === 'back');

    // Try prebuilt mapping first…
    let back = st?.flipDeckByFront?.[cid] ||
               (st?.flipDeck || []).find(b => b.link_front_id === String(cid));

    // …if none, build it via Scryfall using the *current* visible face’s name.
    if (!back) {
      const currentName = el.dataset?.name || rec.name;
      if (currentName) {
        const scryBack = await fetchOppositeFaceByName(currentName).catch(()=>null);
        if (scryBack) {
          back = {
            name: scryBack.name,
            img:  scryBack.img,
            type_line: scryBack.type_line,
            mana_cost: scryBack.mana_cost,
            oracle_text: scryBack.oracle_text,
            power: scryBack.power,
            toughness: scryBack.toughness,
            loyalty: scryBack.loyalty,
            // record linkage so the rest of the session (and reloads) work
            link_front_id: String(cid),
            link_front_key: el.dataset?.frontKey || null
          };

          // Persist into seat state for future fast flips
          if (st) {
            if (!Array.isArray(st.flipDeck)) st.flipDeck = [];
            st.flipDeck.push(back);
            if (!st.flipDeckByFront)    st.flipDeckByFront    = Object.create(null);
            if (!st.flipDeckByFrontKey) st.flipDeckByFrontKey = Object.create(null);
            st.flipDeckByFront[String(cid)] = back;
            if (el.dataset?.frontKey) st.flipDeckByFrontKey[el.dataset.frontKey] = back;
            Zones?._saveSeatState?.(seat, st);
          }
        }
      }
    }

    if (!back){
      console.warn('[flipCard] no back face found (even after Scryfall) for', cid);
      return;
    }

    if (!isCurrentlyBack){
      // cache "front" once so we can return later
      if (!rec.__frontCache){
        rec.__frontCache = {
          name: rec.name, img: rec.img, type_line: rec.type_line, mana_cost: rec.mana_cost,
          oracle_text: rec.oracle_text, power: rec.power, toughness: rec.toughness, loyalty: rec.loyalty
        };
      }

      // apply BACK face
      Object.assign(rec, {
        name: back.name || '', img: back.img || '',
        type_line: back.type_line || '', mana_cost: back.mana_cost || '',
        oracle_text: back.oracle_text || '',
        power: back.power ?? '', toughness: back.toughness ?? '', loyalty: back.loyalty ?? ''
      });
      window.CID_DATA.set(String(cid), rec);

      // DOM updates
      const imgEl = el.querySelector('img, .card-img, .img');
      if (imgEl && rec.img && imgEl.src !== rec.img) imgEl.src = rec.img;
      el.dataset.name   = rec.name || '';
      el.dataset.type   = rec.type_line || '';
      el.dataset.mana   = rec.mana_cost || '';
      el.dataset.oracle = rec.oracle_text || '';
      if (rec.power !== '')     el.dataset.power     = String(rec.power);
      if (rec.toughness !== '') el.dataset.toughness = String(rec.toughness);
      if (rec.loyalty !== '')   el.dataset.loyalty   = String(rec.loyalty);
      el.setAttribute('data-face', 'back');
    } else {
      // return to FRONT (from cache if available)
      const front = rec.__frontCache || null;
      if (!front){
        console.warn('[flipCard] no front cache; staying on back');
        return;
      }
      Object.assign(rec, front);
      window.CID_DATA.set(String(cid), rec);

      const imgEl = el.querySelector('img, .card-img, .img');
      if (imgEl && rec.img && imgEl.src !== rec.img) imgEl.src = rec.img;
      el.dataset.name   = rec.name || '';
      el.dataset.type   = rec.type_line || '';
      el.dataset.mana   = rec.mana_cost || '';
      el.dataset.oracle = rec.oracle_text || '';
      if (rec.power !== '')     el.dataset.power     = String(rec.power);
      if (rec.toughness !== '') el.dataset.toughness = String(rec.toughness);
      if (rec.loyalty !== '')   el.dataset.loyalty   = String(rec.loyalty);
      el.setAttribute('data-face', 'front');
    }

    // repaint + re-show tooltip
    (window.applyToDom || window.Zones?.applyToDom)?.(cid);
    try { showCardTooltip(el); } catch {}

    // broadcast flip to peers
    sendRTC?.({ type:'flip', cid, face: el.dataset.face });

    console.log('[flipCard] flipped', cid, '→', el.dataset.face);
  } catch(e){
    console.warn('[flipCard] error', e);
  }
}



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
