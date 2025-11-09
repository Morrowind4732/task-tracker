// modules/user.interface.js
// Right-side drawer + rail buttons (⚔️, End Turn) and top life bar + runtime Settings.
// Public API:
//   UserInterface.mount()
//   UserInterface.setTurn(turnNumber, playerLabel, activeSeatNow?)
//   UserInterface.setP1(total, mid, poison)
//   UserInterface.setP2(total, mid, poison)
//   UserInterface.setSeatRole(seat, role)
//   UserInterface.showSettingsPanel()
//   UserInterface.hideSettingsPanel(applyChangesBoolean)
//   UserInterface.previewDraftSettings()
//   UserInterface.commitLiveSettings()
//   UserInterface.pushSettingsToCSSVars()
//   UserInterface.dumpLiveSettings()

export const UserInterface = (() => {

  // ------------------------------------------------------------------
  // RUNTIME STATE
  // ------------------------------------------------------------------
  const STATE = {
    open: false,
    turn: 1,
    playerLabel: 'Player 1',
    phase: 'Main 1', // 🔵 NEW: simple phase label for center pill
    p1: { total: 40, mid: 21, poison: 0 },
    p2: { total: 40, mid: 21, poison: 0 },

    // seat/role awareness
    activeSeat: 1, // whose turn it is
    seat: 1,       // which seat am I (1 host / 2 join)
    role: 'host',
    flipSides: false, // if true, mirror life pills

    // drawer view mode: "controls" | "settings"
    drawerMode: 'controls'
  };


  // ------------------------------------------------------------------
  // SETTINGS MODELS (Live vs Draft vs SessionBase)
  // ------------------------------------------------------------------
  // "Live": what the rest of the app should read from right now
  const UISettingsLive = {
    // Cards
    handCardHeight: 190,
    handSpreadPx: 24,
    tableCardHeight: 180,
    tooltipFontSize: 14,
    tooltipMaxWidth: 260,
    tooltipPreviewHeight: 160,
    tooltipButtonSize: 24,
    tooltipDockEdge: 'right',

    // Zones / Combat
    handZoneHeight: 150,
    combatGapHeight: 20,
    attackPushDistance: 60,
    blockerSnapOffset: 40,

    // Badges / Stickers
    badgePanelScale: 1.0,
    badgeOffsetX: 16,
    badgeOffsetY: 0,
    ptStickerScale: 1.0,
    ptStickerOffsetX: 0,
    ptStickerOffsetY: 0,

    // Drawer / UI chrome
    uiButtonHeight: 32,
    uiButtonFontSize: 14,
    drawerHeaderHeight: 36, // matches --ui-life-h default
    lifeFontSize: 13,
    uiThemeColor: '#2f8dff',

    // Camera
    cameraDefaultZoom: 1.0,
    cameraDefaultPanY: 0,

    // HUD Placement
    // "R"  = right side (default)
    // "L"  = left side
    // "UR" = upper right near life bar
    // "UL" = upper left near life bar
    // "DR" = lower right above hand
    // "DL" = lower left above hand
    // "DU" = under turn pill / center top-ish
    hudPlacement: 'R',
    hudMirror: false, // if true, clone rail on opposite side

    // Toggles
    showTooltipOnDragExitHand: true,
    mirrorOpponentCards: true,
    showOpponentBadges: true,
    showOpponentTooltips: true
  };

  // "Draft": the knobs you're tweaking in the Settings drawer right now
  const UISettingsDraft = { ...UISettingsLive };

  // "SessionBase": snapshot of Live when you OPEN settings this session.
  // Cancel reverts back to this snapshot visually.
  let UISettingsSessionBase = { ...UISettingsLive };

  // Hard defaults for the "Default" button.
  const UISettingsDefaults = {
    handCardHeight: 190,
    handSpreadPx: 24,
    tableCardHeight: 180,
    tooltipFontSize: 14,
    tooltipMaxWidth: 260,
    tooltipPreviewHeight: 160,
    tooltipButtonSize: 24,
    tooltipDockEdge: 'right',

    handZoneHeight: 220,
    combatGapHeight: 300,
    attackPushDistance: 60,
    blockerSnapOffset: 40,

    badgePanelScale: 1.0,
    badgeOffsetX: 16,
    badgeOffsetY: 0,

    ptStickerScale: 1.0,
    ptStickerOffsetX: 0,
    ptStickerOffsetY: 0,

    uiButtonHeight: 32,
    uiButtonFontSize: 14,
    drawerHeaderHeight: 36,
    lifeFontSize: 13,
    uiThemeColor: '#2f8dff',

    cameraDefaultZoom: 1.0,
    cameraDefaultPanY: 0,

    hudPlacement: 'R',
    hudMirror: false,

    showTooltipOnDragExitHand: true,
    mirrorOpponentCards: true,
    showOpponentBadges: true,
    showOpponentTooltips: true
  };
  
  // ------------------------------------------------------------------
  // SAVE HELPERS: Save state helpers
  // ------------------------------------------------------------------
function getP1(){ return STATE.p1; }
function getP2(){ return STATE.p2; }
function getTurn(){ return { turn: STATE.turn, phase: STATE.phase, activeSeat: STATE.activeSeat }; }
function getPlayerLabel(){ return STATE.playerLabel; }
function dumpLiveSettings(){ return { ...UISettingsLive }; }


  // ------------------------------------------------------------------
  // UI HELPERS: attacker/defender rail state visuals
  // ------------------------------------------------------------------
  function _markAttackerUI() {
    ['a','b'].forEach(sfx=>{
      const combatBtn = document.getElementById(`ui-btn-cross-${sfx}`);
      const endBtn    = document.getElementById(`ui-btn-end-${sfx}`);
      if (combatBtn) {
        combatBtn.textContent = '⚔️ Battle';
        combatBtn.dataset.mode = 'attack';
        combatBtn.style.opacity = '1';
      }
      if (endBtn) {
        endBtn.disabled = false;
        endBtn.style.opacity = '1';
        endBtn.style.pointerEvents = 'auto';
      }
    });
  }

  function _markDefenderUI() {
    ['a','b'].forEach(sfx=>{
      const combatBtn = document.getElementById(`ui-btn-cross-${sfx}`);
      const endBtn    = document.getElementById(`ui-btn-end-${sfx}`);
      if (combatBtn) {
        combatBtn.textContent = '🛡️ Block';
        combatBtn.dataset.mode = 'defend';
        combatBtn.style.opacity = '.7';
      }
      if (endBtn) {
        endBtn.disabled = true;
        endBtn.style.opacity = '.4';
        endBtn.style.pointerEvents = 'none';
      }
    });
  }

  // ------------------------------------------------------------------
  // PUBLIC MOUNT
  // ------------------------------------------------------------------
  function mount() {
  injectStyles();
  injectMarkup();
  wireEvents();
  render();
  layoutHudFromSettings(UISettingsLive);

  // NEW: install life sync receiver once
  setupLifeRtc(); // <— add this line
}


  // ------------------------------------------------------------------
  // STYLES (adds life bar, HUD rails, drawer, settings panel styles)
  // ------------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById('ui-styles')) return;
    const css = `
:root{
  /* Deep blue UI palette */
  --ui-deep-0:#0a1b2c;
  --ui-deep-1:#0d2742;
  --ui-deep-2:#103255;
  --ui-deep-3:#0b1f37;
  --ui-accent:#2f8dff;
  --ui-accent-2:#6fb0ff;
  --ui-text:#e8f1ff;
  --ui-muted:#a7bedb;

  --ui-drawer-w: 320px;
  --ui-rail-gap: 14px;
  --ui-rail-w: 64px;
  --ui-handle: 52px;
  --ui-round: 56px;
  --ui-shadow: 0 12px 28px rgba(0,0,0,.35);
  --ui-radius: 14px;

  --ui-life-h: 36px;
}

/* rail vertical anchor below life bar etc. */
:root {
  --ui-hud-offset-y: calc(var(--ui-life-h) + 12px);
}

body { color: var(--ui-text); }

/* Top life bar */
.ui-life {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  height: var(--ui-life-h);
  z-index: 1000;
  background: linear-gradient(180deg, var(--ui-deep-2), var(--ui-deep-1));
  border-bottom: 1px solid rgba(255,255,255,.08);
  box-shadow: 0 8px 20px rgba(0,0,0,.25);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 12px;
  font: 600 13px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  letter-spacing: .2px;
}
.ui-life .left { justify-self: start; opacity: .95; }
.ui-life .center { justify-self: center; opacity: .95; }
.ui-life .right { justify-self: end; opacity: .95; }
.ui-life .pill {
  background: linear-gradient(180deg, var(--ui-deep-3), var(--ui-deep-2));
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 999px;
  padding: 6px 10px;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.03);
}

/* 🔵 NEW: green ring for the active seat */
.ui-life .pill.is-active {
  border-color: rgba(97,211,110,.9);
  box-shadow:
    0 0 0 2px rgba(97,211,110,.9),
    0 0 18px rgba(97,211,110,.6),
    inset 0 0 0 1px rgba(255,255,255,.06);
}


/* Drawer shell */
.ui-drawer {
  position: fixed;
  top: var(--ui-life-h);
  right: 0;
  width: var(--ui-drawer-w);
  height: calc(100% - var(--ui-life-h));
  transform: translateX(100%);
  transition: transform 300ms cubic-bezier(.22,.61,.36,1);
  background: linear-gradient(
    180deg,
    var(--ui-deep-2),
    var(--ui-deep-1) 60%,
    var(--ui-deep-2)
  );
  border-left: 1px solid rgba(255,255,255,.10);
  box-shadow: var(--ui-shadow);
  display: flex;
  flex-direction: column;
  padding: 12px 16px 16px;
  box-sizing: border-box;
  z-index: 900; /* under life bar, above table */
}
body.ui-drawer-open .ui-drawer { transform: translateX(0); }

.ui-drawer-section {
  flex:1;
  min-height:0;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}

.ui-drawer-head {
  flex:none;
  margin:0 0 10px 0;
}
.ui-drawer-head h3 {
  margin:0 0 4px 0;
  font-size:14px;
  letter-spacing:.3px;
  font-weight:600;
  color:var(--ui-text);
}
.ui-drawer-head p {
  margin:0;
  color:var(--ui-muted);
  font-size:12px;
  line-height:1.3;
}

/* controls view body */
.ui-actions {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.ui-linebtn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  background:
    radial-gradient(circle at 20% 20%, rgba(255,255,255,.06) 0%, rgba(0,0,0,0) 60%),
    linear-gradient(180deg, rgba(15,30,48,1) 0%, rgba(7,18,32,1) 100%);
  border: 1px solid rgba(255,255,255,.12);
  box-shadow:
    0 18px 32px rgba(0,0,0,.7),
    0 2px 4px rgba(0,0,0,.8),
    inset 0 0 0 1px rgba(255,255,255,.03);
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text);
  text-align: left;
  line-height: 1.3;
  cursor: pointer;
  user-select: none;
  transition: filter .12s ease, box-shadow .12s ease, transform .12s ease;
}
.ui-linebtn:hover {
  filter: brightness(1.07);
  box-shadow:
    0 22px 40px rgba(0,0,0,.8),
    0 3px 6px rgba(0,0,0,.8),
    inset 0 0 0 1px rgba(255,255,255,.06);
  transform: translateY(-1px);
}
.ui-linebtn:active {
  transform: translateY(0);
}
.ui-linebtn .ico {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  font-size: 14px;
  line-height: 1;
  text-shadow: 0 0 4px rgba(0,0,0,.8);
}

/* settings view body */
.ui-settings-scroll {
  flex:1;
  min-height:0;
  overflow-y:auto;
  overflow-x:hidden;
  padding-right:8px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,.2) rgba(0,0,0,0);
}
.ui-settings-scroll::-webkit-scrollbar { width:6px; }
.ui-settings-scroll::-webkit-scrollbar-thumb {
  background:rgba(255,255,255,.2);
  border-radius:4px;
}

.set-group {
  background:linear-gradient(180deg, var(--ui-deep-3), var(--ui-deep-2));
  border:1px solid rgba(255,255,255,.08);
  box-shadow:0 10px 24px rgba(0,0,0,.4), inset 0 0 0 1px rgba(255,255,255,.03);
  border-radius:12px;
  padding:12px 12px 10px 12px;
  margin-bottom:14px;
}
.set-group-title {
  font-size:12px;
  font-weight:700;
  letter-spacing:.4px;
  margin:0 0 10px 0;
  color:var(--ui-accent);
  text-shadow:0 0 6px rgba(47,141,255,.4);
  display:flex;
  align-items:baseline;
  justify-content:space-between;
}
.set-group-title span.desc {
  font-size:11px;
  font-weight:400;
  color:var(--ui-muted);
  text-shadow:none;
  letter-spacing:.2px;
  line-height:1.3;
}

.set-row {
  display:grid;
  grid-template-columns: 1fr auto;
  align-items:center;
  gap:10px;
  margin-bottom:10px;
  font-size:12px;
  line-height:1.2;
  color:var(--ui-text);
}
.set-left {
  display:flex;
  flex-direction:column;
}
.set-left .lbl {
  font-weight:600;
  letter-spacing:.3px;
  display:flex;
  flex-wrap:wrap;
  align-items:flex-start;
  justify-content:flex-start;
  text-align:left;
  gap:6px;
}
.set-left .sublbl {
  font-size:11px;
  color:var(--ui-muted);
  letter-spacing:.2px;
  line-height:1.2;
  margin-top:2px;
  text-align:left;
}

.set-row-controls {
  display:flex;
  flex-wrap:nowrap;
  align-items:center;
  gap:6px;
}

.set-right {
  display:flex;
  flex-wrap:nowrap;
  align-items:center;
  gap:6px;
}
.set-num {
  width:52px;
  background:rgba(0,0,0,.4);
  border:1px solid rgba(255,255,255,.15);
  border-radius:8px;
  padding:4px 6px;
  color:var(--ui-text);
  font-size:12px;
  font-weight:600;
  line-height:1.2;
  text-align:right;
}
.set-num:focus {
  outline:2px solid var(--ui-accent-2);
  outline-offset:0;
}

.set-slider {
  -webkit-appearance:none;
  appearance:none;
  height:4px;
  border-radius:999px;
  background:rgba(255,255,255,.15);
  flex:1;
}
.set-slider::-webkit-slider-thumb {
  -webkit-appearance:none;
  appearance:none;
  width:14px;
  height:14px;
  border-radius:999px;
  background:var(--ui-accent);
  box-shadow:0 0 8px rgba(111,176,255,.6);
  border:1px solid rgba(255,255,255,.4);
  cursor:pointer;
}

.set-toggle-row {
  display:grid;
  grid-template-columns: 1fr auto;
  align-items:center;
  gap:10px;
  margin-bottom:10px;
  font-size:12px;
  line-height:1.2;
  color:var(--ui-text);
}
.set-toggle-labels {
  display:flex;
  flex-direction:column;
}
.set-toggle-labels .lbl {
  font-weight:600;
  letter-spacing:.3px;
  display:flex;
  flex-wrap:wrap;
  align-items:flex-start;
  gap:6px;
}
.set-toggle-labels .sublbl {
  font-size:11px;
  color:var(--ui-muted);
  letter-spacing:.2px;
  line-height:1.2;
  margin-top:2px;
}

.set-toggle-shell {
  display:flex;
  align-items:center;
  justify-content:flex-end;
}

.set-toggle {
  width:36px;
  height:20px;
  border-radius:999px;
  background:rgba(255,255,255,.15);
  border:1px solid rgba(255,255,255,.12);
  position:relative;
  cursor:pointer;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.6), 0 6px 12px rgba(0,0,0,.6);
  user-select:none;
}
.set-toggle[data-on="true"] {
  background:var(--ui-accent);
  border-color:rgba(255,255,255,.4);
  box-shadow:0 0 10px rgba(47,141,255,.7),0 8px 20px rgba(0,0,0,.7);
}
.set-toggle-knob {
  position:absolute;
  top:2px;
  left:2px;
  width:14px;
  height:14px;
  border-radius:999px;
  background:var(--ui-deep-0);
  border:1px solid rgba(255,255,255,.4);
  box-shadow:0 0 6px rgba(0,0,0,.8),0 4px 10px rgba(0,0,0,.8);
  transition:left .15s ease;
}
.set-toggle[data-on="true"] .set-toggle-knob {
  left: calc(100% - 16px);
}

/* footer bar for Apply / Cancel in settings mode */
.ui-settings-shell {
  flex:1;
  min-height:0;
  display:flex;
  flex-direction:column;
}
.ui-settings-footer {
  flex:none;
  padding-top:8px;
  display:grid;
  grid-template-columns:1fr 1fr 1fr;
  gap:10px;
}
.ui-footer-btn {
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  font-size:12px;
  font-weight:700;
  padding:10px 12px;
  border-radius:10px;
  background:linear-gradient(180deg,var(--ui-deep-3),var(--ui-deep-2));
  border:1px solid rgba(255,255,255,.12);
  color:var(--ui-text);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.03),0 8px 18px rgba(0,0,0,.4);
  cursor:pointer;
  user-select:none;
}
.ui-footer-btn.danger {
  color:#ff5c5c;
  border-color:rgba(255,92,92,.4);
  text-shadow:0 0 8px rgba(255,92,92,.4);
}

/* Settings tabs */
.ui-settings-tabs {
  flex:none;
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  margin:0 0 10px 0;
}
.ui-settings-tabbtn {
  flex:0 0 auto;
  border-radius:8px;
  border:1px solid rgba(255,255,255,.15);
  background:linear-gradient(180deg,var(--ui-deep-3),var(--ui-deep-2));
  color:var(--ui-text);
  font-size:11px;
  font-weight:700;
  letter-spacing:.3px;
  line-height:1.2;
  padding:6px 8px;
  cursor:pointer;
  box-shadow:0 8px 18px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.03);
  user-select:none;
}
.ui-settings-tabbtn[data-active="true"]{
  border-color:var(--ui-accent);
  box-shadow:0 0 10px rgba(47,141,255,.7),0 8px 20px rgba(0,0,0,.7),inset 0 0 0 1px rgba(255,255,255,.06);
  text-shadow:0 0 6px rgba(47,141,255,.6);
  color:var(--ui-accent);
}

/* RAIL: pinned control puck cluster */
.ui-rail {
  position:fixed;
  width:var(--ui-rail-w);
  display:grid;
  justify-items:center;
  gap:12px;
  z-index:950;
  transition:transform 300ms cubic-bezier(.22,.61,.36,1);
  pointer-events:none;
}
.ui-rail > * { pointer-events:auto; }

/* hidden clone rail by default */
.ui-rail[data-hidden="true"] {
  display:none;
}

.ui-tab {
  width:var(--ui-handle);
  height:var(--ui-handle);
  border-radius:999px;
  border:1px solid rgba(255,255,255,.12);
  background:radial-gradient(ellipse at 30% 30%, var(--ui-deep-2), var(--ui-deep-3) 60%);
  display:grid;
  place-items:center;
  box-shadow:var(--ui-shadow);
  cursor:pointer;
  position:relative;
  color:var(--ui-text);
  user-select:none;
  touch-action:none;
}
.ui-tab .chev {
  font-size:22px;
  line-height:1;
  transition:transform 300ms ease;
}

.ui-round {
  width:var(--ui-round);
  height:var(--ui-round);
  border-radius:999px;
  display:grid;
  place-items:center;
  background:linear-gradient(180deg, var(--ui-deep-3), var(--ui-deep-2));
  border:1px solid rgba(255,255,255,.12);
  box-shadow:var(--ui-shadow);
  cursor:pointer;
  font-weight:800;
  user-select:none;
  text-align:center;
  color:var(--ui-text);
  touch-action:none;
}
.ui-round small {
  font-size:10.5px;
  letter-spacing:.6px;
  line-height:1.05;
}
.ui-ico { font-size:19px; }
.ui-ico-cross { font-size:20px; }

.ui-round:focus-visible,
.ui-tab:focus-visible,
.ui-footer-btn:focus-visible,
.ui-linebtn:focus-visible {
  outline:2px solid var(--ui-accent-2);
  outline-offset:2px;
}

.life-red   { color:#ff5c5c; font-weight:800; }
.life-white { color:#ffffff; font-weight:800; }
.life-green { color:#61d36e; font-weight:800; }

/* Life Editor Overlay (compact 3-column: Life / Commander / Infect) */
#lifeOverlay {
  position: fixed; inset: 0; z-index: 2000;
  display: none; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 40%, rgba(0,0,0,.65), rgba(0,0,0,.85));
}
#lifeOverlay[data-open="true"] { display: flex; }
#lifeOverlay .panel{
  width: 360px; max-width: calc(100% - 32px);
  background: linear-gradient(180deg, var(--ui-deep-2), var(--ui-deep-1) 60%, var(--ui-deep-2));
  border: 1px solid rgba(255,255,255,.12);
  box-shadow: 0 20px 60px rgba(0,0,0,.6);
  border-radius: 12px; padding: 14px; color: var(--ui-text);
  font: 600 13px/1.25 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
}
#lifeOverlay .hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
#lifeOverlay h4{margin:0;font-size:14px;letter-spacing:.25px;}
#lifeOverlay .grid{
  display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; text-align:center; margin-top:6px;
}
#lifeOverlay .label{opacity:.9; font-weight:700; margin-bottom:4px;}
#lifeOverlay .arrow{
  display:inline-flex; align-items:center; justify-content:center;
  width: 36px; height: 28px; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(255,255,255,.12);
  background: linear-gradient(180deg, var(--ui-deep-3), var(--ui-deep-2));
  user-select:none;
}
#lifeOverlay .value{
  width:100%; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
  background: rgba(12,22,36,.6); color: var(--ui-text); font-weight:800;
  display:flex; align-items:center; justify-content:center;
}
#lifeOverlay .footer{display:flex; gap:8px; justify-content:flex-end; margin-top:12px;}
#lifeOverlay .btn{
  padding:9px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
  background: linear-gradient(180deg, var(--ui-deep-3), var(--ui-deep-2));
  color: var(--ui-text); font-weight:700; cursor:pointer; user-select:none;
}
#lifeOverlay .btn.primary{ background: linear-gradient(180deg, #2f8dff, #1b68c6); }



/* Rail slide-left when drawer open IF the rail is on the right edge */
body.ui-drawer-open .ui-rail[data-side="right"] {
  transform: translateX(calc(-1 * (var(--ui-drawer-w) + var(--ui-rail-gap))));
}
body.ui-drawer-open .ui-rail[data-side="right"] .ui-tab .chev {
  transform: rotate(180deg);
}
`;
    const style = document.createElement('style');
    style.id = 'ui-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------------
  // MARKUP (life bar, drawer shell, rails)
  // drawerMode swaps between "controls" and "settings"
  // ------------------------------------------------------------------
  function injectMarkup() {
    // Life bar
    if (!document.querySelector('.ui-life')) {
      const life = document.createElement('div');
      life.className = 'ui-life';
      life.innerHTML = `
  <div class="left">
    <span class="pill" id="ui-p1-pill">
      P1&nbsp;<span class="life-red">40</span>&nbsp;<span class="life-white">21</span>&nbsp;<span class="life-green">0</span>
    </span>
  </div>
  <div class="center">
    <span class="pill" id="ui-turn-pill">Turn: 1 – Player 1 – Phase: Main 1</span>
  </div>

  <div class="right">
    <span class="pill" id="ui-p2-pill">
      P2&nbsp;<span class="life-red">40</span>&nbsp;<span class="life-white">21</span>&nbsp;<span class="life-green">0</span>
    </span>
  </div>
`;
document.body.appendChild(life);

// Life editor overlay (compact 3-column)
if (!document.getElementById('lifeOverlay')) {
  const ov = document.createElement('div');
  ov.id = 'lifeOverlay';
  ov.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" aria-label="Edit Life">
      <div class="hdr">
        <h4 id="lifeOverlayTitle">Edit Life – P1</h4>
        <button class="btn" id="lifeCloseBtn" aria-label="Close">✕</button>
      </div>

      <div class="grid">
        <div class="label">Life</div>
        <div class="label">Commander</div>
        <div class="label">Infect</div>

        <div class="arrow" data-step="total:+1">▲</div>
        <div class="arrow" data-step="mid:+1">▲</div>
        <div class="arrow" data-step="poison:+1">▲</div>

        <div class="value" id="lifeTotalValue">40</div>
        <div class="value" id="lifeMidValue">21</div>
        <div class="value" id="lifePoisonValue">0</div>

        <div class="arrow" data-step="total:-1">▼</div>
        <div class="arrow" data-step="mid:-1">▼</div>
        <div class="arrow" data-step="poison:-1">▼</div>
      </div>

      <div class="footer">
        <button class="btn" id="lifeCancelBtn">Cancel</button>
        <button class="btn primary" id="lifeApplyBtn">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
}

}

    }

    // Drawer shell
    if (!document.querySelector('.ui-drawer')) {
      const drawer = document.createElement('aside');
      drawer.className = 'ui-drawer';
      drawer.setAttribute('aria-label', 'Settings Drawer');

      drawer.innerHTML = `
        <div class="ui-drawer-section" id="ui-drawer-controls">
          <div class="ui-drawer-head">
            <h3>Controls</h3>
            <p>Configure or manage your session.</p>
          </div>
          <div class="ui-actions">
            <button type="button" class="ui-linebtn" id="ui-btn-settings">
              <span class="ico">⚙️</span>
              <span>Settings</span>
            </button>

            <button type="button" class="ui-linebtn" id="ui-btn-save">
              <span class="ico">🇺🇸</span>
              <span>Save</span>
            </button>

            <button type="button" class="ui-linebtn" id="ui-btn-load">
              <span class="ico">📂</span>
              <span>Load</span>
            </button>
          </div>
        </div>

        <div class="ui-drawer-section" id="ui-drawer-settings" style="display:none;">
          <div class="ui-drawer-head">
            <h3>Settings</h3>
            <p>Tune scale, spacing, offsets, and visibility.</p>
          </div>

          <div class="ui-settings-shell">
            <div class="ui-settings-tabs">
              <button class="ui-settings-tabbtn" data-tabbtn="cards"  data-active="true">Cards / Tooltip</button>
              <button class="ui-settings-tabbtn" data-tabbtn="badges" data-active="false">Badges / P&nbsp;/&nbsp;T</button>
              <button class="ui-settings-tabbtn" data-tabbtn="zones"  data-active="false">Zones / Combat</button>
              <button class="ui-settings-tabbtn" data-tabbtn="ui"     data-active="false">UI / Life Bar</button>
              <button class="ui-settings-tabbtn" data-tabbtn="camera" data-active="false">Camera / Visibility</button>
              <button class="ui-settings-tabbtn" data-tabbtn="misc"   data-active="false">Misc</button>
            </div>

            <!-- SCROLL AREA -->
            <div class="ui-settings-scroll">

              <!-- TAB: CARDS / TOOLTIP -->
              <div class="settings-panel" data-tab="cards" style="display:block;">
                <section class="set-group">
                  <div class="set-group-title">
                    <div>Cards & Tooltip</div>
                    <span class="desc">Hand size, table size, tooltip text / preview.</span>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Hand Card Height</div>
                      <div class="sublbl">px tall in the fan</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="80" max="240" step="1" id="s-handCardHeight">
                      <input class="set-num" type="number" id="n-handCardHeight">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Hand Spread</div>
                      <div class="sublbl">px horizontal offset between cards</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="0" max="60" step="1" id="s-handSpreadPx">
                      <input class="set-num" type="number" id="n-handSpreadPx">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Table Card Height</div>
                      <div class="sublbl">px tall on the felt</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="100" max="300" step="1" id="s-tableCardHeight">
                      <input class="set-num" type="number" id="n-tableCardHeight">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Tooltip Font Size</div>
                      <div class="sublbl">px base for oracle text</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="10" max="24" step="1" id="s-tooltipFontSize">
                      <input class="set-num" type="number" id="n-tooltipFontSize">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Tooltip Max Width</div>
                      <div class="sublbl">px wide</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="160" max="400" step="1" id="s-tooltipMaxWidth">
                      <input class="set-num" type="number" id="n-tooltipMaxWidth">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Tooltip Preview Height</div>
                      <div class="sublbl">px tall card art</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="80" max="280" step="1" id="s-tooltipPreviewHeight">
                      <input class="set-num" type="number" id="n-tooltipPreviewHeight">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Tooltip Button Size</div>
                      <div class="sublbl">px diameter for cog / wand / flip</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="16" max="48" step="1" id="s-tooltipButtonSize">
                      <input class="set-num" type="number" id="n-tooltipButtonSize">
                    </div>
                  </div>
                </section>
              </div>

              <!-- TAB: BADGES / PT -->
              <div class="settings-panel" data-tab="badges" style="display:none;">
                <section class="set-group">
                  <div class="set-group-title">
                    <div>Badges & P/T Sticker</div>
                    <span class="desc">Panel scale and offsets around each card.</span>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Badge Panel Scale</div>
                      <div class="sublbl">multiplier</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="0.3" max="1.5" step="0.05" id="s-badgePanelScale">
                      <input class="set-num" type="number" step="0.05" id="n-badgePanelScale">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Badge Offset X / Y</div>
                      <div class="sublbl">px from card edge</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-num" type="number" id="n-badgeOffsetX" style="width:44px;">
                      <input class="set-num" type="number" id="n-badgeOffsetY" style="width:44px;">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">P/T Sticker Scale</div>
                      <div class="sublbl">multiplier</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="0.4" max="1.6" step="0.05" id="s-ptStickerScale">
                      <input class="set-num" type="number" step="0.05" id="n-ptStickerScale">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">P/T Offset X / Y</div>
                      <div class="sublbl">px from card corner</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-num" type="number" id="n-ptStickerOffsetX" style="width:44px;">
                      <input class="set-num" type="number" id="n-ptStickerOffsetY" style="width:44px;">
                    </div>
                  </div>
                </section>
              </div>

              <!-- TAB: ZONES / COMBAT -->
              <div class="settings-panel" data-tab="zones" style="display:none;">
                <section class="set-group">
                  <div class="set-group-title">
                    <div>Zones & Combat</div>
                    <span class="desc">Table layout, lanes, snap distances.</span>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Hand Zone Height</div>
                      <div class="sublbl">px reserved at bottom</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="80" max="300" step="1" id="s-handZoneHeight">
                      <input class="set-num" type="number" id="n-handZoneHeight">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Combat Gap Height</div>
                      <div class="sublbl">px padding between player rows</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="0" max="300" step="1" id="s-combatGapHeight">
                      <input class="set-num" type="number" id="n-combatGapHeight">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Attack Push Distance</div>
                      <div class="sublbl">px attackers lunge forward</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="0" max="200" step="1" id="s-attackPushDistance">
                      <input class="set-num" type="number" id="n-attackPushDistance">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Blocker Snap Offset</div>
                      <div class="sublbl">px blocker stands in front</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="0" max="200" step="1" id="s-blockerSnapOffset">
                      <input class="set-num" type="number" id="n-blockerSnapOffset">
                    </div>
                  </div>
                </section>
              </div>

              <!-- TAB: UI / LIFE BAR -->
              <div class="settings-panel" data-tab="ui" style="display:none;">
                <section class="set-group">
                  <div class="set-group-title">
                    <div>UI Chrome / Life Bar</div>
                    <span class="desc">Button sizing & accent color.</span>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">UI Button Height</div>
                      <div class="sublbl">px tall for drawer buttons</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="20" max="60" step="1" id="s-uiButtonHeight">
                      <input class="set-num" type="number" id="n-uiButtonHeight">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">UI Button Font Size</div>
                      <div class="sublbl">px label text</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="10" max="24" step="1" id="s-uiButtonFontSize">
                      <input class="set-num" type="number" id="n-uiButtonFontSize">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Life Font Size</div>
                      <div class="sublbl">px in the top pills</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="10" max="24" step="1" id="s-lifeFontSize">
                      <input class="set-num" type="number" id="n-lifeFontSize">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Accent Color</div>
                      <div class="sublbl">theme blue hex</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-num" type="text" id="n-uiThemeColor" style="width:76px;">
                    </div>
                  </div>
                </section>
              </div>

              <!-- TAB: CAMERA / VISIBILITY -->
              <div class="settings-panel" data-tab="camera" style="display:none;">
                <section class="set-group">
                  <div class="set-group-title">
                    <div>Camera & Visibility</div>
                    <span class="desc">What shows up, and default zoom.</span>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Default Zoom</div>
                      <div class="sublbl">1.0 = current baseline</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="0.4" max="2.0" step="0.05" id="s-cameraDefaultZoom">
                      <input class="set-num" type="number" step="0.05" id="n-cameraDefaultZoom">
                    </div>
                  </div>

                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Default Pan Y</div>
                      <div class="sublbl">px vertical offset on load</div>
                    </div>
                    <div class="set-row-controls">
                      <input class="set-slider" type="range" min="-500" max="500" step="5" id="s-cameraDefaultPanY">
                      <input class="set-num" type="number" id="n-cameraDefaultPanY">
                    </div>
                  </div>

                  <div class="set-toggle-row">
                    <div class="set-toggle-labels">
                      <div class="lbl">Tooltip on Drag Exit Hand</div>
                      <div class="sublbl">show as soon as card leaves hand</div>
                    </div>
                    <div class="set-toggle-shell">
                      <div class="set-toggle" id="t-showTooltipOnDragExitHand" data-on="true">
                        <div class="set-toggle-knob"></div>
                      </div>
                    </div>
                  </div>

                  <div class="set-toggle-row">
                    <div class="set-toggle-labels">
                      <div class="lbl">Mirror Opponent Cards</div>
                      <div class="sublbl">opponent appears across table</div>
                    </div>
                    <div class="set-toggle-shell">
                      <div class="set-toggle" id="t-mirrorOpponentCards" data-on="true">
                        <div class="set-toggle-knob"></div>
                      </div>
                    </div>
                  </div>

                  <div class="set-toggle-row">
                    <div class="set-toggle-labels">
                      <div class="lbl">Show Opponent Badges</div>
                      <div class="sublbl">types / buffs on their cards</div>
                    </div>
                    <div class="set-toggle-shell">
                      <div class="set-toggle" id="t-showOpponentBadges" data-on="true">
                        <div class="set-toggle-knob"></div>
                      </div>
                    </div>
                  </div>

                  <div class="set-toggle-row">
                    <div class="set-toggle-labels">
                      <div class="lbl">Show Opponent Tooltips</div>
                      <div class="sublbl">tap to inspect their cards</div>
                    </div>
                    <div class="set-toggle-shell">
                      <div class="set-toggle" id="t-showOpponentTooltips" data-on="true">
                        <div class="set-toggle-knob"></div>
                      </div>
                    </div>
                  </div>

                </section>
              </div>

              <!-- TAB: MISC -->
              <div class="settings-panel" data-tab="misc" style="display:none;">
                <section class="set-group">
                  <div class="set-group-title">
                    <div>Misc</div>
                    <span class="desc">Tooltip dock edge, HUD button placement, mirror.</span>
                  </div>

                  <!-- Tooltip Dock Edge -->
                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">Tooltip Dock Edge</div>
                      <div class="sublbl">where slim-mode tooltip pins (left / right / top / bottom)</div>
                    </div>
                    <div class="set-row-controls">
                      <select class="set-num" id="n-tooltipDockEdge" style="width:auto;">
                        <option value="right">Right</option>
                        <option value="left">Left</option>
                        <option value="top">Top</option>
                        <option value="bottom">Bottom</option>
                      </select>
                    </div>
                  </div>

                  <!-- HUD Placement Grid -->
                  <div class="set-row">
                    <div class="set-left">
                      <div class="lbl">HUD Button Placement</div>
                      <div class="sublbl">Tap where you want ⚔️ / End Turn.</div>
                    </div>
                    <div class="set-row-controls" style="flex-direction:column; align-items:flex-start; gap:8px;">

                      <!-- visual grid (2 columns, 3 rows) -->
                      <div style="display:grid;grid-template-columns:auto auto;gap:6px;font-size:11px;line-height:1.2;color:var(--ui-text);">
                        <label style="display:flex;align-items:center;gap:4px;">
                          <input type="radio" name="hudPlacementRadio" value="UL" style="accent-color:var(--ui-accent);">
                          <span>UL</span>
                        </label>

                        <label style="display:flex;align-items:center;gap:4px;">
                          <input type="radio" name="hudPlacementRadio" value="DU" style="accent-color:var(--ui-accent);">
                          <span>DU</span>
                        </label>

                        <label style="display:flex;align-items:center;gap:4px;">
                          <input type="radio" name="hudPlacementRadio" value="L" style="accent-color:var(--ui-accent);">
                          <span>L</span>
                        </label>

                        <label style="display:flex;align-items:center;gap:4px;">
                          <input type="radio" name="hudPlacementRadio" value="R" style="accent-color:var(--ui-accent);">
                          <span>R</span>
                        </label>

                        <label style="display:flex;align-items:center;gap:4px;">
                          <input type="radio" name="hudPlacementRadio" value="DL" style="accent-color:var(--ui-accent);">
                          <span>DL</span>
                        </label>

                        <label style="display:flex;align-items:center;gap:4px;">
                          <input type="radio" name="hudPlacementRadio" value="DR" style="accent-color:var(--ui-accent);">
                          <span>DR</span>
                        </label>
                      </div>

                      <div style="font-size:10px;color:var(--ui-muted);line-height:1.3;">
                        UL/UR = near life bar, L/R = side, DL/DR = above hand, DU = under turn pill
                        (UR is auto-picked when you choose R at the top row).
                      </div>

                      <!-- Mirror toggle -->
                      <div class="set-toggle-row" style="width:100%;margin-top:6px;">
                        <div class="set-toggle-labels">
                          <div class="lbl">Mirror HUD</div>
                          <div class="sublbl">duplicate buttons opposite side</div>
                        </div>
                        <div class="set-toggle-shell">
                          <div class="set-toggle" id="t-hudMirror" data-on="false">
                            <div class="set-toggle-knob"></div>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>

                </section>
              </div>

            </div><!-- /ui-settings-scroll -->

            <div class="ui-settings-footer">
              <button class="ui-footer-btn danger" id="ui-btn-cancelSettings">
                <span>✖️</span> <span>Cancel</span>
              </button>
              <button class="ui-footer-btn" id="ui-btn-defaultSettings">
                <span>♻️</span> <span>Default</span>
              </button>
              <button class="ui-footer-btn" id="ui-btn-applySettings">
                <span>💾</span> <span>Apply</span>
              </button>
            </div>
          </div><!-- /ui-settings-shell -->
        </div>
      `;
      document.body.appendChild(drawer);
    }

    // Rails (primary + optional mirror)
    if (!document.getElementById('ui-rail-a')) {
      const railA = document.createElement('div');
      railA.className = 'ui-rail';
      railA.id = 'ui-rail-a';
      railA.setAttribute('aria-label', 'Dock Controls A');
      railA.innerHTML = `
        <button class="ui-tab" id="ui-tab-toggle-a" aria-expanded="false" title="Toggle Panel">
          <span class="chev">❮</span>
        </button>
        <button class="ui-round" id="ui-btn-cross-a" title="Battle">
          <span class="ui-ico ui-ico-cross">⚔️</span>
        </button>
        <button class="ui-round" id="ui-btn-end-a" title="End Turn">
          <small>END<br>TURN</small>
        </button>
      `;
      document.body.appendChild(railA);
    }

    if (!document.getElementById('ui-rail-b')) {
      const railB = document.createElement('div');
      railB.className = 'ui-rail';
      railB.id = 'ui-rail-b';
      railB.setAttribute('aria-label', 'Dock Controls B');
      railB.setAttribute('data-hidden','true'); // start hidden
      railB.innerHTML = `
        <button class="ui-tab" id="ui-tab-toggle-b" aria-expanded="false" title="Toggle Panel">
          <span class="chev">❮</span>
        </button>
        <button class="ui-round" id="ui-btn-cross-b" title="Battle">
          <span class="ui-ico ui-ico-cross">⚔️</span>
        </button>
        <button class="ui-round" id="ui-btn-end-b" title="End Turn">
          <small>END<br>TURN</small>
        </button>
      `;
      document.body.appendChild(railB);
    }
  

  // ------------------------------------------------------------------
  // TAB SWITCHER (settings tabs swap visible panel)
  // ------------------------------------------------------------------
  function activateSettingsTab(tabName){
    const allBtns = document.querySelectorAll('.ui-settings-tabbtn');
    allBtns.forEach(btn=>{
      const isMe = (btn.getAttribute('data-tabbtn') === tabName);
      btn.setAttribute('data-active', isMe ? 'true' : 'false');
    });

    const allPanels = document.querySelectorAll('.settings-panel');
    allPanels.forEach(p=>{
      const isMe = (p.getAttribute('data-tab') === tabName);
      p.style.display = isMe ? 'block' : 'none';
    });
  }

  // ------------------------------------------------------------------
  // EVENT WIRING (TOUCH-FIRST / POINTERDOWN-FIRST)
  // ------------------------------------------------------------------
  function wireEvents() {
  // 🔵 Life pills → open editor overlay
  const pillP1 = document.getElementById('ui-p1-pill');
  const pillP2 = document.getElementById('ui-p2-pill');
  pillP1?.addEventListener('pointerdown', (e) => { if (!e.button) openLifeOverlay(1); });
  pillP2?.addEventListener('pointerdown', (e) => { if (!e.button) openLifeOverlay(2); });

  // Overlay controls (compact ▲ value ▼ layout)
  const overlay      = document.getElementById('lifeOverlay');
  const titleEl      = document.getElementById('lifeOverlayTitle');
  const vTotal       = document.getElementById('lifeTotalValue');
  const vMid         = document.getElementById('lifeMidValue');
  const vPoison      = document.getElementById('lifePoisonValue');
  const closeBtn     = document.getElementById('lifeCloseBtn');
  const cancelBtn    = document.getElementById('lifeCancelBtn');
  const applyBtn     = document.getElementById('lifeApplyBtn');

  let editingSeat = 1;

  function syncValuesForSeat(seat){
    editingSeat = (Number(seat) === 2) ? 2 : 1;
    titleEl.textContent = `Edit Life – P${editingSeat}`;
    const cur = (editingSeat === 2) ? STATE.p2 : STATE.p1;
    vTotal.textContent  = String(cur.total|0);
    vMid.textContent    = String(cur.mid|0);
    vPoison.textContent = String(cur.poison|0);
  }
  function showOverlay(){ overlay?.setAttribute('data-open','true'); }
  function hideOverlay(){ overlay?.removeAttribute('data-open'); }

  window.openLifeOverlay  = (seat)=>{ syncValuesForSeat(seat); showOverlay(); };
  window.closeLifeOverlay = hideOverlay;

  closeBtn?.addEventListener('click', hideOverlay);
  cancelBtn?.addEventListener('click', hideOverlay);

  // ▲ / ▼ handling using data-step="field:+/-N"
  overlay?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-step]');
    if (!btn) return;
    const [field, stepStr] = String(btn.getAttribute('data-step')||'').split(':');
    let step = parseInt(stepStr, 10);
    if (!Number.isFinite(step)) return;

    // Shift+click for ±5
    if (ev.shiftKey) step *= 5;

    const bump = (node, d) => {
      node.textContent = String((parseInt(node.textContent||'0',10) || 0) + d);
    };

    if (field === 'total')  bump(vTotal,  step);
    if (field === 'mid')    bump(vMid,    step);
    if (field === 'poison') bump(vPoison, step);
  });

  // Apply → commit & broadcast (setLife() will render and _broadcastLife())
  applyBtn?.addEventListener('click', () => {
    const t = parseInt(vTotal.textContent||'0',10)  || 0;
    const m = parseInt(vMid.textContent||'0',10)    || 0;
    const p = parseInt(vPoison.textContent||'0',10) || 0;
    setLife(editingSeat, t, m, p, 'ui');
    hideOverlay();
  });


  // helper to wire one rail's buttons by suffix ('a' or 'b')
  function hookRail(suffix){

  const tabBtn    = document.getElementById(`ui-tab-toggle-${suffix}`);
  const battleBtn = document.getElementById(`ui-btn-cross-${suffix}`);
  const endBtn    = document.getElementById(`ui-btn-end-${suffix}`);

  // open/close drawer instantly on tap
  tabBtn?.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return; // only primary pointer
    e.preventDefault(); // claim tap so mobile doesn't treat as scroll
    setOpen(!STATE.open);
  });

  // Combat / Battle button
  battleBtn?.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    e.preventDefault();

    const btn = battleBtn;
    if (!btn) return;
    const modeNow = btn.dataset.mode; // "attack" or "defend"

    if (modeNow === 'attack') {
      // I'm the active player
      const battleMode = window.Battle?.getMode?.();
      if (battleMode === 'attacking') {
        console.log('[UI] Confirm attackers');
        window.Battle?.confirmAttackers();
      } else {
        console.log('[UI] Begin attacker selection');
        window.Battle?.beginAttackSelection();
      }
    } else {
      // I'm defending
      const battleMode = window.Battle?.getMode?.();
      if (battleMode === 'blocking') {
        console.log('[UI] Confirm blocks');
        window.Battle?.confirmBlocks();
      } else {
        console.log('[UI] Begin block selection');
        window.Battle?.beginBlockSelection();
      }
    }
  });

  // End Turn button
  endBtn?.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    try {
      const mine = (window.mySeat && window.mySeat()) || STATE.seat || 1;
      window.TurnUpkeep?.endTurnFrom(mine);
    } catch(err){
      console.warn('[UI] End Turn failed', err);
    }
  });
}



    // wire both rails
    hookRail('a');
    hookRail('b');

    // Drawer "Controls" view buttons
    document.getElementById('ui-btn-settings')?.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      showSettingsPanel();
    });

    document.getElementById('ui-btn-save')?.addEventListener('pointerdown', async (e) => {
  if (e.button && e.button !== 0) return;
  e.preventDefault();
  console.log('[UI] Save clicked');
  try {
    const { GameSave } = await import('./save.state.js');
    const result = await GameSave.saveAndMaybePingOpponent();
    console.log('[UI] Save complete', result);
    try {
      // Tiny inline confirmation with the shared Save ID
      const sid = result?.saveId || '(unknown)';
      alert('Saved. Save ID: ' + sid);
    } catch {}
  } catch (err) {
    console.warn('[UI] Save failed', err);
    alert('Save failed: ' + (err?.message || err));
  }
});


