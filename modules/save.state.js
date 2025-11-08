// /modules/save.state.js
// Full game snapshot + paired RTC save.
// NOW SAVES BOTH SEATS (table + zones + HAND + DECK) INTO ONE ROW.

import { RulesStore }    from './rules.store.js';
import { Zones }         from './zones.js';
import { DeckLoading }   from './deck.loading.js';
import { UserInterface } from './user.interface.js';

function nowIso(){ return new Date().toISOString(); }
function mySeatSafe(){ try{ return (typeof window.mySeat==='function'? window.mySeat(): (window.__LOCAL_SEAT||1)); } catch { return 1; } }
function roomIdSafe(){ return (window.__ROOM_ID || document.querySelector('#roomInput')?.value || 'local'); }
function playerNameSafe(){
  try{ return UserInterface?.getPlayerLabel?.() || `Seat ${mySeatSafe()}`; } catch { return `Seat ${mySeatSafe()}`; }
}

// ------------------------- Rules / attrs snapshots --------------------------

function snapshotRulesFromEl(el){
  const d = el?.dataset || {};
  const side = (d.currentSide==='back') ? 'back' : 'front';
  const pick = (Key) => d[side + Key] || d[Key.toLowerCase()] || d[(side==='back'?'front':'back') + Key] || '';
  const typeLine = d.typeLine || pick('TypeLine') || '';
  const oracle   = d.oracle   || pick('Oracle')   || '';

  const parseJsonArr = (s) => { try{ const a=JSON.parse(s||'[]'); return Array.isArray(a)?a:[]; }catch{return [];} };
  let baseTypes      = d.baseTypes ? parseJsonArr(d.baseTypes) : (d[side+'BaseTypes'] ? parseJsonArr(d[side+'BaseTypes']) : []);
  let baseAbilities  = d.baseAbilities ? parseJsonArr(d.baseAbilities) : (d[side+'BaseAbilities'] ? parseJsonArr(d[side+'BaseAbilities']) : []);

  return {
    currentSide: side,
    typeLine, oracle,
    baseTypes, baseAbilities,
    front: {
      typeLine: d.frontTypeLine || '',
      oracle:   d.frontOracle   || '',
      baseTypes: parseJsonArr(d.frontBaseTypes),
      baseAbilities: parseJsonArr(d.frontBaseAbilities),
      img: d.imgFront || ''
    },
    back: {
      typeLine: d.backTypeLine || '',
      oracle:   d.backOracle   || '',
      baseTypes: parseJsonArr(d.backBaseTypes),
      baseAbilities: parseJsonArr(d.backBaseAbilities),
      img: d.imgBack || ''
    }
  };
}

function snapshotComputedAttrs(el){
  let remote = {};
  try{ remote = JSON.parse(el.dataset.remoteAttrs || '{}'); }catch{}
  const obj = {
    pt: el.dataset.ptCurrent || remote.pt || '',
    abilities: Array.isArray(remote.abilities)? remote.abilities.slice() : [],
    types: Array.isArray(remote.types)? remote.types.slice() : [],
    counters: (remote.counters && typeof remote.counters==='object') ? {...remote.counters} : {}
  };
  return obj;
}

// ------------------------- Geometry helpers --------------------------------

function screenToWorld(x,y){
  try{ return window._screenToWorld ? window._screenToWorld(x,y) : {wx:x, wy:y}; } catch { return {wx:x,wy:y}; }
}

function bboxWorld(el){
  const r = el.getBoundingClientRect();
  const { wx, wy } = screenToWorld(r.left, r.top);
  return { x: wx, y: wy, w: r.width, h: r.height };
}

// ------------------------- Card snapshots ----------------------------------

function snapshotTableCard(el){
  const d = el.dataset || {};
  const box = bboxWorld(el);
  const tapped = (d.tapped === '1' || el.classList.contains('is-tapped') || el.classList.contains('tapped'));
  return {
    cid: d.cid,
    owner: Number(d.owner||mySeatSafe()),
    name: d.name || el.title || '',
    img: el.currentSrc || el.src || '',
    pos: { x: box.x, y: box.y, z: Number(d.zIndex||0) },
    tapped: !!tapped,
    currentSide: (d.currentSide==='back')? 'back':'front',
    rules: snapshotRulesFromEl(el),
    computed: snapshotComputedAttrs(el),
    tags: {
      commander: d.isCommander === '1',
      summoningSickness: d.hasSummoningSickness === '1'
    }
  };
}

