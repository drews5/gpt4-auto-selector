// IMAX-style auditorium: curved stadium seating, wood terraces, LED-strip
// walls, glowing logotype and a giant curved screen.
//
// Quest-friendly by construction: static geometry is merged per-material,
// seats are a single InstancedMesh, all "lights" except three real ones are
// emissive/unlit surfaces, no shadow maps, no post-processing.
import * as THREE from 'three';
import * as BufferGeometryUtils from '../vendor/BufferGeometryUtils.js';
import { buildSeatGeometry, buildTrayGeometry } from './seat.js';

// ---------------------------------------------------------------- layout ---
export const LAYOUT = {
  screenZ: -13.5,          // arc center (also screen surface center) z
  screenW: 19.5,
  screenH: 10.6,
  screenR: 24,             // screen curvature radius
  screenCenterY: 6.15,
  rows: 10,
  row0Radius: 7.6,
  rowPitch: 1.38,
  seatPitch: 0.88,
  roomHalfW: 11.6,
  roomBackZ: 8.6,
  roomFrontZ: -14.6,
  roomH: 13.2,
};

function rowRadius(i) { return LAYOUT.row0Radius + i * LAYOUT.rowPitch; }
function rowY(i) { return i === 0 ? 0 : 0.35 + (i - 1) * 0.5; }
function rowHalfArc(i) { return 4.9 + i * 0.55; }               // half arc-length of seating
function rowTheta(i) { return rowHalfArc(i) / rowRadius(i); }    // half angular span

// ------------------------------------------------------------- utilities ---
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

function xf(geo, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
  tmpQ.setFromEuler(tmpE.set(rx, ry, rz));
  tmpM.compose(tmpV.set(x, y, z), tmpQ, new THREE.Vector3(s, s, s));
  geo.applyMatrix4(tmpM);
  return geo;
}

// Flat annular sector lying in XZ, centered on +Z from the arc center.
// UVs are world-planar so the plank texture flows continuously across tiers.
function ringSector(innerR, outerR, y, theta, uvWorldScale = 1.25) {
  const seg = Math.max(10, Math.round((theta * 2 * outerR) / 0.45));
  const g = new THREE.RingGeometry(innerR, outerR, seg, 1, -Math.PI / 2 - theta, theta * 2);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, LAYOUT.screenZ);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / uvWorldScale, pos.getZ(i) / uvWorldScale);
  }
  return g;
}

// Open cylinder-wall sector centered on +Z from the arc center.
function wallSector(radius, y0, y1, theta, uvWorldScale = 1.25) {
  const seg = Math.max(10, Math.round((theta * 2 * radius) / 0.45));
  const g = new THREE.CylinderGeometry(radius, radius, y1 - y0, seg, 1, true, -theta, theta * 2);
  g.translate(0, (y0 + y1) / 2, 0);
  g.translate(0, 0, LAYOUT.screenZ);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getX(i), pos.getZ(i) - LAYOUT.screenZ);
    uv.setXY(i, (a * radius) / uvWorldScale, pos.getY(i) / uvWorldScale);
  }
  return g;
}

// Flip an indexed geometry inside-out (reverse winding + negate normals).
function flipGeometry(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t;
  }
  const n = g.attributes.normal.array;
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return g;
}

function planeUVWorld(g, scale) {
  g.computeBoundingBox();
  const uv = g.attributes.uv, pos = g.attributes.position;
  const size = new THREE.Vector3();
  g.boundingBox.getSize(size);
  // pick the two largest axes for planar mapping
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (size.x <= size.y && size.x <= size.z) { u = z; v = y; }
    else if (size.y <= size.x && size.y <= size.z) { u = x; v = z; }
    else { u = x; v = y; }
    uv.setXY(i, u / scale, v / scale);
  }
  return g;
}

function mergeList(list) {
  const g = BufferGeometryUtils.mergeGeometries(list, false);
  list.forEach((x) => x.dispose());
  return g;
}

