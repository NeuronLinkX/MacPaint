// PaintEngine — 두 게임 공용 드로잉 엔진. JS Paint의 도구·편집 모델을 따른다.
//   도구: 자유형 선택 · 선택 · 지우개 · 채우기 · 색 고르기 · 돋보기 · 연필 · 브러시 · 에어브러시 · 텍스트 · 직선 · 곡선 · 사각형 · 다각형 · 타원 · 둥근 사각형
//   편집: 히스토리 트리(되돌리기/다시 실행/아무 지점 이동), 선택 이동·복사·크기 조절, 잘라내기·복사·붙여넣기, 뒤집기·회전·늘이기·기울이기·색 반전, 이미지 속성
// 모든 변화는 연산(op)으로 기록되고(ops.js), 화면 중계(stream.js)와 리플레이(replay.js)가 같은 연산을 재생한다.
// canvas 없이 만들면 헤드리스(모델만) — Node 테스트에서 픽셀 단위로 검증한다.
import { Bitmap, parseColor, toBase64 } from "./bitmap.js";
import { HistoryTree } from "./history.js";
import { LABELS, applyOp, beginLive, extract, moveSel, normalizeSel, selFromPolygon, selMask, stepLive } from "./ops.js";
import { OBJECT_OPS, Stack } from "./layers.js";
import { scaleBitmap } from "./filters.js";
import { DEFAULT_PALETTE } from "./palette.js";
import { PRESETS, TOOLS } from "./presets.js";
import { browserTextRasterizer } from "./textraster.js";

export { TOOLS };
const FREEHAND = new Set(["pencil", "brush", "eraser", "airbrush"]);
const DRAG_SHAPES = new Set(["line", "rect", "roundrect", "ellipse", "gradient"]);
const ZOOMS = [1, 2, 4, 6, 8];
const ALIAS = { pen: "brush" };

export class PaintEngine {
  constructor(canvas = null, preset = PRESETS.quickdraw, { rasterText, sprayMs = 30 } = {}) {
    this.preset = typeof preset === "string" ? PRESETS[preset] : preset;
    this.sprayMs = sprayMs;                 // 에어브러시: 누르고 있는 동안 이 간격(ms)마다 점을 더 뿌린다(0이면 타이머 없음 — 테스트용)
    const P = this.preset;
    this.env = { rasterText: rasterText ?? browserTextRasterizer() };
    this.paper = parseColor(P.bg);
    this.tree = new HistoryTree(Stack.single(new Bitmap(P.width, P.height, this.paper)), { env: this.env });
    this.stack = this.tree.bitmap;                     // 현재 노드의 레이어 스택(읽기 전용 — 고치지 않는다)
    this.active = this.stack.top.id;                   // 지금 그리는 레이어
    this.sel = null; this.live = null; this.draft = null; this.drag = null; this.text = null; this.poly = null; this.curve = null;
    this.clipboard = null;
    this.palette = DEFAULT_PALETTE.slice();
    this.colors = { fg: P.color, bg: P.bg, third: P.color };
    this.options = { asObject: false, brushShape: "circle", brushSize: P.widths[1], lineWidth: 1, shapeStyle: "outline", airbrushSize: 8, eraserSize: P.eraserWidth, transparent: false, font: "sans-serif", fontSize: 24, bold: false, italic: false, underline: false, roundRadius: 10, fillTol: 0, gradientKind: "linear" };
    this.tool = P.tools[0]; this.widthLevel = 1; this.zoom = 1; this.locked = true;
    this.listeners = {}; this._bound = null; this._raf = 0; this._seq = 0; this._air = 1;
    this.canvas = canvas; this.ctx = null;
    if (canvas && canvas.getContext) { this.ctx = canvas.getContext("2d"); this._fit(); this.render(); }
  }

  // ── 이벤트 ──────────────────────────────────────────
  on(name, fn) { (this.listeners[name] ||= []).push(fn); return () => (this.listeners[name] = this.listeners[name].filter((f) => f !== fn)); }
  emit(name, payload) { for (const fn of this.listeners[name] || []) fn(payload); }
  // 화면 중계용 증분 이벤트(stream.js가 해석): begin · pts · shape · end · cancel · node · goto
  _op(ev) { this.emit("op", ev); }
  _changed() { this.emit("change", this); this.render(); }

  get bm() { return (this.stack.get(this.active) || this.stack.top).bm; }   // 활성 레이어의 비트맵
  get width() { return this.bm.w; }
  get height() { return this.bm.h; }

