/**
 * A forma de uma janela do Estúdio — e só isso.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * `useMetricsStudio` (estado do painel) usa `useMetricsStudioPanel`
 * (persistência), e a persistência precisava do tipo da janela, que morava no
 * primeiro. Import de valor numa direção, import de TIPO na volta — e o
 * `dependency-cruiser` reprova o ciclo do mesmo jeito, porque ele lê o grafo de
 * módulos, não o que sobra depois que o TypeScript apaga os tipos.
 *
 * Foi o que derrubou o `Lint & Build` do PR #1497:
 *
 *     [no-circular] useMetricsStudio.ts -> useMetricsStudioPanel.ts
 *
 * E como os outros seis jobs do `test.yml` declaram `needs: [quality]`, o ciclo
 * não reprovava só um gate: escondia os outros seis, e com eles os cinco PRs
 * empilhados em cima desta branch.
 *
 * A saída não é afrouxar a regra — é o tipo não pertencer a nenhum dos dois
 * lados. Aqui ele não importa ninguém, então não pode fechar ciclo com ninguém.
 */
import type { ChartKind } from "@/modules/analytics/lib/metrics-studio-catalog";
import type { MetricRecorte } from "@/modules/analytics/lib/metrics-studio-engine-map";

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
  /**
   * Card SOB MEDIDA, quando presente — é o discriminante.
   *
   * Nem tudo que os painéis mostram cabe no motor de métricas. Funil
   * trapezoidal, pódio de ranking e jornada do lead são componentes próprios,
   * com visual e interação que nenhuma combinação de `metricId` + `chart`
   * reproduz. Sem este campo, trazer os dashboards de Comando para o Estúdio
   * custaria perder essas telas.
   *
   * Quando preenchido, o canvas resolve pelo registry
   * (`metrics-studio-fixed-cards`) e IGNORA `metricId`, `corte` e `chart` —
   * eles continuam no tipo só porque tornar o `StudioWindow` uma união
   * discriminada obrigaria a mexer em todos os consumidores que hoje leem
   * `win.metricId` direto. O ganho de tipo não pagaria o raio da mudança.
   *
   * Card fixo é MOVÍVEL e REMOVÍVEL como qualquer outro — o que ele não é, é
   * configurável por gráfico ou corte.
   */
  fixo?: string;
}

/** Discriminante do card sob medida. Ver a nota em `StudioWindow.fixo`. */
export function isFixedWindow(win: StudioWindow): boolean {
  return typeof win.fixo === "string" && win.fixo.length > 0;
}
