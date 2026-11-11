// 문서 탭: 한 편집기 안에서 여러 문서를 탭으로 열어 두고 오간다. 탭마다 편집기 인스턴스가 하나씩 있다.
const el = (tag, attrs = {}, ...kids) => { const n = Object.assign(document.createElement(tag), attrs); n.append(...kids); return n; };

/** create(host, api, init) → { isDirty?, show?, destroy? }. api.setName(이름)으로 탭 제목을 바꾼다. */
export function mountDocTabs(section, { prefix, create, onNew }) {
  section.classList.add("withtabs");
  const strip = el("div", { className: "doctabs", role: "tablist" }), hosts = el("div", { className: "dochosts" });
  const plus = el("button", { type: "button", className: "dt-new", title: "새 탭", textContent: "+" });
  section.append(strip, hosts); strip.append(plus);
  const docs = []; let cur = null, seq = 0;

  function show(d) {
    cur = d;
    for (const x of docs) { const on = x === d; x.host.classList.toggle("on", on); x.tab.classList.toggle("on", on); x.tab.setAttribute("aria-selected", on); }
    d.tab.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    d.inst?.show?.();
  }
  function close(d) {
    if (d.inst?.isDirty?.() && !confirm(`“${d.name}” 탭을 닫을까요?\n저장하지 않은 변경은 사라집니다.`)) return;
    const i = docs.indexOf(d); d.inst?.destroy?.(); d.host.remove(); d.tab.remove(); docs.splice(i, 1);
    if (!docs.length) add(); else if (cur === d) show(docs[Math.min(i, docs.length - 1)]);
  }
  function rename(d) {
    const input = el("input", { value: d.name, className: "dt-input" }); d.title.replaceWith(input); input.focus(); input.select();
    const done = (ok) => { if (ok && input.value.trim()) d.api.setName(input.value.trim()); input.replaceWith(d.title); };
    input.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); };
    input.onblur = () => done(true); input.onclick = (e) => e.stopPropagation();
  }
  function add(init) {
    // 아직 손대지 않은 첫 빈 탭은 새 문서가 열릴 때 대신 쓴다.
    const old = init && docs.length === 1 && docs[0].name === docs[0].auto && !docs[0].inst?.isDirty?.() ? docs[0] : null;
    const d = { name: `${prefix} ${++seq}`, auto: null, host: el("div", { className: "doc-host" }) };
    d.title = el("span", { className: "dt-title", textContent: d.name });
    const x = el("button", { type: "button", className: "dt-x", title: "탭 닫기", textContent: "×", onclick: (e) => { e.stopPropagation(); close(d); } });
    d.tab = el("div", { className: "dt", role: "tab", tabIndex: 0, title: "더블클릭: 이름 바꾸기" }, d.title, x);
    d.tab.onclick = () => show(d); d.tab.ondblclick = () => rename(d);
    d.tab.onauxclick = (e) => { if (e.button === 1) close(d); };
    d.tab.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") show(d); };
    d.api = { get name() { return d.name; }, setName: (n) => { d.name = n; d.title.textContent = n; d.tab.title = `${n} — 더블클릭: 이름 바꾸기`; } };
    strip.insertBefore(d.tab, plus); hosts.append(d.host); docs.push(d);
    d.auto = d.name; show(d); d.inst = create(d.host, d.api, init); d.inst?.show?.();
    if (old) { old.inst?.destroy?.(); old.host.remove(); old.tab.remove(); docs.splice(docs.indexOf(old), 1); }
    return d.inst;
  }
  plus.onclick = () => (onNew ? onNew() : add());
  add();
  return { add, onNew: () => (onNew ? onNew() : add()), current: () => cur?.inst, count: () => docs.length };
}
