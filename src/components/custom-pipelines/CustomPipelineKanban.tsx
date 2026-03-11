import { useMemo } from "react";
import { DraggableKanbanBoard, type KanbanColumn } from "@/components/kanban/DraggableKanbanBoard";
import { CustomPipeLeadCard } from "./CustomPipeLeadCard";
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

interface KanbanItem {
  id: string;
  entry: CustomPipeEntry;
}

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
  const { data: workflowCounts = {} } = useCustomPipeWorkflowCounts(pipeline.id);

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
      const company = (entry.lead?.company_name || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const phone = (entry.lead?.phone || "").toLowerCase();

      return name.includes(query) || company.includes(query) || phone.includes(query);
    });
  }, [entries, searchQuery]);

  // Agrupar entries por etapa e montar colunas
  const columns: KanbanColumn<KanbanItem>[] = useMemo(() => {
    const grouped = groupEntriesByStage(filteredEntries, stages);

    return stages.map((stage) => ({
      id: stage.id,
      title: stage.name,
      color: stage.color || "#64748b",
      items: (grouped[stage.id] || []).map((entry) => ({
        id: entry.id,
        entry,
      })),
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
    <DraggableKanbanBoard<KanbanItem>
      columns={columns}
      onStatusChange={handleStatusChange}
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
      renderCard={(item) => (
        <CustomPipeLeadCard
          entry={item.entry}
          onRemove={onRemoveEntry}
          onClick={onClickEntry}
        />
      )}
    />
  );
}
