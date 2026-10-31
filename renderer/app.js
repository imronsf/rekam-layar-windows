'use strict';

// `api` adalah global yang disediakan preload.js lewat contextBridge.
const $ =(s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const RES = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] };
const BPP = { standard: 0.06, high: 0.1, ultra: 0.16 }; // bit per piksel per frame
const RESTART_PREVIEW = new Set(['resolution', 'fps', 'systemAudio']);
const REBUILD_AUDIO = new Set(['mic', 'micId', 'noiseSuppression']);
const STYLE_KEYS = new Set(['aspect', 'background', 'scale', 'radius', 'shadow']);
const RANGE_FMT = { scale: (v) => `${v}%`, radius: (v) => `${v}px`, shadow: (v) => `${v}%` };
const STATUS_TEXT = {
  idle: 'Siap merekam',
  countdown: 'Bersiap…',
  recording: 'Merekam',
  paused: 'Dijeda',
  saving: 'Menyimpan…',
};

const ICON = {
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="13" height="14" rx="2.5"/><path d="M16 10l5-3v10l-5-3"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2.2h7.4A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5"/></svg>',
  window: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9h18"/></svg>',
  none: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
};

const el = {
  stage: $('#stage'),
  video: $('#preview'),
  stageMeta: $('#stageMeta'),
  recBadgeText: $('#recBadgeText'),
  countdown: $('#countdown'),
  countdownNum: $('#countdownNum'),
  statusText: $('#statusText'),
  timer: $('#timer'),
  cbSub: $('#cbSub'),
  btnRec: $('#btnRec'),
  btnPause: $('#btnPause'),
  btnMic: $('#btnMic'),
  meterFill: $('#meterFill'),
  audioSrcLabel: $('#audioSrcLabel'),
  srcGrid: $('#srcGrid'),
  srcType: $('#srcType'),
  btnRefresh: $('#btnRefresh'),
  fields: $('#settingsFields'),
  micSelect: $('#micSelect'),
  micOptions: $('#micOptions'),
  bitrateHint: $('#bitrateHint'),
  folderPath: $('#folderPath'),
  bgGrid: $('#bgGrid'),
  btnBgImage: $('#btnBgImage'),
  styleOptions: $('#styleOptions'),
  files: $('#files'),
  fileCount: $('#fileCount'),
  toasts: $('#toasts'),
};

const state = {
  settings: null,
  sources: [],
  sourceType: 'screen',
  selectedId: null,
  preview: null,
  previewToken: 0,
  videoTrack: null, // track yang direkam: hasil compositor atau sumber asli
  compositor: null,
  bgImage: null, // ImageBitmap latar kustom
  bgThumb: '',
  micStream: null,
  micMuted: false,
  audio: null, // { ctx, dest, analyser, micGain, hasSystem, hasMic }
  recorder: null,
  status: 'idle',
  startedAt: 0,
  accumulated: 0,
  bytes: 0,
  writeChain: Promise.resolve(),
  writeError: null,
  mime: '',
  ext: '',
  cancelCountdown: null,
  closeAfterStop: false,
  lastSaved: null,
  meterLevel: 0,
  title: '',
};

/* ---------------- Utilitas ---------------- */

const pad = (n) => String(n).padStart(2, '0');

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return `${b.toFixed(b < 10 ? 1 : 0)} ${u[i]}`;
}

