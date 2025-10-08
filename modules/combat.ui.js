// ================================
// FILE: modules/combat.ui.js
// ================================
// - Defender overlay now DUMPS the entire attacker player_state
//   as soon as it opens (StorageAPI → supabase-js → REST).
// - Uses the same flattened state shape your other modules use:
//   state.Table || state.table
// - Still renders the same overlays.
// ================================

import { CombatStore } from './combat.store.js';
import { resolveCombatDamage } from './battle.js';

/* ----------------------------------
   small helpers
---------------------------------- */

function showToast(msg){
  if (typeof window.showToast === 'function') return window.showToast(msg);
  console.log('[toast]', msg);
}

const getAppState = () => window.AppState || {};
const getGameId   = () =>
  String(getAppState().gameId || document.querySelector('#game')?.value || '');
const getSeatNow  = (fallback) => {
  const s = getAppState().mySeat ?? document.querySelector('#mySeat')?.value;
  return Number(s ?? fallback ?? 0);
};
const getTable = () => {
  const S = getAppState();
  return Array.isArray(S.table) ? S.table : [];
};
const getById = (cid) => getTable().find(c => String(c.id) === String(cid));

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

// commander zone filter (kept minimal)
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



/* ----------------------------------
   RAW DUMP of a seat’s player_state
   (StorageAPI → supabase-js → REST)
---------------------------------- */
async function dumpPlayerState(gid, seat){
  // 1) StorageAPI (fast path)
  try{
    const ps = await window.StorageAPI?.loadPlayerState?.(String(gid), Number(seat));
    if (ps){
      const state = (ps && typeof ps === 'object' && 'state' in ps && ps.state) ? ps.state : ps;
      const tableLen = Array.isArray(state?.Table) ? state.Table.length :
                       Array.isArray(state?.table) ? state.table.length : 0;
      console.group(`[defender.psdump] SOURCE=StorageAPI (gid=${gid}, seat=${seat})`);
      console.log('state:', state);
      console.log('table length:', tableLen);
      console.groupEnd();
      return state;
    }
  }catch(e){
    console.warn('[defender.psdump] StorageAPI failed', { gid, seat, err:e });
  }

  // 2) supabase-js
  if (window.supabase){
    try{
      const { data, error } = await window.supabase
        .from('player_states')
        .select('state, updated_at')
        .eq('game_id', String(gid))
        .eq('seat', Number(seat))
        .maybeSingle();
      if (error) throw error;
      const state = data?.state || null;
      const tableLen = Array.isArray(state?.Table) ? state.Table.length :
                       Array.isArray(state?.table) ? state.table.length : 0;
      console.group(`[defender.psdump] SOURCE=supabase-js (gid=${gid}, seat=${seat})`);
      console.log('updated_at:', data?.updated_at);
      console.log('state:', state);
      console.log('table length:', tableLen);
      console.groupEnd();
      if (state) return state;
    }catch(e){
      console.warn('[defender.psdump] supabase-js failed', { gid, seat, err:e });
    }
  }

  // 3) REST
  if (window.SUPABASE_URL && window.SUPABASE_KEY){
    try{
      const url = `${window.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/player_states`
        + `?select=state,updated_at&game_id=eq.${encodeURIComponent(String(gid))}&seat=eq.${Number(seat)}`;
      const res = await fetch(url, {
        headers: {
          apikey: window.SUPABASE_KEY,
          Authorization: `Bearer ${window.SUPABASE_KEY}`,
          Accept: 'application/json',
        }
      });
      if (!res.ok){
        const txt = await res.text().catch(()=> '');
        throw new Error(`[REST ${res.status}] ${txt}`);
      }
      const rows = await res.json();
      const state = rows?.[0]?.state || null;
      const tableLen = Array.isArray(state?.Table) ? state.Table.length :
                       Array.isArray(state?.table) ? state.table.length : 0;
      console.group(`[defender.psdump] SOURCE=REST (gid=${gid}, seat=${seat})`);
      console.log('updated_at:', rows?.[0]?.updated_at);
      console.log('state:', state);
      console.log('table length:', tableLen);
      console.groupEnd();
      return state;
    }catch(e){
      console.warn('[defender.psdump] REST failed', { gid, seat, err:e });
    }
  }

  console.warn('[defender.psdump] NO STATE FOUND', { gid, seat });
  return null;
}

