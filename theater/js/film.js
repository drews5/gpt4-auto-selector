// What's running on the screen.
//
// The picture is rendered into an off-screen HDR buffer at exactly 24 fps —
// authentic film cadence, and it decouples the cost of the (fairly heavy)
// picture shader from how much of the headset's view the screen fills. Two
// reels cross-dissolve: an orbital Earth pass and a deep-field nebula, both
// finished with gate weave, grain and dust the way a 15/70 print would be.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uWeave;
uniform float uFrame;
uniform float uAspect;

float h11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float h31(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(mix(h31(i + vec3(0,0,0)), h31(i + vec3(1,0,0)), f.x),
                    mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
                mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x),
                    mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
  return a;
}

float fbm4(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise3(p); p *= 2.03; a *= 0.5; }
  return s;
}
float fbm2o(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 2; i++) { s += a * noise3(p); p *= 2.11; a *= 0.5; }
  return s;
}

mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1,0,0, 0,c,-s, 0,s,c); }

vec3 starField(vec3 rd, float density){
  vec3 col = vec3(0.0);
  vec3 p = rd * 220.0;
  vec3 i = floor(p);
  for (int k = 0; k < 2; k++) {
    vec3 o = vec3(float(k) * 37.0);
    float r = h31(i + o);
    if (r > density) {
      vec3 c = i + o + vec3(h31(i + o + 1.0), h31(i + o + 2.0), h31(i + o + 3.0));
      float d = length(p - c);
      float b = pow(max(1.0 - d * 0.85, 0.0), 8.0) * (0.35 + r * 1.4);
      vec3 tint = mix(vec3(0.7, 0.82, 1.0), vec3(1.0, 0.86, 0.66), h31(i + o + 7.0));
      col += tint * b;
    }
  }
  return col;
}

// ---- reel one: low Earth orbit -------------------------------------------
vec3 reelEarth(vec2 uv, float t){
  vec3 rd = normalize(vec3(uv.x * uAspect, uv.y, 1.55));
  // slow camera drift so the frame never sits still
  rd = rotY(sin(t * 0.045) * 0.09) * rotX(cos(t * 0.037) * 0.05) * rd;
  // camera rides above the planet, so the limb cuts across the middle of the
  // frame and the Earth fills the bottom two thirds
  vec3 ro = vec3(0.0, 0.62, -1.95);

  // sun sits behind and above the camera, so the visible hemisphere is lit
  float sa = -1.95 + t * 0.028;
  vec3 sun = normalize(vec3(cos(sa) * 0.90, 0.36, sin(sa) * 0.90));

  vec3 col = starField(rd, 0.9965) * 0.9;

  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float disc = b * b - c;

  // atmospheric shell glow outside the limb
  float perp = sqrt(max(dot(ro, ro) - b * b, 0.0));
  float rim = exp(-max(perp - 1.0, 0.0) * 26.0) * step(1.0, perp);
  float sunFace = clamp(dot(normalize(-ro), sun) * 0.5 + 0.72, 0.0, 1.0);
  col += vec3(0.16, 0.42, 1.0) * rim * sunFace * 1.5;

  if (disc > 0.0) {
    float d = -b - sqrt(disc);
    vec3 pos = ro + rd * d;
    vec3 n = normalize(pos);
    vec3 sp = rotY(t * 0.017) * n;

    float land = fbm4(sp * 2.15);
    float h = land - 0.505;
    vec3 ocean = mix(vec3(0.004, 0.020, 0.070), vec3(0.010, 0.055, 0.135),
                     smoothstep(-0.12, 0.0, h));
    float detail = fbm2o(sp * 7.0);
    vec3 ground = mix(vec3(0.055, 0.070, 0.030), vec3(0.150, 0.120, 0.062), detail);
    ground = mix(ground, vec3(0.030, 0.070, 0.024), smoothstep(0.01, 0.10, h) * 0.7);
    vec3 surf = mix(ocean, ground, smoothstep(-0.005, 0.020, h));

    float lat = abs(sp.y);
    surf = mix(surf, vec3(0.72, 0.77, 0.84), smoothstep(0.80, 0.94, lat));

    float cl = fbm4(sp * 3.1 + vec3(t * 0.006, 0.0, 0.0));
    cl = smoothstep(0.47, 0.70, cl) * 0.92;
    surf = mix(surf, vec3(0.88, 0.91, 0.95), cl);

    float ndl = dot(n, sun);
    float day = max(ndl, 0.0);
    vec3 lit = surf * (day * 1.45 + 0.012);

    // warm scatter right at the terminator
    lit += vec3(0.55, 0.24, 0.09) * exp(-abs(ndl) * 22.0) * 0.55;

    // city lights on the night side, land only, punching through cloud gaps
    float night = smoothstep(0.07, -0.14, ndl);
    float cities = smoothstep(0.70, 0.88, fbm2o(sp * 78.0)) * smoothstep(0.0, 0.03, h);
    lit += vec3(1.0, 0.74, 0.40) * cities * night * (1.0 - cl) * 0.65;

    // limb haze
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.2);
    lit += vec3(0.22, 0.48, 1.0) * fres * max(ndl + 0.30, 0.0) * 1.15;

    col = lit;
  }
  return col;
}