function fmtDate(ms) {
  return new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const elapsed = () => state.accumulated + (state.status === 'recording' ? performance.now() - state.startedAt : 0);
const isActive = () => state.status === 'recording' || state.status === 'paused';

function stopStream(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

function bitrate(w, h, fps, quality) {
  const bps = w * h * fps * (BPP[quality] || BPP.high);
  return Math.round(Math.min(80e6, Math.max(2.5e6, bps)));
}

function pickMime(format, hasAudio) {
  const lists = {
    mp4: hasAudio
      ? ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.640033,opus', 'video/mp4;codecs=avc1,opus', 'video/mp4']
      : ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4'],
    webm: hasAudio
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
  };
  const order = format === 'webm' ? ['webm', 'mp4'] : ['mp4', 'webm'];
  for (const ext of order) {
    for (const mime of lists[ext]) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: '', ext: 'webm' };
}

function sourceLabel(s, i) {
  if (s.type !== 'screen') return s.name;
  if (/^(entire screen|screen)$/i.test(s.name)) return 'Layar utama';
  const m = s.name.match(/(\d+)/);
  return m ? `Layar ${m[1]}` : `Layar ${i + 1}`;
}

/* ---------------- Toast ---------------- */

function toast(title, { text = '', type = 'info', actions = [], timeout = 4500 } = {}) {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = '<span class="toast-dot"></span><div class="toast-body"><div class="toast-title"></div><div class="toast-text"></div></div><div class="toast-actions"></div>';
  $('.toast-title', node).textContent = title;
  const t = $('.toast-text', node);
  if (text) { t.textContent = text; t.title = text; } else t.remove();

  const close = () => {
    if (node.classList.contains('out')) return;
    node.classList.add('out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  };
  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    b.addEventListener('click', () => { a.run(); close(); });
    $('.toast-actions', node).append(b);
  }
  el.toasts.append(node);
  while (el.toasts.children.length > 4) el.toasts.firstElementChild.remove();
  if (timeout) setTimeout(close, timeout);
}

/* ---------------- Sumber ---------------- */

async function refreshSources() {
  el.btnRefresh.classList.remove('spinning');
  void el.btnRefresh.offsetWidth;
  el.btnRefresh.classList.add('spinning');
  try {
    state.sources = await api.listSources();
  } catch (err) {
    console.error(err);
    toast('Gagal memuat sumber', { type: 'error', text: err.message });
    return;
  }
  const current = state.sources.find((s) => s.id === state.selectedId);
  if (!current && !isActive()) {
    const first = state.sources.find((s) => s.type === 'screen') || state.sources[0];
    if (first) await selectSource(first.id);
  }
  renderSources();
}

function renderSources() {
  const list = state.sources.filter((s) => s.type === state.sourceType);
  el.srcGrid.classList.toggle('wide', state.sourceType === 'screen' && list.length <= 2);
  el.srcGrid.replaceChildren();

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `${ICON.window}<div></div>`;
    empty.lastChild.textContent = state.sourceType === 'screen' ? 'Tidak ada layar terdeteksi' : 'Tidak ada jendela terbuka';
    el.srcGrid.append(empty);
    return;
  }

  list.forEach((s, i) => {
    const card = document.createElement('button');
    card.className = 'src-card' + (s.id === state.selectedId ? ' selected' : '');
    card.style.animationDelay = `${Math.min(i, 10) * 25}ms`;
    card.innerHTML = '<div class="thumb"></div><div class="src-name"><span></span></div>';

    const thumb = $('.thumb', card);
    if (s.thumb) {
      const img = new Image();
      img.src = s.thumb;
      thumb.append(img);
    } else if (s.icon) {
      const img = new Image();
      img.src = s.icon;
      img.className = 'app-icon';
      thumb.append(img);
    }
    const name = sourceLabel(s, i);
    if (s.icon && s.type === 'window') {
      const ic = new Image();
      ic.src = s.icon;
      $('.src-name', card).prepend(ic);
    }
    $('.src-name span', card).textContent = name;
    card.title = s.name;
    card.addEventListener('click', () => selectSource(s.id));
    el.srcGrid.append(card);
  });
}

async function selectSource(id) {
  if (state.status !== 'idle') return;
  if (id === state.selectedId && state.preview) return;
  state.selectedId = id;
  await api.selectSource(id);
  renderSources();
  await startPreview();
}

/* ---------------- Preview & audio ---------------- */

async function startPreview() {
  const token = ++state.previewToken;
  const s = state.settings;
  const [w, h] = RES[s.resolution] || RES[1080];
  const video = { width: { max: w }, height: { max: h }, frameRate: { ideal: s.fps, max: s.fps } };

  state.compositor?.stop();
  state.compositor = null;
  state.videoTrack = null;
  stopStream(state.preview);
  state.preview = null;
  el.stage.classList.remove('has-video');
  el.stage.classList.add('loading');

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: !!s.systemAudio });
  } catch (err) {
    if (s.systemAudio) {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
        toast('Audio sistem tidak tersedia', { type: 'warn', text: 'Merekam tanpa suara sistem untuk sumber ini.' });
      } catch (err2) { console.error(err2); }
    } else {
      console.error(err);
    }
  }

  if (token !== state.previewToken) { stopStream(stream); return; }
  el.stage.classList.remove('loading');

  if (!stream) {
    toast('Tidak dapat mengakses sumber', { type: 'error', text: 'Coba pilih layar atau jendela lain.' });
    updateMeta();
    return;
  }

  const vt = stream.getVideoTracks()[0];
  vt.contentHint = 'motion';
  vt.addEventListener('ended', () => onSourceEnded(stream));
  state.preview = stream;
  attachPipeline();
  el.stage.classList.add('has-video');

  await rebuildAudio();
  updateMeta();
}

