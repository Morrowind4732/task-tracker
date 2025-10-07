// ================================
// FILE: modules/combat.ui.js
// ================================
// V2-compatible combat UI:
// - Attacker overlay → save attacks
// - Defender overlay → choose blockers → compute recommended outcome
// - Uses unified read/write (CombatStore first, Storage fallback)
// - FAB reads mySeat/gameId at CLICK time (fixes “You are Player 1”)
// ================================

import { CombatStore } from './combat.store.js';
import * as Storage from './storage.js';
import { resolveCombatDamage } from './battle.js';

/* tiny toast fallback */
function showToast(msg){
  if (typeof window.showToast === 'function') return window.showToast(msg);
  console.log('[toast]', msg);
}

/* ------------------------------------------------------
   V2 state helpers
------------------------------------------------------ */
function getAppState(){ return window.AppState || {}; }
function getGameId(){ return String(getAppState().gameId || document.querySelector('#game')?.value || ''); }
function getSeatNow(fallback){
  const s = getAppState().mySeat ?? document.querySelector('#mySeat')?.value;
  return Number(s ?? fallback ?? 0);
}
function getTable(){ const S = getAppState(); return Array.isArray(S.table) ? S.table : []; }
function getPlayerCount(){ const S = getAppState(); return Number(S.playerCount || 2); }
function getById(cid){ return getTable().find(c => String(c.id) === String(cid)); }

// --- zone helpers for commander filtering
function rectsOverlap(a,b){ return !(a.right<b.left || a.left>b.right || a.bottom<b.top || a.top>b.bottom); }
function cardElById(cid){ return document.querySelector(`.card[data-id="${cid}"]`); }
function isInCommanderZone(cid){
  const el = cardElById(String(cid));
  const cmd = document.getElementById('cmdZone');
  if (!el || !cmd) return false;
  const cr = el.getBoundingClientRect();
  const zr = cmd.getBoundingClientRect();
  return rectsOverlap(cr, zr);
}


function activeFace(card){
  if (Array.isArray(card?._faces) && card._faces.length > 1){
    return (card.face === 'back') ? card._faces[1] : card._faces[0];
  }
  return (card?._faces && card._faces[0]) || {};
}
function computePT(card){
  const f = activeFace(card);
  const p = f.power ?? card.power ?? card._scry?.power ?? card._scry?.faces?.[0]?.power ?? '';
  const t = f.toughness ?? card.toughness ?? card._scry?.toughness ?? card._scry?.faces?.[0]?.toughness ?? '';
  return { power: Number(p || 0), toughness: Number(t || 0) };
}
function isCreature(card){
  const tl = (activeFace(card).type_line || card._scry?.type_line || '').toLowerCase();
  return tl.includes('creature');
}

/* ------------------------------------------------------
   Unified combat I/O (CombatStore primary, Storage fallback)
------------------------------------------------------ */
async function readCombatUnified(gameId){
  try {
    const a = await CombatStore.read(gameId);
    if (a && (a.attacks || a.blocksByDefender || a.recommendedOutcome)) return a;
  } catch(_) {}
  try {
    if (typeof Storage.readCombat === 'function') {
      return (await Storage.readCombat(gameId)) || null;
    }
  } catch(_) {}
  return null;
}
async function saveAttacksUnified(gameId, attacks){
  await Promise.allSettled([
    CombatStore.saveAttacks(gameId, attacks),
    Storage.saveAttacks?.(gameId, attacks)
  ]);
}
async function saveBlocksUnified(gameId, defenderSeat, blocksForSeat){
  await Promise.allSettled([
    CombatStore.saveBlocks(gameId, defenderSeat, blocksForSeat),
    Storage.saveBlocks?.(gameId, defenderSeat, blocksForSeat)
  ]);
}
async function setInitiatedUnified(gameId, payload){
  await Promise.allSettled([
    CombatStore.setInitiated(gameId, payload),
    Storage.setCombatInitiated?.(gameId, payload?.attackingSeat ?? payload?.attackerSeat ?? 0, payload)
  ]);
}
async function writeUnified(gameId, patch){
  await Promise.allSettled([
    CombatStore.write(gameId, patch),
    Storage.writeCombat?.(gameId, patch)
  ]);
}

