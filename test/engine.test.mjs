import test from "node:test";
import assert from "node:assert/strict";
import { PaintEngine } from "../src/engine.js";
import { Bitmap, BLACK, WHITE, parseColor, rgba } from "../src/bitmap.js";
import { PRESETS } from "../src/presets.js";
import { StrokeAssembler, StrokeBatcher } from "../src/stream.js";
import { Replayer } from "../src/replay.js";
import { replay } from "../src/ops.js";

const P = { ...PRESETS.sandbox, width: 80, height: 60 };
const mk = (preset = P, opts = {}) => { const e = new PaintEngine(null, preset, { rasterText: () => new Bitmap(3, 3, BLACK), ...opts }); e.setLocked(false); return e; };
const drag = (e, a, b, extra = {}) => { e.pointerDown({ x: a[0], y: a[1], ...extra }); e.pointerMove({ x: b[0], y: b[1], ...extra }); e.pointerUp({ x: b[0], y: b[1] }); };
const px = (e, x, y) => e.bm.get(x, y);

test("연필·브러시·지우개: 오른쪽 클릭은 배경색, 같은 점 반복은 무시", () => {
  const e = mk(); e.setTool("pencil"); e.pointerDown({ x: 5, y: 5 }); e.pointerMove({ x: 5, y: 5 }); e.pointerMove({ x: 20, y: 5 }); e.pointerUp({ x: 20, y: 5 });
  assert.equal(px(e, 12, 5), BLACK); assert.equal(e.tree.currentNode.op.pts.length, 2);
  e.setOption("brushSize", 5); e.setTool("brush"); drag(e, [5, 20], [30, 20]); assert.equal(px(e, 15, 22), BLACK);
  e.setTool("eraser"); e.setOption("eraserSize", 6); drag(e, [10, 20], [20, 20]); assert.equal(px(e, 15, 20), WHITE);
  e.setTool("pencil"); e.setColor("bg", "#ff0000"); drag(e, [5, 40], [20, 40], { button: 2 }); assert.equal(px(e, 10, 40), parseColor("#ff0000"));
});
test("브러시 모양·에어브러시·채우기·색 고르기", () => {
  const e = mk(); e.setTool("brush"); e.setOption("brushShape", "square"); e.setOption("brushSize", 4); e.pointerDown({ x: 20, y: 20 }); e.pointerUp({ x: 20, y: 20 });
  assert.equal(e.bm.px.filter((c) => c === BLACK).length, 16);
  e.setTool("airbrush"); drag(e, [50, 30], [58, 31]); assert.ok(e.bm.px.filter((c) => c === BLACK).length > 20);
  e.setTool("fill"); e.setColor("fg", "#00ff00"); e.pointerDown({ x: 70, y: 5 }); e.pointerUp({ x: 70, y: 5 }); assert.equal(px(e, 1, 1), parseColor("#00ff00"));
  e.setTool("pick"); e.pointerDown({ x: 20, y: 20 }); assert.equal(e.colors.fg, "#000000");
});
test("도형: 스타일·Shift 제약·직선 45도", () => {
  const e = mk(); e.setTool("rect"); e.setOption("shapeStyle", "both"); e.setColor("bg", "#ffff00"); drag(e, [10, 10], [30, 20]);
  assert.equal(px(e, 10, 10), BLACK); assert.equal(px(e, 20, 15), parseColor("#ffff00"));
  e.setTool("ellipse"); e.setOption("shapeStyle", "outline"); drag(e, [40, 10], [60, 40], { shift: true });
  const op = e.tree.currentNode.op; assert.equal(op.b[0] - op.a[0], op.b[1] - op.a[1]);
  e.setTool("line"); drag(e, [5, 50], [30, 55], { shift: true }); assert.equal(e.tree.currentNode.op.b[1], 50);
  e.setTool("roundrect"); drag(e, [40, 45], [70, 58]); assert.equal(e.tree.currentNode.op.t, "roundrect");
});
test("다각형: 클릭으로 꼭짓점, 더블클릭으로 닫기, Esc로 취소", () => {
  const e = mk(); e.setTool("polygon");
  e.pointerDown({ x: 10, y: 10 }); e.pointerMove({ x: 40, y: 10 }); e.pointerUp({ x: 40, y: 10 });
  e.pointerDown({ x: 40, y: 40 }); e.pointerUp({ x: 40, y: 40 }); e.dblClick({ x: 40, y: 40 });
  const op = e.tree.currentNode.op; assert.equal(op.t, "polygon"); assert.ok(op.pts.length >= 3); assert.ok(!op.open);
  const n = e.tree.nodes.size; e.pointerDown({ x: 5, y: 5 }); e.pointerUp({ x: 5, y: 5 }); e.key("Escape"); assert.equal(e.tree.nodes.size, n); assert.equal(e.draft, null);
});
test("곡선: 직선 → 휘기 → Enter 확정", () => {
  const e = mk(); e.setTool("curve");
  e.pointerDown({ x: 10, y: 30 }); e.pointerMove({ x: 70, y: 30 }); e.pointerUp({ x: 70, y: 30 });
  e.pointerDown({ x: 40, y: 5 }); e.pointerUp({ x: 40, y: 5 }); e.key("Enter");
  const op = e.tree.currentNode.op; assert.equal(op.t, "curve"); assert.equal(op.pts.length, 3); assert.ok(e.bm.px.filter((c) => c === BLACK).length > 40);
});
test("선택 → 이동 → Ctrl 복사 → 크기 조절 → 삭제", () => {
  const e = mk(); e.setTool("rect"); e.setOption("shapeStyle", "fill"); drag(e, [10, 10], [19, 19]);
  e.setTool("select"); drag(e, [8, 8], [22, 22]); assert.deepEqual(e.sel, { x: 8, y: 8, w: 14, h: 14 });
  drag(e, [15, 15], [45, 15]); assert.equal(px(e, 12, 12), WHITE); assert.equal(px(e, 42, 12), BLACK); assert.equal(e.sel.x, 38);
  drag(e, [45, 15], [45, 40], { ctrl: true }); assert.equal(px(e, 42, 12), BLACK); assert.equal(px(e, 42, 37), BLACK);
  e.pointerDown({ x: 38 + 14, y: 38 + 14 }); e.pointerMove({ x: 38 + 14 + 6, y: 38 + 14 + 6 }); e.pointerUp({ x: 58 + 0, y: 58 });
  assert.equal(e.tree.currentNode.op.kind, "resize"); assert.ok(e.sel.w > 14);
  e.deleteSelection(); assert.equal(e.sel, null);
});
test("자유형 선택·잘라내기·붙여넣기·전체 선택", () => {
  const e = mk(); e.setTool("fill"); e.setColor("fg", "#0000ff"); e.pointerDown({ x: 1, y: 1 }); e.pointerUp({ x: 1, y: 1 });
  e.setTool("freeselect"); e.pointerDown({ x: 10, y: 10 }); e.pointerMove({ x: 30, y: 10 }); e.pointerMove({ x: 10, y: 30 }); e.pointerUp({ x: 10, y: 30 });
  assert.ok(e.sel.poly); assert.equal(e.cut(), true); assert.equal(px(e, 12, 12), WHITE); assert.equal(px(e, 28, 28), parseColor("#0000ff"));
  e.paste(); assert.equal(e.layers.length, 2); assert.notEqual(e.stack.flat().get(2, 2), WHITE); assert.equal(e.stack.flat().get(18, 18), WHITE); e.selectAll(); assert.deepEqual(e.sel, { x: 0, y: 0, w: 80, h: 60 });
});
test("영역을 지정하고 붙여넣으면 그 영역 자리에 들어간다(사각형·자유형, 놓침 복구)", () => {
  const e = mk(); e.setTool("fill"); e.setColor("fg", "#0000ff"); e.pointerDown({ x: 1, y: 1 }); e.pointerUp({ x: 1, y: 1 });
  e.setTool("select"); drag(e, [2, 2], [12, 12]); assert.equal(e.copy(), true);
  drag(e, [40, 30], [60, 50]); assert.equal(e.paste(), true);
  const l = e.layers[e.layers.length - 1]; assert.equal(l.bm.get(40 + 5, 30 + 5), parseColor("#0000ff")); assert.equal(l.bm.get(5, 5) >>> 24, 0);
  e.setTool("freeselect"); e.pointerDown({ x: 10, y: 10 }); e.pointerMove({ x: 30, y: 10 });   // pointerup을 놓침
  e.pointerDown({ x: 5, y: 40 }); assert.ok(e.drag, "다음 누름이 막히지 않는다");
});
test("선택 영역이 있으면 채우기는 그 안에서만 칠한다(사각형·자유형)", () => {
  const e = mk(); e.setColor("fg", "#ff0000"); e.setTool("select"); drag(e, [10, 10], [40, 40]);
  e.setTool("fill"); e.pointerDown({ x: 20, y: 20 }); e.pointerUp({ x: 20, y: 20 });
  assert.equal(px(e, 20, 20), parseColor("#ff0000")); assert.equal(px(e, 60, 50), WHITE); assert.equal(px(e, 5, 5), WHITE);
  e.pointerDown({ x: 60, y: 50 }); e.pointerUp({ x: 60, y: 50 }); assert.equal(px(e, 60, 50), WHITE);
  const f = mk(); f.setColor("fg", "#ff0000"); f.setTool("freeselect"); f.pointerDown({ x: 10, y: 10 }); f.pointerMove({ x: 40, y: 10 }); f.pointerMove({ x: 10, y: 40 }); f.pointerUp({ x: 10, y: 40 });
  f.setTool("fill"); f.pointerDown({ x: 15, y: 15 }); f.pointerUp({ x: 15, y: 15 });
  assert.equal(px(f, 15, 15), parseColor("#ff0000")); assert.equal(px(f, 38, 38), WHITE);
});
test("텍스트: 상자 → 입력 → 확정(빈 텍스트는 기록 안 함)", () => {
  const e = mk(); e.setTool("text"); drag(e, [10, 10], [40, 30]);
  assert.ok(e.text); e.textUpdate({ text: "안녕" }); e.key("Enter");
  assert.equal(e.tree.currentNode.op.t, "text"); assert.equal(px(e, 11, 11), BLACK);
  const n = e.tree.nodes.size; drag(e, [50, 10], [70, 30]); e.textCommit(); assert.equal(e.tree.nodes.size, n);
});
test("이미지 메뉴: 선택 없으면 전체, 있으면 선택만", () => {
  const e = mk(); e.setTool("pencil"); e.pointerDown({ x: 0, y: 0 }); e.pointerUp({ x: 0, y: 0 });
  e.flipH(); assert.equal(px(e, 79, 0), BLACK); e.rotate(90); assert.equal(e.width, 60); assert.equal(e.height, 80);
  e.invert(); assert.equal(px(e, 5, 5), BLACK); e.setAttributes(30, 30); assert.equal(e.width, 30); e.stretch(200, 100); assert.equal(e.width, 60);
  e.skew(30, 0); assert.ok(e.width > 60);
});
test("히스토리 트리: 되돌린 뒤 새로 그리면 분기가 남고 이동 가능", () => {
  const e = mk(); e.setTool("pencil"); drag(e, [5, 5], [20, 5]); drag(e, [5, 10], [20, 10]); const second = e.tree.current;
  e.undo(); drag(e, [5, 15], [20, 15]); assert.equal(e.tree.node(1).children.length, 2);
  assert.equal(px(e, 10, 10), WHITE); e.goto(second); assert.equal(px(e, 10, 10), BLACK); assert.equal(px(e, 10, 15), WHITE);
  assert.ok(e.history.some((h) => h.depth > 0)); e.undo(); e.undo(); assert.equal(e.canUndo, false); e.redo(); assert.equal(px(e, 10, 5), BLACK);
});
test("프리셋 제한: 퀵드로우는 브러시·지우개만, 색 고정, 되돌리기 없음", () => {
  const e = mk({ ...PRESETS.quickdraw, width: 80, height: 60 });
  assert.equal(e.setTool("fill"), "brush"); assert.equal(e.setTool("pen"), "brush"); assert.equal(e.toggleEraser(), "eraser"); assert.equal(e.setTool("brush"), "brush");
  e.setColor("fg", "#ff0000"); assert.equal(e.colors.fg, "#191817");
  e.setWidth(2); assert.equal(e.options.brushSize, 16); e.beginStroke(0.2, 0.2); e.moveStroke(0.6, 0.6); e.endStroke();
  assert.equal(e.undo(), false); assert.equal(e.isBlank(), false); assert.equal(e.clear(), true); assert.equal(e.isBlank(), true);
  const t = mk({ ...PRESETS.telepathy, width: 40, height: 30 }); t.beginStroke(0.2, 0.2); t.endStroke(); assert.equal(t.undo(), true); assert.equal(t.isBlank(), true);
});
test("잠금 상태에서는 그려지지 않는다", () => {
  const e = new PaintEngine(null, { ...PRESETS.quickdraw, width: 40, height: 30 }); assert.equal(e.beginStroke(0.5, 0.5), false);
  e.setLocked(false); e.beginStroke(0.5, 0.5); e.setLocked(true); assert.equal(e.live, null); assert.equal(e.tree.nodes.size, 1);
});
test("미러: 엔진 이벤트 → 배처 → 어셈블러가 같은 픽셀을 만든다(모든 도구)", () => {
  const e = mk(), out = []; const b = new StrokeBatcher((m) => out.push(m), "q1", 30, { set: () => 1, clear: () => {} });
  e.on("op", (ev) => b.push(ev));
  e.setTool("brush"); drag(e, [5, 5], [30, 20]); e.setTool("airbrush"); drag(e, [40, 10], [44, 14]);
  e.setTool("ellipse"); drag(e, [10, 30], [40, 55]); e.setTool("fill"); e.pointerDown({ x: 60, y: 50 }); e.pointerUp({ x: 60, y: 50 });
  e.setTool("select"); drag(e, [8, 28], [42, 57]); drag(e, [20, 40], [30, 30]); e.flipH(); e.undo(); e.goto(2); e.redo();
  b.flush();
  const a = new StrokeAssembler(P, () => {}, e.env); out.forEach((m) => a.apply(m));
  assert.ok(a.view().equals(e.bm)); assert.ok(a.tree.bitmap.equals(e.bm)); assert.equal(a.tree.current, e.tree.current);
  assert.ok(out.filter((m) => m.op === "pts").length < 4, "점 증분은 묶여서 전송된다");
});
test("미러: 진행 중 미리보기와 늦게 접속한 화면의 복원", () => {
  const e = mk(), out = []; e.on("op", (ev) => out.push({ type: "stroke", item_id: "q1", ...ev }));
  e.setTool("pencil"); e.pointerDown({ x: 5, y: 5 }); e.pointerMove({ x: 25, y: 25 });
  const live = new StrokeAssembler(P); out.forEach((m) => live.apply(m)); assert.ok(live.view().equals(e.view())); assert.equal(live.tree.current, 0);
  e.pointerUp({ x: 25, y: 25 }); e.setTool("rect"); e.pointerDown({ x: 30, y: 30 }); e.pointerMove({ x: 50, y: 50 });
  const late = new StrokeAssembler(P); late.restore("q1", out.slice()); assert.ok(late.view().equals(e.view()));
  assert.equal(late.apply({ item_id: "q0", op: "goto", id: 0 }), false, "다른 문제의 늦은 메시지는 무시");
});
test("리플레이: 진행도별 프레임, 끝 프레임은 최종 그림", () => {
  const e = mk(); e.setTool("brush"); drag(e, [5, 5], [40, 30]); e.setTool("fill"); e.setColor("fg", "#ff0000"); e.pointerDown({ x: 70, y: 5 }); e.pointerUp({ x: 70, y: 5 });
  const ops = e.tree.pathOps(), r = new Replayer(P, () => {}, e.env);
  assert.ok(r.frameAt(ops, 1).equals(e.bm)); assert.ok(r.frameAt(ops, 0).isUniform(WHITE)); assert.ok(replay(new Bitmap(80, 60, WHITE), ops).equals(e.bm));
  const frames = []; let t = 0; const queue = [];
  const rr = new Replayer(P, (bm) => frames.push(bm.clone()), e.env, (f) => (queue.push(f), queue.length), () => {});
  rr.play(ops, 100, () => frames.push("done")); while (queue.length && t < 20) { queue.shift()(t * 40); t++; }
  assert.ok(frames.includes("done")); assert.ok(frames[frames.length - 2].equals(e.bm));
});
test("직렬화: 저장 → 불러오기로 같은 그림과 히스토리", () => {
  const e = mk(); e.setTool("pencil"); drag(e, [5, 5], [30, 30]); e.undo(); drag(e, [5, 10], [30, 10]);
  const f = mk(); f.load(JSON.parse(JSON.stringify(e.toJSON()))); assert.ok(f.bm.equals(e.bm)); assert.equal(f.history.length, e.history.length);
});

