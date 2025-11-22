// /modules/portrait.dice.overlay.js
// Dual Portrait Overlay + True D20 rolls (side-gutter) with deterministic seeded rolls.
// - NO AUTO-CLOSE anywhere. Overlay closes ONLY via the Close button (or DEBUG close).
// - Remote rolls never lock local controls.
// - CTA flips to "Close" after both have rolled; shows winner/tie banner.
// - HARD RULE: do not process portraits until BOTH URLs are known.

export const PortraitOverlay = (() => {
  const TAG  = '[PortraitOverlay]';
  const log  = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  function mySeatSafe(){
    try{
      if (typeof window.mySeat === 'function') return Number(window.mySeat()) || 1;
      if (typeof window.__LOCAL_SEAT !== 'undefined') return Number(window.__LOCAL_SEAT) || 1;
    }catch{}
    return 1;
  }
  function roomIdSafe(){
    try{
      const v = document.querySelector('#roomInput')?.value;
      if (v) return v;
    }catch{}
    return 'local';
  }
  const isDebugRoom = () => String(roomIdSafe()).toUpperCase() === 'DEBUG';

  let _DOM = {
    overlay: null,
    threeMount: null,
    spinner: null,
    badgeL: null,
    badgeR: null,
    rollBtn: null,
    closeBtn: null,
    result: null
  };

  let _renderer = null, _scene = null, _camera = null, _controls = null, _OrbitControls = null;
  let _THREE = null;
  let _BodyPixNS = { bodyPix: null }, _bpModel = null;

  let _dieLeft = null, _dieRight = null;
  let _shadowLeft = null, _shadowRight = null;
  const _groundY = -0.9;

  const _S = {
    left:  { img:null, mesh:null, depthTex:null, mainTex:null, url:null },
    right: { img:null, mesh:null, depthTex:null, mainTex:null, url:null }
  };

  const _processing = { left:false, right:false };
  const _queued     = { left:null,  right:null  };
  let _processingBatch = false;
  let _frameReq = 0;

  let _rolled = { p1: null, p2: null };
  let _rollLocked = { p1: false, p2: false };

  let _dice = { p1: { seed:null, value:null }, p2: { seed:null, value:null } };
let _outcomeShown = false;

// Burn effect: ensure we only fire once per outcome
let _burnFired = false;

  // Deck load status: used to gate the Close CTA
  let _deckLoaded = false;


  // No autoClose flag present anymore.
  const _opts = {
    autoRandomIfUnset: false,
    onResult: null,
    onBothRolled: null,
    sendDiceRTC: null
  };

  const BASELINE = {
    left:  { position:{ x:-0.675, y:0, z:0 }, eulerXYZ:{ x:0, y: 1.03, z:0 } },
    right: { position:{ x: 0.675, y:0, z:0 }, eulerXYZ:{ x:0, y:-1.03, z:0 } },
    sliders: { featherPx:10, depthScale:0.6, separation:1.35, yaw:1.03, wind:0.02 },
    camera:  { position:{ x:0, y:0.309, z:4.633 } }
  };
  function setBaseline(opts={}){
    if (typeof opts.separation === 'number') BASELINE.sliders.separation = opts.separation;
    if (typeof opts.depthScale === 'number') BASELINE.sliders.depthScale = opts.depthScale;
    if (typeof opts.wind === 'number') BASELINE.sliders.wind = opts.wind;
    if (typeof opts.featherPx === 'number') BASELINE.sliders.featherPx = opts.featherPx;
    if (opts.camera && typeof opts.camera === 'object'){
      const { x, y, z } = opts.camera;
      if (typeof x === 'number') BASELINE.camera.position.x = x;
      if (typeof y === 'number') BASELINE.camera.position.y = y;
      if (typeof z === 'number') BASELINE.camera.position.z = z;
    }
    if (_camera){
      _camera.position.set(BASELINE.camera.position.x, BASELINE.camera.position.y, BASELINE.camera.position.z);
      placeMeshes();
    }
  }

  const CSS = `
:root { --overlay-bg: rgba(10,16,32,0.98); --ink:#e5e7eb; --accent:#a78bfa; }
.portrait-overlay { position: fixed; inset: 0; z-index: 999998; background: var(--overlay-bg);
  display: none; opacity: 0; transition: opacity 200ms ease; }
.portrait-overlay.portrait-open { display: block; }
.portrait-overlay.portrait-visible { opacity: 1; }
.portrait-overlay .three-mount { position:absolute; inset:0; }
.portrait-overlay .spinner { position:absolute; inset:0; display:none; place-items:center;
  background:rgba(8,12,20,.55); color:#fff; font-size:14px; z-index:2; pointer-events:none; }
.portrait-overlay .badge{ position:absolute; padding:6px 10px; border-radius:10px;
  background:rgba(0,0,0,.65); border:1px solid rgba(255,255,255,.18);
  font-weight:700; font-size:13px; color:#fff; pointer-events:none;
  transform:translate(-50%,-100%); z-index:3; display:none; }
.portrait-overlay .cta { position:absolute; left:50%; bottom:26px; transform:translateX(-50%); z-index:4; }
.portrait-overlay .cta button{ background: radial-gradient(120% 200% at 50% 10%, #26314f, #151c2d);
  border:1px solid #334155; color:#e5e7eb; padding:12px 18px; border-radius:12px;
  letter-spacing:.5px; font-weight:600; cursor:pointer;
  box-shadow:0 8px 24px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.06);
  transition: transform .08s ease, box-shadow .2s ease, background .2s ease; }
}
.portrait-overlay .cta button:hover{ box-shadow:0 18px 45px rgba(15,23,42,.95), 0 0 0 1px rgba(255,255,255,16); }
.portrait-overlay .cta button:active{ transform: translateY(1px); }



.portrait-overlay .cta button:active{ transform: translateY(1px); }
/* Disabled = greyed out + no interaction */
.portrait-overlay .cta button:disabled{
  opacity:.55;
  cursor:default;
  box-shadow:0 0 0 1px rgba(148,163,184,.6);
  background:radial-gradient(120% 200% at 50% 10%, #111827, #020617);
}

.portrait-overlay .close-debug { position:absolute; top:12px; right:12px; z-index:5; padding:8px 10px;
  border-radius:8px; border:1px solid #334155; color:#e5e7eb; background:#1e293b; cursor:pointer; display:none; }
.portrait-overlay .result { position:absolute; top:18px; left:50%; transform:translateX(-50%);
  z-index:9; padding:8px 14px; border-radius:10px; font-weight:700; letter-spacing:.3px;
  color:#e5e7eb; background:rgba(0,0,0,.55); border:1px solid rgba(255,255,255,.16); display:none; }

.portrait-overlay .awaiting { position:absolute; inset:0; display:none; place-items:center; z-index:8; pointer-events:none;
  font-weight:800; font-size:28px; letter-spacing:.6px; color:#e5e7eb; text-shadow:0 2px 12px rgba(0,0,0,.5); }
.portrait-overlay .awaiting .pulse { animation: pulseGlow 1.2s ease-in-out infinite; }
@keyframes pulseGlow {
  0%{ opacity:.4; transform:scale(0.98); }
  50%{ opacity:1;  transform:scale(1.00); }
  100%{ opacity:.4; transform:scale(0.98); }
}


`;
  function injectStyleOnce(){
    if (document.getElementById('portrait-overlay-style')) return;
    const st = document.createElement('style');
    st.id = 'portrait-overlay-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function buildDOM(){
    if (_DOM.overlay) return;
    injectStyleOnce();
    log('buildDOM:start');

    const overlay = document.createElement('div');
    overlay.id = 'portraitOverlay';
    overlay.className = 'portrait-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.pointerEvents = 'auto';

    const threeMount = document.createElement('div'); threeMount.className = 'three-mount';
    const spinner = document.createElement('div'); spinner.className = 'spinner'; spinner.textContent = ''; // no visible text

const awaiting = document.createElement('div'); awaiting.className = 'awaiting';
awaiting.innerHTML = `<div class="pulse">Awaiting Opponent&#8217;s Deck…</div>`;

const badgeL = document.createElement('div'); badgeL.className = 'badge'; badgeL.textContent = '—';
const badgeR = document.createElement('div'); badgeR.className = 'badge'; badgeR.textContent = '—';


    const cta = document.createElement('div'); cta.className = 'cta';
    const rollBtn = document.createElement('button'); rollBtn.id = 'portrait-roll'; rollBtn.textContent = 'Roll D20';
    cta.appendChild(rollBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-debug';
    closeBtn.textContent = 'Close';
    if (isDebugRoom()) closeBtn.style.display = 'inline-block';

    const result = document.createElement('div'); result.className = 'result'; result.textContent = '';

    overlay.appendChild(threeMount);
overlay.appendChild(spinner);
overlay.appendChild(awaiting);
overlay.appendChild(badgeL);
overlay.appendChild(badgeR);
overlay.appendChild(cta);
overlay.appendChild(closeBtn);
overlay.appendChild(result);


    document.body.appendChild(overlay);

    _DOM = { overlay, threeMount, spinner, awaiting, badgeL, badgeR, rollBtn, closeBtn, result };

    log('buildDOM:done');

    overlay.addEventListener('click', (e) => { e.stopPropagation(); });
    closeBtn.addEventListener('click', () => {
      const bothKnown = (typeof _dice?.p1?.value === 'number') && (typeof _dice?.p2?.value === 'number');
      if (isDebugRoom() || bothKnown) hide();
    });

    // IMPORTANT: use onclick so we can overwrite it later for Close without double handlers
    rollBtn.onclick = () => { rollForMySeat(); };
  }

  function show(){
    if (!_DOM.overlay) buildDOM();
    _DOM.overlay.classList.add('portrait-open');
    requestAnimationFrame(() => {
  _DOM.overlay.classList.add('portrait-visible');
  requestAnimationFrame(() => {
    onResize();
    updateAwaitingStatus();
    log('show:open', { isOpen: isOpen(), isReady: isReady() });
  });
});

  }

  function hide(){
    const bothKnown = (typeof _dice?.p1?.value === 'number') && (typeof _dice?.p2?.value === 'number');
    const deckReady = _deckLoaded || isDebugRoom();

    // Normal rooms: require both rolls AND deck loaded before closing.
    if ((!bothKnown || !deckReady) && !isDebugRoom()) return;

    if (_DOM.overlay){
      _DOM.overlay.classList.remove('portrait-visible');
      setTimeout(() => {
        if (_DOM.overlay) _DOM.overlay.classList.remove('portrait-open');
        // Notify listeners that the overlay has closed
        try { window.dispatchEvent(new CustomEvent('portraitOverlay:closed')); } catch {}
      }, 200);
    }
  }



  function destroy(){
    cancelAnimationFrame(_frameReq); _frameReq = 0;
    try {
      if (_controls) { _controls.dispose?.(); _controls = null; }
      if (_renderer) {
        _renderer.dispose?.();
        disposePortrait('left'); disposePortrait('right');
        if (_dieLeft)  disposeDie(_dieLeft),  _dieLeft = null;
        if (_dieRight) disposeDie(_dieRight), _dieRight = null;
        if (_shadowLeft)  _scene?.remove(_shadowLeft), _shadowLeft = null;
        if (_shadowRight) _scene?.remove(_shadowRight), _shadowRight = null;
      }
      _renderer = null; _scene = null; _camera = null;
    } catch(e) {}
    if (_DOM.overlay){
      _DOM.overlay.remove();
      _DOM = { overlay:null, threeMount:null, spinner:null, badgeL:null, badgeR:null, rollBtn:null, closeBtn:null, result:null };
    }
    _rolled = { p1:null, p2:null };
    _rollLocked = { p1:false, p2:false };
    _dice = { p1:{ seed:null, value:null }, p2:{ seed:null, value:null } };
    _processingBatch = false;
    _outcomeShown = false;
  }

  function isOpen(){ return !!(_DOM.overlay && _DOM.overlay.classList.contains('portrait-open')); }
  function isReady(){ return !!(_renderer && _scene && _camera); }

  function ensureImportMap() {
    const hasMap = !!document.querySelector('script[type="importmap"][data-portrait-overlay]');
    if (hasMap) return;
    const map = { imports: { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js" } };
    const s = document.createElement('script'); s.type = 'importmap'; s.setAttribute('data-portrait-overlay','1');
    s.textContent = JSON.stringify(map); document.head.appendChild(s);
  }

  async function importThree(){
    if (_THREE && _OrbitControls) return _THREE;
    _THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
    ensureImportMap();
    const ocMod = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js');
    _OrbitControls = ocMod.OrbitControls;
    return _THREE;
  }

  function loadScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = () => resolve(); s.onerror = (e) => reject(e); document.head.appendChild(s);
    });
  }

  async function ensureBodyPix(){
    if (_bpModel) return _bpModel;
    if (!_BodyPixNS.bodyPix){
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/body-pix@2.2.0/dist/body-pix.min.js');
      _BodyPixNS.bodyPix = window.bodyPix;
      try {
        if (window.tf?.ready) {
          const backend = window.tf.getBackend?.();
          if (backend !== 'cpu' && window.tf.setBackend) await window.tf.setBackend('cpu');
          await window.tf.ready();
        }
      } catch (e) { console.warn('[PortraitOverlay] tf backend guard failed (continuing)', e); }
    }
    showSpinner(true);
    try {
      _bpModel = await _BodyPixNS.bodyPix.load({
        architecture:'MobileNetV1', outputStride:16, multiplier:0.75, quantBytes:2
      });
      return _bpModel;
    } finally { showSpinner(false); }
  }

  async function initThree(){
    const THREE = await importThree();
    if (!_DOM.threeMount) buildDOM();

    _renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'high-performance', failIfMajorPerformanceCaveat:false });
    const cvs = _renderer.domElement;
    cvs.addEventListener('webglcontextlost', (e) => { e.preventDefault(); warn('webglcontextlost'); }, false);
    cvs.addEventListener('webglcontextrestored', async () => {
      try {
        warn('webglcontextrestored -> rebuild');
        try { _scene?.clear?.(); } catch {}
        try { _renderer?.dispose?.(); } catch {}
        _renderer = null; _scene = null; _camera = null; _controls = null;
        await initThree();
        if (_S.left.url && _S.left.img)  { try { await processSide('left',  _S.left.img); }  catch(e){ warn('restore:left', e); } }
        if (_S.right.url && _S.right.img){ try { await processSide('right', _S.right.img); } catch(e){ warn('restore:right', e); } }
      } catch (e) { warn('webglcontextrestored: failed', e); }
    }, false);

    _renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    _renderer.setSize(_DOM.threeMount.clientWidth, _DOM.threeMount.clientHeight);
    _renderer.outputColorSpace = THREE.SRGBColorSpace;
    _DOM.threeMount.appendChild(_renderer.domElement);

    _scene = new THREE.Scene();
    _camera = new THREE.PerspectiveCamera(35, _DOM.threeMount.clientWidth/_DOM.threeMount.clientHeight, 0.01, 100);
    _camera.position.set(BASELINE.camera.position.x, BASELINE.camera.position.y, BASELINE.camera.position.z);

    _controls = _OrbitControls ? new _OrbitControls(_camera, _renderer.domElement) : null;
    if (_controls){ _controls.enablePan = false; _controls.minDistance = 1.4; _controls.maxDistance = 8; }

    const grid = new THREE.GridHelper(16, 16, 0x172133, 0x10182b);
    grid.position.y = _groundY; grid.material.opacity = 0.30; grid.material.transparent = true; _scene.add(grid);

    _scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.35); dir.position.set(0.6,1.2,1.8); _scene.add(dir);

    window.addEventListener('resize', onResize);
    _frameReq = requestAnimationFrame(animate);

    const w0 = _DOM.threeMount?.clientWidth || 0, h0 = _DOM.threeMount?.clientHeight || 0;
    if (w0 === 0 || h0 === 0) log('initThree: mount 0x0; resize deferred'); else onResize();
  }

  function onResize(){
    if (!_renderer || !_camera || !_DOM.threeMount) return;
    const w = Math.max(1, _DOM.threeMount.clientWidth);
    const h = Math.max(1, _DOM.threeMount.clientHeight);
    _camera.aspect = w / h; _camera.updateProjectionMatrix(); _renderer.setSize(w, h);
  }

  function animate(){
    try {
      tryShowOutcomeOnce();
      const t = performance.now() * 0.001;
      try { tickShaderTime(t); }      catch (e) { warn('animate:tickShaderTime', e); }
      try { updateShadows(); }        catch (e) { warn('animate:updateShadows', e); }
      try { updateBadgeAnchors(); }   catch (e) { warn('animate:updateBadgeAnchors', e); }

      // FINAL GUARANTEE: if both values are known (or both badges visible) and banner isn't showing, force it.
      try { ensureBannerVisibleIfBothKnown(); } catch (e) { warn('animate:ensureBannerVisibleIfBothKnown', e); }

      try { _renderer?.render(_scene, _camera); } catch (e) { warn('animate:render', e); }
    } finally { _frameReq = requestAnimationFrame(animate); }
  }


  const AntiqueFrayShader = {
    uniforms: {
      map:{ value:null }, depthTex:{ value:null }, uTime:{ value:0.0 },
      uDepthScale:{ value:BASELINE.sliders.depthScale },
      uWindAmp:{ value:BASELINE.sliders.wind }, uWindFreq:{ value:1.7 },
      uSepia:{ value:0.6 }, uVignette:{ value:0.85 },
      uGrain:{ value:0.18 }, uFray:{ value:0.9 }, uEdgeSoft:{ value:0.10 }
    },
    vertexShader: `
      varying vec2 vUv; uniform sampler2D depthTex; uniform float uTime,uDepthScale,uWindAmp,uWindFreq;
      void main(){ vUv=uv; vec3 p=position; float d=texture2D(depthTex,vUv).r;
        p.z+=(d-0.5)*uDepthScale;
        float w1=sin(uTime*uWindFreq+vUv.x*6.2831853);
        float w2=sin(uTime*(uWindFreq*0.73)+vUv.y*6.2831853);
        p.z+=uWindAmp*(0.6*w1+0.4*w2); p.x+=uWindAmp*0.18*w2;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform sampler2D map; uniform float uTime,uSepia,uVignette,uGrain,uFray,uEdgeSoft;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); float a=hash(i), b=hash(i+vec2(1.,0.));
        float c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.)); vec2 u=f*f*(3.-2.*f);
        return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y; }
      float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.; a*=.5; } return v; }
      void main(){
        vec3 col=texture2D(map,vUv).rgb;
        vec3 sep; sep.r=dot(col,vec3(.393,.769,.189)); sep.g=dot(col,vec3(.349,.686,.168)); sep.b=dot(col,vec3(.272,.534,.131));
        col=mix(col,sep,clamp(uSepia,0.,1.));
        float edge=min(min(vUv.x,vUv.y),min(1.-vUv.x,1.-vUv.y));
        float n=fbm(vUv*5.5+uTime*.08);
        float chew=mix(0.,.24,uFray); float edgeTarget=chew*(.7+.3*n); float soft=mix(.02,.14,uEdgeSoft);
        float alpha=smoothstep(edgeTarget,edgeTarget+soft,edge);
        float burn=smoothstep(edgeTarget,edgeTarget+soft*.6,edge);
        col*=mix(vec3(.40,.30,.22),vec3(1.),burn);
        float frame=smoothstep(0.,.25,edge);
        col*=mix(.62,1.,pow(frame,1.5)*(1.-(1.-uVignette)*.7));
        float g=hash(vUv*1024.+uTime*.5); col=mix(col,col*(.85+.3*g),clamp(uGrain,0.,1.));
        if(alpha<.01) discard; gl_FragColor=vec4(col,alpha);
      }`
  };

  function makeAntiqueFrayMaterial(mainTex, depthTex){
    const THREE = _THREE;
    const uniforms = THREE.UniformsUtils.clone(AntiqueFrayShader.uniforms);
    uniforms.map.value = mainTex; uniforms.depthTex.value = depthTex;
    return new THREE.ShaderMaterial({ uniforms,
      vertexShader: AntiqueFrayShader.vertexShader, fragmentShader: AntiqueFrayShader.fragmentShader,
      transparent:true, depthWrite:false, alphaTest:0.01
    });
  }
  
  // Combined “Antique Fray + Burn” shader that preserves the depth displacement and wind.
