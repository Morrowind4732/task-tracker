// /modules/load.state.js
// Full game restore (load) + helpers for listing and picking snapshots.
// Works with schema_version:2 (combined both seats) and legacy flat columns.
// Restores: BOTH seats' table + zones; your hand/deck locally; pushes the
// opponent's private hand/deck to them over RTC so both clients hydrate.

import { RulesStore }    from './rules.store.js';
import { Zones }         from './zones.js';
import { DeckLoading }   from './deck.loading.js';
import { CardPlacement } from './card.placement.math.js';
import { UserInterface } from './user.interface.js';
import { restoreHandFromSnapshot } from './hand.js';

const __MOD = (import.meta?.url || 'unknown').split('/').pop();
try { window.__modTime?.(__MOD, 'start'); } catch {}

// ---------- environment + utils ----------
function mySeatSafe(){
  try { return (typeof window.mySeat==='function' ? window.mySeat() : (window.__LOCAL_SEAT||1)); }
  catch { return 1; }
}
function roomIdSafe(){ return (window.__ROOM_ID || document.querySelector('#roomInput')?.value || 'local'); }
function nowIso(){ return new Date().toISOString(); }

async function getSupabase(){
  if (window.SUPABASE_READY) { try { return await window.SUPABASE_READY; } catch(e){ console.warn('[Load] SUPABASE_READY failed', e); } }
  if (window.SUPABASE) return window.SUPABASE;
  throw new Error('Supabase client not found (window.SUPABASE[_READY]).');
}

function ensureArray(a){ return Array.isArray(a) ? a : []; }
function ensureObj(o){ return (o && typeof o==='object') ? o : {}; }
function uniqueCid(){ return 'c_' + Math.random().toString(36).slice(2,10); }

function screenToWorld(x,y){
  try{ return window._screenToWorld ? window._screenToWorld(x,y) : {wx:x, wy:y}; } catch { return {wx:x,wy:y}; }
}
function worldToScreen(wx,wy){
  try{ return window._worldToScreen ? window._worldToScreen(wx,wy) : {x:wx, y:wy}; } catch { return {x:wx,y:wy}; }
}

// ---------- seat helpers ----------
function seatKey(n){ return Number(n) === 1 ? 'p1' : 'p2'; }             // [LOAD:seat-map]
function myKey(){ return seatKey(mySeatSafe()); }
function otherSeat(){ return (mySeatSafe() === 1 ? 2 : 1); }
function otherKey(){ return seatKey(otherSeat()); }
function ownerKeyForSeat(seatNum){ return (Number(seatNum) === Number(mySeatSafe())) ? 'player' : 'opponent'; } // [LOAD:ownerKeyForSeat]

// ---------- DOM helpers ----------
function setTappedClass(img, tapped){
  try{
    if (tapped){ img.classList.add('is-tapped'); img.dataset.tapped = '1'; }
    else { img.classList.remove('is-tapped'); img.dataset.tapped = '0'; }
  }catch{}
}

function applyRulesDataset(img, rules){
  const r = rules||{};
  const f = r.front||{};
  const b = r.back ||{};
  const set = (k,v)=>{ if (v!=null) img.dataset[k]=v; };

  set('currentSide', (r.currentSide==='back')?'back':'front');

  set('typeLine', r.typeLine||'');
  set('oracle',   r.oracle||'');

  set('frontTypeLine', f.typeLine||'');
  set('frontOracle',   f.oracle  ||'');
  set('frontBaseTypes', JSON.stringify(ensureArray(f.baseTypes)));
  set('frontBaseAbilities', JSON.stringify(ensureArray(f.baseAbilities)));
  set('imgFront', f.img||'');

  set('backTypeLine', b.typeLine||'');
  set('backOracle',   b.oracle  ||'');
  set('backBaseTypes', JSON.stringify(ensureArray(b.baseTypes)));
  set('backBaseAbilities', JSON.stringify(ensureArray(b.baseAbilities)));
  set('imgBack', b.img||'');

  // Optional mirrors for convenience
  set('baseTypes', JSON.stringify(ensureArray(r.baseTypes)));
  set('baseAbilities', JSON.stringify(ensureArray(r.baseAbilities)));
}

