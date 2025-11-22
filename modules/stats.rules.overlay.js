// modules/stats.rules.overlay.js
// Stats Rule Overlay + Choice Tree UI (module version)
// Usage:
//   import { StatsRulesOverlay } from './stats.rules.overlay.js';
//   StatsRulesOverlay.mount(containerElement);
//
// Later, your stats.watcher.actions.js can call:
//   StatsRulesOverlay.triggerRuleById(ruleId);
//   // or StatsRulesOverlay.notifyRule(ruleObject)
//
// This module is **UI + rule list only**. It does NOT modify game state;
// it only pops a Notification reminder when a rule "triggers".

import { Notification } from './notification.js';
import { CardOverlayUI } from './card.attributes.overlay.ui.js';

// -------------------------------------------------------------
// INTERNAL STYLE INJECTION
// -------------------------------------------------------------
const STYLE_ID = 'stats-rules-overlay-style-v2';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
:root{
  --stats-bg:#0f172a; --stats-panel:#1e253a; --stats-line:#334155;
  --stats-muted:#94a3b8; --stats-acc:#38bdf8; --stats-fg:#f8fafc;
}
.stats-rules-root{
  background:var(--stats-panel);
  border:1px solid var(--stats-line);
  border-radius:14px;
  padding:10px;
  color:var(--stats-fg);
  font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
}
.stats-rules-header{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:8px;
  margin-bottom:6px;
}
.stats-rules-title{
  font-weight:700;
  font-size:.9rem;
  letter-spacing:.08em;
  text-transform:uppercase;
  color:var(--stats-muted);
}
.stats-rules-tabs{
  display:flex;
  gap:6px;
  flex-wrap:wrap;
}
.stats-rules-tab{
  border-radius:999px;
  padding:6px 10px;
  font-size:.75rem;
  border:1px solid #475569;
  background:#0b1224;
  color:var(--stats-fg);
  cursor:pointer;
}
.stats-rules-tab.active{
  background:var(--stats-acc);
  color:#0f172a;
  border-color:var(--stats-acc);
  font-weight:700;
}
.stats-rules-body{ margin-top:4px; }
.stats-tab-panel{ display:none; }
.stats-tab-panel.active{ display:block; }

/* Core choice tree layout */
.stats-wrap{display:block}

