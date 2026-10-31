'use strict';

// Membuat build/icon.png (512×512) tanpa dependensi: kotak membulat gelap + cincin + titik rekam merah.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 512;
const C = S / 2;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const clamp = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a + (b - a) * t;
const cover = (d) => clamp(0.5 - d); // anti-alias dari signed distance (piksel)

function roundRect(x, y, half, r) {
  const qx = Math.abs(x - C) - half + r;
  const qy = Math.abs(y - C) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  const row = y * (S * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < S; x++) {
    const px = x + 0.5;
    const py = y + 0.5;
    const t = py / S;

    // Latar
    let r = mix(38, 14, t);
    let g = mix(43, 16, t);
    let b = mix(58, 22, t);
    const alpha = cover(roundRect(px, py, 236, 116));

    const dist = Math.hypot(px - C, py - C);

    // Cincin
    const ring = cover(Math.abs(dist - 138) - 11) * 0.92;
    r = mix(r, 232, ring); g = mix(g, 235, ring); b = mix(b, 242, ring);

    // Titik merah dengan gradasi
    const dot = cover(dist - 86);
    const dt = clamp((py - (C - 86)) / 172);
    r = mix(r, mix(255, 226, dt), dot);
    g = mix(g, mix(96, 34, dt), dot);
    b = mix(b, mix(112, 56, dt), dot);

    const o = row + 1 + x * 4;
    raw[o] = Math.round(r);
    raw[o + 1] = Math.round(g);
    raw[o + 2] = Math.round(b);
    raw[o + 3] = Math.round(alpha * 255);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('Ikon dibuat:', out);
