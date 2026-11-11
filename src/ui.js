import { FILTERS } from "./filters.js";
import { Bitmap } from "./bitmap.js";
import { saveBlob, pickFile, loadImage, readDataUrl } from "./io.js";
// 편집기 UI — JS Paint의 배치(메뉴 · 도구 상자 · 작업 영역 · 색 상자 · 상태 표시줄)를 macOS 스타일로 다시 만들었다.
// 게임 화면은 엔진만 쓰고 이 UI는 쓰지 않는다(공개 규칙대로 제한). sandbox 프리셋에서 전체 기능을 보여 준다.
const SVG = (d) => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SVG24 = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TOOL_INFO = {
  move: ["이동", "클릭한 객체(레이어)를 끌어서 옮깁니다", SVG('<path d="M10 2.500v15M2.500 10h15M10 2.500l-2 2M10 2.500l2 2M10 17.500l-2-2M10 17.500l2-2M2.500 10l2-2M2.500 10l2 2M17.500 10l-2-2M17.500 10l-2 2"/>')],
  freeselect: ["자유형 선택", "자유롭게 그려 영역을 고릅니다", SVG('<path d="M4.5 7 8 4l5 2 3 4.500-3 5-6 .5-3-4z" stroke-dasharray="2 2"/>')],
  select: ["선택", "끌어서 사각형 영역을 고릅니다. 안쪽을 끌면 이동, Ctrl/⌘ 누르면 복사", SVG('<rect x="3.500" y="4.500" width="13" height="11" rx="1" stroke-dasharray="2.500 2"/>')],
  eraser: ["지우개", "배경색으로 지웁니다", SVG('<path d="M4 13.500 11 5l5 4-5.500 7H7z"/><path d="M8 11l5 4M9 17h8"/>')],
  fill: ["색 채우기", "닫힌 영역을 전경색(오른쪽 클릭은 배경색)으로 채웁니다", SVG24('<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z" fill="currentColor"/>')],
  pick: ["색 고르기", "그림에서 색을 집어 전경색으로 씁니다", SVG24('<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>')],
  magnifier: ["돋보기", "클릭하면 확대, 오른쪽 클릭하면 축소", SVG('<circle cx="8.500" cy="8.500" r="4.500"/><path d="m12 12 4.500 4.500"/>')],
  pencil: ["연필", "1픽셀 선을 그립니다", SVG('<path d="m4 16 1-4 8.500-8.500 3 3L8 15z"/><path d="m11.500 5.500 3 3"/>')],
  brush: ["브러시", "모양과 크기를 고를 수 있는 붓", SVG24('<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>')],
  airbrush: ["에어브러시", "누르고 있으면 점이 계속 뿌려집니다 — 가만히 있으면 점점 진해집니다", SVG('<path d="M5 9h5v6H5z"/><path d="M7.500 9V6.500h2"/><circle cx="13" cy="6" r=".6" fill="currentColor"/><circle cx="15.500" cy="8" r=".6" fill="currentColor"/><circle cx="14" cy="10.500" r=".6" fill="currentColor"/><circle cx="16.500" cy="5" r=".6" fill="currentColor"/>')],
  gradient: ["그라디언트", "끌어서 전경색→배경색으로 칠합니다. 선택 영역이 있으면 그 안에만 칠합니다", SVG('<rect x="3.500" y="4.500" width="13" height="11" rx="1.500"/><path d="M7 5v10M10 5v10M13 5v10" stroke-dasharray="1.500 2"/>')],
  text: ["텍스트", "끌어서 상자를 만들고 글자를 입력합니다 (⌘/Ctrl+Enter로 확정)", SVG('<path d="M5 5V4h10v1M10 4v12M8 16h4"/>')],
  line: ["직선", "끌어서 직선을 그립니다. Shift는 45° 고정", SVG('<path d="m4.500 15.500 11-11"/>')],
  curve: ["곡선", "직선을 그린 뒤 휘고 싶은 쪽으로 끌어 줍니다(2번까지). Enter로 확정", SVG('<path d="M4 14C7 2 13 18 16 6"/>')],
  rect: ["사각형", "Shift는 정사각형", SVG('<rect x="3.500" y="5" width="13" height="10" rx="1"/>')],
  polygon: ["다각형", "클릭으로 꼭짓점을 추가하고, 더블클릭이나 시작점 클릭으로 닫습니다", SVG('<path d="m4 14 2-8 6-2 4 5-2 6z"/>')],
  ellipse: ["타원", "Shift는 정원", SVG('<ellipse cx="10" cy="10" rx="7" ry="5"/>')],
  roundrect: ["둥근 사각형", "모서리가 둥근 사각형", SVG('<rect x="3.500" y="5" width="13" height="10" rx="4"/>')],
};
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl+";
const el = (tag, attrs = {}, ...kids) => { const n = Object.assign(document.createElement(tag), attrs); n.append(...kids); return n; };
const btn = (label, onclick, title = "", cls = "") => el("button", { type: "button", className: cls, innerHTML: label, onclick, title });

