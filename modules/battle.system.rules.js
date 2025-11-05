// modules/battle.system.rules.js
// Combat rules helpers (type/ability lookup, eligibility, etc.).
//
// Public API (on window.BattleRules):
//   BattleRules.getCardCombatProfile(cid)
//
//   BattleRules.canAttack(cid, mySeat)               // legacy alias of canAttackNow
//   BattleRules.canAttackNow(cid, mySeat)            // checks sickness, haste, etc.
//   BattleRules.wouldBeAbleButSick(cid, mySeat)      // ONLY thing stopping it is summoning sickness
//   BattleRules.getEligibleAttackersForSeat(mySeat)  // returns only fully legal attackers (no sickness)
//   BattleRules.getSickButOtherwiseEligibleForSeat(mySeat) // returns "red glow" attackers
//
//   BattleRules.validateAttackersSelection(attackerCidList, mySeat)
//     -> { ok:true } OR { ok:false, reason:"..." }
//     (enforces ⚠️⚔️🚫Alone AFTER you've chosen attackers)
//
//   BattleRules.canBlock(attackerCid, blockerCid, defenderSeat)
//   BattleRules.getEligibleBlockersForTarget(attackerCid, defenderSeat)
//
//   BattleRules.validateBlockAssignments(attackerCidList, assignmentsObj)
//     -> { ok:true } OR { ok:false, reason:"..." }
//     (enforces Menace AND ⚠️🛡️🚫Alone-on-blocker AFTER you've assigned blockers)
//
//   BattleRules.compareForBlock(attackerCid, blockerCid)
//
//   BattleRules.getAllProfilesForSeat(seatIgnored) // returns ALL cids on table
//   BattleRules.debugSeatSnapshot(seatIgnored)     // pretty-print for console
//
// EXPECTS badges.js has already populated Badges._storeDebug(cid),
// and cards are <img.table-card data-cid="..."> with datasets like
// data-owner / data-ownerCurrent / data-mana-cost / etc.

