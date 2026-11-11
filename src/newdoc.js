// 새로 만들기: GIMP 템플릿·단위 방식. 크기는 항상 픽셀로 보관하고, 표시할 때만 단위를 바꾼다.
export const MAX_PX = 36e6; // 비트맵 편집기 메모리 한도(A2 300ppi ≈ 34.8MP까지)
export const MAX_SIDE = 16000;

// 한 단위가 몇 인치인지 (px는 ppi에 따라 다르므로 별도 처리)
export const UNITS = [
  { id: "px", label: "픽셀", dec: 0 }, { id: "in", label: "인치", inch: 1, dec: 3 }, { id: "mm", label: "밀리미터", inch: 1 / 25.4, dec: 2 },
  { id: "pt", label: "포인트", inch: 1 / 72, dec: 1 }, { id: "pc", label: "파이카", inch: 1 / 6, dec: 2 }, { id: "cm", label: "센티미터", inch: 1 / 2.54, dec: 2 },
  { id: "m", label: "미터", inch: 1 / 0.0254, dec: 4 }, { id: "ft", label: "피트", inch: 12, dec: 3 }, { id: "yd", label: "야드", inch: 36, dec: 3 },
];
const unit = (id) => UNITS.find((u) => u.id === id) || UNITS[0];
export const toPx = (v, unitId, ppi) => (unitId === "px" ? Math.round(v) : Math.round(v * unit(unitId).inch * ppi));
export const fromPx = (px, unitId, ppi) => { const u = unit(unitId); if (u.id === "px") return px; const r = px / (u.inch * ppi), k = 10 ** u.dec; return Math.round(r * k) / k; };

const paper = (label, wMm, hMm) => ({ label, w: wMm, h: hMm, unit: "mm", ppi: 300 });
const px = (label, w, h) => ({ label, w, h, unit: "px", ppi: 72 });
export const TEMPLATES = [
  { group: "용지 (300 ppi)", items: [
    paper("A0", 841, 1189), paper("A1", 594, 841), paper("A2", 420, 594), paper("A3", 297, 420), paper("A4", 210, 297), paper("A5", 148, 210), paper("A6", 105, 148), paper("A7", 74, 105),
    paper("B4", 250, 353), paper("B5", 176, 250), paper("B5-일본", 182, 257), { label: "US Letter", w: 8.5, h: 11, unit: "in", ppi: 300 }, { label: "US Legal", w: 8.5, h: 14, unit: "in", ppi: 300 },
  ] },
  { group: "명함·기타", items: [
    paper("명함 88.9×50.8 (미국)", 88.9, 50.8), paper("명함 85×55 (서유럽)", 85, 55), paper("명함 90×50 (동유럽)", 90, 50), paper("명함 90×55 (한국·호주 등)", 90, 55), paper("CD 커버", 120, 120),
  ] },
  { group: "웹", items: [px("프로필·아바타·아이콘 512×512", 512, 512), px("배너 리더보드 728×90", 728, 90), px("배너 하프 페이지 300×600", 300, 600), px("배너 중간 사각형 300×250", 300, 250), px("배너 와이드 스카이스크래퍼 160×600", 160, 600), px("배너 모바일 리더보드 320×50", 320, 50)] },
  { group: "화면", items: [
    px("4:3 · 1024×768 (XGA)", 1024, 768), px("4:3 · 1152×864 (XGA+)", 1152, 864), px("4:3 · 1600×1200 (UXGA)", 1600, 1200), px("4:3 · 2048×1536 (QXGA)", 2048, 1536),
    px("16:10 · 1680×1050 (WSXGA+)", 1680, 1050), px("16:10 · 1920×1200 (WUXGA)", 1920, 1200), px("16:10 · 2560×1600 (WQXGA)", 2560, 1600), px("16:10 · 3840×2400 (WQUXGA)", 3840, 2400),
    px("16:9 · 1280×720 (HD 720p)", 1280, 720), px("16:9 · 1920×1080 (Full HD)", 1920, 1080), px("16:9 · 3840×2160 (4K UHD)", 3840, 2160), px("16:9 · 7680×4320 (8K UHD)", 7680, 4320),
    px("17:9 · 2048×1080 (DCI 2K)", 2048, 1080), px("17:9 · 4096×2160 (DCI 4K)", 4096, 2160),
  ] },
  { group: "휴대폰", items: [px("18.5:9 · 1440×2960", 1440, 2960), px("19:9 · 1440×3040", 1440, 3040), px("19.5:9 · 1440×3120", 1440, 3120), px("20:9 · 1440×3200", 1440, 3200)] },
];
export const templatePx = (t) => ({ w: toPx(t.w, t.unit, t.ppi), h: toPx(t.h, t.unit, t.ppi), ppi: t.ppi });

/** 한도를 넘으면 비율을 유지해 줄인다. 줄였는지(clamped)도 알려 준다. */
export function fitLimit(w, h, { maxPx = MAX_PX, maxSide = MAX_SIDE } = {}) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const k = Math.min(1, Math.sqrt(maxPx / (w * h)), maxSide / Math.max(w, h));
  return k < 1 ? { w: Math.max(1, Math.floor(w * k)), h: Math.max(1, Math.floor(h * k)), clamped: true } : { w, h, clamped: false };
}

const el = (tag, attrs = {}, ...kids) => { const n = Object.assign(document.createElement(tag), attrs); n.append(...kids); return n; };

