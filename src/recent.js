// 최근 연 파일 기록. 내용은 IndexedDB(Blob)에 두고 미리보기는 작은 이미지로 함께 저장한다.
const DB = "macpaint", STORE = "recent", MAX = 12;
const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode), out = fn(t.objectStore(STORE)); t.oncomplete = () => { db.close(); res(out?.result); }; t.onerror = () => rej(t.error); }); };

async function thumbOf(blob) {
  try {
    const url = URL.createObjectURL(blob), img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const k = Math.min(1, 320 / Math.max(img.naturalWidth || 320, img.naturalHeight || 240)), w = Math.max(1, Math.round((img.naturalWidth || 320) * k)), h = Math.max(1, Math.round((img.naturalHeight || 240) * k));
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h }), x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
    return c.toDataURL("image/jpeg", 0.8);
  } catch { return ""; }
}

/** 같은 종류·이름은 하나로 합치고 가장 앞으로 올린다. */
export async function addRecent({ kind, name, w, h, blob, preview }) {
  try {
    const thumb = await thumbOf(preview || blob), id = `${kind}:${name}`, all = await listRecent();
    await tx("readwrite", (s) => {
      s.put({ id, kind, name, w, h, t: Date.now(), thumb, blob });
      for (const r of all.filter((x) => x.id !== id).slice(MAX - 1)) s.delete(r.id);
    });
  } catch {}
}
export async function listRecent() { try { const all = (await tx("readonly", (s) => s.getAll())) || []; return all.sort((a, b) => b.t - a.t); } catch { return []; } }
export async function removeRecent(id) { try { await tx("readwrite", (s) => s.delete(id)); } catch {} }
export async function clearRecent() { try { await tx("readwrite", (s) => s.clear()); } catch {} }

export function ago(t, now = Date.now()) {
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return "방금"; if (m < 60) return `${m}분 전`; const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24); return d < 30 ? `${d}일 전` : new Date(t).toLocaleDateString("ko-KR");
}
