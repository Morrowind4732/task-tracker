// modules/deck.tools.js
// Overlay-first (guaranteed) deck tools + real actions & Scryfall search.
console.log('[deck.tools] module loaded');

const CARD_BACK_URL = 'https://i.imgur.com/LdOBU1I.jpeg';

const $  = (s, r=document)=> r.querySelector(s);
const $$ = (s, r=document)=> [...r.querySelectorAll(s)];
const nowIso = () => new Date().toISOString();

function showOverlay(el){
  if (!el) return;
  el.style.display = 'block';
  el.style.visibility = 'visible';
  el.style.zIndex = '9999';
  el.setAttribute('aria-hidden','false');
  console.log('[deck.tools] showOverlay:', el.id, nowIso());
}
function hideOverlay(el){
  if (!el) return;
  el.style.display = 'none';
  el.setAttribute('aria-hidden','true');
  console.log('[deck.tools] hideOverlay:', el.id, nowIso());
}

/* ------------------------- tiny state helpers ------------------------- */
const S = () => window.AppState || (window.AppState = {});
const gameId  = () => String(S().gameId || '');
const mySeat  = () => Number(S().mySeat || 1);
const worldEl = () => $('#world');
const handTrack = () => $('#handTrack');

function saveStateDebounced(){
  const api = window.StorageAPI;
  if (!api || !gameId()) return;
  try{
    api.savePlayerStateDebounced(gameId(), mySeat(), S());
  }catch(e){ console.warn('[deck.tools] save debounced failed', e); }
}

function ensureId(c){
  if (!c.id) c.id = 'card_'+Math.random().toString(36).slice(2);
  return c.id;
}

/* --------------------- renderable card DOM (table) -------------------- */
// Minimal version of your table card that supports drag + flip/tap later if you want.
function createTableCardEl(card){
  ensureId(card);
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;
  el.style.left = (card.x ?? 300) + 'px';
  el.style.top  = (card.y ?? 120) + 'px';

  const inner = document.createElement('div');
  inner.className = 'cardInner';
  inner.style.setProperty('--flip-rot', card.face === 'back' ? '180deg' : '0deg');
  inner.style.setProperty('--tap-rot',  card.tapped ? '90deg'   : '0deg');

  const front = document.createElement('div'); front.className='face front';
  const back  = document.createElement('div'); back.className='face back';

  const frontImg = (card.frontImg) ||
                   (card._faces?.[0]?.image) ||
                   (card._scry?.image_uris?.normal) || '';
  const backImg  = (card.backImg)  ||
                   (card._faces?.[1]?.image) || '';

  front.style.backgroundImage = frontImg ? `url("${frontImg}")` : '';
  back.style.backgroundImage  = backImg  ? `url("${backImg}")`  : `url("${CARD_BACK_URL}")`;

  inner.appendChild(front); inner.appendChild(back);
  el.appendChild(inner);

  // simple drag
  let dragging=false, offX=0, offY=0;
  const ctow = (x,y)=>{
    const r = $('#worldScale').getBoundingClientRect();
    const zoom = Number(getComputedStyle($('#worldScale')).transform.match(/matrix\(([^,]+),[^,]+,[^,]+,[^,]+,([^,]+),([^,]+)\)/)?.[1]) || (S().zoom||1);
    return { x: (x - r.left) / (S().zoom||1), y: (y - r.top) / (S().zoom||1) };
  };
  el.style.touchAction='none';
  el.addEventListener('pointerdown',(e)=>{
    dragging=true; el.setPointerCapture?.(e.pointerId);
    const wp=ctow(e.clientX,e.clientY);
    offX=wp.x-(parseFloat(el.style.left)||0);
    offY=wp.y-(parseFloat(el.style.top)||0);
  });
  el.addEventListener('pointermove',(e)=>{
    if(!dragging) return;
    const wp=ctow(e.clientX,e.clientY);
    el.style.left=(wp.x-offX)+'px';
    el.style.top =(wp.y-offY)+'px';
  },{passive:false});
  el.addEventListener('pointerup',()=>{ dragging=false; });

  return el;
}

