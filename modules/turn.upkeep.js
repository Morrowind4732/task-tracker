// modules/turn.upkeep.js
// Centralized turn/phase state + End Turn handling + minimal RTC glue
// + Turn Metrics (per-turn tallies) + Battlefield Snapshot (DOM scan)
// + Granular tapped breakdowns by type / subtype / color, per controller
// + NEW: flat key export (mine/opp × tapped/untapped × type/subtype/color).

import { UserInterface } from './user.interface.js';

const Phase = Object.freeze({
  UNTAP: 'untap',
  UPKEEP: 'upkeep',
  DRAW: 'draw',
  MAIN1: 'main1',
  COMBAT: 'combat',
  MAIN2_ENDING: 'main2_ending'
});

// -----------------------------
// Internal state
// -----------------------------
const _S = {
  activeSeat: 1,
  phase: Phase.UNTAP,
  turn: 1,
  txid: 0,
  endStepFired: false
};

// -----------------------------
// Per-turn tallies
// -----------------------------
const _Tallies = {
  bySeat: { 1: freshSeatTallies(), 2: freshSeatTallies() },
  countersPlaced: {},
  tokensCreated: {},
  exiles: 0,
  graves: 0,     // ← NEW
  returns: 0,

  tutors: 0,
  shuffles: 0
};

function freshSeatTallies(){
  return {
    draws: 0,
    casts: 0,
    castsByType: {},
    castsByColor: {},
    castsByMVBucket: {},
    namesPlayed: [],
        taps: 0,
    untaps: 0,
    landsPlayed: 0,   // ← NEW
    lifegain: 0,

    lifeloss: 0,
    netLife: 0,
    scries: 0,
    surveils: 0,
    investigates: 0,
    attackersDeclared: 0,
    blockersDeclared: 0
  };
}

// -----------------------------
// Snapshot shape (DOM scan)
// -----------------------------
let _Snapshot = freshSnapshot();

function freshSnapshot(){
  return {
    total: 0,
    byController: { 1: 0, 2: 0 },

    // coarse aggregates
    byType: {},
    byCreatureSubtype: {},
    byColor: {},              // W/U/B/R/G/C/Multicolor
    tapped: { tapped: 0, untapped: 0 },
    tokens: { token: 0, nontoken: 0 },

    // extras
    planeswalkers: { count: 0, totalLoyalty: 0, activatedThisTurn: 0 },
    landsByColorProduced: {},
    creaturesPTBuckets: { "1/1":0, "2/2":0, "3/3":0, "4/4":0, "5+":0 },

    // per-controller granular
    tappedBreakdown: {
      '1': { all:{tapped:0,untapped:0}, byType:{}, bySubtype:{}, byColor:{} },
      '2': { all:{tapped:0,untapped:0}, byType:{}, bySubtype:{}, byColor:{} }
    },

    // optional estimation if you tag data-playTurn
    estimatedCastsThisTurn: { 1:0, 2:0 },

    // NEW: flat key dump (filled by buildFlatCounts)
    flat: { mine:{}, opp:{} }
  };
}

// -----------------------------
// Small utils
// -----------------------------
function fire(evt, detail={}){ try{ window.dispatchEvent(new CustomEvent(evt,{detail})) }catch{} }
function mySeatNum(){ try{ return Number(typeof window.mySeat==='function'?window.mySeat():1) }catch{ return 1 } }
function seatKey(seat){ return (Number(seat)===2?2:1) }
function inc(obj, key, by=1){ obj[key]=(obj[key]||0)+by; return obj[key]; }
function addTapBin(bin, key, isTapped){
  if (!bin[key]) bin[key] = { tapped:0, untapped:0 };
  if (isTapped) bin[key].tapped++; else bin[key].untapped++;
}
function _broadcastPhase(){
  try{ (window.rtcSend || window.peer?.send)?.({ type:'phase:set', seat:_S.activeSeat, phase:_S.phase, txid:_S.txid }); }catch{}
}
function normKey(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
}

