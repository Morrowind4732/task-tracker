const STORAGE_KEY = 'fancy-card-table-ai-brain-v1';

const NUMBER_WORDS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20
};

const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'];
const COLOR_LAND_PRIORITY = ['Forest', 'Mountain', 'Plains', 'Island', 'Swamp', 'Wastes'];

const LAND_MANA_BY_NAME = {
  Plains: 'W',
  Island: 'U',
  Swamp: 'B',
  Mountain: 'R',
  Forest: 'G',
  Wastes: 'C'
};
const MANA_WORDS = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  colorless: 'C'
};
const KEYWORD_ABILITY_TERMS = [
  'double strike',
  'first strike',
  'protection from [^,.;]+',
  'hexproof from [^,.;]+',
  'ward\\s+\\{[^}]+\\}',
  'ward\\s+\\d+',
  'toxic\\s+\\d+',
  'annihilator\\s+\\d+',
  'absorb\\s+\\d+',
  'afflict\\s+\\d+',
  'amplify\\s+\\d+',
  'bushido\\s+\\d+',
  'rampage\\s+\\d+',
  'bloodthirst\\s+\\d+',
  'dredge\\s+\\d+',
  'fading\\s+\\d+',
  'graft\\s+\\d+',
  'modular\\s+\\d+',
  'poisonous\\s+\\d+',
  'soulshift\\s+\\d+',
  'vanishing\\s+\\d+',
  '(?:forest|island|swamp|mountain|plains|desert|nonbasic land|snow land|land)walk',
  'battle cry',
  'split second',
  'totem armor',
  'trample',
  'flying',
  'haste',
  'deathtouch',
  'lifelink',
  'vigilance',
  'reach',
  'menace',
  'defender',
  'flash',
  'indestructible',
  'hexproof',
  'shroud',
  'ward',
  'protection',
  'prowess',
  'fear',
  'intimidate',
  'shadow',
  'horsemanship',
  'flanking',
  'provoke',
  'wither',
  'infect',
  'persist',
  'undying',
  'skulk',
  'exalted',
  'training',
  'decayed',
  'changeling',
  'devoid',
  'phasing',
  'soulbond',
  'riot',
  'melee',
  'myriad'
];
const KEYWORD_ABILITY_PATTERN = KEYWORD_ABILITY_TERMS.join('|');
const BATTLEFIELD_ZONES = ['creatures', 'artifacts', 'enchantments', 'mana'];

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function manaSymbolsFromText(text = '') {
  const symbols = [];
  const raw = String(text || '');
  const matches = raw.match(/\{[^}]+\}/g) || [];
  for (const match of matches) {
    const body = match.replace(/[{}]/g, '').toUpperCase();
    if (/^[WUBRGC]$/.test(body)) symbols.push(body);
    else if (/^[WUBRGC]\/[WUBRGC]$/.test(body)) symbols.push('ANY');
    else if (body === 'ANY') symbols.push('ANY');
  }
  if (!symbols.length) {
    const lowered = raw.toLowerCase();
    if (/any color|one mana of any/i.test(raw)) symbols.push('ANY');
    for (const [word, symbol] of Object.entries(MANA_WORDS)) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(lowered)) symbols.push(symbol);
    }
  }
  return symbols;
}


function normalizeManaSymbolsInput(symbols = []) {
  if (Array.isArray(symbols)) return symbols.filter(Boolean);
  if (typeof symbols === 'string') {
    const raw = symbols.trim();
    if (!raw) return [];
    const braceMatches = raw.match(/\{[^}]+\}/g);
    if (braceMatches?.length) {
      return braceMatches
        .map((item) => item.replace(/[{}]/g, '').toUpperCase())
        .filter(Boolean);
    }
    if (raw === '?') return ['?'];
    if (/^[WUBRGC]$/i.test(raw)) return [raw.toUpperCase()];
    if (/^ANY$/i.test(raw)) return ['ANY'];
    return [raw];
  }
  return [];
}

function manaSymbolsFromLand(card = {}) {
  const text = `${card.name || ''} ${card.typeLine || ''}`;
  for (const [land, symbol] of Object.entries(LAND_MANA_BY_NAME)) {
    if (new RegExp(`\\b${land}\\b`, 'i').test(text)) return [symbol];
  }
  return [];
}

export function formatManaSymbols(symbols = []) {
  const normalized = normalizeManaSymbolsInput(symbols);
  if (!normalized.length) return '?';
  return normalized.map((symbol) => {
    if (symbol === 'ANY') return '{Any}';
    if (symbol === '?') return '?';
    return `{${String(symbol).toUpperCase()}}`;
  }).join('');
}

export function plainManaLabel(symbols = []) {
  const normalized = normalizeManaSymbolsInput(symbols);
  if (!normalized.length) return '?';
  return normalized.map((symbol) => symbol === 'ANY' ? 'Any' : String(symbol).toUpperCase()).join('');
}

function isCreaturePermanent(boardCard) {
  return /\bCreature\b/i.test(boardCard?.card?.typeLine || '');
}

function hasHaste(boardCard) {
  const text = `${boardCard?.card?.oracleText || ''} ${(boardCard?.mods || []).map((mod) => mod.trait || '').join(' ')}`;
  return /\bhaste\b/i.test(text);
}

function enteredTapped(card = {}) {
  return /enters (the battlefield )?tapped/i.test(card.oracleText || '');
}

function hasTapCost(ability = {}) {
  return Boolean(ability.requiresTap || /\{t\}|tap/i.test(`${ability.costText || ''} ${ability.cost?.raw || ''}`));
}

function executableFromAction(action = {}, source = 'parsed') {
  if (!action?.type) return null;
  const isMana = action.type === 'add_mana';
  const mana = isMana
    ? (action.producedMana?.length ? action.producedMana : manaSymbolsFromText(action.mana || action.effectText || action.label || ''))
    : [];
  if (isMana && !mana.length) return null;
  return {
    id: `${source}-${action.abilityId || action.type}-${action.costText || 'no-cost'}-${action.type}`,
    source,
    type: isMana ? 'mana' : 'activated',
    actionType: action.type,
    label: action.label || action.type,
    costText: action.costText || '',
    effectText: action.effectText || action.abilityText || action.label || '',
    abilityText: action.abilityText || '',
    cost: action.cost || parseCostText(action.costText || ''),
    requiresTap: /\{t\}|tap/i.test(action.costText || '') || action.cost?.parts?.some((part) => part.type === 'tap') || false,
    mana,
    producedManaLabel: action.producedManaLabel || compactManaLabel(mana),
    colorMode: action.colorMode || '',
    manaRestriction: action.manaRestriction || '',
    manaRestrictionKind: action.manaRestrictionKind || '',
    restrictedMana: Boolean(action.restrictedMana || action.manaRestriction),
    amountFormula: action.amountFormula || '',
    amountLabel: action.amountLabel || ''
  };
}

function executableAbilitiesFromPlan(plan = {}) {
  return (plan.actions || [])
    .map((action) => executableFromAction(action, 'learned'))
    .filter(Boolean);
}

function normalizedAbilityKeyText(text = '') {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]+$/g, '')
    .toLowerCase();
}

function mergeExecutableAbilities(existing = [], incoming = []) {
  return uniqueBy([...(existing || []), ...(incoming || [])], (ability) => `${ability.type}|${ability.actionType}|${normalizedAbilityKeyText(ability.costText)}|${normalizedAbilityKeyText(ability.effectText)}|${formatManaSymbols(ability.mana)}|${normalizedAbilityKeyText(ability.manaRestriction || '')}`);
}

function cleanText(text = '') {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const parenthesizedMana = raw.match(/^\(\s*((?:\{[^}]+\}\s*,?\s*)+:\s*Add\s+.+?\.?\s*)\)$/i);
  if (parenthesizedMana) return parenthesizedMana[1].replace(/\s+/g, ' ').trim();
  return raw
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function visibleRulesText(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function commanderColorIdentityHint(context = {}) {
  const commander = (context.boardCards || []).find((card) => card.ownerSeat === context.seat && card.isCommander)?.card
    || context.commander
    || null;
  const colors = commander?.colors || commander?.colorIdentity || [];
  return colors.length ? colors.map((color) => String(color).toUpperCase()) : [];
}

function detectResponseProfile(card = {}, actions = []) {
  const typeLine = String(card.typeLine || '');
  const oracle = String(card.oracleText || '');
  const text = `${typeLine} ${oracle}`;
  const reasons = [];
  if (/\bInstant\b/i.test(typeLine)) reasons.push('Instant card');
  if (/\bflash\b/i.test(oracle)) reasons.push('Has flash / can be cast at instant speed');
  if (/counter target|target spell|spell or ability/i.test(oracle)) reasons.push('Interacts with spells or abilities on the stack');
  if (/prevent .*damage|damage .*prevented|protection from|hexproof|indestructible until|regenerate/i.test(oracle)) reasons.push('Protective or prevention response');
  if (/target attacking|target blocking|attacking creature|blocking creature|before blockers|after blockers/i.test(oracle)) reasons.push('Combat response text');
  if (/you may cast .* as though .* flash|any time you could cast an instant/i.test(oracle)) reasons.push('Oracle text permits instant-speed use');
  const reactiveAction = actions.some((action) => {
    if (['equip', 'equipment_static_pt', 'grant_trait', 'intrinsic_trait', 'choose_creature_type'].includes(action.type)) return false;
    const text = `${action.effectText || ''} ${action.abilityText || ''} ${action.sourceText || ''}`;
    const hasPriorityWords = /instant|combat|damage|attacking|blocking|target spell|spell or ability|counter target/i.test(text);
    return ['destroy', 'exile', 'modify_pt', 'add_counters', 'gain_life'].includes(action.type) && hasPriorityWords;
  });
  if (reactiveAction) reasons.push('Parsed action could matter during priority');
  return {
    responseWorthy: reasons.length > 0,
    reasons: [...new Set(reasons)],
    label: reasons.length ? `Response-worthy: ${[...new Set(reasons)].join('; ')}` : 'No response action detected yet'
  };
}


function normalizePatternText(text = '') {
  return visibleRulesText(text)
    .toLowerCase()
    .replace(/\b(?:this card|this creature|this permanent|this source|it)\b/g, 'this')
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g, 'card')
    .replace(/\s+/g, ' ')
    .trim();
}

function actionPatternKey(action = {}) {
  const type = action.type || 'unknown';
  const mana = action.producedMana?.length ? formatManaSymbols(action.producedMana) : formatManaSymbols(action.mana || []);
  const cost = normalizePatternText(action.costText || '');
  const trigger = normalizePatternText(action.triggerText || '');
  if (type === 'add_mana') return `add_mana|cost:${cost}|mana:${mana}|mode:${action.colorMode || 'fixed'}|amount:${action.amountFormula || action.amountLabel || 'fixed'}|restriction:${normalizePatternText(action.manaRestriction || '')}`;
  if (type === 'draw') return `draw|trigger:${trigger ? 'triggered' : 'none'}|count:${action.count || 1}|condition:${Boolean(action.conditionText)}`;
  if (type === 'intrinsic_trait') return `intrinsic_trait|${String(action.trait || '').toLowerCase()}`;
  if (type === 'grant_trait') return `grant_trait|${normalizePatternText(action.affectedObjects || '')}|${String(action.trait || '').toLowerCase()}|duration:${action.duration || ''}`;
  if (type === 'modify_pt') return `modify_pt|${normalizePatternText(action.affectedObjects || '')}|${action.powerDelta}/${action.toughnessDelta}|duration:${action.duration || ''}|x:${normalizePatternText(action.xDefinition || '')}`;
  if (type === 'set_base_pt') return `set_base_pt|${normalizePatternText(action.affectedObjects || '')}|${action.basePower}/${action.baseToughness}|duration:${action.duration || ''}`;
  if (type === 'triggered_damage_echo') return `triggered_damage_echo|${normalizePatternText(action.damageSourceText || '')}|${normalizePatternText(action.damageTargetText || '')}|trigger:${trigger ? 'triggered' : 'none'}`;
  if (type === 'search_library') {
    const criteria = action.searchCriteria || {};
    const distribution = (action.distribution || criteria.distribution || []).map((item) => `${item.count || 1}:${item.destination || 'hand'}:${item.tapped ? 'tapped' : 'untapped'}`).join(',');
    return `search_library|max:${criteria.maxChoices || 1}|optional:${Boolean(criteria.optionalCount)}|filters:${(criteria.landChoices || criteria.targetFilters || []).join('/') || 'Card'}|distribution:${distribution}|shuffle:${Boolean(criteria.thenShuffle || action.thenShuffle)}`;
  }
  if (type === 'entry_modifier') return `entry_modifier|${action.entryType || 'tapped'}|unless:${Boolean(action.unlessClause)}`;
  if (type === 'cycling') return `cycling|cost:${cost}`;
  if (type === 'casting_cost_modifier') return `casting_cost_modifier|applies:${normalizePatternText(action.appliesToText || '')}|cost:${action.optionalAdditionalCost?.kind || ''}:${action.optionalAdditionalCost?.amount || ''}|reduction:${formatManaSymbols(action.reduction?.symbols || [])}|limit:${action.reduction?.onlyReducesColor || ''}`;
  if (type === 'spell_cost_modifier') return `spell_cost_modifier|mode:${action.modifierMode || 'reduce'}|delta:${action.costDelta || ''}|applies:${(action.appliesTo || []).join('/') || normalizePatternText(action.appliesToText || '')}|chosen:${Boolean(action.chosenTypeRef)}`;
  if (type === 'set_life_total') return `set_life_total|${action.lifeTotal || ''}|condition:${Boolean(action.conditionText)}`;
  if (type === 'life_floor_replacement') return `life_floor_replacement|floor:${action.floor || ''}|source:${action.replacementSource || 'damage'}`;
  if (type === 'life_gain_replacement') return `life_gain_replacement|bonus:${action.bonusLife || 0}`;
  if (type === 'payment_restriction') return `payment_restriction|players:${action.affectedPlayers || ''}|payments:${(action.prohibitedPayments || []).join('/')}`;
  if (type === 'keyword_action') return `keyword_action|${action.keywordAction || normalizePatternText(action.label || '')}|count:${action.count || action.countExpression || ''}|x:${normalizePatternText(action.xDefinition || '')}`;
  if (type === 'casting_cost_mechanic') return `casting_cost_mechanic|${action.keywordAction || normalizePatternText(action.label || '')}`;
  if (type === 'untap') return `untap|${normalizePatternText(action.affectedObjects || '')}|filter:${normalizePatternText(action.targetRestrictionText || '')}`;
  if (type === 'put_from_hand_to_battlefield') return `put_from_hand_to_battlefield|filter:${normalizePatternText(action.cardFilterText || '')}`;
  if (type === 'mill_return_milled') return `mill_return_milled|mill:${action.millCount || ''}|return:${normalizePatternText(action.returnFilterText || '')}`;
  if (type === 'combat_declaration_tax') return `combat_declaration_tax|${action.declaration || ''}|cost:${action.taxCost || ''}|condition:${Boolean(action.conditionText)}`;
  if (type === 'choose_and_grant_trait') return `choose_and_grant_trait|choices:${(action.choices || []).join('/').toLowerCase()}|affected:${normalizePatternText(action.affectedObjects || '')}|duration:${action.duration || ''}`;
  if (type === 'spell_counter_restriction') return `spell_counter_restriction|${normalizePatternText(action.affectedObjects || '')}`;
  if (type === 'damage_prevention_restriction') return `damage_prevention_restriction|${normalizePatternText(action.affectedObjects || '')}`;
  if (type === 'blocking_restriction') return `blocking_restriction|${normalizePatternText(action.affectedObjects || '')}|by:${normalizePatternText(action.restrictedBlockers || '')}`;
  if (type === 'top_library_permanent_to_battlefield') return `top_library_permanent_to_battlefield|top:${action.topCount || ''}|filter:${normalizePatternText(action.cardFilterText || '')}|mv:${action.manaValueMax || ''}`;
  if (type === 'hideaway') return `hideaway|top:${action.topCount || ''}`;
  if (type === 'play_exiled_card') return `play_exiled_card|source:${action.sourceZone || 'exile'}|free:${Boolean(action.withoutPayingManaCost)}|condition:${Boolean(action.conditionText)}`;
  if (type === 'alternate_cast_permission') return `alternate_cast_permission|source:${action.sourceZoneRequirement || action.sourceZone || ''}|condition:${normalizePatternText(action.castCondition || action.conditionText || '')}|extra:${normalizePatternText(action.additionalCostText || '')}`;
  if (type === 'free_cast_from_hand') return `free_cast_from_hand|filter:${normalizePatternText(action.cardFilterText || '')}|mv:${action.manaValueMax || ''}`;
  if (type === 'fight') return `fight|${normalizePatternText(action.firstFighter || '')}|${normalizePatternText(action.secondFighter || '')}`;
  if (type === 'direct_damage') return `direct_damage|source:${normalizePatternText(action.damageSourceText || '')}|target:${normalizePatternText(action.damageTargetText || '')}|formula:${action.damageFormula || ''}|trample:${Boolean(action.trampleExcessToController)}`;
  if (type === 'kicked_entry_bonus') return `kicked_entry_bonus|counters:${action.counterAmount || ''}:${action.counterType || ''}|traits:${(action.grantedTraits || []).join('/').toLowerCase()}`;
  if (type === 'attack_restriction') return `attack_restriction|attackers:${normalizePatternText(action.restrictedAttackers || '')}|protected:${normalizePatternText(action.protectedObjects || '')}`;
  if (type === 'double_pt') return `double_pt|${normalizePatternText(action.affectedObjects || '')}|duration:${action.duration || ''}`;
  if (type === 'shuffle_source_into_library') return `shuffle_source_into_library|trigger:${trigger || normalizePatternText(action.triggerText || '')}`;
  if (type === 'regenerate') return `regenerate|${normalizePatternText(action.affectedObjects || '')}`;
  if (type === 'life_payment_draw') return `life_payment_draw|life:${normalizePatternText(action.lifeAmountExpression || '')}|draw:${normalizePatternText(action.drawCountExpression || '')}|trigger:${trigger}`;
  if (type === 'commander_partner') return 'commander_partner';
  if (type === 'repeat_reveal_to_hand_lose_life') return `repeat_reveal_to_hand_lose_life|loss:${normalizePatternText(action.lifeLossExpression || '')}`;
  if (type === 'flash_permission') return `flash_permission|affected:${normalizePatternText(action.affectedObjects || '')}|duration:${action.duration || ''}`;
  if (type === 'mill') return `mill|target:${normalizePatternText(action.affectedObjects || '')}|count:${action.count || action.countExpression || ''}`;
  if (type === 'return_to_hand_then_copy_option') return `return_to_hand_then_copy_option|target:${normalizePatternText(action.affectedObjects || '')}|copy:${Boolean(action.copyOption)}`;
  if (type === 'imprint') return `imprint|filter:${normalizePatternText(action.cardFilterText || '')}|source:${action.sourceZone || ''}`;
  if (type === 'self_damage') return `self_damage|amount:${action.amount || action.amountExpression || ''}|trigger:${trigger}`;
  if (type === 'sacrifice_source') return `sacrifice_source|object:${normalizePatternText(action.affectedObjects || '')}|trigger:${trigger}`;
  if (/^combat_mass_/.test(type)) return `${type}|role:${action.combatRole || ''}`;
  return `${type}|${normalizePatternText(action.label || action.effectText || action.sourceText || '')}`;
}

function actionPatternLabel(action = {}) {
  if (action.type === 'add_mana') return `Mana pattern: ${action.costText || 'no cost'} → ${action.producedManaLabel || formatManaSymbols(action.producedMana || [])}`;
  if (action.type === 'draw' && action.triggerText) return `Triggered draw pattern: ${action.triggerText}`;
  if (action.type === 'intrinsic_trait') return `Keyword pattern: ${action.trait}`;
  if (action.type === 'grant_trait') return `Grant pattern: ${action.label || action.trait}`;
  if (action.type === 'spell_cost_modifier') return `Spell cost modifier pattern: ${action.label || 'cost modifier'}`;
  if (action.type === 'search_library') return `Library search pattern: ${action.label || 'search library'}`;
  if (action.type === 'entry_modifier') return `Entry pattern: ${action.label || 'entry modifier'}`;
  if (action.keywordAction === 'backup') return `Backup pattern: ${action.label || 'backup counters'}`;
  if (action.keywordAction === 'eternalize') return `Eternalize pattern: ${action.label || 'eternalize token'}`;
  if (action.type === 'spell_counter_restriction') return `Counter restriction pattern: ${action.label}`;
  if (action.type === 'damage_prevention_restriction') return `Damage prevention restriction pattern: ${action.label}`;
  if (action.type === 'casting_cost_mechanic') return `Casting cost mechanic pattern: ${action.label || action.keywordAction}`;
  if (action.type === 'untap') return `Untap pattern: ${action.label || 'untap target'}`;
  if (action.type === 'put_from_hand_to_battlefield') return `Hand-to-battlefield pattern: ${action.label || 'put card from hand onto battlefield'}`;
  if (action.type === 'mill_return_milled') return `Mill-return pattern: ${action.label || 'mill then return milled card'}`;
  if (action.type === 'blocking_restriction') return `Blocking restriction pattern: ${action.label}`;
  if (action.type === 'top_library_permanent_to_battlefield') return `Top-library battlefield pattern: ${action.label}`;
  if (action.type === 'hideaway') return `Hideaway pattern: ${action.label}`;
  if (action.type === 'play_exiled_card') return `Exile-play permission pattern: ${action.label}`;
  if (action.type === 'alternate_cast_permission') return `Alternate cast permission pattern: ${action.label}`;
  if (action.type === 'free_cast_from_hand') return `Free-cast-from-hand pattern: ${action.label}`;
  if (action.type === 'fight') return `Fight pattern: ${action.label}`;
  if (action.type === 'direct_damage') return `Direct damage pattern: ${action.label}`;
  if (action.keywordAction === 'kicker') return `Kicker pattern: ${action.label}`;
  if (action.type === 'kicked_entry_bonus') return `Kicked-entry bonus pattern: ${action.label}`;
  if (action.type === 'attack_restriction') return `Attack restriction pattern: ${action.label}`;
  if (action.type === 'double_pt') return `Double P/T pattern: ${action.label}`;
  if (action.type === 'shuffle_source_into_library') return `Shuffle-source pattern: ${action.label}`;
  if (action.type === 'regenerate') return `Regenerate pattern: ${action.label}`;
  if (action.type === 'life_payment_draw') return `Life-payment draw pattern: ${action.label}`;
  if (action.type === 'commander_partner') return `Commander partner pattern: ${action.label}`;
  if (action.type === 'repeat_reveal_to_hand_lose_life') return `Repeat reveal/hand/life-loss pattern: ${action.label}`;
  if (action.type === 'flash_permission') return `Flash permission pattern: ${action.label}`;
  if (action.type === 'mill') return `Mill pattern: ${action.label}`;
  if (action.keywordAction === 'storm') return `Storm pattern: ${action.label}`;
  if (action.keywordAction === 'bargain') return `Bargain pattern: ${action.label}`;
  if (action.type === 'return_to_hand_then_copy_option') return `Bounce/copy option pattern: ${action.label}`;
  if (action.type === 'imprint') return `Imprint pattern: ${action.label}`;
  if (action.type === 'self_damage') return `Self-damage pattern: ${action.label}`;
  if (action.type === 'sacrifice_source') return `Sacrifice-source pattern: ${action.label}`;
  return action.label || action.type || 'Parsed action pattern';
}

function collectActionPatterns(actions = []) {
  return uniqueBy((actions || []).filter((action) => action?.type).map((action) => ({
    key: actionPatternKey(action),
    label: actionPatternLabel(action),
    type: action.type
  })), (item) => item.key);
}

function patternTrustProfile(actions = [], brain = {}) {
  const patterns = collectActionPatterns(actions);
  const store = brain.patterns || {};
  const known = patterns.map((pattern) => ({ ...pattern, approvedCount: Number(store[pattern.key]?.approvedCount || 0), rejectedCount: Number(store[pattern.key]?.rejectedCount || 0) }));
  const trusted = known.filter((pattern) => pattern.approvedCount > 0 && pattern.rejectedCount === 0);
  const contested = known.filter((pattern) => pattern.rejectedCount > 0);
  const allTrusted = known.length > 0 && trusted.length === known.length;
  const confidenceBoost = allTrusted ? Math.min(0.08, 0.03 + trusted.reduce((sum, pattern) => sum + Math.min(3, pattern.approvedCount), 0) * 0.01) : (trusted.length ? 0.02 : 0);
  return {
    patterns: known,
    trustedCount: trusted.length,
    contestedCount: contested.length,
    confidenceBoost,
    reasons: trusted.length ? [`${trusted.length}/${known.length} parsed action pattern(s) previously approved`] : []
  };
}

function parseModalChoiceRule(headerText = '') {
  const text = String(headerText || '').replace(/\s+/g, ' ').trim();
  if (!/choose/i.test(text)) return null;
  const chooseMatch = text.match(/choose\s+(one|two|three|one or both|both|any number)/i);
  if (!chooseMatch) return null;
  const choiceText = chooseMatch[1].toLowerCase();
  const defaultChoices = choiceText === 'two'
    ? 2
    : (choiceText === 'three'
      ? 3
      : (choiceText === 'both' || choiceText === 'one or both'
        ? 2
        : (choiceText === 'any number' ? 'any' : 1)));
  const upgraded = text.match(/if\s+(.+?),?\s+you may choose both instead/i);
  return {
    type: 'modal_choice_rule',
    defaultChoices,
    upgradedChoices: upgraded ? 2 : null,
    upgradeCondition: upgraded?.[1]?.trim() || '',
    label: upgraded
      ? `Modal choice: choose ${defaultChoices}; choose both if ${upgraded[1].trim()}`
      : `Modal choice: choose ${choiceText}`
  };
}

function isSimpleFixedManaAbility(actions = [], costText = '', effectText = '') {
  if (actions.length !== 1 || actions[0]?.type !== 'add_mana') return false;
  const action = actions[0];
  const produced = action.producedMana || [];
  const hasSimpleCost = /\{t\}|tap/i.test(costText || action.costText || '');
  const fixedOne = produced.length === 1 && !action.amountFormula && !action.manaRestriction && !/for each|equal to|x\b/i.test(effectText);
  return hasSimpleCost && fixedOne;
}

function isFixedTapManaAbility(actions = [], costText = '', effectText = '') {
  if (actions.length !== 1 || actions[0]?.type !== 'add_mana') return false;
  const action = actions[0];
  const produced = normalizeManaSymbolsInput(action.producedMana || action.mana || []);
  const hasSimpleCost = /\{t\}|tap/i.test(costText || action.costText || '');
  const hasDynamicAmount = Boolean(action.amountFormula || action.amountLabel || /for each|equal to|x\b|devotion|number of/i.test(effectText));
  const hasRestriction = Boolean(action.manaRestriction || action.restrictedMana);
  return hasSimpleCost && produced.length > 0 && !hasDynamicAmount && !hasRestriction;
}

function allActionsAre(actions = [], types = []) {
  const allowed = new Set(types);
  return actions.length > 0 && actions.every((action) => allowed.has(action.type));
}

function scoreParsedAbilityConfidence({ originalText = '', costText = '', triggerText = '', conditionText = '', effectText = '', actions = [], rawAbility = {} } = {}) {
  if (!actions.length) return { score: 0.18, reasons: ['No recognized action template yet'] };
  const text = visibleRulesText(originalText || effectText);
  const actionTypes = actions.map((action) => action.type);
  const reasons = [];
  let score = 0.62 + Math.min(0.14, actions.length * 0.04);

  if (isSimpleFixedManaAbility(actions, costText, effectText)) {
    score = 0.96;
    reasons.push('Exact simple tap-for-one-mana pattern');
  } else if (isFixedTapManaAbility(actions, costText, effectText)) {
    score = 0.96;
    reasons.push('Exact tap-for-fixed-mana pattern');
  } else if (actions.length === 1 && actions[0].type === 'entry_replacement_pay_life_or_tapped') {
    score = 0.96;
    reasons.push('Exact pay-life-or-enters-tapped land pattern');
  } else if (actions.length === 1 && actions[0].type === 'counter_spell') {
    score = 0.96;
    reasons.push('Exact counterspell pattern');
  } else if (actions.length === 1 && actions[0].type === 'alternate_cast_cost') {
    score = conditionText ? 0.95 : 0.96;
    reasons.push(conditionText ? 'Explicit conditional alternate-cost pattern' : 'Exact alternate-cost pattern');
  } else if (actions.length === 1 && actions[0].type === 'return_to_hand') {
    score = 0.94;
    reasons.push('Exact return-to-hand pattern');
  } else if (actions.length === 1 && actions[0].type === 'exile') {
    score = 0.93;
    reasons.push('Exact exile target pattern');
  } else if (allActionsAre(actions, ['exile', 'gain_life']) && /gains? life equal to/i.test(text)) {
    score = 0.94;
    reasons.push('Exile plus dynamic controller life-gain pattern recognized');
  } else if (allActionsAre(actions, ['exile', 'search_library']) && /^exile target/i.test(text) && /search (?:their|your|its controller|that player|target player)'?s? library/i.test(text)) {
    score = 0.94;
    reasons.push('Exile plus compensating library-search pattern recognized');
  } else if (allActionsAre(actions, ['direct_damage']) && /excess damage is dealt/i.test(text)) {
    score = 0.94;
    reasons.push('Direct damage with trample excess pattern recognized');
  } else if (actions.some((action) => action.type === 'enter_as_copy') && /additional .*counter|isn't legendary|not legendary/i.test(text)) {
    score = 0.94;
    reasons.push('Enter-as-copy with exception/counter clauses recognized');
  } else if (allActionsAre(actions, ['flash_permission', 'cast_timing_permission']) && /as though (?:they|it) had flash/i.test(text)) {
    score = 0.95;
    reasons.push('Flash casting permission pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'attach_permanent') {
    score = triggerText ? 0.94 : 0.93;
    reasons.push('Aura/Equipment attachment pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'taxed_trigger_token') {
    score = 0.94;
    reasons.push('Taxed trigger into Treasure token pattern recognized');
  } else if (allActionsAre(actions, ['destroy'])) {
    score = 0.94;
    reasons.push('Exact destroy target pattern');
  } else if (allActionsAre(actions, ['destroy', 'create_token'])) {
    score = 0.94;
    reasons.push('Destroy plus compensation token pattern recognized');
  } else if (allActionsAre(actions, ['destroy', 'gain_life']) && /gains? life equal to/i.test(text)) {
    score = 0.94;
    reasons.push('Destroy plus dynamic life-gain pattern recognized');
  } else if (allActionsAre(actions, ['add_mana', 'direct_damage']) && /add .+damage to you/i.test(text)) {
    score = 0.94;
    reasons.push('Mana ability with self-damage rider recognized');
  } else if (actions.length === 1 && actions[0].type === 'add_mana' && (actions[0].amountFormula?.startsWith?.('devotion:') || /devotion to/i.test(effectText))) {
    score = 0.94;
    reasons.push('Devotion mana formula recognized');
  } else if (allActionsAre(actions, ['return_from_graveyard_to_battlefield', 'move_to_battlefield', 'return_to_battlefield'])) {
    score = 0.94;
    reasons.push('Graveyard-to-battlefield recursion pattern recognized');
  } else if (allActionsAre(actions, ['put_from_hand_to_battlefield', 'return_from_graveyard_to_battlefield'])) {
    score = 0.93;
    reasons.push('Creature card to battlefield permission pattern recognized');
  } else if (allActionsAre(actions, ['sacrifice_permanents', 'sacrifice'])) {
    score = 0.94;
    reasons.push('Sacrifice permanent pattern recognized');
  } else if (allActionsAre(actions, ['casting_cost_mechanic', 'keyword_action'])) {
    score = 0.94;
    reasons.push('Keyword mechanic with reminder action recognized');
  } else if (actions.length === 1 && actions[0].type === 'life_loss_replacement') {
    score = 0.94;
    reasons.push('Life-loss replacement pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'enter_as_copy') {
    score = 0.94;
    reasons.push('Enter-as-copy pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'mill_return_milled') {
    score = 0.92;
    reasons.push('Mill-then-return-milled-card pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'shuffle_exile_top_play_free') {
    score = 0.94;
    reasons.push('Shuffle/exile-top/free-play pattern recognized');
  } else if (allActionsAre(actions, ['search_library'])) {
    score = 0.94;
    reasons.push('Library search and placement pattern recognized');
  } else if (allActionsAre(actions, ['equip', 'attach_permanent'])) {
    score = 0.94;
    reasons.push('Equipment attach/equip pattern recognized');
  } else if (allActionsAre(actions, ['trigger_doubling', 'copy_triggered_ability'])) {
    score = 0.94;
    reasons.push('Triggered ability additional-time pattern recognized');
  } else if (allActionsAre(actions, ['add_counters'])) {
    score = triggerText ? 0.94 : 0.93;
    reasons.push('Add counters pattern recognized');
  } else if (allActionsAre(actions, ['flashback', 'casting_cost_mechanic'])) {
    score = 0.94;
    reasons.push('Flashback mechanic pattern recognized');
  } else if (allActionsAre(actions, ['casting_cost_modifier', 'spell_cost_modifier'])) {
    score = 0.94;
    reasons.push('Optional payment cost-reduction pattern recognized');
  } else if (allActionsAre(actions, ['grant_trait', 'modify_pt', 'type_addition_static']) || allActionsAre(actions, ['modify_pt', 'type_addition_static'])) {
    score = 0.94;
    reasons.push('P/T plus static type/keyword modifier pattern recognized');
  } else if (allActionsAre(actions, ['self_damage', 'direct_damage'])) {
    score = 0.94;
    reasons.push('Triggered self-damage pattern recognized');
  } else if (allActionsAre(actions, ['counter_spell', 'add_mana'])) {
    score = 0.94;
    reasons.push('Counterspell plus delayed mana pattern recognized');
  } else if (allActionsAre(actions, ['discard', 'untap'])) {
    score = 0.94;
    reasons.push('Discard plus untap combat-damage trigger recognized');
  } else if (allActionsAre(actions, ['create_token'])) {
    score = triggerText ? (conditionText ? 0.94 : 0.94) : 0.94;
    reasons.push(triggerText ? 'Triggered token creation recognized' : 'Token creation recognized');
  } else if (actions.length === 1 && ['move_to_battlefield', 'return_to_battlefield', 'return_from_graveyard_to_battlefield', 'put_from_hand_to_battlefield'].includes(actions[0].type)) {
    score = 0.93;
    reasons.push('Move object to battlefield pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'aura_enchant') {
    score = 0.93;
    reasons.push('Aura enchant restriction recognized');
  } else if (actions.length === 1 && actions[0].type === 'prevent_damage') {
    score = 0.94;
    reasons.push('Damage prevention pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'additional_cast_cost') {
    score = 0.93;
    reasons.push('Additional casting cost pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'gain_life') {
    score = actions[0].amountFormula ? 0.94 : 0.92;
    reasons.push(actions[0].amountFormula ? 'Dynamic life-gain formula recognized' : 'Life gain effect recognized');
  } else if (actions.length === 1 && actions[0].type === 'lose_life') {
    score = actions[0].amountFormula ? 0.94 : 0.92;
    reasons.push(actions[0].amountFormula ? 'Dynamic life-loss formula recognized' : 'Life loss effect recognized');
  } else if (actions.length === 1 && actions[0].type === 'grant_protection') {
    score = 0.94;
    reasons.push('Protection grant pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'phase_out') {
    score = 0.94;
    reasons.push('Phase-out protection pattern recognized');
  } else if (allActionsAre(actions, ['grant_protection', 'phase_out']) || allActionsAre(actions, ['phase_out', 'grant_protection'])) {
    score = 0.95;
    reasons.push('Protection plus phase-out shield pattern recognized');
  } else if (allActionsAre(actions, ['exile_source', 'exile']) || allActionsAre(actions, ['exile'])) {
    score = 0.94;
    reasons.push('Exile source/card pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'remove_traits') {
    score = 0.94;
    reasons.push('Remove keyword abilities pattern recognized');
  } else if (actions.length === 1 && ['equip', 'attach_permanent'].includes(actions[0].type)) {
    score = 0.94;
    reasons.push('Equipment attach/equip pattern recognized');
  } else if (actions.length === 1 && ['trigger_doubling', 'copy_triggered_ability'].includes(actions[0].type)) {
    score = 0.94;
    reasons.push('Triggered ability additional-time pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'grant_activated_ability') {
    score = 0.93;
    reasons.push('Grant activated ability pattern recognized');
  } else if (actions.length === 1 && ['sacrifice', 'sacrifice_permanents'].includes(actions[0].type)) {
    score = 0.94;
    reasons.push('Sacrifice permanent pattern recognized');
  } else if (actions.length === 1 && ['spell_casting_restriction', 'cast_noncreature_spells_restriction'].includes(actions[0].type)) {
    score = 0.93;
    reasons.push('Spell-casting restriction pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'type_addition_static') {
    score = 0.93;
    reasons.push('Static type-addition pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'legend_rule_exception') {
    score = 0.94;
    reasons.push('Legend-rule exception pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'flashback') {
    score = 0.94;
    reasons.push('Flashback mechanic pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'choose_creature_type') {
    score = 0.93;
    reasons.push('Choose creature type pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'free_cast_from_hand') {
    score = 0.92;
    reasons.push('Free cast from hand pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'top_library_permanent_to_battlefield') {
    score = 0.92;
    reasons.push('Top-library permanent-to-battlefield trigger recognized');
  } else if (actions.length === 1 && actions[0].type === 'search_library') {
    score = 0.94;
    reasons.push('Library search and placement pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'add_counters') {
    score = triggerText ? 0.94 : 0.92;
    reasons.push('Add counters pattern recognized');
  } else if (actions.length === 1 && ['equipment_static_pt', 'modify_pt'].includes(actions[0].type) && /for each|where x|equal to|base power and toughness|shares a creature type/i.test(text)) {
    score = 0.92;
    reasons.push('Dynamic P/T modifier pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'set_base_pt') {
    score = 0.94;
    reasons.push('Base power/toughness setter recognized');
  } else if (actionTypes.includes('grant_trait') && actionTypes.includes('set_base_pt')) {
    score = 0.95;
    reasons.push('Base P/T setter plus keyword grant pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'triggered_damage_echo') {
    score = 0.93;
    reasons.push('Triggered combat-damage spillover pattern recognized');
  } else if (actionTypes.includes('grant_trait') && actionTypes.includes('modify_pt')) {
    score = 0.94;
    reasons.push('Keyword grant plus P/T modifier pattern recognized');
  } else if (allActionsAre(actions, ['counter_spell', 'spell_casting_restriction']) || allActionsAre(actions, ['counter_spell', 'cast_noncreature_spells_restriction'])) {
    score = 0.95;
    reasons.push('Counterspell plus temporary casting restriction pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'add_mana' && (actions[0].colorMode === 'commanderColorIdentity' || /commander(?:'s)? color identity/i.test(effectText))) {
    score = 0.94;
    reasons.push('Known commander-color mana pattern');
  } else if (actions.length === 1 && actions[0].type === 'add_mana' && actions[0].amountFormula?.startsWith?.('count:')) {
    score = 0.88;
    reasons.push('Recognized dynamic mana count formula');
  } else if (actions.length && actions.every((action) => action.type === 'intrinsic_trait')) {
    score = 0.96;
    reasons.push(actions.length > 1 ? 'Exact keyword ability list' : 'Exact keyword ability pattern');
  } else if (actions.length === 1 && actions[0].type === 'entry_modifier') {
    score = actions[0].unlessClause ? 0.90 : 0.94;
    reasons.push(actions[0].unlessClause ? 'Recognized conditional ETB tapped pattern' : 'Exact ETB tapped pattern');
  } else if (actions.length === 1 && actions[0].type === 'cycling') {
    score = 0.96;
    reasons.push('Exact cycling pattern');
  } else if (actions.length === 1 && actions[0].keywordAction === 'backup') {
    score = 0.91;
    reasons.push('Backup ETB counter pattern recognized');
  } else if (actions.length === 1 && actions[0].keywordAction === 'eternalize') {
    score = 0.90;
    reasons.push('Eternalize graveyard token pattern recognized');
  } else if (triggerText && actions.length === 1 && actions[0].type === 'draw') {
    score = conditionText ? 0.90 : 0.93;
    reasons.push(conditionText ? 'Triggered draw with explicit condition' : 'Straight triggered draw pattern');
  } else if (actions.length === 1 && actions[0].type === 'create_token') {
    score = triggerText ? (conditionText ? 0.90 : 0.92) : 0.88;
    reasons.push(triggerText ? (conditionText ? 'Triggered token creation with explicit condition' : 'Triggered token creation recognized') : 'Token creation recognized');
  } else if (actions.length === 1 && actions[0].type === 'draw') {
    score = 0.88;
    reasons.push('Recognized draw effect');
  } else if (actions.length === 1 && actions[0].type === 'search_library') {
    score = actions[0].instructionLabel || actions[0].distribution?.length ? 0.89 : 0.84;
    reasons.push(actions[0].instructionLabel || actions[0].distribution?.length ? 'Library search and placement recognized' : 'Library search recognized');
  } else if (actions.length === 1 && actions[0].type === 'entry_counter_modifier') {
    score = 0.90;
    reasons.push('Entry counter modifier recognized');
  } else if (actions.length === 1 && ['temporary_exile_return', 'linked_exile_until_source_leaves'].includes(actions[0].type)) {
    score = 0.91;
    reasons.push(actions[0].type === 'temporary_exile_return' ? 'Temporary exile/blink pattern recognized' : 'Linked exile-until-source-leaves pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'casting_cost_modifier') {
    score = 0.86;
    reasons.push('Optional cost-to-reduce casting cost pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'spell_cost_modifier') {
    score = actions[0].chosenTypeRef ? 0.91 : 0.92;
    reasons.push(actions[0].chosenTypeRef ? 'Chosen-type spell cost reduction recognized' : 'Static spell cost reduction recognized');
  } else if (actions.length === 1 && actions[0].type === 'set_life_total') {
    score = conditionText ? 0.90 : 0.88;
    reasons.push('Life-total set effect recognized');
  } else if (actions.length === 1 && actions[0].type === 'life_floor_replacement') {
    score = 0.86;
    reasons.push('Damage replacement/life floor pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'life_gain_replacement') {
    score = 0.92;
    reasons.push('Life-gain replacement pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'payment_restriction') {
    score = 0.91;
    reasons.push('Static payment restriction recognized');
  } else if (actions.length === 1 && actions[0].type === 'keyword_action') {
    score = actions[0].keywordAction === 'investigate' ? 0.94 : (actions[0].keywordAction === 'discover' ? 0.91 : 0.88);
    reasons.push(actions[0].keywordAction === 'investigate' ? 'Investigate keyword action recognized' : (actions[0].keywordAction === 'discover' ? 'Discover keyword action recognized' : 'Keyword action recognized'));
  } else if (actions.length === 1 && actions[0].type === 'casting_cost_mechanic') {
    score = 0.91;
    reasons.push('Casting cost keyword mechanic recognized');
  } else if (actions.length === 1 && actions[0].type === 'untap') {
    score = 0.89;
    reasons.push('Untap target pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'put_from_hand_to_battlefield') {
    score = 0.88;
    reasons.push('Put-from-hand-onto-battlefield pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'mill_return_milled') {
    score = 0.87;
    reasons.push('Mill-then-return-milled-card pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'combat_declaration_tax') {
    score = 0.91;
    reasons.push('Combat declaration tax recognized');
  } else if (actions.length === 1 && actions[0].type === 'spell_counter_restriction') {
    score = 0.91;
    reasons.push('Cannot-be-countered static pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'damage_prevention_restriction') {
    score = 0.90;
    reasons.push('Damage prevention restriction recognized');
  } else if (actions.length === 1 && actions[0].type === 'blocking_restriction') {
    score = 0.91;
    reasons.push('Blocking restriction / evasion pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'top_library_permanent_to_battlefield') {
    score = 0.86;
    reasons.push('Top-library permanent-to-battlefield trigger recognized');
  } else if (actions.length === 1 && actions[0].type === 'hideaway') {
    score = 0.89;
    reasons.push('Hideaway look/exile/bottom pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'play_exiled_card') {
    score = conditionText ? 0.87 : 0.84;
    reasons.push('Play exiled-card permission recognized');
  } else if (actions.length === 1 && actions[0].type === 'alternate_cast_permission') {
    score = actions[0].additionalCostText ? 0.84 : 0.86;
    reasons.push('Alternate-zone cast permission recognized');
  } else if (actions.length === 1 && actions[0].type === 'free_cast_from_hand') {
    score = 0.88;
    reasons.push('Free cast from hand pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'fight') {
    score = 0.91;
    reasons.push('Fight effect recognized');
  } else if (actions.length === 1 && actions[0].type === 'direct_damage') {
    score = actions[0].trampleExcessToController ? 0.89 : 0.90;
    reasons.push(actions[0].trampleExcessToController ? 'Direct damage with trample excess recognized' : 'Direct damage equal-to-power effect recognized');
  } else if (actions.length === 1 && actions[0].keywordAction === 'kicker') {
    score = 0.91;
    reasons.push('Kicker additional-cost pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'kicked_entry_bonus') {
    score = 0.88;
    reasons.push('Kicked ETB counter/keyword bonus recognized');
  } else if (actions.length === 1 && actions[0].type === 'attack_restriction') {
    score = 0.91;
    reasons.push('Static attack restriction recognized');
  } else if (actions.length === 1 && actions[0].type === 'double_pt') {
    score = triggerText ? 0.89 : 0.86;
    reasons.push('Double power/toughness temporary modifier recognized');
  } else if (actions.length === 1 && actions[0].type === 'shuffle_source_into_library') {
    score = triggerText ? 0.91 : 0.88;
    reasons.push('Shuffle source into library trigger recognized');
  } else if (actions.length === 1 && actions[0].type === 'regenerate') {
    score = 0.90;
    reasons.push('Regeneration shield pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'life_payment_draw') {
    score = 0.84;
    reasons.push('Postcombat life-payment draw pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'commander_partner') {
    score = 0.94;
    reasons.push('Commander partner mechanic recognized');
  } else if (actions.length === 1 && actions[0].type === 'repeat_reveal_to_hand_lose_life') {
    score = 0.82;
    reasons.push('Repeat reveal-to-hand with life-loss pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'flash_permission') {
    score = 0.88;
    reasons.push('Temporary flash casting permission recognized');
  } else if (actions.length === 1 && actions[0].type === 'mill') {
    score = 0.91;
    reasons.push('Mill effect recognized');
  } else if (actions.length === 1 && actions[0].type === 'return_to_hand_then_copy_option') {
    score = 0.84;
    reasons.push('Bounce with sacrifice/copy option recognized');
  } else if (actions.length === 1 && actions[0].type === 'imprint') {
    score = 0.87;
    reasons.push('Imprint exile-from-hand pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'self_damage') {
    score = triggerText ? 0.90 : 0.86;
    reasons.push('Self-damage trigger recognized');
  } else if (actions.length === 1 && actions[0].type === 'sacrifice_source') {
    score = triggerText ? 0.90 : 0.86;
    reasons.push('Sacrifice-source trigger recognized');
  } else if (actions.length === 1 && actions[0].type === 'top_library_select_to_hand') {
    score = 0.86;
    reasons.push('Top-library selection-to-hand pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'top_library_free_cast') {
    score = 0.85;
    reasons.push('Top-library free-cast pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'set_pt_dynamic') {
    score = 0.88;
    reasons.push('Dynamic power/toughness static pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'pay_to_draw') {
    score = triggerText ? 0.88 : 0.84;
    reasons.push('Pay-to-draw trigger pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'become_copy_until_eot') {
    score = 0.86;
    reasons.push('Temporary copy effect recognized');
  } else if (actions.length === 1 && actions[0].type === 'top_library_look_permission') {
    score = 0.90;
    reasons.push('Top-library look permission recognized');
  } else if (actions.length === 1 && actions[0].type === 'top_library_cast_permission') {
    score = 0.88;
    reasons.push('Top-library cast permission recognized');
  } else if (actions.length === 1 && actions[0].type === 'exile_top_card') {
    score = 0.88;
    reasons.push('Exile top card pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'reanimate_from_graveyard') {
    score = triggerText ? 0.89 : 0.86;
    reasons.push('Reanimate from graveyard pattern recognized');
  } else if (actions.length === 1 && actions[0].type === 'chosen_type_addition') {
    score = 0.90;
    reasons.push('Chosen-type addition pattern recognized');
  } else if (actions.length === 1 && /^combat_mass_/.test(actions[0].type)) {
    score = triggerText ? 0.90 : 0.87;
    reasons.push('Combat creature board action recognized');
  } else if (actions.length === 1 && actions[0].type === 'choose_and_grant_trait') {
    score = triggerText ? 0.91 : 0.88;
    reasons.push('Choice-based keyword grant recognized');
  } else if (actions.length && actions.every((action) => action.type === 'grant_trait')) {
    score = /until end of turn/i.test(text) ? 0.90 : 0.94;
    reasons.push(actions.length > 1 ? 'Keyword grant list recognized' : 'Keyword grant pattern recognized');
  } else if (actionTypes.includes('grant_trait') && actionTypes.includes('modify_pt')) {
    score = 0.86;
    reasons.push('Team keyword grant plus P/T modifier recognized');
  } else if (actions.some((action) => ['return_from_graveyard_to_hand', 'return_from_graveyard_to_battlefield', 'move_to_library', 'move_card', 'move_to_graveyard', 'discard', 'lose_life', 'life_gain_restriction', 'damage_replacement_multiplier', 'prevent_damage', 'copy_spell', 'copy_ability', 'gain_control', 'type_change', 'type_addition_static', 'remove_counters', 'activation_cost_modifier', 'zone_play_permission', 'additional_land_play', 'maximum_hand_size_modifier', 'win_game', 'lose_game', 'casting_cost_mechanic'].includes(action.type) || /_restriction$/.test(action.type))) {
    score = triggerText ? 0.84 : 0.80;
    reasons.push('Proactive grammar-template pattern recognized');
  } else if (actions.every((action) => ['intrinsic_trait', 'grant_trait', 'modify_pt', 'equipment_static_pt', 'entry_modifier', 'spell_counter_restriction', 'damage_prevention_restriction', 'blocking_restriction', 'casting_cost_mechanic', 'spell_cost_modifier', 'hideaway', 'play_exiled_card', 'alternate_cast_permission', 'free_cast_from_hand', 'kicked_entry_bonus', 'attack_restriction', 'double_pt', 'shuffle_source_into_library', 'regenerate'].includes(action.type))) {
    score = 0.84;
    reasons.push('Static/combat modifier pattern recognized');
  } else {
    reasons.push(`${actions.length} recognized action template(s)`);
  }

  if (triggerText && !reasons.some((reason) => /trigger/i.test(reason))) {
    score += 0.04;
    reasons.push('Trigger timing separated');
  }
  if (costText && !isSimpleFixedManaAbility(actions, costText, effectText)) {
    score += 0.03;
    reasons.push('Cost separated from effect');
  }
  const conditionTrustedTypes = new Set(['alternate_cast_cost', 'entry_replacement_pay_life_or_tapped', 'spell_cost_modifier', 'casting_cost_modifier', 'kicked_entry_bonus', 'life_gain_replacement', 'damage_replacement_multiplier', 'taxed_trigger_token', 'direct_damage', 'enter_as_copy', 'attach_permanent', 'trigger_doubling', 'copy_triggered_ability', 'grant_activated_ability', 'return_from_graveyard_to_battlefield', 'move_to_battlefield', 'return_to_battlefield', 'search_library', 'life_loss_replacement', 'shuffle_exile_top_play_free']);
  if (conditionText && !/conditional|condition/i.test(reasons.join(' ')) && !actions.every((action) => conditionTrustedTypes.has(action.type)) && !actions.some((action) => action.type === 'enter_as_copy')) {
    score -= 0.03;
    reasons.push('Has a condition; requires board-state check');
  }
  const optionalTrustedTypes = new Set(['cycling', 'casting_cost_modifier', 'alternate_cast_cost', 'alternate_cast_permission', 'entry_replacement_pay_life_or_tapped', 'return_to_hand', 'exile', 'counter_spell', 'search_library', 'taxed_trigger_token', 'enter_as_copy', 'attach_permanent', 'flash_permission', 'cast_timing_permission', 'put_from_hand_to_battlefield', 'move_to_battlefield', 'return_from_graveyard_to_battlefield', 'return_to_battlefield', 'draw', 'casting_cost_mechanic', 'flashback', 'free_cast_from_hand', 'keyword_action', 'shuffle_exile_top_play_free']);
  if (/\bmay\b|up to/i.test(text) && !actions.every((action) => optionalTrustedTypes.has(action.type)) && !actions.some((action) => action.type === 'enter_as_copy')) {
    score -= 0.02;
    reasons.push('Optional choice detected');
  }
  if (/\bX\b|for each|equal to|number of/i.test(text) && !actions.some((action) => action.amountFormula || action.xDefinition || action.countExpression || action.multiplier || action.searchCriteria || action.taxPer || action.topCountFormula || action.castCondition || action.withoutPayingManaCost || ['combat_declaration_tax', 'modify_pt', 'equipment_static_pt', 'set_pt_dynamic', 'add_mana', 'gain_life', 'lose_life', 'fight', 'draw', 'add_counters', 'create_token', 'top_library_permanent_to_battlefield', 'mill_return_milled', 'shuffle_exile_top_play_free', 'life_loss_replacement'].includes(action.type))) {
    score -= 0.07;
    reasons.push('Dynamic amount text not fully explained');
  }
  if (/\binstead\b|\bwould\b/i.test(text) && !actions.some((action) => /replacement/.test(action.type) || action.trampleExcessToController || action.type === 'prevent_damage')) {
    score -= 0.10;
    reasons.push('Replacement-effect wording needs a specific action bucket');
  }
  if (rawAbility.isMode) {
    const modalRule = parseModalChoiceRule(rawAbility.modeHeader || '');
    if (modalRule) {
      score += 0.03;
      reasons.push('Modal choice rule recognized');
    } else {
      score -= 0.01;
      reasons.push('Modal option');
    }
  }

  return {
    score: Math.max(0.18, Math.min(0.98, score)),
    reasons: [...new Set(reasons)]
  };
}

export function getAiResponseProfile(card = {}, brain = loadAiBrain()) {
  const { entry: learned } = lookupLearnedCard(brain, card);
  if (typeof learned?.responseWorthy === 'boolean') {
    return {
      responseWorthy: learned.responseWorthy,
      reasons: learned.responseReasons || (learned.responseWorthy ? ['Manually marked response-worthy'] : []),
      label: learned.responseWorthy ? 'Response-worthy from AI memory' : 'Marked as not response-worthy in AI memory',
      learned: true
    };
  }
  const abilities = splitOracleIntoAbilities(card?.oracleText).map(parseAbility);
  const actions = abilities.flatMap((ability) => ability.actions);
  return detectResponseProfile(card, actions);
}

function devotionToColor(boardCards = [], seat, color = 'G') {
  const target = String(color || 'G').toUpperCase();
  return (boardCards || [])
    .filter((card) => card.ownerSeat === seat && BATTLEFIELD_ZONES.includes(card.zone))
    .reduce((sum, boardCard) => {
      const matches = String(boardCard?.card?.manaCost || '').match(/\{[^}]+\}/g) || [];
      return sum + matches.filter((symbol) => symbol.replace(/[{}]/g, '').toUpperCase() === target).length;
    }, 0);
}

function evaluateConditionText(conditionText = '', context = {}) {
  const condition = String(conditionText || '').trim();
  if (!condition) return null;
  const lower = condition.toLowerCase();
  const ownLife = Number(context.lifeTotals?.[context.seat] ?? context.life ?? context.playerLife ?? NaN);
  const lifeLessThan = lower.match(/(?:your )?life total is less than (\d+)/);
  if (lifeLessThan) {
    const needed = Number(lifeLessThan[1]);
    if (Number.isFinite(ownLife)) {
      return ownLife < needed
        ? { met: true, reason: `Met — P${context.seat} life is ${ownLife}, below ${needed}.` }
        : { met: false, reason: `Not met — P${context.seat} life is ${ownLife}, not below ${needed}.` };
    }
    return { met: 'unknown', reason: `Needs life check — life total must be less than ${needed}.` };
  }
  const lifeAtLeast = lower.match(/(?:your )?life total is (\d+) or greater|you have (\d+) or more life/);
  if (lifeAtLeast) {
    const needed = Number(lifeAtLeast[1] || lifeAtLeast[2]);
    if (Number.isFinite(ownLife)) {
      return ownLife >= needed
        ? { met: true, reason: `Met — P${context.seat} life is ${ownLife}, at least ${needed}.` }
        : { met: false, reason: `Not met — P${context.seat} life is ${ownLife}/${needed}.` };
    }
    return { met: 'unknown', reason: `Needs life check — life total must be ${needed} or greater.` };
  }
  const ownCreatures = (context.boardCards || []).filter((card) => card.ownerSeat === context.seat && /\bCreature\b/i.test(card?.card?.typeLine || '') && BATTLEFIELD_ZONES.includes(card.zone));
  const powerOf = (card) => {
    const baseSetters = (card?.mods || []).filter((mod) => mod.kind === 'base_pt');
    const latestBase = baseSetters.length ? baseSetters[baseSetters.length - 1] : null;
    const base = latestBase ? Number(latestBase.basePower) : Number(String(card?.card?.power || '').replace(/[^0-9.-]/g, ''));
    const modPower = (card?.mods || []).filter((mod) => mod.kind === 'pt' || mod.kind === 'counter').reduce((sum, mod) => sum + Number(mod.powerDelta || 0), 0);
    return Number.isFinite(base) ? base + modPower : modPower;
  };
  const powerAtLeast = lower.match(/creature(?:s)? with power (\d+) or greater/);
  if (powerAtLeast) {
    const needed = Number(powerAtLeast[1]);
    const found = ownCreatures.find((card) => powerOf(card) >= needed);
    return found
      ? { met: true, reason: `Met — P${context.seat} controls ${found.card?.name || 'a creature'}, power ${powerOf(found)}.` }
      : { met: false, reason: `Not met — P${context.seat} controls no creature with power ${needed} or greater.` };
  }
  const totalPower = lower.match(/creatures you control have total power (\d+) or greater/);
  if (totalPower) {
    const needed = Number(totalPower[1]);
    const total = ownCreatures.reduce((sum, card) => sum + powerOf(card), 0);
    return total >= needed
      ? { met: true, reason: `Met — P${context.seat}'s creatures have total power ${total}.` }
      : { met: false, reason: `Not met — P${context.seat}'s creatures have total power ${total}/${needed}.` };
  }
  if (/you control/i.test(condition)) return { met: 'unknown', reason: `Needs manual check — ${condition}` };
  return { met: 'unknown', reason: `Condition detected — ${condition}` };
}

export function getAiCardKey(card) {
  return cardKey(card);
}

function hashText(source = '') {
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function normalizedCardName(card = {}) {
  return String(card?.name || 'unknown').toLowerCase().replace(/\s+/g, ' ').trim();
}

function cardKey(card) {
  const source = `${card?.name || 'Unknown'}|${visibleRulesText(card?.oracleText || '')}|${visibleRulesText(card?.typeLine || '')}`;
  return `${normalizedCardName(card)}::${hashText(source)}`;
}

function legacyCardKey(card) {
  const source = `${card?.name || 'Unknown'}|${card?.oracleText || ''}|${card?.typeLine || ''}`;
  return `${normalizedCardName(card)}::${hashText(source)}`;
}

function cardKeyCandidates(card) {
  return [...new Set([cardKey(card), legacyCardKey(card)].filter(Boolean))];
}

function lookupLearnedCard(brain = {}, card = {}) {
  const cards = brain.cards || {};
  const keys = cardKeyCandidates(card);
  const foundKey = keys.find((key) => cards[key]);
  return { primaryKey: keys[0], foundKey: foundKey || keys[0], entry: foundKey ? cards[foundKey] : null };
}

function numberFromText(text, fallback = 1) {
  const normalized = String(text || '').toLowerCase();
  const xMatch = normalized.match(/\bx\b/);
  if (xMatch) return 'X';
  const digit = normalized.match(/\b(\d+)\b/);
  if (digit) return Number(digit[1]);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(normalized)) return value;
  }
  return fallback;
}

function compactManaLabel(symbols = []) {
  const normalized = normalizeManaSymbolsInput(symbols);
  if (!normalized.length) return '?';
  const first = normalized[0];
  const allSame = normalized.every((symbol) => symbol === first);
  if (allSame && normalized.length > 2) return `${normalized.length}× ${formatManaSymbols([first])}`;
  return formatManaSymbols(normalized);
}


function normalizeCountSubject(text = '') {
  const lower = String(text || '').toLowerCase().replace(/[.]+$/g, '').trim();
  if (!lower) return '';
  if (/creatures? you control/.test(lower)) return 'creatures-you-control';
  if (/artifacts? you control/.test(lower)) return 'artifacts-you-control';
  if (/enchantments? you control/.test(lower)) return 'enchantments-you-control';
  if (/lands? you control/.test(lower)) return 'lands-you-control';
  if (/forests? you control/.test(lower)) return 'forests-you-control';
  if (/islands? you control/.test(lower)) return 'islands-you-control';
  if (/swamps? you control/.test(lower)) return 'swamps-you-control';
  if (/mountains? you control/.test(lower)) return 'mountains-you-control';
  if (/plains? you control/.test(lower)) return 'plains-you-control';
  if (/wastes? you control/.test(lower)) return 'wastes-you-control';
  if (/creatures? of the chosen type(?: you control)?/.test(lower)) return 'creatures-of-chosen-type-you-control';
  const subtype = String(text || '').match(/([A-Z][a-z]+)s? you control/);
  if (subtype) return `subtype:${subtype[1]}`;
  return `raw:${lower.replace(/\s+/g, '_')}`;
}

function amountLabelFromFormula(formula = '', fallback = '') {
  if (!formula) return fallback;
  if (!formula.startsWith('count:')) return fallback;
  const code = formula.slice('count:'.length);
  const known = {
    'creatures-you-control': 'creatures you control',
    'artifacts-you-control': 'artifacts you control',
    'enchantments-you-control': 'enchantments you control',
    'lands-you-control': 'lands you control',
    'forests-you-control': 'Forests you control',
    'islands-you-control': 'Islands you control',
    'swamps-you-control': 'Swamps you control',
    'mountains-you-control': 'Mountains you control',
    'plains-you-control': 'Plains you control',
    'wastes-you-control': 'Wastes you control',
    'creatures-of-chosen-type-you-control': 'creatures of the chosen type you control'
  };
  if (known[code]) return `for each ${known[code]}`;
  if (code.startsWith('subtype:')) return `for each ${code.slice('subtype:'.length)} you control`;
  if (code.startsWith('raw:')) return `for each ${code.slice('raw:'.length).replace(/_/g, ' ')}`;
  return fallback;
}

function countFormulaFromText(text = '') {
  const match = String(text || '').match(/\bfor each\s+([^.]*)/i);
  if (!match) return { formula: '', label: '' };
  const subject = match[1].trim();
  const formula = normalizeCountSubject(subject);
  return {
    formula: formula ? `count:${formula}` : '',
    label: `for each ${subject}`
  };
}

function dynamicManaLabel(symbols = [], amountLabel = '') {
  const base = compactManaLabel(symbols);
  return amountLabel ? `${base} × ${amountLabel.replace(/^for each\s+/i, '')}` : base;
}

function manaRestrictionFromText(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/\bSpend this mana only (?:to|on|for)\s+([^.]*)/i);
  if (!match) return { restriction: '', kind: '' };
  const restriction = `Spend this mana only ${match[0].match(/only\s+(to|on|for)/i)?.[1] || 'to'} ${match[1].trim()}.`;
  const lower = restriction.toLowerCase();
  let kind = 'restricted';
  if (/creature spells?/.test(lower) && /activat(?:e|ed) abilities of creatures?/.test(lower)) kind = 'creature-spells-or-creature-abilities';
  else if (/creature spells?/.test(lower)) kind = 'creature-spells';
  else if (/activat(?:e|ed) abilities of creatures?/.test(lower)) kind = 'creature-abilities';
  return { restriction, kind };
}

function parseProducedManaEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  const baseSymbols = manaSymbolsFromText(text);
  const restrictionInfo = manaRestrictionFromText(text);
  let producedMana = baseSymbols;
  let amountFormula = '';
  let amountLabel = '';
  let amount = null;

  const quantifiedSymbol = text.match(/\badd\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(\{[WUBRGC]\})/i);
  if (quantifiedSymbol) {
    const parsedAmount = numberFromText(quantifiedSymbol[1], 1);
    const symbol = quantifiedSymbol[2].replace(/[{}]/g, '').toUpperCase();
    if (parsedAmount === 'X') {
      producedMana = [symbol];
      amountFormula = 'X';
      amountLabel = 'X';
    } else {
      amount = Math.max(0, Number(parsedAmount || 0));
      producedMana = Array.from({ length: amount }, () => symbol);
      amountLabel = `${amount} ${symbol}`;
    }
  }

  const amountEqual = text.match(/\badd an amount of\s+(\{[WUBRGC]\})\s+equal to\s+([^.]*)/i);
  if (amountEqual) {
    const symbol = amountEqual[1].replace(/[{}]/g, '').toUpperCase();
    producedMana = [symbol];
    amountFormula = `equal:${amountEqual[2].trim()}`;
    amountLabel = `an amount equal to ${amountEqual[2].trim()}`;
  }

  const anyColorCount = text.match(/\badd\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+mana of any/i);
  if (anyColorCount) {
    const parsedAmount = numberFromText(anyColorCount[1], 1);
    if (parsedAmount === 'X') {
      producedMana = ['ANY'];
      amountFormula = 'X';
      amountLabel = 'X any-color mana';
    } else {
      amount = Math.max(0, Number(parsedAmount || 0));
      producedMana = Array.from({ length: amount }, () => 'ANY');
      amountLabel = `${amount} any-color mana`;
    }
  }

  const countFormula = countFormulaFromText(text);
  if (countFormula.formula && producedMana.length <= 1) {
    amountFormula = countFormula.formula;
    amountLabel = countFormula.label;
  }

  const producedManaLabel = amountFormula && amountFormula.startsWith('count:')
    ? dynamicManaLabel(producedMana, amountLabelFromFormula(amountFormula, amountLabel))
    : compactManaLabel(producedMana);
  const label = producedMana.length
    ? `Add ${amountFormula && amountFormula.startsWith('count:') ? `${compactManaLabel(producedMana)} ${amountLabel || ''}`.trim() : compactManaLabel(producedMana)}`
    : 'Add mana';
  return {
    producedMana,
    producedManaLabel,
    amount,
    amountFormula,
    amountLabel,
    manaRestriction: restrictionInfo.restriction,
    manaRestrictionKind: restrictionInfo.kind,
    label
  };
}

function normalizeOracleAbilityBreaks(oracleText = '') {
  return String(oracleText || '')
    .replace(/\r/g, '')
    // Scryfall normally preserves paragraph breaks with \n. If the import/display path
    // flattened them, rebuild the most important boundary: a new activated cost after
    // a sentence, e.g. "... have trample. {7}{G}, {T}: Create...".
    .replace(/([.)])\s+((?:\{[^}]+\}\s*,?\s*)+\s*:)/g, '$1\n$2')
    // Also split newly-starting triggered abilities that were flattened.
    .replace(/([.)])\s+((?:When|Whenever|At the beginning|At the end)\b)/g, '$1\n$2')
    // Keyword-only paragraphs flattened into a later ability.
    .replace(/^(Trample|Flying|Haste|Vigilance|Deathtouch|Reach|Lifelink|Menace)\s+(?=(?:When|Whenever|At|You may|\{))/gim, '$1\n');
}

function looksLikeFaceTypeLine(line = '') {
  const text = String(line || '').trim();
  // Face labels in Scryfall oracle text can include supertypes before the real type,
  // e.g. "Legendary Artifact", "Basic Land", "Snow Creature — ...". These are
  // card-face type lines, not rules text, and should not become AI-missing actions.
  return /^(?:(?:Basic|Legendary|Snow|World|Ongoing|Host|Elite)\s+)*(?:Artifact|Battle|Creature|Enchantment|Instant|Kindred|Land|Planeswalker|Sorcery)(?:\s+[—-]|\s*$)/i.test(text);
}

function looksLikeRulesText(line = '') {
  const text = String(line || '').trim();
  if (!text || text === '//') return false;
  if (/\{[^}]+\}|:|\b(?:when|whenever|at the beginning|at the end|you|your|target|draw|discard|mill|create|add|gain|lose|put|return|exile|destroy|sacrifice|search|reveal|look at|choose|can't|cannot|enters?|attacks?|blocks?|casts?|activate|equip|cycling|eternalize|backup|convoke|hideaway|kicker|discover|scry|surveil|investigate|fight|fights|cast)\b/i.test(text)) return true;
  return new RegExp(`^(?:${KEYWORD_ABILITY_PATTERN})(?:\s*(?:,|and)\s*(?:${KEYWORD_ABILITY_PATTERN}))*\.?$`, 'i').test(text);
}

function splitOracleIntoAbilities(oracleText = '') {
  const rawLines = normalizeOracleAbilityBreaks(oracleText)
    .split('\n')
    .flatMap((line) => line.split(/(?<=\.)\s+(?=(?:\{[^}]+\}\s*,?\s*)+\s*:)/g))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index, lines) => {
      if (line === '//') return false;
      if (/^\(?\s*melds with\b/i.test(line)) return false;
      if (/^\(?\s*transforms from\b/i.test(line)) return false;
      if (/^\(?\s*as this saga enters and after your draw step, add a lore counter/i.test(line)) return false;
      if (/^\(?\s*as a siege enters, choose an opponent to protect it/i.test(line)) return false;
      if (/^\(?\s*you may cast either half\.\s*that door unlocks/i.test(line)) return false;
      if (looksLikeFaceTypeLine(line)) return false;
      // Split/adventure oracle text can include face-name lines before each face's type line.
      // Those are labels, not missing rules.
      if (!looksLikeRulesText(line) && looksLikeFaceTypeLine(lines[index + 1] || '')) return false;
      return true;
    });

  const abilities = [];
  let modalHeader = '';
  for (const line of rawLines) {
    if (/choose (one|two|three|one or both|any number)/i.test(line) && !line.startsWith('•')) {
      modalHeader = line;
      continue;
    }
    if (line.startsWith('•')) {
      abilities.push({ text: line.replace(/^•\s*/, '').trim(), modeHeader: modalHeader, isMode: true });
      continue;
    }
    modalHeader = '';
    abilities.push({ text: line, modeHeader: '', isMode: false });
  }
  return abilities;
}

function targetFiltersFromText(text = '') {
  const lowered = text.toLowerCase();
  const filters = [];
  if (/artifact or enchantment|enchantment or artifact/.test(lowered)) filters.push('Artifact', 'Enchantment');
  else {
    if (/\bartifact\b/.test(lowered)) filters.push('Artifact');
    if (/\benchantment\b|\baura\b/.test(lowered)) filters.push('Enchantment');
  }
  if (/\bcreature\b/.test(lowered)) filters.push('Creature');
  if (/\bland\b/.test(lowered)) filters.push('Land');
  if (/\bplaneswalker\b/.test(lowered)) filters.push('Planeswalker');
  if (/\bpermanent\b/.test(lowered)) filters.push('Permanent');
  if (/\bcard\b/.test(lowered) && !filters.length) filters.push('Card');
  return [...new Set(filters)];
}

function ownerHintFromText(text = '') {
  const lowered = text.toLowerCase();
  if (/you control|your/.test(lowered) && !/opponent/.test(lowered)) return 'self';
  if (/opponent controls|opponent/.test(lowered)) return 'opponent';
  return 'any';
}

function targetCountFromText(text = '') {
  const lowered = text.toLowerCase();
  const upTo = /up to/i.test(text);
  const match = lowered.match(/(?:up to\s+)?(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+target/);
  const count = match ? numberFromText(match[1], 1) : (/\btarget\b/.test(lowered) ? 1 : 0);
  if (!count) return { min: 0, max: 0, optional: false };
  return { min: upTo ? 0 : count, max: count, optional: upTo };
}


function parseCostText(costText = '') {
  const text = String(costText || '').trim();
  if (!text) return { raw: '', parts: [], canEstimate: true };
  const parts = [];
  const rawManaSymbols = text.match(/\{[^}]+\}/g) || [];
  const manaSymbols = rawManaSymbols.filter((symbol) => !/^\{(?:T|Q)\}$/i.test(symbol));
  if (manaSymbols.length) parts.push({ type: 'mana', value: manaSymbols.join(''), label: `Pay ${manaSymbols.join('')}` });
  if (/\{t\}|tap/i.test(text)) parts.push({ type: 'tap', label: 'Tap this source' });

  const sourceZoneMatch = text.match(/(?:from|in) your (graveyard|exile|hand|library)/i);
  const sourceZone = sourceZoneMatch ? sourceZoneMatch[1].toLowerCase() : '';
  const exileSelf = /exile this (?:card|spell|permanent|source)/i.test(text);
  const sacrificeSelf = /sacrifice (?:this|it|[^,.]*this land|[^,.]*this permanent)/i.test(text);
  const returnSelf = /return this (?:card|permanent|source) to (?:your )?(hand|library)/i.test(text);
  if (exileSelf) {
    parts.push({
      type: 'move-source',
      destination: 'exile',
      sourceZone,
      label: `Exile this card${sourceZone ? ` from your ${sourceZone}` : ''}`
    });
  }
  if (sacrificeSelf || (/sacrifice/i.test(text) && !exileSelf)) {
    parts.push({
      type: 'sacrifice',
      destination: 'graveyard',
      sourceZone,
      label: text.match(/sacrifice[^,.]*/i)?.[0] || 'Sacrifice this source'
    });
  }
  if (returnSelf) {
    parts.push({
      type: 'move-source',
      destination: returnSelf[1].toLowerCase(),
      sourceZone,
      label: `Return this card to your ${returnSelf[1].toLowerCase()}`
    });
  }
  if (/discard/i.test(text)) parts.push({ type: 'discard', label: text.match(/discard[^,.]*/i)?.[0] || 'Discard something' });
  if (/exert this (?:creature|permanent|source|card)/i.test(text)) {
    parts.push({ type: 'exert', label: text.match(/exert this (?:creature|permanent|source|card)/i)?.[0] || 'Exert this source' });
  }
  if (/pay\s+\d+\s+life/i.test(text)) parts.push({ type: 'life', label: text.match(/pay\s+\d+\s+life/i)?.[0] || 'Pay life' });
  if (!parts.length) parts.push({ type: 'other', label: text });
  return {
    raw: text,
    parts,
    canEstimate: true,
    sourceZone,
    sourceMove: parts.find((part) => part.type === 'move-source' || part.type === 'sacrifice') || null
  };
}

function parseFlashbackAbility(text = '') {
  const match = String(text || '').match(/^flashback\s+(.+)$/i);
  if (!match) return null;
  const costText = match[1].trim();
  return {
    type: 'flashback',
    costText,
    cost: parseCostText(costText),
    label: `Flashback ${costText}`,
    effectText: 'Cast this card from your graveyard. Exile it as it resolves.'
  };
}

function formatSearchDistribution(distribution = [], thenShuffle = false) {
  const parts = (distribution || []).map((item) => {
    const destinationLabel = item.destination === 'battlefield'
      ? `battlefield${item.tapped ? ' tapped' : ''}`
      : item.destination;
    const countLabel = item.count === 'rest' ? 'remaining cards' : `${item.count} card${item.count === 1 ? '' : 's'}`;
    return `${countLabel} → ${destinationLabel}`;
  });
  if (thenShuffle) parts.push('then shuffle');
  return parts.join('; ');
}

function normalizeExactManaCost(cost = '') {
  return String(cost || '').replace(/\s+/g, '').toUpperCase();
}

function exactManaCostsFromSearchText(text = '') {
  const costs = [];
  const addCost = (raw = '') => {
    const normalized = normalizeExactManaCost(raw);
    if (normalized && !costs.includes(normalized)) costs.push(normalized);
  };
  const manaCostPhrase = String(text || '').match(/(?:with|that has|having) mana cost ([^,.]+)/i)?.[1] || '';
  if (manaCostPhrase) {
    const symbols = manaCostPhrase.match(/\{[^}]+\}/g) || [];
    symbols.forEach(addCost);
  }
  return costs;
}

function parseLibrarySearchCriteria(effectText = '') {
  const text = String(effectText || '');
  const lowered = text.toLowerCase();
  const landChoices = BASIC_LAND_TYPES.filter((land) => new RegExp(`\\b${land}\\b`, 'i').test(text));
  const asksForBasic = /basic/i.test(text);
  const asksForLand = /land/i.test(text) || landChoices.length > 0;
  const targetFilters = targetFiltersFromText(text);
  const countMatch = lowered.match(/search your library for (?:up to\s+)?(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+/i);
  const maxChoices = numberFromText(countMatch?.[1] || '1', 1);
  const optionalCount = /up to/i.test(text);
  let destination = 'hand';
  if (/onto the battlefield/i.test(text)) destination = 'battlefield';
  else if (/into your graveyard/i.test(text)) destination = 'graveyard';
  else if (/on top of your library/i.test(text)) destination = 'top-library';
  else if (/into your hand/i.test(text)) destination = 'hand';
  const reveal = /reveal/i.test(text);
  const thenShuffle = /shuffle/i.test(text);
  const distribution = [];

  const oneBattlefield = /put one (?:of them |of those cards )?onto the battlefield(?: tapped)?/i.test(text);
  const allBattlefield = /put (?:those cards|them|all(?: of them)?) onto the battlefield(?: tapped)?/i.test(text);
  const battlefieldTapped = /battlefield tapped|onto the battlefield tapped/i.test(text);
  const oneGraveyard = /put one (?:of them |of those cards )?into your graveyard/i.test(text);
  const otherHand = /(?:the other|another|rest|remaining) (?:cards? )?(?:into|in) your hand/i.test(text)
    || /and (?:the other|another|rest|remaining) (?:cards? )?(?:into|in) your hand/i.test(text);
  const allHand = /put (?:those cards|them|all(?: of them)?) into your hand/i.test(text);

  if (allBattlefield) {
    distribution.push({ count: maxChoices || 'all', destination: 'battlefield', tapped: battlefieldTapped });
  } else if (oneBattlefield) {
    distribution.push({ count: 1, destination: 'battlefield', tapped: battlefieldTapped });
  }

  if (oneGraveyard) {
    distribution.push({ count: 1, destination: 'graveyard', tapped: false });
  }

  if (allHand && !distribution.length) {
    distribution.push({ count: maxChoices || 'all', destination: 'hand', tapped: false });
  } else if (otherHand) {
    distribution.push({ count: Math.max(1, Number(maxChoices || 2) - 1), destination: 'hand', tapped: false });
  }

  const exactManaCosts = exactManaCostsFromSearchText(text);
  const instructionLabel = formatSearchDistribution(distribution, thenShuffle);
  return {
    basicOnly: asksForBasic,
    landOnly: asksForLand,
    exactManaCosts,
    landChoices: landChoices.length ? landChoices : (asksForLand && asksForBasic ? [...BASIC_LAND_TYPES] : []),
    targetFilters: targetFilters.length ? targetFilters : (asksForLand ? ['Land'] : ['Card']),
    destination,
    reveal,
    maxChoices,
    optionalCount,
    distribution,
    instructionLabel,
    thenShuffle
  };
}

function cardMatchesLibraryCriteria(card, criteria = {}) {
  const type = card?.typeLine || '';
  const name = card?.name || '';
  if (criteria.basicOnly && !/\bBasic\b/i.test(type)) return false;
  if (criteria.landOnly && !/\bLand\b/i.test(type)) return false;
  if (criteria.exactManaCosts?.length) {
    const cardManaCost = normalizeExactManaCost(card?.manaCost || '');
    if (!criteria.exactManaCosts.includes(cardManaCost)) return false;
  }
  if (criteria.landChoices?.length) {
    return criteria.landChoices.some((land) => new RegExp(`\\b${land}\\b`, 'i').test(`${type} ${name}`));
  }
  const filters = criteria.targetFilters || [];
  if (!filters.length || filters.includes('Card')) return true;
  if (filters.includes('Land')) return /\bLand\b/i.test(type);
  return filters.some((filter) => new RegExp(`\\b${filter}\\b`, 'i').test(type));
}

function chooseLibraryCandidate(candidates = [], criteria = {}) {
  if (!candidates.length) return null;
  const priority = criteria.landChoices?.length ? criteria.landChoices : COLOR_LAND_PRIORITY;
  return [...candidates].sort((a, b) => {
    const aText = `${a.name || ''} ${a.typeLine || ''}`;
    const bText = `${b.name || ''} ${b.typeLine || ''}`;
    const aIndex = priority.findIndex((land) => new RegExp(`\\b${land}\\b`, 'i').test(aText));
    const bIndex = priority.findIndex((land) => new RegExp(`\\b${land}\\b`, 'i').test(bText));
    return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex);
  })[0];
}

function parseToken(text = '') {
  const tokenText = String(text || '').replace(/\s+/g, ' ').trim();
  const count = numberFromText(tokenText.match(/create\s+(.+?)\s+/i)?.[1] || '', 1);
  const pt = tokenText.match(/(\d+)\/(\d+)/);
  const preTokenText = tokenText.match(/\bcreates?\s+(.+?)\s+token\b/i)?.[1] || '';
  const cleanedName = preTokenText
    .replace(/^(?:x|\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+/i, '')
    .replace(/\b\d+\/\d+\b/g, '')
    .replace(/\b(?:white|blue|black|red|green|colorless|multicolored|artifact|creature|enchantment|land|planeswalker|legendary|tapped|and)\b/gi, '')
    .replace(/\bwith\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const tokenNameMatch = tokenText.match(/\b(?:green|red|white|blue|black|colorless|artifact|legendary|tapped|and|with|a|an|the|\d+\/\d+|\d+)\s+([A-Z]?[a-z]+(?:\s+[A-Z]?[a-z]+){0,2})\s+(?:creature\s+)?token/i);
  const name = cleanedName || tokenNameMatch?.[1]?.replace(/\bwith\b.*$/i, '').trim() || 'Token';
  const controllerHint = /its controller|that permanent(?:'s)? controller|destroyed permanent(?:'s)? controller/i.test(tokenText) ? 'targetController' : 'sourceController';
  const withText = tokenText.match(/\bwith\s+(.+?)(?:\.|$)/i)?.[1] || '';
  const traits = extractKeywordTraits(withText);
  return { count, power: pt?.[1] || '', toughness: pt?.[2] || '', name, controllerHint, traits };
}

function normalizePtDelta(raw = '') {
  const cleaned = String(raw || '').trim().toUpperCase();
  if (/^[+-]?\d+$/.test(cleaned)) return Number(cleaned);
  if (cleaned === 'X' || cleaned === '+X') return 'X';
  if (cleaned === '-X') return '-X';
  return cleaned || 0;
}

function formatPtDeltaValue(value) {
  if (typeof value === 'number') return `${value >= 0 ? '+' : ''}${value}`;
  const raw = String(value || '').toUpperCase();
  if (!raw) return '+0';
  return /^[+-]/.test(raw) ? raw : `+${raw}`;
}

function formatPtModificationLabel(affectedObjects = '', pt = {}, dynamic = false, effectText = '') {
  const ptLabel = `${formatPtDeltaValue(pt.powerDelta)}/${formatPtDeltaValue(pt.toughnessDelta)}`;
  const durationLabel = /until end of turn/i.test(effectText) ? ' until end of turn' : '';
  const xLabel = pt.xDefinition ? ` (X = ${pt.xDefinition})` : '';
  if (affectedObjects) {
    const verb = /^(this creature|equipped creature|target creature)$/i.test(String(affectedObjects || '').trim()) ? 'gets' : 'get';
    return `${affectedObjects} ${verb} ${ptLabel}${durationLabel}${xLabel}`;
  }
  if (dynamic) return `Modify P/T dynamically: ${ptLabel}${durationLabel}${xLabel}`;
  return `Modify P/T ${ptLabel}${durationLabel}`;
}

function parsePtModification(text = '') {
  const match = text.match(/([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))/i);
  if (!match) return null;
  const xDef = text.match(/where\s+x\s+is\s+([^.]*)/i)?.[1]?.trim() || '';
  return {
    powerDelta: normalizePtDelta(match[1]),
    toughnessDelta: normalizePtDelta(match[2]),
    xDefinition: xDef
  };
}

function parseCounterEffect(text = '') {
  const match = text.match(/put\s+(.+?)\s+([+-]\d+)\s*\/\s*([+-]\d+)\s+counters?\s+on\s+(.+?)(?:\.|,|$)/i);
  if (!match) return null;
  const amountRaw = match[1].trim();
  const powerDelta = Number(match[2]);
  const toughnessDelta = Number(match[3]);
  const affectedObjects = match[4].trim();
  const xDef = text.match(/where\s+x\s+is\s+([^.]*)/i)?.[1]?.trim() || '';
  const counterAmount = /that many/i.test(amountRaw)
    ? 'damageDealt'
    : (/\bx\b/i.test(amountRaw) ? 'X' : numberFromText(amountRaw, 1));
  return {
    counterType: `${powerDelta >= 0 ? '+' : ''}${powerDelta}/${toughnessDelta >= 0 ? '+' : ''}${toughnessDelta}`,
    counterAmount,
    xDefinition: xDef,
    affectedObjects,
    powerDelta,
    toughnessDelta
  };
}

function parseDrawEffect(effectText = '') {
  const fixed = effectText.match(/draws?\s+(x|\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);
  if (fixed) return { count: numberFromText(fixed[1], 1), countExpression: '', label: `Draw ${numberFromText(fixed[1], 1)} card(s)` };
  const equal = effectText.match(/draws?\s+cards?\s+equal\s+to\s+([^.]*)/i);
  if (equal) return { count: 'dynamic', countExpression: equal[1].trim(), label: `Draw cards equal to ${equal[1].trim()}` };
  if (/draws?\s+a\s+card/i.test(effectText) || /draws?\s+card/i.test(effectText)) return { count: 1, countExpression: '', label: 'Draw 1 card(s)' };
  return null;
}

function parseEquipmentStatic(effectText = '') {
  const match = effectText.match(/equipped creature gets ([+-]\d+)\s*\/\s*([+-]\d+) for each ([^.]*)/i);
  if (!match) return null;
  const multiplierText = match[3].trim();
  const sharesCreatureType = /shares? a creature type with it|share a creature type with it/i.test(multiplierText);
  return {
    powerDelta: Number(match[1]),
    toughnessDelta: Number(match[2]),
    multiplier: 'for each ' + multiplierText,
    multiplierText,
    affectedObject: 'equipped creature',
    scalingKind: sharesCreatureType ? 'shared_creature_type_count' : 'dynamic_count',
    needsEquipTargetChoice: true,
    label: `Equipped creature gets ${match[1]}/${match[2]} for each ${multiplierText}`
  };
}

function formatKeywordTrait(trait = '') {
  return String(trait || '')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bFrom\b/g, 'from')
    .replace(/\bAnd\b/g, 'and')
    .replace(/\bOr\b/g, 'or');
}

function extractKeywordTraits(text = '') {
  const cleaned = String(text || '')
    .replace(/[.]+$/g, '')
    .replace(/^this creature has\s+/i, '')
    .trim();
  if (!cleaned) return [];
  const regex = new RegExp(KEYWORD_ABILITY_PATTERN, 'gi');
  const traits = [];
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    const trait = formatKeywordTrait(match[0]);
    if (trait && !traits.includes(trait)) traits.push(trait);
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
  if (!traits.length) return [];
  const remainder = cleaned
    .replace(regex, '')
    .replace(/\b(?:and|or)\b/gi, '')
    .replace(/[,;/&\s]+/g, '')
    .trim();
  return remainder ? [] : traits;
}

function parseIntrinsicTraits(effectText = '') {
  return extractKeywordTraits(effectText).map((trait) => ({
    affectedObjects: 'this creature',
    trait,
    label: `Innate ability: ${trait}`
  }));
}


function parseBasePowerToughnessBundle(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(.+?) has base power and toughness (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\/(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?: and has (.+))?$/i);
  if (!match) return [];
  const affectedObjects = parseAffectedObjects(match[1]) || match[1].trim();
  const rawPower = String(match[2]).toUpperCase();
  const rawToughness = String(match[3]).toUpperCase();
  const basePower = rawPower === 'X' ? 'X' : numberFromText(match[2], 0);
  const baseToughness = rawToughness === 'X' ? 'X' : numberFromText(match[3], 0);
  const duration = /until end of turn/i.test(text) ? 'until-end-of-turn' : '';
  const linkedStatic = !duration;
  const ownerHint = ownerHintFromText(affectedObjects) || (/enchanted creature/i.test(affectedObjects) ? 'self' : ownerHintFromText(text));
  const targetCount = /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false };
  const actions = [{
    type: 'set_base_pt',
    affectedObjects,
    basePower,
    baseToughness,
    duration,
    linkedStatic,
    targetFilters: targetFiltersFromText(affectedObjects || text),
    targetCount,
    ownerHint,
    label: `${affectedObjects} has base power and toughness ${rawPower}/${rawToughness}${duration ? ' until end of turn' : ''}`
  }];
  const keywordText = match[4] || '';
  for (const trait of extractKeywordTraits(keywordText)) {
    actions.push({
      type: 'grant_trait',
      affectedObjects,
      trait,
      duration,
      linkedStatic,
      targetFilters: targetFiltersFromText(affectedObjects || text),
      targetCount,
      ownerHint,
      label: `Grant ${trait} to ${affectedObjects}${duration ? ' until end of turn' : ''}`
    });
  }
  return actions;
}

function parseSelfAnimationBundle(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^this (land|artifact|permanent) becomes a (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\/(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) (.+?) creature(?: with (.+?))? until end of turn(?:\. it's still a (.+))?$/i);
  if (!match) return [];
  const subject = `this ${match[1].toLowerCase()}`;
  const rawPower = String(match[2]).toUpperCase();
  const rawToughness = String(match[3]).toUpperCase();
  const basePower = rawPower === 'X' ? 'X' : numberFromText(match[2], 0);
  const baseToughness = rawToughness === 'X' ? 'X' : numberFromText(match[3], 0);
  const descriptor = match[4].trim();
  const keywordText = match[5] || '';
  const retainsType = match[6] ? match[6].trim() : '';
  const labelTail = retainsType ? `. It's still a ${retainsType}` : '';
  const actions = [{
    type: 'set_base_pt',
    affectedObjects: subject,
    basePower,
    baseToughness,
    duration: 'until-end-of-turn',
    linkedStatic: false,
    animationDescriptor: descriptor,
    retainsType,
    targetFilters: targetFiltersFromText(subject),
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `This ${match[1].toLowerCase()} becomes a ${rawPower}/${rawToughness} ${descriptor} creature until end of turn${labelTail}`
  }];
  for (const trait of extractKeywordTraits(keywordText)) {
    actions.push({
      type: 'grant_trait',
      affectedObjects: subject,
      trait,
      duration: 'until-end-of-turn',
      linkedStatic: false,
      targetFilters: targetFiltersFromText(subject),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Grant ${trait} to ${subject} until end of turn`
    });
  }
  return actions;
}

function parseGrantedTraits(effectText = '') {
  const match = effectText.match(/(.+?)\s+(?:have|has)\s+(.+)$/i);
  if (!match) return [];
  const affected = parseAffectedObjects(match[1]) || match[1].trim();
  // Tribal shorthand like "Wurms you control" means those creature permanents only.
  // Do not broaden it to every creature.
  if (!/permanents?|creatures?|artifacts?|enchantments?|lands?|planeswalkers?|wurms?|elves?|goblins?|zombies?|humans?/i.test(affected)) return [];
  return extractKeywordTraits(match[2]).map((trait) => ({
    affectedObjects: affected,
    trait,
    label: `Grant ${trait} to ${affected}`
  }));
}

function parseTemporaryKeywordGrants(effectText = '') {
  const match = effectText.match(/(.+?)\s+gain\s+(.+)$/i);
  if (!match) return [];
  const affected = parseAffectedObjects(match[1]) || match[1].trim();
  if (!/permanents?|creatures?|artifacts?|enchantments?|lands?|planeswalkers?|wurms?|elves?|goblins?|zombies?|humans?/i.test(affected)) return [];
  const duration = /until end of turn/i.test(effectText) ? 'until-end-of-turn' : '';
  const durationLabel = duration ? ' until end of turn' : '';
  const keywordText = match[2]
    .replace(/\s+and\s+get\b.*$/i, '')
    .replace(/\s+until end of turn\b.*$/i, '')
    .trim();
  return extractKeywordTraits(keywordText).map((trait) => ({
    affectedObjects: affected,
    trait,
    duration,
    label: `Grant ${trait} to ${affected}${durationLabel}`
  }));
}

function parseCastingCostModifier(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  if (!/additional cost to cast/i.test(text) || !/less to cast/i.test(text)) return null;
  const appliesMatch = text.match(/additional cost to cast\s+(.+?)\s+spells?,\s+you may pay\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life/i);
  const reductionMatch = text.match(/those spells cost\s+(\{[^}]+\})\s+less to cast if you paid life this way/i)
    || text.match(/spells? cost\s+(\{[^}]+\})\s+less to cast if you paid life this way/i);
  if (!appliesMatch || !reductionMatch) return null;
  const appliesToText = appliesMatch[1].trim();
  const lifeAmount = numberFromText(appliesMatch[2], 0);
  const reductionSymbols = manaSymbolsFromText(reductionMatch[1]);
  const limitColorText = text.match(/reduces only the amount of\s+(white|blue|black|red|green|colorless)\s+mana you pay/i)?.[1] || '';
  const limitColor = limitColorText ? MANA_WORDS[limitColorText.toLowerCase()] || '' : (reductionSymbols[0] || '');
  const colors = Object.entries(MANA_WORDS)
    .filter(([word]) => new RegExp(`\\b${word}\\b`, 'i').test(appliesToText))
    .map(([, symbol]) => symbol);
  const cardTypes = [];
  if (/\bpermanent\b/i.test(appliesToText)) cardTypes.push('Permanent');
  if (/\bcreature\b/i.test(appliesToText)) cardTypes.push('Creature');
  if (/\bartifact\b/i.test(appliesToText)) cardTypes.push('Artifact');
  if (/\benchantment\b/i.test(appliesToText)) cardTypes.push('Enchantment');
  if (/\bland\b/i.test(appliesToText)) cardTypes.push('Land');
  const reductionLabel = formatManaSymbols(reductionSymbols);
  return {
    type: 'casting_cost_modifier',
    appliesToText,
    appliesTo: {
      colors: [...new Set(colors)],
      cardTypes: [...new Set(cardTypes)]
    },
    optionalAdditionalCost: {
      kind: 'life',
      amount: lifeAmount,
      label: `Pay ${lifeAmount} life`
    },
    reduction: {
      symbols: reductionSymbols,
      amount: reductionSymbols.length || 1,
      onlyReducesColor: limitColor,
      requiresAdditionalCostPaid: true,
      label: `Reduce ${limitColorText || plainManaLabel(reductionSymbols)} mana paid by ${reductionLabel}`
    },
    label: `Cost modifier: pay ${lifeAmount} life to reduce ${appliesToText} spells by ${reductionLabel}`
  };
}



function parseConvokeAbility(text = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^convoke\b/i.test(cleaned)) return null;
  return {
    type: 'casting_cost_mechanic',
    keywordAction: 'convoke',
    appliesOnStack: true,
    paymentSource: 'creatures you control',
    label: 'Convoke — creatures you control can help cast this spell'
  };
}

function parseUntapEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^untap\s+(.+)$/i);
  if (!match) return null;
  const affectedObjects = parseAffectedObjects(match[1]) || match[1].trim();
  const targetFilters = targetFiltersFromText(affectedObjects || text);
  return {
    type: 'untap',
    affectedObjects,
    targetFilters: targetFilters.length ? targetFilters : ['Permanent'],
    targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
    targetRestrictionText: /activated ability with \{T\} in its cost/i.test(text) ? 'has an activated ability with {T} in its cost' : '',
    label: `Untap ${affectedObjects}`
  };
}

function parsePutFromHandToBattlefield(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(?:you may\s+)?put\s+(?:a|one)\s+(.+?)\s+card from your hand onto the battlefield$/i);
  if (!match) return null;
  const cardFilterText = match[1].trim();
  return {
    type: 'put_from_hand_to_battlefield',
    cardFilterText,
    targetFilters: targetFiltersFromText(cardFilterText),
    sourceZone: 'hand',
    destination: 'battlefield',
    optional: /\byou may\b/i.test(text),
    label: `Put a ${cardFilterText} card from your hand onto the battlefield`
  };
}

function parseMillReturnMilled(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^mill\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?,\s*then return\s+(?:a|one)\s+(.+?)\s+card milled this way to your hand$/i);
  if (!match) return null;
  const millCount = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 1);
  const returnFilterText = match[2].trim();
  return {
    type: 'mill_return_milled',
    millCount,
    returnFilterText,
    targetFilters: targetFiltersFromText(returnFilterText),
    destination: 'hand',
    label: `Mill ${millCount} card(s), then return a ${returnFilterText} card milled this way to your hand`
  };
}

function parseKeywordAction(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const lower = text.toLowerCase();
  if (/^investigate$/i.test(text)) {
    return {
      type: 'keyword_action',
      keywordAction: 'investigate',
      createsToken: {
        count: 1,
        name: 'Clue',
        typeLine: 'Artifact Token',
        abilityText: '{2}, Sacrifice this token: Draw a card.'
      },
      label: 'Investigate — create a Clue token'
    };
  }
  const scry = lower.match(/^scry\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/i);
  if (scry) {
    const count = numberFromText(scry[1], 1);
    return { type: 'keyword_action', keywordAction: 'scry', count, label: `Scry ${count}` };
  }
  const surveil = lower.match(/^surveil\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/i);
  if (surveil) {
    const count = numberFromText(surveil[1], 1);
    return { type: 'keyword_action', keywordAction: 'surveil', count, label: `Surveil ${count}` };
  }
  const discover = lower.match(/^discover\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:,\s*where\s+x\s+is\s+(.+))?$/i);
  if (discover) {
    const isX = discover[1].toUpperCase() === 'X';
    const count = isX ? 'X' : numberFromText(discover[1], 1);
    const xDefinition = discover[2]?.trim() || '';
    return {
      type: 'keyword_action',
      keywordAction: 'discover',
      count,
      countExpression: isX ? 'X' : '',
      xDefinition,
      label: `Discover ${count}${xDefinition ? ` where X is ${xDefinition}` : ''}`
    };
  }
  const adapt = lower.match(/^adapt\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/i);
  if (adapt) {
    const count = actionAmountFromWord(adapt[1], 1);
    return {
      type: 'keyword_action',
      keywordAction: 'adapt',
      counterAmount: count,
      counterType: '+1/+1',
      conditionText: 'if this creature has no +1/+1 counters on it',
      label: `Adapt ${count} — put ${count} +1/+1 counter(s) on this creature if it has none`
    };
  }

  if (/^storm$/i.test(text)) {
    return {
      type: 'casting_cost_mechanic',
      keywordAction: 'storm',
      copiesOnCast: true,
      label: 'Storm — copy this spell for each spell cast before it this turn'
    };
  }

  const simpleActions = {
    proliferate: 'Proliferate',
    populate: 'Populate',
    connive: 'Connive',
    explore: 'Explore',
    cascade: 'Cascade',
    ascend: "Ascend — get the city\'s blessing if you control ten or more permanents",
    learn: 'Learn',
    'the ring tempts you': 'The Ring tempts you',
    'venture into the dungeon': 'Venture into the dungeon'
  };
  if (simpleActions[lower]) {
    return { type: 'keyword_action', keywordAction: lower.replace(/\s+/g, '_'), label: simpleActions[lower] };
  }
  return null;
}

function parseSetLifeTotal(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  const dynamicHalfMatch = text.match(/(?:your|target player(?:'s)?|that player(?:'s)?) life total becomes\s+half your starting life total, rounded up/i);
  if (dynamicHalfMatch) {
    return {
      type: 'set_life_total',
      lifeTotal: 'dynamic',
      lifeTotalFormula: 'ceil(startingLifeTotal/2)',
      affectedObjects: /target player/i.test(text) ? 'target player' : 'you',
      targetFilters: /target player/i.test(text) ? ['Player'] : [],
      targetCount: /target player/i.test(text) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      label: `${/target player/i.test(text) ? 'Target player\'s' : 'Your'} life total becomes half your starting life total, rounded up`
    };
  }

  const match = text.match(/(?:your|target player(?:'s)?|that player(?:'s)?) life total becomes\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i);
  if (!match) return null;
  const lifeTotal = numberFromText(match[1], 0);
  return {
    type: 'set_life_total',
    lifeTotal,
    affectedObjects: /target player/i.test(text) ? 'target player' : 'you',
    targetFilters: /target player/i.test(text) ? ['Player'] : [],
    targetCount: /target player/i.test(text) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
    label: `${/target player/i.test(text) ? 'Target player\'s' : 'Your'} life total becomes ${lifeTotal}`
  };
}

function parseLifeFloorReplacement(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  if (!/damage that would/i.test(text) || !/instead/i.test(text) || !/life total/i.test(text)) return null;
  const floorMatch = text.match(/reduce your life total (?:to )?(?:less than|below)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i)
    || text.match(/life total (?:to )?(?:less than|below)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i);
  const insteadMatch = text.match(/reduces? it to\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+instead/i);
  const floor = numberFromText(insteadMatch?.[1] || floorMatch?.[1] || '', 0);
  if (!floor) return null;
  return {
    type: 'life_floor_replacement',
    floor,
    replacementSource: 'damage',
    replacementKind: 'damage-life-floor',
    damageOnly: true,
    label: `Life floor replacement: damage cannot reduce your life total below ${floor}`
  };
}


function parseLifeGainReplacement(effectText = '', conditionText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim();
  const fullText = `${condition ? `If ${condition}, ` : ''}${text}`.replace(/\s+/g, ' ').trim();
  if (!/would gain life/i.test(fullText) || !/instead/i.test(fullText)) return null;

  const doubledMatch = fullText.match(/(.+?) would gain life,?\s*(?:that player |you |they )?(?:gain|gains) (?:twice|double) that much life instead/i)
    || fullText.match(/(.+?) would gain life,?\s*(?:that player |you |they )?(?:gain|gains) twice that much instead/i);
  if (doubledMatch) {
    const affectedObjects = doubledMatch[1].replace(/^if\s+/i, '').trim();
    return {
      type: 'life_gain_replacement',
      replacementKind: 'life-gain-multiply',
      conditionText: condition || `${affectedObjects} would gain life`,
      affectedObjects,
      multiplier: 2,
      linkedStatic: true,
      replacement: true,
      label: `Life gain replacement: ${affectedObjects} gains twice that much life instead`
    };
  }

  const halfMatch = fullText.match(/(.+?) would gain life,?\s*(?:that player |you |they )?(?:gain|gains) half that much life instead/i);
  if (halfMatch) {
    const affectedObjects = halfMatch[1].replace(/^if\s+/i, '').trim();
    return {
      type: 'life_gain_replacement',
      replacementKind: 'life-gain-half',
      conditionText: condition || `${affectedObjects} would gain life`,
      affectedObjects,
      multiplier: 0.5,
      linkedStatic: true,
      replacement: true,
      label: `Life gain replacement: ${affectedObjects} gains half that much life instead`
    };
  }

  const plusMatch = fullText.match(/gain that much life plus\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+instead/i)
    || fullText.match(/gain that much plus\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\s+instead/i);
  if (!plusMatch) return null;
  const bonusLife = numberFromText(plusMatch[1], 1);
  return {
    type: 'life_gain_replacement',
    replacementKind: 'life-gain-plus',
    conditionText: condition || 'you would gain life',
    bonusLife,
    linkedStatic: true,
    replacement: true,
    label: `Life gain replacement: gain that much life plus ${bonusLife}`
  };
}

function parsePaymentRestriction(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^(players?|opponents?|you) can't (.+?) to cast spells? or activate abilities\.??$/i);
  if (!match) return null;
  const affectedPlayers = match[1].toLowerCase();
  const prohibitedText = match[2].trim();
  const prohibitedPayments = [];
  if (/pay life/i.test(prohibitedText)) prohibitedPayments.push('pay_life');
  if (/sacrifice creatures?/i.test(prohibitedText)) prohibitedPayments.push('sacrifice_creatures');
  if (!prohibitedPayments.length) return null;
  const affectedLabel = affectedPlayers === 'players' ? 'Players' : (affectedPlayers === 'you' ? 'You' : 'Opponents');
  return {
    type: 'payment_restriction',
    affectedPlayers,
    prohibitedPayments,
    appliesTo: ['cast_spells', 'activate_abilities'],
    linkedStatic: true,
    label: `${affectedLabel} can't ${prohibitedText} to cast spells or activate abilities`
  };
}

function parseCombatCreatureAction(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^(exile|destroy|tap)\s+all\s+(attacking|blocking|blocked|unblocked)\s+creatures?\.??$/i);
  if (!match) return null;
  const verb = match[1].toLowerCase();
  const combatRole = match[2].toLowerCase();
  const actionType = verb === 'exile' ? 'combat_mass_exile' : (verb === 'destroy' ? 'combat_mass_destroy' : 'combat_mass_tap');
  return {
    type: actionType,
    combatRole,
    affectedObjects: `all ${combatRole} creatures`,
    targetFilters: ['Creature'],
    targetCount: { min: 0, max: 0, optional: false },
    requiresCombatState: true,
    label: `${verb.charAt(0).toUpperCase()}${verb.slice(1)} all ${combatRole} creatures`
  };
}


function parseCombatDeclarationTax(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^creatures? can't\s+(attack|block)(.*?)\s+unless their controller pays\s+(\{[^}]+\}|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+for each of those creatures?\.?$/i);
  if (!match) return null;
  const declaration = match[1].toLowerCase();
  const scopeText = match[2].trim();
  const rawCost = match[3].trim();
  const taxCost = /^\{[^}]+\}$/.test(rawCost) ? rawCost : `{${numberFromText(rawCost, 1)}}`;
  const attacksYou = /you/i.test(scopeText);
  const attacksPlaneswalkers = /planeswalkers? you control/i.test(scopeText);
  const affectedObjects = declaration === 'attack'
    ? `creatures attacking ${scopeText || 'you'}`
    : 'creatures blocking';
  const shortLabel = declaration === 'attack'
    ? `Attack tax: attackers must pay ${taxCost} each${attacksYou || attacksPlaneswalkers ? ' to attack you or your planeswalkers' : ''}`
    : `Block tax: blockers must pay ${taxCost} each`;
  return {
    type: 'combat_declaration_tax',
    declaration,
    affectedObjects,
    taxCost,
    taxPer: declaration === 'attack' ? 'each attacking creature' : 'each blocking creature',
    defendingObjects: declaration === 'attack'
      ? [attacksYou ? 'you' : '', attacksPlaneswalkers ? 'planeswalkers you control' : ''].filter(Boolean)
      : [],
    linkedStatic: true,
    requiresCombatDeclarationCheck: true,
    label: shortLabel
  };
}

function parseChooseAndGrantTrait(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^choose\s+(.+?)\.\s*(.+?)\s+gain\s+that ability(?:\s+until end of turn)?\.??$/i);
  if (!match) return null;
  const choiceText = match[1].trim();
  const affectedObjects = parseAffectedObjects(match[2]) || match[2].trim();
  const choices = extractKeywordTraits(choiceText);
  if (!choices.length || !/creatures?|wurms?|elves?|goblins?|zombies?|humans?|angels?/i.test(affectedObjects)) return null;
  const duration = /until end of turn/i.test(text) ? 'until-end-of-turn' : '';
  return {
    type: 'choose_and_grant_trait',
    choiceKind: 'keyword_ability',
    choices,
    affectedObjects,
    duration,
    label: `Choose ${choices.join(' / ')}; grant it to ${affectedObjects}${duration ? ' until end of turn' : ''}`
  };
}

function parseCyclingAbility(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^((?:basic\s+)?(?:land|forest|island|swamp|mountain|plains|wizard|sliver|type)?cycling|cycling)\s+(.+)$/i);
  if (!match) return null;
  const cyclingKind = match[1].replace(/\s+/g, ' ').trim();
  const cyclingCost = match[2].trim();
  const costText = `${cyclingCost}, Discard this card`;
  const isTutorCycling = !/^cycling$/i.test(cyclingKind);
  const subtype = cyclingKind.replace(/cycling$/i, '').trim();
  return {
    type: isTutorCycling ? 'landcycling' : 'cycling',
    keywordAction: cyclingKind.toLowerCase().replace(/\s+/g, '_'),
    costText,
    cost: parseCostText(costText),
    effectText: isTutorCycling
      ? `Search your library for a ${subtype || 'matching'} card, reveal it, put it into your hand, then shuffle.`
      : 'Draw a card.',
    sourceZoneRequirement: 'hand',
    sourceCostMove: { type: 'discard', destination: 'graveyard', sourceZone: 'hand', label: 'Discard this card' },
    searchLibrary: isTutorCycling,
    searchFilterText: isTutorCycling ? `${subtype || 'matching'} card` : '',
    targetFilters: isTutorCycling ? targetFiltersFromText(subtype || 'land') : [],
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: isTutorCycling
      ? `${cyclingKind} ${cyclingCost}: discard this card, search for a ${subtype || 'matching'} card`
      : `Cycling ${cyclingCost}: discard this card, draw 1 card`
  };
}

function parseEntryModifier(effectText = '') {
  const cleaned = String(effectText || '').replace(/[.]+$/g, '').trim();
  const match = cleaned.match(/enters (?:the battlefield )?tapped(?: unless (.+))?/i);
  if (!match) return null;
  const unlessClause = match[1]?.trim() || '';
  return {
    entryType: 'tapped',
    unlessClause,
    label: unlessClause ? `Entry modifier: Enters tapped unless ${unlessClause}` : 'Entry modifier: Enters tapped'
  };
}

function parseEntryCounterModifier(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^each\s+(other\s+)?(.+?)\s+you control enters with an additional\s+([+-]\d+\s*\/\s*[+-]\d+|[A-Za-z -]+?)\s+counters?\s+on it for each\s+(.+?)\s+you already control\.?$/i);
  if (!match) return null;
  const excludesSource = Boolean(match[1]);
  const affectedType = match[2].trim();
  const counterType = match[3].replace(/\s+/g, '').trim();
  const countSubject = match[4].trim();
  return {
    type: 'entry_counter_modifier',
    affectedObjects: `each ${excludesSource ? 'other ' : ''}${affectedType} you control`,
    affectedType,
    excludesSource,
    counterType,
    counterAmount: 'dynamic',
    amountFormula: `count:already-control:${countSubject}`,
    amountLabel: `for each ${countSubject} you already control`,
    appliesOnEnter: true,
    linkedStatic: true,
    label: `Entry modifier: ${excludesSource ? 'Other ' : ''}${affectedType} enter with ${counterType} counters equal to ${countSubject} you already control`
  };
}

function parseTemporaryExileEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim();
  const blinkMatch = text.match(/^exile\s+(another\s+)?target\s+(.+?)\.\s*return that card to the battlefield under (its owner's|its controller's|your) control at the beginning of the next end step\.?$/i);
  if (blinkMatch) {
    const targetText = blinkMatch[2].trim();
    const controllerText = blinkMatch[3].trim();
    const targetFilters = targetFiltersFromText(targetText);
    return {
      type: 'temporary_exile_return',
      targetFilters,
      ownerHint: ownerHintFromText(text),
      targetCount: { min: 1, max: 1, optional: false },
      targetExcludesSource: Boolean(blinkMatch[1]),
      targetDescription: `${blinkMatch[1] ? 'another target ' : 'target '}${targetText}`,
      delayedReturn: {
        timing: 'beginning of the next end step',
        controller: /owner/i.test(controllerText) ? 'owner' : (/your/i.test(controllerText) ? 'you' : 'controller'),
        tapped: /return that card to the battlefield tapped/i.test(text)
      },
      label: `Blink ${blinkMatch[1] ? 'another ' : ''}target ${targetText} until the next end step`
    };
  }

  const linkedMatch = text.match(/^exile\s+(another\s+)?target\s+(.+?)\s+until this\s+(creature|permanent|source|card)\s+leaves the battlefield\.?$/i);
  if (linkedMatch) {
    const targetText = linkedMatch[2].trim();
    const sourceKind = linkedMatch[3].trim().toLowerCase();
    const targetFilters = targetFiltersFromText(targetText);
    return {
      type: 'linked_exile_until_source_leaves',
      targetFilters,
      ownerHint: ownerHintFromText(text),
      targetCount: { min: 1, max: 1, optional: false },
      targetExcludesSource: Boolean(linkedMatch[1]),
      targetDescription: `${linkedMatch[1] ? 'another target ' : 'target '}${targetText}`,
      returnCondition: `until this ${sourceKind} leaves the battlefield`,
      linkedStatic: true,
      label: `Exile ${linkedMatch[1] ? 'another ' : ''}target ${targetText} until this ${sourceKind} leaves the battlefield`
    };
  }

  return null;
}

function parseBackupAbility(text = '') {
  const match = String(text || '').replace(/\s+/g, ' ').trim().match(/^backup\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (!match) return null;
  const counterAmount = numberFromText(match[1], 1);
  return {
    type: 'add_counters',
    keywordAction: 'backup',
    counterType: '+1/+1',
    counterAmount,
    powerDelta: 1,
    toughnessDelta: 1,
    affectedObjects: 'target creature',
    targetFilters: ['Creature'],
    targetCount: { min: 1, max: 1, optional: false },
    ownerHint: 'self',
    triggerText: 'When this creature enters',
    duration: 'permanent',
    backupAbilityGrant: true,
    label: `Backup ${counterAmount}: put ${counterAmount} +1/+1 counter(s) on target creature`
  };
}

function parseEternalizeAbility(originalText = '') {
  const text = String(originalText || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^eternalize\s+((?:\{[^}]+\}\s*)+)(?:\((.+)\))?$/i);
  if (!match) return null;
  const eternalizeCost = match[1].trim();
  const reminder = match[2] || '';
  const fullCostText = `${eternalizeCost}, Exile this card from your graveyard`;
  const copyDetails = reminder.match(/except it's a\s+([^.]*)/i)?.[1] || '';
  const pt = copyDetails.match(/(\d+)\s*\/\s*(\d+)/);
  const colorWords = copyDetails.match(/\b(?:white|blue|black|red|green|colorless|multicolored)\b/gi) || [];
  const typeText = copyDetails
    .replace(/\b\d+\s*\/\s*\d+\b/g, '')
    .replace(/\b(?:white|blue|black|red|green|colorless|multicolored|with no mana cost)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    type: 'create_token',
    keywordAction: 'eternalize',
    costText: fullCostText,
    cost: parseCostText(fullCostText),
    sourceZoneRequirement: 'graveyard',
    sourceCostMove: { type: 'move-source', destination: 'exile', sourceZone: 'graveyard', label: 'Exile this card from your graveyard' },
    token: {
      count: 1,
      power: pt?.[1] || '4',
      toughness: pt?.[2] || '4',
      name: `${typeText || 'Zombie copy'} token`,
      copyOfSource: true,
      colors: colorWords.map((word) => word.toLowerCase()),
      traits: []
    },
    controllerHint: 'sourceController',
    targetCount: { min: 0, max: 0, optional: false },
    sorcerySpeedOnly: true,
    label: `Eternalize ${eternalizeCost}: exile this card from your graveyard and create a ${pt ? `${pt[1]}/${pt[2]} ` : '4/4 '}${typeText || 'Zombie copy'} token`
  };
}

function parseCantBeCountered(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (/^this spell can't be countered$/i.test(text)) {
    return {
      type: 'spell_counter_restriction',
      affectedObjects: 'this spell',
      linkedStatic: true,
      appliesOnStack: true,
      label: "This spell can't be countered"
    };
  }
  const match = text.match(/^(.+?)\s+can't be countered$/i);
  if (!match) return null;
  const affectedObjects = match[1].trim();
  return {
    type: 'spell_counter_restriction',
    affectedObjects,
    linkedStatic: true,
    label: `${affectedObjects} can't be countered`
  };
}

function parseDamagePreventionRestriction(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(.+?damage)\s+can't be prevented$/i);
  if (!match) return null;
  return {
    type: 'damage_prevention_restriction',
    affectedObjects: match[1].trim(),
    linkedStatic: true,
    label: `${match[1].trim()} can't be prevented`
  };
}

function parseBlockingRestriction(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(this creature|[^.]+?)\s+can't be blocked by\s+(.+)$/i);
  if (!match) return null;
  const blockedObject = match[1].trim();
  const blockersText = match[2].trim();
  const powerMax = blockersText.match(/creatures? with power\s+(\d+)\s+or less/i)?.[1] || '';
  return {
    type: 'blocking_restriction',
    affectedObjects: blockedObject,
    restrictedBlockers: blockersText,
    blockerPowerMax: powerMax ? Number(powerMax) : null,
    linkedStatic: true,
    label: `${blockedObject} can't be blocked by ${blockersText}`
  };
}

function parseTopLibraryPermanentDrop(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^look at the top\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards? of your library,\s+where x is\s+(.+?)\.\s+you may put\s+(?:a|one)\s+(.+?)\s+card with mana value\s+(x|\d+)\s+or less from among them onto the battlefield\.\s+put the rest on the bottom of your library in a random order$/i);
  if (!match) return null;
  const topCount = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 1);
  const xDefinition = match[2].trim();
  const cardFilterText = match[3].trim();
  return {
    type: 'top_library_permanent_to_battlefield',
    topCount,
    topCountFormula: topCount === 'X' ? 'sourcePower' : '',
    xDefinition,
    cardFilterText,
    targetFilters: targetFiltersFromText(cardFilterText),
    destination: 'battlefield',
    manaValueMax: match[4].toUpperCase() === 'X' ? 'X' : Number(match[4]),
    restDestination: 'bottom-random',
    optional: true,
    label: `Look at top ${topCount} card(s) where X is ${xDefinition}; you may put a ${cardFilterText} card with mana value ${match[4].toUpperCase()} or less onto the battlefield`
  };
}


function parseHideawayAbility(text = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = cleaned.match(/^hideaway\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (!match) return null;
  const topCount = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 1);
  return {
    type: 'hideaway',
    keywordAction: 'hideaway',
    topCount,
    sourceZone: 'library',
    destination: 'exile-face-down',
    restDestination: 'bottom-random',
    triggerText: 'When this land enters',
    targetCount: { min: 0, max: 0, optional: false },
    label: `Hideaway ${topCount}: look at top ${topCount}, exile one face down, put the rest on bottom randomly`
  };
}

function parsePlayExiledCard(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(?:you may\s+)?play\s+the exiled card\s+without paying its mana cost$/i)
    || text.match(/^(?:you may\s+)?cast\s+the exiled card\s+without paying its mana cost$/i);
  if (!match) return null;
  return {
    type: 'play_exiled_card',
    sourceZone: 'exile',
    linkedExiledCard: true,
    withoutPayingManaCost: true,
    optional: /\byou may\b/i.test(text),
    targetCount: { min: 0, max: 0, optional: false },
    label: 'Play the exiled card without paying its mana cost'
  };
}

function parseAlternateCastPermission(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  let match = text.match(/^while you(?:'|’)re searching your library,\s*you may cast this card from your library$/i);
  if (match) {
    return {
      type: 'alternate_cast_permission',
      sourceZone: 'library',
      sourceZoneRequirement: 'library',
      castCondition: "while you're searching your library",
      optional: true,
      targetCount: { min: 0, max: 0, optional: false },
      label: "You may cast this card from your library while you're searching your library"
    };
  }

  match = text.match(/^you may cast this card from your graveyard by removing\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+counters? from among creatures you control in addition to paying its other costs$/i);
  if (match) {
    const counterCount = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 1);
    return {
      type: 'alternate_cast_permission',
      sourceZone: 'graveyard',
      sourceZoneRequirement: 'graveyard',
      optional: true,
      additionalCostText: `remove ${counterCount} counters from among creatures you control`,
      additionalCost: {
        type: 'remove_counters',
        counterAmount: counterCount,
        counterType: 'any',
        fromObjects: 'creatures you control'
      },
      targetCount: { min: 0, max: 0, optional: false },
      label: `You may cast this card from your graveyard by removing ${counterCount} counters from among creatures you control`
    };
  }

  return null;
}

function parseFightEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(target creature you control) fights (target creature you (?:don't|do not) control)$/i)
    || text.match(/^(.+?) fights (.+?)$/i);
  if (!match) return null;
  const firstFighter = match[1].trim();
  const secondFighter = match[2].trim();
  return {
    type: 'fight',
    firstFighter,
    secondFighter,
    targetFilters: ['Creature'],
    targetCount: { min: 2, max: 2, optional: false },
    ownerHint: 'mixed',
    simultaneousDamage: true,
    label: `${firstFighter} fights ${secondFighter}`
  };
}

function parseKickerAbility(text = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = cleaned.match(/^kicker\s+((?:\{[^}]+\}\s*)+)/i);
  if (!match) return null;
  const kickerCost = match[1].trim();
  return {
    type: 'casting_cost_mechanic',
    keywordAction: 'kicker',
    kickerCost,
    optionalAdditionalCost: {
      kind: 'kicker',
      cost: kickerCost,
      label: `Kicker ${kickerCost}`
    },
    appliesOnStack: true,
    targetCount: { min: 0, max: 0, optional: false },
    label: `Kicker ${kickerCost} — optional additional cost as you cast this spell`
  };
}

function parseKickedEntryBonus(effectText = '', conditionText = '') {
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim();
  if (!/this creature was kicked/i.test(condition)) return null;
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^it enters with\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(\+1\/\+1|[-+]?\d+\/[-+]?\d+|[a-z ]+?)\s+counters? on it(?:\s+and with\s+(.+))?$/i);
  if (!match) return null;
  const counterAmount = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 1);
  const counterType = match[2].replace(/\s+/g, '').trim();
  const grantedTraits = match[3] ? extractKeywordTraits(match[3]) : [];
  return {
    type: 'kicked_entry_bonus',
    keywordAction: 'kicker_bonus',
    counterAmount,
    counterType,
    affectedObjects: 'this creature',
    grantedTraits,
    appliesOnEnter: true,
    linkedStatic: true,
    targetCount: { min: 0, max: 0, optional: false },
    label: `If kicked, this creature enters with ${counterAmount} ${counterType} counter(s)${grantedTraits.length ? ` and ${grantedTraits.join(', ')}` : ''}`
  };
}



function parseStaticSpellCostModifier(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  let match = text.match(/^spells you cast that share a card type with the exiled card cost\s+(\{[^}]+\})\s+less to cast$/i);
  if (match) {
    const costDelta = match[1].trim();
    return {
      type: 'spell_cost_modifier',
      modifierMode: 'reduce',
      costDelta,
      appliesToText: 'spells sharing a card type with the exiled card',
      appliesTo: ['Spell'],
      exiledCardTypeRef: true,
      affectedPlayers: 'you',
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      label: `Spells you cast sharing a card type with the exiled card cost ${costDelta} less to cast`
    };
  }

  match = text.match(/^(creature spells|spells you cast) of the chosen type cost\s+(\{[^}]+\})\s+less to cast$/i);
  if (match) {
    const appliesToText = match[1].trim();
    const costDelta = match[2].trim();
    return {
      type: 'spell_cost_modifier',
      modifierMode: 'reduce',
      costDelta,
      appliesToText: `${appliesToText} of the chosen type`,
      appliesTo: /^creature/i.test(appliesToText) ? ['Creature'] : ['Spell'],
      affectedPlayers: 'you',
      chosenTypeRef: true,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      label: `${appliesToText[0].toUpperCase()}${appliesToText.slice(1)} of the chosen type cost ${costDelta} less to cast`
    };
  }

  match = text.match(/^(?:(white|blue|black|red|green|colorless)\s+)?(.+?)\s+spells? you cast cost\s+(\{[^}]+\})\s+less to cast$/i);
  if (!match) return null;
  const colorWord = (match[1] || '').toLowerCase();
  const spellKindText = match[2].trim();
  const costDelta = match[3].trim();
  const appliesTo = [];
  if (/creature/i.test(spellKindText)) appliesTo.push('Creature');
  if (/artifact/i.test(spellKindText)) appliesTo.push('Artifact');
  if (/enchantment/i.test(spellKindText)) appliesTo.push('Enchantment');
  if (/instant/i.test(spellKindText)) appliesTo.push('Instant');
  if (/sorcery/i.test(spellKindText)) appliesTo.push('Sorcery');
  if (/permanent/i.test(spellKindText)) appliesTo.push('Permanent');
  const colors = colorWord ? [MANA_WORDS[colorWord] || colorWord.toUpperCase()] : [];
  const appliesToText = `${colorWord ? `${colorWord} ` : ''}${spellKindText} spells you cast`.trim();
  return {
    type: 'spell_cost_modifier',
    modifierMode: 'reduce',
    costDelta,
    appliesToText,
    appliesTo: [...new Set(appliesTo.length ? appliesTo : ['Spell'])],
    colors,
    affectedPlayers: 'you',
    linkedStatic: true,
    targetCount: { min: 0, max: 0, optional: false },
    label: `${appliesToText} cost ${costDelta} less to cast`
  };
}

function parseFreeCastFromHand(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(?:you may\s+)?cast\s+(?:a|one)\s+(.+?)\s+with mana value\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+or less from your hand without paying its mana cost$/i);
  if (!match) return null;
  const cardFilterText = match[1].trim();
  const manaValueMax = match[2].toUpperCase() === 'X' ? 'X' : numberFromText(match[2], 0);
  return {
    type: 'free_cast_from_hand',
    sourceZone: 'hand',
    cardFilterText,
    targetFilters: targetFiltersFromText(cardFilterText),
    manaValueMax,
    withoutPayingManaCost: true,
    optional: /\byou may\b/i.test(text),
    targetCount: { min: 0, max: 0, optional: false },
    label: `Cast a ${cardFilterText} with mana value ${manaValueMax} or less from your hand without paying its mana cost`
  };
}

function parseDirectDamageEffect(effectText = '', conditionText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(target creature you control) deals damage equal to its power to (target creature you (?:don't|do not) control)$/i);
  if (!match) return null;
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim();
  const trampleExcess = /trample/i.test(condition) && /excess damage/i.test(condition) && /controller instead/i.test(condition);
  return {
    type: 'direct_damage',
    damageSourceText: match[1].trim(),
    damageTargetText: match[2].trim(),
    damageFormula: 'sourcePower',
    amountFormula: 'sourcePower',
    targetFilters: ['Creature'],
    targetCount: { min: 2, max: 2, optional: false },
    ownerHint: 'mixed',
    trampleExcessToController: trampleExcess,
    label: `${match[1].trim()} deals damage equal to its power to ${match[2].trim()}${trampleExcess ? '; trample excess hits that creature\'s controller' : ''}`
  };
}

function parseAttackRestriction(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(.+?)\s+can't attack\s+(.+)$/i);
  if (!match) return null;
  return {
    type: 'attack_restriction',
    restrictedAttackers: match[1].trim(),
    protectedObjects: match[2].trim(),
    linkedStatic: true,
    targetCount: { min: 0, max: 0, optional: false },
    label: `${match[1].trim()} can't attack ${match[2].trim()}`
  };
}

function parseDoublePowerToughness(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^double the power and toughness of\s+(.+?)(?:\s+until end of turn)?$/i);
  if (!match) return null;
  const affectedObjects = parseAffectedObjects(match[1]) || match[1].trim();
  return {
    type: 'double_pt',
    affectedObjects,
    multiplier: 2,
    duration: /until end of turn/i.test(text) ? 'until-end-of-turn' : '',
    targetFilters: targetFiltersFromText(affectedObjects),
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: ownerHintFromText(affectedObjects),
    label: `Double the power and toughness of ${affectedObjects}${/until end of turn/i.test(text) ? ' until end of turn' : ''}`
  };
}

function parseShuffleSourceIntoLibrary(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^shuffle\s+(it|this card|this creature|[^.]+?)\s+into\s+(?:its|this card's|this creature's)\s+owner's library$/i);
  if (!match) return null;
  return {
    type: 'shuffle_source_into_library',
    affectedObjects: match[1].trim(),
    destination: 'library',
    libraryPlacement: 'shuffle',
    thenShuffle: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Shuffle ${match[1].trim()} into its owner's library`
  };
}

function parseRegenerateEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^regenerate\s+(.+)$/i);
  if (!match) return null;
  const affectedObjects = parseAffectedObjects(match[1]) || match[1].trim();
  return {
    type: 'regenerate',
    affectedObjects,
    targetFilters: targetFiltersFromText(affectedObjects),
    targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
    ownerHint: ownerHintFromText(affectedObjects),
    label: `Regenerate ${affectedObjects}`
  };
}

function parseLifePaymentDraw(effectText = '', triggerText = '', conditionText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const fullText = `${String(triggerText || '').replace(/\s+/g, ' ').trim()}, ${text}`;
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim();
  if (!/postcombat main phases?/i.test(fullText)) return null;
  if (!/may pay x life/i.test(text) || !/draw x cards/i.test(`${text} ${condition}`)) return null;
  const xDefinition = text.match(/where x is (.+?)(?:\.\s*If|\. If|$)/i)?.[1]?.trim() || 'the number of opponents that were dealt combat damage this turn';
  return {
    type: 'life_payment_draw',
    optional: true,
    lifeAmountExpression: 'X',
    drawCountExpression: 'X',
    xDefinition,
    payment: { kind: 'life', amount: 'X', amountExpression: xDefinition },
    resultingAction: { type: 'draw', count: 'X', countExpression: xDefinition },
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Pay X life, then draw X cards (X = ${xDefinition})`
  };
}

function parseCommanderPartnerAbility(text = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^partner\b/i.test(cleaned)) return null;
  return {
    type: 'commander_partner',
    keywordAction: 'partner',
    commanderDeckRule: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'Partner — this card can share commander slots with another partner commander'
  };
}

function parseRepeatRevealToHandLoseLife(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^reveal the top card of your library and put that card into your hand/i.test(text)) return null;
  if (!/you lose life equal to its mana value/i.test(text)) return null;
  return {
    type: 'repeat_reveal_to_hand_lose_life',
    sourceZone: 'library',
    destination: 'hand',
    revealTop: true,
    lifeLossExpression: 'revealed card mana value',
    repeatMode: /repeat this process any number of times/i.test(text) ? 'any-number' : 'once',
    optional: /may repeat/i.test(text),
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'Reveal top card, put it into hand, lose life equal to its mana value; may repeat'
  };
}

function parseBargainAbility(text = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^bargain\b/i.test(cleaned)) return null;
  return {
    type: 'casting_cost_mechanic',
    keywordAction: 'bargain',
    optionalAdditionalCost: {
      kind: 'sacrifice',
      validObjects: ['Artifact', 'Enchantment', 'Token'],
      label: 'Sacrifice an artifact, enchantment, or token'
    },
    appliesOnStack: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'Bargain — may sacrifice an artifact, enchantment, or token as you cast this spell'
  };
}

function parseFlashPermission(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const thisTurn = text.match(/^you may cast spells this turn as though they had flash$/i);
  if (thisTurn) {
    return {
      type: 'flash_permission',
      affectedObjects: 'spells you cast',
      permission: 'cast_as_though_flash',
      duration: 'this-turn',
      linkedStatic: false,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'You may cast spells this turn as though they had flash'
    };
  }
  const staticMatch = text.match(/^you may cast\s+(.+?)\s+as though they had flash$/i);
  if (!staticMatch) return null;
  const affectedObjects = staticMatch[1].trim();
  return {
    type: 'flash_permission',
    affectedObjects,
    permission: 'cast_as_though_flash',
    duration: 'while-on-battlefield',
    linkedStatic: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `You may cast ${affectedObjects} as though they had flash`
  };
}

function parseMillEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(target player|each opponent|each player|you) mills?\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+cards?$/i);
  if (!match) return null;
  const affectedObjects = match[1].trim();
  const count = match[2].toUpperCase() === 'X' ? 'X' : numberFromText(match[2], 1);
  return {
    type: 'mill',
    affectedObjects,
    count,
    countExpression: count === 'X' ? 'X' : '',
    targetFilters: /target player/i.test(affectedObjects) ? ['Player'] : [],
    targetCount: /target player/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
    ownerHint: ownerHintFromText(affectedObjects),
    label: `${affectedObjects} mills ${count} card(s)`
  };
}

function parseReturnToHandCopyOption(effectText = '', conditionText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const text = condition ? `${effect}. If ${condition}` : effect;
  const match = text.match(/^return\s+(target nonland permanent)\s+to its owner's hand\. Then that permanent's controller may sacrifice a land of their choice\. If the player does, they may copy this spell and may choose a new target for that copy$/i);
  if (!match) return null;
  return {
    type: 'return_to_hand_then_copy_option',
    affectedObjects: match[1].trim(),
    destination: 'hand',
    targetFilters: ['Permanent'],
    targetExcludes: ['Land'],
    targetCount: { min: 1, max: 1, optional: false },
    ownerHint: 'any',
    copyOption: {
      offeredTo: 'that permanent\'s controller',
      cost: { kind: 'sacrifice', validObjects: ['Land'], label: 'Sacrifice a land' },
      mayChooseNewTargets: true
    },
    label: 'Return target nonland permanent to hand; its controller may sacrifice a land to copy this spell'
  };
}

function parseImprintExileFromHand(effectText = '', fullText = '') {
  const text = String(effectText || fullText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(?:imprint\s+[—-]\s*)?(?:when this artifact enters,\s*)?you may exile\s+(?:a|one)\s+(.+?)\s+card from your hand$/i);
  if (!match || !/imprint|when this artifact enters/i.test(text)) return null;
  const cardFilterText = match[1].trim();
  return {
    type: 'imprint',
    keywordAction: 'imprint',
    sourceZone: 'hand',
    destination: 'exile',
    cardFilterText,
    optional: true,
    storesLinkedExiledCard: true,
    targetFilters: targetFiltersFromText(cardFilterText),
    targetCount: { min: 0, max: 1, optional: true },
    ownerHint: 'self',
    label: `Imprint — exile a ${cardFilterText} card from your hand`
  };
}

function parseSelfDamageEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(?:it|this land|this permanent|this artifact|this creature) deals\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+damage to you$/i);
  if (!match) return null;
  const amount = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 1);
  return {
    type: 'self_damage',
    amount,
    amountExpression: amount === 'X' ? 'X' : '',
    affectedObjects: 'you',
    damageSourceText: 'this source',
    targetFilters: ['Player'],
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `This source deals ${amount} damage to you`
  };
}

function parseSacrificeSourceEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^sacrifice\s+(this land|this permanent|this artifact|this creature|this enchantment|this card|it)$/i);
  if (!match) return null;
  return {
    type: 'sacrifice_source',
    affectedObjects: match[1].trim(),
    destination: 'graveyard',
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Sacrifice ${match[1].trim()}`
  };
}


function colorWordToManaSymbol(colorWord = '') {
  return MANA_WORDS[String(colorWord || '').toLowerCase()] || '';
}

function parseAlternateExileCastCost(effectText = '', conditionText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const lifeAndExileMatch = text.match(/^you may pay\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+life and exile\s+(?:(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+)?(white|blue|black|red|green|colorless)\s+cards? from your hand rather than pay this spell's mana cost$/i);
  const exileOnlyMatch = text.match(/^you may exile\s+(?:(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+)?(white|blue|black|red|green|colorless)\s+cards? from your hand rather than pay this spell's mana cost$/i)
    || text.match(/^you may exile\s+(?:(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+)?(white|blue|black|red|green|colorless)\s+card from your hand rather than pay this spell's mana cost$/i);
  const match = lifeAndExileMatch || exileOnlyMatch;
  if (!match) return null;
  const lifeAmount = lifeAndExileMatch ? numberFromText(lifeAndExileMatch[1], 1) : 0;
  const countToken = lifeAndExileMatch ? lifeAndExileMatch[2] : match[1];
  const colorWord = (lifeAndExileMatch ? lifeAndExileMatch[3] : match[2]).toLowerCase();
  const cardCount = countToken ? (String(countToken).toUpperCase() === 'X' ? 'X' : numberFromText(countToken, 1)) : 1;
  const manaSymbol = colorWordToManaSymbol(colorWord);
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim();
  return {
    type: 'alternate_cast_cost',
    keywordAction: lifeAmount ? 'alternate-cost-pay-life-exile-card' : 'alternate-cost-exile-card',
    optional: true,
    appliesOnStack: true,
    replacesManaCost: true,
    conditionText: condition,
    alternateCost: {
      kind: lifeAmount ? 'pay_life_and_exile_from_hand' : 'exile_from_hand',
      lifeAmount,
      count: cardCount,
      color: manaSymbol,
      colorWord,
      cardFilterText: `${colorWord} card${cardCount === 1 ? '' : 's'}`,
      sourceZone: 'hand',
      destination: 'exile',
      label: `${lifeAmount ? `Pay ${lifeAmount} life and ` : ''}exile ${cardCount} ${colorWord} card${cardCount === 1 ? '' : 's'} from hand`
    },
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `May ${lifeAmount ? `pay ${lifeAmount} life and ` : ''}exile ${cardCount} ${colorWord} card${cardCount === 1 ? '' : 's'} from hand rather than pay this spell's mana cost${condition ? ` if ${condition}` : ''}`
  };
}

function parseAdditionalCostSacrifice(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^as an additional cost to cast this spell, sacrifice\s+(.+)$/i);
  if (!match) return null;
  const sacrificeText = match[1].trim();
  return {
    type: 'additional_cast_cost',
    costKind: 'sacrifice',
    appliesOnStack: true,
    additionalCost: {
      kind: 'sacrifice',
      affectedObjects: sacrificeText,
      validObjects: targetFiltersFromText(sacrificeText),
      destination: 'graveyard',
      label: `Sacrifice ${sacrificeText}`
    },
    targetFilters: targetFiltersFromText(sacrificeText),
    targetCount: { min: 1, max: 1, optional: false },
    ownerHint: ownerHintFromText(sacrificeText) || 'self',
    label: `Additional cost: sacrifice ${sacrificeText}`
  };
}

function parseCommanderFreeCast(effectText = '', conditionText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim();
  if (!/^you may cast this spell without paying its mana cost$/i.test(text)) return null;
  if (condition && !/control a commander/i.test(condition)) return null;
  return {
    type: 'alternate_cast_cost',
    keywordAction: 'commander-free-cast',
    optional: true,
    appliesOnStack: true,
    withoutPayingManaCost: true,
    replacesManaCost: true,
    conditionText: condition || 'you control a commander',
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'You may cast this spell without paying its mana cost if you control a commander'
  };
}

function parseCastAsThoughFlashThisSpell(effectText = '', conditionText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim();
  if (!/^you may cast this spell as though it had flash$/i.test(text)) return null;
  return {
    type: 'flash_permission',
    affectedObjects: 'this spell',
    permission: 'cast_as_though_flash',
    duration: 'while-casting-this-spell',
    conditionText: condition,
    optional: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `You may cast this spell as though it had flash${condition ? ` if ${condition}` : ''}`
  };
}


function parsePregameBattlefieldStart(effectText = '', conditionText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^you may begin the game with\s+(.+?)\s+on the battlefield with\s+(?:a|an|one)\s+(.+?)\s+counter on it\. If you do, exile\s+(?:a|one)\s+card from your hand$/i);
  if (!match) return null;
  return {
    type: 'pregame_battlefield_start',
    affectedObjects: match[1].trim(),
    destination: 'battlefield',
    counterType: match[2].trim(),
    counterAmount: 1,
    optional: true,
    conditionText: condition,
    additionalCost: {
      kind: 'exile_from_hand',
      count: 1,
      cardFilterText: 'card',
      sourceZone: 'hand',
      destination: 'exile',
      label: 'Exile a card from your hand'
    },
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `May begin the game with ${match[1].trim()} on the battlefield with a ${match[2].trim()} counter, then exile a card from hand`
  };
}

function parseGiftAbility(text = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = cleaned.match(/^gift\s+(?:a|an|one)\s+(tapped\s+)?(.+?)(?:\s*\(|$)/i);
  if (!match) return null;
  const tapped = Boolean(match[1]);
  const giftText = match[2].trim();
  const tokenMatch = cleaned.match(/they create\s+(?:a|an|one)\s+(tapped\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+([^.)]+?)\s+creature token/i);
  return {
    type: 'casting_cost_mechanic',
    keywordAction: 'gift',
    optionalPromise: true,
    appliesOnStack: true,
    gift: {
      tapped,
      token: tokenMatch ? {
        count: 1,
        tapped: Boolean(tokenMatch[1]) || tapped,
        power: numberFromText(tokenMatch[2], 1),
        toughness: numberFromText(tokenMatch[3], 1),
        name: tokenMatch[4].replace(/\b(?:white|blue|black|red|green|colorless)\b/ig, '').trim() || giftText,
        typeLine: `${tokenMatch[4].trim()} Creature Token`
      } : { tapped, name: giftText, typeLine: 'Creature Token' }
    },
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'opponent',
    label: `Gift ${tapped ? 'a tapped ' : 'a '}${giftText}`
  };
}

function parseReturnToHandEffect(effectText = '', conditionText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const normalizedEffect = effect.replace(/\.\s*This ability costs\s+\{[^}]+\}\s+less to activate for each\s+.+$/i, '').trim();
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = normalizedEffect.match(/^return\s+(.+?)\s+to\s+(?:its|their)\s+owner's hand$/i);
  if (!match) return null;
  const affectedObjects = match[1].trim();
  const insteadMatch = condition.match(/gift was promised, instead return\s+(.+?)\s+to\s+(?:its|their)\s+owner's hand/i);
  return {
    type: 'return_to_hand',
    affectedObjects,
    destination: 'hand',
    conditionalAlternate: insteadMatch ? {
      conditionText: 'gift was promised',
      affectedObjects: insteadMatch[1].trim(),
      destination: 'hand',
      targetFilters: targetFiltersFromText(insteadMatch[1])
    } : null,
    targetFilters: targetFiltersFromText(affectedObjects),
    targetExcludes: /nonland/i.test(affectedObjects) ? ['Land'] : [],
    targetCount: { min: 1, max: 1, optional: false },
    ownerHint: ownerHintFromText(affectedObjects),
    label: `Return ${affectedObjects} to its owner's hand${insteadMatch ? `; if gift was promised, return ${insteadMatch[1].trim()} instead` : ''}`
  };
}

function parseNoUntapStepEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(.+?)\s+doesn't untap during your untap step$/i);
  if (!match) return null;
  return {
    type: 'no_untap_step',
    affectedObjects: match[1].trim(),
    linkedStatic: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `${match[1].trim()} doesn't untap during your untap step`
  };
}

function parsePayToUntapSource(effectText = '', triggerText = '', conditionText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^you may pay\s+((?:\{[^}]+\})+)$/i);
  if (!match || !/untap\s+(?:this artifact|this permanent|this creature|this land|it)/i.test(condition)) return null;
  return {
    type: 'pay_to_untap_source',
    optional: true,
    payment: {
      kind: 'mana',
      costText: match[1],
      cost: parseCostText(match[1]),
      label: `Pay ${match[1]}`
    },
    resultingAction: {
      type: 'untap',
      affectedObjects: condition.match(/untap\s+(.+)$/i)?.[1]?.trim() || 'this source'
    },
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `May pay ${match[1]} to untap this source`
  };
}

function parseSourceDealsDamage(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(this creature|this artifact|this permanent|this source|it) deals\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+damage to\s+(.+)$/i);
  if (!match) return null;
  const amount = match[2].toUpperCase() === 'X' ? 'X' : numberFromText(match[2], 1);
  const targetText = match[3].trim();
  if (/^you$/i.test(targetText)) return null;
  return {
    type: 'direct_damage',
    damageSourceText: match[1].trim(),
    damageTargetText: targetText,
    damageFormula: String(amount),
    amount,
    targetFilters: /any target/i.test(targetText) ? ['AnyTarget'] : targetFiltersFromText(targetText),
    targetCount: /target/i.test(targetText) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
    ownerHint: ownerHintFromText(targetText),
    label: `${match[1].trim()} deals ${amount} damage to ${targetText}`
  };
}

function parsePhyrexianManaReminder(fullText = '') {
  const text = String(fullText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^\(?\{([WUBRGC])\/P\}\s+can be paid with either\s+\{([WUBRGC])\}\s+or\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\.?\)?$/i);
  if (!match) return null;
  const symbol = match[1].toUpperCase();
  const life = numberFromText(match[3], 2);
  return {
    type: 'payment_reminder',
    keywordAction: 'phyrexian_mana',
    manaSymbol: `{${symbol}/P}`,
    canPayWith: [{ kind: 'mana', symbols: [symbol] }, { kind: 'life', amount: life }],
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `{${symbol}/P} may be paid with {${symbol}} or ${life} life`
  };
}

function parseTrapAlternateCost(effectText = '', conditionText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^you may pay\s+((?:\{[^}]+\})+)\s+rather than pay this spell's mana cost$/i);
  if (!match) return null;
  return {
    type: 'alternate_cast_cost',
    keywordAction: 'alternate-cost-pay-mana',
    optional: true,
    appliesOnStack: true,
    replacesManaCost: true,
    conditionText: condition,
    alternateCost: {
      kind: 'mana',
      costText: match[1],
      cost: parseCostText(match[1]),
      label: `Pay ${match[1]}`
    },
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `May pay ${match[1]} rather than pay this spell's mana cost${condition ? ` if ${condition}` : ''}`
  };
}

function parseEnterAsCopyEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^you may have\s+(.+?)\s+enter\s+(tapped\s+)?as a copy of\s+(.+)$/i);
  if (!match) return null;
  const affectedObjects = match[1].trim();
  const entersTapped = Boolean(match[2]);
  const copySourceText = match[3].trim();
  return {
    type: 'enter_as_copy',
    affectedObjects,
    entersTapped,
    copySourceText,
    targetFilters: targetFiltersFromText(copySourceText),
    targetCount: { min: 1, max: 1, optional: true },
    ownerHint: ownerHintFromText(copySourceText),
    optional: true,
    label: `${affectedObjects} may enter ${entersTapped ? 'tapped ' : ''}as a copy of ${copySourceText}`
  };
}

function parseChangeTargetEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^change the target of\s+(target spell with a single target|target spell|target ability)$/i);
  if (!match) return null;
  return {
    type: 'choose_new_targets',
    affectedObjects: match[1].trim(),
    targetFilters: /ability/i.test(match[1]) && !/spell/i.test(match[1]) ? ['Ability'] : ['Spell'],
    optional: false,
    targetCount: { min: 1, max: 1, optional: false },
    ownerHint: 'any',
    label: `Change the target of ${match[1].trim()}`
  };
}

function parseMnemonicBetrayalEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^exile all opponents' graveyards\. You may cast spells from among those cards this turn, and mana of any type can be spent to cast them$/i.test(text)) return null;
  return {
    type: 'exile_graveyards_cast_permission',
    affectedObjects: "all opponents' graveyards",
    sourceZone: 'opponents-graveyards',
    destination: 'exile',
    permission: 'cast_from_exile_this_turn',
    manaFlexibility: 'any-type',
    duration: 'this-turn',
    optional: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'opponent',
    label: "Exile all opponents' graveyards; you may cast those cards this turn with mana of any type"
  };
}

function parseDelayedReturnExiledCards(effectText = '', conditionText = '', triggerText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim();
  if (!/^return them to their owners' graveyards$/i.test(text)) return null;
  if (!/those cards remain exiled|remain exiled/i.test(condition) && !/next end step/i.test(triggerText)) return null;
  return {
    type: 'delayed_return_exiled_cards',
    affectedObjects: 'those cards',
    sourceZone: 'exile',
    destination: 'graveyard',
    conditionText: condition,
    triggerText,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'any',
    label: "At the next end step, return remaining exiled cards to their owners' graveyards"
  };
}

function parseExileNamedSource(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^exile\s+(.+)$/i);
  if (!match) return null;
  const affected = match[1].trim();
  if (/\b(target|all|each|cards? from|graveyard|library|hand)\b/i.test(affected)) return null;
  return {
    type: 'exile_source',
    affectedObjects: affected,
    destination: 'exile',
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Exile ${affected}`
  };
}


function parseGainControlSpellEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^gain control of\s+(target noncreature spell|target spell)\.\s*You may choose new targets for it$/i)
    || text.match(/^gain control of\s+(target noncreature spell|target spell)$/i);
  if (!match) return null;
  const affectedObjects = match[1].trim();
  return {
    type: 'gain_control_spell',
    affectedObjects,
    targetFilters: ['Spell'],
    targetExcludes: /noncreature/i.test(affectedObjects) ? ['Creature'] : [],
    mayChooseNewTargets: /choose new targets/i.test(text),
    targetCount: { min: 1, max: 1, optional: false },
    ownerHint: 'opponent',
    label: `Gain control of ${affectedObjects}${/choose new targets/i.test(text) ? ' and choose new targets' : ''}`
  };
}

function parseChooseNewTargetsEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^you may choose new targets for\s+(target spell or ability|target spell|target ability|it)$/i);
  if (!match) return null;
  const affectedObjects = match[1].trim();
  return {
    type: 'choose_new_targets',
    affectedObjects,
    targetFilters: /ability/i.test(affectedObjects) && !/spell/i.test(affectedObjects) ? ['Ability'] : (/spell or ability/i.test(affectedObjects) ? ['Spell', 'Ability'] : ['Spell']),
    optional: true,
    targetCount: { min: 1, max: 1, optional: false },
    ownerHint: 'any',
    label: `Choose new targets for ${affectedObjects}`
  };
}

function parseCounterSpellEffect(effectText = '', conditionText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const fullText = condition ? `${effect}. If ${condition}` : effect;
  const match = effect.match(/^counter\s+(target noncreature spell|target instant or sorcery spell|target (?:white|blue|black|red|green|colorless|multicolored) spell|target spell|that spell)(?:\s+with mana value\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten))?(?:\s+unless its controller pays\s+((?:\{[^}]+\})+))?$/i);
  if (!match) return null;
  const affectedObjects = match[1].trim();
  const manaValueLimit = match[2] ? (String(match[2]).toUpperCase() === 'X' ? 'X' : numberFromText(match[2], 0)) : null;
  const unlessCostText = match[3] || '';
  const exileInstead = /exile it instead of putting it into its owner's graveyard/i.test(fullText);
  const filters = /instant or sorcery/i.test(affectedObjects) ? ['Instant', 'Sorcery', 'Spell'] : ['Spell'];
  const colorFilter = affectedObjects.match(/target\s+(white|blue|black|red|green|colorless|multicolored)\s+spell/i)?.[1] || '';
  const refersToStackObject = /^that spell$/i.test(affectedObjects);
  return {
    type: 'counter_spell',
    affectedObjects,
    targetFilters: refersToStackObject ? [] : filters,
    colorFilter,
    targetExcludes: /noncreature/i.test(affectedObjects) ? ['Creature'] : [],
    manaValueLimit,
    unlessCostText,
    unlessCost: unlessCostText ? parseCostText(unlessCostText) : null,
    replacementDestination: exileInstead ? 'exile' : 'graveyard',
    exileInstead,
    targetCount: refersToStackObject ? { min: 0, max: 0, optional: false } : { min: 1, max: 1, optional: false },
    ownerHint: 'opponent',
    label: `Counter ${affectedObjects}${manaValueLimit !== null ? ` with mana value ${manaValueLimit}` : ''}${unlessCostText ? ` unless its controller pays ${unlessCostText}` : ''}${exileInstead ? '; exile it instead of graveyard' : ''}`
  };
}

function parseNamedCardConsultation(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^choose a card name\. Exile the top six cards of your library, then reveal cards from the top of your library until you reveal a card with the chosen name\. Put that card into your hand and exile all other cards revealed this way$/i.test(text)) return null;
  return {
    type: 'named_card_consultation',
    choiceKind: 'card_name',
    exileTopCount: 6,
    sourceZone: 'library',
    revealUntil: 'chosen-name',
    foundDestination: 'hand',
    otherRevealedDestination: 'exile',
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'Choose a card name, exile top six, reveal until chosen card, put it into hand and exile the rest'
  };
}

function parseExtraTurnEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^take an extra turn after this one$/i.test(text)) return null;
  return {
    type: 'extra_turn',
    turnPlacement: 'after-this-one',
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'Take an extra turn after this one'
  };
}

function parseLoseGameEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^you lose the game$/i.test(text)) return null;
  return {
    type: 'lose_game',
    affectedObjects: 'you',
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'You lose the game'
  };
}


function parseReplacementDiscardLandEnter(effectText = '', conditionText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/would enter/i.test(condition)) return null;
  const match = effect.match(/^you may discard a land card instead\. If you do, put (?:this artifact|it) onto the battlefield\. If you don't, put it into its owner's graveyard$/i);
  if (!match) return null;
  return {
    type: 'entry_replacement_discard_or_graveyard',
    optional: true,
    replacementEvent: condition,
    payment: {
      kind: 'discard',
      affectedObjects: 'a land card',
      sourceZone: 'hand',
      label: 'Discard a land card'
    },
    successDestination: 'battlefield',
    failureDestination: 'graveyard',
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'As this enters, discard a land card or put it into its owner\'s graveyard'
  };
}

function parseCumulativeUpkeepAbility(text = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = cleaned.match(/^cumulative upkeep\s+(.+)$/i);
  if (!match) return null;
  const costText = match[1].trim();
  return {
    type: 'upkeep_cost_mechanic',
    keywordAction: 'cumulative_upkeep',
    costText,
    cost: parseCostText(costText),
    putsAgeCounter: true,
    repeatsPerAgeCounter: true,
    sacrificeUnlessPaid: true,
    triggerText: 'At the beginning of your upkeep',
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Cumulative upkeep ${costText}`
  };
}

function parseSkipStepEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^skip your\s+(.+?)\s+step$/i);
  if (!match) return null;
  return {
    type: 'skip_step',
    affectedStep: match[1].trim().toLowerCase(),
    linkedStatic: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Skip your ${match[1].trim()} step`
  };
}

function parseDiscardedCardExileEffect(effectText = '', triggerText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^exile that card from your graveyard$/i.test(text)) return null;
  if (triggerText && !/discard/i.test(triggerText)) return null;
  return {
    type: 'exile_discarded_card_from_graveyard',
    affectedObjects: 'that discarded card',
    sourceZone: 'graveyard',
    destination: 'exile',
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'Whenever you discard a card, exile that card from your graveyard'
  };
}

function parseDelayedTopCardToHand(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^exile the top card of your library face down\. Put that card into your hand at the beginning of your next end step$/i);
  if (!match) return null;
  return {
    type: 'delayed_top_card_to_hand',
    sourceZone: 'library',
    exileCount: 1,
    faceDown: true,
    delayedDestination: 'hand',
    delayedTriggerText: 'At the beginning of your next end step',
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'Exile the top card face down, then put it into your hand at your next end step'
  };
}

function parseSpellCastingRestriction(effectText = '', conditionText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const thisTurnMatch = effect.match(/^(target player|your opponents?|opponents?) can't cast\s+(.+?)\s+this turn$/i);
  if (thisTurnMatch) {
    const affectedObjects = thisTurnMatch[1].trim();
    const spellFilterText = thisTurnMatch[2].trim();
    const conditionalCombatLock = /creatures can't attack this turn/i.test(condition) ? {
      type: 'attack_restriction',
      affectedObjects: 'creatures',
      duration: 'this-turn',
      conditionText: 'this spell was kicked',
      label: 'If kicked, creatures can\'t attack this turn'
    } : null;
    return {
      type: 'spell_casting_restriction',
      affectedObjects,
      spellFilterText,
      duration: 'this-turn',
      conditionalAdditionalEffect: conditionalCombatLock,
      targetFilters: /^target player$/i.test(affectedObjects) ? ['Player'] : [],
      targetCount: /^target player$/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: /^target player$/i.test(affectedObjects) ? 'any' : 'opponent',
      label: `${affectedObjects} can't cast ${spellFilterText} this turn${conditionalCombatLock ? '; if kicked, creatures can\'t attack this turn' : ''}`
    };
  }
  const staticMatch = effect.match(/^(each opponent|opponents?|target player) can't cast\s+(.+)$/i);
  if (!staticMatch) return null;
  const affectedObjects = staticMatch[1].trim();
  const spellFilterText = staticMatch[2].trim();
  const manaValueGreaterThanLands = spellFilterText.match(/^(.+?)\s+with mana value greater than the number of lands that player controls$/i);
  return {
    type: 'spell_casting_restriction',
    affectedObjects,
    spellFilterText,
    duration: 'while-on-battlefield',
    linkedStatic: true,
    restrictionFormula: manaValueGreaterThanLands ? 'manaValueGreaterThanLandsControlled' : '',
    targetFilters: /^target player$/i.test(affectedObjects) ? ['Player'] : [],
    targetCount: /^target player$/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
    ownerHint: /^target player$/i.test(affectedObjects) ? 'any' : 'opponent',
    label: `${affectedObjects} can't cast ${spellFilterText}`
  };
}

function parseDelayedPaymentLoseGame(effectText = '', conditionText = '', triggerText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = effect.match(/^pay\s+((?:\{[^}]+\})+)$/i);
  if (!match) return null;
  if (!/lose the game/i.test(condition) && !/next upkeep/i.test(triggerText)) return null;
  return {
    type: 'delayed_payment_or_lose_game',
    payment: {
      kind: 'mana',
      costText: match[1],
      cost: parseCostText(match[1]),
      label: `Pay ${match[1]}`
    },
    failureAction: { type: 'lose_game', affectedObjects: 'you' },
    triggerText,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `At your next upkeep, pay ${match[1]} or lose the game`
  };
}

function parseExileTopPlayThisTurn(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^exile the top card of your library\. You may play that card this turn$/i)
    || text.match(/^exile the top card of (?:that player|target player)'s library\. Until end of turn, you may cast that card$/i);
  if (!match) return null;
  return {
    type: 'exile_top_play_permission',
    sourceZone: 'library',
    exileCount: 1,
    permission: /cast that card/i.test(text) ? 'cast_exiled_card_this_turn' : 'play_exiled_card_this_turn',
    duration: 'this-turn',
    optional: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: /that player|target player/i.test(text) ? 'opponent' : 'self',
    label: /cast that card/i.test(text)
      ? 'Exile the top card of that player\'s library; you may cast it this turn'
      : 'Exile the top card of your library; you may play it this turn'
  };
}

function parseDashAbility(text = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = cleaned.match(/^dash\s+((?:\{[^}]+\})+)$/i);
  if (!match) return null;
  return {
    type: 'alternate_cast_cost',
    keywordAction: 'dash',
    optional: true,
    appliesOnStack: true,
    alternateCost: {
      kind: 'mana',
      costText: match[1],
      cost: parseCostText(match[1]),
      label: `Dash ${match[1]}`
    },
    grants: [{ type: 'grant_trait', trait: 'Haste', duration: 'until-end-of-turn' }],
    delayedReturn: {
      triggerText: 'At the beginning of the next end step',
      destination: 'hand',
      ownerHint: 'owner'
    },
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Dash ${match[1]} — cast for dash cost, gain haste, return to owner's hand next end step`
  };
}


function parseReturnGraveyardPermanentToBattlefield(effectText = '', conditionText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = effect.match(/^return\s+(target permanent card(?: with mana value\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+or less)?)\s+from your graveyard to the battlefield$/i);
  if (!match) return null;
  const manaValueMax = match[2] ? (String(match[2]).toUpperCase() === 'X' ? 'X' : numberFromText(match[2], 0)) : null;
  return {
    type: 'return_from_graveyard_to_battlefield',
    affectedObjects: match[1].trim(),
    sourceZone: 'graveyard',
    destination: 'battlefield',
    manaValueMax,
    targetFilters: ['Permanent'],
    targetCount: { min: 1, max: 1, optional: false },
    ownerHint: 'self',
    conditionalCopy: /cast from a graveyard/i.test(condition) ? {
      conditionText: 'this spell was cast from a graveyard',
      mayCopy: true,
      mayChooseNewTarget: /choose a new target/i.test(condition)
    } : null,
    optional: /cast from a graveyard/i.test(condition),
    label: `Return ${match[1].trim()} from your graveyard to the battlefield${/cast from a graveyard/i.test(condition) ? '; if cast from graveyard, you may copy it' : ''}`
  };
}

function parseEntryPayLifeOrTapped(effectText = '', conditionText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const amountPattern = '(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)';
  let match = effect.match(new RegExp(`^as (this land|this permanent) enters, you may pay\s+${amountPattern}\s+life$`, 'i'));
  let affectedObjects = match?.[1] || 'this land';

  // Named land/permanent variants can be split by the clause parser into:
  //   Effect: "As The Black Gate enters, you may pay 3 life"
  //   Condition: "you don't, it enters tapped"
  // The older matcher only accepted "this land", so named MDFC/legendary lands leaked as unknowns.
  if (!match) {
    match = effect.match(new RegExp(`^as (.+?) enters, you may pay\s+${amountPattern}\s+life$`, 'i'));
    affectedObjects = match?.[1] || affectedObjects;
  }

  if (!match || !/enters tapped/i.test(condition)) return null;
  const amountToken = match[2] || match[1];
  const lifeAmount = numberFromText(amountToken, 1);
  return {
    type: 'entry_replacement_pay_life_or_tapped',
    affectedObjects,
    optional: true,
    payment: { kind: 'life', amount: lifeAmount, label: `Pay ${lifeAmount} life` },
    failureAction: { type: 'entry_modifier', entersTapped: true, affectedObjects },
    appliesOnEnter: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `As ${affectedObjects} enters, you may pay ${lifeAmount} life; if you don't, it enters tapped`
  };
}

function parseTaxedTriggerToken(effectText = '', conditionText = '', triggerText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = effect.match(/^(that player|target player|its controller|that spell's controller) may pay\s+((?:\{[^}]+\})+)$/i);
  if (!match || !/create\s+a\s+treasure token/i.test(condition)) return null;
  return {
    type: 'taxed_trigger_token',
    taxedPlayer: match[1].trim(),
    payment: { kind: 'mana', costText: match[2], cost: parseCostText(match[2]), label: `Pay ${match[2]}` },
    failureAction: {
      type: 'create_token',
      token: { count: 1, name: 'Treasure', typeLine: 'Artifact Token', traits: [] }
    },
    triggerText,
    optional: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'opponent',
    label: `${match[1].trim()} may pay ${match[2]}; if they don't, create a Treasure token`
  };
}

function parseTaintedPactEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^exile the top card of your library\. You may put that card into your hand unless it has the same name as another card exiled this way\. Repeat this process until you put a card into your hand or you exile two cards with the same name, whichever comes first$/i.test(text)) return null;
  return {
    type: 'tainted_pact_loop',
    sourceZone: 'library',
    repeat: true,
    exileCountEachIteration: 1,
    mayPutCardIntoHand: true,
    stopConditions: ['card-put-into-hand', 'duplicate-name-exiled'],
    destination: 'hand-or-exile',
    optional: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'Exile top cards one at a time; you may put one into hand unless it duplicates a card exiled this way'
  };
}

function parseThassasOracleEffect(effectText = '', conditionText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = effect.match(/^look at the top X cards of your library, where X is your devotion to (white|blue|black|red|green)\. Put up to one of them on top of your library and the rest on the bottom of your library in a random order$/i);
  if (!match) return null;
  const colorWord = match[1].toLowerCase();
  return {
    type: 'look_top_devotion_or_win',
    sourceZone: 'library',
    lookCount: 'X',
    xDefinition: `devotion to ${colorWord}`,
    devotionColor: colorWordToManaSymbol(colorWord),
    mayPutOneOnTop: true,
    restDestination: 'bottom-random',
    winCondition: /greater than or equal to the number of cards in your library.*win the game/i.test(condition) ? {
      formula: 'devotionGteLibraryCount',
      label: 'If X is greater than or equal to the number of cards in your library, you win the game'
    } : null,
    optional: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Look at top X where X is devotion to ${colorWord}; put up to one on top; if X >= library count, win the game`
  };
}

function parseGraveyardEscapeGrant(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^each\s+(.+?)\s+in your graveyard has escape\. The escape cost is equal to the card's mana cost plus exile\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+other cards from your graveyard$/i);
  if (!match) return null;
  const exileCount = numberFromText(match[2], 3);
  return {
    type: 'grant_escape',
    affectedObjects: `${match[1].trim()} in your graveyard`,
    sourceZone: 'graveyard',
    keywordAction: 'escape',
    linkedStatic: true,
    escapeCost: {
      base: 'card-mana-cost',
      additionalCost: { kind: 'exile_from_graveyard', count: exileCount, excludeSelf: true, label: `Exile ${exileCount} other cards from your graveyard` }
    },
    permission: 'cast_from_graveyard',
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Each ${match[1].trim()} in your graveyard has escape for its mana cost plus exile ${exileCount} other cards`
  };
}

function parseEntryCountersSelf(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(this artifact|this creature|this permanent|this land|this enchantment) enters with\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(.+?)\s+counters? on it$/i);
  if (!match) return null;
  const amount = numberFromText(match[2], 1);
  return {
    type: 'entry_counters',
    affectedObjects: match[1].trim(),
    counterAmount: amount,
    counterType: match[3].trim(),
    appliesOnEnter: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `${match[1].trim()} enters with ${amount} ${match[3].trim()} counter(s)`
  };
}


function parsePayThenTokenCopy(effectText = '', conditionText = '', triggerText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = effect.match(/^you may pay\s+((?:\{[^}]+\})+)$/i);
  if (!match || !/create a token that's a copy of it/i.test(condition)) return null;
  const robotMatch = condition.match(/token isn't a creature, it becomes a\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+?)\s+creature in addition to its other types/i);
  return {
    type: 'pay_to_create_token_copy',
    optional: true,
    payment: { kind: 'mana', costText: match[1], cost: parseCostText(match[1]), label: `Pay ${match[1]}` },
    resultingAction: {
      type: 'create_token_copy',
      copyOf: 'triggered artifact',
      nonCreatureBecomes: robotMatch ? {
        power: numberFromText(robotMatch[1], 0),
        toughness: numberFromText(robotMatch[2], 0),
        typeLineAddition: `${robotMatch[3].trim()} Creature`
      } : null
    },
    triggerText,
    conditionText: condition,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `${match[1]}: create a token copy of the triggered artifact${robotMatch ? `; noncreature copy becomes ${numberFromText(robotMatch[1], 0)}/${numberFromText(robotMatch[2], 0)} ${robotMatch[3].trim()} creature` : ''}`
  };
}

function parseMassSacrificeEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(each player|target player|each opponent|you) sacrifices?\s+(.+)$/i);
  if (!match) return null;
  const affectedPlayer = match[1].trim();
  const sacrificeText = match[2].trim();
  return {
    type: 'sacrifice_permanents',
    affectedPlayer,
    affectedObjects: sacrificeText,
    targetFilters: targetFiltersFromText(sacrificeText).length ? targetFiltersFromText(sacrificeText) : ['Permanent'],
    colorRequirement: /one or more colors|colored/i.test(sacrificeText) ? 'colored' : '',
    destination: 'graveyard',
    targetCount: /target player/i.test(affectedPlayer) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
    ownerHint: ownerHintFromText(affectedPlayer),
    label: `${affectedPlayer} sacrifices ${sacrificeText}`
  };
}

function parseReturnGraveyardCardToHand(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^return\s+((?:another\s+)?target\s+.+?\s+card)\s+from your graveyard to your hand$/i);
  if (!match) return null;
  const affectedObjects = match[1].trim();
  return {
    type: 'return_from_graveyard_to_hand',
    affectedObjects,
    sourceZone: 'graveyard',
    destination: 'hand',
    targetFilters: targetFiltersFromText(affectedObjects),
    targetCount: { min: 1, max: 1, optional: false },
    ownerHint: 'self',
    label: `Return ${affectedObjects} from your graveyard to your hand`
  };
}

function parseChooseCardType(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^as this (?:artifact|permanent|enchantment) enters, choose\s+(.+)$/i);
  if (!match) return null;
  const options = match[1]
    .replace(/\s+or\s+/i, ', ')
    .split(/,/) 
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^and\s+/i, ''));
  const cardTypeOptions = options.filter((part) => /^(artifact|creature|enchantment|instant|sorcery|land|planeswalker|battle)$/i.test(part));
  if (!cardTypeOptions.length) return null;
  return {
    type: 'choose_card_type',
    choiceKind: 'card_type',
    options: cardTypeOptions.map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase()),
    storesChoiceOnPermanent: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Choose card type: ${cardTypeOptions.join(', ')}`
  };
}

function parseCommanderZoneToHand(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^put your commander into your hand from the command zone$/i.test(text)) return null;
  return {
    type: 'move_commander_to_hand',
    affectedObjects: 'your commander',
    sourceZone: 'command',
    destination: 'hand',
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'Put your commander into your hand from the command zone'
  };
}

function parseMoveCounterEffect(effectText = '', conditionText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const normalized = text.replace(/\.\s*Activate only$/i, '').trim();
  const match = normalized.match(/^move\s+(?:a|an|one)\s+(.+?)\s+counter from\s+(.+?)\s+onto\s+(.+)$/i);
  if (!match) return null;
  const counterType = match[1].trim();
  const fromText = match[2].trim();
  const toText = match[3].trim();
  return {
    type: 'move_counter',
    counterType,
    counterAmount: 1,
    fromText,
    toText,
    targetFilters: targetFiltersFromText(toText),
    targetCount: /target/i.test(toText) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
    conditionText: String(conditionText || '').replace(/\s+/g, ' ').trim(),
    ownerHint: ownerHintFromText(toText),
    label: `Move a ${counterType} counter from ${fromText} onto ${toText}`
  };
}

function parseTriggeredAbilityExtraTrigger(effectText = '', conditionText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim();
  if (!/^(?:that ability|it) triggers an additional time$/i.test(effect)) return null;
  return {
    type: 'trigger_doubling',
    linkedStatic: true,
    affectedObjects: condition || 'triggered ability',
    extraTriggers: 1,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `${condition || 'That triggered ability'} triggers an additional time`
  };
}

function parseCopyTriggeredSpell(effectText = '', triggerText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^copy it(?:\. You may choose new targets for the copy)?$/i);
  if (!match) return null;
  return {
    type: 'copy_spell',
    affectedObjects: 'triggered spell',
    mayChooseNewTargets: /choose new targets/i.test(text),
    triggerText,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Copy the triggered spell${/choose new targets/i.test(text) ? ' and you may choose new targets' : ''}`
  };
}

function parseProtectionGrant(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(.+?)\s+gains?\s+protection from\s+(.+?)(?:\s+until end of turn)?$/i);
  if (!match) return null;
  const affectedObjects = parseAffectedObjects(match[1]) || match[1].trim();
  const protectionFrom = match[2].trim();
  return {
    type: 'grant_protection',
    affectedObjects,
    protectionFrom,
    duration: /until end of turn/i.test(text) ? 'until-end-of-turn' : '',
    targetFilters: targetFiltersFromText(affectedObjects),
    targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
    ownerHint: ownerHintFromText(affectedObjects),
    label: `${affectedObjects} gains protection from ${protectionFrom}${/until end of turn/i.test(text) ? ' until end of turn' : ''}`
  };
}

function parseOverloadAbility(text = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = cleaned.match(/^overload\s+((?:\{[^}]+\})+)/i);
  if (!match) return null;
  return {
    type: 'alternate_cast_cost',
    keywordAction: 'overload',
    optional: true,
    appliesOnStack: true,
    alternateCost: { kind: 'mana', costText: match[1], cost: parseCostText(match[1]), label: `Overload ${match[1]}` },
    textReplacement: { from: 'target', to: 'each' },
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Overload ${match[1]} — cast for overload cost and change target to each`
  };
}

function parseRevealShuffleInstead(effectText = '', conditionText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim();
  const match = effect.match(/^reveal\s+(.+?)\s+and shuffle it into its owner's library instead$/i);
  if (!match) return null;
  return {
    type: 'replacement_shuffle_into_library',
    affectedObjects: match[1].trim(),
    destination: 'library',
    libraryPlacement: 'shuffle',
    reveal: true,
    replacement: true,
    conditionText: condition,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `If ${condition || 'this would go to a graveyard'}, reveal ${match[1].trim()} and shuffle it into its owner's library instead`
  };
}


function parseTopLibraryLookSelect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  let match = text.match(/^look at the top\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards? of your library,\s+where x is\s+(.+?)\.\s+put one of those cards into your hand and the rest on the bottom of your library in a random order$/i);
  if (match) {
    const topCount = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 1);
    const xDefinition = match[2].trim();
    return {
      type: 'top_library_select_to_hand',
      topCount,
      topCountFormula: topCount === 'X' ? `count:${normalizeCountSubject(xDefinition)}` : '',
      xDefinition,
      sourceZone: 'library',
      destination: 'hand',
      restDestination: 'bottom-random',
      chooseCount: 1,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Look at top ${topCount} where X is ${xDefinition}; put one into hand and rest on bottom randomly`
    };
  }

  match = text.match(/^look at the top\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards? of your library,\s+where x is\s+(.+?)\.\s+you may cast\s+(?:a|one)\s+(.+?)\s+with mana value\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+or less from among them without paying its mana cost\.\s+put the rest on the bottom of your library in a random order$/i);
  if (match) {
    const topCount = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 1);
    const xDefinition = match[2].trim();
    const cardFilterText = match[3].trim();
    const manaValueMax = match[4].toUpperCase() === 'X' ? 'X' : numberFromText(match[4], 0);
    return {
      type: 'top_library_free_cast',
      topCount,
      topCountFormula: topCount === 'X' ? `count:${normalizeCountSubject(xDefinition)}` : '',
      xDefinition,
      sourceZone: 'library',
      cardFilterText,
      targetFilters: targetFiltersFromText(cardFilterText),
      manaValueMax,
      withoutPayingManaCost: true,
      restDestination: 'bottom-random',
      optional: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Look at top ${topCount} where X is ${xDefinition}; may cast ${cardFilterText} MV ${manaValueMax} or less for free`
    };
  }

  return null;
}

function parseDynamicPowerToughnessSet(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(.+?)'s power and toughness are each equal to\s+(.+)$/i);
  if (!match) return null;
  const affectedObjects = match[1].trim();
  const definition = match[2].trim();
  return {
    type: 'set_pt_dynamic',
    affectedObjects,
    powerFormula: definition,
    toughnessFormula: definition,
    linkedStatic: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `${affectedObjects}'s P/T are each equal to ${definition}`
  };
}

function parseCantBeBlockedThisTurn(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(.+?)\s+can't be blocked this turn$/i);
  if (!match) return null;
  const affectedObjects = parseAffectedObjects(match[1]) || match[1].trim();
  return {
    type: 'blocking_restriction',
    affectedObjects,
    restrictedBlockers: 'all creatures',
    duration: 'until-end-of-turn',
    targetFilters: targetFiltersFromText(affectedObjects),
    targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
    ownerHint: ownerHintFromText(affectedObjects),
    label: `${affectedObjects} can't be blocked this turn`
  };
}

function parsePayThenDraw(effectText = '', conditionText = '', triggerText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = effect.match(/^you may pay\s+((?:\{[^}]+\})+)$/i);
  if (!match || !/\byou do,\s*draw\s+(?:a|one)\s+card\b/i.test(condition)) return null;
  return {
    type: 'pay_to_draw',
    optional: true,
    payment: { kind: 'mana', costText: match[1], cost: parseCostText(match[1]), label: `Pay ${match[1]}` },
    resultingAction: { type: 'draw', count: 1, label: 'Draw a card' },
    triggerText,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `May pay ${match[1]} to draw a card`
  };
}

function parseCopyUntilEndOfTurn(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(.+?)\s+becomes a copy of\s+(.+?)\s+until end of turn$/i);
  if (!match) return null;
  const affectedObjects = parseAffectedObjects(match[1]) || match[1].trim();
  const copySourceText = match[2].trim();
  return {
    type: 'become_copy_until_eot',
    affectedObjects,
    copySourceText,
    targetFilters: targetFiltersFromText(copySourceText),
    duration: 'until-end-of-turn',
    targetCount: /target/i.test(copySourceText) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
    ownerHint: ownerHintFromText(copySourceText),
    label: `${affectedObjects} becomes a copy of ${copySourceText} until end of turn`
  };
}

function parseStartEnginesAbility(text = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^start your engines!?\b/i.test(cleaned)) return null;
  return {
    type: 'keyword_action',
    keywordAction: 'start_your_engines',
    speed: { startsAt: 1, increasesWhen: 'opponent loses life once on each of your turns', max: 4 },
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'Start your engines — initialize/increase speed up to max speed 4'
  };
}

function parseTopLibraryLookPermission(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^you may look at the top card of your library any time$/i.test(text)) return null;
  return {
    type: 'top_library_look_permission',
    sourceZone: 'library',
    topCount: 1,
    linkedStatic: true,
    optional: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'You may look at the top card of your library any time'
  };
}

function parseTopLibraryCastPermission(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^you may cast\s+(.+?)\s+from the top of your library$/i);
  if (!match) return null;
  const cardFilterText = match[1].trim();
  return {
    type: 'top_library_cast_permission',
    sourceZone: 'library',
    permission: 'cast_from_top_of_library',
    cardFilterText,
    targetFilters: targetFiltersFromText(cardFilterText),
    linkedStatic: true,
    optional: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `You may cast ${cardFilterText} from the top of your library`
  };
}

function parseExileTopCardEffect(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^exile the top card of your library$/i.test(text)) return null;
  return {
    type: 'exile_top_card',
    sourceZone: 'library',
    destination: 'exile',
    topCount: 1,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: 'Exile the top card of your library'
  };
}

function parsePutCreatureFromGraveyardToBattlefield(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^put\s+(target creature card from a graveyard)\s+onto the battlefield under your control(?:\.\s*It's\s+(.+?)\s+in addition to its other types)?$/i);
  if (!match) return null;
  return {
    type: 'reanimate_from_graveyard',
    affectedObjects: match[1].trim(),
    sourceZone: 'graveyard',
    destination: 'battlefield',
    controller: 'you',
    addedTypes: match[2]?.trim() || '',
    targetFilters: ['Creature', 'Card'],
    targetCount: { min: 1, max: 1, optional: false },
    ownerHint: 'any',
    label: `Put ${match[1].trim()} onto the battlefield under your control${match[2] ? `; it is ${match[2].trim()} too` : ''}`
  };
}

function parseChooseColorAddManaForSacrificedArtifacts(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^choose a color\.\s*target player adds\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+mana of the chosen color for each artifact sacrificed this way$/i);
  if (!match) return null;
  const perArtifact = numberFromText(match[1], 3);
  return {
    type: 'add_mana',
    producedMana: ['ANY'],
    producedManaLabel: `${perArtifact}× chosen color for each sacrificed artifact`,
    colorMode: 'chosen-color',
    amountFormula: `count:sacrificed-artifacts*this:${perArtifact}`,
    amountLabel: `${perArtifact} mana per artifact sacrificed this way`,
    targetFilters: ['Player'],
    targetCount: { min: 1, max: 1, optional: false },
    ownerHint: 'any',
    label: `Choose a color; target player adds ${perArtifact} mana of that color for each artifact sacrificed this way`
  };
}

function parseChosenTypeAddition(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const match = text.match(/^(this creature|this artifact|this permanent|this source) is the chosen type in addition to its other types$/i);
  if (!match) return null;
  return {
    type: 'chosen_type_addition',
    affectedObjects: match[1].trim(),
    chosenTypeRef: true,
    linkedStatic: true,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `${match[1].trim()} is the chosen type in addition to its other types`
  };
}


function parsePatch19YunaFinalSpecificAction(effectText = '', conditionText = '', triggerText = '', originalText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const trigger = String(triggerText || '').replace(/\s+/g, ' ').trim();
  const fullText = String(originalText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const actions = [];
  let match;

  match = fullText.match(/^impending\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*[—-]\s*((?:\{[^}]+\})+)/i)
    || effect.match(/^impending\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*[—-]\s*((?:\{[^}]+\})+)/i);
  if (match) {
    const timeCounters = numberFromText(match[1], 0);
    const costText = match[2];
    actions.push({
      type: 'alternate_cast_cost',
      keywordAction: 'impending',
      optional: true,
      alternateCost: { kind: 'mana', costText, cost: parseCostText(costText), label: `Impending ${timeCounters}—${costText}` },
      entryCounters: { counterType: 'time', counterAmount: timeCounters },
      temporaryTypeLoss: 'Creature until the last time counter is removed',
      delayedCounterRemoval: { timing: 'beginning of your end step', counterType: 'time', counterAmount: 1 },
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Impending ${timeCounters}—${costText}: enters with ${timeCounters} time counter(s) and is not a creature until the last is removed`
    });
  }

  match = effect.match(/^remove (?:a|one|1) (.+?) counter from it[.)]*$/i);
  if (match && /beginning of your end step/i.test(trigger)) {
    const counterType = match[1].trim();
    actions.push({
      type: 'remove_counters',
      counterType,
      counterAmount: 1,
      affectedObjects: 'it',
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `At your end step, remove a ${counterType} counter from it`
    });
  }

  match = effect.match(/^put (?:a|one|1) (.+?) counter on target (.+)$/i);
  if (match) {
    const counterType = match[1].trim();
    const affectedObjects = `target ${match[2].trim()}`;
    actions.push({
      type: 'add_counters',
      counterType,
      counterAmount: 1,
      affectedObjects,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'any',
      label: `Put a ${counterType} counter on ${affectedObjects}`
    });
  }

  match = effect.match(/^you may return target (.+?) card from your graveyard to the battlefield$/i)
    || effect.match(/^return target (.+?) card from your graveyard to the battlefield$/i);
  if (match) {
    const cardFilterText = match[1].trim();
    actions.push({
      type: 'return_from_graveyard_to_battlefield',
      affectedObjects: `target ${cardFilterText} card from your graveyard`,
      sourceZone: 'graveyard',
      destination: 'battlefield',
      cardFilterText,
      optional: /^you may/i.test(effect),
      targetFilters: targetFiltersFromText(cardFilterText + ' card'),
      targetCount: { min: 1, max: 1, optional: /^you may/i.test(effect) },
      ownerHint: 'self',
      label: `Return target ${cardFilterText} card from your graveyard to the battlefield`
    });
  }

  match = effect.match(/^each other non-aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value$/i);
  if (match) {
    actions.push({
      type: 'type_and_pt_static',
      affectedObjects: 'each other non-Aura enchantment you control',
      addedTypes: ['Creature'],
      powerFormula: 'mana value',
      toughnessFormula: 'mana value',
      conditionText: condition,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Other non-Aura enchantments you control are creatures with base P/T equal to their mana value'
    });
  }

  match = effect.match(/^(?:iv\s+[—-]\s+mega flare\s+[—-]\s+)?this creature deals damage equal to (.+?) to each opponent$/i);
  if (match) {
    const damageFormulaText = match[1].trim();
    actions.push({
      type: 'direct_damage',
      damageSourceText: 'this creature',
      damageTargetText: 'each opponent',
      damageFormula: `total:${normalizeCountSubject(damageFormulaText)}`,
      amount: 'dynamic',
      amountLabel: damageFormulaText,
      targetFilters: ['Opponent'],
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'opponent',
      label: `This creature deals damage equal to ${damageFormulaText} to each opponent`
    });
  }

  match = effect.match(/^(?:i\s+[—-]\s+)?mill (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards?$/i);
  if (match) {
    const count = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 1);
    actions.push({
      type: 'mill',
      count,
      affectedObjects: 'you',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Mill ${count} card(s)`
    });
  }

  match = effect.match(/^(?:ii\s+[—-]\s+)?return all land cards from your graveyard to the battlefield tapped$/i);
  if (match) {
    actions.push({
      type: 'return_from_graveyard_to_battlefield',
      affectedObjects: 'all land cards from your graveyard',
      sourceZone: 'graveyard',
      destination: 'battlefield-tapped',
      cardFilterText: 'land',
      targetFilters: ['Land', 'Card'],
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Return all land cards from your graveyard to the battlefield tapped'
    });
  }

  if (/^job select$/i.test(effect) || /^job select$/i.test(fullText)) {
    actions.push({
      type: 'keyword_action',
      keywordAction: 'job_select',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Job select'
    });
  }

  match = effect.match(/^equipped creature is a (.+?) in addition to its other types and has "whenever this creature attacks, you may put a creature card from your hand onto the battlefield(?:\. If that card is an enchantment card, it enters tapped and attacking\.?)?"?$/i);
  if (match) {
    const addedType = match[1].trim();
    actions.push({
      type: 'equipped_creature_type_grant',
      affectedObjects: 'equipped creature',
      addedTypes: [addedType],
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Equipped creature is a ${addedType} in addition to its other types`
    });
    actions.push({
      type: 'grant_triggered_ability',
      affectedObjects: 'equipped creature',
      grantedTrigger: 'Whenever this creature attacks',
      grantedAction: {
        type: 'put_from_hand_to_battlefield',
        affectedObjects: 'creature card from your hand',
        sourceZone: 'hand',
        destination: 'battlefield',
        optional: true,
        enchantmentCardModifier: 'enters tapped and attacking'
      },
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Equipped creature has attack trigger to put a creature from hand onto the battlefield'
    });
  }

  match = fullText.match(/^([A-Za-z][A-Za-z' -]+)\s+[—-]\s+Equip\s+((?:\{[^}]+\})+)/i)
    || effect.match(/^([A-Za-z][A-Za-z' -]+)\s+[—-]\s+Equip\s+((?:\{[^}]+\})+)/i);
  if (match) {
    const jobName = match[1].trim();
    const equipCost = match[2];
    actions.push({
      type: 'equip',
      costText: equipCost,
      cost: parseCostText(equipCost),
      jobName,
      targetFilters: ['Creature'],
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'self',
      label: `${jobName} — Equip ${equipCost}`
    });
  }

  match = effect.match(/^if you tap a permanent for mana, it produces (three|two|twice|\d+) times as much of that mana instead$/i)
    || (/tap a permanent for mana/i.test(condition) ? effect.match(/^it produces (three|two|twice|\d+) times as much of that mana instead$/i) : null);
  if (match) {
    const raw = match[1].toLowerCase();
    const multiplier = raw === 'twice' ? 2 : numberFromText(raw, Number(raw) || 1);
    actions.push({
      type: 'mana_replacement_multiplier',
      affectedObjects: 'permanents you tap for mana',
      multiplier,
      linkedStatic: true,
      replacement: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `If you tap a permanent for mana, it produces ${multiplier} times as much mana instead`
    });
  }

  match = effect.match(/^that player skips that turn instead$/i);
  if (match && /opponent would begin an extra turn/i.test(condition)) {
    actions.push({
      type: 'turn_replacement',
      replacement: true,
      affectedObjects: 'opponent extra turn',
      replacedEvent: 'opponent would begin an extra turn',
      replacementEvent: 'skip that turn',
      conditionText: condition,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'opponent',
      label: 'If an opponent would begin an extra turn, that player skips that turn instead'
    });
  }

  match = effect.match(/^as this aura enters, choose a color$/i);
  if (match) {
    actions.push({
      type: 'choose_color',
      choiceKind: 'color',
      affectedObjects: 'this Aura',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'As this Aura enters, choose a color'
    });
  }

  match = effect.match(/^its controller adds an additional (?:one|1) mana of the chosen color$/i);
  if (match && /enchanted forest is tapped for mana/i.test(trigger)) {
    actions.push({
      type: 'mana_bonus_trigger',
      producedMana: ['ANY'],
      producedManaLabel: '{Chosen}',
      colorMode: 'chosen-color',
      amount: 1,
      triggerText: trigger,
      affectedObjects: 'enchanted Forest controller',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'controller',
      label: 'Whenever enchanted Forest is tapped for mana, its controller adds one mana of the chosen color'
    });
  }

  match = effect.match(/^its controller adds an additional ((?:\{[^}]+\})+)$/i);
  if (match && /enchanted land is tapped for mana/i.test(trigger)) {
    const manaText = match[1];
    actions.push({
      type: 'mana_bonus_trigger',
      producedMana: manaSymbolsFromText(manaText),
      producedManaLabel: manaText,
      colorMode: 'fixed',
      amount: 1,
      triggerText: trigger,
      affectedObjects: 'enchanted land controller',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'controller',
      label: `Whenever enchanted land is tapped for mana, its controller adds an additional ${manaText}`
    });
  }

  match = effect.match(/^copy target activated or triggered ability you control from an enchantment source\. You may choose new targets for the copy$/i);
  if (match) {
    actions.push({
      type: 'copy_ability',
      copiedObject: 'target activated or triggered ability you control from an enchantment source',
      mayChooseNewTargets: true,
      excludesManaAbilities: /mana abilities can't be targeted/i.test(fullText),
      targetFilters: ['Ability'],
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'self',
      label: 'Copy target activated or triggered ability from an enchantment source; you may choose new targets'
    });
  }

  return actions;
}


function parsePatch18YunaSpecificAction(effectText = '', conditionText = '', triggerText = '', originalText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const trigger = String(triggerText || '').replace(/\s+/g, ' ').trim();
  const fullText = String(originalText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const actions = [];
  let match;

  match = effect.match(/^enchant\s+(.+)$/i) || fullText.match(/^enchant\s+(.+)$/i);
  if (match) {
    const enchantedObject = match[1].trim();
    actions.push({
      type: 'aura_enchant',
      affectedObjects: enchantedObject,
      auraAttachment: true,
      targetFilters: targetFiltersFromText(enchantedObject),
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: ownerHintFromText(enchantedObject) || 'any',
      label: `Enchant ${enchantedObject}`
    });
  }

  match = effect.match(/^return up to one target (.+?) card from your graveyard to the battlefield with a (.+?) counter on it$/i);
  if (match) {
    const cardFilterText = match[1].trim();
    const counterType = match[2].trim();
    actions.push({
      type: 'return_from_graveyard_to_battlefield',
      affectedObjects: `up to one target ${cardFilterText} card from your graveyard`,
      sourceZone: 'graveyard',
      destination: 'battlefield',
      cardFilterText,
      counterType,
      counterAmount: 1,
      optional: true,
      targetFilters: targetFiltersFromText(cardFilterText + ' card'),
      targetCount: { min: 0, max: 1, optional: true },
      ownerHint: 'self',
      label: `Return up to one target ${cardFilterText} card from your graveyard to the battlefield with a ${counterType} counter`
    });
  }

  match = effect.match(/^return it to the battlefield under its owner's control\. It's (.+)$/i);
  if (match) {
    actions.push({
      type: 'return_source_to_battlefield',
      affectedObjects: 'it',
      sourceZone: 'graveyard',
      destination: 'battlefield',
      controller: 'owner',
      becomesText: match[1].trim(),
      triggerText: trigger,
      conditionText: condition,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Return this source to the battlefield under its owner's control; it is ${match[1].trim()}`
    });
  }

  if (/^rebound\b/i.test(fullText) || /^rebound\b/i.test(effect)) {
    actions.push({
      type: 'casting_cost_mechanic',
      keywordAction: 'rebound',
      delayedCastFromExile: true,
      appliesOnResolution: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Rebound — exile as it resolves, then cast from exile at your next upkeep'
    });
  }

  if (/^you may cast this card from exile without paying its mana cost\.?\)?$/i.test(effect)) {
    actions.push({
      type: 'alternate_cast_permission',
      affectedObjects: 'this card',
      sourceZone: 'exile',
      destination: 'stack',
      withoutPayingManaCost: true,
      optional: true,
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'At your next upkeep, you may cast this card from exile without paying its mana cost'
    });
  }

  match = effect.match(/^its controller adds an additional (?:one|1) mana of any color$/i);
  if (match && /enchanted land is tapped for mana/i.test(trigger)) {
    actions.push({
      type: 'mana_bonus_trigger',
      producedMana: ['ANY'],
      producedManaLabel: '{Any}',
      colorMode: 'any',
      amount: 1,
      triggerText: trigger,
      affectedObjects: 'enchanted land controller',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'controller',
      label: 'Whenever enchanted land is tapped for mana, its controller adds one additional mana of any color'
    });
  }

  match = effect.match(/^as this land enters, you may reveal (.+?) card from your hand$/i);
  if (match && /enters tapped/i.test(condition)) {
    actions.push({
      type: 'entry_modifier',
      entryType: 'tapped-unless-reveal',
      revealChoice: match[1].trim(),
      optional: true,
      unlessClause: `Reveal ${match[1].trim()} card from your hand`,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      linkedStatic: true,
      label: `As this land enters, reveal ${match[1].trim()} card or it enters tapped`
    });
  }

  match = effect.match(/^put target (.+?) card from your graveyard on top of your library$/i);
  if (match) {
    const cardFilterText = match[1].trim();
    actions.push({
      type: 'graveyard_to_library_top',
      affectedObjects: `target ${cardFilterText} card from your graveyard`,
      sourceZone: 'graveyard',
      destination: 'library-top',
      cardFilterText,
      targetFilters: targetFiltersFromText(cardFilterText + ' card'),
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'self',
      label: `Put target ${cardFilterText} card from your graveyard on top of your library`
    });
  }

  match = effect.match(/^(.+?) isn't a creature$/i);
  if (match && /devotion to/i.test(condition)) {
    actions.push({
      type: 'conditional_type_loss',
      affectedObjects: match[1].trim(),
      removedType: 'Creature',
      conditionText: condition,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `${match[1].trim()} isn't a creature while ${condition}`
    });
  }

  match = effect.match(/^put (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) (.+?) counters? on this enchantment$/i);
  if (match) {
    const counterAmount = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 1);
    const counterType = match[2].trim();
    actions.push({
      type: 'add_counters',
      counterType,
      counterAmount,
      affectedObjects: 'this enchantment',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Put ${counterAmount} ${counterType} counter(s) on this enchantment`
    });
  }

  if (/^you win the game$/i.test(effect)) {
    actions.push({
      type: 'win_game',
      affectedObjects: 'you',
      conditionText: condition,
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `You win the game${condition ? ` if ${condition}` : ''}`
    });
  }

  if (/^you may play an additional land on each of your turns$/i.test(effect)) {
    actions.push({
      type: 'additional_land_play',
      amount: 1,
      linkedStatic: true,
      optional: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'You may play one additional land on each of your turns'
    });
  }

  if (/^you may play lands from your graveyard$/i.test(effect)) {
    actions.push({
      type: 'zone_play_permission',
      affectedObjects: 'lands',
      sourceZone: 'graveyard',
      permission: 'play_lands_from_graveyard',
      linkedStatic: true,
      optional: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'You may play lands from your graveyard'
    });
  }

  match = effect.match(/^landfall\s+[—-]\s+whenever a land you control enters, mill a card$/i)
    || fullText.match(/^landfall\s+[—-]\s+whenever a land you control enters, mill a card$/i);
  if (match) {
    actions.push({
      type: 'mill',
      count: 1,
      affectedObjects: 'you',
      triggerText: 'Whenever a land you control enters',
      keywordAbility: 'landfall',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Landfall — mill 1 card'
    });
  }

  match = effect.match(/^choose a color\. Add an amount of mana of that color equal to your devotion to that color$/i);
  if (match) {
    actions.push({
      type: 'add_mana',
      producedMana: ['ANY'],
      producedManaLabel: '{Any} equal to devotion to chosen color',
      colorMode: 'chosen-color',
      amountFormula: 'devotion:chosen-color',
      amountLabel: 'devotion to chosen color',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Choose a color; add mana of that color equal to your devotion to that color'
    });
  }

  match = effect.match(/^double target creature's power and toughness until end of turn$/i)
    || effect.match(/^constellation\s+[—-]\s+whenever .+?, double target creature's power and toughness until end of turn$/i)
    || fullText.match(/^constellation\s+[—-]\s+whenever .+?, double target creature's power and toughness until end of turn$/i);
  if (match) {
    actions.push({
      type: 'double_pt',
      affectedObjects: 'target creature',
      multiplier: 2,
      duration: 'until-end-of-turn',
      keywordAbility: /constellation/i.test(effect + ' ' + fullText) ? 'constellation' : '',
      triggerText: /constellation/i.test(effect + ' ' + fullText) ? 'Whenever this creature or another enchantment you control enters' : trigger,
      targetFilters: ['Creature'],
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'any',
      label: "Double target creature's power and toughness until end of turn"
    });
  }

  match = effect.match(/^this spell costs \{X\} less to cast, where X is (.+)$/i);
  if (match) {
    const xDefinition = match[1].trim();
    actions.push({
      type: 'spell_cost_modifier',
      modifierMode: 'reduce',
      costDelta: '{X}',
      xDefinition,
      amountFormula: `total:${normalizeCountSubject(xDefinition)}`,
      appliesToText: 'this spell',
      appliesTo: ['Spell'],
      affectedPlayers: 'you',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `This spell costs {X} less to cast, where X is ${xDefinition}`
    });
  }

  match = effect.match(/^(this creature|target creature|.+?) gains? (.+?) until end of turn$/i);
  if (match) {
    const affectedObjects = parseAffectedObjects(match[1]) || match[1].trim();
    const traits = extractKeywordTraits(match[2]);
    if (traits.length) {
      for (const trait of traits) {
        actions.push({
          type: 'grant_trait',
          affectedObjects,
          trait,
          duration: 'until-end-of-turn',
          targetFilters: targetFiltersFromText(affectedObjects),
          targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
          ownerHint: ownerHintFromText(affectedObjects) || 'self',
          label: `Grant ${trait} to ${affectedObjects} until end of turn`
        });
      }
    }
  }

  return actions;
}


function parsePatch14SpecificAction(effectText = '', conditionText = '', triggerText = '', originalText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const trigger = String(triggerText || '').replace(/\s+/g, ' ').trim();
  const fullText = String(originalText || '').replace(/\s+/g, ' ').trim();
  const actions = [];

  let match = effect.match(/^return to your hand target artifact card in your graveyard with lesser mana value$/i);
  if (match) {
    actions.push({
      type: 'return_from_graveyard_to_hand',
      affectedObjects: 'target artifact card in your graveyard with lesser mana value',
      sourceZone: 'graveyard',
      destination: 'hand',
      targetFilters: ['Artifact', 'Card'],
      manaValueComparison: 'lesser-than-triggered-artifact',
      triggerText: trigger,
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'self',
      label: 'Return target artifact card with lesser mana value from your graveyard to your hand'
    });
  }

  match = effect.match(/^look at the top (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards? of your library, then put them back in any order$/i);
  if (match) {
    const topCount = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 1);
    actions.push({
      type: 'top_library_reorder',
      sourceZone: 'library',
      topCount,
      destination: 'library-top',
      orderChoice: 'any',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Look at the top ${topCount} card(s), then put them back in any order`
    });
  }

  match = effect.match(/^you lose (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) life for each (.+)$/i);
  if (match) {
    const amount = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 1);
    const perText = match[2].trim();
    actions.push({
      type: 'lose_life',
      amount,
      amountFormula: `count:${normalizeCountSubject(perText)}*${amount}`,
      amountLabel: `for each ${perText}`,
      affectedObjects: 'you',
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Lose ${amount} life for each ${perText}`
    });
  }

  match = effect.match(/^this (land|artifact|permanent) becomes a copy of (target .+?)(?:, except it has this ability)?$/i);
  if (match) {
    const sourceKind = match[1].trim();
    const copySourceText = match[2].trim();
    actions.push({
      type: 'become_copy',
      affectedObjects: `this ${sourceKind}`,
      copySourceText,
      keepThisAbility: /except it has this ability/i.test(effect),
      targetFilters: targetFiltersFromText(copySourceText),
      targetCount: /target/i.test(copySourceText) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(copySourceText),
      label: `This ${sourceKind} becomes a copy of ${copySourceText}${/except it has this ability/i.test(effect) ? ', except it keeps this ability' : ''}`
    });
  }

  if (/^you may activate abilities of creatures you control as though those creatures had haste$/i.test(effect)) {
    actions.push({
      type: 'activation_timing_permission',
      affectedObjects: 'creatures you control',
      permission: 'activate_as_though_haste',
      linkedStatic: true,
      optional: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'You may activate abilities of creatures you control as though those creatures had haste'
    });
  }

  match = effect.match(/^you may pay ((?:\{[^}]+\})+)\. If you do, copy that ability\. You may choose new targets for the copy$/i);
  if (match && /activate an ability/i.test(trigger)) {
    actions.push({
      type: 'pay_to_copy_ability',
      optional: true,
      payment: { kind: 'mana', costText: match[1], cost: parseCostText(match[1]), label: `Pay ${match[1]}` },
      copiedObject: 'activated ability',
      excludesManaAbilities: /isn't a mana ability/i.test(condition),
      mayChooseNewTargets: true,
      triggerText: trigger,
      conditionText: condition,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `May pay ${match[1]} to copy a non-mana activated ability and choose new targets`
    });
  }

  match = effect.match(/^permanents your opponents control lose (.+?) until end of turn$/i);
  if (match) {
    const traits = extractKeywordTraits(match[1]);
    actions.push({
      type: 'remove_traits',
      affectedObjects: 'permanents your opponents control',
      traits,
      duration: 'until-end-of-turn',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'opponent',
      label: `Permanents your opponents control lose ${traits.length ? traits.join(' and ') : match[1].trim()} until end of turn`
    });
  }

  if (/^put the exiled card into your hand$/i.test(effect) && /token leaves the battlefield/i.test(trigger)) {
    actions.push({
      type: 'linked_exiled_card_to_hand',
      affectedObjects: 'the exiled card',
      sourceZone: 'exile',
      destination: 'hand',
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'When that token leaves the battlefield, put the exiled card into your hand'
    });
  }

  match = effect.match(/^(.+?) deals (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) damage to any target$/i);
  if (match) {
    const sourceText = match[1].trim();
    const amount = match[2].toUpperCase() === 'X' ? 'X' : numberFromText(match[2], 1);
    actions.push({
      type: 'direct_damage',
      damageSourceText: sourceText,
      damageTargetText: 'any target',
      damageFormula: String(amount),
      amount,
      targetFilters: ['AnyTarget'],
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'any',
      label: `${sourceText} deals ${amount} damage to any target`
    });
  }

  match = effect.match(/^exile each permanent with mana value (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) or less that's one or more colors$/i);
  if (match) {
    const manaValueMax = match[1].toUpperCase() === 'X' ? 'X' : numberFromText(match[1], 0);
    actions.push({
      type: 'mass_exile',
      affectedObjects: `each permanent with mana value ${manaValueMax} or less that's one or more colors`,
      targetFilters: ['Permanent'],
      manaValueMax,
      colorRequirement: 'colored',
      destination: 'exile',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'any',
      label: `Exile each colored permanent with mana value ${manaValueMax} or less`
    });
  }

  return actions;
}


function parsePatch20JolraelSpecificAction(effectText = '', conditionText = '', triggerText = '', originalText = '') {
  const effect = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const trigger = String(triggerText || '').replace(/\s+/g, ' ').trim();
  const fullText = String(originalText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const actions = [];
  let match;

  match = fullText.match(/^(basic landcycling|landcycling)\s+((?:\{[^}]+\})+)(?=\s|$|\()/i)
    || effect.match(/^(basic landcycling|landcycling)\s+((?:\{[^}]+\})+)(?=\s|$|\()/i);
  if (match) {
    const basicOnly = /^basic/i.test(match[1]);
    const costText = match[2];
    actions.push({
      type: 'landcycling',
      keywordAction: basicOnly ? 'basic_landcycling' : 'landcycling',
      costText,
      cost: parseCostText(`${costText}, Discard this card`),
      discardThisCard: true,
      searchLibrary: true,
      cardFilterText: basicOnly ? 'basic land card' : 'land card',
      destination: 'hand',
      reveal: true,
      shuffleAfter: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `${basicOnly ? 'Basic landcycling' : 'Landcycling'} ${costText}: search for ${basicOnly ? 'a basic land card' : 'a land card'}, reveal it, put it into hand, then shuffle`
    });
  }

  match = effect.match(/^return target (.+?) from your graveyard to your hand$/i);
  if (match) {
    const cardFilterText = match[1].trim();
    actions.push({
      type: 'return_from_graveyard_to_hand',
      affectedObjects: `target ${cardFilterText} from your graveyard`,
      sourceZone: 'graveyard',
      destination: 'hand',
      cardFilterText,
      targetFilters: targetFiltersFromText(cardFilterText),
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'self',
      label: `Return target ${cardFilterText} from your graveyard to your hand`
    });
  }

  match = effect.match(/^return to your hand target (.+?) card in your graveyard with lesser mana value$/i);
  if (match) {
    const cardFilterText = match[1].trim();
    actions.push({
      type: 'return_from_graveyard_to_hand',
      affectedObjects: `target ${cardFilterText} card in your graveyard with lesser mana value`,
      sourceZone: 'graveyard',
      destination: 'hand',
      cardFilterText,
      manaValueRestriction: 'lesser than triggering artifact/source',
      targetFilters: targetFiltersFromText(cardFilterText + ' card'),
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'self',
      label: `Return target ${cardFilterText} card with lesser mana value from your graveyard to your hand`
    });
  }

  if (/^umbra armor\b/i.test(fullText) || /^umbra armor\b/i.test(effect)) {
    actions.push({
      type: 'replacement_effect',
      keywordAction: 'umbra_armor',
      affectedObjects: 'enchanted creature',
      replacedEvent: 'enchanted creature would be destroyed',
      replacementEvent: 'remove all damage from it and destroy this Aura',
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Umbra armor — if enchanted creature would be destroyed, remove damage and destroy this Aura instead'
    });
  }

  match = effect.match(/^creatures with power less than this creature's power can't block creatures you control$/i);
  if (match) {
    actions.push({
      type: 'blocking_restriction',
      affectedObjects: "creatures with power less than this creature's power",
      restrictedAction: 'block creatures you control',
      conditionFormula: 'blocker.power < source.power',
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'opponent',
      label: "Creatures with power less than this creature's power can't block creatures you control"
    });
  }

  match = effect.match(/^you may sacrifice another creature\. If you do, you gain X life and draw X cards, where X is that creature's power$/i);
  if (!match && /^you may sacrifice another creature$/i.test(effect) && /^you do,\s*you gain X life and draw X cards, where X is that creature's power$/i.test(condition)) {
    match = ['sacrifice another creature then gain/draw X'];
  }
  if (!match && /When this creature enters, you may sacrifice another creature\. If you do, you gain X life and draw X cards, where X is that creature's power/i.test(fullText)) {
    match = ['sacrifice another creature then gain/draw X'];
  }
  if (match) {
    actions.push({
      type: 'sacrifice_then_gain_and_draw',
      optional: true,
      sacrifice: { affectedObjects: 'another creature', targetFilters: ['Creature'], ownerHint: 'self' },
      lifeAmount: 'X',
      drawAmount: 'X',
      xDefinition: "sacrificed creature's power",
      triggerText: trigger,
      targetCount: { min: 0, max: 1, optional: true },
      ownerHint: 'self',
      label: "May sacrifice another creature; gain life and draw cards equal to that creature's power"
    });
  }

  match = effect.match(/^it puts twice that many of those counters on that permanent instead$/i);
  if (match && /would put one or more counters/i.test(condition)) {
    actions.push({
      type: 'counter_replacement_multiplier',
      replacement: true,
      affectedObjects: 'permanents you control',
      counterMultiplier: 2,
      replacedEvent: 'one or more counters would be put on a permanent you control',
      conditionText: condition,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'If counters would be put on a permanent you control, put twice that many instead'
    });
  }

  match = fullText.match(/^station\s*\(tap another creature you control:\s*put charge counters equal to its power on this planet\. station only as a sorcery\.?\)$/i)
    || effect.match(/^station$/i);
  if (match) {
    actions.push({
      type: 'keyword_action',
      keywordAction: 'station',
      costText: 'Tap another creature you control',
      stationOnlyAsSorcery: true,
      counterType: 'charge',
      counterAmountFormula: 'tapped creature power',
      affectedObjects: 'this Planet',
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'self',
      label: 'Station — tap another creature to put charge counters equal to its power on this Planet'
    });
  }

  match = effect.match(/^target player shuffles up to (\d+|one|two|three|four|five|six|seven|eight|nine|ten) target cards from their graveyard into their library$/i);
  if (match) {
    const max = numberFromText(match[1], 3);
    actions.push({
      type: 'graveyard_to_library_shuffle',
      affectedObjects: `up to ${max} target cards from target player's graveyard`,
      sourceZone: 'graveyard',
      destination: 'library-shuffle',
      maxCards: max,
      targetFilters: ['Card'],
      targetCount: { min: 0, max, optional: true },
      ownerHint: 'any',
      label: `Target player shuffles up to ${max} cards from their graveyard into their library`
    });
  }

  match = effect.match(/^shuffle your graveyard into your library$/i);
  if (match) {
    actions.push({
      type: 'graveyard_to_library_shuffle',
      affectedObjects: 'your graveyard',
      sourceZone: 'graveyard',
      destination: 'library-shuffle',
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Shuffle your graveyard into your library'
    });
  }

  if (/^choose a background\b/i.test(fullText) || /^choose a background$/i.test(effect)) {
    actions.push({
      type: 'commander_deckbuilding_mechanic',
      keywordAction: 'choose_a_background',
      allowsSecondCommander: true,
      secondCommanderType: 'Background',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Choose a Background — may have a Background as a second commander'
    });
  }

  if (/^you have no maximum hand size$/i.test(effect)) {
    actions.push({
      type: 'maximum_hand_size_modifier',
      affectedObjects: 'you',
      maximumHandSize: null,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'You have no maximum hand size'
    });
  }

  match = effect.match(/^discard it, but you may put it on top of your library instead of into your graveyard$/i);
  if (match && /effect causes you to discard a card/i.test(condition)) {
    actions.push({
      type: 'discard_replacement',
      replacement: true,
      optional: true,
      affectedObjects: 'discarded card',
      replacedDestination: 'graveyard',
      replacementDestination: 'library-top',
      conditionText: condition,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'When an effect makes you discard, you may put that card on top of your library instead of into your graveyard'
    });
  }

  if (/^prevent all combat damage that would be dealt this turn$/i.test(effect)) {
    actions.push({
      type: 'prevent_damage',
      damageScope: 'all combat damage',
      duration: 'this-turn',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'any',
      label: 'Prevent all combat damage that would be dealt this turn'
    });
  }

  match = effect.match(/^this spell costs (\{[^}]+\}) less to cast if (.+)$/i);
  if (match) {
    actions.push({
      type: 'spell_cost_modifier',
      modifierMode: 'reduce',
      costDelta: match[1],
      appliesToText: 'this spell',
      appliesTo: ['Spell'],
      conditionText: match[2].trim(),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `This spell costs ${match[1]} less to cast if ${match[2].trim()}`
    });
  }

  match = effect.match(/^you may put a land card from your hand onto the battlefield tapped$/i);
  if (match) {
    actions.push({
      type: 'put_from_hand_to_battlefield',
      affectedObjects: 'land card from your hand',
      sourceZone: 'hand',
      destination: 'battlefield-tapped',
      cardFilterText: 'land',
      optional: true,
      targetFilters: ['Land', 'Card'],
      targetCount: { min: 0, max: 1, optional: true },
      ownerHint: 'self',
      label: 'You may put a land card from your hand onto the battlefield tapped'
    });
  }

  match = effect.match(/^return all cards from your graveyard to your hand\. Exile (.+?)\. You have no maximum hand size for the rest of the game$/i);
  if (match) {
    actions.push({
      type: 'return_from_graveyard_to_hand',
      affectedObjects: 'all cards from your graveyard',
      sourceZone: 'graveyard',
      destination: 'hand',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Return all cards from your graveyard to your hand'
    });
    actions.push({
      type: 'self_exile_after_resolution',
      affectedObjects: match[1].trim(),
      destination: 'exile',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Exile ${match[1].trim()}`
    });
    actions.push({
      type: 'maximum_hand_size_modifier',
      affectedObjects: 'you',
      maximumHandSize: null,
      duration: 'rest-of-game',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'You have no maximum hand size for the rest of the game'
    });
  }

  match = effect.match(/^(each opponent|that player) loses (\d+|one|two|three|four|five|six|seven|eight|nine|ten) life$/i);
  if (match) {
    const amount = numberFromText(match[2], 1);
    actions.push({
      type: 'lose_life',
      affectedObjects: match[1].trim(),
      amount,
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: /opponent/i.test(match[1]) ? 'opponent' : 'any',
      label: `${match[1].trim()} loses ${amount} life`
    });
  }

  match = effect.match(/^that player draws an additional card$/i);
  if (match && /beginning of each player's draw step/i.test(trigger)) {
    actions.push({
      type: 'draw',
      count: 1,
      affectedObjects: 'that player',
      additional: true,
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'any',
      label: 'At the beginning of each player\'s draw step, that player draws an additional card'
    });
  }

  if (/^each player may play an additional land on each of their turns$/i.test(effect)) {
    actions.push({
      type: 'additional_land_play',
      amount: 1,
      affectedObjects: 'each player',
      linkedStatic: true,
      optional: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'any',
      label: 'Each player may play one additional land on each of their turns'
    });
  }

  if (/^transform this creature$/i.test(effect)) {
    actions.push({
      type: 'transform_source',
      affectedObjects: 'this creature',
      triggerText: trigger,
      conditionText: condition,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Transform this creature${condition ? ` if ${condition}` : ''}`
    });
  }

  match = fullText.match(/^Lieutenant\s+[—-]\s+As long as you control your commander, this creature gets \+2\/\+2 and other creatures you control get \+2\/\+2 and have trample$/i);
  if (match) {
    actions.push({
      type: 'modify_pt',
      affectedObjects: 'this creature',
      powerDelta: 2,
      toughnessDelta: 2,
      conditionText: 'you control your commander',
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Lieutenant — this creature gets +2/+2 while you control your commander'
    });
    actions.push({
      type: 'modify_pt',
      affectedObjects: 'other creatures you control',
      powerDelta: 2,
      toughnessDelta: 2,
      conditionText: 'you control your commander',
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Lieutenant — other creatures you control get +2/+2 while you control your commander'
    });
    actions.push({
      type: 'grant_trait',
      affectedObjects: 'other creatures you control',
      trait: 'Trample',
      conditionText: 'you control your commander',
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'Lieutenant — other creatures you control have trample while you control your commander'
    });
  }

  match = fullText.match(/^(.+?) attacks each combat if able$/i) || effect.match(/^(.+?) attacks each combat$/i);
  if (match) {
    actions.push({
      type: 'attack_requirement',
      affectedObjects: match[1].trim(),
      conditionText: 'if able',
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `${match[1].trim()} attacks each combat if able`
    });
  }

  match = fullText.match(/^until end of turn, target creature gains "when this creature dies, return it to its owner's hand\.?"$/i)
    || effect.match(/^until end of turn, target creature gains "when this creature dies, return it to its owner's hand\.?"$/i);
  if (match) {
    actions.push({
      type: 'grant_triggered_ability',
      affectedObjects: 'target creature',
      duration: 'until-end-of-turn',
      grantedTrigger: 'When this creature dies',
      grantedAction: { type: 'return_source_to_hand', affectedObjects: 'this creature', sourceZone: 'graveyard', destination: 'hand', controller: 'owner' },
      targetFilters: ['Creature'],
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'self',
      label: 'Until end of turn, target creature gains a death trigger to return to its owner\'s hand'
    });
  }

  match = effect.match(/^each land is a Forest in addition to its other land types$/i);
  if (match) {
    actions.push({
      type: 'type_addition_static',
      affectedObjects: 'each land',
      addedTypes: ['Forest'],
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'any',
      label: 'Each land is a Forest in addition to its other land types'
    });
  }

  return actions;
}


const PROACTIVE_CARD_TYPE_WORDS = ['artifact', 'creature', 'enchantment', 'instant', 'sorcery', 'land', 'planeswalker', 'battle', 'permanent', 'spell', 'card'];
const PROACTIVE_MECHANIC_KEYWORDS = [
  'affinity', 'awaken', 'bestow', 'blitz', 'bloodrush', 'buyback', 'cascade', 'cleave', 'cycling', 'dash', 'disturb',
  'echo', 'emerge', 'encore', 'entwine', 'escalate', 'escape', 'evoke', 'foretell', 'freerunning', 'jump-start', 'kicker', 'madness', 'miracle',
  'mobilize', 'morph', 'mutate', 'ninjutsu', 'offering', 'plot', 'prowl', 'prototype', 'replicate', 'retrace', 'spectacle',
  'splice', 'suspend', 'transfigure', 'transmute', 'unearth'
];

function pushUniqueAction(actions, action) {
  if (!action?.type) return;
  const signature = [
    action.type,
    action.keywordAction || '',
    action.label || '',
    action.affectedObjects || '',
    action.sourceZone || '',
    action.destination || '',
    action.conditionText || ''
  ].join('|').toLowerCase();
  const exists = actions.some((item) => {
    const itemSignature = [
      item.type,
      item.keywordAction || '',
      item.label || '',
      item.affectedObjects || '',
      item.sourceZone || '',
      item.destination || '',
      item.conditionText || ''
    ].join('|').toLowerCase();
    if (itemSignature === signature) return true;
    if (item.type === action.type && item.label && action.label && item.label.toLowerCase() === action.label.toLowerCase()) return true;
    if (item.type === action.type && item.keywordAction && action.keywordAction && item.keywordAction === action.keywordAction) return true;
    if (item.type === action.type && item.replacementKind && action.replacementKind && item.replacementKind === action.replacementKind) return true;
    const onePerAbilityTypes = new Set(['draw', 'mill', 'discard', 'gain_life', 'lose_life', 'life_gain_replacement', 'return_from_graveyard_to_hand', 'return_from_graveyard_to_battlefield', 'exile', 'move_to_library', 'move_to_graveyard', 'spell_casting_restriction', 'prevent_damage']);
    if (item.type === action.type && onePerAbilityTypes.has(action.type)) return true;
    if (/_restriction$/.test(item.type || '') && /_restriction$/.test(action.type || '')) return true;
    return false;
  });
  if (!exists) actions.push(action);
}

function actionAmountFromWord(raw = '', fallback = 1) {
  const value = String(raw || '').trim();
  if (/^x$/i.test(value)) return 'X';
  if (/^that many$/i.test(value)) return 'that-many';
  if (/^twice$/i.test(value)) return 2;
  return numberFromText(value, fallback);
}

function normalizeZoneName(zone = '') {
  const raw = String(zone || '').toLowerCase().replace(/[.]+$/g, '').trim();
  if (!raw) return '';
  if (/battlefield/.test(raw)) return /tapped/.test(raw) ? 'battlefield-tapped' : 'battlefield';
  if (/graveyard/.test(raw)) return 'graveyard';
  if (/exile/.test(raw)) return 'exile';
  if (/hand/.test(raw)) return 'hand';
  if (/top of (?:your|its owner's|their|that player's|target player's)?\s*library|library top/.test(raw)) return 'library-top';
  if (/bottom of (?:your|its owner's|their|that player's|target player's)?\s*library|library bottom/.test(raw)) return 'library-bottom';
  if (/library/.test(raw)) return /shuffle/.test(raw) ? 'library-shuffle' : 'library';
  return raw.replace(/\s+/g, '-');
}

function zoneActionTypeForDestination(destination = '') {
  if (destination === 'battlefield' || destination === 'battlefield-tapped') return 'return_from_graveyard_to_battlefield';
  if (destination === 'hand') return 'return_from_graveyard_to_hand';
  if (destination === 'exile') return 'exile';
  if (destination === 'graveyard') return 'move_to_graveyard';
  if (destination === 'library-top' || destination === 'library-bottom' || destination === 'library' || destination === 'library-shuffle') return 'move_to_library';
  return 'move_card';
}

function parseZoneMoveSentence(effectText = '', triggerText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const actions = [];
  let match;

  match = text.match(/^(?:you may\s+)?(?:return|put)\s+((?:up to\s+)?(?:(?:x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:target\s+)?(?:another\s+)?(?:all\s+)?(?:each\s+)?(?:.+?))\s+from\s+(your|its owner'?s|their|that player'?s|target player'?s)?\s*(graveyard|hand|exile|library)\s+(?:to|onto|into|on)\s+((?:the\s+)?battlefield tapped|(?:the\s+)?battlefield|(?:its owner'?s|your|their|that player'?s|target player'?s)?\s*hand|(?:the\s+)?top of (?:its owner'?s|your|their|that player'?s|target player'?s)?\s*library|(?:the\s+)?bottom of (?:its owner'?s|your|their|that player'?s|target player'?s)?\s*library|(?:its owner'?s|your|their|that player'?s|target player'?s)?\s*library)$/i);
  if (match) {
    const affectedObjects = match[1].replace(/\s+/g, ' ').trim();
    const sourceOwner = (match[2] || '').trim();
    const sourceZone = match[3].toLowerCase();
    const destination = normalizeZoneName(match[4]);
    actions.push({
      type: zoneActionTypeForDestination(destination),
      affectedObjects,
      sourceZone,
      sourceOwner,
      destination,
      optional: /\byou may\b|\bup to\b/i.test(text),
      triggerText,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: ownerHintFromText(`${sourceOwner} ${affectedObjects}`) || 'self',
      label: text
    });
  }

  match = text.match(/^(?:you may\s+)?put\s+((?:up to\s+)?(?:(?:x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:target\s+)?(?:another\s+)?(?:all\s+)?(?:.+?))\s+(?:onto|on|into)\s+((?:the\s+)?battlefield tapped|(?:the\s+)?battlefield|(?:its owner'?s|your|their|that player'?s|target player'?s)?\s*hand|(?:the\s+)?top of (?:its owner'?s|your|their|that player'?s|target player'?s)?\s*library|(?:the\s+)?bottom of (?:its owner'?s|your|their|that player'?s|target player'?s)?\s*library|(?:its owner'?s|your|their|that player'?s|target player'?s)?\s*graveyard|exile)$/i);
  if (match && !/counter on|counters on/i.test(text)) {
    const affectedObjects = match[1].replace(/\s+/g, ' ').trim();
    const destination = normalizeZoneName(match[2]);
    actions.push({
      type: zoneActionTypeForDestination(destination),
      affectedObjects,
      destination,
      optional: /\byou may\b|\bup to\b/i.test(text),
      triggerText,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: ownerHintFromText(affectedObjects) || 'any',
      label: text
    });
  }

  match = text.match(/^shuffle\s+(.+?)\s+into\s+(?:its owner'?s|your|their|that player'?s|target player'?s)?\s*library$/i);
  if (match) {
    const affectedObjects = match[1].trim();
    actions.push({
      type: 'move_to_library',
      affectedObjects,
      destination: 'library-shuffle',
      sourceZone: /graveyard/i.test(affectedObjects) ? 'graveyard' : '',
      triggerText,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: ownerHintFromText(affectedObjects) || 'any',
      label: `Shuffle ${affectedObjects} into library`
    });
  }

  match = text.match(/^exile\s+((?:up to\s+)?(?:(?:x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|any number of)\s+)?(?:target\s+)?(?:each\s+)?(?:all\s+)?(?:.+?))(?:\s+until\s+(.+))?$/i);
  if (match && !/spell costs?|rather than pay|from your hand rather|top card/i.test(text)) {
    const affectedObjects = match[1].trim();
    actions.push({
      type: 'exile',
      affectedObjects,
      destination: 'exile',
      duration: match[2]?.trim() || '',
      triggerText,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: ownerHintFromText(affectedObjects) || 'any',
      label: text
    });
  }

  return actions;
}

function parseProactiveCardNameChoice(effectText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  if (!/^choose (?:a|an) (card name|color|creature type|artifact, creature, enchantment, instant, or sorcery|artifact, creature, enchantment, instant, sorcery, or land)$/i.test(text)) return null;
  const kindText = text.match(/^choose (?:a|an) (.+)$/i)?.[1]?.trim() || '';
  const isCardType = /artifact|creature|enchantment|instant|sorcery|land/i.test(kindText) && !/creature type/i.test(kindText);
  const choices = isCardType
    ? PROACTIVE_CARD_TYPE_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(kindText))
    : [];
  return {
    type: isCardType ? 'choose_card_type' : `choose_${kindText.toLowerCase().replace(/\s+/g, '_')}`,
    choiceKind: isCardType ? 'card-type' : kindText.toLowerCase(),
    choices,
    targetCount: { min: 0, max: 0, optional: false },
    ownerHint: 'self',
    label: `Choose ${kindText}`
  };
}

function parseProactiveLifeModifier(effectText = '', conditionText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const full = `${condition ? `if ${condition}, ` : ''}${text}`.replace(/\s+/g, ' ').trim();
  const actions = [];
  let match;

  match = full.match(/^(?:if\s+)?(.+?) would gain life,?\s*(?:that player |you |they )?(?:gain|gains) (twice|double|half|that much plus\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)|that much) (?:that much )?life instead$/i)
    || full.match(/^(?:if\s+)?(.+?) would gain life,?\s*(?:that player |you |they )?(?:gain|gains) (twice|double|half) that much life instead$/i);
  if (match) {
    const rawMode = String(match[2] || '').toLowerCase();
    const mode = /twice|double/.test(rawMode) ? 'multiply' : (/half/.test(rawMode) ? 'divide' : (/plus/.test(rawMode) ? 'add' : 'replace'));
    const factor = mode === 'multiply' ? 2 : (mode === 'divide' ? 0.5 : null);
    const bonusLife = mode === 'add' ? numberFromText(match[3], 1) : null;
    actions.push({
      type: 'life_gain_replacement',
      replacementKind: mode === 'multiply' ? 'life-gain-multiply' : (mode === 'divide' ? 'life-gain-half' : (mode === 'add' ? 'life-gain-plus' : 'life-gain-replace')),
      affectedObjects: match[1].trim(),
      multiplier: factor,
      bonusLife,
      linkedStatic: true,
      replacement: true,
      conditionText: condition || `${match[1].trim()} would gain life`,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'any',
      label: mode === 'multiply'
        ? `${match[1].trim()} gains twice that much life instead`
        : (mode === 'divide'
          ? `${match[1].trim()} gains half that much life instead`
          : `${match[1].trim()} gains that much life plus ${bonusLife} instead`)
    });
  }

  match = text.match(/^(players|opponents|your opponents|each opponent|you|that player) can't gain life$/i);
  if (match) {
    actions.push({
      type: 'life_gain_restriction',
      affectedObjects: match[1].trim(),
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: /opponent/i.test(match[1]) ? 'opponent' : 'any',
      label: `${match[1].trim()} can't gain life`
    });
  }

  match = text.match(/^(you|target player|each opponent|each player|that player|its controller) loses? (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) life(?: for each (.+))?$/i);
  if (match) {
    const amount = actionAmountFromWord(match[2], 1);
    const perText = match[3]?.trim() || '';
    actions.push({
      type: 'lose_life',
      affectedObjects: match[1].trim(),
      amount,
      amountFormula: perText ? `count:${normalizeCountSubject(perText)}*${amount}` : '',
      amountLabel: perText ? `for each ${perText}` : '',
      triggerText: '',
      targetCount: /target player/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'any',
      label: `${match[1].trim()} loses ${amount} life${perText ? ` for each ${perText}` : ''}`
    });
  }

  match = text.match(/^(you|target player|each player|that player|its controller) gains? (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) life(?: for each (.+))?$/i);
  if (match) {
    const amount = actionAmountFromWord(match[2], 1);
    const perText = match[3]?.trim() || '';
    actions.push({
      type: 'gain_life',
      affectedObjects: match[1].trim(),
      amount,
      amountFormula: perText ? `count:${normalizeCountSubject(perText)}*${amount}` : '',
      amountLabel: perText ? `for each ${perText}` : '',
      targetCount: /target player/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'self',
      label: `${match[1].trim()} gains ${amount} life${perText ? ` for each ${perText}` : ''}`
    });
  }

  match = text.match(/^(you|target player|each player|that player|its controller|that creature's controller|enchanted creature's controller) gains? life equal to (.+)$/i)
    || text.match(/\b(you|target player|each player|that player|its controller|that creature's controller|enchanted creature's controller) gains? life equal to ([^.]+)(?:\.|$)/i);
  if (match) {
    const subject = match[1].trim();
    const formulaText = match[2].trim();
    actions.push({
      type: 'gain_life',
      affectedObjects: subject,
      amount: 'dynamic',
      amountFormula: `value:${formulaText.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      amountLabel: `equal to ${formulaText}`,
      targetCount: /target player/i.test(subject) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(subject) || 'any',
      label: `${subject} gains life equal to ${formulaText}`
    });
  }

  match = text.match(/^(you|target player|each player|each opponent|that player|its controller) loses? life equal to (.+)$/i)
    || text.match(/\b(you|target player|each player|each opponent|that player|its controller) loses? life equal to ([^.]+)(?:\.|$)/i);
  if (match) {
    const subject = match[1].trim();
    const formulaText = match[2].trim();
    actions.push({
      type: 'lose_life',
      affectedObjects: subject,
      amount: 'dynamic',
      amountFormula: `value:${formulaText.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      amountLabel: `equal to ${formulaText}`,
      targetCount: /target player/i.test(subject) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(subject) || 'any',
      label: `${subject} loses life equal to ${formulaText}`
    });
  }

  return actions;
}

function parseProactiveDrawDiscardMill(effectText = '', triggerText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const actions = [];
  let match;

  match = text.match(/^(you|target player|each player|each opponent|that player|its controller) draws? (x|a|an|\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards?(?: for each (.+))?$/i);
  if (match) {
    const count = actionAmountFromWord(match[2], 1);
    const perText = match[3]?.trim() || '';
    actions.push({
      type: 'draw',
      count,
      countExpression: count === 'X' ? 'X' : '',
      amountFormula: perText ? `count:${normalizeCountSubject(perText)}*${count}` : '',
      affectedObjects: match[1].trim(),
      triggerText,
      targetCount: /target player/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'any',
      label: `${match[1].trim()} draws ${count} card(s)${perText ? ` for each ${perText}` : ''}`
    });
  }

  match = text.match(/^(you|target player|each player|each opponent|that player|its controller) discards? (x|a|an|\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards?(?: at random)?$/i);
  if (match) {
    const count = actionAmountFromWord(match[2], 1);
    actions.push({
      type: 'discard',
      count,
      affectedObjects: match[1].trim(),
      random: /at random/i.test(text),
      targetFilters: /target player/i.test(match[1]) ? ['Player'] : [],
      targetCount: /target player/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'any',
      label: `${match[1].trim()} discards ${count} card(s)${/at random/i.test(text) ? ' at random' : ''}`
    });
  }

  match = text.match(/^(you|target player|each player|each opponent|that player|its controller) mills? (x|a|an|\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards?$/i);
  if (match) {
    const count = actionAmountFromWord(match[2], 1);
    actions.push({
      type: 'mill',
      count,
      affectedObjects: match[1].trim(),
      targetFilters: /target player/i.test(match[1]) ? ['Player'] : [],
      targetCount: /target player/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'any',
      label: `${match[1].trim()} mills ${count} card(s)`
    });
  }

  return actions;
}

function parseProactiveCostAndTax(effectText = '', conditionText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const actions = [];
  let match;

  match = text.match(/^(.+?) spells? (?:you cast |that you cast |your opponents cast |opponents cast )?costs? ((?:\{[^}]+\})+) (less|more) to cast(?: if (.+))?$/i)
    || text.match(/^(.+?) spells? (?:you cast |that you cast |your opponents cast |opponents cast )?costs? (x) (less|more) to cast, where x is (.+)$/i);
  if (match) {
    const appliesToText = match[1].trim();
    const costDelta = match[2].toUpperCase() === 'X' ? '{X}' : match[2];
    const mode = match[3].toLowerCase() === 'less' ? 'reduce' : 'increase';
    const extraCondition = match[4]?.trim() || condition;
    const colors = Object.entries(MANA_WORDS)
      .filter(([word]) => new RegExp(`\\b${word}\\b`, 'i').test(appliesToText))
      .map(([, symbol]) => symbol);
    actions.push({
      type: 'spell_cost_modifier',
      modifierMode: mode,
      costDelta,
      appliesToText,
      appliesTo: targetFiltersFromText(appliesToText),
      colors,
      conditionText: extraCondition,
      amountFormula: match[2].toUpperCase() === 'X' && match[4] ? `total:${normalizeCountSubject(match[4])}` : '',
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: /opponents cast|your opponents/i.test(text) ? 'opponent' : 'self',
      label: `${appliesToText} spells cost ${costDelta} ${mode === 'reduce' ? 'less' : 'more'} to cast${extraCondition ? ` if ${extraCondition}` : ''}`
    });
  }

  match = text.match(/^activated abilities of (.+?) cost ((?:\{[^}]+\})+) (less|more) to activate(?: if (.+))?$/i);
  if (match) {
    actions.push({
      type: 'activation_cost_modifier',
      affectedObjects: match[1].trim(),
      costDelta: match[2],
      modifierMode: match[3].toLowerCase() === 'less' ? 'reduce' : 'increase',
      conditionText: match[4]?.trim() || condition,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'self',
      label: `Activated abilities of ${match[1].trim()} cost ${match[2]} ${match[3].toLowerCase()} to activate`
    });
  }

  return actions;
}

function parseProactiveReplacementAndRestriction(effectText = '', conditionText = '', triggerText = '') {
  const text = String(effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const condition = String(conditionText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const full = `${condition ? `If ${condition}, ` : ''}${text}`.replace(/\s+/g, ' ').trim();
  const actions = [];
  let match;

  match = full.match(/^if (.+?) would (deal|be dealt) damage (.+?), (?:it|that source|that permanent|that creature) (?:deals|is dealt) (twice|double|half) that much damage instead$/i);
  if (match) {
    actions.push({
      type: 'damage_replacement_multiplier',
      replacement: true,
      affectedObjects: match[1].trim(),
      damageDirection: match[2],
      multiplier: /half/i.test(match[4]) ? 0.5 : 2,
      conditionText: condition || `${match[1].trim()} would ${match[2]} damage`,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'any',
      label: `${match[1].trim()} ${/half/i.test(match[4]) ? 'halves' : 'doubles'} damage instead`
    });
  }

  match = text.match(/^prevent (?:the next )?(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|all) damage that would be dealt(?: to (.+?))?(?: this turn)?$/i);
  if (match) {
    const amount = /^all$/i.test(match[1]) ? 'all' : actionAmountFromWord(match[1], 1);
    actions.push({
      type: 'prevent_damage',
      amount,
      affectedObjects: match[2]?.trim() || 'any target',
      duration: /this turn/i.test(text) ? 'this-turn' : '',
      targetFilters: match[2] ? targetFiltersFromText(match[2]) : [],
      targetCount: /target/i.test(match[2] || '') ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[2] || '') || 'any',
      label: text
    });
  }

  match = text.match(/^(.+?) can't (attack|block|cast spells|cast noncreature spells|activate abilities|draw cards|gain life|lose life)(?: this turn)?$/i);
  if (match) {
    actions.push({
      type: `${match[2].toLowerCase().replace(/\s+/g, '_')}_restriction`,
      affectedObjects: match[1].trim(),
      restrictedAction: match[2].toLowerCase(),
      duration: /this turn/i.test(text) ? 'this-turn' : '',
      linkedStatic: !/this turn/i.test(text),
      targetFilters: targetFiltersFromText(match[1]),
      targetCount: /target/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'any',
      label: text
    });
  }

  match = text.match(/^(.+?) can(?:'t|not) be blocked(?: by (.+?))?(?: this turn)?$/i)
    || text.match(/^(.+?) can be blocked only by (.+?)(?: this turn)?$/i);
  if (match) {
    actions.push({
      type: 'blocking_restriction',
      affectedObjects: match[1].trim(),
      blockerRestrictionText: match[2]?.trim() || (/can't/.test(text) ? 'none' : ''),
      duration: /this turn/i.test(text) ? 'this-turn' : '',
      linkedStatic: !/this turn/i.test(text),
      targetFilters: targetFiltersFromText(match[1]),
      targetCount: /target/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'self',
      label: text
    });
  }

  return actions;
}

function parseProactiveMechanicKeyword(effectText = '', originalText = '') {
  const text = String(originalText || effectText || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/g, '');
  const lower = text.toLowerCase();
  for (const keyword of PROACTIVE_MECHANIC_KEYWORDS) {
    const pattern = new RegExp(`^${keyword.replace('-', '[ -]')}\\b(?:\\s+((?:\\{[^}]+\\}|\\d+|[^()—-])+))?`, 'i');
    const match = text.match(pattern);
    if (!match) continue;
    const costText = (match[1] || '').trim().replace(/\s+$/g, '');
    if (['cycling', 'basic landcycling'].includes(keyword) && !/cycling/i.test(lower)) continue;
    return {
      type: 'casting_cost_mechanic',
      keywordAction: keyword.replace(/[ -]/g, '_'),
      costText: /\{[^}]+\}/.test(costText) ? (costText.match(/(?:\{[^}]+\})+/g) || [costText])[0] : costText,
      cost: parseCostText(costText),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `${keyword[0].toUpperCase()}${keyword.slice(1)}${costText ? ` ${costText}` : ''}`
    };
  }
  return null;
}

function stripProactiveAbilityPrefix(text = '') {
  let next = String(text || '').trim();
  let previous = '';
  while (next && next !== previous) {
    previous = next;
    // Saga chapters and loyalty prefixes can be part of effectText after line splitting:
    // "I — Mill ten cards...", "I, II — Destroy...", "−8 — You get an emblem...".
    next = next.replace(/^(?:[IVX]+(?:\s*,\s*[IVX]+)*|[+−-]?\d+)\s*[—-]\s*/i, '').trim();
    // Named chapter / ability-word wrappers: "Mega Flare — This creature deals...",
    // "Landfall — Whenever...", "Constellation — Whenever...". Only strip when the
    // right side starts like real rules text so card names are not accidentally eaten.
    next = next.replace(/^[A-Z][A-Za-z0-9'’:,\s-]{1,48}\s*[—-]\s+(?=(?:whenever|when|at the beginning|if|as long as|until|you|target|each|this|that|draw|discard|mill|destroy|exile|return|put|create|add|search|look|reveal|deal|deals|double|triple|distribute|counter|tap|untap|sacrifice|prevent|choose)\b)/i, '').trim();
  }
  return next;
}

function stripProactiveTimingClauses(text = '') {
  return stripProactiveAbilityPrefix(String(text || '')
    .replace(/\s+Activate only as a sorcery\.?$/i, '')
    .replace(/\s+Activate only during your turn\.?$/i, '')
    .replace(/\s+Activate only if .+$/i, '')
    .replace(/\s+Cast only as a sorcery\.?$/i, '')
    .replace(/\s+Cast only during .+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]+$/g, ''));
}

function parsePatch23PredictiveGrammarActions(effectText = '', conditionText = '', triggerText = '', originalText = '', costText = '') {
  const actions = [];
  const text = stripProactiveTimingClauses(effectText);
  const original = stripProactiveTimingClauses(originalText || effectText);
  const condition = stripProactiveTimingClauses(conditionText);
  const trigger = stripProactiveTimingClauses(triggerText);
  const cost = stripProactiveTimingClauses(costText);
  const full = `${cost ? `${cost}: ` : ''}${text}`.replace(/\s+/g, ' ').trim();
  const combinedEffect = condition ? `${text}. If ${condition}` : text;
  let match;

  // Broad "return/put from graveyard to battlefield" variants that include trailing timing text,
  // "a graveyard", "under your control", or multiple returned objects.
  match = text.match(/^(?:you may\s+)?(?:return|put)\s+(.+?)\s+from\s+(your|a|any|target player'?s|that player'?s|its owner'?s)?\s*graveyard\s+(?:to|onto)\s+the battlefield(?:\s+tapped)?(?:\s+under your control)?$/i);
  if (match) {
    const affectedObjects = match[1].trim();
    const sourceOwner = (match[2] || '').trim();
    pushUniqueAction(actions, {
      type: 'move_to_battlefield',
      affectedObjects,
      sourceZone: 'graveyard',
      sourceOwner,
      destination: /tapped/i.test(text) ? 'battlefield-tapped' : 'battlefield',
      controller: /under your control/i.test(text) ? 'you' : '',
      optional: /\bmay\b|up to/i.test(text),
      triggerText: trigger,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: ownerHintFromText(`${sourceOwner} ${affectedObjects}`) || 'self',
      label: text
    });
  }

  // Same family, but with a follow-up life loss/draw/life gain sentence attached.
  match = text.match(/^put\s+(.+?)\s+from\s+(a|any|your|target player'?s|that player'?s)?\s*graveyard\s+onto\s+the battlefield(?:\s+under your control)?\.\s+you lose life equal to (.+)$/i);
  if (match) {
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'move_to_battlefield',
      affectedObjects,
      sourceZone: 'graveyard',
      sourceOwner: match[2] || 'a',
      destination: 'battlefield',
      controller: /under your control/i.test(text) ? 'you' : '',
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: 'self',
      label: `Put ${affectedObjects} from a graveyard onto the battlefield`
    });
    pushUniqueAction(actions, {
      type: 'lose_life',
      affectedObjects: 'you',
      amount: 'dynamic',
      amountFormula: `value:${normalizeCountSubject(match[3].trim())}`,
      amountLabel: `equal to ${match[3].trim()}`,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `You lose life equal to ${match[3].trim()}`
    });
  }

  // Return card(s) from graveyard to hand: "target card", "target permanent card", "another target artifact card", etc.
  match = text.match(/^(?:you may\s+)?return\s+(.+?)\s+from\s+(your|target player'?s|that player'?s|its owner'?s)?\s*graveyard\s+to\s+(?:your|its owner'?s|their|that player'?s)?\s*hand$/i);
  if (match) {
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'return_from_graveyard_to_hand',
      affectedObjects,
      sourceZone: 'graveyard',
      sourceOwner: (match[2] || '').trim(),
      destination: 'hand',
      optional: /\bmay\b|up to/i.test(text),
      triggerText: trigger,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: ownerHintFromText(affectedObjects) || 'self',
      label: text
    });
  }

  // This-card multi-zone permission: Squee-style wording, plus nearby variants.
  match = text.match(/^you may cast this (?:card|spell) from your (graveyard|exile)(?: or from (?:your )?(graveyard|exile))?$/i);
  if (match) {
    const zones = [match[1], match[2]].filter(Boolean).map((zone) => zone.toLowerCase());
    pushUniqueAction(actions, {
      type: 'zone_play_permission',
      affectedObjects: 'this card',
      sourceZones: zones,
      sourceZone: zones.join('|'),
      permission: 'cast_from_zone',
      optional: true,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Cost reductions based on a counted board state: Blasphemous Act and nearby templates.
  match = text.match(/^this spell costs ((?:\{[^}]+\})+) less to cast for each (.+)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'spell_cost_modifier',
      modifierMode: 'reduce',
      costDelta: match[1],
      appliesToText: 'this spell',
      appliesTo: ['Spell'],
      amountFormula: `count:${normalizeCountSubject(match[2].trim())}`,
      amountLabel: `for each ${match[2].trim()}`,
      linkedStatic: false,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Damage replacement multipliers: double, triple, three times, half, etc.
  match = `${condition ? `If ${condition}, ` : ''}${text}`.match(/^if (.+?) would deal damage to (.+?), (?:it|that source|that permanent|that creature|the source) deals? (double|twice|triple|three times|half) (?:that much|that) damage instead$/i);
  if (match) {
    const rawMultiplier = match[3].toLowerCase();
    const multiplier = /triple|three times/.test(rawMultiplier) ? 3 : (/half/.test(rawMultiplier) ? 0.5 : 2);
    pushUniqueAction(actions, {
      type: 'damage_replacement_multiplier',
      replacement: true,
      affectedObjects: match[1].trim(),
      damageTargetText: match[2].trim(),
      damageDirection: 'deal',
      multiplier,
      conditionText: condition || `${match[1].trim()} would deal damage`,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'self',
      label: text
    });
  }

  // Direct damage equal to a source's power / toughness / sacrificed creature's power.
  match = text.match(/^(.+?) deals damage equal to (.+?) to (any target|target .+?|each opponent|each creature|each player)$/i);
  if (match) {
    const targetText = match[3].trim();
    pushUniqueAction(actions, {
      type: 'direct_damage',
      damageSourceText: match[1].trim(),
      damageTargetText: targetText,
      amount: 'dynamic',
      damageFormula: `value:${normalizeCountSubject(match[2].trim())}`,
      amountLabel: `equal to ${match[2].trim()}`,
      targetFilters: /any target/i.test(targetText) ? ['AnyTarget'] : targetFiltersFromText(targetText),
      targetCount: /target|any target/i.test(targetText) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(targetText) || 'any',
      label: text
    });
  }

  // Sacrifice as an effect, including "you may sacrifice another creature" and "sacrifice another permanent".
  match = text.match(/^(?:you may\s+)?sacrifice\s+(.+)$/i);
  if (match) {
    const sacrificeText = match[1].trim();
    pushUniqueAction(actions, {
      type: 'sacrifice_permanents',
      affectedObjects: sacrificeText,
      sacrificeCount: /one or more/i.test(sacrificeText) ? 'one-or-more' : 1,
      optional: /\bmay\b/i.test(text),
      triggerText: trigger,
      targetFilters: targetFiltersFromText(sacrificeText),
      targetCount: /one or more/i.test(sacrificeText) ? { min: 1, max: 'any', optional: false } : { min: 1, max: 1, optional: false },
      ownerHint: ownerHintFromText(sacrificeText) || 'self',
      label: text
    });
  }

  // Additional-cost sacrifice, including optional "you may sacrifice one or more" copy engines.
  match = text.match(/^as an additional cost to cast this spell, you may sacrifice one or more (.+)$/i)
    || text.match(/^as an additional cost to cast this spell, sacrifice one or more (.+)$/i);
  if (match) {
    const sacrificeText = `one or more ${match[1].trim()}`;
    pushUniqueAction(actions, {
      type: 'additional_cast_cost',
      costKind: 'sacrifice',
      optional: /you may/i.test(text),
      appliesOnStack: true,
      additionalCost: {
        kind: 'sacrifice',
        affectedObjects: sacrificeText,
        validObjects: targetFiltersFromText(sacrificeText),
        destination: 'graveyard',
        variableCount: true,
        label: `Sacrifice ${sacrificeText}`
      },
      targetFilters: targetFiltersFromText(sacrificeText),
      targetCount: { min: 1, max: 'any', optional: /you may/i.test(text) },
      ownerHint: 'self',
      label: `Additional cost: sacrifice ${sacrificeText}`
    });
  }

  match = text.match(/^copy this spell for each (.+)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'copy_spell',
      copiedObject: 'this spell',
      amount: 'dynamic',
      amountFormula: `count:${normalizeCountSubject(match[1].trim())}`,
      amountLabel: `for each ${match[1].trim()}`,
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Keyword action plus conditional follow-up in a single sentence: "surveil 1. Then if...".
  // Also handle the parser-split version where the generic condition splitter leaves effectText as
  // "surveil 1. Then" and moves "if there are three or more..., this becomes prepared" into conditionText.
  match = text.match(/^(scry|surveil|mill)\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\.\s*Then(?: if (.+?))?,?\s*(.*)$/i);
  if (match) {
    const keyword = match[1].toLowerCase();
    const count = actionAmountFromWord(match[2], 1);
    const inlineCondition = match[3]?.trim() || '';
    const splitCondition = condition || '';
    const conditionForAction = inlineCondition || splitCondition;
    const followupText = (match[4] || '').trim();
    pushUniqueAction(actions, {
      type: keyword === 'mill' ? 'mill' : 'keyword_action',
      keywordAction: keyword === 'mill' ? '' : keyword,
      count,
      affectedObjects: keyword === 'mill' ? 'you' : '',
      conditionText: conditionForAction,
      followupText,
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `${keyword[0].toUpperCase()}${keyword.slice(1)} ${count}${followupText ? `, then ${followupText}` : ''}`
    });
    const preparedText = `${followupText} ${splitCondition}`;
    if (/becomes? prepared/i.test(preparedText)) {
      pushUniqueAction(actions, {
        type: 'status_marker',
        status: 'prepared',
        affectedObjects: 'this creature',
        conditionText: conditionForAction.replace(/,?\s*this creature becomes prepared\.?$/i, '').trim(),
        triggerText: trigger,
        targetCount: { min: 0, max: 0, optional: false },
        ownerHint: 'self',
        label: 'This creature becomes prepared'
      });
    }
  }

  // Prepared is a new Arena/acorn-adjacent-style status word on some Universes Beyond cards.
  // Catch direct and split condition variants so future "becomes prepared" cards do not become card-specific misses.
  if (/becomes? prepared/i.test(text) || /becomes? prepared/i.test(condition)) {
    const preparedCondition = condition.replace(/,?\s*(?:this|that|it|target .+?) becomes? prepared\.?$/i, '').trim();
    pushUniqueAction(actions, {
      type: 'status_marker',
      status: 'prepared',
      affectedObjects: /target/i.test(text) ? 'target object' : 'this creature',
      conditionText: preparedCondition,
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'This creature becomes prepared'
    });
  }

  // Repeated Jund/aristocrat structures: do A and B in one effect line.
  if (/each opponent loses \d+ life and you gain \d+ life/i.test(text)) {
    const lossMatch = text.match(/each opponent loses (\d+|one|two|three|four|five|six|seven|eight|nine|ten) life/i);
    const gainMatch = text.match(/you gain (\d+|one|two|three|four|five|six|seven|eight|nine|ten) life/i);
    if (lossMatch) pushUniqueAction(actions, {
      type: 'lose_life',
      affectedObjects: 'each opponent',
      amount: numberFromText(lossMatch[1], 1),
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'opponent',
      label: `Each opponent loses ${numberFromText(lossMatch[1], 1)} life`
    });
    if (gainMatch) pushUniqueAction(actions, {
      type: 'gain_life',
      affectedObjects: 'you',
      amount: numberFromText(gainMatch[1], 1),
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `You gain ${numberFromText(gainMatch[1], 1)} life`
    });
  }

  // Adapt/Ascend/Prepared/Rebound-like mechanics not always caught by exact keyword buckets.
  match = text.match(/^adapt\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/i);
  if (match) {
    const count = actionAmountFromWord(match[1], 1);
    pushUniqueAction(actions, {
      type: 'keyword_action',
      keywordAction: 'adapt',
      counterAmount: count,
      counterType: '+1/+1',
      conditionText: 'if this creature has no +1/+1 counters on it',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Adapt ${count}`
    });
  }

  if (/^ascend$/i.test(text)) {
    pushUniqueAction(actions, {
      type: 'keyword_action',
      keywordAction: 'ascend',
      conditionText: 'if you control ten or more permanents',
      status: "city's blessing",
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: "Ascend — get the city's blessing if you control ten or more permanents"
    });
  }

  return actions;
}


function parsePatch24PredictiveGrammarActions(effectText = '', conditionText = '', triggerText = '', originalText = '', costText = '') {
  const actions = [];
  const text = stripProactiveTimingClauses(effectText);
  const condition = stripProactiveTimingClauses(conditionText);
  const fullText = stripProactiveTimingClauses(originalText || effectText);
  const cost = stripProactiveTimingClauses(costText);
  let match;

  // Grave Researcher-style split: parser leaves effect as "surveil 1. Then" and puts
  // "if there are three or more..., this creature becomes prepared" in conditionText.
  match = text.match(/^(scry|surveil|mill)\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\.?\s*then\.?$/i);
  if (match) {
    const keyword = match[1].toLowerCase();
    const count = actionAmountFromWord(match[2], 1);
    pushUniqueAction(actions, {
      type: keyword === 'mill' ? 'mill' : 'keyword_action',
      keywordAction: keyword === 'mill' ? '' : keyword,
      count,
      affectedObjects: keyword === 'mill' ? 'you' : '',
      conditionText: condition,
      triggerText,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `${keyword[0].toUpperCase()}${keyword.slice(1)} ${count}`
    });
  }

  if (/becomes? prepared/i.test(text) || /becomes? prepared/i.test(condition) || /becomes? prepared/i.test(fullText)) {
    const preparedCondition = condition.replace(/,?\s*(?:this|that|it|target .+?) becomes? prepared\.?$/i, '').trim();
    pushUniqueAction(actions, {
      type: 'status_marker',
      status: 'prepared',
      affectedObjects: /target/i.test(text) ? 'target object' : 'this creature',
      conditionText: preparedCondition,
      triggerText,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: 'This creature becomes prepared'
    });
  }

  // Newer/less-common keyword mechanics that are still mostly cost permission templates.
  match = text.match(/^(encore)\s+(\{[^.]+\}|[^{.]+)$/i)
    || text.match(/^(evolve)$/i)
    || text.match(/^(umbra armor|totem armor)$/i)
    || text.match(/^(station)$/i)
    || text.match(/^(ascend)$/i);
  if (match) {
    const keyword = match[1].toLowerCase().replace(/\s+/g, '_');
    const keywordCost = match[2]?.trim() || '';
    const keywordLabels = {
      encore: `Encore${keywordCost ? ` ${keywordCost}` : ''} — create attacking token copies for each opponent from graveyard`,
      evolve: 'Evolve — add a +1/+1 counter when a larger creature enters',
      umbra_armor: 'Umbra armor — replace enchanted creature destruction by destroying this Aura',
      totem_armor: 'Totem armor — replace enchanted creature destruction by destroying this Aura',
      station: 'Station — tap another creature to put charge counters equal to its power on this permanent',
      ascend: "Ascend — get the city's blessing if you control ten or more permanents"
    };
    pushUniqueAction(actions, {
      type: keyword === 'encore' || keyword === 'station' ? 'casting_cost_mechanic' : 'keyword_action',
      keywordAction: keyword,
      costText: keywordCost,
      sourceZoneRequirement: keyword === 'encore' ? 'graveyard' : '',
      createsToken: keyword === 'encore' ? { count: 'for-each-opponent', copySource: 'this card', attacks: true, gains: ['Haste'] } : null,
      replacementKind: keyword === 'umbra_armor' || keyword === 'totem_armor' ? 'destruction-replacement' : '',
      conditionText: keyword === 'evolve' ? 'when a creature you control enters with greater power or toughness than this creature' : '',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: keywordLabels[keyword] || text
    });
  }

  // Room reminder text should not count as an unknown action.
  if (/you may cast either half/i.test(fullText) && /locked door|door unlocks|unlock it/i.test(fullText)) {
    pushUniqueAction(actions, {
      type: 'room_unlock_permission',
      keywordAction: 'room',
      targetCount: { min: 0, max: 0, optional: true },
      ownerHint: 'self',
      label: 'Room — cast either half and unlock locked doors as a sorcery'
    });
  }

  // Modal headers such as "choose up to one —" are not an effect by themselves, but
  // they explain that following bullet lines are modes.
  match = text.match(/^choose\s+(up to\s+)?(one|two|three|x|\d+)\s+—?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'modal_choice_header',
      choiceCount: match[2].toLowerCase(),
      optional: Boolean(match[1]),
      targetCount: { min: 0, max: 0, optional: Boolean(match[1]) },
      ownerHint: 'self',
      label: text.replace(/—$/, '').trim()
    });
  }

  // Counter plus delayed draw rider, e.g. Arcane Denial.
  match = text.match(/^counter\s+target\s+(.+?)\.\s*(.+?)\s+may\s+draw\s+up to\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?\s+at the beginning of (.+)$/i);
  if (match) {
    const targetText = `target ${match[1].trim()}`;
    const count = actionAmountFromWord(match[3], 1);
    pushUniqueAction(actions, {
      type: 'counter_spell',
      affectedObjects: targetText,
      targetFilters: ['Spell'],
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: ownerHintFromText(targetText) || 'opponent',
      label: `Counter ${targetText}`
    });
    pushUniqueAction(actions, {
      type: 'delayed_draw',
      count,
      affectedObjects: match[2].trim(),
      triggerText: `At the beginning of ${match[4].trim()}`,
      optional: true,
      targetCount: { min: 0, max: 0, optional: true },
      ownerHint: ownerHintFromText(match[2]) || 'any',
      label: `${match[2].trim()} may draw up to ${count} card(s) at the beginning of ${match[4].trim()}`
    });
  }

  // Cost reductions with a qualifier between "you cast" and "cost".
  match = text.match(/^(.+?) spells? you cast(?: with (.+?))? cost (\{[^}]+\}|\d+) less to cast(?: if (.+))?$/i)
    || text.match(/^this spell costs (\{[^}]+\}|\d+) less to cast for each (.+)$/i);
  if (match) {
    const isThisSpell = /^this spell costs/i.test(text);
    pushUniqueAction(actions, {
      type: 'spell_cost_modifier',
      affectedObjects: isThisSpell ? 'this spell' : `${match[1].trim()} spells you cast`,
      costReduction: isThisSpell ? match[1].trim() : match[3].trim(),
      amountFormula: isThisSpell ? `count:${normalizeCountSubject(match[2].trim())}` : '',
      amountLabel: isThisSpell ? `for each ${match[2].trim()}` : '',
      conditionText: isThisSpell ? '' : [match[2] ? `with ${match[2].trim()}` : '', match[4] || ''].filter(Boolean).join('; '),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      linkedStatic: !cost,
      label: text
    });
  }

  // Spell groups can be granted a keyword mechanic, e.g. creature spells have convoke.
  match = text.match(/^(.+? spells? you cast) have ([a-z][a-z -]+)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'grant_spell_keyword',
      affectedObjects: match[1].trim(),
      grantedKeyword: match[2].trim(),
      keywordAction: match[2].trim().toLowerCase().replace(/\s+/g, '_'),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      linkedStatic: !cost,
      label: text
    });
  }

  // Permission to cast specific spell types as though they had flash, including "first ... each turn".
  match = text.match(/^you may cast (?:the first )?(.+?) spells? (?:you cast )?(?:each turn )?as though (?:it|they) had flash$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'cast_timing_permission',
      affectedObjects: `${match[1].trim()} spells`,
      timing: 'as-though-flash',
      firstOnly: /the first/i.test(text),
      perTurn: /each turn/i.test(text),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      linkedStatic: !cost,
      label: text
    });
  }

  // Mana flexibility permissions.
  match = text.match(/^you (?:can|may) spend mana of any type to cast (.+)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'mana_spending_permission',
      affectedObjects: match[1].trim(),
      manaMode: 'any-type',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      linkedStatic: !cost,
      label: text
    });
  }

  // Hand-size modifiers beyond "no maximum".
  match = text.match(/^(?:your|you have) maximum hand size is (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'hand_size_modifier',
      affectedObjects: 'you',
      maximumHandSize: actionAmountFromWord(match[1], match[1]),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      linkedStatic: !cost,
      label: text
    });
  }

  // Untap restrictions and tap effects.
  match = text.match(/^(.+?) don'?t untap during (.+?) untap steps?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'untap_restriction',
      affectedObjects: match[1].trim(),
      restrictedTiming: `${match[2].trim()} untap step`,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'any',
      linkedStatic: !cost,
      label: text
    });
  }

  match = text.match(/^tap\s+(all\s+.+|target\s+.+)$/i);
  if (match) {
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'tap',
      affectedObjects,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'any',
      label: text
    });
  }

  // Counter amount replacements and doublers.
  match = `${condition ? `If ${condition}, ` : ''}${text}`.match(/^if (one or more .+? counters?) would be put on (.+?), that many plus (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) (.+? counters?) are put on (?:it|that permanent|that creature) instead$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'counter_replacement',
      replacementKind: 'add-extra-counters',
      affectedObjects: match[2].trim(),
      counterType: match[4].replace(/ counters?$/i, '').trim(),
      bonusAmount: actionAmountFromWord(match[3], 1),
      conditionText: match[1].trim(),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[2]) || 'self',
      linkedStatic: !cost,
      label: text
    });
  }

  match = text.match(/^double the number of (.+?) counters? on (.+)$/i)
    || text.match(/^double the number of each kind of counter on (.+)$/i);
  if (match) {
    const eachKind = /^double the number of each kind/i.test(text);
    pushUniqueAction(actions, {
      type: 'counter_multiplier',
      multiplier: 2,
      counterType: eachKind ? 'each kind' : match[1].trim(),
      affectedObjects: eachKind ? match[1].trim() : match[2].trim(),
      targetFilters: targetFiltersFromText(eachKind ? match[1] : match[2]),
      targetCount: /target|up to/i.test(eachKind ? match[1] : match[2]) ? targetCountFromText(eachKind ? match[1] : match[2]) : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(eachKind ? match[1] : match[2]) || 'self',
      label: text
    });
  }

  // Enters with X counters, including Hydras and scalable permanents.
  match = text.match(/^(this permanent|this creature|this artifact|this enchantment|.+?) enters with (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) (.+?) counters? on it$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'entry_counters',
      affectedObjects: match[1].trim(),
      counterAmount: actionAmountFromWord(match[2], 1),
      counterType: match[3].trim(),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      linkedStatic: true,
      label: text
    });
  }

  // Reanimation/return patterns where no explicit source zone appears because the trigger identifies it.
  match = text.match(/^return\s+(it|this card|that card|that creature|target .+?)\s+to\s+the battlefield(?:\s+under\s+(.+?)\s+control)?(?:\s+with\s+(.+? counter)\s+on it)?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'return_to_battlefield',
      affectedObjects: match[1].trim(),
      destination: 'battlefield',
      controllerHint: match[2]?.trim() || '',
      counterType: match[3]?.trim().replace(/ counter$/i, '') || '',
      sourceZone: triggerText && /dies|graveyard/i.test(triggerText) ? 'graveyard' : '',
      targetFilters: targetFiltersFromText(match[1]),
      targetCount: /target/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[2] || match[1]) || 'self',
      label: text
    });
  }

  // Creature enters/attacks damage equal to its power, or similar dynamic damage.
  match = text.match(/^(.+?) deals? damage equal to (.+?) to (any target|target .+?|each opponent|each creature|each player)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'direct_damage',
      damageSourceText: match[1].trim(),
      damageTargetText: match[3].trim(),
      amount: 'dynamic',
      damageFormula: match[2].trim(),
      targetFilters: /any target/i.test(match[3]) ? ['AnyTarget'] : targetFiltersFromText(match[3]),
      targetCount: /target|any target/i.test(match[3]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[3]) || 'any',
      label: text
    });
  }

  // Creature/enchantment/etc. cost-gated static effects that are restrictions, not actions.
  match = text.match(/^creatures? with power less than (.+?) can'?t block (.+)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'blocking_restriction',
      affectedObjects: `creatures with power less than ${match[1].trim()}`,
      blockedObjects: match[2].trim(),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[2]) || 'opponent',
      linkedStatic: !cost,
      label: text
    });
  }

  return actions;
}

function parsePatch25PredictiveGrammarActions(effectText = '', conditionText = '', triggerText = '', originalText = '', costText = '') {
  const actions = [];
  const text = stripProactiveTimingClauses(effectText);
  const condition = stripProactiveTimingClauses(conditionText);
  const trigger = stripProactiveTimingClauses(triggerText);
  const fullText = stripProactiveTimingClauses(originalText || effectText);
  const cost = stripProactiveTimingClauses(costText);
  const whole = `${trigger ? `${trigger}, ` : ''}${condition ? `if ${condition}, ` : ''}${text}`.replace(/\s+/g, ' ').trim();
  let match;

  // Single-word/single-cost mechanics that commonly appear before the actual modal/effect text.
  match = text.match(/^(cascade)(?:,\s*cascade){0,6}$/i)
    || text.match(/^(escalate|entwine)\s+((?:\{[^}]+\})+)$/i);
  if (match) {
    const keyword = match[1].toLowerCase();
    const instances = keyword === 'cascade' ? (text.match(/cascade/ig) || []).length : 1;
    pushUniqueAction(actions, {
      type: 'casting_cost_mechanic',
      keywordAction: keyword,
      costText: match[2]?.trim() || '',
      cost: parseCostText(match[2] || ''),
      instances,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: keyword === 'cascade'
        ? `Cascade${instances > 1 ? ` ×${instances}` : ''}`
        : `${keyword[0].toUpperCase()}${keyword.slice(1)} ${match[2] || ''}`.trim()
    });
  }

  // Attack/combat P/T multipliers: Grunn, Skullspore, and nearby variants.
  match = text.match(/^double (its|his|her|their|this creature's|target creature's|target .+?'s|.+?'s) power(?: and toughness)?(?: until end of turn)?$/i);
  if (match) {
    const affectedObjects = /^its|his|her|their$/i.test(match[1]) ? 'source creature' : match[1].trim().replace(/'s$/i, '');
    pushUniqueAction(actions, {
      type: /toughness/i.test(text) ? 'double_pt' : 'double_power',
      multiplier: 2,
      affectedObjects,
      powerOnly: !/toughness/i.test(text),
      duration: /until end of turn/i.test(text) ? 'until-end-of-turn' : '',
      triggerText: trigger,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'self',
      label: text
    });
  }

  // Dynamic mill: target/player mills cards equal to a power/number/count.
  match = text.match(/^(target player|each player|each opponent|you|that player) mills? cards? equal to (.+)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'mill',
      affectedObjects: match[1].trim(),
      count: 'dynamic',
      amountFormula: `value:${normalizeCountSubject(match[2].trim())}`,
      amountLabel: `equal to ${match[2].trim()}`,
      targetFilters: /target player/i.test(match[1]) ? ['Player'] : [],
      targetCount: /target/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'any',
      label: text
    });
  }

  // Roll dice and use the result later.
  match = text.match(/^roll (?:a|one) d(4|6|8|10|12|20)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'roll_die',
      die: `d${match[1]}`,
      resultVariable: 'X',
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Become the monarch / initiative-style status changes.
  match = text.match(/^you become the (monarch|initiative)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'player_status',
      status: match[1].toLowerCase(),
      affectedObjects: 'you',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Look at top N, optionally reveal/put a card into hand/battlefield, then bottom the rest.
  match = text.match(/^look at the top (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|that many) cards? of your library\.\s*(?:you may\s+)?(?:reveal\s+)?(?:a|up to one)?\s*([a-z /-]+? card(?: and\/or a [a-z /-]+? card)?|card)?\s*from among them\s+and\s+put\s+it\s+into\s+your hand\.\s*put the rest on the bottom of your library in (?:a random|any) order$/i)
    || text.match(/^look at the top (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|that many) cards? of your library\.\s*(?:you may\s+)?put\s+(?:a|up to one)?\s*([a-z /-]+? card(?: and\/or a [a-z /-]+? card)?|card)\s+from among them\s+onto the battlefield(?: tapped)?\.\s*put the rest on the bottom of your library in (?:a random|any) order$/i);
  if (match) {
    const toBattlefield = /onto the battlefield/i.test(text);
    const topCount = /^that many$/i.test(match[1]) ? 'trigger-damage-count' : actionAmountFromWord(match[1], 1);
    const selectedCardText = (match[2] || 'card').trim();
    pushUniqueAction(actions, {
      type: toBattlefield ? 'top_library_select_to_battlefield' : 'top_library_select_to_hand',
      sourceZone: 'library-top',
      destination: toBattlefield ? (/battlefield tapped/i.test(text) ? 'battlefield-tapped' : 'battlefield') : 'hand',
      topCount,
      selectedCardText,
      reveal: /reveal/i.test(text),
      optional: /may|up to/i.test(text),
      restDestination: 'library-bottom',
      restOrder: /random/i.test(text) ? 'random' : 'any',
      targetFilters: targetFiltersFromText(selectedCardText),
      targetCount: { min: 0, max: 0, optional: /may|up to/i.test(text) },
      ownerHint: 'self',
      label: text
    });
  }

  // Reveal top N/that many cards, put selected creature/land cards onto battlefield.
  match = text.match(/^reveal (that many|x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards? from the top of your library\.\s*(?:you may\s+)?put\s+(.+?)\s+from among them onto the battlefield\.\s*put the rest on the bottom in (?:a random|any) order$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'top_library_select_to_battlefield',
      sourceZone: 'library-top',
      destination: 'battlefield',
      topCount: /^that many$/i.test(match[1]) ? 'trigger-damage-count' : actionAmountFromWord(match[1], 1),
      selectedCardText: match[2].trim(),
      reveal: true,
      optional: /may|up to/i.test(text),
      restDestination: 'library-bottom',
      restOrder: /random/i.test(text) ? 'random' : 'any',
      targetFilters: targetFiltersFromText(match[2]),
      targetCount: { min: 0, max: 0, optional: /may|up to/i.test(text) },
      ownerHint: 'self',
      label: text
    });
  }

  // Mill then put cards from among the milled cards onto the battlefield/hand.
  match = text.match(/^mill (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards?\.\s*put\s+(.+?)\s+from among the milled cards onto the battlefield(?: tapped)?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'mill_then_move_milled',
      millCount: actionAmountFromWord(match[1], 1),
      movedObjects: match[2].trim(),
      sourceZone: 'milled-cards',
      destination: /battlefield tapped/i.test(text) ? 'battlefield-tapped' : 'battlefield',
      optional: /up to/i.test(text),
      targetFilters: targetFiltersFromText(match[2]),
      targetCount: { min: 0, max: 0, optional: /up to/i.test(text) },
      ownerHint: 'self',
      label: text
    });
  }

  // Transform variants, including direct transform activations and death return transformed.
  match = text.match(/^transform (this land|this creature|this permanent|.+)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'transform',
      affectedObjects: match[1].trim(),
      conditionText: condition,
      costText: cost,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }
  match = text.match(/^return (it|this card|this creature|.+?) to the battlefield tapped and transformed under (.+?) control$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'return_to_battlefield',
      affectedObjects: match[1].trim(),
      sourceZone: /dies|graveyard/i.test(trigger) ? 'graveyard' : '',
      destination: 'battlefield-tapped-transformed',
      controllerHint: match[2].trim(),
      transform: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[2]) || 'self',
      label: text
    });
  }

  // Battle/Siege combat-damage assignment permission.
  match = text.match(/^(?:for each (.+?),\s*)?(?:you may have )?that creature assign its combat damage as though it weren'?t blocked$/i)
    || text.match(/^(.+?) assign (?:their|its) combat damage as though (?:they|it) weren'?t blocked$/i);
  if (match) {
    const affectedObjects = (match[1] || 'that creature').trim();
    pushUniqueAction(actions, {
      type: 'combat_damage_assignment_permission',
      affectedObjects,
      permission: 'assign_as_unblocked',
      optional: /may/i.test(text),
      targetCount: { min: 0, max: 0, optional: /may/i.test(text) },
      ownerHint: ownerHintFromText(affectedObjects) || 'self',
      linkedStatic: !cost,
      label: text
    });
  }

  // Additional land variants with "up to" counts and each-player phrasing.
  match = text.match(/^(you|each player) may play (?:up to\s+)?(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|an?) additional lands?(?: on each of (?:your|their) turns| this turn)?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'additional_land_play',
      affectedObjects: match[1].trim(),
      amount: /^[Aa]n?$/.test(match[2]) ? 1 : actionAmountFromWord(match[2], 1),
      duration: /this turn/i.test(text) ? 'this-turn' : '',
      linkedStatic: !/this turn/i.test(text),
      optional: true,
      targetCount: { min: 0, max: 0, optional: true },
      ownerHint: ownerHintFromText(match[1]) || 'self',
      label: text
    });
  }

  // Mana production replacement: double/triple/half/twice as much of that mana.
  match = `${condition ? `If ${condition}, ` : ''}${text}`.match(/^if (.+?) tap(?:s)? (?:a|any)?\s*permanent for mana, it produces (twice|double|triple|three times|half) as much of that mana instead$/i)
    || `${condition ? `If ${condition}, ` : ''}${text}`.match(/^if (you|an opponent|a player) tap(?:s)? (?:a|any)?\s*(land|permanent) for mana, (?:that land|it) produces (twice|double|triple|three times|half) as much of that mana instead$/i);
  if (match) {
    const multiplierText = (match[2] || match[3] || '').toLowerCase();
    pushUniqueAction(actions, {
      type: 'mana_production_replacement',
      multiplier: /triple|three/.test(multiplierText) ? 3 : (/half/.test(multiplierText) ? 0.5 : 2),
      affectedObjects: match[1].trim(),
      conditionText: condition || `${match[1].trim()} taps a permanent for mana`,
      linkedStatic: !cost,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'self',
      label: text
    });
  }

  // Counters prevention/modification: Melira and Vorinclex-style effects.
  match = text.match(/^you can'?t get (.+?) counters$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'counter_prevention',
      affectedObjects: 'you',
      counterType: match[1].trim(),
      linkedStatic: !cost,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }
  match = text.match(/^(.+?) can'?t have (.+?) counters? put on them$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'counter_prevention',
      affectedObjects: match[1].trim(),
      counterType: match[2].trim(),
      linkedStatic: !cost,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'self',
      label: text
    });
  }
  match = `${condition ? `If ${condition}, ` : ''}${text}`.match(/^if (.+?) would put one or more counters on (.+?), (?:they|you|that player)?\s*put (twice|double|half) that many(?: of each of those kinds of counters)? on (?:that permanent or player|that permanent|that player|it|them)(?: instead)?(?:, rounded down)?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'counter_replacement',
      replacementKind: /half/i.test(match[3]) ? 'counter-halving' : 'counter-doubling',
      multiplier: /half/i.test(match[3]) ? 0.5 : 2,
      affectedObjects: match[2].trim(),
      conditionText: condition || `${match[1].trim()} would put one or more counters`,
      rounded: /rounded down/i.test(text) ? 'down' : '',
      linkedStatic: !cost,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'self',
      label: text
    });
  }

  // Remove keyword traits from a class of objects.
  match = text.match(/^(.+?) lose (.+)$/i);
  if (match) {
    const traits = extractKeywordTraits(match[2]);
    if (traits.length) {
      pushUniqueAction(actions, {
        type: 'remove_traits',
        affectedObjects: match[1].trim(),
        traits,
        linkedStatic: !/until end of turn/i.test(text),
        duration: /until end of turn/i.test(text) ? 'until-end-of-turn' : '',
        targetCount: { min: 0, max: 0, optional: false },
        ownerHint: ownerHintFromText(match[1]) || 'opponent',
        label: text
      });
    }
  }

  // Land/permanent next-untap-step freeze triggered by tapping for mana.
  match = text.match(/^(that land|that permanent|it|.+?) doesn'?t untap during (.+?) next untap step$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'untap_restriction',
      affectedObjects: match[1].trim(),
      restrictedTiming: `${match[2].trim()} next untap step`,
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[2]) || 'opponent',
      label: text
    });
  }

  // Distribute counters among targets. This improves Saga/planeswalker chapters like
  // "Distribute seven +1/+1 counters among any number of target creatures you control" and
  // nearby variants with charge/lore/flying/finality counters.
  match = text.match(/^distribute\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+?)\s+counters?\s+among\s+(any number of|up to (?:x|\d+|one|two|three|four|five|six|seven|eight|nine|ten))\s+target\s+(.+)$/i);
  if (match) {
    const maxTargets = /any number/i.test(match[3]) ? 'any' : actionAmountFromWord(match[3].replace(/^up to\s+/i, ''), 1);
    pushUniqueAction(actions, {
      type: 'distribute_counters',
      counterType: match[2].trim(),
      amount: actionAmountFromWord(match[1], 1),
      affectedObjects: `target ${match[4].trim()}`,
      targetFilters: targetFiltersFromText(match[4]),
      targetCount: { min: 1, max: maxTargets, optional: /up to/i.test(match[3]) },
      ownerHint: ownerHintFromText(match[4]) || 'self',
      label: text
    });
  }

  // Small generic lines that appeared as misses but are useful future catch-alls.
  match = text.match(/^(.+?) fights target (.+)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'fight',
      affectedObjects: match[1].trim(),
      fightTargetText: `target ${match[2].trim()}`,
      targetFilters: ['Creature'],
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: ownerHintFromText(match[2]) || 'opponent',
      label: text
    });
  }

  return actions;
}


function parsePatch27PredictiveGrammarActions(effectText = '', conditionText = '', triggerText = '', originalText = '', costText = '') {
  const actions = [];
  const text = stripProactiveTimingClauses(effectText);
  const condition = stripProactiveTimingClauses(conditionText);
  const trigger = stripProactiveTimingClauses(triggerText);
  const fullText = stripProactiveTimingClauses(originalText || effectText);
  const cost = stripProactiveTimingClauses(costText);
  const whole = `${trigger ? `${trigger}. ` : ''}${condition ? `If ${condition}. ` : ''}${text}`.replace(/\s+/g, ' ').trim();
  const originalWhole = String(originalText || effectText || '').replace(/\s+/g, ' ').trim();
  let match;

  // Aura reanimation wrappers: Animate Dead / Dance of the Dead / Necromancy-style text.
  // The real action is buried after the Aura changes what it enchants.
  match = whole.match(/return (enchanted|target|that|this|a|the)\s+(.+? creature card|creature card|card)\s+to the battlefield(?: under your control)?(?: and attach (?:this aura|.+?) to it)?/i)
    || originalWhole.match(/return (enchanted|target|that|this|a|the)\s+(.+? creature card|creature card|card)\s+to the battlefield(?: under your control)?(?: and attach (?:this aura|.+?) to it)?/i);
  if (match) {
    const affectedObjects = `${match[1]} ${match[2]}`.replace(/\s+/g, ' ').trim();
    pushUniqueAction(actions, {
      type: 'return_from_graveyard_to_battlefield',
      affectedObjects,
      sourceZone: /graveyard/i.test(originalWhole) ? 'graveyard' : '',
      destination: 'battlefield',
      attachSource: /attach/i.test(originalWhole) ? 'this Aura' : '',
      controllerHint: /under your control/i.test(originalWhole) ? 'you' : '',
      triggerText: trigger,
      conditionText: condition,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: /under your control/i.test(originalWhole) ? 'self' : ownerHintFromText(affectedObjects) || 'any',
      label: originalWhole
    });
  }

  // Sacrifice requirements and delayed sacrifice hooks, including "that creature's controller sacrifices it".
  match = text.match(/^(?:(that|enchanted|target|this)\s+)?(.+?)'?s controller sacrifices (it|that creature|that permanent|this creature)$/i)
    || text.match(/^(?:you|target player|each opponent|that player) sacrifices? (.+)$/i)
    || text.match(/^sacrifice (another\s+)?(.+)$/i);
  if (match) {
    const affectedObjects = (match[3] || match[2] || match[1] || 'permanent').trim();
    pushUniqueAction(actions, {
      type: 'sacrifice',
      affectedObjects,
      sacrificeController: /controller sacrifices/i.test(text) ? `${match[1] || 'that'} object's controller` : (/^you sacrifice/i.test(text) ? 'you' : ''),
      triggerText: trigger,
      conditionText: condition,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: /target/i.test(text) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(text) || 'any',
      label: text
    });
  }

  // Delayed returns: "return this card/it to the battlefield at the beginning of the next end step", with counters optional.
  match = text.match(/^return (this card|it|that card|this creature|enchanted creature|target creature card|.+?) to the battlefield(?: with (.+?) on it)?(?: tapped)?(?: under .+? control)? at the beginning of the next end step$/i)
    || text.match(/^return (this card|it|that card|this creature|enchanted creature|target creature card|.+?) to the battlefield(?: with (.+?) on it)? at the beginning of the next end step$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'delayed_return_to_battlefield',
      affectedObjects: match[1].trim(),
      sourceZone: /dies|graveyard/i.test(trigger) ? 'graveyard' : '',
      destination: /tapped/i.test(text) ? 'battlefield-tapped' : 'battlefield',
      counterChangeText: match[2]?.trim() || '',
      delay: 'beginning-of-next-end-step',
      triggerText: trigger,
      conditionText: condition,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(text) || 'self',
      label: text
    });
  }

  // Ability-word timing collapsed into condition/effect by the splitter, e.g. Morbid — At beginning..., if ..., draw.
  if ((/\b(morbid|ferocious|formidable|raid|landfall|constellation|revolt|delirium|threshold)\b/i.test(originalWhole) || /at the beginning|whenever|when/i.test(text))
    && /\bdraw (?:a|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+) cards?\b/i.test(`${condition} ${text} ${originalWhole}`)) {
    const amountMatch = `${condition} ${text} ${originalWhole}`.match(/draw (a|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+) cards?/i);
    pushUniqueAction(actions, {
      type: 'draw',
      amount: actionAmountFromWord(amountMatch?.[1] || 'a', 1),
      triggerText: trigger || (originalWhole.match(/at the beginning of.+?(?=,| if| you may|$)/i)?.[0] || ''),
      conditionText: condition,
      optional: /may draw/i.test(`${condition} ${text} ${originalWhole}`),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: originalWhole
    });
  }

  // Goad and forced-attack templates. This also catches Kardur-style text without the word "goad".
  match = text.match(/^goad (.+)$/i)
    || text.match(/^until your next turn, (.+?) attack each combat if able and attack a player other than you if able$/i)
    || text.match(/^(.+?) attack each combat if able and attack a player other than you if able$/i)
    || ((/attack each combat$/i.test(text) && /attack a player other than you if able/i.test(condition))
      ? [, text.replace(/^until your next turn,\s*/i, '').replace(/\s+attack each combat$/i, '').trim()]
      : null);
  if (match) {
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'goad',
      affectedObjects,
      duration: /until your next turn/i.test(text) ? 'until-your-next-turn' : '',
      attackRequirement: 'attack-each-combat-if-able',
      attackRestriction: 'attack-player-other-than-you-if-able',
      triggerText: trigger,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'opponent',
      label: text
    });
  }

  // Triggered optional exile, then token-copy replacement/copy creation.
  match = whole.match(/you may exile (it|that creature|that card|.+?)\. If you do, create (?:a|one) tokens? (?:that'?s|that's|which is)?\s*a copy of (that creature|it|that card|.+?)(?:, except (.+))?$/i)
    || originalWhole.match(/you may exile (it|that creature|that card|.+?)\. If you do, create (?:a|one) tokens? (?:that'?s|that's|which is)?\s*a copy of (that creature|it|that card|.+?)(?:, except (.+))?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'exile_then_create_token_copy',
      exiledObject: match[1].trim(),
      copiedObject: match[2].trim(),
      tokenModificationText: match[3]?.trim() || '',
      optional: true,
      triggerText: trigger,
      conditionText: condition,
      targetCount: { min: 0, max: 0, optional: true },
      ownerHint: 'self',
      label: originalWhole
    });
  }

  // Repeat-process / punisher choices: Torment of Hailfire and nearby "unless" variants.
  match = text.match(/^repeat the following process (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) times?\. (.+?) loses? (\d+|one|two|three|four|five|six|seven|eight|nine|ten|x) life unless (.+)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'repeat_punisher_life_loss',
      repeatCount: actionAmountFromWord(match[1], 'X'),
      affectedObjects: match[2].trim(),
      lifeLoss: actionAmountFromWord(match[3], 1),
      unlessText: match[4].trim(),
      choices: match[4].split(/\s+or\s+/i).map((item) => item.trim()).filter(Boolean),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[2]) || 'opponent',
      label: text
    });
  }

  // Entering under another player's control / donate-on-entry variants.
  match = text.match(/^(.+?) enters under the control of (.+)$/i)
    || text.match(/^(.+?) enters the battlefield under the control of (.+)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'entry_controller_replacement',
      affectedObjects: match[1].trim(),
      controllerHint: match[2].trim(),
      linkedStatic: !cost,
      targetCount: { min: 0, max: 0, optional: /choice|chosen|may/i.test(match[2]) },
      ownerHint: ownerHintFromText(match[2]) || 'opponent',
      label: text
    });
  }

  // Simple "has/is goaded" inside Aura static lines that also modify P/T.
  if (/\bis goaded\b/i.test(text) || /\bhas goad\b/i.test(text)) {
    const affectedObjects = text.match(/^(enchanted creature|equipped creature|target creature|.+?)\s+(?:gets|has|is)\b/i)?.[1]?.trim() || 'creature';
    pushUniqueAction(actions, {
      type: 'goad',
      affectedObjects,
      linkedStatic: !/until/i.test(text),
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'any',
      label: text
    });
  }

  return actions;
}


function parsePatch28PredictiveGrammarActions(effectText = '', conditionText = '', triggerText = '', originalText = '', costText = '') {
  const actions = [];
  const text = stripProactiveTimingClauses(effectText);
  const condition = stripProactiveTimingClauses(conditionText);
  const trigger = stripProactiveTimingClauses(triggerText);
  const fullText = stripProactiveTimingClauses(originalText || effectText);
  const originalWhole = String(originalText || effectText || '').replace(/\s+/g, ' ').trim();
  const cost = stripProactiveTimingClauses(costText);
  const conditionPlusEffect = `${condition ? `If ${condition}, ` : ''}${text}`.replace(/\s+/g, ' ').trim();
  const lowerWhole = `${condition} ${text} ${originalWhole}`.toLowerCase();
  let match;

  // Reverse-order reanimation: "Return from your graveyard to the battlefield any number of...".
  match = text.match(/^return\s+from\s+(your|a|any|target player'?s|that player'?s)\s+graveyard\s+to\s+the battlefield\s+(.+)$/i);
  if (match) {
    const affectedObjects = match[2].trim();
    pushUniqueAction(actions, {
      type: 'move_to_battlefield',
      affectedObjects,
      sourceZone: 'graveyard',
      sourceOwner: match[1].trim(),
      destination: 'battlefield',
      optional: /any number|up to/i.test(affectedObjects),
      triggerText: trigger,
      conditionText: condition,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: ownerHintFromText(match[1]) || 'self',
      label: text
    });
  }

  // Wider graveyard-to-battlefield family with "any number", Aura/Equipment, attachments, counters, tapped/transformed, etc.
  match = text.match(/^(?:you may\s+)?(?:return|put)\s+(any number of|up to \w+|all|each|target|that|this|it|.+?)\s*(.+?)?\s+from\s+(your|a|any|target player'?s|that player'?s|its owner'?s)?\s*graveyard\s+(?:to|onto)\s+the battlefield(?:\s+(tapped))?(?:\s+under\s+(.+?)\s+control)?(?:\s+with\s+(.+?)\s+on it)?(?:\s+attached to\s+(.+))?$/i);
  if (match && !/counter on/i.test(text)) {
    const affectedObjects = `${match[1] || ''} ${match[2] || ''}`.replace(/\s+/g, ' ').trim();
    pushUniqueAction(actions, {
      type: 'move_to_battlefield',
      affectedObjects,
      sourceZone: 'graveyard',
      sourceOwner: (match[3] || '').trim(),
      destination: match[4] ? 'battlefield-tapped' : 'battlefield',
      controllerHint: match[5]?.trim() || '',
      counterText: match[6]?.trim() || '',
      attachTo: match[7]?.trim() || '',
      optional: /\bmay\b|any number|up to/i.test(text),
      triggerText: trigger,
      conditionText: condition,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: ownerHintFromText(`${match[3] || ''} ${affectedObjects}`) || 'self',
      label: text
    });
  }

  // Delayed self/creature returns with tapped/counters/next-end-step wording.
  match = text.match(/^return\s+(.+?)\s+to the battlefield(?:\s+tapped)?(?:\s+under\s+(.+?)\s+control)?(?:\s+with\s+(.+?)\s+on it)?(?:\s+at the beginning of the next end step)?$/i);
  if (match && /dies|leaves the battlefield|no counters|revival counter|stun counter|flying counter/i.test(`${trigger} ${condition} ${text}`)) {
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: /at the beginning of the next end step/i.test(text) ? 'delayed_return_to_battlefield' : 'move_to_battlefield',
      affectedObjects,
      sourceZone: /dies|graveyard/i.test(trigger) ? 'graveyard' : '',
      destination: /battlefield tapped|to the battlefield tapped/i.test(text) ? 'battlefield-tapped' : 'battlefield',
      controllerHint: match[2]?.trim() || '',
      counterText: match[3]?.trim() || '',
      delay: /at the beginning of the next end step/i.test(text) ? 'beginning-of-next-end-step' : '',
      triggerText: trigger,
      conditionText: condition,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: ownerHintFromText(text) || 'self',
      label: text
    });
  }

  // Attach Aura/Equipment patterns. This is intentionally broad because Equipment decks repeat this grammar a lot.
  match = text.match(/^(?:you may\s+)?attach\s+(.+?)\s+to\s+(.+)$/i);
  if (match) {
    const equipmentText = match[1].trim();
    const attachTo = match[2].trim();
    pushUniqueAction(actions, {
      type: 'attach_permanent',
      attachedObject: equipmentText,
      affectedObjects: attachTo,
      equipmentText,
      attachTo,
      optional: /\bmay\b|up to|any number/i.test(text),
      triggerText: trigger,
      conditionText: condition,
      targetFilters: ['Aura', 'Equipment', ...targetFiltersFromText(attachTo)].filter(Boolean),
      targetCount: /target/i.test(`${equipmentText} ${attachTo}`) ? { min: 1, max: /any number/i.test(equipmentText) ? 'any' : 1, optional: /may|up to/i.test(text) } : { min: 0, max: /any number/i.test(equipmentText) ? 'any' : 0, optional: /may/i.test(text) },
      ownerHint: ownerHintFromText(`${equipmentText} ${attachTo}`) || 'self',
      label: text
    });
  }

  // Static grants: Commanders have ward, Equipment have equip {0}, spells have flash/convoke, etc.
  match = text.match(/^(.+?)\s+(?:you control\s+)?have\s+(ward\s+\{[^}]+\}|equip\s+\{[^}]+\}|convoke|flash|(?:[a-z ]+))(?:\s+as long as\s+(.+))?$/i);
  if (match && /ward|equip|convoke|flash|double strike|first strike|vigilance|trample|haste|hexproof|indestructible|lifelink|deathtouch/i.test(match[2])) {
    const affectedObjects = match[1].trim() + (/you control/i.test(text) && !/you control/i.test(match[1]) ? ' you control' : '');
    const traits = /equip\s+\{/i.test(match[2])
      ? []
      : (/ward|convoke|flash/i.test(match[2]) ? [match[2].trim()] : extractKeywordTraits(match[2]));
    if (/equip\s+\{/i.test(match[2])) {
      pushUniqueAction(actions, {
        type: 'grant_activated_ability',
        affectedObjects,
        grantedAbility: match[2].trim(),
        costText: match[2].match(/\{[^}]+\}/)?.[0] || '',
        conditionText: match[3]?.trim() || condition,
        linkedStatic: true,
        targetCount: { min: 0, max: 0, optional: false },
        ownerHint: ownerHintFromText(affectedObjects) || 'self',
        label: text
      });
    } else {
      for (const trait of traits) {
        pushUniqueAction(actions, {
          type: 'grant_trait',
          affectedObjects,
          trait,
          conditionText: match[3]?.trim() || condition,
          linkedStatic: true,
          targetFilters: targetFiltersFromText(affectedObjects),
          targetCount: { min: 0, max: 0, optional: false },
          ownerHint: ownerHintFromText(affectedObjects) || 'self',
          label: `Grant ${trait} to ${affectedObjects}`
        });
      }
    }
  }

  // Triggered-ability copy/multiplier grammar: "that ability triggers an additional time".
  match = conditionPlusEffect.match(/^if\s+(.+?)\s+triggers?,\s+(that ability|it|the ability) triggers? an additional time$/i)
    || text.match(/^(.+?) triggers? an additional time$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'copy_triggered_ability',
      affectedObjects: match[1].trim(),
      additionalTriggers: 1,
      conditionText: condition,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Life-loss replacement / half-life loss: Bloodletter, Shredder, Unstoppable Slasher.
  match = conditionPlusEffect.match(/^if\s+(.+?)\s+would lose life(?: during your turn)?,\s*(?:that player|they|he or she|it) loses? (twice|double|half) that much life instead$/i);
  if (match) {
    const rawMode = match[2].toLowerCase();
    pushUniqueAction(actions, {
      type: 'life_loss_replacement',
      replacementKind: /half/i.test(rawMode) ? 'life-loss-half' : 'life-loss-double',
      affectedObjects: match[1].trim(),
      multiplier: /half/i.test(rawMode) ? 0.5 : 2,
      conditionText: condition || `${match[1].trim()} would lose life`,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'opponent',
      label: text
    });
  }
  match = text.match(/^(that player|they|target player|each opponent|.+?) loses? half (?:their|his or her|that player'?s) life, rounded (up|down)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'lose_life',
      affectedObjects: match[1].trim(),
      amount: 'dynamic',
      amountFormula: 'life-total/2',
      amountLabel: `half their life, rounded ${match[2].toLowerCase()}`,
      rounding: match[2].toLowerCase(),
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'opponent',
      label: text
    });
  }

  // Damage mirroring / spillover: "it deals that much damage to each other opponent".
  match = text.match(/^(.+?) deals? that much damage to (each other opponent|each opponent|target player|any target)$/i);
  if (match) {
    const mirroredTarget = match[2].trim();
    const triggeredMirror = /when|whenever|at/i.test(trigger) || /combat damage/i.test(trigger) || /enchanted creature/i.test(match[1]);
    pushUniqueAction(actions, {
      type: triggeredMirror ? 'triggered_damage_echo' : 'direct_damage',
      damageSourceText: match[1].trim(),
      damageTargetText: mirroredTarget,
      affectedObjects: mirroredTarget,
      amount: 'dynamic',
      damageFormula: 'that-much-damage',
      amountLabel: 'that much damage',
      triggerText: trigger,
      linkedStatic: triggeredMirror,
      targetFilters: /target|any target/i.test(mirroredTarget) ? ['AnyTarget'] : ['Player'],
      targetCount: /target|any target/i.test(mirroredTarget) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(mirroredTarget) || 'opponent',
      label: text
    });
  }

  // Prevent all damage by a source class, not only damage "to" something.
  match = text.match(/^prevent all damage that would be dealt by (.+?) this turn$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'prevent_damage',
      amount: 'all',
      sourceText: match[1].trim(),
      affectedObjects: 'all damage',
      duration: 'this-turn',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'any',
      label: text
    });
  }

  // Additional-cost life payment.
  match = text.match(/^as an additional cost to cast this spell, pay (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) life$/i);
  if (match) {
    const amount = actionAmountFromWord(match[1], 'X');
    pushUniqueAction(actions, {
      type: 'additional_cast_cost',
      costKind: 'pay_life',
      optional: false,
      appliesOnStack: true,
      additionalCost: { kind: 'pay_life', amount, label: `Pay ${amount} life` },
      lifePayment: amount,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Keyword actions not represented as cost mechanics: connive N and mobilize N.
  match = text.match(/^(.+?) connives? (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:, where x is (.+))?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'keyword_action',
      keywordAction: 'connive',
      affectedObjects: match[1].trim(),
      amount: actionAmountFromWord(match[2], 'X'),
      amountFormula: match[3] ? `count:${normalizeCountSubject(match[3].trim())}` : '',
      targetFilters: targetFiltersFromText(match[1]),
      targetCount: /target/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'self',
      label: text
    });
  }
  match = text.match(/^mobilize\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'keyword_action',
      keywordAction: 'mobilize',
      amount: actionAmountFromWord(match[1], 'X'),
      tokenCount: actionAmountFromWord(match[1], 'X'),
      createsTappedAndAttackingTokens: true,
      delayedSacrifice: 'beginning-of-next-end-step',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Legend rule exception.
  if (/^the ["“]?legend rule["”]? doesn'?t apply to (.+)$/i.test(text)) {
    const affectedObjects = text.match(/^the ["“]?legend rule["”]? doesn'?t apply to (.+)$/i)?.[1]?.trim() || 'permanents you control';
    pushUniqueAction(actions, {
      type: 'legend_rule_exception',
      affectedObjects,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'self',
      label: text
    });
  }

  // Land type addition generalized beyond Forest/Yavimaya.
  match = text.match(/^each land is a (plains|island|swamp|mountain|forest|wastes|desert|gate) in addition to its other land types$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'type_addition_static',
      affectedObjects: 'each land',
      addedTypesText: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(),
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'any',
      label: text
    });
  }

  // Top-library impulse / Urza-style play permission after shuffle/exile.
  match = text.match(/^shuffle your library, then exile the top card\. Until end of turn, you may play that card without paying its mana cost$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'shuffle_exile_top_play_free',
      sourceZone: 'library',
      destination: 'exile',
      playPermission: 'play_exiled_card_without_paying_mana_cost',
      duration: 'until-end-of-turn',
      optional: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Combined discard/untap combat-damage triggers, and broader discard-then-board-action chains.
  match = text.match(/^(that player|target player|each opponent|.+?) discards? (a|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+) cards? and you untap (.+)$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'discard',
      affectedObjects: match[1].trim(),
      count: actionAmountFromWord(match[2], 1),
      triggerText: trigger,
      targetCount: /target player/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'opponent',
      label: `${match[1].trim()} discards ${actionAmountFromWord(match[2], 1)} card(s)`
    });
    pushUniqueAction(actions, {
      type: 'untap',
      affectedObjects: match[3].trim(),
      triggerText: trigger,
      targetFilters: targetFiltersFromText(match[3]),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Untap ${match[3].trim()}`
    });
  }

  // Named-land ETB pay-life-or-tapped variants that don't say "this land".
  match = text.match(/^as (.+?) enters, you may pay (\d+|one|two|three|four|five|six|seven|eight|nine|ten) life\. If you don'?t, it enters tapped$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'entry_replacement_pay_life_or_tapped',
      affectedObjects: match[1].trim(),
      lifePayment: numberFromText(match[2], 3),
      entersTappedUnlessPaid: true,
      optional: true,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Spell-casting restrictions like "opponents can't cast spells during your turn".
  match = text.match(/^(your opponents|opponents|players|each opponent|target player) can'?t cast (spells|noncreature spells|creature spells|instant spells|sorcery spells)(?: during (.+)| this turn)?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'spell_casting_restriction',
      affectedObjects: match[1].trim(),
      restrictedSpells: match[2].trim(),
      restrictedTiming: match[3]?.trim() || (/this turn/i.test(text) ? 'this turn' : ''),
      linkedStatic: !/this turn/i.test(text),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'opponent',
      label: text
    });
  }

  return actions;
}


function parsePatch29PredictiveGrammarActions(effectText = '', conditionText = '', triggerText = '', originalText = '', costText = '') {
  const actions = [];
  const text = stripProactiveTimingClauses(effectText);
  const condition = stripProactiveTimingClauses(conditionText);
  const trigger = stripProactiveTimingClauses(triggerText);
  const fullText = stripProactiveTimingClauses(originalText || effectText);
  const cost = stripProactiveTimingClauses(costText);
  const whole = `${condition} ${text} ${fullText}`.replace(/\s+/g, ' ').trim();
  let match;

  // New/Universes mechanics that behave like alternate casting/recast shells.
  match = text.match(/^(warp|flashback)[—\- ]+(.+?)$/i)
    || fullText.match(/^(warp|flashback)\s*([—\- ]+)?(.+?)(?:\s*\(|$)/i);
  if (match) {
    const keyword = match[1].toLowerCase();
    const rawCost = (match[3] || match[2] || '').trim().replace(/[.]+$/g, '');
    pushUniqueAction(actions, {
      type: 'casting_cost_mechanic',
      keywordAction: keyword,
      costText: rawCost,
      cost: parseCostText(rawCost),
      optional: true,
      appliesOnStack: true,
      sourceZoneRequirement: keyword === 'flashback' ? 'graveyard' : 'hand',
      delayedExile: true,
      laterCastPermission: keyword === 'warp' ? 'cast_from_exile_on_later_turn' : '',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `${keyword[0].toUpperCase()}${keyword.slice(1)} ${rawCost}`.trim()
    });
  }

  // Ward variants that use non-mana payments, and granted ward text in quotes.
  match = text.match(/^ward[—\- ]+pay\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life$/i);
  if (match) {
    const amount = actionAmountFromWord(match[1], 1);
    pushUniqueAction(actions, {
      type: 'intrinsic_trait',
      trait: `Ward—Pay ${amount} life`,
      wardCost: { kind: 'pay_life', amount },
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Ward—Pay ${amount} life`
    });
  }
  match = text.match(/^(.+?)\s+have\s+["“]?ward[—\- ]+pay\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life["”]?$/i);
  if (match) {
    const amount = actionAmountFromWord(match[2], 1);
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'grant_trait',
      affectedObjects,
      trait: `Ward—Pay ${amount} life`,
      wardCost: { kind: 'pay_life', amount },
      linkedStatic: true,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'self',
      label: `Grant Ward—Pay ${amount} life to ${affectedObjects}`
    });
  }

  // Change/redirect target effects.
  match = text.match(/^change the target of (target .+?)(?: with a single target)?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'change_target',
      affectedObjects: match[1].trim(),
      targetFilters: /ability/i.test(match[1]) && /spell/i.test(match[1]) ? ['Spell', 'Ability'] : (/ability/i.test(match[1]) ? ['Ability'] : ['Spell']),
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'any',
      label: text
    });
  }

  // Additional cost: pay life or mana, not just pay life.
  match = text.match(/^as an additional cost to cast this spell, pay\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\s+or\s+pay\s+(\{[^}]+\})$/i);
  if (match) {
    const lifeAmount = actionAmountFromWord(match[1], 1);
    pushUniqueAction(actions, {
      type: 'additional_cast_cost',
      costKind: 'pay_life_or_mana',
      appliesOnStack: true,
      optional: false,
      additionalCost: {
        kind: 'choose_pay_life_or_mana',
        lifeAmount,
        manaCost: match[2],
        label: `Pay ${lifeAmount} life or pay ${match[2]}`
      },
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Cost taxes and discounts with "each/the first/... spell" grammar.
  match = text.match(/^(each|the first|your first|spells?|creature spells?|noncreature spells?|artifact spells?|instant spells?|sorcery spells?|enchantment spells?|planeswalker spells?|commander spells?)(?:\s+(.+?))?\s+costs?\s+(\{[^}]+\})\s+(more|less)\s+to cast(?:\s+except during\s+(.+?))?$/i);
  if (match) {
    const affectedObjects = `${match[1]} ${match[2] || ''}`.replace(/\s+/g, ' ').trim();
    pushUniqueAction(actions, {
      type: 'spell_cost_modifier',
      affectedObjects,
      modifier: match[4].toLowerCase(),
      amount: match[3],
      costDelta: match[4].toLowerCase() === 'less' ? `-${match[3]}` : `+${match[3]}`,
      exceptionText: match[5]?.trim() || '',
      conditionText: condition,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'any',
      label: text
    });
  }

  // "First spell you cast each turn costs less" variants not caught by the generic tax regex.
  match = text.match(/^the first\s+(.+?spell)\s+you cast each turn costs\s+(\{[^}]+\})\s+less to cast$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'spell_cost_modifier',
      affectedObjects: `the first ${match[1].trim()} you cast each turn`,
      modifier: 'less',
      amount: match[2],
      costDelta: `-${match[2]}`,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Choose/keep some permanents, then sacrifice the rest.
  match = text.match(/^(that player|target player|each player|each opponent|you) chooses? up to\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+?)\s+they control, then sacrifices? the rest$/i);
  if (match) {
    const count = actionAmountFromWord(match[2], 1);
    pushUniqueAction(actions, {
      type: 'sacrifice_remainder',
      affectedObjects: match[3].trim(),
      keepCount: count,
      choosingPlayer: match[1].trim(),
      triggerText: trigger,
      targetFilters: targetFiltersFromText(match[3]),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'opponent',
      label: text
    });
  }

  // Exile top-card/free-cast chains: Etali-style and Urza-style variants.
  match = text.match(/^exile the top card of (each player'?s|target player'?s|your|that player'?s) library, then you may cast (any number of )?spells? from among those cards without paying (?:their|its) mana costs?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'exile_top_cast_free',
      affectedObjects: `top card of ${match[1].trim()} library`,
      sourceZone: 'library',
      destination: 'exile',
      castPermission: 'cast_from_exile_without_paying_mana_cost',
      optional: true,
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Each/all player reanimation and mass graveyard-to-battlefield effects.
  match = text.match(/^(each player|each opponent|you|target player) puts?\s+(a|one|all|any number of)?\s*(.+?)\s+from\s+(?:their|your|that player'?s|target player'?s) graveyard onto the battlefield(?: under (.+?) control)?$/i)
    || text.match(/^put\s+(all|any number of)?\s*(.+?)\s+from\s+(all|any|your|a|target player'?s|that player'?s)?\s*graveyards? onto the battlefield(?: under (.+?) control)?$/i);
  if (match) {
    const isEachPlayer = /^each player|^each opponent|^you|^target player/i.test(match[1] || '');
    const affectedObjects = isEachPlayer ? `${match[2] || ''} ${match[3] || ''}`.replace(/\s+/g, ' ').trim() : `${match[1] || ''} ${match[2] || ''}`.replace(/\s+/g, ' ').trim();
    pushUniqueAction(actions, {
      type: 'move_to_battlefield',
      affectedObjects,
      sourceZone: 'graveyard',
      sourceOwner: isEachPlayer ? match[1].trim() : (match[3] || '').trim(),
      destination: 'battlefield',
      controllerHint: (isEachPlayer ? match[4] : match[4])?.trim() || '',
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: ownerHintFromText(whole) || 'any',
      label: text
    });
  }

  // Chained mass exchange: exile graveyards, sacrifice battlefield, return exiled this way.
  if (/^each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield$/i.test(text)) {
    pushUniqueAction(actions, {
      type: 'mass_graveyard_battlefield_exchange',
      affectedObjects: 'all creature cards from graveyards and all creatures on battlefield',
      sourceZone: 'graveyard',
      destination: 'battlefield',
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'any',
      label: text
    });
  }

  // Modal/compound discard + lose life lines.
  match = text.match(/^(each opponent|each player|that player|target player|you) discards? (x|a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? and loses? (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) life$/i);
  if (match) {
    const discardCount = actionAmountFromWord(match[2], 1);
    const lifeAmount = actionAmountFromWord(match[3], 1);
    pushUniqueAction(actions, {
      type: 'discard',
      affectedObjects: match[1].trim(),
      count: discardCount,
      targetCount: /target player/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'opponent',
      label: `${match[1].trim()} discards ${discardCount} card(s)`
    });
    pushUniqueAction(actions, {
      type: 'lose_life',
      affectedObjects: match[1].trim(),
      amount: lifeAmount,
      targetCount: /target player/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'opponent',
      label: `${match[1].trim()} loses ${lifeAmount} life`
    });
  }

  // Put/reanimate from any/a graveyard under your control, followed by life loss.
  match = text.match(/^put\s+(.+?)\s+from\s+(a|any|your|target player'?s|that player'?s)\s+graveyard onto the battlefield(?: under (.+?) control)?(?:\. You lose\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life)?$/i);
  if (match) {
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'move_to_battlefield',
      affectedObjects,
      sourceZone: 'graveyard',
      sourceOwner: match[2].trim(),
      destination: 'battlefield',
      controllerHint: match[3]?.trim() || '',
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: ownerHintFromText(affectedObjects) || 'self',
      label: match[4] ? text.replace(/\. You lose.+$/i, '') : text
    });
    if (match[4]) {
      const amount = actionAmountFromWord(match[4], 1);
      pushUniqueAction(actions, {
        type: 'lose_life',
        affectedObjects: 'you',
        amount,
        targetCount: { min: 0, max: 0, optional: false },
        ownerHint: 'self',
        label: `You lose ${amount} life`
      });
    }
  }

  // Temporary death-trigger grant: Malakir Rebirth / Verdant Rebirth family.
  match = text.match(/^(?:choose target creature\.\s*)?(?:you lose\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\.\s*)?until end of turn,\s+(.+?)\s+gains?\s+["“]when this creature dies, return it to the battlefield(?: tapped)? under its owner'?s control["”]$/i);
  if (match) {
    const affectedObjects = match[2].trim();
    if (match[1]) {
      const amount = actionAmountFromWord(match[1], 1);
      pushUniqueAction(actions, {
        type: 'lose_life',
        affectedObjects: 'you',
        amount,
        targetCount: { min: 0, max: 0, optional: false },
        ownerHint: 'self',
        label: `You lose ${amount} life`
      });
    }
    pushUniqueAction(actions, {
      type: 'grant_triggered_ability',
      affectedObjects,
      grantedAbility: 'When this creature dies, return it to the battlefield tapped under its owner\'s control.',
      duration: 'until-end-of-turn',
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'self',
      label: text
    });
  }

  // Experience counters and Meren-style return-to-battlefield/otherwise-hand choice.
  match = text.match(/^you get (?:an?|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(.+?)\s+counter$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'add_player_counters',
      affectedObjects: 'you',
      counterType: match[1].trim(),
      amount: 1,
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }
  match = text.match(/^choose\s+(.+?)\s+in your graveyard\. If (?:that card|it)'?s mana value is less than or equal to (.+?), return it to the battlefield\. Otherwise, put it into your hand$/i);
  if (match) {
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'conditional_graveyard_return',
      affectedObjects,
      sourceZone: 'graveyard',
      primaryDestination: 'battlefield',
      fallbackDestination: 'hand',
      conditionText: `mana value is less than or equal to ${match[2].trim()}`,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: 'self',
      label: text
    });
  }

  // Library search/reveal until / put onto battlefield families.
  match = text.match(/^(.+?) may search (?:their|your|that player'?s) library for\s+(.+?), put (?:that card|it) onto the battlefield(?: tapped)?(?:, then shuffle)?$/i)
    || text.match(/^search (?:your|their|that player'?s) library for\s+(.+?), put (?:that card|it) onto the battlefield(?: tapped)?(?:, then shuffle)?$/i);
  if (match) {
    const affectedObjects = (match[2] || match[1] || '').trim();
    pushUniqueAction(actions, {
      type: 'search_library',
      affectedObjects,
      destination: 'battlefield',
      optional: /may/i.test(text),
      triggerText: trigger,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: ownerHintFromText(text) || 'self',
      label: text
    });
  }
  match = text.match(/^reveal cards from the top of your library until you reveal\s+(.+?)\. Put that card onto the battlefield(?: tapped and attacking)? and the rest on the bottom of your library in a random order$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'reveal_until_battlefield',
      affectedObjects: match[1].trim(),
      sourceZone: 'library',
      destination: /tapped and attacking/i.test(text) ? 'battlefield-tapped-attacking' : 'battlefield',
      targetFilters: targetFiltersFromText(match[1]),
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Mill/pay/select from milled cards.
  match = text.match(/^mill\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards\. Then you may pay\s+(.+?)\. If you do, put\s+(.+?)\s+from among those cards into your hand$/i);
  if (match) {
    const count = actionAmountFromWord(match[1], 1);
    pushUniqueAction(actions, {
      type: 'mill',
      affectedObjects: 'you',
      count,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Mill ${count} cards`
    });
    pushUniqueAction(actions, {
      type: 'put_from_milled_to_hand',
      affectedObjects: match[3].trim(),
      additionalCostText: match[2].trim(),
      optional: true,
      sourceZone: 'milled-cards',
      destination: 'hand',
      targetCount: targetCountFromText(match[3]),
      ownerHint: 'self',
      label: text
    });
  }

  // Return lesser-MV creature cards from graveyard once each turn.
  match = text.match(/^(?:you may\s+)?return\s+(.+?with lesser mana value.+?)\s+from your graveyard to the battlefield(?: tapped)?(?:\. Do this only once each turn)?$/i);
  if (match) {
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'return_from_graveyard_to_battlefield',
      affectedObjects,
      sourceZone: 'graveyard',
      destination: /battlefield tapped/i.test(text) ? 'battlefield-tapped' : 'battlefield',
      optional: /may/i.test(text),
      onceEachTurn: /only once each turn/i.test(text),
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: 'self',
      label: text
    });
  }

  // Split second grants / artifact-mana conditions.
  match = text.match(/^each spell you cast has split second(?: if (.+))?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'grant_trait',
      affectedObjects: 'each spell you cast',
      trait: 'Split second',
      conditionText: match[1]?.trim() || condition,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  // Direct loss/damage variants missed by earlier broad parsers.
  match = text.match(/^(they|that player|each opponent|each player|you|target player) loses?\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life$/i);
  if (match) {
    const amount = actionAmountFromWord(match[2], 1);
    pushUniqueAction(actions, {
      type: 'lose_life',
      affectedObjects: match[1].trim(),
      amount,
      triggerText: trigger,
      targetCount: /target player/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'opponent',
      label: text
    });
  }
  match = text.match(/^(.+?) deals?\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+damage to\s+(that player|target player|each opponent|each player|you)$/i);
  if (match) {
    const amount = actionAmountFromWord(match[2], 1);
    pushUniqueAction(actions, {
      type: 'direct_damage',
      damageSourceText: match[1].trim(),
      damageTargetText: match[3].trim(),
      amount,
      damageFormula: String(amount),
      targetFilters: /target/i.test(match[3]) ? ['Player'] : ['Player'],
      targetCount: /target/i.test(match[3]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[3]) || 'opponent',
      label: text
    });
  }

  // Sneak Attack and similar: put from hand, grant haste, delayed sacrifice.
  match = text.match(/^(?:you may\s+)?put\s+(.+?)\s+from your hand onto the battlefield\. That (?:creature|permanent|card) gains\s+(.+?)\. Sacrifice (?:that|the) (?:creature|permanent|card) at the beginning of the next end step$/i);
  if (match) {
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'put_from_hand_to_battlefield',
      affectedObjects,
      sourceZone: 'hand',
      destination: 'battlefield',
      optional: /may/i.test(text),
      grantedTraits: extractKeywordTraits(match[2]),
      delayedSacrifice: 'beginning-of-next-end-step',
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: 'self',
      label: text
    });
  }

  // Opposing permanents entering tapped.
  match = text.match(/^(.+?)\s+enter tapped$/i);
  if (match && /creatures?|artifacts?|lands?|permanents?/i.test(match[1])) {
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'entry_modifier',
      affectedObjects,
      entersTapped: true,
      linkedStatic: true,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'opponent',
      label: text
    });
  }

  return actions;
}


function parsePatch30PredictiveGrammarActions(effectText = '', conditionText = '', triggerText = '', originalText = '', costText = '') {
  const actions = [];
  const text = stripProactiveTimingClauses(effectText);
  const condition = stripProactiveTimingClauses(conditionText);
  const trigger = stripProactiveTimingClauses(triggerText);
  const fullText = stripProactiveTimingClauses(originalText || effectText);
  const whole = `${trigger ? `${trigger}. ` : ''}${condition ? `If ${condition}. ` : ''}${text}`.replace(/\s+/g, ' ').trim();
  const originalWhole = String(originalText || effectText || '').replace(/\s+/g, ' ').trim();
  let match;

  // Named/non-template lands split by the conditional parser:
  // "As The Black Gate enters, you may pay 3 life" + condition "you don't, it enters tapped".
  match = text.match(/^as\s+(.+?)\s+enters,\s+you may pay\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life$/i);
  if (match && /you don'?t,?\s+it enters tapped/i.test(condition)) {
    const amount = actionAmountFromWord(match[2], 3);
    pushUniqueAction(actions, {
      type: 'entry_replacement_pay_life_or_tapped',
      affectedObjects: match[1].trim(),
      lifePayment: amount,
      entersTappedUnlessPaid: true,
      optional: true,
      linkedStatic: true,
      conditionText: condition,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `${text}. If ${condition}.`
    });
  }

  // Granted Ward with a non-mana/life payment when the quoted ability contains its own period.
  match = (text.match(/^(.+?)\s+have\s+["“]?ward[—\- ]+pay\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\.?["”]?$/i)
    || originalWhole.match(/^(.+?)\s+have\s+["“]?ward[—\- ]+pay\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\.?["”]?\.?$/i));
  if (match) {
    const amount = actionAmountFromWord(match[2], 1);
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'grant_trait',
      affectedObjects,
      trait: `Ward—Pay ${amount} life`,
      wardCost: { kind: 'pay_life', amount },
      linkedStatic: true,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'self',
      label: `Grant Ward—Pay ${amount} life to ${affectedObjects}`
    });
  }

  // Temporary death-trigger grants with the quoted sentence punctuation preserved inside the quote.
  match = text.match(/^(?:choose\s+(target\s+.+?)\.\s*)?(?:you lose\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\.\s*)?until end of turn,\s+(.+?)\s+gains?\s+["“]when this creature dies, return it to the battlefield(?: tapped)? under its owner'?s control\.?["”]?$/i)
    || originalWhole.match(/^(?:choose\s+(target\s+.+?)\.\s*)?(?:you lose\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\.\s*)?until end of turn,\s+(.+?)\s+gains?\s+["“]when this creature dies, return it to the battlefield(?: tapped)? under its owner'?s control\.?["”]?\.?$/i);
  if (match) {
    const explicitTarget = match[1]?.trim() || '';
    const amountText = match[2];
    const affectedObjects = (match[3] || explicitTarget || 'target creature').trim();
    if (amountText) {
      const amount = actionAmountFromWord(amountText, 1);
      pushUniqueAction(actions, {
        type: 'lose_life',
        affectedObjects: 'you',
        amount,
        targetCount: { min: 0, max: 0, optional: false },
        ownerHint: 'self',
        label: `You lose ${amount} life`
      });
    }
    pushUniqueAction(actions, {
      type: 'grant_triggered_ability',
      affectedObjects,
      grantedAbility: 'When this creature dies, return it to the battlefield tapped under its owner\'s control.',
      duration: 'until-end-of-turn',
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'self',
      label: text
    });
  }

  // Meren-style split parse: effect is only "choose target creature card in your graveyard" and the if/otherwise branch is in conditionText.
  match = text.match(/^choose\s+(.+?)\s+in your graveyard$/i);
  const conditionReturnMatch = condition.match(/^(?:that card|it)'?s mana value is less than or equal to (.+?),\s*return it to the battlefield\.\s*Otherwise,\s*put it into your hand$/i);
  if (match && conditionReturnMatch) {
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'conditional_graveyard_return',
      affectedObjects,
      sourceZone: 'graveyard',
      primaryDestination: 'battlefield',
      fallbackDestination: 'hand',
      conditionText: `mana value is less than or equal to ${conditionReturnMatch[1].trim()}`,
      triggerText: trigger,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: 'self',
      label: `${text}. If ${condition}.`
    });
  }

  // Mill first, then optional payment, then select from among those cards; split condition/effect variant.
  match = text.match(/^mill\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards\.\s*Then you may pay\s+(.+)$/i);
  const conditionPutFromThose = condition.match(/^you do,\s*put\s+(.+?)\s+from among those cards into your hand$/i);
  if (match && conditionPutFromThose) {
    const count = actionAmountFromWord(match[1], 1);
    pushUniqueAction(actions, {
      type: 'mill',
      affectedObjects: 'you',
      count,
      triggerText: trigger,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: `Mill ${count} cards`
    });
    pushUniqueAction(actions, {
      type: 'put_from_milled_to_hand',
      affectedObjects: conditionPutFromThose[1].trim(),
      additionalCostText: match[2].trim(),
      optional: true,
      sourceZone: 'milled-cards',
      destination: 'hand',
      triggerText: trigger,
      targetCount: targetCountFromText(conditionPutFromThose[1]),
      ownerHint: 'self',
      label: `${text}. If ${condition}.`
    });
  }

  // Lesser-mana-value graveyard recursion where "with lesser mana value" is the final qualifier before "from".
  match = text.match(/^(?:you may\s+)?return\s+(.+?with lesser mana value)\s+from your graveyard to the battlefield( tapped)?(?:\.\s*Do this only once each turn)?$/i)
    || originalWhole.match(/^(?:whenever .+?,\s*)?(?:you may\s+)?return\s+(.+?with lesser mana value)\s+from your graveyard to the battlefield( tapped)?(?:\.\s*Do this only once each turn)?\.?$/i);
  if (match) {
    const affectedObjects = match[1].trim();
    pushUniqueAction(actions, {
      type: 'return_from_graveyard_to_battlefield',
      affectedObjects,
      sourceZone: 'graveyard',
      destination: match[2] ? 'battlefield-tapped' : 'battlefield',
      optional: /may/i.test(text) || /may/i.test(originalWhole),
      onceEachTurn: /only once each turn/i.test(text) || /only once each turn/i.test(originalWhole),
      triggerText: trigger,
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: targetCountFromText(affectedObjects),
      ownerHint: 'self',
      label: text
    });
  }

  return actions;
}


function parseProactiveGeneralActions(effectText = '', conditionText = '', triggerText = '', originalText = '', costText = '') {
  const actions = [];
  const text = stripProactiveTimingClauses(effectText);
  const fullText = stripProactiveTimingClauses(originalText || effectText);
  const lower = text.toLowerCase();

  // Phasing / protection shields, e.g. Teferi's Protection.
  let phaseMatch = text.match(/^(all permanents you control|target permanent|target creature|.+?) phase out$/i)
    || fullText.match(/\b(all permanents you control|target permanent|target creature|.+?) phase out\b/i);
  if (phaseMatch) {
    const affectedObjects = phaseMatch[1].trim();
    pushUniqueAction(actions, {
      type: 'phase_out',
      affectedObjects,
      destination: 'phased-out',
      targetFilters: targetFiltersFromText(affectedObjects),
      targetCount: /target/i.test(affectedObjects) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(affectedObjects) || 'self',
      label: `${affectedObjects} phase out`
    });
  }

  for (const action of parseZoneMoveSentence(text, triggerText)) pushUniqueAction(actions, action);

  const choice = parseProactiveCardNameChoice(text);
  if (choice) pushUniqueAction(actions, choice);

  const mechanic = parseProactiveMechanicKeyword(text, fullText);
  if (mechanic) pushUniqueAction(actions, mechanic);

  for (const action of parseProactiveLifeModifier(text, conditionText)) pushUniqueAction(actions, action);
  for (const action of parseProactiveDrawDiscardMill(text, triggerText)) pushUniqueAction(actions, action);
  for (const action of parseProactiveCostAndTax(text, conditionText)) pushUniqueAction(actions, action);
  for (const action of parseProactiveReplacementAndRestriction(text, conditionText, triggerText)) pushUniqueAction(actions, action);
  for (const action of parsePatch23PredictiveGrammarActions(text, conditionText, triggerText, fullText, costText)) pushUniqueAction(actions, action);
  for (const action of parsePatch24PredictiveGrammarActions(text, conditionText, triggerText, fullText, costText)) pushUniqueAction(actions, action);
  for (const action of parsePatch25PredictiveGrammarActions(text, conditionText, triggerText, fullText, costText)) pushUniqueAction(actions, action);
  for (const action of parsePatch27PredictiveGrammarActions(text, conditionText, triggerText, fullText, costText)) pushUniqueAction(actions, action);
  for (const action of parsePatch28PredictiveGrammarActions(text, conditionText, triggerText, fullText, costText)) pushUniqueAction(actions, action);
  for (const action of parsePatch29PredictiveGrammarActions(text, conditionText, triggerText, fullText, costText)) pushUniqueAction(actions, action);
  for (const action of parsePatch30PredictiveGrammarActions(text, conditionText, triggerText, fullText, costText)) pushUniqueAction(actions, action);

  let match = text.match(/^(.+?) deals? (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) damage to (any target|target .+?|each opponent|each creature|each player)$/i);
  if (match) {
    const amount = actionAmountFromWord(match[2], 1);
    pushUniqueAction(actions, {
      type: 'direct_damage',
      damageSourceText: match[1].trim(),
      damageTargetText: match[3].trim(),
      amount,
      damageFormula: String(amount),
      targetFilters: /any target/i.test(match[3]) ? ['AnyTarget'] : targetFiltersFromText(match[3]),
      targetCount: /target|any target/i.test(match[3]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[3]) || 'any',
      label: text
    });
  }

  match = text.match(/^copy (target .+?|that spell|that ability|this spell)(?:\. You may choose new targets for (?:the copy|it))?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: /ability/i.test(match[1]) ? 'copy_ability' : 'copy_spell',
      copiedObject: match[1].trim(),
      mayChooseNewTargets: /choose new targets/i.test(text),
      targetFilters: /ability/i.test(match[1]) ? ['Ability'] : ['Spell'],
      targetCount: /target/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'self',
      label: text
    });
  }

  match = text.match(/^gain control of (target .+?)(?: until end of turn)?$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'gain_control',
      affectedObjects: match[1].trim(),
      duration: /until end of turn/i.test(text) ? 'until-end-of-turn' : '',
      targetFilters: targetFiltersFromText(match[1]),
      targetCount: { min: 1, max: 1, optional: false },
      ownerHint: 'opponent',
      label: text
    });
  }

  match = text.match(/^(.+?) becomes? (?:a|an)?\s*(\d+\/\d+)?\s*(.+? creature)(?: in addition to its other (?:colors and )?types)?(?: until end of turn)?$/i);
  if (match && !/copy of/i.test(text)) {
    const pt = match[2]?.match(/(\d+)\/(\d+)/);
    pushUniqueAction(actions, {
      type: 'type_change',
      affectedObjects: match[1].trim(),
      addedTypes: ['Creature'],
      becomesText: match[3].trim(),
      basePower: pt?.[1] || '',
      baseToughness: pt?.[2] || '',
      duration: /until end of turn/i.test(text) ? 'until-end-of-turn' : '',
      linkedStatic: !/until end of turn/i.test(text),
      targetCount: /target/i.test(match[1]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'any',
      label: text
    });
  }

  match = text.match(/^(.+?) (?:is|are) (.+?) in addition to (?:its|their) other types$/i);
  if (match) {
    pushUniqueAction(actions, {
      type: 'type_addition_static',
      affectedObjects: match[1].trim(),
      addedTypesText: match[2].trim(),
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[1]) || 'any',
      label: text
    });
  }

  match = text.match(/^remove (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an) (.+?) counters? from (.+)$/i);
  if (match) {
    const amount = actionAmountFromWord(match[1], 1);
    pushUniqueAction(actions, {
      type: 'remove_counters',
      counterAmount: amount,
      counterType: match[2].trim(),
      affectedObjects: match[3].trim(),
      targetFilters: targetFiltersFromText(match[3]),
      targetCount: /target/i.test(match[3]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[3]) || 'any',
      label: text
    });
  }

  match = text.match(/^put (x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an) (.+?) counters? on (.+)$/i);
  if (match && !/library|graveyard|battlefield|hand/i.test(match[3])) {
    const amount = actionAmountFromWord(match[1], 1);
    pushUniqueAction(actions, {
      type: 'add_counters',
      counterAmount: amount,
      counterType: match[2].trim(),
      affectedObjects: match[3].trim(),
      targetFilters: targetFiltersFromText(match[3]),
      targetCount: /target/i.test(match[3]) ? { min: 1, max: 1, optional: false } : { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(match[3]) || 'any',
      label: text
    });
  }

  if (/^you may play lands? from your (graveyard|exile|library)$/i.test(text) || /^you may cast .+? from your (graveyard|exile|library)$/i.test(text)) {
    const sourceZone = text.match(/from your (graveyard|exile|library)/i)?.[1]?.toLowerCase() || '';
    pushUniqueAction(actions, {
      type: 'zone_play_permission',
      affectedObjects: text.match(/^you may (?:play|cast) (.+?) from/i)?.[1]?.trim() || 'cards',
      sourceZone,
      permission: /\bcast\b/i.test(text) ? 'cast_from_zone' : 'play_from_zone',
      optional: true,
      linkedStatic: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  if (/^you may play an additional land(?: on each of your turns| this turn)?$/i.test(text) || /^you may play (\d+|one|two|three|four|five) additional lands?(?: on each of your turns| this turn)?$/i.test(text)) {
    const countText = text.match(/^you may play (\d+|one|two|three|four|five) additional lands?/i)?.[1] || 'one';
    pushUniqueAction(actions, {
      type: 'additional_land_play',
      amount: numberFromText(countText, 1),
      duration: /this turn/i.test(text) ? 'this-turn' : '',
      linkedStatic: !/this turn/i.test(text),
      optional: true,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  if (/^you have no maximum hand size(?: for the rest of the game)?$/i.test(text)) {
    pushUniqueAction(actions, {
      type: 'maximum_hand_size_modifier',
      affectedObjects: 'you',
      maximumHandSize: null,
      duration: /rest of the game/i.test(text) ? 'rest-of-game' : '',
      linkedStatic: !/rest of the game/i.test(text),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  if (/^you win the game$/i.test(text) || /^you lose the game$/i.test(text)) {
    pushUniqueAction(actions, {
      type: /^you win/i.test(text) ? 'win_game' : 'lose_game',
      affectedObjects: 'you',
      conditionText,
      triggerText,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      label: text
    });
  }

  return actions;
}


function parseAffectedObjects(text = '') {
  const lower = text.toLowerCase();
  if (/^this creature\b|this creature/.test(lower)) return 'this creature';
  if (/^this land\b|this land/.test(lower)) return 'this land';
  if (/^this artifact\b|this artifact/.test(lower)) return 'this artifact';
  if (/^this permanent\b|this permanent/.test(lower)) return 'this permanent';
  if (/enchanted creature/.test(lower)) return 'enchanted creature';
  if (/other green creatures you control/.test(lower)) return 'other green creatures you control';
  if (/green creatures you control/.test(lower)) return 'green creatures you control';
  if (/other creatures you control/.test(lower)) return 'other creatures you control';
  if (/wurms you control|wurm creatures you control/.test(lower)) return 'Wurms you control';
  if (/elves you control|elf creatures you control/.test(lower)) return 'Elves you control';
  if (/goblins you control|goblin creatures you control/.test(lower)) return 'Goblins you control';
  if (/zombies you control|zombie creatures you control/.test(lower)) return 'Zombies you control';
  if (/humans you control|human creatures you control/.test(lower)) return 'Humans you control';
  if (/angels you control|angel creatures you control/.test(lower)) return 'Angels you control';
  if (/non-human creatures you control/.test(lower)) return 'non-Human creatures you control';
  if (/permanents you control/.test(lower)) return 'permanents you control';
  if (/each creature you control/.test(lower)) return 'each creature you control';
  if (/creatures you control/.test(lower)) return 'creatures you control';
  if (/equipped creature/.test(lower)) return 'equipped creature';
  return '';
}

function parseAbility(rawAbility, index) {
  const originalText = rawAbility.text;
  const text = cleanText(originalText);
  const lowered = text.toLowerCase();
  let costText = '';
  let effectText = text;
  let triggerText = '';
  let conditionText = '';
  const colonIndex = text.indexOf(':');
  const leadingTrigger = text.match(/^(when|whenever|at)\b([^,]*),\s*(.+)$/i);
  if (leadingTrigger) {
    triggerText = `${leadingTrigger[1]}${leadingTrigger[2]}`.trim();
    effectText = leadingTrigger[3].trim();
  } else if (colonIndex > 0) {
    costText = text.slice(0, colonIndex).trim();
    effectText = text.slice(colonIndex + 1).trim();
  } else if (/^equip\s+\{?[^}]+\}?/i.test(text)) {
    costText = text.replace(/^equip\s*/i, '').trim();
    effectText = 'Attach this Equipment to target creature you control.';
  } else {
    const triggered = text.match(/^(when|whenever|at)\b([^,]*),\s*(.+)$/i);
    if (triggered) {
      triggerText = `${triggered[1]}${triggered[2]}`.trim();
      effectText = triggered[3].trim();
    }
  }

  const conditionMatch = effectText.match(/^(?:if|as long as)\s+(.+?),\s*(.+)$/i);
  if (conditionMatch) {
    conditionText = conditionMatch[1].trim();
    effectText = conditionMatch[2].trim();
  }
  const ifTail = effectText.match(/^(.+?)\s+if\s+(.+)$/i);
  if (!conditionText && ifTail && !/search your library|paid life this way|less to cast/i.test(effectText)) {
    effectText = ifTail[1].trim();
    conditionText = ifTail[2].trim();
  }
  const asLongTail = effectText.match(/^(.+?)\s+as long as\s+(.+)$/i);
  if (!conditionText && asLongTail) {
    effectText = asLongTail[1].trim();
    conditionText = asLongTail[2].trim();
  }

  conditionText = conditionText.replace(/[.]+$/g, '').trim();
  effectText = effectText.replace(/[.]+$/g, '').trim();

  const variableCostReductionMatch = effectText.match(/this ability costs\s+\{?x\}?\s+less to activate,\s*where x is ([^.]+)/i);
  const fixedCostReductionMatch = effectText.match(/this ability costs\s+(\{[^}]+\})\s+less to activate for each ([^.]+)/i);
  const costReduction = variableCostReductionMatch ? {
    amount: 'X',
    xDefinition: variableCostReductionMatch[1].trim(),
    appliesTo: 'generic activation cost',
    note: `This ability costs {X} less to activate, where X is ${variableCostReductionMatch[1].trim()}`
  } : fixedCostReductionMatch ? {
    amount: fixedCostReductionMatch[1],
    xDefinition: `for each ${fixedCostReductionMatch[2].trim()}`,
    appliesTo: 'generic activation cost',
    note: `This ability costs ${fixedCostReductionMatch[1]} less to activate for each ${fixedCostReductionMatch[2].trim()}`
  } : null;

  const effectLower = effectText.toLowerCase();
  const optional = /\bmay\b|up to/i.test(effectText) || /you may/i.test(text);
  const actions = [];
  const targetCount = targetCountFromText(effectText);
  const targetFilters = targetFiltersFromText(effectText);
  const ownerHint = ownerHintFromText(effectText);
  const cost = parseCostText(costText);
  const affectedObjects = parseAffectedObjects(effectText || text);

  const commanderPartner = parseCommanderPartnerAbility(text || originalText);
  if (commanderPartner) {
    actions.push(commanderPartner);
  }

  const phyrexianManaReminder = parsePhyrexianManaReminder(originalText || text);
  if (phyrexianManaReminder) {
    actions.push(phyrexianManaReminder);
  }

  const bargain = parseBargainAbility(text || originalText);
  if (bargain) {
    actions.push(bargain);
  }

  const gift = parseGiftAbility(text || originalText);
  if (gift) {
    actions.push(gift);
  }

  const replacementDiscardLandEnter = parseReplacementDiscardLandEnter(effectText, conditionText);
  if (replacementDiscardLandEnter) {
    actions.push(replacementDiscardLandEnter);
  }

  const cumulativeUpkeep = parseCumulativeUpkeepAbility(text || originalText);
  if (cumulativeUpkeep) {
    actions.push(cumulativeUpkeep);
  }

  const skipStepEffect = parseSkipStepEffect(effectText);
  if (skipStepEffect) {
    actions.push(skipStepEffect);
  }

  const discardedCardExile = parseDiscardedCardExileEffect(effectText, triggerText);
  if (discardedCardExile) {
    actions.push(discardedCardExile);
  }

  const delayedTopCardToHand = parseDelayedTopCardToHand(effectText);
  if (delayedTopCardToHand) {
    actions.push(delayedTopCardToHand);
  }

  const spellCastingRestriction = parseSpellCastingRestriction(effectText, conditionText);
  if (spellCastingRestriction) {
    actions.push(spellCastingRestriction);
  }

  const delayedPaymentLoseGame = parseDelayedPaymentLoseGame(effectText, conditionText, triggerText);
  if (delayedPaymentLoseGame) {
    actions.push(delayedPaymentLoseGame);
  }

  const exileTopPlayThisTurn = parseExileTopPlayThisTurn(effectText);
  if (exileTopPlayThisTurn) {
    actions.push(exileTopPlayThisTurn);
  }

  const dash = parseDashAbility(text || originalText);
  if (dash) {
    actions.push(dash);
  }

  const returnGraveyardPermanentToBattlefield = parseReturnGraveyardPermanentToBattlefield(effectText, conditionText);
  if (returnGraveyardPermanentToBattlefield) {
    actions.push(returnGraveyardPermanentToBattlefield);
  }

  const entryPayLifeOrTapped = parseEntryPayLifeOrTapped(effectText, conditionText);
  if (entryPayLifeOrTapped) {
    actions.push(entryPayLifeOrTapped);
  }

  const taxedTriggerToken = parseTaxedTriggerToken(effectText, conditionText, triggerText);
  if (taxedTriggerToken) {
    actions.push(taxedTriggerToken);
  }

  const taintedPactEffect = parseTaintedPactEffect(effectText);
  if (taintedPactEffect) {
    actions.push(taintedPactEffect);
  }

  const thassasOracleEffect = parseThassasOracleEffect(effectText, conditionText);
  if (thassasOracleEffect) {
    actions.push(thassasOracleEffect);
  }

  const graveyardEscapeGrant = parseGraveyardEscapeGrant(effectText);
  if (graveyardEscapeGrant) {
    actions.push(graveyardEscapeGrant);
  }

  const entryCountersSelf = parseEntryCountersSelf(effectText);
  if (entryCountersSelf) {
    actions.push(entryCountersSelf);
  }

  const payThenTokenCopy = parsePayThenTokenCopy(effectText, conditionText, triggerText);
  if (payThenTokenCopy) {
    actions.push(payThenTokenCopy);
  }

  const massSacrificeEffect = parseMassSacrificeEffect(effectText);
  if (massSacrificeEffect) {
    actions.push(massSacrificeEffect);
  }

  const returnGraveyardCardToHand = parseReturnGraveyardCardToHand(effectText);
  if (returnGraveyardCardToHand) {
    actions.push(returnGraveyardCardToHand);
  }

  const chooseCardType = parseChooseCardType(effectText);
  if (chooseCardType) {
    actions.push(chooseCardType);
  }

  const commanderZoneToHand = parseCommanderZoneToHand(effectText);
  if (commanderZoneToHand) {
    actions.push(commanderZoneToHand);
  }

  const moveCounterEffect = parseMoveCounterEffect(effectText, conditionText);
  if (moveCounterEffect) {
    actions.push(moveCounterEffect);
  }

  const triggeredAbilityExtraTrigger = parseTriggeredAbilityExtraTrigger(effectText, conditionText);
  if (triggeredAbilityExtraTrigger) {
    actions.push(triggeredAbilityExtraTrigger);
  }

  const copyTriggeredSpell = parseCopyTriggeredSpell(effectText, triggerText);
  if (copyTriggeredSpell) {
    actions.push(copyTriggeredSpell);
  }

  const protectionGrant = parseProtectionGrant(effectText);
  if (protectionGrant) {
    actions.push(protectionGrant);
  }

  const overloadAbility = parseOverloadAbility(text || originalText);
  if (overloadAbility) {
    actions.push(overloadAbility);
  }

  const revealShuffleInstead = parseRevealShuffleInstead(effectText, conditionText);
  if (revealShuffleInstead) {
    actions.push(revealShuffleInstead);
  }


  const topLibraryLookSelect = parseTopLibraryLookSelect(effectText);
  if (topLibraryLookSelect) {
    actions.push(topLibraryLookSelect);
  }

  const dynamicPowerToughnessSet = parseDynamicPowerToughnessSet(effectText);
  if (dynamicPowerToughnessSet) {
    actions.push(dynamicPowerToughnessSet);
  }

  const cantBeBlockedThisTurn = parseCantBeBlockedThisTurn(effectText);
  if (cantBeBlockedThisTurn) {
    actions.push(cantBeBlockedThisTurn);
  }

  const payThenDraw = parsePayThenDraw(effectText, conditionText, triggerText);
  if (payThenDraw) {
    actions.push(payThenDraw);
  }

  const copyUntilEndOfTurn = parseCopyUntilEndOfTurn(effectText);
  if (copyUntilEndOfTurn) {
    actions.push(copyUntilEndOfTurn);
  }

  const startEngines = parseStartEnginesAbility(text || originalText);
  if (startEngines) {
    actions.push(startEngines);
  }

  const topLibraryLookPermission = parseTopLibraryLookPermission(effectText);
  if (topLibraryLookPermission) {
    actions.push(topLibraryLookPermission);
  }

  const topLibraryCastPermission = parseTopLibraryCastPermission(effectText);
  if (topLibraryCastPermission) {
    actions.push(topLibraryCastPermission);
  }

  const exileTopCardEffect = parseExileTopCardEffect(effectText);
  if (exileTopCardEffect) {
    actions.push(exileTopCardEffect);
  }

  const putCreatureFromGraveyardToBattlefield = parsePutCreatureFromGraveyardToBattlefield(effectText);
  if (putCreatureFromGraveyardToBattlefield) {
    actions.push(putCreatureFromGraveyardToBattlefield);
  }

  const chooseColorAddManaForSacrificedArtifacts = parseChooseColorAddManaForSacrificedArtifacts(effectText);
  if (chooseColorAddManaForSacrificedArtifacts) {
    actions.push(chooseColorAddManaForSacrificedArtifacts);
  }

  const chosenTypeAddition = parseChosenTypeAddition(effectText);
  if (chosenTypeAddition) {
    actions.push(chosenTypeAddition);
  }

  const patch20JolraelSpecificActions = parsePatch20JolraelSpecificAction(effectText, conditionText, triggerText, originalText || text);
  if (patch20JolraelSpecificActions.length) {
    actions.push(...patch20JolraelSpecificActions);
  }

  const patch19YunaFinalSpecificActions = parsePatch19YunaFinalSpecificAction(effectText, conditionText, triggerText, originalText || text);
  if (patch19YunaFinalSpecificActions.length) {
    actions.push(...patch19YunaFinalSpecificActions);
  }

  const patch18YunaSpecificActions = parsePatch18YunaSpecificAction(effectText, conditionText, triggerText, originalText || text);
  if (patch18YunaSpecificActions.length) {
    actions.push(...patch18YunaSpecificActions);
  }

  const patch14SpecificActions = parsePatch14SpecificAction(effectText, conditionText, triggerText, originalText || text);
  if (patch14SpecificActions.length) {
    actions.push(...patch14SpecificActions);
  }

  const additionalCostSacrifice = parseAdditionalCostSacrifice(effectText);
  if (additionalCostSacrifice) {
    actions.push(additionalCostSacrifice);
  }

  const alternateExileCastCost = parseAlternateExileCastCost(effectText, conditionText);
  if (alternateExileCastCost) {
    actions.push(alternateExileCastCost);
  }

  const trapAlternateCost = parseTrapAlternateCost(effectText, conditionText);
  if (trapAlternateCost) {
    actions.push(trapAlternateCost);
  }

  const pregameBattlefieldStart = parsePregameBattlefieldStart(effectText, conditionText);
  if (pregameBattlefieldStart) {
    actions.push(pregameBattlefieldStart);
  }

  const commanderFreeCast = parseCommanderFreeCast(effectText, conditionText);
  if (commanderFreeCast) {
    actions.push(commanderFreeCast);
  }

  const flashback = parseFlashbackAbility(text);
  if (flashback) {
    actions.push(flashback);
  }

  const backup = parseBackupAbility(text || originalText);
  if (backup) {
    actions.push(backup);
  }

  const eternalize = parseEternalizeAbility(originalText);
  if (eternalize) {
    actions.push(eternalize);
  }

  const cycling = parseCyclingAbility(effectText || text);
  if (cycling) {
    actions.push(cycling);
  }

  const castingCostModifier = parseCastingCostModifier(text);
  if (castingCostModifier) {
    actions.push({
      ...castingCostModifier,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      linkedStatic: true
    });
  }

  const staticSpellCostModifier = parseStaticSpellCostModifier(effectText);
  if (staticSpellCostModifier) {
    actions.push({
      ...staticSpellCostModifier,
      ownerHint: 'self'
    });
  }

  const paymentRestriction = parsePaymentRestriction(effectText);
  if (paymentRestriction) {
    actions.push({
      ...paymentRestriction,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(effectText)
    });
  }

  const chooseAndGrantTrait = parseChooseAndGrantTrait(effectText);
  if (chooseAndGrantTrait) {
    actions.push({
      ...chooseAndGrantTrait,
      targetFilters: targetFiltersFromText(chooseAndGrantTrait.affectedObjects || effectText),
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(effectText)
    });
  }

  const keywordAction = parseKeywordAction(effectText);
  if (keywordAction) {
    actions.push({
      ...keywordAction,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self'
    });
  }

  const flashPermission = parseFlashPermission(effectText);
  if (flashPermission) {
    actions.push(flashPermission);
  }

  const noUntapStep = parseNoUntapStepEffect(effectText);
  if (noUntapStep) {
    actions.push(noUntapStep);
  }

  const payToUntapSource = parsePayToUntapSource(effectText, triggerText, conditionText);
  if (payToUntapSource) {
    actions.push(payToUntapSource);
  }

  const castAsThoughFlashThisSpell = parseCastAsThoughFlashThisSpell(effectText, conditionText);
  if (castAsThoughFlashThisSpell) {
    actions.push(castAsThoughFlashThisSpell);
  }

  const repeatRevealToHandLoseLife = parseRepeatRevealToHandLoseLife(effectText);
  if (repeatRevealToHandLoseLife) {
    actions.push(repeatRevealToHandLoseLife);
  }

  const lifePaymentDraw = parseLifePaymentDraw(effectText, triggerText, conditionText);
  if (lifePaymentDraw) {
    actions.push(lifePaymentDraw);
  }

  const convoke = parseConvokeAbility(text || originalText);
  if (convoke) {
    actions.push({
      ...convoke,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self'
    });
  }

  const hideaway = parseHideawayAbility(text || originalText);
  if (hideaway) {
    actions.push({
      ...hideaway,
      ownerHint: 'self'
    });
  }

  const kicker = parseKickerAbility(text || originalText);
  if (kicker) {
    actions.push({
      ...kicker,
      ownerHint: 'self'
    });
  }

  const untapEffect = parseUntapEffect(effectText);
  if (untapEffect) {
    actions.push({
      ...untapEffect,
      ownerHint: ownerHintFromText(effectText) || 'self'
    });
  }

  const putFromHandToBattlefield = parsePutFromHandToBattlefield(effectText);
  if (putFromHandToBattlefield) {
    actions.push({
      ...putFromHandToBattlefield,
      targetCount: { min: 0, max: 0, optional: Boolean(putFromHandToBattlefield.optional) },
      ownerHint: 'self'
    });
  }

  const millReturnMilled = parseMillReturnMilled(effectText);
  if (millReturnMilled) {
    actions.push({
      ...millReturnMilled,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self'
    });
  }

  const millEffect = parseMillEffect(effectText);
  if (millEffect) {
    actions.push(millEffect);
  }

  const returnToHandCopyOption = parseReturnToHandCopyOption(effectText, conditionText);
  if (returnToHandCopyOption) {
    actions.push(returnToHandCopyOption);
  }

  const returnToHandEffect = parseReturnToHandEffect(effectText, conditionText);
  if (returnToHandEffect) {
    actions.push(returnToHandEffect);
  }

  const gainControlSpellEffect = parseGainControlSpellEffect(effectText);
  if (gainControlSpellEffect) {
    actions.push(gainControlSpellEffect);
  }

  const chooseNewTargetsEffect = parseChooseNewTargetsEffect(effectText);
  if (chooseNewTargetsEffect) {
    actions.push(chooseNewTargetsEffect);
  }

  const changeTargetEffect = parseChangeTargetEffect(effectText);
  if (changeTargetEffect) {
    actions.push(changeTargetEffect);
  }

  const namedCardConsultation = parseNamedCardConsultation(effectText);
  if (namedCardConsultation) {
    actions.push(namedCardConsultation);
  }

  const mnemonicBetrayalEffect = parseMnemonicBetrayalEffect(effectText);
  if (mnemonicBetrayalEffect) {
    actions.push(mnemonicBetrayalEffect);
  }

  const delayedReturnExiledCards = parseDelayedReturnExiledCards(effectText, conditionText, triggerText);
  if (delayedReturnExiledCards) {
    actions.push(delayedReturnExiledCards);
  }

  const exileNamedSource = parseExileNamedSource(effectText);
  if (exileNamedSource) {
    actions.push(exileNamedSource);
  }

  const imprintExileFromHand = parseImprintExileFromHand(effectText, text || originalText);
  if (imprintExileFromHand) {
    actions.push(imprintExileFromHand);
  }

  if (/choose (?:a|one) creature type/i.test(effectText) || /choose (?:a|one) creature type/i.test(text)) {
    actions.push({
      type: 'choose_creature_type',
      label: 'Choose creature type',
      choiceKind: 'creature_type',
      ownerHint: 'self',
      targetCount: { min: 0, max: 0, optional: false }
    });
  }

  const combatCreatureAction = parseCombatCreatureAction(effectText);
  if (combatCreatureAction) {
    actions.push({ ...combatCreatureAction, ownerHint: ownerHintFromText(effectText) });
  }

  const combatDeclarationTax = parseCombatDeclarationTax(effectText);
  if (combatDeclarationTax) {
    actions.push({
      ...combatDeclarationTax,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(effectText)
    });
  }

  const attackRestriction = parseAttackRestriction(effectText);
  if (attackRestriction) {
    actions.push({
      ...attackRestriction,
      ownerHint: ownerHintFromText(effectText) || 'opponent'
    });
  }

  const cantBeCountered = parseCantBeCountered(effectText);
  if (cantBeCountered) {
    actions.push({
      ...cantBeCountered,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(effectText)
    });
  }

  const damagePreventionRestriction = parseDamagePreventionRestriction(effectText);
  if (damagePreventionRestriction) {
    actions.push({
      ...damagePreventionRestriction,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(effectText)
    });
  }

  const blockingRestriction = parseBlockingRestriction(effectText);
  if (blockingRestriction) {
    actions.push({
      ...blockingRestriction,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: ownerHintFromText(effectText)
    });
  }

  const topLibraryPermanentDrop = parseTopLibraryPermanentDrop(effectText);
  if (topLibraryPermanentDrop) {
    actions.push({
      ...topLibraryPermanentDrop,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self'
    });
  }

  const playExiledCard = parsePlayExiledCard(effectText);
  if (playExiledCard) {
    actions.push({
      ...playExiledCard,
      ownerHint: 'self'
    });
  }

  const alternateCastPermission = parseAlternateCastPermission(effectText);
  if (alternateCastPermission) {
    actions.push({
      ...alternateCastPermission,
      ownerHint: 'self'
    });
  }

  const freeCastFromHand = parseFreeCastFromHand(effectText);
  if (freeCastFromHand) {
    actions.push({
      ...freeCastFromHand,
      ownerHint: 'self'
    });
  }

  const fightEffect = parseFightEffect(effectText);
  if (fightEffect) {
    actions.push(fightEffect);
  }

  const directDamageEffect = parseDirectDamageEffect(effectText, conditionText);
  if (directDamageEffect) {
    actions.push(directDamageEffect);
  }

  const sourceDealsDamage = parseSourceDealsDamage(effectText);
  if (sourceDealsDamage) {
    actions.push(sourceDealsDamage);
  }

  const kickedEntryBonus = parseKickedEntryBonus(effectText, conditionText);
  if (kickedEntryBonus) {
    actions.push({
      ...kickedEntryBonus,
      ownerHint: 'self'
    });
  }

  const doublePowerToughness = parseDoublePowerToughness(effectText);
  if (doublePowerToughness) {
    actions.push(doublePowerToughness);
  }

  const shuffleSourceIntoLibrary = parseShuffleSourceIntoLibrary(effectText);
  if (shuffleSourceIntoLibrary) {
    actions.push(shuffleSourceIntoLibrary);
  }

  const regenerateEffect = parseRegenerateEffect(effectText);
  if (regenerateEffect) {
    actions.push(regenerateEffect);
  }

  const selfDamageEffect = parseSelfDamageEffect(effectText);
  if (selfDamageEffect) {
    actions.push(selfDamageEffect);
  }

  const sacrificeSourceEffect = parseSacrificeSourceEffect(effectText);
  if (sacrificeSourceEffect) {
    actions.push(sacrificeSourceEffect);
  }

  const counterSpellEffect = parseCounterSpellEffect(effectText, conditionText);
  if (counterSpellEffect) {
    actions.push(counterSpellEffect);
  } else {
    const firstCounterSentence = String(effectText || '').match(/^(counter\s+target\s+(?:noncreature\s+spell|instant or sorcery spell|spell|[^.]+?spell))\./i)?.[1] || '';
    const chainedCounterSpellEffect = firstCounterSentence ? parseCounterSpellEffect(firstCounterSentence, conditionText) : null;
    if (chainedCounterSpellEffect) actions.push(chainedCounterSpellEffect);
  }

  const extraTurnEffect = parseExtraTurnEffect(effectText);
  if (extraTurnEffect) {
    actions.push(extraTurnEffect);
  }

  const loseGameEffect = parseLoseGameEffect(effectText);
  if (loseGameEffect) {
    actions.push(loseGameEffect);
  }

  if (!combatCreatureAction && /\bdestroy\b/.test(effectLower)) {
    actions.push({ type: 'destroy', targetFilters, ownerHint, targetCount, label: `Destroy ${targetFilters.join(' or ') || 'target permanent/card'}` });
  }
  const temporaryExile = parseTemporaryExileEffect(effectText);
  if (temporaryExile) {
    actions.push(temporaryExile);
  }
  if (!temporaryExile && /\bexile\b/.test(effectLower) && /\btarget\b/.test(effectLower)) {
    actions.push({
      type: 'exile',
      targetFilters,
      ownerHint,
      targetCount,
      targetExcludesSource: /\banother target\b/i.test(effectText),
      targetDescription: /\banother target\b/i.test(effectText) ? effectText.match(/another target\s+([^.]*)/i)?.[0] || '' : '',
      label: `Exile ${/\banother target\b/i.test(effectText) ? 'another ' : ''}${targetFilters.join(' or ') || 'target permanent/card'}`
    });
  }
  if (/\bdraws?\b/.test(effectLower) && /cards?\b/.test(effectLower)) {
    const draw = parseDrawEffect(effectText);
    if (draw) actions.push({ type: 'draw', count: draw.count, countExpression: draw.countExpression, label: draw.label, affectedObjects, conditionText });
  }
  if (/\bcreates?\b/.test(effectLower) && /\btoken/.test(effectLower)) {
    const token = parseToken(effectText);
    const controllerLabel = token.controllerHint === 'targetController' ? `Target permanent's controller creates` : 'Create';
    const traitLabel = token.traits?.length ? ` with ${token.traits.join(', ')}` : '';
    actions.push({ type: 'create_token', token, controllerHint: token.controllerHint || 'sourceController', targetCount, ownerHint, label: `${controllerLabel} ${token.count} ${token.power && token.toughness ? `${token.power}/${token.toughness} ` : ''}${token.name} token(s)${traitLabel}` });
  }
  if (/search your library/i.test(effectText)) {
    const criteria = parseLibrarySearchCriteria(effectText);
    const searchLabel = criteria.landChoices?.length
      ? criteria.landChoices.join(' / ')
      : (criteria.targetFilters || ['Card']).join(' or ');
    actions.push({
      type: 'search_library',
      targetFilters: criteria.targetFilters,
      searchCriteria: criteria,
      destination: criteria.destination,
      label: `Search library for ${criteria.optionalCount ? 'up to ' : ''}${criteria.maxChoices || 1} ${searchLabel}${criteria.reveal ? ' and reveal' : ''}`,
      instructionLabel: criteria.instructionLabel || '',
      distribution: criteria.distribution || [],
      reveal: criteria.reveal,
      thenShuffle: criteria.thenShuffle
    });
  }
  const setLifeTotal = parseSetLifeTotal(effectText);
  if (setLifeTotal) {
    actions.push({ ...setLifeTotal, ownerHint: ownerHintFromText(effectText), conditionText });
  }

  const lifeFloorReplacement = parseLifeFloorReplacement(effectText);
  if (lifeFloorReplacement) {
    actions.push({
      ...lifeFloorReplacement,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      linkedStatic: !costText,
      conditionText
    });
  }

  const lifeGainReplacement = parseLifeGainReplacement(effectText, conditionText);
  if (lifeGainReplacement) {
    actions.push({
      ...lifeGainReplacement,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      linkedStatic: !costText
    });
  }

  if (!lifeGainReplacement && /\bgains?\s+(?:life|x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|that much|an amount of)\b[^.]*\blife\b/i.test(effectText)) {
    const lifeMatch = effectText.match(/gains?\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life/i);
    const equalMatch = effectText.match(/gains?\s+life\s+equal\s+to\s+([^.]+)/i);
    const life = equalMatch ? 'dynamic' : numberFromText(lifeMatch?.[1] || '', 1);
    actions.push({
      type: 'gain_life',
      amount: life,
      amountFormula: equalMatch ? `value:${normalizeCountSubject(equalMatch[1])}` : '',
      amountLabel: equalMatch ? `equal to ${equalMatch[1].trim()}` : '',
      label: equalMatch ? `Gain life equal to ${equalMatch[1].trim()}` : `Gain ${life} life`
    });
  }
  if (/\badd\b/.test(effectLower) && (/\{[wubrgc0-9x/]+\}/i.test(effectText) || /mana/i.test(effectText))) {
    const parsedMana = parseProducedManaEffect(effectText);
    const mana = parsedMana.producedMana?.length ? parsedMana.producedMana : manaSymbolsFromText(effectText);
    const commanderIdentity = /commander(?:'s)? color identity/i.test(effectText);
    const devotionMatch = effectText.match(/equal to your devotion to (white|blue|black|red|green)/i);
    const devotionColor = devotionMatch ? MANA_WORDS[devotionMatch[1].toLowerCase()] : null;
    const label = devotionColor
      ? `Add {${devotionColor}} equal to devotion to ${devotionMatch[1].toLowerCase()}`
      : commanderIdentity
        ? 'Add commander-color mana'
        : (parsedMana.label || `Add ${compactManaLabel(mana)}`);
    actions.push({
      type: 'add_mana',
      mana: (effectText.match(/\{[^}]+\}/g) || []).join('') || formatManaSymbols(mana),
      producedMana: mana,
      producedManaLabel: parsedMana.producedManaLabel || compactManaLabel(mana),
      colorMode: commanderIdentity ? 'commanderColorIdentity' : (mana.includes('ANY') ? 'any' : 'fixed'),
      manaRestriction: parsedMana.manaRestriction || (commanderIdentity ? 'commander color identity' : ''),
      manaRestrictionKind: parsedMana.manaRestrictionKind || '',
      restrictedMana: Boolean(parsedMana.manaRestriction),
      amountFormula: devotionColor ? `devotion:${devotionColor}` : (parsedMana.amountFormula || ''),
      amountLabel: devotionColor ? `devotion to ${devotionMatch[1].toLowerCase()}` : (parsedMana.amountLabel || ''),
      label
    });
  }

  const counters = parseCounterEffect(effectText);
  if (counters) {
    actions.push({
      type: 'add_counters',
      ...counters,
      affectedObjects,
      ownerHint: ownerHintFromText(counters.affectedObjects || effectText),
      targetCount: { min: 0, max: 0, optional: false },
      label: `Put ${counters.counterAmount} ${counters.counterType} counter(s) on ${counters.affectedObjects}`
    });
  }

  const equipmentStatic = parseEquipmentStatic(effectText);
  if (equipmentStatic) {
    actions.push({ type: 'equipment_static_pt', ...equipmentStatic, targetCount: { min: 0, max: 0, optional: false }, ownerHint: 'self' });
  }

  const intrinsicTraits = parseIntrinsicTraits(effectText);
  for (const intrinsicTrait of intrinsicTraits) {
    actions.push({
      type: 'intrinsic_trait',
      ...intrinsicTrait,
      targetFilters: ['Creature'],
      targetCount: { min: 0, max: 0, optional: false },
      linkedStatic: true,
      ownerHint: 'self'
    });
  }

  const grantedTraits = parseGrantedTraits(effectText);
  for (const grantedTrait of grantedTraits) {
    actions.push({
      type: 'grant_trait',
      ...grantedTrait,
      targetFilters: targetFiltersFromText(grantedTrait.affectedObjects || effectText),
      targetCount: { min: 0, max: 0, optional: false },
      linkedStatic: !costText,
      ownerHint: ownerHintFromText(effectText)
    });
  }

  const temporaryKeywordGrants = parseTemporaryKeywordGrants(effectText);
  for (const temporaryKeywordGrant of temporaryKeywordGrants) {
    actions.push({
      type: 'grant_trait',
      ...temporaryKeywordGrant,
      targetFilters: targetFiltersFromText(temporaryKeywordGrant.affectedObjects || effectText),
      targetCount: { min: 0, max: 0, optional: false },
      linkedStatic: false,
      ownerHint: ownerHintFromText(effectText)
    });
  }

  const entryModifier = parseEntryModifier(effectText);
  if (entryModifier) {
    actions.push({
      type: 'entry_modifier',
      ...entryModifier,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      linkedStatic: true
    });
  }

  const enterAsCopy = parseEnterAsCopyEffect(effectText);
  if (enterAsCopy) {
    actions.push(enterAsCopy);
  }

  const entryCounterModifier = parseEntryCounterModifier(effectText);
  if (entryCounterModifier) {
    actions.push({
      ...entryCounterModifier,
      targetCount: { min: 0, max: 0, optional: false },
      ownerHint: 'self',
      linkedStatic: true
    });
  }

  if (/^attach this equipment to target creature you control/i.test(effectText) || /^equip\b/i.test(lowered)) {
    actions.push({ type: 'equip', targetFilters: ['Creature'], ownerHint: 'self', targetCount: { min: 1, max: 1, optional: false }, label: `Equip ${costText || ''}`.trim() || 'Equip', costText, cost });
  }

  const selfAnimationActions = parseSelfAnimationBundle(effectText);
  if (selfAnimationActions.length) {
    for (const animationAction of selfAnimationActions) pushUniqueAction(actions, animationAction);
  }

  const basePtActions = parseBasePowerToughnessBundle(effectText);
  if (basePtActions.length) {
    for (const baseAction of basePtActions) pushUniqueAction(actions, baseAction);
  }

  const pt = parsePtModification(effectText);
  const isTokenCreationText = /\bcreates?\b/i.test(effectText) && /\btokens?\b/i.test(effectText);
  const hasSpecialBaseSetter = actions.some((action) => action.type === 'set_base_pt');
  if (pt && !hasSpecialBaseSetter && !isTokenCreationText && !counters && !equipmentStatic && !/base power and toughness|becomes a\s+(?:x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*\/\s*(?:x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b.+?creature/i.test(effectText) && /gets?|creatures?|target|wurms?|elves?|goblins?|zombies?|humans?/i.test(effectText)) {
    const dynamic = /for each|where x|equal to|greatest|number of/i.test(effectText);
    const filteredAffected = affectedObjects || parseAffectedObjects(effectText);
    actions.push({
      type: 'modify_pt',
      ...pt,
      dynamic,
      affectedObjects: filteredAffected,
      targetFilters: targetFiltersFromText(filteredAffected || effectText),
      ownerHint,
      targetCount: filteredAffected && !/target/i.test(filteredAffected) ? { min: 0, max: 0, optional: false } : targetCount,
      linkedStatic: !costText && !/until end of turn/i.test(effectText),
      duration: /until end of turn/i.test(effectText) ? 'until-end-of-turn' : '',
      label: formatPtModificationLabel(filteredAffected, pt, dynamic, effectText)
    });
  }

  const proactiveGeneralActions = parseProactiveGeneralActions(effectText, conditionText, triggerText, originalText || text, costText);
  if (proactiveGeneralActions.length) {
    for (const proactiveAction of proactiveGeneralActions) pushUniqueAction(actions, proactiveAction);
  }

  const enrichedActions = actions.map((action) => ({
    ...action,
    conditionText: action.conditionText || conditionText,
    costReduction: action.costReduction || costReduction,
    triggerText: action.triggerText || triggerText,
    modeHeader: rawAbility.modeHeader || '',
    isMode: Boolean(rawAbility.isMode),
    sourceText: originalText,
    sourceZoneRequirement: action.sourceZoneRequirement || cost.sourceZone || '',
    sourceCostMove: action.sourceCostMove || cost.sourceMove || null
  }));
  const confidenceProfile = scoreParsedAbilityConfidence({
    originalText,
    costText,
    triggerText,
    conditionText,
    effectText,
    actions: enrichedActions,
    rawAbility
  });

  return {
    id: `ability-${index}`,
    sourceText: originalText,
    modeHeader: rawAbility.modeHeader || '',
    isMode: Boolean(rawAbility.isMode),
    optional,
    mandatory: !optional,
    costText,
    cost,
    triggerText,
    conditionText,
    effectText,
    actions: enrichedActions,
    confidence: confidenceProfile.score,
    confidenceReasons: confidenceProfile.reasons,
    notes: enrichedActions.length ? [] : ['No common action template recognized yet.']
  };
}

function defaultBrain() {
  return { version: 1, updatedAt: Date.now(), cards: {}, patterns: {}, feedback: [] };
}

export function loadAiBrain() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultBrain();
    const parsed = JSON.parse(raw);
    return { ...defaultBrain(), ...parsed, cards: parsed.cards || {}, patterns: parsed.patterns || {}, feedback: parsed.feedback || [] };
  } catch {
    return defaultBrain();
  }
}

export function saveAiBrain(brain) {
  const next = { ...brain, updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  return next;
}

export function buildAiCardPlan(card, context = {}, brain = loadAiBrain()) {
  const { primaryKey: key, foundKey, entry: learned } = lookupLearnedCard(brain, card);
  const abilities = splitOracleIntoAbilities(card?.oracleText).map(parseAbility);
  const actions = abilities.flatMap((ability) => ability.actions.map((action) => ({
    ...action,
    abilityId: ability.id,
    abilityText: ability.sourceText,
    effectText: ability.effectText,
    optional: action.optional ?? ability.optional,
    costText: action.costText || ability.costText,
    cost: action.cost || ability.cost,
    sourceZoneRequirement: action.sourceZoneRequirement || ability.cost?.sourceZone || '',
    sourceCostMove: action.sourceCostMove || ability.cost?.sourceMove || null,
    modeHeader: ability.modeHeader
  })));
  const detectedResponse = detectResponseProfile(card, actions);
  const responseProfile = typeof learned?.responseWorthy === 'boolean'
    ? { responseWorthy: learned.responseWorthy, reasons: learned.responseReasons || detectedResponse.reasons || [], label: learned.responseWorthy ? 'Response-worthy from AI memory' : 'Marked as not response-worthy in AI memory', learned: true }
    : detectedResponse;
  const baseConfidence = actions.length ? abilities.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, abilities.length) : 0;
  const patternProfile = patternTrustProfile(actions, brain);
  const learnedBoost = learned?.approvedCount ? Math.min(0.06, 0.02 + Number(learned.approvedCount || 0) * 0.02) : 0;
  const finalConfidence = actions.length ? Math.round(Math.min(0.99, baseConfidence + patternProfile.confidenceBoost + learnedBoost) * 100) : 0;
  const confidenceReasons = [
    ...abilities.flatMap((ability) => ability.confidenceReasons || []).slice(0, 8),
    ...patternProfile.reasons,
    learnedBoost ? 'This exact card has approved AI memory' : ''
  ].filter(Boolean);
  const modalChoiceRules = uniqueBy(
    abilities.map((ability) => parseModalChoiceRule(ability.modeHeader || '')).filter(Boolean),
    (rule) => `${rule.defaultChoices}|${rule.upgradedChoices || ''}|${rule.upgradeCondition || ''}`
  );
  const plan = {
    cardKey: key,
    cardName: card?.name || 'Unknown card',
    oracleText: card?.oracleText || '',
    typeLine: card?.typeLine || '',
    learned: Boolean(learned?.approvedCount),
    learnedFromLegacyKey: Boolean(learned && foundKey !== key),
    approvedCount: learned?.approvedCount || 0,
    rejectedCount: learned?.rejectedCount || 0,
    abilities,
    actions,
    modalChoiceRules,
    confidence: finalConfidence,
    baseConfidence: Math.round(baseConfidence * 100),
    patternProfile,
    confidenceReasons: [...new Set(confidenceReasons)],
    memoryNote: learned?.note || '',
    responseProfile
  };
  return suggestTargets(plan, context);
}

function cardThreatScore(boardCard) {
  const card = boardCard?.card || {};
  const type = card.typeLine || '';
  const oracle = card.oracleText || '';
  let score = Number(card.manaValue || 0) * 1.2;
  const p = Number(String(card.power || '').replace(/[^0-9.-]/g, ''));
  const t = Number(String(card.toughness || '').replace(/[^0-9.-]/g, ''));
  if (Number.isFinite(p)) score += Math.max(0, p) * 1.6;
  if (Number.isFinite(t)) score += Math.max(0, t) * 0.6;
  if (/commander/i.test(String(boardCard?.boardId || '')) || boardCard?.isCommander) score += 8;
  if (/Creature/i.test(type)) score += 3;
  if (/Planeswalker/i.test(type)) score += 7;
  if (/Artifact|Enchantment/i.test(type)) score += 2;
  if (/draw|create|destroy|exile|double|trample|indestructible|deathtouch|flying|haste/i.test(oracle)) score += 4;
  return Math.round(score * 10) / 10;
}

function matchesFilters(boardCard, filters = []) {
  if (!filters.length || filters.includes('Card')) return true;
  const type = boardCard?.card?.typeLine || '';
  if (filters.includes('Permanent')) return !['graveyard', 'exile', 'library'].includes(boardCard.zone);
  return filters.some((filter) => new RegExp(`\\b${filter}\\b`, 'i').test(type));
}

const CREATURE_TYPE_STOPWORDS = new Set([
  'Creature','Artifact','Enchantment','Legendary','Basic','Token','Snow','World','Tribal',
  'Land','Instant','Sorcery','Planeswalker','Battle','Equipment','Aura','Vehicle'
]);

function creatureTypesFromCard(card = {}) {
  const typeLine = String(card?.typeLine || '');
  if (!/\bCreature\b/i.test(typeLine)) return [];
  const subtypeText = typeLine.includes('—')
    ? typeLine.split('—').slice(1).join(' ')
    : (typeLine.includes('-') ? typeLine.split('-').slice(1).join(' ') : typeLine);
  return [...new Set(subtypeText
    .split(/\s+/)
    .map((part) => part.trim().replace(/[^A-Za-z]/g, ''))
    .filter((part) => part && /^[A-Z]/.test(part) && !CREATURE_TYPE_STOPWORDS.has(part)))];
}

function creatureTypeDistribution(cards = []) {
  const counts = {};
  for (const item of cards || []) {
    const card = item.card || item;
    for (const type of creatureTypesFromCard(card)) counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function bestCreatureTypeFromContext(context = {}, preferredTypes = []) {
  const seat = context.seat;
  const ownBattlefieldCreatures = (context.boardCards || []).filter((card) => (
    card.ownerSeat === seat &&
    BATTLEFIELD_ZONES.includes(card.zone) &&
    /\bCreature\b/i.test(card?.card?.typeLine || '')
  ));
  const boardCounts = creatureTypeDistribution(ownBattlefieldCreatures);
  const deckCounts = creatureTypeDistribution(context.library || []);
  const handCounts = creatureTypeDistribution(context.hand || []);
  const allTypes = [...new Set([...Object.keys(boardCounts), ...Object.keys(deckCounts), ...Object.keys(handCounts), ...preferredTypes])];
  const scored = allTypes.map((type) => {
    const board = boardCounts[type] || 0;
    const deck = deckCounts[type] || 0;
    const hand = handCounts[type] || 0;
    const preferred = preferredTypes.includes(type) ? 2 : 0;
    const score = board * 7 + hand * 3 + deck * 1 + preferred;
    return { type, board, hand, deck, score };
  }).sort((a, b) => b.score - a.score || b.board - a.board || b.deck - a.deck || a.type.localeCompare(b.type));
  const best = scored[0] || null;
  return {
    bestType: best?.type || '',
    boardCounts,
    deckCounts,
    handCounts,
    scored: scored.slice(0, 6),
    reason: best
      ? `Recommend ${best.type}: ${best.board} on battlefield, ${best.hand} in hand, ${best.deck} in library.`
      : 'No creature type support detected yet.'
  };
}

function sharedCreatureTypes(a = {}, b = {}) {
  const aTypes = creatureTypesFromCard(a.card || a);
  const bTypes = creatureTypesFromCard(b.card || b);
  return aTypes.filter((type) => bTypes.includes(type));
}

function evaluateEquipmentStaticForTarget(action = {}, target = null, context = {}) {
  if (!target) return null;
  const seat = context.seat;
  const ownCreatures = (context.boardCards || []).filter((card) => (
    card.ownerSeat === seat &&
    card.boardId !== target.boardId &&
    BATTLEFIELD_ZONES.includes(card.zone) &&
    /\bCreature\b/i.test(card?.card?.typeLine || '')
  ));
  const targetTypes = creatureTypesFromCard(target.card || {});
  const matching = ownCreatures.filter((card) => sharedCreatureTypes(target, card).length);
  const deckCounts = creatureTypeDistribution(context.library || []);
  const handCounts = creatureTypeDistribution(context.hand || []);
  const deckSupport = targetTypes.reduce((sum, type) => sum + (deckCounts[type] || 0), 0);
  const handSupport = targetTypes.reduce((sum, type) => sum + (handCounts[type] || 0), 0);
  const immediate = matching.length;
  const perPower = Math.abs(Number(action.powerDelta || 0)) || 1;
  const perToughness = Math.abs(Number(action.toughnessDelta || 0)) || 1;
  const score = immediate * 12 + handSupport * 3 + deckSupport * 1 + cardThreatScore(target) * 0.5;
  return {
    target: {
      boardId: target.boardId,
      name: target.card?.name || 'Unknown creature',
      ownerSeat: target.ownerSeat,
      zone: target.zone,
      types: targetTypes,
      threat: cardThreatScore(target)
    },
    matchingCount: immediate,
    matchingNames: matching.slice(0, 5).map((card) => card.card?.name || 'Creature'),
    deckSupport,
    handSupport,
    estimatedPowerBonus: immediate * perPower,
    estimatedToughnessBonus: immediate * perToughness,
    score: Math.round(score * 10) / 10,
    reason: targetTypes.length
      ? `${target.card?.name || 'Target'} shares ${targetTypes.join('/')} with ${immediate} other creature(s) now; ${handSupport} matching creature(s) in hand; ${deckSupport} matching creature(s) in library.`
      : `${target.card?.name || 'Target'} has no clear creature subtype.`
  };
}

function recommendEquipmentTarget(action = {}, context = {}) {
  const seat = context.seat;
  const candidates = (context.boardCards || []).filter((card) => (
    card.ownerSeat === seat &&
    BATTLEFIELD_ZONES.includes(card.zone) &&
    /\bCreature\b/i.test(card?.card?.typeLine || '') &&
    card.boardId !== context.sourceBoardId
  ));
  const evaluated = candidates.map((card) => evaluateEquipmentStaticForTarget(action, card, context)).filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const typeForecast = bestCreatureTypeFromContext(context);
  return {
    best: evaluated[0] || null,
    candidates: evaluated.slice(0, 6),
    typeForecast,
    reason: evaluated[0]?.reason || (typeForecast.bestType ? `No creature to equip yet. Future support points toward ${typeForecast.bestType}: ${typeForecast.reason}` : 'No creature available to equip yet.')
  };
}

function currentPowerOf(boardCard) {
  const base = Number(String(boardCard?.card?.power || '').replace(/[^0-9.-]/g, ''));
  const modPower = (boardCard?.mods || []).reduce((sum, mod) => sum + Number(mod.powerDelta || 0), 0);
  return (Number.isFinite(base) ? base : 0) + modPower;
}

function cardMatchesLooseSubtype(boardCard, phrase = '') {
  const text = String(phrase || '').toLowerCase();
  const haystack = `${boardCard?.card?.name || ''} ${boardCard?.card?.typeLine || ''} ${boardCard?.card?.oracleText || ''}`.toLowerCase();
  if (/wurm/.test(text)) return /\bwurm\b/i.test(haystack);
  if (/elf|elves/.test(text)) return /\belf\b|\belves\b/i.test(haystack);
  if (/goblin/.test(text)) return /\bgoblin\b/i.test(haystack);
  if (/zombie/.test(text)) return /\bzombie\b/i.test(haystack);
  if (/creature/.test(text)) return /\bcreature\b/i.test(boardCard?.card?.typeLine || '');
  return true;
}

function evaluateCostReduction(action = {}, context = {}) {
  const reduction = action.costReduction;
  if (!reduction) return null;
  const seat = context.seat;
  const ownBattlefield = (context.boardCards || []).filter((card) => (
    card.ownerSeat === seat &&
    !['graveyard', 'exile', 'library'].includes(card.zone)
  ));
  const xDef = reduction.xDefinition || '';
  let currentX = 0;
  let reason = xDef ? `Needs manual check: ${xDef}` : 'No reduction formula detected.';
  const greatestPower = xDef.match(/greatest power among\s+(.+?)\s+you control/i);
  if (greatestPower) {
    const group = greatestPower[1].trim();
    const matches = ownBattlefield.filter((card) => cardMatchesLooseSubtype(card, group));
    currentX = matches.reduce((max, card) => Math.max(max, currentPowerOf(card)), 0);
    const best = matches.sort((a, b) => currentPowerOf(b) - currentPowerOf(a))[0];
    reason = best
      ? `X = ${currentX}, from ${best.card?.name || 'matching permanent'} (${group} you control).`
      : `X = 0, no ${group} you control found.`;
  }
  const rawCost = action.costText || action.cost?.raw || '';
  const symbols = rawCost.match(/\{[^}]+\}/g) || [];
  const generic = symbols.reduce((sum, symbol) => {
    const n = Number(symbol.replace(/[{}]/g, ''));
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
  const colored = symbols.filter((symbol) => !/^\{\d+\}$/.test(symbol) && !/^\{T\}$/i.test(symbol));
  const reductionApplied = Math.min(generic, Number(currentX || 0));
  const remainingGeneric = Math.max(0, generic - reductionApplied);
  const payableCost = `${remainingGeneric ? `{${remainingGeneric}}` : ''}${colored.join('')}${/\{T\}/i.test(rawCost) ? ', {T}' : ''}` || 'No mana cost';
  return {
    ...reduction,
    currentX,
    genericBase: generic,
    reductionApplied,
    remainingGeneric,
    coloredRemainder: colored.join(''),
    payableCost,
    reason
  };
}

function suggestTargets(plan, context = {}) {
  const boardCards = context.boardCards || [];
  const seat = context.seat;
  const opponentCards = boardCards.filter((card) => card.ownerSeat !== seat && !['graveyard', 'exile', 'library'].includes(card.zone));
  const ownCards = boardCards.filter((card) => card.ownerSeat === seat && !['graveyard', 'exile', 'library'].includes(card.zone));
  const equipmentStaticAction = plan.actions.find((item) => item.type === 'equipment_static_pt');
  const actions = plan.actions.map((action) => {
    let candidates = [];
    let equipmentRecommendation = null;
    let creatureTypeChoice = null;
    if (['destroy', 'exile', 'temporary_exile_return', 'linked_exile_until_source_leaves'].includes(action.type)) {
      candidates = (action.ownerHint === 'self' ? ownCards : opponentCards)
        .filter((card) => matchesFilters(card, action.targetFilters))
        .filter((card) => !action.targetExcludesSource || card.boardId !== context.sourceBoardId);
    } else if (action.type === 'modify_pt') {
      if (action.affectedObjects && !/target/i.test(action.effectText || action.sourceText || '')) {
        candidates = [];
      } else {
        const wantsEnemy = Number(action.powerDelta || 0) + Number(action.toughnessDelta || 0) < 0;
        candidates = (wantsEnemy ? opponentCards : ownCards).filter((card) => matchesFilters(card, action.targetFilters));
      }
    } else if (action.type === 'equipment_static_pt') {
      equipmentRecommendation = recommendEquipmentTarget(action, context);
      candidates = [];
    } else if (action.type === 'choose_creature_type') {
      creatureTypeChoice = bestCreatureTypeFromContext(context);
      candidates = [];
    } else if (action.type === 'equip') {
      candidates = ownCards.filter((card) => matchesFilters(card, action.targetFilters) && card.boardId !== context.sourceBoardId);
      if (equipmentStaticAction) {
        const evaluated = candidates.map((card) => evaluateEquipmentStaticForTarget(equipmentStaticAction, card, context)).filter(Boolean);
        const evalById = new Map(evaluated.map((item) => [item.target.boardId, item]));
        candidates = candidates.sort((a, b) => (evalById.get(b.boardId)?.score || 0) - (evalById.get(a.boardId)?.score || 0) || cardThreatScore(b) - cardThreatScore(a));
        const sortedEvaluated = evaluated.sort((a, b) => b.score - a.score);
        const typeForecast = bestCreatureTypeFromContext(context);
        equipmentRecommendation = { best: sortedEvaluated[0] || null, candidates: sortedEvaluated.slice(0, 6), typeForecast, reason: sortedEvaluated[0]?.reason || (typeForecast.bestType ? `No creature to equip yet. Future support points toward ${typeForecast.bestType}: ${typeForecast.reason}` : 'No tribal equipment payoff found yet.') };
      }
    }
    if (action.type === 'search_library') {
      const library = context.library || [];
      const criteria = action.searchCriteria || {};
      const libraryCandidates = library.filter((card) => cardMatchesLibraryCriteria(card, criteria));
      const maxChoices = Math.max(1, Number(criteria.maxChoices || 1));
      const chosenCards = [...libraryCandidates].sort((a, b) => {
        const first = chooseLibraryCandidate([a, b], criteria);
        return first === a ? -1 : 1;
      }).slice(0, maxChoices);
      const distribution = criteria.distribution || [];
      const destinationForIndex = (index) => {
        if (!distribution.length) return { destination: criteria.destination || action.destination || 'hand', tapped: false };
        let cursor = 0;
        for (const step of distribution) {
          const count = Math.max(1, Number(step.count || 1));
          if (index >= cursor && index < cursor + count) return { destination: step.destination || 'hand', tapped: Boolean(step.tapped) };
          cursor += count;
        }
        return { destination: 'hand', tapped: false };
      };
      const chosen = chosenCards[0] || null;
      return {
        ...action,
        costReductionCheck: evaluateCostReduction(action, context),
        libraryChoice: chosen ? { name: chosen.name, typeLine: chosen.typeLine, manaCost: chosen.manaCost || '', scryfallId: chosen.scryfallId || chosen.id || '', reason: `Chosen from ${libraryCandidates.length} valid library option(s)`, ...destinationForIndex(0) } : null,
        libraryChoices: chosenCards.map((card, index) => ({ name: card.name, typeLine: card.typeLine, manaCost: card.manaCost || '', scryfallId: card.scryfallId || card.id || '', ...destinationForIndex(index) })),
        choiceCount: chosenCards.length,
        candidateCount: libraryCandidates.length,
        target: null
      };
    }
    const target = candidates[0] || null;
    const conditionCheck = evaluateConditionText(action.conditionText, context);
    const costReductionCheck = evaluateCostReduction(action, context);
    const targetEval = target && equipmentRecommendation?.candidates?.find((item) => item.target.boardId === target.boardId);
    return {
      ...action,
      conditionCheck,
      costReductionCheck,
      equipmentRecommendation,
      creatureTypeChoice,
      target: target ? {
        boardId: target.boardId,
        name: target.card?.name || 'Unknown',
        zone: target.zone,
        ownerSeat: target.ownerSeat,
        originalOwnerSeat: target.originalOwnerSeat || target.ownerSeat,
        threat: cardThreatScore(target),
        equipmentScore: targetEval?.score,
        equipmentReason: targetEval?.reason,
        estimatedPowerBonus: targetEval?.estimatedPowerBonus,
        estimatedToughnessBonus: targetEval?.estimatedToughnessBonus
      } : null,
      candidateCount: candidates.length
    };
  });
  return { ...plan, actions };
}

export function scoreAiCardForCast(card, context = {}, brain = loadAiBrain()) {
  const plan = buildAiCardPlan(card, context, brain);
  let score = Number(card?.manaValue || 0) * 0.3;
  if (/Creature/i.test(card?.typeLine || '')) score += 2 + Math.max(0, Number(card?.power || 0)) * 0.4;
  for (const action of plan.actions) {
    if (action.type === 'destroy' || action.type === 'exile') score += action.target ? 10 + action.target.threat : 2;
    if (['temporary_exile_return', 'linked_exile_until_source_leaves'].includes(action.type)) score += action.target ? 8 + action.target.threat : 2;
    if (action.type === 'draw') score += (action.count === 'X' ? 2 : Number(action.count || 1)) * 3;
    if (action.type === 'create_token') score += Number(action.token?.count || 1) * 3;
    if (action.type === 'search_library') score += 4;
    if (action.type === 'modify_pt') score += action.target ? 5 : 1;
    if (action.type === 'add_counters') score += 6;
    if (action.type === 'grant_trait') score += 3;
    if (action.type === 'intrinsic_trait') score += 1;
    if (action.type === 'equipment_static_pt') score += action.equipmentRecommendation?.best ? 2 + Math.min(8, action.equipmentRecommendation.best.estimatedPowerBonus || 0) : 1;
    if (action.type === 'equip') score += action.target ? 4 + Math.min(8, action.target.estimatedPowerBonus || 0) : 1;
    if (action.type === 'gain_life') score += 1;
    if (action.type === 'set_life_total') score += 3;
    if (action.type === 'life_floor_replacement') score += 5;
    if (action.type === 'casting_cost_modifier') score += 2;
    if (action.type === 'cycling') score += 1;
    if (action.keywordAction === 'backup') score += 3;
    if (action.keywordAction === 'eternalize') score += 3;
    if (action.type === 'casting_cost_mechanic') score += 1;
    if (action.type === 'untap') score += 2;
    if (action.type === 'put_from_hand_to_battlefield') score += 3;
    if (action.type === 'mill_return_milled') score += 2;
    if (action.type === 'spell_counter_restriction') score += 1;
    if (action.type === 'damage_prevention_restriction') score += 1;
    if (action.type === 'blocking_restriction') score += 2;
    if (action.type === 'top_library_permanent_to_battlefield') score += 4;
  }
  if (plan.learned) score += 2;
  return score;
}

export function recordAiFeedback(brain, plan, verdict, note = '', options = {}) {
  const key = plan.cardKey;
  const current = brain.cards?.[key] || { approvedCount: 0, rejectedCount: 0, seenCount: 0, notes: [], executableAbilities: [] };
  const learnedExecutables = verdict === 'approved' ? executableAbilitiesFromPlan(plan) : [];
  const nextEntry = {
    ...current,
    seenCount: Number(current.seenCount || 0) + 1,
    approvedCount: Number(current.approvedCount || 0) + (verdict === 'approved' ? 1 : 0),
    rejectedCount: Number(current.rejectedCount || 0) + (verdict === 'rejected' ? 1 : 0),
    note: note || current.note || '',
    responseWorthy: typeof options.responseWorthy === 'boolean' ? options.responseWorthy : (typeof current.responseWorthy === 'boolean' ? current.responseWorthy : Boolean(plan.responseProfile?.responseWorthy)),
    responseReasons: options.responseReason ? [options.responseReason] : (plan.responseProfile?.reasons || current.responseReasons || []),
    executableAbilities: verdict === 'approved'
      ? mergeExecutableAbilities(current.executableAbilities || [], learnedExecutables)
      : (current.executableAbilities || []),
    lastVerdict: verdict,
    lastSeenAt: Date.now(),
    lastPlan: {
      cardName: plan.cardName,
      abilities: plan.abilities,
      actions: plan.actions.map(({ target, ...action }) => action),
      responseProfile: { ...plan.responseProfile, responseWorthy: typeof options.responseWorthy === 'boolean' ? options.responseWorthy : plan.responseProfile?.responseWorthy }
    }
  };
  const currentPatterns = brain.patterns || {};
  const feedbackPatterns = collectActionPatterns(plan.actions || []);
  const nextPatterns = feedbackPatterns.reduce((acc, pattern) => {
    const existing = acc[pattern.key] || { key: pattern.key, label: pattern.label, type: pattern.type, approvedCount: 0, rejectedCount: 0, lastSeenAt: 0 };
    acc[pattern.key] = {
      ...existing,
      label: pattern.label || existing.label,
      type: pattern.type || existing.type,
      approvedCount: Number(existing.approvedCount || 0) + (verdict === 'approved' ? 1 : 0),
      rejectedCount: Number(existing.rejectedCount || 0) + (verdict === 'rejected' ? 1 : 0),
      lastSeenAt: Date.now(),
      lastCardName: plan.cardName
    };
    return acc;
  }, { ...currentPatterns });
  const nextBrain = {
    ...brain,
    cards: { ...(brain.cards || {}), [key]: nextEntry },
    patterns: nextPatterns,
    feedback: [
      ...(brain.feedback || []).slice(-99),
      { cardKey: key, cardName: plan.cardName, verdict, note, at: Date.now(), patterns: feedbackPatterns.map((pattern) => pattern.key) }
    ]
  };
  return saveAiBrain(nextBrain);
}


function landFallbackAbility(boardCard) {
  const mana = manaSymbolsFromLand(boardCard?.card || {});
  if (!mana.length) return null;
  return {
    id: `land-fallback-${formatManaSymbols(mana)}`,
    source: 'land-fallback',
    type: 'mana',
    actionType: 'add_mana',
    label: `Tap for ${formatManaSymbols(mana)}`,
    costText: '{T}',
    effectText: `Add {${mana[0]}}.`,
    abilityText: `{T}: Add {${mana[0]}}.`,
    cost: parseCostText('{T}'),
    requiresTap: true,
    mana
  };
}

function knownAbilitiesForBoardCard(boardCard, brain = loadAiBrain(), context = {}) {
  const card = boardCard?.card || {};
  const learned = lookupLearnedCard(brain, card).entry?.executableAbilities || [];
  const parsedPlan = buildAiCardPlan(card, { ...context, seat: boardCard?.ownerSeat }, brain);
  const parsed = (parsedPlan.actions || []).map((action) => executableFromAction(action, 'parsed')).filter(Boolean);
  const fallback = /\bLand\b/i.test(card.typeLine || '') ? landFallbackAbility(boardCard) : null;
  return mergeExecutableAbilities([], [...learned, ...parsed, fallback].filter(Boolean));
}

function manaSourceUsability(boardCard, ability, turn = 0) {
  if (hasTapCost(ability) && /enters (the battlefield )?tapped/i.test(boardCard?.card?.oracleText || '') && boardCard?.enteredTurn === turn && boardCard?.tapped) {
    return { usable: false, reason: 'entered tapped' };
  }
  if (hasTapCost(ability) && boardCard?.tapped) return { usable: false, reason: 'tapped' };
  if (hasTapCost(ability) && isCreaturePermanent(boardCard) && !hasHaste(boardCard)) {
    const enteredTurn = Number(boardCard?.enteredTurn ?? boardCard?.controlledSinceTurn ?? -999999);
    if (Number.isFinite(enteredTurn) && enteredTurn >= Number(turn || 0)) return { usable: false, reason: 'summoning sick' };
    if (boardCard?.controlledSinceStartOfTurn === false) return { usable: false, reason: 'summoning sick' };
  }
  return { usable: true, reason: '' };
}

export function buildAiAbilityInventory({ boardCards = [], seat, turn = 0, brain = loadAiBrain() } = {}) {
  const battlefield = (boardCards || []).filter((boardCard) => (
    boardCard?.ownerSeat === seat && BATTLEFIELD_ZONES.includes(boardCard.zone)
  ));
  const activatedAbilities = [];
  const manaSources = [];
  const seenManaKeys = new Set();

  for (const boardCard of battlefield) {
    const abilities = knownAbilitiesForBoardCard(boardCard, brain, { boardCards, seat, turn });
    for (const ability of abilities) {
      const entryBase = {
        id: `${boardCard.boardId}-${ability.id}`,
        boardId: boardCard.boardId,
        sourceName: boardCard.card?.name || 'Unknown permanent',
        sourceZone: boardCard.zone,
        cardType: boardCard.card?.typeLine || '',
        costText: ability.costText || '',
        effectText: ability.effectText || '',
        abilityText: ability.abilityText || '',
        requiresTap: hasTapCost(ability),
        learned: ability.source === 'learned',
        source: ability.source || 'parsed',
        label: ability.label || ability.actionType || 'Ability'
      };
      if (ability.type === 'mana') {
        const usability = manaSourceUsability(boardCard, ability, turn);
        let produced = ability.mana || [];
        let formulaNote = '';
        if (ability.manaRestriction === 'commander color identity' || ability.colorMode === 'commanderColorIdentity') {
          const commanderColors = commanderColorIdentityHint({ boardCards, seat });
          if (commanderColors.length) produced = commanderColors;
          formulaNote = commanderColors.length ? `commander color identity: ${formatManaSymbols(commanderColors)}` : 'commander color identity unknown';
        }
        if (ability.amountFormula?.startsWith?.('devotion:')) {
          const color = ability.amountFormula.split(':')[1] || produced[0] || 'G';
          const count = Math.max(0, devotionToColor(boardCards, seat, color));
          produced = Array.from({ length: Math.max(1, count) }, () => color);
          formulaNote = `current ${ability.amountLabel || `devotion to ${color}`}: ${count}`;
        }
        if (ability.amountFormula?.startsWith?.('count:')) {
          const countCode = ability.amountFormula.split(':').slice(1).join(':');
          const ownedBattlefield = (boardCards || []).filter((card) => card.ownerSeat === seat && BATTLEFIELD_ZONES.includes(card.zone));
          const countByFormula = () => {
            if (countCode === 'creatures-you-control') return ownedBattlefield.filter((card) => /\bCreature\b/i.test(card?.card?.typeLine || '')).length;
            if (countCode === 'artifacts-you-control') return ownedBattlefield.filter((card) => /\bArtifact\b/i.test(card?.card?.typeLine || '')).length;
            if (countCode === 'enchantments-you-control') return ownedBattlefield.filter((card) => /\bEnchantment\b/i.test(card?.card?.typeLine || '')).length;
            if (countCode === 'lands-you-control') return ownedBattlefield.filter((card) => /\bLand\b/i.test(card?.card?.typeLine || '')).length;
            const basicMap = {
              'forests-you-control': 'Forest',
              'islands-you-control': 'Island',
              'swamps-you-control': 'Swamp',
              'mountains-you-control': 'Mountain',
              'plains-you-control': 'Plains',
              'wastes-you-control': 'Wastes'
            };
            if (basicMap[countCode]) {
              const landName = basicMap[countCode];
              return ownedBattlefield.filter((card) => new RegExp(`\b${landName}\b`, 'i').test(`${card?.card?.typeLine || ''} ${card?.card?.name || ''}`)).length;
            }
            if (countCode.startsWith('subtype:')) {
              const subtype = countCode.slice('subtype:'.length);
              return ownedBattlefield.filter((card) => creatureTypesFromCard(card.card || card).includes(subtype)).length;
            }
            return 1;
          };
          const count = Math.max(0, countByFormula());
          const symbol = produced[0] || 'ANY';
          produced = Array.from({ length: count }, () => symbol);
          formulaNote = `current ${ability.amountLabel || amountLabelFromFormula(ability.amountFormula, 'count')}: ${count}`;
        }
        const manaKey = [
          boardCard.boardId || boardCard.id || boardCard.card?.name || 'unknown-source',
          entryBase.requiresTap ? 'tap' : normalizedAbilityKeyText(entryBase.costText),
          compactManaLabel(produced),
          ability.amountFormula || '',
          normalizedAbilityKeyText(ability.manaRestriction || ''),
          ability.colorMode || ''
        ].join('|');
        if (seenManaKeys.has(manaKey)) continue;
        seenManaKeys.add(manaKey);

        manaSources.push({
          ...entryBase,
          type: 'mana',
          mana: produced,
          manaLabel: ability.producedManaLabel || compactManaLabel(produced),
          producedManaLabel: ability.producedManaLabel || compactManaLabel(produced),
          formulaNote,
          manaRestriction: ability.manaRestriction || '',
          manaRestrictionKind: ability.manaRestrictionKind || '',
          restrictedMana: Boolean(ability.restrictedMana || ability.manaRestriction),
          usable: usability.usable,
          reason: usability.reason
        });
      } else if (ability.costText) {
        activatedAbilities.push({ ...entryBase, type: 'activated', usable: !boardCard.tapped || !hasTapCost(ability), reason: boardCard.tapped && hasTapCost(ability) ? 'tapped' : '' });
      }
    }
  }

  const usableManaSources = manaSources.filter((source) => source.usable);
  const manaPool = usableManaSources.flatMap((source) => source.mana?.length ? source.mana : ['?']);
  const manaSummary = manaPool.length ? formatManaSymbols(manaPool) : '0';
  const log = ['AI checked battlefield:'];
  if (!manaSources.length) {
    log.push('- No recognized mana sources on the battlefield.');
  } else {
    manaSources.forEach((source) => {
      const canTapText = source.requiresTap ? `can tap for ${source.manaLabel}` : `can produce ${source.manaLabel}`;
      const formula = source.formulaNote ? ` (${source.formulaNote})` : '';
      const restriction = source.manaRestriction ? ` [restricted: ${source.manaRestriction}]` : '';
      log.push(`- ${source.sourceName} ${canTapText}${formula}${restriction}, ${source.usable ? 'usable' : `not usable because ${source.reason || 'unavailable'}`}`);
    });
  }
  log.push(`Total usable mana this turn: ${manaSummary}`);

  return {
    battlefieldCount: battlefield.length,
    activatedAbilities,
    manaSources,
    usableManaSources,
    totalUsableMana: manaPool.length,
    manaPool,
    summary: manaSummary,
    log
  };
}

function manaCostNeeds(cardOrCost = 0) {
  if (typeof cardOrCost === 'number') return { total: Math.max(0, Math.floor(cardOrCost)), colored: {}, generic: Math.max(0, Math.floor(cardOrCost)) };
  const card = cardOrCost || {};
  const costText = String(card.manaCost || '');
  const colored = {};
  let generic = 0;
  const symbols = costText.match(/\{[^}]+\}/g) || [];
  for (const symbolText of symbols) {
    const body = symbolText.replace(/[{}]/g, '').toUpperCase();
    if (/^\d+$/.test(body)) generic += Number(body);
    else if (/^[WUBRGC]$/.test(body)) colored[body] = (colored[body] || 0) + 1;
    else if (/^[WUBRG]\/[WUBRG]$/.test(body)) generic += 1;
    else if (body === 'X') generic += 0;
    else generic += 1;
  }
  const total = Math.max(Number(card.manaValue || 0), generic + Object.values(colored).reduce((sum, value) => sum + value, 0));
  return { total, colored, generic: Math.max(0, total - Object.values(colored).reduce((sum, value) => sum + value, 0)) };
}

function sourceCanPayColor(source, color) {
  const mana = source?.mana || [];
  return mana.includes(color) || mana.includes('ANY');
}

function restrictedManaCanPayFor(source, cardOrCost = 0) {
  const restriction = String(source?.manaRestriction || '').toLowerCase();
  if (!restriction) return true;
  const typeLine = typeof cardOrCost === 'object' ? String(cardOrCost?.typeLine || '') : '';
  const isCreatureSpell = /\bCreature\b/i.test(typeLine);
  const isCreatureAbility = typeof cardOrCost === 'object' && /\bCreature\b/i.test(String(cardOrCost?.abilitySourceType || cardOrCost?.sourceTypeLine || ''));
  if (/creature spells?/.test(restriction) && isCreatureSpell) return true;
  if (/activat(?:e|ed) abilities of creatures?/.test(restriction) && isCreatureAbility) return true;
  return false;
}

export function chooseAiManaSourcesForCost(inventory, cardOrCost = 0) {
  const needs = manaCostNeeds(cardOrCost);
  if (!needs.total) return [];
  const remaining = [...(inventory?.usableManaSources || [])]
    .filter((source) => restrictedManaCanPayFor(source, cardOrCost))
    .sort((a, b) => {
    const aCreature = /\bCreature\b/i.test(a.cardType || '') ? 1 : 0;
    const bCreature = /\bCreature\b/i.test(b.cardType || '') ? 1 : 0;
    const aFlexible = (a.mana || []).includes('ANY') ? 1 : 0;
    const bFlexible = (b.mana || []).includes('ANY') ? 1 : 0;
    return aCreature - bCreature || aFlexible - bFlexible;
  });
  const chosen = [];
  const takeSource = (source) => {
    const index = remaining.findIndex((item) => item.id === source.id);
    if (index >= 0) remaining.splice(index, 1);
    // A tapped permanent can only pay through one of its tap-cost mana abilities.
    // If the same land was recognized through multiple paths, or has multiple
    // alternate tap mana abilities, selecting one must make the rest unavailable
    // for this spell payment.
    if (source.requiresTap && source.boardId) {
      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        if (remaining[i]?.requiresTap && remaining[i]?.boardId === source.boardId) remaining.splice(i, 1);
      }
    }
    chosen.push(source);
  };
  for (const [color, amount] of Object.entries(needs.colored)) {
    for (let i = 0; i < amount; i += 1) {
      const source = remaining.find((item) => sourceCanPayColor(item, color));
      if (!source) return [];
      takeSource(source);
    }
  }
  while (chosen.length < needs.total) {
    const source = remaining.shift();
    if (!source) return [];
    chosen.push(source);
  }
  return chosen;
}

export function evaluateAiUsefulActions({ life = 40, hand = [], inventory = null } = {}) {
  const warnings = [];
  if (Number(life || 0) <= 1) warnings.push('Avoid costs that pay life at 1 life or less.');
  const availableMana = inventory?.totalUsableMana || 0;
  const castable = hand.filter((card) => !/\bLand\b/i.test(card?.typeLine || '') && Number(card?.manaValue || 0) <= availableMana);
  return {
    score: castable.length * 3 + availableMana,
    castableCount: castable.length,
    warnings
  };
}

export function forecastAiNextTurn({ hand = [], inventory = null } = {}) {
  const availableMana = inventory?.totalUsableMana || 0;
  const nextPlayable = hand
    .filter((card) => !/\bLand\b/i.test(card?.typeLine || ''))
    .map((card) => ({ cardName: card.name, manaValue: Number(card.manaValue || 0), playableNow: Number(card.manaValue || 0) <= availableMana }))
    .sort((a, b) => b.manaValue - a.manaValue);
  return { availableMana, nextPlayable, bestPlay: nextPlayable.find((item) => item.playableNow) || nextPlayable[0] || null };
}

function cardKeywords(boardCard) {
  return `${boardCard?.card?.oracleText || ''} ${(boardCard?.mods || []).map((mod) => mod.trait || '').join(' ')}`.toLowerCase();
}

export function canCreatureAttack(boardCard, { turn = 0 } = {}) {
  if (!/\bCreature\b/i.test(boardCard?.card?.typeLine || '')) return { legal: false, reason: 'not a creature' };
  if (boardCard?.tapped) return { legal: false, reason: 'tapped' };
  const text = cardKeywords(boardCard);
  if (/defender|can(?:not|'t) attack/.test(text)) return { legal: false, reason: 'card says it cannot attack / has defender' };
  if (/can only attack|attacks only if|can attack only/.test(text)) return { legal: 'warn', reason: 'conditional attack restriction detected' };
  if (!/haste/.test(text)) {
    const enteredTurn = Number(boardCard?.enteredTurn ?? boardCard?.controlledSinceTurn ?? -999999);
    if (Number.isFinite(enteredTurn) && enteredTurn >= Number(turn || 0)) return { legal: false, reason: 'summoning sick' };
    if (boardCard?.controlledSinceStartOfTurn === false) return { legal: false, reason: 'summoning sick' };
  }
  return { legal: true, reason: '' };
}

export function canCreatureBlock(blocker, attacker) {
  if (!/\bCreature\b/i.test(blocker?.card?.typeLine || '')) return { legal: false, reason: 'not a creature' };
  if (blocker?.tapped) return { legal: false, reason: 'tapped' };
  const blockerText = cardKeywords(blocker);
  const attackerText = cardKeywords(attacker);
  if (/can(?:not|'t) block/.test(blockerText)) return { legal: false, reason: 'card says it cannot block' };
  if (/flying/.test(attackerText) && !/flying|reach/.test(blockerText)) return { legal: false, reason: 'attacker has flying' };
  if (/menace/.test(attackerText)) return { legal: 'warn', reason: 'menace needs two blockers' };
  return { legal: true, reason: '' };
}

function combatPower(boardCard) {
  const baseSetters = (boardCard?.mods || []).filter((mod) => mod.kind === 'base_pt');
  const latestBase = baseSetters.length ? baseSetters[baseSetters.length - 1] : null;
  const raw = latestBase ? String(latestBase.basePower ?? '') : String(boardCard?.card?.power || '');
  const base = Number(raw.replace(/[^0-9.-]/g, ''));
  const mods = (boardCard?.mods || []).filter((mod) => mod.kind === 'pt' || mod.kind === 'counter').reduce((sum, mod) => sum + Number(mod.powerDelta || 0), 0);
  return Number.isFinite(base) ? base + mods : 0;
}

function combatToughness(boardCard) {
  const baseSetters = (boardCard?.mods || []).filter((mod) => mod.kind === 'base_pt');
  const latestBase = baseSetters.length ? baseSetters[baseSetters.length - 1] : null;
  const raw = latestBase ? String(latestBase.baseToughness ?? '') : String(boardCard?.card?.toughness || '');
  const base = Number(raw.replace(/[^0-9.-]/g, ''));
  const mods = (boardCard?.mods || []).filter((mod) => mod.kind === 'pt' || mod.kind === 'counter').reduce((sum, mod) => sum + Number(mod.toughnessDelta || 0), 0);
  return Number.isFinite(base) ? base + mods : 0;
}

export function chooseAiAttackers({ boardCards = [], seat, turn = 0, opponentLife = 40, inventory = null, hand = [] } = {}) {
  const forecast = forecastAiNextTurn({ hand, inventory });
  return boardCards
    .filter((card) => card.ownerSeat === seat && card.zone === 'creatures')
    .map((card) => {
      const legality = canCreatureAttack(card, { turn });
      const power = combatPower(card);
      const isManaDork = (inventory?.manaSources || []).some((source) => source.boardId === card.boardId);
      let score = power;
      const reasons = [];
      if (isManaDork && forecast.bestPlay && !forecast.bestPlay.playableNow) { score -= 2; reasons.push('may be useful as mana next turn'); }
      if (power <= 0) score -= 3;
      if (opponentLife <= power) { score += 12; reasons.push('possible lethal damage'); }
      return { boardId: card.boardId, cardName: card.card?.name || 'Creature', legal: legality.legal, reason: legality.reason, power, score, reasons };
    })
    .filter((item) => item.legal === true && item.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function chooseAiBlockers({ attackers = [], boardCards = [], seat } = {}) {
  const blockers = boardCards.filter((card) => card.ownerSeat === seat && card.zone === 'creatures' && !card.tapped);
  const assignments = [];
  const used = new Set();
  for (const attacker of attackers) {
    const candidates = blockers
      .filter((blocker) => !used.has(blocker.boardId))
      .map((blocker) => {
        const legality = canCreatureBlock(blocker, attacker);
        const attackerText = cardKeywords(attacker);
        const blockerText = cardKeywords(blocker);
        const attackerPower = combatPower(attacker);
        const attackerToughness = combatToughness(attacker);
        const blockerPower = combatPower(blocker);
        const blockerToughness = combatToughness(blocker);
        let score = 0;
        const badTrade = /deathtouch/.test(attackerText) && blockerToughness > 1;
        if (legality.legal === true) {
          if (blockerToughness > attackerPower) score += 3;
          if (blockerPower >= attackerToughness) score += 3;
          if (badTrade) score -= 10;
          if (/deathtouch/.test(blockerText)) score += 2;
          score -= Math.max(0, blockerPower - attackerPower) * 0.25;
        }
        return { blocker, legality, score };
      })
      .filter((item) => item.legality.legal === true && item.score > 1)
      .sort((a, b) => b.score - a.score);
    if (candidates[0]) {
      used.add(candidates[0].blocker.boardId);
      assignments.push({ attackerId: attacker.boardId, blockerId: candidates[0].blocker.boardId, reason: `Block ${attacker.card?.name || 'attacker'} with ${candidates[0].blocker.card?.name || 'blocker'}; score ${Math.round(candidates[0].score * 10) / 10}` });
    }
  }
  return assignments;
}

export function resetAiBrainCards(brain, target = 'all') {
  if (target === 'all') return saveAiBrain(defaultBrain());
  const nextCards = { ...(brain.cards || {}) };
  delete nextCards[target];
  return saveAiBrain({ ...brain, cards: nextCards, feedback: [...(brain.feedback || []), { cardKey: target, cardName: target, verdict: 'reset', note: 'Reset from dev console', at: Date.now() }] });
}


export function aiCardEntersTapped(card = {}) {
  return enteredTapped(card);
}
