// ================================
// FILE: modules/table.watcher.js
// ================================

/**
 * Watches the OPPONENT seat's player_states.state.table for new entries.
 * On detect: shows a compact overlay with art/name/cost/text + Counter button.
 * If you tap the overlay, the 5s timeout pauses; otherwise it auto-dismisses.
 * On Counter: inserts a row in public.table_counters.
 *
 * Requires:
 *  - window.supabase client (env.supabase.js sets this up)
 *  - window.AppState { gameId, mySeat }
 *  - StorageAPI.loadPlayerState(gameId, seat) for initial snapshot
 */

const SB = (typeof window !== 'undefined') ? window.supabase : null;

// ---- small helpers ----
const getGameId = () => String(window.AppState?.gameId || '');
const getMySeat = () => Number(window.AppState?.mySeat || 1);
const getOppSeat = () => {
  const me = getMySeat();
  const total = Math.max(2, Number(window.AppState?.playerCount || 2));
  // first non-me seat (simple 1<->2, rotate if >2 later)
  let s = (me === 1) ? 2 : 1;
  if (total > 2 && Array.isArray(window.AppState?.seats)) {
    const alt = window.AppState.seats.find(x => Number(x) !== me);
    if (alt) s = Number(alt);
  }
  return s;
};

// best-effort path to card art + bits from your card shape
function cardVisualBits(card = {}) {
  // Try several shapes your cards can have
  const scry = card._scry || card.scry || {};
  const faces = scry.faces || card._faces || [];
  const face0 = Array.isArray(faces) && faces.length ? (faces[0]._scry || faces[0] || {}) : {};
  const name = card.name || scry.name || face0.name || 'Unknown Card';
  const mana = card.mana_cost || scry.mana_cost || face0.mana_cost || '';
  const text = card.oracle_text || scry.oracle_text || face0.oracle_text || card.text || '';

  // image fallbacks: art_crop > border_crop > normal > small
  const imgUris = (scry.image_uris || face0.image_uris || card.image_uris || {});
  const img = imgUris.art_crop || imgUris.border_crop || imgUris.normal || imgUris.small || '';

  return { name, mana, text, img };
}


// overlay root (one at a time)
let overlayEl = null;
let overlayTimer = null;
let overlayFrozen = false;

function ensureOverlayHost(){
  if (document.getElementById('counterOverlay')) return;
  const el = document.createElement('div');
  el.id = 'counterOverlay';
  el.style.cssText = `
    position: fixed; inset: auto 12px 12px 12px; z-index: 99999;
    display: none; max-width: 520px; pointer-events: auto;
  `;
  document.body.appendChild(el);

  // lightweight styles
  const css = document.createElement('style');
  css.textContent = `
    .counter-toast {
      display:flex; gap:12px; align-items:flex-start;
      background: rgba(15,18,25,.96); color:#fff;
      border:1px solid rgba(255,255,255,.12);
      border-radius:14px; padding:12px; box-shadow:0 8px 30px rgba(0,0,0,.35);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      backdrop-filter: blur(8px);
    }
    .counter-toast img { width:96px; height:96px; object-fit:cover; border-radius:10px; flex:0 0 auto; }
    .counter-toast .meta { flex:1 1 auto; min-width:0; }
    .counter-toast .title { font-weight:700; font-size:15px; line-height:1.2; margin-bottom:4px; display:flex; justify-content:space-between; gap:8px; }
    .counter-toast .mana { opacity:.85; font-weight:600; }
    .counter-toast .text { font-size:13px; opacity:.92; max-height:66px; overflow:auto; }
    .counter-toast .actions { display:flex; gap:8px; margin-top:8px; }
    .counter-toast button {
      border:1px solid rgba(255,255,255,.2);
      background:rgba(255,255,255,.08);
      color:#fff; padding:6px 10px; border-radius:10px; font-weight:700; cursor:pointer;
    }
    .counter-toast button.primary { background:#3b82f6; border-color:#1d4ed8; }
    .counter-toast .timer { font-size:12px; opacity:.75; margin-left:auto; }
  `;
  document.head.appendChild(css);
}

