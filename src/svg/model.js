// SVG 편집기의 문서 모델: DOM 없이 동작하는 순수 함수 모음(Node에서 테스트한다).
// 문서 = { w, h, bg, layers:[{id,name,visible,locked,objs:[obj…]}] }
// 개체 = { id, type:"rect|ellipse|path|text|image|group", fill, stroke, sw, opacity, … }
//   rect{x,y,w,h,r} · ellipse{cx,cy,rx,ry} · path{nodes:[{x,y,ix,iy,ox,oy}],closed} · text{x,y,size,text} · image{x,y,w,h,href} · group{children}
// 변형은 행렬을 개체에 구워 넣는다(회전한 사각형은 패스가 된다). 선 두께는 변형해도 유지한다.
let _n = 0;
export const uid = () => `o${Date.now().toString(36)}${(_n++).toString(36)}`;
export const K = 0.5522847498;                                   // 원을 베지어 4개로 근사하는 상수

export const newDoc = (w = 800, h = 600) => ({ w, h, bg: "#ffffff", layers: [newLayer("레이어 1")] });
export const newLayer = (name) => ({ id: uid(), name, visible: true, locked: false, objs: [] });
export const STYLE = { fill: "#2f6fed", stroke: "#1b1b1f", sw: 2, opacity: 1 };
export const make = (type, geom, style = {}) => ({ id: uid(), type, ...STYLE, ...style, ...geom });
export const clone = (o) => structuredClone(o);
export const reid = (o) => { const c = clone(o); const walk = (x) => { x.id = uid(); x.children?.forEach(walk); }; walk(c); return c; };