document.getElementById('ui-btn-load')?.addEventListener('pointerdown', async (e) => {
  if (e.button && e.button !== 0) return;
  e.preventDefault();
  console.log('[UI] Load clicked');
  try {
    const mod = await import('./load.state.js');
    const GameLoad = mod?.GameLoad || mod?.default || mod;
    if (!GameLoad) throw new Error('load.state.js not found or no GameLoad export');

    if (typeof GameLoad.openLoadPicker === 'function') {
      await GameLoad.openLoadPicker();
      console.log('[UI] Load picker opened');
      return;
    }

    if (typeof GameLoad.loadLatestForRoom === 'function') {
      await GameLoad.loadLatestForRoom();
      console.log('[UI] Loaded latest for room');
      return;
    }

    if (typeof GameLoad.loadBySaveId === 'function') {
      const sid = prompt('Enter Save ID to load:');
      if (sid) {
        await GameLoad.loadBySaveId(sid.trim());
        console.log('[UI] Loaded save:', sid);
      }
      return;
    }

    throw new Error('GameLoad has no known load methods');
  } catch (err) {
    console.warn('[UI] Load failed', err);
    alert('Load failed: ' + (err?.message || err));
  }
});


    // Settings footer buttons
    document.getElementById('ui-btn-cancelSettings')?.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      hideSettingsPanel(false); // revert to SessionBase snapshot
    });

    document.getElementById('ui-btn-defaultSettings')?.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      Object.assign(UISettingsDraft, UISettingsDefaults);
      hydrateSettingsInputsFromDraft();
      previewDraftSettings();
      console.log('[UI] DEFAULT SETTINGS PREVIEW', UISettingsDraft);
    });

    document.getElementById('ui-btn-applySettings')?.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      hideSettingsPanel(true); // commit to Live
    });

    // simple toggle handlers (touch-friendly)
    document.getElementById('t-showTooltipOnDragExitHand')?.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      flipToggle('showTooltipOnDragExitHand','t-showTooltipOnDragExitHand');
    });

    document.getElementById('t-mirrorOpponentCards')?.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      flipToggle('mirrorOpponentCards','t-mirrorOpponentCards');
    });

    document.getElementById('t-showOpponentBadges')?.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      flipToggle('showOpponentBadges','t-showOpponentBadges');
    });

    document.getElementById('t-showOpponentTooltips')?.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      flipToggle('showOpponentTooltips','t-showOpponentTooltips');
    });

    // tab buttons in settings (Cards / Badges / Zones / etc.)
    document.querySelectorAll('.ui-settings-tabbtn').forEach(btn=>{
      btn.addEventListener('pointerdown', (e)=>{
        if (e.button && e.button !== 0) return;
        e.preventDefault();
        const which = btn.getAttribute('data-tabbtn');
        activateSettingsTab(which);
      });
    });

    // tooltipDockEdge dropdown in Misc tab
    const dockSel = document.getElementById('n-tooltipDockEdge');
    if (dockSel){
      dockSel.addEventListener('input', ()=>{
        const val = dockSel.value;
        UISettingsDraft.tooltipDockEdge = val;
        previewDraftSettings(); // will call Tooltip.redockIfSlim() indirectly
      });
    }

    // HUD placement radios + mirror toggle
    document.querySelectorAll('[name="hudPlacementRadio"]').forEach(r=>{
      r.addEventListener('change', ()=>{
        if (r.checked){
          UISettingsDraft.hudPlacement = r.value;
          previewDraftSettings();
        }
      });
    });

    const hudMirrorToggle = document.getElementById('t-hudMirror');
    if (hudMirrorToggle){
      hudMirrorToggle.addEventListener('pointerdown', (e)=>{
        if (e.button && e.button !== 0) return;
        e.preventDefault();
        UISettingsDraft.hudMirror = !UISettingsDraft.hudMirror;
        hudMirrorToggle.dataset.on = UISettingsDraft.hudMirror ? 'true' : 'false';
        previewDraftSettings();
      });
    }

    // ESC closes drawer (desktop convenience)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && STATE.open) setOpen(false);
    });
  }

  // ------------------------------------------------------------------
  // TOGGLE HELPER
  // ------------------------------------------------------------------
  function flipToggle(key, domId){
    UISettingsDraft[key] = !UISettingsDraft[key];
    const el = document.getElementById(domId);
    if (el){
      el.dataset.on = UISettingsDraft[key] ? 'true' : 'false';
    }
    previewDraftSettings();
  }

  // ------------------------------------------------------------------
  // SETTINGS APPLICATION HELPERS
  // ------------------------------------------------------------------

  // helper: turn numbers into px strings, leave strings alone
  function px(v){
    if (typeof v === 'number' && Number.isFinite(v)) return v + 'px';
    return String(v);
  }

  // Write sizing-related settings into CSS vars / inline nodes without making them "official".
  // obj = UISettingsDraft OR UISettingsLive OR UISettingsDefaults
  function pushSettingsToCSSVars(obj){
    const rootStyle = document.documentElement.style;
    const hz = document.getElementById('handZone');

    // -------------------------
    // CARD SIZES
    // -------------------------
    // table card height drives how tall cards render on felt
    if (obj.tableCardHeight != null){
      rootStyle.setProperty('--card-height-table', px(obj.tableCardHeight));
    }

    // hand card height drives fan scale
    if (obj.handCardHeight != null){
      rootStyle.setProperty('--hand-card-height', px(obj.handCardHeight));
    }

    // -------------------------
    // HAND ZONE RESERVED HEIGHT
    // -------------------------
    if (obj.handZoneHeight != null){
      rootStyle.setProperty('--hand-zone-height', px(obj.handZoneHeight));
      if (hz){
        hz.style.height = px(obj.handZoneHeight);
      }
    }

    // -------------------------
    // COMBAT GAP / MID BAND
    //   combatGapHeight = EXTRA padding band between my row and opponent row.
    //   tableCardHeight = per-card height on table.
    //
    //   midGapPx = (tableCardHeight * 2) + combatGapHeight
    //
    //   -> --combat-height, --mid-gap
    // -------------------------
    if (obj.tableCardHeight != null || obj.combatGapHeight != null){
      const cardH = Number(obj.tableCardHeight != null
        ? obj.tableCardHeight
        : getComputedStyle(document.documentElement).getPropertyValue('--card-height-table').replace('px','')
      );

      const pad   = Number(obj.combatGapHeight != null
        ? obj.combatGapHeight
        : getComputedStyle(document.documentElement).getPropertyValue('--combat-height').replace('px','')
      );

      // Fallback guards
      const safeCardH = Number.isFinite(cardH) ? cardH : 180;
      const safePad   = Number.isFinite(pad)   ? pad   : 20;

      const midGapPx = (safeCardH * 2) + safePad;
      const midGapStr = midGapPx + 'px';

      rootStyle.setProperty('--combat-height', midGapStr);
      rootStyle.setProperty('--mid-gap',       midGapStr);
    }

    // -------------------------
    // ACCENT / THEME COLOR
    // -------------------------
    if (obj.uiThemeColor){
      const c = obj.uiThemeColor;
      rootStyle.setProperty('--ui-accent',   c);
      rootStyle.setProperty('--ui-accent-2', c);
    }

    // NOTE:
    // badge offsets, pt sticker offsets, life font size, button sizing,
    // camera defaults, etc. We'll broadcast those elsewhere later if needed.
  }

  // Tell the hand module to restyle+refan using obj (so sliders feel immediate).
  // We temporarily stash obj into _UISettingsLive so hand.js getLiveSettings() sees it.
  // BUT we don't mutate the real UISettingsLive unless you Apply.
  function refanHandFromSettings(obj){
    const backupLive = { ...UISettingsLive };
    try {
      Object.assign(UISettingsLive, obj);
      window.Hand?.refanAll?.(); // hand.js will read getLiveSettings() and re-fan
    } finally {
      Object.assign(UISettingsLive, backupLive);
    }
  }

  // Position #ui-rail-a and #ui-rail-b based on hudPlacement / hudMirror.
  // We drive coords with inline style (top/left/right/bottom), and mark data-side
  // so CSS knows which rail should slide when drawer opens.
  function layoutHudFromSettings(obj){
    const railA = document.getElementById('ui-rail-a');
    const railB = document.getElementById('ui-rail-b');
    if (!railA || !railB) return;

    // reset styles + side tag
    [railA, railB].forEach(r=>{
      r.style.top = '';
      r.style.left = '';
      r.style.right = '';
      r.style.bottom = '';
      // IMPORTANT: we do NOT nuke transform here, except where we explicitly set it.
      r.dataset.side = '';
    });

    const handZoneH = (obj.handZoneHeight != null) ? obj.handZoneHeight : UISettingsLive.handZoneHeight;
    const lifeH     = getComputedStyle(document.documentElement).getPropertyValue('--ui-life-h').trim() || '36px';
    const lifeHPx   = parseFloat(lifeH) || 36;

    const padTop    = lifeHPx + 12;
    const padBottom = (handZoneH || 220) + 12;

    const viewportH   = window.innerHeight || 800;
    const usableTop   = padTop;
    const usableBot   = viewportH - padBottom;
    const midRaw      = (usableTop + usableBot) / 2;

    const railBlockH  = 200;
    let midCenterPx = midRaw - (railBlockH / 2);
    if (midCenterPx < usableTop) {
      midCenterPx = usableTop;
    }
    const maxTopBeforeBottomOverlap = (usableBot - railBlockH);
    if (midCenterPx > maxTopBeforeBottomOverlap) {
      midCenterPx = maxTopBeforeBottomOverlap;
    }

    // helper: position + mark which side it's on
    function place(rail, slot){
      // clear transform first so DU can re-set it cleanly
      rail.style.transform = '';

      switch(slot){
        case 'R': // right mid
          rail.style.top   = midCenterPx + 'px';
          rail.style.right = '0px';
          rail.dataset.side = 'right';
          break;

        case 'L': // left mid
          rail.style.top   = midCenterPx + 'px';
          rail.style.left  = '0px';
          rail.dataset.side = 'left';
          break;

        case 'UR': // upper right by life bar
          rail.style.top   = (lifeHPx + 4) + 'px';
          rail.style.right = '8px';
          rail.dataset.side = 'right';
          break;

        case 'UL': // upper left by life bar
          rail.style.top   = (lifeHPx + 4) + 'px';
          rail.style.left  = '8px';
          rail.dataset.side = 'left';
          break;

        case 'DU': // centered under turn pill
          rail.style.top       = (lifeHPx + 48) + 'px';
          rail.style.left      = '50%';
          rail.style.transform = 'translateX(-50%)';
          rail.dataset.side    = 'center';
          break;

        case 'DR': // lower right above hand zone
          rail.style.bottom = padBottom + 'px';
          rail.style.right  = '0px';
          rail.dataset.side = 'right';
          break;

        case 'DL': // lower left above hand zone
          rail.style.bottom = padBottom + 'px';
          rail.style.left   = '0px';
          rail.dataset.side = 'left';
          break;

        default: // fallback -> behave like R mid
          rail.style.top   = midCenterPx + 'px';
          rail.style.right = '0px';
          rail.dataset.side = 'right';
          break;
      }
    }

    // place primary railA using requested hudPlacement
    place(railA, obj.hudPlacement || 'R');

    // place mirror railB if needed, else hide
    if (obj.hudMirror){
      railB.removeAttribute('data-hidden');
      let mirrorSlot = 'L';
      switch(obj.hudPlacement){
        case 'L':  mirrorSlot='R';  break;
        case 'R':  mirrorSlot='L';  break;
        case 'UL': mirrorSlot='UR'; break;
        case 'UR': mirrorSlot='UL'; break;
        case 'DL': mirrorSlot='DR'; break;
        case 'DR': mirrorSlot='DL'; break;
        case 'DU': mirrorSlot='DR'; break;
        default:   mirrorSlot='L';  break;
      }
      place(railB, mirrorSlot);
    } else {
      railB.setAttribute('data-hidden','true');
    }
  }

  // Live preview when user drags sliders / toggles in settings drawer.
  // We DO NOT commit to UISettingsLive here.
  function previewDraftSettings(){
    pushSettingsToCSSVars(UISettingsDraft);
    refanHandFromSettings(UISettingsDraft);

    // live-preview HUD rail placement / mirroring
    layoutHudFromSettings(UISettingsDraft);

    // tell Tooltip to re-dock if it's currently slim-docked
    try {
      if (window.Tooltip && typeof window.Tooltip.redockIfSlim === 'function') {
        window.Tooltip.redockIfSlim();
      }
    } catch(e){
      console.warn('[UI] previewDraftSettings -> Tooltip.redockIfSlim failed', e);
    }

    // TODO later: live-preview badge offsets, camera zoom, etc.
  }

  // Commit Draft permanently into Live (Apply button).
  function commitLiveSettings(){
    Object.assign(UISettingsLive, UISettingsDraft);
    pushSettingsToCSSVars(UISettingsLive);

    // lock in HUD layout
    layoutHudFromSettings(UISettingsLive);

    // Now mutate real hand layout for good.
    window.Hand?.refanAll?.();

    // Make sure tooltip's dock/lowProfile obeys final settings
    try {
      if (window.Tooltip && typeof window.Tooltip.redockIfSlim === 'function') {
        window.Tooltip.redockIfSlim();
      }
    } catch(e){
      console.warn('[UI] commitLiveSettings -> Tooltip.redockIfSlim failed', e);
    }

    console.log('[UI] APPLY SETTINGS:', UISettingsLive);
  }

  // ------------------------------------------------------------------
  // DRAWER OPEN/CLOSE
  // ------------------------------------------------------------------
  function setOpen(open) {
    STATE.open = !!open;
    document.body.classList.toggle('ui-drawer-open', STATE.open);

    // update aria-expanded on both rails' tabs
    ['a','b'].forEach(sfx=>{
      const t = document.getElementById(`ui-tab-toggle-${sfx}`);
      if (t) {
        t.setAttribute('aria-expanded', String(STATE.open));
      }
    });
  }

  // ------------------------------------------------------------------
  // SETTINGS PANEL SHOW/HIDE
  // ------------------------------------------------------------------
  function showSettingsPanel(){
    STATE.drawerMode = 'settings';

    // 1. Snapshot current Live -> SessionBase, so Cancel can restore EXACTLY this.
    UISettingsSessionBase = { ...UISettingsLive };

    // 2. Draft starts as a copy of Live right now.
    Object.assign(UISettingsDraft, UISettingsLive);

    // 3. Fill sliders/inputs/toggles from Draft.
    hydrateSettingsInputsFromDraft();

    // IMPORTANT:
    // We do NOT call previewDraftSettings() here.
    // Screen should stay how it is until user changes something.

    const controls = document.getElementById('ui-drawer-controls');
    const settings = document.getElementById('ui-drawer-settings');
    if (controls) controls.style.display = 'none';
    if (settings) settings.style.display = 'flex';
  }

  function hideSettingsPanel(applyChangesBoolean){
    if (applyChangesBoolean){
      // APPLY: Draft becomes Live for real.
      commitLiveSettings();
    } else {
      // CANCEL: throw away Draft changes and jump visuals back to SessionBase snapshot.
      Object.assign(UISettingsDraft, UISettingsSessionBase);
      Object.assign(UISettingsLive, UISettingsSessionBase);

      // push SessionBase back into CSS, hand, HUD, etc so screen reverts
      pushSettingsToCSSVars(UISettingsSessionBase);
      window.Hand?.refanAll?.();
      layoutHudFromSettings(UISettingsSessionBase);

      try {
        if (window.Tooltip && typeof window.Tooltip.redockIfSlim === 'function') {
          window.Tooltip.redockIfSlim();
        }
      } catch(e){
        console.warn('[UI] cancelSettings -> Tooltip.redockIfSlim failed', e);
      }

      console.log('[UI] CANCEL SETTINGS (reverted to SessionBase):', UISettingsSessionBase);
    }

    STATE.drawerMode = 'controls';
    const controls = document.getElementById('ui-drawer-controls');
    const settings = document.getElementById('ui-drawer-settings');
    if (controls) controls.style.display = 'flex';
    if (settings) settings.style.display = 'none';
  }

  // ------------------------------------------------------------------
  // SETTINGS PANEL INPUT SYNC
  // ------------------------------------------------------------------
  // take UISettingsDraft values and shove them into all fields/toggles
  function hydrateSettingsInputsFromDraft(){
    setNumPair('handCardHeight');
    setNumPair('handSpreadPx');
    setNumPair('tableCardHeight');

    setNumPair('tooltipFontSize');
    setNumPair('tooltipMaxWidth');
    setNumPair('tooltipPreviewHeight');
    setNumPair('tooltipButtonSize');

    setNumPair('handZoneHeight');
    setNumPair('combatGapHeight');
    setNumPair('attackPushDistance');
    setNumPair('blockerSnapOffset');

    setNumPair('badgePanelScale');
    setNumOnly('badgeOffsetX');
    setNumOnly('badgeOffsetY');

    setNumPair('ptStickerScale');
    setNumOnly('ptStickerOffsetX');
    setNumOnly('ptStickerOffsetY');

    setNumPair('uiButtonHeight');
    setNumPair('uiButtonFontSize');
    setNumPair('lifeFontSize');

    // theme color text only:
    const colorEl = document.getElementById('n-uiThemeColor');
    if (colorEl) colorEl.value = UISettingsDraft.uiThemeColor || '';

    setNumPair('cameraDefaultZoom');
    setNumPair('cameraDefaultPanY');

    // toggles:
    syncToggleFromDraft('showTooltipOnDragExitHand','t-showTooltipOnDragExitHand');
    syncToggleFromDraft('mirrorOpponentCards','t-mirrorOpponentCards');
    syncToggleFromDraft('showOpponentBadges','t-showOpponentBadges');
    syncToggleFromDraft('showOpponentTooltips','t-showOpponentTooltips');

    // misc dropdown:
    const dockSel = document.getElementById('n-tooltipDockEdge');
    if (dockSel){
      dockSel.value = UISettingsDraft.tooltipDockEdge || 'right';
    }

    // HUD placement radios
    const hp = UISettingsDraft.hudPlacement || 'R';
    document.querySelectorAll('[name="hudPlacementRadio"]').forEach(r=>{
      r.checked = (r.value === hp);
    });

    // HUD mirror toggle
    const hudMirrorEl = document.getElementById('t-hudMirror');
    if (hudMirrorEl){
      hudMirrorEl.dataset.on = UISettingsDraft.hudMirror ? 'true' : 'false';
    }

    // hook up input listeners so changes update draft live
    bindInputEvents();
  }

  function syncToggleFromDraft(key, domId){
    const el = document.getElementById(domId);
    if (!el) return;
    el.dataset.on = UISettingsDraft[key] ? 'true' : 'false';
  }

  function setNumPair(key){
    const s = document.getElementById('s-' + key);
    const n = document.getElementById('n-' + key);
    if (s) s.value = UISettingsDraft[key];
    if (n) n.value = UISettingsDraft[key];
  }

  function setNumOnly(key){
    const n = document.getElementById('n-' + key);
    if (n) n.value = UISettingsDraft[key];
  }

  function bindInputEvents(){
    // sliders: update Draft, mirror number, live-preview
    const sliders = document.querySelectorAll('.set-slider[id^="s-"]');
    sliders.forEach(sl => {
      sl.oninput = () => {
        const key = sl.id.replace(/^s-/, '');
        const val = parseFloat(sl.value);
        UISettingsDraft[key] = val;

        const mate = document.getElementById('n-' + key);
        if (mate) mate.value = val;

        previewDraftSettings();
      };
    });

    // numbers: update Draft, mirror slider, live-preview
    const nums = document.querySelectorAll('.set-num[id^="n-"]');
    nums.forEach(n => {
      // skip tooltipDockEdge select; handled separately
      if (n.id === 'n-tooltipDockEdge') return;

      n.oninput = () => {
        const key = n.id.replace(/^n-/, '');
        const raw = n.value;

        if (key === 'uiThemeColor'){
          // theme color is string, not parsed
          UISettingsDraft[key] = raw;
          previewDraftSettings();
          return;
        }

        const val = parseFloat(raw);
        if (!Number.isNaN(val)){
          UISettingsDraft[key] = val;
          const mate = document.getElementById('s-' + key);
          if (mate) mate.value = val;
          previewDraftSettings();
        }
      };
    });
  }

  // ------------------------------------------------------------------
  // RENDER LIFE BAR CONTENT
  // ------------------------------------------------------------------
  function render() {
    const left  = document.getElementById('ui-p1-pill');
    const right = document.getElementById('ui-p2-pill');
    const tn    = document.getElementById('ui-turn-pill');

    // choose which side shows which player
    const leftTag   = STATE.flipSides ? 'P2' : 'P1';
    const rightTag  = STATE.flipSides ? 'P1' : 'P2';
    const leftVals  = STATE.flipSides ? STATE.p2 : STATE.p1;
    const rightVals = STATE.flipSides ? STATE.p1 : STATE.p2;

    if (left)  left.innerHTML  = `${leftTag}&nbsp;<span class="life-red">${leftVals.total}</span>&nbsp;<span class="life-white">${leftVals.mid}</span>&nbsp;<span class="life-green">${leftVals.poison}</span>`;
    if (right) right.innerHTML = `${rightTag}&nbsp;<span class="life-red">${rightVals.total}</span>&nbsp;<span class="life-white">${rightVals.mid}</span>&nbsp;<span class="life-green">${rightVals.poison}</span>`;

    // 🔵 NEW: show phase on center pill
    if (tn) tn.textContent = `Turn: ${STATE.turn} – ${STATE.playerLabel} – Phase: ${STATE.phase || ''}`;

    // 🔵 NEW: green highlight ring around active seat's pill (handles flipSides)
    const leftIsSeat  = STATE.flipSides ? 2 : 1;
    const rightIsSeat = STATE.flipSides ? 1 : 2;

    left?.classList.toggle('is-active',  STATE.activeSeat === leftIsSeat);
    right?.classList.toggle('is-active', STATE.activeSeat === rightIsSeat);
  }


  // ------------------------------------------------------------------
  // PUBLIC SETTERS (called from game logic)
  // ------------------------------------------------------------------
  function setTurn(turnNumber, playerLabel, activeSeatNow, phaseName) {
    // update turn counter + label text in life bar
    if (Number.isFinite(turnNumber)) {
      STATE.turn = turnNumber;
    }
    if (playerLabel) {
      STATE.playerLabel = playerLabel;
    }
    if (typeof phaseName === 'string' && phaseName.length) {
      STATE.phase = phaseName;
    }

    // optionally override whose turn it is
    if (Number.isFinite(activeSeatNow)) {
      STATE.activeSeat = activeSeatNow;
    }

    // VISUAL: if it's my seat's turn, I'm the attacker (⚔️ + End Turn unlocked)
    // otherwise I'm defender (🛡️ + End Turn disabled)
    if (STATE.activeSeat === STATE.seat) {
      _markAttackerUI();
    } else {
      _markDefenderUI();
    }

    render();
  }


  function setP1(total, mid, poison) {
    STATE.p1 = { total: toInt(total, 40), mid: toInt(mid, 21), poison: toInt(poison, 0) };
    render();
  }
  function setP2(total, mid, poison) {
    STATE.p2 = { total: toInt(total, 40), mid: toInt(mid, 21), poison: toInt(poison, 0) };
    render();
  }
  
    function setPhase(phaseName){
    if (typeof phaseName === 'string' && phaseName.length){
      STATE.phase = phaseName;
      render();
    }
  }

  
  // CTRL-F anchor: [UI:lifeHelpers]