/* footer below the tree */
.stats-footer{
  display:flex;
  flex-direction:column;
  align-items:stretch;
  gap:8px;
  border-top:1px dashed var(--stats-line);
  margin-top:10px;
  padding-top:8px;
}
.stats-footer-row{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
}
.stats-footer label{
  font-size:.8rem;
  color:var(--stats-muted);
}
.stats-footer input[type=text]{
  flex:1 1 220px;
  min-width:0;
  background:#020617;
  border-radius:6px;
  border:1px solid rgba(148,163,184,.6);
  padding:5px 8px;
  color:#e5edff;
  font-size:.85rem;
}
.stats-footer select{
  flex:1 1 220px;
  min-width:0;
  background:#020617;
  border-radius:6px;
  border:1px solid rgba(148,163,184,.6);
  padding:5px 8px;
  color:#e5edff;
  font-size:.85rem;
}
.stats-source-inline{
  display:flex;
  flex:1 1 220px;
  gap:6px;
  align-items:center;
}
.stats-source-inline select{
  flex:1 1 auto;
}
.stats-refresh-btn{
  min-width:32px;
  height:32px;
  border-radius:999px;
  border:1px solid rgba(148,163,184,.7);
  background:rgba(15,23,42,0.9);
  color:#e5edff;
  font-size:.8rem;
  cursor:pointer;
}
.stats-footer .save{
  padding:6px 10px;
  border-radius:6px;
  border:none;
  cursor:pointer;
  background:linear-gradient(135deg,#38bdf8,#4f46e5);
  color:white;
  font-weight:600;
  font-size:.8rem;
  box-shadow:0 0 0 1px rgba(59,130,246,.5),0 8px 20px rgba(15,23,42,.9);
}

.stats-footer .save:hover{
  box-shadow:0 6px 18px rgba(56,189,248,.35);
}
.stats-footer .save:active{
  transform:translateY(1px);
}

.stats-col{display:flex;flex-direction:column;gap:8px;min-width:230px;padding-right:12px;border-right:1px dashed #475569}
.stats-col:last-child{border-right:0}
.stats-col h3{margin:.25rem 0 .25rem;font-size:.75rem;text-transform:uppercase;color:var(--stats-muted);letter-spacing:.02em}

/* Let content define height; cap it so the footer stays visible */
.stats-tree{
  background:var(--stats-panel);border:1px solid var(--stats-line);border-radius:12px;
  padding:12px;overflow:auto;max-height:48vh
}
.stats-cols{display:flex;gap:12px;align-items:flex-start}

.stats-choice-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.stats-btn{
  background:#0b1224;border:1px solid #475569;color:var(--stats-fg);
  border-radius:10px;padding:8px 10px;font-size:.8rem;cursor:pointer;text-align:center
}
.stats-btn:hover{border-color:#5b6b85}
.stats-btn.active{background:var(--stats-acc);color:#0f172a;border-color:var(--stats-acc);font-weight:800}
.stats-row{display:flex;gap:8px;align-items:center}
.stats-row label{min-width:130px;font-size:.8rem;color:var(--stats-muted)}
.stats-row input[type=text], .stats-row select{
  width:100%;background:#0b1224;color:var(--stats-fg);border:1px solid #475569;border-radius:8px;padding:8px;font-size:.85rem
}
.stats-hr{height:1px;background:var(--stats-line);margin:6px 0}
.stats-preview{white-space:pre-wrap;background:#0b1224;border:1px dashed #475569;border-radius:10px;padding:10px;font-size:.85rem}
.stats-tiny{font-size:.7rem;color:#cbd5e1}

/* Loaded rules UI */
.stats-rules-list{ margin-top:6px; }

.stats-rules-empty{
  font-size:.75rem;
  color:var(--stats-muted);
  padding:4px 0;
}

.stats-rules-filterRow{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
  margin-bottom:6px;
}
.stats-rules-filterRow label{
  font-size:.8rem;
  color:var(--stats-muted);
}
.stats-rules-filterRow input{
  flex:1 1 180px;
  min-width:0;
  background:#020617;
  border-radius:6px;
  border:1px solid rgba(148,163,184,.6);
  padding:5px 8px;
  color:#e5edff;
  font-size:.8rem;
}

/* Grouped by card name */
.stats-rule-group{
  border-radius:10px;
  border:1px solid var(--stats-line);
  background:#020617;
  margin-bottom:6px;
  overflow:hidden;
}
.stats-rule-groupHeader{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  padding:6px 8px;
  cursor:pointer;
}
.stats-rule-groupTitle{
  display:flex;
  align-items:center;
  gap:6px;
  font-size:.8rem;
  font-weight:600;
}
.stats-rule-groupTog{
  font-size:.8rem;
}
.stats-rule-countBadge{
  font-size:.7rem;
  padding:2px 6px;
  border-radius:999px;
  background:rgba(148,163,184,.2);
  color:var(--stats-muted);
}
.stats-rule-groupRight{
  display:flex;
  align-items:center;
  gap:6px;
}
.stats-rule-infoBtn{
  width:20px;
  height:20px;
  border-radius:999px;
  border:1px solid rgba(148,163,184,.8);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:.7rem;
  background:#020617;
  color:var(--stats-muted);
  cursor:pointer;
}
.stats-rule-infoBtn:hover{
  border-color:var(--stats-acc);
  color:var(--stats-acc);
}
.stats-rule-groupBody{
  padding:6px 8px 8px;
  border-top:1px dashed rgba(51,65,85,.9);
}

/* Individual rule cards inside a group */
.stats-rule-card{
  background:#020617;
  border-radius:8px;
  border:1px solid rgba(51,65,85,.8);
  padding:6px 8px;
  margin-bottom:4px;
  font-size:.8rem;
}
.stats-rule-card:last-child{ margin-bottom:0; }
.stats-rule-card h4{
  margin:0 0 4px;
  font-size:.8rem;
  color:var(--stats-acc);
}
.stats-rule-meta{
  font-size:.75rem;
  color:var(--stats-muted);
  margin-bottom:3px;
  display:flex;
  flex-wrap:wrap;
  gap:4px;
  align-items:center;
}
.stats-rule-enabledBadge{
  font-size:.65rem;
  padding:2px 6px;
  border-radius:999px;
  background:rgba(34,197,94,.12);
  color:#bbf7d0;
}
.stats-rule-enabledBadge.off{
  background:rgba(148,163,184,.12);
  color:#cbd5e1;
}
.stats-rule-cond{font-size:.8rem;margin-bottom:3px}
.stats-rule-reward{font-size:.8rem;color:#e5e7eb}
.stats-rule-actions{
  margin-top:4px;
  display:flex;
  gap:6px;
  flex-wrap:wrap;
}
.stats-rule-actions button{
  font-size:.7rem;
  padding:6px 8px;
  border-radius:999px;
  border:1px solid #475569;
  background:#020617;
  color:var(--stats-fg);
  cursor:pointer;
}
.stats-rule-actions button:hover{border-color:var(--stats-acc);}

/* Card art preview bubble */
#stats-cardPreviewBubble{
  position:fixed;
  z-index:999999;
  width:170px;
  height:245px;
  border-radius:12px;
  background:#020617;
  background-size:cover;
  background-position:center;
  border:1px solid rgba(148,163,184,.8);
  box-shadow:0 18px 40px rgba(15,23,42,.9);
  pointer-events:none;
  display:none;
}

/* Rule outcome popups (bottom-right stack) */
.stats-rule-popRoot{
  position:fixed;
  right:12px;
  bottom:12px;
  display:flex;
  flex-direction:column;
  gap:8px;
  z-index:999999;
  pointer-events:none;
}

.stats-rule-popCard{
  min-width:260px;
  max-width:320px;
  background:#020617;
  border-radius:12px;
  border:1px solid #38bdf8;
  box-shadow:0 18px 40px rgba(15,23,42,.9);
  padding:10px 12px;
  pointer-events:auto;
  display:flex;
  flex-direction:column;
  gap:6px;
  font-size:.8rem;
}

.stats-rule-popTitle{
  font-weight:600;
  color:#e5e7eb;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:6px;
}

  .stats-rule-popCond{
    font-size:11px;
    color:#e5e7eb;  /* brighter so the WHEN line is readable */
    margin:0 0 4px;
  }
  .stats-rule-popBody{
    font-size:13px;
    color:#f9fafb;  /* main rules text: near-white */
    margin:0 0 8px;
  }


.stats-rule-popActions{
  display:flex;
  justify-content:flex-end;
  gap:6px;
  margin-top:4px;
}

.stats-rule-popBtn{
  border-radius:999px;
  border:1px solid #475569;
  background:#020617;
  color:#e5e7eb;
  padding:4px 10px;
  font-size:.75rem;
  cursor:pointer;
}

.stats-rule-popBtn.primary{
  background:#22c55e;
  border-color:#22c55e;
  color:#022c22;
}

.stats-rule-popBtn:hover{
  border-color:#38bdf8;
}

.stats-rule-popClose{
  border:none;
  background:transparent;
  color:#64748b;
  font-size:.75rem;
  cursor:pointer;
  padding:0 4px;
}


`;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

// -------------------------------------------------------------
// CORE CHOICE TREE DATA / STATE
// -------------------------------------------------------------
const PLAYER_TARGETS = ["You", "Opponent", "All Players"];

const CARD_TARGETS = ["Target Card", "Target Type", "Card Type"];
const CARD_TYPE_CHOICES = ["Any Card", "Creature", "Instant", "Sorcery", "Enchantment", "Commander", "Artifact"];

const CARD_ACTIONS = [
  { key: "cast",    label: "Cast" },
  { key: "etb",     label: "Enter The Battlefield", subHead: "From", subs: ["Hand", "Graveyard", "Exile", "Any"] },
  { key: "ltb",     label: "Leave The Battlefield", subHead: "To",   subs: ["Hand", "Graveyard", "Exile", "Opponent", "Any"] },
  { key: "discard", label: "Get Discarded",         subHead: "To",   subs: ["Graveyard", "Exile", "Any"] }
];

const DURING_WHOSE = ["You", "Opponent", "Both"];
const DURING_PHASE = ["Beginning of Upkeep", "Main Phase", "Combat", "Declare Attackers", "Declare Blockers", "End Step"];

const AMOUNT_GATES = [
  { key: "any", label: "Any Amount" },
  { key: "ge",  label: "Greater Than Equal" },
  { key: "le",  label: "Less Than Equal" }
];
const FREQ = ["First Time", "Any Time"];

const ZONES = ["Graveyard", "Exile", "Field", "Hand", "Deck"];

const PLAYER_EVENTS = [
  { key: "gainlife",  label: "Gain Life" },
  { key: "loselife",  label: "Lose Life" },
  { key: "discardto", label: "Discard to", branches: ["Exile", "Graveyard"] },
  { key: "sacrifice", label: "Sacrifice",  kinds: ["Creature", "Artifact", "Enchantment", "Planeswalker", "Land", "Permanent", "Type", "Token"] },
  { key: "draw",      label: "Draw" },
  { key: "scry",      label: "Scry" },
  { key: "tutor",      label: "Tutor" },
  { key: "cast",      label: "Cast",       kinds: ["Creature", "Artifact", "Instant", "Sorcery", "Type"] },
  { key: "creates",   label: "Creates",    kinds: ["Counters", "Tokens", "Copies"] },
  {
    key: "controls",
    label: "Controls",
    ctrlKinds: ["Creature Type", "Card Type", "Color Type", "Creature Amount", "Card Amount"]
  },
  { key: "has", label: "Has", cmp: ["More than", "Less Than", "Equal To"] }
];


const ABILITIES = ["flying", "first strike", "double strike", "vigilance", "lifelink", "deathtouch", "trample", "haste", "reach", "hexproof", "indestructible", "defender", "menace"];

// Internal state for the builder
const S = {
  root: "When",                 // "When" | "During"
  branchTop: null,

  // Player path
  playerMode: null,
  whichPlayer: null,
  playerEvent: null,
  playerEventSub: null,
  amountKey: null,
  amountFreq: null,

  // Controls specifics
  controlsKind: null,
  controlsValue: "",
  controlsAmount: 1,

  // Has specifics
  hasCmp: null,
  hasScope: null,
  hasMetric: null,  // "cards" | "types"
  hasZone: null,
  hasQty: 1,

  // Card path
  cardMode: null,
  cardTypeValue: "",
  cardTypeChoice: null,
  cardAction: null,
  cardActionSub: null,

  // During
  duringWhose: null,
  duringPhase: null,

  // Effect palette
  effectAction: "generate",

  // Generate
  genKindTree: null,
  genToken: { kind: "Treasure", qty: 1 },
  genCounter: { kind: "+1/+1", qty: 1 },
  // Life generation: amount + who it applies to ("You" | "Opponent" | "Both")
  genLife: { amt: 1, who: "You" },


  // Damage
  dmgKindTree: null,
  dmgCardModeTree: null,
  dmgAmount: 1,
  dmgPT: { p: 1, t: 1 },
  dmgSendToTree: "",
  dmgWho: null,            // "You" | "Opponent" for damage-to-player/hand


  // Search / Buff / Revive (stubs for now)
  searchKindTree: null,
  buffKindTree: null,
  buffPT: { p: 1, t1: 1 },
  buffAbility: "flying",
  buffType: "Artifact",
  reviveFromTree: null,
};

// -------------------------------------------------------------
// RULE STORAGE
// -------------------------------------------------------------
let RULE_ID_COUNTER = 1;
// Each rule may optionally be tied to a specific source card by name (and seat).
// { id, name, conditionText, effectText, snapshot, sourceCardName?, sourceCardSeat?, dbId?, enabled? }
const RULES = [];

// Remember the last mounted root so we can re-render after async deck loads
let LAST_ROOT = null;

// Deck roster from DeckLoading: [{ name, imageUrl, typeLine }, ...]
let CARD_ROSTER = [];
let CARD_ART_INDEX = new Map();

// Expand/collapse state per card-name group
const GROUP_OPEN_STATE = Object.create(null);

/**
 * Accepts the deck roster from DeckLoading and indexes by card name (case-insensitive).
 */
function setDeckCardRoster(roster) {
  CARD_ROSTER = Array.isArray(roster) ? roster : [];
  CARD_ART_INDEX = new Map();

  for (const entry of CARD_ROSTER) {
    if (!entry || !entry.name) continue;
    const key = String(entry.name).trim().toLowerCase();
    if (!key || CARD_ART_INDEX.has(key)) continue;
    CARD_ART_INDEX.set(key, entry);
  }
}

/**
 * Lookup art/type info by card name (case-insensitive).
 */
function getCardArtEntryByName(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  return CARD_ART_INDEX.get(key) || null;
}


// -------------------------------------------------------------
// Supabase helpers (best-effort; no hard dependency)
// -------------------------------------------------------------
function getSupabaseClient() {
  try {
    const sb =
      (window && (window.supabase || window.supabaseClient || window.__supabase)) ||
      null;
    if (!sb) {
      console.warn('[StatsRulesOverlay] Supabase client not found on window; rules will not be persisted to card_rules.');
    }
    return sb;
  } catch (e) {
    console.warn('[StatsRulesOverlay] getSupabaseClient failed', e);
    return null;
  }
}

// Try to get the current Supabase auth user id (for card_rules.user_id FK).
// Returns a string id or null if no logged-in user is available.
async function getSupabaseUserId() {
  const supabase = getSupabaseClient();
  const auth = supabase?.auth;
  if (!auth) return null;

  try {
    // Newer clients: auth.getUser()
    if (typeof auth.getUser === 'function') {
      const { data, error } = await auth.getUser();
      if (error || !data?.user) return null;
      return data.user.id || null;
    }

    // Older clients: auth.user()
    if (typeof auth.user === 'function') {
      const user = auth.user();
      return user?.id || null;
    }

    return null;
  } catch (e) {
    console.warn('[StatsRulesOverlay] getSupabaseUserId failed', e);
    return null;
  }
}



async function saveRuleToSupabase(rule) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  if (!rule.sourceCardName) {
    // Should already be prevented in UI, but guard anyway.
    console.warn('[StatsRulesOverlay] Refusing to save rule without sourceCardName.');
    return null;
  }

  try {
    const payload = {
      // 🧾 No user_id here – table must allow anonymous / null user_id.
      card_name:      rule.sourceCardName,
      rule_name:      rule.name,
      condition_text: rule.conditionText,
      effect_text:    rule.effectText,
      snapshot_json:  rule.snapshot || null,
      is_enabled:     true
    };

    const { data, error } = await supabase
      .from('card_rules')
      .insert([payload])
      .select();

    if (error) {
      console.warn('[StatsRulesOverlay] Supabase insert failed', error);
      try {
        Notification.show({
          top: 'Cloud save failed',
          bottom: error.message || 'Rule saved locally, but not in card_rules.',
          accent: '#f97316'
        });
      } catch {}
      return null;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.id) {
      rule.dbId = row.id;
    }
    return row || null;
  } catch (e) {
    console.warn('[StatsRulesOverlay] saveRuleToSupabase threw', e);
    return null;
  }
}


async function deleteRuleFromSupabase(rule) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    let query = supabase.from('card_rules').delete();

    if (rule.dbId) {
      query = query.eq('id', rule.dbId);
    } else if (rule.sourceCardName) {
      // Fallback: match on card_name + rule_name
      query = query
        .eq('card_name', rule.sourceCardName)
        .eq('rule_name', rule.name);
    } else {
      // Nothing reliable to match on, bail quietly
      console.warn('[StatsRulesOverlay] No dbId/sourceCardName on rule; skipping Supabase delete.');
      return;
    }

    const { error } = await query;
    if (error) {
      console.warn('[StatsRulesOverlay] Supabase delete failed', error);
      try {
        Notification.show({
          top: 'Cloud delete failed',
          bottom: error.message || 'Rule removed locally, but still in card_rules.',
          accent: '#f97316'
        });
      } catch {}
    }
  } catch (e) {
    console.warn('[StatsRulesOverlay] deleteRuleFromSupabase threw', e);
  }
}

// -------------------------------------------------------------
// AUTO-LOAD RULES FOR A DECK ROSTER (card_rules → local RULES)
// -------------------------------------------------------------
async function loadRulesForDeckRoster(roster) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    const names = Array.from(
      new Set(
        (roster || [])
          .map(r => (r && r.name ? String(r.name).trim() : ''))
          .filter(Boolean)
      )
    );
    if (!names.length) return;

    const { data, error } = await supabase
      .from('card_rules')
      .select('*')
      .in('card_name', names);

    if (error) {
      console.warn('[StatsRulesOverlay] loadRulesForDeckRoster Supabase select failed', error);
      return;
    }
    if (!Array.isArray(data) || !data.length) return;

    const existingKey = new Set(
      RULES.map(r => `${r.sourceCardName || ''}::${r.name || ''}`)
    );

    data.forEach(row => {
      const cardName = (row.card_name || '').trim();
      const ruleName = (row.rule_name || '').trim() || cardName || 'Rule';
      const key = `${cardName}::${ruleName}`;
      if (existingKey.has(key)) return;

      const rule = {
        id: RULE_ID_COUNTER++,
        name: ruleName,
        conditionText: row.condition_text || '(no condition text)',
        effectText: row.effect_text || '',
        snapshot: row.snapshot_json || null,
        sourceCardName: cardName || null,
        sourceCardSeat: getMySeatSafe(),
        dbId: row.id,
        // 🔕 Deck-loaded rules start disabled; user can enable per card.
        enabled: false
      };

      RULES.push(rule);
      existingKey.add(key);
    });

    if (LAST_ROOT) {
      renderRulesList(LAST_ROOT);
    }

    // Let watcher rebuild with any newly available rules (still disabled)
    try {
      window.StatsWatcherActions?.init?.();
    } catch {}
  } catch (e) {
    console.warn('[StatsRulesOverlay] loadRulesForDeckRoster threw', e);
  }
}



// -------------------------------------------------------------
// DOM HELPERS (scoped to a given root container)
// -------------------------------------------------------------
function q(root, sel) {
  return root.querySelector(sel);
}
function qAll(root, sel) {
  return Array.from(root.querySelectorAll(sel));
}

function makeBtn(label, active, onClick) {
  const b = document.createElement('button');
  b.className = 'stats-btn' + (active ? ' active' : '');
  b.textContent = label;
  b.onclick = onClick;
  return b;
}
function makeCol(title) {
  const wrap = document.createElement('div');
  wrap.className = 'stats-col';
  const h = document.createElement('h3');
  h.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'stats-choice-grid';
  wrap.append(h, grid);
  return { wrap, grid };
}

// -------------------------------------------------------------
// CARD PREVIEW BUBBLE (for "i" info button)
// -------------------------------------------------------------
function ensureCardPreviewBubble() {
  let el = document.getElementById('stats-cardPreviewBubble');
  if (!el) {
    el = document.createElement('div');
    el.id = 'stats-cardPreviewBubble';
    document.body.appendChild(el);
  }
  return el;
}

function showCardPreview(name, anchorEl) {
  const entry = getCardArtEntryByName(name);
  if (!entry || !entry.imageUrl || !anchorEl) return;

  const bubble = ensureCardPreviewBubble();
  bubble.style.backgroundImage = `url("${entry.imageUrl}")`;

  const rect = anchorEl.getBoundingClientRect();
  const w = bubble.offsetWidth || 170;
  const h = bubble.offsetHeight || 245;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = rect.right + 8;
  let top = rect.top - (h / 2 - rect.height / 2);

  if (left + w > vw - 8) left = rect.left - w - 8;
  if (left < 8) left = 8;
  if (top + h > vh - 8) top = vh - h - 8;
  if (top < 8) top = 8;

  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  bubble.style.display = 'block';
}

function hideCardPreview() {
  const bubble = document.getElementById('stats-cardPreviewBubble');
  if (bubble) bubble.style.display = 'none';
}


// -------------------------------------------------------------
// BATTLEFIELD CARD HELPERS (for rule "source card" binding)
// -------------------------------------------------------------
function getMySeatSafe() {
  try {
    if (typeof window.mySeat === 'function') {
      const s = Number(window.mySeat()) || 1;
      if (s === 1 || s === 2) return s;
    }
    if (window.__LOCAL_SEAT) {
      const s = Number(window.__LOCAL_SEAT) || 1;
      if (s === 1 || s === 2) return s;
    }
  } catch {}
  return 1;
}

// Return a deduped list of cards on *your* battlefield: [{ name, count }, ...]
function listMyBattlefieldCards() {
  const out = [];
  try {
    const mySeat = String(getMySeatSafe());
    const els = document.querySelectorAll(
      'img.table-card[data-cid], img[data-zone="table"][data-cid]'
    );
    const byName = new Map();

    els.forEach(el => {
      const d = el.dataset || {};
      const ownerRaw = d.ownerCurrent ?? d.owner ?? '';
      const owner = ownerRaw.toString().match(/\d+/)?.[0] || '1';
      if (owner !== mySeat) return;

      const name =
        (d.name ||
          el.getAttribute('data-name') ||
          el.getAttribute('alt') ||
          '').trim();
      if (!name) return;

      const key = name;
      let info = byName.get(key);
      if (!info) {
        info = { name: key, count: 0 };
        byName.set(key, info);
      }
      info.count++;
    });

    return Array.from(byName.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  } catch (e) {
    console.warn('[StatsRulesOverlay] listMyBattlefieldCards failed', e);
    return out;
  }
}

// Fill the <select> in the footer with current battlefield cards
function refreshSourceCardOptions(rootEl) {
  const select = q(rootEl, '#stats-sourceCard');
  if (!select) return;

  const prev = select.value;
  select.innerHTML = '';

  const optNone = document.createElement('option');
  optNone.value = '';
  optNone.textContent = 'No specific source (global rule)';
  select.appendChild(optNone);

  const cards = listMyBattlefieldCards();
  cards.forEach(({ name, count }) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = count > 1 ? `${name} (×${count})` : name;
    select.appendChild(opt);
  });

  if (prev) {
    const match = Array.from(select.options).find(o => o.value === prev);
    if (match) select.value = prev;
  }
}

// Try to resolve a concrete cid on the battlefield for a rule's "source card"
// so we can open the Card Attributes overlay for it.
function resolveSourceCidForRule(rule) {
  if (!rule || !rule.sourceCardName) return null;

  try {
    const wantName = String(rule.sourceCardName).trim().toLowerCase();
    if (!wantName) return null;

    // Prefer the stored sourceCardSeat if present
    const wantSeat =
      rule.sourceCardSeat === 1 || rule.sourceCardSeat === 2
        ? String(rule.sourceCardSeat)
        : null;

    const els = document.querySelectorAll(
      'img.table-card[data-cid], img[data-zone="table"][data-cid]'
    );
    const mySeat = String(getMySeatSafe());
    let foundCid = null;

    els.forEach(el => {
      const d = el.dataset || {};

      // Ignore commander-zone pseudo-table cards
      if (d.inCommandZone === 'true') return;

      const ownerRaw = d.ownerCurrent ?? d.owner ?? '';
      const owner = ownerRaw.toString().match(/\d+/)?.[0] || mySeat;
      if (wantSeat && owner !== wantSeat) return;

      const liveName =
        (d.name ||
          el.getAttribute('data-name') ||
          el.getAttribute('alt') ||
          '').trim().toLowerCase();
      if (!liveName || liveName !== wantName) return;

      const cid = d.cid || el.getAttribute('data-cid');
      if (!cid) return;

      if (!foundCid) {
        foundCid = cid;
      }
    });

    if (foundCid) {
      console.log('[StatsRulesOverlay] resolved source card for rule', {
        ruleId: rule.id,
        sourceCardName: rule.sourceCardName,
        cid: foundCid
      });
    }

    return foundCid || null;
  } catch (e) {
    console.warn('[StatsRulesOverlay] resolveSourceCidForRule failed', e, rule);
    return null;
  }
}

// If this rule's effect is a "generate" that grants counters/types/abilities,
// open the Card Attributes overlay for its source card and let it prefill.
function maybeOpenSourceAttributesOverlay(rule) {
  try {
    if (!rule || !rule.snapshot) return;

    const snap = rule.snapshot || {};
    const action = String(snap.effectAction || '').toLowerCase();
    if (action !== 'generate') return;

    const kindTree = String(snap.genKindTree || '').toLowerCase();

    // For now we care about generated counters (+1/+1 etc).
    // (Types/abilities can be wired in here later.)
    if (
      kindTree !== 'counter' &&
      kindTree !== 'counters' &&
      kindTree !== 'types' &&
      kindTree !== 'abilities'
    ) {
      return;
    }

    const cid = resolveSourceCidForRule(rule);
    if (!cid) return;

    const api = window.CardOverlayUI;
    if (!api || typeof api.openForCard !== 'function') return;

    // Pass just enough of the snapshot for CardOverlayUI to prefill.
    const fromRuleSnapshot = {
      effectAction: snap.effectAction,
      genKindTree: snap.genKindTree,
      genCounter: snap.genCounter ? { ...snap.genCounter } : undefined,
      genToken:   snap.genToken   ? { ...snap.genToken }   : undefined
    };

    api.openForCard(cid, { fromRuleSnapshot });
  } catch (e) {
    console.warn('[StatsRulesOverlay] maybeOpenSourceAttributesOverlay failed', e, rule);
  }
}




// -------------------------------------------------------------
// STATE RESET
// -------------------------------------------------------------
function resetForRoot(rootEl) {
  S.branchTop = null;
  S.playerMode = S.whichPlayer = S.playerEvent = S.playerEventSub = null;
  S.amountKey = S.amountFreq = null;

  S.controlsKind = null;
  S.controlsValue = "";
  S.controlsAmount = 1;

  S.hasCmp = null;
  S.hasScope = null;
  S.hasMetric = null;
  S.hasZone = null;
  S.hasQty = 1;

  S.cardMode = null;
  S.cardTypeValue = "";
  S.cardTypeChoice = null;
  S.cardAction = null;
  S.cardActionSub = null;

  S.duringWhose = null;
  S.duringPhase = null;

  S.genKindTree = null;
  S.dmgKindTree = null;
  S.dmgCardModeTree = null;
  S.dmgSendToTree = "";
  S.dmgWho = null;

  S.searchKindTree = null;

  S.buffKindTree = null;
  S.reviveFromTree = null;
}

function resetSubPaths() {
  S.playerMode = S.whichPlayer = S.playerEvent = S.playerEventSub = null;
  S.amountKey = S.amountFreq = null;

  S.controlsKind = null;
  S.controlsValue = "";
  S.controlsAmount = 1;

  S.hasCmp = null;
  S.hasScope = null;
  S.hasMetric = null;
  S.hasZone = null;
  S.hasQty = 1;

  S.cardMode = null;
  S.cardTypeValue = "";
  S.cardTypeChoice = null;
  S.cardAction = null;
  S.cardActionSub = null;

  S.genKindTree = null;
  S.dmgKindTree = null;
  S.dmgCardModeTree = null;
  S.dmgSendToTree = "";
  S.dmgWho = null;

  S.searchKindTree = null;

  S.buffKindTree = null;
  S.reviveFromTree = null;
}

// -------------------------------------------------------------
// RENDER: FULL TREE (UI ONLY, NO GAME STATE)
// -------------------------------------------------------------
function autoScrollTree(rootEl){
  const tree = q(rootEl, '.stats-tree');
  if (!tree) return;
  const cols = qAll(rootEl, '.stats-col');
  if (!cols.length) return;

  // Prefer last column with an active selection; else the last column.
  let target = null;
  for (let i = cols.length - 1; i >= 0; i--) {
    if (cols[i].querySelector('.stats-btn.active')) { target = cols[i]; break; }
  }
  if (!target) target = cols[cols.length - 1];

  // Horizontal ensure-visible
  const left = target.offsetLeft;
  const right = left + target.offsetWidth;
  const viewLeft = tree.scrollLeft;
  const viewRight = viewLeft + tree.clientWidth;

  if (right > viewRight - 16) {
    tree.scrollTo({ left: right - tree.clientWidth + 24, behavior: 'smooth' });
  } else if (left < viewLeft + 16) {
    tree.scrollTo({ left: Math.max(0, left - 24), behavior: 'smooth' });
  }

  // Vertical nudge if clipped
  const tRect = target.getBoundingClientRect();
  const trRect = tree.getBoundingClientRect();
  if (tRect.bottom > trRect.bottom - 10) {
    tree.scrollBy({ top: tRect.bottom - trRect.bottom + 12, behavior: 'smooth' });
  } else if (tRect.top < trRect.top + 10) {
    tree.scrollBy({ top: tRect.top - trRect.top - 12, behavior: 'smooth' });
  }
}

function renderTree(rootEl) {
  const colsHost = q(rootEl, '#stats-cols');
  if (!colsHost) return;
  colsHost.innerHTML = '';

  // Label at top (When / During)
  const rootLabel = q(rootEl, '#stats-rootLabel');
  if (rootLabel) rootLabel.textContent = S.root;

  // Initial Scope column
  const init = makeCol('Initial Scope');
  ["When", "During"].forEach(r =>
    init.grid.appendChild(
      makeBtn(r, S.root === r, () => {
        S.root = r;
        resetForRoot(rootEl);
        renderTree(rootEl);
      })
    )
  );
  colsHost.appendChild(init.wrap);

  // DURING preface
  if (S.root === 'During') {
    const cWho = makeCol('Whose Phase');
    DURING_WHOSE.forEach(w =>
      cWho.grid.appendChild(
        makeBtn(w, S.duringWhose === w, () => {
          S.duringWhose = w;
          S.duringPhase = null;
          S.branchTop = null;
          renderTree(rootEl);
        })
      )
    );
    colsHost.appendChild(cWho.wrap);

    if (S.duringWhose) {
      const cPh = makeCol('Phase');
      DURING_PHASE.forEach(p =>
        cPh.grid.appendChild(
          makeBtn(p, S.duringPhase === p, () => {
            S.duringPhase = p;
            S.branchTop = null;
            renderTree(rootEl);
          })
        )
      );
      colsHost.appendChild(cPh.wrap);
    }
  }

  // Subject column
  if (S.root !== 'During' || S.duringPhase) {
    const sub = makeCol('Subject');
    ["Player", "Card"].forEach(x =>
      sub.grid.appendChild(
        makeBtn(x, S.branchTop === x, () => {
          S.branchTop = x;
          resetSubPaths();
          renderTree(rootEl);
        })
      )
    );
    colsHost.appendChild(sub.wrap);
  }

  // PLAYER path
  if (S.branchTop === 'Player') {
    const g = makeCol('Player Group');
    PLAYER_TARGETS.forEach(pg =>
      g.grid.appendChild(
        makeBtn(pg, S.playerMode === pg, () => {
          S.playerMode = pg;
          S.playerEvent = S.playerEventSub = null;
          S.amountKey = S.amountFreq = null;

          S.controlsKind = null;
          S.controlsValue = "";
          S.controlsAmount = 1;

          S.hasCmp = null;
          S.hasScope = null;
          S.hasMetric = null;
          S.hasZone = null;
          S.hasQty = 1;

          renderTree(rootEl);
        })
      )
    );
    colsHost.appendChild(g.wrap);

    if (S.playerMode) {
      const ev = makeCol('Event');
      PLAYER_EVENTS.forEach(e =>
        ev.grid.appendChild(
          makeBtn(e.label, S.playerEvent === e.key, () => {
            S.playerEvent = e.key;
            S.playerEventSub = null;
            S.amountKey = S.amountFreq = null;

            S.controlsKind = null;
            S.controlsValue = "";
            S.controlsAmount = 1;

            S.hasCmp = null;
            S.hasScope = null;
            S.hasMetric = null;
            S.hasZone = null;
            S.hasQty = 1;

            renderTree(rootEl);
          })
        )
      );
      colsHost.appendChild(ev.wrap);
    }

    const picked = PLAYER_EVENTS.find(x => x.key === S.playerEvent);
    if (picked) {
      // branches (e.g., discard to X)
      if (picked.branches) {
        const d = makeCol('Destination');
        picked.branches.forEach(b =>
          d.grid.appendChild(
            makeBtn(b, S.playerEventSub === b, () => {
              S.playerEventSub = b;
              S.amountKey = S.amountFreq = null;
              renderTree(rootEl);
            })
          )
        );
        colsHost.appendChild(d.wrap);
      }

      // kinds (cast type, creates what, sacrifice what)
      if (picked.kinds) {
        const labelMap = { cast: 'Cast Type', creates: 'Creates Kind', sacrifice: 'Sacrifice What' };
        const k = makeCol(labelMap[picked.key] || 'Type / Kind');
        picked.kinds.forEach(x =>
          k.grid.appendChild(
            makeBtn(x, S.playerEventSub === x, () => {
              S.playerEventSub = x;
              S.amountKey = S.amountFreq = null;
              renderTree(rootEl);
            })
          )
        );
        colsHost.appendChild(k.wrap);
      }

      // controls chain
      if (picked.ctrlKinds) {
        const k = makeCol('Controls');
        picked.ctrlKinds.forEach(x =>
          k.grid.appendChild(
            makeBtn(x, S.controlsKind === x, () => {
              S.controlsKind = x;
              renderTree(rootEl);
            })
          )
        );
        colsHost.appendChild(k.wrap);

        if (S.controlsKind) {
          if (["Creature Type", "Card Type", "Color Type"].includes(S.controlsKind)) {
            const t = document.createElement('div');
            t.className = 'stats-col';
            t.innerHTML = `
              <h3>Specify ${S.controlsKind}</h3>
              <div class="stats-row" style="padding-right:12px">
                <input id="stats-controlsValue" type="text" placeholder="e.g. Zombie / Artifact / Blue" />
              </div>`;
            colsHost.appendChild(t);
            setTimeout(() => {
              const i = q(rootEl, '#stats-controlsValue');
              if (i) {
                i.value = S.controlsValue || '';
                i.oninput = e => {
                  S.controlsValue = e.target.value;
                  updatePreview(rootEl);
                };
              }
            }, 0);
          } else if (["Creature Amount", "Card Amount"].includes(S.controlsKind)) {
            const t = document.createElement('div');
            t.className = 'stats-col';
            t.innerHTML = `
              <h3>Amount</h3>
              <div class="stats-row" style="padding-right:12px">
                <input id="stats-controlsAmount" type="text" placeholder="number" />
              </div>`;
            colsHost.appendChild(t);
            setTimeout(() => {
              const i = q(rootEl, '#stats-controlsAmount');
              if (i) {
                i.value = String(S.controlsAmount || 1);
                i.oninput = e => {
                  S.controlsAmount = parseInt(e.target.value || '0', 10) || 0;
                  updatePreview(rootEl);
                };
              }
            }, 0);
          }
          appendThen(colsHost, rootEl);
        }
      }

      // Has chain
      if (picked.cmp) {
        const cmpCol = makeCol('Has');
        picked.cmp.forEach(c =>
          cmpCol.grid.appendChild(
            makeBtn(c, S.hasCmp === c, () => {
              S.hasCmp = c;
              S.hasMetric = null;
              S.hasScope = null;
              S.hasZone = null;
              renderTree(rootEl);
            })
          )
        );
        colsHost.appendChild(cmpCol.wrap);

        if (S.hasCmp) {
          // quantity
          const qty = document.createElement('div');
          qty.className = 'stats-col';
          qty.innerHTML = `
            <h3>Quantity</h3>
            <div class="stats-row" style="padding-right:12px">
              <input id="stats-hasQty" type="text" placeholder="number" />
            </div>`;
          colsHost.appendChild(qty);
          setTimeout(() => {
            const i = q(rootEl, '#stats-hasQty');
            if (i) {
              i.value = String(S.hasQty || 1);
              i.oninput = e => {
                S.hasQty = parseInt(e.target.value || '0', 10) || 0;
                updatePreview(rootEl);
              };
            }
          }, 0);

          // METRIC
          const metric = makeCol('Metric');
          [
            ["Cards in …", "cards"],
            ["Types in …", "types"]
          ].forEach(([label, key]) =>
            metric.grid.appendChild(
              makeBtn(label, S.hasMetric === key, () => {
                S.hasMetric = key;
                renderTree(rootEl);
              })
            )
          );
          colsHost.appendChild(metric.wrap);

          // SCOPE
          if (S.hasMetric) {
            const scope = makeCol('Scope');
            ["Your", "Overall"].forEach(s =>
              scope.grid.appendChild(
                makeBtn(s, S.hasScope === s, () => {
                  S.hasScope = s;
                  S.hasZone = null;
                  renderTree(rootEl);
                })
              )
            );
            colsHost.appendChild(scope.wrap);
          }

          // ZONE
          if (S.hasScope) {
            const zone = makeCol('Zone');
            ZONES.forEach(z =>
              zone.grid.appendChild(
                makeBtn(z, S.hasZone === z, () => {
                  S.hasZone = z;
                  renderTree(rootEl);
                })
              )
            );
            colsHost.appendChild(zone.wrap);
          }

          if (S.hasCmp && S.hasMetric && S.hasScope && S.hasZone) {
            appendThen(colsHost, rootEl);
          }
        }
      }

      // Simple amount/frequency if not controls/has
      if (!picked.ctrlKinds && !picked.cmp) {
        const a = makeCol('Amount Gate');
        AMOUNT_GATES.forEach(gate =>
          a.grid.appendChild(
            makeBtn(gate.label, S.amountKey === gate.key, () => {
              S.amountKey = gate.key;
              S.amountFreq = null;
              renderTree(rootEl);
            })
          )
        );
        colsHost.appendChild(a.wrap);

        if (S.amountKey) {
          const f = makeCol('Frequency');
          FREQ.forEach(fr =>
            f.grid.appendChild(
              makeBtn(fr, S.amountFreq === fr, () => {
                S.amountFreq = fr;
                renderTree(rootEl);
              })
            )
          );
          colsHost.appendChild(f.wrap);
        }
        if (S.amountKey && S.amountFreq) {
          appendThen(colsHost, rootEl);
        }
      }
    }
  }

  // CARD path
  if (S.branchTop === 'Card') {
    const t0 = makeCol('Card Target');
    CARD_TARGETS.forEach(c =>
      t0.grid.appendChild(
        makeBtn(c, S.cardMode === c, () => {
          S.cardMode = c;
          S.cardTypeValue = "";
          S.cardTypeChoice = null;
          S.cardAction = null;
          S.cardActionSub = null;
          renderTree(rootEl);
        })
      )
    );
    colsHost.appendChild(t0.wrap);

    if (S.cardMode === 'Target Type') {
      const t = document.createElement('div');
      t.className = 'stats-col';
      t.innerHTML = `
        <h3>Pick Type (free)</h3>
        <div class="stats-row" style="padding-right:12px">
          <input id="stats-cardTypeValue" type="text" placeholder="e.g. Zombie, Aura…" />
        </div>`;
      colsHost.appendChild(t);
      setTimeout(() => {
        const i = q(rootEl, '#stats-cardTypeValue');
        if (i) {
          i.value = S.cardTypeValue || '';
          i.oninput = e => {
            S.cardTypeValue = e.target.value;
            updatePreview(rootEl);
          };
        }
      }, 0);
    }

    if (S.cardMode === 'Card Type') {
      const c = makeCol('Card Type');
      CARD_TYPE_CHOICES.forEach(ct =>
        c.grid.appendChild(
          makeBtn(ct, S.cardTypeChoice === ct, () => {
            S.cardTypeChoice = ct;
            S.cardAction = null;
            S.cardActionSub = null;
            renderTree(rootEl);
          })
        )
      );
      colsHost.appendChild(c.wrap);
    }

    if (S.cardMode && (S.cardMode !== 'Card Type' || S.cardTypeChoice)) {
      const act = makeCol('Action');
      CARD_ACTIONS.forEach(a =>
        act.grid.appendChild(
          makeBtn(a.label, S.cardAction === a.key, () => {
            S.cardAction = a.key;
            S.cardActionSub = null;
            renderTree(rootEl);
          })
        )
      );
      colsHost.appendChild(act.wrap);
    }

    const actionMeta = CARD_ACTIONS.find(a => a.key === S.cardAction);
    if (actionMeta && actionMeta.subs) {
      const sub = makeCol(actionMeta.subHead);
      actionMeta.subs.forEach(sv =>
        sub.grid.appendChild(
          makeBtn(sv, S.cardActionSub === sv, () => {
            S.cardActionSub = sv;
            renderTree(rootEl);
          })
        )
      );
      colsHost.appendChild(sub.wrap);
    }

    if (S.cardMode && S.cardAction && (!actionMeta || !actionMeta.subs || S.cardActionSub)) {
      appendThen(colsHost, rootEl);
    }
  }

  updatePreview(rootEl);
  autoScrollTree(rootEl);
}

// -------------------------------------------------------------
// THEN palette + effect details (simplified)
// -------------------------------------------------------------
function appendThen(colsHost, rootEl) {
  const cThen = makeCol('THEN');
  [
    ["Generate", "generate"],
    ["Damage", "damage"],
    ["Search", "search"],
    ["Buff", "buff"],
    ["Revive", "revive"]
  ].forEach(([label, val]) => {
    cThen.grid.appendChild(
      makeBtn(label, S.effectAction === val, () => {
        S.effectAction = val;
        if (val !== 'generate') S.genKindTree = null;
        if (val !== 'damage') {
          S.dmgKindTree = null;
          S.dmgCardModeTree = null;
          S.dmgSendToTree = "";
        }
        if (val !== 'search') S.searchKindTree = null;
        if (val !== 'buff') S.buffKindTree = null;
        if (val !== 'revive') S.reviveFromTree = null;

        const sel = q(rootEl, '#stats-effectAction');
        if (sel) sel.value = val;

        renderTree(rootEl);
      })
    );
  });
  colsHost.appendChild(cThen.wrap);

  // Basic damage / generate inline details for the tree (UI hints only).
  if (S.effectAction === 'generate') {
    const cGen = makeCol('Generate → Kind');
    [["Life", "life"], ["Token", "token"], ["Counters", "counter"]].forEach(([label, key]) =>
      cGen.grid.appendChild(
        makeBtn(label, S.genKindTree === key, () => {
          S.genKindTree = key;
          renderTree(rootEl);
        })
      )
    );
    colsHost.appendChild(cGen.wrap);

    if (S.genKindTree) {
      // 👇 New branch: life gets its own "Who" + "Amount" columns
      if (S.genKindTree === 'life') {
        const cWho = makeCol('Who');
        ["You", "Opponent", "Both"].forEach(who =>
          cWho.grid.appendChild(
            makeBtn(who, S.genLife.who === who, () => {
              S.genLife.who = who;
              updatePreview(rootEl);
              renderTree(rootEl);
            })
          )
        );
        colsHost.appendChild(cWho.wrap);

        const cAmt = makeCol('Amount');
        cAmt.wrap.insertAdjacentHTML(
          'beforeend',
          `<div class="stats-row" style="padding-right:12px">
             <input id="stats-genLifeAmtTree" type="text" placeholder="life amount" />
           </div>`
        );
        colsHost.appendChild(cAmt.wrap);
        setTimeout(() => {
          const i = q(rootEl, '#stats-genLifeAmtTree');
          if (i) {
            i.value = String(S.genLife.amt || 1);
            i.oninput = e => {
              S.genLife.amt = parseInt(e.target.value || '0', 10) || 0;
              updatePreview(rootEl);
            };
          }
        }, 0);
      } else {
        const cDet = makeCol('Details');

        if (S.genKindTree === 'token') {
          cDet.wrap.insertAdjacentHTML(
            'beforeend',
            `
            <div class="stats-row" style="padding-right:12px">
              <input id="stats-genTokenKindTree" type="text" placeholder="token name (e.g. Treasure)" />
            </div>
            <div class="stats-row" style="padding-right:12px">
              <input id="stats-genTokenQtyTree" type="text" placeholder="qty" />
            </div>`
          );
          colsHost.appendChild(cDet.wrap);
          setTimeout(() => {
            const k = q(rootEl, '#stats-genTokenKindTree');
            const qn = q(rootEl, '#stats-genTokenQtyTree');
            if (k) {
              k.value = S.genToken.kind;
              k.oninput = e => {
                S.genToken.kind = e.target.value;
                updatePreview(rootEl);
              };
            }
            if (qn) {
              qn.value = String(S.genToken.qty || 1);
              qn.oninput = e => {
                S.genToken.qty = parseInt(e.target.value || '0', 10) || 0;
                updatePreview(rootEl);
              };
            }
          }, 0);
        }

        if (S.genKindTree === 'counter') {
          cDet.wrap.insertAdjacentHTML(
            'beforeend',
            `
            <div class="stats-row" style="padding-right:12px">
              <input id="stats-genCounterKindTree" type="text" placeholder="counter kind (e.g. +1/+1)" />
            </div>
            <div class="stats-row" style="padding-right:12px">
              <input id="stats-genCounterQtyTree" type="text" placeholder="qty" />
            </div>`
          );
          colsHost.appendChild(cDet.wrap);
          setTimeout(() => {
            const k = q(rootEl, '#stats-genCounterKindTree');
            const qn = q(rootEl, '#stats-genCounterQtyTree');
            if (k) {
              k.value = S.genCounter.kind;
              k.oninput = e => {
                S.genCounter.kind = e.target.value;
                updatePreview(rootEl);
              };
            }
            if (qn) {
              qn.value = String(S.genCounter.qty || 1);
              qn.oninput = e => {
                S.genCounter.qty = parseInt(e.target.value || '0', 10) || 0;
                updatePreview(rootEl);
              };
            }
          }, 0);
        }
      }
    }
  }


  if (S.effectAction === 'damage') {
    const cKind = makeCol('Damage → Target');
    [["Target Player", "player"], ["Target Hand", "hand"], ["Target Card", "card"]].forEach(([label, key]) =>
      cKind.grid.appendChild(
        makeBtn(label, S.dmgKindTree === key, () => {
          S.dmgKindTree = key;
          S.dmgCardModeTree = null;
          S.dmgWho = null;          // reset who when switching target kind
          renderTree(rootEl);
        })
      )
    );

    colsHost.appendChild(cKind.wrap);

    if (S.dmgKindTree) {
      if (S.dmgKindTree === 'player' || S.dmgKindTree === 'hand') {
        // Step 1: pick which side
        const cWho = makeCol('Who');
        ["You", "Opponent"].forEach(who =>
          cWho.grid.appendChild(
            makeBtn(who, S.dmgWho === who, () => {
              S.dmgWho = who;
              renderTree(rootEl);
            })
          )
        );
        colsHost.appendChild(cWho.wrap);

        // Step 2: once chosen, pick amount
        if (S.dmgWho) {
          const cDet = makeCol('Amount');
          cDet.wrap.insertAdjacentHTML(
            'beforeend',
            `<div class="stats-row" style="padding-right:12px">
               <input id="stats-dmgAmtTree" type="text" placeholder="amount" />
             </div>`
          );
          colsHost.appendChild(cDet.wrap);
          setTimeout(() => {
            const i = q(rootEl, '#stats-dmgAmtTree');
            if (i) {
              i.value = String(S.dmgAmount || 1);
              i.oninput = e => {
                S.dmgAmount = parseInt(e.target.value || '0', 10) || 0;
                updatePreview(rootEl);
              };
            }
          }, 0);
        }
      }
      if (S.dmgKindTree === 'card') {


        const cMode = makeCol('Card Effect');
        [["Debuff -P/-T", "debuff"], ["Use -X/-X counters", "counters"], ["Send to →", "send"]].forEach(
          ([label, key]) =>
            cMode.grid.appendChild(
              makeBtn(label, S.dmgCardModeTree === key, () => {
                S.dmgCardModeTree = key;
                renderTree(rootEl);
              })
            )
        );
        colsHost.appendChild(cMode.wrap);

        if (S.dmgCardModeTree === 'debuff' || S.dmgCardModeTree === 'counters') {
          const cPT = makeCol('P/T Values');
          cPT.wrap.insertAdjacentHTML(
            'beforeend',
            `
            <div class="stats-row" style="padding-right:12px">
              <input id="stats-dmgPtree" type="text" placeholder="P" />
            </div>
            <div class="stats-row" style="padding-right:12px">
              <input id="stats-dmgTtree" type="text" placeholder="T" />
            </div>`
          );
          colsHost.appendChild(cPT.wrap);
          setTimeout(() => {
            const p = q(rootEl, '#stats-dmgPtree');
            const t = q(rootEl, '#stats-dmgTtree');
            if (p) {
              p.value = String(S.dmgPT.p || 1);
              p.oninput = e => {
                S.dmgPT.p = parseInt(e.target.value || '0', 10) || 0;
                updatePreview(rootEl);
              };
            }
            if (t) {
              t.value = String(S.dmgPT.t || 1);
              t.oninput = e => {
                S.dmgPT.t = parseInt(e.target.value || '0', 10) || 0;
                updatePreview(rootEl);
              };
            }
          }, 0);
        }
        if (S.dmgCardModeTree === 'send') {
          const cSend = makeCol('Send To');
          ["Graveyard", "Exile", "Phase"].forEach(dest =>
            cSend.grid.appendChild(
              makeBtn(dest, S.dmgSendToTree === dest, () => {
                S.dmgSendToTree = dest;
                updatePreview(rootEl);
              })
            )
          );
          colsHost.appendChild(cSend.wrap);
        }
      }
    }
  }

  // other effect types (search / buff / revive) can be fleshed out later
  renderActionDetails(rootEl);
}

// Side panel effect details (right-hand column)
function renderActionDetails(rootEl) {
  const host = q(rootEl, '#stats-actionDetails');
  if (!host) return;
  host.innerHTML = '';

  const actSelect = q(rootEl, '#stats-effectAction');
  if (actSelect) actSelect.value = S.effectAction;

  const wrap = document.createElement('div');
  wrap.className = 'stats-preview stats-tiny';
  wrap.textContent = `Effect: ${S.effectAction.toUpperCase()} (detailed effect editing can be added later.)`;
  host.appendChild(wrap);
}

// -------------------------------------------------------------
// PREVIEW STRING BUILDING
// -------------------------------------------------------------
function buildConditionText() {
  const parts = [];

  if (S.root === 'During') {
    if (S.duringWhose && S.duringPhase) {
      parts.push(`During ${S.duringWhose.toLowerCase()} ${S.duringPhase}`);
    } else {
      parts.push('During a phase (incomplete)');
    }
  } else {
    parts.push('When');
  }

  if (S.branchTop === 'Player') {
    const who = S.playerMode || 'a player';
    const ev = PLAYER_EVENTS.find(e => e.key === S.playerEvent);
    if (ev) {
      let label = ev.label.toLowerCase();
      let extra = '';

      if (ev.branches && S.playerEventSub) {
        extra = ` to ${S.playerEventSub}`;
      } else if (ev.kinds && S.playerEventSub) {
        extra = ` (${S.playerEventSub})`;
      }

      if (ev.key === 'controls' && S.controlsKind) {
        if (["Creature Type", "Card Type", "Color Type"].includes(S.controlsKind) && S.controlsValue) {
          extra = ` and controls ${S.controlsValue} as a ${S.controlsKind.toLowerCase()}`;
        } else if (["Creature Amount", "Card Amount"].includes(S.controlsKind)) {
          extra = ` and controls ${S.controlsAmount} ${S.controlsKind.toLowerCase()}`;
        }
      }

      if (ev.key === 'has' && S.hasCmp && S.hasMetric && S.hasScope && S.hasZone) {
        extra = ` and ${S.hasCmp.toLowerCase()} ${S.hasQty} ${S.hasMetric} in ${S.hasScope.toLowerCase()} ${S.hasZone}`;
      }

      if (S.amountKey && S.amountFreq) {
        extra += ` (${S.amountFreq.toLowerCase()} with ${S.amountKey} condition)`;
      }

      parts.push(`${who} ${label}${extra}`);
    } else {
      parts.push(`${who} does something (incomplete)`);
    }
  }

  if (S.branchTop === 'Card') {
    let subj = 'a card';
    if (S.cardMode === 'Target Type' && S.cardTypeValue) {
      subj = `a ${S.cardTypeValue}`;
    } else if (S.cardMode === 'Card Type' && S.cardTypeChoice) {
      subj = `a ${S.cardTypeChoice}`;
    }

    const act = CARD_ACTIONS.find(a => a.key === S.cardAction);
    if (act) {
      let extra = '';
      if (act.subs && S.cardActionSub) {
        extra = ` (${act.subHead.toLowerCase()} ${S.cardActionSub})`;
      }
      parts.push(`${subj} ${act.label.toLowerCase()}${extra}`);
    } else {
      parts.push(`${subj} does something (incomplete)`);
    }
  }

  return parts.join(', ');
}

function buildEffectText() {
  switch (S.effectAction) {
        case 'generate': {
      if (S.genKindTree === 'life') {
        const amt = S.genLife.amt || 1;
        const who = S.genLife.who || 'You';
        if (who === 'Opponent') {
          return `Opponent gains ${amt} life.`;
        }
        if (who === 'Both') {
          return `Each player gains ${amt} life.`;
        }
        return `You gain ${amt} life.`;
      }
      if (S.genKindTree === 'token') {
        const qty = S.genToken.qty || 1;
        const kind = S.genToken.kind || 'Treasure';
        return `Create ${qty} ${kind} token${qty === 1 ? '' : 's'}.`;
      }
      if (S.genKindTree === 'counter') {
        const qty = S.genCounter.qty || 1;
        const kind = S.genCounter.kind || 'counter';
        return `Put ${qty} ${kind} counter${qty === 1 ? '' : 's'} on target.`;
      }
      return 'Generate some value.';
    }

    case 'damage': {
      const amt = S.dmgAmount || 1;
      if (S.dmgKindTree === 'player') {
        const who = S.dmgWho === 'Opponent' ? 'opponent' : 'you';
        return `Deal ${amt} damage to ${who}.`;
      }
      if (S.dmgKindTree === 'hand') {
        const whoHand = S.dmgWho === 'Opponent' ? "opponent's hand" : 'your hand';
        return `Deal ${amt} damage to ${whoHand}.`;
      }
      if (S.dmgKindTree === 'card') {
        if (S.dmgCardModeTree === 'debuff' || S.dmgCardModeTree === 'counters') {
          return `Target creature gets -${S.dmgPT.p || 1}/-${S.dmgPT.t || 1} ${S.dmgCardModeTree === 'counters' ? 'counters' : ''}.`;
        }
        if (S.dmgCardModeTree === 'send' && S.dmgSendToTree) {
          return `Send that card to ${S.dmgSendToTree}.`;
        }
      }
      return 'Deal some kind of damage.';
    }

    case 'search':
      return 'Search a zone (details later).';
    case 'buff':
      return 'Apply a buff (details later).';
    case 'revive':
      return 'Return a card from a zone (details later).';
    default:
      return 'Do something.';
  }
}

// Shorter summaries for auto-generated names / notifications
function summarizeConditionForName() {
  const parts = [];

  if (S.root === 'During' && S.duringWhose && S.duringPhase) {
    parts.push(`During ${S.duringWhose} ${S.duringPhase}`);
  }

  if (S.branchTop === 'Player') {
    const who = S.playerMode || 'Player';
    const ev = PLAYER_EVENTS.find(e => e.key === S.playerEvent);
    if (ev) {
      let tail = '';
      if (ev.branches && S.playerEventSub) tail = ` → ${S.playerEventSub}`;
      if (ev.kinds && S.playerEventSub) tail = ` (${S.playerEventSub})`;
      if (ev.key === 'controls' && S.controlsKind) {
        if (["Creature Type","Card Type","Color Type"].includes(S.controlsKind) && S.controlsValue) {
          tail = ` ${S.controlsKind}: ${S.controlsValue}`;
        } else if (["Creature Amount","Card Amount"].includes(S.controlsKind)) {
          tail = ` ${S.controlsKind}: ${S.controlsAmount}`;
        }
      }
      if (ev.key === 'has' && S.hasCmp && S.hasMetric && S.hasScope && S.hasZone) {
        tail = ` ${S.hasCmp} ${S.hasQty} ${S.hasMetric} in ${S.hasScope} ${S.hasZone}`;
      }
      parts.push(`${who} ${ev.label}${tail}`);
    }
  } else if (S.branchTop === 'Card') {
    let subj = 'Card';
    if (S.cardMode === 'Target Type' && S.cardTypeValue) subj = S.cardTypeValue;
    else if (S.cardMode === 'Card Type' && S.cardTypeChoice) subj = S.cardTypeChoice;

    const act = CARD_ACTIONS.find(a => a.key === S.cardAction);
    if (act) {
      let tail = '';
      if (act.subs && S.cardActionSub) tail = ` (${act.subHead} ${S.cardActionSub})`;
      parts.push(`${subj} ${act.label}${tail}`);
    }
  }

  return parts.join(' — ') || 'Rule';
}

function summarizeEffectForName() {
  switch (S.effectAction) {
    case 'generate': {
      if (S.genKindTree === 'life') {
        const amt = S.genLife.amt || 1;
        const who = S.genLife.who || 'You';
        if (who === 'Opponent') {
          return `Opponent gains ${amt} Life`;
        }
        if (who === 'Both') {
          return `Each player gains ${amt} Life`;
        }
        return `Gain ${amt} Life`;
      }
      if (S.genKindTree === 'token') {
        const qty = S.genToken.qty || 1;
        const kind = S.genToken.kind || 'Treasure';
        return `Create ${qty} ${kind} token${qty === 1 ? '' : 's'}.`;
      }
      if (S.genKindTree === 'counter') {
        const qty = S.genCounter.qty || 1;
        const kind = S.genCounter.kind || 'counter';
        return `Put ${qty} ${kind} counter${qty === 1 ? '' : 's'}.`;
      }
      return 'Generate some value.';
    }

    case 'damage': {
      const amt = S.dmgAmount || 1;
      if (S.dmgKindTree === 'player') {
        const who = S.dmgWho || 'Player';
        return `Deal ${amt} to ${who}`;
      }
      if (S.dmgKindTree === 'hand') {
        const whoHand = S.dmgWho === 'Opponent'
          ? "Opponent's Hand"
          : (S.dmgWho === 'You' ? 'Your Hand' : 'Hand');
        return `Deal ${amt} to ${whoHand}`;
      }
      if (S.dmgKindTree === 'card') {
        if (S.dmgCardModeTree === 'debuff' || S.dmgCardModeTree === 'counters')
          return `Give -${S.dmgPT.p || 1}/-${S.dmgPT.t || 1}`;
        if (S.dmgCardModeTree === 'send' && S.dmgSendToTree) return `Send to ${S.dmgSendToTree}`;
      }
      return 'Damage';
    }

    case 'search': return 'Search';
    case 'buff':   return 'Buff';
    case 'revive': return 'Revive';
    default:       return 'Effect';
  }
}

function autoNameFromState() {
  // Compose "Condition → Effect" style name
  const cond = summarizeConditionForName();
  const eff = summarizeEffectForName();
  if (cond && eff) return `${cond} → ${eff}`;
  return cond || eff || 'Rule';
}

function updatePreview(rootEl) {
  const cond = buildConditionText();
  const eff = buildEffectText();
  const dur = S.duration || 'End of Turn';

  const previewEl = q(rootEl, '#stats-preview');
  if (!previewEl) return;
  const lines = [];
  lines.push(cond ? cond + ',' : '(condition incomplete),');
  lines.push(`THEN ${eff}`);
  lines.push(`Duration: ${dur}`);
  if (S.activationCost) lines.push(`Activation cost: ${S.activationCost}`);
  previewEl.textContent = lines.join('\n');
}

// -------------------------------------------------------------
// RULE CREATION / LIST RENDER
// -------------------------------------------------------------
function captureCurrentRule(rootEl) {
  const nameInput = q(rootEl, '#stats-ruleName');
  const cond = buildConditionText();
  const eff = buildEffectText();

  const typedName = (nameInput?.value || '').trim();
  const name = typedName || autoNameFromState();

  // Optional: bind this rule to a specific source card name on your battlefield
  const srcSelect = q(rootEl, '#stats-sourceCard');
  const rawSource = (srcSelect?.value || '').trim();
  const sourceCardName = rawSource || null;

  let sourceCardSeat = null;
  if (sourceCardName) {
    try {
      sourceCardSeat = getMySeatSafe();
    } catch {
      sourceCardSeat = 1;
    }
  }

  return {
    id: RULE_ID_COUNTER++,
    name,
    conditionText: cond || '(incomplete condition)',
    effectText: eff,
    snapshot: JSON.parse(JSON.stringify(S)),
    sourceCardName,
    sourceCardSeat,
    enabled: true  // UI-created rules start enabled
  };
}


// -------------------------------------------------------------
// PER-CARD RULE BINDINGS (cid ↔ rule.id)
// -------------------------------------------------------------
// rule.id -> Set<cid>
const RULE_BINDINGS = new Map();
// cid -> Set<rule.id>
const CID_BINDINGS  = new Map();

/**
 * Bind a rule to a specific card instance (by cid).
 * - Keeps both ruleId→cid and cid→ruleId maps in sync.
 * - For card-linked rules (sourceCardName), we treat "has any bindings"
 *   as "enabled = true" so the watcher starts listening.
 */
function bindRuleToCid(rule, cid) {
  if (!rule || !rule.id || !cid) return;
  const ruleId = rule.id;
  const cidStr = String(cid);

  let byRule = RULE_BINDINGS.get(ruleId);
  if (!byRule) {
    byRule = new Set();
    RULE_BINDINGS.set(ruleId, byRule);
  }
  byRule.add(cidStr);

  let byCid = CID_BINDINGS.get(cidStr);
  if (!byCid) {
    byCid = new Set();
    CID_BINDINGS.set(cidStr, byCid);
  }
  byCid.add(ruleId);

  // For card-linked rules, treat "any bound copies" as enabled.
  if (rule.sourceCardName && rule.enabled === false) {
    rule.enabled = true;
  }
}

/**
 * Remove all bindings for a given cid.
 * Returns an array of ruleIds whose enabled state was auto-toggled off
 * because there are no remaining bound copies.
 */
function unbindAllRulesForCid(cid) {
  const cidStr = cid ? String(cid) : null;
  if (!cidStr) return [];

  const byCid = CID_BINDINGS.get(cidStr);
  if (!byCid || !byCid.size) {
    CID_BINDINGS.delete(cidStr);
    return [];
  }

  CID_BINDINGS.delete(cidStr);
  const changedRuleIds = [];

  byCid.forEach(ruleId => {
    const byRule = RULE_BINDINGS.get(ruleId);
    if (!byRule) return;

    byRule.delete(cidStr);
    if (!byRule.size) {
      RULE_BINDINGS.delete(ruleId);
      const rule = RULES.find(r => r.id === ruleId);
      if (rule && rule.sourceCardName) {
        // Only auto-disable card-linked rules; global rules stay as-is.
        rule.enabled = false;
        changedRuleIds.push(ruleId);
      }
    }
  });

  return changedRuleIds;
}

/**
 * Convenience: list all rule objects bound to a given cid.
 */
function getRuleBindingsForCid(cid) {
  const cidStr = cid ? String(cid) : null;
  if (!cidStr) return [];
  const ids = CID_BINDINGS.get(cidStr);
  if (!ids) return [];
  return Array.from(ids)
    .map(id => RULES.find(r => r.id === id))
    .filter(Boolean);
}


function renderRulesList(rootEl) {
  const host = q(rootEl, '#stats-rulesList');
  if (!host) return;
  host.innerHTML = '';

  LAST_ROOT = rootEl;

  // Current text filter by card name
  const filterInput = q(rootEl, '#stats-rulesFilter');
  const filter = (filterInput?.value || '').trim().toLowerCase();

  // Group rules by sourceCardName (or "Global Rules")
  const groups = new Map();
  RULES.forEach(rule => {
    const groupName = rule.sourceCardName || 'Global Rules';
    if (filter && !groupName.toLowerCase().includes(filter)) return;
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(rule);
  });

  if (!groups.size) {
    const empty = document.createElement('div');
    empty.className = 'stats-rules-empty';
    empty.textContent = 'No loaded rules yet. Use Add Rule above or load a deck.';
    host.appendChild(empty);
    return;
  }

  groups.forEach((rules, groupName) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'stats-rule-group';

    const header = document.createElement('div');
    header.className = 'stats-rule-groupHeader';

    const left = document.createElement('div');
    left.className = 'stats-rule-groupTitle';

    const arrow = document.createElement('span');
    arrow.className = 'stats-rule-groupTog';

    const isOpen = GROUP_OPEN_STATE[groupName] !== false;
    arrow.textContent = isOpen ? '▾' : '▸';

    const title = document.createElement('span');
    title.textContent = groupName;

    const count = document.createElement('span');
    count.className = 'stats-rule-countBadge';
    count.textContent = `${rules.length} rule${rules.length === 1 ? '' : 's'}`;

    left.appendChild(arrow);
    left.appendChild(title);
    left.appendChild(count);

    const right = document.createElement('div');
    right.className = 'stats-rule-groupRight';

    // Info button only if we have art for this card name
    const artEntry = getCardArtEntryByName(groupName);
    if (artEntry && artEntry.imageUrl) {
      const infoBtn = document.createElement('button');
      infoBtn.type = 'button';
      infoBtn.className = 'stats-rule-infoBtn';
      infoBtn.textContent = 'i';
      infoBtn.title = 'Hold to preview card art';

      infoBtn.onmousedown = e => {
        e.stopPropagation();
        showCardPreview(groupName, infoBtn);
      };
      infoBtn.onmouseup = e => {
        e.stopPropagation();
        hideCardPreview();
      };
      infoBtn.onmouseleave = hideCardPreview;

      right.appendChild(infoBtn);
    }

    header.appendChild(left);
    header.appendChild(right);

    header.onclick = () => {
      GROUP_OPEN_STATE[groupName] = !(GROUP_OPEN_STATE[groupName] !== false);
      renderRulesList(rootEl);
    };

    const body = document.createElement('div');
    body.className = 'stats-rule-groupBody';
    body.style.display = isOpen ? 'block' : 'none';

    rules.forEach(rule => {
      const card = document.createElement('div');
      card.className = 'stats-rule-card';

      const h = document.createElement('h4');
      h.textContent = rule.name;
      card.appendChild(h);

      const meta = document.createElement('div');
      meta.className = 'stats-rule-meta';
      const metaBits = [`Rule #${rule.id}`];
      if (rule.sourceCardName) {
        metaBits.push(`Source: ${rule.sourceCardName}`);
      }
      meta.textContent = metaBits.join(' • ');

      const status = document.createElement('span');
      status.className = 'stats-rule-enabledBadge' + (rule.enabled === false ? ' off' : '');
      status.textContent = rule.enabled === false ? 'Disabled' : 'Enabled';
      meta.appendChild(status);

      card.appendChild(meta);

      const cond = document.createElement('div');
      cond.className = 'stats-rule-cond';
      cond.textContent = rule.conditionText;
      card.appendChild(cond);

      const eff = document.createElement('div');
      eff.className = 'stats-rule-reward';
      eff.textContent = rule.effectText;
      card.appendChild(eff);

      const actions = document.createElement('div');
      actions.className = 'stats-rule-actions';

      // Enable / Disable toggle
      const toggleBtn = document.createElement('button');
      toggleBtn.textContent = rule.enabled === false ? 'Enable' : 'Disable';
      toggleBtn.onclick = () => {
        rule.enabled = rule.enabled === false ? true : false;
        renderRulesList(rootEl);
        try {
          window.StatsWatcherActions?.init?.();
        } catch {}
      };
      actions.appendChild(toggleBtn);

      const testBtn = document.createElement('button');
      testBtn.textContent = 'Test Notify';
      testBtn.onclick = () => notifyRule(rule);
      actions.appendChild(testBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.onclick = async () => {
        await deleteRuleFromSupabase(rule);
        const idx = RULES.findIndex(r => r.id === rule.id);
        if (idx >= 0) RULES.splice(idx, 1);
        renderRulesList(rootEl);
        try {
          window.StatsWatcherActions?.init?.();
        } catch {}
      };
      actions.appendChild(deleteBtn);

      card.appendChild(actions);
      body.appendChild(card);
    });

    groupEl.appendChild(header);
    groupEl.appendChild(body);
    host.appendChild(groupEl);
  });
}

// -------------------------------------------------------------
// NOTIFICATION HOOKS
// -------------------------------------------------------------
let POP_ROOT = null;

function ensureRulePopupRoot() {
  if (POP_ROOT && document.body.contains(POP_ROOT)) return POP_ROOT;
  const root = document.createElement('div');
  root.className = 'stats-rule-popRoot';
  document.body.appendChild(root);
  POP_ROOT = root;
  return root;
}

// Pull out "Deal N damage to X" from the rule snapshot / text
function extractDamageSpec(rule) {
  if (!rule) return null;

  const snap = rule.snapshot || {};
  let amt = 0;
  let who = null;

  // Prefer structured snapshot from the builder
  if (snap.effectAction === 'damage' && snap.dmgKindTree === 'player') {
    const rawAmt = snap.dmgAmount;
    const n = parseInt(rawAmt, 10);
    if (!Number.isNaN(n) && n !== 0) {
      amt = n;
      who = snap.dmgWho === 'Opponent' ? 'Opponent' : 'You';
    }
  }

  // Fallback: parse effect text like "Deal 3 damage to opponent"
  if (!amt) {
    const eff = String(rule.effectText || '');
    const m = eff.match(/deal\s+(\d+)\s+damage\s+to\s+(you|opponent)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n !== 0) {
        amt = n;
        const w = m[2].toLowerCase();
        who = w === 'opponent' ? 'Opponent' : 'You';
      }
    }
  }

  if (!amt) return null;

  // Map "You/Opponent" into an actual seat id
  const mySeat = getMySeatSafe();
  const seat =
    who === 'Opponent'
      ? (mySeat === 1 ? 2 : 1)
      : mySeat;

  return { amount: amt, who, seat };
}


// Pull out "You gain N life" from the rule snapshot / text
function extractLifeGainSpec(rule) {
  if (!rule) return null;

  let amt = 0;
  let who = 'You';
  const snap = rule.snapshot || {};

  // Prefer the structured snapshot from the builder
  if (snap.effectAction === 'generate' && snap.genKindTree === 'life') {
    const rawAmt = snap.genLife?.amt;
    const n = parseInt(rawAmt, 10);
    if (!Number.isNaN(n) && n !== 0) {
      amt = n;
    }
    const snapWho = snap.genLife?.who;
    if (snapWho === 'You' || snapWho === 'Opponent' || snapWho === 'Both') {
      who = snapWho;
    }
  }

  // Fallback: parse effect text, e.g. "You gain 3 life."
  if (!amt) {
    const eff = String(rule.effectText || '');
    const m = eff.match(/gain[s]?\s+(\d+)\s+life/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n !== 0) {
        amt = n;
      }
    }

    if (/each player/i.test(eff) || /both players/i.test(eff)) {
      who = 'Both';
    } else if (/opponent/i.test(eff)) {
      who = 'Opponent';
    } else if (/you gain/i.test(eff)) {
      who = 'You';
    }
  }

  if (!amt) return null;

  const mySeat = getMySeatSafe();
  let seat = mySeat;
  if (who === 'Opponent') {
    seat = mySeat === 1 ? 2 : 1;
  } else if (who === 'Both') {
    seat = null; // sentinel: apply to both seats in handler
  }

  return { amount: amt, who, seat };
}


