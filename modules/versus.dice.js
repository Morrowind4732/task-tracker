// ==============================================
// FILE: modules/versus.dice.js
// Versus Dice RNG — single or multi-seat (VS) rolls
// - Minimal UI helpers
// - Broadcast-friendly: one client rolls, all clients render
// - No styling assumptions: uses .scrim/.panel if present, else inline
// ==============================================

const DICE = [4,6,8,10,12,20,100];

function _rng(max){ return Math.floor(Math.random()*max)+1; }
function _now(){ return Date.now(); }

function _qs(s, r=document){ return r.querySelector(s); }
function _qsa(s, r=document){ return Array.from(r.querySelectorAll(s)); }

function _getSeatsDefault(){
  // By default, read seats from life-strip. Override via init({getSeats})
  return _qsa('.life-strip [data-seat]')
    .map(n => Number(n.dataset.seat))
    .filter(n => Number.isFinite(n))
    .sort((a,b)=>a-b);
}

function _makeScrimAndPanel(){
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const panel = document.createElement('div');
  panel.className = 'panel';
  return { scrim, panel };
}

function _centerToast(html, ms=2000){
  // Simple centered floating overlay; auto-removes
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.inset = '0';
  wrap.style.display = 'grid';
  wrap.style.placeItems = 'center';
  wrap.style.zIndex = '99999';
  wrap.style.pointerEvents = 'none';

  const inner = document.createElement('div');
  inner.style.minWidth = '220px';
  inner.style.padding = '14px 16px';
  inner.style.borderRadius = '12px';
  inner.style.background = 'rgba(10,12,18,0.92)';
  inner.style.border = '1px solid #2b3344';
  inner.style.font = '600 16px/1.2 ui-sans-serif, system-ui, -apple-system';
  inner.style.textAlign = 'center';
  inner.style.pointerEvents = 'auto';
  inner.innerHTML = html;

  wrap.appendChild(inner);
  document.body.appendChild(wrap);

  // fade in/out
  wrap.animate([{opacity:0}, {opacity:1}], {duration:120, fill:'forwards'});
  setTimeout(()=> {
    const a = wrap.animate([{opacity:1}, {opacity:0}], {duration:200, fill:'forwards'});
    a.onfinish = ()=> wrap.remove();
  }, ms);
}

