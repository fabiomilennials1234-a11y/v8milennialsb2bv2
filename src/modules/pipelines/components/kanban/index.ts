/**
 * Sub-barrel — componentes **kanban** (drag-drop, list, table, filtros).
 *
 * Reexportado pela API pública (`../../index.ts`) com os mesmos nomes/aliases.
 * Exports nomeados explícitos (não `export *`) para preservar os aliases
 * públicos (`KanbanCardLead`/`KanbanCardLeadTag`) e evitar vazar símbolos
 * internos (`FilterChips`, etc.) na superfície pública.
 */
export { CreateOpportunityModal } from "./CreateOpportunityModal";
export { DraggableKanbanBoard } from "./DraggableKanbanBoard";
export type { DraggableItem, KanbanColumn } from "./DraggableKanbanBoard";
export { ExportStageDialog } from "./ExportStageDialog";
export { KanbanBoard } from "./KanbanBoard";
export { KanbanCard } from "./KanbanCard";
export type { Lead as KanbanCardLead, LeadTag as KanbanCardLeadTag } from "./KanbanCard";
export {
  KanbanFilterPanel,
  originLabels,
  ALL_ORIGIN_OPTIONS,
  countActiveFilters,
} from "./KanbanFilterPanel";
export type {
  FilterSectionConfig,
  KanbanFilterPanelProps,
} from "./KanbanFilterPanel";
export { PipelineListView } from "./PipelineListView";
export type { PipelineListViewProps } from "./PipelineListView";
export { StageWorkflowsBadge } from "./StageWorkflowsBadge";
export { StageWorkflowsBadgeWrapper } from "./StageWorkflowsBadgeWrapper";
