// 연산(op): 그림에 일어나는 모든 변화를 JSON으로 기록한다. applyOp는 결정적이라
// 같은 연산열을 어디서 재생해도 같은 그림이 나온다(스크린 미러·리플레이·히스토리 이동의 기반).
// 좌표는 논리 픽셀 정수/실수, 색은 CSS 문자열("#rrggbb"|"transparent").
import { Bitmap, TRANSPARENT, fromBase64, parseColor } from "./bitmap.js";
import * as R from "./raster.js";
import { applyFilter, gradient, scaleBitmap } from "./filters.js";
import { Stack } from "./layers.js";

export const FREEHAND = new Set(["pencil", "brush", "eraser", "airbrush"]);
export const SHAPES = new Set(["rect", "roundrect", "ellipse", "polygon"]);

export const LABELS = {
  pencil: "연필", brush: "브러시", eraser: "지우개", airbrush: "에어브러시", line: "직선", curve: "곡선",
  rect: "사각형", roundrect: "둥근 사각형", ellipse: "타원", polygon: "다각형", fill: "채우기", text: "텍스트",
  clear: "이미지 지우기", filter: "필터", gradient: "그라디언트", scale: "이미지 크기 조정", crop: "선택 영역으로 자르기", open: "이미지 열기", sel_move: "선택 이동", sel_delete: "선택 삭제", paste: "붙여넣기", attributes: "이미지 속성",
  xform: "변형",
  layer_add: "새 레이어", layer_del: "레이어 삭제", layer_dup: "레이어 복제", layer_move: "레이어 순서", layer_vis: "레이어 표시", layer_opa: "레이어 불투명도", layer_name: "레이어 이름", layer_merge: "아래로 병합", layer_flat: "이미지 병합", layer_from: "객체 추가", layer_off: "객체 이동",
};
export const labelOf = (op) => (op.t === "xform" ? { flipH: "좌우 대칭", flipV: "상하 대칭", rotate: "회전", stretch: "늘이기", skew: "기울이기", invert: "색 반전", resize: "선택 크기 조절" }[op.kind] || LABELS.xform : LABELS[op.t] || op.t);

// ── 선택 영역 ─────────────────────────────────────────
// sel = {x,y,w,h, poly?:[[x,y]…]}  poly가 있으면 자유형(마스크), 없으면 사각형.
// 반투명 픽셀(안티앨리어싱)을 배경과 섞어 올린다. 불투명 픽셀은 그대로 덮는다.
function blendBlit(dst, src, dx, dy) {
  for (let y = 0; y < src.h; y++) {
    const ty = dy + y; if (ty < 0 || ty >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const tx = dx + x; if (tx < 0 || tx >= dst.w) continue;
      const c = src.px[y * src.w + x], a = c >>> 24; if (!a) continue;
      const i = ty * dst.w + tx, d = dst.px[i];
      if (a === 255 || (d >>> 24) === 0) { dst.px[i] = c; continue; }
      const m = (s, t) => Math.round((s * a + t * (255 - a)) / 255);
      dst.px[i] = (255 << 24 | m((c >>> 16) & 255, (d >>> 16) & 255) << 16 | m((c >>> 8) & 255, (d >>> 8) & 255) << 8 | m(c & 255, d & 255)) >>> 0;
    }
  }
}

export function selMask(sel) {
  if (!sel.poly) return null;
  const m = new Bitmap(sel.w, sel.h, 0);
  R.fillPolygon(m, sel.poly.map(([x, y]) => [x - sel.x, y - sel.y]), 1);
  return m;
}
export function extract(bm, sel) {
  const out = bm.crop(sel.x, sel.y, sel.w, sel.h, 0), m = selMask(sel);
  if (m) for (let i = 0; i < out.px.length; i++) if (!m.px[i]) out.px[i] = 0;
  return out;
}
export function eraseRegion(bm, sel, color) {
  const m = selMask(sel);
  for (let y = 0; y < sel.h; y++) for (let x = 0; x < sel.w; x++) if (!m || m.px[y * sel.w + x]) bm.set(sel.x + x, sel.y + y, color);
}
export const moveSel = (sel, dx, dy) => ({ ...sel, x: sel.x + dx, y: sel.y + dy, ...(sel.poly ? { poly: sel.poly.map(([x, y]) => [x + dx, y + dy]) } : {}) });
export function normalizeSel(a, b, W, H) {                    // 드래그 두 점 → 캔버스 안 사각형
  const l = Math.max(0, Math.min(a[0], b[0])), t = Math.max(0, Math.min(a[1], b[1]));
  const r = Math.min(W, Math.max(a[0], b[0])), bt = Math.min(H, Math.max(a[1], b[1]));
  const w = Math.round(r - l), h = Math.round(bt - t);
  return w > 0 && h > 0 ? { x: Math.round(l), y: Math.round(t), w, h } : null;
}
export function selFromPolygon(pts, W, H) {
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const l = Math.max(0, Math.floor(Math.min(...xs))), t = Math.max(0, Math.floor(Math.min(...ys)));
  const r = Math.min(W, Math.ceil(Math.max(...xs))), b = Math.min(H, Math.ceil(Math.max(...ys)));
  return r > l && b > t ? { x: l, y: t, w: r - l, h: b - t, poly: pts.map(([x, y]) => [Math.round(x), Math.round(y)]) } : null;
}

