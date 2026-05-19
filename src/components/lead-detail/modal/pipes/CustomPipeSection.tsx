import { memo, useState } from "react";
import { ChevronDown, Loader2, Trash2 } from "lucide-react";
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
  useMoveLeadInCustomPipe,
  useRemoveLeadFromCustomPipe,
} from "@/hooks/useCustomPipelines";
import { useLeadActionGates } from "../../hooks/useLeadActionGates";
import type { CustomPipelineStatus } from "@/hooks/useLeadAllPipelines";

interface CustomPipeSectionProps {
  pipe: CustomPipelineStatus;
  leadId: string;
  open: boolean;
  onToggle: () => void;
}

export const CustomPipeSection = memo(function CustomPipeSection({
  pipe,
  leadId,
  open,
  onToggle,
}: CustomPipeSectionProps) {
  const moveMutation = useMoveLeadInCustomPipe();
  const removeMutation = useRemoveLeadFromCustomPipe();
  const { canRemoveFromPipe, canMoveMeeting } = useLeadActionGates(leadId);

  const [removeOpen, setRemoveOpen] = useState(false);

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
            <p className="text-xs text-muted-foreground">
              Lead ainda não está neste pipe. Adicione via kanban para gerenciar.
            </p>
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
