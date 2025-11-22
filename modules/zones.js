// modules/zones.js
// Builds player/opponent zones and handles deck load + draw-to-hand behavior.
// ALSO tracks graveyard / exile contents per seat and can open a scrollable
// overlay browser to move cards back to the table/hand/etc.
const __MOD = (import.meta?.url || 'unknown').split('/').pop();
window.__modTime(__MOD, 'start');

import { DeckLoading } from './deck.loading.js';
import { CardPlacement } from './card.placement.math.js';
import { RulesStore } from './rules.store.js';
import { ScryOverlay } from './scry.js';
import { Cascade } from './cascade.engine.js';


// Known card type buckets for filtering
const TYPE_FILTERS = [
  'All',
  'Creature',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
  'Planeswalker',
  'Battle',
  'Token',
  'Legendary',
  'Tribal',
  'Aura',
  'Vehicle'
];






export const Zones = (() => {
	let _currentDeckList = []; // ← holds the loaded deck for magnifying-glass search


  // -----------------------------
  // PERSISTED ZONE STATE
  // -----------------------------
  // We track cards in zones (graveyard, exile, maybe later: deck top-known, etc.)
  // Each entry is a simple snapshot so we can rebuild or show in overlay.
  //
  // shape of an entry:
  // {
  //   cid: 'c_xxxx',
  //   name: 'Midnight Scavengers',
  //   img: 'http://...',
  //   typeLine: 'Creature — Human Rogue',
  //   ownerSeat: 1
  // }
  //
  // We keep separate buckets for player vs opponent.
  const state = {
    player: {
      graveyard: [],
      exile: [],
    },
    opponent: {
      graveyard: [],
      exile: [],
    }
  };

// === [SAVE API] =============================================================
// readonly snapshot of an owner zone (player|opponent, graveyard|exile)
function exportOwnerZone(ownerKey, zoneName){
  try{
    const arr = state?.[ownerKey]?.[zoneName] || [];
    return arr.map(x => ({ ...x })); // clone so callers can't mutate
  }catch{ return []; }
}

// import a full array snapshot into a specific owner/zone, replacing existing
function importOwnerZone(ownerKey, zoneName, list){
  try{
    if (!state[ownerKey] || !state[ownerKey][zoneName]) return false;
    const arr = Array.isArray(list) ? list.map(x => ({ ...x })) : [];
    state[ownerKey][zoneName].length = 0;      // preserve array identity
    state[ownerKey][zoneName].push(...arr);    // fill with new
    console.log('[Zones.importOwnerZone]', ownerKey, zoneName, { count: arr.length });
    return true;
  }catch(e){
    console.warn('[Zones.importOwnerZone] failed', e);
    return false;
  }
}

// reset all zones for an owner (used by loader before restore)
function resetOwnerZones(ownerKey){
  try{
    if (!state[ownerKey]) return false;
    ['graveyard','exile'].forEach(z => {
      if (Array.isArray(state[ownerKey][z])) state[ownerKey][z].length = 0;
    });
    console.log('[Zones.resetOwnerZones]', ownerKey);
    return true;
  }catch(e){
    console.warn('[Zones.resetOwnerZones] failed', e);
    return false;
  }
}


// programmatic move helper used by deck-search overlay and other flows
// payload: { name, img, cid?, typeLine? }  dest: 'graveyard'|'exile'
// ownerSeat: numeric seat; we map to 'player' or 'opponent' by mySeat()
function moveCardToZone(payload, dest, ownerSeat){
  try{
    const my = (typeof window.mySeat === 'function') ? window.mySeat() : 1;
    const ownerKey = (Number(ownerSeat||my) === Number(my)) ? 'player' : 'opponent';
    if (!state[ownerKey] || !state[ownerKey][dest]) {
      console.warn('[Zones.moveCardToZone] bad dest/owner', ownerKey, dest);
      return false;
    }
    const snap = {
      cid:       payload?.cid || ('snap_' + Math.random().toString(36).slice(2,10)),
      name:      payload?.name || '',
      img:       payload?.img  || '',
      typeLine:  payload?.typeLine || '',
      ownerSeat: Number(ownerSeat||my)
    };
    state[ownerKey][dest].unshift(snap);
    console.log('[Zones.moveCardToZone] →', ownerKey, dest, snap);
    return true;
  } catch(e){
    console.warn('[Zones.moveCardToZone] failed', e);
    return false;
  }
}


  // -----------------------------
  // HELPERS
  // -----------------------------

  const DECK_IMG = 'https://i.imgur.com/LdOBU1I.jpeg';

  // tiny DOM helper
  const el = (t, a = {}, h = '') => {
    const e = document.createElement(t);
    for (const k in a) {
      (k === 'class') ? e.className = a[k] : e.setAttribute(k, a[k]);
    }
    if (h) e.innerHTML = h;
    return e;
  };

  function makeZone(id, label, extra = '') {
  const z = el('div', { class: `zone ${extra}`.trim(), id });
  // ensure the zone can anchor absolutely-positioned children
  if (getComputedStyle(z).position === 'static') z.style.position = 'relative';

  const lab = el('div', { class: 'label' }, label);
  Object.assign(lab.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%,-50%)',
    width: '100%',
    display: 'block',
    textAlign: 'center',
    fontSize: '12px',
    fontWeight: '700',
    color: 'rgba(255,255,255,.88)',
    textShadow: '0 1px 2px rgba(0,0,0,.55)',
    pointerEvents: 'none',
    zIndex: '1'
  });
  z.appendChild(lab);
  return z;
}


  // Add commander name badge
  function setCommanderName(zoneEl, name) {
    if (!zoneEl) return;
    let badge = zoneEl.querySelector('.commander-name');
    if (!badge) {
      badge = el('div', { class: 'commander-name' });
      zoneEl.appendChild(badge);
    }
    badge.textContent = name || '';
  }

  // Mark deck visual
  function markDeckPresent(deckZone, has) {
    if (!deckZone) return;
    deckZone.classList.toggle('has-deck', !!has);
    if (has) {
      deckZone.style.backgroundImage = `url('${DECK_IMG}')`;
      deckZone.setAttribute('data-deck-back', DECK_IMG); // ← allow receivers to read a fallback
    } else {
      deckZone.style.backgroundImage = '';
      deckZone.removeAttribute('data-deck-back');
    }
  }


  // send deck-visual rtc
  function sendDeckVisual(has) {
    try {
      const fromSeat = (typeof window.mySeat === 'function') ? window.mySeat() : 1;
      const payload = { type: 'deck-visual', seat: fromSeat, has: !!has, who: 'player' };
      (window.rtcSend || window.peer?.send)?.(payload);
      console.log('%c[RTC:send]', 'color:#6cf', payload);
    } catch (e) {
      console.warn('[Zones] deck-visual send failed', e);
    }
  }
  
    // -----------------------------
  // RTC RECEIVE: deck-visual
  // -----------------------------
  (function installRecvDeckVisual(){
    try {
      // Utility: decide which deck zone to update given a sender seat
      function _targetDeckZoneForSender(senderSeat){
        const my = (typeof window.mySeat === 'function') ? window.mySeat() : 1;
        const isMe = Number(senderSeat) === Number(my);
        // If the sender is me, show on my local deck box; otherwise on opponent’s.
        return document.getElementById(isMe ? 'pl-deck' : 'op-deck');
      }

      function _ensureDeckImg(zone){
        if (!zone) return null;
        let img = zone.querySelector('img.deck-visual-img');
        if (!img) {
          img = document.createElement('img');
          img.className = 'deck-visual-img';
          Object.assign(img.style, {
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: getComputedStyle(zone).borderRadius || '0',
            pointerEvents: 'none',
            zIndex: '0' // keep label/commander badge above
          });
          zone.appendChild(img);
        }
        return img;
      }

      function _pickUrl(msg, zone){
        // Priority: msg.url → data-deck-back on the zone → DECK_IMG constant → nothing
        const attr = zone?.getAttribute('data-deck-back') || '';
        return msg?.url || attr || DECK_IMG || '';
      }

      function recvDeckVisual(msg){
        if (!msg || msg.type !== 'deck-visual') return;
        const zone = _targetDeckZoneForSender(msg.seat);
        if (!zone) return;

        if (msg.has) {
          const img = _ensureDeckImg(zone);
          const src = _pickUrl(msg, zone);
          if (src) {
            img.src = src;
            zone.classList.add('has-deck');
            zone.setAttribute('data-deck-back', src);
            // keep CSS background in sync for any styles that reference it
            zone.style.backgroundImage = `url('${src}')`;
          }
        } else {
          // remove visual
          const img = zone.querySelector('img.deck-visual-img');
          if (img) img.remove();
          zone.classList.remove('has-deck');
          zone.style.backgroundImage = '';
          zone.removeAttribute('data-deck-back');
        }
      }

      // Install into a shared RTCApply namespace
      window.RTCApply = window.RTCApply || {};
      window.RTCApply.recvDeckVisual = recvDeckVisual;

      // Optional: wire a generic message demux if you use a single entry point
      // If you already dispatch messages elsewhere, skip this.
      if (!window.__ZonesDeckVisualHookInstalled) {
        window.__ZonesDeckVisualHookInstalled = true;
        const oldRecv = window.RTCApply.recv || null;
        window.RTCApply.recv = function(msg){
          try { recvDeckVisual(msg); } catch {}
          if (typeof oldRecv === 'function') return oldRecv(msg);
        };
      }
    } catch (e) {
      console.warn('[Zones] installRecvDeckVisual failed', e);
    }
  })();


  // -----------------------------
  // ZONE RECORDING (called by CardPlacement when card dies)
// ownerKey = 'player' | 'opponent'
// zoneName = 'graveyard' | 'exile'
// cardEl   = actual <img.table-card ...>
function recordCardToZone(ownerKey, zoneName, cardEl){
  if (!ownerKey || !zoneName || !cardEl) return;
  if (!state[ownerKey] || !state[ownerKey][zoneName]) return;

  const snap = {
    cid: cardEl.dataset.cid,
    name: cardEl.dataset.name || cardEl.title || '',
    img:  cardEl.currentSrc || cardEl.src || '',
    // try to preserve card typeline for filtering
    typeLine: cardEl.dataset.typeLine || '',
    ownerSeat: (typeof window.mySeat === 'function') ? window.mySeat() : 1
  };

  state[ownerKey][zoneName].unshift(snap); // newest first
  console.log('[Zones.recordCardToZone]', ownerKey, zoneName, snap);

    // 🔻 NEW: when a SOURCE leaves the battlefield, purge ALL effects it created
  try {
    const srcCid = String(snap.cid || '');
    if (srcCid) {
      // 1) Enumerate FIRST (store still has them so recvBuffRemove can find & prune)
      const toPurge = (RulesStore.listEffectsBySource?.(srcCid) || []);

      // 2) For each effect, locally mirror full cleanup (this removes from store too)
      const sendFn = (window.rtcSend || window.peer?.send);
      const toRefresh = new Set();

      for (const r of toPurge) {
        const pkt = { type:'buffRemove', effectId: r.effectId, targetCid: r.targetCid || null };

        // Local: ensures removeEffectLocally() runs to nuke abilities/types/PT + dataset mirrors
        try { window.RTCApply?.recvBuffRemove?.(pkt); } catch {}

        // RTC broadcast so opponent purges too
        try { sendFn?.(pkt); } catch {}

        if (r.targetCid) toRefresh.add(String(r.targetCid));
      }

      // 3) UI refresh (belt + suspenders)
      for (const cid of toRefresh) {
        try { window.Badges?.refreshFor?.(cid); } catch {}
        try { window.Tooltip?.refreshFor?.(cid); } catch {}
      }

      if (toPurge.length) {
        console.log('[Zones] Purged effects linked to source (recv->store->ui path)', srcCid, toPurge);
      }
    }
  } catch (e) {
    console.warn('[Zones] purge-by-source failed', e);
  }

}


  // helper to remove a card snapshot from a zone by cid
  function removeSnapshotFromZone(ownerKey, zoneName, cid){
  if (!cid) return;
  const arr = state[ownerKey]?.[zoneName];
  if (!arr) return;
  const idx = arr.findIndex(c => c.cid === cid);
  if (idx >= 0) arr.splice(idx, 1);  // mutate the same array
}

