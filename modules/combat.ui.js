// ================================
// FILE: modules/combat.ui.js
// ================================

import { CombatStore } from './combat.store.js';
import { resolveCombatDamage } from './battle.js';
 import { Notifications } from './notifications.js';

// Init once and expose globally so other modules can emit
Notifications.init();
window.Notifications = Notifications;

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

function normalizeId(raw) {
  if (raw == null) return '';
  let s = String(raw);
  const ix = s.indexOf('_');
  if (ix > -1) s = s.slice(0, ix);
  if (s.startsWith('card-')) s = s.slice(5);
  return s;
}

function cardElById(cid){
  // try exact
  let el = document.querySelector(`.card[data-id="${cid}"]`);
  if (el) return el;

  // try normalized/base id (handles id with runtime suffixes like id_1234_abc)
  const base = normalizeId(cid);
  if (base) {
    el = document.querySelector(`.card[data-id^="${base}"]`);
    if (el) return el;
  }

  // last-ditch: scan by data-persistent-id if present
  el = document.querySelector(`.card[data-persistent-id="${base}"]`);
  return el || null;
}

function isTapped(card){
  // accept booleans, "true"/"1", numeric 1
  const val = card?.tapped;
  if (val === true || val === 1 || val === '1' || String(val).toLowerCase() === 'true') return true;
  if (card?.ext && (card.ext.tapped === true || String(card.ext.tapped).toLowerCase() === 'true')) return true;

  const el = cardElById(card?.id);
  if (!el) return false;

  // class marker
  if (el.classList?.contains('tapped')) return true;

  // data attributes used in some builds
  const ds = el.dataset || {};
  if (ds.tapped === '1' || ds.tapped === 'true') return true;

  // CSS var used by V2 .cardInner { --tap-rot: 90deg }
  const inner = el.querySelector?.('.cardInner');
  if (inner) {
    const rotVar = getComputedStyle(inner).getPropertyValue('--tap-rot') || '';
    if (/\b90deg\b/.test(rotVar)) return true;
  }

  // plain transform rotate fallback
  const style = getComputedStyle(inner || el);
  const tf = style.transform || '';
  if (/matrix\(.+\)/.test(tf) || /rotate\(/.test(tf)) {
    // if rotated near 90deg (cos ~ 0), treat as tapped
    try {
      // crude parse: matrix(a,b,c,d,tx,ty); a≈0 and b≈±1 when 90deg
      const m = tf.match(/matrix\(([^)]+)\)/);
      if (m) {
        const [a,b] = m[1].split(',').map(Number);
        if (Math.abs(a) < 0.25 && Math.abs(Math.abs(b) - 1) < 0.25) return true;
      }
    } catch(_) {}
  }
  return false;
}



function isCommander(card){
  if (!card) return false;
  if (card.isCommander || card.ext?.isCommander) return true;
  // DOM fallback: a data flag on the element
  const el = cardElById(card.id);
  if (el && el.dataset && (el.dataset.commander === '1' || el.dataset.isCommander === 'true')) return true;
  return false;
}

async function readSeatCommanderStrict(gid, seat){
  // 1) StorageAPI
  try {
    const ps = await window.StorageAPI?.loadPlayerState?.(String(gid), Number(seat));
    const c = ps?.Commander ?? ps?.tableCommander ?? null;
    if (c) { console.log('[readSeatCommander] StorageAPI hit'); return c; }
  } catch(e){ console.warn('[readSeatCommander] StorageAPI fail', e); }

  // 2) supabase-js
  try {
    if (window.supabase){
      const { data, error } = await window.supabase
        .from('player_states').select('state').eq('game_id', String(gid)).eq('seat', Number(seat)).maybeSingle();
      if (error) throw error;
      const st = data?.state || null;
      const c = st?.Commander ?? st?.tableCommander ?? null;
      if (c) { console.log('[readSeatCommander] supabase-js hit'); return c; }
    }
  } catch(e){ console.warn('[readSeatCommander] supabase-js fail', e); }

  // 3) REST
  try {
    if (window.SUPABASE_URL && window.SUPABASE_KEY){
      const url = `${window.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/player_states`
        + `?select=state&game_id=eq.${encodeURIComponent(String(gid))}&seat=eq.${Number(seat)}`;
      const res = await fetch(url, {
        headers: { apikey: window.SUPABASE_KEY, Authorization: `Bearer ${window.SUPABASE_KEY}`, Accept: 'application/json' }
      });
      if (!res.ok) throw new Error(`[REST ${res.status}] ${await res.text().catch(()=> '')}`);
      const rows = await res.json();
      const st = rows?.[0]?.state || null;
      const c = st?.Commander ?? st?.tableCommander ?? null;
      if (c) { console.log('[readSeatCommander] REST hit'); return c; }
    }
  } catch(e){ console.warn('[readSeatCommander] REST fail', e); }

  return null;
}


// Strict hand loader (mirrors readSeatTableStrict)
async function readSeatHandStrict(gid, seat){
  // 1) StorageAPI
  try {
    const ps = await window.StorageAPI?.loadPlayerState?.(String(gid), Number(seat));
    const arr = Array.isArray(ps?.Hand) ? ps.Hand : (Array.isArray(ps?.hand) ? ps.hand : []);
    if (arr.length) { console.log('[readSeatHand] StorageAPI', { rows: arr.length }); return arr; }
  } catch(e){ console.warn('[readSeatHand] StorageAPI fail', e); }

  // 2) supabase-js
  try {
    if (window.supabase){
      const { data, error } = await window.supabase
        .from('player_states').select('state').eq('game_id', String(gid)).eq('seat', Number(seat)).maybeSingle();
      if (error) throw error;
      const st = data?.state || null;
      const arr = Array.isArray(st?.Hand) ? st.Hand : (Array.isArray(st?.hand) ? st.hand : []);
      console.log('[readSeatHand] supabase-js', { rows: arr.length });
      return arr || [];
    }
  } catch(e){ console.warn('[readSeatHand] supabase-js fail', e); }

  // 3) REST
  try {
    if (window.SUPABASE_URL && window.SUPABASE_KEY){
      const url = `${window.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/player_states`
        + `?select=state&game_id=eq.${encodeURIComponent(String(gid))}&seat=eq.${Number(seat)}`;
      const res = await fetch(url, {
        headers: { apikey: window.SUPABASE_KEY, Authorization: `Bearer ${window.SUPABASE_KEY}`, Accept: 'application/json' }
      });
      if (!res.ok) throw new Error(`[REST ${res.status}] ${await res.text().catch(()=> '')}`);
      const rows = await res.json();
      const st = rows?.[0]?.state || null;
      const arr = Array.isArray(st?.Hand) ? st.Hand : (Array.isArray(st?.hand) ? st.hand : []);
      console.log('[readSeatHand] REST', { rows: arr.length });
      return arr || [];
    }
  } catch(e){ console.warn('[readSeatHand] REST fail', e); }

  console.warn('[readSeatHand] no hand found');
  return [];
}

function getCommanderFromAnywhere(){
  // 1) Prefer a live object on the table if present
  const table = getTable();
  const found = table.find(c => isCommander(c));
  if (found) return found;

  // 2) V2 keeps this in AppState.tableCommander
  const S = getAppState();
  if (S && S.tableCommander) return S.tableCommander;

  // 3) DOM fallback: if a card sits in #cmdZone, try to read the ref directly
  const cmdEl = document.querySelector('#cmdZone .card');
  if (!cmdEl) return null;

  // Try to pull the bound card object (your renderer stores refs on elements)
  const ref = cmdEl.__cardRef || null;
  if (ref) return ref;

  // Last-ditch: build a stub from dataset so at least id is usable
  const cid = cmdEl.getAttribute('data-id');
  if (!cid) return null;
  return getById(cid) || { id: cid, name: 'Commander', ext: { isCommander: true } };
}



