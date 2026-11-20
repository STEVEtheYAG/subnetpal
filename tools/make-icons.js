// Generates the PNG icons with no dependencies. Run: node tools/make-icons.js
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Motif: a binary split (VLSM) - one bar, two halves, four quarters - on a dark square. Kept inside the central 60% (maskable safe zone).
const BG = [15, 20, 25];
const X0 = 0.2, W = 0.6, H = 0.095, GAP = 0.02, Y0 = 0.3;
const COLORS = [[74, 163, 255], [62, 207, 142], [245, 185, 66], [180, 140, 255], [255, 107, 140], [90, 220, 230], [250, 220, 90]];
const bars = [];
let ci = 0;
[1, 2, 4].forEach((n, row) => {
  const w = (W - GAP * (n - 1)) / n;
  for (let i = 0; i < n; i++) bars.push({ x: X0 + i * (w + GAP), y: Y0 + row * (H + GAP), w, h: H, c: COLORS[ci++ % COLORS.length] });
});
function pixel(u, v) {
  for (const b of bars) if (u >= b.x && u < b.x + b.w && v >= b.y && v < b.y + b.h) return b.c;
  return BG;
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
[['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]].forEach(([f, s]) => {
  fs.writeFileSync(path.join(dir, f), png(s, pixel));
  console.log('wrote icons/' + f);
});