(function(){

  // ------------------------------------------------------------
  // INTERNAL HELPERS
  // ------------------------------------------------------------

  // read Badges' internal tracking for a cid
  function _getInfoFromBadges(cid){
    if (!cid) return null;
    if (!window.Badges || typeof window.Badges._storeDebug !== 'function') {
      console.warn('[BattleRules] Badges._storeDebug() missing. Did you load badges.js first?');
      return null;
    }
    const info = window.Badges._storeDebug(cid);
    if (!info) {
      // not currently tracked / maybe not attached yet
      return null;
    }
    return info;
  }

  // pull the actual DOM img.table-card for this cid
  function _getCardElement(cid){
    if (!cid) return null;
    return document.querySelector(`img.table-card[data-cid="${cid}"]`);
  }

  // figure out which seat owns a DOM card
  // We'll STILL try to infer a numeric seat here, but now we'll also
  // expose ownerCurrent / ownerOriginal directly for debugging.
  function _ownerSeatForCard(el){
    if (!el) return null;
    const d = el.dataset || {};

    // Try every known variant
    const raw =
      d.ownerCurrent ??
      d['owner-current'] ??
      d.owner ??
      d.ownerOriginal ??
      '';

    // Numeric parse
    const m = String(raw).match(/\d+/);
    if (m && m[0]) return parseInt(m[0], 10);

    // Fallback: infer by side
    if (d.fieldSide && typeof window.mySeat === 'function') {
      const me = Number(window.mySeat());
      const opp = me === 1 ? 2 : 1;
      if (d.fieldSide === 'bottom') return me;
      if (d.fieldSide === 'top')    return opp;
    }

    return null;
  }

  // grab ownerCurrent / ownerOriginal text directly from dataset
  function _ownerStrings(el){
    const d = el?.dataset || {};
    return {
      ownerCurrent:  d.ownerCurrent  ?? null,
      ownerOriginal: d.ownerOriginal ?? null
    };
  }

  // extract color identity-ish info from dataset.manaCost
  // ex "{U}{B}{R}" -> ["U","B","R"]
  function _extractColors(el){
    const cost = el?.dataset?.manaCost || '';
    const matches = cost.match(/\{([WUBRG])\}/g) || [];
    const cols = new Set();
    for (const m of matches){
      const c = m.replace(/\{|\}/g,'');
      if (c && 'WUBRG'.includes(c)) cols.add(c);
    }
    return Array.from(cols);
  }

  // parse raw abilities text out of oracle/granted (mirrors badges.js logic)
  function _parseOracleAbilities(tx=''){
    const s = ` ${String(tx).replace(/\W+/g,' ').toLowerCase()} `;
    const keys = [
      'flying','deathtouch','trample','vigilance','haste','lifelink','menace','reach',
      'first strike','double strike','hexproof','indestructible','shroud','ward',
      'prowess','defender'
    ];
    const found = new Set();
    for (const k of keys){
      if (s.includes(` ${k} `)) {
        // Capitalize each word so it matches panel look
        found.add(k.replace(/\b\w/g, m => m.toUpperCase()));
      }
    }
    return found;
  }

  // simple helper to check if a profile "has ability X"
  function _hasAbility(prof, needle){
    const n = String(needle||'').toLowerCase();
    return Array.isArray(prof?.abilities) &&
      prof.abilities.some(a => String(a).toLowerCase() === n);
  }

  // parse types/subtypes the same way badges.js does
  function _parseTypeBadges(typeline = '') {
    const [leftRaw = '', rightRaw = ''] = String(typeline).split(/—|-/);
    const leftTokens  = leftRaw.split(/\s+/).filter(Boolean);
    const rightTokens = rightRaw.split(/\s+/).filter(Boolean);

    const SUPER = new Set(['Legendary','Basic','Snow','World','Ongoing','Token','Tribal']);
    const CORE  = new Set(['Artifact','Creature','Enchantment','Instant','Land','Planeswalker','Sorcery','Battle','Vehicle']);

    const out  = [];
    const seen = new Set();

    const push = (t) => {
      const k = String(t).trim();
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(k);
    };

    // Priority ordering like badges.js:
    for (const t of leftTokens) if (SUPER.has(t)) push(t);
    for (const t of leftTokens) if (CORE.has(t))  push(t);
    for (const t of leftTokens) if (!SUPER.has(t) && !CORE.has(t)) push(t);
    for (const t of rightTokens) push(t);

    return out;
  }

  // Build the merged combat profile for a cid.
  // This is our truth snapshot for logic.
  function _buildProfile(info){
    if (!info || !info.anchor) return null;
    const el = info.anchor;

    const cid   = el.dataset.cid || null;
    const name  = el.dataset.name || el.title || el.alt || '';

    // ownership info
    const seatGuess = _ownerSeatForCard(el);  // numeric if we can parse it
    const { ownerCurrent, ownerOriginal } = _ownerStrings(el);

    // color info
    const colorsArr    = _extractColors(el);          // ["U","B","R"] etc.
    const manaCostRaw  = el.dataset.manaCost || '';   // keep raw too

    // base from dataset
    const baseTypeLine = el.dataset.typeLine || '';
    const baseOracle   = el.dataset.oracle   || '';

    // parse base keywords
    const baseTypes = _parseTypeBadges(baseTypeLine);      // ["Legendary","Creature","Goblin",...]
    const abilSet   = _parseOracleAbilities(baseOracle);   // Set("Flying","Trample","Defender",...)

    // granted (CardAttributes / remoteAttrs)
    const grant = info.__grant || { abilities: [], types: [] };

    // merge in granted TYPES
    const mergedTypes = baseTypes.slice();
    const typeSeen = new Set(baseTypes.map(t => String(t)));
    for (const t of (grant.types || [])) {
      const k = String(t).trim();
      if (k && !typeSeen.has(k)) {
        typeSeen.add(k);
        mergedTypes.push(k);
      }
    }

    // merge in granted ABILITIES
    for (const a of (grant.abilities || [])) {
      const k = String(a).trim();
      if (k) {
        abilSet.add(k.replace(/\b\w/g, m => m.toUpperCase()));
      }
    }

    // temp buffs/debuffs (RulesStore tempBuffs in badges.js)
    // info.__rulesBuffs is an array of objects with .text like:
    // "+1/+1 EOT", "🛡️Red PERM", "🚩Artifact PERM"
    const buffsRaw = Array.isArray(info.__rulesBuffs)
      ? info.__rulesBuffs.slice()
      : [];
    const buffsPretty = [];
    for (const b of buffsRaw){
      const txt = String(b?.text || '').trim();
      if (!txt) continue;
      buffsPretty.push(txt);

      // take text, strip trailing " PERM", " EOT", etc.,
      // push cleaned into abilities so stuff like 🛡️Red and 🚩Artifact
      // lives in p.abilities for our combat logic.
      const cleaned = txt.replace(/\s+(PERM|EOT|EOY|EOC|EoT|Until EOT)$/i, '').trim();
      if (cleaned) {
        abilSet.add(cleaned);
      }
    }

    // final PT that badges sticker would show
    let ptFinal = '';

    if (info.__rulesPT
        && Number.isFinite(info.__rulesPT.powFinal)
        && Number.isFinite(info.__rulesPT.touFinal)) {
      ptFinal = `${info.__rulesPT.powFinal|0}/${info.__rulesPT.touFinal|0}`;
    }

    if (!ptFinal && Number.isFinite(info.__grant?._pow) && Number.isFinite(info.__grant?._tou)) {
      ptFinal = `${info.__grant._pow|0}/${info.__grant._tou|0}`;
    }

    if (!ptFinal && info.anchor.dataset.ptCurrent) {
      ptFinal = info.anchor.dataset.ptCurrent;
    }

    if (!ptFinal &&
        el.dataset.power !== undefined && el.dataset.power !== '' &&
        el.dataset.toughness !== undefined && el.dataset.toughness !== '') {
      ptFinal = `${el.dataset.power|0}/${el.dataset.toughness|0}`;
    }

    // parse PT numbers out of ptFinal like "5/5"
    let powNum = null;
    let touNum = null;
    if (ptFinal && ptFinal.includes('/')) {
      const [pStr,tStr] = ptFinal.split('/');
      const pVal = parseInt(pStr,10);
      const tVal = parseInt(tStr,10);
      if (Number.isFinite(pVal)) powNum = pVal;
      if (Number.isFinite(tVal)) touNum = tVal;
    }

    // ORIGINAL printed/base PT for this face (pre-buffs)
    let powBase = null;
    let touBase = null;
    if (el.dataset.power !== undefined && el.dataset.power !== '') {
      const p0 = parseInt(el.dataset.power,10);
      if (Number.isFinite(p0)) powBase = p0;
    }
    if (el.dataset.toughness !== undefined && el.dataset.toughness !== '') {
      const t0 = parseInt(el.dataset.toughness,10);
      if (Number.isFinite(t0)) touBase = t0;
    }

    // tapped?
    const tappedFlag = (
      el.dataset.tapped === '1' ||
      el.classList.contains('is-tapped')
    );

    // summoning sickness flags we're willing to accept:
    // we'll treat any of these truthy strings as "has summoning sickness"
    const sickFlag = (
      el.dataset.summoningSick === '1' ||
      el.dataset.summoningSick === 'true' ||
      el.dataset.hasSummoningSickness === 'true' ||
      el.dataset.summoningSickness === 'true'
    ) ? true : false;

    // commander / command zone check:
    const inCmd = (
      el.dataset.inCommandZone === 'true' ||
      el.dataset.inCommandZone === true ||
      String(el.dataset.zone||'').toLowerCase() === 'command' ||
      String(el.dataset.zone||'').toLowerCase() === 'commander' ||
      String(el.dataset.zone||'').toLowerCase() === 'commandzone'
    );

    return {
      cid,
      name,

      // ownership
      seat:        seatGuess,      // numeric guess at seat
      ownerCurrent,
      ownerOriginal,

      // mana / color
      manaCostRaw,                 // "{U}{B}{R}" etc.
      colors: colorsArr,           // ["U","B","R"]

      // state
      types: mergedTypes,                 // final types/subtypes (incl. granted)
      abilities: Array.from(abilSet),     // final abilities (incl. 🛡️Red, 🚩Artifact, etc.)
      buffs: buffsPretty,                 // raw buff strings with durations
      ptFinal,
      powNum,                              // final numeric P
      touNum,                              // final numeric T
      powBase,                             // printed base P
      touBase,                             // printed base T
      isTapped: tappedFlag,

      // NEW: commander / zone awareness
      inCommandZone: !!inCmd,

      // NEW: summoning sickness awareness
      hasSummoningSickness: sickFlag,

      // internals if combat math / UI needs them later:
      _rulesPT: info.__rulesPT || null,
      _grant:   info.__grant   || null,
      _el:      el
    };

  }

  // ------------------------------------------------------------
  // CORE PUBLIC PROFILE GETTER
  // ------------------------------------------------------------
  function getCardCombatProfile(cid){
    const info = _getInfoFromBadges(cid);
    if (!info) return null;
    return _buildProfile(info);
  }

  // ------------------------------------------------------------
  // SMALL HELPERS FOR ELIGIBILITY
  // ------------------------------------------------------------
  function _isOnBattlefield(prof){
    // If it's marked in command zone, or otherwise off-board, it shouldn't act.
    if (!prof) return false;
    if (prof.inCommandZone === true) return false;
    return true;
  }

  // ------------------------------------------------------------
  // HELPER: parse special combat restriction flags from abilities
  // ------------------------------------------------------------
  function _extractRestrictionFlags(prof){
    const out = {
      cannotBlock: false,              // 🚫Block / 🚫Blocking / 🚫Blocks
      cannotBlockAlone: false,         // ⚠️🛡️🚫Alone
      onlyBlockTag: null,              // ⚠️🛡️XYZ  (can only block XYZ)
      onlyAttackTag: null,             // ⚠️⚔️XYZ   (can only attack XYZ)  [future targeting logic]
      onlyAttackIfControlTag: null,    // ⚠️⚔️✅XYZ  (can only attack if you control XYZ)
      cannotAttackAlone: false,        // ⚠️⚔️🚫Alone
      mustAttack: false,               // ⚠️⚔️⚔️
      mustAttackIfTag: null            // ⚠️⚔️⚔️XYZ
    };

    if (!prof || !Array.isArray(prof.abilities)) return out;

    prof.abilities.forEach(raw => {
      const a = String(raw || '').trim();

      // 🚫Block / 🚫Blocking / 🚫Blocks = cannot block at all
      if (/🚫\s*(block(ing)?|blocks)/i.test(a)) {
        out.cannotBlock = true;
      }

      // ⚠️🛡️🚫Alone  (this blocker may NOT be the only blocker)
      if (/^⚠️🛡️🚫\s*Alone/i.test(a)) {
        out.cannotBlockAlone = true;
      }

      // ⚠️🛡️XYZ  (block restriction: "can only block XYZ")
      if (a.startsWith('⚠️🛡️')) {
        // But skip the 🚫Alone form we already handled
        if (!a.startsWith('⚠️🛡️🚫')) {
          const tag = a.replace(/^⚠️🛡️/,'').trim();
          if (tag) out.onlyBlockTag = tag;
        }
      }

      // ⚠️⚔️✅XYZ  (attack restriction: "can only attack if you control XYZ")
      if (a.startsWith('⚠️⚔️✅')) {
        const tag = a.replace(/^⚠️⚔️✅/,'').trim();
        if (tag) out.onlyAttackIfControlTag = tag;
      }

      // ⚠️⚔️🚫Alone  (cannot attack alone)
      if (/^⚠️⚔️🚫\s*Alone/i.test(a)) {
        out.cannotAttackAlone = true;
      }

      // ⚠️⚔️⚔️XYZ  (must attack condition)
      if (a.startsWith('⚠️⚔️⚔️')) {
        const tail = a.replace(/^⚠️⚔️⚔️/,'').trim();
        if (tail) {
          out.mustAttackIfTag = tail;
        } else {
          out.mustAttack = true;
        }
      }

      // ⚠️⚔️XYZ  (can only attack XYZ)  -- NOTE: skip ones already handled above
      if (a.startsWith('⚠️⚔️')
          && !a.startsWith('⚠️⚔️✅')
          && !a.startsWith('⚠️⚔️🚫')
          && !a.startsWith('⚠️⚔️⚔️')) {
        const tail = a.replace(/^⚠️⚔️/,'').trim();
        if (tail) out.onlyAttackTag = tail;
      }
    });

    return out;
  }

  // ------------------------------------------------------------
  // HELPER: do I (mySeat) currently control *anything* matching term?
  // Used for "⚠️⚔️✅XYZ" badges.
  //
  // We treat "matching term" as:
  //   - that other card's types[] contains XYZ (case-insensitive)
  //   (you can expand this later to check abilities/names/etc.)
  // ------------------------------------------------------------
  function _youControlThing(mySeat, term){
    if (!term) return false;
    const want = term.toLowerCase();

    const cards = document.querySelectorAll('img.table-card[data-cid]');
    for (const el of cards){
      const cid = el.dataset.cid;
      const p = getCardCombatProfile(cid);
      if (!p) continue;

      // must be mine
      if (Number.isFinite(mySeat) && mySeat !== p.seat) continue;
      // must be on battlefield
      if (!_isOnBattlefield(p)) continue;

      // type match?
      const typesLower = (p.types||[]).map(t => String(t).toLowerCase());
      if (typesLower.includes(want)) {
        return true;
      }
    }

    return false;
  }

  // ------------------------------------------------------------
  // ATTACKER ELIGIBILITY (per-card)
  // ------------------------------------------------------------
  // return TRUE if this profile is currently allowed to attack RIGHT NOW
  // (seat match, untapped, no Defender, has body/power, not summoning sick
  // unless it has Haste, etc.)
  //
  // EXTRA BADGE RULE WE NOW ENFORCE HERE:
  // - ⚠️⚔️✅XYZ  => can only attack if you control XYZ
  //
  // NOTE:
  // - ⚠️⚔️🚫Alone ("can't attack alone") is NOT enforced here,
  //   because that's only illegal if it's literally the ONLY attacker.
  //   We enforce that later in validateAttackersSelection().
  //
  function _isEligibleAttackerProfile(profile, mySeat){
    if (!profile) return false;

    // must be on battlefield (not still in command zone etc.)
    if (!_isOnBattlefield(profile)) return false;

    // seat ownership check vs mySeat
    if (Number.isFinite(mySeat) && mySeat !== profile.seat) {
      return false;
    }

    // tapped check
    if (profile.isTapped) {
      return false;
    }

    // Defender check
    if (_hasAbility(profile,'defender')) {
      return false;
    }

    // summoning sickness check:
    // if it has summoning sickness AND it does NOT have haste, can't swing yet
    if (profile.hasSummoningSickness && !_hasAbility(profile,'haste')) {
      return false;
    }

    // classify "body with power >0"
    const typesLower = profile.types.map(t => t.toLowerCase());
    const isCreature = typesLower.includes('creature');
    const isVehicle  = typesLower.includes('vehicle');

    const p = Number.isFinite(profile.powNum) ? profile.powNum : null;
    const hasPower = Number.isFinite(p) && p > 0;

    let bodyOK = false;
    if (isVehicle && hasPower) bodyOK = true; // crewed vehicle (we assume pow>0 => crewed)
    if (isCreature && hasPower) bodyOK = true;
    if (!bodyOK) {
      return false;
    }

    // BADGE GATE: "⚠️⚔️✅XYZ" (can only attack if you control XYZ)
    const flags = _extractRestrictionFlags(profile);
    if (flags.onlyAttackIfControlTag){
      const ok = _youControlThing(mySeat, flags.onlyAttackIfControlTag);
      if (!ok) {
        // you don't control the required XYZ, so you cannot attack
        return false;
      }
    }

    // If we got here, this card alone is eligible to be *considered* an attacker.
    return true;
  }

  // return TRUE if this profile would be allowed to attack EXCEPT it's summoning sick
  // (used for red glow / "almost legal")
  function _wouldBeEligibleButSickProfile(profile, mySeat){
    if (!profile) return false;

    // must be on battlefield
    if (!_isOnBattlefield(profile)) return false;

    // seat ownership check vs mySeat
    if (Number.isFinite(mySeat) && mySeat !== profile.seat) {
      return false;
    }

    // tapped check
    if (profile.isTapped) {
      return false;
    }

    // Defender check
    if (_hasAbility(profile,'defender')) {
      return false;
    }

    // classify body / power
    const typesLower = profile.types.map(t => t.toLowerCase());
    const isCreature = typesLower.includes('creature');
    const isVehicle  = typesLower.includes('vehicle');

    const p = Number.isFinite(profile.powNum) ? profile.powNum : null;
    const hasPower = Number.isFinite(p) && p > 0;

    let bodyOK = false;
    if (isVehicle && hasPower) bodyOK = true;
    if (isCreature && hasPower) bodyOK = true;
    if (!bodyOK) return false;

    // We ONLY want "the ONLY thing stopping me is summoning sickness".
    // That means:
    //   - profile.hasSummoningSickness is true
    //   - profile does NOT have haste
    //   - If we ignored sickness, they'd pass.
    if (!profile.hasSummoningSickness) return false;
    if (_hasAbility(profile,'haste'))  return false; // haste overrides sickness, so it'd already be legal

    // at this point, sickness is the blocker
    return true;
  }

  function canAttackNow(cid, mySeat){
    const profile = getCardCombatProfile(cid);
    return _isEligibleAttackerProfile(profile, mySeat);
  }

  // legacy alias
  function canAttack(cid, mySeat){
    return canAttackNow(cid, mySeat);
  }

  function wouldBeAbleButSick(cid, mySeat){
    const profile = getCardCombatProfile(cid);
    return _wouldBeEligibleButSickProfile(profile, mySeat);
  }

  function getEligibleAttackersForSeat(mySeat){
    const out = [];
    const cards = document.querySelectorAll('img.table-card[data-cid]');
    cards.forEach(el => {
      const cid = el.dataset.cid;
      const profile = getCardCombatProfile(cid);
      if (_isEligibleAttackerProfile(profile, mySeat)) {
        out.push(profile);
      }
    });
    return out;
  }

  function getSickButOtherwiseEligibleForSeat(mySeat){
    const out = [];
    const cards = document.querySelectorAll('img.table-card[data-cid]');
    cards.forEach(el => {
      const cid = el.dataset.cid;
      const profile = getCardCombatProfile(cid);
      if (_wouldBeEligibleButSickProfile(profile, mySeat)) {
        out.push(profile);
      }
    });
    return out;
  }

  // ------------------------------------------------------------
  // GROUP ATTACK VALIDATION (final gate before "Confirm Attackers")
  // ------------------------------------------------------------
  //
  // This enforces:
  // - ⚠️⚔️🚫Alone: A creature with that badge CANNOT be your only attacker.
  //
  // It does NOT stop you from highlighting/selecting that creature. It only
  // (1) kills the confirm button in the UI, and
  // (2) gives you the reason string for the popup if you tap the greyed button.
  //
  function validateAttackersSelection(attackerCidList, mySeat){
    // DEBUG: show raw incoming selection + seat
    console.log('%c[BattleRules] validateAttackersSelection() CALLED', 'color:#0ff', {
      attackerCidList,
      mySeat
    });

    const arr = Array.isArray(attackerCidList)
      ? attackerCidList.filter(Boolean)
      : [];

    // No attackers at all is always "ok:true"
    if (arr.length === 0){
      console.log('%c[BattleRules] no attackers selected -> ok', 'color:#0f0');
      return { ok:true };
    }

    // Only care if there's exactly ONE attacker chosen.
    if (arr.length === 1){
      const onlyCid = arr[0];
      const prof = getCardCombatProfile(onlyCid);

      console.log('%c[BattleRules] single-attacker profile', 'color:#0ff', {
        cid: onlyCid,
        profile: prof
      });

      if (prof){
        // Check basic eligibility again
        if (!_isEligibleAttackerProfile(prof, mySeat)){
          const n = prof.name || onlyCid;
          console.warn('[BattleRules] attacker not eligible in general', {
            attacker: n,
            profile: prof
          });
          return {
            ok:false,
            reason:`${n} can't attack right now.`
          };
        }

        const flags = _extractRestrictionFlags(prof);
        console.log('%c[BattleRules] attacker restriction flags', 'color:#fc0', {
          cid: onlyCid,
          name: prof.name,
          flags
        });

        if (flags.cannotAttackAlone){
          const n = prof.name || onlyCid;

          console.warn('%c[BattleRules] ⚠️⚔️🚫Alone rule triggered', 'color:#fc0', {
            attacker: n,
            profile: prof,
            flags
          });

          return {
            ok:false,
            reason:`${n} can't attack alone.`
          };
        }
      }
    }

    // Otherwise fine
    console.log('%c[BattleRules] attackers selection valid -> ok', 'color:#0f0', {
      finalAttackers: arr
    });
    return { ok:true };
  }



  // ------------------------------------------------------------
  // BLOCKER ELIGIBILITY (pairwise attacker vs blocker)
  // ------------------------------------------------------------
  //
  // This version keeps everything you had and adds:
  //
  // 1. 🚫Block / 🚫Blocking / 🚫Blocks
  //    - If blockerProf has this in abilities, it CANNOT block, period.
  //
  // 2. ⚠️🛡️XYZ
  //    - Blocker can ONLY block attackers whose types include XYZ.
  //
  // 3. Attacker "🛡️XYZ" / "Protection from X"
  //    - If attacker has 🛡️Black, 🛡️Artifact, 🛡️Dragon, 🛡️Creatures, etc.:
  //        • Color protection blocks blockers of that color
  //        • Type/subtype protection blocks blockers of that type/subtype
  //        • "Creatures" means no creature can block it
  //
  // 4. Flying check:
  //    - If attacker has Flying, blocker must have Flying or Reach
  //
  // NOTE:
  // We are NOT enforcing ⚠️🛡️🚫Alone here. That gets enforced at FINAL confirm
  // in validateBlockAssignments() below, because it's only illegal if that
  // specific blocker would be the ONLY blocker assigned to that attacker.
  //
  function _isEligibleBlockerPair(attackerProf, blockerProf, defenderSeat){
  if (!attackerProf || !blockerProf) return false;

  // both must physically be on the battlefield
  if (!_isOnBattlefield(attackerProf)) return false;
  if (!_isOnBattlefield(blockerProf))  return false;

  // seat ownership check vs defenderSeat
  if (Number.isFinite(defenderSeat) && defenderSeat !== blockerProf.seat) {
    return false;
  }

  // tapped check
  if (blockerProf.isTapped) {
    return false;
  }

  // hard "cannot block" badge
  const blkFlags = _extractRestrictionFlags(blockerProf);
  if (blkFlags.cannotBlock) {
    return false;
  }

  // BODY CHECK:
  // - Creatures with T>0 are fine
  // - Vehicles only if "crewed": P>0 AND T>0
  const blkTypesLower = blockerProf.types.map(t => t.toLowerCase());
  const blkIsCreature = blkTypesLower.includes('creature');
  const blkIsVehicle  = blkTypesLower.includes('vehicle');

  const p = Number.isFinite(blockerProf.powNum) ? blockerProf.powNum : null;
  const t = Number.isFinite(blockerProf.touNum) ? blockerProf.touNum : null;
  const hasBodyPower       = Number.isFinite(p) && p > 0;
  const hasBodyTough       = Number.isFinite(t) && t > 0;
  const creatureOK         = blkIsCreature && hasBodyTough;
  const vehicleLooksCrewed = blkIsVehicle && hasBodyPower && hasBodyTough;

  if (!creatureOK && !vehicleLooksCrewed) {
    return false;
  }

  // ⚠️🛡️XYZ  (block restriction: blocker can ONLY block XYZ)
  // If blocker has this restriction, attacker MUST match that XYZ in its types.
  if (blkFlags.onlyBlockTag){
    const needRaw = blkFlags.onlyBlockTag.trim().toLowerCase();
    // normalize plural -> singular for loose match
    const needSingular = needRaw.endsWith('s')
      ? needRaw.slice(0, -1)
      : needRaw;

    const atkTypesLower = (attackerProf.types || []).map(
      t => String(t).toLowerCase()
    );

    const attackerHasNeededType =
      atkTypesLower.includes(needRaw) ||
      atkTypesLower.includes(needSingular);

    if (!attackerHasNeededType){
      return false;
    }
  }

  // PROTECTION-STYLE CHECK (attacker side)
  //
  // We parse all attackerProf.abilities, pull any 🛡️XYZ or
  // "protection from XYZ", and compare against the would-be blocker.
  const atkAbilities = Array.isArray(attackerProf.abilities)
    ? attackerProf.abilities
    : [];

  const protTags = [];
  for (const raw of atkAbilities){
    if (!raw) continue;

    // Try "🛡️XYZ"
    let m = String(raw).match(/🛡️\s*([A-Za-z]+)/);
    if (m && m[1]) {
      protTags.push(m[1].trim().toLowerCase());
      continue;
    }

    // Fallback "Protection from XYZ"
    m = String(raw).match(/protection\s+from\s+([A-Za-z]+)/i);
    if (m && m[1]) {
      protTags.push(m[1].trim().toLowerCase());
      continue;
    }
  }

  if (protTags.length){
    // helper: map color word -> rules color letter
    function _colorWordToLetter(word){
      const w = String(word||'').toLowerCase();
      if (w === 'white')  return 'W';
      if (w === 'blue')   return 'U'; // MTG "Blue" => U
      if (w === 'black')  return 'B';
      if (w === 'red')    return 'R';
      if (w === 'green')  return 'G';
      return null;
    }

    const blkColors = Array.isArray(blockerProf.colors)
      ? blockerProf.colors.map(c => String(c).toUpperCase())
      : [];

    const blkTypesLowerSet = new Set(
      (blockerProf.types || []).map(t => String(t).toLowerCase())
    );

    for (const prot of protTags){
      const protLower = prot.toLowerCase();

      // COLOR-based protection ("black", "red", etc.)
      const colorLetter = _colorWordToLetter(protLower);
      if (colorLetter){
        if (blkColors.includes(colorLetter)){
          // blocker has forbidden color
          return false;
        }
        continue; // handled
      }

      // TYPE-based protection
      // normalize plural like "creatures" -> "creature"
      const protSingular = protLower.endsWith('s')
        ? protLower.slice(0, -1)
        : protLower;

      // special: if attacker has 🛡️Creatures
      // -> any blocker that's a creature is not allowed
      if (protSingular === 'creature'){
        if (blkTypesLowerSet.has('creature')){
          return false;
        }
      } else {
        // e.g. 🛡️artifact / 🛡️dragon / 🛡️goblin
        if (blkTypesLowerSet.has(protLower) ||
            blkTypesLowerSet.has(protSingular)) {
          return false;
        }
      }
    }
  }

  // FLYING / REACH rule
  const atkHasFlying = _hasAbility(attackerProf,'flying');
  if (atkHasFlying) {
    const blkHasFlying = _hasAbility(blockerProf,'flying');
    const blkHasReach  = _hasAbility(blockerProf,'reach');
    if (!blkHasFlying && !blkHasReach) {
      return false;
    }
  }

  // DEBUG: every time this pair is considered legal for assignment, log the blocker profile
  console.log('%c[BattleRules] Blocker selected', 'color:#6cf', {
    blocker: blockerProf.name,
    profile: blockerProf
  });

  // If we got here, this specific attacker/blocker pair is legal.
  return true;
}


  function canBlock(attackerCid, blockerCid, defenderSeat){
    const atkProf = getCardCombatProfile(attackerCid);
    const blkProf = getCardCombatProfile(blockerCid);
    return _isEligibleBlockerPair(atkProf, blkProf, defenderSeat);
  }

  function getEligibleBlockersForTarget(attackerCid, defenderSeat){
    const out = [];
    const atkProf = getCardCombatProfile(attackerCid);
    if (!atkProf) return out;

    const cards = document.querySelectorAll('img.table-card[data-cid]');
    cards.forEach(el => {
      const cid = el.dataset.cid;
      const blkProf = getCardCombatProfile(cid);
      if (_isEligibleBlockerPair(atkProf, blkProf, defenderSeat)) {
        out.push(blkProf); // whole profile
      }
    });

    return out;
  }

  // ------------------------------------------------------------
  // BLOCK LEGALITY CHECK (MENACE, CAN'T BLOCK ALONE, etc.)
  // ------------------------------------------------------------
  // attackerCidList: array of attacker cids (order doesn't matter)
  // assignmentsObj:  { [attackerCid]: [blockerCid, blockerCid, ...], ... }
  //
  // We enforce:
  // - Menace:
  //     A creature with Menace can't be blocked except by 2 or more creatures.
  //     If exactly 1 blocker is assigned to that attacker, that's illegal.
  //     0 blockers is fine (unblocked).
  //
  // - ⚠️🛡️🚫Alone:
  //     A blocker with this badge CANNOT be the ONLY blocker assigned
  //     to any attacker. (But it's okay if it's part of a gang block.)
  //
  function validateBlockAssignments(attackerCidList, assignmentsObj){
    // DEBUG: show whole block map coming in
    console.log('%c[BattleRules] validateBlockAssignments() CALLED', 'color:#0ff', {
      attackerCidList,
      assignmentsObj
    });

    for (const atkCid of attackerCidList){
      if (!atkCid) continue;
      const atkProf = getCardCombatProfile(atkCid);
      if (!atkProf) continue;

      let assigned = assignmentsObj[atkCid] || [];
      if (!Array.isArray(assigned)) assigned = [assigned];

      // uniques only so "same blocker clicked twice" doesn't hack Menace
      const uniq = Array.from(new Set(assigned.filter(Boolean)));

      console.log('%c[BattleRules] block check for attacker', 'color:#0ff', {
        attackerCid: atkCid,
        attackerName: atkProf.name,
        assignedBlockers: uniq
      });

      // MENACE rule
      if (_hasAbility(atkProf,'menace')) {
        if (uniq.length === 1) {
          const n = atkProf.name || atkCid;
          console.warn('[BattleRules] Menace violation', {
            attacker: n,
            attackerCid: atkCid,
            blockers: uniq
          });
          return {
            ok:false,
            reason:`${n} has Menace and must be blocked by 2+ creatures or not at all.`
          };
        }
      }

      // ⚠️🛡️🚫Alone rule for blockers
      // If this attacker currently has EXACTLY ONE blocker,
      // and that blocker is "cannotBlockAlone", reject.
      if (uniq.length === 1){
        const soloBlkCid = uniq[0];
        const soloBlkProf = getCardCombatProfile(soloBlkCid);

        console.log('%c[BattleRules] single-blocker profile', 'color:#0ff', {
          soloBlkCid,
          soloBlkProf
        });

        if (soloBlkProf){
          const blkFlags = _extractRestrictionFlags(soloBlkProf);

          console.log('%c[BattleRules] blocker restriction flags', 'color:#fc0', {
            blockerCid: soloBlkCid,
            blockerName: soloBlkProf.name,
            flags: blkFlags
          });

          if (blkFlags.cannotBlockAlone){
            const nb = soloBlkProf.name || soloBlkCid;

            console.warn('%c[BattleRules] ⚠️🛡️🚫Alone rule TRIGGERED', 'color:#fc0', {
              blocker: nb,
              profile: soloBlkProf,
              flags: blkFlags
            });

            return {
              ok:false,
              reason:`${nb} can't block alone.`
            };
          }
        }
      }

      // FUTURE: other global restrictions
    }

    console.log('%c[BattleRules] block assignments valid -> ok', 'color:#0f0', {
      attackerCidList,
      assignmentsObj
    });
    return { ok:true };
  }


  // ------------------------------------------------------------
  // SEAT SNAPSHOTS / DEBUG
  // ------------------------------------------------------------
  // NOTE: We are intentionally NOT filtering by seat here anymore.
  // We dump ALL cards. Each profile will now include:
  //   seat, ownerCurrent, ownerOriginal
  // so you can inspect which ones are "yours".
  function getAllProfilesForSeat(/* seatIgnored */){
    const out = [];
    const cards = document.querySelectorAll('img.table-card[data-cid]');
    cards.forEach(el => {
      const cid = el.dataset.cid;
      const prof = getCardCombatProfile(cid);
      if (prof) out.push(prof);
    });
    return out;
  }

  // pretty-print / safe-for-paste
  function debugSeatSnapshot(seatMaybeIgnored){
    const arr = getAllProfilesForSeat(seatMaybeIgnored);
    return arr.map(p => ({
      cid:           p.cid,
      seatGuess:     p.seat,           // numeric guess from dataset
      ownerCurrent:  p.ownerCurrent,   // raw string from dataset
      ownerOriginal: p.ownerOriginal,  // raw string from dataset

      name:          p.name,
      manaCostRaw:   p.manaCostRaw,    // "{U}{B}{R}"
      colors:        p.colors,         // ["U","B","R"]

      types:         p.types,
      abilities:     p.abilities,      // Includes icons like "🛡️Red", "🚩Artifact"
      buffs:         p.buffs,

      ptFinal:       p.ptFinal,        // "5/5" current
      powNum:        p.powNum,         // current numeric
      touNum:        p.touNum,
      powBase:       p.powBase,        // printed base
      touBase:       p.touBase,

      isTapped:      p.isTapped,

      inCommandZone:        p.inCommandZone === true,
      hasSummoningSickness: p.hasSummoningSickness === true
    }));
  }

  // ------------------------------------------------------------
  // DEBUG / COMPARISON
  // ------------------------------------------------------------
  function compareForBlock(attackerCid, blockerCid){
    return {
      attacker: getCardCombatProfile(attackerCid),
      blocker:  getCardCombatProfile(blockerCid)
    };
  }

    // ------------------------------------------------------------
  // PUBLIC EXPORT
  // ------------------------------------------------------------
  const BattleRules = {
    getCardCombatProfile,

    canAttack,
    canAttackNow,
    wouldBeAbleButSick,
    getEligibleAttackersForSeat,
    getSickButOtherwiseEligibleForSeat,

    validateAttackersSelection,

    canBlock,
    getEligibleBlockersForTarget,

    validateBlockAssignments,

    compareForBlock,

    getAllProfilesForSeat,
    debugSeatSnapshot,

    // 🔵 expose this so battle.system.js can ask about 🚫Alone flags
    _extractRestrictionFlags
  };

  window.BattleRules = BattleRules;

})();