// Color extraction with multiple fallbacks
function extractColorsFromEl(el){
  try {
    if (el.dataset.colors){
      const a = JSON.parse(el.dataset.colors);
      if (Array.isArray(a) && a.length) return dedupeLetters(a.map(String));
    }
  } catch {}
  try {
    if (el.dataset.colorIdentity){
      const a = JSON.parse(el.dataset.colorIdentity);
      if (Array.isArray(a) && a.length) return dedupeLetters(a.map(String));
    }
  } catch {}
  const src = (el.dataset.manaCost || '') + ' ' + (el.dataset.oracle || '');
  const hits = [...src.matchAll(/\{([WUBRGC])\}/gi)].map(m=>m[1].toUpperCase());
  if (hits.length) return dedupeLetters(hits);

  const orc = (el.dataset.oracle || '').toLowerCase();
  const guess = [];
  if (/\bwhite mana\b/.test(orc)) guess.push('W');
  if (/\bblue mana\b/.test(orc))  guess.push('U');
  if (/\bblack mana\b/.test(orc)) guess.push('B');
  if (/\bred mana\b/.test(orc))   guess.push('R');
  if (/\bgreen mana\b/.test(orc)) guess.push('G');
  return dedupeLetters(guess);
}
function dedupeLetters(arr){
  const ok = ['W','U','B','R','G','C'];
  const out = [];
  for (const x of arr){
    const u = String(x).toUpperCase();
    if (ok.includes(u) && !out.includes(u)) out.push(u);
  }
  return out;
}
const COLOR_WORD = { W:'white', U:'blue', B:'black', R:'red', G:'green', C:'colorless', Mono:'monocolor', Multi:'multicolor' };

// -----------------------------
// Phase machine
// -----------------------------
function _enterPhase(next, meta={}){
  if (!next || _S.phase===next) return;

  const prev = _S.phase;
  _S.phase = next;
  _S.txid++;

  if (next===Phase.UNTAP && _S.activeSeat===mySeatNum()){
    _resetTalliesForNewTurn();
  }

  try{
    const UI = UserInterface;
    if (UI && UI._STATE){
      if (_S.activeSeat === UI._STATE.seat) UI._markAttackerUI();
      else UI._markDefenderUI();
    }
  }catch{}

  fire(`phase:exit:${prev}`, {prev,next,...meta});
  fire(`phase:enter:${next}`, {prev,next,...meta});

  switch(next){
    case Phase.UNTAP:
      _autoUntapEligible();
      _enterPhase(Phase.UPKEEP, {reason:'untap-complete'});
      break;
    case Phase.UPKEEP:
      _S.endStepFired = false;
      break;
    case Phase.DRAW:
      break;
    case Phase.MAIN1:
      break;
    case Phase.COMBAT:
      break;
    case Phase.MAIN2_ENDING:
      if (!_S.endStepFired){
        _S.endStepFired = true;
        fire('phase:beginningOfEndStep', { seat:_S.activeSeat, turn:_S.turn, txid:_S.txid });
      }
      break;
  }

  _broadcastPhase();
}

function _autoUntapEligible(){
  const mine = String(mySeatNum());
  const list = Array.from(document.querySelectorAll('img.table-card[data-cid]'));
  for (const el of list){
    const owner = (el.dataset.ownerCurrent ?? el.dataset.owner ?? '').toString().match(/\d+/)?.[0] || '';
    if (owner !== mine) continue;
    if (el.dataset.neverUntaps === '1') continue;
    if (el.dataset.skipUntapNext === '1'){ delete el.dataset.skipUntapNext; continue; }

    const isTapped = el.dataset.tapped === '1' || el.classList.contains('is-tapped');
    if (isTapped){
      try{
        el.dataset.tapped = '0';
        el.style.rotate = '0deg';
        el.classList.remove('is-tapped');
      }catch{}
      try{
        const ownerSeat = Number(owner || mine);
        (window.rtcSend || window.peer?.send)?.({ type:'tap', cid:el.dataset.cid, tapped:false, owner:ownerSeat, ownerCurrent:ownerSeat });
      }catch{}
      recordUntapInternal(Number(owner||mine), el.dataset.cid);
    }
  }
  try{ window.CardPlacement?.clearSummoningSicknessForMyBoard?.(); }catch{}
}

