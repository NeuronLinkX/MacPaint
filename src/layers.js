// 레이어 스택: 비트맵 여러 장을 겹쳐 한 장의 그림으로 본다. 히스토리 트리의 한 노드 = 스택 하나.
// 그리기 연산은 대상 레이어(op.ly)의 비트맵에만 적용되고, 레이어 연산(layer_*)은 스택 구조를 바꾼다.
// 비활성 레이어의 비트맵은 노드끼리 공유한다(고치는 레이어만 복사) — 그래서 기록이 많아도 메모리가 크게 늘지 않는다.
import { Bitmap, fromBase64 } from "./bitmap.js";
import { applyBitmapOp } from "./ops.js";

export const LAYER_OPS = new Set(["layer_add", "layer_del", "layer_dup", "layer_move", "layer_vis", "layer_opa", "layer_name", "layer_merge", "layer_flat", "layer_from", "layer_off"]);
// "객체 모드"에서 새 레이어에 그려지는 연산(지우개·채우기·필터처럼 기존 픽셀을 고치는 연산은 제외)
export const OBJECT_OPS = new Set(["pencil", "brush", "airbrush", "line", "curve", "rect", "roundrect", "ellipse", "polygon", "text", "gradient"]);
const CANVAS_OPS = new Set(["scale", "crop", "attributes"]);