/* ---------------- Gaya hasil video (latar, rasio, bayangan) ---------------- */

const needsCompositing = () => state.settings.background !== 'none' || state.settings.aspect !== 'original';

function compositorOptions() {
  const s = state.settings;
  const [w, h] = RES[s.resolution] || RES[1080];
  return {
    size: { '16:9': [w, h], '9:16': [h, w], '1:1': [h, h] }[s.aspect] || null,
    background: s.background,
    image: state.bgImage,
    scale: s.scale,
    radius: s.radius,
    shadow: s.shadow,
  };
}

// Pasang track yang akan dipratinjau & direkam: lewat compositor bila perlu, atau sumber asli.
function attachPipeline() {
  state.compositor?.stop();
  state.compositor = null;
  const raw = state.preview?.getVideoTracks()[0];
  state.videoTrack = raw || null;
  if (!raw) return;

  if (needsCompositing()) {
    if (Compositor.supported) {
      try {
        state.compositor = new Compositor(raw, compositorOptions());
        state.videoTrack = state.compositor.track;
      } catch (err) {
        console.error(err);
        toast('Latar tidak dapat diterapkan', { type: 'warn', text: 'Merekam tanpa latar.' });
      }
    } else {
      toast('Latar tidak didukung', { type: 'warn', text: 'Merekam tanpa latar.' });
    }
  }
  el.video.srcObject = new MediaStream([state.videoTrack]);
}

function applyStyle() {
  if (!state.preview) return;
  if (needsCompositing() !== !!state.compositor) attachPipeline();
  else state.compositor?.update(compositorOptions());
  updateMeta();
}

// Ukuran video akhir [lebar, tinggi].
function outputSize() {
  const st = state.preview?.getVideoTracks()[0]?.getSettings() || {};
  const src = [st.width || 1920, st.height || 1080];
  return state.compositor ? state.compositor.size(src) : src;
}

async function loadBackgroundImage(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const k = Math.min(1, 3840 / Math.max(img.naturalWidth, img.naturalHeight));
  state.bgImage = await createImageBitmap(img, {
    resizeWidth: Math.round(img.naturalWidth * k),
    resizeHeight: Math.round(img.naturalHeight * k),
    resizeQuality: 'high',
  });
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const t = Math.max(96 / img.naturalWidth, 96 / img.naturalHeight);
  c.getContext('2d').drawImage(img, (96 - img.naturalWidth * t) / 2, (96 - img.naturalHeight * t) / 2, img.naturalWidth * t, img.naturalHeight * t);
  state.bgThumb = c.toDataURL('image/jpeg', 0.85);
}

async function chooseBackgroundImage() {
  if (state.status !== 'idle') return;
  const res = await api.chooseBackground();
  if (!res) return;
  if (res.error) { toast('Gambar tidak dapat dipakai', { type: 'error', text: res.error }); return; }
  try {
    await loadBackgroundImage(res.dataUrl);
  } catch {
    toast('Gambar tidak dapat dibaca', { type: 'error', text: 'Coba format PNG atau JPG.' });
    return;
  }
  state.settings.bgImage = res.path;
  state.settings.background = 'custom';
  api.setSettings({ background: 'custom' });
  renderSettings();
  applyStyle();
}

function renderBackgrounds() {
  el.bgGrid.replaceChildren();
  for (const bg of BACKGROUNDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `bg-swatch ${bg.id === 'none' || bg.id === 'custom' ? bg.id : ''}`;
    b.dataset.bg = bg.id;
    b.title = bg.name;
    b.setAttribute('aria-label', bg.name);
    if (bg.stops) b.style.backgroundImage = backgroundCss(bg);
    if (bg.id === 'none') b.innerHTML = ICON.none;
    if (bg.id === 'custom') b.innerHTML = ICON.plus;
    el.bgGrid.append(b);
  }
}