function computePT(card){
  const fromPair = (s) => {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^\s*(-?\d+)\s*\/\s*(-?\d+)\s*$/);
    return m ? { power: Number(m[1]), toughness: Number(m[2]) } : null;
  };

  // 1) live value first (several places we’ve seen in your logs)
  const live =
    fromPair(card?.pt) ||
    fromPair(card?.ext?.pt) ||
    fromPair(card?._scry?.pt);

  if (live) return live;

  // 2) face / legacy paths
  const f = activeFace(card);
  const p = f.power ?? card.power ?? card._scry?.power ?? card._scry?.faces?.[0]?.power ?? '';
  const t = f.toughness ?? card.toughness ?? card._scry?.toughness ?? card._scry?.faces?.[0]?.toughness ?? '';

  return { power: Number(p || 0), toughness: Number(t || 0) };
}

function isCreature(card){
  const tl = (activeFace(card).type_line || card._scry?.type_line || '').toLowerCase();
  return tl.includes('creature');
}
function rectsOverlap(a,b){ return !(a.right<b.left || a.left>b.right || a.bottom<b.top || a.top>b.bottom); }

function isInCommanderZone(cid){
  const el = cardElById(String(cid));
  const cmd = document.getElementById('cmdZone');
  if (!el || !cmd) return false;
  const cr = el.getBoundingClientRect();
  const zr = cmd.getBoundingClientRect();
  return rectsOverlap(cr, zr);
}



/* ----------------------------------
   Seat table readers (StorageAPI → SB-js → REST)
---------------------------------- */

