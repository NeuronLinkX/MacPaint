import test from "node:test";
import assert from "node:assert/strict";
import { Bitmap, rgba, BLACK, WHITE } from "../src/bitmap.js";
import { FILTERS, applyFilter, gradient, scaleBitmap } from "../src/filters.js";
import { applyOp } from "../src/ops.js";

const ch = (c) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24];
const solid = (w, h, c) => new Bitmap(w, h, c);

test("흑백·반전·임계값", () => {
  const b = solid(2, 2, rgba(255, 0, 0)); applyFilter(b, "grayscale"); const [r, g, bl] = ch(b.px[0]); assert.ok(r === g && g === bl && r > 50 && r < 100);
  const w = solid(2, 2, WHITE); applyFilter(w, "invert"); assert.deepEqual(ch(w.px[0]), [0, 0, 0, 255]);
  const t = solid(2, 2, rgba(200, 200, 200)); applyFilter(t, "threshold", { level: 128 }); assert.deepEqual(ch(t.px[0]), [255, 255, 255, 255]);
});
test("밝기 +는 밝게, 투명 픽셀은 건드리지 않는다", () => {
  const b = new Bitmap(2, 1, 0); b.px[0] = rgba(100, 100, 100); applyFilter(b, "brightnessContrast", { brightness: 20 }); assert.ok(ch(b.px[0])[0] > 100); assert.equal(b.px[1], 0);
});
test("흐림은 경계를 부드럽게 한다", () => {
  const b = solid(9, 1, WHITE); b.set(4, 0, BLACK); applyFilter(b, "blur", { radius: 2 }); assert.ok(ch(b.px[4])[0] > 0 && ch(b.px[3])[0] < 255);
});
test("픽셀화는 블록 안을 한 색으로", () => {
  const b = solid(4, 4, WHITE); b.set(0, 0, BLACK); applyFilter(b, "pixelate", { size: 4 }); assert.ok(new Set(b.px).size === 1);
});
test("노이즈는 같은 시드에서 같은 결과", () => {
  const a = solid(8, 8, rgba(128, 128, 128)), b = solid(8, 8, rgba(128, 128, 128)); applyFilter(a, "noise", { amount: 30, seed: 3 }); applyFilter(b, "noise", { amount: 30, seed: 3 }); assert.deepEqual([...a.px], [...b.px]); assert.ok(new Set(a.px).size > 1);
});
test("모든 필터가 기본값으로 실행된다", () => { for (const k of Object.keys(FILTERS)) applyFilter(solid(12, 12, rgba(90, 160, 30)), k, Object.fromEntries(FILTERS[k].params.map(([n, , , , d]) => [n, d]))); });
test("그라디언트: 양 끝이 두 색", () => {
  const b = solid(11, 1, 0); gradient(b, [0, 0], [10, 0], rgba(255, 0, 0), rgba(0, 0, 255)); assert.deepEqual(ch(b.px[0]), [255, 0, 0, 255]); assert.deepEqual(ch(b.px[10]), [0, 0, 255, 255]);
});
test("이미지 크기 조정", () => { const s = scaleBitmap(solid(4, 4, rgba(10, 20, 30)), 8, 2); assert.equal(s.w, 8); assert.equal(s.h, 2); assert.deepEqual(ch(s.px[0]), [10, 20, 30, 255]); });
test("op: 선택 영역에만 필터, 자르기, 크기 조정", () => {
  const bm = solid(10, 10, WHITE), r = applyOp(bm, { t: "filter", name: "invert", params: {}, sel: { x: 2, y: 2, w: 3, h: 3 } }, {});
  assert.deepEqual(ch(r.bm.get(3, 3)), [0, 0, 0, 255]); assert.deepEqual(ch(r.bm.get(0, 0)), [255, 255, 255, 255]);
  const c = applyOp(solid(10, 10, WHITE), { t: "crop", sel: { x: 1, y: 1, w: 4, h: 3 } }, {}); assert.equal(c.bm.w, 4); assert.equal(c.bm.h, 3);
  assert.equal(applyOp(solid(10, 10, WHITE), { t: "scale", w: 20, h: 5 }, {}).bm.w, 20);
});
test("허용 오차 채우기는 비슷한 색까지", () => {
  const bm = solid(3, 1, rgba(100, 100, 100)); bm.set(1, 0, rgba(110, 100, 100)); bm.set(2, 0, rgba(200, 0, 0));
  const r = applyOp(bm.clone(), { t: "fill", p: [0, 0], c: "#00ff00", tol: 20 }, {}); assert.deepEqual(ch(r.bm.get(1, 0)), [0, 255, 0, 255]); assert.deepEqual(ch(r.bm.get(2, 0)), [200, 0, 0, 255]);
  const q = applyOp(bm.clone(), { t: "fill", p: [0, 0], c: "#00ff00" }, {}); assert.deepEqual(ch(q.bm.get(1, 0)), [110, 100, 100, 255]);
});
