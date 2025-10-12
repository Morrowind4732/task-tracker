// modules/save.snap.js
// Depends on window.SUPABASE and window.GameIO (collectState/applyState)

const TABLE = 'game_saves';

function sb() {
  if (!window?.SUPABASE) throw new Error('Supabase env not loaded');
  return window.SUPABASE;
}

/**
 * Save current local state into Supabase.
 * @param {Object} opts
 * @param {string} opts.roomId
 * @param {number} opts.bySeat
 * @returns {Promise<{id:string, room_id:string, by_seat:number, created_at:string}>}
 */
export async function saveSnapshot({ roomId, bySeat }){
  const state = window.GameIO?.collectState?.();
  if (!state) throw new Error('GameIO.collectState not available');
  const { data, error } = await sb()
    .from(TABLE)
    .insert([{ room_id: roomId, by_seat: bySeat, state }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * List latest N snapshots for room (all seats).
 */
export async function listSnapshots({ roomId, limit = 20 }){
  const { data, error } = await sb()
    .from(TABLE)
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending:false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/**
 * Get the latest snapshot for a specific seat within a room.
 */
export async function getLatestSnapshotForSeat({ roomId, seat }){
  const { data, error } = await sb()
    .from(TABLE)
    .select('*')
    .eq('room_id', roomId)
    .eq('by_seat', seat)
    .order('created_at', { ascending:false })
    .limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

/**
 * Load a snapshot by id and apply locally.
 */
export async function loadSnapshot({ id }){
  const { data, error } = await sb().from(TABLE).select('*').eq('id', id).single();
  if (error) throw error;
  const state = data?.state;
  if (!state) throw new Error('No state in snapshot');
  window.GameIO?.applyState?.(state);
  return data;
}