function _spinNumbers(el, max, duration=700){
  const start = _now();
  let raf;
  function tick(){
    const t = _now() - start;
    const progress = Math.min(1, t / duration);
    const spins = Math.max(12, Math.floor(30 * (1 - progress) + 10)); // fast → slow
    for (let i=0; i<spins; i++){
      el.textContent = _rng(max);
    }
    if (progress < 1) raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return ()=> cancelAnimationFrame(raf);
}

// ---------- Internal state & API wiring ----------
const VersusDice = {
  _getSeats: _getSeatsDefault,
  _getMySeat: ()=> {
    const v = _qs('#mySeat')?.value || _qs('#viewingSeat')?.value || '1';
    return Number(v);
  },
  _broadcast: null, // function(payload)
  _lastOverlay: null,

  init(opts={}){
    if (opts.getSeats)   this._getSeats = opts.getSeats;
    if (opts.getMySeat)  this._getMySeat = opts.getMySeat;
    if (opts.broadcast)  this._broadcast = opts.broadcast;

    // Allow external receivers to call window.dispatchEvent(new CustomEvent(...)):
    window.addEventListener('versus-dice:show', (e)=>{
      this._renderOverlay(e.detail);
    });
  },

  configureBroadcast(fn){ this._broadcast = fn; },

  // Mounts the RNG controls into a container (used by your ⓘ panel)
  mountControls(container){
    container.innerHTML = `
      <div class="row" style="gap:8px;align-items:center;margin:6px 0">
        <label class="pill" style="cursor:pointer">
          <input type="checkbox" id="vd_vs" style="vertical-align:middle;margin-right:6px"> VS (roll for all players)
        </label>
        <span class="pill" id="vd_roll_hint">Choose a die</span>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:6px" id="vd_dicebar">
        ${DICE.map(n=>`<button class="pill vd-die" data-sides="${n}">d${n}</button>`).join('')}
      </div>
    `;
    container.querySelectorAll('.vd-die').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const faces = Number(btn.dataset.sides);
        const vs = !!container.querySelector('#vd_vs')?.checked;
        this.roll(faces, { versus: vs });
      });
    });
  },

  // Initiator path: compute results once, broadcast, and render locally
  roll(faces, {versus=false}={}){
    const my = this._getMySeat();
    const seats = versus ? this._getSeats() : [my];
    const results = Object.fromEntries(seats.map(s => [String(s), _rng(faces)]));

    const payload = {
      type: 'rng_roll',
      faces,
      versus,
      results,           // { "1": 17, "2": 3, ... }
      ts: _now(),
      by: my
    };

    // Show locally right away
    this._renderOverlay(payload);
    // Broadcast if available
    if (typeof this._broadcast === 'function'){
      try { this._broadcast(payload); } catch(e){ console.warn('VersusDice broadcast failed:', e); }
    } else {
      // Fallback: local-only visual cue
      console.warn('VersusDice: no broadcast configured; showing locally only.');
    }
  },

  // Receiver path: anybody can call this with payload to render the same overlay
  handleRemote(payload){
    if (!payload || payload.type !== 'rng_roll') return;
    this._renderOverlay(payload);
  },

  // Creates the center overlay with a short spin then settles on final numbers
  _renderOverlay(payload){
    // Close prior overlay if any
    try { this._lastOverlay?.remove(); } catch{}
    const wrap = document.createElement('div');
    wrap.style.position = 'fixed';
    wrap.style.inset = '0';
    wrap.style.display = 'grid';
    wrap.style.placeItems = 'center';
    wrap.style.zIndex = '100000';
    wrap.style.background = 'rgba(0,0,0,0.35)';

    const card = document.createElement('div');
    card.style.minWidth = '320px';
    card.style.maxWidth = '520px';
    card.style.padding = '16px';
    card.style.borderRadius = '14px';
    card.style.background = 'rgba(12,16,24,0.96)';
    card.style.border = '1px solid #2b3344';
    card.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
    card.style.font = '600 16px/1.25 ui-sans-serif, system-ui';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div>🎲 RNG Roll ${payload.versus ? '(VS)' : ''}</div>
        <button class="pill vd-close">Close</button>
      </div>
      <div style="display:grid;gap:10px">
        <div style="opacity:0.8">Die: d${payload.faces} • by P${payload.by}</div>
        <div id="vd_rows"></div>
      </div>
    `;

    const rows = card.querySelector('#vd_rows');
    const seats = Object.keys(payload.results).map(s => Number(s)).sort((a,b)=>a-b);

    // Build rows with spinners
    const stoppers = [];
    seats.forEach(seat=>{
      const final = payload.results[String(seat)];
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.gap = '10px';
      row.style.padding = '8px 10px';
      row.style.border = '1px solid #2b3344';
      row.style.borderRadius = '10px';
      row.innerHTML = `
        <div style="opacity:0.8">P${seat}</div>
        <div class="vd-num" style="font-size:28px; letter-spacing:1px">—</div>
      `;
      rows.appendChild(row);

      const numEl = row.querySelector('.vd-num');
      const stop = _spinNumbers(numEl, payload.faces, 900 + Math.random()*300);
      stoppers.push(stop);

      // settle
      setTimeout(()=>{
        stop();
        numEl.textContent = final;
        numEl.animate([{transform:'scale(1)'}, {transform:'scale(1.18)'}, {transform:'scale(1)'}], {duration:180, easing:'ease-out'});
      }, 950 + Math.random()*350);
    });

    // close handlers
    card.querySelector('.vd-close').addEventListener('click', ()=>wrap.remove());
    wrap.addEventListener('click', (e)=>{ if (e.target===wrap) wrap.remove(); });

    wrap.appendChild(card);
    document.body.appendChild(wrap);
    this._lastOverlay = wrap;
  }
};

export default VersusDice;
