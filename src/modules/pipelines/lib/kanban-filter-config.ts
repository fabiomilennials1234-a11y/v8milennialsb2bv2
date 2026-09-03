/**
 * kanban-filter-config — a FORMA de um filtro do painel do kanban, separada do
 * componente que a desenha.
 *
 * Mora em `lib/` de propósito. Quando este tipo vivia em
 * `components/kanban/KanbanFilterPanel.tsx`, o hook `useFunilFilters` precisava
 * importar de um COMPONENTE só para se tipar — dependência invertida, e a
 * aresta que fez o dep-cruiser acusar ciclo (`hooks/model` → `components/kanban`
 * → `@/modules/leads` → … → `@/modules/pipelines` → `hooks/model`).
 *
 * Aqui não há React nem import cross-module: quem monta a config e quem a
 * renderiza dependem do mesmo tipo neutro, não um do outro.
 */
import type React from "react";
import { getDateRange, type MetricsPeriodState } from "@/lib/metrics-period";
import { STALLED_ALL } from "@/modules/pipelines/lib/stalled-buckets";

// ─── Section types ───────────────────────────────────────────────────────────
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

// ─── Helper: count active filters from sections ──────────────────────────────
export function countActiveFilters(sections: FilterSectionConfig[]): number {
  let count = 0;
  for (const section of sections) {
    switch (section.type) {
      case "responsible":
      case "origin-single":
      case "product-type":
      case "calor":
      case "priority":
      case "urgency":
        if (section.value !== "all") count++;
        break;
      case "origin-multi":
      case "tags":
      case "status-multi":
      case "qualification-tier":
      case "pre-qualification-tier":
        if (section.value.length > 0) count++;
        break;
      case "scheduled":
        if (section.value) count++;
        break;
      case "created-period":
        // "Geral" e uma seleção pela metade (só a data inicial) não filtram
        // nada — getDateRange devolve null nos dois casos, então contar aqui
        // acenderia o badge sem nenhum card sair da tela.
        if (getDateRange(section.value)) count++;
        break;
      case "stalled-days":
        if (section.value && section.value !== STALLED_ALL) count++;
        break;
      case "single-choice":
        if (section.value !== (section.allValue ?? "all")) count++;
        break;
    }
  }
  return count;
}
