// The house: curved 1.43:1 screen in a black cylindrical surround, sixteen
// tiers raked at ~25 degrees, twin stepped aisles with handrails, acoustic
// diffuser fins, surround clusters, and the 15/70 projection booth.
//
// Lighting is dominated by a single RectAreaLight standing in for the screen,
// which is how a real IMAX house actually reads — almost every surface you see
// is lit by the picture. Contact shading is baked into vertex colours because
// there are no shadow maps.
import * as THREE from 'three';
import * as BufferGeometryUtils from '../vendor/BufferGeometryUtils.js';
import { Mesher, ensureColor, weldGeometry, transform } from './mesher.js';
import {
  SPEC, rowY, rowZ, aisleInner, aisleOuter, aisleBoundsAt,
  allSeats, screenZ, screenTop, screenMidY, ceilingY,
} from './layout.js';
import { buildSeatUpholstery, buildSeatShell } from './seat.js';

const S = SPEC.seating;
const R = SPEC.room;
const SC = SPEC.screen;

const LAST = S.rows - 1;
const TIER_HALF = S.rowPitch * 0.5;
const LANDING = 0.46;                          // aisle landing depth at each row
const STEP_RISE = S.rowRise / 2;               // two steps per row: ~26 cm, IMAX-steep
const STEP_TREAD = (S.rowPitch - LANDING) / 2;