// -----------------------------
// Public actions
// -----------------------------
function endTurnFrom(seatWhoEnded){
  const UI = UserInterface;
  const stateUI = UI?._STATE;
  const ended = Number(seatWhoEnded)||1;
  const nextSeat = (ended===1)?2:1;

  if (!_S.endStepFired){
    _S.endStepFired = true;
    fire('phase:beginningOfEndStep',{seat:_S.activeSeat,turn:_S.turn,txid:_S.txid});
  }
  _runCleanup();

  _S.turn = (Number(_S.turn)||1) + 1;
  _S.activeSeat = nextSeat;

  if (stateUI){
    stateUI.turn = _S.turn;
    stateUI.activeSeat = _S.activeSeat;
    stateUI.playerLabel = (nextSeat===1)?'Player 1':'Player 2';
    try{ UI.setTurn(stateUI.turn, stateUI.playerLabel); }catch{}
    if (stateUI.activeSeat===stateUI.seat) UI._markAttackerUI(); else UI._markDefenderUI();
  }

  try{
    (window.rtcSend || window.peer?.send)?.({
      type:'turn_pass',
      turn:_S.turn,
      activeSeat:_S.activeSeat,
      playerLabel:(nextSeat===1)?'Player 1':'Player 2'
    });
  }catch(err){ console.warn('[TurnUpkeep] rtcSend turn_pass failed', err); }
}

function clickDraw(){ if (_S.phase!==Phase.UPKEEP) return; _enterPhase(Phase.DRAW,{reason:'player-clicked-draw'}); }
function finishDraw(){ if (_S.phase!==Phase.DRAW) return; _enterPhase(Phase.MAIN1,{reason:'finish-draw'}); }
function clickCombat(){
  if (_S.phase!==Phase.MAIN1) return;
  _enterPhase(Phase.COMBAT,{reason:'player-pressed-combat'});
  try{ window.Battle?.beginAttackSelection?.(); }catch{}
}
function onCombatFinishedFromRTC(msg){ if (_S.phase!==Phase.COMBAT) return; _enterPhase(Phase.MAIN2_ENDING,{reason:'combat:end'}); }

// -----------------------------
// RTC entry points
// -----------------------------
function applyTurnPassFromRTC(msg){
  const seatFromMsg = Number(msg?.activeSeat)||1;
  _S.activeSeat = seatFromMsg;
  _S.turn = Number(msg?.turn)||_S.turn;
  if (seatFromMsg===mySeatNum()) _enterPhase(Phase.UNTAP,{reason:'turn_pass'});
  else _enterPhase(Phase.MAIN2_ENDING,{reason:'their-turn-idle'});
}
function applyPhaseSetFromRTC(msg){
  try{
    const seat = Number(msg?.seat);
    const phase = String(msg?.phase||'');
    const txid  = Number(msg?.txid||0);
    if (txid && txid < _S.txid) return;

    if (seat !== mySeatNum()){
      // Mirror authoritative seat + phase from remote
      _S.activeSeat = Number.isFinite(seat) ? seat : _S.activeSeat;
      _S.phase      = phase;
      _S.txid       = txid || _S.txid;

      fire(`phase:mirror:${phase}`, { seat:_S.activeSeat, phase, txid });

      // If THEY just entered their end step on their machine, mirror the
      // "beginning of end step" + do our own cleanup so both sides drop EOT.
      if (phase === Phase.MAIN2_ENDING) {
        if (!_S.endStepFired){
          _S.endStepFired = true;
          // 🔴 CRITICAL: announce end step with the REMOTE seat that is ending the turn
          fire('phase:beginningOfEndStep', { seat:_S.activeSeat, turn:_S.turn, txid:_S.txid });
        }
        _runCleanup();
      }
    }
  }catch(e){
    console.warn('[TurnUpkeep] applyPhaseSetFromRTC failed', e);
  }
}



// -----------------------------
// Cleanup stub
// -----------------------------
// CTRL-F anchor: [TU:cleanup]
function _runCleanup(){
  try{
    // 1) Clear EOT effects for the seat whose turn is ending
    const seat = Number(_S.activeSeat) || mySeatNum();
    try { window.RulesStore?.clearEOT?.(seat); } catch {}

    // 2) Refresh visuals (badges/tooltips) so the removals are visible immediately
    try {
      document.querySelectorAll('img.table-card[data-cid]').forEach(n => {
        const cid = n.dataset.cid;
        window.Badges?.refreshFor?.(cid);
        window.Tooltip?.refreshFor?.(cid);
      });
    } catch {}

    // 3) Any additional end-step housekeeping you want to add later
    // window.RulesStore?.clearMarkedDamageForSeat?.(seat);
    // window.Hand?.discardDownToMax?.(seat);

    // 4) Fire a standard cleanup event for any other subscribers
    fire('phase:cleanup', { seat, turn:_S.turn });
  }catch(e){
    console.warn('[TurnUpkeep] cleanup error', e);
  }
}


