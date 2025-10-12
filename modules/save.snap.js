// modules/save.snap.js
// Minimal Save/Restore to Supabase table `game_saves` (jsonb).
// Columns: id (uuid, default gen), room_id text, created_at timestamptz default now(),
//          by_seat int, state jsonb
//
// Requires: window.supabase AND window.GameIO { collectState(), applyState(state) }

export async function saveSnapshot({ roomId, bySeat }) {
  if (!window.supabase) throw new Error('Supabase missing');
  if (!window.GameIO?.collectState) throw new Error('GameIO.collectState missing');
  const sb = window.supabase;

  const state = window.GameIO.collectState();
  const { data, error } = await sb.from('game_saves').insert({
    room_id: roomId,
    by_seat: bySeat,
    state
  }).select('id, created_at').single();

  if (error) throw error;
  return data; // { id, created_at }
}

export async function listSnapshots({ roomId, limit = 10 }) {
  if (!window.supabase) throw new Error('Supabase missing');
  const sb = window.supabase;
  const { data, error } = await sb
    .from('game_saves')
    .select('id, created_at, by_seat')
    .eq('room_id', roomId)
    .order('created_at', { ascending:false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function loadSnapshot({ id }) {
  if (!window.supabase) throw new Error('Supabase missing');
  if (!window.GameIO?.applyState) throw new Error('GameIO.applyState missing');
  const sb = window.supabase;
  const { data, error } = await sb
    .from('game_saves')
    .select('state')
    .eq('id', id).single();
  if (error) throw error;

  window.GameIO.applyState(data.state);
  return true;
}
