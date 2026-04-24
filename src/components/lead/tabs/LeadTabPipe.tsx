/**
 * LeadTabPipe — tab de gerenciamento de pipelines do lead.
 *
 * Orquestra LeadPipeActions + LeadStageHistory.
 * Extraído de LeadDetailContent (Onda 3.1, C9).
 */

import { GitBranch } from "lucide-react";
import { LeadPipeActions } from "@/components/lead/pipe/LeadPipeActions";
import { LeadStageHistory } from "@/components/lead/pipe/LeadStageHistory";
import type { PipelineStatus } from "@/hooks/useLeadAllPipelines";
import type { TimelineEvent } from "@/hooks/useLeadTimeline";

interface LeadTabPipeProps {
  pipelines: PipelineStatus[];
  isLoadingPipelines?: boolean;
  recentHistory?: TimelineEvent[];
  onMoveStage: (pipeline: PipelineStatus, newStageId: string) => Promise<void>;
  onRemoveFromPipeline: (pipeline: PipelineStatus) => Promise<void>;
  onAddToPipeline: (pipeline: PipelineStatus, stageId: string) => Promise<void>;
  isMutating?: boolean;
}

export function LeadTabPipe({
  pipelines,
  isLoadingPipelines = false,
  recentHistory = [],
  onMoveStage,
  onRemoveFromPipeline,
  onAddToPipeline,
  isMutating = false,
}: LeadTabPipeProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center pb-2">
        <h4 className="font-medium flex items-center justify-center gap-2">
          <GitBranch className="w-4 h-4" />
          Funis
        </h4>
        <p className="text-sm text-muted-foreground">Gerencie o lead em todos os funis</p>
      </div>

      {/* Pipeline list with add/move/remove */}
      <LeadPipeActions
        pipelines={pipelines}
        isLoading={isLoadingPipelines}
        onMoveStage={onMoveStage}
        onRemoveFromPipeline={onRemoveFromPipeline}
        onAddToPipeline={onAddToPipeline}
        isMutating={isMutating}
      />

      {/* Stage history (compact) */}
      {recentHistory.length > 0 && (
        <LeadStageHistory events={recentHistory} maxEvents={5} />
      )}
    </div>
  );
}
