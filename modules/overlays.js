// ================================
// FILE: modules/overlays.js
// Unified overlay manager (mobile-first) + combat scaffolds + tiny prompts
// ================================

const THEME = {
  panelBg:   '#0b1220',
  panelHdr:  '#1a1f2b',
  text:      '#e7e9ee',
  border:    'rgba(255,255,255,0.08)',
};

function debounce(fn, ms){
  let t = 0;
  return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
}


const Overlays = {
  root: null,
  stack: [],

  init(){
    if (this.root) return;
    const root = document.createElement('div');
    root.id = 'overlayRoot';
    Object.assign(root.style, { position:'fixed', inset:0, pointerEvents:'none', zIndex: 200000 });

    document.body.appendChild(root);
    this.root = root;
  },

  // ---- infra ----
  _push(el){ this.init(); this.root.appendChild(el); this.stack.push(el); },
  _pop(el){
    if (!el) return;
    try{ el.remove(); }catch{}
    this.stack = this.stack.filter(n => n !== el);
  },
  closeAll(){ while (this.stack.length) this._pop(this.stack.at(-1)); },

  _panel({ title='Overlay', width='min(700px, 96vw)', height='min(88vh, 760px)' } = {}){
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
  position:'fixed', inset:0, background:'rgba(0,0,0,.38)',
  display:'grid', placeItems:'center', pointerEvents:'auto', zIndex: 200001
});
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width, height, maxWidth:'96vw', maxHeight:'88vh',
      background: THEME.panelBg, color: THEME.text,
      border:`1px solid ${THEME.border}`, borderRadius:'14px',
      display:'grid', gridTemplateRows:'48px 1fr', overflow:'hidden',
      boxShadow:'0 12px 34px rgba(0,0,0,.45)'
    });
    const head = document.createElement('div');
    Object.assign(head.style, {
      background: THEME.panelHdr, borderBottom:`1px solid ${THEME.border}`,
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'0 10px', fontWeight:800
    });
    head.textContent = title;
    const close = document.createElement('button');
    close.textContent = '✕';
    Object.assign(close.style, { background:'transparent', border:0, color:THEME.text, fontSize:'16px', padding:'6px', cursor:'pointer' });
    head.appendChild(close);

    const body = document.createElement('div');
    Object.assign(body.style, { padding:'10px', overflow:'auto' });

    panel.appendChild(head); panel.appendChild(body); wrap.appendChild(panel);

    const onBg = (e)=>{ if (e.target === wrap) this._pop(wrap); };
    wrap.addEventListener('pointerdown', onBg);
    close.addEventListener('click', ()=> this._pop(wrap));

    return { wrap, panel, head, body, close };
  },

  // ---- helpers ----
  _btn(label, onClick){
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      background:'#1a2a45', color:'#cfe1ff', border:`1px solid #2b3f63`,
      borderRadius:'10px', padding:'6px 10px', fontWeight:900, cursor:'pointer'
    });
    b.addEventListener('click', onClick);
    return b;
  },
  _input(styleExtras={}){
    const i = document.createElement('input');
    Object.assign(i.style, {
      background:'#0a0f16', color:'#e7efff', border:`1px solid ${THEME.border}`,
      borderRadius:'10px', padding:'8px', width:'100%',
      ...styleExtras
    });
    return i;
  },
  _escape(s){ return String(s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); },

  // ---------- Zone grid (graveyard / exile) ----------
  // Adds: type filter + search, and auto-refreshes after moves.
  // Optional: pass fetchCards() to re-pull authoritative list after a move.
  openZoneList({ title, seat, zoneName, cards = [], onMove, fetchCards }){
    const border = (window.THEME?.border) || 'rgba(255,255,255,.08)';
    const ui = this._panel({ title: title || `${String(zoneName).toUpperCase()} — P${seat}` });

    // ── Controls (search + type filter)
    const controls = document.createElement('div');
    Object.assign(controls.style, {
      display:'grid',
      gridTemplateColumns:'1fr auto',
      gap:'8px',
      marginBottom:'8px'
    });
    const q = this._input(); q.placeholder = 'Search name or text…';

    const sel = document.createElement('select');
    Object.assign(sel.style, {
      background:'#0a0f16', color:'#e7efff',
      border:`1px solid ${border}`, borderRadius:'10px', padding:'8px'
    });
    const TYPES = ['All','Creature','Artifact','Instant','Sorcery','Enchantment','Planeswalker','Land','Token','Battle','Other'];
    TYPES.forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });

    controls.appendChild(q);
    controls.appendChild(sel);
    ui.body.appendChild(controls);

    // ── Grid
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display:'grid',
      gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))',
      gap:'10px'
    });
    ui.body.appendChild(grid);

    // ── helpers
    const typeBucket = (typeLine='')=>{
      const tl = String(typeLine).toLowerCase();
      if (tl.includes('creature')) return 'Creature';
      if (tl.includes('artifact')) return 'Artifact';
      if (tl.includes('instant')) return 'Instant';
      if (tl.includes('sorcery')) return 'Sorcery';
      if (tl.includes('enchantment')) return 'Enchantment';
      if (tl.includes('planeswalker')) return 'Planeswalker';
      if (tl.includes('land')) return 'Land';
      if (tl.includes('token')) return 'Token';
      if (tl.includes('battle')) return 'Battle';
      return 'Other';
    };

    const makeTile = (c) => {
      const tile = document.createElement('div');
      Object.assign(tile.style, {
        background:'#1a1f2a', border:`1px solid ${border}`, borderRadius:'10px',
        overflow:'hidden', display:'grid', gridTemplateRows:'auto auto auto'
      });

      const thumb = document.createElement('div');
      const artUrl =
        (c?.img && String(c.img)) ||
        (c?.id ? `https://api.scryfall.com/cards/${encodeURIComponent(String(c.id))}?format=image&version=normal` : '');
      const fallbackArt = c?.image || 'https://via.placeholder.com/200x280/111826/9fb4d9?text=' + encodeURIComponent(c?.name || 'Unknown');
      Object.assign(thumb.style, {
        width:'100%', paddingTop:'140%', background:'#111',
        backgroundSize:'cover', backgroundPosition:'center'
      });
      thumb.style.backgroundImage = `url("${artUrl || fallbackArt}")`;
      tile.appendChild(thumb);

      const name = document.createElement('div');
      name.textContent = c?.name || '(unknown)';
      Object.assign(name.style, {
        padding:'8px', fontWeight:800, fontSize:'12px', whiteSpace:'nowrap',
        textOverflow:'ellipsis', overflow:'hidden', borderTop:`1px solid ${border}`
      });
      tile.appendChild(name);

      const actions = document.createElement('div');
      Object.assign(actions.style, {
        display:'flex', gap:'6px', padding:'8px', borderTop:`1px solid ${border}`,
        background:'#0b1220', flexWrap:'wrap'
      });

      const doMove = async (dest)=>{
        try {
          await onMove?.(c, dest);  // your zones handler does the real move (SB write + DOM)
          // Optimistic: remove from local list so overlay updates immediately
          if (c?.id) cards = (cards || []).filter(x => String(x?.id) !== String(c.id));
          // Authoritative refresh if provided
          if (typeof fetchCards === 'function'){
            try{
              const latest = await fetchCards();
              if (Array.isArray(latest)) cards = latest;
            }catch(_){}
          }
        } finally {
          render(); // re-render so user sees new state
        }
      };

      const addBtn = (label, dest) => {
        const b = this._btn(label, (e)=>{ e.stopPropagation(); doMove(dest); });
        Object.assign(b.style, { padding:'6px 8px' });
        actions.appendChild(b);
      };

      addBtn('Table','table');
      addBtn('Hand','hand');
      addBtn('Deck','deck');
      const alt = zoneName === 'graveyard' ? 'exile' : 'graveyard';
      addBtn(alt[0].toUpperCase()+alt.slice(1), alt);

      tile.appendChild(actions);
      return tile;
    };

    const render = ()=>{
      grid.innerHTML = '';
      const query = (q.value||'').toLowerCase();
      const wantType = sel.value;

      const list = (Array.isArray(cards) ? cards : []).filter(c=>{
        const name = (c?.name||'').toLowerCase();
        const text = (c?.oracle_text||c?.text||'').toLowerCase();
        const okQuery = !query || name.includes(query) || text.includes(query);
        const bucket = typeBucket(c?.type_line||'');
        const okType = (wantType === 'All') ? true : (bucket === wantType);
        return okQuery && okType;
      });

      if (!list.length){
        const empty = document.createElement('div');
        empty.textContent = 'No cards.'; empty.style.opacity = '.8';
        grid.appendChild(empty);
        return;
      }
      list.forEach(c => grid.appendChild(makeTile(c)));
    };

    q.addEventListener('input', render);
    sel.addEventListener('change', render);

    render();
    this._push(ui.wrap);
  },


  // ---------- Deck: search / options / add / insert-choice ----------
  openDeckSearch({ seat, deckCards = [], filterTypes = ['All','Creature','Instant','Sorcery','Artifact','Enchantment','Planeswalker','Land','Token'], onMove, onCloseAskShuffle }){
    const ui = this._panel({ title:`Deck — P${seat}` });
    const top = document.createElement('div');
    Object.assign(top.style, { display:'grid', gridTemplateColumns:'1fr auto', gap:'8px', marginBottom:'8px' });

    const q = this._input(); q.placeholder = 'Search name…';
    const sel = document.createElement('select');
    Object.assign(sel.style, { background:'#0a0f16', color:'#e7efff', border:`1px solid ${THEME.border}`, borderRadius:'10px', padding:'8px' });
    filterTypes.forEach(t => { const o = document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });

    top.appendChild(q); top.appendChild(sel); ui.body.appendChild(top);
	// Deck list search uses the local render(); keep it lightweight
q.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') render(); });
q.addEventListener('input', debounce(()=>render(), 150));


    const list = document.createElement('div'); ui.body.appendChild(list);


// Back-compat: some old code still calls doSearch(); keep it mapped
const doSearch = () => render();

    const render = ()=>{
  list.innerHTML = '';
  const query = (q.value||'').toLowerCase();
  const ft = sel.value;

  const items = (Array.isArray(deckCards) ? deckCards : []).filter(c=>{
    const n = (c?.name||'').toLowerCase();
    const t = (c?.type_line||'');
    const okN = !query || n.includes(query);
    const okT = ft === 'All' ? true : t.includes(ft);
    return okN && okT;
  });

  if (!items.length){
    const d = document.createElement('div');
    d.textContent = 'No matches.'; d.style.opacity = '.8';
    list.appendChild(d);
    return;
  }

  // Turn the container into an image grid
  Object.assign(list.style, {
    display:'grid',
    gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',
    gap:'10px'
  });

  items.forEach(c=>{
    const tile = document.createElement('div');
    Object.assign(tile.style, {
      background:'#1a1f2a',
      border:`1px solid ${THEME.border}`,
      borderRadius:'10px',
      overflow:'hidden',
      display:'grid',
      gridTemplateRows:'auto auto auto'
    });

    const thumb = document.createElement('div');
    Object.assign(thumb.style, {
      width:'100%',
      paddingTop:'140%',
      background:'#111',
      backgroundSize:'cover',
      backgroundPosition:'center'
    });
    const artUrl = (c?.img) || `https://via.placeholder.com/200x280/111826/9fb4d9?text=${encodeURIComponent(c?.name||'')}`;
    thumb.style.backgroundImage = `url("${artUrl}")`;
    tile.appendChild(thumb);

    const meta = document.createElement('div');
    meta.innerHTML = `
      <div style="font-weight:800">${this._escape(c?.name||'')}</div>
      <div style="opacity:.85; font-size:12px">${this._escape(c?.type_line||'')}</div>`;
    Object.assign(meta.style, {
      padding:'8px',
      fontSize:'12px',
      borderTop:`1px solid ${THEME.border}`
    });
    tile.appendChild(meta);

    const actions = document.createElement('div');
    Object.assign(actions.style, {
      display:'flex',
      gap:'6px',
      padding:'8px',
      borderTop:`1px solid ${THEME.border}`,
      background:'#0b1220',
      flexWrap:'wrap'
    });

    const addBtn = (label,dest)=>{
      const b = this._btn(label, (e)=>{ e.stopPropagation(); onMove?.(c, dest); });
      Object.assign(b.style, { padding:'6px 8px' });
      actions.appendChild(b);
    };

    // No “Add to Deck”
    addBtn('Table','table');
    addBtn('Hand','hand');
    addBtn('Graveyard','graveyard');
    addBtn('Exile','exile');

    tile.appendChild(actions);
    list.appendChild(tile);
  });
};
q.addEventListener('input', render);
sel.addEventListener('change', render);
render();


    const askClose = ()=>{
      if (!onCloseAskShuffle) return this._pop(ui.wrap);
      const ans = confirm('Shuffle deck now?');
      try { onCloseAskShuffle(!!ans); } finally { this._pop(ui.wrap); }
    };
    ui.close.addEventListener('click', askClose);
    ui.wrap.addEventListener('pointerdown', (e)=>{ if (e.target === ui.wrap) askClose(); });

    this._push(ui.wrap);
  },

  openDeckOptions({ seat, onDrawX, onMillX, onCascade, onShuffle }){
  const ui = this._panel({ title:`Deck Tools — P${seat}`, height:'auto' });

  const mkRow = (label, control)=>{
    const row = document.createElement('div');
    Object.assign(row.style, { display:'grid', gridTemplateColumns:'1fr auto', gap:'8px', padding:'8px 0', alignItems:'center' });
    const l = document.createElement('div'); l.textContent = label;
    row.appendChild(l); row.appendChild(control);
    return row;
  };
  const chip = (n, into)=>{
    const b = this._btn(`+${n}`, ()=>{ into.value = String((Number(into.value||0)|0)+n); });
    Object.assign(b.style, { padding:'4px 8px' });
    return b;
  };
  const group = (a,b,c)=>{ const g=document.createElement('div'); Object.assign(g.style,{ display:'grid', gridTemplateColumns:'1fr auto auto auto', gap:'8px' }); g.appendChild(a); g.appendChild(b); if (c?.length) c.forEach(x=>g.appendChild(x)); return g; };

  // Draw X
  const drawN = this._input({ width:'90px' }); drawN.type='number'; drawN.min='1'; drawN.placeholder='X';
  const drawB = this._btn('Draw', ()=>{
    const n = Math.max(1, Number(drawN.value||0)|0);
    onDrawX?.(n);
  });
  drawN.addEventListener('keydown', (e)=>{ if (e.key==='Enter') drawB.click(); });
  ui.body.appendChild(mkRow('Draw X cards', group(drawN, drawB, [chip(1,drawN), chip(5,drawN)])));

  // Mill X
  const millN = this._input({ width:'90px' }); millN.type='number'; millN.min='1'; millN.placeholder='X';
  const millB = this._btn('Mill', ()=>{
    const n = Math.max(1, Number(millN.value||0)|0);
    onMillX?.(n);
  });
  millN.addEventListener('keydown', (e)=>{ if (e.key==='Enter') millB.click(); });
  ui.body.appendChild(mkRow('Mill X cards', group(millN, millB, [chip(1,millN), chip(5,millN)])));

  // Cascade launcher (opens wizard below)
  const cascadeBtn = this._btn('Set up…', ()=>{
    this.openCascadeWizard({ seat, onCascade });
  });
  ui.body.appendChild(mkRow('Cascade', cascadeBtn));

  // Shuffle
  ui.body.appendChild(mkRow('Shuffle deck', this._btn('Shuffle', ()=> onShuffle?.())));

  this._push(ui.wrap);
},