function snapshotHandCard(el){
  const d = el.dataset || {};
  return {
    cid: d.cid, owner: Number(d.owner||mySeatSafe()),
    name: d.name || el.title || '',
    img: el.currentSrc || el.src || '',
    rules: snapshotRulesFromEl(el),
    computed: snapshotComputedAttrs(el)
  };
}

// ------------------------- Battlefield (BOTH seats) -------------------------

function snapshotBattlefieldBothSeats(){
  const out = { p1: [], p2: [] };
  document.querySelectorAll('img.table-card[data-cid]').forEach(el=>{
    const snap = snapshotTableCard(el);
    if (snap.owner === 1) out.p1.push(snap);
    else                  out.p2.push(snap);
  });
  return out;
}

// ------------------------- Hand / Zones (BOTH seats) ------------------------

function snapshotHandOwned(){
  const seat = String(mySeatSafe());
  const out = [];
  const sel = '#handZone img.hand-card[data-cid], #handZone img.table-card[data-cid], .hand-zone img.hand-card[data-cid], .hand-zone img.table-card[data-cid]';
  document.querySelectorAll(sel).forEach(el=>{
    const owner = el.dataset.owner || seat;
    if (String(owner) === seat) out.push(snapshotHandCard(el));
  });
  return out;
}

function zonesBothSeats(){
  const mySeat = mySeatSafe();
  const keyFor = (seat) => (seat === mySeat ? 'player' : 'opponent');
  let gy_p1 = [], gy_p2 = [], ex_p1 = [], ex_p2 = [];
  try {
    gy_p1 = Zones.exportOwnerZone?.(keyFor(1),'graveyard') || [];
    gy_p2 = Zones.exportOwnerZone?.(keyFor(2),'graveyard') || [];
    ex_p1 = Zones.exportOwnerZone?.(keyFor(1),'exile')     || [];
    ex_p2 = Zones.exportOwnerZone?.(keyFor(2),'exile')     || [];
  } catch {}
  return {
    p1: { graveyard: gy_p1, exile: ex_p1 },
    p2: { graveyard: gy_p2, exile: ex_p2 }
  };
}

function snapshotDeck(){
  try { return DeckLoading.exportLibrarySnapshot?.() || { remaining: [], all: [] }; } catch { return { remaining: [], all: [] }; }
}

// ------------------------- Buffs -------------------------------------------

function snapshotBuffs(){
  try{
    const list = RulesStore.listActiveEffectsGroupedByCard?.(mySeatSafe()) || [];
    return list;
  }catch{ return []; }
}

// ------------------------- RTC "private" handshake --------------------------
// Robust, retrying, proactive private snapshot exchange for deck + hand.

// Reuse one global inbox/cache (avoid double declarations across hot-reloads)
const __SAVE_PRIVATE_INBOX = (window.__SAVE_PRIVATE_INBOX instanceof Map)
  ? window.__SAVE_PRIVATE_INBOX
  : (window.__SAVE_PRIVATE_INBOX = new Map());

const __OPP_PRIVATE_CACHE = (window.__OPP_PRIVATE_CACHE && typeof window.__OPP_PRIVATE_CACHE === 'object')
  ? window.__OPP_PRIVATE_CACHE
  : (window.__OPP_PRIVATE_CACHE = { hand: [], deck: { remaining: [], all: [] }, saveId: null, ts: 0 });

