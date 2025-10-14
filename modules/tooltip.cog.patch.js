// === PATCH: Tooltip → open Card Attributes overlay on cog click ===
// Safe to include after modules/tooltip.js has loaded.
import Overlays from './overlays.js';

// If CardAttributes is available, ensure it's initialized somewhere in your app startup.
// Here we only open the overlay when the tooltip dispatches the `card:cog` event.
(function attachCogToCardAttributes(){
  if (window.__COG_ATTR_HOOKED__) return;
  window.__COG_ATTR_HOOKED__ = true;

  document.addEventListener('card:cog', (e)=>{
    try{
      const el   = e?.detail?.el;
      if (!el) return;
      const cid  = el.dataset?.cid || '';
      // owner seat is written on table cards as data-owner in v3; fall back to AppState
      const seat = Number(el.dataset?.owner || window.AppState?.mySeat || 1);

      console.log('[Attr][hook] opening Card Attributes overlay for cid=', cid, 'seat=', seat);
      if (typeof Overlays?.openCardAttributes === 'function'){
        Overlays.openCardAttributes({ cid, seat });
      }else{
        console.warn('[Attr][hook] Overlays.openCardAttributes not found. Did you include modules/card.attributes.js?');
      }
    }catch(err){
      console.warn('[Attr][hook] failed to open overlay', err);
    }
  });
})();