function onSourceEnded(stream) {
  if (stream !== state.preview) return;
  if (isActive()) {
    toast('Sumber ditutup', { type: 'warn', text: 'Rekaman dihentikan dan disimpan otomatis.' });
    stopRecording();
  }
  state.compositor?.stop();
  state.compositor = null;
  state.videoTrack = null;
  state.preview = null;
  state.selectedId = null;
  el.video.srcObject = null;
  el.stage.classList.remove('has-video');
  updateMeta();
  if (!isActive()) refreshSources();
}

async function rebuildAudio() {
  if (state.audio) await state.audio.ctx.close().catch(() => {});
  state.audio = null;
  stopStream(state.micStream);
  state.micStream = null;

  const s = state.settings;
  const sysTracks = s.systemAudio && state.preview ? state.preview.getAudioTracks() : [];

  if (s.mic) {
    const ns = !!s.noiseSuppression;
    try {
      state.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: s.micId && s.micId !== 'default' ? { exact: s.micId } : undefined,
          noiseSuppression: ns,
          echoCancellation: ns,
          autoGainControl: true,
          channelCount: { ideal: 2 },
          sampleRate: { ideal: 48000 },
        },
      });
    } catch (err) {
      console.error(err);
      toast('Mikrofon tidak dapat diakses', { type: 'error', text: 'Periksa izin mikrofon di Pengaturan Windows.' });
    }
    listMics();
  }

  if (sysTracks.length || state.micStream) {
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    const dest = ctx.createMediaStreamDestination();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    let micGain = null;

    if (sysTracks.length) {
      const src = ctx.createMediaStreamSource(new MediaStream(sysTracks));
      src.connect(dest);
      src.connect(analyser);
    }
    if (state.micStream) {
      const src = ctx.createMediaStreamSource(state.micStream);
      micGain = ctx.createGain();
      micGain.gain.value = state.micMuted ? 0 : 1;
      src.connect(micGain);
      micGain.connect(dest);
      micGain.connect(analyser);
    }
    await ctx.resume().catch(() => {});
    state.audio = { ctx, dest, analyser, micGain, hasSystem: sysTracks.length > 0, hasMic: !!state.micStream, buf: new Float32Array(analyser.fftSize) };
  }
  updateUI();
}

async function listMics() {
  let devices = [];
  try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch { /* abaikan */ }
  const current = state.settings.micId;
  el.micSelect.replaceChildren();
  if (!devices.length) {
    el.micSelect.append(new Option('Tidak ada mikrofon', ''));
    return;
  }
  devices.forEach((d, i) => {
    let label = d.label || `Mikrofon ${i + 1}`;
    if (d.deviceId === 'default') label = label.replace(/^Default - /, 'Bawaan · ');
    if (d.deviceId === 'communications') label = label.replace(/^Communications - /, 'Komunikasi · ');
    el.micSelect.append(new Option(label, d.deviceId));
  });
  el.micSelect.value = devices.some((d) => d.deviceId === current) ? current : devices[0].deviceId;
  el.micSelect.title = el.micSelect.selectedOptions[0]?.text || '';
}

function updateMeta() {
  const vt = state.preview?.getVideoTracks()[0];
  if (vt) {
    const st = vt.getSettings();
    const [w, h] = outputSize();
    el.stageMeta.textContent = `${w}×${h} · ${Math.round(st.frameRate || state.settings.fps)} fps`;
  } else {
    el.stageMeta.textContent = '';
  }
  updateSub();
}

function updateSub() {
  const s = state.settings;
  if (isActive() || state.status === 'saving') {
    el.cbSub.textContent = `${fmtBytes(state.bytes)} · ${state.ext.toUpperCase()}`;
    return;
  }
  const res = state.preview ? outputSize().join('×') : `${s.resolution}p`;
  el.cbSub.textContent = `${s.format.toUpperCase()} · ${res} · ${s.fps} fps · ${({ standard: 'Standar', high: 'Tinggi', ultra: 'Ultra' })[s.quality]}`;
}

