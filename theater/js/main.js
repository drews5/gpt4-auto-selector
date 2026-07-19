import * as THREE from 'three';
import { VRButton } from '../vendor/VRButton.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { buildAllTextures } from './textures.js';
import { buildTheater } from './theater.js';
import { exportGLB } from './export.js';

const IS_XR_CAPABLE = 'xr' in navigator;

// ------------------------------------------------------------ renderer -----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
renderer.xr.enabled = true;
renderer.xr.setFoveation(1);          // strongest fixed foveation on Quest
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03040a);
scene.fog = new THREE.FogExp2(0x04060c, 0.011);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.05, 90);

// ---------------------------------------------------------------- scene ----
const textures = buildAllTextures();
const theater = buildTheater(textures);
scene.add(theater.group);

// XR rig: move this, never the camera, while in VR.
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

// ------------------------------------------------------------- controls ----
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxDistance = 40;
controls.minDistance = 0.3;

let viewIndex = 0;
function applyView(i, instant = true) {
  viewIndex = ((i % theater.views.length) + theater.views.length) % theater.views.length;
  const v = theater.views[viewIndex];
  if (renderer.xr.isPresenting) {
    // local-floor space: rig sits on the seat platform at the seat position
    rig.position.copy(v.floor);
    rig.position.z -= 0.15;           // scoot slightly forward of the cushion
  } else {
    camera.position.copy(v.position);
    controls.target.copy(v.target);
    controls.update();
  }
  const label = document.getElementById('viewName');
  if (label) label.textContent = v.name;
}
applyView(0);

// In VR: squeeze or A/X cycles seats.
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  ctrl.addEventListener('squeezestart', () => applyView(viewIndex + 1));
  ctrl.addEventListener('selectstart', () => applyView(viewIndex + 1));
  rig.add(ctrl);
}
renderer.xr.addEventListener('sessionstart', () => applyView(viewIndex));
renderer.xr.addEventListener('sessionend', () => applyView(viewIndex));

// ---------------------------------------------------------------- video ----
let videoEl = null;
function playVideoFile(file) {
  if (!videoEl) {
    videoEl = document.createElement('video');
    videoEl.loop = true;
    videoEl.muted = false;
    videoEl.playsInline = true;
    videoEl.crossOrigin = 'anonymous';
  }
  videoEl.src = typeof file === 'string' ? file : URL.createObjectURL(file);
  videoEl.play().catch(() => {
    videoEl.muted = true;
    videoEl.play();
  });
  const vt = new THREE.VideoTexture(videoEl);
  vt.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: vt });
  mat.toneMapped = false;
  theater.screen.material = mat;
}
function stopVideo() {
  if (videoEl) videoEl.pause();
  theater.screen.material = theater.screenMat;
}

// ------------------------------------------------------------------- UI ----
const ui = document.getElementById('ui');
if (IS_XR_CAPABLE) {
  const btn = VRButton.createButton(renderer);
  btn.classList.add('vrbtn');
  document.body.appendChild(btn);
}
document.getElementById('seatBtn')?.addEventListener('click', () => applyView(viewIndex + 1));
document.getElementById('videoInput')?.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) playVideoFile(e.target.files[0]);
});
document.getElementById('ambientBtn')?.addEventListener('click', stopVideo);
document.getElementById('exportBtn')?.addEventListener('click', async () => {
  const buf = await exportGLB(theater);
  const blob = new Blob([buf], { type: 'model/gltf-binary' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'imax-theater.glb';
  a.click();
});
window.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= String(theater.views.length)) applyView(Number(e.key) - 1);
  if (e.key === 'v') applyView(viewIndex + 1);
});

const params = new URLSearchParams(location.search);
if (params.get('video')) playVideoFile(params.get('video'));
if (params.get('hideui') && ui) ui.style.display = 'none';

// hooks for automated capture / model export
window.__theater = theater;
window.__setView = applyView;
window.__exportGLB = () => exportGLB(theater);
window.__camera = camera;
window.__controls = controls;
window.__renderer = renderer;

// ----------------------------------------------------------------- loop ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  theater.animate(t);
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
});

console.log(`IMAX theater ready — ${theater.stats.seats} seats`);
