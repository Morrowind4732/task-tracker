// =============================
// File: effects.store.js
// Purpose: Minimal effects store scaffold so imports resolve and the UI can
//          call into a stable API later. This version does not persist or RTC.
// =============================

export const Effects = (() => {
  const bus = new EventTarget();
  const effects = new Map(); // key: target cid -> array of effect objects
  const rules = []; // basic rule placeholders

  function on(type, fn){ bus.addEventListener(type, fn); return () => bus.removeEventListener(type, fn); }
  function emit(type, detail){ bus.dispatchEvent(new CustomEvent(type, { detail })); }

  function add(effect){
    const cid = effect?.targetCid || effect?.target || effect?.cid;
    if (!cid) return;
    const arr = effects.get(cid) || [];
    arr.push({ ...effect, id: effect.id || `e_${Date.now()}_${Math.random().toString(36).slice(2,8)}` });
    effects.set(cid, arr);
    emit('change:effects', { cid, effects: arr.slice() });
  }

  function remove(effectId){
    for (const [cid, arr] of effects){
      const idx = arr.findIndex(e => e.id === effectId);
      if (idx !== -1){
        arr.splice(idx,1);
        effects.set(cid, arr);
        emit('change:effects', { cid, effects: arr.slice() });
        return true;
      }
    }
    return false;
  }

  function clearFor(cid){ effects.delete(cid); emit('change:effects', { cid, effects: [] }); }
  function clearAll(){ effects.clear(); emit('change:effects', { all: true }); }

  function effectsFor(cid){ return (effects.get(cid) || []).slice(); }

  function listRules(){ return rules.slice(); }
  function addRule(rule){ rules.push({ ...rule, id: rule.id || `r_${Date.now()}_${Math.random().toString(36).slice(2,8)}` }); emit('change:rules', { rules: listRules() }); }
  function removeRule(ruleId){
    const i = rules.findIndex(r => r.id === ruleId);
    if (i !== -1){ rules.splice(i,1); emit('change:rules', { rules: listRules() }); return true; }
    return false;
  }

  // Simple compute placeholder: folds raw deltas into base PT
  function computeForCard(base, cid){
    const out = { pow: Number(base?.pow)||0, tou: Number(base?.tou)||0, counters:{}, abilities:[], types:[], temp:{} };
    for (const e of (effects.get(cid)||[])){
      const dp = Number(e?.deltaPow)||0, dt = Number(e?.deltaTou)||0;
      out.pow += dp; out.tou += dt;
      if (e?.counters){ for (const [k,v] of Object.entries(e.counters)) out.counters[k] = (out.counters[k]||0) + Number(v||0); }
      if (Array.isArray(e?.abilities)) out.abilities = out.abilities.concat(e.abilities);
      if (Array.isArray(e?.types)) out.types = out.types.concat(e.types);
    }
    return out;
  }

  // Expose a tiny API
  return {
    on, add, remove, clearFor, clearAll,
    effectsFor,
    listRules, addRule, removeRule,
    computeForCard,
  };
})();
