// tooltip.cog.patch.js
// Patch: add Repair + Delete to the cog overlay and route both actions through the same
// "zones:move" local/RTC pipeline your drag-to-zone UI uses. Repair = delete then respawn.

import Overlays from './overlays.js';

(function CogActionsPatch(){
  if (window.__COG_ATTR_HOOKED__) return;
  window.__COG_ATTR_HOOKED__ = true;

  let lastCogEl = null;

  // --- helpers --------------------------------------------------------------

  const mySeat = () => Number(
    document.getElementById('mySeat')?.value ||
    window.AppState?.mySeat || 1
  );

  const sendRTC = (msg) =>
    (window.RTC?.send?.(msg) ?? window.sendRTC?.(msg));

  // Try to perform the same local deletion path as a real zone drop.
  async function localZoneMoveTableToGY(cid, seat){
    // Prefer your real move helpers if available.
    try {
      if (typeof window.Zones?._moveBetween === 'function'){
        window.Zones._moveBetween('table','graveyard', { cid, seat });
        return true;
      }
    } catch {}
    try {
      if (typeof window.Zones?.moveCardToZone === 'function'){
        window.Zones.moveCardToZone(cid, 'graveyard', seat);
        return true;
      }
    } catch {}
    try {
      if (typeof window.Zones?.applyLocalMove === 'function'){
        window.Zones.applyLocalMove({ from:'table', to:'graveyard', cid, seat });
        return true;
      }
    } catch {}

    // As a last resort, nudge with a custom event some engines listen for.
    try{
      const ev = new CustomEvent('zones:move', { detail:{ from:'table', to:'graveyard', cid, seat, localOnly:true }});
      window.dispatchEvent(ev);
      return true;
    }catch{}

    // Absolute fallback (avoid if possible): remove DOM so the user sees feedback.
    try{
      const el = document.querySelector(`.card[data-cid="${CSS.escape(String(cid))}"]`);
      el?.parentElement?.removeChild?.(el);
      return true;
    }catch{}

    return false;
  }

  function netZoneMoveTableToGY(cid, seat){
    try{
      const ok = sendRTC?.({
        type: 'zones:move',
        from: 'table',
        to:   'graveyard',
        cid,
        seat: Number(seat || mySeat())
      });
      console.log('[COG][NET] zones:move sent?', ok === undefined ? true : ok, { cid, seat });
    }catch(e){
      console.warn('[COG][NET] zones:move send failed', e);
    }
  }

  function scryPayloadFromEl(el){
    const cid = el?.dataset?.cid || '';
    const og   = (typeof window.getCardDataById === 'function' && cid)
      ? (window.getCardDataById(cid) || {})
      : {};

    return {
      cid,
      name:        og.name        ?? el?.dataset?.name        ?? '',
      img:         og.img         ?? el?.dataset?.img         ?? (el?.querySelector('img')?.src || ''),
      type_line:   og.type_line   ?? el?.dataset?.type_line   ?? '',
      mana_cost:   og.mana_cost   ?? el?.dataset?.mana_cost   ?? '',
      oracle_text: og.oracle_text ?? el?.dataset?.oracle_text ?? '',
      ogpower:     og.baseP ?? og.power ?? el?.dataset?.baseP ?? el?.dataset?.ogpower ?? '',
      ogtoughness: og.baseT ?? og.toughness ?? el?.dataset?.baseT ?? el?.dataset?.ogtoughness ?? '',
      ogTypes:     Array.isArray(og.ogTypes)   ? og.ogTypes   : tryJson(el?.dataset?.ogTypes)   || [],
      ogEffects:   Array.isArray(og.ogEffects) ? og.ogEffects : tryJson(el?.dataset?.ogEffects) || []
    };
  }

  function tryJson(s){ try{ return JSON.parse(s || ''); }catch{ return null; } }

  // Spawn fresh at a specific position and broadcast.
  function respawnAt({ cid, seat, x, y, payload }){
    const cardObj = {
      name: payload.name || '',
      img:  payload.img  || '',
      type_line:   payload.type_line   || '',
      mana_cost:   payload.mana_cost   || '',
      oracle_text: payload.oracle_text || '',
      // OG stats/lists help badges render instantly
      ogpower:     Number.isFinite(+payload.ogpower)     ? (+payload.ogpower)     : undefined,
      ogtoughness: Number.isFinite(+payload.ogtoughness) ? (+payload.ogtoughness) : undefined,
      ogTypes:     Array.isArray(payload.ogTypes)   ? payload.ogTypes   : [],
      ogEffects:   Array.isArray(payload.ogEffects) ? payload.ogEffects : [],
      // current P/T blank -> use base
      power:'', toughness:'', loyalty:''
    };

    let el = null;

    if (typeof window.spawnTableCard === 'function'){
      el = window.spawnTableCard(cardObj, x, y, { cid, owner: seat });
      if (!el){
        const sel = `.card[data-cid="${CSS.escape(String(cid))}"]`;
        el = document.querySelector(sel) || null;
      }
} else if (typeof window.Zones?.spawnToTable === 'function'){
  window.Zones.spawnToTable({ ...cardObj, cid }, seat);
  // resolve the node on the next frame and treat it as `el`
  const sel = `.card[data-cid="${CSS.escape(String(cid))}"]`;
  requestAnimationFrame(() => {
    const n = document.querySelector(sel);
    if (n){
      n.style.left = `${x}px`;
      n.style.top  = `${y}px`;
    }
  });
  // hand off: we'll hydrate below via the generic “if (el) … else RAF” branch
}


        // Broadcast spawn so peers reconstruct it
    try{
      const ok = sendRTC?.({
        type: 'spawn',
        cid, owner: seat,
        name: cardObj.name,
        img:  cardObj.img,
        x, y,
        ogpower:     cardObj.ogpower,
        ogtoughness: cardObj.ogtoughness,
        ogTypes:     cardObj.ogTypes,
        ogEffects:   cardObj.ogEffects,
        type_line:   cardObj.type_line,
        mana_cost:   cardObj.mana_cost,
        oracle_text: cardObj.oracle_text,
        power:'', toughness:'', loyalty:''
      });
      console.log('[COG][NET] spawn sent?', ok === undefined ? true : ok, { cid, seat, x, y });
    }catch(e){
      console.warn('[COG][NET] spawn failed', e);
    }

    // ---- HYDRATION: dataset + tooltip + force CardAttributes now ----
    const hydrate = (node) => {
      if (!node) return;

      // base P/T used by PT badge
      if (Number.isFinite(+payload.ogpower))     node.dataset.baseP = String(+payload.ogpower);
      if (Number.isFinite(+payload.ogtoughness)) node.dataset.baseT = String(+payload.ogtoughness);

      // effects/types used by attribute/badge modules
      if (payload.ogEffects) node.dataset.ogEffects = JSON.stringify(payload.ogEffects || []);
      if (payload.ogTypes)   node.dataset.ogTypes   = JSON.stringify(payload.ogTypes   || []);

      // identity for tooltip + type parser
      node.dataset.name      = payload.name        || node.dataset.name || '';
      node.dataset.type_line = payload.type_line   || node.dataset.type_line || '';
      node.dataset.typeLine  = payload.type_line   || node.dataset.typeLine  || ''; // legacy
      if (payload.mana_cost)   node.dataset.mana_cost = String(payload.mana_cost);
      if (payload.oracle_text) node.dataset.oracle    = String(payload.oracle_text);
      if (!node.dataset.owner && seat != null) node.dataset.owner = String(seat);

      // reattach tooltip (idempotent)
      try {
        if (typeof attachTooltip === 'function') {
          attachTooltip(node, {
            name: node.dataset.name || '',
            typeLine: node.dataset.type_line || '',
            costHTML: '',
            oracle: node.dataset.oracle || ''
          });
        }
      } catch {}

      // force attributes + PT badge to paint NOW (no waiting on observers)
      try {
        window.CardAttributes?.applyToDom?.(cid);
        window.CardAttributes?.refreshPT?.(cid);
        requestAnimationFrame(() => window.CardAttributes?.refreshPT?.(cid));
      } catch {}

      try { window.reflowAll?.(); } catch {}
    };

    // If we have an element (spawnTableCard path), hydrate now; else (spawnToTable) resolve next frame.
    if (el) {
      hydrate(el);
    } else {
      const sel = `.card[data-cid="${CSS.escape(String(cid))}"]`;
      requestAnimationFrame(() => {
        const node = document.querySelector(sel);
        if (node) {
          // ensure position is correct even if Zones path created it late
          node.style.left = `${x}px`;
          node.style.top  = `${y}px`;
        }
        hydrate(node);
      });
    }
  }


  async function performDelete(el){
  if (!el) return;

  const cid = el.dataset.cid;
  if (!cid) return;

  // 1) Detach from stack so no ghost followers remain
  try { window.Stacking?.detach?.(el); } catch {}

  // 2) HARD LOCAL DELETE – NO ZONES, NO GRAVEYARD, NO FALLBACK SHIT
  try {
    const kill = document.querySelector(`.card[data-cid="${CSS.escape(cid)}"]`);
    kill?.remove();
    window.Zones?.cfg?.removeTableCardDomById?.(cid);
  } catch(e){
    console.warn('local hard delete failed', e);
  }

  // 3) BROADCAST PURE DELETE (no zones)
  try {
    sendRTC?.({ type:'card:delete', cid });
  } catch(e){
    console.warn('net delete broadcast failed', e);
  }
}




  async function performRepair(el){
  if (!el) return;

  // Capture BEFORE deletion (the node will be removed)
  const cid   = el.dataset?.cid || '';
  const seat  = Number(el.dataset?.owner || mySeat());
  const left  = parseFloat(el.style.left || '0');
  const top   = parseFloat(el.style.top  || '0');

  // Build payload from DOM, then try to upgrade via Scryfall (by exact name)
  const fromDom = scryPayloadFromEl(el) || {};
  const name    = (fromDom.name || el.dataset?.name || '').trim();

  if (!cid) return;

  // 1) Hard delete locally + broadcast (uses your existing performDelete)
  await performDelete(el);

  // 2) Try Scryfall by name; fall back to DOM payload on any failure
  let payload = fromDom;
  if (name) {
    try {
      const sc = await fetchCardFromScryfallByName(name);
      payload = { ...sc, img: sc.img || fromDom.img || '' };
    } catch (e) {
      console.warn('[Repair] Scryfall lookup failed; using DOM payload', e);
    }
  }

  // 3) Double-guard: remove any stale node with this cid
  try {
    document.querySelectorAll(`.card[data-cid="${CSS.escape(cid)}"]`).forEach(n => n.remove());
    window.Zones?.cfg?.removeTableCardDomById?.(cid);
  } catch {}

  // 4) Respawn same cid at same coords + broadcast spawn
  respawnAt({ cid, seat, x:left, y:top, payload });

  try { Overlays?.notify?.('ok', 'Card repaired.'); } catch {}
}



async function fetchCardFromScryfallByName(name){
  const base = 'https://api.scryfall.com/cards/named?exact=';
  const url  = base + encodeURIComponent(String(name || '').trim());
  const res  = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('Scryfall lookup failed: ' + res.status);
  const j = await res.json();

  const face = Array.isArray(j.card_faces) && j.card_faces.length ? j.card_faces[0] : j;
  let img = j.image_uris?.normal || j.image_uris?.png ||
            face.image_uris?.normal || face.image_uris?.png || '';

  return {
    cid: '',
    name:        j.name || face.name || '',
    type_line:   j.type_line || face.type_line || '',
    mana_cost:   j.mana_cost || face.mana_cost || '',
    oracle_text: j.oracle_text || face.oracle_text || '',
    ogpower:     Number.isFinite(+j.power) ? +j.power :
                 (Number.isFinite(+face.power) ? +face.power : undefined),
    ogtoughness: Number.isFinite(+j.toughness) ? +j.toughness :
                 (Number.isFinite(+face.toughness) ? +face.toughness : undefined),
    ogTypes:     [],
    ogEffects:   [],
    img
  };
}





  // --- overlay injection ----------------------------------------------------

  function addButtonsOnce(){
    const actions = document.querySelector('.cs-actions');
    if (!actions) return;
    if (actions.querySelector('#csRepair')) return; // both buttons injected together

    const mk = (id, label, onClick) => {
      const b = document.createElement('button');
      b.id = id;
      b.className = 'cs-btn';
      b.textContent = label;
      b.addEventListener('click', onClick);
      return b;
    };

    const repairBtn = mk('csRepair', 'Repair', ()=> performRepair(lastCogEl));
    const deleteBtn = mk('csDelete', 'Delete', ()=> performDelete(lastCogEl));

    // Insert as: [Clear] [Repair] [Delete] [Save]
    const save = actions.querySelector('#csSave');
    const clear= actions.querySelector('#csClear');

    if (clear) actions.insertBefore(repairBtn, clear.nextSibling);
    else if (save) actions.insertBefore(repairBtn, save);
    else actions.appendChild(repairBtn);

    if (save) actions.insertBefore(deleteBtn, save);
    else actions.appendChild(deleteBtn);
  }

  // When your overlay opens, capture anchor and make sure buttons exist
  document.addEventListener('card:cog', (e)=>{
    const el = e?.detail?.el;
    if (el) lastCogEl = el;

    // Open your attributes overlay exactly as your app does
    try{
      const cid  = el?.dataset?.cid || '';
      const seat = Number(el?.dataset?.owner || mySeat());
      if (typeof Overlays?.openCardAttributes === 'function'){
        Overlays.openCardAttributes({ cid, seat });
      } else if (typeof window.openCardSettings === 'function'){
        window.openCardSettings(el);
      }
    }catch(err){
      console.warn('[COG] open attributes failed', err);
    }

    // Small delay so the DOM exists, then inject buttons
    setTimeout(addButtonsOnce, 0);
  });

  // In case the panel is static in DOM, try once and also watch for insertion
  const mo = new MutationObserver(addButtonsOnce);
  mo.observe(document.documentElement, { childList:true, subtree:true });
  addButtonsOnce();
})();
