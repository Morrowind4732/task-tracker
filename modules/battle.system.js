// modules/battle.system.js
// High-level combat flow controller for attacker/defender steps.
//
// Flow recap:
// 1. beginAttackSelection()
//    - highlight my creatures, let me click which ones are attacking
// 2. confirmAttackers()
//    - lock selection
//    - SNAP those attackers forward toward combat line
//    - broadcast "combat_charge"
// 3. beginBlockSelection() / confirmBlocks()
//    - defender assigns blockers in front of attackers
//    - broadcast "combat_blocks"
// 4. applyRemoteCharge()/applyRemoteBlocks() mirrors layouts for the opponent
// 5. showResolutionPreview() builds simple outcome overlay

import { UserInterface } from './user.interface.js';
// INSERTED: pull world placement helpers from card.placement.math.js
import { CardPlacement } from './card.placement.math.js';

// We’re going to reach into CardPlacement for two things it already defined:
//   - screenToWorld(sx, sy)
//   - CSS_CARD_H() / etc.
// Those aren’t exported directly in your snippet, but they’re in closure scope.
// We'll expose what we need by monkey-patching CardPlacement if not already.
// (Cheap bridge so we don't rewrite that file right now.)

// Safe bridge: stash refs on window from card.placement.math.js if you haven't already.
// In card.placement.math.js after it defines screenToWorld(...) it can do:
//   window._screenToWorld = screenToWorld;
//   window._CSS_CARD_H    = CSS_CARD_H;
//   window._applyOwnershipAfterDrop = _applyOwnershipAfterDrop;
//   window._otherSeatNum  = _otherSeatNum;
//   window._mySeat        = mySeat;
//   window._stateByCid    = state.byCid;
//   etc.
// For now we assume we've added at least _screenToWorld and _applyOwnershipAfterDrop and that
// CardPlacement.state/byCid isn't private to us. If not, add them in that file.

