// Small in-VR control panel.
//
// It docks to the left controller like a watch, so it never sits between you
// and the screen. Point the other controller at it and pull the trigger.
// Undocked (desktop, or if no left controller reports in) it floats low
// where you opened it.

import * as THREE from 'three';

const W = 768, H = 460;
const PANEL_W = 0.86;          // metres when floating; scaled down on the wrist

export class VRConsole {
  constructor(scene, actions) {
    this.actions = actions;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W, PANEL_W * H / W),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0.96 })
    );
    this.mesh.material.toneMapped = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
    this.worn = false;

    this.state = {
      playing: false, volume: 0.85, source: 'House reel',
      bounce: 1.0, audioMode: '', time: '',
    };
    this.buttons = [];
    this._layout();
    this.draw();
  }

  _layout() {
    const bw = 168, bh = 74, gx = 18, gy = 16;
    const col = (i) => 26 + i * (bw + gx);
    const row = (j) => 104 + j * (bh + gy);
    const B = (id, label, x, y, w = bw) => this.buttons.push({ id, label, x, y, w, h: bh });

    B('seekBack', '⟲ 30s', col(0), row(0));
    B('play', '▶  Play', col(1), row(0));
    B('seekFwd', '30s ⟳', col(2), row(0));
    B('volDown', 'Vol −', col(3), row(0));

    B('browse', '☰  Nuvio', col(0), row(1));
    B('seat', 'Next Seat', col(1), row(1));
    B('reel', 'House Reel', col(2), row(1));
    B('volUp', 'Vol +', col(3), row(1));

    B('bounceDown', 'Bounce −', col(0), row(2));
    B('bounceUp', 'Bounce +', col(1), row(2));
    B('recenter', 'Recenter', col(2), row(2));
    B('close', '✕  Hide', col(3), row(2));
  }

  draw() {
    const c = this.ctx, s = this.state;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(9,11,17,0.93)';
    round(c, 0, 0, W, H, 22); c.fill();
    c.strokeStyle = 'rgba(116,180,255,0.45)'; c.lineWidth = 2;
    round(c, 1, 1, W - 2, H - 2, 21); c.stroke();

    c.fillStyle = '#74b4ff';
    c.font = '600 26px system-ui, sans-serif';
    c.fillText('IMAX 15/70', 26, 44);
    c.fillStyle = '#8b93a6';
    c.font = '19px system-ui, sans-serif';
    const right = `vol ${Math.round(s.volume * 100)}`;
    c.fillText(right, W - 26 - c.measureText(right).width, 44);

    c.fillStyle = '#e8ecf4';
    c.font = '19px system-ui, sans-serif';
    const line = `${s.source}${s.time ? '   ' + s.time : ''}${s.audioMode ? '   ·   ' + s.audioMode : ''}`;
    c.fillText(line.slice(0, 60), 26, 78);

    for (const b of this.buttons) {
      let label = b.label;
      if (b.id === 'play') label = s.playing ? '❚❚  Pause' : '▶  Play';
      if (b.id === 'bounceUp') label = `Bounce + (${s.bounce.toFixed(1)})`;

      c.fillStyle = b._hot ? 'rgba(116,180,255,0.9)'
        : b._hover ? 'rgba(116,180,255,0.32)' : 'rgba(255,255,255,0.07)';
      round(c, b.x, b.y, b.w, b.h, 13); c.fill();
      c.strokeStyle = b._hover ? 'rgba(116,180,255,0.8)' : 'rgba(255,255,255,0.13)';
      round(c, b.x, b.y, b.w, b.h, 13); c.stroke();
      c.fillStyle = b._hot ? '#08111d' : '#e8ecf4';
      c.font = '600 22px system-ui, sans-serif';
      const tw = c.measureText(label).width;
      c.fillText(label, b.x + (b.w - tw) / 2, b.y + b.h / 2 + 8);
    }
    this.texture.needsUpdate = true;
  }

  toggle(camera) {
    this.mesh.visible = !this.mesh.visible;
    if (this.mesh.visible && !this.worn) this.placeInFront(camera);
  }

  placeInFront(camera) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    const pos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    this.mesh.position.copy(pos).addScaledVector(dir, 1.0);
    this.mesh.position.y = pos.y - 0.32;
    this.mesh.lookAt(pos);
  }

  hitTest(uv) {
    const px = uv.x * W, py = (1 - uv.y) * H;
    return this.buttons.find(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) || null;
  }

  setHover(button) {
    let changed = false;
    for (const b of this.buttons) {
      const want = b === button;
      if (!!b._hover !== want) { b._hover = want; changed = true; }
    }
    if (changed) this.draw();
  }

  press(button) {
    if (!button) return;
    if (button.id === 'close') { this.mesh.visible = false; return; }
    button._hot = true;
    this.draw();
    setTimeout(() => { button._hot = false; this.draw(); }, 140);
    const fn = this.actions[button.id];
    if (fn) fn();
  }
}

function round(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
