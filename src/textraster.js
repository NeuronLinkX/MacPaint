// 브라우저 전용 텍스트 래스터라이저: 상자 안에 줄바꿈해 그린 뒤, 안티앨리어싱을 살려 부드럽게 그린다.
// 같은 폰트를 가진 기기끼리는 같은 결과가 나온다(host·screen이 같은 노트북이라는 전제).
import { Bitmap, parseColor } from "./bitmap.js";

const fontStack = (f) => `${f && f !== "sans-serif" ? `"${f}", ` : ""}"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`;

export function browserTextRasterizer() {
  const make = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : typeof document !== "undefined" ? Object.assign(document.createElement("canvas"), { width: w, height: h }) : null);
  if (!make(1, 1)) return null;
  return function rasterText(op) {
    const { w, h } = op.box, cv = make(w, h), ctx = cv.getContext("2d", { willReadFrequently: true });
    const size = op.size || 16;
    ctx.font = `${op.italic ? "italic " : ""}${op.bold ? "bold " : ""}${size}px ${fontStack(op.font)}`;
    ctx.textBaseline = "top"; ctx.fillStyle = op.c; ctx.strokeStyle = op.c;
    const lineH = Math.round(size * 1.3); let y = 0;
    for (const para of String(op.text).split("\n")) {
      let line = "";
      for (const word of para.split(/(\s+)/)) {
        if (line && ctx.measureText(line + word).width > w) { draw(line); line = word.trimStart(); } else line += word;
      }
      draw(line);
    }
    function draw(t) {
      if (y > h) return;
      ctx.fillText(t, 0, y);
      if (op.underline) { const m = ctx.measureText(t).width; ctx.fillRect(0, y + size + 1, m, Math.max(1, size / 14)); }
      y += lineH;
    }
    const d = ctx.getImageData(0, 0, w, h).data, bm = new Bitmap(w, h, 0), col = parseColor(op.c);
    // 안티앨리어싱을 살려 글자 가장자리가 부드럽게 보인다(알파는 ops에서 배경과 섞는다).
    for (let i = 0; i < w * h; i++) { const a = d[i * 4 + 3]; if (a >= 24) bm.px[i] = ((a << 24) | (col & 0xffffff)) >>> 0; }
    return bm;
  };
}
