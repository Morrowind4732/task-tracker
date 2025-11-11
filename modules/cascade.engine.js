// /modules/cascade.engine.js
// Self-contained "reveal-until" engine (Cascade & Special filters).
// Public API:
//   Cascade.init({ combatAnchorSelector?, offsetX?, zBase? })
//   Cascade.openQuickPick()                 // 1..9 + X + Special
//   Cascade.runByMV(limit)                  // reveal until nonland with MV < limit
//   Cascade.runSpecial()                    // opens Special filter UI, then reveal
//
// Integration expectations (all optional but supported if present):
//   - DeckLoading.drawOne() -> { name, imageUrl } | null
//   - DeckLoading.returnToBottom?(cardsArrayInTopToBottomOrder)
//     (fallback: pushes back into DeckLoading.state.library if available)
//   - window.flyDrawToHand({name, imageUrl}, null)
//   - CardPlacement.spawnCardLocal({ name, img })
//   - Zones.moveCardToZone({name,img,typeLine?}, "graveyard"|"exile", ownerSeat)
//   - TurnUpkeep.recordDraw(seat, n) (only for *actual draws to hand*, not reveals)
//
// Notes:
//   * We fetch Scryfall metadata to get MV / type/legendary/land info.
//   * “Bottom of library” preserves the exact reveal order (first revealed ends up
//     above later ones on the bottom: i.e., we append in reverse).
//   * Lands are ignored for MV cascade, as per normal cascade behavior.

