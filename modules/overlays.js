// ================================
// FILE: modules/overlays.js
// Unified overlay manager (mobile-first) + combat scaffolds + tiny prompts
// ================================
/*
Public API:
  Overlays.init();
  Overlays.notify(type, msg, { timeoutMs });

  // Zones
  Overlays.openZoneList({ title, seat, zoneName, cards, onMove });

  // Deck
  Overlays.openDeckSearch({ seat, deckCards, filterTypes, onMove, onCloseAskShuffle });
  Overlays.openDeckOptions({ seat, onDrawX, onMillX, onCascade, onShuffle });
  Overlays.openAddCard({ seat, onSpawnToTable });
  Overlays.openDeckInsertChoice({ onTop, onBottom, onShuffle, onCancel });

  // Combat scaffolds (V2-inspired)
  Overlays.openCombatAttackers(opts);
  Overlays.openCombatDefenders(opts);
  Overlays.openCombatOutcome(opts);

  // Activation scaffold
  Overlays.openActivation({ card, abilities, onPayCheck, onActivate });
*/
const THEME = {
  panelBg:   '#0b1220',
  panelHdr:  '#1a1f2b',
  text:      '#e7e9ee',
  border:    'rgba(255,255,255,0.08)',
};

const Overlays = {
  root: null,
  stack: [],

  init(){
    if (this.root) return;
    const root = document.createElement('div');
    root.id = 'overlayRoot';
    Object.assign(root.style, { position:'fixed', inset:0, pointerEvents:'none', zIndex: 10000 });
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
      display:'grid', placeItems:'center', pointerEvents:'auto', zIndex: 10001
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
openZoneList({ title, seat, zoneName, cards = [], onMove }){
  const border = (window.THEME?.border) || 'rgba(255,255,255,.08)';
  const ui = this._panel({ title: title || `${String(zoneName).toUpperCase()} — P${seat}` });

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display:'grid',
    gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))',
    gap:'10px'
  });
  ui.body.appendChild(grid);

  if (!Array.isArray(cards) || !cards.length){
    const empty = document.createElement('div');
    empty.textContent = 'No cards.'; empty.style.opacity = '.8';
    ui.body.appendChild(empty);
    this._push(ui.wrap);
    return;
  }

  const makeTile = (c) => {
    const tile = document.createElement('div');
    Object.assign(tile.style, {
      background:'#1a1f2a', border:`1px solid ${border}`, borderRadius:'10px',
      overflow:'hidden', display:'grid', gridTemplateRows:'auto auto', cursor:'pointer'
    });

    const artUrl =
      (c?.img && String(c.img)) ||
      (c?.id ? `https://api.scryfall.com/cards/${encodeURIComponent(String(c.id))}?format=image&version=normal` : '');

    const thumb = document.createElement('div');
    Object.assign(thumb.style, {
      width:'100%', paddingTop:'140%', background:'#111',
      backgroundSize:'cover', backgroundPosition:'center'
    });
    if (artUrl) thumb.style.backgroundImage = `url("${artUrl}")`;
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
      display:'none', gap:'6px', padding:'8px', borderTop:`1px solid ${border}`,
      background:'#0b1220'
    });

    const addBtn = (label, dest) => {
      const b = this._btn(label, (e)=>{ e.stopPropagation(); onMove?.(c, dest); });
      Object.assign(b.style, { padding:'6px 8px' });
      actions.appendChild(b);
    };
    addBtn('Table','table');
    addBtn('Hand','hand');
    addBtn('Deck','deck');
    const alt = zoneName === 'graveyard' ? 'exile' : 'graveyard';
    addBtn(alt[0].toUpperCase()+alt.slice(1), alt);
    tile.appendChild(actions);

    tile.addEventListener('click', ()=>{
      actions.style.display = actions.style.display === 'none' ? 'flex' : 'none';
    });

    return tile;
  };

  cards.forEach(c => grid.appendChild(makeTile(c)));
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
    const list = document.createElement('div'); ui.body.appendChild(list);

    const render = ()=>{
      list.innerHTML = '';
      const query = (q.value||'').toLowerCase();
      const ft = sel.value;
      const items = deckCards.filter(c=>{
        const n = (c?.name||'').toLowerCase();
        const t = (c?.type_line||'');
        const okN = !query || n.includes(query);
        const okT = ft === 'All' ? true : t.includes(ft);
        return okN && okT;
      });
      if (!items.length){ const d=document.createElement('div'); d.textContent='No matches.'; d.style.opacity='.8'; list.appendChild(d); return; }

      items.forEach(c=>{
        const row = document.createElement('div');
        Object.assign(row.style, {
          display:'grid', gridTemplateColumns:'1fr auto', gap:'8px',
          padding:'8px 0', borderTop:`1px solid ${THEME.border}`
        });
        const left = document.createElement('div');
        left.innerHTML = `
          <div style="font-weight:800">${this._escape(c?.name||'')}</div>
          <div style="opacity:.85; font-size:12px">${this._escape(c?.type_line||'')}</div>
          <div style="opacity:.85; font-size:12px">${this._escape(c?.mana_cost||'')}</div>`;
        const right = document.createElement('div');
        Object.assign(right.style, { display:'flex', gap:'6px', flexWrap:'wrap' });
        ['Hand','Table','Graveyard','Exile'].forEach(dest => {
          right.appendChild(this._btn(dest, ()=> onMove?.(c, dest.toLowerCase())));
        });
        row.appendChild(left); row.appendChild(right);
        list.appendChild(row);
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

    const drawN = this._input({ width:'90px' }); drawN.type='number'; drawN.min='1'; drawN.placeholder='X';
    const drawB = this._btn('Draw', ()=> onDrawX?.(Number(drawN.value||'0')|0));
    ui.body.appendChild(mkRow('Draw X cards', group(drawN, drawB)));

    const millN = this._input({ width:'90px' }); millN.type='number'; millN.min='1'; millN.placeholder='X';
    const millB = this._btn('Mill', ()=> onMillX?.(Number(millN.value||'0')|0));
    ui.body.appendChild(mkRow('Mill X cards', group(millN, millB)));

    ui.body.appendChild(mkRow('Cascade', this._btn('Set up…', ()=> onCascade?.())));
    ui.body.appendChild(mkRow('Shuffle deck', this._btn('Shuffle', ()=> onShuffle?.())));

    this._push(ui.wrap);

    function group(a,b){ const g=document.createElement('div'); Object.assign(g.style,{ display:'grid', gridTemplateColumns:'1fr auto', gap:'8px' }); g.appendChild(a); g.appendChild(b); return g; }
  },

  openAddCard({ seat, onSpawnToTable }){
    const ui = this._panel({ title:`Add Card / Token — P${seat}` });
    const q = this._input(); q.placeholder = 'Search (e.g. "zombie", "Sol Ring")';
    const sel = document.createElement('select');
    Object.assign(sel.style, { background:'#0a0f16', color:'#e7efff', border:`1px solid ${THEME.border}`, borderRadius:'10px', padding:'8px' });
    ['All','Creature','Token','Creature + Token'].forEach(t => {
      const o = document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o);
    });
    const go = this._btn('Search', doSearch);
    const top = document.createElement('div');
    Object.assign(top.style, { display:'grid', gridTemplateColumns:'1fr auto', gap:'8px', marginBottom:'8px' });
    const right = document.createElement('div');
    Object.assign(right.style, { display:'grid', gridTemplateColumns:'1fr auto', gap:'8px' });
    right.appendChild(sel); right.appendChild(go);
    top.appendChild(q); top.appendChild(right);
    ui.body.appendChild(top);

    const list = document.createElement('div'); ui.body.appendChild(list);

    async function doSearch(){
      const s = (q.value||'').trim(); if (!s){ q.focus(); return; }
      list.innerHTML = '<div style="opacity:.7">Searching…</div>';
      try{
        const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(s)}`);
        const j = await r.json();
        const cards = Array.isArray(j.data) ? j.data : [];
        render(cards);
      }catch{ list.innerHTML = '<div style="opacity:.8">Search failed.</div>'; }
    }
    function render(cards){
      list.innerHTML = '';
      cards.forEach(c=>{
        const row = document.createElement('div');
        Object.assign(row.style, {
          display:'grid', gridTemplateColumns:'1fr auto', gap:'8px',
          padding:'8px 0', borderTop:`1px solid ${THEME.border}`
        });
        const left = document.createElement('div');
        left.innerHTML = `
          <div style="font-weight:800">${escapeHtml(c?.name||'')}</div>
          <div style="opacity:.85; font-size:12px">${escapeHtml(c?.type_line||'')}</div>
          <div style="opacity:.85; font-size:12px">${escapeHtml(c?.mana_cost||'')}</div>`;
        const right = document.createElement('div');
        Object.assign(right.style, { display:'flex', gap:'6px', flexWrap:'wrap' });
        const add = document.createElement('button');
        add.textContent = 'To Table';
        Object.assign(add.style, { background:'#1a2a45', color:'#cfe1ff', border:'1px solid #2b3f63', borderRadius:'10px', padding:'6px 10px', fontWeight:900 });
        add.addEventListener('click', ()=> onSpawnToTable?.({ id:c.id, name:c.name, type_line:c.type_line, mana_cost:c.mana_cost, oracle_text:c.oracle_text, img: (c.image_uris?.normal || c.image_uris?.large || '') }));
        right.appendChild(add);
        row.appendChild(left); row.appendChild(right); list.appendChild(row);
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
