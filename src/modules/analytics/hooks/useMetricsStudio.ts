import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMetricsStudioPanel } from "./useMetricsStudioPanel";
import type { StudioWindow } from "@/modules/analytics/lib/metrics-studio-window";
import type { ChartKind } from "@/modules/analytics/lib/metrics-studio-catalog";
import {
  ehEscalar,
  type EngineMetric,
  type MetricRecorte,
} from "@/modules/analytics/lib/metrics-studio-engine-map";

/** Passo do grid do canvas — todo drag/resize encaixa nele. */
export const GRID = 8;

export const MIN_W = 220;
// 120 = header (44) + valor (54) + rodapé de controles (34), sem folga morta.
export const MIN_H = 120;

// O tipo mora em `lib/metrics-studio-window` porque `useMetricsStudioPanel`
// também precisa dele, e importá-lo daqui fechava ciclo de módulos (ver o
// cabeçalho daquele arquivo). Re-exportado para os consumidores que já o pegam
// deste hook — MetricsCanvas, MetricWindow e useMetricsStudioReport seguem
// intactos.
export type { StudioWindow };

interface StudioState {
  windows: StudioWindow[];
  nextZ: number;
  seq: number;
  /**
   * DE QUAL ORG estas janelas vieram — `undefined` = ainda não hidratou.
   *
   * 🚨 MORA NO ESTADO, não num `useRef`, e a diferença é a causa do incidente.
   * Com a marca num ref, o efeito de gravação lia "já hidratei" NO MESMO COMMIT
   * em que a hidratação chamou `setState` — e `windows` ainda era o `[]`
   * inicial, porque o re-render não aconteceu. Resultado: **toda montagem do
   * Estúdio agendava um `save([])`**, que só não chegava ao banco porque o
   * `save` seguinte (já com o layout real) reiniciava o debounce de 800 ms.
   * Bastava a org trocar nessa fresta para o `[]` ser descarregado — foi assim
   * que o painel da org Milennials foi zerado em 26/08/2026.
   *
   * No estado, marca e janelas andam juntas: não existe commit em que uma
   * valha e a outra não.
   */
  org: string | null | undefined;
}

const EMPTY: StudioState = { windows: [], nextZ: 1, seq: 0, org: undefined };

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

/**
 * `byId` vem de fora (`useStudioCatalog`) e não de um `Map` estático: desde a
 * fatia 10 o catálogo inclui as métricas personalizadas da organização, que
 * chegam do banco. Resolver janela por mapa de import deixaria toda janela
 * personalizada órfã depois de recarregar a página.
 */