// -----------------------------
// Tallies recorders
// -----------------------------
function _resetTalliesForNewTurn(){
  _Tallies.bySeat[1] = freshSeatTallies();
  _Tallies.bySeat[2] = freshSeatTallies();
  _Tallies.countersPlaced = {};
  _Tallies.tokensCreated  = {};
  _Tallies.exiles=0; _Tallies.returns=0; _Tallies.tutors=0; _Tallies.shuffles=0;
}
function bump(path, by=1){
  try{
    const parts = String(path).split('.');
    let cur = _Tallies;
    for (let i=0;i<parts.length-1;i++) cur = cur[parts[i]];
    const leaf = parts[parts.length-1];
    cur[leaf] = (cur[leaf]||0) + by;
  }catch(e){ console.warn('[TurnUpkeep.bump] failed', path, e); }
}
function recordDraw(seat, n=1){ _Tallies.bySeat[seatKey(seat)].draws += Math.max(1,n|0); }
function recordCast({ seat, cid, name, typeLine='', colorsJson='[]', mv=null }={}){
  const s = seatKey(seat);
  _Tallies.bySeat[s].casts++;

  const majorType = (String(typeLine).split('—')[0]||'').split(/\s+/).find(t=>/^(Creature|Instant|Sorcery|Artifact|Enchantment|Planeswalker|Battle|Land)$/i.test(t)) || 'Unknown';
  inc(_Tallies.bySeat[s].castsByType, majorType, 1);

  let cols=[]; try{ cols = JSON.parse(colorsJson||'[]'); }catch{} if (!Array.isArray(cols)) cols=[];
  if (cols.length===0) inc(_Tallies.bySeat[s].castsByColor,'C',1);
  else cols.forEach(c=>inc(_Tallies.bySeat[s].castsByColor,String(c),1));

  const mvn = Number(mv);
  const bucket = Number.isFinite(mvn) ? (mvn<=1?'0-1':mvn<=3?'2-3':mvn<=5?'4-5':'6+') : 'unknown';
  inc(_Tallies.bySeat[s].castsByMVBucket, bucket, 1);

  _Tallies.bySeat[s].namesPlayed.push({ cid:cid||'', name:name||'(unknown)', typeLine, colors:cols, mv:Number.isFinite(mvn)?mvn:null, time:Date.now() });
}
function recordTap(seat, cid){ recordTapInternal(seatKey(seat), cid); }
function recordTapInternal(s, cid){ _Tallies.bySeat[s].taps++; }
function recordUntap(seat, cid){ recordUntapInternal(seatKey(seat), cid); }
function recordUntapInternal(s, cid){ _Tallies.bySeat[s].untaps++; }
function recordLife(seat, {gain=0,loss=0}={}){
  const s = seatKey(seat);
  if (gain) _Tallies.bySeat[s].lifegain += Math.abs(gain|0);
  if (loss) _Tallies.bySeat[s].lifeloss += Math.abs(loss|0);
  _Tallies.bySeat[s].netLife = _Tallies.bySeat[s].lifegain - _Tallies.bySeat[s].lifeloss;
}
function recordCounter(kind, delta=1){ inc(_Tallies.countersPlaced, String(kind), delta); }
function recordToken(kind, delta=1){ inc(_Tallies.tokensCreated , String(kind), delta); }
function recordScry(seat, n){ _Tallies.bySeat[seatKey(seat)].scries += Math.max(1,n|0); }
function recordSurveil(seat, n){ _Tallies.bySeat[seatKey(seat)].surveils += Math.max(1,n|0); }
function recordInvestigate(seat, n){ _Tallies.bySeat[seatKey(seat)].investigates += Math.max(1,n|0); }
// --- NEW: land plays (not counted as casts) ---
function noteLandPlay({ seat } = {}){
  const s = seatKey(seat);
  _Tallies.bySeat[s].landsPlayed += 1;
}

// --- NEW: zone sends (dragged to grave/exile) ---
function noteExile(){ _Tallies.exiles += 1; }
function noteGrave(){ _Tallies.graves += 1; }