// We reuse AntiqueFrayShader.vertexShader verbatim, and augment the fragment with burn.
const AntiqueFrayBurnShader = {
  uniforms: {
    // Original Antique Fray
    map:        { value: null },
    depthTex:   { value: null },
    uTime:      { value: 0.0 },
    uDepthScale:{ value: BASELINE.sliders.depthScale },
    uWindAmp:   { value: BASELINE.sliders.wind },
    uWindFreq:  { value: 1.7 },
    uSepia:     { value: 0.6 },
    uVignette:  { value: 0.85 },
    uGrain:     { value: 0.18 },
    uFray:      { value: 0.9 },
    uEdgeSoft:  { value: 0.10 },

    // Burn params
    uBurn:      { value: 0.0 },        // 0..1 progress bottom->top
    uNoiseAmp:  { value: 0.12 },       // jaggedness of the edge
    uEdgeWidth: { value: 0.08 },       // softness of burn band
    uGlow:      { value: 1.0 },        // glow intensity
    uGlowCol:   { value: null }        // set in makeAntiqueFrayBurnMaterial
  },
  vertexShader: AntiqueFrayShader.vertexShader,
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D map;
    uniform float uTime,uSepia,uVignette,uGrain,uFray,uEdgeSoft;

    // burn uniforms
    uniform float uBurn, uNoiseAmp, uEdgeWidth, uGlow;
    uniform vec3  uGlowCol;

    // Antique helpers
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p){ 
      vec2 i=floor(p), f=fract(p);
      float a=hash(i), b=hash(i+vec2(1.,0.));
      float c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
      vec2 u=f*f*(3.-2.*f);
      return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;
    }
    float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.; a*=.5; } return v; }

    void main(){
      vec3 col=texture2D(map,vUv).rgb;

      // --- Antique color treatment (same as original) ---
      vec3 sep; sep.r=dot(col,vec3(.393,.769,.189)); sep.g=dot(col,vec3(.349,.686,.168)); sep.b=dot(col,vec3(.272,.534,.131));
      col=mix(col,sep,clamp(uSepia,0.,1.));
      float edge=min(min(vUv.x,vUv.y),min(1.-vUv.x,1.-vUv.y));
      float nA=fbm(vUv*5.5+uTime*.08);
      float chew=mix(0.,.24,uFray); float edgeTarget=chew*(.7+.3*nA); float soft=mix(.02,.14,uEdgeSoft);
      float alphaAntique=smoothstep(edgeTarget,edgeTarget+soft,edge);
      float burnTone=smoothstep(edgeTarget,edgeTarget+soft*.6,edge);
      col*=mix(vec3(.40,.30,.22),vec3(1.),burnTone);
      float frame=smoothstep(0.,.25,edge);
      col*=mix(.62,1.,pow(frame,1.5)*(1.-(1.-uVignette)*.7));
      float g=hash(vUv*1024.+uTime*.5); col=mix(col,col*(.85+.3*g),clamp(uGrain,0.,1.));

      // --- Burn band (bottom->top), noisy edge ---
      float y = vUv.y;
      float nB = fbm(vec2(vUv.x*5.0 + uTime*0.35, vUv.y*5.0 - uTime*0.22));
      float edgeB = uBurn + (nB - 0.5) * uNoiseAmp;

// aBurn: keep area BELOW edge transparent, ABOVE edge opaque (x0 < x1)
float aBurn = smoothstep(edgeB - uEdgeWidth, edgeB + uEdgeWidth, y);

      // Ember glow on the moving edge
      float glowBand = 1.0 - smoothstep(0.0, uEdgeWidth*1.5, abs(y - edgeB));
      vec3  glowCol  = uGlow * glowBand * uGlowCol;

// Char band: correct ordering (x0 < x1)
float charMask = smoothstep(edgeB - uEdgeWidth*1.8, edgeB - uEdgeWidth*0.6, y);
      vec3  charCol  = mix(col, col*vec3(0.25,0.15,0.10), charMask);

      // Compose: start from antique-treated color, apply charring & glow where burn is active
      vec3 rgb = mix(col, charCol + glowCol, 1.0 - aBurn);

      // Kill pixels above front (so portrait “eats” away upwards), but keep antique edge alpha too
      float finalAlpha = alphaAntique * aBurn;
      if (finalAlpha < 0.02) discard;
      gl_FragColor = vec4(rgb, finalAlpha);
    }
  `
};

// Factory for the combined material
function makeAntiqueFrayBurnMaterial(mainTex, depthTex){
  const THREE = _THREE;
  const uniforms = THREE.UniformsUtils.clone(AntiqueFrayBurnShader.uniforms);
  uniforms.map.value      = mainTex;
  uniforms.depthTex.value = depthTex;
  uniforms.uGlowCol.value = new THREE.Color(0xff7a1a); // ember orange
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: AntiqueFrayBurnShader.vertexShader,
    fragmentShader: AntiqueFrayBurnShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    alphaTest: 0.01
  });
}


// --- Burn Dissolve Shader (bottom -> top with noisy ember edge) ---
const BurnDissolveShader = {
  uniforms: {
    map:        { value: null },  // source portrait texture
    uTime:      { value: 0.0 },
    uBurn:      { value: 0.0 },   // 0..1 (how far the burn has progressed from bottom to top)
    uNoiseAmp:  { value: 0.12 },  // how jagged the burn edge is
    uEdgeWidth: { value: 0.08 },  // softness of the transition band
    uGlow:      { value: 1.0 },   // glow intensity at the edge
    uGlowCol:   { value: null } // set later in makeBurnMaterial when THREE is available
 // ember orange
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D map;
    uniform float uTime, uBurn, uNoiseAmp, uEdgeWidth, uGlow;
    uniform vec3 uGlowCol;

    // Cheap hash + noise
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      float a=hash(i), b=hash(i+vec2(1.,0.));
      float c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
      vec2 u = f*f*(3.-2.*f);
      return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;
    }
    float fbm(vec2 p){
      float v=0.0, a=0.5;
      for(int i=0;i<4;i++){ v += a*noise(p); p*=2.0; a*=0.5; }
      return v;
    }

    void main(){
      vec4 base = texture2D(map, vUv);

      // vertical coordinate (0=bottom, 1=top)
      float y = vUv.y;

      // animated noise to jag the edge (scrolls sideways a bit)
      float n = fbm(vec2(vUv.x*5.0 + uTime*0.35, vUv.y*5.0 - uTime*0.22));

      // threshold line that rises from bottom to top
      float edge = uBurn + (n - 0.5) * uNoiseAmp;

      // smooth mask across edge band
      float a = smoothstep(edge - uEdgeWidth, edge + uEdgeWidth, y);

      // Ember band at the frontier
      float glowBand = 1.0 - smoothstep(0.0, uEdgeWidth*1.5, abs(y - edge));
      vec3  glowCol = uGlow * glowBand * uGlowCol;

      // Darken charred areas slightly below edge
      float charMask = smoothstep(edge - uEdgeWidth*1.8, edge - uEdgeWidth*0.6, y);
      vec3  charCol  = mix(base.rgb, base.rgb*vec3(0.25,0.15,0.10), charMask);

      // Compose: charred base + glow
      vec3 rgb = mix(base.rgb, charCol + glowCol, 1.0 - a);

      // Kill pixels above the burn front
      if (a < 0.02) discard;

      gl_FragColor = vec4(rgb, a);
    }
  `
};

