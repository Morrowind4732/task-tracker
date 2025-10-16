// modules/activated.abilities.js
// v1 — Generic activation overlay (targets, effect builder, durations)
// Writes to your `card_attributes` table shape: { room_id, cid, owner_seat, json, updated_by_seat }
// No reliance on an `id` column or upsert onConflict; includes EOT / LINKED cleanup helpers.

import { supaReady } from './env.supabase.js';
let supabase = null; supaReady.then(c => supabase = c);

// -------------------------------
// Small DOM helpers
// -------------------------------
const $$  = (s,r=document)=>Array.from(r.querySelectorAll(s));
const bySel = (s,r=document)=>r.querySelector(s);
const esc = (v)=>CSS.escape(String(v));
const findCardEl = (cid)=>document.querySelector(`.card[data-cid="${esc(cid)}"]`);
const mySeat = ()=> Number(document.getElementById('mySeat')?.value || window.AppState?.mySeat || '1');
const currentRoom = ()=> window.currentRoomId || document.getElementById('roomId')?.value || window.AppState?.room_id || 'room1';
const activeSeats = ()=>{
  const sel = document.getElementById('playerCount');
  const raw = sel?.value ?? sel?.dataset?.value ?? sel?.selectedOptions?.[0]?.textContent;
  const n = Number(raw);
  return Array.from({length: (Number.isFinite(n)&&n>=1)?n:2}, (_,i)=>i+1);
};

// -------------------------------
// Supabase row helpers
// -------------------------------
// NOTE: your table does NOT have `id`, and requires owner_seat NOT NULL.
// We mirror CardAttributes.set behavior: select/write { room_id, cid, json, owner_seat, updated_by_seat }.
async function ensureSupabase(){
  if (!supabase) supabase = await supaReady;
  return supabase;
}

async function fetchRow(room_id, cid){
  await ensureSupabase();
  const { data, error } = await supabase
    .from('card_attributes')
    .select('room_id, cid, json, owner_seat, updated_by_seat')
    .eq('room_id', room_id)
    .eq('cid', cid)
    .maybeSingle();
  if (error) {
    console.warn('[Activated] fetchRow error', error);
    return null;
  }
  return data || null;
}

// Update or Insert, always including owner_seat & updated_by_seat
async function upsertRow(room_id, cid, ownerSeat, updater){
  await ensureSupabase();
  const existing = await fetchRow(room_id, cid);
  const base = existing?.json || {};
  const next = updater(base) || base;

  // prefer existing owner if present, else provided ownerSeat, else 1
  const owner_seat = Number(existing?.owner_seat ?? ownerSeat ?? 1);

  const payload = {
    room_id,
    cid,
    owner_seat,
    json: next,
    updated_by_seat: owner_seat
  };

  // Supabase upsert without explicit onConflict relies on PK/unique in your schema.
  const { error } = await supabase.from('card_attributes').upsert(payload);
  if (error) console.error('[Activated] upsert error', error);
  return next;
}

// -------------------------------
/* JSON shape helpers (we keep it simple + reversible for temp) */
// -------------------------------
const ensure = (obj, key, init)=> (obj[key] ??= (typeof init === 'function' ? init() : init));

function appendTempPT(json, { pow=0, tgh=0, sourceCid, mode }){
  const tp = ensure(json, 'tempPT', ()=>[]);
  const id = 'tpt_'+Math.random().toString(36).slice(2);
  tp.push({ id, pow:Number(pow)||0, tgh:Number(tgh)||0, sourceCid: sourceCid||null, mode }); // mode: 'EOT'|'LINKED'
  // also apply to ptMod so existing PT() sees it immediately
  const pm = ensure(json, 'ptMod', ()=>({ pow:0, tgh:0 }));
  pm.pow = (Number(pm.pow)||0) + (Number(pow)||0);
  pm.tgh = (Number(pm.tgh)||0) + (Number(tgh)||0);
  return id;
}

function appendTempAbility(json, { ability, sourceCid, mode }){
  const te = ensure(json, 'tempEffects', ()=>[]);
  const id = 'tef_'+Math.random().toString(36).slice(2);
  te.push({ id, ability: String(ability||'').toLowerCase(), sourceCid: sourceCid||null, mode }); // 'EOT'|'LINKED'
  return id;
}

function addPermanentCounter(json, kind, n){
  const c = ensure(json, 'counters', ()=>({}));
  c[String(kind||'+1/+1').toLowerCase()] = Math.max(0, Number(c[String(kind||'+1/+1').toLowerCase()]||0) + Number(n||0));
}

function addPermanentAbility(json, ability){
  const a = ensure(json, 'effects', ()=>[]);
  const norm = String(ability||'').toLowerCase();
  if (norm && !a.includes(norm)) a.push(norm);
}

