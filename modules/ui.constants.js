// ================================
// FILE: modules/ui.constants.js
// Size/scale constants with runtime settings overlay
// ================================

const VARS = {
  cardWidth:        { label: 'Card Width',        default: 223, min: 150, max: 420, unit: 'px' },
  cardHeight:       { label: 'Card Height',       default: 310, min: 180, max: 620, unit: 'px' },
  zoneWidth:        { label: 'Zone Width',        default: 223, min: 150, max: 420, unit: 'px' },
  zoneHeight:       { label: 'Zone Height',       default: 310, min: 180, max: 620, unit: 'px' },
  handScale:        { label: 'Hand Scale',        default: 0.88, min: 0.5,  max: 1.5, step: 0.01 },
  handBottom:       { label: 'Hand Vertical (px from bottom)', default: 56, min: 0, max: 240, unit: 'px' },
  tooltipFontSize:  { label: 'Tooltip Font',      default: 13,  min: 10,   max: 24,  unit: 'px' },
  tooltipIconSize:  { label: 'Tooltip Icon',      default: 18,  min: 12,   max: 32,  unit: 'px' },
  ptBadgeScale:     { label: 'P/T Badge Scale',   default: 1.35, min: 0.6,  max: 3.5, step: 0.05 },
};

const UIConstants = {
  values: {},
  _aspectLocked: true,
  _aspect: null,

  init(){
    for (const [key, cfg] of Object.entries(VARS)){
      const saved = localStorage.getItem('ui_' + key);
      this.values[key] = saved !== null ? parseFloat(saved) : cfg.default;
    }
    const savedLock = localStorage.getItem('ui_lockAspect');
    this._aspectLocked = savedLock === null ? true : savedLock === '1';
    this._aspect = this.values.cardHeight / Math.max(1, this.values.cardWidth);
    this.apply();
  },

  apply(){
    const root = document.documentElement;
    for (const [key, val] of Object.entries(this.values)){
      const unit = VARS[key].unit || '';
      root.style.setProperty(`--${key}`, `${val}${unit}`);
    }
    // overlays auto-scale with card height relative to default 310
    const overlayScale = (this.values.cardHeight / VARS.cardHeight.default) || 1;
    root.style.setProperty('--overlayScale', overlayScale.toFixed(4));
  },

  openSettingsOverlay(){
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.style.display = 'block';

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center;">
        <strong>⚙ Interface Settings</strong>
        <button class="pill js-close">Close</button>
      </div>
      <div class="panel-body"></div>
    `;

    // light, local CSS to avoid collisions with battlefield .card styles
    const style = document.createElement('style');
    style.textContent = `
      .ui-sections{ display:grid; gap:12px; padding:12px 0; }
      .ui-section{ background:rgba(0,0,0,.25); border:1px solid #2b3f63; border-radius:10px; padding:10px; }
      .ui-section .row{ display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
      .ui-section label{ font-weight:800; display:block; margin-bottom:4px; }
      .ui-section input[type="range"]{ width:100%; }
      .ui-footer{ display:flex; justify-content:flex-end; }
    `;
    panel.appendChild(style);

    const body = panel.querySelector('.panel-body');
    const sectionsWrap = document.createElement('div');
    sectionsWrap.className = 'ui-sections';

    // ---------- Card size (with aspect lock) ----------
    sectionsWrap.appendChild(_mkSection(`
      <div style="font-weight:800;margin-bottom:6px">Card Size</div>
      <div class="row">
        <div style="flex:1 1 280px">
          <label>${VARS.cardWidth.label}: <span id="val-cardWidth">${this.values.cardWidth}</span>${VARS.cardWidth.unit||''}</label>
          <input id="rng-cardWidth" type="range" min="${VARS.cardWidth.min}" max="${VARS.cardWidth.max}" step="${VARS.cardWidth.step||1}" value="${this.values.cardWidth}">
        </div>
        <div style="flex:1 1 280px">
          <label>${VARS.cardHeight.label}: <span id="val-cardHeight">${this.values.cardHeight}</span>${VARS.cardHeight.unit||''}</label>
          <input id="rng-cardHeight" type="range" min="${VARS.cardHeight.min}" max="${VARS.cardHeight.max}" step="${VARS.cardHeight.step||1}" value="${this.values.cardHeight}">
        </div>
        <label style="display:flex;align-items:center;gap:8px;white-space:nowrap;">
          <input id="chk-lockAspect" type="checkbox" ${this._aspectLocked ? 'checked' : ''}>
          <span>Lock aspect</span>
        </label>
      </div>
    `));

    // ---------- Zone size ----------
    sectionsWrap.appendChild(_mkSection(`
      <div style="font-weight:800;margin-bottom:6px">Zone Card Size</div>
      <div class="row">
        <div style="flex:1 1 280px">
          <label>${VARS.zoneWidth.label}: <span id="val-zoneWidth">${this.values.zoneWidth}</span>${VARS.zoneWidth.unit||''}</label>
          <input id="rng-zoneWidth" type="range" min="${VARS.zoneWidth.min}" max="${VARS.zoneWidth.max}" step="${VARS.zoneWidth.step||1}" value="${this.values.zoneWidth}">
        </div>
        <div style="flex:1 1 280px">
          <label>${VARS.zoneHeight.label}: <span id="val-zoneHeight">${this.values.zoneHeight}</span>${VARS.zoneHeight.unit||''}</label>
          <input id="rng-zoneHeight" type="range" min="${VARS.zoneHeight.min}" max="${VARS.zoneHeight.max}" step="${VARS.zoneHeight.step||1}" value="${this.values.zoneHeight}">
        </div>
      </div>
    `));

    // ---------- Hand controls ----------
    sectionsWrap.appendChild(_mkSection(`
      <div style="font-weight:800;margin-bottom:6px">Hand</div>
      <div class="row">
        <div style="flex:1 1 280px">
          <label>${VARS.handScale.label}: <span id="val-handScale">${this.values.handScale}</span></label>
          <input id="rng-handScale" type="range" min="${VARS.handScale.min}" max="${VARS.handScale.max}" step="${VARS.handScale.step||0.01}" value="${this.values.handScale}">
        </div>
        <div style="flex:1 1 280px">
          <label>${VARS.handBottom.label}: <span id="val-handBottom">${this.values.handBottom}</span>${VARS.handBottom.unit||''}</label>
          <input id="rng-handBottom" type="range" min="${VARS.handBottom.min}" max="${VARS.handBottom.max}" step="${VARS.handBottom.step||1}" value="${this.values.handBottom}">
        </div>
      </div>
      <div style="opacity:.8;font-size:12px;margin-top:6px">
        Tip: If you shrink your hand cards, raise the vertical offset so the fan stays off the battlefield.
      </div>
    `));

    // ---------- Tooltip + PT badge ----------
    sectionsWrap.appendChild(_mkSection(`
      <div style="font-weight:800;margin-bottom:6px">Tooltips & Badges</div>
      <div class="row">
        <div style="flex:1 1 220px">
          <label>${VARS.tooltipFontSize.label}: <span id="val-tooltipFontSize">${this.values.tooltipFontSize}</span>${VARS.tooltipFontSize.unit||''}</label>
          <input id="rng-tooltipFontSize" type="range" min="${VARS.tooltipFontSize.min}" max="${VARS.tooltipFontSize.max}" step="${VARS.tooltipFontSize.step||1}" value="${this.values.tooltipFontSize}">
        </div>
        <div style="flex:1 1 220px">
          <label>${VARS.tooltipIconSize.label}: <span id="val-tooltipIconSize">${this.values.tooltipIconSize}</span>${VARS.tooltipIconSize.unit||''}</label>
          <input id="rng-tooltipIconSize" type="range" min="${VARS.tooltipIconSize.min}" max="${VARS.tooltipIconSize.max}" step="${VARS.tooltipIconSize.step||1}" value="${this.values.tooltipIconSize}">
        </div>
        <div style="flex:1 1 220px">
          <label>${VARS.ptBadgeScale.label}: <span id="val-ptBadgeScale">${this.values.ptBadgeScale}</span></label>
          <input id="rng-ptBadgeScale" type="range" min="${VARS.ptBadgeScale.min}" max="${VARS.ptBadgeScale.max}" step="${VARS.ptBadgeScale.step||0.05}" value="${this.values.ptBadgeScale}">
        </div>
      </div>
      <div style="opacity:.8;font-size:12px;margin-top:6px">
        Badges also auto-scale with card height via <code>--overlayScale</code>.
      </div>
    `));

    // ---------- Reset ----------
    sectionsWrap.appendChild(_mkSection(`
      <div class="ui-footer">
        <button id="btn-resetDefaults" class="pill warn">Reset to Defaults</button>
      </div>
    `));

    body.appendChild(sectionsWrap);
    scrim.appendChild(panel);
    document.body.appendChild(scrim);

    const close = ()=>scrim.remove();
    panel.querySelector('.js-close')?.addEventListener('click', close);
    scrim.addEventListener('click', e=>{ if (e.target===scrim) close(); });

    // ------- Wiring helpers -------
    const byId = (id)=>panel.querySelector('#'+id);
    const setVal = (id, v)=>{ const el=byId(id); if (el) el.textContent = v; };
    const bind = (key, rngId, valId)=>{
      const rng = byId(rngId);
      rng?.addEventListener('input', ()=>{
        const v = parseFloat(rng.value);
        this.values[key] = v;
        localStorage.setItem('ui_'+key, String(v));
        setVal(valId, v);
        this.apply();
      });
    };

    // standard binds
    bind('zoneWidth',       'rng-zoneWidth',       'val-zoneWidth');
    bind('zoneHeight',      'rng-zoneHeight',      'val-zoneHeight');
    bind('handScale',       'rng-handScale',       'val-handScale');
    bind('handBottom',      'rng-handBottom',      'val-handBottom');
    bind('tooltipFontSize', 'rng-tooltipFontSize', 'val-tooltipFontSize');
    bind('tooltipIconSize', 'rng-tooltipIconSize', 'val-tooltipIconSize');
    bind('ptBadgeScale',    'rng-ptBadgeScale',    'val-ptBadgeScale');

    // aspect lock
    const chkLock = byId('chk-lockAspect');
    chkLock?.addEventListener('change', ()=>{
      this._aspectLocked = !!chkLock.checked;
      localStorage.setItem('ui_lockAspect', this._aspectLocked ? '1' : '0');
      if (this._aspectLocked){
        this._aspect = this.values.cardHeight / Math.max(1, this.values.cardWidth);
      }
    });

    // card size coupling
    const rngCW = byId('rng-cardWidth');
    const rngCH = byId('rng-cardHeight');

    rngCW?.addEventListener('input', ()=>{
      let w = clamp(+rngCW.value, VARS.cardWidth.min, VARS.cardWidth.max);
      let h = this.values.cardHeight;
      if (this._aspectLocked){
        h = clamp(Math.round(w * this._aspect), VARS.cardHeight.min, VARS.cardHeight.max);
        rngCH.value = String(h);
        setVal('val-cardHeight', h);
      }
      this.values.cardWidth = w;  setVal('val-cardWidth', w);
      this.values.cardHeight = h;
      localStorage.setItem('ui_cardWidth',  String(w));
      localStorage.setItem('ui_cardHeight', String(h));

      // keep zones aligned with battlefield card size (optional)
      syncZone(w, h);
      this.apply();
    });

    rngCH?.addEventListener('input', ()=>{
      let h = clamp(+rngCH.value, VARS.cardHeight.min, VARS.cardHeight.max);
      let w = this.values.cardWidth;
      if (this._aspectLocked){
        w = clamp(Math.round(h / Math.max(0.001, this._aspect)), VARS.cardWidth.min, VARS.cardWidth.max);
        rngCW.value = String(w);
        setVal('val-cardWidth', w);
      }
      this.values.cardHeight = h; setVal('val-cardHeight', h);
      this.values.cardWidth  = w;
      localStorage.setItem('ui_cardHeight', String(h));
      localStorage.setItem('ui_cardWidth',  String(w));

      syncZone(w, h);
      this.apply();
    });

    byId('btn-resetDefaults')?.addEventListener('click', ()=>{
      for (const [key, cfg] of Object.entries(VARS)){
        this.values[key] = cfg.default;
        localStorage.setItem('ui_'+key, String(cfg.default));
      }
      this._aspectLocked = true;
      localStorage.setItem('ui_lockAspect', '1');
      this._aspect = VARS.cardHeight.default / Math.max(1, VARS.cardWidth.default);

      // push values into controls
      rngCW.value = String(VARS.cardWidth.default);
      rngCH.value = String(VARS.cardHeight.default);
      setVal('val-cardWidth',  VARS.cardWidth.default);
      setVal('val-cardHeight', VARS.cardHeight.default);

      byId('rng-zoneWidth').value  = String(VARS.zoneWidth.default);
      byId('rng-zoneHeight').value = String(VARS.zoneHeight.default);
      setVal('val-zoneWidth',  VARS.zoneWidth.default);
      setVal('val-zoneHeight', VARS.zoneHeight.default);

      byId('rng-handScale').value  = String(VARS.handScale.default);
      byId('rng-handBottom').value = String(VARS.handBottom.default);
      setVal('val-handScale',  VARS.handScale.default);
      setVal('val-handBottom', VARS.handBottom.default);

      byId('rng-tooltipFontSize').value = String(VARS.tooltipFontSize.default);
      byId('rng-tooltipIconSize').value = String(VARS.tooltipIconSize.default);
      setVal('val-tooltipFontSize', VARS.tooltipFontSize.default);
      setVal('val-tooltipIconSize', VARS.tooltipIconSize.default);

      byId('rng-ptBadgeScale').value = String(VARS.ptBadgeScale.default);
      setVal('val-ptBadgeScale', VARS.ptBadgeScale.default);

      byId('chk-lockAspect').checked = true;

      // keep zones aligned with defaults
      syncZone(VARS.cardWidth.default, VARS.cardHeight.default);
      this.apply();
    });

    // helpers
    function _mkSection(inner){
      const d = document.createElement('div');
      d.className = 'ui-section';
      d.innerHTML = inner;
      return d;
    }
    function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
    const syncZone = (w, h)=>{
      // if you want them independent, remove this block
      UIConstants.values.zoneWidth  = w;
      UIConstants.values.zoneHeight = h;
      const zW = byId('rng-zoneWidth'), zH = byId('rng-zoneHeight');
      if (zW && zH){
        zW.value = String(w); zH.value = String(h);
        setVal('val-zoneWidth',  w);
        setVal('val-zoneHeight', h);
        localStorage.setItem('ui_zoneWidth',  String(w));
        localStorage.setItem('ui_zoneHeight', String(h));
      }
    };
  }
};

export default UIConstants;
