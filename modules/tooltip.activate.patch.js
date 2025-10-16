// === PATCH: Tooltip → open Activated Abilities overlay on wand click ===
// Safe to include after modules/tooltip.js has loaded.
import ActivatedAbilities from './activated.abilities.js';

(function attachActivateOverlay(){
  if (window.__ACTIVATE_ABILITIES_HOOKED__) return;
  window.__ACTIVATE_ABILITIES_HOOKED__ = true;

  // Mirror the cog pattern: tooltip dispatches `card:activate` with { el }
  document.addEventListener('card:activate', (e) => {
    try {
      const el = e?.detail?.el;
      if (!el) return;

      const cid  = el.dataset?.cid || '';
      // owner seat is stamped on table cards as data-owner in v3; fall back to AppState
      const seat = Number(el.dataset?.owner || window.AppState?.mySeat || 1);

      console.log('[Activate][hook] opening abilities overlay for cid=', cid, 'seat=', seat);
      if (typeof ActivatedAbilities?.open === 'function') {
        ActivatedAbilities.open({ cid, seat, anchorEl: el });
      } else {
        console.warn('[Activate][hook] ActivatedAbilities.open not found. Did you include ./activate.abilities.js?');
      }
    } catch (err) {
      console.warn('[Activate][hook] failed to open overlay', err);
    }
  });
})();
