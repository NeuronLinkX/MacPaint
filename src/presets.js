// 그림판 프리셋. 게임용은 공개 규칙대로 제한한다: 먹색 1가지·굵기 2단계·브러시(와 지우개)·전체 지우기만(docs/03 §5, docs/04 §2.1).
// sandbox는 JS Paint 기능 전체를 연다(개발·시연용).
export const TOOLS = ["move", "freeselect", "select", "eraser", "fill", "pick", "magnifier", "pencil", "brush", "airbrush", "gradient", "text", "line", "curve", "rect", "polygon", "ellipse", "roundrect"];

const PAPER = { bg: "#F2F1EC", color: "#191817", lockColors: true };

export const PRESETS = {
  // 퀵드로우: 노트북 마우스. 16:9. 1/2/E/C 키. 되돌리기 없음(운영자 Z는 게임 상태 Undo).
  quickdraw: { ...PAPER, width: 1600, height: 900, widths: { 1: 6, 2: 16 }, eraserWidth: 40, tools: ["brush", "eraser"], undo: false },
  // 그림 텔레파시: 팀 폰 손가락. 4:3. 되돌리기·전체 지우기 허용.
  telepathy: { ...PAPER, width: 800, height: 600, widths: { 1: 5, 2: 14 }, eraserWidth: 30, tools: ["brush"], undo: true },
  // 퀵드로우 + JS Paint 전체 도구(운영자가 고르는 옵션). 크기·배경은 퀵드로우와 같아 스크린 미러가 그대로 맞는다.
  quickdraw_full: { ...PAPER, lockColors: false, width: 1600, height: 900, widths: { 1: 8, 2: 16, 3: 28 }, eraserWidth: 40, tools: TOOLS, undo: true },
  sandbox: { bg: "#ffffff", color: "#000000", lockColors: false, width: 1600, height: 900, widths: { 1: 4, 2: 10, 3: 20 }, eraserWidth: 16, tools: TOOLS, undo: true },
};