  // ── 설정 ──────────────────────────────────────────
  get tools() { return this.preset.tools; }
  setTool(t) {
    t = ALIAS[t] || t;
    if (!this.preset.tools.includes(t)) return this.tool;
    if (t !== this.tool) { this._finishPending(); this.tool = t; this.emit("tool", t); }
    return this.tool;
  }
  toggleEraser() { return this.setTool(this.tool === "eraser" ? this.preset.tools.find((x) => x !== "eraser") : "eraser"); }
  setWidth(level) {                                   // 게임 프리셋의 굵기 단계(1·2)
    const w = this.preset.widths[level]; if (!w) return this.widthLevel;
    this.widthLevel = level; this.options.brushSize = w; this.options.lineWidth = Math.max(1, Math.round(w / 4)); this.emit("width", level); return level;
  }
  setOption(k, v) { if (!(k in this.options)) throw new Error(`없는 옵션: ${k}`); this.options[k] = v; if (this.text && ["font", "fontSize", "bold", "italic", "underline"].includes(k)) this.textUpdate({}); this.emit("options", this.options); }
  setColor(slot, css) { if (this.preset.lockColors) return; this.colors[slot] = css; this.emit("colors", this.colors); }
  setPaletteColor(i, css) { this.palette[i] = css; this.emit("palette", this.palette); }
  setLocked(v) { this.locked = !!v; if (v) this._cancelInteraction(); this.emit("lock", this.locked); }
  setZoom(z) { this.zoom = z; this.emit("zoom", z); }
  zoomStep(dir) { const i = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(this.zoom) + dir)); this.setZoom(ZOOMS[i]); }

  // ── 포인터 입력(논리 픽셀 좌표) ──────────────────────
  pointerDown({ x, y, button = 0, shift = false, ctrl = false }) {
    if (this.locked || this.live) return false;
    if (this.drag) { if (this.drag.kind === "select" || this.drag.kind === "move" || this.drag.kind === "resize") this.pointerUp({ x, y }); else return false; }   // 버튼을 캔버스 밖에서 놓아 pointerup을 놓친 선택 드래그는 먼저 끝맺는다
    const p = [Math.round(x), Math.round(y)], { main, other } = this._colorsFor(button, ctrl);
    const t = this.tool, o = this.options;
    if (this.text && !(t === "text" && inBox(this.text.box, p))) this.textCommit();
    if (t === "pick") { const c = this.stack.flat().get(p[0], p[1]); if (c) this.setColor(button === 2 ? "bg" : "fg", cssOf(c)); return true; }
    if (t === "move") { this._pickLayer(p); this.drag = { kind: "layermove", a: p, id: this.active }; return true; }
    if (t === "magnifier") { this.zoomStep(button === 2 ? -1 : 1); return true; }
    if (t === "fill") { this._commitOp({ t: "fill", p, c: main, ...(o.fillTol ? { tol: o.fillTol } : {}), ...(this.sel ? { sel: this.sel } : {}) }); return true; }
    if (t === "select" || t === "freeselect") return this._selectDown(p, ctrl);
    if (t === "text") { if (this.text && inBox(this.text.box, p)) return false; this.drag = { kind: "textbox", a: p }; return true; }
    if (FREEHAND.has(t)) return this._freehandDown(t, p, main);
    if (t === "polygon") return this._polygonDown(p, main, other);
    if (t === "curve") return this._curveDown(p, main);
    if (DRAG_SHAPES.has(t)) {
      this.drag = { kind: "shape", a: p, main, other };
      this._setDraft(this._shapeOp(p, p, main, other, shift)); return true;
    }
    return false;
  }
  pointerMove({ x, y, shift = false }) {
    const p = [Math.round(x), Math.round(y)];
    if (this.live) return this._freehandMove(p);
    const d = this.drag;
    if (d) {
      if (d.kind === "shape") this._setDraft(this._shapeOp(d.a, p, d.main, d.other, shift));
      else if (d.kind === "textbox") this._setBoxPreview(d.a, p);
      else if (d.kind === "select") this._selectDrag(d, p);
      else if (d.kind === "move") this._moveDrag(d, p);
      else if (d.kind === "resize") this._resizeDrag(d, p);
      else if (d.kind === "layermove") this._setDraft({ t: "layer_off", id: d.id, ly: d.id, dx: p[0] - d.a[0], dy: p[1] - d.a[1] });
      else if (d.kind === "curvebend") this._curveBend(d, p);
      else if (d.kind === "curveline") { this.curve.b = p; this._curvePreview(); }
      else if (d.kind === "polyedge") this._polyMove(p);
      return true;
    }
    if (this.poly) this._polyMove(p);
    return false;
  }
  pointerUp({ x, y }) {
    const p = [Math.round(x), Math.round(y)];
    if (this.live) { this._freehandEnd(); return true; }
    const d = this.drag; if (!d) return false;
    this.drag = null;
    if (d.kind === "shape") { const op = this.draft; this._clearDraft(); if (op) this._commitOp(op); }
    else if (d.kind === "textbox") { const box = normalizeSel(d.a, p, this.width, this.height); this._preSel = null; if (box) this.textStart(box); this._changed(); }
    else if (d.kind === "select") this._selectEnd(d, p);
    else if (d.kind === "move") this._moveEnd(d);
    else if (d.kind === "resize") this._resizeEnd(d);
    else if (d.kind === "layermove") { const op = this.draft; this._clearDraft(); if (op && (op.dx || op.dy)) this._commitOp(op); }
    else if (d.kind === "curvebend") this._curveBendEnd();
    else if (d.kind === "curveline") this._curveLineEnd(p);
    else if (d.kind === "polyedge") this._polyEdgeEnd(p);
    return true;
  }
  dblClick({ x, y }) { if (this.tool === "polygon" && this.poly) this._polyClose(); else if (this.tool === "curve" && this.curve) this.finishCurve(); }
  key(name) {
    if (name === "Escape") this._cancelInteraction(true);
    else if (name === "Enter") { if (this.text) this.textCommit(); else if (this.curve) this.finishCurve(); else if (this.poly) this._polyClose(); }
    else if (name === "Delete" && this.sel) this.deleteSelection();
  }
  _colorsFor(button, ctrl) { const c = this.colors; return ctrl ? { main: c.third, other: c.bg } : button === 2 ? { main: c.bg, other: c.fg } : { main: c.fg, other: c.bg }; }

  // ── 자유 그리기(연필·브러시·지우개·에어브러시): 증분 적용 ──
  _freehandDown(t, p, main) {
    const o = this.options, id = ++this._seq;
    const op = t === "pencil" ? { t, pts: [p], c: main }
      : t === "brush" ? { t, pts: [p], c: main, shape: o.brushShape, size: o.brushSize }
      : t === "eraser" ? { t, pts: [p], c: this.stack.get(this.active)?.bg === false ? "transparent" : this.colors.bg, size: o.eraserSize }
      : { t, pts: [p], c: main, size: o.airbrushSize, seed: (this._air = (this._air * 1103515245 + 12345) >>> 0) };
    this.live = { id, ...beginLive(this.bm, headOf(op), p) };
    this._op({ op: "begin", id, draft: headOf(op) }); this._op({ op: "pts", id, seg: [p] });
    if (t === "airbrush") this._startSpray();
    this._changed(); return true;
  }
  _freehandMove(p) {
    const L = this.live, last = L.op.pts[L.op.pts.length - 1];
    if (last[0] === p[0] && last[1] === p[1]) return false;
    const add = (q) => { L.op.pts.push(q); stepLive(L, L.op.pts.length - 1); this._op({ op: "pts", id: L.id, seg: [q] }); };
    if (L.op.t === "airbrush") {            // 빨리 움직여도 끊기지 않게, 반지름의 0.6배 간격으로 중간 지점마다 뿌린다(점은 op에 그대로 기록돼 재생이 같다)
      const dx = p[0] - last[0], dy = p[1] - last[1], n = Math.floor(Math.hypot(dx, dy) / Math.max(2, L.op.size * 0.6));
      for (let i = 1; i <= n; i++) add([Math.round(last[0] + (dx * i) / (n + 1)), Math.round(last[1] + (dy * i) / (n + 1))]);
    }
    add(p); this._changed(); return true;
  }
  // ── 에어브러시(XP 그림판): 마우스를 누르고 가만히 있어도 같은 자리에 점이 계속 쌓인다 ──
  _startSpray() { this._stopSpray(); if (this.sprayMs > 0 && typeof setInterval === "function") this._sprayTimer = setInterval(() => this.sprayTick(), this.sprayMs); }
  _stopSpray() { if (this._sprayTimer) { clearInterval(this._sprayTimer); this._sprayTimer = 0; } }
  sprayTick() {
    const L = this.live; if (!L || L.op.t !== "airbrush") return false;
    const p = L.op.pts[L.op.pts.length - 1].slice();
    L.op.pts.push(p); stepLive(L, L.op.pts.length - 1);
    this._op({ op: "pts", id: L.id, seg: [p] }); this._changed(); return true;
  }
  _freehandEnd() {
    this._stopSpray();
    const { id, op, bm } = this.live; this.live = null;
    this._op({ op: "end", id });
    if (this.options.asObject) { this._commitOp(op); return; }                 // 객체 모드: 새 레이어에 다시 적용
    const tagged = this._tag(op), st = this.stack.clone(); st.setBm(tagged.ly ?? this.active, bm);
    this._record(tagged, st, null);
  }

  // ── 도형 ────────────────────────────────────────
  _shapeOp(a, b, main, other, shift) {
    const t = this.tool, o = this.options;
    if (shift) b = t === "line" ? snap45(a, b) : squareOf(a, b);
    if (t === "line") return { t, a, b, c: main, w: o.lineWidth };
    if (t === "gradient") return { t, a, b, c1: main, c2: other, kind: o.gradientKind, ...(this.sel ? { sel: this.sel } : {}) };
    const style = o.shapeStyle;
    return { t, a, b, c: main, fill: style === "fill" ? main : other, style, w: o.lineWidth, ...(t === "roundrect" ? { r: o.roundRadius } : {}) };
  }
  // ── GIMP식 이미지 작업 ──
  previewFilter(name, params) { this._setDraft({ t: "filter", name, params, ...(this.sel ? { sel: this.sel } : {}) }); }
  cancelPreview() { if (this.draft) { this._clearDraft(); this._changed(); } }
  applyFilter(name, params = {}) { this._clearDraft(); return this._commitOp({ t: "filter", name, params, ...(this.sel ? { sel: this.sel } : {}) }); }
  scaleImage(w, h) { return this._commitOp({ t: "scale", w, h }); }
  cropToSelection() { return this.sel ? this._commitOp({ t: "crop", sel: this.sel }) : false; }
  // ── 레이어 ──
  get layers() { return this.stack.layers; }
  selectLayer(id) { if (!this.stack.has(id) || id === this.active) return false; this._finishPending(); this.active = id; this.emit("layers"); this._changed(); return true; }
  addLayer(name) { const id = this.stack.nextId; if (!this._commitOp({ t: "layer_add", id, name: name || `레이어 ${id}` })) return false; this.active = id; this.emit("layers"); return id; }
  duplicateLayer(id = this.active) { const nid = this.stack.nextId; if (!this._commitOp({ t: "layer_dup", id, nid })) return false; this.active = nid; this.emit("layers"); return nid; }
  deleteLayer(id = this.active) { return this.stack.layers.length > 1 && this._commitOp({ t: "layer_del", id }); }
  moveLayer(id, dir) { const i = this.stack.index(id), to = i + dir; return i >= 0 && to >= 0 && to < this.stack.layers.length && this._commitOp({ t: "layer_move", id, to }); }
  setLayerVisible(id, v) { return this._commitOp({ t: "layer_vis", id, v }); }
  setLayerOpacity(id, o) { return this._commitOp({ t: "layer_opa", id, o }); }
  renameLayer(id, name) { return this._commitOp({ t: "layer_name", id, name }); }
  mergeDown(id = this.active) { const i = this.stack.index(id); if (i <= 0 || !this._commitOp({ t: "layer_merge", id })) return false; this.active = this.stack.layers[i - 1].id; this.emit("layers"); return true; }
  flatten() { if (this.stack.layers.length < 2 || !this._commitOp({ t: "layer_flat" })) return false; this.active = this.stack.top.id; this.emit("layers"); return true; }
  _pickLayer(p) {
    if (this.stack.layers.length < 2) return;
    const hit = [...this.stack.layers].reverse().find((l) => l.visible && !l.bg && (l.bm.get(p[0], p[1]) >>> 24));   // 배경이 아닌 객체의 픽셀을 눌렀을 때만 바꾼다
    if (hit && hit.id !== this.active) { this.active = hit.id; this.emit("layers"); }
  }
  openBitmap(bm) { return this._commitOp({ t: "open", w: bm.w, h: bm.h, data: toBase64(bm) }); }
  toPngBlob() { const bm = this.stack.flat(), c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bm.w, bm.h) : Object.assign(document.createElement("canvas"), { width: bm.w, height: bm.h }); c.getContext("2d").putImageData(new ImageData(bm.bytes(), bm.w, bm.h), 0, 0); return c.convertToBlob ? c.convertToBlob({ type: "image/png" }) : new Promise((ok) => c.toBlob(ok, "image/png")); }
  _setDraft(op) { this.draft = op; this._draftId ||= ++this._seq; this._op({ op: "shape", id: this._draftId, draft: op }); this._changed(); }
  _clearDraft() { if (this._draftId) this._op({ op: "cancel", id: this._draftId }); this.draft = null; this._draftId = 0; }

  _polygonDown(p, main, other) {
    const o = this.options;
    if (!this.poly) { this.poly = { pts: [p, p], main, other }; this.drag = { kind: "polyedge" }; this._polyPreview(); return true; }
    const first = this.poly.pts[0];
    if (this.poly.pts.length >= 4 && Math.hypot(p[0] - first[0], p[1] - first[1]) <= 3 / this.zoom + 2) { this._polyClose(); return true; }
    this.poly.pts[this.poly.pts.length - 1] = p; this.poly.pts.push(p); this._polyPreview(); return true;
  }
  _polyMove(p) { if (!this.poly) return; this.poly.pts[this.poly.pts.length - 1] = p; this._polyPreview(); }
  _polyEdgeEnd(p) { if (this.poly) { this.poly.pts[this.poly.pts.length - 1] = p; this.poly.pts.push(p.slice()); this._polyPreview(); } }
  _polyPreview() { const { pts, main, other } = this.poly, o = this.options; this._setDraft({ t: "polygon", pts: pts.map((q) => q.slice()), c: main, fill: o.shapeStyle === "fill" ? main : other, style: o.shapeStyle, w: o.lineWidth, open: true }); }
  _polyClose() {
    const { pts: all, main, other } = this.poly, o = this.options; this.poly = null; this.drag = null; this._clearDraft();
    const pts = all.slice(0, -1), clean = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
    if (clean.length >= 2) this._commitOp({ t: "polygon", pts: clean, c: main, fill: o.shapeStyle === "fill" ? main : other, style: o.shapeStyle, w: o.lineWidth, ...(clean.length < 3 ? { open: true } : {}) });
  }

  // 곡선: ① 직선을 끌어 놓고 ② 휘는 쪽으로 끌기(최대 2번) ③ 세 번째 클릭·Enter·더블클릭으로 확정
  _curveDown(p, main) {
    if (!this.curve) { this.curve = { a: p, b: p, ctrl: [], main }; this.drag = { kind: "curveline" }; this._curvePreview(); return true; }
    this.drag = { kind: "curvebend", i: this.curve.ctrl.length }; this.curve.ctrl[this.drag.i] = p; this._curvePreview(); return true;
  }
  _curveBend(d, p) { this.curve.ctrl[d.i] = p; this._curvePreview(); }
  _curveBendEnd() { if (this.curve.ctrl.length >= 2) this.finishCurve(); }
  _curveLineEnd(p) { this.curve.b = p; if (p[0] === this.curve.a[0] && p[1] === this.curve.a[1]) { this.curve = null; this._clearDraft(); } else this._curvePreview(); }
  _curvePreview() { const c = this.curve; this._setDraft({ t: "curve", pts: [c.a, c.b, ...c.ctrl], c: c.main, w: this.options.lineWidth }); }
  finishCurve() { const c = this.curve; if (!c) return; this.curve = null; this.drag = null; this._clearDraft(); this._commitOp({ t: "curve", pts: [c.a, c.b, ...c.ctrl], c: c.main, w: this.options.lineWidth }); }

  // ── 선택 ────────────────────────────────────────
  _selectDown(p, ctrl) {
    const s = this.sel;
    if (s) {
      const h = !s.poly && handleAt(s, p, 4 / this.zoom + 1);
      if (h) { this.drag = { kind: "resize", handle: h, start: s, p0: p }; return true; }
      if (inSel(s, p)) { this.drag = { kind: "move", p0: p, copy: ctrl, base: s }; return true; }
    }
    this._setSel(null);
    this.drag = { kind: "select", a: p, pts: [p] }; return true;
  }
  _selectDrag(d, p) {
    if (this.tool === "freeselect") { const l = d.pts[d.pts.length - 1]; if (l[0] !== p[0] || l[1] !== p[1]) d.pts.push(p); this._preSel = selFromPolygon(d.pts, this.width, this.height); this._preSelPath = d.pts; }
    else this._preSel = normalizeSel(d.a, p, this.width, this.height);
    this._changed();
  }
  _selectEnd(d, p) {
    if (p) this._selectDrag(d, p);                       // 놓은 자리까지 영역에 포함(마지막 move가 없어도 끝맺음)
    const s = this._preSel; this._preSel = null; this._preSelPath = null;
    this._setSel(s && s.w * s.h > 0 ? s : null); this._changed();
  }
  _moveDrag(d, p) {
    d.dx = p[0] - d.p0[0]; d.dy = p[1] - d.p0[1];
    this._setDraft({ t: "sel_move", sel: d.base, dx: d.dx, dy: d.dy, copy: d.copy, bg: this.colors.bg, tr: this.options.transparent });
  }
  _moveEnd(d) { const op = this.draft; this._clearDraft(); if (op && (d.dx || d.dy)) this._commitOp(op); }
  _resizeDrag(d, p) {
    const to = resizeRect(d.start, d.handle, p[0] - d.p0[0], p[1] - d.p0[1]);
    this._setDraft({ t: "xform", kind: "resize", sel: d.start, to, bg: this.colors.bg, tr: this.options.transparent });
  }
  _resizeEnd(d) { const op = this.draft; this._clearDraft(); if (op) this._commitOp(op); }
  _setSel(s) { this.sel = s; this.emit("selection", s); }
  selectAll() { this._setSel({ x: 0, y: 0, w: this.width, h: this.height }); this._changed(); }
  deselect() { this._setSel(null); this._changed(); }

  // ── 편집 메뉴 ───────────────────────────────────
  copy() {
    if (!this.sel) return false;
    let c = extract(this.bm, this.sel);
    if (!c.px.some((v) => v >>> 24)) c = extract(this.stack.flat(), this.sel);   // 활성 레이어가 그 영역에 비어 있으면 보이는 그림을 복사
    this.clipboard = { w: c.w, h: c.h, data: toBase64(c) }; return true;
  }
  cut() { if (!this.copy()) return false; return this.deleteSelection(); }
  deleteSelection() { if (!this.sel) return false; return this._commitOp({ t: "sel_delete", sel: this.sel, bg: this.colors.bg }); }
  // 붙여넣기는 새 객체(레이어)로 들어가고, 이동 도구로 위치를 잡는다.
  paste() {
    const c = this.clipboard; if (!c) return false;
    const s = this.sel, cl = (v, max) => Math.max(0, Math.min(v, Math.max(0, max)));
    const x = s ? s.x + Math.round((s.w - c.w) / 2) : 0, y = s ? s.y + Math.round((s.h - c.h) / 2) : 0;   // 선택한 영역이 있으면 그 가운데에 넣는다
    return this.addObject({ w: c.w, h: c.h, data: c.data }, "붙여넣기", cl(x, this.width - c.w), cl(y, this.height - c.h));
  }
  /** 비트맵 조각을 새 레이어로 올린다. x,y를 생략하면 가운데. 캔버스보다 크면 맞춰 줄인다. */
  addObject({ w, h, data }, name = "객체", x, y) {
    const id = this.stack.nextId;
    if (!this._commitOp({ t: "layer_from", id, name, x: x ?? Math.round((this.width - w) / 2), y: y ?? Math.round((this.height - h) / 2), w, h, data })) return false;
    this.active = id; this.emit("layers"); if (this.preset.tools.includes("move")) this.setTool("move"); this._changed(); return true;
  }
  addObjectBitmap(bm, name) {
    const k = Math.min(1, this.width / bm.w, this.height / bm.h), b = k < 1 ? scaleBitmap(bm, Math.max(1, Math.floor(bm.w * k)), Math.max(1, Math.floor(bm.h * k))) : bm;
    return this.addObject({ w: b.w, h: b.h, data: toBase64(b) }, name);
  }
  clear() { if (this.locked || this.isBlank()) return false; return this._commitOp({ t: "clear", c: this.colors.bg }); }

  // ── 이미지 메뉴(선택이 있으면 선택 영역, 없으면 이미지 전체) ──
  flipH() { return this._xform({ kind: "flipH" }); }
  flipV() { return this._xform({ kind: "flipV" }); }
  rotate(deg) { return this._xform({ kind: "rotate", a: deg }); }
  stretch(pctX, pctY) { return this._xform({ kind: "stretch", a: pctX, b: pctY }); }
  skew(degX, degY) { return this._xform({ kind: "skew", a: degX, b: degY }); }
  invert() { return this._xform({ kind: "invert" }); }
  setAttributes(w, h) { return this._commitOp({ t: "attributes", w, h, bg: this.colors.bg }); }
  _xform(o) { if (this.locked) return false; return this._commitOp({ t: "xform", ...o, ...(this.sel ? { sel: this.sel } : {}), bg: this.colors.bg, tr: this.options.transparent }); }

  // ── 텍스트 ──────────────────────────────────────
  textStart(box) {
    const o = this.options;
    this.text = { box, text: "", font: o.font, size: o.fontSize, bold: o.bold, italic: o.italic, underline: o.underline, c: this.colors.fg, bg: this.colors.bg, opaque: !o.transparent };
    this.emit("text", this.text); this._textPreview();
  }
  textUpdate(patch) {
    if (!this.text) return; const o = this.options;
    Object.assign(this.text, { font: o.font, size: o.fontSize, bold: o.bold, italic: o.italic, underline: o.underline }, patch); this._textPreview();
  }
  _textPreview() { this._setDraft({ t: "text", ...this.text }); }
  textCommit() { const t = this.text; if (!t) return false; this.text = null; this._clearDraft(); this.emit("text", null); return t.text.trim() ? this._commitOp({ t: "text", ...t }) : (this._changed(), false); }
  textCancel() { this.text = null; this._clearDraft(); this.emit("text", null); this._changed(); }
  _setBoxPreview(a, p) { this._preSel = normalizeSel(a, p, this.width, this.height); this._changed(); }

  // ── 기록 ────────────────────────────────────────
  _commitOp(op) {
    if (this.locked) return false;
    op = this._tag(op);
    const r = applyOp(this.stack.clone(), op, this.env);
    this._record(op, r.bm, r.sel === undefined ? this.sel : r.sel);
    if (op.nl) { this.active = op.nl.id; this.emit("layers"); }
    return true;
  }
  // 대상 레이어(ly)와 객체 모드의 새 레이어(nl)를 연산에 적는다 — 재생이 어디서나 같은 결과를 내도록.
  _tag(op, draft = false) {
    let o = op;
    if (!draft && this.options.asObject && OBJECT_OPS.has(op.t) && !op.nl) o = { ...o, nl: { id: this.stack.nextId, name: op.t === "text" ? `텍스트: ${String(op.text || "").slice(0, 12)}` : LABELS[op.t] || "객체" } };
    if ((this.stack.layers.length > 1 || o.nl) && o.ly == null) o = { ...o, ly: this.active };
    return o;
  }
  _sync() { this.stack = this.tree.bitmap; if (!this.stack.has(this.active)) this.active = this.stack.top.id; this.emit("layers"); }
  _record(op, bm, sel) {
    const node = this.tree.commit(op, sel, bm);
    this._sync(); this._setSel(sel);
    this._op({ op: "node", node: { id: node.id, parent: node.parent, op, sel: node.sel, label: node.label } });
    this._fit(); this._changed();
  }
  _finishPending() {
    if (this.text) this.textCommit(); if (this.curve) this.finishCurve(); if (this.poly) this._polyClose();
  }
  _cancelInteraction(deselect = false) {
    this._stopSpray();
    if (this.live) { this._op({ op: "cancel", id: this.live.id }); this.live = null; }
    this.drag = null; this.poly = null; this.curve = null; this.text = null; this._preSel = null; this._clearDraft();
    if (deselect) this._setSel(null);
    this._changed();
  }

  // ── 히스토리 ────────────────────────────────────
  get canUndo() { return !!this.preset.undo && this.tree.canUndo(); }
  get canRedo() { return !!this.preset.undo && this.tree.canRedo(); }
  undo() { if (!this.canUndo || this.locked) return false; this._finishPending(); this.tree.undo(); return this._moved(); }
  redo() { if (!this.canRedo || this.locked) return false; this.tree.redo(); return this._moved(); }
  goto(id) { if (!this.preset.undo || this.locked || !this.tree.goto(id)) return false; return this._moved(); }
  _moved() { this._sync(); this._setSel(this.tree.sel); this._op({ op: "goto", id: this.tree.current }); this._fit(); this._changed(); return true; }
  get history() { return this.tree.flatten(); }

  // 문제가 바뀔 때: 기록까지 모두 비운다(저장은 호출자가 reset 전에 toPNG로).
  reset() {
    this._cancelInteraction(true);
    this.tree = new HistoryTree(Stack.single(new Bitmap(this.preset.width, this.preset.height, this.paper)), { env: this.env });
    this._sync(); this._fit(); this._changed();
  }
  isBlank() { return this.stack.layers.length === 1 && this.bm.isUniform(this.paper) && this.bm.w === this.preset.width; }
  toJSON() { return { ...this.tree.toJSON(), w: this.preset.width, h: this.preset.height, bg: this.preset.bg }; }
  load(json) { this._cancelInteraction(true); this.tree = HistoryTree.fromJSON(json, Stack.single(new Bitmap(json.w, json.h, parseColor(json.bg))), { env: this.env }); this._sync(); this._setSel(this.tree.sel); this._fit(); this._changed(); }

  // ── 기존 API 호환(정규화 좌표 0~1): host.js·테스트가 사용 ──
  beginStroke(nx, ny) { return this.pointerDown({ x: nx * this.width, y: ny * this.height }); }
  moveStroke(nx, ny) { return this.pointerMove({ x: nx * this.width, y: ny * this.height }); }
  endStroke() { return this.pointerUp({ x: 0, y: 0 }); }
  cancelStroke() { this._cancelInteraction(); }

  // ── 렌더 ────────────────────────────────────────
  toPNG() { return this.ctx ? (this.paint(true), this.canvas.toDataURL("image/png")) : null; }
  _fit() { const c = this.canvas; if (c && (c.width !== this.bm.w || c.height !== this.bm.h)) { c.width = this.bm.w; c.height = this.bm.h; this.emit("size", [this.bm.w, this.bm.h]); } }
  render() {
    if (!this.ctx || this._raf) return;
    const raf = globalThis.requestAnimationFrame || ((f) => setTimeout(f, 16));
    this._raf = raf(() => { this._raf = 0; this.paint(); });
  }
  // 지금 화면에 보여 줄 비트맵: 자유 그리기 중이면 작업본, 도형·이동 미리보기면 연산을 임시 적용
  view() {
    const st = this.stack;
    if (this.live) return st.composite(new Map([[this.active, this.live.bm]]));
    if (this.draft) { try { return applyOp(st.clone(), this._tag(this.draft, true), this.env).bm.flat(); } catch { return st.flat(); } }
    return st.flat();
  }
  paint(clean = false) {
    if (!this.ctx) return;
    const bm = this.view(); this._fit();
    this.ctx.putImageData(new ImageData(bm.bytes(), bm.w, bm.h), 0, 0);
    if (!clean) this._overlay();
  }
  _overlay() {
    const c = this.ctx, z = this.zoom, s = this._preSel || (this.draft && (this.draft.t === "sel_move" ? moveSel(this.draft.sel, this.draft.dx, this.draft.dy) : this.draft.t === "xform" && this.draft.to ? this.draft.to : null)) || this.sel;
    const box = this.text ? this.text.box : s;
    if (!box) return;
    c.save(); c.lineWidth = 1 / Math.min(z, 4) * 1.5; c.setLineDash([4 / Math.min(z, 4), 3 / Math.min(z, 4)]); c.strokeStyle = "#0057d9";
    if (this.tool === "freeselect" && this._preSelPath) { c.beginPath(); this._preSelPath.forEach(([x, y], i) => (i ? c.lineTo(x + .5, y + .5) : c.moveTo(x + .5, y + .5))); c.stroke(); }
    else if (box.poly && !this.draft) { c.beginPath(); box.poly.forEach(([x, y], i) => (i ? c.lineTo(x + .5, y + .5) : c.moveTo(x + .5, y + .5))); c.closePath(); c.stroke(); }
    else c.strokeRect(box.x + .5, box.y + .5, box.w - 1, box.h - 1);
    c.restore();
  }

  // ── DOM 입력 ────────────────────────────────────
  attach() {
    const cv = this.canvas; if (!cv || this._bound) return;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }; };
    const down = (e) => { if (e.button > 2 || this.locked) return; cv.setPointerCapture?.(e.pointerId); if (this.pointerDown(pos(e))) e.preventDefault(); };
    const move = (e) => { const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for (const ev of evs.length ? evs : [e]) this.pointerMove(pos(ev)); };
    const up = (e) => this.pointerUp(pos(e));
    const dbl = (e) => this.dblClick(pos(e));
    const ctx = (e) => e.preventDefault();
    cv.style.touchAction = "none";
    const h = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: up, lostpointercapture: up, dblclick: dbl, contextmenu: ctx };
    for (const [k, f] of Object.entries(h)) cv.addEventListener(k, f);
    this._bound = h;
  }
  detach() { const cv = this.canvas; if (!cv || !this._bound) return; for (const [k, f] of Object.entries(this._bound)) cv.removeEventListener(k, f); this._bound = null; }
}