export function mountPaintUI(root, engine, { gameKeys = false, onName, getName, onRecord, onNew } = {}) {
  root.classList.add("pui");
  const toolbox = el("div", { className: "pui-tools", role: "toolbar", ariaLabel: "도구" }), inspector = el("div", { className: "pui-inspector" });
  const sidebar = el("aside", { className: "pui-sidebar" }, toolbox, inspector);
  const menubar = el("nav", { className: "pui-menubar" }), area = el("div", { className: "pui-area" }), wrap = el("div", { className: "pui-canvaswrap" });
  const colors = el("div", { className: "pui-colors" }), status = el("footer", { className: "pui-status" });
  const hist = el("aside", { className: "pui-history", hidden: true });
  wrap.append(engine.canvas); area.append(wrap);
  const layersPane = el("aside", { className: "pui-layers", "aria-label": "레이어" });
  root.append(menubar, sidebar, area, layersPane, hist, colors, status);

  // ── 도구 상자 ──
  const toolBtns = {};
  for (const t of engine.tools) { const [name, , icon] = TOOL_INFO[t]; toolBtns[t] = btn(icon, () => engine.setTool(t), name, "tool"); toolBtns[t].dataset.tool = t; toolbox.append(toolBtns[t]); }

  // ── 도구 옵션(인스펙터) ──
  const slider = (label, key, min, max) => {
    const out = el("output"), input = el("input", { type: "range", min, max, value: engine.options[key], oninput: (e) => engine.setOption(key, Number(e.target.value)) });
    input.dataset.key = key; out.dataset.key = key;
    return el("label", { className: "row" }, el("span", { textContent: label }), input, out);
  };
  const segment = (label, key, items) => el("div", { className: "row" }, el("span", { textContent: label }),
    el("div", { className: "seg" }, ...items.map(([v, glyph, tip]) => { const b = btn(glyph, () => engine.setOption(key, v), tip); b.dataset.opt = `${key}:${v}`; return b; })));
  const check = (label) => el("label", { className: "row check" }, el("input", { type: "checkbox", onchange: (e) => engine.setOption("transparent", e.target.checked) }), el("span", { textContent: label }));
  const SHAPE_STYLE = [["outline", SVG('<rect x="3.500" y="5" width="13" height="10" rx="1.500"/>'), "윤곽선만"], ["both", SVG('<rect x="3.500" y="5" width="13" height="10" rx="1.500" fill="currentColor" fill-opacity=".35"/>'), "윤곽선 + 채움"], ["fill", SVG('<rect x="3.500" y="5" width="13" height="10" rx="1.500" fill="currentColor"/>'), "채움만"]];
  const OPTIONS = {
    brush: () => [segment("모양", "brushShape", [["circle", "●", "원"], ["square", "■", "사각"], ["slash", "╱", "/ 모양"], ["backslash", "╲", "\\ 모양"]]), slider("크기", "brushSize", 1, 40)],
    eraser: () => [slider("크기", "eraserSize", 2, 60)], airbrush: () => [segment("크기", "airbrushSize", [[4, "작게", "작은 스프레이"], [8, "보통", "보통 스프레이"], [12, "크게", "큰 스프레이"]])],
    line: () => [slider("굵기", "lineWidth", 1, 8)], curve: () => [slider("굵기", "lineWidth", 1, 8)],
    shape: () => [segment("스타일", "shapeStyle", SHAPE_STYLE), slider("굵기", "lineWidth", 1, 8)],
    gradient: () => [segment("모양", "gradientKind", [["linear", "선형", "선형"], ["radial", "방사형", "방사형"]])],
    fill: () => [slider("허용 오차", "fillTol", 0, 128)],
    select: () => [check("투명 선택 (배경색은 옮기지 않음)")],
    text: () => [el("select", { onchange: (e) => engine.setOption("font", e.target.value) }, ...["sans-serif", "serif", "monospace", "Apple SD Gothic Neo", "Malgun Gothic"].map((f) => el("option", { value: f, textContent: f }))), slider("글자 크기", "fontSize", 8, 96),
      el("div", { className: "seg" }, ...[["bold", "<b>B</b>"], ["italic", "<i>I</i>"], ["underline", "<u>U</u>"]].map(([k, g]) => { const b = btn(g, () => engine.setOption(k, !engine.options[k])); b.dataset.opt = `${k}:true`; return b; })), check("투명 배경")],
    magnifier: () => [el("div", { className: "seg wide" }, ...[1, 2, 4, 6, 8].map((z) => { const b = btn(`${z}×`, () => engine.setZoom(z)); b.dataset.zoom = z; return b; }))],
  };
  const group = (t) => (["rect", "ellipse", "roundrect", "polygon"].includes(t) ? "shape" : ["select", "freeselect"].includes(t) ? "select" : t);
  const syncOptions = () => {
    const [name, hint] = TOOL_INFO[engine.tool], parts = (OPTIONS[group(engine.tool)] || (() => []))();
    inspector.replaceChildren(el("h3", { textContent: name }), el("p", { className: "hint", textContent: hint }), ...parts);
    for (const b of inspector.querySelectorAll("[data-opt]")) { const [k, v] = b.dataset.opt.split(":"); b.classList.toggle("on", String(engine.options[k]) === v); }
    for (const k of Object.keys(engine.options)) { const o = inspector.querySelector(`output[data-key="${k}"]`); if (o) o.textContent = engine.options[k]; }
    for (const c of inspector.querySelectorAll("input[type=checkbox]")) c.checked = engine.options.transparent;
    for (const b of inspector.querySelectorAll("[data-zoom]")) b.classList.toggle("on", Number(b.dataset.zoom) === engine.zoom);
  };

  // ── 메뉴 막대 ──
  // 앱 안의 WKWebView에서는 prompt/alert가 없으므로 자체 대화상자를 쓴다.
  const modal = (title, body, { ok = "적용", onOk, onCancel, onOpen } = {}) => {
    const close = () => back.remove();
    const back = el("div", { className: "pui-modal" }, el("div", { className: "box", role: "dialog" }, el("h3", { textContent: title }), body,
      el("div", { className: "acts" }, ...(ok ? [btn("취소", () => { close(); onCancel?.(); }), btn(ok, () => { close(); onOk?.(); }, "", "on")] : [btn("닫기", () => { close(); onCancel?.(); }, "", "on")]))));
    root.append(back); onOpen?.(back); return close;
  };
  const ask = (msg, def) => new Promise((done) => { const i = el("input", { value: def, onkeydown: (e) => { e.stopPropagation(); if (e.key === "Enter") i.closest(".pui-modal").querySelector(".acts .on").click(); } }); modal(msg, i, { onOk: () => done(i.value.split(/[ ,]+/).filter(Boolean).map(Number)), onCancel: () => done(null), onOpen: () => setTimeout(() => i.focus()) }); });
  const filterDialog = (name) => {
    const f = FILTERS[name], vals = Object.fromEntries(f.params.map(([k, , , , d]) => [k, d]));
    if (!f.params.length) return engine.applyFilter(name);
    let raf = 0; const preview = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => engine.previewFilter(name, { ...vals })); };
    const body = el("div", { className: "frows" }, ...f.params.map(([k, label, min, max, d]) => { const out = el("output", { textContent: d }); return el("label", { className: "row" }, el("span", { textContent: label }), el("input", { type: "range", min, max, value: d, oninput: (e) => { vals[k] = Number(e.target.value); out.textContent = vals[k]; preview(); } }), out); }));
    modal(f.label, body, { onOk: () => engine.applyFilter(name, vals), onCancel: () => engine.cancelPreview(), onOpen: preview });
  };
  const toB64 = (bm) => { const u8 = new Uint8Array(bm.px.buffer); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  const bitmapOfImage = async (src) => { const img = await loadImage(src), c = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight }), x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height); return Bitmap.fromBytes(c.width, c.height, new Uint8Array(d.data.buffer)); };
  const openImage = async (file) => { try { engine.openBitmap(await bitmapOfImage(await readDataUrl(file))); engine.setZoom(1); onName?.(file.name); onRecord?.({ name: file.name, blob: file, w: engine.width, h: engine.height }); } catch (e) { modal("열기 실패", el("p", { textContent: e.message }), { ok: null }); } };
  const pasteImage = async (file) => engine.addObjectBitmap(await bitmapOfImage(await readDataUrl(file)), "붙여넣은 이미지");
  const savePng = async () => { const blob = await engine.toPngBlob(), name = `${(getName?.() || "macPaint").replace(/\.(png|jpe?g|webp|gif|bmp)$/i, "")}.png`; await saveBlob(blob, name); onRecord?.({ name, blob, w: engine.width, h: engine.height }); };
  const editColor = (slot) => { const p = el("input", { type: "color", value: engine.colors[slot], oninput: () => engine.setColor(slot, p.value) }); p.click(); };
  const sh = (s) => `<kbd>${s.replace("Mod", MOD.replace("+", ""))}</kbd>`;
  const MENUS = {
    파일: [...(onNew ? [["새로 만들기…", "", () => onNew()]] : []), ["열기…", "", async () => { const [f] = await pickFile("image/png,image/jpeg,image/webp,image/gif,image/bmp"); if (f) openImage(f); }], ["PNG로 저장", "Mod S", savePng]],
    편집: [["되돌리기", "Mod Z", () => engine.undo()], ["다시 실행", IS_MAC ? "⇧⌘Z" : "Ctrl+Y", () => engine.redo()], ["기록 보기", IS_MAC ? "⇧⌘Y" : "Ctrl+Shift+Y", () => (hist.hidden = !hist.hidden)], "-",
      ["잘라내기", "Mod X", () => engine.cut()], ["복사", "Mod C", () => engine.copy()], ["붙여넣기", "Mod V", () => engine.paste()], ["선택 삭제", "⌫", () => engine.deleteSelection()], ["모두 선택", "Mod A", () => engine.selectAll()]],
    레이어: [["새 레이어", "", () => engine.addLayer()], ["레이어 복제", "", () => engine.duplicateLayer()], ["레이어 삭제", "", () => engine.deleteLayer()], "-", ["위로 올리기", "", () => engine.moveLayer(engine.active, 1)], ["아래로 내리기", "", () => engine.moveLayer(engine.active, -1)], ["아래 레이어와 병합", "", () => engine.mergeDown()], ["이미지 병합", "", () => engine.flatten()], "-", ["이미지를 레이어로 열기…", "", () => importLayers()], ["객체 모드 켜기/끄기", "", () => engine.setOption("asObject", !engine.options.asObject)]],
    이미지: [["좌우 대칭", "", () => engine.flipH()], ["상하 대칭", "", () => engine.flipV()], ["오른쪽으로 90° 회전", "", () => engine.rotate(90)], ["180° 회전", "", () => engine.rotate(180)], ["왼쪽으로 90° 회전", "", () => engine.rotate(270)], "-",
      ["늘이기…", "", () => { ask("가로%, 세로% (예: 150 100)", "150 100").then((v) => v && engine.stretch(v[0], v[1] ?? v[0])); }], ["기울이기…", "", () => { ask("가로°, 세로° (예: 20 0)", "20 0").then((v) => v && engine.skew(v[0], v[1] ?? 0)); }], ["색 반전", "Mod I", () => engine.invert()], "-",
      ["이미지 크기 조정…", "", () => ask("새 너비, 높이 (픽셀)", `${engine.width} ${engine.height}`).then((v) => v && v[1] && engine.scaleImage(v[0], v[1]))], ["캔버스 크기…", "", () => ask("캔버스 너비, 높이", `${engine.width} ${engine.height}`).then((v) => v && v[1] && engine.setAttributes(v[0], v[1]))], ["선택 영역으로 자르기", "", () => engine.cropToSelection()], ["이미지 지우기", IS_MAC ? "⇧⌘N" : "Ctrl+Shift+N", () => engine.clear()]],
    필터: Object.entries(FILTERS).map(([k, f]) => [f.label + (f.params.length ? "…" : ""), "", () => filterDialog(k)]),
    색상: [["전경색 편집…", "", () => editColor("fg")], ["배경색 편집…", "", () => editColor("bg")], ["세 번째 색 편집…", "", () => editColor("third")], "-", ["전경색 ↔ 배경색 바꾸기", "X", () => { const { fg, bg } = engine.colors; engine.setColor("fg", bg); engine.setColor("bg", fg); }]],
    보기: [["확대", "", () => engine.zoomStep(1)], ["축소", "", () => engine.zoomStep(-1)], ["실제 크기", "", () => engine.setZoom(1)]],
    도움말: [["단축키 보기", "", () => modal("단축키", el("pre", { className: "help", textContent: `도구: 연필·브러시·지우개 등은 왼쪽 도구 상자에서 고릅니다.\n\n왼쪽 클릭 = 전경색, 오른쪽 클릭 = 배경색, ${IS_MAC ? "⌘" : "Ctrl"}+그리기 = 세 번째 색\n${MOD}Z 되돌리기 / ${IS_MAC ? "⇧⌘Z" : "Ctrl+Y"} 다시 실행\n${MOD}A 모두 선택 · ${MOD}C/X/V 복사/잘라내기/붙여넣기\nDelete 선택 삭제 · Esc 취소 · Enter 확정\nShift = 직선 45°/정사각형/정원 · X = 전경↔배경 바꾸기` }), { ok: null })]],
  };
  const closeMenus = () => { for (const o of menubar.querySelectorAll(".menulist")) o.hidden = true; for (const b of menubar.querySelectorAll(".top")) b.classList.remove("open"); };
  for (const [name, items] of Object.entries(MENUS)) {
    const top = btn(name, () => { const was = !list.hidden; closeMenus(); if (!was) { list.hidden = false; top.classList.add("open"); } }, "", "top");
    const list = el("div", { className: "menulist", hidden: true }, ...items.map((it) => (it === "-" ? el("hr") : btn(`<span>${it[0]}</span>${it[1] ? sh(it[1]) : ""}`, () => { closeMenus(); it[2](); }))));
    menubar.append(el("div", { className: "menu" }, top, list));
  }
  menubar.append(el("span", { className: "spacer" }), el("span", { className: "kbdhint", textContent: IS_MAC ? "⌘Z 되돌리기" : "Ctrl+Z 되돌리기" }));
  addEventListener("pointerdown", (e) => { if (!menubar.contains(e.target)) closeMenus(); });

  // ── 색 상자 ──
  const swatches = el("div", { className: "swatches" });
  const ind = el("div", { className: "indicator", title: "전경색 / 배경색 / 세 번째 색" }, el("i", { className: "bgc" }), el("i", { className: "fgc" }), el("i", { className: "thc" }));
  const hidden = el("input", { type: "color", hidden: true }); let editing = -1;
  hidden.oninput = () => { if (editing >= 0) engine.setPaletteColor(editing, hidden.value); };
  const buildPalette = () => swatches.replaceChildren(...engine.palette.map((c, i) => {
    const s = el("button", { type: "button", className: "sw", title: `${c}\n클릭: 전경색 · 오른쪽 클릭: 배경색 · ${IS_MAC ? "⌘" : "Ctrl"}+클릭: 세 번째 색 · 더블클릭: 이 칸의 색 편집` }); s.style.background = c;
    s.onclick = (e) => engine.setColor(e.ctrlKey || e.metaKey ? "third" : "fg", c); s.oncontextmenu = (e) => { e.preventDefault(); engine.setColor("bg", c); };
    s.ondblclick = () => { editing = i; hidden.value = c; hidden.click(); }; return s;
  }));
  const syncColors = () => { for (const [k, c] of [["fgc", "fg"], ["bgc", "bg"], ["thc", "third"]]) ind.querySelector(`.${k}`).style.background = engine.colors[c]; };
  colors.append(ind, swatches, hidden);

  // ── 상태 표시줄 ──
  const coord = el("span", { className: "coord", textContent: "—" }), info = el("span", { className: "info" });
  const zoomBox = el("div", { className: "zoombox" }, btn("−", () => engine.zoomStep(-1), "축소"), el("span", { className: "zoomval" }), btn("+", () => engine.zoomStep(1), "확대"));
  status.append(info, el("span", { className: "spacer" }), coord, zoomBox);
  engine.canvas.addEventListener("pointermove", (e) => { const r = engine.canvas.getBoundingClientRect(); coord.textContent = `${Math.round(((e.clientX - r.left) / r.width) * engine.canvas.width)}, ${Math.round(((e.clientY - r.top) / r.height) * engine.canvas.height)}`; });
  engine.canvas.addEventListener("pointerleave", () => (coord.textContent = "—"));

  // ── 텍스트 입력 오버레이 ──
  let ta = null;
  const placeText = () => {
    const t = engine.text; if (!t) { ta?.remove(); ta = null; return; }
    if (!ta) { ta = el("textarea", { className: "pui-text", oninput: (e) => engine.textUpdate({ text: e.target.value }), onkeydown: (e) => { if (e.key === "Escape") engine.textCancel(); else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) engine.textCommit(); e.stopPropagation(); } }); wrap.append(ta); setTimeout(() => ta?.focus()); }
    const k = engine.canvas.getBoundingClientRect().width / engine.canvas.width;
    Object.assign(ta.style, { left: `${t.box.x * k}px`, top: `${t.box.y * k}px`, width: `${t.box.w * k}px`, height: `${t.box.h * k}px`, font: `${t.italic ? "italic " : ""}${t.bold ? "bold " : ""}${t.size * k}px ${t.font === "sans-serif" ? "" : `"${t.font}", `}"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`, lineHeight: "1.3", color: "transparent", caretColor: t.c, textDecoration: t.underline ? "underline" : "none" });
  };

  // ── 레이어 패널 ──
  const thumbs = new WeakMap(), THW = 36, THH = 28;
  const thumbOf = (bm) => {                      // 거대한 비트맵도 가볍게: 점을 성기게 뽑아 그린다
    let u = thumbs.get(bm); if (u) return u;
    const c = Object.assign(document.createElement("canvas"), { width: THW, height: THH }), x = c.getContext("2d"), d = x.createImageData(THW, THH), v = new Uint32Array(d.data.buffer);
    for (let j = 0; j < THH; j++) for (let i = 0; i < THW; i++) v[j * THW + i] = bm.px[Math.min(bm.h - 1, Math.floor(((j + .5) * bm.h) / THH)) * bm.w + Math.min(bm.w - 1, Math.floor(((i + .5) * bm.w) / THW))];
    x.putImageData(d, 0, 0); u = c.toDataURL(); thumbs.set(bm, u); return u;
  };
  const EYE = SVG('<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2.200"/>'), EYE_OFF = SVG('<path d="M3 3l14 14M8.500 5.200A8 8 0 0 1 10 5c5 0 8 5 8 5a14 14 0 0 1-2.400 3M6 6.600A14 14 0 0 0 2 10s3 5 8 5a8 8 0 0 0 3.200-.7"/>');
  const objMode = el("input", { type: "checkbox", onchange: (e) => engine.setOption("asObject", e.target.checked) });
  const layerList = el("div", { className: "ly-list", role: "listbox" });
  const opaOut = el("output"), opaIn = el("input", { type: "range", min: 0, max: 100, step: 1 });
  opaIn.oninput = () => { opaOut.textContent = `${opaIn.value}%`; engine._setDraft({ t: "layer_opa", id: engine.active, ly: engine.active, o: opaIn.value / 100 }); };
  opaIn.onchange = () => { engine.cancelPreview(); engine.setLayerOpacity(engine.active, opaIn.value / 100); };
  const lbtn = (label, tip, fn) => btn(label, fn, tip);
  const importLayers = async () => { for (const f of await pickFile("image/png,image/jpeg,image/webp,image/gif,image/bmp", true)) try { engine.addObjectBitmap(await bitmapOfImage(await readDataUrl(f)), f.name.replace(/\.[^.]+$/, "")); } catch (e) { modal("열기 실패", el("p", { textContent: e.message }), { ok: null }); } };
  layersPane.append(
    el("div", { className: "ly-head" }, el("h3", { textContent: "레이어" }), el("label", { className: "ly-obj", title: "켜면 연필·도형·글자가 새 레이어(객체)로 만들어져 나중에 이동도구로 옮길 수 있습니다" }, objMode, el("span", { textContent: "객체 모드" }))),
    layerList,
    el("label", { className: "ly-opa" }, el("span", { textContent: "불투명도" }), opaIn, opaOut),
    el("div", { className: "ly-btns" }, lbtn("＋ 새 레이어", "새 레이어", () => engine.addLayer()), lbtn("복제", "레이어 복제", () => engine.duplicateLayer()), lbtn("▲ 위로", "한 칸 위로", () => engine.moveLayer(engine.active, 1)), lbtn("▼ 아래로", "한 칸 아래로", () => engine.moveLayer(engine.active, -1)),
      lbtn("아래와 병합", "아래 레이어와 합치기", () => engine.mergeDown()), lbtn("삭제", "레이어 삭제", () => engine.deleteLayer())),
    lbtn("이미지를 레이어로 열기…", "이미지 파일을 객체(레이어)로 올립니다", importLayers));
  const syncLayers = () => {
    const act = engine.active, ls = engine.layers;
    layerList.replaceChildren(...[...ls].reverse().map((l) => {
      const eye = btn(l.visible ? EYE : EYE_OFF, (e) => { e.stopPropagation(); engine.setLayerVisible(l.id, !l.visible); }, l.visible ? "숨기기" : "보이기", "ly-eye");
      const nm = el("span", { className: "ly-name", textContent: l.name, title: "더블클릭: 이름 바꾸기" });
      nm.ondblclick = () => { const i = el("input", { value: l.name, className: "ly-rename" }); nm.replaceWith(i); i.focus(); i.select(); const done = (ok) => { if (ok && i.value.trim() && i.value !== l.name) engine.renameLayer(l.id, i.value.trim()); else syncLayers(); }; i.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); }; i.onblur = () => done(true); };
      const row = el("div", { className: `ly-row${l.id === act ? " on" : ""}${l.visible ? "" : " off"}`, role: "option", tabIndex: 0, onclick: () => engine.selectLayer(l.id) }, eye, el("img", { src: thumbOf(l.bm), alt: "", className: "ly-th" }), nm);
      return row;
    }));
    const cur = engine.stack.get(act); if (cur) { opaIn.value = Math.round(cur.opacity * 100); opaOut.textContent = `${opaIn.value}%`; }
    objMode.checked = !!engine.options.asObject;
  };
  engine.on("layers", syncLayers); engine.on("options", () => { objMode.checked = !!engine.options.asObject; });

  // ── 기록 패널 ──
  const syncHistory = () => hist.replaceChildren(el("div", { className: "head" }, el("h3", { textContent: "기록" }), btn("✕", () => (hist.hidden = true), "닫기", "x")),
    ...engine.history.map((h) => { const b = btn(`<span style="padding-left:${h.depth * 14}px">${h.label}</span>`, () => engine.goto(h.id)); b.className = `${h.current ? "cur" : ""} ${h.onPath ? "path" : ""}`; return b; }));

  // ── 크기·확대 ──
  const layout = () => {
    const c = engine.canvas, base = Math.min(1, (area.clientWidth - 48) / c.width) || 1;
    c.style.width = `${c.width * base * engine.zoom}px`; c.style.height = "auto"; placeText();
  };
  const syncAll = () => {
    for (const [t, b] of Object.entries(toolBtns)) b.classList.toggle("on", t === engine.tool);
    syncColors(); const s = engine.sel;
    info.textContent = `${engine.width} × ${engine.height} px${s ? ` · 선택 ${s.w} × ${s.h}` : ""}${engine.preset.undo ? ` · 기록 ${engine.tree.nodes.size - 1}단계` : ""}`;
    zoomBox.querySelector(".zoomval").textContent = `${engine.zoom * 100}%`;
    if (!hist.hidden) syncHistory(); placeText();
    for (const b of inspector.querySelectorAll("[data-zoom]")) b.classList.toggle("on", Number(b.dataset.zoom) === engine.zoom);
  };
  engine.on("tool", () => { syncOptions(); syncAll(); }); engine.on("options", () => { syncOptions(); placeText(); });
  engine.on("change", syncAll); engine.on("selection", syncAll); engine.on("colors", () => { syncColors(); }); engine.on("palette", buildPalette);
  engine.on("zoom", () => { layout(); syncAll(); }); engine.on("size", layout); engine.on("text", placeText);
  new ResizeObserver(layout).observe(area);
  const histToggle = hist; Object.defineProperty(hist, "hidden", { configurable: true, get() { return this.hasAttribute("hidden"); }, set(v) { v ? this.setAttribute("hidden", "") : this.removeAttribute("hidden"); if (!v) syncHistory(); } });
  buildPalette(); syncOptions(); syncAll(); syncLayers(); layout(); void histToggle;

  // ── 단축키 ──
  const onKey = (e) => {
    if (!root.offsetParent || e.target.matches?.("input,textarea,select")) return;
    const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
    if (c && k === "z") { e.shiftKey ? engine.redo() : engine.undo(); }
    else if (c && k === "y") { e.shiftKey ? (hist.hidden = !hist.hidden) : engine.redo(); }
    else if (c && k === "a") engine.selectAll(); else if (c && k === "s") savePng();
    else if (c && k === "i") engine.invert(); else if (c && e.shiftKey && k === "n") engine.clear();
    else if (gameKeys && (k === "x" || e.key === "Enter" || e.key === "Escape")) return;      // 게임 단축키(X 반칙·Enter 다음·Esc 일시정지)와 겹치지 않게
    else if (!c && k === "x") { const { fg, bg } = engine.colors; engine.setColor("fg", bg); engine.setColor("bg", fg); }
    else if (e.key === "Delete" || e.key === "Backspace" || e.key === "Escape" || e.key === "Enter") engine.key(e.key === "Backspace" ? "Delete" : e.key);
    else return;
    e.preventDefault();
  };
  addEventListener("keydown", onKey);
  // 복사·잘라내기·붙여넣기는 메뉴(앱)와 키보드 모두 clipboard 이벤트로 들어온다.
  const live = () => root.offsetParent && !document.activeElement?.matches?.("input,textarea,select");
  const mark = (e) => e.clipboardData?.setData("text/plain", "macpaint-selection");   // 시스템 클립보드에 남은 옛 이미지가 붙지 않도록 덮어쓴다
  const onCopy = (e) => { if (live()) { if (engine.copy()) mark(e); e.preventDefault(); } }, onCut = (e) => { if (live()) { if (engine.sel && engine.cut()) mark(e); e.preventDefault(); } };
  const onPaste = (e) => { if (!live()) return; e.preventDefault(); const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/")); f ? pasteImage(f) : engine.paste(); };
  addEventListener("copy", onCopy); addEventListener("cut", onCut); addEventListener("paste", onPaste);
  root.addEventListener("dragover", (e) => e.preventDefault()); root.addEventListener("drop", (e) => { const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); openImage(f); } });
  return { openImage, isDirty: () => engine.canUndo, destroy() { removeEventListener("keydown", onKey); removeEventListener("copy", onCopy); removeEventListener("cut", onCut); removeEventListener("paste", onPaste); }, layout };
}