(function installSavePrivateRecv(){
  try {
    window.RTCApply = window.RTCApply || {};
    const old = window.RTCApply.recv || null;

    window.RTCApply.recv = function(msg){
      try{
        // 1) Opponent asked me to participate in their save (pre-warm)
        if (msg?.type === 'save:request' && msg.saveId){
          const payload = {
            hand: (typeof window.exportHandSnapshot === 'function')
                    ? window.exportHandSnapshot('player') : [],
            deck: (typeof DeckLoading?.exportLibrarySnapshot === 'function')
                    ? (DeckLoading.exportLibrarySnapshot() || { remaining:[], all:[] })
                    : { remaining:[], all:[] }
          };
          try { window.rtcSend?.({ type:'save:private', saveId: msg.saveId, fromSeat: mySeatSafe(), payload }); } catch {}
          console.log('%c[RTC:send save:private (prewarm)]', 'color:#6cf', {
            saveId: msg.saveId, hand: payload.hand?.length || 0, deckRem: payload.deck?.remaining?.length || 0
          });
        }

        // 2) Direct need-private request (normal path) -> reply with payload
        if (msg?.type === 'save:need-private' && msg.saveId){
          const payload = {
            hand: (typeof window.exportHandSnapshot === 'function')
                    ? window.exportHandSnapshot('player') : [],
            deck: (typeof DeckLoading?.exportLibrarySnapshot === 'function')
                    ? (DeckLoading.exportLibrarySnapshot() || { remaining:[], all:[] })
                    : { remaining:[], all:[] }
          };
          try { window.rtcSend?.({ type:'save:private', saveId: msg.saveId, fromSeat: mySeatSafe(), payload }); } catch {}
          console.log('%c[RTC:send save:private]', 'color:#6cf', {
            saveId: msg.saveId, hand: payload.hand?.length || 0, deckRem: payload.deck?.remaining?.length || 0
          });
        }

        // 3) I receive the opponent's private snapshot payload
        if (msg?.type === 'save:private' && msg.saveId){
          const payload = msg.payload || {};
          __SAVE_PRIVATE_INBOX.set(msg.saveId, payload);
          __OPP_PRIVATE_CACHE.hand = Array.isArray(payload.hand) ? payload.hand.slice() : [];
          __OPP_PRIVATE_CACHE.deck = (payload.deck && typeof payload.deck === 'object')
            ? { ...payload.deck } : { remaining: [], all: [] };
          __OPP_PRIVATE_CACHE.saveId = msg.saveId;
          __OPP_PRIVATE_CACHE.ts = Date.now();
          console.log('%c[RTC:recv save:private]', 'color:#6f6', { saveId: msg.saveId,
            hand: __OPP_PRIVATE_CACHE.hand.length,
            deckRem: (__OPP_PRIVATE_CACHE.deck.remaining||[]).length
          });
        }
      }catch(e){
        console.warn('[Save] private recv handler error', e);
      }
      if (typeof old === 'function') return old(msg);
    };
  } catch (e) {
    console.warn('[Save] installSavePrivateRecv failed', e);
  }
})();

// Ask opponent for their private bits w/ retries + longer timeout.
// We re-send need-private every 400ms until we either receive or we hit 5s.
// If still nothing, we fall back to the last cached private payload (if any).
async function requestOpponentPrivate(saveId, theirSeat){
  const MAX_MS = 5000;
  const POKE_MS = 400;

  return await new Promise(resolve => {
    let done = false;

    // poll inbox
    const poll = setInterval(() => {
      if (__SAVE_PRIVATE_INBOX.has(saveId)){
        const payload = __SAVE_PRIVATE_INBOX.get(saveId);
        __SAVE_PRIVATE_INBOX.delete(saveId);
        clearInterval(poll);
        clearInterval(poke);
        clearTimeout(timeout);
        done = true;
        return resolve(payload || { hand: [], deck: { remaining:[], all:[] } });
      }
    }, 50);

    // periodically (re)send the request so we never lose the ask
    const poke = setInterval(() => {
      try { window.rtcSend?.({ type:'save:need-private', saveId, toSeat: theirSeat }); } catch {}
    }, POKE_MS);

    // hard timeout -> use cache if available
    const timeout = setTimeout(() => {
      if (done) return;
      clearInterval(poll);
      clearInterval(poke);
      done = true;

      // Fallback to last cached payload if it exists and isn't ancient (<= 30s)
      const stale = (Date.now() - (__OPP_PRIVATE_CACHE.ts || 0)) > 30000;
      if (!stale && __OPP_PRIVATE_CACHE.hand && __OPP_PRIVATE_CACHE.deck){
        console.warn('[Save] opponent private timed out; using cached payload');
        return resolve({
          hand: __OPP_PRIVATE_CACHE.hand.slice(),
          deck: { ...( __OPP_PRIVATE_CACHE.deck || { remaining:[], all:[] } ) }
        });
      }
      console.warn('[Save] opponent private timed out; no cache available');
      return resolve({ hand: [], deck: { remaining:[], all:[] } });
    }, MAX_MS);

    // fire first request immediately
    try { window.rtcSend?.({ type:'save:need-private', saveId, toSeat: theirSeat }); } catch {}
  });
}

