import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import cardBackUrl from './assets/card-back.png';
import {
  DEFAULT_DEBUG_DECK,
  formatDeckImportDebugReportAll,
  formatDeckImportDebugReportPage,
  isLand,
  likelyZoneForCard,
  loadDeckFromText,
  shuffleCards
} from './lib/deck.js';
import {
  aiCardEntersTapped,
  buildAiAbilityInventory,
  buildAiCardPlan,
  canCreatureAttack,
  canCreatureBlock as canCreatureBlockForUi,
  chooseAiAttackers,
  chooseAiBlockers,
  chooseAiManaSourcesForCost,
  formatManaSymbols,
  getAiCardKey,
  getAiResponseProfile,
  loadAiBrain,
  recordAiFeedback,
  resetAiBrainCards,
  scoreAiCardForCast
} from './lib/aiBrain.js';
import {
  canonicalToView,
  createRealtimeRoom,
  getOrCreatePlayerId,
  relativeSeat,
  viewToCanonical
} from './lib/realtime.js';

const MODES = [
  { id: 'magic', name: 'Magic: The Gathering', active: true, blurb: 'Commander proxy table with Scryfall deck loading.' },
  { id: 'pokemon', name: 'Pokémon', active: false, blurb: 'Placeholder for a future Pokémon table.' },
  { id: 'yugioh', name: 'Yu-Gi-Oh!', active: false, blurb: 'Placeholder for a future dueling table.' },
  { id: 'cah', name: 'Cards Against Humanity', active: false, blurb: 'Placeholder for party-card nights.' }
];

const SEATS = [1, 2, 3, 4];
const ZONES = [
  { id: 'creatures', label: 'Battlefield / Creatures' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'enchantments', label: 'Enchantments' },
  { id: 'mana', label: 'Lands / Mana' }
];
const SIDE_ZONES = [
  { id: 'holding', label: 'Holding / Tokens' },
  { id: 'command', label: 'Command Zone' },
  { id: 'library', label: 'Library' },
  { id: 'exile', label: 'Exile' },
  { id: 'graveyard', label: 'Graveyard' }
];
const MANAGED_PILE_ZONES = ['graveyard', 'exile'];
const MANAGED_ZONE_IDS = ['graveyard', 'exile', 'library'];

const TABLE_SIZE = { width: 3600, height: 2600 };
const STARTING_LIFE = 40;
const STARTING_INFECT = 0;
const COMBAT_PHASES = ['main', 'combat-select', 'combat-blockers', 'combat-damage'];
const PLAYER_MATS = {
  0: { x: 0.22, y: 0.565, w: 0.56, h: 0.335 },
  1: { x: 0.815, y: 0.17, w: 0.145, h: 0.66 },
  2: { x: 0.22, y: 0.100, w: 0.56, h: 0.335 },
  3: { x: 0.040, y: 0.17, w: 0.145, h: 0.66 }
};
const ZONE_RECTS = {
  creatures: { x: 0.025, y: 0.035, w: 0.790, h: 0.370 },
  artifacts: { x: 0.025, y: 0.430, w: 0.385, h: 0.235 },
  enchantments: { x: 0.430, y: 0.430, w: 0.385, h: 0.235 },
  mana: { x: 0.025, y: 0.700, w: 0.790, h: 0.270 },
  graveyard: { x: 0.830, y: 0.055, w: 0.072, h: 0.190 },
  exile: { x: 0.830, y: 0.295, w: 0.072, h: 0.190 },
  library: { x: 0.830, y: 0.690, w: 0.072, h: 0.260 },
  command: { x: 0.915, y: 0.055, w: 0.070, h: 0.190 },
  holding: { x: 0.915, y: 0.295, w: 0.070, h: 0.655 }
};
const ALL_ZONES = [...ZONES, ...SIDE_ZONES];
const BOARD_CARD_NORM_WIDTH = 96 / TABLE_SIZE.width;
const BOARD_CARD_NORM_HEIGHT = (96 * 680 / 488) / TABLE_SIZE.height;
const KEYWORD_RE = /\b(deathtouch|defender|double strike|enchant|equip|first strike|flash|flying|haste|hexproof|indestructible|lifelink|menace|reach|trample|vigilance|ward|toxic|prowess|protection|skulk|fear|shroud|cascade|convoke|delve|riot|annihilator)\b/gi;
const AI_AUTO_APPROVE_CONFIDENCE = 90;
const AI_MISSING_REPORT_PAGE_SIZE = 5;


function scryfallImage(raw = {}) {
  if (raw.image_uris?.normal) return raw.image_uris.normal;
  if (raw.image_uris?.large) return raw.image_uris.large;
  if (raw.card_faces?.[0]?.image_uris?.normal) return raw.card_faces[0].image_uris.normal;
  if (raw.card_faces?.[0]?.image_uris?.large) return raw.card_faces[0].image_uris.large;
  return null;
}

function normalizeScryfallSearchCard(raw = {}) {
  const faces = raw.card_faces || [];
  const primaryFace = faces[0] || {};
  const combinedOracle = raw.oracle_text || faces.map((face) => [face.name, face.type_line, face.oracle_text].filter(Boolean).join('\n')).filter(Boolean).join('\n\n//\n\n');
  return {
    scryfallId: raw.id || `manual-${Date.now()}`,
    name: raw.name || primaryFace.name || 'Unknown Card',
    typeLine: raw.type_line || primaryFace.type_line || '',
    oracleText: combinedOracle || primaryFace.oracle_text || '',
    manaCost: raw.mana_cost || primaryFace.mana_cost || '',
    manaValue: Number(raw.cmc || 0),
    power: raw.power || primaryFace.power || '',
    toughness: raw.toughness || primaryFace.toughness || '',
    image: scryfallImage(raw),
    colors: raw.colors || raw.color_identity || [],
    raw: {
      rarity: raw.rarity,
      set: raw.set,
      collectorNumber: raw.collector_number,
      uri: raw.scryfall_uri,
      cardFaces: faces,
      layout: raw.layout
    }
  };
}

function quoteScryfallValue(value = '') {
  const cleaned = String(value || '').trim().replace(/"/g, '');
  if (!cleaned) return '';
  return /\s/.test(cleaned) ? `"${cleaned}"` : cleaned;
}


const ADD_CARD_COLOR_OPTIONS = [
  { id: 'W', label: 'White' },
  { id: 'U', label: 'Blue' },
  { id: 'B', label: 'Black' },
  { id: 'R', label: 'Red' },
  { id: 'G', label: 'Green' }
];

function buildScryfallColorClause(colors = [], mode = 'include') {
  const normalized = [...new Set((colors || []).map((color) => String(color || '').toUpperCase()).filter((color) => /^[WUBRG]$/.test(color)))];
  if (!normalized.length) return '';
  const colorCode = normalized.join('').toLowerCase();
  if (mode === 'exact') return `c:${colorCode}`;
  if (mode === 'only') return `c<=${colorCode}`;
  return `c>=${colorCode}`;
}

function buildScryfallAddSearchUrl({ query = '', typeFilter = 'all', colorFilter = [], colorMode = 'include', pageUrl = '' } = {}) {
  if (pageUrl) return pageUrl;
  const typed = String(query || '').trim();
  const clauses = [];
  const includeExtras = typeFilter === 'token';
  if (typed) {
    if (/[!:<>]=?|\boracle:|\btype:|\bt:|\bis:|\bname:|\bset:/i.test(typed)) clauses.push(typed);
    else clauses.push(`name:${quoteScryfallValue(typed)}`);
  }
  if (typeFilter && typeFilter !== 'all') {
    if (typeFilter === 'token') clauses.push('is:token');
    else clauses.push(`type:${typeFilter}`);
  }
  const colorClause = buildScryfallColorClause(colorFilter, colorMode);
  if (colorClause) clauses.push(colorClause);
  clauses.push('game:paper');
  const q = clauses.filter(Boolean).join(' ');
  const params = new URLSearchParams({ unique: 'cards', order: typed ? 'name' : 'released', q });
  if (includeExtras) params.set('include', 'extras');
  return `https://api.scryfall.com/cards/search?${params.toString()}`;
}

function hasUnparsedAiAbilities(plan = {}) {
  const abilities = plan?.abilities || [];
  return abilities.some((ability) => !(ability.actions || []).length);
}

function hasContestedAiMemory(plan = {}) {
  return Number(plan?.rejectedCount || 0) > 0 || Number(plan?.patternProfile?.contestedCount || 0) > 0;
}

function hasCleanHighConfidenceCurrentParse(plan = {}, threshold = AI_AUTO_APPROVE_CONFIDENCE) {
  return Boolean(
    plan?.confidence >= threshold &&
    (plan.actions || []).length > 0 &&
    !hasUnparsedAiAbilities(plan)
  );
}

function hasBlockingContestedAiMemory(plan = {}, threshold = AI_AUTO_APPROVE_CONFIDENCE) {
  // Rejections are useful when the parser is unsure, but they were becoming stale
  // blockers after later patches learned the wording family correctly. If the
  // current parse is clean and over the auto-approval threshold, let the new
  // high-confidence parse repair the old conflict instead of trapping the card
  // in manual review forever.
  return hasContestedAiMemory(plan) && !hasCleanHighConfidenceCurrentParse(plan, threshold);
}

function shouldAutoApproveAiPlan(plan = {}, threshold = AI_AUTO_APPROVE_CONFIDENCE) {
  return Boolean(
    hasCleanHighConfidenceCurrentParse(plan, threshold) &&
    !hasBlockingContestedAiMemory(plan, threshold)
  );
}

function autoApprovalBlockReason(plan = {}, threshold = AI_AUTO_APPROVE_CONFIDENCE) {
  if (!plan) return '';
  if ((plan?.confidence || 0) < threshold) return '';
  if (!(plan.actions || []).length) return 'Not auto-approved: no common action was detected.';
  if (hasUnparsedAiAbilities(plan)) return 'Not auto-approved: at least one ability still says “No common action recognized yet.”';
  if (hasBlockingContestedAiMemory(plan, threshold)) return 'Not auto-approved: this card or one of its learned action patterns has a rejection/conflict in memory.';
  return '';
}

function autoApprovalReason(plan = {}, threshold = AI_AUTO_APPROVE_CONFIDENCE) {
  return shouldAutoApproveAiPlan(plan, threshold)
    ? `Auto-approved at ${plan.confidence}% confidence.`
    : '';
}

function uniqueAiCardsForDeck(deck) {
  const seen = new Set();
  return [deck?.commander, ...(deck?.cards || [])].filter(Boolean).filter((card) => {
    const key = getAiCardKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function runSilentDeckAiPrecheck(deck, seat, options = {}) {
  let brain = options.brain || loadAiBrain();
  const cards = uniqueAiCardsForDeck(deck);
  const summary = { total: cards.length, autoApproved: 0, skippedKnown: 0, manualReview: 0, brain };
  for (const card of cards) {
    const plan = buildAiCardPlan(card, { seat, boardCards: [], library: deck?.cards || [], hand: [] }, brain);
    if (plan.learned && plan.approvedCount > 0) {
      summary.skippedKnown += 1;
      continue;
    }
    if (shouldAutoApproveAiPlan(plan, options.threshold || AI_AUTO_APPROVE_CONFIDENCE)) {
      brain = recordAiFeedback(brain, plan, 'approved', autoApprovalReason(plan), {
        responseWorthy: Boolean(plan.responseProfile?.responseWorthy),
        responseReason: plan.responseProfile?.responseWorthy ? `Silent deck-load precheck at ${plan.confidence}% confidence: ${(plan.responseProfile.reasons || []).join('; ')}` : '',
        autoApproved: true,
        autoConfidence: plan.confidence,
        silentPrecheck: true
      });
      summary.autoApproved += 1;
    } else {
      summary.manualReview += 1;
    }
  }
  summary.brain = brain;
  return summary;
}

const AI_AUTO_APPLY_ACTION_TYPES = new Set([
  'destroy',
  'exile',
  'draw',
  'create_token',
  'search_library',
  'add_counters',
  'grant_trait',
  'equip',
  'modify_pt',
  'set_base_pt',
  'add_mana'
]);
const AUTO_RESOLVE_ACTION_TYPES = new Set([
  'destroy', 'exile', 'draw', 'discard', 'mill', 'create_token', 'search_library',
  'add_counters', 'grant_trait', 'equip', 'modify_pt', 'set_base_pt', 'gain_life', 'lose_life',
  'set_life_total', 'direct_damage', 'return_to_hand', 'move_to_battlefield',
  'return_to_battlefield', 'return_from_graveyard_to_battlefield', 'put_from_hand_to_battlefield',
  'untap', 'tap', 'add_player_counters', 'attach_permanent', 'choose_color',
  'choose_creature_type', 'choose_card_type', 'choose_card_name', 'choose_and_grant_trait',
  'modal_choice_rule', 'transform', 'transform_source'
]);
const WATCHER_BATTLEFIELD_ZONES = new Set(['creatures', 'artifacts', 'enchantments', 'mana']);
const WATCHER_EVENT_KEEP = 120;
const DEFAULT_COLOR_CHOICES = ['White', 'Blue', 'Black', 'Red', 'Green'];
const DEFAULT_CARD_TYPE_CHOICES = ['Artifact', 'Creature', 'Enchantment', 'Instant', 'Land', 'Planeswalker', 'Sorcery'];
const COMMON_CREATURE_TYPE_CHOICES = ['Human', 'Wizard', 'Warrior', 'Soldier', 'Zombie', 'Elf', 'Goblin', 'Dragon', 'Wurm', 'Cat', 'Demon', 'Angel', 'Vampire', 'Merfolk', 'Knight', 'Rogue'];


let dice3DModulePromise = null;

function loadDice3D() {
  if (!dice3DModulePromise) {
    dice3DModulePromise = import('./modules/dice.roller.3d.js').then((mod) => mod.Dice3D || window.Dice3D);
  }
  return dice3DModulePromise;
}

function makeDiceSeed() {
  return ((Date.now() & 0xffffffff) ^ (Math.floor(Math.random() * 0x100000000) & 0xffffffff)) >>> 0;
}

function seededDieValue(seed, sides = 20) {
  let s = (Number(seed) >>> 0) || 1;
  s = (s * 1664525 + 1013904223) >>> 0;
  return 1 + Math.floor((s / 0x100000000) * sides);
}

function getDieSidesCount(die = 'd20') {
  switch (String(die).toLowerCase()) {
    case 'd4': return 4;
    case 'd6': return 6;
    case 'd8': return 8;
    case 'd10': return 10;
    case 'd12': return 12;
    case 'd20': return 20;
    case 'd100': return 100;
    default: return 20;
  }
}

function diceAnchorPointForSeat(seat) {
  const safeSeat = Number(seat);
  const isUsableRect = (rect) => Boolean(
    rect &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    rect.width > 2 &&
    rect.height > 2
  );

  const pickFirstRect = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const rect = el?.getBoundingClientRect?.();
      if (isUsableRect(rect)) return { el, rect };
    }
    return null;
  };

  // Target the visible commander image/back directly. The previous selector
  // could fall back to the center of the viewport when the card was above the
  // dice module's table-plane projection. This keeps the lobby initiative die
  // visually tied to the player column that actually rolled.
  const cardHit = pickFirstRect([
    `[data-dice-commander-seat="${safeSeat}"]`,
    `[data-dice-anchor-seat="${safeSeat}"] img`,
    `[data-dice-anchor-seat="${safeSeat}"] .card-back-mini`,
    `[data-seat-card="${safeSeat}"] img`,
    `[data-seat-card="${safeSeat}"] .card-back-mini`
  ]);

  if (cardHit) {
    const { rect } = cardHit;
    return {
      x: rect.left + rect.width * 0.5,
      y: Math.max(32, rect.top - Math.min(44, rect.height * 0.18))
    };
  }

  const seatHit = pickFirstRect([
    `[data-dice-anchor-seat="${safeSeat}"]`,
    `[data-seat-card="${safeSeat}"]`
  ]);

  if (seatHit) {
    const { rect } = seatHit;
    return {
      x: rect.left + rect.width * 0.5,
      y: rect.top + rect.height * 0.28
    };
  }

  return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.45 };
}

function hideDice3DOverlay() {
  const existing = typeof window !== 'undefined' ? window.Dice3D : null;
  try {
    existing?.hide?.({ clear: true });
  } catch (error) {
    console.warn('[Dice3D] hide failed', error);
  }
  if (dice3DModulePromise) {
    dice3DModulePromise
      .then((Dice3D) => Dice3D?.hide?.({ clear: true }))
      .catch((error) => console.warn('[Dice3D] async hide failed', error));
  }
}

function playDice3DRoll({ die = 'd20', seed = makeDiceSeed(), seat = null, targetClient = null, cinematic = true, persist = false } = {}) {
  return loadDice3D()
    .then((Dice3D) => {
      if (!Dice3D?.roll) return null;
      Dice3D.init?.();
      const resolvedTarget = targetClient || (seat ? diceAnchorPointForSeat(seat) : null);
      return Dice3D.roll(die, { seed, cinematic, targetClient: resolvedTarget, persist });
    })
    .catch((error) => {
      console.warn('[Dice3D] roll failed', error);
      return null;
    });
}

function isBattlefieldZone(zone) {
  return WATCHER_BATTLEFIELD_ZONES.has(zone);
}

function safeId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cardTypeText(card = {}) {
  return `${card?.name || ''} ${card?.typeLine || ''} ${card?.oracleText || ''}`;
}

function isTransientCard(card = {}) {
  return /\bInstant\b|\bSorcery\b/i.test(card?.typeLine || '');
}

function canAutoApplyAiAction(action, sourceBoardCard = null) {
  return Boolean(action && AI_AUTO_APPLY_ACTION_TYPES.has(action.type) && isActionUsable(action, sourceBoardCard));
}

function shouldAutoApplyAiReview(review = {}, threshold = AI_AUTO_APPROVE_CONFIDENCE) {
  const plan = review?.plan;
  const action = review?.selectedAction || (plan?.actions || []).find((item) => canAutoApplyAiAction(item, review?.boardCard));
  return Boolean(shouldAutoApproveAiPlan(plan, threshold) && canAutoApplyAiAction(action, review?.boardCard));
}

function buildAiMissingActionReport({ command = 'ai_missing', decks = [], brain = loadAiBrain() } = {}) {
  const report = {
    command,
    generatedAt: new Date().toLocaleString(),
    pageSize: AI_MISSING_REPORT_PAGE_SIZE,
    decks: [],
    totalCards: 0,
    totalUniqueCards: 0,
    missingAbilityCount: 0,
    scanErrorCount: 0,
    scanErrors: [],
    items: []
  };

  const seenBySeat = new Set();
  const globallyScannedCards = new Set();
  const missingItemByCardKey = new Map();
  const makeErrorText = (error) => error?.message || error?.name || String(error || 'Unknown error');

  function addScanErrorItem({ seat, card, error, stage = 'AI plan build' }) {
    const cardKey = `scan-error:${getAiCardKey(card) || card?.name || Math.random()}`;
    const existingMissingItem = missingItemByCardKey.get(cardKey);
    if (existingMissingItem) {
      existingMissingItem.seats = [...new Set([...(existingMissingItem.seats || []), seat])];
      return;
    }
    const errorText = makeErrorText(error);
    report.scanErrorCount += 1;
    report.missingAbilityCount += 1;
    report.scanErrors.push({ seat, cardName: card?.name || 'Unknown card', stage, error: errorText });
    const item = {
      seat,
      seats: [seat],
      scanError: true,
      scanErrorStage: stage,
      scanErrorText: errorText,
      cardName: card?.name || 'Unknown card',
      scryfallId: card?.scryfallId || card?.id || '',
      manaCost: card?.manaCost || '',
      manaValue: card?.manaValue ?? '',
      typeLine: card?.typeLine || '',
      oracleText: card?.oracleText || '',
      confidence: 0,
      baseConfidence: 0,
      learned: false,
      approvedCount: 0,
      rejectedCount: 0,
      confidenceReasons: [`AI scan crashed during ${stage}`],
      missingAbilities: [{
        sourceText: 'AI scan crashed before this card could be fully analyzed.',
        triggerText: '',
        costText: '',
        effectText: '',
        conditionText: '',
        optional: false,
        notes: [errorText]
      }],
      recognizedActions: []
    };
    missingItemByCardKey.set(cardKey, item);
    report.items.push(item);
  }

  for (const entry of decks) {
    const seat = Number(entry?.seat || 0);
    const deck = entry?.deck;
    if (!seat || !deck || seenBySeat.has(seat)) continue;
    seenBySeat.add(seat);
    let uniqueCards = [];
    try {
      uniqueCards = uniqueAiCardsForDeck(deck);
    } catch (error) {
      const errorText = makeErrorText(error);
      report.scanErrorCount += 1;
      report.scanErrors.push({ seat, cardName: deck.commanderName || 'Unknown deck', stage: 'unique deck card scan', error: errorText });
      uniqueCards = [];
    }
    report.decks.push({
      seat,
      commanderName: deck.commanderName || deck.commander?.name || '',
      totalCards: Number(deck.totalCards || deck.cards?.length || 0),
      uniqueCards: uniqueCards.length
    });
    report.totalCards += Number(deck.totalCards || deck.cards?.length || 0);

    for (const card of uniqueCards) {
      let cardKey = '';
      try {
        cardKey = getAiCardKey(card) || `${card?.name || 'unknown'}:${card?.scryfallId || card?.id || ''}`;
      } catch (error) {
        addScanErrorItem({ seat, card, error, stage: 'card identity key' });
        continue;
      }
      const existingMissingItem = missingItemByCardKey.get(cardKey);
      if (existingMissingItem) {
        existingMissingItem.seats = [...new Set([...(existingMissingItem.seats || []), seat])];
        continue;
      }
      if (globallyScannedCards.has(cardKey)) continue;
      globallyScannedCards.add(cardKey);
      report.totalUniqueCards += 1;

      let plan = null;
      try {
        plan = buildAiCardPlan(card, { seat, boardCards: [], library: deck.cards || [], hand: [] }, brain);
      } catch (error) {
        addScanErrorItem({ seat, card, error, stage: 'AI plan build' });
        continue;
      }
      const missingAbilities = (plan.abilities || []).filter((ability) => !(ability.actions || []).length);
      if (!missingAbilities.length) continue;
      report.missingAbilityCount += missingAbilities.length;
      const item = {
        seat,
        seats: [seat],
        cardName: card.name || plan.cardName || 'Unknown card',
        scryfallId: card.scryfallId || card.id || '',
        manaCost: card.manaCost || '',
        manaValue: card.manaValue ?? '',
        typeLine: card.typeLine || plan.typeLine || '',
        oracleText: plan.oracleText || card.oracleText || '',
        confidence: plan.confidence || 0,
        baseConfidence: plan.baseConfidence || 0,
        learned: Boolean(plan.learned),
        approvedCount: plan.approvedCount || 0,
        rejectedCount: plan.rejectedCount || 0,
        confidenceReasons: plan.confidenceReasons || [],
        missingAbilities: missingAbilities.map((ability) => ({
          sourceText: ability.sourceText || ability.effectText || '',
          triggerText: ability.triggerText || '',
          costText: ability.costText || '',
          effectText: ability.effectText || '',
          conditionText: ability.conditionText || '',
          optional: Boolean(ability.optional),
          notes: ability.notes || []
        })),
        recognizedActions: (plan.actions || []).slice(0, 12).map((action) => ({
          type: action.type || 'unknown',
          label: action.label || '',
          abilityText: action.abilityText || action.sourceText || action.effectText || '',
          costText: action.costText || '',
          effectText: action.effectText || ''
        }))
      };
      missingItemByCardKey.set(cardKey, item);
      report.items.push(item);
    }
  }

  return report;
}

function formatAiMissingReportPage(report = {}, pageIndex = 0) {
  const items = report.items || [];
  const pageSize = report.pageSize || AI_MISSING_REPORT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.max(0, Math.min(pageIndex, totalPages - 1));
  const start = safePage * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  const deckLine = (report.decks || []).length
    ? report.decks.map((deck) => `P${deck.seat}: ${deck.commanderName || 'Unknown commander'} (${deck.totalCards || 0} cards, ${deck.uniqueCards || 0} unique scanned)`).join('; ')
    : 'No loaded deck found.';
  const lines = [
    'AI MISSING COMMON ACTION REPORT',
    `Command: ${report.command || 'ai_missing'}`,
    `Generated: ${report.generatedAt || ''}`,
    `Decks scanned: ${deckLine}`,
    `Totals: ${report.totalCards || 0} card instances, ${report.totalUniqueCards || 0} unique card(s) scanned`,
    `Missing common-action / scan-problem cards: ${items.length}`,
    `Missing ability lines / scan errors: ${report.missingAbilityCount || 0}`,
    `AI scan errors: ${report.scanErrorCount || 0}`,
    `Page ${safePage + 1} of ${totalPages} — showing ${pageItems.length} card(s), max ${pageSize} per page`,
    ''
  ];

  if (!pageItems.length) {
    lines.push('No cards found with “No common action recognized yet.”');
  }

  pageItems.forEach((item, localIndex) => {
    const seatLabel = (item.seats || [item.seat]).filter(Boolean).map((seat) => `P${seat}`).join('/');
    lines.push(`===== ${start + localIndex + 1}. ${item.cardName} (${seatLabel || `P${item.seat}`}) =====`);
    lines.push(`Seen in: ${seatLabel || `P${item.seat}`}`);
    lines.push(`Scryfall ID: ${item.scryfallId || ''}`);
    lines.push(`Mana Cost: ${item.manaCost || ''}`);
    lines.push(`Mana Value: ${item.manaValue ?? ''}`);
    lines.push(`Type Line: ${item.typeLine || ''}`);
    lines.push(`AI Confidence: ${item.confidence || 0}% (base ${item.baseConfidence || 0}%)`);
    if (item.scanError) {
      lines.push(`AI scan status: ERROR during ${item.scanErrorStage || 'scan'} — ${item.scanErrorText || 'Unknown error'}`);
    }
    lines.push(`Learned already: ${item.learned ? `yes, approved ${item.approvedCount || 0} time(s)` : 'no'}`);
    if (item.rejectedCount) lines.push(`Rejected memory count: ${item.rejectedCount}`);
    if (item.confidenceReasons?.length) lines.push(`Confidence factors: ${item.confidenceReasons.join('; ')}`);
    lines.push('');
    lines.push('Full Oracle Text:');
    lines.push(item.oracleText || '(none)');
    lines.push('');
    lines.push(`Missing ability line(s) with no common action (${item.missingAbilities?.length || 0}):`);
    (item.missingAbilities || []).forEach((ability, abilityIndex) => {
      lines.push(`${abilityIndex + 1}. ${ability.sourceText || '(blank ability)'}`);
      if (ability.triggerText) lines.push(`   Trigger: ${ability.triggerText}`);
      if (ability.costText) lines.push(`   Cost: ${ability.costText}`);
      if (ability.conditionText) lines.push(`   Condition: ${ability.conditionText}`);
      if (ability.effectText && ability.effectText !== ability.sourceText) lines.push(`   Effect: ${ability.effectText}`);
      if (ability.optional) lines.push('   Optional: yes');
      if (ability.notes?.length) lines.push(`   Parser notes: ${ability.notes.join('; ')}`);
    });
    lines.push('');
    if (item.recognizedActions?.length) {
      lines.push('Other recognized action(s) on this card:');
      item.recognizedActions.forEach((action, actionIndex) => {
        lines.push(`${actionIndex + 1}. ${action.type} — ${action.label || '(no label)'}`);
        if (action.costText) lines.push(`   Cost: ${action.costText}`);
        if (action.effectText) lines.push(`   Effect: ${action.effectText}`);
        if (action.abilityText && action.abilityText !== action.effectText) lines.push(`   Ability line: ${action.abilityText}`);
      });
    } else {
      lines.push('Other recognized action(s) on this card: none');
    }
    lines.push('');
  });

  return lines.join('\n');
}

function formatAiMissingReportAll(report = {}) {
  const items = report.items || [];
  const pageSize = report.pageSize || AI_MISSING_REPORT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  return Array.from({ length: totalPages }).map((_, pageIndex) => formatAiMissingReportPage(report, pageIndex)).join('\n\n----- NEXT PAGE -----\n\n');
}


function percentFromAbilityScore(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return number <= 1 ? Math.round(number * 100) : Math.round(number);
}

function confidenceShortfall(plan = {}, threshold = AI_AUTO_APPROVE_CONFIDENCE) {
  return Math.max(0, Number(threshold || 0) - Number(plan?.confidence || 0));
}

function aiApprovalIssuesForPlan(plan = {}, threshold = AI_AUTO_APPROVE_CONFIDENCE) {
  const issues = [];
  const confidence = Number(plan?.confidence || 0);
  if (confidence < threshold) issues.push(`Confidence ${confidence}% is below the ${threshold}% auto-approval threshold (${confidenceShortfall(plan, threshold)} point(s) short).`);
  if (!(plan?.actions || []).length) issues.push('No common action templates were recognized on this card.');
  const missingAbilities = (plan?.abilities || []).filter((ability) => !(ability.actions || []).length);
  if (missingAbilities.length) issues.push(`${missingAbilities.length} ability line(s) still have no common action.`);
  if (hasBlockingContestedAiMemory(plan, threshold)) issues.push('AI memory has a rejected/conflicted pattern for this card or one of its action patterns.');
  if (plan?.baseConfidence != null && Number(plan.baseConfidence) < threshold) issues.push(`Base parser confidence is ${plan.baseConfidence}%, before learned-card or trusted-pattern boosts.`);
  const abilityScores = (plan?.abilities || []).map((ability) => percentFromAbilityScore(ability.confidence));
  const lowAbilityScores = abilityScores.filter((score) => score < threshold);
  if (lowAbilityScores.length) issues.push(`${lowAbilityScores.length}/${abilityScores.length || 0} parsed ability line(s) scored below ${threshold}%.`);
  const reasonText = (plan?.confidenceReasons || []).join('; ');
  if (/dynamic amount text not fully explained/i.test(reasonText)) issues.push('At least one dynamic amount still needs a stronger formula explanation.');
  if (/replacement-effect wording needs/i.test(reasonText)) issues.push('At least one replacement-effect sentence was recognized only generically, not as a specific replacement bucket.');
  if (/has a condition/i.test(reasonText)) issues.push('At least one condition requires board-state checking, so confidence is penalized.');
  if (/optional choice/i.test(reasonText)) issues.push('Optional / “may” / “up to” wording lowers certainty unless the action is very explicit.');
  return [...new Set(issues)].filter(Boolean);
}

function buildAiConfidenceReport({ command = 'ai_confidence', decks = [], brain = loadAiBrain(), threshold = AI_AUTO_APPROVE_CONFIDENCE } = {}) {
  const report = {
    command,
    generatedAt: new Date().toLocaleString(),
    pageSize: AI_MISSING_REPORT_PAGE_SIZE,
    threshold,
    decks: [],
    totalCards: 0,
    totalUniqueCards: 0,
    belowThresholdCount: 0,
    notAutoApprovedCount: 0,
    missingAbilityCount: 0,
    scanErrorCount: 0,
    scanErrors: [],
    items: []
  };

  const seenBySeat = new Set();
  const globallyScannedCards = new Set();
  const itemByCardKey = new Map();
  const makeErrorText = (error) => error?.message || error?.name || String(error || 'Unknown error');

  function addScanErrorItem({ seat, card, error, stage = 'AI plan build' }) {
    const cardKey = `confidence-scan-error:${getAiCardKey(card) || card?.name || Math.random()}`;
    const existing = itemByCardKey.get(cardKey);
    if (existing) {
      existing.seats = [...new Set([...(existing.seats || []), seat])];
      return;
    }
    const errorText = makeErrorText(error);
    report.scanErrorCount += 1;
    report.notAutoApprovedCount += 1;
    report.scanErrors.push({ seat, cardName: card?.name || 'Unknown card', stage, error: errorText });
    const item = {
      seat,
      seats: [seat],
      scanError: true,
      scanErrorStage: stage,
      scanErrorText: errorText,
      cardName: card?.name || 'Unknown card',
      scryfallId: card?.scryfallId || card?.id || '',
      manaCost: card?.manaCost || '',
      manaValue: card?.manaValue ?? '',
      typeLine: card?.typeLine || '',
      oracleText: card?.oracleText || '',
      confidence: 0,
      baseConfidence: 0,
      learned: false,
      approvedCount: 0,
      rejectedCount: 0,
      autoApproved: false,
      approvalIssues: [`AI scan crashed during ${stage}: ${errorText}`],
      confidenceReasons: [`AI scan crashed during ${stage}`],
      abilityDiagnostics: [],
      recognizedActions: []
    };
    itemByCardKey.set(cardKey, item);
    report.items.push(item);
  }

  for (const entry of decks) {
    const seat = Number(entry?.seat || 0);
    const deck = entry?.deck;
    if (!seat || !deck || seenBySeat.has(seat)) continue;
    seenBySeat.add(seat);
    let uniqueCards = [];
    try {
      uniqueCards = uniqueAiCardsForDeck(deck);
    } catch (error) {
      const errorText = makeErrorText(error);
      report.scanErrorCount += 1;
      report.scanErrors.push({ seat, cardName: deck.commanderName || 'Unknown deck', stage: 'unique deck card scan', error: errorText });
      uniqueCards = [];
    }
    report.decks.push({
      seat,
      commanderName: deck.commanderName || deck.commander?.name || '',
      totalCards: Number(deck.totalCards || deck.cards?.length || 0),
      uniqueCards: uniqueCards.length
    });
    report.totalCards += Number(deck.totalCards || deck.cards?.length || 0);

    for (const card of uniqueCards) {
      let cardKey = '';
      try {
        cardKey = getAiCardKey(card) || `${card?.name || 'unknown'}:${card?.scryfallId || card?.id || ''}`;
      } catch (error) {
        addScanErrorItem({ seat, card, error, stage: 'card identity key' });
        continue;
      }
      const existing = itemByCardKey.get(cardKey);
      if (existing) {
        existing.seats = [...new Set([...(existing.seats || []), seat])];
        continue;
      }
      if (globallyScannedCards.has(cardKey)) continue;
      globallyScannedCards.add(cardKey);
      report.totalUniqueCards += 1;

      let plan = null;
      try {
        plan = buildAiCardPlan(card, { seat, boardCards: [], library: deck.cards || [], hand: [] }, brain);
      } catch (error) {
        addScanErrorItem({ seat, card, error, stage: 'AI plan build' });
        continue;
      }

      const autoApproved = shouldAutoApproveAiPlan(plan, threshold);
      const belowThreshold = Number(plan?.confidence || 0) < threshold;
      const approvalIssues = aiApprovalIssuesForPlan(plan, threshold);
      if (autoApproved) continue;

      report.notAutoApprovedCount += 1;
      if (belowThreshold) report.belowThresholdCount += 1;
      const missingAbilities = (plan.abilities || []).filter((ability) => !(ability.actions || []).length);
      report.missingAbilityCount += missingAbilities.length;

      const item = {
        seat,
        seats: [seat],
        cardName: card.name || plan.cardName || 'Unknown card',
        scryfallId: card.scryfallId || card.id || '',
        manaCost: card.manaCost || '',
        manaValue: card.manaValue ?? '',
        typeLine: card.typeLine || plan.typeLine || '',
        oracleText: plan.oracleText || card.oracleText || '',
        confidence: plan.confidence || 0,
        baseConfidence: plan.baseConfidence || 0,
        threshold,
        learned: Boolean(plan.learned),
        learnedFromLegacyKey: Boolean(plan.learnedFromLegacyKey),
        approvedCount: plan.approvedCount || 0,
        rejectedCount: plan.rejectedCount || 0,
        autoApproved,
        approvalIssues,
        confidenceReasons: plan.confidenceReasons || [],
        patternReasons: plan.patternProfile?.reasons || [],
        patternConfidenceBoost: plan.patternProfile?.confidenceBoost || 0,
        missingAbilityCount: missingAbilities.length,
        abilityDiagnostics: (plan.abilities || []).map((ability) => ({
          sourceText: ability.sourceText || ability.effectText || '',
          confidence: percentFromAbilityScore(ability.confidence),
          triggerText: ability.triggerText || '',
          costText: ability.costText || '',
          conditionText: ability.conditionText || '',
          effectText: ability.effectText || '',
          optional: Boolean(ability.optional),
          confidenceReasons: ability.confidenceReasons || [],
          notes: ability.notes || [],
          actions: (ability.actions || []).slice(0, 8).map((action) => ({ type: action.type || 'unknown', label: action.label || '', costText: action.costText || '', effectText: action.effectText || '' }))
        })),
        recognizedActions: (plan.actions || []).slice(0, 16).map((action) => ({
          type: action.type || 'unknown',
          label: action.label || '',
          abilityText: action.abilityText || action.sourceText || action.effectText || '',
          costText: action.costText || '',
          effectText: action.effectText || ''
        }))
      };
      itemByCardKey.set(cardKey, item);
      report.items.push(item);
    }
  }

  report.items.sort((a, b) => {
    if (a.scanError && !b.scanError) return -1;
    if (!a.scanError && b.scanError) return 1;
    if ((a.confidence || 0) !== (b.confidence || 0)) return (a.confidence || 0) - (b.confidence || 0);
    return String(a.cardName || '').localeCompare(String(b.cardName || ''));
  });
  return report;
}

function formatAiConfidenceReportPage(report = {}, pageIndex = 0) {
  const items = report.items || [];
  const pageSize = report.pageSize || AI_MISSING_REPORT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.max(0, Math.min(pageIndex, totalPages - 1));
  const start = safePage * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  const threshold = report.threshold || AI_AUTO_APPROVE_CONFIDENCE;
  const deckLine = (report.decks || []).length
    ? report.decks.map((deck) => `P${deck.seat}: ${deck.commanderName || 'Unknown commander'} (${deck.totalCards || 0} cards, ${deck.uniqueCards || 0} unique scanned)`).join('; ')
    : 'No loaded deck found.';
  const lines = [
    'AI CONFIDENCE / AUTO-APPROVAL REPORT',
    `Command: ${report.command || 'ai_confidence'}`,
    `Generated: ${report.generatedAt || ''}`,
    `Auto-approval threshold: ${threshold}%`,
    `Decks scanned: ${deckLine}`,
    `Totals: ${report.totalCards || 0} card instances, ${report.totalUniqueCards || 0} unique card(s) scanned`,
    `Cards below ${threshold}% confidence: ${report.belowThresholdCount || 0}`,
    `Cards not auto-approved / scan-problem cards: ${items.length}`,
    `Missing common-action lines among these cards: ${report.missingAbilityCount || 0}`,
    `AI scan errors: ${report.scanErrorCount || 0}`,
    `Page ${safePage + 1} of ${totalPages} — showing ${pageItems.length} card(s), max ${pageSize} per page`,
    ''
  ];

  if (!pageItems.length) lines.push(`Every scanned card met the ${threshold}% auto-approval standard.`);

  pageItems.forEach((item, localIndex) => {
    const seatLabel = (item.seats || [item.seat]).filter(Boolean).map((seat) => `P${seat}`).join('/');
    lines.push(`===== ${start + localIndex + 1}. ${item.cardName} (${seatLabel || `P${item.seat}`}) =====`);
    lines.push(`Seen in: ${seatLabel || `P${item.seat}`}`);
    lines.push(`Scryfall ID: ${item.scryfallId || ''}`);
    lines.push(`Mana Cost: ${item.manaCost || ''}`);
    lines.push(`Mana Value: ${item.manaValue ?? ''}`);
    lines.push(`Type Line: ${item.typeLine || ''}`);
    lines.push(`AI Confidence: ${item.confidence || 0}% (base ${item.baseConfidence || 0}%; threshold ${threshold}%)`);
    if (item.scanError) lines.push(`AI scan status: ERROR during ${item.scanErrorStage || 'scan'} — ${item.scanErrorText || 'Unknown error'}`);
    lines.push(`Auto-approved by silent precheck: ${item.autoApproved ? 'yes' : 'no'}`);
    lines.push(`Learned already: ${item.learned ? `yes, approved ${item.approvedCount || 0} time(s)` : 'no'}`);
    if (item.learnedFromLegacyKey) lines.push('Learned from legacy card key: yes');
    if (item.rejectedCount) lines.push(`Rejected memory count: ${item.rejectedCount}`);
    if (item.patternConfidenceBoost) lines.push(`Trusted-pattern boost: +${Math.round(Number(item.patternConfidenceBoost || 0) * 100)} point(s)`);
    lines.push('');
    lines.push('Why this card did not hit auto-approval:');
    const approvalIssues = item.approvalIssues?.length ? item.approvalIssues : ['No blocker reason was recorded.'];
    approvalIssues.forEach((issue, issueIndex) => lines.push(`${issueIndex + 1}. ${issue}`));
    if (item.confidenceReasons?.length) lines.push(`Confidence factors: ${item.confidenceReasons.join('; ')}`);
    lines.push('');
    lines.push('Full Oracle Text:');
    lines.push(item.oracleText || '(none)');
    lines.push('');
    lines.push(`Parsed ability confidence breakdown (${item.abilityDiagnostics?.length || 0}):`);
    (item.abilityDiagnostics || []).forEach((ability, abilityIndex) => {
      lines.push(`${abilityIndex + 1}. ${ability.confidence}% — ${ability.sourceText || '(blank ability)'}`);
      if (ability.triggerText) lines.push(`   Trigger: ${ability.triggerText}`);
      if (ability.costText) lines.push(`   Cost: ${ability.costText}`);
      if (ability.conditionText) lines.push(`   Condition: ${ability.conditionText}`);
      if (ability.effectText && ability.effectText !== ability.sourceText) lines.push(`   Effect: ${ability.effectText}`);
      if (ability.optional) lines.push('   Optional: yes');
      if (ability.confidenceReasons?.length) lines.push(`   Ability confidence factors: ${ability.confidenceReasons.join('; ')}`);
      if (ability.notes?.length) lines.push(`   Parser notes: ${ability.notes.join('; ')}`);
      if (ability.actions?.length) {
        lines.push(`   Recognized action(s) from this ability: ${ability.actions.length}`);
        ability.actions.forEach((action, actionIndex) => {
          lines.push(`      ${actionIndex + 1}. ${action.type} — ${action.label || '(no label)'}`);
          if (action.costText) lines.push(`         Cost: ${action.costText}`);
          if (action.effectText) lines.push(`         Effect: ${action.effectText}`);
        });
      } else {
        lines.push('   Recognized action(s) from this ability: none');
      }
    });
    lines.push('');
    if (item.recognizedActions?.length) {
      lines.push('All recognized action(s) on this card:');
      item.recognizedActions.forEach((action, actionIndex) => {
        lines.push(`${actionIndex + 1}. ${action.type} — ${action.label || '(no label)'}`);
        if (action.costText) lines.push(`   Cost: ${action.costText}`);
        if (action.effectText) lines.push(`   Effect: ${action.effectText}`);
        if (action.abilityText && action.abilityText !== action.effectText) lines.push(`   Ability line: ${action.abilityText}`);
      });
    } else {
      lines.push('All recognized action(s) on this card: none');
    }
    lines.push('');
  });

  return lines.join('\n');
}

function formatAiConfidenceReportAll(report = {}) {
  const items = report.items || [];
  const pageSize = report.pageSize || AI_MISSING_REPORT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  return Array.from({ length: totalPages }).map((_, pageIndex) => formatAiConfidenceReportPage(report, pageIndex)).join('\n\n----- NEXT PAGE -----\n\n');
}

function hasPrintedStat(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function numericStat(value) {
  if (!hasPrintedStat(value)) return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function cardBaseTraits(card) {
  const traits = [];
  const typeLine = card?.typeLine || '';
  typeLine.split(/[—-]/).join(' ').split(/\s+/).forEach((part) => {
    const cleaned = part.trim();
    if (cleaned && !['Basic', 'Legendary', 'Token'].includes(cleaned) && /^[A-Z]/.test(cleaned)) traits.push(cleaned);
  });
  const seen = new Set(traits.map((item) => item.toLowerCase()));
  for (const match of String(card?.oracleText || '').matchAll(KEYWORD_RE)) {
    const label = match[1].replace(/\b\w/g, (char) => char.toUpperCase());
    if (!seen.has(label.toLowerCase())) {
      seen.add(label.toLowerCase());
      traits.push(label);
    }
  }
  return traits.slice(0, 18);
}

function cardFaces(card = {}) {
  return Array.isArray(card?.raw?.cardFaces) ? card.raw.cardFaces.filter(Boolean) : [];
}

function cardHasAlternateFaces(card = {}) {
  return cardFaces(card).length > 1;
}

function faceImage(face = {}) {
  return face?.image_uris?.normal || face?.image_uris?.large || face?.image_uris?.png || null;
}

function activeFaceIndexForBoardCard(boardCard = {}) {
  const faces = cardFaces(boardCard?.card);
  if (faces.length < 2) return 0;
  const index = Number(boardCard?.activeFaceIndex || 0);
  return Math.max(0, Math.min(faces.length - 1, Number.isFinite(index) ? index : 0));
}

function cardForFace(rootCard = {}, faceIndex = 0) {
  const faces = cardFaces(rootCard);
  if (faces.length < 2) return rootCard;
  const safeIndex = Math.max(0, Math.min(faces.length - 1, Number(faceIndex) || 0));
  const face = faces[safeIndex] || faces[0] || {};
  return {
    ...rootCard,
    name: face.name || rootCard.name,
    typeLine: face.type_line || rootCard.typeLine || '',
    oracleText: face.oracle_text || '',
    manaCost: face.mana_cost || '',
    power: face.power || '',
    toughness: face.toughness || '',
    image: faceImage(face) || rootCard.image,
    colors: face.colors || rootCard.colors || [],
    activeFaceIndex: safeIndex,
    fullCardName: rootCard.name,
    raw: { ...(rootCard.raw || {}), cardFaces: faces, activeFaceIndex: safeIndex, fullCardName: rootCard.name }
  };
}

function getActiveCardForBoard(boardCard = {}) {
  if (!boardCard?.card || !cardHasAlternateFaces(boardCard.card)) return boardCard?.card;
  return cardForFace(boardCard.card, activeFaceIndexForBoardCard(boardCard));
}

function withActiveFaceCard(boardCard = {}) {
  if (!boardCard?.card || !cardHasAlternateFaces(boardCard.card)) return boardCard;
  return { ...boardCard, card: getActiveCardForBoard(boardCard) };
}

function activeBoardCards(cards = []) {
  return (cards || []).map((card) => withActiveFaceCard(card));
}

function boardCardTypeLine(boardCard = {}) {
  return getActiveCardForBoard(boardCard)?.typeLine || boardCard?.card?.typeLine || '';
}

function isEquipmentBoardCard(boardCard = {}) {
  return /\bEquipment\b/i.test(boardCardTypeLine(boardCard));
}

function isAuraBoardCard(boardCard = {}) {
  return /\bAura\b/i.test(boardCardTypeLine(boardCard));
}

function isAttachableBoardCard(boardCard = {}) {
  return isEquipmentBoardCard(boardCard) || isAuraBoardCard(boardCard);
}

function isCreatureBoardCard(boardCard = {}) {
  return /\bCreature\b/i.test(boardCardTypeLine(boardCard));
}

function creatureSubtypesFromBoardCard(boardCard = {}) {
  const afterDash = String(boardCardTypeLine(boardCard)).split(/[—-]/)[1] || '';
  return afterDash
    .split(/\s+/)
    .map((type) => type.replace(/[^A-Za-z-]/g, '').trim())
    .filter((type) => type && !/^(?:Token|Legendary|Basic|Artifact|Creature|Enchantment|Land|Instant|Sorcery|Planeswalker)$/i.test(type));
}

function activeModLabel(mod) {
  if (!mod) return '';
  if (mod.duration === 'eot') return ' (EOT)';
  if (mod.duration === 'linked') return ' (Linked)';
  return '';
}

function getCardStats(boardCard) {
  const activeCard = getActiveCardForBoard(boardCard);
  const rawPower = activeCard?.power;
  const rawToughness = activeCard?.toughness;
  const printedPower = hasPrintedStat(rawPower);
  const printedToughness = hasPrintedStat(rawToughness);
  const baseSetters = (boardCard?.mods || []).filter((mod) => mod.kind === 'base_pt');
  const latestBase = baseSetters.length ? baseSetters[baseSetters.length - 1] : null;
  const hasPrintedStats = printedPower || printedToughness || Boolean(latestBase);
  const basePower = latestBase ? Number(latestBase.basePower) : numericStat(rawPower);
  const baseToughness = latestBase ? Number(latestBase.baseToughness) : numericStat(rawToughness);
  const ptMods = (boardCard?.mods || []).filter((mod) => mod.kind === 'pt' || mod.kind === 'counter');
  const powerDelta = ptMods.reduce((sum, mod) => sum + Number(mod.powerDelta || 0), 0);
  const toughnessDelta = ptMods.reduce((sum, mod) => sum + Number(mod.toughnessDelta || 0), 0);
  const hasStats = hasPrintedStats || ptMods.length > 0;
  const displayBasePower = latestBase ? latestBase.basePower : rawPower;
  const displayBaseToughness = latestBase ? latestBase.baseToughness : rawToughness;
  const power = hasPrintedStats
    ? (basePower == null || Number.isNaN(basePower) ? displayBasePower : basePower + powerDelta)
    : (ptMods.length ? powerDelta : '');
  const toughness = hasPrintedStats
    ? (baseToughness == null || Number.isNaN(baseToughness) ? displayBaseToughness : baseToughness + toughnessDelta)
    : (ptMods.length ? toughnessDelta : '');
  const delta = powerDelta + toughnessDelta;
  return { hasStats, basePower, baseToughness, powerDelta, toughnessDelta, power, toughness, tone: delta > 0 ? 'buffed' : delta < 0 ? 'debuffed' : 'normal' };
}

function getCardTraits(boardCard) {
  const base = cardBaseTraits(getActiveCardForBoard(boardCard));
  const extras = (boardCard?.mods || []).filter((mod) => (mod.kind === 'trait' || mod.kind === 'choice') && mod.trait).map((mod) => `${mod.trait}${activeModLabel(mod)}`);
  const seen = new Set();
  return [...base, ...extras].filter((trait) => {
    const key = String(trait).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createLobbyState({ mode, lobbyName, hostPlayer }) {
  const players = Object.fromEntries(SEATS.map((seat) => [seat, null]));
  players[1] = hostPlayer;
  return {
    id: crypto.randomUUID(),
    mode,
    lobbyName,
    hostId: hostPlayer.id,
    players,
    tableMode: 'free-for-all',
    startingSeat: null,
    createdAt: Date.now(),
    started: false
  };
}

function firstOpenSeat(players, requestedSeat) {
  const start = Math.max(1, Math.min(4, Number(requestedSeat) || 2));
  for (let seat = start; seat <= 4; seat += 1) if (!players[seat]) return seat;
  for (let seat = 1; seat < start; seat += 1) if (!players[seat]) return seat;
  return null;
}

function compactPlayer(player) {
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    team: player.team,
    ready: player.ready,
    commanderName: player.commanderName,
    commanderImage: player.commanderImage,
    deckCount: player.deckCount,
    initiativeRoll: player.initiativeRoll || null,
    initiativeSeed: player.initiativeSeed || null,
    initiativeRolledAt: player.initiativeRolledAt || null
  };
}

function compareInitiativePlayers(a, b) {
  const rollDiff = Number(b?.initiativeRoll || 0) - Number(a?.initiativeRoll || 0);
  if (rollDiff) return rollDiff;
  const aAt = Number(a?.initiativeRolledAt || 0);
  const bAt = Number(b?.initiativeRolledAt || 0);
  if (aAt && bAt && aAt !== bAt) return aAt - bAt;
  return Number(a?.seat || 0) - Number(b?.seat || 0);
}

function getInitiativeEntries(players = {}) {
  return Object.values(players || {})
    .filter(Boolean)
    .filter((player) => Number(player.initiativeRoll || 0) > 0)
    .sort(compareInitiativePlayers);
}

function getInitiativeLeader(players = {}) {
  return getInitiativeEntries(players)[0] || null;
}

function getStartingSeatFromInitiative(players = {}) {
  const initiativeLeader = getInitiativeLeader(players);
  if (initiativeLeader?.seat) return Number(initiativeLeader.seat);
  return Object.values(players || {})
    .filter(Boolean)
    .sort((a, b) => Number(a?.seat || 0) - Number(b?.seat || 0))[0]?.seat || 1;
}

function turnStartPhaseLabel(seat) {
  return `P${Number(seat) || 1} Main Phase 1`;
}

function App() {
  const playerId = useMemo(() => getOrCreatePlayerId(), []);
  const [screen, setScreen] = useState('title');
  const [mode, setMode] = useState('magic');
  const [lobbyName, setLobbyName] = useState('debug-table');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('fct-display-name') || `Player ${Math.floor(Math.random() * 900 + 100)}`);
  const [requestedSeat, setRequestedSeat] = useState(2);
  const [isHost, setIsHost] = useState(false);
  const [localSeat, setLocalSeat] = useState(null);
  const [lobbyState, setLobbyState] = useState(null);
  const [status, setStatus] = useState('not connected');
  const [notice, setNotice] = useState('');
  const [deckText, setDeckText] = useState(DEFAULT_DEBUG_DECK);
  const [deckLoading, setDeckLoading] = useState(false);
  const [deckLoadingSeat, setDeckLoadingSeat] = useState(null);
  const [deckInfo, setDeckInfo] = useState(null);
  const [deckInfoBySeat, setDeckInfoBySeat] = useState({});
  const [deckTextBySeat, setDeckTextBySeat] = useState(() => Object.fromEntries(SEATS.map((seat) => [seat, DEFAULT_DEBUG_DECK])));
  const [gameEvents, setGameEvents] = useState([]);
  const roomRef = useRef(null);
  const stateRef = useRef({});

  useEffect(() => {
    stateRef.current = { isHost, lobbyState, playerId, localSeat };
  }, [isHost, lobbyState, playerId, localSeat]);

  useEffect(() => () => roomRef.current?.close(), []);

  function updateHostLobby(updater) {
    setLobbyState((current) => {
      if (!current) return current;
      const next = typeof updater === 'function' ? updater(current) : updater;
      roomRef.current?.send('lobby_state', { state: next });
      return next;
    });
  }

  function handleRoomMessage(envelope) {
    const { type, payload } = envelope;
    const current = stateRef.current;

    if (type === 'join_request' && current.isHost && current.lobbyState) {
      updateHostLobby((lobby) => {
        const seat = firstOpenSeat(lobby.players, payload.requestedSeat);
        if (!seat) {
          roomRef.current?.send('join_rejected', { targetId: payload.playerId, reason: 'Sorry, this lobby is full.' });
          return lobby;
        }
        const player = {
          id: payload.playerId,
          name: payload.name || `Player ${seat}`,
          seat,
          team: seat === 1 || seat === 3 ? 'A' : 'B',
          ready: false,
          commanderName: null,
          commanderImage: null,
          deckCount: 0
        };
        const next = { ...lobby, players: { ...lobby.players, [seat]: player } };
        roomRef.current?.send('join_accepted', { targetId: payload.playerId, seat, state: next });
        return next;
      });
    }

    if (type === 'join_accepted' && payload.targetId === playerId) {
      setLocalSeat(payload.seat);
      setLobbyState(payload.state);
      setScreen('lobby');
      setNotice(`Joined as Player ${payload.seat}.`);
    }

    if (type === 'join_rejected' && payload.targetId === playerId) {
      setNotice(payload.reason || 'Join rejected.');
    }

    if (type === 'lobby_state' && !current.isHost) {
      setLobbyState(payload.state);
    }

    if (type === 'player_update' && current.isHost && current.lobbyState) {
      updateHostLobby((lobby) => {
        const targetSeat = Number(payload.seat);
        const existing = lobby.players[targetSeat];
        if (!existing || existing.id !== payload.playerId) return lobby;
        const incomingPatch = { ...(payload.patch || {}) };
        // Initiative is one-roll-only. Once the host has recorded a player's
        // first ready-up roll, later unready/ready clicks cannot replace it.
        if (existing.initiativeRoll && incomingPatch.initiativeRoll) {
          delete incomingPatch.initiativeRoll;
          delete incomingPatch.initiativeSeed;
          delete incomingPatch.initiativeRolledAt;
        }
        const nextPlayer = { ...existing, ...incomingPatch };
        return { ...lobby, players: { ...lobby.players, [targetSeat]: nextPlayer } };
      });
    }

    if (type === 'lobby_settings' && current.isHost && current.lobbyState) {
      updateHostLobby((lobby) => ({ ...lobby, ...payload.patch }));
    }

    if (type === 'start_game') {
      hideDice3DOverlay();
      setLobbyState(payload.state);
      setGameEvents([]);
      setScreen('game');
    }

    if (type === 'lobby_dice_roll') {
      const seat = Number(payload.seat);
      if (seat) playDice3DRoll({ die: payload.die || 'd20', seed: payload.seed, seat, cinematic: true, persist: true });
    }

    if (type === 'game_event') {
      setGameEvents((events) => [...events.slice(-300), payload]);
    }
  }

  function connectRoom(nextMode, nextLobbyName) {
    roomRef.current?.close();
    const room = createRealtimeRoom(`lobby:${nextMode}:${nextLobbyName}`, playerId, handleRoomMessage, setStatus);
    roomRef.current = room;
    return room;
  }

  function hostLobby(event) {
    event.preventDefault();
    localStorage.setItem('fct-display-name', displayName);
    const hostPlayer = {
      id: playerId,
      name: displayName || 'Host',
      seat: 1,
      team: 'A',
      ready: false,
      commanderName: null,
      commanderImage: null,
      deckCount: 0
    };
    setIsHost(true);
    setLocalSeat(1);
    const nextLobby = createLobbyState({ mode, lobbyName: lobbyName.trim() || 'debug-table', hostPlayer });
    setLobbyState(nextLobby);
    connectRoom(mode, nextLobby.lobbyName);
    setScreen('lobby');
    setNotice('Lobby hosted. You are Player 1.');
  }

  function joinLobby(event) {
    event.preventDefault();
    localStorage.setItem('fct-display-name', displayName);
    setIsHost(false);
    setLocalSeat(null);
    const room = connectRoom(mode, lobbyName.trim() || 'debug-table');
    setScreen('joining');
    setNotice('Sending join request...');
    const joinPayload = { playerId, name: displayName || 'Guest', requestedSeat };
    setTimeout(() => room.send('join_request', joinPayload), 250);
    setTimeout(() => room.send('join_request', joinPayload), 1250);
  }

  function setDeckTextForSeat(seat, value) {
    const safeSeat = Number(seat || localSeat || 1);
    setDeckTextBySeat((current) => ({ ...current, [safeSeat]: value }));
    if (safeSeat === localSeat) setDeckText(value);
  }

  async function loadDeckForPlayer(seatOverride = localSeat, textOverride = null) {
    const targetSeat = Number(seatOverride || localSeat);
    const targetText = textOverride ?? deckTextBySeat[targetSeat] ?? deckText;
    setDeckLoading(true);
    setDeckLoadingSeat(targetSeat);
    setNotice(`Loading Player ${targetSeat}'s deck through Scryfall batch collection lookup...`);
    try {
      const result = await loadDeckFromText(targetText);
      setDeckInfoBySeat((current) => ({ ...current, [targetSeat]: result }));
      if (targetSeat === localSeat) setDeckInfo(result);
      const patch = {
        ready: false,
        deckLoading: false,
        commanderName: result.commanderName,
        commanderImage: result.commander?.image || null,
        deckCount: result.totalCards
      };
      if (isHost) {
        updateHostLobby((lobby) => ({ ...lobby, players: { ...lobby.players, [targetSeat]: { ...lobby.players[targetSeat], ...patch } } }));
      } else if (targetSeat === localSeat) {
        roomRef.current?.send('player_update', { playerId, seat: localSeat, patch });
      }

      let precheck = { autoApproved: 0, skippedKnown: 0, manualReview: 0, failed: false, error: '' };
      try {
        precheck = runSilentDeckAiPrecheck(result, targetSeat);
      } catch (precheckError) {
        console.warn('Silent deck-load AI precheck failed after deck was loaded:', precheckError);
        precheck = {
          autoApproved: 0,
          skippedKnown: 0,
          manualReview: 0,
          failed: true,
          error: precheckError?.message || String(precheckError)
        };
      }

      const aiPrecheckText = precheck.failed
        ? ` AI precheck failed after load, so the deck stayed loaded but auto-learning was skipped: ${precheck.error}`
        : (precheck.autoApproved || precheck.skippedKnown
          ? ` AI precheck: ${precheck.autoApproved} silently approved, ${precheck.skippedKnown} already known${precheck.manualReview ? `, ${precheck.manualReview} left for manual scan` : ''}.`
          : (precheck.manualReview ? ` AI precheck: ${precheck.manualReview} card(s) left for manual scan.` : ''));
      setNotice((result.usedFallbackText ? `Player ${targetSeat}: empty deck box used the default Baru debug deck.` : `Player ${targetSeat}: loaded ${result.totalCards} cards. Commander: ${result.commanderName}.`) + aiPrecheckText);
    } catch (error) {
      setNotice(error.message || `Player ${targetSeat} deck load failed.`);
    } finally {
      setDeckLoading(false);
      setDeckLoadingSeat(null);
    }
  }

  function toggleAiSeat(seat) {
    if (!isHost || seat === localSeat) return;
    updateHostLobby((lobby) => {
      const existing = lobby.players[seat];
      const players = { ...lobby.players };
      if (existing?.ai) {
        players[seat] = null;
      } else {
        players[seat] = {
          id: `ai-player-${seat}`,
          name: `AI Player ${seat}`,
          seat,
          team: seat === 1 || seat === 3 ? 'A' : 'B',
          ready: false,
          ai: true,
          commanderName: null,
          commanderImage: null,
          deckCount: 0
        };
      }
      return { ...lobby, players };
    });
  }

  function buildReadyPatchWithInitiative(targetSeat, nextReady) {
    const player = lobbyState?.players?.[targetSeat];
    const patch = { ready: nextReady };
    if (nextReady && player && !player.initiativeRoll) {
      const seed = makeDiceSeed();
      patch.initiativeSeed = seed;
      patch.initiativeRoll = seededDieValue(seed, 20);
      patch.initiativeRolledAt = Date.now();
    }
    return patch;
  }

  function broadcastLobbyDiceRoll(targetSeat, patch) {
    if (!patch?.initiativeSeed || !patch?.initiativeRoll) return;
    const event = {
      id: crypto.randomUUID(),
      die: 'd20',
      seed: patch.initiativeSeed,
      value: patch.initiativeRoll,
      seat: targetSeat,
      purpose: 'initiative',
      sentAt: Date.now()
    };
    playDice3DRoll({ die: 'd20', seed: event.seed, seat: targetSeat, cinematic: true, persist: true });
    roomRef.current?.send('lobby_dice_roll', event);
  }

  function toggleReady(seatOverride = localSeat) {
    const targetSeat = Number(seatOverride || localSeat);
    if (!targetSeat || !lobbyState) return;
    const hasDeck = Boolean(deckInfoBySeat[targetSeat] || (targetSeat === localSeat && deckInfo) || playerHasDisplayedCommander(lobbyState.players[targetSeat]));
    if (!hasDeck) {
      setNotice(`Load Player ${targetSeat}'s deck first. Empty deck box will use the Baru fallback deck.`);
      return;
    }
    const nextReady = !lobbyState.players[targetSeat]?.ready;
    const patch = buildReadyPatchWithInitiative(targetSeat, nextReady);
    if (isHost) {
      updateHostLobby((lobby) => ({ ...lobby, players: { ...lobby.players, [targetSeat]: { ...lobby.players[targetSeat], ...patch } } }));
      broadcastLobbyDiceRoll(targetSeat, patch);
    } else if (targetSeat === localSeat) {
      roomRef.current?.send('player_update', { playerId, seat: localSeat, patch });
      broadcastLobbyDiceRoll(targetSeat, patch);
    }
  }

  function changeTeam(seat, team) {
    if (!lobbyState?.players?.[seat]) return;
    if (isHost) {
      updateHostLobby((lobby) => ({ ...lobby, players: { ...lobby.players, [seat]: { ...lobby.players[seat], team } } }));
    } else if (seat === localSeat) {
      roomRef.current?.send('player_update', { playerId, seat: localSeat, patch: { team } });
    }
  }

  function changeTableMode(tableMode) {
    if (isHost) updateHostLobby((lobby) => ({ ...lobby, tableMode }));
  }

  function playerHasDisplayedCommander(player) {
    return Boolean(player?.commanderName && player?.deckCount);
  }

  function canStart() {
    if (!isHost || !lobbyState) return false;
    const players = Object.values(lobbyState.players).filter(Boolean);
    const debug = lobbyState.lobbyName.toLowerCase().includes('debug');
    const localPlayer = lobbyState.players[localSeat];
    if (debug && players.length >= 1) return playerHasDisplayedCommander(localPlayer);
    return players.length >= 2 && players.every((player) => player.ready && playerHasDisplayedCommander(player));
  }

  async function startGame() {
    if (!canStart()) return;
    let nextState = lobbyState;
    const debug = lobbyState.lobbyName.toLowerCase().includes('debug');
    const players = { ...nextState.players };
    const aiSeats = SEATS.filter((seat) => players[seat]?.ai || (debug && seat === 2 && !players[seat]));
    for (const seat of aiSeats) {
      if (!players[seat]) {
        players[seat] = {
          id: `ai-player-${seat}`,
          name: seat === 2 ? 'Debug Wurm Bot' : `AI Player ${seat}`,
          seat,
          team: seat === 1 || seat === 3 ? 'A' : 'B',
          ready: true,
          ai: true,
          commanderName: null,
          commanderImage: null,
          deckCount: 0
        };
      }
      if (!playerHasDisplayedCommander(players[seat])) {
        const aiDeck = deckInfoBySeat[seat] || await loadDeckFromText(deckTextBySeat[seat] || DEFAULT_DEBUG_DECK);
        runSilentDeckAiPrecheck(aiDeck, seat);
        setDeckInfoBySeat((current) => ({ ...current, [seat]: aiDeck }));
        players[seat] = {
          ...players[seat],
          ready: true,
          ai: true,
          commanderName: aiDeck.commanderName,
          commanderImage: aiDeck.commander.image,
          deckCount: aiDeck.totalCards
        };
      }
    }
    nextState = { ...nextState, players };
    const startingSeat = getStartingSeatFromInitiative(players);
    const started = { ...nextState, startingSeat, started: true };
    roomRef.current?.send('start_game', { state: started });
    hideDice3DOverlay();
    setLobbyState(started);
    setGameEvents([]);
    setScreen('game');
  }

  if (screen === 'title') {
    return <TitleScreen mode={mode} setMode={setMode} setScreen={setScreen} />;
  }

  if (screen === 'hostJoin' || screen === 'hostForm' || screen === 'joinForm' || screen === 'joining') {
    return (
      <Shell>
        <button className="ghost back" onClick={() => setScreen('title')}>← Back</button>
        <h1>{MODES.find((m) => m.id === mode)?.name}</h1>
        {screen === 'hostJoin' && <HostJoin setScreen={setScreen} />}
        {screen === 'hostForm' && (
          <ConnectionForm
            title="Host Lobby"
            lobbyName={lobbyName}
            setLobbyName={setLobbyName}
            displayName={displayName}
            setDisplayName={setDisplayName}
            onSubmit={hostLobby}
            submitText="Host"
          />
        )}
        {screen === 'joinForm' && (
          <ConnectionForm
            title="Join Lobby"
            lobbyName={lobbyName}
            setLobbyName={setLobbyName}
            displayName={displayName}
            setDisplayName={setDisplayName}
            requestedSeat={requestedSeat}
            setRequestedSeat={setRequestedSeat}
            onSubmit={joinLobby}
            submitText="Join"
            join
          />
        )}
        {screen === 'joining' && <div className="panel"><h2>Joining...</h2><p>{notice}</p><p className="muted">Realtime status: {status}</p></div>}
      </Shell>
    );
  }

  if (screen === 'lobby') {
    return (
      <LobbyScreen
        lobbyState={lobbyState}
        status={status}
        notice={notice}
        isHost={isHost}
        localSeat={localSeat}
        deckText={deckText}
        setDeckText={setDeckText}
        deckInfo={deckInfo}
        deckInfoBySeat={deckInfoBySeat}
        deckTextBySeat={deckTextBySeat}
        setDeckTextForSeat={setDeckTextForSeat}
        deckLoading={deckLoading}
        deckLoadingSeat={deckLoadingSeat}
        loadDeckForPlayer={loadDeckForPlayer}
        toggleReady={toggleReady}
        toggleAiSeat={toggleAiSeat}
        startGame={startGame}
        canStart={canStart()}
        changeTeam={changeTeam}
        changeTableMode={changeTableMode}
        backToTitle={() => setScreen('title')}
      />
    );
  }

  if (screen === 'game') {
    return (
      <GameTable
        lobbyState={lobbyState}
        localSeat={localSeat}
        isHost={isHost}
        playerId={playerId}
        deckInfo={deckInfo}
        deckInfoBySeat={deckInfoBySeat}
        gameEvents={gameEvents}
        sendGameEvent={(event) => roomRef.current?.send('game_event', event)}
        backToLobby={() => setScreen('lobby')}
      />
    );
  }

  return null;
}

function Shell({ children }) {
  return <main className="app-shell">{children}</main>;
}

function TitleScreen({ mode, setMode, setScreen }) {
  return (
    <main className="title-screen compact-title-screen">
      <div className="title-backdrop-orb orb-one" />
      <div className="title-backdrop-orb orb-two" />
      <div className="title-backdrop-orb orb-three" />
      <section className="title-hero single-screen-title">
        <div className="title-hero-copy">
          <p className="eyebrow">Remote tabletop proxy system</p>
          <h1>Fancy Card Table</h1>
          <p className="subtitle">A premium-feeling digital table for Commander nights, remote testing, and physics-inspired card play with your friends.</p>
          <div className="feature-pills compact-pills">
            <span>Realtime Lobby</span>
            <span>Scryfall Import</span>
            <span>Perspective Table</span>
            <span>Drag · Tap · Stack</span>
          </div>
        </div>
        <div className="title-stage compact-stage">
          <div className="stage-table">
            <div className="stage-zone big">Battlefield</div>
            <div className="stage-zone mid">Artifacts / Enchantments</div>
            <div className="stage-zone small">Lands / Mana</div>
            <div className="stage-card stage-card-a" />
            <div className="stage-card stage-card-b" />
            <div className="stage-card stage-card-c" />
          </div>
        </div>
        <div className="title-mode-panel">
          <div className="title-card-topline compact-mode-topline">
            <div>
              <p className="eyebrow">Mode selection</p>
              <h2>Pick a table</h2>
            </div>
          </div>
          <div className="mode-grid compact-mode-grid">
            {MODES.map((item) => (
              <button
                key={item.id}
                className={`mode-card compact-mode-card ${mode === item.id ? 'selected' : ''} ${!item.active ? 'disabled-mode' : ''}`}
                onClick={() => {
                  setMode(item.id);
                  if (item.active) setScreen('hostJoin');
                }}
              >
                <div className="mode-card-top">
                  <span>{item.name}</span>
                  <b>{item.active ? 'Now' : 'Soon'}</b>
                </div>
                <small>{item.blurb}</small>
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function HostJoin({ setScreen }) {
  return (
    <div className="choice-row">
      <button className="big-action" onClick={() => setScreen('hostForm')}>Host</button>
      <button className="big-action" onClick={() => setScreen('joinForm')}>Join</button>
    </div>
  );
}

function ConnectionForm({ title, lobbyName, setLobbyName, displayName, setDisplayName, requestedSeat, setRequestedSeat, onSubmit, submitText, join }) {
  return (
    <form className="panel connection-form" onSubmit={onSubmit}>
      <h2>{title}</h2>
      <label>
        Your display name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Brian" />
      </label>
      <label>
        Lobby name
        <input value={lobbyName} onChange={(e) => setLobbyName(e.target.value)} placeholder="debug-table" />
      </label>
      {join && (
        <label>
          Preferred seat
          <select value={requestedSeat} onChange={(e) => setRequestedSeat(Number(e.target.value))}>
            {SEATS.map((seat) => <option key={seat} value={seat}>Player {seat}</option>)}
          </select>
        </label>
      )}
      <p className="hint">Tip: a lobby name containing <b>debug</b> can start with one real player and an AI opponent.</p>
      <button className="primary" type="submit">{submitText}</button>
    </form>
  );
}

function LobbyScreen(props) {
  const {
    lobbyState,
    status,
    notice,
    isHost,
    localSeat,
    deckText,
    setDeckText,
    deckInfo,
    deckInfoBySeat = {},
    deckTextBySeat = {},
    setDeckTextForSeat,
    deckLoading,
    deckLoadingSeat,
    loadDeckForPlayer,
    toggleReady,
    toggleAiSeat,
    startGame,
    canStart,
    changeTeam,
    changeTableMode,
    backToTitle
  } = props;

  const players = lobbyState?.players || {};
  const initiativeEntries = getInitiativeEntries(players);
  const initiativeLeader = initiativeEntries[0] || null;
  const topRoll = Number(initiativeLeader?.initiativeRoll || 0);
  const topTieCount = topRoll
    ? initiativeEntries.filter((player) => Number(player.initiativeRoll || 0) === topRoll).length
    : 0;
  const [importSeat, setImportSeat] = useState(null);
  const importOpen = importSeat != null;
  const targetSeat = importSeat || localSeat;
  const localPlayerDeckReady = Boolean(players[localSeat]?.commanderName && players[localSeat]?.deckCount);
  const localPlayerReady = Boolean(players[localSeat]?.ready);
  const targetDeckText = deckTextBySeat[targetSeat] ?? (targetSeat === localSeat ? deckText : DEFAULT_DEBUG_DECK);
  const [deckScan, setDeckScan] = useState(null);
  const [importDebugReport, setImportDebugReport] = useState(null);
  const [importDebugLoading, setImportDebugLoading] = useState(false);
  const autoDeckScanRef = useRef('');

  function openDeckScanForSeat(seat) {
    const deck = deckInfoBySeat[seat] || (seat === localSeat ? deckInfo : null);
    if (!deck) return;
    const precheck = runSilentDeckAiPrecheck(deck, seat);
    const brain = precheck.brain;
    const allCards = uniqueAiCardsForDeck(deck);
    const needsReview = allCards.filter((card) => {
      const plan = buildAiCardPlan(card, { seat, boardCards: [], library: deck?.cards || [], hand: [] }, brain);
      return !(plan.learned && plan.approvedCount > 0);
    });
    if (!needsReview.length) return;
    setDeckScan({ seat, deck, cards: needsReview, index: 0, brain, reviewed: 0, autoApproved: precheck.autoApproved, skippedKnown: allCards.length - needsReview.length });
  }

  function advanceDeckScan(verdict, note = '', options = {}) {
    setDeckScan((current) => {
      if (!current) return current;
      const card = current.cards[current.index];
      let brain = current.brain;
      if (card && verdict !== 'skip') {
        const plan = buildAiCardPlan(card, { seat: current.seat, boardCards: [], library: current.deck?.cards || [], hand: [] }, brain);
        brain = recordAiFeedback(brain, plan, verdict, note, options);
      }
      const nextIndex = current.index + 1;
      if (nextIndex >= current.cards.length) return null;
      return {
        ...current,
        brain,
        index: nextIndex,
        reviewed: current.reviewed + (verdict === 'skip' ? 0 : 1),
        autoApproved: Number(current.autoApproved || 0) + (options.autoApproved ? 1 : 0)
      };
    });
  }

  useEffect(() => {
    if (!deckScan) return undefined;
    const card = deckScan.cards?.[deckScan.index];
    if (!card) return undefined;
    const plan = buildAiCardPlan(card, { seat: deckScan.seat, boardCards: [], library: deckScan.deck?.cards || [], hand: [] }, deckScan.brain);
    if (!shouldAutoApproveAiPlan(plan)) return undefined;
    const signature = `${deckScan.seat}:${deckScan.index}:${plan.cardKey}:${plan.confidence}`;
    if (autoDeckScanRef.current === signature) return undefined;
    autoDeckScanRef.current = signature;
    const timer = setTimeout(() => {
      advanceDeckScan('approved', autoApprovalReason(plan), {
        responseWorthy: Boolean(plan.responseProfile?.responseWorthy),
        responseReason: plan.responseProfile?.responseWorthy ? `Auto-approved at ${plan.confidence}% confidence: ${(plan.responseProfile.reasons || []).join('; ')}` : '',
        autoApproved: true,
        autoConfidence: plan.confidence
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [deckScan]);

  function openImportForSeat(seat) {
    setImportDebugReport(null);
    setImportSeat(seat);
  }

  function updateTargetDeckText(value) {
    if (targetSeat === localSeat) setDeckText(value);
    setDeckTextForSeat?.(targetSeat, value);
  }

  async function runDeckImportDebug() {
    setImportDebugLoading(true);
    try {
      const result = await loadDeckFromText(targetDeckText, { debug: true, debugCommand: 'deck_import_debug' });
      setImportDebugReport(result.importDebug);
      setNotice(`Debug import parsed ${result.totalCards} cards for Player ${targetSeat}. Diagnostics are read-only; click Load deck for P${targetSeat} to apply it to the lobby.`);
    } catch (error) {
      const report = error?.importDebug || {
        command: 'deck_import_debug',
        generatedAt: new Date().toLocaleString(),
        pageSize: 12,
        items: [],
        errors: [error?.message || String(error)]
      };
      setImportDebugReport({ ...report, errors: [...(report.errors || []), error?.message || String(error)] });
      setNotice(`Debug import failed for Player ${targetSeat}: ${error?.message || String(error)}`);
    } finally {
      setImportDebugLoading(false);
    }
  }

  return (
    <main className="lobby-screen column-only-lobby">
      <header className="lobby-header compact-lobby-header">
        <button className="ghost" onClick={backToTitle}>← Title</button>
        <div>
          <h1>Lobby: {lobbyState?.lobbyName}</h1>
          <p>Seat: Player {localSeat} · Status: {status}</p>
        </div>
        <div className="lobby-header-side">
          <div className={`initiative-leader-card ${initiativeLeader ? 'has-leader' : ''}`}>
            <span>{initiativeLeader ? 'Current highest roll' : 'Initiative'}</span>
            <strong>{initiativeLeader ? `Player ${initiativeLeader.seat}: ${initiativeLeader.name || 'Ready player'}` : 'No d20 rolled yet'}</strong>
            <small>{initiativeLeader ? `d20: ${initiativeLeader.initiativeRoll}${topTieCount > 1 ? ' · tie broken by first roll' : ' · goes first if started now'}` : 'Ready up to roll for first turn'}</small>
          </div>
          <div className="lobby-mode-picker">
            <span>Match style</span>
            <select value={lobbyState?.tableMode || 'free-for-all'} disabled={!isHost} onChange={(e) => changeTableMode(e.target.value)}>
              <option value="free-for-all">1v1v1v1 / Free-for-all</option>
              <option value="teams">Teams / 2v2</option>
            </select>
          </div>
        </div>
      </header>

      <section className="seat-grid full-height-seat-grid">
        {SEATS.map((seat) => {
          const player = players[seat];
          const isYou = seat === localSeat;
          const seatDeckReady = Boolean(player?.commanderName && player?.deckCount);
          const isLoadingThisSeat = deckLoading && deckLoadingSeat === seat;
          return (
            <div className={`seat-card lobby-seat-card ${isYou ? 'you' : ''} ${player?.ai ? 'ai-seat' : ''}`} key={seat} data-seat-card={seat}>
              <div className="seat-topline">
                <div className="seat-heading-group">
                  <h2>{`Player ${seat}: ${player?.name || 'Open Seat'}`}</h2>
                  {player && <p className="seat-commander-line">Commander: {isLoadingThisSeat ? 'Loading deck...' : (player.commanderName || 'Deck not loaded')}</p>}
                </div>
                <span className={player?.ready ? 'ready-pill' : 'empty-pill'}>{player ? (player.ready ? 'Ready' : 'Not ready') : 'Empty'}</span>
              </div>
              {player ? (
                <>
                  <div className="player-seat-toolbar">
                    <div className="player-seat-meta">{player.ai ? 'AI Test Opponent' : `Seat ${seat}`} · {player.deckCount ? `${player.deckCount} cards loaded` : 'Deck not loaded'}{player.initiativeRoll ? ` · Initiative d20: ${player.initiativeRoll}` : ''}</div>
                    <TeamPills
                      value={player.team || 'A'}
                      disabled={!isHost && seat !== localSeat}
                      onChange={(team) => changeTeam(seat, team)}
                    />
                  </div>
                  <CommanderPreview player={player} loading={isLoadingThisSeat} seat={seat} />
                  {(isYou || (isHost && player.ai)) && (
                    <div className="seat-action-stack">
                      <button className="secondary import-deck-button" disabled={isLoadingThisSeat} onClick={() => openImportForSeat(seat)}>{seatDeckReady ? 'Change / Import Deck' : 'Import Deck'}</button>
                      <button className="secondary" disabled={!seatDeckReady || isLoadingThisSeat} onClick={() => openDeckScanForSeat(seat)}>AI Check Deck</button>
                      <button className="primary" disabled={(!seatDeckReady && !player.ready) || isLoadingThisSeat} onClick={() => toggleReady(seat)}>{player.ready ? 'Unready' : 'Ready up'}</button>
                      {isHost && player.ai && <button className="secondary danger-lite" onClick={() => toggleAiSeat(seat)}>Remove AI</button>}
                      {isHost && isYou && <button className="start" disabled={!canStart} onClick={startGame}>Start Game</button>}
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-seat deluxe-empty-seat">
                  <div className="empty-seat-icon">✦</div>
                  <strong>Waiting for player...</strong>
                  <span>Join this lobby to claim Player {seat}.</span>
                  {isHost && seat !== localSeat && <button className="secondary ai-enable-button" onClick={() => toggleAiSeat(seat)}>Enable AI opponent</button>}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <div className="lobby-status-strip">
        <span>{notice || 'Import your deck from your player column, ready up, then start.'}</span>
        {deckInfo && <b>{deckInfo.totalCards} cards · Commander: {deckInfo.commanderName}</b>}
      </div>

      {importOpen && (
        <div className="deck-import-modal-backdrop" onClick={() => setImportSeat(null)}>
          <section className="deck-import-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-topline">
              <div>
                <p className="eyebrow">Player {targetSeat}</p>
                <h2>Import deck</h2>
              </div>
              <button className="close round-close" onClick={() => setImportSeat(null)}>×</button>
            </div>
            <p className="modal-copy">Paste a decklist. Empty box falls back to the Baru Wurmspeaker debug deck.</p>
            <textarea value={targetDeckText} onChange={(e) => updateTargetDeckText(e.target.value)} spellCheck="false" />
            <div className="modal-actions">
              <button className="secondary" onClick={() => updateTargetDeckText('')}>Clear to test fallback</button>
              <button className="secondary" disabled={deckLoading || importDebugLoading} onClick={runDeckImportDebug}>{importDebugLoading ? 'Debugging...' : 'Debug import'}</button>
              <button className="secondary" disabled={deckLoading} onClick={() => { loadDeckForPlayer(targetSeat, targetDeckText); setImportSeat(null); }}>{deckLoading ? 'Loading...' : `Load deck for P${targetSeat}`}</button>
              {targetSeat === localSeat && <button className="primary" disabled={!localPlayerDeckReady && !localPlayerReady} onClick={() => { toggleReady(localSeat); setImportSeat(null); }}>{players[localSeat]?.ready ? 'Unready' : 'Ready up'}</button>}
            </div>
            <div className="notice-row deck-status-strip">
              <span>{notice}</span>
              {deckInfoBySeat[targetSeat] && <b>{deckInfoBySeat[targetSeat].totalCards} cards · Commander: {deckInfoBySeat[targetSeat].commanderName}</b>}
            </div>
          </section>
        </div>
      )}

      {importDebugReport && (
        <DeckImportDebugModal report={importDebugReport} onClose={() => setImportDebugReport(null)} />
      )}

      {deckScan && (
        <DeckScanModal
          session={deckScan}
          onApprove={(options) => advanceDeckScan('approved', '', options)}
          onReject={(note) => advanceDeckScan('rejected', note)}
          onSkip={() => advanceDeckScan('skip')}
          onStop={() => setDeckScan(null)}
        />
      )}
    </main>
  );
}


function TeamPills({ value, onChange, disabled }) {
  return (
    <div className={`team-pills ${disabled ? 'disabled' : ''}`}>
      <span>Team</span>
      <div className="team-pill-row">
        {['A', 'B', 'C', 'D'].map((team) => (
          <button
            key={team}
            type="button"
            className={`team-pill ${value === team ? 'active' : ''}`}
            disabled={disabled}
            onClick={() => onChange(team)}
          >
            {team}
          </button>
        ))}
      </div>
    </div>
  );
}

function CommanderPreview({ player, loading = false, seat = null }) {
  const diceSeat = seat || player?.seat || '';
  return (
    <div className={`commander-preview ${loading ? 'deck-loading-preview' : ''}`} data-dice-anchor-seat={diceSeat}>
      {player.commanderImage ? <img src={player.commanderImage} alt={player.commanderName} data-dice-commander-seat={diceSeat} /> : <div className="card-back-mini" data-dice-commander-seat={diceSeat} />}
      {loading && <div className="deck-loading-overlay"><span className="tiny-spinner" />Loading deck...</div>}
      <div className="commander-preview-copy">
        <small>Commander portrait</small>
        <span>{loading ? 'Please wait — deck is being loaded.' : (player.deckCount ? `${player.deckCount} cards loaded` : 'Deck not loaded')}</span>
      </div>
    </div>
  );
}


function OracleReviewText({ text = '', abilities = null }) {
  const lines = Array.isArray(abilities) && abilities.length
    ? abilities.map((ability) => ability.sourceText || ability.text).filter(Boolean)
    : String(text || '').split('\n').filter(Boolean);
  if (!lines.length) return <ManaText text={text || 'No oracle text available.'} />;
  return (
    <div className="oracle-review-lines">
      {lines.map((line, index) => <div key={`${index}-${line}`} className="oracle-review-line"><ManaText text={line} /></div>)}
    </div>
  );
}

function CostReductionInfo({ action }) {
  const check = action?.costReductionCheck || action?.costReduction;
  if (!check) return null;
  return (
    <div className="cost-reduction-info">
      <b>Cost reduction:</b>
      <span>{check.note || `This ability costs {X} less to activate.`}</span>
      {check.reason && <span>{check.reason}</span>}
      {check.payableCost && <span>Estimated activation cost now: <ManaText text={check.payableCost} /></span>}
    </div>
  );
}

function formatSearchPlan(action = {}) {
  const criteria = action.searchCriteria || {};
  const parts = [];
  if (criteria.maxChoices) parts.push(`${criteria.optionalCount ? 'up to ' : ''}${criteria.maxChoices} ${criteria.basicOnly ? 'basic ' : ''}${criteria.landOnly ? 'land card(s)' : 'card(s)'}`);
  if (criteria.reveal || action.reveal) parts.push('reveal');
  if (action.instructionLabel || criteria.instructionLabel) parts.push(action.instructionLabel || criteria.instructionLabel);
  else if (criteria.destination) parts.push(`put into ${criteria.destination}`);
  if ((criteria.thenShuffle || action.thenShuffle) && !(action.instructionLabel || criteria.instructionLabel || '').includes('shuffle')) parts.push('then shuffle');
  return parts.filter(Boolean).join(' · ');
}

function AiActionDetailNotes({ action }) {
  if (!action) return null;
  const notes = [];
  if (action.type === 'search_library') {
    const searchPlan = formatSearchPlan(action);
    if (searchPlan) notes.push({ label: 'Search plan', text: searchPlan });
  }
  if (action.type === 'casting_cost_modifier') {
    const reductionText = action.reduction?.label || '';
    const appliesText = action.appliesToText || 'matching spells';
    const costText = action.optionalAdditionalCost?.label || '';
    notes.push({
      label: 'Casting cost modifier',
      text: `${appliesText}: ${costText}${reductionText ? ` → ${reductionText}` : ''}${action.reduction?.requiresAdditionalCostPaid ? ' if paid this way' : ''}`
    });
  }
  if (action.type === 'cycling') {
    notes.push({ label: 'Cycling', text: `${action.costText || 'Pay cycling cost, discard this card'} → draw 1 card` });
    if (action.sourceZoneRequirement) notes.push({ label: 'Required zone', text: action.sourceZoneRequirement });
  }
  if (action.type === 'set_life_total') {
    notes.push({ label: 'Life total', text: `${action.affectedObjects === 'target player' ? 'Target player' : 'You'} becomes ${action.lifeTotal}` });
  }
  if (action.type === 'life_floor_replacement') {
    notes.push({ label: 'Replacement effect', text: `Damage that would reduce your life below ${action.floor} reduces it to ${action.floor} instead` });
    notes.push({ label: 'Important limit', text: 'Damage only — this is not generic life loss prevention' });
  }
  if (action.type === 'life_gain_replacement') {
    notes.push({ label: 'Life gain replacement', text: `If you would gain life, gain that much plus ${action.bonusLife || 1} instead` });
    notes.push({ label: 'Important limit', text: 'This is not immediate life gain; it modifies future life-gain events' });
  }
  if (action.type === 'payment_restriction') {
    notes.push({ label: 'Payment restriction', text: action.label || 'Players cannot use the listed payments for spells or abilities' });
    notes.push({ label: 'Important limit', text: 'Blocks costs only — not damage, normal life loss, or non-cost sacrifices' });
  }
  if (action.type === 'spell_cost_modifier') {
    notes.push({ label: action.modifierMode === 'increase' ? 'Spell cost tax' : 'Spell cost reduction', text: action.label || 'Static spell cost modifier' });
    if (action.chosenTypeRef) notes.push({ label: 'Linked choice', text: 'Uses the creature type chosen by this card' });
  }
  if (action.type === 'mass_destroy') {
    notes.push({ label: 'Mass destroy', text: action.label || `Destroy ${action.affectedObjects || 'matching permanents'}` });
    if (action.manaValueFilter) notes.push({ label: 'Mana value filter', text: `Mana value ${action.manaValueFilter.op} ${action.manaValueFilter.value}` });
    notes.push({ label: 'Targeting', text: 'Does not target; affects all matching permanents' });
  }
  if (action.type === 'entry_tapped_modifier') {
    notes.push({ label: 'Entry tapped modifier', text: action.label || `${action.affectedObjects || 'Matching permanents'} enter tapped` });
  }
  if (action.type === 'top_card_type_check') {
    notes.push({ label: 'Top-card check', text: action.label || 'Look at the top card and maybe put it into hand' });
    if (action.chosenTypeRef) notes.push({ label: 'Linked choice', text: 'Uses the creature type chosen by this card' });
  }
  if (action.type === 'keyword_action') {
    notes.push({ label: 'Keyword action', text: action.label || action.keywordAction || 'Keyword action' });
    if (action.createsToken?.name) notes.push({ label: 'Creates token', text: `${action.createsToken.count || 1} ${action.createsToken.name} ${action.createsToken.typeLine || 'token'}` });
    if (action.createsToken?.abilityText) notes.push({ label: 'Token ability', text: action.createsToken.abilityText });
  }
  if (action.type === 'combat_declaration_tax') {
    notes.push({ label: 'Combat tax', text: action.label || `${action.declaration || 'combat'} declaration tax` });
    notes.push({ label: 'Cost imposed', text: `${action.taxCost || '{1}'} for ${action.taxPer || 'each creature'}` });
    if (action.conditionText) notes.push({ label: 'Condition', text: action.conditionText });
  }
  if (action.type === 'spell_counter_restriction') {
    notes.push({ label: 'Cannot be countered', text: action.label || 'Matching spell(s) cannot be countered' });
    notes.push({ label: 'Watcher note', text: 'Static rule for stack/counter checks; it does not activate the permanent.' });
  }
  if (action.type === 'damage_prevention_restriction') {
    notes.push({ label: 'Damage prevention rule', text: action.label || 'Matching damage cannot be prevented' });
    notes.push({ label: 'Watcher note', text: 'Static rule for damage resolution; it does not activate the permanent.' });
  }
  if (action.type === 'blocking_restriction') {
    notes.push({ label: 'Blocking restriction', text: action.label || 'Blocking restriction / evasion rule' });
    if (action.blockerPowerMax !== null && action.blockerPowerMax !== undefined) notes.push({ label: 'Blocked by', text: `Cannot be blocked by creatures with power ${action.blockerPowerMax} or less` });
  }
  if (action.type === 'top_library_permanent_to_battlefield') {
    notes.push({ label: 'Attack trigger', text: action.label || 'Look at top library cards and maybe put a permanent onto the battlefield' });
    notes.push({ label: 'X definition', text: action.xDefinition || 'source power' });
    notes.push({ label: 'Remainder', text: 'Put the rest on the bottom of the library in random order.' });
  }
  if (/^combat_mass_/.test(action.type || '')) {
    notes.push({ label: 'Combat action', text: action.label || `Affects ${action.affectedObjects || 'combat creatures'}` });
    notes.push({ label: 'Combat state', text: 'Needs attacking/blocking creature state when this resolves' });
  }
  if (action.type === 'choose_and_grant_trait') {
    notes.push({ label: 'Choose ability', text: `Choose ${action.choices?.join(' / ') || 'an ability'}; ${action.affectedObjects || 'creatures'} gain it${action.duration === 'until-end-of-turn' ? ' until end of turn' : ''}` });
  }
  if (action.type === 'modify_pt' && action.conditionText) {
    notes.push({ label: 'Conditional modifier', text: `${action.label || 'P/T modifier'} while ${action.conditionText}` });
  }
  if (action.type === 'entry_counter_modifier') {
    notes.push({ label: 'Entry counter modifier', text: `${action.affectedObjects || 'Matching permanents'} enter with ${action.counterType || '+1/+1'} counter(s)` });
    if (action.amountLabel) notes.push({ label: 'Dynamic count', text: action.amountLabel });
    if (action.excludesSource) notes.push({ label: 'Other', text: 'Does not apply to the source itself' });
  }
  if (action.type === 'temporary_exile_return') {
    notes.push({ label: 'Temporary exile', text: `${action.targetDescription || 'Target permanent'} returns at ${action.delayedReturn?.timing || 'the next end step'}` });
    if (action.delayedReturn?.controller) notes.push({ label: 'Return control', text: `Returns under ${action.delayedReturn.controller}'s control` });
    if (action.targetExcludesSource) notes.push({ label: 'Target limit', text: 'Another target — cannot target the source itself' });
  }
  if (action.type === 'linked_exile_until_source_leaves') {
    notes.push({ label: 'Linked exile', text: `${action.targetDescription || 'Target permanent'} stays exiled ${action.returnCondition || 'until the source leaves the battlefield'}` });
    if (action.targetExcludesSource) notes.push({ label: 'Target limit', text: 'Another target — cannot target the source itself' });
  }
  if (!notes.length) return null;
  return (
    <>
      {notes.map((note, index) => (
        <p key={`${note.label}-${index}`} className="ai-action-note"><b>{note.label}:</b> <ManaText text={note.text} /></p>
      ))}
    </>
  );
}


function ConfidenceFactorTags({ plan }) {
  const reasons = (plan?.confidenceReasons || []).filter(Boolean).slice(0, 6);
  if (!reasons.length) return null;
  return (
    <div className="response-reason-list confidence-factor-list">
      {reasons.map((reason) => <span key={reason}>{reason}</span>)}
    </div>
  );
}

function ModalChoiceSummary({ plan }) {
  const rules = plan?.modalChoiceRules || [];
  if (!rules.length) return null;
  return (
    <div className="response-reason-list confidence-factor-list modal-choice-summary">
      {rules.map((rule, index) => <span key={`${rule.label}-${index}`}>{rule.label}</span>)}
    </div>
  );
}

function DeckScanModal({ session, onApprove, onReject, onSkip, onStop }) {
  const [note, setNote] = useState('');
  const [zoomedCard, setZoomedCard] = useState(false);
  const card = session?.cards?.[session.index];
  const plan = card ? buildAiCardPlan(card, { seat: session.seat, boardCards: [], library: session.deck?.cards || [], hand: [] }, session.brain) : null;
  const actions = plan?.actions || [];
  const [responseWorthy, setResponseWorthy] = useState(false);
  useEffect(() => {
    setResponseWorthy(Boolean(plan?.responseProfile?.responseWorthy));
    setZoomedCard(false);
  }, [plan?.cardKey]);
  const progressTotal = session?.cards?.length || 0;
  const autoApprovesThisCard = shouldAutoApproveAiPlan(plan);
  const autoApprovalBlocked = autoApprovalBlockReason(plan);
  const copyDebug = () => copyAiParseDebug({ card, plan, boardCard: { ownerSeat: session.seat, zone: 'pregame-scan', card }, action: actions[0] || null, step: { title: 'Pre-game deck scan' } });
  if (!card) return null;
  return (
    <div className="mini-modal-backdrop ai-review-backdrop" onClick={onStop}>
      <section className="deck-scan-modal mini-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-topline">
          <div>
            <p className="eyebrow">Pre-game AI deck check · Player {session.seat}</p>
            <h2>{card.name}</h2>
          </div>
          <button className="close round-close" onClick={onStop}>×</button>
        </div>
        <div className="deck-scan-progress">Card {session.index + 1} / {progressTotal} · Reviewed this run: {session.reviewed || 0} · Auto-approved: {session.autoApproved || 0} · Skipped known: {session.skippedKnown || 0}</div>
        <div className="ai-review-layout">
          <aside className="ai-review-card-art enlarged-review-art" onClick={() => setZoomedCard(true)}>{card.image ? <img src={card.image} alt={card.name} /> : <div className="no-image-card">{card.name}</div>}<span className="image-zoom-hint">Tap to inspect</span></aside>
          <section className="ai-review-main-copy">
            <div className="ai-oracle-box"><b>Oracle text being reviewed</b><OracleReviewText text={card.oracleText || 'No oracle text available.'} abilities={plan?.abilities || []} /></div>
            <div className="ai-confidence-row"><span>Detected actions: <b>{actions.length}</b></span><span>Confidence: <b>{plan?.confidence || 0}%</b></span><span>Auto threshold: <b>{AI_AUTO_APPROVE_CONFIDENCE}%</b></span></div>
            {autoApprovesThisCard && <div className="ai-suggestion-box muted-box">Auto-approving this parse because confidence is {plan.confidence}% and every ability has a detected action.</div>}
            {!autoApprovesThisCard && autoApprovalBlocked && <div className="ai-suggestion-box muted-box">{autoApprovalBlocked}</div>}
            <ConfidenceFactorTags plan={plan} />
            <ModalChoiceSummary plan={plan} />
            <label className="response-flag-toggle"><input type="checkbox" checked={responseWorthy} onChange={(event) => setResponseWorthy(event.target.checked)} /> Response card / contains response action</label>
            {plan?.responseProfile?.reasons?.length ? <div className="response-reason-list">{plan.responseProfile.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div> : null}
            <div className="ai-ability-list compact-ai-ability-list">
              {(plan?.abilities || []).map((ability) => (
                <article key={ability.id} className={`ai-ability-card ${ability.actions.length ? '' : 'unparsed'}`}>
                  {ability.modeHeader && <small>{ability.modeHeader}</small>}
                  <strong>{ability.optional ? 'Optional / may' : 'Mandatory / normal'}</strong>
                  {ability.triggerText && <p className="trigger-line"><b>Trigger:</b> <ManaText text={ability.triggerText} /></p>}
                  {ability.conditionText && <p className="trigger-line"><b>Condition:</b> <ManaText text={ability.conditionText} /></p>}
                  {ability.costText && <p><b>Cost:</b> <ManaText text={ability.costText} /></p>}
                  {ability.cost?.parts?.length ? <div className="ai-action-tags cost-action-tags">{ability.cost.parts.map((part, index) => <span key={index}><ManaText text={part.label} /></span>)}</div> : null}
                  <p><b>Effect:</b> <ManaText text={ability.effectText || ability.sourceText} /></p>
                  {ability.actions.map((action, index) => <CostReductionInfo key={`reduction-${index}`} action={action} />)}
                  {ability.actions.length ? <div className="ai-action-tags">{ability.actions.map((action, index) => <span key={index}><ManaText text={action.label} /></span>)}</div> : <em>No common action recognized yet.</em>}
                  {ability.actions.map((action, index) => (
                    <React.Fragment key={`ai-action-extra-${index}`}>
                      {action.type === 'add_mana' && <p className="ai-action-note"><b>Mana output:</b> <ManaText text={action.producedManaLabel || action.label} />{action.manaRestriction ? ` — restricted: ${action.manaRestriction}` : ' — unrestricted'}</p>}
                      <AiActionDetailNotes action={action} />
                      {action.equipmentRecommendation?.reason && <p className="ai-action-note"><b>Equip planning:</b> {action.equipmentRecommendation.reason}</p>}
                      {action.creatureTypeChoice?.reason && <p className="ai-action-note"><b>Type choice:</b> {action.creatureTypeChoice.reason}</p>}
                    </React.Fragment>
                  ))}
                </article>
              ))}
            </div>
          </section>
        </div>
        <label>Correction note
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note about what it missed" />
        </label>
        <div className="modal-actions ai-review-actions">
          <button className="secondary" onClick={copyDebug}>Copy parse debug</button>
          <button className="secondary danger-action" onClick={() => { onReject(note); setNote(''); }}>Reject</button>
          <button className="secondary" onClick={onSkip}>Skip</button>
          <button className="primary" onClick={() => { onApprove({ responseWorthy, responseReason: responseWorthy ? 'Marked during pre-game deck scan' : '' }); setNote(''); }}>Approve / remember</button>
          <button className="secondary" onClick={onStop}>Stop scan</button>
        </div>
        {zoomedCard && card.image && <div className="card-image-zoom-backdrop" onClick={() => setZoomedCard(false)}><img src={card.image} alt={card.name} /></div>}
      </section>
    </div>
  );
}

function GameTable({ lobbyState, localSeat, isHost, playerId, deckInfo, deckInfoBySeat = {}, gameEvents, sendGameEvent, backToLobby }) {
  const tableRef = useRef(null);
  const tableWrapRef = useRef(null);
  const handDockRef = useRef(null);
  const panSessionRef = useRef(null);
  const boardPointerRef = useRef(null);
  const resolvingAiStackRef = useRef(new Set());
  const [pan, setPan] = useState({ x: -1180, y: -1540 });
  const [zoom, setZoom] = useState(0.72);
  const [library, setLibrary] = useState([]);
  const [hand, setHand] = useState([]);
  const [boardCards, setBoardCards] = useState([]);
  const [dragging, setDragging] = useState(null);
  const draggingRef = useRef(null);
  const [remoteDrags, setRemoteDrags] = useState({});
  const [previewCard, setPreviewCard] = useState(null);
  const [handPreviewCard, setHandPreviewCard] = useState(null);
  const [boardHoverPreviewCard, setBoardHoverPreviewCard] = useState(null);
  const [tooltipCard, setTooltipCard] = useState(null);
  const [selection, setSelection] = useState(null);
  const [turn, setTurn] = useState(1);
  const [activeSeat, setActiveSeat] = useState(() => Number(lobbyState?.startingSeat || 1));
  const [landPlayedThisTurn, setLandPlayedThisTurn] = useState(false);
  const [aiStates, setAiStates] = useState({});
  const [drawAnims, setDrawAnims] = useState([]);
  const [responsePromptsEnabled, setResponsePromptsEnabled] = useState(true);
  const [modifyModal, setModifyModal] = useState(null);
  const [activateModal, setActivateModal] = useState(null);
  const [aiBrain, setAiBrain] = useState(() => loadAiBrain());
  const [aiReview, setAiReview] = useState(null);
  const [aiReviewQueue, setAiReviewQueue] = useState([]);
  const [pendingAiAfterReview, setPendingAiAfterReview] = useState(null);
  const [aiThoughtLog, setAiThoughtLog] = useState([]);
  const [aiThoughtCollapsed, setAiThoughtCollapsed] = useState(false);
  const [hideTraitBadges, setHideTraitBadges] = useState(false);
  const [aiCardAnim, setAiCardAnim] = useState(null);
  const [devConsoleOpen, setDevConsoleOpen] = useState(false);
  const [devCommand, setDevCommand] = useState('');
  const [pendingAiResetTarget, setPendingAiResetTarget] = useState(false);
  const [aiMissingReport, setAiMissingReport] = useState(null);
  const [aiConfidenceReport, setAiConfidenceReport] = useState(null);
  const [actionChoiceRequest, setActionChoiceRequest] = useState(null);
  const [turnEventLog, setTurnEventLog] = useState([]);
  const [lifeTotals, setLifeTotals] = useState(() => Object.fromEntries(SEATS.map((seat) => [seat, { life: STARTING_LIFE, infect: STARTING_INFECT, commander: 0 }])));
  const [eliminatedSeats, setEliminatedSeats] = useState([]);
  const [winnerSeat, setWinnerSeat] = useState(null);
  const [combatState, setCombatState] = useState({ phase: 'main', attackers: [], blockers: [], warnings: [], summary: null, attackingSeat: null, defendingSeat: null, pendingBlockerId: null });
  const [phaseLabel, setPhaseLabel] = useState('Setup');
  const [toasts, setToasts] = useState([]);
  const [stackItems, setStackItems] = useState([]);
  const [responsePrompt, setResponsePrompt] = useState(null);
  const [pendingAiAfterStack, setPendingAiAfterStack] = useState(null);
  const [zoneBrowser, setZoneBrowser] = useState(null);
  const [addCardModalOpen, setAddCardModalOpen] = useState(false);
  const processedGameEvents = useRef(new Set());
  const suppressNextBoardClick = useRef(false);
  const autoAiReviewRef = useRef('');
  const watcherRunRef = useRef(new Set());
  const initialAiStartKeyRef = useRef('');
  const libraryRef = useRef([]);
  const drawAnimTimersRef = useRef(new Set());
  const toastTimersRef = useRef(new Set());

  const players = lobbyState?.players || {};
  const aiSeats = SEATS.filter((seat) => players[seat]?.ai);
  const debugHasAi = aiSeats.length > 0;

  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  useEffect(() => () => {
    for (const timer of drawAnimTimersRef.current) clearTimeout(timer);
    drawAnimTimersRef.current.clear();
    for (const timer of toastTimersRef.current) clearTimeout(timer);
    toastTimersRef.current.clear();
  }, []);

  useEffect(() => {
    const startingSeat = Number(lobbyState?.startingSeat || 1);
    setActiveSeat(startingSeat);
    setPhaseLabel(`Setup · Player ${startingSeat} starts`);
    queueTurnStartToasts(startingSeat, 1, { initial: true });
  }, [lobbyState?.startingSeat, localSeat]);

  useEffect(() => {
    const playable = (deckInfo?.cards || []).filter((card) => card.name !== deckInfo?.commanderName);
    const shuffled = shuffleCards(playable);
    setHand(shuffled.slice(0, 7));
    const nextLibrary = shuffled.slice(7);
    libraryRef.current = nextLibrary;
    setLibrary(nextLibrary);
    setBoardCards((cards) => {
      const withoutCommander = cards.filter((card) => !(card.isCommander && card.ownerSeat === localSeat));
      if (!deckInfo?.commander || !localSeat) return withoutCommander;
      return [
        ...withoutCommander,
        {
          boardId: `commander-${localSeat}`,
          ownerSeat: localSeat,
          zone: 'command',
          slot: 0,
          stackIndex: 0,
          tapped: false,
          isCommander: true,
          commanderTax: 0,
          card: deckInfo.commander,
          playedAt: Date.now(),
          mods: []
        }
      ];
    });
  }, [deckInfo, localSeat]);

  useEffect(() => {
    if (!isHost || !debugHasAi) return;
    aiSeats.forEach((seat) => {
      if (aiStates[seat]) return;
      const existingDeck = deckInfoBySeat[seat];
      const seedFromDeck = (result) => {
        const cards = shuffleCards(result.cards.filter((card) => card.name !== result.commanderName));
        setAiStates((current) => ({ ...current, [seat]: { seat, library: cards.slice(7), hand: cards.slice(0, 7), landPlayed: false } }));
        setBoardCards((current) => [
          ...current.filter((card) => !(card.isCommander && card.ownerSeat === seat)),
          {
            boardId: `commander-${seat}`,
            ownerSeat: seat,
            originalOwnerSeat: seat,
            controllerSeat: seat,
            zone: 'command',
            slot: 0,
            stackIndex: 0,
            tapped: false,
            isCommander: true,
            commanderTax: 0,
            card: result.commander,
            playedAt: Date.now(),
            mods: []
          }
        ]);
      };
      if (existingDeck) seedFromDeck(existingDeck);
      else loadDeckFromText(DEFAULT_DEBUG_DECK).then(seedFromDeck);
    });
  }, [isHost, debugHasAi, JSON.stringify(aiSeats), deckInfoBySeat]);

  useEffect(() => {
    const startingSeat = Number(lobbyState?.startingSeat || 1);
    if (!isHost || !startingSeat) return undefined;
    if (Number(activeSeat || 0) !== startingSeat) return undefined;
    if (!players[startingSeat]?.ai) return undefined;
    if (!aiStates[startingSeat]) return undefined;

    const key = `${lobbyState?.id || 'game'}:${startingSeat}:turn-${turn}`;
    if (initialAiStartKeyRef.current === key) return undefined;
    initialAiStartKeyRef.current = key;

    const timer = setTimeout(() => {
      publishAiThought(`AI Player ${startingSeat} won initiative and is taking the first turn.`, 'replace', startingSeat);
      runAiTurn(startingSeat);
    }, 900);

    return () => clearTimeout(timer);
  }, [isHost, lobbyState?.id, lobbyState?.startingSeat, activeSeat, turn, aiStates, players]);

  useEffect(() => {
    for (const event of gameEvents) {
      if (!event?.eventId || processedGameEvents.current.has(event.eventId)) continue;
      processedGameEvents.current.add(event.eventId);
      if (processedGameEvents.current.size > 1000) processedGameEvents.current.clear();
      applyIncomingGameEvent(event);
    }
  }, [gameEvents]);

  useEffect(() => {
    const id = requestAnimationFrame(() => centerOnMyArea());
    return () => cancelAnimationFrame(id);
  }, [localSeat]);

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', onTablePanMove);
      window.removeEventListener('pointerup', onTablePanEnd);
      window.removeEventListener('pointermove', onWindowDragMove);
      window.removeEventListener('pointerup', onWindowDragEnd);
      window.removeEventListener('pointermove', onBoardPointerMove);
      window.removeEventListener('pointerup', onBoardPointerUp);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== '`' && event.key !== '~') return;
      if (event.target?.closest?.('input, textarea, select')) return;
      event.preventDefault();
      setDevConsoleOpen((open) => !open);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);


  function zoomAroundViewportCenter(delta) {
    const wrapRect = tableWrapRef.current?.getBoundingClientRect();
    if (!wrapRect) {
      setZoom((value) => Math.max(0.32, Math.min(2.2, Number((value + delta).toFixed(2)))));
      return;
    }
    const centerX = wrapRect.width / 2;
    const centerY = wrapRect.height / 2;
    setZoom((oldZoom) => {
      const nextZoom = Math.max(0.32, Math.min(2.2, Number((oldZoom + delta).toFixed(2))));
      if (nextZoom === oldZoom) return oldZoom;
      setPan((oldPan) => ({
        x: centerX - ((centerX - oldPan.x) / oldZoom) * nextZoom,
        y: centerY - ((centerY - oldPan.y) / oldZoom) * nextZoom
      }));
      return nextZoom;
    });
  }

  useEffect(() => {
    function onCameraKeyDown(event) {
      const activeTarget = event.target;
      const tag = activeTarget?.tagName?.toLowerCase?.() || '';
      const isTextInput = tag === 'textarea' || tag === 'select' || (tag === 'input' && activeTarget.type !== 'range') || activeTarget?.isContentEditable;
      if (isTextInput) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const modalOpen = Boolean(aiReview || modifyModal || activateModal || actionChoiceRequest || devConsoleOpen || aiMissingReport || aiConfidenceReport || zoneBrowser || addCardModalOpen || responsePrompt);
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(key) && !modalOpen) {
        event.preventDefault();
        const step = event.shiftKey ? 150 : 82;
        if (key === 'w') setPan((value) => ({ ...value, y: value.y + step }));
        if (key === 's') setPan((value) => ({ ...value, y: value.y - step }));
        if (key === 'a') setPan((value) => ({ ...value, x: value.x + step }));
        if (key === 'd') setPan((value) => ({ ...value, x: value.x - step }));
        if (key === 'q') zoomAroundViewportCenter(-0.07);
        if (key === 'e') zoomAroundViewportCenter(0.07);
        return;
      }
      if (key === 't' && selection?.boardIds?.length) {
        event.preventDefault();
        const selectedId = selection.boardIds[0];
        const selectedCard = boardCards.find((card) => card.boardId === selectedId);
        if (!selectedCard || ['graveyard', 'exile', 'library'].includes(selectedCard.zone)) return;
        const targetIds = event.shiftKey
          ? boardCards
              .filter((card) => card.ownerSeat === selectedCard.ownerSeat && card.zone === selectedCard.zone && card.slot === selectedCard.slot && Number(card.stackIndex || 0) <= Number(selectedCard.stackIndex || 0))
              .map((card) => card.boardId)
          : [selectedId];
        setBoardCards((cards) => cards.map((card) => targetIds.includes(card.boardId) ? { ...card, tapped: true } : card));
        emit({ type: 'tap_cards', boardIds: targetIds, tapped: true });
        addGameNotice(event.shiftKey ? `Tapped ${targetIds.length} card(s) in stack through ${selectedCard.card.name}.` : `Tapped ${selectedCard.card.name}.`, selectedCard.ownerSeat);
      }
    }
    window.addEventListener('keydown', onCameraKeyDown);
    return () => window.removeEventListener('keydown', onCameraKeyDown);
  }, [aiReview, modifyModal, activateModal, devConsoleOpen, aiMissingReport, zoneBrowser, addCardModalOpen, responsePrompt, selection, boardCards]);


  useEffect(() => {
    if (aiReview || !aiReviewQueue.length) return;
    const [nextReview, ...rest] = aiReviewQueue;
    setAiReview(nextReview);
    setAiReviewQueue(rest);
  }, [aiReview, aiReviewQueue]);

  useEffect(() => {
    if (aiReview || aiReviewQueue.length || !pendingAiAfterReview) return;
    if (pendingAiAfterReview.type === 'combat') {
      const seat = pendingAiAfterReview.seat;
      setPendingAiAfterReview(null);
      setTimeout(() => runAiCombatOnly(seat), 250);
    } else if (pendingAiAfterReview.type === 'postcombat-main') {
      const seat = pendingAiAfterReview.seat;
      setPendingAiAfterReview(null);
      setTimeout(() => runAiSecondMainPhase(seat), 250);
    }
  }, [aiReview, aiReviewQueue.length, pendingAiAfterReview]);

  useEffect(() => {
    if (!aiReview || !shouldAutoApplyAiReview(aiReview)) return undefined;
    const plan = aiReview.plan;
    const action = aiReview.selectedAction || (plan?.actions || []).find((item) => canAutoApplyAiAction(item, aiReview.boardCard));
    if (!action) return undefined;
    const signature = `${aiReview.boardCard?.boardId || 'card'}:${aiReview.abilityIndex || 0}:${plan.cardKey}:${plan.confidence}:${action.abilityId || action.type}`;
    if (autoAiReviewRef.current === signature) return undefined;
    autoAiReviewRef.current = signature;
    const timer = setTimeout(() => {
      handleAiReview('approved', false, autoApprovalReason(plan), action, {
        responseWorthy: Boolean(plan.responseProfile?.responseWorthy),
        responseReason: plan.responseProfile?.responseWorthy ? `Auto-approved understanding at ${plan.confidence}% confidence: ${(plan.responseProfile.reasons || []).join('; ')}` : '',
        autoApproved: true,
        autoApplied: false,
        autoConfidence: plan.confidence
      });
    }, 140);
    return () => clearTimeout(timer);
  }, [aiReview]);


  function passPriority() {
    if (aiReview || pendingAiAfterStack?.reviewInProgress) {
      addGameNotice('Finish the AI learning check first. The priority prompt is being kept open underneath it.', localSeat);
      return;
    }
    if (!pendingAiAfterStack) {
      setResponsePrompt(null);
      return;
    }
    if (pendingAiAfterStack.type === 'ai-cast' && !pendingAiAfterStack.reviewComplete) {
      beginAiStackReviewBeforeResolve(pendingAiAfterStack);
      return;
    }
    resolveAiStackItem(pendingAiAfterStack);
  }

  function holdPriorityForManualResponse() {
    if (aiReview || pendingAiAfterStack?.reviewInProgress) {
      addGameNotice('Finish the AI learning check first. The priority prompt will stay available after it closes.', localSeat);
      return;
    }
    setResponsePrompt(null);
    addGameNotice('Priority held for manual response. Use Activate / cast an instant-speed card, then press Pass Priority in the stack panel when ready.', localSeat);
  }

  function toggleResponsePrompts() {
    const nextEnabled = !responsePromptsEnabled;
    setResponsePromptsEnabled(nextEnabled);
    addGameNotice(nextEnabled ? 'Response prompts enabled. The game will ask before opponent spells resolve when response options are detected.' : 'Response prompts disabled. Opponent spells will auto-pass priority unless an AI learning review is required.', localSeat);
    if (!nextEnabled && responsePrompt && pendingAiAfterStack && !aiReview && !pendingAiAfterStack.reviewInProgress) {
      setTimeout(() => passPriority(), 0);
    }
  }

  function priorityPromptForPendingAiCast(pending, reviewState = 'pending') {
    const cardName = pending?.boardCard?.card?.name || 'the AI spell';
    if (reviewState === 'reviewing') {
      return {
        type: 'spell-review',
        seat: pending?.seat,
        title: `Reviewing ${cardName} before it resolves`,
        message: 'Finish the AI learning check first. After that, priority will open so you can pass/resolve or use the future Bad Play undo path.',
        badPlayAvailable: false
      };
    }
    if (reviewState === 'reviewed') {
      return {
        type: 'spell-review',
        seat: pending?.seat,
        title: `${cardName} reviewed — ready to resolve`,
        message: 'The AI card understanding has been saved. Priority is now open; press Pass priority / resolve to finish resolving the spell.',
        badPlayAvailable: true
      };
    }
    return {
      type: 'spell',
      seat: pending?.seat,
      title: `P${pending?.seat} casts ${cardName}`,
      message: 'You have priority before this spell resolves.',
      badPlayAvailable: true
    };
  }

  function beginAiStackReviewBeforeResolve(pending) {
    if (!pending?.boardCard) return;
    const heldPending = { ...pending, reviewComplete: false, reviewInProgress: true };
    setPendingAiAfterStack(heldPending);
    setResponsePrompt(null);
    const queued = queueAiReviewForCard(heldPending.boardCard, heldPending.cardsSnapshot, heldPending.aiOverride, {
      note: 'Priority is held until this AI learning check finishes.',
      deferResolution: true,
      stackId: heldPending.stackId
    });
    if (!queued) {
      const reviewedPending = { ...heldPending, reviewComplete: true, reviewInProgress: false };
      setPendingAiAfterStack(reviewedPending);
      if (responsePromptsEnabled) {
        setResponsePrompt(priorityPromptForPendingAiCast(reviewedPending, 'reviewed'));
      } else {
        setResponsePrompt(null);
        publishAiThought(`Priority auto-pass is off for prompts: resolving ${reviewedPending.boardCard?.card?.name || 'AI spell'} after review.`, 'append', heldPending.seat);
        setTimeout(() => resolveAiStackItem(reviewedPending), 520);
      }
    }
  }

  function responseOptionsForSeat(seat, cardsSnapshot = boardCards) {
    const handCards = seat === localSeat ? hand : (aiStates[seat]?.hand || []);
    const handOptions = handCards
      .map((card) => ({ card, zone: 'hand', profile: getAiResponseProfile(card, aiBrain) }))
      .filter((item) => item.profile?.responseWorthy);
    const boardOptions = (cardsSnapshot || [])
      .filter((boardCard) => boardCard.ownerSeat === seat && ['creatures', 'artifacts', 'enchantments', 'mana'].includes(boardCard.zone))
      .map((boardCard) => {
        const activeSource = withActiveFaceCard(boardCard);
        return { card: activeSource.card, boardCard, zone: boardCard.zone, profile: buildAiCardPlan(activeSource.card, buildAiContext(seat, cardsSnapshot, seat === localSeat ? null : aiStates[seat], boardCard.boardId), aiBrain).responseProfile };
      })
      .filter((item) => item.profile?.responseWorthy);
    return [...handOptions, ...boardOptions];
  }

  function resolveAiSpellEffects(pending) {
    if (!pending?.boardCard || !isTransientSpell(pending.boardCard)) return { pausedForChoice: false };
    const activeSource = withActiveFaceCard(pending.boardCard);
    const plan = buildAiCardPlan(activeSource.card, buildAiContext(pending.boardCard.ownerSeat, pending.cardsSnapshot || boardCards, pending.aiOverride, pending.boardCard.boardId), aiBrain);
    const appliedAbilityIds = new Set();
    for (const action of plan.actions || []) {
      if (!AUTO_RESOLVE_ACTION_TYPES.has(action.type)) continue;
      if (action.conditionCheck?.met === false) continue;
      const abilityKey = action.abilityId || `${action.sourceText || action.effectText || action.label}`;
      if (appliedAbilityIds.has(abilityKey) && !['gain_life', 'lose_life', 'direct_damage', 'exile', 'destroy'].includes(action.type)) continue;
      const usableWithoutTarget = ['create_token', 'grant_trait', 'add_counters', 'draw', 'search_library', 'set_base_pt', 'gain_life', 'lose_life', 'set_life_total', 'direct_damage', 'mill', 'discard', 'put_from_hand_to_battlefield', 'return_from_graveyard_to_battlefield', 'move_to_battlefield', 'return_to_battlefield'].includes(action.type);
      if (isActionUsable(action, pending.boardCard) || usableWithoutTarget || actionNeedsChoice(action, pending.boardCard)) {
        appliedAbilityIds.add(abilityKey);
        const paused = applyOrPromptAction(action, pending.boardCard, {
          reason: 'Spell resolving from stack',
          afterChoice: { resumePendingStack: pending }
        });
        if (paused) return { pausedForChoice: true };
      }
    }
    return { pausedForChoice: false };
  }

  function finishResolvedSpellMovement(pending) {
    if (!pending?.boardCard) return;
    if (pending.resolveDestination === 'exile' && isTransientSpell(pending.boardCard)) {
      moveCardsDirectlyToZone([pending.boardCard.boardId], 'exile');
      addGameNotice(`Resolved spell moved to exile: ${pending.boardCard.card.name}.`, pending.boardCard.ownerSeat);
    } else {
      moveResolvedSpellToGraveyard(pending.boardCard);
    }
    fireWatchersForEvent({ id: safeId('spell-resolved'), type: 'spell_resolved', seat: pending.seat, card: pending.boardCard }, boardCards);
  }

  function resolveAiStackItem(pending) {
    if (!pending) return;
    if (pending.type === 'ai-cast' && !pending.reviewComplete) {
      beginAiStackReviewBeforeResolve(pending);
      return;
    }
    if (pending.stackId) {
      if (resolvingAiStackRef.current.has(pending.stackId)) return;
      resolvingAiStackRef.current.add(pending.stackId);
    }
    setPendingAiAfterStack(null);
    setResponsePrompt(null);
    setStackItems((items) => items.filter((item) => item.id !== pending.stackId));
    if (pending.type === 'ai-cast' || pending.type === 'player-cast') {
      const result = resolveAiSpellEffects(pending);
      if (result?.pausedForChoice) return;
      finishResolvedSpellMovement(pending);
      if (pending.type === 'ai-cast') {
        if (pending.afterResolve === 'end-turn') {
          setTimeout(() => advanceTurnFrom(pending.seat), 520);
        } else if (pending.afterResolve === 'postcombat-main') {
          setPendingAiAfterReview({ type: 'postcombat-main', seat: pending.seat });
        } else {
          setPendingAiAfterReview({ type: 'combat', seat: pending.seat });
        }
      }
    }
  }

  function clampZoom(value) {
    return Math.max(0.34, Math.min(1.75, Number(value) || 1));
  }

  function centerOnMyArea(nextZoom = zoom) {
    const rect = tableWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const safeZoom = clampZoom(nextZoom);
    const relMat = PLAYER_MATS[0];
    const focusX = TABLE_SIZE.width * (relMat.x + relMat.w * 0.50);
    const focusY = TABLE_SIZE.height * (relMat.y + relMat.h * 0.56);
    setZoom(safeZoom);
    setPan({
      x: Math.round(rect.width / 2 - focusX * safeZoom),
      y: Math.round(rect.height * 0.60 - focusY * safeZoom)
    });
  }

  function centerWholeTable() {
    const rect = tableWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fitZoom = clampZoom(Math.min((rect.width - 70) / TABLE_SIZE.width, (rect.height - 70) / TABLE_SIZE.height));
    setZoom(fitZoom);
    setPan({
      x: Math.round(rect.width / 2 - (TABLE_SIZE.width * fitZoom) / 2),
      y: Math.round(rect.height / 2 - (TABLE_SIZE.height * fitZoom) / 2)
    });
  }

  function zoomAroundClient(nextZoom, clientX, clientY) {
    const rect = tableWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const safeZoom = clampZoom(nextZoom);
    const wrapX = clientX - rect.left;
    const wrapY = clientY - rect.top;
    const worldX = (wrapX - pan.x) / zoom;
    const worldY = (wrapY - pan.y) / zoom;
    setZoom(safeZoom);
    setPan({
      x: Math.round(wrapX - worldX * safeZoom),
      y: Math.round(wrapY - worldY * safeZoom)
    });
  }

  function zoomFromCenter(nextZoom) {
    const rect = tableWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAroundClient(nextZoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function handleWheelZoom(event) {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const factor = direction > 0 ? 1.10 : 0.90;
    zoomAroundClient(zoom * factor, event.clientX, event.clientY);
  }

  function clearFloatingUi() {
    setTooltipCard(null);
    setHandPreviewCard(null);
    setBoardHoverPreviewCard(null);
    setSelection(null);
    setModifyModal(null);
    setActivateModal(null);
  }

  function addGameNotice(message, seat = null) {
    publishAiThought(message, 'append', seat);
  }

  function dismissToast(id) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function pushToast({ title, message = '', tone = 'info', seat = null, duration = 4400 } = {}) {
    const id = safeId('toast');
    const toast = { id, title: title || 'Table notice', message, tone, seat, at: Date.now() };
    setToasts((current) => [...current.slice(-4), toast]);
    const timer = setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
      toastTimersRef.current.delete(timer);
    }, duration);
    toastTimersRef.current.add(timer);
    return id;
  }

  function phaseToastCopy({ seat, label = '', step = '', message = '' } = {}) {
    const you = Number(seat) === Number(localSeat);
    const playerText = you ? 'You' : `Player ${seat || '?'}`;
    if (message) return message;
    if (/turn-start/i.test(step)) return you ? 'Your turn started. Untap, upkeep, draw, then play Main Phase 1.' : `${playerText}'s turn started.`;
    if (/untap/i.test(step)) return you ? 'Untap your permanents.' : `${playerText} is in untap.`;
    if (/upkeep/i.test(step)) return you ? 'Resolve upkeep triggers if any.' : `${playerText} is in upkeep.`;
    if (/draw/i.test(step)) return you ? 'Draw for turn.' : `${playerText} is in draw.`;
    if (/main2|postcombat/i.test(step)) return you ? 'Post-combat main phase. Make any second-main plays, then end turn.' : `${playerText} is in post-combat main phase.`;
    if (/block/i.test(step)) return you ? 'Opponent declared attackers. Declare blockers or respond.' : `${playerText} is declaring blockers.`;
    if (/combat/i.test(step)) return you ? 'Combat started. Choose attackers or continue to Main Phase 2.' : `${playerText} moved to combat.`;
    if (/main/i.test(step)) return you ? 'Main Phase 1. Make your plays.' : `${playerText} is in Main Phase 1.`;
    return label || 'Phase changed.';
  }

  function phaseToastTone(seat, step = '', tone = null) {
    if (tone) return tone;
    if (/combat|block/i.test(step)) return 'combat';
    if (/main2|postcombat/i.test(step)) return 'main2';
    if (Number(seat) === Number(localSeat)) return 'your-turn';
    return 'phase';
  }

  function pushPhaseToast({ seat, label, step = 'phase', message = '', tone = null, duration } = {}) {
    const you = Number(seat) === Number(localSeat);
    const title = /turn-start/i.test(step)
      ? (you ? `Your turn — ${label || `P${seat}`}` : `Player ${seat} turn`)
      : (label || `Player ${seat} phase`);
    return pushToast({
      title,
      message: phaseToastCopy({ seat, label, step, message }),
      tone: phaseToastTone(seat, step, tone),
      seat,
      duration: duration || (/combat|block|turn-start/i.test(step) ? 6200 : 3900)
    });
  }

  function queueTurnStartToasts(seat, nextTurn = turn, options = {}) {
    if (!seat) return;
    const steps = [
      { delay: 0, step: 'turn-start', label: `P${seat} Untap`, message: Number(seat) === Number(localSeat) ? `Turn ${nextTurn}: it is your turn.` : `Turn ${nextTurn}: Player ${seat}'s turn begins.` },
      { delay: 380, step: 'upkeep', label: `P${seat} Upkeep` },
      { delay: 760, step: 'draw', label: `P${seat} Draw` },
      { delay: 1140, step: 'main', label: `P${seat} Main Phase 1` }
    ];
    steps.forEach((entry) => {
      const timer = setTimeout(() => {
        setPhaseLabel(entry.label);
        pushPhaseToast({ seat, label: entry.label, step: entry.step, message: entry.message });
        toastTimersRef.current.delete(timer);
      }, options.initial ? entry.delay + 250 : entry.delay);
      toastTimersRef.current.add(timer);
    });
  }

  function announcePhase({ seat, label, step = 'phase', message = '', tone = null, emitRemote = true, duration } = {}) {
    if (label) setPhaseLabel(label);
    pushPhaseToast({ seat, label, step, message, tone, duration });
    if (emitRemote) emit({ type: 'phase_notice', seat, phaseLabel: label, step, message, tone, duration });
  }

  function startSecondMainPhase(seat, message = '') {
    announcePhase({
      seat,
      label: `P${seat} Main Phase 2`,
      step: 'main2',
      message: message || (Number(seat) === Number(localSeat) ? 'Combat finished. You are in Main Phase 2.' : `Player ${seat} is in Main Phase 2.`),
      tone: 'main2'
    });
  }

  function updateLifeTotal(seat, field, delta) {
    setLifeTotals((current) => ({
      ...current,
      [seat]: {
        ...(current[seat] || { life: STARTING_LIFE, infect: STARTING_INFECT, commander: 0 }),
        [field]: Math.max(0, Number(current[seat]?.[field] ?? (field === 'life' ? STARTING_LIFE : 0)) + Number(delta || 0))
      }
    }));
  }

  function setLifeTotalDirect(seat, field) {
    const currentValue = lifeTotals[seat]?.[field] ?? (field === 'life' ? STARTING_LIFE : 0);
    const next = prompt(`Set Player ${seat} ${field}`, String(currentValue));
    if (next == null) return;
    const value = Math.max(0, Number(next));
    if (!Number.isFinite(value)) return;
    setLifeTotals((current) => ({ ...current, [seat]: { ...(current[seat] || {}), [field]: value } }));
  }

  function resetAiCardLearning(boardCard) {
    if (!boardCard?.card) return;
    const activeBoardCard = withActiveFaceCard(boardCard);
    const key = getAiCardKey(activeBoardCard.card);
    const nextBrain = resetAiBrainCards(aiBrain, key);
    setAiBrain(nextBrain);
    const plan = buildAiCardPlan(activeBoardCard.card, buildAiContext(boardCard.ownerSeat), nextBrain);
    setAiReview({ boardCard: activeBoardCard, plan, note: 'Reset from dev console target command.' });
    setPendingAiResetTarget(false);
    addGameNotice(`AI reset target: cleared learned rules for ${boardCard.card.name} and reopened review.`, boardCard.ownerSeat);
  }

  function decksForAiMissingCommand(rawCommand) {
    const includeAll = /\ball\b/i.test(rawCommand);
    const seatMatch = rawCommand.match(/\b(?:p|player|seat)\s*([1-4])\b/i) || rawCommand.match(/\bp([1-4])\b/i);
    const addDeck = (list, seat) => {
      const deck = deckInfoBySeat[seat] || (seat === localSeat ? deckInfo : null);
      if (deck && !list.some((item) => item.seat === seat)) list.push({ seat, deck });
      return list;
    };
    if (includeAll) {
      return SEATS.reduce((list, seat) => addDeck(list, seat), []);
    }
    const targetSeat = seatMatch ? Number(seatMatch[1]) : Number(localSeat || 1);
    return addDeck([], targetSeat);
  }

  function openAiMissingActionReport(rawCommand) {
    const decks = decksForAiMissingCommand(rawCommand);
    if (!decks.length) {
      addGameNotice('Dev console: no loaded deck found for that missing-action scan. Try ai_missing after loading a deck, or ai_missing all after loading AI decks.', null);
      return;
    }
    let report;
    try {
      report = buildAiMissingActionReport({ command: rawCommand, decks, brain: aiBrain });
    } catch (error) {
      const errorText = error?.message || String(error || 'Unknown error');
      report = {
        command: rawCommand,
        generatedAt: new Date().toLocaleString(),
        pageSize: AI_MISSING_REPORT_PAGE_SIZE,
        decks: decks.map(({ seat, deck }) => ({
          seat,
          commanderName: deck?.commanderName || deck?.commander?.name || '',
          totalCards: Number(deck?.totalCards || deck?.cards?.length || 0),
          uniqueCards: 0
        })),
        totalCards: decks.reduce((sum, { deck }) => sum + Number(deck?.totalCards || deck?.cards?.length || 0), 0),
        totalUniqueCards: 0,
        missingAbilityCount: 1,
        scanErrorCount: 1,
        scanErrors: [{ seat: null, cardName: 'Report builder', stage: 'report build', error: errorText }],
        items: [{
          seat: null,
          seats: [],
          scanError: true,
          scanErrorStage: 'report build',
          scanErrorText: errorText,
          cardName: 'AI missing report crashed before card isolation',
          scryfallId: '',
          manaCost: '',
          manaValue: '',
          typeLine: '',
          oracleText: 'The report builder threw before it could isolate the exact card. Send this report page so the crash can be patched.',
          confidence: 0,
          baseConfidence: 0,
          learned: false,
          approvedCount: 0,
          rejectedCount: 0,
          confidenceReasons: ['Catastrophic report-builder error'],
          missingAbilities: [{ sourceText: 'Report builder crashed.', notes: [errorText] }],
          recognizedActions: []
        }]
      };
    }
    setAiMissingReport(report);
    const deckSeats = report.decks.map((deck) => `P${deck.seat}`).join(', ') || 'none';
    const errorText = report.scanErrorCount ? `, including ${report.scanErrorCount} scan error(s)` : '';
    addGameNotice(`Dev console: missing-action report scanned ${deckSeats}; ${report.items.length} card(s) need parser/common-action work${errorText}.`, null);
  }


  function openAiConfidenceReport(rawCommand) {
    const decks = decksForAiMissingCommand(rawCommand);
    if (!decks.length) {
      addGameNotice('Dev console: no loaded deck found for that confidence scan. Try ai_confidence after loading a deck, or ai_confidence all after loading AI decks.', null);
      return;
    }
    let report;
    try {
      report = buildAiConfidenceReport({ command: rawCommand, decks, brain: aiBrain, threshold: AI_AUTO_APPROVE_CONFIDENCE });
    } catch (error) {
      const errorText = error?.message || String(error || 'Unknown error');
      report = {
        command: rawCommand,
        generatedAt: new Date().toLocaleString(),
        pageSize: AI_MISSING_REPORT_PAGE_SIZE,
        threshold: AI_AUTO_APPROVE_CONFIDENCE,
        decks: decks.map(({ seat, deck }) => ({
          seat,
          commanderName: deck?.commanderName || deck?.commander?.name || '',
          totalCards: Number(deck?.totalCards || deck?.cards?.length || 0),
          uniqueCards: 0
        })),
        totalCards: decks.reduce((sum, { deck }) => sum + Number(deck?.totalCards || deck?.cards?.length || 0), 0),
        totalUniqueCards: 0,
        belowThresholdCount: 1,
        notAutoApprovedCount: 1,
        missingAbilityCount: 0,
        scanErrorCount: 1,
        scanErrors: [{ seat: null, cardName: 'Report builder', stage: 'confidence report build', error: errorText }],
        items: [{
          seat: null,
          seats: [],
          scanError: true,
          scanErrorStage: 'confidence report build',
          scanErrorText: errorText,
          cardName: 'AI confidence report crashed before card isolation',
          scryfallId: '',
          manaCost: '',
          manaValue: '',
          typeLine: '',
          oracleText: 'The confidence report builder threw before it could isolate the exact card. Send this report page so the crash can be patched.',
          confidence: 0,
          baseConfidence: 0,
          learned: false,
          approvedCount: 0,
          rejectedCount: 0,
          autoApproved: false,
          approvalIssues: [`Report builder crashed: ${errorText}`],
          confidenceReasons: ['Catastrophic confidence-report error'],
          abilityDiagnostics: [],
          recognizedActions: []
        }]
      };
    }
    setAiConfidenceReport(report);
    const deckSeats = report.decks.map((deck) => `P${deck.seat}`).join(', ') || 'none';
    const errorText = report.scanErrorCount ? `, including ${report.scanErrorCount} scan error(s)` : '';
    addGameNotice(`Dev console: confidence report scanned ${deckSeats}; ${report.items.length} card(s) are below auto-approval or blocked${errorText}.`, null);
  }

  function runDevCommand(commandOverride = null) {
    const raw = String(commandOverride ?? devCommand).trim();
    if (!raw) return;
    const normalized = raw.toLowerCase().replace(/\s+/g, ' ');
    if (normalized === 'ai_missing' || normalized.startsWith('ai_missing ') || normalized === 'ai report missing' || normalized.startsWith('ai report missing ')) {
      openAiMissingActionReport(raw);
      setDevCommand('');
      return;
    }
    if (normalized === 'ai_confidence' || normalized.startsWith('ai_confidence ') || normalized === 'ai_under90' || normalized.startsWith('ai_under90 ') || normalized === 'ai_low_confidence' || normalized.startsWith('ai_low_confidence ') || normalized === 'ai report confidence' || normalized.startsWith('ai report confidence ')) {
      openAiConfidenceReport(raw);
      setDevCommand('');
      return;
    }
    if (normalized === 'ai_reset all' || normalized === 'ai wipe all' || normalized === 'ai_wipe all') {
      const nextBrain = resetAiBrainCards(aiBrain, 'all');
      setAiBrain(nextBrain);
      setDevCommand('');
      addGameNotice('Dev console: wiped all AI learned card rules.', null);
      return;
    }
    if (normalized === 'ai_reset target' || normalized === 'ai wipe target' || normalized === 'ai_wipe target') {
      setPendingAiResetTarget(true);
      setDevCommand('');
      addGameNotice('Dev console: click the card whose AI rules should be reset and rechecked.', null);
      return;
    }
    const nameMatch = raw.match(/^ai[_ ]reset\s+(.+)$/i) || raw.match(/^ai[_ ]wipe\s+(.+)$/i);
    if (nameMatch) {
      const needle = nameMatch[1].trim().toLowerCase();
      const boardCard = boardCards.find((card) => String(card.card?.name || '').toLowerCase().includes(needle));
      if (boardCard) resetAiCardLearning(boardCard);
      else addGameNotice(`Dev console: no card on board matched "${nameMatch[1]}".`, null);
      setDevCommand('');
      return;
    }
    addGameNotice(`Unknown dev command: ${raw}`, null);
  }


  function removeLinkedModsForSources(sourceIds) {
    if (!sourceIds?.length) return;
    const idSet = new Set(sourceIds);
    setBoardCards((cards) => cards.map((card) => {
      const attachedSourceIds = (card.attachedSourceIds || []).filter((id) => !idSet.has(id));
      return {
        ...card,
        mods: (card.mods || []).filter((mod) => !(mod.duration === 'linked' && idSet.has(mod.sourceId))),
        attachedSourceIds,
        equippedBy: idSet.has(card.equippedBy) ? (attachedSourceIds[0] || undefined) : card.equippedBy,
        equippedTo: idSet.has(card.boardId) || idSet.has(card.equippedTo) ? undefined : card.equippedTo,
        attachedTo: idSet.has(card.boardId) || idSet.has(card.attachedTo) ? undefined : card.attachedTo
      };
    }));
  }

  function pruneBrokenAttachments(cards = []) {
    const byId = new Map((cards || []).map((card) => [card.boardId, card]));
    const brokenSourceIds = new Set();
    for (const source of cards || []) {
      const targetId = source.attachedTo || source.equippedTo;
      if (!targetId || !isAttachableBoardCard(source)) continue;
      const target = byId.get(targetId);
      const stillStacked = target
        && isBattlefieldZone(source.zone)
        && isBattlefieldZone(target.zone)
        && source.ownerSeat === target.ownerSeat
        && source.zone === target.zone
        && Number(source.slot || 0) === Number(target.slot || 0);
      if (!stillStacked) brokenSourceIds.add(source.boardId);
    }
    if (!brokenSourceIds.size) return cards;
    return (cards || []).map((card) => {
      const attachedSourceIds = (card.attachedSourceIds || []).filter((id) => !brokenSourceIds.has(id));
      const isBrokenSource = brokenSourceIds.has(card.boardId);
      return {
        ...card,
        mods: (card.mods || []).filter((mod) => !(mod.duration === 'linked' && brokenSourceIds.has(mod.sourceId))),
        attachedSourceIds,
        equippedBy: brokenSourceIds.has(card.equippedBy) ? (attachedSourceIds[0] || undefined) : card.equippedBy,
        equippedTo: isBrokenSource || brokenSourceIds.has(card.equippedTo) ? undefined : card.equippedTo,
        attachedTo: isBrokenSource || brokenSourceIds.has(card.attachedTo) ? undefined : card.attachedTo
      };
    });
  }

  function isEndOfTurnMod(mod = {}) {
    const duration = String(mod.duration || '').toLowerCase();
    return duration === 'eot' || /end[- ]of[- ]turn|until[- ]end[- ]of[- ]turn/.test(duration) || mod.untilEndOfTurn === true;
  }

  function clearEndOfTurnMods() {
    setBoardCards((cards) => cards.map((card) => ({
      ...card,
      mods: (card.mods || []).filter((mod) => !isEndOfTurnMod(mod))
    })));
  }

  function startTablePan(event) {
    if (dragging) return;
    if (event.target.closest('button, .board-card, .hand-card, .deck-stack, input, textarea, select, .radial-card-menu, .card-tooltip, .deck-import-modal, .modify-modal, .activate-modal, .ai-review-modal, .ai-missing-report-modal, .dev-console, .combat-modal, .life-tracker-panel, .zone-browser-modal, .add-card-modal, .zone-hotspot')) return;
    clearFloatingUi();
    event.preventDefault();
    panSessionRef.current = { startX: event.clientX, startY: event.clientY, baseX: pan.x, baseY: pan.y };
    tableWrapRef.current?.classList.add('is-panning');
    window.addEventListener('pointermove', onTablePanMove);
    window.addEventListener('pointerup', onTablePanEnd, { once: true });
  }

  function onTablePanMove(event) {
    const session = panSessionRef.current;
    if (!session) return;
    setPan({
      x: session.baseX + event.clientX - session.startX,
      y: session.baseY + event.clientY - session.startY
    });
  }

  function onTablePanEnd() {
    panSessionRef.current = null;
    tableWrapRef.current?.classList.remove('is-panning');
    window.removeEventListener('pointermove', onTablePanMove);
  }

  function emit(event) {
    sendGameEvent({ ...event, eventId: crypto.randomUUID(), sentAt: Date.now(), sentBy: playerId });
  }

  function emitDiceRoll(die = 'd20') {
    const seed = makeDiceSeed();
    const value = die === 'd100' ? 1 + Math.floor(((seededDieValue(seed, 100) - 1))) : seededDieValue(seed, getDieSidesCount(die));
    playDice3DRoll({ die, seed, seat: localSeat, cinematic: true });
    emit({ type: 'dice_roll', die, seed, value, seat: localSeat, purpose: 'bag' });
    addGameNotice(`Player ${localSeat} rolled ${die.toUpperCase()}${value ? `: ${value}` : ''}.`, localSeat);
  }

  function openDiceBag() {
    loadDice3D()
      .then((Dice3D) => {
        if (!Dice3D?.openBag) return;
        Dice3D.init?.({
          onRollRequest: ({ die, seed, value }) => {
            emit({ type: 'dice_roll', die, seed, value, seat: localSeat, purpose: 'bag' });
            addGameNotice(`Player ${localSeat} rolled ${String(die || '').toUpperCase()}${value ? `: ${value}` : ''}.`, localSeat);
          }
        });
        Dice3D.openBag();
      })
      .catch((error) => console.warn('[Dice3D] failed to open dice bag', error));
  }

  function addAiThoughtLines(lines, mode = 'append', seat = null) {
    const normalized = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).map((text) => String(text));
    if (!normalized.length) return;
    const stamped = normalized.map((text, index) => ({
      id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
      text,
      seat,
      at: Date.now()
    }));
    setAiThoughtLog((current) => mode === 'replace' ? stamped : [...current.slice(-140), ...stamped]);
  }

  function publishAiThought(lines, mode = 'append', seat = null) {
    addAiThoughtLines(lines, mode, seat);
    emit({ type: 'ai_notice', seat, lines: Array.isArray(lines) ? lines : [lines], mode });
  }

  function applyIncomingGameEvent(event) {
    if (event.type === 'drag_preview') {
      setRemoteDrags((current) => ({ ...current, [event.ownerSeat]: event }));
      return;
    }
    if (event.type === 'drag_clear') {
      setRemoteDrags((current) => {
        const next = { ...current };
        delete next[event.ownerSeat];
        return next;
      });
      return;
    }
    if (event.type === 'play_card') {
      setRemoteDrags((current) => {
        const next = { ...current };
        delete next[event.card.ownerSeat];
        return next;
      });
      setBoardCards((cards) => [...cards.filter((card) => card.boardId !== event.card.boardId), event.card]);
      if (event.card.ownerSeat !== localSeat) showReveal(event.card.card);
      return;
    }
    if (event.type === 'tap_cards') {
      setBoardCards((cards) => cards.map((card) => event.boardIds.includes(card.boardId) ? { ...card, tapped: event.tapped } : card));
      return;
    }
    if (event.type === 'ai_notice') {
      addAiThoughtLines(event.lines || [], event.mode || 'append', event.seat);
      return;
    }
    if (event.type === 'commander_tax') {
      setBoardCards((cards) => cards.map((card) => card.boardId === event.boardId ? { ...card, commanderTax: Math.max(0, Number(card.commanderTax || 0) + Number(event.delta || 0)) } : card));
      return;
    }
    if (event.type === 'move_to_zone') {
      setBoardCards((cards) => pruneBrokenAttachments(cards.map((card) => event.boardIds.includes(card.boardId) ? { ...card, zone: event.zone, tapped: false } : card)));
      return;
    }
    if (event.type === 'transform_card') {
      setBoardCards((cards) => cards.map((card) => card.boardId === event.boardId ? { ...card, activeFaceIndex: event.activeFaceIndex || 0, transformedAt: event.transformedAt || Date.now(), transforming: true } : card));
      setTimeout(() => setBoardCards((cards) => cards.map((card) => card.boardId === event.boardId ? { ...card, transforming: false } : card)), 640);
      return;
    }
    if (event.type === 'reposition_cards') {
      setBoardCards((cards) => {
        const map = new Map(cards.map((card) => [card.boardId, card]));
        event.cards.forEach((card) => map.set(card.boardId, card));
        return pruneBrokenAttachments(Array.from(map.values()));
      });
      return;
    }
    if (event.type === 'remove_board_cards') {
      setBoardCards((cards) => pruneBrokenAttachments(cards.filter((card) => !event.boardIds.includes(card.boardId))));
      return;
    }
    if (event.type === 'turn_update') {
      const nextSeat = Number(event.activeSeat || 1);
      setTurn(event.turn);
      setActiveSeat(nextSeat);
      setPhaseLabel(event.phaseLabel || turnStartPhaseLabel(nextSeat));
      setCombatState({ phase: 'main', attackers: [], blockers: [], warnings: [], summary: null, attackingSeat: null, defendingSeat: null, pendingBlockerId: null });
      setResponsePrompt(null);
      if (nextSeat === localSeat) setLandPlayedThisTurn(false);
      if (event.sentBy !== playerId) queueTurnStartToasts(nextSeat, event.turn);
      return;
    }
    if (event.type === 'phase_notice') {
      if (event.phaseLabel) setPhaseLabel(event.phaseLabel);
      if (event.sentBy !== playerId) {
        pushPhaseToast({
          seat: event.seat,
          label: event.phaseLabel || `P${event.seat || '?'} Phase`,
          step: event.step || 'phase',
          message: event.message || event.detail || '',
          tone: event.tone || null,
          duration: event.duration || undefined
        });
      }
      return;
    }
    if (event.type === 'dice_roll') {
      playDice3DRoll({ die: event.die || 'd20', seed: event.seed, seat: event.seat, cinematic: true });
      addGameNotice(`Player ${event.seat} rolled ${String(event.die || 'die').toUpperCase()}${event.value ? `: ${event.value}` : ''}.`, event.seat);
    }
  }

  function showReveal(card) {
    setPreviewCard(card);
    setTimeout(() => setPreviewCard(null), 1350);
  }


  function normalizeTokenSearchCard(raw, token, exact = false) {
    const image = raw.image_uris?.normal || raw.image_uris?.large || raw.card_faces?.[0]?.image_uris?.normal || raw.card_faces?.[0]?.image_uris?.large || null;
    return {
      scryfallId: raw.id || `token-${Date.now()}`,
      name: exact ? (raw.name || token.name || 'Token') : `Custom ${token.power || '?'}/${token.toughness || '?'} ${token.name || 'Token'}`,
      typeLine: raw.type_line || `${token.name || ''} Token Creature`.trim(),
      oracleText: exact ? (raw.oracle_text || '') : `Custom fallback token. Intended token: ${token.power || '?'}/${token.toughness || '?'} ${token.name || 'Token'}. Closest Scryfall image used when available.`,
      manaCost: '',
      manaValue: 0,
      power: exact ? (raw.power || token.power || '') : (token.power || raw.power || ''),
      toughness: exact ? (raw.toughness || token.toughness || '') : (token.toughness || raw.toughness || ''),
      image,
      colors: raw.colors || token.colors || [],
      customToken: !exact
    };
  }

  async function findScryfallTokenFor(token = {}) {
    const tokenName = String(token.name || 'Token').replace(/ token$/i, '').trim() || 'Token';
    const query = `type:token type:creature ${tokenName}`;
    try {
      const response = await fetch(`https://api.scryfall.com/cards/search?unique=cards&order=released&q=${encodeURIComponent(query)}`);
      if (!response.ok) return null;
      const data = await response.json();
      const choices = data.data || [];
      if (!choices.length) return null;
      const exact = choices.find((card) => {
        const type = `${card.name || ''} ${card.type_line || ''}`.toLowerCase();
        const nameOk = type.includes(tokenName.toLowerCase());
        const ptOk = (!token.power || String(card.power || '') === String(token.power)) && (!token.toughness || String(card.toughness || '') === String(token.toughness));
        return nameOk && ptOk;
      });
      return normalizeTokenSearchCard(exact || choices[0], token, Boolean(exact));
    } catch {
      return null;
    }
  }

  function getZoneCenterPoint(ownerSeat, zone) {
    const rel = relativeSeat(ownerSeat, localSeat);
    const rect = ZONE_RECTS[zone] || ZONE_RECTS.library;
    return localMatToPoint(rel, rect.x + rect.w * 0.5, rect.y + rect.h * 0.55);
  }

  function getOpponentHandPoint(seat) {
    const rel = relativeSeat(seat, localSeat);
    const local = rel === 0 ? { u: 0.5, v: 1.04 } : rel === 2 ? { u: 0.5, v: -0.045 } : rel === 1 ? { u: 0.5, v: -0.045 } : { u: 0.5, v: -0.045 };
    return localMatToPoint(rel, local.u, local.v);
  }

  function animateAiHiddenMove(seat, zone, revealCard = null) {
    const from = getOpponentHandPoint(seat);
    const to = getZoneCenterPoint(seat, zone);
    setAiCardAnim({ id: crypto.randomUUID(), seat, from, to, revealCard });
    setTimeout(() => setAiCardAnim(null), revealCard ? 1040 : 760);
  }

  function getClientPointFromTablePoint(point) {
    const rect = tableRef.current?.getBoundingClientRect();
    if (!rect) return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
    return { x: rect.left + point.x * rect.width, y: rect.top + point.y * rect.height };
  }

  function getHandTargetPoint() {
    const rect = handDockRef.current?.getBoundingClientRect();
    if (!rect) return { x: window.innerWidth * 0.5, y: window.innerHeight - 110 };
    return { x: rect.left + rect.width * 0.52, y: rect.top + rect.height * 0.68 };
  }

  function drawCard(animated = true) {
    const currentLibrary = libraryRef.current?.length ? libraryRef.current : library;
    if (!currentLibrary.length) return;
    const topCard = currentLibrary[0];
    const nextLibrary = currentLibrary.slice(1);
    // Remove the card from the real draw queue immediately, before any animation starts.
    // This makes rapid deck clicks draw the next unique card instead of reusing the stale top card.
    libraryRef.current = nextLibrary;
    setLibrary(nextLibrary);

    const commitDraw = () => {
      setHand((cards) => [...cards, topCard]);
      fireWatchersForEvent({ id: safeId('draw'), type: 'card_drawn', seat: localSeat, count: 1, cardDrawn: topCard }, boardCards);
    };
    if (animated) {
      const animId = crypto.randomUUID();
      const fromTable = getZoneCenterPoint(localSeat, 'library');
      const fromClient = getClientPointFromTablePoint(fromTable);
      const handTarget = getHandTargetPoint();
      setDrawAnims((items) => [...items, { id: animId, card: topCard, from: fromClient, to: handTarget }]);
      const commitTimer = setTimeout(() => {
        drawAnimTimersRef.current.delete(commitTimer);
        commitDraw();
      }, 780);
      const clearTimer = setTimeout(() => {
        drawAnimTimersRef.current.delete(clearTimer);
        setDrawAnims((items) => items.filter((item) => item.id !== animId));
      }, 900);
      drawAnimTimersRef.current.add(commitTimer);
      drawAnimTimersRef.current.add(clearTimer);
      return;
    }
    commitDraw();
  }

  function startDragFromHand(card, index, event) {
    event.preventDefault();
    event.stopPropagation();
    const point = getTablePoint(event.clientX, event.clientY);
    const nextDrag = { source: 'hand', card, handIndex: index, point };
    draggingRef.current = nextDrag;
    setDragging(nextDrag);
    emit({ type: 'drag_preview', ownerSeat: localSeat, canonical: viewToCanonical(point, localSeat) });
    window.addEventListener('pointermove', onWindowDragMove);
    window.addEventListener('pointerup', onWindowDragEnd, { once: true });
    window.addEventListener('pointercancel', onWindowDragCancel, { once: true });
  }

  function onWindowDragMove(event) {
    const current = draggingRef.current;
    if (!current) return;
    const point = getTablePoint(event.clientX, event.clientY);
    emit({ type: 'drag_preview', ownerSeat: localSeat, canonical: viewToCanonical(point, localSeat) });
    const nextDrag = { ...current, point };
    draggingRef.current = nextDrag;
    setDragging(nextDrag);
  }

  function clearHandDragListeners() {
    window.removeEventListener('pointermove', onWindowDragMove);
    window.removeEventListener('pointerup', onWindowDragEnd);
    window.removeEventListener('pointercancel', onWindowDragCancel);
  }

  function onWindowDragCancel() {
    clearHandDragListeners();
    draggingRef.current = null;
    setDragging(null);
    emit({ type: 'drag_clear', ownerSeat: localSeat });
  }

  function onWindowDragEnd(event) {
    clearHandDragListeners();
    const current = draggingRef.current;
    draggingRef.current = null;
    setDragging(null);
    if (!current) {
      emit({ type: 'drag_clear', ownerSeat: localSeat });
      return;
    }
    const point = getTablePoint(event.clientX, event.clientY);
    const zone = getZoneFromPoint(point);
    emit({ type: 'drag_clear', ownerSeat: localSeat });
    if (zone) playCardToZone(current.card, current.handIndex, zone, point);
  }

  function startBoardCardPointer(boardCard, event) {
    if (boardCard.ownerSeat !== localSeat && !debugHasAi) return;
    event.preventDefault();
    event.stopPropagation();
    const selectedIds = selection?.boardIds?.includes(boardCard.boardId) && selection.boardIds.length > 1
      ? selection.boardIds
      : boardIdsForStackDrag(boardCard);
    boardPointerRef.current = {
      boardCard,
      boardIds: selectedIds,
      startX: event.clientX,
      startY: event.clientY,
      draggingStarted: false
    };
    window.addEventListener('pointermove', onBoardPointerMove);
    window.addEventListener('pointerup', onBoardPointerUp, { once: true });
  }

  function onBoardPointerMove(event) {
    const session = boardPointerRef.current;
    if (!session) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    const distance = Math.hypot(dx, dy);
    const point = getTablePoint(event.clientX, event.clientY);
    if (!session.draggingStarted && distance > 8) {
      session.draggingStarted = true;
      const cards = boardCards.filter((card) => session.boardIds.includes(card.boardId));
      setDragging({
        source: 'board',
        boardIds: session.boardIds,
        card: session.boardCard.card,
        cards,
        point,
        lifting: true
      });
      requestAnimationFrame(() => {
        setDragging((current) => current ? { ...current, lifting: false } : current);
      });
    }
    if (session.draggingStarted) {
      emit({ type: 'drag_preview', ownerSeat: localSeat, canonical: viewToCanonical(point, localSeat) });
      setDragging((current) => current ? { ...current, point } : current);
    }
  }

  function onBoardPointerUp(event) {
    window.removeEventListener('pointermove', onBoardPointerMove);
    const session = boardPointerRef.current;
    boardPointerRef.current = null;
    if (!session) return;
    const hadDrag = session.draggingStarted;
    if (!hadDrag) {
      suppressNextBoardClick.current = true;
      setTimeout(() => { suppressNextBoardClick.current = false; }, 0);
      handleBoardCardClick(session.boardCard);
      return;
    }
    const target = getDropTarget(event.clientX, event.clientY);
    if (target?.type === 'hand') {
      returnBoardCardsToHand(session.boardIds);
    } else if (target?.type === 'zone' && target.zone === 'library') {
      putBoardCardsIntoLibrary(session.boardIds);
    } else if (target?.type === 'zone') {
      const movingCards = boardCards.filter((card) => session.boardIds.includes(card.boardId));
      if (movingCards.length === 1 && isAttachableBoardCard(movingCards[0])) {
        const attachTarget = findAttachDropTargetAtPoint(target.point, movingCards[0]);
        if (attachTarget) {
          attachEquipmentOrAuraToTarget(movingCards[0], attachTarget, {
            type: isEquipmentBoardCard(movingCards[0]) ? 'equip' : 'attach_permanent',
            sourceText: 'Manual drag/drop attachment',
            effectText: `Attach ${movingCards[0].card?.name || 'this card'} to ${attachTarget.card?.name || 'target creature'}`,
            manualDragAttach: true
          });
          setDragging(null);
          emit({ type: 'drag_clear', ownerSeat: localSeat });
          return;
        }
      }
      moveBoardSelectionToZone(session.boardIds, target.zone, target.point, target.ownerSeat);
    }
    setDragging(null);
    emit({ type: 'drag_clear', ownerSeat: localSeat });
  }

  function getTablePoint(clientX, clientY) {
    const rect = tableRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0.5, y: 0.5 };
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    };
  }

  function getDropTarget(clientX, clientY) {
    const handBandTop = window.innerHeight - 250;
    if (clientY >= handBandTop) return { type: 'hand' };
    const point = getTablePoint(clientX, clientY);
    const target = getZoneTargetFromPoint(point);
    if (target) return { type: 'zone', ...target, point };
    return null;
  }

  function getZoneTargetFromPoint(point) {
    for (const seat of SEATS) {
      if (!players[seat]) continue;
      const rel = relativeSeat(seat, localSeat);
      const local = pointToLocalMat(point, rel);
      if (!local) continue;
      for (const zone of ALL_ZONES) {
        const rect = ZONE_RECTS[zone.id];
        if (local.u >= rect.x && local.u <= rect.x + rect.w && local.v >= rect.y && local.v <= rect.y + rect.h) return { ownerSeat: seat, zone: zone.id };
      }
    }
    return null;
  }

  function getZoneFromPoint(point) {
    return getZoneTargetFromPoint(point)?.zone || null;
  }

  function nextSlot(ownerSeat, zone, cardToPlace = null) {
    const cards = boardCards.filter((card) => card.ownerSeat === ownerSeat && card.zone === zone);
    if (MANAGED_PILE_ZONES.includes(zone)) {
      return { slot: 0, stackIndex: cards.length };
    }
    const isStackableNamedPermanent = cardToPlace && ['mana', 'artifacts', 'enchantments'].includes(zone);
    if (isStackableNamedPermanent) {
      const sameName = cards.filter((card) => String(card.card?.name || '').toLowerCase() === String(cardToPlace.name || '').toLowerCase());
      if (sameName.length) {
        const targetSlot = sameName[0].slot || 0;
        const nextStackIndex = sameName.reduce((max, item) => Math.max(max, Number(item.stackIndex || 0)), -1) + 1;
        return { slot: targetSlot, stackIndex: nextStackIndex };
      }
    }
    const slotCounts = new Map();
    cards.forEach((card) => slotCounts.set(card.slot, (slotCounts.get(card.slot) || 0) + 1));
    for (let slot = 0; slot < 64; slot += 1) if (!slotCounts.has(slot)) return { slot, stackIndex: 0 };
    return { slot: cards.length % 64, stackIndex: slotCounts.get(cards.length % 64) || 0 };
  }


  function manualTableSlotInfo(ownerSeat) {
    const tableZone = 'creatures';
    const sameZone = boardCards.filter((card) => card.ownerSeat === ownerSeat && card.zone === tableZone);
    const occupied = new Set(sameZone.map((card) => Number(card.slot || 0)));
    for (let slot = 31; slot >= 0; slot -= 1) {
      if (!occupied.has(slot)) return { zone: tableZone, slot, stackIndex: 0 };
    }
    const fallback = nextSlot(ownerSeat, tableZone);
    return { zone: tableZone, ...fallback };
  }

  function cardsInSameVisibleStack(boardCard, cards = boardCards) {
    if (!boardCard) return [];
    const sourceSlot = Number(boardCard.slot || 0);
    return (cards || [])
      .filter((card) => card.ownerSeat === boardCard.ownerSeat)
      .filter((card) => card.zone === boardCard.zone)
      .filter((card) => Number(card.slot || 0) === sourceSlot)
      .sort((a, b) => Number(a.stackIndex || 0) - Number(b.stackIndex || 0));
  }

  function boardIdsForStackDrag(boardCard, cards = boardCards) {
    if (!boardCard || MANAGED_PILE_ZONES.includes(boardCard.zone)) return boardCard?.boardId ? [boardCard.boardId] : [];
    const startIndex = Number(boardCard.stackIndex || 0);
    const stack = cardsInSameVisibleStack(boardCard, cards);
    const splitStack = stack.filter((card) => Number(card.stackIndex || 0) >= startIndex);
    return splitStack.length ? splitStack.map((card) => card.boardId) : [boardCard.boardId];
  }

  function getDropSlotIndex(ownerSeat, zone, point) {
    const rel = relativeSeat(ownerSeat, localSeat);
    const local = pointToLocalMat(point, rel);
    const rect = ZONE_RECTS[zone] || ZONE_RECTS.holding;
    if (!local) return 0;
    const layout = {
      creatures: { cols: 16, startX: 0.035, endX: 0.965, startY: 0.27, rowGap: 0.36, maxRows: 2 },
      artifacts: { cols: 7, startX: 0.065, endX: 0.935, startY: 0.36, rowGap: 0.46, maxRows: 2 },
      enchantments: { cols: 7, startX: 0.065, endX: 0.935, startY: 0.36, rowGap: 0.46, maxRows: 2 },
      mana: { cols: 16, startX: 0.035, endX: 0.965, startY: 0.35, rowGap: 0.43, maxRows: 2 },
      holding: { cols: 1, startX: 0.50, endX: 0.50, startY: 0.18, rowGap: 0.16, maxRows: 8 },
      command: { cols: 1, startX: 0.50, endX: 0.50, startY: 0.50, rowGap: 0.25, maxRows: 1 },
      library: { cols: 1, startX: 0.50, endX: 0.50, startY: 0.54, rowGap: 0.25, maxRows: 1 },
      exile: { cols: 1, startX: 0.50, endX: 0.50, startY: 0.50, rowGap: 0.25, maxRows: 1 },
      graveyard: { cols: 1, startX: 0.50, endX: 0.50, startY: 0.50, rowGap: 0.25, maxRows: 1 }
    }[zone] || { cols: 1, startX: 0.50, endX: 0.50, startY: 0.50, rowGap: 0.25, maxRows: 1 };
    const u = (local.u - rect.x) / rect.w;
    const v = (local.v - rect.y) / rect.h;
    const colRatio = layout.cols <= 1 ? 0 : Math.max(0, Math.min(1, (u - layout.startX) / Math.max(0.001, (layout.endX - layout.startX))));
    const col = layout.cols <= 1 ? 0 : Math.round(colRatio * (layout.cols - 1));
    const row = Math.max(0, Math.min(layout.maxRows - 1, Math.round(Math.max(0, (v - layout.startY)) / Math.max(0.001, layout.rowGap))));
    return row * layout.cols + col;
  }

  function firstOpenSlotAtOrAfter(ownerSeat, zone, preferredSlot, ignoredBoardIds = new Set()) {
    const ignored = ignoredBoardIds instanceof Set ? ignoredBoardIds : new Set(ignoredBoardIds || []);
    const sameZone = boardCards.filter((card) => card.ownerSeat === ownerSeat && card.zone === zone && !ignored.has(card.boardId));
    const occupied = new Set(sameZone.map((card) => card.slot));
    for (let slot = preferredSlot; slot < 48; slot += 1) if (!occupied.has(slot)) return slot;
    for (let slot = 0; slot < preferredSlot; slot += 1) if (!occupied.has(slot)) return slot;
    return preferredSlot;
  }

  function slotInfoFromDropPoint(ownerSeat, zone, point, ignoredBoardIds = new Set()) {
    const ignored = ignoredBoardIds instanceof Set ? ignoredBoardIds : new Set(ignoredBoardIds || []);
    if (MANAGED_PILE_ZONES.includes(zone)) {
      const count = boardCards.filter((card) => card.ownerSeat === ownerSeat && card.zone === zone && !ignored.has(card.boardId)).length;
      return { slot: 0, stackIndex: count };
    }
    if (point) {
      const sameZone = boardCards.filter((card) => card.ownerSeat === ownerSeat && card.zone === zone && !ignored.has(card.boardId));
      for (const card of sameZone) {
        const cardPoint = getBoardPoint(card, localSeat, boardCards);
        const overlapX = Math.abs(cardPoint.x - point.x) <= BOARD_CARD_NORM_WIDTH * 0.52;
        const overlapY = Math.abs(cardPoint.y - point.y) <= BOARD_CARD_NORM_HEIGHT * 0.52;
        if (overlapX && overlapY) {
          const stackIndex = sameZone
            .filter((item) => item.slot === card.slot)
            .reduce((max, item) => Math.max(max, item.stackIndex || 0), -1) + 1;
          return { slot: card.slot, stackIndex };
        }
      }
      const preferredSlot = getDropSlotIndex(ownerSeat, zone, point);
      const openSlot = firstOpenSlotAtOrAfter(ownerSeat, zone, preferredSlot, ignored);
      return { slot: openSlot, stackIndex: 0 };
    }
    return nextSlot(ownerSeat, zone);
  }

  function findAttachDropTargetAtPoint(point, sourceBoardCard) {
    if (!point || !sourceBoardCard || !isAttachableBoardCard(sourceBoardCard)) return null;
    const candidates = boardCards
      .filter((card) => card.boardId !== sourceBoardCard.boardId)
      .filter((card) => card.ownerSeat === sourceBoardCard.ownerSeat)
      .filter((card) => isBattlefieldZone(card.zone) && isCreatureBoardCard(card))
      .map((card) => {
        const cardPoint = getBoardPoint(card, localSeat, boardCards);
        const dx = Math.abs(cardPoint.x - point.x);
        const dy = Math.abs(cardPoint.y - point.y);
        return { card, dx, dy, distance: Math.hypot(dx / BOARD_CARD_NORM_WIDTH, dy / BOARD_CARD_NORM_HEIGHT) };
      })
      .filter((item) => item.dx <= BOARD_CARD_NORM_WIDTH * 0.62 && item.dy <= BOARD_CARD_NORM_HEIGHT * 0.62)
      .sort((a, b) => a.distance - b.distance || Number(b.card.stackIndex || 0) - Number(a.card.stackIndex || 0));
    return candidates[0]?.card || null;
  }

  function playCardToZone(card, handIndex, zone, point = null) {
    setHandPreviewCard(null);
    setTooltipCard(null);
    setSelection(null);
    const actualZone = zone || likelyZoneForCard(card);
    if (actualZone === 'mana' && isLand(card) && landPlayedThisTurn) {
      const yes = confirm('You already played a land this turn. Play it anyway?');
      if (!yes) return;
    }
    if (actualZone === 'mana' && isLand(card)) setLandPlayedThisTurn(true);
    const slotInfo = slotInfoFromDropPoint(localSeat, actualZone, point);
    const boardCard = {
      boardId: crypto.randomUUID(),
      ownerSeat: localSeat,
      originalOwnerSeat: localSeat,
      controllerSeat: localSeat,
      zone: actualZone,
      slot: slotInfo.slot,
      stackIndex: slotInfo.stackIndex,
      tapped: aiCardEntersTapped(card),
      activeFaceIndex: cardHasAlternateFaces(card) ? 0 : undefined,
      card,
      mods: [],
      savedActivations: [],
      enteredTurn: turn,
      controlledSinceTurn: turn,
      controlledSinceStartOfTurn: false,
      playedAt: Date.now()
    };
    setHandPreviewCard(null);
    setTooltipCard(null);
    setSelection(null);
    const nextBoardSnapshot = [...boardCards, boardCard];
    const nextHandSnapshot = hand.filter((_, i) => i !== handIndex);
    setHand(nextHandSnapshot);
    setBoardCards(nextBoardSnapshot);
    showReveal(card);
    emit({ type: 'play_card', card: boardCard });
    const castEvent = { id: safeId('cast'), type: isLand(card) ? 'land_played' : 'spell_cast', seat: localSeat, card: boardCard, isLandPlay: isLand(card) };
    if (!isLand(card)) fireWatchersForEvent(castEvent, nextBoardSnapshot);
    if (isTransientSpell(boardCard)) {
      const stackId = crypto.randomUUID();
      const pending = { type: 'player-cast', seat: localSeat, stackId, boardCard, cardsSnapshot: nextBoardSnapshot, reviewComplete: true };
      setStackItems((items) => [...items, { id: stackId, seat: localSeat, cardName: card.name, cardImage: card.image, label: `${card.name} on the stack` }]);
      setPendingAiAfterStack(pending);
      const queuedReview = queueAiReviewForCard(boardCard, nextBoardSnapshot, { hand: nextHandSnapshot, library }, { note: 'Player-played instant/sorcery review.', silent: true, deferResolution: true, stackId });
      if (queuedReview) {
        if (responsePromptsEnabled) {
          setResponsePrompt({ type: 'spell-review', seat: localSeat, title: `Reviewing ${card.name} before it resolves`, message: 'Finish the AI learning check first. Then resolve this spell when ready.', badPlayAvailable: false });
        } else {
          setResponsePrompt(null);
          addGameNotice(`${card.name}: response prompts are off. Resolve after any required AI learning check without asking for priority.`, localSeat);
        }
      } else if (responsePromptsEnabled) {
        setResponsePrompt({ type: 'spell', seat: localSeat, title: `P${localSeat} casts ${card.name}`, message: 'You have priority before this spell resolves. Press Pass priority / resolve when responses are done.', badPlayAvailable: true });
      } else {
        setResponsePrompt(null);
        addGameNotice(`${card.name}: response prompts are off, so priority auto-passes and the spell resolves.`, localSeat);
        setTimeout(() => resolveAiStackItem(pending), 180);
      }
    } else {
      queueAiReviewForCard(boardCard, nextBoardSnapshot, { hand: nextHandSnapshot, library }, { note: 'Player-played permanent review.' });
      autoResolveCardOnEntry(boardCard, nextBoardSnapshot);
    }
  }


  function addManualScryfallCardToField(card, options = {}) {
    if (!card) return;
    const targetSeat = Number(localSeat || options.seat || 1);
    const requestedZone = options.zone || 'table';
    const manualCard = { ...card, instanceId: crypto.randomUUID() };
    if (requestedZone === 'hand') {
      if (targetSeat === localSeat) setHand((cards) => [...cards, manualCard]);
      else setAiStates((currentAll) => {
        const current = currentAll[targetSeat] || { hand: [], library: [], graveyard: [], exile: [] };
        return { ...currentAll, [targetSeat]: { ...current, hand: [...(current.hand || []), manualCard] } };
      });
      showReveal(manualCard);
      addGameNotice(`Add menu: added ${manualCard.name} to Player ${targetSeat} hand.`, targetSeat);
      return;
    }
    const tablePlacement = requestedZone === 'table' ? manualTableSlotInfo(targetSeat) : null;
    const actualZone = tablePlacement?.zone || requestedZone;
    const slotInfo = tablePlacement || nextSlot(targetSeat, actualZone, manualCard);
    const boardCard = {
      boardId: crypto.randomUUID(),
      ownerSeat: targetSeat,
      originalOwnerSeat: targetSeat,
      controllerSeat: targetSeat,
      zone: actualZone,
      slot: slotInfo.slot,
      stackIndex: slotInfo.stackIndex,
      tapped: requestedZone === 'table' ? Boolean(options.tapped) : false,
      activeFaceIndex: cardHasAlternateFaces(manualCard) ? 0 : undefined,
      card: manualCard,
      mods: [],
      savedActivations: [],
      manualAdded: true,
      enteredTurn: turn,
      controlledSinceTurn: turn,
      controlledSinceStartOfTurn: false,
      playedAt: Date.now()
    };
    setBoardCards((cards) => [...cards, boardCard]);
    emit({ type: 'play_card', card: boardCard });
    showReveal(manualCard);
    setSelection({ anchorId: boardCard.boardId, mode: 'single', boardIds: [boardCard.boardId] });
    addGameNotice(`Add menu: added ${manualCard.name} to Player ${targetSeat} ${requestedZone === 'table' ? 'table' : actualZone}.`, targetSeat);
  }

  function handleBoardCardClick(boardCard) {
    setHandPreviewCard(null);
    setTooltipCard({ card: getActiveCardForBoard(boardCard), boardCard });
    if (pendingAiResetTarget) {
      resetAiCardLearning(boardCard);
      return;
    }
    if (combatState.phase === 'combat-blockers') {
      const attackers = boardCards.filter((card) => combatState.attackers.includes(card.boardId));
      const pendingBlocker = boardCards.find((card) => card.boardId === combatState.pendingBlockerId);
      if (combatState.attackers.includes(boardCard.boardId) && pendingBlocker) {
        const legality = canCreatureBlockForUi(pendingBlocker, boardCard);
        if (legality.legal === false) {
          alert(`Possible illegal blocker: ${pendingBlocker.card.name}
Reason: ${legality.reason}`);
          return;
        }
        if (legality.legal === 'warn') {
          const override = confirm(`Possible illegal block for ${pendingBlocker.card.name}: ${legality.reason}. Override and assign it as a blocker?`);
          if (!override) return;
        }
        setCombatState((current) => ({
          ...current,
          pendingBlockerId: null,
          blockers: [
            ...(current.blockers || []).filter((item) => item.blockerId !== pendingBlocker.boardId),
            { attackerId: boardCard.boardId, attackerName: boardCard.card?.name || 'Attacker', blockerId: pendingBlocker.boardId, blockerName: pendingBlocker.card?.name || 'Blocker', reason: `Manual block: ${pendingBlocker.card?.name || 'Blocker'} blocks ${boardCard.card?.name || 'attacker'}` }
          ]
        }));
        setSelection((current) => ({ anchorId: pendingBlocker.boardId, mode: 'blockers', boardIds: [...new Set([...(current?.boardIds || []), pendingBlocker.boardId])] }));
        addGameNotice(`${pendingBlocker.card?.name || 'Blocker'} assigned to block ${boardCard.card?.name || 'attacker'}.`, localSeat);
        return;
      }
      if (boardCard.ownerSeat === localSeat && boardCard.zone === 'creatures') {
        const existing = (combatState.blockers || []).find((item) => item.blockerId === boardCard.boardId);
        if (existing) {
          setCombatState((current) => ({ ...current, blockers: (current.blockers || []).filter((item) => item.blockerId !== boardCard.boardId), pendingBlockerId: null }));
          setSelection((current) => ({ anchorId: boardCard.boardId, mode: 'blockers', boardIds: (current?.boardIds || []).filter((id) => id !== boardCard.boardId) }));
          return;
        }
        if (!attackers.length) return;
        setCombatState((current) => ({ ...current, pendingBlockerId: boardCard.boardId }));
        setSelection({ anchorId: boardCard.boardId, mode: 'blocker-pending', boardIds: [boardCard.boardId] });
        addGameNotice(`Selected ${boardCard.card?.name || 'blocker'} as a blocker. Now tap/click the attacking creature it should block.`, localSeat);
        return;
      }
    }
    if (combatState.phase === 'combat-select' && boardCard.ownerSeat === localSeat && boardCard.zone === 'creatures') {
      const legality = canCreatureAttack(boardCard, { turn });
      if (legality.legal === false) {
        alert(`Possible illegal attacker: ${boardCard.card.name}\nReason: ${legality.reason}`);
        return;
      }
      if (legality.legal === 'warn') {
        const override = confirm(`Possible illegal play for ${boardCard.card.name}: ${legality.reason}. Override and select it as an attacker?`);
        if (!override) return;
      }
      setCombatState((current) => {
        const exists = current.attackers.includes(boardCard.boardId);
        return { ...current, attackers: exists ? current.attackers.filter((id) => id !== boardCard.boardId) : [...current.attackers, boardCard.boardId] };
      });
      setSelection((current) => {
        const exists = current?.boardIds?.includes(boardCard.boardId);
        return { anchorId: boardCard.boardId, mode: 'combat', boardIds: exists ? current.boardIds.filter((id) => id !== boardCard.boardId) : [...(current?.boardIds || []), boardCard.boardId] };
      });
      return;
    }
    setSelection((current) => {
      const stack = boardCards
        .filter((card) => card.ownerSeat === boardCard.ownerSeat && card.zone === boardCard.zone && card.slot === boardCard.slot)
        .sort((a, b) => a.stackIndex - b.stackIndex);
      const clickedIndex = stack.findIndex((card) => card.boardId === boardCard.boardId);
      const stackBelow = stack.slice(0, clickedIndex + 1).map((card) => card.boardId);
      const single = [boardCard.boardId];
      if (!current || current.anchorId !== boardCard.boardId) return { anchorId: boardCard.boardId, mode: 'stack', boardIds: stackBelow };
      if (current.mode === 'stack') return { anchorId: boardCard.boardId, mode: 'single', boardIds: single };
      if (current.mode === 'single') return null;
      return null;
    });
  }

  function tapSelection(tapped) {
    if (!selection?.boardIds?.length) return;
    setBoardCards((cards) => cards.map((card) => selection.boardIds.includes(card.boardId) ? { ...card, tapped } : card));
    emit({ type: 'tap_cards', boardIds: selection.boardIds, tapped });
    setSelection(null);
  }

  function zoneBrowserCards(seat, zone) {
    if (!seat || !zone) return [];
    if (zone === 'library') {
      const source = seat === localSeat ? library : (aiStates[seat]?.library || []);
      return source.map((card, index) => ({ source: 'library', index, ownerSeat: seat, zone, card, id: `library-${seat}-${index}-${card.instanceId || card.scryfallId || card.name}` }));
    }
    return boardCards
      .filter((card) => card.ownerSeat === seat && card.zone === zone)
      .sort((a, b) => (a.stackIndex || 0) - (b.stackIndex || 0) || (a.playedAt || 0) - (b.playedAt || 0))
      .map((boardCard, index) => ({ source: 'board', index, ownerSeat: seat, zone, boardId: boardCard.boardId, card: boardCard.card, boardCard, id: boardCard.boardId }));
  }

  function removeLibraryIndicesForSeat(seat, indices) {
    const removeSet = new Set(indices);
    if (seat === localSeat) {
      setLibrary((cards) => cards.filter((_, index) => !removeSet.has(index)));
      return;
    }
    setAiStates((currentAll) => {
      const current = currentAll[seat];
      if (!current) return currentAll;
      return { ...currentAll, [seat]: { ...current, library: current.library.filter((_, index) => !removeSet.has(index)) } };
    });
  }

  function addCardsToSeatHand(seat, cardsToAdd) {
    if (!cardsToAdd.length) return;
    if (seat === localSeat) setHand((cards) => [...cards, ...cardsToAdd]);
    else setAiStates((currentAll) => {
      const current = currentAll[seat] || { hand: [], library: [] };
      return { ...currentAll, [seat]: { ...current, hand: [...(current.hand || []), ...cardsToAdd] } };
    });
  }

  function addCardsToSeatLibrary(seat, cardsToAdd, mode = 'top') {
    if (!cardsToAdd.length) return;
    const applyInsert = (currentLibrary) => {
      if (mode === 'bottom') return [...currentLibrary, ...cardsToAdd];
      if (mode === 'shuffle') return shuffleCards([...currentLibrary, ...cardsToAdd]);
      return [...cardsToAdd, ...currentLibrary];
    };
    if (seat === localSeat) setLibrary((cards) => applyInsert(cards));
    else setAiStates((currentAll) => {
      const current = currentAll[seat] || { hand: [], library: [] };
      return { ...currentAll, [seat]: { ...current, library: applyInsert(current.library || []) } };
    });
  }

  function putLibraryCardsOntoBoard(seat, selectedItems, destinationZone) {
    const cardsToPlace = selectedItems.map((item) => item.card).filter(Boolean);
    if (!cardsToPlace.length) return;
    const created = cardsToPlace.map((card, index) => {
      const zone = destinationZone === 'auto' ? likelyZoneForCard(card) : destinationZone;
      const slotInfo = nextSlot(seat, zone, card);
      return {
        boardId: crypto.randomUUID(),
        ownerSeat: seat,
        originalOwnerSeat: seat,
        controllerSeat: seat,
        zone,
        slot: slotInfo.slot,
        stackIndex: slotInfo.stackIndex + index,
        tapped: false,
        card,
        mods: [],
        savedActivations: [],
        enteredTurn: turn,
        controlledSinceTurn: turn,
        controlledSinceStartOfTurn: false,
        playedAt: Date.now() + index
      };
    });
    setBoardCards((cards) => [...cards, ...created]);
    created.forEach((card) => emit({ type: 'play_card', card }));
  }

  function moveZoneBrowserSelection(items, destination, options = {}) {
    const selectedItems = items || [];
    if (!selectedItems.length) return;
    const seat = selectedItems[0].ownerSeat || zoneBrowser?.seat || localSeat;
    const boardIds = selectedItems.filter((item) => item.source === 'board').map((item) => item.boardId);
    const libraryItems = selectedItems.filter((item) => item.source === 'library');
    const libraryCards = libraryItems.map((item) => item.card).filter(Boolean);

    if (boardIds.length) {
      if (destination === 'hand' || destination === 'opponent-hand') {
        const targetSeat = destination === 'opponent-hand'
          ? (SEATS.find((candidate) => candidate !== seat && players[candidate]) || seat)
          : seat;
        const movingCards = boardCards.filter((card) => boardIds.includes(card.boardId)).sort((a, b) => (a.stackIndex || 0) - (b.stackIndex || 0));
        addCardsToSeatHand(targetSeat, movingCards.map((item) => item.card));
        setBoardCards((cards) => cards.filter((card) => !boardIds.includes(card.boardId)));
        emit({ type: 'remove_board_cards', boardIds });
        removeLinkedModsForSources(boardIds);
      } else if (destination === 'library') {
        const mode = options.libraryMode || 'top';
        const movingCards = boardCards.filter((card) => boardIds.includes(card.boardId)).sort((a, b) => (a.stackIndex || 0) - (b.stackIndex || 0));
        addCardsToSeatLibrary(seat, movingCards.map((item) => item.card), mode);
        setBoardCards((cards) => cards.filter((card) => !boardIds.includes(card.boardId)));
        emit({ type: 'remove_board_cards', boardIds });
        removeLinkedModsForSources(boardIds);
      } else if (destination === 'battlefield') {
        const movingCards = boardCards.filter((card) => boardIds.includes(card.boardId));
        const updated = movingCards.map((card, index) => {
          const zone = likelyZoneForCard(card.card);
          const slotInfo = nextSlot(seat, zone, card.card);
          return { ...card, ownerSeat: seat, controllerSeat: seat, originalOwnerSeat: card.originalOwnerSeat || card.ownerSeat, zone, slot: slotInfo.slot, stackIndex: slotInfo.stackIndex + index, tapped: false, movedAt: Date.now() + index };
        });
        setBoardCards((cards) => cards.map((card) => updated.find((item) => item.boardId === card.boardId) || card));
        emit({ type: 'reposition_cards', cards: updated });
      } else {
        moveBoardSelectionToZone(boardIds, destination, null, seat);
      }
    }

    if (libraryItems.length) {
      removeLibraryIndicesForSeat(seat, libraryItems.map((item) => item.index));
      if (destination === 'hand') addCardsToSeatHand(seat, libraryCards);
      else if (destination === 'opponent-hand') {
        const targetSeat = SEATS.find((candidate) => candidate !== seat && players[candidate]) || seat;
        addCardsToSeatHand(targetSeat, libraryCards);
      }
      else if (destination === 'library') addCardsToSeatLibrary(seat, libraryCards, options.libraryMode || 'top');
      else putLibraryCardsOntoBoard(seat, libraryItems, destination === 'battlefield' ? 'auto' : destination);
    }
    setZoneBrowser(null);
    clearFloatingUi();
  }

  function drawFromZoneBrowser(seat, count = 1) {
    const amount = Math.max(0, Number(count || 0));
    if (!amount) return;
    if (seat === localSeat) {
      const drawn = library.slice(0, amount);
      setLibrary((cards) => cards.slice(drawn.length));
      setHand((cards) => [...cards, ...drawn]);
    } else {
      setAiStates((currentAll) => {
        const current = currentAll[seat];
        if (!current) return currentAll;
        const drawn = current.library.slice(0, amount);
        return { ...currentAll, [seat]: { ...current, library: current.library.slice(drawn.length), hand: [...current.hand, ...drawn] } };
      });
    }
    addGameNotice(`Library manager: Player ${seat} drew ${amount} card(s).`, seat);
  }

  function millFromZoneBrowser(seat, count = 1) {
    const amount = Math.max(0, Number(count || 0));
    if (!amount) return;
    const sourceLibrary = seat === localSeat ? library : (aiStates[seat]?.library || []);
    const milled = sourceLibrary.slice(0, amount);
    if (!milled.length) return;
    removeLibraryIndicesForSeat(seat, milled.map((_, index) => index));
    const created = milled.map((card, index) => {
      const slotInfo = nextSlot(seat, 'graveyard', card);
      return {
        boardId: crypto.randomUUID(),
        ownerSeat: seat,
        originalOwnerSeat: seat,
        controllerSeat: seat,
        zone: 'graveyard',
        slot: 0,
        stackIndex: slotInfo.stackIndex + index,
        tapped: false,
        card,
        mods: [],
        savedActivations: [],
        enteredTurn: turn,
        controlledSinceTurn: turn,
        controlledSinceStartOfTurn: false,
        playedAt: Date.now() + index
      };
    });
    setBoardCards((cards) => [...cards, ...created]);
    created.forEach((card) => emit({ type: 'play_card', card }));
    addGameNotice(`Library manager: Player ${seat} milled ${milled.length} card(s).`, seat);
  }

  function moveSelection(zone) {
    if (!selection?.boardIds?.length) return;
    moveBoardSelectionToZone(selection.boardIds, zone, null);
    setSelection(null);
  }

  function moveBoardSelectionToZone(boardIds, zone, point, ownerSeatOverride = null) {
    const movingIdSet = new Set(boardIds || []);
    const movingCards = boardCards.filter((card) => movingIdSet.has(card.boardId)).sort((a, b) => (a.slot - b.slot) || (a.stackIndex - b.stackIndex));
    if (!movingCards.length) return;
    let updatedCards = [];
    if (movingCards.length === 1) {
      const nextOwnerSeat = ownerSeatOverride || movingCards[0].ownerSeat;
      const slotInfo = slotInfoFromDropPoint(nextOwnerSeat, zone, point, movingIdSet);
      updatedCards = [{ ...movingCards[0], ownerSeat: nextOwnerSeat, controllerSeat: nextOwnerSeat, originalOwnerSeat: movingCards[0].originalOwnerSeat || movingCards[0].ownerSeat, zone, slot: slotInfo.slot, stackIndex: slotInfo.stackIndex, tapped: false, movedAt: Date.now(), controlledSinceTurn: nextOwnerSeat !== movingCards[0].ownerSeat ? turn : movingCards[0].controlledSinceTurn, controlledSinceStartOfTurn: nextOwnerSeat === movingCards[0].ownerSeat ? movingCards[0].controlledSinceStartOfTurn : false }];
    } else {
      const nextOwnerSeat = ownerSeatOverride || movingCards[0].ownerSeat;
      const slotInfo = slotInfoFromDropPoint(nextOwnerSeat, zone, point, movingIdSet);
      updatedCards = movingCards.map((card, index) => ({ ...card, ownerSeat: nextOwnerSeat, controllerSeat: nextOwnerSeat, originalOwnerSeat: card.originalOwnerSeat || card.ownerSeat, zone, slot: slotInfo.slot, stackIndex: slotInfo.stackIndex + index, tapped: false, movedAt: Date.now() + index, controlledSinceTurn: nextOwnerSeat !== card.ownerSeat ? turn : card.controlledSinceTurn, controlledSinceStartOfTurn: nextOwnerSeat === card.ownerSeat ? card.controlledSinceStartOfTurn : false }));
    }
    const nextSnapshot = boardCards.map((card) => {
      const replacement = updatedCards.find((item) => item.boardId === card.boardId);
      return replacement || card;
    });
    const prunedSnapshot = pruneBrokenAttachments(nextSnapshot);
    setBoardCards(prunedSnapshot);
    emit({ type: 'reposition_cards', cards: prunedSnapshot });
    updatedCards = updatedCards.map((updated) => prunedSnapshot.find((item) => item.boardId === updated.boardId) || updated);
    updatedCards.forEach((updated) => {
      const before = movingCards.find((item) => item.boardId === updated.boardId);
      if (!before || before.zone === updated.zone) return;
      fireWatchersForEvent({ id: safeId('manual-zone'), type: 'zone_change', seat: updated.ownerSeat, card: updated, movedCard: updated, fromZone: before.zone, toZone: updated.zone }, nextSnapshot);
      if (isBattlefieldZone(updated.zone) && !isTransientSpell(updated)) autoResolveCardOnEntry(updated, nextSnapshot);
    });
    clearFloatingUi();
  }

  function returnBoardCardsToHand(boardIds) {
    const movingCards = boardCards.filter((card) => boardIds.includes(card.boardId)).sort((a, b) => (a.slot - b.slot) || (a.stackIndex - b.stackIndex));
    if (!movingCards.length) return;
    setBoardCards((cards) => pruneBrokenAttachments(cards.filter((card) => !boardIds.includes(card.boardId))));
    setHand((cards) => [...cards, ...movingCards.map((item) => item.card)]);
    emit({ type: 'remove_board_cards', boardIds });
    clearFloatingUi();
  }

  function putBoardCardsIntoLibrary(boardIds) {
    const movingCards = boardCards.filter((card) => boardIds.includes(card.boardId)).sort((a, b) => (a.slot - b.slot) || (a.stackIndex - b.stackIndex));
    if (!movingCards.length) return;
    const action = (prompt('Put card(s) in the deck: top, bottom, random, or shuffle', 'top') || 'top').trim().toLowerCase();
    let nextLibrary = [...library];
    const payloadCards = movingCards.map((item) => item.card);
    if (action === 'bottom') {
      nextLibrary = [...nextLibrary, ...payloadCards];
    } else if (action === 'shuffle') {
      nextLibrary = shuffleCards([...nextLibrary, ...payloadCards]);
    } else if (action === 'random') {
      nextLibrary = [...nextLibrary];
      payloadCards.forEach((card) => {
        const index = Math.floor(Math.random() * (nextLibrary.length + 1));
        nextLibrary.splice(index, 0, card);
      });
    } else {
      nextLibrary = [...payloadCards, ...nextLibrary];
    }
    setLibrary(nextLibrary);
    setBoardCards((cards) => pruneBrokenAttachments(cards.filter((card) => !boardIds.includes(card.boardId))));
    emit({ type: 'remove_board_cards', boardIds });
    clearFloatingUi();
  }


  function getSelectedCards() {
    if (!selection?.boardIds?.length) return [];
    return boardCards.filter((card) => selection.boardIds.includes(card.boardId));
  }

  function toggleTapSelection() {
    const selected = getSelectedCards();
    if (!selected.length) return;
    const shouldTap = selected.some((card) => !card.tapped);
    setBoardCards((cards) => cards.map((card) => selection.boardIds.includes(card.boardId) ? { ...card, tapped: shouldTap } : card));
    emit({ type: 'tap_cards', boardIds: selection.boardIds, tapped: shouldTap });
    setSelection(null);
  }

  function adjustCommanderTax(boardId, delta) {
    setBoardCards((cards) => cards.map((card) => card.boardId === boardId ? { ...card, commanderTax: Math.max(0, Number(card.commanderTax || 0) + delta) } : card));
    emit({ type: 'commander_tax', boardId, delta });
  }

  function copySelection() {
    const selected = getSelectedCards();
    if (!selected.length) return;
    const copies = [];
    selected.forEach((source) => {
      const slotInfo = nextSlot(source.ownerSeat, source.zone);
      copies.push({
        ...source,
        boardId: crypto.randomUUID(),
        slot: slotInfo.slot,
        stackIndex: slotInfo.stackIndex,
        tapped: false,
        originalOwnerSeat: source.originalOwnerSeat || source.ownerSeat,
        controllerSeat: source.controllerSeat || source.ownerSeat,
        mods: [...(source.mods || [])],
        enteredTurn: turn,
        controlledSinceTurn: turn,
        playedAt: Date.now()
      });
    });
    setBoardCards((cards) => [...cards, ...copies]);
    copies.forEach((card) => emit({ type: 'play_card', card }));
    setSelection(null);
  }

  function applyModification(payload) {
    if (!selection?.boardIds?.length) return;
    const mod = { id: crypto.randomUUID(), ...payload };
    setBoardCards((cards) => cards.map((card) => selection.boardIds.includes(card.boardId) ? { ...card, mods: [...(card.mods || []), mod] } : card));
    setModifyModal(null);
  }

  function applyActivation(payload) {
    const modalIds = activateModal?.boardIds || selection?.boardIds || [];
    if (!modalIds.length) return;
    const selected = boardCards.filter((card) => modalIds.includes(card.boardId));
    if (!selected.length) return;
    const source = selected[0];
    if (payload.mode === 'aiAction' && payload.action) {
      if (payload.action.type === 'flashback') {
        const activeSource = withActiveFaceCard(source);
        const plan = buildAiCardPlan(activeSource.card, buildAiContext(source.ownerSeat, boardCards, null, source.boardId), aiBrain);
        const selectedAction = plan.actions.find((action) => action.type !== 'flashback') || null;
        setAiReview({ boardCard: source, plan, selectedAction, note: 'Flashback cast from graveyard. This should exile as it resolves.', resolveDestination: 'exile' });
        setActivateModal(null);
        return;
      }
      const paused = applyOrPromptAction(payload.action, source, {
        reason: 'Manual activation',
        afterChoice: { moveSourceToGraveyard: Boolean(payload.moveSourceToGraveyard) }
      });
      if (!paused && payload.moveSourceToGraveyard) moveResolvedSpellToGraveyard(source);
      setActivateModal(null);
      return;
    }
    if (payload.mode === 'copy') {
      const previousSelection = selection;
      setSelection({ anchorId: source.boardId, mode: 'single', boardIds: modalIds });
      copySelection();
      setSelection(previousSelection);
      setActivateModal(null);
      return;
    }
    const sourceId = source.boardId;
    const mod = {
      id: crypto.randomUUID(),
      kind: payload.kind || 'pt',
      powerDelta: payload.powerDelta || 0,
      toughnessDelta: payload.toughnessDelta || 0,
      trait: payload.trait || '',
      duration: payload.duration || 'linked',
      sourceId
    };
    setBoardCards((cards) => cards.map((card) => {
      if (payload.target === 'all' || card.ownerSeat === source.ownerSeat) {
        const traits = getCardTraits(card).map((trait) => trait.toLowerCase());
        const typeLine = String(card.card?.typeLine || '').toLowerCase();
        const filter = String(payload.filter || '').trim().toLowerCase();
        const matches = !filter || typeLine.includes(filter) || traits.some((trait) => trait.includes(filter));
        if (matches) return { ...card, mods: [...(card.mods || []), mod] };
      }
      return card;
    }));
    setActivateModal(null);
  }


  function compactEventCardName(event = {}) {
    const boardLike = event.card || event.movedCard || event.sourceCard || null;
    return getActiveCardForBoard(boardLike)?.name || boardLike?.card?.name || boardLike?.name || event.cardName || 'card';
  }

  function recordTurnEvent(event = {}) {
    const stamped = { id: event.id || safeId('evt'), turn, activeSeat, at: Date.now(), ...event };
    setTurnEventLog((events) => [...events.slice(-(WATCHER_EVENT_KEEP - 1)), stamped]);
    return stamped;
  }

  function sourceIsActiveWatcher(source = {}) {
    const activeCard = getActiveCardForBoard(source);
    return Boolean(activeCard && isBattlefieldZone(source.zone) && !isTransientCard(activeCard));
  }

  function eventCardIsControlledBy(event = {}, seat) {
    const card = event.card || event.movedCard || event.sourceCard || null;
    return Number(card?.ownerSeat) === Number(seat) || Number(card?.controllerSeat) === Number(seat);
  }

  function eventCardTypeMatches(event = {}, pattern = '') {
    const card = event.card || event.movedCard || event.sourceCard || null;
    const text = cardTypeText(getActiveCardForBoard(card) || card?.card || card || {});
    if (/creature/i.test(pattern) && !/\bCreature\b/i.test(text)) return false;
    if (/artifact/i.test(pattern) && !/\bArtifact\b/i.test(text)) return false;
    if (/equipment/i.test(pattern) && !/\bEquipment\b/i.test(text)) return false;
    if (/enchantment/i.test(pattern) && !/\bEnchantment\b/i.test(text)) return false;
    if (/aura/i.test(pattern) && !/\bAura\b/i.test(text)) return false;
    if (/land/i.test(pattern) && !/\bLand\b/i.test(text)) return false;
    return true;
  }

  function watcherTriggerMatchesEvent(action = {}, source = {}, event = {}) {
    const trigger = String(action.triggerText || '').replace(/\s+/g, ' ').trim();
    const sourceName = getActiveCardForBoard(source)?.name || source.card?.name || '';
    const triggerText = trigger || String(action.sourceText || action.abilityText || action.effectText || '').replace(/\s+/g, ' ').trim();
    if (!triggerText) return false;
    const lower = triggerText.toLowerCase();
    const eventCard = event.card || event.movedCard || event.sourceCard || null;
    const eventName = getActiveCardForBoard(eventCard)?.name || eventCard?.card?.name || eventCard?.name || '';
    if (event.type === 'spell_cast') {
      if (!/cast/i.test(lower)) return false;
      if (/you cast|spell you cast|whenever you/i.test(lower) && event.seat !== source.ownerSeat) return false;
      if (/opponent/i.test(lower) && event.seat === source.ownerSeat) return false;
      if (/first .* each turn/i.test(lower)) {
        const similar = turnEventLog.filter((item) => item.turn === turn && item.type === 'spell_cast' && item.seat === event.seat && item.id !== event.id);
        if (similar.some((item) => eventCardTypeMatches(item, triggerText))) return false;
      }
      return eventCardTypeMatches(event, triggerText);
    }
    if (event.type === 'permanent_entered') {
      if (!/enter|enters|entered/i.test(lower)) return false;
      const sourceNameEscaped = sourceName ? escapeRegexLiteral(sourceName).replace(/\s+/g, '\s+') : '';
      const sourceSpecificEnter = /(?:when|whenever)\s+this(?:\s+(?:creature|artifact|enchantment|permanent|land|aura))?\s+enters/i.test(triggerText)
        || (sourceNameEscaped && new RegExp(`(?:when|whenever)\s+${sourceNameEscaped}\s+enters`, 'i').test(triggerText));
      if (sourceSpecificEnter && source.boardId !== eventCard?.boardId) return false;
      if (/another/i.test(lower) && source.boardId === eventCard?.boardId) return false;
      if (/you control/i.test(lower) && !eventCardIsControlledBy(event, source.ownerSeat)) return false;
      if (/opponent/i.test(lower) && eventCardIsControlledBy(event, source.ownerSeat)) return false;
      return eventCardTypeMatches(event, triggerText);
    }
    if (event.type === 'zone_change') {
      const died = event.toZone === 'graveyard' && isBattlefieldZone(event.fromZone);
      const leaves = isBattlefieldZone(event.fromZone) && event.toZone !== event.fromZone;
      if (/dies|died/i.test(lower)) {
        if (!died) return false;
        if (/another/i.test(lower) && source.boardId === eventCard?.boardId) return false;
        if (/you control/i.test(lower) && !eventCardIsControlledBy(event, source.ownerSeat)) return false;
        return eventCardTypeMatches(event, triggerText);
      }
      if (/leaves the battlefield|leave the battlefield/i.test(lower)) {
        if (!leaves) return false;
        if (/this/i.test(lower) && source.boardId !== eventCard?.boardId) return false;
        return true;
      }
    }
    if (event.type === 'card_drawn') {
      if (!/draw/i.test(lower)) return false;
      if (/you draw|whenever you/i.test(lower) && event.seat !== source.ownerSeat) return false;
      if (/opponent/i.test(lower) && event.seat === source.ownerSeat) return false;
      return true;
    }
    if (event.type === 'card_tapped') {
      if (!/becomes tapped|tapped for mana|is tapped/i.test(lower)) return false;
      if (/this land|this artifact|this permanent|this/i.test(lower) && source.boardId !== eventCard?.boardId) return false;
      return true;
    }
    if (event.type === 'combat_damage') {
      if (!/combat damage|deals damage/i.test(lower)) return false;
      if (/you control/i.test(lower) && !eventCardIsControlledBy(event, source.ownerSeat)) return false;
      if (/opponent/i.test(lower) && event.defendingSeat === source.ownerSeat) return false;
      return true;
    }
    if (event.type === 'turn_step') {
      if (/beginning of .*end step/i.test(lower) && event.step !== 'end') return false;
      if (/beginning of .*upkeep/i.test(lower) && event.step !== 'upkeep') return false;
      if (/beginning of .*main phase/i.test(lower) && event.step !== 'main') return false;
      if (/your/i.test(lower) && event.seat !== source.ownerSeat) return false;
      if (/opponent/i.test(lower) && event.seat === source.ownerSeat) return false;
      return /beginning of/i.test(lower);
    }
    return false;
  }

  function actionIsCostedManualActivation(action = {}) {
    if (!action) return false;
    if (action.triggerText) return false;
    const text = `${action.sourceText || ''} ${action.abilityText || ''} ${action.effectText || ''} ${action.label || ''}`.replace(/\s+/g, ' ').trim();
    const hasExplicitCost = Boolean(action.costText || action.cost?.parts?.length || action.cost?.raw);
    const hasColonActivationShape = /^(?:\{[^}]+\}|[^{.]{1,80}?\{[^}]+\}|tap |untap |sacrifice |discard |pay |remove |exile ).{0,120}?:/i.test(text);
    const hasActivationReminder = /activate only|equip\s*\{|crew\s*\d|level up\s*\{|cycling\s*\{|unearth\s*\{|dash\s*\{|forecast\s*[—-]|channel\s*[—-]/i.test(text);
    if (hasExplicitCost || hasColonActivationShape || hasActivationReminder) return true;
    if (['equip', 'add_mana'].includes(action.type)) return true;
    return false;
  }

  function shouldAutoResolveActionNow(action = {}, sourceBoardCard = null, event = null) {
    if (!action || action.conditionCheck?.met === false) return false;
    const isManualActivation = event?.type === 'manual_activation';
    if (actionIsCostedManualActivation(action) && !isManualActivation) return false;
    if (['attach_permanent', 'transform', 'transform_source', 'tap', 'untap'].includes(action.type) && !action.triggerText && !isManualActivation) return false;
    if (action.type === 'add_mana' && !isManualActivation) return false;
    if (['intrinsic_trait', 'aura_enchant', 'entry_modifier', 'equip', 'flashback', 'casting_cost_mechanic', 'commander_partner'].includes(action.type) && !isManualActivation) return false;
    if (!AUTO_RESOLVE_ACTION_TYPES.has(action.type)) return false;
    return true;
  }

  function getActionsToAutoResolveForCard(sourceBoardCard, cardsSnapshot = boardCards, event = null, options = {}) {
    const activeSource = withActiveFaceCard(sourceBoardCard);
    if (!activeSource?.card?.oracleText) return [];
    const plan = buildAiCardPlan(activeSource.card, buildAiContext(sourceBoardCard.ownerSeat, cardsSnapshot, sourceBoardCard.ownerSeat === localSeat ? null : aiStates[sourceBoardCard.ownerSeat], sourceBoardCard.boardId), aiBrain);
    if (!plan.actions?.length) return [];
    const actions = [];
    const usedAbilityIds = new Set();
    for (const action of plan.actions) {
      if (!shouldAutoResolveActionNow(action, sourceBoardCard, event)) continue;
      if (event && action.triggerText && !watcherTriggerMatchesEvent(action, sourceBoardCard, event)) continue;
      if (!event && action.triggerText && !/when .* enters|enters/i.test(action.triggerText)) continue;
      if (options.onlyAbilityId && action.abilityId !== options.onlyAbilityId) continue;
      const abilityKey = action.abilityId || `${action.type}:${action.sourceText || action.effectText || action.label}`;
      if (usedAbilityIds.has(abilityKey) && !['exile', 'destroy', 'gain_life', 'lose_life', 'direct_damage'].includes(action.type)) continue;
      usedAbilityIds.add(abilityKey);
      actions.push(action);
    }
    return actions;
  }

  function requestActionChoice({ sourceBoardCard, action, afterChoice = null, reason = '' }) {
    if (!sourceBoardCard || !action) return false;
    setActionChoiceRequest({ id: safeId('choice'), sourceBoardCard, action, afterChoice, reason });
    addGameNotice(`${sourceBoardCard.card.name}: waiting for player choice for ${action.label || action.type}.`, sourceBoardCard.ownerSeat);
    return true;
  }

  function applyOrPromptAction(action, sourceBoardCard, options = {}) {
    if (!action || !sourceBoardCard) return false;
    const isHumanControlled = sourceBoardCard.ownerSeat === localSeat;
    const promptReason = String(options.reason || '');
    const shouldForceLibraryChoice = isHumanControlled && action.type === 'search_library' && actionIsManualChoiceSafe(action) && !action.playerConfirmedLibraryChoice && !options.allowAutoLibraryChoice;
    if (shouldForceLibraryChoice) {
      return requestActionChoice({
        sourceBoardCard,
        action: clearAiSuggestedLibraryChoices(action),
        afterChoice: options.afterChoice || null,
        reason: promptReason || 'Choose the library card(s) for this effect.'
      });
    }
    const shouldForceTargetChoice = isHumanControlled && actionNeedsTarget(action) && actionIsManualChoiceSafe(action) && !options.allowAutoTarget;
    if (shouldForceTargetChoice) {
      return requestActionChoice({
        sourceBoardCard,
        action: { ...action, target: null, preselectedTarget: action.target || null },
        afterChoice: options.afterChoice || null,
        reason: promptReason || 'Choose the target for this effect.'
      });
    }
    const shouldConfirmOptional = isHumanControlled && action.optional && /watcher|trigger|auto/i.test(promptReason);
    if (shouldConfirmOptional) {
      return requestActionChoice({
        sourceBoardCard,
        action: { ...action, choiceKind: 'optional' },
        afterChoice: options.afterChoice || null,
        reason: promptReason || 'Optional effect — choose whether to use it.'
      });
    }
    if (isHumanControlled && actionNeedsChoice(action, sourceBoardCard) && actionIsManualChoiceSafe(action)) {
      return requestActionChoice({ sourceBoardCard, action, afterChoice: options.afterChoice || null, reason: promptReason });
    }
    applyAiAction(action, sourceBoardCard);
    return false;
  }

  function fireWatchersForEvent(rawEvent = {}, cardsSnapshot = boardCards) {
    const event = recordTurnEvent(rawEvent);
    const sources = (cardsSnapshot || boardCards).filter(sourceIsActiveWatcher);
    let fired = 0;
    for (const source of sources) {
      const activeSource = withActiveFaceCard(source);
      const plan = buildAiCardPlan(activeSource.card, buildAiContext(source.ownerSeat, cardsSnapshot, source.ownerSeat === localSeat ? null : aiStates[source.ownerSeat], source.boardId), aiBrain);
      const matching = (plan.actions || []).filter((action) => action.triggerText && watcherTriggerMatchesEvent(action, source, event) && shouldAutoResolveActionNow(action, source, event));
      const seenAbility = new Set();
      for (const action of matching) {
        const sig = `${event.id}:${source.boardId}:${action.abilityId || action.type}:${action.type}`;
        if (watcherRunRef.current.has(sig)) continue;
        watcherRunRef.current.add(sig);
        if (watcherRunRef.current.size > 1600) watcherRunRef.current.clear();
        const abilityKey = action.abilityId || `${action.sourceText || action.effectText || action.label}`;
        if (seenAbility.has(abilityKey) && !['gain_life', 'lose_life', 'direct_damage', 'add_counters'].includes(action.type)) continue;
        seenAbility.add(abilityKey);
        fired += 1;
        const pausedForChoice = applyOrPromptAction(action, source, { reason: `Watcher fired from ${event.type}` });
        if (pausedForChoice) return { fired, pausedForChoice: true, event };
      }
    }
    if (fired) addGameNotice(`Watcher system: ${fired} listener(s) fired from ${rawEvent.type || 'event'} (${compactEventCardName(rawEvent)}).`, rawEvent.seat || null);
    return { fired, pausedForChoice: false, event };
  }

  function autoResolveCardOnEntry(boardCard, cardsSnapshot = boardCards) {
    const activeSource = withActiveFaceCard(boardCard);
    if (!activeSource?.card?.oracleText || isTransientSpell(activeSource)) return false;
    const event = { id: safeId('enter'), type: 'permanent_entered', seat: boardCard.ownerSeat, card: boardCard, isLandPlay: isLand(activeSource.card) };
    const actions = getActionsToAutoResolveForCard(boardCard, cardsSnapshot, event).filter((action) => !action.triggerText);
    let paused = false;
    actions.forEach((action) => {
      if (paused) return;
      paused = applyOrPromptAction(action, boardCard, { reason: 'Auto ETB/entry resolution' });
    });
    fireWatchersForEvent(event, cardsSnapshot);
    return paused;
  }

  function resolveActionChoice(selection = {}) {
    const request = actionChoiceRequest;
    if (!request?.action || !request?.sourceBoardCard) return;
    const hydrated = hydrateActionChoice(request.action, request.sourceBoardCard, selection);
    setActionChoiceRequest(null);
    if (hydrated?.skipAction || hydrated?.type === 'noop') {
      addGameNotice(`${request.sourceBoardCard.card.name}: optional effect skipped.`, request.sourceBoardCard.ownerSeat);
      return;
    }
    applyAiAction(hydrated, request.sourceBoardCard);
    if (request.afterChoice?.moveSourceToGraveyard) moveResolvedSpellToGraveyard(request.sourceBoardCard);
    if (request.afterChoice?.moveSourceToExile) moveCardsDirectlyToZone([request.sourceBoardCard.boardId], 'exile');
    if (request.afterChoice?.resumePendingStack) {
      const pending = request.afterChoice.resumePendingStack;
      setTimeout(() => finishResolvedSpellMovement(pending), 120);
    }
  }


  function buildAiContext(seat, cards = boardCards, aiOverride = null, sourceBoardId = null) {
    const overrideState = aiOverride || aiStates[seat] || null;
    const ownLibrary = seat === localSeat ? library : [];
    const ownHand = seat === localSeat ? hand : [];
    const activeCards = activeBoardCards(cards);
    return {
      seat,
      localSeat,
      sourceBoardId,
      boardCards: activeCards,
      ownCards: activeCards.filter((card) => card.ownerSeat === seat),
      opponentCards: activeCards.filter((card) => card.ownerSeat !== seat),
      library: overrideState?.library || ownLibrary,
      hand: overrideState?.hand || ownHand,
      turn,
      activeSeat
    };
  }

  function queueAiReviewForCard(boardCard, cardsSnapshot = boardCards, aiOverride = null, options = {}) {
    const activeBoardCard = withActiveFaceCard(boardCard);
    if (!activeBoardCard?.card?.oracleText) return false;
    const plan = buildAiCardPlan(activeBoardCard.card, buildAiContext(boardCard.ownerSeat, cardsSnapshot, aiOverride, boardCard.boardId), aiBrain);
    if (!plan.actions.length) return false;
    if (!options.force && plan.learned && plan.approvedCount > 0) return false;
    if (!options.force && shouldAutoApproveAiPlan(plan)) {
      const nextBrain = recordAiFeedback(aiBrain, plan, 'approved', autoApprovalReason(plan), {
        responseWorthy: Boolean(plan.responseProfile?.responseWorthy),
        responseReason: plan.responseProfile?.responseWorthy ? `Silent gameplay precheck at ${plan.confidence}% confidence: ${(plan.responseProfile.reasons || []).join('; ')}` : '',
        autoApproved: true,
        autoConfidence: plan.confidence
      });
      setAiBrain(nextBrain);
      if (!options.silent) addGameNotice(`AI silently remembered ${boardCard.card.name} at ${plan.confidence}% confidence; no learning popup needed.`, boardCard.ownerSeat);
      return false;
    }
    const abilityOrder = [];
    const representativeByAbility = new Map();
    plan.actions.forEach((action) => {
      if (!representativeByAbility.has(action.abilityId)) {
        representativeByAbility.set(action.abilityId, action);
        abilityOrder.push(action.abilityId);
      }
    });
    const reviews = abilityOrder.map((abilityId, index) => ({
      boardCard: activeBoardCard,
      plan,
      note: options.note || '',
      selectedAction: representativeByAbility.get(abilityId),
      abilityIndex: index,
      abilityCount: abilityOrder.length,
      deferResolution: Boolean(options.deferResolution),
      stackId: options.stackId || ''
    }));
    setAiReviewQueue((queue) => [...queue, ...reviews]);
    return true;
  }

  function aiCastNeedsReview(pending) {
    const activeBoardCard = withActiveFaceCard(pending?.boardCard);
    if (!activeBoardCard?.card?.oracleText) return false;
    const plan = buildAiCardPlan(activeBoardCard.card, buildAiContext(pending.boardCard.ownerSeat, pending.cardsSnapshot || boardCards, pending.aiOverride, pending.boardCard.boardId), aiBrain);
    if (!plan.actions.length) return false;
    return !(plan.learned && plan.approvedCount > 0) && !shouldAutoApproveAiPlan(plan);
  }

  function markAiCastReviewedIfNoManualCheckNeeded(pending) {
    const activeBoardCard = withActiveFaceCard(pending?.boardCard);
    if (!activeBoardCard?.card?.oracleText) return { ...pending, reviewComplete: true, reviewInProgress: false };
    const plan = buildAiCardPlan(activeBoardCard.card, buildAiContext(pending.boardCard.ownerSeat, pending.cardsSnapshot || boardCards, pending.aiOverride, pending.boardCard.boardId), aiBrain);
    if (plan.actions.length && !(plan.learned && plan.approvedCount > 0) && shouldAutoApproveAiPlan(plan)) {
      const nextBrain = recordAiFeedback(aiBrain, plan, 'approved', autoApprovalReason(plan), {
        responseWorthy: Boolean(plan.responseProfile?.responseWorthy),
        responseReason: plan.responseProfile?.responseWorthy ? `Silent stack precheck at ${plan.confidence}% confidence: ${(plan.responseProfile.reasons || []).join('; ')}` : '',
        autoApproved: true,
        autoConfidence: plan.confidence
      });
      setAiBrain(nextBrain);
      publishAiThought(`AI understanding precheck: ${pending.boardCard.card.name} was silently approved at ${plan.confidence}% confidence, so no popup was needed.`, 'append', pending.seat);
    }
    return { ...pending, reviewComplete: true, reviewInProgress: false };
  }

  function moveCardsDirectlyToZone(boardIds, zone) {
    let moveInfo = null;
    setBoardCards((currentCards) => {
      const movingCards = currentCards
        .filter((card) => boardIds.includes(card.boardId))
        .sort((a, b) => (a.slot - b.slot) || (a.stackIndex - b.stackIndex));
      if (!movingCards.length) {
        moveInfo = { updatedCards: [], movingCards: [], nextSnapshot: currentCards };
        return currentCards;
      }
      const existingCounts = new Map();
      currentCards.forEach((card) => {
        if (!boardIds.includes(card.boardId) && card.zone === zone) {
          const key = `${card.ownerSeat}:${zone}`;
          existingCounts.set(key, (existingCounts.get(key) || 0) + 1);
        }
      });
      const perOwnerSlotCounts = new Map();
      const updatedCards = movingCards.map((card) => {
        const key = `${card.ownerSeat}:${zone}`;
        const localIndex = perOwnerSlotCounts.get(key) || 0;
        perOwnerSlotCounts.set(key, localIndex + 1);
        const stackIndex = MANAGED_PILE_ZONES.includes(zone) ? (existingCounts.get(key) || 0) + localIndex : localIndex;
        return { ...card, zone, slot: 0, stackIndex, tapped: false, movedAt: Date.now() + localIndex };
      });
      const nextSnapshot = currentCards.map((card) => updatedCards.find((item) => item.boardId === card.boardId) || card);
      moveInfo = { updatedCards, movingCards, nextSnapshot };
      return nextSnapshot;
    });
    const updatedCards = moveInfo?.updatedCards || [];
    if (!updatedCards.length) return;
    emit({ type: 'reposition_cards', cards: updatedCards });
    if (['graveyard', 'exile', 'library'].includes(zone)) removeLinkedModsForSources(boardIds);
    updatedCards.forEach((updated) => {
      const before = moveInfo.movingCards.find((item) => item.boardId === updated.boardId);
      if (!before || before.zone === updated.zone) return;
      fireWatchersForEvent({ id: safeId('zone'), type: 'zone_change', seat: updated.ownerSeat, card: updated, movedCard: updated, fromZone: before.zone, toZone: updated.zone }, moveInfo.nextSnapshot);
    });
  }

  function isTransientSpell(boardCard) {
    return /\bInstant\b|\bSorcery\b/i.test(getActiveCardForBoard(boardCard)?.typeLine || boardCard?.card?.typeLine || '');
  }

  function transformBoardCard(sourceBoardCard) {
    if (!sourceBoardCard?.boardId || !cardHasAlternateFaces(sourceBoardCard.card)) {
      addGameNotice(`${sourceBoardCard?.card?.name || 'Card'} has no second face loaded to transform into.`, sourceBoardCard?.ownerSeat || null);
      return false;
    }
    const faces = cardFaces(sourceBoardCard.card);
    const currentIndex = activeFaceIndexForBoardCard(sourceBoardCard);
    const nextIndex = (currentIndex + 1) % faces.length;
    const nextFaceCard = cardForFace(sourceBoardCard.card, nextIndex);
    const transformedAt = Date.now();
    setBoardCards((cards) => cards.map((card) => card.boardId === sourceBoardCard.boardId ? { ...card, activeFaceIndex: nextIndex, transformedAt, transforming: true } : card));
    setTimeout(() => setBoardCards((cards) => cards.map((card) => card.boardId === sourceBoardCard.boardId ? { ...card, transforming: false } : card)), 640);
    emit({ type: 'transform_card', boardId: sourceBoardCard.boardId, activeFaceIndex: nextIndex, transformedAt });
    addGameNotice(`${sourceBoardCard.card.name}: transformed to ${nextFaceCard.name}. Active abilities now come only from that face.`, sourceBoardCard.ownerSeat);
    fireWatchersForEvent({ id: safeId('transform'), type: 'card_transformed', seat: sourceBoardCard.ownerSeat, card: { ...sourceBoardCard, activeFaceIndex: nextIndex } }, boardCards);
    return true;
  }

  function markActionCostPaid(action, sourceBoardCard) {
    if (!action || !sourceBoardCard) return;
    const costText = `${action.costText || ''} ${action.cost?.raw || ''}`;
    const outOfPlay = ['graveyard', 'exile', 'library'].includes(sourceBoardCard.zone);
    const needsTap = !outOfPlay && (action.requiresTap || /\{t\}|tap this|tap/i.test(costText));
    const needsSacrifice = /sacrifice/i.test(costText);
    const sourceMove = action.sourceCostMove || action.cost?.sourceMove || null;
    if (action.sourceZoneRequirement && sourceBoardCard.zone !== action.sourceZoneRequirement) {
      addGameNotice(`Activation warning: ${sourceBoardCard.card.name} expected to be in ${action.sourceZoneRequirement}, but is in ${sourceBoardCard.zone}.`, sourceBoardCard.ownerSeat);
    }
    if (needsTap) {
      const tappedSource = { ...sourceBoardCard, tapped: true };
      const nextSnapshot = boardCards.map((card) => card.boardId === sourceBoardCard.boardId ? tappedSource : card);
      setBoardCards(nextSnapshot);
      emit({ type: 'tap_cards', boardIds: [sourceBoardCard.boardId], tapped: true });
      addGameNotice(`Activation cost paid: tapped ${sourceBoardCard.card.name} (P${sourceBoardCard.ownerSeat}).`, sourceBoardCard.ownerSeat);
      fireWatchersForEvent({ id: safeId('tap'), type: 'card_tapped', seat: sourceBoardCard.ownerSeat, card: tappedSource }, nextSnapshot);
    }
    if (sourceMove?.destination) {
      moveCardsDirectlyToZone([sourceBoardCard.boardId], sourceMove.destination);
      addGameNotice(`Activation cost paid: moved ${sourceBoardCard.card.name} to ${sourceMove.destination}.`, sourceBoardCard.ownerSeat);
      return;
    }
    if (needsSacrifice) {
      moveCardsDirectlyToZone([sourceBoardCard.boardId], 'graveyard');
      addGameNotice(`Activation cost paid: sacrificed ${sourceBoardCard.card.name} (P${sourceBoardCard.ownerSeat}).`, sourceBoardCard.ownerSeat);
    }
  }

  function moveResolvedSpellToGraveyard(boardCard) {
    if (!isTransientSpell(boardCard)) return;
    moveCardsDirectlyToZone([boardCard.boardId], 'graveyard');
    addGameNotice(`Resolved spell moved to Player ${boardCard.ownerSeat} graveyard: ${boardCard.card.name}.`, boardCard.ownerSeat);
  }

  function chooseCardsFromLibraryForAction(sourceBoardCard, action, libraryCards) {
    const criteria = action.searchCriteria || {};
    const maxChoices = maxLibraryChoicesForAction(action);
    const wanted = action.libraryChoices?.length ? action.libraryChoices : (action.libraryChoice ? [action.libraryChoice] : []);
    const cardKey = (card = {}) => card.scryfallId || card.id || card.name || '';
    const wantedKeys = wanted.map((choice) => choice.scryfallId || choice.id || choice.name).filter(Boolean);
    const matchesCriteria = (card) => cardMatchesLibraryCriteriaForAction(card, action);
    const selected = [];
    const usedIndexes = new Set();

    if (wantedKeys.length) {
      wantedKeys.slice(0, maxChoices).forEach((wantedKey) => {
        const foundIndex = libraryCards.findIndex((card, index) => {
          if (usedIndexes.has(index)) return false;
          if (!matchesCriteria(card)) return false;
          const key = cardKey(card);
          return key === wantedKey || card.name === wantedKey;
        });
        if (foundIndex >= 0) {
          usedIndexes.add(foundIndex);
          selected.push({ card: libraryCards[foundIndex], originalIndex: foundIndex });
        }
      });
    } else {
      for (let index = 0; index < libraryCards.length && selected.length < maxChoices; index += 1) {
        const card = libraryCards[index];
        if (matchesCriteria(card)) selected.push({ card, originalIndex: index });
      }
    }

    const nextLibrary = libraryCards.filter((_, index) => !usedIndexes.has(index) && !selected.some((choice) => choice.originalIndex === index));
    const choices = selected.map((choice, index) => ({ card: choice.card, index: choice.originalIndex, ...libraryDestinationForChoiceIndex(action, index) }));
    return { found: selected.map((choice) => choice.card), choices, nextLibrary, criteria };
  }

  function putLibrarySearchChoicesOntoBoard(sourceBoardCard, choices) {
    const createdBoardCards = choices
      .filter((choice) => choice.destination === 'battlefield')
      .map((choice) => {
        const zone = likelyZoneForCard(choice.card);
        const slotInfo = nextSlot(sourceBoardCard.ownerSeat, zone, choice.card);
        return {
          boardId: crypto.randomUUID(),
          ownerSeat: sourceBoardCard.ownerSeat,
          originalOwnerSeat: sourceBoardCard.ownerSeat,
          controllerSeat: sourceBoardCard.ownerSeat,
          zone,
          slot: slotInfo.slot,
          stackIndex: slotInfo.stackIndex,
          tapped: Boolean(choice.tapped) || aiCardEntersTapped(choice.card),
          card: choice.card,
          mods: [],
          enteredTurn: turn,
          controlledSinceTurn: turn,
          controlledSinceStartOfTurn: false,
          playedAt: Date.now()
        };
      });
    if (createdBoardCards.length) {
      setBoardCards((cards) => [...cards, ...createdBoardCards]);
      createdBoardCards.forEach((card) => emit({ type: 'play_card', card }));
    }
    return createdBoardCards;
  }

  function cardMatchesAffectedObjects(boardCard, affectedObjects = '', sourceBoardCard = null) {
    const affected = String(affectedObjects || '').toLowerCase();
    const activeCard = getActiveCardForBoard(boardCard) || boardCard?.card || {};
    const typeLine = activeCard.typeLine || '';
    const nameAndText = `${activeCard.name || ''} ${typeLine} ${activeCard.oracleText || ''}`;
    if (/^(this creature|this land|this artifact|this permanent|this source)/.test(affected)) return boardCard.boardId === sourceBoardCard?.boardId;
    if (sourceBoardCard && boardCard.ownerSeat !== sourceBoardCard.ownerSeat) return false;
    if (!/\bCreature\b/i.test(typeLine) && /creature|wurm|elf|goblin|zombie|human/.test(affected)) return false;
    if (/equipped creature/.test(affected)) {
      const attachedIds = boardCard.attachedSourceIds || [];
      return boardCard.equippedBy === sourceBoardCard?.boardId || attachedIds.includes(sourceBoardCard?.boardId) || boardCard.boardId === sourceBoardCard?.equippedTo;
    }
    if (/enchanted creature/.test(affected)) {
      const attachedIds = boardCard.attachedSourceIds || [];
      return attachedIds.includes(sourceBoardCard?.boardId) || boardCard.boardId === sourceBoardCard?.attachedTo || boardCard.boardId === sourceBoardCard?.equippedTo;
    }
    if (/\bother\b/.test(affected) && boardCard.boardId === sourceBoardCard?.boardId) return false;
    if (/non-human/.test(affected) && /\bHuman\b/i.test(typeLine)) return false;
    if (/green creature/.test(affected) && !(/\bG\b/i.test((activeCard.colors || []).join(' ')) || /green/i.test(nameAndText))) return false;
    if (/wurm/.test(affected) && !/\bWurm\b/i.test(typeLine)) return false;
    if (/elf|elves/.test(affected) && !/\bElf\b/i.test(typeLine)) return false;
    if (/goblin/.test(affected) && !/\bGoblin\b/i.test(typeLine)) return false;
    if (/zombie/.test(affected) && !/\bZombie\b/i.test(typeLine)) return false;
    if (/human/.test(affected) && !/\bHuman\b/i.test(typeLine)) return false;
    if (/creatures? you control|each creature you control|you control|your|wurm|elf|goblin|zombie|human/.test(affected)) return boardCard.ownerSeat === sourceBoardCard?.ownerSeat;
    return /\bCreature\b/i.test(typeLine);
  }

  function actionExplicitlyUntilEndOfTurn(action = {}) {
    return /until end of turn|until-end-of-turn|eot/i.test(`${action.duration || ''} ${action.effectText || ''} ${action.sourceText || ''} ${action.abilityText || ''} ${action.label || ''}`);
  }

  function linkedOrTemporaryDurationForAction(action = {}, fallback = 'permanent') {
    if (actionExplicitlyUntilEndOfTurn(action)) return 'eot';
    if (action.linkedStatic) return 'linked';
    return fallback;
  }

  function applyFilteredMod(action, sourceBoardCard, modFactory) {
    setBoardCards((cards) => cards.map((card) => {
      if (action.target?.boardId) return card.boardId === action.target.boardId ? { ...card, mods: [...(card.mods || []), modFactory(card)] } : card;
      if (cardMatchesAffectedObjects(card, action.affectedObjects || action.effectText || action.abilityText, sourceBoardCard)) return { ...card, mods: [...(card.mods || []), modFactory(card)] };
      return card;
    }));
  }

  function attachmentEffectAppliesToAttachedCreature(action = {}) {
    const text = `${action.affectedObjects || ''} ${action.affectedObject || ''} ${action.effectText || ''} ${action.sourceText || ''} ${action.abilityText || ''} ${action.label || ''}`;
    return /equipped creature|enchanted creature/i.test(text);
  }

  function numericEquipmentDelta(value, dynamicValue = 0) {
    if (typeof value === 'number') return value;
    const raw = String(value || '').trim().toUpperCase();
    if (raw === 'X' || raw === '+X') return Number(dynamicValue || 0);
    if (raw === '-X') return -Number(dynamicValue || 0);
    const parsed = Number(raw.replace(/^\+/, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function equipmentDynamicValue(action = {}, targetBoardCard = null, cards = [], sourceBoardCard = null) {
    const text = `${action.multiplierText || ''} ${action.multiplier || ''} ${action.xDefinition || ''} ${action.effectText || ''} ${action.sourceText || ''}`;
    if (/life total/i.test(text)) return Number(lifeTotals[sourceBoardCard?.ownerSeat]?.life || STARTING_LIFE);
    if (/shares? a creature type with it|share a creature type with it/i.test(text)) {
      const targetTypes = creatureSubtypesFromBoardCard(targetBoardCard);
      if (!targetTypes.length) return 0;
      return (cards || []).filter((card) => (
        card.boardId !== targetBoardCard?.boardId &&
        card.ownerSeat === targetBoardCard?.ownerSeat &&
        isBattlefieldZone(card.zone) &&
        isCreatureBoardCard(card) &&
        creatureSubtypesFromBoardCard(card).some((type) => targetTypes.includes(type))
      )).length;
    }
    if (/aura(?:s)? and(?:\/or)? equipment|equipment(?:s)? attached to it|aura(?:s)? attached to it|attached to it/i.test(text)) {
      const attached = new Set(targetBoardCard?.attachedSourceIds || []);
      if (sourceBoardCard?.boardId) attached.add(sourceBoardCard.boardId);
      return Math.max(1, attached.size);
    }
    return 1;
  }

  function buildEquipmentAttachmentMods(sourceBoardCard, targetBoardCard, cards = []) {
    const activeSource = getActiveCardForBoard(sourceBoardCard) || sourceBoardCard?.card || {};
    const plan = buildAiCardPlan(activeSource, {
      boardCards: activeBoardCards(cards),
      seat: sourceBoardCard.ownerSeat,
      sourceBoardId: sourceBoardCard.boardId,
      hand: sourceBoardCard.ownerSeat === localSeat ? hand : (aiStates[sourceBoardCard.ownerSeat]?.hand || []),
      library: sourceBoardCard.ownerSeat === localSeat ? library : (aiStates[sourceBoardCard.ownerSeat]?.library || [])
    }, aiBrain);
    const sourceActsAsEquipment = isEquipmentBoardCard(sourceBoardCard);
    const mods = [{
      id: crypto.randomUUID(),
      kind: 'trait',
      trait: `${sourceActsAsEquipment ? 'Equipped' : 'Attached'}: ${activeSource.name || sourceBoardCard.card?.name || (sourceActsAsEquipment ? 'Equipment' : 'Aura')}`,
      duration: 'linked',
      sourceId: sourceBoardCard.boardId,
      equipmentAttachment: sourceActsAsEquipment
    }];

    for (const parsedAction of plan.actions || []) {
      if (parsedAction.type === 'equipment_static_pt' || (parsedAction.type === 'modify_pt' && attachmentEffectAppliesToAttachedCreature(parsedAction))) {
        const dynamic = equipmentDynamicValue(parsedAction, targetBoardCard, cards, sourceBoardCard);
        const powerDelta = numericEquipmentDelta(parsedAction.powerDelta, dynamic) * (parsedAction.type === 'equipment_static_pt' ? dynamic : 1);
        const toughnessDelta = numericEquipmentDelta(parsedAction.toughnessDelta, dynamic) * (parsedAction.type === 'equipment_static_pt' ? dynamic : 1);
        if (powerDelta || toughnessDelta) {
          mods.push({
            id: crypto.randomUUID(),
            kind: 'pt',
            powerDelta,
            toughnessDelta,
            duration: linkedOrTemporaryDurationForAction(parsedAction, 'linked'),
            sourceId: sourceBoardCard.boardId,
            equipmentEffect: sourceActsAsEquipment,
            label: parsedAction.label || `Attached creature gets ${powerDelta >= 0 ? '+' : ''}${powerDelta}/${toughnessDelta >= 0 ? '+' : ''}${toughnessDelta}`
          });
        }
      }
      if (parsedAction.type === 'set_base_pt' && attachmentEffectAppliesToAttachedCreature(parsedAction)) {
        mods.push({
          id: crypto.randomUUID(),
          kind: 'base_pt',
          basePower: parsedAction.basePower,
          baseToughness: parsedAction.baseToughness,
          duration: linkedOrTemporaryDurationForAction(parsedAction, 'linked'),
          sourceId: sourceBoardCard.boardId,
          equipmentEffect: sourceActsAsEquipment,
          label: parsedAction.label || `Attached creature base P/T becomes ${parsedAction.basePower}/${parsedAction.baseToughness}`
        });
      }
      if (parsedAction.type === 'grant_trait' && attachmentEffectAppliesToAttachedCreature(parsedAction) && parsedAction.trait) {
        mods.push({
          id: crypto.randomUUID(),
          kind: 'trait',
          trait: parsedAction.trait,
          duration: linkedOrTemporaryDurationForAction(parsedAction, 'linked'),
          sourceId: sourceBoardCard.boardId,
          equipmentEffect: true
        });
      }
      if (parsedAction.type === 'type_addition_static' && attachmentEffectAppliesToAttachedCreature(parsedAction)) {
        mods.push({
          id: crypto.randomUUID(),
          kind: 'trait',
          trait: parsedAction.label || 'Additional type from Equipment',
          duration: linkedOrTemporaryDurationForAction(parsedAction, 'linked'),
          sourceId: sourceBoardCard.boardId,
          equipmentEffect: true
        });
      }
    }
    return mods;
  }

  function attachEquipmentOrAuraToTarget(sourceBoardCard, targetLike, action = {}) {
    const targetBoardCard = boardCards.find((card) => card.boardId === targetLike?.boardId) || targetLike;
    if (!sourceBoardCard?.boardId || !targetBoardCard?.boardId) return false;
    const sourceIsEquipment = isEquipmentBoardCard(sourceBoardCard) || /equip/i.test(`${action.type || ''} ${action.effectText || ''} ${action.label || ''}`);
    const linkedMods = buildEquipmentAttachmentMods(sourceBoardCard, targetBoardCard, boardCards);

    setBoardCards((cards) => {
      const currentTarget = cards.find((card) => card.boardId === targetBoardCard.boardId) || targetBoardCard;
      const stackIndex = cards
        .filter((card) => card.boardId !== sourceBoardCard.boardId && card.ownerSeat === currentTarget.ownerSeat && card.zone === currentTarget.zone && Number(card.slot || 0) === Number(currentTarget.slot || 0))
        .reduce((max, card) => Math.max(max, Number(card.stackIndex || 0)), Number(currentTarget.stackIndex || 0)) + 1;
      return cards.map((card) => {
        const withoutOldSourceMods = (card.mods || []).filter((mod) => !(mod.duration === 'linked' && mod.sourceId === sourceBoardCard.boardId));
        const detachedSourceIds = (card.attachedSourceIds || []).filter((id) => id !== sourceBoardCard.boardId);
        if (card.boardId === sourceBoardCard.boardId) {
          return {
            ...card,
            zone: currentTarget.zone,
            slot: currentTarget.slot,
            stackIndex,
            equippedTo: currentTarget.boardId,
            attachedTo: currentTarget.boardId,
            mods: withoutOldSourceMods
          };
        }
        if (card.boardId === currentTarget.boardId) {
          const attachedSourceIds = [...new Set([...detachedSourceIds, sourceBoardCard.boardId])];
          return {
            ...card,
            mods: [...withoutOldSourceMods, ...linkedMods],
            attachedSourceIds,
            equippedBy: sourceBoardCard.boardId
          };
        }
        return {
          ...card,
          mods: withoutOldSourceMods,
          attachedSourceIds: detachedSourceIds,
          equippedBy: card.equippedBy === sourceBoardCard.boardId ? (detachedSourceIds[0] || undefined) : card.equippedBy,
          equippedTo: card.equippedTo === currentTarget.boardId && card.boardId === sourceBoardCard.boardId ? undefined : card.equippedTo
        };
      });
    });
    const modSummary = linkedMods.filter((mod) => mod.kind === 'pt' || (mod.kind === 'trait' && !/^Equipped:|^Attached:/i.test(mod.trait || ''))).map((mod) => mod.kind === 'pt' ? `${mod.powerDelta >= 0 ? '+' : ''}${mod.powerDelta}/${mod.toughnessDelta >= 0 ? '+' : ''}${mod.toughnessDelta}` : mod.trait).join(', ');
    addGameNotice(`${sourceBoardCard.card.name}: attached to ${targetBoardCard.name || targetBoardCard.card?.name || 'target'}${modSummary ? ` and applied ${modSummary}` : ''}.`, sourceBoardCard.ownerSeat);
    return true;
  }

  async function applyAiAction(action, sourceBoardCard) {
    if (!action || !sourceBoardCard || action.type === 'noop' || action.skipAction) return;
    markActionCostPaid(action, sourceBoardCard);

    if (action.type === 'transform' || action.type === 'transform_source') {
      transformBoardCard(sourceBoardCard);
      return;
    }

    if ((action.type === 'exile' || action.type === 'exile_source') && /return (?:it|this card|this creature|this land|this permanent|.+?) to the battlefield(?: tapped)? and transformed|return (?:it|this card|this creature|this land|this permanent|.+?) to the battlefield transformed|return (?:it|this card|this creature|this land|this permanent|.+?) transformed|transformed under/i.test(`${action.effectText || ''} ${action.sourceText || ''} ${action.label || ''}`) && !action.target?.boardId) {
      transformBoardCard(sourceBoardCard);
      return;
    }

    if ((action.type === 'destroy' || action.type === 'exile') && action.target?.boardId) {
      const destination = action.type === 'exile' ? 'exile' : 'graveyard';
      moveCardsDirectlyToZone([action.target.boardId], destination);
      addGameNotice(`${sourceBoardCard.card.name}: ${action.type === 'exile' ? 'exiled' : 'destroyed'} ${action.target.name} → Player ${action.target.ownerSeat} ${destination}.`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'draw') {
      const count = action.count === 'X' || action.count === 'dynamic' ? 1 : Math.max(1, Number(action.count || 1));
      if (sourceBoardCard.ownerSeat === localSeat) {
        const drawn = library.slice(0, count);
        setLibrary((cards) => cards.slice(drawn.length));
        setHand((cards) => [...cards, ...drawn]);
      } else {
        setAiStates((currentAll) => {
          const current = currentAll[sourceBoardCard.ownerSeat];
          if (!current) return currentAll;
          const drawn = current.library.slice(0, count);
          return { ...currentAll, [sourceBoardCard.ownerSeat]: { ...current, library: current.library.slice(drawn.length), hand: [...current.hand, ...drawn] } };
        });
      }
      addGameNotice(`${sourceBoardCard.card.name}: drew ${count} card(s) for Player ${sourceBoardCard.ownerSeat}.`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'create_token') {
      const token = action.token || {};
      const count = Math.max(1, Number(token.count || 1));
      const tokenOwnerSeat = (action.controllerHint === 'targetController' && action.target?.ownerSeat) ? action.target.ownerSeat : sourceBoardCard.ownerSeat;
      const scryToken = await findScryfallTokenFor(token);
      const created = [];
      for (let i = 0; i < count; i += 1) {
        const slotInfo = nextSlot(tokenOwnerSeat, 'creatures');
        const tokenCard = scryToken || {
          scryfallId: `token-${Date.now()}-${i}`,
          name: `Custom ${token.power || '?'}/${token.toughness || '?'} ${token.name || 'Token'}`,
          typeLine: `${token.name || ''} Token Creature`.trim(),
          oracleText: `Custom fallback token created by ${sourceBoardCard.card.name}. Intended token: ${token.power || '?'}/${token.toughness || '?'} ${token.name || 'Token'}.`,
          manaCost: '',
          manaValue: 0,
          power: token.power || '',
          toughness: token.toughness || '',
          image: null,
          colors: [],
          customToken: true
        };
        created.push({
          boardId: crypto.randomUUID(),
          ownerSeat: tokenOwnerSeat,
          originalOwnerSeat: tokenOwnerSeat,
          controllerSeat: tokenOwnerSeat,
          zone: 'creatures',
          slot: slotInfo.slot + i,
          stackIndex: 0,
          tapped: false,
          token: true,
          card: { ...tokenCard, instanceId: crypto.randomUUID() },
          mods: tokenCard.customToken ? [{ id: crypto.randomUUID(), kind: 'trait', trait: 'Custom Token', duration: 'permanent', sourceId: sourceBoardCard.boardId }] : [],
          enteredTurn: turn,
          controlledSinceTurn: turn,
          controlledSinceStartOfTurn: false,
          playedAt: Date.now()
        });
      }
      setBoardCards((cards) => [...cards, ...created]);
      created.forEach((card) => emit({ type: 'play_card', card }));
      addGameNotice(`${sourceBoardCard.card.name}: created ${count} ${token.power && token.toughness ? `${token.power}/${token.toughness} ` : ''}${token.name || 'token'} token(s) for Player ${tokenOwnerSeat}${scryToken?.customToken ? ' using closest Scryfall image/custom badge' : scryToken ? ' using Scryfall token art' : ' using custom fallback'}.`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'search_library') {
      if (sourceBoardCard.ownerSeat === localSeat) {
        const result = chooseCardsFromLibraryForAction(sourceBoardCard, action, library);
        if (!result.found.length) return;
        setLibrary(result.nextLibrary);
        const handChoices = result.choices.filter((choice) => choice.destination !== 'battlefield').map((choice) => choice.card);
        if (handChoices.length) setHand((cards) => [...cards, ...handChoices]);
        putLibrarySearchChoicesOntoBoard(sourceBoardCard, result.choices);
        addGameNotice(`${sourceBoardCard.card.name}: library search selected ${result.choices.length}/${result.criteria.maxChoices || result.choices.length} card(s): ${result.choices.map((choice) => `Choice ${choice.index + 1} ${choice.card.name} → ${choice.destination}${choice.tapped ? ' tapped' : ''}`).join('; ')}.`, sourceBoardCard.ownerSeat);
      } else {
        setAiStates((currentAll) => {
          const current = currentAll[sourceBoardCard.ownerSeat];
          if (!current) return currentAll;
          const result = chooseCardsFromLibraryForAction(sourceBoardCard, action, current.library);
          if (!result.found.length) return currentAll;
          const handChoices = result.choices.filter((choice) => choice.destination !== 'battlefield').map((choice) => choice.card);
          putLibrarySearchChoicesOntoBoard(sourceBoardCard, result.choices);
          addGameNotice(`${sourceBoardCard.card.name}: library search selected ${result.choices.length}/${result.criteria.maxChoices || result.choices.length} card(s): ${result.choices.map((choice) => `Choice ${choice.index + 1} ${choice.card.name} → ${choice.destination}${choice.tapped ? ' tapped' : ''}`).join('; ')}${result.criteria.reveal ? ' and revealed them' : ''}.`, sourceBoardCard.ownerSeat);
          return { ...currentAll, [sourceBoardCard.ownerSeat]: { ...current, library: result.nextLibrary, hand: [...current.hand, ...handChoices] } };
        });
      }
      return;
    }

    if (action.type === 'mill') {
      const count = action.count === 'X' || action.count === 'dynamic' ? 1 : Math.max(1, Number(action.count || action.millCount || 1));
      const seat = action.target?.seat || sourceBoardCard.ownerSeat;
      const sourceLibrary = seat === localSeat ? library : (aiStates[seat]?.library || []);
      const milled = sourceLibrary.slice(0, count);
      if (!milled.length) return;
      if (seat === localSeat) setLibrary((cards) => cards.slice(milled.length));
      else setAiStates((currentAll) => {
        const current = currentAll[seat];
        if (!current) return currentAll;
        return { ...currentAll, [seat]: { ...current, library: current.library.slice(milled.length) } };
      });
      const created = milled.map((card, index) => {
        const slotInfo = nextSlot(seat, 'graveyard', card);
        return { boardId: crypto.randomUUID(), ownerSeat: seat, originalOwnerSeat: seat, controllerSeat: seat, zone: 'graveyard', slot: 0, stackIndex: slotInfo.stackIndex + index, tapped: false, card, mods: [], enteredTurn: turn, controlledSinceTurn: turn, controlledSinceStartOfTurn: false, playedAt: Date.now() + index };
      });
      setBoardCards((cards) => [...cards, ...created]);
      created.forEach((card) => emit({ type: 'play_card', card }));
      addGameNotice(`${sourceBoardCard.card.name}: Player ${seat} mills ${milled.length} card(s).`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'return_to_hand' && action.target?.boardId) {
      const target = boardCards.find((card) => card.boardId === action.target.boardId) || action.target;
      setBoardCards((cards) => cards.filter((card) => card.boardId !== action.target.boardId));
      if (target.ownerSeat === localSeat) setHand((cards) => [...cards, target.card || target]);
      else setAiStates((currentAll) => {
        const current = currentAll[target.ownerSeat];
        if (!current) return currentAll;
        return { ...currentAll, [target.ownerSeat]: { ...current, hand: [...current.hand, target.card || target] } };
      });
      emit({ type: 'remove_board_cards', boardIds: [action.target.boardId] });
      addGameNotice(`${sourceBoardCard.card.name}: returned ${action.target.name || target.card?.name || 'target'} to hand.`, sourceBoardCard.ownerSeat);
      return;
    }

    if (['move_to_battlefield', 'return_to_battlefield', 'return_from_graveyard_to_battlefield'].includes(action.type) && action.target?.boardId) {
      const target = boardCards.find((card) => card.boardId === action.target.boardId) || action.target;
      const zone = likelyZoneForCard(target.card || target);
      moveCardsDirectlyToZone([action.target.boardId], zone);
      addGameNotice(`${sourceBoardCard.card.name}: returned ${action.target.name || target.card?.name || 'target'} to the battlefield.`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'put_from_hand_to_battlefield') {
      const seat = sourceBoardCard.ownerSeat;
      const sourceHand = seat === localSeat ? hand : (aiStates[seat]?.hand || []);
      const filterText = `${action.cardFilterText || action.affectedObjects || action.effectText || ''}`;
      const foundIndex = sourceHand.findIndex((card) => {
        const text = cardTypeText(card);
        if (/creature/i.test(filterText) && !/\bCreature\b/i.test(text)) return false;
        if (/permanent/i.test(filterText) && /\bInstant\b|\bSorcery\b/i.test(text)) return false;
        return true;
      });
      if (foundIndex < 0) return;
      const chosen = sourceHand[foundIndex];
      if (seat === localSeat) setHand((cards) => cards.filter((_, index) => index !== foundIndex));
      else setAiStates((currentAll) => {
        const current = currentAll[seat];
        if (!current) return currentAll;
        return { ...currentAll, [seat]: { ...current, hand: current.hand.filter((_, index) => index !== foundIndex) } };
      });
      const zone = likelyZoneForCard(chosen);
      const slotInfo = nextSlot(seat, zone, chosen);
      const boardCard = { boardId: crypto.randomUUID(), ownerSeat: seat, originalOwnerSeat: seat, controllerSeat: seat, zone, slot: slotInfo.slot, stackIndex: slotInfo.stackIndex, tapped: Boolean(action.tapped) || aiCardEntersTapped(chosen), card: chosen, mods: [], enteredTurn: turn, controlledSinceTurn: turn, controlledSinceStartOfTurn: false, playedAt: Date.now() };
      setBoardCards((cards) => [...cards, boardCard]);
      emit({ type: 'play_card', card: boardCard });
      addGameNotice(`${sourceBoardCard.card.name}: put ${chosen.name} from hand onto the battlefield.`, sourceBoardCard.ownerSeat);
      autoResolveCardOnEntry(boardCard, [...boardCards, boardCard]);
      return;
    }

    if ((action.type === 'attach_permanent' || action.type === 'equip') && action.target?.boardId) {
      attachEquipmentOrAuraToTarget(sourceBoardCard, action.target, action);
      return;
    }

    if (action.type === 'add_counters') {
      const amount = action.counterAmount === 'X' ? Math.max(1, Number(getCardStats(sourceBoardCard).power || 1)) : Math.max(1, Number(action.counterAmount || 1));
      const mod = { id: crypto.randomUUID(), kind: 'counter', counterType: action.counterType || '+1/+1', counterAmount: amount, powerDelta: Number(action.powerDelta || 1) * amount, toughnessDelta: Number(action.toughnessDelta || 1) * amount, duration: 'permanent', sourceId: sourceBoardCard.boardId };
      setBoardCards((cards) => cards.map((card) => {
        const sameController = card.ownerSeat === sourceBoardCard.ownerSeat;
        const isCreature = /\bCreature\b/i.test(card.card?.typeLine || '');
        const affected = String(action.affectedObjects || action.sourceText || '').toLowerCase();
        const greenOnly = /green creature/.test(affected);
        const isGreen = /\bG\b|green/i.test(`${card.card?.colors?.join(' ') || ''} ${card.card?.oracleText || ''} ${card.card?.typeLine || ''}`);
        if (sameController && isCreature && (/each .*creature|creatures you control/i.test(affected)) && (!greenOnly || isGreen)) return { ...card, mods: [...(card.mods || []), mod] };
        if (action.target?.boardId && card.boardId === action.target.boardId) return { ...card, mods: [...(card.mods || []), mod] };
        return card;
      }));
      addGameNotice(`${sourceBoardCard.card.name}: applied ${amount} ${action.counterType || '+1/+1'} counter(s).`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'grant_trait') {
      applyFilteredMod(action, sourceBoardCard, () => ({
        id: crypto.randomUUID(),
        kind: 'trait',
        trait: action.trait,
        duration: linkedOrTemporaryDurationForAction(action, 'eot'),
        sourceId: sourceBoardCard.boardId,
        affectedObjects: action.affectedObjects || ''
      }));
      addGameNotice(`${sourceBoardCard.card.name}: applied static effect ${action.label}.`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'modify_pt') {
      const duration = linkedOrTemporaryDurationForAction(action, 'permanent');
      applyFilteredMod(action, sourceBoardCard, () => ({
        id: crypto.randomUUID(),
        kind: 'pt',
        powerDelta: action.powerDelta || 0,
        toughnessDelta: action.toughnessDelta || 0,
        duration,
        sourceId: sourceBoardCard.boardId,
        affectedObjects: action.affectedObjects || ''
      }));
      addGameNotice(`${sourceBoardCard.card.name}: applied ${action.label}.`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'set_base_pt') {
      const duration = linkedOrTemporaryDurationForAction(action, 'permanent');
      applyFilteredMod(action, sourceBoardCard, () => ({
        id: crypto.randomUUID(),
        kind: 'base_pt',
        basePower: action.basePower,
        baseToughness: action.baseToughness,
        duration,
        sourceId: sourceBoardCard.boardId,
        affectedObjects: action.affectedObjects || ''
      }));
      addGameNotice(`${sourceBoardCard.card.name}: applied ${action.label}.`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'gain_life') {
      const amount = action.amount === 'X' || action.amount === 'dynamic' ? 1 : Math.max(0, Number(action.amount || 0));
      if (amount > 0) {
        updateLifeTotal(sourceBoardCard.ownerSeat, 'life', amount);
        addGameNotice(`${sourceBoardCard.card.name}: Player ${sourceBoardCard.ownerSeat} gains ${amount} life.`, sourceBoardCard.ownerSeat);
      }
      return;
    }

    if (action.type === 'set_life_total') {
      const life = Math.max(0, Number(action.lifeTotal || 0));
      setLifeTotals((current) => ({
        ...current,
        [sourceBoardCard.ownerSeat]: {
          ...(current[sourceBoardCard.ownerSeat] || { life: STARTING_LIFE, infect: STARTING_INFECT, commander: 0 }),
          life
        }
      }));
      addGameNotice(`${sourceBoardCard.card.name}: Player ${sourceBoardCard.ownerSeat} life total becomes ${life}.`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'lose_life') {
      const amount = action.amount === 'X' || action.amount === 'dynamic' ? 1 : Math.max(0, Number(action.amount || 0));
      if (amount > 0) {
        const targetSeat = action.target?.seat || action.targetSeat || (action.ownerHint === 'opponent' ? SEATS.find((seat) => seat !== sourceBoardCard.ownerSeat && players[seat]) : sourceBoardCard.ownerSeat);
        updateLifeTotal(targetSeat || sourceBoardCard.ownerSeat, 'life', -amount);
        addGameNotice(`${sourceBoardCard.card.name}: Player ${targetSeat || sourceBoardCard.ownerSeat} loses ${amount} life.`, sourceBoardCard.ownerSeat);
      }
      return;
    }

    if (action.type === 'direct_damage') {
      const amount = action.amount === 'X' || action.damageFormula === 'power' ? 1 : Math.max(0, Number(action.amount || action.damage || 0));
      const targetSeat = action.target?.seat || action.targetSeat || (/opponent|player/i.test(action.damageTargetText || action.affectedObjects || '') ? SEATS.find((seat) => seat !== sourceBoardCard.ownerSeat && players[seat]) : null);
      if (targetSeat && amount > 0) {
        updateLifeTotal(targetSeat, 'life', -amount);
        addGameNotice(`${sourceBoardCard.card.name}: dealt ${amount} damage to Player ${targetSeat}.`, sourceBoardCard.ownerSeat);
      } else if (action.target?.boardId && amount > 0) {
        addGameNotice(`${sourceBoardCard.card.name}: ${amount} damage marked for ${action.target.name}. Damage marking is review-friendly for now.`, sourceBoardCard.ownerSeat);
      }
      return;
    }

    if (action.type === 'untap' && action.target?.boardId) {
      const nextSnapshot = boardCards.map((card) => card.boardId === action.target.boardId ? { ...card, tapped: false } : card);
      setBoardCards(nextSnapshot);
      emit({ type: 'tap_cards', boardIds: [action.target.boardId], tapped: false });
      addGameNotice(`${sourceBoardCard.card.name}: untapped ${action.target.name}.`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'tap' && action.target?.boardId) {
      const nextSnapshot = boardCards.map((card) => card.boardId === action.target.boardId ? { ...card, tapped: true } : card);
      setBoardCards(nextSnapshot);
      emit({ type: 'tap_cards', boardIds: [action.target.boardId], tapped: true });
      addGameNotice(`${sourceBoardCard.card.name}: tapped ${action.target.name}.`, sourceBoardCard.ownerSeat);
      fireWatchersForEvent({ id: safeId('tap-action'), type: 'card_tapped', seat: action.target.ownerSeat, card: action.target }, nextSnapshot);
      return;
    }

    if (['choose_color', 'choose_creature_type', 'choose_card_type', 'choose_card_name', 'modal_choice_rule'].includes(action.type) || action.chosenColor || action.chosenType || action.chosenCardType || action.chosenCardName || action.chosenMode) {
      const choiceText = action.chosenColor || action.chosenType || action.chosenCardType || action.chosenCardName || action.chosenMode || action.playerChoice || 'choice recorded';
      const mod = { id: crypto.randomUUID(), kind: 'choice', choiceKind: action.choiceKind || actionChoiceKind(action) || action.type, choice: choiceText, trait: `Chosen: ${choiceText}`, duration: 'linked', sourceId: sourceBoardCard.boardId };
      setBoardCards((cards) => cards.map((card) => card.boardId === sourceBoardCard.boardId ? { ...card, mods: [...(card.mods || []), mod], savedChoices: [...(card.savedChoices || []), mod] } : card));
      addGameNotice(`${sourceBoardCard.card.name}: recorded choice — ${choiceText}.`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'add_player_counters') {
      addGameNotice(`${sourceBoardCard.card.name}: Player ${sourceBoardCard.ownerSeat} gets ${action.counterAmount || 1} ${action.counterType || 'counter'} counter(s).`, sourceBoardCard.ownerSeat);
      return;
    }

    if (action.type === 'add_mana') {
      addGameNotice(`${sourceBoardCard.card.name}: activated mana ability (${action.label}).`, sourceBoardCard.ownerSeat);
    }
  }

  function handleAiReview(verdict, shouldApply = false, note = '', selectedAction = null, options = {}) {
    if (!aiReview?.plan) return;
    const nextBrain = recordAiFeedback(aiBrain, aiReview.plan, verdict, note, options);
    setAiBrain(nextBrain);
    const shouldApplyNow = shouldApply && !aiReview.deferResolution;
    if (shouldApply && aiReview.deferResolution) {
      addGameNotice('AI review approved during priority. No effect was applied yet; use Pass priority / resolve to finish resolving the spell.', aiReview.boardCard?.ownerSeat);
    }
    if (shouldApplyNow) {
      const actionable = selectedAction || aiReview.selectedAction || aiReview.plan.actions.find((action) => isActionUsable(action));
      if (actionable) {
        const sameAbilityActions = aiReview.plan.actions.filter((action) => action.abilityId === actionable.abilityId);
        const actionsToApply = sameAbilityActions.length > 1 ? sameAbilityActions : [actionable];
        actionsToApply.forEach((action) => {
          const hydrated = action.target ? action : { ...action, target: actionable.target || action.target };
          if (isActionUsable(hydrated) || ['create_token', 'grant_trait', 'add_counters', 'draw', 'search_library'].includes(hydrated.type)) applyAiAction(hydrated, aiReview.boardCard);
        });
      }
    }
    const isLastQueuedAbility = (aiReview.abilityIndex || 0) >= ((aiReview.abilityCount || 1) - 1);
    if (isLastQueuedAbility) {
      if (aiReview.deferResolution) {
        setPendingAiAfterStack((pending) => {
          if (!pending || (aiReview.stackId && pending.stackId !== aiReview.stackId)) return pending;
          const nextPending = { ...pending, reviewComplete: true, reviewInProgress: false };
          if (responsePromptsEnabled) {
            setResponsePrompt(priorityPromptForPendingAiCast(nextPending, 'reviewed'));
          } else {
            setResponsePrompt(null);
            setTimeout(() => resolveAiStackItem(nextPending), 520);
          }
          return nextPending;
        });
        addGameNotice(responsePromptsEnabled ? `AI learning check finished for ${aiReview.boardCard.card.name}; priority prompt is still open for final resolution.` : `AI learning check finished for ${aiReview.boardCard.card.name}; response prompts are off, so priority auto-passes.`, aiReview.boardCard.ownerSeat);
      } else if (aiReview.resolveDestination === 'exile' && isTransientSpell(aiReview.boardCard)) {
        moveCardsDirectlyToZone([aiReview.boardCard.boardId], 'exile');
        addGameNotice(`Flashback resolved: ${aiReview.boardCard.card.name} moved to exile.`, aiReview.boardCard.ownerSeat);
      } else {
        moveResolvedSpellToGraveyard(aiReview.boardCard);
      }
    }
    setAiReview(null);
  }

  function beginCombat() {
    if (activeSeat !== localSeat) {
      addGameNotice(`Combat button ignored: Player ${activeSeat} is active.`, activeSeat);
      return;
    }
    clearFloatingUi();
    announcePhase({ seat: localSeat, label: `P${localSeat} Combat — Declare Attackers`, step: 'combat-select', message: 'Combat phase started. Choose attackers, or confirm with none to move to Main Phase 2.', tone: 'combat' });
    setCombatState({ phase: 'combat-select', attackers: [], blockers: [], warnings: [], summary: null, attackingSeat: localSeat, defendingSeat: null, pendingBlockerId: null });
    addGameNotice('Combat phase: tap/click legal creatures in your creature zone to select attackers, then confirm attackers. Opponents still get a combat window if you choose none.', localSeat);
  }

  function creatureCombatStats(boardCard) {
    const stats = getCardStats(boardCard);
    return {
      power: Number(stats.power || 0) || 0,
      toughness: Number(stats.toughness || 0) || 0,
      traits: getCardTraits(boardCard).map((trait) => trait.toLowerCase()),
      text: `${boardCard?.card?.oracleText || ''} ${(boardCard?.mods || []).map((mod) => mod.trait || '').join(' ')}`.toLowerCase()
    };
  }

  function buildCombatSummary(attackers, blockerAssignments = [], attackingSeat = localSeat, defendingSeat = null, options = {}) {
    const actualDefender = defendingSeat || (attackingSeat === localSeat ? (aiSeats[0] || SEATS.find((seat) => seat !== localSeat && players[seat]) || 2) : localSeat);
    const pairs = attackers.map((attacker) => {
      const assignment = blockerAssignments.find((item) => item.attackerId === attacker.boardId);
      const blocker = assignment ? boardCards.find((card) => card.boardId === assignment.blockerId) : null;
      const attackerStats = creatureCombatStats(attacker);
      const blockerStats = blocker ? creatureCombatStats(blocker) : null;
      const notes = [];
      const deaths = [];
      let playerDamage = 0;
      let commanderDamage = 0;
      let infectDamage = 0;
      let lifeGain = 0;
      const doubleStrike = attackerStats.text.includes('double strike');
      const damageMultiplier = doubleStrike && !blocker ? 2 : 1;
      if (attackerStats.text.includes('first strike')) notes.push('First strike detected; summary is still approximate but flags it for review.');
      if (doubleStrike) notes.push('Double strike detected; unblocked player damage is doubled here, blocked combat is still review/override friendly.');
      if (blocker) {
        if (attackerStats.power >= blockerStats.toughness || attackerStats.text.includes('deathtouch')) deaths.push(blocker.boardId);
        if (blockerStats.power >= attackerStats.toughness || blockerStats.text.includes('deathtouch')) deaths.push(attacker.boardId);
        if (attackerStats.text.includes('trample')) {
          const overflow = Math.max(0, attackerStats.power - blockerStats.toughness);
          playerDamage = overflow;
          if (overflow) notes.push(`Trample overflow estimated at ${overflow}.`);
        }
        if (attackerStats.text.includes('lifelink')) lifeGain = Math.max(0, attackerStats.power);
        notes.push(`${attacker.card.name} is blocked by ${blocker.card.name}.`);
      } else {
        playerDamage = Math.max(0, attackerStats.power * damageMultiplier);
        if (attackerStats.text.includes('infect') || attackerStats.text.includes('toxic')) infectDamage = playerDamage;
        if (attacker.isCommander) commanderDamage = playerDamage;
        if (attackerStats.text.includes('lifelink')) lifeGain = playerDamage;
        notes.push(`${attacker.card.name} is unblocked for ${playerDamage} damage.`);
      }
      return { attackerId: attacker.boardId, attackerName: attacker.card.name, blockerId: blocker?.boardId || null, blockerName: blocker?.card?.name || '', deaths: [...new Set(deaths)], playerDamage, commanderDamage, infectDamage, lifeGain, notes, approved: true };
    });
    const totals = pairs.reduce((acc, pair) => ({
      damage: acc.damage + Number(pair.playerDamage || 0),
      commanderDamage: acc.commanderDamage + Number(pair.commanderDamage || 0),
      infectDamage: acc.infectDamage + Number(pair.infectDamage || 0),
      lifeGain: acc.lifeGain + Number(pair.lifeGain || 0)
    }), { damage: 0, commanderDamage: 0, infectDamage: 0, lifeGain: 0 });
    return { defendingSeat: actualDefender, attackingSeat, pairs, totals, autoAdvanceAfterApply: Boolean(options.autoAdvanceAfterApply), responseWindow: options.responseWindow || '' };
  }

  function confirmCombatSelection() {
    if (combatState.phase !== 'combat-select') {
      beginCombat();
      return;
    }
    const attackers = boardCards.filter((card) => combatState.attackers.includes(card.boardId));
    if (!attackers.length) {
      setCombatState({ phase: 'main2', attackers: [], blockers: [], warnings: [], summary: null, attackingSeat: null, defendingSeat: null, pendingBlockerId: null });
      addGameNotice('Combat phase confirmed with no attackers. Beginning/end combat windows are acknowledged; no combat damage to assign.', localSeat);
      startSecondMainPhase(localSeat, 'No attackers declared. You are now in Main Phase 2.');
      return;
    }
    const attackerIds = attackers.map((card) => card.boardId);
    const nonVigilant = attackers.filter((card) => !/vigilance/i.test(`${card.card?.oracleText || ''} ${(card.mods || []).map((mod) => mod.trait || '').join(' ')}`)).map((card) => card.boardId);
    if (nonVigilant.length) {
      setBoardCards((cards) => cards.map((card) => nonVigilant.includes(card.boardId) ? { ...card, tapped: true } : card));
      emit({ type: 'tap_cards', boardIds: nonVigilant, tapped: true });
      addGameNotice(`Player ${localSeat} taps ${nonVigilant.length} attacking creature(s).`, localSeat);
    }
    const defenderSeat = aiSeats[0] || SEATS.find((seat) => seat !== localSeat && players[seat]) || 2;
    const blockers = chooseAiBlockers({ attackers, boardCards, seat: defenderSeat });
    const summary = buildCombatSummary(attackers, blockers, localSeat, defenderSeat);
    setCombatState({ phase: 'combat-damage', attackers: attackers.map((card) => card.boardId), blockers, warnings: [], summary, attackingSeat: localSeat, defendingSeat: defenderSeat });
    publishAiThought([
      `AI blockers for Player ${defenderSeat}:`,
      blockers.length ? blockers.map((item) => `- ${item.reason}`).join('\n') : '- No profitable/legal blocks chosen. Taking damage unless you override.'
    ], 'append', defenderSeat);
  }

  function confirmBlockers() {
    if (combatState.phase !== 'combat-blockers') return;
    const attackers = boardCards.filter((card) => combatState.attackers.includes(card.boardId));
    const summary = buildCombatSummary(
      attackers,
      combatState.blockers || [],
      combatState.attackingSeat,
      combatState.defendingSeat || localSeat,
      { autoAdvanceAfterApply: true, responseWindow: 'Blockers confirmed. Review combat results, then apply or manually adjust.' }
    );
    setCombatState((current) => ({ ...current, phase: 'combat-damage', summary }));
    publishAiThought(
      combatState.blockers?.length
        ? [`Player ${localSeat} declared blockers:`, ...(combatState.blockers || []).map((item) => `- ${item.blockerName || 'Blocker'} blocks ${item.attackerName || 'attacker'}`)]
        : `Player ${localSeat} declared no blockers.`,
      'append',
      localSeat
    );
  }


  function applyCombatSummary(summary, approvedPairs = null) {
    const pairs = approvedPairs || summary?.pairs || [];
    if (!summary) return;
    const approved = pairs.filter((pair) => pair.approved !== false);
    const deathIds = [...new Set(approved.flatMap((pair) => pair.deaths || []))];
    if (deathIds.length) moveCardsDirectlyToZone(deathIds, 'graveyard');
    const totals = approved.reduce((acc, pair) => ({
      damage: acc.damage + Number(pair.playerDamage || 0),
      commanderDamage: acc.commanderDamage + Number(pair.commanderDamage || 0),
      infectDamage: acc.infectDamage + Number(pair.infectDamage || 0),
      lifeGain: acc.lifeGain + Number(pair.lifeGain || 0)
    }), { damage: 0, commanderDamage: 0, infectDamage: 0, lifeGain: 0 });
    if (totals.damage) updateLifeTotal(summary.defendingSeat, 'life', -totals.damage);
    if (totals.infectDamage) updateLifeTotal(summary.defendingSeat, 'infect', totals.infectDamage);
    if (totals.commanderDamage) updateLifeTotal(summary.defendingSeat, 'commander', totals.commanderDamage);
    if (totals.lifeGain) updateLifeTotal(summary.attackingSeat, 'life', totals.lifeGain);
    approved.forEach((pair) => {
      const attacker = boardCards.find((card) => card.boardId === pair.attackerId);
      if (!attacker) return;
      const damage = Number(pair.playerDamage || 0) || Number(pair.commanderDamage || 0) || Number(pair.infectDamage || 0);
      if (damage > 0) fireWatchersForEvent({ id: safeId('combat-damage'), type: 'combat_damage', seat: summary.attackingSeat, defendingSeat: summary.defendingSeat, card: attacker, sourceCard: attacker, damage, playerDamage: Number(pair.playerDamage || 0) }, boardCards);
    });

    const damageEvents = approved.map((pair) => {
      const attacker = boardCards.find((card) => card.boardId === pair.attackerId);
      if (!attacker || deathIds.includes(pair.attackerId)) return null;
      const attackedDuringOwnTurn = attacker.ownerSeat === summary.attackingSeat;
      if (!attackedDuringOwnTurn) return null;
      const blocker = pair.blockerId ? boardCards.find((card) => card.boardId === pair.blockerId) : null;
      const amount = blocker ? Math.max(0, creatureCombatStats(attacker).power) : Math.max(0, Number(pair.playerDamage || 0));
      return amount > 0 ? { attacker, amount } : null;
    }).filter(Boolean);

    if (damageEvents.length) {
      const triggerSources = boardCards.filter((card) => card.ownerSeat === summary.attackingSeat && !deathIds.includes(card.boardId));
      const bonusByCreature = new Map();
      const triggerNotices = [];
      for (const source of triggerSources) {
        const activeSource = withActiveFaceCard(source);
        const plan = buildAiCardPlan(activeSource.card, buildAiContext(source.ownerSeat, boardCards, source.ownerSeat === localSeat ? null : aiStates[source.ownerSeat], source.boardId), aiBrain);
        plan.actions.filter((action) => action.type === 'add_counters' && /combat damage/i.test(action.triggerText || '')).forEach((action) => {
          if (/during your turn/i.test(action.triggerText || '') && summary.attackingSeat !== source.ownerSeat) return;
          damageEvents.forEach(({ attacker, amount }) => {
            const delta = action.counterAmount === 'damageDealt' ? amount : (action.counterAmount === 'X' ? amount : Math.max(1, Number(action.counterAmount || 1)));
            bonusByCreature.set(attacker.boardId, (bonusByCreature.get(attacker.boardId) || 0) + delta);
            triggerNotices.push(`${getActiveCardForBoard(source)?.name || source.card.name} triggered from combat damage: ${getActiveCardForBoard(attacker)?.name || attacker.card.name} gets ${delta} ${action.counterType || '+1/+1'} counter(s).`);
          });
        });
      }
      if (bonusByCreature.size) {
        setBoardCards((cards) => cards.map((card) => {
          const amount = bonusByCreature.get(card.boardId);
          if (!amount || deathIds.includes(card.boardId)) return card;
          return {
            ...card,
            mods: [...(card.mods || []), { id: crypto.randomUUID(), kind: 'counter', counterType: '+1/+1', counterAmount: amount, powerDelta: amount, toughnessDelta: amount, duration: 'permanent', sourceId: card.boardId }]
          };
        }));
        triggerNotices.forEach((notice) => addGameNotice(notice, summary.attackingSeat));
      }
    }

    setCombatState({ phase: 'main2', attackers: [], blockers: [], warnings: [], summary: null, attackingSeat: null, defendingSeat: null, pendingBlockerId: null });
    setSelection(null);
    addGameNotice(`Combat applied: ${deathIds.length} death(s), ${totals.damage} damage, ${totals.lifeGain} lifelink life gained.`, summary.attackingSeat);
    if (summary.autoAdvanceAfterApply) {
      setTimeout(() => runAiSecondMainPhase(summary.attackingSeat), 450);
    } else {
      startSecondMainPhase(summary.attackingSeat, 'Combat finished. You are now in Main Phase 2.');
    }
  }

  function advanceTurnFrom(seatToAdvanceFrom) {
    const currentEliminated = new Set(eliminatedSeats);
    SEATS.forEach((seat) => {
      if (!players[seat]) return;
      const totals = lifeTotals[seat] || { life: STARTING_LIFE, infect: 0, commander: 0 };
      if (Number(totals.life || 0) <= 0 || Number(totals.infect || 0) >= 10 || Number(totals.commander || 0) >= 21) currentEliminated.add(seat);
    });
    const occupiedSeats = SEATS.filter((seat) => players[seat] && !currentEliminated.has(seat));
    if (currentEliminated.size !== eliminatedSeats.length) {
      const newlyGone = [...currentEliminated].filter((seat) => !eliminatedSeats.includes(seat));
      setEliminatedSeats([...currentEliminated]);
      newlyGone.forEach((seat) => addGameNotice(`End-turn state check: Player ${seat} is eliminated.`, seat));
    }
    if (occupiedSeats.length <= 1) {
      const winner = occupiedSeats[0] || null;
      setWinnerSeat(winner);
      if (winner) addGameNotice(`Victory check: Player ${winner} is the last player standing.`, winner);
      setCombatState({ phase: 'main', attackers: [], blockers: [], warnings: [], summary: null, attackingSeat: null, defendingSeat: null, pendingBlockerId: null });
      return;
    }
    const currentIndex = Math.max(0, occupiedSeats.indexOf(seatToAdvanceFrom));
    const nextSeat = occupiedSeats[(currentIndex + 1) % occupiedSeats.length] || occupiedSeats[0] || 1;
    const nextTurn = nextSeat === occupiedSeats[0] ? turn + 1 : turn;
    const nextPhaseLabel = turnStartPhaseLabel(nextSeat);
    setActiveSeat(nextSeat);
    setTurn(nextTurn);
    setPhaseLabel(nextPhaseLabel);
    setLandPlayedThisTurn(false);
    setCombatState({ phase: 'main', attackers: [], blockers: [], warnings: [], summary: null, attackingSeat: null, defendingSeat: null, pendingBlockerId: null });
    setResponsePrompt(null);
    queueTurnStartToasts(nextSeat, nextTurn);
    setBoardCards((cards) => cards.map((card) => {
      if (card.ownerSeat !== nextSeat) return card;
      const locked = /does(?:n'?t| not) untap/i.test(card.card?.oracleText || '');
      return { ...card, tapped: locked ? card.tapped : false, controlledSinceStartOfTurn: true };
    }));
    emit({ type: 'turn_update', activeSeat: nextSeat, turn: nextTurn, phaseLabel: nextPhaseLabel });
    setTurnEventLog([]);
    setTimeout(() => fireWatchersForEvent({ id: safeId('turn-start'), type: 'turn_step', step: 'upkeep', seat: nextSeat }, boardCards), 80);
    if (isHost && players[nextSeat]?.ai) setTimeout(() => runAiTurn(nextSeat), 650);
  }

  function endTurn() {
    fireWatchersForEvent({ id: safeId('end-step'), type: 'turn_step', step: 'end', seat: activeSeat }, boardCards);
    clearEndOfTurnMods();
    advanceTurnFrom(activeSeat);
  }



  function runAiCombatOnly(seat = 2) {
    if (!players[seat]?.ai) return;
    if (aiReview || aiReviewQueue.length) {
      setPendingAiAfterReview({ type: 'combat', seat });
      return;
    }
    const opponentSeat = localSeat;
    const currentAiState = aiStates[seat] || { hand: [], library: [] };
    const combatInventory = buildAiAbilityInventory({ boardCards, seat, turn, brain: aiBrain });
    const attackPlan = chooseAiAttackers({ boardCards, seat, turn, opponentLife: lifeTotals[opponentSeat]?.life || STARTING_LIFE, inventory: combatInventory, hand: currentAiState.hand || [] });
    const attackers = boardCards.filter((card) => attackPlan.some((item) => item.boardId === card.boardId));
    if (!attackers.length) {
      announcePhase({ seat, label: `P${seat} Combat`, step: 'combat', message: `Player ${seat} moved to combat and chose no attackers.`, tone: 'combat' });
      publishAiThought('Combat thought: AI chooses no attacks right now.', 'append', seat);
      setTimeout(() => {
        emit({ type: 'drag_clear', ownerSeat: seat });
        runAiSecondMainPhase(seat);
      }, 900);
      return;
    }
    const attackerIds = attackers.map((card) => card.boardId);
    const nextBoardCards = boardCards.map((card) => attackerIds.includes(card.boardId) && !/vigilance/i.test(`${card.card?.oracleText || ''} ${(card.mods || []).map((mod) => mod.trait || '').join(' ')}`) ? { ...card, tapped: true } : card);
    setBoardCards(nextBoardCards);
    emit({ type: 'tap_cards', boardIds: attackerIds, tapped: true });
    announcePhase({ seat, label: `P${seat} Combat — Declare Blockers`, step: 'combat-blockers', message: `Opponent declared attackers: ${attackers.map((card) => card.card?.name || 'Creature').join(', ')}. Declare blockers or respond.`, tone: 'combat', duration: 7000 });
    setResponsePrompt({ type: 'combat', seat, title: `Combat Started — P${seat} declared attackers`, message: `${attackers.map((card) => card.card?.name || 'Creature').join(', ')} attacking Player ${opponentSeat}. You may respond before declaring blockers.` });
    setCombatState({
      phase: 'combat-blockers',
      attackers: attackerIds,
      blockers: [],
      warnings: [],
      summary: null,
      attackingSeat: seat,
      defendingSeat: opponentSeat
    });
    publishAiThought([
      'Combat action: AI declares attackers and taps them now.',
      ...attackers.map((card) => `- ${card.card?.name || 'Creature'} attacks Player ${opponentSeat}`),
      'Declare blockers: tap/click your legal blockers, then press Confirm Blockers. You can also respond with instant-speed actions before confirming.'
    ], 'append', seat);
  }


  function runAiSecondMainPhase(seat = 2) {
    if (!players[seat]?.ai) {
      advanceTurnFrom(seat);
      return;
    }
    if (aiReview || aiReviewQueue.length) {
      setPendingAiAfterReview({ type: 'postcombat-main', seat });
      return;
    }
    startSecondMainPhase(seat, `Player ${seat} is checking for Main Phase 2 plays after combat.`);
    setAiStates((allStates) => {
      const current = allStates[seat];
      if (!current) {
        setTimeout(() => advanceTurnFrom(seat), 500);
        return allStates;
      }
      let handNext = [...(current.hand || [])];
      const libraryNext = [...(current.library || [])];
      let localBoardCards = boardCards;
      const inventory = buildAiAbilityInventory({ boardCards: localBoardCards, seat, turn, brain: aiBrain });
      publishAiThought(`Main Phase 2 recheck: AI has ${inventory.totalUsableMana} usable mana source(s) after combat.`, 'append', seat);
      const context = buildAiContext(seat, localBoardCards, { ...current, hand: handNext, library: libraryNext });
      const skippedCastNotes = [];
      const castChoices = handNext
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => !isLand(card) && chooseAiManaSourcesForCost(inventory, card).length > 0)
        .map((choice) => {
          const plan = buildAiCardPlan(choice.card, context, aiBrain);
          const hasRequiredTargetedAction = plan.actions.some((action) => actionNeedsTarget(action));
          const hasUsableAction = plan.actions.some((action) => isActionUsable(action));
          const legal = !hasRequiredTargetedAction || hasUsableAction;
          if (!legal) skippedCastNotes.push(`Main Phase 2 skipped ${choice.card.name}: no legal target/choice for its required effect.`);
          return { ...choice, plan, legal, score: legal ? scoreAiCardForCast(choice.card, context, aiBrain) : -999 };
        })
        .filter((choice) => choice.legal && choice.score > 0)
        .sort((a, b) => b.score - a.score);
      if (skippedCastNotes.length) publishAiThought(skippedCastNotes, 'append', seat);
      const castIndex = castChoices[0]?.index ?? -1;
      if (castIndex < 0) {
        publishAiThought('Main Phase 2: AI found no additional profitable/castable play, so it will end turn.', 'append', seat);
        pushPhaseToast({ seat, label: `P${seat} End Step`, step: 'end', message: `Player ${seat} found no Main Phase 2 play and is ending the turn.` });
        setTimeout(() => advanceTurnFrom(seat), 750);
        return allStates;
      }
      const castCard = handNext[castIndex];
      const manaSourcesToUse = chooseAiManaSourcesForCost(inventory, castCard);
      if (!manaSourcesToUse.length) {
        setTimeout(() => advanceTurnFrom(seat), 500);
        return allStates;
      }
      const toTap = manaSourcesToUse.filter((source) => source.requiresTap).map((source) => source.boardId);
      handNext = handNext.filter((_, index) => index !== castIndex);
      const zone = likelyZoneForCard(castCard);
      const slotInfo = nextSlot(seat, zone, castCard);
      const boardCard = { boardId: crypto.randomUUID(), ownerSeat: seat, originalOwnerSeat: seat, controllerSeat: seat, zone, slot: slotInfo.slot, stackIndex: slotInfo.stackIndex, tapped: aiCardEntersTapped(castCard), card: castCard, mods: [], enteredTurn: turn, controlledSinceTurn: turn, controlledSinceStartOfTurn: false, playedAt: Date.now() };
      const afterCastCards = [
        ...localBoardCards.map((card) => toTap.includes(card.boardId) ? { ...card, tapped: true } : card),
        boardCard
      ];
      localBoardCards = afterCastCards;
      setBoardCards(afterCastCards);
      animateAiHiddenMove(seat, zone, castCard);
      if (toTap.length) emit({ type: 'tap_cards', boardIds: toTap, tapped: true });
      emit({ type: 'drag_preview', ownerSeat: seat, canonical: { x: 0.5, y: 0.12 } });
      publishAiThought([
        `Main Phase 2: AI casts ${castCard.name} after combat.`,
        ...manaSourcesToUse.map((source) => `AI used ${source.sourceName}: ${source.costText || 'ability'} → add ${source.manaLabel}.`),
        `Mana produced for this spell: ${formatManaSymbols(manaSourcesToUse.flatMap((source) => source.mana || []))}`
      ], 'append', seat);
      pushPhaseToast({ seat, label: `P${seat} Main Phase 2`, step: 'main2', message: `Player ${seat} casts ${castCard.name} in Main Phase 2.` });
      const stackId = crypto.randomUUID();
      setStackItems((items) => [...items, { id: stackId, seat, cardName: castCard.name, cardImage: castCard.image, label: `${castCard.name} on the stack` }]);
      const pendingInfo = { type: 'ai-cast', seat, stackId, boardCard, cardsSnapshot: afterCastCards, aiOverride: { ...current, hand: handNext, library: libraryNext }, afterResolve: 'end-turn' };
      const responseOptions = responseOptionsForSeat(localSeat, afterCastCards);
      if (aiCastNeedsReview(pendingInfo)) {
        publishAiThought(`AI learning check: ${castCard.name} needs review before post-combat priority opens.`, 'append', seat);
        beginAiStackReviewBeforeResolve(pendingInfo);
      } else {
        const reviewedPendingInfo = markAiCastReviewedIfNoManualCheckNeeded(pendingInfo);
        setPendingAiAfterStack(reviewedPendingInfo);
        if (responseOptions.length && responsePromptsEnabled) {
          setResponsePrompt({ ...priorityPromptForPendingAiCast(reviewedPendingInfo), message: `You have priority before this Main Phase 2 spell resolves. Response options detected: ${responseOptions.slice(0, 3).map((item) => item.card?.name || 'card').join(', ')}${responseOptions.length > 3 ? '…' : ''}.` });
        } else {
          publishAiThought(responseOptions.length
            ? `Main Phase 2 priority auto-pass: response prompts are off, so ${castCard.name} resolves without asking.`
            : `Main Phase 2 priority check: no response-worthy cards/actions detected, so ${castCard.name} resolves without a prompt.`, 'append', seat);
          setTimeout(() => resolveAiStackItem(reviewedPendingInfo), 520);
        }
      }
      setTimeout(() => emit({ type: 'play_card', card: boardCard }), 920);
      return { ...allStates, [seat]: { ...current, hand: handNext, library: libraryNext, landPlayed: true } };
    });
  }

  function runAiTurn(seat = 2) {
    setAiStates((allStates) => {
      const current = allStates[seat];
      if (!current) return allStates;
      setPhaseLabel(`P${seat} Untap`);
      let handNext = [...current.hand];
      let libraryNext = [...current.library];
      let localBoardCards = boardCards;
      let lastInventory = null;

      const tappedAiCards = localBoardCards.filter((card) => card.ownerSeat === seat && card.tapped && !/does(?:n'?t| not) untap/i.test(card.card?.oracleText || '')).map((card) => card.boardId);
      if (tappedAiCards.length) {
        localBoardCards = localBoardCards.map((card) => tappedAiCards.includes(card.boardId) ? { ...card, tapped: false, controlledSinceStartOfTurn: true } : card);
        setBoardCards(localBoardCards);
        emit({ type: 'tap_cards', boardIds: tappedAiCards, tapped: false });
        publishAiThought(`Untap step: AI untapped ${tappedAiCards.length} card(s).`, 'replace', seat);
      } else {
        publishAiThought('Untap step: AI had nothing to untap.', 'replace', seat);
      }

      if (libraryNext.length) {
        handNext.push(libraryNext[0]);
        setPhaseLabel(`P${seat} Draw`);
        publishAiThought(`Draw step: AI drew 1 card.`, 'append', seat);
        libraryNext = libraryNext.slice(1);
      }

      setPhaseLabel(`P${seat} Main Phase 1`);
      const landIndex = handNext.findIndex(isLand);
      if (landIndex >= 0) {
        const land = handNext[landIndex];
        handNext = handNext.filter((_, i) => i !== landIndex);
        const slotInfo = nextSlot(seat, 'mana', land);
        const boardCard = { boardId: crypto.randomUUID(), ownerSeat: seat, originalOwnerSeat: seat, controllerSeat: seat, zone: 'mana', slot: slotInfo.slot, stackIndex: slotInfo.stackIndex, tapped: aiCardEntersTapped(land), card: land, mods: [], enteredTurn: turn, controlledSinceTurn: turn, controlledSinceStartOfTurn: false, playedAt: Date.now() };
        localBoardCards = [...localBoardCards, boardCard];
        setBoardCards(localBoardCards);
        animateAiHiddenMove(seat, 'mana', land);
        publishAiThought(`Main phase: AI played land ${land.name}${boardCard.stackIndex ? ` stacked with matching ${land.name}` : ''}${boardCard.tapped ? ' tapped' : ''}.`, 'append', seat);
        emit({ type: 'drag_preview', ownerSeat: seat, canonical: { x: 0.5, y: 0.12 } });
        setTimeout(() => emit({ type: 'play_card', card: boardCard }), 720);
      }

      let spellsCast = 0;
      for (let attempt = 0; attempt < 1; attempt += 1) {
        const inventory = buildAiAbilityInventory({ boardCards: localBoardCards, seat, turn, brain: aiBrain });
        lastInventory = inventory;
        if (attempt === 0) publishAiThought(inventory.log, 'append', seat);
        const context = buildAiContext(seat, localBoardCards, { ...current, hand: handNext, library: libraryNext });
        const skippedCastNotes = [];
        const castChoices = handNext
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => !isLand(card) && chooseAiManaSourcesForCost(inventory, card).length > 0)
          .map((choice) => {
            const plan = buildAiCardPlan(choice.card, context, aiBrain);
            const hasRequiredTargetedAction = plan.actions.some((action) => actionNeedsTarget(action));
            const hasUsableAction = plan.actions.some((action) => isActionUsable(action));
            const legal = !hasRequiredTargetedAction || hasUsableAction;
            if (!legal) skippedCastNotes.push(`Skipped ${choice.card.name}: no legal target/choice for its required effect.`);
            return { ...choice, plan, legal, score: legal ? scoreAiCardForCast(choice.card, context, aiBrain) : -999 };
          })
          .filter((choice) => choice.legal && choice.score > 0)
          .sort((a, b) => b.score - a.score);
        if (skippedCastNotes.length) publishAiThought(skippedCastNotes, 'append', seat);
        const castIndex = castChoices[0]?.index ?? -1;
        if (castIndex < 0) {
          if (spellsCast === 0) publishAiThought(`AI did not find a castable nonland card with ${inventory.totalUsableMana} usable mana source(s).`, 'append', seat);
          break;
        }
        const castCard = handNext[castIndex];
        const manaSourcesToUse = chooseAiManaSourcesForCost(inventory, castCard);
        if (!manaSourcesToUse.length) break;
        const toTap = manaSourcesToUse.filter((source) => source.requiresTap).map((source) => source.boardId);
        handNext = handNext.filter((_, i) => i !== castIndex);
        const zone = likelyZoneForCard(castCard);
        const slotInfo = nextSlot(seat, zone, castCard);
        const boardCard = { boardId: crypto.randomUUID(), ownerSeat: seat, originalOwnerSeat: seat, controllerSeat: seat, zone, slot: slotInfo.slot, stackIndex: slotInfo.stackIndex, tapped: aiCardEntersTapped(castCard), card: castCard, mods: [], enteredTurn: turn, controlledSinceTurn: turn, controlledSinceStartOfTurn: false, playedAt: Date.now() };
        const afterCastCards = [
          ...localBoardCards.map((card) => toTap.includes(card.boardId) ? { ...card, tapped: true } : card),
          boardCard
        ];
        const useLines = [
          `AI casts ${castCard.name} and pays ${castCard.manaCost || `${Math.max(1, Number(castCard.manaValue || 1))} mana`}.`,
          ...manaSourcesToUse.map((source) => `AI used ${source.sourceName}: ${source.costText || 'ability'} → add ${source.manaLabel}.`),
          `Mana produced for this spell: ${formatManaSymbols(manaSourcesToUse.flatMap((source) => source.mana || []))}`
        ];
        publishAiThought(useLines, 'append', seat);
        localBoardCards = afterCastCards;
        setBoardCards(afterCastCards);
        animateAiHiddenMove(seat, zone, castCard);
        if (toTap.length) emit({ type: 'tap_cards', boardIds: toTap, tapped: true });
        emit({ type: 'drag_preview', ownerSeat: seat, canonical: { x: 0.5, y: 0.12 } });
        const stackId = crypto.randomUUID();
        setStackItems((items) => [...items, { id: stackId, seat, cardName: castCard.name, cardImage: castCard.image, label: `${castCard.name} on the stack` }]);
        const pendingInfo = { type: 'ai-cast', seat, stackId, boardCard, cardsSnapshot: afterCastCards, aiOverride: { ...current, hand: handNext, library: libraryNext } };
        const responseOptions = responseOptionsForSeat(localSeat, afterCastCards);
        if (aiCastNeedsReview(pendingInfo)) {
          publishAiThought(`AI learning check: ${castCard.name} needs review before priority opens.`, 'append', seat);
          beginAiStackReviewBeforeResolve(pendingInfo);
        } else {
          const reviewedPendingInfo = markAiCastReviewedIfNoManualCheckNeeded(pendingInfo);
          setPendingAiAfterStack(reviewedPendingInfo);
          if (responseOptions.length && responsePromptsEnabled) {
            setResponsePrompt({ ...priorityPromptForPendingAiCast(reviewedPendingInfo), message: `You have priority before this spell resolves. Response options detected: ${responseOptions.slice(0, 3).map((item) => item.card?.name || 'card').join(', ')}${responseOptions.length > 3 ? '…' : ''}.` });
          } else {
            publishAiThought(responseOptions.length
              ? `Priority auto-pass: response prompts are off, so ${castCard.name} resolves without asking even though response cards were detected.`
              : `Priority check: Player ${localSeat} has no response-worthy cards/actions detected, so ${castCard.name} resolves without a prompt.`, 'append', seat);
            setTimeout(() => resolveAiStackItem(reviewedPendingInfo), 520);
          }
        }
        setTimeout(() => {
          emit({ type: 'play_card', card: boardCard });
        }, 920 + attempt * 180);
        spellsCast += 1;
      }

      if (spellsCast > 1) publishAiThought(`AI chained ${spellsCast} playable move(s) this turn instead of stopping after one.`, 'append', seat);

      if (spellsCast > 0 || pendingAiAfterStack) {
        publishAiThought('AI is pausing for priority/stack resolution before combat.', 'append', seat);
      } else if (aiReviewQueue.length) {
        publishAiThought('AI is pausing before combat until card learning/review prompts are resolved.', 'append', seat);
        setPendingAiAfterReview({ type: 'combat', seat });
      } else {
        setTimeout(() => runAiCombatOnly(seat), 700);
      }
      return { ...allStates, [seat]: { ...current, hand: handNext, library: libraryNext, landPlayed: false } };
    });
  }

  const selectedSet = new Set(selection?.boardIds || []);
  const draggingBoardIds = new Set(dragging?.source === 'board' ? dragging.boardIds || [] : []);
  const visibleBoardCards = draggingBoardIds.size
    ? boardCards.filter((card) => !draggingBoardIds.has(card.boardId))
    : boardCards;
  const visibleDeckCounts = SEATS.reduce((acc, seat) => {
    if (!players[seat]) return acc;
    if (seat === localSeat) acc[seat] = library.length;
    else if (players[seat]?.ai && aiStates[seat]) acc[seat] = aiStates[seat].library.length;
    else acc[seat] = Math.max(0, (players[seat]?.deckCount || 0) - 7);
    return acc;
  }, {});

  return (
    <main className="game-screen">
      <header className="game-hud">
        <button className="ghost" onClick={backToLobby}>← Lobby</button>
        <div><b>Turn {turn}</b><span>Active: Player {activeSeat}</span></div>
        <div className="phase-pill"><span>Phase</span><b>{phaseLabel}</b></div>
        <div><span>You are Player {localSeat}</span><span>Library: {library.length}</span></div>
        <button
          className={responsePromptsEnabled ? 'response-toggle response-toggle-on' : 'response-toggle response-toggle-off'}
          onClick={toggleResponsePrompts}
          title={responsePromptsEnabled ? 'Response prompts are on. Click to auto-pass opponent priority prompts.' : 'Response prompts are off. Click to ask before opponent spells resolve.'}
        >
          <span>Responses</span><b>{responsePromptsEnabled ? 'On' : 'Auto-pass'}</b>
        </button>
        <button
          className={['combat-select', 'combat-blockers'].includes(combatState.phase) ? 'primary combat-active-button' : 'secondary'}
          onClick={combatState.phase === 'combat-select' ? confirmCombatSelection : combatState.phase === 'combat-blockers' ? confirmBlockers : beginCombat}
        >
          {combatState.phase === 'combat-select'
            ? `Confirm Attackers (${combatState.attackers.length})`
            : combatState.phase === 'combat-blockers'
              ? `Confirm Blockers (${combatState.blockers?.length || 0})`
              : 'Combat'}
        </button>
        <button className="primary" onClick={endTurn}>End Turn</button>
        <button className="secondary" onClick={() => centerOnMyArea()}>Center Me</button>
        <button className="secondary" onClick={centerWholeTable}>Full Table</button>
        <div className="zoom-controls" aria-label="Table zoom controls">
          <button className="secondary mini" onClick={() => zoomFromCenter(zoom * 0.88)}>-</button>
          <input
            className="zoom-slider"
            type="range"
            min="34"
            max="175"
            value={Math.round(zoom * 100)}
            onChange={(event) => zoomFromCenter(Number(event.target.value) / 100)}
            aria-label="Zoom tabletop"
          />
          <button className="secondary mini" onClick={() => zoomFromCenter(zoom * 1.12)}>+</button>
          <span>{Math.round(zoom * 100)}%</span>
        </div>
        <button className="secondary" onClick={openDiceBag}>Dice Bag</button>
        <button className={hideTraitBadges ? 'primary' : 'secondary'} onClick={() => setHideTraitBadges((value) => !value)}>{hideTraitBadges ? 'Show Badges' : 'Hide Badges'}</button>
        <button className={addCardModalOpen ? 'primary' : 'secondary'} onClick={() => setAddCardModalOpen(true)}>Manually Add...</button>
        <button className={devConsoleOpen ? 'primary' : 'secondary'} onClick={() => setDevConsoleOpen((open) => !open)}>Dev Console</button>
        <span className="pan-hint">Drag empty tabletop to pan. Wheel or slider zooms.</span>
      </header>

      {winnerSeat && <div className="winner-banner">Player {winnerSeat} wins</div>}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <StackPanel items={stackItems} responsePrompt={responsePrompt} onPass={passPriority} onHold={holdPriorityForManualResponse} />
      {debugHasAi && <AiThoughtLog entries={aiThoughtLog} collapsed={aiThoughtCollapsed} onToggle={() => setAiThoughtCollapsed((value) => !value)} />}
      <LifeTrackers players={players} lifeTotals={lifeTotals} localSeat={localSeat} onAdjust={updateLifeTotal} onSet={setLifeTotalDirect} />
      {devConsoleOpen && <DevConsole command={devCommand} setCommand={setDevCommand} onRun={runDevCommand} onClose={() => setDevConsoleOpen(false)} pendingTarget={pendingAiResetTarget} />}
      {aiMissingReport && <AiMissingReportModal report={aiMissingReport} onClose={() => setAiMissingReport(null)} />}
      {aiConfidenceReport && <AiConfidenceReportModal report={aiConfidenceReport} onClose={() => setAiConfidenceReport(null)} />}
      {actionChoiceRequest && (
        <ActionChoiceModal
          request={actionChoiceRequest}
          boardCards={boardCards}
          library={actionChoiceRequest.sourceBoardCard?.ownerSeat === localSeat ? library : (aiStates[actionChoiceRequest.sourceBoardCard?.ownerSeat]?.library || [])}
          onChoose={resolveActionChoice}
          onClose={() => setActionChoiceRequest(null)}
        />
      )}

      <section className="table-wrap" ref={tableWrapRef} onPointerDown={startTablePan} onWheel={handleWheelZoom} onClick={clearFloatingUi}>
        <div
          className="table-mat table-world"
          ref={tableRef}
          style={{ width: TABLE_SIZE.width, height: TABLE_SIZE.height, transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
        >
          <div className="table-center-title">{lobbyState?.tableMode === 'teams' ? 'Team Table' : 'Free-for-all Table'}</div>
          <PerspectiveSeats players={players} localSeat={localSeat} />
          <ZoneGuides players={players} localSeat={localSeat} />
          <ZoneHotspots players={players} localSeat={localSeat} onOpenZone={(seat, zone) => setZoneBrowser({ seat, zone, reveal: false })} />
          <OpponentHandFans players={players} localSeat={localSeat} aiStates={aiStates} localHandCount={hand.length} localSeatId={localSeat} />
          {dragging?.point && <ZoneSlotPreview target={getZoneTargetFromPoint(dragging.point)} localSeat={localSeat} />}
          {SEATS.map((seat) => players[seat] ? (
            <DeckStack
              key={`deck-${seat}`}
              seat={seat}
              localSeat={localSeat}
              count={visibleDeckCounts[seat] || 0}
              interactive={seat === localSeat || players[seat]?.ai}
              onDraw={seat === localSeat ? () => drawCard(true) : null}
              onOpen={() => setZoneBrowser({ seat, zone: 'library', reveal: false })}
            />
          ) : null)}
          {visibleBoardCards.map((boardCard) => (
            <BoardCard
              key={boardCard.boardId}
              boardCard={boardCard}
              localSeat={localSeat}
              selected={selectedSet.has(boardCard.boardId)}
              allBoardCards={boardCards}
              onClick={() => {
                if (suppressNextBoardClick.current) { suppressNextBoardClick.current = false; return; }
                handleBoardCardClick(boardCard);
              }}
              onPointerStart={(event) => startBoardCardPointer(boardCard, event)}
              onPreviewChange={(card) => setBoardHoverPreviewCard(card)}
              onCommanderTaxChange={adjustCommanderTax}
              hideTraitBadges={hideTraitBadges}
            />
          ))}
          {aiCardAnim && <AiCardAnim anim={aiCardAnim} />}
          {Object.values(remoteDrags).map((event) => {
            const point = canonicalToView(event.canonical, localSeat);
            return <img key={event.ownerSeat} src={cardBackUrl} className="remote-drag-card" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} alt="Hidden moving card" />;
          })}
          {dragging && <DraggingPreview dragging={dragging} />}
        </div>
      </section>

      <HandFan
        hand={hand}
        dockRef={handDockRef}
        onPointerDown={startDragFromHand}
        setTooltipCard={setTooltipCard}
        previewCard={handPreviewCard}
        setPreviewCard={setHandPreviewCard}
      />

      {(handPreviewCard || boardHoverPreviewCard) && <HandHoverPreview card={handPreviewCard || boardHoverPreviewCard} />}

      {selection && !dragging && (
        <RadialCardMenu
          selection={selection}
          boardCards={boardCards}
          localSeat={localSeat}
          turn={turn}
          aiBrain={aiBrain}
          onToggleTap={toggleTapSelection}
          onMove={moveSelection}
          onHand={() => returnBoardCardsToHand(selection.boardIds)}
          onLibrary={() => putBoardCardsIntoLibrary(selection.boardIds)}
          onCopy={copySelection}
          onModify={() => { setModifyModal({ boardIds: selection.boardIds }); setSelection(null); }}
          onActivate={() => { setActivateModal({ boardIds: selection.boardIds }); setSelection(null); }}
          onClear={() => setSelection(null)}
        />
      )}

      {tooltipCard && <CardTooltip card={tooltipCard} onClose={() => setTooltipCard(null)} />}
      {zoneBrowser && (
        <ZoneBrowserModal
          browser={zoneBrowser}
          cards={zoneBrowserCards(zoneBrowser.seat, zoneBrowser.zone)}
          onClose={() => setZoneBrowser(null)}
          onMove={moveZoneBrowserSelection}
          onDraw={drawFromZoneBrowser}
          onMill={millFromZoneBrowser}
        />
      )}
      {addCardModalOpen && (
        <AddCardModal
          players={players}
          localSeat={localSeat}
          onAdd={addManualScryfallCardToField}
          onClose={() => setAddCardModalOpen(false)}
        />
      )}
      {modifyModal && <ModifyModal boardCards={boardCards} selection={modifyModal} onApply={applyModification} onClose={() => setModifyModal(null)} />}
      {activateModal && (
        <ActivateModal
          sourceCards={boardCards.filter((card) => (activateModal.boardIds || []).includes(card.boardId))}
          plan={(() => {
            const source = boardCards.find((card) => (activateModal.boardIds || []).includes(card.boardId));
            const activeSource = source ? withActiveFaceCard(source) : null;
            return activeSource ? buildAiCardPlan(activeSource.card, buildAiContext(activeSource.ownerSeat, boardCards, null, activeSource.boardId), aiBrain) : null;
          })()}
          onCopyDebug={(source, plan, action) => {
            const activeSource = withActiveFaceCard(source);
            const text = copyAiParseDebug({ card: activeSource?.card, plan, boardCard: activeSource, action, step: { title: 'Activation menu debug snapshot' } });
            addGameNotice(`${activeSource?.card?.name || 'Card'}: copied activation parse debug to clipboard.`, activeSource?.ownerSeat || null);
            return text;
          }}
          onApply={applyActivation}
          onClose={() => setActivateModal(null)}
        />
      )}
      {combatState.summary && <CombatResultModal summary={combatState.summary} onApply={applyCombatSummary} onClose={() => setCombatState({ phase: 'main', attackers: [], blockers: [], warnings: [], summary: null, attackingSeat: null, defendingSeat: null, pendingBlockerId: null })} />}
      {aiReview && <AiReviewModal review={aiReview} onApply={(action, options) => handleAiReview('approved', true, '', action, options)} onApproveOnly={(action, options) => handleAiReview('approved', false, '', action, options)} onReject={(note, options) => handleAiReview('rejected', false, note, null, options)} onClose={() => setAiReview(null)} />}
      {previewCard && <RevealCard card={previewCard} />}
      {drawAnims.map((anim) => <DrawAnim key={anim.id} card={anim.card} from={anim.from} to={anim.to} />)}
    </main>
  );
}


function ToastStack({ toasts = [], onDismiss }) {
  if (!toasts.length) return null;
  return (
    <aside className="toast-stack" aria-live="assertive" aria-label="Game notifications">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          className={`game-toast toast-${toast.tone || 'info'}`}
          onClick={() => onDismiss?.(toast.id)}
          title="Dismiss notification"
        >
          <span className="toast-kicker">{toast.seat ? `Player ${toast.seat}` : 'Table'}</span>
          <strong>{toast.title}</strong>
          {toast.message && <small>{toast.message}</small>}
        </button>
      ))}
    </aside>
  );
}


function AiThoughtLog({ entries = [], collapsed = false, onToggle }) {
  if (!entries.length) return null;
  const latestSeat = entries[entries.length - 1]?.seat;
  return (
    <aside className={`ai-thought-log ${collapsed ? 'collapsed' : ''}`} aria-live="polite">
      <div className="ai-thought-log-title">
        <span>AI thought log</span>
        <b>{latestSeat ? `Player ${latestSeat}` : 'Debug'}</b>
        <button className="thought-collapse-button" onClick={onToggle}>{collapsed ? 'Expand' : 'Collapse'}</button>
      </div>
      {!collapsed && (
        <div className="ai-thought-log-lines">
          {entries.slice(-80).map((entry) => <p key={entry.id}><ManaText text={entry.text} /></p>)}
        </div>
      )}
    </aside>
  );
}


function StackPanel({ items = [], responsePrompt = null, onPass, onHold }) {
  const [previewId, setPreviewId] = useState(null);
  if (!items.length && !responsePrompt) return null;
  const orderedItems = items.slice().reverse();
  const previewItem = orderedItems.find((item) => item.id === previewId) || orderedItems[0] || null;
  return (
    <aside className={`stack-panel ${responsePrompt?.type === 'combat' ? 'combat-alert' : ''}`} aria-live="assertive">
      <div className="stack-panel-header">
        <span>{responsePrompt?.type === 'combat' ? 'Combat alert' : 'On the stack'}</span>
        {items.length ? <b>{items.length} item{items.length === 1 ? '' : 's'}</b> : <b>Priority window</b>}
      </div>
      {responsePrompt && (
        <div className="priority-prompt">
          <strong>{responsePrompt.title}</strong>
          <p>{responsePrompt.message}</p>
        </div>
      )}
      {previewItem?.cardImage ? (
        <div className="stack-preview-card">
          <img src={previewItem.cardImage} alt={previewItem.cardName || 'Card on the stack'} />
          <div>
            <strong>{previewItem.cardName || previewItem.label}</strong>
            <p>{previewItem.label || 'Pending stack item'}</p>
            <em>Controller: P{previewItem.seat}</em>
          </div>
        </div>
      ) : null}
      {items.length ? (
        <ol className="stack-list">
          {orderedItems.map((item) => (
            <li key={item.id} className={previewItem?.id === item.id ? 'active' : ''} onMouseEnter={() => setPreviewId(item.id)} onFocus={() => setPreviewId(item.id)}>
              {item.cardImage && <img src={item.cardImage} alt="" />}
              <span>{item.label || item.cardName}</span>
              <em>P{item.seat}</em>
            </li>
          ))}
        </ol>
      ) : null}
      {(responsePrompt || items.length) && (
        <div className="stack-actions">
          {responsePrompt && <button className="secondary" onClick={onHold}>Hold priority / manual response</button>}
          {responsePrompt?.badPlayAvailable && <button className="secondary warning-action" disabled title="Bad Play undo is reserved for the next undo patch.">⚠ Bad Play</button>}
          <button className="primary" onClick={onPass}>{responsePrompt?.type === 'combat' ? 'Continue to blockers' : 'Pass priority / resolve'}</button>
        </div>
      )}
    </aside>
  );
}


function LifeTrackers({ players, lifeTotals, localSeat, onAdjust, onSet }) {
  return (
    <aside className="life-tracker-panel">
      {SEATS.filter((seat) => players[seat]).map((seat) => {
        const totals = lifeTotals[seat] || { life: STARTING_LIFE, infect: 0, commander: 0 };
        return (
          <section key={seat} className={`life-tracker-card ${seat === localSeat ? 'you' : ''}`}>
            <div className="life-seat-label">P{seat}</div>
            <button title="Click to set life" onClick={() => onSet(seat, 'life')}><span className="life-icon heart">♥</span><b>{totals.life}</b></button>
            <button title="Click to set infect" onClick={() => onSet(seat, 'infect')}><span className="life-icon infect">☣</span><b>{totals.infect}</b></button>
            <button title="Click to set commander damage" onClick={() => onSet(seat, 'commander')}><span className="life-icon commander">☠</span><b>{totals.commander}</b></button>
            <div className="life-adjust-row">
              <button onClick={() => onAdjust(seat, 'life', -1)}>−</button>
              <button onClick={() => onAdjust(seat, 'life', 1)}>+</button>
            </div>
          </section>
        );
      })}
    </aside>
  );
}

function DevConsole({ command, setCommand, onRun, onClose, pendingTarget }) {
  const quickCommands = [
    { label: 'Missing all', command: 'ai_missing all' },
    { label: 'Confidence all', command: 'ai_confidence all' },
    { label: 'Confidence P2', command: 'ai_confidence P2' },
    { label: 'Reset all', command: 'ai_reset all' },
    { label: 'Reset target', command: 'ai_reset target' }
  ];

  function runQuickCommand(commandText) {
    setCommand(commandText);
    onRun(commandText);
  }

  return (
    <aside className="dev-console">
      <div className="dev-console-top"><b>Dev console</b><button onClick={onClose}>×</button></div>
      {pendingTarget ? (
        <p>Target mode active: click a card to reset its AI rules.</p>
      ) : (
        <div className="dev-command-hints" aria-label="Quick dev commands">
          <span>Quick commands:</span>
          {quickCommands.map((item) => (
            <button key={item.command} type="button" onClick={() => runQuickCommand(item.command)} title={`Run ${item.command}`}>
              {item.command}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={(event) => { event.preventDefault(); onRun(); }}>
        <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="ai_confidence all" autoFocus />
        <button className="primary" type="submit">Run</button>
      </form>
    </aside>
  );
}


function DeckImportDebugModal({ report, onClose }) {
  const items = report?.items || [];
  const pageSize = report?.pageSize || 12;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const [page, setPage] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageText = formatDeckImportDebugReportPage(report, safePage);

  useEffect(() => {
    setPage(0);
    setCopyStatus('');
  }, [report]);

  async function copyText(text, label) {
    try {
      await navigator.clipboard?.writeText(text);
      setCopyStatus(label);
    } catch {
      setCopyStatus('Copy failed — select the text box and copy manually.');
    }
  }

  return (
    <div className="mini-modal-backdrop ai-missing-report-backdrop deck-import-debug-backdrop" onClick={onClose}>
      <section className="mini-modal ai-missing-report-modal deck-import-debug-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-topline">
          <div>
            <p className="eyebrow">Deck import debug</p>
            <h2>Import diagnostics</h2>
          </div>
          <button className="close round-close" onClick={onClose}>×</button>
        </div>
        <p className="modal-copy">This report shows exactly how each raw decklist line was parsed, whether it was included in the loaded deck, what name was sent to Scryfall, and whether lookup fell back to a placeholder. Diagnostics are read-only; use the normal Load deck button to apply the deck to the lobby.</p>
        <div className="ai-missing-summary-grid deck-import-debug-summary">
          <span><b>{report?.parsedEntryCount || 0}</b> parsed card line(s)</span>
          <span><b>{report?.totalCardInstances || 0}</b> loaded card instance(s)</span>
          <span><b>{report?.fallbackCount || 0}</b> fallback row(s)</span>
          <span><b>{report?.missingImageCount || 0}</b> loaded row(s) missing image</span>
        </div>
        <div className="deck-import-debug-commander">
          <b>Commander:</b>
          <span>{report?.commanderName || 'none'} · {report?.commanderDetection || 'unknown'} · image {report?.commanderImagePresent ? 'yes' : 'no'}</span>
        </div>
        <div className="ai-missing-page-controls">
          <button className="secondary" disabled={safePage <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>← Previous {pageSize}</button>
          <b>Page {safePage + 1} of {totalPages}</b>
          <button className="secondary" disabled={safePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>Next {pageSize} →</button>
        </div>
        <textarea
          className="ai-missing-report-textarea deck-import-debug-textarea"
          value={pageText}
          readOnly
          onFocus={(event) => event.target.select()}
          aria-label="Deck import debug report page"
        />
        <div className="modal-actions ai-missing-actions">
          <button className="secondary" onClick={() => copyText(pageText, `Copied page ${safePage + 1}.`)}>Copy this page</button>
          <button className="secondary" onClick={() => copyText(formatDeckImportDebugReportAll(report), 'Copied full import debug report.')}>Copy full report</button>
          <button className="primary" onClick={onClose}>Done</button>
          {copyStatus && <span className="ai-missing-copy-status">{copyStatus}</span>}
        </div>
      </section>
    </div>
  );
}

function AiMissingReportModal({ report, onClose }) {
  const items = report?.items || [];
  const pageSize = report?.pageSize || AI_MISSING_REPORT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const [page, setPage] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageText = formatAiMissingReportPage(report, safePage);

  useEffect(() => {
    setPage(0);
    setCopyStatus('');
  }, [report]);

  async function copyText(text, label) {
    try {
      await navigator.clipboard?.writeText(text);
      setCopyStatus(label);
    } catch {
      setCopyStatus('Copy failed — select the text box and copy manually.');
    }
  }

  return (
    <div className="mini-modal-backdrop ai-missing-report-backdrop" onClick={onClose}>
      <section className="mini-modal ai-missing-report-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-topline">
          <div>
            <p className="eyebrow">Dev console report</p>
            <h2>Missing common actions</h2>
          </div>
          <button className="close round-close" onClick={onClose}>×</button>
        </div>
        <p className="modal-copy">This scans loaded deck data for cards where at least one oracle ability still has “No common action recognized yet.” Each page is capped at {pageSize} cards so you can copy/paste one batch at a time.</p>
        <div className="ai-missing-summary-grid">
          <span><b>{items.length}</b> missing/scan-problem card(s)</span>
          <span><b>{report?.missingAbilityCount || 0}</b> missing line(s) / scan issue(s)</span>
          <span><b>{report?.scanErrorCount || 0}</b> scan error(s)</span>
          <span><b>{report?.totalUniqueCards || 0}</b> unique card(s) scanned</span>
          <span><b>{safePage + 1}</b> / {totalPages} page(s)</span>
        </div>
        <div className="ai-missing-page-controls">
          <button className="secondary" disabled={safePage <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>← Previous 5</button>
          <b>Page {safePage + 1} of {totalPages}</b>
          <button className="secondary" disabled={safePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>Next 5 →</button>
        </div>
        <textarea
          className="ai-missing-report-textarea"
          value={pageText}
          readOnly
          onFocus={(event) => event.target.select()}
          aria-label="AI missing common action report page"
        />
        <div className="modal-actions ai-missing-actions">
          <button className="secondary" onClick={() => copyText(pageText, `Copied page ${safePage + 1}.`)}>Copy this page</button>
          <button className="secondary" onClick={() => copyText(formatAiMissingReportAll(report), 'Copied full report.')}>Copy full report</button>
          <button className="primary" onClick={onClose}>Done</button>
          {copyStatus && <span className="ai-missing-copy-status">{copyStatus}</span>}
        </div>
      </section>
    </div>
  );
}


function AiConfidenceReportModal({ report, onClose }) {
  const items = report?.items || [];
  const pageSize = report?.pageSize || AI_MISSING_REPORT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const [page, setPage] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageText = formatAiConfidenceReportPage(report, safePage);

  useEffect(() => {
    setPage(0);
    setCopyStatus('');
  }, [report]);

  async function copyText(text, label) {
    try {
      await navigator.clipboard?.writeText(text);
      setCopyStatus(label);
    } catch {
      setCopyStatus('Copy failed — select the text box and copy manually.');
    }
  }

  return (
    <div className="mini-modal-backdrop ai-missing-report-backdrop" onClick={onClose}>
      <section className="mini-modal ai-missing-report-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-topline">
          <div>
            <p className="eyebrow">Dev console report</p>
            <h2>AI confidence / auto-approval</h2>
          </div>
          <button className="close round-close" onClick={onClose}>×</button>
        </div>
        <p className="modal-copy">This scans loaded deck data for cards that do not currently meet the {report?.threshold || AI_AUTO_APPROVE_CONFIDENCE}% silent auto-approval threshold. It includes the confidence math, blocker reasons, per-ability scoring, and recognized action breakdown.</p>
        <div className="ai-missing-summary-grid">
          <span><b>{report?.belowThresholdCount || 0}</b> below threshold</span>
          <span><b>{items.length}</b> not auto-approved / scan issue(s)</span>
          <span><b>{report?.missingAbilityCount || 0}</b> missing common-action line(s)</span>
          <span><b>{report?.scanErrorCount || 0}</b> scan error(s)</span>
          <span><b>{report?.totalUniqueCards || 0}</b> unique card(s) scanned</span>
          <span><b>{safePage + 1}</b> / {totalPages} page(s)</span>
        </div>
        <div className="ai-missing-page-controls">
          <button className="secondary" disabled={safePage <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>← Previous 5</button>
          <b>Page {safePage + 1} of {totalPages}</b>
          <button className="secondary" disabled={safePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>Next 5 →</button>
        </div>
        <textarea
          className="ai-missing-report-textarea"
          value={pageText}
          readOnly
          onFocus={(event) => event.target.select()}
          aria-label="AI confidence report page"
        />
        <div className="modal-actions ai-missing-actions">
          <button className="secondary" onClick={() => copyText(pageText, `Copied page ${safePage + 1}.`)}>Copy this page</button>
          <button className="secondary" onClick={() => copyText(formatAiConfidenceReportAll(report), 'Copied full report.')}>Copy full report</button>
          <button className="primary" onClick={onClose}>Done</button>
          {copyStatus && <span className="ai-missing-copy-status">{copyStatus}</span>}
        </div>
      </section>
    </div>
  );
}

function ZoneSlotPreview({ target, localSeat }) {
  if (!target || !['creatures', 'artifacts', 'enchantments', 'mana', 'holding'].includes(target.zone)) return null;
  const layoutCols = { creatures: 16, mana: 16, artifacts: 7, enchantments: 7, holding: 4 }[target.zone] || 1;
  const total = { creatures: 32, mana: 32, artifacts: 14, enchantments: 14, holding: 16 }[target.zone] || 4;
  const rel = relativeSeat(target.ownerSeat, localSeat);
  return (
    <div className="slot-preview-layer">
      {Array.from({ length: total }).map((_, slot) => {
        const local = getSlotLocalPosition(target.zone, slot);
        const point = localMatToPoint(rel, local.x, local.y);
        return <div key={`${target.ownerSeat}-${target.zone}-${slot}`} className="slot-preview-dot" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} title={`Slot ${slot + 1} / ${layoutCols} columns`} />;
      })}
    </div>
  );
}

function CombatResultModal({ summary, onApply, onClose }) {
  const [pairs, setPairs] = useState(() => (summary?.pairs || []).map((pair) => ({ ...pair, approved: true })));
  const approvedTotals = pairs.filter((pair) => pair.approved).reduce((acc, pair) => ({
    damage: acc.damage + Number(pair.playerDamage || 0),
    commanderDamage: acc.commanderDamage + Number(pair.commanderDamage || 0),
    infectDamage: acc.infectDamage + Number(pair.infectDamage || 0),
    lifeGain: acc.lifeGain + Number(pair.lifeGain || 0),
    deaths: acc.deaths + (pair.deaths?.length || 0)
  }), { damage: 0, commanderDamage: 0, infectDamage: 0, lifeGain: 0, deaths: 0 });
  return (
    <div className="mini-modal-backdrop combat-modal-backdrop" onClick={onClose}>
      <section className="combat-modal mini-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-topline"><div><p className="eyebrow">Combat confirmation</p><h2>Review expected combat results</h2></div><button className="close round-close" onClick={onClose}>×</button></div>
        <p className="modal-copy">Approve each combat pair separately. Uncheck anything the engine got wrong, then manually adjust the board/life if needed.</p>
        <div className="combat-pair-list">
          {pairs.map((pair, index) => (
            <article key={`${pair.attackerId}-${pair.blockerId || 'unblocked'}`} className={pair.approved ? 'combat-pair approved' : 'combat-pair rejected'}>
              <label><input type="checkbox" checked={pair.approved} onChange={(event) => setPairs((current) => current.map((item, i) => i === index ? { ...item, approved: event.target.checked } : item))} /> Approve this result</label>
              <b>{pair.attackerName}{pair.blockerName ? ` vs ${pair.blockerName}` : ' unblocked'}</b>
              <div className="combat-notes">{pair.notes.map((note, noteIndex) => <span key={noteIndex}>{note}</span>)}</div>
              <div className="combat-outcome-row"><span>Deaths: {pair.deaths.length || 'none'}</span><span>Damage: {pair.playerDamage}</span><span>Commander: {pair.commanderDamage}</span><span>Infect: {pair.infectDamage}</span><span>Lifelink: {pair.lifeGain}</span></div>
            </article>
          ))}
        </div>
        <div className="combat-total-box">Applied total: {approvedTotals.damage} life damage · {approvedTotals.commanderDamage} commander · {approvedTotals.infectDamage} infect · {approvedTotals.lifeGain} lifelink · {approvedTotals.deaths} death marker(s)</div>
        <div className="modal-actions"><button className="secondary" onClick={onClose}>Cancel / manual fix</button><button className="primary" onClick={() => onApply(summary, pairs)}>Apply approved results</button></div>
      </section>
    </div>
  );
}



function AddCardModal({ localSeat = 1, onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [colorFilter, setColorFilter] = useState([]);
  const [colorMode, setColorMode] = useState('include');
  const [tappedByCard, setTappedByCard] = useState({});
  const [results, setResults] = useState([]);
  const [nextUrl, setNextUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const searchSignature = `${query.trim()}|${typeFilter}|${colorMode}|${colorFilter.join('')}`;
  const toggleColorFilter = (color) => {
    setColorFilter((current) => current.includes(color) ? current.filter((item) => item !== color) : [...current, color]);
  };

  const runSearch = async ({ append = false, pageUrl = '' } = {}) => {
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const url = buildScryfallAddSearchUrl({ query, typeFilter, colorFilter, colorMode, pageUrl });
      const response = await fetch(url);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.details || `Scryfall search failed: ${response.status}`);
      }
      const data = await response.json();
      const normalized = (data.data || []).map(normalizeScryfallSearchCard);
      setResults((current) => append ? [...current, ...normalized] : normalized);
      setNextUrl(data.has_more && data.next_page ? data.next_page : '');
    } catch (searchError) {
      setError(searchError?.message || String(searchError));
      if (!append) {
        setResults([]);
        setNextUrl('');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const url = buildScryfallAddSearchUrl({ query, typeFilter, colorFilter, colorMode });
        const response = await fetch(url);
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.details || `Scryfall search failed: ${response.status}`);
        }
        const data = await response.json();
        if (cancelled) return;
        setResults((data.data || []).map(normalizeScryfallSearchCard));
        setNextUrl(data.has_more && data.next_page ? data.next_page : '');
        setSearched(true);
      } catch (searchError) {
        if (cancelled) return;
        setError(searchError?.message || String(searchError));
        setResults([]);
        setNextUrl('');
        setSearched(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query.trim() ? 320 : 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchSignature]);

  const cardResultKey = (card, index) => `${card.scryfallId || card.name || 'card'}-${index}`;
  const addResult = (card, destination, key) => {
    onAdd?.(card, { seat: Number(localSeat || 1), zone: destination, tapped: destination === 'table' && Boolean(tappedByCard[key]) });
  };

  return (
    <div className="mini-modal-backdrop add-card-backdrop" onClick={onClose}>
      <section className="add-card-modal mini-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-topline add-card-titlebar compact-add-titlebar">
          <p className="eyebrow">Manual card add</p>
          <button className="close round-close" onClick={onClose}>×</button>
        </div>

        <div className="add-card-filterline">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }}
            placeholder="Search card name, e.g. Sol Ring, Treasure, Goblin..."
            autoFocus
          />
          <div className="add-card-color-filter inline-color-filter">
            <span className="add-card-filter-label">Colors</span>
            <div className="add-card-color-checks">
              {ADD_CARD_COLOR_OPTIONS.map((color) => (
                <label key={color.id} className={`manual-color-check ${colorFilter.includes(color.id) ? 'is-selected' : ''}`} title={color.label}>
                  <input type="checkbox" checked={colorFilter.includes(color.id)} onChange={() => toggleColorFilter(color.id)} />
                  <ManaText text={`{${color.id}}`} />
                </label>
              ))}
            </div>
            <select className="add-readable-select add-color-mode" value={colorMode} onChange={(event) => setColorMode(event.target.value)} disabled={!colorFilter.length}>
              <option value="include">Must include selected colors</option>
              <option value="only">Only selected colors</option>
              <option value="exact">Exactly selected colors</option>
            </select>
            {colorFilter.length > 0 && <button className="secondary compact-filter-clear" onClick={() => setColorFilter([])}>Clear</button>}
          </div>
          <select className="add-readable-select add-type-filter" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">All card types</option>
            <option value="creature">Creatures</option>
            <option value="artifact">Artifacts</option>
            <option value="enchantment">Enchantments</option>
            <option value="instant">Instants</option>
            <option value="sorcery">Sorceries</option>
            <option value="land">Lands</option>
            <option value="planeswalker">Planeswalkers</option>
            <option value="battle">Battles</option>
            <option value="token">Tokens</option>
          </select>
          <button className="secondary" onClick={() => runSearch()} disabled={loading}>{loading ? 'Searching...' : 'Search'}</button>
        </div>

        {error && <div className="ai-suggestion-box muted-box add-card-error">{error}</div>}
        <div className="add-card-status compact-add-status">
          <span>{loading ? 'Searching Scryfall...' : `${results.length} result${results.length === 1 ? '' : 's'} shown`}</span>
          {typeFilter === 'token' && <span>Token/extras search enabled</span>}
        </div>

        <div className="add-card-results">
          {results.map((card, index) => {
            const key = cardResultKey(card, index);
            const entersTapped = Boolean(tappedByCard[key]);
            return (
              <article key={key} className="add-card-result-tile">
                {card.image ? <img src={card.image} alt={card.name} /> : <span className="zone-card-placeholder">{card.name}</span>}
                <strong>{card.name}</strong>
                <em>{card.typeLine || 'Unknown type'}</em>
                <small className="add-card-cost-line"><ManaText text={card.manaCost || ''} />{card.manaCost ? ' · ' : ''}{card.raw?.set ? card.raw.set.toUpperCase() : ''}{card.raw?.collectorNumber ? ` #${card.raw.collectorNumber}` : ''}</small>
                <label className="manual-card-etb"><input type="checkbox" checked={entersTapped} onChange={(event) => setTappedByCard((current) => ({ ...current, [key]: event.target.checked }))} /> ETB tapped for Table</label>
                <div className="manual-card-destinations">
                  <button className="primary" onClick={() => addResult(card, 'table', key)}>Table</button>
                  <button className="secondary" onClick={() => addResult(card, 'graveyard', key)}>Graveyard</button>
                  <button className="secondary" onClick={() => addResult(card, 'exile', key)}>Exile</button>
                  <button className="secondary" onClick={() => addResult(card, 'hand', key)}>Hand</button>
                </div>
              </article>
            );
          })}
          {!loading && searched && !results.length && !error && <div className="empty-zone-browser">No Scryfall cards matched. Try a different name or type filter.</div>}
        </div>

        <div className="modal-actions add-card-footer">
          <button className="secondary" onClick={onClose}>Close</button>
          <button className="secondary" disabled={!nextUrl || loading} onClick={() => runSearch({ append: true, pageUrl: nextUrl })}>Load more</button>
        </div>
      </section>
    </div>
  );
}



function ZoneBrowserModal({ browser, cards, onClose, onMove, onDraw, onMill }) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [reveal, setReveal] = useState(browser?.zone !== 'library' || Boolean(browser?.reveal));
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [colorFilter, setColorFilter] = useState('all');
  const [numberPicker, setNumberPicker] = useState(null);

  useEffect(() => {
    setSelectedIds(new Set());
    setReveal(browser?.zone !== 'library' || Boolean(browser?.reveal));
    setQuery('');
    setTypeFilter('all');
    setColorFilter('all');
    setNumberPicker(null);
  }, [browser?.seat, browser?.zone]);

  if (!browser) return null;

  const hiddenLibrary = browser.zone === 'library' && !reveal;
  const title = `P${browser.seat} ${browser.zone === 'library' ? 'Library' : browser.zone === 'graveyard' ? 'Graveyard' : 'Exile'}`;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCards = cards.filter((item) => {
    if (hiddenLibrary) return true;
    const card = item.card || {};
    const haystack = `${card.name || ''} ${card.typeLine || ''} ${card.oracleText || ''}`.toLowerCase();
    if (normalizedQuery && !haystack.includes(normalizedQuery)) return false;
    if (typeFilter !== 'all' && !new RegExp(`\\b${typeFilter}\\b`, 'i').test(card.typeLine || '')) return false;
    if (colorFilter !== 'all') {
      const colors = (card.colors || []).join('');
      const text = `${colors} ${card.manaCost || ''} ${card.oracleText || ''}`;
      if (!new RegExp(`\\b${colorFilter}\\b|\\{${colorFilter}\\}`, 'i').test(text)) return false;
    }
    return true;
  });
  const selectedItems = cards.filter((item) => selectedIds.has(item.id));
  const toggleSelected = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const moveSelected = (destination, options = {}) => {
    if (!selectedItems.length) return;
    onMove(selectedItems, destination, options);
  };
  const moveOne = (item, destination, options = {}) => {
    onMove([item], destination, options);
  };
  const selectTop = (amount) => {
    const topIds = cards.slice(0, Math.max(0, Number(amount || 0))).map((item) => item.id);
    setSelectedIds(new Set(topIds));
  };
  const chooseNumber = (action, amount) => {
    const value = Math.max(0, Number(amount || 0));
    setNumberPicker(null);
    if (action === 'draw') onDraw(browser.seat, value);
    if (action === 'mill') onMill(browser.seat, value);
    if (action === 'cascade') {
      setReveal(true);
      selectTop(value);
    }
  };
  const numberValues = numberPicker?.page === 'high'
    ? Array.from({ length: 10 }, (_, index) => index + 11)
    : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  return (
    <div className="mini-modal-backdrop zone-browser-backdrop" onClick={onClose}>
      <section className="zone-browser-modal mini-modal deluxe-zone-browser" onClick={(event) => event.stopPropagation()}>
        <div className="modal-topline zone-browser-titlebar">
          <div>
            <p className="eyebrow">Zone manager</p>
            <h2>{title}</h2>
          </div>
          <button className="close round-close" onClick={onClose}>×</button>
        </div>
        <div className="zone-browser-summary">
          <span>{cards.length} card{cards.length === 1 ? '' : 's'} total</span>
          <span>{selectedItems.length} selected</span>
          {browser.zone === 'library' && <span>{hiddenLibrary ? 'Hidden deck view' : 'Revealed/searchable view'}</span>}
        </div>

        {browser.zone === 'library' && (
          <div className="library-quick-actions">
            <button className="secondary" onClick={() => setNumberPicker({ action: 'draw', page: 'low' })}>Draw X</button>
            <button className="secondary" onClick={() => setNumberPicker({ action: 'mill', page: 'low' })}>Mill X</button>
            <button className="secondary" onClick={() => setNumberPicker({ action: 'cascade', page: 'low' })}>Cascade X</button>
            <button className={reveal ? 'primary' : 'secondary'} onClick={() => setReveal((value) => !value)}>{reveal ? 'Hide library' : 'Reveal/search library'}</button>
            {numberPicker && (
              <div className="number-radial-popover" role="menu">
                <b>{numberPicker.action.toUpperCase()} amount</b>
                <div className="number-radial-grid">
                  {numberValues.map((value) => <button key={value} className="secondary" onClick={() => chooseNumber(numberPicker.action, value)}>{value}</button>)}
                  {numberPicker.page !== 'high' && <button className="secondary" onClick={() => setNumberPicker({ ...numberPicker, page: 'high' })}>10+</button>}
                  {numberPicker.page === 'high' && <button className="secondary" onClick={() => setNumberPicker({ ...numberPicker, page: 'low' })}>0–9</button>}
                </div>
              </div>
            )}
          </div>
        )}

        <div className={`zone-browser-filters ${hiddenLibrary ? 'is-hidden-library' : ''}`}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={hiddenLibrary ? 'Reveal library to search by name/text' : 'Search name, type, or oracle text'} disabled={hiddenLibrary} />
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} disabled={hiddenLibrary}>
            <option value="all">Any type</option>
            <option value="Creature">Creature</option>
            <option value="Artifact">Artifact</option>
            <option value="Enchantment">Enchantment</option>
            <option value="Instant">Instant</option>
            <option value="Sorcery">Sorcery</option>
            <option value="Land">Land</option>
            <option value="Equipment">Equipment</option>
          </select>
          <select value={colorFilter} onChange={(event) => setColorFilter(event.target.value)} disabled={hiddenLibrary}>
            <option value="all">Any color</option>
            <option value="W">White</option>
            <option value="U">Blue</option>
            <option value="B">Black</option>
            <option value="R">Red</option>
            <option value="G">Green</option>
            <option value="C">Colorless</option>
          </select>
        </div>

        <div className="zone-browser-actions">
          <button className="secondary" disabled={!selectedItems.length} onClick={() => moveSelected('hand')}>Move to hand</button>
          <button className="secondary" disabled={!selectedItems.length} onClick={() => moveSelected('battlefield')}>Chosen battlefield</button>
          <button className="secondary" disabled={!selectedItems.length} onClick={() => moveSelected('creatures')}>To creatures</button>
          <button className="secondary" disabled={!selectedItems.length} onClick={() => moveSelected('mana')}>To mana</button>
          {browser.zone !== 'graveyard' && <button className="secondary" disabled={!selectedItems.length} onClick={() => moveSelected('graveyard')}>To graveyard</button>}
          {browser.zone !== 'exile' && <button className="secondary" disabled={!selectedItems.length} onClick={() => moveSelected('exile')}>To exile</button>}
          <button className="secondary" disabled={!selectedItems.length} onClick={() => moveSelected('library', { libraryMode: 'top' })}>Top of library</button>
          <button className="secondary" disabled={!selectedItems.length} onClick={() => moveSelected('library', { libraryMode: 'bottom' })}>Bottom of library</button>
          <button className="secondary" disabled={!selectedItems.length} onClick={() => moveSelected('opponent-hand')}>Give to opponent</button>
        </div>

        <div className={`zone-card-grid ${hiddenLibrary ? 'hidden-library-grid' : ''}`}>
          {visibleCards.map((item) => {
            const selected = selectedIds.has(item.id);
            const card = item.card || {};
            const oppositePile = browser.zone === 'graveyard' ? 'exile' : 'graveyard';
            return (
              <article key={item.id} className={`zone-card-tile deluxe-zone-card ${selected ? 'selected' : ''}`}>
                <button className="zone-card-select-hit" onClick={() => toggleSelected(item.id)} title="Select this card">
                  <span className="zone-card-order">#{item.index + 1}</span>
                  {hiddenLibrary ? <img src={cardBackUrl} alt="Hidden library card" /> : (card.image ? <img src={card.image} alt={card.name} /> : <span className="zone-card-placeholder">{card.name || 'Card'}</span>)}
                  <strong>{hiddenLibrary ? 'Hidden card' : card.name}</strong>
                  {!hiddenLibrary && <em>{card.typeLine || 'Unknown type'}</em>}
                </button>
                {!hiddenLibrary && (
                  <div className="zone-card-actions">
                    <button onClick={() => moveOne(item, 'hand')}>Hand</button>
                    <button onClick={() => moveOne(item, 'battlefield')}>Field</button>
                    <button onClick={() => moveOne(item, oppositePile)}>{oppositePile === 'exile' ? 'Exile' : 'Grave'}</button>
                    <button onClick={() => moveOne(item, 'library', { libraryMode: 'top' })}>Library</button>
                    <button onClick={() => moveOne(item, 'opponent-hand')}>Give</button>
                  </div>
                )}
              </article>
            );
          })}
          {!visibleCards.length && <div className="empty-zone-browser">No cards match this filter.</div>}
        </div>
      </section>
    </div>
  );
}


function PerspectiveSeats({ players, localSeat }) {
  return (
    <>
      {SEATS.map((seat) => {
        const player = players[seat];
        if (!player) return null;
        const rel = relativeSeat(seat, localSeat);
        return <div key={seat} className={`seat-marker rel-${rel}`}>P{seat} · {player.name}</div>;
      })}
    </>
  );
}

function ZoneGuides({ players, localSeat }) {
  return (
    <div className="zone-guides">
      {SEATS.map((seat) => {
        const player = players[seat];
        const rel = relativeSeat(seat, localSeat);
        return (
          <React.Fragment key={seat}>
            <div className={`player-mat-outline rel-${rel} ${player ? '' : 'empty-mat'}`} style={getPlayerMatStyle(rel)}>
              <span>{player ? `P${seat} · ${player.name}` : `Player ${seat}`}</span>
            </div>
            {ALL_ZONES.map((zone) => (
              <div
                key={`${seat}-${zone.id}`}
                className={`zone-guide dynamic ${zone.id} rel-${rel} ${player ? '' : 'empty-zone'}`}
                style={getZoneGuideStyle(seat, zone.id, localSeat)}
              >
                <span>{zone.id === 'creatures' ? `P${seat} Battlefield` : zone.label}</span>
              </div>
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ZoneHotspots({ players, localSeat, onOpenZone }) {
  return (
    <div className="zone-hotspot-layer">
      {SEATS.map((seat) => {
        if (!players[seat]) return null;
        const rel = relativeSeat(seat, localSeat);
        return MANAGED_ZONE_IDS.map((zoneId) => (
          <button
            key={`hotspot-${seat}-${zoneId}`}
            type="button"
            className={`zone-hotspot ${zoneId} rel-${rel}`}
            style={getZoneHotspotStyle(seat, zoneId, localSeat)}
            onClick={(event) => {
              event.stopPropagation();
              onOpenZone?.(seat, zoneId);
            }}
            title={`Open Player ${seat} ${zoneId}`}
          >
            <span>{zoneId}</span>
          </button>
        ));
      })}
    </div>
  );
}


function localMatToPoint(rel, u, v) {
  const mat = PLAYER_MATS[rel] || PLAYER_MATS[0];
  if (rel === 2) return { x: mat.x + (1 - u) * mat.w, y: mat.y + (1 - v) * mat.h };
  if (rel === 1) return { x: mat.x + v * mat.w, y: mat.y + (1 - u) * mat.h };
  if (rel === 3) return { x: mat.x + (1 - v) * mat.w, y: mat.y + u * mat.h };
  return { x: mat.x + u * mat.w, y: mat.y + v * mat.h };
}

function pointToLocalMat(point, rel) {
  const mat = PLAYER_MATS[rel] || PLAYER_MATS[0];
  if (point.x < mat.x || point.x > mat.x + mat.w || point.y < mat.y || point.y > mat.y + mat.h) return null;
  if (rel === 2) return { u: 1 - ((point.x - mat.x) / mat.w), v: 1 - ((point.y - mat.y) / mat.h) };
  if (rel === 1) return { u: 1 - ((point.y - mat.y) / mat.h), v: (point.x - mat.x) / mat.w };
  if (rel === 3) return { u: (point.y - mat.y) / mat.h, v: 1 - ((point.x - mat.x) / mat.w) };
  return { u: (point.x - mat.x) / mat.w, v: (point.y - mat.y) / mat.h };
}

function getRectBoundsForRel(rel, rect) {
  const corners = [
    localMatToPoint(rel, rect.x, rect.y),
    localMatToPoint(rel, rect.x + rect.w, rect.y),
    localMatToPoint(rel, rect.x, rect.y + rect.h),
    localMatToPoint(rel, rect.x + rect.w, rect.y + rect.h)
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function getPlayerMatStyle(rel) {
  const bounds = getRectBoundsForRel(rel, { x: 0, y: 0, w: 1, h: 1 });
  return percentRectStyle(bounds);
}

function getZoneGuideStyle(seat, zone, localSeat) {
  const rel = relativeSeat(seat, localSeat);
  let rect = ZONE_RECTS[zone] || ZONE_RECTS.holding;
  if (MANAGED_ZONE_IDS.includes(zone)) {
    rect = { ...rect, x: rect.x + 0.004, w: Math.max(0.001, rect.w - 0.008) };
  }
  const bounds = getRectBoundsForRel(rel, rect);
  return percentRectStyle(bounds);
}

function getZoneHotspotStyle(seat, zone, localSeat) {
  const rel = relativeSeat(seat, localSeat);
  const rect = ZONE_RECTS[zone] || ZONE_RECTS.holding;
  const pad = MANAGED_ZONE_IDS.includes(zone) ? 0.008 : 0;
  const bounds = getRectBoundsForRel(rel, { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 });
  return percentRectStyle(bounds);
}

function percentRectStyle(rect) {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`
  };
}

function getSlotLocalPosition(zone, slot, slotPush = 0) {
  const rect = ZONE_RECTS[zone] || ZONE_RECTS.holding;
  const layout = {
    creatures: { cols: 16, startX: 0.035, endX: 0.965, startY: 0.25, rowGap: 0.36 },
    artifacts: { cols: 7, startX: 0.065, endX: 0.935, startY: 0.36, rowGap: 0.46 },
    enchantments: { cols: 7, startX: 0.065, endX: 0.935, startY: 0.36, rowGap: 0.46 },
    mana: { cols: 16, startX: 0.035, endX: 0.965, startY: 0.35, rowGap: 0.43 },
    holding: { cols: 1, startX: 0.5, endX: 0.5, startY: 0.18, rowGap: 0.18 },
    command: { cols: 1, startX: 0.5, endX: 0.5, startY: 0.50, rowGap: 0.28 },
    library: { cols: 1, startX: 0.5, endX: 0.5, startY: 0.54, rowGap: 0.28 },
    exile: { cols: 1, startX: 0.5, endX: 0.5, startY: 0.50, rowGap: 0.28 },
    graveyard: { cols: 1, startX: 0.5, endX: 0.5, startY: 0.50, rowGap: 0.28 }
  }[zone] || { cols: 1, startX: 0.5, endX: 0.5, startY: 0.5, rowGap: 0.30 };
  const row = Math.floor(slot / layout.cols);
  const col = slot % layout.cols;
  const baseT = layout.cols <= 1 ? 0.5 : layout.startX + (col * (layout.endX - layout.startX)) / (layout.cols - 1);
  const pushT = Math.min(0.24, slotPush * 0.030);
  const colT = Math.min(0.95, baseT + pushT);
  const rowT = Math.min(0.88, layout.startY + row * layout.rowGap);
  return { x: rect.x + rect.w * colT, y: rect.y + rect.h * rowT };
}

function getStackPushBefore(boardCard, allBoardCards = []) {
  if (!['creatures', 'artifacts', 'enchantments', 'mana'].includes(boardCard.zone)) return 0;
  const slotsBefore = new Map();
  for (const card of allBoardCards) {
    if (card.ownerSeat !== boardCard.ownerSeat || card.zone !== boardCard.zone) continue;
    if ((card.slot || 0) >= (boardCard.slot || 0)) continue;
    const slot = card.slot || 0;
    slotsBefore.set(slot, Math.max(slotsBefore.get(slot) || 0, (card.stackIndex || 0) + 1));
  }
  let push = 0;
  for (const count of slotsBefore.values()) push += Math.max(0, count - 1);
  return push;
}

function getBoardPoint(boardCard, localSeat, allBoardCards = []) {
  const slot = boardCard.slot || 0;
  const rel = relativeSeat(boardCard.ownerSeat, localSeat);
  const local = getSlotLocalPosition(boardCard.zone, slot, getStackPushBefore(boardCard, allBoardCards));
  return localMatToPoint(rel, local.x, local.y);
}

function getBoardCardStyle(boardCard, localSeat, allBoardCards = []) {
  const rel = relativeSeat(boardCard.ownerSeat, localSeat);
  const stack = boardCard.stackIndex || 0;
  const point = getBoardPoint(boardCard, localSeat, allBoardCards);
  const rotateByRel = rel === 2 ? 180 : rel === 1 ? -90 : rel === 3 ? 90 : 0;
  const outOfPlay = ['graveyard', 'exile', 'library'].includes(boardCard.zone);
  const tapRotation = !outOfPlay && boardCard.tapped ? 90 : 0;
  const pileStack = MANAGED_PILE_ZONES.includes(boardCard.zone);
  const stackDirection = rel === 2 ? -1 : 1;
  const stackLevel = boardCard.zone === 'creatures' ? Math.max(0, 30 - stack) : stack;
  return {
    left: `${point.x * 100}%`,
    top: `${point.y * 100}%`,
    '--stack-offset': pileStack ? '0px' : `${stack * 18 * stackDirection}px`,
    '--stack-level': stackLevel,
    '--card-rotation': `${rotateByRel + tapRotation}deg`
  };
}

function OpponentHandFans({ players, localSeat, aiStates, localHandCount = 0, localSeatId }) {
  return (
    <div className="opponent-hand-layer">
      {SEATS.filter((seat) => players[seat] && seat !== localSeatId).map((seat) => {
        const rel = relativeSeat(seat, localSeat);
        const count = players[seat]?.ai ? (aiStates[seat]?.hand?.length || 0) : Math.max(0, Number(players[seat]?.handCount || 0));
        if (!count) return null;
        const mat = PLAYER_MATS[rel] || PLAYER_MATS[0];
        const center = rel === 2
          ? localMatToPoint(rel, 0.5, -0.045)
          : rel === 1 || rel === 3
            ? localMatToPoint(rel, 0.5, 1.035)
            : localMatToPoint(rel, 0.5, 1.035);
        const rotateByRel = rel === 2 ? 180 : rel === 1 ? -90 : rel === 3 ? 90 : 0;
        const shown = Math.min(count, 12);
        return (
          <div key={`opp-hand-${seat}`} className={`opponent-hand-fan rel-${rel}`} style={{ left: `${center.x * 100}%`, top: `${center.y * 100}%`, '--opp-rot': `${rotateByRel}deg` }}>
            {Array.from({ length: shown }).map((_, index) => {
              const offset = (index - (shown - 1) / 2) * 20;
              return <img key={index} src={cardBackUrl} alt={`Player ${seat} hidden hand card`} style={{ '--opp-card-x': `${offset}px`, zIndex: index }} />;
            })}
            <span>P{seat} hand · {count}</span>
          </div>
        );
      })}
    </div>
  );
}

function AiCardAnim({ anim }) {
  return (
    <div
      className={`ai-card-animation ${anim.revealCard ? 'will-reveal' : ''}`}
      style={{
        '--ai-from-x': `${anim.from.x * 100}%`,
        '--ai-from-y': `${anim.from.y * 100}%`,
        '--ai-to-x': `${anim.to.x * 100}%`,
        '--ai-to-y': `${anim.to.y * 100}%`
      }}
    >
      <img className="ai-card-animation-back" src={cardBackUrl} alt="AI moving hidden card" />
      {anim.revealCard && <img className="ai-card-animation-front" src={anim.revealCard.image || cardBackUrl} alt={anim.revealCard.name || 'Revealed AI card'} />}
    </div>
  );
}

function DeckStack({ seat, localSeat, count, interactive, onDraw, onOpen }) {
  const rel = relativeSeat(seat, localSeat);
  const point = localMatToPoint(rel, ZONE_RECTS.library.x + ZONE_RECTS.library.w * 0.5, ZONE_RECTS.library.y + ZONE_RECTS.library.h * 0.60);
  const rotateByRel = rel === 2 ? 180 : rel === 1 ? -90 : rel === 3 ? 90 : 0;
  const depth = Math.max(12, Math.min(38, 12 + Math.round(count / 3)));
  return (
    <button
      className={`deck-stack ${interactive ? 'interactive' : ''}`}
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, '--deck-depth': `${depth}px`, '--deck-rotation': `${rotateByRel}deg` }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!interactive) return;
        if (seat === localSeat && typeof onDraw === 'function') onDraw();
        else onOpen?.();
      }}
      title={interactive ? (seat === localSeat ? 'Draw a card' : 'Open library manager') : `${count} cards remaining`}
    >
      <div className="deck-stack-shadow" />
      <div className="deck-stack-layer deck-stack-layer-3" />
      <div className="deck-stack-layer deck-stack-layer-2" />
      <div className="deck-stack-layer deck-stack-layer-1" />
      <img src={cardBackUrl} alt="Library" className="deck-stack-top" />
      <span className="deck-stack-count">{count}</span>
    </button>
  );
}


function getSelectionAnchor(selection, boardCards, localSeat) {
  const first = boardCards.find((card) => selection?.boardIds?.includes(card.boardId));
  if (!first) return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
  const point = getBoardPoint(first, localSeat, boardCards);
  return { x: `${point.x * 100}%`, y: `${point.y * 100}%` };
}

const MANA_PREVIEW_ORDER = ['W', 'U', 'B', 'R', 'G', 'C', 'ANY', '?'];

function normalizePreviewManaSymbol(symbol = '') {
  const raw = String(symbol || '').replace(/[{}]/g, '').trim().toUpperCase();
  if (!raw) return '';
  if (raw === 'ANY' || raw === 'A') return 'ANY';
  if (/^[WUBRGC]$/.test(raw)) return raw;
  if (raw === '?') return '?';
  return raw;
}

function uniqueSortedManaSymbols(symbols = []) {
  const seen = new Set();
  return symbols
    .map(normalizePreviewManaSymbol)
    .filter(Boolean)
    .filter((symbol) => {
      if (seen.has(symbol)) return false;
      seen.add(symbol);
      return true;
    })
    .sort((a, b) => {
      const ia = MANA_PREVIEW_ORDER.indexOf(a);
      const ib = MANA_PREVIEW_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
}

function previewSymbolsFromText(text = '') {
  return uniqueSortedManaSymbols((String(text || '').match(/\{[^}]+\}/g) || []).map((item) => item.replace(/[{}]/g, '')));
}

function previewChoiceOptionsForSource(source = {}, symbols = []) {
  const text = `${source.abilityText || ''} ${source.effectText || ''} ${source.label || ''} ${source.manaLabel || ''}`;
  if (/any color/i.test(text) || source.colorMode === 'any' || symbols.includes('ANY')) return ['W', 'U', 'B', 'R', 'G'];
  if (/commander(?:'s)? color identity/i.test(text) || source.colorMode === 'commanderColorIdentity') return uniqueSortedManaSymbols(symbols).filter((symbol) => symbol !== 'ANY' && symbol !== '?');
  if (/chosen color|choose a color/i.test(text) || source.colorMode === 'chosen-color') return ['W', 'U', 'B', 'R', 'G'];
  if (/\bor\b/i.test(text) && symbols.length > 1) return uniqueSortedManaSymbols(symbols).filter((symbol) => symbol !== 'ANY');
  return [];
}

function manaPreviewEntryFromSource(source = {}) {
  const rawSymbols = Array.isArray(source.mana) ? source.mana : previewSymbolsFromText(source.manaLabel || source.producedManaLabel || source.label);
  const normalized = rawSymbols.map(normalizePreviewManaSymbol).filter(Boolean);
  const symbols = normalized.length ? normalized : previewSymbolsFromText(`${source.effectText || ''} ${source.abilityText || ''} ${source.label || ''}`);
  const choiceOptions = previewChoiceOptionsForSource(source, symbols);
  if (choiceOptions.length) {
    const anyCount = Math.max(1, symbols.filter((symbol) => symbol === 'ANY').length);
    const explicitCount = symbols.filter((symbol) => symbol && symbol !== 'ANY').length;
    const count = /\bor\b/i.test(`${source.effectText || ''} ${source.abilityText || ''}`) ? 1 : Math.max(anyCount, explicitCount > 1 && source.colorMode !== 'commanderColorIdentity' ? 1 : anyCount);
    return { count: Math.max(1, count), choiceOptions, fixedSymbols: [], source };
  }
  const fixedSymbols = symbols.filter((symbol) => symbol && symbol !== 'ANY');
  return { count: Math.max(0, fixedSymbols.length), choiceOptions: [], fixedSymbols, source };
}

function combineTapAlternatives(entries = []) {
  if (!entries.length) return null;
  if (entries.length === 1) return entries[0];
  const bestCount = Math.max(...entries.map((entry) => Number(entry.count || 0)));
  const options = uniqueSortedManaSymbols(entries.flatMap((entry) => entry.choiceOptions?.length ? entry.choiceOptions : entry.fixedSymbols || []));
  const bestFixed = entries.find((entry) => Number(entry.count || 0) === bestCount && !entry.choiceOptions?.length)?.fixedSymbols || [];
  return {
    count: Math.max(1, bestCount),
    choiceOptions: options.length > 1 ? options : [],
    fixedSymbols: options.length > 1 ? [] : bestFixed,
    source: entries[0]?.source
  };
}

function summarizeFixedManaSymbols(symbols = []) {
  const normalized = symbols.map(normalizePreviewManaSymbol).filter(Boolean);
  if (!normalized.length) return '';
  const counts = normalized.reduce((acc, symbol) => ({ ...acc, [symbol]: Number(acc[symbol] || 0) + 1 }), {});
  return Object.entries(counts)
    .sort(([a], [b]) => {
      const ia = MANA_PREVIEW_ORDER.indexOf(a);
      const ib = MANA_PREVIEW_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([symbol, count]) => `${formatManaSymbols([symbol])}${count > 1 ? `×${count}` : ''}`)
    .join(' ');
}

function summarizeSelectedManaPreview(selection, boardCards = [], localSeat = 1, turn = 0, brain = null) {
  const selectedIds = new Set(selection?.boardIds || []);
  if (!selectedIds.size) return null;
  const selectedCards = boardCards.filter((card) => selectedIds.has(card.boardId));
  if (!selectedCards.length) return null;
  const seat = selectedCards[0]?.ownerSeat || localSeat;
  const inventory = buildAiAbilityInventory({ boardCards, seat, turn, brain: brain || loadAiBrain() });
  const selectedSources = (inventory.manaSources || []).filter((source) => selectedIds.has(source.boardId));
  if (!selectedSources.length) return null;
  const usableSources = selectedSources.filter((source) => source.usable !== false);
  if (!usableSources.length) {
    const reason = selectedSources.find((source) => source.reason)?.reason || 'unavailable';
    return { total: 0, mainText: '0 usable mana', fixedText: '', choiceText: '', detail: reason };
  }

  const byCard = new Map();
  for (const source of usableSources) {
    const key = source.boardId || source.id || `${source.sourceName}-${source.label}`;
    if (!byCard.has(key)) byCard.set(key, []);
    byCard.get(key).push(manaPreviewEntryFromSource(source));
  }

  const entries = Array.from(byCard.values()).map(combineTapAlternatives).filter(Boolean);
  const total = entries.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
  const fixedSymbols = entries.flatMap((entry) => entry.choiceOptions?.length ? [] : (entry.fixedSymbols || []));
  const choiceSets = entries.filter((entry) => entry.choiceOptions?.length).map((entry) => entry.choiceOptions);
  const fixedText = summarizeFixedManaSymbols(fixedSymbols);
  const choiceText = choiceSets.map((options) => options.map((symbol) => formatManaSymbols([symbol])).join('/')).join('  •  ');
  return {
    total,
    mainText: `${total} spendable mana`,
    fixedText,
    choiceText,
    detail: choiceSets.length ? 'hypothetical choices' : ''
  };
}

function RadialCardMenu({ selection, boardCards, localSeat, turn, aiBrain, onToggleTap, onMove, onHand, onLibrary, onCopy, onModify, onActivate, onClear }) {
  const anchor = getSelectionAnchor(selection, boardCards, localSeat);
  const manaPreview = summarizeSelectedManaPreview(selection, boardCards, localSeat, turn, aiBrain);
  return (
    <div className="radial-card-menu simplified-radial" style={{ left: anchor.x, top: anchor.y }}>
      {manaPreview && (
        <div className={`radial-mana-preview ${manaPreview.total ? '' : 'is-empty'}`.trim()}>
          <span className="radial-mana-preview-title">{manaPreview.mainText}</span>
          {manaPreview.fixedText && <ManaText text={manaPreview.fixedText} className="radial-mana-preview-icons" />}
          {manaPreview.choiceText && <span className="radial-mana-preview-choice">Choice: <ManaText text={manaPreview.choiceText} /></span>}
          {!manaPreview.fixedText && !manaPreview.choiceText && manaPreview.detail && <span className="radial-mana-preview-detail">{manaPreview.detail}</span>}
        </div>
      )}
      <button className="radial-action tap-action" style={{ '--angle': '-90deg' }} title="Tap / untap" onClick={onToggleTap}><ManaText text="{T}" /></button>
      <button className="radial-action" style={{ '--angle': '30deg' }} onClick={onModify}>Modify</button>
      <button className="radial-action" style={{ '--angle': '150deg' }} onClick={onActivate}>Activate</button>
      <button className="radial-center" onClick={onClear}>×</button>
    </div>
  );
}




function copyAiParseDebug({ card, plan, boardCard, action, step }) {
  const allActions = plan?.actions || [];
  const actionSummary = allActions.length
    ? allActions.map((item, index) => [
      `${index + 1}. ${item.type || 'unknown'} — ${item.label || ''}`,
      item.costText ? `   Cost: ${item.costText}` : '',
      item.effectText ? `   Effect: ${item.effectText}` : '',
      item.conditionText ? `   Condition: ${item.conditionText}` : '',
      item.targetDescription ? `   Target detail: ${item.targetDescription}` : '',
      item.targetExcludesSource ? '   Target limit: another target / excludes source' : '',
      item.delayedReturn ? `   Delayed return: ${item.delayedReturn.timing || ''} under ${item.delayedReturn.controller || 'default'} control` : '',
      item.returnCondition ? `   Return condition: ${item.returnCondition}` : '',
      item.amountLabel ? `   Amount: ${item.amountLabel}` : '',
      item.choices?.length ? `   Choices: ${item.choices.join(' / ')}` : '',
      item.keywordAction ? `   Keyword action: ${item.keywordAction}` : '',
      item.createsToken?.name ? `   Creates token: ${item.createsToken.count || 1} ${item.createsToken.name} ${item.createsToken.typeLine || 'token'}` : '',
      item.token?.traits?.length ? `   Token abilities: ${item.token.traits.join(', ')}` : '',
      item.bonusLife ? `   Life gain replacement bonus: +${item.bonusLife}` : '',
      item.prohibitedPayments?.length ? `   Prohibited payments: ${item.prohibitedPayments.join(', ')}` : '',
      item.type === 'spell_cost_modifier' ? `   Spell cost modifier: ${item.modifierMode} ${item.costDelta || ''} / players: ${item.affectedPlayers || ''} / applies to: ${(item.appliesTo || []).join(', ') || item.appliesToText || ''}${item.chosenTypeRef ? ' / chosen type' : ''}` : '',
      item.type === 'mass_destroy' ? `   Mass destroy: ${item.affectedObjects || ''}${item.manaValueFilter ? ` / MV ${item.manaValueFilter.op} ${item.manaValueFilter.value}` : ''}` : '',
      item.type === 'entry_tapped_modifier' ? `   Entry tapped modifier: ${item.affectedObjects || ''} / players: ${item.affectedPlayers || ''}` : '',
      item.type === 'top_card_type_check' ? `   Top-card check: ${item.conditionText || ''} -> ${item.destination || 'hand'}${item.chosenTypeRef ? ' / chosen type' : ''}` : '',
      item.requiresCombatState ? `   Combat state required: ${item.combatRole || 'combat creatures'}` : '',
      item.requiresCombatDeclarationCheck ? `   Combat declaration tax: ${item.declaration} / ${item.taxCost} / ${item.taxPer}` : '',
      item.instructionLabel ? `   Instructions: ${item.instructionLabel}` : ''
    ].filter(Boolean).join('\n')).join('\n')
    : 'none';
  const modalSummary = (plan?.modalChoiceRules || []).map((rule) => rule.label).join('; ');
  const lines = [
    'AI CARD PARSE DEBUG',
    '',
    `Card: ${card?.name || plan?.cardName || 'Unknown'}`,
    `Scryfall ID: ${card?.scryfallId || card?.id || ''}`,
    `Type Line: ${card?.typeLine || plan?.typeLine || ''}`,
    `Mana Cost: ${card?.manaCost || ''}`,
    `Controller: ${boardCard?.ownerSeat ? `P${boardCard.ownerSeat}` : 'unknown'}`,
    `Zone: ${boardCard?.zone || 'unknown'}`,
    boardCard && cardHasAlternateFaces(boardCard.card) ? `Active Face: ${activeFaceIndexForBoardCard(boardCard) + 1}/${cardFaces(boardCard.card).length} — ${getActiveCardForBoard(boardCard)?.name || card?.name || ''}` : '',
    card?.fullCardName ? `Full Card Name: ${card.fullCardName}` : '',
    '',
    'Full Oracle Text:',
    plan?.oracleText || card?.oracleText || '',
    '',
    modalSummary ? `Modal Choice Rules: ${modalSummary}` : '',
    '',
    'Oracle Section Being Reviewed:',
    action?.sourceText || action?.abilityText || action?.effectText || '',
    '',
    'Selected / Displayed Action:',
    `Type: ${action?.type || 'none'}`,
    `Label: ${action?.label || ''}`,
    `Cost: ${action?.costText || ''}`,
    `Effect: ${action?.effectText || ''}`,
    `Target: ${action?.target ? `${action.target.name} (P${action.target.ownerSeat})` : 'none'}`,
    `Condition: ${action?.conditionText || 'none'}`,
    `Condition Check: ${action?.conditionCheck?.reason || 'not evaluated'}`,
    action?.libraryChoices?.length ? `Library Choices: ${action.libraryChoices.map((choice, index) => `${index + 1}. ${choice.name} -> ${choice.destination || action.destination || 'hand'}${choice.tapped ? ' tapped' : ''}`).join('; ')}` : '',
    action?.token ? `Token: ${action.token.count || 1} ${action.token.power || '?'}/${action.token.toughness || '?'} ${action.token.name || 'Token'}${action.token.traits?.length ? ` with ${action.token.traits.join(', ')}` : ''}` : '',
    '',
    'All Detected Actions:',
    actionSummary,
    '',
    `Current Step: ${step?.title || 'n/a'}`,
    `AI Confidence: ${plan?.confidence || 0}%`,
    plan?.confidenceReasons?.length ? `Confidence Factors: ${plan.confidenceReasons.join('; ')}` : ''
  ].filter((line) => line !== '').join('\n');
  try {
    navigator.clipboard?.writeText(lines);
  } catch {}
  return lines;
}



function normalizeExactManaCost(cost = '') {
  return String(cost || '').replace(/\s+/g, '').toUpperCase();
}

function cardMatchesLibraryCriteriaForAction(card = {}, action = {}) {
  const criteria = action.searchCriteria || {};
  const type = card.typeLine || '';
  const name = card.name || '';
  if (criteria.basicOnly && !/\bBasic\b/i.test(type)) return false;
  if (criteria.landOnly && !/\bLand\b/i.test(type)) return false;
  if (criteria.exactManaCosts?.length) {
    const cardManaCost = normalizeExactManaCost(card.manaCost || '');
    if (!criteria.exactManaCosts.includes(cardManaCost)) return false;
  }
  if (criteria.landChoices?.length) {
    return criteria.landChoices.some((land) => new RegExp(`\\b${escapeRegexLiteral(land)}\\b`, 'i').test(`${type} ${name}`));
  }
  const filters = uniqueStrings([...(criteria.targetFilters || []), ...(action.targetFilters || [])]);
  if (!filters.length || filters.includes('Card')) return true;
  if (filters.includes('Permanent') && /\b(?:Artifact|Creature|Enchantment|Land|Planeswalker|Battle)\b/i.test(type)) return true;
  return filters.some((filter) => new RegExp(`\\b${escapeRegexLiteral(filter)}\\b`, 'i').test(type));
}

function maxLibraryChoicesForAction(action = {}) {
  const criteria = action.searchCriteria || {};
  return Math.max(1, Number(criteria.maxChoices || action.choiceCount || 1));
}

function libraryDestinationForChoiceIndex(action = {}, index = 0) {
  const criteria = action.searchCriteria || {};
  const distribution = criteria.distribution || [];
  if (!distribution.length) return { destination: action.destination || criteria.destination || 'hand', tapped: Boolean(action.tapped || criteria.tapped) };
  let cursor = 0;
  for (const step of distribution) {
    const count = Math.max(1, Number(step.count || 1));
    if (index >= cursor && index < cursor + count) return { destination: step.destination || 'hand', tapped: Boolean(step.tapped) };
    cursor += count;
  }
  return { destination: action.destination || criteria.destination || 'hand', tapped: false };
}

function clearAiSuggestedLibraryChoices(action = {}) {
  if (action.type !== 'search_library') return action;
  const { libraryChoice, libraryChoices, ...rest } = action;
  return {
    ...rest,
    aiSuggestedLibraryChoice: libraryChoice || null,
    aiSuggestedLibraryChoices: libraryChoices || [],
    playerLibraryChoiceRequired: true
  };
}

function actionChoiceKind(action = {}) {
  if (!action) return '';
  if (action.choiceKind) return action.choiceKind;
  const text = `${action.effectText || ''} ${action.label || ''} ${action.sourceText || ''}`;
  if (action.type === 'choose_color' || /choose a color/i.test(text)) return 'color';
  if (action.type === 'choose_creature_type' || /choose (?:a )?creature type/i.test(text)) return 'creature_type';
  if (action.type === 'choose_card_type' || /choose (?:a )?card type/i.test(text)) return 'card_type';
  if (action.type === 'choose_card_name' || action.type === 'named_card_consultation' || /choose (?:a )?card name/i.test(text)) return 'card_name';
  if (action.type === 'choose_number' || /choose (?:a )?number/i.test(text)) return 'number';
  if (action.type === 'modal_choice_rule' || action.choices?.length) return action.choiceKind || 'modal';
  return '';
}

function actionNeedsChoice(action, sourceBoardCard = null) {
  if (!action) return false;
  if (actionChoiceKind(action)) return true;
  if (actionNeedsTarget(action) && !action.target) return true;
  if (action.type === 'search_library' && action.playerLibraryChoiceRequired) return true;
  if (action.type === 'search_library' && sourceBoardCard?.ownerSeat && !action.libraryChoice && !(action.libraryChoices || []).length) return true;
  return false;
}

function actionIsManualChoiceSafe(action = {}) {
  return Boolean(actionChoiceKind(action) || actionNeedsTarget(action) || action.type === 'search_library');
}

function choiceTitleForKind(kind = '') {
  return ({
    color: 'Choose a color',
    creature_type: 'Choose a creature type',
    card_type: 'Choose a card type',
    card_name: 'Choose a card name',
    number: 'Choose a number',
    target: 'Choose a target',
    library: 'Choose card(s) from library',
    optional: 'Use optional effect?',
    modal: 'Choose a mode'
  })[kind] || 'Choose option';
}

function uniqueStrings(list = []) {
  return [...new Set((list || []).map((item) => String(item || '').trim()).filter(Boolean))];
}

function creatureTypesFromCards(cards = []) {
  const types = [];
  cards.forEach((boardCard) => {
    const afterDash = String(getActiveCardForBoard(boardCard)?.typeLine || boardCard?.card?.typeLine || '').split(/[—-]/)[1] || '';
    afterDash.split(/\s+/).forEach((type) => {
      const clean = type.replace(/[^A-Za-z-]/g, '').trim();
      if (clean && !/Token|Legendary|Basic|Artifact|Creature|Enchantment|Land|Instant|Sorcery|Planeswalker/i.test(clean)) types.push(clean);
    });
  });
  return uniqueStrings([...types, ...COMMON_CREATURE_TYPE_CHOICES]).slice(0, 40);
}

function escapeRegexLiteral(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function targetCandidateMatchesAction(boardCard, action = {}, sourceBoardCard = null) {
  if (!boardCard) return false;
  if ((boardCard.boardId === sourceBoardCard?.boardId) && /another|other/i.test(`${action.effectText || ''} ${action.affectedObjects || ''}`)) return false;
  if (!isBattlefieldZone(boardCard.zone)) return false;
  const typeLine = getActiveCardForBoard(boardCard)?.typeLine || boardCard.card?.typeLine || '';
  const text = `${action.affectedObjects || ''} ${action.effectText || ''} ${action.sourceText || ''} ${action.label || ''}`;
  if (action.ownerHint === 'opponent' && boardCard.ownerSeat === sourceBoardCard?.ownerSeat) return false;
  if (action.ownerHint === 'self' && boardCard.ownerSeat !== sourceBoardCard?.ownerSeat) return false;
  if (/you control/i.test(text) && boardCard.ownerSeat !== sourceBoardCard?.ownerSeat) return false;
  if (/opponent|don't control/i.test(text) && boardCard.ownerSeat === sourceBoardCard?.ownerSeat) return false;
  const filters = uniqueStrings([...(action.targetFilters || []), ...(action.searchCriteria?.targetFilters || [])]);
  if (filters.length && !filters.includes('Card')) {
    if (!filters.some((filter) => new RegExp(`\\b${escapeRegexLiteral(filter)}\\b`, 'i').test(typeLine))) return false;
  }
  if (/target creature|creature you/i.test(text) && !/\bCreature\b/i.test(typeLine)) return false;
  if (/target artifact/i.test(text) && !/\bArtifact\b/i.test(typeLine)) return false;
  if (/target enchantment/i.test(text) && !/\bEnchantment\b/i.test(typeLine)) return false;
  if (/target land/i.test(text) && !/\bLand\b/i.test(typeLine)) return false;
  if (/nonland/i.test(text) && /\bLand\b/i.test(typeLine)) return false;
  return true;
}

function hydrateActionChoice(action = {}, sourceBoardCard = null, selection = {}) {
  const kind = selection.kind || actionChoiceKind(action) || (selection.target ? 'target' : '');
  const next = { ...action, playerChoice: selection.value || selection.label || selection.target?.name || '' };
  if (selection.target) next.target = selection.target;
  if (kind === 'library') {
    const selectedCards = selection.cards?.length ? selection.cards : (selection.card ? [selection.card] : []);
    const libraryChoices = selectedCards
      .filter(Boolean)
      .map((card, index) => ({
        ...card,
        scryfallId: card.scryfallId || card.id || '',
        ...libraryDestinationForChoiceIndex(action, index)
      }));
    if (libraryChoices.length) {
      next.libraryChoice = libraryChoices[0];
      next.libraryChoices = libraryChoices;
      next.choiceCount = libraryChoices.length;
      next.playerConfirmedLibraryChoice = true;
    }
  }
  if (kind === 'color') {
    next.chosenColor = selection.value;
    next.producedMana = [String(selection.value || 'Any').slice(0, 1).toUpperCase()];
    next.producedManaLabel = `{${String(selection.value || 'Any').slice(0, 1).toUpperCase()}}`;
  }
  if (kind === 'creature_type') next.chosenType = selection.value;
  if (kind === 'card_type') next.chosenCardType = selection.value;
  if (kind === 'card_name') next.chosenCardName = selection.value;
  if (kind === 'number') next.chosenNumber = Number(selection.value || 0);
  if (kind === 'modal') next.chosenMode = selection.value || selection.label;
  if (kind === 'optional') {
    if (selection.value === 'skip') return { ...next, type: 'noop', skipAction: true, label: 'Skipped optional effect' };
    next.optionalAccepted = true;
  }
  if (action.type === 'choose_and_grant_trait' && selection.value) {
    next.type = 'grant_trait';
    next.trait = selection.value;
    next.label = `Grant ${selection.value} to ${action.affectedObjects || 'chosen objects'}`;
  }
  return next;
}

function actionNeedsTarget(action) {
  if (!action) return false;
  if (action.type === 'modify_pt' && action.affectedObjects && !/target/i.test(action.effectText || action.sourceText || action.abilityText || '')) return false;
  if (action.type === 'set_base_pt' && action.affectedObjects && !/target/i.test(action.effectText || action.sourceText || action.abilityText || '')) return false;
  if (action.type === 'grant_trait' && action.affectedObjects && !/target/i.test(action.effectText || action.sourceText || action.abilityText || '')) return false;
  return ['destroy', 'exile', 'temporary_exile_return', 'linked_exile_until_source_leaves', 'modify_pt', 'set_base_pt', 'equip', 'attach_permanent', 'direct_damage', 'return_to_hand', 'untap', 'tap', 'move_to_battlefield', 'return_to_battlefield', 'return_from_graveyard_to_battlefield'].includes(action.type);
}

function isActionUsable(action, sourceBoardCard = null) {
  if (!action) return false;
  if (sourceBoardCard && action.sourceZoneRequirement && sourceBoardCard.zone !== action.sourceZoneRequirement) return false;
  if (action.conditionCheck?.met === false) return false;
  if (actionNeedsTarget(action)) return Boolean(action.target);
  if (action.type === 'search_library') return !action.playerLibraryChoiceRequired && Boolean(action.libraryChoice || action.libraryChoices?.length);
  return true;
}

function buildAiDecisionSteps(plan, action) {
  if (!plan || !action) return [];
  const steps = [];
  if (action.optional) {
    steps.push({
      type: 'optional',
      title: 'Optional / may check',
      prompt: 'The AI thinks this effect is optional. Should it choose to use this effect right now?',
      details: ['Detected words like may or up to.', 'Choosing yes means this effect remains a candidate for this play.']
    });
  }
  if (action.costText) {
    const parts = action.cost?.parts?.length ? action.cost.parts.map((part) => part.label) : [action.costText];
    if (action.sourceZoneRequirement) parts.push(`Source zone required: ${action.sourceZoneRequirement}`);
    if (action.sourceCostMove?.destination) parts.push(`Source moves to ${action.sourceCostMove.destination} as part of the cost.`);
    steps.push({
      type: 'cost',
      title: 'Cost check',
      prompt: 'Before choosing targets or results, confirm the AI identified the cost correctly and can pay it.',
      details: parts
    });
  }
  if (action.triggerText) {
    steps.push({
      type: 'trigger',
      title: 'Trigger / watcher check',
      prompt: 'Confirm this is a triggered ability that should watch for a future game event, not an activate-now effect.',
      details: [
        `Trigger: ${action.triggerText}`,
        `Effect when it triggers: ${action.effectText || action.label}`,
        'This should be registered as a battlefield watcher when the source is in play.'
      ]
    });
  }
  steps.push({
    type: 'effect',
    title: 'Effect check',
    prompt: 'Confirm the core action the AI thinks this card is performing.',
    details: [
      action.label,
      action.conditionText ? `Condition: ${action.conditionText}` : '',
      action.conditionCheck?.reason ? `Condition check: ${action.conditionCheck.reason}` : '',
      action.costReductionCheck?.reason ? `Cost reduction check: ${action.costReductionCheck.reason}` : '',
      action.costReductionCheck?.payableCost ? `Estimated activation cost now: ${action.costReductionCheck.payableCost}` : '',
      action.costReduction?.note ? `Cost reduction rule: ${action.costReduction.note}` : '',
      action.triggerText ? `Trigger: ${action.triggerText}` : '',
      action.abilityText
    ]
  });
  if (action.type === 'add_mana') {
    steps.push({
      type: 'mana-source',
      title: 'Reusable mana source check',
      prompt: 'Should this be saved as a usable mana source for future AI turns?',
      details: [
        action.costText ? `Cost: ${action.costText}` : 'No cost detected',
        action.producedManaLabel ? `Produces: ${action.producedManaLabel}` : (action.label || 'Produces mana'),
        action.manaRestriction ? `Restriction: ${action.manaRestriction}` : 'Restriction: none — normal floating mana',
        action.amountLabel ? `Amount: ${action.amountLabel}` : '',
        action.effectText ? `Effect: ${action.effectText}` : action.label,
        'Approved mana abilities are stored as executable abilities, not just notes.'
      ]
    });
  }
  if (actionNeedsTarget(action)) {
    steps.push({
      type: 'target',
      title: 'Target check',
      prompt: 'Confirm this is a legal and sensible target for that effect.',
      details: action.target
        ? [`Target: ${action.target.name}`, `Zone: ${action.target.zone}`, `Owner/controller: Player ${action.target.ownerSeat}`, action.target.originalOwnerSeat ? `Original owner: Player ${action.target.originalOwnerSeat}` : '', `Threat score: ${action.target.threat}`]
        : ['No valid target found. Reject this if the card needs a target.']
    });
  }
  if (action.type === 'search_library') {
    const criteria = action.searchCriteria || {};
    const choices = action.libraryChoices?.length ? action.libraryChoices : (action.libraryChoice ? [action.libraryChoice] : []);
    steps.push({
      type: 'library-choice',
      title: 'Library choice check',
      prompt: 'Confirm the AI understood the library-search choices and selected the correct number of cards from its deck.',
      details: [
        `Valid choice group: ${(criteria.landChoices?.length ? criteria.landChoices.join(' / ') : (criteria.targetFilters || ['Card']).join(' / '))}`,
        `Expected choices: ${criteria.optionalCount ? 'up to ' : ''}${criteria.maxChoices || 1}`,
        choices.length ? `Actual choices: ${choices.length} — ${choices.map((choice, index) => `Choice ${index + 1}: ${choice.name} → ${choice.destination || action.destination || criteria.destination || 'hand'}${choice.tapped ? ' tapped' : ''}`).join('; ')}` : 'No matching card found in library.',
        `${action.candidateCount || 0} valid library option(s) found.`
      ]
    });
  }
  if (action.type === 'add_counters') {
    steps.push({
      type: 'counter-result',
      title: 'Counter result check',
      prompt: 'Confirm this creates counters, not just a temporary power/toughness note.',
      details: [`Counter: ${action.counterType || '+1/+1'}`, `Amount: ${action.counterAmount === 'damageDealt' ? 'that many (damage dealt)' : (action.counterAmount || 1)}`, action.xDefinition ? `X = ${action.xDefinition}` : '', `Applies to: ${action.affectedObjects || 'target/affected creature(s)'}`]
    });
  }
  if (action.type === 'equipment_static_pt') {
    const best = action.equipmentRecommendation?.best;
    steps.push({
      type: 'equipment-static',
      title: 'Equipment static effect check',
      prompt: 'Confirm this only modifies the equipped creature after the equip cost has attached it.',
      details: [
        action.label,
        action.multiplier || '',
        'Applies to: equipped creature only.',
        'Do not apply this until the Equipment is actually attached.',
        best ? `Best current equip target: ${best.target.name}` : '',
        best ? `Current payoff: +${best.estimatedPowerBonus}/+${best.estimatedToughnessBonus}` : '',
        best?.reason || action.equipmentRecommendation?.reason || ''
      ]
    });
  }
  if (action.type === 'equip') {
    steps.push({
      type: 'equip-action',
      title: 'Equip activated ability check',
      prompt: 'Confirm this is an equip cost and the target must be a creature controlled by the Equipment controller.',
      details: [
        action.costText ? `Cost: ${action.costText}` : 'No equip cost detected',
        'Target: creature you control',
        action.target ? `Recommended target: ${action.target.name}` : '',
        action.target?.estimatedPowerBonus !== undefined ? `Estimated equipment payoff: +${action.target.estimatedPowerBonus}/+${action.target.estimatedToughnessBonus}` : '',
        action.target?.equipmentReason || action.equipmentRecommendation?.reason || ''
      ]
    });
  }
  if (action.type === 'choose_creature_type') {
    const choice = action.creatureTypeChoice;
    steps.push({
      type: 'creature-type-choice',
      title: 'Creature type choice check',
      prompt: 'Confirm the AI picked the best creature type using battlefield value first, then hand/library support.',
      details: [
        choice?.bestType ? `Recommended type: ${choice.bestType}` : 'No recommendation yet.',
        choice?.reason || '',
        choice?.scored?.length ? `Top options: ${choice.scored.map((item) => `${item.type} — board ${item.board}, hand ${item.hand}, library ${item.deck}`).join('; ')}` : ''
      ]
    });
  }
  if (action.type === 'create_token') {
    const token = action.token || {};
    steps.push({
      type: 'token-result',
      title: 'Token result check',
      prompt: 'Confirm the token result that the AI parsed.',
      details: [`Create ${token.count || 1}`, `Name: ${token.name || 'Token'}`, token.power || token.toughness ? `P/T: ${token.power || '?'}/${token.toughness || '?'}` : 'No P/T detected', action.controllerHint === 'targetController' ? 'Controller: the destroyed/target permanent’s controller gets this token' : 'Controller: caster/source controller gets this token', action.costReduction?.note ? `Cost reduction: ${action.costReduction.note}` : '']
    });
  }
  return steps;
}

function AiReviewModal({ review, onApply, onApproveOnly, onReject, onClose }) {
  const [note, setNote] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [zoomedCard, setZoomedCard] = useState(false);
  const plan = review?.plan;
  const boardCard = review?.boardCard;
  const actionableActions = (plan?.actions || []).filter((action) => isActionUsable(action, boardCard));
  const bestAction = review?.selectedAction || actionableActions[0] || plan?.actions?.[0] || null;
  const [responseWorthy, setResponseWorthy] = useState(false);
  useEffect(() => {
    setResponseWorthy(Boolean(plan?.responseProfile?.responseWorthy));
    setZoomedCard(false);
  }, [plan?.cardKey]);
  const reviewedOracleText = bestAction?.sourceText || bestAction?.abilityText || plan?.oracleText || 'No oracle text available.';
  const decisionSteps = useMemo(() => buildAiDecisionSteps(plan, bestAction), [plan, bestAction]);
  const autoAppliesThisReview = shouldAutoApplyAiReview(review);
  const autoApprovalBlocked = autoApprovalBlockReason(plan);
  const currentStep = decisionSteps[Math.min(stepIndex, Math.max(0, decisionSteps.length - 1))];
  const isFinalStep = stepIndex >= decisionSteps.length - 1;
  const rejectCurrentStep = () => onReject(`${currentStep?.title || 'AI step'} rejected. ${note}`.trim(), { responseWorthy, responseReason: responseWorthy ? 'Marked during AI review' : '' });
  const acceptCurrentStep = (apply) => {
    if (!isFinalStep) {
      setStepIndex((value) => Math.min(value + 1, decisionSteps.length - 1));
      return;
    }
    const options = { responseWorthy, responseReason: responseWorthy ? 'Marked during AI review' : '' };
    if (apply) onApply(bestAction, options);
    else onApproveOnly(bestAction, options);
  };
  const copyDebug = () => copyAiParseDebug({ card: boardCard?.card, plan, boardCard, action: bestAction, step: currentStep });
  return (
    <div className="mini-modal-backdrop ai-review-backdrop" onClick={onClose}>
      <section className="ai-review-modal mini-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-topline">
          <div>
            <p className="eyebrow">AI learning check · Step {Math.min(stepIndex + 1, decisionSteps.length || 1)} of {decisionSteps.length || 1}</p>
            <h2>{plan?.cardName || boardCard?.card?.name || 'Played card'}</h2>
            <p className="mini-subtle-label">Ability {(review?.abilityIndex || 0) + 1} of {review?.abilityCount || 1}</p>
          </div>
          <button className="close round-close" onClick={onClose}>×</button>
        </div>
        <p className="modal-copy">The AI now validates effects in pieces: optional choice, cost, main action, then target or library choice. Each yes/no answer teaches the local brain more precisely.</p>
        <div className="ai-review-layout">
          <aside className="ai-review-card-art enlarged-review-art" onClick={() => setZoomedCard(true)}>{boardCard?.card?.image ? <img src={boardCard.card.image} alt={boardCard.card.name} /> : <div className="no-image-card">{plan?.cardName || 'Card'}</div>}<span className="image-zoom-hint">Tap to inspect</span></aside>
          <section className="ai-review-main-copy">
            <div className="ai-confidence-row">
              <span>Confidence: <b>{plan?.confidence || 0}%</b></span>
              <span>Memory: <b>{plan?.approvedCount || 0} approved / {plan?.rejectedCount || 0} rejected</b></span>
              <span>Auto threshold: <b>{AI_AUTO_APPROVE_CONFIDENCE}%</b></span>
              <button className="secondary mini-copy-button" onClick={copyDebug} title="Copy AI parse debug info">⧉ Copy debug</button>
            </div>
            {autoAppliesThisReview && <div className="ai-suggestion-box muted-box">{review?.deferResolution ? 'Auto-approving this card understanding while priority is paused; it will not resolve until you press Pass priority / resolve.' : `Auto-approving this card understanding because confidence is ${plan.confidence}% and every parsed ability has a common action.`}</div>}
            {!autoAppliesThisReview && autoApprovalBlocked && <div className="ai-suggestion-box muted-box">{autoApprovalBlocked}</div>}
            <ConfidenceFactorTags plan={plan} />
            <ModalChoiceSummary plan={plan} />
            <label className="response-flag-toggle"><input type="checkbox" checked={responseWorthy} onChange={(event) => setResponseWorthy(event.target.checked)} /> Response card / contains response action</label>
            {plan?.responseProfile?.reasons?.length ? <div className="response-reason-list">{plan.responseProfile.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div> : null}
            <div className="ai-oracle-box"><b>Oracle text being reviewed</b><OracleReviewText text={reviewedOracleText} abilities={bestAction ? [{ sourceText: reviewedOracleText }] : []} /></div>

            {currentStep ? (
              <article className={`ai-decision-step step-${currentStep.type}`}>
                <div className="ai-step-title-row">
                  <b>{currentStep.title}</b>
                  <span>{currentStep.type}</span>
                </div>
                <p>{currentStep.prompt}</p>
                <div className="ai-step-detail-list">
                  {currentStep.details.filter(Boolean).map((detail, index) => <span key={index}><ManaText text={String(detail)} /></span>)}
                </div>
              </article>
            ) : (
              <div className="ai-suggestion-box muted-box">No automatic action suggested. This can still be marked correct/incorrect for the local brain.</div>
            )}
          </section>
        </div>

        <details className="ai-parse-details">
          <summary>Show full parsed text</summary>
          <div className="ai-ability-list compact-ai-ability-list">
            {(plan?.abilities || []).map((ability) => (
              <article key={ability.id} className={`ai-ability-card ${ability.actions.length ? '' : 'unparsed'}`}>
                {ability.modeHeader && <small>{ability.modeHeader}</small>}
                <strong>{ability.optional ? 'Optional / may' : 'Mandatory / normal'}</strong>
                {ability.triggerText && <p className="trigger-line"><b>Trigger:</b> <ManaText text={ability.triggerText} /></p>}
                {ability.conditionText && <p className="trigger-line"><b>Condition:</b> <ManaText text={ability.conditionText} /></p>}
                {ability.costText && <p><b>Cost:</b> <ManaText text={ability.costText} /></p>}
                <p><b>Effect:</b> <ManaText text={ability.effectText || ability.sourceText} /></p>
                {ability.actions.length ? (
                  <>
                    <div className="ai-action-tags">{ability.actions.map((action, index) => <span key={index}><ManaText text={action.label} /></span>)}</div>
                    {ability.actions.map((action, index) => <AiActionDetailNotes key={`detail-note-${index}`} action={action} />)}
                  </>
                ) : <em>No common action recognized yet.</em>}
              </article>
            ))}
          </div>
        </details>

        {bestAction ? (
          <div className="ai-suggestion-box">
            <b>Current action:</b>
            <span><ManaText text={bestAction.label} /></span>
            {bestAction.type === 'create_token' && bestAction.controllerHint === 'targetController' && <span>Token controller: the destroyed/target permanent’s controller, not necessarily the caster.</span>}
            {bestAction.target && <span>Target: {bestAction.target.name} (P{bestAction.target.ownerSeat}) · threat {bestAction.target.threat}</span>}
            {bestAction.sourceZoneRequirement && <span>Source zone required: {bestAction.sourceZoneRequirement}</span>}
            {bestAction.sourceCostMove?.destination && <span>Cost moves source to: {bestAction.sourceCostMove.destination}</span>}
            {bestAction.type === 'add_mana' && bestAction.producedManaLabel && <span>Produces: <ManaText text={bestAction.producedManaLabel} /></span>}
            {bestAction.type === 'add_mana' && <span>{bestAction.manaRestriction ? `Restricted mana: ${bestAction.manaRestriction}` : 'Normal unrestricted mana'}</span>}
            {bestAction.creatureTypeChoice?.bestType && <span>Recommended type: {bestAction.creatureTypeChoice.bestType}</span>}
            {bestAction.equipmentRecommendation?.best && <span>Best equip target: {bestAction.equipmentRecommendation.best.target.name} (+{bestAction.equipmentRecommendation.best.estimatedPowerBonus}/+{bestAction.equipmentRecommendation.best.estimatedToughnessBonus})</span>}
            {bestAction.target?.equipmentReason && <span>Equip reason: {bestAction.target.equipmentReason}</span>}
            {bestAction.conditionCheck?.reason && <span>Condition check: {bestAction.conditionCheck.reason}</span>}
            {bestAction.costReductionCheck?.reason && <span>Cost reduction: {bestAction.costReductionCheck.reason}</span>}
            {bestAction.costReductionCheck?.payableCost && <span>Estimated activation cost: <ManaText text={bestAction.costReductionCheck.payableCost} /></span>}
            {bestAction.libraryChoices?.length ? <span>Library choices: {bestAction.libraryChoices.map((choice, index) => `Choice ${index + 1}: ${choice.name} → ${choice.destination || bestAction.destination || 'hand'}${choice.tapped ? ' tapped' : ''}`).join('; ')}</span> : bestAction.libraryChoice && <span>Library choice: {bestAction.libraryChoice.name}</span>}
            {!isActionUsable(bestAction) && <span>No valid target/choice found.</span>}
          </div>
        ) : null}

        <label>Optional correction note
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Example: cost is wrong, or it should choose Forest here" />
        </label>
        <div className="modal-actions ai-review-actions">
          <button className="secondary danger-action" onClick={rejectCurrentStep}>No / reject this step</button>
          {!isFinalStep && <button className="primary" disabled={!currentStep} onClick={() => acceptCurrentStep(false)}>Yes, next check</button>}
          {isFinalStep && <button className="primary" onClick={() => acceptCurrentStep(false)}>Remember</button>}
          {isFinalStep && !review?.deferResolution && <button className="secondary" disabled={!bestAction || !isActionUsable(bestAction, boardCard)} onClick={() => acceptCurrentStep(true)}>Use This Action + Remember</button>}
        </div>
        {zoomedCard && boardCard?.card?.image && <div className="card-image-zoom-backdrop" onClick={() => setZoomedCard(false)}><img src={boardCard.card.image} alt={boardCard.card.name} /></div>}
      </section>
    </div>
  );
}

function ModifyModal({ boardCards, selection, onApply, onClose }) {
  const [powerDelta, setPowerDelta] = useState(0);
  const [toughnessDelta, setToughnessDelta] = useState(0);
  const [duration, setDuration] = useState('eot');
  const [trait, setTrait] = useState('');
  const [kind, setKind] = useState('pt');
  const [sourceId, setSourceId] = useState(selection?.boardIds?.[0] || '');
  return (
    <div className="mini-modal-backdrop" onClick={onClose}>
      <section className="modify-modal mini-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-topline"><h2>Modify selected card</h2><button className="close round-close" onClick={onClose}>×</button></div>
        <div className="modify-tabs">
          <button className={kind === 'pt' ? 'active' : ''} onClick={() => setKind('pt')}>Power / Toughness</button>
          <button className={kind === 'trait' ? 'active' : ''} onClick={() => setKind('trait')}>Type / Effect</button>
        </div>
        {kind === 'pt' ? (
          <div className="pt-mod-grid intuitive-pt-grid">
            <section className="pt-stat-column">
              <label>Power <input type="number" value={powerDelta} onChange={(e) => setPowerDelta(Number(e.target.value) || 0)} /></label>
              <button onClick={() => setPowerDelta((v) => v + 1)}>Increase power</button>
              <button onClick={() => setPowerDelta((v) => v - 1)}>Decrease power</button>
            </section>
            <section className="pt-stat-column">
              <label>Toughness <input type="number" value={toughnessDelta} onChange={(e) => setToughnessDelta(Number(e.target.value) || 0)} /></label>
              <button onClick={() => setToughnessDelta((v) => v + 1)}>Increase toughness</button>
              <button onClick={() => setToughnessDelta((v) => v - 1)}>Decrease toughness</button>
            </section>
          </div>
        ) : (
          <label>Add type / effect <input value={trait} onChange={(e) => setTrait(e.target.value)} placeholder="Flying, Deathtouch, Vampire..." /></label>
        )}
        <div className="duration-row">
          <button className={duration === 'eot' ? 'active' : ''} onClick={() => setDuration('eot')}>EOT</button>
          <button className={duration === 'permanent' ? 'active' : ''} onClick={() => setDuration('permanent')}>∞</button>
          <button className={duration === 'linked' ? 'active' : ''} onClick={() => setDuration('linked')}>Linked</button>
        </div>
        {duration === 'linked' && (
          <label>Linked source
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {boardCards.map((card) => <option key={card.boardId} value={card.boardId}>{card.card.name}</option>)}
            </select>
          </label>
        )}
        <button className="primary" onClick={() => onApply(kind === 'pt' ? { kind: 'pt', powerDelta, toughnessDelta, duration, sourceId } : { kind: 'trait', trait, duration, sourceId })}>Apply modification</button>
      </section>
    </div>
  );
}

function ActionChoiceModal({ request, boardCards = [], library = [], onChoose, onClose }) {
  const { sourceBoardCard, action } = request || {};
  const inferredKind = actionNeedsTarget(action) && !action?.target ? 'target' : (action?.type === 'search_library' ? 'library' : (actionChoiceKind(action) || 'modal'));
  const [customValue, setCustomValue] = useState('');
  const [numberValue, setNumberValue] = useState(1);
  const [selectedLibraryIndexes, setSelectedLibraryIndexes] = useState([]);
  const targetCandidates = boardCards
    .filter((card) => targetCandidateMatchesAction(card, action, sourceBoardCard))
    .slice(0, 60)
    .map((card) => ({ kind: 'target', value: card.boardId, label: `${card.card?.name || 'Card'} — P${card.ownerSeat} ${card.zone}`, target: { boardId: card.boardId, ownerSeat: card.ownerSeat, controllerSeat: card.controllerSeat, name: card.card?.name || 'Card', typeLine: card.card?.typeLine || '', zone: card.zone } }));
  const maxLibraryChoices = maxLibraryChoicesForAction(action || {});
  const libraryCandidates = action?.type === 'search_library'
    ? library
      .map((card, index) => ({ card, index }))
      .filter((item) => cardMatchesLibraryCriteriaForAction(item.card, action))
      .slice(0, 120)
    : [];
  const describeLibraryChoiceDestination = (choiceOrder) => {
    const destination = libraryDestinationForChoiceIndex(action || {}, choiceOrder);
    if (!destination.destination) return '';
    return `${destination.destination}${destination.tapped ? ' tapped' : ''}`;
  };
  const toggleLibraryIndex = (index) => {
    setSelectedLibraryIndexes((current) => {
      if (current.includes(index)) return current.filter((item) => item !== index);
      if (current.length >= maxLibraryChoices) return [...current.slice(1), index];
      return [...current, index];
    });
  };
  const submitLibraryChoices = () => {
    const selectedCards = selectedLibraryIndexes
      .map((index) => library.find((_, libraryIndex) => libraryIndex === index))
      .filter(Boolean);
    if (!selectedCards.length) return;
    onChoose({ kind: 'library', cards: selectedCards, label: selectedCards.map((card) => card.name).join(', ') });
  };
  const libraryChoiceDetails = (() => {
    if (inferredKind !== 'library') return [];
    const criteria = action?.searchCriteria || {};
    const parts = [];
    if (criteria.basicOnly || criteria.landOnly || criteria.targetFilters?.length) {
      const targetLabel = criteria.landChoices?.length ? criteria.landChoices.join(' / ') : (criteria.targetFilters || ['Card']).join(' / ');
      parts.push(`${criteria.basicOnly ? 'Basic ' : ''}${targetLabel}`.trim());
    }
    if (criteria.exactManaCosts?.length) parts.push(`mana cost exactly ${criteria.exactManaCosts.join(' or ')}`);
    const countLabel = `${criteria.optionalCount ? 'up to ' : ''}${maxLibraryChoices}`;
    parts.push(`choose ${countLabel}`);
    return parts;
  })();
  const libraryOptions = libraryCandidates.map(({ card, index }) => {
    const selectedOrder = selectedLibraryIndexes.indexOf(index);
    const selected = selectedOrder >= 0;
    const destinationLabel = selected ? describeLibraryChoiceDestination(selectedOrder) : '';
    return {
      kind: 'library',
      value: String(index),
      label: `${index + 1}. ${card.name}${destinationLabel ? ` → ${destinationLabel}` : ''}`,
      libraryIndex: index,
      card,
      selected,
      selectedOrder
    };
  });
  const baseOptions = (() => {
    if (inferredKind === 'color') return DEFAULT_COLOR_CHOICES.map((value) => ({ kind: inferredKind, value, label: value }));
    if (inferredKind === 'creature_type') return creatureTypesFromCards(boardCards).map((value) => ({ kind: inferredKind, value, label: value }));
    if (inferredKind === 'card_type') return DEFAULT_CARD_TYPE_CHOICES.map((value) => ({ kind: inferredKind, value, label: value }));
    if (inferredKind === 'optional') {
      return [
        { kind: inferredKind, value: 'use', label: 'Use this optional effect' },
        { kind: inferredKind, value: 'skip', label: 'Do not use it' }
      ];
    }
    if (inferredKind === 'modal') {
      const choices = action?.choices?.length ? action.choices : ['Use first mode', 'Use second mode', 'Use both if legal'];
      return choices.map((value) => ({ kind: inferredKind, value, label: value }));
    }
    if (inferredKind === 'target') return targetCandidates;
    if (inferredKind === 'library') return libraryOptions;
    return [];
  })();
  const submitCustom = () => {
    const value = inferredKind === 'number' ? numberValue : customValue.trim();
    if (value === '' || value == null) return;
    onChoose({ kind: inferredKind, value, label: String(value) });
  };
  return (
    <div className="mini-modal-backdrop" onClick={onClose}>
      <section className="choice-modal mini-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-topline">
          <div>
            <p className="eyebrow">Player choice required</p>
            <h2>{choiceTitleForKind(inferredKind)}</h2>
          </div>
          <button className="close round-close" onClick={onClose}>×</button>
        </div>
        <p className="modal-copy"><b>{sourceBoardCard?.card?.name || 'Source'}:</b> <ManaText text={action?.sourceText || action?.effectText || action?.label || action?.type} /></p>
        {request?.reason && <p className="choice-reason">{request.reason}</p>}
        {inferredKind === 'library' && libraryChoiceDetails.length ? (
          <div className="choice-filter-summary">
            {libraryChoiceDetails.map((detail) => <span key={detail}>{detail}</span>)}
          </div>
        ) : null}
        {baseOptions.length ? (
          <div className={inferredKind === 'target' || inferredKind === 'library' ? 'choice-card-grid' : 'choice-chip-grid'}>
            {baseOptions.map((option) => (
              <button
                key={`${option.kind}-${option.value}-${option.label}`}
                className={`secondary choice-chip ${option.selected ? 'active selected' : ''}`}
                onClick={() => inferredKind === 'library' ? toggleLibraryIndex(option.libraryIndex) : onChoose(option)}
              >
                {option.card?.image ? <img src={option.card.image} alt={option.card.name} /> : null}
                <span>{option.label}</span>
                {inferredKind === 'library' && option.selected ? <em>Choice {option.selectedOrder + 1}</em> : null}
              </button>
            ))}
          </div>
        ) : <div className="ai-suggestion-box muted-box">No legal automatic option list was available. Enter the choice manually below.</div>}
        {inferredKind === 'library' && (
          <div className="library-choice-confirm-row">
            <span>{selectedLibraryIndexes.length}/{maxLibraryChoices} selected</span>
            <button className="primary" disabled={!selectedLibraryIndexes.length} onClick={submitLibraryChoices}>Use selected card(s)</button>
          </div>
        )}
        {(inferredKind === 'card_name' || inferredKind === 'number' || (!baseOptions.length && inferredKind !== 'library')) && (
          <div className="choice-custom-row">
            {inferredKind === 'number' ? (
              <input type="number" value={numberValue} min="0" onChange={(event) => setNumberValue(event.target.value)} />
            ) : (
              <input value={customValue} onChange={(event) => setCustomValue(event.target.value)} placeholder={inferredKind === 'card_name' ? 'Type card name' : 'Type choice'} />
            )}
            <button className="primary" onClick={submitCustom}>Use choice</button>
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}


function ActivateModal({ sourceCards = [], plan = null, onApply, onClose, onCopyDebug }) {
  const rawSource = sourceCards[0];
  const source = withActiveFaceCard(rawSource);
  const actions = plan?.actions || [];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  const selectedAction = actions[selectedIndex] || null;
  const groupedByAbility = actions.reduce((acc, action) => {
    const key = action.abilityId || action.sourceText || action.label;
    if (!acc[key]) acc[key] = [];
    acc[key].push(action);
    return acc;
  }, {});
  const applySelected = () => {
    if (!selectedAction) return;
    onApply({ mode: 'aiAction', action: selectedAction, moveSourceToGraveyard: /\bInstant\b|\bSorcery\b/i.test(source?.card?.typeLine || '') });
  };
  const copyDebug = () => {
    onCopyDebug?.(rawSource || source, plan, selectedAction);
    setCopyStatus('Copied parse debug.');
  };
  const faceIndex = rawSource ? activeFaceIndexForBoardCard(rawSource) : 0;
  const faces = cardFaces(rawSource?.card);
  return (
    <div className="mini-modal-backdrop" onClick={onClose}>
      <section className="activate-modal mini-modal rules-activate-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-topline">
          <div>
            <p className="eyebrow">Activate / resolve known rules</p>
            <h2>{source?.card?.name || 'Selected card'}</h2>
            {faces.length > 1 && <p className="active-face-note">Showing active face {faceIndex + 1}/{faces.length}: {source?.card?.name}</p>}
          </div>
          <div className="activate-header-actions">
            <button className="secondary mini-copy-button" onClick={copyDebug} title="Copy this card's parse/debug info">⧉ Copy debug</button>
            <button className="close round-close" onClick={onClose}>×</button>
          </div>
        </div>
        <p className="modal-copy">Pick the specific parsed/learned rule you are trying to use. This uses the same AI rules memory instead of a generic manual modifier.</p>
        {plan?.oracleText && (
          <div className="ai-oracle-box activate-oracle-box">
            <b>Oracle text being reviewed</b>
            <OracleReviewText text={plan.oracleText} abilities={plan?.abilities || []} />
          </div>
        )}
        {actions.length ? (
          <div className="activate-rule-layout">
            <div className="activate-rule-list">
              {Object.entries(groupedByAbility).map(([abilityKey, abilityActions]) => (
                <article key={abilityKey} className="activate-ability-group">
                  <small>{abilityActions[0]?.sourceText || abilityActions[0]?.abilityText || 'Parsed ability'}</small>
                  {abilityActions.map((action) => {
                    const index = actions.indexOf(action);
                    return (
                      <button key={`${action.type}-${index}`} className={index === selectedIndex ? 'active' : ''} onClick={() => setSelectedIndex(index)}>
                        <span><ManaText text={action.label || action.type} /></span>
                        {action.costText && <em><ManaText text={action.costText} /></em>}
                      </button>
                    );
                  })}
                </article>
              ))}
            </div>
            <div className="activate-rule-detail">
              {selectedAction ? (
                <>
                  <h3><ManaText text={selectedAction.label || selectedAction.type} /></h3>
                  <p><b>Source:</b> {source?.card?.name} (P{source?.ownerSeat})</p>
                  {selectedAction.triggerText && <p className="trigger-line"><b>Trigger:</b> <ManaText text={selectedAction.triggerText} /></p>}
                  {selectedAction.costText && <p><b>Cost:</b> <ManaText text={selectedAction.costText} /></p>}
                  {selectedAction.cost?.parts?.length ? <div className="ai-action-tags cost-action-tags">{selectedAction.cost.parts.map((part, index) => <span key={index}><ManaText text={part.label} /></span>)}</div> : null}
                  {selectedAction.sourceZoneRequirement && <p><b>Required zone:</b> {selectedAction.sourceZoneRequirement}</p>}
                  {selectedAction.sourceCostMove?.destination && <p><b>Source movement:</b> to {selectedAction.sourceCostMove.destination}</p>}
                  {selectedAction.type === 'add_mana' && selectedAction.producedManaLabel && <p><b>Produces:</b> <ManaText text={selectedAction.producedManaLabel} /></p>}
                  {selectedAction.type === 'add_mana' && <p><b>Mana restriction:</b> {selectedAction.manaRestriction || 'none — normal unrestricted mana'}</p>}
                  {selectedAction.effectText && <p><b>Effect:</b> <ManaText text={selectedAction.effectText} /></p>}
                  <AiActionDetailNotes action={selectedAction} />
                  {selectedAction.conditionText && <p><b>Conditional:</b> {selectedAction.conditionText}</p>}
                  {actionNeedsTarget(selectedAction) && (
                    <p><b>Target:</b> {selectedAction.target ? `${selectedAction.target.name} (P${selectedAction.target.ownerSeat})` : 'No valid target detected'}</p>
                  )}
                  {selectedAction.type === 'search_library' && (
                    <div className="library-choice-preview">
                      <b>Library choices detected:</b>
                      {(selectedAction.libraryChoices || []).length ? (
                        <ol>
                          {selectedAction.libraryChoices.map((choice, index) => (
                            <li key={`${choice.name}-${index}`}>{choice.name} → {choice.destination || selectedAction.destination || 'hand'}{choice.tapped ? ' tapped' : ''}</li>
                          ))}
                        </ol>
                      ) : selectedAction.libraryChoice ? (
                        <ol><li>{selectedAction.libraryChoice.name} → {selectedAction.libraryChoice.destination || selectedAction.destination || 'hand'}{selectedAction.libraryChoice.tapped ? ' tapped' : ''}</li></ol>
                      ) : <span>No matching card found in library.</span>}
                      <span>{selectedAction.choiceCount || 0}/{selectedAction.searchCriteria?.maxChoices || 1} selected from {selectedAction.candidateCount || 0} valid option(s).</span>
                    </div>
                  )}
                  {selectedAction.type === 'equip' && <p className="warning-copy">Equipment reminder: this does not grant the Equipment bonus until the equip cost is paid and it is attached to a legal creature you control.</p>}
                  {selectedAction.type === 'flashback' && <p className="warning-copy">Flashback reminder: this casts the card from the graveyard. When it resolves this way, move it to exile instead of graveyard.</p>}
                </>
              ) : <p>No parsed actions found for this card yet. Use the AI learning popup/relearn command to teach it first.</p>}
            </div>
          </div>
        ) : (
          <div className="ai-suggestion-box muted-box">No executable rules are currently known for this card. Try <code>ai_reset target</code> and click it to rerun learning.</div>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={copyDebug}>Copy parse debug</button>
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!selectedAction || !isActionUsable(selectedAction)} onClick={applySelected}>Use selected rule</button>
          {copyStatus && <span className="ai-missing-copy-status">{copyStatus}</span>}
        </div>
      </section>
    </div>
  );
}



function DraggingPreview({ dragging }) {
  if (!dragging?.point) return null;
  const rawCards = dragging.source === 'board' && dragging.cards?.length
    ? [...dragging.cards].sort((a, b) => Number(a.stackIndex || 0) - Number(b.stackIndex || 0))
    : [{ boardId: 'hand-drag', card: dragging.card }];
  if (rawCards.length <= 1) {
    const card = rawCards[0]?.card || dragging.card || {};
    return (
      <img
        className={`dragging-card ${dragging.source === 'board' ? 'board-dragging-card' : ''} ${dragging.lifting ? 'is-lifting' : ''}`}
        src={card.image || cardBackUrl}
        alt={card.name || 'Moving card'}
        style={{ left: `${dragging.point.x * 100}%`, top: `${dragging.point.y * 100}%` }}
      />
    );
  }
  return (
    <div
      className={`dragging-stack-preview ${dragging.lifting ? 'is-lifting' : ''}`}
      style={{ left: `${dragging.point.x * 100}%`, top: `${dragging.point.y * 100}%` }}
      aria-label="Moving card stack"
    >
      {rawCards.map((boardCard, index) => {
        const card = boardCard.card || {};
        const outOfPlay = ['graveyard', 'exile', 'library'].includes(boardCard.zone);
        return (
          <img
            key={boardCard.boardId || `${card.name || 'card'}-${index}`}
            className={`dragging-stack-card ${boardCard.tapped && !outOfPlay ? 'is-tapped' : ''}`}
            src={card.image || cardBackUrl}
            alt={card.name || 'Moving card'}
            style={{ '--drag-stack-x': `${index * 18}px`, zIndex: 820 + index }}
          />
        );
      })}
    </div>
  );
}

function BoardCard({ boardCard, localSeat, allBoardCards, selected, onClick, onPointerStart, onPreviewChange, onCommanderTaxChange, hideTraitBadges = false }) {
  const displayCard = getActiveCardForBoard(boardCard) || boardCard.card;
  const faces = cardFaces(boardCard.card);
  const faceIndex = activeFaceIndexForBoardCard(boardCard);
  const previewPayload = displayCard ? { ...displayCard, instanceId: boardCard.boardId } : null;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`board-card ${boardCard.tapped && !['graveyard', 'exile', 'library'].includes(boardCard.zone) ? 'tapped' : ''} ${['graveyard', 'exile'].includes(boardCard.zone) ? 'out-of-play-card' : ''} ${selected ? 'selected-card' : ''} ${boardCard.isCommander ? 'commander-board-card' : ''} ${boardCard.transforming ? 'transforming-card' : ''} ${faces.length > 1 ? 'multi-face-card' : ''} stack-${Math.min(boardCard.stackIndex || 0, 5)}`}
      style={getBoardCardStyle(boardCard, localSeat, allBoardCards)}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
      onPointerEnter={() => onPreviewChange?.(previewPayload)}
      onPointerLeave={() => onPreviewChange?.(null)}
      onFocus={() => onPreviewChange?.(previewPayload)}
      onBlur={() => onPreviewChange?.(null)}
      onPointerDown={onPointerStart}
      title={`${displayCard.name} (controller P${boardCard.ownerSeat}${boardCard.originalOwnerSeat && boardCard.originalOwnerSeat !== boardCard.ownerSeat ? `, owner P${boardCard.originalOwnerSeat}` : ''})`}
    >
      <div className="board-card-face">
        {displayCard.image ? <img src={displayCard.image} alt={displayCard.name} /> : <span>{displayCard.name}</span>}
      </div>
      {faces.length > 1 && <div className="transform-face-chip">Face {faceIndex + 1}/{faces.length}</div>}
      {!['graveyard', 'exile'].includes(boardCard.zone) && <CardBadges boardCard={boardCard} hideTraitBadges={hideTraitBadges} />}
      {boardCard.isCommander && boardCard.zone === 'command' && <CommanderTaxControls boardCard={boardCard} onChange={onCommanderTaxChange} />}
    </div>
  );
}

function CommanderTaxControls({ boardCard, onChange }) {
  const tax = Number(boardCard.commanderTax || 0);
  return (
    <div className="commander-tax-controls" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <button type="button" aria-label="Decrease commander tax" onClick={() => onChange?.(boardCard.boardId, -2)}>−</button>
      <span>Tax +{tax}</span>
      <button type="button" aria-label="Increase commander tax" onClick={() => onChange?.(boardCard.boardId, 2)}>+</button>
    </div>
  );
}

function CardBadges({ boardCard, hideTraitBadges = false }) {
  const stats = getCardStats(boardCard);
  const traits = getCardTraits(boardCard);
  const counterMods = (boardCard?.mods || []).filter((mod) => mod.kind === 'counter');
  const counterSummary = counterMods.reduce((acc, mod) => {
    const key = mod.counterType || '+1/+1';
    acc[key] = (acc[key] || 0) + Number(mod.counterAmount || 1);
    return acc;
  }, {});
  return (
    <>
      {stats.hasStats && stats.power !== '' && stats.toughness !== '' && (
        <div className={`pt-badge ${stats.tone}`}>{stats.power}/{stats.toughness}</div>
      )}
      {Object.entries(counterSummary).length > 0 && (
        <div className="counter-badge-rail">
          {Object.entries(counterSummary).map(([kind, amount]) => <span key={kind} className="counter-badge">{kind} ×{amount}</span>)}
        </div>
      )}
      {!hideTraitBadges && traits.length > 0 && (
        <div className="trait-badge-rail">
          <div className={traits.length > 4 ? 'trait-badge-scroll' : ''}>
            {traits.map((trait, index) => <span key={`${trait}-${index}`} className="trait-badge">{trait}</span>)}
          </div>
        </div>
      )}
    </>
  );
}

function HandFan({ hand, dockRef, onPointerDown, setTooltipCard, previewCard, setPreviewCard }) {
  const mid = (hand.length - 1) / 2;
  const gap = Math.min(84, hand.length > 1 ? 760 / (hand.length - 1) : 0);
  const angleStep = Math.min(6.2, hand.length > 1 ? 46 / (hand.length - 1) : 0);
  return (
    <section className="hand-dock" ref={dockRef}>
      <div className="hand-fan">
        {hand.map((card, index) => {
          const distance = index - mid;
          const angle = distance * angleStep;
          const offset = distance * gap;
          const lowCurve = Math.abs(distance) * 7;
          const selected = previewCard?.instanceId === card.instanceId;
          return (
            <button
              key={card.instanceId}
              className={`hand-card ${selected ? 'is-previewed' : ''}`}
              style={{
                '--fan-x': `${offset}px`,
                '--fan-y': `${lowCurve}px`,
                '--fan-rot': `${angle}deg`,
                '--hover-rot': `${angle * 0.12}deg`,
                zIndex: 100 + index
              }}
              onPointerEnter={() => setPreviewCard(card)}
              onPointerLeave={() => setPreviewCard(null)}
              onFocus={() => setPreviewCard(card)}
              onClick={() => setPreviewCard(card)}
              onPointerDown={(event) => onPointerDown(card, index, event)}
              onDoubleClick={() => setTooltipCard(card)}
              title={card.name}
            >
              {card.image ? <img src={card.image} alt={card.name} draggable="false" /> : <span>{card.name}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function HandHoverPreview({ card }) {
  return (
    <aside className="hand-preview" aria-label={`Large preview of ${card.name}`}>
      {card.image ? <img src={card.image} alt={card.name} /> : <div className="no-image-card">{card.name}</div>}
      <div className="hand-preview-caption">
        <strong>{card.name}</strong>
        {card.manaCost && <ManaText text={card.manaCost} className="mana-cost-inline" />}
      </div>
    </aside>
  );
}

function manaIconName(symbol) {
  const raw = String(symbol || '').trim();
  const normalized = raw.toLowerCase().replace(/∞/g, 'infinity').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const direct = {
    t: 'tap',
    q: 'untap',
    untap: 'untap',
    snow: 's',
    infinity: 'infinity'
  };
  const name = direct[normalized] || normalized;
  const supported = new Set(['0','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','w','u','b','r','g','c','x','y','z','s','e','p','tap','untap','infinity']);
  return supported.has(name) ? name : null;
}

function manaSymbolColorClass(icon) {
  if (['w'].includes(icon)) return 'mana-symbol-w';
  if (['u'].includes(icon)) return 'mana-symbol-u';
  if (['b'].includes(icon)) return 'mana-symbol-b';
  if (['r'].includes(icon)) return 'mana-symbol-r';
  if (['g'].includes(icon)) return 'mana-symbol-g';
  if (['c','x','y','z','s','e','p','infinity'].includes(icon)) return 'mana-symbol-c';
  if (/^\d+$/.test(icon)) return 'mana-symbol-generic';
  if (['tap','untap'].includes(icon)) return 'mana-symbol-generic';
  return 'mana-symbol-generic';
}

function ManaText({ text, className = '' }) {
  if (!text) return null;
  const chunks = String(text).split(/(\{[^}]+\})/g).filter(Boolean);
  return (
    <span className={`mana-text ${className}`.trim()}>
      {chunks.map((chunk, index) => {
        const match = chunk.match(/^\{([^}]+)\}$/);
        if (!match) return <React.Fragment key={`${chunk}-${index}`}>{chunk}</React.Fragment>;
        const icon = manaIconName(match[1]);
        if (!icon) return <span key={`${chunk}-${index}`} className="mana-symbol-fallback">{chunk}</span>;
        return (
          <span key={`${chunk}-${index}`} className={`mana-symbol ${manaSymbolColorClass(icon)}`} title={chunk} aria-label={chunk}>
            <span className="mana-symbol-letter" aria-hidden="true">{String(match[1]).toUpperCase()}</span>
            <img
              className="mana-symbol-icon"
              src={`/mana/${icon}.svg`}
              alt=""
              aria-hidden="true"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
                event.currentTarget.parentElement?.classList.add('missing-icon');
              }}
            />
          </span>
        );
      })}
    </span>
  );
}

function CardTooltip({ card, onClose }) {
  const boardCard = card?.boardCard || null;
  const actualCard = boardCard ? getActiveCardForBoard(boardCard) : (card?.card || card);
  const traits = boardCard ? getCardTraits(boardCard) : cardBaseTraits(actualCard);
  const stats = boardCard ? getCardStats(boardCard) : { power: actualCard?.power, toughness: actualCard?.toughness, tone: 'normal' };
  return (
    <aside className="card-tooltip redesigned-tooltip">
      <button className="close" onClick={onClose}>×</button>
      <div className="tooltip-card-art">
        {actualCard.image ? <img src={actualCard.image} alt={actualCard.name} /> : <div className="no-image-card">{actualCard.name}</div>}
      </div>
      <div className="tooltip-card-info">
        <h2>{actualCard.name}</h2>
        {actualCard.manaCost && <p className="mana-cost"><ManaText text={actualCard.manaCost} /></p>}
        <p className="type-line"><b>{actualCard.typeLine}</b></p>
        {traits.length > 0 && <div className="expanded-traits">{traits.map((trait, index) => <span key={`${trait}-${index}`}>{trait}</span>)}</div>}
        <p className="oracle-text"><ManaText text={actualCard.oracleText} /></p>
        {stats.hasStats && (stats.power !== '' || stats.toughness !== '') && <p className={`pt ${stats.tone}`}>{stats.power}/{stats.toughness}</p>}
      </div>
    </aside>
  );
}

function RevealCard({ card }) {
  return (
    <div className="reveal-overlay">
      <div className="reveal-card slap">
        {card.image ? <img src={card.image} alt={card.name} /> : <div className="no-image-card">{card.name}</div>}
      </div>
    </div>
  );
}

function DrawAnim({ card, from, to }) {
  return (
    <div
      className="draw-animation"
      style={{
        '--draw-x': `${from.x}px`,
        '--draw-y': `${from.y}px`,
        '--draw-to-x': `${to.x}px`,
        '--draw-to-y': `${to.y}px`
      }}
    >
      <div className="draw-card draw-stage"><img src={cardBackUrl} alt="Card back" /></div>
      <div className="draw-card draw-stage draw-stage-front"><img src={card.image || cardBackUrl} alt={card.name} /></div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
