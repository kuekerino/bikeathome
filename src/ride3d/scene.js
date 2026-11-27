/*
 * bikeathome's 3D view: golden-hour-ride's renderer, following bikeathome's ride engine.
 *
 * Ported from https://github.com/jamiemarsland/golden-hour-ride (index.html),
 * Copyright (c) 2026 Jamie Marsland, MIT licence: see LICENSE.golden-hour-ride.
 *
 * What changed: the course arrives from bikeathome as data; speed and distance come from bikeathome's
 * engine instead of this file's own physics; its trainer, power slider, ride log and voice control are
 * gone, because bikeathome does all of that; roads may be open as well as loops; riding on the right where
 * the course says so; water at sea level; terrain kept under the road on coarse cells; no grass on any road.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { Follower } from '../lib/ride3d/follow';

main().catch(err => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'The 3D view could not start: ' + (err && err.message ? err.message : err);
});

async function main() {
const V3 = THREE.Vector3;
const $ = id => document.getElementById(id);

/* ---------- bikeathome ---------- */
const CREDIT = '3D view from golden-hour-ride by Jamie Marsland (MIT). Textures: Poly Haven (CC0).';

// Ask bikeathome for the course once loaded, and wait for it. Null means the invented valley.
function receiveCourse() {
  if (!EMBEDDED) return Promise.resolve(null);
  return new Promise(resolve => {
    addEventListener('message', function once(e) {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'course') return;
      removeEventListener('message', once);
      resolve(e.data.course || null);
    });
    parent.postMessage({ type: 'ready' }, location.origin);
  });
}

/* ---------- helpers ---------- */
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const hash = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
function ridged(x, y, o = 4) {       // sharp crests and gullies, for mountains
  let s = 0, a = 0.5, f = 1, prev = 1;
  for (let i = 0; i < o; i++) { let n = 1 - Math.abs(2 * vnoise(x * f, y * f) - 1); n *= n; s += n * a * prev; prev = n; f *= 2.1; a *= 0.5; }
  return s;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const canvas2d = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };

/* ---------- photo-scanned surfaces (Poly Haven, CC0) ---------- */
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('missing texture')); i.src = src; });
const TEX = ['asphalt_02_diff_2k', 'asphalt_02_nor_gl_2k', 'leafy_grass_diff_2k', 'leafy_grass_nor_gl_1k', 'rock_face_03_diff_1k', 'gravel_ground_01_diff_1k'];
const readable = img => { try { const [, g] = canvas2d(1, 1); g.drawImage(img, 0, 0, 1, 1); g.getImageData(0, 0, 1, 1); return true; } catch (e) { return false; } };
const imgs = await Promise.all(TEX.map(n => loadImg(`ride3d/${n}.jpg`)));
const [imgAsphalt, imgAsphaltN, imgGrass, imgGrassN, imgRock, imgGravel] = imgs;
const imgTex = (img, srgb) => {
  const t = new THREE.Texture(img); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO; t.needsUpdate = true; return t;
};

/* ---------- renderer ---------- */
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.33;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
$('c').addEventListener('webglcontextlost', e => {
  e.preventDefault(); console.warn('ride: graphics context lost');
  const b = document.createElement('div'); b.id = 'lost'; b.textContent = 'Graphics were reset by the browser. Reloading…';
  b.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:rgba(10,9,8,.8);letter-spacing:.1em;font-size:13px';
  document.body.append(b);
  setTimeout(() => location.reload(), 1500);
});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.05, 9000);
scene.add(camera);

/* ---------- sky, sun, haze ---------- */
// ?theme=christmas: the same valley under snow at dusk, with lights in the trees and a few chalets
const XMAS = false;
const SUN_ELEV = XMAS ? 4.5 : 11, SUN_AZ = -24;
const sunDir = new V3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SUN_ELEV), THREE.MathUtils.degToRad(SUN_AZ));
const sunFlat = new V3(sunDir.x, 0, sunDir.z).normalize();

const sky = new Sky();
sky.scale.setScalar(450000);
Object.assign(sky.material.uniforms.turbidity, { value: XMAS ? 5 : 7 });
Object.assign(sky.material.uniforms.rayleigh, { value: XMAS ? 3.2 : 2.2 });
Object.assign(sky.material.uniforms.mieCoefficient, { value: 0.004 });
Object.assign(sky.material.uniforms.mieDirectionalG, { value: 0.82 });
sky.material.uniforms.sunPosition.value.copy(sunDir);

const envScene = new THREE.Scene();
envScene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = pmrem.fromScene(envScene);
scene.environment = envRT.texture;

// Read the sky's own horizon colour so the haze melts into it.
function sampleSky(dir) {
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType });
  const cam = new THREE.PerspectiveCamera(2, 1, 0.1, 10);
  cam.lookAt(dir);
  renderer.setRenderTarget(rt);
  renderer.render(envScene, cam);
  const px = new Float32Array(64);
  renderer.readRenderTargetPixels(rt, 0, 0, 4, 4, px);
  renderer.setRenderTarget(null);
  rt.dispose();
  const ok = isFinite(px[0]) && px[0] + px[1] + px[2] > 0.01;
  return ok ? new THREE.Color(px[0], px[1], px[2]) : new THREE.Color(0.9, 0.62, 0.42);
}
const hazeDir = new V3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(88), THREE.MathUtils.degToRad(SUN_AZ + 55));
const hazeCol = sampleSky(hazeDir);
scene.add(sky);
scene.fog = new THREE.FogExp2(hazeCol, 0.0007);

const sun = new THREE.DirectionalLight(0xffb070, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 700 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(XMAS ? 0xa6b4ea : 0xa9b8ee, XMAS ? 0x9aa2b6 : 0x6b563a, 2.2);
scene.add(hemi);

/* ---------- course: the invented valley, or a real road built from survey data ---------- */
// Inside bikeathome the ride engine moves the rider. Opened on its own, the ride drifts along at a gentle pace
// with the weather slowly changing, as golden-hour-ride's scenery mode does.
const EMBEDDED = window.parent !== window;
const SCENERY = EMBEDDED ? null : '';
let real = null;
const received = await receiveCourse();
if (received) {
  real = received;
  real.osm = real.osm || { buildings: [], trees: [], lines: [], woods: '', credit: '' };
  const wb = Uint8Array.from(atob(real.osm.woods), c => c.charCodeAt(0));
  real.wood = (x, z) => {                 // is this spot mapped as woodland?
    const g = real.cells, ix = Math.round((x + real.size / 2) / (real.size / g)), iz = Math.round((z + real.size / 2) / (real.size / g));
    if (ix < 0 || iz < 0 || ix > g || iz > g) return false;
    const i = iz * (g + 1) + ix; return ((wb[i >> 3] >> (i & 7)) & 1) === 1;
  };
  const raw = Uint8Array.from(atob(real.dem), c => c.charCodeAt(0)), q = new Uint16Array(raw.buffer);
  real.h = Float32Array.from(q, v => real.demMin + v / 65535 * (real.demMax - real.demMin));     // surveyed ground heights, metres
}
$('credit').textContent = [real && real.credit, real && real.osm.credit, CREDIT].filter(Boolean).join(' ');
function demH(x, z) {                 // the real ground under a point
  const g = real.cells, w = g + 1, f = v => Math.min(g - 1e-6, Math.max(0, (v + real.size / 2) / (real.size / g)));
  const fx = f(x), fz = f(z), ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, h = real.h;
  return (h[iz * w + ix] * (1 - u) + h[iz * w + ix + 1] * u) * (1 - v) + (h[(iz + 1) * w + ix] * (1 - u) + h[(iz + 1) * w + ix + 1] * u) * v;
}

const st0 = {};        // build counts, for checking

/* ---------- the road line ---------- */
const ctrl = [];
if (real) for (const p of real.road) ctrl.push(new V3(p[0], p[1], p[2]));
else for (let i = 0; i < 22; i++) {
  const a = i / 22 * Math.PI * 2;
  const r = 430 + 110 * Math.sin(a * 3 + 0.6) + 60 * Math.sin(a * 5 + 2.1);
  ctrl.push(new V3(Math.cos(a) * r, 40 + 16 * Math.sin(a * 2 + 1) + 4 * Math.sin(a * 5), Math.sin(a) * r));
}
const CLOSED = !real || real.loop !== false;         // a route from A to B is drawn open, and the ride stops at its end
const curve = new THREE.CatmullRomCurve3(ctrl, CLOSED, 'centripetal');
curve.arcLengthDivisions = Math.max(4000, ctrl.length * 12);
const LEN = curve.getLength();
const N = Math.floor(LEN / 1.5);
const P = CLOSED ? curve.getSpacedPoints(N).slice(0, N) : curve.getSpacedPoints(N - 1);
const ENDS = CLOSED ? N : N - 1;                      // strips join the last point back to the first only on a loop
const nb = (i, d) => CLOSED ? (i + d + N) % N : Math.min(N - 1, Math.max(0, i + d));
const T = P.map((_, i) => new V3().subVectors(P[nb(i, 1)], P[nb(i, -1)]).normalize());
const R = T.map(t => new V3(-t.z, 0, t.x).normalize());

function at(s, out) {
  const f = CLOSED ? (((s % LEN) + LEN) % LEN) / LEN * N : Math.min(LEN, Math.max(0, s)) / LEN * (N - 1);
  const i = CLOSED ? Math.floor(f) % N : Math.min(N - 2, Math.floor(f)), j = CLOSED ? (i + 1) % N : i + 1;
  const k = CLOSED ? f - Math.floor(f) : f - i;
  out.p.lerpVectors(P[i], P[j], k);
  out.t.lerpVectors(T[i], T[j], k).normalize();
  out.r.set(-out.t.z, 0, out.t.x).normalize();
  return out;
}
const mkPose = () => ({ p: new V3(), t: new V3(), r: new V3() });

// Spatial hash so "how far is this point from the road" is cheap.
const CELL = 64, grid = new Map(), gkey = (cx, cz) => cx * 4096 + cz;
P.forEach((p, i) => {
  const k = gkey(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
  (grid.get(k) || grid.set(k, []).get(k)).push(i);
});
const near = { d: 0, y: 0, i: 0, side: 0 };
function nearRoad(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let best = 1e12, bi = -1;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const arr = grid.get(gkey(cx + dx, cz + dz));
    if (!arr) continue;
    for (const i of arr) { const ex = x - P[i].x, ez = z - P[i].z, d2 = ex * ex + ez * ez; if (d2 < best) { best = d2; bi = i; } }
  }
  if (bi < 0) return null;
  const ex = x - P[bi].x, ez = z - P[bi].z;
  near.d = Math.sqrt(best); near.i = bi;
  near.y = P[bi].y + T[bi].y * (ex * T[bi].x + ez * T[bi].z);
  near.side = ex * R[bi].x + ez * R[bi].z;
  return near;
}

/* ---------- terrain ---------- */
function baseH(x, z) {
  if (real) return demH(x, z);
  const r = Math.hypot(x, z) || 1;
  let h = 40 + (fbm(x / 300 + 5, z / 300 + 9) - 0.5) * 110 + (fbm(x / 60, z / 60, 4) - 0.5) * 14;
  const gap = smooth(0.55, 0.95, (x * sunFlat.x + z * sunFlat.z) / r);   // valley opens toward the sun
  h += (ridged(x / 120 + 7, z / 120 + 3, 3) - 0.25) * 14;                                     // knolls and hollows on the near hills
  const mtn = smooth(720, 1500, r) * (1 - 0.92 * gap);
  h += mtn * (90 + fbm(x / 420 + 40, z / 420, 5) * 400 + ridged(x / 300 + 11, z / 300 + 5) * 300 + ridged(x / 75, z / 75, 3) * 55);
  return h;
}
function terrainH(x, z) {
  const b = baseH(x, z), n = nearRoad(x, z);
  if (!n) return b;
  const k = real ? smooth(Math.max(6, TC * 0.8), Math.max(34, TC * 2.2), n.d) : smooth(9, 62, n.d);     // a real hillside keeps its shape closer to the road
  return (n.y - 0.6) * (1 - k) + b * k;
}
const TS = real ? real.size : 3200, TG = real ? real.cells : 400, TC = TS / TG, TW = TG + 1;
const H = new Float32Array(TW * TW);
const tPos = new Float32Array(TW * TW * 3), tUv = new Float32Array(TW * TW * 2), tCol = new Float32Array(TW * TW * 3);
for (let iz = 0; iz < TW; iz++) for (let ix = 0; ix < TW; ix++) {
  const x = -TS / 2 + ix * TC, z = -TS / 2 + iz * TC, k = iz * TW + ix, h = terrainH(x, z);
  H[k] = h; tPos.set([x, h, z], k * 3); tUv.set([x / 4, z / 4], k * 2);
}
const tIdx = new Uint32Array(TG * TG * 6);
for (let iz = 0, q = 0; iz < TG; iz++) for (let ix = 0; ix < TG; ix++) {
  const a = iz * TW + ix, b = a + TW, c = b + 1, d = a + 1;
  tIdx[q++] = a; tIdx[q++] = b; tIdx[q++] = d; tIdx[q++] = b; tIdx[q++] = c; tIdx[q++] = d;
}
// Exact height of the rendered mesh (so grass and trees sit on it, not near it).
function meshH(x, z) {
  const fx = (x + TS / 2) / TC, fz = (z + TS / 2) / TC;
  const ix = Math.min(TG - 1, Math.max(0, Math.floor(fx))), iz = Math.min(TG - 1, Math.max(0, Math.floor(fz)));
  const u = fx - ix, v = fz - iz, a = H[iz * TW + ix], b = H[(iz + 1) * TW + ix], c = H[(iz + 1) * TW + ix + 1], d = H[iz * TW + ix + 1];
  return u + v <= 1 ? a + (d - a) * u + (b - a) * v : c + (b - c) * (1 - u) + (d - c) * (1 - v);
}
const tGeo = new THREE.BufferGeometry();
tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
tGeo.setAttribute('uv', new THREE.BufferAttribute(tUv, 2));
tGeo.setIndex(new THREE.BufferAttribute(tIdx, 1));
tGeo.computeVertexNormals();
{
  const nrm = tGeo.attributes.normal.array, col = new THREE.Color();
  const gA = new THREE.Color(0.8, 0.95, 0.7), gB = new THREE.Color(1.3, 1.15, 0.75), white = new THREE.Color(1, 1, 1), tMix = new Float32Array(TW * TW * 2);
  for (let k = 0; k < TW * TW; k++) {
    const x = tPos[k * 3], h = tPos[k * 3 + 1], z = tPos[k * 3 + 2], ny = nrm[k * 3 + 1];
    const rk = smooth(0.86, 0.66, ny), sn = XMAS ? smooth(0.42, 0.72, ny) * 1.25 : smooth(330, 430, h) * smooth(0.5, 0.75, ny);
    col.copy(gA).lerp(gB, smooth(0.3, 0.7, fbm(x / 45, z / 45, 3))).lerp(white, rk);   // tint the grass, leave rock alone
    if (XMAS) { const d = 0.9 + 0.2 * fbm(x / 30, z / 30, 3); col.setRGB(d, d, d * 1.04); }          // drifts: faint light and shade across the snow
    tCol.set([col.r, col.g, col.b], k * 3); tMix.set([rk, sn], k * 2);
  }
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  tGeo.setAttribute('aMix', new THREE.BufferAttribute(tMix, 2));
  // Relief that reads from far away: gullies darker, crests lighter, and ridges casting long shadows across distant slopes.
  const shade = new Float32Array(TW * TW);
  for (let iz = 0; iz < TW; iz++) for (let ix = 0; ix < TW; ix++) {
    const k = iz * TW + ix, x = tPos[k * 3], h = H[k], z = tPos[k * 3 + 2];
    const around = H[iz * TW + Math.max(ix - 1, 0)] + H[iz * TW + Math.min(ix + 1, TG)] + H[Math.max(iz - 1, 0) * TW + ix] + H[Math.min(iz + 1, TG) * TW + ix];
    const cav = Math.min(1.2, Math.max(0.6, 1 - (around - 4 * h) * 0.06));
    tCol[k * 3] *= cav; tCol[k * 3 + 1] *= cav; tCol[k * 3 + 2] *= cav;
    let lit = 1, far = smooth(450, 650, Math.hypot(x, z));
    if (real) { const nr = nearRoad(x, z); far = smooth(120, 220, nr ? nr.d : 999); }       // on a real course the road goes everywhere: bake wherever the live shadows can't reach
    if (far > 0) for (let t = 20; t < 1400; t += 22) {            // walk toward the sun; does a ridge get in the way?
      const px = x + sunDir.x * t, pz = z + sunDir.z * t;
      if (Math.abs(px) > TS / 2 || Math.abs(pz) > TS / 2) break;
      lit = Math.min(lit, (h + 3 + sunDir.y * t - meshH(px, pz)) / t * 10);
      if (lit <= 0) { lit = 0; break; }
    }
    shade[k] = 1 - far * 0.58 * (1 - lit);
  }
  tGeo.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));
}
function speckleTex(size, base, spread, count) {
  const [c, g] = canvas2d(size, size);
  g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const l = base + (rnd() - 0.5) * spread | 0, s = 1 + rnd() * 3;
    g.fillStyle = `rgba(${l},${l},${l - 6},${0.3 + rnd() * 0.5})`; g.fillRect(rnd() * size, rnd() * size, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
  return t;
}
const rockMap = imgTex(imgRock, true);
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: imgTex(imgGrass, true), normalMap: imgTex(imgGrassN), roughness: 1 });
terrainMat.onBeforeCompile = s => {      // grass on the flats, rock on the steeps, snow up high; a second, larger sample hides the tiling
  s.uniforms.uRock = { value: rockMap }; s.uniforms.uSunAmt = uSunAmt;
  s.vertexShader = 'attribute vec2 aMix; attribute float aShade; varying vec2 vMix; varying float vShade;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vMix = aMix; vShade = aShade;');
  s.fragmentShader = 'uniform sampler2D uRock; uniform float uSunAmt; varying vec2 vMix; varying float vShade;\n' + s.fragmentShader.replace('#include <map_fragment>', `
    vec3 gc = mix(texture2D(map, vMapUv).rgb, texture2D(map, vMapUv * 0.137).rgb, 0.15);
    gc = mix(gc, vec3(gc.g * 0.6, gc.g * 1.05, gc.g * 0.35), 0.4);                       // lean the bare ground toward the grass colour, so the meadow's edge doesn't show
    vec3 r1 = texture2D(uRock, vMapUv * 0.3).rgb, r2 = texture2D(uRock, vMapUv * 0.041).rgb, r3 = texture2D(uRock, vMapUv * 0.009).rgb;
    float l2 = dot(r2, vec3(0.333)), l3 = dot(r3, vec3(0.333));
    vec3 rc = mix(r1, r2, 0.4) * (0.35 + l2 * 1.2 + l3 * 1.6);                          // light and dark bands across whole rock faces
    float rockAmt = smoothstep(0.3, 0.7, vMix.x + (l2 - 0.3) * 0.9);                     // ragged edges where grass gives way to rock
    float snowAmt = smoothstep(0.35, 0.65, vMix.y + (l3 - 0.3) * 0.8);
    diffuseColor.rgb *= mix(mix(gc, rc, rockAmt), ${XMAS ? 'vec3(0.66, 0.70, 0.78)' : 'vec3(0.92)'}, snowAmt) * mix(1., vShade, uSunAmt);`);
};
const terrain = new THREE.Mesh(tGeo, terrainMat);
terrain.receiveShadow = true; terrain.castShadow = true;
scene.add(terrain);
if (real && real.region) {     // where the survey has no ground, it is sea: water a little above it
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(TS * 3, TS * 3).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1d4e63, roughness: 0.12, metalness: 0.35 }));
  sea.position.y = 0.25; scene.add(sea);
}

