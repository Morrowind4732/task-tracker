// modules/ability.detect.js
// v1 — Headless MTG ability parsing & action inference (1:1 core logic from abilities.html)
//
// Exposes pure functions that mirror the parsing/detection behavior in abilities.html,
// without any DOM or network code. Plug into your own UI or game systems.
//
// Exports:
// - setChosenType(type), getChosenType(), withChosenType(str)
// - parseOracle(oracleText) -> [{ type:'activated'|'triggered'|'static', raw, cost, effect, chain? }]
// - scanReminderTokenAbilities(fullText) -> [{ token, cost, effect }]
// - pairInlineCreationWithReminder(fullText) -> [{ token, cost, effect }]
// - inferActionsFromText(text) -> [Action]
// - detectAll(oracleText) -> { abilities, expandedAbilities, abilitiesOnly, innateTokens }
//
// Notes:
// * “abilities” are clause heads; if a head had chain steps, “expandedAbilities” includes
//    those steps split out as separate items (type preserved). “abilitiesOnly” filters to
//    activated/triggered only (heads + split steps).
// * “innateTokens” merges global reminder token abilities and inline-paired definitions.
//

// ---------- Chosen type (shared across abilities) ----------
let CURRENT_CHOSEN_TYPE = null;
export function setChosenType(t){ CURRENT_CHOSEN_TYPE = t || null; }
export function getChosenType(){ return CURRENT_CHOSEN_TYPE; }
export function withChosenType(s){
  if (typeof s !== 'string') return s;
  return s.replace(/{{CHOSEN_TYPE}}/g, CURRENT_CHOSEN_TYPE ?? '(not chosen)');
}