function applyComputedAttrs(img, computed){
  const c = ensureObj(computed);
  try{
    const remote = {
      pt: c.pt || '',
      abilities: ensureArray(c.abilities),
      types: ensureArray(c.types),
      counters: ensureObj(c.counters)
    };
    img.dataset.remoteAttrs = JSON.stringify(remote);
    if (remote.pt) img.dataset.ptCurrent = remote.pt;
  }catch(e){ console.warn('[Load] applyComputedAttrs failed', e); }
}

// ---------- wipe helpers ----------
function wipeLocalSeatCards(){
  const seat = String(mySeatSafe());
  document.querySelectorAll('img.table-card[data-cid]').forEach(el=>{
    if ((el.dataset.owner||seat) === seat){ el.remove(); }
  });
  document.querySelectorAll('#handZone img.hand-card[data-cid], #handZone img.table-card[data-cid]').forEach(el=>{
    if ((el.dataset.owner||seat) === seat){ el.remove(); }
  });
}
function wipeLocalZonesAndStores(){
  try{ Zones?.resetOwnerZones?.('player'); }catch{}
  try{ RulesStore?.clearEffectsForSeat?.(mySeatSafe()); }catch{}
  try{ DeckLoading?.importLibrarySnapshot?.({ all: [], remaining: [] }); }catch{}
}

// ---------- spawn helpers ----------
function spawnTableCardFromSnapshot(card){
  // card: {cid?, owner, name, img, pos{x,y,z}, tapped, currentSide, rules, computed, tags{}}
  const owner = Number(card.owner ?? mySeatSafe());
  const name  = card.name || '';
  const img   = card.img  || '';
  const wx    = card.pos?.x ?? 0;
  const wy    = card.pos?.y ?? 0;
  const z     = Number(card.pos?.z ?? 0);

  let cid = card.cid || uniqueCid();
  let el  = null;

  if (CardPlacement?.spawnCardLocal){
    try{
      const scr = worldToScreen(wx, wy);
      const spawnedCid = CardPlacement.spawnCardLocal({ name, img, x: scr.x, y: scr.y, owner });
      cid = spawnedCid || cid;
      el = document.querySelector(`img.table-card[data-cid="${cid}"]`);
      if (el){
        el.style.zIndex = String(z);
        el.dataset.zIndex = String(z);
        el.dataset.owner = String(owner);
        el.title = name;
        el.dataset.name = name;
      }
    }catch(e){
      console.warn('[Load] spawn via CardPlacement failed, falling back', e);
    }
  }

  if (!el){
    el = document.createElement('img');
    el.className = 'table-card';
    el.src = img;
    el.dataset.cid = cid;
    el.dataset.owner = String(owner);
    el.dataset.name = name;
    el.style.position = 'absolute';
    const pt = worldToScreen(wx, wy);
    el.style.left = `${pt.x}px`;
    el.style.top  = `${pt.y}px`;
    el.style.zIndex = String(z);
    (document.getElementById('world') || document.body).appendChild(el);
  }

  try{
    applyRulesDataset(el, card.rules);
    applyComputedAttrs(el, card.computed);
    setTappedClass(el, !!card.tapped);
    if (card.currentSide==='back'){ el.dataset.currentSide = 'back'; }
    if (card.tags && typeof card.tags==='object'){
      if (card.tags.commander) el.dataset.isCommander = '1';
      if (card.tags.summoningSickness) el.dataset.hasSummoningSickness = '1';
    }
  }catch(e){ console.warn('[Load] post-apply failed', e); }

  try{ window.Badges?.refreshCard?.(el); }catch{}
  try{ window.registerCardElement?.(el); }catch{}
}

function spawnHandCardFromSnapshot(card){
  const owner = Number(card.owner ?? mySeatSafe());
  const name  = card.name || '';
  const img   = card.img  || '';
  const cid   = card.cid || uniqueCid();
  const hz = document.querySelector('.hand-zone') || document.getElementById('handZone') || document.body;

  const el = document.createElement('img');
  el.className = 'hand-card';
  el.src = img;
  el.dataset.cid = cid;
  el.dataset.owner = String(owner);
  el.dataset.name = name;

  applyRulesDataset(el, card.rules);
  applyComputedAttrs(el, card.computed);

  hz.appendChild(el);
  try{ window.registerCardElement?.(el); }catch{}
}