openCascadeWizard({ seat, onCascade } = {}){
  const ui = this._panel({ title:`Cascade — P${seat}`, height:'auto' });

  const wrap = document.createElement('div');
  Object.assign(wrap.style, { display:'grid', gap:'10px' });

  // === Minimal UI: N spinner + 2 checkboxes ===
  // nspin (modern number picker like counters / P/T)
  function makeNumberSpinner({ value = 0 } = {}){
    const sp = document.createElement('div');
    sp.className = 'nspin';
    const btnSub = document.createElement('button');
    const input  = document.createElement('input');
    const btnAdd = document.createElement('button');

    btnSub.type='button'; btnAdd.type='button';
    btnSub.className='nbtn nsub'; btnAdd.className='nbtn nadd';
    btnSub.textContent = '−'; btnAdd.textContent = '+';
    input.type='number'; input.className='nspin-input'; input.value = String(value);
    input.readOnly = true; input.inputMode = 'numeric';

    // compact, pill-ish look (inline styles keep it self-contained)
    Object.assign(sp.style,  { display:'inline-flex', alignItems:'center', gap:'6px',
      border:`1px solid ${THEME?.border||'#2b3f63'}`, borderRadius:'999px',
      background:'#0f1829', color:'#cfe1ff', padding:'4px 8px' });
    const bStyle = { border:'0', borderRadius:'10px', width:'28px', height:'28px',
      fontWeight:900, background:'#142039', color:'#cfe1ff', cursor:'pointer' };
    Object.assign(btnSub.style,bStyle); Object.assign(btnAdd.style,bStyle);
    Object.assign(input.style,{ width:'64px', background:'transparent', color:'#cfe1ff',
      border:'0', textAlign:'center', fontWeight:900 });

    sp.appendChild(btnSub); sp.appendChild(input); sp.appendChild(btnAdd);

    // wiring (mirrors your attributes panel spinners) :contentReference[oaicite:3]{index=3}
    const get = ()=> Number(input.value || 0);
    const set = (v)=>{ input.value = String(v|0); input.dispatchEvent(new Event('input', {bubbles:true})); };
    const step = (d)=> set(get() + d);

    btnAdd.addEventListener('click', e=>{ e.stopPropagation(); step(+1); });
    btnSub.addEventListener('click', e=>{ e.stopPropagation(); step(-1); });

    // long-press repeat
    function autoRepeat(btn, dir){
      let t=null, rep=null;
      const start = (e)=>{ e.preventDefault(); e.stopPropagation(); step(dir); t=setTimeout(()=>rep=setInterval(()=>step(dir), 60), 350); };
      const stop  = ()=>{ clearTimeout(t); clearInterval(rep); t=null; rep=null; };
      ['mousedown','touchstart'].forEach(ev=>btn.addEventListener(ev,start,{passive:false}));
      ['mouseup','mouseleave','touchend','touchcancel'].forEach(ev=>btn.addEventListener(ev,stop));
    }
    autoRepeat(btnAdd, +1); autoRepeat(btnSub, -1);

    // wheel + scrub
    sp.addEventListener('wheel', (e)=>{ e.preventDefault(); step(e.deltaY>0 ? -1*(e.shiftKey?5:1) : +1*(e.shiftKey?5:1)); }, {passive:false});
    let dragging=false,lastY=0;
    sp.addEventListener('pointerdown',(e)=>{ dragging=true; lastY=e.clientY; sp.setPointerCapture?.(e.pointerId); });
    sp.addEventListener('pointerup',()=>{ dragging=false; });
    sp.addEventListener('pointercancel',()=>{ dragging=false; });
    sp.addEventListener('pointermove',(e)=>{ if(!dragging) return; const dy=e.clientY-lastY; if(Math.abs(dy)>=10){ step(dy>0?-1:+1); lastY=e.clientY; } });

    return { el: sp, getValue: ()=> get() };
  }

  // Row layout: [N spinner]  [toggles]
  const line1 = document.createElement('div');
  Object.assign(line1.style, { display:'grid', gridTemplateColumns:'160px 1fr', gap:'8px', alignItems:'center' });

  const nSpin = makeNumberSpinner({ value: 0 });
  line1.appendChild(nSpin.el);

  const cbLess   = document.createElement('label');
  const cbLand   = document.createElement('label');
  cbLess.innerHTML = `<input type="checkbox" checked> Hit must have mana value &lt; N`;
  cbLand.innerHTML = `<input type="checkbox" checked> Ignore lands`;
  const toggles = document.createElement('div');
  Object.assign(toggles.style,{ display:'grid', gap:'6px' });
  toggles.appendChild(cbLess); toggles.appendChild(cbLand);
  line1.appendChild(toggles);

  // Start only (no help text / no footer) :contentReference[oaicite:4]{index=4}
  const start = this._btn('Start Cascade', ()=>{
    const N = Math.max(0, Number(nSpin.getValue()||0)|0);
    const strictLess  = cbLess.querySelector('input').checked;
    const ignoreLands = cbLand.querySelector('input').checked;

    if (typeof onCascade === 'function'){
      onCascade({ value: N, strictLess, ignoreLands, seat });
      this._pop(ui.wrap);
      this.notify('info', `Cascade: N=${N} • ${ignoreLands?'ignore lands':'include lands'} • ${strictLess?'<' : '≤' } N`);
    } else {
      this.notify('warn', 'No cascade handler wired. Provide onCascade in Overlays.openDeckOptions.');
    }
  });
  Object.assign(start.style, { fontSize:'14px', padding:'8px 12px', fontWeight:900 });

  wrap.appendChild(line1);
  wrap.appendChild(start);

  ui.body.appendChild(wrap);
  this._push(ui.wrap);
},



