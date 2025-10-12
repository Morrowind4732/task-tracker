// modules/net.rtc.js
// WebRTC datachannel with Supabase Realtime signaling
// Requires window.SUPABASE (from your env.supabase.js)

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

function log(...a){ console.log('[RTC]', ...a); }

export async function createPeerRoom({
  roomId,
  role,          // 'host' | 'join'
  seat = 1,
  onMessage = () => {},
  onSeatConflict = () => {}
}){
  // accept either global
  const sb = window.SUPABASE || window.supabase;
  if (!sb) throw new Error('Supabase env not loaded');

  const chanName = `rtc_${roomId}`;
  const pc = new RTCPeerConnection({ iceServers: STUN });

  let dc = null;
  let didOpenDC = false;
  let left = false;

  function log(...a){ console.log('[RTC]', ...a); }

  // ---- promise that resolves when DC is open
  const opened = new Promise((res) => {
    const ok = () => { if (!didOpenDC){ didOpenDC = true; res(); log('DATACHANNEL OPEN'); } };
    pc.addEventListener('connectionstatechange', () => {
      log('pc state =', pc.connectionState);
      if (pc.connectionState === 'connected') ok();
    });
    pc.addEventListener('datachannel', (e) => {
      dc = e.channel;
      wireDC(dc, onMessage);
      dc.addEventListener('open', ok, { once: true });
    });
  });

  // ---- create channel
  const channel = sb.channel(chanName, { config: { broadcast: { self: true } } });

  // small helper: wait until SUBSCRIBED
  const waitSubscribed = new Promise((resolve) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        log('subscribed realtime channel', roomId);
        channel.track({ seat, role }).catch(()=>{});
        resolve();
      }
    });
  });

  // don’t send anything before this
  await waitSubscribed;

  // ---- presence: detect seat conflicts and trigger re-offer when second seat appears
  let seatOk = true;
  channel.on('presence', { event: 'sync' }, async () => {
    const states = channel.presenceState();         // { uuid: [{seat,role}], ... }
    const seats  = Object.values(states).map(a => a?.[0]?.seat).filter(Boolean);

    // conflict if this seat appears >1 times
    const dupCount = seats.filter(s => s === seat).length;
    seatOk = dupCount <= 1;
    log('presence synced ', { room: roomId, seat, seatOk });

    if (!seatOk && onSeatConflict){
      const taken = new Set(seats);
      const options = [1,2,3].filter(s => !taken.has(s));
      onSeatConflict({ seatTaken: seat, options });
    }

    // If we’re host and there is at least one other seat present, (re)offer immediately.
    if (role === 'host' && seats.some(s => s !== seat)) {
      try {
        const offer = await pc.createOffer({ iceRestart: pc.iceConnectionState !== 'connected' });
        await pc.setLocalDescription(offer);
        log('send offer (presence)');
        channel.send({ type: 'broadcast', event: 'sig', payload:{ t:'offer', seat, role, sdp: offer }});
      } catch (e) { /* ignore */ }
    }
  });

  // ---- ICE after we are subscribed
  pc.addEventListener('icecandidate', (e)=>{
    if (e.candidate) {
      log('local ICE → send');
      channel.send({ type: 'broadcast', event: 'sig', payload: { t:'ice', seat, role, c: e.candidate }});
    }
  });
  pc.addEventListener('iceconnectionstatechange', ()=> log('ice state =', pc.iceConnectionState));

  // ---- signaling receive (after subscribe)
  channel.on('broadcast', { event:'sig' }, async ({ payload })=>{
    try{
      if (!payload) return;
      const fromSeat = payload.seat;
      if (fromSeat === seat) return; // ignore self echoes

      if (payload.t === 'offer'){
        log('recv offer from seat', fromSeat);
        await pc.setRemoteDescription(payload.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        channel.send({ type:'broadcast', event:'sig', payload:{ t:'answer', seat, role, sdp: answer }});

      } else if (payload.t === 'answer'){
        log('recv answer from seat', fromSeat);
        if (pc.signalingState !== 'stable'){
          await pc.setRemoteDescription(payload.sdp).catch(()=>{});
        }

      } else if (payload.t === 'ice'){
        try{ await pc.addIceCandidate(payload.c); }catch{/* dupes */}
      }
    }catch(err){ console.warn('[RTC] signal error', err); }
  });

  // ---- Host vs Join
  if (role === 'host'){
    // host creates DC only after subscribed (important on Safari)
    dc = pc.createDataChannel('game', { ordered:true });
    wireDC(dc, onMessage);
    dc.addEventListener('open', () => log('dc open (host)'));
    dc.addEventListener('close', () => log('dc close (host)'));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log('send offer');
    channel.send({ type: 'broadcast', event:'sig', payload:{ t:'offer', seat, role, sdp: offer }});

  } else {
    log('joiner waiting for offer…');
    // ondatachannel will fire when offer/answer completes
  }

  // backup: timed re-offer if still not connected
  setTimeout(async ()=>{
    if (left) return;
    if (pc.connectionState === 'connected' || pc.signalingState !== 'stable') return;
    if (role === 'host'){
      try{
        const offer = await pc.createOffer({ iceRestart:true });
        await pc.setLocalDescription(offer);
        log('send offer (timer)');
        channel.send({ type:'broadcast', event:'sig', payload:{ t:'offer', seat, role, sdp: offer }});
      }catch{}
    }
  }, 7000);

  function send(obj){
    if (!dc || dc.readyState !== 'open') return false;
    try{ dc.send(JSON.stringify(obj)); return true; }catch{ return false; }
  }
  async function close(){
    left = true;
    try{ channel.unsubscribe(); }catch{}
    try{ dc && dc.close(); }catch{}
    try{ pc.close(); }catch{}
  }

  return { send, close, opened, role, seat };
}


// ---- internal: wire incoming messages
function wireDC(dc, onMessage){
  dc.addEventListener('message', (e)=>{
    let msg = null;
    try{ msg = JSON.parse(e.data); }catch{}
    if (msg) onMessage(msg);
  });
  dc.addEventListener('error', (e)=> console.warn('[RTC] dc error', e));
  dc.addEventListener('close', ()=> console.log('[RTC] DATACHANNEL CLOSED'));
}