/* ---------- road ---------- */
const TILES = Math.round(LEN / 12);
function strip(offA, dyA, offB, dyB, uA, uB, vTiles) {
  const pos = new Float32Array((N + 1) * 6), uv = new Float32Array((N + 1) * 4), idx = new Uint32Array(N * 6);
  for (let i = 0; i <= ENDS; i++) {
    const j = i % N, p = P[j], r = R[j];
    pos.set([p.x + r.x * offA, p.y + dyA, p.z + r.z * offA, p.x + r.x * offB, p.y + dyB, p.z + r.z * offB], i * 6);
    uv.set([uA, i / N * vTiles, uB, i / N * vTiles], i * 4);
    if (i < ENDS) idx.set([2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}
function asphaltTex() {
  const W = 1024, Hh = 2048, [c, g] = canvas2d(W * 2, Hh * 2);
  g.scale(2, 2);
  for (let x = 0; x < W; x += 439) for (let y = 0; y < Hh; y += 512) g.drawImage(imgAsphalt, x, y, 439, 512);   // 3 m scan tiles
  g.fillStyle = 'rgba(8,8,12,0.22)'; g.fillRect(0, 0, W, Hh);                                                     // damp
  for (const x of [0.2, 0.36, 0.64, 0.8]) {            // darker wheel tracks
    const gr = g.createLinearGradient((x - 0.06) * W, 0, (x + 0.06) * W, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.17)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect((x - 0.06) * W, 0, 0.12 * W, Hh);
  }
  for (let i = 0; i < 3; i++) {                        // repair patches
    const w = 120 + rnd() * 200, h = 200 + rnd() * 400;
    g.fillStyle = 'rgba(18,18,20,0.13)'; g.fillRect(rnd() * (W - w), rnd() * (Hh - h), w, h);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 14; i++) {                       // cracks
    let x = rnd() * W, y = rnd() * Hh, a = rnd() * 6.28;
    g.strokeStyle = 'rgba(10,10,12,0.75)'; g.lineWidth = 1 + rnd() * 2; g.beginPath(); g.moveTo(x, y);
    for (let k = 0, n = 20 + rnd() * 50; k < n; k++) { a += (rnd() - 0.5) * 1.1; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = 'rgba(224,220,206,0.92)';              // paint
  g.fillRect(36, 0, 16, Hh); g.fillRect(972, 0, 16, Hh); g.fillRect(505, 0, 14, Hh / 3);
  for (let i = 0; i < 6000; i++) {                     // worn paint
    const s = 1 + rnd() * 3;
    g.fillStyle = 'rgba(72,72,76,0.7)'; g.fillRect([36, 972, 505][i % 3] + rnd() * 16, rnd() * Hh, s, s * (1 + rnd() * 3));
  }
  if (XMAS) {                                          // snow ploughed to the edges, slush between the wheel tracks
    for (const [x0, x1] of [[0, 150], [W, W - 150]]) {
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, 'rgba(226,232,242,1)'); gr.addColorStop(0.45, 'rgba(214,222,234,0.85)'); gr.addColorStop(1, 'rgba(214,222,234,0)');
      g.fillStyle = gr; g.fillRect(Math.min(x0, x1), 0, 150, Hh);
    }
    for (let i = 0; i < 2600; i++) {
      const edge = rnd() < 0.7, x = edge ? (rnd() < 0.5 ? rnd() * 190 : W - rnd() * 190) : 440 + rnd() * 150, r = 3 + rnd() * (edge ? 16 : 9);
      g.fillStyle = `rgba(222,229,240,${edge ? 0.5 : 0.22})`; g.beginPath(); g.ellipse(x, rnd() * Hh, r, r * (1.5 + rnd() * 2.5), 0, 0, 6.283); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
  return t;
}
function wetTex() {   // roughness: mostly damp, with glassy standing water in the ruts and at the edges
  const S = 512, [c, g] = canvas2d(S, S);
  g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const edge = rnd() < 0.7, x = (edge ? (rnd() < 0.5 ? 0.04 + rnd() * 0.2 : 0.76 + rnd() * 0.2) : rnd()) * S;
    const y = 70 + rnd() * (S - 140), r = 8 + rnd() * 20;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(70,70,70,0.9)'); gr.addColorStop(0.4, 'rgba(70,70,70,0.6)'); gr.addColorStop(1, 'rgba(70,70,70,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAX_ANISO;
  t.repeat.set(1, Math.round(TILES / 3) / TILES);
  return t;
}
const asphaltMap = asphaltTex();
const asphaltNormal = imgTex(imgAsphaltN); asphaltNormal.repeat.set(7 / 3, 4);
const road = new THREE.Mesh(strip(-3.5, 0, 3.5, 0, 0, 1, TILES),
  new THREE.MeshStandardMaterial({ map: asphaltMap, roughnessMap: wetTex(), roughness: 1, metalness: 0, normalMap: asphaltNormal, normalScale: new THREE.Vector2(1.2, 1.2), envMapIntensity: 1 }));
road.receiveShadow = true;
scene.add(road);
road.material.onBeforeCompile = s => {      // rain rings: each small cell of road gets a ripple that spreads and fades
  s.uniforms.uTime = uTime; s.uniforms.uRain = rainU.uRain;
  s.vertexShader = 'varying vec3 vWp;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.)).xyz;');
  s.fragmentShader = `uniform float uTime, uRain; varying vec3 vWp;
    vec2 rip(vec2 p, float t){
      vec2 i = floor(p), f = fract(p) - 0.5;
      float h1 = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453), h2 = fract(h1 * 57.31 + 0.37);
      float life = fract(t * (0.7 + h2 * 0.6) + h1 * 7.);
      vec2 d = f - (vec2(h1, h2) - 0.5) * 0.24; float r = length(d) + 1e-4, R = life * 0.36;
      return d / r * sin((r - R) * 60.) * exp(-pow((r - R) * 14., 2.)) * (1. - life);
    }
  ` + s.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
    if (uRain > 0.01) {
      vec2 rp = rip(vWp.xz * 3.2, uTime) + rip(vWp.xz * 2.1 + 13.7, uTime * 0.9 + 3.);
      normal = normalize(normal + (viewMatrix * vec4(rp.x, 0., rp.y, 0.)).xyz * 0.5 * uRain * smoothstep(40., 8., length(vViewPosition)));
    }`);
};

function shoulderTex() {
  const [c, g] = canvas2d(512, 512);
  g.drawImage(imgGravel, 0, 0, 512, 512);
  const gr = g.createLinearGradient(0, 0, 512, 0);       // gravel at the road edge, overgrown further out
  gr.addColorStop(0, 'rgba(40,38,28,0.35)'); gr.addColorStop(0.3, 'rgba(46,58,24,0.8)'); gr.addColorStop(1, 'rgba(44,62,22,1)');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  if (XMAS) {                                          // a snowbank
    g.fillStyle = '#b4bccb'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1500; i++) { const l = 168 + rnd() * 40 | 0; g.fillStyle = `rgba(${l},${l + 5},${l + 16},0.5)`; g.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 10, 2 + rnd() * 6); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
  return t;
}
const shoulderMat = new THREE.MeshStandardMaterial({ map: shoulderTex(), roughness: 1 });
for (const g of [strip(-6.8, -0.72, -3.5, 0.005, 1, 0, LEN / 5), strip(3.5, 0.005, 6.8, -0.72, 0, 1, LEN / 5)]) {
  const m = new THREE.Mesh(g, shoulderMat); m.receiveShadow = true; scene.add(m);
}

/* ---------- grass along the verge (chunks, only the near ones are drawn) ---------- */
const uTime = { value: 0 }, uCloud = { value: 1 }, uMote = { value: 1 }, uMeadow = { value: new THREE.Vector2() }, uSunAmt = { value: 1 };
function grassTex() {
  const [c, g] = canvas2d(256, 256);
  for (let i = 0; i < 36; i++) {
    const x = 20 + rnd() * 216, h = 110 + rnd() * 140, lean = (rnd() - 0.5) * 90, w = 5 + rnd() * 5;
    const gr = g.createLinearGradient(0, 256, 0, 256 - h);
    gr.addColorStop(0, '#23360f'); gr.addColorStop(0.6, '#5b7824'); gr.addColorStop(1, rnd() < 0.45 ? '#cdb968' : '#90a43c');
    g.fillStyle = gr; g.beginPath(); g.moveTo(x - w / 2, 256);
    g.quadraticCurveTo(x + lean * 0.3, 256 - h * 0.6, x + lean, 256 - h);
    g.quadraticCurveTo(x + lean * 0.3 + w * 0.4, 256 - h * 0.6, x + w / 2, 256); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const tuftGeo = (() => {
  const parts = [0, 1, 2, 3].map(k => new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateY(k * Math.PI / 2));
  const g = mergeGeometries(parts), n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);    // light it like the ground it grows from
  return g;
})();
const grassMat = new THREE.MeshStandardMaterial({ map: grassTex(), alphaTest: 0.45, roughness: 1 });
grassMat.onBeforeCompile = s => {
  s.uniforms.uTime = uTime;
  s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    #ifdef USE_INSTANCING
      vec4 wp = instanceMatrix * vec4(0., 0., 0., 1.);
      float w = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.27) * 0.16 + sin(uTime * 3.3 + wp.x * 1.3) * 0.05;
      transformed.x += w * uv.y; transformed.z += w * 0.6 * uv.y;
    #endif`);
};
const chunks = [];
{
  const PER = 40, COUNT = 7000, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new V3(0, 1, 0), sc = new V3(), ps = new V3(), col = new THREE.Color();
  const build = c0 => {
    const mesh = new THREE.InstancedMesh(tuftGeo, grassMat, COUNT);
    for (let k = 0; k < COUNT; k++) {
      const i = c0 + Math.floor(rnd() * PER), side = rnd() < 0.5 ? -1 : 1, d = 3.55 + Math.pow(rnd(), 1.6) * 12.5, j = (rnd() - 0.5) * 1.5;
      const x = P[i].x + R[i].x * side * d + T[i].x * j, z = P[i].z + R[i].z * side * d + T[i].z * j;
      let y = meshH(x, z);
      if (d < 6.8) y = Math.max(y, P[i].y + T[i].y * j - 0.72 * (d - 3.5) / 3.3);
      const tall = 0.28 + rnd() * 0.5 + (d > 5 ? rnd() * 0.25 : 0);
      ps.set(x, y - 0.03, z); q.setFromAxisAngle(up, rnd() * 6.283); sc.set(0.5 + rnd() * 0.5, tall, 0.5 + rnd() * 0.5);
      if (real) { const nr = nearRoad(x, z); if (nr && nr.d < 3.55) sc.set(0, 0, 0); }
      mesh.setMatrixAt(k, m4.compose(ps, q, sc));
      mesh.setColorAt(k, col.setHSL(0.19 + rnd() * 0.07, 0.25 + rnd() * 0.25, 0.5 + rnd() * 0.25));
    }
    mesh.frustumCulled = false; mesh.receiveShadow = true; scene.add(mesh);
    return mesh;
  };
  if (!XMAS) for (let c0 = 0; c0 + PER <= N; c0 += PER) chunks.push({ c: P[c0 + PER / 2], mesh: null, build: () => build(c0) });
}

/* ---------- 19th-century touches (real courses): sheep on the hill, hay stooks in the vale ---------- */
const stamps = [];       // patches where the meadow is grazed short or cut to stubble
if (real && !real.region) {     // Leckhampton's own 19th-century dressing: courses from the course tool carry a region
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new V3(0, 1, 0), sc = new V3(), ps = new V3(), col = new THREE.Color();
  const open = (x, z) => Math.abs(x) < TS / 2 - 60 && Math.abs(z) < TS / 2 - 60 && !real.wood(x, z);
  const slopeAt = (x, z) => Math.hypot(demH(x + 10, z) - demH(x - 10, z), demH(x, z + 10) - demH(x, z - 10)) / 20;
  const roadGap = (x, z) => { const nr = nearRoad(x, z); return nr ? nr.d : 999; };
  const tint = (x, z, r, c) => {                      // recolour the ground around a point
    const i0 = Math.round((x + TS / 2) / TC), j0 = Math.round((z + TS / 2) / TC), n = Math.ceil(r / TC);
    for (let j = j0 - n; j <= j0 + n; j++) for (let i = i0 - n; i <= i0 + n; i++) {
      if (i < 0 || j < 0 || i > TG || j > TG) continue;
      const k = j * TW + i, f = smooth(r, r * 0.6, Math.hypot(tPos[k * 3] - x, tPos[k * 3 + 2] - z));
      for (let a = 0; a < 3; a++) tCol[k * 3 + a] += (c[a] - tCol[k * 3 + a]) * f;
    }
  };
  const paint = (g, r, gg, b) => { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set([r, gg, b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
  const place = (geo, mat, spots, fn) => {
    const m = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach(([x, z], i) => { fn(x, z); m.setMatrixAt(i, m4.compose(ps, q, sc)); m.setColorAt(i, col); });
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m);
  };

  // flocks on the high ground
  const sheep = [];
  for (let n = 0; n < 5000 && stamps.length < 46; n++) {
    const i = Math.floor(rnd() * N);
    if (P[i].y < 175) continue;
    const off = (rnd() < 0.5 ? -1 : 1) * (30 + rnd() * 65), x = P[i].x + R[i].x * off, z = P[i].z + R[i].z * off;
    if (!open(x, z) || roadGap(x, z) < 24 || slopeAt(x, z) > 0.3 || stamps.some(s => Math.hypot(s.x - x, s.z - z) < 70)) continue;
    stamps.push({ x, z, r: 48, amt: 0.36 });
    for (let k = 0, c = 6 + rnd() * 9; k < c; k++) {
      const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 24, sx = x + Math.cos(a) * r, sz = z + Math.sin(a) * r;
      if (roadGap(sx, sz) > 10 && !real.wood(sx, sz)) sheep.push([sx, sz]);
    }
  }
  const sheepGeo = headY => mergeGeometries([
    paint(new THREE.SphereGeometry(0.5, 9, 7).scale(1.12, 0.76, 0.7).translate(0, 0.74, 0), 0.82, 0.78, 0.69),
    paint(new THREE.BoxGeometry(0.3, 0.24, 0.22).translate(0.66, headY, 0), 0.1, 0.09, 0.08),
    ...[[0.32, 0.19], [0.32, -0.19], [-0.32, 0.19], [-0.32, -0.19]].map(([x, z]) => paint(new THREE.BoxGeometry(0.08, 0.44, 0.08).translate(x, 0.22, z), 0.1, 0.09, 0.08))]);
  const woolMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const stand = (x, z) => { ps.set(x, meshH(x, z), z); q.setFromAxisAngle(up, rnd() * 6.283); const k = 1.1 + rnd() * 0.35; sc.set(k, k, k); col.setScalar(0.85 + rnd() * 0.15); };
  place(sheepGeo(0.4), woolMat, sheep.filter((_, i) => i % 3 !== 0), stand);      // grazing, heads down
  place(sheepGeo(0.86), woolMat, sheep.filter((_, i) => i % 3 === 0), stand);     // looking up

  // cut fields with rows of stooks in the vale
  const stooks = []; let fields = 0;
  for (let n = 0; n < 5000 && fields < 26; n++) {
    const i = Math.floor(rnd() * N);
    if (P[i].y > 150) continue;
    const off = (rnd() < 0.5 ? -1 : 1) * (48 + rnd() * 50), x = P[i].x + R[i].x * off, z = P[i].z + R[i].z * off;
    if (!open(x, z) || roadGap(x, z) < 40 || slopeAt(x, z) > 0.1 || stamps.some(s => Math.hypot(s.x - x, s.z - z) < 110)) continue;
    stamps.push({ x, z, r: 46, amt: 0.5 }); tint(x, z, 46, [1.5, 1.22, 0.6]); fields++;
    const a = Math.atan2(T[i].z, T[i].x), c = Math.cos(a), sn = Math.sin(a);
    for (let u = -3; u <= 3; u++) for (let v = -2; v <= 2; v++) {
      const du = u * 9 + (rnd() - 0.5) * 1.5, dv = v * 10 + (rnd() - 0.5) * 1.5, sx = x + du * c - dv * sn, sz = z + du * sn + dv * c;
      if (!real.wood(sx, sz) && roadGap(sx, sz) > 12) stooks.push([sx, sz]);
    }
  }
  const [stc, stg] = canvas2d(64, 64); stg.fillStyle = '#b8964a'; stg.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 260; i++) { const l = 150 + rnd() * 80 | 0; stg.fillStyle = `rgb(${l},${l * 0.8 | 0},${l * 0.42 | 0})`; stg.fillRect(rnd() * 64, 0, 1 + rnd() * 1.5, 64); }
  const straw = new THREE.CanvasTexture(stc); straw.colorSpace = THREE.SRGBColorSpace;
  place(new THREE.ConeGeometry(0.62, 1.5, 7).translate(0, 0.75, 0), new THREE.MeshStandardMaterial({ map: straw, roughness: 1 }), stooks,
    (x, z) => { ps.set(x, meshH(x, z) - 0.05, z); q.setFromAxisAngle(up, rnd() * 6.283); sc.set(1.3 + rnd() * 0.5, 1.25 + rnd() * 0.45, 1.3 + rnd() * 0.5); col.setScalar(0.85 + rnd() * 0.15); });
  st0.sheep = sheep.length; st0.stooks = stooks.length; st0.fields = fields; st0.flocks = stamps.length - fields;
  st0.spots = stamps.map(s => [Math.round(s.x), Math.round(s.z), s.amt]);
}

/* ---------- meadow: a field of grass that travels with the rider and reads the terrain's height ---------- */
{
  const data = new Float32Array(TW * TW * 4), mix = tGeo.attributes.aMix.array;
  for (let k = 0; k < TW * TW; k++) {             // per terrain vertex: height, distance to road, rock/snow, dryness
    const nr = nearRoad(tPos[k * 3], tPos[k * 3 + 2]);
    data.set([H[k], nr ? Math.min(nr.d, 100) : 100, Math.max(mix[k * 2], mix[k * 2 + 1]), smooth(0.3, 0.7, fbm(tPos[k * 3] / 45, tPos[k * 3 + 2] / 45, 3))], k * 4);
  }
  for (const s of stamps) {            // grazed pasture and stubble: shorter grass, or none
    const i0 = Math.round((s.x + TS / 2) / TC), j0 = Math.round((s.z + TS / 2) / TC), n = Math.ceil(s.r / TC);
    for (let j = j0 - n; j <= j0 + n; j++) for (let i = i0 - n; i <= i0 + n; i++) {
      if (i < 0 || j < 0 || i > TG || j > TG) continue;
      const k = j * TW + i; data[k * 4 + 2] = Math.max(data[k * 4 + 2], s.amt * smooth(s.r, s.r * 0.55, Math.hypot(tPos[k * 3] - s.x, tPos[k * 3 + 2] - s.z)));
    }
  }
  const field = new THREE.DataTexture(data, TW, TW, THREE.RGBAFormat, THREE.FloatType); field.needsUpdate = true;
  const S = 260, COUNT = 260000, inst = new Float32Array(COUNT * 4), tall = new Float32Array(COUNT), tint = new Float32Array(COUNT * 3), col = new THREE.Color();
  for (let i = 0; i < COUNT; i++) {
    inst.set([rnd() * S, rnd() * S, rnd() * 6.283, 0.6 + rnd() * 0.6], i * 4);
    tall[i] = 0.3 + rnd() * 0.6;
    col.setHSL(0.17 + rnd() * 0.09, 0.25 + rnd() * 0.25, 0.45 + rnd() * 0.25); tint.set([col.r, col.g, col.b], i * 3);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = tuftGeo.index;
  for (const a of ['position', 'normal', 'uv']) geo.setAttribute(a, tuftGeo.attributes[a]);
  geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
  geo.setAttribute('aTall', new THREE.InstancedBufferAttribute(tall, 1));
  geo.setAttribute('color', new THREE.InstancedBufferAttribute(tint, 3));
  geo.instanceCount = COUNT;
  const mat = new THREE.MeshStandardMaterial({ map: grassMat.map, alphaTest: 0.45, roughness: 1, vertexColors: true });
  mat.onBeforeCompile = s => {
    Object.assign(s.uniforms, { uTime, uField: { value: field }, uMeadowC: uMeadow });
    s.vertexShader = 'uniform float uTime; uniform vec2 uMeadowC; uniform sampler2D uField; attribute vec4 aInst; attribute float aTall;\n' + s.vertexShader
      .replace('#include <color_vertex>', `
      vec2 wxz = mod(aInst.xy - uMeadowC, ${S.toFixed(1)}) - ${(S / 2).toFixed(1)} + uMeadowC;   // wrap around a point ahead of the rider
      vec2 gf = (wxz + ${(TS / 2).toFixed(1)}) / ${TC.toFixed(1)};
      ivec2 gi = clamp(ivec2(floor(gf)), ivec2(0), ivec2(${TG - 1}));
      vec2 gu = clamp(gf - vec2(gi), 0., 1.);
      vec4 fa = texelFetch(uField, gi, 0), fb = texelFetch(uField, gi + ivec2(0, 1), 0), fc = texelFetch(uField, gi + ivec2(1, 1), 0), fd = texelFetch(uField, gi + ivec2(1, 0), 0);
      vec4 fl = gu.x + gu.y <= 1. ? fa + (fd - fa) * gu.x + (fb - fa) * gu.y : fc + (fb - fc) * (1. - gu.x) + (fd - fc) * (1. - gu.y);
      #include <color_vertex>
      vColor.rgb *= mix(vec3(0.8, 0.95, 0.7), vec3(1.3, 1.15, 0.75), fl.w) * 1.15;                 // same green-to-dry tint as the ground beneath`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      objectNormal = normalize(vec3(fa.x - fd.x, ${TC.toFixed(1)}, fa.x - fb.x));                  // take the hillside's light, not a flat field's`)
      .replace('#include <begin_vertex>', `
      vec2 dc = abs(wxz - uMeadowC);
      float keep = (1. - smoothstep(${(S * 0.36).toFixed(1)}, ${(S * 0.48).toFixed(1)}, max(dc.x, dc.y)))
                 * smoothstep(12.5, 16.5, fl.y) * (1. - smoothstep(0.15, 0.5, fl.z));        // thin out far away, off the road, off the rock
      float cs = cos(aInst.z), sn = sin(aInst.z);
      vec3 loc = vec3(position.x * aInst.w, position.y * aTall, position.z * aInst.w);
      loc.xz = vec2(cs * loc.x - sn * loc.z, sn * loc.x + cs * loc.z);
      float wv = sin(uTime * 1.7 + wxz.x * 0.35 + wxz.y * 0.27) * 0.16 + sin(uTime * 3.3 + wxz.x * 1.3) * 0.05;
      loc.x += wv * uv.y; loc.z += wv * 0.6 * uv.y;
      vec3 transformed = vec3(wxz.x, fl.x - 0.03, wxz.y) + loc * keep;`);
  };
  const meadow = new THREE.Mesh(geo, mat);
  meadow.frustumCulled = false; meadow.receiveShadow = true; meadow.visible = !XMAS; scene.add(meadow);
}

/* ---------- Christmas: chalets with lit windows, snow on the roof and smoke from the chimney ---------- */
const chalets = [], xl = { p: [], c: [] }, XL_COLS = [[1, 0.62, 0.25], [1, 0.12, 0.08], [0.15, 0.9, 0.25], [0.2, 0.4, 1], [1, 0.75, 0.1]];
if (XMAS) {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new V3(0, 1, 0), sc = new V3(), ps = new V3();
  const [wc, wg] = canvas2d(256, 128), [ec, eg] = canvas2d(256, 128);
  wg.fillStyle = '#3d2a1c'; wg.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 128; y += 9) { wg.fillStyle = `rgba(${20 + rnd() * 30 | 0},${12 + rnd() * 16 | 0},8,0.55)`; wg.fillRect(0, y, 256, 1.5); wg.fillStyle = `rgba(110,78,48,${rnd() * 0.25})`; wg.fillRect(0, y + 2, 256, 6); }
  wg.fillStyle = '#8d8a84'; wg.fillRect(0, 100, 256, 28);                       // stone footing
  for (let i = 0; i < 260; i++) { const l = 110 + rnd() * 60 | 0; wg.fillStyle = `rgba(${l},${l},${l + 4},0.6)`; wg.fillRect(rnd() * 256, 100 + rnd() * 28, 5 + rnd() * 9, 3 + rnd() * 5); }
  eg.fillStyle = '#000'; eg.fillRect(0, 0, 256, 128);
  for (const x of [44, 128, 212]) {
    wg.fillStyle = '#e9e2d0'; wg.fillRect(x - 21, 34, 42, 46); wg.fillStyle = '#f6c877'; wg.fillRect(x - 17, 38, 34, 38);
    wg.fillStyle = '#e9e2d0'; wg.fillRect(x - 1, 38, 2, 38); wg.fillRect(x - 17, 56, 34, 2);
    wg.fillStyle = '#dfe6f2'; wg.fillRect(x - 24, 80, 48, 5);                   // snow on the sill
    const gr = eg.createRadialGradient(x, 60, 2, x, 57, 30); gr.addColorStop(0, '#ffd28a'); gr.addColorStop(1, '#c9781e');
    eg.fillStyle = gr; eg.fillRect(x - 17, 38, 34, 38); eg.fillStyle = '#000'; eg.fillRect(x - 1, 38, 2, 38); eg.fillRect(x - 17, 56, 34, 2);
  }
  const tex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO; return t; };
  const wallMat = new THREE.MeshStandardMaterial({ map: tex(wc), emissiveMap: tex(ec), emissive: 0xffffff, emissiveIntensity: 7, roughness: 0.95 });
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // a gable roof with deep eaves: two snowy slopes, and the timber gable ends under them
  const rp = [], rc = [], snowC = [0.74, 0.78, 0.86], wood = [0.2, 0.13, 0.08], tri = (a, b, c, col) => { rp.push(...a, ...b, ...c); rc.push(...col, ...col, ...col); };
  const E = 0.62, O = 0.58, RY = 1;                   // eave reach, gable overhang, ridge height (all scaled per chalet)
  for (const sgn of [-1, 1]) {
    const e1 = [-O, 0, sgn * E], e2 = [O, 0, sgn * E], r1 = [-O, RY, 0], r2 = [O, RY, 0];
    sgn < 0 ? (tri(e1, r1, r2, snowC), tri(e1, r2, e2, snowC)) : (tri(e1, r2, r1, snowC), tri(e1, e2, r2, snowC));
    const gx = sgn * 0.5; tri([gx, 0, -0.5], [gx, 0, 0.5], [gx, 0.8, 0], wood); tri([gx, 0, 0.5], [gx, 0, -0.5], [gx, 0.8, 0], wood);
  }
  const roofGeo = new THREE.BufferGeometry();
  roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); roofGeo.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  roofGeo.computeVertexNormals();
  const WANT = 14, walls = new THREE.InstancedMesh(box, wallMat, WANT), roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }), WANT);
  const stacks = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x77726b, roughness: 1 }), WANT), smokeAt = [];
  let n = 0;
  for (let k = 0; k < WANT * 6 && n < WANT; k++) {
    const i = Math.floor(((k + 0.2 + rnd() * 0.6) / (WANT * 6)) * N) % N, side = rnd() < 0.5 ? -1 : 1, d = 21 + rnd() * 17;
    const x = P[i].x + R[i].x * side * d, z = P[i].z + R[i].z * side * d, y = meshH(x, z);
    if (Math.abs(y - P[i].y) > 8 || chalets.some(c => (c[0] - x) ** 2 + (c[1] - z) ** 2 < 140 * 140)) continue;
    const slope = Math.hypot(meshH(x + 5, z) - meshH(x - 5, z), meshH(x, z + 5) - meshH(x, z - 5)) / 10;
    if (slope > 0.4) continue;
    const w = 9 + rnd() * 4, dp = 6.5 + rnd() * 2, h = 3.9 + rnd() * 0.8, a = Math.atan2(-T[i].z, T[i].x), lo = y - slope * 6 - 0.3;
    q.setFromAxisAngle(up, a);
    walls.setMatrixAt(n, m4.compose(ps.set(x, lo, z), q, sc.set(w, h + (y - lo), dp)));
    const top = y + h, rh = dp * 0.36;
    roofs.setMatrixAt(n, m4.compose(ps.set(x, top, z), q, sc.set(w, rh, dp)));
    const ca = Math.cos(a), sa = Math.sin(a), cx = x + ca * w * 0.25, cz = z - sa * w * 0.25;
    stacks.setMatrixAt(n, m4.compose(ps.set(cx, top + rh * 0.45, cz), q, sc.set(0.8, rh * 0.9 + 0.5, 0.8)));
    smokeAt.push([cx, top + rh * 1.35 + 0.5, cz]);
    for (const sgn of [-1, 1]) for (let t = 0; t <= 1.001; t += 1 / 26) {       // a string of warm lights under each eave
      const lx = (t - 0.5) * w * 1.14, lz = sgn * dp * 0.6;
      xl.p.push(x + ca * lx + sa * lz, top + 0.02 - 0.12 * Math.sin(t * Math.PI * 6) ** 2, z - sa * lx + ca * lz); xl.c.push(...XL_COLS[0]);
    }
    chalets.push([x, z]); n++;
  }
  walls.count = roofs.count = stacks.count = n;
  if (false) {   // (off: the strings looked odd) strings of bulbs on poles down both sides of the road: through every hamlet, and on a few stretches between
    const STEP = 8, posts = [], lit = i => chalets.some(c => (c[0] - P[i].x) ** 2 + (c[1] - P[i].z) ** 2 < 230 * 230) || fbm(i / 150 + 31, 4.2, 2) > 0.5;
    const top = (i, side) => { const d = 5.1, x = P[i].x + R[i].x * side * d, z = P[i].z + R[i].z * side * d; return [x, P[i].y - 0.35 + 4.3, z]; };
    for (let i = 0; i + STEP <= N; i += STEP) {
      if (!lit(i)) continue;
      const many = fbm(i / 400 + 9, 1.7, 2) > 0.52;
      for (const side of [-1, 1]) {
        const a = top(i, side), b = top((i + STEP) % N, side);
        posts.push(a);
        for (let k = 0; k < 18; k++) {
          const t = (k + 0.5) / 18;
          xl.p.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 0.55 * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t);
          xl.c.push(...(many ? XL_COLS[1 + (k % 4)] : XL_COLS[0]));
        }
      }
    }
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.07, 4.5, 6).translate(0, -2.25, 0), new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 1 }), posts.length);
    posts.forEach((p, k) => poles.setMatrixAt(k, m4.makeTranslation(p[0], p[1] + 0.05, p[2])));
    poles.castShadow = true; poles.frustumCulled = false; scene.add(poles); st0.poles = posts.length;
  }
  for (const m of [walls, roofs, stacks]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }
  const PUFFS = 26, sp = new Float32Array(n * PUFFS * 3), ph = new Float32Array(n * PUFFS);
  smokeAt.forEach((p, k) => { for (let i = 0; i < PUFFS; i++) { sp.set(p, (k * PUFFS + i) * 3); ph[k * PUFFS + i] = rnd(); } });
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  const smoke = new THREE.Points(sg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uTime, uPx: { value: innerHeight * Math.min(devicePixelRatio, 2) / (2 * Math.tan(0.6)) }, uCol: { value: new V3(0.5, 0.52, 0.6) } },
    vertexShader: `uniform float uTime, uPx; attribute float aPh; varying float vA;
      void main(){
        float age = fract(uTime * 0.07 + aPh);
        vec3 p = position + vec3(1.6, 0., 0.9) * age * 9. + vec3(sin(aPh * 40. + age * 5.) * 0.8 * age, age * 9. + age * age * 5., cos(aPh * 31. + age * 4.) * 0.8 * age);
        vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.7 + age * 4.5) * uPx / -mv.z;
        vA = smoothstep(0., 0.1, age) * (1. - age) * 0.35;
      }`,
    fragmentShader: 'uniform vec3 uCol; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uCol, smoothstep(0.5, 0.1, r) * vA); }'
  }));
  smoke.frustumCulled = false; smoke.renderOrder = 3; scene.add(smoke);
  st0.chalets = n;
}