// ── 행렬 [a b c d e f] ──
export const IDENT = [1, 0, 0, 1, 0, 0];
export const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
export const translateM = (dx, dy) => [1, 0, 0, 1, dx, dy];
export const scaleM = (sx, sy, cx = 0, cy = 0) => [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
export const rotateM = (deg, cx = 0, cy = 0) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]; };
const pt = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const isAxis = (m) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
export const invert = (m) => { const d = m[0] * m[3] - m[1] * m[2]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
export const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

// ── 패스 ──
export function pathD(o) {
  const n = o.nodes; if (!n.length) return "";
  const f = (v) => +v.toFixed(2); let d = `M${f(n[0].x)} ${f(n[0].y)}`;
  const seg = (a, b) => { const curve = a.ox != null || b.ix != null; return curve ? `C${f(a.ox ?? a.x)} ${f(a.oy ?? a.y)} ${f(b.ix ?? b.x)} ${f(b.iy ?? b.y)} ${f(b.x)} ${f(b.y)}` : `L${f(b.x)} ${f(b.y)}`; };
  for (let i = 1; i < n.length; i++) d += seg(n[i - 1], n[i]);
  if (o.closed && n.length > 1) { const a = n[n.length - 1], b = n[0]; if (a.ox != null || b.ix != null) d += seg(a, b); d += "Z"; }
  return d;
}
const bez = (p0, p1, p2, p3, t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };
export function flatten(o, steps = 14) {                              // 패스 → 점열
  const n = o.nodes, out = []; if (!n.length) return out;
  out.push([n[0].x, n[0].y]);
  const seg = (a, b) => {
    if (a.ox == null && b.ix == null) { out.push([b.x, b.y]); return; }
    const c1 = [a.ox ?? a.x, a.oy ?? a.y], c2 = [b.ix ?? b.x, b.iy ?? b.y];
    for (let i = 1; i <= steps; i++) { const t = i / steps; out.push([bez(a.x, c1[0], c2[0], b.x, t), bez(a.y, c1[1], c2[1], b.y, t)]); }
  };
  for (let i = 1; i < n.length; i++) seg(n[i - 1], n[i]);
  if (o.closed && n.length > 1) seg(n[n.length - 1], n[0]);
  return out;
}
const N = (x, y, h = {}) => ({ x, y, ...h });
export function toPath(o) {
  if (o.type === "path") return o;
  const base = { id: o.id, type: "path", fill: o.fill, stroke: o.stroke, sw: o.sw, opacity: o.opacity, cap: o.cap, join: o.join, closed: true };
  if (o.type === "ellipse") {
    const { cx, cy, rx, ry } = o, kx = rx * K, ky = ry * K;
    return { ...base, nodes: [N(cx, cy - ry, { ix: cx - kx, iy: cy - ry, ox: cx + kx, oy: cy - ry }), N(cx + rx, cy, { ix: cx + rx, iy: cy - ky, ox: cx + rx, oy: cy + ky }), N(cx, cy + ry, { ix: cx + kx, iy: cy + ry, ox: cx - kx, oy: cy + ry }), N(cx - rx, cy, { ix: cx - rx, iy: cy + ky, ox: cx - rx, oy: cy - ky })] };
  }
  if (o.type === "rect" || o.type === "image") {
    const { x, y, w, h } = o, r = Math.min(o.r || 0, w / 2, h / 2);
    if (!(r > 0)) return { ...base, nodes: [N(x, y), N(x + w, y), N(x + w, y + h), N(x, y + h)] };
    const k = K * r;
    return { ...base, nodes: [
      N(x + r, y, { ix: x + r - k, iy: y }), N(x + w - r, y, { ox: x + w - r + k, oy: y }), N(x + w, y + r, { ix: x + w, iy: y + r - k }), N(x + w, y + h - r, { ox: x + w, oy: y + h - r + k }),
      N(x + w - r, y + h, { ix: x + w - r + k, iy: y + h }), N(x + r, y + h, { ox: x + r - k, oy: y + h }), N(x, y + h - r, { ix: x, iy: y + h - r + k }), N(x, y + r, { ox: x, oy: y + r - k })] };
  }
  return o;
}
export const regularPolygon = (cx, cy, r, n, rot = -90) => ({ closed: true, nodes: Array.from({ length: n }, (_, i) => { const a = ((rot + (360 / n) * i) * Math.PI) / 180; return N(cx + r * Math.cos(a), cy + r * Math.sin(a)); }) });
export const star = (cx, cy, r1, r2, n, rot = -90) => ({ closed: true, nodes: Array.from({ length: n * 2 }, (_, i) => { const a = ((rot + (180 / n) * i) * Math.PI) / 180, r = i % 2 ? r2 : r1; return N(cx + r * Math.cos(a), cy + r * Math.sin(a)); }) });

// ── 경계 상자 ──
export const textLines = (o) => String(o.text ?? "").split("\n");
const charW = (s, size) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 1 : 0.55), 0) * size;
export function bbox(o) {
  switch (o.type) {
    case "rect": case "image": return { x: o.x, y: o.y, w: o.w, h: o.h };
    case "ellipse": return { x: o.cx - o.rx, y: o.cy - o.ry, w: o.rx * 2, h: o.ry * 2 };
    case "path": return pointsBox(flatten(o)) || { x: 0, y: 0, w: 0, h: 0 };
    case "text": { const L = textLines(o); return { x: o.x, y: o.y, w: Math.max(1, ...L.map((s) => charW(s, o.size))), h: L.length * o.size * 1.2 }; }
    case "group": return unionBox(o.children.map(bbox)) || { x: 0, y: 0, w: 0, h: 0 };
    case "raw": return pointsBox(rawCorners(o)) || { x: 0, y: 0, w: 0, h: 0 };
  }
}
export const rawCorners = (o) => [[o.bb.x, o.bb.y], [o.bb.x + o.bb.w, o.bb.y], [o.bb.x + o.bb.w, o.bb.y + o.bb.h], [o.bb.x, o.bb.y + o.bb.h]].map(([x, y]) => pt(o.m, x, y));
const pointsBox = (ps) => { if (!ps.length) return null; let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const [x, y] of ps) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); } return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }; };
export const unionBox = (bs) => { if (!bs.length) return null; const x1 = Math.min(...bs.map((b) => b.x)), y1 = Math.min(...bs.map((b) => b.y)), x2 = Math.max(...bs.map((b) => b.x + b.w)), y2 = Math.max(...bs.map((b) => b.y + b.h)); return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }; };

