// SVG 가져오기: path 데이터·변환 파서(순수 함수)와, DOM(DOMParser)을 받아 문서로 바꾸는 svgToDoc.
import { newDoc, newLayer, make, applyMatrix, mul, IDENT, scaleOf, uid, K } from "./model.js";

// 호(arc) → 베지어 조각들
function arcToBeziers(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry); const r = (phi * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = c * dx + s * dy, y1p = -s * dx + c * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sq = Math.max(0, (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)), co = (fa === fs ? -1 : 1) * Math.sqrt(sq);
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx, cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry); let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2))), d = dt / n, k = (4 / 3) * Math.tan(d / 4), out = [];
  const P = (a) => [cx + rx * Math.cos(a) * c - ry * Math.sin(a) * s, cy + rx * Math.cos(a) * s + ry * Math.sin(a) * c];
  const D = (a) => [-rx * Math.sin(a) * c - ry * Math.cos(a) * s, -rx * Math.sin(a) * s + ry * Math.cos(a) * c];
  for (let i = 0; i < n; i++) { const a0 = t1 + d * i, a1 = a0 + d, p0 = P(a0), p1 = P(a1), d0 = D(a0), d1 = D(a1); out.push([p0[0] + k * d0[0], p0[1] + k * d0[1], p1[0] - k * d1[0], p1[1] - k * d1[1], p1[0], p1[1]]); }
  return out;
}

// path d 속성 → 하위 패스 배열 [{nodes, closed}]
export function parsePathD(d) {
  const tok = String(d).match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || [];
  const subs = []; let cur = null, i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null;
  const num = () => parseFloat(tok[i++]), flag = () => { const t = tok[i]; if (t.length > 1 && /^[01]/.test(t)) { tok[i] = t.slice(1); return Number(t[0]); } i++; return Number(t); };
  const start = (nx, ny) => { cur = { nodes: [{ x: nx, y: ny }], closed: false }; subs.push(cur); };
  const cubic = (a, b, c2, dd, ex, ey) => { const p = cur.nodes.at(-1); p.ox = a; p.oy = b; cur.nodes.push({ x: ex, y: ey, ix: c2, iy: dd }); x = ex; y = ey; lc = [c2, dd]; lq = null; };
  while (i < tok.length) {
    if (/^[a-zA-Z]$/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === "Z") { if (cur) { cur.closed = true; const f = cur.nodes[0], l = cur.nodes.at(-1); if (cur.nodes.length > 1 && Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) { f.ix = l.ix; f.iy = l.iy; cur.nodes.pop(); } } x = sx; y = sy; lc = lq = null; cur = null; continue; }
    if (!cur && C !== "M") start(x, y);
    if (C === "M") { x = ox + num(); y = oy + num(); sx = x; sy = y; start(x, y); cmd = rel ? "l" : "L"; lc = lq = null; }
    else if (C === "L") { x = ox + num(); y = oy + num(); cur.nodes.push({ x, y }); lc = lq = null; }
    else if (C === "H") { x = ox + num(); cur.nodes.push({ x, y }); lc = lq = null; }
    else if (C === "V") { y = oy + num(); cur.nodes.push({ x, y }); lc = lq = null; }
    else if (C === "C") cubic(ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num());
    else if (C === "S") { const a = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y]; cubic(a[0], a[1], ox + num(), oy + num(), ox + num(), oy + num()); }
    else if (C === "Q" || C === "T") {
      let qx, qy; if (C === "Q") { qx = ox + num(); qy = oy + num(); } else { [qx, qy] = lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y]; }
      const ex = ox + num(), ey = oy + num(), x0 = x, y0 = y; cubic(x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey); lq = [qx, qy]; lc = null;
    } else if (C === "A") {
      const rx = num(), ry = num(), phi = num(), fa = flag(), fs = flag(), ex = ox + num(), ey = oy + num();
      for (const [a, b, c2, dd, px, py] of arcToBeziers(x, y, rx, ry, phi, fa, fs, ex, ey)) cubic(a, b, c2, dd, px, py); lc = lq = null; x = ex; y = ey;
    } else i++;                                                              // 알 수 없는 명령은 건너뛴다
  }
  return subs.filter((s) => s.nodes.length > 0);
}

// transform 속성 → 행렬
export function parseTransform(s) {
  let m = IDENT; if (!s) return m;
  for (const [, name, args] of String(s).matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number); let t;
    if (name === "translate") t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (name === "scale") t = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (name === "rotate") { const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r), cx = a[1] || 0, cy = a[2] || 0; t = [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy]; }
    else if (name === "matrix") t = a.slice(0, 6);
    else if (name === "skewX") t = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (name === "skewY") t = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    if (t) m = mul(m, t);
  }
  return m;
}

const len = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
function styleOf(el, inh) {
  const st = { ...inh }, css = {}; for (const part of (el.getAttribute("style") || "").split(";")) { const [k, v] = part.split(":"); if (k && v) css[k.trim()] = v.trim(); }
  const g = (k) => css[k] ?? el.getAttribute(k);
  for (const [k, p] of [["fill", "fill"], ["stroke", "stroke"], ["stroke-linecap", "cap"], ["stroke-linejoin", "join"], ["font-family", "font"]]) { const v = g(k); if (v != null && v !== "") st[p] = v; }
  const sw = g("stroke-width"); if (sw != null) st.sw = len(sw, 1); const op = g("opacity"); if (op != null) st.opacity = len(op, 1);
  const fw = g("font-weight"); if (fw) st.bold = fw === "bold" || len(fw) >= 600; const fz = g("font-size"); if (fz) st.size = len(fz, 16);
  return st;
}

