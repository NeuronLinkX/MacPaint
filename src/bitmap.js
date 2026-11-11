// 순수 JS 비트맵: 픽셀을 직접 다룬다(Canvas·DOM 없음). Node에서 픽셀 단위로 검증할 수 있고,
// host·screen·폰 어디서나 같은 연산이 같은 결과를 낸다(리플레이·미러의 전제).
// 픽셀은 Uint32 한 칸 = RGBA 4바이트(리틀 엔디언이면 0xAABBGGRR).

export const rgba = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
export const TRANSPARENT = 0;
export const WHITE = rgba(255, 255, 255);
export const BLACK = rgba(0, 0, 0);

export function parseColor(s) {
  if (typeof s === "number") return s >>> 0;
  if (!s || s === "transparent") return TRANSPARENT;
  let h = String(s).trim().replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) throw new Error(`색 형식 오류: ${s}`);
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return rgba(n(0), n(2), n(4), h.length === 8 ? n(6) : 255);
}
export function toCss(c) {
  if ((c >>> 24) === 0) return "transparent";
  const h = (v) => v.toString(16).padStart(2, "0");
  return `#${h(c & 255)}${h((c >>> 8) & 255)}${h((c >>> 16) & 255)}`;
}

export class Bitmap {
  constructor(w, h, fill = WHITE) {
    this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0);
    this.px = new Uint32Array(this.w * this.h);
    if (fill) this.px.fill(fill);
  }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inside(x, y) ? this.px[y * this.w + x] : 0; }
  set(x, y, c) { if (this.inside(x, y)) this.px[y * this.w + x] = c; }
  clone() { const b = new Bitmap(this.w, this.h, 0); b.px.set(this.px); return b; }
  equals(o) { if (this.w !== o.w || this.h !== o.h) return false; for (let i = 0; i < this.px.length; i++) if (this.px[i] !== o.px[i]) return false; return true; }
  isUniform(c) { for (let i = 0; i < this.px.length; i++) if (this.px[i] !== c) return false; return true; }
  fillRect(x, y, w, h, c) {
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.w, x + w), y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) this.px.fill(c, yy * this.w + x0, yy * this.w + x1);
  }
  crop(x, y, w, h, outside = 0) {
    const out = new Bitmap(w, h, outside);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (this.inside(x + xx, y + yy)) out.px[yy * w + xx] = this.px[(y + yy) * this.w + x + xx];
    return out;
  }
  // src를 (dx,dy)에 덮어쓴다. 투명(알파 0) 픽셀은 건너뛰고, skipColor가 있으면 그 색도 건너뛴다.
  blit(src, dx, dy, skipColor = null) {
    for (let y = 0; y < src.h; y++) {
      const ty = dy + y; if (ty < 0 || ty >= this.h) continue;
      for (let x = 0; x < src.w; x++) {
        const tx = dx + x; if (tx < 0 || tx >= this.w) continue;
        const c = src.px[y * src.w + x];
        if ((c >>> 24) === 0 || c === skipColor) continue;
        this.px[ty * this.w + tx] = c;
      }
    }
  }
  // Canvas ImageData 용 바이트 뷰(복사 없음)
  bytes() { return new Uint8ClampedArray(this.px.buffer); }
  static fromBytes(w, h, u8) { const b = new Bitmap(w, h, 0); new Uint8Array(b.px.buffer).set(u8); return b; }
}

// 직렬화(붙여넣기·저장용): 픽셀 바이트 → base64
export function toBase64(bm) {
  const u8 = new Uint8Array(bm.px.buffer); let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(w, h, b64) {
  const s = atob(b64), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return Bitmap.fromBytes(w, h, u8);
}
