// /modules/scry.js
// Fullscreen Scry overlay with single drag stage, 5 pseudo-zones,
// deck-back flip illusion that reveals the face mid-flip, and medium timing.
//
// Layout:
// - Left vertical control rail: deck mock, Apply/Close, Cancel, +/- count, Scry Cards
// - Right main: Preview area (top ~55%, cards full size) and Lanes row (bottom ~45%)
// - In lanes: cards shrink to 50% and stack vertically (build downward, never overflow)
// - While dragging: card returns to full size; on drop into a lane it shrinks again
//
// This revision:
// - Tighter lane stacking (auto-overlap so the column always fits inside the lane)
// - z-index in lane stacking: lower rows have higher z-index (fan reads correctly)
// - Flip shows FACE mid-flip
// - Apply/Close moves cards to: Top/Bottom/Graveyard/Exile (Hand optional if hook exists)

import { DeckLoading } from './deck.loading.js';

const CSS_ID = 'scry-inline-css-v4';
const FALLBACK_BACK = 'https://i.imgur.com/LdOBU1I.jpeg';

const CARD_W_FULL  = 240;
const CARD_W_SMALL = CARD_W_FULL / 2; // 50%
const PREVIEW_SPLIT = 0.55;           // top % of stage is "preview" (big)

const S = {
  open: false,
  root: null,
  stage: null,
  lanesWrap: null,
  previewWrap: null,
  lanes: {},         // { top|bottom|hand|graveyard|exile: { el, cards: [] } }
  cards: new Map(),  // cid -> { el, name, img, zone|null }
  count: 1,
  animMs: { flip: 360, land: 180 }, // a touch slower flip so the swap reads nicely
  deckBackURL: null,
  deckMock: null,    // { wrap, under, top }
  nextCid: 1,

  // NEW: fan state for initial landing in the preview area
  previewBaseX: null,   // first-card X in preview
  previewIdx: 0         // how many revealed (for fan offset)
};


// ----- helpers -----
const rectOf = el => el.getBoundingClientRect();
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function ensureCSS(){
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement('style');
  s.id = CSS_ID;
  s.textContent = `
  .scry-dim{position:fixed;inset:0;background:#050b13;z-index:2147483000;
    display:flex;flex-direction:row;gap:14px;padding:12px 12px 14px 12px;}
  /* -------- left rail -------- */
  .scry-rail{width:116px;display:flex;flex-direction:column;gap:10px;align-items:stretch}
  .scry-deckmock{position:relative;width:100%;aspect-ratio:.714;max-height:168px;
    perspective:800px;}
  .scry-deckmock img{position:absolute;inset:0;width:100%;height:100%;
    object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.25);
    box-shadow:0 10px 24px rgba(0,0,0,.6); backface-visibility:hidden; transform-style:preserve-3d}
  .scry-deckmock .top{transform-origin:50% 50%;}
  .scry-btn{background:#263548;color:#e8f1ff;border:1px solid #5b7aa7;
    border-radius:10px;padding:8px 10px;font-weight:800;cursor:pointer}
  .scry-btn:active{transform:translateY(1px)}
  .scry-row{display:flex;align-items:center;justify-content:space-between;gap:6px}
  .scry-num{flex:1;min-width:24px;text-align:center;font-weight:800;color:#cfe1ff;
    padding:4px 0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
    border-radius:8px}
  /* -------- right pane -------- */
  .scry-main{position:relative;flex:1;border:1px solid rgba(255,255,255,.15);
    border-radius:12px;overflow:hidden;background:
      linear-gradient(180deg,#0d141f 0%, #0b1626 45%, #0a1422 45%, #0a1422 100%);}
  .scry-preview{position:absolute;left:0;top:0;right:0;height:55%;
    pointer-events:none;}
  .scry-lanes{position:absolute;left:0;right:0;bottom:0;top:55%;
    display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:8px}
  .scry-lane{position:relative;border:1px solid rgba(255,255,255,.18);
    border-radius:12px;background:linear-gradient(180deg,#0e1826 0%, #08111e 100%);
    box-shadow:inset 0 0 24px rgba(0,0,0,.35)}
  .scry-lane .lab{position:absolute;left:50%;top:6px;transform:translateX(-50%);
    font:700 12px/1 system-ui,sans-serif;color:#cfe1ff;opacity:.85;pointer-events:none}
  /* cards */
  .scry-card{position:absolute;width:${CARD_W_FULL}px;aspect-ratio:.714;user-select:none;
    border-radius:10px;border:1px solid rgba(255,255,255,.25);
    box-shadow:0 18px 40px rgba(0,0,0,.8);cursor:grab; touch-action:none;
    pointer-events:auto}
  .scry-small{width:${CARD_W_SMALL}px}
  `;
  document.head.appendChild(s);
}

