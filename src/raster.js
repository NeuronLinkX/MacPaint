// 래스터 프리미티브(JS Paint처럼 안티앨리어싱 없는 픽셀 그래픽).
// 브러시 모양(원·사각·/·\)은 "스탬프"를 선 위에 찍어서 만든다. 모든 함수는 결정적이다.
import { Bitmap, TRANSPARENT, rgba } from "./bitmap.js";

// ── 스탬프 ───────────────────────────────────────────
const stampCache = new Map();
export function makeStamp(shape = "circle", size = 1) {
  size = Math.max(1, Math.round(size));
  const key = `${shape}${size}`;
  if (stampCache.has(key)) return stampCache.get(key);
  const pts = [], o = (size - 1) / 2, c = Math.floor(size / 2), r2 = (size / 2) * (size / 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let on;
    if (shape === "circle") on = (x - o) ** 2 + (y - o) ** 2 <= r2;
    else if (shape === "square") on = true;
    else if (shape === "slash") on = x + y === size - 1;
    else if (shape === "backslash") on = x === y;
    else throw new Error(`브러시 모양 오류: ${shape}`);
    if (on) pts.push([x - c, y - c]);
  }
  const stamp = { shape, size, pts };
  stampCache.set(key, stamp);
  return stamp;
}
export const plot = (bm, x, y, c, stamp) => { for (const [dx, dy] of stamp.pts) bm.set(x + dx, y + dy, c); };

// ── 선 ────────────────────────────────────────────────
export function line(bm, x0, y0, x1, y1, c, stamp) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(bm, x0, y0, c, stamp);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
export function polyline(bm, pts, c, stamp, closed = false) {
  if (!pts.length) return;
  if (pts.length === 1) { plot(bm, Math.round(pts[0][0]), Math.round(pts[0][1]), c, stamp); return; }
  for (let i = 0; i + 1 < pts.length; i++) line(bm, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, stamp);
  if (closed) line(bm, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], c, stamp);
}
// 자유 곡선(연필·브러시·지우개): fromIndex 이후 구간만 이어 그린다(증분 그리기 = 전체 재생과 같은 결과).
export function freehand(bm, pts, c, stamp, fromIndex = 0) {
  if (pts.length === 1 && fromIndex === 0) { plot(bm, Math.round(pts[0][0]), Math.round(pts[0][1]), c, stamp); return; }
  for (let i = Math.max(1, fromIndex); i < pts.length; i++) line(bm, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], c, stamp);
}

// ── 채우기 ────────────────────────────────────────────
// 짝수-홀수 규칙 스캔라인. 정수 좌표 = 픽셀 중심. 왼쪽/위 경계는 포함, 오른쪽/아래 경계는 제외(반열림).
export function fillPolygon(bm, pts, c) {
  if (pts.length < 3) return;
  const ys = pts.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(bm.h - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const yc = y, xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k])), xb = Math.min(bm.w - 1, Math.ceil(xs[k + 1]) - 1);
      for (let x = xa; x <= xb; x++) bm.px[y * bm.w + x] = c;
    }
  }
}

// tol(0~255): 비슷한 색까지 채운다(GIMP의 "임계값"). 0이면 같은 색만.
function floodFillTol(bm, x, y, c, tol) {
  const t = bm.px[y * bm.w + x], seen = new Uint8Array(bm.px.length), stack = [y * bm.w + x];
  const near = (v) => { for (const s of [0, 8, 16, 24]) if (Math.abs(((v >>> s) & 255) - ((t >>> s) & 255)) > tol) return false; return true; };
  let n = 0;
  while (stack.length) {
    const i = stack.pop(); if (seen[i]) continue; seen[i] = 1; if (!near(bm.px[i])) continue;
    bm.px[i] = c; n++; const px = i % bm.w;
    if (px > 0) stack.push(i - 1); if (px < bm.w - 1) stack.push(i + 1); if (i >= bm.w) stack.push(i - bm.w); if (i < bm.px.length - bm.w) stack.push(i + bm.w);
  }
  return n;
}
export function floodFill(bm, x, y, c, tol = 0) {
  x = Math.round(x); y = Math.round(y);
  if (!bm.inside(x, y)) return 0;
  if (tol > 0) return floodFillTol(bm, x, y, c, tol);
  const target = bm.px[y * bm.w + x];
  if (target === c) return 0;
  const stack = [[x, y]]; let n = 0;
  while (stack.length) {
    const [sx, sy] = stack.pop();
    if (bm.px[sy * bm.w + sx] !== target) continue;
    let l = sx, r = sx;
    while (l > 0 && bm.px[sy * bm.w + l - 1] === target) l--;
    while (r < bm.w - 1 && bm.px[sy * bm.w + r + 1] === target) r++;
    for (let i = l; i <= r; i++) bm.px[sy * bm.w + i] = c;
    n += r - l + 1;
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= bm.h) continue;
      let inRun = false;
      for (let i = l; i <= r; i++) {
        const hit = bm.px[ny * bm.w + i] === target;
        if (hit && !inRun) stack.push([i, ny]);
        inRun = hit;
      }
    }
  }
  return n;
}

// ── 도형 경로 ─────────────────────────────────────────
export const boxOf = (a, b) => { const l = Math.min(a[0], b[0]), t = Math.min(a[1], b[1]); return { l: Math.round(l), t: Math.round(t), r: Math.round(Math.max(a[0], b[0])), b: Math.round(Math.max(a[1], b[1])) }; };

