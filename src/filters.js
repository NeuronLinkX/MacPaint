// GIMP식 필터: 비트맵을 제자리에서 고치는 순수 함수(결정적). 알파는 보존한다.
import { Bitmap } from "./bitmap.js";
import { makeRng } from "./raster.js";

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const each = (bm, fn) => { const p = bm.px; for (let i = 0; i < p.length; i++) { const c = p[i], a = c >>> 24; if (!a) continue; const [r, g, b] = fn(c & 255, (c >>> 8) & 255, (c >>> 16) & 255); p[i] = ((a << 24) | (clamp(b) << 16) | (clamp(g) << 8) | clamp(r)) >>> 0; } };
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
function rgb2hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
function hsl2rgb(h, s, l) { if (!s) return [l * 255, l * 255, l * 255]; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, f = (t) => { t = (t + 1) % 1; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); }; return [f(h + 1 / 3), f(h), f(h - 1 / 3)]; }

function boxBlur(bm, r) {                                           // 가로·세로 분리 상자 흐림
  r = Math.round(r); if (r < 1) return; const { w, h } = bm, src = new Uint32Array(bm.px), tmp = new Uint32Array(src.length);
  const pass = (from, to, horiz) => {
    const n = horiz ? w : h, lines = horiz ? h : w, stride = horiz ? 1 : w, step = horiz ? w : 1;
    for (let l = 0; l < lines; l++) {
      const base = l * step;
      for (let i = 0; i < n; i++) {
        let R = 0, G = 0, B = 0, A = 0, cnt = 0;
        for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) { const c = from[base + k * stride], a = c >>> 24; R += (c & 255) * a; G += ((c >>> 8) & 255) * a; B += ((c >>> 16) & 255) * a; A += a; cnt++; }
        to[base + i * stride] = A ? (((A / cnt) << 24) | (clamp(B / A) << 16) | (clamp(G / A) << 8) | clamp(R / A)) >>> 0 : 0;
      }
    }
  };
  pass(src, tmp, true); pass(tmp, bm.px, false);
}
function convolve(bm, k, div = 1, bias = 0) {
  const { w, h } = bm, src = new Uint32Array(bm.px);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let R = 0, G = 0, B = 0, j = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++, j++) { const c = src[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))]; R += (c & 255) * k[j]; G += ((c >>> 8) & 255) * k[j]; B += ((c >>> 16) & 255) * k[j]; }
    const a = src[y * w + x] >>> 24; bm.px[y * w + x] = ((a << 24) | (clamp(B / div + bias) << 16) | (clamp(G / div + bias) << 8) | clamp(R / div + bias)) >>> 0;
  }
}

