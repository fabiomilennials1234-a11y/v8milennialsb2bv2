/**
 * `FilterSectionConfig` — o vocabulário de filtro do funil.
 *
 * 🔴 **Por que este tipo mora em `lib/` e não no componente.** Ele nasceu dentro
 * de `components/kanban/KanbanFilterPanel.tsx`, e `hooks/model/useFunilFilters`
 * o importava de lá — uma camada de MODELO dependendo da camada de
 * APRESENTAÇÃO. O `dep-cruise` acusou o ciclo
 * (`hooks/model/index` → `useFunilFilters` → `KanbanFilterPanel`), e com razão:
 * o import era `import type`, some no runtime, mas a seta apontava para o lado
 * errado de verdade — quem descreve os filtros é o modelo, e o painel é só uma
 * das formas de desenhá-los.
 *
 * Aqui a direção fica certa: `lib/` não conhece ninguém, o hook e o componente
 * conhecem `lib/`. O painel **re-exporta** o tipo para as páginas que já o
 * importavam de lá continuarem funcionando sem mudança.
 */

import type React from "react";
import type { MetricsPeriodState } from "@/lib/metrics-period";

export type FilterSectionConfig =
  | { type: "responsible"; value: string; onChange: (v: string) => void; members: { id: string; name: string }[] }
  | { type: "origin-single"; value: string; onChange: (v: string) => void }
  | { type: "origin-multi"; value: string[]; onChange: (v: string[]) => void }
  | { type: "tags"; value: string[]; onChange: (v: string[]) => void; tags: { id: string; name: string; color: string | null }[] }
  | { type: "product-type"; value: string; onChange: (v: string) => void }
  | { type: "calor"; value: string; onChange: (v: string) => void }
  | { type: "priority"; value: string; onChange: (v: string) => void }
  | { type: "urgency"; value: string; onChange: (v: string) => void }
  | { type: "status-multi"; value: string[]; onChange: (v: string[]) => void; options: { id: string; title: string; color: string }[] }
  | { type: "qualification-tier"; value: string[]; onChange: (v: string[]) => void }
  | { type: "pre-qualification-tier"; value: string[]; onChange: (v: string[]) => void }
  | { type: "scheduled"; value: boolean; onChange: (v: boolean) => void }
  /** Data de criação do lead. Voltou do cabeçalho pro painel — é aqui que compõe com o resto. */
  | { type: "created-period"; value: MetricsPeriodState; onChange: (v: MetricsPeriodState) => void }
  /** Dias na etapa atual — "quem está encalhado?". Ver `lib/stalled-buckets`. */
  | { type: "stalled-days"; value: string; onChange: (v: string) => void }
  /**
   * Escolha única genérica, pra dimensão que só um funil tem — a faixa de tempo
   * da reunião em Confirmação é o primeiro caso. Existe pra esse tipo de filtro
   * ter casa no painel em vez de virar mais uma fileira de botões no cabeçalho,
   * que é justamente o que o Modelo 1 veio desfazer. `allValue` é o valor que
   * significa "sem filtro" (não conta no badge nem vira chip).
   */
  | {
      type: "single-choice";
      id: string;
      label: string;
      value: string;
      onChange: (v: string) => void;
      options: { value: string; label: string }[];
      allValue?: string;
      icon?: React.ElementType;
    };
