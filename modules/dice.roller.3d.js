// modules/dice.roller.3d.js
import * as THREE from 'https://cdn.skypack.dev/three@0.152.2';

// ============================================================================
// INTERNAL SINGLETON STATE
// ============================================================================
let scene = null;
let cameraRoot = null;
let camera = null;
let renderer = null;
let table = null;

let die = null;
let blobShadow = null;
let currentDie = 'd10'; // default focus: D10

// Track the pair of meshes used for the D100 (tens + ones)
let d100Dice = [];

// Static dice meshes displayed when the bag is open (sprawled set)
let bagShowcaseDice = [];


// Overlay DOM
let overlayRoot = null;
let resultEl = null;
let bagEl = null;

// Optional callback for integration later
let onResultCb = null;

// Table / ground
const tableY = 0;

// === Global dice size tuning ==========================================
// Base "radius" for all dice (world units). Make this smaller/bigger
// to shrink or grow every die at once.
const DIE_BASE_SCALE   = 0.22;            // ~10–15% of old size
const DIE_NORMAL_SCALE = DIE_BASE_SCALE;  // non-cinematic rolls
const DIE_CINE_SCALE   = DIE_BASE_SCALE * 1.3; // cinematic rolls slightly larger

// Where the dice's CENTER should end up above the table plane
const restY = DIE_BASE_SCALE; // roughly their radius

// Per-triangle or per-face numbering
const numbering = {
  d4:  null, // will fill 4 faces (one per tri face)
  d6:  null, // per-tri numbers across 12 triangles (2 per square face)
  d8:  null, // 8 tri faces
  d10: null, // 10 kites (2 tris each) => 20 entries
  d12: null, // 12 pentagons (≈3 tris each) => ~36 entries
  d20: null
};

// ============================================================================
// DOM / STYLE HELPERS
// ============================================================================
const STYLE_ID = 'dice3d-module-style';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#dice3d-root{
  position:fixed;
  inset:0;
  z-index:9999;
  display:none;
  pointer-events:none;
  font-family:system-ui,sans-serif;
}
#dice3d-root canvas.dice3d-canvas{
  width:100%;
  height:100%;
  display:block;
  pointer-events:none;
}
.dice3d-result{
  position:absolute;
  top:50%;
  left:50%;
  transform:translate(-50%,-50%);
  font-size:48px;
  color:#fff;
  background:#0008;
  padding:16px 32px;
  border-radius:12px;
  opacity:0;
  pointer-events:none;
  transition:opacity .5s ease;
  z-index:10;
}
.dice3d-result.show{ opacity:1; }

.dice3d-bag{
  position:absolute;
  top:30px;              /* vertical position under top bar – tweak as needed */
  left:50%;              /* center horizontally */
  transform:translateX(-50%);
  padding:10px;
  border-radius:10px;
  background:rgba(12,25,12,0.7);
  border:1px solid rgba(255,255,255,0.12);
  box-shadow:0 10px 35px rgba(0,0,0,0.6);
  pointer-events:auto;
  backdrop-filter:blur(4px);
}
.dice3d-bag-header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin-bottom:8px;
  font-size:14px;
  color:#e8f5e8;
  font-weight:600;
}
.dice3d-bag-header button{
  border:none;
  background:transparent;
  color:#e5e7eb;
  font-size:18px;
  cursor:pointer;
}
.dice3d-bag-row{
  display:flex;          /* single row of buttons */
  flex-wrap:nowrap;
  gap:6px;
  justify-content:center;
}
.dice3d-btn{
  padding:8px 10px;
  font-size:14px;
  border-radius:8px;
  border:none;
  background:#26314f;
  color:#f9fafb;
  cursor:pointer;
  transition:transform .06s ease, background .18s ease;
}

.dice3d-btn:hover{ background:#2f3b60; }
.dice3d-btn:active{ transform:translateY(1px); }
  `;
  document.head.appendChild(style);
}

function ensureOverlayRoot() {
  if (overlayRoot && overlayRoot.isConnected) return overlayRoot;
  ensureStyles();
  overlayRoot = document.createElement('div');
  overlayRoot.id = 'dice3d-root';
  document.body.appendChild(overlayRoot);
  return overlayRoot;
}

function ensureResultEl() {
  if (resultEl && resultEl.isConnected) return resultEl;
  const root = ensureOverlayRoot();
  resultEl = document.createElement('div');
  resultEl.className = 'dice3d-result';
  root.appendChild(resultEl);
  return resultEl;
}

// ============================================================================
// SCENE SETUP (KEPT LOGICALLY IDENTICAL, JUST MOVED INTO A FUNCTION)
// ============================================================================
function ensureScene() {
  if (scene) return;

  const root = ensureOverlayRoot();

  scene = new THREE.Scene();
  // ⬅️ no scene.background – we render with transparent clear color instead

  cameraRoot = new THREE.Group();
  scene.add(cameraRoot);

  camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 2.5, 5);
  camera.lookAt(0, 0, 0);
  cameraRoot.add(camera);

  // 🔸 key change: alpha:true + transparent clear color
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true          // allow transparent background
  });
  renderer.setClearColor(0x000000, 0);  // fully transparent
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.classList.add('dice3d-canvas');
  root.appendChild(renderer.domElement);

  const dir = new THREE.DirectionalLight(0xffffff, 1);
  dir.position.set(5, 5, 5);
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  // ❌ removed internal green table mesh – we now “float” over your real table
  // (tableY/restY are still used for physics; only the visual plane is gone)

  // Main render loop (logic unchanged)
  renderer.setAnimationLoop(() => {
    updateBlobShadow();
    renderer.render(scene, camera);
  });

  window.addEventListener('resize', () => {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // NOTE: no default die here anymore.
  // Dice are created only by spawnBagShowcase() or roll()/rollD100().
}



// ============================================================================
// NUMBER TEXTURES (CANVAS)  [UNCHANGED LOGIC]
// ============================================================================
function createNumberTexture(number, type = currentDie) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');

  const fontPx =
    ({ d20: 130, d12: 160, d10: 170, d8: 180, d6: 185, d4: 180 }[type] || 170);
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'black';
  ctx.font = `bold ${fontPx}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = type === 'd6' ? 196 : 170;
  ctx.fillText(String(number), 128, y);

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// ============================================================================
// BLOB SHADOW [UNCHANGED LOGIC]
// ============================================================================
function createBlobShadow() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(
    size / 2,
    size / 2,
    10,
    size / 2,
    size / 2,
    size / 2
  );
  grd.addColorStop(0, 'rgba(0,0,0,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false
  });
  const geo = new THREE.PlaneGeometry(1, 1);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = tableY + 0.001;

  scene.add(m);
  return m;
}