// ---------- zones + deck restore ----------
function restoreZonesForSeat(seatNum, graveyardArr, exileArr){                         // [LOAD:restoreZonesForSeat]
  const gy = ensureArray(graveyardArr);
  const ex = ensureArray(exileArr);
  const ownerKey = ownerKeyForSeat(seatNum);

  let usedImport = false;
  try{
    if (typeof Zones?.importOwnerZone === 'function'){
      Zones.importOwnerZone(ownerKey, 'graveyard', gy);
      Zones.importOwnerZone(ownerKey, 'exile',    ex);
      usedImport = true;
    }
  }catch(e){ console.warn('[Load] Zones.importOwnerZone failed', e); }

  if (!usedImport){
    try{
      if (ownerKey === 'player'){
        window.__RESTORE_GRAVEYARD__ = gy;
        window.__RESTORE_EXILE__     = ex;
      } else {
        window.__RESTORE_OPP_GRAVEYARD__ = gy;
        window.__RESTORE_OPP_EXILE__     = ex;
      }
    }catch{}
  }
}

function restoreDeckSnapshot(deck){
  const raw = ensureObj(deck);

  const pickArray = (...cands) => {
    for (const a of cands) if (Array.isArray(a) && a.length) return a;
    return [];
  };
  const allLike        = pickArray(raw.all, raw.library, raw.cards, raw.list, raw.deck);
  const remainingLike  = pickArray(raw.remaining, raw.left, raw.library, raw.cards, raw.list, raw.deck);

  const normCard = (c) => ({
    name: String(c?.name || ''),
    imageUrl: (c?.imageUrl || c?.img || c?.image || ''),
    typeLine: String(c?.typeLine || c?.type_line || '')
  });

  const normalized = {
    all:       allLike.map(normCard),
    remaining: remainingLike.map(normCard)
  };

  if (!normalized.all.length && !normalized.remaining.length && Array.isArray(raw) && raw.length){
    normalized.all       = raw.map(normCard);
    normalized.remaining = raw.map(normCard);
  }

  let imported = false;
  try {
    if (typeof DeckLoading?.importLibrarySnapshot === 'function') {
      DeckLoading.importLibrarySnapshot(normalized);
      imported = true;
    }
  } catch (e) {
    console.warn('[Load] DeckLoading.importLibrarySnapshot failed', e);
  }

  if (!imported) {
    try { window.__RESTORE_DECK__ = normalized; } catch {}
  }

  try {
    const libCount = DeckLoading?.state?.library?.length || 0;
    console.log('[Load] Deck library after import:', { all: normalized.all.length, remaining: normalized.remaining.length, live: libCount });
  } catch {}

  try {
    const lib = (DeckLoading?.state?.library || []);
    if (typeof window?.Zones?.refreshDeckCacheFromLibrary === 'function'){
      window.Zones.refreshDeckCacheFromLibrary(lib);
    }
  } catch (e) {
    console.warn('[Load] deck cache refresh failed', e);
  }

  try {
    if (!DeckLoading.__shimmedDraw && typeof DeckLoading?.drawOneToHand === 'function') {
      const _orig = DeckLoading.drawOneToHand.bind(DeckLoading);
      DeckLoading.drawOneToHand = function(deckEl){
        const ok = _orig(deckEl);
        if (ok) return ok;

        const lib = DeckLoading?.state?.library || [];
        if (Array.isArray(lib) && lib.length) {
          const c = lib.shift();
          try { window.flyDrawToHand?.({ name: c?.name || '', imageUrl: c?.imageUrl || '' }, deckEl || null); } catch {}
          try { window.dispatchEvent(new CustomEvent('deckloading:changed')); } catch {}
          console.log('[Load][shim] Manual draw fallback fired');
          return true;
        }
        return false;
      };
      DeckLoading.__shimmedDraw = true;
    }
  } catch (e) {
    console.warn('[Load] draw shim install failed', e);
  }
}

// ---------- extra ----------
function restoreBuffsSnapshot(buffs){
  const seat = mySeatSafe();
  const list = ensureArray(buffs);
  try{
    if (typeof RulesStore?.replaceAllEffectsForSeat === 'function'){
      RulesStore.replaceAllEffectsForSeat(seat, list);
      return;
    }
  }catch(e){ console.warn('[Load] replaceAllEffectsForSeat failed', e); }

  try{
    RulesStore?.clearEffectsForSeat?.(seat);
    list.forEach(group=>{
      if (Array.isArray(group?.effects)){
        group.effects.forEach(eff=> RulesStore?.addEffect?.(eff));
      } else if (group && typeof group==='object'){
        RulesStore?.addEffect?.(group);
      }
    });
  }catch(e){ console.warn('[Load] fallback addEffect failed', e); }
}