// ── 변형 ──
export function applyMatrix(o, m) {
  const axis = isAxis(m);
  switch (o.type) {
    case "raw": return { ...o, m: mul(m, o.m) };
    case "group": return { ...o, children: o.children.map((c) => applyMatrix(c, m)) };
    case "rect": case "image": {
      if (!axis) return o.type === "image" ? { ...o, ...centerMove(o, m) } : applyMatrix(toPath(o), m);
      const [x1, y1] = pt(m, o.x, o.y), [x2, y2] = pt(m, o.x + o.w, o.y + o.h);
      return { ...o, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), ...(o.r ? { r: o.r * Math.min(Math.abs(m[0]), Math.abs(m[3])) } : {}) };
    }
    case "ellipse": {
      if (!axis) return applyMatrix(toPath(o), m);
      const [cx, cy] = pt(m, o.cx, o.cy); return { ...o, cx, cy, rx: o.rx * Math.abs(m[0]), ry: o.ry * Math.abs(m[3]) };
    }
    case "path": {
      const P = (x, y) => (x == null ? [undefined, undefined] : pt(m, x, y));
      return { ...o, nodes: o.nodes.map((n) => { const [x, y] = pt(m, n.x, n.y), [ix, iy] = P(n.ix, n.iy), [ox, oy] = P(n.ox, n.oy); return { x, y, ...(ix != null ? { ix, iy } : {}), ...(ox != null ? { ox, oy } : {}) }; }) };
    }
    case "text": { const [x, y] = pt(m, o.x, o.y); return { ...o, x, y, size: o.size * scaleOf(m), rot: (o.rot || 0) + (Math.atan2(m[1], m[0]) * 180) / Math.PI }; }
  }
}
const centerMove = (o, m) => { const [cx, cy] = pt(m, o.x + o.w / 2, o.y + o.h / 2); return { x: cx - o.w / 2, y: cy - o.h / 2 }; };
export const translate = (o, dx, dy) => applyMatrix(o, translateM(dx, dy));
export const resizeTo = (o, from, to) => applyMatrix(o, mul(translateM(to.x, to.y), mul(scaleM(from.w ? to.w / from.w : 1, from.h ? to.h / from.h : 1), translateM(-from.x, -from.y))));

// ── 맞춤 검사 ──
const distSeg = (px, py, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l)) : 0; return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy)); };
const inPoly = (px, py, ps) => { let c = false; for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) { const [xi, yi] = ps[i], [xj, yj] = ps[j]; if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c; } return c; };
const filled = (o) => o.fill && o.fill !== "none";
export function hit(o, x, y, tol = 4) {
  const half = (o.stroke && o.stroke !== "none" ? o.sw / 2 : 0) + tol;
  switch (o.type) {
    case "group": return o.children.some((c) => hit(c, x, y, tol));
    case "raw": return inPoly(x, y, rawCorners(o));
    case "text": case "image": { const b = bbox(o); return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol; }
    case "rect": { const inside = x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h; if (filled(o) && inside) return true; return hit(toPath(o), x, y, tol); }
    case "ellipse": { const q = ((x - o.cx) / o.rx) ** 2 + ((y - o.cy) / o.ry) ** 2; if (filled(o) && q <= 1) return true; return hit(toPath(o), x, y, tol); }
    case "path": {
      const ps = flatten(o); if (o.closed && filled(o) && inPoly(x, y, ps)) return true;
      const end = o.closed ? ps.length : ps.length - 1; for (let i = 0; i < end; i++) if (distSeg(x, y, ps[i], ps[(i + 1) % ps.length]) <= half) return true;
      return !o.closed && ps.length === 1 && Math.hypot(x - ps[0][0], y - ps[0][1]) <= half;
    }
  }
}

