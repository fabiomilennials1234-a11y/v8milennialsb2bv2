import { useMemo, useState } from "react";
import { DraggableKanbanBoard, type KanbanColumn } from "@/components/kanban/DraggableKanbanBoard";
import { ExportStageDialog } from "@/components/kanban/ExportStageDialog";
import { LeadCard, type LeadCardData } from "@/components/leads/LeadCard";
import { StageWorkflowsBadge } from "@/components/kanban/StageWorkflowsBadge";
import { useCustomPipeStageWorkflows, useCustomPipeWorkflowCounts } from "@/hooks/useStageWorkflows";
import {
  type CustomPipeline,
  type CustomPipelineStage,
  type CustomPipeEntry,
  useMoveLeadInCustomPipe,
  groupEntriesByStage,
} from "@/hooks/useCustomPipelines";
import { toast } from "sonner";
import { useCanDo } from "@/hooks/useCanDo";
import { useUpdateLead } from "@/hooks/useLeads";
import { useCreateAcaoDoDia } from "@/hooks/useAcoesDoDia";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface CustomPipelineKanbanProps {
  pipeline: CustomPipeline;
  stages: CustomPipelineStage[];
  entries: CustomPipeEntry[];
  searchQuery?: string;
  onRemoveEntry?: (entryId: string) => void;
  onClickEntry?: (entry: CustomPipeEntry) => void;
}

function CustomStageBadge({
  pipelineId,
  stageId,
  stageName,
  counts,
}: {
  pipelineId: string;
  stageId: string;
  stageName: string;
  counts?: { total: number; active: number };
}) {
  const total = counts?.total ?? 0;
  const active = counts?.active ?? 0;
  const { data: workflows } = useCustomPipeStageWorkflows(pipelineId, stageId);

  return (
    <StageWorkflowsBadge
      total={total}
      active={active}
      workflows={workflows}
      pipelineId={pipelineId}
      stageKey={stageId}
      stageName={stageName}
    />
  );
}

export function CustomPipelineKanban({
  pipeline,
  stages,
  entries,
  searchQuery,
  onRemoveEntry,
  onClickEntry,
}: CustomPipelineKanbanProps) {
  const moveLead = useMoveLeadInCustomPipe();
  const updateLead = useUpdateLead();
  const createAcaoDoDia = useCreateAcaoDoDia();
  const { allowed: canMovePipe } = useCanDo("move_pipe_record");
  const { data: workflowCounts = {} } = useCustomPipeWorkflowCounts(pipeline.id);
  const [stageToExport, setStageToExport] = useState<{ id: string; title: string; count: number } | null>(null);

  // Filtrar entries por busca
  const filteredEntries = useMemo(() => {
    if (!searchQuery?.trim()) return entries;
    const query = searchQuery
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    return entries.filter((entry) => {
      const name = (entry.lead?.name || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const company = (entry.lead?.company || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const phone = (entry.lead?.phone || "").toLowerCase();

      return name.includes(query) || company.includes(query) || phone.includes(query);
    });
  }, [entries, searchQuery]);

  // Transforma CustomPipeEntry → LeadCardData
  const transformToCard = (entry: CustomPipeEntry): LeadCardData => {
    const lead = entry.lead;
    return {
      id: entry.id,
      name: lead?.name || "Sem nome",
      company: lead?.company || null,
      phone: lead?.phone || null,
      email: lead?.email || null,
      rating: lead?.rating || 0,
      responsible: entry.assigned_profile?.full_name || null,
      origin: lead?.origin,
      tags: lead?.lead_tags?.map((lt: any) => ({ name: lt.tag?.name, color: lt.tag?.color || "#888" })).filter((t: any) => t.name) || [],
      createdAt: entry.created_at,
      notes: entry.notes,
      leadId: entry.lead_id,
    };
  };

  // Agrupar entries por etapa e montar colunas
  const columns: KanbanColumn<LeadCardData>[] = useMemo(() => {
    const grouped = groupEntriesByStage(filteredEntries, stages);

    return stages.map((stage) => ({
      id: stage.id,
      title: stage.name,
      color: stage.color || "#64748b",
      items: (grouped[stage.id] || []).map(transformToCard),
    }));
  }, [stages, filteredEntries]);

  const handleStatusChange = async (itemId: string, newStageId: string) => {
    try {
      await moveLead.mutateAsync({
        entry_id: itemId,
        pipeline_id: pipeline.id,
        stage_id: newStageId,
      });
    } catch (error) {
      toast.error("Erro ao mover lead");
    }
  };

  return (
    <>
    <DraggableKanbanBoard<LeadCardData>
      columns={columns}
      onStatusChange={handleStatusChange}
      disabled={!canMovePipe}
      onExportStage={(stageId, stageTitle) => {
        const col = columns.find((c) => c.id === stageId);
        setStageToExport({ id: stageId, title: stageTitle, count: col?.items.length ?? 0 });
      }}
      renderColumnExtra={(col) => {
        const allCounts = workflowCounts["__all__"] || { total: 0, active: 0 };
        const stageCounts = workflowCounts[col.id] || { total: 0, active: 0 };
        const merged = { total: stageCounts.total + allCounts.total, active: stageCounts.active + allCounts.active };
        return (
          <CustomStageBadge
            pipelineId={pipeline.id}
            stageId={col.id}
            stageName={col.title}
            counts={merged}
          />
        );
      }}
      renderCard={(card) => (
        <LeadCard
          lead={card}
          variant="custom"
          onClick={() => {
            const entry = filteredEntries.find(e => e.id === card.id);
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
      onOpenChange={(o) => { if (!o) setStageToExport(null); }}
      stageId={stageToExport?.id ?? ""}
      stageTitle={stageToExport?.title ?? ""}
      pipe="custom"
      customPipelineId={pipeline.id}
      leadCount={stageToExport?.count ?? 0}
    />
    </>
  );
}