function getDeckBackURL(){
  const dz = document.getElementById('pl-deck');
  const attr = dz?.getAttribute('data-deck-back') || '';
  return attr || (window.DECK_BACK_URL || '') || FALLBACK_BACK;
}

// ----- overlay UI -----
function buildUI(){
  ensureCSS();

  const dim = document.createElement('div');
  dim.className = 'scry-dim';

  // Left RAIL
  const rail = document.createElement('div');
  rail.className = 'scry-rail';

  // Deck mock (two layered backs)
  const deckWrap = document.createElement('div'); deckWrap.className = 'scry-deckmock';
  const under = document.createElement('img');   under.className = 'under';
  const topBack = document.createElement('img'); topBack.className = 'top';
  const deckURL = (S.deckBackURL = getDeckBackURL());
  under.src = deckURL; topBack.src = deckURL;
  deckWrap.append(under, topBack);

  const btnApply  = btn('Apply / Close', resolveAndClose);
  const btnCancel = btn('Cancel', close);

  // Count cluster
  const row = document.createElement('div'); row.className = 'scry-row';
  const minus = btn('–', () => setCount(S.count-1));
  const num   = document.createElement('div'); num.className='scry-num'; num.textContent = S.count;
  const plus  = btn('+', () => setCount(S.count+1));
  row.append(minus, num, plus);
  function setCount(n){ S.count = Math.max(1, Math.floor(n||1)); num.textContent = S.count; }

  const btnGo = btn('Scry Cards', revealN);

  rail.append(deckWrap, btnApply, btnCancel, row, btnGo);

  // Right MAIN (stage)
  const main = document.createElement('div'); main.className = 'scry-main';
  const preview = document.createElement('div'); preview.className = 'scry-preview';
  const lanes = document.createElement('div'); lanes.className = 'scry-lanes';

  const zoneDefs = [
    ['top', 'Top of Deck'],
    ['bottom', 'Bottom of Deck'],
    ['hand', 'Hand'],
    ['graveyard', 'Graveyard'],
    ['exile', 'Exile']
  ];
  for (const [k, lab] of zoneDefs){
    const z = document.createElement('div'); z.className = 'scry-lane'; z.dataset.key = k;
    const l = document.createElement('div'); l.className='lab'; l.textContent = lab;
    z.appendChild(l); lanes.appendChild(z);
    S.lanes[k] = { el: z, cards: [] };
  }

  main.append(preview, lanes);
  dim.append(rail, main);

  // keep references
  S.root = dim; S.stage = main;
  S.previewWrap = preview; S.lanesWrap = lanes;
  S.deckMock = { wrap: deckWrap, under, top: topBack };

  // right-click to close
  dim.addEventListener('contextmenu', e => { e.preventDefault(); close(); });

  document.body.appendChild(dim);
}

// ---------- deck reading / revealing ----------
function deckRemaining(){
  try {
    const st = DeckLoading?.state;
    return Array.isArray(st?.library) ? st.library.length : 0;
  } catch { return 0; }
}

function popTopFromDeck(){
  const st = DeckLoading?.state;
  const lib = Array.isArray(st?.library) ? st.library : null;
  if (!lib || !lib.length) return null;
  const row = lib.shift();
  try { window.dispatchEvent(new CustomEvent('deckloading:changed')); } catch {}
  return {
    name: row?.name || 'Card',
    img:  row?.image || row?.imageUrl || '',
    typeLine: row?.type_line || row?.typeLine || ''
  };
}