// Replace {B}{U}{T}{3} etc. with mana-master icons
function manaToHtml(str = ''){
  const mapSimple = {
    'W':'w','U':'u','B':'b','R':'r','G':'g','C':'c','S':'s','X':'x','T':'tap','Q':'untap'
  };
  return String(str).replace(/\{([^}]+)\}/g, (_, token) => {
    const t = token.toUpperCase().trim();
    // numeric {0}..{20}
    if (/^\d+$/.test(t)) return `<i class="ms ms-${t}"></i>`;
    // hybrid {W/U}, {B/R}, etc.
    if (/^[WUBRGC]/.test(t) && t.includes('/')) {
      return `<i class="ms ms-${t.toLowerCase().replace('/','')}" title="${token}"></i>`;
    }
    // phyrexian {W/P}
    if (t.endsWith('/P')) {
      const base = t.split('/')[0].toLowerCase();
      return `<i class="ms ms-${base} ms-phyrexian" title="${token}"></i>`;
    }
    // snow already handled as S above
    if (mapSimple[t]) return `<i class="ms ms-${mapSimple[t]}"></i>`;
    // default fallback
    return `{${token}}`;
  });
}


function showOverlay(card, { timeoutMs = 5000, onCounter, onDismiss } = {}){
  ensureOverlayHost();
  const host = document.getElementById('counterOverlay');
  if (!host) return;

  const { name, mana, text, img } = cardVisualBits(card);

  host.innerHTML = '';
  if (overlayTimer) { clearInterval(overlayTimer); overlayTimer = null; }
  overlayFrozen = false;

  overlayEl = document.createElement('div');
  overlayEl.className = 'counter-toast';
  overlayEl.innerHTML = `
    ${img ? `<img src="${img}" alt="">` : ''}
    <div class="meta">
      <div class="title">
        <span>${name}</span>
        <span class="mana">${manaToHtml(mana) || ''}</span>
      </div>
      <div class="text">${manaToHtml((text || '').replace(/\n/g,'<br>'))}</div>
      <div class="actions">
        <button class="primary" data-act="counter">Counter</button>
        <button data-act="dismiss">Let it resolve</button>
        <span class="timer" aria-live="polite"></span>
      </div>
    </div>
  `;

  // Once you touch the overlay, we PAUSE UNTIL ACTION (no auto-unpause)
  overlayEl.addEventListener('pointerdown', ()=>{
    overlayFrozen = true; // persistently paused
    const t = overlayEl.querySelector('.timer');
    if (t) t.textContent = 'paused';
  }, { passive:true });

  overlayEl.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'counter'){
      onCounter && onCounter();
      hideOverlay();
    } else if (act === 'dismiss'){
      onDismiss && onDismiss();
      hideOverlay();
    }
  });

  host.appendChild(overlayEl);
  host.style.display = 'block';

  // Countdown (stops permanently after first tap)
  const timerEl = overlayEl.querySelector('.timer');
  const started = Date.now();
  const deadline = started + Math.max(1000, Number(timeoutMs||0));

  function tick(){
    if (!overlayEl) return;
    if (overlayFrozen){
      if (timerEl) timerEl.textContent = 'paused';
      return;
    }
    const ms = Math.max(0, deadline - Date.now());
    const s = Math.ceil(ms/1000);
    if (timerEl) timerEl.textContent = `${s}s`;
    if (ms <= 0){
      onDismiss && onDismiss();
      hideOverlay();
    }
  }
  overlayTimer = setInterval(tick, 150);
  tick();
}


function hideOverlay(){
  if (overlayTimer) { clearInterval(overlayTimer); overlayTimer = null; }
  const host = document.getElementById('counterOverlay');
  if (host){ host.style.display = 'none'; host.innerHTML = ''; }
  overlayEl = null;
}

