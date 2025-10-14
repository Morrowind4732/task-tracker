// === PATCH: save.snap.js → include Card Attributes in saves/restores ===
// Safe to include after your existing save.snap.js. Relies on window.CardAttributes.
(function patchSavesForAttributes(){
  if (window.__ATTR_SAVE_PATCHED__) return;
  window.__ATTR_SAVE_PATCHED__ = true;

  const log = (...a)=>console.log('[Attr][savepatch]', ...a);

  // Utility: group CardAttributes.cache by owner_seat -> { [seat]: { [cid]: attrs } }
  function exportAttributesBySeat(){
    const CA = window.CardAttributes;
    const bucket = {};
    if (!CA || !CA.cache) return bucket;
    for (const [cid, data] of Object.entries(CA.cache)){
      const seat = Number(data?.owner_seat || 0);
      if (!seat) continue;
      (bucket[seat] ||= {})[cid] = data;
    }
    return bucket;
  }

  // Wrap GameIO.collectState if present to inject attributes
  if (window.GameIO && typeof window.GameIO.collectState === 'function'){
    const origCollect = window.GameIO.collectState.bind(window.GameIO);
    window.GameIO.collectState = function(){
      const state = origCollect() || {};
      const bySeat = exportAttributesBySeat();
      // Attach under zones[seat].attributes
      state.zones = state.zones || {};
      for (const [seatStr, attrs] of Object.entries(bySeat)){
        const s = Number(seatStr);
        state.zones[s] = state.zones[s] || {};
        state.zones[s].attributes = attrs;
      }
      log('collectState injected attributes for seats:', Object.keys(bySeat));
      return state;
    };
  } else {
    log('WARN: GameIO.collectState not found; cannot inject attributes into state.');
  }

  // Wrap GameIO.applyState to restore attributes, after core state is applied
  if (window.GameIO && typeof window.GameIO.applyState === 'function'){
    const origApply = window.GameIO.applyState.bind(window.GameIO);
window.GameIO.applyState = function(state){
  origApply(state);
  queueMicrotask(()=>{     // give the DOM a tick to build
    try{
      const CA = window.CardAttributes;
      if (!CA || typeof CA.applyAll !== 'function') return;
      const zones = (state && state.zones) || {};
      for (const [seatStr, zone] of Object.entries(zones)){
        const attrs = zone?.attributes || null;
        if (attrs) {
          CA.applyAll(Number(seatStr)||1, attrs);
          log('applyState restored attributes for seat', seatStr, 'cids=', Object.keys(attrs));
        }
      }
    }catch(err){
      log('ERROR restoring attributes from state', err);
    }
  });
};

  } else {
    log('WARN: GameIO.applyState not found; cannot restore attributes from state.');
  }

})();