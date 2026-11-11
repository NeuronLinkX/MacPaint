// 원본 보존 가져오기: SVG 파일의 마크업(스타일·텍스트·마커·클립 등)을 그대로 개체("raw")로 담는다.
// 편집기는 raw 개체를 행렬(m)로 옮기고 키우고 돌리며, 코드 탭에서 마크업 자체를 고칠 수 있다. 브라우저 전용.
import { newDoc, newLayer, uid, mul, IDENT } from "./model.js";
import { parseTransform } from "./parse.js";

const NS = "http://www.w3.org/2000/svg";
const NONRENDER = new Set(["defs", "style", "title", "desc", "metadata", "linearGradient", "radialGradient", "pattern", "marker", "clipPath", "mask", "symbol", "filter"]);
const SKIP_ROOT = new Set(["xmlns", "width", "height", "viewBox", "version", "id", "preserveAspectRatio", "baseProfile"]);

// 스크립트·이벤트 속성·javascript: 링크를 제거한다(가져온 파일이 앱 안에서 코드를 실행하지 못하게).
export function sanitize(root) {
  for (const e of [...root.querySelectorAll("script,foreignObject")]) e.remove();
  for (const e of [root, ...root.querySelectorAll("*")]) for (const a of [...e.attributes]) if (/^on/i.test(a.name) || (/href$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) e.removeAttribute(a.name);
}
// 문서 전체에 번지지 않도록 CSS 선택자 앞에 .rawdoc 를 붙인다.
export function scopeCss(css) {
  return String(css || "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => {
    if (/^\s*@/.test(sel)) return m;
    return sel.split(",").map((s) => { s = s.trim().replace(/^(svg|:root)\b\s*/, ""); return s ? `.rawdoc ${s}` : ".rawdoc"; }).join(",") + `{${body}}`;
  });
}
const ser = (el) => new XMLSerializer().serializeToString(el);

// 마크업의 경계 상자(문서 좌표, 개체 자체 transform 포함)를 숨은 SVG에서 잰다.
export function makeMeasure(doc) {
  return (markup) => {
    const host = document.createElementNS(NS, "svg");
    host.setAttribute("class", "rawdoc"); host.setAttribute("style", "position:fixed;left:-99999px;top:0;width:10px;height:10px;visibility:hidden;pointer-events:none");
    for (const [k, v] of Object.entries(doc.rootAttrs || {})) host.setAttribute(k, v);
    const st = document.createElement("style"); st.textContent = scopeCss(doc.css); host.append(st);
    host.insertAdjacentHTML("beforeend", `${doc.defs || ""}<g>${markup}</g>`);
    document.body.append(host);
    let b = { x: 0, y: 0, width: 0, height: 0 };
    try { b = host.lastElementChild.getBBox(); } catch {}
    host.remove(); return { x: b.x, y: b.y, w: b.width, h: b.height };
  };
}
const mk = (markup, name, m, measure) => ({ id: uid(), type: "raw", name, markup, m, bb: measure(markup), fill: "none", stroke: "none", sw: 0, opacity: 1 });

// 컨테이너(g)는 풀어서 개체를 나눈다. g의 속성(상속되는 스타일)은 자식마다 감싸서 보존한다.
function splitGroup(g, m, measure, out, depth = 0) {
  const gm = mul(m, parseTransform(g.getAttribute("transform")));
  const attrs = [...g.attributes].filter((a) => a.name !== "transform" && a.name !== "id");
  const wrap = (child) => { if (!attrs.length) return ser(child); const w = g.ownerDocument.createElementNS(NS, "g"); for (const a of attrs) w.setAttribute(a.name, a.value); w.append(child.cloneNode(true)); return ser(w); };
  for (const c of g.children) {
    if (NONRENDER.has(c.localName)) continue;
    if (c.localName === "g" && shouldSplit(c) && depth < 6) {
      // 중첩 g의 속성 상속을 유지하려면 부모 속성을 한 번 더 감싼다
      const clone = c.cloneNode(true); for (const a of attrs) if (!clone.hasAttribute(a.name) && a.name !== "class") clone.setAttribute(a.name, a.value);
      splitGroup(clone, gm, measure, out, depth + 1);
    } else out.push(mk(wrap(c), c.getAttribute("id") || "", gm, measure));
  }
}
const shouldSplit = (g) => [...g.children].some((c) => c.localName === "g") || g.children.length > 20;

