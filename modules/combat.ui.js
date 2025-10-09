// ================================
// FILE: modules/combat.ui.js
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
function cardElById(cid){ return document.querySelector(`.card[data-id="${cid}"]`); }
function isInCommanderZone(cid){
  const el = cardElById(String(cid));
  const cmd = document.getElementById('cmdZone');
  if (!el || !cmd) return false;
  const cr = el.getBoundingClientRect();
  const zr = cmd.getBoundingClientRect();
  return rectsOverlap(cr, zr);
}

function normalizeId(raw) {
  if (raw == null) return '';
  let s = String(raw);
  const ix = s.indexOf('_');
  if (ix > -1) s = s.slice(0, ix);
  if (s.startsWith('card-')) s = s.slice(5);
  return s;
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



export async function clearCombatAttacks(gid = String(window.AppState?.gameId || '')) {
  // keep dynamic import if you want to isolate load order, or
  // use the already-imported CombatStore (both are fine):
  await CombatStore.write(gid, {
    attacks: {},
    recommendedOutcome: null,
    applied: {},
    epoch: Date.now(),
  });
  console.log('[combat] attacks cleared for', gid);
}
window.clearCombatAttacks = clearCombatAttacks; // console convenience
// ---------------------------------------------------------



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

  const table = getTable().filter(c => isCreature(c) && !isInCommanderZone(c.id));
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
    await CombatStore.write(gid, {
      attacks: {},                 // wipe previous attackers
      recommendedOutcome: null,    // wipe stale outcome
      applied: {},                 // wipe per-seat “applied” flags
      epoch: Date.now(),
    });
  }

  ov.querySelector('#confirmAtk').onclick = async () => {
    try{
      // build fresh selection (normalize ids) + attach snapshots
      const trimmed = {};
      const tableByBase = new Map((getTable() || []).map(c => [normalizeId(c.id), c]));
      for (const [cid, defSeat] of Object.entries(choices)){
        if (defSeat != null && !isNaN(defSeat)) {
          const base = normalizeId(cid);
          const card = tableByBase.get(base);
          const snapshot = bakeAttackSnapshot(card);
          trimmed[base] = {
            attackerSeat: seat,
            defenderSeat: Number(defSeat),
            snapshot
          };
          console.log('[attacker.confirm] snapshot', { base, name: card?.name, snapshot });
        }
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

      await CombatStore.setInitiated(gid, { attackingSeat: seat }); // no phase write

      showToast('Attacks declared!');
      ov.remove();
    }catch(e){
      console.error('[attacker.confirm] failed', e);
      showToast('Could not confirm attacks (see console).');
    }
  };







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

  scroller.addEventListener('click', (e) => {
    const btn = e.target.closest('.choose-blocker'); if (!btn) return;
    const aCid = normalizeId(btn.dataset.att);
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
        .map(id => getById(id)?.name || null)
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

  ov.querySelector('#closeOutcome').onclick = ()=> ov.remove();
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
    if (!roEpoch || roEpoch === lastEpoch) return;
    lastEpoch = roEpoch;

    console.log('[combat.poller] outcome ready → opening overlay for seat', mySeat, data);
    showOutcomeOverlay({ data, gameId: gid, mySeat });
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

/* default export */
export default {
  openAttackerOverlay,
  openDefenderOverlay,
  showOutcomeOverlay,
  applyRecommendedToMyBoard,
  startCombatPoller,
  wireBattleFab,
};