function placeOnTable(card, {x, y} = {}){
  const c = {...card};
  if (x!=null) c.x = x; if (y!=null) c.y = y;
  c.face = c.face || 'front';
  c.tapped = !!c.tapped;

  // update state
  S().table = S().table || [];
  S().table.push(c);
  // visual
  const el = createTableCardEl(c);
  worldEl().appendChild(el);

  saveStateDebounced();
}

/* ----------------------- move helpers from deck ----------------------- */
function removeFromDeckById(id){
  const d = S().deck || [];
  const idx = d.findIndex(c=>c.id===id);
  if (idx>-1){ d.splice(idx,1); return true; }
  return false;
}
function toHand(card){
  S().hand = S().hand || [];
  S().hand.push(card);
  saveStateDebounced();

  // Optional immediate UI: if you decide to expose your renderHand()
  // add this once in V2.html after function declaration:
  //   window.__rerenderHand = renderHand;
  window.__rerenderHand?.();
}
function toZone(zone, card){
  const key = zone==='exile' ? 'exile' : 'gy';
  S()[key] = S()[key] || [];
  S()[key].unshift(card);
  saveStateDebounced();
}

// --- make "Table" follow the swipe-up path ---
function centerOfWorld(){
  const w = worldEl();
  return { x: (w.clientWidth/2) - 112, y: (w.clientHeight/2) - 155 };
}

function toTableViaSwipe(card){
  // Put in hand first so it mirrors swipe-up animation/state
  toHand(card);                         // this already calls window.__rerenderHand?.()
  if (typeof window.stageFromHand === 'function'){
    try { window.stageFromHand(card); } // EXACT same path as swiping up from hand
    catch(e){ console.warn('[deck.tools] stageFromHand error', e); }
  } else {
    // Fallback if you haven’t exposed it yet
    const { x, y } = centerOfWorld();
    placeOnTable(card, { x, y });
  }
}


/* ----------------------------- overlays ------------------------------ */
function ensureDeckSearchOverlay(){
  let ov = $('#deckSearchOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'deckSearchOverlay';
  ov.className = 'chatOverlay';
  ov.setAttribute('aria-hidden', 'true');
  ov.innerHTML = `
    <div class="chatPanel" role="dialog" aria-label="Deck Search">
      <div class="chatHeader">
        <span>Deck Search</span>
        <button id="deckSearchClose" class="chatClose" title="Close">✕</button>
      </div>
      <div id="deckSearchGrid"
           style="flex:1; overflow:auto; padding:12px; display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:14px;">
      </div>
    </div>`;
  document.body.appendChild(ov);
  $('#deckSearchClose', ov).onclick = ()=> hideOverlay(ov);
  ov.onclick = (e)=>{ if (e.target === ov) hideOverlay(ov); };
  return ov;
}

function ensureDeckAddAnyOverlay(){
  let ov = $('#deckAddAnyOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'deckAddAnyOverlay';
  ov.className = 'chatOverlay';
  ov.setAttribute('aria-hidden','true');
  ov.innerHTML = `
    <div class="chatPanel" role="dialog" aria-label="Add Card / Token">
      <div class="chatHeader">
        <span>Add Card / Token</span>
        <div style="display:flex; gap:8px; align-items:center;">
          <input id="addAnyQuery" type="text" placeholder="Search Scryfall (e.g. Shock, Treasure, t:artifact cmc<=2)…"
                 style="min-width:340px;border:1px solid #2b3f63;background:#0a0f16;color:#e7e9ee;border-radius:10px;padding:8px;">
          <select id="addAnyMode" title="Scope" style="background:#0d1421;border:1px solid #2b3f63;color:#dbe5ff;border-radius:10px;padding:6px 8px;font-weight:700;">
            <option value="BOTH">Cards + Tokens</option>
            <option value="CARDS">Cards only</option>
            <option value="TOKENS">Tokens only</option>
          </select>
          <button id="addAnyGo" class="btn sm">Search</button>
          <button id="deckAddAnyClose" class="chatClose" title="Close">✕</button>
        </div>
      </div>
      <div id="addAnyGrid" style="flex:1; overflow:auto; padding:12px; display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:14px;"></div>
    </div>`;
  document.body.appendChild(ov);
  $('#deckAddAnyClose', ov).onclick = ()=> hideOverlay(ov);
  $('#addAnyGo', ov).onclick = ()=> runScrySearch();
  $('#addAnyQuery', ov).addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); runScrySearch(); }});
  ov.onclick = (e)=>{ if (e.target === ov) hideOverlay(ov); };

  async function runScrySearch(){
    const q = $('#addAnyQuery', ov).value.trim() || '*';
    const mode = $('#addAnyMode', ov).value;
    await renderScryResults(q, mode);
  }

  return ov;
}