/* ------------------------------------------------------
   Attacker overlay (declare attackers → save)
------------------------------------------------------ */
// Replace your existing openAttackerOverlay with this:
export async function openAttackerOverlay({ gameId, mySeat }) {
  const gid  = String(gameId || window.AppState?.gameId || '');
  const seat = Number(window.AppState?.mySeat ?? mySeat ?? 0);

  // singleton
  const old = document.getElementById('combatAtkOverlay');
  if (old) old.remove();

  const table = getTable();
  const playerCount = getPlayerCount();
  const candidates = table.filter(c => isCreature(c) && !isInCommanderZone(c.id));


  const prev = await CombatStore.read(gid);
  const previousMap = {};
  if (prev?.attacks){
    for (const [cid, row] of Object.entries(prev.attacks)){
      if (Number(row?.attackerSeat) === Number(seat)){
        previousMap[cid] = Number(row.defenderSeat || NaN) || null;
      }
    }
  }

  const oppSeats = Array.from({length: playerCount}, (_,i)=>i+1).filter(s => s !== Number(seat));

  const ov = document.createElement('div');
  ov.id = 'combatAtkOverlay';
  ov.style.cssText = `position:fixed; inset:0; z-index:11000; background:rgba(5,7,12,.86); display:flex; flex-direction:column; padding:14px; gap:10px; color:#e7efff; font:14px/1.35 ui-sans-serif,system-ui;`;
  ov.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2 style="margin:0;font:700 18px/1 ui-sans-serif">Declare Attackers — You are Player ${seat}</h2>
      <button id="closeAtk" class="pill" style="padding:8px 12px">✕</button>
    </div>
    <div id="scroller" style="flex:1;overflow:auto;padding-right:6px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="resetAtk" class="pill">Reset</button>
      <button id="confirmAtk" class="pill" style="background:#6aa9ff;color:#091323;font-weight:800;border-color:#3d5ba0">Confirm Attacks</button>
    </div>
  `;
  document.body.appendChild(ov);

  const scroller = ov.querySelector('#scroller');
  let choices = { ...previousMap };

  function rowHtml(card){
    const { power, toughness } = computePT(card);
    const img = card.frontImg || card._faces?.[0]?.image || '';
    const cid = String(card.id);
    const cur = (cid in choices) ? choices[cid] : null;

    const oppBtns = oppSeats.map(seatNum => {
      const sel = (cur === seatNum) ? 'outline:2px solid #6aa9ff; box-shadow:0 0 0 6px rgba(106,169,255,.18) inset;' : '';
      return `<button class="pill choose" data-target="${seatNum}" style="${sel}">P${seatNum}</button>`;
    }).join('');
    const noneSel = (cur == null) ? 'outline:2px solid #6aa9ff; box-shadow:0 0 0 6px rgba(106,169,255,.18) inset;' : '';

    return `
      <div class="atk-row" data-cid="${cid}" style="display:grid;grid-template-columns:80px 1fr;gap:10px;align-items:center;margin:8px 0;padding:8px;border:1px solid #24324a;border-radius:12px;background:#0b1220">
        <div style="width:80px;height:56px;border-radius:10px;background:#1a1f2a center/cover no-repeat;${img?`background-image:url('${img}')`:''}"></div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <strong style="font-weight:800">${card.name || 'Creature'}</strong>
            <span style="opacity:.85;font-weight:800;background:#0f1725;border:1px solid #2b3f63;border-radius:8px;padding:2px 6px">${power}/${toughness}</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="pill choose" data-target="" style="${noneSel}">—</button>
            ${oppBtns}
          </div>
        </div>
      </div>
    `;
  }

  scroller.innerHTML = candidates.map(rowHtml).join('');

  scroller.addEventListener('click', (e) => {
    const btn = e.target.closest('.choose'); if (!btn) return;
    const row = btn.closest('.atk-row'); if (!row) return;
    const cid = row.dataset.cid;
    const val = btn.dataset.target === '' ? null : Number(btn.dataset.target);
    choices[cid] = val;
    row.querySelectorAll('.choose').forEach(b => { b.style.outline = ''; b.style.boxShadow = ''; });
    btn.style.outline = '2px solid #6aa9ff';
    btn.style.boxShadow = '0 0 0 6px rgba(106,169,255,.18) inset';
  });

  ov.querySelector('#closeAtk').onclick = () => ov.remove();
  ov.querySelector('#resetAtk').onclick = () => {
    if (!confirm('Clear all your attack choices?')) return;
    choices = {};
    scroller.querySelectorAll('.atk-row').forEach(row => {
      row.querySelectorAll('.choose').forEach(b => {
        b.style.outline = '';
        b.style.boxShadow = '';
        if (b.dataset.target === ''){
          b.style.outline = '2px solid #6aa9ff';
          b.style.boxShadow = '0 0 0 6px rgba(106,169,255,.18) inset';
        }
      });
    });
  };

  ov.querySelector('#confirmAtk').onclick = async () => {
  try {
    // 1) clear old attacks before saving
    await CombatStore.write(gid, {
      epoch: Date.now(),
      recommendedOutcome: null,
      applied: {},
      attacks: {} // reset all previous attacks
    });

    // 2) build new attack map only for selected ones
    const trimmed = {};
    for (const [cid, defSeat] of Object.entries(choices)){
      if (defSeat != null && !isNaN(defSeat)) {
        trimmed[cid] = { attackerSeat: seat, defenderSeat: Number(defSeat) };
      }
    }

    await CombatStore.saveAttacks(gid, trimmed);

    // 3) advance phase
    await CombatStore.setInitiated(gid, { attackingSeat: seat, phase: 'declare-blockers' });

    showToast('Attacks declared!');
    ov.remove();
  } catch(err){
    console.error('[combat] confirm attacks failed', err);
    showToast('Could not confirm attacks (see console).');
  }
};

}



/* ------------------------------------------------------
   Defender overlay (assign blockers → compute outcome)
------------------------------------------------------ */
// Replace your existing openDefenderOverlay with this:
export async function openDefenderOverlay({ gameId, mySeat }) {
  const gid  = String(gameId || window.AppState?.gameId || '');
  const seat = Number(window.AppState?.mySeat ?? mySeat ?? 0);

  // singleton
  const old = document.getElementById('combatDefOverlay');
  if (old) old.remove();

  const table = getTable();

  // read combat doc
  const current = await (async () => {
    try { const a = await CombatStore.read(gid); if (a) return a; } catch(_) {}
    try { return await window.StorageAPI?.readCombat?.(gid); } catch(_) {}
    return null;
  })();

  const attacksMap = current?.attacks || {};
  const incoming = [];

  // Always load from the ATTACKER'S table; avoids id collisions with local table
  async function fetchCardFromSeatStrict(seatNum, cid){
    try{
      const ps = await window.StorageAPI?.loadPlayerState?.(gid, Number(seatNum));
      const tableArr = Array.isArray(ps?.Table) ? ps.Table : [];
      return tableArr.find(c => String(c.id) === String(cid)) || null;
    }catch(e){
      console.warn('[defender-overlay] fetchCardFromSeatStrict failed', e);
      return null;
    }
  }

  if (attacksMap && Object.keys(attacksMap).length){
    const tasks = [];
    for (const [aCid, row] of Object.entries(attacksMap)){
      if (Number(row?.defenderSeat) !== Number(seat)) continue;   // only attacks at me
      tasks.push((async ()=>{
        const aCard = await fetchCardFromSeatStrict(row?.attackerSeat, aCid);
        if (aCard) incoming.push(aCard);
      })());
    }
    if (tasks.length) await Promise.all(tasks);
  }

  // my blockers come from my board
  const myBlockers = table.filter(c => isCreature(c) &&
  Number(c.controllerSeat || getAppState().mySeat || seat) === Number(seat) &&
  !isInCommanderZone(c.id));


  const ov = document.createElement('div');
  ov.id = 'combatDefOverlay';
  ov.style.cssText = `position:fixed; inset:0; z-index:11000; background:rgba(5,7,12,.86); display:flex; flex-direction:column; padding:14px; gap:10px; color:#e7efff; font:14px/1.35 ui-sans-serif,system-ui;`;
  ov.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2 style="margin:0;font:700 18px/1 ui-sans-serif">Assign Blockers — You are Player ${seat}</h2>
      <button id="closeDef" class="pill" style="padding:8px 12px">✕</button>
    </div>
    <div id="scroller" style="flex:1;overflow:auto;padding-right:6px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="resetDef" class="pill">Reset</button>
      <button id="confirmDef" class="pill" style="background:#6aa9ff;color:#091323;font-weight:800;border-color:#3d5ba0">Confirm Blocks</button>
    </div>
  `;
  document.body.appendChild(ov);

  // { attackerCid: [blockerCid, ...] }
  const blocks = {};

  function attackerRowHtml(a){
    const { power, toughness } = computePT(a);
    const img = a.frontImg || a._faces?.[0]?.image || '';
    const cid = String(a.id);

    const blockerBtns = myBlockers.map(b => {
      const selected = (blocks[cid] || []).includes(String(b.id));
      const sel = selected ? 'outline:2px solid #6aa9ff; box-shadow:0 0 0 6px rgba(106,169,255,.18) inset;' : '';
      const { power:bp, toughness:bt } = computePT(b);
      return `<button class="pill choose-blocker" data-att="${cid}" data-bid="${b.id}" style="${sel}">${b.name || 'Blocker'} (${bp}/${bt})</button>`;
    }).join('');

    return `
      <div class="def-row" data-cid="${cid}" style="display:grid;grid-template-columns:80px 1fr;gap:10px;align-items:center;margin:8px 0;padding:8px;border:1px solid #24324a;border-radius:12px;background:#0b1220">
        <div style="width:80px;height:56px;border-radius:10px;background:#1a1f2a center/cover no-repeat;${img?`background-image:url('${img}')`:''}"></div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <strong style="font-weight:800">${a.name || 'Attacker'}</strong>
            <span style="opacity:.85;font-weight:800;background:#0f1725;border:1px solid #2b3f63;border-radius:8px;padding:2px 6px">${power}/${toughness}</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${blockerBtns}</div>
        </div>
      </div>
    `;
  }

  const scroller = ov.querySelector('#scroller');
  scroller.innerHTML = incoming.length ? incoming.map(attackerRowHtml).join('') : `<em>No attackers are assigned to you.</em>`;

  scroller.addEventListener('click', (e) => {
    const btn = e.target.closest('.choose-blocker'); if (!btn) return;
    const aCid = String(btn.dataset.att);
    const bCid = String(btn.dataset.bid);
    const list = blocks[aCid] || (blocks[aCid] = []);
    const ix = list.indexOf(bCid);
    if (ix === -1) list.push(bCid); else list.splice(ix,1);

    if (btn.style.outline){
      btn.style.outline = '';
      btn.style.boxShadow = '';
    } else {
      btn.style.outline = '2px solid #6aa9ff';
      btn.style.boxShadow = '0 0 0 6px rgba(106,169,255,.18) inset';
    }
  });

  ov.querySelector('#closeDef').onclick = () => ov.remove();
  ov.querySelector('#resetDef').onclick = () => {
    if (!confirm('Clear all your block assignments?')) return;
    for (const k of Object.keys(blocks)) delete blocks[k];
    scroller.querySelectorAll('.choose-blocker').forEach(b => { b.style.outline=''; b.style.boxShadow=''; });
  };

  // helper to tag names in a note with seats: (P1) Attacker, (P2) Blocker
  const rxEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  function tagWithSeats(line, attacker, aSeat, blockers, dSeat){
    let out = line;
    // tag attacker first to avoid double-tagging blocker names inside
    out = out.replace(new RegExp(`\\b${rxEscape(attacker.name)}\\b`, 'g'), `(P${aSeat}) ${attacker.name}`);
    const seenNames = new Set();
    for (const b of blockers){
      if (!b?.name || seenNames.has(b.name)) continue;
      seenNames.add(b.name);
      out = out.replace(new RegExp(`\\b${rxEscape(b.name)}\\b`, 'g'), `(P${dSeat}) ${b.name}`);
    }
    return out;
  }

  ov.querySelector('#confirmDef').onclick = async () => {
  try{
    // Persist blocks (trim empty)
    const trimmed = {};
    for (const [aCid, arr] of Object.entries(blocks)){
      if (Array.isArray(arr) && arr.length) trimmed[aCid] = arr;
    }
    await CombatStore.saveBlocks(gid, seat, trimmed);
    showToast('Blocks submitted!');

    // ==== Build recommended outcomes (notes + deaths + LIFE) ====

    // helpers
    const lifeDamage = {};   // { seat: totalDamageTaken }
    const lifeGain   = {};   // { seat: totalLifelinkGained }
    const addDmg  = (s,n)=>{ if(!n) return; lifeDamage[s]=(lifeDamage[s]||0)+n; };
    const addHeal = (s,n)=>{ if(!n) return; lifeGain[s]=(lifeGain[s]||0)+n;   };

    function oracleText(card){
      return (card?._scry?.oracle_text || card?.oracle_text || (card?._faces?.[0]?.oracle_text) || '').toLowerCase();
    }
    const hasLL = (card)=> oracleText(card).includes('lifelink');
    // we ignore trample here (blocked = no face damage) until we wire full trample logic

    const allNotes = [];
    const deadMap = {};        // attackerCid -> [dead blocker ids]
    const attackerDeaths = {}; // attackerCid -> boolean

    // iterate over ALL attacks targeting me; use trimmed[aCid] (or empty) as the chosen blockers
for (const [aCid, row] of Object.entries(attacksMap)){
  if (Number(row?.defenderSeat) !== Number(seat)) continue;

  const aSeat = Number(row?.attackerSeat || 0);
  const attacker = await (async ()=>{
    try{
      const ps = await window.StorageAPI?.loadPlayerState?.(gid, aSeat);
      const tbl = Array.isArray(ps?.Table) ? ps.Table : [];
      return tbl.find(c => String(c.id) === String(aCid)) || null;
    }catch(_){ return null; }
  })();
  if (!attacker) continue;

  // blockers are from MY table; if none chosen, this will be [] (unblocked)
  const bCidList = trimmed[aCid] || [];
  const blockers = bCidList.map(getById).filter(Boolean);

  const result = resolveCombatDamage(attacker, blockers);

  // death bookkeeping
  deadMap[aCid] = Array.from(result.deadBlockers || []);
  attackerDeaths[aCid] = !!result.attackerDead;

  // LIFE: unblocked attackers deal face damage; lifelink heals attacker seat
  const { power: AtkP } = computePT(attacker);
  const unblocked = !blockers.length && !result.attackerDead;
  if (unblocked && AtkP > 0){
    const defSeat = Number(row?.defenderSeat || 0);
    addDmg(defSeat, AtkP);
    if (hasLL(attacker)) addHeal(aSeat, AtkP);
  }

  // Seat-tag notes
  const bCards = blockers;
  const rxEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const tagLine = (line)=>{
    let out = line;
    out = out.replace(new RegExp(`\\b${rxEscape(attacker.name)}\\b`, 'g'), `(P${aSeat}) ${attacker.name}`);
    const seen = new Set();
    for (const b of bCards){
      if (!b?.name || seen.has(b.name)) continue;
      seen.add(b.name);
      out = out.replace(new RegExp(`\\b${rxEscape(b.name)}\\b`, 'g'), `(P${seat}) ${b.name}`);
    }
    return out;
  };

  const tagged = Array.isArray(result.notes) && result.notes.length
    ? result.notes.map(tagLine)
    : [unblocked ? 'Unblocked' : (result.attackerDead || (result.deadBlockers||[]).length ? 'Deaths resolved' : 'No deaths')];

  allNotes.push(`<strong>(P${aSeat}) ${attacker.name} (vs P${seat})</strong>`, ...tagged);
}


    const epoch = Number(current?.epoch || Date.now());
    await CombatStore.write(gid, {
      epoch,
      recommendedOutcome: {
        notesHtml: allNotes,
        deadByAttack: deadMap,
        attackerDeadFlags: attackerDeaths,
        playerDamage: lifeDamage,     // <-- NEW
        lifelinkGains: lifeGain,      // <-- NEW
        epoch
      },
      applied: {}
    });

    // Let the poller pop the overlay once
    ov.remove();
  }catch(err){
    console.error('[combat] confirm blocks failed', err);
    showToast('Could not confirm blocks (see console).');
  }
};
}


// ---------- Outcome panel with toggles ----------
function renderOutcomePanel({ gid, seat, attacksMap, outcome, blocksByDefender, attackersLoaded }) {
  // build per-attacker rows with human text, even when nobody dies
  // shape we render: [{id, enabled, text, attackerId, deadBlockers:Set, attackerDead:boolean}]
  const rows = [];

  // Map: attackerId -> [blocker cards]
  const byAtt = new Map();
  for (const [attId, list] of Object.entries(blocksByDefender || {})){
    const arr = Array.isArray(list) ? list : [];
    const cards = arr.map(cid => getById(cid)).filter(Boolean);
    byAtt.set(String(attId), cards);
  }

  for (const a of attackersLoaded){ // cards we fetched from the attacker’s seat
    const aId = String(a.id);
    const recDead = new Set(Array.from(outcome.deadBlockers || []));
    const myBlocks = byAtt.get(aId) || [];

    // Text when nobody dies: "(Pdef) B blocks (Patt) A"
    const attRow = attacksMap?.[aId] || {};
    const patt = Number(attRow.attackerSeat||0);
    const pdef = Number(attRow.defenderSeat||0);

    const diedBlockers = myBlocks.filter(b => recDead.has(String(b.id)));
    const nobodyDied   = !outcome.attackerDead || String(outcome.attackerCard?.id||'') !== aId;
    const textBits = [];

    if (myBlocks.length){
      // one "blocks" line
      const blist = myBlocks.map(b=>b.name||'Blocker').join(', ');
      textBits.push(`(P${pdef}) ${blist} blocks (P${patt}) ${a.name}`);
    }else{
      textBits.push(`(P${patt}) ${a.name} is unblocked`);
    }

    // death lines (these already exist as notes, but we make them explicit)
    if (diedBlockers.length){
      for (const b of diedBlockers){
        textBits.push(`(P${patt}) ${a.name} kills (P${pdef}) ${b.name}`);
      }
    }
    if (outcome.attackerDead && String(outcome.attackerCard?.id||'') === aId){
      textBits.push(`(P${pdef}) blockers kill (P${patt}) ${a.name}`);
    }

    rows.push({
      id: aId,
      enabled: true,
      text: textBits.join(' • '),
      attackerId: aId,
      deadBlockers: new Set(diedBlockers.map(b=>String(b.id))),
      attackerDead: outcome.attackerDead && String(outcome.attackerCard?.id||'') === aId
    });
  }

  // draw UI
  let panel = document.getElementById('combatOutcomePanel');
  if (!panel){
    panel = document.createElement('div');
    panel.id = 'combatOutcomePanel';
    panel.className = 'panel';
    panel.style.zIndex = 11005;
    document.body.appendChild(panel);
  }

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <strong>Combat Outcome (Recommended)</strong>
      <div style="display:flex;gap:8px">
        <button id="applyOutcomeBtn" class="pill" style="background:#6aa9ff;color:#091323;font-weight:800;border-color:#3d5ba0">Apply to My Board</button>
        <button id="closeOutcomeBtn" class="pill">Close</button>
      </div>
    </div>
    <div id="outRows" style="margin-top:10px;display:grid;gap:8px"></div>
  `;

  const outRows = panel.querySelector('#outRows');
  outRows.innerHTML = rows.map((r,idx)=>`
    <label class="pill" style="display:flex;gap:10px;align-items:flex-start">
      <input type="checkbox" data-idx="${idx}" checked />
      <div>${r.text}</div>
    </label>
  `).join('');

  // wiring
  outRows.addEventListener('change', (e)=>{
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    const idx = Number(cb.dataset.idx);
    rows[idx].enabled = cb.checked;
  });
  panel.querySelector('#closeOutcomeBtn').onclick = ()=> panel.remove();

  // expose for apply
  panel.__rows = rows;
  return panel;
}




