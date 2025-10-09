// ================================
// FILE: modules/battle.js
// ================================
// Full replacement. Adds damage resolver + fixes rgba typos in panel.

let panelEl = null;

export async function handleBattleClick(ctx){
  ensurePanel(ctx);
}

function ensurePanel(ctx){
  if (panelEl && panelEl.isConnected){
    panelEl.style.display = 'block'; panelEl.focus?.(); return;
  }
  panelEl = document.createElement('div');
  panelEl.className = 'panel';
  panelEl.style.maxWidth = 'min(840px, 94vw)';
  panelEl.style.position = 'fixed';
  panelEl.style.left = '50%';
  panelEl.style.top = '50%';
  panelEl.style.transform = 'translate(-50%, -50%)';
  panelEl.style.zIndex = 99999;
  panelEl.style.padding = '12px';
  panelEl.style.borderRadius = '14px';
  panelEl.style.border = '1px solid #24324a';
  panelEl.style.background = 'rgba(12,18,28,.98)';
  panelEl.style.boxShadow  = '0 14px 36px rgba(0,0,0,.55)';
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
  panelEl.querySelector('#battleClose').addEventListener('click', ()=>{ panelEl.style.display='none'; });

  // Demo actions (optional)
  panelEl.querySelector('#demoTapSelected')?.addEventListener('click', ()=>{
    const selId = ctx?.state?.selectedCardId; if(!selId) return;
    const card = ctx?.helpers?.getCardById?.(selId); if(!card) return;
    card.tapped = !card.tapped;
    ctx.helpers.updateCardDom?.(card);
    const el = ctx.worldEl?.querySelector?.(`.card[data-id="${card.id}"]`);
    ctx.helpers.writeTableMove?.(card, el);
  });

  panelEl.querySelector('#demoMoveSelected')?.addEventListener('click', ()=>{
    const selId = ctx?.state?.selectedCardId; if(!selId) return;
    const card = ctx?.helpers?.getCardById?.(selId); if(!card) return;
    card.x = (card.x || 300) + 30; card.y = (card.y || 120) + 20;
    const el = ctx.worldEl?.querySelector?.(`.card[data-id="${card.id}"]`);
    if (el){ el.style.left = card.x + 'px'; el.style.top = card.y + 'px'; }
    ctx.helpers.writeTableMove?.(card, el);
  });
}

/* ------------------------------------------------------
   DAMAGE RESOLUTION (First strike / Double strike / Deathtouch / Lifelink / Trample)
------------------------------------------------------ */
export function resolveCombatDamage(attacker, blockers){
  const notes = [];
  const aFx = extractKeywords(attacker);
  const blockersFx = blockers.map(extractKeywords);

  // === FIRST STRIKE PHASE? ===
  const firstStrikePhase = aFx.firstStrike || aFx.doubleStrike || blockersFx.some(b => b.firstStrike || b.doubleStrike);
  let firstCas = { attackerDead:false, deadIds:new Set(), notes:[] };
  let remainingBlockers = [...blockers];

  if (firstStrikePhase){
    firstCas = resolveDamageStep(attacker, remainingBlockers, 'first', aFx, blockersFx);
    notes.push(...firstCas.notes);
    remainingBlockers = remainingBlockers.filter(b => !firstCas.deadIds.has(b.id));
    if (firstCas.attackerDead){
      return { notes, attackerDead:true, deadBlockers:firstCas.deadIds };
    }
  }

  // === REGULAR DAMAGE PHASE ===
  const regCas = resolveDamageStep(attacker, remainingBlockers, 'regular', aFx, blockersFx);
  notes.push(...regCas.notes);
  const deadIds = new Set([...firstCas.deadIds, ...regCas.deadIds]);

  return { notes, attackerDead: regCas.attackerDead, deadBlockers: deadIds };
}

function extractKeywords(card){
  const txt = (card.oracle_text || card._scry?.oracle_text || '').toLowerCase();
  return {
    firstStrike:   txt.includes('first strike'),
    doubleStrike:  txt.includes('double strike'),
    deathtouch:    txt.includes('deathtouch'),
    trample:       txt.includes('trample'),
    lifelink:      txt.includes('lifelink'),
  };
}

// prefer a live snapshot if present (e.g. "5/5" saved by UI)
function getPT(card){
  // 1) live "5/5" style strings get top priority
  const fromPair = (s) => {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^\s*(-?\d+)\s*\/\s*(-?\d+)\s*$/);
    return m ? { power: Number(m[1]), toughness: Number(m[2]) } : null;
  };
  const live = fromPair(card?.pt) || fromPair(card?.ext?.pt) || fromPair(card?._scry?.pt);
  if (live) return live;

  // 2) base face stats
  const faces = Array.isArray(card?._faces) ? card._faces : null;
  const face = faces && faces.length > 1
    ? (card.face === 'back' ? faces[1] : faces[0])
    : (faces?.[0] || {});
  const baseP = face.power ?? card.power ?? card._scry?.power ?? card._scry?.faces?.[0]?.power ?? 0;
  const baseT = face.toughness ?? card.toughness ?? card._scry?.toughness ?? card._scry?.faces?.[0]?.toughness ?? 0;

  // 3) add runtime/cog-wheel modifiers
  const mod = card._ptMod || card.ext?.ptMod || { p:0, t:0 };
  const p = Number(baseP) + Number(mod.p || 0);
  const t = Number(baseT) + Number(mod.t || 0);
  return { power: p, toughness: t };
}


function resolveDamageStep(attacker, blockers, phase, aFx, blockersFx){
  const notes = [];
  const deadIds = new Set();
  let attackerDead = false;

  const aPT = getPT(attacker);

  if (!blockers.length){
    // Unblocked — handle lifelink + trample messaging here
    if (aFx.lifelink) notes.push(`${attacker.name} lifelinks ${aPT.power} to its controller.`);
    notes.push(`${attacker.name} is unblocked for ${aPT.power} damage.`);
    return { attackerDead:false, deadIds, notes };
  }

  // Simple assignment in listed order. If you later support manual order, pass that order in.
  let remaining = aPT.power;
  for (let i=0;i<blockers.length;i++){
    const b = blockers[i];
    const bFx = blockersFx[i] || {};
    const bPT = getPT(b);

    // Attacker deals to this blocker
    const aDeals = Math.min(remaining, bPT.toughness);
    const aKills = aFx.deathtouch || (aDeals >= bPT.toughness);
    if (aDeals > 0) remaining -= aDeals;

    // Blocker deals to attacker (both strike in the same step for that phase)
    const bKills = bFx.deathtouch || (bPT.power >= aPT.toughness);

    if (aKills){ deadIds.add(b.id); notes.push(`${attacker.name} kills ${b.name}${phase==='first'?' (first strike)':''}.`); }
    if (bKills){ attackerDead = true; notes.push(`${b.name} kills ${attacker.name}${phase==='first'?' (first strike)':''}.`); }

    // Trample only matters after the last blocker
    if (aFx.trample && i === blockers.length-1 && remaining > 0){
      notes.push(`${attacker.name} tramples over for ${remaining} damage.`);
    }
  }

  if (aFx.lifelink && aPT.power > 0){
    notes.push(`${attacker.name} lifelinks ${aPT.power} to its controller.`);
  }

  return { attackerDead, deadIds, notes };
}

export default { handleBattleClick, resolveCombatDamage };