///* =========================================================================
// * NEW: removeCardFromTableByCid(cid, finalZone='deck', ownerSide?)
// * Mirror the single-card drop flow: detach UI, remove DOM, clear local state,
// * and broadcast an RTC {type:'remove', cid, zone:finalZone, ownerSide}.
// * Returns true if a table or hand element was found and removed.
// * ========================================================================= */
//function removeCardFromTableByCid(cid, finalZone='deck', ownerSide){
//  try{
//    if (!cid) return false;
//
//    // Prefer an actual table card image element
//    let el = document.querySelector(`img.table-card[data-cid="${cid}"]`);
//
//    // If not found on table, try the hand (various selectors used in your codebase)
//    if (!el) {
//      el = document.querySelector([
//        `[data-zone="hand"] [data-cid="${cid}"]`,
//        `.hand .hand-card[data-cid="${cid}"]`,
//        `img.hand-card[data-cid="${cid}"]`,
//        `img.card[data-cid="${cid}"]`
//      ].join(','));
//    }
//
//    if (!el) {
//      console.warn('[Zones.removeCardFromTableByCid] element not found for cid', cid);
//      return false;
//    }
//
//    // Determine ownerSide if not given
//    if (!ownerSide){
//      try {
//        const my = String(window.mySeat?.() || '1');
//        const cur = String(el.dataset.owner || el.dataset.ownerCurrent || my);
//        ownerSide = (cur === my) ? 'player' : 'opponent';
//      } catch { ownerSide = 'player'; }
//    }
//
//    // If moving to grave/exile, record a zone snapshot like finalizeDrop does
//    try {
//      if (finalZone === 'graveyard' || finalZone === 'exile') {
//        window.Zones?.recordCardToZone?.(ownerSide, finalZone, el);
//      }
//    } catch {}
//
//    // UI/DOM cleanup identical to single-card path
//    try { window.Tooltip?.hide?.(); } catch {}
//    try { window.Badges?.detach?.(el); } catch {}
//    try { el.remove(); } catch {}
//
//    try { (window.CardPlacement || {}).state?.byCid?.delete?.(cid); } catch {}
//
//    // Broadcast RTC so the remote removes their copy
//    try {
//      (window.rtcSend || window.peer?.send)?.({
//        type: 'remove',
//        cid,
//        zone: finalZone,
//        ownerSide
//      });
//    } catch (e) {
//      console.warn('[Zones.removeCardFromTableByCid] RTC send failed', e);
//    }
//
//    return true;
//  } catch (e) {
//    console.warn('[Zones.removeCardFromTableByCid] failed', e);
//    return false;
//  }
//}


  // -----------------------------
  // OVERLAY BROWSER
  // -----------------------------
  // Shows contents of a zone (your graveyard / opponent exile / etc),
  // lets you filter, and lets you yank a card back out.
  //
  // ownerKey = 'player' | 'opponent'
  // zoneName = 'graveyard' | 'exile'
  function openZoneBrowser(ownerKey, zoneName){
if (!state[ownerKey] || !state[ownerKey][zoneName]) return;
  const getListData = () => state[ownerKey][zoneName];

  // build dimmer
  const dim = document.createElement('div');
  dim.className = 'zone-overlay-dim';
  Object.assign(dim.style, {
    position: 'fixed',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,

    // still dim screen but a hair more blue so it blends
    background: 'rgba(4,10,20,0.82)',
    // bring WAY above badges etc
    zIndex: 999999,

    display: 'grid',
    placeItems: 'center',
    color: 'var(--ui-text, #fff)',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
  });

  // card browser panel
  const panel = document.createElement('div');
  panel.className = 'zone-overlay-panel';
  Object.assign(panel.style, {
    // panel should ALSO be blue instead of black
    background: 'linear-gradient(180deg, #0c1a2b 0%, #000814 100%)',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: '12px',
    minWidth: '360px',
    maxWidth: '600px',
    maxHeight: '80vh',
    width: '90%',
    boxShadow: '0 40px 80px rgba(0,0,0,.9), 0 0 12px rgba(0,128,255,.25) inset',
    display: 'flex',
    flexDirection: 'column',
    color: 'rgba(255,255,255,.92)',
    overflow: 'hidden',
    position: 'relative',
    zIndex: 1000000 // panel above absolutely everything
  });

  // header row (title + close)
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255,255,255,.15)',
    background: 'radial-gradient(circle at 0% 0%, rgba(0,128,255,.22) 0%, rgba(0,0,0,0) 70%)',
    fontWeight: '600',
    fontSize: '14px',
    color: 'var(--ui-text,#e8f1ff)'
  });

  const niceOwner = ownerKey === 'player' ? 'Your' : "Opponent's";
  const titleTxt = `${niceOwner} ${zoneName}`;
  const titleEl = document.createElement('div');
  titleEl.textContent = titleTxt.charAt(0).toUpperCase() + titleTxt.slice(1);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  Object.assign(closeBtn.style, {
    background: 'linear-gradient(180deg,#1f2f44,#0c1320)',
    color: 'var(--ui-text,#fff)',
    border: '1px solid rgba(255,255,255,.25)',
    borderRadius: '6px',
    fontSize: '13px',
    padding: '4px 8px',
    cursor: 'pointer',
    boxShadow: '0 8px 16px rgba(0,0,0,.8), inset 0 0 4px rgba(255,255,255,.2)'
  });
  closeBtn.addEventListener('click', () => dim.remove());

  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  // filter row (search + type dropdown)
  const filterRow = document.createElement('div');
  Object.assign(filterRow.style, {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255,255,255,.08)',
    background: 'linear-gradient(180deg,rgba(0,0,0,.4),rgba(0,0,0,0))'
  });

  const searchInput = document.createElement('input');
  Object.assign(searchInput.style, {
    flex: '1 1 auto',
    minWidth: '0',
    background: '#000814',
    border: '1px solid rgba(255,255,255,.25)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    padding: '6px 8px'
  });
  searchInput.placeholder = 'Search name...';

  const typeSelect = document.createElement('select');
  Object.assign(typeSelect.style, {
    flex: '0 0 auto',
    background: '#000814',
    border: '1px solid rgba(255,255,255,.25)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    padding: '6px 8px',
    maxWidth: '140px'
  });
  for (const t of TYPE_FILTERS){
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    typeSelect.appendChild(opt);
  }

  filterRow.appendChild(searchInput);
  filterRow.appendChild(typeSelect);

  // scroll area for cards
  const listWrap = document.createElement('div');
  Object.assign(listWrap.style, {
    flex: '1 1 auto',
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  });

  // does a card match current filters?
  function cardMatchesFilters(card){
    const q = searchInput.value.trim().toLowerCase();
    const f = typeSelect.value;
    if (q && !card.name.toLowerCase().includes(q)) return false;
    if (f && f !== 'All'){
      const tl = (card.typeLine || '').toLowerCase();
      if (!tl.includes(f.toLowerCase())) return false;
    }
    return true;
  }

  // RENDER LIST (UPDATED: bigger card preview, blue row bg, 2x2 buttons stay)
  function renderList(){
    const frag = document.createDocumentFragment(); // smoother than innerHTML wipe

    // clear current children without nuking the scrollbox itself
    while (listWrap.firstChild) listWrap.removeChild(listWrap.firstChild);

    const filtered = getListData().filter(cardMatchesFilters);
    if (!filtered.length){
      const empty = document.createElement('div');
      empty.textContent = '(empty)';
      Object.assign(empty.style, {
        color: 'var(--ui-muted,#8899bb)',
        fontSize: '13px',
        textAlign: 'center',
        padding: '24px 0'
      });
      frag.appendChild(empty);
      listWrap.appendChild(frag);
      return;
    }

    for (const card of filtered){
      const viewingZone = zoneName; // 'graveyard' | 'exile'

      // wrapper row
const row = document.createElement('div');
Object.assign(row.style, {
  background: 'radial-gradient(circle at 0% 0%, rgba(0,128,255,.18) 0%, rgba(0,0,0,0) 60%), linear-gradient(180deg, #102a46 0%, #061021 100%)',
  border: '1px solid rgba(255,255,255,.18)',
  borderRadius: '12px',
  boxShadow: '0 24px 40px rgba(0,0,0,.8), 0 0 20px rgba(0,128,255,.25) inset',
  padding: '12px 12px 16px 12px',
  display: 'grid',

  // ⬅️ UPDATED: give the image a bigger dedicated column
  gridTemplateColumns: '210px 1fr',

  columnGap: '16px',
  alignItems: 'start',
  fontSize: '13px',
  lineHeight: 1.4,
  color: 'var(--ui-text,#e8f1ff)',
  position: 'relative',
  zIndex: 1000001
});

// BIG CARD PREVIEW
const img = document.createElement('img');
img.src = card.img || '';
Object.assign(img.style, {
  // ⬅️ UPDATED: 210 instead of 140
  width: '210px',
  minWidth: '210px',

  height: 'auto',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,.3)',
  objectFit: 'cover',
  background: '#000',
  boxShadow: '0 16px 32px rgba(0,0,0,.9)'
});


      // right side: text + buttons
      const rightCol = document.createElement('div');
      rightCol.style.display = 'flex';
      rightCol.style.flexDirection = 'column';
      rightCol.style.minWidth = 0;
      rightCol.style.gap = '12px';

      // text block
      const textBlock = document.createElement('div');
      textBlock.style.minWidth = 0;

      const nm = document.createElement('div');
      nm.textContent = card.name || '(Card)';
      Object.assign(nm.style, {
        fontWeight: '600',
        color: 'var(--ui-text,#e8f1ff)',
        fontSize: '14px',
        textOverflow: 'ellipsis',
        overflow: 'hidden',
        whiteSpace: 'nowrap'
      });

      const tl = document.createElement('div');
      tl.textContent = card.typeLine || '';
      Object.assign(tl.style, {
        color: 'var(--ui-muted,#a7bedb)',
        fontSize: '12px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      });

      textBlock.appendChild(nm);
      textBlock.appendChild(tl);

      // BUTTON GRID
      const btnGrid = document.createElement('div');
      Object.assign(btnGrid.style, {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '8px',
        width: '100%'
      });

      function styledBtn(label){
        const b = document.createElement('button');
        b.textContent = label;
        Object.assign(b.style, {
          width: '100%',
          background: 'linear-gradient(180deg,#112a45 0%,#081529 100%)',
          color: 'var(--ui-text,#e8f1ff)',
          border: '1px solid rgba(255,255,255,.28)',
          borderRadius: '10px',
          fontSize: '13px',
          fontWeight: '700',
          lineHeight: 1.2,
          padding: '10px 6px',
          cursor: 'pointer',
          textAlign: 'center',
          boxShadow: 'inset 0 0 2px rgba(255,255,255,.4), 0 10px 20px rgba(0,0,0,.8)'
        });
        b.onpointerdown = (ev)=>ev.stopPropagation();
        return b;
      }

      // Which "zone swap" word to show in top-left cell?
      // If I'm viewing graveyard, top-left should say Exile.
      // If I'm viewing exile, top-left should say Graveyard.
      let zoneSwapLabel = (viewingZone === 'graveyard') ? 'Exile' : 'Graveyard';

      const btnZoneSwap = styledBtn(zoneSwapLabel);
      // hide if swap == current zone (shouldn't happen with above logic, but safety)
      btnZoneSwap.style.display =
        (zoneSwapLabel.toLowerCase() === viewingZone.toLowerCase()) ? 'none' : '';

      btnZoneSwap.addEventListener('click', () => {
        console.log('[ZoneOverlay] Move to', zoneSwapLabel.toUpperCase(), card);
        removeSnapshotFromZone(ownerKey, viewingZone, card.cid);
        if (zoneSwapLabel.toLowerCase() === 'exile') {
          state[ownerKey].exile.unshift(card);
        } else {
          state[ownerKey].graveyard.unshift(card);
        }
        renderList();
      });

      const btnHand = styledBtn('Hand');
      btnHand.addEventListener('click', () => {
        console.log('[ZoneOverlay] Move to HAND', card);
        try {
          window.flyDrawToHand?.(
            { name: card.name, imageUrl: card.img },
            null
          );
        } catch(e) { console.warn('flyDrawToHand failed', e); }
        removeSnapshotFromZone(ownerKey, viewingZone, card.cid);
        renderList();
      });

      const btnDeck = styledBtn('Deck');
      btnDeck.addEventListener('click', () => {
        console.log('[ZoneOverlay] Move to DECK (top by default?)', card);
        // future: top/bottom/random UI
        removeSnapshotFromZone(ownerKey, viewingZone, card.cid);
        renderList();
      });

      const btnTable = styledBtn('Table');
      btnTable.addEventListener('click', () => {
        console.log('[ZoneOverlay] Move to TABLE', card);
        try {
          CardPlacement.spawnCardLocal({
            name: card.name,
            img: card.img
          });
        } catch(e) { console.warn('spawnCardLocal failed', e); }

        removeSnapshotFromZone(ownerKey, viewingZone, card.cid);
        renderList();
      });

      // button order in grid:
      // [Exile/Graveyard] [Hand]
      // [Deck]            [Table]
      btnGrid.appendChild(btnZoneSwap);
      btnGrid.appendChild(btnHand);
      btnGrid.appendChild(btnDeck);
      btnGrid.appendChild(btnTable);

      // stitch column
      rightCol.appendChild(textBlock);
      rightCol.appendChild(btnGrid);

      // stitch row
      row.appendChild(img);
      row.appendChild(rightCol);

      frag.appendChild(row);
    }
	listWrap.appendChild(frag); 
  }

  // live filter bindings
  searchInput.addEventListener('input', renderList);
  typeSelect.addEventListener('change', renderList);

  // assemble panel
  panel.appendChild(header);
  panel.appendChild(filterRow);
  panel.appendChild(listWrap);

  dim.appendChild(panel);
  document.body.appendChild(dim);

  // first render
  renderList();
  listWrap.style.transition = 'opacity 120ms ease';
const _render = renderList;
renderList = () => {
  listWrap.style.opacity = '0.8';
  _render();
  requestAnimationFrame(() => { listWrap.style.opacity = '1'; });
};

}


  // -----------------------------
  // BUILD FIELDS / MOUNT
  // -----------------------------

  function buildPlayerField() {
    const field = el('section', { class: 'field bottom', 'aria-label': 'Player field' });
    const grid = el('div', { class: 'zones' });

    const exileZ = makeZone('pl-exile', 'Exile');
    const graveZ = makeZone('pl-graveyard', 'Graveyard');
    const deckZ  = makeZone('pl-deck', 'Deck', 'deck');
    const cmdZ   = makeZone('pl-commander', 'Commander', 'commander');

    // click exile/grave to open overlay
    exileZ.addEventListener('click', () => openZoneBrowser('player','exile'));
    graveZ.addEventListener('click', () => openZoneBrowser('player','graveyard'));

    grid.appendChild(exileZ);
    grid.appendChild(graveZ);
    // swapped order so badges on the right of Commander no longer cover the Deck
    grid.appendChild(deckZ);
    grid.appendChild(cmdZ);

    field.appendChild(grid);
    return field;
  }

  // Opponent (top) MIRRORED: [D][C] / [E][G]
  function buildOpponentField() {
    const field = el('section', { class: 'field top', 'aria-label': 'Opponent field' });
    const grid = el('div', { class: 'zones' });

    const deckZ  = makeZone('op-deck', 'Deck', 'deck');
	deckZ.setAttribute('data-deck-back', DECK_IMG);

    const cmdZ   = makeZone('op-commander', 'Commander', 'commander');
    const exileZ = makeZone('op-exile', 'Exile');
    const graveZ = makeZone('op-graveyard', 'Graveyard');

    // clicking opponent zones should open opponent lists
    exileZ.addEventListener('click', () => openZoneBrowser('opponent','exile'));
    graveZ.addEventListener('click', () => openZoneBrowser('opponent','graveyard'));

    grid.appendChild(deckZ);
    grid.appendChild(cmdZ);
    grid.appendChild(exileZ);
    grid.appendChild(graveZ);

    field.appendChild(grid);
    return field;
  }

  function buildCombatAndGuides(world) {
    world.appendChild(el('div', { class: 'half-guide top' }));
    world.appendChild(el('div', { class: 'half-guide bottom' }));
    world.appendChild(el('div', { class: 'mid-gap', 'aria-hidden': 'true' }));
    world.appendChild(el('div', { class: 'mid-label' }, 'Midline / Combat Gap'));
  }

  // --- Deck UI + Draw Behavior ---
  // --- Deck UI + Draw Behavior ---
