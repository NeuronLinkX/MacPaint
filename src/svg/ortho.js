// 직각 연결선(M·L·H·V만으로 된 꺾은선) 다루기: 가운데 구간을 끌어 꺾이는 위치를 조절한다. 순수 함수.
const EPS = 1e-6;
// d 문자열 → {pts, closed}. 직각 꺾은선이 아니면 null.
export function parseOrtho(d) {
  const tok = String(d).match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) || [];
  const pts = []; let i = 0, cmd = "", x = 0, y = 0, closed = false;
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/^[a-zA-Z]$/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === "M") { x = ox + num(); y = oy + num(); if (pts.length) return null; pts.push([x, y]); cmd = rel ? "l" : "L"; }
    else if (C === "L") { x = ox + num(); y = oy + num(); pts.push([x, y]); }
    else if (C === "H") { x = ox + num(); pts.push([x, y]); }
    else if (C === "V") { y = oy + num(); pts.push([x, y]); }
    else if (C === "Z") { closed = true; }
    else return null;
  }
  return pts.length >= 2 ? { pts: dedupe(pts), closed } : null;
}
function dedupe(pts) { return pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > EPS); }
export const orthoD = (pts, closed = false) => pts.map(([x, y], i) => `${i ? "L" : "M"}${+x.toFixed(2)} ${+y.toFixed(2)}`).join("") + (closed ? "Z" : "");
// 구간 si(점 si와 si+1 사이)의 방향: 수평 "h", 수직 "v", 비스듬하면 null
export const segOrient = (pts, si) => { const [a, b] = [pts[si], pts[si + 1]]; return Math.abs(a[1] - b[1]) < EPS ? "h" : Math.abs(a[0] - b[0]) < EPS ? "v" : null; };
// 조절 가능한 구간: 양 끝 구간(상자에 붙은 부분)은 제외한 안쪽 구간
export function movableSegments(pts) { const out = []; for (let si = 1; si <= pts.length - 3; si++) { const o = segOrient(pts, si); if (o) out.push({ si, o }); } return out; }
// 구간을 수직 방향으로 v까지 옮긴 새 점들
export function moveSegment(pts, si, v) {
  const o = segOrient(pts, si), out = pts.map((p) => p.slice()); if (!o) return out;
  const k = o === "h" ? 1 : 0; out[si][k] = v; out[si + 1][k] = v; return dedupe(out);
}
export const segMid = (pts, si) => [(pts[si][0] + pts[si + 1][0]) / 2, (pts[si][1] + pts[si + 1][1]) / 2];
export function distToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) { const [a, b] = [pts[i], pts[i + 1]], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0; best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)); }
  return best;
}
