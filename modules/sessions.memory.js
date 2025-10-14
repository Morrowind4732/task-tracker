// modules/session.memory.js
// Local memory for last session: { roomId, role:'host'|'join', seat:number, ts }
// Also a tiny “should ask to restore after connect” toggle.

const KEY = 'decktable.session.v1';
const ASK_KEY = 'decktable.session.askRestoreNext';

export function saveSession({ roomId, role, seat }) {
  try {
    const payload = { roomId: String(roomId||'').trim(), role, seat: Number(seat)||1, ts: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {}
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || !v.roomId || !v.role || !v.seat) return null;
    return v;
  } catch { return null; }
}

export function clearSession(){ try{ localStorage.removeItem(KEY); }catch{} }

export function markAskRestoreNext(flag=true){
  try{ localStorage.setItem(ASK_KEY, flag ? '1':'0'); }catch{}
}
export function shouldAskRestoreNext(){
  try{ return localStorage.getItem(ASK_KEY) === '1'; }catch{ return false; }
}