// ── 보조 함수 ─────────────────────────────────────────
const cssOf = (c) => `#${[c & 255, (c >>> 8) & 255, (c >>> 16) & 255].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const inBox = (b, p) => p[0] >= b.x && p[1] >= b.y && p[0] < b.x + b.w && p[1] < b.y + b.h;
const maskCache = new WeakMap();
function inSel(s, p) {
  if (!inBox(s, p)) return false;
  if (!s.poly) return true;
  let m = maskCache.get(s); if (!m) maskCache.set(s, (m = selMask(s)));
  return !!m.px[(p[1] - s.y) * s.w + (p[0] - s.x)];
}
function headOf(op) { const { pts, ...head } = op; return head; }
function snap45(a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy); return [Math.round(a[0] + Math.cos(ang) * len), Math.round(a[1] + Math.sin(ang) * len)]; }
function squareOf(a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.max(Math.abs(dx), Math.abs(dy)); return [a[0] + Math.sign(dx || 1) * m, a[1] + Math.sign(dy || 1) * m]; }
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
function handleAt(s, p, r) {
  const xs = { w: s.x, c: s.x + s.w / 2, e: s.x + s.w }, ys = { n: s.y, c: s.y + s.h / 2, s: s.y + s.h };
  for (const h of HANDLES) {
    const hx = h.includes("w") ? xs.w : h.includes("e") ? xs.e : xs.c, hy = h.includes("n") ? ys.n : h.includes("s") ? ys.s : ys.c;
    if (Math.abs(p[0] - hx) <= r && Math.abs(p[1] - hy) <= r) return h;
  }
  return null;
}
function resizeRect(s, h, dx, dy) {
  let l = s.x, t = s.y, r = s.x + s.w, b = s.y + s.h;
  if (h.includes("w")) l += dx; if (h.includes("e")) r += dx; if (h.includes("n")) t += dy; if (h.includes("s")) b += dy;
  return { x: Math.min(l, r - 1), y: Math.min(t, b - 1), w: Math.max(1, r - l), h: Math.max(1, b - t) };
}
