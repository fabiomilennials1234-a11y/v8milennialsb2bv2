/**
 * Module leads — API pública.
 *
 * Tudo que outros módulos consomem deve estar exportado aqui.
 * Internals (subpastas, hooks privados, componentes de detalhe) são privados —
 * ESLint `boundaries` impede import direto de fora.
 *
 * Boundary enforcement: warn agora (slice 1), error em slice 17.
 * Pages (Leads/Duplicates/Trash) NÃO são exportadas daqui — App.tsx faz
 * deep-import via `@/modules/leads/pages/X` para preservar code-splitting.
 *
 * Ver `./CLAUDE.md` deste módulo para escopo, áreas frágeis e dedup pendente.
 */

// ── Hooks: lead CRUD + listing ─────────────────────────────────────────────
export {
  useLeads,
  useLeadsCount,
  useLeadById,
  useCreateLead,
  useUpdateLead,
  useDeleteLead,
  useDeleteAllLeadsInPipe,
  useDeleteAllLeads,
  useLeadAiStatus,
  useToggleLeadAI,
  usePhoneAiStatus,
  useToggleConversationAI,
  LEADS_PAGE_SIZE,
} from "./hooks/useLeads";
export type {
  Lead,
  LeadInsert,
  LeadUpdate,
  LeadsFilterParams,
  PipeTypeForDelete,
} from "./hooks/useLeads";

// ── Hooks: leads de UM funil (sistema ou custom) ───────────────────────────
// Recorte por funil com busca server-side. Consumido pelo seletor
// Funil → Lead da Agenda. Ver o cabeçalho do arquivo para por que a raiz da
// consulta é `leads` e não `pipeline_entries`.
export {
  useLeadsPorFunil,
  LEADS_POR_FUNIL_PAGE_SIZE,
} from "./hooks/useLeadsPorFunil";
export type {
  LeadDoFunil,
  // S6: a entrada no funil é o NEGÓCIO (1:1 por `uq_pipeline_entries_deal_id`).
  // O seletor da Agenda precisa do tipo para desempatar o caso ambíguo.
  EntradaDoFunil,
  LeadsPorFunilResult,
  UseLeadsPorFunilParams,
} from "./hooks/useLeadsPorFunil";

// ── Hooks: lead × pipelines (cross-pipe placement) ─────────────────────────
export {
  useLeadAllPipelines,
  useAddLeadToStandardPipe,
  useMoveLeadInStandardPipe,
  useRemoveLeadFromStandardPipe,
} from "./hooks/useLeadAllPipelines";
export type {
  StandardPipelineStatus,
  CustomPipelineStatus,
  PipelineStatus,
} from "./hooks/useLeadAllPipelines";

// ── Hooks: lead origins registry (fonte única de lista/label/cor) ──────────
export {
  useLeadOrigins,
  BUILTIN_LEAD_ORIGINS,
  FALLBACK_ORIGIN_COLOR,
} from "./hooks/useLeadOrigins";
export type { LeadOriginOption, UseLeadOriginsResult } from "./hooks/useLeadOrigins";

// ── Hooks: custom fields ───────────────────────────────────────────────────
export {
  useLeadCustomFields,
  useLeadCustomFieldValues,
  useCreateCustomField,
  useDeleteCustomField,
  useSaveCustomFieldValue,
} from "./hooks/useLeadCustomFields";
export type { CustomField, CustomFieldValue } from "./hooks/useLeadCustomFields";

// ── Hooks: products attached to lead ───────────────────────────────────────
export {
  useLeadProducts,
  useAddLeadProduct,
  useUpdateLeadProduct,
  useRemoveLeadProduct,
} from "./hooks/useLeadProducts";
export type { LeadProduct } from "./hooks/useLeadProducts";

// ── Hooks: qualification score ─────────────────────────────────────────────
export {
  useLeadScores,
  useLeadScore,
  useCalculateLeadScore,
  useCalculateBatchScores,
  useLeadScoresMap,
} from "./hooks/useLeadScore";
export type { LeadScore } from "./hooks/useLeadScore";

// ── Qualification tier: canonical value set + display config (labels/icons/
// cores). Fonte única do módulo leads; consumido cross-module pelos filtros de
// qualificação do Kanban (todos os pipes) e pelo Disparo. Boundaries error mode
// exige que a config de tier só saia daqui via barrel.
export { QUALIFICATION_TIER_CONFIG } from "./components/lead-detail/modal/qualification-config";
export { QUALIFICATION_TIERS } from "./components/lead-detail/modal/types";
export type { QualificationTier } from "./components/lead-detail/modal/types";

// ── Hooks: WhatsApp write-instance resolution ──────────────────────────────
export { useLeadWriteInstance } from "./hooks/useLeadWriteInstance";
export type { LeadWriteInstanceState } from "./hooks/useLeadWriteInstance";