/* ----------------------------------
   Read a seat table with same shape
---------------------------------- */
// --- pasteable helper (safe to inline near your overlay code) ---
function normalizeId(raw) {
  if (raw == null) return '';
  let s = String(raw);
  const ix = s.indexOf('_');
  if (ix > -1) s = s.slice(0, ix);   // drop "_suffix"
  if (s.startsWith('card-')) s = s.slice(5);
  return s;
}

async function readSeatTableStrict(gid, seat) {
  // 1) try your in-memory/StorageAPI cache
  try {
    const ps = await window.StorageAPI?.loadPlayerState?.(String(gid), Number(seat));
    const arr = Array.isArray(ps?.Table) ? ps.Table : (Array.isArray(ps?.table) ? ps.table : []);
    console.log('[fetchAttackerCard] StorageAPI table', { gid, seat, rows: arr.length });
    if (arr.length) return arr;
  } catch (e) {
    console.warn('[fetchAttackerCard] StorageAPI.loadPlayerState failed', { gid, seat, err: e });
  }

  // 2) fall back to Supabase (js client first, then REST)
  try {
    if (window.supabase) {
      const { data, error } = await window.supabase
        .from('player_states')
        .select('state')
        .eq('game_id', String(gid))
        .eq('seat', Number(seat))
        .maybeSingle();
      if (error) throw error;
      const state = data?.state || null;
      const arr = Array.isArray(state?.Table) ? state.Table : (Array.isArray(state?.table) ? state.table : []);
      console.log('[fetchAttackerCard] supabase-js table', { gid, seat, rows: arr.length });
      return arr || [];
    }
  } catch (e) {
    console.warn('[fetchAttackerCard] supabase-js failed', { gid, seat, err: e });
  }

  try {
    if (window.SUPABASE_URL && window.SUPABASE_KEY) {
      const url = `${window.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/player_states`
        + `?select=state&game_id=eq.${encodeURIComponent(String(gid))}&seat=eq.${Number(seat)}`;
      const res = await fetch(url, {
        headers: {
          apikey: window.SUPABASE_KEY,
          Authorization: `Bearer ${window.SUPABASE_KEY}`,
          Accept: 'application/json',
        }
      });
      if (!res.ok) throw new Error(`[REST ${res.status}] ${await res.text().catch(()=> '')}`);
      const rows = await res.json();
      const state = rows?.[0]?.state || null;
      const arr = Array.isArray(state?.Table) ? state.Table : (Array.isArray(state?.table) ? state.table : []);
      console.log('[fetchAttackerCard] supabase REST table', { gid, seat, rows: arr.length });
      return arr || [];
    }
  } catch (e) {
    console.warn('[fetchAttackerCard] supabase REST failed', { gid, seat, err: e });
  }

  console.warn('[fetchAttackerCard] no table found', { gid, seat });
  return [];
}

// --- THE FUNCTION YOU ASKED FOR ---
export async function fetchAttackerCard({ gid, attackerSeat, cid }) {
  const want = String(cid);
  const base = normalizeId(want);

  const tableArr = await readSeatTableStrict(gid, attackerSeat);

  // debug preview
  console.log('[fetchAttackerCard] comparing against attacker table', {
    gid, attackerSeat, want, base,
    preview: tableArr.slice(0, 8).map(c => c.id)
  });

  const found = tableArr.find(c => {
    const idRaw  = String(c.id);
    const pidRaw = c.persistentId ? String(c.persistentId) : '';

    const idBase  = normalizeId(idRaw);
    const pidBase = normalizeId(pidRaw);

    // exacts OR normalized matches
    return (
      idRaw  === want || idRaw  === base ||
      idBase === want || idBase === base ||
      pidRaw === want || pidRaw === base ||
      pidBase === want || pidBase === base
    );
  }) || null;

  if (!found) {
    console.warn('[fetchAttackerCard] MISS', {
      gid, attackerSeat, cid: want, base,
      tried: ['StorageAPI', 'Supabase (js/REST)'],
      tableCount: tableArr.length
    });
  } else {
    console.log('[fetchAttackerCard] HIT', {
      gid, attackerSeat, want, base,
      matchedId: String(found.id), name: found.name
    });
  }

  return found;
}


