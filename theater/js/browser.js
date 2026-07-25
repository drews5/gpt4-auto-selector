// In-VR Nuvio content browser — a controller-navigable panel with a ray
// keyboard, poster search results, episode picker and stream list.
// This is the primary way to start a film: it opens automatically when you
// enter VR without a source loaded.

import * as THREE from 'three';
import * as nuvio from './nuvio.js';

const W = 1024, H = 832;
const PANEL_W = 1.45; // meters

const GOLD = '#74b4ff';
const TEXT = '#e8ecf4';
const DIM = '#8b93a6';

const KEY_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', '\''],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '-'],
];

export class VRBrowser {
  constructor(scene, { onPlayUrl }) {
    this.onPlayUrl = onPlayUrl;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W, PANEL_W * H / W),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0.97 })
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 11;
    scene.add(this.mesh);

    this.view = 'search';       // search | episodes | streams
    this.query = '';
    this.results = [];
    this.meta = null;           // selected title
    this.seasonEntries = [];    // flattened episode list
    this.streamList = [];
    this.scroll = { search: 0, episodes: 0, streams: 0 };
    this.notice = 'Search for a movie or show.';
    this.busy = false;
    this.buttons = [];
    this._images = new Map();   // poster url -> HTMLImageElement|'failed'
    this.draw();
  }

  toggle(camera) {
    this.mesh.visible = !this.mesh.visible;
    if (this.mesh.visible) this.placeInFront(camera);
  }

  placeInFront(camera) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    const pos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    this.mesh.position.copy(pos).addScaledVector(dir, 1.5);
    this.mesh.position.y = pos.y - 0.05;
    this.mesh.lookAt(pos);
  }

  // ---------------------------------------------------------------- data

  async doSearch() {
    if (!this.query.trim() || this.busy) return;
    this.busy = true;
    this.results = [];
    this.notice = `Searching “${this.query}”…`;
    this.draw();
    try {
      this.results = await nuvio.search(this.query);
      this.notice = this.results.length ? '' : 'No results.';
      for (const m of this.results) this._loadPoster(m.poster);
    } catch (err) {
      this.notice = `Search failed: ${err.message}`;
    }
    this.busy = false;
    this.scroll.search = 0;
    this.draw();
  }

  async pick(meta) {
    this.meta = meta;
    if (meta.type === 'movie') {
      this.view = 'streams';
      return this._fetchStreams('movie', meta.id, meta.name);
    }
    this.view = 'episodes';
    this.seasonEntries = [];
    this.notice = 'Loading episodes…';
    this.busy = true;
    this.draw();
    try {
      const seasons = await nuvio.episodes(meta.id);
      for (const [season, eps] of [...seasons.entries()].sort((a, b) => a[0] - b[0])) {
        for (const ep of eps) this.seasonEntries.push({ season, ...ep });
      }
      this.notice = this.seasonEntries.length ? '' : 'No episodes listed.';
    } catch (err) {
      this.notice = `Episodes failed: ${err.message}`;
    }
    this.busy = false;
    this.scroll.episodes = 0;
    this.draw();
  }

  async _fetchStreams(type, id, label) {
    this.streamList = [];
    this.streamLabelText = label;
    this.notice = 'Fetching streams from your sources…';
    this.busy = true;
    this.view = 'streams';
    this.scroll.streams = 0;
    this.draw();
    try {
      const { streams, errors } = await nuvio.streams(type, id, (partial) => {
        this.streamList = partial;
        this.notice = '';
        this.draw();
      });
      this.streamList = streams;
      this.notice = streams.length ? '' : (errors[0] || 'No playable streams from your sources.');
    } catch (err) {
      this.notice = `Stream lookup failed: ${err.message}`;
    }
    this.busy = false;
    this.draw();
  }

  _loadPoster(url) {
    if (!url || this._images.has(url)) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { this._images.set(url, img); this.draw(); };
    img.onerror = () => this._images.set(url, 'failed');
    img.src = url;
    this._images.set(url, 'loading');
  }

  // ------------------------------------------------------------- drawing

  draw() {
    const c = this.ctx;
    this.buttons = [];
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(9,11,17,0.93)';
    round(c, 0, 0, W, H, 30); c.fill();
    c.strokeStyle = 'rgba(116,180,255,0.45)'; c.lineWidth = 2;
    round(c, 1, 1, W - 2, H - 2, 29); c.stroke();

    // header
    c.fillStyle = GOLD;
    c.font = '600 36px system-ui, sans-serif';
    c.fillText('NUVIO', 36, 62);
    c.fillStyle = DIM;
    c.font = '26px system-ui, sans-serif';
    const crumbs = this.view === 'search' ? 'Search'
      : this.view === 'episodes' ? `${this.meta.name}`
      : `${this.streamLabelText || ''}`;
    c.fillText(crumbs.slice(0, 40), 210, 62);

    this._btn('close', '✕', W - 80, 20, 58, 58);
    if (this.view !== 'search') this._btn('back', '‹ Back', W - 260, 20, 160, 58);

    if (this.view === 'search') this._drawSearch();
    else if (this.view === 'episodes') this._drawList(this.seasonEntries, this.scroll.episodes, 96,
      (e) => `S${String(e.season).padStart(2, '0')}E${String(e.episode).padStart(2, '0')}  ${e.name || ''}`,
      'ep');
    else this._drawList(this.streamList, this.scroll.streams, 96,
      (s) => `▶ ${nuvio.streamLabel(s)}`, 'stream', (s) => s.addon);

    if (this.notice) {
      c.fillStyle = DIM;
      c.font = '26px system-ui, sans-serif';
      c.fillText(this.notice.slice(0, 70), 36, H - 28);
    }
    this.texture.needsUpdate = true;
  }

  _btn(id, label, x, y, w, h, opts = {}) {
    const c = this.ctx;
    const b = { id, label, x, y, w, h, ...opts };
    this.buttons.push(b);
    c.fillStyle = b._hover ? 'rgba(116,180,255,0.85)' : (opts.accent ? 'rgba(116,180,255,0.2)' : 'rgba(255,255,255,0.07)');
    round(c, x, y, w, h, 12); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    round(c, x, y, w, h, 12); c.stroke();
    c.fillStyle = b._hover ? '#08111d' : TEXT;
    c.font = `600 ${opts.font || 26}px system-ui, sans-serif`;
    const tw = c.measureText(label).width;
    c.fillText(label, x + (w - tw) / 2, y + h / 2 + (opts.font || 26) / 2.8);
    return b;
  }

  _drawSearch() {
    const c = this.ctx;
    // query field
    c.fillStyle = 'rgba(255,255,255,0.06)';
    round(c, 36, 96, W - 72 - 190, 62, 12); c.fill();
    c.fillStyle = this.query ? TEXT : DIM;
    c.font = '30px system-ui, sans-serif';
    c.fillText(this.query || 'Type a title…', 54, 138);
    this._btn('go', this.busy ? '…' : 'Search', W - 36 - 176, 96, 176, 62, { accent: true });

    // keyboard
    const kw = 88, kh = 66, gap = 8;
    const x0 = (W - (10 * kw + 9 * gap)) / 2;
    let y = 176;
    for (const row of KEY_ROWS) {
      let x = x0;
      for (const k of row) {
        this._btn('key:' + k, k, x, y, kw, kh, { font: 30 });
        x += kw + gap;
      }
      y += kh + gap;
    }
    this._btn('key: ', 'Space', x0, y, 5 * kw + 4 * gap, kh, { font: 26 });
    this._btn('bksp', '⌫', x0 + 5 * (kw + gap), y, 2 * kw + gap, kh, { font: 30 });
    this._btn('clear', 'Clear', x0 + 7 * (kw + gap), y, 3 * kw + 2 * gap - gap, kh, { font: 26 });
    y += kh + 18;

    // results
    const rowH = 78;
    const visible = Math.floor((H - y - 50) / rowH);
    const items = this.results.slice(this.scroll.search, this.scroll.search + visible);
    let ry = y;
    for (const m of items) {
      const b = this._btn('meta:' + m.id + ':' + m.type, '', 36, ry, W - 72 - 80, rowH - 8, { meta: m });
      const img = this._images.get(m.poster);
      if (img && img !== 'failed' && img !== 'loading') {
        try { c.drawImage(img, b.x + 8, b.y + 6, 40, rowH - 20); } catch (e) { /* skip */ }
      }
      c.fillStyle = b._hover ? '#08111d' : TEXT;
      c.font = '600 28px system-ui, sans-serif';
      c.fillText(`${m.name}`.slice(0, 42), b.x + 64, b.y + 32);
      c.fillStyle = b._hover ? '#20344d' : DIM;
      c.font = '22px system-ui, sans-serif';
      c.fillText(`${m.releaseInfo || ''} · ${m.type}`, b.x + 64, b.y + 60);
      ry += rowH;
    }
    if (this.results.length > visible) this._scrollButtons('search', y, visible, this.results.length);
  }

  _drawList(list, offset, top, labelFn, kind, subFn) {
    const c = this.ctx;
    const rowH = 82;
    const visible = Math.floor((H - top - 60) / rowH);
    let y = top;
    list.slice(offset, offset + visible).forEach((item, i) => {
      const idx = offset + i;
      const b = this._btn(`${kind}:${idx}`, '', 36, y, W - 72 - 80, rowH - 10, { item });
      c.fillStyle = b._hover ? '#08111d' : TEXT;
      c.font = '600 27px system-ui, sans-serif';
      c.fillText(labelFn(item).slice(0, 52), b.x + 20, b.y + 34);
      if (subFn) {
        c.fillStyle = b._hover ? '#20344d' : DIM;
        c.font = '21px system-ui, sans-serif';
        c.fillText(subFn(item), b.x + 20, b.y + 62);
      }
      y += rowH;
    });
    if (list.length > visible) this._scrollButtons(kind === 'ep' ? 'episodes' : 'streams', top, visible, list.length);
  }

  _scrollButtons(view, top, visible, total) {
    this._btn('up:' + view, '▲', W - 72, top, 44, 120, { font: 26 });
    this._btn('down:' + view, '▼', W - 72, H - 190, 44, 120, { font: 26 });
    const c = this.ctx;
    c.fillStyle = DIM;
    c.font = '20px system-ui, sans-serif';
    c.fillText(`${this.scroll[view] + 1}-${Math.min(total, this.scroll[view] + visible)}/${total}`, W - 88, H - 44);
    this._pageSize = visible;
  }

  // ---------------------------------------------------------------- input

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

  press(b) {
    if (!b) return;
    const [id, arg] = b.id.split(':');
    if (b.id === 'close') { this.mesh.visible = false; return; }
    if (b.id === 'back') {
      this.view = this.view === 'streams' && this.meta && this.meta.type === 'series' ? 'episodes' : 'search';
      this.notice = '';
      return this.draw();
    }
    if (id === 'key') { this.query += b.id.slice(4).toLowerCase(); return this.draw(); }
    if (b.id === 'bksp') { this.query = this.query.slice(0, -1); return this.draw(); }
    if (b.id === 'clear') { this.query = ''; return this.draw(); }
    if (b.id === 'go') return this.doSearch();
    if (id === 'up' || id === 'down') {
      const v = arg;
      const total = v === 'search' ? this.results.length : v === 'episodes' ? this.seasonEntries.length : this.streamList.length;
      const step = Math.max(1, (this._pageSize || 5) - 1);
      this.scroll[v] = Math.max(0, Math.min(total - 1, this.scroll[v] + (id === 'down' ? step : -step)));
      return this.draw();
    }
    if (id === 'meta' && b.meta) return this.pick(b.meta);
    if (id === 'ep' && b.item) {
      const e = b.item;
      return this._fetchStreams('series', `${this.meta.id}:${e.season}:${e.episode}`,
        `${this.meta.name} S${e.season}E${e.episode}`);
    }
    if (id === 'stream' && b.item) {
      this.onPlayUrl(b.item.url, this.streamLabelText || this.meta?.name || 'Nuvio stream');
      this.mesh.visible = false;
    }
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
