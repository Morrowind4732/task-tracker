// ================================
// FILE: modules/notifications.js
// ================================

/*
  Public API:
    Notifications.init({ mount })
    Notifications.setVisibilityPredicate(fn)
    Notifications.showCombat(opts)
    Notifications.showTurn(turn, opts)
    Notifications.showText(text, opts)
    Notifications.hide()
    Notifications.isVisible()
    Notifications.subscribe(gameId)     // listen to Supabase 'notifications' and react
    Notifications.unsubscribe()

  Reacts to types:
    - 'combat_initiated'  -> big banner
    - 'turn_advanced'     -> "New Turn: N"
    - 'card_played'       -> small overlay with Counter / Dismiss (when not viewing opponent)
*/

import { NotificationsStore } from './notifications.store.js';

const CSS = `
/* ===== Big banner ===== */
.combat-toast{
  position: fixed; inset: 0; display:flex; align-items:center; justify-content:center;
  z-index: 9999; pointer-events: none;
}
.combat-toast .msg{
  padding: 22px 36px; font-size: 40px; font-weight: 800; letter-spacing: .5px;
  color: #dff7ff; background: rgba(5,14,20,.92); border: 2px solid #70d9ff; border-radius: 14px;
  text-shadow: 0 2px 0 rgba(0,0,0,.6);
  box-shadow: 0 0 40px rgba(112,217,255,.45), inset 0 0 12px rgba(112,217,255,.2);
  animation: combatPulse 900ms infinite alternate;
}
@keyframes combatPulse{
  from { transform: scale(1); opacity: .85; box-shadow: 0 0 28px rgba(112,217,255,.35), inset 0 0 10px rgba(112,217,255,.15); }
  to   { transform: scale(1.05); opacity: 1;  box-shadow: 0 0 60px rgba(112,217,255,.60), inset 0 0 16px rgba(112,217,255,.30); }
}
.combat-toast[hidden]{ display:none !important; }

/* ===== Card played overlay (bottom-right) ===== */
.card-alert{
  position: fixed; right: 16px; bottom: 16px; z-index: 9998;
  background: rgba(10,14,18,.95); border:1px solid #6aa9ff; border-radius: 12px;
  padding: 12px 12px; width: min(360px, 90vw);
  box-shadow: 0 8px 30px rgba(0,0,0,.45);
  display:flex; gap:12px; align-items:center;
}
.card-alert .thumb{
  width: 72px; height: 100px; background:#111; border-radius: 6px; overflow:hidden; flex:0 0 auto;
}
.card-alert .thumb img{ width:100%; height:100%; object-fit:cover; }
.card-alert .body{ flex: 1 1 auto; }
.card-alert .title{ font-weight:700; margin-bottom:4px; }
.card-alert .meta{ font-size:12px; color:#9aa3b2; margin-bottom:8px; }
.card-alert .actions{ display:flex; gap:8px; }
.card-alert button{
  background:#121a22; border:1px solid #2a3d52; border-radius:8px; padding:6px 10px; color:#dff7ff;
}
.card-alert button:hover{ background:#17212a; }
.card-alert[hidden]{ display:none !important; }
`;

let _rootEl = null;
let _msgEl  = null;
let _styleEl = null;
let _hideTimer = null;

let _cardAlert = null;     // container
let _cardThumb = null;
let _cardTitle = null;
let _cardMeta  = null;
let _cardBtnCounter = null;
let _cardBtnDismiss = null;

let _visibilityPredicate = null;
let _sub = null;

