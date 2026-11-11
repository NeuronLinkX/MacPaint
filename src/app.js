// macPaint 진입점: SVG 편집기(벡터)와 PNG 편집기(래스터)를 한 앱에 담는다.
import { PaintEngine } from "./engine.js";
import { PRESETS } from "./presets.js";
import { mountPaintUI } from "./ui.js";
import { mountSvgEditor } from "./svg/editor.js";
import { mountDocTabs } from "./tabs.js";
import { Bitmap } from "./bitmap.js";
import { loadImage, readDataUrl, pickFile } from "./io.js";
import { openNewDialog } from "./newdoc.js";
import { addRecent } from "./recent.js";
import { mountHome } from "./home.js";

if (location.protocol === "macpaint:" || window.webkit?.messageHandlers?.macPaint) document.documentElement.classList.add("in-app");

const png = document.getElementById("png"), svgRoot = document.getElementById("svg");
const bitmapOf = async (blob) => { const img = await loadImage(await readDataUrl(blob)), c = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight }), x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height); return Bitmap.fromBytes(c.width, c.height, new Uint8Array(d.data.buffer)); };

const tabs = [...document.querySelectorAll("[data-mode]")];
const show = (mode) => { for (const t of tabs) t.classList.toggle("on", t.dataset.mode === mode); svgRoot.hidden = mode !== "svg"; png.hidden = mode !== "png"; try { localStorage.setItem("macpaint.mode", mode); } catch {} };
tabs.forEach((t) => (t.onclick = () => show(t.dataset.mode)));

// 문서마다 탭을 하나씩 갖는다(탭 = 편집기 인스턴스).
const record = (kind) => (info) => addRecent({ kind, ...info });
const pngTabs = mountDocTabs(png, {
  prefix: "그림",
  onNew: async () => { const r = await openNewDialog({ kind: "png" }); if (r) pngTabs.add({ size: r }); return !!r; },
  create(host, api, init) {
    const size = init?.size, preset = size ? { ...PRESETS.sandbox, width: size.w, height: size.h } : PRESETS.sandbox;
    const canvas = document.createElement("canvas"), engine = new PaintEngine(canvas, preset);
    engine.setLocked(false); engine.attach(); engine.setTool("brush");
    const ui = mountPaintUI(host, engine, { onName: api.setName, getName: () => api.name, onRecord: record("png"), onNew: () => pngTabs.onNew() });
    if (init?.bitmap) engine.openBitmap(init.bitmap); if (init?.name) api.setName(init.name); if (init?.file) ui.openImage(init.file);
    return { engine, isDirty: ui.isDirty, show: () => requestAnimationFrame(() => ui.layout?.()), destroy: ui.destroy };
  },
});
const svgTabs = mountDocTabs(svgRoot, {
  prefix: "벡터",
  onNew: async () => { const r = await openNewDialog({ kind: "svg" }); if (r) svgTabs.add({ size: r }); return !!r; },
  create(host, api, init) {
    const ed = mountSvgEditor(host, { onName: api.setName, getName: () => api.name, onRecord: record("svg"), onNew: () => svgTabs.onNew(), onToPng: async (blob) => { pngTabs.add({ bitmap: await bitmapOf(blob), name: `${api.name}.png` }); show("png"); } });
    if (init?.size) ed.newDocument(init.size.w, init.size.h); if (init?.file) ed.openFile(init.file);
    return ed;
  },
});
let mode = "png"; try { mode = localStorage.getItem("macpaint.mode") || "png"; } catch {}
show(mode); Object.assign(window, { pngTabs, svgTabs });

// 시작 화면: 새로 만들기 · 열기 · 최근 파일
const isSvg = (f) => /svg/i.test(f.type) || /\.svg$/i.test(f.name);
const openAny = (f) => { if (isSvg(f)) { show("svg"); svgTabs.add({ file: f, name: f.name }); } else { show("png"); pngTabs.add({ file: f, name: f.name }); } return true; };
const home = mountHome(document.querySelector("main"), {
  newPng: async () => { show("png"); return pngTabs.onNew(); },
  newSvg: async () => { show("svg"); return svgTabs.onNew(); },
  openFile: async () => { const fs = await pickFile(".svg,image/svg+xml,image/png,image/jpeg,image/webp,image/gif,image/bmp", true); fs.forEach(openAny); return fs.length > 0; },
  openRecent: async (r) => openAny(new File([r.blob], r.name, { type: r.blob.type || (r.kind === "svg" ? "image/svg+xml" : "image/png") })),
});
document.querySelector(".brand").onclick = () => home.open();
home.open();

// 앱 안(WKWebView)에서는 CSS 드래그 영역이 없어서, 헤더를 누르면 네이티브 창 이동을 요청한다.
const bridge = window.webkit?.messageHandlers?.macPaint;
if (bridge) {
  const head = document.querySelector(".mp-head");
  head.addEventListener("mousedown", (e) => { if (e.button === 0 && !e.target.closest("button,a")) bridge.postMessage(e.detail > 1 ? { zoom: "1" } : { drag: "1" }); });
}
