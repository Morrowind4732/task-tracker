// modules/deck.load.js
// DeckAnimator — full-screen loading overlay with animated fan, flip, double shuffle, and slide to deck zone
// Exposes: DeckAnimator.startSilhouette(), DeckAnimator.addCardToFan(card), DeckAnimator.finalizeDeckAnimation(deck), DeckAnimator.skip(), DeckAnimator.hide()

const DeckAnimator = (() => {
  const OVERLAY_ID = 'deckLoadingOverlay';
  const FAN_ID = 'deckFanPreview';
  const LABEL_ID = 'deckLoadingLabel';
  const SKIP_ID = 'deckSkipBtn';
  const BACK_IMG = 'https://i.imgur.com/LdOBU1I.jpeg';
// keep cards centered in fanWrap while we offset around the center
const CENTER = 'translate(-50%, -50%) ';

  let overlay, fanWrap, label, skipBtn;
  let skipTriggered = false;
  let fanCards = [];

  function createOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(13,20,36,0.92)',
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
      transition: 'opacity 0.6s ease'
    });

    label = document.createElement('div');
    label.id = LABEL_ID;
    label.textContent = 'Loading Deck...';
    Object.assign(label.style, {
      fontSize: '22px', color: 'white', marginBottom: '24px', fontWeight: 'bold'
    });

    fanWrap = document.createElement('div');
    fanWrap.id = FAN_ID;
    Object.assign(fanWrap.style, {
      position: 'relative',
      width: '600px',
      height: '400px',
      pointerEvents: 'none',
      transition: 'transform 0.7s ease'
    });

    skipBtn = document.createElement('button');
    skipBtn.id = SKIP_ID;
    skipBtn.textContent = 'Skip';
    Object.assign(skipBtn.style, {
      position: 'absolute',
      top: '20px', right: '20px',
      fontSize: '12px',
      padding: '4px 10px',
      border: '1px solid #aaa',
      borderRadius: '4px',
      background: 'transparent',
      color: 'white',
      cursor: 'pointer',
      opacity: 0.6
    });
    skipBtn.onclick = skip;

    overlay.appendChild(label);
    overlay.appendChild(fanWrap);
    overlay.appendChild(skipBtn);
    document.body.appendChild(overlay);
  }

  function startSilhouette() {
    skipTriggered = false;
    fanCards = [];
    createOverlay();
    fanWrap.innerHTML = '';
  }

  function addCardToFan(card) {
    if (skipTriggered) return;
    fanCards.push(card);
    const total = fanCards.length;
    fanWrap.innerHTML = '';

    fanCards.forEach((c, i) => {
      const index = i;
      const angle = -45 + (90 * index / Math.max(total - 1, 1));
      const img = document.createElement('img');
      img.src = c.img;
      Object.assign(img.style, {
        width: '130px',
        height: '180px',
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: `translate(-50%, -50%) rotate(${angle}deg) scale(0.9)`,
        transition: 'transform 0.4s ease, opacity 0.3s ease',
        zIndex: index
      });
      fanWrap.appendChild(img);
    });
  }

  async function finalizeDeckAnimation(deck) {
    if (skipTriggered) return;
    await delay(400);
    await collapseAndFlip();
    await delay(400);
	await flingThenShuffle();
    
    await delay(500);
    await slideToDeck();
    hide();
  }

  async function collapseAndFlip() {
    const imgs = fanWrap.querySelectorAll('img');
    imgs.forEach((img) => {
      img.style.transform = `translate(-50%, -50%) rotate(0deg) scale(0.6)`;
    });
    await delay(500);
    imgs.forEach(img => {
      img.src = BACK_IMG;
      img.style.transform += ' rotateY(180deg)';
    });
  }

  // Deterministic “split → fling B into A → compact → quick shuffle”
