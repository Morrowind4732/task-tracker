// modules/deck.loading.js
// Deck loader UI + parsing + Scryfall bulk art fetch + drawable library.
// Public API:
//   DeckLoading.init({ onLoaded(deck, commander, commanderImageUrl) })
//   DeckLoading.open()
//   DeckLoading.drawOne() -> {name, imageUrl} | null
//   DeckLoading.drawOneToHand(deckEl?) -> boolean

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
  o.querySelector('#btnLoadDeck').onclick = async () => {
    const ta = o.querySelector('#deckText');
    const src = (ta.value||'').trim() || DEFAULT_LIST;

    const { deck, commander } = parseDecklist(src);
    console.log('[DeckLoad] parsed', { deckCount: deck.length, commander, deck });

    // fetch images + meta
    const [cmdMeta, deckMap] = await Promise.all([
      fetchCommanderImage(commander),
      fetchDeckImages(deck)
    ]);

    // build drawable library with metadata (art, types, oracle, untap flag)
    // PLUS pre-parsed baseTypes / baseAbilities (strict, no conditionals)
    const lib = deck.map(name => {
      const meta = deckMap.get(normName(name));

      if (meta) {
        

        const cardEntry = {
  name,

  // FRONT visual defaults
  imageUrl: meta.img || '',
  typeLine: meta.typeLine || '',
  oracle:   meta.oracle || '',

  // stats (creatures, planeswalkers, etc.)
  power:     meta.power || '',
  toughness: meta.toughness || '',
  loyalty:   meta.loyalty || '',
  backLoyalty: meta.backLoyalty || '',

  untapsDuringUntapStep: !!meta.untapsDuringUntapStep,


  // what we consider "safe auto badges" for CURRENT face on spawn
  baseTypes:     meta.frontBaseTypes     || [],
  baseAbilities: meta.frontBaseAbilities || [],

  // --- NEW: stash both faces for later flip logic ---
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



        // 🔍 DEBUG PER CARD (has meta)
        console.log('%c[DeckLoad:card built ✅]', 'color:#6cf',
          {
            name: cardEntry.name,
            imageUrl: cardEntry.imageUrl,
            typeLine: cardEntry.typeLine,
            oracle: cardEntry.oracle,
            baseTypes: cardEntry.baseTypes,
            baseAbilities: cardEntry.baseAbilities,
            untapsDuringUntapStep: cardEntry.untapsDuringUntapStep
          }
        );

        return cardEntry;
      }

      // fallback entry; downstream can hydrate via name later
      const fallbackEntry = {
        name,
        imageUrl: '',
        typeLine: '',
        oracle: '',
        untapsDuringUntapStep: true,

        baseTypes: [],
        baseAbilities: []
      };

      // 🔍 DEBUG PER CARD (NO META FOUND)
      console.log('%c[DeckLoad:card built ❌META]', 'color:#f66;font-weight:bold',
        {
          name: fallbackEntry.name,
          imageUrl: fallbackEntry.imageUrl,
          typeLine: fallbackEntry.typeLine,
          oracle: fallbackEntry.oracle,
          baseTypes: fallbackEntry.baseTypes,
          baseAbilities: fallbackEntry.baseAbilities,
          untapsDuringUntapStep: fallbackEntry.untapsDuringUntapStep
        }
      );

      return fallbackEntry;
    });

    shuffleInPlace(lib);

    // --- NEW: enrich commanderMeta so it looks like every other card entry ---
    // commanderMeta we got back from fetchCommanderImage(...) only has:
    //   { img, typeLine, oracle, power, toughness }
    // but the rest of the deck cards also have parsed:
    //   baseTypes[], baseAbilities[]
    //
    // We run the exact same parser we already use for regular cards (extractConcreteInnate)
    // so commander badges (Flying, etc.) exist on spawn.
    // Commander meta is already full-shape from fetchCommanderImage() now.
// We just alias the "current face" fields to what Badges expects on spawn.
const enrichedCommanderMeta = {
  ...cmdMeta,

  // give commander a name field like normal cards
  name: commander,

  // normalize naming to match regular cardEntry:
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

  // what we consider "safe auto badges" for CURRENT face on spawn
  baseTypes:     cmdMeta.frontBaseTypes     || [],
  baseAbilities: cmdMeta.frontBaseAbilities || [],

  // stash both faces
  frontBaseTypes:      cmdMeta.frontBaseTypes     || [],
  frontBaseAbilities:  cmdMeta.frontBaseAbilities || [],
  backBaseTypes:       cmdMeta.backBaseTypes      || [],
  backBaseAbilities:   cmdMeta.backBaseAbilities  || [],

  // Commander-specific extras
  power: cmdMeta.power || '',
  toughness: cmdMeta.toughness || '',
  loyalty: cmdMeta.loyalty || '',
  backLoyalty: cmdMeta.backLoyalty || '',

  currentSide: 'front'

};


Object.assign(state, {
  deck: [...deck],
  library: lib,
  commander,
  commanderMeta: enrichedCommanderMeta
});


    // 🔍 DEBUG FINAL LIB STATE
    console.log('%c[DeckLoad:FINAL LIB]', 'background:#222;color:#0f0;padding:4px 6px;border-radius:4px;', {
      commander: state.commander,
      commanderMeta: state.commanderMeta,
      libraryCount: state.library.length,
      libraryFirstFew: state.library.slice(0,10), // sample preview
      fullLibrary: state.library                  // full dump for scroll
    });

    hide();

    // notify Zones so it can: mark deck present, show commander label,
    // spawn commander image, send deck-visual
    // Args: (deckNames, commanderName, commanderImageUrl, commanderMeta)
    onLoadedCb?.(state.deck, state.commander, state.commanderMeta.img, state.commanderMeta);

  };
}


  function drawOne(){
    const c = state.library.shift() || null;
    return c || null;
  }

  function drawOneToHand(deckEl){
    try{
      const card = drawOne();
      if (!card) return false;
      // Defer to hand.js – it will fetch art if imageUrl is empty
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

  return {
    init, open,
    drawOne, drawOneToHand,

    // ⬇️ NEW: read-only helpers for overlays/UI
    enumerate: enumerateDeck,
    count: deckCount,

    get state(){ return state; }
  };
})();