// ── 문서 연산 ──
export const allObjs = (doc) => doc.layers.flatMap((l) => l.objs);
export const findObj = (doc, id) => { for (const l of doc.layers) { const i = l.objs.findIndex((o) => o.id === id); if (i >= 0) return { layer: l, index: i, obj: l.objs[i] }; } return null; };
export const hitTest = (doc, x, y, tol = 4) => { for (let li = doc.layers.length - 1; li >= 0; li--) { const l = doc.layers[li]; if (!l.visible || l.locked) continue; for (let i = l.objs.length - 1; i >= 0; i--) if (hit(l.objs[i], x, y, tol)) return l.objs[i]; } return null; };
export const selBox = (doc, ids) => unionBox(ids.map((id) => findObj(doc, id)).filter(Boolean).map((f) => bbox(f.obj)));
export const mapSel = (doc, ids, fn) => { for (const l of doc.layers) l.objs = l.objs.map((o) => (ids.includes(o.id) ? fn(o) : o)); };
export function arrange(doc, ids, how) {
  for (const l of doc.layers) {
    const sel = l.objs.filter((o) => ids.includes(o.id)), rest = l.objs.filter((o) => !ids.includes(o.id));
    if (!sel.length) continue;
    if (how === "front") l.objs = [...rest, ...sel]; else if (how === "back") l.objs = [...sel, ...rest];
    else { const objs = l.objs.slice(); const order = how === "forward" ? [...objs.keys()].reverse() : [...objs.keys()]; for (const i of order) { const j = how === "forward" ? i + 1 : i - 1; if (ids.includes(objs[i].id) && objs[j] && !ids.includes(objs[j].id)) [objs[i], objs[j]] = [objs[j], objs[i]]; } l.objs = objs; }
  }
}
export function group(doc, ids) {
  const found = ids.map((id) => findObj(doc, id)).filter(Boolean); if (found.length < 2) return null;
  const layer = found[found.length - 1].layer, g = make("group", { children: [] }, { fill: "none", stroke: "none" });
  for (const f of found) { g.children.push(f.obj); f.layer.objs = f.layer.objs.filter((o) => o.id !== f.obj.id); }
  layer.objs.push(g); return g;
}
export function ungroup(doc, ids) {
  const out = [];
  for (const l of doc.layers) l.objs = l.objs.flatMap((o) => { if (o.type === "group" && ids.includes(o.id)) { out.push(...o.children.map((c) => c.id)); return o.children; } return [o]; });
  return out;
}
export function align(doc, ids, how) {
  const b = selBox(doc, ids); if (!b) return;
  mapSel(doc, ids, (o) => {
    const c = bbox(o);
    const dx = how === "left" ? b.x - c.x : how === "right" ? b.x + b.w - c.x - c.w : how === "hcenter" ? b.x + b.w / 2 - c.x - c.w / 2 : 0;
    const dy = how === "top" ? b.y - c.y : how === "bottom" ? b.y + b.h - c.y - c.h : how === "vcenter" ? b.y + b.h / 2 - c.y - c.h / 2 : 0;
    return translate(o, dx, dy);
  });
}
export function distribute(doc, ids, axis) {
  const items = ids.map((id) => findObj(doc, id)?.obj).filter(Boolean).map((o) => ({ o, b: bbox(o) })); if (items.length < 3) return;
  const k = axis === "h" ? "x" : "y", s = axis === "h" ? "w" : "h"; items.sort((a, b) => a.b[k] + a.b[s] / 2 - (b.b[k] + b.b[s] / 2));
  const first = items[0].b[k] + items[0].b[s] / 2, last = items.at(-1).b[k] + items.at(-1).b[s] / 2, step = (last - first) / (items.length - 1);
  const moves = new Map(items.map((it, i) => [it.o.id, first + step * i - (it.b[k] + it.b[s] / 2)]));
  mapSel(doc, ids, (o) => translate(o, axis === "h" ? moves.get(o.id) : 0, axis === "h" ? 0 : moves.get(o.id)));
}
export const flip = (doc, ids, axis) => { const b = selBox(doc, ids); if (!b) return; const m = axis === "h" ? scaleM(-1, 1, b.x + b.w / 2, 0) : scaleM(1, -1, 0, b.y + b.h / 2); mapSel(doc, ids, (o) => applyMatrix(o, m)); };
export const rotateSel = (doc, ids, deg) => { const b = selBox(doc, ids); if (!b) return; const m = rotateM(deg, b.x + b.w / 2, b.y + b.h / 2); mapSel(doc, ids, (o) => applyMatrix(o, m)); };

// 되돌리기: 문서 전체 스냅샷
export class History {
  constructor(doc) { this.stack = [structuredClone(doc)]; this.i = 0; }
  push(doc) { this.stack.length = this.i + 1; this.stack.push(structuredClone(doc)); this.i++; if (this.stack.length > 200) { this.stack.shift(); this.i--; } }
  get canUndo() { return this.i > 0; } get canRedo() { return this.i < this.stack.length - 1; }
  undo() { return this.canUndo ? structuredClone(this.stack[--this.i]) : null; }
  redo() { return this.canRedo ? structuredClone(this.stack[++this.i]) : null; }
}