// ------------------------------------------------------------------
// LIFE HELPERS + SYNC (damage, lifelink, poison, mid)  ⟶ sends RTC
// ------------------------------------------------------------------
function getLifeSnapshot(){
  return {
    p1: { ...STATE.p1 },
    p2: { ...STATE.p2 }
  };
}

function _clampLife(v){
  // Guard against nonsense; keep wide bounds to avoid weird negatives
  return Math.max(-9999, Math.min(9999, (v|0)));
}

// Generic setter that does NOT broadcast when reason === 'sync'
function setLife(seat, total, mid, poison, reason = 'sync'){
  const key = (Number(seat) === 2 ? 'p2' : 'p1');
  const cur = STATE[key];
  STATE[key] = {
    total : toInt(total , cur.total),
    mid   : toInt(mid   , cur.mid),
    poison: toInt(poison, cur.poison)
  };
  render();
  if (reason !== 'sync') _broadcastLife(reason);
  return { ...STATE[key] };
}

// Adjust by deltas (use for damage/lifelink/etc.); WILL broadcast
function adjustLife(seat, dTotal = 0, dMid = 0, dPoison = 0, reason = 'manual'){
  const key = (Number(seat) === 2 ? 'p2' : 'p1');
  const cur = STATE[key];
  const next = {
    total : _clampLife(cur.total  + (dTotal  | 0)),
    mid   : _clampLife(cur.mid    + (dMid    | 0)),
    poison: _clampLife(cur.poison + (dPoison | 0))
  };
  STATE[key] = next;
  render();
  _broadcastLife(reason);
  return next;
}