function removePermanentAbility(json, ability){
  const a = ensure(json, 'effects', ()=>[]);
  const norm = String(ability||'').toLowerCase();
  const i = a.indexOf(norm);
  if (i>=0) a.splice(i,1);
}

// -------------------------------
// Overlay UI
// -------------------------------
function openPanel({ title, html, onAttach, footer }){
  const scrim = document.createElement('div'); scrim.className='scrim';
  const panel = document.createElement('div'); panel.className='panel';
  Object.assign(scrim.style, { position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:9999, display:'grid', placeItems:'center' });
  Object.assign(panel.style, { width:'min(740px, 92vw)', maxHeight:'82vh', overflow:'auto',
    background:'#151a2b', color:'#e7f0ff', border:'1px solid #2b3f63', borderRadius:'14px', padding:'12px', boxShadow:'0 12px 40px rgba(0,0,0,.4)' });

  panel.innerHTML = `
    <div class="row" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <strong style="font-weight:900">${title||'Activate Ability'}</strong>
      <button class="pill js-close" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">Close</button>
    </div>
    <div class="panel-body" style="margin-top:10px;display:grid;gap:12px">${html||''}</div>
    ${footer?`<div class="row" style="margin-top:10px;display:flex;justify-content:flex-end;gap:8px">${footer}</div>`:''}
  `;
  document.body.appendChild(scrim); scrim.appendChild(panel);
  const close = ()=>{ try{scrim.remove();}catch{} };
  panel.querySelector('.js-close').onclick = close;
  scrim.addEventListener('click', e=>{ if(e.target===scrim) close(); });
  panel._close = close;
  onAttach?.(panel);
  return panel;
}

function cardChipHtml(el){
  const cid = el.dataset.cid, name = el.dataset.name || cid;
  const img = el.querySelector('.face.front img')?.src || '';
  return `
    <label class="tgt" data-cid="${cid}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #2b3f63;border-radius:10px;cursor:pointer">
      <input type="checkbox" style="transform:scale(1.15)"/>
      <span style="width:28px;height:40px;background:${img?`url('${img}') center/cover`: '#222'};border-radius:4px;flex:0 0 auto"></span>
      <span style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px">${name}</span>
    </label>
  `;
}

function listCardsForSeat(seat){
  return $$(`.card[data-cid]`).filter(el => {
    const host = el.closest('[data-seat],[data-owner],[data-owner-seat]');
    const s = Number(host?.dataset?.seat ?? host?.dataset?.owner ?? host?.dataset?.ownerSeat);
    return s === Number(seat);
  });
}

