// /modules/rtc.rules.js
// Bridge between local buff application and RTC sync.
// We do NOT own the peer connection here. We just format packets
// and give you helpers to consume them.

import { RulesStore } from './rules.store.js';

export const RTCApply = (() => {

  // ---------- helpers ----------
  function _cardsWithEffect(effectId){
    const hits = [];
    if (!effectId) return hits;
    const nodes = document.querySelectorAll('img.table-card[data-cid]');
    for (const el of nodes){
      const cid = el.dataset.cid;
      const list = RulesStore.exportEffectsFor(cid) || [];
      if (list.some(e => e.id === effectId)) hits.push({ cid, el, list });
    }
    return hits;
  }

  function _pruneRemoteAttrsForEffect(el, eff){
    if (!el || !eff) return;
    let attrs = {};
    try { attrs = JSON.parse(el.dataset.remoteAttrs || '{}'); } catch {}

    if (eff.kind === 'ability' && eff.ability){
      const arr = Array.isArray(attrs.abilities) ? attrs.abilities : [];
      attrs.abilities = arr.filter(a => a !== eff.ability);
    }

    if (eff.kind === 'type' && eff.typeAdd){
      // We generally don't mirror added types into remoteAttrs,
      // but if you do, scrub them here:
      const arr = Array.isArray(attrs.types) ? attrs.types : [];
      attrs.types = arr.filter(t => t !== eff.typeAdd);
    }

    if (eff.kind === 'counter' && eff.counter?.kind){
      // safest path: rebuild the counters map for this cid after removal
      // (so stacked counters stay accurate)
      const remaining = RulesStore.exportEffectsFor(el.dataset.cid)
        .filter(e => !(e.id === eff.id)); // pretend it's already gone
      const tally = {};
      for (const e of remaining){
        if (e.kind === 'counter' && e.counter?.kind){
          const k = String(e.counter.kind);
          tally[k] = (tally[k] || 0) + Number(e.counter.qty || 1);
        }
      }
      attrs.counters = tally;
    }

    if (eff.kind === 'pt'){
      // If you mirror PT into dataset.remoteAttrs.pt, clear it only when no PT
      // effects remain after this removal; otherwise leave it (sticker will still
      // render correctly from RulesStore.resolveForCard()).
      const remaining = RulesStore.exportEffectsFor(el.dataset.cid)
        .filter(e => !(e.id === eff.id) && e.kind === 'pt');
      if (remaining.length === 0){
        delete attrs.pt;
        delete el.dataset.ptCurrent;
      }
    }

    el.dataset.remoteAttrs = JSON.stringify(attrs);
  }

  // ---------- send buff ----------
  function broadcastBuff(localOverlayPayload){
    if (!localOverlayPayload || !Array.isArray(localOverlayPayload.targets)) return;

    // Step 1: commit to RulesStore and get stable IDs
    const commitResult = RulesStore.addEffectForTargets(localOverlayPayload);

    // ✅ persist those IDs onto the payload for remote reuse
    localOverlayPayload.effectIds = commitResult.effectIds;

    // Step 2: apply visuals locally (dataset.ptCurrent, badges, tooltip)
    try {
      if (window.CardOverlayUI?.applyBuffLocally){
        window.CardOverlayUI.applyBuffLocally(localOverlayPayload);
      }
    } catch(err){
      console.warn('[RTCApply.broadcastBuff] local visual sync fail', err);
    }

    // Step 3: build + send RTC packet for EACH targetCid
    const { srcCid, ownerSeat, duration, pt, ability, typeAdd, counter, targets } = localOverlayPayload;
    for (const targetCid of targets){
      const pkt = {
        type:      'buff',
        targetCid,
        srcCid:    srcCid || null,
        ownerSeat: Number(ownerSeat)||1,
        duration:  duration || 'EOT',
        pt:        pt || null,
        ability:   ability || null,
        typeAdd:   typeAdd || null,
        counter:   counter || null,
        effectIds: commitResult.effectIds || {}
      };

      try {
        (window.rtcSend || window.peer?.send)?.(pkt);
        console.log('%c[RTC:send buff]', 'color:#6cf', pkt);
      } catch(e){
        console.warn('[RTCApply.broadcastBuff] send failed', e, pkt);
      }
    }
  }

  // ---------- receive buff ----------
  async function recvBuff(pkt){
    if (!pkt || pkt.type !== 'buff') return;

    // 1) store the effect with caller-supplied IDs (stable across clients)
    try {
      RulesStore.importRemoteEffect(pkt);
    } catch (err) {
      console.warn('[RTCApply.recvBuff] RulesStore.importRemoteEffect failed', err, pkt);
    }

    console.log('%c[RTC:recv buff]', 'color:#0f0', pkt);

    // 2) mirror visuals via CardOverlayUI
    const cid = pkt.targetCid;
    const mirrorPayload = {
      targets: cid ? [cid] : [],
      targetCid: cid || null,
      srcCid:    pkt.srcCid || null,
      ownerSeat: pkt.ownerSeat,
      duration:  pkt.duration || 'EOT',
      pt:        pkt.pt || null,
      ability:   pkt.ability || null,
      typeAdd:   pkt.typeAdd || null,
      counter:   pkt.counter || null,
      effectIds: pkt.effectIds || {}
    };

    async function ensureApplyHelper(){
      if (window.CardOverlayUI?.applyBuffLocally) return;
      try {
        const uiMod = await import('./card.attributes.overlay.ui.js')
          .catch(async () => await import('./card.attributes.overlay.js'))
          .catch(() => null);

        if (uiMod) {
          if (uiMod.CardOverlayUI) {
            try { uiMod.CardOverlayUI.mount?.(); } catch {}
            window.CardOverlayUI = window.CardOverlayUI || uiMod.CardOverlayUI;
          } else {
            window.CardOverlayUI = window.CardOverlayUI || {};
            if (uiMod.applyBuffLocally) window.CardOverlayUI.applyBuffLocally = uiMod.applyBuffLocally;
            if (uiMod.mount) { try { uiMod.mount(); } catch {} window.CardOverlayUI.mount = uiMod.mount; }
          }
        }
      } catch (err) {
        console.warn('[RTCApply.recvBuff] failed to hydrate CardOverlayUI', err);
      }
    }

    try {
      await ensureApplyHelper();
      if (window.CardOverlayUI?.applyBuffLocally) {
        window.CardOverlayUI.applyBuffLocally(mirrorPayload);
      } else {
        console.warn('[RTCApply.recvBuff] no applyBuffLocally after ensureApplyHelper()');
      }
    } catch (err) {
      console.warn('[RTCApply.recvBuff] applyBuffLocally failed', err, mirrorPayload);
    }

    try { window.Badges?.refreshFor?.(cid); } catch {}
    try { window.Tooltip?.refreshFor?.(cid); } catch {}
  }

  // ---------- receive buffRemove ----------
  async function recvBuffRemove(pkt){
    const effectId = pkt?.effectId;
    if (!effectId) return;

    // Which card(s) currently carry this effect?
    const hits = _cardsWithEffect(effectId);

    // For each hit, prune remoteAttrs using the exact effect we’re about to kill.
    for (const { cid, el, list } of hits){
      const eff = list.find(e => e.id === effectId);
      if (eff) _pruneRemoteAttrsForEffect(el, eff);
    }

    // Remove from store.
    try {
      RulesStore.removeEffect(effectId);
    } catch (e){
      console.warn('[RTCApply.recvBuffRemove] RulesStore.removeEffect failed', e, pkt);
    }

    // Refresh UI for impacted cards (or targetCid hint if provided).
    const targetHint = pkt.targetCid ? String(pkt.targetCid) : null;
    const toRefresh = new Set(hits.map(h => h.cid));
    if (targetHint) toRefresh.add(targetHint);

    for (const cid of toRefresh){
      try { window.Badges?.refreshFor?.(cid); } catch {}
      try { window.Tooltip?.refreshFor?.(cid); } catch {}
    }

    // Worst case (no hits found): do a light global refresh to reconcile.
    if (toRefresh.size === 0){
      try {
        document.querySelectorAll('img.table-card[data-cid]').forEach(n => {
          const c = n.dataset.cid;
          window.Badges?.refreshFor?.(c);
        });
      } catch {}
    }

    console.log('%c[RTC:recv buffRemove→applied]', 'color:#f55', { effectId, refreshed: Array.from(toRefresh) });
  }

  const api = { broadcastBuff, recvBuff, recvBuffRemove };
  window.RTCApply = api;
  return api;
})();
