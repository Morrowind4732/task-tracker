// /modules/rtc.rules.js
// Bridge between local buff application and RTC sync.
// We do NOT own the peer connection here. We just format packets
// and give you helpers to consume them.

import { RulesStore } from './rules.store.js';

export const RTCApply = (() => {

   // send a multi-target buff packet. We:
  // 1) commit it locally (which returns the shared effectIds),
  // 2) reflect visuals locally,
  // 3) RTC each target with those same IDs so remote stores identical IDs.
  function broadcastBuff(localOverlayPayload){
    if (!localOverlayPayload || !Array.isArray(localOverlayPayload.targets)) return;

    // Step 1: commit to RulesStore and get stable IDs
    const commitResult = RulesStore.addEffectForTargets(localOverlayPayload);
	
	// ✅ NEW: persist those IDs onto the payload for remote reuse
localOverlayPayload.effectIds = commitResult.effectIds;

    // commitResult = { effectIds:{pt,ability,type,counter}, perCard:{cid:[...effects]} }

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
        effectIds: commitResult.effectIds || {}   // <--- CRITICAL
      };

      try {
        (window.rtcSend || window.peer?.send)?.(pkt);
        console.log('%c[RTC:send buff]', 'color:#6cf', pkt);
      } catch(e){
        console.warn('[RTCApply.broadcastBuff] send failed', e, pkt);
      }
    }
  }


  // called by your rtc.bus.js / onmessage path when we RECEIVE {type:'buff', ...}
  async function recvBuff(pkt){
    if (!pkt || pkt.type !== 'buff') return;

    // 1) Store the effect (so RulesStore knows about EOT / SOURCE / PERM buffs,
    //    and so powFinal/touFinal etc. get resolved for stickers).
    try {
      RulesStore.importRemoteEffect(pkt);
    } catch (err) {
      console.warn('[RTCApply.recvBuff] RulesStore.importRemoteEffect failed', err, pkt);
    }

    console.log('%c[RTC:recv buff]', 'color:#0f0', pkt);

    // 2) Build a "localOverlayPayload-style" object so we can reuse
    //    CardOverlayUI.applyBuffLocally() on THIS client.
    //
    //    applyBuffLocally expects:
    //      {
    //        targets: ['cidA','cidB',...],
    //        targetCid: 'cidA' (optional),
    //        pt: { powDelta, touDelta } | null,
    //        ability: 'Flying' | null,
    //        typeAdd: 'Angel' | null,
    //        ...etc
    //      }
    //
    //    Our pkt is already basically that shape, just single-target.
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

    // 3) Ensure CardOverlayUI.applyBuffLocally is available on this side.
    //    That helper:
    //      - updates CardAttributes.get(cid) with new pow/tou, abilities[], types[]
    //      - mirrors those into el.dataset.ptCurrent and el.dataset.remoteAttrs
    //      - calls Badges.render(el) and Tooltip refresh
    async function ensureApplyHelper(){
      if (window.CardOverlayUI?.applyBuffLocally) return;
      try {
        // try UI version first (defines applyBuffLocally in your latest file)
        const uiMod = await import('./card.attributes.overlay.ui.js')
          .catch(async () => await import('./card.attributes.overlay.js'))
          .catch(() => null);

        if (uiMod) {
          if (uiMod.CardOverlayUI) {
            // mount once so STATE/css etc. exist
            try { uiMod.CardOverlayUI.mount?.(); } catch {}
            window.CardOverlayUI = window.CardOverlayUI || uiMod.CardOverlayUI;
          } else {
            // fallback: stitch
            window.CardOverlayUI = window.CardOverlayUI || {};
            if (uiMod.applyBuffLocally) {
              window.CardOverlayUI.applyBuffLocally = uiMod.applyBuffLocally;
            }
            if (uiMod.mount) {
              try { uiMod.mount(); } catch {}
              window.CardOverlayUI.mount = uiMod.mount;
            }
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

    // 4) Final safety: refresh badges + tooltip for that cid.
    try { window.Badges?.refreshFor?.(cid); } catch {}
    try { window.Tooltip?.refreshFor?.(cid); } catch {}
  }


  const api = { broadcastBuff, recvBuff };
  window.RTCApply = api;
  return api;
})();
