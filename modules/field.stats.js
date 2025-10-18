// ==============================================
// FILE: modules/field.stats.js
// Seat-scoped battlefield/hand summary for MTG
// - Creature types tally
// - Tapped vs Untapped creatures
// - Mana estimate (W/U/B/R/G/C) from untapped sources
// - Cards in hand
// Signals it understands (non-strict; all optional):
//   .card[data-seat="1..N"]
//   .card[data-zone="table" | "hand"]  (if absent, we infer by location)
//   .card[data-tapped="1"] OR .tapped class OR transform rotate
//   .card[data-types="Artifact Creature — Zombie"] (space-/dash-separated)
//   .card[data-adds="{R}{G}"]  // explicit mana producer hint
//   .type-line, .rules (text fallback for parsing "Add {X}")
// Notes:
// - Creature type detection uses a well-known list of types.
// - Mana estimate is conservative and only counts untapped, obvious sources.
// ==============================================

const KNOWN_CREATURE_TYPES = new Set([
  "Advisor","Aetherborn","Ally","Angel","Antelope","Ape","Archer","Archon","Army","Artificer","Assassin","Assembly-Worker","Atog","Aurochs","Avatar","Azra",
  "Badger","Balloon","Barbarian","Bard","Basilisk","Bat","Bear","Beast","Beeble","Beholder","Berserker","Bird","Blinkmoth","Boar","Bringer","Brushwagg",
  "Camarid","Camel","Caribou","Carrier","Cat","Centaur","Cephalid","Chicken","Child","Chimera","Citizen","Cleric","Cockatrice","Construct","Coward","Crab",
  "Crocodile","Cyclops","Dauthi","Demigod","Demon","Deserter","Devil","Dinosaur","Djinn","Dragon","Drake","Dreadnought","Drone","Druid","Dryad","Dwarf",
  "Efreet","Egg","Elder","Eldrazi","Elemental","Elephant","Elf","Elk","Eye","Faerie","Ferret","Fish","Flagbearer","Fox","Fractal","Frog","Fungus","Gamer",
  "Gargoyle","Germ","Giant","Gith","Gnoll","Gnome","Goat","Goblin","God","Golem","Gorgon","Graveborn","Gremlin","Griffin","Hag","Halfling","Hamster",
  "Harpy","Hellion","Hippo","Hippogriff","Homarid","Homunculus","Horror","Horse","Human","Hydra","Hyena","Illusion","Imp","Incarnation","Inkling","Insect",
  "Jackal","Jellyfish","Juggernaut","Kavu","Kirin","Kithkin","Knight","Kobold","Kor","Kraken","Lamia","Lammasu","Leech","Leviathan","Lhurgoyf","Licid",
  "Lizard","Manticore","Masticore","Mercenary","Merfolk","Metathran","Minion","Minotaur","Mite","Mole","Monger","Mongoose","Monk","Monkey","Moonfolk","Mouse",
  "Mutant","Myr","Mystic","Naga","Nautilus","Nephilim","Nightmare","Nightstalker","Ninja","Noble","Noggle","Nomad","Nymph","Octopus","Ogre","Ooze","Orb",
  "Orc","Orgg","Otter","Ouphe","Ox","Oyster","Pangolin","Peasant","Pegasus","Pentavite","Pest","Phelddagrif","Phoenix","Phyrexian","Pilot","Pincher","Pirate",
  "Plant","Praetor","Prism","Processor","Rabbit","Raccoon","Ranger","Rat","Rebel","Reflection","Rhino","Rigger","Rogue","Sable","Salamander","Samurai",
  "Sand","Saproling","Satyr","Scarecrow","Scientist","Scion","Scorpion","Scout","Serf","Serpent","Servo","Shade","Shaman","Shapeshifter","Shark","Sheep",
  "Siren","Skeleton","Slith","Sliver","Slug","Snail","Snake","Soldier","Soltari","Spellshaper","Sphinx","Spider","Spike","Spirit","Splinter","Sponge",
  "Squid","Squirrel","Starfish","Surrakar","Survivor","Tentacle","Tetravite","Thalakos","Thopter","Thrull","Tiefling","Treefolk","Trilobite","Triskelavite",
  "Troll","Turtle","Unicorn","Vampire","Vedalken","Viashino","Volver","Wall","Warlock","Warrior","Weird","Werewolf","Whale","Wizard","Wolf","Wolverine",
  "Wombat","Worm","Wraith","Wurm","Yeti","Zombie","Zubera"
]);

const MANA_SYMBOLS = ["W","U","B","R","G","C"];

