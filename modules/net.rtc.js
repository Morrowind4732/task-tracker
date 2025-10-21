// modules/net.rtc.js
// WebRTC datachannel using Supabase Realtime for signaling + presence.
// Super chatty logs so we can see *exactly* where it stalls.
// Now waits for window.SUPABASE_READY (from env.supabase.js) so we never race.

const TAG = '[RTC]';
const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log  = (...a) => console.log(TAG, ...a);
const warn = (...a) => console.warn(TAG, ...a);
const err  = (...a) => console.error(TAG, ...a);

// Utility: wait for condition with timeout (for diagnostics)
async function waitFor(okFn, { timeout = 8000, label = 'cond' } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (okFn()) return true; } catch {}
    await wait(50);
  }
  warn('timeout waiting for', label);
  return false;
}

// Ensure Supabase is initialized (uses window.SUPABASE_READY if present)
async function getSupabaseClient() {
  // Prefer the promise exposed by env.supabase.js
  if (window.SUPABASE_READY) {
    try {
      const c = await window.SUPABASE_READY;
      if (c) return c;
    } catch (e) {
      throw new Error('Supabase init failed (from SUPABASE_READY): ' + (e?.message || e));
    }
  }
  // Fallback: poll for window.SUPABASE
  const ok = await waitFor(() => !!window.SUPABASE, { timeout: 6000, label: 'window.SUPABASE' });
  if (!ok) {
    throw new Error('Supabase env not loaded (window.SUPABASE missing). Did env.supabase.js run?');
  }
  return window.SUPABASE;
}

/**
 * createPeerRoom
 * @param {object} opts
 *  - roomId   (string)  channel name suffix
 *  - role     ('host'|'join')
 *  - seat     (1..3)
 *  - onMessage(fn)
 *  - onSeatConflict(fn)
 */