// ── 연산 적용 ─────────────────────────────────────────
// bm을 직접 고치거나(같은 크기) 새 Bitmap을 돌려준다. 반환 {bm, sel}: sel은 연산 뒤의 선택 영역(없으면 null).
export function applyOp(state, op, env = {}) { return state instanceof Stack ? state.apply(op, env) : applyBitmapOp(state, op, env); }
export function applyBitmapOp(bm, op, env = {}) {
  const color = (k) => parseColor(op[k]);
  switch (op.t) {
    case "pencil": R.freehand(bm, op.pts, color("c"), R.makeStamp("circle", 1), op.from || 0); break;
    case "brush": R.freehand(bm, op.pts, color("c"), R.makeStamp(op.shape || "circle", op.size || 4), op.from || 0); break;
    case "eraser": R.freehand(bm, op.pts, color("c"), R.makeStamp("square", op.size || 8), op.from || 0); break;
    case "airbrush": {
      const rng = env.rng || R.makeRng(op.seed || 1);
      for (const [x, y] of op.pts) R.spray(bm, x, y, op.size || 8, color("c"), rng);
      break;
    }
    case "line": R.line(bm, op.a[0], op.a[1], op.b[0], op.b[1], color("c"), R.makeStamp("circle", op.w || 1)); break;
    case "curve": R.polyline(bm, R.bezierPath(op.pts), color("c"), R.makeStamp("circle", op.w || 1)); break;
    case "rect": case "roundrect": case "ellipse": case "polygon": drawShape(bm, op); break;
    case "fill": {
      if (!op.sel) { R.floodFill(bm, op.p[0], op.p[1], color("c"), op.tol || 0); break; }
      const s = op.sel, m = selMask(s), sub = bm.crop(s.x, s.y, s.w, s.h, 0);          // 선택 영역이 있으면 그 안에서만 채운다(바깥은 건드리지 않음)
      const px = op.p[0] - s.x, py = op.p[1] - s.y;
      if (px < 0 || py < 0 || px >= s.w || py >= s.h || (m && !m.px[py * s.w + px])) return { bm, sel: op.sel };
      if (m) for (let i = 0; i < sub.px.length; i++) if (!m.px[i]) sub.px[i] = 0x00fe00fe;   // 마스크 밖은 채움이 번지지 않게 막는 표식 색
      const keep = sub.px.slice(); R.floodFill(sub, px, py, color("c"), op.tol || 0);
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const i = y * s.w + x; if ((!m || m.px[i]) && sub.px[i] !== keep[i]) bm.set(s.x + x, s.y + y, sub.px[i]); }
      return { bm, sel: op.sel };                                                    // 채운 뒤에도 선택은 유지
    }
    case "filter": { // 선택 영역(없으면 전체)에만 필터를 적용
      const sel = op.sel || { x: 0, y: 0, w: bm.w, h: bm.h }, sub = bm.crop(sel.x, sel.y, sel.w, sel.h, 0); applyFilter(sub, op.name, op.params || {});
      const m = op.sel ? selMask(op.sel) : null;
      for (let y = 0; y < sel.h; y++) for (let x = 0; x < sel.w; x++) if (!m || m.px[y * sel.w + x]) bm.set(sel.x + x, sel.y + y, sub.px[y * sel.w + x]);
      return { bm, sel: op.sel || null };
    }
    case "gradient": {
      const sel = op.sel || { x: 0, y: 0, w: bm.w, h: bm.h }, g = new Bitmap(bm.w, bm.h, 0); gradient(g, op.a, op.b, color("c1"), color("c2"), op.kind); const m = op.sel ? selMask(op.sel) : null;
      for (let y = 0; y < sel.h; y++) for (let x = 0; x < sel.w; x++) if (!m || m.px[y * sel.w + x]) bm.set(sel.x + x, sel.y + y, g.px[(sel.y + y) * bm.w + sel.x + x]);
      return { bm, sel: op.sel || null };
    }
    case "scale": return { bm: scaleBitmap(bm, Math.max(1, op.w | 0), Math.max(1, op.h | 0)), sel: null };
    case "crop": return { bm: bm.crop(op.sel.x, op.sel.y, op.sel.w, op.sel.h, 0), sel: null };
    case "open": return { bm: fromBase64(op.w, op.h, op.data), sel: null };
    case "text": {
      const t = env.rasterText ? env.rasterText(op) : null, { x, y, w, h } = op.box;
      if (op.opaque) bm.fillRect(x, y, w, h, color("bg"));
      if (t) blendBlit(bm, t, x, y);
      return { bm, sel: null };
    }
    case "clear": bm.px.fill(color("c")); break;
    case "attributes": { const nb = new Bitmap(op.w, op.h, color("bg")); nb.blit(bm, 0, 0); return { bm: nb, sel: null }; }
    case "sel_delete": eraseRegion(bm, op.sel, color("bg")); return { bm, sel: null };
    case "sel_move": {
      const content = extract(bm, op.sel);
      if (!op.copy) eraseRegion(bm, op.sel, color("bg"));
      bm.blit(content, op.sel.x + op.dx, op.sel.y + op.dy, op.tr ? color("bg") : null);
      return { bm, sel: moveSel(op.sel, op.dx, op.dy) };
    }
    case "paste": {
      bm.blit(fromBase64(op.w, op.h, op.data), op.x, op.y, op.tr ? color("bg") : null);
      return { bm, sel: { x: op.x, y: op.y, w: op.w, h: op.h } };
    }
    case "xform": return xform(bm, op);
    default: throw new Error(`알 수 없는 연산: ${op.t}`);
  }
  return { bm, sel: null };
}

