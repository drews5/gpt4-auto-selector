// Quad-soup builder. Everything structural in the auditorium is written
// through this so that per-corner ambient occlusion can be baked straight into
// vertex colours — the auditorium renders with no shadow maps, so baked
// contact darkening is what keeps corners, risers and seat wells from going
// flat.
import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

export class Mesher {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
  }

  get triangleCount() { return this.pos.length / 9; }

  // p0..p3 wound counter-clockwise when viewed from the lit side.
  // ao: per-corner multiplier (0..1). tint: rgb multiplier.
  // uvScale: world metres per texture repeat. Mapping is chosen from the
  // dominant face-normal axis so textures tile continuously across the room.
  quad(p0, p1, p2, p3, { ao = [1, 1, 1, 1], tint = [1, 1, 1], uvScale = 1, flip = false } = {}) {
    if (flip) { const t = p1; p1 = p3; p3 = t; const a = ao[1]; ao = [ao[0], ao[3], ao[2], a]; }
    _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    _b.set(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
    _n.crossVectors(_a, _b).normalize();
    const nx = _n.x, ny = _n.y, nz = _n.z;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const uvOf = (p) => {
      if (ay >= ax && ay >= az) return [p[0] / uvScale, p[2] / uvScale];
      if (ax >= az) return [p[2] / uvScale, p[1] / uvScale];
      return [p[0] / uvScale, p[1] / uvScale];
    };
    const push = (p, aoV) => {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nx, ny, nz);
      const t = uvOf(p);
      this.uv.push(t[0], t[1]);
      this.col.push(tint[0] * aoV, tint[1] * aoV, tint[2] * aoV);
    };
    push(p0, ao[0]); push(p1, ao[1]); push(p2, ao[2]);
    push(p0, ao[0]); push(p2, ao[2]); push(p3, ao[3]);
    return this;
  }

  // Axis-aligned box from min/max corners; `faces` selects which sides to emit.
  box(min, max, opts = {}) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const o = opts;
    const skip = o.skip || '';
    const aoTop = o.aoTop || o.ao || [1, 1, 1, 1];
    const aoSide = o.aoSide || o.ao || [1, 1, 1, 1];
    if (!skip.includes('t')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], { ...o, ao: aoTop });
    if (!skip.includes('b')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], { ...o, ao: aoSide });
    if (!skip.includes('n')) this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], { ...o, ao: aoSide });
    if (!skip.includes('f')) this.quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], { ...o, ao: aoSide });
    if (!skip.includes('l')) this.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], { ...o, ao: aoSide });
    if (!skip.includes('r')) this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], { ...o, ao: aoSide });
    return this;
  }

  add(other) {
    this.pos.push(...other.pos); this.nrm.push(...other.nrm);
    this.uv.push(...other.uv); this.col.push(...other.col);
    return this;
  }

  geometry({ weld = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return weld ? weldGeometry(g) : g;
  }
}

// Index a non-indexed geometry by merging identical vertices — roughly halves
// the vertex-shader load on the big merged meshes.
export function weldGeometry(geo, precision = 4) {
  const p = Math.pow(10, precision);
  const attrs = ['position', 'normal', 'uv', 'color'].filter((k) => geo.getAttribute(k));
  const src = attrs.map((k) => geo.getAttribute(k));
  const count = src[0].count;
  const map = new Map();
  const out = attrs.map(() => []);
  const index = [];
  const key = [];
  for (let i = 0; i < count; i++) {
    key.length = 0;
    for (let a = 0; a < src.length; a++) {
      const s = src[a];
      for (let c = 0; c < s.itemSize; c++) key.push(Math.round(s.getComponent(i, c) * p));
    }
    const k = key.join(',');
    let id = map.get(k);
    if (id === undefined) {
      id = out[0].length / src[0].itemSize;
      for (let a = 0; a < src.length; a++) {
        const s = src[a];
        for (let c = 0; c < s.itemSize; c++) out[a].push(s.getComponent(i, c));
      }
      map.set(k, id);
    }
    index.push(id);
  }
  const g = new THREE.BufferGeometry();
  attrs.forEach((k, a) => {
    g.setAttribute(k, new THREE.Float32BufferAttribute(out[a], src[a].itemSize));
  });
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

// Give any geometry a flat white vertex-colour attribute so it can be merged
// with AO-carrying geometry.
export function ensureColor(geo, rgb = [1, 1, 1]) {
  if (geo.getAttribute('color')) return geo;
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = rgb[0]; arr[i * 3 + 1] = rgb[1]; arr[i * 3 + 2] = rgb[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// World-planar UVs from the vertex normal's dominant axis.
export function worldUV(geo, scale = 1) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const uv = geo.attributes.uv || new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, x / scale, z / scale);
    else if (ax >= az) uv.setXY(i, z / scale, y / scale);
    else uv.setXY(i, x / scale, y / scale);
  }
  geo.setAttribute('uv', uv);
  return geo;
}

