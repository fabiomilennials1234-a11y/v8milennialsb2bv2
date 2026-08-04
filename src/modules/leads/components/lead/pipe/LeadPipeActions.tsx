/**
 * LeadPipeActions — lista todos os pipelines com ações add/move/remove.
 *
 * Extraído de LeadDetailContent (Onda 3.1, C5).
 * Renderiza a lista completa de pipelines (padrão + custom) com estado de expansão.
 */

import { useState } from "react";
import { GitBranch, Plus, Loader2, X, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getPipelineKey,
  getPipelineEntryId,
  getPipelineLabel,
  getPipelineColor,
  isInPipeline,
  getCurrentStageLabel,
  getCurrentStageId,
  getNormalizedStages,
} from "@/lib/lead/pipeline-adapters";
import type { PipelineStatus } from "../../../hooks/useLeadAllPipelines";

interface LeadPipeActionsProps {
  pipelines: PipelineStatus[];
  isLoading?: boolean;
  onMoveStage: (pipeline: PipelineStatus, newStageId: string) => Promise<void>;
  onRemoveFromPipeline: (pipeline: PipelineStatus) => Promise<void>;
  onAddToPipeline: (pipeline: PipelineStatus, stageId: string) => Promise<void>;
  isMutating?: boolean;
}

export function LeadPipeActions({
  pipelines,
  isLoading = false,
  onMoveStage,
  onRemoveFromPipeline,
  onAddToPipeline,
  isMutating = false,
}: LeadPipeActionsProps) {
  const [expandedPipeline, setExpandedPipeline] = useState<string | null>(null);
  const [addingToPipeline, setAddingToPipeline] = useState<string | null>(null);
  const [addStageId, setAddStageId] = useState<string>("");

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (pipelines.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <GitBranch className="w-10 h-10 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Nenhum funil disponível</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {pipelines.map((pipeline) => {
        // `getPipelineKey` identifica o FUNIL (pipeType para system, pipelineId
        // para custom) — era único enquanto o lead só podia ter um negócio por
        // funil. Depois do M1 `useLeadAllPipelines` emite uma linha POR NEGÓCIO,
        // então o funil sozinho colide: React reclamaria de chave duplicada e,
        // pior, expandir/adicionar num negócio abriria os N (o estado de
        // expansão é comparado contra esta mesma chave, logo abaixo).
        // A identidade da linha é (funil, negócio); `none` cobre o funil vazio,
        // que continua emitindo exatamente uma linha com `pipeId` nulo.
        const key = `${getPipelineKey(pipeline)}:${getPipelineEntryId(pipeline) ?? "none"}`;
        const label = getPipelineLabel(pipeline);
        const color = getPipelineColor(pipeline);
        const inPipe = isInPipeline(pipeline);
        const currentLabel = getCurrentStageLabel(pipeline);
        const currentId = getCurrentStageId(pipeline);
        const stages = getNormalizedStages(pipeline);
        const isExpanded = expandedPipeline === key;
        const isAdding = addingToPipeline === key;

        return (
          <div key={key} className="border rounded-lg overflow-hidden">
            {/* Pipeline row */}
            <div className="flex items-center gap-3 p-3">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="font-medium text-sm flex-1 min-w-0 truncate">
                {label}
              </span>

              {inPipe ? (
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="secondary"
                    className="text-xs cursor-pointer"
                    onClick={() =>
                      setExpandedPipeline(isExpanded ? null : key)
                    }
                  >
                    {currentLabel}
                    <ChevronDown
                      className={cn(
                        "w-3 h-3 ml-1 transition-transform",
                        isExpanded && "rotate-180"
                      )}
                    />
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => onRemoveFromPipeline(pipeline)}
                    disabled={isMutating}
                    aria-label={`Remover de ${label}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setAddingToPipeline(isAdding ? null : key);
                    setAddStageId("");
                  }}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Adicionar
                </Button>
              )}
            </div>

            {/* Expanded: move stage */}
            {isExpanded && inPipe && (
              <div className="border-t bg-muted/30 p-3 space-y-1.5">
                <span className="text-xs text-muted-foreground">Mover para:</span>
                <div className="grid grid-cols-1 gap-1">
                  {stages.map((stage) => {
                    const isCurrent = stage.id === currentId;
                    return (
                      <Button
                        key={stage.id}
                        variant={isCurrent ? "default" : "outline"}
                        size="sm"
                        className={cn(
                          "justify-start h-8 text-xs",
                          isCurrent && "pointer-events-none"
                        )}
                        style={
                          isCurrent
                            ? { backgroundColor: stage.color }
                            : { borderColor: `${stage.color}60` }
                        }
                        onClick={() => {
                          if (!isCurrent) {
                            onMoveStage(pipeline, stage.id).then(() =>
                              setExpandedPipeline(null)
                            );
                          }
                        }}
                        disabled={isMutating}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full mr-2 shrink-0"
                          style={{ backgroundColor: stage.color }}
                        />
                        <span className="flex-1 text-left">{stage.name}</span>
                        {isCurrent && <Check className="w-3.5 h-3.5" />}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Adding: select stage */}
            {isAdding && !inPipe && (
              <div className="border-t bg-muted/30 p-3 space-y-2">
                <span className="text-xs text-muted-foreground">Selecione a etapa:</span>
                <Select value={addStageId} onValueChange={setAddStageId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Etapa..." />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: s.color }}
                          />
                          {s.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {addStageId && (
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs"
                    onClick={() => {
                      onAddToPipeline(pipeline, addStageId).then(() => {
                        setAddingToPipeline(null);
                        setAddStageId("");
                      });
                    }}
                    disabled={isMutating}
                  >
                    {isMutating ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5 mr-1" />
                    )}
                    Adicionar
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