export function useMetricsStudio(
  byId: Map<string, EngineMetric>,
  /**
   * Aba ativa. `null` enquanto a lista de abas não resolveu — e aí o hook fica
   * inerte de propósito: hidratar com `[]` faria o efeito de gravação enxergar
   * "mudou de conteúdo para vazio" e agendar um `save([])`, apagando a aba.
   */
  panelId: string | null,
): MetricsStudioApi {
  // SCRUM-309: o painel vive no servidor. O estado local é a cópia de
  // trabalho — arrastar produz dezenas de mudanças por segundo e nenhuma delas
  // deve virar requisição.
  const persistencia = useMetricsStudioPanel(panelId);
  const [state, setState] = useState<StudioState>(EMPTY);

  // Guarda a referência do último layout que veio do servidor ou foi mandado
  // para ele. Serve para o efeito de gravação saber o que NÃO precisa salvar.
  const ultimoSincronizado = useRef<StudioWindow[] | null>(null);

  /**
   * Hidrata o painel DA ORG ATUAL — e reidrata quando a org muda.
   *
   * 🚨 `useOrgSwitcher` troca de organização com `invalidateQueries()` e **não
   * recarrega a página**. Enquanto isto era "hidrata uma vez e pronto", o
   * painel da org nova era buscado do banco e NUNCA aplicado: a tela seguia
   * mostrando as janelas da org anterior, e a primeira mexida gravava aquele
   * layout na org errada.
   *
   * `nextZ` e `seq` saem do layout salvo para que janela nova continue nascendo
   * por cima e o id não colida com o que já existe.
   */
  const orgAtual = persistencia.organizationId;
  useEffect(() => {
    if (state.org === orgAtual) return;

    // Trocou de org: a cópia de trabalho da anterior não vale mais. Zerar ANTES
    // de o painel novo chegar é deliberado — deixar as janelas da org velha na
    // tela convida o usuário a editar o painel errado, que é exatamente o
    // acidente que este hook passou a impedir.
    if (state.org !== undefined) {
      ultimoSincronizado.current = null;
      setState(EMPTY);
      return;
    }

    if (!orgAtual || persistencia.isLoading || persistencia.layout === null) return;

    const windows = persistencia.layout;
    ultimoSincronizado.current = windows;
    setState({
      windows,
      nextZ: windows.reduce((max, w) => Math.max(max, w.z), 0) + 1,
      seq: windows.length,
      org: orgAtual,
    });
  }, [orgAtual, persistencia.isLoading, persistencia.layout, state.org]);

  const windows = state.windows ?? EMPTY.windows;

  // A gravação é EFEITO, não parte do updater. Chamar `save()` de dentro de um
  // updater de estado seria efeito colateral em função que o StrictMode executa
  // duas vezes — o mesmo defeito já corrigido no arrasto da janela.
  const { save } = persistencia;
  useEffect(() => {
    // 🚨 A GUARDA QUE FALTAVA: só grava janelas que foram hidratadas DESTA org.
    // `state.org` vem do ESTADO, então esta condição só é verdadeira num commit
    // em que `windows` já é o layout hidratado — nunca no commit da hidratação,
    // quando `windows` ainda era o `[]` inicial. Era ali que nascia o `save([])`
    // fantasma de toda montagem.
    if (state.org === undefined || state.org !== orgAtual) return;
    if (windows === ultimoSincronizado.current) return; // hidratação, não mudança
    ultimoSincronizado.current = windows;
    save(windows);
  }, [windows, save, orgAtual, state.org]);

  const mutar = useCallback((fn: (prev: StudioState) => StudioState) => setState(fn), []);

  const addMetric = useCallback(
    (metric: EngineMetric, bounds: Bounds) => {
      mutar((prev) => {
        const corte = metric.cortes[0];
        const chart = graficosPara(metric, corte)[0];
        const { w, h } = initialSize(chart);
        const { x, y } = placeNext(prev.windows, w, h, bounds);
        const seq = prev.seq + 1;
        return {
          ...prev,
          windows: [
            ...prev.windows,
            { id: `${metric.id}-${seq}`, metricId: metric.id, corte, x, y, w, h, chart, z: prev.nextZ },
          ],
          nextZ: prev.nextZ + 1,
          seq,
        };
      });
    },
    [mutar],
  );

  const removeWindow = useCallback(
    (id: string) => mutar((prev) => ({ ...prev, windows: prev.windows.filter((w) => w.id !== id) })),
    [mutar],
  );

  const moveWindow = useCallback(
    (id: string, x: number, y: number) =>
      mutar((prev) => ({
        ...prev,
        windows: prev.windows.map((w) => (w.id === id ? { ...w, x, y } : w)),
      })),
    [mutar],
  );

  const resizeWindow = useCallback(
    (id: string, w: number, h: number) =>
      mutar((prev) => ({
        ...prev,
        windows: prev.windows.map((win) => (win.id === id ? { ...win, w, h } : win)),
      })),
    [mutar],
  );

  const setChart = useCallback(
    (id: string, chart: ChartKind, bounds: Bounds) =>
      mutar((prev) => {
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
    [mutar],
  );

  const setCorte = useCallback(
    (id: string, corte: MetricRecorte, bounds: Bounds) =>
      mutar((prev) => {
        const alvo = prev.windows.find((w) => w.id === id);
        const metric = alvo && byId.get(alvo.metricId);
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
    [mutar, byId],
  );

  // Ordem-z é estado de UI, mas persiste junto: reabrir o painel com as
  // janelas em ordem diferente da que se deixou seria desorientador.
  const focusWindow = useCallback(
    (id: string) =>
      mutar((prev) => {
        const target = prev.windows.find((w) => w.id === id);
        if (!target || target.z === prev.nextZ - 1) return prev;
        return {
          ...prev,
          windows: prev.windows.map((w) => (w.id === id ? { ...w, z: prev.nextZ } : w)),
          nextZ: prev.nextZ + 1,
        };
      }),
    [mutar],
  );

  // Preserva `org`: esvaziar o painel é uma MUDANÇA que precisa ser gravada.
  // Cair para `EMPTY` cru zeraria a marca de hidratação e a guarda de gravação
  // engoliria o "Limpar" em silêncio — o painel voltaria no próximo refresh.
  const clear = useCallback(() => mutar((prev) => ({ ...EMPTY, org: prev.org })), [mutar]);

  const openMetricIds = useMemo(
    () => new Set(windows.filter((w) => byId.has(w.metricId)).map((w) => w.metricId)),
    [windows, byId],
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
