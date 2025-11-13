// /modules/card.attributes.overlay.ui.js
// Unified Attributes Overlay (mock UI) — tabs: Scan, Apply, Active, Manage
// - High-Z modal sheet with large left preview
// - Right-side tabbed panes for Scan/Apply/Active/Manage
// - Radial pickers (+ / -) for Types / Abilities / Counters with alpha wheel
// - No Flip/SendTo; Apply buttons are stubbed (no-op) per request

// /modules/card.attributes.overlay.ui.js
// Unified Attributes Overlay / Buff Applier UI

import { RulesStore } from './rules.store.js';
import { RTCApply }   from './rtc.rules.js';
import { scanOracleTextForActions } from './oracle.text.scanner.js';

export const CardOverlayUI = (() => {
  const STATE = {
  mounted: false,
  cssInjected: false,
  root: null,
  activeCid: null,
  activeTab: 'scan', // scan | apply | active | manage
  lastScope: 'mine', // ← NEW: remembers ‘mine’ | ‘opp’ | ‘both’ | ‘deck’ | ‘type’
  tmp: { typeInput:'', abilityInput:'', counterInput:'', pow:'0', tou:'0' }
};


  // ------- Mock catalogs (trimmed; extend later or fetch real data) -------
  const TYPES = {
    A: ['Advisor','Aetherborn','Ally','Angel','Antelope','Archer'],
    B: ['Bat','Bear','Beast','Berserker','Bird','Boar'],
    C: ['Cat','Centaur','Cleric','Construct','Crocodile'],
    D: ['Demon','Devil','Dinosaur','Djinn','Dragon','Druid'],
    E: ['Efreet','Elder','Elemental','Elf'],
    F: ['Faerie','Fish','Fox','Fractal','Frog'],
    G: ['Giant','Gnome','Goat','Goblin','Golem'],
    H: ['Human','Hydra','Horror','Hound'],
    I: ['Illusion','Imp','Incarnation','Insect'],
    K: ['Knight','Kobold','Kor','Kraken'],
    L: ['Lizard','Leviathan'],
    M: ['Merfolk','Minion','Minotaur','Myr'],
    N: ['Naga','Nautilus','Ninja','Nymph'],
    O: ['Ooze','Orc','Ogre'],
    P: ['Pegasus','Phoenix','Pirate','Plant','Praetor'],
    R: ['Rat','Rogue'],
    S: ['Samurai','Scout','Serpent','Shaman','Skeleton','Sliver','Soldier','Sphinx','Spirit'],
    T: ['Treefolk','Trilobite','Troll'],
    V: ['Vampire','Vedalken','Viashino','Volver'],
    W: ['Warlock','Warrior','Wizard','Wraith','Wurm'],
    Z: ['Zombie']
  };
  const ABILITIES = {
    A: ['Afflict','Affinity'],
    C: ['Cascade','Champion','Convoke'],
    D: ['Deathtouch','Defender'],
    F: ['First strike','Flying'],
    H: ['Haste','Hexproof'],
    I: ['Indestructible'],
    L: ['Lifelink'],
    M: ['Menace'],
    P: ['Prowess'],
    R: ['Reach'],
    T: ['Trample'],
    V: ['Vigilance']
  };
  const COUNTERS = {
    '+': ['+1/+1','Loyalty','Shield','Oil'],
    '-': ['-1/-1'],
    M: ['Muster','Mining'],
    P: ['Poison'],
    S: ['Stun','Spore']
  };

  const CSS = `
  :root{
    --ovlZ: 2147483000; /* absurdly high; beats badges */
    --bg0:#0b1116; --bg1:#0e141b; --bg2:#121a22; --panel:#0f1821;
    --ink:#e7f2ff; --mut:#97a6b5; --hi:#61d095; --warn:#ef4444; --line:#1f2a36;
    --pill:#142331; --pillOn:#0f3324;
    --radius:14px; --shadow:0 22px 64px rgba(0,0,0,.6);
  }
  .ovlBack{
    position: fixed; inset: 0; background: rgba(0,0,0,.55);
    display:none; align-items:center; justify-content:center;
    z-index: var(--ovlZ);
  }
  .ovlBack[aria-hidden="false"]{ display:flex; }
  .ovl{
    width:min(1200px,96vw); max-height:90vh; background: linear-gradient(180deg,var(--bg1),var(--bg2));
    color:var(--ink); border:1px solid var(--line); border-radius:18px; box-shadow:var(--shadow);
    transform: translateY(14px) scale(.98); opacity:0; transition:.18s ease;
    display:grid; grid-template-rows:auto 1fr auto;
  }
  .ovlBack[aria-hidden="false"] .ovl{ transform:none; opacity:1; }
  /* allow wrapping so last tabs (e.g., Copy) don't get pushed off-screen */
.ovlHead{
  display:flex;
  align-items:center;
  gap:12px;
  padding:12px 14px;
  border-bottom:1px solid var(--line);
  flex-wrap: wrap;          /* NEW */
}

  .title{ font-weight:700; letter-spacing:.3px; }
  .cid{ margin-left:auto; font-size:12px; color:var(--mut); }
  .xBtn{ appearance:none; border:1px solid var(--line); background:#101820; color:var(--ink); border-radius:10px; padding:8px 12px; cursor:pointer; }

  .ovlBody{ display:grid; grid-template-columns: 360px 1fr; gap:16px; padding:16px; overflow:hidden; }
  .ovlBody[data-mode="compact"]{ grid-template-columns: 1fr; }
  .ovlBody[data-mode="compact"] .preview{ display:none; }

  .preview{
    background:#000; border:1px solid var(--line); border-radius:16px; overflow:hidden;
    display:grid; grid-template-rows: auto 1fr; min-height:420px;
  }
  .preview img{ width:100%; height:auto; display:block; }
  .preview .cap{ padding:8px 10px; font-size:12px; color:var(--mut); border-top:1px solid var(--line); background:#0a0f13; }

  .right{ overflow:auto; }
  .tabs{ display:flex; gap:8px; padding:0 4px 10px; position:sticky; top:0; background:linear-gradient(180deg,var(--bg1),transparent 70%); z-index:1; }
  .tabBtn{
    padding:8px 12px; border-radius:999px; border:1px solid var(--line); background:var(--pill); color:var(--ink);
    cursor:pointer; font-weight:600; letter-spacing:.2px;
  }
  .tabBtn[data-on="true"]{ outline:2px solid var(--hi); background:var(--pillOn); }

  .panel{ display:none; border:1px solid var(--line); border-radius:16px; background:var(--panel); padding:14px; }
  .panel[aria-hidden="false"]{ display:block; }

  .grid2{ display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
  .group{ border:1px solid var(--line); border-radius:12px; padding:12px; background:#0c141b; }
  .label{ font-size:12px; color:var(--mut); text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px; }

  .ipt, .sel, .btn{ appearance:none; border:1px solid var(--line); background:#0a1118; color:var(--ink); border-radius:10px; padding:10px 12px; }
  .btn{ cursor:pointer; }
  .btnPrimary{ background:#0e2419; border-color:#224e3b; }
  .btnDanger{ background:#271212; border-color:#5b2525; }
  .chipRow{ display:flex; flex-wrap:wrap; gap:6px; }
  .chip{ padding:6px 10px; border:1px solid var(--line); background:#0c151d; border-radius:999px; font-size:12px; }

  /* Radial */
  .radialBack{ position:fixed; inset:0; z-index: calc(var(--ovlZ) + 1); display:none; place-items:center; background: rgba(0,0,0,.4); }
  .radialBack[aria-hidden="false"]{ display:grid; }
  .radial{
    width:520px; height:520px; border-radius:50%; background: radial-gradient(ellipse at center, #0f1b26 0%, #0a0f13 70%);
    border:1px solid #1c2a38; position:relative; display:grid; place-items:center;
  }
  .rBtn{ position:absolute; width:44px; height:44px; border-radius:50%; border:1px solid #203041; background:#0b1620; display:grid; place-items:center; cursor:pointer; }
  .rBtn:hover{ filter:brightness(1.15); }
  .rList{ position:absolute; width:280px; max-height:300px; overflow:auto; border:1px solid #203041; background:#0d1823; border-radius:12px; padding:8px; display:grid; gap:6px; }
  .rItem{ padding:10px 12px; border-radius:10px; border:1px solid #203041; background:#0b1620; cursor:pointer; }
  .rItem:hover{ background:#0e1f2b; }
  .rClose{ position:absolute; bottom:8px; right:8px; }

  .foot{ display:flex; gap:10px; justify-content:flex-end; padding:12px 16px; border-top:1px solid var(--line); }
  
    .oracleBox{
    width:100%;
    min-height: 200px;           /* starts tall */
    padding:12px;
    border:1px solid var(--line);
    border-radius:10px;
    background:#0a0f13;
    color:var(--ink);
    line-height:1.35;
    white-space:pre-wrap;         /* preserves lines */
    word-break:break-word;
    font-size:14px;
  }
  .oracleBox i.ms{ margin:0 2px; vertical-align:middle; } /* mana icons */

  /* stacked PT controls (Power over Toughness) */
  .ptStack{ display:grid; grid-template-columns: 1fr; gap:12px; }
  .ptRow{ display:flex; gap:6px; align-items:center; }
  .ptRow .ipt{ width:120px; }

  /* vertical radio group to cut scrolling */
  .radioCol{ display:grid; gap:8px; }

  /* ---- Target row layout in "Select Targets" ---- */
  .targetRow{
    display:flex;
    align-items:flex-start;
    gap:12px;
    border:1px solid var(--line);
    border-radius:10px;
    padding:10px 12px;
    background:#0a0f13;
    min-height:48px;
    font-size:13px;
    line-height:1.3;
    color:var(--ink);
  }

  .tLeft{
    display:flex;
    align-items:flex-start;
    gap:8px;
    min-width:0;
    font-weight:600;
    color:var(--ink);
  }
  .tLeft img{
    width:22px;
    height:auto;
    border-radius:4px;
    flex-shrink:0;
  }
  .tLeft input[type="checkbox"]{
    flex-shrink:0;
    margin-top:3px;
    accent-color:#61d095;
  }

  .tName{
    white-space:nowrap;
    max-width:180px;
    overflow:hidden;
    text-overflow:ellipsis;
    color:var(--ink);
    font-weight:600;
  }

  .tMid{
    flex:1;
    min-width:0;
    font-size:12px;
    color:var(--mut);
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
    padding-top:2px;
  }

  .tRight{
  display:flex;
  flex-direction:row;         /* <-- horizontal row now */
  align-items:center;
  justify-content:flex-end;
  gap:8px;
  flex-shrink:0;
  min-width:80px;
  text-align:right;
}

.tPT{
  font-weight:700;
  font-variant-numeric:tabular-nums;
  color:#e7f2ff;
  min-width:44px;
  line-height:1.2;
  font-size:13px;
}

.eyeBtn{
  appearance:none;
  cursor:pointer;
  border:1px solid var(--line);
  background:#0a1118;
  color:#(ink);
  border-radius:8px;
  font-size:16px;            /* bigger */
  font-weight:600;
  line-height:1;
  padding:6px 10px;          /* slightly wider */
  min-width:36px;
  min-height:28px;
  text-align:center;
  display:flex;
  align-items:center;
  justify-content:center;
}
.eyeBtn:hover{
  background:#0e2419;
  border-color:#224e3b;
  color:#hi;
}


  


  `;

  function injectCSS(){
    if (STATE.cssInjected) return;
    const st = document.createElement('style');
    st.id = 'card-ovl-ui-css';
    st.textContent = CSS;
    document.head.appendChild(st);
    STATE.cssInjected = true;
  }

  function make(el, cls, html){
    const n = document.createElement(el);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function makeRoot(){
    const back = make('div','ovlBack'); back.setAttribute('aria-hidden','true');

    back.innerHTML = `
      <section class="ovl" role="dialog" aria-modal="true">
        <header class="ovlHead">
  <div class="tabs tabsHead">
    <button class="tabBtn" data-tab="scan">Scan</button>
    <button class="tabBtn" data-tab="apply">Apply</button>
    <button class="tabBtn" data-tab="active">Active</button>
    <button class="tabBtn" data-tab="manage">Manage</button>
    <button class="tabBtn" data-tab="copy">Copy</button>
  </div>
  <div class="cid"></div>
  <button class="xBtn" data-act="close">Close</button>
</header>


<div class="ovlBody">
  <aside class="preview">
    <img alt="Card"/>
    <div class="cap"></div>
  </aside>

  <section class="right">
    <!-- (tabs row removed; buttons now live in header) -->


            <!-- Scan -->
            <div class="panel" data-pane="scan" aria-hidden="false">
              <div class="group">
  <div class="label">Scanned Oracle Text</div>
  <div class="oracleBox" data-scan="oracle" role="region" aria-label="Oracle text"></div>
  <div style="margin-top:8px; display:flex; gap:8px;">
    <button class="btn" data-scan="rescan">Rescan</button>
    <button class="btn" data-scan="clear">Clear</button>
  </div>
</div>


              <div class="grid2" style="margin-top:12px;">
                <div class="group">
                  <div class="label">Detected abilities</div>
                  <div class="chipRow" data-scan="detected">
                    <!-- mock entries; dynamic later -->
                  </div>
                </div>
                <div class="group">
                  <div class="label">Quick actions</div>
                  <div class="chipRow" data-scan="actions">
                    <!-- Each actionable detection gets a button (e.g., Create X Token) -->
                  </div>
                </div>
              </div>
            </div>
			
			<!-- Copy -->
<div class="panel" data-pane="copy" aria-hidden="true">
  <div class="group" style="display:grid; gap:12px; max-width:480px;">
    <div class="label">Quantity</div>
    <div style="display:flex; gap:8px; align-items:center;">
      <button class="btn" data-copy="decr" title="-1">−</button>
      <input class="ipt" data-copy="qty" type="number" min="1" value="1" style="width:90px; text-align:center;" />
      <button class="btn" data-copy="incr" title="+1">+</button>
    </div>

    <div class="label" style="margin-top:8px;">Actions</div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <button class="btn btnPrimary" data-copy="spawn">Create Copy</button>
      <button class="btn" data-copy="spawnToken">Create Token Copy</button>
    </div>

    <div style="font-size:12px; color:var(--mut); line-height:1.4;">
      Creates exact visual copies of the currently open card and spawns them directly on the table.
      Copies are tagged as <b>Copy</b>; token copies are tagged as <b>Copy</b> and <b>Token</b> for badge display.
    </div>
  </div>
</div>

<!-- NEW -->
<div class="tabPanel" data-tab="copy" aria-hidden="true">
  <div class="copyPane">

  </div>
</div>

            <!-- Apply -->            <!-- Apply -->
            <div class="panel" data-pane="apply" aria-hidden="true">

              <!-- mini-tabs INSIDE Apply -->
              <div class="tabs" data-apply="steps" style="margin-bottom:12px;">
                <button class="tabBtn" data-apply-step="targets" data-on="true">Targets</button>
                <button class="tabBtn" data-apply-step="effects" data-on="false">Effects</button>
              </div>

              <!-- STEP: TARGETS -->
              <div class="applyStep" data-step="targets" aria-hidden="false"
                   style="display:grid; grid-template-columns: 1fr 320px; gap:12px; min-height:300px;">

                <!-- left column: target picker / filters / list -->
                <div class="group" style="display:grid; gap:12px;">

                  <!-- scope row -->
                  <div class="group">
                    <div class="label">Scope</div>
                    <div class="chipRow" style="flex-wrap:wrap; row-gap:8px;">
                      <button class="btn" data-scope="mine">My cards</button>
                      <button class="btn" data-scope="opp">Opponent</button>
                      <button class="btn" data-scope="both">Both</button>
                      <button class="btn" data-scope="deck">Deck</button>

                      <!-- extra modes -->
                      <button class="btn" data-scope="type">By Type</button>
                      <button class="btn" data-scope-filter="open"
                              title="Filter card types"
                              style="display:flex;align-items:center;gap:6px;">
                        <span>Filter</span>
                        <span style="font-size:14px;">⏷</span>
                      </button>
                    </div>

                    <!-- Unified By Type block (visible only when scope === "type") -->
<div class="group" data-target-mode="typeBlock" style="display:none; margin-top:10px;">
  <div class="label">Target by creature type</div>

  <!-- Line 1: Yours / Opponents / All (one line, mutually exclusive) -->
  <div class="chipRow" style="flex-wrap:wrap; row-gap:8px; margin-bottom:8px;">
    <label class="chip" style="display:flex;align-items:center;gap:6px;">
      <input type="radio" name="bytype-scope" value="mine" checked />
      Yours
    </label>
    <label class="chip" style="display:flex;align-items:center;gap:6px;">
      <input type="radio" name="bytype-scope" value="opp" />
      Opponents
    </label>
    <label class="chip" style="display:flex;align-items:center;gap:6px;">
      <input type="radio" name="bytype-scope" value="both" />
      All
    </label>
  </div>

  <!-- Line 2: Type textbox (its own line) -->
  <div style="display:flex; gap:6px; margin-bottom:8px;">
    <input class="ipt" data-bytype="name" placeholder="e.g. Zombie" style="flex:1;"/>
  </div>

  <!-- Line 3: Include source checkbox (its own line) -->
  <label class="chip" style="display:inline-flex; align-items:center; gap:8px;">
    <input type="checkbox" data-bytype="includeSource" checked />
    Include source card when applying
  </label>
</div>



                    <!-- filter drawer -->
                    <div class="group" data-filter-drawer style="display:none; margin-top:10px;">
                      <div class="label">Show only…</div>
                      <div class="chipRow" style="flex-wrap:wrap; row-gap:8px;">
                        <label class="chip" style="display:flex;align-items:center;gap:6px;">
                          <input type="checkbox" data-filter-kind="all" checked/> All
                        </label>
                        <label class="chip" style="display:flex;align-items:center;gap:6px;">
                          <input type="checkbox" data-filter-kind="creature"/> Creature
                        </label>
                        <label class="chip" style="display:flex;align-items:center;gap:6px;">
                          <input type="checkbox" data-filter-kind="legendary"/> Legendary
                        </label>
                        <label class="chip" style="display:flex;align-items:center;gap:6px;">
                          <input type="checkbox" data-filter-kind="artifact"/> Artifact
                        </label>
                        <label class="chip" style="display:flex;align-items:center;gap:6px;">
                          <input type="checkbox" data-filter-kind="enchantment"/> Enchantment
                        </label>
                        <!-- add more buckets later -->
                      </div>
                    </div>
                  </div>

                  

                  <!-- list of specific card targets (default visible for mine/opp/both/deck) -->
                  <div class="group"
                       data-target-mode="listBlock"
                       style="max-height:240px; overflow:auto;">
                    <div class="label">Select Targets</div>
                    <div data-apply="list" style="display:grid; gap:6px;">
                      <!-- rows injected via rebuildTargets(scope) -->
                    </div>
                  </div>
                </div>


                <!-- right column: live preview of a highlighted card -->
                <div class="group" style="min-height:240px; display:grid; grid-template-rows:auto 1fr; gap:8px;">
                  <div class="label">Preview</div>
                  <div data-apply="previewCardShell"
                       style="border:1px solid var(--line); border-radius:12px; background:#0a0f13;
                              min-height:200px; display:flex; align-items:center; justify-content:center;
                              overflow:hidden;">
                    <div data-apply="previewCardMsg"
                         style="color:var(--mut); font-size:12px; padding:12px; text-align:center;">
                      Tap the eye icon on a card to preview it.
                    </div>
                    <!-- live clone of the card will be injected here -->
                  </div>
                </div>

              </div> <!-- /applyStep targets -->

              <!-- STEP: EFFECTS -->
              <div class="applyStep" data-step="effects" aria-hidden="true"
                   style="display:none; grid-template-columns: 1fr 320px; gap:12px; min-height:300px;">

                <!-- left column: effect builder -->
                <div class="group" style="display:grid; gap:12px;">

                  <div class="group">
                    <div class="label">What are we applying?</div>

                    <div class="chipRow" data-effect="toggles"
                         style="margin-bottom:10px; flex-wrap:wrap; row-gap:8px;">
                      <label class="chip">
                        <input type="checkbox" data-eff="pt" /> Power/Toughness
                      </label>
                      <label class="chip">
                        <input type="checkbox" data-eff="counters"/> Counters
                      </label>
                      <label class="chip">
                        <input type="checkbox" data-eff="ability"/> Grant ability
                      </label>
                      <label class="chip">
                        <input type="checkbox" data-eff="type"/> Grant type
                      </label>
                    </div>

                    <!-- Dynamic effect sections render here based on toggles -->
                    <div data-apply="effect-sections" style="display:grid; gap:10px;"></div>
                  </div>

                  <div class="group">
                    <div class="label">Duration</div>
                    <div class="radioCol" style="margin-bottom:10px;">
                      <label class="chip">
                        <input type="radio" name="dur" checked/>
                        Until end of turn
                      </label>
                      <label class="chip">
                        <input type="radio" name="dur"/>
                        While source remains on battlefield
                      </label>
                      <label class="chip">
                        <input type="radio" name="dur"/>
                        Persistent (manual remove)
                      </label>
                    </div>

                    <div class="label">Application</div>
                    <div class="chipRow" style="flex-wrap:wrap; row-gap:8px;">
                      <label class="chip">
                        <input type="radio" name="app" />
                        Current
                      </label>
                      <label class="chip">
                        <input type="radio" name="app" checked/>
                        Ongoing
                      </label>
                    </div>
                  </div>

                </div>

                <!-- right column: summary / final check -->
                <div class="group" style="min-height:240px; display:grid; grid-template-rows:auto 1fr; gap:8px;">
                  <div class="label">Summary</div>
                  <div data-apply="summaryShell"
                       style="border:1px solid var(--line); border-radius:12px; background:#0a0f13;
                              min-height:200px; color:var(--mut); font-size:12px; line-height:1.4;
                              padding:12px; overflow:auto;">
                    <!-- We'll fill this with "You will apply +1/+1 and Flying to 3 cards" etc -->
                    <div data-apply="summaryMsg">
                      Choose targets first, then configure the effect.
                    </div>
                  </div>
                </div>

              </div> <!-- /applyStep effects -->

            </div>


            <!-- Active -->
            <div class="panel" data-pane="active" aria-hidden="true">
              <div class="chipRow" style="margin-bottom:10px;">
                <button class="btn" data-active="mine">My Cards</button>
                <button class="btn" data-active="opp">Opponent</button>
                <button class="btn" data-active="both">Both</button>
                <button class="btn" data-active="refresh">Refresh</button>
              </div>
              <div class="group">
                <div class="label">Active effects on selected targets</div>
                <div data-active="list" style="display:grid; gap:8px;">
                  <!-- rows appear here -->
                </div>
              </div>
            </div>

            <!-- Manage -->
            <div class="panel" data-pane="manage" aria-hidden="true">
              <div class="group" style="margin-bottom:12px;">
                <div class="label">Force Types</div>
                <div style="display:flex; gap:6px;">
                  <input class="ipt" data-man="type" placeholder="Type (e.g., Elf)"/>
                  <button class="btn" data-radial="+manType">+</button>
                  <button class="btn" data-radial="-manType">-</button>
                </div>
              </div>

              <div class="group" style="margin-bottom:12px;">
                <div class="label">Force Effects / Abilities</div>
                <div style="display:flex; gap:6px;">
                  <input class="ipt" data-man="ability" placeholder="Ability (e.g., Flying)"/>
                  <button class="btn" data-radial="+manAbility">+</button>
                  <button class="btn" data-radial="-manAbility">-</button>
                </div>
              </div>

              <div class="group">
                <div class="label">Force Counters</div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  <input class="ipt" data-man="counter" placeholder="Counter kind (e.g., +1/+1)" style="flex:1; min-width:180px;"/>
                  <button class="btn" data-radial="+manCounter">+</button>
                  <button class="btn" data-radial="-manCounter">-</button>
                  <input class="ipt" data-man="counterQty" value="1" style="width:84px;"/>
                </div>
              </div>

              <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:12px;">
                <button class="btn btnDanger" data-man="delete">Delete</button>
                <button class="btn" data-man="repair">Repair</button>
                <button class="btn" data-man="save">Save</button>
                <button class="btn btnPrimary" data-man="apply">Apply</button>
              </div>
            </div>

          </section>
        </div>

        <footer class="foot">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn btnPrimary" data-act="apply-root">Apply</button>
        </footer>
      </section>
	  
	  

      <!-- Radial picker -->
      <div class="radialBack" aria-hidden="true">
        <div class="radial">
          <button class="xBtn rClose" data-radial="close">Close</button>
          <!-- alpha ring buttons injected here -->
          <!-- selection list appears in center as .rList -->
        </div>
      </div>
    `;

    document.body.appendChild(back);

    // Close/backdrop
    back.addEventListener('click', (e) => {
      if (e.target.classList.contains('ovlBack')) close();
    });
    back.querySelector('[data-act="close"]').addEventListener('click', close);
    back.querySelector('[data-act="cancel"]').addEventListener('click', close);

    // Tabs (now in header)
back.querySelectorAll('.ovlHead .tabBtn').forEach(btn => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

// ─────────────────────────────────────────────────────────────
// Copy tab logic
// ─────────────────────────────────────────────────────────────
const qtyIpt = back.querySelector('[data-copy="qty"]');
const btnDec = back.querySelector('[data-copy="decr"]');
const btnInc = back.querySelector('[data-copy="incr"]');
const btnSpawn = back.querySelector('[data-copy="spawn"]');
const btnSpawnToken = back.querySelector('[data-copy="spawnToken"]');

function _clampQty(n){ n = Number(n)||1; return Math.max(1, Math.min(99, n)); }
function _getQty(){ return _clampQty(qtyIpt?.value); }
function _setQty(n){ if (qtyIpt) qtyIpt.value = String(_clampQty(n)); }

btnDec?.addEventListener('click', () => _setQty(_getQty() - 1));
btnInc?.addEventListener('click', () => _setQty(_getQty() + 1));

// Helper: find active card element from active cid
function _activeEl(){
  const cid = STATE.activeCid;
  if (!cid) return null;
  return document.querySelector(`img.table-card[data-cid="${cid}"]`);
}

// Helper: add type tags into remoteAttrs so Badges can render them
// Now we also mirror as structured GRANTS (kind:'type') so the panel shows Copy/Token.
function _addTypesToEl(el, typesArr){
  if (!el || !typesArr?.length) return;

  // NEW: never tag the source/original card (the one the overlay was opened on)
  try {
    if (STATE?.activeCid && el?.dataset?.cid === STATE.activeCid) return;
  } catch {}

  let raw = {};
  try { raw = el.dataset.remoteAttrs ? JSON.parse(el.dataset.remoteAttrs) : {}; } catch {}

  // legacy list (kept for back-compat)
  const base = Array.isArray(raw.types) ? raw.types.slice() : [];
  const seen = new Set(base.map(s => String(s).trim().toLowerCase()));

  // structured grants list
  let grants = Array.isArray(raw.grants) ? raw.grants.slice() : [];

  // upsert helper for grants (by normalized type name)
  const norm = s => String(s||'').trim().toLowerCase();
  const idxOfGrant = (name) => grants.findIndex(g => String(g?.kind||'')==='type' && norm(g?.name)===norm(name));

  for (const t of typesArr){
    const s = String(t||'').trim();
    if (!s) continue;
    const k = s.toLowerCase();

    // keep legacy types for older UIs (safe)
    if (!seen.has(k)) { seen.add(k); base.push(s); }

    // ensure a structured type-grant exists (persistent → duration:'')
    const i = idxOfGrant(s);
    if (i < 0) {
      grants.push({ kind:'type', name:s, duration:'PERM' });
    }
  }

  raw.types  = base;
  raw.grants = grants;

  el.dataset.remoteAttrs = JSON.stringify(raw);
  try { window.Badges?.refreshFor?.(el.dataset.cid); } catch {}
}



// Spawner: use the same local spawn path as Zones → “Table” button
async function _spawnCopies(extraTypes){
  const src = _activeEl();
  if (!src) return;
  const qty = _getQty();

  const name   = src.dataset?.name || src.title || '';
  const img    = src.currentSrc || src.src || '';
  const origCid = src.dataset?.cid || null; // NEW: remember source cid

  for (let i=0; i<qty; i++){
    let spawned = null;
    try {
      spawned = window.CardPlacement?.spawnCardLocal?.({ name, img });
    } catch (e) { console.warn('[CopyTab] spawnCardLocal failed', e); }

    // Give DOM a moment to stamp data-cid on the new node (if created asynchronously)
    // This prevents selecting the original card in the fallback path.
    try { await new Promise(r => setTimeout(r, 10)); } catch {}

    // If spawnCardLocal returns the element and it's not the original, tag it now
    if (spawned && spawned instanceof Element) {
      if (!origCid || spawned.dataset?.cid !== origCid) {
        _addTypesToEl(spawned, extraTypes);
        continue; // done for this iteration
      }
      // else fall through to fallback search
    }

    // Fallback: pick the newest card with same name that is NOT the original
    try {
      const candidates = Array.from(document.querySelectorAll('img.table-card'))
        .filter(el =>
          (el.dataset?.name || el.title || '') === name &&
          (!origCid || el.dataset?.cid !== origCid)
        )
        .sort((a,b) => (b.dataset?.cid||'').localeCompare(a.dataset?.cid||'')); // newest first

      // Additionally prefer ones without a Copy/Token grant yet (optional)
      const pick = candidates.find(el => {
        try {
          const ra = el.dataset.remoteAttrs ? JSON.parse(el.dataset.remoteAttrs) : {};
          const hasGrant = Array.isArray(ra?.grants) && ra.grants.some(g => g?.kind === 'type' && (/^copy$/i.test(g?.name) || /^token$/i.test(g?.name)));
          return !hasGrant;
        } catch { return true; }
      }) || candidates[0];

      if (pick) _addTypesToEl(pick, extraTypes);
    } catch {}
  }
}

btnSpawn?.addEventListener('click', () => _spawnCopies(['Copy']));
btnSpawnToken?.addEventListener('click', () => _spawnCopies(['Copy','Token']));




    // Scope buttons → swap targeting mode (card list vs by-type) and maybe rebuild list
back.querySelectorAll('[data-scope]').forEach(btn => {
  btn.addEventListener('click', () => {
    const scope = btn.getAttribute('data-scope'); // mine | opp | both | deck | type
    STATE.lastScope = scope;                      // ← remember current scope

    const typeBlock = back.querySelector('[data-target-mode="typeBlock"]');
    const listBlock = back.querySelector('[data-target-mode="listBlock"]');

    if (scope === 'type') {
      if (typeBlock) typeBlock.style.display = 'block';
      if (listBlock) listBlock.style.display = 'none';
      return; // no checkbox list in type mode
    }

    if (typeBlock) typeBlock.style.display = 'none';
    if (listBlock) listBlock.style.display = 'block';
    rebuildTargets(scope); // will honor current filter drawer state
  });
});

// --- NEW: Filter drawer toggle + change wiring
const filterDrawer = back.querySelector('[data-filter-drawer]');
const filterBtn    = back.querySelector('[data-scope-filter="open"]');
if (filterBtn) {
  filterBtn.addEventListener('click', () => {
    if (!filterDrawer) return;
    const visible = filterDrawer.style.display !== 'none';
    filterDrawer.style.display = visible ? 'none' : 'block';
  });
}

// Keep "All" mutually exclusive with other filters; rebuild on any change
function _onFilterChanged(ev){
  if (!filterDrawer) return;
  const cbAll   = filterDrawer.querySelector('input[data-filter-kind="all"]');
  const others  = Array.from(filterDrawer.querySelectorAll('input[data-filter-kind]:not([data-filter-kind="all"])'));
  const kind    = ev?.target?.getAttribute?.('data-filter-kind');

  if (kind === 'all') {
    if (ev.target.checked) others.forEach(o => { o.checked = false; });
  } else {
    if (ev.target.checked && cbAll) cbAll.checked = false;
    // If none of the others are checked, fall back to All
    if (!others.some(o => o.checked)) { if (cbAll) cbAll.checked = true; }
  }

  // Rebuild the current list-only scopes (mine/opp/both); ignore when in type mode
  if (STATE.lastScope !== 'type') rebuildTargets(STATE.lastScope || 'mine');
}
if (filterDrawer) {
  filterDrawer.querySelectorAll('input[type="checkbox"][data-filter-kind]')
    .forEach(cb => cb.addEventListener('change', _onFilterChanged));
}

// --- NEW: Hide the Deck scope button (can bring back later)
const deckBtn = back.querySelector('[data-scope="deck"]');
if (deckBtn) deckBtn.style.display = 'none';









    back.querySelector('[data-scan="clear"]').addEventListener('click', () => {
      const box = back.querySelector('[data-scan="oracle"]');
      if (box) box.innerHTML = '';
      back.querySelector('[data-scan="detected"]').innerHTML = '';
      back.querySelector('[data-scan="actions"]').innerHTML = '';
    });


        // Apply tab: toggle → rebuild dynamic sections
    const effToggles = back.querySelector('[data-effect="toggles"]');
    effToggles?.addEventListener('change', rebuildEffectSections);
    // initial render: only PT visible by default
    rebuildEffectSections();

    // Delegate PT +/- so it continues to work across re-renders
    back.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-pt]');
      if (!btn) return;
      const kind = btn.getAttribute('data-pt');
      const root = STATE.root;
      const powI = root.querySelector('input[data-pt="pow"]');
      const touI = root.querySelector('input[data-pt="tou"]');
      if (kind === '+pow') powI.value = String((parseInt(powI.value||'0',10))+1);
      if (kind === '-pow') powI.value = String((parseInt(powI.value||'0',10))-1);
      if (kind === '+tou') touI.value = String((parseInt(touI.value||'0',10))+1);
      if (kind === '-tou') touI.value = String((parseInt(touI.value||'0',10))-1);
    });


    // Apply tab: targets are populated dynamically via rebuildTargets(scope).
    // (Default first build happens from openForCard → rebuildTargets('mine'))


        // Footer Apply: context sensitive
    back.querySelector('[data-act="apply-root"]').addEventListener('click', ()=>{
      const tab = STATE.activeTab;
      if (tab === 'apply') {
        applyFromApplyTab(); // central handler
      } else if (tab === 'scan') {
        // Optional: rescan or simply close; keeping as a no-op for now
        console.log('[Footer Apply] (scan) no-op');
      } else if (tab === 'active') {
        console.log('[Footer Apply] (active) no-op');
      } else if (tab === 'manage') {
        console.log('[Footer Apply] (manage) no-op');
      }
    });
	
	
	// ---- GRANTS helpers (upsert / remove by name, case-insensitive) ----
function _ensureGrantsArray(rec){
  if (!Array.isArray(rec.grants)) rec.grants = [];
  return rec.grants;
}

// NEW: normalized key for ability-name comparisons (strips "(EOT)" etc.)
function _normalizeAbilityKey(s){
  return String(s || '')
    .replace(/\s*\(.*?\)\s*$/,'')  // drop trailing parenthetical like "(EOT)"
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();
}

// NEW: normalized key for type-name comparisons (case-insensitive)
function _normalizeTypeKey(s){
  return String(s || '')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();
}


function _upsertGrant(rec, name, duration, source){
  if (!name) return;
  const grants = _ensureGrantsArray(rec);
  const key = _normalizeAbilityKey(name);
  const row = { name: String(name).trim(), duration: String(duration||'').toUpperCase(), kind:'ability' };
  if (source) row.source = String(source);
  const i = grants.findIndex(g => _normalizeAbilityKey(g?.name||'') === key && (g?.kind||'ability') === 'ability');
  if (i >= 0) grants[i] = row; else grants.push(row);
}

// NEW: upsert for TYPE grants (mirrors ability grants)
function _upsertTypeGrant(rec, name, duration, source){
  if (!name) return;
  const grants = _ensureGrantsArray(rec);
  const key = _normalizeTypeKey(name);
  const row = { name: String(name).trim(), duration: String(duration||'').toUpperCase(), kind:'type' };
  if (source) row.source = String(source);
  const i = grants.findIndex(g => _normalizeTypeKey(g?.name||'') === key && (g?.kind||'type') === 'type');
  if (i >= 0) grants[i] = row; else grants.push(row);
}


function _removeGrantByName(rec, name){
  if (!Array.isArray(rec?.grants)) return;
  const key = _normalizeAbilityKey(name||'');
  rec.grants = rec.grants.filter(g => _normalizeAbilityKey(g?.name||'') !== key);
}

	
	// sync a payload's effects directly into DOM datasets + CardAttributes +
// ALSO mirror into el.dataset.remoteAttrs so Badges.getGrantedFromStore()
// can ALWAYS see granted abilities/types/pt immediately.
// then force Badges / Tooltip to redraw right now (local OR remote).
function applyBuffLocally(payload){
  if (!payload) return;
// De-dupe: ignore the same transaction twice on this client
window.__SeenBuffTxnIds = window.__SeenBuffTxnIds || new Set();
if (payload.txnId && window.__SeenBuffTxnIds.has(payload.txnId)) {
  console.log('[applyBuffLocally] skip duplicate txnId', payload.txnId);
  return;
}
if (payload.txnId) window.__SeenBuffTxnIds.add(payload.txnId);

  // Support both shapes:
  //  - payload.targets = ['c_x','c_y',...]
  //  - payload.targetCid = 'c_x'
  let targetList = [];
  if (Array.isArray(payload.targets) && payload.targets.length) {
    targetList = payload.targets.slice();
  } else if (payload.targetCid) {
    targetList = [ payload.targetCid ];
  }

  if (!targetList.length) {
    console.warn('[applyBuffLocally] no targets in payload', payload);
    return;
  }

  const enabledPT    = !!payload.pt;
  const powDelta     = enabledPT ? (parseInt(payload.pt?.powDelta || '0',10)) : 0;
  const touDelta     = enabledPT ? (parseInt(payload.pt?.touDelta || '0',10)) : 0;

  // raw user text
  const grantAbilityRaw = payload.ability || '';
  const grantTypeRaw    = payload.typeAdd || '';

  // normalize ability text a bit: "Firststrike" -> "First Strike"
  // (panel later .toUpperCase() first letters anyway, but let's be nice)
  function normalizeAbility(str){
    const s = String(str || '').trim();
    if (!s) return '';
    // insert space between "Firststrike" style camel/compound if missing
    // super cheap heuristic: split on capital letters
    // but don't go too wild — just return capitalized words
    return s
      .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase -> camel Case
      .replace(/\s+/g,' ')
      .replace(/^\s+|\s+$/g,'')
      .replace(/\b\w/g, m => m.toUpperCase());
  }

  function normalizeType(str){
    const s = String(str || '').trim();
    if (!s) return '';
    return s.replace(/\s+/g,' ').trim().replace(/\b\w/g, m => m.toUpperCase());
  }

  const grantAbilityNorm = normalizeAbility(grantAbilityRaw);
  const grantTypeNorm    = normalizeType(grantTypeRaw);

  for (const cid of targetList){
    const sel = `img.table-card[data-cid="${cid}"]`;
    const el  = document.querySelector(sel);
    if (!el) {
      console.warn('[applyBuffLocally] no DOM card for cid', cid, sel);
      continue;
    }

    // --- figure out current visible PT BEFORE buff
    const baseP = Number(el.dataset.power || 0);
    const baseT = Number(el.dataset.toughness || 0);

    const curStr = el.dataset.ptCurrent || `${baseP}/${baseT}`;
    const parts  = curStr.split('/');
    const curP   = Number(parts[0] || baseP || 0);
    const curT   = Number(parts[1] || baseT || 0);

    // --- apply deltas if we toggled PT
    const newP = enabledPT ? (curP + powDelta) : curP;
    const newT = enabledPT ? (curT + touDelta) : curT;

    // stash new PT into dataset so Badges.livePT() can read it
    el.dataset.ptCurrent = `${newP}/${newT}`;

 // --- sync CardAttributes backing store AND collect merged arrays
let mergedAbilities = [];
let mergedTypes     = [];
let mergedCounters  = []; // NEW
let mergedGrants    = []; // NEW
try {
  const CA = window.CardAttributes;
  if (CA && typeof CA.get === 'function') {
    const rec = CA.get(cid) || {};
    rec.pow = newP;
    rec.tou = newT;

    // abilities
    rec.abilities = Array.isArray(rec.abilities) ? rec.abilities.slice() : [];
    if (grantAbilityNorm){
      if (!rec.abilities.includes(grantAbilityNorm)) {
        rec.abilities.push(grantAbilityNorm);
      }
    }

    // NEW: structured grants (for display-only suffixes E/L and source peek)
    // Keep storage of abilities the same; add a parallel "grants" list.
    rec.grants = Array.isArray(rec.grants) ? rec.grants.slice() : [];
    if (grantAbilityNorm && payload && (payload.duration || payload.abilityDuration)) {
      const dur = (payload.abilityDuration || payload.duration || '').toUpperCase(); // 'EOT' | 'SOURCE' | 'PERM'
      const src = payload.srcCid || payload.sourceCid || null;
      // upsert instead of push → avoids duplicate "(E)/(L)" rows for same ability
      _upsertGrant(rec, grantAbilityNorm, dur, src);
    }

    // Safety: if some other path removed the ability, prune stale grants.
    if (Array.isArray(rec.grants) && Array.isArray(rec.abilities)) {
      const abilSet = new Set(rec.abilities.map(a => _normalizeAbilityKey(a)));
      rec.grants = rec.grants.filter(g => abilSet.has(_normalizeAbilityKey(g?.name||'')));
    }

    // types: keep ONLY the printed/base types here.
// Do NOT echo granted types into rec.types[] (prevents duplicate badges).
rec.types = Array.isArray(rec.types) ? rec.types.slice() : [];

// Record granted type solely as a structured grant row.
if (grantTypeNorm){
  const dur = (payload.typeDuration || payload.duration || '').toUpperCase(); // 'EOT' | 'SOURCE' | 'PERM'
  const src = payload.srcCid || payload.sourceCid || null;
  if (dur) _upsertTypeGrant(rec, grantTypeNorm, dur, src);
}

// (No pruning of type grants based on rec.types — grants are authoritative.)




    // counters (merge/SET ABSOLUTE); payload.counter = { kind, qty }
    // Build a union from CA.counters and remoteAttrs.counters so we never wipe
    // counters that only existed in the dataset mirror from older overlays.
    function _readRemoteCountersSafe(node){
      try {
        const ro = node?.dataset?.remoteAttrs ? JSON.parse(node.dataset.remoteAttrs) : null;
        return Array.isArray(ro?.counters) ? ro.counters.slice() : [];
      } catch { return []; }
    }
    function _mergeCountersUnion(aList, bList){
      const byKind = new Map();
      [...(aList||[]), ...(bList||[])].forEach(c=>{
        if (!c) return;
        const k = String(c.kind || c.name || '').trim();
        if (!k) return;
        byKind.set(k.toLowerCase(), { kind:k, qty: Number(c.qty||0) });
      });
      return Array.from(byKind.values());
    }

    const remoteCounters = _readRemoteCountersSafe(el);
    const baseCounters   = _mergeCountersUnion(
      Array.isArray(rec.counters) ? rec.counters : [],
      remoteCounters
    );

    // Apply the ONE change as an absolute target value
    let nextCounters = baseCounters;
    if (payload.counter && payload.counter.kind){
      const kind = String(payload.counter.kind).trim();
      let qty    = parseInt(payload.counter.qty || 0, 10);
      if (kind && Number.isFinite(qty)){
        const kLc = kind.toLowerCase();
        const idx = nextCounters.findIndex(c => String(c.kind||'').toLowerCase() === kLc);
        if (qty <= 0){
          if (idx >= 0) nextCounters.splice(idx, 1);
        } else {
          const entry = { kind, qty };
          if (idx >= 0) nextCounters[idx] = entry;
          else nextCounters.push(entry);
        }

        // loyalty convenience…
        if (kLc === 'loyalty'){
          if (qty <= 0){
            const baseL = parseInt(el.dataset.loyalty || '0', 10) || 0;
            el.dataset.loyaltyCurrent = String(baseL);
          } else {
            el.dataset.loyaltyCurrent = String(qty);
          }
        }
      }
    }

    // commit back onto the record
    rec.counters = nextCounters;

    // write back (Map-style .set OR plain object fallback)
    if (typeof CA.set === 'function') {
      CA.set(cid, rec);
    } else {
      CA[cid] = rec;
    }

    mergedAbilities = rec.abilities.slice();
    mergedTypes     = rec.types.slice();
    mergedCounters  = rec.counters.slice();
    mergedGrants    = Array.isArray(rec.grants) ? rec.grants.slice() : [];
  } else {
    // no CardAttributes? fall back to payload-only merges
    if (grantAbilityNorm) mergedAbilities.push(grantAbilityNorm);
// Do NOT push grantType into mergedTypes (keep it only as a grant)
    if (payload.counter && payload.counter.kind) {
      mergedCounters.push({ kind:String(payload.counter.kind).trim(), qty:parseInt(payload.counter.qty||0,10) });
      if (String(payload.counter.kind).toLowerCase() === 'loyalty') {
        const curL = parseInt(el.dataset.loyaltyCurrent || el.dataset.loyalty || '0', 10) || 0;
        el.dataset.loyaltyCurrent = String(curL + (parseInt(payload.counter.qty||0,10) || 0));
      }
    }

    // ⬇ NEW: still record a structured grant so Badges can render "(L)" / "(E)"
const dur = String(payload.abilityDuration || payload.duration || '').toUpperCase();
const src = payload.srcCid || payload.sourceCid || null;
if (grantAbilityNorm && dur) {
  mergedGrants.push({ kind:'ability', name: grantAbilityNorm, duration: dur, source: src });
}
const durType = String(payload.typeDuration || payload.duration || '').toUpperCase();
if (grantTypeNorm && durType) {
  mergedGrants.push({ kind:'type', name: grantTypeNorm, duration: durType, source: src });
}
  }

} catch(err){
  console.warn('[applyBuffLocally] CardAttributes sync fail for', cid, err);
  if (grantAbilityNorm) mergedAbilities.push(grantAbilityNorm);
  if (grantTypeNorm)    mergedTypes.push(grantTypeNorm);
  if (payload.counter && payload.counter.kind) {
    mergedCounters.push({ kind:String(payload.counter.kind).trim(), qty:parseInt(payload.counter.qty||0,10) });
  }
}


    // --- MIRROR to dataset.remoteAttrs so Badges.getGrantedFromStore()
    // can ALWAYS see these new granted abilities/types immediately.
    // We merge with any existing remoteAttrs instead of nuking it.
    try {
      let remoteObj = {};
try { remoteObj = el.dataset.remoteAttrs ? (JSON.parse(el.dataset.remoteAttrs) || {}) : {}; } catch { remoteObj = {}; }

// Take the canonical values we just computed/updated, but UNION with any existing remote arrays
// so multiple applies don't clobber previous grants when CardAttributes is absent.
function _unionCaseInsensitive(a, b){
  const seen = new Set();
  const out = [];
  [...(a||[]), ...(b||[])].forEach(v => {
    const s = String(v || '').trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  });
  return out;
}

let prevRemote = {};
try { prevRemote = el.dataset.remoteAttrs ? (JSON.parse(el.dataset.remoteAttrs) || {}) : {}; } catch {}

const prevAbilities = Array.isArray(prevRemote.abilities) ? prevRemote.abilities : [];
const prevTypes     = Array.isArray(prevRemote.types)     ? prevRemote.types     : [];

const nextAbilities = _unionCaseInsensitive(prevAbilities, mergedAbilities.slice());
let   nextTypes     = _unionCaseInsensitive(prevTypes,     mergedTypes.slice());



// mergedCounters already includes the union we stored in rec.counters above.
// But to be belt-and-suspenders, union again with any existing remote counters.
function _unionCounters(a,b){
  const byKind = new Map();
  [...(a||[]), ...(b||[])].forEach(c=>{
    if (!c) return;
    const k = String(c.kind || c.name || '').trim();
    if (!k) return;
    byKind.set(k.toLowerCase(), { kind:k, qty:Number(c.qty||0) });
  });
  return Array.from(byKind.values());
}
let prevRemote2 = prevRemote;
const prevCounters = Array.isArray(prevRemote2.counters) ? prevRemote2.counters : [];

// NEW should overwrite OLD, so list OLD first, then NEW:
const nextCounters = _unionCounters(prevCounters, mergedCounters.slice());


const ptStr = `${newP}/${newT}`;

// Merge any previous grants (if the opponent applied something first)
let prevGrants = [];
try {
  const prev = el.dataset.remoteAttrs ? JSON.parse(el.dataset.remoteAttrs) : null;
  if (Array.isArray(prev?.grants)) prevGrants = prev.grants.slice();
} catch {}

let nextGrants = prevGrants.slice();

// merge in any newly created grants (for builds without CardAttributes)
const byName = new Map(nextGrants.map(g => [_normalizeAbilityKey(g?.name||''), g]));
mergedGrants.forEach(g => {
  if (!g || !g.name) return;
  byName.set(_normalizeAbilityKey(g.name), {
    name: g.name,
    duration: String(g.duration||'').toUpperCase(),
    source: g.source ?? null
  });
});

// if CardAttributes exists, let it win as the authoritative copy
try {
  const CA = window.CardAttributes;
  const row = CA?.get?.(cid);
  if (row && Array.isArray(row.grants)) {
    row.grants.forEach(g => {
      if (!g || !g.name) return;
      byName.set(_normalizeAbilityKey(g.name), g);
    });
  }
} catch {}

nextGrants = Array.from(byName.values());

// SCRUB: ensure grant types are NOT duplicated in base types array.
// If a type exists as a grant, remove it from nextTypes so only the (E)/(L) chip shows.
try {
  const grantTypeSet = new Set(
    nextGrants
      .filter(g => (g?.kind||'') === 'type' && g?.name)
      .map(g => _normalizeTypeKey(g.name))
  );
  nextTypes = nextTypes.filter(t => !grantTypeSet.has(_normalizeTypeKey(t)));
} catch {}


el.dataset.remoteAttrs = JSON.stringify({
  abilities: nextAbilities,
  types:     nextTypes,
  counters:  nextCounters,
  pt:        ptStr,
  // NEW
  grants:    nextGrants
});



    } catch(err){
      console.warn('[applyBuffLocally] remoteAttrs sync fail for', cid, err);
    }

    // --- force redraw NOW on that element
    try {
      // badges panel + sticker refresh
      if (window.Badges?.render) {
        window.Badges.render(el);
      } else if (window.Badges?.refreshFor) {
        window.Badges.refreshFor(cid);
      }

      // tooltip refresh if visible
      if (window.Tooltip?.refreshFor) {
        window.Tooltip.refreshFor(cid);
      } else if (window.Tooltip?.showForCard) {
        window.Tooltip.showForCard(el, el, { mode:'right' });
      }
    } catch(err){
      console.warn('[applyBuffLocally] redraw fail for', cid, err);
    }
  }
}


// expose so rtc.bus.js can call it
window.CardOverlayUI = window.CardOverlayUI || {};
window.CardOverlayUI.applyBuffLocally = applyBuffLocally;

function _hasTypeCaseInsensitive(arr, typeName){
  if (!typeName) return false;
  const want = String(typeName).trim().toLowerCase();
  return Array.isArray(arr) && arr.some(t => String(t||'').trim().toLowerCase() === want);
}

function collectTargetsByType(){
  const root = STATE.root;
  if (!root) return [];

  // read UI
  const typeName = root.querySelector('input[data-bytype="name"]')?.value.trim() || '';
  if (!typeName) {
    console.warn('[ByType] empty type name');
    return [];
  }
  const sel = root.querySelector('input[name="bytype-scope"]:checked');
  const scope = sel?.value || 'both'; // mine | opp | both
  const includeSrc = !!root.querySelector('input[data-bytype="includeSource"]')?.checked;

  const me = getMySeat();
  const all = collectTableCards();
  const picked = [];

  for (const r of all){
    // owner filter
    if (scope === 'mine' && Number(r.owner) !== me) continue;
    if (scope === 'opp'  && Number(r.owner) === me) continue;

    // EXCLUDE source unless the checkbox is ON
    if (!includeSrc && STATE.activeCid && r.cid === STATE.activeCid) continue;

    // types from badges debug (preferred)
    let types = [];
    try {
      const dbg = (r.cid && window.badgesForCid) ? window.badgesForCid(r.cid) : null;
      if (dbg && Array.isArray(dbg.types)) types = dbg.types.slice();
    } catch {}

    // fallback: parse from typeLine in dataset if needed
    if (!types.length && r.el?.dataset?.typeLine){
      const tl = String(r.el.dataset.typeLine);
      const m = tl.split('—')[1] || '';
      types = m.split(/[\s-]+/).map(s => s.trim()).filter(Boolean);
    }

    if (_hasTypeCaseInsensitive(types, typeName)){
      picked.push(r.cid);
    }
  }

  // If checkbox is ON and source matches filters, ensure it's included once
  if (includeSrc && STATE.activeCid && !picked.includes(STATE.activeCid)){
    try {
      const el = document.querySelector(`img.table-card[data-cid="${STATE.activeCid}"]`);
      if (el){
        const owner = Number(el.dataset.owner || NaN);
        const ownerOk =
          (scope === 'mine' && owner === me) ||
          (scope === 'opp'  && owner !== me) ||
          (scope === 'both');

        if (ownerOk){
          let srcTypes = [];
          try { const dbgS = window.badgesForCid?.(STATE.activeCid); if (dbgS?.types) srcTypes = dbgS.types.slice(); } catch {}
          if (!srcTypes.length && el?.dataset?.typeLine){
            const tl = String(el.dataset.typeLine);
            const m = tl.split('—')[1] || '';
            srcTypes = m.split(/[\s-]+/).map(s => s.trim()).filter(Boolean);
          }
          if (_hasTypeCaseInsensitive(srcTypes, typeName)) picked.push(STATE.activeCid);
        }
      }
    } catch {}
  }

  return picked;
}



       function applyFromApplyTab(){
      // 1. Collect targets based on current scope
let targets = [];
if (STATE.lastScope === 'type') {
  targets = collectTargetsByType();
} else {
  targets = Array
    .from(STATE.root.querySelectorAll('[data-apply="list"] input[type="checkbox"]:checked'))
    .map(cb => cb.getAttribute('data-target-cid'))
    .filter(Boolean);
}

if (!targets.length){
  console.warn('[OverlayApply] no targets selected for scope:', STATE.lastScope);
  return;
}


      // 2. Which effect types are toggled on?
      const toggles = Array.from(
        STATE.root.querySelectorAll('[data-effect="toggles"] input[type="checkbox"]')
      );
      const enabled = new Set(
        toggles.filter(i=>i.checked).map(i=>i.getAttribute('data-eff'))
      );

      // 3. Read numeric P/T deltas
      const powDelta = parseInt(STATE.root.querySelector('input[data-pt="pow"]')?.value || '0', 10);
      const touDelta = parseInt(STATE.root.querySelector('input[data-pt="tou"]')?.value || '0', 10);

      // 4. Read granted ability / type text
      const grantAbility = STATE.root.querySelector('input[data-apply="ability"]')?.value.trim() || '';
      const grantType    = STATE.root.querySelector('input[data-apply="grantType"]')?.value.trim() || '';

      // 5. Read counters
      const counterKind  = STATE.root.querySelector('input[data-apply="counterKind"]')?.value.trim() || '';
      const counterQty   = parseInt(STATE.root.querySelector('input[data-apply="counterQty"]')?.value || '1', 10);

      // 6. Duration radio → 'EOT' | 'SOURCE' | 'PERM'
      const durRadios = Array.from(STATE.root.querySelectorAll('input[name="dur"]'));
      let duration = 'EOT';
      const checkedIdx = durRadios.findIndex(r => r.checked);
      if (checkedIdx === 1) duration = 'SOURCE';
      if (checkedIdx === 2) duration = 'PERM';

      // 7. Source card = the card whose wand overlay we opened
      const srcCid = STATE.activeCid || null;

      // 8. Who applied this (seat)? (used for EOT cleanup per player)
      const ownerSeat = (typeof window.mySeat === 'function') ? window.mySeat() : 1;

      // 9. Build the canonical payload for RulesStore / RTC / local sync
      const payload = {
  // idempotency guard
  txnId: (crypto?.randomUUID ? crypto.randomUUID() : (Date.now() + ':' + Math.random().toString(36).slice(2))),
  srcCid,
  ownerSeat,
  duration,
  pt: (enabled.has('pt') ? { powDelta, touDelta } : null),
  ability: (enabled.has('ability') && grantAbility) ? grantAbility : null,
  typeAdd: (enabled.has('type') && grantType) ? grantType : null,
  counter: (enabled.has('counters') && counterKind)
    ? { kind: counterKind, qty: counterQty }
    : null,
  targets
};


      console.log('[OverlayApply] committing payload:', payload);

      // 10. FIRST: apply it LOCALLY so badges/PT update instantly on my screen.
      try {
        if (window.CardOverlayUI?.applyBuffLocally) {
          window.CardOverlayUI.applyBuffLocally(payload);
        }
      } catch (err){
        console.warn('[OverlayApply] local applyBuffLocally failed', err);
      }

      // 11. THEN broadcast via RTC / RulesStore so opponent mirrors it.
      try {
        RTCApply.broadcastBuff(payload);
      } catch (err){
        console.warn('[OverlayApply] RTC broadcastBuff failed', err);
      }
    }




window.CardOverlayUI = window.CardOverlayUI || {};
window.CardOverlayUI.applyBuffLocally = applyBuffLocally;

// --- Local effect removal helper: strip ability/type/counter from a single card ---
function removeEffectLocally(cardCid, effect){
  try{
    if (!cardCid || !effect) return;
    const el = document.querySelector(`img.table-card[data-cid="${cardCid}"]`);
    const CA = window.CardAttributes;

    // --- Normalize key for comparison ---
    const key = effect.ability ? _normalizeAbilityKey(effect.ability) : null;
    const keyType = effect.typeAdd ? String(effect.typeAdd).trim().toLowerCase() : null;
    const keyCounter = effect.counter?.kind ? String(effect.counter.kind).trim().toLowerCase() : null;

    // --- Pull record ---
    const rec = (CA && typeof CA.get === 'function')
      ? (CA.get(cardCid) || {})
      : (window.CardAttributes?.[cardCid] || {});

    // ---------- ABILITIES ----------
    if (key && Array.isArray(rec.abilities)){
      rec.abilities = rec.abilities.filter(a => _normalizeAbilityKey(a) !== key);
    }

    // ---------- GRANTS ----------
if (Array.isArray(rec.grants)){
  // ability grants
  if (key){
    rec.grants = rec.grants.filter(g => !((g?.kind||'ability')==='ability' && _normalizeAbilityKey(g?.name||'') === key));
  }
  // NEW: type grants
  if (keyType){
    rec.grants = rec.grants.filter(g => !((g?.kind||'type')==='type' && _normalizeTypeKey(g?.name||'') === keyType));
  }
  if (rec.grants.length === 0) delete rec.grants;
}


    // ---------- TYPES ----------
    if (keyType && Array.isArray(rec.types)){
      rec.types = rec.types.filter(t => String(t).trim().toLowerCase() !== keyType);
    }

    // ---------- COUNTERS ----------
    if (keyCounter && Array.isArray(rec.counters)){
      rec.counters = rec.counters.filter(c => String(c?.kind||c?.name||'').toLowerCase() !== keyCounter);
    }

    // ---------- WRITE BACK CARDATTRIBUTES ----------
    if (CA && typeof CA.set === 'function'){
      CA.set(cardCid, rec);
    } else {
      window.CardAttributes = window.CardAttributes || {};
      window.CardAttributes[cardCid] = rec;
    }

    // ---------- MIRROR TO dataset.remoteAttrs (THE IMPORTANT PART) ----------
    if (el){
      let remote = {};
      try { remote = JSON.parse(el.dataset.remoteAttrs || '{}'); } catch {}

      // Normalize all arrays
      const abilities = Array.isArray(rec.abilities) ? rec.abilities.slice() : [];
      const types     = Array.isArray(rec.types)     ? rec.types.slice()     : [];
      const counters  = Array.isArray(rec.counters)  ? rec.counters.slice()  : [];
      let   grants    = Array.isArray(rec.grants)    ? rec.grants.slice()    : [];

      // **ALWAYS nuke matching grants in remoteAttrs, even if rec.grants is missing**
if (Array.isArray(remote.grants)){
  // ability grants
  if (key){
    remote.grants = remote.grants.filter(g => !((g?.kind||'ability')==='ability' && _normalizeAbilityKey(g?.name||'') === key));
  }
  // NEW: type grants
  if (keyType){
    remote.grants = remote.grants.filter(g => !((g?.kind||'type')==='type' && _normalizeTypeKey(g?.name||'') === keyType));
  }
}


      // **ALWAYS nuke abilities in remoteAttrs if mirrored**
      if (key && Array.isArray(remote.abilities)){
        remote.abilities = remote.abilities.filter(a => _normalizeAbilityKey(a) !== key);
      }

      // Rebuild final remote object
      const pt = el.dataset.ptCurrent || `${el.dataset.power||0}/${el.dataset.toughness||0}`;
      el.dataset.remoteAttrs = JSON.stringify({
        abilities,
        types,
        counters,
        pt,
        grants: remote.grants || grants || []
      });
    }

    // ---------- NUKE BADGE CACHE ----------
    try {
      if (window.Badges?.invalidateFor) {
        window.Badges.invalidateFor(cardCid);
      } else if (window.Badges && window.Badges._cache && typeof window.Badges._cache.delete === 'function') {
        window.Badges._cache.delete(cardCid);
      } else if (window.badgesForCidCache && typeof window.badgesForCidCache.delete === 'function') {
        window.badgesForCidCache.delete(cardCid);
      }
    } catch {}

    // ---------- RERENDER ----------
    try { window.Badges?.refreshFor?.(cardCid); } catch {}
    try { window.Tooltip?.refreshFor?.(cardCid); } catch {}

    try {
      window.dispatchEvent(new CustomEvent('card-attrs-changed', { detail:{ cid: cardCid }}));
    } catch {}

  } catch(e){
    console.warn('[removeEffectLocally] failed', e, {cardCid, effect});
  }
}




        // ---------------- ACTIVE TAB (live effects / remove) ----------------

    // track filter state for Active tab: 'both' | 'mine' | 'opp'
    let activeFilter = 'both';

    // helper to normalize effect → a "signature" so we can de-dupe kinds
    function _effectSignature(e){
      try{
        const type = String(e?.type || '').toLowerCase();
        const rawLabel = String(e?.label || '').trim();
        const labelNoDur = rawLabel.replace(/\s*\(.*?\)\s*$/,'').trim(); // strip "(EOT)" / "(SOURCE)" / "(PERM)"

        // 0) If the effect carries explicit fields, prefer those.
        if (type === 'counter' || /counter/i.test(e?.type || '')){
          const kind = (e?.counter?.kind || e?.kind || '').toString().trim();
          if (kind) return `counter:${kind.toLowerCase()}`;
        }
        if (type === 'ability' || e?.ability){
          const a = (e?.ability || '').toString().trim();
          if (a) return `ability:${a.toLowerCase()}`;
        }
        if (type === 'type' || e?.typeAdd){
          const t = (e?.typeAdd || '').toString().trim();
          if (t) return `type:${t.toLowerCase()}`;
        }

        // 1) LABEL-ONLY INFERENCE FALLBACKS

        // 1a) PT / counters: "+1/+1", "-2/-2", etc.
        const mPT = labelNoDur.match(/^[+\-]?\d+\s*\/\s*[+\-]?\d+\s*(?:x\s*\d+)?$/i);
        if (mPT){
          // keep kind as the PT part only, drop xN
          const kind = labelNoDur.replace(/\s*x\s*\d+\s*$/i,'').trim();
          return `counter:${kind.toLowerCase()}`;
        }

        // 1b) Explicit "counter" word in label → extract kind before the word "counter"
        if (/counter/i.test(rawLabel)){
          const mKind = labelNoDur.match(/([+\-]?\d+\s*\/\s*[+\-]?\d+|[A-Za-z][A-Za-z +/+-]*?)\s*(?:x\s*\d+)?\s*$/);
          const kind = (mKind?.[1] || '').trim();
          if (kind) return `counter:${kind.toLowerCase()}`;
        }

        // 1c) Type-add like "+Elf", "+Zombie", "+Artifact"
        if (/^\+/.test(labelNoDur)){
          const t = labelNoDur.replace(/^\+\s*/,'').trim();
          if (t) return `type:${t.toLowerCase()}`;
        }

        // 1d) Ability: a simple word/phrase like "Deathtouch", "Flying", "Hexproof"
        // We allow spaces (e.g., "First strike") and slashes not present → avoid PT here.
        const isLikelyAbility =
          !!labelNoDur &&
          !/[\/]/.test(labelNoDur) &&    // avoid PT false-positive
          !/^\+/.test(labelNoDur) &&     // not a type-add
          !/\bcounter\b/i.test(rawLabel);// not counters

        if (isLikelyAbility){
          return `ability:${labelNoDur.toLowerCase()}`;
        }

        // Last resort: keep label bucket (will still get handled in removal by parsing)
        return `label:${rawLabel.toLowerCase()}`;
      }catch{
        return 'unknown';
      }
    }


    // newest-first compare: prefer .ts, else .id lexical, else array order
    function _isNewer(a,b){
      const ta = Number(a?.ts || 0), tb = Number(b?.ts || 0);
      if (ta !== tb) return ta > tb;
      const ia = String(a?.id||''), ib = String(b?.id||'');
      if (ia && ib && ia !== ib) return ia > ib;
      return true;
    }

    // Remove all effects on a card that match a signature, and also
    // update CardAttributes + dataset.remoteAttrs so badges drop.
    function _removeAllBySignature(cardCid, signature, latestEffSnapshot){
      // 1) collect all matching effect ids for that card (from current list)
      let ids = [];
      let latestForSig = latestEffSnapshot || null;
      try {
        const row = (RulesStore.listActiveEffectsGroupedByCard?.(null) || [])
          .find(r => String(r.cid) === String(cardCid));
        if (row && Array.isArray(row.effects)){
          const matches = row.effects.filter(e => _effectSignature(e) === signature);
          ids = matches.map(e => e.id).filter(Boolean);
          // keep the newest snapshot for label parsing below
          latestForSig = matches.sort((a,b)=>{
            const ta = Number(a?.ts||0), tb = Number(b?.ts||0);
            if (ta !== tb) return tb - ta;
            const ia = String(a?.id||''), ib = String(b?.id||'');
            return ia > ib ? -1 : ia < ib ? 1 : 0;
          })[0] || latestForSig;
        }
      } catch(e) { console.warn('[ActiveTab] signature collect failed', e); }

      // 2) remove from RulesStore (ALL versions)
      ids.forEach(id => {
        try { RulesStore.removeEffect?.(id); } catch(err){
          console.warn('[ActiveTab] removeEffect failed', id, err);
        }
      });

       // 3) also strip local attributes/counters mirror so badges clear
  const removeShape = {};
  if (signature.startsWith('counter:')){
    const kind = signature.slice('counter:'.length);
    removeShape.counter = { kind, qty: 0 }; // qty 0 → remove that counter-kind
  } else if (signature.startsWith('ability:')){
    const rawLbl = String(latestEffSnapshot?.label || '').replace(/^grant\s+/i,'').trim();
    const clean  = rawLbl.replace(/\s*\(.*\)\s*$/,'').trim(); // strip "(EOT)" etc.
    removeShape.ability = latestEffSnapshot?.ability || clean || signature.slice('ability:'.length);
  } else if (signature.startsWith('type:')){
    removeShape.typeAdd = latestEffSnapshot?.typeAdd || String(latestEffSnapshot?.label||'').trim() || signature.slice('type:'.length);
  }
  try { removeEffectLocally(cardCid, removeShape); } catch(e){
    console.warn('[ActiveTab] removeEffectLocally failed', e, {cardCid, removeShape});
  }

  // 4) repaint that card’s badges (after cache invalidation done inside removeEffectLocally)
  try{
    const cardEl = document.querySelector(`img.table-card[data-cid="${cardCid}"]`);
    if (cardEl){
      if (window.Badges?.render) window.Badges.render(cardEl);
      else if (window.Badges?.refreshFor) window.Badges.refreshFor(cardCid);
    }
  }catch(err){ console.warn('[ActiveTab] badge refresh fail', err); }

  // 5) notify opponent (coarse-grain: send each id we actually removed)
  try{
    const removedAbilityName  =
      removeShape.ability ||
      (signature.startsWith('ability:') ? signature.slice('ability:'.length) : null);

    const removedCounterKind  =
      removeShape.counter?.kind ||
      (signature.startsWith('counter:') ? signature.slice('counter:'.length) : null);

    const removedTypeName     =
      removeShape.typeAdd ||
      (signature.startsWith('type:') ? signature.slice('type:'.length) : null);

    const removedPtOverride   = null;

    ids.forEach(effectId => {
      window.rtcSend?.({
        type: 'buffRemove',
        effectId,
        targetCid: cardCid,
        signature,
        ability: removedAbilityName || null,
        counter: removedCounterKind || null,
        typeName: removedTypeName || null,
        pt: removedPtOverride
      });
    });
  }catch(err){ console.warn('[ActiveTab] rtcSend buffRemove failed', err); }


      // 6) notify opponent (coarse-grain: send each id we actually removed)
      try{
        const removedAbilityName =
          removeShape.ability ||
          (signature.startsWith('ability:') ? signature.slice('ability:'.length) : null);

        const removedCounterKind =
          removeShape.counter?.kind ||
          (signature.startsWith('counter:') ? signature.slice('counter:'.length) : null);

        const removedTypeName =
          removeShape.typeAdd ||
          (signature.startsWith('type:') ? signature.slice('type:'.length) : null);

        const removedPtOverride = null; // PT removal not batched via signature in this UI

        ids.forEach(effectId => {
          window.rtcSend?.({
            type: 'buffRemove',
            effectId,
            targetCid: cardCid,
            signature,
            ability: removedAbilityName || null,
            counter: removedCounterKind || null,
            typeName: removedTypeName || null,
            pt: removedPtOverride
          });
        });
      }catch(err){ console.warn('[ActiveTab] rtcSend buffRemove failed', err); }
    }



    // helper to re-render the Active tab list from RulesStore (de-duped by "latest per kind")
    function refreshActiveTab(){
      const host = back.querySelector('[data-active="list"]');
      if (!host) return;
      host.innerHTML = '';

      // seat filter
      let seatFilter = null;
      try {
        const me = Number(window.mySeat?.() ?? 1);
        if (activeFilter === 'mine'){ seatFilter = me; }
        else if (activeFilter === 'opp'){ seatFilter = (me === 1 ? 2 : 1); }
        else { seatFilter = null; }
      } catch { seatFilter = null; }

      // fetch rows
      let rows = [];
      try {
        rows = RulesStore.listActiveEffectsGroupedByCard
          ? RulesStore.listActiveEffectsGroupedByCard(seatFilter)
          : [];
      } catch(err){
        console.warn('[ActiveTab] listActiveEffectsGroupedByCard failed', err);
        rows = [];
      }

      if (!rows.length){
        const empty = document.createElement('div');
        empty.className = 'mut';
        empty.textContent = 'No active effects.';
        host.appendChild(empty);
        return;
      }

      // Build UI per card with de-dupe: keep only newest per signature
      rows.forEach(cardRow => {
        const wrap = document.createElement('div');
        wrap.className = 'group';

        const header = document.createElement('div');
        header.className = 'label';
        header.textContent = cardRow.name || cardRow.cid || 'Card';
        wrap.appendChild(header);

        // Group effects by signature, keep newest
        const bySig = new Map();
        (cardRow.effects || []).forEach(e => {
          const sig = _effectSignature(e);
          const prev = bySig.get(sig);
          if (!prev || _isNewer(e, prev)) bySig.set(sig, e);
        });

        // Render only the newest one per signature
        Array.from(bySig.values()).forEach(eff => {
          const holder = document.createElement('div');
          holder.style.display = 'flex';
          holder.style.alignItems = 'center';
          holder.style.flexWrap = 'wrap';
          holder.style.gap = '8px';

          const chip = document.createElement('div');
          chip.className = 'chip';
          chip.textContent = eff.label || '(effect)';
          holder.appendChild(chip);

          const rm = document.createElement('button');
          rm.className = 'btn btnDanger';
          rm.textContent = 'Remove';

          rm.addEventListener('click', () => {
            const sig = _effectSignature(eff);
            console.log('[ActiveTab] Remove clicked → batch remove signature', { cid:cardRow.cid, sig, latest:eff });
            _removeAllBySignature(cardRow.cid, sig, eff);
            // refresh the list (should now be gone)
            refreshActiveTab();
          });

          holder.appendChild(rm);
          wrap.appendChild(holder);
        });

        host.appendChild(wrap);
      });
    }


    // hook up the Active tab filter buttons
    const btnMine    = back.querySelector('[data-active="mine"]');
    const btnOpp     = back.querySelector('[data-active="opp"]');
    const btnBoth    = back.querySelector('[data-active="both"]');
    const btnRefresh = back.querySelector('[data-active="refresh"]');

    if (btnMine){
      btnMine.addEventListener('click', () => {
        activeFilter = 'mine';
        refreshActiveTab();
      });
    }
    if (btnOpp){
      btnOpp.addEventListener('click', () => {
        activeFilter = 'opp';
        refreshActiveTab();
      });
    }
    if (btnBoth){
      btnBoth.addEventListener('click', () => {
        activeFilter = 'both';
        refreshActiveTab();
      });
    }
    if (btnRefresh){
      btnRefresh.addEventListener('click', () => {
        refreshActiveTab();
      });
    }

    // ---------------- MANAGE TAB (unchanged / stubs) ----------------
    back.querySelectorAll('[data-man]').forEach(btn=>{
      if (btn.tagName === 'INPUT') return;
      btn.addEventListener('click', ()=>{
        console.log('[Manage]', btn.getAttribute('data-man'), 'clicked (stub)');
      });
    });

    // ---------------- RADIAL PICKER HOOKS ----------------
    // Radial open triggers (+/- on apply/manage/type/ability/counter)
    back.querySelectorAll('[data-radial]').forEach(b=>{
      b.addEventListener('click', ()=>{
        const key = b.getAttribute('data-radial');
        openRadial(key);
      });
    });

    // Radial close
    back.querySelector('[data-radial="close"]').addEventListener('click', ()=> setRadialVisible(false));

    STATE.root = back;

    // Scan tab "Rescan" button now that STATE.root is set
    back.querySelector('[data-scan="rescan"]').addEventListener('click', async () => {
      await runScanForActiveCard();
    });

    // --- NEW: mini "Targets / Effects" tabs inside Apply panel
    const applyStepTabs = back.querySelector('[data-apply="steps"]');
    if (applyStepTabs) {
      applyStepTabs.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-apply-step]');
        if (!btn) return;
        const step = btn.getAttribute('data-apply-step'); // 'targets' | 'effects'
        setApplyStep(step);
      });
    }

    // make sure Apply starts sane if user jumps straight there later
    setApplyStep('targets');

    // NOTE: we do NOT call refreshActiveTab() here automatically, because we only
    // want to populate Active when that tab is actually shown. We now trigger it
    // from setTab() when tab === 'active'.
  }


    function setVisible(v){
    STATE.root?.setAttribute('aria-hidden', v ? 'false' : 'true');
  }

  // --- NEW: internal sub-tab switcher for Apply (targets <-> effects)
  function setApplyStep(step){
    if (!STATE.root) return;

    // highlight the correct mini-tab button
    STATE.root.querySelectorAll('[data-apply-step]').forEach(btn => {
      const thisStep = btn.getAttribute('data-apply-step');
      btn.dataset.on = String(thisStep === step);
    });

    // show/hide the two step panels
    STATE.root.querySelectorAll('.applyStep').forEach(p => {
      const match = (p.getAttribute('data-step') === step);
      p.setAttribute('aria-hidden', String(!match));
      // force layout mode explicitly so inline style="display:none" or display:grid gets controlled
      p.style.display = match ? 'grid' : 'none';
    });
  }

  function setTab(tab){
    STATE.activeTab = tab;

    // top-level header tabs (Scan / Apply / Active / Manage)
    STATE.root.querySelectorAll('.tabBtn').forEach(b => {
      if (b.hasAttribute('data-tab')) {
        b.dataset.on = String(b.dataset.tab === tab);
      }
    });

    // show the correct main panel
    STATE.root.querySelectorAll('.panel').forEach(p => {
      p.setAttribute('aria-hidden', String(p.dataset.pane !== tab));
    });

    // layout mode: hide big preview on non-scan tabs
    const body = STATE.root.querySelector('.ovlBody');
    if (body) {
      body.setAttribute('data-mode', tab === 'scan' ? '' : 'compact');
    }

    // when we land on Apply, default its inner mini-step to "targets"
    if (tab === 'apply') {
      setApplyStep('targets');
    }

    // when we land on Active, refresh the Active tab list on-demand
    if (tab === 'active') {
      refreshActiveTab();
    }
  }


  // --- Oracle fetch helper (dataset first, fall back to Scryfall by name) ---
  async function hydrateOracleFor(el){
  try{
    const box = STATE.root?.querySelector('[data-scan="oracle"]');
    if (!box) return;

    // 1) dataset first
    const ds = (el && el.dataset) ? (el.dataset.oracle || '') : '';
    if (ds && ds.trim()) { box.innerHTML = await manaHtml(ds); return; }

    // 2) fetch by title
    const name = el?.title || '';
    if (!name) { box.innerHTML = ''; return; }
    const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) { box.innerHTML = ''; return; }
    const j = await r.json();
    const face0 = Array.isArray(j.card_faces) ? j.card_faces[0] : j;
    const oracle = face0?.oracle_text || j?.oracle_text || '';
    box.innerHTML = await manaHtml(oracle || '');
  }catch{
    const box = STATE.root?.querySelector('[data-scan="oracle"]');
    if (box) box.innerHTML = '';
  }
}


