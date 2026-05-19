import { memo, useState } from "react";
import { ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useAddLeadToCustomPipe,
  useMoveLeadInCustomPipe,
  useRemoveLeadFromCustomPipe,
} from "@/hooks/useCustomPipelines";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useLeadActionGates } from "../../hooks/useLeadActionGates";
import type { CustomPipelineStatus } from "@/hooks/useLeadAllPipelines";

interface CustomPipeSectionProps {
  pipe: CustomPipelineStatus;
  leadId: string;
  open: boolean;
  onToggle: () => void;
  /** Called after a successful add — accordion may force-expand. */
  onAdded?: () => void;
}

export const CustomPipeSection = memo(function CustomPipeSection({
  pipe,
  leadId,
  open,
  onToggle,
  onAdded,
}: CustomPipeSectionProps) {
  const moveMutation = useMoveLeadInCustomPipe();
  const removeMutation = useRemoveLeadFromCustomPipe();
  const addMutation = useAddLeadToCustomPipe();
  const logAction = useLogLeadAction();
  const { canRemoveFromPipe, canMoveMeeting, canAddToPipe } = useLeadActionGates(leadId);

  const [removeOpen, setRemoveOpen] = useState(false);

  const handleAdd = async () => {
    if (!pipe.stages.length) {
      toast.error("Pipe sem stages configuradas");
      return;
    }
    const stageId = pipe.stages[0].id;
    try {
      await addMutation.mutateAsync({
        lead_id: leadId,
        pipeline_id: pipe.pipelineId,
        stage_id: stageId,
      });
      void logAction({
        leadId,
        action: "pipe_added",
        description: `Adicionado a ${pipe.pipelineName}`,
        metadata: { pipe_type: "custom", pipeline_id: pipe.pipelineId, stage_id: stageId },
      });
      toast.success(`Adicionado a ${pipe.pipelineName}`);
      onAdded?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao adicionar";
      toast.error(msg);
    }
  };

  const handleStageChange = async (newStageId: string) => {
    if (!pipe.entryId) {
      toast.error("Lead ainda não está neste pipe");
      return;
    }
    if (newStageId === pipe.currentStageId) return;
    try {
      await moveMutation.mutateAsync({
        entry_id: pipe.entryId,
        pipeline_id: pipe.pipelineId,
        stage_id: newStageId,
      });
      toast.success("Stage atualizado");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao mover";
      toast.error(msg);
    }
  };

  const handleRemove = async () => {
    if (!pipe.entryId) return;
    try {
      await removeMutation.mutateAsync({
        entry_id: pipe.entryId,
        pipeline_id: pipe.pipelineId,
      });
      toast.success(`Removido de ${pipe.pipelineName}`);
      setRemoveOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao remover";
      toast.error(msg);
    }
  };

  const inPipe = !!pipe.entryId;

  return (
    <section
      className={cn(
        "rounded-xl border border-border/40 bg-card overflow-hidden transition-colors",
        open && "ring-1 ring-primary/20",
      )}
      data-testid={`custom-pipe-section-${pipe.pipelineId}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: pipe.pipelineColor }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{pipe.pipelineName}</span>
            {pipe.currentStageName ? (
              <Badge variant="outline" className="text-[10px] font-normal">
                {pipe.currentStageName}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
                Não está neste pipe
              </Badge>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {!inPipe ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Lead ainda não está neste pipe.
              </p>
              {canAddToPipe.allowed ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5 w-full"
                  onClick={handleAdd}
                  disabled={addMutation.isPending}
                  aria-label={`Adicionar a ${pipe.pipelineName}`}
                  data-testid={`add-to-pipe-cta-${pipe.pipelineId}`}
                >
                  {addMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  Adicionar a {pipe.pipelineName}
                </Button>
              ) : (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="block w-full">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1.5 w-full"
                          disabled
                          aria-label={`Adicionar a ${pipe.pipelineName}`}
                          data-testid={`add-to-pipe-cta-${pipe.pipelineId}`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Adicionar a {pipe.pipelineName}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {canAddToPipe.reason ?? "Sem permissão para adicionar a pipes"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Stage</label>
                <Select
                  value={pipe.currentStageId ?? undefined}
                  onValueChange={handleStageChange}
                  disabled={moveMutation.isPending || !canMoveMeeting.allowed}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipe.stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {canRemoveFromPipe.allowed && (
                <div className="flex justify-end">
                  <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 h-7 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remover de {pipe.pipelineName}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remover de {pipe.pipelineName}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Ação irreversível. O lead vai sair deste pipe — histórico
                          de comissões e métricas continua intacto.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleRemove}
                          disabled={removeMutation.isPending}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {removeMutation.isPending ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            "Remover"
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}

              {!canRemoveFromPipe.allowed && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="text-[10px] text-muted-foreground/60 text-right">
                        Remoção restrita a admins
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      Apenas admins podem remover leads de pipes.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
});