// Deterministic per-seat jitter, so the house looks identical on every load.
function seatJitter(i) {
  let t = (i * 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function floorYAt(z) {
  if (z < rowZ(0) - TIER_HALF) return 0;
  if (z > rowZ(LAST) + TIER_HALF) return rowY(LAST);
  const i = Math.round((z - S.firstRowZ) / S.rowPitch);
  return rowY(Math.max(0, Math.min(LAST, i)));
}

// A band of the cylindrical screen surround.
function curvedBand(m, x0, x1, yLo, yHi, segs, opts, zOff = 0) {
  for (let i = 0; i < segs; i++) {
    const xa = x0 + ((x1 - x0) * i) / segs;
    const xb = x0 + ((x1 - x0) * (i + 1)) / segs;
    const za = screenZ(xa) + zOff, zb = screenZ(xb) + zOff;
    const ya0 = typeof yLo === 'function' ? yLo(xa) : yLo;
    const yb0 = typeof yLo === 'function' ? yLo(xb) : yLo;
    const ya1 = typeof yHi === 'function' ? yHi(xa) : yHi;
    const yb1 = typeof yHi === 'function' ? yHi(xb) : yHi;
    m.quad([xa, ya0, za], [xb, yb0, zb], [xb, yb1, zb], [xa, ya1, za], opts);
  }
}

export function buildAuditorium(tex, film) {
  const group = new THREE.Group();
  group.name = 'IMAX_GT_Auditorium';

  // ------------------------------------------------------------ materials --
  const matCarpet = new THREE.MeshStandardMaterial({
    map: tex.carpet, color: 0x474c5e, roughness: 0.97, metalness: 0.0, vertexColors: true,
  });
  const matAcoustic = new THREE.MeshStandardMaterial({
    map: tex.acoustic, color: 0x74767e, roughness: 0.98, metalness: 0.0, vertexColors: true,
  });
  const matStructure = new THREE.MeshStandardMaterial({
    color: 0x171a20, roughness: 0.92, metalness: 0.02, vertexColors: true,
  });
  const matCeiling = new THREE.MeshStandardMaterial({
    map: tex.ceiling, color: 0x6e7078, roughness: 0.95, metalness: 0.0, vertexColors: true,
  });
  const matMetal = new THREE.MeshStandardMaterial({
    map: tex.metal, color: 0x767c88, roughness: 0.42, metalness: 0.82, vertexColors: true,
  });
  const matGrille = new THREE.MeshStandardMaterial({
    map: tex.perfMetal, color: 0x54575e, roughness: 0.84, metalness: 0.12, vertexColors: true,
  });
  const matSeatFabric = new THREE.MeshStandardMaterial({
    map: tex.seatFabric, color: 0x3f4a66, roughness: 0.90, metalness: 0.0, vertexColors: true,
  });
  const matSeatShell = new THREE.MeshStandardMaterial({
    map: tex.shell, color: 0x585b64, roughness: 0.58, metalness: 0.10, vertexColors: true,
  });
  const matLED = new THREE.MeshBasicMaterial({ vertexColors: true });
  matLED.toneMapped = false;
  const matGlow = new THREE.MeshBasicMaterial({
    map: tex.glow, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, vertexColors: true, opacity: 0.85,
  });
  matGlow.toneMapped = false;

  // ------------------------------------------------------------- meshers ---
  const carpet = new Mesher();
  const acoustic = new Mesher();
  const structure = new Mesher();
  const ceiling = new Mesher();
  const metal = new Mesher();
  const grille = new Mesher();
  const led = new Mesher();

  const BLUE = [0.16, 0.42, 1.0];
  const WHITEBLUE = [0.62, 0.78, 1.0];

  // ==========================================================================
  // Screen surround — a black cylinder segment concentric with the screen.
  // ==========================================================================
  const sTop = screenTop();
  const surroundOpts = { uvScale: 2.6, tint: [0.34, 0.35, 0.40] };
  const ceilFront = ceilingY(1.0);
  curvedBand(acoustic, -R.halfWidth, R.halfWidth, 0, SC.bottom, 26, surroundOpts);
  curvedBand(acoustic, -R.halfWidth, R.halfWidth, sTop, ceilFront + 1.0, 26, surroundOpts);
  curvedBand(acoustic, -R.halfWidth, -SC.width / 2, SC.bottom, sTop, 3, surroundOpts);
  curvedBand(acoustic, SC.width / 2, R.halfWidth, SC.bottom, sTop, 3, surroundOpts);

  // Velvet masking frame, standing slightly proud of the surround.
  const maskOpts = { uvScale: 2.6, tint: [0.09, 0.095, 0.11] };   // black velvet masking
  const hw2 = SC.width / 2;
  curvedBand(structure, -hw2 - SC.border, hw2 + SC.border, SC.bottom - SC.border, SC.bottom, 26, maskOpts, -0.06);
  curvedBand(structure, -hw2 - SC.border, hw2 + SC.border, sTop, sTop + SC.border, 26, maskOpts, -0.06);
  curvedBand(structure, -hw2 - SC.border, -hw2, SC.bottom, sTop, 2, maskOpts, -0.06);
  curvedBand(structure, hw2, hw2 + SC.border, SC.bottom, sTop, 2, maskOpts, -0.06);

  // ==========================================================================
  // Side walls: acoustic fabric plus a run of vertical diffuser fins.
  // ==========================================================================
  const wallSegs = 30;
  for (const side of [-1, 1]) {
    const x = side * R.halfWidth;
    for (let i = 0; i < wallSegs; i++) {
      const za = R.frontZ + ((R.backZ - R.frontZ) * i) / wallSegs;
      const zb = R.frontZ + ((R.backZ - R.frontZ) * (i + 1)) / wallSegs;
      const ca = ceilingY(za), cb = ceilingY(zb);
      const p = [
        [x, 0, za], [x, 0, zb], [x, cb, zb], [x, ca, za],
      ];
      acoustic.quad(p[0], p[1], p[2], p[3], {
        uvScale: 2.6, tint: [0.68, 0.70, 0.78], flip: side < 0,
        ao: [0.42, 0.42, 1.0, 1.0],
      });
    }
    // acoustic diffuser fins
    const finDepth = 0.42;
    for (let z = 4.0; z < R.backZ - 2.4; z += 1.22) {
      const base = floorYAt(z) + 0.35;
      const top = ceilingY(z) - 1.6;
      if (top - base < 1.5) continue;
      const xi = x - side * finDepth;
      const zm = z + 0.44;
      // two faces of the wedge, plus a cap
      structure.quad([x, base, z], [xi, base, zm], [xi, top, zm], [x, top, z],
        { uvScale: 1.6, tint: [0.62, 0.64, 0.70], flip: side < 0, ao: [0.55, 0.9, 0.9, 0.62] });
      structure.quad([xi, base, zm], [x, base, z + 0.88], [x, top, z + 0.88], [xi, top, zm],
        { uvScale: 1.6, tint: [0.34, 0.35, 0.41], flip: side < 0, ao: [0.85, 0.5, 0.5, 0.8] });
    }
  }

  // ==========================================================================
  // Back wall with the projection ports, and the ceiling deck.
  // ==========================================================================
  const backY = ceilingY(R.backZ);
  const B = SPEC.booth;
  const portLo = B.portY - B.portH / 2, portHi = B.portY + B.portH / 2;
  const portXs = [[-4.4, -2.6], [-1.5, 1.5], [2.6, 4.4]];
  {
    const o = { uvScale: 2.6, tint: [0.6, 0.62, 0.7], flip: true };
    const z = R.backZ;
    acoustic.quad([-R.halfWidth, 0, z], [R.halfWidth, 0, z], [R.halfWidth, portLo, z], [-R.halfWidth, portLo, z],
      { ...o, ao: [0.5, 0.5, 1, 1] });
    acoustic.quad([-R.halfWidth, portHi, z], [R.halfWidth, portHi, z], [R.halfWidth, backY, z], [-R.halfWidth, backY, z], o);
    // mullions between the ports
    let cursor = -R.halfWidth;
    for (const [a, b] of portXs) {
      acoustic.quad([cursor, portLo, z], [a, portLo, z], [a, portHi, z], [cursor, portHi, z], o);
      cursor = b;
    }
    acoustic.quad([cursor, portLo, z], [R.halfWidth, portLo, z], [R.halfWidth, portHi, z], [cursor, portHi, z], o);
    // booth recess behind the glass, with the port faintly alight
    for (const [a, b] of portXs) {
      structure.box([a, portLo, z], [b, portHi, z + 3.0],
        { uvScale: 1.5, tint: [0.10, 0.11, 0.14], skip: 'f' });
      const inset = 0.10;
      led.quad([a + inset, portLo + inset, z - 0.02], [b - inset, portLo + inset, z - 0.02],
        [b - inset, portHi - inset, z - 0.02], [a + inset, portHi - inset, z - 0.02],
        { uvScale: 1, tint: [0.030, 0.042, 0.072], flip: true });
    }
    // the projector lens itself, dead centre
    led.quad([-0.22, B.portY - 0.22, z - 0.05], [0.22, B.portY - 0.22, z - 0.05],
      [0.22, B.portY + 0.22, z - 0.05], [-0.22, B.portY + 0.22, z - 0.05],
      { uvScale: 1, tint: [0.85, 0.92, 1.0], flip: true });
  }
  {
    // sloping ceiling deck
    const o = { uvScale: 3.2, tint: [0.55, 0.57, 0.64] };
    for (let i = 0; i < wallSegs; i++) {
      const za = R.frontZ + ((R.backZ - R.frontZ) * i) / wallSegs;
      const zb = R.frontZ + ((R.backZ - R.frontZ) * (i + 1)) / wallSegs;
      ceiling.quad([-R.halfWidth, ceilingY(za), za], [R.halfWidth, ceilingY(za), za],
        [R.halfWidth, ceilingY(zb), zb], [-R.halfWidth, ceilingY(zb), zb], o);
    }
    // acoustic baffles hung below the deck
    for (let z = 3.0; z < R.backZ - 2.0; z += 2.6) {
      const y = ceilingY(z) - 0.55;
      for (let x = -R.halfWidth + 1.6; x < R.halfWidth - 1.0; x += 3.4) {
        ceiling.box([x, y, z], [x + 2.4, y + 0.35, z + 1.5],
          { uvScale: 1.6, tint: [0.34, 0.35, 0.40], skip: 't' });
      }
    }
    // lighting catwalk over the front of the house
    for (const z of [4.6, 7.4]) {
      metal.box([-R.halfWidth + 0.6, ceilingY(z) - 1.15, z], [R.halfWidth - 0.6, ceilingY(z) - 1.0, z + 0.22],
        { uvScale: 1.0, tint: [0.30, 0.31, 0.35] });
    }
  }

  // ==========================================================================
  // Floors: front cross aisle, sixteen tiers, stepped aisles, back cross aisle.
  // ==========================================================================
  const frontEdge = rowZ(0) - TIER_HALF;
  {
    // split into depth bands so the wash from the screen falls off with distance
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      const za = R.frontZ + ((frontEdge - R.frontZ) * i) / bands;
      const zb = R.frontZ + ((frontEdge - R.frontZ) * (i + 1)) / bands;
      const aoA = 0.34 + 0.52 * (i / bands);
      const aoB = 0.34 + 0.52 * ((i + 1) / bands);
      carpet.quad([-R.halfWidth, 0, za], [R.halfWidth, 0, za],
        [R.halfWidth, 0, zb], [-R.halfWidth, 0, zb],
        { uvScale: 2.0, tint: [0.85, 0.86, 0.92], ao: [aoA, aoA, aoB, aoB], flip: true });
    }
  }

  for (let i = 0; i < S.rows; i++) {
    const y = rowY(i);
    const z0 = rowZ(i) - TIER_HALF, z1 = rowZ(i) + TIER_HALF;
    const inner = aisleInner(i), outer = aisleOuter(i);
    // x spans: [wall..-outer] [-outer..-inner aisle] [-inner..inner] [inner..outer aisle] [outer..wall]
    const spans = [
      [-R.halfWidth, -outer, true], [-outer, -inner, false], [-inner, inner, true],
      [inner, outer, false], [outer, R.halfWidth, true],
    ];
    for (const [xa, xb, seated] of spans) {
      if (xb - xa < 0.02) continue;
      if (seated) {
        // three depth bands so the seat footprint sits in its own shade
        const bands = [
          [z0, rowZ(i) - 0.42, 0.95, 0.72],
          [rowZ(i) - 0.42, rowZ(i) + 0.40, 0.52, 0.42],
          [rowZ(i) + 0.40, z1, 0.60, 0.86],
        ];
        for (const [za, zb, aoA, aoB] of bands) {
          carpet.quad([xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb], {
            uvScale: 2.0, tint: [0.85, 0.86, 0.92], flip: true,
            ao: [aoA, aoA, aoB, aoB],
          });
        }
      } else {
        // aisle: landing then two steps up to the next tier
        carpet.quad([xa, y, z0], [xb, y, z0], [xb, y, z0 + LANDING], [xa, y, z0 + LANDING],
          { uvScale: 2.0, tint: [0.95, 0.96, 1.0], flip: true, ao: [0.75, 0.75, 0.98, 0.98] });
        if (i === LAST) {
          carpet.quad([xa, y, z0 + LANDING], [xb, y, z0 + LANDING], [xb, y, z1], [xa, y, z1],
            { uvScale: 2.0, tint: [0.95, 0.96, 1.0], flip: true });
          continue;
        }
        for (let s = 0; s < 2; s++) {
          const sz = z0 + LANDING + s * STEP_TREAD;
          const sy = y + (s + 1) * STEP_RISE;
          // riser — the higher tread is uphill, so this face looks downhill
          structure.quad([xa, sy - STEP_RISE, sz], [xb, sy - STEP_RISE, sz], [xb, sy, sz], [xa, sy, sz],
            { uvScale: 1.4, tint: [0.70, 0.72, 0.82], flip: true, ao: [0.45, 0.45, 0.95, 0.95] });
          // tread
          carpet.quad([xa, sy, sz], [xb, sy, sz], [xb, sy, sz + STEP_TREAD], [xa, sy, sz + STEP_TREAD],
            { uvScale: 2.0, tint: [0.95, 0.96, 1.0], flip: true, ao: [0.72, 0.72, 0.98, 0.98] });
          // nosing + step light
          metal.box([xa, sy - 0.015, sz - 0.02], [xb, sy + 0.008, sz + 0.05],
            { uvScale: 0.8, tint: [0.5, 0.52, 0.58] });
          led.quad([xa + 0.06, sy - 0.075, sz - 0.021], [xb - 0.06, sy - 0.075, sz - 0.021],
            [xb - 0.06, sy - 0.025, sz - 0.021], [xa + 0.06, sy - 0.025, sz - 0.021],
            { uvScale: 1, tint: WHITEBLUE });
        }
      }
    }
    // tier riser under the seated spans
    if (i > 0) {
      const yPrev = rowY(i - 1);
      const ab = aisleBoundsAt(i - 0.5);
      const rspans = [
        [-R.halfWidth, -ab.outer], [-ab.inner, ab.inner], [ab.outer, R.halfWidth],
      ];
      for (const [xa, xb] of rspans) {
        if (xb - xa < 0.02) continue;
        structure.quad([xa, yPrev, z0], [xb, yPrev, z0], [xb, y, z0], [xa, y, z0],
          { uvScale: 1.6, tint: [0.62, 0.64, 0.74], flip: true, ao: [0.34, 0.34, 0.92, 0.92] });
        metal.box([xa, y - 0.02, z0 - 0.03], [xb, y + 0.006, z0 + 0.06],
          { uvScale: 0.8, tint: [0.42, 0.44, 0.50] });
        // row marker light washing the tread in front of the seats
        led.quad([xa + 0.1, y - 0.10, z0 - 0.031], [xb - 0.1, y - 0.10, z0 - 0.031],
          [xb - 0.1, y - 0.045, z0 - 0.031], [xa + 0.1, y - 0.045, z0 - 0.031],
          { uvScale: 1, tint: [0.10, 0.26, 0.72] });
      }
    }
  }
  // back cross aisle behind the last row
  {
    const y = rowY(LAST), z0 = rowZ(LAST) + TIER_HALF;
    carpet.quad([-R.halfWidth, y, z0], [R.halfWidth, y, z0], [R.halfWidth, y, R.backZ], [-R.halfWidth, y, R.backZ],
      { uvScale: 2.0, tint: [0.85, 0.86, 0.92], flip: true, ao: [0.95, 0.95, 0.55, 0.55] });
    // rear guard wall so the house reads as enclosed
    structure.box([-R.halfWidth, y, R.backZ - 0.35], [R.halfWidth, y + 1.05, R.backZ],
      { uvScale: 1.8, tint: [0.28, 0.29, 0.34] });
  }

  // ==========================================================================
  // Handrails down both sides of both aisles.
  // ==========================================================================
  const railGeoms = [];
  for (const side of [-1, 1]) {
    for (const edge of ['inner', 'outer']) {
      const pts = [];
      for (let i = 0; i <= LAST; i++) {
        const b = aisleBoundsAt(i);
        const x = side * (edge === 'inner' ? b.inner : b.outer) + side * (edge === 'inner' ? -0.05 : 0.05);
        pts.push(new THREE.Vector3(x, rowY(i) + 0.98, rowZ(i) - TIER_HALF + LANDING * 0.5));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      railGeoms.push(new THREE.TubeGeometry(curve, 30, 0.026, 7, false));
      // stanchions every third row
      for (let i = 0; i <= LAST; i += 3) {
        const p = pts[i];
        const post = new THREE.CylinderGeometry(0.022, 0.022, 0.98, 7);
        railGeoms.push(transform(post, p.x, rowY(i) + 0.49, p.z));
      }
    }
  }

  // ==========================================================================
  // Surround loudspeaker clusters.
  // ==========================================================================
  for (const side of [-1, 1]) {
    for (const z of [7.5, 14.5, 21.5, 27.0]) {
      const y = floorYAt(z) + 5.4;
      const x = side * (R.halfWidth - 0.5);
      grille.box([Math.min(x, x - side * 0.62), y, z], [Math.max(x, x - side * 0.62), y + 1.7, z + 1.25],
        { uvScale: 0.9, tint: [0.55, 0.57, 0.64], ao: [0.7, 0.7, 1, 1] });
    }
  }
  for (const x of [-7.5, -3.0, 3.0, 7.5]) {
    grille.box([x - 0.8, backY - 3.4, R.backZ - 0.75], [x + 0.8, backY - 1.9, R.backZ],
      { uvScale: 0.9, tint: [0.5, 0.52, 0.6] });
  }

  // ==========================================================================
  // Doors and their signage recesses.
  // ==========================================================================
  const doorSpots = [];
  for (const side of [-1, 1]) {
    doorSpots.push({ x: side * (R.halfWidth - 0.03), y: 0, z: 5.4, ry: side < 0 ? Math.PI / 2 : -Math.PI / 2 });
    doorSpots.push({
      x: side * (R.halfWidth - 0.03), y: rowY(LAST), z: rowZ(LAST) + TIER_HALF + 1.4,
      ry: side < 0 ? Math.PI / 2 : -Math.PI / 2,
    });
  }
  for (const d of doorSpots) {
    const inward = d.ry > 0 ? 1 : -1;
    const x0 = Math.min(d.x, d.x + inward * 0.12), x1 = Math.max(d.x, d.x + inward * 0.12);
    structure.box([x0, d.y, d.z - 0.95], [x1, d.y + 2.25, d.z + 0.95],
      { uvScale: 1.2, tint: [0.30, 0.31, 0.36], ao: [0.8, 0.8, 1, 1] });
  }

  // ==========================================================================
  // Cove lighting: a raking line of blue up each side wall.
  // ==========================================================================
  const coveZ0 = 6.5, coveZ1 = rowZ(LAST) + TIER_HALF;
  for (const side of [-1, 1]) {
    const x = side * (R.halfWidth - 0.03);
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const za = coveZ0 + ((coveZ1 - coveZ0) * i) / steps;
      const zb = coveZ0 + ((coveZ1 - coveZ0) * (i + 1)) / steps;
      const ya = floorYAt(za) + 2.35, yb = floorYAt(zb) + 2.35;
      led.quad([x, ya, za], [x, yb, zb], [x, yb + 0.075, zb], [x, ya + 0.075, za],
        { uvScale: 1, tint: BLUE, flip: side < 0 });
    }
    // upper wall wash line
    for (let i = 0; i < steps; i++) {
      const za = coveZ0 + ((coveZ1 - coveZ0) * i) / steps;
      const zb = coveZ0 + ((coveZ1 - coveZ0) * (i + 1)) / steps;
      const ya = ceilingY(za) - 2.2, yb = ceilingY(zb) - 2.2;
      led.quad([x, ya, za], [x, yb, zb], [x, yb + 0.06, zb], [x, ya + 0.06, za],
        { uvScale: 1, tint: [0.07, 0.18, 0.5], flip: side < 0 });
    }
  }

  // ==========================================================================
  // Merge the static shell.
  // ==========================================================================
  const meshes = [];
  const addMesh = (mesher, material, name) => {
    if (mesher.triangleCount === 0) return null;
    const mesh = new THREE.Mesh(mesher.geometry(), material);
    mesh.name = name;
    group.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  addMesh(carpet, matCarpet, 'floors');
  addMesh(acoustic, matAcoustic, 'walls');
  addMesh(structure, matStructure, 'structure');
  addMesh(ceiling, matCeiling, 'ceiling');
  addMesh(grille, matGrille, 'loudspeakers');
  addMesh(led, matLED, 'accent_lighting');
  {
    const railGeo = weldGeometry(BufferGeometryUtils.mergeGeometries(
      railGeoms.map((g) => ensureColor(g.index ? g.toNonIndexed() : g, [0.55, 0.57, 0.62])), false,
    ));
    const rails = new THREE.Mesh(railGeo, matMetal);
    rails.name = 'handrails';
    group.add(rails);
    // fold the nosings into the same material but keep them a separate mesh so
    // the rail tubes stay welded independently
    const nosingMesh = new THREE.Mesh(metal.geometry(), matMetal);
    nosingMesh.name = 'nosings';
    group.add(nosingMesh);
  }

  // ==========================================================================
  // The screen.
  // ==========================================================================
  const screenGeo = new THREE.PlaneGeometry(SC.width, SC.height, 56, 1);
  {
    const pos = screenGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, screenZ(pos.getX(i)));
    screenGeo.computeVertexNormals();
  }
  const screenMat = new THREE.MeshBasicMaterial({ map: film.texture });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(0, screenMidY(), 0);
  screen.name = 'screen';
  group.add(screen);

  // ==========================================================================
  // Seating.
  // ==========================================================================
  const seats = allSeats();
  const upholsteryGeo = buildSeatUpholstery();
  const shellGeo = buildSeatShell();
  const seatMeshes = [];
  const dummy = new THREE.Object3D();
  for (const [geo, mat, name] of [
    [upholsteryGeo, matSeatFabric, 'seats_upholstery'],
    [shellGeo, matSeatShell, 'seats_shell'],
  ]) {
    const im = new THREE.InstancedMesh(geo, mat, seats.length);
    im.name = name;
    const tint = new THREE.Color();
    seats.forEach((s, k) => {
      dummy.position.set(s.x, s.y, s.z);
      // outer seats toe in slightly toward the centre of the screen
      dummy.rotation.set(0, -Math.atan2(s.x, s.z) * 0.30, 0);
      dummy.updateMatrix();
      im.setMatrixAt(k, dummy.matrix);
      // a few percent of variation per seat, so a bank of four hundred does not
      // read as one flat sheet of upholstery
      const v = 0.93 + seatJitter(k) * 0.14;
      tint.setRGB(v, v * (0.985 + seatJitter(k + 977) * 0.03), v);
      im.setColorAt(k, tint);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    group.add(im);
    seatMeshes.push(im);
  }

  // ==========================================================================
  // Signage: row placards, exit signs, house logo.
  // ==========================================================================
  const letterTex = tex.rowLetters;
  {
    const parts = [];
    for (let i = 0; i < S.rows; i++) {
      for (const side of [-1, 1]) {
        const g = new THREE.PlaneGeometry(0.22, 0.22);
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / S.rows);
        transform(g, side * (aisleInner(i) + 0.02), rowY(i) + 0.86, rowZ(i) - TIER_HALF + 0.2,
          0, side < 0 ? -Math.PI / 2 : Math.PI / 2, 0);
        parts.push(g);
      }
    }
    const m = new THREE.MeshBasicMaterial({ map: letterTex, transparent: true, depthWrite: false });
    m.toneMapped = false;
    const mesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(parts, false), m);
    mesh.name = 'row_placards';
    group.add(mesh);
  }
  {
    const parts = [];
    for (const d of doorSpots) {
      const g = new THREE.PlaneGeometry(0.62, 0.31);
      transform(g, d.x + (d.ry > 0 ? 0.16 : -0.16), d.y + 2.45, d.z, 0, d.ry, 0);
      parts.push(g);
    }
    const m = new THREE.MeshBasicMaterial({ map: tex.exit, transparent: true });
    m.toneMapped = false;
    const mesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(parts, false), m);
    mesh.name = 'exit_signs';
    group.add(mesh);
  }
  {
    const parts = [];
    const back = new THREE.PlaneGeometry(6.0, 1.5);
    transform(back, 0, backY - 5.6, R.backZ - 0.06, 0, Math.PI, 0);
    parts.push(back);
    for (const side of [-1, 1]) {
      const g = new THREE.PlaneGeometry(4.4, 1.1);
      transform(g, side * (R.halfWidth - 0.06), ceilingY(4.0) - 3.2, 4.0,
        0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      parts.push(g);
    }
    const m = new THREE.MeshBasicMaterial({ map: tex.logo, transparent: true });
    m.toneMapped = false;
    const mesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(parts, false), m);
    mesh.name = 'house_logo';
    group.add(mesh);
  }

  // ==========================================================================
  // Projector beam — a faint rectangular frustum from the booth port.
  // ==========================================================================
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x3a5da8, transparent: true, opacity: 0.030,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
  });
  beamMat.toneMapped = false;
  {
    const lens = new THREE.Vector3(0, B.portY, R.backZ - 0.35);
    const corners = [
      new THREE.Vector3(-hw2, SC.bottom, screenZ(-hw2)),
      new THREE.Vector3(hw2, SC.bottom, screenZ(hw2)),
      new THREE.Vector3(hw2, sTop, screenZ(hw2)),
      new THREE.Vector3(-hw2, sTop, screenZ(-hw2)),
    ];
    const m = new Mesher();
    const near = corners.map((c) => {
      const d = c.clone().sub(lens).multiplyScalar(0.012).add(lens);
      return [d.x, d.y, d.z];
    });
    const far = corners.map((c) => [c.x, c.y, c.z]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      m.quad(near[i], near[j], far[j], far[i], { uvScale: 4 });
    }
    const beam = new THREE.Mesh(m.geometry({ weld: false }), beamMat);
    beam.name = 'projection_beam';
    beam.renderOrder = 4;
    group.add(beam);
  }

  // ==========================================================================
  // Additive bloom for the coves and the screen spill onto the surround.
  // ==========================================================================
  {
    const m = new Mesher();
    for (const side of [-1, 1]) {
      const x = side * (R.halfWidth - 0.10);
      const steps = 12;
      for (let i = 0; i < steps; i++) {
        const za = coveZ0 + ((coveZ1 - coveZ0) * i) / steps;
        const zb = coveZ0 + ((coveZ1 - coveZ0) * (i + 1)) / steps;
        const ya = floorYAt(za) + 2.38, yb = floorYAt(zb) + 2.38;
        m.quad([x, ya - 0.75, za], [x, yb - 0.75, zb], [x, yb + 0.85, zb], [x, ya + 0.85, za],
          { uvScale: 1, tint: [0.10, 0.26, 0.72], flip: side < 0 });
      }
    }
    const glowMesh = new THREE.Mesh(m.geometry({ weld: false }), matGlow);
    glowMesh.name = 'cove_bloom';
    glowMesh.renderOrder = 5;
    group.add(glowMesh);
  }

  // ==========================================================================
  // Lighting.
  // ==========================================================================
  const screenLight = new THREE.RectAreaLight(0xffffff, 6.0, SC.width * 0.96, SC.height * 0.96);
  screenLight.position.set(0, screenMidY(), 0.55);
  screenLight.lookAt(0, screenMidY(), 12);
  group.add(screenLight);

  // Stands in for everything the picture bounces off: floor, walls, other
  // seats. Without it the seat backs — which face away from the screen — go
  // completely black, since there are no shadow maps or global illumination.
  const hemi = new THREE.HemisphereLight(0x3d5a8c, 0x141008, 0.9);
  group.add(hemi);

  const bounceLights = [];
  for (const z of [13.0, 20.0, 27.0]) {
    const l = new THREE.PointLight(0xffffff, 6.0, 26, 1.6);
    l.position.set(0, ceilingY(z) - 2.4, z);
    group.add(l);
    bounceLights.push(l);
  }

  const coveLights = [];
  for (const side of [-1, 1]) {
    for (const z of [11.0, 17.0, 23.0]) {
      const l = new THREE.PointLight(0x3a6cff, 9.0, 15, 2.0);
      l.position.set(side * (R.halfWidth - 1.2), floorYAt(z) + 2.7, z);
      group.add(l);
      coveLights.push(l);
    }
  }

  // ==========================================================================
  // Animation hook: the house is lit by whatever is on the screen.
  // ==========================================================================
  const tmpColor = new THREE.Color();
  const NEUTRAL = new THREE.Color(1, 1, 1);
  function update() {
    const level = film.averageLevel;
    screenLight.color.copy(film.averageColor).lerp(NEUTRAL, 0.22);
    screenLight.intensity = 1.6 + level * 17.0;
    // bounce light keeps the picture's hue but much less of its saturation
    tmpColor.copy(film.averageColor).lerp(NEUTRAL, 0.60);
    hemi.color.copy(tmpColor);
    hemi.intensity = 0.06 + level * 0.22;
    for (const l of bounceLights) {
      l.color.copy(tmpColor);
      l.intensity = 0.4 + level * 2.3;
    }
    beamMat.opacity = 0.014 + level * 0.05;
  }
  update();

  const triangles = group.children.reduce((n, o) => {
    if (!o.geometry) return n;
    const g = o.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    return n + tris * (o.isInstancedMesh ? o.count : 1);
  }, 0);

  return {
    group,
    screen,
    screenMaterial: screenMat,
    seatMeshes,
    update,
    stats: { seats: seats.length, triangles: Math.round(triangles), drawCalls: group.children.filter((c) => c.isMesh).length },
  };
}