/* ----------------------------
   erase a table_counters row
   (prefer id; fallback to composite)
----------------------------- */
async function eraseCounterRow(row){
  try{
    const q = SB.from('table_counters');
    let resp;
    if (row?.id){
      resp = await q.delete().eq('id', row.id);
    } else {
      resp = await q.delete()
        .eq('game_id', String(row?.game_id || ''))
        .eq('created_for_seat', Number(row?.created_for_seat || 0))
        .eq('target_card_id', String(row?.target_card_id || ''))
        .eq('status', 'declared');
    }
    if (resp?.error){
      console.warn('[tc] auto-erase failed', resp.error, row);
    } else {
      console.log('[tc] auto-erase ok', row?.id ?? row?.target_card_id);
    }
  }catch(e){
    console.warn('[tc] auto-erase exception', e, row);
  }
}


// ---- Supabase watcher -----------------------------------------------------

let channel = null;
let lastIds = new Set(); // ids already seen on opp table
let stopPoll = null;

async function getTableForSeat(gameId, seat){
  // use your helper (env.supabase.js) to read the seat doc
  if (!window.StorageAPI?.loadPlayerState) return [];
  const doc = await window.StorageAPI.loadPlayerState(gameId, seat); // returns .state (we want .table)
  const t = Array.isArray(doc?.table) ? doc.table : [];
  return t;
}

function diffAdded(prev = [], next = []){
  const prevIds = new Set(prev.map(c => String(c.id)));
  return next.filter(c => !prevIds.has(String(c.id)));
}

async function hasRecentCounter(gid, forSeat, cardId, windowMs = 30000){
  try{
    const { data } = await SB
      .from('table_counters')
      .select('status,created_at')
      .eq('game_id', gid)
      .eq('created_for_seat', forSeat)
      .eq('target_card_id', String(cardId))
      .in('status', ['declared','resolved','declined','expired'])
      .order('created_at', { ascending:false })
      .limit(1);
    if (!Array.isArray(data) || !data.length) return false;
    const when = Date.parse(data[0].created_at || 0) || 0;
    return (Date.now() - when) <= windowMs;
  }catch(e){
    console.warn('[tc] recent check failed', e);
    return false;
  }
}


// ---------------------------------------------------------
// counter writer (dual-write: self 'pending' + opponent 'declared')
// ---------------------------------------------------------
async function announceCounterRow(gameId, forSeat, bySeat, card){
  if (!SB) return;

  // compute opponent seat with a safe fallback (2-player default)
  const oppSeat =
    Number(window.AppState?.opponentSeat) ||
    (Number(forSeat) === 1 ? 2 : 1);

  const base = {
    game_id: String(gameId),
    created_by_seat: Number(bySeat),
    target_card_id: String(card?.id ?? ''),
    target_card_name: String(card?.name ?? card?._scry?.name ?? 'Card'),
    scryfall_id: card?._scry?.id ?? null,
    mana_cost: card?.mana_cost ?? card?._scry?.mana_cost ?? null,
    oracle_text: card?.oracle_text ?? card?._scry?.oracle_text ?? null,
    image_uri: (card?._scry?.image_uris?.art_crop
             || card?._scry?.image_uris?.border_crop
             || card?._scry?.image_uris?.normal || null),
    reason: 'spell_cast',
    timeout_ms: 5000,
    focus_freezes: true,
  };

  // 1) write/refresh *your* local row as PENDING (drives your countdown UI)
  const selfRow = {
    ...base,
    created_for_seat: Number(forSeat),
    status: 'pending',
  };

  let r1 = await SB.from('table_counters')
    .upsert(selfRow, { onConflict: 'game_id,created_for_seat,target_card_id' })
    .select()
    .single();

  if (r1.error){
    console.warn('[counter self write]', r1.error, selfRow);
  } else {
    console.log('[tc] counter self row written', r1.data);
  }

  // 2) insert a MIRROR row for the opponent as DECLARED (this triggers their watcher)
  const oppRow = {
    ...base,
    // important diffs:
    id: undefined, // let DB assign
    created_for_seat: oppSeat,
    status: 'declared',
    created_at: new Date().toISOString(), // helps poller watermarking
  };

  let r2 = await SB.from('table_counters')
    .insert(oppRow)
    .select()
    .single();

  if (r2.error){
    console.warn('[counter mirror write]', r2.error, oppRow);
  } else {
    console.log('[tc] counter mirror row written', r2.data);
  }
}