function bindDeckUI(){
  const deckZone = document.getElementById('pl-deck');
  const cmdZone  = document.getElementById('pl-commander');
  if (!deckZone) return;

  // ---------- Attach the 5-button cluster (once), anchored to the deck ----------
  if (!deckZone.dataset.clusterAttached) {
    deckZone.dataset.clusterAttached = '1';
    // ensure the cluster can absolutely-position against the deck box
    if (getComputedStyle(deckZone).position === 'static') {
      deckZone.style.position = 'relative';
    }

// ⬇️ Remove the capture-phase shield entirely. We already guard deckZone's
// click with `if (e.target.closest('.deck-cluster')) return;` so no shield needed.
// (Nothing here.)


// cluster shell
const cluster = document.createElement('div');
cluster.classList.add('deck-cluster'); // ← give it a selector we can guard on
Object.assign(cluster.style, {
  position: 'absolute',
  left: '-150px',
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'grid',
  gridTemplateAreas: `"north" "center" "south"`,
  placeItems: 'center',
  gap: '6px',
  pointerEvents: 'auto',
  zIndex: 9_999
});





// Tweakables for cluster feel
const BTN_SIZE = 60;   // ⬅️ ALL buttons (Draw/Cascade/🃏/+/🔍) are 60×60
const BTN_GAP  = 20;   // ⬅️ bigger vertical spacing between top/center/bottom

// apply the larger gap to the column
cluster.style.gap = `${BTN_GAP}px`;



function makeDeckBtn(label, area, extraStyle = {}) {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.area = area;
  Object.assign(b.style, {
    width: `${BTN_SIZE}px`,
    height: `${BTN_SIZE}px`,
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,.25)',
    background: 'linear-gradient(180deg,#102a46,#060e1f)',
    color: '#e8f1ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    lineHeight: '1.1',
    padding: '0 6px',
    fontSize: '14px',        // keep labels readable at 60px
    fontWeight: '700',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,.6), inset 0 0 4px rgba(255,255,255,.2)',
    ...extraStyle
  });
  


  cluster.appendChild(b);
  return b;
}

// main vertical stack (all 60×60 automatically)
const btnDraw    = makeDeckBtn('Draw X',    'north');
const btnCenter  = makeDeckBtn('Scry‎‎‎ ‎  X',        'center');
const btnCascade = makeDeckBtn('Cascade X', 'south');

// side buttons — centered vertically; plus NE/SE extensions
const SIDE_OFFSET = `-${BTN_SIZE + 16}px`; // 60px button + 16px breathing room

// existing east/west
const btnSearch  = makeDeckBtn('🔍', 'east', { position:'absolute', right: SIDE_OFFSET, top:'50%', transform:'translateY(-50%)' });
const btnAdd     = makeDeckBtn('➕', 'west',  { position:'absolute', left:  SIDE_OFFSET, top:'50%', transform:'translateY(-50%)' });

const btnDiscard = makeDeckBtn('Discard X', 'north-east', {
  position: 'absolute',
  right: SIDE_OFFSET,
  top: 0,
  transform: 'translateY(0%)',
});
const btnReturn = makeDeckBtn('Return X', 'south-east', {
  position: 'absolute',
  right: SIDE_OFFSET,
  bottom: 0,
  transform: 'translateY(0%)',
});

// ⬇⬇ NEW: mirror to the WEST side (NW / SW)
const btnRules = makeDeckBtn('Rules…', 'north-west', {
  position: 'absolute',
  left: SIDE_OFFSET,
  top: 0,
  transform: 'translateY(0%)',
});
const btnStats = makeDeckBtn('Stats', 'south-west', {
  position: 'absolute',
  left: SIDE_OFFSET,
  bottom: 0,
  transform: 'translateY(0%)',
});





   // lightweight number pad; optional destination toggle (Graveyard/Exile)
function openNumberPad(label, onPick, opts = {}) {
  const showDest = opts.showDest !== false; // default true (keep old behavior)

  const dim = document.createElement('div');
  Object.assign(dim.style, {
    position:'fixed', inset:0, background:'rgba(0,0,0,.7)',
    display:'grid', placeItems:'center', zIndex:999_999
  });

  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    background:'#0c1a2b',
    border:'1px solid rgba(255,255,255,.2)',
    borderRadius:'12px',
    padding:'16px',
    display:'grid',
    gridTemplateRows: showDest ? 'auto auto' : 'auto',
    gap:'10px',
    minWidth:'280px'
  });

  // ── Optional: Graveyard / Exile toggle
  let dest = 'graveyard';
  if (showDest) {
    const toggle = document.createElement('div');
    Object.assign(toggle.style, { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' });

    function mkChip(txt, selected) {
      const b = document.createElement('button');
      b.textContent = txt;
      Object.assign(b.style, {
        padding:'8px 10px',
        border:'1px solid ' + (selected ? 'rgba(93,168,255,.9)' : 'rgba(255,255,255,.25)'),
        background: selected ? '#1b2f4d' : 'linear-gradient(180deg,#102a46,#060e1f)',
        color:'#e9f2ff', fontWeight:'900', borderRadius:'10px', cursor:'pointer'
      });
      b.dataset.selected = selected ? '1' : '0';
      return b;
    }

    const btnGY = mkChip('Graveyard', true);
const btnEX = mkChip('Exile',     false);

function updateHighlight(sel) {
  const gySel = sel === 'graveyard';
  const exSel = sel === 'exile';
  Object.assign(btnGY.style, {
    border: '1px solid ' + (gySel ? 'rgba(93,168,255,.9)' : 'rgba(255,255,255,.25)'),
    background: gySel ? '#1b2f4d' : 'linear-gradient(180deg,#102a46,#060e1f)'
  });
  Object.assign(btnEX.style, {
    border: '1px solid ' + (exSel ? 'rgba(93,168,255,.9)' : 'rgba(255,255,255,.25)'),
    background: exSel ? '#1b2f4d' : 'linear-gradient(180deg,#102a46,#060e1f)'
  });
}

btnGY.onclick = () => { dest = 'graveyard'; updateHighlight(dest); };
btnEX.onclick = () => { dest = 'exile';     updateHighlight(dest); };


    toggle.appendChild(btnGY);
    toggle.appendChild(btnEX);
    wrap.appendChild(toggle);
  }

  // ── Number grid (unchanged styles)
  const pad = document.createElement('div');
  Object.assign(pad.style, { display:'grid', gridTemplateColumns:'repeat(5,40px)', gap:'8px', justifyContent:'center' });

  const keys = ['1','2','3','4','5','6','7','8','9','X'];
  for (const k of keys) {
    const b = document.createElement('button');
    b.textContent = k;
    Object.assign(b.style, { width:'40px', height:'40px', borderRadius:'8px',
      border:'1px solid rgba(255,255,255,.25)',
      background:'linear-gradient(180deg,#102a46,#060e1f)',
      color:'#fff', fontWeight:'700', cursor:'pointer'
    });
    b.onclick = () => {
      let count;
      if (k === 'X') {
        const v = window.prompt(`${label} — How many?`, '2');
        count = Math.max(1, Math.floor(Number(v) || 0));
      } else {
        count = Math.max(1, Math.floor(Number(k) || 1));
      }
	  
      dim.remove();
      // Only provide dest if we showed the toggle
      onPick(showDest ? { count, dest } : { count });
    };
	

    pad.appendChild(b);
  }

  dim.onclick = (e) => { if (e.target === dim) dim.remove(); };
  dim.addEventListener('pointerdown', (e)=>e.stopPropagation(), true);

  document.body.appendChild(dim);
  dim.appendChild(wrap);
  wrap.appendChild(pad);
}


    // Helper to keep clicks from bubbling to the deck zone
const onClick = (btn, fn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();                 // <-- critical: let the target fire, don't bubble
    try { fn(e); } catch (err) { console.warn('[Deck btn error]', err); }
  });
};