/* ----------------------------------
   Find attacker card on ATTACKER seat
---------------------------------- */


/* ------------------------------------------------------
   Attacker overlay (kept simple; unchanged look)
------------------------------------------------------ */
export async function openAttackerOverlay({ gameId, mySeat }) {
  const gid  = String(gameId || getGameId());
  const seat = Number(mySeat ?? getSeatNow());

  // singleton
  const old = document.getElementById('combatAtkOverlay');
  if (old) old.remove();

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

  // candidates from MY table
  const table = getTable().filter(c => isCreature(c) && !isInCommanderZone(c.id));

  // find all opponent seats
  const playerCount = Number(getAppState().playerCount || 2);
  const oppSeats = Array.from({length: playerCount}, (_,i)=>i+1).filter(s => s !== seat);

  // load any previous choices
  const prev = await CombatStore.read(gid).catch(()=>null);
  const previousMap = {};
  if (prev?.attacks){
    for (const [cid, row] of Object.entries(prev.attacks)){
      if (Number(row?.attackerSeat) === seat){
        previousMap[cid] = Number(row.defenderSeat || NaN) || null;
      }
    }
  }
  let choices = { ...previousMap };

  const scroller = ov.querySelector('#scroller');
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
  scroller.innerHTML = table.map(rowHtml).join('');

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
      });
    });
  };

  ov.querySelector('#confirmAtk').onclick = async () => {
    try{
      const trimmed = {};
      for (const [cid, defSeat] of Object.entries(choices)){
        if (defSeat != null && !isNaN(defSeat)) {
          const base = normalizeId(cid);
          trimmed[base] = { attackerSeat: seat, defenderSeat: Number(defSeat) };
        }
      }
      await CombatStore.write(gid, {
        attacks: trimmed,
        applied: {},
        recommendedOutcome: null,
        epoch: Date.now()
      });
      await CombatStore.setInitiated(gid, { attackingSeat: seat, phase: 'declare-blockers' });
      showToast('Attacks declared!');
      ov.remove();
    }catch(e){
      console.error('[attacker.confirm] failed', e);
      showToast('Could not confirm attacks (see console).');
    }
  };
}

