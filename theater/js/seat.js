// Plush reclining theater seat, built from rounded boxes and merged into a
// single vertex-colored geometry (one draw call for every seat via instancing).
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from '../vendor/BufferGeometryUtils.js';

function colored(geo, hex) {
  const color = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function xf(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(m);
  return geo;
}

// Seat faces -Z. Origin at floor center of the seat footprint.
export function buildSeatGeometry() {
  const parts = [];
  const leather = 0x2b303d;      // dark slate-blue leather
  const leatherDark = 0x22262f;
  const plinth = 0x131419;
  const recline = 0.24;          // backrest recline (radians)

  // pedestal base
  parts.push(colored(xf(new RoundedBoxGeometry(0.62, 0.30, 0.72, 2, 0.04), 0, 0.15, 0.04), plinth));

  // seat cushion — slightly tilted back, fat and soft
  parts.push(colored(xf(new RoundedBoxGeometry(0.60, 0.26, 0.62, 3, 0.12), 0, 0.44, -0.02, -0.06), leather));

  // footrest lip at the front
  parts.push(colored(xf(new RoundedBoxGeometry(0.56, 0.16, 0.18, 2, 0.07), 0, 0.34, -0.36, 0.5), leatherDark));

  // backrest — two stacked pillows for a plush look
  parts.push(colored(xf(new RoundedBoxGeometry(0.64, 0.52, 0.28, 3, 0.13), 0, 0.72, 0.30 + 0.10, -recline), leather));
  parts.push(colored(xf(new RoundedBoxGeometry(0.60, 0.34, 0.26, 3, 0.12), 0, 1.02, 0.38 + 0.10, -recline - 0.05), leather));

  // headrest pillow
  parts.push(colored(xf(new RoundedBoxGeometry(0.52, 0.26, 0.22, 3, 0.11), 0, 1.24, 0.44 + 0.10, -recline - 0.12), leatherDark));

  // armrests
  for (const s of [-1, 1]) {
    parts.push(colored(xf(new RoundedBoxGeometry(0.15, 0.30, 0.70, 2, 0.06), s * 0.395, 0.55, 0.08), leatherDark));
    // cupholder ring on top-front of armrest
    const ring = new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12, 1, false);
    parts.push(colored(xf(ring, s * 0.395, 0.705, -0.16), 0x0c0d10));
  }

  const merged = BufferGeometryUtils.mergeGeometries(
    parts.map((p) => (p.index ? p.toNonIndexed() : p)), false,
  );
  merged.computeVertexNormals();
  return merged;
}

// Tiny wedge tray-table used on the premium (front) rows.
export function buildTrayGeometry() {
  const g = colored(new RoundedBoxGeometry(0.34, 0.03, 0.30, 2, 0.015), 0x1a1c24);
  xf(g, 0, 0.72, -0.30);
  g.computeVertexNormals();
  return g;
}