test("에어브러시(XP 그림판): 가만히 눌러도 점이 쌓이고 원 밖으로 나가지 않는다", () => {
  const e = mk({ ...P, width: 120, height: 100 }, { sprayMs: 0 }); e.setTool("airbrush"); e.setOption("airbrushSize", 8);
  const black = () => e.view().px.filter((c) => c === BLACK).length;
  e.pointerDown({ x: 60, y: 50 }); const first = black();
  for (let i = 0; i < 40; i++) e.sprayTick();                         // 1.2초 동안 가만히 누른 것과 같다
  const held = black(); assert.ok(first <= 12 && held > first * 5, `가만히 누르면 쌓인다 (${first} → ${held})`);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 120; x++) if (e.view().get(x, y) === BLACK) assert.ok(Math.hypot(x - 60, y - 50) <= 8.8, "반지름 안에서만 뿌려진다");
  assert.ok(held > 80, "충분히 오래 누르면 원이 거의 채워진다(약 200칸 중)");
  e.pointerUp({ x: 60, y: 50 });
  assert.equal(e.tree.currentNode.op.t, "airbrush"); assert.equal(e.tree.currentNode.op.pts.length, 41);
});
test("에어브러시: 빠르게 움직여도 끊기지 않고(중간 지점 보간), 기록을 재생하면 같은 그림", async () => {
  const e = mk({ ...P, width: 200, height: 100 }, { sprayMs: 0 }); e.setTool("airbrush"); e.setOption("airbrushSize", 4);
  e.pointerDown({ x: 10, y: 50 }); e.pointerMove({ x: 150, y: 50 }); e.sprayTick(); e.pointerUp({ x: 150, y: 50 });
  const op = e.tree.currentNode.op; assert.ok(op.pts.length > 40, "중간 지점이 op에 기록된다");
  const { replay } = await import("../src/ops.js");
  assert.ok(replay(new Bitmap(200, 100, WHITE), [op]).equals(e.bm), "연산 재생 = 화면 결과");
  for (let x = 12; x < 148; x += 12) assert.ok([-2, -1, 0, 1, 2].some((dx) => [-3, -2, -1, 0, 1, 2, 3].some((dy) => e.bm.get(x + dx, 50 + dy) === BLACK)), `x=${x} 근처에 점이 있다`);
});
test("에어브러시: 실제 타이머로도 누르고 있는 동안 점이 늘고 손을 떼면 멈춘다", async () => {
  const e = mk({ ...P, width: 100, height: 80 }, { sprayMs: 10 }); e.setTool("airbrush");
  e.pointerDown({ x: 50, y: 40 }); await new Promise((r) => setTimeout(r, 120));
  const n = e.live.op.pts.length; assert.ok(n > 4, `타이머가 점을 더한다 (${n})`);
  e.pointerUp({ x: 50, y: 40 }); const after = e.tree.currentNode.op.pts.length; await new Promise((r) => setTimeout(r, 60));
  assert.equal(e.tree.currentNode.op.pts.length, after, "손을 떼면 더 뿌려지지 않는다"); assert.equal(e._sprayTimer, 0);
});
test("에어브러시: 미러(스크린)에서도 같은 점 모양", () => {
  const e = mk({ ...P, width: 100, height: 80 }, { sprayMs: 0 }), out = [];
  const b = new StrokeBatcher((m) => out.push(m), "q", 30, { set: () => 1, clear: () => {} }); e.on("op", (ev) => b.push(ev));
  e.setTool("airbrush"); e.pointerDown({ x: 30, y: 40 }); for (let i = 0; i < 10; i++) e.sprayTick(); e.pointerMove({ x: 70, y: 40 }); e.pointerUp({ x: 70, y: 40 }); b.flush();
  const a = new StrokeAssembler({ ...P, width: 100, height: 80 }, () => {}, e.env); out.forEach((m) => a.apply(m)); assert.ok(a.view().equals(e.bm));
});