// ---------- Utilities ----------
const NUMBER_WORDS = {a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20};
function numFromToken(tok){
  if (!tok) return null;
  if (/^\d+$/.test(tok)) return parseInt(tok,10);
  tok = tok.toLowerCase();
  return NUMBER_WORDS[tok] ?? null;
}
function extractNumberAfter(word, text){
  const w = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${w}s?\\s+(X|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\\d+)`,'i');
  const m = text.match(re); if (!m) return null;
  if (/^x$/i.test(m[1])) return 'X';
  return numFromToken(m[1]) ?? null;
}
const hasEOT = txt => /\buntil end of turn\b/i.test(txt || '');
function stripReminder(text){
  if (/^\(.*\)$/.test(text.trim())) return '';
  return text.replace(/\([^)]*\)/g,'');
}

// ---------- Token ability scanners ----------
export function scanReminderTokenAbilities(fullText){
  const results = [];
  const parens = fullText.match(/\([^)]*\)/g) || [];
  const rx = /\b(?:An?\s+)?([A-Z][A-Za-z-]*(?:\s+[A-Z][A-Za-z-]*)*)\s+(?:is|are)\s+an?\s+artifact(?:s)?\s+with\s+[“"]([^”"]+)[”"]/gi;
  for (const seg of parens){
    let m;
    while ((m = rx.exec(seg)) !== null){
      const tokenName = m[1].trim().replace(/\s+tokens?$/i,'');
      const quoted    = m[2].trim();
      const ce = quoted.split(/\s*:\s*/);
      if (ce.length >= 2){
        const cost   = ce[0].trim();
        const effect = ce.slice(1).join(':').trim().replace(/\.$/,'');
        results.push({ token: tokenName, cost, effect });
      }
    }
  }
  return results;
}

export function pairInlineCreationWithReminder(fullText){
  const pairs = [];
  const createRe = /\bcreate\b[^.]*?\b(?:a|an|\d+|X)?\s*([A-Z][a-zA-Z-]*(?:\s+[A-Z][a-zA-Z-]*)*)\s+token(s)?\b/gi;
  const defs = scanReminderTokenAbilities(fullText);

  let m;
  while ((m = createRe.exec(fullText)) !== null){
    const token = (m[1] || '').trim().replace(/\s+tokens?$/i,'');
    const afterIdx = m.index + m[0].length;
    const nextParen = fullText.slice(afterIdx).match(/\([^)]*\)/);
    if (nextParen){
      const seg = nextParen[0];
      const found = [];
      const rx = /\b(?:An?\s+)?([A-Z][A-Za-z-]*(?:\s+[A-Z][A-Za-z-]*)*)\s+(?:is|are)\s+an?\s+artifact(?:s)?\s+with\s+[“"]([^”"]+)[”"]/gi;
      let mm;
      while ((mm = rx.exec(seg)) !== null){
        const name   = mm[1].trim().replace(/\s+tokens?$/i,'');
        const quoted = mm[2].trim();
        const ce = quoted.split(/\s*:\s*/);
        if (ce.length >= 2){
          found.push({ token:name, cost:ce[0].trim(), effect:ce.slice(1).join(':').trim().replace(/\.$/,'') });
        }
      }
      let match = found.find(f => f.token.toLowerCase() === token.toLowerCase());
      if (!match){
        const mQuote = seg.match(/[“"]([^”"]+)[”"]/);
        if (mQuote){
          const q = mQuote[1].trim();
          const ce = q.split(/\s*:\s*/);
          if (ce.length >= 2){
            match = { token, cost: ce[0].trim(), effect: ce.slice(1).join(':').trim().replace(/\.$/,'') };
          }
        }
      }
      if (match) pairs.push(match);
    } else {
      const match = defs.find(d => d.token.toLowerCase() === token.toLowerCase());
      if (match) pairs.push(match);
    }
  }
  const byToken = new Map();
  for (const p of pairs){ if (!byToken.has(p.token.toLowerCase())) byToken.set(p.token.toLowerCase(), p); }
  return [...byToken.values()];
}

// ---------- Oracle parsing ----------
function splitClauses(text){
  if (!text) return [];
  const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const line of lines){
    const parts = line.split(
      /(?<=[.!?;—])\s+(?=(?:[A-Z(“"']|Then\b|If you do\b|You may\b|Among\b|From among\b|Of those\b|Put\b|Return\b|Reveal\b|Otherwise\b|This way\b|Create\b|Draw\b))/i
    );
    for (const p of parts){
      if (p && p.trim()) out.push(p.trim());
    }
  }
  return out;
}
function classify(clause){
  const c = clause.trim();
  if (/^as(?!\s+long\b)/i.test(c) && /\benters\b/i.test(c)) return 'triggered';
  if (/^\(.*\)$/.test(c)) return 'static';
  if (/^it[’']s an artifact with\b/i.test(c)) return 'static';
  if (/^(when|whenever)\b/i.test(c)) return 'triggered';
  if (/^at\b/i.test(c)) return 'triggered';
  if (/^\([+−-]?\d+\)\s*:/.test(c)) return 'activated';
  if (/(?:\{[^}]+\}|tap|untap|discard|sacrifice|pay|exile)[^:]*:\s*/i.test(c)) return 'activated';
  return 'static';
}
function parseCostAndEffect(clause){
  const i = clause.indexOf(':');
  if (i>-1) return {cost: clause.slice(0,i).trim(), effect: clause.slice(i+1).trim()};
  return {cost:null, effect: clause.trim()};
}
function parseAbility(clause){
  const type = classify(clause);
  const { cost, effect } = parseCostAndEffect(clause);
  return { type, raw: clause, cost, effect };
}
function groupIntoEffectChains(clauses){
  const out = [];
  for (let i=0; i<clauses.length; i++){
    const head = clauses[i];
    const kind = classify(head);
    const item = parseAbility(head);
    if (kind === 'activated' || kind === 'triggered'){
      const steps = [];
      let j = i + 1;
      while (j < clauses.length
        && /^(Then\b|If you do\b|You may\b|For each\b|Among (?:them|those)\b|From among\b|Of those\b|Put\b|Return\b|Reveal\b|Otherwise\b|This way\b|Create\b|Draw\b|It\b|They\b|Those\b|This creature\b|Other creatures\b|That (?:card|creature|player|permanent|spell)\b)/i
          .test(clauses[j].trim())
        && classify(clauses[j]) === 'static'){
        steps.push(clauses[j]);
        j++;
      }
      if (steps.length) item.chain = steps;
      out.push(item);
      i = j - 1;
    } else {
      out.push(item);
    }
  }
  return out;
}

export function parseOracle(text){
  if (!text) return [];
  const textNoParen = text.replace(/\([^)]*\)/g, ' ');
  const clauses = splitClauses(textNoParen).filter(Boolean);
  return groupIntoEffectChains(clauses);
}

// ---------- Target & choice helpers ----------
function findTarget(text){
  const t = text.toLowerCase();
  if (/\bthis creature\b/.test(t)) return {scope:'this_creature'};
  if (/\beach opponent\b/.test(t)) return {scope:'each_opponent'};
  if (/\beach player\b/.test(t)) return {scope:'each_player'};
  if (/\bany number of target\b/.test(t)) return {scope:'any_targets'};
  if (/\bup to [\w ]+ target\b/.test(t)) return {scope:'up_to_targets'};
  if (/\banother target creature you control\b/i.test(t)) return {scope:'another_target_creature_you_control'};
  if (/\btarget creature you control\b/.test(t)) return {scope:'target_creature_you_control'};
  if (/\bcreature you control\b/.test(t)) return {scope:'creature_you_control'};
  if (/\bcreature an opponent controls\b/.test(t)) return {scope:'creature_opponent_controls'};
  if (/\btarget creature\b/.test(t)) return {scope:'target_creature'};
  if (/\btarget player\b/.test(t)) return {scope:'target_player'};
  if (/\byou\b/.test(t)) return {scope:'you'};
  if (/\ban opponent\b/.test(t)) return {scope:'opponent'};
  return {scope:'unspecified'};
}
function extractChoiceList(text, anchorRe){
  const m = text.match(anchorRe);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length).trim();
  const stopIdx = (() => {
    const stops = [];
    const u = after.search(/\buntil end of turn\b/i); if (u >= 0) stops.push(u);
    const p = after.indexOf('.'); if (p >= 0) stops.push(p);
    return stops.length ? Math.min(...stops) : after.length;
  })();
  const span = after.slice(0, stopIdx);
  const norm = span.replace(/\s+or\s+/gi, ', ').replace(/\s+/g, ' ').trim();
  return norm.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
}
function mapChoiceOption(raw){
  const s = raw.toLowerCase();
  const KW = ['banding','double strike','fear','flying','first strike','haste','provoke','shadow','trample'];
  for (const k of KW){ if (s === k) return {kind:'grant_keyword', keyword:k}; }
  const mB = s.match(/^bushido\s+(\d+)$/); if (mB) return {kind:'grant_keyword', keyword:`bushido ${mB[1]}`};
  const mR = s.match(/^rampage\s+(\d+)$/); if (mR) return {kind:'grant_keyword', keyword:`rampage ${mR[1]}`};
  if (/^landwalk of your choice$/.test(s)) return {kind:'grant_keyword_choice', keyword:'landwalk', param:'land_type'};
  if (/^protection from a color of your choice$/.test(s)) return {kind:'grant_keyword_choice', keyword:'protection', param:'color'};
  return {kind:'note', text: raw};
}
function extractPTBuff(text){
  const m = text.replace('−','-').match(/\bgets\s*([+-]?\d+)\s*\/\s*([+-]?\d+)/i);
  if (m){
    return {kind:'pt_mod', power:parseInt(m[1],10), toughness:parseInt(m[2],10), target:'this_creature', untilEOT:/until end of turn/i.test(text)};
  }
  return null;
}
function extractPTSwapChoices(text){
  const m = text.replace('−','-').match(/\bgets\s*\+(\d+)\s*\/\s*-(\d+)\s*or\s*-(\d+)\s*\/\s*\+(\d+)/i);
  if (m){
    const a = parseInt(m[1],10), b = parseInt(m[2],10), a2 = parseInt(m[3],10), b2 = parseInt(m[4],10);
    return [
      {kind:'pt_mod', power:+a, toughness:-b, target:'this_creature'},
      {kind:'pt_mod', power:-a2, toughness:+b2, target:'this_creature'}
    ];
  }
  return null;
}

// ---------- Action inference ----------
export function inferActionsFromText(text){
  let t = stripReminder(text.trim());
  if (!t) return [{kind:'note', text:'(reminder text)'}];

  const tgt = findTarget(t);
  const untilEOT = hasEOT(t);
  const actions = [];

  // Choose a creature type (global choice setter)
  if (/\bchoose a creature type\b/i.test(t)){
    actions.push({ kind:'choice', label:'Choose a creature type', options:[{ kind:'set_type_choice', target:'this_creature', untilEOT:false }] });
  }

  // Investigate (create Clues)
  if (/\binvestigate\b/i.test(t)){
    const n = extractNumberAfter('investigate', t) ?? 1;
    actions.push({ kind:'create_tokens', amount:n, token:'Clue', controller:'you' });
  }

  // Protection handling (colorless + color-of-choice)
  {
    const hasColorless   = /\bgains?\s+protection\s+from\s+colorless\b/i.test(t);
    const hasColorChoice = /\bprotection\s+from\s+(?:a|the)\s+color\s+of\s+your\s+choice\b/i.test(t)
                        || /\bfrom\s+the\s+color\s+of\s+your\s+choice\b/i.test(t);

    if (hasColorless && hasColorChoice){
      actions.push({
        kind:'choice',
        label:'Grant protection (colorless or choose a color)',
        options:[
          { kind:'grant_keyword', keyword:'protection from colorless', target: tgt.scope || 'this_creature', untilEOT },
          { kind:'grant_keyword_choice', keyword:'protection', param:'color', target: tgt.scope || 'this_creature', untilEOT }
        ]
      });
    } else {
      if (hasColorless){
        actions.push({ kind:'grant_keyword', keyword:'protection from colorless', target: tgt.scope || 'this_creature', untilEOT });
      }
      if (hasColorChoice){
        actions.push({
          kind:'choice',
          label:'Grant protection (choose a color)',
          options:[
            { kind:'grant_keyword', keyword:'protection from white',  target:tgt.scope || 'this_creature', untilEOT },
            { kind:'grant_keyword', keyword:'protection from blue',   target:tgt.scope || 'this_creature', untilEOT },
            { kind:'grant_keyword', keyword:'protection from black',  target:tgt.scope || 'this_creature', untilEOT },
            { kind:'grant_keyword', keyword:'protection from red',    target:tgt.scope || 'this_creature', untilEOT },
            { kind:'grant_keyword', keyword:'protection from green',  target:tgt.scope || 'this_creature', untilEOT },
          ]
        });
      }
    }
  }

  // Generic “gains your choice of …”
  const choiceGainList = extractChoiceList(t, /\bgains?\s+your choice of\s+/i);
  if (choiceGainList && choiceGainList.length){
    const options = choiceGainList.map(mapChoiceOption).map(op => {
      if (op.kind === 'grant_keyword')        return {kind:'grant_keyword', keyword:op.keyword, target:'this_creature', untilEOT};
      if (op.kind === 'grant_keyword_choice') return {kind:'grant_keyword_choice', keyword:op.keyword, param:op.param, target:'this_creature', untilEOT};
      return op;
    });
    actions.push({ kind:'choice', label:'Grant one (your choice)', options });
  }

  // “Add one mana of any (one) color”
  if (/\badd\s+(?:one|1)\s+mana\s+of\s+any\s+(?:one\s+)?color\b/i.test(t)) {
    actions.push({
      kind:'choice',
      label:'Add one mana (choose a color)',
      options:[
        { kind:'add_mana', symbols:['W'] },
        { kind:'add_mana', symbols:['U'] },
        { kind:'add_mana', symbols:['B'] },
        { kind:'add_mana', symbols:['R'] },
        { kind:'add_mana', symbols:['G'] },
      ]
    });
  }

  // Becomes color/type of your choice
  if (/\bbecomes the colors? of your choice\b/i.test(t)){
    actions.push({ kind:'choice', label:'Choose color(s)', options:[{kind:'set_color_choice', target:'this_creature', untilEOT}] });
  }
  if (/\bbecomes the creature type of your choice\b/i.test(t)){
    actions.push({ kind:'choice', label:'Choose a creature type', options:[{kind:'set_type_choice', target:'this_creature', untilEOT}] });
  }

  // “Create A or B token” choice
  const tokChoice = t.match(/\bcreate\b[^.]*?\b(\w+)\s+token\b[^.]*?\bor\b[^.]*?\b(\w+)\s+token\b/i);
  if (tokChoice){
    const A = tokChoice[1], B = tokChoice[2];
    actions.push({ kind:'choice', label:'Create a token (choose one)', options:[
      {kind:'create_tokens', amount:1, token:A, controller:'you'},
      {kind:'create_tokens', amount:1, token:B, controller:'you'}
    ]});
  }

  // P/T buffs
  const buff = extractPTBuff(t);
  if (buff){ buff.untilEOT = hasEOT(t); actions.push(buff); }
  const ptSwap = extractPTSwapChoices(t);
  if (ptSwap){ ptSwap.forEach(o => o.untilEOT = untilEOT); actions.push({ kind:'choice', label:'Pick a P/T mode', options: ptSwap }); }

  // Adaptive Automaton-style chosen type integrations
  if (/^this creature is the chosen type in addition to its other types/i.test(t)){
    actions.push({ kind:'note', text:'This creature is also the chosen type: {{CHOSEN_TYPE}}' });
  }
  {
    const mLord = t.match(/other creatures you control of the chosen type get\s*\+(\d+)\s*\/\s*\+(\d+)/i);
    if (mLord){
      const p = parseInt(mLord[1],10), q = parseInt(mLord[2],10);
      actions.push({
        kind:'pt_mod',
        power:p,
        toughness:q,
        target:'your_other_creatures_of_chosen_type',
        chosenType:'{{CHOSEN_TYPE}}'
      });
    }
  }

  // General detections
  let n;
  if ((n = extractNumberAfter('gain', t)) || /\bgain life\b/i.test(t)){
    actions.push({kind:'gain_life', amount: n ?? 1, target: tgt.scope === 'unspecified' ? 'you' : tgt.scope});
  }
  if ((n = extractNumberAfter('lose', t)) && /\blife\b/i.test(t)){
    actions.push({kind:'lose_life', amount:n, target: tgt.scope === 'unspecified' ? 'opponent_or_target' : tgt.scope});
  }
  if ((n = extractNumberAfter('draw', t)) || /\bdraw (a|one) card\b/i.test(t)){
    actions.push({kind:'draw_cards', amount: n ?? 1, target: tgt.scope === 'unspecified' ? 'you' : tgt.scope});
  }
  if ((n = extractNumberAfter('discard', t)) || /\bdiscard a card\b/i.test(t)){
    actions.push({kind:'discard_cards', amount: n ?? 1, target: tgt.scope === 'unspecified' ? 'you' : tgt.scope});
  }
  if ((n = extractNumberAfter('mill', t)) || /\bmill a card\b/i.test(t)){
    actions.push({kind:'mill_cards', amount: n ?? 1, target: tgt.scope});
  }
  {
    const mDmg = t.match(/\bdeal(?:s)?\s+(X|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+)\s+damage\b/i);
    if (mDmg){
      const tok = mDmg[1];
      const amount = /^x$/i.test(tok) ? 'X' : ((numFromToken(tok) ?? parseInt(tok,10)) || 1);
      const anyTarget = /\bany target\b/i.test(t) ? 'any_target' : tgt.scope;
      actions.push({kind:'deal_damage', amount, target:anyTarget});
    }
  }
  if (/\b\+1\/\+1 counter\b/i.test(t)){
    const amt = extractNumberAfter('put', t) ?? 1;
    actions.push({kind:'put_counters', counter:'+1/+1', amount:amt, target:tgt.scope || 'this_creature', untilEOT});
  }
  if (/\bloyalty counter\b/i.test(t)){
    const amt = extractNumberAfter('put', t) ?? 1;
    actions.push({kind:'put_counters', counter:'loyalty', amount:amt, target:tgt.scope});
  }
    // Named counters (e.g., "Void counter", "Shield counter", etc.)
  {
    // capture the word(s) immediately before "counter"
    const mNamed = t.match(/\bput\b[^.]*?\b(?:X|a|an|one|1|\d+)?\s*([A-Za-z+\/-]+)\s+counter\b/i);
    if (mNamed && !/\+1\/\+1|loyalty/i.test(mNamed[1])) {
      const amt = extractNumberAfter('put', t) ?? 1;
      const name = mNamed[1].trim();
      actions.push({ kind:'put_counters', counter:name, amount:amt, target:tgt.scope });
    }
  }
  
  // (A) Named counter in a "put … counter(s)" phrasing
  // e.g., "Put a Void counter on it", "Put two Shield counters on target creature"
  {
    const m = t.match(
      /\bput\b[^.]*?\b(?:X|a|an|one|1|\d+)?\s*([A-Za-z][A-Za-z+\/-]*(?:\s+[A-Za-z][A-Za-z+\/-]*)*)\s+counters?\b/i
    );
    if (m && !/\+1\/\+1|loyalty/i.test(m[1])) {
      const amt = extractNumberAfter('put', t) ?? 1;
      const name = m[1].trim();
      actions.push({ kind:'put_counters', counter:name, amount:amt, target:tgt.scope });
    }
  }

  // (B) Mentioned counters in "with … counter(s) on …" phrasing (no explicit "put")
  // e.g., "… with a Void counter on it", "… with two stun counters on that permanent"
  {
    const m = t.match(
      /\bwith\b\s+(X|a|an|one|1|\d+)?\s*([A-Za-z][A-Za-z+\/-]*(?:\s+[A-Za-z][A-Za-z+\/-]*)*)\s+counters?\s+on\b/i
    );
    if (m && !/\+1\/\+1|loyalty/i.test(m[2])) {
      const tok = m[1];
      let amt = 1;
if (tok) {
  if (/^x$/i.test(tok)) {
    amt = 'X';
  } else {
    const nWord = numFromToken(tok);
    if (Number.isFinite(nWord)) {
      amt = nWord;
    } else {
      const n = parseInt(tok, 10);
      amt = Number.isFinite(n) ? n : 1;
    }
  }
}

      const name = m[2].trim();
      actions.push({ kind:'put_counters', counter:name, amount:amt, target:tgt.scope });
    }
  }
  
  if (/\b(counter|counters) on (?:it|this|that|enchanted|equipped|target)\b/i.test(t) && !/\+1\/\+1|loyalty/i.test(t)){
    const amt = extractNumberAfter('put', t) ?? 1;
    actions.push({kind:'put_counters', counter:'unspecified', amount:amt, target:tgt.scope});
  }
  if (/\bcreate\b/i.test(t) && /\btoken\b/i.test(t) && !tokChoice){
    const amt = extractNumberAfter('create', t) ?? 1;
    const mTok = t.match(/\bcreate\b[^.]*?\b(?:a|an|one|1|\d+|X)?\s*([A-Z][a-zA-Z-]*(?:\s+[A-Z][a-zA-Z-]*)*)\s+token(?:s)?\b/i);
    const nameRaw = mTok ? mTok[1] : '(see text)';
    const name = nameRaw.replace(/^(?:a|an|one)\s+/i, '').trim();
    actions.push({ kind:'create_tokens', amount: amt, token: name, controller: 'you' });
  }
  if (/\buntap\b/i.test(t)) actions.push({kind:'untap', target:tgt.scope || 'this_creature'});
  if (/\btap target\b/i.test(t) || /\btap (?:up to|any number of|a|one)\b/i.test(t)) actions.push({kind:'tap', target:tgt.scope});
  if (/\badd\b/i.test(t) && /\{[WUBRGCSX0-9/]+\}/i.test(t)){
    const symbols = (t.match(/\{[^}]+\}/g) || []).map(s => s.replace(/[{}]/g,'').toUpperCase());
    actions.push({kind:'add_mana', symbols});
  }
  if (/\bsearch your library\b/i.test(t)) actions.push({kind:'search_library', target:'you', note:'perform search + shuffle as specified'});
// Fallback: "Search your <zone>" even without a specific "for <term>".
// This guarantees a pill like "Search your Library" appears.
{
  const m = t.match(/\bsearch\s+your\s+(library|deck|graveyard|exile|hand)\b/i);
  if (m) {
    actions.push({ kind:'open_zone_filter', zone: m[1].toLowerCase(), query: '' });
  }
}

// --- Custom: "Search your XYZ for ABC" (graveyard/exile/deck/library/hand) ---
{
  const zonePart = '(library|deck|graveyard|exile|hand)(?:\\s+and\\/or\\s+(library|deck|graveyard|exile|hand))?';
  const boundary = '(?:\\.|,|;|\\bthen\\b|\\band\\b|\\bwhere\\b|\\breveal\\b|\\bshuffle\\b|$)';

  // Pass 1: “a card named <X>”
  {
    const reNamed = new RegExp(
      `\\bsearch\\s+your\\s+${zonePart}[^.]*?\\bfor\\b\\s+a\\s+card\\s+named\\s+([^]+?)\\s*(?=${boundary})`,
      'i'
    );
    const m = t.match(reNamed);
    if (m){
      const zone = (m[1] || m[2] || '').toLowerCase();   // prefer first zone
      let term   = (m[3] || '').trim();
      if (zone) actions.push({ kind:'open_zone_filter', zone, query: term });
    }
  }

  // Pass 2: generic “for <phrase>” (e.g., “for a card”, “for creature”, etc.)
  {
    const reGeneric = new RegExp(
      `\\bsearch\\s+your\\s+${zonePart}[^.]*?\\bfor\\b\\s+([^]+?)\\s*(?=${boundary})`,
      'i'
    );
    const m = t.match(reGeneric);
    if (m){
      const zone = (m[1] || m[2] || '').toLowerCase();
      let term   = (m[3] || '').trim();

      // Normalize super-generic phrases to empty query: “a card”, “any card”, “cards”, “card …”
      if (/^(?:a|an|any)?\s*cards?\b/i.test(term)) term = '';

      // Just in case: strip trailing clause starters
      term = term.replace(/\s+(?:then|and|where|reveal|shuffle)\b[\s\S]*$/i, '')
                 .replace(/[.,;]\s*$/, '');

      if (zone) actions.push({ kind:'open_zone_filter', zone, query: term });
    }
  }
}



  if ((n = extractNumberAfter('scry', t))) actions.push({kind:'scry', amount:n, target:'you'});
  if ((n = extractNumberAfter('surveil', t))) actions.push({kind:'surveil', amount:n, target:'you'});
  if (/\breturn target .* to (?:its|their) owner'?s hand\b/i.test(t)) actions.push({kind:'return_to_hand', target:tgt.scope});
  if (/\breturn target .* from your graveyard to the battlefield\b/i.test(t)) actions.push({kind:'reanimate', target:tgt.scope});
  if (/\bexile target\b/i.test(t)) actions.push({kind:'exile', target:tgt.scope});
  if (/\bsacrifice (?:a|one|\d+)\b/i.test(t)){
    const amt = extractNumberAfter('sacrifice', t) ?? 1;
    actions.push({kind:'sacrifice', amount:amt, target:tgt.scope === 'unspecified' ? 'you' : tgt.scope});
  }
  if (/\bdestroy target\b/i.test(t)) actions.push({kind:'destroy', target:tgt.scope});
  if (/\bgain control of\b/i.test(t)) actions.push({kind:'gain_control', target:tgt.scope});
  if (/\bfight\b/i.test(t)) actions.push({kind:'fight', target:'two_creatures_selected'});

  if (!actions.length) actions.push({kind:'note', text:'No concrete action recognized. Review manually.'});
  return actions;
}

// ---------- High-level detection ----------
export function detectAll(oracleText){
  const abilities = parseOracle(oracleText);

  // Expand: heads plus split chain steps as their own items
  const expanded = [];
  for (const ab of abilities){
    if (ab.type === 'activated' || ab.type === 'triggered'){
      expanded.push({...ab, chain: []}); // head only
      if (ab.chain && ab.chain.length){
        for (const c of ab.chain){
          expanded.push({ type: ab.type, raw: c, cost: null, effect: c, chain: [] });
        }
      }
    } else {
      expanded.push(ab);
    }
  }
  const abilitiesOnly = expanded.filter(it => it.type === 'activated' || it.type === 'triggered');

  // Innate (token reminders) = global reminders + inline-paired
  const innateA = scanReminderTokenAbilities(oracleText);
  const innateB = pairInlineCreationWithReminder(oracleText);
  const seen = new Map();
  [...innateA, ...innateB].forEach(x => { const k=x.token.toLowerCase(); if (!seen.has(k)) seen.set(k, x); });
  const innateTokens = [...seen.values()];

  return { abilities, expandedAbilities: expanded, abilitiesOnly, innateTokens };
}

// ---------- Optional: text renderer (headless) ----------
export function actionLines(actions){
  const amt = x => x === 'X' ? 'X' : (x ?? 1);
  const plural = x => x === 1 ? '' : (x === 'X' ? 's' : 's');
  function actor(scope){
    switch(scope){
      case 'you': return 'you';
      case 'opponent': return 'target opponent';
      case 'each_opponent': return 'each opponent';
      case 'each_player': return 'each player';
      case 'any_target': return 'any target';
      case 'target_player': return 'target player';
      case 'target_creature': return 'target creature';
      case 'target_creature_you_control': return 'target creature you control';
      case 'creature_you_control': return 'a creature you control';
      case 'creature_opponent_controls': return 'a creature an opponent controls';
      case 'up_to_targets': return 'up to N targets (choose)';
      case 'any_targets': return 'any number of targets (choose)';
      case 'this_creature': return 'this creature';
      case 'your_other_creatures_of_chosen_type': {
        return getChosenType() ? `your other creatures of the chosen type "${getChosenType()}"` : 'your other creatures of the chosen type';
      }
      case 'opponent_or_target': return 'target opponent/target';
      case 'unspecified': default: return 'this creature';
    }
  }

  return actions.map((a,i)=>{
    const eot = a.untilEOT ? ' (until EOT)' : '';
    switch(a.kind){
      case 'gain_life':        return `${i+1}. ${actor(a.target)} gains ${amt(a.amount)} life.`;
      case 'lose_life':        return `${i+1}. ${actor(a.target)} loses ${amt(a.amount)} life.`;
      case 'draw_cards':       return `${i+1}. ${actor(a.target)} draws ${amt(a.amount)} card${plural(a.amount)}.`;
      case 'discard_cards':    return `${i+1}. ${actor(a.target)} discards ${amt(a.amount)} card${plural(a.amount)}.`;
      case 'mill_cards':       return `${i+1}. ${actor(a.target)} mills ${amt(a.amount)} card${plural(a.amount)}.`;
      case 'deal_damage':      return `${i+1}. Deal ${amt(a.amount)} damage to ${actor(a.target)}.`;
      case 'put_counters':     return `${i+1}. Put ${amt(a.amount)} ${a.counter} counter${plural(a.amount)} on ${actor(a.target)}${eot}.`;
      case 'grant_keyword':    return `${i+1}. ${actor(a.target)} gains ${a.keyword}${eot}.`;
      case 'pt_mod':           return `${i+1}. ${actor(a.target)} gets ${a.power>=0?'+':''}${a.power}/${a.toughness>=0?'+':''}${a.toughness}${eot}.`;
      case 'note':             return `${i+1}. ${withChosenType(a.text)}`;
      case 'create_tokens':    return `${i+1}. Create ${amt(a.amount)} ${a.token} token${plural(a.amount)}.`;
      case 'tap':              return `${i+1}. Tap ${actor(a.target)}.`;
      case 'untap':            return `${i+1}. Untap ${actor(a.target)}.`;
      case 'add_mana':         return `${i+1}. Add mana: ${a.symbols.join(' ')}.`;
      case 'search_library':   return `${i+1}. ${actor(a.target)} searches library as specified, then shuffles.`;
      case 'scry':             return `${i+1}. ${actor(a.target)} scries ${amt(a.amount)}.`;
      case 'surveil':          return `${i+1}. ${actor(a.target)} surveils ${amt(a.amount)}.`;
      case 'return_to_hand':   return `${i+1}. Return ${actor(a.target)} to its owner's hand.`;
      case 'reanimate':        return `${i+1}. Return ${actor(a.target)} from your graveyard to the battlefield.`;
      case 'exile':            return `${i+1}. Exile ${actor(a.target)}.`;
      case 'sacrifice':        return `${i+1}. ${actor(a.target)} sacrifices ${amt(a.amount)} permanent${plural(a.amount)} (choose).`;
      case 'destroy':          return `${i+1}. Destroy ${actor(a.target)}.`;
      case 'gain_control':     return `${i+1}. Gain control of ${actor(a.target)}.`;
      case 'fight':            return `${i+1}. Two target creatures fight.`;
      case 'choice':           return `${i+1}. Choose one — ${a.label}`;
      case 'set_color':        return `${i+1}. Set color(s) of ${actor(a.target)} to ${a.colors.join(', ')}${eot}.`;
      case 'set_creature_type':return `${i+1}. Set creature type of ${actor(a.target)} to ${a.type}${eot}.`;
      default:                 return `${i+1}. [Unknown action]`;
    }
  }).join('\n');
}