/* ---------- pines: a trunk plus whorls of needle cards ---------- */
{
  const [bc, bg] = canvas2d(256, 256);
  bg.lineCap = 'round';
  bg.strokeStyle = '#2a1d12'; bg.lineWidth = 5; bg.beginPath(); bg.moveTo(0, 128); bg.lineTo(240, 128); bg.stroke();
  for (let x = 4; x < 250; x += 2.2) {
    const reach = Math.pow(1 - x / 262, 0.55) * 112 * (0.55 + rnd() * 0.45);
    for (const sgn of [-1, 1]) {
      const l = 18 + rnd() * 30 | 0;
      bg.strokeStyle = `rgb(${l * 0.75 | 0},${l + 22},${l * 0.5 | 0})`; bg.lineWidth = 1.6 + rnd() * 2.2;
      bg.beginPath(); bg.moveTo(x, 128);
      bg.quadraticCurveTo(x + reach * 0.25, 128 + sgn * reach * 0.6, x + reach * 0.5 + rnd() * 8, 128 + sgn * reach); bg.stroke();
    }
  }
  if (XMAS) {                                          // snow lying along each bough, heavier on the upper side, green showing at the tips
    const edge = (x, k) => Math.pow(1 - x / 262, 0.55) * 112 * k;
    for (const [k, al] of [[0.62, 0.5], [0.46, 0.6], [0.3, 0.8]]) {
      bg.fillStyle = `rgba(232,238,250,${al})`; bg.beginPath(); bg.moveTo(0, 128);
      for (let x = 0; x <= 250; x += 5) bg.lineTo(x, 128 - edge(x, k) * (0.85 + rnd() * 0.3));
      for (let x = 250; x >= 0; x -= 5) bg.lineTo(x, 128 + edge(x, k * 0.6) * (0.8 + rnd() * 0.4));
      bg.fill();
    }
    for (let i = 0; i < 260; i++) { const x = rnd() * 246; bg.fillStyle = 'rgba(236,241,252,0.7)'; bg.beginPath(); bg.ellipse(x, 128 + (rnd() - 0.62) * edge(x, 1.5), 2 + rnd() * 5, 2 + rnd() * 4, 0, 0, 6.283); bg.fill(); }
  }
  const boughMap = new THREE.CanvasTexture(bc); boughMap.colorSpace = THREE.SRGBColorSpace; boughMap.anisotropy = 4;

  const pos = [], uv = [], nrm = [], idx = [];
  const card = (a, y, L, W, droop, vertical) => {
    const ca = Math.cos(a), sa = Math.sin(a), cd = Math.cos(droop), sd = Math.sin(droop), base = pos.length / 3;
    for (const [x, w] of [[0, -0.5], [1, -0.5], [1, 0.5], [0, 0.5]]) {
      const yy = vertical ? w * W : 0, zz = vertical ? 0 : w * W, xx = x * L + 0.05;
      const rad = xx * cd + yy * sd, upv = -xx * sd + yy * cd;
      pos.push(rad * ca - zz * sa, y + upv, rad * sa + zz * ca); uv.push(x, w + 0.5);
      nrm.push(ca * 0.75, 0.66, sa * 0.75);            // soft, outward-and-up shading
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let k = 0; k < 15; k++) {
    const t = k / 14, y = 2.0 + t * 8.6, L = 2.9 * Math.pow(1 - t, 0.85) + 0.4, droop = 0.5 - t * 1.1, a0 = rnd() * 6.28;
    for (let b = 0; b < 5; b++) {
      const a = a0 + b * 1.2566 + (rnd() - 0.5) * 0.5, l = L * (0.8 + rnd() * 0.35);
      card(a, y + (rnd() - 0.5) * 0.3, l, l * 0.62, droop, false);
      card(a, y + (rnd() - 0.5) * 0.3, l, l * 0.5, droop, true);
    }
  }
  let treeMap = boughMap;
  if (real) {      // English broadleaf: a rounded crown made of leaf cards, in place of the pine boughs
    pos.length = uv.length = nrm.length = idx.length = 0;
    const [lc, lg] = canvas2d(256, 256);
    for (let i = 0; i < 760; i++) {
      const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 116, l = 20 + rnd() * 42 | 0;
      lg.fillStyle = `rgb(${l * 0.8 | 0},${l + 30},${l * 0.42 | 0})`;
      lg.beginPath(); lg.ellipse(128 + Math.cos(a) * r, 128 + Math.sin(a) * r * 0.88, 5 + rnd() * 7, 3 + rnd() * 4, rnd() * 3.14, 0, 6.283); lg.fill();
    }
    treeMap = new THREE.CanvasTexture(lc); treeMap.colorSpace = THREE.SRGBColorSpace; treeMap.anisotropy = 4;
    const C = new V3(0, 7, 0), quad = corners => {
      const base = pos.length / 3;
      corners.forEach(([x, y, z], k) => {
        pos.push(x, y, z); uv.push(k === 0 || k === 3 ? 0 : 1, k < 2 ? 0 : 1);
        const n = new V3(x, y + 1.5, z).sub(C).normalize(); nrm.push(n.x, n.y, n.z);       // shade it like a ball, not a set of cards
      });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const a of [0, 1.047, 2.094]) { const cx = Math.cos(a) * 4.2, cz = Math.sin(a) * 4.2; quad([[-cx, 3.2, -cz], [cx, 3.2, cz], [cx, 10.8, cz], [-cx, 10.8, -cz]]); }
    for (const y of [5.6, 8.2]) quad([[-3.7, y, -3.7], [3.7, y, -3.7], [3.7, y, 3.7], [-3.7, y, 3.7]]);
  }
  const folGeo = new THREE.BufferGeometry();
  folGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  folGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  folGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  folGeo.setIndex(idx);
  const folMat = new THREE.MeshStandardMaterial({ map: treeMap, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
  folMat.onBeforeCompile = s => {
    s.uniforms.uTime = uTime;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 wp = instanceMatrix * vec4(0., 0., 0., 1.);
        transformed.x += sin(uTime * 1.1 + wp.x * 0.13 + wp.z * 0.09) * 0.022 * position.y;
        transformed.z += sin(uTime * 0.9 + wp.z * 0.11) * 0.016 * position.y;
      #endif`);
    s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace(/gl_FrontFacing \? 1\.0 : - ?1\.0/, '1.0'));
  };
  const trunkGeo = real ? new THREE.CylinderGeometry(0.16, 0.3, 5.2, 6).translate(0, 2.6, 0) : new THREE.CylinderGeometry(0.04, 0.25, 10.8, 6).translate(0, 5.4, 0);
  const spots = [];
  const built = new Set(), cellKey = (x, z) => Math.floor(x / 10) * 4096 + Math.floor(z / 10);
  if (real) {
    for (const [bx, bz, w] of real.osm.buildings) for (let dx = -w / 2 - 4; dx <= w / 2 + 4; dx += 10) for (let dz = -w / 2 - 4; dz <= w / 2 + 4; dz += 10) built.add(cellKey(bx + dx, bz + dz));
    for (const [x, z] of real.osm.trees) { const nr = nearRoad(x, z); if (!nr || nr.d > 5.5) spots.push([x, meshH(x, z), z]); }     // mapped street and field trees
  }
  for (let n = 0; n < (real ? 320000 : 70000) && spots.length < (real ? 26000 : 7000); n++) {
    const x = (rnd() - 0.5) * TS * 0.78, z = (rnd() - 0.5) * TS * 0.78, nr = nearRoad(x, z), d = nr ? nr.d : 999;
    if (d < 11) continue;
    if (chalets.some(c => (c[0] - x) ** 2 + (c[1] - z) ** 2 < 170)) continue;
    const forest = fbm(x / 140 + 3, z / 140 + 7, 3);
    if (real) {            // trees where the map says there is woodland, and never on a building
      if (!real.wood(x, z) || built.has(cellKey(x, z))) continue;
    } else if (!(forest > 0.53 || (d < 55 && rnd() < (XMAS ? 0.42 : 0.1)))) continue;
    const y = meshH(x, z);
    if (!real && y > 240) continue;
    spots.push([x, y, z]);
  }
  const fol = new THREE.InstancedMesh(folGeo, folMat, spots.length);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x33251a, roughness: 1 }), spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new V3(0, 1, 0), sc = new V3(), ps = new V3(), col = new THREE.Color();
  spots.forEach(([x, y, z], i) => {
    const s = 0.9 + rnd() * 0.9;
    ps.set(x, y - 0.3, z); q.setFromAxisAngle(up, rnd() * 6.283); sc.set(s * (0.85 + rnd() * 0.3), s, s * (0.85 + rnd() * 0.3));
    m4.compose(ps, q, sc); fol.setMatrixAt(i, m4); trunk.setMatrixAt(i, m4);
    if (XMAS && xl.p.length < 110000 * 3) {            // fairy lights wound round the trees beside the road
      const nr = nearRoad(x, z);
      if (nr && nr.d < 70 && (nr.d < 45 || rnd() < 0.6)) {
        const many = rnd() < 0.4, a0 = rnd() * 6.283, w = s * (sc.x + sc.z) / (2 * s);
        for (let k = 0; k < 96; k++) {
          const t = (k + rnd() * 0.6) / 96, rad = (2.9 * Math.pow(1 - t, 0.85) + 0.4) * 0.74 * w, a = a0 + t * 58;
          xl.p.push(x + Math.cos(a) * rad, y - 0.3 + (2.0 + t * 8.6) * s - 0.25 * rad, z + Math.sin(a) * rad);
          xl.c.push(...(many ? XL_COLS[rnd() * XL_COLS.length | 0] : XL_COLS[0]));
        }
      }
    }
    fol.setColorAt(i, col.setRGB(0.7 + rnd() * 0.3, 0.75 + rnd() * 0.25, 0.6 + rnd() * 0.3));
  });
  for (const m of [fol, trunk]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }
}