async function revealN(){
  if (!S.open) return;
  const n = Math.max(1, S.count|0);
  for (let i=0;i<n;i++){
    const last = deckRemaining() <= 1;
    const payload = popTopFromDeck();
    if (!payload) break;
    await flipAndSlide(payload, last);
  }
}

// flip the top deck-back, showing the face mid-flip, then slide the revealed card into preview
function flipAndSlide(payload, isLast){
  return new Promise(resolve=>{
    const top = S.deckMock.top;
    const under = S.deckMock.under;

    // Ensure we start from back image
    top.src = S.deckBackURL;
    top.style.transition = '';
    top.style.transform = 'rotateY(0deg)';

    // 1) rotate 0 -> 90 (back visible), then swap to FACE, then 90 -> 180
    const half = Math.floor(S.animMs.flip/2);
    requestAnimationFrame(()=>{
      top.style.transition = `transform ${half}ms cubic-bezier(.2,.7,.2,1)`;
      top.style.transform  = 'rotateY(90deg)';
      setTimeout(()=>{
        // swap to FACE while hidden edge-on
        top.src = payload.img || S.deckBackURL;
        top.style.transition = `transform ${half}ms cubic-bezier(.2,.7,.2,1)`;
        top.style.transform  = 'rotateY(180deg)';
        // 2) after full flip, spawn the actual draggable card near deck and drift to preview
        setTimeout(()=>{
          const deckBox = rectOf(S.deckMock.wrap);
          spawnCard(payload, {
            x: deckBox.left + deckBox.width/2,
            y: deckBox.top  + deckBox.height/2
          });
          // reset deck top for next flip
          top.style.transition = '';
          top.style.transform  = 'rotateY(0deg)';
          top.src = S.deckBackURL;

          if (isLast){
            // optional: flip bottom to indicate empty and remove top image
            under.style.transition = `transform ${S.animMs.flip}ms cubic-bezier(.2,.7,.2,1)`;
            under.style.transform  = 'rotateY(180deg)';
            setTimeout(()=>{ try { top.remove(); } catch{} }, S.animMs.flip);
          }
          resolve();
        }, half + 10);
      }, half);
    });
  });
}

// ---------- card nodes / dragging ----------
function spawnCard(data, fromScreen){
  const el = document.createElement('img');
  el.className = 'scry-card';
  el.src = data.img || '';
  el.alt = data.name || '';
  el.title = data.name || '';

  // render above everything initially
  el.style.zIndex = '100';

  S.stage.appendChild(el);

  const cid = `scry_${S.nextCid++}`;
  const card = { cid, el, name: data.name||'Card', img: data.img||'', zone: null };
  S.cards.set(cid, card);

  // start near deck, then animate into preview area
  const stg = rectOf(S.stage);
  const startX = (fromScreen?.x ?? (stg.left + 90));
  const startY = (fromScreen?.y ?? (stg.top + 90));
  const x = startX - stg.left - CARD_W_FULL/2;
  const y = startY - stg.top  - (CARD_W_FULL*1.4)/2;
  position(el, x, y);

  // small landing slide into preview area — FAN to the right from the first landing
  const previewBox = rectOf(S.previewWrap);
  const targetY = previewBox.top  - stg.top + 24;

  // Initialize base X on the first reveal landing in preview
  if (S.previewBaseX == null){
    // left padding 24 inside preview area
    const base = (previewBox.left - stg.left) + 24;
    S.previewBaseX = clamp(base, 12, stg.width - CARD_W_FULL - 12);
  }

  // Keep cards overlapped slightly: ~22% of width looks like a natural fan
  const FAN_SPACING = Math.round(CARD_W_FULL * 0.22); // e.g., ~53px at 240px width
  const idx = S.previewIdx++;
  const proposedX = S.previewBaseX + idx * FAN_SPACING;

  // Clamp to stage bounds so we don't spill off the right edge
  const targetX = clamp(proposedX, 12, stg.width - CARD_W_FULL - 12);

  animateTo(el, targetX, targetY, S.animMs.land);

  // pointer drag
  enableDrag(card);
}


