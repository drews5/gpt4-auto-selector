// Procedural texture generation — everything is generated at load time so the
// model needs no external image assets. All canvases are power-of-two.
import * as THREE from 'three';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(canvas, { srgb = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

// Small deterministic PRNG so the model looks identical on every load.
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fine leather grain — neutral gray so the material color tints it.
export function leatherTexture() {
  const s = 512;
  const c = makeCanvas(s, s);
  const g = c.getContext('2d');
  const rnd = mulberry32(101);
  g.fillStyle = '#97979c';
  g.fillRect(0, 0, s, s);
  // cellular wrinkle pattern
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * s, y = rnd() * s;
    const r = 2 + rnd() * 7;
    const l = 118 + Math.floor(rnd() * 46);
    g.strokeStyle = `rgba(${l},${l},${l + 4},${0.16 + rnd() * 0.2})`;
    g.lineWidth = 0.6 + rnd() * 0.9;
    g.beginPath();
    const a0 = rnd() * Math.PI * 2;
    g.arc(x, y, r, a0, a0 + 1.2 + rnd() * 2.6);
    g.stroke();
  }
  // speckle
  const img = g.getImageData(0, 0, s, s);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

// Warm oak plank floor, planks running along X (u axis).
export function woodFloorTexture() {
  const w = 1024, h = 1024;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const rnd = mulberry32(202);
  const plankH = h / 8;
  for (let p = 0; p < 8; p++) {
    const y0 = p * plankH;
    const base = 86 + rnd() * 26;         // warm mid brown
    const grad = g.createLinearGradient(0, y0, 0, y0 + plankH);
    grad.addColorStop(0, `rgb(${base + 24},${base * 0.72 + 16},${base * 0.42}) `);
    grad.addColorStop(0.5, `rgb(${base + 38},${base * 0.74 + 22},${base * 0.44 + 6})`);
    grad.addColorStop(1, `rgb(${base + 18},${base * 0.7 + 12},${base * 0.4})`);
    g.fillStyle = grad;
    g.fillRect(0, y0, w, plankH);
    // grain streaks
    for (let i = 0; i < 46; i++) {
      const gy = y0 + rnd() * plankH;
      const alpha = 0.05 + rnd() * 0.11;
      const dark = rnd() > 0.4;
      g.strokeStyle = dark ? `rgba(52,30,12,${alpha})` : `rgba(232,196,140,${alpha * 0.8})`;
      g.lineWidth = 0.7 + rnd() * 1.8;
      g.beginPath();
      g.moveTo(0, gy);
      for (let x = 0; x <= w; x += 64) {
        g.lineTo(x, gy + Math.sin(x * 0.01 + i) * 2.2 + (rnd() - 0.5) * 2);
      }
      g.stroke();
    }
    // butt joints
    let jx = rnd() * w * 0.5;
    while (jx < w) {
      g.fillStyle = 'rgba(20,10,4,0.55)';
      g.fillRect(jx, y0, 2, plankH);
      jx += w * (0.35 + rnd() * 0.5);
    }
    // plank seam
    g.fillStyle = 'rgba(18,9,4,0.7)';
    g.fillRect(0, y0 + plankH - 1.5, w, 1.5);
  }
  return tex(c);
}

// Very dark blue-gray acoustic wall fabric with vertical panel seams.
export function wallFabricTexture() {
  const s = 512;
  const c = makeCanvas(s, s);
  const g = c.getContext('2d');
  const rnd = mulberry32(303);
  g.fillStyle = '#0a0d16';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * s, y = rnd() * s;
    const l = 10 + rnd() * 16;
    g.fillStyle = `rgba(${l},${l + 3},${l + 10},${0.25})`;
    g.fillRect(x, y, 1.4, 2.6);
  }
  // vertical panel seams
  for (let x = 0; x < s; x += 128) {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(x, 0, 3, s);
    g.fillStyle = 'rgba(64,84,140,0.10)';
    g.fillRect(x + 3, 0, 2, s);
  }
  return tex(c);
}

// Dark charcoal carpet with fleck.
export function carpetTexture() {
  const s = 256;
  const c = makeCanvas(s, s);
  const g = c.getContext('2d');
  const rnd = mulberry32(404);
  g.fillStyle = '#0b0c11';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 5200; i++) {
    const l = 10 + rnd() * 22;
    g.fillStyle = `rgba(${l},${l + 2},${l + 8},0.5)`;
    g.fillRect(rnd() * s, rnd() * s, 1.5, 1.5);
  }
  return tex(c);
}

// Radial glow sprite (white -> transparent).
export function glowRadialTexture() {
  const s = 256;
  const c = makeCanvas(s, s);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = tex(c, { srgb: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Soft vertical strip glow for LED tubes.
export function glowStripTexture() {
  const w = 64, h = 256;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const gx = g.createLinearGradient(0, 0, w, 0);
  gx.addColorStop(0, 'rgba(255,255,255,0)');
  gx.addColorStop(0.5, 'rgba(255,255,255,1)');
  gx.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gx;
  g.fillRect(0, 0, w, h);
  const gy = g.createLinearGradient(0, 0, 0, h);
  gy.addColorStop(0, 'rgba(0,0,0,1)');
  gy.addColorStop(0.12, 'rgba(0,0,0,0)');
  gy.addColorStop(0.88, 'rgba(0,0,0,0)');
  gy.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = gy;
  g.fillRect(0, 0, w, h);
  const t = tex(c, { srgb: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Glowing IMAX-style logotype: dark faces with a bright blue rim glow.
export function logoTexture() {
  const w = 2048, h = 512;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  const text = 'IMAX';
  g.font = `italic 900 ${h * 0.62}px Arial, Helvetica, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cx = w / 2, cy = h / 2 + h * 0.02;
  // wide outer halo
  g.shadowColor = 'rgba(40,110,255,0.85)';
  g.shadowBlur = 70;
  g.fillStyle = 'rgba(30,80,220,0.55)';
  for (let i = 0; i < 3; i++) g.fillText(text, cx, cy);
  // tight bright rim
  g.shadowColor = 'rgba(90,160,255,1)';
  g.shadowBlur = 22;
  g.strokeStyle = 'rgba(120,180,255,0.95)';
  g.lineWidth = 7;
  g.strokeText(text, cx, cy);
  // dark letter faces
  g.shadowBlur = 0;
  const face = g.createLinearGradient(0, cy - h * 0.3, 0, cy + h * 0.3);
  face.addColorStop(0, '#101d3f');
  face.addColorStop(0.5, '#16264f');
  face.addColorStop(1, '#0a1330');
  g.fillStyle = face;
  g.fillText(text, cx, cy);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Small green EXIT sign.
export function exitSignTexture() {
  const w = 256, h = 128;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#04180a';
  g.fillRect(0, 0, w, h);
  g.font = `900 ${h * 0.62}px Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(70,255,140,0.9)';
  g.shadowBlur = 18;
  g.fillStyle = '#5cff9a';
  g.fillText('EXIT', w / 2, h / 2 + 2);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function buildAllTextures() {
  return {
    leather: leatherTexture(),
    wood: woodFloorTexture(),
    wall: wallFabricTexture(),
    carpet: carpetTexture(),
    glowRadial: glowRadialTexture(),
    glowStrip: glowStripTexture(),
    logo: logoTexture(),
    exit: exitSignTexture(),
  };
}
