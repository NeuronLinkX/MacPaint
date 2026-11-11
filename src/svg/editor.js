// SVG(벡터) 편집기 UI: 일러스트레이터식 선택·직접 선택·펜·도형·문자·정렬·레이어·내보내기.
import * as M from "./model.js";
import { importRaw, ungroupRaw, restyleRaw, rawFromMarkup, scopeCss, makeMeasure, rawTextLines, setRawText, rawOrthoPaths, setRawPathD, remeasure } from "./raw.js";
import { movableSegments, moveSegment, segMid, distToPolyline } from "./ortho.js";
import { saveBlob, readText, readDataUrl, loadImage, pickFile, toHex, svgToPngBlob } from "../io.js";

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
const I = (d) => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const TOOLS = [
  ["select", "선택 (V)", "V", I('<path d="M5 3l10 6.500-4.500 1.200L13 16.500l-2 1-2.500-5.500L5 15z" fill="currentColor"/>')],
  ["direct", "직접 선택 (A)", "A", I('<path d="M5 3l10 6.500-4.500 1.200L13 16.500l-2 1-2.500-5.500L5 15z"/>')],
  ["pen", "펜 (P)", "P", I('<path d="M4 16l1-5 8-8 3 3-8 8z"/><path d="M13 3l3 3M4 16l4-4"/>')],
  ["rect", "사각형 (M)", "M", I('<rect x="3.500" y="5" width="13" height="10" rx="1"/>')],
  ["ellipse", "타원 (L)", "L", I('<ellipse cx="10" cy="10" rx="7" ry="5.500"/>')],
  ["line", "선 (N)", "N", I('<path d="M4 16L16 4"/>')],
  ["polygon", "다각형 (G)", "G", I('<path d="M10 3l6.500 4.700-2.500 7.800H6L3.500 7.700z"/>')],
  ["star", "별 (S)", "S", I('<path d="M10 2.500l2.300 4.900 5.200.7-3.800 3.700.9 5.300L10 14.600l-4.600 2.500.9-5.300L2.500 8.100l5.200-.7z"/>')],
  ["text", "문자 (T)", "T", I('<path d="M4 5V3.500h12V5M10 3.500v13M7.500 16.500h5"/>')],
  ["eyedrop", "스포이트 (I)", "I", I('<path d="M13 3.500l3.500 3.500-2 2-3.500-3.500zM11 6.500l-7 7V16h2.500l7-7"/>')],
  ["hand", "손 (H)", "H", I('<path d="M7 10V4.500a1 1 0 012 0V9m0-5a1 1 0 012 0V9m0-3.500a1 1 0 012 0V10m0-2.500a1 1 0 012 0V12c0 3-2 5-5 5s-4-1.500-5-3.500L3.500 11c-.5-1 1-1.800 1.800-.8L7 12"/>')],
  ["zoom", "확대/축소 (Z)", "Z", I('<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4M7 9h4M9 7v4"/>')],
];
const KEYS = Object.fromEntries(TOOLS.map((t) => [t[2].toLowerCase(), t[0]]));
const HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const CURSOR = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

