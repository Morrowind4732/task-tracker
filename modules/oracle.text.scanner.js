// oracle.text.scanner.js
// ------------------------------------------------------------
// Scans Oracle text and returns structured detection results
// for abilities, conditions, tokens, life gain/damage, counters,
// suspend, scry, and straight stat buffs ("gets +5/+5").
//
// Returned shape:
// {
//   detectedFlags: [ { label, grantAbility } , ... ],
//   quickActions:  [ { label, type, ... }, ... ],
//   tokens:        [ { kind, qty, ... }, ... ],
//   counters:      [ { kind, qty }, ... ],
//   ptBuffs:       [ { powDelta, touDelta, duration }, ... ]
// }
//
// - detectedFlags:
//     chips in "Detected Abilities". Clicking them should flip to Apply tab,
//     toggle "Grant ability", and prefill that text.
// - quickActions:
//     buttons in the Quick Actions column. We'll use them to prefill Apply.
// - ptBuffs:
//     literal buffs like "gets +5/+5" (temporary or conditional). NOT counters.
//
// CORE CHANGE:
//   We DO NOT smash the whole oracleText into one mega string before parsing.
//   We split it into logical "lines" based on newline/paragraph breaks,
//   and parse EACH LINE independently. This prevents bleed like
//   "Protection from red Whenever another creature enters...".
//
// EXTRA LOGIC ADDED BASED ON TESTS:
//   - Protection / Hexproof no longer swallows the next paragraph
//   - We detect flying/vigilance/etc in the SAME sentence as a P/T buff
//   - We detect +1/+1 COUNTERS separately from +1/+1 BUFFS
//   - We expose Suspend as a quickAction so you can prefill suspend counters
//   - We expose weird life gain like "gain three times X life" as Gain X life
//   - We detect Scry X
//   - Token creation keeps "with flying" style abilities
// ------------------------------------------------------------