function makeBurnMaterial(mainTex){
  const THREE = _THREE;
  const uniforms = THREE.UniformsUtils.clone(BurnDissolveShader.uniforms);
  uniforms.map.value = mainTex;
  // set glow color now that THREE is guaranteed
  uniforms.uGlowCol.value = new THREE.Color(0xff7a1a);

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: BurnDissolveShader.vertexShader,
    fragmentShader: BurnDissolveShader.fragmentShader,
    transparent: true,
    depthWrite: false
  });
}


// Animate the burn on the *windy depth* material itself, but start INVISIBLE,
// then reveal bottom→top, then remove.
function playBurn(side, { duration=1400 } = {}){
  const S = _S[side]; if (!S?.mesh || !S?.mainTex || !S?.depthTex) return;
  try{
    // Prepare combined material (windy depth + burn) with uBurn=0
    // At uBurn=0 the whole portrait is visible; as uBurn rises, the bottom becomes transparent.
    const burnMat = makeAntiqueFrayBurnMaterial(S.mainTex, S.depthTex);
    if (burnMat?.uniforms){
      burnMat.uniforms.uBurn.value       = 0.0;       // start fully visible
      burnMat.uniforms.uTime.value       = 0.0;
      burnMat.uniforms.uDepthScale.value = BASELINE.sliders.depthScale;
      burnMat.uniforms.uWindAmp.value    = BASELINE.sliders.wind;
    }

    // Swap materials WITHOUT hiding the mesh (no reveal phase)
    S.mesh.material?.dispose?.();
    S.mesh.material = burnMat;

    const t0 = performance.now();
    function tick(t){
      const e = Math.min(1, (t - t0) / duration);
      const ease = 1.0 - Math.pow(1.0 - e, 3.0); // cubic ease-out

      if (S.mesh?.material?.uniforms){
        const u = S.mesh.material.uniforms;
        u.uTime.value = (t * 0.001);
        u.uBurn.value = ease;             // burn line climbs upward, HIDING the bottom
        u.uDepthScale.value = BASELINE.sliders.depthScale;
        u.uWindAmp.value    = BASELINE.sliders.wind;
      }

      if (e < 1){
        requestAnimationFrame(tick);
      } else {
        // once fully burned, clean up that portrait mesh
        try { disposePortrait(side); } catch {}
      }
    }
    requestAnimationFrame(tick);

  } catch(e){
    warn('playBurn failed', e);
  }
}





  function tickShaderTime(t){
    for (const side of ['left','right']){
      const m = _S[side].mesh; if (!m || !m.material || !m.material.uniforms) continue;
      m.material.uniforms.uTime.value = t;
    }
  }
  
  function updateAwaitingStatus(){
  if (!_DOM.awaiting) return;
  const haveLeft  = !!_S.left.url;
  const haveRight = !!_S.right.url;
  const waitingForOpponent = !(haveLeft && haveRight);
  _DOM.awaiting.style.display = waitingForOpponent ? 'grid' : 'none';
}


  function showSpinner(b){ if (_DOM.spinner) _DOM.spinner.style.display = b ? 'grid' : 'none'; }

  async function ensureThreeReady(){
    if (!_renderer || !_scene || !_camera) {
      await initThree();
      const w = _DOM.threeMount?.clientWidth || 0;
      const h = _DOM.threeMount?.clientHeight || 0;
      if (w === 0 || h === 0) onResize();
    }
  }

  async function setPortrait(side, url){
    log('setPortrait:store-url', { side, url });
    _S[side].url = url || null;
_queued[side] = null;
updateAwaitingStatus();
await _maybeStartProcessingIfBothReady();

  }

  async function setBothPortraits(leftUrl, rightUrl){
    _S.left.url  = leftUrl  || null;
_S.right.url = rightUrl || null;
_queued.left = _queued.right = null;
updateAwaitingStatus();
await _maybeStartProcessingIfBothReady();

  }

  async function _maybeStartProcessingIfBothReady(){
	  if (!_S.left.url || !_S.right.url) { updateAwaitingStatus(); return; }

    if (_processingBatch) return;
    if (!_S.left.url || !_S.right.url) return;
    _processingBatch = true;
    try { await startProcessingBatch(); }
    catch (e){ warn('startProcessingBatch:error', e); }
    finally { _processingBatch = false; }
  }

  async function startProcessingBatch(){
	  updateAwaitingStatus(); // hides the message now that both URLs are present

    log('startProcessingBatch:begin', { leftUrl: !!_S.left.url, rightUrl: !!_S.right.url });
    if (!_DOM.overlay) buildDOM();
    await ensureThreeReady();
    await ensureBodyPix();

    const leftUrlNorm  = normalizeToPortraitUrl(_S.left.url);
    const rightUrlNorm = normalizeToPortraitUrl(_S.right.url);
    const [leftImg, rightImg] = await Promise.all([ urlToImg(leftUrlNorm), urlToImg(rightUrlNorm) ]);

    await processSide('left',  leftImg);
    await processSide('right', rightImg);
    log('startProcessingBatch:done');
  }

  async function processSide(side, img){
    log('processSide:start', { side });
    _S[side].img = img;

    await new Promise(r => requestAnimationFrame(r));
    const alreadyOpen = isOpen();
    const scaled = scaleImg(img, alreadyOpen ? 72 : 96);
    if (!_bpModel) { await ensureBodyPix(); }

    await new Promise(r => requestAnimationFrame(r));
    const seg = await _bpModel.segmentPerson(scaled, {
      internalResolution:'medium', segmentationThreshold:0.7, maxDetections:1
    });

    const depthCanvas = buildDepthFromMask(seg, img.width, img.height, BASELINE.sliders.featherPx, img);

    const THREE = _THREE;
    const mainTex  = new THREE.Texture(img);               mainTex.needsUpdate  = true; mainTex.colorSpace  = THREE.SRGBColorSpace;
    const depthTex = new THREE.CanvasTexture(depthCanvas); depthTex.needsUpdate = true; depthTex.colorSpace = THREE.LinearSRGBColorSpace;

    _S[side].mainTex  = mainTex; _S[side].depthTex = depthTex;

    const aspect = img.width / img.height;
    const planeH = 1.6, planeW = planeH * aspect, SEG = 192;
    const mat = makeAntiqueFrayMaterial(mainTex, depthTex);

    if (!_S[side].mesh){
      const geo  = new THREE.PlaneGeometry(planeW, planeH, SEG, SEG);
      const mesh = new THREE.Mesh(geo, mat);
      _S[side].mesh = mesh; _scene.add(mesh);
    } else {
      _S[side].mesh.material.dispose(); _S[side].mesh.material = mat;
      _S[side].mesh.geometry.dispose(); _S[side].mesh.geometry = new _THREE.PlaneGeometry(planeW, planeH, SEG, SEG);
    }

    const w = _renderer?.domElement?.clientWidth || 0, h = _renderer?.domElement?.clientHeight || 0;
    if (w === 0 || h === 0) onResize();
    placeMeshes();

    await new Promise(r => requestAnimationFrame(r));
    log('processSide:done', { side });
  }

  function placeMeshes(){
    const L = _S.left.mesh, R = _S.right.mesh;
    if (L){ L.position.set(-BASELINE.sliders.separation/2, BASELINE.left.position.y, BASELINE.left.position.z);
      L.rotation.set(BASELINE.left.eulerXYZ.x, BASELINE.left.eulerXYZ.y, BASELINE.left.eulerXYZ.z); }
    if (R){ R.position.set(+BASELINE.sliders.separation/2, BASELINE.right.position.y, BASELINE.right.position.z);
      R.rotation.set(BASELINE.right.eulerXYZ.x, BASELINE.right.eulerXYZ.y, BASELINE.right.eulerXYZ.z); }
  }

  function buildDepthFromMask(seg, W, H, featherPx, img){
    const sm = document.createElement('canvas'); sm.width = seg.width; sm.height = seg.height;
    const smctx = sm.getContext('2d'); const id = smctx.createImageData(sm.width, sm.height);
    for (let i=0;i<seg.data.length;i++){ const v = seg.data[i] ? 255 : 0; id.data.set([v,v,v,255], i*4); } smctx.putImageData(id,0,0);

    const depth = document.createElement('canvas'); depth.width = W; depth.height = H;
    const dctx = depth.getContext('2d'); dctx.imageSmoothingEnabled = true; dctx.imageSmoothingQuality = 'high'; dctx.drawImage(sm,0,0,W,H);
    if (featherPx > 0){ dctx.filter = `blur(${featherPx}px)`; dctx.drawImage(depth,0,0); dctx.filter = 'none'; }

    const icv = document.createElement('canvas'); icv.width = W; icv.height = H; const ictx = icv.getContext('2d'); ictx.drawImage(img,0,0,W,H);
    const dImg = dctx.getImageData(0,0,W,H); const iImg = ictx.getImageData(0,0,W,H);
    for (let i=0;i<W*H;i++){
      const m = dImg.data[i*4]/255; const r=iImg.data[i*4], g=iImg.data[i*4+1], b=iImg.data[i*4+2];
      const lum = (0.299*r + 0.587*g + 0.114*b)/255; const mixed = Math.max(0, Math.min(1, m*0.9 + lum*0.1)); const v = Math.round(mixed*255);
      dImg.data[i*4]=v; dImg.data[i*4+1]=v; dImg.data[i*4+2]=v; dImg.data[i*4+3]=255;
    }
    dctx.putImageData(dImg,0,0);
    return depth;
  }

  function makeSeed(){
    try{
      const a = new Uint32Array(1);
      (window.crypto && window.crypto.getRandomValues) ? window.crypto.getRandomValues(a) : (a[0] = (Date.now()>>>0) ^ Math.floor(Math.random()*0xffffffff));
      return (a[0]>>>0);
    }catch{ return ((Date.now()>>>0) ^ Math.floor(Math.random()*0xffffffff))>>>0; }
  }
  function mulberry32(seed){
    let a = seed>>>0;
    return function(){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | a)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rollValueFromSeed(seed){ const rng = mulberry32(seed); return (Math.floor(rng()*20) % 20) + 1; }
  function randomFromSeed(seed){ const r = mulberry32(seed); return r(); }

  function applyTriangleUVs(geometry){
    const pos = geometry.attributes.position; const faceCount = pos.count/3;
    const uvArray = new Float32Array(faceCount*3*2);
    for (let i=0;i<faceCount;i++){ const base = i*6;
      uvArray[base+0]=0.5; uvArray[base+1]=1.0; uvArray[base+2]=0.0; uvArray[base+3]=0.0; uvArray[base+4]=1.0; uvArray[base+5]=0.0; }
    geometry.setAttribute('uv', new _THREE.BufferAttribute(uvArray, 2));
  }

  function createNumberTexture(n){
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,S,S);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 120px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    const y = S/2 + 26; ctx.strokeText(String(n), S/2, y); ctx.fillText(String(n), S/2, y);
    const tex = new _THREE.CanvasTexture(c);
    tex.minFilter = _THREE.LinearFilter; tex.magFilter = _THREE.LinearFilter;
    tex.anisotropy = _renderer?.capabilities?.getMaxAnisotropy?.() || 1;
    return tex;
  }

  function createNumberedD20(){
    let g = new _THREE.IcosahedronGeometry(0.55); g = g.toNonIndexed(); applyTriangleUVs(g);
    const faceCount = g.attributes.position.count/3;
    const mats = []; for (let i=0;i<faceCount;i++) mats.push(new _THREE.MeshBasicMaterial({ map: createNumberTexture(i+1) }));
    g.clearGroups(); for (let i=0;i<faceCount;i++) g.addGroup(i*3,3,i);
    const mesh = new _THREE.Mesh(g, mats);
    const edges = new _THREE.EdgesGeometry(mesh.geometry);
    const outline = new _THREE.LineSegments(edges, new _THREE.LineBasicMaterial({ color:0x000000 }));
    mesh.add(outline); _scene.add(mesh); return mesh;
  }
  function numberingFor(mesh){
    const faceCount = mesh.geometry.attributes.position.count/3;
    return Array.from({ length:faceCount }, (_,i)=>i+1);
  }

  function createBlobShadow(){
    const size = 256, c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'); const grd = ctx.createRadialGradient(size/2,size/2,10,size/2,size/2,size/2);
    grd.addColorStop(0,'rgba(0,0,0,0.45)'); grd.addColorStop(1,'rgba(0,0,0,0.0)');
    ctx.fillStyle = grd; ctx.fillRect(0,0,size,size);
    const tex = new _THREE.CanvasTexture(c);
    const mat = new _THREE.MeshBasicMaterial({ map:tex, transparent:true, depthWrite:false });
    const geo = new _THREE.PlaneGeometry(1,1);
    const m = new _THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI/2; m.position.y = _groundY + 0.001;
    _scene.add(m);
    return m;
  }

  function getDieWorldCenterMesh(mesh){ const p = new _THREE.Vector3(); mesh.getWorldPosition(p); return p; }

  function getFaceCentersWorldMesh(mesh, numMap){
    const out = [], g = mesh.geometry, pos = g.attributes.position; mesh.updateMatrixWorld(true);
    const center = getDieWorldCenterMesh(mesh);
    for (let i=0;i<pos.count;i+=3){
      const a = new _THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const b = new _THREE.Vector3().fromBufferAttribute(pos, i+1).applyMatrix4(mesh.matrixWorld);
      const c = new _THREE.Vector3().fromBufferAttribute(pos, i+2).applyMatrix4(mesh.matrixWorld);
      const centerW = new _THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
      const dir = new _THREE.Vector3().subVectors(centerW, center).normalize();
      out.push({ idx:i/3, number:numMap[i/3], centerW, dir });
    }
    return out;
  }

  function getAxesWorldMesh(mesh, number, numMap){
    const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv;
    const nmat = new _THREE.Matrix3(); nmat.getNormalMatrix(mesh.matrixWorld);
    for (let i=0;i<pos.count;i+=3){
      const faceNum = numMap[i/3]; if (faceNum !== number) continue;
      const p1 = new _THREE.Vector3().fromBufferAttribute(pos,i);
      const p2 = new _THREE.Vector3().fromBufferAttribute(pos,i+1);
      const p3 = new _THREE.Vector3().fromBufferAttribute(pos,i+2);
      const uv1 = new _THREE.Vector2().fromBufferAttribute(uv,i);
      const uv2 = new _THREE.Vector2().fromBufferAttribute(uv,i+1);
      const uv3 = new _THREE.Vector2().fromBufferAttribute(uv,i+2);
      const e1 = new _THREE.Vector3().subVectors(p2,p1); const e2 = new _THREE.Vector3().subVectors(p3,p1);
      const du1 = uv2.x-uv1.x, dv1 = uv2.y-uv1.y; const du2 = uv3.x-uv1.x, dv2 = uv3.y-uv1.y;
      const r = (du1*dv2 - dv1*du2);
      let nLocal = new _THREE.Vector3().crossVectors(e1,e2).normalize();
      if (Math.abs(r) < 1e-8){
        const c = new _THREE.Vector3().add(p1).add(p2).add(p3).divideScalar(3);
        const upLocal = new _THREE.Vector3().subVectors(p1,c).normalize();
        return { normalW:nLocal.clone().applyMatrix3(nmat).normalize(), upW:upLocal.clone().applyMatrix3(nmat).normalize() };
      }
      const tangent = new _THREE.Vector3().copy(e1).multiplyScalar(dv2).addScaledVector(e2,-dv1).multiplyScalar(1/r);
      let bitangent = new _THREE.Vector3().copy(e2).multiplyScalar(du1).addScaledVector(e1,-du2).multiplyScalar(1/r);
      const nW = nLocal.clone().applyMatrix3(nmat).normalize();
      const tW = tangent.clone().applyMatrix3(nmat).normalize();
      let bW = bitangent.clone().applyMatrix3(nmat).normalize();
      if (new _THREE.Vector3().crossVectors(tW,bW).dot(nW) < 0) bW.negate();
      return { normalW:nW, upW:bW };
    }
    return null;
  }

  function cameraUpWorldLocal(){ return new _THREE.Vector3(0,1,0).applyQuaternion(_camera.quaternion).normalize(); }

  function settleMeshToFace(mesh, number, numMap, duration=700){
    const axes = getAxesWorldMesh(mesh, number, numMap); if (!axes) return;
    const ctr = new _THREE.Vector3(); mesh.getWorldPosition(ctr);
    const faceOut = new _THREE.Vector3().subVectors(_camera.position, ctr).normalize();
    let axis1 = new _THREE.Vector3().crossVectors(axes.normalW, faceOut);
    const dot1 = _THREE.MathUtils.clamp(axes.normalW.dot(faceOut), -1, 1);
    let angle1 = Math.acos(dot1);
    if (axis1.lengthSq() < 1e-12 || angle1 < 1e-6){ axis1.set(0,0,1); angle1 = 0; }
    else { axis1.normalize(); }
    const delta1 = new _THREE.Quaternion().setFromAxisAngle(axis1, angle1);
    const upAfter1 = axes.upW.clone().applyQuaternion(delta1).normalize();
    const camUp = cameraUpWorldLocal();
    const camUpProj = camUp.clone().sub(faceOut.clone().multiplyScalar(camUp.dot(faceOut))).normalize();
    let delta2 = new _THREE.Quaternion();
    if (isFinite(camUpProj.x) && camUpProj.lengthSq() > 1e-10){
      const cross2 = new _THREE.Vector3().crossVectors(upAfter1, camUpProj);
      const sign2 = Math.sign(cross2.dot(faceOut));
      const dot2 = _THREE.MathUtils.clamp(upAfter1.dot(camUpProj), -1, 1);
      const angle2 = Math.acos(dot2) * (sign2 || 1);
      delta2.setFromAxisAngle(faceOut, angle2);
    } else delta2.identity();
    const deltaWorld = new _THREE.Quaternion().multiplyQuaternions(delta2, delta1);
    const currW = new _THREE.Quaternion(); mesh.getWorldQuaternion(currW);
    const targetW = new _THREE.Quaternion().multiplyQuaternions(deltaWorld, currW);
    let targetLocal = targetW.clone();
    if (mesh.parent){
      const parentW = new _THREE.Quaternion(); mesh.parent.getWorldQuaternion(parentW);
      targetLocal = parentW.clone().invert().multiply(targetW);
    }
    const startQ = mesh.quaternion.clone(); const start = performance.now();
    function tick(t){
      const e = Math.min(1, (t - start)/duration);
      const ease = 1 - Math.pow(1 - e, 3);
      const q = new _THREE.Quaternion().slerpQuaternions(startQ, targetLocal, ease);
      mesh.setRotationFromQuaternion(q);
      if (e < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function disposeDie(mesh){
    try{
      mesh?.traverse?.(obj => {
        if (obj.isMesh){
          obj.geometry?.dispose?.();
          if (Array.isArray(obj.material)) obj.material.forEach(m=>m?.map?.dispose?.(), obj.material.forEach(m=>m?.dispose?.()));
          else { obj.material?.map?.dispose?.(); obj.material?.dispose?.(); }
        }
      });
      _scene?.remove(mesh);
    }catch{}
  }

  function updateShadows(){
    const upd = (die, shadow) => {
      if (!die || !shadow) return;
      shadow.position.x = die.position.x; shadow.position.z = die.position.z;
      const h = Math.max(0.01, die.position.y - _groundY);
      const s = _THREE.MathUtils.clamp(0.9 + h*0.35, 0.9, 2.2);
      shadow.scale.set(s, s, 1);
      shadow.material.opacity = _THREE.MathUtils.clamp(0.65 - h*0.10, 0.08, 0.65);
    };
    upd(_dieLeft, _shadowLeft); upd(_dieRight, _shadowRight);
  }

  function worldToScreen(v3){
    const v = v3.clone().project(_camera);
    const x = (v.x*0.5 + 0.5) * _renderer.domElement.clientWidth;
    const y = (-v.y*0.5 + 0.5) * _renderer.domElement.clientHeight;
    return { x, y };
  }

  function updateBadgeAnchors(){
    const upd = (side, el) => {
      const mesh = _S[side].mesh; if (!mesh) return;
      const top = mesh.position.clone(); top.y += 0.95;
      const s = worldToScreen(top);
      el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
    };
    if (_DOM.badgeL) upd('left',  _DOM.badgeL);
    if (_DOM.badgeR) upd('right', _DOM.badgeR);
  }

  function showBadge(side, value){
  const el = (side === 'left') ? _DOM.badgeL : _DOM.badgeR;
  if (!el) return;
  const label = (side === 'left') ? 'Player 1' : 'Player 2';
  el.textContent = `${label}: ${value}`;
  el.style.display = 'block';
}


  function dropD20Deterministic(side, seed, value, opts = {}){
    const r0 = randomFromSeed(seed);
    const r1 = randomFromSeed((seed ^ 0x9e3779b9) >>> 0);
    const r2 = randomFromSeed((seed ^ 0x85ebca6b) >>> 0);

    const startY = 4.8, startZ = 0.0;
    const startX = (side === 'left') ? -2.30 : 2.30;
    const endX   = startX;

    const die    = createNumberedD20();
    const shadow = createBlobShadow();

    die.position.set(startX, startY, startZ);
    die.rotation.set(r0*Math.PI*2, r1*Math.PI*2, r2*Math.PI*2);
    const numMap = numberingFor(die);

    if (side === 'left'){ _dieLeft = die; _shadowLeft = shadow; }
    else                { _dieRight = die; _shadowRight = shadow; }

    const start = performance.now(), duration = 1400;
    const spinX = Math.PI*(6 + Math.floor((r0*5)+3));
    const spinY = Math.PI*(6 + Math.floor((r1*5)+3));
    const spinZ = Math.PI*(2 + Math.floor((r2*3)+2));
    const easeOutCubic = x => 1 - Math.pow(1 - x, 3);
    function easeOutBounce(x){
      const n1=7.5625, d1=2.75;
      if (x < 1/d1) return n1*x*x;
      else if (x < 2/d1){ x-=1.5/d1; return n1*x*x + .75; }
      else if (x < 2.5/d1){ x-=2.25/d1; return n1*x*x + .9375; }
      else { x-=2.625/d1; return n1*x*x + .984375; }
    }

    function animateDrop(time){
      const t = Math.min(1, (time - start)/duration);
      const yNorm = easeOutBounce(t);
      die.position.y = _groundY + _THREE.MathUtils.lerp(startY, 0.0, yNorm);
      die.position.z = _THREE.MathUtils.lerp(startZ, 0.0, easeOutCubic(t));
      die.position.x = _THREE.MathUtils.lerp(startX, endX, t);
      const spinEase = 1 - t*0.9;
      die.rotation.x += (spinX * 0.016)*spinEase;
      die.rotation.y += (spinY * 0.016)*spinEase;
      die.rotation.z += (spinZ * 0.016)*spinEase;

      if (t < 1) requestAnimationFrame(animateDrop);
      else {
        settleMeshToFace(die, value, numMap, 650);
        showBadge(side, value);
        handleRollResult(side, value, opts);
        // Final safety: after badge is on-screen, force a banner render if both are known.
        forceOutcomeBanner();
      }

    }
    requestAnimationFrame(animateDrop);
  }

  function ensureDOMBuilt(){
    if (!_DOM?.overlay) buildDOM();
  }

    // Unified numeric read: prefer _dice, then _rolled (what the badges reflect).
  // Returns { v1, v2, both } with numeric coercion.
  function _valuesForOutcome() {
    const coerce = (v) => (v == null ? null : (Number(v)));
    const v1 = coerce(_dice?.p1?.value ?? _rolled?.p1);
    const v2 = coerce(_dice?.p2?.value ?? _rolled?.p2);
    return { v1, v2, both: Number.isFinite(v1) && Number.isFinite(v2) };
  }

  // Force banner re-render regardless of previous attempts.
  function forceOutcomeBanner(){
    const { v1, v2, both } = _valuesForOutcome();
    log('forceOutcomeBanner()', { v1, v2, both, _outcomeShown });
    if (!both) return false;
    _outcomeShown = false; // allow a fresh paint
    const ok = reconcileOutcome();
    if (ok) _outcomeShown = true;
    return ok;
  }

  function tryShowOutcomeOnce(){
    if (_outcomeShown) return;
    const { both } = _valuesForOutcome();
    if (both){
      const ok = reconcileOutcome();
      if (ok) _outcomeShown = true;
    }
  }
  function badgesState(){
    const l = _DOM.badgeL && _DOM.badgeL.style.display !== 'none' && /\d+/.test(_DOM.badgeL.textContent||'');
    const r = _DOM.badgeR && _DOM.badgeR.style.display !== 'none' && /\d+/.test(_DOM.badgeR.textContent||'');
    return { l: !!l, r: !!r, both: !!l && !!r };
  }

  function ensureBannerVisibleIfBothKnown(){
    if (_outcomeShown) return;
    const nums = _valuesForOutcome();
    const badg = badgesState();
    // If both numeric values are known OR both badges are visible with numbers — force the banner.
    if (nums.both || badg.both){
      forceOutcomeBanner();
    }
  }

  // CTRL-F anchor: [D20:reconcile]
  function reconcileOutcome(){
    ensureDOMBuilt();

    const { v1, v2, both } = _valuesForOutcome();
    log('reconcileOutcome()', { v1, v2, both });
    if (!both) return false;

    const tie = (v1 === v2);

   // Winner / Tie banner
if (_DOM.result){
  if (tie){
    _DOM.result.textContent = `Tie — ${v1} vs ${v2}`;
    _DOM.result.style.display = 'block';
  } else {
    const winnerLabel = (v1 > v2) ? 'Player 1' : 'Player 2';
    const hi = Math.max(v1, v2), lo = Math.min(v1, v2);
    _DOM.result.textContent = `${winnerLabel} wins — ${hi} > ${lo}`;
    _DOM.result.style.display = 'block';
  }
}

// NEW: Burn the losing portrait once, after outcome known (non-tie)
if (!tie && !_burnFired){
  _burnFired = true;
  const loserSide = (v1 > v2) ? 'right' : 'left'; // P1 beats P2 -> burn 'right'; else burn 'left'
  playBurn(loserSide, { duration: 1500 });
}



    // Flip CTA — but don't allow closing until the deck is fully loaded.
    if (_DOM.rollBtn){
      if (tie){
        _rollLocked.p1 = false; _rollLocked.p2 = false;
        _DOM.rollBtn.textContent = 'Roll D20 (Tie – roll again)';
        _DOM.rollBtn.disabled = false;
        _DOM.rollBtn.onclick = () => rollForMySeat();
      } else {
        if (_deckLoaded || isDebugRoom()){
          _DOM.rollBtn.textContent = 'Close';
          _DOM.rollBtn.disabled = false;
          _DOM.rollBtn.onclick = () => hide();
        } else {
          _DOM.rollBtn.textContent = 'Loading decks…';
          _DOM.rollBtn.disabled = true;
          _DOM.rollBtn.onclick = null; // no-op while loading
        }
      }
    }


    // Keep _rolled in sync so any other guards relying on it behave consistently.
    if (_rolled){
      if (_rolled.p1 == null && typeof v1 === 'number') _rolled.p1 = v1;
      if (_rolled.p2 == null && typeof v2 === 'number') _rolled.p2 = v2;
    }

    if (typeof _opts.onBothRolled === 'function'){
      try { _opts.onBothRolled({ p1:{ value:v1 }, p2:{ value:v2 }, tie }); } catch {}
    }

    _outcomeShown = true;
    return true;
  }


  function handleRollResult(side, value, opts = {}) {
    const seat = (side === 'left') ? 1 : 2;
    if (seat === 1) _rolled.p1 = value; else _rolled.p2 = value;

    // Lock ONLY my seat on a local-initiated roll
    if (!opts.suppressLock) lockMySeatRoll(true);

    if (typeof _opts.onResult === 'function') {
      try { _opts.onResult({ side, value, seat }); } catch {}
    }

    // Also mirror into _dice so reconciler has a single source of truth.
    if (seat === 1) _dice.p1.value = value; else _dice.p2.value = value;

    // Decide winner / flip CTA if both are known (animation order no longer matters).
    reconcileOutcome();
    tryShowOutcomeOnce();
  }

  function lockMySeatRoll(lock){
    const seat = mySeatSafe();
    if (seat === 1) _rollLocked.p1 = !!lock; else _rollLocked.p2 = !!lock;
    if (_DOM.rollBtn){
      const myLocked = (seat === 1) ? _rollLocked.p1 : _rollLocked.p2;
      _DOM.rollBtn.disabled = !!myLocked;
    }
  }

  function rollForMySeat(){
    const seat = mySeatSafe();
    if (seat === 1 && _rollLocked.p1) return;
    if (seat === 2 && _rollLocked.p2) return;
    const side = (seat === 1) ? 'left' : 'right';
    roll(side);
  }

  function roll(side){
    if (side === 'left'  && _rollLocked.p1) return;
    if (side === 'right' && _rollLocked.p2) return;

    ensurePortraits().then(() => {
      const seat = (side === 'left') ? 1 : 2;
      const seed = makeSeed();
      const value = rollValueFromSeed(seed);

      if (seat === 1) { _dice.p1.seed = seed; _dice.p1.value = value; }
      else            { _dice.p2.seed = seed; _dice.p2.value = value; }

      // NEW: compute outcome ASAP if the other value already arrived.
      reconcileOutcome();
      tryShowOutcomeOnce();

      dropD20Deterministic(side, seed, value);

            if (typeof _opts.sendDiceRTC === 'function'){
        const packet = { type:'overlay:d20', room: roomIdSafe(), seat, side, seed:(seed>>>0), value };
        try {
          console.log('%c[Overlay→RTC:send overlay:d20]', 'color:#0cf;font-weight:bold', packet);
          _opts.sendDiceRTC(packet);
        } catch(e){
          warn('sendDiceRTC failed', e);
        }
      } else {
        warn('sendDiceRTC missing – overlay was not injected with an RTC sender');
      }

    });
  }

  function applyRemoteDice(msg){
    if (!msg || typeof msg.seed !== 'number' || typeof msg.value !== 'number') return;
    const seat = Number(msg.seat) === 2 ? 2 : 1;
    const side = (msg.side === 'right') ? 'right' : 'left';
    const seed = msg.seed>>>0;
    const value = Math.max(1, Math.min(20, Math.floor(msg.value)));

    if (seat === 1) { _dice.p1.seed = seed; _dice.p1.value = value; }
    else            { _dice.p2.seed = seed; _dice.p2.value = value; }

    // Decide winner / flip CTA immediately if both values are present
    reconcileOutcome();
    tryShowOutcomeOnce();

    // Remote animation never locks my button
    dropD20Deterministic(side, seed, value, { suppressLock: true });
    // If local already rolled and banner somehow missed earlier, this catches it.
    forceOutcomeBanner();

  }

  async function ensurePortraits(){
    if (_S.left.mesh && _S.right.mesh) return;
    await _maybeStartProcessingIfBothReady();
  }

  async function urlToImg(url){ const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; await img.decode(); return img; }
  function scaleImg(img, shortW){ const c = document.createElement('canvas'); c.width = shortW; c.height = Math.round(shortW * img.height / img.width); c.getContext('2d').drawImage(img,0,0,c.width,c.height); return c; }
  function normalizeToPortraitUrl(url){
    try{
      const u = new URL(url, window.location.href);
      if (u.hostname.endsWith('scryfall.io')){
        u.pathname = u.pathname.replace(/(\/)(small|normal|large|png|border_crop|art_crop)(\/)/,'$1art_crop$3');
        return u.toString();
      }
    }catch{}
    return url;
  }

  function disposePortrait(side){
    try{
      const m = _S[side].mesh; if (!m) return;
      m.geometry?.dispose?.();
      if (m.material){ m.material.map?.dispose?.(); m.material.depthTex?.dispose?.(); m.material?.dispose?.(); }
      _scene?.remove(m);
      _S[side].mesh = null; _S[side].depthTex = null; _S[side].mainTex = null; _S[side].img = null;
    }catch{}
  }

  async function init({ autoRandomIfUnset=false, onResult=null, onBothRolled=null, showOnInit=false, sendDiceRTC=null } = {}){
  _opts.autoRandomIfUnset = !!autoRandomIfUnset;
  _opts.onResult          = (typeof onResult === 'function') ? onResult : null;
  _opts.onBothRolled      = (typeof onBothRolled === 'function') ? onBothRolled : null;

  // Preserve existing sender unless a new function is explicitly provided
  if (typeof sendDiceRTC === 'function') {
    _opts.sendDiceRTC = sendDiceRTC;
  }
    if (!_DOM.overlay) buildDOM();
    if (showOnInit) show();

    // Reset
    _rolled = { p1:null, p2:null };
    _rollLocked = { p1:false, p2:false };
    _dice = { p1:{ seed:null, value:null }, p2:{ seed:null, value:null } };
    _outcomeShown = false;
    _burnFired = false;
    _deckLoaded = false;  // deck is not ready until deckloading:final-lib fires
    log('init: reset state; waiting for rolls');



    if (_DOM.result){ _DOM.result.textContent = ''; _DOM.result.style.display = 'none'; }
    if (_DOM.rollBtn){
      _DOM.rollBtn.textContent = 'Roll D20';
      _DOM.rollBtn.disabled = false;
      _DOM.rollBtn.onclick = () => rollForMySeat(); // overwrite any prior handler
    }
  }

  function onResult(fn){ _opts.onResult = (typeof fn === 'function') ? fn : null; }
  function onBothRolled(fn){ _opts.onBothRolled = (typeof fn === 'function') ? fn : null; }

  function setSendDiceRTC(fn){
    _opts.sendDiceRTC = (typeof fn === 'function') ? fn : null;
    log('setSendDiceRTC:', { has: !!_opts.sendDiceRTC });
  }

  // Listen for deck-loading completion so we can unlock the Close CTA.
  if (typeof window !== 'undefined' && !window.__PORTRAIT_DECKLOAD_HOOK){
    window.__PORTRAIT_DECKLOAD_HOOK = 1;
    try {
      window.addEventListener('deckloading:final-lib', () => {
        _deckLoaded = true;
        try {
          // Re-run the reconciler so the CTA updates from "Loading decks…" → "Close"
          reconcileOutcome();
        } catch (e){
          warn('deckloading:final-lib handler failed', e);
        }
      });
    } catch (e) {
      // ignore
    }
  }

  return {
    init,
    show,
    hide,
    destroy,
    isOpen,
    isReady,
    setPortrait,
    setBothPortraits,
    setBaseline,
    onResult,
    onBothRolled,
    rollForMySeat,
    roll,
    applyRemoteDice,
    setSendDiceRTC
  };

})();

