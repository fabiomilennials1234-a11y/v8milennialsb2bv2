import type { StudioWindow } from "./metrics-studio-window";

/** Leitura responsiva sem escrever a adaptação no layout compartilhado. */
export function projectStudioWindows(windows: StudioWindow[], width: number, fillWidth = false): StudioWindow[] {
  if (width <= 0 || windows.length === 0) return windows;
  const fits = windows.every((win) => win.x + win.w + 16 <= width);
  if (fits) {
    if (!fillWidth) return windows;
    // Templates crescem com o canvas, sem alterar o layout persistido ou a
    // tipografia. Mantém 16px entre colunas e nas bordas; alturas são estáveis.
    const left = Math.min(...windows.map((win) => win.x));
    const right = Math.max(...windows.map((win) => win.x + win.w));
    const scale = (width - 16) / (right - left + 16);
    return windows.map((win) => ({ ...win,
      x: 16 + (win.x - left) * scale,
      w: (win.w + 16) * scale - 16,
    }));
  }
  let y = 16;
  return [...windows].sort((a, b) => a.y - b.y || a.x - b.x).map((win) => {
    const projected = { ...win, x: 16, y, w: Math.max(220, width - 32) };
    y += win.h + 16;
    return projected;
  });
}
