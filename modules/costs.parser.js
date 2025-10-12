// Minimal adapter so table.html runs NOW.
// Later: paste in your CardFX parsing & canPay code here.

export function parseOracle(oracleText){
  const text = (oracleText||'').trim();
  const abilities = [];

  // Activated: "COST: effect"
  text.split(/\n+/).forEach(line=>{
    const i = line.indexOf(':');
    if (i>0){
      const costRaw = line.slice(0,i).trim();
      const effectRaw = line.slice(i+1).trim();
      abilities.push({
        kind:'activated',
        title:`${costRaw}: ${effectRaw}`,
        costRaw, effectRaw
      });
    }
  });

  return { abilities, raw: text };
}

// Super simple “can cast from hand” gate for tinting.
// Replace with your real tally+canPay logic.
export function handCastable(card, state){
  // If it has a mana_cost, require at least that many symbols total in pool (VERY rough).
  const cost = (card.mana_cost||'').match(/\{[^}]+\}/g)||[];
  const need = cost.length;
  const have = Object.values(state.pool).reduce((a,b)=>a+b,0);
  const isLand = /Land/i.test(card.type_line||'');
  return isLand || have >= need;
}

// Extract “Add {R/G/etc}” → returns {R:1, G:1, …}
export function extractAddMana(effectRaw){
  const out = {W:0,U:0,B:0,R:0,G:0,C:0};
  const m = effectRaw.match(/add\s+((?:\{[^}]+\}\s*)+)/i);
  if (!m) return out;
  const syms = (m[1].match(/\{([^}]+)\}/g)||[]).map(s=>s.slice(1,-1).toUpperCase());
  for (const s of syms){
    if (['W','U','B','R','G','C'].includes(s)) out[s] = (out[s]||0)+1;
  }
  return out;
}

// Stub that always “passes”; swap in your full canActivate later.
export function enforceActivation(ability, state){
  return { ok:true };
}
