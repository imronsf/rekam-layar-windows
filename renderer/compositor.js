'use strict';

// Menyusun video sumber di atas latar (gradien / gambar) dengan sudut membulat dan bayangan,
// sehingga hasil rekaman tampak "mengambang". Frame dibaca lewat MediaStreamTrackProcessor dan
// ditulis ke MediaStreamTrackGenerator — tidak bergantung pada requestAnimationFrame, jadi tetap
// berjalan mulus walau jendela diminimalkan.

const BACKGROUNDS = [
  { id: 'none', name: 'Tanpa latar' },
  { id: 'sky', name: 'Langit', stops: ['#e4eeff', '#a8c6ff', '#4f86f7'] },
  { id: 'aurora', name: 'Aurora', stops: ['#7f7fd5', '#86a8e7', '#91eae4'] },
  { id: 'dusk', name: 'Senja', stops: ['#1d2b64', '#5b3e8f', '#f0627a'] },
  { id: 'sunset', name: 'Sunset', stops: ['#ff9a8b', '#ff6a88', '#ff99ac'] },
  { id: 'peach', name: 'Peach', stops: ['#ffecd2', '#fcb69f'] },
  { id: 'mint', name: 'Mint', stops: ['#d4fc79', '#96e6a1'] },
  { id: 'ocean', name: 'Samudra', stops: ['#0f2027', '#203a43', '#2c5364'] },
  { id: 'grape', name: 'Anggur', stops: ['#41295a', '#2f0743'] },
  { id: 'graphite', name: 'Grafit', stops: ['#232526', '#414345'] },
  { id: 'white', name: 'Putih', stops: ['#f7f8fa', '#e6e9ef'] },
  { id: 'custom', name: 'Gambar sendiri' },
];

const backgroundCss = (bg) => (bg.stops ? `linear-gradient(135deg, ${bg.stops.join(', ')})` : '');

function paintBackground(ctx, W, H, id, image) {
  const bg = BACKGROUNDS.find((b) => b.id === id) || BACKGROUNDS[0];

  if (bg.id === 'none') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    return;
  }

  if (bg.id === 'custom' && image) {
    // Mode "cover": isi seluruh kanvas, potong bagian yang berlebih.
    const k = Math.max(W / image.width, H / image.height);
    const w = image.width * k;
    const h = image.height * k;
    ctx.drawImage(image, (W - w) / 2, (H - h) / 2, w, h);
    return;
  }

  const stops = bg.stops || BACKGROUNDS.find((b) => b.id === 'graphite').stops;
  const lin = ctx.createLinearGradient(0, 0, W, H);
  stops.forEach((c, i) => lin.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = lin;
  ctx.fillRect(0, 0, W, H);

  // Cahaya lembut di kiri atas agar latar terasa lebih hidup.
  const R = Math.max(W, H) * 0.75;
  const glow = ctx.createRadialGradient(W * 0.22, H * 0.12, 0, W * 0.22, H * 0.12, R);
  glow.addColorStop(0, 'rgba(255,255,255,0.22)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

class Compositor {
  static get supported() {
    return 'MediaStreamTrackProcessor' in window && 'MediaStreamTrackGenerator' in window && 'VideoFrame' in window;
  }

  // opts: { size: [W, H] | null (ikut sumber), background, image, scale, radius, shadow }
  constructor(track, opts) {
    this.opts = { ...opts };
    this.canvas = new OffscreenCanvas(2, 2);
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.layer = new OffscreenCanvas(2, 2);
    this.layout = null;
    this.lockedSize = null;
    this.last = null;
    this.frames = 0;
    this.running = true;

    // Pakai salinan track agar menghentikan compositor tidak ikut mematikan sumber asli.
    this.input = track.clone();
    this.reader = new MediaStreamTrackProcessor({ track: this.input }).readable.getReader();
    this.track = new MediaStreamTrackGenerator({ kind: 'video' });
    this.track.contentHint = 'motion';
    this.writer = this.track.writable.getWriter();
    this.loop();
  }

  // Ukuran output yang sudah pasti, atau perkiraan sebelum frame pertama tiba.
  size(fallback) {
    if (this.layout) return [this.canvas.width, this.canvas.height];
    return this.opts.size || fallback;
  }

  update(opts) {
    Object.assign(this.opts, opts);
    this.layout = null;
    this.lockedSize = null;
    if (this.last) this.render(this.last);
  }

  async loop() {
    try {
      while (this.running) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!this.running) { value.close(); break; }
        this.last?.close();
        this.last = value;
        await this.render(value);
      }
    } catch (err) {
      if (this.running) console.error('Compositor:', err);
    }
    this.stop();
  }

  relayout(fw, fh) {
    const o = this.opts;
    const [W, H] = o.size || this.lockedSize || [even(fw), even(fh)];
    if (!o.size) this.lockedSize = [W, H];
    for (const c of [this.canvas, this.layer]) {
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    }

    const plain = o.background === 'none';
    const s = plain ? 1 : Math.min(1, Math.max(0.5, o.scale / 100));
    const a = fw / fh;
    const w = Math.round(Math.min(W * s, H * s * a));
    const h = Math.round(w / a);
    const x = Math.round((W - w) / 2);
    const y = Math.round((H - h) / 2);
    const unit = Math.min(W, H) / 1080;
    const r = plain ? 0 : Math.round(o.radius * unit);
    this.layout = { fw, fh, x, y, w, h, r };

    // Latar + bayangan digambar sekali ke layer statis; per frame cukup ditempel.
    const g = this.layer.getContext('2d', { alpha: false });
    paintBackground(g, W, H, o.background, o.image);
    const k = plain ? 0 : o.shadow / 100;
    if (k > 0) {
      g.save();
      g.shadowColor = `rgba(0, 0, 0, ${0.6 * k})`;
      g.shadowBlur = 80 * k * unit;
      g.shadowOffsetY = 26 * k * unit;
      g.fillStyle = '#000';
      g.beginPath();
      g.roundRect(x, y, w, h, r);
      g.fill();
      g.restore();
    }
  }

  render(frame) {
    const fw = frame.displayWidth;
    const fh = frame.displayHeight;
    if (!this.layout || this.layout.fw !== fw || this.layout.fh !== fh) this.relayout(fw, fh);

    const { x, y, w, h, r } = this.layout;
    const ctx = this.ctx;
    ctx.drawImage(this.layer, 0, 0);
    if (r > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.clip();
      ctx.drawImage(frame, x, y, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(frame, x, y, w, h);
    }

    const out = new VideoFrame(this.canvas, { timestamp: Math.round(performance.now() * 1000) });
    this.frames++;
    return this.writer.write(out).catch(() => {}).finally(() => out.close());
  }

  stop() {
    if (this.stopped) return;
    this.running = false;
    this.stopped = true;
    this.reader.cancel().catch(() => {});
    this.writer.close().catch(() => {});
    this.input.stop();
    this.track.stop();
    this.last?.close();
    this.last = null;
  }
}