function position(el, x, y){
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
}
function animateTo(el, x, y, ms){
  el.style.transition = `left ${ms}ms cubic-bezier(.2,.8,.2,1), top ${ms}ms cubic-bezier(.2,.8,.2,1)`;
  requestAnimationFrame(()=>{ position(el,x,y); });
  setTimeout(()=>{ el.style.transition = ''; }, ms+20);
}

function enableDrag(card){
  let ox=0, oy=0, dragging=false, pid=0;

  const down = e => {
    e.preventDefault();
    card.el.style.cursor = 'grabbing';
    card.el.style.zIndex = '1000';
    // revert to full size while dragging
    card.el.classList.remove('scry-small');

    dragging = true;
    pid = e.pointerId;
    card.el.setPointerCapture?.(pid);

    const rect = rectOf(card.el);
    ox = (e.clientX) - rect.left;
    oy = (e.clientY) - rect.top;

    window.addEventListener('pointermove', move, { passive:false });
    window.addEventListener('pointerup', up, { passive:false, once:true });
  };

  const move = e => {
    if (!dragging) return;
    const stg = rectOf(S.stage);
    const x = (e.clientX) - stg.left - ox;
    const y = (e.clientY) - stg.top  - oy;
    position(card.el, x, y);
  };

  const up = e => {
    dragging = false;
    try { card.el.releasePointerCapture?.(pid); } catch {}
    card.el.style.cursor = 'grab';
    card.el.style.zIndex = '100'; // default above zone labels
    window.removeEventListener('pointermove', move);

    // snap if dropped inside a lane
    const dropZone = whichZone(card.el);
    if (dropZone){
      placeIntoZone(card, dropZone);
      // shrink in zones
      card.el.classList.add('scry-small');
    } else {
      // check if we're in preview area (keep large)
      const inPreview = isInPreview(card.el);
      if (!inPreview){
        // free-floating below: keep as large unless moved into lane
        card.el.classList.remove('scry-small');
      }
      // leaving a lane? remove from its list
      if (card.zone){
        const arr = S.lanes[card.zone].cards;
        const i = arr.indexOf(card); if (i>=0) arr.splice(i,1);
        card.zone = null;
        refanAll();
      }
    }
  };

  card.el.addEventListener('pointerdown', down);
}

function isInPreview(el){
  const c = rectOf(el);
  const stg = rectOf(S.stage);
  const splitY = stg.top + stg.height * PREVIEW_SPLIT;
  const centerY = c.top + c.height/2;
  return centerY < splitY;
}

function whichZone(el){
  const center = {
    x: rectOf(el).left + rectOf(el).width/2,
    y: rectOf(el).top  + rectOf(el).height/2
  };
  for (const key of Object.keys(S.lanes)){
    const r = rectOf(S.lanes[key].el);
    if (center.x >= r.left && center.x <= r.right &&
        center.y >= r.top  && center.y <= r.bottom){
      return key;
    }
  }
  return null;
}

function placeIntoZone(card, key){
  // remove from previous
  if (card.zone){
    const prev = S.lanes[card.zone].cards;
    const i = prev.indexOf(card); if (i>=0) prev.splice(i,1);
  }
  card.zone = key;
  S.lanes[key].cards.push(card);
  refan(key);
}