/* ------------------------------------------------------
   Outcome overlay
------------------------------------------------------ */
// Replace your existing showOutcomeOverlay with this:
// Rich, toggleable outcome overlay with full details per attacker
export async function showOutcomeOverlay({ data, gameId, mySeat }){
  const gid  = String(gameId || (window.AppState?.gameId ?? ''));
  const seat = Number(mySeat ?? window.AppState?.mySeat ?? 0);
  const attacks   = data?.attacks || {};
  const ro        = data?.recommendedOutcome || {};
  const deadByAtk = ro.deadByAttack || {};
  const aDead     = ro.attackerDeadFlags || {};
  const blocksDb  = (data?.blocksByDefender && data.blocksByDefender[String(seat)]) || {}; // only my seat’s blocks

  // ---------- small local helpers (use your existing computePT/getById) ----------
  const S = window.AppState || {};
  function ptStr(card){
    const { power, toughness } = computePT(card); // uses your helper
    return `${power}/${toughness}`;
  }
  function oracleText(card){
    return (card?._scry?.oracle_text || card?.oracle_text || (card?._faces?.[0]?.oracle_text) || '').toLowerCase();
  }
  function effectFlags(card){
    const t = oracleText(card);
    const fx = [];
    if (t.includes('first strike'))  fx.push('First strike');
    if (t.includes('double strike')) fx.push('Double strike');
    if (t.includes('deathtouch'))    fx.push('Deathtouch');
    if (t.includes('trample'))       fx.push('Trample');
    if (t.includes('lifelink'))      fx.push('Lifelink');
    return fx;
  }

  // Fallback: try to fetch an attacker card from the proper seat if it’s not on my table
  async function fetchCardFromSeatStrict(seatNum, cid){
    try{
      const ps = await window.StorageAPI?.loadPlayerState?.(gid, Number(seatNum));
      const tbl = Array.isArray(ps?.Table) ? ps.Table : [];
      return tbl.find(c => String(c.id) === String(cid)) || null;
    }catch(_){ return null; }
  }

  // Try to read aggregated life deltas if your resolver provided them
  const lifeDelta = (ro?.playerDamage && typeof ro.playerDamage === 'object') ? ro.playerDamage : null;   // { seat: -N }
  const lifelink  = (ro?.lifelinkGains && typeof ro.lifelinkGains === 'object') ? ro.lifelinkGains : null; // { seat: +N }

  // ---------- Build rows, one per attacker that involves me (attacker or defender) ----------
  const rows = [];
  for (const [aCid, meta] of Object.entries(attacks)){
    const patt = Number(meta?.attackerSeat || 0);
    const pdef = Number(meta?.defenderSeat || 0);
    if (patt !== seat && pdef !== seat) continue; // show only rows relevant to me

    // attacker card (local or fetched)
    let aCard = getById(aCid);
    if (!aCard) aCard = await fetchCardFromSeatStrict(patt, aCid) || { id:aCid, name:'Attacker' };

    // blockers (only my seat’s assigned blockers)
    const myBlocks = Array.isArray(blocksDb[aCid]) ? blocksDb[aCid].map(getById).filter(Boolean) : [];
    const diedBlockers = new Set((deadByAtk[aCid] || []).map(String));
    const attackerDied = !!aDead[aCid];

    // EFFECTS: attacker effects + each blocker’s effects
    const aFx = effectFlags(aCard);
    const bFxLines = myBlocks
      .map(b => {
        const fx = effectFlags(b);
        return fx.length ? `${b.name}: ${fx.join(', ')}` : '';
      })
      .filter(Boolean);

       // LIFE: damage to defender should display as NEGATIVE; lifelink as POSITIVE
    const lifeBits = [];
    if (lifeDelta) {
      // defender takes damage (show as negative)
      if (lifeDelta[pdef]) lifeBits.push(`P${pdef}: -${Math.abs(Number(lifeDelta[pdef]))}`);
      // attacker seat may also have damage in weird cases; we still show if present
      if (lifeDelta[patt]) lifeBits.push(`P${patt}: -${Math.abs(Number(lifeDelta[patt]))}`);
    }
    if (lifelink) {
      const gDef = Number(lifelink[pdef] || 0);
      const gAtt = Number(lifelink[patt] || 0);
      if (gDef) lifeBits.push(`P${pdef} lifelink: +${gDef}`);
      if (gAtt) lifeBits.push(`P${patt} lifelink: +${gAtt}`);
    }
    const lifeLine = lifeBits.length ? lifeBits.join(' • ') : '—';

    // OUTCOME: explicit who dies
    const outcomeBits = [];
    if (attackerDied) outcomeBits.push(`(P${pdef}) blockers kill (P${patt}) ${aCard.name}`);
    if (diedBlockers.size){
      for (const bid of diedBlockers){
        const bCard = getById(bid);
        if (bCard) outcomeBits.push(`(P${patt}) ${aCard.name} kills (P${pdef}) ${bCard.name}`);
      }
    }
    if (!attackerDied && !diedBlockers.size){
      if (myBlocks.length) outcomeBits.push('No deaths'); else outcomeBits.push('Unblocked');
    }

    // Compose the five labeled lines
    const attackerLine = `(P${patt}) ${aCard.name} ${ptStr(aCard)}`;
    const blockerLine  = myBlocks.length
      ? myBlocks.map(b=>`${b.name} ${ptStr(b)}`).join(', ')
      : '—';
    const effectsLine  = [
      aFx.length ? `Attacker: ${aFx.join(', ')}` : 'Attacker: —',
      bFxLines.length ? `Blocker: ${bFxLines.join(' • ')}` : 'Blocker: —'
    ].join(' | ');
    const outcomeLine  = outcomeBits.join(' • ') || '—';

    rows.push({
      id: String(aCid),
      enabled: true,
      attackerId: String(aCid),
      deadBlockers: diedBlockers,
      attackerDead: attackerDied,
      patt, pdef,
      html: `
        <div style="display:grid;gap:4px">
          <div><strong>Attacker:</strong> ${attackerLine}</div>
          <div><strong>Blocker:</strong> ${blockerLine}</div>
          <div><strong>Effects:</strong> ${effectsLine}</div>
          <div><strong>Life:</strong> ${lifeLine}</div>
          <div><strong>Outcome:</strong> ${outcomeLine}</div>
        </div>
      `
    });
  }

  // ---------- overlay skeleton ----------
  const existing = document.getElementById('combatOutcomeOverlay');
  if (existing) existing.remove();

  const ov = document.createElement('div');
  ov.id = 'combatOutcomeOverlay';
  ov.style.cssText = `position:fixed; inset:0; background:rgba(8,12,20,.8); z-index:12000; display:flex; align-items:center; justify-content:center;`;
  ov.innerHTML = `
    <div style="background:#0b1220;border:1px solid #2b3f63;border-radius:14px;padding:20px;color:#e7efff;max-width:840px;max-height:80vh;overflow:auto;">
      <h2 style="margin:0 0 8px;">Combat Outcome (Recommended)</h2>
      <div id="rows" style="display:grid; gap:10px; margin-bottom:12px;">
        ${
          rows.length
            ? rows.map((r,idx)=>`
                <label class="pill" style="display:grid;gap:8px;align-items:flex-start">
                  <div style="display:flex;gap:10px;align-items:flex-start">
                    <input type="checkbox" data-idx="${idx}" checked />
                    <div style="display:block">${r.html}</div>
                  </div>
                </label>
              `).join('')
            : '<em>No applicable rows for your seat.</em>'
        }
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="pill" id="applyMine">Apply to My Board</button>
        <button class="pill" id="closeOutcome">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);

  // toggles
  const rowsEl = ov.querySelector('#rows');
  rowsEl?.addEventListener('change', (e)=>{
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    rows[Number(cb.dataset.idx)].enabled = cb.checked;
  });

  ov.querySelector('#closeOutcome').onclick = ()=> ov.remove();
  ov.querySelector('#applyMine').onclick = async ()=> {
    try {
      await applyRecommendedToMyBoard({ gameId: gid, mySeat: seat, rows, data });
      ov.remove();
    } catch (e) {
      console.error('[OutcomeOverlay] apply failed', e);
      showToast('Could not apply outcome (see console).');
    }
  };
}




export async function applyRecommendedToMyBoard({ gameId, mySeat } = {}) {
  const gid  = String(gameId || (window.AppState?.gameId ?? ''));
  const seat = Number(mySeat ?? window.AppState?.mySeat ?? 0);
  if (!gid || !seat) { console.warn('[applyRecommendedToMyBoard] missing gid/seat'); return; }

  // 1) Read the merged combat doc (CombatStore first, Storage fallback)
  const current = await (async () => {
    try { const a = await CombatStore.read(gid); if (a) return a; } catch(_) {}
    try { return await window.StorageAPI?.readCombat?.(gid); } catch(_) {}
    return null;
  })();

  const attacks   = current?.attacks || {};
  const ro        = current?.recommendedOutcome || {};
  const deadByAtk = ro.deadByAttack || {};
  const aDead     = ro.attackerDeadFlags || {};
  const playerDamage   = ro.playerDamage   || {}; // { [seat]: damageTaken }
  const lifelinkGains  = ro.lifelinkGains  || {}; // { [seat]: lifeGained }

  // === Decide which card IDs I need to move to GY (mine only) ===
  const cidsToMove = new Set();

  // (A) My dead blockers
  for (const [aCid, list] of Object.entries(deadByAtk)) {
    const defSeat = Number(attacks?.[aCid]?.defenderSeat || 0);
    if (defSeat !== seat) continue;
    for (const cid of (list || [])) cidsToMove.add(String(cid));
  }

  // (B) My dead attackers
  for (const [aCid, died] of Object.entries(aDead)) {
    if (!died) continue;
    const attSeat = Number(attacks?.[aCid]?.attackerSeat || 0);
    if (attSeat === seat) cidsToMove.add(String(aCid));
  }

  // Helper: escape for querySelector
  const esc = (s)=> (window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/"/g, '\\"'));

  // Preferred path: use V2 helpers if they exist so UI + state stay in sync
  const useV2 = typeof window.moveToZone === 'function'
             && typeof window.removeFromTable === 'function'
             && typeof window.appendToZone === 'function';

  // Current table snapshot
  const S = window.AppState || {};
  const tableNow = Array.isArray(S.table) ? S.table.slice() : [];

  // === 2) Move my dead to graveyard (may be none this combat) ===
  if (!cidsToMove.size) {
    console.log('[apply] no deaths this combat — will still tap attackers and apply life totals.');
  }


  for (const cid of cidsToMove) {
    const cardObj = tableNow.find(c => String(c.id) === String(cid)) || { id: cid };
    const el =
      document.querySelector(`#world .card[data-id="${esc(cid)}"]`) ||
      document.querySelector(`.card[data-id="${esc(cid)}"]`) || null;

    if (useV2) {
      try {
        await window.moveToZone(cardObj, 'graveyard', el || undefined);
      } catch (e) {
        console.warn('[apply→moveToZone] failed, falling back', e);
        try {
          if (el && el.remove) el.remove();
          await window.removeFromTable(cardObj);
          await window.appendToZone(cardObj, 'graveyard');
        } catch (e2) {
          console.warn('[apply→manual V2 helpers] failed', e2);
        }
      }
    } else {
      // Minimal fallback: mutate AppState + save + remove DOM
      const nextTable = [];
      S.gy = Array.isArray(S.gy) ? S.gy : [];
      for (const c of (S.table || [])) {
        if (String(c.id) === String(cid)) S.gy.unshift(c);
        else nextTable.push(c);
      }
      S.table = nextTable;
      try { window.StorageAPI?.savePlayerStateDebounced?.(gid, seat, S); } catch(_) {}
      if (el && el.remove) el.remove();
    }
  }

  // === 3) Tap surviving attackers I declared this combat ===
  // Find all my attacking cids that are still alive after the moves above
  const myAttackingCids = Object.entries(attacks)
    .filter(([aCid, meta]) => Number(meta?.attackerSeat) === seat)
    .map(([aCid]) => String(aCid));

  const stillAlive = new Set(myAttackingCids.filter(aCid => !cidsToMove.has(String(aCid))));

  for (const aCid of stillAlive) {
    const el = document.querySelector(`#world .card[data-id="${esc(aCid)}"]`);
    // Update object if we have it in memory
    const obj = (window.AppState?.table || []).find(c => String(c.id) === String(aCid));
    if (obj) obj.tapped = true;

    if (el) {
      // update DOM immediately
      el.classList.add('tapped');
      // if you have a central DOM updater, call it:
      if (typeof window.updateCardDom === 'function') {
        try { window.updateCardDom(obj || { tapped:true }); } catch(_) {}
      }
    }
  }
  // persist tap state (best-effort)
  try { window.StorageAPI?.savePlayerStateDebounced?.(gid, seat, window.AppState); } catch(_) {}

  // === 4) Apply LIFE TOTAL changes (damage and lifelink) ===
  // Build next life map by reading meta first (so we accumulate correctly across multiple applies)
  let meta = null;
  try { meta = await window.StorageAPI?.loadMeta?.(gid); } catch(_) {}
  const lifeMain = { ...(meta?.lifeMain || {}) };

  const seatsToUpdate = new Set([
    ...Object.keys(playerDamage || {}),
    ...Object.keys(lifelinkGains || {})
  ].map(n => Number(n)));

  for (const s of seatsToUpdate) {
    const cur = Number(lifeMain[s] ?? 40); // default to 40 if not set
    const minus = Number(playerDamage[s] || 0);      // damage dealt TO seat s
    const plus  = Number(lifelinkGains[s] || 0);     // lifelink gained BY seat s
    const next  = cur - minus + plus;
    lifeMain[s] = next;

    // update the visible topbar immediately for local UX
    const tile = document.querySelectorAll('.life-strip .life-tile')[s - 1];
    if (tile) {
      const span = tile.querySelector('.life-main');
      if (span) span.textContent = String(next);
    }
  }

  try {
    await window.StorageAPI?.saveMeta?.(gid, { lifeMain, lifeUpdatedAt: Date.now() });
  } catch (e) {
    console.warn('[apply→saveMeta lifeMain] failed', e);
  }

  // Mark applied for my seat (optional bookkeeping)
  try { await CombatStore.write(gid, { applied: { [seat]: true } }); } catch(_){}

  showToast('Applied: deaths, taps, and life totals.');
}






  