/** 새로 만들기 대화상자. 확인하면 {w,h,ppi}(픽셀), 취소하면 null. */
export function openNewDialog({ kind = "png", limit = kind === "png", init = { w: kind === "png" ? 1600 : 1200, h: kind === "png" ? 900 : 800, ppi: 72 } } = {}) {
  return new Promise((done) => {
    const S = { w: init.w, h: init.h, ppi: init.ppi, unit: "px" };
    const tpl = el("select", { className: "nd-tpl" }, el("option", { value: "", textContent: "사용자 지정" }));
    TEMPLATES.forEach((g, gi) => { const og = el("optgroup", { label: g.group }); g.items.forEach((t, i) => og.append(el("option", { value: `${gi}.${i}`, textContent: t.label }))); tpl.append(og); });
    const num = (v) => el("input", { type: "number", min: "0", step: "any", value: v, className: "nd-num" });
    const wIn = num(S.w), hIn = num(S.h), ppiIn = el("input", { type: "number", min: "1", max: "2400", value: S.ppi, className: "nd-num nd-ppi" });
    const unitSel = el("select", { className: "nd-unit" }, ...UNITS.map((u) => el("option", { value: u.id, textContent: u.label })));
    const port = el("button", { type: "button", className: "nd-or", title: "세로", innerHTML: '<svg viewBox="0 0 16 16"><rect x="3.500" y="1.500" width="9" height="13" rx="1.500"/></svg>' });
    const land = el("button", { type: "button", className: "nd-or", title: "가로", innerHTML: '<svg viewBox="0 0 16 16"><rect x="1.500" y="3.500" width="13" height="9" rx="1.500"/></svg>' });
    const info = el("div", { className: "nd-info" }), warn = el("div", { className: "nd-warn" });
    const show = () => {
      const ex = S.src && S.src.unit === S.unit && S.src.ppi === S.ppi && toPx(S.src.w, S.unit, S.ppi) === S.w && toPx(S.src.h, S.unit, S.ppi) === S.h; // 템플릿 원래 값(210 등)을 그대로 보여 준다
      wIn.value = ex ? S.src.w : fromPx(S.w, S.unit, S.ppi); hIn.value = ex ? S.src.h : fromPx(S.h, S.unit, S.ppi); ppiIn.value = S.ppi;
      port.classList.toggle("on", S.h >= S.w); land.classList.toggle("on", S.w > S.h);
      const f = limit ? fitLimit(S.w, S.h) : fitLimit(S.w, S.h, { maxPx: Infinity });
      info.textContent = `${S.w} × ${S.h} 픽셀 · ${S.ppi} ppi`;
      warn.textContent = f.clamped ? `크기가 너무 커서 ${f.w} × ${f.h} 픽셀로 줄여 만듭니다.` : "";
    };
    const readSize = () => { S.w = Math.max(1, toPx(Number(wIn.value) || 1, S.unit, S.ppi)); S.h = Math.max(1, toPx(Number(hIn.value) || 1, S.unit, S.ppi)); tpl.value = ""; S.src = null; };
    wIn.oninput = () => { readSize(); info.textContent = `${S.w} × ${S.h} 픽셀 · ${S.ppi} ppi`; }; hIn.oninput = wIn.oninput; wIn.onchange = hIn.onchange = show;
    unitSel.onchange = () => { S.unit = unitSel.value; show(); };
    ppiIn.onchange = () => { S.ppi = Math.min(2400, Math.max(1, Math.round(Number(ppiIn.value) || S.ppi))); tpl.value = ""; if (S.unit !== "px") readSize(); show(); };
    port.onclick = () => { if (S.w > S.h) { [S.w, S.h] = [S.h, S.w]; S.src = null; } show(); }; land.onclick = () => { if (S.h > S.w) { [S.w, S.h] = [S.h, S.w]; S.src = null; } show(); };
    tpl.onchange = () => { if (!tpl.value) return; const [g, i] = tpl.value.split(".").map(Number), t = templatePx(TEMPLATES[g].items[i]); S.ppi = t.ppi; S.w = t.w; S.h = t.h; S.src = TEMPLATES[g].items[i]; show(); };
    const row = (label, ...kids) => el("div", { className: "nd-row" }, el("label", { textContent: label }), el("div", { className: "nd-ctl" }, ...kids));
    const close = (v) => { back.remove(); removeEventListener("keydown", onKey, true); done(v); };
    const create = () => { readSize(); const f = limit ? fitLimit(S.w, S.h) : fitLimit(S.w, S.h, { maxPx: Infinity }); close({ w: f.w, h: f.h, ppi: S.ppi }); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(null); } else if (e.key === "Enter" && !e.target.matches?.("select")) { e.stopPropagation(); create(); } };
    const back = el("div", { className: "nd-back" }, el("div", { className: "nd-box", role: "dialog", "aria-label": "새로 만들기" },
      el("h3", { textContent: kind === "png" ? "새 이미지 만들기" : "새 SVG 문서 만들기" }),
      row("템플릿", tpl), el("div", { className: "nd-sec", textContent: "이미지 크기" }),
      row("너비", wIn), row("높이", hIn, unitSel), row("방향", port, land), row("해상도", ppiIn, el("span", { className: "nd-suffix", textContent: "ppi" })), info, warn,
      el("div", { className: "nd-acts" }, el("button", { type: "button", textContent: "취소", onclick: () => close(null) }), el("button", { type: "button", className: "on", textContent: "만들기", onclick: create }))));
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(null); });
    addEventListener("keydown", onKey, true); document.body.append(back); show(); setTimeout(() => wIn.select());
  });
}
