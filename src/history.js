// 히스토리 트리(JS Paint의 비선형 히스토리): 되돌린 뒤 새로 그려도 이전 갈래가 남고, 어느 지점으로든 이동할 수 있다.
// 노드마다 비트맵을 모두 들고 있지 않고, 최근 몇 개만 캐시한 뒤 필요하면 연산을 다시 적용해 복원한다.
import { applyOp, labelOf } from "./ops.js";

export class HistoryTree {
  constructor(base, { cacheMax = 6, env = {} } = {}) {
    this.env = env; this.cacheMax = cacheMax;
    this.nodes = new Map([[0, { id: 0, parent: null, op: null, sel: null, label: "새 그림", children: [], redo: null }]]);
    this.cache = new Map([[0, base.clone()]]);          // 루트는 항상 보관
    this.current = 0; this.nextId = 1;
  }
  node(id) { return this.nodes.get(id); }
  get currentNode() { return this.nodes.get(this.current); }

  _cache(id, bm) {
    this.cache.delete(id); this.cache.set(id, bm);
    while (this.cache.size > this.cacheMax + 1) {
      for (const k of this.cache.keys()) if (k !== 0 && k !== this.current) { this.cache.delete(k); break; }
    }
  }
  // 새 연산 기록. bmAfter는 연산이 이미 적용된 비트맵(소유권 이전). 현재 노드의 자식이 된다.
  commit(op, sel, bmAfter, label = labelOf(op)) {
    const node = { id: this.nextId++, parent: this.current, op, sel: sel || null, label, children: [], redo: null };
    this.nodes.set(node.id, node); this.currentNode.children.push(node.id); this.currentNode.redo = node.id;
    this.current = node.id; this._cache(node.id, bmAfter);
    return node;
  }
  // 다른 곳(host)이 만든 노드를 그대로 받아들인다(미러). 부모 비트맵에 op를 적용해 결과를 만든다.
  adopt(data) {
    if (this.nodes.has(data.id)) { this.current = data.id; return this.node(data.id); }
    const parent = this.nodes.get(data.parent);
    if (!parent) throw new Error(`부모 노드 없음: ${data.parent}`);
    const bm = applyOp(this.bitmapAt(data.parent).clone(), data.op, this.env).bm;
    const node = { id: data.id, parent: data.parent, op: data.op, sel: data.sel || null, label: data.label || labelOf(data.op), children: [], redo: null };
    this.nodes.set(node.id, node); parent.children.push(node.id); parent.redo = node.id;
    this.nextId = Math.max(this.nextId, node.id + 1); this.current = node.id; this._cache(node.id, bm);
    return node;
  }
  bitmapAt(id) {
    if (this.cache.has(id)) { const bm = this.cache.get(id); this.cache.delete(id); this.cache.set(id, bm); return bm; }
    const chain = []; let n = this.nodes.get(id);
    while (n && !this.cache.has(n.id)) { chain.push(n); n = this.nodes.get(n.parent); }
    let bm = this.cache.get(n.id).clone();
    for (let i = chain.length - 1; i >= 0; i--) { bm = applyOp(bm, chain[i].op, this.env).bm; if (i === 0 || i % 4 === 0) this._cache(chain[i].id, i === 0 ? bm : bm.clone()); }
    return bm;
  }
  get bitmap() { return this.bitmapAt(this.current); }
  get sel() { return this.currentNode.sel; }

  canUndo() { return this.currentNode.parent !== null; }
  canRedo() { return this.currentNode.children.length > 0; }
  undo() { const n = this.currentNode; if (n.parent === null) return false; this.nodes.get(n.parent).redo = n.id; this.current = n.parent; return true; }
  redo() { const n = this.currentNode; if (!n.children.length) return false; this.current = n.redo ?? n.children[n.children.length - 1]; return true; }
  goto(id) { if (!this.nodes.has(id)) return false; for (let c = this.nodes.get(id); c.parent !== null; c = this.nodes.get(c.parent)) this.nodes.get(c.parent).redo = c.id; this.current = id; return true; }

  pathTo(id = this.current) { const out = []; for (let n = this.nodes.get(id); n; n = this.nodes.get(n.parent)) out.unshift(n); return out; }
  pathOps(id = this.current) { return this.pathTo(id).filter((n) => n.op).map((n) => n.op); }
  // 화면 표시용: 깊이 우선으로 펼친 목록 [{id,label,depth,current,onPath}]
  flatten() {
    const out = [], onPath = new Set(this.pathTo().map((n) => n.id));
    const walk = (id, depth) => { const n = this.nodes.get(id); out.push({ id, label: n.label, depth, current: id === this.current, onPath: onPath.has(id) }); for (const c of n.children) walk(c, n.children.length > 1 ? depth + 1 : depth); };
    walk(0, 0); return out;
  }
  toJSON() { return { v: 2, current: this.current, nodes: [...this.nodes.values()].filter((n) => n.id).map(({ id, parent, op, sel, label }) => ({ id, parent, op, sel, label })) }; }
  static fromJSON(json, base, opts) {
    const t = new HistoryTree(base, opts);
    for (const n of json.nodes) t.adopt(n);
    t.goto(json.current); return t;
  }
}
