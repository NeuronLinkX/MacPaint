// 저장된 그림(엔진 toJSON: 히스토리 트리 + 크기)을 읽는 도구. DOM 없이 동작하고, 그리는 쪽만 canvas가 필요하다.
// 텔레파시: 팀 폰이 보낸 그림은 PNG가 아니라 이 JSON이다(작고, 리플레이 애니메이션에 그대로 쓰인다).
import { Bitmap, parseColor } from "./bitmap.js";
import { HistoryTree } from "./history.js";

// 루트에서 현재 노드까지의 연산열(되돌린 갈래는 제외)
export function pathOpsOfJson(json) {
  if (!json || !Array.isArray(json.nodes)) return [];
  const byId = new Map(json.nodes.map((n) => [n.id, n]));
  const ops = [];
  for (let n = byId.get(json.current); n; n = byId.get(n.parent)) if (n.op) ops.unshift(n.op);
  return ops;
}
export function bitmapOfJson(json, preset, env = {}) {
  const w = json?.w ?? preset.width, h = json?.h ?? preset.height, bg = parseColor(json?.bg ?? preset.bg);
  const base = new Bitmap(w, h, bg);
  return json && json.nodes ? HistoryTree.fromJSON(json, base, { env }).bitmap : base;
}
// 브라우저 전용: 비트맵을 canvas에 그린다(크기도 맞춘다)
export function paintBitmap(canvas, bm) {
  if (canvas.width !== bm.w || canvas.height !== bm.h) { canvas.width = bm.w; canvas.height = bm.h; }
  canvas.getContext("2d").putImageData(new ImageData(bm.bytes(), bm.w, bm.h), 0, 0);
}
