// 12-channel virtual Dolby-style speaker rig.
//
// A real 12-channel IMAX/Atmos bed is emulated with 12 HRTF-panned virtual
// speakers placed at physical positions inside the theater:
//   Screen wall:  L  C  R  + LFE
//   Sides:        Lss Rss
//   Rear wall:    Lrs Rrs
//   Ceiling:      Ltf Rtf Ltr Rtr  (top front / top rear)
//
// Stereo sources are matrix-upmixed (center sum, phase-derived surrounds,
// low-passed LFE, decorrelated heights). If the stream actually carries
// 5.1, the discrete channels are detected and routed straight to the
// matching speakers instead.

// Positions are metres in the auditorium's own coordinate system (layout.js):
// screen wall just behind z = 0, back wall at z = 38, house half-width 16 m,
// ceiling 29 m at the screen sloping to 20 m at the booth. The screen
// channels sit behind the 29.6 x 23.2 m sheet, as they do on a real GT stage.
const SPEAKERS = [
  { id: 'L',   pos: [-12.0, 14.0, -0.6] },
  { id: 'C',   pos: [  0.0, 13.2, -1.0] },
  { id: 'R',   pos: [ 12.0, 14.0, -0.6] },
  { id: 'LFE', pos: [  0.0,  2.2, -0.6] },
  { id: 'Lss', pos: [-15.4,  9.0, 19.0] },
  { id: 'Rss', pos: [ 15.4,  9.0, 19.0] },
  { id: 'Lrs', pos: [ -8.0, 13.0, 37.0] },
  { id: 'Rrs', pos: [  8.0, 13.0, 37.0] },
  { id: 'Ltf', pos: [ -9.0, 24.0, 13.0] },
  { id: 'Rtf', pos: [  9.0, 24.0, 13.0] },
  { id: 'Ltr', pos: [ -9.0, 20.5, 30.0] },
  { id: 'Rtr', pos: [  9.0, 20.5, 30.0] },
];

