import test from "node:test";
import assert from "node:assert/strict";
import { Bitmap, WHITE, BLACK, parseColor, rgba, toBase64 } from "../src/bitmap.js";
import { applyOp, replay, opsUpTo, extract, selFromPolygon, normalizeSel } from "../src/ops.js";
import { HistoryTree } from "../src/history.js";

const blank = (w = 40, h = 30) => new Bitmap(w, h, WHITE);
const K = "#000000";
const run = (bm, op, env) => applyOp(bm, op, env);

test("도형 스타일: outline / both / fill", () => {
  const o = { t: "rect", a: [5, 5], b: [20, 15], c: K, fill: "#ff0000", w: 1 };
  const out = run(blank(), { ...o, style: "outline" }).bm, both = run(blank(), { ...o, style: "both" }).bm, fill = run(blank(), { ...o, style: "fill" }).bm;
  assert.equal(out.get(10, 10), WHITE); assert.equal(out.get(5, 5), BLACK);
  assert.equal(both.get(10, 10), parseColor("#ff0000")); assert.equal(both.get(5, 5), BLACK);
  assert.equal(fill.get(5, 5), parseColor("#ff0000")); assert.equal(fill.get(20, 15), parseColor("#ff0000"));
});
test("다각형: 열린 경로는 닫지 않는다", () => {
  const o = { t: "polygon", pts: [[2, 2], [20, 2], [20, 20]], c: K, w: 1 };
  assert.equal(run(blank(), o).bm.get(10, 10), BLACK);                // 닫힌 변(대각선)
  assert.equal(run(blank(), { ...o, open: true }).bm.get(10, 10), WHITE);
});
test("선택 이동: 구멍은 배경색, 복사는 원본 유지, 투명 옵션", () => {
  const b = blank(); b.fillRect(2, 2, 4, 4, BLACK);
  const sel = { x: 2, y: 2, w: 4, h: 4 };
  const m = run(b.clone(), { t: "sel_move", sel, dx: 10, dy: 0, copy: false, bg: "#ffffff" });
  assert.equal(m.bm.get(3, 3), WHITE); assert.equal(m.bm.get(13, 3), BLACK); assert.deepEqual(m.sel, { x: 12, y: 2, w: 4, h: 4 });
  const c = run(b.clone(), { t: "sel_move", sel, dx: 10, dy: 0, copy: true, bg: "#ffffff" });
  assert.equal(c.bm.get(3, 3), BLACK); assert.equal(c.bm.get(13, 3), BLACK);
  const target = b.clone(); target.fillRect(12, 2, 4, 4, rgba(255, 0, 0));
  const tr = run(target.clone(), { t: "sel_move", sel: { x: 2, y: 2, w: 6, h: 4 }, dx: 10, dy: 0, copy: true, tr: true, bg: "#ffffff" });
  assert.equal(tr.bm.get(18, 3), WHITE);                               // 투명 모드: 선택 안의 배경색은 덮어쓰지 않음
});
test("자유형 선택: 마스크 밖 픽셀은 따라오지 않는다", () => {
  const b = blank(); b.fillRect(0, 0, 40, 30, BLACK);
  const sel = selFromPolygon([[5, 5], [15, 5], [5, 15]], 40, 30);
  const c = extract(b, sel); assert.equal(c.get(1, 1) !== 0, true); assert.equal(c.get(sel.w - 1, sel.h - 1), 0);
  const r = run(b, { t: "sel_delete", sel, bg: "#ffffff" });
  assert.equal(r.bm.get(6, 6), WHITE); assert.equal(r.bm.get(14, 14), BLACK); assert.equal(r.sel, null);
});
test("변형: 이미지 전체·선택 영역·크기 조절", () => {
  const b = new Bitmap(6, 4, WHITE); b.set(0, 0, BLACK);
  assert.equal(run(b.clone(), { t: "xform", kind: "flipH" }).bm.get(5, 0), BLACK);
  const rot = run(b.clone(), { t: "xform", kind: "rotate", a: 90 }).bm; assert.equal(rot.w, 4); assert.equal(rot.h, 6);
  assert.equal(run(b.clone(), { t: "xform", kind: "invert" }).bm.get(1, 1), BLACK);
  const sel = { x: 0, y: 0, w: 2, h: 2 };
  const f = run(b.clone(), { t: "xform", kind: "flipH", sel, bg: "#ffffff" }); assert.equal(f.bm.get(1, 0), BLACK); assert.equal(f.bm.get(0, 0), WHITE);
  const r = run(b.clone(), { t: "xform", kind: "resize", sel, to: { x: 0, y: 0, w: 4, h: 4 }, bg: "#ffffff" }); assert.deepEqual(r.sel, { x: 0, y: 0, w: 4, h: 4 }); assert.equal(r.bm.get(1, 1), BLACK);
});
test("붙여넣기·이미지 속성·지우기·텍스트(주입 래스터라이저)", () => {
  const src = new Bitmap(2, 2, BLACK), p = run(blank(), { t: "paste", x: 3, y: 3, w: 2, h: 2, data: toBase64(src), bg: "#ffffff" });
  assert.equal(p.bm.get(3, 3), BLACK); assert.deepEqual(p.sel, { x: 3, y: 3, w: 2, h: 2 });
  const a = run(blank(), { t: "attributes", w: 10, h: 10, bg: "#ffffff" }).bm; assert.equal(a.w, 10);
  assert.ok(run(blank(), { t: "clear", c: K }).bm.isUniform(BLACK));
  const t = run(blank(), { t: "text", box: { x: 1, y: 1, w: 5, h: 3 }, text: "가", c: K, bg: "#ffff00", opaque: true }, { rasterText: () => new Bitmap(2, 2, BLACK) });
  assert.equal(t.bm.get(1, 1), BLACK); assert.equal(t.bm.get(4, 3), parseColor("#ffff00"));
});
test("리플레이 결정성: 연산열을 재생하면 증분 결과와 같다", () => {
  const ops = [{ t: "brush", pts: [[2, 2], [30, 20]], c: K, shape: "circle", size: 3 }, { t: "fill", p: [35, 5], c: "#00ff00" }, { t: "airbrush", pts: [[10, 10], [12, 12]], c: "#ff0000", size: 5, seed: 9 }, { t: "ellipse", a: [5, 5], b: [25, 25], c: K, style: "both", fill: "#0000ff", w: 2 }];
  let inc = blank(); for (const o of ops) inc = applyOp(inc, o).bm;
  assert.ok(replay(blank(), ops).equals(inc));
  assert.ok(replay(blank(), ops).equals(replay(blank(), JSON.parse(JSON.stringify(ops)))));
});
test("opsUpTo: 진행도에 따라 마지막 획이 잘린다", () => {
  const ops = [{ t: "brush", pts: [[0, 0], [1, 1], [2, 2], [3, 3]] }, { t: "fill", p: [0, 0], c: K }];
  assert.equal(opsUpTo(ops, 0).length, 0); assert.equal(opsUpTo(ops, 1).length, 2); assert.equal(opsUpTo(ops, 0.4)[0].pts.length, 2);
});
test("normalizeSel: 캔버스 밖은 잘리고 크기 0이면 null", () => {
  assert.deepEqual(normalizeSel([-5, -5], [10, 10], 40, 30), { x: 0, y: 0, w: 10, h: 10 }); assert.equal(normalizeSel([3, 3], [3, 9], 40, 30), null);
});