export function mountSvgEditor(root, { onToPng, onName, getName, onRecord, onNew } = {}) {
  root.classList.add("svgx");
  let doc = M.newDoc(1200, 800), hist = new M.History(doc), sel = [], tool = "select", active = doc.layers[0].id;
  let rawEd = null, view = { z: 1, x: 0, y: 0 }, drag = null, pen = null, draft = null, anchor = null, space = false, hover = null, clip = null, textEd = null;
  const style = { ...M.STYLE, cap: undefined, join: undefined }, opt = { sides: 5, star: 5, radius: 0 };

  // ── DOM ──
  const bar = el("div", { className: "svgx-bar" }), tools = el("div", { className: "svgx-tools" }), stage = el("div", { className: "svgx-stage" });
  const side = el("aside", { className: "svgx-side" }), status = el("footer", { className: "svgx-status" });
  const NS = "http://www.w3.org/2000/svg", vp = document.createElementNS(NS, "svg"); vp.setAttribute("class", "svgx-vp");
  const world = document.createElementNS(NS, "g"), board = document.createElementNS(NS, "rect"), art = document.createElementNS(NS, "g"), ov = document.createElementNS(NS, "g");
  board.setAttribute("class", "board"); art.setAttribute("class", "rawdoc"); const cssEl = document.createElementNS(NS, "style"); world.append(board, art, ov); vp.append(cssEl, world); stage.append(vp);
  root.append(bar, side, stage, tools, status);

  const btn = (label, fn, title = "", cls = "") => el("button", { type: "button", className: cls, innerHTML: label, onclick: fn, title });
  const sep = () => el("i", { className: "sep" });

  // ── 좌표 ──
  const toDoc = (e) => { const r = vp.getBoundingClientRect(); return [(e.clientX - r.left - view.x) / view.z, (e.clientY - r.top - view.y) / view.z]; };
  const applyView = () => { world.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.z})`); zoomOut.textContent = `${Math.round(view.z * 100)}%`; };
  const zoomAt = (z, sx, sy) => { z = Math.max(0.05, Math.min(32, z)); view.x = sx - ((sx - view.x) / view.z) * z; view.y = sy - ((sy - view.y) / view.z) * z; view.z = z; applyView(); drawOverlay(); };
  const fit = () => { const r = stage.getBoundingClientRect(); const z = Math.min((r.width - 80) / doc.w, (r.height - 80) / doc.h, 4) || 1; view = { z, x: (r.width - doc.w * z) / 2, y: (r.height - doc.h * z) / 2 }; applyView(); drawOverlay(); };
  const center = () => { const r = stage.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };

  // ── 문서 ──
  const objsOfSel = () => sel.map((id) => M.findObj(doc, id)?.obj).filter(Boolean);
  const layerOf = () => doc.layers.find((l) => l.id === active) || doc.layers.at(-1);
  const commit = () => { hist.push(doc); render(); };
  const restore = (d) => { if (!d) return; doc = d; sel = sel.filter((id) => M.findObj(doc, id)); if (!doc.layers.some((l) => l.id === active)) active = doc.layers.at(-1).id; render(); };
  const add = (o) => { layerOf().objs.push(o); sel = [o.id]; commit(); return o; };
  const paintOf = (kind) => ({ fill: kind === "line" || kind === "open" ? "none" : style.fill, stroke: style.stroke === "none" && (kind === "line" || kind === "open") ? "#1b1b1f" : style.stroke, sw: style.sw, opacity: style.opacity, ...(style.cap ? { cap: style.cap } : {}), ...(style.join ? { join: style.join } : {}) });

  // ── 그리기 ──
  function paintArt() {
    const css = scopeCss(doc.css); if (cssEl.textContent !== css) cssEl.textContent = css;
    art.innerHTML = (doc.defs || "") + M.layersSvg(doc); for (const [k, v] of Object.entries(doc.rootAttrs || {})) art.setAttribute(k === "class" ? "data-class" : k, v);
  }
  function render() {
    board.setAttribute("width", doc.w); board.setAttribute("height", doc.h); board.setAttribute("fill", doc.bg === "none" ? "#ffffff" : doc.bg);
    paintArt(); drawOverlay(); syncSide(); applyView();
    info.textContent = `${doc.w} × ${doc.h} px · 개체 ${M.allObjs(doc).length}개${sel.length ? ` · 선택 ${sel.length}` : ""}`; syncBar();
  }
  const S = (tag, attrs) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`;
  function drawOverlay() {
    const z = view.z, px = 1 / z; let h = "";
    const selObjs = objsOfSel();
    if (tool !== "direct") {
      for (const o of selObjs) { const b = M.bbox(o); h += S("rect", { x: b.x, y: b.y, width: b.w, height: b.h, class: "ob", "stroke-width": px }); }
      const b = M.selBox(doc, sel);
      if (b && tool === "select" && !drag?.noHandles) {
        h += S("rect", { x: b.x, y: b.y, width: b.w, height: b.h, class: "sb", "stroke-width": px });
        const hs = 8 * px;
        for (const [n, [fx, fy]] of Object.entries(HANDLES)) h += S("rect", { x: b.x + b.w * fx - hs / 2, y: b.y + b.h * fy - hs / 2, width: hs, height: hs, class: "hd", "data-h": n, "stroke-width": px });
        h += S("line", { x1: b.x + b.w / 2, y1: b.y, x2: b.x + b.w / 2, y2: b.y - 22 * px, class: "ob", "stroke-width": px }) + S("circle", { cx: b.x + b.w / 2, cy: b.y - 22 * px, r: 5 * px, class: "hd", "data-h": "rot", "stroke-width": px });
      }
    } else for (const o of selObjs) {
      const p = o.type === "path" ? o : null; if (!p) { const b = M.bbox(o); h += S("rect", { x: b.x, y: b.y, width: b.w, height: b.h, class: "ob", "stroke-width": px }); continue; }
      h += `<path d="${M.pathD(p)}" class="ob" fill="none" stroke-width="${px}"/>`;
      p.nodes.forEach((n, i) => {
        const on = anchor && anchor.id === p.id && anchor.idx === i;
        for (const [k, hx, hy] of [["i", n.ix, n.iy], ["o", n.ox, n.oy]]) if (hx != null && on) h += S("line", { x1: n.x, y1: n.y, x2: hx, y2: hy, class: "ob", "stroke-width": px }) + S("circle", { cx: hx, cy: hy, r: 4 * px, class: "hd", "data-p": p.id, "data-i": i, "data-k": k, "stroke-width": px });
        const s = 7 * px; h += S("rect", { x: n.x - s / 2, y: n.y - s / 2, width: s, height: s, class: `hd${on ? " on" : ""}`, "data-p": p.id, "data-i": i, "data-k": "a", "stroke-width": px });
      });
    }
    h += segHandles();
    if (draft) h += `<g class="draft">${M.objSvg(draft)}</g>`;
    if (pen) {
      const nodes = pen.hover ? [...pen.nodes, { x: pen.hover[0], y: pen.hover[1] }] : pen.nodes;
      h += `<path d="${M.pathD({ nodes, closed: false })}" class="ob" fill="none" stroke-width="${2 * px}"/>`;
      pen.nodes.forEach((n, i) => { const s = 7 * px; h += S("rect", { x: n.x - s / 2, y: n.y - s / 2, width: s, height: s, class: `hd${i === 0 ? " on" : ""}`, "stroke-width": px }); });
    }
    if (drag?.kind === "marquee") { const [x1, y1, x2, y2] = drag.rect; h += S("rect", { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), class: "mq", "stroke-width": px }); }
    ov.innerHTML = h;
  }

  // ── 직각 연결선: 가운데 꺾이는 구간을 끌어 조절 ──
  const orthoOf = (o) => (o.type === "raw" ? rawOrthoPaths(o).map((r) => ({ pi: r.pi, pts: r.pts.map(([x, y]) => [o.m[0] * x + o.m[2] * y + o.m[4], o.m[1] * x + o.m[3] * y + o.m[5]]), closed: r.closed })) : o.type === "path" && !o.closed && o.nodes.length >= 4 && o.nodes.every((n) => n.ix == null && n.ox == null) ? [{ pi: 0, pts: o.nodes.map((n) => [n.x, n.y]), closed: false }] : []);
  function segHandles() {
    if (sel.length !== 1 || (tool !== "select" && tool !== "direct")) return ""; const o = M.findObj(doc, sel[0])?.obj; if (!o) return "";
    let h = ""; const px = 1 / view.z;
    for (const r of orthoOf(o)) for (const { si, o: ori } of movableSegments(r.pts)) { const [mx, my] = segMid(r.pts, si), w = (ori === "h" ? 16 : 6) * px, hh = (ori === "h" ? 6 : 16) * px; h += S("rect", { x: mx - w / 2, y: my - hh / 2, width: w, height: hh, rx: 3 * px, class: "sg", "data-seg": `${o.id}|${r.pi}|${si}|${ori}`, "stroke-width": px }); }
    return h;
  }
  // 얇은 직각선을 눌러도 고를 수 있게(raw 개체 보조 히트)
  function orthoHit(p) {
    const tol = 5 / view.z;
    for (let li = doc.layers.length - 1; li >= 0; li--) { const l = doc.layers[li]; if (!l.visible || l.locked) continue; for (let i = l.objs.length - 1; i >= 0; i--) { const o = l.objs[i]; if (o.type !== "raw") continue; const b = M.bbox(o); if (p[0] < b.x - tol || p[0] > b.x + b.w + tol || p[1] < b.y - tol || p[1] > b.y + b.h + tol) continue; for (const r of orthoOf(o)) if (distToPolyline(p, r.pts) <= tol) return o; } }
    return null;
  }
  // ── 포인터 ──
  const startOf = (e) => ({ p: toDoc(e), sx: e.clientX, sy: e.clientY });
  vp.addEventListener("pointerdown", (e) => {
    if (textEd) commitText(); if (rawEd) commitRaw();
    // 첫 클릭이 화면을 다시 그리면서 눌린 요소가 사라지면 브라우저가 dblclick을 보내지 않는다 → 직접 감지한다.
    if (tool === "select" || tool === "text" || tool === "direct") {
      const lp = lastDown; lastDown = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (lp && e.timeStamp - lp.t < 450 && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) < 6) { lastDown = null; onDbl(e); return; }
    }
    vp.setPointerCapture(e.pointerId); const p = toDoc(e), t = e.target;
    if (e.button === 1 || tool === "hand" || space) { drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; return; }
    if (tool === "zoom") { const r = vp.getBoundingClientRect(); zoomAt(view.z * (e.altKey ? 0.5 : 2), e.clientX - r.left, e.clientY - r.top); return; }
    if (t.dataset?.seg && (tool === "select" || tool === "direct")) {
      const [id, pi, si, ori] = t.dataset.seg.split("|"), f = M.findObj(doc, id), r = orthoOf(f.obj).find((x) => x.pi === +pi);
      drag = { kind: "seg", id, pi: +pi, si: +si, ori, pts: r.pts, o0: structuredClone(f.obj), inv: f.obj.type === "raw" ? M.invert(f.obj.m) : M.IDENT }; return;
    }
    if (tool === "select") {
      const h = t.dataset?.h;
      if (h === "rot") { const b = M.selBox(doc, sel); drag = { kind: "rotate", c: [b.x + b.w / 2, b.y + b.h / 2], a0: Math.atan2(p[1] - (b.y + b.h / 2), p[0] - (b.x + b.w / 2)), orig: snap() }; return; }
      if (h) { drag = { kind: "resize", h, box: M.selBox(doc, sel), orig: snap() }; return; }
      const o = domHit(t) || orthoHit(p) || M.hitTest(doc, p[0], p[1], 4 / view.z);
      if (o) { if (e.shiftKey) sel = sel.includes(o.id) ? sel.filter((x) => x !== o.id) : [...sel, o.id]; else if (!sel.includes(o.id)) sel = [o.id]; drag = { kind: "move", p, orig: snap(), moved: false, dup: e.altKey }; render(); return; }
      if (!e.shiftKey) sel = []; drag = { kind: "marquee", rect: [...p, ...p], base: [...sel] }; render(); return;
    }
    if (tool === "direct") {
      if (t.dataset?.p) { const o = M.findObj(doc, t.dataset.p).obj; anchor = { id: o.id, idx: +t.dataset.i }; drag = { kind: "anchor", id: o.id, idx: +t.dataset.i, k: t.dataset.k, alt: e.altKey }; drawOverlay(); return; }
      const o = M.hitTest(doc, p[0], p[1], 4 / view.z);
      if (o) { sel = [o.id]; if (o.type !== "path" && o.type !== "group" && o.type !== "text" && o.type !== "image") { M.mapSel(doc, [o.id], M.toPath); hist.push(doc); } anchor = null; render(); } else { sel = []; anchor = null; render(); }
      return;
    }
    if (tool === "eyedrop") { const o = M.hitTest(doc, p[0], p[1], 4 / view.z); if (o) { const c = o.type === "group" ? o.children[0] : o; Object.assign(style, { fill: c.fill, stroke: c.stroke, sw: c.sw ?? style.sw, opacity: c.opacity ?? 1 }); if (sel.length) { M.mapSel(doc, sel, (x) => styled(x, { fill: c.fill, stroke: c.stroke, sw: c.sw, opacity: c.opacity })); commit(); } else syncSide(); } return; }
    if (tool === "text" && t.closest?.("text") && domHit(t)?.type === "raw") { editRawText(t.closest("text")); return; }
    if (tool === "text") { const o = textAt(t, p, 4 / view.z); if (o) { sel = [o.id]; render(); editText(o); } else { const t2 = M.make("text", { x: p[0], y: p[1], size: Math.max(12, style.size || 32), text: "" }, { fill: style.fill === "none" ? "#1b1b1f" : style.fill, stroke: "none", sw: 0 }); layerOf().objs.push(t2); sel = [t2.id]; render(); editText(t2, true); } return; }
    if (tool === "pen") { penDown(p, e); return; }
    drag = { kind: "shape", a: p, shift: e.shiftKey };
  });
  // 실제로 그려진 요소를 눌렀는지 DOM으로 찾는다(선·글자·원본 SVG 모양까지 정확).
  function domHit(t) {
    let n = t?.closest?.("[data-id]"); if (!n) return null;
    while (n.parentNode && !n.parentNode.dataset?.layer) { n = n.parentNode.closest?.("[data-id]"); if (!n) return null; }
    const f = M.findObj(doc, n.dataset.id); return f && !f.layer.locked ? f.obj : null;
  }
  // 글자 개체는 다른 레이어의 큰 개체 아래에 있어도 찾는다(원본 SVG 위에 쓴 글자도 다시 고칠 수 있게).
  function textAt(t, p, tol) {
    const n = t?.closest?.("text"), d = n && domHit(n); if (d?.type === "text") return d;
    for (let li = doc.layers.length - 1; li >= 0; li--) { const l = doc.layers[li]; if (!l.visible || l.locked) continue; for (let i = l.objs.length - 1; i >= 0; i--) if (l.objs[i].type === "text" && M.hit(l.objs[i], p[0], p[1], tol)) return l.objs[i]; }
    return null;
  }
  const snap = () => new Map(sel.map((id) => [id, structuredClone(M.findObj(doc, id).obj)]));
  const styled = (o, patch) => { if (o.type === "raw") return restyleRaw(o, patch);
     const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)); return o.type === "group" ? { ...o, children: o.children.map((c) => styled(c, clean)) } : o.type === "text" ? { ...o, ...clean, stroke: clean.stroke ?? o.stroke } : { ...o, ...clean }; };

  vp.addEventListener("pointermove", (e) => {
    const p = toDoc(e); hoverOut.textContent = `${Math.round(p[0])}, ${Math.round(p[1])}`;
    if (pen) { pen.hover = p; if (drag?.kind === "pen") penDrag(p, e); drawOverlay(); return; }
    if (!drag) return;
    const d = drag;
    if (d.kind === "pan") { view.x = d.vx + e.clientX - d.sx; view.y = d.vy + e.clientY - d.sy; applyView(); return; }
    if (d.kind === "move") {
      let dx = p[0] - d.p[0], dy = p[1] - d.p[1]; if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      if (!d.moved && Math.hypot(dx, dy) * view.z < 3) return; d.moved = true;
      if (d.dup && !d.duped) { d.duped = true; for (const [id, o] of d.orig) { const f = M.findObj(doc, id); const c = M.reid(o); f.layer.objs.splice(f.index, 0, c); } }
      for (const [id, o] of d.orig) { const f = M.findObj(doc, id); f.layer.objs[f.index] = M.translate(o, dx, dy); } paintArt(); drawOverlay(); return;
    }
    if (d.kind === "resize") {
      const b = d.box, h = d.h; let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
      if (h.includes("w")) x1 = p[0]; if (h.includes("e")) x2 = p[0]; if (h.includes("n")) y1 = p[1]; if (h.includes("s")) y2 = p[1];
      if (e.altKey) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; if (h.includes("w") || h.includes("e")) { const r = Math.abs(p[0] - cx); x1 = cx - r; x2 = cx + r; } if (h.includes("n") || h.includes("s")) { const r = Math.abs(p[1] - cy); y1 = cy - r; y2 = cy + r; } }
      let w = Math.max(1, Math.abs(x2 - x1)), hh = Math.max(1, Math.abs(y2 - y1));
      if (e.shiftKey && h.length === 2) { const k = Math.max(w / b.w, hh / b.h); w = b.w * k; hh = b.h * k; if (h.includes("w")) x1 = x2 - w; else x2 = x1 + w; if (h.includes("n")) y1 = y2 - hh; else y2 = y1 + hh; }
      const nb = { x: Math.min(x1, x2), y: Math.min(y1, y2), w, h: hh };
      if (!h.includes("w") && !h.includes("e")) { nb.x = b.x; nb.w = b.w; } if (!h.includes("n") && !h.includes("s")) { nb.y = b.y; nb.h = b.h; }
      for (const [id, o] of d.orig) { const f = M.findObj(doc, id); f.layer.objs[f.index] = M.resizeTo(o, b, nb); } paintArt(); drawOverlay(); return;
    }
    if (d.kind === "rotate") {
      let deg = ((Math.atan2(p[1] - d.c[1], p[0] - d.c[0]) - d.a0) * 180) / Math.PI; if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      const m = M.rotateM(deg, d.c[0], d.c[1]); for (const [id, o] of d.orig) { const f = M.findObj(doc, id); f.layer.objs[f.index] = M.applyMatrix(o, m); } paintArt(); drawOverlay(); return;
    }
    if (d.kind === "marquee") { d.rect[2] = p[0]; d.rect[3] = p[1]; const [x1, y1, x2, y2] = d.rect, bx = Math.min(x1, x2), by = Math.min(y1, y2), bw = Math.abs(x2 - x1), bh = Math.abs(y2 - y1); sel = [...d.base]; for (const l of doc.layers) if (l.visible && !l.locked) for (const o of l.objs) { const b = M.bbox(o); if (b.x < bx + bw && b.x + b.w > bx && b.y < by + bh && b.y + b.h > by && !sel.includes(o.id)) sel.push(o.id); } drawOverlay(); syncSide(); return; }
    if (d.kind === "anchor") {
      const f = M.findObj(doc, d.id), o = f.obj, n = { ...o.nodes[d.idx] };
      if (d.k === "a") { const dx = p[0] - n.x, dy = p[1] - n.y; n.x = p[0]; n.y = p[1]; for (const [a, b] of [["ix", "iy"], ["ox", "oy"]]) if (n[a] != null) { n[a] += dx; n[b] += dy; } }
      else { const [a, b, a2, b2] = d.k === "i" ? ["ix", "iy", "ox", "oy"] : ["ox", "oy", "ix", "iy"]; n[a] = p[0]; n[b] = p[1]; if (!e.altKey && n[a2] != null) { const l = Math.hypot(n[a2] - n.x, n[b2] - n.y), vx = n.x - p[0], vy = n.y - p[1], vl = Math.hypot(vx, vy) || 1; n[a2] = n.x + (vx / vl) * l; n[b2] = n.y + (vy / vl) * l; } }
      o.nodes = o.nodes.map((q, i) => (i === d.idx ? n : q)); paintArt(); drawOverlay(); return;
    }
    if (d.kind === "seg") {
      const k = d.ori === "h" ? 1 : 0, v = p[k], np = moveSegment(d.pts, d.si, v), o0 = d.o0;
      if (o0.type === "raw") { const loc = np.map(([x, y]) => [d.inv[0] * x + d.inv[2] * y + d.inv[4], d.inv[1] * x + d.inv[3] * y + d.inv[5]]); M.mapSel(doc, [d.id], () => setRawPathD(o0, d.pi, loc)); }
      else M.mapSel(doc, [d.id], () => ({ ...o0, nodes: np.map(([x, y]) => ({ x, y })) }));
      paintArt(); drawOverlay(); d.moved = true; return;
    }
    if (d.kind === "shape") { draft = shapeOf(d.a, p, e.shiftKey, e.altKey); drawOverlay(); }
  });
  const end = (e) => {
    const d = drag; drag = null; if (!d) return;
    if (d.kind === "pen") { drag = null; return; }
    if (d.kind === "shape") { const o = draft; draft = null; if (o) add(o); else render(); return; }
    if (d.kind === "move" && !d.moved) { render(); return; }
    if (d.kind === "seg") { if (d.moved) { M.mapSel(doc, [d.id], (o) => (o.type === "raw" ? remeasure(o, doc) : o)); commit(); } else render(); return; }
    if (["move", "resize", "rotate", "anchor"].includes(d.kind)) { commit(); return; }
    render();
  };
  vp.addEventListener("pointerup", end); vp.addEventListener("pointercancel", end);
  let lastDown = null, lastDbl = -1e9;
  vp.addEventListener("dblclick", onDbl);
  function onDbl(e) {
    if (e.timeStamp - lastDbl < 300) return; lastDbl = e.timeStamp;
    if (pen) { finishPen(); return; }
    const t = e.target;
    if (tool === "direct" && t.dataset?.p) { const f = M.findObj(doc, t.dataset.p), o = f.obj, i = +t.dataset.i, n = o.nodes[i]; if (n.ix != null || n.ox != null) { delete n.ix; delete n.iy; delete n.ox; delete n.oy; } else { const a = o.nodes[(i - 1 + o.nodes.length) % o.nodes.length], b = o.nodes[(i + 1) % o.nodes.length], dx = (b.x - a.x) / 6, dy = (b.y - a.y) / 6; Object.assign(n, { ix: n.x - dx, iy: n.y - dy, ox: n.x + dx, oy: n.y + dy }); } commit(); return; }
    if (tool === "select" || tool === "text") { const tx = t.closest?.("text"); if (tx && domHit(tx)?.type === "raw") { editRawText(tx); return; } const o = textAt(t, toDoc(e), 4 / view.z); if (o) { sel = [o.id]; render(); editText(o); } }
  }
  vp.addEventListener("wheel", (e) => { e.preventDefault(); const r = vp.getBoundingClientRect(); if (e.ctrlKey || e.metaKey) zoomAt(view.z * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top); else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); } }, { passive: false });
  vp.addEventListener("dragover", (e) => e.preventDefault());
  vp.addEventListener("drop", async (e) => { e.preventDefault(); for (const f of e.dataTransfer.files) await openFile(f); });

  function shapeOf(a, b, shift, alt) {
    let [x1, y1] = a, [x2, y2] = b; if (alt) { x1 = 2 * a[0] - b[0]; y1 = 2 * a[1] - b[1]; }
    if (shift && tool !== "line") { const s = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)); x2 = x1 + Math.sign(x2 - x1 || 1) * s; y2 = y1 + Math.sign(y2 - y1 || 1) * s; }
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1); if (w < 1 && h < 1) return null;
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    if (tool === "rect") return M.make("rect", { x, y, w, h, r: opt.radius }, paintOf());
    if (tool === "ellipse") return M.make("ellipse", { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 }, paintOf());
    if (tool === "line") { if (shift) { const ang = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(x2 - x1, y2 - y1); x2 = x1 + l * Math.cos(ang); y2 = y1 + l * Math.sin(ang); } return M.make("path", { nodes: [{ x: x1, y: y1 }, { x: x2, y: y2 }], closed: false }, paintOf("line")); }
    const r = Math.max(w, h) / 2, cx = x + w / 2, cy = y + h / 2;
    if (tool === "polygon") return M.make("path", M.regularPolygon(cx, cy, r, opt.sides), paintOf());
    if (tool === "star") return M.make("path", M.star(cx, cy, r, r * 0.45, opt.star), paintOf());
  }

  // ── 펜 ──
  function penDown(p, e) {
    if (!pen) pen = { nodes: [], hover: null };
    const f = pen.nodes[0];
    if (f && pen.nodes.length > 2 && Math.hypot(p[0] - f.x, p[1] - f.y) * view.z < 8) { finishPen(true); return; }
    pen.nodes.push({ x: p[0], y: p[1] }); drag = { kind: "pen", idx: pen.nodes.length - 1, start: p }; drawOverlay();
  }
  function penDrag(p, e) { const n = pen.nodes[drag.idx], dx = p[0] - n.x, dy = p[1] - n.y; if (Math.hypot(dx, dy) * view.z < 3) return; n.ox = p[0]; n.oy = p[1]; n.ix = n.x - dx; n.iy = n.y - dy; }
  function finishPen(closed = false) {
    const nodes = pen?.nodes || []; pen = null; drag = null;
    if (nodes.length >= 2) add(M.make("path", { nodes, closed }, paintOf(closed ? undefined : "open")));
    else render();
  }
  vp.addEventListener("pointerup", () => { if (drag?.kind === "pen") drag = null; });

  // ── 문자 ──
  function editText(o, fresh = false) {
    const b = M.bbox(o), ta = el("textarea", { className: "svgx-ta", value: o.text, placeholder: "문자를 입력하세요" });
    const place = () => Object.assign(ta.style, { left: `${view.x + o.x * view.z}px`, top: `${view.y + o.y * view.z}px`, fontSize: `${o.size * view.z}px`, color: o.fill, minWidth: `${Math.max(120, b.w * view.z)}px` });
    place(); stage.append(ta); setTimeout(() => ta.focus()); textEd = { o, ta, fresh };
    ta.oninput = () => { o.text = ta.value; paintArt(); ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; };
    ta.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Escape") { commitText(); } };
    ta.onblur = () => commitText();
  }
  // 원본 SVG 안의 <text>를 제자리에서 고친다(더블클릭 또는 문자 도구로 클릭).
  function editRawText(node) {
    const o = domHit(node); if (!o) return;
    const idx = [...art.querySelectorAll(`[data-id="${o.id}"] text`)].indexOf(node), lines = rawTextLines(o, idx); if (!lines) return;
    sel = [o.id]; drawOverlay();
    const r = node.getBoundingClientRect(), sr = stage.getBoundingClientRect(), cs = getComputedStyle(node), fs = (r.height / lines.length) / 1.2;
    const ta = el("textarea", { className: "svgx-ta", value: lines.join("\n"), rows: lines.length });
    Object.assign(ta.style, { left: `${r.left - sr.left}px`, top: `${r.top - sr.top}px`, minWidth: `${Math.max(80, r.width + 16)}px`, fontSize: `${fs}px`, color: cs.fill, textAlign: cs.textAnchor === "middle" ? "center" : "left", fontFamily: cs.fontFamily, fontWeight: cs.fontWeight });
    stage.append(ta); setTimeout(() => { ta.focus(); ta.select(); });
    ta.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Escape") { ta.value = lines.join("\n"); commitRaw(); } };
    ta.oninput = () => { ta.rows = ta.value.split("\n").length; };
    ta.onblur = () => commitRaw(); rawEd = { id: o.id, idx, ta, lines };
  }
  function commitRaw() {
    if (!rawEd) return; const { id, idx, ta, lines } = rawEd; rawEd = null; ta.onblur = null; const next = ta.value.split("\n"); ta.remove();
    if (next.join("\n") !== lines.join("\n")) { M.mapSel(doc, [id], (o) => setRawText(o, idx, next, doc)); commit(); } else render();
  }
  function commitText() {
    if (!textEd) return; const { o, ta } = textEd; textEd = null; o.text = ta.value; ta.onblur = null; ta.remove();
    if (!o.text.trim()) { const f = M.findObj(doc, o.id); if (f) f.layer.objs.splice(f.index, 1); sel = sel.filter((x) => x !== o.id); }
    commit();
  }

  // ── 상단 막대 ──
  const undoB = btn("↶", () => restore(hist.undo()), "되돌리기 (⌘Z)"), redoB = btn("↷", () => restore(hist.redo()), "다시 실행 (⇧⌘Z)");
  const zoomOut = el("span", { className: "zoomval", textContent: "100%" }), hoverOut = el("span", { className: "coord", textContent: "—" }), info = el("span");
  bar.append(btn("새 문서", () => (onNew ? onNew() : newDocument()), "새 문서 만들기…"), btn("열기…", async () => { for (const f of await pickFile(".svg,image/svg+xml,image/png,image/jpeg,image/webp")) await openFile(f); }, "SVG·이미지 열기"), btn("SVG 저장", saveSvg, "SVG로 저장 (⌘S)", "primary"),
    btn("PNG 내보내기", () => exportPng(1), "PNG로 내보내기"), onToPng ? btn("PNG 편집기로 보내기", () => exportPng(1, true), "래스터 편집기에서 이어서 편집") : null, sep(), undoB, redoB, sep(),
    btn("복제", duplicate, "복제 (⌘D)"), btn("삭제", del, "삭제 (⌫)"), btn("그룹", () => { const g = M.group(doc, sel); if (g) { sel = [g.id]; commit(); } }, "그룹 (⌘G)"), btn("그룹 해제", doUngroup, "그룹 해제 (⇧⌘G)"), el("span", { className: "grow" }),
    btn("−", () => zoomAt(view.z / 1.25, ...center()), "축소"), zoomOut, btn("+", () => zoomAt(view.z * 1.25, ...center()), "확대"), btn("맞춤", fit, "화면에 맞춤 (⌘0)"));
  const syncBar = () => { undoB.disabled = !hist.canUndo; redoB.disabled = !hist.canRedo; };
  status.append(info, hoverOut);

  // ── 도구 상자 ──
  const toolBtns = {};
  for (const [id, title, , icon] of TOOLS) { toolBtns[id] = btn(icon, () => setTool(id), title, "tool"); tools.append(toolBtns[id]); if (id === "text" || id === "star") tools.append(el("hr")); }
  function setTool(t) { if (pen && t !== "pen") finishPen(); tool = t; for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle("on", k === t); stage.dataset.tool = t; if (t !== "direct") anchor = null; drawOverlay(); syncSide(); }

  // ── 속성 패널 ──
  const sideBody = el("div"); side.append(sideBody);
  const tabs = () => el("div", { className: "stabs" }, ...[["props", "속성"], ["code", "코드"]].map(([k, t]) => btn(t, () => { sideTab = k; syncSide(); }, "", k === sideTab ? "on" : "")));
  const row = (label, ...c) => el("label", { className: "row" }, el("span", { textContent: label }), ...c);
  const color = (get, set, nullable = true) => { const i = el("input", { type: "color", value: toHex(get() === "none" ? "#000000" : get()) }), none = el("button", { type: "button", className: get() === "none" ? "on" : "", textContent: "없음", title: "색 없음", onclick: () => set("none") }); i.oninput = () => set(i.value, true); i.onchange = () => set(i.value); return el("span", { className: "col" }, i, nullable ? none : null); };
  function setProp(patch, live = false) {
    Object.assign(style, Object.fromEntries(Object.entries(patch).filter(([k]) => ["fill", "stroke", "sw", "opacity", "cap", "join"].includes(k))));
    if (sel.length) { M.mapSel(doc, sel, (o) => (patch.r !== undefined && o.type === "rect" ? { ...o, r: patch.r } : styled(o, { ...patch, r: undefined }))); live ? (paintArt(), drawOverlay()) : commit(); } else if (!live) syncSide();
  }
  let sideTab = "props";
  function codePanel() {
    const one = sel.length === 1 ? M.findObj(doc, sel[0])?.obj : null, wrap = el("div", { className: "code" });
    const ta = (v) => el("textarea", { value: v, spellcheck: false, wrap: "off" }), kb = (e) => e.stopPropagation();
    const full = ta(M.docToSvg(doc, { clean: true })); full.onkeydown = kb;
    const err = el("p", { className: "err" });
    wrap.append(el("section", {}, el("h4", { textContent: "전체 문서 코드" }), full, btn("전체 코드 적용", () => { try { const d = importRaw(full.value); d.bg = doc.bg === "none" ? d.bg : doc.bg; doc = d; sel = []; active = doc.layers[0].id; commit(); err.textContent = ""; } catch (x) { err.textContent = x.message; } }, "", "primary")));
    if (one) { const t = ta(one.type === "raw" ? one.markup : M.objSvg(one).replace(/ data-id="[^"]*"/g, "")); t.onkeydown = kb;
      wrap.append(el("section", {}, el("h4", { textContent: `선택한 개체 코드 (${NAMES[one.type]})` }), t, btn("개체 코드 적용", () => { try { const n = rawFromMarkup(t.value, doc, one.type === "raw" ? one.m : M.IDENT); n.id = one.id; M.mapSel(doc, [one.id], () => n); commit(); err.textContent = ""; } catch (x) { err.textContent = x.message; } }, "", "primary"))); }
    wrap.append(err); return wrap;
  }
  function syncSide() {
    if (textEd || (sideBody.contains(document.activeElement) && /range|TEXTAREA/.test(document.activeElement.type || document.activeElement.tagName))) return;
    if (sideTab === "code") { sideBody.replaceChildren(tabs(), codePanel()); return; }
    const one = objsOfSel(), first = one[0], tp = first?.type === "text";
    let v = first && first.type !== "group" ? first : first?.children?.[0] || style;
    if (first?.type === "raw") { const n = art.querySelector(`[data-id="${first.id}"] :is(path,rect,circle,ellipse,polygon,text)`); if (n) { const c = getComputedStyle(n); v = { fill: c.fill, stroke: c.stroke, sw: parseFloat(c.strokeWidth) || 1 }; } }
    const cur = { ...style, ...(first ? { fill: v.fill ?? style.fill, stroke: v.stroke ?? style.stroke, sw: v.sw ?? style.sw, opacity: first.opacity ?? 1 } : {}) };
    const sec = (title, ...c) => el("section", {}, el("h4", { textContent: title }), ...c);
    const grid = (...bs) => el("div", { className: "grid" }, ...bs);
    const ids = sel, many = ids.length > 1;
    const align = (how, label, title) => btn(label, () => { M.align(doc, ids, how); commit(); }, title), arr = (how, label, title) => btn(label, () => { M.arrange(doc, ids, how); commit(); }, title);
    const num = (val, min, max, step, fn) => el("input", { type: "number", value: +(+val).toFixed(2), min, max, step, onchange: (e) => fn(Number(e.target.value)) });
    const bits = [
      sec(tp ? "문자" : "칠과 선", row(tp ? "글자색" : "칠", color(() => cur.fill, (c, l) => setProp({ fill: c }, l), !tp)), tp ? null : row("선", color(() => cur.stroke, (c, l) => setProp({ stroke: c }, l))),
        tp ? row("크기", num(first.size, 4, 600, 1, (n) => { M.mapSel(doc, ids, (o) => ({ ...o, size: n })); commit(); })) : row("선 두께", num(cur.sw, 0, 200, 0.5, (n) => setProp({ sw: n }))),
        row("불투명도", Object.assign(el("input", { type: "range", min: 0, max: 100, value: Math.round(cur.opacity * 100) }), { oninput: (e) => setProp({ opacity: e.target.value / 100 }, true), onchange: (e) => setProp({ opacity: e.target.value / 100 }) })),
        tp ? row("굵게", el("input", { type: "checkbox", checked: !!first.bold, onchange: (e) => { M.mapSel(doc, ids, (o) => ({ ...o, bold: e.target.checked })); commit(); } })) : row("끝·모서리", el("select", { onchange: (e) => setProp({ cap: e.target.value || undefined, join: e.target.value ? "round" : undefined }) }, ...[["", "각지게"], ["round", "둥글게"]].map(([v, t]) => Object.assign(el("option", { value: v, textContent: t }), { selected: (cur.cap || "") === v }))))),
    ];
    if (tool === "rect" || first?.type === "rect") bits.push(sec("사각형", row("모서리 반경", num(first?.type === "rect" ? first.r || 0 : opt.radius, 0, 999, 1, (n) => { opt.radius = n; if (first?.type === "rect") setProp({ r: n }); }))));
    if (tool === "polygon") bits.push(sec("다각형", row("변의 수", num(opt.sides, 3, 24, 1, (n) => (opt.sides = n)))));
    if (tool === "star") bits.push(sec("별", row("꼭짓점", num(opt.star, 3, 24, 1, (n) => (opt.star = n)))));
    bits.push(
      sec("정렬", grid(align("left", "⇤", "왼쪽 맞춤"), align("hcenter", "↔", "가운데 맞춤"), align("right", "⇥", "오른쪽 맞춤"), align("top", "⤒", "위 맞춤"), align("vcenter", "↕", "중앙 맞춤"), align("bottom", "⤓", "아래 맞춤"), btn("가로 분배", () => { M.distribute(doc, ids, "h"); commit(); }), btn("세로 분배", () => { M.distribute(doc, ids, "v"); commit(); }))),
      sec("정돈·변형", grid(arr("front", "맨 앞", "맨 앞으로 (⇧⌘])"), arr("forward", "앞으로", "앞으로 (⌘])"), arr("backward", "뒤로", "뒤로 (⌘[)"), arr("back", "맨 뒤", "맨 뒤로 (⇧⌘[)"), btn("좌우 뒤집기", () => { M.flip(doc, ids, "h"); commit(); }), btn("상하 뒤집기", () => { M.flip(doc, ids, "v"); commit(); }), btn("↻ 90°", () => { M.rotateSel(doc, ids, 90); commit(); }), btn("↺ 90°", () => { M.rotateSel(doc, ids, -90); commit(); }))),
      sec("아트보드", row("너비", num(doc.w, 1, 20000, 1, (n) => { doc.w = n; commit(); fit(); })), row("높이", num(doc.h, 1, 20000, 1, (n) => { doc.h = n; commit(); fit(); })), row("배경", color(() => doc.bg, (c, l) => { doc.bg = c; l ? render() : commit(); }))),
      layersSection());
    void many; sideBody.replaceChildren(tabs(), ...bits.filter(Boolean));
  }
  const NAMES = { raw: "SVG 개체", rect: "사각형", ellipse: "타원", path: "패스", text: "문자", image: "이미지", group: "그룹" };
  function layersSection() {
    const s = el("section", { className: "layers" }, el("h4", { textContent: "레이어" }));
    const list = el("div", { className: "list" });
    for (const l of [...doc.layers].reverse()) {
      const name = el("span", { className: "nm", textContent: l.name, ondblclick: () => { const i = el("input", { value: l.name, onblur: () => { l.name = i.value || l.name; commit(); }, onkeydown: (e) => { if (e.key === "Enter") i.blur(); e.stopPropagation(); } }); name.replaceWith(i); i.focus(); i.select(); } });
      list.append(el("div", { className: `lyr${l.id === active ? " on" : ""}`, onclick: () => { active = l.id; syncSide(); } },
        btn(l.visible ? "◉" : "○", (e) => { e.stopPropagation(); l.visible = !l.visible; commit(); }, "보이기"), btn(l.locked ? "🔒" : "🔓", (e) => { e.stopPropagation(); l.locked = !l.locked; commit(); }, "잠금"), name));
      for (const o of [...l.objs].reverse()) list.append(el("div", { className: `obj${sel.includes(o.id) ? " on" : ""}`, textContent: `${o.name || NAMES[o.type]}${o.type === "text" ? ` “${(o.text || "").slice(0, 8)}”` : ""}`, onclick: (e) => { if (l.locked) return; sel = e.shiftKey ? [...new Set([...sel, o.id])] : [o.id]; active = l.id; render(); } }));
    }
    s.append(list, el("div", { className: "grid" }, btn("레이어 +", () => { const l = M.newLayer(`레이어 ${doc.layers.length + 1}`); doc.layers.push(l); active = l.id; commit(); }), btn("레이어 −", () => { if (doc.layers.length < 2) return; doc.layers = doc.layers.filter((l) => l.id !== active); active = doc.layers.at(-1).id; sel = sel.filter((id) => M.findObj(doc, id)); commit(); }),
      btn("▲", () => moveLayer(1), "레이어 위로"), btn("▼", () => moveLayer(-1), "레이어 아래로")));
    return s;
  }
  function moveLayer(d) { const i = doc.layers.findIndex((l) => l.id === active), j = i + d; if (j < 0 || j >= doc.layers.length) return; [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]]; commit(); }

  // ── 동작 ──
  function newDocument(w = 1200, h = 800) { doc = M.newDoc(w, h); hist = new M.History(doc); sel = []; active = doc.layers[0].id; render(); fit(); }
  function doUngroup() {
    const out = [];
    for (const l of doc.layers) l.objs = l.objs.flatMap((o) => {
      if (!sel.includes(o.id)) return [o];
      if (o.type === "raw") { const parts = ungroupRaw(o, doc); if (parts) { out.push(...parts.map((p) => p.id)); return parts; } return [o]; }
      if (o.type === "group") { out.push(...o.children.map((c) => c.id)); return o.children; } return [o];
    });
    sel = out.length ? out : sel; commit();
  }
  function duplicate() { const copies = objsOfSel().map((o) => M.translate(M.reid(o), 12, 12)); if (!copies.length) return; layerOf().objs.push(...copies); sel = copies.map((c) => c.id); commit(); }
  function del() { if (!sel.length) return; for (const l of doc.layers) l.objs = l.objs.filter((o) => !sel.includes(o.id)); sel = []; anchor = null; commit(); }
  function svgText() { return M.docToSvg(doc, { clean: true }); }
  async function saveSvg() { const blob = new Blob([svgText()], { type: "image/svg+xml" }), name = `${(getName?.() || "macPaint").replace(/\.svg$/i, "")}.svg`; await saveBlob(blob, name); onRecord?.({ name, blob, w: doc.w, h: doc.h }); }
  async function exportPng(scale = 1, toEditor = false) { const blob = await svgToPngBlob(svgText(), doc.w, doc.h, scale); if (toEditor) onToPng?.(blob); else saveBlob(blob, "macPaint.png"); }
  async function openFile(f) {
    try {
      if (/svg/i.test(f.type) || /\.svg$/i.test(f.name)) { doc = importRaw(await readText(f)); hist = new M.History(doc); sel = []; active = doc.layers.at(-1).id; render(); fit(); onName?.(f.name); onRecord?.({ name: f.name, blob: f, w: doc.w, h: doc.h }); return; }
      const href = await readDataUrl(f), img = await loadImage(href), k = Math.min(1, (doc.w * 0.8) / img.width, (doc.h * 0.8) / img.height);
      add(M.make("image", { x: (doc.w - img.width * k) / 2, y: (doc.h - img.height * k) / 2, w: img.width * k, h: img.height * k, href }));
    } catch (err) { info.textContent = `열기 실패: ${err.message}`; }
  }

  // ── 단축키 ──
  const onKey = (e) => {
    if (!root.offsetParent || e.target.matches?.("input,textarea,select")) return;
    const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
    if (k === "enter" && sel.length === 1) { const o = M.findObj(doc, sel[0])?.obj; if (o?.type === "text") { e.preventDefault(); editText(o); return; } }
    if (k === " ") { space = true; stage.classList.add("pan"); e.preventDefault(); return; }
    if (c && k === "z") restore(e.shiftKey ? hist.redo() : hist.undo());
    else if (c && k === "y") restore(hist.redo());
    else if (c && k === "d") duplicate(); else if (c && k === "g") { if (e.shiftKey) doUngroup(); else { const g = M.group(doc, sel); if (g) { sel = [g.id]; commit(); } } }
    else if (c && k === "a") { sel = M.allObjs(doc).map((o) => o.id); render(); } else if (c && k === "s") saveSvg();
    else if (c && k === "0") fit(); else if (c && (k === "=" || k === "+")) zoomAt(view.z * 1.25, ...center()); else if (c && k === "-") zoomAt(view.z / 1.25, ...center());
    else if (c && (k === "]" || k === "[")) { M.arrange(doc, sel, k === "]" ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward"); commit(); }
    else if (k === "delete" || k === "backspace") del();
    else if (k === "enter" && pen) finishPen(); else if (k === "escape") { if (pen) finishPen(); else { sel = []; anchor = null; render(); } }
    else if (k.startsWith("arrow") && sel.length) { const s = e.shiftKey ? 10 : 1, d = { arrowleft: [-s, 0], arrowright: [s, 0], arrowup: [0, -s], arrowdown: [0, s] }[k]; M.mapSel(doc, sel, (o) => M.translate(o, ...d)); commit(); }
    else if (!c && KEYS[k]) setTool(KEYS[k]); else return;
    e.preventDefault();
  };
  // 복사·잘라내기·붙여넣기는 앱 메뉴와 키보드 모두 clipboard 이벤트로 들어온다.
  const live = () => root.offsetParent && !document.activeElement?.matches?.("input,textarea,select");
  const onCopy = (e) => { if (live() && sel.length) { clip = objsOfSel().map((o) => structuredClone(o)); e.preventDefault(); } };
  const onCut = (e) => { if (live() && sel.length) { clip = objsOfSel().map((o) => structuredClone(o)); del(); e.preventDefault(); } };
  const onPaste = (e) => {
    if (!live()) return; const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/")); e.preventDefault();
    if (f) { openFile(f); return; } if (!clip?.length) return;
    const cp = clip.map((o) => M.translate(M.reid(o), 12, 12)); layerOf().objs.push(...cp); clip = cp.map((o) => structuredClone(o)); sel = cp.map((o) => o.id); commit();
  };
  addEventListener("copy", onCopy); addEventListener("cut", onCut); addEventListener("paste", onPaste);
  const onKeyUp = (e) => { if (e.key === " ") { space = false; stage.classList.remove("pan"); } };
  addEventListener("keydown", onKey); addEventListener("keyup", onKeyUp);
  new ResizeObserver(() => { if (!view.fitted && stage.clientWidth) { view.fitted = true; fit(); } }).observe(stage);

  // 투명 배경 격자 무늬
  vp.insertAdjacentHTML("afterbegin", '<defs><pattern id="chk" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#fff"/><rect width="8" height="8" fill="#e4e4e8"/><rect x="8" y="8" width="8" height="8" fill="#e4e4e8"/></pattern></defs>');
  setTool("select"); render();
  return { newDocument, isDirty: () => hist.canUndo, destroy() { removeEventListener("copy", onCopy); removeEventListener("cut", onCut); removeEventListener("paste", onPaste); removeEventListener("keydown", onKey); removeEventListener("keyup", onKeyUp); }, fit, openFile, getDoc: () => doc, setDoc: (d) => { doc = d; hist = new M.History(doc); sel = []; render(); fit(); }, svgText };
}