// ---------- Add Any Card (Scryfall) as art grid ----------
openAddCard({
  seat,
  onSpawnToTable,

  // NEW: optional presets for external callers (e.g., Draw-Rule token)
  presetQuery = '',     // e.g., "Food", "Clue", "Zombie"
  presetType  = '',     // e.g., "Token", "Creature", "All"
  autoSearch  = false   // if true, immediately run a search with presets
}){
  const ui = this._panel({ title:`Add Card / Token — P${seat}` });
    console.log('[PROBE C] openAddCard seat=', seat, 'presetQuery=', presetQuery, 'presetType=', presetType, 'autoSearch=', autoSearch);


  // ── Search input
  const q = this._input();
  q.placeholder = 'Search (e.g. "Lightning Bolt", type: instant burn)';

      // ── Type bucket
  const selType = document.createElement('select');
  Object.assign(selType.style, { background:'#0a0f16', color:'#e7efff', border:`1px solid ${THEME.border}`, borderRadius:'10px', padding:'8px' });
  ['All','Creature','Instant','Sorcery','Artifact','Enchantment','Planeswalker','Land','Battle','Token','Non-token']
    .forEach(t => { const o=document.createElement('option'); o.value=t; o.textContent=t; selType.appendChild(o); });

  // --- NEW: apply presets (type + query) ---
  if (presetType){
    const opt = Array.from(selType.options).find(o =>
      String(o.value).toLowerCase() === String(presetType).toLowerCase()
    );
    if (opt) selType.value = opt.value;
  }
  if (presetQuery) q.value = String(presetQuery);

  // ── Rarity
  const selRarity = document.createElement('select');

    Object.assign(selRarity.style, { background:'#0a0f16', color:'#e7efff', border:`1px solid ${THEME.border}`, borderRadius:'10px', padding:'8px' });
    [['','Any rarity'],['c','Common'],['u','Uncommon'],['r','Rare'],['m','Mythic']]
      .forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; selRarity.appendChild(o); });

    // ── Legality (common quick picks)
    const selLegal = document.createElement('select');
    Object.assign(selLegal.style, { background:'#0a0f16', color:'#e7efff', border:`1px solid ${THEME.border}`, borderRadius:'10px', padding:'8px' });
    [['','Any format'],['commander','Commander-legal'],['modern','Modern-legal'],['pioneer','Pioneer-legal'],['standard','Standard-legal']]
      .forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; selLegal.appendChild(o); });

    // ── Color chips (W U B R G) with visible ON state