/* ------------------------------------------------------
   Poller for recommendedOutcome (CombatStore only)
------------------------------------------------------ */
// Replace your existing startCombatPoller with this:
export function startCombatPoller(gameId){
  // keep exactly one poller per gameId
  window.__combatPollers = window.__combatPollers || {};
  if (window.__combatPollers[gameId]) {
    // unsubscribe the old one just in case and replace it
    try { window.__combatPollers[gameId](); } catch(_) {}
  }

  let lastEpoch = 0;

  const unsub = CombatStore.onChange(gameId, (data)=>{
    if (!data?.recommendedOutcome) return;

    const mySeat = Number(window.AppState?.mySeat || 0);

    // skip if I already applied the outcome for this epoch/round
    if (data.applied && data.applied[mySeat]) return;

    // epoch gating: only surface once per new combat
    const ro = data.recommendedOutcome;
    const roEpoch = Number(ro.epoch || data.epoch || 0);
    if (!roEpoch || roEpoch === lastEpoch) return;

    lastEpoch = roEpoch;

    const notes = Array.isArray(ro.notesHtml) ? ro.notesHtml : [];
// pass the full data so overlay can build toggles & seat-aware rows
showOutcomeOverlay({ data, gameId, mySeat });

  });

  window.__combatPollers[gameId] = unsub;
  return unsub;
}




/* ------------------------------------------------------
   FAB wiring helper (compute seat/gameId at click time)
------------------------------------------------------ */
export function wireBattleFab({ gameId, mySeat, getIsMyTurn, btn }) {
  btn.addEventListener('click', () => {
    try {
      const gid  = String(gameId || getGameId());
      const seat = getSeatNow(mySeat);
      const myTurn = typeof getIsMyTurn === 'function' ? !!getIsMyTurn() : false;
      if (myTurn) {
        return openAttackerOverlay({ gameId: gid, mySeat: seat });
      }
      return openDefenderOverlay({ gameId: gid, mySeat: seat });
    } catch (e) {
      console.error('[wireBattleFab] failed', e);
    }
  });
}

/* Default export (optional) */
export default {
  openAttackerOverlay,
  openDefenderOverlay,
  showOutcomeOverlay,
  startCombatPoller,
  wireBattleFab
};
