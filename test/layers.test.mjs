import test from "node:test";
import assert from "node:assert/strict";
import { PaintEngine } from "../src/engine.js";
import { Bitmap, BLACK, WHITE, parseColor, toBase64 } from "../src/bitmap.js";
import { PRESETS } from "../src/presets.js";
import { Stack, blendOver } from "../src/layers.js";
import { applyOp } from "../src/ops.js";

const P = { ...PRESETS.sandbox, width: 80, height: 60 };
const mk = () => { const e = new PaintEngine(null, P, { rasterText: () => new Bitmap(3, 3, BLACK) }); e.setLocked(false); return e; };
const drag = (e, a, b, extra = {}) => { e.pointerDown({ x: a[0], y: a[1], ...extra }); e.pointerMove({ x: b[0], y: b[1], ...extra }); e.pointerUp({ x: b[0], y: b[1] }); };
const flat = (e, x, y) => e.stack.flat().get(x, y);
const alpha = (c) => c >>> 24;

test("새 레이어에 그리면 아래 레이어는 그대로다", () => {
  const e = mk(); e.setTool("pencil"); drag(e, [5, 5], [20, 5]);
  const bg = e.layers[0].id; e.addLayer(); assert.equal(e.layers.length, 2); assert.notEqual(e.active, bg);
  drag(e, [5, 20], [20, 20]);
  assert.equal(e.stack.get(bg).bm.get(10, 20), WHITE); assert.equal(e.bm.get(10, 20), BLACK); assert.equal(alpha(e.bm.get(10, 5)), 0);
  assert.equal(flat(e, 10, 5), BLACK); assert.equal(flat(e, 10, 20), BLACK);
});
test("위 레이어 지우개는 투명하게, 배경 레이어는 배경색으로 지운다", () => {
  const e = mk(); e.setTool("pencil"); drag(e, [5, 5], [30, 5]); e.addLayer(); drag(e, [5, 5], [30, 5]);
  e.setTool("eraser"); e.setOption("eraserSize", 6); drag(e, [10, 5], [20, 5]);
  assert.equal(alpha(e.bm.get(15, 5)), 0); assert.equal(flat(e, 15, 5), BLACK, "아래 레이어 그림이 비쳐 보인다");
  e.selectLayer(e.layers[0].id); drag(e, [10, 5], [20, 5]); assert.equal(e.bm.get(15, 5), WHITE);
});
test("레이어 표시·불투명도·순서가 합성에 반영된다", () => {
  const e = mk(); e.setTool("fill"); e.setColor("fg", "#ff0000"); e.pointerDown({ x: 1, y: 1 }); e.pointerUp({ x: 1, y: 1 });
  const id = e.addLayer(); e.setColor("fg", "#0000ff"); e.pointerDown({ x: 1, y: 1 }); e.pointerUp({ x: 1, y: 1 });
  assert.equal(flat(e, 3, 3), parseColor("#0000ff"));
  e.setLayerVisible(id, false); assert.equal(flat(e, 3, 3), parseColor("#ff0000"));
  e.setLayerVisible(id, true); e.setLayerOpacity(id, 0.5); const m = flat(e, 3, 3);
  assert.ok((m & 255) > 100 && (m & 255) < 160 && ((m >>> 16) & 255) > 100, `반투명 섞임: ${m.toString(16)}`);
  e.moveLayer(id, -1); assert.equal(e.layers[0].id, id); assert.equal(flat(e, 3, 3), parseColor("#ff0000"), "빨강이 위로 올라옴");
});
test("실행 취소·다시 실행·기록 이동이 레이어 구조까지 복원한다", () => {
  const e = mk(); e.addLayer(); e.addLayer(); assert.equal(e.layers.length, 3);
  e.undo(); assert.equal(e.layers.length, 2); e.undo(); assert.equal(e.layers.length, 1); e.redo(); e.redo(); assert.equal(e.layers.length, 3);
  const n = e.tree.current; e.goto(0); assert.equal(e.layers.length, 1); e.goto(n); assert.equal(e.layers.length, 3); assert.ok(e.stack.has(e.active));
});
test("객체 모드: 그린 것이 레이어 하나가 되고 이동 도구로 옮길 수 있다", () => {
  const e = mk(); e.setOption("asObject", true); e.setTool("rect"); e.setOption("shapeStyle", "fill"); drag(e, [10, 10], [20, 20]);
  assert.equal(e.layers.length, 2); assert.ok(/사각형/.test(e.layers[1].name)); assert.equal(e.active, e.layers[1].id); assert.equal(e.stack.get(e.layers[0].id).bm.get(15, 15), WHITE);
  e.setTool("move"); drag(e, [15, 15], [35, 25]);
  assert.equal(alpha(e.bm.get(15, 15)), 0); assert.equal(e.bm.get(35, 25), BLACK); assert.equal(e.layers.length, 2);
  e.undo(); assert.equal(e.bm.get(15, 15), BLACK);
});
test("이동 도구는 클릭한 자리의 가장 위 객체를 고른다", () => {
  const e = mk(); e.setOption("asObject", true); e.setTool("rect"); e.setOption("shapeStyle", "fill");
  drag(e, [5, 5], [15, 15]); const a = e.active; drag(e, [40, 30], [50, 40]); const b = e.active; assert.notEqual(a, b);
  e.setTool("move"); e.pointerDown({ x: 10, y: 10 }); assert.equal(e.active, a); e.pointerUp({ x: 10, y: 10 });
});
test("붙여넣기는 새 객체 레이어로 들어가고 이동 도구가 선택된다", () => {
  const e = mk(); e.setTool("pencil"); drag(e, [5, 5], [20, 5]); e.setTool("select"); drag(e, [0, 0], [30, 10]); e.copy(); e.paste();
  assert.equal(e.layers.length, 2); assert.equal(e.tool, "move"); assert.equal(e.layers[1].name, "붙여넣기");
});
test("아래로 병합·이미지 병합", () => {
  const e = mk(); e.setTool("pencil"); e.addLayer(); drag(e, [5, 5], [20, 5]); e.addLayer(); drag(e, [5, 20], [20, 20]); assert.equal(e.layers.length, 3);
  e.mergeDown(); assert.equal(e.layers.length, 2); assert.equal(e.bm.get(10, 5), BLACK); assert.equal(e.bm.get(10, 20), BLACK);
  e.flatten(); assert.equal(e.layers.length, 1); assert.equal(e.bm.get(10, 5), BLACK); assert.equal(e.bm.get(1, 1), WHITE);
});
test("복제·삭제·이름 바꾸기, 마지막 레이어는 지울 수 없다", () => {
  const e = mk(); e.setTool("pencil"); drag(e, [5, 5], [20, 5]); const id = e.duplicateLayer(); assert.equal(e.layers.length, 2); assert.equal(e.bm.get(10, 5), BLACK);
  drag(e, [5, 30], [20, 30]); assert.equal(e.stack.get(e.layers[0].id).bm.get(10, 30), WHITE, "복제본에 그려도 원본은 그대로");
  e.renameLayer(id, "복사본"); assert.equal(e.stack.get(id).name, "복사본");
  e.deleteLayer(id); assert.equal(e.layers.length, 1); assert.equal(e.deleteLayer(), false);
});
test("이미지 크기·자르기·뒤집기는 모든 레이어에 적용된다", () => {
  const e = mk(); e.setTool("pencil"); e.addLayer(); drag(e, [2, 2], [10, 2]); e.scaleImage(40, 30);
  assert.ok(e.layers.every((l) => l.bm.w === 40 && l.bm.h === 30));
  e.setTool("select"); drag(e, [0, 0], [20, 15]); e.cropToSelection(); assert.ok(e.layers.every((l) => l.bm.w === 20 && l.bm.h === 15));
});
test("객체를 가져오면 캔버스보다 클 때 맞춰 줄인다", () => {
  const e = mk(); e.addObjectBitmap(new Bitmap(160, 120, BLACK), "큰 그림"); assert.equal(e.layers.length, 2); assert.equal(e.stack.get(e.active).name, "큰 그림");
  assert.ok(e.bm.get(40, 30) === BLACK && alpha(e.bm.get(79, 59)) === 255);
});
test("같은 연산열을 처음부터 재생하면 같은 레이어 그림이 나온다", () => {
  const e = mk(); e.setOption("asObject", true); e.setTool("brush"); drag(e, [5, 5], [30, 20]); e.setOption("asObject", false); e.addLayer(); e.setTool("line"); drag(e, [0, 0], [40, 40]);
  let st = Stack.single(new Bitmap(80, 60, WHITE)); for (const op of e.tree.pathOps()) st = applyOp(st, op, {}).bm;
  assert.ok(st.flat().equals(e.stack.flat())); assert.equal(st.layers.length, e.layers.length);
});
test("blendOver: 반투명 합성", () => {
  const d = new Bitmap(1, 1, WHITE), s = new Bitmap(1, 1, BLACK); blendOver(d, s, 0.5); const c = d.px[0] & 255; assert.ok(c > 120 && c < 135);
});
