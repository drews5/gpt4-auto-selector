import * as THREE from 'three';
import { VRButton } from '../vendor/VRButton.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RectAreaLightUniformsLib } from '../vendor/RectAreaLightUniformsLib.js';
import { buildTextures } from './textures.js';
import { Film } from './film.js';
import { buildAuditorium } from './auditorium.js';
import { SPEC, SCREEN_ASPECT, rowSeatXs, rowY, rowZ, pickSeat, screenMidY } from './layout.js';
import { exportGLB } from './export.js';
import { TheaterAudio } from './audio.js';
import { VRConsole } from './console.js';
import { VRBrowser } from './browser.js';

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
const film = new Film(renderer, Number(qs.get('filmres')) || 1536, SCREEN_ASPECT);
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

const LAST_ROW = SPEC.seating.rows - 1;
const rowName = (i) => String.fromCharCode(65 + i);
const PRESETS = [
  { name: `Row ${rowName(11)} — reference seat`, seat: seatInRow(11, 0) },
  { name: `Row ${rowName(1)} — front of house`, seat: seatInRow(1, 0) },
  { name: `Row ${rowName(LAST_ROW)} — back row`, seat: seatInRow(LAST_ROW, 0) },
  { name: `Row ${rowName(7)} — off centre`, seat: seatInRow(7, 6.4) },
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
  c.addEventListener('selectstart', () => onControllerSelect(c));
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
  // panels first, then the seat under the cursor
  for (const p of panels) {
    if (!p.mesh.visible) continue;
    const ph = raycaster.intersectObject(p.mesh, false);
    if (ph.length) { p.press(p.hitTest(ph[0].uv)); return; }
  }
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
// One element for the lifetime of the page: Web Audio can only tap a given
// media element once, and the 12-channel rig taps this one.
const videoEl = document.createElement('video');
videoEl.loop = false;
videoEl.playsInline = true;
videoEl.crossOrigin = 'anonymous';
videoEl.preload = 'auto';

const audio = new TheaterAudio(videoEl);
const hasSource = () => !!(videoEl.currentSrc || videoEl.src || videoEl.srcObject);

let videoSampler = null;
function playVideo(src, label) {
  audio.ensureStarted();
  if (typeof MediaStream !== 'undefined' && src instanceof MediaStream) {
    videoEl.removeAttribute('src');
    videoEl.srcObject = src;
  } else {
    videoEl.srcObject = null;
    videoEl.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  }
  videoEl.load();
  videoEl.play().catch(() => {});
  vrConsole.state.source = label || (typeof src === 'string' ? 'Stream' : src.name || 'Local file');
  vrConsole.draw();
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
  videoEl.pause();
  videoSampler = null;
  vrConsole.state.source = 'House reel';
  vrConsole.state.playing = false;
  vrConsole.draw();
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
  let d;
  // A cross-origin stream without CORS headers taints the canvas; keep the
  // last lighting rather than throwing every frame.
  try { d = ctx.getImageData(0, 0, canvas.width, canvas.height).data; } catch { return; }

  const W = canvas.width, H = canvas.height;
  const halfW = W >> 1, halfH = H >> 1;
  let r = 0, g = 0, b = 0;
  // quadrant order matches film.zones / the bounce lights: TL, TR, BL, BR
  const acc = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const q = (y < halfH ? 0 : 2) + (x < halfW ? 0 : 1);
      const a = acc[q];
      a[0] += d[o]; a[1] += d[o + 1]; a[2] += d[o + 2]; a[3]++;
      r += d[o]; g += d[o + 1]; b += d[o + 2];
    }
  }
  const n = W * H;
  const lin = (v) => Math.pow(v / 255, 2.2);
  r = lin(r / n); g = lin(g / n); b = lin(b / n);
  const level = Math.max((r + g + b) / 3, 0.001);
  film.averageColor.setRGB(r / level, g / level, b / level);
  film.averageLevel = Math.min(level, 0.9);

  for (let q = 0; q < 4; q++) {
    const a = acc[q];
    const zr = lin(a[0] / a[3]), zg = lin(a[1] / a[3]), zb = lin(a[2] / a[3]);
    const zl = Math.max((zr + zg + zb) / 3, 0.001);
    const z = film.zones[q];
    z.color.setRGB(zr / zl, zg / zl, zb / zl);
    z.level = Math.min(zl, 0.9);
  }
}