// ---------------- Quick-Action helpers (token-first) ----------------
function _resolveOverlayZ() {
  // Pull the overlay z from :root, then go higher.
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--ovlZ') || '';
    const base = parseInt(String(v).replace(/[^\d]/g,''), 10);
    if (!isNaN(base)) return base + 50;            // slightly above attributes overlay
  } catch {}
  return 2147483600; // absurdly high fallback
}

/**
 * Try to open the existing "Add Any Card" overlay (wherever it lives)
 * and prefill search + quantity. We try several likely entry points and selectors.
 *
 * opts = { name: string, qty: number }
 */
// --- Hard-wire to Zones’ Add-Any-Card overlay with robust prefill + z-fix + FILTERS ---
function openAnyCardOverlayPrefilled(opts = {}) {
  // opts: { name, qty, colors?:['white'|'blue'|'black'|'red'|'green'|'colorless'], abilities?:['Flying', ...] }

// --- Sanitizer helpers (robust against qty/PT/colors and named/tokens) ---
function _stripLeadingVarX(s){
  // Drop a leading variable X only when it introduces PT or color words.
  // e.g. "X 2/2 white Cat" -> "2/2 white Cat"
  return s.replace(/^\s*[Xx]\b(?=\s*(\d+\s*\/\s*\d+|\bwhite\b|\bblue\b|\bblack\b|\bred\b|\bgreen\b|\bcolorless\b))/i,'').trim();
}
function _stripLeadingQty(s){           // NEW: "1x " → ""
  return s.replace(/^\s*\d+\s*x\b\s*/i, '');
}
function _stripLeadingPT(s){ return s.replace(/^\s*\d+\s*\/\s*\d+\s*/, ''); }
function _stripWithTail(s){ return s.replace(/\bwith\b.*$/i, ''); }
function _stripArticlesAndToken(s){
  return s
    .replace(/^(?:a|an)\s+/i,'')
    .replace(/^\s*token\s+/i,'');       // only when "token" starts the phrase
}
function _stripLeadingColors(s){
  let t = s.trim();
  const COLOR = /^(white|blue|black|red|green|colorless)\b/i;
  while (true){
    const m = t.match(COLOR);
    if (!m) break;
    t = t.slice(m[0].length);
    t = t.replace(/^[\s,]+/,'').replace(/^and\s+/i,'');
  }
  return t.trim();
}
function _stripTrailingCreatureToken(s){ // NEW: "... Serpent creature token" → "Serpent"
  return s.replace(/\s*\b(?:creature\s+token|token)\b\s*$/i, '').trim();
}
function sanitizeTokenQuery(q){
  let s = String(q || '').trim();
  if (!s) return '';
  const original = s;
  s = _stripWithTail(s);
  s = _stripLeadingVarX(s);
  s = _stripLeadingQty(s);              // NEW
  s = _stripLeadingPT(s);
  s = _stripArticlesAndToken(s);
  s = _stripLeadingColors(s);
  s = _stripTrailingCreatureToken(s);   // NEW
  s = s.replace(/\b\s+X\s+\b/gi,' ');   // "White X Cat" -> "White Cat" (belt & suspenders)
  s = s.replace(/\s{2,}/g,' ').trim();
  console.log('[AddAnyCard][SANITIZE]', { original, sanitized:s });
  return s;
}




  const nameRaw = String(opts.name || '').trim();
  const name    = sanitizeTokenQuery(nameRaw);
  const qty     = Math.max(1, Number(opts.qty || 1));

  const colors   = Array.isArray(opts.colors)    ? opts.colors.map(c => String(c).toLowerCase()) : [];
  const abilities= Array.isArray(opts.abilities) ? opts.abilities.map(a => String(a)) : [];

  // read the attributes overlay z so we can sit on top of it
  let zTop = 2147483600;
  try {
    const cssZ = getComputedStyle(document.documentElement).getPropertyValue('--ovlZ') || '';
    const base = parseInt(String(cssZ).replace(/[^\d]/g, ''), 10);
    if (!Number.isNaN(base)) zTop = base + 50;
  } catch {}

  console.log('[AddAnyCard][STEP 1] Requested open with:', { name, qty, zTop, colors, abilities });

  // STEP 1: open Zones overlay via the canonical entry
  try {
    if (!window.Zones || typeof window.Zones.openAddAnyCardOverlay !== 'function') {
      console.warn('[AddAnyCard][ERROR] window.Zones.openAddAnyCardOverlay is not available');
    } else {
      console.log('[AddAnyCard][STEP 2] Calling window.Zones.openAddAnyCardOverlay()');
      window.Zones.openAddAnyCardOverlay();
    }
  } catch (err) {
    console.warn('[AddAnyCard][EXCEPTION] while opening overlay:', err);
  }

  // Helper: locate a likely overlay host (div that contains a text input + number input)
  function _findOverlayHost() {
    const roots = Array.from(document.body.querySelectorAll('body > div, body > section, body > aside, body > dialog'));
    for (let i = roots.length - 1; i >= 0; i--) {
      const host = roots[i];
      const textI = host.querySelector('input[type="text"], input:not([type]), input[type="search"]');
      const numI  = host.querySelector('input[type="number"]');
      if (textI && numI) return host;
    }
       return null;
  }

  // Best-effort setters for color & ability filters inside “Add Any Card” overlay
  function _applyColorFilters(host, colorList){
  if (!host || !colorList?.length) return;

  const COLOR_KEYS = ['white','blue','black','red','green','colorless'];
  const LETTER_BY_COLOR = { white:'W', blue:'U', black:'B', red:'R', green:'G', colorless:'C' };

  // Uncheck an "All" toggle if present (non-fatal)
  try {
    const allCkb = host.querySelector('input[type="checkbox"][data-filter-kind="all"]');
    if (allCkb && allCkb.checked) {
      allCkb.checked = false;
      allCkb.dispatchEvent(new Event('change',{bubbles:true}));
    }
  } catch {}

  colorList.forEach(c => {
    if (!COLOR_KEYS.includes(c)) return;

    // --- 1) Original checkbox-style paths (preserve previous behavior)
    const selCandidates = [
      `[data-filter-color="${c}"]`,
      `[data-color="${c}"]`,
      `input[type="checkbox"][name="color-${c}"]`,
      `input[type="checkbox"][value="${c}"]`,
      `input[type="checkbox"][value="${(LETTER_BY_COLOR[c]||'').toUpperCase()}"]`
    ];
    let el = null;
    for (const sel of selCandidates) {
      el = host.querySelector(sel);
      if (el) break;
    }
    if (el && el.type === 'checkbox') {
      if (!el.checked) {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles:true }));
      }
      console.log('[AddAnyCard][FILTER] set color via checkbox:', c);
      return;
    }

    // --- 2) NEW: “W/U/B/R/G” chips as buttons
    // Look for a button-like element whose textContent is exactly the letter.
    const letter = (LETTER_BY_COLOR[c] || '').toUpperCase();
    if (letter) {
      const chip = Array.from(
        host.querySelectorAll('button, .chip, .pill, [role="button"]')
      ).find(n => (n.textContent || '').trim().toUpperCase() === letter);

      if (chip) {
        // try to avoid toggling OFF if already active
        const pressed = chip.getAttribute?.('aria-pressed');
        const dataOn  = chip.getAttribute?.('data-on');
        const isOn = (pressed === 'true') || (dataOn === 'true') || chip.classList.contains('active');

        if (!isOn) {
          try { chip.click(); console.log('[AddAnyCard][FILTER] clicked color chip:', c, `(${letter})`); } catch {}
        } else {
          console.log('[AddAnyCard][FILTER] color chip already on:', c, `(${letter})`);
        }
        return;
      }
    }

    // --- 3) Fallback: full-word label/button
    const labels = Array.from(host.querySelectorAll('label,button,.chip,.pill'));
    const match = labels.find(n => new RegExp(`\\b${c}\\b`, 'i').test(n.textContent || ''));
    if (match) {
      try { match.click(); console.log('[AddAnyCard][FILTER] clicked color label (fallback):', c); } catch {}
    } else {
      console.log('[AddAnyCard][FILTER] could not locate control for color:', c);
    }
  });
}


  function _applyAbilityFilters(host, abilityList){
  if (!host || !abilityList?.length) return;

  // Prefer the single “Filter (comma-separated …)” field,
  // then any input whose placeholder mentions abilities,
  // then fall back to the longest plain text input under the filters row.
  let targetInput =
    host.querySelector('input[placeholder^="Filter (comma-separated"]') ||
    host.querySelector('input[placeholder*="abilities" i]') ||
    null;

  if (!targetInput) {
    // choose the longest text input inside the overlay body as a last resort
    const candidates = Array.from(host.querySelectorAll('input[type="text"], input[type="search"]'));
    targetInput = candidates.sort((a,b)=>(b.placeholder?.length||0)-(a.placeholder?.length||0))[0] || null;
  }

  if (!targetInput) {
    console.log('[AddAnyCard][FILTER] no suitable ability filter input found');
    return;
  }

  // Append abilities to any existing filter text, comma-separated, de-duped.
  const existing = (targetInput.value || '').split(',').map(s=>s.trim()).filter(Boolean);
  const add = abilityList.map(s=>String(s).trim()).filter(Boolean);
  const merged = Array.from(new Set([...existing, ...add]));

  try {
    targetInput.value = merged.join(', ');
    targetInput.dispatchEvent(new Event('input', { bubbles:true }));
    console.log('[AddAnyCard][FILTER] set abilities ->', targetInput.value);
  } catch (e) {
    console.warn('[AddAnyCard][FILTER] failed to set abilities', e);
  }

  // NOTE: per request, we are NOT adding the optional custom-event listener path here.
}


  // STEP 3: after a short delay, prefill search + qty and bump z-index (+ apply filters)
  const attemptPrefill = (tag) => {
    const host = _findOverlayHost();
    if (!host) {
      console.log(`[AddAnyCard][${tag}] overlay host not found yet`);
      return false;
    }

    // Raise z-index
    try {
      host.style.zIndex = String(zTop);
      console.log(`[AddAnyCard][${tag}] z-index set to`, zTop, host);
    } catch {}

    // Find first text input and first number input
    const searchInput = host.querySelector('input[type="text"], input:not([type]), input[type="search"]');
    const qtyInput    = host.querySelector('input[type="number"]');

    if (!searchInput) {
      console.log(`[AddAnyCard][${tag}] search input not found`);
    } else {
      searchInput.value = name;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      console.log(`[AddAnyCard][${tag}] set search:`, name);
    }

    if (!qtyInput) {
      console.log(`[AddAnyCard][${tag}] qty input not found`);
    } else {
      qtyInput.value = String(qty);
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
      console.log(`[AddAnyCard][${tag}] set qty:`, qty);
    }

    // NEW: apply color + ability filters if the overlay exposes them
    try { _applyColorFilters(host, colors); } catch(e){ console.warn('[AddAnyCard] color filter set failed', e); }
    try { _applyAbilityFilters(host, abilities); } catch(e){ console.warn('[AddAnyCard] ability filter set failed', e); }

    // Optional: click an obvious Search/Apply button
    const goBtn = host.querySelector('button, [role="button"]');
    if (goBtn && /search|apply|go|find|filter/i.test(goBtn.textContent || '')) {
      try { goBtn.click(); console.log(`[AddAnyCard][${tag}] clicked button:`, goBtn.textContent.trim()); } catch {}
    }

    return true;
  };

  // Try a few times to catch late DOM mount
  setTimeout(() => attemptPrefill('t+50'), 50);
  setTimeout(() => attemptPrefill('t+150'), 150);
  setTimeout(() => {
    if (!attemptPrefill('t+350')) {
      console.warn('[AddAnyCard][WARN] overlay not detected by t+350ms — will not spam further');
    }
  }, 350);
}




