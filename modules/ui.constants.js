// ================================
// FILE: modules/ui.constants.js
// UI size/scale constants + runtime settings overlay
// - Card/zone width & height are ratio-locked pairs
// - Hand vertical offset slider (controls --hand-bottom)
// - PT/tooltip sizes wired to CSS vars used in v3.html
// - Reset-to-defaults button
// ================================

const VARS = {
  // Card sizing (ratio-locked pair)
  cardWidth:       { label: 'Card Width',         default: 223, min: 150, max: 350, step: 1,   unit: 'px' },
  cardHeight:      { label: 'Card Height',        default: 310, min: 180, max: 450, step: 1,   unit: 'px' },

  // Zone thumbnails (ratio-locked pair, same native ratio as cards)
  zoneWidth:       { label: 'Zone Width',         default: 223, min: 150, max: 350, step: 1,   unit: 'px' },
  zoneHeight:      { label: 'Zone Height',        default: 310, min: 180, max: 450, step: 1,   unit: 'px' },

  // Hand presentation
  handScale:       { label: 'Hand Scale',         default: 0.88, min: 0.20, max: 2.0, step: 0.01 },
  handBottom:      { label: 'Hand Vertical Offset', default: 56,  min: -320, max: 320, step: 1,  unit: 'px' }, // <- feeds --hand-bottom
  handHitH:        { label: 'Hand Drop Hitbox Height', default: 64, min: 12, max: 250, step: 1, unit: 'px' },   // NEW → feeds --hand-hit-h

  // Tooltip / icon sizing
  tooltipFontSize: { label: 'Tooltip Font Size',  default: 13,  min: 10,  max: 24,  step: 1,   unit: 'px' },
  tooltipIconSize: { label: 'Tooltip Icon Size',  default: 18,  min: 12,  max: 32,  step: 1,   unit: 'px' },

  // PT / badge multiplier (multiplies overlayScale that’s based on card height)
  ptBadgeScale:    { label: 'P/T Badge Scale',    default: 1.35, min: 0.6, max: 3.5, step: 0.05 },
  
  effectsScale:     { label: 'Ability Badge Scale',   default: 1,    min: 0.6, max: 2.5, step: 0.05 },
  effectsOffsetX:   { label: 'Ability Row Offset X',  default: 0,    min: -40, max:  40, unit: 'px', step: 1 },
  effectsOffsetY:   { label: 'Ability Row Offset Y',  default: 0,    min: -40, max:  40, unit: 'px', step: 1 },
  effectsRightSafe:{ label: 'Ability Right Safe',     default: 0,    min:   0, max: 120, unit: 'px', step: 1 },
  tooltipBadgeScale:{ label: 'Tooltip Badge Scale',   default: 1.6,  min: 0.8, max: 3.0, step: 0.05 },
};


// Native card aspect used by your art frames (keeps everything crisp)
const CARD_ASPECT = VARS.cardHeight.default / VARS.cardWidth.default; // 310 / 223 ≈ 1.390
const ZONE_ASPECT = VARS.zoneHeight.default / VARS.zoneWidth.default; // same as cards (by default)

// Keys that move in pairs
const CARD_PAIR = ['cardWidth', 'cardHeight'];
const ZONE_PAIR = ['zoneWidth', 'zoneHeight'];

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function fmt(val, key) {
  const unit = VARS[key].unit || '';
  const step = VARS[key].step || 1;
  const isInt = Number(step) >= 1;
  const out = isInt ? Math.round(val) : Number(val).toFixed(String(step).split('.')[1]?.length || 0);
  return `${out}${unit}`;
}

