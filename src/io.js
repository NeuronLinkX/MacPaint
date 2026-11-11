// 파일 입출력 공용 도우미: 내려받기, 파일 읽기, 색 정규화.
const nativeSave = () => globalThis.webkit?.messageHandlers?.macPaint;     // macOS 앱 안에서는 네이티브 저장 대화상자를 쓴다
export async function saveBlob(blob, name) {
  const native = nativeSave();
  if (native) { const url = await readDataUrl(blob); native.postMessage({ name, data: url.slice(url.indexOf(",") + 1) }); return; }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 4000);
}
export const readText = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsText(f); });
export const readDataUrl = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
export const loadImage = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("이미지를 열 수 없습니다")); i.src = src; });
export function pickFile(accept, multiple = false) {
  return new Promise((ok) => { const i = Object.assign(document.createElement("input"), { type: "file", accept, multiple }); i.onchange = () => ok([...i.files]); i.click(); });
}
let _c; export function toHex(css) {                                       // 어떤 CSS 색이든 #rrggbb로
  if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
  _c ??= document.createElement("canvas").getContext("2d"); _c.fillStyle = "#000"; _c.fillStyle = css; const v = _c.fillStyle;
  if (v.startsWith("#")) return v.length === 7 ? v : "#000000"; const m = v.match(/\d+/g); return m ? "#" + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, "0")).join("") : "#000000";
}
export const svgToPngBlob = async (svg, w, h, scale = 1) => {
  const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(w * scale), height: Math.round(h * scale) }); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, "image/png"));
};