let countersChannel = null;

function startCounterResponsesWatcher(gid, mySeat){
  // clean previous
  if (countersChannel) { try { SB.removeChannel(countersChannel); } catch{} countersChannel = null; }

  const chan = SB.channel(`tc:${gid}:${mySeat}:${Date.now()}`)
  .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'table_counters',
      filter: `game_id=eq.${gid},created_for_seat=eq.${mySeat}`
    }, (payload)=>{
      console.log('[tc] change for seat', mySeat, payload);
      const row = payload?.new || payload?.old || {};


      const status = row?.status;
      if (status === 'declared'){ // show “your spell was countered”
        const who = Number(row.created_by_seat || 0);
const name = row.target_card_name || 'Your spell';
const msg  = `🛑 ${name} was countered by P${who || '?'}`;
console.log('[tc] DECLARED -> show toast', { mySeat, msg, row });
try { window.Notifications?.showText(msg, { autoHideMs: 2500, force: true }); } catch {}

      }
      // (Optionally handle 'pending' → small heads-up)
    })
    .subscribe();
	// ---- safety net poller (in case Realtime for table_counters is off) ----
let stop = false;
let lastSeenAt = 0;
(async function pollLoop(){
  await new Promise(r=>setTimeout(r, 1200));
  while(!stop){
    try{
      const { data, error } = await SB
        .from('table_counters')
        .select('*')
        .eq('game_id', gid)
        .eq('created_for_seat', mySeat)
        .gte('created_at', new Date(lastSeenAt || 0).toISOString())
        .order('created_at', { ascending: true })
        .limit(20);
      if (!error && Array.isArray(data) && data.length){
        for (const row of data){
          lastSeenAt = Math.max(lastSeenAt, Date.parse(row.created_at || 0) || 0);
          if (row.status === 'declared'){
  const who  = Number(row.created_by_seat || 0);
  const name = row.target_card_name || 'Your spell';
  try { window.Notifications?.showText(`🛑 ${name} was countered by P${who || '?'}`, { autoHideMs: 2500 }); } catch {}

  // after 2s, erase the row to end the notification lifecycle
  setTimeout(()=>{ eraseCounterRow(row); }, 200);
}

        }
      }
    }catch(e){ console.warn('[table_counters poll]', e); }
    await new Promise(r=>setTimeout(r, 1000));
  }
})();
chan._stopPoll = ()=>{ stop = true; };


  countersChannel = chan;
}


