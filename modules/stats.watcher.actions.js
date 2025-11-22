// modules/stats.watcher.actions.js
// Stats-driven rule watcher (v1)
// -----------------------------------------------
// Bridges between:
//   - TurnUpkeep (stats + phases)
//   - Zone / ETB / LTB / life / cast events
//   - StatsRulesOverlay (choice-tree "Rules" UI)
//
// This version actually evaluates some rule kinds:
//   - WHEN → PLAYER → Gain Life / Lose Life / Draw / Cast / Creates (tokens/counters)
//   - DURING → (Your/Opponent/Both) phase (Upkeep / Main / Combat / End Step)
//
// Everything else is left as scaffolding for future expansion.
// It NEVER mutates game state – it only fires overlay notifications.

import { TurnUpkeep } from './turn.upkeep.js';
import { StatsRulesOverlay } from './stats.rules.overlay.js';

const __MOD = (import.meta?.url || 'unknown').split('/').pop();
window.__modTime?.(__MOD, 'start');

// -------------------------------------------------------------
// INTERNAL STATE
// -------------------------------------------------------------

// Rule bindings:
//   rule.id -> { rule, predicate(ctx) }
const _Bindings = new Map();

let _wireDone = false;

// Per-turn gate for "First Time" style rules
const _PerTurn = {
  turn: null,
  fired: new Set() // rule.id that have fired this turn
};

// -------------------------------------------------------------
// SMALL HELPERS
// -------------------------------------------------------------

function _log(...args) {
  try { console.log('[StatsWatcherActions]', ...args); } catch {}
}

function mySeatSafe() {
  try {
    if (typeof window.mySeat === 'function') {
      const n = Number(window.mySeat());
      return n === 2 ? 2 : 1;
    }
  } catch {}
  return 1;
}

function seatKey(seat) {
  return (Number(seat) === 2 ? 2 : 1);
}

function _safeState() {
  try {
    return TurnUpkeep.state?.() || { turn: 1, phase: 'main1', activeSeat: 1, txid: 0 };
  } catch {
    return { turn: 1, phase: 'main1', activeSeat: 1, txid: 0 };
  }
}

function _safeSnapshot() {
  try {
    return TurnUpkeep.getSnapshot?.() || TurnUpkeep.recomputeSnapshot?.() || {};
  } catch {
    return {};
  }
}

function _safeTallies() {
  try {
    return TurnUpkeep.getTallies?.() || {};
  } catch {
    return {};
  }
}

function _safeZones() {
  // TODO: once Zones exports `getState`, prefer that.
  try {
    return window.Zones?.getState?.() || {};
  } catch {
    return {};
  }
}

function _ensureTurnWindow() {
  const st = _safeState();
  if (_PerTurn.turn !== st.turn) {
    _PerTurn.turn = st.turn;
    _PerTurn.fired.clear();
  }
}

// Simple frequency gate: "First Time" vs "Any Time"
function _checkFrequencyForRule(ruleId, freq) {
  const f = freq || 'Any Time';
  if (f === 'Any Time') return true;

  if (f === 'First Time') {
    if (_PerTurn.fired.has(ruleId)) return false;
    _PerTurn.fired.add(ruleId);
    return true;
  }

  // Unknown / future options: treat as Any Time
  return true;
}

// -------------------------------------------------------------
// BINDINGS / COMPILATION
// -------------------------------------------------------------

function _clearBindings() {
  _Bindings.clear();
}

// Map PLAYER event key → TurnUpkeep metric name for stats:update
const PLAYER_EVENT_METRIC_MAP = {
  gainlife: 'lifegain',
  loselife: 'lifeloss',
  draw:     'draws',
  scry:     'scry',
  surveil:  'surveil',
  tutor:    'tutors'
  // future: investigates, etc.
};



