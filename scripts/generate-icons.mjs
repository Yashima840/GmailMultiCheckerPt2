// 拡張機能アイコン(封筒マーク)をPNGで生成する。依存パッケージ無し(node標準のみ)。
// 使い方: node scripts/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const RED = [217, 48, 37];
const WHITE = [255, 255, 255];

// ---- PNGエンコーダ ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: None
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- 描画(座標は0..1に正規化、スーパーサンプリングで滑らかに) ----
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function inRoundedRect(x, y, x1, y1, x2, y2, r) {
  if (x < x1 || x > x2 || y < y1 || y > y2) return false;
  const cx = Math.max(x1 + r, Math.min(x2 - r, x));
  const cy = Math.max(y1 + r, Math.min(y2 - r, y));
  return Math.hypot(x - cx, y - cy) <= r;
}

// 1サンプルの色を返す: null=透明
function sample(x, y) {
  if (!inRoundedRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.22)) return null;
  const ex1 = 0.18, ey1 = 0.30, ex2 = 0.82, ey2 = 0.72;
  if (inRoundedRect(x, y, ex1, ey1, ex2, ey2, 0.04)) {
    // 封筒のフラップ(V字)は背景色で描く
    const apexX = 0.5, apexY = 0.56, w = 0.045;
    if (
      distToSegment(x, y, ex1, ey1, apexX, apexY) < w ||
      distToSegment(x, y, ex2, ey1, apexX, apexY) < w
    ) return RED;
    return WHITE;
  }
  return RED;
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4; // スーパーサンプリング倍率
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      if (a > 0) {
        // 透明部分と混ざる画素は不透明画素の平均色にする(縁の暗ずみ防止)
        const cnt = a / 255;
        rgba[i] = Math.round(r / cnt);
        rgba[i + 1] = Math.round(g / cnt);
        rgba[i + 2] = Math.round(b / cnt);
        rgba[i + 3] = Math.round(a / n);
      }
    }
  }
  return encodePng(size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, drawIcon(size));
  console.log(`generated ${file}`);
}
