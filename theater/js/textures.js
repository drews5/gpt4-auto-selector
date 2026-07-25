// Every surface texture is generated at load time — the model ships with no
// image assets. Palette is drawn from real GT houses: near-black acoustic
// fabric, dark patterned aisle carpet, deep navy seat upholstery.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finish(c, { srgb = true, clamp = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(g, w, h, rnd, count, lo, hi, alpha) {
  for (let i = 0; i < count; i++) {
    const l = lo + rnd() * (hi - lo);
    g.fillStyle = `rgba(${l},${l},${l + 6},${alpha})`;
    g.fillRect(rnd() * w, rnd() * h, 1.3, 1.3);
  }
}

// Cinema aisle carpet: very dark navy ground with a restrained repeating
// diamond figure, the way most large-format houses carpet their stairs.
export function carpetTexture() {
  const s = 512, c = canvas(s, s), g = c.getContext('2d');
  const rnd = rng(11);
  g.fillStyle = '#1c2130';
  g.fillRect(0, 0, s, s);
  // woven base
  speckle(g, s, s, rnd, 26000, 22, 62, 0.5);
  // diamond lattice
  g.strokeStyle = 'rgba(74,88,132,0.26)';
  g.lineWidth = 2.2;
  const cell = s / 4;
  for (let i = -4; i < 8; i++) {
    g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell + s, s); g.stroke();
    g.beginPath(); g.moveTo(i * cell, s); g.lineTo(i * cell + s, 0); g.stroke();
  }
  // small accent dots at lattice crossings
  g.fillStyle = 'rgba(96,118,176,0.20)';
  for (let y = 0; y <= s; y += cell) {
    for (let x = 0; x <= s; x += cell) { g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.fill(); }
  }
  speckle(g, s, s, rnd, 9000, 14, 44, 0.55);
  return finish(c);
}

// Black acoustic wall fabric stretched over batten frames.
export function acousticTexture() {
  const s = 512, c = canvas(s, s), g = c.getContext('2d');
  const rnd = rng(22);
  g.fillStyle = '#1a1c24';
  g.fillRect(0, 0, s, s);
  // coarse weave
  for (let i = 0; i < 20000; i++) {
    const l = 20 + rnd() * 34;
    g.fillStyle = `rgba(${l},${l + 1},${l + 6},0.4)`;
    g.fillRect(rnd() * s, rnd() * s, 2.2, 1.1);
  }
  // vertical batten shadow lines every 2 m of wall
  for (let x = 0; x < s; x += s / 4) {
    const grad = g.createLinearGradient(x - 5, 0, x + 5, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.75)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - 5, 0, 10, s);
  }
  return finish(c);
}

// Perforated black metal — speaker grilles and the ceiling baffles.
export function perfMetalTexture() {
  const s = 256, c = canvas(s, s), g = c.getContext('2d');
  g.fillStyle = '#23262e';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#08090c';
  const step = 10;
  for (let y = 0; y < s; y += step) {
    for (let x = 0; x < s; x += step) {
      const ox = (y / step) % 2 ? step / 2 : 0;
      g.beginPath(); g.arc(x + ox, y, 2.6, 0, 7); g.fill();
    }
  }
  g.fillStyle = 'rgba(130,138,158,0.20)';
  for (let y = 0; y < s; y += step) {
    for (let x = 0; x < s; x += step) {
      const ox = (y / step) % 2 ? step / 2 : 0;
      g.beginPath(); g.arc(x + ox - 0.7, y - 0.7, 2.9, 3.4, 5.6); g.fill();
    }
  }
  return finish(c);
}

// Deep navy upholstery with a visible weave — the seat faces.
export function seatFabricTexture() {
  const s = 256, c = canvas(s, s), g = c.getContext('2d');
  const rnd = rng(33);
  g.fillStyle = '#333a4c';
  g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 3) {
    g.fillStyle = `rgba(0,0,0,${0.10 + rnd() * 0.06})`;
    g.fillRect(0, y, s, 1.4);
  }
  for (let x = 0; x < s; x += 3) {
    g.fillStyle = `rgba(255,255,255,${0.030 + rnd() * 0.025})`;
    g.fillRect(x, 0, 1.4, s);
  }
  for (let i = 0; i < 14000; i++) {
    const l = 46 + rnd() * 46;
    g.fillStyle = `rgba(${l * 0.86},${l * 0.92},${l * 1.14},0.35)`;
    g.fillRect(rnd() * s, rnd() * s, 1.2, 1.2);
  }
  return finish(c);
}