// ------------------------------------------------------- screen material ---
const SCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SCREEN_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  vec3 palette(float i) {
    // deep cinematic palette
    vec3 cols[6];
    cols[0] = vec3(0.03, 0.10, 0.38);   // deep blue
    cols[1] = vec3(0.24, 0.08, 0.42);   // violet
    cols[2] = vec3(0.02, 0.30, 0.42);   // teal
    cols[3] = vec3(0.55, 0.26, 0.08);   // warm amber
    cols[4] = vec3(0.05, 0.06, 0.30);   // indigo
    cols[5] = vec3(0.35, 0.10, 0.16);   // crimson
    int idx = int(mod(i, 6.0));
    for (int k = 0; k < 6; k++) if (k == idx) return cols[k];
    return cols[0];
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    p.x *= 1.84;
    float t = uTime * 0.08;
    float scene = floor(uTime / 16.0);
    float sceneFade = smoothstep(0.0, 0.12, fract(uTime / 16.0)) *
                      (1.0 - smoothstep(0.94, 1.0, fract(uTime / 16.0)));

    vec3 col = vec3(0.012, 0.016, 0.035);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 c = vec2(
        sin(t * (0.9 + fi * 0.35) + fi * 2.3 + scene) * (0.9 - fi * 0.18),
        cos(t * (0.7 + fi * 0.28) + fi * 1.7 + scene * 2.0) * (0.55 - fi * 0.1)
      );
      float d = length(p - c);
      vec3 bc = mix(palette(scene + fi), palette(scene + fi + 1.0), 0.5 + 0.5 * sin(t + fi));
      col += bc * exp(-d * d * (2.2 + fi * 1.3)) * (0.85 + 0.35 * sin(t * 3.0 + fi * 2.0));
    }
    // horizontal sheen sweep, like a slow pan over glass
    col += vec3(0.10, 0.13, 0.22) * exp(-pow((p.x - sin(t * 1.7) * 1.6) * 2.0, 2.0)) * 0.5;

    // vignette + edge falloff of the projected image
    float vig = smoothstep(1.75, 0.45, length(p * vec2(0.62, 1.0)));
    col *= 0.45 + 0.55 * vig;
    col *= 0.72 + 0.28 * sceneFade;

    // stage uplights washing the bottom of the silver screen (8 fixtures)
    float wash = 0.0;
    for (int k = 0; k < 8; k++) {
      float fx = -1.55 + 3.1 * float(k) / 7.0;
      wash += exp(-pow((p.x - fx) * 3.4, 2.0)) ;
    }
    float washY = exp(-pow((vUv.y) * 3.2, 2.0));
    col += vec3(0.18, 0.34, 0.85) * wash * washY * 0.55;

    // film grain
    float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 371.0);
    col += (g - 0.5) * 0.035;

    gl_FragColor = vec4(col * 2.1, 1.0);
  }