// helper so we can call the exact same scan logic on open + on button press
async function runScanForActiveCard(){
  // Which card are we scanning?
  const el = STATE.activeCid
    ? document.querySelector(`.table-card[data-cid="${STATE.activeCid}"]`)
    : null;

  // 1) hydrate the oracleBox in the overlay (from dataset.oracle or Scryfall)
  await hydrateOracleFor(el);

  // 2) grab the text we just hydrated
  const root = STATE.root;
  if (!root) {
    console.warn('[runScanForActiveCard] no STATE.root yet');
    return;
  }

  const box = root.querySelector('[data-scan="oracle"]');
  const oracleText = box?.innerText || '';

  // 3) run the parser
  const { detectedFlags, quickActions, tokens, counters } =
    scanOracleTextForActions(oracleText);

  // 4) wipe + repopulate Detected Abilities + Quick Actions
  const out = root.querySelector('[data-scan="detected"]');
  const act = root.querySelector('[data-scan="actions"]');
  if (!out || !act) {
    console.warn('[runScanForActiveCard] missing scan output containers');
    return;
  }

  out.innerHTML = '';
  act.innerHTML = '';

  // --- Detected Abilities chips ---
  detectedFlags.forEach(f => {
    const chip = make('div', 'chip', f.label);

    // when you click a detected ability, it should:
    // 1. switch to Apply tab
    // 2. enable "Grant ability"
    // 3. prefill the ability text field
    chip.style.cursor = 'pointer';
    chip.title = 'Click to apply this ability';
    chip.addEventListener('click', () => {
      // 1) jump to Apply tab
      setTab('apply');

      // 2) toggle on "Grant ability"
      const abilityToggle = STATE.root.querySelector('[data-eff="ability"]');
      if (abilityToggle && !abilityToggle.checked) {
        abilityToggle.checked = true;
        rebuildEffectSections(); // so the ability input exists
      }

      // 3) stuff that label into the ability input
      const input = STATE.root.querySelector('input[data-apply="ability"]');
      if (input) {
        input.value = f.label || '';
        input.focus();
      }
    });

    out.appendChild(chip);
  });

  // --- Quick Actions buttons (now routed) ---
 // --- Quick Actions (delegated; routes to Tokens / Counters / Grant Ability) ---
STATE.lastQuickActions = Array.isArray(quickActions) ? quickActions.slice() : [];
act.innerHTML = '';

window.openAnyCardOverlayPrefilled = openAnyCardOverlayPrefilled;

const ABILITY_WORDS = new Set([
  'flying','first strike','double strike','vigilance','lifelink','deathtouch',
  'trample','haste','reach','hexproof','indestructible','menace','prowess','ward'
]);

function titleCaseWords(s){
  return String(s||'').trim().replace(/\s+/g,' ').replace(/\b\w/g, m => m.toUpperCase());
}

// Clean display text: kill "Xx" → "X", and " White X Cat" → " White Cat"
function cleanActionLabel(lbl){
  return String(lbl || '')
    .replace(/\bXx\b/gi,'X')
    .replace(/\b(white|blue|black|red|green|colorless)\s+X\s+/gi,'$1 ')
    .replace(/\s{2,}/g,' ')
    .trim();
}

// Token metadata from either structured data or label text
function deriveTokenMeta(a){
  const d = a?.data || {};
  const lbl = String(a?.label || '');

  // qty: prefer structured, else look for "xN" or a bare X (variable)
  let qty = Number(d.qty || d.count || d.quantity);
  if (!qty || Number.isNaN(qty)) {
    const mN = lbl.match(/\bx\s*(\d+)\b/i);
    if (mN) qty = Number(mN[1]);
    else if (/\bX\b/i.test(lbl)) qty = NaN; // variable → will coerce to 1 later
  }

  // Colors for overlay filter (unchanged)
  const colors = [];
  (lbl.match(/\b(white|blue|black|red|green|colorless)\b/gi) || []).forEach(c=>{
    const lc = c.toLowerCase();
    if (!colors.includes(lc)) colors.push(lc);
  });

  // Abilities after "with ..." (unchanged)
  const withTail = (lbl.match(/\bwith\b(.*)$/i) || [,''])[1];
  const abilities = [];
  withTail.split(/[,]+/).forEach(chunk=>{
    const t = chunk.toLowerCase().trim();
    ABILITY_WORDS.forEach(word=>{
      if (new RegExp(`\\b${word}\\b`,'i').test(t)) {
        const nice = titleCaseWords(word);
        if (!abilities.includes(nice)) abilities.push(nice);
      }
    });
  });

  // Prefer explicit "token named ____" if present on the label
  const mNamed = lbl.match(/\btoken\s+named\s+([A-Za-z0-9'’\- ]+)/i);
  let named = '';
  if (mNamed && mNamed[1]) {
    named = mNamed[1].replace(/\s*[.,;:]?\s*$/, ''); // trim trailing punctuation
  }

  // NEW: If the label didn’t include it, fall back to the hydrated Oracle text box
  if (!named) {
    try {
      const oracleBox = STATE?.root?.querySelector('[data-scan="oracle"]');
      const oracleTxt = oracleBox?.innerText || '';
      const m2 = oracleTxt.match(/\btoken\s+named\s+([A-Za-z0-9'’\- ]+)/i);
      if (m2 && m2[1]) {
        named = m2[1].replace(/\s*[.,;:]?\s*$/, '');
      }
    } catch {}
  }

  // Otherwise, fall back to the type words after "Create"
  let nameGuess = lbl.replace(/^.*?\bcreate\b/i,'').trim();
  nameGuess = nameGuess.replace(/\bwith\b.*$/i,'').trim();
  nameGuess = nameGuess.replace(/^[xX]\b/,'').trim();                  // "X 2/2 ..."
  nameGuess = nameGuess.replace(/^\s*\d+\s*\/\s*\d+\s*/,'').trim();    // strip P/T
  nameGuess = nameGuess.replace(/^\s*\d+\s*x\b\s*/i,'').trim();        // strip "1x "
  nameGuess = nameGuess.replace(/^(white|blue|black|red|green|colorless)\s+/i,'').trim();

  const raw = String(d.name || d.token || (named || nameGuess) || '').trim();
  let name;
  try { name = sanitizeTokenQuery(raw); } catch { name = raw; }

  return { name, qty: qty, colors, abilities };

}


/** Parse a counter quick-action. */
function parseCounterAction(a){
  const d = a?.data || {};
  const t = String(a?.type || '').toLowerCase();
  const lbl = String(a?.label || '');
  const looksCounter = t === 'counter' || t === 'counters' || /\bcounter\b/i.test(lbl);
  if (!looksCounter) return null;

  let kind = (d.kind || d.counter || '').toString().trim();
  let qty  = Number(d.qty || d.count || d.quantity || 0);
  if (!kind) {
    const m = lbl.match(/([+\-]?\d+\s*\/\s*[+\-]?\d+|[A-Za-z][A-Za-z +/+-]*?)\s+counter/i);
    if (m) kind = m[1].trim();
  }
  if (!qty || Number.isNaN(qty)) {
    const mq = lbl.match(/\bx\s*(\d+)\b/i);
    qty = mq ? Number(mq[1]) : 1;
  }
  if (!kind) return null;
  return { kind, qty: Math.max(1, qty) };
}

/** Prefill Apply tab for a counter action (+1/+1 also sets PT +1/+1). */
function prefillApplyForCounter(kind, qty){
  setTab('apply');
  const togglesHost = STATE.root.querySelector('[data-effect="toggles"]');
  if (!togglesHost) return;

  const countersChk = togglesHost.querySelector('input[type="checkbox"][data-eff="counters"]');
  if (countersChk && !countersChk.checked) countersChk.checked = true;

  const isPlusOne = /^\s*\+1\s*\/\s*\+1\s*$/i.test(kind);
  if (isPlusOne) {
    const ptChk = togglesHost.querySelector('input[type="checkbox"][data-eff="pt"]');
    if (ptChk && !ptChk.checked) ptChk.checked = true;
  }
  rebuildEffectSections();

  const kindI = STATE.root.querySelector('input[data-apply="counterKind"]');
  const qtyI  = STATE.root.querySelector('input[data-apply="counterQty"]');
  if (kindI) kindI.value = kind;
  if (qtyI)  qtyI.value  = String(qty);
  if (isPlusOne) {
    const powI = STATE.root.querySelector('input[data-pt="pow"]');
    const touI = STATE.root.querySelector('input[data-pt="tou"]');
    if (powI) powI.value = '1';
    if (touI) touI.value = '1';
  }
  try { kindI?.focus(); } catch{}
}

/** NEW: Prefill Apply tab for a "Grant XYZ" action. */
function prefillApplyForGrantAbility(ability){
  const nice = titleCaseWords(ability);
  setTab('apply');
  // ensure ability toggle on & section rendered
  const abilityChk = STATE.root.querySelector('input[type="checkbox"][data-eff="ability"]');
  if (abilityChk && !abilityChk.checked) abilityChk.checked = true;
  rebuildEffectSections();
  // write the ability text
  const input = STATE.root.querySelector('input[data-apply="ability"]');
  if (input) {
    input.value = nice;
    try { input.focus(); } catch{}
  }
}

// Render buttons (with cleaned labels)
STATE.lastQuickActions.forEach((a, i) => {
  const btn = make('button', 'btn', cleanActionLabel(a.label));
  btn.type = 'button';
  btn.dataset.qidx = String(i);
  act.appendChild(btn);
});

if (!act._delegated) {
  act.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button.btn[data-qidx]');
    if (!btn) return;
    const idx = Number(btn.dataset.qidx);
    const a = (STATE.lastQuickActions || [])[idx];
    if (!a) return;

    const rawType = String(a?.type || '').toLowerCase().replace(/[\s-]+/g,'_');
    const label   = String(a?.label || '');
    const labelClean = cleanActionLabel(label);
    const d       = a.data || {};

    // 1) COUNTERS
    const parsed = parseCounterAction(a);
    if (parsed) {
      console.log('[QuickAction] Counter detected:', parsed);
      prefillApplyForCounter(parsed.kind, parsed.qty);
      return;
    }

    // 2) TOKENS
    const looksLikeToken =
      rawType === 'token' ||
      rawType === 'create_token' ||
      rawType === 'spawn_token' ||
      /\bcreate\b/i.test(labelClean);

    if (looksLikeToken) {
      const meta = deriveTokenMeta(a); // { name, qty, colors[], abilities[] }
      try {
        openAnyCardOverlayPrefilled(meta);
      } catch (err) {
        console.warn('[QuickAction] openAnyCardOverlayPrefilled failed, trying broadcast', err);
        window.dispatchEvent(new CustomEvent('open-any-card-overlay', {
          detail: { search: meta.name, qty: meta.qty, colors: meta.colors, abilities: meta.abilities }
        }));
      }
      return;
    }

    // 3) GRANT ABILITY (e.g., "Grant Flying", "Grant Double Strike")
    const mGrant = labelClean.match(/^\s*grant\s+(.+?)\s*$/i);
    if (rawType === 'grant_ability' || mGrant) {
      const abil = (d.ability || d.effect || (mGrant ? mGrant[1] : '') || '').trim();
      if (abil) {
        console.log('[QuickAction] Grant ability:', abil);
        prefillApplyForGrantAbility(abil);
        return;
      }
    }

    console.log('[Scan Action] (no route yet, raw action):', a);
  });
  act._delegated = true;
}







  console.log('[Scan] Detected', { detectedFlags, quickActions, tokens, counters });
}



  // --- Mana render helper (prefers global; falls back to dynamic import) ---
  async function manaHtml(str){
    const s = String(str || '');
    if (!s) return '';
    // 1) global
    if (window.ManaMaster?.manaCostHtml) return window.ManaMaster.manaCostHtml(s);
    // 2) dynamic import (try both casings)
    try {
      const mod = await import('./mana.master.js').catch(async () => await import('./mana.Master.js'));
      if (mod?.manaCostHtml) return mod.manaCostHtml(s);
      if (window.ManaMaster?.manaCostHtml) return window.ManaMaster.manaCostHtml(s);
    } catch {}
    return s; // fallback plain text
  }


  function openForCard(elOrCid){
    ensure();
    const el = typeof elOrCid === 'string' ? document.querySelector(`.table-card[data-cid="${elOrCid}"]`) : elOrCid;
    const cid = el?.dataset?.cid || String(elOrCid || '');
    STATE.activeCid = cid || null;

    const img = STATE.root.querySelector('.preview img');
    img.src = el?.src || '';
    img.alt = el?.title || 'Card';
    STATE.root.querySelector('.preview .cap').textContent = el?.title || '';
    STATE.root.querySelector('.cid').textContent = cid ? `cid: ${cid}` : '';

        setTab('scan');
    rebuildTargets('mine'); // default to showing "My cards" in Apply tab
    setVisible(true);

    // auto-run initial scan so the user doesn't have to press Rescan
    // (this will also hydrate oracle text internally)
    runScanForActiveCard();



  }

  function close(){
    setVisible(false);
    STATE.activeCid = null;
    setRadialVisible(false);
  }

  function ensure(){ injectCSS(); if (!STATE.root) makeRoot(); if (!STATE.mounted){ STATE.mounted = true; } }
  function mount(){ ensure(); }

  // ---------------- Radial picker ----------------
  function setRadialVisible(v){ STATE.root.querySelector('.radialBack')?.setAttribute('aria-hidden', v ? 'false':'true'); }

  function openRadial(key){
    const rBack = STATE.root.querySelector('.radialBack');
    const rad = rBack.querySelector('.radial');
    // ... (radial code)
    setRadialVisible(true);
  }

  // --------- Effect sections (render on toggle) ---------
  function buildPTSection(){
    const wrap = document.createElement('div');
    wrap.className = 'group';
    wrap.innerHTML = `
      <div class="label">Power / Toughness</div>
      <div class="ptStack">
        <div>
          <div class="label" style="margin-bottom:4px;">Power</div>
          <div class="ptRow">
            <button class="btn" data-pt="-pow">−</button>
            <input class="ipt" data-pt="pow" value="0" />
            <button class="btn" data-pt="+pow">+</button>
          </div>
        </div>
        <div>
          <div class="label" style="margin-bottom:4px;">Toughness</div>
          <div class="ptRow">
            <button class="btn" data-pt="-tou">−</button>
            <input class="ipt" data-pt="tou" value="0" />
            <button class="btn" data-pt="+tou">+</button>
          </div>
        </div>
      </div>
    `;
    return wrap;
  }

  function buildAbilitySection(){
    const wrap = document.createElement('div');
    wrap.className = 'group';
    wrap.innerHTML = `
      <div class="label">Ability</div>
      <div style="display:flex; gap:6px;">
        <input class="ipt" data-apply="ability" placeholder="e.g. flying"/>
        <button class="btn" data-radial="+ability">+</button>
        <button class="btn" data-radial="-ability">-</button>
      </div>
    `;
    return wrap;
  }

  function buildTypeSection(){
    const wrap = document.createElement('div');
    wrap.className = 'group';
    wrap.innerHTML = `
      <div class="label">Type</div>
      <div style="display:flex; gap:6px;">
        <input class="ipt" data-apply="grantType" placeholder="e.g. Elf"/>
        <button class="btn" data-radial="+grantType">+</button>
        <button class="btn" data-radial="-grantType">-</button>
      </div>
    `;
    return wrap;
  }

  function buildCountersSection(){
    const wrap = document.createElement('div');
    wrap.className = 'group';
    wrap.innerHTML = `
      <div class="label">Counters</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <input class="ipt" data-apply="counterKind" placeholder="e.g. +1/+1" style="flex:1; min-width:180px;"/>
        <input class="ipt" data-apply="counterQty" value="1" style="width:84px;"/>
        <button class="btn" data-radial="+manCounter">+</button>
        <button class="btn" data-radial="-manCounter">-</button>
      </div>
    `;
    return wrap;
  }

  function rebuildEffectSections(){
    const host = STATE.root?.querySelector('[data-apply="effect-sections"]');
    if (!host) return;
    host.innerHTML = '';

    const toggles = STATE.root.querySelectorAll('[data-effect="toggles"] input[type="checkbox"]');
    const on = new Set(Array.from(toggles).filter(i=>i.checked).map(i=>i.getAttribute('data-eff')));

    // Order: PT, Ability, Type, Counters (compact & predictable)
    if (on.has('pt'))       host.appendChild(buildPTSection());
    if (on.has('ability'))  host.appendChild(buildAbilitySection());
    if (on.has('type'))     host.appendChild(buildTypeSection());
    if (on.has('counters')) host.appendChild(buildCountersSection());
  }


  // --------- Target collection & rebuild ---------
  function getMySeat(){
    try { return Number(window.mySeat?.() ?? 1); } catch { return 1; }
  }

  function collectTableCards(){
    const nodes = Array.from(document.querySelectorAll('img.table-card'));
    return nodes.map(el => ({
      cid:   el?.dataset?.cid || '',
      owner: Number(el?.dataset?.owner || NaN),
      title: el?.title || 'Card',
      img:   el?.src || '',
      el
    }));
  }

  function collectDeck(){
    try {
      const list = (window.DeckAccess?.enumerate?.() || []);
      return list.map((c,i) => ({
        cid: '', owner: -1, title: c.name || `Card ${i+1}`, img: c.img || '', el: null
      }));
    } catch { return []; }
  }

  // Build a friendly summary string for middle column:
  // "Legendary Elder Dragon • Flying, Hexproof, Menace"
  function _summarizeAttrsForRow(cardDbg){
  if (!cardDbg) return '';

  // ---- 1. TYPES ----
  // Expect something like ["Legendary","Creature","Elder","Dragon"]
  const typesArr = Array.isArray(cardDbg.types)
    ? cardDbg.types.slice()
    : [];

  // We'll turn that into "Legendary Creature Elder Dragon"
  const cleanTypes = typesArr.join(' ').trim();

  // ---- 2. ABILITIES / KEYWORDS / BADGES ----
  const abilityBucketsToCheck = [
    'abilities',
    'keywords',
    'flags',
    'grantedAbilities',
    'keywordAbilities',
    'staticAbilities',
    'badges',
    'status'
  ];

  const abilFound = [];

  function takeArray(arr){
    arr.forEach(v => {
      const label = String(v || '').trim();
      if (!label) return;
      abilFound.push(label);
    });
  }

  function takeObject(obj){
    Object.keys(obj).forEach(key => {
      const lower = key.toLowerCase();
      if (
        lower.includes('summon') ||
        lower.includes('sick') ||
        lower.includes('tapped') ||
        lower.includes('pt') ||
        lower.includes('power') ||
        lower.includes('tough') ||
        lower.includes('owner')
      ){
        return;
      }
      if (obj[key]) {
        const label = String(key || '').trim();
        if (label) abilFound.push(label);
      }
    });
  }

  abilityBucketsToCheck.forEach(bucket => {
    const val = cardDbg[bucket];
    if (!val) return;
    if (Array.isArray(val)) {
      takeArray(val);
    } else if (typeof val === 'object') {
      takeObject(val);
    }
  });

  Object.keys(cardDbg).forEach(k => {
    const v = cardDbg[k];
    if (typeof v === 'boolean' && v === true) {
      const lower = k.toLowerCase();
      if (
        lower === 'flying' ||
        lower === 'menace' ||
        lower === 'deathtouch' ||
        lower === 'firststrike' ||
        lower === 'first_strike' ||
        lower === 'doublestrike' ||
        lower === 'double_strike' ||
        lower === 'hexproof' ||
        lower === 'indestructible' ||
        lower === 'lifelink' ||
        lower === 'trample' ||
        lower === 'vigilance' ||
        lower === 'reach' ||
        lower === 'haste'
      ){
        abilFound.push(k.replace(/[_]/g,' '));
      }
    }
  });

  const cleanAbils = Array.from(new Set(
    abilFound.map(a => {
      return String(a)
        .trim()
        .replace(/\s+/g,' ')
        .replace(/^\s+|\s+$/g,'')
        .replace(/\b\w/g, m => m.toUpperCase());
    })
  ))
  .join(', ')
  .trim();

  if (cleanTypes && cleanAbils){
    return `${cleanTypes} • ${cleanAbils}`;
  }
  if (cleanTypes){
    return cleanTypes;
  }
  if (cleanAbils){
    return cleanAbils;
  }
  return '';
}



  function _ptForRow(cardDbg){
    if (!cardDbg) return '';
    return cardDbg.ptFinal || '';
  }

  function setPreviewCard(cid){
  const shell = STATE.root?.querySelector('[data-apply="previewCardShell"]');
  const msg   = STATE.root?.querySelector('[data-apply="previewCardMsg"]');
  if (!shell) return;

  shell.innerHTML = '';

  const live = document.querySelector(`img.table-card[data-cid="${cid}"]`);
  if (!live){
    const fallback = document.createElement('div');
    fallback.style.color = 'var(--mut)';
    fallback.style.fontSize = '12px';
    fallback.style.padding = '12px';
    fallback.textContent = 'Card not found on table.';
    shell.appendChild(fallback);
    return;
  }

  const clone = live.cloneNode(true);

  clone.classList.remove('table-card');

  clone.style.position = 'static';
  clone.style.left = 'auto';
  clone.style.top = 'auto';
  clone.style.transform = 'none';
  clone.style.rotate = live.style.rotate || '';
  clone.style.maxWidth = '100%';
  clone.style.height = 'auto';
  clone.style.pointerEvents = 'none';
  clone.draggable = false;
  clone.setAttribute('draggable','false');

  const frame = document.createElement('div');
  frame.style.position = 'relative';
  frame.style.display = 'flex';
  frame.style.alignItems = 'center';
  frame.style.justifyContent = 'center';
  frame.style.width = '100%';
  frame.style.minHeight = '200px';
  frame.style.padding = '12px';
  frame.style.background = '#000';
  frame.style.border = '1px solid var(--line)';
  frame.style.borderRadius = '12px';
  frame.appendChild(clone);

  shell.appendChild(frame);

  try {
    if (window.Badges?.render) {
      window.Badges.render(clone);
    } else if (window.Badges?.refreshFor) {
      window.Badges.refreshFor(cid);
    }
  } catch(err){
    console.warn('[PreviewCard] badge render failed', err);
  }
}


  // --- NEW: pull active filter choices from the drawer
function _getActiveKindFilters(){
  const drawer = STATE.root?.querySelector('[data-filter-drawer]');
  if (!drawer) return { all:true, kinds:[] };
  const cbAll = drawer.querySelector('input[data-filter-kind="all"]');
  const picks = Array.from(drawer.querySelectorAll('input[data-filter-kind]:not([data-filter-kind="all"])'))
    .filter(cb => cb.checked)
    .map(cb => String(cb.getAttribute('data-filter-kind')||'').toLowerCase());
  const allOn = !!cbAll?.checked || picks.length === 0;
  return { all: allOn, kinds: picks };
}

// --- NEW: helpers to test type buckets from badges/dbg or dataset.typeLine
function _hasTypeWord(tl, word){
  if (!tl) return false;
  return new RegExp(`\\b${word}\\b`, 'i').test(String(tl));
}
function _rowMatchesKinds(row, dbg, kinds){
  if (!kinds || !kinds.length) return true;

  // Prefer badges types; fallback to dataset.typeLine
  const typeLine = row?.el?.dataset?.typeLine || '';
  const hasFromDbg = (label) => {
    try {
      const arr = (dbg?.types || []);
      return Array.isArray(arr) && arr.some(t => String(t).toLowerCase() === label);
    } catch { return false; }
  };

  // Map our checkboxes → predicates
  const wantCreature    = kinds.includes('creature');
  const wantLegendary   = kinds.includes('legendary');
  const wantArtifact    = kinds.includes('artifact');
  const wantEnchantment = kinds.includes('enchantment');

  // If "All" was off, at least one of the selected buckets must match.
  const checks = [];

  if (wantCreature) {
    checks.push( hasFromDbg('creature') || _hasTypeWord(typeLine, 'Creature') );
  }
  if (wantLegendary) {
    // Legendary is a supertype; appears at start of line typically
    checks.push( hasFromDbg('legendary') || _hasTypeWord(typeLine, 'Legendary') );
  }
  if (wantArtifact) {
    checks.push( hasFromDbg('artifact') || _hasTypeWord(typeLine, 'Artifact') );
  }
  if (wantEnchantment) {
    checks.push( hasFromDbg('enchantment') || _hasTypeWord(typeLine, 'Enchantment') );
  }

  // If user ticked N buckets, pass if ANY selected bucket matches.
  return checks.length ? checks.some(Boolean) : true;
}

function rebuildTargets(scope){
  const host = STATE.root?.querySelector('[data-apply="list"]');
  if (!host) return;
  host.innerHTML = '';

  const me = getMySeat();
  const all = collectTableCards();

  let rows = [];
  if (scope === 'deck') {
    // Deck scope is currently hidden; keep code path intact in case you re-enable it.
    rows = collectDeck();
  } else if (scope === 'mine') {
    rows = all.filter(r => Number(r.owner) === me);
  } else if (scope === 'opp') {
    rows = all.filter(r => Number(r.owner) && Number(r.owner) !== me);
  } else {
    rows = all;
  }

  // --- NEW: apply kind filters if drawer is active (All = no filtering)
  const { all: allKinds, kinds } = _getActiveKindFilters();
  if (!allKinds) {
    rows = rows.filter(r => {
      let dbg = null;
      if (r.cid && window.badgesForCid) {
        try { dbg = window.badgesForCid(r.cid); } catch { dbg = null; }
      }
      return _rowMatchesKinds(r, dbg, kinds);
    });
  }

  rows.forEach(r => {
    let dbg = null;
    if (r.cid && window.badgesForCid) {
      try {
        dbg = window.badgesForCid(r.cid);
      } catch {
        dbg = null;
      }
    }

    const midText = _summarizeAttrsForRow(dbg);
    const ptText  = _ptForRow(dbg);

    const rowDiv = document.createElement('div');
    rowDiv.className = 'targetRow';

    const leftLab = document.createElement('label');
    leftLab.className = 'tLeft';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.setAttribute('data-target-cid', r.cid || '');
    leftLab.appendChild(check);

    if (r.img) {
      const art = document.createElement('img');
      art.src = r.img;
      art.alt = r.title || '';
      leftLab.appendChild(art);
    }

    const nm = document.createElement('span');
    nm.className = 'tName';
    nm.textContent = r.title || (r.cid || 'Card');
    leftLab.appendChild(nm);

    rowDiv.appendChild(leftLab);

    const mid = document.createElement('div');
    mid.className = 'tMid';
    mid.textContent = midText || '';
    if (midText) {
      mid.title = midText;
    }
    rowDiv.appendChild(mid);

    const right = document.createElement('div');
    right.className = 'tRight';

    const ptSpan = document.createElement('div');
    ptSpan.className = 'tPT';
    ptSpan.textContent = ptText || '';
    right.appendChild(ptSpan);

    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.className = 'eyeBtn';
    eyeBtn.textContent = '👁';
    eyeBtn.setAttribute('data-preview-cid', r.cid || '');
    eyeBtn.title = 'Preview this card';
    eyeBtn.addEventListener('click', (ev)=>{
      ev.stopPropagation();
      const cid = eyeBtn.getAttribute('data-preview-cid');
      if (cid) setPreviewCard(cid);
    });
    right.appendChild(eyeBtn);

    rowDiv.appendChild(right);

    host.appendChild(rowDiv);
  });

  console.log('[Overlay] targets rebuilt:', scope, rows.length, { filterAll: allKinds, kinds });
}



  // expose for badges
  window.CardOverlayUI = window.CardOverlayUI || { mount, openForCard, close };

  return { mount, openForCard, close };
})();
