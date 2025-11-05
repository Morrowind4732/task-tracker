// modules/camera.js
// Cross-platform camera for the felt table (mouse + touch)
// Public API:
//   Camera.mount({ viewport, world, minScale?, maxScale?, wheelStep? })
//   Camera.state  -> { x, y, scale }
//   Camera.set({ x?, y?, scale? })
//   Camera.panBy(dx, dy)
//   Camera.zoomAt(factor, cx, cy) // factor>1 zoom in, <1 zoom out centered at screen (cx,cy)

export const Camera = (() => {
  const state = { x: 0, y: 0, scale: 1 };
let VP = null, W = null;
let minS = 0.4, maxS = 2.5, wheelStep = 0.08; // gentler wheel zoom by default

// Tunables
const TOUCH_PAN_DAMP  = 1.0;  // 1-finger drag pan multiplier
const PINCH_PAN_DAMP  = 0.10; // 2-finger pinch pan multiplier (10%)


  // helpers
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const apply = () => { if (W) W.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`; };

  // keep world point under screen point (cx,cy) stable while scaling
  function zoomAt(factor, cx, cy){
    const prev = state.scale;
    const next = clamp(prev * factor, minS, maxS);
    if (next === prev) return;

    // Solve for x',y' so (cx - x)/s = (cx - x')/s'
    state.x = cx - (cx - state.x) * (next / prev);
    state.y = cy - (cy - state.y) * (next / prev);
    state.scale = next;
    apply();
    //console.log('[CAM] zoomAt', { factor, cx, cy, scale: state.scale });
  }

  function panBy(dx, dy){
    state.x += dx; state.y += dy;
    apply();
  }

  // Mouse handlers (drag to pan, wheel to zoom at cursor)
  function mountMouse(){
  let dragging = false, sx = 0, sy = 0;

  // Tunable: lower = less sensitive mouse pan
  const mousePanDamp = 1.0; // 0.35–0.45 feels good; was 1.0 effectively

  const down = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.table-card, .ui-block, .zone')) return;
    dragging = true; VP.style.cursor = 'grabbing';
    sx = e.clientX; sy = e.clientY;
  };
  const move = (e) => {
    if (!dragging) return;
    const dx = (e.clientX - sx) * mousePanDamp;
    const dy = (e.clientY - sy) * mousePanDamp;
    panBy(dx, dy);
    sx = e.clientX; sy = e.clientY;
  };
  const up = () => { dragging = false; VP.style.cursor = 'grab'; };

  VP.addEventListener('mousedown', down);
  window.addEventListener('mousemove', move, { passive: true });
  window.addEventListener('mouseup', up);
}


  // Wheel zoom (cursor-centric)
  function mountWheel(){
    VP.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return; // let browser gesture zoom win if user wants it
      e.preventDefault();
      const rect = VP.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const dir = e.deltaY > 0 ? -1 : 1;
      const factor = 1 + (wheelStep * dir);
      zoomAt(factor, cx, cy);
    }, { passive: false });
  }

  // Touch: one-finger pan, two-finger pinch-zoom + pan
  function mountTouch(){
  let tStartDist = 0, tStartScale = 1;
  let startMid = { x: 0, y: 0 };   // midpoint at gesture start
  let lastMid  = { x: 0, y: 0 };   // midpoint at previous frame (for per-frame delta)
  let startPos = { x: 0, y: 0 };   // single-finger start
  let active = false;

  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const mid  = (a, b, rect) => ({
    x: ((a.clientX + b.clientX) / 2) - rect.left,
    y: ((a.clientY + b.clientY) / 2) - rect.top
  });

  VP.addEventListener('touchstart', (e) => {
    if (e.target.closest('.table-card, .ui-block, .zone')) return;
    if (e.touches.length === 1){
      active = true;
      tStartDist = 0; // ensure we’re in single-finger mode
      startPos.x = e.touches[0].clientX;
      startPos.y = e.touches[0].clientY;
    } else if (e.touches.length === 2){
      active = true;
      const rect = VP.getBoundingClientRect();
      tStartDist  = dist(e.touches[0], e.touches[1]);
      tStartScale = state.scale;
      startMid    = mid(e.touches[0], e.touches[1], rect);
      lastMid     = { ...startMid }; // initialize per-frame reference
    }
  }, { passive: true });

  VP.addEventListener('touchmove', (e) => {
    if (!active) return;

    if (e.touches.length === 1 && tStartDist === 0){
      // single-finger pan (full strength or tweak via TOUCH_PAN_DAMP)
      const dx = (e.touches[0].clientX - startPos.x) * TOUCH_PAN_DAMP;
      const dy = (e.touches[0].clientY - startPos.y) * TOUCH_PAN_DAMP;
      panBy(dx, dy);
      startPos.x = e.touches[0].clientX;
      startPos.y = e.touches[0].clientY;
    } else if (e.touches.length === 2){
      e.preventDefault(); // we’re handling pinch
      const d = dist(e.touches[0], e.touches[1]);
      if (tStartDist <= 0) return;

      const rect = VP.getBoundingClientRect();
      const mNow = mid(e.touches[0], e.touches[1], rect);

      // desired scale
      const raw  = (d / tStartDist) * tStartScale;
      const prev = state.scale;
      const next = clamp(raw, minS, maxS);

      // anchor zoom at the CURRENT midpoint (maps-like)
      state.x = mNow.x - (mNow.x - state.x) * (next / prev);
      state.y = mNow.y - (mNow.y - state.y) * (next / prev);
      state.scale = next;

      // pan by midpoint movement (per-frame delta), damped
      const dxMid = (mNow.x - lastMid.x) * PINCH_PAN_DAMP;
      const dyMid = (mNow.y - lastMid.y) * PINCH_PAN_DAMP;
      state.x += dxMid;
      state.y += dyMid;
      lastMid = mNow;

      apply();
    }
  }, { passive: false });

  const endAll = () => { active = false; tStartDist = 0; };
  VP.addEventListener('touchend', endAll);
  VP.addEventListener('touchcancel', endAll);
}


  // Center the world so the midline & zone grids are on-screen at startup
function centerOnMidline(){
  if (!VP || !W) return;
  const vpW = VP.clientWidth, vpH = VP.clientHeight;
  const wW  = W.scrollWidth  || W.offsetWidth;
  const wH  = W.scrollHeight || W.offsetHeight;

  // We want the geometric center of #world (which holds the 50% midline content)
  // to align to the center of the viewport.
  const worldCenterX = wW * 0.5;
  const worldCenterY = wH * 0.5;

  // Place world so that (worldCenterX, worldCenterY) lands at (vpW/2, vpH/2)
  state.x = (vpW / 2) - worldCenterX * state.scale;
  state.y = (vpH / 2) - worldCenterY * state.scale;

  // Nudge up a touch so the mid-gap + both 2x2 grids are comfortably visible.
  // (Tweak this offset if you later change zone sizes.)
  state.y += Math.min(80, vpH * 0.06);

  apply();
}

function mount({ viewport, world, minScale = 0.4, maxScale = 2.5, wheelStep: ws = 0.08 }){
  VP = viewport; W = world;
  if (!VP || !W) throw new Error('[CAM] mount() requires { viewport, world }');
  minS = minScale; maxS = maxScale; wheelStep = ws;

  // Ensure transform origin top-left for simple math
  W.style.transformOrigin = '0 0';

  // Let us fully control touch gestures (prevents browser pinch-zoom/scroll fights)
  VP.style.touchAction = 'none';


  // Start truly centered on the combat midline & zones
  centerOnMidline();

  mountMouse();
  mountWheel();
  mountTouch();

  window.Camera = { state, set, panBy, zoomAt };
  //console.log('[CAM] mounted', { minScale: minS, maxScale: maxS, wheelStep });
}

  function set(next = {}){
    if ('x' in next) state.x = next.x;
    if ('y' in next) state.y = next.y;
    if ('scale' in next) state.scale = clamp(next.scale, minS, maxS);
    apply();
  }

  return { state, mount, set, panBy, zoomAt };
})();