function _matchesSeatMode(seat, mode) {
  const s = seatKey(seat ?? mySeatSafe());
  const me = mySeatSafe();

  switch (mode) {
    case 'You':
      return s === me;
    case 'Opponent':
      return s !== me;
    case 'All Players':
    default:
      return true;
  }
}

  // Count how many cards on the battlefield a given seat controls that
  // match the requested "controls" rule kind + value.
  function _countControlledBoardMatches(seat, kind, value) {
    const seatNum = Number(seat || 0);
    if (!seatNum) return 0;
    if (!value) return 0;

    const val = String(value).trim().toLowerCase();
    const kindKey = String(kind || '').toLowerCase();

    // Table cards are your normal in-play permanents.
    const cards = Array.from(
      document.querySelectorAll('.table-card[data-field-side]')
    );

    let count = 0;

    for (const el of cards) {
      const d = el.dataset || {};

      // Ignore anything that’s explicitly in the commander zone
      if (d.inCommandZone === 'true') continue;

      const owner = Number(d.ownerCurrent || d.owner || 0);
      if (!owner || owner !== seatNum) continue;

      // Type line text
      const tl = String(
        d.typeLine ||
        d.frontTypeLine ||
        d.backTypeLine ||
        ''
      ).toLowerCase();

      // Parsed baseTypes snapshot, e.g. ["Creature","Minotaur","Warrior"]
      let baseTypes = [];
      if (d.baseTypes) {
        try {
          const parsed = JSON.parse(d.baseTypes);
          if (Array.isArray(parsed)) {
            baseTypes = parsed.map(x => String(x).toLowerCase());
          }
        } catch (_) {
          // bad JSON? ignore and fall back to type line only
        }
      }

      const hasType = (needle) => {
        const n = String(needle).toLowerCase();
        if (tl && tl.includes(n)) return true;
        if (baseTypes.length && baseTypes.includes(n)) return true;
        return false;
      };

      let matches = false;

      // Card Type: Artifact / Enchantment / Creature / Planeswalker / etc.
      if (kindKey === 'card type') {
        if (hasType(val)) matches = true;
      }

      // Creature Type: Goblin, Elf, Dog, Minotaur, etc – only if it's a Creature.
      else if (kindKey === 'creature type') {
        const isCreature =
          hasType('creature') ||
          baseTypes.includes('creature');

        const subtypeMatch = hasType(val);
        if (isCreature && subtypeMatch) matches = true;
      }

      // Color Type (rough first pass, can be refined later).
      else if (kindKey === 'color type') {
        const colors = String(d.colors || d.color || '').toLowerCase();
        if (colors && colors.includes(val)) matches = true;
      }

      // We’ll leave Creature Amount / Card Amount to the amount logic below.
      if (matches) {
        count++;
      }
    }

    return count;
  }



function _compilePlayerRule(rule, snap) {
  const eventKey = snap.playerEvent;
  if (!eventKey) return () => false;

  const freq = snap.amountFreq || 'Any Time';
  const mode = snap.playerMode || 'All Players';

  return function predicate(ctx) {
    const { eventType, event, state } = ctx || {};
    const seat = event?.seat ?? state?.activeSeat ?? mySeatSafe();

    if (!_matchesSeatMode(seat, mode)) return false;

    // 1) Tallies-based stats from TurnUpkeep
    if (eventType === 'stats:update') {
      const metric = String(event?.metric || '').toLowerCase();

      // --- Special: "Discard to" → grave / exile from hand only ---
      if (eventKey === 'discardto') {
        const sub = String(snap.playerEventSub || '').toLowerCase(); // "graveyard" or "exile"

        let wantMetric = null;
        if (sub === 'graveyard') wantMetric = 'grave';
        else if (sub === 'exile') wantMetric = 'exile';

        // If a destination was chosen, require that specific metric.
        if (wantMetric && metric !== wantMetric) return false;
        // If no destination chosen, only accept grave/exile metrics at all.
        if (!wantMetric && metric !== 'grave' && metric !== 'exile') return false;

        const raw      = event.raw || {};
        const fromZone = String(raw.fromZone || raw.from || raw.origin || '').toLowerCase();
        const reason   = String(raw.reason || '').toLowerCase();
        const via      = String(raw.via || '').toLowerCase();

        const fromHand =
          raw.fromHand === true ||
          fromZone === 'hand' ||
          reason === 'discard' ||
          via === 'discard';

        if (!fromHand) return false;

        return _checkFrequencyForRule(rule.id, freq);
      }

      // --- Generic stat-backed events (life, draws, scries, surveils, etc.) ---
      const wantedMetric = PLAYER_EVENT_METRIC_MAP[eventKey];

      if (wantedMetric && metric === wantedMetric) {
        // Amount gates (Any / ≥ / ≤) can be refined later using
        // event.delta or tallies.bySeat; for now we just respect frequency.
        return _checkFrequencyForRule(rule.id, freq);
      }
      return false;
    }

    // 2) Life overlay events
    if (eventType === 'life:changed' && (eventKey === 'gainlife' || eventKey === 'loselife')) {
      const gain = Number(event?.gain || 0);
      const loss = Number(event?.loss || 0);

      if (eventKey === 'gainlife' && gain <= 0) return false;
      if (eventKey === 'loselife' && loss <= 0) return false;

      return _checkFrequencyForRule(rule.id, freq);
    }

    // 3) Spell casts
    if (eventType === 'spell:cast' && eventKey === 'cast') {
      const sub = snap.playerEventSub; // Creature / Instant / Sorcery / Artifact / Type
      if (sub && sub !== 'Type') {
        const tl = String(event?.typeLine || event?.type || '').toLowerCase();
        if (!tl.includes(String(sub).toLowerCase())) return false;
      }
      // "Type" branch would wire into a manual text field later.
      return _checkFrequencyForRule(rule.id, freq);
    }

    // 4) Creates → Tokens / Counters (best-effort)
    if (eventType === 'token:created' && eventKey === 'creates') {
      const sub = snap.playerEventSub; // "Tokens" / "Counters" / "Copies"
      if (sub && sub !== 'Tokens') return false;
      return _checkFrequencyForRule(rule.id, freq);
    }

    if (eventType === 'counter:placed' && eventKey === 'creates') {
      const sub = snap.playerEventSub;
      if (sub && sub !== 'Counters') return false;
      return _checkFrequencyForRule(rule.id, freq);
    }

        // 5) Controls: "If PLAYER controls ."
    if (
      eventKey === 'controls' &&
      (
        eventType === 'card:etb' ||
        eventType === 'card:ltb' ||
        eventType === 'card:moved' ||
        eventType === 'card:tablePresence' ||  // 👈 new: board presence ping
        eventType === 'stats:update'
      )
    ) {
      const kind  = snap.controlsKind;      // "Creature Type", "Card Type", "Color Type", "Creature Amount", "Card Amount"
      const value = snap.controlsValue;     // text for the type / color cases
      const amt   = Number(snap.controlsAmount || 0); // for the Amount cases

      if (!kind) return false;

      const kindKey = String(kind).toLowerCase();
      const count   = _countControlledBoardMatches(seat, kind, value);

      // Amount kinds require meeting the threshold; typed/color kinds just need ≥ 1.
      if (kindKey === 'creature amount' || kindKey === 'card amount') {
        if (!amt) return false;
        if (count < amt) return false;
      } else {
        if (count <= 0) return false;
      }

      return _checkFrequencyForRule(rule.id, freq);
    }


    // sacrifice / has will be wired later.
    return false;
  };
}