function tallyAttackers(n){ _Tallies.bySeat[seatKey(_S.activeSeat)].attackersDeclared += (n|0); }
function tallyBlockers(n){  _Tallies.bySeat[seatKey(_S.activeSeat)].blockersDeclared  += (n|0); }
function getTallies(){ return JSON.parse(JSON.stringify(_Tallies)); }

// Bridge called from CardPlacement when a card is spawned from HAND (origin:'hand').
// payload: { seat, cid, name, typeLine, colors:[], manaCostRaw?, mv? }
function noteCast(payload = {}) {
  const s   = seatKey(payload.seat ?? mySeatNum());
  const cid = String(payload.cid || '');

  // Mark the DOM element with the turn it entered (for estimatedCastsThisTurn).
  try {
    if (cid) {
      const el = document.querySelector(`img.table-card[data-cid="${cid}"]`);
      if (el) el.dataset.playTurn = String(_S.turn);
    }
  } catch {}

  // Normalize colors to the JSON string recordCast expects.
  const colorsArr = Array.isArray(payload.colors) ? payload.colors : [];
  const colorsJson = JSON.stringify(colorsArr);

  // Pass through to the canonical recorder.
  recordCast({
    seat: s,
    cid,
    name: String(payload.name || ''),
    typeLine: String(payload.typeLine || ''),
    colorsJson,
    mv: (payload.mv != null ? Number(payload.mv) : null)
  });
}


// -----------------------------
// DOM Snapshot (granular)
// -----------------------------
function recomputeSnapshot(){
  const snap = freshSnapshot();
  const mySeat = String(mySeatNum());

  const cards = Array.from(document.querySelectorAll('img.table-card[data-cid]'));
  for (const el of cards){
    const owner = (el.dataset.ownerCurrent ?? el.dataset.owner ?? '').toString().match(/\d+/)?.[0] || '1';
    const controller = owner==='1'?'1':'2';
    const typeLine = (el.dataset.typeLine || el.getAttribute('data-type') || '').trim();
    const oracle   = (el.dataset.oracle || '').trim();
    const tapped   = (el.dataset.tapped==='1' || el.classList.contains('is-tapped'));
    const isToken  = (el.dataset.token==='1' || /token/i.test(typeLine));
    const power    = Number(el.dataset.power);
    const toughness= Number(el.dataset.toughness);
    const colors   = extractColorsFromEl(el);
    const majorTypes = ['Creature','Instant','Sorcery','Artifact','Enchantment','Planeswalker','Battle','Land'];

    // Totals
    snap.total++;
    inc(snap.byController, controller, 1);
    if (tapped) snap.tapped.tapped++; else snap.tapped.untapped++;
    if (isToken) snap.tokens.token++; else snap.tokens.nontoken++;

    // byType
    const firstSeg = (typeLine.split('—')[0]||'').trim();
    const foundMajor = majorTypes.filter(t=>new RegExp(`\\b${t}\\b`,'i').test(firstSeg));
    if (foundMajor.length) foundMajor.forEach(t=>inc(snap.byType, t, 1));
    else inc(snap.byType, 'Unknown', 1);

    // byColor
    if (colors.length===0) inc(snap.byColor,'C',1);
    else if (colors.length===1) inc(snap.byColor, colors[0], 1);
    else inc(snap.byColor,'Multicolor',1);

    // creature subtypes
    if (/Creature\b/i.test(typeLine) && typeLine.includes('—')){
      const right = typeLine.split('—')[1]||'';
      right.split(/\s|,|\//).map(s=>s.trim()).filter(Boolean).forEach(sub=>{
        inc(snap.byCreatureSubtype, sub, 1);
      });
    }

    // planeswalkers
    if (/Planeswalker\b/i.test(typeLine)){
      snap.planeswalkers.count++;
      const loy = Number(el.dataset.loyalty);
      if (Number.isFinite(loy)) snap.planeswalkers.totalLoyalty += loy;
      if (el.dataset.loyaltyUsedThisTurn==='1') snap.planeswalkers.activatedThisTurn++;
    }

    // lands production heuristics
    if (/Land\b/i.test(typeLine)){
      if (colors.length){
        colors.forEach(c=>inc(snap.landsByColorProduced, c, 1));
      } else {
        ['W','U','B','R','G','C'].forEach(sym=>{
          if (new RegExp(`\\{${sym}\\}`, 'i').test(oracle)) inc(snap.landsByColorProduced, sym, 1);
        });
      }
    }

    // PT buckets (FIX: avoid TDZ by not referencing t before init)
if (/Creature\b/i.test(typeLine)){
  const p   = Number.isFinite(power)     ? power     : NaN;
  const tou = Number.isFinite(toughness) ? toughness : NaN;
  if (Number.isFinite(p) && Number.isFinite(tou)){
    const key =
      (p===1 && tou===1) ? '1/1' :
      (p===2 && tou===2) ? '2/2' :
      (p===3 && tou===3) ? '3/3' :
      (p===4 && tou===4) ? '4/4' : '5+';
    inc(snap.creaturesPTBuckets, key, 1);
  }
}


    // per-controller breakdowns
    const bucket = snap.tappedBreakdown[controller];
    if (tapped) bucket.all.tapped++; else bucket.all.untapped++;

    const majors = foundMajor.length ? foundMajor : ['Unknown'];
    majors.forEach(t => addTapBin(bucket.byType, t, tapped));

    if (/Creature\b/i.test(typeLine) && typeLine.includes('—')){
      const right = typeLine.split('—')[1]||'';
      right.split(/\s|,|\//).map(s=>s.trim()).filter(Boolean).forEach(sub=>{
        addTapBin(bucket.bySubtype, sub, tapped);
      });
    }

    if (colors.length===0) addTapBin(bucket.byColor,'C',tapped);
    else if (colors.length===1){
      addTapBin(bucket.byColor, colors[0], tapped);
      addTapBin(bucket.byColor, 'Mono', tapped);
    } else {
      colors.forEach(c=>addTapBin(bucket.byColor, c, tapped));
      addTapBin(bucket.byColor, 'Multi', tapped);
    }

    if (el.dataset.playTurn && Number(el.dataset.playTurn) === _S.turn){
      inc(snap.estimatedCastsThisTurn, controller, 1);
    }
  }

  // >>> NEW: build flat keys per request
  buildFlatCounts(snap, mySeat);

  _Snapshot = snap;
  return getSnapshot();
}

