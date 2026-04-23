/**
 * LeadCurrentStage — badge do estágio atual de um funil + seletor rápido.
 *
 * Extraído de LeadDetailContent (Onda 3.1, C4).
 * Renderiza apenas uma linha de pipeline (o badge + expansão).
 */

import { ChevronDown, Check, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NormalizedStage } from "@/lib/lead/pipeline-adapters";

interface LeadCurrentStageProps {
  /** Key única do pipeline (pipeType ou pipelineId). */
  pipelineKey: string;
  /** Label do pipeline. */
  label: string;
  /** Cor hex do pipeline. */
  color: string;
  /** Se lead está neste pipeline. */
  inPipe: boolean;
  /** Label do estágio atual. */
  currentLabel: string | null;
  /** Id do estágio atual. */
  currentId: string | null;
  /** Stages disponíveis normalizados. */
  stages: NormalizedStage[];
  /** Se este pipeline está expandido para mover stage. */
  isExpanded: boolean;
  onToggleExpand: () => void;
  onMoveStage: (stageId: string) => void;
  onRemove: () => void;
  isMutating?: boolean;
}

export function LeadCurrentStage({
  pipelineKey,
  label,
  color,
  inPipe,
  currentLabel,
  currentId,
  stages,
  isExpanded,
  onToggleExpand,
  onMoveStage,
  onRemove,
  isMutating = false,
}: LeadCurrentStageProps) {
  if (!inPipe) return null;

  return (
    <>
      {/* Stage badge + actions */}
      <div className="flex items-center gap-1.5">
        <Badge
          variant="secondary"
          className="text-xs cursor-pointer"
          onClick={onToggleExpand}
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
          onClick={onRemove}
          aria-label={`Remover de ${label}`}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Expanded: move stage */}
      {isExpanded && (
        <div className="col-span-full border-t bg-muted/30 p-3 space-y-1.5">
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
                  onClick={() => !isCurrent && onMoveStage(stage.id)}
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
    </>
  );
}