function ensureDeckToolsOverlay(){
  let ov = $('#deckToolsOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'deckToolsOverlay';
  ov.className = 'chatOverlay';
  ov.setAttribute('aria-hidden','true');
  ov.innerHTML = `
    <div class="chatPanel" role="dialog" aria-label="Deck Tools">
      <div class="chatHeader">
        <span>Deck Tools</span>
        <button id="deckToolsClose" class="chatClose" title="Close">✕</button>
      </div>
      <div style="padding:12px; display:grid; gap:14px;">
        <div>Tools body (draw/mill/etc.) — overlay proving ground.</div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  $('#deckToolsClose', ov).onclick = ()=> hideOverlay(ov);
  ov.onclick = (e)=>{ if (e.target === ov) hideOverlay(ov); };
  return ov;
}

/* ----------------------- deck search rendering ----------------------- */
function buildActionRow(on){
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px;';
  const mk = (label, dest)=>{
    const b = document.createElement('button');
    b.className = 'btn sm';
    b.textContent = label;
    b.addEventListener('click', (e)=>{ e.stopPropagation(); on(dest); });
    return b;
  };
  row.append(mk('Table','table'), mk('Hand','hand'), mk('Graveyard','graveyard'), mk('Exile','exile'));
  return row;
}

async function renderDeckSearch(){
  console.log('[deck.tools] renderDeckSearch() start');
  const ov = ensureDeckSearchOverlay();
  showOverlay(ov);

  const grid = $('#deckSearchGrid', ov);
  grid.innerHTML = `<div style="opacity:.9">Loading deck…</div>`;

  const cards = Array.isArray(S().deck) ? S().deck : [];
  console.log('[deck.tools] deck size:', cards.length);
  if (!cards.length){ grid.innerHTML = `<div style="opacity:.85">No cards in deck.</div>`; return; }

  grid.innerHTML='';
  cards.forEach((card, idx)=>{
    const url  = (card.frontImg) || (card._faces?.[0]?.image) || (card._scry?.image_uris?.normal) || CARD_BACK_URL;
    const name = card?.name || 'Unknown';

    const tile = document.createElement('div');
    tile.style.cssText = 'background:#0b1220;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px;display:flex;flex-direction:column;';
    tile.innerHTML = `
      <div style="position:relative;">
        <div style="width:100%;aspect-ratio:223/310;border-radius:10px;background:#060b14 center/cover no-repeat; background-image:url('${url}');"></div>
        ${idx===0 ? `<div style="position:absolute;right:8px;top:8px;background:#142136;border:1px solid #35527d;border-radius:8px;padding:2px 6px;font-weight:800;">TOP</div>`:''}
      </div>
      <div style="margin-top:8px;font-weight:800">${name}</div>
    `;
    tile.appendChild(buildActionRow((dest)=>{
      // remove from deck by id, then route
      if (!removeFromDeckById(card.id)) return;

      if (dest === 'table'){ toTableViaSwipe(card); }
 else if (dest === 'hand'){
        toHand(card);
      } else if (dest === 'graveyard'){
        toZone('graveyard', card);
      } else if (dest === 'exile'){
        toZone('exile', card);
      }
      // update list tile immediately
      tile.style.opacity = '.35';
      tile.style.pointerEvents = 'none';
    }));
    grid.appendChild(tile);
  });
}

/* ---------------------- Scryfall search rendering -------------------- */
async function scrySearch(query, mode){
  let q = query || '*';
  if (mode === 'TOKENS') q = `is:token ${q}`;
  if (mode === 'CARDS')  q = `-is:token ${q}`;
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=name&unique=cards`;
  try{
    const r = await fetch(url);
    const j = await r.json();
    return Array.isArray(j.data) ? j.data.slice(0, 72) : [];
  }catch(e){
    console.warn('[deck.tools] scryfall error', e);
    return [];
  }
}

function cardObjFromScry(d){
  const faces = (Array.isArray(d.card_faces) && d.card_faces.length)
    ? d.card_faces.map(f=>({
        name: f.name || d.name || '',
        type_line: f.type_line || d.type_line || '',
        oracle_text: f.oracle_text || '',
        power: f.power || '',
        toughness: f.toughness || '',
        mana_cost: f.mana_cost || '',
        image: (f.image_uris?.normal || f.image_uris?.large || f.image_uris?.png || '')
      }))
    : [{
        name: d.name || '',
        type_line: d.type_line || '',
        oracle_text: d.oracle_text || '',
        power: d.power || '',
        toughness: d.toughness || '',
        mana_cost: d.mana_cost || '',
        image: (d.image_uris?.normal || d.image_uris?.large || d.image_uris?.png || '')
      }];

  return {
    id: 'scry_' + Math.random().toString(36).slice(2),
    name: d.name || 'Unknown',
    frontImg: faces[0]?.image || '',
    backImg:  faces[1]?.image || '',
    face: 'front',
    tapped: false,
    _faces: faces,
    _scry: d
  };
}

async function renderScryResults(query, mode){
  const ov   = ensureDeckAddAnyOverlay();
  const grid = $('#addAnyGrid', ov);
  grid.innerHTML = `<div style="opacity:.9">Searching…</div>`;
  showOverlay(ov);

  const results = await scrySearch(query, mode);
  if (!results.length){ grid.innerHTML = `<div style="opacity:.85">No results.</div>`; return; }

  grid.innerHTML='';
  results.forEach((d)=>{
    const obj = cardObjFromScry(d);
    const url = obj.frontImg || CARD_BACK_URL;

    const tile = document.createElement('div');
    tile.style.cssText = 'background:#0b1220;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px;display:flex;flex-direction:column;';
    tile.innerHTML = `
      <div style="width:100%;aspect-ratio:223/310;border-radius:10px;background:#060b14 center/cover no-repeat; background-image:url('${url}');"></div>
      <div style="margin-top:8px;font-weight:800">${obj.name}</div>
    `;
    tile.appendChild(buildActionRow((dest)=>{
     if (dest === 'table'){ toTableViaSwipe(card); }
 else if (dest === 'hand'){
        toHand(obj);
      } else if (dest === 'graveyard'){
        toZone('graveyard', obj);
      } else if (dest === 'exile'){
        toZone('exile', obj);
      }
      tile.style.opacity = '.55';
    }));

    grid.appendChild(tile);
  });
}

/* ------------------------------ openers ------------------------------ */
function openAddAny(){
  console.log('[deck.tools] openAddAny()');
  const ov = ensureDeckAddAnyOverlay();
  showOverlay(ov);
}

function openDeckTools(){
  console.log('[deck.tools] openDeckTools()');
  const ov = ensureDeckToolsOverlay();
  showOverlay(ov);
}

/* ------------------------------- boot ------------------------------- */
export function bootDeckTools(){
  console.log('[deck.tools] bootDeckTools()');
  const searchBtn = $('#deckSearchBtn');
  const addBtn    = $('#deckAddBtn');
  const moreBtn   = $('#deckMoreBtn');

  if (!searchBtn || !addBtn || !moreBtn){
    console.warn('[deck.tools] deck buttons missing in DOM');
  }

  searchBtn?.addEventListener('click', (e)=>{ console.log('[deck.tools] handler -> deckSearchBtn'); e.stopPropagation(); renderDeckSearch(); });
  addBtn?.addEventListener('click',    (e)=>{ console.log('[deck.tools] handler -> deckAddBtn');    e.stopPropagation(); openAddAny(); });
  moreBtn?.addEventListener('click',   (e)=>{ console.log('[deck.tools] handler -> deckMoreBtn');   e.stopPropagation(); openDeckTools(); });

  // Force-open helpers
  window.__deckDebug = {
    openSearch: renderDeckSearch,
    openAdd: openAddAny,
    openTools: openDeckTools,
    scry: renderScryResults
  };
}