/* ---------------- Perekaman ---------------- */

function countdown(n) {
  return new Promise((resolve) => {
    let i = n;
    let timer = null;
    state.status = 'countdown';
    updateUI();
    el.countdown.classList.add('show');

    const finish = (ok) => {
      clearTimeout(timer);
      state.cancelCountdown = null;
      el.countdown.classList.remove('show');
      if (!ok) { state.status = 'idle'; updateUI(); }
      resolve(ok);
    };
    const step = () => {
      if (i === 0) return finish(true);
      el.countdownNum.textContent = i;
      el.countdownNum.classList.remove('pop');
      void el.countdownNum.offsetWidth;
      el.countdownNum.classList.add('pop');
      i--;
      timer = setTimeout(step, 1000);
    };
    state.cancelCountdown = () => finish(false);
    step();
  });
}

async function startRecording() {
  if (state.status !== 'idle') return;
  if (!state.preview) {
    await startPreview();
    if (!state.preview) return;
  }
  if (state.settings.countdown && !(await countdown(3))) return;
  if (!state.preview) { state.status = 'idle'; updateUI(); return; }

  const s = state.settings;
  const vt = state.videoTrack || state.preview.getVideoTracks()[0];
  const tracks = [vt, ...(state.audio ? state.audio.dest.stream.getAudioTracks() : [])];
  const stream = new MediaStream(tracks);
  const { mime, ext } = pickMime(s.format, tracks.length > 1);
  const st = state.preview.getVideoTracks()[0].getSettings();
  const [ow, oh] = outputSize();
  const vbps = bitrate(ow, oh, Math.round(st.frameRate || s.fps), s.quality);

  let recorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: mime || undefined,
      videoBitsPerSecond: vbps,
      audioBitsPerSecond: 192000,
    });
  } catch (err) {
    console.error(err);
    toast('Encoder tidak didukung', { type: 'error', text: err.message });
    state.status = 'idle';
    updateUI();
    return;
  }
  if (ext !== s.format) toast(`Format ${s.format.toUpperCase()} tidak didukung`, { type: 'warn', text: `Menggunakan ${ext.toUpperCase()}.` });

  try {
    await api.startRec(ext);
  } catch (err) {
    toast('Gagal membuat file', { type: 'error', text: err.message });
    state.status = 'idle';
    updateUI();
    return;
  }

  state.mime = recorder.mimeType || mime;
  state.ext = ext;
  state.bytes = 0;
  state.writeError = null;
  state.writeChain = Promise.resolve();

  // Data ditulis langsung ke disk per detik → memori tetap ringan walau rekaman berjam-jam.
  recorder.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    const blob = e.data;
    state.writeChain = state.writeChain
      .then(async () => { state.bytes = await api.writeChunk(new Uint8Array(await blob.arrayBuffer())); })
      .catch((err) => {
        if (!state.writeError) {
          state.writeError = err;
          toast('Gagal menulis ke disk', { type: 'error', text: err.message, timeout: 0 });
          stopRecording();
        }
      });
  };
  recorder.onstop = finalizeRecording;
  recorder.onerror = (e) => {
    console.error(e.error || e);
    toast('Kesalahan perekaman', { type: 'error', text: e.error?.message || '' });
    stopRecording();
  };

  recorder.start(1000);
  state.recorder = recorder;
  state.status = 'recording';
  state.accumulated = 0;
  state.startedAt = performance.now();
  api.setRecState('recording');
  updateUI();
}

function stopRecording() {
  if (state.status === 'countdown') { state.cancelCountdown?.(); return; }
  if (!isActive()) return;
  state.accumulated = elapsed();
  state.status = 'saving';
  updateUI();
  try { state.recorder.stop(); } catch { finalizeRecording(); }
}

async function finalizeRecording() {
  await state.writeChain;
  let result = null;
  try { result = await api.stopRec(); } catch (err) { toast('Gagal menyimpan', { type: 'error', text: err.message }); }

  state.recorder = null;
  state.status = 'idle';
  state.accumulated = 0;
  api.setRecState('idle');
  updateUI();
  updateMeta();

  if (result) {
    state.lastSaved = result;
    toast('Rekaman tersimpan', {
      type: 'success',
      text: `${result.name} · ${fmtBytes(result.size)}`,
      timeout: 7000,
      actions: [
        { label: 'Putar', run: () => api.openFile(result.path) },
        { label: 'Folder', run: () => api.revealFile(result.path) },
      ],
    });
    await refreshFiles(result.path);
  }
  if (state.closeAfterStop) api.win.closeNow();
  else if (!state.preview) refreshSources(); // sumber ditutup saat merekam → pilih ulang otomatis
}