// Called when the "Apply" button is clicked.
// Now wires **life gain** OR **life damage** into clean event pipelines.
function handleRuleEffectApply(rule, meta, lifeSpec, damageSpec) {
  if (!lifeSpec && !damageSpec) {
    console.warn('[StatsRulesOverlay] handleRuleEffectApply called without lifeSpec or damageSpec.');
    return;
  }

  const baseDetail = {
    ruleId: rule.id,
    ruleName: rule.name,
    sourceCardName: rule.sourceCardName || null,
    sourceCardSeat: rule.sourceCardSeat || null,
    meta: meta || null
  };

  // Life gain branch (You / Opponent / Both)
  if (lifeSpec) {
    const mySeat = getMySeatSafe();
    const who = lifeSpec.who || 'You';
    const amount = Number(lifeSpec.amount) || 0;
    if (!amount) return;

    const dispatchGain = (seat, whoLabel) => {
      const detail = {
        ...baseDetail,
        seat,
        amount,
        who: whoLabel || who
      };
      try {
        window.dispatchEvent(
          new CustomEvent('statsRule:gainLife', { detail })
        );
      } catch (e) {
        console.warn('[StatsRulesOverlay] statsRule:gainLife dispatch failed', e, detail);
      }
    };

    if (who === 'Both') {
      // Fire once for you and once for opponent.
      dispatchGain(mySeat, 'You');
      const oppSeat = mySeat === 1 ? 2 : 1;
      dispatchGain(oppSeat, 'Opponent');
    } else if (who === 'Opponent') {
      const oppSeat = lifeSpec.seat ?? (mySeat === 1 ? 2 : 1);
      dispatchGain(oppSeat, 'Opponent');
    } else {
      const seat = lifeSpec.seat ?? mySeat;
      dispatchGain(seat, 'You');
    }

    return;
  }

    // Damage branch (You / Opponent – sends to UI life bridge)
  if (damageSpec) {
    const fallbackSeat = getMySeatSafe();
    const amount = Number(damageSpec.amount) || 0;
    if (!amount) return;

    const detail = {
      ...baseDetail,
      seat: damageSpec.seat ?? fallbackSeat,
      amount,
      who: damageSpec.who || null
    };
    try {
      window.dispatchEvent(
        new CustomEvent('statsRule:damageLife', { detail })
      );
    } catch (e) {
      console.warn('[StatsRulesOverlay] statsRule:damageLife dispatch failed', e, detail);
    }
  }

}


