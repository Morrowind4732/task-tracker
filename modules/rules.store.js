// /modules/rules.store.js
// Central truth for ALL active rules/effects/buffs in the match.
//
// This tracks BOTH:
//  - card-scoped effects (PT buffs, granted abilities/types, counters)
//  - deck / global rules (on draw, on upkeep, etc.) [scaffold only right now]
//
// It ALSO tracks duration + source linkage so we can clean up later.
//
// Shape (per card cid):
// cardEffects[cid] = [
//   {
//     id: 'e_xxx',          // unique id for THIS effect
//     srcCid: 'c_abc',      // the card that created the effect (or null if none / manual)
//     kind: 'pt' | 'ability' | 'type' | 'counter',
//     powDelta: +1/-1/...   // if kind === 'pt'
//     touDelta: +1/-1/...
//     ability: 'Flying',    // if kind === 'ability'
//     typeAdd: 'Zombie',    // if kind === 'type'
//     counter: { kind:'+1/+1', qty:1 }, // if kind === 'counter'
//     duration: 'EOT' | 'SOURCE' | 'PERM',
//     ownerSeat: 1,         // seat that "owns" / applied this effect
//   },
//   ...
// ]
//
// Public API:
//   RulesStore.addEffectForTargets(payload)
//   RulesStore.getResolvedState(cid)
//   RulesStore.resolveForCard(cid)
//   RulesStore.exportEffectsFor(cid)
//   RulesStore.getEffectsBySource(srcCid)
//   RulesStore.removeEffectsBySource(srcCid)  // <-- removes ALL effects linked to srcCid
//   RulesStore.clearEOT(ownerSeat)
//   RulesStore.importRemoteEffect(effectObj)
//   RulesStore.listActiveEffectsGroupedByCard(seatFilter?)
//   RulesStore.removeEffect(effectId)
//
// We do NOT mutate DOM here. Rendering is someone else's job.