// ============================================================================
// UV HELPERS  [UNCHANGED LOGIC]
// ============================================================================
function applyTriangleUVs(geometry) {
  const pos = geometry.attributes.position;
  const faceCount = pos.count / 3;
  const uvArray = new Float32Array(faceCount * 3 * 2);
  for (let i = 0; i < faceCount; i++) {
    const base = i * 6;
    uvArray[base + 0] = 0.5;
    uvArray[base + 1] = 1.0;
    uvArray[base + 2] = 0.0;
    uvArray[base + 3] = 0.0;
    uvArray[base + 4] = 1.0;
    uvArray[base + 5] = 0.0;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
}

function applyBoxFaceUVs_For12Triangles(geometry) {
  const triCount = geometry.attributes.position.count / 3; // 12
  const uv = new Float32Array(triCount * 3 * 2);
  for (let t = 0; t < triCount; t += 2) {
    let b = t * 6;
    uv[b + 0] = 0;
    uv[b + 1] = 1;
    uv[b + 2] = 0;
    uv[b + 3] = 0;
    uv[b + 4] = 1;
    uv[b + 5] = 0;
    b += 12;
    uv[b + 0] = 0;
    uv[b + 1] = 1;
    uv[b + 2] = 1;
    uv[b + 3] = 0;
    uv[b + 4] = 1;
    uv[b + 5] = 1;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function applyPentagonGroupsUVs_ForD12(geometry) {
  const pos = geometry.attributes.position;
  const triCount = pos.count / 3; // ~36
  const uv = new Float32Array(triCount * 3 * 2);
  const v = i => new THREE.Vector3().fromBufferAttribute(pos, i);

  for (let t = 0; t < triCount; t += 3) {
    const idxs = [
      t * 3,
      t * 3 + 1,
      t * 3 + 2,
      (t + 1) * 3,
      (t + 1) * 3 + 1,
      (t + 1) * 3 + 2,
      (t + 2) * 3,
      (t + 2) * 3 + 1,
      (t + 2) * 3 + 2
    ];
    const pts = idxs.map(v);
    const n = new THREE.Vector3()
      .copy(pts[1])
      .sub(pts[0])
      .cross(new THREE.Vector3().copy(pts[2]).sub(pts[0]))
      .normalize();
    const tangent = new THREE.Vector3().copy(pts[1]).sub(pts[0]).normalize();
    const bitan = new THREE.Vector3().crossVectors(n, tangent).normalize();

    const UVs = pts.map(p => {
      const d = new THREE.Vector3().copy(p).sub(pts[0]);
      return new THREE.Vector2(d.dot(tangent), d.dot(bitan));
    });

    let minU = Infinity,
      minV = Infinity,
      maxU = -Infinity,
      maxV = -Infinity;
    for (const q of UVs) {
      if (q.x < minU) minU = q.x;
      if (q.y < minV) minV = q.y;
      if (q.x > maxU) maxU = q.x;
      if (q.y > maxV) maxV = q.y;
    }
    const spanU = maxU - minU || 1,
      spanV = maxV - minV || 1;
    for (const q of UVs) {
      q.x = (q.x - minU) / spanU;
      q.y = (q.y - minV) / spanV;
    }

    for (let k = 0; k < 9; k++) {
      const base = idxs[k] * 2;
      uv[base + 0] = UVs[k].x;
      uv[base + 1] = UVs[k].y;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Map each kite (2 tris) to one square texture (for D10)
function applyKiteUVs_ForD10(geometry) {
  const triCount = geometry.attributes.position.count / 3; // 20
  const uv = new Float32Array(triCount * 3 * 2);
  for (let t = 0; t < triCount; t += 2) {
    let b = t * 6;
    uv[b + 0] = 0;
    uv[b + 1] = 1;
    uv[b + 2] = 0;
    uv[b + 3] = 0;
    uv[b + 4] = 1;
    uv[b + 5] = 0;
    b += 12;
    uv[b + 0] = 0;
    uv[b + 1] = 1;
    uv[b + 2] = 1;
    uv[b + 3] = 0;
    uv[b + 4] = 1;
    uv[b + 5] = 1;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ============================================================================
// CORRECT D10 GEOMETRY: PENTAGONAL TRAPEZOHEDRON  [UNCHANGED LOGIC]
// ============================================================================
function makePentagonalTrapezohedron(radius = 1, visualSquashY = 0.32) {
  const PLANAR_A_OVER_H = 9.471031; // coplanarity constant
  const r = 1.0 * radius;
  const h = 0.28 * radius;
  const A = PLANAR_A_OVER_H * h;

  const topApex = new THREE.Vector3(0, A, 0);
  const botApex = new THREE.Vector3(0, -A, 0);

  const ringTop = [],
    ringBot = [];
  for (let i = 0; i < 5; i++) {
    const aTop = i * ((Math.PI * 2) / 5);
    const aBot = aTop + Math.PI / 5;
    ringTop.push(new THREE.Vector3(r * Math.cos(aTop), h, r * Math.sin(aTop)));
    ringBot.push(new THREE.Vector3(r * Math.cos(aBot), -h, r * Math.sin(aBot)));
  }

  const P = [];
  function pushTriOut(a, b, c) {
    const e1 = new THREE.Vector3().subVectors(b, a);
    const e2 = new THREE.Vector3().subVectors(c, a);
    const n = new THREE.Vector3().crossVectors(e1, e2);
    const ctr = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(ctr) < 0) {
      const t = b;
      b = c;
      c = t;
    }
    P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  for (let i = 0; i < 5; i++) {
    const i1 = (i + 1) % 5;

    // Up-facing kite
    pushTriOut(topApex, ringTop[i], ringBot[i]);
    pushTriOut(topApex, ringBot[i], ringTop[i1]);

    // Down-facing kite
    pushTriOut(botApex, ringBot[i], ringTop[i1]);
    pushTriOut(botApex, ringTop[i1], ringBot[i1]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  const geom = g.toNonIndexed();

  // Visual squash (keep kites planar)
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) * visualSquashY);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();

  return geom;
}

// ============================================================================
// D100 HELPERS / NUMBERING  [UNCHANGED LOGIC]
// ============================================================================
function buildD10Numbering(geom) {
  const triCount = geom.attributes.position.count / 3; // 20
  const perTri = [];
  let n = 1;
  for (let t = 0; t < triCount; t += 2) {
    perTri[t] = n;
    perTri[t + 1] = n;
    n = (n % 10) + 1;
  }
  return perTri;
}

// D12: 12 pentagons, each triangulated into 3 triangles.
// Map tris 0–2 → 1, 3–5 → 2, ... 33–35 → 12.
function buildD12Numbering(geom) {
  const triCount = geom.attributes.position.count / 3; // ~36
  const perTri = [];
  let n = 1;
  for (let t = 0; t < triCount; t++) {
    perTri[t] = n;
    if ((t + 1) % 3 === 0) n++;
  }
  return perTri;
}

// ============================================================================
// D100 ROLL (TWO D10s)  [UNCHANGED LOGIC, NOW SUPPORTS SEEDED RNG]
// ============================================================================
function rollD100(options = {}) {
  ensureScene();
  ensureResultEl();

  const rng =
    typeof options === 'object' &&
    options !== null &&
    typeof options.rng === 'function'
      ? options.rng
      : Math.random;

  // Optional: pre-chosen total (1–100) so seeded RTC rolls can agree
  // on the exact percentile result before the animation.
  let forcedTotal = null;
  if (
    typeof options === 'object' &&
    options !== null &&
    Number.isFinite(options.forcedTotal)
  ) {
    forcedTotal = Math.max(1, Math.min(100, Math.floor(options.forcedTotal)));
  }




  // Clear static "bag" dice – only the D100 pair should be visible now.
  clearBagShowcase();

  // 1) If a single big die is on screen, remove it and stop its shadow updates
  if (die) {
    scene.remove(die);
    die = null;
  }


  // 2) Remove any previous D100 pair from the scene
  if (d100Dice.length) {
    for (const m of d100Dice) scene.remove(m);
    d100Dice = [];
  }

  function getDieWorldCenterMesh(mesh) {
    const p = new THREE.Vector3();
    mesh.getWorldPosition(p);
    return p;
  }

  function getFaceCentersWorldMesh(mesh, numMap) {
    const out = [],
      g = mesh.geometry,
      pos = g.attributes.position;
    mesh.updateMatrixWorld(true);
    const center = getDieWorldCenterMesh(mesh);
    for (let i = 0; i < pos.count; i += 3) {
      const a = new THREE.Vector3()
        .fromBufferAttribute(pos, i)
        .applyMatrix4(mesh.matrixWorld);
      const b = new THREE.Vector3()
        .fromBufferAttribute(pos, i + 1)
        .applyMatrix4(mesh.matrixWorld);
      const c = new THREE.Vector3()
        .fromBufferAttribute(pos, i + 2)
        .applyMatrix4(mesh.matrixWorld);
      const centerW = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
      const dir = new THREE.Vector3().subVectors(centerW, center).normalize();
      out.push({ idx: i / 3, number: numMap[i / 3], centerW, dir });
    }
    return out;
  }

  function getFacingNumberMesh(mesh, numMap) {
    const ctr = getDieWorldCenterMesh(mesh);
    const toCam = new THREE.Vector3()
      .subVectors(camera.position, ctr)
      .normalize();
    const faces = getFaceCentersWorldMesh(mesh, numMap);
    let best = null,
      bestDot = -Infinity;
    for (const f of faces) {
      const d = f.dir.dot(toCam);
      if (d > bestDot) {
        bestDot = d;
        best = f;
      }
    }
    return best ? best.number : (Array.isArray(numMap) ? numMap[0] : 0);
  }

  function getAxesWorldMesh(mesh, number, numMap) {
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const nmat = new THREE.Matrix3();
    nmat.getNormalMatrix(mesh.matrixWorld);

    // Find first pair of triangles that carry this number
    let t0 = -1,
      t1 = -1;
    for (let i = 0; i < numMap.length; i++) {
      if (numMap[i] === number) {
        t0 = i;
        t1 = i + 1 < numMap.length && numMap[i + 1] === number ? i + 1 : i;
        break;
      }
    }
    if (t0 < 0) return null;

    const i0 = t0 * 3;
    const i1 = t1 * 3;

    const a1 = new THREE.Vector3().fromBufferAttribute(pos, i0 + 0);
    const b1 = new THREE.Vector3().fromBufferAttribute(pos, i0 + 1);
    const c1 = new THREE.Vector3().fromBufferAttribute(pos, i0 + 2);
    const a2 = new THREE.Vector3().fromBufferAttribute(pos, i1 + 0);
    const b2 = new THREE.Vector3().fromBufferAttribute(pos, i1 + 1);
    const c2 = new THREE.Vector3().fromBufferAttribute(pos, i1 + 2);

    // Center of the kite (6 verts)
    const centerLocal = new THREE.Vector3()
      .add(a1)
      .add(b1)
      .add(c1)
      .add(a2)
      .add(b2)
      .add(c2)
      .multiplyScalar(1 / 6);

    // Average normal of the two triangles
    const n1 = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(b1, a1),
        new THREE.Vector3().subVectors(c1, a1)
      )
      .normalize();
    const n2 = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(b2, a2),
        new THREE.Vector3().subVectors(c2, a2)
      )
      .normalize();
    const nLocal = new THREE.Vector3().add(n1).add(n2).normalize();

    // In-face "up": from center toward one vertex, projected onto the plane
    let upLocal = new THREE.Vector3().subVectors(a1, centerLocal).normalize();
    upLocal.sub(nLocal.clone().multiplyScalar(upLocal.dot(nLocal))).normalize();

    const normalW = nLocal.clone().applyMatrix3(nmat).normalize();
    const upW = upLocal.clone().applyMatrix3(nmat).normalize();
    return { normalW, upW };
  }

  function cameraUpWorldLocal() {
    return new THREE.Vector3(0, 1, 0)
      .applyQuaternion(camera.quaternion)
      .normalize();
  }

  function settleMeshToFace(mesh, number, numMap, duration = 700, doneCb) {
    const axes = getAxesWorldMesh(mesh, number, numMap);
    if (!axes) {
      if (doneCb) doneCb(number);
      return;
    }
    const { normalW: nW0, upW: upW0 } = axes;
    const ctr = new THREE.Vector3();
    mesh.getWorldPosition(ctr);
    const faceOut = new THREE.Vector3()
      .subVectors(camera.position, ctr)
      .normalize();

    let axis1 = new THREE.Vector3().crossVectors(nW0, faceOut);
    const dot1 = THREE.MathUtils.clamp(nW0.dot(faceOut), -1, 1);
    let angle1 = Math.acos(dot1);
    if (axis1.lengthSq() < 1e-12 || angle1 < 1e-6) {
      axis1.set(0, 0, 1);
      angle1 = 0;
    } else {
      axis1.normalize();
    }
    const delta1 = new THREE.Quaternion().setFromAxisAngle(axis1, angle1);

    const upAfter1 = upW0.clone().applyQuaternion(delta1).normalize();
    const camUp = cameraUpWorldLocal();
    const camUpProj = camUp
      .clone()
      .sub(faceOut.clone().multiplyScalar(camUp.dot(faceOut)))
      .normalize();

    let delta2 = new THREE.Quaternion();
    if (isFinite(camUpProj.x) && camUpProj.lengthSq() > 1e-10) {
      const cross2 = new THREE.Vector3().crossVectors(upAfter1, camUpProj);
      const sign2 = Math.sign(cross2.dot(faceOut));
      const dot2 = THREE.MathUtils.clamp(upAfter1.dot(camUpProj), -1, 1);
      const angle2 = Math.acos(dot2) * (sign2 || 1);
      delta2.setFromAxisAngle(faceOut, angle2);
    } else {
      delta2.identity();
    }

    const deltaWorld = new THREE.Quaternion().multiplyQuaternions(
      delta2,
      delta1
    );
    const currW = new THREE.Quaternion();
    mesh.getWorldQuaternion(currW);
    const targetW = new THREE.Quaternion().multiplyQuaternions(
      deltaWorld,
      currW
    );

    let targetLocal = targetW.clone();
    if (mesh.parent) {
      const parentW = new THREE.Quaternion();
      mesh.parent.getWorldQuaternion(parentW);
      targetLocal = parentW.clone().invert().multiply(targetW);
    }

    const startQ = mesh.quaternion.clone();
    const start = performance.now();

    function tick(t) {
      const e = Math.min(1, (t - start) / duration);
      const ease = 1 - Math.pow(1 - e, 3);
      const q = new THREE.Quaternion().slerpQuaternions(
        startQ,
        targetLocal,
        ease
      );
      mesh.setRotationFromQuaternion(q);

      if (e < 1) {
        requestAnimationFrame(tick);
      } else if (doneCb) {
        doneCb(number);
      }
    }

    requestAnimationFrame(tick);
  }

  // Per-kite labels for the tens die (10..90, then 00)
  const tensFaceSeq = [10, 20, 30, 40, 50, 60, 70, 80, 90, '00'];
  // Ones die: digits 0–9 (percentile style)
  const onesFaceSeq = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  // If we have a forced total, convert it into the labels that should
  // end up face-up on each die.
  let forcedTensLabel = null;
  let forcedOnesLabel = null;
  if (forcedTotal != null) {
    if (forcedTotal === 100) {
      forcedTensLabel = '00';
      forcedOnesLabel = 0;
    } else {
      const tensRaw = Math.floor(forcedTotal / 10) * 10; // 0..90
      const onesRaw = forcedTotal % 10;
      forcedTensLabel = tensRaw === 0 ? '00' : tensRaw;
      forcedOnesLabel = onesRaw;
    }
  }

  // Left die = tens (10,20,...,00). Right die = ones (0..9).

  const left = createDie('d10', tensFaceSeq);
  const right = createDie('d10', onesFaceSeq);

  // Remember this pair so the next D100 roll can clean them up
  d100Dice = [left, right];

  const makePerTri = faces => {
    const arr = [];
    for (const v of faces) arr.push(v, v); // 2 tris per kite
    return arr;
  };
  const leftNums = makePerTri(tensFaceSeq);
  const rightNums = makePerTri(onesFaceSeq);

  const leftFirst = rng() < 0.5;


  function primeDie(mesh, side) {
    const x = side === 'left' ? -2.5 : 2.5;
    const z = side === 'left' ? 1.2 : -1.2;

    mesh.position.set(x, 6.5, z);

    const baseScale = DIE_CINE_SCALE;
    mesh.scale.set(baseScale, baseScale, baseScale);

    mesh.rotation.set(
      rng() * Math.PI,
      rng() * Math.PI,
      rng() * Math.PI
    );


    mesh.userData.restX = x;
    mesh.userData.restZ = z;
  }

  primeDie(left, 'left');
  primeDie(right, 'right');

  function fallAndSettle(mesh, numMap, side, forcedNumber, cb) {
    const start = performance.now();
    const duration = 1200;

    const startX = mesh.position.x;
    const startY = 6.5;
    const startZ = mesh.position.z;

    const targetX = side === 'left' ? -2.4 : 2.4;
    const targetZ = side === 'left' ? 0.9 : -0.9;

    const spinX = Math.PI * (6 + rng() * 4);
    const spinY = Math.PI * (6 + rng() * 4);
    const spinZ = Math.PI * (2 + rng() * 2);

    const easeOutCubic = x => 1 - Math.pow(1 - x, 3);
    function easeOutBounce(x) {
      const n1 = 7.5625,
        d1 = 2.75;
      if (x < 1 / d1) return n1 * x * x;
      else if (x < 2 / d1) {
        x -= 1.5 / d1;
        return n1 * x * x + 0.75;
      } else if (x < 2.5 / d1) {
        x -= 2.25 / d1;
        return n1 * x * x + 0.9375;
      } else {
        x -= 2.625 / d1;
        return n1 * x * x + 0.984375;
      }
    }

    function animate(t) {
      const s = Math.min(1, (t - start) / duration);
      const yNorm = easeOutBounce(s);

      mesh.position.y = THREE.MathUtils.lerp(startY, restY, yNorm);

      mesh.position.z = THREE.MathUtils.lerp(
        startZ,
        targetZ,
        easeOutCubic(s)
      );
      mesh.position.x = THREE.MathUtils.lerp(startX, targetX, s);

      const spinEase = 1 - s * 0.9;
      mesh.rotation.x += (spinX * 0.016) * spinEase;
      mesh.rotation.y += (spinY * 0.016) * spinEase;
      mesh.rotation.z += (spinZ * 0.016) * spinEase;

      renderer.render(scene, camera);
      if (s < 1) requestAnimationFrame(animate);
      else {
        const faceNum =
          forcedNumber !== undefined && forcedNumber !== null
            ? forcedNumber
            : getFacingNumberMesh(mesh, numMap);

        settleMeshToFace(mesh, faceNum, numMap, 600, v => {
          if (typeof cb === 'function') cb(v);
        });
      }
    }
    requestAnimationFrame(animate);
  }


  let tensVal = null,
    onesVal = null;
  function computeAndShow() {
    if (tensVal === null || onesVal === null) return;

    const tensRaw = tensVal === '00' ? 0 : Number(tensVal) || 0;
    const onesRaw = Number(onesVal) || 0;

    let total;
    if (tensRaw === 0 && onesRaw === 0) {
      total = 100;
    } else {
      total = tensRaw + onesRaw; // 1–99
    }
    showResult(total);
    if (typeof onResultCb === 'function') {
      onResultCb({ kind: 'd100', value: total, tens: tensRaw, ones: onesRaw });
    }
  }

  const launchA = () =>
    fallAndSettle(left, leftNums, 'left', forcedTensLabel, v => {
      tensVal = v;
      computeAndShow();
    });
  const launchB = () =>
    fallAndSettle(right, rightNums, 'right', forcedOnesLabel, v => {
      onesVal = v;
      computeAndShow();
    });

  if (leftFirst) {
    launchA();
    setTimeout(launchB, 250 + rng() * 200);
  } else {
    launchB();
    setTimeout(launchA, 250 + rng() * 200);
  }

}

// ============================================================================
// GEOMETRY SELECTION  [UNCHANGED LOGIC]
// ============================================================================
function makeGeometryFor(type) {
  if (type === 'd4') return new THREE.TetrahedronGeometry(1);
  if (type === 'd6') return new THREE.BoxGeometry(1, 1, 1);
  if (type === 'd8') return new THREE.OctahedronGeometry(1);
  if (type === 'd10') return makePentagonalTrapezohedron(1);
  if (type === 'd12') return new THREE.DodecahedronGeometry(1);
  if (type === 'd20') return new THREE.IcosahedronGeometry(1);
  return new THREE.OctahedronGeometry(1);
}

// ============================================================================
// D6 & D10 OVERLAY DIGITS  [UNCHANGED LOGIC]
// ============================================================================
function _makeDigitTextureCentered(n, px = 185) {
  const S = 256,
    c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'black';
  ctx.font = `bold ${px}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const text = String(n);
  const m = ctx.measureText(text);
  const asc = m.actualBoundingBoxAscent ?? px * 0.8;
  const des = m.actualBoundingBoxDescent ?? px * 0.2;
  const h = asc + des;
  const cx = S / 2,
    cy = S / 2 + (asc - h / 2);
  ctx.lineWidth = Math.max(2, px * 0.04);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.strokeText(text, cx, cy);
  ctx.fillText(text, cx, cy);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function _makeDigitPlane(n, size = 0.86) {
  const geo = new THREE.PlaneGeometry(size, size);
  const tex = _makeDigitTextureCentered(n, 185);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -5
  });
  return new THREE.Mesh(geo, mat);
}

function attachD6Overlays(dieMesh) {
  const faces = [
    {
      num: 1,
      normal: new THREE.Vector3(0, 0, 1),
      center: new THREE.Vector3(0, 0, 0.5)
    },
    {
      num: 6,
      normal: new THREE.Vector3(0, 0, -1),
      center: new THREE.Vector3(0, 0, -0.5)
    },
    {
      num: 2,
      normal: new THREE.Vector3(0, 1, 0),
      center: new THREE.Vector3(0, 0.5, 0)
    },
    {
      num: 5,
      normal: new THREE.Vector3(0, -1, 0),
      center: new THREE.Vector3(0, -0.5, 0)
    },
    {
      num: 3,
      normal: new THREE.Vector3(1, 0, 0),
      center: new THREE.Vector3(0.5, 0, 0)
    },
    {
      num: 4,
      normal: new THREE.Vector3(-1, 0, 0),
      center: new THREE.Vector3(-0.5, 0, 0)
    }
  ];
  const zLift = 0.001;
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (const f of faces) {
    const plane = _makeDigitPlane(f.num);
    const q = new THREE.Quaternion().setFromUnitVectors(zAxis, f.normal);
    plane.setRotationFromQuaternion(q);
    plane.position.copy(
      f.center.clone().add(f.normal.clone().multiplyScalar(zLift))
    );
    dieMesh.add(plane);
  }
}

// === D10 overlays: one centered quad per kite ===============================
function attachD10Overlays(dieMesh, perKiteNums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  const g = dieMesh.geometry;
  const pos = g.attributes.position;
  const zAxis = new THREE.Vector3(0, 0, 1);

  for (let k = 0; k < 10; k++) {
    const t0 = 2 * k,
      t1 = 2 * k + 1;
    const i0 = t0 * 3,
      i1 = t1 * 3;

    const a1 = new THREE.Vector3().fromBufferAttribute(pos, i0 + 0);
    const b1 = new THREE.Vector3().fromBufferAttribute(pos, i0 + 1);
    const c1 = new THREE.Vector3().fromBufferAttribute(pos, i0 + 2);
    const a2 = new THREE.Vector3().fromBufferAttribute(pos, i1 + 0);
    const b2 = new THREE.Vector3().fromBufferAttribute(pos, i1 + 1);
    const c2 = new THREE.Vector3().fromBufferAttribute(pos, i1 + 2);

    const center = new THREE.Vector3()
      .add(a1)
      .add(b1)
      .add(c1)
      .add(a2)
      .add(b2)
      .add(c2)
      .multiplyScalar(1 / 6);

    const n1 = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(b1, a1),
        new THREE.Vector3().subVectors(c1, a1)
      )
      .normalize();
    const n2 = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(b2, a2),
        new THREE.Vector3().subVectors(c2, a2)
      )
      .normalize();
    const n = new THREE.Vector3().add(n1).add(n2).normalize();

    let up = new THREE.Vector3(0, 1, 0);
    up.sub(n.clone().multiplyScalar(up.dot(n)));
    if (up.lengthSq() < 1e-10) up.set(1, 0, 0);
    up.normalize();

    const plane = _makeDigitPlane(perKiteNums[k], 0.86);

    const q1 = new THREE.Quaternion().setFromUnitVectors(zAxis, n);
    plane.setRotationFromQuaternion(q1);

    const planeUpW = new THREE.Vector3(0, 1, 0).applyQuaternion(q1).normalize();
    const spinAxis = n.clone();
    const spin = Math.atan2(
      planeUpW
        .clone()
        .cross(up)
        .dot(spinAxis),
      planeUpW.dot(up)
    );
    plane.rotateOnWorldAxis(spinAxis, spin);

    // 🔄 Flip a fixed set of physical kites (indices 1,3,5,7,9).
    // These are the faces that needed a 180° flip in the original
    // 1–10 mapping, and keeping it by index works for any labels
    // (normal D10, tens D10, ones D10).
    if (k % 2 === 1) {
      plane.rotateOnWorldAxis(spinAxis, Math.PI);
    }

    plane.position.copy(center.clone().add(n.clone().multiplyScalar(0.004)));

    dieMesh.add(plane);
  }

}


// ============================================================================
// CREATE DIE (MATERIALS PER TRI; UV PATHS)  [UNCHANGED LOGIC]
// d10OverlayNums (optional) = per-kite labels for D10 overlays
// ============================================================================
function createDie(type, d10OverlayNums = null) {
  if (die) scene.remove(die);
  if (!blobShadow) blobShadow = createBlobShadow();
  currentDie = type;

  let geometry = makeGeometryFor(type);
  geometry.computeVertexNormals();
  geometry = geometry.toNonIndexed();

  if (type === 'd6') {
    applyBoxFaceUVs_For12Triangles(geometry);
  } else if (type === 'd12') {
    applyPentagonGroupsUVs_ForD12(geometry);
  } else if (type === 'd10') {
    // Map each kite (2 tris) into a square UV island so
    // getFaceTextureAxesWorld() can compute proper tangent/bitangent.
    applyKiteUVs_ForD10(geometry);
  } else {
    applyTriangleUVs(geometry);
  }

  const faceCount = geometry.attributes.position.count / 3;

  if (type === 'd10') {
    numbering.d10 = buildD10Numbering(geometry);
  } else if (type === 'd12') {
    numbering.d12 = buildD12Numbering(geometry);
  }

  let order = numbering[type];
  if (!order || order.length !== faceCount) {
    numbering[type] = Array.from({ length: faceCount }, (_, i) => i + 1);
    order = numbering[type];
  }

  let mesh;

  if (type === 'd10') {
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mats = Array.from({ length: faceCount }, () => white);
    geometry.clearGroups();
    for (let i = 0; i < faceCount; i++) geometry.addGroup(i * 3, 3, i);
    mesh = new THREE.Mesh(geometry, mats);

    const overlayNums = d10OverlayNums || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    attachD10Overlays(mesh, overlayNums);
  } else if (type === 'd6') {
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mats = Array.from({ length: faceCount }, () => white);
    geometry.clearGroups();
    for (let i = 0; i < faceCount; i++) geometry.addGroup(i * 3, 3, i);
    mesh = new THREE.Mesh(geometry, mats);
    attachD6Overlays(mesh);
  } else if (type === 'd12' || type === 'd4' || type === 'd8' || type === 'd20') {
    const mats = [];
    for (let i = 0; i < faceCount; i++) {
      const texture = createNumberTexture(order[i], type);
      mats.push(new THREE.MeshBasicMaterial({ map: texture }));
    }
    geometry.clearGroups();
    for (let i = 0; i < faceCount; i++) geometry.addGroup(i * 3, 3, i);
    mesh = new THREE.Mesh(geometry, mats);
  } else {
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    mesh = new THREE.Mesh(geometry, white);
  }

  const edges = new THREE.EdgesGeometry(geometry);
  const outline = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x000000 })
  );
  mesh.add(outline);

  scene.add(mesh);
  return mesh;
}

// --- Bag "showcase" helpers: static dice set around table center -----------

function clearBagShowcase() {
  if (!scene || !bagShowcaseDice.length) return;
  for (const m of bagShowcaseDice) {
    scene.remove(m);
  }
  bagShowcaseDice = [];
}

/**
 * Create a static die mesh (same look as the main roller) without
 * touching the global `die` / roll state.
 */
function createShowcaseDie(type, d10OverlayNums = null) {
  let geometry = makeGeometryFor(type);
  geometry.computeVertexNormals();
  geometry = geometry.toNonIndexed();

  if (type === 'd6') {
    applyBoxFaceUVs_For12Triangles(geometry);
  } else if (type === 'd12') {
    applyPentagonGroupsUVs_ForD12(geometry);
  } else if (type === 'd10') {
    // Same UV layout as the main d10 so orientation math matches.
    applyKiteUVs_ForD10(geometry);
  } else {
    applyTriangleUVs(geometry);
  }


  const faceCount = geometry.attributes.position.count / 3;

  if (type === 'd10') {
    numbering.d10 = buildD10Numbering(geometry);
  } else if (type === 'd12') {
    numbering.d12 = buildD12Numbering(geometry);
  }

  let order = numbering[type];
  if (!order || order.length !== faceCount) {
    numbering[type] = Array.from({ length: faceCount }, (_, i) => i + 1);
    order = numbering[type];
  }

  let mesh;

  if (type === 'd10') {
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mats = Array.from({ length: faceCount }, () => white);
    geometry.clearGroups();
    for (let i = 0; i < faceCount; i++) geometry.addGroup(i * 3, 3, i);
    mesh = new THREE.Mesh(geometry, mats);

    const overlayNums = d10OverlayNums || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    attachD10Overlays(mesh, overlayNums);
  } else if (type === 'd6') {
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mats = Array.from({ length: faceCount }, () => white);
    geometry.clearGroups();
    for (let i = 0; i < faceCount; i++) geometry.addGroup(i * 3, 3, i);
    mesh = new THREE.Mesh(geometry, mats);
    attachD6Overlays(mesh);
  } else if (type === 'd12' || type === 'd4' || type === 'd8' || type === 'd20') {
    const mats = [];
    for (let i = 0; i < faceCount; i++) {
      const texture = createNumberTexture(order[i], type);
      mats.push(new THREE.MeshBasicMaterial({ map: texture }));
    }
    geometry.clearGroups();
    for (let i = 0; i < faceCount; i++) geometry.addGroup(i * 3, 3, i);
    mesh = new THREE.Mesh(geometry, mats);
  } else {
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    mesh = new THREE.Mesh(geometry, white);
  }

  const edges = new THREE.EdgesGeometry(geometry);
  const outline = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x000000 })
  );
  mesh.add(outline);

  scene.add(mesh);
  return mesh;
}

/**
 * Spawn a "set" of dice in a loose cluster around table center when
 * the bag is open. They sit still at slightly different sizes and
 * orientations just for aesthetics.
 */
function spawnBagShowcase() {
  ensureScene();
  clearBagShowcase();

  const types = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
  const centerX = 0;
  const centerZ = 0.2;
  const radius = 1.3;

  types.forEach((type, index) => {
    const angle =
      (index / types.length) * Math.PI * 2 + (Math.random() * 0.3 - 0.15);
    const r = radius * (0.9 + Math.random() * 0.2);
    const x = centerX + Math.cos(angle) * r;
    const z = centerZ + Math.sin(angle) * r;

    const mesh = createShowcaseDie(type);
    const s = DIE_BASE_SCALE * (0.85 + Math.random() * 0.4);
    mesh.scale.set(s, s, s);

    mesh.position.set(x, restY, z);
    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );

    bagShowcaseDice.push(mesh);
  });
}


// ============================================================================
// RESULT HUD  [SAME LOGIC, BUT ENSURES ITS ELEMENT]
// ============================================================================
function showResult(n) {
  const el = ensureResultEl();
  el.textContent = `🎲 ${n}`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// ============================================================================
// SETTLE HELPERS (GENERIC)  [UNCHANGED LOGIC]
// ============================================================================
function getDieWorldCenter() {
  const p = new THREE.Vector3();
  die.getWorldPosition(p);
  return p;
}
function getFaceCentersWorld() {
  const out = [];
  const g = die.geometry;
  const pos = g.attributes.position;
  die.updateMatrixWorld(true);
  const dieCenterW = getDieWorldCenter();
  for (let i = 0; i < pos.count; i += 3) {
    const a = new THREE.Vector3()
      .fromBufferAttribute(pos, i)
      .applyMatrix4(die.matrixWorld);
    const b = new THREE.Vector3()
      .fromBufferAttribute(pos, i + 1)
      .applyMatrix4(die.matrixWorld);
    const c = new THREE.Vector3()
      .fromBufferAttribute(pos, i + 2)
      .applyMatrix4(die.matrixWorld);
    const centerW = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    const dirFromDie = new THREE.Vector3()
      .subVectors(centerW, dieCenterW)
      .normalize();
    out.push({
      faceIndex: i / 3,
      number: (numbering[currentDie] || [])[i / 3],
      centerW,
      dirFromDie
    });
  }
  return out;
}
function getFacingNumber() {
  if (currentDie === 'd6') return getFacingNumberD6();
  const dieCenterW = getDieWorldCenter();
  const dieToCam = new THREE.Vector3()
    .subVectors(camera.position, dieCenterW)
    .normalize();
  const faces = getFaceCentersWorld();
  let best = null,
    bestDot = -Infinity;
  for (const f of faces) {
    const d = f.dirFromDie.dot(dieToCam);
    if (d > bestDot) {
      bestDot = d;
      best = f;
    }
  }
  return best ? best.number : 1;
}
function getFacingNumberD6() {
  const dieCenterW = getDieWorldCenter();
  const dieToCam = new THREE.Vector3()
    .subVectors(camera.position, dieCenterW)
    .normalize();
  const q = new THREE.Quaternion();
  die.getWorldQuaternion(q);
  const faces = [
    { num: 1, n: new THREE.Vector3(0, 0, 1) },
    { num: 6, n: new THREE.Vector3(0, 0, -1) },
    { num: 2, n: new THREE.Vector3(0, 1, 0) },
    { num: 5, n: new THREE.Vector3(0, -1, 0) },
    { num: 3, n: new THREE.Vector3(1, 0, 0) },
    { num: 4, n: new THREE.Vector3(-1, 0, 0) }
  ];
  let bestNum = 1,
    bestDot = -Infinity;
  for (const f of faces) {
    const nW = f.n.clone().applyQuaternion(q);
    const d = nW.dot(dieToCam);
    if (d > bestDot) {
      bestDot = d;
      bestNum = f.num;
    }
  }
  return bestNum;
}
function getFaceAxesWorldD6(number) {
  const local = {
    1: {
      n: new THREE.Vector3(0, 0, 1),
      up: new THREE.Vector3(0, 1, 0)
    },
    6: {
      n: new THREE.Vector3(0, 0, -1),
      up: new THREE.Vector3(0, 1, 0)
    },
    2: {
      n: new THREE.Vector3(0, 1, 0),
      up: new THREE.Vector3(0, 0, -1)
    },
    5: {
      n: new THREE.Vector3(0, -1, 0),
      up: new THREE.Vector3(0, 0, 1)
    },
    3: {
      n: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0)
    },
    4: {
      n: new THREE.Vector3(-1, 0, 0),
      up: new THREE.Vector3(0, 1, 0)
    }
  }[number];
  if (!local) return null;
  const q = new THREE.Quaternion();
  die.getWorldQuaternion(q);
  return {
    normalW: local.n.clone().applyQuaternion(q).normalize(),
    upW: local.up.clone().applyQuaternion(q).normalize()
  };
}
function getFaceTextureAxesWorld(number) {
  if (!die) return null;
  if (currentDie === 'd6') return getFaceAxesWorldD6(number);

  const g = die.geometry,
    pos = g.attributes.position,
    uv = g.attributes.uv;
  const nmat = new THREE.Matrix3();
  nmat.getNormalMatrix(die.matrixWorld);
  for (let i = 0; i < pos.count; i += 3) {
    const faceNum = (numbering[currentDie] || [])[i / 3];
    if (faceNum !== number) continue;
    const p1 = new THREE.Vector3().fromBufferAttribute(pos, i);
    const p2 = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
    const p3 = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
    const uv1 = new THREE.Vector2().fromBufferAttribute(uv, i);
    const uv2 = new THREE.Vector2().fromBufferAttribute(uv, i + 1);
    const uv3 = new THREE.Vector2().fromBufferAttribute(uv, i + 2);
    const e1 = new THREE.Vector3().subVectors(p2, p1);
    const e2 = new THREE.Vector3().subVectors(p3, p1);
    const du1 = uv2.x - uv1.x,
      dv1 = uv2.y - uv1.y;
    const du2 = uv3.x - uv1.x,
      dv2 = uv3.y - uv1.y;
    const r = du1 * dv2 - dv1 * du2;
    if (Math.abs(r) < 1e-8) {
      const nLocal = new THREE.Vector3().crossVectors(e1, e2).normalize();
      const nW = nLocal.clone().applyMatrix3(nmat).normalize();
      const centerLocal = new THREE.Vector3()
        .add(p1)
        .add(p2)
        .add(p3)
        .divideScalar(3);
      const upLocal = new THREE.Vector3()
        .subVectors(p1, centerLocal)
        .normalize();
      const upW = upLocal.clone().applyMatrix3(nmat).normalize();
      return { normalW: nW, upW };
    }
    const tangent = new THREE.Vector3()
      .copy(e1)
      .multiplyScalar(dv2)
      .addScaledVector(e2, -dv1)
      .multiplyScalar(1 / r);
    const bitangent = new THREE.Vector3()
      .copy(e2)
      .multiplyScalar(du1)
      .addScaledVector(e1, -du2)
      .multiplyScalar(1 / r);
    const nLocal = new THREE.Vector3().crossVectors(e1, e2).normalize();
    const tW = tangent.clone().applyMatrix3(nmat).normalize();
    let bW = bitangent.clone().applyMatrix3(nmat).normalize();
    const nW = nLocal.clone().applyMatrix3(nmat).normalize();
    if (new THREE.Vector3().crossVectors(tW, bW).dot(nW) < 0) bW.negate();
    return { normalW: nW, upW: bW };
  }
  return null;
}
function cameraUpWorld() {
  return new THREE.Vector3(0, 1, 0)
    .applyQuaternion(camera.quaternion)
    .normalize();
}
function settleToVisibleFace(number, duration = 700) {
  const axes = getFaceTextureAxesWorld(number);
  if (!axes) return;
  const { normalW: nW0, upW: upW0 } = axes;
  const dieCenterW = getDieWorldCenter();
  const faceOut = new THREE.Vector3()
    .subVectors(camera.position, dieCenterW)
    .normalize();
  let axis1 = new THREE.Vector3().crossVectors(nW0, faceOut);
  const dot1 = THREE.MathUtils.clamp(nW0.dot(faceOut), -1, 1);
  let angle1 = Math.acos(dot1);
  if (axis1.lengthSq() < 1e-12 || angle1 < 1e-6) {
    axis1.set(0, 0, 1);
    angle1 = 0;
  } else {
    axis1.normalize();
  }
  const delta1 = new THREE.Quaternion().setFromAxisAngle(axis1, angle1);
  const upAfter1 = upW0.clone().applyQuaternion(delta1).normalize();
  const camUp = cameraUpWorld();
  const camUpProj = camUp
    .clone()
    .sub(faceOut.clone().multiplyScalar(camUp.dot(faceOut)))
    .normalize();
  let angle2 = 0,
    delta2 = new THREE.Quaternion();
  if (isFinite(camUpProj.x) && camUpProj.lengthSq() > 1e-10) {
    const cross2 = new THREE.Vector3().crossVectors(upAfter1, camUpProj);
    const sign2 = Math.sign(cross2.dot(faceOut));
    const dot2 = THREE.MathUtils.clamp(upAfter1.dot(camUpProj), -1, 1);
    angle2 = Math.acos(dot2) * (sign2 || 1);
    delta2.setFromAxisAngle(faceOut, angle2);
  } else {
    delta2.identity();
  }
  const deltaWorld = new THREE.Quaternion().multiplyQuaternions(
    delta2,
    delta1
  );
  const currentWorldQ = new THREE.Quaternion();
  die.getWorldQuaternion(currentWorldQ);
  const targetWorldQ = new THREE.Quaternion().multiplyQuaternions(
    deltaWorld,
    currentWorldQ
  );
  let targetLocalQ = targetWorldQ.clone();
  if (die.parent) {
    const parentWorldQ = new THREE.Quaternion();
    die.parent.getWorldQuaternion(parentWorldQ);
    targetLocalQ = parentWorldQ.clone().invert().multiply(targetWorldQ);
  }
  const startQ = die.quaternion.clone();
  const start = performance.now();
  function tick(t) {
    const e = Math.min(1, (t - start) / duration);
    const ease = 1 - Math.pow(1 - e, 3);
    const q = new THREE.Quaternion().slerpQuaternions(
      startQ,
      targetLocalQ,
      ease
    );
    die.setRotationFromQuaternion(q);
    if (e < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ============================================================================
// SHADOW UPDATER  [UNCHANGED LOGIC]
// ============================================================================
function updateBlobShadow() {
  if (!blobShadow || !die) return;
  blobShadow.position.x = die.position.x;
  blobShadow.position.z = die.position.z;
  const h = Math.max(0.01, die.position.y - restY);
  const s = THREE.MathUtils.clamp(1.2 + h * 0.25, 0.9, 2.8);
  blobShadow.scale.set(s, s, 1);
  blobShadow.material.opacity = THREE.MathUtils.clamp(
    0.6 - h * 0.08,
    0.08,
    0.6
  );
}

// ============================================================================
// ROLLERS (GENERIC DIE)  [UNCHANGED LOGIC, NOW SUPPORTS SEEDED RNG]
// ============================================================================

// Simple 32-bit LCG for deterministic [0,1) given a seed
function makeSeededRNG(seed) {
  let s = (Number(seed) >>> 0) || 1;
  return function rand() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function getDieSidesCount(kind) {
  switch (String(kind).toLowerCase()) {
    case 'd4':  return 4;
    case 'd6':  return 6;
    case 'd8':  return 8;
    case 'd10': return 10;
    case 'd12': return 12;
    case 'd20': return 20;
    default:    return 20;
  }
}

function roll(type, options = true) {

  ensureScene();
  ensureResultEl();

  // Normalize options:
  //   - boolean → { cinematic: boolean }
  //   - object  → { cinematic, rng }
  const opts =
    typeof options === 'object' && options !== null
      ? options
      : { cinematic: options };

  const cinematic = opts.cinematic !== false;
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
  const targetValue =
    typeof opts.targetValue === 'number' && opts.targetValue > 0
      ? Math.floor(opts.targetValue)
      : null;


  // Clear any static "bag" dice when doing an actual roll.
  clearBagShowcase();

  // Clear any leftover D100 dice when rolling a normal die.
  if (d100Dice.length) {
    for (const m of d100Dice) scene.remove(m);
    d100Dice = [];
  }

  if (die) scene.remove(die);
  die = createDie(type);

  const startY = cinematic ? 6.5 : 6.0;
  const startZ = cinematic ? 0.4 : (rng() - 0.5) * 0.6;
  const startX = cinematic ? 0 : (rng() - 0.5) * 0.6;
  die.position.set(startX, startY, startZ);

  const baseScale = cinematic ? DIE_CINE_SCALE : DIE_NORMAL_SCALE;
  die.scale.set(baseScale, baseScale, baseScale);

  die.rotation.set(
    rng() * Math.PI,
    rng() * Math.PI,
    rng() * Math.PI
  );

  const start = performance.now();
  const duration = cinematic ? 1400 : 1200;
  const spinX =
    Math.PI * (cinematic ? 7 + rng() * 5 : 6 + rng() * 4);
  const spinY =
    Math.PI * (cinematic ? 7 + rng() * 5 : 6 + rng() * 4);
  const spinZ =
    Math.PI * (cinematic ? 3 + rng() * 2 : 2 + rng() * 2);

  const easeOutCubic = x => 1 - Math.pow(1 - x, 3);
  function easeOutBounce(x) {
    const n1 = 7.5625,
      d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    else if (x < 2 / d1) {
      x -= 1.5 / d1;
      return n1 * x * x + 0.75;
    } else if (x < 2.5 / d1) {
      x -= 2.25 / d1;
      return n1 * x * x + 0.9375;
    } else {
      x -= 2.625 / d1;
      return n1 * x * x + 0.984375;
    }
  }

  function animate(time) {
    const t = Math.min(1, (time - start) / duration);
    const yNorm = easeOutBounce(t);
    die.position.y = THREE.MathUtils.lerp(startY, restY, yNorm);

    if (cinematic) {
      die.position.z = THREE.MathUtils.lerp(startZ, 0.0, easeOutCubic(t));
      die.position.x = THREE.MathUtils.lerp(startX, 0.0, t);
    } else {
      die.position.x *= 1 - 0.02;
      die.position.z *= 1 - 0.02;
    }

    const spinEase = 1 - t * (cinematic ? 0.9 : 0.85);
    die.rotation.x += (spinX * 0.016) * spinEase;
    die.rotation.y += (spinY * 0.016) * spinEase;
    die.rotation.z += (spinZ * 0.016) * spinEase;

    renderer.render(scene, camera);
    if (t < 1) requestAnimationFrame(animate);
    else {
      // We now prefer a pre-chosen targetValue (for seeded RTC rolls).
      const value = targetValue || getFacingNumber(type);

      if (targetValue) {
        try {
          // Snap to the chosen face so both peers see the same result.
          settleToVisibleFace(value, 600);
        } catch (e) {
          console.warn('[Dice3D] settleToVisibleFace failed', e);
        }
      }

      showResult(value);
      if (typeof onResultCb === 'function') {
        onResultCb({ kind: type, value });
      }
    }
  }
  requestAnimationFrame(animate);
}


// ============================================================================
// DEBUG SNAP (kept, no UI)
// ============================================================================
function rotateFaceNumberTowardCamera(number) {
  if (!die) return;
  const geometry = die.geometry;
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 3) {
    const faceNum = (numbering[currentDie] || [])[i / 3];
    if (faceNum === number) {
      const a = new THREE.Vector3().fromBufferAttribute(position, i);
      const b = new THREE.Vector3().fromBufferAttribute(position, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(position, i + 2);
      const center = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3).normalize();
      const axis = new THREE.Vector3()
        .crossVectors(center, new THREE.Vector3(0, 0, 1))
        .normalize();
      const angle = center.angleTo(new THREE.Vector3(0, 0, 1));
      const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      die.setRotationFromQuaternion(q);
      break;
    }
  }
}

// ============================================================================
// DICE BAG OVERLAY (NEW UI LAYER)
// ============================================================================
function openBagOverlay() {
  ensureScene();
  ensureResultEl();

  const root = ensureOverlayRoot();
  root.style.display = 'block';

  // Always (re)spawn the static dice set on the table when the bag opens.
  spawnBagShowcase();

  // Only build the DOM bag UI once.
  if (bagEl && bagEl.isConnected) return;


  bagEl = document.createElement('div');
  bagEl.className = 'dice3d-bag';
  bagEl.innerHTML = `
    <div class="dice3d-bag-header">
      <span>Dice Bag</span>
      <button type="button" class="dice3d-close">&times;</button>
    </div>
    <div class="dice3d-bag-row">
      <button type="button" class="dice3d-btn" data-die="d4">D4</button>
      <button type="button" class="dice3d-btn" data-die="d6">D6</button>
      <button type="button" class="dice3d-btn" data-die="d8">D8</button>
      <button type="button" class="dice3d-btn" data-die="d10">D10</button>
      <button type="button" class="dice3d-btn" data-die="d12">D12</button>
      <button type="button" class="dice3d-btn" data-die="d20">D20</button>
      <button type="button" class="dice3d-btn" data-die="d100">D100</button>
    </div>
  `;
  root.appendChild(bagEl);

  const closeBtn = bagEl.querySelector('.dice3d-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      clearBagShowcase();
      if (bagEl && bagEl.parentNode === root) root.removeChild(bagEl);
      bagEl = null;
      root.style.display = 'none';
    });
  }


  const buttons = bagEl.querySelectorAll('[data-die]');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const dieType = btn.getAttribute('data-die');

      // 🔹 Deterministic seed for this roll (32-bit)
      const seed =
        (Date.now() & 0xffffffff) ^
        (Math.floor(Math.random() * 0x100000000) & 0xffffffff);

      // 🔹 Roll locally immediately using the same seed.
      //     Dice3D.roll() now returns { kind, seed, value } where `value`
      //     is the RNG-chosen face it will settle to.
      let outcome = null;
      try {
        outcome = Dice3D.roll(dieType, { seed });
      } catch (e) {
        console.warn('[Dice3D] Local seeded roll failed', e, { dieType, seed });
      }

      // 🔹 Broadcast to remote peer so they replay the same seeded roll.
      //     We also include the resolved value for logging / UI on the
      //     receiver, even though the seed alone is enough for determinism.
      try {
        const seat =
          typeof window.mySeat === 'function'
            ? Number(window.mySeat()) || 1
            : 1;

        const packet = {
          type: 'dice:roll',
          die: dieType,
          seed,
          value: outcome && typeof outcome.value === 'number'
            ? outcome.value
            : null,
          seat
        };

        window.peer?.send?.(packet);
        console.log('[Dice3D] Sent RTC dice roll', packet);
      } catch (e) {
        console.warn('[Dice3D] Failed to send RTC dice roll', e);
      }
    });
  });

}

// ============================================================================
// PUBLIC API
// ============================================================================
export const Dice3D = {
  /**
   * Initialize the module. Optional callback when a roll completes.
   *   Dice3D.init({ onResult: ({ kind, value, ... }) => {} });
   */
  init(opts = {}) {
    if (typeof opts.onResult === 'function') {
      onResultCb = opts.onResult;
    }
    ensureScene();
    ensureResultEl();
  },

  /** Open the dice bag overlay so user can pick a die and roll it. */
  /** Open the dice bag overlay so user can pick a die and roll it. */
  openBag() {
    openBagOverlay();
  },

  // Alias for RTC handler convenience (Dice3D.open())
  open() {
    openBagOverlay();
  },

  /**
   * Directly roll a specific die (e.g. 'd20', 'd6', 'd100').
   * Supports:
   *   Dice3D.roll('d20');          // cinematic, unseeded
   *   Dice3D.roll('d20', false);   // non-cinematic, unseeded
   *   Dice3D.roll('d20', 12345);   // cinematic, seeded
   *   Dice3D.roll('d20', { seed: 12345, cinematic: false });
   */
  roll(type = 'd20', arg = true) {
    let cinematic = true;
    let seed = null;

    if (typeof arg === 'boolean') {
      cinematic = arg;
    } else if (typeof arg === 'number') {
      seed = arg;
    } else if (typeof arg === 'object' && arg !== null) {
      if ('cinematic' in arg) cinematic = !!arg.cinematic;
      if ('seed' in arg && arg.seed != null) seed = Number(arg.seed);
    }

    let rng = Math.random;
    if (Number.isFinite(seed)) {
      rng = makeSeededRNG(seed);
    }

    // 🎯 Pick the face number up-front using the same RNG that will
    // drive the animation. This makes the "landed on" value deterministic
    // across peers given the same seed.
    let value = null;

    if (String(type).toLowerCase() === 'd100') {
      // 1–100 range for the percentile pair
      value = 1 + Math.floor(rng() * 100);
      rollD100({ rng, forcedTotal: value });
    } else {
      const sides = getDieSidesCount(type);
      value = 1 + Math.floor(rng() * sides);
      roll(type, { cinematic, rng, targetValue: value });
    }

    const root = ensureOverlayRoot();
    root.style.display = 'block';

    // Let callers (like the bag UI) grab seed + value for RTC packets.
    return { kind: type, seed, value };
  },



  /** Hide overlay root (canvas + bag + HUD) if you want to dismiss it. */
  hide() {
    const root = ensureOverlayRoot();
    root.style.display = 'none';
    if (bagEl && bagEl.parentNode === root) root.removeChild(bagEl);
    bagEl = null;
    clearBagShowcase();
  },


  /** Debug helper if you want it later. */
  debugSnap(number) {
    rotateFaceNumberTowardCamera(number);
  }
};

if (typeof window !== 'undefined') {
  window.Dice3D = Dice3D;
}

// === Future Plan ===========================================================
// - Add deterministic seeding so RTC peers can replay identical rolls.
// - 

// - Add deterministic seeding so RTC peers can replay identical rolls.
// - Integrate with your RTC bus: emit { kind, seed } and have both sides call
//     Dice3D.roll(kind, { seed }) using the same random stream.
// - Allow “quick die” starring in the bag and wire to quickDiceBtn.
// dice.3d.js (or wherever your dice bag lives)

// Example dice API – adapt to your real module:
//   Dice3D.open();
//   Dice3D.roll(kind, seed);

(function installDiceRTCHandler(){
  // Avoid double-registration during hot reloads
  if (window.__handleDiceRollFromRTC) return;

  window.__handleDiceRollFromRTC = async function(msg){
    try {
      const kind = (msg.die || msg.kind || 'd20').toString().toLowerCase();
      const seed = Number(msg.seed) || Date.now();

      // Open/show your dice roller UI (overlay, canvas, whatever)
      if (typeof window.Dice3D?.open === 'function') {
        await window.Dice3D.open();
      }

      // Roll that specific die, seeded so both sides use the same value
      if (typeof window.Dice3D?.roll === 'function') {
        window.Dice3D.roll(kind, { seed });
      } else {
        console.warn('[Dice3D] roll(kind, {seed}) not available', { kind, seed });
      }

    } catch (e) {
      console.warn('[Dice3D] __handleDiceRollFromRTC failed', e, msg);
    }
  };
})();
