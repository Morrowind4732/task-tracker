import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://uvrnxrmwoyhswzldhcul.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_giCNdyuF32ZkCyaob2L4kQ_xIYBJ_L3';

let supabaseClient = null;

export function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: {
        params: { eventsPerSecond: 25 }
      }
    });
  }
  return supabaseClient;
}

export function getOrCreatePlayerId() {
  const key = 'fancy-card-table-player-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}



export const GAME_SAVE_TABLE = 'fct_game_saves';

export function normalizeSaveLobbyName(lobbyName = '') {
  return String(lobbyName || 'debug-table').trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').slice(0, 80) || 'debug-table';
}

export async function loadGameSave(lobbyName) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured, so saved games cannot be loaded.');
  const safeLobby = normalizeSaveLobbyName(lobbyName);
  const { data, error } = await supabase
    .from(GAME_SAVE_TABLE)
    .select('lobby_name, mode, save_data, updated_at, created_at')
    .eq('lobby_name', safeLobby)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function saveGameState(lobbyName, mode, saveData) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured, so saved games cannot be saved.');
  const safeLobby = normalizeSaveLobbyName(lobbyName);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(GAME_SAVE_TABLE)
    .upsert({
      lobby_name: safeLobby,
      mode: mode || 'magic',
      save_data: saveData,
      updated_at: now
    }, { onConflict: 'lobby_name' })
    .select('lobby_name, mode, updated_at')
    .single();
  if (error) throw error;
  return data;
}

export function createRealtimeRoom(roomName, playerId, onMessage, onStatus) {
  const safeName = roomName.toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').slice(0, 80);
  const localChannelName = `fancy-card-table:${safeName}`;
  const localChannel = 'BroadcastChannel' in window ? new BroadcastChannel(localChannelName) : null;
  const supabase = getSupabaseClient();
  let supabaseChannel = null;
  let closed = false;
  const seen = new Set();

  function handleEnvelope(envelope, source) {
    if (!envelope || envelope.senderId === playerId) return;
    if (seen.has(envelope.id)) return;
    seen.add(envelope.id);
    if (seen.size > 1000) seen.clear();
    onMessage(envelope, source);
  }

  if (localChannel) {
    localChannel.onmessage = (event) => handleEnvelope(event.data, 'local');
  }

  if (supabase) {
    supabaseChannel = supabase.channel(`fct-${safeName}`, {
      config: { broadcast: { self: false } }
    });
    supabaseChannel
      .on('broadcast', { event: 'room_event' }, ({ payload }) => handleEnvelope(payload, 'supabase'))
      .subscribe((status) => {
        onStatus?.(status);
      });
  } else {
    onStatus?.('LOCAL_ONLY');
  }

  async function send(type, payload = {}) {
    if (closed) return;
    const envelope = {
      id: crypto.randomUUID(),
      type,
      payload,
      senderId: playerId,
      sentAt: Date.now()
    };
    if (localChannel) localChannel.postMessage(envelope);
    if (supabaseChannel) {
      try {
        await supabaseChannel.send({ type: 'broadcast', event: 'room_event', payload: envelope });
      } catch (error) {
        console.warn('Supabase broadcast failed. Local tab broadcast may still work.', error);
      }
    }
  }

  async function close() {
    closed = true;
    if (localChannel) localChannel.close();
    if (supabaseChannel) await supabase.removeChannel(supabaseChannel);
  }

  return { send, close, roomName: safeName };
}

export function canonicalToView(point, viewerSeat) {
  const { x, y } = point;
  switch (Number(viewerSeat)) {
    case 2:
      return { x: 1 - x, y: 1 - y };
    case 3:
      return { x: y, y: 1 - x };
    case 4:
      return { x: 1 - y, y: x };
    case 1:
    default:
      return { x, y };
  }
}

export function viewToCanonical(point, viewerSeat) {
  const { x, y } = point;
  switch (Number(viewerSeat)) {
    case 2:
      return { x: 1 - x, y: 1 - y };
    case 3:
      return { x: 1 - y, y: x };
    case 4:
      return { x: y, y: 1 - x };
    case 1:
    default:
      return { x, y };
  }
}

export function relativeSeat(ownerSeat, localSeat) {
  if (!ownerSeat || !localSeat) return 0;
  const order = [1, 4, 2, 3];
  const ownerIndex = order.indexOf(Number(ownerSeat));
  const localIndex = order.indexOf(Number(localSeat));
  if (ownerIndex < 0 || localIndex < 0) return 0;
  return (ownerIndex - localIndex + 4) % 4;
}