if (xl.p.length) {         // every Christmas light is one glowing point; bright enough to bloom
  const g = new THREE.BufferGeometry(), n = xl.p.length / 3, ph = new Float32Array(n);
  for (let i = 0; i < n; i++) ph[i] = rnd();
  g.setAttribute('position', new THREE.Float32BufferAttribute(xl.p, 3)); g.setAttribute('aCol', new THREE.Float32BufferAttribute(xl.c, 3)); g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  const lights = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime, uPx: { value: innerHeight * Math.min(devicePixelRatio, 2) / (2 * Math.tan(0.6)) } },
    vertexShader: `uniform float uTime, uPx; attribute vec3 aCol; attribute float aPh; varying vec3 vCol;
      void main(){
        vec4 mv = viewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
        float d = -mv.z, tw = 0.8 + 0.2 * sin(uTime * (1.2 + aPh * 2.5) + aPh * 40.);
        float px = 0.62 * uPx / d; gl_PointSize = clamp(px, 3., 30.);
        vCol = aCol * tw * (1. - smoothstep(450., 1100., d)) * min(1., px / 3.);
      }`,
    fragmentShader: 'varying vec3 vCol; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vCol * (pow(smoothstep(0.5, 0.0, r), 2.) * 5. + smoothstep(0.2, 0.0, r) * 30.), 1.); }'
  }));
  lights.frustumCulled = false; lights.renderOrder = 4; scene.add(lights);
  st0.lights = n;
}