// small pacing gap so multiple draws animate sanely (and RTC doesn’t choke)
const DRAW_GAP_MS = 30;

// Helper: discard top N cards from deck to a zone ('graveyard' | 'exile')
// - Mutates DeckLoading.state.library (top = shift())
// - Pushes zone snapshots via Zones.moveCardToZone(...)
// - Notifies UI/RTC
function discardTopNTo(zoneName, n) {
  try {
    const lib = (window.DeckLoading?.state?.library || []);
    if (!Array.isArray(lib) || !lib.length) return;

    const mySeat = (typeof window.mySeat === 'function') ? Number(window.mySeat()) : 1;
    const take = Math.max(1, Math.floor(Number(n) || 1));

    for (let i = 0; i < take; i++) {
      if (!lib.length) break;
      const top = lib.shift();
  // 🔹 one card left the library
  try { window.TurnUpkeep?.noteLibrary?.(-1, { reason:'leave', via:'discardTopNTo', to: zoneName }); } catch {}

      const payload = {
        name:     top?.name || '',
        img:      top?.img || top?.image || top?.imageUrl || '',
        typeLine: top?.type_line || top?.typeLine || ''
      };

      // Local snapshot into my grave/exile (same as before)
window.Zones?.moveCardToZone?.(payload, zoneName, mySeat);

// NEW: bump TurnUpkeep tallies per card
try {
  if (zoneName === 'graveyard') {
    window.TurnUpkeep?.noteGrave?.();
  } else if (zoneName === 'exile') {
    window.TurnUpkeep?.noteExile?.();
  }
} catch {}

// RTC: style like "remove" so rtc.bus.js handles uniformly
try {
  (window.rtcSend || window.peer?.send)?.({
    type: 'remove',
    zone: zoneName,        // 'graveyard' | 'exile'
    seat: mySeat,
    fromDeck: true,
    card: payload,
    // OPTIONAL: hint for remote to also tally (safe to ignore if unhandled)
    tally: (zoneName === 'graveyard' || zoneName === 'exile') ? zoneName : undefined
  });
} catch {}

    }

    try { window.dispatchEvent?.(new CustomEvent('deckloading:changed')); } catch {}
  } catch (e) {
    console.warn('[discardTopNTo] failed', e);
  }
}



// wire actions (live)
onClick(btnDraw, () => {
  openNumberPad('Draw X', async ({ count }) => {
    if (deckZone.dataset.hasDeck !== '1') { openLoader(); return; }
    for (let i = 0; i < Math.max(1, Number(count) || 1); i++) {
      const ok = DeckLoading.drawOneToHand(deckZone);
      if (!ok) break;
	    // 🔹 one card left the library (draw)
  try { window.TurnUpkeep?.noteLibrary?.(-1, { reason:'leave', via:'draw' }); } catch {}

      try {
        const seatNow = (typeof window.mySeat === 'function') ? Number(window.mySeat()) : 1;
        window.TurnUpkeep?.recordDraw?.(seatNow, 1);
        window.dispatchEvent(new CustomEvent('turn:localDraw', { detail: { seat: seatNow }}));
      } catch {}
      await new Promise(r => setTimeout(r, DRAW_GAP_MS));
    }
  }, { showDest: false });
});



onClick(btnCascade, async () => {
  try {
    Cascade.init({ combatAnchorSelector: '.mid-gap', offsetX: -32, zBase: 50000 });
    await Cascade.openQuickPick(); // opens 1–9, X, Special and runs the flow
  } catch (e) {
    console.warn('[Cascade] failed', e);
  }
});

onClick(btnCenter, () => {
  ScryOverlay.open();
});

onClick(btnSearch,  () => { console.log('[Deck] 🔍 open'); openDeckSearchOverlay(); });
onClick(btnAdd,     () => { console.log('[Deck] ➕ open'); openAddAnyCardOverlay(); });

// attach handlers
// NEW: Discard X (north-east)
onClick(btnDiscard, () => {
  openNumberPad('Discard X', ({ count, dest }) => {
    // dest is 'graveyard' | 'exile'
    discardTopNTo(dest, count);
  });
});

onClick(btnReturn, () => {
  openNumberPad('Return X', (key) => {
    const count = key === 'X'
      ? Math.max(1, Math.floor(Number(prompt('Return how many?', '1')) || 1))
      : Number(key);
    console.log(`[DeckCluster] Return ${count}`);
    window.dispatchEvent(new CustomEvent('deck:return', { detail:{ count } }));
  });
});

// ⬇⬇ NEW
onClick(btnRules, () => {
  console.log('[Deck] 📜 Rules overlay');
  openRulesOverlay();
});

onClick(btnStats, () => {
  console.log('[Deck] 📊 Turn stats + snapshot overlay');
  openStatsOverlay();
});






    deckZone.appendChild(cluster);
  }
  // ---------- (end cluster attach) ----------

  // Initialize DeckLoading once and wire its callback
  DeckLoading.init({
	  
    // NOTE the 4th arg here ⬇⬇
    onLoaded: (deck, commander, commanderImg, commanderMetaObj) => {
      deckZone.dataset.hasDeck = '1';
      deckZone.classList.add('has-deck');
      deckZone.style.backgroundImage = `url('${DECK_IMG}')`;
      deckZone.setAttribute('data-deck-back', DECK_IMG); // ← mirror into attribute for receivers

// Use the fully-built drawable library so the deck-search overlay
// has name + image + typeLine available.
// Normalize common field names so filters always work.
const lib = (DeckLoading?.state?.library || []);
_currentDeckList = lib.map(c => ({
  name:     c?.name || '',
  img:      c?.img || c?.image || c?.imageUrl || '',
  
  // ✅ Always derive a correct typeLine:
  typeLine: c?.type_line || c?.typeLine || '',
  
  // ✅ Normalize base types so type filters actually match:
  baseTypes:       Array.isArray(c?.baseTypes) ? c.baseTypes : [],
  frontBaseTypes:  Array.isArray(c?.frontBaseTypes) ? c.frontBaseTypes : [],
  backBaseTypes:   Array.isArray(c?.backBaseTypes) ? c.backBaseTypes : []
}));



      if (commander){
        setCommanderName(cmdZone, commander);
        try {
          CardPlacement.spawnCommanderLocal({
            name: commander,
            img: (commanderImg || DECK_IMG),
            // ⬅ MUST match your spawnCommanderLocal param
            commanderMeta: commanderMetaObj || null
          });
        } catch (e) {
          console.warn('[Zones] spawnCommanderLocal failed', e);
        }
      }

      // rtc "deck-visual"
      try{
        const fromSeat = (typeof window.mySeat === 'function') ? window.mySeat() : 1;
        const payload = { type:'deck-visual', seat: fromSeat, has: true, who:'player', url: DECK_IMG };

        (window.rtcSend || window.peer?.send)?.(payload);
        console.log('%c[RTC:send]', 'color:#6cf', payload);
      }catch(e){
        console.warn('[Zones] deck-visual send failed', e);
      }
    }
  });

  const openLoader = () => {
    if (deckZone.dataset.hasDeck === '1') return;
    DeckLoading.open('');
  };
  const drawOne = () => {
  if (deckZone.dataset.hasDeck !== '1') return;
  const ok = DeckLoading.drawOneToHand(deckZone);
  if (ok) {
    try {
      const seatNow = (typeof window.mySeat === 'function') ? Number(window.mySeat()) : 1;
      window.TurnUpkeep?.recordDraw?.(seatNow, 1);
        try { window.dispatchEvent(new CustomEvent('turn:localDraw')); } catch {}
    } catch {}
  }
};


  // Click/touch: if empty -> open loader, else -> draw
  deckZone.addEventListener('click', (e) => {
  if (e.target.closest('.deck-cluster')) return; // ignore compass taps
  (deckZone.dataset.hasDeck === '1') ? drawOne() : openLoader();
});
deckZone.addEventListener('touchstart', (e)=>{
  if (e.target.closest('.deck-cluster')) return; // ignore compass taps
  e.preventDefault();
  (deckZone.dataset.hasDeck === '1') ? drawOne() : openLoader();
}, { passive:false });

}