export const Battle = (() => {

  // --- Layout tuning constants --------------------------------------
  const BLOCKER_GAP_Y    = -10; // px gap in front of attacker (screen-projected style fan)
  const BLOCKER_OFFSET_X = 30;  // px horizontal stagger for 2nd, 3rd, etc. blockers

  // --- State buckets ------------------------------------------------
  let currentAttackers = [];   // [cid,...] attackers the player actually picked
  let blockAssignments = {};   // attackerCid -> [blockerCid,...]
  let activeBlockTarget = null;
  let mode = 'idle';           // 'idle' | 'attacking' | 'blocking'

  // Set of CIDs that are ALLOWED to attack this turn.
  // We fill this in beginAttackSelection() using BattleRules.getEligibleAttackersForSeat()
  let eligibleAttackers = new Set();

  // --- original world positions so we can restore later ------------
  // attackerOrigin[cid] = { x:Number, y:Number }
  // blockerOrigin[cid]  = { x:Number, y:Number }

  const attackerOrigin = new Map();
  const blockerOrigin  = new Map();


  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

function resolveCombat(attackers, assignments){
  console.groupCollapsed('%c[Battle] resolveCombat()', 'color:#0f0;font-weight:bold;', {
    attackers,
    assignments
  });

  // -------------------------
  // helpers
  // -------------------------

  function abilityTags(prof){
    if (!prof) return '';
    const ABILITIES = [
      'flying','first strike','double strike','vigilance','lifelink','deathtouch',
      'trample','haste','reach','defender','hexproof','indestructible','menace','ward',
      'battle cry','exalted'
    ];
    const found = [];
    if (Array.isArray(prof.abilities)){
      for (const key of ABILITIES){
        const regex = new RegExp(`\\b${key}\\b`, 'i');
        if (prof.abilities.some(a => regex.test(a))){
          const nice = key.replace(/\b\w/g, m => m.toUpperCase());
          found.push(nice);
        }
      }
    }
    let colorStr = '';
    if (Array.isArray(prof.colors) && prof.colors.length){
      colorStr = ` | Colors: {${prof.colors.join(',')}}`;
    }
    return found.length
      ? ` [${found.join(', ')}${colorStr}]`
      : (colorStr ? ` [${colorStr.slice(3)}]` : '');
  }

  function P(cid){
    return window.BattleRules?.getCardCombatProfile(cid) || null;
  }

  function hasTagLoose(prof, word){
    if (!prof) return false;
    const needle = String(word||'').toLowerCase();
    if (Array.isArray(prof.abilities)){
      for (const a of prof.abilities){
        if (String(a||'').toLowerCase().includes(needle)) return true;
      }
    }
    if (Array.isArray(prof.types)){
      for (const t of prof.types){
        if (String(t||'').toLowerCase().includes(needle)) return true;
      }
    }
    return false;
  }

  function mySeatNum(){
    try { return Number((typeof window.mySeat === 'function') ? window.mySeat() : 1); }
    catch { return 1; }
  }

  function getProtectionList(prof){
    const out = [];
    if (!prof || !Array.isArray(prof.abilities)) return out;
    for (const raw of prof.abilities){
      const txt = String(raw||'').toLowerCase().trim();
      let m = txt.match(/🛡️\s*([a-z0-9 ']+)$/i);
      if (m && m[1]){ out.push(m[1].trim()); continue; }
      m = txt.match(/protection\s+from\s+([a-z0-9 ']+)/i);
      if (m && m[1]){ out.push(m[1].trim()); continue; }
    }
    return out;
  }

  function preventedByProtection(srcProf, tgtProf){
    if (!srcProf || !tgtProf) return false;
    const protList = getProtectionList(tgtProf);
    if (!protList.length) return false;
    const srcColors = Array.isArray(srcProf.colors)
      ? srcProf.colors.map(c => String(c).toUpperCase()) : [];
    const srcNameLower = String(srcProf.name||'').toLowerCase().trim();

    function colorWordToLetter(w){
      if (w === 'white') return 'W';
      if (w === 'blue')  return 'U';
      if (w === 'black') return 'B';
      if (w === 'red')   return 'R';
      if (w === 'green') return 'G';
      return null;
    }

    for (const protRaw of protList){
      const prot = protRaw.toLowerCase().trim();
      const letCode = colorWordToLetter(prot);
      if (letCode){
        if (srcColors.includes(letCode)) return true;
        continue;
      }
      const protSingular = prot.endsWith('s') ? prot.slice(0,-1) : prot;
      if (hasTagLoose(srcProf, prot) || hasTagLoose(srcProf, protSingular)) return true;
      if (srcNameLower && (prot === srcNameLower)) return true;
    }
    return false;
  }

  function srcHasDeathtouch(srcProf){
    return !!srcProf && hasTagLoose(srcProf,'deathtouch');
  }

  function shouldDieNow(tgtProf, totalDamageOnTgt, wasHitByDeathtouch){
    if (!tgtProf) return false;
    const hasIndestructible = hasTagLoose(tgtProf,'indestructible');
    if (wasHitByDeathtouch && totalDamageOnTgt > 0) return true; // your rule
    if (!Number.isFinite(tgtProf.touNum)) return false;
    if (totalDamageOnTgt >= tgtProf.touNum){
      if (hasIndestructible) return false;
      return true;
    }
    return false;
  }

  // NEW: figure out owner seat for a card id
  function ownerSeatOf(cid){
    const el = document.querySelector(`img.table-card[data-cid="${cid}"]`);
    const raw = el?.dataset?.ownerCurrent ?? el?.dataset?.owner ?? '';
    const m = String(raw).match(/\d+/);
    return m ? Number(m[0]) : null;
  }

  // -------------------------
  // bookkeeping
  // -------------------------
  const casualties        = new Set();
  const deadThisCombat    = [];
  const damageLog         = [];
  const pendingLifeGain   = {};   // { cid: life }
  const dmgTally          = {};   // { cid: totalDamage }

  // NEW: seat-based life math
  const seatDamage  = { 1: 0, 2: 0 }; // player damage taken
  const seatGain    = { 1: 0, 2: 0 }; // lifelink gained
  const attackerSeat = (Number(window.UserInterface?._STATE?.activeSeat) || 1);
  const defendingSeat = (attackerSeat === 1 ? 2 : 1);

  function addDamageToTally(cid, amt){
    if (!cid || !Number.isFinite(amt) || amt <= 0) return;
    dmgTally[cid] = (dmgTally[cid] || 0) + amt;
  }

  const PHASES = [
    { key:'first',  label:'FIRST STRIKE / DOUBLE STRIKE FIRST HIT'  },
    { key:'normal', label:'NORMAL STRIKE / DOUBLE STRIKE SECOND HIT'}
  ];

  for (const phaseObj of PHASES){
    const phase = phaseObj.key;
    console.group(`%c[${phaseObj.label}]`,'color:#fc0;font-weight:bold;');

    function attackerHitsThisPhase(atkProf){
      if (!atkProf) return false;
      const hasFS = hasTagLoose(atkProf,'first strike') || hasTagLoose(atkProf,'double strike');
      const hasDS = hasTagLoose(atkProf,'double strike');
      if (phase === 'first') return hasFS;
      if (hasFS && !hasDS) return false;
      return true;
    }

    function blockerHitsThisPhase(blkProf){
      if (!blkProf) return false;
      const hasFS = hasTagLoose(blkProf,'first strike') || hasTagLoose(blkProf,'double strike');
      const hasDS = hasTagLoose(blkProf,'double strike');
      if (phase === 'first') return hasFS;
      if (hasFS && !hasDS) return false;
      return true;
    }

    // 1) ATTACKERS DEAL
    for (const atkCid of attackers){
      if (casualties.has(atkCid)) continue;
      const atkProf = P(atkCid);
      if (!atkProf || !Number.isFinite(atkProf.powNum) || atkProf.powNum <= 0) continue;
      if (!attackerHitsThisPhase(atkProf)) continue;

      const blockerList = assignments[atkCid] || [];

      if (!blockerList.length){
        // UNBLOCKED → player damage
        seatDamage[defendingSeat] += atkProf.powNum;

        if (hasTagLoose(atkProf,'lifelink')){
          pendingLifeGain[atkCid] = (pendingLifeGain[atkCid]||0) + atkProf.powNum;
        }

        damageLog.push(
          `[${phaseObj.label}] ${atkProf.name}${abilityTags(atkProf)} hits defending player for ${atkProf.powNum}`
        );
        continue;
      }

      // BLOCKED
      let remainingPower = atkProf.powNum;
      const atkHasLL     = hasTagLoose(atkProf,'lifelink');

      for (const blkCid of blockerList){
        if (casualties.has(blkCid)) continue;
        if (remainingPower <= 0) break;

        const blkProf = P(blkCid);
        if (!blkProf || !Number.isFinite(blkProf.touNum) || blkProf.touNum <= 0) continue;

        if (preventedByProtection(atkProf, blkProf)){
          damageLog.push(
            `[${phaseObj.label}] ${atkProf.name}${abilityTags(atkProf)} would deal damage to ${blkProf.name}${abilityTags(blkProf)} but it's PREVENTED by protection`
          );
          continue;
        }

        const dealt = remainingPower; // crude assignment (no trample split)
        addDamageToTally(blkCid, dealt);

        const beforeTough = blkProf.touNum;
        const afterTough  = Number.isFinite(beforeTough)
          ? beforeTough - (dmgTally[blkCid] || 0) : beforeTough;

        damageLog.push(
          `[${phaseObj.label}] ${atkProf.name}${abilityTags(atkProf)} deals ${dealt} to ${blkProf.name}${abilityTags(blkProf)}  ` +
          `(Blocker P/T ${blkProf.powNum||'?'} / ${blkProf.touNum||'?'} -> after dmg T≈${afterTough})`
        );

        if (atkHasLL){
          pendingLifeGain[atkCid] = (pendingLifeGain[atkCid]||0) + dealt;
        }

        // use up the whole blocker toughness before moving on (simple)
        remainingPower -= blkProf.touNum;
      }
    }

    // 2) BLOCKERS DEAL
    for (const [atkCid, blockerList] of Object.entries(assignments)){
      const atkProf = P(atkCid);
      if (!atkProf) continue;
      if (casualties.has(atkCid)) continue;

      for (const blkCid of blockerList){
        if (casualties.has(blkCid)) continue;

        const blkProf = P(blkCid);
        if (!blkProf || !Number.isFinite(blkProf.powNum) || blkProf.powNum <= 0) continue;
        if (!blockerHitsThisPhase(blkProf)) continue;

        if (preventedByProtection(blkProf, atkProf)){
          damageLog.push(
            `[${phaseObj.label}] ${blkProf.name}${abilityTags(blkProf)} would deal damage to ${atkProf.name}${abilityTags(atkProf)} but it's PREVENTED by protection`
          );
          continue;
        }

        const dealt = blkProf.powNum;
        addDamageToTally(atkCid, dealt);

        const beforeTough = atkProf.touNum;
        const afterTough  = Number.isFinite(beforeTough)
          ? beforeTough - (dmgTally[atkCid] || 0) : beforeTough;

        damageLog.push(
          `[${phaseObj.label}] ${blkProf.name}${abilityTags(blkProf)} deals ${dealt} to ${atkProf.name}${abilityTags(atkProf)}  ` +
          `(Attacker P/T ${atkProf.powNum||'?'} / ${atkProf.touNum||'?'} -> after dmg T≈${afterTough})`
        );

        if (hasTagLoose(blkProf,'lifelink')){
          pendingLifeGain[blkCid] = (pendingLifeGain[blkCid]||0) + dealt;
        }
      }
    }

    // 3) MARK LETHAL
    const allCidsOnTable = document.querySelectorAll('img.table-card[data-cid]');
    allCidsOnTable.forEach(el => {
      const vicCid  = el.dataset.cid;
      const vicProf = P(vicCid);
      if (!vicProf) return;
      if (casualties.has(vicCid)) return;
      const totalDmg = dmgTally[vicCid] || 0;
      if (totalDmg <= 0) return;

      let touchedByDT = false;
      for (const atkCid of attackers){
        const a = P(atkCid);
        if (!a) continue;
        if (srcHasDeathtouch(a)){
          const blockList = assignments[atkCid] || [];
          if (blockList.includes(vicCid) || atkCid === vicCid){
            touchedByDT = true; break;
          }
        }
      }
      if (!touchedByDT){
        for (const [attId, blockerList] of Object.entries(assignments)){
          if (String(attId) === String(vicCid)){
            for (const bCid of blockerList){
              const b = P(bCid); if (srcHasDeathtouch(b)){ touchedByDT = true; break; }
            }
          }
          if (touchedByDT) break;
        }
      }

      const dead = shouldDieNow(vicProf, totalDmg, touchedByDT);
      if (dead){
        casualties.add(vicCid);
        deadThisCombat.push(vicCid);
        damageLog.push(
          `💀 ${vicProf.name}${abilityTags(vicProf)} is destroyed (marked lethal: ${totalDmg} dmg${touchedByDT?' with Deathtouch':''})`
        );
      }
    });

    console.groupEnd(); // phase
  }

  // -------------------------
  // LIFELINK → map to seats
  // -------------------------
  Object.entries(pendingLifeGain).forEach(([cid, gain]) => {
    const prof = P(cid);
    const who  = prof?.name || cid;
    damageLog.push(`♥ ${who}${abilityTags(prof)} gains ${gain} life via lifelink`);
    const seat = ownerSeatOf(cid);
    if (seat === 1 || seat === 2) seatGain[seat] += gain;
  });

  // -------------------------
  // POST-COMBAT CLEANUP (graveyards)
  // -------------------------
  const me = String(mySeatNum());
  deadThisCombat.forEach(cidDead => {
    const el = document.querySelector(`img.table-card[data-cid="${cidDead}"]`);
    if (!el) return;
    const ownerSeat =
      (el.dataset.ownerCurrent ?? el.dataset.owner ?? '').toString().match(/\d+/)?.[0] || '';

    if (ownerSeat === me) {
      if (window.CardPlacement?.sendToGraveyardLocal) {
        window.CardPlacement.sendToGraveyardLocal(el);
        return;
      }
    }

    if (ownerSeat && ownerSeat !== me) {
      if (window.CardPlacement?.forceSendToGraveyard) {
        window.CardPlacement.forceSendToGraveyard(el, 'opponent');
        return;
      }
      if (typeof window.forceSendToGraveyard === 'function') {
        window.forceSendToGraveyard(el, 'opponent');
        return;
      }
      try { window.Zones?.recordCardToZone?.('opponent', 'graveyard', el); } catch {}
      try { window.Tooltip?.hide?.(); } catch {}
      try { window.Badges?.detach?.(el); } catch {}
      try { el.remove(); } catch {}
      try { window.CardPlacement?.state?.byCid?.delete?.(cidDead); } catch {}
      try {
        (window.rtcSend || window.peer?.send)?.({
          type: 'remove', cid: cidDead, zone: 'graveyard', ownerSide: 'opponent'
        });
      } catch {}
    }
  });

  // -------------------------
  // APPLY LIFE TOTAL CHANGES
  // -------------------------
  // Only the DEFENDER client applies life math & broadcasts it
  const iAmDefender = (mySeatNum() !== (Number(window.UserInterface?._STATE?.activeSeat) || 1));
  try {
    if (iAmDefender) {
      // Current totals (safe fallbacks if missing)
      const S = window.UserInterface?._STATE || {};
      const curP1 = Number.isFinite(S?.p1?.total) ? S.p1.total : 20;
      const curP2 = Number.isFinite(S?.p2?.total) ? S.p2.total : 20;

      const nextP1 = curP1 - seatDamage[1] + seatGain[1];
      const nextP2 = curP2 - seatDamage[2] + seatGain[2];

      // Apply locally
      try { window.UserInterface?.setP1(nextP1, undefined, undefined); } catch {}
      try { window.UserInterface?.setP2(nextP2, undefined, undefined); } catch {}

      // Broadcast to opponent
      try {
        (window.rtcSend || window.peer?.send)?.({
          type: 'life:update',
          reason: 'combat',
          p1: { total: nextP1 },
          p2: { total: nextP2 }
        });
      } catch (e){
        console.warn('[Battle][life:update] RTC send failed', e);
      }

      console.log('%c[Battle] Life Applied (defender authority)', 'color:#6cf;font-weight:bold;', {
        damageToSeat: { ...seatDamage },
        lifelinkBySeat: { ...seatGain },
        before: { p1: curP1, p2: curP2 },
        after : { p1: nextP1, p2: nextP2 }
      });
    } else {
      console.log('%c[Battle] Skipping local life apply (attacker). Defender will broadcast.', 'color:#aaa;');
    }
  } catch (e){
    console.warn('[Battle] life application failed', e);
  }

// -------------------------
// FINAL RESULTS LOG
// -------------------------
console.groupCollapsed('%c[RESULTS]', 'color:#f88;font-weight:bold;');
for (const line of damageLog){ console.log(line); }
console.groupEnd();

// 🔵 NEW: explicit end-of-combat packet so turn/phase can advance
try {
  const seat = Number(window.UserInterface?._STATE?.activeSeat) || 1;
  (window.rtcSend || window.peer?.send)?.({
    type: 'combat:end',
    seat
  });
  console.log('%c[Battle] sent combat:end', 'color:#9cf;font-weight:bold;', { seat });
} catch (e) {
  console.warn('[Battle] failed to send combat:end', e);
}

}







  // Who am I?
  function _mySeat() {
    const S = UserInterface?._STATE;
    if (!S) return 1;
    return Number(S.seat) || 1;
  }

  // Whose turn?
  function _activeSeat() {
    const S = UserInterface?._STATE;
    if (!S) return 1;
    return Number(S.activeSeat) || 1;
  }

  // Card lookup
  function _getCardEl(cid){
    if (!cid) return null;
    return document.querySelector(`img.table-card[data-cid="${cid}"]`);
  }
  
    // Which seat owns this DOM card?
  // We look at ownerCurrent first (after handoffs), fallback to owner.
  function _cardOwnerSeat(el){
    if (!el) return null;
    const d = el.dataset || {};
    // normalize to just the first digit we see, so "P2", "2", "Seat2" all come out "2"
    const raw = d.ownerCurrent ?? d.owner ?? '';
    const m = String(raw).match(/\d+/);
    return m && m[0] ? m[0] : null;
  }

    // My seat normalized the same way ("1" or "2")
  function _mySeatStr(){
    const mine = _mySeat(); // _mySeat() returns number like 1 or 2
    const m = String(mine).match(/\d+/);
    return m && m[0] ? m[0] : String(mine);
  }

  // 🔵 Control the "Confirm Blocks" action button.
  // In defender mode, "confirm blocks" = the 🛡️ button(s) with ids:
  //   #ui-btn-cross-a and #ui-btn-cross-b
  // We disable BOTH rails so mirrored HUD can't sneak-confirm.
  function _setConfirmBlocksEnabled(isEnabled){
    const btnA = document.getElementById('ui-btn-cross-a');
    const btnB = document.getElementById('ui-btn-cross-b');

    // helper to apply style/state to one button node
    function apply(btn){
      if (!btn) return;

      if (isEnabled){
        // re-enable interaction
        btn.disabled = false;
        btn.style.opacity = '';
        btn.style.pointerEvents = '';
        btn.style.filter = '';
      } else {
        // disable interaction
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.pointerEvents = 'none';
        btn.style.filter = 'grayscale(1)';
      }
    }

    apply(btnA);
    apply(btnB);
  }


  // 🔵 Control the "Confirm Attackers" action button.
  // Attacker mode confirm = the ⚔️ buttons with ids:
  //   #ui-btn-sword-a and #ui-btn-sword-b
  // We disable BOTH rails so mirrored HUD can't sneak-confirm.
  function _setConfirmAttackEnabled(isEnabled){
    const btnA = document.getElementById('ui-btn-sword-a');
    const btnB = document.getElementById('ui-btn-sword-b');

    function apply(btn){
      if (!btn) return;
      if (isEnabled){
        btn.disabled = false;
        btn.style.opacity = '';
        btn.style.pointerEvents = '';
        btn.style.filter = '';
      } else {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.pointerEvents = 'none';
        btn.style.filter = 'grayscale(1)';
      }
    }

    apply(btnA);
    apply(btnB);
  }



  // ---------- NEW CORE LOGIC ----------
//
// We do EXACTLY what you asked:
// 1. Read .half-guide.bottom (your “attack line” guide).
// 2. Convert that guide's SCREEN Y into WORLD Y using screenToWorld().
// 3. Set every attacking card's world top to that SAME world Y.
// 4. Broadcast final {type:'move', x, y} like a drag release so opponent mirrors.
//
// NOTE: Actual move packets are now sent at the end of confirmAttackers().

function _snapAttackersToGuideLine() {
  // grab the guide line element
  const guide = document.querySelector('.half-guide.bottom');
  if (!guide) {
    console.warn('[Battle] no .half-guide.bottom, skipping snap');
    return;
  }

  // 1) get the SCREEN Y for that line (we'll use its top edge)
  const gRect = guide.getBoundingClientRect();
  const guideScreenY = gRect.top;

  // debug print once:
  console.log('[Battle] guideScreenY from .half-guide.bottom =', guideScreenY);

  // 2) convert SCREEN Y -> WORLD Y via the same math placement uses
  // we'll assume window._screenToWorld is exposed by card.placement.math.js
  if (typeof window._screenToWorld !== 'function') {
    console.warn('[Battle] window._screenToWorld missing. Please expose screenToWorld in card.placement.math.js');
    return;
  }

  // we just need any x for conversion; x doesn't change Y math,
  // so we can use 0. (screenToWorld does (sx - cam.x)/scale etc.)
  const worldPt = window._screenToWorld(0, guideScreenY);
  const targetWorldY = worldPt.wy;

  console.log('[Battle] targetWorldY for attackers =', targetWorldY);

  // 3) for each chosen attacker card:
  currentAttackers.forEach(cid => {
    const el = _getCardEl(cid);
    if (!el) return;

    // grab CURRENT world coords before we move it
    const curX = parseFloat(el.style.left) || 0;
    const curY = parseFloat(el.style.top)  || 0;

    // store original position for this attacker so we can snap it back later
    attackerOrigin.set(cid, { x: curX, y: curY });

    // compute its new combat line Y
    const cardH = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--card-height-table')) || 180;
    const finalY = targetWorldY - cardH;

    // move it forward on my screen
    el.style.left = `${curX}px`;
    el.style.top  = `${finalY}px`;


    // raise z so it visually pops forward
    el.style.zIndex = '2147482000';
    el.classList.add('battle-attacker');

    // log pre/post
    const afterRect = el.getBoundingClientRect();
    console.log('[Battle] snap attacker world-pos applied', {
      cid,
      worldLeft: curX,
      worldTop: finalY,
      screenRectAfter: {
        left: afterRect.left,
        top: afterRect.top,
        bottom: afterRect.bottom
      }
    });

    // NOTE: we no longer send the move packet here — it's sent in confirmAttackers().
  });
}




   // Pose a BLOCKER card in front of a specific attacker visually
  function _poseBlocker(blockerEl, attackerEl, idx){
    if (!blockerEl || !attackerEl) return;

    const bCid = blockerEl.dataset.cid;

    // ✅ ONLY STORE ORIGINAL POSITION ONCE.
    // If this blocker was already staged earlier in this block step,
    // DO NOT overwrite its true home coords with its "in front of attacker" coords.
    if (!blockerOrigin.has(bCid)) {
      const curBX = parseFloat(blockerEl.style.left) || 0;
      const curBY = parseFloat(blockerEl.style.top)  || 0;
      blockerOrigin.set(bCid, { x: curBX, y: curBY });

      console.log('[Battle] blockerOrigin stored (first time)', {
        cid: bCid,
        x: curBX,
        y: curBY
      });
    } else {
      // debug so we can see when we'd normally have stomped it
      const already = blockerOrigin.get(bCid);
      console.log('[Battle] blockerOrigin kept (already had)', {
        cid: bCid,
        kept: already
      });
    }

    // get attacker's current world coordinates
    const attackerX = parseFloat(attackerEl.style.left) || 0;
    const attackerY = parseFloat(attackerEl.style.top)  || 0;

    // horizontal stagger for multi-blockers
    const xShift = idx * BLOCKER_OFFSET_X;

    // figure out blocker height from CSS var
    const blockerH = parseFloat(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--card-height-table')
    ) || 180;

    // attackerY is attacker TOP. attacker bottom = attackerY + blockerH.
    // we sit this blocker just past that bottom by BLOCKER_GAP_Y.
    const blockerY = attackerY + blockerH + BLOCKER_GAP_Y;
    const blockerX = attackerX + xShift;

    // 1. Move it locally in the DOM (so defender sees instant feedback)
    blockerEl.style.left = `${blockerX}px`;
    blockerEl.style.top  = `${blockerY}px`;

    blockerEl.style.zIndex = '2147482001';
    blockerEl.classList.add('battle-blocker');

    console.log('[Battle] poseBlocker placed', {
      cid: bCid,
      x: blockerX,
      y: blockerY,
      index: idx
    });

    // 2. Immediately broadcast that same world position as a normal move packet
    try {
      const mySeatNum = (window.mySeat?.() ?? _mySeat() ?? 1);

      const snap = window._applyOwnershipAfterDrop?.(blockerEl);
      const ownerNow = snap?.ownerCurrent || mySeatNum;

      const packetMove = {
        type: 'move',
        cid: bCid,
        x: blockerX,
        y: blockerY,
        owner: ownerNow
      };

      (window.rtcSend || window.peer?.send)?.(packetMove);
      if (window.CardPlacement?.DBG?.on) {
        console.log('%c[Battle→send move (blocker)]', 'color:#6cf', packetMove);
      }
    } catch(err){
      console.warn('[Battle] blocker move send failed', err);
    }
  }





  function _poseBlockersFor(attackerCid){
    const attackerEl = _getCardEl(attackerCid);
    if (!attackerEl) return;

    const list = blockAssignments[attackerCid] || [];
    list.forEach((blockerCid, idx) => {
      const bEl = _getCardEl(blockerCid);
      if (!bEl) return;

      _poseBlocker(bEl, attackerEl, idx);

      // 🔵 mark this blocker as "currently blocking" this attacker
      bEl.dataset.blockingFor = attackerCid;

      // allow clicking the blocker itself to CANCEL that assignment
      bEl.addEventListener('click', _handleBlockerClickWhileAssigned, { once:false });
      bEl.classList.add('battle-blocker-activeClick');
    });
  }

  // --- NEW: remove a blocker from its assigned attacker and send it home
  function _unassignBlocker(blockerCid){
    const bEl = _getCardEl(blockerCid);
    if (!bEl) return;

    // Which attacker was it blocking?
    const attCid = bEl.dataset.blockingFor;
    if (!attCid) return;

    // 1. Remove blockerCid from that attacker's list in blockAssignments
    const list = blockAssignments[attCid] || [];
    blockAssignments[attCid] = list.filter(c => c !== blockerCid);

    // 2. Move the DOM element back to its stored origin
    const orig = blockerOrigin.get(blockerCid);
    if (orig){
      bEl.style.left = `${orig.x}px`;
      bEl.style.top  = `${orig.y}px`;
    }

    // 3. Cleanup styles / markers
    bEl.style.zIndex = '';
    bEl.classList.remove('battle-blocker');
    bEl.classList.remove('battle-blocker-activeClick');
    delete bEl.dataset.blockingFor;

    // Restore the "you can choose me as a blocker" glow if we're still in blocking mode
    if (mode === 'blocking'){
      bEl.classList.add('battle-canBlock');
      bEl.style.outline = '';
      bEl.style.outlineOffset = '';
      bEl.style.boxShadow = '0 0 12px 4px rgba(255,215,0,.7)';
      bEl.style.filter    = 'drop-shadow(0 0 6px rgba(255,215,0,.9))';
    } else {
      // If we're not actively blocking anymore, strip the glow
      bEl.style.outline = '';
      bEl.style.outlineOffset = '';
      bEl.style.boxShadow = '';
      bEl.style.filter = '';
    }

    // 4. Broadcast normal move packet so opponent mirrors the "go back" move
    try {
      const mySeatNum = (window.mySeat?.() ?? _mySeat() ?? 1);

      // sync ownerCurrent stamp for RTC like we do in _poseBlocker
      const snap = window._applyOwnershipAfterDrop?.(bEl);
      const ownerNow = snap?.ownerCurrent || mySeatNum;

      const packetMove = {
        type: 'move',
        cid: blockerCid,
        x: orig ? orig.x : (parseFloat(bEl.style.left)||0),
        y: orig ? orig.y : (parseFloat(bEl.style.top)||0),
        owner: ownerNow
      };

      (window.rtcSend || window.peer?.send)?.(packetMove);
      if (window.CardPlacement?.DBG?.on) {
        console.log('%c[Battle→send move (unassign blocker)]', 'color:#6cf', packetMove);
      }
    } catch(err){
      console.warn('[Battle] blocker unassign move send failed', err);
    }

    console.log('[Battle] _unassignBlocker()', {
      blockerCid,
      removedFrom: attCid,
      newBlockList: blockAssignments[attCid] || []
    });

    // ─────────────────────────────
    // CHECKPOINT B4:
    // After UNassign, re-validate all assignments again so Confirm can get disabled
    // if we just created an illegal solo blocker on a Menace target or a
    // ⚠️🛡️🚫Alone blocker.
    // ─────────────────────────────
        try {
      const attackerCidList = Object.keys(blockAssignments);
      const v = window.BattleRules?.validateBlockAssignments?.(attackerCidList, blockAssignments);

      console.log('[Battle][B4-unassign] validateBlockAssignments() after UNassign', {
        assignments: JSON.parse(JSON.stringify(blockAssignments)),
        result: v
      });

      const legal = !!(v && v.ok);
      _setConfirmBlocksEnabled(legal);

      if (legal){
        _hideRulePopup();
      } else {
        _showRulePopup(v, 'Blocks');
      }
    } catch(err){
      console.warn('[Battle] validateBlockAssignments threw at B4-unassign', err);
      _setConfirmBlocksEnabled(false);
      _showRulePopup(null, 'Blocks');
    }

  }

  // internal click handler for assigned blockers
  function _handleBlockerClickWhileAssigned(e){
    // Only care if we're still in blocking mode
    if (mode !== 'blocking') return;

    const el = e.currentTarget;
    if (!el) return;
    const blockerCid = el.dataset.cid;
    if (!blockerCid) return;

    // Clicking the blocker while it's assigned = unassign it
    _unassignBlocker(blockerCid);

    // Stop this click from ALSO flowing into _assignBlockerToActiveAttacker,
    // which is also listening on cards in block mode.
    e.stopPropagation();
  }

  // Clear any transient combat transforms / zIndexes
  function _clearCombatPoses(){
    document.querySelectorAll('.battle-attacker, .battle-blocker').forEach(el => {
      el.style.transform  = '';
      el.style.transition = '';
      el.style.zIndex     = '';
      el.classList.remove('battle-attacker','battle-blocker');
    });
  }

  
  

  // Clear any transient combat transforms / zIndexes
  function _clearCombatPoses(){
    document.querySelectorAll('.battle-attacker, .battle-blocker').forEach(el => {
      el.style.transform  = '';
      el.style.transition = '';
      el.style.zIndex     = '';
      el.classList.remove('battle-attacker','battle-blocker');
    });
  }

  // ------------------------------------------------------------
  // COMBAT RULE POPUP (toast-style blocker/hint UI)
  // ------------------------------------------------------------
  //
  // We show this when validation says "not ok", and hide it when ok.
  // This is not modal; player can still click cards. It just explains
  // WHY the confirm button is disabled so they know what to fix.

  let _rulePopupEl = null;

  function _ensureRulePopup(){
    if (_rulePopupEl) return _rulePopupEl;
    const div = document.createElement('div');
    div.id = 'combatRulePopup';
    Object.assign(div.style, {
      position:'fixed',
      left:'50%',
      bottom:'40px',
      transform:'translateX(-50%)',
      background:'rgba(0,0,0,.9)',
      color:'#fff',
      border:'1px solid rgba(255,80,80,.8)',
      borderRadius:'10px',
      padding:'12px 16px',
      fontFamily:'sans-serif',
      fontSize:'13px',
      lineHeight:'1.4',
      maxWidth:'320px',
      boxShadow:'0 20px 40px rgba(0,0,0,.8)',
      zIndex:'2147483600',
      pointerEvents:'auto',
      cursor:'pointer',
      display:'none'
    });
    div.addEventListener('click', () => {
      div.style.display = 'none';
    }, { once:false });
    document.body.appendChild(div);
    _rulePopupEl = div;
    return div;
  }

    // take whatever the validator returned and turn it into readable bullets.
  // now we surface the EXACT rule text (Menace, can't block alone, etc.)
  // instead of only saying "not legal".
    // Take whatever validateAttackersSelection/validateBlockAssignments gave us
  // and turn it into human bullets for the popup.
  //
  // This version is aggressive:
  // - Knows our "nice" arrays (needsMoreForMenace, cannotBlockAlone, etc.)
  // - ALSO sniffs looser shapes like {rule:"menace", details:{attacker:"..."}}
  // - ALSO falls back to v.message / v.reason / v.violation if present.
  function _issuesFromValidation(v, phaseLabel){
    const msgs = [];

    // tiny helper to push a line if it's not empty
    function say(str){
      if (!str) return;
      msgs.push(str);
    }

    if (v) {
          // -------------------------
    // 1. MENACE-style failures (dedup per attacker)
    // -------------------------
    (function handleMenace() {
      // We'll collect the names of attackers that are currently Menace-illegal.
      const menaceAttackers = new Set();

      // helper to record attacker name/id in the set
      function pushMenaceEntry(entry){
        if (!entry) return;
        const atkName =
          entry.attackerName ||
          entry.attacker     ||
          entry.attackerCid  ||
          'That attacker';
        menaceAttackers.add(atkName);
      }

      // Case A: array form we expected originally
      if (Array.isArray(v.needsMoreForMenace) && v.needsMoreForMenace.length){
        v.needsMoreForMenace.forEach(pushMenaceEntry);
      }

      // Case B: alt shapes like v.menaceViolation / v.menaceViolations / v.menaceFail
      const menaceArr =
        v.menaceViolation ||
        v.menaceViolations ||
        v.menaceFail ||
        v.menaceFails;
      if (Array.isArray(menaceArr) && menaceArr.length){
        menaceArr.forEach(pushMenaceEntry);
      }

      // Case C: single-object menace report baked into v.details with rule/menace
      if (
        (v.rule && /menace/i.test(v.rule)) ||
        (v.reason && /menace/i.test(v.reason)) ||
        (v.violation && /menace/i.test(v.violation))
      ){
        const d = v.details || v.detail || v;
        pushMenaceEntry(d);
      }

      // Now emit exactly one bullet per unique attacker
      menaceAttackers.forEach(atkName => {
        say(`${atkName} has Menace and must be blocked by 2 or more creatures.`);
      });
    })();


      // -------------------------------------------------
      // 2. "can't block alone" / needs buddy to block
      // -------------------------------------------------

      // Array form we tried first
      if (Array.isArray(v.cannotBlockAlone) && v.cannotBlockAlone.length){
        v.cannotBlockAlone.forEach(entry => {
          const blName =
            entry.blockerName ||
            entry.blocker     ||
            entry.blockerCid  ||
            'This blocker';
          say(`${blName} can't block alone and needs a partner.`);
        });
      }

      // Alternate naming possibilities from validator
      const aloneArr =
        v.blockAloneViolation ||
        v.blockAloneViolations ||
        v.needsBuddyBlocker ||
        v.needsBuddyBlockers;
      if (Array.isArray(aloneArr) && aloneArr.length){
        aloneArr.forEach(entry => {
          const blName =
            entry.blockerName ||
            entry.blocker     ||
            entry.blockerCid  ||
            'This blocker';
          say(`${blName} can't block alone and needs a partner.`);
        });
      }

      // Check generic rule hint
      if (
        (v.rule && /alone/i.test(v.rule) && /block/i.test(v.rule)) ||
        (v.reason && /alone/i.test(v.reason) && /block/i.test(v.reason))
      ){
        const d = v.details || v.detail || v;
        const blName =
          d.blockerName ||
          d.blocker     ||
          d.blockerCid  ||
          'This blocker';
        say(`${blName} can't block alone and needs a partner.`);
      }

      // -------------------------------------------------
      // 3. Illegal blockers (Flying, tapped, etc.)
      // -------------------------------------------------
      if (Array.isArray(v.illegalBlockers) && v.illegalBlockers.length){
        say('One or more chosen blockers are not allowed to block that attacker (Flying, protection, tapped, etc.).');
      }

      // Backup: sometimes validator might expose something like v.illegalBlock or v.blockerErrors
      if (
        (Array.isArray(v.illegalBlock) && v.illegalBlock.length) ||
        (Array.isArray(v.blockerErrors) && v.blockerErrors.length)
      ){
        say('One or more chosen blockers are not allowed to block that attacker (Flying, protection, tapped, etc.).');
      }

      // -------------------------------------------------
      // 4. "can’t attack alone" attackers
      // -------------------------------------------------
      if (Array.isArray(v.soloIllegalAttackers) && v.soloIllegalAttackers.length){
        v.soloIllegalAttackers.forEach(entry => {
          const aName =
            entry.attackerName ||
            entry.attacker     ||
            entry.attackerCid  ||
            'This creature';
          say(`${aName} can't attack alone.`);
        });
      }

      // alt shapes
      const aloneAtkArr =
        v.attackAloneViolation ||
        v.attackAloneViolations ||
        v.cannotAttackAlone ||
        v.cannotAttackSolo;
      if (Array.isArray(aloneAtkArr) && aloneAtkArr.length){
        aloneAtkArr.forEach(entry => {
          const aName =
            entry.attackerName ||
            entry.attacker     ||
            entry.attackerCid  ||
            'This creature';
          say(`${aName} can't attack alone.`);
        });
      }

      if (
        (v.rule && /attack/i.test(v.rule) && /alone/i.test(v.rule)) ||
        (v.reason && /attack/i.test(v.reason) && /alone/i.test(v.reason))
      ){
        const d = v.details || v.detail || v;
        const aName =
          d.attackerName ||
          d.attacker     ||
          d.attackerCid  ||
          'This creature';
        say(`${aName} can't attack alone.`);
      }

      // -------------------------------------------------
      // 5. Must attack / forced attackers left behind
      // -------------------------------------------------
      if (Array.isArray(v.missingMustAttack) && v.missingMustAttack.length){
        say('A creature that must attack was left home.');
      }

      if (
        v.mustAttackViolation ||
        v.mustAttackFail ||
        v.forceAttackNotDeclared
      ){
        say('A creature that must attack was left home.');
      }

      // -------------------------------------------------
      // 6. "can only attack if you control X"
      // -------------------------------------------------
      if (v.onlyAttackIfControlFailed){
        const needTag =
          v.onlyAttackIfControlFailed.tag     ||
          v.onlyAttackIfControlFailed.needTag ||
          'the required ally';
        say(`One attacker can only attack if you control ${needTag}, and you don't.`);
      }

      // -------------------------------------------------
      // 7. Generic strings from validator (message/reason/etc.)
      // -------------------------------------------------
      // If validator already wrote something human, surface it.
      if (typeof v.message === 'string') {
        say(v.message);
      }
      if (typeof v.msg === 'string') {
        say(v.msg);
      }
      if (typeof v.reason === 'string' && v.reason.toLowerCase() !== 'unknown'){
        // pretty-print "menace" style reasons if we somehow missed them above
        if (/menace/i.test(v.reason)){
          say('This attacker has Menace and must be blocked by 2 or more creatures.');
        } else {
          say(v.reason);
        }
      }
      if (typeof v.violation === 'string'){
        say(v.violation);
      }
      if (typeof v.rule === 'string' && !/ok|legal/i.test(v.rule)){
        // e.g. "menace", "cannotBlockAlone"
        // we'll prettify the common ones:
        if (/menace/i.test(v.rule)){
          say('This attacker has Menace and must be blocked by 2 or more creatures.');
        } else if (/alone/i.test(v.rule) && /block/i.test(v.rule)){
          say('A blocker that can’t block alone is blocking by itself.');
        } else if (/alone/i.test(v.rule) && /attack/i.test(v.rule)){
          say('A creature that can’t attack alone is attacking alone.');
        } else {
          say(v.rule);
        }
      }

      // Some validators might hand back `debugStrings: ["Card X can't block flyers", ...]`
      if (Array.isArray(v.debugStrings) && v.debugStrings.length){
        v.debugStrings.forEach(s => {
          if (typeof s === 'string') say(s);
        });
      }
    }

    // If validator said "not ok" but we didn't match anything above,
    // keep the generic line so the popup still shows SOMETHING.
    if (msgs.length === 0 && (!v || v.ok === false)){
      say('Current selection is not legal.');
    }

    // FINAL fallback: raw object dump. Dev-facing, but helps surface shape.
    if (msgs.length === 0 && v){
      say(phaseLabel + ' not legal: ' + JSON.stringify(v));
    }

    // de-dupe / stable
    const uniq = [];
    msgs.forEach(m => { if (!uniq.includes(m)) uniq.push(m); });
    return uniq;
  }



  function _showRulePopup(v, phaseLabel){
    const wrap = _ensureRulePopup();
    const bullets = _issuesFromValidation(v, phaseLabel);
    if (!bullets.length){
      wrap.style.display = 'none';
      return;
    }

    // build HTML
    let inner = `<div style="font-weight:600;color:#ff5050;margin-bottom:6px;">Fix this before you can confirm:</div>`;
    bullets.forEach(msg => {
      inner += `<div style="margin-left:10px;text-indent:-8px;">• ${msg}</div>`;
    });
    inner += `<div style="margin-top:8px;font-size:11px;opacity:.6;">(click to hide)</div>`;

    wrap.innerHTML = inner;
    wrap.style.display = 'block';
  }

  function _hideRulePopup(){
    const wrap = _ensureRulePopup();
    wrap.style.display = 'none';
  }

  // ------------------------------------------------------------------
  // 1. ATTACKER DECLARATION FLOW
  // ------------------------------------------------------------------


  function beginAttackSelection(){
    // Only the active seat (attacker) can start this
    if (_mySeat() !== _activeSeat()){
      console.warn('[Battle] beginAttackSelection but not my turn');
      return;
    }

    mode = 'attacking';
    currentAttackers   = [];
    blockAssignments   = {};
    activeBlockTarget  = null;
    eligibleAttackers  = new Set(); // reset each combat

    // When we first enter attacker mode, lock out confirm until we know it's legal
    _setConfirmAttackEnabled(false);

    // debug guide Y for later snap
    const gEl  = document.querySelector('.half-guide.bottom');
    if (gEl) {
      const r = gEl.getBoundingClientRect();
      console.log('[Battle] beginAttackSelection guideScreenY', r.top);
    } else {
      console.log('[Battle] beginAttackSelection no .half-guide.bottom');
    }

    // Ask BattleRules who is ACTUALLY legal to attack:
    // (must be mine, untapped, not Defender, power >0, has haste if sick, etc)
    let legalProfiles = [];
    try {
      if (window.BattleRules && typeof window.BattleRules.getEligibleAttackersForSeat === 'function') {
        legalProfiles = window.BattleRules.getEligibleAttackersForSeat(_mySeat());
      } else {
        console.warn('[Battle] BattleRules.getEligibleAttackersForSeat missing');
      }
    } catch (err){
      console.warn('[Battle] error getting eligible attackers', err);
    }

    // ─────────────────────────────
    // CHECKPOINT A1:
    // Dump all obligations/restrictions going into combat
    // ─────────────────────────────
    const mustAttackList            = [];
    const mustAttackIfTagList       = [];
    const cannotAttackAloneList     = [];
    const onlyAttackIfControlList   = [];
    const menaceAttackers           = [];
    const sicknessStates            = [];

    legalProfiles.forEach(p => {
      const flags = window.BattleRules?._extractRestrictionFlags?.(p) || {};

      if (flags.mustAttack) {
        mustAttackList.push({ cid:p.cid, name:p.name || p.title || p.cid });
      }
      if (flags.mustAttackIfTag) {
        mustAttackIfTagList.push({
          cid:p.cid,
          name:p.name || p.title || p.cid,
          tag: flags.mustAttackIfTag
        });
      }
      if (flags.cannotAttackAlone) {
        cannotAttackAloneList.push({
          cid:p.cid,
          name:p.name || p.title || p.cid
        });
      }
      if (flags.onlyAttackIfControlTag) {
        // This is the "⚠️⚔️✅XYZ" restriction:
        onlyAttackIfControlList.push({
          cid:p.cid,
          name:p.name || p.title || p.cid,
          tag: flags.onlyAttackIfControlTag,
          // We don't know enforcement pass/fail here yet; BattleRules should already be
          // excluding illegal ones from legalProfiles. We'll still log the tag.
        });
      }

      // Menace is an ability on the attacker relevant to defender later
      const hasMenace = (p.abilities || []).some(a => /menace/i.test(a));
      if (hasMenace){
        menaceAttackers.push({
          cid:p.cid,
          name:p.name || p.title || p.cid
        });
      }

      sicknessStates.push({
        cid:p.cid,
        name:p.name || p.title || p.cid,
        hasSummoningSickness: !!p.hasSummoningSickness,
        hasHaste: (p.abilities || []).some(a => /haste/i.test(a))
      });
    });

    console.groupCollapsed('%c[Battle][A1] Attacker Phase Obligations','color:#ff0;font-weight:bold;');
    console.log('mustAttack:', mustAttackList);
    console.log('mustAttackIfTag:', mustAttackIfTagList);
    console.log('cannotAttackAlone:', cannotAttackAloneList);
    console.log('onlyAttackIfControlTag:', onlyAttackIfControlList);
    console.log('attackersWithMenace:', menaceAttackers);
    console.log('summoning sickness / haste state:', sicknessStates);
    console.groupEnd();
    // ─────────────────────────────

    // Highlight ONLY legal attackers
    legalProfiles.forEach(prof => {
      const cid = prof?.cid;
      const el  = prof?._el;
      if (!cid || !el) return;

      eligibleAttackers.add(cid);

      // figure out ownership
      const mineSeatStr   = _mySeatStr();          // "1" or "2"
      const ownerSeatStr  = _cardOwnerSeat(el);    // "1" or "2" (or null)
      const isMine        = (ownerSeatStr === mineSeatStr);

      console.groupCollapsed(
        '%c[Battle] attacker candidate (LEGAL)',
        'color:#ffce00;font-weight:bold;',
        {
          cid,
          ownerSeatStr,
          mineSeatStr,
          isMine,
          left: parseFloat(el.style.left)||0,
          top : parseFloat(el.style.top)||0,
          types: prof.types,
          abilities: prof.abilities,
          tapped: prof.isTapped,
          pow: prof.powNum
        }
      );
      console.log('[Battle] raw card element:', el);
      console.log('[Battle] dataset:', el?.dataset);
      console.log('[Battle] window.mySeat():', (typeof window.mySeat==='function' ? window.mySeat() : window.mySeat));
      console.log('[Battle] UserInterface._STATE:', UserInterface?._STATE);
      console.groupEnd();

      // HARD GATE: skip wiring up enemy cards just in case
      if (!isMine) return;

      // allow clicking to toggle attacker status
      el.addEventListener('click', _toggleAttackerSelect, { once:false });
      el.classList.add('battle-canAttack');

      // gold glow ring for selectable attackers
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.boxShadow = '0 0 12px 4px rgba(255,215,0,.7)';
      el.style.filter    = 'drop-shadow(0 0 6px rgba(255,215,0,.9))';
    });

    console.log('[Battle] attack selection STARTED', {
      seat: _mySeat(),
      legalCount: legalProfiles.length,
      legalCids: legalProfiles.map(p => p.cid)
    });

    // 🔍 dump merged combat profiles for sanity:
    try {
      const snap = window.BattleRules?.debugSeatSnapshot?.(_mySeat());
      console.log('[Battle] debugSeatSnapshot (post-beginAttackSelection)', snap);
    } catch(err){
      console.warn('[Battle] debugSeatSnapshot failed', err);
    }

    // Initial validation with no attackers chosen yet
    try {
      const v = window.BattleRules?.validateAttackersSelection?.(currentAttackers.slice(), _mySeat());
      console.log('[Battle][A1] initial validateAttackersSelection()', v);
      _setConfirmAttackEnabled(!!(v && v.ok));
    } catch (err){
      console.warn('[Battle] validateAttackersSelection threw at A1', err);
      _setConfirmAttackEnabled(false);
    }
  }




  function _toggleAttackerSelect(e){
    if (mode !== 'attacking') return;
    const el = e.currentTarget;
    if (!el) return;
    const cid = el.dataset.cid;
    if (!cid) return;

    // Check ownership again at click time
    const mineSeatStr   = _mySeatStr();
    const ownerSeatStr  = _cardOwnerSeat(el);
    const isMine        = (ownerSeatStr === mineSeatStr);

    console.groupCollapsed(
      '%c[Battle] attacker click',
      'color:#ffce00;font-weight:bold;',
      {
        cid,
        ownerSeatStr,
        mineSeatStr,
        isMine,
        mode,
        alreadyChosen: currentAttackers.includes(cid)
      }
    );
    console.log('[Battle] raw card element:', el);
    console.log('[Battle] dataset on card:', el?.dataset);
    console.log('[Battle] window.mySeat():', (typeof window.mySeat==='function' ? window.mySeat() : window.mySeat));
    console.log('[Battle] UserInterface._STATE:', UserInterface?._STATE);
    console.groupEnd();

    // belt+braces: you cannot toggle attackers you don't own
    if (!isMine) {
      console.warn('[Battle] click ignored, not my card');
      return;
    }

    // HARD GATE: if this card was not marked eligible, ignore the click.
    if (!eligibleAttackers.has(cid)) {
      console.log('[Battle] click ignored, not eligible attacker', cid);
      return;
    }

    if (currentAttackers.includes(cid)){
      // unselect
      currentAttackers = currentAttackers.filter(x => x !== cid);
      el.classList.remove('battle-attacking');

      // drop back to "canAttack" glow (gold outline)
      if (el.classList.contains('battle-canAttack')){
        el.style.boxShadow = '0 0 12px 4px rgba(255,215,0,.7)';
        el.style.filter    = 'drop-shadow(0 0 6px rgba(255,215,0,.9))';
      } else {
        el.style.boxShadow = '';
        el.style.filter    = '';
      }

    } else {
      // select
      currentAttackers.push(cid);

      // Store origin ONLY the first time we ever mark it as attacking
      if (!attackerOrigin.has(cid)){
        const curX = parseFloat(el.style.left) || 0;
        const curY = parseFloat(el.style.top)  || 0;
        attackerOrigin.set(cid, { x: curX, y: curY });
        console.log('[Battle] attackerOrigin stored', { cid, x: curX, y: curY });
      }

      el.classList.add('battle-attacking');
      // brighter glow for "locked in as attacker"
      el.style.boxShadow = '0 0 14px 6px rgba(255,215,0,1)';
      el.style.filter    = 'drop-shadow(0 0 10px rgba(255,215,0,1))';
    }

    console.log('[Battle] toggle attacker', {
      cid,
      now: currentAttackers.slice()
    });

    // ─────────────────────────────
    // CHECKPOINT A2:
    // Re-run global legality every toggle.
    // ─────────────────────────────
    try {
      const seat = _mySeat();
      const v = window.BattleRules?.validateAttackersSelection?.(currentAttackers.slice(), seat);
      console.log('[Battle][A2] validateAttackersSelection()', {
        selection: currentAttackers.slice(),
        result: v
      });

// Enable/disable confirm based on v.ok
      const legal = !!(v && v.ok);
      _setConfirmAttackEnabled(legal);
      // Popup logic
      if (legal){
        _hideRulePopup();
      } else {
        _showRulePopup(v, 'Attackers');
      }

      // Also log if any must-attack creature is being "illegally left home"
      // We infer "mustAttack" flags from all my eligible attackers.
      const missingMustAttack = [];
      eligibleAttackers.forEach(attCid => {
        const prof = window.BattleRules?.getCardCombatProfile?.(attCid);
        if (!prof) return;
        const flags = window.BattleRules?._extractRestrictionFlags?.(prof) || {};
        if (flags.mustAttack){
          if (!currentAttackers.includes(attCid)){
            // it's a mustAttack creature that's NOT currently declared
            missingMustAttack.push({
              cid: attCid,
              name: prof.name || prof.title || attCid
            });
          }
        }
      });

      if (missingMustAttack.length){
        console.warn('[Battle][A2] mustAttack not declared yet:', missingMustAttack);
      } else {
        console.log('[Battle][A2] All mustAttack creatures accounted for.');
      }
    } catch(err){
      console.warn('[Battle] validateAttackersSelection threw at A2', err);
      _setConfirmAttackEnabled(false);
      _showRulePopup(null, 'Attackers'); // generic "not legal"
    }
  }




  function confirmAttackers(){
    if (mode !== 'attacking') return;

    // ─────────────────────────────
    // CHECKPOINT A3:
    // Final validation gate before we actually commit.
    // ─────────────────────────────
        try {
      const seat = _mySeat();
      const v = window.BattleRules?.validateAttackersSelection?.(currentAttackers.slice(), seat);
      console.log('[Battle][A3] FINAL validateAttackersSelection()', {
        selection: currentAttackers.slice(),
        result: v
      });

      if (!(v && v.ok)){
        console.warn('[Battle][A3] Attack confirm blocked:', v);
        _setConfirmAttackEnabled(false);
        _showRulePopup(v, 'Attackers');
        return; // DO NOT advance, illegal selection
      }

      // legal
      _hideRulePopup();
    } catch(err){
      console.warn('[Battle] validateAttackersSelection threw at A3', err);
      _setConfirmAttackEnabled(false);
      _showRulePopup(null, 'Attackers');
      return;
    }


    mode = 'idle';

    // Remove click listeners / glow from non-attackers
    document.querySelectorAll('.battle-canAttack').forEach(el => {
      el.removeEventListener('click', _toggleAttackerSelect, { once:false });
      el.classList.remove('battle-canAttack');

      el.style.outline = '';
      el.style.outlineOffset = '';
      if (!el.classList.contains('battle-attacking')){
        el.style.boxShadow = '';
        el.style.filter    = '';
      }
    });

    // SNAP the chosen attackers to the guide line in WORLD space
    _snapAttackersToGuideLine();

    // keep glow maxed on the attackers
    currentAttackers.forEach(cid => {
      const el = _getCardEl(cid);
      if (!el) return;
      el.classList.add('battle-attacking');
      el.style.boxShadow = '0 0 14px 6px rgba(255,215,0,1)';
      el.style.filter    = 'drop-shadow(0 0 10px rgba(255,215,0,1))';
    });

    console.log('[Battle] attackers CONFIRMED + snapped', currentAttackers);

    // Send final MOVE packets for attacker positions (drag-mirror style)
    try {
      const my = window.mySeat?.() ?? 1;

      currentAttackers.forEach(cid => {
        const el = _getCardEl(cid);
        if (!el) return;

        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top)  || 0;

        const snapshot = window._applyOwnershipAfterDrop?.(el);
        const ownerNow = snapshot?.ownerCurrent || my;

        const packetMove = {
          type: 'move',
          cid,
          x,
          y,
          owner: ownerNow
        };

        (window.rtcSend || window.peer?.send)?.(packetMove);
        if (window.CardPlacement?.DBG?.on) {
          console.log('%c[Battle→send final move (attacker)]', 'color:#6cf', packetMove);
        }
      });
    } catch (err) {
      console.warn('[Battle] attacker move sends failed', err);
    }

    // Tell opponent who is swinging
    try {
      window.rtcSend?.({
        type: 'combat_charge',
        cids: currentAttackers.slice()
      });
    } catch(err){
      console.warn('[Battle] rtcSend combat_charge failed', err);
    }

    // After confirm, no need to keep confirm button hot
    _setConfirmAttackEnabled(false);

    // 🟦 After we've declared attackers and sent charge info:
    // remove pulsing gold from my own view
    currentAttackers.forEach(cid => {
      const el = _getCardEl(cid);
      if (!el) return;

      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.boxShadow = '';
      el.style.filter = '';
    });
  }


  // ------------------------------------------------------------------
  // 2. BLOCKER DECLARATION FLOW
  // ------------------------------------------------------------------

  function beginBlockSelection(){
  if (_mySeat() === _activeSeat()){
    console.warn('[Battle] beginBlockSelection but it IS my turn');
    return;
  }

  mode = 'blocking';
  blockAssignments = {};
  activeBlockTarget = null;

  // NEW: run an initial validation pass on the empty assignment map
  // instead of hard-disabling.
  try {
    const attackerCidList = Object.keys(blockAssignments); // <- [] right now
    const v = window.BattleRules?.validateBlockAssignments?.(attackerCidList, blockAssignments);

    console.log('[Battle][B1-init] initial validateBlockAssignments() at block start', {
      assignments: JSON.parse(JSON.stringify(blockAssignments)),
      result: v
    });

    const legal = !!(v && v.ok);
    _setConfirmBlocksEnabled(legal);

    if (legal){
      _hideRulePopup();
    } else {
      _showRulePopup(v, 'Blocks');
    }
  } catch(err){
    console.warn('[Battle] validateBlockAssignments threw at B1-init', err);
    _setConfirmBlocksEnabled(false);
    _showRulePopup(null, 'Blocks');
  }


  // ─────────────────────────────
  // CHECKPOINT B1 (unchanged logging after this)
  // ─────────────────────────────
  try {
    const attackersDbg = currentAttackers.map(attCid => {
      const prof = window.BattleRules?.getCardCombatProfile?.(attCid) || {};
      const atkFlags = window.BattleRules?._extractRestrictionFlags?.(prof) || {};
      const hasMenace = (prof.abilities || []).some(a => /menace/i.test(a));
      const hasFlying = (prof.abilities || []).some(a => /flying/i.test(a));
      const protections = (prof.abilities || []).filter(a => /protection/i.test(a));

      return {
        cid: attCid,
        name: prof.name || prof.title || attCid,
        menace: hasMenace,
        flying: hasFlying,
        protectionList: protections,
        rawFlags: atkFlags
      };
    });

    const mySeatNow = _mySeat();
    let allMyProfiles = [];
    if (window.BattleRules?.getAllProfilesForSeat){
      allMyProfiles = window.BattleRules.getAllProfilesForSeat(mySeatNow) || [];
    }

    const blockersDbg = allMyProfiles.map(p => {
      const flags = window.BattleRules?._extractRestrictionFlags?.(p) || {};
      return {
        cid: p.cid,
        name: p.name || p.title || p.cid,
        cannotBlock: !!flags.cannotBlock,
        cannotBlockAlone: !!flags.cannotBlockAlone,
        onlyBlockTag: flags.onlyBlockTag || null,
        inCommandZone: p.inCommandZone === true,
        tapped: p.isTapped === true,
        flying: (p.abilities||[]).some(a=>/flying/i.test(a)),
        reach:  (p.abilities||[]).some(a=>/reach/i.test(a))
      };
    });

    console.groupCollapsed('%c[Battle][B1] Block Phase Snapshot','color:#9cf;font-weight:bold;');
    console.log('Incoming attackers:', attackersDbg);
    console.log('My potential blockers:', blockersDbg);
    console.groupEnd();
  } catch(err){
    console.warn('[Battle] B1 snapshot failed', err);
  }

  // make attackers clickable, etc (unchanged below here)
  currentAttackers.forEach(cid => {
    const el = _getCardEl(cid);
    if (!el) return;
    el.addEventListener('click', _chooseAttackTargetForBlock, { once:false });
    el.classList.add('battle-canBeBlocked');

    el.style.outline = '';
    el.style.outlineOffset = '';
    el.style.boxShadow = '0 0 14px 6px rgba(255,215,0,1)';
    el.style.filter    = 'drop-shadow(0 0 10px rgba(255,215,0,1))';
  });

  console.log('[Battle] block selection STARTED');
}



  // attacker picked for blocking target
// - highlights ONLY legal blockers (creatures you control that can block it)
// - focused attacker shows a STRONG BLUE glow (no gold); others keep GOLD
function _chooseAttackTargetForBlock(e){
  if (mode !== 'blocking') return;
  const el = e.currentTarget;
  if (!el) return;
  const attackerCid = el.dataset.cid;
  if (!attackerCid) return;

  // Glow presets
  const GOLD_BOX  = '0 0 14px 6px rgba(255,215,0,1)';
  const GOLD_FILT = 'drop-shadow(0 0 10px rgba(255,215,0,1))';

  // 🔵 stronger blue to match gold intensity
  const BLUE_OUTLINE = '2px solid #9cf';
  const BLUE_BOX  = '0 0 16px 8px rgba(0,160,255,1)';
  const BLUE_FILT = 'drop-shadow(0 0 12px rgba(0,160,255,1))';

  // 1) Restore previous focus (give it GOLD back)
  if (activeBlockTarget && activeBlockTarget !== attackerCid) {
    const prev = _getCardEl(activeBlockTarget);
    if (prev) {
      prev.style.outline = '';
      prev.style.outlineOffset = '';
      prev.style.boxShadow = (prev.dataset.prevBoxShadow !== undefined)
        ? prev.dataset.prevBoxShadow
        : GOLD_BOX;
      prev.style.filter = (prev.dataset.prevFilter !== undefined)
        ? prev.dataset.prevFilter
        : GOLD_FILT;
      delete prev.dataset.prevBoxShadow;
      delete prev.dataset.prevFilter;
    }
  }

  // 2) Apply BLUE focus (full glow) to this attacker
  if (el.dataset.prevBoxShadow === undefined) el.dataset.prevBoxShadow = el.style.boxShadow || GOLD_BOX;
  if (el.dataset.prevFilter === undefined)    el.dataset.prevFilter    = el.style.filter    || GOLD_FILT;

  el.style.outline = BLUE_OUTLINE;
  el.style.outlineOffset = '-3px';
  el.style.boxShadow = BLUE_BOX;  // full blue glow (replaces gold)
  el.style.filter    = BLUE_FILT; // blue drop-shadow to match intensity

  // 3) Track active target
  activeBlockTarget = attackerCid;
  if (!blockAssignments[attackerCid]) blockAssignments[attackerCid] = [];

  // ─────────────────────────────
  // CHECKPOINT B2 (unchanged diagnostics)
  // ─────────────────────────────
  try {
    const prof = window.BattleRules?.getCardCombatProfile?.(attackerCid) || {};
    const atkFlags = window.BattleRules?._extractRestrictionFlags?.(prof) || {};
    const hasMenace   = (prof.abilities || []).some(a => /menace/i.test(a));
    const hasFlying   = (prof.abilities || []).some(a => /flying/i.test(a));
    const protections = (prof.abilities || []).filter(a => /protection/i.test(a));
    console.groupCollapsed('%c[Battle][B2] Attacker Focus','color:#0ff;font-weight:bold;');
    console.log('attackerCid:', attackerCid);
    console.log('name:', prof.name || prof.title || attackerCid);
    console.log('menace:', hasMenace);
    console.log('flying:', hasFlying);
    console.log('protection keywords:', protections);
    console.log('raw flags:', atkFlags);
    console.groupEnd();

    const dbgEligible = (window.BattleRules?.getEligibleBlockersForTarget?.(attackerCid, _mySeat()) || [])
      .map(p => ({ cid:p.cid, name:p.name, tapped:p.isTapped, inCommandZone:p.inCommandZone===true,
                   abilities:p.abilities, types:p.types, powNum:p.powNum, touNum:p.touNum }));
    console.log('[Battle][B2] Eligible blockers for this attacker:', dbgEligible);
  } catch(err){
    console.warn('[Battle] blocker detail dump failed', err);
  }

  // 4) Clear old canBlock highlights
  document.querySelectorAll('.battle-canBlock').forEach(card => {
    card.removeEventListener('click', _assignBlockerToActiveAttacker, { once:false });
    card.classList.remove('battle-canBlock');
    card.style.outline = '';
    card.style.outlineOffset = '';
    card.style.boxShadow = '';
    card.style.filter    = '';
  });

  // 5) Ask rules for legal blockers
  let legalBlockerProfiles = [];
  try {
    if (window.BattleRules && typeof window.BattleRules.getEligibleBlockersForTarget === 'function') {
      legalBlockerProfiles = window.BattleRules.getEligibleBlockersForTarget(attackerCid, _mySeat());
    } else {
      console.warn('[Battle] BattleRules.getEligibleBlockersForTarget missing');
    }
  } catch(err){
    console.warn('[Battle] error getting eligible blockers', err);
  }

  // 6) Highlight legal blockers (gold)
  legalBlockerProfiles.forEach(prof => {
    const card = prof?._el;
    if (!card) return;
    if (currentAttackers.includes(card.dataset.cid)) return;

    card.addEventListener('click', _assignBlockerToActiveAttacker, { once:false });
    card.classList.add('battle-canBlock');
    card.style.outline = '';
    card.style.outlineOffset = '';
    card.style.boxShadow = '0 0 12px 4px rgba(255,215,0,.7)';
    card.style.filter    = 'drop-shadow(0 0 10px rgba(255,215,0,1))';
  });

  console.log('[Battle] now blocking attacker', { attackerCid });

  // 7) Re-validate assignments
  try {
    const attackerCidList = Object.keys(blockAssignments);
    const v = window.BattleRules?.validateBlockAssignments?.(attackerCidList, blockAssignments);
    console.log('[Battle][B5-switch] validateBlockAssignments() after switching target', {
      assignments: JSON.parse(JSON.stringify(blockAssignments)),
      result: v
    });
    const legal = !!(v && v.ok);
    _setConfirmBlocksEnabled(legal);
    if (legal){ _hideRulePopup(); } else { _showRulePopup(v, 'Blocks'); }
  } catch(err){
    console.warn('[Battle] validateBlockAssignments threw at B5-switch', err);
    _setConfirmBlocksEnabled(false);
    _showRulePopup(null, 'Blocks');
  }
}




    function _assignBlockerToActiveAttacker(e){
    if (mode !== 'blocking') return;
    const el = e.currentTarget;
    if (!el) return;
    const blockerCid = el.dataset.cid;
    if (!blockerCid) return;
    if (!activeBlockTarget) return;

    // add this blocker to the assignment list for the chosen attacker
    const list = blockAssignments[activeBlockTarget] || [];
    if (!list.includes(blockerCid)){
      list.push(blockerCid);
      blockAssignments[activeBlockTarget] = list;
    }

    console.log('[Battle] assign blocker', {
      attackerCid: activeBlockTarget,
      blockerCid,
      map: blockAssignments
    });

    // Lay out blockers for THIS attacker (and mark them clickable-to-unassign)
    _poseBlockersFor(activeBlockTarget);

    // This blocker is now considered "assigned", so remove the generic canBlock glow
    // and stop listening for _assignBlockerToActiveAttacker on it specifically.
    el.removeEventListener('click', _assignBlockerToActiveAttacker, { once:false });
    el.classList.remove('battle-canBlock');

    el.style.outline = '';
    el.style.outlineOffset = '';
    el.style.boxShadow = '';
    el.style.filter = '';

    // ─────────────────────────────
    // CHECKPOINT B3 / B4:
    // Every assign (and every future unassign calls this same logic elsewhere)
    // we rebuild assignments and validate ALL of them.
    // Menace, cannotBlockAlone, etc. all get checked here.
    // ─────────────────────────────
       try {
      const attackerCidList = Object.keys(blockAssignments);
      const v = window.BattleRules?.validateBlockAssignments?.(attackerCidList, blockAssignments);

      console.log('[Battle][B3/B4] validateBlockAssignments() after assign', {
        assignments: JSON.parse(JSON.stringify(blockAssignments)),
        result: v
      });

      const legal = !!(v && v.ok);
      _setConfirmBlocksEnabled(legal);

      if (legal){
        _hideRulePopup();
      } else {
        _showRulePopup(v, 'Blocks');
      }
    } catch(err){
      console.warn('[Battle] validateBlockAssignments threw at B3/B4', err);
      _setConfirmBlocksEnabled(false);
      _showRulePopup(null, 'Blocks');
    }

  }






  function confirmBlocks(){
    if (mode !== 'blocking') return;

    // Final legality check before we lock blocks
    // (Menace needs 2+, cannotBlockAlone can't be solo, etc.)
       try {
      const attackerCidList = Object.keys(blockAssignments);
      const v = window.BattleRules?.validateBlockAssignments?.(attackerCidList, blockAssignments);

      console.log('[Battle][B3-final] FINAL validateBlockAssignments()', {
        assignments: JSON.parse(JSON.stringify(blockAssignments)),
        result: v
      });

      if (!(v && v.ok)){
        console.warn('[Battle][B3-final] Block confirm blocked:', v);
        _setConfirmBlocksEnabled(false);
        _showRulePopup(v, 'Blocks');
        return; // illegal, do not advance
      }

      // legal
      _hideRulePopup();

    } catch(err){
      console.warn('[Battle] validateBlockAssignments threw at confirmBlocks', err);
      _setConfirmBlocksEnabled(false);
      _showRulePopup(null, 'Blocks');
      return;
    }


    mode = 'idle';

    document.querySelectorAll('.battle-canBeBlocked').forEach(el => {
      el.removeEventListener('click', _chooseAttackTargetForBlock, { once:false });
      el.classList.remove('battle-canBeBlocked');

      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.boxShadow = '';
      el.style.filter = '';
    });

    document.querySelectorAll('.battle-canBlock').forEach(el => {
      el.removeEventListener('click', _assignBlockerToActiveAttacker, { once:false });
      el.classList.remove('battle-canBlock');

      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.boxShadow = '';
      el.style.filter = '';
    });

    console.log('[Battle] blocks CONFIRMED', blockAssignments);

    try {
      window.rtcSend?.({
        type: 'combat_blocks',
        map: { ...blockAssignments }
      });
    } catch(err){
      console.warn('[Battle] rtcSend combat_blocks failed', err);
    }

       try {
      showResolutionPreview(currentAttackers.slice(), { ...blockAssignments });
    } catch (err){
      console.warn('[Battle] showResolutionPreview failed', err);
    }

    // IMPORTANT CHANGE:
    // We DO NOT touch _setConfirmBlocksEnabled(false) here anymore.
    // Combat is over, mode is idle, so the shield button visuals will
    // get reset next time beginBlockSelection() runs and validates fresh.

    // 🟦 FIXED RETURN LOGIC (unchanged):
    try {
      const mySeatNum = (window.mySeat?.() ?? _mySeat() ?? 1);

      blockerOrigin.forEach((origPos, blockerCid) => {
        const el = document.querySelector(`img.table-card[data-cid="${blockerCid}"]`);
        if (!el) return;

        const ownerNow = Number(el.dataset?.ownerCurrent || el.dataset?.owner || -1);
        if (ownerNow !== mySeatNum) return;

        el.style.left = `${origPos.x}px`;
        el.style.top  = `${origPos.y}px`;

        el.style.zIndex = '';
        el.classList.remove('battle-blocker','battle-blocker-activeClick');
        el.style.outline = '';
        el.style.outlineOffset = '';
        el.style.boxShadow = '';
        el.style.filter = '';
        delete el.dataset.blockingFor;

        try {
          const snap = window._applyOwnershipAfterDrop?.(el);
          const finalOwner = snap?.ownerCurrent || ownerNow;

          const packetMove = {
            type: 'move',
            cid: blockerCid,
            x: origPos.x,
            y: origPos.y,
            owner: finalOwner
          };

          (window.rtcSend || window.peer?.send)?.(packetMove);
          if (window.CardPlacement?.DBG?.on) {
            console.log('%c[Battle→send move (blocker return all)]', 'color:#6cf', packetMove);
          }
        } catch(sendErr){
          console.warn('[Battle] blocker return move send failed', sendErr);
        }

        console.log('[Battle] restored blocker', {
          blockerCid,
          x: origPos.x,
          y: origPos.y
        });
      });

      blockerOrigin.clear();
    } catch(err){
      console.warn('[Battle] blocker return loop failed', err);
    }
}



  // ------------------------------------------------------------------
  // 3. REMOTE MIRROR HELPERS
  // ------------------------------------------------------------------

function applyRemoteCharge(cidList){
  if (!Array.isArray(cidList)) cidList = [];
  currentAttackers = cidList.slice();

  // We assume move packets already positioned these on defender screen.
  // Just mark them as attackers, but remove glow after short delay.
  cidList.forEach(cid => {
    const el = _getCardEl(cid);
    if (!el) return;
    el.classList.add('battle-attacking');

    // brief highlight during "charge" animation for visibility
    el.style.boxShadow = '0 0 14px 6px rgba(255,215,0,1)';
    el.style.filter    = 'drop-shadow(0 0 10px rgba(255,215,0,1))';

    // 🟦 remove glow after ~700ms once they've reached combat zone
    setTimeout(() => {
      el.style.boxShadow = '';
      el.style.filter = '';
    }, 700);
  });

  console.log('[Battle] applyRemoteCharge (defender view glow auto-clear)', cidList);
}


function applyRemoteBlocks(map){
  console.log('[Battle] combat_blocks received', map);

  const my = window.mySeat?.() ?? -1;
  const active = window.UserInterface?._STATE?.activeSeat ?? -1;
  const amAttacker = (my === active);

  console.log(`[Battle] My seat: ${my}, Active seat: ${active}, I am ${amAttacker ? 'the attacker' : 'the defender'}`);

  // -----------------------------------------------------
  // If I'm the defender → move my blockers back
  // -----------------------------------------------------
  if (!amAttacker) {
    for (const [blockerCid, attackerCid] of Object.entries(map)){
      const el = document.querySelector(`img.table-card[data-cid="${blockerCid}"]`);
      if (!el) continue;

      const owner = Number(el.dataset?.owner ?? -1);
      if (owner !== my) continue; // Only my blockers

      const sx = Number(el.dataset?.x || 0);
      const sy = Number(el.dataset?.y || 0);
      const { wx, wy } = window._screenToWorld(sx, sy);

      el.style.left = `${wx}px`;
      el.style.top  = `${wy}px`;

      window.rtcSend?.({
        type: 'move',
        cid: blockerCid,
        x: wx,
        y: wy,
        owner
      });

      console.log('[Battle] Defender moved blocker back', blockerCid, wx, wy);
    }
  }

  // -----------------------------------------------------
  // If I'm the attacker → move my attackers back
  // -----------------------------------------------------
  else {
    for (const [cid, orig] of (window.attackerOrigin?.entries?.() ?? [])){
      const el = document.querySelector(`img.table-card[data-cid="${cid}"]`);
      if (!el) continue;

      const owner = Number(el.dataset?.owner ?? -1);
      if (owner !== my) continue; // Only my attackers

      el.style.left = `${orig.x}px`;
      el.style.top  = `${orig.y}px`;

      window.rtcSend?.({
        type: 'move',
        cid,
        x: orig.x,
        y: orig.y,
        owner
      });

      console.log('[Battle] Attacker moved attacker back', cid, orig.x, orig.y);
    }
  }

  // Optional: mark combat UI done
  try {
    window.UserInterface?.markBlocksComplete?.(map);
  } catch {}
}




   // ------------------------------------------------------------------
  // 4. RESOLUTION PREVIEW (+ auto resolve)
  // ------------------------------------------------------------------

  function showResolutionPreview(attackerList, blockMap){
    let html = '<div style="font-family:sans-serif;color:#fff;padding:16px;">';
    html += `<div style="font-weight:700;margin-bottom:8px;">Combat Preview</div>`;

    attackerList.forEach(attCid => {
      const aEl   = _getCardEl(attCid);
      const aName = aEl?.dataset?.name || aEl?.title || `Attacker ${attCid}`;
      const blockers = blockMap[attCid] || [];

      if (!blockers.length){
        html += `<div style="margin:4px 0 12px 0;">
          <div>${aName} is UNBLOCKED → damage to defending player</div>
        </div>`;
      } else {
        html += `<div style="margin:4px 0 12px 0;">
          <div>${aName} is blocked by:</div>`;
        blockers.forEach((bCid,i) => {
          const bEl   = _getCardEl(bCid);
          const bName = bEl?.dataset?.name || bEl?.title || `Blocker ${bCid}`;
          html += `<div style="margin-left:12px;">${i+1}. ${bName}</div>`;
        });
        html += `</div>`;
      }
    });

    // (footer removed)

    html += `</div>`;
    _showOverlay(html);

    // Auto-resolve immediately after preview renders.
    try {
      // Equivalent to:
      // Battle.resolveCombat(Battle._debug.state().currentAttackers, Battle._debug.state().blockAssignments)
      resolveCombat(attackerList, blockMap);
    } catch (err){
      console.warn('[Battle] auto resolve after preview failed:', err);
    }
  }


  // Simple click-to-dismiss overlay
  function _showOverlay(html){
    let wrap = document.getElementById('combatPreviewOverlay');
    if (!wrap){
      wrap = document.createElement('div');
      wrap.id = 'combatPreviewOverlay';
      Object.assign(wrap.style, {
        position:'fixed',
        left:'50%', top:'50%',
        transform:'translate(-50%, -50%)',
        background:'rgba(0,0,0,.85)',
        border:'1px solid rgba(255,255,255,.2)',
        borderRadius:'12px',
        padding:'16px',
        zIndex:'2147483000',
        maxWidth:'300px',
        fontSize:'14px',
        lineHeight:'1.4',
        boxShadow:'0 20px 40px rgba(0,0,0,.8)'
      });
      document.body.appendChild(wrap);

      wrap.addEventListener('click', () => {
        wrap.remove();
      }, { once:false });
    }
    wrap.innerHTML = html;
  }

  // ------------------------------------------------------------------
  // 5. Public API
  // ------------------------------------------------------------------

 // 🟦 DEBUG: expose attacker/blocker origin maps for remote sync logic
  window.attackerOrigin = attackerOrigin;
  window.blockerOrigin  = blockerOrigin;

return {
  // attacker flow
  beginAttackSelection,
  confirmAttackers,

  // resolution (new)
  resolveCombat,

    // defender flow
    beginBlockSelection,
    confirmBlocks,

    // mirror from RTC
    applyRemoteCharge,
    applyRemoteBlocks,

    // preview UI
    showResolutionPreview,

    getMode() { return mode; },

    _debug: {
      state: () => ({
        mode,
        currentAttackers: currentAttackers.slice(),
        blockAssignments: JSON.parse(JSON.stringify(blockAssignments)),
        activeBlockTarget
      }),
      _snapAttackersToGuideLine,
      _clearCombatPoses
    }
  };
})();

window.Battle = Battle;
