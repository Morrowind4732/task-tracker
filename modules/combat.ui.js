// modules/combat.ui.js
import { CombatStore } from './combat.store.js';
import { startMetaPoller } from './storage.js';

let toastEl = null;

export function startCombatPoller(gameId, mySeat){
  // Show toast to non-attackers only
  setInterval(async ()=>{
    const c = await CombatStore.read(gameId);
    if (!c?.combatInitiated) { hideToast(); return; }
    if (Number(c.attackingSeat) !== Number(mySeat)) {
      showToast('⚔️ Combat Initiated — open your 🛡️ to assign blockers');
    } else {
      hideToast();
    }
  }, 300);
}

export function wireBattleFab({ gameId, mySeat, getIsMyTurn, btn }){
  // Set icon based on whose turn it is
  const setIcon = ()=>{
    btn.textContent = getIsMyTurn() ? '⚔️' : '🛡️';
    btn.title = getIsMyTurn() ? 'Declare Attackers' : 'Assign Blockers';
  };
  setIcon();
  // optional: keep it fresh if your turn changes
  setInterval(setIcon, 500);

  btn.addEventListener('click', async ()=>{
    if (!gameId) return;
    if (getIsMyTurn()){
      await openAttackerOverlay({ gameId, mySeat });
    } else {
      await openDefenderOverlay({ gameId, mySeat });
    }
  });
}

export async function openAttackerOverlay({ gameId, mySeat }){
  // For now: just set the flag + seat; next step will add attacker picker UI
  await CombatStore.setInitiated(gameId, mySeat);
  simplePanel('Attackers', `
    <p>Attacks declared. (Next: we’ll add the attacker picker here.)</p>
    <button class="pill" id="closeAttPanel">Close</button>
  `, (panel)=>{
    panel.querySelector('#closeAttPanel').addEventListener('click', ()=> panel.remove());
  });
}

export async function openDefenderOverlay({ gameId, mySeat }){
  const c = await CombatStore.read(gameId);
  if (!c?.combatInitiated){
    simplePanel('No Combat', `<p>No active combat declaration.</p>`, p=>setTimeout(()=>p.remove(), 1000));
    return;
  }
  simplePanel('Blockers', `
    <p>Choose blockers & order (placeholder). Next step we’ll port your old block-order UI.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="pill" id="ackBtn">Acknowledge (clear toast)</button>
    </div>
  `, (panel)=>{
    panel.querySelector('#ackBtn').addEventListener('click', async ()=>{
      // Clear just the toast flag (keep attacks/blocks if you want); we can separate acks later.
      await CombatStore.write(gameId, { combatInitiated: 0 });
      panel.remove();
    });
  });
}

/* helpers */
function showToast(msg){
  if (toastEl?.isConnected){ toastEl.querySelector('span').textContent = msg; return; }
  toastEl = document.createElement('div');
  toastEl.style.cssText = `
    position:fixed; left:50%; bottom:86px; transform:translateX(-50%);
    background:#0b1220; color:#e7efff; border:1px solid #263a5f; border-radius:12px;
    padding:10px 14px; z-index:99999; box-shadow:0 14px 36px rgba(0,0,0,.45);
  `;
  toastEl.innerHTML = `<span>${msg}</span>`;
  document.body.appendChild(toastEl);
}
function hideToast(){ if (toastEl){ toastEl.remove(); toastEl=null; } }

function simplePanel(title, html, onReady){
  const p = document.createElement('div');
  p.className = 'panel';
  p.style.zIndex = 99999;
  p.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
      <strong>${title}</strong>
      <button class="pill" id="closeX">Close</button>
    </div>
    <div style="display:grid;gap:8px;">${html}</div>
  `;
  document.body.appendChild(p);
  p.querySelector('#closeX').addEventListener('click', ()=> p.remove());
  onReady?.(p);
  return p;
}
