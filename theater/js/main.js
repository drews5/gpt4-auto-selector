import * as THREE from 'three';
import { VRButton } from '../vendor/VRButton.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RectAreaLightUniformsLib } from '../vendor/RectAreaLightUniformsLib.js';
import { buildTextures } from './textures.js';
import { Film } from './film.js';
import { buildAuditorium } from './auditorium.js';
import { SPEC, rowSeatXs, rowY, rowZ, pickSeat, screenMidY } from './layout.js';
import { exportGLB } from './export.js';

// ----------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true;
renderer.xr.setFoveation(0.7);          // Quest 3 fixed foveation: cheap in the periphery
document.body.appendChild(renderer.domElement);
RectAreaLightUniformsLib.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020306);
scene.fog = new THREE.FogExp2(0x04060e, 0.0055);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 120);

// -------------------------------------------------------------------- house
const qs = new URLSearchParams(location.search);
const textures = buildTextures(SPEC.seating.rows);
// 1536 across is the sweet spot on Quest 3; drop it for weaker GPUs.
const film = new Film(renderer, Number(qs.get('filmres')) || 1536);
film.update(1);                                   // strike frame one before first draw
const house = buildAuditorium(textures, film);
scene.add(house.group);

// XR rig — in VR the rig moves, never the camera.
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

// ----------------------------------------------------------------- controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 0.25;
controls.maxDistance = 60;

function seatInRow(row, offsetFromCentre = 0) {
  const xs = rowSeatXs(row);
  let bi = 0, bd = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i] - offsetFromCentre);
    if (d < bd) { bd = d; bi = i; }
  }
  return { row, index: bi, x: xs[bi], y: rowY(row), z: rowZ(row) };
}

const PRESETS = [
  { name: 'Row J — reference seat', seat: seatInRow(9, 0) },
  { name: 'Row B — front of house', seat: seatInRow(1, 0) },
  { name: 'Row P — back row', seat: seatInRow(15, 0) },
  { name: 'Row G — off centre', seat: seatInRow(6, 5.2) },
];

let currentSeat = PRESETS[0].seat;
let presetIndex = 0;

function sit(seat, label) {
  currentSeat = seat;
  const target = new THREE.Vector3(0, screenMidY() * 0.72, 0);
  if (renderer.xr.isPresenting) {
    // local-floor space: put the rig on the tier, just in front of the cushion
    rig.position.set(seat.x, seat.y, seat.z - 0.06);
    rig.rotation.set(0, 0, 0);
  } else {
    camera.position.set(seat.x, seat.y + 1.18, seat.z + 0.08);
    controls.target.copy(target);
    controls.update();
  }
  const el = document.getElementById('seatLabel');
  if (el) {
    el.textContent = label
      || `Row ${String.fromCharCode(65 + seat.row)}, seat ${seat.index + 1}`;
  }
}

function usePreset(i) {
  presetIndex = ((i % PRESETS.length) + PRESETS.length) % PRESETS.length;
  sit(PRESETS[presetIndex].seat, PRESETS[presetIndex].name);
}
usePreset(0);

// ------------------------------------------------- point-at-a-seat teleport
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.22, 0.30, 24),
  new THREE.MeshBasicMaterial({ color: 0x74b4ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
);
reticle.material.toneMapped = false;
reticle.rotation.x = -Math.PI / 2;
reticle.visible = false;
scene.add(reticle);

const controllers = [];
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0x5f9bff, transparent: true, opacity: 0.55 }),
  );
  line.scale.z = 8;
  c.add(line);
  c.addEventListener('selectstart', () => {
    const hit = aimSeat(c);
    if (hit) sit(hit);
    else usePreset(presetIndex + 1);
  });
  c.addEventListener('squeezestart', () => usePreset(presetIndex + 1));
  rig.add(c);
  controllers.push(c);
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
function aimSeat(obj) {
  obj.getWorldPosition(_o);
  _d.set(0, 0, -1).applyQuaternion(obj.getWorldQuaternion(new THREE.Quaternion()));
  return pickSeat(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z);
}

renderer.xr.addEventListener('sessionstart', () => sit(currentSeat));
renderer.xr.addEventListener('sessionend', () => sit(currentSeat));

