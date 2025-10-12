// Effect executor scaffold. Expand with real verbs (Draw, Create token, etc.)

export async function resolve(ability, ctx){
  // Very simple demo: if effect contains "draw", draw 1
  const text = (ability.effectRaw || ability.title || '').toLowerCase();
  if (/draw/i.test(text)){
    draw(ctx, 1);
  }
  // Add more verb handlers here (create token, add mana, gain life...)
}

function draw(ctx, n){
  for (let i=0;i<n;i++){
    const c = ctx.state.library.shift(); if (!c) break;
    ctx.state.hand.push(c);
  }
  ctx.log(`Effect: drew ${n}.`);
}
