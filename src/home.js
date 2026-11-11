// 시작 화면: 새로 만들기 · 파일 열기 · 최근 파일. 앱을 켤 때와 로고를 누를 때 열린다.
import { listRecent, removeRecent, clearRecent, ago } from "./recent.js";
const el = (tag, attrs = {}, ...kids) => { const n = Object.assign(document.createElement(tag), attrs); n.append(...kids); return n; };
const ICON = {
  png: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.500" y="4" width="17" height="16" rx="3"/><circle cx="9" cy="9.500" r="1.600"/><path d="M4 17l5-5 4 4 3-3 4 4"/></svg>',
  svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 18C6 7 18 7 19 18"/><rect x="3" y="16" width="4" height="4" rx="1"/><rect x="17" y="16" width="4" height="4" rx="1"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.500 7.500A2 2 0 0 1 5.500 5.500h4l2 2.500h7a2 2 0 0 1 2 2v7.500a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
};

/** actions: { newPng(), newSvg(), openFile(), openRecent(rec) } — 각 동작 뒤에 화면은 자동으로 닫힌다. */
export function mountHome(host, actions) {
  const root = el("div", { className: "home", hidden: true, role: "dialog", "aria-label": "시작" });
  const list = el("div", { className: "home-list" }), head = el("div", { className: "home-h2" });
  const card = (kind, title, sub, fn) => el("button", { type: "button", className: "home-card", innerHTML: `${ICON[kind]}<b>${title}</b><span>${sub}</span>`, onclick: async () => { await fn(); } });
  const close = () => { root.hidden = true; };
  root.append(el("div", { className: "home-box" },
    el("div", { className: "home-title" }, el("img", { src: "assets/logo.svg", width: 44, height: 44, alt: "" }), el("div", {}, el("h1", { textContent: "macPaint" }), el("p", { textContent: "새로 만들거나 최근 작업을 이어서 하세요" }))),
    el("div", { className: "home-cards" },
      card("png", "새 PNG 이미지", "래스터 · 템플릿 · 크기 지정", async () => { if (await actions.newPng()) close(); }),
      card("svg", "새 SVG 문서", "벡터 · 일러스트레이터식", async () => { if (await actions.newSvg()) close(); }),
      card("open", "파일 열기…", "PNG · JPG · SVG", async () => { if (await actions.openFile()) close(); })),
    head, list,
    el("button", { type: "button", className: "home-skip", textContent: "빈 문서로 시작", onclick: close })));
  host.append(root);
  root.addEventListener("pointerdown", (e) => { if (e.target === root) close(); });
  addEventListener("keydown", (e) => { if (!root.hidden && e.key === "Escape") close(); });

  async function refresh() {
    const rs = await listRecent(); list.replaceChildren(); head.replaceChildren();
    if (!rs.length) { list.append(el("p", { className: "home-empty", textContent: "아직 연 파일이 없습니다. 파일을 열거나 저장하면 여기에 나타납니다." })); return; }
    head.append(el("span", { textContent: "최근 항목" }), el("button", { type: "button", textContent: "목록 지우기", onclick: async () => { await clearRecent(); refresh(); } }));
    for (const r of rs) {
      const x = el("button", { type: "button", className: "home-x", title: "목록에서 제거", textContent: "×", onclick: async (e) => { e.stopPropagation(); await removeRecent(r.id); refresh(); } });
      const th = el("div", { className: "home-th" }, r.thumb ? el("img", { src: r.thumb, alt: "" }) : el("span", { innerHTML: ICON[r.kind] }), el("i", { textContent: r.kind.toUpperCase() }), x);
      const it = el("div", { className: "home-item", tabIndex: 0, title: r.name }, th, el("b", { textContent: r.name }), el("span", { textContent: `${r.w && r.h ? `${r.w}×${r.h} · ` : ""}${ago(r.t)}` }));
      const go = async () => { if (await actions.openRecent(r)) close(); };
      it.onclick = go; it.onkeydown = (e) => { if (e.key === "Enter") go(); };
      list.append(it);
    }
  }
  return { open: () => { root.hidden = false; refresh(); }, close, refresh, get visible() { return !root.hidden; } };
}