export const Cascade = (() => {
  const CFG = {
    combatAnchorSelector: '.mid-gap', // where to spawn reveals visually
    offsetX: -32,
    zBase: 50000
  };

  function seatNow(){
    try { return Number(window.mySeat?.() || 1); } catch { return 1; }
  }

  // ── RTC hook (injected by rtc.bus or anyone). Fallback to peer.send if present.
  let __sendCascadeRTC = (packet) => {
    try { window.peer?.send?.(packet); } catch {}
  };
  function setSendCascadeRTC(fn){
    if (typeof fn === 'function') __sendCascadeRTC = fn;
  }


  // ------- DOM helpers -------
  function qs(sel){ return document.querySelector(sel); }
  function el(t, a={}, h=''){ const e=document.createElement(t); Object.entries(a).forEach(([k,v])=>e.setAttribute(k,v)); if(h) e.innerHTML=h; return e; }

  function spawnRevealCard({ name, img }, index=0){
    const anchor = qs(CFG.combatAnchorSelector) || document.body;
    const node = el('img', { class:'cascade-reveal table-card', draggable:'false', alt:name, title:name });

// Size exactly like table cards:
node.style.height = 'var(--card-height-table)';
node.style.width  = 'calc(var(--card-height-table) * var(--card-aspect))';

// Position + visual treatment stays the same:
Object.assign(node.style, {
  position:'absolute',
  left:'50%',
  top:'50%',
  transform:`translate(-50%, -50%) translateX(${index * CFG.offsetX}px)`,
  borderRadius:'8px',
  border:'1px solid rgba(255,255,255,.35)',
  boxShadow:'0 20px 40px rgba(0,0,0,.8)',
  zIndex: String(CFG.zBase + index),
  pointerEvents:'none',
  userSelect:'none'
});

    node.src = img || '';
    // Make sure anchor can hold absolutely placed children
    const cs = getComputedStyle(anchor);
    if (cs.position === 'static') anchor.style.position = 'relative';
    anchor.appendChild(node);
    return node;
  }

  function removeNodes(nodes){
    for (const n of nodes) try { n.remove(); } catch {}
  }

  // ------- Scryfall helpers -------
  async function fetchCardMetaByName(name){
    // single fetch for MV / types / supertype / land logic
    const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`;
    const r = await fetch(url, { cache:'no-store' });
    if (!r.ok) throw new Error(`Scryfall ${r.status}`);
    const j = await r.json();
    const faces = Array.isArray(j.card_faces) ? j.card_faces : null;
    const mv = Number(j.cmc ?? 0);
    const typeLine = String(j.type_line || '');
    const isLand = /\bLand\b/i.test(typeLine);
    const isLegendary = /\bLegendary\b/i.test(typeLine);
    const primaryFace = faces ? faces[0] : j;
    return {
      name: j.name || '',
      mv,
      typeLine,
      isLand,
      isLegendary,
      // land subtypes (Plains/Island/Swamp/Mountain/Forest)
      landTypes: (typeLine.match(/\b(Plains|Island|Swamp|Mountain|Forest)\b/ig) || []).map(s => s.toLowerCase()),
      img: primaryFace?.image_uris?.normal || j.image_uris?.normal || ''
    };
  }

  // ------- Bottom/Grave/Exile placement -------
  function putRevealsSomewhere(revealed, destination){
    const list = revealed.map(r => ({ name: r.name, imageUrl: r.img }));
    if (destination === 'graveyard' || destination === 'exile'){
      const ownerSeat = seatNow();
      for (const c of list) {
        try { window.Zones?.moveCardToZone?.({ name:c.name, img:c.imageUrl }, destination, ownerSeat); } catch {}
      }
      return;
    }

    // bottom (default)
    // Try official helper if present:
    if (typeof DeckLoading?.returnToBottom === 'function'){
      // We want first revealed to be *above* the later cards at bottom ⇒ append in reverse
      DeckLoading.returnToBottom([...list].reverse());
      return;
    }
    // fallback: if DeckLoading.state.library exists, push into end
    try {
      const lib = DeckLoading?.state?.library;
      if (Array.isArray(lib)) {
        for (let i=list.length-1; i>=0; i--) {
          lib.push({ name:list[i].name, imageUrl:list[i].imageUrl });
        }
      }
    } catch {}
  }

  // ------- Confirm dialogs -------
  function confirmCastModal(hit){
    return new Promise(resolve => {
      const dim = el('div');
      Object.assign(dim.style, { position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'grid', placeItems:'center', zIndex:999999 });
      const panel = el('div');
      Object.assign(panel.style, {
        width:'min(520px, 92vw)', background:'#0c1a2b', border:'1px solid rgba(255,255,255,.2)',
        borderRadius:'12px', padding:'16px', display:'grid', gap:'12px', color:'#eaf2ff'
      });
      const img = el('img', { alt:hit.name });
      Object.assign(img.style, { width:'100%', height:'auto', borderRadius:'8px', border:'1px solid rgba(255,255,255,.25)' });
      img.src = hit.img || '';

      const row = el('div'); 
      Object.assign(row.style, { display:'grid', gridTemplateColumns:'1fr auto auto', gap:'8px', alignItems:'center' });

      const invalid = el('button'); invalid.textContent = 'Invalid'; Object.assign(invalid.style, btnS()); // left
      const no      = el('button'); no.textContent = 'No'; Object.assign(no.style, btnS());               // right mid
      const yes     = el('button'); yes.textContent = 'Cast (free)'; Object.assign(yes.style, btnS(true));// right

      row.append(invalid, no, yes);

      panel.append(el('div',{}, `<strong>Cast this for free?</strong><div style="opacity:.85">${hit.name}</div>`));
      panel.append(img, row);
      dim.append(panel);

      function close(v){ try{ dim.remove(); }catch{} resolve(v); }
      invalid.onclick = () => close('invalid');
      no.onclick      = () => close(false);
      yes.onclick     = () => close(true);
      dim.onclick     = (e)=>{ if (e.target===dim) close(false); };
      document.body.appendChild(dim);
    });
  }

  function btnS(primary=false){
    return {
      background: primary ? 'linear-gradient(180deg,#1e7a3b,#0e3d1c)' : 'linear-gradient(180deg,#1f2f44,#0c1320)',
      color:'#fff', border:'1px solid rgba(255,255,255,.28)', borderRadius:'8px',
      padding:'8px 12px', fontWeight:'800', cursor:'pointer'
    };
  }

  function chooseCleanupDestModal(){
    return new Promise(resolve => {
      const dim = el('div'); Object.assign(dim.style, { position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'grid', placeItems:'center', zIndex:999999 });
      const panel = el('div'); Object.assign(panel.style, { width:'min(420px,92vw)', background:'#0c1a2b', border:'1px solid rgba(255,255,255,.2)', borderRadius:'12px', padding:'16px', color:'#eaf2ff' });
      const row = el('div'); Object.assign(row.style, { display:'grid', gridTemplateColumns:'1fr', gap:'8px' });
      const opts = [
        ['bottom','Send all revealed to BOTTOM of library (default)'],
        ['graveyard','Send all revealed to GRAVEYARD'],
        ['exile','EXILE all revealed']
      ];
      opts.forEach(([v,l])=>{
        const b = el('button'); b.textContent = l; Object.assign(b.style, btnS(v==='bottom'));
        b.onclick = ()=>{ try{ dim.remove(); }catch{} resolve(v); };
        row.append(b);
      });
      panel.append(el('div',{},'<strong>Where should the other revealed cards go?</strong>'));
      panel.append(row);
      dim.append(panel); document.body.appendChild(dim);
    });
  }

  // ------- Reveal loops -------
  async function revealLoopWithPredicate(predicate){
    const revealed = [];
    const nodes = [];

    while (true){
      const next = DeckLoading?.drawOne?.();
      if (!next) break; // deck empty
      const { name, imageUrl } = next;

      // Tell opponent we revealed a card (for their passive mirror)
      // (single send path via injected RTC hook)
      const node = spawnRevealCard({ name, img:imageUrl }, revealed.length);

      nodes.push(node);

      // RTC: tell opponent we revealed this card at index
      try {
        __sendCascadeRTC({
          type: 'cascade:reveal',
          seat: seatNow(),
          idx : revealed.length,
          name,
          img : imageUrl
        });
      } catch {}


      const meta = await fetchCardMetaByName(name);


      revealed.push({ name, img:imageUrl, meta });

            if (await predicate(meta)){

        // Notify opponent a "hit" occurred (they get passive popup)
        try {
          __sendCascadeRTC({
            type: 'cascade:prompt',
            seat: seatNow(),
            name,
            img: imageUrl
          });
        } catch {}

        // prompt cast (can be true, false, or 'invalid')
        const decision = await confirmCastModal({ name, img:imageUrl });

        // >>> NEW: if invalid, just keep revealing <<<
        if (decision === 'invalid') {
          // do NOT clean up, do NOT return, just continue cascade
          continue;
        }

        // cleanup destination for the *other* cards
        const others = revealed.slice(0, -1); // all except last
        removeNodes(nodes);

        if (others.length){
          const dest = await chooseCleanupDestModal();
          putRevealsSomewhere(others.map(o => ({ name:o.name, img:o.img })), dest || 'bottom');

          try {
            __sendCascadeRTC({
              type: 'cascade:result',
              seat: seatNow(),
              cast: (decision === true),
              chosen: { name, img:imageUrl },
              others: others.map(o => ({ name:o.name, img:o.img })),
              dest: dest || 'bottom'
            });
          } catch {}
        }

        if (decision === true){
          try { window.flyDrawToHand?.({ name, imageUrl }, null); } catch {}
        } else {
          const dest = await chooseCleanupDestModal();
          putRevealsSomewhere([{ name, img:imageUrl }], dest || 'bottom');

          try {
            __sendCascadeRTC({
              type: 'cascade:result',
              seat: seatNow(),
              cast: false,
              chosen: { name, img:imageUrl },
              others: [{ name, img:imageUrl }],
              dest: dest || 'bottom'
            });
          } catch {}
        }

        return; // done
      }

      // otherwise keep looping
    }

    // If we exit without a hit, clean up the visuals & put all revealed to bottom
    if (nodes.length) removeNodes(nodes);
    if (revealed.length) {
      const list = revealed.map(o=>({name:o.name,img:o.img}));
      putRevealsSomewhere(list, 'bottom');
      try {
        __sendCascadeRTC({
          type: 'cascade:result',
          seat: seatNow(),
          cast: false,
          chosen: null,
          others: list,
          dest: 'bottom'
        });
      } catch {}
    }

  }

  // ------- Predicates -------
  function isNonLandWithMVAtMost(limit){
  return async (meta) => (!meta.isLand && Number(meta.mv) < Number(limit));
}


  function buildSpecialPredicate(spec){
    // spec = { mode:'creatureType'|'cardType'|'land'|'legendary', value? , landKind? }
    return async (meta) => {
      if (spec.mode === 'legendary') return !!meta.isLegendary;

      if (spec.mode === 'creatureType'){
        const want = String(spec.value||'').toLowerCase();
        return want && meta.typeLine.toLowerCase().includes(want);
      }

      if (spec.mode === 'cardType'){
        const want = String(spec.value||'').toLowerCase(); // 'creature','artifact','instant',...
        return want && meta.typeLine.toLowerCase().includes(want);
      }

      if (spec.mode === 'land'){
        if (!meta.isLand) return false;
        const kind = spec.landKind || 'any'; // 'any' | 'basic' | 'plains'|'island'|'swamp'|'mountain'|'forest'
        if (kind === 'any') return true;
        if (kind === 'basic') return /\bBasic\b/i.test(meta.typeLine);
        const l = kind.toLowerCase();
        return meta.landTypes.includes(l);
      }

      return false;
    };
  }

  // ------- UIs -------
  function quickPick(){
    return new Promise(resolve=>{
      const dim = el('div'); Object.assign(dim.style, { position:'fixed', inset:0, display:'grid', placeItems:'center', background:'rgba(0,0,0,.65)', zIndex:999999 });
      const panel = el('div'); Object.assign(panel.style, { background:'#0c1a2b', border:'1px solid rgba(255,255,255,.2)', borderRadius:'12px', padding:'16px', color:'#eaf2ff' });
      const grid = el('div'); Object.assign(grid.style, { display:'grid', gridTemplateColumns:'repeat(5,60px)', gap:'8px' });
      const mk = (t)=>{ const b=el('button'); b.textContent=t; Object.assign(b.style, btnS()); b.onclick=()=>{ try{dim.remove();}catch{} resolve(t); }; return b; };
      ['1','2','3','4','5','6','7','8','9','X','Special'].forEach(v => grid.append(mk(v)));
      panel.append(el('div',{},'<strong>Cascade: choose value</strong>'), grid); dim.append(panel); document.body.appendChild(dim);
    });
  }

  function specialPicker(){
    return new Promise(resolve=>{
      const dim = el('div'); Object.assign(dim.style, { position:'fixed', inset:0, display:'grid', placeItems:'center', background:'rgba(0,0,0,.65)', zIndex:999999 });
      const panel = el('div'); Object.assign(panel.style, { background:'#0c1a2b', border:'1px solid rgba(255,255,255,.2)', borderRadius:'12px', padding:'16px', color:'#eaf2ff', width:'min(560px,95vw)', display:'grid', gap:'12px' });
      const modes = [
        ['legendary','Legendary'],
        ['creatureType','By Creature Type'],
        ['cardType','By Card Type'],
        ['land','By Land']
      ];
      const sel = el('select'); Object.assign(sel.style, { padding:'6px', borderRadius:'8px' });
      modes.forEach(([v,l])=>{ const o=el('option'); o.value=v; o.textContent=l; sel.append(o); });

      const valInput = el('input', { placeholder:'e.g., Zombie / Instant' });
      Object.assign(valInput.style, { padding:'8px', borderRadius:'8px', border:'1px solid rgba(255,255,255,.2)', display:'none' });

      const landSel = el('select'); Object.assign(landSel.style, { padding:'6px', borderRadius:'8px', display:'none' });
      ['any','basic','plains','island','swamp','mountain','forest'].forEach(v=>{ const o=el('option'); o.value=v; o.textContent=v; landSel.append(o); });

      function sync(){
        const m = sel.value;
        valInput.style.display = (m==='creatureType'||m==='cardType') ? '' : 'none';
        landSel.style.display = (m==='land') ? '' : 'none';
      }
      sel.onchange = sync; sync();

      const go = el('button'); go.textContent='Apply'; Object.assign(go.style, btnS(true));
      go.onclick = ()=>{
        const m = sel.value;
        const spec = { mode:m, value: valInput.value.trim(), landKind: landSel.value };
        try{ dim.remove(); }catch{} resolve(spec);
      };

      panel.append(el('div',{},'<strong>Special Reveal</strong>'), sel, valInput, landSel, go);
      dim.append(panel); document.body.appendChild(dim);
    });
  }

  // ------- Public ops -------
  async function runByMV(limit){
    if (!limit || Number.isNaN(Number(limit))) return;
    await revealLoopWithPredicate(isNonLandWithMVAtMost(Number(limit)));
  }

  async function runSpecial(){
    const spec = await specialPicker();
    if (!spec) return;
    const pred = buildSpecialPredicate(spec);
    await revealLoopWithPredicate(pred);
  }

  async function openQuickPick(){
    const pick = await quickPick();
    if (pick === 'Special') return runSpecial();
    if (pick === 'X'){
      const v = window.prompt('Cascade: enter value', '3');
      const n = Math.max(0, Math.floor(Number(v)||0));
      return runByMV(n);
    }
    return runByMV(Number(pick));
  }

  function init(opts={}){
    Object.assign(CFG, opts||{});
    // no-op otherwise
  }

  return { init, openQuickPick, runByMV, runSpecial, setSendCascadeRTC };
})();