// ── Hooks: timeline / history / field changelog (consolidados em slice 4) ──
// Antes da slice 4 estavam em 4 arquivos: useLeadHistory + useLeadTimeline +
// useFieldChangelog + useFieldChanges. Hoje vivem em useLeadTimeline.ts.
// FIELD_LABELS + getFieldLabel + formatFieldValue foram extraídos para
// `@/shared/format/lead-field-labels` (utilitário puro cross-module).
export {
  useLeadTimeline,
  useLeadTimelineCompact,
  useLeadHistory,
  useCreateLeadHistory,
  useFieldChangelog,
  FIELD_LABELS,
  getFieldLabel,
  formatFieldValue,
} from "./hooks/useLeadTimeline";
export type {
  TimelineSource,
  TimelinePeriod,
  TimelineFilters,
  TimelineEvent,
  TimelineMetrics,
  TimelinePage,
  LeadHistory,
  LeadHistoryInsert,
  FieldChange,
} from "./hooks/useLeadTimeline";

// ── Hooks: batched metrics ─────────────────────────────────────────────────
export { useBatchedLeadMetrics } from "./hooks/useBatchedLeadMetrics";
export type { LeadMetrics } from "./hooks/useBatchedLeadMetrics";

// ── Hooks: action logging ──────────────────────────────────────────────────
// Mudou de casa: `useLogLeadAction` virou `@/shared/hooks/useLogLeadAction`.
// Não depende de nada de `leads` (só supabase, analytics e identity) e é usado
// por 4 bounded contexts — morar aqui obrigava communication, engagement e
// pipelines a importarem o barril inteiro de leads só pra registrar uma ação,
// fechando ciclos entre módulos. Importe do caminho novo; não reexportamos
// daqui de propósito, pra não deixar duas portas pro mesmo hook.

// ── Hooks: Quick Blast (Disparo engine — reused by the pipelines Disparo wizard)
export { useQuickBlast, useQuickBlastPreview } from "./hooks/useQuickBlast";
export type { QuickBlastInput, QuickBlastResult, QuickBlastPreview } from "./hooks/useQuickBlast";

// ── Hooks: import (CSV/Excel + funnel/custom-pipeline) ─────────────────────
export {
  useImportLeads,
  parseExcelSheetNames,
  parseFileToRows,
  parseFilePreview,
  resolveSellerToId,
  resolveProductToId,
  resolveStageFromName,
  pickBestPhone,
  cleanEmail,
  KNOWN_LEAD_FIELDS,
} from "./hooks/useImportLeads";
export type {
  FilePreviewResult,
  ColumnMappingOption,
  EdgeFunctionReport,
  FunnelDestination,
  ImportLeadsToCustomPipelineOptions,
  ImportLeadsToFunnelOptions,
  ImportLeadsToPipelineOptions,
  ImportLeadsOnlyOptions,
  ImportFunnelResult,
} from "./hooks/useImportLeads";

// ── Recompra: ciclo médio de compra (lista de leads) ───────────────────────
export { useLeadsReorderCycle, computeReorderCycles } from "./hooks/useLeadsReorderCycle";
export type { LeadReorderCycleMap } from "./hooks/useLeadsReorderCycle";
export {
  calcularCicloDeRecompra,
  JANELA_DE_RECOMPRA_DIAS,
} from "./lib/reorder-cycle";
export type { CicloDeRecompra, EstadoDoCiclo } from "./lib/reorder-cycle";

// ── Hooks: export ──────────────────────────────────────────────────────────
export { useExportLeads, EXPORT_LEAD_HEADERS } from "./hooks/useExportLeads";
export type {
  ExportStageFilter,
  ExportLeadsOptions,
  UseExportLeadsResult,
} from "./hooks/useExportLeads";

// ── Hooks: duplicates / trash / new-leads ──────────────────────────────────
export { useDuplicateLeads, useMergeLeads } from "./hooks/useDuplicateLeads";
export type { DuplicateGroup } from "./hooks/useDuplicateLeads";
export {
  useTrashLeads,
  useRestoreLead,
  useRestoreLeadsBulk,
  usePurgeLead,
} from "./hooks/useTrashLeads";
export type { TrashLead } from "./hooks/useTrashLeads";
export { useNewLeads } from "./hooks/useNewLeads";
export type {
  NewLeadsBucket,
  NewLeadsSource,
  NewLeadsData,
} from "./hooks/useNewLeads";

// ── Hooks: lead-form helpers (subpasta `hooks/lead/`) ──────────────────────
// Compõem o Lead create/edit flow. Consumidos cross-module por algumas
// telas que reusam o form (Onboarding step, kanban quick-create, etc.).
export { useLeadCampaignsAttach } from "./hooks/lead/useLeadCampaignsAttach";
export { useLeadCreateHandler } from "./hooks/lead/useLeadCreateHandler";
export { useLeadForm } from "./hooks/lead/useLeadForm";
export { useLeadPipeHandlers } from "./hooks/lead/useLeadPipeHandlers";
export {
  useLeadTagsAttached,
  useAddLeadTag,
  useRemoveLeadTag,
} from "./hooks/lead/useLeadTagsAttached";
export type { AttachedLeadTag } from "./hooks/lead/useLeadTagsAttached";