function ensureMounted(mount=document.body){
  if (_styleEl) return;
  _styleEl = document.createElement('style');
  _styleEl.textContent = CSS;
  document.head.appendChild(_styleEl);

  // big banner
  _rootEl = document.createElement('div');
  _rootEl.id = 'combatToast';
  _rootEl.className = 'combat-toast';
  _rootEl.setAttribute('hidden','');

  _msgEl = document.createElement('div');
  _msgEl.className = 'msg';
  _msgEl.textContent = '⚔️ Combat Initiated';
  _rootEl.appendChild(_msgEl);
  mount.appendChild(_rootEl);

  // card alert
  _cardAlert = document.createElement('div');
  _cardAlert.className = 'card-alert';
  _cardAlert.setAttribute('hidden','');

  const thumb = document.createElement('div');
  thumb.className = 'thumb'; _cardThumb = document.createElement('img'); thumb.appendChild(_cardThumb);
  const body  = document.createElement('div'); body.className = 'body';
  _cardTitle = document.createElement('div'); _cardTitle.className = 'title';
  _cardMeta  = document.createElement('div'); _cardMeta.className = 'meta';
  const actions = document.createElement('div'); actions.className = 'actions';
  _cardBtnCounter = document.createElement('button'); _cardBtnCounter.textContent = 'Counter';
  _cardBtnDismiss = document.createElement('button'); _cardBtnDismiss.textContent = 'Nope';

  actions.appendChild(_cardBtnCounter);
  actions.appendChild(_cardBtnDismiss);
  body.appendChild(_cardTitle);
  body.appendChild(_cardMeta);
  body.appendChild(actions);

  _cardAlert.appendChild(thumb);
  _cardAlert.appendChild(body);
  mount.appendChild(_cardAlert);

  _cardBtnDismiss.addEventListener('click', ()=> hideCardAlert());
  _cardBtnCounter.addEventListener('click', ()=> {
    // TODO: emit a 'counter_requested' notification so the opponent gets a toast to pause.
    // Example:
    // const S = window.AppState || {};
    // Notifications.emit('counter_requested', { gameId: S.gameId, seat: S.mySeat, payload: { reason:'counter', cardId: _cardAlert.dataset.cardId } });
    hideCardAlert();
  });
}

function setVisibilityPredicate(fn){
  _visibilityPredicate = (typeof fn === 'function') ? fn : null;
}
function _allowed(){ try { return !_visibilityPredicate || !!_visibilityPredicate(); } catch { return true; } }

function hide(){
  if (!_rootEl) return;
  if (_hideTimer){ clearTimeout(_hideTimer); _hideTimer = null; }
  _rootEl.setAttribute('hidden','');
}
function isVisible(){ return !!_rootEl && !_rootEl.hasAttribute('hidden'); }

function showText(text, { autoHideMs = 2200 } = {}){
  ensureMounted();
  if (_hideTimer){ clearTimeout(_hideTimer); _hideTimer = null; }
  _msgEl.textContent = String(text || '');
  _rootEl.removeAttribute('hidden');
  if (autoHideMs > 0) _hideTimer = setTimeout(hide, autoHideMs);
}
function showCombat(opts){ showText('⚔️ Combat Initiated', opts); }
function showTurn(turn, opts){ showText(`New Turn: ${Number(turn)||0}`, opts); }

// ---- Card Played Alert (only show when predicate allows) ----
function showCardAlert({ name, bySeat, image, meta = '' } = {}){
  if (!_allowed()) return;
  ensureMounted();
  _cardThumb.src = image || '';
  _cardTitle.textContent = name || 'Opponent played a card';
  _cardMeta.textContent  = meta || (bySeat != null ? `Seat ${bySeat}` : '');
  _cardAlert.removeAttribute('hidden');
}
function hideCardAlert(){ if (_cardAlert) _cardAlert.setAttribute('hidden',''); }

function init({ mount } = {}){ ensureMounted(mount); return API; }

// ---- Supabase subscribe -> react to events ----
function subscribe(gameId){
  unsubscribe();
  _sub = NotificationsStore.onGameEvents(gameId, (row) => {
    const { type, turn_index, payload, seat } = row || {};
    switch (type) {
      case 'combat_initiated':
        if (_allowed()) showCombat();
        break;
      case 'turn_advanced':
        if (_allowed()) showTurn(turn_index);
        break;
      case 'card_played': {
        // payload suggestion: { cardId, name, image, mana, typeLine }
        const meta = payload?.typeLine ? payload.typeLine : '';
        showCardAlert({ name: payload?.name, image: payload?.image, bySeat: seat, meta });
        // auto-hide after 6s if untouched
        setTimeout(()=>hideCardAlert(), 6000);
        break;
      }
      // you can add more cases here: 'counter_requested', 'counter_cleared', etc.
    }
  });
  return API;
}
function unsubscribe(){ if (_sub){ try{ _sub.unsubscribe(); }catch{} _sub = null; } }

// (Optional) emit helper so your UI can write notifications easily
async function emit(type, { gameId, seat, turnIndex, payload } = {}){
  return NotificationsStore.push({ gameId, type, seat, turnIndex, payload });
}

const API = {
  init, setVisibilityPredicate,
  showCombat, showTurn, showText, hide, isVisible,
  showCardAlert, hideCardAlert,
  subscribe, unsubscribe,
  emit
};

export const Notifications = API;
export default Notifications;