const UIConstants = {
  values: {},
  _ui: { inputs: new Map(), labels: new Map() },
  _syncLock: false, // prevents recursive slider jitter

  init(){
    // Load persisted or defaults
    for (const [key, cfg] of Object.entries(VARS)) {
      const saved = localStorage.getItem('ui_' + key);
      this.values[key] = saved !== null ? parseFloat(saved) : cfg.default;
    }
    // Coerce pairs to be consistent on boot
    this._enforceAspectFrom('cardWidth');
    this._enforceAspectFrom('zoneWidth');
    this.apply();
  },

  apply(){
    const root = document.documentElement;
  for (const [key, val] of Object.entries(this.values)){
    const cfg = VARS[key], unit = cfg.unit || '';
    // map camelCase -> CSS --kebab
    const cssName = '--' + key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
    root.style.setProperty(cssName, String(val) + unit);
  }
    // Primary CSS variables used in v3.html
    root.style.setProperty('--cardWidth',      this.values.cardWidth + 'px');
    root.style.setProperty('--cardHeight',     this.values.cardHeight + 'px');
    root.style.setProperty('--zoneWidth',      this.values.zoneWidth + 'px');
    root.style.setProperty('--zoneHeight',     this.values.zoneHeight + 'px');

    root.style.setProperty('--handScale',      String(this.values.handScale));
    root.style.setProperty('--hand-bottom',    (this.values.handBottom|0) + 'px');

    root.style.setProperty('--tooltipFontSize', this.values.tooltipFontSize + 'px');
    root.style.setProperty('--tooltipIconSize', this.values.tooltipIconSize + 'px');

    root.style.setProperty('--ptBadgeScale',    String(this.values.ptBadgeScale));

    // Overlay/badges rely on overlayScale = cardHeight / 310px (already in CSS),
    // so updating --cardHeight is enough for PT/effect badges to resize.
    // Still, keep any visible readouts in sync:
    this._refreshOverlayReadouts();
  },

  // ---------- Aspect helpers ----------
  _enforceAspectFrom(changedKey){
    if (this._syncLock) return;

    const pair = (changedKey.startsWith('card') ? CARD_PAIR
               : changedKey.startsWith('zone') ? ZONE_PAIR : null);
    if (!pair) return;

    const [wKey, hKey] = [pair[0], pair[1]];
    const cfgW = VARS[wKey], cfgH = VARS[hKey];
    const aspect = (pair === CARD_PAIR) ? CARD_ASPECT : ZONE_ASPECT;

    this._syncLock = true;
    try {
      if (changedKey === wKey) {
        const w = clamp(this.values[wKey], cfgW.min, cfgW.max);
        const newH = clamp(w * aspect, cfgH.min, cfgH.max);
        this.values[wKey] = w;
        this.values[hKey] = newH;
        this._syncOneUI(wKey, w);
        this._syncOneUI(hKey, newH);
      } else if (changedKey === hKey) {
        const h = clamp(this.values[hKey], cfgH.min, cfgH.max);
        const newW = clamp(h / aspect, cfgW.min, cfgW.max);
        this.values[hKey] = h;
        this.values[wKey] = newW;
        this._syncOneUI(hKey, h);
        this._syncOneUI(wKey, newW);
      }
    } finally {
      this._syncLock = false;
    }
  },

  _syncOneUI(key, val){
    // update slider & label if they exist
    const input = this._ui.inputs.get(key);
    const label = this._ui.labels.get(key);
    if (input && String(input.value) !== String(val)) input.value = val;
    if (label) label.textContent = fmt(val, key);
  },

  _refreshOverlayReadouts(){
    for (const key of Object.keys(VARS)) {
      const lab = this._ui.labels.get(key);
      if (lab) lab.textContent = fmt(this.values[key], key);
    }
  },

  // ---------- Overlay ----------
  openSettingsOverlay(){
    // Build once per open
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.style.display = 'block';

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.maxWidth = '820px';
    panel.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center;">
        <strong>⚙ Interface Settings</strong>
        <div class="row">
          <button class="pill js-reset">Reset to defaults</button>
          <button class="pill js-close">Close</button>
        </div>
      </div>
    `;

    const body = document.createElement('div');
    body.style.display = 'grid';
    body.style.gridTemplateColumns = 'minmax(220px, 1fr) minmax(280px, 2fr)';
    body.style.gap = '12px';
    body.style.padding = '12px 0';

    // Clear UI caches for this render
    this._ui.inputs.clear();
    this._ui.labels.clear();

    // Build rows
    for (const [key, cfg] of Object.entries(VARS)){
      const row = document.createElement('div');
      row.style.display = 'contents'; // let children fill the 2-column grid

      const label = document.createElement('label');
      label.style.fontWeight = '800';
      label.style.display = 'block';
      label.style.paddingTop = '6px';
      label.textContent = cfg.label + ': ';

      const valSpan = document.createElement('span');
      valSpan.id = 'val-' + key;
      valSpan.style.opacity = '.9';
      valSpan.style.fontWeight = '700';
      valSpan.textContent = fmt(this.values[key], key);
      label.appendChild(valSpan);

      const inputWrap = document.createElement('div');
      const input = document.createElement('input');
      input.type  = 'range';
      input.min   = cfg.min;
      input.max   = cfg.max;
      input.step  = cfg.step || 1;
      input.value = this.values[key];
      input.style.width = '100%';

      // Store references
      this._ui.inputs.set(key, input);
      this._ui.labels.set(key, valSpan);

      input.addEventListener('input', () => {
        const val = parseFloat(input.value);
        this.values[key] = val;
        localStorage.setItem('ui_' + key, String(val));

        // Keep aspect-locked pairs in sync (no feedback loops)
        if (key.startsWith('card') || key.startsWith('zone')) {
          this._enforceAspectFrom(key);
        }

        // Apply immediately
        this.apply();
      });

      inputWrap.appendChild(input);
      body.appendChild(label);
      body.appendChild(inputWrap);
    }

    panel.appendChild(body);
    scrim.appendChild(panel);
    document.body.appendChild(scrim);

    const close = ()=>{ try{ scrim.remove(); }catch{} };
    panel.querySelector('.js-close')?.addEventListener('click', close);
    scrim.addEventListener('click', e => { if (e.target === scrim) close(); });

    panel.querySelector('.js-reset')?.addEventListener('click', () => {
      // wipe stored values
      for (const key of Object.keys(VARS)) localStorage.removeItem('ui_' + key);
      // restore defaults
      for (const [key, cfg] of Object.entries(VARS)) this.values[key] = cfg.default;

      // re-coerce pairs (in case defaults ever change)
      this._enforceAspectFrom('cardWidth');
      this._enforceAspectFrom('zoneWidth');

      this.apply();
      this._refreshOverlayReadouts();
    });
  }
};

// Apply immediately at import (v3.html calls apply() on load, but this is safe)
UIConstants.init();

export default UIConstants;