// Build and show the bottom-right popup card for this rule trigger
function showRulePopup(rule, meta) {
  const host = ensureRulePopupRoot();
  const { color } = classifyOutcome(rule.effectText || '');
  const lifeSpec = extractLifeGainSpec(rule);
  const damageSpec = lifeSpec ? null : extractDamageSpec(rule); // prefer life if both somehow exist

  // NOTE:
  // We NO LONGER auto-open Card Attributes overlay here.
  // The overlay will only open after the player presses the primary
  // "Apply" button, not just when the popup appears.

  const card = document.createElement('div');
  card.className = 'stats-rule-popCard';
  card.style.borderColor = color;
  card.style.boxShadow = `0 18px 40px rgba(15,23,42,.9), 0 0 0 1px ${color}33`;

  const titleRow = document.createElement('div');
  titleRow.className = 'stats-rule-popTitle';

  const titleSpan = document.createElement('span');
  titleSpan.textContent = rule.name || 'Rule Triggered';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'stats-rule-popClose';
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => {
    if (card.parentNode === host) host.removeChild(card);
  };

  titleRow.appendChild(titleSpan);
  titleRow.appendChild(closeBtn);

  const cond = document.createElement('div');
  cond.className = 'stats-rule-popCond';
  cond.textContent = rule.conditionText || '';

  const body = document.createElement('div');
  body.className = 'stats-rule-popBody';
  body.textContent = rule.effectText || 'Effect occurred.';

  const actionsRow = document.createElement('div');
  actionsRow.className = 'stats-rule-popActions';

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'stats-rule-popBtn';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.onclick = () => {
    if (card.parentNode === host) host.removeChild(card);
  };

  const primaryBtn = document.createElement('button');
  primaryBtn.type = 'button';
  primaryBtn.className = 'stats-rule-popBtn primary';

  if (lifeSpec) {
    if (lifeSpec.who === 'Opponent') {
      primaryBtn.textContent = `Opponent gains ${lifeSpec.amount} life`;
    } else if (lifeSpec.who === 'Both') {
      primaryBtn.textContent = `Each player gains ${lifeSpec.amount} life`;
    } else {
      primaryBtn.textContent = `Gain ${lifeSpec.amount} life`;
    }
  } else if (damageSpec) {
    primaryBtn.textContent = `Deal ${damageSpec.amount} damage`;
  } else {
    primaryBtn.textContent = 'Apply effect';
  }

  primaryBtn.onclick = () => {
    // 1) Actually apply the rule (life / damage, etc.)
    handleRuleEffectApply(rule, meta, lifeSpec, damageSpec);

    // 2) ONLY NOW auto-open Card Attributes overlay for
    //    generate → counters/types/abilities rules.
    maybeOpenSourceAttributesOverlay(rule);

    // 3) Close the popup
    if (card.parentNode === host) host.removeChild(card);
  };

  actionsRow.appendChild(dismissBtn);
  actionsRow.appendChild(primaryBtn);

  card.appendChild(titleRow);
  if (cond.textContent) card.appendChild(cond);
  card.appendChild(body);
  card.appendChild(actionsRow);

  // Newest popup on top of stack
  if (host.firstChild) {
    host.insertBefore(card, host.firstChild);
  } else {
    host.appendChild(card);
  }
}


