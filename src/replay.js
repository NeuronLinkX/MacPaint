// 리플레이(텔레파시 §6, 명작 갤러리): 기록된 연산을 순서대로 다시 그린다. 점이 있는 연산은 점 단위로 진행한다.
import { Bitmap, parseColor } from "./bitmap.js";
import { applyOp, opsUpTo } from "./ops.js";

export class Replayer {
  // onFrame(bitmap): 프레임마다 호출. raf/caf는 테스트에서 주입한다.
  constructor(preset, onFrame, env = {}, raf = (f) => globalThis.requestAnimationFrame(f), caf = (id) => globalThis.cancelAnimationFrame(id)) {   // 메서드로 호출돼도 안전하게 감싼다
    Object.assign(this, { preset, onFrame, env, raf, caf, id: null });
  }
  frameAt(ops, progress) {                                   // 순수 계산(테스트용): progress 시점의 그림
    const bm = new Bitmap(this.preset.width, this.preset.height, parseColor(this.preset.bg));
    let cur = bm;
    for (const o of opsUpTo(ops, progress)) cur = applyOp(cur, o, this.env).bm;
    return cur;
  }
  play(ops, durationMs = 2000, onDone = () => {}) {
    this.stop();
    let base = new Bitmap(this.preset.width, this.preset.height, parseColor(this.preset.bg)), applied = 0, t0 = null;
    const step = (t) => {
      t0 ??= t;
      const p = durationMs <= 0 ? 1 : Math.min(1, (t - t0) / durationMs), list = opsUpTo(ops, p);
      const partial = list.length > 0 && list[list.length - 1] !== ops[list.length - 1], full = partial ? list.length - 1 : list.length;
      for (; applied < full; applied++) base = applyOp(base, ops[applied], this.env).bm;
      this.onFrame(partial ? applyOp(base.clone(), list[list.length - 1], this.env).bm : base);
      if (p < 1) this.id = this.raf(step); else { this.id = null; onDone(); }
    };
    this.id = this.raf(step);
  }
  stop() { if (this.id != null) { this.caf(this.id); this.id = null; } }
}