/* ------------------------------------------------------
   Defender overlay — loads attacking cards and
   dumps attacker player_state(s) up front
------------------------------------------------------ */
export async function openDefenderOverlay({ gameId, mySeat }){
  const gid  = String(gameId || getGameId());
  const seat = Number(mySeat ?? getSeatNow());

  // singleton
  const old = document.getElementById('combatDefOverlay');
  if (old) old.remove();

  // read combat doc
  let combat = null;
  try { combat = await CombatStore.read(gid); } catch(_){}
  if (!combat?.attacks || !Object.keys(combat.attacks).length){
    await new Promise(r => setTimeout(r, 250));
    try { combat = await CombatStore.read(gid); } catch(_){}
  }

  const attacks = combat?.attacks || {};

  // ---- DUMP attacker seat player_state(s) immediately ----
  const attackerSeats = new Set();
  for (const [, meta] of Object.entries(attacks)){
    if (Number(meta?.defenderSeat) === seat && Number(meta?.attackerSeat || 0) > 0){
      attackerSeats.add(Number(meta.attackerSeat));
    }
  }
  if (!attackerSeats.size){
    console.warn('[defender.psdump] No attacker seats targeting you (nothing to dump).', { gid, seat, attacks });
  } else {
    for (const s of attackerSeats){
      await dumpPlayerState(gid, s); // full dump to console
    }
  }
  // --------------------------------------------------------

  const incoming = [];

  // Load attackers targeting ME → fetch each card from the attacker’s seat table
  const tasks = [];
  for (const [cid, meta] of Object.entries(attacks)){
    const defSeat = Number(meta?.defenderSeat || 0);
    const attSeat = Number(meta?.attackerSeat || 0);
    if (!attSeat || defSeat !== seat) continue;

    tasks.push((async () => {
      const card = await fetchAttackerCard({ gid, attackerSeat: attSeat, cid });
      if (card) incoming.push(card);
    })());
  }
  if (tasks.length) await Promise.all(tasks);

  console.log('[combat.ui] defender incoming:', incoming.map(c => ({ id:String(c.id), name:c.name })));

  // my blockers (local table)
  const myBlockers = getTable().filter(c =>
    isCreature(c) &&
    Number(c.controllerSeat || getAppState().mySeat || seat) === seat &&
    !isInCommanderZone(c.id)
  );

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

  // { attackerCid -> [blockerCid,…] }
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
    : `<em>No attackers are assigned to you.</em>`;

  // choose blockers
  scroller.addEventListener('click', (e) => {
    const btn = e.target.closest('.choose-blocker'); if (!btn) return;
    const aCid = String(btn.dataset.att);
    const bCid = String(btn.dataset.bid);
    const list = blocks[aCid] || (blocks[aCid] = []);
    const ix = list.indexOf(bCid);
    if (ix === -1) list.push(bCid); else list.splice(ix,1);
    if (btn.style.outline){
      btn.style.outline = ''; btn.style.boxShadow = '';
    }else{
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
      // trim empties
      const trimmed = {};
      for (const [aCid, arr] of Object.entries(blocks)){
        if (Array.isArray(arr) && arr.length) trimmed[aCid] = arr;
      }
      await CombatStore.saveBlocks(gid, seat, trimmed);

      // minimal recommended outcome (placeholder)
      const epoch = Number(combat?.epoch || Date.now());
      await CombatStore.write(gid, {
        epoch,
        recommendedOutcome: {
          notesHtml: [],
          deadByAttack: {},
          attackerDeadFlags: {},
          playerDamage: {},
          lifelinkGains: {},
          epoch
        },
        applied: {}
      });

      showToast('Blocks submitted!');
      ov.remove();
    }catch(e){
      console.error('[defender.confirm] failed', e);
      showToast('Could not confirm blocks (see console).');
    }
  };
}

/* ------------------------------------------------------
   Poller (lightweight)
------------------------------------------------------ */
export function startCombatPoller(gameId){
  const gid = String(gameId || getGameId());
  window.__combatPollers = window.__combatPollers || {};
  if (window.__combatPollers[gid]){
    try { window.__combatPollers[gid](); } catch(_) {}
  }
  let lastEpoch = 0;
  const unsub = CombatStore.onChange(gid, (data)=>{
    if (!data?.recommendedOutcome) return;
    const roEpoch = Number(data.recommendedOutcome?.epoch || data.epoch || 0);
    if (!roEpoch || roEpoch === lastEpoch) return;
    lastEpoch = roEpoch;
    console.log('[poller] new recommendedOutcome epoch', roEpoch);
  });
  window.__combatPollers[gid] = unsub;
  return unsub;
}

/* ------------------------------------------------------
   Wire the FAB
------------------------------------------------------ */
export function wireBattleFab({ gameId, mySeat, getIsMyTurn, btn }){
  btn.addEventListener('click', () => {
    try{
      const gid  = String(gameId || getGameId());
      const seat = getSeatNow(mySeat);
      const myTurn = typeof getIsMyTurn === 'function' ? !!getIsMyTurn() : false;
      if (myTurn) return openAttackerOverlay({ gameId: gid, mySeat: seat });
      return openDefenderOverlay({ gameId: gid, mySeat: seat });
    }catch(e){
      console.error('[wireBattleFab] failed', e);
    }
  });
}

/* default export (optional) */
export default {
  openAttackerOverlay,
  openDefenderOverlay,
  startCombatPoller,
  wireBattleFab,
};