// Existing:
// let POP_ROOT = null;
// function ensureRulePopupRoot() { ... }
// function classifyOutcome(...) { ... }
// function showRulePopup(rule, meta) { ... }

/**
 * Popup used when a card with linked rules ENTERS the battlefield.
 * Lets you opt in to enabling those rules for THIS card instance (cid).
 */
function showCardAttachPopup(cardName, cid, rulesForCard) {
  try { ensureStyles(); } catch {}

  const root = ensureRulePopupRoot();
  if (!root) return;

  const card = document.createElement('div');
  card.className = 'stats-rule-popCard';

  const titleRow = document.createElement('div');
  titleRow.className = 'stats-rule-popTitle';

  const titleSpan = document.createElement('span');
  titleSpan.textContent = `Enable rules for ${cardName}?`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'stats-rule-popClose';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => {
    try { root.removeChild(card); } catch {}
  };

  titleRow.append(titleSpan, closeBtn);

  const body = document.createElement('div');
  body.className = 'stats-rule-popBody';

  if (rulesForCard.length === 1) {
    body.textContent =
      `You put ${cardName} onto the battlefield. Enable "${rulesForCard[0].name}" for this copy?`;
  } else {
    const names = rulesForCard.map(r => r.name || 'Rule').join(', ');
    body.textContent =
      `You put ${cardName} onto the battlefield. Enable ${rulesForCard.length} rules for this copy? (${names})`;
  }

  const actions = document.createElement('div');
  actions.className = 'stats-rule-popActions';

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'stats-rule-popBtn';
  dismissBtn.textContent = 'Not now';
  dismissBtn.onclick = () => {
    try { root.removeChild(card); } catch {}
  };

  const enableBtn = document.createElement('button');
  enableBtn.className = 'stats-rule-popBtn primary';
  enableBtn.textContent = 'Enable for this card';
  enableBtn.onclick = () => {
    try {
      rulesForCard.forEach(rule => {
        bindRuleToCid(rule, cid);
      });

      if (LAST_ROOT) {
        renderRulesList(LAST_ROOT);
      }

      try {
        window.StatsWatcherActions?.init?.();
      } catch (e) {
        console.warn('[StatsRulesOverlay] StatsWatcherActions.init failed after card-rule enable', e);
      }
    } finally {
      try { root.removeChild(card); } catch {}
    }
  };

  actions.append(dismissBtn, enableBtn);
  card.append(titleRow, body, actions);
  root.appendChild(card);
}


