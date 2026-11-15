// Writes the PWA PNG icons (no dependencies) so the repo needs no binary files.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function icon(size) {
  const px = (x, y) => {
    const u = x / size, v = y / size;
    const inRect = (x0, y0, x1, y1, r) => {
      if (u < x0 || u > x1 || v < y0 || v > y1) return false;
      const cx = Math.min(Math.max(u, x0 + r), x1 - r), cy = Math.min(Math.max(v, y0 + r), y1 - r);
      return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
    };
    if (inRect(0.44, 0.27, 0.8, 0.8, 0.04)) return inRect(0.465, 0.295, 0.775, 0.775, 0.03) ? [43, 79, 179] : [255, 255, 255]; // back card
    if (inRect(0.2, 0.2, 0.56, 0.73, 0.04)) {
      if (inRect(0.27, 0.3, 0.33, 0.62, 0) || inRect(0.38, 0.3, 0.5, 0.62, 0.05) && !inRect(0.41, 0.34, 0.47, 0.58, 0.03)) return [198, 40, 40]; // "10"
      return [255, 255, 255];
    }
    return [15, 81, 50];
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(px(x, y), y * (size * 3 + 1) + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('client/public', { recursive: true });
for (const s of [192, 512]) writeFileSync(`client/public/icon-${s}.png`, icon(s));