// Moulded seat back shell / armrest vinyl.
export function shellTexture() {
  const s = 256, c = canvas(s, s), g = c.getContext('2d');
  const rnd = rng(44);
  g.fillStyle = '#282b33';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    const l = 30 + rnd() * 30;
    g.fillStyle = `rgba(${l},${l},${l + 6},0.3)`;
    g.fillRect(rnd() * s, rnd() * s, 1.6, 1.6);
  }
  return finish(c);
}

// Brushed dark steel for the handrails and stair nosings.
export function metalTexture() {
  const s = 256, c = canvas(s, s), g = c.getContext('2d');
  const rnd = rng(55);
  g.fillStyle = '#43474f';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) {
    const y = rnd() * s;
    const l = 46 + rnd() * 46;
    g.strokeStyle = `rgba(${l},${l + 2},${l + 8},0.25)`;
    g.lineWidth = 0.6 + rnd();
    g.beginPath(); g.moveTo(0, y); g.lineTo(s, y + (rnd() - 0.5) * 2); g.stroke();
  }
  return finish(c);
}

// Painted structural concrete for the ceiling deck.
export function ceilingTexture() {
  const s = 512, c = canvas(s, s), g = c.getContext('2d');
  const rnd = rng(66);
  g.fillStyle = '#1a1c21';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 12000; i++) {
    const l = 22 + rnd() * 26;
    g.fillStyle = `rgba(${l},${l},${l + 4},0.4)`;
    g.fillRect(rnd() * s, rnd() * s, 2.4, 2.4);
  }
  return finish(c);
}

// The IMAX wordmark, lit from within like the illuminated house sign.
export function logoTexture() {
  const w = 2048, h = 512, c = canvas(w, h), g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.font = `italic 900 ${h * 0.60}px Arial, Helvetica, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cx = w / 2, cy = h / 2;
  g.shadowColor = 'rgba(38,104,255,0.9)';
  g.shadowBlur = 64;
  g.fillStyle = 'rgba(26,74,210,0.5)';
  for (let i = 0; i < 3; i++) g.fillText('IMAX', cx, cy);
  g.shadowColor = 'rgba(120,180,255,1)';
  g.shadowBlur = 20;
  g.strokeStyle = 'rgba(150,200,255,0.95)';
  g.lineWidth = 6;
  g.strokeText('IMAX', cx, cy);
  g.shadowBlur = 0;
  const face = g.createLinearGradient(0, cy - h * 0.3, 0, cy + h * 0.3);
  face.addColorStop(0, '#12224a');
  face.addColorStop(0.5, '#1a2c5c');
  face.addColorStop(1, '#0b1330');
  g.fillStyle = face;
  g.fillText('IMAX', cx, cy);
  return finish(c, { clamp: true });
}

export function exitSignTexture() {
  const w = 256, h = 128, c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#03140a';
  g.fillRect(0, 0, w, h);
  g.font = `900 ${h * 0.58}px Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(80,255,150,0.95)'; g.shadowBlur = 20;
  g.fillStyle = '#63ffa4';
  g.fillText('EXIT', w / 2, h / 2 + 2);
  return finish(c, { clamp: true });
}

// 16 row placards (A–P) in one strip; each sign samples one cell.
export function rowLetterAtlas(rows) {
  const cell = 128, w = cell * rows, h = cell, c = canvas(w, h), g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.font = `700 ${cell * 0.62}px Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < rows; i++) {
    const x = i * cell + cell / 2;
    g.shadowColor = 'rgba(120,180,255,0.9)'; g.shadowBlur = 16;
    g.fillStyle = '#bcd8ff';
    g.fillText(String.fromCharCode(65 + i), x, h / 2 + 2);
  }
  return finish(c, { clamp: true });
}

// Soft additive falloff used for cove bloom and step-light pools.
export function glowTexture() {
  const s = 128, c = canvas(s, s), g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.42)');
  grad.addColorStop(0.65, 'rgba(255,255,255,0.11)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return finish(c, { srgb: false, clamp: true, aniso: 1 });
}

export function buildTextures(rows = 16) {
  return {
    rowLetters: rowLetterAtlas(rows),
    carpet: carpetTexture(),
    acoustic: acousticTexture(),
    perfMetal: perfMetalTexture(),
    seatFabric: seatFabricTexture(),
    shell: shellTexture(),
    metal: metalTexture(),
    ceiling: ceilingTexture(),
    logo: logoTexture(),
    exit: exitSignTexture(),
    glow: glowTexture(),
  };
}