// ── SVG 내보내기 ──
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isIdent = (m) => m.every((v, i) => Math.abs(v - IDENT[i]) < 1e-9);
const f2 = (v) => +Number(v).toFixed(2);
const paint = (o) => `fill="${esc(o.fill || "none")}" stroke="${esc(o.stroke || "none")}"${o.stroke && o.stroke !== "none" ? ` stroke-width="${f2(o.sw)}"${o.cap ? ` stroke-linecap="${o.cap}"` : ""}${o.join ? ` stroke-linejoin="${o.join}"` : ""}` : ""}${o.opacity != null && o.opacity < 1 ? ` opacity="${f2(o.opacity)}"` : ""}`;
export function objSvg(o) {
  const id = `data-id="${o.id}"`;
  switch (o.type) {
    case "rect": return `<rect ${id} x="${f2(o.x)}" y="${f2(o.y)}" width="${f2(o.w)}" height="${f2(o.h)}"${o.r ? ` rx="${f2(o.r)}"` : ""} ${paint(o)}/>`;
    case "ellipse": return `<ellipse ${id} cx="${f2(o.cx)}" cy="${f2(o.cy)}" rx="${f2(o.rx)}" ry="${f2(o.ry)}" ${paint(o)}/>`;
    case "path": return `<path ${id} d="${pathD(o)}" ${paint(o)}/>`;
    case "image": return `<image ${id} x="${f2(o.x)}" y="${f2(o.y)}" width="${f2(o.w)}" height="${f2(o.h)}" href="${esc(o.href)}" preserveAspectRatio="none"${o.opacity < 1 ? ` opacity="${f2(o.opacity)}"` : ""}/>`;
    case "raw": return `<g ${id}${isIdent(o.m) ? "" : ` transform="matrix(${o.m.map((v) => +v.toFixed(5)).join(" ")})"`}${o.opacity < 1 ? ` opacity="${f2(o.opacity)}"` : ""}>${o.markup}</g>`;
    case "group": return `<g ${id}${o.opacity < 1 ? ` opacity="${f2(o.opacity)}"` : ""}>${o.children.map(objSvg).join("")}</g>`;
    case "text": {
      const b = bbox(o), rot = o.rot ? ` transform="rotate(${f2(o.rot)} ${f2(b.x)} ${f2(b.y)})"` : "";
      const lines = textLines(o).map((s, i) => `<tspan x="${f2(o.x)}" dy="${i ? f2(o.size * 1.2) : 0}">${esc(s) || "&#160;"}</tspan>`).join("");
      return `<text ${id} x="${f2(o.x)}" y="${f2(o.y)}" font-size="${f2(o.size)}" font-family="${esc(o.font || "Apple SD Gothic Neo, Malgun Gothic, sans-serif")}"${o.bold ? ' font-weight="bold"' : ""}${o.italic ? ' font-style="italic"' : ""} dominant-baseline="text-before-edge" xml:space="preserve" ${paint({ ...o, stroke: o.stroke })}${rot}>${lines}</text>`;
    }
  }
}
export const layersSvg = (doc) => doc.layers.filter((l) => l.visible).map((l) => `<g data-layer="${l.id}" data-name="${esc(l.name)}">${l.objs.map(objSvg).join("")}</g>`).join("");
const attrStr = (a) => Object.entries(a || {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
export function docToSvg(doc, { clean = false, bg = true } = {}) {
  let body = (bg && doc.bg && doc.bg !== "none" ? `<rect data-bg="1" width="${doc.w}" height="${doc.h}" fill="${esc(doc.bg)}"/>` : "") + layersSvg(doc);
  if (clean) body = body.replace(/ data-id="[^"]*"/g, "").replace(/ data-layer="[^"]*"/g, "");
  const pre = (doc.css ? `<style>${doc.css}</style>` : "") + (doc.defs || "");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${doc.w}" height="${doc.h}" viewBox="0 0 ${doc.w} ${doc.h}"${attrStr(doc.rootAttrs)}>${pre}${body}</svg>`;
}