function togglePause() {
  if (state.status === 'recording') {
    state.recorder.pause();
    state.accumulated = elapsed();
    state.status = 'paused';
  } else if (state.status === 'paused') {
    state.recorder.resume();
    state.startedAt = performance.now();
    state.status = 'recording';
  } else return;
  updateUI();
}

function toggleRecord() {
  if (state.status === 'idle') startRecording();
  else stopRecording();
}

function toggleMic() {
  state.micMuted = !state.micMuted;
  if (state.audio?.micGain) state.audio.micGain.gain.setTargetAtTime(state.micMuted ? 0 : 1, state.audio.ctx.currentTime, 0.02);
  updateUI();
}

/* ---------------- Rekaman tersimpan ---------------- */

async function refreshFiles(freshPath) {
  let files = [];
  try { files = await api.listFiles(); } catch (err) { console.error(err); }
  el.fileCount.textContent = files.length ? files.length : '';
  el.files.replaceChildren();

  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `${ICON.film}<div>Belum ada rekaman.<br>Tekan tombol merah untuk mulai.</div>`;
    el.files.append(empty);
    return;
  }

  files.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'file' + (f.path === freshPath ? ' fresh' : '');
    item.style.animationDelay = `${Math.min(i, 12) * 20}ms`;
    item.innerHTML = `
      <div class="file-icon">${ICON.film}</div>
      <div class="file-info"><div class="file-name"></div><div class="file-meta"></div></div>
      <div class="file-actions">
        <button class="icon-btn" data-act="open" title="Putar">${ICON.play}</button>
        <button class="icon-btn" data-act="reveal" title="Tampilkan di folder">${ICON.folder}</button>
        <button class="icon-btn danger" data-act="trash" title="Pindahkan ke Recycle Bin">${ICON.trash}</button>
      </div>`;
    $('.file-name', item).textContent = f.name;
    $('.file-name', item).title = f.name;
    $('.file-meta', item).textContent = `${fmtDate(f.mtime)} · ${fmtBytes(f.size)}`;
    item.addEventListener('dblclick', () => api.openFile(f.path));
    item.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'open') api.openFile(f.path);
      else if (act === 'reveal') api.revealFile(f.path);
      else if (act === 'trash') {
        if (await api.trashFile(f.path)) {
          toast('Dipindahkan ke Recycle Bin', { text: f.name });
          refreshFiles();
        }
      }
    });
    el.files.append(item);
  });
}

/* ---------------- Pengaturan ---------------- */

function renderSettings() {
  const s = state.settings;
  $$('[data-setting]').forEach((input) => {
    const v = s[input.dataset.setting];
    if (input.type === 'checkbox') input.checked = !!v;
    else if (input.tagName === 'SELECT' && input !== el.micSelect) input.value = String(v);
  });
  $$('.seg[data-seg]').forEach((seg) => {
    const v = String(s[seg.dataset.seg]);
    $$('button', seg).forEach((b) => b.classList.toggle('active', b.dataset.value === v));
  });
  el.micOptions.classList.toggle('off', !s.mic);
  el.folderPath.textContent = s.saveDir;
  el.folderPath.title = s.saveDir;

  $$('.bg-swatch', el.bgGrid).forEach((b) => {
    b.classList.toggle('selected', b.dataset.bg === s.background);
    if (b.dataset.bg === 'custom') {
      b.classList.toggle('has-image', !!state.bgThumb);
      b.style.backgroundImage = state.bgThumb ? `url("${state.bgThumb}")` : '';
    }
  });
  el.btnBgImage.classList.toggle('show', s.background === 'custom' && !!state.bgThumb);
  el.styleOptions.classList.toggle('off', s.background === 'none');
  $$('input[type=range][data-setting]').forEach((r) => {
    const key = r.dataset.setting;
    r.value = s[key];
    r.style.setProperty('--p', `${((s[key] - r.min) / (r.max - r.min)) * 100}%`);
    $(`#out${key[0].toUpperCase()}${key.slice(1)}`).textContent = RANGE_FMT[key](s[key]);
  });

  const [rw, rh] = RES[s.resolution] || RES[1080];
  const [w, h] = { '9:16': [rh, rw], '1:1': [rh, rh] }[s.aspect] || [rw, rh];
  const vbps = bitrate(w, h, s.fps, s.quality);
  const mbPerMin = (vbps + 192000) * 60 / 8 / 1e6;
  el.bitrateHint.textContent = `Perkiraan ±${(vbps / 1e6).toFixed(1)} Mbps · ±${Math.round(mbPerMin)} MB per menit. ${s.format === 'mp4' ? 'H.264 dengan akselerasi hardware.' : 'VP9, kompatibel untuk web.'}`;
}