export function ellipsePath(bx, grow = 0) {
  const cx = (bx.l + bx.r) / 2, cy = (bx.t + bx.b) / 2, rx = (bx.r - bx.l) / 2 + grow, ry = (bx.b - bx.t) / 2 + grow;
  const n = Math.max(24, Math.ceil(Math.max(rx, ry) * 6)), out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
  return out;
}
export function rectPath(bx, grow = 0) {
  return [[bx.l - grow, bx.t - grow], [bx.r + grow, bx.t - grow], [bx.r + grow, bx.b + grow], [bx.l - grow, bx.b + grow]];
}
export function roundRectPath(bx, grow = 0, radius = 10) {
  const l = bx.l - grow, t = bx.t - grow, r = bx.r + grow, b = bx.b + grow;
  const rad = Math.max(0, Math.min(radius, (r - l) / 2, (b - t) / 2)), out = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= 8; i++) { const a = a0 + (i / 8) * (Math.PI / 2); out.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]); } };
  corner(r - rad, t + rad, -Math.PI / 2); corner(r - rad, b - rad, 0); corner(l + rad, b - rad, Math.PI / 2); corner(l + rad, t + rad, Math.PI);
  return out;
}
// 베지어(곡선 도구): pts = [시작, 끝, 제어점1?, 제어점2?]
export function bezierPath(pts) {
  const [p0, p3, c1, c2] = pts;
  if (!c1) return [p0, p3];
  const q1 = c1, q2 = c2 || c1, steps = Math.max(8, Math.ceil((dist(p0, c1) + dist(c1, q2) + dist(q2, p3)) / 2)), out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * q1[0] + 3 * u * t * t * q2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * q1[1] + 3 * u * t * t * q2[1] + t * t * t * p3[1]]);
  }
  return out;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ── 에어브러시(시드 난수: 같은 점열이면 같은 점무늬) ───────────
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function spray(bm, x, y, size, c, rng) {
  // XP 그림판처럼: 반지름 r인 원 안에 고르게(√난수) 한 픽셀 점을 흩뿌린다. 한 번에 뿌리는 양은 면적에 비례(약 5%)
  const r = Math.max(1, size), dots = Math.max(3, Math.round(Math.PI * r * r * 0.05));
  for (let i = 0; i < dots; i++) {
    const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * r;
    bm.set(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), c);
  }
}

// ── 변형(새 Bitmap 반환) ──────────────────────────────
export function flipH(bm) { const o = new Bitmap(bm.w, bm.h, 0); for (let y = 0; y < bm.h; y++) for (let x = 0; x < bm.w; x++) o.px[y * bm.w + (bm.w - 1 - x)] = bm.px[y * bm.w + x]; return o; }
export function flipV(bm) { const o = new Bitmap(bm.w, bm.h, 0); for (let y = 0; y < bm.h; y++) o.px.set(bm.px.subarray(y * bm.w, (y + 1) * bm.w), (bm.h - 1 - y) * bm.w); return o; }
export function rotate(bm, deg) {
  deg = ((deg % 360) + 360) % 360;
  if (deg === 0) return bm.clone();
  if (deg === 180) return flipV(flipH(bm));
  const o = new Bitmap(bm.h, bm.w, 0);
  for (let y = 0; y < bm.h; y++) for (let x = 0; x < bm.w; x++) {
    const [nx, ny] = deg === 90 ? [bm.h - 1 - y, x] : [y, bm.w - 1 - x];
    o.px[ny * o.w + nx] = bm.px[y * bm.w + x];
  }
  return o;
}
export function resize(bm, w, h) {                       // 최근접 이웃 확대·축소
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const o = new Bitmap(w, h, 0);
  for (let y = 0; y < h; y++) { const sy = Math.min(bm.h - 1, Math.floor(((y + 0.5) * bm.h) / h)); for (let x = 0; x < w; x++) o.px[y * w + x] = bm.px[sy * bm.w + Math.min(bm.w - 1, Math.floor(((x + 0.5) * bm.w) / w))]; }
  return o;
}
export const stretch = (bm, pctX, pctY) => resize(bm, (bm.w * pctX) / 100, (bm.h * pctY) / 100);
export function skew(bm, degX, degY, fill = TRANSPARENT) {
  let cur = bm;
  if (degX) {
    const t = Math.tan((degX * Math.PI) / 180), dx = (y) => Math.round(t * y), last = dx(cur.h - 1), lo = Math.min(0, last), hi = Math.max(0, last);
    const o = new Bitmap(cur.w + hi - lo, cur.h, fill);
    for (let y = 0; y < cur.h; y++) for (let x = 0; x < cur.w; x++) o.px[y * o.w + x + dx(y) - lo] = cur.px[y * cur.w + x];
    cur = o;
  }
  if (degY) {
    const t = Math.tan((degY * Math.PI) / 180), dy = (x) => Math.round(t * x), last = dy(cur.w - 1), lo = Math.min(0, last), hi = Math.max(0, last);
    const o = new Bitmap(cur.w, cur.h + hi - lo, fill);
    for (let y = 0; y < cur.h; y++) for (let x = 0; x < cur.w; x++) o.px[(y + dy(x) - lo) * o.w + x] = cur.px[y * cur.w + x];
    cur = o;
  }
  return cur === bm ? bm.clone() : cur;
}
export function invert(bm) {
  const o = bm.clone();
  for (let i = 0; i < o.px.length; i++) { const c = o.px[i]; if (c >>> 24) o.px[i] = rgba(255 - (c & 255), 255 - ((c >>> 8) & 255), 255 - ((c >>> 16) & 255), c >>> 24); }
  return o;
}
