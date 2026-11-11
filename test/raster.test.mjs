import test from "node:test";
import assert from "node:assert/strict";
import { Bitmap, WHITE, BLACK, parseColor, toCss, rgba, toBase64, fromBase64 } from "../src/bitmap.js";
import * as R from "../src/raster.js";

const blank = (w = 20, h = 20) => new Bitmap(w, h, WHITE);
const count = (bm, c) => bm.px.reduce((n, p) => n + (p === c ? 1 : 0), 0);

test("색 파싱·직렬화", () => {
  assert.equal(parseColor("#f00"), rgba(255, 0, 0)); assert.equal(toCss(parseColor("#191817")), "#191817");
  assert.equal(parseColor("transparent"), 0); assert.throws(() => parseColor("빨강"));
  const b = blank(3, 2); b.set(1, 1, BLACK); assert.ok(fromBase64(3, 2, toBase64(b)).equals(b));
});
test("스탬프: 크기 1은 한 점, 사각은 s×s, 슬래시는 s점", () => {
  assert.equal(R.makeStamp("circle", 1).pts.length, 1); assert.equal(R.makeStamp("square", 4).pts.length, 16);
  assert.equal(R.makeStamp("slash", 5).pts.length, 5); assert.ok(R.makeStamp("circle", 9).pts.length < 81);
});
test("직선(브레젠험): 끝점 포함, 수평선 길이", () => {
  const b = blank(); R.line(b, 2, 3, 12, 3, BLACK, R.makeStamp("circle", 1));
  assert.equal(count(b, BLACK), 11); assert.equal(b.get(2, 3), BLACK); assert.equal(b.get(12, 3), BLACK);
});
test("증분 자유곡선 = 전체 재생", () => {
  const pts = [[1, 1], [8, 5], [15, 2], [4, 17]], st = R.makeStamp("circle", 3);
  const full = blank(); R.freehand(full, pts, BLACK, st);
  const inc = blank(); for (let i = 1; i <= pts.length; i++) R.freehand(inc, pts.slice(0, i), BLACK, st, i - 1);
  assert.ok(inc.equals(full));
});
test("채우기: 닫힌 영역만 칠하고 같은 색이면 무변화", () => {
  const b = blank(); R.polyline(b, [[5, 5], [14, 5], [14, 14], [5, 14]], BLACK, R.makeStamp("circle", 1), true);
  const red = rgba(255, 0, 0);
  const n = R.floodFill(b, 10, 10, red); assert.equal(n, 8 * 8);
  assert.equal(b.get(1, 1), WHITE); assert.equal(R.floodFill(b, 10, 10, red), 0);
});
test("다각형 채우기: 사각형 면적", () => {
  const b = blank(); R.fillPolygon(b, [[2, 2], [12, 2], [12, 7], [2, 7]], BLACK); assert.equal(count(b, BLACK), 10 * 5);
});
test("도형 경로: 타원 채움은 상자 안, 둥근 사각형은 모서리가 비어 있다", () => {
  const b = blank(30, 30), bx = R.boxOf([5, 5], [24, 24]);
  R.fillPolygon(b, R.ellipsePath(bx, 0.5), BLACK); assert.equal(b.get(14, 14), BLACK); assert.equal(b.get(5, 5), WHITE);
  const c = blank(30, 30); R.fillPolygon(c, R.roundRectPath(bx, 0.5, 8), BLACK); assert.equal(c.get(5, 5), WHITE); assert.equal(c.get(14, 5), BLACK);
});
test("곡선: 제어점이 없으면 직선, 있으면 휜다", () => {
  assert.equal(R.bezierPath([[0, 0], [10, 0]]).length, 2);
  const p = R.bezierPath([[0, 0], [20, 0], [10, 20]]); assert.ok(p.some(([, y]) => y > 5));
});
test("에어브러시: 같은 시드면 같은 무늬", () => {
  const a = blank(), b = blank(); R.spray(a, 10, 10, 6, BLACK, R.makeRng(7)); R.spray(b, 10, 10, 6, BLACK, R.makeRng(7));
  assert.ok(a.equals(b)); assert.ok(count(a, BLACK) > 3);
});
test("변형: 뒤집기·회전·늘이기·기울이기·반전", () => {
  const b = new Bitmap(4, 2, WHITE); b.set(0, 0, BLACK);
  assert.equal(R.flipH(b).get(3, 0), BLACK); assert.equal(R.flipV(b).get(0, 1), BLACK);
  const r = R.rotate(b, 90); assert.equal(r.w, 2); assert.equal(r.h, 4); assert.equal(r.get(1, 0), BLACK);
  assert.ok(R.rotate(R.rotate(b, 90), 270).equals(b)); assert.ok(R.rotate(b, 180).equals(R.flipV(R.flipH(b))));
  const s = R.stretch(b, 200, 100); assert.equal(s.w, 8); assert.equal(s.get(1, 0), BLACK);
  const k = R.skew(new Bitmap(4, 10, WHITE), 45, 0, 0); assert.equal(k.w, 4 + 9);
  assert.equal(R.invert(b).get(0, 0), rgba(255, 255, 255)); assert.equal(R.invert(b).get(1, 0), BLACK);
});
