// modules/turn.stats.overlay.js
// UI overlay to inspect TurnUpkeep tallies + DOM snapshot
// Usage:
//   import { TurnStatsOverlay } from './turn.stats.overlay.js';
//   TurnStatsOverlay.mount(containerEl);
//
// The overlay is opened from zones.js via openStatsOverlay().

import { manaCostHtml } from './mana.master.js';

const STYLE_ID = 'turn-stats-overlay-style-v1';


function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
#turn-stats-root{
  display:grid;
  grid-template-rows:auto 1fr;
  gap:10px;
  height:100%;
  font-family:system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size:13px;
  color:#e5edff;
}

.ts-header{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  padding:6px 10px;
  border-radius:8px;
  background:linear-gradient(135deg,rgba(59,130,246,0.20),rgba(15,23,42,0.95));
  border:1px solid rgba(148,163,184,0.5);
}

.ts-header-main{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  align-items:baseline;
}

.ts-header-main strong{
  font-size:14px;
}

.ts-pill{
  padding:2px 8px;
  border-radius:999px;
  background:rgba(15,23,42,0.9);
  border:1px solid rgba(148,163,184,0.4);
  font-size:11px;
}

.ts-header-actions{
  display:flex;
  gap:6px;
}

.ts-btn{
  border-radius:999px;
  border:1px solid rgba(148,163,184,0.6);
  background:radial-gradient(circle at 0% 0%,rgba(96,165,250,0.35),rgba(15,23,42,0.9));
  color:#e5edff;
  font-size:11px;
  font-weight:600;
  padding:4px 10px;
  cursor:pointer;
}
.ts-btn:hover{
  border-color:rgba(191,219,254,0.9);
}

.ts-layout{
  display:grid;
  grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);
  gap:10px;
  height:100%;
  min-height:0;
}

@media (max-width: 900px){
  .ts-layout{
    grid-template-columns: minmax(0,1fr);
  }
}

.ts-section{
  background:radial-gradient(circle at 0% 0%,rgba(56,189,248,0.18),rgba(15,23,42,0.96));
  border-radius:10px;
  border:1px solid rgba(55,65,81,0.9);
  padding:10px;
  display:flex;
  flex-direction:column;
  min-height:0;
}

.ts-section h3{
  margin:0 0 6px 0;
  font-size:13px;
  letter-spacing:0.03em;
  text-transform:uppercase;
  color:rgba(148,163,184,0.95);
}

.ts-subtitle{
  margin-bottom:6px;
  font-size:11px;
  color:rgba(148,163,184,0.95);
}

.ts-section-body{
  flex:1 1 auto;
  min-height:0;
  overflow:auto;
  padding-right:4px;
}

.ts-seat-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:8px;
}
@media (max-width:800px){
  .ts-seat-grid{
    grid-template-columns:minmax(0,1fr);
  }
}

.ts-seat-card{
  border-radius:8px;
  border:1px solid rgba(55,65,81,0.9);
  background:linear-gradient(180deg,rgba(15,23,42,0.9),rgba(15,23,42,0.98));
  padding:8px;
  display:flex;
  flex-direction:column;
  gap:4px;
}

.ts-seat-title{
  display:flex;
  justify-content:space-between;
  align-items:baseline;
  font-size:12px;
  font-weight:600;
}

.ts-stat-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:2px 10px;
  font-size:11px;
}

.ts-stat-label{
  opacity:0.75;
}

.ts-stat-value{
  text-align:right;
  font-variant-numeric:tabular-nums;
}

.ts-pill-row{
  display:flex;
  flex-wrap:wrap;
  gap:4px;
  margin-top:4px;
}

.ts-small-pill{
  border-radius:999px;
  border:1px solid rgba(75,85,99,0.9);
  background:rgba(15,23,42,0.95);
  font-size:10px;
  padding:2px 6px;
}

.ts-section-divider{
  margin:8px 0 4px;
  border-top:1px solid rgba(51,65,85,0.9);
}

.ts-key-value-list{
  display:grid;
  grid-template-columns:minmax(0,1.2fr) minmax(0,0.8fr);
  gap:2px 12px;
  font-size:11px;
}
.ts-key-value-key{
  opacity:0.8;
}
.ts-key-value-val{
  text-align:right;
  font-variant-numeric:tabular-nums;
}

.ts-note{
  margin-top:4px;
  font-size:10px;
  color:rgba(148,163,184,0.9);
}

.ts-pill.green{
  border-color:rgba(22,163,74,0.9);
  background:rgba(22,163,74,0.15);
}
.ts-pill.red{
  border-color:rgba(239,68,68,0.9);
  background:rgba(239,68,68,0.15);
}

.ts-details{
  margin-top:6px;
}

.ts-details summary{
  cursor:pointer;
  font-size:11px;
  color:rgba(191,219,254,0.95);
}