export function scanOracleTextForActions(oracleText = '') {
  if (!oracleText) {
    return {
      detectedFlags: [],
      quickActions:  [],
      tokens:        [],
      counters:      [],
      ptBuffs:       []
    };
  }

  // master buckets
  const detectedFlags = [];
  const quickActions  = [];
  const tokens        = [];
  const counters      = [];
  const ptBuffs       = [];

  // ------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------

  function capFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function stripArticles(str) {
    return String(str || '').replace(/^(another|a|an)\s+/i, '').trim();
  }

  // crude singular: "Soldiers" -> "Soldier", but don't mutilate "Vampires" => "Vampir"
  function crudeSingular(str) {
    if (!str) return '';
    const s = str.trim();
    if (/ies$/i.test(s)) {
      return s; // leave "Vampires" alone
    }
    if (s.endsWith('s')) {
      return s.slice(0, -1);
    }
    return s;
  }

  // remove reminder-text in parentheses "(This creature ...)"
  // trim inner whitespace
  function cutReminder(chunk) {
    if (!chunk) return '';
    let c = chunk.split('(')[0]; // kill reminder parentheses + anything after "("
    c = c.replace(/\s+/g, ' ');
    return c.trim();
  }

  // push a detected ability chip if it's new
  function addDetectedAbility(labelStr) {
    const lab = String(labelStr || '').trim();
    if (!lab) return;
    if (detectedFlags.some(f => f.label === lab)) return;
    detectedFlags.push({
      label:        lab,
      grantAbility: lab
    });
  }

  // push quick action button
  function addQuickAction(obj) {
    if (!obj || !obj.type) return;
    quickActions.push(obj);
  }

  // helper to generate signed P/T like +5/+5 or -2/-1
  function signed(n) {
    const v = Number(n);
    if (Number.isNaN(v)) return String(n);
    return v >= 0 ? `+${v}` : `${v}`;
  }

  // abilities we want to surface if the line says "has flying", "gains lifelink", etc.
  const EVERGREEN_ABILS = [
    'flying','first strike','double strike','vigilance','lifelink',
    'deathtouch','trample','menace','reach','indestructible','hexproof'
  ];

  // ------------------------------------------------------------
  // MAIN STRATEGY
  // ------------------------------------------------------------
  // 1. Split oracle text *by paragraph/newline* and parse line-by-line.
  //    This prevents "protection from red" from gluing on the next paragraph.
  //
  // 2. ALSO build a "fullText" with single spaces that we can use for
  //    some global patterns that conceptually span clauses like "Suspend X—..."
  //    (Suspend shows up as one paragraph anyway, but safe to do once.)
  // ------------------------------------------------------------

  const lines = String(oracleText)
    .split(/\r?\n+/)           // break at one-or-more newlines
    .map(l => l.trim())
    .filter(Boolean);          // drop blank lines

  const fullText = lines.join(' ').replace(/\s+/g, ' ').trim();

  // ------------------------------------------------------------
  // PER-LINE PARSE
  // ------------------------------------------------------------
  lines.forEach(lineRaw => {
    const line = lineRaw.trim();
    if (!line) return;

    // We'll derive some helper splits for this line:
    // split into pseudo "sentences" on ".", but keep the base line for scans
    const sentences = line.split(/(?<=\.)\s+/).map(s => s.trim()).filter(Boolean);

    // --------------------------------------------------------
    // 1. CAN'T ATTACK/BLOCK ALONE
    // --------------------------------------------------------
    if (/can(?:'t|not)\s+attack(?:\s+or\s+block)?\s+alone/i.test(line)) {
      addDetectedAbility('⚠️⚔️🚫Alone');
      addQuickAction({
        label:   "Can't attack alone",
        type:    'grantAbility',
        ability: '⚠️⚔️🚫Alone'
      });
    }

    if (/can(?:'t|not)\s+block(?:\s+or\s+attack)?\s+alone/i.test(line)) {
      addDetectedAbility('⚠️🛡️🚫Alone');
      addQuickAction({
        label:   "Can't block alone",
        type:    'grantAbility',
        ability: '⚠️🛡️🚫Alone'
      });
    }

    // --------------------------------------------------------
    // 2. HEXPROOF / "HEXPROOF FROM ___"
    // swirl icon 🌀
    // NOTE: we parse within THIS line only.
    // --------------------------------------------------------

    // 2a) "hexproof from ___"
    {
      const hexFromRegex = /hexproof from ([^.,;]+)/gi;
      const hexMatches = [...line.matchAll(hexFromRegex)];
      hexMatches.forEach(m => {
        let clause = cutReminder(m[1] || '');

        // normalize "from X, and from Y"
        clause = clause
          .replace(/and from/gi, ',')
          .replace(/or from/gi, ',')
          .replace(/, from/gi, ',')
          .replace(/\bfrom\b/gi, '')
          .replace(/\band\b/gi, ',')
          .replace(/\bor\b/gi, ',');

        const parts = clause
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        parts.forEach(raw => {
          let norm = stripArticles(raw);
          norm = crudeSingular(norm);
          norm = capFirst(norm);

          const swirlTag = `🌀Hexproof ${norm}`;

          addDetectedAbility(swirlTag);

          addQuickAction({
            label:   `Hexproof from ${norm}`,
            type:    'grantAbility',
            ability: swirlTag
          });
        });
      });
    }

    // 2b) plain "hexproof" (no "from")
    if (/\bhexproof\b/i.test(line) && !/\bhexproof\s+from\b/i.test(line)) {
      const swirlTag = '🌀Hexproof';
      addDetectedAbility(swirlTag);
      addQuickAction({
        label:   'Hexproof',
        type:    'grantAbility',
        ability: swirlTag
      });
    }

    // --------------------------------------------------------
    // 3. PROTECTION FROM X
    // 🛡️Black, 🛡️Red, 🛡️Zombie etc.
    //
    // We STOP at punctuation or commas *in THIS line*, and never bleed
    // onto another line.
    // --------------------------------------------------------
    {
      const protRegex = /protection from ([^.;]+)/gi;
      const protectionMatches = [...line.matchAll(protRegex)];
      protectionMatches.forEach(m => {
        let clause = cutReminder(m[1] || '');

        // "from black and from red" -> "black, red"
        clause = clause
          .replace(/and from/gi, ',')
          .replace(/or from/gi, ',')
          .replace(/, from/gi, ',')
          .replace(/\bfrom\b/gi, '')
          .replace(/\band\b/gi, ',')
          .replace(/\bor\b/gi, ',')
          .replace(/the color of your choice/gi, 'White,Blue,Black,Red,Green');

        const candidates = clause
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        candidates.forEach(raw => {
          let normalized = stripArticles(raw);
          normalized = crudeSingular(normalized);
          normalized = capFirst(normalized);

          const shieldTag = `🛡️${normalized}`;

          addDetectedAbility(shieldTag);

          addQuickAction({
            label:   `Protection from ${normalized}`,
            type:    'grantAbility',
            ability: shieldTag
          });
        });
      });
    }

    // --------------------------------------------------------
    // 4. "CAN ATTACK ONLY IF YOU CONTROL X"
    // -> ⚠️⚔️✅Angel style gate
    //
    // Example lines:
    //   "CARD can't attack unless you control an Angel."
    //   "CARD can attack only if you control another Knight."
    // --------------------------------------------------------
    {
      const controlRegex = /can(?:'t)? attack(?: only)? if you control ([^.]+)$/gi;
      const controlMatches = [...line.matchAll(controlRegex)];
      controlMatches.forEach(m => {
        const clause = (m[1] || '').trim();

        const parts = clause
          .split(/\s+(?:and|or)\s+/i)
          .map(p => p.trim())
          .filter(Boolean);

        parts.forEach(p => {
          let norm = stripArticles(p);
          norm = capFirst(norm);

          const gate = `⚠️⚔️✅${norm}`;

          addDetectedAbility(gate);

          addQuickAction({
            label:   `Can attack only if you control ${norm}`,
            type:    'grantAbility',
            ability: gate
          });
        });
      });
    }

         // --------------------------------------------------------
    // 5. TOKEN CREATION
    //
    // e.g.
    //   "Create three 1/1 white Soldier creature tokens with vigilance."
    //   "Create X 1/1 white Warrior creature tokens."
    //   "At the beginning of each end step ... create a 4/4 white Angel creature token with flying."
    //
    // Key detail:
    // Our old regex stopped RIGHT at "token", so we lost "with flying".
    // Now we:
    //   - still find "create ..." with tokenRegex (anchor point)
    //   - but then manually grab the entire sentence from "create" up to the period
    //   - strip the leading "create "
    //   - parse THAT full chunk (so we see "with flying")
    //
    // We ALSO emit:
    //   - QuickAction "Create 1x 4/4 White Angel with flying"
    //   - QuickAction "Grant Flying"
    //   - chip "Flying"
    // --------------------------------------------------------
    {
      const tokenRegex = /create\b/gi;
      const tokenMatches = [...line.matchAll(tokenRegex)];

      tokenMatches.forEach(m => {
        // Grab the rest of the line starting at this "create"
        const fromCreate = line.slice(m.index);

        // Stop at the first period after "create". That's the end of the token sentence.
        const periodPos = fromCreate.indexOf('.');
        const sentencePortion = periodPos >= 0
          ? fromCreate.slice(0, periodPos)
          : fromCreate;

        // Remove the word "create" itself so we're left with
        // "a 4/4 white Angel creature token with flying"
        const fullChunkRaw = sentencePortion.replace(/^create\s+/i, '').trim();

        // Kill reminder text, normalize whitespace
        const chunk = cutReminder(fullChunkRaw);

        // Creature vs noncreature token?
        const isCreature = /creature token/i.test(chunk);

        // qty can be "a", "three", "2", "X"
        const qtyMatch = chunk.match(/\b(a|an|one|two|three|four|five|\d+|X)\b/i);
        const qtyWord  = qtyMatch ? qtyMatch[1] : '1';
        const qtyMap   = { a:1, an:1, one:1, two:2, three:3, four:4, five:5 };
        const qty      = qtyMap[String(qtyWord).toLowerCase()] ?? qtyWord;

        if (isCreature) {
          // P/T like "1/1"
          const ptMatch = chunk.match(/(\d+)\/(\d+)/);
          const powStr  = ptMatch ? ptMatch[1] : null;
          const touStr  = ptMatch ? ptMatch[2] : null;

          // COLORS: "white", "blue", "colorless", etc.
          const colorMatches = [...chunk.matchAll(/\b(white|blue|black|red|green|colorless)\b/gi)];
          const colors = colorMatches
            .map(mm => capFirst(mm[1]))
            .filter((v, idx, arr) => v && arr.indexOf(v) === idx);

          // CREATURE TYPE(S)
          // Grab words before "creature token"
          const creaturePhraseMatch = chunk.match(/(?:\d+\/\d+\s+)?(.+?)\s+creature token/i);
          let creaturePhrase = creaturePhraseMatch ? creaturePhraseMatch[1].trim() : '';

          let rawTypeWords = creaturePhrase.split(/\s+/);

          const IGNORE_WORDS = [
            'a','an','the','legendary','artifact','enchantment','token','named',
            'card','cards','with','and','or','plus','equipment','vehicle',
            'colorless','white','blue','black','red','green'
          ];

          let inferredTypes = rawTypeWords.filter(w => {
            const wClean = w.replace(/[^A-Za-z]/g,'');
            if (!wClean) return false;

            const lower = wClean.toLowerCase();
            if (IGNORE_WORDS.includes(lower)) return false;

            if (/^\d+$/.test(wClean)) return false;

            // uppercase leading letter usually means a creature type
            if (/^[A-Z][a-zA-Z]*$/.test(wClean)) return true;

            return false;
          });

          inferredTypes = inferredTypes.filter((v, idx, arr) => arr.indexOf(v) === idx);

          // fallback if we somehow missed the type
          if (inferredTypes.length === 0) {
            const legacyTypeMatch = chunk.match(/([A-Z][a-z]+)(?=\s+creature token)/);
            if (legacyTypeMatch) {
              inferredTypes = [ legacyTypeMatch[1] ];
            }
          }

          // BASE abilities baked right onto the token, e.g. "with flying, vigilance"
          // NOW this hits for Angelic Accord because chunk includes "with flying"
          const abilityMatch = chunk.match(/with ([a-z,\s]+)$/i);
          const baseAbilities = abilityMatch
            ? abilityMatch[1]
                .split(/,|and/i)
                .map(a => a.trim())
                .filter(Boolean)
            : [];

          // TEMP abilities after the period:
          // e.g. "That token gains haste until end of turn."
          // We still do trailingText from AFTER the sentence we just chopped.
          const afterSentence = periodPos >= 0
            ? fromCreate.slice(periodPos + 1).trim()
            : '';

          const tempGainRegex = /\b(?:that token|those tokens|it)\s+gain(?:s)?\s+([a-z\s]+?)\s+until end of turn/i;
          const mgain = afterSentence.match(tempGainRegex);

          let tempAbilities = [];
          if (mgain) {
            tempAbilities = mgain[1]
              .split(/,|and/i)
              .map(s => s.trim())
              .filter(Boolean);
          }

          // Build tokenObj with both permanent and temp abilities
          const tokenObj = {
            kind:          'creature',
            qty,
            pow:           powStr,
            tou:           touStr,
            colors,
            types:         inferredTypes,
            abilities:     baseAbilities,   // permanent (e.g. ["flying"])
            tempAbilities  // temporary buffs like ["haste"]
          };
          tokens.push(tokenObj);

          // Build the pretty Create label
          // "Create 1x 4/4 White Angel with flying"
          // (We do NOT include temp haste etc. in this label.)
          let coreParts = [];
          coreParts.push(`Create ${qty}x`);
          if (powStr && touStr) coreParts.push(`${powStr}/${touStr}`);
          if (colors.length > 0) coreParts.push(colors.join(' '));
          if (inferredTypes.length > 0) coreParts.push(inferredTypes.join(' '));

          let labelCore = coreParts.join(' ').trim();

          if (baseAbilities.length > 0) {
            const abilStr = baseAbilities.join(', ');
            labelCore += ` with ${abilStr}`;
          }

          addQuickAction({
            label: labelCore,
            type:  'token',
            data:  tokenObj
          });

          // Surface baseAbilities as permanent Grant actions + chips.
          // Angelic Accord -> ["flying"] => "Grant Flying"
          baseAbilities.forEach(ab => {
            const pretty = ab
              .split(' ')
              .map(w => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ');

            addQuickAction({
              label:   `Grant ${pretty}`,
              type:    'grantAbility',
              ability: pretty
            });

            addDetectedAbility(pretty);
          });

          // Surface tempAbilities (EOT buffs) as before.
          tempAbilities.forEach(ab => {
            const pretty = ab
              .split(' ')
              .map(w => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ');

            addQuickAction({
              label:   `Grant ${pretty} (EOT)`,
              type:    'grantAbility',
              ability: `${pretty} (EOT)`
            });

            addDetectedAbility(`${pretty} (EOT)`);
          });

        } else {
          // NONCREATURE token (Treasure, Food, etc.)
          const nameMatch = chunk.match(/([A-Z][a-z]+)\s+token/i);
          const tokenName = nameMatch ? nameMatch[1] : 'Token';

          const tokenObj = {
            kind: tokenName,
            qty
          };
          tokens.push(tokenObj);

          addQuickAction({
            label: `Create ${qty}x ${tokenName} token`,
            type:  'token',
            data:  tokenObj
          });
        }
      });
    }





    // --------------------------------------------------------
    // 6. LIFE GAIN / LOSS / DAMAGE (line-scoped)
    //
    // Includes:
    //   "gain X life"
    //   "gain three times X life"  -> we'll fall back to Gain X life
    //   "lose 2 life"
    //   "deals 3 damage to any target"
    // --------------------------------------------------------
    {
      // gain life normal
      const lifeGainRegex = /gain (\d+|X) life/gi;
      const lifeGainMatches = [...line.matchAll(lifeGainRegex)];
      lifeGainMatches.forEach(m => {
        const n = m[1];
        addQuickAction({
          label:   `Gain ${n} life`,
          type:    'lifeGain',
          amount:  n
        });
      });

      // weird X scaling: "gain three times X life", "gain ... X life"
      // We'll just say Gain X life so user can set X.
      if (/gain\b[^.]*\bX life\b/i.test(line)) {
        addQuickAction({
          label:   `Gain X life`,
          type:    'lifeGain',
          amount:  'X'
        });
      }

      // lose life
      const lifeLossRegex = /lose(?:s)? (\d+|X) life/gi;
      const lifeLossMatches = [...line.matchAll(lifeLossRegex)];
      lifeLossMatches.forEach(m => {
        const n = m[1];
        addQuickAction({
          label:   `Opponent loses ${n} life`,
          type:    'lifeLoss',
          amount:  n
        });
      });

      // deal damage
      const dmgRegex = /deal(?:s)? (\d+|X) damage to (any target|target player|each opponent)/gi;
      const damageMatches = [...line.matchAll(dmgRegex)];
      damageMatches.forEach(m => {
        const n = m[1];
        const rawTarget = m[2] || '';
        let target = 'target player';
        if (/each opponent/i.test(rawTarget)) target = 'each opponent';
        else if (/any target/i.test(rawTarget)) target = 'any target';
        else if (/target player/i.test(rawTarget)) target = 'target player';

        addQuickAction({
          label:   `Deal ${n} damage to ${target}`,
          type:    'damage',
          amount:  n,
          target
        });
      });
    }

    // --------------------------------------------------------
    // 7. SCRY X
    // e.g. "Scry 1." or "When this land enters, scry 1."
    // We'll surface "Scry 1" as a quickAction for convenience.
    // --------------------------------------------------------
    {
      const scryRegex = /\bscry (\d+|X)\b/i;
      const mScry = line.match(scryRegex);
      if (mScry) {
        const amt = mScry[1];
        addQuickAction({
          label: `Scry ${amt}`,
          type:  'scry',
          amount: amt
        });
      }
    }

    // --------------------------------------------------------
    // 8. SUSPEND (this is often its own line too, but we'll also handle globally below)
    // e.g. "Suspend X—{W}{W}{W}. X can't be 0."
    //
    // We'll just capture "Suspend <count> — <cost>".
    // --------------------------------------------------------
    {
      const suspendRegex = /suspend\s+([0-9X]+)\s*[—-]\s*([^.;]+)/i; // line-based
      const mSusp = line.match(suspendRegex);
      if (mSusp) {
        const suspendCount = (mSusp[1] || '').trim();
        const suspendCost  = (mSusp[2] || '').trim();
        addQuickAction({
          label: `Suspend ${suspendCount} — ${suspendCost}`,
          type:  'suspend',
          count: suspendCount,
          cost:  suspendCost
        });
      }
    }

    // --------------------------------------------------------
    // 9. P/T BUFFS (NOT COUNTERS)
    //
    // We detect "get +P/+T" or "gets +P/+T", e.g.
    //   "Other Soldier creatures you control get +1/+1 and have vigilance."
    //   "As long as you have 30 or more life, this creature gets +5/+5 and has flying."
    //
    // For each *sentence* in this line, we:
    //   - pull +P/+T
    //   - detect duration ("until end of turn" -> EOT, "as long as" -> COND)
    //   - push ptBuffs[] + a ptBuff quickAction
    //   - ALSO within the same sentence, if we see "has flying", "and have vigilance",
    //     we emit grantAbility quickActions for those evergreen keywords.
    // --------------------------------------------------------
    sentences.forEach(sentenceRaw => {
      const sentence = sentenceRaw.trim();
      if (!sentence) return;

      // --- detect P/T buff in this sentence
      const ptBuffRegex = /\bget(?:s)?\s+([+-]?\d+)\/([+-]?\d+)(?!\s*counter)/i;
      const mBuff = sentence.match(ptBuffRegex);
      if (mBuff) {
        const powDeltaStr = mBuff[1];
        const touDeltaStr = mBuff[2];

        const powDelta = parseInt(powDeltaStr, 10);
        const touDelta = parseInt(touDeltaStr, 10);

        // detect simple duration
        let duration = null;
        if (/until end of turn/i.test(sentence)) {
          duration = 'EOT';
        } else if (/as long as/i.test(sentence)) {
          duration = 'COND';
        }

        const buffObj = { powDelta, touDelta, duration };
        ptBuffs.push(buffObj);

        addQuickAction({
          label:   `P/T buff ${signed(powDelta)}/${signed(touDelta)}`,
          type:    'ptBuff',
          powDelta,
          touDelta,
          duration
        });
      }

      // --- detect evergreen abilities granted in same sentence
      // We'll look for "has X", "have X", "gains X", "gain X"
      // and pull any of the EVERGREEN_ABILS words out
      const abilityGrantRegex = /\b(have|has|gains|gain)\s+([a-z\s]+?)(?:\.|,|$)/gi;
      const abilMatches = [...sentence.matchAll(abilityGrantRegex)];
      abilMatches.forEach(aMatch => {
        const rawAbilityChunk = (aMatch[2] || '').trim().toLowerCase();

        EVERGREEN_ABILS.forEach(kw => {
          const kwRegex = new RegExp(`\\b${kw}\\b`, 'i');
          if (kwRegex.test(rawAbilityChunk)) {
            const pretty = kw
              .split(' ')
              .map(w => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ');

            // create quick action to grant that ability
            addQuickAction({
              label:   `Grant ${pretty}`,
              type:    'grantAbility',
              ability: pretty
            });

            // also surface as chip
            addDetectedAbility(pretty);
          }
        });
      });
    });

    // --------------------------------------------------------
    // 10. COUNTERS
    //
    // e.g.
    //   "put a +1/+1 counter on target creature you control"
    //   "enters the battlefield with three +1/+1 counters on it"
    //   "Whenever you gain life, put a +1/+1 counter on each creature you control."
    //
    // We DO NOT treat this like a P/T buff. This is permanent counters.
    // We'll create a quickAction so Apply tab can jump to Counters tab prefilled.
    // --------------------------------------------------------
    {
      // broad pattern:
      // (put|enters with) <qty> <kind> counter
      const counterRegex =
        /(?:put|enters(?: the battlefield)? with)\s+(\d+|one|two|three|four|five|a|an|X)\s+([^.]*)\s+counter/gi;

      const counterMatches = [...line.matchAll(counterRegex)];
      counterMatches.forEach(m => {
        let qty = m[1] || '1';
        const qtyMap = {
          one:1, two:2, three:3, four:4, five:5,
          a:1, an:1
        };
        if (qtyMap[String(qty).toLowerCase()]) {
          qty = qtyMap[String(qty).toLowerCase()];
        }

        // rawKind might be "+1/+1", "time", "oil", etc,
        // plus trailing words like "on target creature you control"
        // We only want the counter NAME at the front.
        let rawKind = cutReminder(m[2] || '');
        // pull the first token that looks like "+1/+1" OR a word
        const kindMatch = rawKind.match(/\+?\d+\/\+?\d+|[a-z]+/i);
        const kind = kindMatch ? kindMatch[0].trim() : 'counter';

        counters.push({ kind, qty });

        addQuickAction({
          label: `${kind} counter x${qty}`,
          type:  'counter',
          kind,
          qty
        });
      });
    }
  }); // end per-line loop

  // ------------------------------------------------------------
  // GLOBAL/PARAGRAPH-AGNOSTIC CLEANUPS / EXTRA DETECTORS
  // (Stuff that can safely read fullText, not caring about lines,
  // but doesn't cause cross-line pollution.)
  // ------------------------------------------------------------

  // SUSPEND (global catch, just in case line parsing missed odd formatting)
  {
    const suspendRegexGlobal = /suspend\s+([0-9X]+)\s*[—-]\s*([^.;]+)/gi;
    const suspMatches = [...fullText.matchAll(suspendRegexGlobal)];
    suspMatches.forEach(m => {
      const suspendCount = (m[1] || '').trim();
      const suspendCost  = (m[2] || '').trim();
      // check if we already added an identical Suspend quickAction
      const dupe = quickActions.some(q =>
        q.type === 'suspend' &&
        q.count === suspendCount &&
        q.cost === suspendCost
      );
      if (!dupe) {
        addQuickAction({
          label: `Suspend ${suspendCount} — ${suspendCost}`,
          type:  'suspend',
          count: suspendCount,
          cost:  suspendCost
        });
      }
    });
  }

  // ------------------------------------------------------------
  // RETURN RESULT
  // ------------------------------------------------------------
  return {
    detectedFlags,
    quickActions,
    tokens,
    counters,
    ptBuffs
  };
}
