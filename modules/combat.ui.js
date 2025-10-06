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
export async function openAttackerOverlay({ gameId, mySeat } = {}){
  const gid = String(gameId || getGameId());
  const seat = getSeatNow(mySeat);
  const table = getTable();
  const playerCount = getPlayerCount();
  const candidates = table.filter(isCreature);

  const prev = await readCombatUnified(gid);
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

    const oppBtns = oppSeats.map(seatN => {
      const sel = (cur === seatN) ? 'outline:2px solid #6aa9ff; box-shadow:0 0 0 6px rgba(106,169,255,.18) inset;' : '';
      return `<button class="pill choose" data-target="${seatN}" style="${sel}">P${seatN}</button>`;
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
    try{
      const trimmed = {};
      for (const [cid, seatDst] of Object.entries(choices)){
        if (seatDst) trimmed[cid] = { attackerSeat: Number(seat), defenderSeat: Number(seatDst) };
      }
      await saveAttacksUnified(gid, trimmed);
      await setInitiatedUnified(gid, { attackingSeat: Number(seat), phase: 'declare-blockers' });

      // NEW: fresh combat epoch; clear last recommendation & applied flags
      await writeUnified(gid, { epoch: Date.now(), recommendedOutcome: null, applied: {} });

      showToast('Attacks declared!');
      ov.remove();
    }catch(err){
      console.error('[combat] confirm attacks failed', err);
      showToast('Could not confirm attacks (see console).');
    }
  };
}


/* ------------------------------------------------------
   Defender overlay (assign blockers → compute outcome)
------------------------------------------------------ */
export async function openDefenderOverlay({ gameId, mySeat } = {}){
  const gid  = String(gameId || getGameId());
  const seat = getSeatNow(mySeat);
  const table = getTable();

  // Build attacker list from combat doc (only those aimed at me).
  const current = await readCombatUnified(gid);
  const incoming = [];

  async function fetchCardFromSeat(seatNum, cid){
    const local = getById(cid);
    if (local) return local;
    try{
      const ps = await Storage.loadPlayerState?.(gid, Number(seatNum));
      const tableArr = Array.isArray(ps?.Table) ? ps.Table : [];
      return tableArr.find(c => String(c.id) === String(cid)) || null;
    }catch(e){
      console.warn('[defender-overlay] fetchCardFromSeat failed', e);
      return null;
    }
  }

  if (current?.attacks){
    const tasks = [];
    for (const [aCid, row] of Object.entries(current.attacks)){
      if (Number(row?.defenderSeat) === Number(seat)){
        tasks.push((async ()=>{
          const aCard = await fetchCardFromSeat(row?.attackerSeat, aCid);
          if (aCard) incoming.push(aCard);
        })());
      }
    }
    if (tasks.length) await Promise.all(tasks);
  }

  // MY potential blockers come from my board only
  const myBlockers = table.filter(c => isCreature(c) &&
    Number(c.controllerSeat || getAppState().mySeat || seat) === Number(seat));

  const ov = document.createElement('div');
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

  // blocks: { attackerCid: [blockerCid, ...] } (ordered)
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
  scroller.innerHTML = incoming.length
    ? incoming.map(attackerRowHtml).join('')
    : `<em>No attackers assigned to you.</em>`;

  scroller.addEventListener('click', (e) => {
    const btn = e.target.closest('.choose-blocker'); if (!btn) return;
    const aCid = String(btn.dataset.att);
    const bCid = String(btn.dataset.bid);
    const list = blocks[aCid] || (blocks[aCid] = []);
    const ix = list.indexOf(bCid);
    if (ix === -1) list.push(bCid); else list.splice(ix,1);

    // toggle visuals
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

  ov.querySelector('#confirmDef').onclick = async () => {
  try{
    // 1) Trim empty entries and persist my blocks
    const trimmed = {};
    for (const [aCid, arr] of Object.entries(blocks)){
      if (Array.isArray(arr) && arr.length) trimmed[aCid] = arr;
    }
    await saveBlocksUnified(gid, seat, trimmed);
    showToast('Blocks submitted!');

    // 2) Build recommended outcomes for the pairs I just assigned (use live table cards)
    const allNotes = [];
    const deadMap = {};        // attackerCid -> [dead blocker ids]
    const attackerDeaths = {}; // attackerCid -> boolean

    for (const [aCid, bCidList] of Object.entries(trimmed)){
      // Resolve attacker + blockers
      const attacker = getById(aCid) || incoming.find(c => String(c.id) === String(aCid));
      const blockers = (bCidList || []).map(getById).filter(Boolean);
      if (!attacker) continue;

      // Seats for labels
      const attackerSeat = Number((current?.attacks?.[aCid]?.attackerSeat) || 0);
      const defenderSeat = Number(seat);

      const attackerLabel = `P${attackerSeat || '?' } — ${attacker.name || 'Attacker'}`;
      const blockerLabels = blockers.map(b => ({
        plain: b.name || 'Blocker',
        label: `P${defenderSeat} — ${b.name || 'Blocker'}`
      }));

      // Core resolution
      const result = resolveCombatDamage(attacker, blockers);

      // Re-label the text notes so identical names are disambiguated
      const labeledNotes = (result.notes || []).map(line => {
        let s = line;
        // replace attacker name first
        if (attacker?.name) {
          s = s.replaceAll(attacker.name, attackerLabel);
        }
        // then each blocker name
        for (const bl of blockerLabels){
          s = s.replaceAll(bl.plain, bl.label);
        }
        return s;
      });

      // Group notes by attacker for readability
      allNotes.push(`<strong>${attackerLabel}</strong>`, ...labeledNotes);

      // Save structured outcome
      deadMap[aCid] = Array.from(result.deadBlockers || []);
      attackerDeaths[aCid] = !!result.attackerDead;
    }

    // 3) Save a single blob so everyone can see the suggestion
    await writeUnified(gid, {
      recommendedOutcome: {
        notesHtml: allNotes,
        deadByAttack: deadMap,
        attackerDeadFlags: attackerDeaths
      }
    });

    // 4) Show overlay immediately (with context so Apply works)
    showOutcomeOverlay({ notes: allNotes, gameId: gid, mySeat: seat });

    ov.remove();
  }catch(err){
    console.error('[combat] confirm blocks failed', err);
    showToast('Could not confirm blocks (see console).');
  }
};

}


/* ------------------------------------------------------
   Outcome overlay
------------------------------------------------------ */
export function showOutcomeOverlay(result){
  const { notes = [], gameId, mySeat } = result || {};
  const ov = document.createElement('div');
  ov.style.cssText = `position:fixed; inset:0; background:rgba(8,12,20,.8); z-index:12000; display:flex; align-items:center; justify-content:center;`;
  ov.innerHTML = `
    <div style="background:#0b1220;border:1px solid #2b3f63;border-radius:14px;padding:20px;color:#e7efff;max-width:560px;max-height:80vh;overflow:auto;">
      <h2 style="margin:0 0 8px;">Combat Outcome (Recommended)</h2>
      ${notes.length ? `<ul style="margin:0 0 12px;padding-left:18px;">${notes.map(n=>`<li>${n}</li>`).join('')}</ul>` : '<em>No notes.</em>'}
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="pill" id="applyMine">Apply to My Board</button>
        <button class="pill" id="closeOutcome">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);

  ov.querySelector('#closeOutcome').onclick = ()=> ov.remove();
  ov.querySelector('#applyMine').onclick = async ()=>{
    try {
      await applyRecommendedToMyBoard({ gameId, mySeat });
      ov.remove();
    } catch (e) {
      console.error('[OutcomeOverlay] apply failed', e);
      showToast('Could not apply outcome (see console).');
    }
  };
}

// Apply the saved recommended outcome to *my* board only.
// Moves my dead blockers from Table -> Graveyard and persists via Storage.saveSnapshot.
export async function applyRecommendedToMyBoard({ gameId, mySeat } = {}) {
  const gid  = String(gameId || (window.AppState?.gameId ?? ''));
  const seat = Number(mySeat ?? window.AppState?.mySeat ?? 0);
  if (!gid || !seat) { console.warn('[applyRecommendedToMyBoard] missing gid/seat'); return; }

  // Read the merged combat doc (CombatStore first, Storage fallback)
  const current = await (async () => {
    try { const a = await CombatStore.read(gid); if (a) return a; } catch(_) {}
    try { return await window.StorageAPI?.readCombat?.(gid); } catch(_) {}
    return null;
  })();

  const ro = current?.recommendedOutcome;
  const deadByAttack = ro?.deadByAttack || {};
  const deadMine = new Set();

  // Collect ONLY my dead blockers
  for (const list of Object.values(deadByAttack)) {
    for (const cid of (list || [])) {
      const card = (window.AppState?.table || []).find(c => String(c.id) === String(cid));
      const ctrl = Number(card?.controllerSeat ?? window.AppState?.mySeat ?? seat);
      if (card && ctrl === seat) deadMine.add(String(cid));
    }
  }

  if (!deadMine.size) {
    showToast('Nothing to apply to your board.');
    return;
  }

  // Mutate local UI state
  const S = window.AppState || {};
  const nextTable = [];
  S.gy = Array.isArray(S.gy) ? S.gy : [];
  for (const card of (S.table || [])) {
    if (deadMine.has(String(card.id))) {
      S.gy.push(card);
    } else {
      nextTable.push(card);
    }
  }
  S.table = nextTable;

  // Persist my new state (Table/GY) to Firestore so others see it
  try {
    await window.StorageAPI?.saveSnapshot?.(gid, seat, S);
  } catch (e) {
    console.error('[applyRecommendedToMyBoard] saveSnapshot failed', e);
  }

  // Mark that I’ve applied on my side (purely informational)
  try {
    await CombatStore.write(gid, { applied: { [seat]: true } });
  } catch (_) {
    try { await window.StorageAPI?.writeCombat?.(gid, { applied: { [seat]: true } }); } catch(_){}
  }

  showToast('Applied to your board.');
}


/* ------------------------------------------------------
   Poller for recommendedOutcome (CombatStore only)
------------------------------------------------------ */
export function startCombatPoller(gameId){
  let lastEpoch = 0;
  const unsub = CombatStore.onChange(gameId, (data)=>{
    if (!data?.recommendedOutcome) return;

    const mySeat = Number(window.AppState?.mySeat || 0);
    if (data.applied && data.applied[mySeat]) return; // I already applied

    const ro = data.recommendedOutcome;
    const roEpoch = Number(ro.epoch || data.epoch || 0);
    if (!roEpoch || roEpoch === lastEpoch) return;

    lastEpoch = roEpoch;
    const notes = Array.isArray(ro.notesHtml) ? ro.notesHtml : [];
    showOutcomeOverlay({ notes, gameId, mySeat });
  });
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