function _mapDuringPhaseToEvents(label) {
  switch (label) {
    case 'Beginning of Upkeep':
      return ['phase:enter:upkeep_draw'];
    case 'Main Phase':
      return ['phase:enter:main1']; // you can extend to main2 later if desired
    case 'Combat':
      return ['phase:enter:combat'];
    case 'End Step':
      return ['phase:beginningOfEndStep'];
    // "Declare Attackers / Blockers" would map to custom battle events later
    default:
      return [];
  }
}

function _compileDuringRule(rule, snap) {
  const events = _mapDuringPhaseToEvents(snap.duringPhase);
  if (!events.length) return () => false;

  const who = snap.duringWhose || 'Both';
  // For DURING rules, treat missing amountFreq as "First Time"
  const freq = snap.amountFreq || 'First Time';

  return function predicate(ctx) {
    const { eventType, state } = ctx || {};
    if (!events.includes(eventType)) return false;

    const activeSeat = state?.activeSeat ?? mySeatSafe();
    const me = mySeatSafe();

    if (who === 'You' && activeSeat !== me) return false;
    if (who === 'Opponent' && activeSeat === me) return false;
    // "Both" accepts either seat.

    return _checkFrequencyForRule(rule.id, freq);
  };
}

function _compileCardRule(/* rule, snap */) {
  // Future: handle Card path using card:etb / card:ltb / card:moved, etc.
  return () => false;
}

// Main compile entry
function _compileRule(rule) {
  const snap = rule?.snapshot || {};
  if (!snap || typeof snap !== 'object') return () => false;

  if (snap.root === 'During') {
    return _compileDuringRule(rule, snap);
  }

  if (snap.branchTop === 'Player') {
    return _compilePlayerRule(rule, snap);
  }

  if (snap.branchTop === 'Card') {
    return _compileCardRule(rule, snap);
  }

  return () => false;
}

/**
 * Re-syncs bindings from the overlay's current rules.
 * Called on init and can be called again whenever rules change.
 */
function syncFromOverlay() {
  _clearBindings();
  const rules = StatsRulesOverlay.getRules?.() || [];
  for (const rule of rules) {
    _Bindings.set(rule.id, {
      rule,
      predicate: _compileRule(rule)
    });
  }
  _log('Bindings synced from overlay rules:', rules.length);
}

// -------------------------------------------------------------
// EVALUATION
// -------------------------------------------------------------

/**
 * Builds the full context object the predicates will see.
 *
 * ctx = {
 *   eventType: string,
 *   event: detailObject,
 *   state: TurnUpkeepState,
 *   snapshot: BattlefieldSnapshot,
 *   tallies: TurnTallies,
 *   zones: ZonesState,
 * }
 */