.ts-details pre{
  margin-top:4px;
  font-size:10px;
  background:rgba(15,23,42,0.9);
  border-radius:6px;
  padding:6px;
  max-height:190px;
  overflow:auto;
  border:1px solid rgba(30,64,175,0.7);
}
`;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = css;
  document.head.appendChild(s);
}


 
// 🔵 CURRENT STATE HELPERS
function getCurrentZonesSnapshot(tallies) {
  // Hand counts (P1 / P2) from DOM
  let handP1 = 0, handP2 = 0;
  try {
    const handEls = document.querySelectorAll(
      'img.hand-card[data-cid], img[data-zone="hand"][data-cid]'
    );
    handEls.forEach(el => {
      const owner = (el.dataset.ownerCurrent ?? el.dataset.owner ?? '')
        .toString()
        .match(/\d+/)?.[0] || '1';
      if (owner === '2') handP2++;
      else handP1++;
    });
  } catch {}

  // Library counts:
  //  - Prefer direct DeckLoading for *our* seat.
  //  - Fill missing values from TurnUpkeep tallies (startLibrary + netLibrary).
  let libP1 = null, libP2 = null;

  // Direct local library size for our own seat
  try {
    const DL = window.DeckLoading;
    const lib = DL?.state?.library;
    if (Array.isArray(lib)) {
      const mySeat =
        typeof window.mySeat === 'function'
          ? (Number(window.mySeat()) || 1)
          : 1;
      if (mySeat === 1) libP1 = lib.length;
      else libP2 = lib.length;
    }
  } catch {}

  // Fill library + hand from per-seat tallies (mirrored via stats:update)
  try {
    if (tallies && tallies.bySeat) {
      const s1 = tallies.bySeat['1'];
      const s2 = tallies.bySeat['2'];

      // library
      const applyLib = (seatData, which) => {
        if (!seatData) return;

        // Prefer absolute mirrored count from TurnUpkeep (library_abs)
        const currentAbs = Number(seatData.libraryCurrent);
        if (Number.isFinite(currentAbs)) {
          if (which === '1') libP1 = currentAbs;
          if (which === '2') libP2 = currentAbs;
          return;
        }

        // Fallback: derive from start + net
        const start = Number(seatData.startLibrary);
        const inN   = Number(seatData.libraryIn)  || 0;
        const outN  = Number(seatData.libraryOut) || 0;
        const net =
          (typeof seatData.netLibrary === 'number' && !Number.isNaN(seatData.netLibrary))
            ? Number(seatData.netLibrary)
            : (inN - outN);

        if (Number.isFinite(start)) {
          const current = start + net;
          if (which === '1') libP1 = current;
          if (which === '2') libP2 = current;
        }
      };


      applyLib(s1, '1');
      applyLib(s2, '2');

      // absolute hand counts (real-time mirrored)
      if (s1 && typeof s1.handCount === 'number') {
        handP1 = s1.handCount;
      }
      if (s2 && typeof s2.handCount === 'number') {
        handP2 = s2.handCount;
      }
    }
  } catch {}

  return {
    hand:    { p1: handP1, p2: handP2 },
    library: { p1: libP1,  p2: libP2  }
  };
}



function refreshData() {
  const TU = window.TurnUpkeep || {};
  try { TU.recomputeSnapshot?.(); } catch {}
	const tallies  = TU.getTallies?.()   || null;
  const snapshot = TU.getSnapshot?.()  || null;
  const state    = typeof TU.state === 'function' ? TU.state() : null;

  // pull life totals from UI, if available
  let life = null;
  try {
    const UI = window.UserInterface;
    if (UI?.getLifeSnapshot) {
      life = UI.getLifeSnapshot();
    } else if (UI?._STATE) {
      const s = UI._STATE;
      life = { p1: { ...s.p1 }, p2: { ...s.p2 } };
    }
  } catch (e) {
    console.warn('[TurnStatsOverlay] getLifeSnapshot failed', e);
  }

const zonesCurrent = getCurrentZonesSnapshot(tallies);

  return { tallies, snapshot, state, life, zonesCurrent };
}


function seatLabel(seatNum) {
  let my = 1;
  try {
    my = Number(typeof window.mySeat === 'function' ? window.mySeat() : 1) || 1;
  } catch {}
  const s = Number(seatNum) || 1;
  if (s === my) return `You (Seat ${s})`;
  return `Opponent (Seat ${s})`;
}

/**
 * Best-effort mana value calculator from a cost string like "{1}{B}{B}".
 * Treats X/Y/Z as 0 for display; handles hybrid & phyrexian sanely.
 */
function computeManaValueFromCost(costStr) {
  const s = String(costStr || '');
  if (!s) return null;

  const re = /\{([^}]+)\}/g;
  let m;
  let total = 0;

  while ((m = re.exec(s)) !== null) {
    const tokRaw = m[1];
    if (!tokRaw) continue;
    const tok = String(tokRaw).toUpperCase();

    // Pure generic number, e.g. "{3}"
    if (/^\d+$/.test(tok)) {
      total += Number(tok);
      continue;
    }

    // X / Y / Z – treat as 0 here
    if (tok === 'X' || tok === 'Y' || tok === 'Z') {
      continue;
    }

    // Single-symbol colored / colorless / snow
    if (/^(W|U|B|R|G|C|S)$/.test(tok)) {
      total += 1;
      continue;
    }

    // Hybrid / phyrexian / 2-color etc, e.g. "W/U", "2/U", "G/P"
    if (tok.includes('/')) {
      const parts = tok.split('/');
      const numPart = parts.find(p => /^\d+$/.test(p));
      if (numPart) {
        // things like {2/U} -> 2
        total += Number(numPart);
      } else {
        // normal hybrid / phyrexian -> 1
        total += 1;
      }
      continue;
    }

    // Anything unknown counts as 0
  }

  return total;
}


/**
 * Render a "color × count" label, using mana-master icons when possible.
 * - Accepts keys like "W", "U", "B", "R", "G", "C" or full cost strings like "{R}{U}".
 * - Falls back to plain text if it can't be interpreted as a mana-cost.
 */
function renderColorCountHTML(colKey, count) {
  const key = String(colKey || '').trim();
  if (!key) return `? ×${count}`;

  try {
    // Already a full cost string: "{R}{U}" etc.
    if (key.includes('{') && key.includes('}')) {
      return `${manaCostHtml(key)} ×${count}`;
    }

    // Single-color buckets: W/U/B/R/G/C
    if (/^[WUBRGC]$/i.test(key)) {
      return `${manaCostHtml(`{${key.toUpperCase()}}`)} ×${count}`;
    }

    // Common label for colorless bucket
    if (/^colorless$/i.test(key)) {
      return `${manaCostHtml('{C}')} ×${count}`;
    }
  } catch (e) {
    console.warn('[TurnStatsOverlay] renderColorCountHTML failed', e);
  }

  // Fallback: just print the key
  return `${key} ×${count}`;
}


function renderTallies(container, tallies, snapshot) {

  container.innerHTML = '';

  if (!tallies || !tallies.bySeat) {
    const p = document.createElement('div');
    p.textContent = 'No tallies recorded yet this turn.';
    p.style.fontSize = '11px';
    p.style.opacity = '0.8';
    container.appendChild(p);
    return;
  }

  const seatGrid = document.createElement('div');
  seatGrid.className = 'ts-seat-grid';

  const seatKeys = Object.keys(tallies.bySeat).sort();

  // Helper: build a label/value grid
  function makeStatGrid(pairs) {
    const grid = document.createElement('div');
    grid.className = 'ts-stat-grid';

    for (const [label, value] of pairs) {
      const lab = document.createElement('div');
      lab.className = 'ts-stat-label';
      lab.textContent = label;

      const val = document.createElement('div');
      val.className = 'ts-stat-value';
      val.textContent = (value != null && value !== '—') ? String(value) : '0';

      grid.appendChild(lab);
      grid.appendChild(val);
    }
    return grid;
  }

  // Helper: append a <details> group with a grid inside
  function appendGroup(card, title, pairs, { open = false } = {}) {
    if (!pairs || !pairs.length) return;

    const details = document.createElement('details');
    details.className = 'ts-details';
    details.open = !!open;

    const sum = document.createElement('summary');
    sum.textContent = title;
    details.appendChild(sum);

    const grid = makeStatGrid(pairs);
    grid.style.marginTop = '4px';
    details.appendChild(grid);

    card.appendChild(details);
  }

  for (const key of seatKeys) {
    const seatData = tallies.bySeat[key] || {};
    const card = document.createElement('div');
    card.className = 'ts-seat-card';

    // ----- Tapped / untapped from snapshot.tappedBreakdown -----
    const tapBucket   = snapshot?.tappedBreakdown?.[key]?.all || {};
    const tappedNow   = tapBucket.tapped   ?? 0;
    const untappedNow = tapBucket.untapped ?? 0;

    // Title
    const titleRow = document.createElement('div');
    titleRow.className = 'ts-seat-title';
    const left = document.createElement('span');
    left.textContent = seatLabel(key);
    const right = document.createElement('span');
    right.style.opacity = '0.75';
    right.textContent = `Casts: ${seatData.casts | 0}`;
    titleRow.appendChild(left);
    titleRow.appendChild(right);
    card.appendChild(titleRow);

    // ---------- Quick summary row (always visible) ----------
    const quickPairs = [
      ['Cards drawn', seatData.draws],
      ['Lands played', seatData.landsPlayed],
      ['Spells cast', seatData.casts]
    ];
    const quickGrid = makeStatGrid(quickPairs);
    card.appendChild(quickGrid);

    // ---------- Normalize life + library tallies ----------
    const lifeGain = (
      seatData.lifegain ??
      seatData.lifeGain ??
      seatData.life?.gained ??
      0
    );
    const lifeLoss = (
      seatData.lifeloss ??
      seatData.lifeLoss ??
      seatData.life?.lost ??
      0
    );
    const netLife = (
      seatData.netLife ??
      seatData.lifeNet ??
      (lifeGain - lifeLoss)
    );

    const startLife    = seatData.startLife ?? null;
    const startLibrary = seatData.startLibrary ?? null;
    const libraryIn    = seatData.libraryIn ?? 0;
    const libraryOut   = seatData.libraryOut ?? 0;
    const netLibrary   = seatData.netLibrary ?? (libraryIn - libraryOut);

    // Graveyard / Exile breakdown – per seat
    const gyFromHand  = seatData.toGraveyardFromHand ?? 0;   // discards to GY
    let   gyTotal     = seatData.toGraveyardTotal;
    if (gyTotal == null) gyTotal = gyFromHand;
    const gyOther     = Math.max(0, (gyTotal ?? 0) - gyFromHand);

    const exFromHand  = seatData.toExileFromHand ?? 0;       // discards to exile
    let   exTotal     = seatData.toExileTotal;
    if (exTotal == null) exTotal = exFromHand;
    const exOther     = Math.max(0, (exTotal ?? 0) - exFromHand);

    // ---------- Group: Life ----------
    appendGroup(card, 'Life', [
      ['Life at start of turn', startLife ?? '—'],
      ['Life gained', lifeGain],
      ['Life lost', lifeLoss],
      ['Net life', netLife]
    ], { open: true }); // open by default (important info)

    // ---------- Group: Library & draws ----------
    appendGroup(card, 'Library & draws', [
      ['Library at start of turn', startLibrary ?? '—'],
      ['Returned to library', libraryIn],
      ['Left library', libraryOut],
      ['Net library change', netLibrary],
      ['Scries', seatData.scries],
	  ['Tutors', seatData.tutors],
      ['Surveils', seatData.surveils],
      ['Investigates', seatData.investigates]
    ]);

    // ---------- Group: Battlefield & combat ----------
    appendGroup(card, 'Battlefield & combat', [
      ['Tapped permanents', tappedNow],
      ['Untapped permanents', untappedNow],
      ['Attackers declared', seatData.attackersDeclared],
      ['Blockers declared', seatData.blockersDeclared]
    ]);

    // ---------- Group: Graveyard ----------
    appendGroup(card, 'Graveyard', [
      ['Total cards sent to graveyard', gyTotal],
      ['…from hand (discards)', gyFromHand],
      ['…from other zones', gyOther]
    ]);

    // ---------- Group: Exile ----------
    appendGroup(card, 'Exile', [
      ['Total cards exiled', exTotal],
      ['…from hand (discards)', exFromHand],
      ['…from other zones', exOther]
    ]);

    // ---------- Group: Casts & costs ----------
    let hasCastsGroup = false;
    const castsDetails = document.createElement('details');
    castsDetails.className = 'ts-details';
    const castsSummary = document.createElement('summary');
    castsSummary.textContent = 'Casts & costs';
    castsDetails.appendChild(castsSummary);

    const castsBody = document.createElement('div');
    castsBody.style.marginTop = '4px';
    castsDetails.appendChild(castsBody);

    // By color
    if (seatData.castsByColor && Object.keys(seatData.castsByColor).length) {
      const row = document.createElement('div');
      row.className = 'ts-pill-row';
      const label = document.createElement('div');
      label.textContent = 'By color:';
      label.style.fontSize = '11px';
      label.style.opacity = '0.8';
      row.appendChild(label);

      for (const [col, cnt] of Object.entries(seatData.castsByColor)) {
        const pill = document.createElement('span');
        pill.className = 'ts-small-pill';
        pill.innerHTML = renderColorCountHTML(col, cnt);
        row.appendChild(pill);
      }

      castsBody.appendChild(row);
      hasCastsGroup = true;
    }

    // By mana value bucket
    if (seatData.castsByMVBucket && Object.keys(seatData.castsByMVBucket).length) {
      const row = document.createElement('div');
      row.className = 'ts-pill-row';
      const label = document.createElement('div');
      label.textContent = 'By mana value:';
      label.style.fontSize = '11px';
      label.style.opacity = '0.8';
      row.appendChild(label);

      for (const [bucket, cnt] of Object.entries(seatData.castsByMVBucket)) {
        const pill = document.createElement('span');
        pill.className = 'ts-small-pill';
        pill.textContent = `${bucket} ×${cnt}`;
        row.appendChild(pill);
      }

      castsBody.appendChild(row);
      hasCastsGroup = true;
    }

    // Names played (first few)
    if (Array.isArray(seatData.namesPlayed) && seatData.namesPlayed.length) {
      const innerDetails = document.createElement('details');
      innerDetails.className = 'ts-details';
      const sumInner = document.createElement('summary');
      sumInner.textContent = `Cards cast this turn (${seatData.namesPlayed.length})`;
      innerDetails.appendChild(sumInner);

      const list = document.createElement('div');
      list.style.marginTop = '4px';
      list.style.fontSize = '11px';

      const maxShow = 10;
      seatData.namesPlayed.slice(0, maxShow).forEach(row => {
        const line = document.createElement('div');

        // bullet
        const bullet = document.createElement('span');
        bullet.textContent = '• ';
        line.appendChild(bullet);

        // name
        const nameSpan = document.createElement('span');
        nameSpan.textContent = row.name || 'Card';
        line.appendChild(nameSpan);

        // mana cost icons, if available (row.manaCost or row.cost)
        const costStr = row.manaCost || row.cost || '';
        if (costStr) {
          const costSpan = document.createElement('span');
          costSpan.style.marginLeft = '4px';
          costSpan.innerHTML = manaCostHtml(costStr);
          line.appendChild(costSpan);
        }

        // MV text (prefer row.mv, but fall back to computing from cost)
        let mv = row.mv;

        const mvNum = mv != null ? Number(mv) : null;
        const needsRecalc =
          costStr && (
            mv == null ||
            Number.isNaN(mvNum) ||
            mvNum === 0
          );

        if (needsRecalc) {
          const computed = computeManaValueFromCost(costStr);
          if (computed != null && !Number.isNaN(computed)) {
            mv = computed;
          }
        }

        if (mv != null) {
          const mvSpan = document.createElement('span');
          mvSpan.style.marginLeft = '4px';
          mvSpan.style.opacity = '0.8';

          const mvNumFinal = Number(mv);
          const showMv = Number.isNaN(mvNumFinal) ? mv : mvNumFinal;
          mvSpan.textContent = `(MV ${showMv})`;
          line.appendChild(mvSpan);
        }

        list.appendChild(line);
      });

      if (seatData.namesPlayed.length > maxShow) {
        const more = document.createElement('div');
        more.className = 'ts-note';
        more.textContent = `… plus ${seatData.namesPlayed.length - maxShow} more`;
        list.appendChild(more);
      }

      innerDetails.appendChild(list);
      castsBody.appendChild(innerDetails);
      hasCastsGroup = true;
    }

    if (hasCastsGroup) {
      card.appendChild(castsDetails);
    }

    seatGrid.appendChild(card);
  }

  container.appendChild(seatGrid);

  // ---------- Global zone sends / library totals / tutors/shuffles ----------
  const divider = document.createElement('div');
  divider.className = 'ts-section-divider';
  container.appendChild(divider);

  const kv = document.createElement('div');
  kv.className = 'ts-key-value-list';

  // Sum library in/out across seats (per-turn)
  const libInTotal  = (tallies?.bySeat?.['1']?.libraryIn  ?? 0) + (tallies?.bySeat?.['2']?.libraryIn  ?? 0);
  const libOutTotal = (tallies?.bySeat?.['1']?.libraryOut ?? 0) + (tallies?.bySeat?.['2']?.libraryOut ?? 0);
  const libNetTotal = libInTotal - libOutTotal;

  // Global discard splits (to be fed by TurnUpkeep)
  const discToGyTotal    = tallies.discardToGraveyard ?? tallies.discardToGrave ?? 0;
  const discToExileTotal = tallies.discardToExile ?? 0;

  const globalPairs = [
    ['Cards sent to graveyard (this turn)', tallies.graves],
    ['…of which discarded from hand', discToGyTotal],
    ['Cards exiled (this turn)', tallies.exiles],
    ['…of which discarded from hand', discToExileTotal],

    ['Returned to library (this turn)', libInTotal],
    ['Left library (this turn)', libOutTotal],
    ['Net library change (this turn)', libNetTotal],

    // Legacy “returns” = hand returns (kept for compatibility)
    ['Returns to hand tracked', tallies.returns],

    ['Tutors tracked', tallies.tutors],
    ['Shuffles tracked', tallies.shuffles]
  ];

  for (const [label, value] of globalPairs) {
    const k = document.createElement('div');
    k.className = 'ts-key-value-key';
    k.textContent = label;
    const v = document.createElement('div');
    v.className = 'ts-key-value-val';
    v.textContent = value != null ? String(value) : '0';
    kv.appendChild(k);
    kv.appendChild(v);
  }

  container.appendChild(kv);

  // ---------- Counters / tokens detail chips ----------
  const pillRow = document.createElement('div');
  pillRow.className = 'ts-pill-row';

  if (tallies.countersPlaced && Object.keys(tallies.countersPlaced).length) {
    const label = document.createElement('div');
    label.textContent = 'Counters placed:';
    label.style.fontSize = '11px';
    label.style.opacity = '0.8';
    pillRow.appendChild(label);

    for (const [kind, cnt] of Object.entries(tallies.countersPlaced)) {
      const pill = document.createElement('span');
      pill.className = 'ts-small-pill';
      pill.textContent = `${kind} ×${cnt}`;
      pillRow.appendChild(pill);
    }
  }

  if (tallies.tokensCreated && Object.keys(tallies.tokensCreated).length) {
    const label = document.createElement('div');
    label.textContent = (pillRow.childNodes.length ? ' • Tokens created:' : 'Tokens created:');
    label.style.fontSize = '11px';
    label.style.opacity = '0.8';
    pillRow.appendChild(label);

    for (const [kind, cnt] of Object.entries(tallies.tokensCreated)) {
      const pill = document.createElement('span');
      pill.className = 'ts-small-pill';
      pill.textContent = `${kind} ×${cnt}`;
      pillRow.appendChild(pill);
    }
  }

  if (pillRow.childNodes.length) container.appendChild(pillRow);
}


function renderSnapshot(container, snapshot) {
  container.innerHTML = '';

  if (!snapshot) {
    const p = document.createElement('div');
    p.textContent = 'No snapshot available yet. It is recomputed when you open this view.';
    p.style.fontSize = '11px';
    p.style.opacity = '0.8';
    container.appendChild(p);
    return;
  }

  let mySeat = 1;
  try {
    mySeat = Number(typeof window.mySeat === 'function' ? window.mySeat() : 1) || 1;
  } catch {}
  const myKey   = String(mySeat) === '2' ? '2' : '1';
  const oppKey  = myKey === '1' ? '2' : '1';
  const mineCnt = snapshot.byController?.[myKey]  ?? 0;
  const oppCnt  = snapshot.byController?.[oppKey] ?? 0;

  // Overview line
  const overview = document.createElement('div');
  overview.className = 'ts-pill-row';

  const totalPill = document.createElement('span');
  totalPill.className = 'ts-pill';
  totalPill.textContent = `Total permanents on field: ${snapshot.total|0}`;
  overview.appendChild(totalPill);

  const minePill = document.createElement('span');
  minePill.className = 'ts-pill green';
  minePill.textContent = `Yours: ${mineCnt|0}`;
  overview.appendChild(minePill);

  const oppPill = document.createElement('span');
  oppPill.className = 'ts-pill red';
  oppPill.textContent = `Opponent: ${oppCnt|0}`;
  overview.appendChild(oppPill);

  const tappedP = document.createElement('span');
  tappedP.className = 'ts-pill';
  tappedP.textContent = `Tapped: ${snapshot.tapped?.tapped|0} • Untapped: ${snapshot.tapped?.untapped|0}`;
  overview.appendChild(tappedP);

  const tokenP = document.createElement('span');
  tokenP.className = 'ts-pill';
  tokenP.textContent = `Tokens: ${snapshot.tokens?.token|0} • Non-token: ${snapshot.tokens?.nontoken|0}`;
  overview.appendChild(tokenP);

  container.appendChild(overview);

  // Key-value breakdowns
  const divider = document.createElement('div');
  divider.className = 'ts-section-divider';
  container.appendChild(divider);

  const kv = document.createElement('div');
  kv.className = 'ts-key-value-list';

  // By type
  const typeMap = snapshot.byType || {};
  const sortedTypes = Object.entries(typeMap).sort((a,b)=>b[1]-a[1]);
  for (const [typ, cnt] of sortedTypes) {
    const k = document.createElement('div');
    k.className = 'ts-key-value-key';
    k.textContent = `Type: ${typ}`;
    const v = document.createElement('div');
    v.className = 'ts-key-value-val';
    v.textContent = String(cnt);
    kv.appendChild(k);
    kv.appendChild(v);
  }

  // By color
  const colorMap = snapshot.byColor || {};
  const sortedColors = Object.entries(colorMap).sort((a,b)=>b[1]-a[1]);
  for (const [col, cnt] of sortedColors) {
    const k = document.createElement('div');
    k.className = 'ts-key-value-key';
    k.textContent = `Color: ${col}`;
    const v = document.createElement('div');
    v.className = 'ts-key-value-val';
    v.textContent = String(cnt);
    kv.appendChild(k);
    kv.appendChild(v);
  }

  container.appendChild(kv);

  // Creature subtype “top N”
  const subMap = snapshot.byCreatureSubtype || {};
  const subs = Object.entries(subMap).sort((a,b)=>b[1]-a[1]).slice(0, 15);
  if (subs.length) {
    const note = document.createElement('div');
    note.className = 'ts-note';
    note.textContent = 'Most common creature subtypes on the field:';
    container.appendChild(note);

    const row = document.createElement('div');
    row.className = 'ts-pill-row';
    for (const [sub, cnt] of subs) {
      const pill = document.createElement('span');
      pill.className = 'ts-small-pill';
      pill.textContent = `${sub} ×${cnt}`;
      row.appendChild(pill);
    }
    container.appendChild(row);
  }

  // Planeswalker + land production summary
  const planes = snapshot.planeswalkers || {};
  const lands  = snapshot.landsByColorProduced || {};
  if (planes.count || Object.keys(lands).length) {
    const divider2 = document.createElement('div');
    divider2.className = 'ts-section-divider';
    container.appendChild(divider2);

    const kv2 = document.createElement('div');
    kv2.className = 'ts-key-value-list';

    if (planes.count) {
      const k1 = document.createElement('div');
      k1.className = 'ts-key-value-key';
      k1.textContent = 'Planeswalkers (count)';
      const v1 = document.createElement('div');
      v1.className = 'ts-key-value-val';
      v1.textContent = String(planes.count);
      kv2.appendChild(k1); kv2.appendChild(v1);

      const k2 = document.createElement('div');
      k2.className = 'ts-key-value-key';
      k2.textContent = 'Total loyalty on field';
      const v2 = document.createElement('div');
      v2.className = 'ts-key-value-val';
      v2.textContent = String(planes.totalLoyalty || 0);
      kv2.appendChild(k2); kv2.appendChild(v2);

      const k3 = document.createElement('div');
      k3.className = 'ts-key-value-key';
      k3.textContent = 'Loyalty abilities used this turn';
      const v3 = document.createElement('div');
      v3.className = 'ts-key-value-val';
      v3.textContent = String(planes.activatedThisTurn || 0);
      kv2.appendChild(k3); kv2.appendChild(v3);
    }

    if (Object.keys(lands).length) {
      for (const [col, cnt] of Object.entries(lands)) {
        const k = document.createElement('div');
        k.className = 'ts-key-value-key';
        k.textContent = `Lands that can produce ${col}`;
        const v = document.createElement('div');
        v.className = 'ts-key-value-val';
        v.textContent = String(cnt);
        kv2.appendChild(k); kv2.appendChild(v);
      }
    }

    container.appendChild(kv2);
  }

  // Estimated casts this turn
  if (snapshot.estimatedCastsThisTurn) {
    const divider3 = document.createElement('div');
    divider3.className = 'ts-section-divider';
    container.appendChild(divider3);

    const kv3 = document.createElement('div');
    kv3.className = 'ts-key-value-list';

    const estMine = snapshot.estimatedCastsThisTurn[myKey]  ?? 0;
    const estOpp  = snapshot.estimatedCastsThisTurn[oppKey] ?? 0;

    const k1 = document.createElement('div');
    k1.className = 'ts-key-value-key';
    k1.textContent = 'Estimated spells you cast this turn';
    const v1 = document.createElement('div');
    v1.className = 'ts-key-value-val';
    v1.textContent = String(estMine);
    kv3.appendChild(k1); kv3.appendChild(v1);

    const k2 = document.createElement('div');
    k2.className = 'ts-key-value-key';
    k2.textContent = 'Estimated spells opponent cast this turn';
    const v2 = document.createElement('div');
    v2.className = 'ts-key-value-val';
    v2.textContent = String(estOpp);
    kv3.appendChild(k2); kv3.appendChild(v2);

    container.appendChild(kv3);
  }

  // Flat keys (mine/opp) for scripting, tucked behind <details>
  if (snapshot.flat && (Object.keys(snapshot.flat.mine||{}).length || Object.keys(snapshot.flat.opp||{}).length)) {
    const details = document.createElement('details');
    details.className = 'ts-details';

    const sum = document.createElement('summary');
    sum.textContent = 'Show flat key dump (mine / opp) for scripting';
    details.appendChild(sum);

    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(snapshot.flat, null, 2);
    details.appendChild(pre);

    container.appendChild(details);
  }
}

// Public API
export const TurnStatsOverlay = {
  mount(container) {
    ensureStyles();

    const root = document.createElement('div');
    root.id = 'turn-stats-root';

    const { tallies, snapshot, state, life, zonesCurrent } = refreshData();



    // Header
    const header = document.createElement('div');
    header.className = 'ts-header';

    const headerMain = document.createElement('div');
    headerMain.className = 'ts-header-main';

    const title = document.createElement('strong');
    const turnNum   = state?.turn ?? '?';
    const activeSeat= state?.activeSeat ?? '?';
    const phase     = state?.phase || '(unknown phase)';
    title.textContent = `Turn ${turnNum} — Seat ${activeSeat}`;
    headerMain.appendChild(title);

    const phasePill = document.createElement('span');
    phasePill.className = 'ts-pill';
    phasePill.textContent = `Phase: ${phase}`;
    headerMain.appendChild(phasePill);

    const drawsMine = tallies?.bySeat?.['1']?.draws ?? 0;
    const drawsOpp  = tallies?.bySeat?.['2']?.draws ?? 0;
    const drawsPill = document.createElement('span');
    drawsPill.className = 'ts-pill';
    drawsPill.textContent = `Draws this turn — P1: ${drawsMine} • P2: ${drawsOpp}`;
    headerMain.appendChild(drawsPill);

    // 🔵 Life totals pill
    const p1Life = life?.p1?.total;
    const p2Life = life?.p2?.total;
    const lifePill = document.createElement('span');
    lifePill.className = 'ts-pill';
    lifePill.textContent = `Life — P1: ${p1Life ?? '?'} • P2: ${p2Life ?? '?'}`;
    headerMain.appendChild(lifePill);

    // 🔵 Current hand / library snapshot (live)
    const handP1 = zonesCurrent?.hand?.p1 ?? 0;
    const handP2 = zonesCurrent?.hand?.p2 ?? 0;
    const libP1  = zonesCurrent?.library?.p1;
    const libP2  = zonesCurrent?.library?.p2;
    const currentZonePill = document.createElement('span');
    currentZonePill.className = 'ts-pill';
    currentZonePill.textContent =
      `Current — Hand P1: ${handP1} • P2: ${handP2} | Library P1: ${libP1 ?? '?'} • P2: ${libP2 ?? '?'}`;
    headerMain.appendChild(currentZonePill);

    header.appendChild(headerMain);


    const headerActions = document.createElement('div');
    headerActions.className = 'ts-header-actions';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'ts-btn';
    refreshBtn.textContent = 'Refresh now';
    refreshBtn.addEventListener('click', () => {
      const data = refreshData();
      renderTallies(talliesBody, data.tallies, data.snapshot);
      renderSnapshot(snapshotBody, data.snapshot);

      // keep header in sync too
      const turnNum   = data.state?.turn ?? '?';
      const activeSeat= data.state?.activeSeat ?? '?';
      const phaseNow  = data.state?.phase || '(unknown phase)';
      title.textContent = `Turn ${turnNum} — Seat ${activeSeat}`;
      phasePill.textContent = `Phase: ${phaseNow}`;

      const drawsMineNow = data.tallies?.bySeat?.['1']?.draws ?? 0;
      const drawsOppNow  = data.tallies?.bySeat?.['2']?.draws ?? 0;
      drawsPill.textContent = `Draws this turn — P1: ${drawsMineNow} • P2: ${drawsOppNow}`;

      const lifeNow = data.life;
      if (lifeNow) {
        const p1 = lifeNow.p1?.total;
        const p2 = lifeNow.p2?.total;
        lifePill.textContent = `Life — P1: ${p1 ?? '?'} • P2: ${p2 ?? '?'}`;
      }

      const zNow = data.zonesCurrent;
      if (zNow) {
        const h1 = zNow.hand?.p1 ?? 0;
        const h2 = zNow.hand?.p2 ?? 0;
        const l1 = zNow.library?.p1;
        const l2 = zNow.library?.p2;
        currentZonePill.textContent =
          `Current — Hand P1: ${h1} • P2: ${h2} | Library P1: ${l1 ?? '?'} • P2: ${l2 ?? '?'}`;
      }
    });

    headerActions.appendChild(refreshBtn);

    const dumpBtn = document.createElement('button');
    dumpBtn.className = 'ts-btn';
    dumpBtn.textContent = 'Log raw to console';
    dumpBtn.addEventListener('click', () => {
      const data = refreshData();
      console.log('[TurnStatsOverlay] tallies', data.tallies);
      console.log('[TurnStatsOverlay] snapshot', data.snapshot);
      console.log('[TurnStatsOverlay] state', data.state);
    });
    headerActions.appendChild(dumpBtn);

    header.appendChild(headerActions);

    root.appendChild(header);

    // Layout: left tallies, right snapshot
    const layout = document.createElement('div');
    layout.className = 'ts-layout';

    const talliesSection = document.createElement('section');
    talliesSection.className = 'ts-section';
    const tH = document.createElement('h3');
    tH.textContent = 'Per-turn tallies';
    const tSub = document.createElement('div');
    tSub.className = 'ts-subtitle';
    tSub.textContent = 'Draws, casts, life (start/gain/loss), library (start/in/out/net), combat stats, counters/tokens, and zone sends for this turn.';

    talliesSection.appendChild(tH);
    talliesSection.appendChild(tSub);

    const talliesBody = document.createElement('div');
    talliesBody.className = 'ts-section-body';
    talliesSection.appendChild(talliesBody);
    layout.appendChild(talliesSection);

    const snapshotSection = document.createElement('section');
    snapshotSection.className = 'ts-section';
    const sH = document.createElement('h3');
    sH.textContent = 'Board snapshot';
    const sSub = document.createElement('div');
    sSub.className = 'ts-subtitle';
    sSub.textContent = 'Current battlefield breakdown by controller, type, color, tokens, and subtypes.';
    snapshotSection.appendChild(sH);
    snapshotSection.appendChild(sSub);

    const snapshotBody = document.createElement('div');
    snapshotBody.className = 'ts-section-body';
    snapshotSection.appendChild(snapshotBody);
    layout.appendChild(snapshotSection);

    root.appendChild(layout);
    container.appendChild(root);

    // initial render
    // initial render
renderTallies(talliesBody, tallies, snapshot);
renderSnapshot(snapshotBody, snapshot);

  }
};
