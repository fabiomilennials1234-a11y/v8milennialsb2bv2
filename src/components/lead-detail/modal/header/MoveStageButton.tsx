import { memo, useState } from "react";
import { ArrowRightCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DrawerVariant } from "../../hooks/useLeadSheet";
import { StageProgressBar } from "../../StageProgressBar";

interface MoveStageButtonProps {
  leadId: string;
  organizationId: string;
  variant: DrawerVariant;
  pipeData: { id?: string; stage_id?: string } | null;
}

const VARIANT_TO_PIPE_TYPE: Partial<Record<DrawerVariant, string>> = {
  whatsapp: "whatsapp",
  confirmacao: "confirmacao",
  propostas: "propostas",
};

const VARIANT_TO_TABLE: Partial<Record<DrawerVariant, "pipe_whatsapp" | "pipe_confirmacao" | "pipe_propostas">> = {
  whatsapp: "pipe_whatsapp",
  confirmacao: "pipe_confirmacao",
  propostas: "pipe_propostas",
};

export const MoveStageButton = memo(function MoveStageButton({
  leadId,
  organizationId,
  variant,
  pipeData,
}: MoveStageButtonProps) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const qc = useQueryClient();
  const logAction = useLogLeadAction();

  const pipeType = VARIANT_TO_PIPE_TYPE[variant];
  const pipeTable = VARIANT_TO_TABLE[variant];

  const { data: stages = [] } = useQuery({
    queryKey: ["pipeline-stages-for-move", variant, organizationId],
    queryFn: async () => {
      if (!pipeType) return [];
      const { data } = await supabase
        .from("pipeline_stages")
        .select("id, name, position")
        .eq("organization_id", organizationId)
        .eq("pipe_type", pipeType)
        .order("position");
      return data ?? [];
    },
    enabled: open && !!pipeType,
  });

  const currentStageId = pipeData?.stage_id ?? null;

  const handleMove = async (stageId: string) => {
    if (!pipeTable || !pipeData?.id) {
      toast.error("Pipe sem registro pra mover");
      return;
    }
    if (stageId === currentStageId) {
      setOpen(false);
      return;
    }
    setMoving(true);
    try {
      const { error } = await (supabase
        .from(pipeTable) as any)
        .update({ stage_id: stageId })
        .eq("id", pipeData.id);
      if (error) throw error;
      logAction({
        leadId,
        action: "stage_changed",
        description: `Movido para "${stages.find((s) => s.id === stageId)?.name ?? "—"}"`,
      });
      qc.invalidateQueries({ queryKey: ["lead-pipes", leadId] });
      qc.invalidateQueries({ queryKey: ["lead-timeline", leadId] });
      qc.invalidateQueries({ queryKey: [pipeTable] });
      toast.success("Stage atualizado");
      setOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao mover";
      toast.error(msg);
    } finally {
      setMoving(false);
    }
  };

  const disabled = !pipeTable || !pipeData?.id;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 rounded-full px-3.5 text-xs font-medium"
          disabled={disabled}
        >
          <ArrowRightCircle className="w-3.5 h-3.5" />
          Mover
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-1">
            Mover pelo funil
          </div>
          {stages.length > 0 && (
            <div className="px-1">
              <StageProgressBar stages={stages} currentStageId={currentStageId} />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {stages.map((s) => {
              const isCurrent = s.id === currentStageId;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={moving}
                  onClick={() => handleMove(s.id)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors",
                    isCurrent && "bg-muted text-foreground"
                  )}
                >
                  <span className="truncate">{s.name}</span>
                  {isCurrent && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                  {moving && !isCurrent && (
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/40 shrink-0" />
                  )}
                </button>
              );
            })}
            {stages.length === 0 && (
              <div className="text-xs text-muted-foreground/60 text-center py-3">
                {disabled ? "Lead não está neste pipe" : "Sem stages configuradas"}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});
