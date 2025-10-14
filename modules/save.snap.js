// modules/save.snap.js
// Works with either window.SUPABASE or window.supabase.
// Waits for client readiness before every call to avoid "not ready" races.

const TABLE_MANUAL = 'game_saves';
const TABLE_AUTO   = 'game_autosaves';
const TABLE_SLOTS  = 'game_save_slots';

// Wait up to 3s for global client to exist.
async function needSB(timeoutMs = 3000){
  let c = (typeof window !== 'undefined') && (window.SUPABASE || window.supabase);
  if (c) return c;
  const t0 = Date.now();
  while (!c && (Date.now() - t0) < timeoutMs){
    await new Promise(r => setTimeout(r, 50));
    c = (typeof window !== 'undefined') && (window.SUPABASE || window.supabase);
  }
  if (!c) throw new Error('[save.snap] supabase not ready');
  return c;
}

function nowIso(d=new Date()){ return d.toISOString(); }

function collectOrThrow(){
  const state = window.GameIO?.collectState?.();
  if (!state) throw new Error('GameIO.collectState not available');
  return state;
}

function _zoneSummary(zones){
  try{
    const out = {};
    for (const [seat, st] of Object.entries(zones || {})){
      out[seat] = {
        gy: Array.isArray(st?.graveyard) ? st.graveyard.length : 0,
        ex: Array.isArray(st?.exile)     ? st.exile.length     : 0,
        tb: Array.isArray(st?.table)     ? st.table.length     : 0,
        hd: Array.isArray(st?.hand)      ? st.hand.length      : 0,
        dk: Array.isArray(st?.deck)      ? st.deck.length      : 0,
      };
    }
    return out;
  }catch{return {};}
}


/* ============================================================================
   MANUAL SNAPSHOTS
============================================================================ */

export async function saveSnapshot({ roomId, bySeat }){
  const sb = await needSB();
  const state = collectOrThrow();
  console.debug('[manual save] zones:', _zoneSummary(state.zones || {}));

  const { data, error } = await sb
    .from(TABLE_MANUAL)
    .insert([{ room_id: roomId, by_seat: bySeat, state }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listSnapshots({ roomId, limit = 20 }){
  const sb = await needSB();
  const { data, error } = await sb
    .from(TABLE_MANUAL)
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending:false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getLatestSnapshotForSeat({ roomId, seat }){
  const sb = await needSB();
  const { data, error } = await sb
    .from(TABLE_MANUAL)
    .select('*')
    .eq('room_id', roomId)
    .eq('by_seat', seat)
    .order('created_at', { ascending:false })
    .limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

export async function loadSnapshot({ id }){
  const sb = await needSB();
  const { data, error } = await sb.from(TABLE_MANUAL).select('*').eq('id', id).single();
  if (error) throw error;
  const state = data?.state;
  if (!state) throw new Error('No state in snapshot');
  window.GameIO?.applyState?.(state);
  return data;
}

/* ============================================================================
   AUTOSAVES (every 60s; prune to last ~3 minutes)
============================================================================ */

export async function saveAutoSnapshot({ roomId, bySeat }){
  const sb = await needSB();
  const state = collectOrThrow();
  console.debug('[autosave] zones:', _zoneSummary(state.zones || {}));

  const { data, error } = await sb
    .from(TABLE_AUTO)
    .insert([{ room_id: roomId, by_seat: bySeat, state }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listAutoSaves({ roomId, bySeat, limit = 10 }){
  const sb = await needSB();
  const { data, error } = await sb
    .from(TABLE_AUTO)
    .select('*')
    .eq('room_id', roomId)
    .eq('by_seat', bySeat)
    .order('created_at', { ascending:false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function pruneAutoSaves({ roomId, bySeat, maxAgeMs = 3*60*1000 }){
  const sb = await needSB();
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const { error } = await sb
    .from(TABLE_AUTO)
    .delete()
    .lt('created_at', cutoff)
    .eq('room_id', roomId)
    .eq('by_seat', bySeat);
  if (error) console.warn('[autosave] prune failed', error);
}

export async function loadAutoSnapshot({ id }){
  const sb = await needSB();
  const { data, error } = await sb.from(TABLE_AUTO).select('*').eq('id', id).single();
  if (error) throw error;
  const state = data?.state;
  if (!state) throw new Error('No state in autosave');
  window.GameIO?.applyState?.(state);
  return data;
}

/* ============================================================================
   THREE MANUAL SLOTS (per room)
============================================================================ */

export async function getSlots({ roomId }){
  try{
    const sb = await needSB();
    const { data, error } = await sb
      .from(TABLE_SLOTS)
      .select('*')
      .eq('room_id', roomId)
      .order('slot', { ascending: true });
    if (error) throw error;
    return data || [];
  }catch(e){
    // If table doesn't exist, log once and return []
    console.warn('[slots] fetch failed (table missing?)', e);
    return [];
  }
}

export async function saveToSlot({ roomId, bySeat, slot }){
  const sb = await needSB();
  slot = Number(slot);
  if (![1,2,3].includes(slot)) throw new Error('slot must be 1..3');

  // Save to manual table
  const snap = await saveSnapshot({ roomId, bySeat });

  // Upsert slot pointer
  try{
    const up = {
      room_id: roomId,
      slot,
      snapshot_id: snap.id,
      by_seat: bySeat,
      updated_at: nowIso()
    };
    const { error } = await sb
      .from(TABLE_SLOTS)
      .upsert(up, { onConflict: 'room_id,slot' });
    if (error) throw error;
  }catch(e){
    console.warn('[slots] upsert failed (table missing?)', e);
  }
  return snap;
}

export async function loadSlot({ roomId, slot }){
  const slots = await getSlots({ roomId });
  const rec = slots.find(s => s.slot === Number(slot));
  if (!rec) throw new Error('empty slot');
  return loadSnapshot({ id: rec.snapshot_id });
}

