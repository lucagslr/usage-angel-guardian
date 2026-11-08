/** Encodeur PNG minimal (RGBA) pour l'icône dynamique de la zone de notification. */
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Jauge circulaire : anneau gris, arc coloré proportionnel à `fraction` (0–1),
 * pastille centrale de la couleur du statut. Anti-crénelage simple par suréchantillonnage.
 */
export function gaugeIcon(size: number, fraction: number | null, color: string, track = '#8a8a8a'): Buffer {
  const px = new Uint8Array(size * size * 4);
  const [cr, cg, cb] = hex(color);
  const [tr, tg, tb] = hex(track);
  const c = size / 2;
  const rOut = size / 2 - 0.5;
  const rIn = rOut - size * 0.2;
  const rDot = size * 0.18;
  const f = fraction === null ? 0 : Math.max(0, Math.min(1, fraction));
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const dx = x + (sx + 0.5) / S - c;
        const dy = y + (sy + 0.5) / S - c;
        const d = Math.hypot(dx, dy);
        let col: [number, number, number] | null = null;
        if (d <= rOut && d >= rIn) {
          const ang = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1; // 0 en haut, sens horaire
          col = ang <= f ? [cr, cg, cb] : [tr, tg, tb];
        } else if (d <= rDot) col = [cr, cg, cb];
        if (col) { a++; r += col[0]; g += col[1]; b += col[2]; }
      }
      const i = (y * size + x) * 4;
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; px[i + 3] = Math.round((a / (S * S)) * 255); }
    }
  }
  return encodePng(size, size, px);
}