// -------------------------------
// Public API
// -------------------------------
const ActivatedAbilities = {
  open({ cid, seat, anchorEl }){
    const me = Number(seat)||mySeat();
    const seats = activeSeats();
    const opp = seats.find(s => s!==me) || (me===1?2:1);

    const html = `
      <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <!-- Targets -->
        <div class="box" style="border:1px solid #2b3f63;border-radius:10px;padding:10px">
          <div style="font-weight:900;margin-bottom:6px">Targets</div>
          <div class="row" style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
            <button class="pill js-scope" data-scope="mine" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 10px">My Cards</button>
            <button class="pill js-scope" data-scope="opponent" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 10px">Opponent</button>
            <button class="pill js-scope" data-scope="both" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:4px 10px">Both</button>
          </div>
          <div class="tgtWrap" style="display:grid;gap:6px"></div>
        </div>

        <!-- Effect -->
        <div class="box" style="border:1px solid #2b3f63;border-radius:10px;padding:10px">
          <div style="font-weight:900;margin-bottom:6px">Effect</div>

          <label style="display:block;margin-bottom:6px">
            <span style="opacity:.9">Chosen Type (optional):</span>
            <input class="js-type" type="text" placeholder="Zombie, Wizard, …" style="width:100%;padding:6px;border-radius:8px;border:1px solid #2b3f63;background:#0f1829;color:#cfe1ff"/>
          </label>

          <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">
            <label class="pill" style="display:flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
              <input type="radio" name="mode" value="pt" checked/> +P/T
            </label>
            <label class="pill" style="display:flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
              <input type="radio" name="mode" value="ability"/> Grant Ability
            </label>
            <label class="pill" style="display:flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
              <input type="radio" name="mode" value="counter"/> Add Counter
            </label>
          </div>

          <div class="js-pt" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <label><span>+Power</span><input class="js-dp" type="number" value="1" style="width:100%;padding:6px;border-radius:8px;border:1px solid #2b3f63;background:#0f1829;color:#cfe1ff"/></label>
            <label><span>+Toughness</span><input class="js-dt" type="number" value="1" style="width:100%;padding:6px;border-radius:8px;border:1px solid #2b3f63;background:#0f1829;color:#cfe1ff"/></label>
          </div>

          <div class="js-ability" style="display:none">
            <label><span>Ability</span>
              <input class="js-abil" type="text" placeholder="flying, trample, vigilance…" style="width:100%;padding:6px;border-radius:8px;border:1px solid #2b3f63;background:#0f1829;color:#cfe1ff"/>
            </label>
          </div>

          <div class="js-counter" style="display:none">
            <label><span>Counter Kind</span>
              <input class="js-ckind" type="text" placeholder="+1/+1, -1/-1, charge…" style="width:100%;padding:6px;border-radius:8px;border:1px solid #2b3f63;background:#0f1829;color:#cfe1ff"/>
            </label>
            <label><span>Amount</span>
              <input class="js-camt" type="number" value="1" style="width:100%;padding:6px;border-radius:8px;border:1px solid #2b3f63;background:#0f1829;color:#cfe1ff"/>
            </label>
          </div>

          <div style="margin-top:8px">
            <div style="font-weight:900;margin-bottom:6px">Duration</div>
            <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px;margin-right:6px">
              <input type="radio" name="dur" value="EOT" checked/> Until end of turn
            </label>
            <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px;margin-right:6px">
              <input type="radio" name="dur" value="LINKED"/> While source remains on battlefield
            </label>
            <label class="pill" style="display:inline-flex;align-items:center;gap:6px;border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:6px 10px">
              <input type="radio" name="dur" value="PERM"/> Persistent (manual remove)
            </label>
          </div>
        </div>
      </div>
    `;

    const panel = openPanel({
      title: 'Activate Ability',
      html,
      footer: `<button class="pill js-apply" style="border:1px solid #2b3f63;border-radius:999px;background:#0f1829;color:#cfe1ff;padding:8px 14px">Apply</button>`,
      onAttach: (p)=>{
        const tgtWrap = bySel('.tgtWrap', p);
        const scopeBtns = $$('.js-scope', p);
        const modeRadios = $$('input[name="mode"]', p);
        const ptRow = bySel('.js-pt', p);
        const abRow = bySel('.js-ability', p);
        const ctRow = bySel('.js-counter', p);

        function refreshTargets(scope){
          const meCards = listCardsForSeat(me);
          const opCards = listCardsForSeat(opp);
          let list = [];
          if (scope==='mine') list = meCards;
          else if (scope==='opponent') list = opCards;
          else list = meCards.concat(opCards);
          tgtWrap.innerHTML = list.map(cardChipHtml).join('');
        }
        scopeBtns.forEach(b => b.onclick = ()=> refreshTargets(b.dataset.scope));
        refreshTargets('mine');

        function setMode(m){
          ptRow.style.display = (m==='pt') ? 'grid' : 'none';
          abRow.style.display = (m==='ability') ? 'block' : 'none';
          ctRow.style.display = (m==='counter') ? 'grid' : 'none';
        }
        modeRadios.forEach(r => r.onchange = ()=> setMode(r.value));
        setMode('pt');

        p.querySelector('.js-apply').onclick = async ()=>{
          const typeTxt = bySel('.js-type', p)?.value?.trim();
          const mode = p.querySelector('input[name="mode"]:checked')?.value || 'pt';
          const dur  = p.querySelector('input[name="dur"]:checked')?.value || 'EOT';
          const chosen = $$(`.tgtWrap .tgt input[type="checkbox"]`, p).map((c)=>{
            if (!c.checked) return null;
            const host = c.closest('.tgt'); return host?.dataset?.cid || null;
          }).filter(Boolean);

          if (!chosen.length){
            console.warn('[Activate] No targets selected.');
            try { window.Overlays?.notify?.('warn','No targets selected.'); } catch {}
            return;
          }

          // Optional type filter (matches current DOM types + card data if available)
          const typeNorm = typeTxt ? String(typeTxt).toLowerCase().trim() : '';
          const chosenFiltered = chosen.filter(cid=>{
            if (!typeNorm) return true;
            const el = findCardEl(cid);
            const types = (el?.dataset?.types || el?.getAttribute('data-types') || '')
                          .toLowerCase().split(/[ ,/]+/).filter(Boolean);
            try {
              const meta = window.getCardDataById?.(cid);
              if (Array.isArray(meta?.types) && meta.types.map(s=>s.toLowerCase()).includes(typeNorm)) return true;
            } catch {}
            return types.includes(typeNorm);
          });

          if (!chosenFiltered.length){
            console.warn('[Activate] No targets matched the chosen type.');
            try { window.Overlays?.notify?.('warn','No targets matched chosen type.'); } catch {}
            return;
          }

          const room_id = currentRoom();
          await ensureSupabase();

          for (const tcid of chosenFiltered){
            await upsertRow(room_id, tcid, me, (json)=>{
              if (mode === 'pt'){
                const dp = Number(bySel('.js-dp', p)?.value || 0);
                const dt = Number(bySel('.js-dt', p)?.value || 0);
                if (dur === 'PERM'){
                  const pm = ensure(json, 'ptMod', ()=>({ pow:0, tgh:0 }));
                  pm.pow = (Number(pm.pow)||0) + dp;
                  pm.tgh = (Number(pm.tgh)||0) + dt;
                } else {
                  appendTempPT(json, { pow:dp, tgh:dt, sourceCid: cid, mode: dur });
                }
              } else if (mode === 'ability'){
                const abil = bySel('.js-abil', p)?.value?.trim();
                if (!abil) return json;
                if (dur === 'PERM') addPermanentAbility(json, abil);
                else appendTempAbility(json, { ability: abil, sourceCid: cid, mode: dur });
              } else if (mode === 'counter'){
                const kind = bySel('.js-ckind', p)?.value?.trim() || '+1/+1';
                const amt  = Number(bySel('.js-camt', p)?.value || 1);
                addPermanentCounter(json, kind, amt);
              }
              return json;
            });
          }

          // Track LINKED + EOT tickets in-memory for faster cleanup
          if (dur === 'LINKED'){
            window.__linkedEffectTickets ||= [];
            window.__linkedEffectTickets.push({ sourceCid: cid, applyTo: chosenFiltered.slice(), room_id: currentRoom() });
          }
          if (dur === 'EOT'){
            window.__eotEffectTouched ||= new Set();
            chosenFiltered.forEach(x => window.__eotEffectTouched.add(`${currentRoom()}:${x}`));
          }

          try { window.Overlays?.notify?.('ok', 'Effect applied.'); } catch {}
          panel._close?.();
        };
      }
    });
    return panel;
  },

  // -------------------------------
  // Cleanup helpers (call from end-turn & when source leaves battlefield)
  // -------------------------------
  async clearEOT(room_id){
    await ensureSupabase();
    const touched = Array.from(window.__eotEffectTouched || []);
    window.__eotEffectTouched = new Set();

    for (const key of touched){
      const [rid, cid] = key.split(':');
      if (rid !== room_id) continue;

      await upsertRow(room_id, cid, /*ownerSeat*/ undefined, (json)=>{
        // revert tempPT EOT deltas and drop them
        if (Array.isArray(json.tempPT)){
          for (const eff of json.tempPT){
            if (eff?.mode === 'EOT'){
              const pm = ensure(json, 'ptMod', ()=>({ pow:0, tgh:0 }));
              pm.pow = (Number(pm.pow)||0) - (Number(eff.pow)||0);
              pm.tgh = (Number(pm.tgh)||0) - (Number(eff.tgh)||0);
            }
          }
          json.tempPT = json.tempPT.filter(e => e?.mode !== 'EOT');
        }
        // drop tempEffects with EOT
        if (Array.isArray(json.tempEffects)){
          json.tempEffects = json.tempEffects.filter(e => e?.mode !== 'EOT');
        }
        return json;
      });
    }
  },

  async clearLinkedBySource(room_id, sourceCid){
    await ensureSupabase();
    const tickets = (window.__linkedEffectTickets||[]).filter(t => t.room_id===room_id && String(t.sourceCid)===String(sourceCid));
    const applyTo = new Set(tickets.flatMap(t => t.applyTo));

    for (const tcid of applyTo){
      await upsertRow(room_id, tcid, /*ownerSeat*/ undefined, (json)=>{
        if (Array.isArray(json.tempPT)){
          for (const eff of json.tempPT){
            if (eff?.mode==='LINKED' && String(eff.sourceCid)===String(sourceCid)){
              const pm = ensure(json, 'ptMod', ()=>({ pow:0, tgh:0 }));
              pm.pow = (Number(pm.pow)||0) - (Number(eff.pow)||0);
              pm.tgh = (Number(pm.tgh)||0) - (Number(eff.tgh)||0);
            }
          }
          json.tempPT = json.tempPT.filter(e => !(e?.mode==='LINKED' && String(e.sourceCid)===String(sourceCid)));
        }
        if (Array.isArray(json.tempEffects)){
          json.tempEffects = json.tempEffects.filter(e => !(e?.mode==='LINKED' && String(e.sourceCid)===String(sourceCid)));
        }
        return json;
      });
    }

    // prune memory tickets
    window.__linkedEffectTickets = (window.__linkedEffectTickets||[]).filter(t => !(t.room_id===room_id && String(t.sourceCid)===String(sourceCid)));
  }
};

export default ActivatedAbilities;