export function importRaw(text, measureFor = makeMeasure) {
  const xml = new DOMParser().parseFromString(text, "image/svg+xml"), root = xml.documentElement;
  if (!root || root.localName !== "svg" || xml.querySelector("parsererror")) throw new Error("SVG 파일을 읽을 수 없습니다");
  sanitize(root);
  const vb = (root.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number), hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const doc = newDoc(Math.round(hasVb ? vb[2] : num(root.getAttribute("width"), 800)), Math.round(hasVb ? vb[3] : num(root.getAttribute("height"), 600)));
  doc.bg = "none"; doc.defs = ""; doc.css = ""; doc.rootAttrs = {}; doc.layers = [];
  for (const a of root.attributes) if (!SKIP_ROOT.has(a.name) && !/^xmlns/.test(a.name)) doc.rootAttrs[a.name] = a.value;
  const base = hasVb ? [1, 0, 0, 1, -vb[0], -vb[1]] : IDENT, measure = measureFor(doc), layer = newLayer("레이어 1"), objs = [];
  for (const c of root.children) {
    if (c.localName === "style") { doc.css += c.textContent + "\n"; continue; }
    if (NONRENDER.has(c.localName)) { if (c.localName !== "title" && c.localName !== "desc") doc.defs += ser(c); continue; }
    // defs 안의 style도 CSS로 모은다(선택자 범위를 맞추기 위해)
    if (c.localName === "g" && shouldSplit(c)) splitGroup(c, base, measure, objs); else objs.push(mk(ser(c), c.getAttribute("id") || "", base, measure));
  }
  doc.defs = doc.defs.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (m, css) => { doc.css += css + "\n"; return ""; });
  layer.objs = objs; doc.layers.push(layer); return doc;
}

// raw 그룹 하나를 풀어 자식 개체들로(코드·GUI "그룹 해제"용)
export function ungroupRaw(o, doc) {
  const frag = new DOMParser().parseFromString(`<svg xmlns="${NS}">${o.markup}</svg>`, "image/svg+xml").documentElement, g = frag.firstElementChild;
  if (!g || g.localName !== "g" || !g.children.length) return null;
  const out = []; splitGroupAll(g, o.m, makeMeasure(doc), out); return out;
}
function splitGroupAll(g, m, measure, out) {
  const gm = mul(m, parseTransform(g.getAttribute("transform"))), attrs = [...g.attributes].filter((a) => a.name !== "transform" && a.name !== "id");
  for (const c of g.children) {
    if (NONRENDER.has(c.localName)) continue; let markup;
    if (attrs.length) { const w = g.ownerDocument.createElementNS(NS, "g"); for (const a of attrs) w.setAttribute(a.name, a.value); w.append(c.cloneNode(true)); markup = ser(w); } else markup = ser(c);
    out.push(mk(markup, c.getAttribute("id") || "", gm, measure));
  }
}