/* ---------- buildings, hedges and walls (real courses) ---------- */
if (real && real.osm.buildings.length) {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new V3(0, 1, 0), sc = new V3(), ps = new V3(), col = new THREE.Color();
  const speck = (g, w, h, base, spread, n) => { for (let i = 0; i < n; i++) { const l = base + (rnd() - 0.5) * spread | 0; g.fillStyle = `rgba(${l},${l - 4},${l - 14},0.5)`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 5, 1 + rnd() * 2); } };
  // one bay of wall with one window; repeated across each wall so windows are never cut in half
  const [wc, wg] = canvas2d(128, 128);
  wg.fillStyle = '#d9d2c2'; wg.fillRect(0, 0, 128, 128); speck(wg, 128, 128, 205, 50, 900);
  wg.fillStyle = '#efebe0'; wg.fillRect(40, 30, 48, 64);
  wg.fillStyle = '#27303a'; wg.fillRect(44, 34, 40, 56);
  wg.fillStyle = '#efebe0'; wg.fillRect(63, 34, 2, 56); wg.fillRect(44, 61, 40, 2); wg.fillRect(36, 94, 56, 5);
  const wallMap = new THREE.CanvasTexture(wc); wallMap.wrapS = wallMap.wrapT = THREE.RepeatWrapping; wallMap.colorSpace = THREE.SRGBColorSpace; wallMap.anisotropy = MAX_ANISO;
  const wallMat = new THREE.MeshStandardMaterial({ map: wallMap, roughness: 0.95 });
  wallMat.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_INSTANCING
        float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz), sz = length(instanceMatrix[2].xyz);
        vMapUv = uv * vec2(max(1., floor((abs(normal.x) > 0.5 ? sz : sx) / 3.4 + 0.5)), max(1., floor(sy / 2.8 + 0.5)));
      #endif`);
  };
  const hip = new THREE.BufferGeometry();          // a hipped roof: four slopes up to a short ridge
  hip.setAttribute('position', new THREE.Float32BufferAttribute([
    -.5, 0, -.5, -.25, 1, 0, .25, 1, 0,   -.5, 0, -.5, .25, 1, 0, .5, 0, -.5,
    -.5, 0, .5, .5, 0, .5, .25, 1, 0,     -.5, 0, .5, .25, 1, 0, -.25, 1, 0,
    -.5, 0, -.5, -.5, 0, .5, -.25, 1, 0,   .5, 0, .5, .5, 0, -.5, .25, 1, 0], 3));
  hip.computeVertexNormals();
  const B = real.osm.buildings, box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const roofMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const walls = new THREE.InstancedMesh(box, wallMat, B.length), pitched = new THREE.InstancedMesh(hip, roofMat, B.length), flat = new THREE.InstancedMesh(box, roofMat, B.length);
  let np = 0, nf = 0, nw = 0;
  const SHOW_TOWN = false;     // 19th-century Leckhampton: a village among fields, so the modern town is left out
  const KEEP_OUT = 150;        // simple house shapes only hold up at a distance, so none are drawn near the road
  const farFromRoad = (x, z) => { for (let k = 0; k < N; k += 8) { const ex = P[k].x - x, ez = P[k].z - z; if (ex * ex + ez * ez < KEEP_OUT * KEEP_OUT) return false; } return true; };
  B.forEach(([x, z, w, d, ang, h, roof]) => {
    if (!SHOW_TOWN || !farFromRoad(x, z)) return;
    const i = nw++;
    const c = Math.cos(ang), sn = Math.sin(ang);
    let lo = 1e9, hi = -1e9;
    for (const [u, v] of [[0, 0], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]]) { const y = meshH(x + u * c - v * sn, z + u * sn + v * c); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    q.setFromAxisAngle(up, -ang);
    walls.setMatrixAt(i, m4.compose(ps.set(x, lo - 0.4, z), q, sc.set(w, h + hi - lo + 0.4, d)));
    walls.setColorAt(i, col.setHSL(0.1, 0.2, 0.56 + rnd() * 0.08));                // one muted stone, so the town reads as a single mass
    const slate = col.setHSL(0.6, 0.06, 0.2 + rnd() * 0.06);
    if (roof) { pitched.setMatrixAt(np, m4.compose(ps.set(x, hi + h, z), q, sc.set(w + 0.8, Math.min(3.4, d * 0.34), d + 0.8))); pitched.setColorAt(np++, slate); }
    else { flat.setMatrixAt(nf, m4.compose(ps.set(x, hi + h, z), q, sc.set(w + 0.3, 0.3, d + 0.3))); flat.setColorAt(nf++, slate); }
  });
  walls.count = nw; pitched.count = np; flat.count = nf;
  for (const m of [walls, pitched, flat]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }

  // hedges and dry-stone walls, laid in short pieces that follow the ground
  const [hc, hg] = canvas2d(64, 64); hg.fillStyle = '#263a17'; hg.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 500; i++) { const l = 30 + rnd() * 50 | 0; hg.fillStyle = `rgb(${l * 0.7 | 0},${l + 20},${l * 0.4 | 0})`; hg.fillRect(rnd() * 64, rnd() * 64, 2 + rnd() * 3, 2 + rnd() * 3); }
  const [sc2, sg] = canvas2d(64, 64); sg.fillStyle = '#9c927c'; sg.fillRect(0, 0, 64, 64); speck(sg, 64, 64, 150, 90, 500);
  const tex = c => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; };
  const L = real.osm.lines, kinds = [
    new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: tex(hc), roughness: 1 }), L.length),
    new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: tex(sc2), roughness: 1 }), L.length)], n = [0, 0];
  for (const [x1, z1, x2, z2, kind] of L) {
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2, len = Math.hypot(x2 - x1, z2 - z1);
    q.setFromAxisAngle(up, -Math.atan2(z2 - z1, x2 - x1));
    kinds[kind].setMatrixAt(n[kind]++, m4.compose(ps.set(mx, meshH(mx, mz) - 0.5, mz), q, kind ? sc.set(len + 0.3, 1.6, 0.55) : sc.set(len + 0.5, 2.1 + rnd() * 0.3, 1.3 + rnd() * 0.3)));
  }
  kinds.forEach((m, k) => { m.count = n[k]; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); });
}

