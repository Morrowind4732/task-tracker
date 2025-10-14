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

    this.els.graveyard?.addEventListener('click', ()=> this.openZone('graveyard'));
    this.els.exile?.addEventListener('click',     ()=> this.openZone('exile'));

    // Global pointerup safety net to catch unhandled drops
    document.addEventListener('pointerup', (e)=>{
      const cardEl = e.target?.closest?.('.card');
      if (cardEl && this.isTableCard(cardEl)) this.handleDrop(cardEl);
    });
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

  _detectOverlappingZone(cardEl){
    const cardRect = cardEl.getBoundingClientRect();
    let best=null, bestScore=0;
    const candidates = [
      ['graveyard', this.els.graveyard],
      ['exile',     this.els.exile],
      ['hand',      this.els.hand],
      ['deck',      this.els.deck],
    ];
    for (const [name, el] of candidates){
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const s = this._intersectRatio(cardRect, r);
      if (s > bestScore){ bestScore = s; best = name; }
    }
    return bestScore >= 0.15 ? best : null;
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
      this.zoneState.set(seat, { table:[], graveyard:[], exile:[], hand:[], deck:[] });
    }
    return this.zoneState.get(seat);
  },

  async _hydrate(cid, fallback){
    if (fallback?.name) return fallback;
    try{
      const d = await Promise.resolve(this.cfg.getCardDataById?.(cid));
      if (d) return d;
    }catch{}
    return { id: cid, name: cid, mana_cost:'', type_line:'', oracle_text:'', img:'' };
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