async function setSetting(key, value) {
  if (state.status !== 'idle' || state.settings[key] === value) return;
  state.settings[key] = value;
  renderSettings();
  updateSub();
  api.setSettings({ [key]: value });
  if (RESTART_PREVIEW.has(key)) await startPreview();
  else if (REBUILD_AUDIO.has(key)) await rebuildAudio();
  else if (STYLE_KEYS.has(key)) applyStyle();
}

/* ---------------- UI ---------------- */

function updateUI() {
  const st = state.status;
  const active = isActive();
  document.body.dataset.status = st;

  el.statusText.textContent = STATUS_TEXT[st];
  el.recBadgeText.textContent = st === 'paused' ? 'JEDA' : 'REC';

  el.btnRec.classList.toggle('is-recording', active || st === 'saving');
  el.btnRec.disabled = st === 'saving';
  el.btnRec.title = active ? 'Hentikan & simpan (Ctrl+Alt+R)' : st === 'countdown' ? 'Batalkan' : 'Mulai rekam (Ctrl+Alt+R)';

  el.btnPause.disabled = !active;
  el.btnPause.classList.toggle('is-paused', st === 'paused');
  el.btnPause.title = st === 'paused' ? 'Lanjutkan (Ctrl+Alt+P)' : 'Jeda (Ctrl+Alt+P)';

  const hasMic = !!state.audio?.hasMic;
  el.btnMic.classList.toggle('is-hidden', !hasMic);
  el.btnMic.classList.toggle('muted', state.micMuted);
  el.btnMic.title = state.micMuted ? 'Aktifkan mikrofon' : 'Bisukan mikrofon';

  const a = state.audio;
  el.audioSrcLabel.textContent = !a ? 'Mati' : a.hasSystem && a.hasMic ? 'Sistem + Mik' : a.hasSystem ? 'Sistem' : 'Mikrofon';

  el.fields.disabled = st !== 'idle';
  el.srcGrid.classList.toggle('locked', st !== 'idle');
  el.srcType.classList.toggle('locked', st !== 'idle');

  if (st === 'idle') el.timer.textContent = '00:00:00';
  updateSub();
}

function frame() {
  if (isActive() || state.status === 'saving') {
    const t = fmtTime(elapsed());
    if (el.timer.textContent !== t) {
      el.timer.textContent = t;
      updateSub();
    }
  }

  let level = 0;
  const a = state.audio;
  if (a) {
    a.analyser.getFloatTimeDomainData(a.buf);
    let peak = 0;
    for (let i = 0; i < a.buf.length; i++) peak = Math.max(peak, Math.abs(a.buf[i]));
    const db = 20 * Math.log10(peak || 1e-6);
    level = Math.max(0, Math.min(1, (db + 60) / 60));
  }
  state.meterLevel = level > state.meterLevel ? level : state.meterLevel * 0.9 + level * 0.1;
  el.meterFill.style.width = `${(state.meterLevel * 100).toFixed(1)}%`;

  requestAnimationFrame(frame);
}

function updateTitle() {
  const t = isActive() ? `● ${fmtTime(elapsed())} — Rekam Studio` : 'Rekam Studio';
  if (t !== state.title) { state.title = t; api.setTitle(t); }
}