const brushOp = (x) => ({ t: "brush", pts: [[x, 5], [x + 5, 8]], c: K, shape: "circle", size: 2 });
function commitOp(tree, op) { const { bm, sel } = applyOp(tree.bitmap.clone(), op); return tree.commit(op, sel, bm); }

test("히스토리: undo/redo, 분기 보존, 임의 이동", () => {
  const t = new HistoryTree(blank()); const a = commitOp(t, brushOp(2)), b = commitOp(t, brushOp(12)), c = commitOp(t, brushOp(22));
  assert.equal(t.current, c.id); t.undo(); t.undo(); assert.equal(t.current, a.id);
  const d = commitOp(t, { t: "fill", p: [30, 20], c: "#ff0000" });     // a에서 분기
  assert.equal(t.node(a.id).children.length, 2);
  t.goto(c.id); assert.ok(t.bitmap.equals(replay(blank(), t.pathOps(c.id)))); assert.notEqual(t.bitmap.get(22, 5), WHITE);
  t.goto(d.id); assert.equal(t.bitmap.get(39, 29), parseColor("#ff0000"));
  t.goto(0); assert.ok(t.bitmap.isUniform(WHITE)); assert.equal(t.canUndo(), false);
  t.redo(); t.redo(); assert.equal(t.current, d.id, "마지막으로 방문한 갈래로 redo");
});
test("히스토리: 캐시 축출 후에도 연산 재생으로 같은 그림 복원", () => {
  const t = new HistoryTree(blank(), { cacheMax: 2 }); const ids = []; for (let i = 0; i < 12; i++) ids.push(commitOp(t, brushOp(i)).id);
  const last = t.bitmap.clone(); t.goto(ids[2]); t.goto(ids[11]); assert.ok(t.bitmap.equals(last));
  const ref = replay(blank(), t.pathOps(ids[5])); t.goto(ids[5]); assert.ok(t.bitmap.equals(ref));
});
test("히스토리: JSON 왕복과 adopt(미러)", () => {
  const t = new HistoryTree(blank()); commitOp(t, brushOp(2)); commitOp(t, { t: "fill", p: [30, 20], c: "#00ff00" }); t.undo(); commitOp(t, brushOp(20));
  const copy = HistoryTree.fromJSON(JSON.parse(JSON.stringify(t.toJSON())), blank()); assert.ok(copy.bitmap.equals(t.bitmap)); assert.equal(copy.flatten().length, t.flatten().length);
  const mirror = new HistoryTree(blank()); for (const n of t.toJSON().nodes) mirror.adopt(n); mirror.goto(t.current); assert.ok(mirror.bitmap.equals(t.bitmap));
});
