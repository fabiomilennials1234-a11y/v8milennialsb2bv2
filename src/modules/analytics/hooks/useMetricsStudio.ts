import { useCallback, useMemo } from "react";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import type { ChartKind } from "@/modules/analytics/lib/metrics-studio-catalog";
import {
  ENGINE_BY_ID,
  ehEscalar,
  type EngineMetric,
  type MetricRecorte,
} from "@/modules/analytics/lib/metrics-studio-engine-map";

/** Passo do grid do canvas — todo drag/resize encaixa nele. */
export const GRID = 8;

export const MIN_W = 220;
// 120 = header (44) + valor (54) + rodapé de controles (34), sem folga morta.
export const MIN_H = 120;

export interface StudioWindow {
  /** Instância, não métrica: a mesma métrica pode abrir duas janelas. */
  id: string;
  metricId: string;
  /** G2 do grill: o corte é escolha do usuário, não atributo da métrica. */
  corte: MetricRecorte;
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

/**
 * Desenhos que fazem sentido para um corte. G3 tirou a vela — o motor não tem
 * OHLC. O resto cai do formato do dado, não de preferência:
 *
 *   escalar  → o motor devolve um número e `series: null`. Só cabe número.
 *   por dia  → série cronológica. Linha.
 *   demais   → série categórica (origem, vendedor, etapa…). Pizza.
 *
 * Número sempre sobra como alternativa: a soma da série é informação legítima.
 */
export function graficosPara(metric: EngineMetric, corte: MetricRecorte): ChartKind[] {
  if (ehEscalar(metric, corte)) return ["number"];
  if (corte === "tempo") return ["line", "number"];
  return ["pie", "number"];
}

/** Tamanho inicial por desenho. Número não tem corpo — altura justa. */
function initialSize(chart: ChartKind): { w: number; h: number } {
  if (chart === "pie") return { w: 360, h: 300 };
  if (chart === "line") return { w: 440, h: 260 };
  return { w: 280, h: 132 };
}

const GAP = 16;

function overlaps(a: { x: number; y: number; w: number; h: number }, b: StudioWindow) {
  return a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y;
}

/**
 * Altura VIRTUAL de varredura. O painel é uma região da página, não o viewport:
 * cabem ~2 fileiras de janela na área visível. Sem isto, a quarta métrica não
 * acha slot e cai no cascateamento — janelas empilhadas por cima umas das
 * outras. Com isto, ela desce para fora da dobra e o canvas rola.
 */
const SCAN_HEIGHT = 2400;

/**
 * Acha o primeiro slot livre numa varredura em coluna, para que a métrica nova
 * não caia em cima da anterior. Cai no cascateamento só quando nem a área
 * rolável comporta — cenário que exige dezenas de janelas.
 */
function placeNext(windows: StudioWindow[], w: number, h: number, bounds: { width: number; height: number }) {
  const maxX = Math.max(GAP, bounds.width - w - GAP);
  const maxY = Math.max(GAP, Math.max(bounds.height, SCAN_HEIGHT) - h - GAP);

  for (let y = GAP; y <= maxY; y += GRID * 4) {
    for (let x = GAP; x <= maxX; x += GRID * 4) {
      if (!windows.some((win) => overlaps({ x, y, w, h }, win))) return { x, y };
    }
  }

  const offset = (windows.length % 8) * 28;
  return { x: GAP + offset, y: GAP + offset };
}

type Bounds = { width: number; height: number };

/**
 * Reposiciona só quando o retângulo NOVO de fato colide ou transborda —
 * sobreposição que o próprio usuário criou arrastando fica de pé.
 */
function acomodar(
  alvo: StudioWindow,
  crescido: StudioWindow,
  outras: StudioWindow[],
  bounds: Bounds,
): StudioWindow {
  const transborda = bounds.width > 0 && crescido.x + crescido.w > bounds.width - GAP;
  const cresceu = crescido.w > alvo.w || crescido.h > alvo.h;
  const colide = cresceu && outras.some((w) => overlaps(crescido, w));
  return transborda || colide
    ? { ...crescido, ...placeNext(outras, crescido.w, crescido.h, bounds) }
    : crescido;
}

export interface MetricsStudioApi {
  windows: StudioWindow[];
  openMetricIds: Set<string>;
  addMetric: (metric: EngineMetric, bounds: Bounds) => void;
  removeWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, w: number, h: number) => void;
  setChart: (id: string, chart: ChartKind, bounds: Bounds) => void;
  setCorte: (id: string, corte: MetricRecorte, bounds: Bounds) => void;
  focusWindow: (id: string) => void;
  clear: () => void;
}

export function useMetricsStudio(): MetricsStudioApi {
  const [state, setState] = usePersistedState<StudioState>("metrics-studio", EMPTY, {
    ttlMs: THIRTY_DAYS,
  });

  const windows = state.windows ?? EMPTY.windows;

  const addMetric = useCallback(
    (metric: EngineMetric, bounds: Bounds) => {
      setState((prev) => {
        const corte = metric.cortes[0];
        const chart = graficosPara(metric, corte)[0];
        const { w, h } = initialSize(chart);
        const { x, y } = placeNext(prev.windows, w, h, bounds);
        const seq = prev.seq + 1;
        return {
          windows: [
            ...prev.windows,
            { id: `${metric.id}-${seq}`, metricId: metric.id, corte, x, y, w, h, chart, z: prev.nextZ },
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
    (id: string, chart: ChartKind, bounds: Bounds) =>
      setState((prev) => {
        const alvo = prev.windows.find((w) => w.id === id);
        if (!alvo) return prev;
        const min = initialSize(chart);
        const outras = prev.windows.filter((w) => w.id !== id);
        const crescido = { ...alvo, chart, w: Math.max(alvo.w, min.w), h: Math.max(alvo.h, min.h) };
        return {
          ...prev,
          windows: outras.concat(acomodar(alvo, crescido, outras, bounds)).sort((a, b) => a.z - b.z),
        };
      }),
    [setState],
  );

  const setCorte = useCallback(
    (id: string, corte: MetricRecorte, bounds: Bounds) =>
      setState((prev) => {
        const alvo = prev.windows.find((w) => w.id === id);
        const metric = alvo && ENGINE_BY_ID.get(alvo.metricId);
        if (!alvo || !metric) return prev;

        // Trocar o corte muda o formato do dado: "por dia" vira série
        // cronológica, "Total" vira escalar. O desenho atual pode deixar de
        // existir — nesse caso cai no primeiro válido em vez de renderizar
        // gráfico sem fonte.
        const permitidos = graficosPara(metric, corte);
        const chart = permitidos.includes(alvo.chart) ? alvo.chart : permitidos[0];
        const min = initialSize(chart);
        const outras = prev.windows.filter((w) => w.id !== id);
        const crescido = { ...alvo, corte, chart, w: Math.max(alvo.w, min.w), h: Math.max(alvo.h, min.h) };
        return {
          ...prev,
          windows: outras.concat(acomodar(alvo, crescido, outras, bounds)).sort((a, b) => a.z - b.z),
        };
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
    () => new Set(windows.filter((w) => ENGINE_BY_ID.has(w.metricId)).map((w) => w.metricId)),
    [windows],
  );

  return {
    windows,
    openMetricIds,
    addMetric,
    removeWindow,
    moveWindow,
    resizeWindow,
    setChart,
    setCorte,
    focusWindow,
    clear,
  };
}
