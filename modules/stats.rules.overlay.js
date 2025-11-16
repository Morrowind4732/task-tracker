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
  margin-top:10px;background:var(--stats-panel);border:1px solid var(--stats-line);
  border-radius:12px;padding:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap
}
.stats-footer label{min-width:100px;font-size:.8rem;color:var(--stats-muted)}
.stats-footer input[type=text]{
  flex:1;min-width:240px;background:#0b1224;color:var(--stats-fg);
  border:1px solid #475569;border-radius:8px;padding:10px 12px;font-size:.95rem
}
/* Prominent primary save button */
.stats-footer .save{
  padding:12px 18px;border-radius:999px;border:1px solid #0ea5b7;
  background:var(--stats-acc);color:#0b1224;cursor:pointer;
  font-weight:800;letter-spacing:.02em;font-size:.95rem;
  box-shadow:0 4px 14px rgba(56,189,248,.25);
  transition:transform .06s ease, box-shadow .12s ease;
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

/* Active rules */
.stats-rules-list{ margin-top:6px; }
.stats-rule-card{
  background:#020617;border:1px solid var(--stats-line);border-radius:10px;padding:8px;margin-bottom:6px;font-size:.8rem;
}
.stats-rule-card h4{margin:0 0 4px;font-size:.8rem;color:var(--stats-acc);}
.stats-rule-meta{font-size:.75rem;color:var(--stats-muted);margin-bottom:3px}
.stats-rule-cond{font-size:.8rem;margin-bottom:3px}
.stats-rule-reward{font-size:.8rem;color:#e5e7eb}
.stats-rule-actions{margin-top:4px;display:flex;gap:6px;flex-wrap:wrap}
.stats-rule-actions button{
  font-size:.7rem;padding:6px 8px;border-radius:999px;border:1px solid #475569;background:#020617;color:var(--stats-fg);cursor:pointer;
}
.stats-rule-actions button:hover{border-color:var(--stats-acc);}
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
  genLife: { amt: 1 },

  // Damage
  dmgKindTree: null,
  dmgCardModeTree: null,
  dmgAmount: 1,
  dmgPT: { p: 1, t: 1 },
  dmgSendToTree: "",

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
const RULES = []; // { id, name, conditionText, effectText, snapshot }

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
      const cDet = makeCol('Details');
      if (S.genKindTree === 'life') {
        cDet.wrap.insertAdjacentHTML(
          'beforeend',
          `<div class="stats-row" style="padding-right:12px">
             <input id="stats-genLifeAmtTree" type="text" placeholder="life amount" />
           </div>`
        );
        colsHost.appendChild(cDet.wrap);
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
      }
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

  if (S.effectAction === 'damage') {
    const cKind = makeCol('Damage → Target');
    [["Target Player", "player"], ["Opponent’s Hand", "hand"], ["Target Card", "card"]].forEach(([label, key]) =>
      cKind.grid.appendChild(
        makeBtn(label, S.dmgKindTree === key, () => {
          S.dmgKindTree = key;
          S.dmgCardModeTree = null;
          renderTree(rootEl);
        })
      )
    );
    colsHost.appendChild(cKind.wrap);

    if (S.dmgKindTree) {
      if (S.dmgKindTree === 'player' || S.dmgKindTree === 'hand') {
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
    case 'generate':
      if (S.genKindTree === 'life') {
        return `You gain ${S.genLife.amt || 1} life.`;
      }
      if (S.genKindTree === 'token') {
        const qty = S.genToken.qty || 1;
        const kind = S.genToken.kind || 'token';
        return `Create ${qty} ${kind} token${qty === 1 ? '' : 's'}.`;
      }
      if (S.genKindTree === 'counter') {
        const qty = S.genCounter.qty || 1;
        const kind = S.genCounter.kind || 'counter';
        return `Put ${qty} ${kind} counter${qty === 1 ? '' : 's'} on target.`;
      }
      return 'Generate some value.';
    case 'damage':
      if (S.dmgKindTree === 'player') {
        return `Deal ${S.dmgAmount || 1} damage to target player.`;
      }
      if (S.dmgKindTree === 'hand') {
        return `Deal ${S.dmgAmount || 1} damage to cards in opponent’s hand.`;
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
    case 'generate':
      if (S.genKindTree === 'life') return `Gain ${S.genLife.amt || 1} Life`;
      if (S.genKindTree === 'token') {
        const qty = S.genToken.qty || 1;
        const kind = S.genToken.kind || 'Token';
        return `Create ${qty} ${kind}${qty === 1 ? '' : 's'}`;
      }
      if (S.genKindTree === 'counter') {
        const qty = S.genCounter.qty || 1;
        const kind = S.genCounter.kind || 'Counter';
        return `Put ${qty} ${kind} ${qty === 1 ? 'Counter' : 'Counters'}`;
      }
      return 'Generate';
    case 'damage':
      if (S.dmgKindTree === 'player') return `Deal ${S.dmgAmount || 1} to Player`;
      if (S.dmgKindTree === 'hand') return `Deal ${S.dmgAmount || 1} to Opponent’s Hand`;
      if (S.dmgKindTree === 'card') {
        if (S.dmgCardModeTree === 'debuff' || S.dmgCardModeTree === 'counters')
          return `Give -${S.dmgPT.p || 1}/-${S.dmgPT.t || 1}`;
        if (S.dmgCardModeTree === 'send' && S.dmgSendToTree) return `Send to ${S.dmgSendToTree}`;
      }
      return 'Damage';
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

  return {
    id: RULE_ID_COUNTER++,
    name,
    conditionText: cond || '(incomplete condition)',
    effectText: eff,
    snapshot: JSON.parse(JSON.stringify(S))
  };
}

function renderRulesList(rootEl) {
  const host = q(rootEl, '#stats-rulesList');
  if (!host) return;
  host.innerHTML = '';

  if (!RULES.length) {
    const empty = document.createElement('div');
    empty.className = 'stats-tiny';
    empty.textContent = 'No active rules yet. Use Add Rule to create one.';
    host.appendChild(empty);
    return;
  }

  RULES.forEach(rule => {
    const card = document.createElement('div');
    card.className = 'stats-rule-card';

    const h = document.createElement('h4');
    h.textContent = rule.name;
    card.appendChild(h);

    const meta = document.createElement('div');
    meta.className = 'stats-rule-meta';
    meta.textContent = `Rule #${rule.id}`;
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

    const testBtn = document.createElement('button');
    testBtn.textContent = 'Test Notify';
    testBtn.onclick = () => notifyRule(rule);
    actions.appendChild(testBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => {
      const idx = RULES.findIndex(r => r.id === rule.id);
      if (idx >= 0) RULES.splice(idx, 1);
      renderRulesList(rootEl);
    };
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    host.appendChild(card);
  });
}

// -------------------------------------------------------------
// NOTIFICATION HOOKS
// -------------------------------------------------------------
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

function notifyRule(rule) {
  const top = rule.name || 'RULE TRIGGERED';
  const effTxt = rule.effectText || 'Effect occurred';

  const { tone, color, bottom, bottomHTML } = classifyOutcome(effTxt);

  // Use accent to mirror sentiment (keeps your current glow/border theme)
  const accent = tone === 'pos' ? '#22c55e' : tone === 'neg' ? '#ef4444' : '#38bdf8';

  // Send plain bottom + optional hints (non-breaking if Notification ignores them)
  Notification.show({
    top,
    bottom,               // always provide plain text
    bottomHTML,           // if your Notification supports innerHTML, it can use this
    bottomColor: color,   // hint for coloring the bottom line if supported
    accent                // keep accent consistent with sentiment
  });
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
          <button class="stats-rules-tab" data-tab="active">Active Rules</button>
        </div>
      </div>

      <div class="stats-rules-body">
        <!-- TAB: ADD RULE -->
        <div id="stats-tabAdd" class="stats-tab-panel active">
          <div class="stats-wrap">
            <div class="stats-tree">
              <div class="stats-cols" id="stats-cols"></div>
            </div>

            <!-- Footer: Rule Name (optional) + **Primary** Save -->
            <div class="stats-footer">
              <label for="stats-ruleName">Rule Name</label>
              <input id="stats-ruleName" type="text" placeholder="(optional) We'll name it for you if blank"/>
              <button id="stats-addRuleBtn" class="save">Save Rule</button>
            </div>
          </div>

          <!-- Live preview of the constructed sentence -->
          <div class="stats-preview" id="stats-preview"></div>
        </div>

        <!-- TAB: ACTIVE RULES -->
        <div id="stats-tabActive" class="stats-tab-panel">
          <div class="stats-rules-list" id="stats-rulesList"></div>
        </div>
      </div>
    </div>
  `;

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

  // save rule button (the ONLY one now)
  const addRuleBtn = q(rootEl, '#stats-addRuleBtn');
  if (addRuleBtn) {
    addRuleBtn.onclick = () => {
      const rule = captureCurrentRule(rootEl);
      RULES.push(rule);
      renderRulesList(rootEl);

      // Feedback on create with smarter bottom line
      Notification.show({
        top: 'RULE SAVED',
        bottom: rule.name,
        accent: '#22c55e'
      });

      // Switch to Active Rules tab
      const activeTabBtn = tabButtons.find(b => b.getAttribute('data-tab') === 'active');
      if (activeTabBtn) activeTabBtn.click();
    };
  }

  // initial renders
  renderTree(rootEl);
  renderActionDetails(rootEl);
  renderRulesList(rootEl);
}

// -------------------------------------------------------------
// PUBLIC API
// -------------------------------------------------------------
export const StatsRulesOverlay = {
  mount,
  getRules() {
    return RULES.slice();
  },
  triggerRuleById(id) {
    const rule = RULES.find(r => r.id === id);
    if (!rule) return;
    notifyRule(rule);
  },
  notifyRule
};