function restoreExtra(extra){
  const ex = ensureObj(extra);

  try{
    if (ex.ui?.appliedCssVars && typeof window?.UserInterface?.applyCssVarsFromDump === 'function'){
      UserInterface.applyCssVarsFromDump(ex.ui.appliedCssVars);
    }
  }catch{}

  try{
    const p1 = ex.life?.p1, p2 = ex.life?.p2;
    if (p1 && typeof UserInterface?.setP1 === 'function') UserInterface.setP1(p1);
    if (p2 && typeof UserInterface?.setP2 === 'function') UserInterface.setP2(p2);
  }catch{}

  try{
    if (ex.turn && typeof UserInterface?.setTurn === 'function'){
      UserInterface.setTurn(ex.turn);
    }
  }catch{}
}

// ---------- state coalescer ----------
function coalesceStateFromRow(row){                                                     // [LOAD:coalesce]
  if (row?.state && typeof row.state === 'object'){
    const s = row.state;
    const tBoth   = s.table_state || s.table || { p1:[], p2:[] };
    const zBoth   = s.zones || { p1:{graveyard:[], exile:[], hand:[]}, p2:{graveyard:[], exile:[], hand:[]} };
    const dBoth   = s.decks || { p1:{all:[], remaining:[]}, p2:{all:[], remaining:[]} };

    const mk = myKey();
    const ok = otherKey();

    return {
      schema_version: 2,
      table_both : { p1: ensureArray(tBoth.p1), p2: ensureArray(tBoth.p2) },
      zones_both : {
        p1: { graveyard: ensureArray(zBoth.p1?.graveyard), exile: ensureArray(zBoth.p1?.exile), hand: ensureArray(zBoth.p1?.hand) },
        p2: { graveyard: ensureArray(zBoth.p2?.graveyard), exile: ensureArray(zBoth.p2?.exile), hand: ensureArray(zBoth.p2?.hand) }
      },
      decks_both : {
        p1: ensureObj(dBoth.p1),
        p2: ensureObj(dBoth.p2)
      },

      // perspective (this client)
      deck      : ensureObj(dBoth[mk]),
      hand      : ensureArray(zBoth[mk]?.hand),
      graveyard : ensureArray(zBoth[mk]?.graveyard),
      exile     : ensureArray(zBoth[mk]?.exile),
      table     : ensureArray(tBoth[mk]),

      buffs     : ensureArray(row?.buffs),
      extra     : ensureObj(row?.extra)
    };
  }

  // legacy flat
  return {
    deck      : ensureObj(row?.deck),
    hand      : ensureArray(row?.hand),
    graveyard : ensureArray(row?.graveyard),
    exile     : ensureArray(row?.exile),
    table     : ensureArray(row?.table ?? row?.table_state),
    buffs     : ensureArray(row?.buffs),
    extra     : ensureObj(row?.extra)
  };
}

