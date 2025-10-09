/* turn.timewarp.js
   - Adds a rewind/fast-forward control under the Game 1/2/3 buttons.
   - On End Turn, saves a compact snapshot (Deck/Hand/Graveyard/Exile) for ALL seats.
   - Lets you restore any previous turn across all seats.
   - Uses your existing StorageAPI (loadMeta/saveMeta/loadPlayerState/wipePlayerState).
*/

(function(){
  // Wait for AppState + StorageAPI
  async function waitReady(){
    while (!(window.AppState && window.StorageAPI)) {
      await new Promise(r=>setTimeout(r, 30));
    }
  }

  // UI creation under gamePicker
  function ensureTimewarpUI(){
    const host = document.getElementById('gamePicker');
    if (!host || document.getElementById('twWrap')) return;

    const wrap = document.createElement('div');
    wrap.id = 'twWrap';
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    wrap.style.marginTop = '6px';

    wrap.innerHTML = `
      <button id="twPrev" class="gameBtn" title="Previous turn" aria-label="Previous turn">◀</button>
      <input id="twTurn" class="pill" inputmode="numeric" pattern="\\d*" style="width:86px;text-align:center;font-weight:900" placeholder="Turn #" />
      <button id="twNext" class="gameBtn" title="Next turn" aria-label="Next turn">▶</button>
    `;
    host.parentElement?.appendChild(wrap);

    // Wire events
    const prev = wrap.querySelector('#twPrev');
    const next = wrap.querySelector('#twNext');
    const box  = wrap.querySelector('#twTurn');

    prev.addEventListener('click', async ()=>{
      const t = Math.max(0, (await getCurrentTurnIndex()) - 1);
      await restoreTurn(t);
      box.value = String(t);
    });

    next.addEventListener('click', async ()=>{
      const t = (await getCurrentTurnIndex()) + 1;
      const ok = await restoreTurn(t);
      if (ok) box.value = String(t);
    });

    box.addEventListener('keydown', async (e)=>{
      if (e.key === 'Enter'){
        const val = parseInt(box.value || '0', 10);
        if (Number.isFinite(val) && val >= 0){
          await restoreTurn(val);
        } else {
          alert('Enter a non-negative turn number.');
        }
      }
    });
  }

  // Read current meta turn index (default 0)
  async function getCurrentTurnIndex(){
    const gid = window.AppState?.gameId;
    if (!gid) return 0;
    const m = await window.StorageAPI.loadMeta(gid);
    return Number(m?.TurnIndex || 0);
  }

  // Snapshot helpers
  function pickSnapshotFields(doc){
    return {
      Deck:      (doc?.Deck||[]).map(x => ({...x})),
      Hand:      (doc?.Hand||[]).map(x => ({...x})),
      Graveyard: (doc?.Graveyard||[]).map(x => ({...x})),
      Exile:     (doc?.Exile||[]).map(x => ({...x})),
      // NOTE: commander/table not requested; add if you want later.
      at: Date.now()
    };
  }

  async function snapshotAllSeats(turnIndex){
    const gid = window.AppState?.gameId;
    const players = Number(window.AppState?.playerCount || 2);
    if (!gid) return;

    const seats = {};
    for (let s = 1; s <= players; s++){
      const doc = await window.StorageAPI.loadPlayerState(gid, s);
      seats[String(s)] = pickSnapshotFields(doc || {});
    }

    // Merge into meta.Backups
    const meta = await window.StorageAPI.loadMeta(gid) || {};
    const Backups = Object.assign({}, meta.Backups || {});
    Backups[String(turnIndex)] = { seats };

    // Store TurnIndex and the Backups map together
    await window.StorageAPI.saveMeta(gid, { TurnIndex: turnIndex, Backups });
  }

  // Restore helpers
  // NEW: use Supabase turn_snapshots
async function restoreTurn(targetTurn){
  const gid = window.AppState?.gameId;
  if (!gid) { alert('Pick a Game first.'); return false; }

  // fetch all seats for that turn
  const { data, error } = await window.supabase
    .from('turn_snapshots')
    .select('seat,snapshot')
    .eq('game_id', gid)
    .eq('turn_index', targetTurn)
    .order('seat', { ascending: true });

  if (error) { console.warn('[timewarp restore]', error); return false; }
  if (!data || !data.length){ alert(`No snapshot for turn ${targetTurn}.`); return false; }

  const ops = data.map(r => {
    const s = Number(r.seat);
    const snap = r.snapshot || {};
    return window.StorageAPI.wipePlayerState(gid, s, {
      Deck:      snap.Deck      || snap.deck      || [],
      Hand:      snap.Hand      || snap.hand      || [],
      Table:     snap.Table     || snap.table     || [],
      Graveyard: snap.Graveyard || snap.gy        || snap.graveyard || [],
      Exile:     snap.Exile     || snap.exile     || [],
      Commander: snap.Commander || snap.commander || null,
      Turn: 0
    });
  });
  await Promise.all(ops);

  // (optional) also set meta TurnIndex so the UI shows the number
  await window.StorageAPI.saveMeta(gid, { TurnIndex: targetTurn });

  // refresh UI
  if (typeof window.loadGameIntoUI === 'function') {
    await window.loadGameIntoUI(gid);
  }
  return true;
}


  // Patch saveMeta so ANY time code advances the turn seat, we also:
  //  1) bump TurnIndex
  //  2) save a snapshot for that new index
  async function installSaveMetaPatch(){
    const SA = window.StorageAPI;
    if (!SA || SA.__twSaveMetaWrapped) return;
    const orig = SA.saveMeta.bind(SA);

    SA.saveMeta = async function(gameId, patch){
      // If patch includes TurnSeat, we treat this as an end-turn edge
      const isTurnAdvance = patch && Object.prototype.hasOwnProperty.call(patch, 'TurnSeat');
      if (!isTurnAdvance) {
        return orig(gameId, patch);
      }

      // Compute the next TurnIndex
      const meta = await SA.loadMeta(gameId);
      const nextIndex = Number(meta?.TurnIndex || 0) + 1;

      // First: write TurnSeat & TurnIndex together
      await orig(gameId, Object.assign({}, patch, { TurnIndex: nextIndex }));

      // Then: save the backup for this index (all seats)
      try {
        await snapshotAllSeats(nextIndex);
      } catch (e) {
        console.error('[timewarp] snapshot failed', e);
      }
    };

    SA.__twSaveMetaWrapped = true;
  }

  // Make UI visible only after a game is chosen
  function showTurnIndexInBox(){
    const box = document.getElementById('twTurn');
    if (!box) return;
    getCurrentTurnIndex().then(v => box.value = String(v));
  }

  // Watch game selection so the control shows correct turn#
  function wireGamePickerWatch(){
    const gp = document.getElementById('gamePicker');
    if (!gp || gp.__twWired) return;
    gp.addEventListener('click', (e)=>{
      const btn = e.target.closest('.gameBtn');
      if (!btn) return;
      setTimeout(showTurnIndexInBox, 150);
    });
    gp.__twWired = true;
  }

  // Boot
  (async function boot(){
    await waitReady();
    ensureTimewarpUI();
    wireGamePickerWatch();
    await installSaveMetaPatch();
    showTurnIndexInBox();
  })();
})();