// 색 바꾸기: 이미 칠·선이 있는 도형에만 새 색을 쓴다(없음으로 둔 곳은 그대로).
export function restyleRaw(o, patch) {
  const frag = new DOMParser().parseFromString(`<svg xmlns="${NS}">${o.markup}</svg>`, "image/svg+xml").documentElement;
  const paint = (e, prop, val) => { const cur = (e.style?.[prop] || e.getAttribute(prop)); if (cur === "none") return; e.removeAttribute(prop); e.style?.setProperty(prop, val); };
  for (const e of frag.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon,text,tspan,use")) {
    if (patch.fill !== undefined && patch.fill !== "none" && e.localName !== "line") paint(e, "fill", patch.fill);
    if (patch.stroke !== undefined && patch.stroke !== "none") paint(e, "stroke", patch.stroke);
    if (patch.sw !== undefined && (e.style?.stroke || e.getAttribute("stroke"))) e.style?.setProperty("stroke-width", String(patch.sw));
  }
  return { ...o, markup: [...frag.childNodes].map((n) => ser(n)).join(""), opacity: patch.opacity ?? o.opacity };
}
// 코드로 입력한 마크업 한 덩어리 → raw 개체(여러 개면 그룹으로 감싼다)
export function rawFromMarkup(markup, doc, m = IDENT) {
  const frag = new DOMParser().parseFromString(`<svg xmlns="${NS}">${markup}</svg>`, "image/svg+xml");
  if (frag.querySelector("parsererror")) throw new Error("마크업에 오류가 있습니다");
  sanitize(frag.documentElement); const kids = [...frag.documentElement.children]; if (!kids.length) throw new Error("개체가 없습니다");
  const text = kids.length === 1 ? ser(kids[0]) : `<g>${kids.map(ser).join("")}</g>`; return mk(text, "", m, makeMeasure(doc));
}

// 원본 마크업 안의 idx번째 <text> 내용(줄 단위)을 읽고 바꾼다. 줄바꿈은 tspan으로 표현한다.
const parseFrag = (markup) => new DOMParser().parseFromString(`<svg xmlns="${NS}">${markup}</svg>`, "image/svg+xml").documentElement;
export function rawTextLines(o, idx) {
  const t = parseFrag(o.markup).querySelectorAll("text")[idx]; if (!t) return null;
  const sp = [...t.children].filter((c) => c.localName === "tspan");
  return sp.length ? sp.map((c) => c.textContent) : t.textContent.split("\n");
}
export function setRawText(o, idx, lines, doc) {
  const frag = parseFrag(o.markup), t = frag.querySelectorAll("text")[idx]; if (!t) return o;
  const sp = [...t.children].filter((c) => c.localName === "tspan"), first = sp[0], second = sp[1];
  const x = first?.getAttribute("x") ?? t.getAttribute("x"), dy = second?.getAttribute("dy") ?? first?.getAttribute("dy") ?? "1.2em";
  if (lines.length === 1 && !sp.length) t.textContent = lines[0];
  else {
    const proto = first ? first.cloneNode(false) : t.ownerDocument.createElementNS(NS, "tspan"); t.textContent = "";
    lines.forEach((ln, i) => { const c = proto.cloneNode(false); if (x != null) c.setAttribute("x", x); if (i) c.setAttribute("dy", dy); else c.removeAttribute("dy"); c.textContent = ln; t.append(c); });
  }
  const markup = [...frag.childNodes].map((n) => ser(n)).join("");
  return { ...o, markup, bb: makeMeasure(doc)(markup) };
}

// ── 직각 연결선 ──
import { parseOrtho, orthoD } from "./ortho.js";
const orthoCache = new Map();
// raw 개체 안의 직각 꺾은선들: [{pi, pts(개체 좌표), closed}] (변형이 걸린 요소는 제외)
export function rawOrthoPaths(o) {
  if (orthoCache.has(o.markup)) return orthoCache.get(o.markup);
  const out = []; if (orthoCache.size > 800) orthoCache.clear();
  if (/<path/.test(o.markup)) {
    [...parseFrag(o.markup).querySelectorAll("path")].forEach((p, pi) => {
      if (p.closest("[transform]") || p.getAttribute("fill") && p.getAttribute("fill") !== "none" && /Z/i.test(p.getAttribute("d") || "")) return;
      const r = parseOrtho(p.getAttribute("d") || ""); if (r && r.pts.length >= 3) out.push({ pi, ...r });
    });
  }
  orthoCache.set(o.markup, out); return out;
}
export function setRawPathD(o, pi, pts, closed = false) {
  const frag = parseFrag(o.markup), p = frag.querySelectorAll("path")[pi]; if (!p) return o;
  p.setAttribute("d", orthoD(pts, closed)); return { ...o, markup: [...frag.childNodes].map((n) => ser(n)).join("") };
}
export const remeasure = (o, doc) => ({ ...o, bb: makeMeasure(doc)(o.markup) });