function qs(s, r=document){ return r.querySelector(s); }
function qsa(s, r=document){ return Array.from(r.querySelectorAll(s)); }
function isTapped(card){
  if (!card) return false;
  const d = card.dataset || {};
  if (d.tapped === "1" || d.tapped === "true") return true;
  if (card.classList.contains('tapped')) return true;
  const t = (card.style.transform || "");
  return /rotate\(/i.test(t);
}

function getZone(el){
  // Prefer explicit dataset
  const z = el.dataset?.zone;
  if (z) return z;
  // Heuristic fallback by container ancestry
  const p = el.closest?.('[data-zone]'); if (p) return p.dataset.zone;
  // If inside a hand container
  if (el.closest?.('.hand, #hand, [data-hand]')) return 'hand';
  return 'table';
}

function parseTypes(card){
  // 1) ogTypes JSON (exact creature subtypes)
  try{
    if (card.dataset?.ogTypes){
      const arr = JSON.parse(card.dataset.ogTypes);
      if (Array.isArray(arr) && arr.length){
        return arr.map(cap).filter(t=>KNOWN_CREATURE_TYPES.has(t));
      }
    }
  }catch{}
  // 2) data-types or your data-type_line
  let raw = card.getAttribute('data-types') || card.dataset?.types || card.dataset?.type_line || '';
  // 3) fallback: visible type line text
  if (!raw){
    const tl = card.querySelector?.('.type-line')?.textContent || '';
    raw = tl;
  }
  // Normalize separators
  raw = raw.replace(/—/g,' ').replace(/-/g,' ');
  const parts = raw.split(/[\s/]+/).filter(Boolean);
  // Only keep recognized creature types
  return parts.filter(p => KNOWN_CREATURE_TYPES.has(cap(p)));
}

function cap(s){ return s ? s[0].toUpperCase()+s.slice(1).toLowerCase() : s; }

function isType(card, typeWord){
  const t =
    (card.getAttribute('data-types') || card.dataset?.types || // our hint (if present)
     card.dataset?.type_line ||                                // your stamped type line
     ''
    ).toLowerCase();
  if (t) return t.includes(typeWord.toLowerCase());
  const tl = card.querySelector?.('.type-line')?.textContent?.toLowerCase() || '';
  return tl.includes(typeWord.toLowerCase());
}

function parseAddsManaFrom(card){
  // Priority 1: explicit hint like data-adds="{R}{G}"
  const adds = card.getAttribute('data-adds') || card.dataset?.adds || '';
  const bucket = { W:0,U:0,B:0,R:0,G:0,C:0 };

  const eatPips = (text)=>{
    const m = text.match(/\{[WUBRGC]\}/g);
    if (!m) return;
    m.forEach(sym=>{
      const k = sym.replace(/[{}]/g,'');
      if (bucket[k] != null) bucket[k] += 1;
    });
  };

  if (adds) eatPips(adds);

  // Priority 2: fallback parse visible rules text like "Add {G}."
if (!adds){
    const rulesTxt = (
      card.querySelector?.('.rules')?.textContent ||
      card.dataset?.oracle || ''   // your stamped oracle text
    ).toUpperCase();
    eatPips(rulesTxt);
  }

  // Priority 3: basic lands by name/type-line heuristic
  // These produce exactly one colored mana.
  const name = (card.querySelector?.('.name')?.textContent || card.getAttribute('data-name') || '').toLowerCase();
  if (!Object.values(bucket).some(v=>v>0)){ // only if we didn't find explicit pips
    if (isType(card,'land')){
      if (/plains/.test(name)) bucket.W += 1;
      else if (/island/.test(name)) bucket.U += 1;
      else if (/swamp/.test(name)) bucket.B += 1;
      else if (/mountain/.test(name)) bucket.R += 1;
      else if (/forest/.test(name)) bucket.G += 1;
      else bucket.C += 1; // colorless land default
    }
  }
  return bucket;
}

function sumManaBuckets(a,b){
  const res = { W:0,U:0,B:0,R:0,G:0,C:0 };
  MANA_SYMBOLS.forEach(k => res[k] = (a[k]||0) + (b[k]||0));
  return res;
}

function analyzeSeat(seat){
  const seatStr = String(seat);
  const cards = qsa('.card').filter(el => String(el.dataset?.owner||'') === seatStr);
  const table = cards.filter(c => getZone(c) === 'table');
  const hand  = cards.filter(c => getZone(c) === 'hand');

  // Creature stats
  const creatures = table.filter(c => isType(c,'creature'));
  const tappedCreatures   = creatures.filter(isTapped);
  const untappedCreatures = creatures.filter(c => !isTapped(c));

  // Types tally (creatures only)
  const typeCounts = Object.create(null);
  creatures.forEach(c=>{
    const types = parseTypes(c);
    types.forEach(t=>{
      if (!typeCounts[t]) typeCounts[t] = 0;
      typeCounts[t] += 1;
    });
  });

  // Theoretical mana from UNTAPPED sources (land or explicit "adds")
  const untappedManaSources = table.filter(c=>{
    if (isTapped(c)) return false;
    // obvious sources: lands or cards with {X} in rules or data-adds
    if (isType(c, 'land')) return true;
    const adds = c.getAttribute('data-adds') || c.dataset?.adds || '';
    const rulesTxt = (c.querySelector?.('.rules')?.textContent || '').toUpperCase();
    return /\{[WUBRGC]\}/.test(adds || rulesTxt);
  });
  let manaBucket = { W:0,U:0,B:0,R:0,G:0,C:0 };
  untappedManaSources.forEach(c=>{
    manaBucket = sumManaBuckets(manaBucket, parseAddsManaFrom(c));
  });

  return {
    seat,
    counts: {
      hand: hand.length,
      table: table.length,
      creatures: creatures.length,
      tappedCreatures: tappedCreatures.length,
      untappedCreatures: untappedCreatures.length
    },
    types: typeCounts,      // { Zombie: 5, Elf: 2, ... }
    mana: manaBucket        // { W:2, U:0, ... }
  };
}

function toRows(obj){
  return Object.entries(obj).sort((a,b)=> b[1]-a[1]).map(([k,v])=>`<div class="row" style="justify-content:space-between"><div>${k}</div><div><strong>${v}</strong></div></div>`).join('');
}

function manaInline(bucket){
  return ['W','U','B','R','G','C']
    .filter(k => (bucket[k]||0) > 0)
    .map(k => `<span class="pill">{${k}} × <strong>${bucket[k]}</strong></span>`)
    .join(' ');
}

function playerCount(){
  const n = Number(qs('#playerCount')?.value || 2);
  return Math.max(1, Math.min(6, n)); // allow future expansion
}

const FieldStats = {
  analyzeSeat,

  mount(container){
    container.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:4px">
        <div style="font-weight:800">Field Stats</div>
        <div>
          <label class="pill">Player 
            <select id="fsSeat" style="margin-left:6px">
              ${Array.from({length:playerCount()}, (_,i)=>`<option value="${i+1}">P${i+1}</option>`).join('')}
            </select>
          </label>
          <button class="pill" id="fsRefresh">Refresh</button>
        </div>
      </div>
      <div id="fsPanel" style="margin-top:8px"></div>
    `;

    const sel = container.querySelector('#fsSeat');
    const panel = container.querySelector('#fsPanel');
    const refresh = ()=> {
      const seat = Number(sel.value);
      const data = analyzeSeat(seat);
      panel.innerHTML = `
        <div class="row" style="gap:10px; flex-wrap:wrap">
          <span class="pill">Table: <strong>${data.counts.table}</strong></span>
          <span class="pill">Creatures: <strong>${data.counts.creatures}</strong></span>
          <span class="pill">Untapped: <strong>${data.counts.untappedCreatures}</strong></span>
          <span class="pill">Tapped: <strong>${data.counts.tappedCreatures}</strong></span>
          <span class="pill">Hand: <strong>${data.counts.hand}</strong></span>
        </div>

        <div style="margin-top:10px">
          <div style="font-weight:800;margin-bottom:6px">Creatures by Type</div>
          ${Object.keys(data.types).length ? toRows(data.types) : '<div style="opacity:.7">No creatures on the battlefield.</div>'}
        </div>

        <div style="margin-top:10px">
          <div style="font-weight:800;margin-bottom:6px">Theoretical Available Mana (untapped sources)</div>
          <div class="row" style="gap:8px; flex-wrap:wrap">${manaInline(data.mana) || '<span style="opacity:.7">No obvious sources.</span>'}</div>
          <div style="opacity:.6; font-size:12px; margin-top:6px">Counts basic lands by name/type and parses visible “Add {X}” pips or <code>data-adds</code> if present.</div>
        </div>
      `;
    };

    container.querySelector('#fsRefresh')?.addEventListener('click', refresh);
    sel.addEventListener('change', refresh);

    // Initial render
    refresh();
  }
};

export default FieldStats;