// ---- stacking: tight vertical column that always fits inside the lane
function refan(key){
  const lane = S.lanes[key];
  const r = rectOf(lane.el);
  const stg = rectOf(S.stage);
  const cards = lane.cards;

  const padTop = 26;       // room below label
  const padBottom = 12;    // breathing space at bottom
  const cw = CARD_W_SMALL;
  const ch = cw / 0.714;   // maintain aspect ratio

  const maxHeight = Math.max(0, r.height - padTop - padBottom);
  const n = cards.length;

  // If 0/1 cards, no overlap necessary.
  // Otherwise choose overlap so total column height fits: H = ch + (n-1)*overlap <= maxHeight
  let overlap = (n <= 1) ? 0 : (maxHeight - ch) / (n - 1);
  // clamp overlap to a nice visual range (min spacing 12px, max ~60% of card height)
  overlap = clamp(overlap, 12, ch * 0.6);

  cards.forEach((c, i)=>{
    const x = (r.left - stg.left) + (r.width - cw)/2;
    const y = (r.top  - stg.top)  + padTop + i * overlap;
    c.el.classList.add('scry-small');
    // z-index: deeper in stack (higher i) => higher z so it appears on top
    c.el.style.zIndex = String(200 + i);
    animateTo(c.el, x, y, S.animMs.land);
  });
}

function refanAll(){
  for (const k of Object.keys(S.lanes)) refan(k);
}

// ---------- resolve (apply moves, then close) ----------
function getLaneCards(key){
  // current visual order is S.lanes[key].cards[0] at the top of the column
  return (S.lanes[key]?.cards || []).map(c => ({ name: c.name, img: c.img }));
}

function sendToBottom(list){
  // Prefer helper if present; append in reverse so first in list ends up above later ones.
  if (typeof DeckLoading?.returnToBottom === 'function'){
    DeckLoading.returnToBottom([...list].reverse().map(x => ({ name:x.name, imageUrl:x.img })));
    return;
  }
  // fallback: push onto DeckLoading.state.library
  try {
    const lib = DeckLoading?.state?.library;
    if (Array.isArray(lib)) {
      for (let i=list.length-1; i>=0; i--) {
        lib.push({ name:list[i].name, imageUrl:list[i].img });
      }
    }
  } catch {}
}

function sendToTop(list){
  // Put onto *top* of library so list[0] ends up on top.
  try {
    const lib = DeckLoading?.state?.library;
    if (Array.isArray(lib)) {
      // unshift from the end so list[0] becomes last unshift → ends up on top
      for (let i=list.length-1; i>=0; i--){
        lib.unshift({ name:list[i].name, imageUrl:list[i].img });
      }
    }
  } catch {}
}

function sendToZone(list, zone){
  const ownerSeat = (()=>{
    try { return Number(window.mySeat?.() || 1); } catch { return 1; }
  })();
  for (const c of list) {
    try { window.Zones?.moveCardToZone?.({ name:c.name, img:c.img }, zone, ownerSeat); } catch {}
  }
}

function sendToHand(list){
  // Optional convenience if you already have a helper; otherwise no-op until you wire it.
  for (const c of list) {
    try { window.flyDrawToHand?.({ name:c.name, imageUrl:c.img }, null); } catch {}
  }
}

function resolveAndClose(){
  // Collect and dispatch by lane
  const topList    = getLaneCards('top');
  const bottomList = getLaneCards('bottom');
  const handList   = getLaneCards('hand');
  const gyList     = getLaneCards('graveyard');
  const exileList  = getLaneCards('exile');

  if (topList.length)    sendToTop(topList);
  if (bottomList.length) sendToBottom(bottomList);
  if (gyList.length)     sendToZone(gyList, 'graveyard');
  if (exileList.length)  sendToZone(exileList, 'exile');
  if (handList.length)   sendToHand(handList); // safe optional

  close();
}

// ---------- lifecycle ----------
export const ScryOverlay = {
  open(){
    if (S.open) return;
    S.open = true;
    S.count = 1;
    buildUI();
  },
  close
};

function btn(label, fn){
  const b = document.createElement('button');
  b.className = 'scry-btn'; b.textContent = label;
  b.addEventListener('click', (e)=>{ e.stopPropagation(); fn?.(e); });
  return b;
}
function close(){
  if (!S.open) return;
  try { S.root.remove(); } catch {}
  Object.assign(S, {
    open:false, root:null, stage:null, previewWrap:null, lanesWrap:null,
    lanes:{}, cards:new Map(), deckMock:null,
    // NEW: reset preview fan state
    previewBaseX: null,
    previewIdx: 0
  });
}

