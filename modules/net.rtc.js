// modules/net.rtc.js
// WebRTC datachannel using Supabase Realtime for signaling + presence.
// SOLO MODE fallback when Supabase is unavailable.

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

// Ensure Supabase is initialized (SOLO mode if missing)
async function getSupabaseClient() {
  try {
    if (window.SUPABASE_READY) {
      try {
        const c = await window.SUPABASE_READY;
        if (c) return c;
      } catch {}
    }
    const ok = await waitFor(() => !!window.SUPABASE, { timeout: 3000, label: 'window.SUPABASE' });
    if (ok) return window.SUPABASE || null;
  } catch {}
  warn('[RTC] Supabase unavailable → SOLO MODE');
  return null; // critical change (NO THROW)
}

/**
 * createPeerRoom
 * SOLO MODE RETURNS A NullPeer (no RTC, but app boots cleanly).
 */
export async function createPeerRoom({
  roomId,
  role,
  seat = 1,
  onMessage = () => {},
  onSeatConflict = () => {}
}) {
  if (!roomId || !role) throw new Error('createPeerRoom: missing roomId/role');

  const sb = await getSupabaseClient();

  // ===== SOLO MODE =====
  if (!sb) {
    warn('[RTC] Running in SOLO MODE (Supabase missing or blocked)');
    return {
      pc: null,
      get dc() { return null; },
      send: () => false,
      close: () => {},
      opened: Promise.resolve(), // instantly "connected"
      role,
      seat,
      isSolo: true,
      debug: { channelName: null },
      sendRngRoll() { return false; }
    };
  }

  // ===== NORMAL RTC MODE =====
  log('connecting realtime for room', roomId, 'as', role, 'seat', seat);

  // --- PeerConnection
  const pc = new RTCPeerConnection({ iceServers: STUN });
  let dc = null;
  let left = false;

  let channelReady = false;
  let presenceSeen = false;
  let remoteSeen   = false;

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
    pc.addEventListener('datachannel', (e) => {
      dc = e.channel;
      wireDC(dc, onMessage);
      log('ondatachannel:', dc.label);
      dc.addEventListener('open',  () => { log('dc open (join)');  mark(); });
      dc.addEventListener('close', () => log('dc close (join)'));
    });
  });

  let channel = null;

  pc.addEventListener('icecandidate', (e) => {
    if (!channelReady) return;
    if (e.candidate) {
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

  const chanName = `rtc_${roomId}`;
  channel = sb.channel(chanName, {
    config: {
      broadcast: { self: true },
      presence:  { key: `seat-${seat}` }
    }
  });

  channel.on('presence', { event: 'sync' }, () => {
    const states = channel.presenceState();
    const members = Object.values(states).flat();
    const seats = members.map((m) => m?.seat).filter(Boolean);
    presenceSeen = true;
    remoteSeen = members.some((m) => m?.seat !== seat);

    const sameSeatCount = seats.filter((s) => s === seat).length;
    const seatOk = sameSeatCount <= 1;
    log('presence sync', { members: members.length, seats, seatOk, remoteSeen });

    if (!seatOk && onSeatConflict) {
      const taken = new Set(seats);
      const options = [1, 2, 3].filter((s) => !taken.has(s));
      onSeatConflict({ seatTaken: seat, options });
    }
  });

  channel.on('broadcast', { event: 'sig' }, async ({ payload }) => {
    if (!payload || payload.seat === seat) return;
    try {
      if (payload.t === 'offer') {
        log('← offer from seat', payload.seat);
        await pc.setRemoteDescription(payload.sdp);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        channel.send({ type: 'broadcast', event: 'sig', payload: { t: 'answer', seat, role, sdp: ans } });
      } else if (payload.t === 'answer') {
        if (pc.signalingState !== 'stable') {
          try { await pc.setRemoteDescription(payload.sdp); } catch (e) { warn('remote desc fail', e); }
        }
      } else if (payload.t === 'ice') {
        try { await pc.addIceCandidate(payload.c); } catch {}
      }
    } catch (e) {
      warn('signal handling error', e);
    }
  });

  log('connecting realtime channel:', chanName);
  await channel.subscribe(async (status) => {
    log('channel status =', status);
    if (status === 'SUBSCRIBED') {
      channelReady = true;
      try { await channel.track({ seat, role, ts: Date.now() }); } catch {}

      if (role === 'host') {
        dc = pc.createDataChannel('game', { ordered: true });
        wireDC(dc, onMessage);
        dc.addEventListener('open',  () => log('dc open (host)'));
        dc.addEventListener('close', () => log('dc close (host)'));

        await wait(60);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        channel.send({ type: 'broadcast', event: 'sig', payload: { t: 'offer', seat, role, sdp: offer } });
      }
    }
  });

  await waitFor(() => channelReady, { timeout: 5000, label: 'realtime subscribe' });
  await waitFor(() => presenceSeen,  { timeout: 5000, label: 'presence sync' });

  setTimeout(() => {
    if (!remoteSeen) warn('No remote presence detected yet.');
  }, 5000);

  setTimeout(async () => {
    if (left) return;
    if (pc.connectionState === 'connected') return;
    if (role === 'host') {
      try {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        channel.send({ type: 'broadcast', event: 'sig', payload: { t: 'offer', seat, role, sdp: offer } });
      } catch (e) { warn('re-offer failed', e); }
    }
  }, 12000);

  function send(obj) {
    if (!dc || dc.readyState !== 'open') return false;
    try { dc.send(JSON.stringify(obj)); return true; }
    catch { return false; }
  }

  async function close() {
    left = true;
    try { await channel.unsubscribe(); } catch {}
    try { dc && dc.close(); } catch {}
    try { pc.close(); } catch {}
  }

  return {
    pc,
    get dc() { return dc; },
    send,
    close,
    opened,
    role,
    seat,
    debug: { channelName: chanName },
    sendRngRoll(payload) { return send(payload); }
  };
}

function getMirrorAxisY(){
  const css = getComputedStyle(document.documentElement);
  return parseFloat(css.getPropertyValue('--combat-height')) || 300;
}
function getCardHeightWorldFromCssVar(){
  const css = getComputedStyle(document.document.documentElement);
  const v = parseFloat(css.getPropertyValue('--card-height-table'));
  return Number.isFinite(v) ? v : 180;
}
function mirrorTopB(y, h){
  const A = getMirrorAxisY();
  return (A * 2) - (y + h);
}

function wireDC(dc, onMessage) {
  dc.addEventListener('message', (e) => {
    let msg = null;
    try { msg = JSON.parse(e.data); } catch {}
    if (!msg) return;
    onMessage(msg);
  });
  dc.addEventListener('error', (e) => console.warn('[RTC/DC] error', e));
  dc.addEventListener('close', () => console.log('[RTC/DC] closed'));
}