// Convenience wrappers (combat plumbing can call these)
function applyDamage(targetSeat, amount){
  const dmg = Math.abs(amount|0);
  return adjustLife(targetSeat, -dmg, 0, 0, 'damage');
}
function applyLifelink(receiverSeat, amount){
  const gain = Math.abs(amount|0);
  return adjustLife(receiverSeat, +gain, 0, 0, 'lifelink');
}
function addPoison(targetSeat, counters){
  const n = Math.abs(counters|0);
  return adjustLife(targetSeat, 0, 0, +n, 'poison');
}
function addMid(targetSeat, delta){
  return adjustLife(targetSeat, 0, (delta|0), 0, 'mid');
}

// Send a single compact packet with BOTH players' three life numbers.
// shape: {type:'life:update', from, reason, p1:{total,mid,poison}, p2:{...}}
function _broadcastLife(reason = 'ui'){
  const payload = {
    type: 'life:update',
    reason,
    from: (window.mySeat && window.mySeat()) || STATE.seat || 1,
    p1: { ...STATE.p1 },
    p2: { ...STATE.p2 }
  };
  try {
    // Prefer your established peer sender; RTC shim optional.
    (window.rtcSend || window.peer?.send || window.RTC?.send)?.(payload);
    console.log('%c[UI→RTC life:update sent]', 'color:#6cf', payload);
  } catch (e) {
    console.warn('[UI] RTC send (life:update) failed', e, payload);
  }
}