// Classify effect for coloring (pos/neg/neutral) and provide text/html
function classifyOutcome(effectText) {
  const txt = (effectText || '').trim();

  // Heuristics
  const lower = txt.toLowerCase();

  // Positive cues
  const isGain = /\bgain\b|\byou gain\b/.test(lower);
  const isCreate = /\bcreate\b/.test(lower);
  const isPutPlus = /\bput\b.*\+\d+\/\+\d+/.test(lower);
  const isBuffWord = /\bbuff\b/.test(lower);

  // Negative cues
  const isDeal = /\bdeal\b/.test(lower);
  const isMinusPT = /-\d+\/-\d+/.test(lower);
  const isSendBad = /\bsend that card to (graveyard|exile)\b/.test(lower);

  let tone = 'neutral';
  if (isGain || isCreate || isPutPlus || isBuffWord) tone = 'pos';
  if (isDeal || isMinusPT || isSendBad) tone = 'neg';

  const colorMap = { pos: '#22c55e', neg: '#ef4444', neutral: '#e5e7eb' };
  const color = colorMap[tone];

  // Provide both plain and HTML versions
  const bottom = txt || 'Effect occurred';
  const bottomHTML = `<span style="color:${color};">${escapeHtml(bottom)}</span>`;

  return { tone, color, bottom, bottomHTML };
}

