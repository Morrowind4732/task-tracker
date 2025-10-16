// ================================
// FILE: modules/zones.js
// Overlap detection + seat-aware per-zone state + deck drop choices
// ================================
import Overlays from './overlays.js';

/*
API:
  Zones.init({
    zones: { graveyard:Element, exile:Element, deck:Element, hand:Element },
    worldEl: Element,                           // optional: battlefield root
    spawnToTable(card, seat),
    addToHand(card, seat),
    addToDeck(card, seat, { position: 'top'|'bottom'|'shuffle' }),
    shuffleDeck(seat),
    removeTableCardDomById(cid),
    getCardDataById(cid),
    onMoved?(meta) // { seat, cid, from, to, position? }
  });

  Zones.registerDraggableCard(cardEl); // optional per-card hookup
  Zones.handleDrop(cardEl);            // call on pointerup
  Zones.openZone(zoneName, seat?);     // 'graveyard' | 'exile'
  Zones.restoreFromState(seat, state?);
  // v3.html – Zones.init config
spawnToTable: (card, seat) => window.spawnCardAtViewCenter?.(card, seat),

*/

const Zones = {
  cfg: null,
  els: { graveyard:null, exile:null, deck:null, hand:null, world:null },
  zoneState: new Map(), // seat -> { table:[], graveyard:[], exile:[], hand:[], deck:[] }

  applyRemoteMove(seat, meta = {}){
    const s   = Number(seat || this.getViewSeat()) || 1;
    const from= String(meta.from || '');
    const to  = String(meta.to   || '');
    const cid = String(meta.cid  || '');
    if (!from || !to || !cid) return;

    (async () => {
      await this._moveBetween(s, { from, to, cid });

      // Mirror the sender's side-effects that touch shared UI:
      if (to === 'table') {
        try { this.cfg.spawnToTable?.(await this._hydrate(cid), s); } catch {}
      }

      // NOTE: for 'hand' or 'deck' we do NOT mutate the peer’s private hand/deck UI.
      // We only keep our internal zoneState in sync so overlays show correct lists.
    })().catch(err => console.warn('[Zones] applyRemoteMove error', err));
  },

  init(opts = {}){
    this.cfg = opts || {};
    this.els.world     = opts.worldEl || document.getElementById('world') || document.body;
    this.els.graveyard = opts.zones?.graveyard || document.getElementById('graveyard');
    // NOTE: v3 has id="exileZone" in HTML
    this.els.exile     = opts.zones?.exile     || document.getElementById('exileZone');
    this.els.deck      = opts.zones?.deck      || document.getElementById('deckZone');
    this.els.hand      = opts.zones?.hand      || document.getElementById('hand');

    this.els.cmd       = opts.zones?.cmd       || document.getElementById('cmdZone');
    this.els.graveyard?.addEventListener('click', ()=> this.openZone('graveyard'));
    this.els.exile?.addEventListener('click',     ()=> this.openZone('exile'));

    // Global pointerup safety net to catch unhandled drops
document.addEventListener('pointerup', (e)=>{
  // Prefer the card we marked as "dragging" in pointerdown.
  const tagged = document.querySelector('.card[data-dragging="1"]');
  const cardEl = tagged || e.target?.closest?.('.card');
  if (cardEl) delete cardEl.dataset.dragging;
  if (cardEl && this.isTableCard(cardEl)) this.handleDrop(cardEl);
}, { capture:true });

document.addEventListener('pointerdown', (e)=>{
  const el = e.target?.closest?.('.card');
  if (!el) return;

  // Mark active drag target so pointerup can find it even if the up fires on a zone.
  el.dataset.dragging = '1';

  if (el.dataset.inCmd === '1' || el.classList.contains('in-cmd')) {
    el.classList.remove('tapped', 'in-cmd');
    el.style.removeProperty('--tap-rot');
    delete el.dataset.inCmd;

    try{
      const owner = Number(el.dataset?.owner || this.getViewSeat()) || this.getViewSeat();
      const st = this._ensureSeatState(owner);
      const cid = el.dataset?.cid || el.getAttribute('data-cid');
      if (Array.isArray(st.cmd) && cid){
        const i = st.cmd.findIndex(x => (x.id||x.cid||x) === cid);
        if (i >= 0) st.cmd.splice(i,1);
        this._saveSeatState(owner, st);
      }
    }catch{}
  }
}, { capture:true });

  },
  
  getZoneCards({ seat, zoneName }) {
  const s = Number(seat ?? this.getViewSeat()) || 1;
  const st = this._ensureSeatState(s);
  return Array.isArray(st[zoneName]) ? st[zoneName].slice() : [];
},

async addToZone({ seat, zoneName, card }) {
  const s = Number(seat ?? this.getViewSeat()) || 1;
  const cid = card?.id || card?.cid || (crypto?.randomUUID?.() || String(Math.random())).slice(0,12);
  await this._moveBetween(s, { from:'deck', to: zoneName, cid, hydrate:{ ...card, id: cid } });
  return cid;
},

async moveFromZone({ seat, from, to, card }) {
  const s = Number(seat ?? this.getViewSeat()) || 1;
  const cid = card?.id || card?.cid || card?.name || '';
  if (!cid) return;
  await this._moveBetween(s, { from, to, cid, hydrate: card });
},

emitChange(/*{ seat, zoneName }*/) {
  // no-op: Overlays will refetch via fetchCards when provided
},


  getViewSeat(){
    // v3 exposes current seat via select#mySeat and tracks view in code.
    // Fallback to P1 if unknown.
    try {
      const app = window.AppState || {};
      return Number(app.viewSeat ?? app.mySeat ?? 1) || 1;
    } catch { return 1; }
  },

  getGameId(){
    return String(window.ROOM_ID || window.AppState?.gameId || '');
  },

  isTableCard(el){ return el?.classList?.contains('card') && el?.closest?.('#world'); },
  registerDraggableCard(el){ el?.addEventListener?.('pointerup', ()=> this.handleDrop(el)); },

  // ---- geometry ----
_intersectRatio(cardRect, zoneRect){
  const left   = Math.max(cardRect.left, zoneRect.left);
  const top    = Math.max(cardRect.top,  zoneRect.top);
  const right  = Math.min(cardRect.right,zoneRect.right);
  const bottom = Math.min(cardRect.bottom,zoneRect.bottom);
  const w = Math.max(0, right - left);
  const h = Math.max(0, bottom - top);
  const inter = w*h;
  const areaC = Math.max(1, cardRect.width*cardRect.height);
  return inter / areaC;
},

// Current world zoom: ratio of rendered size to layout size
_getWorldZoom(){
  try{
    const ws = document.getElementById('worldScale') || this.els.world;
    if (!ws) return 1;
    const rW = ws.getBoundingClientRect().width;
    const oW = ws.offsetWidth || 1;
    return rW / oW;
  }catch{ return 1; }
},


  _detectOverlappingZone(cardEl){
  const cardRect = cardEl.getBoundingClientRect();
  let best = null, bestScore = 0;

  const candidates = [
    ['graveyard', this.els.graveyard],
    ['exile',     this.els.exile],
    ['hand',      this.els.hand],
    ['deck',      this.els.deck],
    ['cmd',       this.els.cmd],
  ];

  // Card center (used as a tie-breaker)
  const cx = cardRect.left + cardRect.width  / 2;
  const cy = cardRect.top  + cardRect.height / 2;

  for (const [name, el] of candidates){
    if (!el) continue;
    const zr = el.getBoundingClientRect();

    // 1) Intersection ratio (area overlap / card area)
    const left   = Math.max(cardRect.left, zr.left);
    const top    = Math.max(cardRect.top,  zr.top);
    const right  = Math.min(cardRect.right,zr.right);
    const bottom = Math.min(cardRect.bottom,zr.bottom);
    const w = Math.max(0, right - left);
    const h = Math.max(0, bottom - top);
    const inter = w * h;
    const areaC = Math.max(1, cardRect.width * cardRect.height);
    const ratio = inter / areaC;

    // 2) Center-in-zone gets a small bonus
    const centerIn =
      cx >= zr.left && cx <= zr.right && cy >= zr.top && cy <= zr.bottom
        ? 0.15 : 0; // bonus

    const score = ratio + centerIn;

    if (score > bestScore){
      bestScore = score;
      best = [name, el];
    }
  }

  // Require a small threshold so micro overlaps don’t trigger
  return (bestScore >= 0.12) ? best[0] : null;
},



  async handleDrop(cardEl){
    try{
      const zone = this._detectOverlappingZone(cardEl);
      if (!zone) return;

      const cid   = cardEl.dataset?.cid || cardEl.getAttribute('data-cid');
      const owner = Number(cardEl.dataset?.owner || this.getViewSeat()) || this.getViewSeat();
      if (!cid) return;

      if (zone === 'graveyard' || zone === 'exile'){
        await this._moveBetween(owner, { from:'table', to:zone, cid });
        try{ this.cfg.removeTableCardDomById?.(cid); }catch{}
        try{ cardEl.remove(); }catch{}
        this.cfg.onMoved?.({ seat: owner, cid, from:'table', to:zone });
        return;
      }
	  
	   if (zone === 'cmd'){
  try {
    const zr = this.els.cmd.getBoundingClientRect();
    const cx = zr.left + zr.width  / 2;
    const cy = zr.top  + zr.height / 2;

    // Card size in WORLD space (screen px divided by zoom)
    const zoom = this._getWorldZoom();
    const rect = cardEl.getBoundingClientRect();
    const cwWorld = rect.width  / Math.max(zoom, 0.0001);
    const chWorld = rect.height / Math.max(zoom, 0.0001);

    let wx, wy;

    if (this.screenToWorld){
      const p = this.screenToWorld(cx, cy); // world center of commander zone
      wx = p.x - (cwWorld / 2);
      wy = p.y - (chWorld / 2);
    } else {
      // Fallback: approximate world conversion via worldScale rect
      const ws = document.getElementById('worldScale') || this.els.world?.parentElement || this.els.world;
      const r  = ws?.getBoundingClientRect?.();
      const mx = cx - (r?.left || 0);
      const my = cy - (r?.top  || 0);
      const wxRaw = (mx) / Math.max(zoom, 0.0001);
      const wyRaw = (my) / Math.max(zoom, 0.0001);
      wx = wxRaw - (cwWorld / 2);
      wy = wyRaw - (chWorld / 2);
    }

    cardEl.style.position = 'absolute';
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      cardEl.style.left = `${wx}px`;
      cardEl.style.top  = `${wy}px`;
    }));
  } catch {}

  cardEl.classList.add('tapped');
  cardEl.classList.add('in-cmd');
  cardEl.style.setProperty('--tap-rot', '0deg');
  cardEl.dataset.inCmd = '1';

  const owner = Number(cardEl.dataset?.owner || this.getViewSeat()) || this.getViewSeat();
  const st = this._ensureSeatState(owner);
  if (!Array.isArray(st.cmd)) st.cmd = [];
  const cid = cardEl.dataset?.cid || cardEl.getAttribute('data-cid');
  if (cid && !st.cmd.some(x => (x.id||x.cid||x) === cid)) {
    st.cmd.push({ id: cid });
    await this._saveSeatState(owner, st);
  }
  return;
}



      if (zone === 'hand'){
        await this._moveBetween(owner, { from:'table', to:'hand', cid });
        try{ this.cfg.addToHand?.(await this._hydrate(cid), owner); }catch{}
        try{ this.cfg.removeTableCardDomById?.(cid); }catch{}
        try{ cardEl.remove(); }catch{}
        this.cfg.onMoved?.({ seat: owner, cid, from:'table', to:'hand' });
        return;
      }

      if (zone === 'deck'){
        Overlays.openDeckInsertChoice({
          onTop: async ()=>{
            await this._moveBetween(owner, { from:'table', to:'deck', cid });
            try{ this.cfg.addToDeck?.(await this._hydrate(cid), owner, { position:'top' }); }catch{}
            this._cleanupAfterDeckInsert(cid, cardEl);
            this.cfg.onMoved?.({ seat: owner, cid, from:'table', to:'deck', position:'top' });
          },
          onBottom: async ()=>{
            await this._moveBetween(owner, { from:'table', to:'deck', cid });
            try{ this.cfg.addToDeck?.(await this._hydrate(cid), owner, { position:'bottom' }); }catch{}
            this._cleanupAfterDeckInsert(cid, cardEl);
            this.cfg.onMoved?.({ seat: owner, cid, from:'table', to:'deck', position:'bottom' });
          },
          onShuffle: async ()=>{
            await this._moveBetween(owner, { from:'table', to:'deck', cid });
            try{
              this.cfg.addToDeck?.(await this._hydrate(cid), owner, { position:'shuffle' });
              this.cfg.shuffleDeck?.(owner);
            }catch{}
            this._cleanupAfterDeckInsert(cid, cardEl);
            this.cfg.onMoved?.({ seat: owner, cid, from:'table', to:'deck', position:'shuffle' });
          },
          onCancel: ()=>{ /* no-op */ }
        });
        return;
      }
    }catch(err){
      console.warn('[Zones] handleDrop error', err);
    }
  },

  _cleanupAfterDeckInsert(cid, el){
    try{ this.cfg.removeTableCardDomById?.(cid); }catch{}
    try{ el.remove(); }catch{}
  },

  // ---- overlays ----
  async openZone(zoneName, seat){
    if (!(zoneName === 'graveyard' || zoneName === 'exile')) return;
    const s = Number(seat ?? this.getViewSeat()) || 1;

    const st = this._ensureSeatState(s);
    const rawList = Array.isArray(st[zoneName]) ? st[zoneName] : [];

    // NEW: hydrate so each has img + name
    const list = await Promise.all(rawList.map(async c => {
      const cid = c?.id || c?.cid || c;
      const data = await this._hydrate(cid, c);
      return { ...data, cid };
    }));

    Overlays.openZoneList({
      title: `${zoneName.toUpperCase()} — P${s}`,
      seat: s,
      zoneName,
      cards: list,
	  fetchCards: () => this.getZoneCards({ seat: s, zoneName }),
      onMove: async (card, dest)=>{
        const cid = card.id || card.cid || cardElId(card);
        await this._moveBetween(s, { from: zoneName, to: dest, cid, hydrate: card });

        if (dest === 'table'){
          try{ this.cfg.spawnToTable?.(await this._hydrate(cid, card), s); }catch{}
        } else if (dest === 'hand'){
          try{ this.cfg.addToHand?.(await this._hydrate(cid, card), s); }catch{}
        } else if (dest === 'deck'){
          try{ this.cfg.addToDeck?.(await this._hydrate(cid, card), s, { position:'top' }); }catch{}
        }

        this.cfg.onMoved?.({ seat: s, cid, from: zoneName, to: dest });
      }
    });

    function cardElId(c){ return c?.id || c?.cid || c?.name || ''; }
  },

  // ---- state/persistence ----
  _ensureSeatState(seat){
  if (!this.zoneState.has(seat)){
    this.zoneState.set(seat, { table:[], graveyard:[], exile:[], hand:[], deck:[], cmd:[] });
  }
  return this.zoneState.get(seat);
},


  async _hydrate(cid, fallback){
  const id = String(cid);

  // 1) Ask your store/cache (e.g., Scryfall-ish object)
  let fromStore = {};
  try {
    const d = await Promise.resolve(this.cfg.getCardDataById?.(id));
    if (d && typeof d === 'object') fromStore = d;
  } catch {}

  // 2) Snapshot from the current DOM (if on table or still around)
  let fromDom = {};
  try {
    const el = document.querySelector(`.card[data-cid="${CSS.escape(id)}"]`);
    if (el) {
      const ogEffects = (() => {
        try { return el.dataset.ogEffects ? JSON.parse(el.dataset.ogEffects) : []; } catch { return []; }
      })();
      const ogTypes = (() => {
        try { return el.dataset.ogTypes ? JSON.parse(el.dataset.ogTypes) : []; } catch { return []; }
      })();
      fromDom = {
        id,
        cid: id,
        name: el.dataset.name || id,
        img:  el.querySelector('.face.front img')?.src || '',
        baseP: el.dataset.baseP ?? null,
        baseT: el.dataset.baseT ?? null,
        ogEffects,
        ogTypes,
      };
    }
  } catch {}

  // 3) Fallback object (typically from Battle) already has rich fields now
  const fb = (fallback && typeof fallback === 'object') ? fallback : {};

  // 4) Merge in priority: fallback (Battle) → DOM → store → minimal defaults
  const merged = {
    id,
    cid: id,
    name: id,
    img: '',
    mana_cost: '',
    type_line: '',
    oracle_text: '',
    ...fromStore,
    ...fromDom,
    ...fb
  };

  // Normalize baseP/baseT to strings (can be "*", "?" etc.)
  if (merged.baseP != null) merged.baseP = String(merged.baseP);
  if (merged.baseT != null) merged.baseT = String(merged.baseT);

  // Prefer explicit ogTypes if only generic types exist
  if (!Array.isArray(merged.ogTypes) && Array.isArray(merged.types)) merged.ogTypes = merged.types;

  return merged;
},


  _removeById(arr, cid){
    const i = arr.findIndex(x => (x.id || x.cid || x) === cid);
    if (i >= 0) arr.splice(i,1);
  },

  _pushIfMissing(arr, item){
    const id = item.id || item.cid || item;
    if (!arr.some(x => (x.id || x.cid || x) === id)) arr.push(item);
  },

  async _moveBetween(seat, { from, to, cid, hydrate }){
    const st = this._ensureSeatState(seat);
    if (Array.isArray(st[from])) this._removeById(st[from], cid);

    const data = await this._hydrate(cid, hydrate);
    if (!Array.isArray(st[to])) st[to] = [];
    this._pushIfMissing(st[to], data);
    await this._saveSeatState(seat, st);

    if (from === 'table'){
      try{ this.cfg.removeTableCardDomById?.(cid); }catch{}
    }
  },

  async _saveSeatState(seat, state){
    // Prefer your StorageAPI if available
    if (window.StorageAPI?.savePlayerState){
      const gameId = this.getGameId();
      return await window.StorageAPI.savePlayerState(gameId, seat, { state });
    }

    // Otherwise, if Supabase is present and you have a table
    const SB = window.supabase;
    if (!SB || typeof SB.from !== 'function') return;  // ← guard

    const gameId = this.getGameId();
    const payload = { game_id: gameId, seat, state };
    const { error } = await SB.from('player_states').upsert(payload, { onConflict: 'game_id,seat' });
    if (error) console.warn('[Zones] save error', error);
  },

  async _loadSeatState(seat){
    if (window.StorageAPI?.loadPlayerState){
      const gameId = this.getGameId();
      const snap = await window.StorageAPI.loadPlayerState(gameId, seat);
      return snap?.state || { table:[], graveyard:[], exile:[], hand:[], deck:[] };
    }

    const SB = window.supabase;
    if (!SB || typeof SB.from !== 'function')
      return { table:[], graveyard:[], exile:[], hand:[], deck:[] };

    const gameId = this.getGameId();
    const { data, error } = await SB
      .from('player_states')
      .select('state')
      .eq('game_id', gameId)
      .eq('seat', seat)
      .maybeSingle();

    if (error) {
      console.warn('[Zones] load error', error);
      return { table:[], graveyard:[], exile:[], hand:[], deck:[] };
    }
    return data?.state || { table:[], graveyard:[], exile:[], hand:[], deck:[] };
  },

  async restoreFromState(seat, state){
    const st = state || await this._loadSeatState(seat);
    this.zoneState.set(seat, {
      table:     Array.isArray(st.table)     ? st.table.slice()     : [],
      graveyard: Array.isArray(st.graveyard) ? st.graveyard.slice() : [],
      exile:     Array.isArray(st.exile)     ? st.exile.slice()     : [],
      hand:      Array.isArray(st.hand)      ? st.hand.slice()      : [],
      deck:      Array.isArray(st.deck)      ? st.deck.slice()      : [],
    });
  }
};

export default Zones;
export { Zones };
