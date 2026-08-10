import { useCallback, useMemo } from "react";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import {
  METRIC_BY_ID,
  type ChartKind,
  type StudioMetric,
} from "@/modules/analytics/lib/metrics-studio-catalog";

/** Passo do grid do canvas — todo drag/resize encaixa nele. */
export const GRID = 8;

export const MIN_W = 220;
// 120 = header (44) + valor (54) + seletor de gráfico (34), sem folga morta.
export const MIN_H = 120;

export interface StudioWindow {
  /** Instância, não métrica: a mesma métrica pode abrir duas janelas. */
  id: string;
  metricId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  chart: ChartKind;
  z: number;
}

interface StudioState {
  windows: StudioWindow[];
  nextZ: number;
  seq: number;
}

const EMPTY: StudioState = { windows: [], nextZ: 1, seq: 0 };

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

/** Tamanho inicial por tipo de gráfico — pizza/vela precisam de mais corpo. */
function initialSize(chart: ChartKind): { w: number; h: number } {
  if (chart === "pie") return { w: 360, h: 300 };
  if (chart === "candle") return { w: 480, h: 300 };
  if (chart === "line") return { w: 440, h: 260 };
  // Número não tem corpo de gráfico — altura justa, sem área morta.
  return { w: 280, h: 132 };
}

const GAP = 16;

function overlaps(a: { x: number; y: number; w: number; h: number }, b: StudioWindow) {
  return a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y;
}

/**
 * Acha o primeiro slot livre numa varredura em coluna, para que a métrica nova
 * não caia em cima da anterior. Cai no cascateamento quando o canvas lota.
 */
function placeNext(windows: StudioWindow[], w: number, h: number, bounds: { width: number; height: number }) {
  const maxX = Math.max(GAP, bounds.width - w - GAP);
  const maxY = Math.max(GAP, bounds.height - h - GAP);

  for (let y = GAP; y <= maxY; y += GRID * 4) {
    for (let x = GAP; x <= maxX; x += GRID * 4) {
      if (!windows.some((win) => overlaps({ x, y, w, h }, win))) return { x, y };
    }
  }

  const offset = (windows.length % 8) * 28;
  return { x: GAP + offset, y: GAP + offset };
}

export interface MetricsStudioApi {
  windows: StudioWindow[];
  openMetricIds: Set<string>;
  addMetric: (metric: StudioMetric, bounds: { width: number; height: number }) => void;
  removeWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, w: number, h: number) => void;
  setChart: (id: string, chart: ChartKind, bounds: { width: number; height: number }) => void;
  focusWindow: (id: string) => void;
  clear: () => void;
}

export function useMetricsStudio(): MetricsStudioApi {
  const [state, setState] = usePersistedState<StudioState>("metrics-studio", EMPTY, {
    ttlMs: THIRTY_DAYS,
  });

  const windows = state.windows ?? EMPTY.windows;

  const addMetric = useCallback(
    (metric: StudioMetric, bounds: { width: number; height: number }) => {
      setState((prev) => {
        const chart: ChartKind = metric.charts[0] ?? "number";
        const { w, h } = initialSize(chart);
        const { x, y } = placeNext(prev.windows, w, h, bounds);
        const seq = prev.seq + 1;
        return {
          windows: [
            ...prev.windows,
            { id: `${metric.id}-${seq}`, metricId: metric.id, x, y, w, h, chart, z: prev.nextZ },
          ],
          nextZ: prev.nextZ + 1,
          seq,
        };
      });
    },
    [setState],
  );

  const removeWindow = useCallback(
    (id: string) => setState((prev) => ({ ...prev, windows: prev.windows.filter((w) => w.id !== id) })),
    [setState],
  );

  const moveWindow = useCallback(
    (id: string, x: number, y: number) =>
      setState((prev) => ({
        ...prev,
        windows: prev.windows.map((w) => (w.id === id ? { ...w, x, y } : w)),
      })),
    [setState],
  );

  const resizeWindow = useCallback(
    (id: string, w: number, h: number) =>
      setState((prev) => ({
        ...prev,
        windows: prev.windows.map((win) => (win.id === id ? { ...win, w, h } : win)),
      })),
    [setState],
  );

  const setChart = useCallback(
    (id: string, chart: ChartKind, bounds: { width: number; height: number }) =>
      setState((prev) => {
        const target = prev.windows.find((w) => w.id === id);
        if (!target) return prev;

        // Trocar para pizza/vela num card de número deixaria o gráfico espremido.
        const min = initialSize(chart);
        const grown = {
          ...target,
          chart,
          w: Math.max(target.w, min.w),
          h: Math.max(target.h, min.h),
        };

        // Crescer no lugar atropela a janela vizinha e pode vazar do canvas.
        // Só reposiciona quando o retângulo NOVO de fato colide ou transborda —
        // sobreposição que o próprio usuário criou arrastando fica de pé.
        const others = prev.windows.filter((w) => w.id !== id);
        const transborda =
          bounds.width > 0 &&
          (grown.x + grown.w > bounds.width - GAP || grown.y + grown.h > bounds.height - GAP);
        const cresceu = grown.w > target.w || grown.h > target.h;
        const colide = cresceu && others.some((w) => overlaps(grown, w));

        const placed =
          transborda || colide
            ? { ...grown, ...placeNext(others, grown.w, grown.h, bounds) }
            : grown;

        return { ...prev, windows: others.concat(placed).sort((a, b) => a.z - b.z) };
      }),
    [setState],
  );

  const focusWindow = useCallback(
    (id: string) =>
      setState((prev) => {
        const target = prev.windows.find((w) => w.id === id);
        if (!target || target.z === prev.nextZ - 1) return prev;
        return {
          ...prev,
          windows: prev.windows.map((w) => (w.id === id ? { ...w, z: prev.nextZ } : w)),
          nextZ: prev.nextZ + 1,
        };
      }),
    [setState],
  );

  const clear = useCallback(() => setState(EMPTY), [setState]);

  const openMetricIds = useMemo(
    () => new Set(windows.filter((w) => METRIC_BY_ID.has(w.metricId)).map((w) => w.metricId)),
    [windows],
  );

  return { windows, openMetricIds, addMetric, removeWindow, moveWindow, resizeWindow, setChart, focusWindow, clear };
}