function escapeHtml(s){
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function notifyRule(rule, meta = {}) {
  try {
    // Primary: bottom-right popup with Apply + Dismiss
    showRulePopup(rule, meta);
  } catch (e) {
    console.warn('[StatsRulesOverlay] showRulePopup failed, falling back to Notification', e);

    // Fallback: original Notification toast
    const top = rule.name || 'RULE TRIGGERED';
    const effTxt = rule.effectText || 'Effect occurred';

    const { tone, color, bottom, bottomHTML } = classifyOutcome(effTxt);
    const accent = tone === 'pos' ? '#22c55e' : tone === 'neg' ? '#ef4444' : '#38bdf8';

    try {
      Notification.show({
        top,
        bottom,
        bottomHTML,
        bottomColor: color,
        accent
      });
    } catch {}
  }
}



// -------------------------------------------------------------
// MAIN MOUNT
// -------------------------------------------------------------
function mount(rootEl) {
  if (!rootEl) throw new Error('StatsRulesOverlay.mount: rootEl is required');
  ensureStyles();

  rootEl.innerHTML = `
    <div class="stats-rules-root">
      <div class="stats-rules-header">
        <div class="stats-rules-title">
          Rule Engine: <span id="stats-rootLabel">When</span>
        </div>
        <div class="stats-rules-tabs">
  <button class="stats-rules-tab active" data-tab="add">Add Rule</button>
  <button class="stats-rules-tab" data-tab="active">Loaded Rules</button>
</div>

      </div>

      <div class="stats-rules-body">
        <!-- TAB: ADD RULE -->
        <div id="stats-tabAdd" class="stats-tab-panel active">
          <div class="stats-wrap">
            <div class="stats-tree">
              <div class="stats-cols" id="stats-cols"></div>
            </div>

            <!-- Footer: Source card (optional) + Rule Name + **Primary** Save -->
<div class="stats-footer">
  <div class="stats-footer-row">
<label for="stats-sourceCard">Source card (required)</label>
<div class="stats-source-inline">
  <select id="stats-sourceCard">
    <option value="">Select a card on your battlefield…</option>
  </select>

      <button
        type="button"
        id="stats-refreshSourceCards"
        class="stats-refresh-btn"
        title="Refresh from battlefield"
      >⟳</button>
    </div>
  </div>

  <div class="stats-footer-row">
    <label for="stats-ruleName">Rule Name</label>
    <input
      id="stats-ruleName"
      type="text"
      placeholder="(optional) We'll name it for you if blank"
    />
    <button id="stats-addRuleBtn" class="save">Save Rule</button>
  </div>
</div>

          </div>

          <!-- Live preview of the constructed sentence -->
          <div class="stats-preview" id="stats-preview"></div>
        </div>

        <!-- TAB: LOADED RULES -->
        <div id="stats-tabActive" class="stats-tab-panel">
          <div class="stats-rules-filterRow">
            <label for="stats-rulesFilter">Filter by card name</label>
            <input
              id="stats-rulesFilter"
              type="text"
              placeholder="Type to filter loaded rules…"
            />
          </div>
          <div class="stats-rules-list" id="stats-rulesList"></div>
        </div>

      </div>
    </div>
  `;
  
    LAST_ROOT = rootEl;


  // wire tabs
  const tabButtons = qAll(rootEl, '.stats-rules-tab');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      tabButtons.forEach(b => b.classList.toggle('active', b === btn));
      q(rootEl, '#stats-tabAdd').classList.toggle('active', tab === 'add');
      q(rootEl, '#stats-tabActive').classList.toggle('active', tab === 'active');
    });
  });

  // duration + base state
  resetForRoot(rootEl);

  // save rule button (the ONLY one now)  // save rule button (the ONLY one now)
  const addRuleBtn = q(rootEl, '#stats-addRuleBtn');
  if (addRuleBtn) {
    addRuleBtn.onclick = async () => {
      const rule = captureCurrentRule(rootEl);

      // We now REQUIRE a source card for every rule
      if (!rule.sourceCardName) {
        try {
          Notification.show({
            top: 'Source card required',
            bottom: 'Pick the source card from the dropdown before saving this rule.',
            accent: '#f97316'
          });
        } catch {}
        return;
      }

      // Local in-memory rule list
      RULES.push(rule);
      renderRulesList(rootEl);

      // 🔔 Re-bind watcher rules after save
      try {
        window.StatsWatcherActions?.init?.();
      } catch {}

      // Attempt to persist to Supabase (best-effort)
      await saveRuleToSupabase(rule);

      // Feedback on create with smarter bottom line
      try {
        Notification.show({
          top: 'RULE SAVED',
          bottom: rule.name,
          accent: '#22c55e'
        });
      } catch {}

      // Switch to Active Rules tab
      const activeTabBtn = tabButtons.find(b => b.getAttribute('data-tab') === 'active');
      if (activeTabBtn) activeTabBtn.click();
    };
  }


  // Source card list refresh (now correctly scoped to this root)
  const refreshBtn = q(rootEl, '#stats-refreshSourceCards');
  if (refreshBtn) {
    refreshBtn.onclick = () => refreshSourceCardOptions(rootEl);
  }

  // Loaded Rules filter
  const filterInput = q(rootEl, '#stats-rulesFilter');
  if (filterInput) {
    filterInput.oninput = () => renderRulesList(rootEl);
  }

  // initial renders
  renderTree(rootEl);
  renderActionDetails(rootEl);
  renderRulesList(rootEl);
  refreshSourceCardOptions(rootEl);

  // 🔔 Ensure watcher sees whatever rules already exist
  try {
    window.StatsWatcherActions?.init?.();
  } catch {}
}