function _buildCtx(eventType, detail) {
  return {
    eventType,
    event: detail || {},
    state: _safeState(),
    snapshot: _safeSnapshot(),
    tallies: _safeTallies(),
    zones: _safeZones()
  };
}

function _evaluateForEvent(eventType, detail) {
  if (!_Bindings.size) return;

  _ensureTurnWindow();
  const ctx = _buildCtx(eventType, detail);

  for (const [id, binding] of _Bindings.entries()) {
    const rule = binding.rule;
    const predicate = binding.predicate;

    let ok = false;
    try {
      ok = !!predicate(ctx);
    } catch (e) {
      _log('Predicate error for rule', id, e);
      ok = false;
    }

    if (!ok) continue;

    // For now, per-rule/turn frequency is handled inside predicates
    // via _checkFrequencyForRule. If it returned true, we trigger.
    triggerRule(rule, { eventType, ctx });
  }
}

// -------------------------------------------------------------
// EVENT WIRING
// -------------------------------------------------------------
function _wireEventsOnce() {
  if (_wireDone) return;
  _wireDone = true;

  const add = (type) => {
    window.addEventListener(type, (ev) => {
      try {
        _evaluateForEvent(type, ev.detail || {});
      } catch (e) {
        _log('Error evaluating rules for event', type, e);
      }
    });
  };

  // Movement / ETB / LTB events
  add('card:etb');       // detail: { cid, seat, fromZone, toZone:'table', ... }
  add('card:ltb');       // detail: { cid, seat, fromZone:'table', toZone, ... }
  add('card:moved');     // detail: { cid, seat, fromZone, toZone, cause? }
  add('card:tablePresence'); // detail: { cid, name, onTable, inCommandZone, fieldSide, ownerCurrent }

  // Casting / life / counters / tokens
  add('spell:cast');     // detail: { cid, seat, name, typeLine, mv, colors, ... }

  add('life:changed');   // detail: { seat, gain, loss, net, sourceCid?, cause? }
  add('counter:placed'); // detail: { cid, seat, kind, delta }
  add('token:created');  // detail: { seat, kind, qty, cids? }

  // Phase / turn hooks (emitted by TurnUpkeep)
  add('phase:enter:untap');
  add('phase:enter:upkeep_draw');
  add('phase:enter:main1');
  add('phase:enter:combat');
  add('phase:enter:main2_ending');
  add('phase:beginningOfEndStep');

  // Optional custom events you can emit from your turn system:
  add('turn:begin');
  add('turn:end');

  // Turn stat updates (draws, scries, surveils, tutors, etc.)
  // detail shape: { metric, seat, delta, source, raw }
  add('stats:update');

  _log('StatsWatcherActions event wiring complete');
}

// -------------------------------------------------------------
// PUBLIC TRIGGER API
// -------------------------------------------------------------

/**
 * Trigger a rule manually from anywhere:
 *
 *   StatsWatcherActions.triggerRule(3);
 *   StatsWatcherActions.triggerRule(ruleObject);
 *
 * For now this ONLY shows a Notification (no game state changes).
 */
function triggerRule(ruleOrId, meta = {}) {
  let rule = null;

  if (typeof ruleOrId === 'object' && ruleOrId !== null) {
    rule = ruleOrId;
  } else {
    const idNum = Number(ruleOrId);
    if (!Number.isNaN(idNum)) {
      const rules = StatsRulesOverlay.getRules?.() || [];
      rule = rules.find(r => r.id === idNum) || null;
    }
  }

  if (!rule) {
    _log('triggerRule: no rule found for', ruleOrId);
    return;
  }

  if (typeof StatsRulesOverlay.notifyRule === 'function') {
    StatsRulesOverlay.notifyRule(rule, meta);
  } else if (typeof StatsRulesOverlay.triggerRuleById === 'function') {
    StatsRulesOverlay.triggerRuleById(rule.id);
  } else {
    _log('Rule triggered (no overlay notify available):', rule);
  }
}

function listBoundRules() {
  return Array.from(_Bindings.values()).map(b => b.rule);
}

// -------------------------------------------------------------
// INIT
// -------------------------------------------------------------

function init() {
  _wireEventsOnce();
  syncFromOverlay();
  _ensureTurnWindow();
  _log('StatsWatcherActions initialized');
}

// -------------------------------------------------------------
// EXPORT
// -------------------------------------------------------------

export const StatsWatcherActions = {
  init,
  syncFromOverlay,
  triggerRule,
  listBoundRules
};

window.StatsWatcherActions = StatsWatcherActions;

window.__modTime?.(__MOD, 'done');