/* ---------- clouds and dust motes ---------- */
const hazeLum = (hazeCol.r + hazeCol.g + hazeCol.b) / 3;
const uLid = { value: 0 }, uCloudLit = { value: new V3() }, uCloudDark = { value: new V3() }, uCloudHaze = { value: new V3() };
{
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime, uCloud, uLid, uSun: { value: sunFlat }, uHaze: uCloudHaze, uLit: uCloudLit, uDark: uCloudDark },
    vertexShader: 'varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }',
    fragmentShader: `
      uniform float uTime, uCloud, uLid; uniform vec3 uSun, uHaze, uLit, uDark; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0., a = 0.5; for (int i = 0; i < 6; i++) { s += a * n(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
      float dens(vec2 p){ return smoothstep(0.46, 0.8, fbm(p)); }
      void main(){
        vec2 p = vW.xz * 0.00034 + uTime * 0.004;
        float d = dens(p), d2 = dens(p + uSun.xz * 0.07);
        vec3 col = mix(uDark, uLit, clamp(0.5 + (d - d2) * 1.7, 0., 1.));     // sun-side edges glow
        float fade = 1. - smoothstep(3200., 8500., length(vW.xz - cameraPosition.xz));
        gl_FragColor = vec4(mix(uHaze, col, 0.25 + 0.75 * fade), d * fade * 0.92 * uCloud * mix(1., smoothstep(0.25, 0.6, (vW.y - cameraPosition.y) / length(vW - cameraPosition)), uLid));
      }`
  }));
  clouds.position.y = 1400; clouds.frustumCulled = false; clouds.renderOrder = 2; scene.add(clouds);

  const n = 700, a = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) a[i] = rnd() * 40;
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(a, 3));
  const motes = new THREE.Points(mg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime, uMote, uCol: { value: new V3(2.4, 1.8, 1.1).multiplyScalar(hazeLum) } },
    vertexShader: `uniform float uTime; varying float vA;
      void main(){
        vec3 p = position + vec3(sin(uTime * 0.3 + position.y) * 0.6, uTime * 0.08, cos(uTime * 0.25 + position.x) * 0.6);
        p = mod(p - cameraPosition, 40.) - 20. + cameraPosition;                // the cloud of motes travels with the rider
        vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
        float d = -mv.z; gl_PointSize = clamp(60. / d, 1., 4.);
        vA = smoothstep(20., 12., d) * smoothstep(0.6, 3., d);
      }`,
    fragmentShader: 'uniform vec3 uCol; uniform float uMote; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uCol, smoothstep(0.5, 0.1, r) * vA * 0.12 * uMote); }'
  }));
  motes.frustumCulled = false; motes.renderOrder = 3; scene.add(motes);
}

/* ---------- smoke from the quarry workings on the scarp (real courses) ---------- */
const uPx = { value: innerHeight * Math.min(devicePixelRatio, 2) / (2 * Math.tan(0.6)) };      // metres to pixels at 1 m
if (real && real.quarry) {
  const [qx, qz] = real.quarry, cands = [], src = [];
  for (let n = 0; n < 400; n++) {
    const x = qx + (rnd() - 0.5) * 520, z = qz + (rnd() - 0.5) * 520;
    cands.push([Math.hypot(demH(x + 10, z) - demH(x - 10, z), demH(x, z + 10) - demH(x, z - 10)), x, z]);
  }
  cands.sort((a, b) => b[0] - a[0]);                     // the steepest ground nearby is the quarry face
  for (const [, x, z] of cands) { if (src.length < 3 && src.every(s => Math.hypot(s[0] - x, s[1] - z) > 70)) src.push([x, z]); }
  const PUFFS = 46, n = src.length * PUFFS, a = new Float32Array(n * 3), ph = new Float32Array(n);
  src.forEach(([x, z], k) => { for (let i = 0; i < PUFFS; i++) { a.set([x, meshH(x, z) + 1.5, z], (k * PUFFS + i) * 3); ph[k * PUFFS + i] = rnd(); } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a, 3)); g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  const smoke = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uTime, uPx, uCol: uCloudHaze },
    vertexShader: `uniform float uTime, uPx; attribute float aPh; varying float vA;
      void main(){
        float age = fract(uTime * 0.035 + aPh);                                   // each puff lives about half a minute
        vec3 p = position + vec3(2.2, 0., 1.1) * age * 38.                        // drifts downwind
               + vec3(sin(aPh * 40. + age * 5.) * 3. * age, age * 30. + age * age * 26., cos(aPh * 31. + age * 4.) * 3. * age);
        vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
        gl_PointSize = (5. + age * 26.) * uPx / -mv.z;
        vA = smoothstep(0., 0.08, age) * (1. - age) * 0.5;
      }`,
    fragmentShader: 'uniform vec3 uCol; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uCol * 1.05, smoothstep(0.5, 0.15, r) * vA); }'
  }));
  smoke.frustumCulled = false; smoke.renderOrder = 3; scene.add(smoke);
  st0.smoke = src.map(([x, z]) => [Math.round(x), Math.round(z)]);
}

/* ---------- weather ---------- */
// An overcast lid: a dome that greys out the clear sky by a chosen amount.
const dome = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, transparent: true, depthWrite: false,
  uniforms: { uH: { value: new V3() }, uZ: { value: new V3() }, uA: { value: 0 }, uPaint: { value: 0 }, uGain: { value: hazeLum * 1.5 }, uTime },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `uniform vec3 uH, uZ; uniform float uA, uPaint, uGain, uTime; varying vec3 vDir;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0., a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
    vec3 starry(vec3 d){                                  // a night sky in thick, flowing strokes, after Van Gogh
      vec2 p = d.xz / (1.15 + d.y) * 1.6;
      float t = uTime * 0.03;
      vec2 q = p - vec2(0.25, -0.35); float r = length(q), tw = 2.6 * exp(-r * r * 6.);       // the great swirl
      p = mat2(cos(tw), -sin(tw), sin(tw), cos(tw)) * q + vec2(0.25, -0.35);
      vec2 w = vec2(fbm(p * 1.6 + t), fbm(p * 1.6 + 5.2 - t));
      float f = fbm(p * 2.2 + w * 2.4), band = 0.5 + 0.5 * sin(f * 46. + w.x * 6.);           // bands of paint along the flow
      vec3 col = mix(vec3(0.03, 0.07, 0.28), vec3(0.10, 0.25, 0.72), band);
      col = mix(col, vec3(0.45, 0.62, 0.9), smoothstep(0.62, 0.9, fbm(p * 3.1 - w * 2.)) * band);
      for (int i = 0; i < 11; i++) {                      // stars as glowing discs with rings
        vec2 s = vec2(h(vec2(float(i), 1.7)), h(vec2(float(i), 9.1))) * 2.6 - 1.3;
        float dd = length(p - s), rad = 0.07 + 0.06 * h(vec2(float(i), 4.));
        col = mix(col, vec3(1., 0.85, 0.25) * (0.6 + 0.4 * sin(dd * 160. - uTime * 1.5)), exp(-dd * dd / (rad * rad)) * 0.85);
        col += vec3(1., 0.95, 0.6) * smoothstep(rad * 0.28, 0., dd);
      }
      vec2 m = p - vec2(-0.85, 0.6); float md = length(m);                                     // a crescent moon in its halo
      col = mix(col, vec3(1., 0.8, 0.2) * (0.65 + 0.35 * sin(md * 120. - uTime)), exp(-md * md / 0.035) * 0.9);
      col += vec3(1.2, 0.9, 0.3) * smoothstep(0.075, 0.06, md) * smoothstep(0.05, 0.065, length(m - vec2(0.03, 0.012)));
      return col;
    }
    void main(){
      vec3 col = mix(uH, uZ, smoothstep(0.2, 0.9, vDir.y));
      if (uPaint > 0.01) col = mix(col, starry(normalize(vDir)) * uGain, uPaint);
      gl_FragColor = vec4(col, uA);
    }`
}));
dome.renderOrder = 1; dome.frustumCulled = false; scene.add(dome);

