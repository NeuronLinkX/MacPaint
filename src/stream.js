// 퀵드로우 스크린 미러(docs/02 §5, docs/03 §5): host 엔진의 증분 이벤트를 30ms 단위로 묶어 보내고,
// screen은 같은 연산을 같은 순서로 적용해 같은 그림을 재구성한다(연산이 결정적이라 픽셀까지 같다).
// 메시지 {type:"stroke", item_id, op:"begin"|"pts"|"shape"|"cancel"|"end"|"node"|"goto", ...}
import { Bitmap, parseColor } from "./bitmap.js";
import { HistoryTree } from "./history.js";
import { applyOp, beginLive, stepLive } from "./ops.js";

export class StrokeBatcher {
  constructor(send, itemId, ms = 30, timers = { set: (f, t) => setTimeout(f, t), clear: (h) => clearTimeout(h) }) {
    Object.assign(this, { send, itemId, ms, timers, buf: null, handle: null });
  }
  setItem(itemId) { this.flush(); this.itemId = itemId; }
  push(ev) {
    if (ev.op === "pts" && this.buf?.op === "pts" && this.buf.id === ev.id) this.buf.seg.push(...ev.seg);
    else if (ev.op === "shape" && this.buf?.op === "shape" && this.buf.id === ev.id) this.buf.draft = ev.draft;   // 미리보기는 최신 것만
    else if (ev.op === "pts" || ev.op === "shape") { this.flush(); this.buf = ev.op === "pts" ? { ...ev, seg: ev.seg.slice() } : { ...ev }; }
    else { this.flush(); this._emit(ev); return; }
    if (!this.handle) this.handle = this.timers.set(() => this.flush(), this.ms);
  }
  flush() {
    if (this.handle) { this.timers.clear(this.handle); this.handle = null; }
    if (this.buf) { this._emit(this.buf); this.buf = null; }
  }
  _emit(ev) { this.send({ type: "stroke", item_id: this.itemId, ...ev }); }
}

// 받는 쪽. onChange(assembler)에서 view()로 지금 보여 줄 비트맵을 얻는다.
export class StrokeAssembler {
  constructor(preset, onChange = () => {}, env = {}) {
    this.preset = preset; this.env = env; this.onChange = onChange; this.itemId = null; this._reset();
  }
  _reset() {
    this.tree = new HistoryTree(new Bitmap(this.preset.width, this.preset.height, parseColor(this.preset.bg)), { env: this.env });
    this.live = null; this.draft = null;
  }
  reset(itemId = null) { this.itemId = itemId; this._reset(); this.onChange(this); }
  // 재접속한 screen: 서버가 보관한 현재 문제의 메시지를 순서대로 다시 적용한다.
  restore(itemId, msgs) { this.reset(itemId); for (const m of msgs) this.apply(m); }
  apply(m) {
    if (m.item_id !== this.itemId) { if (this.itemId !== null) return false; this.itemId = m.item_id; }
    switch (m.op) {
      case "begin": this.live = { id: m.id, head: m.draft, st: null }; this.draft = null; break;
      case "pts": {
        const L = this.live; if (!L || L.id !== m.id) return false;
        for (const p of m.seg) { if (!L.st) L.st = beginLive(this.tree.bitmap, L.head, p); else { L.st.op.pts.push(p); stepLive(L.st, L.st.op.pts.length - 1); } }
        break;
      }
      case "shape": this.draft = m.draft; break;
      case "cancel": this.live = null; this.draft = null; break;
      case "end": this.live = null; break;
      case "node": this.live = null; this.draft = null; this.tree.adopt(m.node); break;
      case "goto": this.tree.goto(m.id); break;
      default: return false;
    }
    this.onChange(this); return true;
  }
  view() {
    if (this.live?.st) return this.live.st.bm;
    if (this.draft) { try { return applyOp(this.tree.bitmap.clone(), this.draft, this.env).bm; } catch { /* 미완성 미리보기는 건너뜀 */ } }
    return this.tree.bitmap;
  }
}