// Ensures we DON’T proceed until EVERY fling has finished.
// Deterministic “split → fling B into A (top/under) → compact → quick shuffle”
// Guarantees we don’t proceed until EVERY fling has finished.
async function flingThenShuffle(){
  const shells = Array.from(fanWrap.querySelectorAll('img'));
  if (!shells.length) return;

  // --- helpers (scoped here to avoid leaking) ---
  function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }
  function transitionTo(el, transform, dur=280, easing='cubic-bezier(0.22,0.61,0.36,1)'){
    return new Promise(resolve=>{
      const done = () => { el.removeEventListener('transitionend', done); resolve(); };
      el.addEventListener('transitionend', done, { once:true });
      el.style.transition = `transform ${dur}ms ${easing}`;
      requestAnimationFrame(()=>{ el.style.transform = transform; });
      // safety in case transitionend doesn’t fire
      setTimeout(done, dur + 60);
    });
  }

  // --- layout constants (centered around x=0,y=0) ---
  const baseScale   = 0.6;
  const leftX       = -58;
  const rightX      =  58;
  const stackJitter =  3;
  const stackTiltA  = -3;
  const stackTiltB  =  3;

// ⏱ fling cadence (gap between B→A throws)
const FLING_GAP_MS = 12; // 8–14 feels “casino”; 12 is crisp without looking jittery

// 🚀 single-card travel speeds
const FLING_TOP_MS            = 160; // top insertion
const FLING_UNDER_APPROACH_MS = 110; // under: first hop (high z)
const FLING_UNDER_SETTLE_MS   =  90; // under: slide in after dropping z
const FLING_EASE              = 'cubic-bezier(0.15,0.8,0.2,1)'; // snappy in, quick settle

  // Split into two piles by index parity to mimic a real split
  const pileA = shells.filter((_,i)=> i % 2 === 0);
  const pileB = shells.filter((_,i)=> i % 2 === 1);

  // 1) Place piles A (left) and B (right)
  pileA.forEach((el, i)=>{ el.style.zIndex = String(2000 + i); });
  pileB.forEach((el, i)=>{ el.style.zIndex = String(2200 + i); });

  // Move both piles into position (in parallel)
  await Promise.all([
    ...pileA.map((el,i)=>{
      const jx = (Math.random()*stackJitter - stackJitter/2);
      const jy = (Math.random()*stackJitter - stackJitter/2);
      return transitionTo(el, `${CENTER}translate(${leftX + jx}px, ${jy}px) rotate(${stackTiltA}deg) scale(${baseScale})`, 260);

    }),
    ...pileB.map((el,i)=>{
      const jx = (Math.random()*stackJitter - stackJitter/2);
      const jy = (Math.random()*stackJitter - stackJitter/2);
      return transitionTo(el, `${CENTER}translate(${rightX + jx}px, ${jy}px) rotate(${stackTiltB}deg) scale(${baseScale})`, 260);

    })
  ]);

  // 2) Fling a few sequentially, then STORM the rest in parallel
const MAX_SEQUENTIAL_FLINGS = 5;  // 👈 show first N flings one-by-one
const STORM_STAGGER_MS      = 0;  // 👈 micro-stagger for storm (0 = all at once)

const bRev   = [...pileB].reverse(); // top of B first
const firstN = bRev.slice(0, MAX_SEQUENTIAL_FLINGS);
const rest   = bRev.slice(MAX_SEQUENTIAL_FLINGS);

let zTop = 3200; // z for "top insertions"

// helper that performs ONE fling with your top/under logic
const flingOne = async (el) => {
  const goTop = Math.random() < 0.55; // ~55% on top, rest under
  const jx1 = (Math.random()*stackJitter - stackJitter/2);
  const jy1 = (Math.random()*stackJitter - stackJitter/2);

  if (goTop){
    el.style.zIndex = String(zTop++); // cross above for visibility
    await transitionTo(
      el,
      `${CENTER}translate(${leftX + jx1}px, ${jy1}px) rotate(${stackTiltA}deg) scale(${baseScale})`
,
      FLING_TOP_MS,
      FLING_EASE
    );
  } else {
    // approach
    el.style.zIndex = String(zTop++);
    await transitionTo(
      el,
      `${CENTER}translate(${leftX - 16 + jx1}px, ${jy1}px) rotate(${stackTiltA}deg) scale(${baseScale})`
,
      FLING_UNDER_APPROACH_MS,
      FLING_EASE
    );
    // drop under + settle
    const lowZ = 900 + Math.floor(Math.random()*80);
    el.style.zIndex = String(lowZ);
    const jx2 = (Math.random()*stackJitter - stackJitter/2);
    const jy2 = (Math.random()*stackJitter - stackJitter/2);
    await transitionTo(
      el,
      `${CENTER}translate(${leftX + jx2}px, ${jy2}px) rotate(${stackTiltA}deg) scale(${baseScale})`,
      FLING_UNDER_SETTLE_MS,
      FLING_EASE
    );
  }
};