const colors = ['W','U','B','R','G'];
const colorWrap = document.createElement('div');
Object.assign(colorWrap.style, { display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap' });

const colorBtns = new Map();

// tiny helper to style ON/OFF
function styleColorChip(btn, on){
  btn.classList.toggle('is-on', !!on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  Object.assign(btn.style, {
    padding:'4px 8px',
    border:`1px solid ${on ? '#6da7ff' : '#2b3f63'}`,
    background: on ? '#213656' : '#1a2a45',
    color:'#cfe1ff',
    borderRadius:'10px',
    fontWeight:900,
    cursor:'pointer',
    boxShadow: on ? 'inset 0 0 0 1px rgba(173,208,255,.35), 0 0 0 2px rgba(77,139,255,.18)' : 'none',
    transform: on ? 'translateY(-1px)' : 'none'
  });
}

colors.forEach(C=>{
  // use a plain button so we fully control styles
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = C;
  b.classList.add('ci-chip');
  b.setAttribute('aria-pressed', 'false');

  // initial OFF visuals
  styleColorChip(b, false);

  // toggle on click (and let the existing debounced search fire)
  b.addEventListener('click', (e)=>{
    e.preventDefault();
    const on = !b.classList.contains('is-on');
    styleColorChip(b, on);
    // trigger the existing debounced() if you added it below
    try { debounced?.(); } catch {}
  });

  // keyboard toggle (Space / Enter)
  b.addEventListener('keydown', (e)=>{
    if (e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); b.click(); }
  });

  colorWrap.appendChild(b);
  colorBtns.set(C, b);
});


// “Exact” now applies to whichever mode (card color OR color identity)
const exactChk = document.createElement('label');
exactChk.innerHTML = `<input type="checkbox" class="js-ci-exact"> Exact`;
Object.assign(exactChk.style, { fontSize:'12px', opacity:.9 });

// New: choose card color (c) vs color identity (id). Default: card color.
const useIdChk = document.createElement('label');
useIdChk.innerHTML = `<input type="checkbox" class="js-ci-useid"> Use color identity`;
Object.assign(useIdChk.style, { fontSize:'12px', opacity:.9 });

// ── Mana value range
const mvMin = this._input({ width:'80px' }); mvMin.type='number'; mvMin.placeholder='MV min';
const mvMax = this._input({ width:'80px' }); mvMax.type='number'; mvMax.placeholder='MV max';


    // ── Go button
    const go = this._btn('Search', doSearch);

    // ── Layout rows
    const row1 = document.createElement('div');
    Object.assign(row1.style, { display:'grid', gridTemplateColumns:'1fr auto auto auto', gap:'8px', marginBottom:'8px' });
    row1.append(q, selType, selRarity, selLegal);

    const row2 = document.createElement('div');
    Object.assign(row2.style, { display:'grid', gridTemplateColumns:'auto 1fr auto auto auto', gap:'8px', alignItems:'center', marginBottom:'8px' });
const mvBox = document.createElement('div'); Object.assign(mvBox.style, { display:'flex', gap:'6px', alignItems:'center' });
mvBox.append(mvMin, mvMax);
row2.append(colorWrap, exactChk, useIdChk, mvBox, go);


    ui.body.append(row1, row2);

  const list = document.createElement('div'); ui.body.appendChild(list);

  // Quick UX hooks
  q.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') doSearch(); });
  [selType, selRarity, selLegal].forEach(el => el.addEventListener('change', ()=>doSearch()));
  [mvMin, mvMax].forEach(el => el.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') doSearch(); }));
  // tap chips to toggle; pressing any chip triggers a debounced search
  const debounced = debounce(()=>doSearch(), 250);
  colorWrap.addEventListener('click', debounced);
  exactChk.querySelector('input')?.addEventListener('change', debounced);
  useIdChk.querySelector('input')?.addEventListener('change', debounced);
  if (autoSearch){
    console.log('[PROBE C] autoSearch → clicking Search');
    setTimeout(()=>{ try{ go.click(); }catch(e){ console.warn('[PROBE C] autoSearch click failed', e); } }, 0);
  }

  // --- NEW: auto-search when requested (after DOM is mounted) ---
  if (autoSearch){
    setTimeout(()=>{ try{ go.click(); }catch{} }, 0);
  }




// --- fast search helpers (scoped to this overlay) ---
let _abort = null;
const _cache = new Map(); // key: `${mode}|${s}` → array of cards

function debounce(fn, ms){
  let t = 0;
  return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
}

function artFromSmall(card){
  const face = Array.isArray(card?.card_faces) && card.card_faces[0] ? card.card_faces[0] : card;
  return (card?.image_uris?.small || face?.image_uris?.small ||
          card?.image_uris?.normal || face?.image_uris?.normal || '');
}


      // Advanced Scryfall builder honoring all filters above
    async function doSearch(){
      // cancel any previous in-flight request
      if (_abort) _abort.abort();
      _abort = new AbortController();

      const s = (q.value||'').trim();
      if (!s){ q.focus(); return; }

      list.innerHTML = '<div style="opacity:.7">Searching…</div>';

      // --- Build Scryfall query ---
      const parts = [];

      // name-biased: prefer exact/name matches but still allow full text
      // e.g., name:"Lightning Bolt" OR lightning burn
      // name-biased: prefer exact/name matches but still allow full text
// IMPORTANT: Wrap OR group in parentheses so other filters still apply!
parts.push(`(name:${JSON.stringify(s)} OR ${s})`);


      // game
      parts.push('game:paper');

      // type bucket
      const t = selType.value;
      if (t && t !== 'All'){
        if (t === 'Token') parts.push('is:token');
        else if (t === 'Non-token') parts.push('-is:token');
        else parts.push(`type:${t.toLowerCase()}`);
      }

      // rarity
      const r = selRarity.value; // c|u|r|m
      if (r) parts.push(`r:${r}`);

      // legality quick pick
      const lg = selLegal.value;
      if (lg) parts.push(`legal:${lg}`);

      // colors (card colors by default, color identity if toggle is on)
const chosen = ['W','U','B','R','G'].filter(C => colorBtns.get(C)?.classList.contains('is-on'));
if (chosen.length){
  const exact = !!ui.body.querySelector('.js-ci-exact')?.checked;
  const useId = !!ui.body.querySelector('.js-ci-useid')?.checked; // new toggle
  const slug = chosen.join('');                                  // e.g., "WU"
  if (useId){
    parts.push(exact ? `id=${slug}` : `id<=${slug}`);
  } else {
    parts.push(exact ? `c=${slug}` : `c<=${slug}`);
  }
}


      // mana value range
      // mana value range (only apply if the field is non-empty)
const minStr = (mvMin.value ?? '').trim();
if (minStr !== '') {
  const min = Number(minStr);
  if (Number.isFinite(min)) parts.push(`mv>=${min}`);
}

const maxStr = (mvMax.value ?? '').trim();
if (maxStr !== '') {
  const max = Number(maxStr);
  if (Number.isFinite(max)) parts.push(`mv<=${max}`);
}


      // final
      const adv = parts.join(' ').replace(/\s+/g,' ').trim();
const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(adv)}&order=relevance&unique=cards&include_extras=false&include_multilingual=false`;
console.debug('[AddCard] Scryfall Q=', adv);

      try{
        const r = await fetch(url, { signal:_abort.signal });
        if (!r.ok) throw new Error(`Scryfall ${r.status}`);
        const j = await r.json();
        const cards = Array.isArray(j.data) ? j.data : [];
        // prefer small thumbs for speed
        for (const c of cards){ c.__thumbSmall = artFromSmall(c); }
        render(cards);
      }catch(e){
        if (e?.name === 'AbortError') return;
        console.warn('[AddCard] search failed', e);
        list.innerHTML = '<div style="opacity:.8">Search failed.</div>';
      }finally{
        _abort = null;
      }
    }



	// helper for showing art like the other overlays
function artFrom(c){
  if (c?.image_uris?.normal) return c.image_uris.normal;
  if (Array.isArray(c?.card_faces) && c.card_faces[0]?.image_uris?.normal) return c.card_faces[0].image_uris.normal;
  return '';
}

// Render "{1}{B}{U/P}{2/W}{C}{X}" with Mana Master icons,
// falling back to Scryfall SVGs if the "ms" icon font isn't present.
function renderMana(manaCost){
  const str = String(manaCost || '').trim();
  if (!str) return '';

  const tokens = str.match(/\{[^}]+\}/g) || [];

  // if Mana Master / mana-font classes are available (`.ms`)
  const hasMs = !!document.querySelector('link[href*="mana"], link[href*="mana-font"], link[href*="manamaster"]') ||
                !!document.querySelector('.ms');

  const toMsClass = (tok)=>{
    // strip braces, lower, remove slashes (W/U -> "wu", 2/W -> "2w", U/P -> "up")
    const raw = tok.slice(1, -1).toLowerCase();
    // common Scryfall tokens: w,u,b,r,g,c,s,x,y,z, numbers, t,q,e,∞, etc.
    // normalize hybrids/phyrexian like "w/u", "2/w", "u/p"
    let key = raw.replace(/\s+/g,'').replace(/\//g,''); // "w/u" -> "wu", "2/w" -> "2w"
    return `ms ms-${key}`;
  };

  if (hasMs){
    return `<span class="mm-cost">${tokens.map(t => `<i class="${toMsClass(t)}"></i>`).join(' ')}</span>`;
  }

  // fallback: Scryfall SVGs (e.g., https://svgs.scryfall.io/card-symbols/WU.svg)
  const toSvgName = (tok)=>{
    const raw = tok.slice(1, -1).toUpperCase().replace(/\//g,''); // "W/U" -> "WU", "2/W" -> "2W", "U/P" -> "UP"
    return raw;
  };
  return `<span class="mm-cost">${tokens.map(t =>
    `<img alt="${t}" src="https://svgs.scryfall.io/card-symbols/${toSvgName(t)}.svg" style="height:1em;vertical-align:-0.15em">`
  ).join(' ')}</span>`;
}


    function render(cards){
  // turn the container into an image grid (like Deck/Graveyard/Exile)
  list.innerHTML = '';
  Object.assign(list.style, {
    display:'grid',
    gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',
    gap:'10px'
  });

  if (!Array.isArray(cards) || !cards.length){
    const d = document.createElement('div');
    d.textContent = 'No matches.'; d.style.opacity = '.8';
    // keep layout stable even when empty
    Object.assign(d.style, { gridColumn:'1 / -1', padding:'4px 0' });
    list.appendChild(d);
    return;
  }

  const border = (window.THEME?.border) || 'rgba(255,255,255,.08)';

  cards.forEach(c=>{
    const tile = document.createElement('div');
    Object.assign(tile.style, {
      background:'#1a1f2a',
      border:`1px solid ${border}`,
      borderRadius:'10px',
      overflow:'hidden',
      display:'grid',
      gridTemplateRows:'auto auto auto'
    });

    // art
    const thumb = document.createElement('div');
    Object.assign(thumb.style, {
      width:'100%',
      paddingTop:'140%',
      background:'#111',
      backgroundSize:'cover',
      backgroundPosition:'center'
    });
    const artUrl = artFrom(c) || `https://via.placeholder.com/200x280/111826/9fb4d9?text=${encodeURIComponent(c?.name||'Unknown')}`;
    thumb.style.backgroundImage = `url("${artUrl}")`;
    tile.appendChild(thumb);

    // meta (name/type/mana)
    const meta = document.createElement('div');
    meta.innerHTML = `
      <div style="font-weight:800">${escapeHtml(c?.name||'')}</div>
      <div style="opacity:.85; font-size:12px">${escapeHtml(c?.type_line||'')}</div>
      <div style="opacity:.85; font-size:12px">${renderMana(c?.mana_cost||'')}</div>`;
    Object.assign(meta.style, {
      padding:'8px',
      fontSize:'12px',
      borderTop:`1px solid ${border}`
    });
    tile.appendChild(meta);

    // actions (same buttons as other overlays)
    const actions = document.createElement('div');
    Object.assign(actions.style, {
      display:'flex',
      gap:'6px',
      padding:'8px',
      borderTop:`1px solid ${border}`,
      background:'#0b1220',
      flexWrap:'wrap'
    });

    const payload = {
      id: c.id,
      name: c.name,
      type_line: c.type_line,
      mana_cost: c.mana_cost,
      oracle_text: c.oracle_text,
      img: artFrom(c)
    };

    const send = (dest)=>{
      const seatNow = (window.AppState?.mySeat) || seat || 1;
      if (dest === 'table') {
        if (typeof onSpawnToTable === 'function') onSpawnToTable(payload);
        else window.spawnCardAtViewCenter?.(payload, seatNow);
      }
      if (dest === 'hand')      window.addToHand?.(payload, seatNow);
      if (dest === 'graveyard') window.moveCardToZone?.(payload, 'graveyard', seatNow);
      if (dest === 'exile')     window.moveCardToZone?.(payload, 'exile', seatNow);
    };

    const addBtn = (label, dest)=>{
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        background:'#1a2a45', color:'#cfe1ff', border:'1px solid #2b3f63',
        borderRadius:'10px', padding:'6px 10px', fontWeight:900, cursor:'pointer'
      });
      b.addEventListener('click', (e)=>{ e.stopPropagation(); send(dest); });
      actions.appendChild(b);
    };

    addBtn('Table','table');
    addBtn('Hand','hand');
    addBtn('Graveyard','graveyard');
    addBtn('Exile','exile');

    tile.appendChild(actions);
    list.appendChild(tile);
  });
}

    const escapeHtml = (s)=> String(s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

    this._push(ui.wrap);
  },

  openDeckInsertChoice({ onTop, onBottom, onShuffle, onCancel }){
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position:'fixed', inset:0, display:'grid', placeItems:'center', background:'rgba(0,0,0,.35)', pointerEvents:'auto', zIndex: 10002 });
    const panel = document.createElement('div');
    Object.assign(panel.style, { background:THEME.panelBg, color:THEME.text, border:`1px solid ${THEME.border}`, borderRadius:'12px', padding:'10px', width:'min(320px,90vw)' });
    const row = document.createElement('div');
    Object.assign(row.style, { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' });

    const bTop=this._btn('Top', ()=>{ onTop?.(); pop(); });
    const bBot=this._btn('Bottom', ()=>{ onBottom?.(); pop(); });
    const bShf=this._btn('Shuffle', ()=>{ onShuffle?.(); pop(); });
    const bCan=this._btn('Cancel', ()=>{ onCancel?.(); pop(); });

    row.appendChild(bTop); row.appendChild(bBot);
    row.appendChild(bShf); row.appendChild(bCan);
    panel.appendChild(row); wrap.appendChild(panel);

    const pop = ()=> this._pop(wrap);
    wrap.addEventListener('pointerdown', (e)=>{ if (e.target === wrap) pop(); });

    this._push(wrap);
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
// Mini-Stack: opponent-cast prompt (bottom sheet)
// Overlays.openCastPrompt({ card:{name, mana_cost, oracle_text, img}, timeoutMs=5000,
//                           onResolve, onCounter })
// Auto-resolves when countdown hits 0 unless the user clicks/touches the bar.
// Clicking/touching pauses timer and reveals the buttons.
// Returns a disposer: () => void
// ─────────────────────────────────────────────────────────────────────────────
openCastPrompt({ card = {}, timeoutMs = 5000, onResolve, onCounter } = {}){
  // ensure single instance
  let host = document.getElementById('castPrompt');
  if (!host){
    host = document.createElement('div');
    host.id = 'castPrompt';
    host.style.cssText = `
      position:fixed; left:0; right:0; bottom:0; z-index:var(--z-overlays);
      display:grid; place-items:center; padding:10px 12px;
      background:linear-gradient(180deg, rgba(12,18,28,.0), rgba(12,18,28,.96));
      pointer-events:none;
    `;
    document.body.appendChild(host);
  }

  // inner panel
  const panel = document.createElement('div');
  panel.className = 'castPanel';
  panel.style.cssText = `
    pointer-events:auto; width:min(840px, 96vw);
    background:#0b1220; border:1px solid #2b3f63; border-radius:12px;
    padding:10px 12px; box-shadow:0 10px 26px rgba(0,0,0,.45);
    display:grid; grid-template-columns: auto 1fr auto; gap:10px; align-items:center;
  `;

  // tiny mana renderer (fallback if tooltip.manaToHtml is not imported here)
  const manaToHtmlLite = (src='') => String(src).replace(/\{([^}]+)\}/g, (_,sym)=>{
    const slug = String(sym).trim().toLowerCase().replace(/\W+/g,'');
    return `<i class="ms ms-${slug} ms-cost"></i>`;
  });

  const img = document.createElement('div');
  img.style.cssText = `width:60px; height:84px; border-radius:8px; background:#1a1f2a center/cover no-repeat;`;
  img.style.backgroundImage = card.img ? `url("${card.img}")` : 'none';

  const text = document.createElement('div');
  text.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
      <strong style="font-size:15px;">${card.name || 'Unknown spell'}</strong>
      <span class="cost">${(window.manaToHtml?.(card.mana_cost,{asCost:true}) || manaToHtmlLite(card.mana_cost || ''))}</span>
    </div>
    <div style="color:#9fb4d9; font-size:12px; margin-top:4px; white-space:pre-wrap;">${card.oracle_text || ''}</div>
  `;

  const right = document.createElement('div');
  right.style.cssText = `display:flex; align-items:center; gap:10px;`;

  const timer = document.createElement('div');
  timer.setAttribute('role','timer');
  timer.style.cssText = `
    width:42px; height:42px; border-radius:50%; border:2px solid #35527d;
    display:grid; place-items:center; font-weight:900; color:#e7f2ff;
  `;

  const btns = document.createElement('div');
  btns.style.cssText = `display:none; gap:8px;`;
  const mkBtn = (label, warn=false) => {
    const b = document.createElement('button');
    b.className = 'pill';
    b.textContent = label;
    b.style.cssText = `
      background:${warn ? '#2a1730':'#1a2a45'}; color:#cfe1ff; border:1px solid ${warn ? '#5e2a6a':'#2b3f63'};
      border-radius:10px; padding:6px 10px; font-weight:900;
    `;
    return b;
  };
  const btnCounter = mkBtn('Counter', true);
  const btnResolve = mkBtn('Resolve', false);
  btns.append(btnCounter, btnResolve);

  right.append(timer, btns);
  panel.append(img, text, right);
  host.innerHTML = ''; // one-at-a-time
  host.appendChild(panel);
  host.style.display = 'grid';

  // countdown logic
  let msLeft = Math.max(1000, timeoutMs|0);
  let paused = false;
  const updateFace = ()=> timer.textContent = Math.ceil(msLeft/1000);
  updateFace();

  const tick = () => {
    if (paused) return;
    msLeft -= 100;
    if (msLeft <= 0){
      cleanup();
      try{ onResolve?.(); }catch{}
      return;
    }
    updateFace();
  };
  const iv = setInterval(tick, 100);

  function pauseAndReveal(){
    if (paused) return;
    paused = true;
    btns.style.display = 'flex';
  }

  function cleanup(){
    try{ clearInterval(iv); }catch{}
    try{ host.style.display = 'none'; host.innerHTML=''; }catch{}
  }

  // interactions
  panel.addEventListener('click', (e)=>{
    // click anywhere on panel pauses and shows buttons
    pauseAndReveal();
  }, {passive:true});

  btnResolve.addEventListener('click', ()=>{ cleanup(); try{onResolve?.();}catch{} });
  btnCounter.addEventListener('click', ()=>{ cleanup(); try{onCounter?.();}catch{} });

  // expose disposer
  return cleanup;
},


  // ---------- Saves / Restore ----------
  // Save slots (3 fixed slots) – caller supplies current slot meta + callbacks
  // opts: { roomId, seat, slots:[{slot:1|2|3, label?, savedAt?}], onSave(slot), onDelete(slot) }
  openSaveSlots(opts = {}){
    const ui = this._panel({ title:`Save Slots — Room ${opts.roomId || ''} · P${opts.seat || ''}`, height:'auto' });
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { display:'grid', gap:'10px' });

    const slots = [1,2,3].map(n=>{
      const row = document.createElement('div');
      Object.assign(row.style, {
        display:'grid', gridTemplateColumns:'1fr auto auto', gap:'8px',
        alignItems:'center', borderTop:`1px solid ${THEME.border}`, padding:'8px 0'
      });
      const meta = (opts.slots||[]).find(s => Number(s.slot)===n) || {};
      const label = meta.label || `Slot ${n}`;
      const when  = meta.savedAt ? new Date(meta.savedAt) : null;

      const left = document.createElement('div');
      left.innerHTML = `<div style="font-weight:800">${label}</div>
        <div style="opacity:.85; font-size:12px">${when ? when.toLocaleString() : 'Empty'}</div>`;

      const saveBtn   = this._btn(when ? 'Overwrite' : 'Save', async ()=>{
        try { await Promise.resolve(opts.onSave?.(n)); this.notify('info', `Saved to Slot ${n}`); }
        catch(e){ this.notify('warn','Save failed'); }
      });
      const deleteBtn = this._btn('Delete', async ()=>{
        try { await Promise.resolve(opts.onDelete?.(n)); this.notify('info', `Deleted Slot ${n}`); }
        catch(e){ this.notify('warn','Delete failed'); }
      });

      row.appendChild(left);
      row.appendChild(saveBtn);
      row.appendChild(deleteBtn);
      return row;
    });

    slots.forEach(r => wrap.appendChild(r));
    ui.body.appendChild(wrap);
    this._push(ui.wrap);
  },

  // Restore picker – shows manual saves first, then autosaves with times
  // opts: { roomId, seat, manual:[{id, label, created_at}], autos:[{id, created_at}],
  //         onRestoreSave(id), onRestoreAuto(id) }
  openRestorePicker(opts = {}){
    const ui = this._panel({ title:`Restore — Room ${opts.roomId || ''} · P${opts.seat || ''}` });

    const mkSection = (title)=>{
      const box = document.createElement('div');
      const hdr = document.createElement('div');
      hdr.textContent = title;
      Object.assign(hdr.style, { fontWeight:900, padding:'8px 0' });
      const list = document.createElement('div');
      Object.assign(list.style, { display:'grid', gap:'8px' });
      box.appendChild(hdr); box.appendChild(list);
      return { box, list };
    };

    // Manual saves
    const man = mkSection('Manual Saves');
    const manual = Array.isArray(opts.manual) ? opts.manual : [];
    if (!manual.length){
      const d = document.createElement('div'); d.textContent = 'No manual saves.'; d.style.opacity='.8';
      man.list.appendChild(d);
    } else {
      manual.forEach(sv=>{
        const row = document.createElement('div');
        Object.assign(row.style, {
          display:'grid', gridTemplateColumns:'1fr auto', gap:'8px',
          border:`1px solid ${THEME.border}`, borderRadius:'10px', padding:'8px'
        });
        const left = document.createElement('div');
        const when = sv.created_at ? new Date(sv.created_at).toLocaleString() : '';
        left.innerHTML = `<div style="font-weight:800">${sv.label || 'Save'}</div>
                          <div style="opacity:.85; font-size:12px">${when}</div>`;
        const act = this._btn('Restore', async ()=>{
          try { await Promise.resolve(opts.onRestoreSave?.(sv.id)); this._pop(ui.wrap); }
          catch{ this.notify('warn','Restore failed'); }
        });
        row.appendChild(left); row.appendChild(act); man.list.appendChild(row);
      });
    }
    ui.body.appendChild(man.box);

    // Autosaves
    const aut = mkSection('Autosaves (last 3 minutes)');
    const autos = Array.isArray(opts.autos) ? opts.autos : [];
    if (!autos.length){
      const d = document.createElement('div'); d.textContent = 'No autosaves yet.'; d.style.opacity='.8';
      aut.list.appendChild(d);
    } else {
      autos.forEach(sv=>{
        const row = document.createElement('div');
        Object.assign(row.style, {
          display:'grid', gridTemplateColumns:'1fr auto', gap:'8px',
          border:`1px solid ${THEME.border}`, borderRadius:'10px', padding:'8px', background:'#0b1220'
        });
        const left = document.createElement('div');
        const when = sv.created_at ? new Date(sv.created_at).toLocaleTimeString() : '';
        left.innerHTML = `<div style="font-weight:800">Autosave</div>
                          <div style="opacity:.85; font-size:12px">${when}</div>`;
        const act = this._btn('Restore', async ()=>{
          try { await Promise.resolve(opts.onRestoreAuto?.(sv.id)); this._pop(ui.wrap); }
          catch{ this.notify('warn','Restore failed'); }
        });
        row.appendChild(left); row.appendChild(act); aut.list.appendChild(row);
      });
    }
    ui.body.appendChild(aut.box);

    this._push(ui.wrap);
  },



  // ---------- Combat scaffolds ----------
  openCombatAttackers(opts = {}){
    // If a legacy bridge exists, delegate
    if (typeof window.openAttackerOverlay === 'function'){
      window.openAttackerOverlay({ gameId: opts.gameId, mySeat: opts.mySeat });
      return;
    }
    const ui = this._panel({ title:'Declare Attackers' });
    ui.body.innerHTML = `<div style="opacity:.85">Combat UI not wired yet. This is a scaffold.</div>`;
    this._push(ui.wrap);
  },
  openCombatDefenders(opts = {}){
    if (typeof window.openDefenderOverlay === 'function'){
      window.openDefenderOverlay({ gameId: opts.gameId, mySeat: opts.mySeat });
      return;
    }
    const ui = this._panel({ title:'Assign Blockers' });
    ui.body.innerHTML = `<div style="opacity:.85">Combat UI not wired yet. This is a scaffold.</div>`;
    this._push(ui.wrap);
  },
  openCombatOutcome(opts = {}){
    if (typeof window.showOutcomeOverlay === 'function'){
      window.showOutcomeOverlay(opts);
      return;
    }
    const ui = this._panel({ title:'Recommended Outcome' });
    ui.body.innerHTML = `<div style="opacity:.85">Outcome scaffold — add multi-player confirm here.</div>`;
    this._push(ui.wrap);
  },

  // ---------- Activation scaffold ----------
  openActivation({ card, abilities = [], onPayCheck, onActivate }){
    const ui = this._panel({ title:`Activate — ${this._escape(card?.name || '')}` });
    if (!abilities.length){
      const d = document.createElement('div'); d.textContent = 'No abilities detected.'; d.style.opacity = '.8'; ui.body.appendChild(d);
    } else {
      abilities.forEach(ab=>{
        const row = document.createElement('div');
        Object.assign(row.style, {
          display:'grid', gridTemplateColumns:'1fr auto', gap:'8px',
          padding:'8px 0', borderTop:`1px solid ${THEME.border}`
        });
        const left = document.createElement('div');
        left.innerHTML = `
          <div style="font-weight:800">${this._escape(ab.title||'Ability')}</div>
          <div style="opacity:.9; font-size:12px">Cost: ${this._escape(ab.cost||'-')}</div>
          <div style="opacity:.9; font-size:12px">${this._escape(ab.text||'')}</div>`;
        const right = document.createElement('div');
        Object.assign(right.style, { display:'flex', gap:'6px' });
        const b = this._btn('Activate', async ()=>{
          const ok = await Promise.resolve(onPayCheck?.(ab));
          if (!ok) { Overlays.notify('warn','Cost not paid.'); return; }
          onActivate?.(ab);
          this._pop(ui.wrap);
        });
        right.appendChild(b);
        row.appendChild(left); row.appendChild(right);
        ui.body.appendChild(row);
      });
    }
    this._push(ui.wrap);
  },

  // ---------- Notifications ----------
  notify(type='info', msg='Notice', { timeoutMs = 2400 } = {}){
    try { if (window.Notifications?.emit) window.Notifications.emit('ui_notice', { type, msg }); } catch{}
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position:'fixed', left:'8px', right:'8px', bottom:'8px', zIndex: 11000,
      background: type==='warn' ? '#3a1e1e' : '#1b2435', color:THEME.text,
      border:`1px solid ${THEME.border}`, borderRadius:'12px', padding:'10px 12px',
      display:'flex', alignItems:'center', justifyContent:'space-between',
      boxShadow:'0 6px 22px rgba(0,0,0,.35)'
    });
    bar.textContent = msg;
    document.body.appendChild(bar);
    setTimeout(()=>{ try{ bar.remove(); }catch{} }, Math.max(1000, timeoutMs|0));
  }
};

export default Overlays;
export { Overlays };