// ---- reel two: deep field -------------------------------------------------
vec3 reelNebula(vec2 uv, float t){
  vec3 rd = normalize(vec3(uv.x * uAspect, uv.y, 1.3));
  rd = rotY(t * 0.012) * rd;
  vec3 col = starField(rd, 0.9945) * 1.15;

  vec3 p = rd * 2.4 + vec3(0.0, 0.0, t * 0.045);
  float a = fbm4(p * 1.35);
  float b = fbm4(p * 2.6 + vec3(11.3, 4.2, 7.1));
  float dust = fbm2o(p * 5.1 + vec3(3.0));

  vec3 warm = vec3(0.42, 0.10, 0.22) * pow(a, 2.6) * 2.4;
  vec3 cool = vec3(0.06, 0.20, 0.52) * pow(b, 2.3) * 2.0;
  vec3 core = vec3(0.85, 0.55, 0.35) * pow(max(a * b, 0.0), 3.4) * 3.2;
  col += warm + cool + core;
  col *= 1.0 - dust * 0.55;
  return col;
}

void main() {
  // gate weave: the frame never registers perfectly in the projector gate
  vec2 uv = (vUv - 0.5) * 2.0 + uWeave;
  // and the print breathes a little in and out of the aperture
  uv *= 1.0 + sin(uTime * 0.9) * 0.0015;

  float cycle = 26.0;
  float phase = uTime / cycle;
  float reel = floor(phase);
  float f = fract(phase);
  float mixAmt = smoothstep(0.0, 0.055, f) * (1.0 - smoothstep(0.945, 1.0, f));
  float which = mod(reel, 2.0);

  vec3 col;
  if (mixAmt > 0.999) {
    col = which < 0.5 ? reelEarth(uv, uTime) : reelNebula(uv, uTime);
  } else {
    vec3 aC = which < 0.5 ? reelEarth(uv, uTime) : reelNebula(uv, uTime);
    vec3 bC = which < 0.5 ? reelNebula(uv, uTime) : reelEarth(uv, uTime);
    col = mix(bC, aC, mixAmt);
  }

  // 15/70 has almost no visible falloff, but the aperture still shades a touch
  float r = length((vUv - 0.5) * vec2(1.9, 1.0));
  col *= 1.0 - smoothstep(0.55, 1.30, r) * 0.22;

  // grain: fine, and it swims because it is a new frame of emulsion each time
  float g = h21(vUv * vec2(2600.0, 1820.0) + uFrame * 17.31);
  col += (g - 0.5) * 0.030 * (0.35 + 0.65 * smoothstep(0.0, 0.30, dot(col, vec3(0.33))));

  // occasional dust and a rare hair in the gate
  float dust = h21(floor(vUv * 260.0) + uFrame * 3.77);
  if (dust > 0.99965) col += vec3(0.7);

  gl_FragColor = vec4(max(col, 0.0) * 2.1, 1.0);
}
`;

export class Film {
  constructor(renderer, width = 1536, aspect = 1.43) {
    this.renderer = renderer;
    const height = Math.round(width / aspect);
    this.target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.uniforms = {
      uTime: { value: 0 },
      uWeave: { value: new THREE.Vector2() },
      uFrame: { value: 0 },
      uAspect: { value: aspect },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.material.toneMapped = false;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.time = 0;
    this.frame = 0;
    this._acc = 0;
    this._interval = 1 / 24;
    this.averageColor = new THREE.Color(0.2, 0.3, 0.55);
    this.averageLevel = 0.35;
    this.running = true;
  }

  get texture() { return this.target.texture; }

  // Advance the projector. Returns true when a new frame was actually struck.
  update(dt) {
    if (!this.running) return false;
    this._acc += Math.min(dt, 0.25);
    if (this._acc < this._interval) return false;
    this._acc -= this._interval;
    this.time += this._interval;
    this.frame += 1;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uFrame.value = this.frame;
    this.uniforms.uWeave.value.set(
      (Math.random() - 0.5) * 0.0022,
      (Math.random() - 0.5) * 0.0030,
    );
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
    this._updateAverage();
    return true;
  }

  // Approximates the mean colour of the frame so the house can be lit by the
  // picture. Mirrors the shader's reel logic rather than reading pixels back,
  // which would stall the GPU every frame in XR.
  _updateAverage() {
    const t = this.time;
    const cycle = 26.0;
    const phase = t / cycle;
    const f = phase - Math.floor(phase);
    const mixAmt = smoothstep(0, 0.055, f) * (1 - smoothstep(0.945, 1, f));
    const which = Math.floor(phase) % 2;

    // Earth reel: brightness tracks how much of the lit hemisphere faces us.
    const sa = -1.95 + t * 0.028;
    const facing = -Math.sin(sa) * 0.42 + 0.68;
    const earth = {
      r: 0.090 + 0.150 * facing,
      g: 0.140 + 0.235 * facing,
      b: 0.225 + 0.390 * facing,
    };
    const nebula = { r: 0.150, g: 0.098, b: 0.180 };

    const a = which === 0 ? earth : nebula;
    const b = which === 0 ? nebula : earth;
    const k = mixAmt;
    const r = b.r + (a.r - b.r) * k;
    const g = b.g + (a.g - b.g) * k;
    const bl = b.b + (a.b - b.b) * k;
    const level = (r + g + bl) / 3;
    this.averageColor.setRGB(r / level, g / level, bl / level);
    this.averageLevel = level;
  }
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
