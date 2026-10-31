'use strict';

// Uji otomatis: rekam beberapa mode (tanpa latar, latar 16:9, portrait 9:16, persegi 1:1 saat
// jendela diminimalkan), pastikan tiap file bisa diputar dengan ukuran yang benar, ukur fps
// compositor, lalu hapus file uji. Pemakaian: npm run selftest
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const { pathToFileURL } = require('url');

require('../main.js');

const SCENARIOS = [
  { name: 'Asli tanpa latar', set: { background: 'none', aspect: 'original' } },
  { name: 'Latar Langit 16:9', set: { background: 'sky', aspect: '16:9', scale: 88, radius: 18, shadow: 60 }, expect: [1920, 1080] },
  { name: 'Portrait 9:16', set: { background: 'dusk', aspect: '9:16', scale: 92, radius: 24, shadow: 80 }, expect: [1080, 1920] },
  { name: 'Persegi 1:1 (diminimalkan)', set: { background: 'aurora', aspect: '1:1' }, expect: [1080, 1080], minimize: true },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const recordScenario = (set) => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50 && !state.preview; i++) await wait(200);
  if (!state.preview) return { error: 'preview tidak tersedia' };
  Object.assign(state.settings, ${JSON.stringify(set)}, { countdown: false, minimizeOnRecord: false });
  applyStyle();
  await wait(1200);
  const f0 = state.compositor ? state.compositor.frames : 0;
  await startRecording();
  if (state.status !== 'recording') return { error: 'gagal mulai merekam' };
  const t0 = performance.now();
  await wait(2500);
  togglePause(); await wait(600); togglePause();
  await wait(1500);
  const fps = state.compositor ? (state.compositor.frames - f0) / ((performance.now() - t0) / 1000) : null;
  stopRecording();
  for (let i = 0; i < 50 && state.status !== 'idle'; i++) await wait(200);
  return { saved: state.lastSaved, mime: state.mime, composited: !!state.compositor, fps: fps && Math.round(fps), size: outputSize() };
})()`;

function probe(file) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({ show: false });
    // Halaman ber-origin file:// agar video lokal boleh dimuat.
    w.loadURL(pathToFileURL(__filename).href).then(async () => {
      const info = await w.webContents.executeJavaScript(`new Promise((res) => {
        const v = document.createElement('video');
        v.muted = true;
        v.onloadeddata = () => res({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
        v.onerror = () => res({ error: v.error && v.error.message });
        v.src = ${JSON.stringify(pathToFileURL(file).href)};
      })`);
      w.destroy();
      resolve(info);
    }).catch((err) => resolve({ error: String(err) }));
  });
}

// Jendela beranimasi agar layar terus berubah → mengukur fps compositor yang sebenarnya.
function motionWindow() {
  const w = new BrowserWindow({ width: 640, height: 400, x: 40, y: 40, frame: false, alwaysOnTop: true, show: true, focusable: false });
  w.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:#111"><canvas id=c width=640 height=400></canvas><script>
    const g = c.getContext('2d'); let t = 0;
    (function f(){ t++; g.fillStyle = 'hsl(' + (t * 3 % 360) + ',70%,50%)'; g.fillRect(0,0,640,400);
      g.fillStyle = '#fff'; g.fillRect((t * 9) % 640, 150, 100, 100); requestAnimationFrame(f); })();
  </script></body>`));
  return w;
}

app.on('browser-window-created', (_e, win) => {
  if (app.__tested) return;
  app.__tested = true;
  win.webContents.once('did-finish-load', async () => {
    const motion = motionWindow();
    let failed = 0;
    for (const sc of SCENARIOS) {
      if (sc.minimize) win.minimize();
      let res;
      try { res = await win.webContents.executeJavaScript(recordScenario(sc.set)); } catch (err) { res = { error: String(err) }; }
      if (sc.minimize) { win.restore(); await wait(500); }

      let ok = !res.error && res.saved;
      let info = {};
      if (ok) {
        info = await probe(res.saved.path);
        const dimsOk = !sc.expect || (info.width === sc.expect[0] && info.height === sc.expect[1]);
        ok = !info.error && info.width > 0 && dimsOk && info.duration > 2.5;
        fs.rmSync(res.saved.path, { force: true });
      }
      if (!ok) failed++;
      console.log(`${ok ? 'LULUS' : 'GAGAL'} | ${sc.name} | ${info.width}x${info.height} | ${info.duration?.toFixed?.(2)}s | ` +
        `compositor=${res.composited} fps=${res.fps ?? '-'} | ${res.mime || ''} ${res.error || info.error || ''}`);
    }
    motion.destroy();
    console.log(failed ? `SELFTEST GAGAL (${failed})` : 'SELFTEST OK');
    app.exit(failed ? 1 : 0);
  });
});
