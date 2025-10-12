// modules/tooltip.js
// Public API kept stable with your import line:
//   initTooltipSystem, attachTooltip, followTooltip, reflowAll
// Plus legacy/compat names you already used in v3.html:
//   showCardTooltip, hideCardTooltip
// (Also export manaToHtml and clearSelection for convenience)

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

// ---------- Tooltip element/state ----------
let tipEl = null;
let lastPos = { x: 0, y: 0 };
let anchorEl = null; // if set, we anchor to this element’s left edge

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
function positionTooltip(el, sx, sy){
  const pad = 10;
  const vw = window.innerWidth, vh = window.innerHeight;
  el.style.left = `${sx}px`;
  el.style.top  = `${sy - 12}px`;
  const r = el.getBoundingClientRect();
  let x = r.left, y = r.top;
  if (r.right > vw - pad) x -= (r.right - (vw - pad));
  if (r.left < pad)       x += (pad - r.left);
  if (r.top < pad)        y = sy + pad; // flip below finger
  if (r.bottom > vh - pad) y -= (r.bottom - (vh - pad));
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  lastPos.x = x; lastPos.y = y;
}

// ---------- Public: init / follow / reflow ----------
export function initTooltipSystem(){
  ensureTip();
  // click/tap empty background clears selection + hides tooltip
  document.addEventListener('pointerdown', (e)=>{
    if (e.target.closest('.card') || e.target.closest('.cardTooltip')) return;
    clearSelection(); hideTooltip();
  });
  window.addEventListener('resize', ()=> reflowAll());
}
export function followTooltip(target, screenY) {
  if (!tipEl || tipEl.style.display === 'none') return;

  // Case A: anchor to a DOM element (preferred)
  if (target instanceof Element) {
    anchorEl = target;
    const r = anchorEl.getBoundingClientRect();
    const pad = 10;

    // Top-center of the card:
    const sx = r.left + (r.width / 2);
    const sy = r.top - pad;       // ask to sit above; positionTooltip will flip if needed

    positionTooltip(tipEl, sx, sy);
    return;
  }

  // Case B: raw coordinates (legacy)
  anchorEl = null;
  const sx = Number(target) || 0;
  const sy = Number(screenY) || 0;
  positionTooltip(tipEl, sx, sy);
}


export function reflowAll(){
  if (!tipEl || tipEl.style.display === 'none') return;
  if (anchorEl && document.body.contains(anchorEl)) {
    // recompute from element
    followTooltip(anchorEl);
  } else {
    // fall back to last absolute position
    positionTooltip(tipEl, lastPos.x, lastPos.y);
  }
}


// ---------- Public: selection helpers ----------
export function clearSelection(){
  document.querySelectorAll('.card.selected').forEach(n => n.classList.remove('selected'));
}
export function hideTooltip(){ if (tipEl) tipEl.style.display = 'none'; }

// ---------- Public: legacy names (compat with v3.html) ----------
export async function showCardTooltip(cardOrEl, screenX, screenY){
  const el = ensureTip();

  // If passed a DOM element, resolve full data (dataset OR image alt),
  // and render the *expansive* template every time.
  if (cardOrEl instanceof Element) {
    // Pull a best-available name first (dataset or <img alt>)
    const guessName =
      cardOrEl.dataset?.name ||
      cardOrEl.querySelector('img')?.alt ||
      '';

    // Start with any fields already present on the element:
    let data = {
      name:        cardOrEl.dataset?.name        || guessName || '',
      mana_cost:   cardOrEl.dataset?.mana_cost   || '',
      type_line:   cardOrEl.dataset?.type_line   || '',
      oracle_text: cardOrEl.dataset?.oracle_text || ''
    };

    // If anything is missing, fetch from Scryfall by name (once we have a name)
    if (guessName && (!data.mana_cost || !data.type_line || !data.oracle_text)) {
      try {
        const filled = await fetchMissingFieldsByName(guessName);
        data = { ...data, ...filled };
        // cache back on the element so future opens are instant
        cardOrEl.dataset.mana_cost   = data.mana_cost   || '';
        cardOrEl.dataset.type_line   = data.type_line   || '';
        cardOrEl.dataset.oracle_text = data.oracle_text || '';
      } catch {}
    }

    el.innerHTML = renderTooltipHtml(data);
    el.style.display = 'block';
    anchorEl = cardOrEl;
    followTooltip(cardOrEl);
    return;
  }

  // Otherwise: traditional object + (x,y)
  el.innerHTML = renderTooltipHtml(cardOrEl || {});
  el.style.display = 'block';
  anchorEl = null;
  positionTooltip(el, Number(screenX)||0, Number(screenY)||0);
}


export function hideCardTooltip(){ hideTooltip(); }

// ---------- Public: attach to a card ----------
export function attachTooltip(cardEl, getCardData, opts = {}){
  const holdMs    = opts.holdMs ?? 350;
  const moveTol   = opts.moveTol ?? 6;
  const singleTap = opts.singleTap !== false; // default true

  async function resolveData(){
    // allow function OR plain object; else fall back to dataset name
    let base =
      (typeof getCardData === 'function' ? await getCardData() :
       getCardData && typeof getCardData === 'object' ? getCardData :
       { name: cardEl?.dataset?.name || '' }) || {};

    // normalize any legacy field names
    const normalized = {
      name:        base.name || '',
      mana_cost:   base.mana_cost || base.cost || '',
      type_line:   base.type_line || base.typeLine || '',
      oracle_text: base.oracle_text || base.oracle || '',
    };

    // lazily fill from Scryfall if we at least have a name
    if ((!normalized.mana_cost || !normalized.oracle_text || !normalized.type_line) && normalized.name){
      try {
        const filled = await fetchMissingFieldsByName(normalized.name);
        return { ...normalized, ...filled };
      } catch { /* ignore */ }
    }
    return normalized;
  }

  async function showFromPoint(sx, sy){
    clearSelection();
    cardEl.classList.add('selected');
    const data = await resolveData();
    showCardTooltip(data, sx, sy);
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
    holdTimer = setTimeout(()=>{ if (!moved) showFromPoint(startX, startY); }, holdMs);
  });

  // Single-tap to show
  if (singleTap){
    let tdx=0, tdy=0, moved=false;
    cardEl.addEventListener('pointerdown', (e)=>{ tdx=e.clientX; tdy=e.clientY; moved=false; }, {capture:true});
    cardEl.addEventListener('pointermove', (e)=>{
      if (!moved && (Math.abs(e.clientX - tdx) > moveTol || Math.abs(e.clientY - tdy) > moveTol)){ moved = true; }
    }, {passive:true});
    cardEl.addEventListener('pointerup', (e)=>{ if (!moved) showFromPoint(e.clientX, e.clientY); });
  }
}