`;

// JS twin of the shader mood, used to tint the real screen-light.
export function screenMoodColor(time, target) {
  const t = time * 0.08;
  const cols = [
    [0.03, 0.10, 0.38], [0.24, 0.08, 0.42], [0.02, 0.30, 0.42],
    [0.55, 0.26, 0.08], [0.05, 0.06, 0.30], [0.35, 0.10, 0.16],
  ];
  const scene = Math.floor(time / 16);
  let r = 0.05, g = 0.07, b = 0.14;
  for (let i = 0; i < 3; i++) {
    const c = cols[((scene + i) % 6 + 6) % 6];
    const w = 0.55 + 0.35 * Math.sin(t * 3 + i * 2);
    r += c[0] * w * 0.4; g += c[1] * w * 0.4; b += c[2] * w * 0.4;
  }
  const m = Math.max(r, g, b);
  target.setRGB(r / m, g / m, b / m);
  return 0.75 + 0.3 * Math.sin(t * 3.0);
}

// ---------------------------------------------------------------- build ----
export function buildTheater(tex) {
  const L = LAYOUT;
  const group = new THREE.Group();
  const rnd = mulberry(7);

  // ---- materials
  const matWood = new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.6, metalness: 0.02 });
  const matWall = new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.92, metalness: 0.0 });
  const matCarpet = new THREE.MeshStandardMaterial({ map: tex.carpet, roughness: 0.97 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x0e1016, roughness: 0.85, metalness: 0.05 });
  const matDarkDouble = new THREE.MeshStandardMaterial({ color: 0x11131b, roughness: 0.8, side: THREE.DoubleSide });
  const matSeat = new THREE.MeshStandardMaterial({
    map: tex.leather, vertexColors: true, roughness: 0.78, metalness: 0.02,
  });
  const matLED = new THREE.MeshBasicMaterial({ color: 0xcfe4ff });
  matLED.toneMapped = false;
  const matLEDdim = new THREE.MeshBasicMaterial({ color: 0x3b6fd6 });
  matLEDdim.toneMapped = false;
  const matGlowStrip = new THREE.MeshBasicMaterial({
    map: tex.glowStrip, color: 0x2f6bff, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  matGlowStrip.toneMapped = false;
  const matGlowRadial = new THREE.MeshBasicMaterial({
    map: tex.glowRadial, color: 0x2c62ff, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  matGlowRadial.toneMapped = false;

  const woodParts = [];
  const darkParts = [];
  const wallParts = [];
  const carpetParts = [];
  const ledParts = [];       // bright emissive
  const ledDimParts = [];    // softer emissive bands
  const glowStripParts = []; // additive planes
  const glowRadialParts = [];

  // ---- room shell -------------------------------------------------------
  {
    const W = L.roomHalfW, H = L.roomH, zB = L.roomBackZ, zF = L.roomFrontZ;
    const back = new THREE.PlaneGeometry(W * 2, H);
    back.rotateY(Math.PI);
    back.translate(0, H / 2, zB);
    const front = new THREE.PlaneGeometry(W * 2, H);
    front.translate(0, H / 2, zF);
    const left = new THREE.PlaneGeometry(zB - zF, H);
    left.rotateY(Math.PI / 2);
    left.translate(-W, H / 2, (zB + zF) / 2);
    const right = new THREE.PlaneGeometry(zB - zF, H);
    right.rotateY(-Math.PI / 2);
    right.translate(W, H / 2, (zB + zF) / 2);
    const ceil = new THREE.PlaneGeometry(W * 2, zB - zF);
    ceil.rotateX(Math.PI / 2);
    ceil.translate(0, H, (zB + zF) / 2);
    for (const g of [back, front, left, right]) wallParts.push(planeUVWorld(g, 2.6));
    darkParts.push(planeUVWorld(ceil, 3.0));

    // front flat floor (stage area up to row 0)
    const floor = new THREE.PlaneGeometry(W * 2, 24);
    floor.rotateX(-Math.PI / 2);
    floor.translate(0, -0.001, zF + 12);
    carpetParts.push(planeUVWorld(floor, 1.4));
  }

  // ---- tiers, risers, edge lighting -------------------------------------
  const dotMats = [];      // step-light instances
  const stairTheta = [];   // per-row aisle angle (stairs live just outside seats)
  for (let i = 0; i < L.rows; i++) {
    const r = rowRadius(i), y = rowY(i), th = rowTheta(i);
    const thExt = th + 1.55 / r;              // platform extends past seats into aisle
    const inner = r - 0.75;
    const outer = r + (i === L.rows - 1 ? 0.95 : 0.63);
    stairTheta.push(th + 0.75 / r);

    woodParts.push(ringSector(inner, outer, y, thExt));
    if (i > 0) {
      const yPrev = rowY(i - 1);
      darkParts.push(wallSector(inner, yPrev, y, thExt));
      // LED accent band along the riser top edge
      ledDimParts.push(xf(
        new THREE.CylinderGeometry(inner + 0.012, inner + 0.012, 0.03, 48, 1, true, -thExt, thExt * 2),
        0, y - 0.025, L.screenZ,
      ));
    }
    // step lights along the platform front edge
    const dotR = inner + 0.14;
    const dotCount = Math.max(4, Math.floor((2 * th * dotR) / 1.05));
    for (let d = 0; d <= dotCount; d++) {
      const a = -th + (2 * th * d) / dotCount;
      dotMats.push({ x: dotR * Math.sin(a), y: y + 0.004, z: L.screenZ + dotR * Math.cos(a) });
    }
  }

  // ---- side aisle stairs -------------------------------------------------
  for (let i = 1; i < L.rows; i++) {
    const y0 = rowY(i - 1), y1 = rowY(i);
    const rMid = rowRadius(i) - 0.75;         // riser radius
    for (const s of [-1, 1]) {
      const a = s * stairTheta[i];
      for (let k = 0; k < 2; k++) {
        const stepY = y0 + ((y1 - y0) * (k + 1)) / 2;
        const stepR = rMid + 0.36 - k * 0.36;
        const g = new THREE.BoxGeometry(1.15, 0.06, 0.38);
        planeUVWorld(g, 1.25);
        xf(g, stepR * Math.sin(a), stepY - 0.03, L.screenZ + stepR * Math.cos(a), 0, a);
        woodParts.push(g);
        dotMats.push({
          x: (stepR + 0.12) * Math.sin(a), y: stepY + 0.004, z: L.screenZ + (stepR + 0.12) * Math.cos(a),
        });
      }
    }
  }

  // ---- terrace divider half-walls (rows 3 and 6) -------------------------
  for (const i of [3, 6]) {
    const y = rowY(i), th = rowTheta(i) + 1.55 / rowRadius(i);
    const rr = rowRadius(i) - 0.78;
    const wall = wallSector(rr, y, y + 0.78, th);
    darkParts.push(wall);   // matDark is single-sided; add inner shell too
    darkParts.push(flipGeometry(wallSector(rr - 0.09, y, y + 0.78, th)));
    // wood cap
    woodParts.push(ringSector(rr - 0.12, rr + 0.06, y + 0.78, th));
    // LED underglow on the audience side of the cap
    ledDimParts.push(xf(
      new THREE.CylinderGeometry(rr - 0.1, rr - 0.1, 0.025, 48, 1, true, -th, th * 2),
      0, y + 0.74, L.screenZ,
    ));
  }

  // ---- seats -------------------------------------------------------------
  const seatGeo = buildSeatGeometry();
  const seatTransforms = [];
  const trayTransforms = [];
  for (let i = 0; i < L.rows; i++) {
    const r = rowRadius(i), y = rowY(i), th = rowTheta(i);
    const count = Math.max(2, Math.floor((2 * th * r) / L.seatPitch));
    for (let sIdx = 0; sIdx < count; sIdx++) {
      const a = -th + ((sIdx + 0.5) * 2 * th) / count;
      const t = {
        x: r * Math.sin(a), y, z: L.screenZ + r * Math.cos(a), ry: a,
      };
      seatTransforms.push(t);
      if (i < 3) trayTransforms.push(t);
    }
  }
  const seats = new THREE.InstancedMesh(seatGeo, matSeat, seatTransforms.length);
  seatTransforms.forEach((t, k) => {
    tmpQ.setFromEuler(tmpE.set(0, t.ry, 0));
    tmpM.compose(tmpV.set(t.x, t.y, t.z), tmpQ, ONE);
    seats.setMatrixAt(k, tmpM);
  });
  seats.instanceMatrix.needsUpdate = true;
  group.add(seats);

  const trayGeo = buildTrayGeometry();
  const matTray = new THREE.MeshStandardMaterial({ color: 0x232637, roughness: 0.4, metalness: 0.3, vertexColors: true });
  const trays = new THREE.InstancedMesh(trayGeo, matTray, trayTransforms.length);
  trayTransforms.forEach((t, k) => {
    tmpQ.setFromEuler(tmpE.set(0, t.ry, 0));
    // offset trays to the seat's right armrest
    const ox = 0.47 * Math.cos(t.ry), oz = -0.47 * Math.sin(t.ry);
    tmpM.compose(tmpV.set(t.x + ox, t.y, t.z + oz), tmpQ, ONE);
    trays.setMatrixAt(k, tmpM);
  });
  trays.instanceMatrix.needsUpdate = true;
  group.add(trays);

  // seat-side courtesy lights (tiny blue dots on armrests)
  const seatDotGeo = new THREE.CircleGeometry(0.02, 8);
  const seatDots = new THREE.InstancedMesh(seatDotGeo, matLEDdim, seatTransforms.length);
  seatTransforms.forEach((t, k) => {
    const ox = 0.405 * Math.cos(t.ry), oz = -0.405 * Math.sin(t.ry);
    // face outward (+x in seat space)
    tmpQ.setFromEuler(tmpE.set(0, t.ry + Math.PI / 2, 0));
    tmpM.compose(tmpV.set(t.x + ox, t.y + 0.45, t.z + oz), tmpQ, ONE);
    seatDots.setMatrixAt(k, tmpM);
  });
  group.add(seatDots);

  // ---- step-light dots ---------------------------------------------------
  const dotGeo = new THREE.CircleGeometry(0.028, 10);
  dotGeo.rotateX(-Math.PI / 2);
  const dots = new THREE.InstancedMesh(dotGeo, matLED, dotMats.length);
  dotMats.forEach((d, k) => {
    tmpM.makeTranslation(d.x, d.y, d.z);
    dots.setMatrixAt(k, tmpM);
  });
  group.add(dots);

  // ---- screen ------------------------------------------------------------
  const screenMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: SCREEN_VERT,
    fragmentShader: SCREEN_FRAG,
  });
  const screenGeo = new THREE.PlaneGeometry(L.screenW, L.screenH, 48, 1);
  {
    const pos = screenGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, L.screenR - Math.sqrt(L.screenR * L.screenR - x * x));
    }
    screenGeo.computeVertexNormals();
  }
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(0, L.screenCenterY, L.screenZ);
  group.add(screen);

  // black masking behind/around the screen + under-screen stage wall
  {
    const mask = new THREE.PlaneGeometry(L.roomHalfW * 2, L.roomH);
    mask.translate(0, L.roomH / 2, L.roomFrontZ + 0.35);
    darkParts.push(planeUVWorld(mask, 3));
    const stage = new THREE.BoxGeometry(L.screenW + 2.4, 0.9, 2.2);
    stage.translate(0, 0.45, L.screenZ + 1.0);
    darkParts.push(planeUVWorld(stage, 3));
  }

  // ---- LED wall strips ---------------------------------------------------
  // side walls: columns of 1–2 segments each
  for (const side of [-1, 1]) {
    const x = side * (L.roomHalfW - 0.06);
    const ry = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    for (let z = -11.5; z < L.roomBackZ - 0.8; z += 1.65) {
      if (rnd() < 0.18) continue;
      const segs = rnd() < 0.4 ? 2 : 1;
      let yCursor = 2.2 + rnd() * 3.4;
      for (let s2 = 0; s2 < segs; s2++) {
        const len = 1.3 + rnd() * 2.4;
        const y = Math.min(L.roomH - 1.2 - len / 2, yCursor + len / 2);
        const s = new THREE.BoxGeometry(0.05, len, 0.055);
        xf(s, x, y, z, 0, ry);
        ledParts.push(s);
        const g = new THREE.PlaneGeometry(0.7, len * 1.3);
        xf(g, x - side * 0.09, y, z, 0, ry);
        glowStripParts.push(g);
        yCursor = y + len / 2 + 0.9 + rnd() * 1.5;
      }
    }
  }
  // back wall: strips flanking the logo
  for (let x = -L.roomHalfW + 1.2; x < L.roomHalfW - 1.0; x += 1.7) {
    if (Math.abs(x) < 4.6 && rnd() < 0.5) continue;
    if (rnd() < 0.15) continue;
    const len = 1.4 + rnd() * 2.6;
    const y = 3.0 + rnd() * (L.roomH - 5.2 - len);
    const s = new THREE.BoxGeometry(0.05, len, 0.055);
    xf(s, x, y, L.roomBackZ - 0.06, 0, Math.PI);
    ledParts.push(s);
    const g = new THREE.PlaneGeometry(0.7, len * 1.3);
    xf(g, x, y, L.roomBackZ - 0.15, 0, Math.PI);
    glowStripParts.push(g);
  }

  // ---- logos -------------------------------------------------------------
  const matLogo = new THREE.MeshBasicMaterial({ map: tex.logo, transparent: true });
  matLogo.toneMapped = false;
  {
    const back = new THREE.PlaneGeometry(7.4, 1.85);
    back.rotateY(Math.PI);
    back.translate(0, 9.0, L.roomBackZ - 0.1);
    const side = new THREE.PlaneGeometry(6.6, 1.65);
    side.rotateY(-Math.PI / 2);
    side.translate(L.roomHalfW - 0.1, 7.6, -1.5);
    const logos = new THREE.Mesh(mergeList([back, side]), matLogo);
    group.add(logos);
    // soft halo behind each logo
    const halo1 = new THREE.PlaneGeometry(10.5, 4.2);
    halo1.rotateY(Math.PI);
    halo1.translate(0, 9.0, L.roomBackZ - 0.16);
    const halo2 = new THREE.PlaneGeometry(9.4, 3.8);
    halo2.rotateY(-Math.PI / 2);
    halo2.translate(L.roomHalfW - 0.16, 7.6, -1.5);
    glowRadialParts.push(halo1, halo2);
  }

  // ---- exit signs --------------------------------------------------------
  const matExit = new THREE.MeshBasicMaterial({ map: tex.exit });
  matExit.toneMapped = false;
  {
    const g1 = new THREE.PlaneGeometry(0.6, 0.3);
    g1.translate(-(L.roomHalfW - 1.6), 2.7, L.roomFrontZ + 0.42);
    const g2 = g1.clone();
    g2.translate(2 * (L.roomHalfW - 1.6), 0, 0);
    group.add(new THREE.Mesh(mergeList([g1, g2]), matExit));
  }

  // ---- ceiling downlights ------------------------------------------------
  {
    const matWarm = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    matWarm.toneMapped = false;
    const parts = [];
    for (let k = 0; k < 26; k++) {
      const g = new THREE.CircleGeometry(0.07, 10);
      g.rotateX(Math.PI / 2);
      const x = (rnd() * 2 - 1) * (L.roomHalfW - 2.5);
      const z = -6 + rnd() * 13;
      g.translate(x, L.roomH - 0.05, z);
      parts.push(g);
    }
    group.add(new THREE.Mesh(mergeList(parts), matWarm));
  }

  // ---- projector + beam --------------------------------------------------
  const beams = [];
  {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.7, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.6 }),
    );
    body.position.set(0, 11.1, L.roomBackZ - 0.7);
    group.add(body);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), matLED);
    lens.rotation.y = Math.PI;
    lens.position.set(0, 11.05, L.roomBackZ - 1.32);
    group.add(lens);

    const from = new THREE.Vector3(0, 11.05, L.roomBackZ - 1.3);
    const to = new THREE.Vector3(0, L.screenCenterY, L.screenZ);
    const dir = to.clone().sub(from);
    const lenB = dir.length();
    for (const [r0, r1, op] of [[0.10, 4.2, 0.03], [0.05, 2.4, 0.035]]) {
      const cg = new THREE.CylinderGeometry(r1, r0, lenB, 20, 1, true);
      cg.translate(0, -lenB / 2, 0);
      cg.rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicMaterial({
        color: 0x2c4a86, transparent: true, opacity: op,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      m.toneMapped = false;
      const beam = new THREE.Mesh(cg, m);
      beam.position.copy(from);
      beam.lookAt(to);
      group.add(beam);
      beams.push(m);
    }
  }

  // ---- merge + attach static parts --------------------------------------
  group.add(new THREE.Mesh(mergeList(woodParts), matWood));
  group.add(new THREE.Mesh(mergeList(darkParts), matDark));
  group.add(new THREE.Mesh(mergeList(wallParts), matWall));
  group.add(new THREE.Mesh(mergeList(carpetParts), matCarpet));
  group.add(new THREE.Mesh(mergeList(ledParts), matLED));
  group.add(new THREE.Mesh(mergeList(ledDimParts), matLEDdim));
  const glowStrips = new THREE.Mesh(mergeList(glowStripParts), matGlowStrip);
  glowStrips.renderOrder = 5;
  glowStrips.name = 'glowStrips';
  group.add(glowStrips);
  const glowRadials = new THREE.Mesh(mergeList(glowRadialParts), matGlowRadial);
  glowRadials.renderOrder = 5;
  glowRadials.name = 'glowRadials';
  group.add(glowRadials);
  matGlowStrip.fog = false;
  matGlowRadial.fog = false;

  // ---- real lights (only four) ------------------------------------------
  const hemi = new THREE.HemisphereLight(0x2a3550, 0x141009, 0.6);
  group.add(hemi);
  const screenLight = new THREE.PointLight(0x4477ff, 120, 48, 1.45);
  screenLight.position.set(0, 5, -9.5);
  group.add(screenLight);
  const backFill = new THREE.PointLight(0x36426e, 12, 32, 1.7);
  backFill.position.set(0, 9, 5);
  group.add(backFill);
  const midFill = new THREE.PointLight(0x2e3f70, 10, 45, 1.8);
  midFill.position.set(0, 10, -1.5);
  group.add(midFill);

  // ---- viewpoints --------------------------------------------------------
  const lookTarget = new THREE.Vector3(0, L.screenCenterY, L.screenZ);
  function seatView(row) {
    const r = rowRadius(row);
    return {
      position: new THREE.Vector3(0, rowY(row) + 1.24, L.screenZ + r),
      floor: new THREE.Vector3(0, rowY(row), L.screenZ + r),
      target: lookTarget.clone(),
    };
  }
  const views = [
    { name: 'Sweet spot (row 7)', ...seatView(6) },
    { name: 'Front recliner (row 2)', ...seatView(1) },
    { name: 'Back row (row 10)', ...seatView(9) },
  ];

  // ---- animation hooks ---------------------------------------------------
  const moodColor = new THREE.Color();
  function animate(time) {
    screenMat.uniforms.uTime.value = time;
    const boost = screenMoodColor(time, moodColor);
    screenLight.color.copy(moodColor);
    screenLight.intensity = 95 + 55 * boost;
    for (const b of beams) b.opacity = 0.028 + 0.01 * Math.sin(time * 7.0) * Math.sin(time * 1.3);
  }

  return {
    group, animate, views, lookTarget,
    screen, screenMat,
    stats: { seats: seatTransforms.length },
  };
}

function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
