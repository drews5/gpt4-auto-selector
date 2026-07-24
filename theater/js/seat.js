// A fixed high-back cinema seat of the kind installed in 15/70 GT houses:
// upholstered pan and back, moulded shell rear, slim shared armrests with
// recessed cupholders, twin pedestal legs.
//
// Split into two geometries — upholstery and shell — so the whole auditorium's
// seating is two instanced draw calls with two distinct materials.
import * as THREE from 'three';
import * as BufferGeometryUtils from '../vendor/BufferGeometryUtils.js';
import { weldGeometry, ensureColor, worldUV, transform, bevelBox } from './mesher.js';

const RECLINE = 0.20;   // backrest lean, radians

const rbox = (w, h, d, r = 0.045) => bevelBox(w, h, d, r);

function nonIndexed(g) { return g.index ? g.toNonIndexed() : g; }

// Bakes a contact-darkening term into vertex colours: seats sit in their own
// small pool of shade, which is what keeps them from reading as floating boxes
// under a shadowless lighting model.
function bakeAO(geo, fn) {
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const k = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return geo;
}

const seatAO = (x, y, z) => {
  let k = 1;
  k *= 0.24 + 0.76 * Math.min(1, Math.max(0, (y - 0.02) / 0.92));   // rises out of the floor shade
  if (Math.abs(x) > 0.22 && y > 0.46 && y < 0.88) k *= 0.72;         // shaded between the armrests
  if (z > 0.26) k *= 0.80;                                           // rear of the shell
  if (y < 0.42) k *= 0.66;                                           // pedestal and leg well
  return k;
};

function build(parts) {
  const geo = BufferGeometryUtils.mergeGeometries(parts.map(nonIndexed), false);
  parts.forEach((p) => p.dispose && p.dispose());
  geo.computeVertexNormals();
  worldUV(geo, 0.5);
  ensureColor(geo);
  bakeAO(geo, seatAO);
  return weldGeometry(geo);
}

// Upholstered surfaces: pan, back cushion, headrest.
export function buildSeatUpholstery() {
  const parts = [];
  // seat pan, tipped back a few degrees
  parts.push(transform(rbox(0.54, 0.14, 0.52, 0.055), 0, 0.475, -0.04, -0.09));
  // back cushion, proud of the shell
  parts.push(transform(rbox(0.50, 0.66, 0.13, 0.055), 0, 0.90, 0.16, -RECLINE));
  // headrest
  parts.push(transform(rbox(0.44, 0.22, 0.14, 0.06), 0, 1.27, 0.075, -RECLINE));
  return build(parts);
}

// Everything hard: rear shell, armrests, legs, cupholders.
export function buildSeatShell() {
  const parts = [];
  // moulded back shell — the surface the row behind actually looks at
  parts.push(transform(rbox(0.58, 0.94, 0.10, 0.05), 0, 0.94, 0.245, -RECLINE));
  // shoulder cap tying the headrest into the shell
  parts.push(transform(rbox(0.50, 0.14, 0.12, 0.05), 0, 1.385, 0.055, -RECLINE));

  for (const s of [-1, 1]) {
    // armrest top
    parts.push(transform(rbox(0.085, 0.070, 0.54, 0.032), s * 0.293, 0.665, -0.02));
    // armrest support down to the pan frame
    parts.push(transform(new THREE.BoxGeometry(0.05, 0.24, 0.10), s * 0.293, 0.545, 0.16));
    // pedestal leg
    parts.push(transform(new THREE.BoxGeometry(0.07, 0.42, 0.09), s * 0.22, 0.21, 0.04));
    // cupholder: recessed ring in the front of the armrest
    const ring = new THREE.CylinderGeometry(0.043, 0.043, 0.035, 10, 1, true);
    parts.push(transform(ring, s * 0.293, 0.685, -0.20));
    const base = new THREE.CircleGeometry(0.043, 10);
    base.rotateX(-Math.PI / 2);
    parts.push(transform(base, s * 0.293, 0.668, -0.20));
  }
  // frame rail under the pan
  parts.push(transform(new THREE.BoxGeometry(0.50, 0.06, 0.34), 0, 0.40, 0.02));
  return build(parts);
}