// ------------------------------------------------------- in-VR panels
// In VR there is no DOM, so the console and the Nuvio browser are canvases
// on quads that the controllers point at.
const vrConsole = new VRConsole(scene, {
  play: () => {
    if (!hasSource()) { vrBrowser.mesh.visible = true; vrBrowser.placeInFront(camera); return; }
    audio.ensureStarted();
    videoEl.paused ? videoEl.play().catch(() => {}) : videoEl.pause();
  },
  seekBack: () => { if (isFinite(videoEl.duration)) videoEl.currentTime = Math.max(0, videoEl.currentTime - 30); },
  seekFwd: () => { if (isFinite(videoEl.duration)) videoEl.currentTime = Math.min(videoEl.duration, videoEl.currentTime + 30); },
  volDown: () => { audio.volume -= 0.1; vrConsole.state.volume = audio.volume; vrConsole.draw(); },
  volUp: () => { audio.volume += 0.1; vrConsole.state.volume = audio.volume; vrConsole.draw(); },
  browse: () => {
    vrBrowser.mesh.visible = true;
    vrBrowser.placeInFront(camera);
    if (!vrConsole.worn) vrConsole.mesh.visible = false;
  },
  seat: () => usePreset(presetIndex + 1),
  reel: () => stopVideo(),
  recenter: () => sit(currentSeat),
  bounceDown: () => { setBounce(bounceTrim - 0.2); },
  bounceUp: () => { setBounce(bounceTrim + 0.2); },
});

let bounceTrim = 1.0;
function setBounce(v) {
  bounceTrim = Math.max(0, Math.min(2.4, v));
  house.setBounce(bounceTrim);
  vrConsole.state.bounce = bounceTrim;
  vrConsole.draw();
}

const vrBrowser = new VRBrowser(scene, {
  onPlayUrl: (url, label) => playVideo(url, label),
});

const panels = [vrConsole, vrBrowser];

function panelHit(ctrl) {
  _o.setFromMatrixPosition(ctrl.matrixWorld);
  _d.set(0, 0, -1).applyQuaternion(ctrl.getWorldQuaternion(new THREE.Quaternion()));
  panelRay.set(_o, _d);
  let best = null;
  for (const p of panels) {
    if (!p.mesh.visible) continue;
    const hits = panelRay.intersectObject(p.mesh, false);
    if (hits.length && (!best || hits[0].distance < best.dist)) {
      best = { panel: p, button: p.hitTest(hits[0].uv), dist: hits[0].distance };
    }
  }
  return best;
}
const panelRay = new THREE.Raycaster();

// Panels take the trigger first; otherwise it is a seat teleport.
function onControllerSelect(c) {
  const hit = panelHit(c);
  if (hit) { hit.panel.press(hit.button); return; }
  const seat = aimSeat(c);
  if (seat) sit(seat);
  else usePreset(presetIndex + 1);
}

// Dock the console to the left wrist so it is never between you and the
// screen. Falls back to floating if no left controller reports in.
const grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
for (const g of grips) rig.add(g);
controllers.forEach((c, i) => c.addEventListener('connected', (e) => {
  if (e.data?.handedness !== 'left') return;
  grips[i].add(vrConsole.mesh);
  vrConsole.mesh.position.set(0, 0.08, 0.14);
  vrConsole.mesh.rotation.set(-1.0, 0, 0);
  vrConsole.mesh.scale.setScalar(0.30);
  vrConsole.worn = true;
}));

