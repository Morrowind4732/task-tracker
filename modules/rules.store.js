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
//   RulesStore.removeEffectsBySource(srcCid)
//   RulesStore.clearEOT(ownerSeat)
//   RulesStore.importRemoteEffect(effectObj)
//   RulesStore.exportEffectsFor(cid)  (for tooltip/badges UI)
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
  //   // NEW OPTIONAL:
  //   effectIds: {
  //     pt:      'e_abc123',   // id to use for EVERY pt buff in this apply
  //     ability: 'e_def456',
  //     type:    'e_ghi789',
  //     counter: 'e_jkl012'
  //   }
  // }
  //
  // returns: {
  //   effectIds: {pt,ability,type,counter},   // final ids we actually used
  //   perCard: { [cid]: [effectObj,...] }     // just-added effects per card
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
      effectIds   = {}          // <-- MAY come in from host or may be {}
    } = payload || {};

    // 1. Make sure we have stable ids per KIND for this whole batch.
    //    If caller didn't give us one, we mint it ONCE and reuse it.
    const finalIds = {
      pt:      pt        && (pt.powDelta || pt.touDelta) ? (effectIds.pt      || _newEffectId()) : null,
      ability: ability   ? (effectIds.ability || _newEffectId()) : null,
      type:    typeAdd   ? (effectIds.type    || _newEffectId()) : null,
      counter: (counter && counter.kind)
                 ? (effectIds.counter || _newEffectId())
                 : null
    };

    // 2. Actually push effects into each target card.
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

  // ---------- removeEffectsBySource ----------
  // Call this when srcCid leaves the battlefield.
  // Kill any effect whose duration === 'SOURCE' AND eff.srcCid===srcCid.
  function removeEffectsBySource(srcCid){
    if (!srcCid) return;
    for (const [cid, arr] of cardEffects.entries()){
      const keep = arr.filter(e => !(e.duration === 'SOURCE' && e.srcCid === srcCid));
      cardEffects.set(cid, keep);
    }
  }

  // ---------- clearEOT ----------
  // Call this at end of turn for a given seat.
  // Kill effects whose duration === 'EOT' && ownerSeat===seat
  function clearEOT(ownerSeat){
    for (const [cid, arr] of cardEffects.entries()){
      const keep = arr.filter(e => !(e.duration === 'EOT' && e.ownerSeat === ownerSeat));
      cardEffects.set(cid, keep);
    }
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

  // 👇 Add this debug line here
  console.log('[IMPORT EFFECT]', JSON.stringify(effectIds), remoteEff);

  // We just call addEffectForTargets with THEIR effectIds so we store
  // the exact same IDs locally.
  addEffectForTargets({
    srcCid,
    ownerSeat,
    duration,
    pt,
    ability,
    typeAdd,
    counter,
    targets:   [targetCid],
    effectIds  // keep host IDs
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

    // Build tempBuffs list from activeEffects.
    // We'll try to generate human-readable text like "+1/+1 EOT"
    // for PT buffs, and also include abilities/types if you want
    // them to show as "Flying (PERM)" etc.
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
        // e.g. "+1/+1 x3", "Shield x1"
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

 


  // expose (and also stick on window for debug)
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
        cardEffects.set(cid, keep);
        // optional: console.log('[RulesStore] removed effect', effectId, 'from', cid);
      }
    }
  }

  // expose (and also stick on window for debug)
  const api = {
    addEffectForTargets,
    getResolvedState,
    resolveForCard,
    exportEffectsFor,
    removeEffectsBySource,
    clearEOT,
    importRemoteEffect,
    listActiveEffectsGroupedByCard,
    removeEffect
  };
  window.RulesStore = api;
  return api;
})();