// SVG 문자열 → 문서. DOMParserCtor는 브라우저의 DOMParser(테스트에서는 주입).
export function svgToDoc(text, DP = globalThis.DOMParser) {
  const xml = new DP().parseFromString(text, "image/svg+xml"), root = xml.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || xml.querySelector("parsererror")) throw new Error("SVG 파일을 읽을 수 없습니다");
  const vb = (root.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const w = Math.round(len(root.getAttribute("width"), hasVb ? vb[2] : 800)), h = Math.round(len(root.getAttribute("height"), hasVb ? vb[3] : 600));
  const doc = newDoc(w, h); doc.bg = "none"; doc.layers = [];
  const base = hasVb ? [w / vb[2], 0, 0, h / vb[3], (-vb[0] * w) / vb[2], (-vb[1] * h) / vb[3]] : IDENT;
  const baseStyle = { fill: "#000000", stroke: "none", sw: 1, opacity: 1 };

  const leaf = (el, st, m) => {
    const tag = el.localName, mm = mul(m, parseTransform(el.getAttribute("transform")));
    const fin = (o) => { const r = applyMatrix(o, mm); return { ...r, sw: (r.sw ?? 1) * scaleOf(mm) }; };
    const style = { fill: st.fill, stroke: st.stroke, sw: st.sw, opacity: st.opacity, ...(st.cap ? { cap: st.cap } : {}), ...(st.join ? { join: st.join } : {}) };
    const n = (k) => len(el.getAttribute(k));
    if (tag === "rect") return fin(make("rect", { x: n("x"), y: n("y"), w: n("width"), h: n("height"), r: len(el.getAttribute("rx") ?? el.getAttribute("ry")) }, style));
    if (tag === "circle") return fin(make("ellipse", { cx: n("cx"), cy: n("cy"), rx: n("r"), ry: n("r") }, style));
    if (tag === "ellipse") return fin(make("ellipse", { cx: n("cx"), cy: n("cy"), rx: n("rx"), ry: n("ry") }, style));
    if (tag === "line") return fin(make("path", { nodes: [{ x: n("x1"), y: n("y1") }, { x: n("x2"), y: n("y2") }], closed: false }, { ...style, fill: "none" }));
    if (tag === "polyline" || tag === "polygon") {
      const v = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number), nodes = []; for (let i = 0; i + 1 < v.length; i += 2) nodes.push({ x: v[i], y: v[i + 1] });
      return fin(make("path", { nodes, closed: tag === "polygon" }, style));
    }
    if (tag === "path") {
      const subs = parsePathD(el.getAttribute("d") || ""); if (!subs.length) return null;
      const objs = subs.map((s) => fin(make("path", s, style))); return objs.length === 1 ? objs[0] : { ...make("group", { children: objs }, { fill: "none", stroke: "none" }) };
    }
    if (tag === "text") return fin(make("text", { x: n("x"), y: n("y") - (st.size || 16) * 0.85, size: st.size || 16, text: el.textContent.trim(), font: st.font, bold: st.bold }, { ...style, stroke: "none" }));
    if (tag === "image") { const href = el.getAttribute("href") || el.getAttribute("xlink:href"); return href ? fin(make("image", { x: n("x"), y: n("y"), w: n("width"), h: n("height"), href }, style)) : null; }
    return null;
  };
  const walk = (el, st, m) => {
    const out = [];
    for (const c of el.children) {
      const tag = c.localName; if (["defs", "title", "desc", "metadata", "style", "clipPath", "mask", "linearGradient", "radialGradient"].includes(tag)) continue;
      const cs = styleOf(c, st), cm = mul(m, parseTransform(tag === "g" ? c.getAttribute("transform") : ""));
      if (tag === "g" || tag === "svg") { const kids = walk(c, cs, cm); if (kids.length) out.push(kids.length === 1 && false ? kids[0] : make("group", { children: kids }, { fill: "none", stroke: "none", opacity: cs.opacity })); }
      else { const o = leaf(c, cs, m); if (o) out.push(o); }
    }
    return out;
  };
  const top = styleOf(root, baseStyle);
  const loose = [];
  for (const c of root.children) {
    if (c.getAttribute("data-bg")) { doc.bg = c.getAttribute("fill") || "#ffffff"; continue; }
    if (c.localName === "g" && (c.getAttribute("id") || c.getAttribute("inkscape:label") || c.getAttribute("data-name"))) {
      const cs = styleOf(c, top), L = newLayer(c.getAttribute("data-name") || c.getAttribute("inkscape:label") || c.getAttribute("id")); L.objs = walk(c, cs, mul(base, parseTransform(c.getAttribute("transform")))); doc.layers.push(L);
    } else loose.push(c);
  }
  if (loose.length) { const holder = { children: loose, getAttribute: () => null }; const L = newLayer("레이어 1"); L.objs = walk(holder, top, base); doc.layers.unshift(L); }
  if (!doc.layers.length) doc.layers.push(newLayer("레이어 1"));
  return doc;
}
void uid; void K;
