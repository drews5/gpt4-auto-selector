// Dimensions of a 15/70 IMAX GT auditorium, in metres.
//
// Proportioned after real GT houses (AMC Lincoln Square, BFI IMAX, Melbourne,
// Cinesphere): a ~1.43:1 screen filling the entire front wall, a very short
// throw to the front row, and stadium seating raked at ~25 degrees so the
// screen overfills every seat's field of view.

export const SPEC = {
  screen: {
    // AMC Lincoln Square: 97 ft x 76 ft — the largest 15/70 screen in the US.
    // Note this is 1.276:1, taller than the 1.43:1 film frame; the physical
    // sheet is what's modelled here and the picture fills all of it.
    width: 29.566,        // 97 ft
    height: 23.165,       // 76 ft
    bottom: 1.60,         // sill height above the front-row floor
    curveRadius: 62.0,    // GT screens are only slightly curved
    border: 0.65,         // black masking frame
  },
  room: {
    halfWidth: 16.0,      // screen leaves ~1.2 m of wall each side
    frontZ: -2.8,         // wall behind the screen (speaker chamber)
    backZ: 38.0,
    heightFront: 29.0,    // ceiling slopes down toward the booth
    heightBack: 20.0,
  },
  seating: {
    rows: 20,
    firstRowZ: 11.0,      // ~0.47 screen heights: IMAX short throw
    rowPitch: 1.14,
    rowRise: 0.53,        // atan(0.53/1.14) = 24.9 deg rake
    seatPitch: 0.62,
    halfWidth0: 8.0,      // seating block fans out toward the back
    halfWidthGrow: 0.34,
    aisleFrac: 0.40,      // inner edge of each aisle, as a fraction of halfWidth
    aisleWidth: 1.34,
  },
  booth: {
    z: 38.0,
    portY: 15.5,
    portW: 3.4,
    portH: 2.4,
  },
};

// Physical aspect of the screen sheet, used by the projection buffer.
export const SCREEN_ASPECT = SPEC.screen.width / SPEC.screen.height;

const S = SPEC.seating;

export const rowY = (i) => i * S.rowRise;
export const rowZ = (i) => S.firstRowZ + i * S.rowPitch;
export const rowHalfWidth = (i) => S.halfWidth0 + i * S.halfWidthGrow;
export const aisleInner = (i) => rowHalfWidth(i) * S.aisleFrac;
export const aisleOuter = (i) => aisleInner(i) + S.aisleWidth;

// Continuous versions, so stair treads between two rows can be interpolated.
export function aisleBoundsAt(rowFloat) {
  const i = Math.max(0, Math.min(S.rows - 1, rowFloat));
  const hw = S.halfWidth0 + i * S.halfWidthGrow;
  const inner = hw * S.aisleFrac;
  return { inner, outer: inner + S.aisleWidth, halfWidth: hw };
}

// Seat centre positions for a row, skipping the two aisles.
export function rowSeatXs(i) {
  const hw = rowHalfWidth(i);
  const inner = aisleInner(i);
  const outer = aisleOuter(i);
  const n = Math.floor((2 * hw) / S.seatPitch);
  const start = -((n - 1) / 2) * S.seatPitch;
  const xs = [];
  for (let k = 0; k < n; k++) {
    const x = start + k * S.seatPitch;
    const a = Math.abs(x);
    if (a + S.seatPitch * 0.5 > inner && a - S.seatPitch * 0.5 < outer) continue;
    xs.push(x);
  }
  return xs;
}

export function allSeats() {
  const out = [];
  for (let i = 0; i < S.rows; i++) {
    const xs = rowSeatXs(i);
    const y = rowY(i), z = rowZ(i);
    xs.forEach((x, k) => out.push({ row: i, index: k, x, y, z }));
  }
  return out;
}

// Ray/seat picking: intersect the ray with each tier plane and snap to the
// nearest seat. Cheap enough to run every frame for a VR pointer.
export function pickSeat(originX, originY, originZ, dirX, dirY, dirZ) {
  let best = null;
  for (let i = 0; i < S.rows; i++) {
    if (Math.abs(dirY) < 1e-6) continue;
    const t = (rowY(i) - originY) / dirY;
    if (t <= 0.1) continue;
    const z = originZ + dirZ * t;
    const zc = rowZ(i);
    if (Math.abs(z - zc) > S.rowPitch * 0.62) continue;
    const x = originX + dirX * t;
    const xs = rowSeatXs(i);
    let bi = -1, bd = Infinity;
    for (let k = 0; k < xs.length; k++) {
      const d = Math.abs(xs[k] - x);
      if (d < bd) { bd = d; bi = k; }
    }
    if (bi < 0 || bd > S.seatPitch * 0.62) continue;
    if (!best || t < best.t) {
      best = { t, row: i, index: bi, x: xs[bi], y: rowY(i), z: zc };
    }
  }
  return best;
}

// Screen surface z at a given x (concave toward the audience).
export function screenZ(x) {
  const R = SPEC.screen.curveRadius;
  return R - Math.sqrt(Math.max(R * R - x * x, 0));
}

export const screenTop = () => SPEC.screen.bottom + SPEC.screen.height;
export const screenMidY = () => SPEC.screen.bottom + SPEC.screen.height * 0.5;

// Ceiling height at a depth z.
export function ceilingY(z) {
  const r = SPEC.room;
  const t = (z - r.frontZ) / (r.backZ - r.frontZ);
  return r.heightFront + (r.heightBack - r.heightFront) * Math.max(0, Math.min(1, t));
}
