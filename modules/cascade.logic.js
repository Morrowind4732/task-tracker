// modules/cascade.logic.js
// v4 — On-table cascade (anchored to deck zone); flip + slide; spawns hit; bottoms rest
// API: window.CascadeLogic.start(seat, { value, strictLess, ignoreLands })

(function(){
  const TAG = '[Cascade]';

  // ------------------------------
  // Tunables
  // ------------------------------
  // Shuffle flourish
  const SHUFFLE_SWING_X   = 38;   // how far left a card fans out
  const SHUFFLE_SWING_Y   = 6;    // tiny vertical drift
  const SHUFFLE_ROT_DEG   = -8;   // slight rotation when fanned out
  const SHUFFLE_CYCLES    = 7;    // how many cards “riffle”
  const SHUFFLE_STEP_MS   = 160;  // each out/back pair duration
  const EASE_SHUFFLE      = 'cubic-bezier(.2,.8,.1,1)';

  const STEP_DELAY_MS  = 90;         // small gap between reveals
  const FLIP_MS        = 380;        // match your card flip feel
  const SLIDE_MS       = 320;
  const ACCEPT_OFFSETY = 140;        // how far the accepted card slides toward the player before we spawn it
  const REJECT_OFFSETY = -140;       // how far rejects slide up
  const AUTO_CLOSE_MS  = null;       // e.g. 1200 to auto-remove the stage after finishing; null = stay (testing)

  // Reject stack origin (new)
  const REJECT_STACK_MARGIN_PX = 22;   // how far above the deck to start the pile
  const REJECT_STACK_ALIGN     = 'center'; // 'center' | 'left' | 'right'

  // Animation tuning
  const REVEAL_PAUSE_MS       = 140; // pause after placing the card on stage before flipping
  const ACCEPT_OVERSHOOT_PX   = 14;  // tiny settle after the accept slide
  const EASE_FLIP             = 'cubic-bezier(.2,.7,.2,1)';
  const EASE_SLIDE            = 'cubic-bezier(.2,.9,.1,1)';
  const REJECT_STACK_GAP_PX   = 25;   // vertical gap between rejected cards in the stack
  const REJECT_BASE_Z         = 1000; // base z-index so each next reject sits on top

  // Post-flip linger (how long the face-up card stays before sliding)
  const HOLD_AFTER_FLIP_REJECT_MS = 520; // when NOT a valid hit
  const HOLD_AFTER_FLIP_HIT_MS    = 520; // when it IS the hit card

  // Respect reduced motion preference for holds as well
  const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const hold = (ms)=> REDUCED_MOTION ? Math.min(ms, 16) : ms;

  // ------------------------------
  // Mini helpers
  // ------------------------------
  const $ = (s,r=document)=>r.querySelector(s);
  const $$= (s,r=document)=>Array.from(r.querySelectorAll(s));
  const wait = (ms)=>new Promise(res=>setTimeout(res, ms));
  const status = (t)=>{ try{ Overlays?.notify?.('info', t); }catch{} };

  function getDeckRef(){
    const viaAPI = (window.DeckAPI && typeof DeckAPI.get === 'function') ? DeckAPI.get() : null;
    const viaLegacy = Array.isArray(window.deck) ? window.deck : null;
    const ref = viaAPI || viaLegacy || null;
    console.log(`${TAG} getDeckRef`, {
      hasDeckAPI: !!(window.DeckAPI && window.DeckAPI.get),
      hasLegacy: Array.isArray(window.deck),
      resolvedArray: Array.isArray(ref),
      length: Array.isArray(ref) ? ref.length : null
    });
    return ref;
  }

  function mvOf(c){
    // 1) Try all the typical numeric fields first
    const fields = [
      'mana_value','mv','cmc','converted_mana_cost','convertedManaCost','manaValue','mvInt','CMC'
    ];
    for (const f of fields) {
      const v = c && c[f];
      if (v != null && v !== '' && Number.isFinite(+v)) return +v;
    }

    // 2) Try to derive from a cost object some lists use (e.g., { generic:2, colored:1 })
    if (c?.cost && Number.isFinite(+c.cost.generic)) {
      // assume colored symbols each count as 1 if present
      const colored = ['w','u','b','r','g','c','s']
        .reduce((acc,k)=>acc + (Number.isFinite(+c.cost[k]) ? +c.cost[k] : 0), 0);
      return +c.cost.generic + colored;
    }

    // 3) Parse Scryfall-style mana_cost, e.g. "{2}{W/U}{G}{G/P}{X}"
    if (typeof c?.mana_cost === 'string' && c.mana_cost.includes('{')) {
      return parseManaValueFromCost(c.mana_cost);
    }

    // 4) Try front face if MDFC-style data is present
    const face = Array.isArray(c?.card_faces) ? c.card_faces[0] : null;
    if (face) {
      // numeric fields on face
      for (const f of fields) {
        const v = face[f];
        if (v != null && v !== '' && Number.isFinite(+v)) return +v;
      }
      if (typeof face.mana_cost === 'string' && face.mana_cost.includes('{')) {
        return parseManaValueFromCost(face.mana_cost);
      }
    }

    // 5) Give up (treat as NaN)
    return NaN;
  }

  // Robust MV parser for "{...}" sequences.
  function parseManaValueFromCost(cost){
    let mv = 0;
    const re = /\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(cost)) !== null) {
      const sym = String(m[1]).toUpperCase().trim(); // e.g., "2", "W", "W/U", "G/P", "X", "S", "C"

      if (/^\d+$/.test(sym)) { mv += parseInt(sym,10); continue; }                 // number
      if (/^\d+\/[WUBRGCSP]$/.test(sym)) { mv += parseInt(sym.split('/')[0],10); continue; } // 2/W
      if (sym === 'X') { mv += 0; continue; }                                      // X = 0
      if (sym === 'T' || sym === 'Q' || sym === 'E') { mv += 0; continue; }        // tap/untap/energy = 0

      if (/^(W|U|B|R|G|C|S)$/.test(sym)) { mv += 1; continue; }                    // colored, colorless symbol, snow
      if (/^[WUBRGCSP]\/[WUBRGCSP]$/.test(sym)) { mv += 1; continue; }             // hybrid
      if (/^[WUBRGCSP]\/P$/.test(sym)) { mv += 1; continue; }                      // phyrexian
    }
    return mv;
  }

  function isLand(c){
    const tl = (c?.type_line || c?.type || c?.card_faces?.[0]?.type_line || '').toLowerCase();
    return tl.includes('land') ||
      (Array.isArray(c?.types) && c.types.some(t=>String(t).toLowerCase()==='land')) ||
      (Array.isArray(c?.supertypes) && c.supertypes.some(t=>String(t).toLowerCase()==='land'));
  }

  function shuffleInPlace(arr){
    for (let i=arr.length-1;i>0;i--){
      const j = (Math.random()* (i+1))|0;
      const t = arr[i]; arr[i]=arr[j]; arr[j]=t;
    }
    return arr;
  }

  function artFromCard(c){
    if (c?.img) return c.img;
    if (c?.image_uris?.normal) return c.image_uris.normal;
    if (Array.isArray(c?.card_faces)) {
      const f = c.card_faces[0];
      if (f?.image_uris?.normal) return f.image_uris.normal;
    }
    const sid = c?.id || c?.scryfall_id || '';
    return sid ? `https://api.scryfall.com/cards/${encodeURIComponent(String(sid))}?format=image&version=normal` : '';
  }

  function getCardCSSSize(){
    const rootStyle = getComputedStyle(document.documentElement);
    const cw = parseFloat(rootStyle.getPropertyValue('--card-w')) || 223;
    const ch = parseFloat(rootStyle.getPropertyValue('--card-h')) || 310;
    return { cw, ch };
  }

  function getRejectStackBase(){
    // stage is anchored to deck zone, so (0,0) = deck top-left
    const { cw, ch } = getCardCSSSize();
    const deckEl = getDeckZone();
    const w = deckEl ? (parseFloat(getComputedStyle(deckEl).width)  || 0) : 0;
    // start just above the deck’s top edge
    let x0;
    if (REJECT_STACK_ALIGN === 'left')   x0 = 0;
    else if (REJECT_STACK_ALIGN === 'right') x0 = Math.max(0, w - cw);
    else x0 = Math.max(0, (w - cw) / 2); // center
    const y0 = -REJECT_STACK_MARGIN_PX - ch; // above the deck
    return { x0, y0 };
  }

  function getDeckHome(){
    // stage is anchored to deck zone, so (0,0) = deck top-left
    const { cw } = getCardCSSSize();
    const deckEl = getDeckZone();
    const w = deckEl ? (parseFloat(getComputedStyle(deckEl).width) || 0) : 0;

    // center the card horizontally in the deck zone; y = top edge of the deck
    const x = Math.max(0, (w - cw) / 2);
    const y = 0;
    return { x, y };
  }

  // ------------------------------
  // CSS (inject once)
  // ------------------------------
  (function injectStyles(){
    if (document.getElementById('cascade-on-table-css')) return;
    const css = `
      .casc-stage {
        position:absolute;
        pointer-events:none;
        z-index:var(--z-actions, 5); /* above zones, below tooltips if needed */
      }
      .casc-card {
        position:absolute;
        left:0; top:0;
        width:100%; height:100%;
        perspective:1000px;
        transform: translate(0,0);
      }
      .casc-inner {
        position:absolute; inset:0;
        transform-style: preserve-3d;
        transition: transform ${FLIP_MS}ms ${EASE_FLIP};
      }
      .casc-face {
        position:absolute; inset:0;
        backface-visibility:hidden;
        border-radius:12px;
        overflow:hidden;
        border:1px solid rgba(255,255,255,.18);
        box-shadow: 0 10px 24px rgba(0,0,0,.45);
      }
      .casc-back { background:#000 url('https://i.imgur.com/LdOBU1I.jpeg') center/cover no-repeat; }
      .casc-front { transform: rotateY(180deg); }
      .casc-front img { width:100%; height:100%; object-fit:cover; display:block; }
      .casc-flipped .casc-inner { transform: rotateY(180deg); }

      .casc-move { will-change: transform, opacity; }
      .casc-reject { opacity:1; }

      @keyframes casc-up {
        0%   { transform: translateY(0); opacity:1; }
        100% { transform: translateY(${REJECT_OFFSETY}px); opacity:0; }
      }
      .casc-reject.to-up {
        animation: casc-up ${SLIDE_MS}ms ${EASE_SLIDE} both;
      }

      @keyframes casc-down {
        0%   { transform: translateY(0); }
        72%  { transform: translateY(${ACCEPT_OFFSETY + ACCEPT_OVERSHOOT_PX}px); }
        100% { transform: translateY(${ACCEPT_OFFSETY}px); }
      }
      .casc-accept { }
      .casc-accept.to-down {
        animation: casc-down ${SLIDE_MS}ms ${EASE_SLIDE} both;
      }

      .casc-pill {
        position:absolute;
        left:0; top:0;
        transform: translate(0, -26px);
        background:#162035; color:#e7e9ee; border:1px solid rgba(255,255,255,.1);
        border-radius:999px; padding:4px 8px; font-weight:800; font-size:12px;
        pointer-events:auto;
      }
      .casc-close {
        margin-left:8px;
        background:#0f1725; border:1px solid #2b3f63; color:#cfe1ff;
        border-radius:8px; padding:2px 6px; font-weight:800;
        cursor:pointer;
      }

      @media (prefers-reduced-motion: reduce){
        .casc-inner { transition-duration: 1ms !important; }
        .casc-reject.to-up,
        .casc-accept.to-down { animation-duration: 1ms !important; }
      }
    `;
    const el = document.createElement('style');
    el.id = 'cascade-on-table-css';
    el.textContent = css;
    document.head.appendChild(el);
  })();

  // ------------------------------
  // Layout helpers (C1 anchoring)
  // ------------------------------
  function getDeckZone(){
    return document.getElementById('deckZone');
  }
  function getWorld(){
    return document.getElementById('world') || document.body;
  }
  function stageFromDeckZone(){
    const deckEl = getDeckZone();
    const world  = getWorld();
    if (!deckEl || !world) return null;

    const cs = getComputedStyle(deckEl);
    const w  = parseFloat(cs.width)  || 0;
    const h  = parseFloat(cs.height) || 0;

    const left = parseFloat(deckEl.style.left) || deckEl.offsetLeft || 0;
    const top  = parseFloat(deckEl.style.top)  || deckEl.offsetTop  || 0;

    const stage = document.createElement('div');
    stage.className = 'casc-stage';
    stage.style.left = `${left}px`;
    stage.style.top  = `${top}px`;
    stage.style.width  = `${w}px`;
    stage.style.height = `${h}px`;

    const pill = document.createElement('div');
    pill.className = 'casc-pill';
    pill.textContent = 'Revealed: 0';
    const close = document.createElement('button');
    close.className = 'casc-close';
    close.textContent = '×';
    close.title = 'Close';
    close.addEventListener('click', ()=> stage.remove());
    pill.appendChild(close);
    stage.appendChild(pill);

    world.appendChild(stage);
    return { stage, pill };
  }

  function makeFlipNode(frontImg){
    const shell = document.createElement('div');
    shell.className = 'casc-card casc-move';

    const inner = document.createElement('div');
    inner.className = 'casc-inner';

    const back = document.createElement('div');
    back.className = 'casc-face casc-back';

    const front = document.createElement('div');
    front.className = 'casc-face casc-front';
    const img = document.createElement('img');
    img.src = frontImg || '';
    front.appendChild(img);

    shell.appendChild(inner);
    inner.appendChild(back);
    inner.appendChild(front);
    return { shell, inner };
  }

  function flipOnce(inner){
    return new Promise(res=>{
      inner.parentElement.classList.add('casc-flipped');  // flips from back → front
      const on = ()=>{ inner.removeEventListener('transitionend', on); res(); };
      inner.addEventListener('transitionend', on, { once:true });
      setTimeout(()=>{ try{inner.removeEventListener('transitionend', on);}catch{} res(); }, FLIP_MS + 60);
    });
  }

  function slide(el, dir){ // 'up' | 'down'
    return new Promise(res=>{
      if (dir === 'up'){
        el.classList.remove('casc-accept');
        el.classList.add('casc-reject');
        requestAnimationFrame(()=>requestAnimationFrame(()=> el.classList.add('to-up')));
      } else {
        el.classList.remove('casc-reject');
        el.classList.add('casc-accept');
        requestAnimationFrame(()=>requestAnimationFrame(()=> el.classList.add('to-down')));
      }
      const on = ()=>{ el.removeEventListener('transitionend', on); res(); };
      el.addEventListener('transitionend', on, { once:true });
      setTimeout(()=>{ try{el.removeEventListener('transitionend', on);}catch{} res(); }, SLIDE_MS + 60);
    });
  }

  // ------------------------------
  // Main entry
  // ------------------------------
  function confirmCastOverlay(cardName = 'this spell', cardImg = ''){
    return new Promise((resolve) => {
      const { cw, ch } = (typeof getCardCSSSize === 'function' ? getCardCSSSize() : { cw:223, ch:310 });

      const modal = document.createElement('div');
      modal.className = 'casc-confirm';
      Object.assign(modal.style, {
        position:'fixed', inset:'0', display:'flex',
        alignItems:'flex-start',
        justifyContent:'center',
        paddingTop:'6vh',
        background:'rgba(0,0,0,.35)', zIndex:'999999',
        pointerEvents:'auto'
      });

      const panel = document.createElement('div');
      Object.assign(panel.style, {
        background:'#0d1424', color:'#e6ecff',
        border:'1px solid rgba(255,255,255,.12)',
        borderRadius:'12px', padding:'16px',
        boxShadow:'0 10px 28px rgba(0,0,0,.5)',
        font:'600 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        display:'grid',
        gridTemplateColumns:'auto',
        gap:'12px',
        maxWidth:`min(${cw + 40}px, 92vw)`,
        textAlign:'center',
        justifyItems:'center'
      });

      const title = document.createElement('div');
      title.textContent = 'Cast this spell?';
      Object.assign(title.style, { fontSize:'16px', fontWeight:'800', textAlign:'center' });

      const imgWrap = document.createElement('div');
      Object.assign(imgWrap.style, {
        width:`${cw}px`,
        height:`${ch}px`,
        borderRadius:'12px',
        overflow:'hidden',
        border:'1px solid rgba(255,255,255,.18)',
        boxShadow:'0 8px 18px rgba(0,0,0,.45)',
        margin:'0 auto'
      });
      const img = document.createElement('img');
      img.src = cardImg || '';
      Object.assign(img.style, {
        display:'block', width:'100%', height:'100%', objectFit:'cover', background:'#000'
      });
      imgWrap.appendChild(img);

      const msg = document.createElement('div');
      msg.textContent = cardName || 'this spell';
      Object.assign(msg.style, { opacity:.85, textAlign:'center' });

      const row = document.createElement('div');
      Object.assign(row.style, { display:'flex', gap:'8px', justifyContent:'center' });

      const btnNo = document.createElement('button');
      btnNo.textContent = 'No';
      Object.assign(btnNo.style, {
        padding:'8px 12px', borderRadius:'10px', border:'1px solid #2a3a5f',
        background:'#101a31', color:'#cfe1ff', fontWeight:'800', cursor:'pointer'
      });

      const btnYes = document.createElement('button');
      btnYes.textContent = 'Yes';
      Object.assign(btnYes.style, {
        padding:'8px 12px', borderRadius:'10px', border:'1px solid #2f6be0',
        background:'#1a3a88', color:'#fff', fontWeight:'900', cursor:'pointer'
      });

      function close(v){
        try { document.body.removeChild(modal); } catch {}
        resolve(v);
      }
      btnNo.onclick  = () => close(false);
      btnYes.onclick = () => close(true);

      const onKey = (e)=>{
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        if (e.key === 'Enter')  { e.preventDefault(); close(true); }
      };
      modal.addEventListener('keydown', onKey);
      modal.tabIndex = -1;

      row.appendChild(btnNo);
      row.appendChild(btnYes);
      panel.appendChild(title);
      panel.appendChild(imgWrap);
      panel.appendChild(msg);
      panel.appendChild(row);
      modal.appendChild(panel);
      document.body.appendChild(modal);
      modal.focus();
    });
  }

  async function shuffleFlourish(actors, x0, y0){
    if (!actors.length) return;

    const shells = actors.filter(Boolean);
    for (let i = 0; i < SHUFFLE_CYCLES; i++){
      const el = shells[i % shells.length];
      if (!el) continue;

      el.style.transition = `transform ${Math.floor(SHUFFLE_STEP_MS*0.55)}ms ${EASE_SHUFFLE}`;
      el.style.zIndex     = String(REJECT_BASE_Z + 4000 + i);
      el.style.transform  = `translate(${x0 - SHUFFLE_SWING_X}px, ${y0 + (i%2?SHUFFLE_SWING_Y:-SHUFFLE_SWING_Y)}px) rotate(${SHUFFLE_ROT_DEG}deg)`;
      await wait(Math.floor(SHUFFLE_STEP_MS*0.55));

      el.style.transition = `transform ${Math.floor(SHUFFLE_STEP_MS*0.45)}ms ${EASE_SHUFFLE}`;
      el.style.zIndex     = String(REJECT_BASE_Z - (i+1));
      el.style.transform  = `translate(${x0}px, ${y0}px) rotate(0deg)`;
      await wait(Math.floor(SHUFFLE_STEP_MS*0.45));
    }

    shells.forEach((el, idx)=>{
      el.style.zIndex = String(REJECT_BASE_Z + 1500 + idx);
    });
  }
  
  // ---- DeckSync: keep deck state correct & persisted after cascade/draw/shuffles ----