export const FILTERS = {
  brightnessContrast: { label: "밝기·대비", params: [["brightness", "밝기", -100, 100, 0], ["contrast", "대비", -100, 100, 0]], run(bm, { brightness = 0, contrast = 0 }) { const k = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55)), b = brightness * 2.55; each(bm, (r, g, bl) => [k * (r - 128) + 128 + b, k * (g - 128) + 128 + b, k * (bl - 128) + 128 + b]); } },
  hueSaturation: { label: "색조·채도·명도", params: [["hue", "색조", -180, 180, 0], ["sat", "채도", -100, 100, 0], ["light", "명도", -100, 100, 0]], run(bm, { hue = 0, sat = 0, light = 0 }) { each(bm, (r, g, b) => { let [h, s, l] = rgb2hsl(r, g, b); h = (h + hue / 360 + 1) % 1; s = Math.max(0, Math.min(1, s * (1 + sat / 100))); l = Math.max(0, Math.min(1, l + light / 200)); return hsl2rgb(h, s, l); }); } },
  grayscale: { label: "흑백", params: [], run(bm) { each(bm, (r, g, b) => { const y = lum(r, g, b); return [y, y, y]; }); } },
  sepia: { label: "세피아", params: [], run(bm) { each(bm, (r, g, b) => [0.393 * r + 0.769 * g + 0.189 * b, 0.349 * r + 0.686 * g + 0.168 * b, 0.272 * r + 0.534 * g + 0.131 * b]); } },
  invert: { label: "색 반전", params: [], run(bm) { each(bm, (r, g, b) => [255 - r, 255 - g, 255 - b]); } },
  threshold: { label: "임계값", params: [["level", "기준", 0, 255, 128]], run(bm, { level = 128 }) { each(bm, (r, g, b) => { const v = lum(r, g, b) >= level ? 255 : 0; return [v, v, v]; }); } },
  posterize: { label: "포스터화", params: [["levels", "단계", 2, 16, 4]], run(bm, { levels = 4 }) { const s = 255 / (levels - 1); each(bm, (r, g, b) => [Math.round(r / s) * s, Math.round(g / s) * s, Math.round(b / s) * s]); } },
  blur: { label: "흐림 효과", params: [["radius", "반경", 1, 30, 4]], run(bm, { radius = 4 }) { boxBlur(bm, radius); boxBlur(bm, radius); } },
  sharpen: { label: "선명하게", params: [["amount", "세기", 1, 10, 3]], run(bm, { amount = 3 }) { const a = amount / 3; convolve(bm, [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]); } },
  pixelate: { label: "픽셀화", params: [["size", "블록 크기", 2, 80, 8]], run(bm, { size = 8 }) { const { w, h } = bm; for (let by = 0; by < h; by += size) for (let bx = 0; bx < w; bx += size) { let R = 0, G = 0, B = 0, A = 0, n = 0; const ex = Math.min(w, bx + size), ey = Math.min(h, by + size); for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const c = bm.px[y * w + x], a = c >>> 24; R += (c & 255) * a; G += ((c >>> 8) & 255) * a; B += ((c >>> 16) & 255) * a; A += a; n++; } const c = A ? (((A / n) << 24) | (clamp(B / A) << 16) | (clamp(G / A) << 8) | clamp(R / A)) >>> 0 : 0; for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) bm.px[y * w + x] = c; } } },
  noise: { label: "노이즈 추가", params: [["amount", "세기", 1, 100, 25], ["seed", "무작위 값", 1, 999, 7]], run(bm, { amount = 25, seed = 7 }) { const rng = makeRng(seed); each(bm, (r, g, b) => { const n = (rng() - 0.5) * amount * 2.55 * 2; return [r + n, g + n, b + n]; }); } },
  emboss: { label: "엠보스", params: [], run(bm) { convolve(bm, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 1, 128); } },
  edges: { label: "가장자리 검출", params: [], run(bm) { convolve(bm, [-1, -1, -1, -1, 8, -1, -1, -1, -1], 1, 0); each(bm, (r, g, b) => [255 - r, 255 - g, 255 - b]); } },
  vignette: { label: "비네팅", params: [["amount", "세기", 1, 100, 50]], run(bm, { amount = 50 }) { const { w, h } = bm, cx = w / 2, cy = h / 2, md = Math.hypot(cx, cy); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = bm.px[y * w + x], a = c >>> 24; if (!a) continue; const f = 1 - (Math.hypot(x - cx, y - cy) / md) ** 2 * (amount / 100); bm.px[y * w + x] = ((a << 24) | (clamp(((c >>> 16) & 255) * f) << 16) | (clamp(((c >>> 8) & 255) * f) << 8) | clamp((c & 255) * f)) >>> 0; } } },
};
export const applyFilter = (bm, name, params = {}) => { const f = FILTERS[name]; if (!f) throw new Error(`없는 필터: ${name}`); f.run(bm, params); return bm; };

// 선형·방사형 그라디언트(전경 → 배경). 반환은 채울 비트맵(전체 크기)이고, 호출 쪽에서 선택 영역으로 잘라 쓴다.
export function gradient(bm, a, b, c1, c2, kind = "linear") {
  const { w, h } = bm, dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1, rad = Math.sqrt(len2);
  const ch = (c, s) => (c >>> s) & 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let t = kind === "radial" ? Math.hypot(x - a[0], y - a[1]) / rad : ((x - a[0]) * dx + (y - a[1]) * dy) / len2; t = Math.max(0, Math.min(1, t));
    const m = (s) => Math.round(ch(c1, s) + (ch(c2, s) - ch(c1, s)) * t);
    bm.px[y * w + x] = ((255 << 24) | (m(16) << 16) | (m(8) << 8) | m(0)) >>> 0;
  }
}
// 쌍선형 크기 조정
export function scaleBitmap(src, nw, nh) {
  const out = new Bitmap(nw, nh, 0), sx = src.w / nw, sy = src.h / nh;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const fx = Math.max(0, (x + 0.5) * sx - 0.5), fy = Math.max(0, (y + 0.5) * sy - 0.5), x0 = Math.min(src.w - 1, Math.floor(fx)), y0 = Math.min(src.h - 1, Math.floor(fy)), x1 = Math.min(src.w - 1, x0 + 1), y1 = Math.min(src.h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const P = [src.px[y0 * src.w + x0], src.px[y0 * src.w + x1], src.px[y1 * src.w + x0], src.px[y1 * src.w + x1]], W = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    let A = 0, R = 0, G = 0, B = 0; P.forEach((c, i) => { const a = c >>> 24; A += a * W[i]; R += (c & 255) * a * W[i]; G += ((c >>> 8) & 255) * a * W[i]; B += ((c >>> 16) & 255) * a * W[i]; });
    out.px[y * nw + x] = A ? ((Math.round(A) << 24) | (clamp(B / A) << 16) | (clamp(G / A) << 8) | clamp(R / A)) >>> 0 : 0;
  }
  return out;
}
