// modules/deck.loading.js
// Deck loader UI + parsing + Scryfall bulk art fetch + drawable library.
// Public API:
//   DeckLoading.init({ onLoaded(deck, commander, commanderImageUrl) })
//   DeckLoading.open()
//   DeckLoading.drawOne() -> {name, imageUrl} | null
//   DeckLoading.drawOneToHand(deckEl?) -> boolean


import * as PortraitOverlayMod from './portrait.dice.overlay.js';
const PortraitOverlay = PortraitOverlayMod.PortraitOverlay || PortraitOverlayMod.default;



export const DeckLoading = (() => {
	  // --- Name normalizer (handles face names, punctuation, accents, spacing) ---
  const normName = (s) => String(s||'')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[’'`]/g, "'")           // unify quotes
    .replace(/\s+/g, ' ')             // collapse ws
    .trim();

  // ---------- UI ----------
  let overlay = null;
  const el = (t,a={},h='') => { const e=document.createElement(t); for(const k in a){k==='class'?e.className=a[k]:e.setAttribute(k,a[k]);} if(h)e.innerHTML=h; return e; };
  function ensureOverlay(){
    if (overlay) return overlay;
    overlay = el('div',{id:'deckOverlay'});
    overlay.innerHTML = `
      <style>
        #deckOverlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);z-index:99999}
        #deckOverlay .panel{width:min(800px,92vw);background:#1b1b1b;color:#fff;border:2px solid #3a3a3a;border-radius:12px;box-shadow:0 20px 70px rgba(0,0,0,.6);padding:16px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
        #deckOverlay h3{margin:0 0 10px;font-size:18px;letter-spacing:.02em}
        #deckText{width:100%;min-height:360px;resize:vertical;background:#0f0f0f;color:#eee;border:1px solid #333;border-radius:8px;padding:10px;font-size:14px;line-height:1.3;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
        #deckOverlay .row{display:flex;gap:8px;margin-top:12px}
        #deckOverlay button{padding:10px 14px;border:0;border-radius:8px;background:#2e7dd6;color:#fff;font-weight:700;cursor:pointer}
        #deckOverlay .ghost{background:transparent;border:1px solid #555;color:#ddd}
      </style>
      <div class="panel">
        <h3>Load Deck List</h3>
        <textarea id="deckText" spellcheck="false" placeholder="Paste your deck list here..."></textarea>
        <div class="row">
          <button id="btnLoadDeck">Load Deck</button>
          <button id="btnCancel" class="ghost">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) hide(); });
    overlay.querySelector('#btnCancel').onclick = hide;
    return overlay;
  }
function open(prefill=''){ const o=ensureOverlay(), ta=o.querySelector('#deckText'); ta.value=prefill||ta.value||''; o.style.display='flex'; setTimeout(()=>ta.focus(),0); }
function hide(){ if(overlay) overlay.style.display='none'; }

// Helper: grab the textarea contents and return the last non-empty/non-"Sideboard" line.
// Useful if you want to pre-warm another overlay with the likely commander/name.
function peekLastEntryFromTextarea(){
  try{
    const ta = overlay?.querySelector?.('#deckText');
    if (!ta) return '';
    const lines = String(ta.value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    for (let i = lines.length-1; i >= 0; i--){
      const L = lines[i];
      if (/^sideboard$/i.test(L)) continue;
      // strip leading counts like "1 " / "2x "
      return L.replace(/^\s*(\d+|(\d+)?x)\s+/i,'').trim();
    }
    return '';
  }catch{ return ''; }
}


  // ---------- Defaults ----------
  const DEFAULT_LIST = `1 Accursed Witch
1 Aether Tradewinds
1 Afflicted Deserter
1 Agadeem's Awakening
1 Akoum Warrior
1 Arguel's Blood Fast
1 Azor's Gateway
1 Barrin, Tolarian Archmage
1 Beyeen Veil
1 Blackbloom Rogue
1 Bloodline Keeper
1 Bojuka Bog
1 Cache Raiders
1 Chandra, Fire of Kaladesh
1 Clearwater Pathway
1 Command Beacon
1 Command Tower
1 Conduit of Storms
1 Conqueror's Galleon
1 Crosis's Catacombs
1 Crumbling Necropolis
1 Curator's Ward
1 Curious Homunculus
1 Delver of Secrets
1 Deprive
1 Dimir Signet
1 Disappearing Act
1 Docent of Perfection
1 Dowsing Dagger
1 Dream Stalker
1 Epic Experiment
1 Familiar's Ruse
1 Feed the Swarm
1 Field of Ruin
1 Flood of Tears
1 Glasspool Mimic
1 Golden Guardian
1 Graf Rats
1 Hagra Mauling
1 Harvest Hand
4 Island
1 Izzet Signet
1 Jace, Vryn's Prodigy
1 Jwari Disruption
1 Kaya's Ghostform
1 Kazuul's Fury
1 Kindly Stranger
1 Liliana, Heretical Healer
1 Ludevic's Test Subject
1 Malakir Rebirth
1 Midnight Scavengers
4 Mountain
1 Neglected Heirloom
1 Netherborn Altar
1 Paradoxical Outcome
1 Pelakka Predation
1 Pongify
1 Primal Amulet
1 Rakdos Signet
1 Rapid Hybridization
1 Riverglide Pathway
1 Sanctum of Eternity
1 Screeching Bat
1 Sea Gate Restoration
1 Search for Azcanta
1 Shatterskull Smashing
1 Silundi Vision
1 Skin Invasion
1 Sol Ring
1 Song-Mad Treachery
1 Soul Seizer
1 Spikefield Hazard
1 Storm the Vault
4 Swamp
1 Talisman of Creativity
1 Talisman of Dominance
1 Talisman of Indulgence
1 Teferi's Time Twist
1 Terminate
1 Thaumatic Compass
1 Thing in the Ice
1 Treasure Map
1 Umara Wizard
SIDEBOARD
1 Uninvited Geist
1 Valakut Awakening
1 Vance's Blasting Cannons
1 Vedalken Mastermind
1 Voldaren Pariah
1 Westvale Abbey
1 Zof Consumption

1 Nicol Bolas, the Ravager`;

  // ---------- Parse ----------
  function parseDecklist(raw){
    const lines = String(raw||'').split(/\r?\n/);
    let commanderLine = null;
    for(let i=lines.length-1;i>=0;i--){
      const L = lines[i].trim(); if(!L) continue;
      if(/^sideboard$/i.test(L)) continue;
      commanderLine = L; break;
    }
    const main=[]; let inSide=false;
    for(const row of lines){
      const L=row.trim(); if(!L) continue;
      if(/^sideboard$/i.test(L)){ inSide=true; continue; }
      if(inSide) continue;
      const name = L.replace(/^\s*(\d+|(\d+)?x)\s+/i,'').trim();
      main.push(name);
    }
    const commander = commanderLine ? commanderLine.replace(/^\s*(\d+|(\d+)?x)\s+/i,'').trim() : '';
    const deck = main.filter(n=> n && n.toLowerCase() !== commander.toLowerCase());
    return { deck, commander };
  }

  // ---------- Scryfall ----------
  async function fetchCommanderImage(name){
  if (!name) {
    return {
      img:'', typeLine:'', oracle:'', power:'', toughness:'',
      imgBack:'', backTypeLine:'', backOracle:'',
      untapsDuringUntapStep:true,
      frontBaseTypes:[], frontBaseAbilities:[],
      backBaseTypes:[],  backBaseAbilities:[]
    };
  }

  try {
    const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`;
    const r   = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('Scryfall error');
    const j   = await r.json();

    // faces
    const faces = Array.isArray(j.card_faces) ? j.card_faces : null;
    const f0 = faces ? faces[0] : j;
    const f1 = faces && faces[1] ? faces[1] : null;

    // images
    const imgFront = f0?.image_uris?.normal || j.image_uris?.normal || '';
    const imgBack  = f1?.image_uris?.normal || '';

    // typeline/oracle/power/toughness per face
    const frontTypeLine = f0?.type_line   || j.type_line   || '';
    const backTypeLine  = f1?.type_line   || '';
    const frontOracle   = f0?.oracle_text || j.oracle_text || '';
    const backOracle    = f1?.oracle_text || '';

    const powerFront     = f0?.power ?? j.power ?? '';
    const toughnessFront = f0?.toughness ?? j.toughness ?? '';
    const loyaltyFront   = f0?.loyalty ?? j.loyalty ?? '';
    const loyaltyBack    = f1?.loyalty ?? '';


    // untap rule based on the FRONT oracle
    const oLow = ` ${String(frontOracle||'').toLowerCase()} `;
    const untapsDuringUntapStep =
      !(
        oLow.includes(" doesn't untap during your untap step") ||
        oLow.includes(" does not untap during your untap step") ||
        oLow.includes(" doesn't untap during its controller's untap step") ||
        oLow.includes(" does not untap during its controller's untap step")
      );

    // parse abilities/types per face
    const parsedFront = extractConcreteInnate(
      { typeLine: frontTypeLine, oracle: frontOracle },
      name
    );
    const parsedBack  = extractConcreteInnate(
      { typeLine: backTypeLine,  oracle: backOracle  },
      name
    );

    // commanderMeta with the SAME fields we give normal cards,
    // plus power/toughness for convenience.
    return {
       img: imgFront || '',
      typeLine: frontTypeLine || '',
      oracle: frontOracle || '',
      power: powerFront || '',
      toughness: toughnessFront || '',
      loyalty: loyaltyFront || '',

      imgBack: imgBack || '',
      backTypeLine: backTypeLine || '',
      backOracle: backOracle || '',
      backLoyalty: loyaltyBack || '',

      untapsDuringUntapStep: !!untapsDuringUntapStep,

      frontBaseTypes:      parsedFront.baseTypes     || [],
      frontBaseAbilities:  parsedFront.baseAbilities || [],
      backBaseTypes:       parsedBack.baseTypes      || [],
      backBaseAbilities:   parsedBack.baseAbilities  || []
    };
  } catch (e) {
    console.warn('[DeckLoading] commander fetch failed', e);
    return {
      img:'', typeLine:'', oracle:'', power:'', toughness:'',
      imgBack:'', backTypeLine:'', backOracle:'',
      untapsDuringUntapStep:true,
      frontBaseTypes:[], frontBaseAbilities:[],
      backBaseTypes:[],  backBaseAbilities:[]
    };
  }
}



  async function fetchDeckImages(names){
    // Batch into up to 70 idents per request
    const out = new Map(); // normName(name) -> meta
    const chunk = (arr,n)=>arr.reduce((a,_,i)=> (i%n? a[a.length-1].push(arr[i]) : a.push([arr[i]]), a),[]);
    const batches = chunk(names, 70);

    // Helper: store meta under multiple keys
    const setMeta = (nameLike, meta) => {
      if (!nameLike) return;
      out.set(normName(nameLike), meta);
    };

    for (const group of batches){
      try{
        const body = { identifiers: group.map(n=>({ name:n })) };
        const r = await fetch('https://api.scryfall.com/cards/collection', {
          method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
        });
        if(!r.ok) throw new Error('Scryfall collection error');
        const j = await r.json();
        if (Array.isArray(j.data)){
  for (const card of j.data){
    const fullName = (card.name || '').trim();

    // --- pull faces ---
    const faces = Array.isArray(card.card_faces) ? card.card_faces : null;
    const f0 = faces ? faces[0] : card;
    const f1 = faces && faces[1] ? faces[1] : null;

    // images
    const imgFront = f0?.image_uris?.normal || card.image_uris?.normal || '';
    const imgBack  = f1?.image_uris?.normal || '';

    // text blobs
    const frontTypeLine = f0?.type_line   || card.type_line   || '';
    const backTypeLine  = f1?.type_line   || '';
    const frontOracle   = f0?.oracle_text || card.oracle_text || '';
    const backOracle    = f1?.oracle_text || '';

    // stats
    const powerFront     = f0?.power ?? card.power ?? '';
    const toughnessFront = f0?.toughness ?? card.toughness ?? '';
    const loyaltyFront   = f0?.loyalty ?? card.loyalty ?? '';
    const loyaltyBack    = f1?.loyalty ?? '';

    // untap rule is front-face oracle based (that’s what we’d show on table first)
    const oLow = ` ${String(frontOracle||'').toLowerCase()} `;
    const untapsDuringUntapStep =
      !(
        oLow.includes(" doesn't untap during your untap step") ||
        oLow.includes(" does not untap during your untap step") ||
        oLow.includes(" doesn't untap during its controller's untap step") ||
        oLow.includes(" does not untap during its controller's untap step")
      );

    // parse innate for each face separately using the UPDATED signature
    const parsedFront = extractConcreteInnate(
      { typeLine: frontTypeLine, oracle: frontOracle },
      fullName
    );
    const parsedBack  = extractConcreteInnate(
      { typeLine: backTypeLine,  oracle: backOracle  },
      fullName
    );

    // final meta we store in the Map
    const meta = {
      // FRONT defaults (what hits the table initially)
      img: imgFront || '',
      typeLine: frontTypeLine || '',
      oracle: frontOracle || '',
      power: powerFront || '',
      toughness: toughnessFront || '',
      loyalty: loyaltyFront || '',

      // Back info kept separately
      imgBack: imgBack || '',
      backTypeLine: backTypeLine || '',
      backOracle: backOracle || '',
      backLoyalty: loyaltyBack || '',

      // "does it untap normally?" derived from front rules box
      untapsDuringUntapStep: !!untapsDuringUntapStep,

      // Parsed ability/type pills per face
      frontBaseTypes:      parsedFront.baseTypes     || [],
      frontBaseAbilities:  parsedFront.baseAbilities || [],
      backBaseTypes:       parsedBack.baseTypes      || [],
      backBaseAbilities:   parsedBack.baseAbilities  || []
    };


    // Index by the full printed name
    setMeta(fullName, meta);

    // Also index by *each face name* so "Akoum Warrior" etc. resolve
    if (faces) {
      for (const f of faces) {
        if (f?.name) setMeta(f.name, meta);
      }
    }
  }
}

      }catch(e){
        console.warn('[DeckLoading] bulk fetch batch failed', e);
      }
    }

    // Fallback pass: individually fetch any names we still don't have (typos/edge cases)
const missing = names.filter(n => !out.has(normName(n)));
for (const name of missing){
  try{
    const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`;
    const r   = await fetch(url,{cache:'no-store'}); 
    if(!r.ok) continue;
    const j   = await r.json();

    const fullName = (j.name || '').trim();

    // faces
    const faces = Array.isArray(j.card_faces) ? j.card_faces : null;
    const f0 = faces ? faces[0] : j;
    const f1 = faces && faces[1] ? faces[1] : null;

    // images
    const imgFront = f0?.image_uris?.normal || j.image_uris?.normal || '';
    const imgBack  = f1?.image_uris?.normal || '';

    // type/oracle per face
    const frontTypeLine = f0?.type_line   || j.type_line   || '';
    const backTypeLine  = f1?.type_line   || '';
    const frontOracle   = f0?.oracle_text || j.oracle_text || '';
    const backOracle    = f1?.oracle_text || '';

    // stats
    const powerFront     = f0?.power ?? j.power ?? '';
    const toughnessFront = f0?.toughness ?? j.toughness ?? '';
    const loyaltyFront   = f0?.loyalty ?? j.loyalty ?? '';
    const loyaltyBack    = f1?.loyalty ?? '';

    // untap rule based on frontOracle
    const oLow = ` ${String(frontOracle||'').toLowerCase()} `;

    const untapsDuringUntapStep =
      !(
        oLow.includes(" doesn't untap during your untap step") ||
        oLow.includes(" does not untap during your untap step") ||
        oLow.includes(" doesn't untap during its controller's untap step") ||
        oLow.includes(" does not untap during its controller's untap step")
      );

    // parse innate for each face
    const parsedFront = extractConcreteInnate(
      { typeLine: frontTypeLine, oracle: frontOracle },
      fullName
    );
    const parsedBack  = extractConcreteInnate(
      { typeLine: backTypeLine,  oracle: backOracle  },
      fullName
    );

    // final meta (SAME SHAPE as batch)
    const meta = {
      img: imgFront || '',
      typeLine: frontTypeLine || '',
      oracle: frontOracle || '',
      power: powerFront || '',
      toughness: toughnessFront || '',
      loyalty: loyaltyFront || '',

      imgBack: imgBack || '',
      backTypeLine: backTypeLine || '',
      backOracle: backOracle || '',
      backLoyalty: loyaltyBack || '',

      untapsDuringUntapStep: !!untapsDuringUntapStep,

      frontBaseTypes:      parsedFront.baseTypes     || [],
      frontBaseAbilities:  parsedFront.baseAbilities || [],
      backBaseTypes:       parsedBack.baseTypes      || [],
      backBaseAbilities:   parsedBack.baseAbilities  || []
    };


    // Index by printed name + each face name
    out.set(normName(fullName), meta);
    if (faces) {
      for (const f of faces) {
        if (f?.name) {
          out.set(normName(f.name), meta);
        }
      }
    }

  }catch(e){
    console.warn('[DeckLoading] fallback fetch failed', name, e);
  }
}


    return out; // Map (normName -> meta)
  }


 // ---------- Ability / type extraction (strict, no conditionals) ----------
//
// We ONLY want "concrete" evergreen combat/movement abilities that are:
//
 // - printed as leading keywords at the top of the rules box
 //   e.g. "Flying, lifelink", "First strike", "Vigilance"
 //   These appear as the first thing(s) on a line.
 //
 // - NOT conditional ("as long as...", "if you control...", "as long as you have 30+ life")
 //   We IGNORE those here.
 //
 // - NOT variant forms like "Hexproof from white", "Protection from Vampires" etc.
 //   Those require parsing complex phrases or conditions, so we SKIP them.
 //
 // - Instants / Sorceries never get abilities.
 //
 // Result is something safe to auto-badge on spawn: ["Flying","First Strike","Lifelink"] etc.

function extractConcreteInnate(faceMeta /* {typeLine, oracle} */, cardName) {
  const outAbilities = [];
  const outTypes     = [];

  const typeLineRaw  = faceMeta?.typeLine || '';
  const oracleRaw    = faceMeta?.oracle   || '';
  const tl           = typeLineRaw.toLowerCase().trim();


  // ---- TYPES: parse the full type_line, including creature subtypes
  //
  // Example type_line:
  //   "Legendary Creature — Elder Dragon"
  //
  // We'll:
  //   - split on "—" (em dash),
  //   - take both left ("Legendary Creature") and right ("Elder Dragon"),
  //   - split on spaces,
  //   - keep each word capitalized as its own pill.
  //
  // We still dedupe later.

  const rawPieces = typeLineRaw
    .split('—')                // ["Legendary Creature ", " Elder Dragon"]
    .map(s => s.trim())        // ["Legendary Creature", "Elder Dragon"]
    .filter(Boolean);          // remove blanks

  for (const piece of rawPieces) {
    // split on spaces to get ["Legendary","Creature"] / ["Elder","Dragon"]
    const words = piece.split(/\s+/);
    for (const w of words) {
      const cleaned = w.replace(/[^A-Za-z]/g,'').trim(); // strip commas etc.
      if (!cleaned) continue;
      outTypes.push(cleaned); // keep as-is, we'll capFirstWord below in dedupe
    }
  }

  // normalize capitalization ("elder" -> "Elder")
  outTypes.forEach((v, i) => {
    outTypes[i] = v.charAt(0).toUpperCase() + v.slice(1);
  });



  // ---- If it's a non-permanent spell, we never assign combat abilities
  if (tl.includes('instant') || tl.includes('sorcery')) {
    return { baseTypes: dedupe(outTypes), baseAbilities: [] };
  }

  // We'll read oracle text line by line.
  // We ONLY trust the first chunk on a line if that line is clearly "keyword, keyword"
  // style (like Flying, lifelink) or single keyword ("First strike").
  //
  // We IGNORE:
  // - lines that start with "As long as", "Whenever", "When", "At the beginning",
  //   "If", "While", "Other", "Target", "Create".
  //   Those are conditional / granting / token text. We refuse to auto-badge those.
  //
  // We ALSO IGNORE:
  // - anything that starts with "Hexproof from ...", "Protection from ..."
  //   because those are too custom / conditional-ish.
  //
  // We ONLY allow clean evergreen keywords or comma lists of them.

  const oracleLines = String(oracleRaw)
    .split(/\r?\n+/)
    .map(s => s.trim())
    .filter(Boolean);

  // Keywords we consider "concrete", safe, evergreen:
  const KEYWORDS = [
    'flying',
    'first strike',
    'double strike',
    'vigilance',
    'lifelink',
    'deathtouch',
    'trample',
    'haste',
    'reach',
    'defender',
    'hexproof',        // JUST "Hexproof", NOT "Hexproof from ..."
    'indestructible',
    'menace',
    'ward'             // optional newer evergreen-ish mechanic; keep or drop
  ];


  lineLoop:
  for (const line of oracleLines) {
    const lowered = line.toLowerCase();

    // reject obvious condition / grant / token / aura text
    if (/^(as long as|whenever|when |at the beginning|if |while |other |target |create )/i.test(line)) {
      continue lineLoop;
    }

    // pull off the "front chunk":
    //   e.g. "Flying, lifelink (This creature ... )"
    //   e.g. "First strike (This creature ... )"
    //
    // grab text up until first period OR before any reminder text, then split commas.
    // but FIRST we reject stuff we never want to parse (protection, hexproof from).
    if (/^protection from /i.test(line)) continue lineLoop;
    if (/^hexproof from /i.test(line))   continue lineLoop;

    // only trust lines that START with a known keyword.
    // If it starts with something we don't recognize -> bail on this line.
    if (!KEYWORDS.some(kw => lowered.startsWith(kw))) {
      continue lineLoop;
    }

    // take substring up to first "(" because that's where reminder text usually begins
    const beforeReminder = line.split('(')[0].trim();

    // now split that by commas to get "Flying" and "lifelink"
    const parts = beforeReminder.split(/\s*,\s*/);

    for (let part of parts) {
      if (!part) continue;
      let pLow = part.toLowerCase().trim();

      // skip if pLow starts with "hexproof from" or "protection from"
      if (pLow.startsWith('hexproof from')) continue;
      if (pLow.startsWith('protection from')) continue;

      // skip if this is something conditional right in the keyword chunk
      // like "hexproof if you control..." (paranoid check)
      if (/\bif\b|\bas long as\b|\bwhile\b/i.test(pLow)) continue;

      // try to match any of our safe keywords at the START of the chunk
      const matchKw = KEYWORDS.find(kw => pLow.startsWith(kw));
      if (matchKw) {
        outAbilities.push(titleCaseKeyword(matchKw));
      }
    }
  }

  return {
    baseTypes:     dedupe(outTypes),
    baseAbilities: dedupe(outAbilities)
  };

  // helpers local to this closure
  function capFirstWord(w){
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  function titleCaseKeyword(kw){
    return kw.split(' ').map(capFirstWord).join(' ');
  }
  function dedupe(arr){
    return [...new Set(arr)];
  }
}

// ---------- State ----------
const state = {
  deck: [],       // array of names (top -> bottom)
  library: [],    // array of {name, imageUrl, typeLine, oracle, baseTypes[], baseAbilities[], ...} (top -> bottom)
  commander: '',
  commanderMeta: { img:'', typeLine:'', oracle:'', power:'', toughness:'' }
};



  function shuffleInPlace(a){
  // Fisher–Yates with crypto randomness + a single random cut to improve "feel"
  const n = a.length;
  if (n <= 1) return a;

  // --- Crypto RNG for indices ---
  // Fallback to Math.random() only if crypto is unavailable.
  const randInt = (maxInclusive) => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      // Uniform int in [0, maxInclusive]
      // Use rejection sampling to avoid modulo bias
      const range = maxInclusive + 1;
      const maxUint = 0xFFFFFFFF; // 32-bit
      const buckets = Math.floor((maxUint + 1) / range) * range;
      let x = 0;
      do {
        const buf = new Uint32Array(1);
        window.crypto.getRandomValues(buf);
        x = buf[0];
      } while (x >= buckets);
      return x % range;
    }
    return (Math.random() * (maxInclusive + 1)) | 0;
  };

  // Fisher–Yates
  for (let i = n - 1; i > 0; i--) {
    const j = randInt(i);
    [a[i], a[j]] = [a[j], a[i]];
  }

  // Single random "cut" (rotate the deck) for human-like feel
  const cut = randInt(n - 1);              // 0..n-1
  if (cut > 0) {
    const top = a.splice(0, cut);          // take top 'cut' cards
    a.push(...top);                         // move them to bottom
  }

  return a;
}


  // ---------- API ----------
  let onLoadedCb = null;
  
function init({ onLoaded } = {}){
  onLoadedCb = typeof onLoaded === 'function' ? onLoaded : null;
  const o = ensureOverlay();
  o.querySelector('#btnLoadDeck').onclick = async (ev) => {
  const btn = ev?.currentTarget || o.querySelector('#btnLoadDeck');
  const ta  = o.querySelector('#deckText');
  const src = (ta.value || '').trim() || DEFAULT_LIST;

  // ✅ CLOSE THE DECK OVERLAY IMMEDIATELY ON CLICK
try { hide(); } catch {}

// 🔒 Block *manual* deck clicks briefly while mulligan/opening hand spins up.
_tLoadStarted = Date.now();           // <— track when load started
_blockClicks(4000);


// 1) SHOW PORTRAIT OVERLAY *IMMEDIATELY* (no waiting on data)
try {
  const already = (typeof PortraitOverlay?.isReady === 'function') && PortraitOverlay.isReady();
  if (!already) {
    console.log('[DeckLoad] Preparing PortraitOverlay (show on init)…');
    await PortraitOverlay.init({
      autoRandomIfUnset: false,
      autoCloseOnBothRolled: true,
      enableRTC: true,
      showOnInit: true // open now
    });
  } else if (typeof PortraitOverlay?.isOpen === 'function' && !PortraitOverlay.isOpen()) {
    PortraitOverlay.show();
  }
} catch (e) {
  console.warn('[DeckLoad] PortraitOverlay init/show failed, fallback UI only', e);
}


  // prevent double clicks (safe even though overlay is hidden)
  try { if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; } } catch {}

  // 2) Parse once; commander FIRST — do NOT fetch deck art yet
  const { deck, commander } = parseDecklist(src);
  console.log('[DeckLoad] parsed (commander-first)', { deckCount: deck.length, commander });

  // 3) Fetch ONLY the commander art/meta
  const cmdMeta = await fetchCommanderImage(commander);

  // 4) Normalize commanderMeta shape (same as cards)
  const enrichedCommanderMeta = {
    ...cmdMeta,
    name: commander,
    imageUrl: cmdMeta.img || '',
    imgFront: cmdMeta.img || '',
    imgBack:  cmdMeta.imgBack || '',
    typeLine: cmdMeta.typeLine || '',
    frontTypeLine: cmdMeta.typeLine || '',
    backTypeLine:  cmdMeta.backTypeLine || '',
    oracle: cmdMeta.oracle || '',
    frontOracle: cmdMeta.oracle || '',
    backOracle:  cmdMeta.backOracle || '',
    untapsDuringUntapStep: !!cmdMeta.untapsDuringUntapStep,
    baseTypes:     cmdMeta.frontBaseTypes     || [],
    baseAbilities: cmdMeta.frontBaseAbilities || [],
    frontBaseTypes:      cmdMeta.frontBaseTypes     || [],
    frontBaseAbilities:  cmdMeta.frontBaseAbilities || [],
    backBaseTypes:       cmdMeta.backBaseTypes      || [],
    backBaseAbilities:   cmdMeta.backBaseAbilities  || [],
    power: cmdMeta.power || '',
    toughness: cmdMeta.toughness || '',
    loyalty: cmdMeta.loyalty || '',
    backLoyalty: cmdMeta.backLoyalty || '',
    currentSide: 'front'
  };

  // 5) Install minimal state (empty library for now)
  Object.assign(state, {
    deck: [...deck],
    library: [],
    commander,
    commanderMeta: enrichedCommanderMeta
  });
  _syncLibGlobals();
  
  // Let listeners (hand.js, zones, etc.) know the loader is usable
try {
  if (!window.DeckLoading) window.DeckLoading = DeckLoading; // safety
  window.dispatchEvent(new CustomEvent('deckloading:ready', { detail: { at: 'init' } }));
} catch {}


  // 6) SEND URL TO OPPONENT **BEFORE** ANY LOCAL PROCESSING; THEN PROCESS LOCALLY
  try {
    const mySeat = (typeof window.mySeat === 'function') ? Number(window.mySeat()) || 1 : (Number(window.__LOCAL_SEAT) || 1);
    const side   = (mySeat === 1) ? 'left' : 'right';
    const oppSide = (side === 'left') ? 'right' : 'left';
    const artUrl = enrichedCommanderMeta.imgFront || enrichedCommanderMeta.img || '';

    if (artUrl) {
      // a) explicit RTC send of only the URL
      try {
        _rtcSend({ type: 'overlay:ready', seat: mySeat, artUrl });
        console.log('[DeckLoad] RTC sent overlay:ready (URL only)', { seat: mySeat, side, artUrl });
      } catch (eSend) {
        console.warn('[DeckLoad] overlay:ready send failed', eSend);
      }

      // b) start local processing immediately (no echo)
      await PortraitOverlay.setPortrait(side, artUrl);
      console.log('[DeckLoad] Local portrait set (processing started)', { side, artUrl });

      // c) if we already cached their art, apply it now (no echo)
      const pendingMap = (typeof window !== 'undefined') ? (window.__DICE_PENDING || null) : null;
      const oppArt = pendingMap && pendingMap[oppSide] ? String(pendingMap[oppSide]) : '';
      if (oppArt) {
        console.log('[DeckLoad] Applying pending opponent portrait', { oppSide, oppArt });
        await PortraitOverlay.setPortrait(oppSide, oppArt);
        try { pendingMap[oppSide] = null; } catch {}
      }
    }
  } catch (e) {
    console.warn('[DeckLoad] portrait URL handling failed', e);
  }

  // 7) Kick deck fetch/parse in the BACKGROUND (does not block overlay/processing)
  (async () => {
    try {
      const deckMap = await fetchDeckImages(deck);

      const lib = deck.map(name => {
        const meta = deckMap.get(normName(name));
        if (meta) {
          const cardEntry = {
            name,
            imageUrl: meta.img || '',
            typeLine: meta.typeLine || '',
            oracle:   meta.oracle || '',
            power:     meta.power || '',
            toughness: meta.toughness || '',
            loyalty:   meta.loyalty || '',
            backLoyalty: meta.backLoyalty || '',
            untapsDuringUntapStep: !!meta.untapsDuringUntapStep,
            baseTypes:     meta.frontBaseTypes     || [],
            baseAbilities: meta.frontBaseAbilities || [],
            frontBaseTypes:      meta.frontBaseTypes     || [],
            frontBaseAbilities:  meta.frontBaseAbilities || [],
            backBaseTypes:       meta.backBaseTypes      || [],
            backBaseAbilities:   meta.backBaseAbilities  || [],
            frontTypeLine: meta.typeLine || '',
            backTypeLine:  meta.backTypeLine || '',
            frontOracle:   meta.oracle || '',
            backOracle:    meta.backOracle || '',
            imgFront:      meta.img || '',
            imgBack:       meta.imgBack || '',
            currentSide:   'front'
          };
          console.log('%c[DeckLoad:card built ✅]', 'color:#6cf', {
            name: cardEntry.name, imageUrl: cardEntry.imageUrl,
            typeLine: cardEntry.typeLine, oracle: cardEntry.oracle,
            baseTypes: cardEntry.baseTypes, baseAbilities: cardEntry.baseAbilities,
            untapsDuringUntapStep: cardEntry.untapsDuringUntapStep
          });
          return cardEntry;
        }

        const fallbackEntry = {
          name,
          imageUrl: '',
          typeLine: '',
          oracle: '',
          untapsDuringUntapStep: true,
          baseTypes: [],
          baseAbilities: []
        };
        console.log('%c[DeckLoad:card built ❌META]', 'color:#f66;font-weight:bold', {
          name: fallbackEntry.name, imageUrl: '', typeLine: '', oracle: '',
          baseTypes: [], baseAbilities: [], untapsDuringUntapStep: true
        });
        return fallbackEntry;
      });

      shuffleInPlace(lib);

      // install full library now that it’s ready
      state.library = lib;
      _syncLibGlobals();

      // optional: close deck overlay now that deck is parsed
      hide();

      // broadcast compact art snapshot (commander + entries)
      try { _sendDeckArtSnapshot(); } catch {}

      // notify Zones/UI consumer
      try {
        onLoadedCb?.(state.deck, state.commander, state.commanderMeta.img, state.commanderMeta);
      } catch {}

      console.log('%c[DeckLoad:FINAL LIB]', 'background:#222;color:#0f0;padding:4px 6px;border-radius:4px;', {
        commander: state.commander,
        commanderMeta: state.commanderMeta,
        libraryCount: state.library.length,
        libraryFirstFew: state.library.slice(0,10),
        fullLibrary: state.library
      });
    } catch (e) {
      console.warn('[DeckLoad] background deck fetch/build failed', e);
      // Still close the text overlay to avoid trapping the user
      try { hide(); } catch {}
    } finally {
      try { if (btn) { btn.disabled = false; btn.textContent = 'Load Deck'; } } catch {}
    }
  })();
};

}


  function drawOne(){
  const c = state.library.shift() || null;
  try { _syncLibGlobals(); } catch {}
  return c || null;
}


  function drawOneToHand(deckEl){
  try{
    // If mulligan is open, never allow manual draws.
    if (_mulliganOpen && deckEl) {
      console.log('[DeckLoading] manual deck click suppressed (mulligan open)');
      return false;
    }

    // Strong manual suppression while global block is on
    if (_blockManualDraw && deckEl) {
      console.log('[DeckLoading] manual deck click suppressed until mulligan/opening-hand done');
      return false;
    }

    // Extra safety: eat exactly ONE early "first click" that happens
    // soon after load, even if caller didn't pass deckEl.
    // This covers handlers that call drawOneToHand() with no args.
    const withinLoadWindow = (Date.now() - _tLoadStarted) < 15000; // 15s safety
    if (!_firstDrawSuppressed && !_mulliganOpen && withinLoadWindow) {
      // Heuristic: treat this as "manual-ish" if either a deckEl was passed
      // OR it's the very first draw attempt after load.
      console.log('[DeckLoading] first post-load draw suppressed (pre-mulligan)');
      _firstDrawSuppressed = true;
      return false;
    }

    const card = drawOne();
    if (!card) return false;

    if (typeof window.flyDrawToHand === 'function'){
      window.flyDrawToHand(card, deckEl || document.getElementById('pl-deck'));
    }
    return true;
  }catch(e){
    console.warn('[DeckLoading] drawOneToHand failed', e);
    return false;
  }
}



  // ---- Overlay read-only accessors (non-breaking) ----
  function enumerateDeck(){
    try {
      // Remaining drawable library (top -> bottom)
      return state.library.map(c => ({
        name: c?.name || 'Card',
        img:  c?.imageUrl || ''
      }));
    } catch { return []; }
  }

  function deckCount(){
    try { return state.library.length | 0; } catch { return 0; }
  }

  // Also expose on a stable global for non-module callers
  try {
    window.DeckAccess = window.DeckAccess || {};
    window.DeckAccess.enumerate = enumerateDeck;
    window.DeckAccess.count = deckCount;
  } catch {}
  
    // ---------- Return-to-deck (from a live table <img.table-card>) ----------
  function _entryFromTableCardEl(cardEl){
    const d = cardEl?.dataset || {};
    const parseJSON = (s) => { try { const v = JSON.parse(s||'[]'); return Array.isArray(v)? v : []; } catch { return []; } };

    const entry = {
      name: d.name || cardEl.title || 'Card',
      imageUrl: cardEl.currentSrc || cardEl.src || '',
      typeLine: d.typeLine || '',
      oracle:   d.oracle   || '',
      power:     d.power     || '',
      toughness: d.toughness || '',
      loyalty:   d.loyalty   || '',
      backLoyalty: d.backLoyalty || '',
      untapsDuringUntapStep: (d.untapsDuringUntapStep !== 'false'),

      baseTypes:     parseJSON(d.baseTypes),
      baseAbilities: parseJSON(d.baseAbilities),

      // faces (kept so flip/tooltip have parity with freshly drawn cards)
      frontBaseTypes:      parseJSON(d.frontBaseTypes),
      frontBaseAbilities:  parseJSON(d.frontBaseAbilities),
      backBaseTypes:       parseJSON(d.backBaseTypes),
      backBaseAbilities:   parseJSON(d.backBaseAbilities),

      frontTypeLine: d.frontTypeLine || d.typeLine || '',
      backTypeLine:  d.backTypeLine  || '',
      frontOracle:   d.frontOracle   || d.oracle   || '',
      backOracle:    d.backOracle    || '',

      imgFront: d.imgFront || (cardEl.currentSrc || cardEl.src || ''),
      imgBack:  d.imgBack  || '',

      currentSide: d.currentSide || 'front'
    };

    return entry;
  }

  // pos: 'top' | 'bottom' | 'random'
  function insertFromTable(cardEl, pos='top'){
    if (!cardEl) { console.warn('[DeckLoading] insertFromTable: no element'); return false; }
    const entry = _entryFromTableCardEl(cardEl);
    if (!entry.name) { console.warn('[DeckLoading] insertFromTable: no name on entry'); return false; }

    const lib = state.library;
    if (!Array.isArray(lib)) { console.warn('[DeckLoading] insertFromTable: library missing'); return false; }

    const p = String(pos||'top').toLowerCase();
    if (p === 'bottom') {
      lib.push(entry);
    } else if (p === 'random') {
      const idx = Math.floor(Math.random() * (lib.length + 1));
      lib.splice(idx, 0, entry);
    } else {
      lib.unshift(entry); // default top
    }

    console.log('[DeckLoading] insertFromTable →', { pos:p, name:entry.name, libraryCount: lib.length });
try { _syncLibGlobals(); } catch {}
return true;

  }

  function shuffleLibrary(){
  shuffleInPlace(state.library);
  try { _syncLibGlobals(); } catch {}
  console.log('[DeckLoading] shuffleLibrary() →', { libraryCount: state.library.length });
}


// Keep a window-scoped mirror so other modules/console can read snapshots safely.
const _WIN = (typeof window !== 'undefined' ? window : globalThis);
if (!Array.isArray(_WIN.__LIB_REMAINING)) _WIN.__LIB_REMAINING = [];
if (!Array.isArray(_WIN.__LIB_ALL))       _WIN.__LIB_ALL       = [];

// Keep window mirrors in sync with our module state.
function _syncLibGlobals(){
  try{
    // remaining = live drawable stack (top -> bottom)
    _WIN.__LIB_REMAINING.length = 0;
    _WIN.__LIB_REMAINING.push(...state.library.map(x => ({ ...x })));

    // all = canonical parsed deck (set once per load; if empty, initialize)
    if (!_WIN.__LIB_ALL.length) {
      _WIN.__LIB_ALL = state.library.map(x => ({ ...x }));
    }
  }catch(e){
    console.warn('[DeckLoading] _syncLibGlobals failed', e);
  }
}

/* ────────────────────────────────────────────────────────────
   Manual draw suppression so first deck click doesn't add +1
   on top of opening-hand (mulligan) seven.

   Changes:
   - We now track the deck-load moment and suppress the *first* draw
     even if caller doesn't pass deckEl.
   - We also listen for mulligan events to clear suppression.
──────────────────────────────────────────────────────────── */
let _blockManualDraw = false;          // general "no manual draws"
let _firstDrawSuppressed = false;      // eat exactly one early manual-ish draw
let _mulliganOpen = false;             // mulligan UI state (from events)
let _tLoadStarted = 0;                 // ms since epoch of "Load Deck" click

function _blockClicks(ms = 0){
  _blockManualDraw = true;
  if (ms > 0) setTimeout(() => { _blockManualDraw = false; }, ms);
}
function _allowClicks(){ _blockManualDraw = false; }

(function installMulliganGuards(){
  if (typeof window === 'undefined') return;
  if (window.__DECK_DRAW_GUARDS) return;
  window.__DECK_DRAW_GUARDS = 1;

  window.addEventListener('mulligan:open', () => {
    _mulliganOpen = true;
    _blockManualDraw = true;
    window.__MULLIGAN_OPEN = true;
  });
  window.addEventListener('mulligan:closed', () => {
    _mulliganOpen = false;
    _blockManualDraw = false;
    window.__MULLIGAN_OPEN = false;
  });
  window.addEventListener('openinghand:done', () => {
    _mulliganOpen = false;
    _blockManualDraw = false;
    window.__MULLIGAN_OPEN = false;
  });

  // Console helpers
  try {
    window.DeckLoadingAllowClicks = _allowClicks;
    window.DeckLoadingBlockClicks = _blockClicks;
  } catch {}
})();



// ────────────────────────────────────────────────────────────
// RTC: deck art snapshot (send-only; receiver will be added later)
// ────────────────────────────────────────────────────────────
function _rtcSend(obj){
  try {
    const send = (window.rtcSend || window.peer?.send);
    if (typeof send === 'function') {
      send(obj);
      console.log('%c[RTC:send]', 'color:#6cf', obj);
    }
  } catch (e) {
    console.warn('[DeckLoading] rtc send failed', e);
  }
}

// ────────────────────────────────────────────────────────────
// RTC RECEIVE: deck-art + portrait packets → force-open + apply
// ────────────────────────────────────────────────────────────
(function installDeckLoadingRx(){
  if (typeof window === 'undefined') return;
  if (window.__DECK_LOADING_RX) return; 
  window.__DECK_LOADING_RX = true;

  // Helper: attach our handler to whatever RTC bus is present.
  function attach(handler){
    // 1) array bus
    if (Array.isArray(window.rtcOnMessage)) { window.rtcOnMessage.push(handler); return true; }
    // 2) DOM custom event
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('rtc-message', (e)=> handler(e?.detail || e));
      return true;
    }
    // 3) simple peer.js style
    try {
      if (window.peer && typeof window.peer.on === 'function') {
        window.peer.on('data', (data)=> {
          try { handler(typeof data === 'string' ? JSON.parse(data) : data); } catch { handler(data); }
        });
        return true;
      }
    } catch {}
    // 4) last resort shim
    const prev = window.onRTCMessage;
    window.onRTCMessage = function(msg){ try{ handler(msg); }catch{} if (typeof prev === 'function') prev(msg); };
    return true;
  }

  const handler = async (msg) => {
    if (!msg || typeof msg !== 'object') return;

    // Ensure overlay exists and is RTC-enabled before applying art
    async function ensureOverlayReady(){
  try {
    const already = (typeof PortraitOverlay?.isReady === 'function') && PortraitOverlay.isReady();
    if (!already) {
      await PortraitOverlay.init({
        autoRandomIfUnset: false,
        autoCloseOnBothRolled: true,
        enableRTC: true
      });
    }
  } catch {}
}


    try {
      // Case A: explicit portrait packet from opponent
      if (msg.type === 'dice-portrait') {
        const side = (msg.side === 'left' || msg.side === 'right') ? msg.side : null;
        const url  = (typeof msg.url === 'string') ? msg.url : '';
        if (!side || !url) return;

        await ensureOverlayReady();
        // Apply WITHOUT echo
        await PortraitOverlay.setPortrait(side, url);
        return;
      }

      // Case B: deck art snapshot (we only need the commander art)
      if (msg.type === 'deck-art-sync') {
        const mySeat  = (typeof window.mySeat === 'function') ? (Number(window.mySeat()) || 1) : (Number(window.__LOCAL_SEAT) || 1);
        const mySide  = (mySeat === 1) ? 'left' : 'right';
        const oppSide = (mySide === 'left') ? 'right' : 'left';

        const art = msg?.commander?.imgFront || msg?.commander?.img || '';
        if (!art) return;

        await ensureOverlayReady();
        // Apply WITHOUT echo
        await PortraitOverlay.setPortrait(oppSide, art);
        return;
      }
    } catch (e) {
      console.warn('[DeckLoading] RX handler failed', e);
    }
  };

  attach(handler);
})();


// Build a compact packet that mirrors art for commander + all drawable entries.
// imgFront/imgBack are included for DFCs; imageUrl (front) is kept for parity.
function _buildDeckArtPacket(){
  try{
    const seat = (typeof window.mySeat === 'function') ? window.mySeat() : 1;
    const commanderMeta = state?.commanderMeta || {};
    const commander = {
      name: state?.commander || '',
      imgFront: commanderMeta.imgFront || commanderMeta.img || '',
      imgBack:  commanderMeta.imgBack  || ''
    };

    const deck = Array.isArray(state?.library) ? state.library.map(c => ({
      name:     c?.name || '',
      imgFront: c?.imgFront || c?.imageUrl || '',
      imgBack:  c?.imgBack  || ''
    })) : [];

    return {
      type: 'deck-art-sync',
      seat,
      commander,
      deck
    };
  }catch(e){
    console.warn('[DeckLoading] build packet failed', e);
    return { type:'deck-art-sync', seat:1, commander:{name:'',imgFront:'',imgBack:''}, deck:[] };
  }
}

function _sendDeckArtSnapshot(){
  const pkt = _buildDeckArtPacket();
  _rtcSend(pkt);
}


function exportLibrarySnapshot(){
  try{
    return {
      remaining: (_WIN.__LIB_REMAINING || []).map(x => ({ ...x })),
      all:       (_WIN.__LIB_ALL       || []).map(x => ({ ...x }))
    };
  }catch{
    return { remaining: [], all: [] };
  }
}

/**
 * Hydrate the deck loader from a previously saved snapshot so
 * the UI behaves exactly like a freshly loaded deck:
 * - sets internal state (deck/library/commander/meta)
 * - syncs window mirrors
 * - flips the deck zone "has deck" UI + background
 * - sends an RTC deck-visual ping to the opponent
 * - updates the commander label if present
 *
 * @param {Object} snap
 *   snap.remaining  -> array of live drawable entries (top -> bottom)
 *   snap.all        -> (optional) full parsed deck entries
 *   snap.commander  -> (optional) commander name
 *   snap.commanderMeta -> (optional) meta blob used on first load
 *   snap.deckNames  -> (optional) canonical name list (top -> bottom)
 */
function hydrateFromSave(snap = {}){
  try{
    const remaining = Array.isArray(snap.remaining) ? snap.remaining.map(x => ({ ...x })) : [];
    const all       = Array.isArray(snap.all)       ? snap.all.map(x => ({ ...x }))       : [];

    // Prefer provided commander info; otherwise keep the existing defaults
    const commander     = String(snap.commander || state.commander || '');
    const commanderMeta = snap.commanderMeta ? { ...snap.commanderMeta } : { ...state.commanderMeta };

    // Optional canonical names (top -> bottom). If not provided, derive from remaining.
    const deckNames = Array.isArray(snap.deckNames) && snap.deckNames.length
      ? snap.deckNames.slice()
      : remaining.map(c => c?.name || '').filter(Boolean);

    // Install the library and commander info
    Object.assign(state, {
      deck: deckNames,
      library: remaining,
      commander,
      commanderMeta
    });

    // Keep global mirrors in sync so overlays see the live deck
    _syncLibGlobals();

    // Flip the deck zone UI bits exactly as a fresh load would
    try{
      const deckZone = document.getElementById('pl-deck');
      if (deckZone) {
        deckZone.dataset.hasDeck = '1';
        deckZone.classList.add('has-deck');
      }
    }catch{}

    // Ask Zones to render deck background + commander label + send rtc visual
    try{
      const deckZone = document.getElementById('pl-deck');
      const cmdZone  = document.getElementById('pl-commander');
      if (window.Zones?.markDeckPresent)  window.Zones.markDeckPresent(deckZone, true);
      if (window.Zones?.setCommanderName) window.Zones.setCommanderName(cmdZone, commander);
      if (window.Zones?.sendDeckVisual)   window.Zones.sendDeckVisual(true);
    }catch{}

    // Notify any deck UI listeners (e.g., deck search overlay) to refresh
    try { window.dispatchEvent(new CustomEvent('deckloading:changed')); } catch {}

    // Send deck art snapshot so the remote mirrors art on restore flows too
    try { _sendDeckArtSnapshot(); } catch {}

    console.log('[DeckLoading] hydrateFromSave → ready', {
      libraryCount: state.library.length,
      commander: state.commander
    });

    return true;

  }catch(e){
    console.warn('[DeckLoading] hydrateFromSave failed', e);
    return false;
  }
}

function importLibrarySnapshot(snap = {}) {
  // Thin alias so older callers keep working.
  // Accepts { remaining:[], all:[], commander?, commanderMeta?, deckNames? }
  return hydrateFromSave(snap);
}


return {
    init, open,
    drawOne, drawOneToHand,

    // ⬇️ NEW: read-only helpers for overlays/UI
    enumerate: enumerateDeck,
    count: deckCount,

    // ⬇️ NEW: return-to-deck + shuffle
    insertFromTable,
    shuffleLibrary,
    exportLibrarySnapshot,

    // ⬇️ NEW: allow loader to accept a restored deck and flip UI into "loaded" mode
    hydrateFromSave,
    importLibrarySnapshot,

    get state(){ return state; }
  };
})();

try { window.DeckLoadingHydrate = (snap) => DeckLoading.hydrateFromSave(snap); } catch {}

// ---- Global exposure + "ready" signal (idempotent) ----
try {
  if (!window.DeckLoading) window.DeckLoading = DeckLoading;
  window.dispatchEvent(new CustomEvent('deckloading:ready', { detail: { at: 'module-load' } }));
} catch {}
