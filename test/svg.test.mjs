import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/svg/model.js";
import { parsePathD, parseTransform } from "../src/svg/parse.js";

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≉ ${b}`);

test("사각형 이동·크기 변경은 사각형으로 유지된다", () => {
  const r = M.make("rect", { x: 10, y: 10, w: 20, h: 10 });
  assert.deepEqual(M.bbox(M.translate(r, 5, -5)), { x: 15, y: 5, w: 20, h: 10 });
  const s = M.resizeTo(r, M.bbox(r), { x: 0, y: 0, w: 40, h: 40 }); assert.equal(s.type, "rect"); assert.deepEqual(M.bbox(s), { x: 0, y: 0, w: 40, h: 40 });
});
test("회전한 사각형은 패스가 되고 경계 상자가 맞다", () => {
  const r = M.rotateM(90, 20, 20), o = M.applyMatrix(M.make("rect", { x: 10, y: 10, w: 20, h: 10 }), r);
  assert.equal(o.type, "path"); const b = M.bbox(o); near(b.w, 10); near(b.h, 20);
});
test("타원→패스 변환의 경계는 원래 타원과 같다", () => {
  const e = M.make("ellipse", { cx: 50, cy: 50, rx: 30, ry: 20 }), b = M.bbox(M.toPath(e));
  near(b.x, 20, 0.5); near(b.w, 60, 0.5); near(b.h, 40, 0.5);
});
test("패스 d 직렬화와 파싱이 왕복한다", () => {
  const p = M.make("path", { nodes: [{ x: 0, y: 0, ox: 10, oy: 0 }, { x: 50, y: 50, ix: 40, iy: 50 }, { x: 80, y: 10 }], closed: true });
  const subs = parsePathD(M.pathD(p)); assert.equal(subs.length, 1); assert.equal(subs[0].closed, true); assert.equal(subs[0].nodes.length, 3); assert.equal(subs[0].nodes[0].ox, 10);
});
test("상대 명령·호·닫기 파싱", () => {
  const [a, b] = parsePathD("M10 10 h10 v10 z m5 5 a5 5 0 0 1 10 0"); assert.equal(a.closed, true); assert.equal(a.nodes.length, 3);
  assert.ok(b.nodes.length >= 2); near(b.nodes.at(-1).x, 25, 1e-4); near(b.nodes.at(-1).y, 15, 1e-4);
});
test("transform 문자열 → 행렬", () => {
  const m = M.mul(parseTransform("translate(10 20) scale(2)"), M.IDENT); assert.deepEqual(m, [2, 0, 0, 2, 10, 20]);
  const r = parseTransform("rotate(90)"); near(r[0], 0); near(r[1], 1);
});
test("hit: 채움이 있으면 안쪽, 없으면 테두리만 맞는다", () => {
  const f = M.make("rect", { x: 0, y: 0, w: 100, h: 100 }, { fill: "#000" }), n = M.make("rect", { x: 0, y: 0, w: 100, h: 100 }, { fill: "none", sw: 2 });
  assert.ok(M.hit(f, 50, 50)); assert.ok(!M.hit(n, 50, 50)); assert.ok(M.hit(n, 1, 50));
});
test("정렬·분배·정돈·그룹", () => {
  const d = M.newDoc(); const L = d.layers[0];
  const a = M.make("rect", { x: 0, y: 0, w: 10, h: 10 }), b = M.make("rect", { x: 50, y: 30, w: 20, h: 10 }), c = M.make("rect", { x: 200, y: 5, w: 10, h: 10 });
  L.objs.push(a, b, c); const ids = [a.id, b.id, c.id];
  M.align(d, ids, "left"); assert.deepEqual(L.objs.map((o) => o.x), [0, 0, 0]);
  M.align(d, ids, "vcenter"); const ys = L.objs.map((o) => o.y + o.h / 2); assert.ok(ys.every((y) => Math.abs(y - ys[0]) < 1e-9));
  M.arrange(d, [a.id], "front"); assert.equal(L.objs.at(-1).id, a.id); M.arrange(d, [a.id], "back"); assert.equal(L.objs[0].id, a.id);
  const g = M.group(d, [a.id, b.id]); assert.equal(g.children.length, 2); assert.equal(L.objs.length, 2);
  assert.deepEqual(M.ungroup(d, [g.id]).sort(), [a.id, b.id].sort()); assert.equal(L.objs.length, 3);
  M.mapSel(d, [a.id], (o) => M.translate(o, 0, 100)); M.mapSel(d, [b.id], (o) => M.translate(o, 0, 200));
  M.distribute(d, ids, "v"); const cs = ids.map((id) => M.bbox(M.findObj(d, id).obj)).sort((p, q) => p.y - q.y).map((q) => q.y + q.h / 2); near(cs[1] - cs[0], cs[2] - cs[1], 1e-6);
});
test("되돌리기 기록", () => {
  const d = M.newDoc(); const h = new M.History(d); d.layers[0].objs.push(M.make("rect", { x: 0, y: 0, w: 1, h: 1 })); h.push(d);
  assert.equal(h.undo().layers[0].objs.length, 0); assert.equal(h.redo().layers[0].objs.length, 1); assert.equal(h.canRedo, false);
});
test("SVG 내보내기: 정리 모드는 내부 id를 지우고 배경을 넣는다", () => {
  const d = M.newDoc(100, 50); d.layers[0].objs.push(M.make("text", { x: 1, y: 2, size: 12, text: "a<b" }, { fill: "#000", stroke: "none" }));
  const s = M.docToSvg(d, { clean: true }); assert.ok(!s.includes("data-id")); assert.ok(s.includes("a&lt;b")); assert.ok(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && s.includes('width="100" height="50"'));
});
test("별·다각형 생성", () => { assert.equal(M.star(0, 0, 10, 5, 5).nodes.length, 10); assert.equal(M.regularPolygon(0, 0, 10, 6).nodes.length, 6); });
test("raw 개체: 행렬 이동·경계·내보내기", () => {
  const o = { id: "r1", type: "raw", markup: '<rect width="10" height="10"/>', m: M.IDENT, bb: { x: 0, y: 0, w: 10, h: 10 }, opacity: 1 };
  const t = M.translate(o, 5, 7); assert.deepEqual(M.bbox(t), { x: 5, y: 7, w: 10, h: 10 });
  const r = M.applyMatrix(o, M.rotateM(90, 5, 5)); near(M.bbox(r).w, 10); assert.ok(M.hit(o, 5, 5) && !M.hit(o, 50, 50));
  const d = M.newDoc(20, 20); d.css = ".a{fill:red}"; d.defs = "<defs/>"; d.rootAttrs = { "font-family": "Arial" }; d.layers[0].objs.push(t);
  const s = M.docToSvg(d, { clean: true }); assert.ok(s.includes("<style>.a{fill:red}</style>") && s.includes('font-family="Arial"') && s.includes('transform="matrix(1 0 0 1 5 7)"') && s.includes('<rect width="10" height="10"/>'));
});
import { parseOrtho, orthoD, movableSegments, moveSegment, distToPolyline } from "../src/svg/ortho.js";
test("직각 연결선: 가운데 구간만 옮길 수 있다", () => {
  const r = parseOrtho("M105 90 V160 H305 V200"); assert.deepEqual(r.pts, [[105, 90], [105, 160], [305, 160], [305, 200]]);
  const m = movableSegments(r.pts); assert.deepEqual(m, [{ si: 1, o: "h" }]);
  const np = moveSegment(r.pts, 1, 140); assert.deepEqual(np, [[105, 90], [105, 140], [305, 140], [305, 200]]);
  assert.equal(orthoD(np), "M105 90L105 140L305 140L305 200");
  assert.equal(parseOrtho("M0 0 C1 1 2 2 3 3"), null); assert.deepEqual(parseOrtho("m10 10 h20 v20 h-20").pts.at(-1), [10, 30]);
  assert.ok(distToPolyline([200, 161], r.pts) < 1.5);
});