// Rain: short streaks in a box that travels with the rider; they slant against your speed.
const rainU = { uTime, uRain: { value: 0 }, uVel: { value: new V3() }, uCol: { value: new V3(0.9, 0.95, 1).multiplyScalar(hazeLum) } };
const rainMesh = (() => {
  const n = 16000, a = new Float32Array(n * 6), e = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const x = rnd() * 30, y = rnd() * 30, z = rnd() * 30; a.set([x, y, z, x, y, z], i * 6); e[i * 2 + 1] = 1; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(e, 1));
  const m = new THREE.LineSegments(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: rainU,
    vertexShader: `uniform float uTime; uniform vec3 uVel; attribute float aEnd; varying float vA;
      void main(){
        vec3 fall = vec3(1.5, -13., 0.8);
        vec3 p = mod(position + fall * uTime - cameraPosition, 30.) - 15. + cameraPosition;
        p += (fall - uVel) * 0.03 * aEnd;
        vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
        vA = smoothstep(15., 9., -mv.z) * (1. - aEnd * 0.6);
      }`,
    fragmentShader: 'uniform vec3 uCol; uniform float uRain; varying float vA; void main(){ gl_FragColor = vec4(uCol, vA * 0.3 * uRain); }'
  }));
  m.frustumCulled = false; m.renderOrder = 3; m.visible = false; scene.add(m);
  return m;
})();

// Snow: soft flakes drifting down in a box that travels with the rider.
const uSnow = { value: 0 };
const snowMesh = (() => {
  const n = 9000, a = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) a[i] = rnd() * 40;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  const m = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uTime, uPx, uSnow, uCol: { value: new V3(1, 1.02, 1.08).multiplyScalar(hazeLum * 2.4) } },
    vertexShader: `uniform float uTime, uPx; varying float vA;
      void main(){
        vec3 p = position + vec3(sin(uTime * 0.6 + position.y * 1.7) * 0.5 + uTime * 0.45, -uTime * 1.5, cos(uTime * 0.5 + position.x * 1.3) * 0.5);
        p = mod(p - cameraPosition, 40.) - 20. + cameraPosition;
        vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
        float d = -mv.z; gl_PointSize = clamp(0.05 * uPx / d, 1.3, 9.);
        vA = smoothstep(20., 13., d) * smoothstep(0.4, 1.6, d);
      }`,
    fragmentShader: 'uniform vec3 uCol; uniform float uSnow; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uCol, smoothstep(0.5, 0.15, r) * vA * 0.8 * uSnow); }'
  }));
  m.frustumCulled = false; m.renderOrder = 3; m.visible = false; scene.add(m);
  return m;
})();

const hz = [hazeCol.r, hazeCol.g, hazeCol.b], grey = (r, g, b) => [r * hazeLum, g * hazeLum, b * hazeLum];
const warmLit = grey(2.6, 1.75, 1.05), warmDark = grey(0.42, 0.45, 0.58);
const WEATHER = {
  golden:   { sun: 10,  sunCol: [1, 0.69, 0.44], hemi: 2.2, fog: 0.0007, fogCol: hz, dome: 0, domeH: hz, domeZ: hz,
              cloud: 1, cLit: warmLit, cDark: warmDark, mote: 1, rays: 1, rain: 0, rough: 1, tint: 1, ground: 1, paint: 0, expo: 0.33 },
  overcast: { sun: 1.5, sunCol: [1, 1, 1], hemi: 7, fog: 0.0008, fogCol: grey(0.8, 0.83, 0.88), dome: 1, domeH: grey(0.8, 0.83, 0.88), domeZ: grey(0.5, 0.53, 0.6),
              cloud: 1, cLit: grey(0.98, 1, 1.04), cDark: grey(0.5, 0.53, 0.6), mote: 0, rays: 0, rain: 0, rough: 0.9, tint: 0.9, ground: 0.95, paint: 0, expo: 0.5 },
  rain:     { sun: 0, sunCol: [1, 1, 1], hemi: 5.3, fog: 0.0016, fogCol: grey(0.5, 0.54, 0.6), dome: 1, domeH: grey(0.5, 0.54, 0.6), domeZ: grey(0.36, 0.39, 0.45),
              cloud: 1, cLit: grey(0.56, 0.6, 0.66), cDark: grey(0.3, 0.33, 0.39), mote: 0, rays: 0, rain: 1, rough: 0.32, tint: 0.55, ground: 0.72, paint: 0, expo: 0.5 },
  mist:     { sun: 5,   sunCol: [1, 0.8, 0.6], hemi: 2.6, fog: 0.0075, fogCol: hz.map(v => v * 0.95), dome: 0.6, domeH: hz, domeZ: hz.map(v => v * 0.8),
              cloud: 0.3, cLit: warmLit, cDark: warmDark, mote: 1, rays: 1.8, rain: 0, rough: 0.7, tint: 0.85, ground: 0.95, paint: 0, expo: 0.33 },
  starry:   { sun: 5, sunCol: [1, 0.93, 0.74], hemi: 3.2, fog: 0.0005, fogCol: grey(0.16, 0.26, 0.52), dome: 1, domeH: grey(0.16, 0.26, 0.52), domeZ: grey(0.05, 0.1, 0.4),
              cloud: 0, cLit: warmLit, cDark: warmDark, mote: 5, rays: 0, rain: 0, rough: 0.95, tint: 1, ground: 1, paint: 1, expo: 0.5 }
};
// Christmas dusk: the last low sun, a blue sky closing in, light snow falling.
WEATHER.snow = { sun: 5, sunCol: [1, 0.64, 0.46], hemi: 2.5, fog: 0.0015, fogCol: [hz[0] * 0.8, hz[1] * 0.86, hz[2] * 1.05], dome: 0.4, domeH: hz, domeZ: grey(0.26, 0.33, 0.62),
                 cloud: 0.8, cLit: grey(1.7, 1.2, 1.05), cDark: grey(0.34, 0.4, 0.62), mote: 0, rays: 0.8, rain: 0, rough: 0.5, tint: 0.62, ground: 1, paint: 0, expo: 0.38, snow: 1 };
for (const k in WEATHER) WEATHER[k].snow ??= 0;
const wx = JSON.parse(JSON.stringify(WEATHER.golden));
let wxTarget = WEATHER.golden;
function setWeather(name, instant) {
  if (!WEATHER[name]) return;
  wxTarget = WEATHER[name];
  if (instant) Object.assign(wx, JSON.parse(JSON.stringify(wxTarget)));
  // re-bake what the road and bike reflect, using the new sky
  const u = dome.material.uniforms, was = [u.uA.value, u.uH.value.clone(), u.uZ.value.clone(), u.uPaint.value];
  u.uA.value = wxTarget.dome; u.uH.value.fromArray(wxTarget.domeH); u.uZ.value.fromArray(wxTarget.domeZ); u.uPaint.value = wxTarget.paint;
  envScene.add(sky, dome);
  const rt = pmrem.fromScene(envScene, 0, 0.1, 20000);
  scene.add(sky, dome);
  envRT.dispose(); envRT = rt; scene.environment = rt.texture;
  u.uA.value = was[0]; u.uH.value.copy(was[1]); u.uZ.value.copy(was[2]); u.uPaint.value = was[3];
  document.querySelectorAll('#wx button').forEach(b => b.classList.toggle('on', b.dataset.w === name));
}
function stepWeather(dt) {
  const k = Math.min(1, dt * (SCENERY !== null ? 0.07 : 1.2));
  for (const key in wx) {
    const a = wx[key], b = wxTarget[key];
    if (Array.isArray(a)) for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * k;
    else wx[key] += (b - a) * (key === 'dome' ? Math.min(1, dt * (SCENERY !== null ? 0.25 : 4)) : k);      // the cloud lid closes fast, so the sun doesn't linger
  }
  sun.intensity = wx.sun; sun.color.setRGB(wx.sunCol[0], wx.sunCol[1], wx.sunCol[2], THREE.SRGBColorSpace);
  hemi.intensity = wx.hemi;
  scene.fog.density = wx.fog; scene.fog.color.fromArray(wx.fogCol);
  const u = dome.material.uniforms; u.uA.value = wx.dome; u.uH.value.fromArray(wx.domeH); u.uZ.value.fromArray(wx.domeZ); u.uPaint.value = wx.paint;
  dome.position.copy(camera.position);
  uCloud.value = wx.cloud; uMote.value = wx.mote; uLid.value = wx.dome; uSunAmt.value = Math.min(1, wx.sun / 10);
  uCloudLit.value.fromArray(wx.cLit); uCloudDark.value.fromArray(wx.cDark); uCloudHaze.value.fromArray(wx.fogCol);
  terrainMat.color.setScalar(wx.ground);                                          // wet ground is darker
  rainU.uRain.value = wx.rain; rainMesh.visible = wx.rain > 0.01;
  uSnow.value = wx.snow; snowMesh.visible = wx.snow > 0.01;
  road.material.roughness = wx.rough; road.material.color.setScalar(wx.tint);     // wet tarmac: darker and glossier
  renderer.toneMappingExposure = wx.expo;
}
document.querySelectorAll('#wx button').forEach(b => b.addEventListener('click', () => setWeather(b.dataset.w)));
// Starry is still being worked on: it only appears on the local copy, not the hosted site.
const LAB = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
if (!LAB) document.querySelector('#wx [data-w="starry"]')?.remove();
if (!XMAS) document.querySelector('#wx [data-w="snow"]')?.remove(); else setWeather('snow', true);
addEventListener('keydown', e => { const n = ['golden', 'overcast', 'rain', 'mist', LAB && 'starry'][+e.key - 1]; if (n) setWeather(n); });

/* ---------- cockpit ---------- */
const rig = new THREE.Group();
rig.position.set(0, -0.33, -0.5);
camera.add(rig);
const [huC, huG] = canvas2d(128, 224);
const huTex = new THREE.CanvasTexture(huC); huTex.colorSpace = THREE.SRGBColorSpace;
{
  const half = [[.205, -.135, .05], [.21, -.13, -.05], [.21, -.07, -.105], [.205, -.005, -.085], [.19, 0, -.02], [.14, 0, 0], [0, 0, 0]];
  const pts = [...half, ...half.slice(0, -1).reverse().map(p => [-p[0], p[1], p[2]])].map(p => new V3(...p));
  const tape = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.82 });
  const gloss = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.35, metalness: 0.3 });
  rig.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 140, 0.0135, 12), tape));
  for (const sx of [-1, 1]) {
    const hood = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.075, 6, 14), gloss);
    hood.position.set(sx * 0.207, 0.022, -0.115); hood.rotation.x = -1.0; rig.add(hood);
  }
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.03, 0.12), gloss); stem.position.set(0, -0.004, 0.06); rig.add(stem);
  const unit = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.012, 0.092), gloss); unit.position.set(0, 0.03, -0.075); unit.rotation.x = 0.4; rig.add(unit);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.047, 0.083).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: huTex }));
  screen.position.y = 0.0065; unit.add(screen);
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.014, 10, 72), tape); tyre.rotation.y = Math.PI / 2; tyre.position.set(0, -0.66, -0.12); rig.add(tyre);
  rig.traverse(o => { if (o.isMesh && o !== screen) o.receiveShadow = true; });
}
function drawHeadUnit(kmh, w) {
  huG.fillStyle = '#d9dccf'; huG.fillRect(0, 0, 128, 224);
  huG.fillStyle = '#16181a'; huG.textAlign = 'center';
  huG.font = '600 58px Helvetica, Arial, sans-serif'; huG.fillText(kmh.toFixed(0), 64, 82);
  huG.font = '600 13px Helvetica, Arial, sans-serif'; huG.fillText('KM/H', 64, 104);
  huG.fillRect(14, 122, 100, 2);
  huG.font = '600 40px Helvetica, Arial, sans-serif'; huG.fillText(w.toFixed(0), 64, 176);
  huG.font = '600 13px Helvetica, Arial, sans-serif'; huG.fillText('WATTS', 64, 198);
  huTex.needsUpdate = true;
}