/** src를 dst 위에 알파 합성한다(opacity 0~1). */
export function blendOver(dst, src, opacity = 1) {
  const n = dst.px.length, d = dst.px, s = src.px, k = Math.max(0, Math.min(1, opacity));
  for (let i = 0; i < n; i++) {
    const c = s[i], ca = c >>> 24; if (!ca) continue;
    const sa = k === 1 ? ca : Math.round(ca * k); if (!sa) continue;
    const t = d[i], ta = t >>> 24;
    if (sa === 255 || ta === 0) { d[i] = (((sa << 24) | (c & 0xffffff)) >>> 0); continue; }
    const oa = sa + ta * (255 - sa) / 255, w = sa / oa, u = 1 - w;
    const mix = (sh) => Math.round(((c >>> sh) & 255) * w + ((t >>> sh) & 255) * u);
    d[i] = (((Math.round(oa) << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0);
  }
}

const layerOf = (id, name, bm, bg = false) => ({ id, name, visible: true, opacity: 1, bg, bm });

export class Stack {
  constructor(layers, nextId) { this.layers = layers; this.nextId = nextId; }
  static single(bm, name = "배경") { return new Stack([layerOf(1, name, bm, true)], 2); }
  get w() { return this.layers[0].bm.w; }
  get h() { return this.layers[0].bm.h; }
  clone() { return new Stack(this.layers.map((l) => ({ ...l })), this.nextId); }
  index(id) { return this.layers.findIndex((l) => l.id === id); }
  has(id) { return this.index(id) >= 0; }
  get(id) { return this.layers[this.index(id)]; }
  get top() { return this.layers[this.layers.length - 1]; }

  /** 보이는 레이어를 합친 한 장. 레이어가 하나뿐이면 복사 없이 그 비트맵을 돌려준다. over: Map(id → 임시 비트맵). */
  composite(over = null) {
    const vis = this.layers.filter((l) => l.visible);
    const bmOf = (l) => over?.get(l.id) || l.bm;
    if (vis.length === 1 && vis[0].opacity === 1) return bmOf(vis[0]);
    const out = new Bitmap(this.w, this.h, 0);
    for (const l of vis) blendOver(out, bmOf(l), l.opacity);
    return out;
  }
  flat() { return this.composite(); }
  equals(o) { return o instanceof Stack ? this.flat().equals(o.flat()) : this.flat().equals(o); }

  /** 레이어 비트맵 교체(스택이 복제본일 때만 호출한다). */
  setBm(id, bm) { this.get(id).bm = bm; }

  apply(op, env = {}) {
    if (LAYER_OPS.has(op.t)) return { bm: this._layerOp(op), sel: undefined };
    if (op.t === "open") return { bm: Stack.single(fromBase64(op.w, op.h, op.data)), sel: null };
    if (CANVAS_OPS.has(op.t) || (op.t === "xform" && !op.sel)) return this._canvasOp(op, env);
    // 그리기 연산: 대상 레이어에만 적용
    if (op.nl) {
      const at = this.index(op.ly ?? this.top.id), nl = layerOf(op.nl.id, op.nl.name, new Bitmap(this.w, this.h, 0));
      this.layers.splice(at + 1, 0, nl); this.nextId = Math.max(this.nextId, nl.id + 1); op = { ...op, ly: nl.id };
    }
    const layer = this.get(op.ly ?? this.top.id) || this.top;
    if (!layer.bg) op = clearToTransparent(op);
    const r = applyBitmapOp(layer.bm.clone(), op, env);
    layer.bm = r.bm; return { bm: this, sel: r.sel };
  }

  _canvasOp(op, env) {
    this.layers.forEach((l) => { const o = l.bg ? op : clearToTransparent(op); l.bm = applyBitmapOp(l.bm.clone(), o, env).bm; });
    return { bm: this, sel: null };
  }

  _layerOp(op) {
    const L = this.layers, i = this.index(op.id ?? op.ly), at = this.index(op.ly) >= 0 ? this.index(op.ly) : L.length - 1;
    const fresh = (id, name, bm) => { this.nextId = Math.max(this.nextId, id + 1); return layerOf(id, name, bm); };
    switch (op.t) {
      case "layer_add": L.splice(at + 1, 0, fresh(op.id, op.name || `레이어 ${op.id}`, new Bitmap(this.w, this.h, 0))); break;
      case "layer_from": {
        const bm = new Bitmap(this.w, this.h, 0), src = fromBase64(op.w, op.h, op.data); bm.blit(src, op.x, op.y);
        L.splice(at + 1, 0, fresh(op.id, op.name || `레이어 ${op.id}`, bm)); break;
      }
      case "layer_dup": if (i >= 0) L.splice(i + 1, 0, { ...fresh(op.nid, op.name || `${L[i].name} 복사`, L[i].bm), visible: L[i].visible, opacity: L[i].opacity }); break;
      case "layer_del": if (i >= 0 && L.length > 1) { const bgd = L[i].bg; L.splice(i, 1); if (bgd) L[0].bg = true; } break;
      case "layer_move": if (i >= 0) { const [l] = L.splice(i, 1); L.splice(Math.max(0, Math.min(L.length, op.to)), 0, l); } break;
      case "layer_vis": if (i >= 0) L[i] = { ...L[i], visible: !!op.v }; break;
      case "layer_opa": if (i >= 0) L[i] = { ...L[i], opacity: Math.max(0, Math.min(1, op.o)) }; break;
      case "layer_name": if (i >= 0) L[i] = { ...L[i], name: op.name }; break;
      case "layer_merge": if (i > 0) { const below = L[i - 1], bm = below.bm.clone(); if (L[i].visible) blendOver(bm, L[i].bm, L[i].opacity); L[i - 1] = { ...below, bm }; L.splice(i, 1); } break;
      case "layer_flat": { const bm = this.composite().clone(), keep = L.find((l) => l.bg) || L[0]; this.layers = [{ ...keep, visible: true, opacity: 1, bg: true, bm }]; break; }
      case "layer_off": if (i >= 0) { const o = new Bitmap(this.w, this.h, 0); o.blit(L[i].bm, op.dx, op.dy); L[i] = { ...L[i], bm: o }; } break;
    }
    return this;
  }
}

// 배경이 아닌 레이어에서는 "배경색으로 지움"이 "투명하게 지움"이 된다.
function clearToTransparent(op) {
  const T = "transparent";
  switch (op.t) {
    case "eraser": case "clear": return { ...op, c: T };
    case "text": return { ...op, bg: T, opaque: false };
    case "sel_delete": case "sel_move": case "paste": case "attributes": case "xform": return { ...op, bg: T };
    default: return op;
  }
}
