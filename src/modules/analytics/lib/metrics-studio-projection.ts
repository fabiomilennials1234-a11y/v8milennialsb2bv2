import type { StudioWindow } from "./metrics-studio-window";

/** Leitura responsiva sem escrever a adaptação no layout compartilhado. */
export function projectStudioWindows(windows: StudioWindow[], width: number): StudioWindow[] {
  if (width <= 0 || windows.every((win) => win.x + win.w + 16 <= width)) return windows;
  let y = 16;
  return [...windows].sort((a, b) => a.y - b.y || a.x - b.x).map((win) => {
    const projected = { ...win, x: 16, y, w: Math.max(220, width - 32) };
    y += win.h + 16;
    return projected;
  });
}