// Desktop: click a seat to sit in it.
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 6 || renderer.xr.isPresenting) return;
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const r = raycaster.ray;
  const hit = pickSeat(r.origin.x, r.origin.y, r.origin.z, r.direction.x, r.direction.y, r.direction.z);
  if (hit) sit(hit);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (renderer.xr.isPresenting) return;
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const r = raycaster.ray;
  const hit = pickSeat(r.origin.x, r.origin.y, r.origin.z, r.direction.x, r.direction.y, r.direction.z);
  if (hit) { reticle.position.set(hit.x, hit.y + 0.02, hit.z); reticle.visible = true; }
  else reticle.visible = false;
});

// ------------------------------------------------------------------- video
let videoEl = null;
let videoSampler = null;
function playVideo(src) {
  if (!videoEl) {
    videoEl = document.createElement('video');
    videoEl.loop = true;
    videoEl.playsInline = true;
    videoEl.crossOrigin = 'anonymous';
  }
  videoEl.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  videoEl.play().catch(() => { videoEl.muted = true; videoEl.play(); });
  const vt = new THREE.VideoTexture(videoEl);
  vt.colorSpace = THREE.SRGBColorSpace;
  house.screenMaterial.map = vt;
  house.screenMaterial.toneMapped = false;
  house.screenMaterial.needsUpdate = true;
  film.running = false;
  // sample the picture at 12 Hz so the house stays lit by the actual movie
  const c = document.createElement('canvas');
  c.width = 24; c.height = 14;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  videoSampler = { canvas: c, ctx, acc: 0 };
}
function stopVideo() {
  if (videoEl) videoEl.pause();
  videoSampler = null;
  house.screenMaterial.map = film.texture;
  house.screenMaterial.toneMapped = true;
  house.screenMaterial.needsUpdate = true;
  film.running = true;
}
function sampleVideo(dt) {
  if (!videoSampler || !videoEl || videoEl.readyState < 2) return;
  videoSampler.acc += dt;
  if (videoSampler.acc < 1 / 12) return;
  videoSampler.acc = 0;
  const { ctx, canvas } = videoSampler;
  try { ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height); } catch { return; }
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  // sRGB -> approximate linear
  r = Math.pow(r / n / 255, 2.2); g = Math.pow(g / n / 255, 2.2); b = Math.pow(b / n / 255, 2.2);
  const level = Math.max((r + g + b) / 3, 0.001);
  film.averageColor.setRGB(r / level, g / level, b / level);
  film.averageLevel = Math.min(level, 0.9);
}

// ---------------------------------------------------------------------- UI
if ('xr' in navigator) {
  const btn = VRButton.createButton(renderer);
  btn.classList.add('vrbtn');
  document.body.appendChild(btn);
}
document.getElementById('seatBtn')?.addEventListener('click', () => usePreset(presetIndex + 1));
document.getElementById('videoInput')?.addEventListener('change', (e) => {
  if (e.target.files?.[0]) playVideo(e.target.files[0]);
});
document.getElementById('reelBtn')?.addEventListener('click', stopVideo);
document.getElementById('exportBtn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.textContent = 'Exporting…';
  const buf = await exportGLB(house, film);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
  a.download = 'imax-gt-theater.glb';
  a.click();
  btn.textContent = 'Export .glb';
});
window.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= String(PRESETS.length)) usePreset(Number(e.key) - 1);
  if (e.key === 'v') usePreset(presetIndex + 1);
});

const params = qs;
if (params.get('video')) playVideo(params.get('video'));
if (params.get('hideui')) {
  document.getElementById('ui')?.style.setProperty('display', 'none');
  document.getElementById('help')?.style.setProperty('display', 'none');
}

// ------------------------------------------------------------------- loop
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  film.update(dt);
  sampleVideo(dt);
  house.update();

  if (renderer.xr.isPresenting) {
    let shown = false;
    for (const c of controllers) {
      if (!c.visible) continue;
      const hit = aimSeat(c);
      if (hit && !shown) {
        reticle.position.set(hit.x, hit.y + 0.02, hit.z);
        reticle.visible = true;
        shown = true;
      }
    }
    if (!shown) reticle.visible = false;
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
});

const info = `${house.stats.seats} seats · ${(house.stats.triangles / 1000).toFixed(0)}k triangles · ${house.stats.drawCalls} static meshes`;
console.log('IMAX GT auditorium ready —', info);
const statsEl = document.getElementById('stats');
if (statsEl) statsEl.textContent = info;

window.__house = house;
window.__film = film;
window.__camera = camera;
window.__controls = controls;
window.__renderer = renderer;
window.__sit = sit;
window.__usePreset = usePreset;
window.__exportGLB = () => exportGLB(house, film);