export class TheaterAudio {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.ctx = null;
    this.master = null;
    this.speakers = {};      // id -> { panner, gain }
    this._volume = 0.85;
    this._discrete = false;  // true when real 5.1 detected
    this._built = false;
  }

  // Must be called from a user gesture (play button).
  ensureStarted() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _speaker(id) {
    const s = SPEAKERS.find(s => s.id === id);
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    // The GT house is ~40 m deep; keep the far surrounds present rather than
    // letting inverse-square bury them.
    panner.refDistance = 10;
    panner.rolloffFactor = 0.35;
    panner.positionX.value = s.pos[0];
    panner.positionY.value = s.pos[1];
    panner.positionZ.value = s.pos[2];
    const gain = this.ctx.createGain();
    gain.connect(panner);
    panner.connect(this.master);
    this.speakers[id] = { panner, gain };
    return gain;
  }

  _build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this._volume;
    this.master.connect(ctx.destination);

    for (const s of SPEAKERS) this._speaker(s.id);
    const sp = id => this.speakers[id].gain;

    this.source = ctx.createMediaElementSource(this.videoEl);
    this.source.channelCountMode = 'max';
    this.source.channelInterpretation = 'discrete';

    const split = ctx.createChannelSplitter(6);
    this.source.connect(split);

    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const delay = (t) => { const n = ctx.createDelay(0.1); n.delayTime.value = t; return n; };
    const filter = (type, freq, q = 0.7) => {
      const n = ctx.createBiquadFilter();
      n.type = type; n.frequency.value = freq; n.Q.value = q;
      return n;
    };
    const chain = (...nodes) => {
      for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
      return nodes[0];
    };

    // ---- matrix path (stereo sources) --------------------------------
    const mL = g(1), mR = g(1);
    split.connect(mL, 0); split.connect(mR, 1);

    this._matrixNodes = [];
    const mg = (v) => { const n = g(v); n._target = v; this._matrixNodes.push(n); return n; };

    // fronts
    mL.connect(chain(mg(0.9), sp('L')));
    mR.connect(chain(mg(0.9), sp('R')));
    const centerSum = g(0.5);
    mL.connect(centerSum); mR.connect(centerSum);
    centerSum.connect(chain(mg(0.9), sp('C')));

    // LFE — low-passed sum
    const lfeSum = g(0.5);
    mL.connect(lfeSum); mR.connect(lfeSum);
    lfeSum.connect(chain(mg(1.1), filter('lowpass', 110), sp('LFE')));

    // side surrounds — phase-derived difference, delayed and band-limited
    const sideL = g(1), sideR = g(1);
    mL.connect(sideL); mR.connect(chain(g(-0.6), sideL));
    mR.connect(sideR); mL.connect(chain(g(-0.6), sideR));
    sideL.connect(chain(mg(0.5), delay(0.014), filter('highpass', 150), filter('lowpass', 9000), sp('Lss')));
    sideR.connect(chain(mg(0.5), delay(0.016), filter('highpass', 150), filter('lowpass', 9000), sp('Rss')));

    // rear surrounds — deeper delay, quieter
    sideL.connect(chain(mg(0.34), delay(0.027), filter('highpass', 180), filter('lowpass', 7000), sp('Lrs')));
    sideR.connect(chain(mg(0.34), delay(0.030), filter('highpass', 180), filter('lowpass', 7000), sp('Rrs')));

    // heights — airy band, decorrelated per corner
    const airSum = g(0.5);
    mL.connect(airSum); mR.connect(airSum);
    const heights = [['Ltf', 0.005], ['Rtf', 0.009], ['Ltr', 0.013], ['Rtr', 0.017]];
    for (const [id, t] of heights) {
      airSum.connect(chain(mg(0.16), delay(t), filter('highpass', 500), sp(id)));
    }

    // ---- discrete path (true 5.1 sources) ----------------------------
    this._discreteNodes = [];
    const dg = (v) => { const n = g(v); this._discreteNodes.push(n); n.gain.value = 0; n._target = v; return n; };

    split.connect(chain(dg(1.0), sp('L')), 0);
    split.connect(chain(dg(1.0), sp('R')), 1);
    split.connect(chain(dg(1.0), sp('C')), 2);
    split.connect(chain(dg(1.2), sp('LFE')), 3);
    const dSL = g(1), dSR = g(1);
    split.connect(dSL, 4); split.connect(dSR, 5);
    dSL.connect(chain(dg(1.0), sp('Lss')));
    dSR.connect(chain(dg(1.0), sp('Rss')));
    dSL.connect(chain(dg(0.7), delay(0.012), sp('Lrs')));
    dSR.connect(chain(dg(0.7), delay(0.014), sp('Rrs')));
    // heights from discrete surrounds, airy band
    dSL.connect(chain(dg(0.25), delay(0.008), filter('highpass', 500), sp('Ltf')));
    dSR.connect(chain(dg(0.25), delay(0.010), filter('highpass', 500), sp('Rtf')));
    dSL.connect(chain(dg(0.20), delay(0.016), filter('highpass', 500), sp('Ltr')));
    dSR.connect(chain(dg(0.20), delay(0.018), filter('highpass', 500), sp('Rtr')));

    // detector: is there real energy on channels 2-5?
    this._an = [2, 3, 4, 5].map(ch => {
      const a = ctx.createAnalyser();
      a.fftSize = 256;
      split.connect(a, ch);
      return a;
    });
    this._detectBuf = new Float32Array(256);
    this._detectTimer = setInterval(() => this._detect(), 700);
  }

  _detect() {
    if (!this.ctx || this.videoEl.paused) return;
    let energy = 0;
    for (const a of this._an) {
      a.getFloatTimeDomainData(this._detectBuf);
      for (let i = 0; i < this._detectBuf.length; i += 8) energy += Math.abs(this._detectBuf[i]);
    }
    const discrete = energy > 0.5;
    if (discrete !== this._discrete) {
      this._discrete = discrete;
      const t = this.ctx.currentTime;
      for (const n of this._matrixNodes) n.gain.setTargetAtTime(discrete ? 0 : n._target, t, 0.3);
      for (const n of this._discreteNodes) n.gain.setTargetAtTime(discrete ? n._target : 0, t, 0.3);
    }
  }

  get volume() { return this._volume; }
  set volume(v) {
    this._volume = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.05);
  }

  get mode() { return this._discrete ? '5.1 discrete → 12ch' : 'stereo → 12ch upmix'; }

  // Reposition the rig when switching theaters (scale to room size).
  setRoomScale(s) {
    if (!this.ctx) { this._pendingScale = s; return; }
    for (const spk of SPEAKERS) {
      const node = this.speakers[spk.id].panner;
      node.positionX.value = spk.pos[0] * s;
      node.positionY.value = spk.pos[1] * s;
      node.positionZ.value = spk.pos[2] * s;
    }
  }

  // Sync the Web Audio listener with the XR camera every frame.
  updateListener(camera) {
    if (!this.ctx) return;
    if (this._pendingScale) { this.setRoomScale(this._pendingScale); this._pendingScale = null; }
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const t = this.ctx.currentTime;
    const set = (p, v) => { if (p) p.setTargetAtTime(v, t, 0.02); };
    if (l.positionX) {
      set(l.positionX, e[12]); set(l.positionY, e[13]); set(l.positionZ, e[14]);
      set(l.forwardX, -e[8]); set(l.forwardY, -e[9]); set(l.forwardZ, -e[10]);
      set(l.upX, e[4]); set(l.upY, e[5]); set(l.upZ, e[6]);
    } else if (l.setPosition) {
      l.setPosition(e[12], e[13], e[14]);
      l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }
}