function undockConsole() {
  if (!vrConsole.worn) return;
  scene.add(vrConsole.mesh);
  vrConsole.mesh.rotation.set(0, 0, 0);
  vrConsole.mesh.scale.setScalar(1);
  vrConsole.worn = false;
}

renderer.xr.addEventListener('sessionstart', () => {
  vrConsole.mesh.visible = true;
  if (!vrConsole.worn) vrConsole.placeInFront(camera);
  // Nothing loaded yet: put the content browser straight in front of you.
  if (!hasSource()) {
    setTimeout(() => { vrBrowser.mesh.visible = true; vrBrowser.placeInFront(camera); }, 400);
  }
});
renderer.xr.addEventListener('sessionend', () => {
  undockConsole();
  vrBrowser.mesh.visible = false;
  vrConsole.mesh.visible = false;
});

videoEl.addEventListener('play', () => {
  vrConsole.state.playing = true; vrConsole.draw();
  // lights down, panel away
  setTimeout(() => { if (!vrConsole.worn) vrConsole.mesh.visible = false; }, 600);
});
videoEl.addEventListener('pause', () => { vrConsole.state.playing = false; vrConsole.draw(); });

// ---------------------------------------------------------------------- UI
if ('xr' in navigator) {
  const btn = VRButton.createButton(renderer);
  btn.classList.add('vrbtn');
  document.body.appendChild(btn);
}
document.getElementById('seatBtn')?.addEventListener('click', () => usePreset(presetIndex + 1));
document.getElementById('nuvioBtn')?.addEventListener('click', () => {
  vrBrowser.mesh.visible = true;
  vrBrowser.placeInFront(camera);
});
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
  if (e.key === 'c') { vrConsole.toggle(camera); if (vrConsole.mesh.visible) vrBrowser.mesh.visible = false; }
  if (e.key === 'b') { vrBrowser.toggle(camera); if (vrBrowser.mesh.visible && !vrConsole.worn) vrConsole.mesh.visible = false; }
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
let statusAcc = 0;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  film.update(dt);
  sampleVideo(dt);
  house.update();

  audio.updateListener(camera);

  if (renderer.xr.isPresenting) {
    // A controller aimed at a panel drives the panel, not the seat reticle.
    const hovered = new Map();
    let shown = false;
    for (const c of controllers) {
      if (!c.visible) continue;
      const ph = panelHit(c);
      if (ph) { hovered.set(ph.panel, ph.button); continue; }
      const hit = aimSeat(c);
      if (hit && !shown) {
        reticle.position.set(hit.x, hit.y + 0.02, hit.z);
        reticle.visible = true;
        shown = true;
      }
    }
    for (const p of panels) if (p.mesh.visible) p.setHover(hovered.get(p) || null);
    if (!shown) reticle.visible = false;
  } else {
    controls.update();
  }

  statusAcc += dt;
  if (statusAcc > 1) {
    statusAcc = 0;
    if (hasSource() && videoEl.duration) {
      const f = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      vrConsole.state.time = `${f(videoEl.currentTime)} / ${isFinite(videoEl.duration) ? f(videoEl.duration) : 'live'}`;
      vrConsole.state.audioMode = audio.ctx ? audio.mode : '';
      vrConsole.draw();
    }
  }
  renderer.render(scene, camera);
});

const info = `${house.stats.seats} seats · ${(house.stats.triangles / 1000).toFixed(0)}k triangles · ${house.stats.drawCalls} static meshes`;
console.log('IMAX GT auditorium ready —', info);
const statsEl = document.getElementById('stats');
if (statsEl) statsEl.textContent = info;

window.__house = house;
window.__film = film;
window.__audio = audio;
window.__console = vrConsole;
window.__browser = vrBrowser;
window.__playVideo = playVideo;
window.__videoEl = videoEl;
window.__camera = camera;
window.__controls = controls;
window.__renderer = renderer;
window.__sit = sit;
window.__usePreset = usePreset;
window.__exportGLB = () => exportGLB(house, film);
