import test from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES, templatePx, toPx, fromPx, fitLimit, UNITS } from "../src/newdoc.js";
import { ago } from "../src/recent.js";

const find = (label) => TEMPLATES.flatMap((g) => g.items).find((t) => t.label === label);

test("A4·A3·A2 템플릿은 300ppi 픽셀 크기가 GIMP와 같다", () => {
  assert.deepEqual(templatePx(find("A4")), { w: 2480, h: 3508, ppi: 300 });
  assert.deepEqual(templatePx(find("A3")), { w: 3508, h: 4961, ppi: 300 });
  assert.deepEqual(templatePx(find("A2")), { w: 4961, h: 7016, ppi: 300 });
  assert.deepEqual(templatePx(find("A0")), { w: 9933, h: 14043, ppi: 300 });
  assert.deepEqual(templatePx(find("US Letter")), { w: 2550, h: 3300, ppi: 300 });
});
test("화면·웹 템플릿은 픽셀 그대로", () => {
  const fhd = TEMPLATES.flatMap((g) => g.items).find((t) => /Full HD/.test(t.label));
  assert.deepEqual(templatePx(fhd), { w: 1920, h: 1080, ppi: 72 });
});
test("단위 변환은 왕복해도 같다", () => {
  for (const u of UNITS) { const px = toPx(fromPx(3000, u.id, 300), u.id, 300); assert.ok(Math.abs(px - 3000) <= (u.id === "m" || u.id === "yd" ? 30 : 3), `${u.id}: ${px}`); }
  assert.equal(toPx(210, "mm", 300), 2480); assert.equal(toPx(1, "in", 96), 96); assert.equal(toPx(72, "pt", 144), 144); assert.equal(fromPx(300, "in", 300), 1);
});
test("너무 큰 크기는 비율을 지켜 줄인다", () => {
  assert.deepEqual(fitLimit(2480, 3508), { w: 2480, h: 3508, clamped: false });
  const f = fitLimit(9933, 14043); assert.ok(f.clamped && f.w * f.h <= 36e6 && Math.abs(f.w / f.h - 9933 / 14043) < 0.01);
  assert.equal(fitLimit(100, 100).clamped, false); assert.equal(fitLimit(20000, 10, { maxPx: Infinity }).w <= 16000, true);
});
test("최근 항목 시간 표시", () => {
  const n = 1e12; assert.equal(ago(n - 10e3, n), "방금"); assert.equal(ago(n - 5 * 60e3, n), "5분 전"); assert.equal(ago(n - 3 * 3600e3, n), "3시간 전"); assert.equal(ago(n - 2 * 86400e3, n), "2일 전");
});