function buildFlatCounts(snap, mySeat){
  const whoMine = String(mySeat)==='1' ? '1' : '2';
  const whoOpp  = whoMine==='1' ? '2' : '1';

  snap.flat.mine = {};
  snap.flat.opp  = {};

  const mapOne = (label, dest, tb) => {
    // rollups
    dest[`${label}_on_field_tapped`]   = tb.all.tapped|0;
    dest[`${label}_on_field_untapped`] = tb.all.untapped|0;

    // byType
    for (const [typ, cnts] of Object.entries(tb.byType)){
      const key = normKey(typ);
      dest[`${label}_on_field_tapped_${key}`]   = cnts.tapped|0;
      dest[`${label}_on_field_untapped_${key}`] = cnts.untapped|0;
    }
    // bySubtype
    for (const [sub, cnts] of Object.entries(tb.bySubtype)){
      const key = normKey(sub);
      dest[`${label}_on_field_tapped_${key}`]   = cnts.tapped|0;
      dest[`${label}_on_field_untapped_${key}`] = cnts.untapped|0;
    }
    // byColor (translate codes to words)
    for (const [c, cnts] of Object.entries(tb.byColor)){
      const word = COLOR_WORD[c] || normKey(c);
      dest[`${label}_on_field_tapped_${word}`]   = cnts.tapped|0;
      dest[`${label}_on_field_untapped_${word}`] = cnts.untapped|0;
    }
  };

  mapOne('mine', snap.flat.mine, snap.tappedBreakdown[whoMine]);
  mapOne('opp',  snap.flat.opp,  snap.tappedBreakdown[whoOpp]);

  // Also include absolute counts visible on board for convenience
  snap.flat.mine.mine_on_field = snap.byController[whoMine]|0;
  snap.flat.opp.opp_on_field   = snap.byController[whoOpp]|0;
}

function getSnapshot(){ return JSON.parse(JSON.stringify(_Snapshot)); }

// -----------------------------
// State getter
// -----------------------------
function state(){ return { activeSeat:_S.activeSeat, phase:_S.phase, turn:_S.turn, txid:_S.txid }; }