// Install a receiver exactly once. Applies remote numbers, re-renders.
// If your RTC bus uses a dispatcher (switch on msg.type), this will work
// with window.RTC.on('life:update', handler). If not, we also expose a
// global fallback hook window.__applyRemoteLifeUpdate(msg).
function setupLifeRtc(){
  if (setupLifeRtc._done) return;
  setupLifeRtc._done = true;

  const handler = (msg) => {
    if (!msg || msg.type !== 'life:update' || !msg.p1 || !msg.p2) return;
    // Ignore if it's our own echo (optional). Safe to apply anyway.
    try {
      STATE.p1 = {
        total : toInt(msg.p1.total , STATE.p1.total),
        mid   : toInt(msg.p1.mid   , STATE.p1.mid),
        poison: toInt(msg.p1.poison, STATE.p1.poison)
      };
      STATE.p2 = {
        total : toInt(msg.p2.total , STATE.p2.total),
        mid   : toInt(msg.p2.mid   , STATE.p2.mid),
        poison: toInt(msg.p2.poison, STATE.p2.poison)
      };
      render();
    } catch(e){
      console.warn('[UI] life:update apply failed', e, msg);
    }
  };

  // Preferred: event-style RTC
  try { window.RTC?.on?.('life:update', handler); } catch {}

  // Fallback: expose a direct hook your RTC dispatcher can call:
  window.__applyRemoteLifeUpdate = handler;
}

  
  const toInt = (v, d) => (Number.isFinite(+v) ? (+v|0) : d);

  // CTRL-F anchor: [UI:setSeatRole]
  function setSeatRole(seat, role) {
    const s = Number(seat) || 1;
    STATE.seat = s;
    STATE.role = role || STATE.role;

    // flip life totals if I'm seat 2 (the joiner)
    STATE.flipSides = (s === 2);

    // if we haven't explicitly set whose turn it is yet, assume seat 1 starts
    if (!STATE.activeSeat) STATE.activeSeat = 1;

    // Style local rail buttons according to whose turn.
    if (STATE.activeSeat === STATE.seat) {
      _markAttackerUI();
    } else {
      _markDefenderUI();
    }

    render();
  }

  // Dump the active (Live) settings to console and return them.
  // Usage in console: UIShowSettings()
  function dumpLiveSettings(){
    const live = { ...UISettingsLive };

    // Also expose a couple runtime-calculated values that matter visually:
    // - CSS vars actually on documentElement
    const rs = getComputedStyle(document.documentElement);

    const cssSnapshot = {
      cardHeightTable   : rs.getPropertyValue('--card-height-table').trim(),
      handCardHeight    : rs.getPropertyValue('--hand-card-height').trim(),
      handZoneHeight    : rs.getPropertyValue('--hand-zone-height').trim(),
      combatHeight      : rs.getPropertyValue('--combat-height').trim(),
      midGap            : rs.getPropertyValue('--mid-gap').trim(),
      uiAccent          : rs.getPropertyValue('--ui-accent').trim(),
      ttFontSize        : rs.getPropertyValue('--tt-font-size').trim(),
      ttMaxWidth        : rs.getPropertyValue('--tt-max-width').trim(),
      ttPreviewHeight   : rs.getPropertyValue('--tt-preview-h').trim(),
      ttButtonSize      : rs.getPropertyValue('--tt-btn-size').trim()
    };

    const out = {
      liveSettingsObject: live,
      appliedCssVars: cssSnapshot,
      runtimeSeatInfo: {
        mySeat: STATE.seat,
        role: STATE.role,
        flipSides: STATE.flipSides
      }
    };

    console.log('[UI SETTINGS SNAPSHOT]', out);
    return out;
  }