// A chamfered box in 44 triangles — six inset faces, twelve edge strips and
// eight corner triangles. three's RoundedBoxGeometry costs 300 triangles for
// the same silhouette, which is far too rich to instance four hundred times.
const BEVEL_FACES = [
  { n: [1, 0, 0], t1: [0, 0, -1], t2: [0, 1, 0] },
  { n: [-1, 0, 0], t1: [0, 0, 1], t2: [0, 1, 0] },
  { n: [0, 1, 0], t1: [1, 0, 0], t2: [0, 0, -1] },
  { n: [0, -1, 0], t1: [1, 0, 0], t2: [0, 0, 1] },
  { n: [0, 0, 1], t1: [1, 0, 0], t2: [0, 1, 0] },
  { n: [0, 0, -1], t1: [-1, 0, 0], t2: [0, 1, 0] },
];

export function bevelBox(w, h, d, r = 0.03) {
  const half = [w / 2, h / 2, d / 2];
  r = Math.min(r, Math.min(w, h, d) * 0.45);
  const inset = half.map((v) => v - r);
  const pos = [], nrm = [];

  // Emits a polygon with the winding corrected so its normal faces `want`.
  const poly = (pts, want) => {
    const [a, b, c] = pts;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const list = (cr[0] * want[0] + cr[1] * want[1] + cr[2] * want[2]) < 0 ? pts.slice().reverse() : pts;
    const len = Math.hypot(want[0], want[1], want[2]) || 1;
    const n = [want[0] / len, want[1] / len, want[2] / len];
    for (let i = 1; i < list.length - 1; i++) {
      for (const p of [list[0], list[i], list[i + 1]]) {
        pos.push(p[0], p[1], p[2]);
        nrm.push(n[0], n[1], n[2]);
      }
    }
  };

  // A box corner projected onto the face whose normal axis is `axis`.
  const vert = (s, axis) => {
    const p = [s[0] * inset[0], s[1] * inset[1], s[2] * inset[2]];
    p[axis] = s[axis] * half[axis];
    return p;
  };
  const axisOf = (n) => (n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2);

  for (const f of BEVEL_FACES) {
    const ax = axisOf(f.n);
    const c = f.n.map((v, i) => v * half[i]);
    const e1 = Math.abs(f.t1[0]) * inset[0] + Math.abs(f.t1[1]) * inset[1] + Math.abs(f.t1[2]) * inset[2];
    const e2 = Math.abs(f.t2[0]) * inset[0] + Math.abs(f.t2[1]) * inset[1] + Math.abs(f.t2[2]) * inset[2];
    const at = (s1, s2) => [
      c[0] + f.t1[0] * e1 * s1 + f.t2[0] * e2 * s2,
      c[1] + f.t1[1] * e1 * s1 + f.t2[1] * e2 * s2,
      c[2] + f.t1[2] * e1 * s1 + f.t2[2] * e2 * s2,
    ];
    void ax;
    poly([at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)], f.n);
  }

  // twelve edges: for each pair of axes, the four sign combinations
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 3; b++) {
      const free = 3 - a - b;
      for (const sa of [-1, 1]) {
        for (const sb of [-1, 1]) {
          const mk = (sf, axis) => {
            const s = [0, 0, 0];
            s[a] = sa; s[b] = sb; s[free] = sf;
            return vert(s, axis);
          };
          const want = [0, 0, 0];
          want[a] = sa; want[b] = sb;
          poly([mk(-1, a), mk(1, a), mk(1, b), mk(-1, b)], want);
        }
      }
    }
  }

  // eight corners
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const s = [sx, sy, sz];
        poly([vert(s, 0), vert(s, 1), vert(s, 2)], s);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

export function transform(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  geo.applyMatrix4(m);
  return geo;
}
