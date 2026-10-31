'use strict';

// Uji otomatis: jalankan aplikasi, rekam layar ±4 detik, lalu pastikan file video dapat dibaca.
// Pemakaian: npm run selftest
const { app, BrowserWindow } = require('electron');
const { pathToFileURL } = require('url');

require('../main.js');

const RENDERER_TEST = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50 && !state.preview; i++) await wait(200);
  if (!state.preview) return { error: 'preview tidak tersedia' };
  state.settings.countdown = false;
  state.settings.minimizeOnRecord = false;
  const track = state.preview.getVideoTracks()[0].getSettings();
  await startRecording();
  await wait(4000);
  togglePause(); await wait(800); togglePause();
  await wait(1000);
  stopRecording();
  for (let i = 0; i < 50 && state.status !== 'idle'; i++) await wait(200);
  return { saved: state.lastSaved, mime: state.mime, track, audio: state.audio && { system: state.audio.hasSystem, mic: state.audio.hasMic } };
})()`;

function probe(file) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({ show: false });
    // Halaman ber-origin file:// agar video lokal boleh dimuat.
    w.loadURL(pathToFileURL(__filename).href).then(async () => {
      const url = pathToFileURL(file).href;
      const info = await w.webContents.executeJavaScript(`new Promise((res) => {
        const v = document.createElement('video');
        v.muted = true;
        v.onloadeddata = () => res({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
        v.onerror = () => res({ error: v.error && v.error.message });
        v.src = ${JSON.stringify(url)};
      })`);
      w.destroy();
      resolve(info);
    }).catch((err) => resolve({ error: String(err) }));
  });
}

app.on('browser-window-created', (_e, win) => {
  if (app.__tested) return;
  app.__tested = true;
  win.webContents.once('did-finish-load', async () => {
    let code = 0;
    try {
      const result = await win.webContents.executeJavaScript(RENDERER_TEST);
      console.log('HASIL REKAM:', JSON.stringify(result, null, 2));
      if (!result.saved) throw new Error(result.error || 'file tidak tersimpan');
      const info = await probe(result.saved.path);
      console.log('HASIL PUTAR:', JSON.stringify(info));
      if (info.error || !info.width) code = 1;
    } catch (err) {
      console.error('SELFTEST GAGAL:', err);
      code = 1;
    }
    console.log(code === 0 ? 'SELFTEST OK' : 'SELFTEST GAGAL');
    app.exit(code);
  });
});