function bindUI() {
  $('#wcMin').addEventListener('click', () => api.win.minimize());
  $('#wcMax').addEventListener('click', () => api.win.toggleMaximize());
  $('#wcClose').addEventListener('click', () => api.win.close());
  $('.titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('.win-controls')) api.win.toggleMaximize(); });

  el.btnRec.addEventListener('click', toggleRecord);
  el.btnPause.addEventListener('click', togglePause);
  el.btnMic.addEventListener('click', toggleMic);

  const setPanel = (open) => document.body.classList.toggle('panel-open', open);
  $('#btnPanel').addEventListener('click', () => setPanel(!document.body.classList.contains('panel-open')));
  $('#scrim').addEventListener('click', () => setPanel(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setPanel(false); });

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
    if (tab.dataset.tab === 'library') refreshFiles();
    if (tab.dataset.tab === 'source' && state.status === 'idle') refreshSources();
  }));

  el.srcType.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    state.sourceType = b.dataset.value;
    $$('button', el.srcType).forEach((x) => x.classList.toggle('active', x === b));
    renderSources();
  });
  el.btnRefresh.addEventListener('click', () => { if (state.status === 'idle') refreshSources(); });

  // Slider: pratinjau langsung saat digeser, disimpan saat dilepas.
  $$('input[type=range][data-setting]').forEach((r) => {
    const key = r.dataset.setting;
    r.addEventListener('input', () => {
      if (state.status !== 'idle') return;
      state.settings[key] = Number(r.value);
      renderSettings();
      applyStyle();
    });
    r.addEventListener('change', () => api.setSettings({ [key]: Number(r.value) }));
  });

  el.bgGrid.addEventListener('click', (e) => {
    const id = e.target.closest('.bg-swatch')?.dataset.bg;
    if (!id) return;
    if (id === 'custom' && !state.bgImage) chooseBackgroundImage();
    else setSetting('background', id);
  });
  el.btnBgImage.addEventListener('click', chooseBackgroundImage);

  $$('[data-setting]:not([type=range])').forEach((input) => input.addEventListener('change', () => {
    setSetting(input.dataset.setting, input.type === 'checkbox' ? input.checked : input.value);
    if (input === el.micSelect) el.micSelect.title = el.micSelect.selectedOptions[0]?.text || '';
  }));
  $$('.seg[data-seg]').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b || b.disabled) return;
    setSetting(seg.dataset.seg, seg.dataset.type === 'number' ? Number(b.dataset.value) : b.dataset.value);
  }));

  $('#btnChooseDir').addEventListener('click', async () => {
    const dir = await api.chooseDir();
    if (!dir) return;
    state.settings.saveDir = dir;
    renderSettings();
    refreshFiles();
    toast('Folder penyimpanan diubah', { text: dir });
  });
  $('#btnOpenDir').addEventListener('click', () => api.openDir());

  el.countdown.addEventListener('click', () => state.cancelCountdown?.());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.status === 'countdown') state.cancelCountdown?.(); });

  navigator.mediaDevices.addEventListener('devicechange', listMics);

  api.on('shortcut', (action) => {
    if (action === 'toggle') toggleRecord();
    else if (action === 'pause') togglePause();
    else if (action === 'stop-and-close') {
      state.closeAfterStop = true;
      if (state.status === 'countdown') state.cancelCountdown?.();
      if (state.status === 'idle') api.win.closeNow();
      else if (isActive()) stopRecording();
    }
  });
  api.on('win:state', ({ maximized }) => document.body.classList.toggle('maximized', maximized));
}

async function init() {
  const [settings, info] = await Promise.all([api.getSettings(), api.getInfo()]);
  state.settings = settings;
  $('#aboutName').textContent = `${info.name} v${info.version}`;
  $('#aboutMeta').textContent = `Dikembangkan oleh ${info.author}`;
  if (settings.bgImage) {
    const dataUrl = await api.loadBackground();
    if (dataUrl) await loadBackgroundImage(dataUrl).catch(() => {});
  }
  if (settings.background === 'custom' && !state.bgImage) settings.background = 'sky';
  renderBackgrounds();
  bindUI();
  renderSettings();
  updateUI();
  await listMics();
  await refreshSources();
  refreshFiles();
  requestAnimationFrame(frame);
  setInterval(updateTitle, 500);
}

init();