// ---------- main apply ----------
async function applyRow(row, { wipe=true } = {}){                                       // [LOAD:applyRow]
  if (!row) throw new Error('No row to load.');

  const state = coalesceStateFromRow(row);
  console.log('%c[Load] applying snapshot', 'color:#6f6', { at: nowIso(), row, state });

  if (wipe){
    wipeLocalSeatCards();
    wipeLocalZonesAndStores();
  }

  // Deck (mine)
  restoreDeckSnapshot(state.deck);

  // Mark deck-zone visually + ownership (mine)
  try {
    const deckZone =
      document.getElementById('pl-deck') ||
      document.querySelector('.deck-zone.player') ||
      document.querySelector('.deck-zone[data-owner="player"]') ||
      document.querySelector('[data-zone="deck"][data-owner="player"]');
    if (deckZone){
      deckZone.dataset.hasDeck = '1';
      deckZone.classList.add('has-deck');
      deckZone.dataset.owner = String(mySeatSafe());
      try { Zones?.markDeckPresent?.(deckZone, true); } catch {}
      try { Zones?.sendDeckVisual?.(true); } catch {}
      if (getComputedStyle(deckZone).position === 'static') deckZone.style.position = 'relative';
    }
  } catch (e) { console.warn('[Load] deck visual ensure failed', e); }

  // Hand (mine)
  try {
    restoreHandFromSnapshot(ensureArray(state.hand), { append: false });
  } catch (e) {
    console.warn('[Load] restoreHandFromSnapshot failed, falling back to per-card spawn', e);
    ensureArray(state.hand).forEach(spawnHandCardFromSnapshot);
  }

  // Zones (both seats locally, if v2)
  if (state.schema_version === 2){
    restoreZonesForSeat(1, state.zones_both.p1.graveyard, state.zones_both.p1.exile);
    restoreZonesForSeat(2, state.zones_both.p2.graveyard, state.zones_both.p2.exile);
  } else {
    restoreZonesForSeat(mySeatSafe(), state.graveyard, state.exile);
  }

  // Battlefield (both seats)
  if (state.schema_version === 2){
    ensureArray(state.table_both.p1).forEach(spawnTableCardFromSnapshot);
    ensureArray(state.table_both.p2).forEach(spawnTableCardFromSnapshot);
  } else {
    ensureArray(state.table).forEach(spawnTableCardFromSnapshot);
  }

  // Buffs
  restoreBuffsSnapshot(state.buffs);

  // Extras (UI/life/turn)
  restoreExtra(state.extra);

  // UI nudges
  try{ window.Badges?.refreshAll?.(); }catch{}
  try{ window.Tooltips?.refreshAll?.(); }catch{}

  // Push opponent their private pieces so their client hydrates immediately
  try {
    if (state.schema_version === 2 && (typeof window.rtcSend === 'function' || window.peer?.send)) {
      const send = window.rtcSend || window.peer?.send?.bind(window.peer);
      const ok   = otherKey();
      const handOther = ensureArray(state.zones_both[ok]?.hand);
      const deckOther = ensureObj(state.decks_both[ok]);

      if (handOther.length){
        send({ type:'hand:replace', toSeat: otherSeat(), hand: handOther });
      }
      if ((deckOther.remaining?.length || deckOther.all?.length)){
        send({ type:'deck:replace', toSeat: otherSeat(), deck: deckOther });
      }
      console.log('%c[RTC:send load→private]', 'color:#6cf', {
        toSeat: otherSeat(),
        handCount: handOther.length,
        deckRem: deckOther?.remaining?.length || 0
      });
    }
  } catch (e) {
    console.warn('[Load] RTC private push failed', e);
  }

  console.log('%c[Load] done', 'color:#6f6');
  return true;
}

// ---------- fetching ----------
async function listSaves({ roomId=roomIdSafe(), limit=50 } = {}){
  const sb = await getSupabase();
  const { data, error } = await sb
    .from('game_saves')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function loadLatestForRoom({ roomId=roomIdSafe(), wipe=true } = {}){
  const rows = await listSaves({ roomId, limit: 1 });
  if (!rows.length) throw new Error(`No saves for room_id="${roomId}"`);
  return applyRow(rows[0], { wipe });
}

async function loadBySaveId(saveId, { wipe=true } = {}){
  if (!saveId) throw new Error('saveId required');
  const sb = await getSupabase();
  const { data, error } = await sb
    .from('game_saves')
    .select('*')
    .eq('save_id', saveId)
    .order('player_seat', { ascending: true });
  if (error) throw error;
  if (!data || !data.length) throw new Error(`No rows for save_id="${saveId}"`);

  let row = data.find(r => Number(r.player_seat) === Number(mySeatSafe())) || data[0];
  return applyRow(row, { wipe });
}

async function promptAndLoadLatest(){
  try{
    const ok = confirm('Load the most recent save for this room?');
    if (!ok) return false;
    await loadLatestForRoom({ wipe:true });
    alert('Loaded latest save.');
    return true;
  }catch(e){
    console.error('[Load] promptAndLoadLatest error', e);
    alert('Failed to load: ' + (e?.message || e));
    return false;
  }
}

export const GameLoad = {
  // fetch
  listSaves,
  loadLatestForRoom,
  loadBySaveId,

  // apply single row (already fetched)
  applyRow,

  // small UX helper
  promptAndLoadLatest
};

try { window.__modTime?.(__MOD, 'end'); } catch {}