export async function createPeerRoom({
  roomId,
  role,          // 'host' | 'join'
  seat = 1,
  onMessage = () => {},
  onSeatConflict = () => {}
}) {
  if (!roomId || !role) throw new Error('createPeerRoom: missing roomId/role');

  const sb = await getSupabaseClient();
  log('connecting realtime for room', roomId, 'as', role, 'seat', seat);

  // --- PeerConnection
  const pc = new RTCPeerConnection({ iceServers: STUN });
  let dc = null;
  let left = false;

  // visible flags
  let channelReady = false;
  let presenceSeen = false;
  let remoteSeen   = false;

  // useful promise: resolves when DC is open or pc is connected.
  const opened = new Promise((resolve) => {
    const mark = () => {
      if (dc?.readyState === 'open' || pc.connectionState === 'connected') {
        log('✔ link live (dc or pc connected)');
        resolve();
      }
    };
    pc.addEventListener('connectionstatechange', () => {
      log('pc.connectionState =', pc.connectionState);
      if (pc.connectionState === 'connected') mark();
      if (pc.connectionState === 'failed') warn('pc failed (likely ICE)');
    });
    // joiner receives datachannel
    pc.addEventListener('datachannel', (e) => {
      dc = e.channel;
      wireDC(dc, onMessage);
      log('ondatachannel:', dc.label);
      dc.addEventListener('open',  () => { log('dc open (join)');  mark(); });
      dc.addEventListener('close', () =>  log('dc close (join)'));
    });
  });

  // For ICE, we need channel reference; we’ll assign after subscribe.
  let channel = null;

  pc.addEventListener('icecandidate', (e) => {
    if (!channelReady) return;
    if (e.candidate) {
      log('local ICE → broadcast');
      channel.send({
        type: 'broadcast',
        event: 'sig',
        payload: { t: 'ice', seat, role, c: e.candidate }
      });
    }
  });
  pc.addEventListener('iceconnectionstatechange', () => {
    log('iceConnectionState =', pc.iceConnectionState);
  });

  // --- Realtime channel (signaling + presence)
  const chanName = `rtc_${roomId}`;
  channel = sb.channel(chanName, {
    config: {
      broadcast: { self: true },          // we see our own (for debug)
      presence:  { key: `seat-${seat}` }  // presence key shows seat id
    }
  });

  // presence sync → detect conflicts + remote presence
  channel.on('presence', { event: 'sync' }, () => {
    const states = channel.presenceState(); // {socket_id:[{presence_ref, ...tracked}]}
    const members = Object.values(states).flat();
    const seats = members.map((m) => m?.seat).filter(Boolean);
    presenceSeen = true;

    // remote present?
    remoteSeen = members.some((m) => m?.seat !== seat);

    // seat conflict?
    const sameSeatCount = seats.filter((s) => s === seat).length;
    const seatOk = sameSeatCount <= 1;
    log('presence sync', { members: members.length, seats, seatOk, remoteSeen });

    if (!seatOk && onSeatConflict) {
      const taken = new Set(seats);
      const options = [1, 2, 3].filter((s) => !taken.has(s));
      onSeatConflict({ seatTaken: seat, options });
    }
  });

  // signaling receiver
  channel.on('broadcast', { event: 'sig' }, async ({ payload }) => {
    if (!payload) return;
    if (payload.seat === seat) return; // ignore self-echo

    try {
      if (payload.t === 'offer') {
        log('← offer from seat', payload.seat);
        await pc.setRemoteDescription(payload.sdp);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        log('→ answer');
        channel.send({ type: 'broadcast', event: 'sig', payload: { t: 'answer', seat, role, sdp: ans } });

      } else if (payload.t === 'answer') {
        log('← answer from seat', payload.seat);
        if (pc.signalingState !== 'stable') {
          try { await pc.setRemoteDescription(payload.sdp); } catch (e) { warn('setRemoteDescription(answer) failed', e); }
        }

      } else if (payload.t === 'ice') {
        try { await pc.addIceCandidate(payload.c); } catch { /* likely dupes */ }
      }
    } catch (e) {
      warn('signal handling error', e);
    }
  });

  // subscribe + presence track
  log('connecting realtime channel:', chanName);
  await channel.subscribe(async (status) => {
    log('channel status =', status);
    if (status === 'SUBSCRIBED') {
      channelReady = true;

      // announce our seat/role in presence
      try {
        await channel.track({ seat, role, ts: Date.now() });
        log('presence track sent', { seat, role });
      } catch (e) {
        warn('presence track failed', e);
      }

      // host: create DC + send initial offer
      if (role === 'host') {
        dc = pc.createDataChannel('game', { ordered: true });
        wireDC(dc, onMessage);
        dc.addEventListener('open',  () => log('dc open (host)'));
        dc.addEventListener('close', () => log('dc close (host)'));

        // small delay gives presence a moment to sync on cold start
        await wait(60);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        log('→ offer broadcast');
        channel.send({ type: 'broadcast', event: 'sig', payload: { t: 'offer', seat, role, sdp: offer } });
      } else {
        log('joiner awaiting offer…');
      }
    }
  });

  // 🔎 Diagnostics: timeouts that explain what didn’t happen
  // 1) Did realtime subscription/presence happen?
  await waitFor(() => channelReady, { timeout: 5000, label: 'realtime subscribe' });
  await waitFor(() => presenceSeen,  { timeout: 5000, label: 'presence sync' });

  // 2) If we never see a remote, we’ll say so (helps when two tabs used wrong room).
  setTimeout(() => {
    if (!remoteSeen) warn('No remote presence detected yet — double-check both sides used the SAME roomId and one is Host, the other Join.');
  }, 5000);

  // 3) If we’re still not connected after 12s, the host forces a re-offer (iceRestart)
  setTimeout(async () => {
    if (left) return;
    if (pc.connectionState === 'connected') return;
    if (role === 'host') {
      try {
        log('still not connected → re-offer (iceRestart)');
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        channel.send({ type: 'broadcast', event: 'sig', payload: { t: 'offer', seat, role, sdp: offer } });
      } catch (e) { warn('re-offer failed', e); }
    }
  }, 12000);

  // public API
  function send(obj) {
    if (!dc || dc.readyState !== 'open') {
      warn('send() dropped (dc not open)', obj?.type);
      return false;
    }
    try { dc.send(JSON.stringify(obj)); return true; }
    catch (e) { warn('send() error', e); return false; }
  }

  async function close() {
    left = true;
    try { await channel.unsubscribe(); } catch {}
    try { dc && dc.close(); } catch {}
    try { pc.close(); } catch {}
  }

  // Make life easier for the table page debugger
  return {
    pc,
    get dc() { return dc; },
    send,
    close,
    opened,       // Promise resolves when link is live
    role,
    seat,
    debug: { channelName: chanName },

  // NEW: sugar for RNG broadcasts
  sendRngRoll(payload) { return send(payload); }
  };
}