// Org-scoped tag dictionary (CRUD). Consumed cross-module by the Disparo
// audience-conditions selector (tag filter) and any surface that needs the
// org's tag list outside a lead context.
export { useTags, useCreateTag, useUpdateTag, useDeleteTag } from "./hooks/useTags";
export type { Tag, TagInsert, TagUpdate } from "./hooks/useTags";

// ── Components: lead-detail (modal redesign — ADR-2026-05-17) ──────────────
// Sempre V2 desde a SCRUM-637 (V1 demolido; 108/108 orgs já migradas).
// LeadDetailSheet é alias de LeadDetailDialog para compat com call sites antigos.
export {
  LeadDetailDialog,
  LeadDetailSheet,
  LeadDetailDialogV2,
  LeadPanelProvider,
  useLeadSheet,
} from "./components/lead-detail";
export { LeadDetailMobileTabs } from "./components/lead-detail/modal/LeadDetailMobileTabs";

// ── Components: deal-detail (modal do negócio — decisão CTO 2026-07-29) ────
// O card do funil abre o NEGÓCIO; o modal do lead abre só na aba Leads.
export { DealDetailDialog } from "./components/deal-detail/DealDetailDialog";
export { DealPanelProvider } from "./components/deal-detail/DealPanelProvider";
export { useDealSheet } from "./components/deal-detail/deal-sheet-context";

// ── Components: os DOIS cards (ADR-0023 / ADR-0024) ────────────────────────
//
// São as duas únicas fichas do produto: `DealCardPanel` é a ficha da VENDA,
// `LeadCardPanel` é a ficha da PESSOA. Nunca ficam empilhados — o card do funil
// abre o Negócio, e clicar na pessoa dentro dele fecha esse e abre o Lead.
//
// Saem pelo barrel (SCRUM-124) porque agora são montados pelos 4 funis, que
// vivem no módulo `pipelines`. Enquanto só o pipe-whatsapp os montava, ele os
// alcançava por deep-import — o que o `boundaries/element-types` do ESLint
// proíbe entre módulos. Replicar aquele import em mais três páginas seria
// multiplicar a violação por quatro em vez de fechá-la.
export { DealCardPanel } from "./components/deal-card/DealCardPanel";
export { LeadCardPanel } from "./components/lead-card/LeadCardPanel";
// Slots de responsável/qualificação — reusados fora do modal (ex.: painel do chat).
export { ResponsibleSlot } from "./components/lead-detail/modal/header/ResponsibleSlot";
export { QualificationSlot } from "./components/lead-detail/modal/header/QualificationSlot";
// Gates de ação do lead — reusados fora do modal (ex.: card de funis no chat).
export { useLeadActionGates } from "./components/lead-detail/hooks/useLeadActionGates";
export type { LeadActionGates, Gate as LeadActionGate } from "./components/lead-detail/hooks/useLeadActionGates";

// ── Components: card / modal / score badge ─────────────────────────────────
export {
  LeadCard,
  ORIGIN_COLORS,
} from "./components/leads/LeadCard";
export type { LeadCardData, LeadCardVariant, LeadCardProps } from "./components/leads/LeadCard";
export { LeadModal } from "./components/leads/LeadModal";
export { LeadScoreBadge } from "./components/leads/LeadScoreBadge";
export { TimelineItem } from "./components/leads/TimelineItem";
export { CustomFieldsManager } from "./components/leads/CustomFieldsManager";
export { ExportLeadsContent } from "./components/leads/ExportLeadsModal";
export { ImportLeadsFunnelContent } from "./components/leads/ImportLeadsFunnelModal";
export { ImportLeadsContent, ImportLeadsModal } from "./components/leads/ImportLeadsModal";

// ── Components: lead form internals usadas cross-module ────────────────────
export { LeadDetailContent } from "./components/lead/LeadDetailContent";
export { LeadCustomFields } from "./components/lead/info/LeadCustomFields";
export { AddCustomFieldPopover } from "./components/lead/info/AddCustomFieldPopover";
export { LeadTabHistory } from "./components/lead/tabs/LeadTabHistory";

// ── PipeOpsPort: inversão de dependência leads↔pipelines (arch-deepening F7) ─
// leads define a abstração (DIP); pipelines implementa+injeta via context.
export type { PipeOpsPort, RescheduleModalSlotProps, MergedMeetingEditorSlotProps, FunnelOption, FunnelStageOption } from "./pipe-ops";
export { PipeOpsContextProvider, usePipeOps } from "./pipe-ops";

// CompareceuModal: apresentacional (só identity + onConfirm), movido de
// pipelines para leads na inversão F7. pipelines consome via este barrel.
export { CompareceuModal } from "./components/leads/funnel-contexts/modals/CompareceuModal";