// 2A) first N flings sequentially (readable)
for (const el of firstN){
  await flingOne(el);
  await wait(FLING_GAP_MS);
}

// 2B) storm the rest in parallel (optionally micro-staggered)
await Promise.all(rest.map((el, idx) => (async () => {
  if (STORM_STAGGER_MS > 0) await wait(idx * STORM_STAGGER_MS);
  await flingOne(el);
})()));


  // 3) Compact into a single tidy deck at center (x=0,y=0)
  await Promise.all(shells.map((el,i)=>{
    el.style.zIndex = String(1500 + i); // normalize
    return transitionTo(el, `${CENTER}translate(0px, 0px) rotate(0deg) scale(${baseScale})`
, 260);
  }));

  // 4) Wide apart → merge back together (reads like a hard shuffle)
function shuffleInPlace(a){
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SPREAD_X = 160;  // how far left/right the halves travel (bigger = more dramatic)
const SPREAD_Y = 28;   // slight vertical banding in each half
const TILT     = 6;    // visual tilt while spread

// 4A) blow the deck WIDE apart (alternate left/right), small vertical variance
await Promise.all(shells.map((el, i) => {
  // dir: even → right, odd → left (or flip if you prefer)
  const dir = (i % 2 === 0) ? 1 : -1;
  const row = (i % 3) - 1; // -1,0,1 vertical banding
  el.style.zIndex = String(1700 + i);
  return transitionTo(
    el,
    `${CENTER}translate(${dir * SPREAD_X}px, ${row * SPREAD_Y}px) rotate(${dir * TILT}deg) scale(${baseScale})`,
    230,
    'ease-in'
  );
}));

await wait(90);

// 4B) merge back to dead-center, but randomize order & z so it *looks* shuffled
const merged = shuffleInPlace([...shells]);
await Promise.all(merged.map((el, i) => {
  // give the first few a slightly longer ease so the collapse feels organic
  const dur = 240 + Math.floor(Math.random() * 70);
  el.style.zIndex = String(1800 + i); // new “random” stack order on merge
  return transitionTo(
    el,
    `${CENTER}translate(0px, 0px) rotate(0deg) scale(${baseScale})`,
    dur,
    'cubic-bezier(0.2,0.7,0.2,1)'
  );
}));


  // Final z-index cleanup
  shells.forEach((el, i)=>{ el.style.zIndex = String(1000 + i); });
}



  async function slideToDeck() {
  const deckZone = document.getElementById('deckZone');
  if (!deckZone) return;

  const dz = deckZone.getBoundingClientRect();
  const cards = fanWrap.querySelectorAll('img');

  cards.forEach((img, i) => {
    const rect = img.getBoundingClientRect();
    const dx = dz.left + dz.width/2 - (rect.left + rect.width/2);
    const dy = dz.top + dz.height/2 - (rect.top + rect.height/2);

    img.style.transition = 'transform 0.6s ease';
    img.style.transform = `translate(${dx}px, ${dy}px) scale(0.2) rotate(0deg)`;
    img.style.zIndex = String(2000 + i);
  });

  await delay(700);
}

  function skip() {
    skipTriggered = true;
    hide();
    renderHand();
  }

  function hide() {
    if (overlay) {
      overlay.style.opacity = 0;
      setTimeout(() => overlay?.remove(), 600);
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return {
    startSilhouette,
    addCardToFan,
    finalizeDeckAnimation,
    skip,
    hide
  };
})();

window.DeckAnimator = DeckAnimator;