// ---- internal: datastream handlers
function wireDC(dc, onMessage) {
  dc.addEventListener('message', (e) => {
    let msg = null;
    try { msg = JSON.parse(e.data); } catch {}
    if (!msg) return;

    // Pass to app-level handler (unchanged)
    onMessage(msg);
if (msg.type === 'spawn_table_card') {
  // normalize old payload → new spawn
  const c = msg.card || {};
  msg = {
    type: 'spawn',
    owner: Number(msg.seat || msg.owner || 1),
    cid: msg.cid,
    name: c.name || '',
    img:  c.img  || c.image || (c.image_uris?.normal) || '',
    type_line:   c.type_line   || '',
    mana_cost:   c.mana_cost   || '',
    oracle_text: c.oracle_text || '',
    x: msg.x ?? 0, y: msg.y ?? 0
  };
}

    // NEW: RNG packets also emit a global event for overlay modules
    if (msg.type === 'rng_roll') {
      try {
        window.dispatchEvent(new CustomEvent('versus-dice:show', { detail: msg }));
      } catch {}
    }

    // NEW: Opponent hand count → broadcast DOM event so table can update the backs fan
    if (msg.type === 'hand:count') {
      try {
        window.dispatchEvent(new CustomEvent('opponent-hand:count', { detail: msg }));
      } catch {}
    }

    // NEW: Dedicated delete event (pure visual destroy; no zone writes)
    if (msg.type === 'card:delete') {
  const cid = msg.cid;
  if (!cid) return;
  try { window.Stacking?.detach?.(document.querySelector(`.card[data-cid="${CSS.escape(cid)}"]`)); } catch{}
  try { window.Zones?.cfg?.removeTableCardDomById?.(cid); } catch{}
  try {
    const el = document.querySelector(`.card[data-cid="${CSS.escape(cid)}"]`);
    el?.remove?.();
  } catch {}
}

    // NEW: Spawn event for repaired cards (delete → respawn → hydrate)
    if (msg.type === 'spawn') {
      const cid = msg.cid;
      if (!cid) return;

      // 1) Remove stale DOM
      try { window.Stacking?.detach?.(document.querySelector(`.card[data-cid="${CSS.escape(cid)}"]`)); } catch{}
      try { window.Zones?.cfg?.removeTableCardDomById?.(cid); } catch{}
      try {
        document.querySelectorAll(`.card[data-cid="${CSS.escape(cid)}"]`).forEach(n => n.remove());
      } catch {}

      // 2) Spawn new card at exact x,y
      let el = null;
      const cardObj = {
        name: msg.name || '',
        img:  msg.img  || '',
        type_line:   msg.type_line   || '',
        mana_cost:   msg.mana_cost   || '',
        oracle_text: msg.oracle_text || '',
        ogpower:     msg.ogpower,
        ogtoughness: msg.ogtoughness,
        ogTypes:     msg.ogTypes || [],
        ogEffects:   msg.ogEffects || [],
        power:'', toughness:'', loyalty:''
      };

      if (typeof window.spawnTableCard === 'function') {
        el = window.spawnTableCard(cardObj, msg.x, msg.y, { cid: msg.cid, owner: msg.owner });
      } else if (typeof window.Zones?.spawnToTable === 'function') {
        Zones.spawnToTable({ ...cardObj, cid: msg.cid }, msg.owner);
        el = document.querySelector(`.card[data-cid="${CSS.escape(cid)}"]`);
        if (el){
          el.style.left = `${msg.x}px`;
          el.style.top  = `${msg.y}px`;
        }
      }

      // 3) Hydrate + badges + tooltip
      requestAnimationFrame(() => {
        const node = document.querySelector(`.card[data-cid="${CSS.escape(cid)}"]`);
        if (node) {
          try {
            window.CardAttributes?.applyToDom?.(cid);
            window.CardAttributes?.refreshPT?.(cid);
            window.attachTooltip?.(node, {
  name: msg.name || '',
  typeLine: msg.type_line || '',
  costHTML: '',
  oracle: msg.oracle_text || ''
});

            window.reflowAll?.();
          } catch (e) {
            console.warn('spawn hydration failed', e);
          }
        }
      });

      return;
    }


  });
  dc.addEventListener('error', (e) => console.warn('[RTC/DC] error', e));
  dc.addEventListener('close', () => console.log('[RTC/DC] closed'));
}