// ------------------------- Supabase wiring ---------------------------------

async function getSupabase(){
  if (window.SUPABASE_READY) { try { return await window.SUPABASE_READY; } catch(e){ console.warn('[Save] SUPABASE_READY failed', e); } }
  if (window.SUPABASE) return window.SUPABASE;
  throw new Error('Supabase client not found (window.SUPABASE[_READY]).');
}

function randomSaveId(){
  return 's_' + Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,6);
}

// ------------------------- Public API --------------------------------------

export const GameSave = (() => {
  // === Private handlers used by rtc.bus.js =================================
  async function handleIncomingPrivate(msg){
    try {
      const saveId  = msg?.saveId;
      const payload = msg?.payload || { hand: [], deck: { remaining: [], all: [] } };
      if (!saveId) return;

      __SAVE_PRIVATE_INBOX.set(saveId, payload);
      __OPP_PRIVATE_CACHE.hand = Array.isArray(payload.hand) ? payload.hand.slice() : [];
      __OPP_PRIVATE_CACHE.deck = (payload.deck && typeof payload.deck === 'object')
        ? { ...payload.deck }
        : { remaining: [], all: [] };
      __OPP_PRIVATE_CACHE.saveId = saveId;
      __OPP_PRIVATE_CACHE.ts = Date.now();
    } catch (e) {
      console.warn('[GameSave.handleIncomingPrivate] failed', e, msg);
    }
  }

  // Invoked when we receive save:request (rtc.bus also pre-warms a reply there)
  async function handleIncomingSaveRequest(_msg){
    // Currently a no-op (kept for symmetry / future hooks)
    return;
  }

  // === MASTER SNAPSHOT (both seats in one row) =============================
  async function buildSnapshot({ saveId, includeExtra=true } = {}){
    const seat = mySeatSafe();
    const room = roomIdSafe();
    const otherSeat = (seat === 1 ? 2 : 1);

    // Battlefield for both seats
    const table_both = snapshotBattlefieldBothSeats();

    // Zones for both seats
    const zones = zonesBothSeats();

    // My local (legacy) bits
    const deck_self = snapshotDeck();
    const hand_self = snapshotHandOwned();
    const grave_self = zones[ seat===1 ? 'p1' : 'p2' ].graveyard || [];
    const exile_self = zones[ seat===1 ? 'p1' : 'p2' ].exile     || [];
    const table_self = (seat===1 ? table_both.p1 : table_both.p2);
    const buffs      = snapshotBuffs();

    // Ask opponent for their private bits (hand/deck) if RTC is available
    let opp_hand = [];
    let opp_deck = { remaining: [], all: [] };
    try {
      if (typeof window.rtcSend === 'function') {
        const priv = await requestOpponentPrivate(saveId || 'pending_'+Math.random().toString(36).slice(2,8), otherSeat);
        if (priv) {
          opp_hand = Array.isArray(priv.hand) ? priv.hand : [];
          opp_deck = priv.deck && typeof priv.deck === 'object' ? priv.deck : { remaining: [], all: [] };
        }
      }
    } catch (e) { console.warn('[Save] opponent private fetch failed', e); }

    // optional extra
    let extra = {};
    if (includeExtra){
      try {
        const uiDump =
          (typeof UserInterface?.dumpLiveSettings === 'function')
            ? (UserInterface.dumpLiveSettings() || {})
            : {};

        const life = {
          p1: (typeof UserInterface?.getP1 === 'function') ? UserInterface.getP1() : undefined,
          p2: (typeof UserInterface?.getP2 === 'function') ? UserInterface.getP2() : undefined
        };

        const turn =
          (typeof UserInterface?.getTurn === 'function')
            ? UserInterface.getTurn()
            : undefined;

        extra = { when: nowIso(), ui: uiDump, life, turn };
      } catch (e) {}
    }

    // Combined state for both seats in one row (schema_version:2)
    const state = {
      schema_version: 2,
      table_state: { p1: table_both.p1, p2: table_both.p2 },
      zones: {
        p1: {
          graveyard: zones.p1.graveyard,
          exile:     zones.p1.exile,
          hand:      (seat === 1) ? hand_self : opp_hand
        },
        p2: {
          graveyard: zones.p2.graveyard,
          exile:     zones.p2.exile,
          hand:      (seat === 2) ? hand_self : opp_hand
        }
      },
      decks: {
        p1: (seat === 1) ? deck_self : opp_deck,
        p2: (seat === 2) ? deck_self : opp_deck
      },
      my: {
        seat,
        deck: deck_self, hand: hand_self, graveyard: grave_self, exile: exile_self, table_state: table_self
      },
      buffs,
      extra
    };

    // Flat columns preserved for compatibility (my seat only)
    const payload = {
      save_id: saveId || randomSaveId(),
      room_id: room,
      player_seat: seat,
      player_name: playerNameSafe(),

      deck:       deck_self,
      hand:       hand_self,
      graveyard:  grave_self,
      exile:      exile_self,
      table_state: table_self,
      buffs,
      extra,

      state
    };

    return payload;
  }

  // === Write single row =====================================================
  async function writeSnapshotToDB(row){
    const sb = await getSupabase();
    const { data, error } = await sb.from('game_saves').insert({
      save_id     : row.save_id,
      room_id     : row.room_id,
      player_seat : row.player_seat,
      player_name : row.player_name,

      // legacy columns (my seat)
      deck        : row.deck,
      hand        : row.hand,
      graveyard   : row.graveyard,
      exile       : row.exile,
      table_state : row.table_state,
      buffs       : row.buffs,
      extra       : row.extra,

      // new combined blob
      state       : row.state
    }).select().single();
    if (error) throw error;
    return data;
  }

  // === Local save and (optionally) ping opponent ============================
  async function saveAndMaybePingOpponent(){
    const shared = randomSaveId();

    // ping first so the opponent is ready to answer private request
    try {
      window.rtcSend?.({ type:'save:request', saveId: shared, roomId: roomIdSafe(), fromSeat: mySeatSafe() });
      console.log('%c[RTC:send save:request]', 'color:#6cf', { saveId: shared });
    } catch(e){ console.warn('[Save] rtc send failed', e); }

    const snap = await buildSnapshot({ saveId: shared, includeExtra:true });
    console.log('[Save] built snapshot (both seats incl. hands/decks)', snap);

    const row = await writeSnapshotToDB(snap);
    console.log('[Save] wrote snapshot row (both seats)', row);

    try { window.rtcSend?.({ type:'save:ack', saveId: shared, seat: snap.player_seat }); } catch {}
    return { saveId: shared, row };
  }

  // === Respond to opponent’s ping (write same saveId) =======================
  async function handleIncomingSaveRequestPair(pkt){
    if (!pkt?.saveId) return;
    const snap = await buildSnapshot({ saveId: pkt.saveId, includeExtra:true });
    const row = await writeSnapshotToDB(snap);
    try { window.rtcSend?.({ type:'save:ack', saveId: pkt.saveId, seat: snap.player_seat }); } catch {}
    console.log('[Save] mirrored opponent request, wrote row (both seats + hands/decks)', row);
    return row;
  }

  return {
    // private exchange hooks (rtc.bus.js calls these)
    handleIncomingPrivate,
    handleIncomingSaveRequest, // currently no-op

    // main API
    buildSnapshot,
    writeSnapshotToDB,
    saveAndMaybePingOpponent,
    handleIncomingSaveRequestPair
  };
})();
