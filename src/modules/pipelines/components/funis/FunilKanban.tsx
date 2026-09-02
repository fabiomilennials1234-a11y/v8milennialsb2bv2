import { useMemo, useState } from "react";
import { DraggableKanbanBoard, type KanbanColumn } from "@/modules/pipelines/components/kanban/DraggableKanbanBoard";
import { ExportStageDialog } from "@/modules/pipelines/components/kanban/ExportStageDialog";
import { LeadCard, type LeadCardData } from "@/modules/leads";
import { StageWorkflowsBadge } from "@/modules/pipelines/components/kanban/StageWorkflowsBadge";
import { useCustomPipeStageWorkflows, useCustomPipeWorkflowCounts } from "@/modules/workflows/hooks/useStageWorkflows";
import type { StageData } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";
import { useCanDo } from "@/modules/identity";
import { useUpdateLead } from "@/modules/leads";
import { useBulkSelection } from "@/shared/hooks/useBulkSelection";
import { BulkActionBar } from "@/modules/leads/components/bulk-actions/BulkActionBar";
import { useCreateAcaoDoDia } from "@/modules/engagement/hooks/useAcoesDoDia";
import type { CustomPipelineStage } from "@/contracts/pipe";

/**
 * Card de funil na página unificada — o shape que `get_pipeline_page` devolve,
 * já achatado por `flattenMetadata` (o mesmo dos boards de sistema).
 */
export interface FunilEntry {
  id: string;
  lead_id: string | null;
  stage_key: string;
  notes: string | null;
  created_at: string;
  lead?: {
    id: string;
    name: string | null;
    company: string | null;
    phone: string | null;
    email: string | null;
    rating: number | null;
    origin?: string | null;
    urgency?: string | null;
    faturamento?: string | null;
    avatar_url?: string | null;
    pre_qualification_tier?: string | null;
    qualification_tier?: string | null;
    responsible?: { name?: string | null; avatar_url?: string | null } | null;
    sdr?: { name?: string | null } | null;
    closer?: { name?: string | null } | null;
    lead_tags?: Array<{ tag?: { name?: string; color?: string | null } | null }>;
  } | null;
}

interface FunilKanbanProps {
  pipelineId: string;
  stages: CustomPipelineStage[];
  /** Dados paginados por `stage_key` (usePaginatedFunil). */
  stageData: Record<string, StageData>;
  onMove: (entryId: string, stage: CustomPipelineStage) => void;
  onRemoveEntry?: (entryId: string) => void;
  onClickEntry?: (entry: FunilEntry) => void;
}

function FunilStageBadge({
  pipelineId,
  stageKey,
  stageName,
  counts,
}: {
  pipelineId: string;
  stageKey: string;
  stageName: string;
  counts?: { total: number; active: number };
}) {
  const { data: workflows } = useCustomPipeStageWorkflows(pipelineId, stageKey);

  return (
    <StageWorkflowsBadge
      total={counts?.total ?? 0}
      active={counts?.active ?? 0}
      workflows={workflows}
      pipelineId={pipelineId}
      stageKey={stageKey}
      stageName={stageName}
    />
  );
}

/**
 * Board da página unificada `/funil/:slug` (SCRUM-632).
 *
 * Fork PAGINADO de `CustomPipelineKanban`: preserva a identidade visual do
 * kanban atual (DraggableKanbanBoard + LeadCard, mesmos tokens) e troca só a
 * fonte de dados — colunas alimentadas por `usePaginatedFunil`, com
 * `hasMore/onLoadMore` por coluna (mata o truncamento de 1.000 do board
 * custom). Na SCRUM-637 o board legado morre e este vira o único.
 *
 * Slots estruturados p/ 633/634 (paridade de sistema): filtros ricos entram
 * pela página (server-side, `PaginatedFilters`); saved views/bulk avançado/
 * métricas de funil se penduram aqui sem tocar na composição das colunas.
 */