export const RulesStore = (() => {
  const cardEffects = new Map(); // cid -> [effectObj,...]

  // --- helpers ---
  function _list(cid){
    if (!cardEffects.has(cid)) cardEffects.set(cid, []);
    return cardEffects.get(cid);
  }

  function _newEffectId(){
    return 'e_' + Math.random().toString(36).slice(2,9);
  }

  

  // NEW: fan-out a deterministic buffRemove for each removed effect (so remote mirrors drop too)
  function _broadcastBuffRemovals(removed, meta = {}){
    try {
      const send = (window.rtcSend || window.peer?.send);
      if (!send || !Array.isArray(removed) || removed.length === 0) return;

      for (const row of removed){
        const eff = row.effect || {};
        // Construct a stable signature the remote fallback understands.
        let signature = '';
        if (eff.kind === 'ability' && eff.ability) signature = `ability:${eff.ability}`;
        if (eff.kind === 'type'    && eff.typeAdd) signature = `type:${eff.typeAdd}`;
        if (eff.kind === 'counter' && eff.counter && eff.counter.kind) signature = `counter:${eff.counter.kind}`;
        if (eff.kind === 'pt' && (Number(eff.powDelta)||Number(eff.touDelta))){
          // PT deltas: we’ll also include the exact pt label (e.g., "+1/+1")
          const p = Number(eff.powDelta||0), t = Number(eff.touDelta||0);
          const signP = (p>=0?'+':'')+p, signT = (t>=0?'+':'')+t;
          signature = `label:${signP}/${signT}`;
        }

        send({
          type: 'buffRemove',
          effectId  : row.effectId,                // preferred (stable if both sides set IDs)
          targetCid : row.targetCid,
          kind      : eff.kind || null,
          ability   : eff.ability || null,
          typeName  : eff.typeAdd || null,
          counter   : (eff.counter && eff.counter.kind) ? eff.counter.kind : null,
          pt        : null,                        // we use signature for PT
          signature,
          reason    : meta.reason || 'eot-clear',
          ownerSeat : eff.ownerSeat ?? undefined
        });
      }
    } catch (e){
      console.warn('[RulesStore] _broadcastBuffRemovals failed', e);
    }
  }


  // ---------- addEffectForTargets ----------
  // payload:
  // {
  //   srcCid: 'c_sourceOrNull',
  //   ownerSeat: 1,
  //   duration: 'EOT' | 'SOURCE' | 'PERM',
  //   pt: {powDelta:+1, touDelta:+1} | null,
  //   ability: "Flying" | null,
  //   typeAdd: "Zombie" | null,
  //   counter: { kind:"+1/+1", qty:1 } | null,
  //   targets: ['cidA','cidB', ...],
  //
  //   // OPTIONAL stable ids from host/RTC:
  //   effectIds: {
  //     pt:      'e_abc123',
  //     ability: 'e_def456',
  //     type:    'e_ghi789',
  //     counter: 'e_jkl012'
  //   }
  // }
  //
  // returns: {
  //   effectIds: {pt,ability,type,counter},
  //   perCard: { [cid]: [effectObj,...] }
  // }
  function addEffectForTargets(payload){
    const {
      srcCid      = null,
      ownerSeat   = 1,
      duration    = 'EOT',
      pt          = null,
      ability     = null,
      typeAdd     = null,
      counter     = null,
      targets     = [],
      effectIds   = {}
    } = payload || {};

    // 1. Stable ids per KIND across this batch.
    const finalIds = {
      pt:      pt && (pt.powDelta || pt.touDelta) ? (effectIds.pt      || _newEffectId()) : null,
      ability: ability   ? (effectIds.ability || _newEffectId()) : null,
      type:    typeAdd   ? (effectIds.type    || _newEffectId()) : null,
      counter: (counter && counter.kind) ? (effectIds.counter || _newEffectId()) : null
    };

    // 2. Push into targets.
    const perCard = {}; // cid -> [newEffects]

    for (const cid of targets){
      if (!cid) continue;
      const arr = _list(cid);
      const newForThisCid = [];

      if (pt && (pt.powDelta||pt.touDelta)){
        const effObj = {
          id:        finalIds.pt,
          srcCid,
          ownerSeat,
          kind:      'pt',
          powDelta:  Number(pt.powDelta||0),
          touDelta:  Number(pt.touDelta||0),
          duration
        };
        arr.push(effObj);
        newForThisCid.push(effObj);
      }

      if (ability){
        const effObj = {
          id:        finalIds.ability,
          srcCid,
          ownerSeat,
          kind:      'ability',
          ability:   String(ability),
          duration
        };
        arr.push(effObj);
        newForThisCid.push(effObj);
      }

      if (typeAdd){
        const effObj = {
          id:        finalIds.type,
          srcCid,
          ownerSeat,
          kind:      'type',
          typeAdd:   String(typeAdd),
          duration
        };
        arr.push(effObj);
        newForThisCid.push(effObj);
      }

      if (counter && counter.kind){
        const effObj = {
          id:        finalIds.counter,
          srcCid,
          ownerSeat,
          kind:      'counter',
          counter:   { kind:String(counter.kind), qty:Number(counter.qty||1) },
          duration
        };
        arr.push(effObj);
        newForThisCid.push(effObj);
      }

      if (newForThisCid.length){
        perCard[cid] = newForThisCid;
      }
    }

    return { effectIds: finalIds, perCard };
  }


  // ---------- getResolvedState ----------
  // Combines base dataset.* with all effects.
  //
  // returns:
  // {
  //   powBase, touBase,
  //   powMod, touMod,          // summed deltas
  //   powCurrent, touCurrent,  // base+mod
  //   abilities: [...unique strings...],
  //   types: [...unique strings...],
  //   counters: { "+1/+1":3, "Shield":1, ... },
  //   activeEffects: [ effectObj, ... ] // raw for stickers etc.
  // }
  function getResolvedState(cid){
    const el = document.querySelector(`img.table-card[data-cid="${cid}"]`);
    const effects = cardEffects.get(cid) || [];

    const powBase = Number(el?.dataset?.power     || 0);
    const touBase = Number(el?.dataset?.toughness || 0);

    let powMod = 0;
    let touMod = 0;
    const abilities = new Set();
    const types     = new Set(
      (el?.dataset?.typeLine || '')
        .split(/[\s,–—-]+/)
        .filter(Boolean)
    );
    const counters  = {};

    for (const eff of effects){
      if (eff.kind === 'pt'){
        powMod += (eff.powDelta||0);
        touMod += (eff.touDelta||0);
      }
      if (eff.kind === 'ability' && eff.ability){
        abilities.add(eff.ability);
      }
      if (eff.kind === 'type' && eff.typeAdd){
        types.add(eff.typeAdd);
      }
      if (eff.kind === 'counter' && eff.counter){
        const k = eff.counter.kind;
        counters[k] = (counters[k]||0) + (eff.counter.qty||1);
      }
    }

    const powCurrent = powBase + powMod;
    const touCurrent = touBase + touMod;

    return {
      powBase, touBase,
      powMod, touMod,
      powCurrent, touCurrent,
      abilities: Array.from(abilities),
      types: Array.from(types),
      counters,
      activeEffects: effects.slice()
    };
  }

  // ---------- exportEffectsFor ----------
  // Give raw effect list for UI like Active tab / stickers list.
  function exportEffectsFor(cid){
    return (cardEffects.get(cid) || []).slice();
  }

  // ---------- getEffectsBySource ----------
  // Enumerate ALL effects (any duration) created by a given srcCid across ALL targets.
  // Returns: [{ effectId, targetCid, kind, duration, ability, typeAdd, counter }]
  function getEffectsBySource(srcCid){
    if (!srcCid) return [];
    const out = [];
    for (const [cid, arr] of cardEffects.entries()){
      if (!Array.isArray(arr) || !arr.length) continue;
      for (const eff of arr){
        if (eff.srcCid === srcCid){
          out.push({
            effectId: eff.id,
            targetCid: cid,
            kind: eff.kind,
            duration: eff.duration,
            ability: eff.ability || null,
            typeAdd: eff.typeAdd || null,
            counter: eff.counter || null
          });
        }
      }
    }
    return out;
  }

  // ---------- listEffectsBySource ----------
  // Returns an array of { effectId, targetCid, kind, ability, typeAdd, counter }
  // WITHOUT mutating the store. Use this when you intend to remove via recvBuffRemove.
  function listEffectsBySource(srcCid){
    const out = [];
    if (!srcCid) return out;
    for (const [cid, arr] of cardEffects.entries()){
      for (const e of (arr || [])){
        if (e && e.srcCid === srcCid){
          out.push({
            effectId: e.id,
            targetCid: cid,
            kind: e.kind,
            ability: e.ability || null,
            typeAdd: e.typeAdd || null,
            counter: e.counter || null,
          });
        }
      }
    }
    return out;
  }


    // ---------- removeEffectsBySource ----------
  // Mutating variant: removes and returns the removed effects.
  // Prefer listEffectsBySource + recvBuffRemove when you need full UI cleanup.
  function removeEffectsBySource(srcCid){
    const removed = [];
    if (!srcCid) return removed;
    for (const [cid, arr] of cardEffects.entries()){
      const keep = [];
      for (const e of (arr || [])){
        if (e && e.srcCid === srcCid && (e.duration === 'SOURCE' || e.duration === 'PERM' || e.duration === 'EOT')){
          removed.push({
            effectId: e.id,
            targetCid: cid,
            kind: e.kind,
            ability: e.ability || null,
            typeAdd: e.typeAdd || null,
            counter: e.counter || null,
          });
        } else {
          keep.push(e);
        }
      }
      cardEffects.set(cid, keep);
    }
    return removed;
  }


  


  // ---------- importRemoteEffect ----------
  // Opponent told us "I applied this buff".
  // remoteEff shape (ONE targetCid):
  // {
  //   type: 'buff',
  //   targetCid: 'c_xxx',
  //   srcCid,
  //   ownerSeat,
  //   duration,
  //   pt, ability, typeAdd, counter,
  //   effectIds: { pt:'e_x', ability:'e_y', type:'e_z', counter:'e_w' }
  // }
  function importRemoteEffect(remoteEff){
    if (!remoteEff || !remoteEff.targetCid) return;
    const {
      targetCid,
      srcCid    = null,
      ownerSeat = 1,
      duration  = 'EOT',
      pt        = null,
      ability   = null,
      typeAdd   = null,
      counter   = null,
      effectIds = {}
    } = remoteEff;

    // Debug
    console.log('[IMPORT EFFECT]', JSON.stringify(effectIds), remoteEff);

    // Store with sender's IDs for stable cross-client identity.
    addEffectForTargets({
      srcCid,
      ownerSeat,
      duration,
      pt,
      ability,
      typeAdd,
      counter,
      targets:   [targetCid],
      effectIds
    });
  }

  // ---------- resolveForCard ----------
  // Adapter for badges.js.
  // badges.js expects:
  // {
  //   powFinal: number|null,
  //   touFinal: number|null,
  //   powBase:  number|null,
  //   touBase:  number|null,
  //   tempBuffs: [ { text:"+1/+1 EOT" }, ... ]
  // }
  //
  // We'll build that from getResolvedState(cid).
  function resolveForCard(cid){
    if (!cid) return null;

    const state = getResolvedState(cid);
    if (!state) return null;

    const tempBuffs = [];

    for (const eff of state.activeEffects){
      // PT delta?
      if (eff.kind === 'pt' && (eff.powDelta || eff.touDelta)){
        const dP = eff.powDelta || 0;
        const dT = eff.touDelta || 0;
        const signP = dP >= 0 ? `+${dP|0}` : `${dP|0}`;
        const signT = dT >= 0 ? `+${dT|0}` : `${dT|0}`;
        const dur   = eff.duration ? String(eff.duration).toUpperCase() : '';
        const label = dur ? `${signP}/${signT} ${dur}` : `${signP}/${signT}`;
        tempBuffs.push({ text: label.trim() });
      }

      // Ability grant?
      if (eff.kind === 'ability' && eff.ability){
        const dur   = eff.duration ? String(eff.duration).toUpperCase() : '';
        const label = dur ? `${eff.ability} ${dur}` : eff.ability;
        tempBuffs.push({ text: label.trim() });
      }

      // Type add?
      if (eff.kind === 'type' && eff.typeAdd){
        const dur   = eff.duration ? String(eff.duration).toUpperCase() : '';
        const label = dur ? `${eff.typeAdd} ${dur}` : eff.typeAdd;
        tempBuffs.push({ text: label.trim() });
      }

      // Counter?
      if (eff.kind === 'counter' && eff.counter){
        const k = eff.counter.kind || '';
        const qty = eff.counter.qty || 1;
        const dur   = eff.duration ? String(eff.duration).toUpperCase() : '';
        const baseText = qty > 1 ? `${k} x${qty}` : k;
        const label = dur ? `${baseText} ${dur}` : baseText;
        tempBuffs.push({ text: label.trim() });
      }
    }

    return {
      powFinal: state.powCurrent ?? null,
      touFinal: state.touCurrent ?? null,
      powBase:  state.powBase    ?? null,
      touBase:  state.touBase    ?? null,
      tempBuffs
    };
  }

  // ---------- listActiveEffectsGroupedByCard ----------
  // Build [{ cid, name, effects:[{id,label,duration},...] }, ...]
  function listActiveEffectsGroupedByCard(seatFilter=null){
    const out = [];
    for (const [cid, arr] of cardEffects.entries()){
      if (!Array.isArray(arr) || !arr.length) continue;

      const el = document.querySelector(`img.table-card[data-cid="${cid}"]`);
      const owner = Number(el?.dataset?.ownerCurrent || el?.dataset?.owner || 0);
      if (seatFilter && owner !== Number(seatFilter)) continue;

      const name = el?.dataset?.name || el?.title || cid;
      const effects = arr.map(eff=>{
        let label = '';
        if (eff.kind === 'pt'){
          const p = Number(eff.powDelta||0);
          const t = Number(eff.touDelta||0);
          const signP = (p>=0?'+':'')+p;
          const signT = (t>=0?'+':'')+t;
          label = `${signP}/${signT}`;
        }
        if (eff.kind === 'ability' && eff.ability){
          label = eff.ability;
        }
        if (eff.kind === 'type' && eff.typeAdd){
          label = `+${eff.typeAdd}`;
        }
        if (eff.kind === 'counter' && eff.counter){
          const k = eff.counter.kind;
          const q = eff.counter.qty>1 ? ` x${eff.counter.qty}` : '';
          label = `${k}${q}`;
        }
        const dur = (eff.duration||'').toUpperCase();
        if (dur) label += ` (${dur})`;
        return { id: eff.id, label, duration: eff.duration };
      });

      out.push({ cid, name, effects });
    }
    return out;
  }

  // ---------- removeEffect ----------
  function removeEffect(effectId){
    if (!effectId) return;
    for (const [cid, arr] of cardEffects.entries()){
      const before = arr.length;
      const keep = arr.filter(e=>e.id!==effectId);
      if (keep.length !== before){
        if (keep.length) cardEffects.set(cid, keep);
        else cardEffects.delete(cid);
        // optional: console.log('[RulesStore] removed effect', effectId, 'from', cid);
      }
    }
  }

  // Internal generic removal helper; returns array of removed entries with context
// [{ effectId, targetCid, effect }]
function _removeEffectsByPredicate(pred){
  const removed = [];
  for (const [cid, arr] of cardEffects.entries()){
    if (!Array.isArray(arr) || !arr.length) continue;
    const keep = [];
    for (const eff of arr){
      if (pred(eff, cid)){
        removed.push({ effectId: eff.id, targetCid: cid, effect: eff });
      } else {
        keep.push(eff);
      }
    }
    if (keep.length) cardEffects.set(cid, keep);
    else cardEffects.delete(cid);
  }
  return removed;
}

// ---------- clearEOT ----------
// End of *current* turn: remove ALL duration==='EOT' effects.
// If ownerSeat is provided, you can still target a seat (legacy behavior).
// Returns array: [{ effectId, targetCid, effect }]
function clearEOT(ownerSeat){
  if (ownerSeat == null) {
    // no seat filter → clear ALL EOT effects
    return _removeEffectsByPredicate((e) => e && e.duration === 'EOT');
  }
  // legacy: seat-scoped clear
  const seatNum = Number(ownerSeat);
  return _removeEffectsByPredicate(
    (e) => e && e.duration === 'EOT' && Number(e.ownerSeat) === seatNum
  );
}

// Clear + broadcast removals so remote mirrors drop too.
function clearEOTAndBroadcast(ownerSeat, meta = {}){
  const removed = clearEOT(ownerSeat);
  if (removed && removed.length){
    try {
      const touched = new Set(removed.map(r => r.targetCid).filter(Boolean));
      (async () => {
        try {
          const { Badges } = await import('./badges.js');
          touched.forEach(cid => Badges.refreshFor?.(cid));
        } catch {}
      })();
    } catch {}
    _broadcastBuffRemovals(removed, meta);
  }
  return removed;
}

// Remove any duration:'SOURCE' effects whose sourceCid is no longer on table.
// Returns array: [{ effectId, targetCid, effect }]
function sweepDanglingLinkedSources(){
  const removed = [];
  try {
    const isLiveCid = (cid) => !!document.querySelector(`img.table-card[data-cid="${cid}"]`);
    const gone = (e) => String(e?.duration||'').toUpperCase()==='SOURCE' && e?.sourceCid && !isLiveCid(e.sourceCid);
    removed.push(..._removeEffectsByPredicate(gone));
  } catch {}
  return removed;
}

function sweepDanglingLinkedSourcesAndBroadcast(meta = {}){
  const removed = sweepDanglingLinkedSources();
  if (removed && removed.length){
    try {
      const touched = new Set(removed.map(r => r.targetCid).filter(Boolean));
      (async () => {
        try {
          const { Badges } = await import('./badges.js');
          touched.forEach(cid => Badges.refreshFor?.(cid));
        } catch {}
      })();
    } catch {}
    _broadcastBuffRemovals(removed, meta);
  }
  return removed;
}


// Auto-EOT purge hooks
// IMPORTANT: end step = end of the turn → clear ALL EOT regardless of who applied them.
try {
  window.addEventListener('phase:beginningOfEndStep', (e) => {
    clearEOTAndBroadcast(undefined, { reason: 'phase:beginningOfEndStep' });
    sweepDanglingLinkedSourcesAndBroadcast({ reason:'phase:beginningOfEndStep' });
  });
} catch {}

try {
  window.addEventListener('phase:cleanup', (e) => {
    clearEOTAndBroadcast(undefined, { reason: 'phase:cleanup' });
    sweepDanglingLinkedSourcesAndBroadcast({ reason:'phase:cleanup' });
  });
} catch {}


  // expose (and also stick on window for debug)
  const api = {
    addEffectForTargets,
    getResolvedState,
    resolveForCard,
    exportEffectsFor,
    getEffectsBySource,
    removeEffectsBySource,
    clearEOT,                // still available if you want silent clears
    clearEOTAndBroadcast,    // ← use this if you’re clearing outside of phase events
    importRemoteEffect,
    listActiveEffectsGroupedByCard,
    removeEffect,
    listEffectsBySource
  };

  window.RulesStore = api;
  return api;
})();