function drawShape(bm, op) {
  const style = op.style || "outline", stroke = parseColor(op.c), fill = parseColor(op.fill ?? op.c), st = R.makeStamp("circle", op.w || 1);
  let path, fillPath;
  if (op.t === "polygon") path = fillPath = op.pts;
  else {
    const bx = R.boxOf(op.a, op.b), mk = { rect: R.rectPath, ellipse: R.ellipsePath, roundrect: (b, g) => R.roundRectPath(b, g, op.r ?? 10) }[op.t];
    path = mk(bx, 0); fillPath = mk(bx, 0.5);
  }
  if (style !== "outline") R.fillPolygon(bm, fillPath, fill);
  if (style !== "fill") R.polyline(bm, path, stroke, st, !op.open);
}

function xform(bm, op) {
  const { kind, a, b } = op, bg = parseColor(op.bg ?? "#ffffff");
  const run = (src, fillColor) => ({ flipH: () => R.flipH(src), flipV: () => R.flipV(src), rotate: () => R.rotate(src, a), stretch: () => R.stretch(src, a, b), skew: () => R.skew(src, a, b, fillColor), invert: () => R.invert(src) })[kind]();
  if (!op.sel) return { bm: run(bm, bg), sel: null };         // 선택이 없으면 이미지 전체
  const sel = op.sel, content = extract(bm, sel);
  eraseRegion(bm, sel, bg);
  const t = kind === "resize" ? R.resize(content, op.to.w, op.to.h) : run(content, TRANSPARENT);
  const x = kind === "resize" ? op.to.x : sel.x, y = kind === "resize" ? op.to.y : sel.y;
  bm.blit(t, x, y, op.tr ? bg : null);
  return { bm, sel: { x, y, w: t.w, h: t.h } };               // 변형 뒤 자유형 선택은 사각형이 된다
}

// 자유 그리기 증분: 점이 하나 늘 때마다 새 구간만 그린다(전체 재생과 같은 결과). 에어브러시는 난수열을 이어 간다.
export function beginLive(bm, head, p) {
  const live = { op: { ...head, pts: [p] }, bm: bm.clone(), rng: head.t === "airbrush" ? R.makeRng(head.seed || 1) : null };
  stepLive(live, 0); return live;
}
export function stepLive(live, i) {
  const { op, bm, rng } = live;
  applyOp(bm, op.t === "airbrush" ? { ...op, pts: [op.pts[i]] } : { ...op, from: i }, { rng });
}

// 연산열을 비트맵에 순서대로 적용
export function replay(bm, ops, env) { let cur = bm; for (const op of ops) cur = applyOp(cur, op, env).bm; return cur; }

// 리플레이 진행도: 점이 있는 연산은 점 개수만큼, 나머지는 1로 센다. 마지막 연산은 일부 점만 남긴다.
export function opsUpTo(ops, progress) {
  const weight = (o) => (o.pts && FREEHAND.has(o.t) ? Math.max(1, o.pts.length) : 1);
  const total = ops.reduce((n, o) => n + weight(o), 0);
  let budget = Math.round(total * Math.min(1, Math.max(0, progress))); const out = [];
  for (const o of ops) {
    const w = weight(o);
    if (budget <= 0) break;
    if (budget >= w) { out.push(o); budget -= w; continue; }
    if (o.pts && FREEHAND.has(o.t)) out.push({ ...o, pts: o.pts.slice(0, budget) });
    break;
  }
  return out;
}
