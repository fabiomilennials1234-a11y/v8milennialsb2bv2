import type { LeadListFilterValues } from './lead-list-filters';

type ExportFormat = "csv" | "xlsx";

/**
 * Filtro por etapa do Kanban: limita a exportação aos leads que estejam na
 * etapa indicada do funil especificado.
 *
 * SCRUM-635/637: o MOTOR é único — (pipeline_id, etapa) resolve direto em
 * `pipeline_entries` (fonte única pós-W3). Os braços legados por slug
 * ("whatsapp"/"confirmacao"/"propostas") e "custom" morreram no flip da 637
 * junto com as páginas que os alimentavam — este é o único formato.
 */
export interface ExportStageFilter {
  /** `pipelines.id` — endereça QUALQUER funil (sistema ou custom). */
  pipelineId: string;
  /** uuid de `pipeline_stages` (canônico) ou stage_key. */
  stageId: string;
}

/** Filtros ativos da lista de leads (busca, origem, qualificação, UF).
 * Mesma semântica de `applyLeadListFilters` — reaproveita a fonte única. */
export type ExportListFilters = LeadListFilterValues;

export interface ExportLeadsOptions {
  format: ExportFormat;
  /** Contexto do kanban inteiro; consumido apenas pelo rollout Ventimais. */
  pipelineId?: string;
  /** Limite de leads (os mais recentes). Se não informado, exporta até 10.000. */
  limit?: number;
  /** Quando presente, restringe a exportação aos leads da etapa indicada. */
  stageFilter?: ExportStageFilter;
  /** Título legível da etapa — usado apenas para compor o nome do arquivo. */
  stageTitle?: string;
  /** Filtros ativos da lista — aplicados à exportação para espelhar o que o
   * usuário vê na tela (busca, origem, qualificação, UF). */
  listFilters?: ExportListFilters;
  /**
   * Restringe a exportação a um conjunto EXPLÍCITO de leads — a seleção
   * manual do bulk (SCRUM-633). Compõe por interseção com stageFilter e
   * listFilters quando presentes. Lista vazia exporta nada.
   */
  leadIds?: string[];
}