window.DeckSync = (function(){
  const TAG = '[DeckSync]';

  function getDeckRef(){
    // Prefer a DeckAPI if you have one; otherwise use window.deck (v3 style)
    const viaAPI = (window.DeckAPI && typeof DeckAPI.get === 'function') ? DeckAPI.get() : null;
    const viaLegacy = Array.isArray(window.deck) ? window.deck : null;
    const ref = viaAPI || viaLegacy || null;
    if (!Array.isArray(ref)) {
      console.warn(`${TAG} no deck array available`);
      return null;
    }
    return ref;
  }

  // Fisher–Yates
  function shuffleInPlace(arr){
    for (let i=arr.length-1;i>0;i--){
      const j = (Math.random()*(i+1))|0;
      [arr[i],arr[j]] = [arr[j],arr[i]];
    }
    return arr;
  }

  // Optional light dedupe by cid/id to defend against double-inserts
  function dedupeByIdentity(arr){
    const seen = new Set();
    return arr.filter(c=>{
      const k = c?.cid ?? c?.id ?? c?.scryfall_id ?? c?.name + '|' + c?.mana_cost;
      if (k == null) return true; // keep unknowns
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function markDirtyAndBroadcast({ seat=null, reason='cascade' }={}){
    try { window.GameIO?.markDirty?.('deck'); } catch {}
    try { window.sendRTC?.({ type:'deck:update', reason, seat }) } catch {}
    // If your autosave watches markDirty or deck:update, that’s enough.
    // If you need explicit autosave, uncomment:
    // try { window.AutoSave?.now?.('deck'); } catch {}
  }

  /**
   * Bottom the cascade rejects safely, with optional declined hit included.
   * top=end, bottom=start convention preserved.
   *
   * @param {Object} args
   * @param {Array<Object>} args.rejects - non-hit revealed cards
   * @param {Object|null}   args.hit - the hit card (if any)
   * @param {boolean}       args.didCast - true if user clicked "Yes"
   * @param {number|null}   args.seat - optional seat for RTC payloads
   * @param {boolean}       args.ensureUnique - dedupe before inserting (default true)
   */
  function bottomAfterCascade({ rejects=[], hit=null, didCast=false, seat=null, ensureUnique=true }={}){
    const deckRef = getDeckRef();
    if (!deckRef) return;

    // Build the pile to bottom
    const toBottom = Array.isArray(rejects) ? rejects.slice() : [];
    if (!didCast && hit) toBottom.push(hit); // declined hit also goes to bottom

    if (!toBottom.length){
      markDirtyAndBroadcast({ seat, reason:'cascade:no-op' });
      return;
    }

    // Randomize order per rules
    shuffleInPlace(toBottom);

    // Defensive dedupe against accidental double-presence of any object
    let safeBottom = toBottom;
    if (ensureUnique){
      // Remove any existing copies of these objects from deckRef first (by reference OR identity)
      const ids = new Set(toBottom.map(c => c?.cid ?? c?.id ?? c?.scryfall_id ?? null).filter(Boolean));
      for (let i = deckRef.length - 1; i >= 0; i--){
        const c = deckRef[i];
        const k = c?.cid ?? c?.id ?? c?.scryfall_id ?? null;
        if (k && ids.has(k)){
          deckRef.splice(i, 1);
        }
      }
      // Also dedupe the insert list itself
      safeBottom = dedupeByIdentity(toBottom);
    }

    // Bottom = add to the start
    deckRef.unshift(...safeBottom);

    // Notify & mark dirty so snapshots persist the new order
    try { window.sendRTC?.({ type:'deck:bottom', count: safeBottom.length, seat, didCast }); } catch {}
    markDirtyAndBroadcast({ seat, reason:'cascade:bottom' });

    console.log(`${TAG} bottomed ${safeBottom.length} card(s); deck size =`, deckRef.length);
  }

  return { bottomAfterCascade };
})();


  window.CascadeLogic = {
    /**
     * seat: player number
     * opts: { value, strictLess=true, ignoreLands=true }
     */
    async start(seat, opts = { value: 0, strictLess: true, ignoreLands: true }){
      console.log(`${TAG} start`, { seat, opts });
      console.log('[Cascade] world?', !!window.world, 'spawnTableCard?', typeof window.spawnTableCard);

      const deckRef = getDeckRef();
      if (!Array.isArray(deckRef) || !deckRef.length){
        status('Deck is empty.');
        return;
      }

      // Setup stage anchored to deck
      const s = stageFromDeckZone();
      if (!s){ console.warn(`${TAG} no deck zone/stage`); status('Deck zone missing.'); return; }
      const { stage, pill } = s;

      // Broadcast start (optional)
      try { sendRTC?.({ type: 'cascade:start', seat, value: Number(opts.value||0) }); } catch {}

      const strict = !!opts.strictLess;
      const ignoreLands = !!opts.ignoreLands;
      const N = Math.max(0, Number(opts.value||0)|0);

      let revealed = 0;
      let hit = null;
      const rejects = [];
      const rejectNodes = []; // track overlay shells for the collapse animation
      let acceptNode = null;  // ← keep the accepted overlay shell for later pile/flip
      let acceptedCast = false;
      status(`Cascade (N=${N}) — revealing…`);

      while (deckRef.length){
        const top = deckRef.pop(); // top = array end
        const mv = mvOf(top);
        const landOK = ignoreLands ? !isLand(top) : true;
        const mvOK = (strict ? mv < N : mv <= N) && Number.isFinite(mv);
        const candidate = landOK && mvOK;

        // Visual: create a flip node sized to deck zone (stage size)
        const { shell, inner } = makeFlipNode(artFromCard(top));
        stage.appendChild(shell);

        await wait(REVEAL_PAUSE_MS);
        await flipOnce(inner);

        await wait(hold(candidate ? HOLD_AFTER_FLIP_HIT_MS : HOLD_AFTER_FLIP_REJECT_MS));

        if (candidate){
          await slide(shell, 'down');
          acceptNode = { shell, inner };
          hit = top;
          console.log(`${TAG} HIT`, { name:top?.name, mv, N });

          let didCast = false;
          try {
            const did = await confirmCastOverlay(
              hit?.name || 'this spell',
              hit?.img || artFromCard(hit) || ''
            );
            didCast = !!did;
            acceptedCast = didCast;
            console.log(`${TAG} confirmCast →`, didCast ? 'YES' : 'NO');
          } catch(e){
            console.warn(`${TAG} confirm overlay error`, e);
          }

          if (didCast){
            try {
              const deckRect = getDeckZone().getBoundingClientRect();
              const cx = deckRect.left + deckRect.width / 2;
              const cy = deckRect.top  + deckRect.height / 2 + ACCEPT_OFFSETY;
              const toWorld = (window.screenToWorld || window.ScreenToWorld || (() => null));
              const p = toWorld(cx, cy);

              const cid = hit?.cid;
              if (cid && typeof Zones?.moveFromZone === 'function'){
                Zones.moveFromZone({ from:'library', to:'table', cid, owner: seat });
              } else if (typeof Zones?.cfg?.spawnToTable === 'function') {
                const cardObj = {
                  name: hit?.name || '',
                  img:  hit?.img  || artFromCard(hit) || '',
                  type_line:   hit?.type_line   || '',
                  mana_cost:   hit?.mana_cost   || '',
                  oracle_text: hit?.oracle_text || '',
                  ogpower:     Number.isFinite(hit?.ogpower)     ? hit.ogpower     : (Number.isFinite(+hit?.power) ? +hit.power : undefined),
                  ogtoughness: Number.isFinite(hit?.ogtoughness) ? hit.ogtoughness : (Number.isFinite(+hit?.toughness) ? +hit.toughness : undefined),
                  ogloyalty:   Number.isFinite(hit?.ogloyalty)   ? hit.ogloyalty   : (Number.isFinite(+hit?.loyalty) ? +hit.loyalty : undefined),
                  ogTypes:     Array.isArray(hit?.ogTypes)   ? hit.ogTypes   : [],
                  ogEffects:   Array.isArray(hit?.ogEffects) ? hit.ogEffects : [],
                  power:       hit?.power ?? '',
                  toughness:   hit?.toughness ?? '',
                  loyalty:     hit?.loyalty ?? ''
                };
                Zones.cfg.spawnToTable(cardObj, seat);
              }

              try { window.applyViewFilter?.(); } catch {}

              if (p){
                const { cw, ch } = getCardCSSSize();
                const x = p.x - cw/2;
                const y = p.y - ch/2;
                if (hit?.cid){
                  const el = document.querySelector(`.card[data-cid="${CSS.escape(String(hit.cid))}"]`);
                  if (el){ el.style.left = `${x}px`; el.style.top = `${y}px`; }
                } else {
                  const cards = $$('.card.on-table');
                  const el = cards[cards.length-1];
                  if (el){ el.style.left = `${x}px`; el.style.top = `${y}px`; }
                }
              }
            } catch (e){
              console.warn(`${TAG} spawn/move error`, e);
            }
          } else {
            try { rejects.push(hit); } catch {}
          }

          break;

        } else {
          {
            const idx = rejects.length;
            shell.classList.remove('casc-accept');
            shell.classList.add('casc-reject');

            shell.style.zIndex = String(REJECT_BASE_Z + idx);
            shell.style.transition = `transform ${SLIDE_MS}ms ${EASE_SLIDE}`;

            const { x0, y0 } = getRejectStackBase();
            const x = x0;
            const y = y0 - idx * REJECT_STACK_GAP_PX;

            requestAnimationFrame(() => {
              shell.style.transform = `translate(${x}px, ${y}px)`;
            });

            rejects.push(top);
            rejectNodes.push({ shell, inner });
          }
        }

        revealed++;
        pill.textContent = `Revealed: ${revealed}`;
        await wait(STEP_DELAY_MS);

        try { sendRTC?.({ type:'cascade:step', seat, revealed, name: top?.name || '' }); } catch {}
      }

      // ----------- NEW: handle the case where FIRST card was a hit AND cast, leaving no rejects -----------
      if (acceptedCast && acceptNode && acceptNode.shell && rejects.length === 0){
        try {
          const aShell = acceptNode.shell;
          const { x, y } = getDeckHome(); // visual destination near deck/table
          aShell.classList.remove('to-down','casc-accept','casc-reject');
          aShell.style.transition = `transform ${SLIDE_MS}ms ${EASE_SLIDE}, opacity 220ms linear`;
          aShell.style.transform  = `translate(0px, ${ACCEPT_OFFSETY}px)`; // end of accept slide pose
          aShell.style.zIndex     = String(REJECT_BASE_Z + 2200);
          void aShell.offsetHeight; // reflow
          requestAnimationFrame(() => {
            aShell.style.transform = `translate(${x}px, ${y}px)`;
            aShell.style.opacity   = '0.001';
          });
          await wait(SLIDE_MS + 240);
          try { aShell.remove(); } catch {}
        } catch (e){
          console.warn(`${TAG} accept overlay cleanup (no rejects) error`, e);
        }
      }
      // ----------------------------------------------------------------------------------------------------

      // Bottom all rejects randomly ( rules: in a random order at bottom )
      // New flow: rejects slide DOWN to base → accepted slides UP to pile → flip (both) → riffle → bottom
      if (rejects.length){
        try {
          const { x0, y0 } = getRejectStackBase();
          const stepDelay = 50;

          // 3a) Slide each REJECT overlay card DOWN into the base
          for (let i = rejectNodes.length - 1; i >= 0; i--) {
            const { shell } = rejectNodes[i];
            shell.style.zIndex = String(REJECT_BASE_Z + 1000 + i);
            shell.style.transition = `transform ${SLIDE_MS}ms ${EASE_SLIDE}`;
            shell.style.transform  = `translate(${x0}px, ${y0}px)`;
            await wait(stepDelay);
          }

          // 3b) Accepted overlay follow-up:
          //     - If CAST, slide it to deck/table home and fade/remove.
          //     - Else, bring it to the reject pile like before.
          if (acceptNode && acceptNode.shell){
            const aShell = acceptNode.shell;
            aShell.classList.remove('to-down','casc-accept','casc-reject');

            if (acceptedCast){
              const { x, y } = getDeckHome();
              aShell.style.transition = `transform ${SLIDE_MS}ms ${EASE_SLIDE}, opacity 220ms linear`;
              aShell.style.transform  = `translate(0px, ${ACCEPT_OFFSETY}px)`;
              aShell.style.zIndex     = String(REJECT_BASE_Z + 2200);
              void aShell.offsetHeight;
              requestAnimationFrame(() => {
                aShell.style.transform = `translate(${x}px, ${y}px)`;
                aShell.style.opacity   = '0.001';
              });
              await wait(SLIDE_MS + 240);
              try { aShell.remove(); } catch {}
            } else {
              aShell.style.transition = 'none';
              aShell.style.transform  = `translate(0px, ${ACCEPT_OFFSETY}px)`;
              aShell.style.zIndex     = String(REJECT_BASE_Z + 2000);
              void aShell.offsetHeight;
              requestAnimationFrame(() => {
                aShell.style.transition = `transform ${SLIDE_MS}ms ${EASE_SLIDE}`;
                aShell.style.transform  = `translate(${x0}px, ${y0}px)`;
              });
              await wait(SLIDE_MS + 40);
            }
          }

          // 3c) Flip the ENTIRE visible pile back
          {
            const { x0, y0 } = getRejectStackBase();

            const pileShells = [
              ...rejectNodes.map(n => n && n.shell).filter(Boolean),
              (!acceptedCast && acceptNode && acceptNode.shell) ? acceptNode.shell : null
            ].filter(Boolean);

            for (let i = 0; i < pileShells.length; i++){
              const sh = pileShells[i];
              sh.classList.remove('to-down','casc-accept','casc-reject');
              sh.style.transition = (sh.style.transition && sh.style.transition.length)
                ? sh.style.transition + ', transform 1ms linear'
                : 'transform 1ms linear';
              sh.style.transform  = `translate(${x0}px, ${y0}px) rotate(0deg)`;
              sh.style.zIndex     = String(REJECT_BASE_Z + 2400 + i);
            }

            for (let i = 0; i < pileShells.length; i++){
              const sh = pileShells[i];
              setTimeout(() => { try{ sh.classList.remove('casc-flipped'); }catch{} }, i * 30);
            }

            await wait(FLIP_MS + 100);
          }

          // 3c.1) Riffle flourish
          {
            const { x0, y0 } = getRejectStackBase();
            const actors = [
              (!acceptedCast && acceptNode?.shell) ? acceptNode.shell : null,
              rejectNodes[rejectNodes.length - 1]?.shell,
              rejectNodes[rejectNodes.length - 2]?.shell
            ].filter(Boolean);
            await shuffleFlourish(actors, x0, y0);
          }

          // 3c.2) Final UNDER-THE-DECK slide
          {
            const { x, y } = getDeckHome();
            const { ch } = getCardCSSSize();
            const TUCK_PX = Math.max(10, Math.round(ch * 0.06));

            const tuckShells = [
              ...rejectNodes.map(n => n && n.shell).filter(Boolean),
              (!acceptedCast && acceptNode && acceptNode.shell) ? acceptNode.shell : null
            ].filter(Boolean);

            for (let i = tuckShells.length - 1; i >= 0; i--){
              const shell = tuckShells[i];
              if (!shell) continue;

              shell.style.transition = `transform ${SLIDE_MS}ms ${EASE_SLIDE}, opacity 220ms linear`;
              shell.style.opacity    = '1';
              shell.style.zIndex     = String(REJECT_BASE_Z + 2600 + i);

              requestAnimationFrame(() => {
                shell.style.transform = `translate(${x}px, ${y + TUCK_PX}px)`;
              });

              const bury = () => {
                shell.removeEventListener('transitionend', bury);
                shell.style.opacity = '0.001';
                setTimeout(() => {
                  shell.style.zIndex = '-999999';
                  try { shell.remove(); } catch {}
                }, 60);
              };
              shell.addEventListener('transitionend', bury, { once: true });

              await wait(40);
            }

            await wait(SLIDE_MS + 120);
          }

        } catch (e){
          console.warn(`${TAG} collapse/flip-back error`, e);
        }

        // 3d) Bottom the rejects safely via DeckSync (handles declined hit too)
try {
  window.DeckSync.bottomAfterCascade({
    rejects,
    hit,                 // the candidate (or null)
    didCast: acceptedCast,
    seat
  });
} catch (e){
  console.warn(`${TAG} DeckSync bottom-after-cascade failed`, e);
}

      }

      // End notes
      if (hit){
        status(`Cascade hit: ${hit?.name}. Bottomed ${rejects.length}.`);
        try { sendRTC?.({ type:'cascade:hit', seat, name: hit?.name || '', rejects: rejects.length }); } catch {}
      } else {
        status(`No eligible card found. Bottomed ${rejects.length}.`);
        try { sendRTC?.({ type:'cascade:miss', seat, rejects: rejects.length }); } catch {}
      }

      if (AUTO_CLOSE_MS != null){
        setTimeout(()=>{ try{ stage.remove(); }catch{} }, AUTO_CLOSE_MS|0);
      }
    }
  };

  console.log(`${TAG} script loaded; window.CascadeLogic available.`);
})();