async function readSeatTableStrict(gid, seat) {
  try {
    const ps = await window.StorageAPI?.loadPlayerState?.(String(gid), Number(seat));
    const arr = Array.isArray(ps?.Table) ? ps.Table : (Array.isArray(ps?.table) ? ps.table : []);
    console.log('[fetchAttackerCard] StorageAPI table', { gid, seat, rows: arr.length });
    if (arr.length) return arr;
  } catch (e) {
    console.warn('[fetchAttackerCard] StorageAPI.loadPlayerState failed', { gid, seat, err: e });
  }

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

/* ----------------------------------
   Attacker card fetch (id / persistentId; normalized)
---------------------------------- */
export async function fetchAttackerCard({ gid, attackerSeat, cid }) {
  const want = String(cid);
  const base = normalizeId(want);

  const tableArr = await readSeatTableStrict(gid, attackerSeat);

  console.log('[fetchAttackerCard] comparing against attacker table', {
    gid, attackerSeat, want, base,
    preview: tableArr.slice(0, 8).map(c => c.id)
  });

  const found = tableArr.find(c => {
    const idRaw  = String(c.id);
    const pidRaw = c.persistentId ? String(c.persistentId) : '';

    const idBase  = normalizeId(idRaw);
    const pidBase = normalizeId(pidRaw);

    return (
      idRaw  === want || idRaw  === base ||
      idBase === want || idBase === base ||
      pidRaw === want || pidRaw === base ||
      pidBase === want || pidBase === base
    );
  }) || null;

  if (!found) {
   // Commander fallback: check seat’s commander object
   const cmd = await readSeatCommanderStrict(gid, attackerSeat);
   if (cmd) {
     const idRaw  = String(cmd.id || '');
     const pidRaw = cmd.persistentId ? String(cmd.persistentId) : '';
     const idBase  = normalizeId(idRaw);
     const pidBase = normalizeId(pidRaw);
     const match =
       idRaw === want || idRaw === base ||
       idBase === want || idBase === base ||
       pidRaw === want || pidRaw === base ||
       pidBase === want || pidBase === base;
     if (match) {
       console.log('[fetchAttackerCard] HIT (commander zone)', {
         gid, attackerSeat, want, base, matchedId: String(cmd.id), name: cmd.name
       });
       return cmd;
     }
   }
   console.warn('[fetchAttackerCard] MISS', {
     gid, attackerSeat, cid: want, base,
     tried: ['StorageAPI', 'Supabase (js/REST)'],
     tableCount: tableArr.length,
     commanderChecked: !!cmd
   });
 } else {
    console.log('[fetchAttackerCard] HIT', {
      gid, attackerSeat, want, base,
      matchedId: String(found.id), name: found.name
    });
  }

  return found;
}



export async function clearCombatAttacks(gid = String(window.AppState?.gameId || '')) {
  const epoch = Date.now();
  await CombatStore.write(gid, {
    attacks: {},
    recommendedOutcome: null,
    applied: {},
    epoch
  });
  window.__combatEpochFloor = window.__combatEpochFloor || {};
  window.__combatEpochFloor[gid] = Math.max(window.__combatEpochFloor[gid] || 0, epoch);
  console.log('[combat] attacks cleared for', gid, 'epoch', epoch);
}

window.clearCombatAttacks = clearCombatAttacks; // console convenience
// ---------------------------------------------------------

// Hard-clear the recommended outcome (and applied flags)
async function clearOutcome(gid = String(window.AppState?.gameId || '')) {
  try {
    const epoch = Date.now();
    await CombatStore.write(gid, {
      recommendedOutcome: null,
      applied: {},
      epoch
    });
    // remember the "floor" so we ignore stale events that come in later
    window.__combatEpochFloor = window.__combatEpochFloor || {};
    window.__combatEpochFloor[gid] = Math.max(window.__combatEpochFloor[gid] || 0, epoch);
    console.log('[combat] recommendedOutcome cleared for', gid, 'epoch', epoch);
  } catch (e) {
    console.warn('[clearOutcome] failed', e);
  }
}



/* ------------------------------------------------------
   Attacker overlay (declare attackers)
------------------------------------------------------ */
export async function openAttackerOverlay({ gameId, mySeat }) {
  const gid  = String(gameId || getGameId());
  const seat = Number(mySeat ?? getSeatNow());

  const old = document.getElementById('combatAtkOverlay');
  if (old) old.remove();
 // ⬇️ NEW: clear any stale attacks immediately when opening
  try { await clearCombatAttacks(gid); } catch (e) { console.warn('[openAttackerOverlay] clearCombatAttacks failed', e); }

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

  // allow commander even if it's in the commander zone; exclude any tapped
const table = getTable().filter(c => {
  if (!isCreature(c)) return false;
  if (isTapped(c)) return false;
  // normally exclude commander-zone cards unless it *is* the commander
  if (isInCommanderZone(c.id) && !isCommander(c)) return false;
  return true;
});

const cmd = getCommanderFromAnywhere?.();
if (cmd && !isTapped(cmd)) {
  // if commander has a specific controllerSeat, ensure it's mine
  const mine = Number(cmd.controllerSeat ?? getAppState().mySeat ?? seat) === seat;
  if (mine) {
    const present = table.some(c => String(c.id) === String(cmd.id));
    if (!present) table.unshift(cmd);
  }
}


  const playerCount = Number(getAppState().playerCount || 2);
  const oppSeats = Array.from({length: playerCount}, (_,i)=>i+1).filter(s => s !== seat);

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

 // Attacker overlay: choose defender seat per row
scroller.addEventListener('click', (e) => {
  const btn = e.target.closest('.choose');  if (!btn) return;
  const row = e.target.closest('.atk-row'); if (!row) return;

  const cid = String(row.dataset.cid);
  const targetSeat = btn.dataset.target; // "" means “don’t attack”

  // update the in-memory choice
  choices[cid] = (targetSeat === '' ? null : Number(targetSeat));

  // clear previous styling in this row
  row.querySelectorAll('.choose').forEach(b => {
    b.style.outline = '';
    b.style.boxShadow = '';
  });

  // highlight the selected one
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

  // --- helper: snapshot cog-wheel edits + effective P/T for a given card
  function bakeAttackSnapshot(card){
    if (!card) return null;
    // runtime/ext extras
    const effects = Array.isArray(card._extraEffects) ? [...card._extraEffects]
                   : Array.isArray(card.ext?.effects) ? [...card.ext.effects] : [];
    const types   = Array.isArray(card._extraTypes) ? [...card._extraTypes]
                   : Array.isArray(card.ext?.types) ? [...card.ext.types] : [];
    const chosenType = card._chosenType || card.ext?.chosenType || '';
    const ptMod = {
      p: Number(card._ptMod?.p ?? card.ext?.ptMod?.p ?? 0),
      t: Number(card._ptMod?.t ?? card.ext?.ptMod?.t ?? 0),
    };
    // effective P/T = base face (or scry) + ptMod
    const f = activeFace(card) || {};
    const baseP = Number(f.power ?? card.power ?? card._scry?.power ?? card._scry?.faces?.[0]?.power ?? 0);
    const baseT = Number(f.toughness ?? card.toughness ?? card._scry?.toughness ?? card._scry?.faces?.[0]?.toughness ?? 0);
    const effP  = (isFinite(baseP) ? baseP : 0) + Number(ptMod.p || 0);
    const effT  = (isFinite(baseT) ? baseT : 0) + Number(ptMod.t || 0);
    const oracle = (card?._scry?.oracle_text || card?.oracle_text || card?._faces?.[0]?.oracle_text || '').toLowerCase();
    const hasLifelink = effects.some(e => String(e).toLowerCase().includes('lifelink')) || oracle.includes('lifelink');
    return {
      pt: { power: effP, toughness: effT },
      ptMod,
      effects,
      types,
      chosenType,
      hasLifelink
    };
  }

  // Hard clear of the combat doc’s attack set (and any stale outcome/applied)
  async function clearAttacksDoc(gid){
  const epoch = Date.now();
  await CombatStore.write(gid, {
    attacks: {},
    recommendedOutcome: null,
    applied: {},
    epoch
  });
  window.__combatEpochFloor = window.__combatEpochFloor || {};
  window.__combatEpochFloor[gid] = Math.max(window.__combatEpochFloor[gid] || 0, epoch);
}


  ov.querySelector('#confirmAtk').onclick = async () => {
  try{
    // build fresh selection (normalize ids) + attach snapshots
    const trimmed = {};
    //use the same augmented list we rendered (includes commander)
  const tableByBase = new Map((table || []).map(c => [normalizeId(c.id), c]));
    for (const [cid, defSeat] of Object.entries(choices)){
      if (defSeat != null && !isNaN(defSeat)) {
        const base = normalizeId(cid);
        const card = tableByBase.get(base);
        const snapshot = bakeAttackSnapshot(card);
        trimmed[base] = {
          attackerSeat: seat,
          defenderSeat: Number(defSeat),
          snapshot,
		  name: card?.name || ''
        };
        console.log('[attacker.confirm] snapshot', { base, name: card?.name, snapshot });
      }
    }

   // ⚡ Emit first so everyone sees the banner immediately (AWAIT + LOG)
try {
  if (!window.Notifications || typeof window.Notifications.emit !== 'function') {
    throw new Error('window.Notifications.emit missing (init/import?)');
  }
  const count = Object.keys(trimmed).length;
  console.log('[notif] push → combat_initiated', { gameId: gid, seat, count });
  const res = await window.Notifications.emit('combat_initiated', {
    gameId: gid,
    seat,
    payload: { count }
  });
  console.log('[notif] insert ok', res);
} catch (e) {
  console.error('[notif] insert FAILED (combat_initiated)', e);
}


    // 1) clear first to drop any stale keys (exactly like your console helper)
    await clearAttacksDoc(gid);

    // 2) give the backend a breath so debouncers/replication settle
    await new Promise(r => setTimeout(r, 150));

    // 3) write the new set (full replace at the top-level `attacks` key)
    console.log('[CombatStore.write] attacks payload', { gid, seat, attacks: trimmed });
    await CombatStore.write(gid, {
      attacks: trimmed,
      applied: {},
      recommendedOutcome: null,
      epoch: Date.now()
    });

    // optional: mark initiated in the combats row (kept after emit so UI is fast)
    await CombatStore.setInitiated(gid, { attackingSeat: seat });

    showToast('Attacks declared!');
    ov.remove();
  }catch(e){
    console.error('[attacker.confirm] failed', e);
    showToast('Could not confirm attacks (see console).');
  }
};









}

function blockersForSeat(seat){
  return getTable().filter(c =>
    isCreature(c) &&
    Number(c.controllerSeat ?? getAppState().mySeat ?? seat) === seat &&
    !isTapped(c) &&                                       // ⬅️ HARD FILTER: tapped never included
    (!isInCommanderZone(c.id) || isCommander(c))
  );
}





/* ------------------------------------------------------
   Defender overlay — choose blockers, compute outcome
------------------------------------------------------ */
export async function openDefenderOverlay({ gameId, mySeat }){
  const gid  = String(gameId || getGameId());
  const seat = Number(mySeat ?? getSeatNow());

  const old = document.getElementById('combatDefOverlay');
  if (old) old.remove();

  let combat = null;
  try { combat = await CombatStore.read(gid); } catch(_){}
  if (!combat?.attacks || !Object.keys(combat.attacks).length){
    await new Promise(r => setTimeout(r, 250));
    try { combat = await CombatStore.read(gid); } catch(_){}
  }

  const attacks = combat?.attacks || {};
  const incoming = [];

  // Load attackers targeting ME
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

let myBlockers = blockersForSeat(seat);
const cmd2 = getCommanderFromAnywhere();
// keep commander if present and untapped (without duplicating)
if (cmd2 && !isTapped(cmd2)) {
  const mine = Number(cmd2.controllerSeat || getAppState().mySeat || seat) === seat;
  if (mine) {
    const present = myBlockers.some(c => String(c.id) === String(cmd2.id));
    if (!present) myBlockers.unshift(cmd2);
  }
}



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

  const blocks = {}; // { attackerCid -> [blockerCid,…] }

  function attackerRowHtml(a){
    const { power, toughness } = computePT(a);
    const img = a.frontImg || a._faces?.[0]?.image || '';
    const cid = normalizeId(a.id);
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

  // Attacker overlay: choose defender seat per row
scroller.addEventListener('click', (e) => {
  const btn = e.target.closest('.choose-blocker'); if (!btn) return;
  const aCid = normalizeId(btn.dataset.att);
  const bCid = String(btn.dataset.bid);

  // FINAL GATE: if it’s tapped now, it cannot be selected.
  // commander might not be in AppState.table → fall back to cmd2
  const blockerObj = getById(bCid) || (cmd2 && String(cmd2.id) === bCid ? cmd2 : null);

  if (!blockerObj || isTapped(blockerObj)) {
    showToast('That creature is tapped and cannot block.');
    return;
  }

  const list = (blocks[aCid] ||= []);
  const ix = list.indexOf(bCid);
  if (ix === -1) list.push(bCid); else list.splice(ix, 1);

  if (btn.style.outline){
    btn.style.outline = ''; btn.style.boxShadow = '';
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
  try {
    // 1) Trim empties and normalize keys
    const trimmed = {};
    for (const [aCid, arr] of Object.entries(blocks)) {
      const key = normalizeId(aCid);
      if (Array.isArray(arr) && arr.length) trimmed[key] = arr.map(String);
    }

    // 2) Hard clear *my seat’s* previous blocks, then write the new set
    await CombatStore.saveBlocks(gid, seat, {});        // wipe my old blocks
    await CombatStore.saveBlocks(gid, seat, trimmed);   // save fresh

    // 3) Recompute recommended outcome (now honoring snapshots)
    const attacksMap = (await CombatStore.read(gid))?.attacks || {};
    const notesHtml = [];
    const deadByAttack = {};
    const attackerDeadFlags = {};
    const playerDamage = {};
    const lifelinkGains = {};

    const addDmg  = (s,n)=>{ if(!n) return; playerDamage[s]=(playerDamage[s]||0)+n; };
    const addHeal = (s,n)=>{ if(!n) return; lifelinkGains[s]=(lifelinkGains[s]||0)+n; };
    const oracleText = (card)=>
      (card?._scry?.oracle_text || card?.oracle_text || card?._faces?.[0]?.oracle_text || '').toLowerCase();
    const hasLL = (card, snapshot)=> {
      if (snapshot && typeof snapshot.hasLifelink === 'boolean') return snapshot.hasLifelink;
      // fallback: effects array or oracle text
      if (snapshot?.effects?.some?.(e => String(e).toLowerCase().includes('lifelink'))) return true;
      return oracleText(card).includes('lifelink');
    };

    // helper: apply snapshot PT override to a card (without mutating original)
    const withSnapshotPT = (card, snap) => {
      if (!snap?.pt) return card;
      const clone = { ...card };
      // Publish a live "P/T" so battle.getPT picks it up regardless of source
      clone.pt = `${Number(snap.pt.power)||0}/${Number(snap.pt.toughness)||0}`;
      // Also reflect ptMod for any code that uses it
      clone._ptMod = snap.ptMod || clone._ptMod;
      if (clone.ext) clone.ext.ptMod = snap.ptMod || clone.ext.ptMod;
      return clone;
    };

    for (const [aCid, meta] of Object.entries(attacksMap)) {
      const patt = Number(meta?.attackerSeat || 0);
      const pdef = Number(meta?.defenderSeat || 0);
      if (pdef !== seat) continue;

      const attackerRaw = await fetchAttackerCard({ gid, attackerSeat: patt, cid: aCid });
      if (!attackerRaw) continue;

      const key = normalizeId(aCid);
      const bList = (trimmed[key] || []).map(getById).filter(Boolean);

      // pull snapshot written at attack time
      const snap = meta?.snapshot || null;
      const attacker = withSnapshotPT(attackerRaw, snap);

      // DEBUG: show what we’re using for calc
      try {
        const { power: atkP_dbg, toughness: atkT_dbg } = computePT(attacker);
        console.log('[combat calc] attacker', {
          aCid: key, name: attacker?.name, fromSnapshot: !!snap,
          ptUsed: { power: atkP_dbg, toughness: atkT_dbg },
          rawSnapshot: snap
        });
        console.log('[combat calc] blockers',
          bList.map(b => ({ id: String(b.id), name: b.name, pt: computePT(b) })));
      } catch(_){}

      const result = resolveCombatDamage(attacker, bList);
      const deadBlockers = Array.from(result.deadBlockers || []);
      const attackerDead = !!result.attackerDead;

      // Keep store-friendly maps
      deadByAttack[key] = deadBlockers.map(String);
      attackerDeadFlags[key] = attackerDead;

      // Bubble up any resolver-provided effect notes (first strike / trample, etc.)
      if (Array.isArray(result?.notes) && result.notes.length) {
        notesHtml.push(...result.notes);
      }

      // Compute summary + lifelink rules
      const { power: atkP } = computePT(attacker);
const unblocked = !bList.length && !attackerDead;
      if (!bList.length) {
        // Unblocked: attacker deals atkP to the player; lifelink heals for atkP
        if (atkP > 0) {
          addDmg(pdef, atkP);
          if (hasLL(attacker, snap)) addHeal(patt, atkP);
        }
            } else {
        // Blocked: lifelink still triggers if the attacker actually assigns damage.
        // The only time it doesn't is when FIRST STRIKE killed the attacker before it could deal.
        const firstStrikeKill =
          !!attackerDead &&
          Array.isArray(result?.notes) &&
          result.notes.some(n => n.includes('kills') && n.includes('(first strike)') && n.includes(attacker.name));

        if (!firstStrikeKill && hasLL(attacker, snap) && atkP > 0) {
          // Attacker still assigns total damage equal to its power among blockers → lifelink heals for atkP.
          addHeal(patt, atkP);
          // 🔔 Make it visible in the Recommended list:
          notesHtml.push(`(P${patt}) ${attacker.name} gains ${atkP} life (lifelink)`);
        }
      }



      // Names for UI
      const diedNames = bList
        .filter(b => deadBlockers.includes(String(b.id)))
        .map(b => b.name)
        .join(', ');

      // Deathtouch tag helper
      const hasDT = (card, snapshot) => {
        const effs = (snapshot?.effects || []).map(e => String(e).toLowerCase());
        const otxt = (card?._scry?.oracle_text || card?.oracle_text || card?._faces?.[0]?.oracle_text || '').toLowerCase();
        return effs.includes('deathtouch') || otxt.includes('deathtouch');
      };
      const dtTag = (card, snap) => hasDT(card, snap) ? ' (deathtouch)' : '';

      if (attackerDead && diedNames) {
        notesHtml.push(`(P${pdef}) ${diedNames} trade with (P${patt}) ${attacker.name}${dtTag(attacker, snap)}`);
      } else if (attackerDead) {
        notesHtml.push(`(P${pdef}) blockers kill (P${patt}) ${attacker.name}${dtTag(attacker, snap)}`);
      } else if (diedNames) {
        // Check if any blocker had DT and died interactions
        const anyBlockerDT = bList.some(b => hasDT(b));
        const extra = anyBlockerDT ? ' (deathtouch)' : '';
        notesHtml.push(`(P${patt}) ${attacker.name} kills (P${pdef}) ${diedNames}${extra}`);
      } else if (unblocked) {
        notesHtml.push(`(P${patt}) ${attacker.name} is unblocked → P${pdef} takes ${atkP}${hasLL(attacker, snap) ? ' (lifelink)' : ''}`);
      } else {
        notesHtml.push(`(P${patt}) ${attacker.name} is blocked — no deaths`);
      }

      // Debug for effect visibility
      console.log('[combat calc:summary]', {
        attacker: { id: key, name: attacker?.name, atkP, unblocked, attackerDead },
        deadBlockers: deadBlockers.map(String),
        lifelink: hasLL(attacker, snap)
      });

    }

    const epoch = Date.now();
const recommendedOutcome = {
  notesHtml,
  deadByAttack,
  attackerDeadFlags,
  playerDamage,
  lifelinkGains,
  epoch
};

// Persist so other seats see it via poller
await CombatStore.write(gid, {
  epoch,
  recommendedOutcome,
  applied: {}                  // nobody has applied yet
});


// Open review overlay for me (defender)
showOutcomeOverlay({ data: { attacks: attacksMap, recommendedOutcome }, gameId: gid, mySeat: seat });
showToast('Blocks submitted!');
ov.remove();

  } catch (e) {
    console.error('[defender.confirm] failed', e);
    showToast('Could not confirm blocks (see console).');
  }
};


}

/* ------------------------------------------------------
   Outcome review + Apply
------------------------------------------------------ */
export function showOutcomeOverlay({ data, gameId, mySeat }) {
  const gid  = String(gameId || getGameId());
  const seat = Number(mySeat ?? getSeatNow());

  const attacks = data?.attacks || {};
  const ro = data?.recommendedOutcome || {};
  const deadByAttack = ro.deadByAttack || {};
  const attackerDeadFlags = ro.attackerDeadFlags || {};
  const playerDamage = ro.playerDamage || {};
  const lifelinkGains = ro.lifelinkGains || {};
  const notesHtml = Array.isArray(ro.notesHtml) ? ro.notesHtml : [];

  // Build rows per attacker involving me
  const rows = [];
  for (const [aCid, meta] of Object.entries(attacks)) {
    const patt = Number(meta?.attackerSeat || 0);
    const pdef = Number(meta?.defenderSeat || 0);
    if (patt !== seat && pdef !== seat) continue;

    const aDead = !!attackerDeadFlags[aCid];
    const diedBlockers = new Set((deadByAttack[aCid] || []).map(String));

    const textBits = [];
    if (diedBlockers.size) {
      const names = Array.from(diedBlockers)
        .map(id => getById(id)?.name || (cmd2 && String(cmd2.id) === String(id) ? cmd2.name : null))
        .filter(Boolean);

      const label = names.length
        ? names.join(', ')
        : `${diedBlockers.size} blocker${diedBlockers.size > 1 ? 's' : ''}`;

      textBits.push(`Dead blockers: ${label}`);
    }

    if (aDead) textBits.push('Attacker dies');
 // RIGHT
if (!aDead && !diedBlockers.size) textBits.push('No deaths');


    rows.push({
      id: String(aCid),
      enabled: true,
      attackerSeat: patt,
      defenderSeat: pdef,
       deadBlockers: diedBlockers,
      attackerDead: aDead,
      text: textBits.join(' • ')
    });
  }

  // overlay
  const existing = document.getElementById('combatOutcomeOverlay');
  if (existing) existing.remove();

  const ov = document.createElement('div');
  ov.id = 'combatOutcomeOverlay';
  ov.style.cssText = `position:fixed; inset:0; background:rgba(8,12,20,.8); z-index:12000; display:flex; align-items:center; justify-content:center;`;
  ov.innerHTML = `
    <div style="background:#0b1220;border:1px solid #2b3f63;border-radius:14px;padding:20px;color:#e7efff;max-width:860px;max-height:80vh;overflow:auto;">
      <h2 style="margin:0 0 8px;">Combat Outcome (Recommended)</h2>

      <div style="margin-bottom:8px;opacity:.9">${notesHtml.map(n => `<div>• ${n}</div>`).join('')}</div>

      <div id="rows" style="display:grid; gap:8px; margin-bottom:12px;">
        ${
          rows.length
            ? rows.map((r,idx)=>`
                <label class="pill" style="display:flex;gap:10px;align-items:flex-start">
                  <input type="checkbox" data-idx="${idx}" checked />
                  <div>${r.text}</div>
                </label>
              `).join('')
            : '<em>No applicable rows for your seat.</em>'
        }
      </div>

<div style="display:flex; gap:8px; justify-content:flex-end;">
  <button class="pill" id="ninjutsuBtn">Ninjutsu</button>
  <button class="pill" id="applyMine">Apply to My Board</button>
  <button class="pill" id="closeOutcome">Close</button>
</div>

    </div>
  `;
  document.body.appendChild(ov);

  ov.querySelector('#rows')?.addEventListener('change', (e)=>{
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    rows[Number(cb.dataset.idx)].enabled = cb.checked;
  });

  // unified close that also clears stale outcome in Supabase
  const closeAndClear = async () => {
    try { await clearOutcome(gid); } catch(_) {}
    // remove key listener safely
    try { document.removeEventListener('keydown', onKeydown); } catch(_) {}
    ov.remove();
  };
  
    // ---------------------------
  // NINJUTSU FLOW
  // ---------------------------
  // ---------------------------
// NINJUTSU FLOW (with deep logging)
// ---------------------------
ov.querySelector('#ninjutsuBtn').onclick = async () => {
  try{
    console.log('[ninjutsu] click → open flow');

    // Step 1: choose an UNBLOCKED attacker that *I* control
    const myUnblocked = rows
      .map((r, idx) => ({ ...r, idx }))
      .filter(r => r.enabled && !r.attackerDead && !r.deadBlockers?.size && r.attackerSeat === seat);

    if (!myUnblocked.length){
      console.warn('[ninjutsu] no unblocked attackers for my seat', { seat, rows });
      showToast('No unblocked attackers for Ninjutsu.');
      return;
    }

    // mini overlay to pick the attacker
    const pick1 = document.createElement('div');
    pick1.style.cssText = 'position:fixed;inset:0;z-index:13000;background:rgba(8,12,20,.8);display:flex;align-items:center;justify-content:center;';
    pick1.innerHTML = `
      <div style="background:#0b1220;border:1px solid #2b3f63;border-radius:14px;padding:16px;max-width:640px;color:#e7efff">
        <h3 style="margin:0 0 8px">Ninjutsu — Choose an unblocked attacker</h3>
        <div id="list1" style="display:grid;gap:8px;margin:8px 0;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="pill" id="cancel1">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(pick1);

    const list1 = pick1.querySelector('#list1');

    // Build a fast lookup from my current seat's TABLE using normalized ids
    const gidForNames   = String(gameId || getGameId());
    const tableArrNames = await (async () => {
      try { 
        const ps = await window.StorageAPI.loadPlayerState(gidForNames, seat);
        return Array.isArray(ps?.Table) ? ps.Table : (Array.isArray(ps?.table) ? ps.table : []);
      } catch { return []; }
    })();
    const nameByBase = new Map(tableArrNames.map(c => [normalizeId(String(c.id)), c]));

    // Render with best-effort name resolution (show names, not ids)
    list1.innerHTML = myUnblocked.map(u => {
      const base = normalizeId(String(u.id));
      const src  = nameByBase.get(base) || getById(u.id) || null;
      const label = src?.name || base;
      return `<button class="pill choose-a" data-cid="${u.id}">${label}</button>`;
    }).join('');

    console.log('[ninjutsu] attacker list', myUnblocked.map(u => {
      const base = normalizeId(String(u.id));
      const src  = nameByBase.get(base) || getById(u.id) || null;
      return {
        rowId: String(u.id),
        baseId: base,
        label: src?.name || '(name-miss)',
        pos: src ? { x: src.x, y: src.y, left: src.left, top: src.top } : null
      };
    }));

    const chooseAttacker = () => new Promise((resolve) => {
      list1.onclick = (e)=>{
        const btn = e.target.closest('.choose-a'); if (!btn) return;
        const cid = String(btn.dataset.cid);
        const base = normalizeId(cid);
        const src  = nameByBase.get(base) || getById(cid) || null;
        console.log('[ninjutsu.pick1] selected attacker', {
          clickId: cid, baseId: base,
          name: src?.name || '(name-miss)',
          pos: src ? { x: src.x, y: src.y, left: src.left, top: src.top } : null
        });
        resolve(cid);
      };
      pick1.querySelector('#cancel1').onclick = ()=> resolve(null);
    });

    const aCidBase = await chooseAttacker();
    pick1.remove();
    if (!aCidBase) { console.log('[ninjutsu] cancelled on attacker'); return; }

    // Step 2: choose the replacement card from HAND + COMMANDER
    const gid = String(gameId || getGameId());
    const myHand = await readSeatHandStrict(gid, seat);
    const commander = getCommanderFromAnywhere();
    const options = [...myHand];
    if (commander && !options.some(c => String(c.id) === String(commander.id))) options.unshift(commander);

    if (!options.length){
      console.warn('[ninjutsu] hand+commander empty for seat', { seat });
      showToast('Your hand (and commander) is empty.');
      return;
    }

    const pick2 = document.createElement('div');
    pick2.style.cssText = 'position:fixed;inset:0;z-index:13000;background:rgba(8,12,20,.8);display:flex;align-items:center;justify-content:center;';
    pick2.innerHTML = `
      <div style="background:#0b1220;border:1px solid #2b3f63;border-radius:14px;padding:16px;max-width:680px;color:#e7efff">
        <h3 style="margin:0 0 8px">Ninjutsu — Choose a card from your hand (or commander)</h3>
        <div id="list2" style="display:grid;gap:8px;margin:8px 0;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="pill" id="cancel2">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(pick2);

    const list2 = pick2.querySelector('#list2');
    list2.innerHTML = options.map(c => `
      <button class="pill choose-b" data-id="${String(c.id)}">
        ${c.name || 'Card'} ${isCommander(c) ? '★(Commander)' : ''}
      </button>
    `).join('');

    console.log('[ninjutsu] hand options', options.map(c => ({
      id: String(c.id), baseId: normalizeId(String(c.id)),
      name: c.name, isCommander: !!isCommander(c)
    })));

    const chooseIncoming = () => new Promise((resolve) => {
      list2.onclick = (e)=>{
        const btn = e.target.closest('.choose-b'); if (!btn) return;
        const cid = String(btn.dataset.id);
        const found = options.find(x => String(x.id) === cid) || null;
        console.log('[ninjutsu.pick2] selected incoming', {
          id: cid, baseId: normalizeId(cid), name: found?.name, from: isCommander(found) ? 'Commander' : 'Hand'
        });
        resolve(found);
      };
      pick2.querySelector('#cancel2').onclick = ()=> resolve(null);
    });

    const incoming = await chooseIncoming();
    pick2.remove();
    if (!incoming) { console.log('[ninjutsu] cancelled on incoming'); return; }

    // Step 3: swap zones (+ rewrite combat key), with deep logs
    await performNinjutsuSwapAndRecalc({ gid, seat, aCidBase, incoming });
    showToast('Ninjutsu performed. Recomputed outcome.');
  } catch (e){
    console.error('[Ninjutsu] failed', e);
    showToast('Ninjutsu failed (see console)');
  }
};



  // Close button = cancel → clear outcome
  ov.querySelector('#closeOutcome').onclick = closeAndClear;

  // Backdrop click (outside the dialog) → clear outcome
  ov.addEventListener('click', (e) => {
    if (e.target === ov) closeAndClear();
  });

  // ESC key → clear outcome
  const onKeydown = (e) => {
    if (e.key === 'Escape') closeAndClear();
  };
  document.addEventListener('keydown', onKeydown);

  // Apply keeps the overlay behavior you had
  ov.querySelector('#applyMine').onclick = async ()=> {
    try {
      await applyRecommendedToMyBoard({ gameId: gid, mySeat: seat, rows, data: { attacks, recommendedOutcome: ro } });
      ov.remove();
    } catch (e) {
      console.error('[OutcomeOverlay] apply failed', e);
      showToast('Could not apply outcome (see console).');
    }
  };

}

/* ------------------------------------------------------
   Apply to my board (deaths, taps, life totals)
------------------------------------------------------ */
async function performNinjutsuSwapAndRecalc({ gid, seat, aCidBase, incoming }){
  const basePick = normalizeId(String(aCidBase));
  console.groupCollapsed('[ninjutsu.swap] begin', { gid, seat, attackerBase: basePick });

  // 1) Load current state
  const doc = await window.StorageAPI.loadPlayerState(gid, seat);
  if (!doc) throw new Error('No player state for ninjutsu');

  // Copy arrays, keep your original casing
  const next = { ...(doc || {}) };
  const TableCap = Array.isArray(next.Table);
  const HandCap  = Array.isArray(next.Hand);
  const Table = TableCap ? [...next.Table] : (Array.isArray(next.table) ? [...next.table] : []);
  const Hand  = HandCap  ? [...next.Hand]  : (Array.isArray(next.hand)  ? [...next.hand]  : []);
  let Commander = next.Commander ?? next.tableCommander ?? null;

  console.log('[ninjutsu.swap] pre-state',
    { tableLen: Table.length, handLen: Hand.length, hasCommander: !!Commander });

  // 2) Locate attacker on table (by base id)
  let idxA  = Table.findIndex(c => normalizeId(String(c.id)) === basePick);
  let attackerObj = idxA >= 0 ? Table[idxA] : null;

  if (!attackerObj) {
    console.warn('[ninjutsu.swap] attacker not found in Table — trying hard filter/remove-and-readd fallback');
  }

  // 3) Determine incoming source
  const fromCommander = isCommander(incoming) || (Commander && String(incoming.id) === String(Commander.id));
  let incomingObj = null;
  if (fromCommander) {
    incomingObj = Commander || incoming;
  } else {
    const ixH = Hand.findIndex(c => String(c.id) === String(incoming.id));
    console.log('[ninjutsu.swap] hand lookup', { incomingId: String(incoming.id), ixH });
    if (ixH === -1) {
      console.error('[ninjutsu.swap] incoming not found in Hand — aborting');
      throw new Error('Incoming card not found in Hand');
    }
    incomingObj = Hand.splice(ixH, 1)[0];
  }

  // 4) Decide anchor position (if attacker missing, try DOM; else use 0,0)
  let anchorPos = { x: 0, y: 0, left: 0, top: 0 };
  if (attackerObj) {
    anchorPos = { x: attackerObj.x, y: attackerObj.y, left: attackerObj.left, top: attackerObj.top };
  } else {
    const el = cardElById(basePick);
    if (el) {
      const r = el.getBoundingClientRect();
      anchorPos = { x: r.x || 0, y: r.y || 0, left: r.left || 0, top: r.top || 0 };
    }
  }

  console.log('[ninjutsu.swap] attacker/incoming summary', {
    attackerFound: !!attackerObj,
    attackerId: attackerObj ? String(attackerObj.id) : '(missing)',
    attackerName: attackerObj?.name,
    incomingId: String(incomingObj?.id || ''),
    incomingName: incomingObj?.name,
    fromCommander
  });

  // 5) Build transformed objects
  const incomingPlaced = {
    ...incomingObj,
    x: anchorPos.x, y: anchorPos.y, left: anchorPos.left, top: anchorPos.top,
    tapped: true,
    attacking: true
  };
  const attackerToHand = attackerObj ? { ...attackerObj, attacking: false } : null;

  // 6) Perform swap
  if (attackerObj && idxA >= 0) {
    // in-place swap
    Table[idxA] = incomingPlaced;
    if (attackerToHand) Hand.unshift(attackerToHand);
    console.log('[ninjutsu.swap] in-place swap done', { idxA });
  } else {
    // remove & re-add fallback: strip any table entries with attacker base id and push incoming
    const before = Table.length;
    const filtered = Table.filter(c => normalizeId(String(c.id)) !== basePick);
    const removed = before - filtered.length;
    filtered.push(incomingPlaced);
    // return attacker (if we ever had its object) to hand front
    if (attackerToHand) Hand.unshift(attackerToHand);
    // commit filtered as Table
    Table.length = 0; Table.push(...filtered);
    console.log('[ninjutsu.swap] fallback remove&readd', { removedCount: removed, newTableLen: Table.length });
  }

  // 7) Update commander zone if used
  if (fromCommander) {
    Commander = null; // left the zone
  }

  // 8) Write back with original casing
  if (TableCap) next.Table = Table; else next.table = Table;
  if (HandCap)  next.Hand  = Hand;  else next.hand  = Hand;
  if ('Commander' in next || Commander) next.Commander = Commander;
  if ('tableCommander' in next || !next.Commander) next.tableCommander = Commander || null;

  console.log('[ninjutsu.swap] saving state…', {
    tableLen: Table.length, handLen: Hand.length, hasCommander: !!Commander
  });
  await window.StorageAPI.savePlayerStateDebounced(gid, seat, next);
  console.log('[ninjutsu.swap] save complete');

  // 9) Patch Combat attacks map key (old attacker base -> incoming base)
  try {
    const combat = await CombatStore.read(gid);
    if (combat?.attacks && combat.attacks[basePick]) {
      const attacks = { ...combat.attacks };
      const row = attacks[basePick];
      delete attacks[basePick];

      const baseIncoming = normalizeId(String(incomingPlaced.id));
      attacks[baseIncoming] = { ...row, name: incomingPlaced.name || row?.name || '' };

      await CombatStore.write(gid, {
        ...combat,
        attacks,
        recommendedOutcome: null,
        applied: {},
        epoch: Date.now()
      });
      console.log('[ninjutsu.swap] combat key patched', { oldKey: basePick, newKey: baseIncoming });
    } else {
      console.log('[ninjutsu.swap] no combat key to patch (maybe local-only test)');
    }
  } catch (e) {
    console.warn('[ninjutsu.swap] attacks-map patch skipped', e);
  }

// 10) HARD REBUILD — exactly like the eye button (with settle + fallbacks)
try {
  // give the debounced write a breath so we reload the new state, not the old one
  await (window.StorageAPI?.flushDebounces?.() || new Promise(r => setTimeout(r, 150)));

  const seatNow = Number(window.AppState?.viewSeat || window.AppState?.mySeat || 1);
  console.log('[ninjutsu.swap] hard repaint via setViewSeat', { seat: seatNow });

  if (typeof window.setViewSeat === 'function') {
    await window.setViewSeat(seatNow);              // nukes + rebuilds + trims (eye button path)
  } else {
    // Fallback: manual “eye” sequence (nuke → rebuild → trim → pass)
    window.hardClearAllDom?.();                     // wipes world/hand/zones/overlays you clear, etc.
    await window.rebuildMyView?.();                 // rebuilds from storage
    try { await window.trimWorldToSeat?.(seatNow); } catch (_){}
    setTimeout(()=> { try { window.trimWorldToSeat?.(seatNow); } catch(_){} }, 60);
    await window.refreshWorldFromStorage?.();       // final assert pass
  }

  // Absolute last resort: soft reload to guarantee fresh DOM
  if (!document.querySelector('#world .card')) {
    console.warn('[ninjutsu.swap] rebuild produced no cards — soft reload fallback');
    location.reload();
  }
} catch (e) {
  console.warn('[ninjutsu.swap] hard repaint failed', e);
  try { location.reload(); } catch(_) {}
}


  console.groupEnd();
}



async function recomputeRecommendedOutcome(gid){
  try{
    const data = await CombatStore.read(gid);
    const attacksMap = data?.attacks || {};
    const blocksByDefender = data?.blocksByDefender || {};

    const notesHtml = [];
    const deadByAttack = {};
    const attackerDeadFlags = {};
    const playerDamage = {};
    const lifelinkGains = {};

    const addDmg  = (s,n)=>{ if(!n) return; playerDamage[s]=(playerDamage[s]||0)+n; };
    const addHeal = (s,n)=>{ if(!n) return; lifelinkGains[s]=(lifelinkGains[s]||0)+n; };

    const withSnapshotPT = (card, snap) => {
      if (!snap?.pt) return card;
      const clone = { ...card };
      clone.pt = `${Number(snap.pt.power)||0}/${Number(snap.pt.toughness)||0}`;
      clone._ptMod = snap.ptMod || clone._ptMod;
      if (clone.ext) clone.ext.ptMod = snap.ptMod || clone.ext.ptMod;
      return clone;
    };
    const oracleText = (card)=>(card?._scry?.oracle_text || card?.oracle_text || card?._faces?.[0]?.oracle_text || '').toLowerCase();
const hasLL = (card, snap)=>{
  if (snap && typeof snap?.hasLifelink === 'boolean') return snap.hasLifelink;
  if (snap?.effects?.some?.(e => String(e).toLowerCase().includes('lifelink'))) return true;
  return oracleText(card).includes('lifelink');
};


    // Build per-defender blocks list quickly
    const blocksLookup = {};
    for (const [defSeat, map] of Object.entries(blocksByDefender)){
      for (const [aCid, list] of Object.entries(map || {})){
        blocksLookup[aCid] = (list || []).map(String);
      }
    }

    for (const [aCid, meta] of Object.entries(attacksMap)){
      const patt = Number(meta?.attackerSeat || 0);
      const pdef = Number(meta?.defenderSeat || 0);

      const attackerRaw = await fetchAttackerCard({ gid, attackerSeat: patt, cid: aCid });
      if (!attackerRaw) continue;

      const snap = meta?.snapshot || null;
      const attacker = withSnapshotPT(attackerRaw, snap);

      const blockers = (blocksLookup[aCid] || []).map(getById).filter(Boolean);
      const result = resolveCombatDamage(attacker, blockers);
      const deadBlockers = Array.from(result.deadBlockers || []);
      const attackerDead = !!result.attackerDead;

      deadByAttack[aCid] = deadBlockers.map(String);
      attackerDeadFlags[aCid] = attackerDead;

      if (Array.isArray(result?.notes)) notesHtml.push(...result.notes);

      const { power: atkP } = computePT(attacker);
      const unblocked = !blockers.length && !attackerDead;

      if (!blockers.length) {
        if (atkP > 0) {
          addDmg(pdef, atkP);
          if (hasLL(attacker, snap)) addHeal(patt, atkP);
        }
      } else {
        const firstStrikeKill =
          !!attackerDead &&
          Array.isArray(result?.notes) &&
          result.notes.some(n => n.includes('kills') && n.includes('(first strike)') && n.includes(attacker.name));
        if (!firstStrikeKill && hasLL(attacker, snap) && atkP > 0) {
          addHeal(patt, atkP);
          notesHtml.push(`(P${patt}) ${attacker.name} gains ${atkP} life (lifelink)`);
        }
      }

      if (attackerDead && deadBlockers.length){
        const names = blockers.filter(b => deadBlockers.includes(String(b.id))).map(b => b.name).join(', ');
        notesHtml.push(`(P${patt}) ${attacker.name} trades with (P${pdef}) ${names}`);
      } else if (attackerDead){
        notesHtml.push(`(P${pdef}) blockers kill (P${patt}) ${attacker.name}`);
      } else if (unblocked){
        notesHtml.push(`(P${patt}) ${attacker.name} is unblocked → P${pdef} takes ${atkP}${hasLL(attacker, snap) ? ' (lifelink)' : ''}`);
      } else if (!deadBlockers.length){
        notesHtml.push(`(P${patt}) ${attacker.name} is blocked — no deaths`);
      }
    }

    const epoch = Date.now();
    const recommendedOutcome = { notesHtml, deadByAttack, attackerDeadFlags, playerDamage, lifelinkGains, epoch };
    await CombatStore.write(gid, { epoch, recommendedOutcome, applied: {} });
  } catch(e){
    console.error('[recomputeRecommendedOutcome] failed', e);
  }
}


export async function applyRecommendedToMyBoard({ gameId, mySeat, rows, data }) {
  const gid  = String(gameId || getGameId());
  const seat = Number(mySeat ?? getSeatNow());
    // current table snapshot
  const S = window.AppState || {};
  const tableNow = Array.isArray(S.table) ? S.table.slice() : [];
const baseToReal = new Map(tableNow.map(c => [normalizeId(c.id), String(c.id)]));
  const attacks   = data?.attacks || {};
  const ro        = data?.recommendedOutcome || {};
  const deadByAtk = ro.deadByAttack || {};
  const aDead     = ro.attackerDeadFlags || {};
  const playerDamage   = ro.playerDamage   || {};
  const lifelinkGains  = ro.lifelinkGains  || {};

  // collect cids to move to my GY from enabled rows
  const enabled = (rows || []).filter(r => r.enabled);
  const enabledSet = new Set(enabled.map(r => String(r.id)));

  const cidsToMove = new Set();

  // my dead blockers from enabled attacks
  for (const [aCid, list] of Object.entries(deadByAtk)) {
    if (!enabledSet.has(String(aCid))) continue;
    const defSeat = Number(attacks?.[aCid]?.defenderSeat || 0);
    if (defSeat !== seat) continue;
    for (const cid of (list || [])) cidsToMove.add(String(cid));
  }

  // my dead attackers (if any enabled)
  for (const [aCid, died] of Object.entries(aDead)) {
    if (!enabledSet.has(String(aCid))) continue;
    if (!died) continue;
    const attSeat = Number(attacks?.[aCid]?.attackerSeat || 0);
    if (attSeat !== seat) continue;
    const realId = baseToReal.get(String(aCid)) || String(aCid);
    cidsToMove.add(realId);
  }


  // helper for DOM selector escape
  const esc = (s)=> (window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/"/g, '\\"'));

  // preferred v2 helpers if available
  const useV2 = typeof window.moveToZone === 'function'
             && typeof window.removeFromTable === 'function'
             && typeof window.appendToZone === 'function';



  // move to GY
  for (const cid of cidsToMove) {
    const cardObj = tableNow.find(c => String(c.id) === String(cid)) || { id: cid };
    const el =
      document.querySelector(`#world .card[data-id="${esc(cid)}"]`) ||
      document.querySelector(`.card[data-id="${esc(cid)}"]`) || null;

    if (useV2) {
      try {
        await window.moveToZone(cardObj, 'graveyard', el || undefined);
      } catch (e) {
        console.warn('[apply→moveToZone] failed, fallback', e);
        try {
          if (el && el.remove) el.remove();
          await window.removeFromTable(cardObj);
          await window.appendToZone(cardObj, 'graveyard');
        } catch (e2) {
          console.warn('[apply→manual] failed', e2);
        }
      }
    } else {
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

    // tap my surviving attackers that were enabled & not moved (use real DOM ids)
  const myAttackingCids = Object.entries(attacks)
    .filter(([aCid, meta]) => Number(meta?.attackerSeat) === seat)
    .map(([aCid]) => String(aCid));

  const stillAliveBase = new Set(
    myAttackingCids.filter(aCid => enabledSet.has(aCid) && !cidsToMove.has(String(aCid)))
  );

  for (const aCidBase of stillAliveBase) {
    const realId = baseToReal.get(String(aCidBase)) || String(aCidBase);
    const el  = document.querySelector(`#world .card[data-id="${esc(realId)}"]`);
    const obj = (window.AppState?.table || []).find(c => String(c.id) === String(realId));
    if (obj) obj.tapped = true;

    if (el) {
      // 1) keep the legacy “size swap”
      el.classList.add('tapped');

      // 2) 🔄 also rotate the art by updating the CSS var used by .cardInner
      const inner = el.querySelector('.cardInner');
      inner?.style?.setProperty('--tap-rot', '90deg');

      // 3) call your updater if present (some builds re-render PT/overlays)
      if (typeof window.updateCardDom === 'function') {
        try { window.updateCardDom(obj || { tapped: true }); } catch(_) {}
      }
    }
  }


  try { window.StorageAPI?.savePlayerStateDebounced?.(gid, seat, window.AppState); } catch(_) {}

  // life totals (seat-local to avoid double application)
  let meta = null;
  try { meta = await window.StorageAPI?.loadMeta?.(gid); } catch(_) {}
  const lifeMain = { ...(meta?.lifeMain || {}) };

  const cur   = Number(lifeMain[seat] ?? 40);
  const minus = Number(playerDamage[seat] || 0);   // damage taken by me (when I'm the defender)
  const plus  = Number(lifelinkGains[seat] || 0);  // lifelink I gain (when I'm the attacker)
  const next  = cur - minus + plus;

  if (minus || plus) {
    lifeMain[seat] = next;

    const myTile = document.querySelectorAll('.life-strip .life-tile')[seat - 1];
    if (myTile) {
      const span = myTile.querySelector('.life-main');
      if (span) span.textContent = String(next);
    }
    try { await window.StorageAPI?.saveMeta?.(gid, { lifeMain, lifeUpdatedAt: Date.now() }); } catch(_) {}
	// force a life strip redraw for everyone viewing
	await window.refreshLifeTotals?.();

  }

  // mark applied for my seat
  try { await CombatStore.write(gid, { applied: { [seat]: true } }); } catch(_){}

  showToast('Applied: deaths, taps, and life totals.');
}

/* ------------------------------------------------------
   Poller (auto-open outcome overlay for non-applied seats)
------------------------------------------------------ */
// optional onData callback lets you see the raw store payload in your console
export function startCombatPoller(gameId, _mySeat, onData){
  const gid = String(gameId || getGameId());
  window.__combatPollers = window.__combatPollers || {};
  if (window.__combatPollers[gid]){
    try { window.__combatPollers[gid](); } catch(_) {}
  }

  let lastEpoch = 0;
  const unsub = CombatStore.onChange(gid, (data)=>{
    if (typeof onData === 'function') {
      try { onData(data); } catch(_) {}
    }

    // We open whenever the outcome exists and *this seat* hasn’t applied yet.
if (!data?.recommendedOutcome) return;

const mySeat = Number(window.AppState?.mySeat || _mySeat || 0);
if (data.applied && data.applied[mySeat]) return;

const roEpoch = Number(data.recommendedOutcome?.epoch || data.epoch || 0);
if (!roEpoch) return;

// ignore any event older than our local clear "floor"
const floor = (window.__combatEpochFloor && window.__combatEpochFloor[gid]) || 0;
if (roEpoch < floor) {
  console.log('[combat.poller] ignore stale outcome epoch', roEpoch, '< floor', floor);
  return;
}

// also ignore dup epoch reopen attempts
if (roEpoch === lastEpoch) return;
lastEpoch = roEpoch;

console.log('[combat.poller] outcome ready → opening overlay for seat', mySeat, { roEpoch, floor });
showOutcomeOverlay({ data, gameId: gid, mySeat });

  });

  window.__combatPollers[gid] = unsub;
  return unsub;
}


/* ------------------------------------------------------
   Wire the FAB
------------------------------------------------------ */
export function wireBattleFab({ gameId, mySeat, getIsMyTurn, btn }){
  btn.addEventListener('click', async () => {
    try{
      const gid  = String(gameId || getGameId());
      const seat = getSeatNow(mySeat);

      // 🔧 Always clear any stale recommendedOutcome when opening a new combat flow
      try { await clearOutcome(gid); } catch(_) {}

      const myTurn = typeof getIsMyTurn === 'function' ? !!getIsMyTurn() : false;
      if (myTurn) return openAttackerOverlay({ gameId: gid, mySeat: seat });
      return openDefenderOverlay({ gameId: gid, mySeat: seat });
    }catch(e){
      console.error('[wireBattleFab] failed', e);
    }
  });

}

/* default export */
export default {
  openAttackerOverlay,
  openDefenderOverlay,
  showOutcomeOverlay,
  applyRecommendedToMyBoard,
  startCombatPoller,
  wireBattleFab,
};
