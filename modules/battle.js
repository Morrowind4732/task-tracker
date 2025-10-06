// modules/battle.js

/**
 * Minimal, clean entry for Battle logic.
 * This file can grow without bloating V2.html.
 *
 * Exports:
 *   - handleBattleClick(ctx): main entry when ⚔️ is pressed
 *   - (add more exports as you grow: startCombatStep, assignAttackers, etc.)
 */

let panelEl = null;

export async function handleBattleClick(ctx){
  // Example: open (or focus) a battle panel
  ensurePanel(ctx);

  // Example “starting point”: you can push UI here or kick off a flow:
  // showStep('Declare Attackers');
  // await pickAttackers(ctx);
  // ...
}

/* ---------------- UI scaffolding (example) ---------------- */

function ensurePanel(ctx){
  if (panelEl && panelEl.isConnected){
    panelEl.style.display = 'block';
    panelEl.focus?.();
    return;
  }

  panelEl = document.createElement('div');
  panelEl.className = 'panel';
  panelEl.style.maxWidth = 'min(840px, 94vw)';
  panelEl.style.position = 'fixed';
  panelEl.style.left = '50%';
  panelEl.style.top = '50%';
  panelEl.style.transform = 'translate(-50%, -50%)';
  panelEl.style.zIndex = 99999; // over your other overlays
  panelEl.style.padding = '12px';
  panelEl.style.borderRadius = '14px';
  panelEl.style.border = '1px solid #24324a';
  panelEl.style.background = 'rgba(12,18,28,.98)';
  panelEl.style.boxShadow = '0 14px 36px rgba(0,0,0,.55)';
  panelEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
      <strong>Battle</strong>
      <button class="pill" id="battleClose">Close</button>
    </div>
    <div id="battleBody" style="display:grid;gap:8px;">
      <em style="opacity:.8">Battle module loaded. Build your flow here.</em>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="pill" id="demoTapSelected">Tap Selected</button>
        <button class="pill" id="demoMoveSelected">Nudge Selected</button>
      </div>
    </div>
  `;

  document.body.appendChild(panelEl);

  panelEl.querySelector('#battleClose').addEventListener('click', ()=>{
    panelEl.style.display = 'none';
  });

  // Demo actions that use ctx.helpers (proves the wiring works)
  panelEl.querySelector('#demoTapSelected').addEventListener('click', ()=>{
    const selId = ctx.state.selectedCardId;
    if(!selId) return;
    const card = ctx.helpers.getCardById(selId);
    if(!card) return;
    // toggle tap and persist using your existing helpers
    card.tapped = !card.tapped;
    ctx.helpers.updateCardDom(card);
    ctx.helpers.writeTableMove(card, ctx.worldEl.querySelector(`.card[data-id="${card.id}"]`));
  });

  panelEl.querySelector('#demoMoveSelected').addEventListener('click', ()=>{
    const selId = ctx.state.selectedCardId;
    if(!selId) return;
    const card = ctx.helpers.getCardById(selId);
    if(!card) return;
    // nudge down-right, animate via your existing DOM + write
    card.x = (card.x || 300) + 30;
    card.y = (card.y || 120) + 20;
    const el = ctx.worldEl.querySelector(`.card[data-id="${card.id}"]`);
    if (el){ el.style.left = card.x + 'px'; el.style.top = card.y + 'px'; }
    ctx.helpers.writeTableMove(card, el);
  });
}

/* ---------------- room to grow ----------------
   - export function startCombatStep(ctx) { ... }
   - export function assignAttackers(ctx) { ... }
   - export function assignBlockers(ctx) { ... }
   - export function resolveDamage(ctx) { ... }
   Keep all battle-only state in module scope here, not in V2.html.
------------------------------------------------*/