// ────────────────────────────────────────────────────────────
// v3-style overlays for (A) Add Any Card via Scryfall,
// and (B) Search Current Deck list. Self-contained styles.
// ────────────────────────────────────────────────────────────
function _mkPanel({ title='Overlay', width='min(900px, 96vw)', height='min(88vh, 760px)' } = {}){
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position:'fixed', inset:0, background:'rgba(0,0,0,.38)',
    display:'grid', placeItems:'center', pointerEvents:'auto', zIndex: 200001
  });
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    width, height, maxWidth:'96vw', maxHeight:'88vh',
    background:'#0b1220', color:'#e7e9ee',
    border:'1px solid rgba(255,255,255,.08)', borderRadius:'14px',
    display:'grid', gridTemplateRows:'48px 1fr', overflow:'hidden',
    boxShadow:'0 12px 34px rgba(0,0,0,.45)'
  });
  const head = document.createElement('div');
  Object.assign(head.style, {
    background:'#1a1f2b', borderBottom:'1px solid rgba(255,255,255,.08)',
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'0 10px', fontWeight:800
  });
  head.textContent = title;
  const close = document.createElement('button');
  close.textContent = '✕';
  Object.assign(close.style, { background:'transparent', border:0, color:'#e7e9ee', fontSize:'16px', padding:'6px', cursor:'pointer' });
  head.appendChild(close);

  const body = document.createElement('div');
  Object.assign(body.style, { padding:'10px', overflow:'auto' });

  panel.appendChild(head); panel.appendChild(body); wrap.appendChild(panel);

  const pop = () => { try{ wrap.remove(); }catch{} };
  const onBg = (e)=>{ if (e.target === wrap) pop(); };
  wrap.addEventListener('pointerdown', onBg);
  close.addEventListener('click', pop);

  return { wrap, panel, head, body, close, pop };
}
function _btn(label, onClick){
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.style, {
    background:'#1a2a45', color:'#cfe1ff', border:`1px solid #2b3f63`,
    borderRadius:'10px', padding:'6px 10px', fontWeight:900, cursor:'pointer'
  });
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
function _input(styleExtras={}){
  const i = document.createElement('input');
  Object.assign(i.style, {
    background:'#0a0f16', color:'#e7efff', border:'1px solid rgba(255,255,255,.08)',
    borderRadius:'10px', padding:'8px', width:'100%', ...styleExtras
  });
  return i;
}
function _escape(s){
  var map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
  return String(s || '').replace(/[&<>"']/g, function(ch){ return map[ch]; });
}

function _artFrom(c){
  if (c?.image_uris?.normal) return c.image_uris.normal;
  if (Array.isArray(c?.card_faces) && c.card_faces[0]?.image_uris?.normal) return c.card_faces[0].image_uris.normal;
  return '';
}
function _manaToHtml(str){
  const s = String(str||'').trim(); if (!s) return '';
  const hasMs = !!document.querySelector('link[href*="mana"], link[href*="mana-font"], link[href*="manamaster"]') || !!document.querySelector('.ms');
  const toks = s.match(/\{[^}]+\}/g) || [];
  if (hasMs){
    const cls = (t)=>`ms ms-${t.slice(1,-1).toLowerCase().replace(/\//g,'')}`;
    return `<span class="mm-cost">${toks.map(t=>`<i class="${cls(t)}"></i>`).join(' ')}</span>`;
  } else {
    const svg = (t)=> t.slice(1,-1).toUpperCase().replace(/\//g,'');
    return `<span class="mm-cost">${toks.map(t=>`<img alt="${t}" src="https://svgs.scryfall.io/card-symbols/${svg(t)}.svg" style="height:1em;vertical-align:-0.15em">`).join(' ')}</span>`;
  }
}

// ============ (A) Add Any Card (Scryfall) ============
function openAddAnyCardOverlay(){
  const ui = _mkPanel({ title:`Add Card / Token — P${(window.mySeat?.()||1)}` });

  // ▶ external hooks
  ui.wrap.id  = 'aac-wrap';
  ui.panel.id = 'aac-panel';
  ui.head.id  = 'aac-head';
  ui.body.id  = 'aac-body';
  ui.panel.setAttribute('data-overlay', 'add-any-card');
  ui.panel.setAttribute('data-seat', String(window.mySeat?.() || 1));

  // Row 1: query + type + rarity + legality
  const q = _input(); q.placeholder = 'Search (e.g. "Lightning Bolt", type: instant burn)';
  q.id = 'aac-q';

  const selType = document.createElement('select');
  Object.assign(selType.style, { background:'#0a0f16', color:'#e7efff', border:'1px solid rgba(255,255,255,.08)', borderRadius:'10px', padding:'8px' });
  selType.id = 'aac-type';
  ['All','Creature','Instant','Sorcery','Artifact','Enchantment','Planeswalker','Land','Battle','Token','Non-token']
    .forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=t; selType.appendChild(o); });

  const selR = document.createElement('select');
  Object.assign(selR.style, { background:'#0a0f16', color:'#e7efff', border:'1px solid rgba(255,255,255,.08)', borderRadius:'10px', padding:'8px' });
  selR.id = 'aac-rarity';
  [['','Any rarity'],['c','Common'],['u','Uncommon'],['r','Rare'],['m','Mythic']]
    .forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; selR.appendChild(o); });

  const selL = document.createElement('select');
  Object.assign(selL.style, { background:'#0a0f16', color:'#e7efff', border:'1px solid rgba(255,255,255,.08)', borderRadius:'10px', padding:'8px' });
  selL.id = 'aac-legal';
  [['','Any format'],['commander','Commander-legal'],['modern','Modern-legal'],['pioneer','Pioneer-legal'],['standard','Standard-legal']]
    .forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; selL.appendChild(o); });

  const row1 = document.createElement('div');
  Object.assign(row1.style, { display:'grid', gridTemplateColumns:'1fr auto auto auto', gap:'8px', marginBottom:'8px' });
  row1.append(q, selType, selR, selL);

  // Row 2: WUBRG chips + Exact + Use CI + MV range + Search
  const colors = ['W','U','B','R','G'];
  const colorWrap = document.createElement('div');
  Object.assign(colorWrap.style, { display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap' });
  const colorBtns = new Map();
  function styleChip(btn,on){
    btn.classList.toggle('is-on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true':'false');
    Object.assign(btn.style, {
      padding:'4px 8px', border:`1px solid ${on?'#6da7ff':'#2b3f63'}`,
      background: on ? '#213656' : '#1a2a45', color:'#cfe1ff',
      borderRadius:'10px', fontWeight:900, cursor:'pointer',
      boxShadow: on ? 'inset 0 0 0 1px rgba(173,208,255,.35), 0 0 0 2px rgba(77,139,255,.18)' : 'none',
      transform: on ? 'translateY(-1px)' : 'none'
    });
  }
  colors.forEach(C=>{
    const b=document.createElement('button'); b.type='button'; b.textContent=C; styleChip(b,false);
    b.classList.add('aac-color');
    b.dataset.color = C;
    b.addEventListener('click', ()=>{ styleChip(b, !b.classList.contains('is-on')); debounced(); });
    colorWrap.appendChild(b); colorBtns.set(C,b);
  });

  const exactLbl = document.createElement('label'); exactLbl.innerHTML = `<input type="checkbox" class="js-ci-exact"> Exact`; Object.assign(exactLbl.style,{fontSize:'12px',opacity:.9});
  const useIdLbl = document.createElement('label'); useIdLbl.innerHTML = `<input type="checkbox" class="js-ci-useid"> Use color identity`; Object.assign(useIdLbl.style,{fontSize:'12px',opacity:.9});

  // assign explicit ids to the checkbox inputs + labels
  const exactInput = exactLbl.querySelector('input');
  if (exactInput) { exactInput.id = 'aac-exact'; exactLbl.htmlFor = 'aac-exact'; }
  const useIdInput = useIdLbl.querySelector('input');
  if (useIdInput) { useIdInput.id = 'aac-useid'; useIdLbl.htmlFor = 'aac-useid'; }

  // Create: N control (min 1)
  const qtyWrap = document.createElement('div');
  Object.assign(qtyWrap.style, {
    display:'inline-flex',
    alignItems:'center',
    gap:'6px'
  });

  const btnMinus = _btn('–');
  Object.assign(btnMinus.style, { padding:'4px 10px' });

  const qtyVal = document.createElement('input');
  Object.assign(qtyVal.style, { width:'54px', textAlign:'center', fontWeight:900 });
  qtyVal.type = 'number';
  qtyVal.min = '1';
  qtyVal.step = '1';
  qtyVal.value = '1';
  qtyVal.id = 'aac-qty';

  const btnPlus = _btn('+');
  Object.assign(btnPlus.style, { padding:'4px 10px' });

  btnMinus.addEventListener('click', () => {
    const n = Math.max(1, (parseInt(qtyVal.value || '1', 10) || 1) - 1);
    qtyVal.value = String(n);
  });
  btnPlus.addEventListener('click', () => {
    const n = Math.max(1, (parseInt(qtyVal.value || '1', 10) || 1) + 1);
    qtyVal.value = String(n);
  });

  qtyWrap.append(btnMinus, qtyVal, btnPlus);

  const go = _btn('Search');
  go.id = 'aac-search';


  const row2 = document.createElement('div');
  Object.assign(row2.style, { display:'grid', gridTemplateColumns:'auto 1fr auto auto auto', gap:'8px', alignItems:'center', marginBottom:'8px' });
  row2.append(colorWrap, exactLbl, useIdLbl, qtyWrap, go);

  // NEW Row 3: Local client-side filter (comma-separated)
  const localFilter = _input();
  localFilter.id = 'aac-filter';
  localFilter.placeholder = 'Filter (comma-separated): name, type, mana (e.g. {2}{U}), abilities (flying, lifelink), types (Dragon, Wizard)…';
  const row3 = document.createElement('div');
  Object.assign(row3.style, { display:'grid', gridTemplateColumns:'1fr', gap:'8px', marginBottom:'8px' });

  row3.append(localFilter);

  ui.body.append(row1, row2, row3);

  const list = document.createElement('div');
  list.id = 'aac-grid';
  list.className = 'aac-grid';
  ui.body.appendChild(list);


  const debounced = (()=>{ let t=0; return ()=>{ clearTimeout(t); t=setTimeout(()=>doSearch(),250); }; })();

  [selType, selR, selL].forEach(el => el.addEventListener('change', ()=>doSearch()));
  q.addEventListener('keydown', (e)=>{ if (e.key==='Enter') doSearch(); });
  go.addEventListener('click', ()=>doSearch());



  // keep the latest fetched results here so handlers can re-render safely
  let _lastCards = [];
  let _abort = null;

  async function doSearch(){
    if (_abort) _abort.abort();
    _abort = new AbortController();

    const s = (q.value||'').trim(); if (!s){ q.focus(); return; }
    list.innerHTML = '<div style="opacity:.7">Searching…</div>';

    const parts = [];
    if (s) {
  parts.push(`(name:${JSON.stringify(s)} OR ${s})`);
} else {
  // no name term → full index scan
  parts.push('*');
}

    parts.push('game:paper');

    const t = selType.value;
    if (t && t !== 'All'){
      if (t==='Token') parts.push('is:token');
      else if (t==='Non-token') parts.push('-is:token');
      else parts.push(`type:${t.toLowerCase()}`);
    }
    const r  = selR.value; if (r)  parts.push(`r:${r}`);
    const lg = selL.value; if (lg) parts.push(`legal:${lg}`);

    const chosen = ['W','U','B','R','G'].filter(C => colorBtns.get(C)?.classList.contains('is-on'));
    if (chosen.length){
      const exact = !!ui.body.querySelector('.js-ci-exact')?.checked;
      const useId = !!ui.body.querySelector('.js-ci-useid')?.checked;
      const slug = chosen.join('');
      parts.push(useId ? (exact?`id=${slug}`:`id<=${slug}`) : (exact?`c=${slug}`:`c<=${slug}`));
    }

    const adv = parts.join(' ').replace(/\s+/g,' ').trim();
    // IMPORTANT: include_extras=true -> shows tokens/emblems/etc so "All" is truly all
const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(adv)}&order=relevance&unique=cards&include_extras=true&include_multilingual=false`;
console.log('[AddAny] Scryfall query:', adv, '(include_extras=true)');


    try{
      const r = await fetch(url, { signal:_abort.signal });
      if (!r.ok) throw new Error(`Scryfall ${r.status}`);
      const j = await r.json();
      _lastCards = Array.isArray(j.data) ? j.data : [];
      renderGrid(_lastCards);
    }catch(e){
      if (e?.name === 'AbortError') return;
      list.innerHTML = '<div style="opacity:.8">Search failed.</div>';
    }finally{
      _abort = null;
    }
  }

  function renderGrid(cards){
    list.innerHTML = '';
    Object.assign(list.style, { display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:'10px' });

    if (!Array.isArray(cards) || !cards.length){
      const d = document.createElement('div');
      d.textContent = 'No matches.'; d.style.opacity = '.8';
      Object.assign(d.style, { gridColumn:'1 / -1', padding:'4px 0' });
      list.appendChild(d);
      return;
    }

    const border = 'rgba(255,255,255,.08)';

    const _norm = (s)=>String(s||'').toLowerCase().normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,'').replace(/[’'`]/g,"'").replace(/\s+/g,' ').trim();

    function _extractConcreteInnate(typeLine, oracle){
      const outAbilities = [];
      const outTypes = [];
      const rawPieces = String(typeLine||'').split('—').map(s=>s.trim()).filter(Boolean);
      for (const piece of rawPieces){
        for (const w of piece.split(/\s+/)){
          const cleaned = w.replace(/[^A-Za-z]/g,'').trim();
          if (cleaned) outTypes.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
        }
      }
      const tl = String(typeLine||'').toLowerCase().trim();
      if (tl.includes('instant') || tl.includes('sorcery')){
        return { baseTypes:[...new Set(outTypes)], baseAbilities:[] };
      }
      const KEYWORDS = ['flying','first strike','double strike','vigilance','lifelink','deathtouch','trample','haste','reach','defender','hexproof','indestructible','menace','ward'];
      const lines = String(oracle||'').split(/\r?\n+/).map(s=>s.trim()).filter(Boolean);
      lineLoop: for (const line of lines){
        const lowered = line.toLowerCase();
        if (/^(as long as|whenever|when |at the beginning|if |while |other |target |create )/i.test(line)) continue lineLoop;
        if (/^protection from /i.test(line)) continue lineLoop;
        if (/^hexproof from /i.test(line))   continue lineLoop;
        if (!KEYWORDS.some(kw => lowered.startsWith(kw))) continue lineLoop;

        const head = line.split('(')[0].split('.')[0].trim();
        if (!head) continue lineLoop;
        const parts = head.split(/\s*,\s*/);
        for (let part of parts){
          const pLow = part.toLowerCase().trim();
          if (pLow.startsWith('hexproof from') || /^protection\s+from\b/i.test(part)) continue;
          if (/\bif\b|\bas long as\b|\bwhile\b/i.test(pLow)) continue;
          const matchKw = KEYWORDS.find(kw => pLow.startsWith(kw));
          if (matchKw){
            const pretty = matchKw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            outAbilities.push(pretty);
          }
        }
      }
      return { baseTypes:[...new Set(outTypes)], baseAbilities:[...new Set(outAbilities)] };
    }

    const raw = (localFilter.value || '').split(',').map(s=>s.trim()).filter(Boolean);
    const terms = raw.map(x => x.toLowerCase());

    const filtered = cards.filter(c=>{
      if (!terms.length) return true;
      const name   = String(c?.name||'');
      const typeLn = String(c?.type_line||'');
      const oracle = String(c?.oracle_text||'');
      const manaRaw = String(c?.mana_cost||'');
      const manaFlat = manaRaw.replace(/[{}]/g,' ');
      let typeLinePick = typeLn, oraclePick = oracle;
      if (Array.isArray(c?.card_faces) && c.card_faces.length){
        const want = _norm(name);
        const byName = c.card_faces.find(f => _norm(f?.name||'') === want);
        const useFace = byName || c.card_faces[0];
        typeLinePick = useFace?.type_line || typeLn;
        oraclePick   = useFace?.oracle_text || oracle;
      }
      const { baseTypes, baseAbilities } = _extractConcreteInnate(typeLinePick, oraclePick);
      const hay = [
        name.toLowerCase(),
        typeLn.toLowerCase(),
        manaFlat.toLowerCase(),
        baseTypes.join(' ').toLowerCase(),
        baseAbilities.join(' ').toLowerCase()
      ].join(' | ');
      return terms.every(t => hay.includes(t));
    });

    const toShow = filtered;

    toShow.forEach(c=>{
      const tile = document.createElement('div');
      tile.classList.add('aac-card');
      tile.dataset.cardId   = String(c?.id || '');
      tile.dataset.cardName = String(c?.name || '');
      tile.dataset.typeLine = String(c?.type_line || '');
      tile.dataset.token    = /\btoken\b/i.test(String(c?.type_line||'')) ? '1' : '0';

      Object.assign(tile.style, {
        background:'#1a1f2a', border:`1px solid ${border}`, borderRadius:'10px',
        overflow:'hidden', display:'grid', gridTemplateRows:'auto auto auto'
      });


      const thumb = document.createElement('div');
      Object.assign(thumb.style, { width:'100%', paddingTop:'140%', background:'#111', backgroundSize:'cover', backgroundPosition:'center' });
      const artUrl = _artFrom(c) || `https://via.placeholder.com/200x280/111826/9fb4d9?text=${encodeURIComponent(c?.name||'Unknown')}`;
      thumb.style.backgroundImage = `url("${artUrl}")`;
      tile.appendChild(thumb);

      let typeLinePick = String(c?.type_line||'');
      let oraclePick   = String(c?.oracle_text||'');
      if (Array.isArray(c?.card_faces) && c.card_faces.length){
        const want = _norm(String(c?.name||''));
        const byName = c.card_faces.find(f => _norm(f?.name||'') === want);
        const useFace = byName || c.card_faces[0];
        typeLinePick = useFace?.type_line || typeLinePick;
        oraclePick   = useFace?.oracle_text || oraclePick;
      }
      const { baseTypes, baseAbilities } = _extractConcreteInnate(typeLinePick, oraclePick);

      const meta = document.createElement('div');
      meta.innerHTML = `
        <div style="font-weight:800">${_escape(c?.name||'')}</div>
        <div style="opacity:.85; font-size:12px">${_escape(c?.type_line||'')}</div>
        <div style="opacity:.85; font-size:12px">${_manaToHtml(c?.mana_cost||'')}</div>
        <div style="opacity:.92; font-size:12px; margin-top:4px"><span style="opacity:.7">Types:</span> ${_escape(baseTypes.join(', ')||'—')}</div>
        <div style="opacity:.92; font-size:12px;"><span style="opacity:.7">Abilities:</span> ${_escape(baseAbilities.join(', ')||'—')}</div>`;
      Object.assign(meta.style, { padding:'8px', fontSize:'12px', borderTop:`1px solid ${border}` });
      tile.appendChild(meta);

      const actions = document.createElement('div');
      Object.assign(actions.style, { display:'flex', gap:'6px', padding:'8px', borderTop:`1px solid ${border}`, background:'#0b1220', flexWrap:'wrap' });
      tile.appendChild(actions);

      const payload = {
        id:c.id, name:c.name, type_line:c.type_line, mana_cost:c.mana_cost,
        oracle_text:c.oracle_text, img:_artFrom(c)
      };

      // Drop-in replacement that fetches Scryfall meta, selects the correct face, derives baseTypes/baseAbilities, and spawns/sends.
      const send = (() => {
        const norm = (s) => String(s||'').toLowerCase().normalize('NFKD')
          .replace(/[\u0300-\u036f]/g,'').replace(/[’'`]/g,"'").replace(/\s+/g,' ').trim();

        function extractConcreteInnate(faceMeta){
          // mirror of _extractConcreteInnate but on per-face blobs
          return _extractConcreteInnate(faceMeta?.typeLine||'', faceMeta?.oracle||'');
        }

        function buildMetaFromScryfall(j, targetName){
          const faces = Array.isArray(j.card_faces) ? j.card_faces : null;
          const f0 = faces ? faces[0] : j;
          const f1 = faces && faces[1] ? faces[1] : null;

          const want = norm(targetName);
          let pick = f0;
          if (faces){
            const match = faces.find(f => norm(f.name||'') === want);
            if (match) pick = match;
          }

          const front = {
            typeLine: f0?.type_line   || j.type_line   || '',
            oracle:   f0?.oracle_text || j.oracle_text || '',
            img:      f0?.image_uris?.normal || j.image_uris?.normal || ''
          };
          const back  = {
            typeLine: f1?.type_line || '',
            oracle:   f1?.oracle_text || '',
            img:      f1?.image_uris?.normal || ''
          };

          const oLow = ` ${String(front.oracle||'').toLowerCase()} `;
          const untapsDuringUntapStep = !(
            oLow.includes(" doesn't untap during your untap step") ||
            oLow.includes(" does not untap during your untap step") ||
            oLow.includes(" doesn't untap during its controller's untap step") ||
            oLow.includes(" does not untap during its controller's untap step")
          );

          const parsedFront = extractConcreteInnate({ typeLine: front.typeLine, oracle: front.oracle });
          const parsedBack  = extractConcreteInnate({ typeLine: back.typeLine,  oracle: back.oracle  });

          const currentFace = {
            typeLine: pick?.type_line || front.typeLine || '',
            oracle:   pick?.oracle_text || front.oracle || '',
            img:      pick?.image_uris?.normal || front.img || '',
            ...extractConcreteInnate({ typeLine: pick?.type_line || front.typeLine || '', oracle: pick?.oracle_text || front.oracle || '' })
          };

          return {
            typeLine: currentFace.typeLine,
            oracle:   currentFace.oracle,
            baseTypes: currentFace.baseTypes || [],
            baseAbilities: currentFace.baseAbilities || [],
            currentFaceImg: currentFace.img,
            frontTypeLine: front.typeLine,
            backTypeLine:  back.typeLine,
            frontOracle:   front.oracle,
            backOracle:    back.oracle,
            imgFront:      front.img,
            imgBack:       back.img,
            frontBaseTypes:      parsedFront.baseTypes,
            frontBaseAbilities:  parsedFront.baseAbilities,
            backBaseTypes:       parsedBack.baseTypes,
            backBaseAbilities:   parsedBack.baseAbilities,
            untapsDuringUntapStep: !!untapsDuringUntapStep,
            currentSide: 'front'
          };
        }

        // helper: fetch meta, prefer exact card ID when present, else fall back to name
async function fetchMeta(payload){
  try{
    if (payload?.id) {
      const r = await fetch(`https://api.scryfall.com/cards/${payload.id}`, { cache:'no-store' });
      if (!r.ok) throw new Error('scryfall id fetch error');
      return await r.json();
    }
    const name = payload?.name || '';
    if (!name) return null;
    const r = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`, { cache:'no-store' });
    if (!r.ok) throw new Error('scryfall name fetch error');
    return await r.json();
  }catch(e){
    console.warn('[send] scryfall fetch failed', payload, e);
    return null;
  }
}

return async function send(dest){
  const seatNow   = (window.mySeat?.() || 1);
  const mySeatNow = (window.mySeat?.() || 1);
  const ownerKey  = (Number(seatNow) === Number(mySeatNow)) ? 'player' : 'opponent';

  const nameWanted = payload?.name || '';
  const imgHint    = payload?.img  || '';

  // NEW: fetch meta using payload.id if we have it
  const j = await fetchMeta(payload);
  const meta = j ? buildMetaFromScryfall(j, nameWanted) : null;

  // NEW: never override the user-picked image; only fall back to meta image
  const imgNow = imgHint || (meta?.currentFaceImg || '');



          if (dest === 'table'){
            try {
              CardPlacement.spawnCardLocal({ name: nameWanted, img: imgNow, meta: meta || null });
            } catch(e) { console.warn('[send→table] spawn failed', e); }
            return;
          }
          if (dest === 'hand'){
            try { window.flyDrawToHand?.({ name: nameWanted, imageUrl: imgNow }, null); }
            catch(e){ console.warn('[send→hand] flyDrawToHand failed', e); }
            return;
          }
          if (dest === 'graveyard' || dest === 'exile'){
            try{
              const zs = window.Zones;
              if (zs?.state?.[ownerKey]?.[dest]) {
                const snap = {
                  cid:       payload?.cid || ('snap_' + Math.random().toString(36).slice(2,10)),
                  name:      nameWanted || '',
                  img:       imgNow || '',
                  typeLine:  meta?.typeLine || payload?.typeLine || '',
                  ownerSeat: seatNow
                };
                zs.state[ownerKey][dest].unshift(snap);
              } else {
                console.warn('[send] Zones/state path missing for', ownerKey, dest);
              }
            } catch(e){
              console.warn('[send→zone] snapshot insert failed', e);
            }
            return;
          }
        };
      })();

      // buttons — MUST live inside the same forEach scope as `actions` and `send`
      const addBtn=(label,dest)=>{
        const b=_btn(label,(e)=>{
          e.stopPropagation();
          const n = Math.max(1, parseInt(qtyVal.value||'1',10) || 1);
          for (let i=0; i<n; i++) send(dest);
        });
        b.classList.add('aac-action');
        b.dataset.action = 'spawn';
        b.dataset.dest   = dest; // 'table' | 'hand' | 'graveyard' | 'exile'
        Object.assign(b.style,{padding:'6px 8px'});
        actions.appendChild(b);
      };

      addBtn('Table','table');
      addBtn('Hand','hand');
      addBtn('Graveyard','graveyard');
      addBtn('Exile','exile');

      list.appendChild(tile);
    });
  }

    // re-render the current grid when localFilter changes — use the cached _lastCards
  localFilter.addEventListener('input', ()=>{
    renderGrid(_lastCards);
  });

  document.body.appendChild(ui.wrap);

}

// ============ (A.2) Rules Overlay Open Helper ============
async function openRulesOverlay(){
  const ui = _mkPanel({ title: 'Rules', width: 'min(1100px, 96vw)', height: 'min(90vh, 820px)' });
  document.body.appendChild(ui.wrap);
  try {
    const mod = await import('./stats.rules.overlay.js');
    // Mount the two-tab Rules builder into the overlay body
    mod.StatsRulesOverlay?.mount?.(ui.body);
  } catch (e) {
    console.warn('[RulesOverlay] failed to load', e);
    try { ui?.pop?.(); } catch {}
  }
}

// ============ (A.3) Turn Stats Overlay Open Helper ============
async function openStatsOverlay(){
  const ui = _mkPanel({
    title: 'Turn Stats & Snapshot',
    width:  'min(1100px, 96vw)',
    height: 'min(90vh, 820px)'
  });

  document.body.appendChild(ui.wrap);

  try {
    const mod = await import('./turn.stats.overlay.js');
    // Mount the stats viewer into the overlay body
    mod.TurnStatsOverlay?.mount?.(ui.body);
  } catch (e) {
    console.warn('[StatsOverlay] failed to load', e);
    try { ui?.pop?.(); } catch {}
  }
}


// ============ (B) Search Current Deck (magnifying glass) ============
function openDeckSearchOverlay(){
  // —— helper: get a *live* view of the library, not the initial snapshot
function _liveDeckItems(){
  try {
    // Prefer the actual live source your app uses (DeckAccess), then fall back.
    const raw =
      (window.DeckAccess && typeof window.DeckAccess.enumerate === 'function' && window.DeckAccess.enumerate({ mode: 'full' })) ||
      (DeckLoading && typeof DeckLoading.enumerate === 'function' && DeckLoading.enumerate()) ||
      (DeckLoading?.state?.library) ||
      _currentDeckList ||
      [];

    // Normalize each row so downstream filters always see the same keys.
    return (Array.isArray(raw) ? raw : []).map(c => ({
      // keep original object around but ensure common keys exist
      ...c,
      name:     c?.name || '',
      img:      c?.img || c?.image || c?.imageUrl || '',
      typeLine: c?.typeLine || c?.type_line || '',
      // normalize meta arrays for type filtering
      baseTypes:       Array.isArray(c?.baseTypes) ? c.baseTypes : [],
      frontBaseTypes:  Array.isArray(c?.frontBaseTypes) ? c.frontBaseTypes : [],
      backBaseTypes:   Array.isArray(c?.backBaseTypes) ? c.backBaseTypes : []
    }));
  } catch (e) {
    console.warn('[DeckSearch] _liveDeckItems() failed, using snapshot', e);
    return Array.isArray(_currentDeckList) ? _currentDeckList : [];
  }
}

  // —— helper: remove ONE copy by name from the live library
  function _decrementFromLibraryByName(name){
    try {
      const st = DeckLoading?.state;
      const lib = st?.library;
      if (Array.isArray(lib)) {
        const idx = lib.findIndex(c => (c?.name||'').toLowerCase() === String(name||'').toLowerCase());
        if (idx >= 0) lib.splice(idx, 1);
      }
      // notify listeners an inventory change happened
      window.dispatchEvent(new CustomEvent('deckloading:changed'));
    } catch {}
  }

  // —— ensure DeckLoading draw emits a change event (non-destructive monkey-patch)
  try {
    if (!DeckLoading.__patchedEmit) {
      const _drawOneToHand = DeckLoading.drawOneToHand?.bind(DeckLoading);
      const _drawOne       = DeckLoading.drawOne?.bind(DeckLoading);
      if (_drawOneToHand) {
        DeckLoading.drawOneToHand = (...args) => {
          const r = _drawOneToHand(...args);
          try { window.dispatchEvent(new CustomEvent('deckloading:changed')); } catch {}
          return r;
        };
      }
      if (_drawOne) {
        DeckLoading.drawOne = (...args) => {
          const r = _drawOne(...args);
          try { window.dispatchEvent(new CustomEvent('deckloading:changed')); } catch {}
          return r;
        };
      }
      DeckLoading.__patchedEmit = true;
    }
  } catch {}

  const ui = _mkPanel({ title:`Deck — P${(window.mySeat?.()||1)}` });

  // Intercept *this* overlay’s close to ask about shuffling first — styled popup
  try {
    const __origRemove = ui.wrap.remove.bind(ui.wrap);

    // Styled modal (matches your deck-insert modal aesthetic) → returns Promise<boolean>
    function showShufflePopup(){
      return new Promise((resolve) => {
        // guard: only one at a time
        if (document.getElementById('deckInsertBackdrop')) {
          resolve(false);
          return;
        }

        // backdrop
        const backdrop = document.createElement('div');
backdrop.id = 'deckInsertBackdrop';
Object.assign(backdrop.style, {
  position: 'fixed',
  inset: '0',
  background: 'rgba(2, 6, 23, 0.55)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  zIndex: '2147482999'  // raised above all table UI
});


        // modal shell
        const modal = document.createElement('div');
modal.id = 'deckInsertModal';
Object.assign(modal.style, {
  position: 'fixed',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%,-50%)',
  width: 'min(420px, 92vw)',
  borderRadius: '16px',
  background: 'linear-gradient(180deg, rgba(30,41,59,.95), rgba(15,23,42,.95))',
  boxShadow: '0 20px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(148,163,184,.15)',
  color: '#e2e8f0',
  zIndex: '2147483000',  // raised above everything (above backdrop)
  padding: '18px'
});

// header & hint (remove Esc)
const header = document.createElement('div');
header.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;">
    <h3 style="margin:0;font-size:16px;font-weight:700;letter-spacing:.2px;">Shuffle the deck now?</h3>
    <span style="opacity:.75;font-size:12px;">Y / N</span>
  </div>
  <p style="margin:0 0 12px;font-size:13px;line-height:1.35;color:#cbd5e1;opacity:.9">
    Shuffling randomizes the current library order.
  </p>
`;


        // options grid
        const grid = document.createElement('div');
        Object.assign(grid.style, {
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '10px'
        });

        const mkBtn = (label, sub, key, variant = 'primary') => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'deckInsertBtn';
          btn.dataset.choice = label;
          Object.assign(btn.style, {
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 14px',
            borderRadius: '12px',
            border: '1px solid rgba(148,163,184,.18)',
            background: variant === 'ghost'
              ? 'rgba(15,23,42,.6)'
              : 'linear-gradient(180deg, rgba(51,65,85,.9), rgba(30,41,59,.9))',
            color: '#e5e7eb',
            fontWeight: 700,
            fontSize: '14px',
            cursor: 'pointer',
            transition: 'transform .06s ease, background .12s ease, border-color .12s ease'
          });
          btn.onmouseenter = () => {
            btn.style.transform = 'translateY(-1px)';
            btn.style.borderColor = 'rgba(148,163,184,.35)';
          };
          btn.onmouseleave = () => {
            btn.style.transform = 'none';
            btn.style.borderColor = 'rgba(148,163,184,.18)';
          };
          btn.onmousedown = () => (btn.style.transform = 'translateY(0)');
          btn.onmouseup = () => (btn.style.transform = 'translateY(-1px)');

          btn.innerHTML = `
            <span style="display:flex;align-items:center;gap:10px">
              <span>${label === 'Yes' ? '🔀' : label === 'No' ? '✖️' : '✖️'}</span>
              <span>${label}</span>
              <span style="opacity:.75;font-size:12px;font-weight:600">${sub || ''}</span>
            </span>
            ${key ? `<kbd style="
              font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
              font-size:12px;padding:2px 6px;border-radius:6px;
              background: rgba(2,6,23,.6); border:1px solid rgba(148,163,184,.25);
              color:#cbd5e1; letter-spacing:.3px;">${key}</kbd>` : ''}
          `;
          return btn;
        };

        const btnYes   = mkBtn('Yes', 'Shuffle library now', 'Y');
const btnNo    = mkBtn('No',  'Leave order as is',   'N', 'ghost');

[btnYes, btnNo].forEach(b => grid.appendChild(b));


        modal.appendChild(header);
        modal.appendChild(grid);

        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        // close helpers
const teardown = (val=false) => {
  try { modal.remove(); } catch {}
  try { backdrop.remove(); } catch {}
  resolve(val);
};

// actions (only Yes/No)
const act = (choice) => {
  if (choice === 'Yes') { teardown(true);  return; }
  if (choice === 'No')  { teardown(false); return; }
};

// backdrop click = No
backdrop.addEventListener('click', () => act('No'));
btnYes.addEventListener('click',    () => act('Yes'));
btnNo.addEventListener('click',     () => act('No'));


        // keyboard shortcuts (Y / N only)
const onKey = (e) => {
  if (!document.body.contains(modal)) {
    window.removeEventListener('keydown', onKey);
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'y') { e.preventDefault(); act('Yes'); return; }
  if (k === 'n') { e.preventDefault(); act('No');  return; }
};
window.addEventListener('keydown', onKey, { passive: true });

      });
    }

    ui.wrap.remove = async function(){
      try {
        const yes = await showShufflePopup();
        if (yes && window.DeckLoading && typeof DeckLoading.shuffleLibrary === 'function') {
          DeckLoading.shuffleLibrary();
        }
      } catch {}
      return __origRemove();
    };
  } catch {}


  const q = _input(); q.placeholder = 'Search name…';
  const sel = document.createElement('select');
  Object.assign(sel.style, { background:'#0a0f16', color:'#e7efff', border:'1px solid rgba(255,255,255,0.8)', borderRadius:'10px', padding:'8px' });
  (Array.isArray(TYPE_FILTERS) ? TYPE_FILTERS : ['All'])
    .forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });

  const top = document.createElement('div');
  Object.assign(top.style, { display:'grid', gridTemplateColumns:'1fr auto', gap:'8px', marginBottom:'8px' });
  top.append(q, sel);
  ui.body.appendChild(top);

  const list = document.createElement('div'); ui.body.appendChild(list);



   // ...
  function _escape(s){
    var map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
    return String(s || '').replace(/[&<>"']/g, ch => map[ch]);
  }

  // Local extraction similar to Add Any Card overlay: derive core type tokens
  function _extractConcreteInnateDeck(typeLine){
    const out = [];
    const raw = String(typeLine||'').split('—')[0] || ''; // only the left side matters for super/primary types
    raw.split(/\s+/).forEach(w=>{
      const cleaned = w.replace(/[^A-Za-z]/g,'').trim();
      if (!cleaned) return;
      const cap = cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
      out.push(cap);
    });
    // normalize uniqueness & keep common tokens as-is (Creature, Instant, Legendary, Aura, Vehicle, Token, etc.)
    return [...new Set(out)];
  }

  // precise type matcher: compute types from local typeLine and match canonical tokens
  function _matchesType(card, want){
    const W = String(want||'All').toLowerCase();
    if (W === 'all') return true;

    // prefer explicit meta if present, otherwise derive from type line
    const metaTypes = []
      .concat(card?.baseTypes || [])
      .concat(card?.frontBaseTypes || [])
      .concat(card?.backBaseTypes || [])
      .map(s => String(s).toLowerCase());

    if (metaTypes.includes(W)) return true;

    // derive from whichever typeLine keys we have on deck items
    const tlCombined = String(
      (card?.type_line || card?.typeLine || card?.frontTypeLine || '') +
      ' ' +
      (card?.backTypeLine || '')
    );

    const derived = _extractConcreteInnateDeck(tlCombined).map(s=>s.toLowerCase());

    // Special case: Token filter should match explicit token cards in the deck list as well.
    if (W === 'token') {
      const isToken = /\btoken\b/i.test(tlCombined);
      if (isToken) return true;
    }

    return derived.includes(W)
        || tlCombined.toLowerCase().includes(W); // final safety net for rare strings like "Planeswalker" / "Battle"
  }

  function render(){
    list.innerHTML = '';

    // always pull the latest library contents
    const live = _liveDeckItems();

    const query = (q.value||'').toLowerCase();
    const want  = sel.value;

    const items = live.filter(c=>{
      const n = (c?.name||'').toLowerCase();
      const okN = !query || n.includes(query);
      const okT = _matchesType(c, want);
      return okN && okT;
    });
  // ...



    if (!items.length){
      const d = document.createElement('div'); d.textContent = 'No matches.'; d.style.opacity = '.8';
      list.appendChild(d); return;
    }

    Object.assign(list.style, { display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:'10px' });

    items.forEach(c=>{
      const tile = document.createElement('div');
      Object.assign(tile.style, {
        background:'#1a1f2a', border:'1px solid rgba(255,255,255,.08)', borderRadius:'10px',
        overflow:'hidden', display:'grid', gridTemplateRows:'auto auto auto'
      });

      const thumb = document.createElement('div');
      Object.assign(thumb.style, { width:'100%', paddingTop:'140%', background:'#111', backgroundSize:'cover', backgroundPosition:'center' });
      const img = c?.img || c?.image || c?.imageUrl || '';
      thumb.style.backgroundImage = `url("${img || `https://via.placeholder.com/200x280/111826/9fb4d9?text=${encodeURIComponent(c?.name||'')}`}")`;
      tile.appendChild(thumb);

      const meta = document.createElement('div');
      meta.innerHTML = `
        <div style="font-weight:800">${_escape(c?.name||'')}</div>
        <div style="opacity:.85; font-size:12px">${_escape(c?.type_line||c?.typeLine||'')}</div>`;
      Object.assign(meta.style, { padding:'8px', fontSize:'12px', borderTop:'1px solid rgba(255,255,255,.08)' });
      tile.appendChild(meta);

      const actions = document.createElement('div');
      Object.assign(actions.style, { display:'flex', gap:'6px', padding:'8px', borderTop:'1px solid rgba(255,255,255,.08)', background:'#0b1220', flexWrap:'wrap' });

      const payload = { name:c.name, img: img };

      const addBtn=(label,fn)=>{
        const b=_btn(label,(e)=>{ e.stopPropagation(); fn(); });
        Object.assign(b.style,{padding:'6px 8px'});
        actions.appendChild(b);
      };

      // each action also decrements ONE copy from the live library and re-renders
      addBtn('Table', ()=>{
        try{ CardPlacement.spawnCardLocal({ name: payload.name, img: payload.img }); }catch{}
			_decrementFromLibraryByName(payload.name);
			  try {
				window.TurnUpkeep?.recordTutor?.((window.mySeat?.() || 1), 1);
			  } catch {}
        render();
      });
      addBtn('Hand',  ()=>{
        try{ window.flyDrawToHand?.({ name: payload.name, imageUrl: payload.img }, null); }catch{}
        _decrementFromLibraryByName(payload.name);
		  try {
			window.TurnUpkeep?.recordTutor?.((window.mySeat?.() || 1), 1);
		  } catch {}
        render();
      });
      addBtn('Graveyard', ()=>{
        try{ window.moveCardToZone?.(payload,'graveyard',(window.mySeat?.()||1)); }catch{}
        _decrementFromLibraryByName(payload.name);
		  try {
			window.TurnUpkeep?.recordTutor?.((window.mySeat?.() || 1), 1);
		  } catch {}
        render();
      });
      addBtn('Exile', ()=>{
        try{ window.moveCardToZone?.(payload,'exile',(window.mySeat?.()||1)); }catch{}
        _decrementFromLibraryByName(payload.name);
		  try {
			window.TurnUpkeep?.recordTutor?.((window.mySeat?.() || 1), 1);
		  } catch {}
        render();
      });

      tile.appendChild(actions);
      list.appendChild(tile);
    });
  }

  // re-render on input changes
  q.addEventListener('input', render);
  sel.addEventListener('change', render);

  // re-render whenever the deck changes elsewhere (draw button, etc.)
  const _onDeckChanged = () => render();
  window.addEventListener('deckloading:changed', _onDeckChanged);

  // first render + attach; clean up when panel closes
  render();
  document.body.appendChild(ui.wrap);

  // when the panel is closed (click ✕ or backdrop), detach listener
  const _origPop = ui.pop;
  ui.pop = () => {
    try { window.removeEventListener('deckloading:changed', _onDeckChanged); } catch {}
    _origPop();
  };
}



  // --- Mount ---
  function mount(worldEl) {
    if (!worldEl) {
      worldEl = document.getElementById('world');
      if (!worldEl) {
        const vp = document.getElementById('viewport');
        if (!vp) throw new Error('[Zones] mount requires #viewport');
        worldEl = el('div', { id: 'world' });
        vp.appendChild(worldEl);
      }
    }
    while (worldEl.firstChild) worldEl.removeChild(worldEl.firstChild);

    buildCombatAndGuides(worldEl);
    worldEl.appendChild(buildOpponentField());
    worldEl.appendChild(buildPlayerField());

    // Inline CSS (deck bg + commander label)
    if (!document.getElementById('zones-inline-style')) {
  const s = el('style', { id: 'zones-inline-style' }, `
        /* Ensure zones can anchor absolutely-positioned children */
        .zone{ position:relative; }

        /* Centered label overlay for ALL zones */
        .zone > .label{
  position:absolute;
  left:50%;
  top:50%;
  transform:translate(-50%,-50%);   /* hard-center */
  width:100%;                       /* ensure text can center */
  display:block;                    /* simple block works with text-align */
  font-size:12px;
  font-weight:700;
  text-align:center;
  color:rgba(255,255,255,.88);
  text-shadow:0 1px 2px rgba(0,0,0,.55);
  pointer-events:none;
  z-index:1;
}


        /* Commander name badge stays above the generic label */
        .zone .commander-name{
          position:absolute;
          inset:6px;
          display:grid;
          place-items:center;
          font-size:12px;
          text-align:center;
          color:rgba(255,255,255,.92);
          pointer-events:none;
          z-index:2;
        }

        /* Deck with image background keeps its cover fit */
        .zone.deck.has-deck{ background-size:cover; background-position:center; }
		
		/* --------------------------------------------------------
           HAND HIT-TESTING: let empty hand space be click-through
           --------------------------------------------------------
           Strategy: the hand container ignores pointer events,
           but actual hand cards still receive pointer events.
           Add/keep whichever selector your project uses.
        */
        /* Common hand containers (use what matches in your codebase) */
        .hand,
        #hand,
        .hand-zone,
        [data-zone="hand"] {
          pointer-events: none;           /* empty space passes through */
        }
        /* Actual card elements inside the hand stay interactive */
        .hand .hand-card,
        #hand .hand-card,
        .hand-zone .hand-card,
        [data-zone="hand"] .hand-card,
        .hand .card,
        #hand .card,
        .hand-zone .card,
        [data-zone="hand"] .card,
        .hand img.card,
        #hand img.card,
        .hand img.hand-card,
        #hand img.hand-card,
        .hand [data-role="hand-card"],
        #hand [data-role="hand-card"],
        [data-zone="hand"] [data-role="hand-card"] {
          pointer-events: auto;           /* cards still catch mouse/touch */
          touch-action: none;             /* preserves drag behavior */
      `);
  document.head.appendChild(s);
}


    bindDeckUI();
    initPhasedZone(worldEl); // ← add this line
    return worldEl;

  }
  
  // --- Phased / Holding table zone (world-positioned like other zones) ---
function initPhasedZone(worldEl){
  try {
    const deckEl = document.getElementById('pl-deck');
    const cmdEl  = document.getElementById('pl-commander');
    if (!deckEl) {
      console.warn('[PhasedZone] Could not locate Deck zone; skipping init.');
      return;
    }

    // compute world coords from screen (same bridge placement uses)
    function screenToWorldXY(sx, sy){
      if (typeof window._screenToWorld === 'function') return window._screenToWorld(sx, sy);
      // fallback: approximate with offsets (keeps the box on screen even if not perfect)
      const worldRect = worldEl.getBoundingClientRect();
      return { wx: sx - worldRect.left, wy: sy - worldRect.top };
    }

    const dRect = deckEl.getBoundingClientRect();
    const dTopLeft = screenToWorldXY(dRect.left, dRect.top);

    let cmdRightWX = null;
    if (cmdEl) {
      const cRect = cmdEl.getBoundingClientRect();
      const cTopLeft = screenToWorldXY(cRect.left, cRect.top);
      cmdRightWX = cTopLeft.wx + cRect.width;
    }

    // geometry: just below the deck; stretch toward commander’s right edge if known
    const GAP_Y = 24;
    const DEF_W = 520;
    const DEF_H = 300;

    const phasedLeft = dTopLeft.wx;
    const phasedTop  = dTopLeft.wy + dRect.height + GAP_Y;
    const phasedW    = (cmdRightWX != null) ? Math.max(240, cmdRightWX - phasedLeft - 16) : DEF_W;
    const phasedH    = DEF_H;

    // create or update the zone element under the world
    let zone = worldEl.querySelector('#pl-phased');
    if (!zone) {
      zone = document.createElement('div');
      zone.id = 'pl-phased';
      zone.className = 'zone zone-phased';
      zone.dataset.zone = 'phased';
      zone.title = 'Phased / Holding';
      worldEl.appendChild(zone);

      // label like other zones
const lab = document.createElement('div');
lab.className = 'label';
lab.textContent = 'Phased / Holding';
Object.assign(lab.style, {
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%,-50%)',
  width: '100%',
  display: 'block',
  textAlign: 'center',
  fontSize: '12px',
  fontWeight: '700',
  color: 'rgba(255,255,255,.88)',
  textShadow: '0 1px 2px rgba(0,0,0,.55)',
  pointerEvents: 'none',
  zIndex: '1'
});
zone.appendChild(lab);

    }

    // world positioning (absolute like other table zones)
    Object.assign(zone.style, {
      position: 'absolute',
      left: `${phasedLeft}px`,
      top: `${phasedTop}px`,
      width: `${phasedW}px`,
      height: `${phasedH}px`,
      borderRadius: '14px',
      border: '2px dashed rgba(135,206,250,.65)',
      background: 'linear-gradient(180deg, rgba(30,60,90,.18) 0%, rgba(30,60,90,.10) 100%)',
      boxShadow: 'inset 0 0 24px rgba(0,180,255,.18)',
      pointerEvents: 'auto',
      zIndex: '2147481200'
    });

    console.log('[PhasedZone] ready at', { left: phasedLeft, top: phasedTop, width: phasedW, height: phasedH });
  } catch (err) {
    console.warn('[PhasedZone] init failed', err);
  }
}


  // expose public API
  return {
    mount,
    state,
    recordCardToZone,
    openZoneBrowser,
    openDeckSearchOverlay,
	openAddAnyCardOverlay,
    openRulesOverlay,            // ⬅️ NEW (optional export)
    setCommanderName,
    markDeckPresent,
    sendDeckVisual,
    exportOwnerZone,
    importOwnerZone,     // ← loader expects this
    resetOwnerZones,     // ← loader expects this
    moveCardToZone,       // ← deck search overlay calls window.moveCardToZone()
    //removeCardFromTableByCid  // ← used by Return Multiple flow to mirror single-card behavior

  };
})();


// put Zones on window for CardPlacement.removeCard to reach it
window.Zones = Zones;
window.moveCardToZone = Zones.moveCardToZone; // allow global calls from overlays
//window.Zones.openAddAnyCardOverlay();

//window.Zones.openAddAnyCardOverlay();
window.__modTime(__MOD, 'end');