// -----------------------------
// Debug (console)
// -----------------------------
function debug(){
  const snap = recomputeSnapshot();
  const tall = getTallies();
  const st   = state();
  try{
    console.group('%c[TurnUpkeep DEBUG]','color:#6bf;font-weight:bold');
    console.log('State:', st);

    console.table({
      total_on_field: snap.total,
      mine_on_field : snap.byController[String(mySeatNum())]||0,
      opp_on_field  : snap.byController[String(mySeatNum()===1?2:1)]||0,
      tapped: snap.tapped.tapped,
      untapped: snap.tapped.untapped
    });

    console.log('By Type:', snap.byType);
    console.log('By Color:', snap.byColor);
    console.log('Creature Subtypes (top 12):',
      Object.fromEntries(Object.entries(snap.byCreatureSubtype).sort((a,b)=>b[1]-a[1]).slice(0,12)));

    console.group('Tapped Breakdown — Mine');  console.log(snap.tappedBreakdown[String(mySeatNum())]); console.groupEnd();
    console.group('Tapped Breakdown — Opp');   console.log(snap.tappedBreakdown[String(mySeatNum()===1?2:1)]); console.groupEnd();

    console.group('Flat keys (mine, sample 20):');
    console.log(Object.fromEntries(Object.entries(snap.flat.mine).slice(0,20)));
    console.groupEnd();

    console.group('Per-turn Tallies');
    ['1','2'].forEach(k=>{
      const s = tall.bySeat[k];
      console.log(`Seat ${k}`, {
        draws:s.draws, casts:s.casts,
        taps:s.taps, untaps:s.untaps,
        landsPlayed:s.landsPlayed,

        lifegain:s.lifegain, lifeloss:s.lifeloss, netLife:s.netLife,
        scries:s.scries, surveils:s.surveils, investigates:s.investigates,
        attackersDeclared:s.attackersDeclared, blockersDeclared:s.blockersDeclared
      });
      console.log('  castsByType:', s.castsByType);
      console.log('  castsByColor:', s.castsByColor);
      console.log('  castsByMVBucket:', s.castsByMVBucket);
      console.log(`  namesPlayed (${s.namesPlayed.length}):`, s.namesPlayed);
    });
    console.log('Global countersPlaced:', tall.countersPlaced);
    console.log('Global tokensCreated:',  tall.tokensCreated);
    console.log('Global graves/exiles/returns/tutors/shuffles:', {
      graves:tall.graves, exiles:tall.exiles, returns:tall.returns, tutors:tall.tutors, shuffles:tall.shuffles
    });

    console.log('Estimated casts this turn (optional):', snap.estimatedCastsThisTurn);

    console.groupEnd();
  }catch(e){ console.warn('[TurnUpkeep.debug] print failed', e); }

  return { tallies:tall, snapshot:snap, state:st };
}

function TU(){ return debug(); }

// -----------------------------
// Export
// -----------------------------
export const TurnUpkeep = {
  Phase,
  state,
  endTurnFrom,
  clickDraw,
  finishDraw,
  clickCombat,
  onCombatFinishedFromRTC,
  applyTurnPassFromRTC,
  applyPhaseSetFromRTC,

  // tallies recorders
  recordDraw,
  recordCast,
  recordTap,
  recordUntap,
  recordLife,
  recordCounter,
  recordToken,
  recordScry,
  recordSurveil,
  recordInvestigate,
  tallyAttackers,
  tallyBlockers,
  bump,
  noteCast,           // (from previous step you added)
  noteLandPlay,    // ← NEW
  noteExile,       // ← NEW
  noteGrave,       // ← NEW

  // snapshot
  recomputeSnapshot,
  getSnapshot,
  getTallies,

  // debug
  debug
};

window.TurnUpkeep = TurnUpkeep;
window.TU = TU;

// CTRL-F anchor: [TU:phase-events]
window.addEventListener('phase:beginningOfEndStep', (ev) => {
  try {
    const seat = Number(ev?.detail?.seat) || mySeatNum();
    window.RulesStore?.clearEOT?.(seat);
    // Refresh visuals after the purge
    document.querySelectorAll('img.table-card[data-cid]').forEach(n => {
      const cid = n.dataset.cid;
      window.Badges?.refreshFor?.(cid);
      window.Tooltip?.refreshFor?.(cid);
    });
    console.log('[TurnUpkeep] EOT cleared on beginningOfEndStep for seat', seat);
  } catch (e) {
    console.warn('[TurnUpkeep] EOT listener failed', e);
  }
});