export function FunilKanban({
  pipelineId,
  stages,
  stageData,
  onMove,
  onRemoveEntry,
  onClickEntry,
}: FunilKanbanProps) {
  const updateLead = useUpdateLead();
  const createAcaoDoDia = useCreateAcaoDoDia();
  const { allowed: canMovePipe } = useCanDo("move_pipe_record");
  // Workflows pendurados no funil: para custom o trigger_config guarda o
  // pipeline_id + stage_key — a MESMA chave serve aqui. Funil de sistema não
  // guarda por pipeline_id (slot 633/634); a query volta vazia e o badge fica 0.
  const { data: workflowCounts = {} } = useCustomPipeWorkflowCounts(pipelineId);
  const [stageToExport, setStageToExport] = useState<{ id: string; title: string; count: number } | null>(null);
  const bulk = useBulkSelection();

  // Ordered lead ids (shift-select em range) — só o que está CARREGADO.
  const allLeadIds = useMemo(
    () =>
      stages.flatMap((s) =>
        ((stageData[s.stage_key]?.items ?? []) as FunilEntry[])
          .filter((e) => e.lead_id)
          .map((e) => e.lead_id as string),
      ),
    [stages, stageData],
  );

  const transformToCard = (entry: FunilEntry): LeadCardData => {
    const lead = entry.lead;
    const responsibleName = lead?.responsible?.name || lead?.closer?.name || lead?.sdr?.name || null;
    return {
      id: entry.id,
      name: lead?.name || "Sem nome",
      company: lead?.company || null,
      phone: lead?.phone || null,
      email: lead?.email || null,
      rating: lead?.rating || 0,
      origin: lead?.origin ?? undefined,
      urgency: lead?.urgency || null,
      faturamento: lead?.faturamento ?? null,
      responsible: responsibleName,
      preSaleResponsible: responsibleName
        ? { name: responsibleName, avatar_url: lead?.responsible?.avatar_url ?? null }
        : null,
      avatarUrl: lead?.avatar_url || null,
      // O RPC devolve o tier como texto livre; o card espera o enum — a RLS do
      // banco já garante o domínio (CHECK), então o cast é seguro.
      preQualTier: (lead?.pre_qualification_tier || null) as LeadCardData["preQualTier"],
      qualTier: (lead?.qualification_tier || null) as LeadCardData["qualTier"],
      tags: (lead?.lead_tags ?? [])
        .map((lt) => ({ name: lt.tag?.name ?? "", color: lt.tag?.color || "#888" }))
        .filter((t) => t.name),
      createdAt: entry.created_at,
      notes: entry.notes,
      leadId: entry.lead_id ?? undefined,
    };
  };

  const columns: KanbanColumn<LeadCardData>[] = useMemo(
    () =>
      stages.map((stage) => {
        const slot = stageData[stage.stage_key];
        const items = ((slot?.items ?? []) as FunilEntry[]).map(transformToCard);
        return {
          // Coluna endereçada por stage_key — a chave que `get_pipeline_page`
          // pagina e que o espelho do banco mantém para as duas famílias.
          id: stage.stage_key,
          title: stage.name,
          color: stage.color || "#64748b",
          items,
          totalCount: slot?.totalCount ?? items.length,
          hasMore: slot?.hasMore ?? false,
          isFetchingMore: slot?.isFetchingMore ?? false,
          onLoadMore: slot?.fetchMore,
        };
      }),
    [stages, stageData],
  );

  const findEntry = (entryId: string): FunilEntry | undefined => {
    for (const s of stages) {
      const hit = ((stageData[s.stage_key]?.items ?? []) as FunilEntry[]).find((e) => e.id === entryId);
      if (hit) return hit;
    }
    return undefined;
  };

  return (
    <>
      <DraggableKanbanBoard<LeadCardData>
        columns={columns}
        onStatusChange={(itemId, newStageKey) => {
          const stage = stages.find((s) => s.stage_key === newStageKey);
          if (stage) onMove(itemId, stage);
        }}
        disabled={!canMovePipe}
        onExportStage={(stageKey, stageTitle) => {
          const col = columns.find((c) => c.id === stageKey);
          setStageToExport({ id: stageKey, title: stageTitle, count: col?.items.length ?? 0 });
        }}
        renderColumnExtra={(col) => {
          const allCounts = workflowCounts["__all__"] || { total: 0, active: 0 };
          const stageCounts = workflowCounts[col.id] || { total: 0, active: 0 };
          const merged = {
            total: stageCounts.total + allCounts.total,
            active: stageCounts.active + allCounts.active,
          };
          return (
            <FunilStageBadge
              pipelineId={pipelineId}
              stageKey={col.id}
              stageName={col.title}
              counts={merged}
            />
          );
        }}
        renderCard={(card) => (
          <LeadCard
            lead={card}
            variant="custom"
            density="compact"
            showValue
            selected={bulk.isSelected(card.leadId || "")}
            onSelect={(e) => {
              const lid = card.leadId || "";
              if (e.shiftKey) bulk.toggleRange(lid, allLeadIds);
              else bulk.toggle(lid);
            }}
            onClick={() => {
              const entry = findEntry(card.id);
              if (entry) onClickEntry?.(entry);
            }}
            onRemove={onRemoveEntry ? () => onRemoveEntry(card.id) : undefined}
            onCalorChange={(calor) => {
              if (card.leadId) updateLead.mutate({ id: card.leadId, rating: calor });
            }}
            onQuickAction={(title) => {
              createAcaoDoDia.mutate({ title, lead_id: card.leadId || undefined });
            }}
          />
        )}
      />
      <ExportStageDialog
        open={!!stageToExport}
        onOpenChange={(o) => {
          if (!o) setStageToExport(null);
        }}
        // Modo unificado (SCRUM-633): etapa endereçada por
        // (pipelines.id, pipeline_stages.id) — serve qualquer família.
        stageId={stages.find((s) => s.stage_key === stageToExport?.id)?.id ?? ""}
        stageTitle={stageToExport?.title ?? ""}
        pipe="pipeline"
        pipelineId={pipelineId}
        leadCount={stageToExport?.count ?? 0}
      />
      <BulkActionBar selectedIds={bulk.selectedIds} onClear={bulk.clearSelection} leadIds={allLeadIds} />
    </>
  );
}