export function startTableWatcher(){
  const gid = getGameId();
  const me  = getMySeat();
  const opp = getOppSeat();
  if (!gid || !SB) { console.warn('[table_watcher] missing env'); return ()=>{}; }

  // clean any previous
  stopTableWatcher();
startCounterResponsesWatcher(gid, me);
  // bootstrap snapshot
  (async ()=>{
    try{
      const cur = await getTableForSeat(gid, opp);
      lastIds = new Set(cur.map(c => String(c.id)));
    }catch(e){ console.warn('[table_watcher init]', e); }
  })();

  // realtime channel: player_states for opp seat only
  const chanName = `table:${gid}:${opp}:${Date.now()}`;
  console.log('[table_watcher] start', { gid, me, opp });

  channel = SB.channel(chanName)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'player_states',
      filter: `game_id=eq.${gid},seat=eq.${opp}`
    }, async (payload)=>{
      const doc = payload?.new?.state || payload?.new || null;
      const next = Array.isArray(doc?.table) ? doc.table : [];
      // compute additions
      const added = diffAdded(Array.from(lastIds).map(id => ({ id })), next);
      // refresh lastIds to next
      lastIds = new Set(next.map(c => String(c.id)));
      if (!added.length) return;

      // take the newest (last pushed)
      const card = added[added.length - 1];

      // show overlay immediately
	  if (await hasRecentCounter(gid, me, card?.id)) {
  console.log('[tc] skip overlay; recent counter exists', { gid, seat: me, cardId: card?.id });
  return;
}

      showOverlay(card, {
        timeoutMs: 5000,
        onCounter: async ()=>{
          // mark declared + notify row for auditing
          await announceCounterRow(gid, me, opp, card);
          try {
            await SB.from('table_counters')
              .update({ status: 'declared', last_actor_seat: me, status_note: 'user pressed Counter', resolved_at: new Date().toISOString() })
              .eq('game_id', gid)
              .eq('created_for_seat', me)
              .eq('target_card_id', String(card?.id))
              .in('status', ['pending','focused']);
			  
			  // ➜ also insert a MIRROR row addressed to the opponent
    await SB.from('table_counters').insert({
      game_id: gid,
      created_for_seat: opp,        // opponent should see this
      created_by_seat: me,          // I’m the one who countered
      target_card_id: String(card?.id ?? ''),
      target_card_name: String(card?.name ?? card?._scry?.name ?? 'Card'),
      scryfall_id: card?._scry?.id ?? null,
      mana_cost: card?.mana_cost ?? card?._scry?.mana_cost ?? null,
      oracle_text: card?.oracle_text ?? card?._scry?.oracle_text ?? null,
      image_uri: (card?._scry?.image_uris?.art_crop
                || card?._scry?.image_uris?.border_crop
                || card?._scry?.image_uris?.normal || null),
      status: 'declared',           // already resolved as a “counter declared”
      reason: 'spell_cast',
      timeout_ms: 0,                // no countdown toast on their side
      focus_freezes: false,
      status_note: 'mirror: your spell was countered'
    });
  } catch(e){ console.warn('[table_watcher declare+mirror]', e); }
        },
        onDismiss: async ()=>{
          try {
            await SB.from('table_counters')
              .update({ status: 'declined', last_actor_seat: me, status_note: 'auto or user dismissed', resolved_at: new Date().toISOString() })
              .eq('game_id', gid)
              .eq('created_for_seat', me)
              .eq('target_card_id', String(card?.id))
              .in('status', ['pending','focused']);
          } catch(e){ console.warn('[table_watcher decline]', e); }
        }
      });
    })
    .subscribe((status) => {
      console.log('[table_watcher] channel', status, chanName);
    });

  // safety-net poller (like notifications.store)
  let stop = false; 
  stopPoll = async function(){
    stop = true;
  };
  (async function pollLoop(){
    await new Promise(r=>setTimeout(r, 1200));
    while(!stop){
      try{
        const next = await getTableForSeat(gid, opp);
        const added = diffAdded(Array.from(lastIds).map(id => ({ id })), next);
        lastIds = new Set(next.map(c => String(c.id)));
        if (added.length){
          const card = added[added.length - 1];
		  if (await hasRecentCounter(gid, me, card?.id)) {
  console.log('[tc] skip overlay; recent counter exists', { gid, seat: me, cardId: card?.id });
  return;
}

          showOverlay(card, {
            timeoutMs: 5000,
            onCounter: async ()=>{
              await announceCounterRow(gid, me, opp, card);
            }
          });
        }
      }catch(e){ console.warn('[table_watcher poll]', e); }
      await new Promise(r=>setTimeout(r, 1000));
    }
  })();

  // public stopper
  return stopTableWatcher;
}

export function stopTableWatcher(){
  if (stopPoll) { try { stopPoll(); } catch{}; stopPoll = null; }
  if (channel)  { try { window.supabase.removeChannel(channel); } catch{}; channel = null; }
  if (countersChannel) { try { window.supabase.removeChannel(countersChannel); } catch{}; countersChannel = null; }
  hideOverlay();
}


// expose for console while testing
window.startTableWatcher = startTableWatcher;
window.stopTableWatcher  = stopTableWatcher;
