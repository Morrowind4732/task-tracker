// ================================
// FILE: modules/notifications.store.js
// ================================
 function getSB(){
   const sb = (typeof window !== 'undefined') ? window.supabase : null;
   if (!sb) console.warn('[notifications.store] window.supabase missing (yet?)');
   return sb;
}

function nowTs() { return Date.now(); }

export const NotificationsStore = {
  // insert a row into public.notifications
  async push({ gameId, type, seat = null, turnIndex = null, payload = {} } = {}){
    const SB = getSB(); if (!SB) throw new Error('Supabase client missing');
    const row = {
      game_id: String(gameId || ''),
      type: String(type || ''),
      seat: (seat == null ? null : Number(seat)),
      turn_index: (turnIndex == null ? null : Number(turnIndex)),
      payload: payload || {},
      created_at: new Date().toISOString(),
    };
    const { error } = await SB.from('notifications').insert(row);
    if (error) throw error;
    return row;
  },

  // subscribe to inserts for a game
  onGameEvents(gameId, handler){
  const SB = getSB(); if (!SB) { console.warn('[notif] no supabase'); return { unsubscribe(){} }; }
  const gid = String(gameId || '');
  const chanName = `notif:${gid}:${nowTs()}`;

  // 1) Channel subscription with loud status logs
  const channel = SB.channel(chanName)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `game_id=eq.${gid}`
    }, payload => {
      const row = payload?.new || {};
      console.log('[notif] realtime INSERT', row);
      try { handler && handler(row); } catch (e){ console.error('[notifications.store] handler error', e); }
    })
    .subscribe((status) => {
      console.log('[notif] channel status', status, 'for', chanName);
    });

  // 2) Safety net poller (helps during setup or if Realtime is disabled)
  let stop = false, lastId = 0;
  (async function pollLoop(){
    // wait a moment to avoid double-firing when realtime is healthy
    await new Promise(r=>setTimeout(r, 1200));
    while(!stop){
      try{
        const { data, error } = await SB
          .from('notifications')
          .select('*')
          .eq('game_id', gid)
          .gt('id', lastId)
          .order('id', { ascending: true })
          .limit(50);
        if (!error && Array.isArray(data) && data.length){
          for (const row of data){ lastId = Math.max(lastId, Number(row.id)||0); console.log('[notif] poll INSERT', row); handler && handler(row); }
        }
      }catch(e){ console.warn('[notif] poll error', e); }
      await new Promise(r=>setTimeout(r, 1000));
    }
  })();

  return {
    unsubscribe(){
      stop = true;
      try { SB.removeChannel(channel); } catch{}
    }
  };
},


  // optional: upsert meta turn + combat flag
  async setMeta(gameId, { turnIndex, combatState } = {}){
    const SB = getSB(); if (!SB) throw new Error('Supabase client missing');
    const patch = { updated_at: new Date().toISOString() };
    if (Number.isFinite(turnIndex)) patch.turn_index = Number(turnIndex);
    if (typeof combatState === 'string') patch.combat_state = combatState;

    const { error } = await SB
      .from('meta_notifications')
      .upsert({ game_id: String(gameId), ...patch })
      .select()
      .single();

    if (error) throw error;
  }
};

function showCombatInitiated(row){
  const seat = Number(row.seat || row.payload?.seat || 0);
  const who  = seat ? `P${seat}` : 'Attacker';
  // Reuse your big toast/banner API
  if (typeof window.Notifications?.showText === 'function') {
    window.Notifications.showText(`⚔️ Combat Initiated — ${who}`);
  } else if (typeof window.showToast === 'function') {
    window.showToast(`⚔️ Combat Initiated — ${who}`);
  } else {
    console.log('[notif] ⚔️ Combat Initiated —', who);
  }
}


export default NotificationsStore;