// Listen for deck roster events from DeckLoading (fallback channel)
if (typeof window !== 'undefined') {
  window.addEventListener('statsrules:deck-roster', e => {
    try {
      const roster = e?.detail?.roster;
      if (!Array.isArray(roster) || !roster.length) return;
      setDeckCardRoster(roster);
      loadRulesForDeckRoster(roster);
    } catch (err) {
      console.warn('[StatsRulesOverlay] statsrules:deck-roster handler failed', err);
    }
  });
}

/**
 * Card table presence hook.
 * Called whenever CardPlacement dispatches `card:tablePresence`:
 *   detail = { cid, name, onTable, inCommandZone, fieldSide, ownerCurrent, ... }
 *
 * - onTable:true  → card just ENTERED the battlefield
 * - onTable:false → card just LEFT the battlefield (to hand / grave / exile / deck)
 */
function handleTablePresence(detail = {}) {
  try { ensureStyles(); } catch {}

  const cid   = detail.cid ? String(detail.cid) : null;
  const nameRaw =
    detail.name ||
    detail.cardName ||
    '';
  const name  = String(nameRaw).trim();

  if (!cid || !name) return;

  // Only consider cards we control for now
  const mySeat = String(getMySeatSafe());
  let ownerSeat = null;

  if (detail.ownerCurrent != null) {
    ownerSeat = String(detail.ownerCurrent);
  } else if (detail.owner != null) {
    ownerSeat = String(detail.owner);
  } else if (detail.ownerSeat != null) {
    ownerSeat = String(detail.ownerSeat);
  }

  if (ownerSeat) {
    const m = ownerSeat.match(/\d+/);
    if (m) ownerSeat = m[0];
  }

  if (ownerSeat && ownerSeat !== mySeat) {
    // Not our card; ignore for now
    return;
  }

  const onTable = !!detail.onTable;

  if (onTable) {
    // Card has just ENTERED the battlefield.
    const lowerName = name.toLowerCase();

    // Find rules explicitly linked to this card name.
    const candidateRules = RULES.filter(r =>
      r.sourceCardName &&
      r.sourceCardName.toLowerCase() === lowerName
    );

    if (!candidateRules.length) return;

    // If this cid is already bound to all these rules, don't re-prompt.
    let alreadyBound = true;
    for (const rule of candidateRules) {
      const set = RULE_BINDINGS.get(rule.id);
      if (!set || !set.has(cid)) {
        alreadyBound = false;
        break;
      }
    }
    if (alreadyBound) return;

    showCardAttachPopup(name, cid, candidateRules);
  } else {
    // Card has LEFT the battlefield → drop bindings for this cid
    const affectedRuleIds = unbindAllRulesForCid(cid);

    if (affectedRuleIds && affectedRuleIds.length) {
      if (LAST_ROOT) {
        renderRulesList(LAST_ROOT);
      }
      try {
        window.StatsWatcherActions?.init?.();
      } catch (e) {
        console.warn('[StatsRulesOverlay] StatsWatcherActions.init failed after card-rule unbind', e);
      }
    }
  }
}



// -------------------------------------------------------------
// PUBLIC API
// -------------------------------------------------------------
export const StatsRulesOverlay = {
  mount,

  // Watchers should only see enabled rules
  getRules() {
    return RULES.filter(r => r.enabled !== false);
  },

  // In case you ever need the raw list (incl. disabled)
  getAllRules() {
    return RULES.slice();
  },

  triggerRuleById(id) {
    const rule = RULES.find(r => r.id === id);
    if (!rule) return;
    notifyRule(rule);
  },

  notifyRule,

  // Direct hook used by DeckLoading (in addition to the DOM event)
  loadDeckCardRoster(roster) {
    setDeckCardRoster(roster);
    loadRulesForDeckRoster(roster);
  },

  // NEW: hook from CardPlacement → card:tablePresence
  handleTablePresence,

  // NEW: optional debugging / inspection helper
  getRuleBindingsForCid(cid) {
    return getRuleBindingsForCid(cid);
  }
};

// Optional: make it accessible via window for non-module callers
if (typeof window !== 'undefined') {
  window.StatsRulesOverlay = StatsRulesOverlay;
}