/* ---------- lens ---------- */
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.6, 3.5);
composer.addPass(bloom);
const rays = new ShaderPass({      // light shafts: smear the bright sky outward from the sun
  uniforms: { tDiffuse: { value: null }, uSunUv: { value: new THREE.Vector2(0.5, 0.5) }, uAmt: { value: 0 }, uThr: { value: hazeLum * 2.0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uSunUv; uniform float uAmt, uThr; varying vec2 vUv;
    void main(){
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec2 d = uSunUv - vUv;
      float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      vec3 acc = vec3(0.); float w = 1., tot = 0.;
      for (int i = 0; i < 36; i++) {
        vec2 uv = vUv + d * ((float(i) + j) / 36.) * 0.92;
        float inb = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
        vec3 c = texture2D(tDiffuse, uv).rgb;
        acc += c * smoothstep(uThr, uThr * 2.5, dot(c, vec3(0.3, 0.6, 0.1))) * w * inb;
        tot += w; w *= 0.965;
      }
      gl_FragColor = vec4(base + acc / tot * uAmt, 1.);
    }`
});
composer.addPass(rays);
composer.addPass(new OutputPass());
const lens = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uSpeed: { value: 0 }, uRain: { value: 0 }, uPaint: { value: 0 }, uAspect: { value: innerWidth / innerHeight } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uSpeed, uRain, uPaint, uAspect; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 drops(vec2 uv, float t){            // water on the lens: each drop lands, sits, slides a little and dries
      vec2 off = vec2(0.); float m = 0.;
      for (int L = 0; L < 2; L++) {
        vec2 g = vec2(9. * uAspect, 9.) * (1. + float(L) * 0.7);
        vec2 p = uv * g + float(L) * 17.3, i = floor(p), f = fract(p) - 0.5;
        float h1 = h(i), h2 = h(i + 31.7);
        float life = fract(t * (0.08 + h2 * 0.1) + h1 * 9.);
        float on = step(0.6, h1) * smoothstep(0., 0.04, life) * (1. - smoothstep(0.6, 1., life));
        vec2 d = f - (vec2(h1, h2) - 0.5) * 0.5 + vec2(0., life * 0.14 * h2);
        float R = 0.08 + h2 * 0.1, k = smoothstep(R, R * 0.55, length(d)) * on;
        off -= d * k * 0.9 / g; m += k;
      }
      return vec3(off, m);
    }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    vec3 painted(vec2 uv){                   // rebuild the picture from overlapping dabs of paint
      float ang = floor(vn(uv * vec2(uAspect, 1.) * 2.3) * 5.) * 0.63 + 0.3, ca = cos(ang), sa = sin(ang);     // brush direction changes from patch to patch
      vec2 size = vec2(0.015, 0.0052);
      vec2 p = vec2(ca * uv.x * uAspect + sa * uv.y, -sa * uv.x * uAspect + ca * uv.y) / size;
      float row = floor(p.y); p.x += 0.5 * mod(row, 2.);
      vec2 id = floor(p), jit = (vec2(h(id), h(id + 7.3)) - 0.5) * 0.4, f = fract(p) - 0.5 - jit;
      vec2 c = id + 0.5 + jit; c.x -= 0.5 * mod(row, 2.); c *= size;
      vec3 col = texture2D(tDiffuse, vec2((ca * c.x - sa * c.y) / uAspect, sa * c.x + ca * c.y)).rgb * (0.88 + 0.24 * h(id + 3.1));
      col = mix(col, texture2D(tDiffuse, uv).rgb, 0.3);                         // keep some of the true picture so shapes stay readable
      col *= 1. - 0.22 * smoothstep(0.28, 0.55, length(f));                    // each dab is darker at its edge
      float l = dot(col, vec3(0.3, 0.6, 0.1));
      col = mix(vec3(l), col, 1.4);                                             // richer colour
      return mix(col * vec3(0.82, 0.9, 1.25), col * vec3(1.12, 1.04, 0.86), smoothstep(0.1, 0.6, l));   // blue shadows, warm lights
    }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 dir = c * r2 * (0.02 + 0.2 * uSpeed);            // edges streak with speed
      vec3 dr = uRain > 0.01 ? drops(vUv, uTime) * uRain : vec3(0.);
      vec2 uv0 = vUv + dr.xy;
      vec3 col = vec3(0.);
      for (int i = 0; i < 8; i++) col += texture2D(tDiffuse, uv0 - dir * (float(i) / 7.)).rgb;
      col = col / 8. + dr.z * 0.012;
      if (uPaint > 0.01) col = mix(col, painted(uv0), uPaint);
      col *= 1. - smoothstep(0.12, 0.62, r2) * 0.55;        // vignette
      col += (h(vUv * 917. + fract(uTime) * 31.) - 0.5) * 0.035;   // grain
      gl_FragColor = vec4(col, 1.);
    }`
});
composer.addPass(lens);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  lens.uniforms.uAspect.value = innerWidth / innerHeight;
  uPx.value = innerHeight * Math.min(devicePixelRatio, 2) / (2 * Math.tan(0.6));
});

/* ---------- state, keys, and hiding the info ---------- */
const st = { s: 0, v: SCENERY !== null ? 5 : 0, power: SCENERY !== null ? 90 : 0, target: 90, dist: 0, cadence: 0 };
window.ride = st; st.haze = hazeCol; st.built = st0;
st.weather = (n, i) => setWeather(n, i);

// hide everything on screen, leaving only the ride: the button or the H key. H, or a click, brings it back.
const setClean = hide => document.body.classList.toggle('clean', hide);
const isClean = () => document.body.classList.contains('clean');
$('clean').addEventListener('click', e => { e.stopPropagation(); setClean(true); });
addEventListener('click', () => { if (isClean()) setClean(false); });
addEventListener('keydown', e => { if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey && !e.altKey) setClean(!isClean()); });

// Keys pressed while this view has the focus still shift and set the power: hand them to bikeathome.
if (EMBEDDED) for (const type of ['keydown', 'keyup']) addEventListener(type, e => {
  try {
    parent.dispatchEvent(new KeyboardEvent(type, { key: e.key, code: e.code, repeat: e.repeat, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, cancelable: true }));
  } catch {}
});

/* ---------- sound: wind and tyres from filtered noise ---------- */
let audio = null;
function startAudio() {
  if (audio) return;
  const ac = new AudioContext(), buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const mk = (type, freq, q) => {
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(ac.destination); src.start();
    return { f, g };
  };
  audio = { ac, wind: mk('bandpass', 500, 0.5), tyre: mk('lowpass', 240, 0.8), rain: mk('highpass', 2600, 0.5) };
}
addEventListener('pointerdown', startAudio); addEventListener('keydown', startAudio);

/* ---------- ride ---------- */
const LANE = real && real.drive === 'right' ? 1.75 : -1.75, clock = new THREE.Clock();   // ride on the side the country drives on

// bikeathome reports where the rider is four times a second; the follower fills in the frames between
const follower = new Follower(LEN, CLOSED, !!real);   // without the route's own course, ride the valley at true distance
let latest = null;
addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'ride') return;
  latest = e.data;
  follower.receive(latest, performance.now() / 1000);
});
const pose = mkPose(), ahead = mkPose(), probe = mkPose(), look = new V3(), sunNdc = new V3(), fwd = new V3();
let lean = 0, phase = 0, grade = 0, huT = 0, first = true;
// scenery mode's weather, in order, and how many seconds each one stays
const SCENE_PLAN = XMAS ? [['snow', 280], ['mist', 100], ['snow', 180], ['golden', 95]] : [['golden', 200], ['mist', 110], ['rain', 130], ['overcast', 70], ['golden', 90]];
let scene_t = 0, scene_i = 0;
if (SCENERY !== null) { setClean(true); st.target = st.power = 90; if (SCENERY === 'nobars') rig.visible = false; }

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  uTime.value += dt;

  if (SCENERY === null) {
    // speed and distance come from bikeathome, where the trainer, the gears and the recording are
    const now = performance.now() / 1000;
    follower.step(Math.min(1, now - (st.at || now)), now);   // real time, not the capped frame time: a slow machine must not fall behind
    // The app shares this page's thread: frames this slow starve its engine, which steps at most half a second at a time.
    st.frameGap = (st.frameGap || 0) * 0.9 + Math.min(5, now - (st.at || now)) * 0.1;
    $('slow').hidden = !(st.frameGap > 0.25);
    st.at = now;
    st.s = follower.s; st.v = follower.speedMs;
    const riding = latest && latest.status === 'riding';
    st.power += ((riding ? latest.powerW : 0) - st.power) * Math.min(1, dt * 3);
    st.cadence = riding ? latest.cadenceRpm : 0;
  } else {
    st.v += (5 - st.v) * Math.min(1, dt);                 // a steady 18 km/h, whatever the gradient
    scene_t += dt;
    if (scene_t >= SCENE_PLAN[scene_i][1]) { scene_t = 0; scene_i = (scene_i + 1) % SCENE_PLAN.length; setWeather(SCENE_PLAN[scene_i][0]); }
    st.s = (st.s + st.v * dt) % LEN;
  }
  st.dist += st.v * dt;
  at(st.s, pose);
  grade += (pose.t.y * 100 - grade) * Math.min(1, dt * 2);

  // camera: follow the lane, look down the road, lean into bends, rock with the pedals
  at(st.s, pose); at(st.s + 9, ahead); at(st.s + 4, probe);
  uMeadow.value.set(pose.p.x + pose.t.x * 78, pose.p.z + pose.t.z * 78);      // most of the meadow sits in front of you
  const kappa = -(pose.t.z * probe.t.x - pose.t.x * probe.t.z) / 4;
  lean += (Math.atan(st.v * st.v * kappa / 9.81) * 0.55 - lean) * Math.min(1, dt * 3);
  const effort = Math.min(1, st.power / 300);
  const rpm = st.cadence > 0 ? st.cadence : st.power > 5 ? 60 + Math.min(40, st.power / 8) : 0;   // the rider's own cadence, when the trainer reports one
  phase += dt * Math.PI * 2 * rpm / 60;
  const sway = Math.sin(phase);
  camera.position.copy(pose.p).addScaledVector(pose.r, LANE + sway * 0.004 * effort);
  camera.position.y += 1.52;
  look.copy(ahead.p).addScaledVector(ahead.r, LANE); look.y += 0.3;
  camera.lookAt(look);
  camera.rotateZ(-lean);
  const fov = 62 + Math.min(st.v, 20) * 0.75;
  if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

  stepWeather(dt);
  rainU.uVel.value.copy(pose.t).multiplyScalar(st.v);

  // sun shadow box travels with the rider, pushed forward into the view
  sun.target.position.copy(pose.p).addScaledVector(pose.t, 70);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 350);
  let built = false;
  for (const c of chunks) {
    const d2 = c.c.distanceToSquared(camera.position);
    if (d2 < 230 * 230) { if (!c.mesh && !built) { c.mesh = c.build(); built = true; } }
    else if (c.mesh && d2 > 330 * 330) { scene.remove(c.mesh); c.mesh.dispose(); c.mesh = null; }
  }

  sunNdc.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
  rays.uniforms.uSunUv.value.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5);
  rays.uniforms.uAmt.value = 0.25 * wx.rays * smooth(0.1, 0.6, camera.getWorldDirection(fwd).dot(sunDir));
  lens.uniforms.uSpeed.value = Math.min(1, st.v / 22);
  lens.uniforms.uTime.value = uTime.value; lens.uniforms.uRain.value = wx.rain; lens.uniforms.uPaint.value = wx.paint;
  if (audio) {
    const t = audio.ac.currentTime;
    audio.wind.g.gain.setTargetAtTime(Math.min(0.5, st.v * st.v / 400 * 0.35), t, 0.2);
    audio.wind.f.frequency.setTargetAtTime(300 + st.v * 40, t, 0.2);
    audio.tyre.g.gain.setTargetAtTime(Math.min(0.35, st.v / 15 * 0.25), t, 0.2);
    audio.rain.g.gain.setTargetAtTime(wx.rain * 0.1, t, 0.4);
  }

  huT -= dt;
  if (huT <= 0) {
    huT = 0.25;
    drawHeadUnit(st.v * 3.6, st.power);
    const shown = latest || { powerW: st.power, gradient: grade, distance: st.dist, gear: null, targetPowerW: null };
    $('h-pw').textContent = shown.powerW.toFixed(0);
    $('h-sp').textContent = (st.v * 3.6).toFixed(1);
    $('h-gr').textContent = (shown.gradient >= 0 ? '+' : '') + shown.gradient.toFixed(1);
    $('h-di').textContent = (shown.distance / 1000).toFixed(2);
    $('h-cad-box').hidden = !latest;                 // cadence comes from the trainer, through bikeathome
    if (latest) $('h-cad').textContent = Math.round(latest.cadenceRpm || 0);
    $('h-gear-box').hidden = shown.gear == null;
    if (shown.gear != null) $('h-gear').textContent = shown.gear;
    // Until the ride is under way nothing moves: say why, and how to start.
    const note = !latest ? '' : latest.status === 'ready' ? 'Not started yet. Press Start ride, or the space bar.'
      : latest.status === 'paused' ? 'Paused. Space bar to carry on.' : latest.status === 'finished' ? 'Ride finished.' : '';
    $('state').hidden = !note; $('state').textContent = note;
    $('h-target-box').hidden = shown.targetPowerW == null;
    if (shown.targetPowerW != null) $('h-target').textContent = Math.round(shown.targetPowerW);
  }

  composer.render();
  if (first) { first = false; $('loading').style.opacity = 0; setTimeout(() => $('loading').remove(), 900); }
  requestAnimationFrame(tick);
}
tick();
}