window.addEventListener('phase:enter:untap', () => UserInterface._updatePhase('Untap'));
window.addEventListener('phase:enter:upkeep', () => UserInterface._updatePhase('Upkeep'));
window.addEventListener('phase:enter:draw', () => UserInterface._updatePhase('Draw'));
window.addEventListener('phase:enter:main1', () => UserInterface._updatePhase('Main 1'));
window.addEventListener('phase:enter:combat', () => UserInterface._updatePhase('Combat'));
window.addEventListener('phase:enter:main2_ending', () => UserInterface._updatePhase('End Step'));

function _updatePhase(label){
  STATE.phase = label;
  const pill = document.getElementById('ui-turn-pill');
  if (pill) {
    pill.textContent = `Turn: ${STATE.turn} – ${STATE.playerLabel} – Phase: ${STATE.phase}`;
  }
}


  // expose
  return {
    mount,
    setTurn,
    setPhase, 
    setP1,
    setP2,
    setSeatRole,

    showSettingsPanel,
    hideSettingsPanel,

    // helpers other modules might call
    previewDraftSettings,
    commitLiveSettings,
    pushSettingsToCSSVars,

    dumpLiveSettings,
  _updatePhase,    // <- console helper

    _markAttackerUI,
    _markDefenderUI,
    _STATE: STATE,
    _UISettingsLive: UISettingsLive,
    _UISettingsDraft: UISettingsDraft,
	    // life helpers + sync
    getLifeSnapshot,
    setLife,           // set explicitly; no broadcast when reason === 'sync'
    adjustLife,        // generic +/- deltas (broadcasts)
    applyDamage,       // wrapper: -N to total (broadcasts)
    applyLifelink,     // wrapper: +N to total (broadcasts)
    addPoison,         // wrapper: +N to poison (broadcasts)
    addMid,             // wrapper: +/- to mid (broadcasts)
	getP1, getP2, getTurn, getPlayerLabel
  };

})();



// also expose globally so non-module code (host/join popup etc.) can flip immediately
window.UserInterface = UserInterface;

// Convenience console helper:
// UIShowSettings() → logs & returns the current live settings and applied CSS vars.
window.UIShowSettings = function(){
  try {
    return UserInterface.dumpLiveSettings();
  } catch(e){
    console.warn('UIShowSettings failed:', e);
    return null;
  }
};
