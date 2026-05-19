import { memo, useState } from "react";
import { ArrowRightCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useLeadActionGates } from "../../hooks/useLeadActionGates";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { StageProgressBar } from "../../StageProgressBar";

/**
 * Pipe family identifier — replaces the old `MoveStageVariant` enum that
 * leaked through `useLeadSheet`. Local to MoveStageButton; callers in the
 * accordion pass the relevant family directly per pipe section.
 */
export type MoveStageVariant =
  | "whatsapp"
  | "confirmacao"
  | "propostas"
  | "custom";

/**
 * pipeData shape varies by pipe family:
 *   - System pipes (whatsapp/confirmacao/propostas): `{ id, status }`
 *     where `status` is the stage_key slug (via compat views over
 *     pipeline_entries.stage_key). Migration 20260982 dropped legacy
 *     pipe_* tables and replaced them with views.
 *   - Custom pipes: `{ id, stage_id, pipeline_id }` where `stage_id`
 *     is the uuid FK to `custom_pipeline_stages.id`.
 */
export type MoveStagePipeData =
  | { id?: string; status?: string }
  | { id?: string; stage_id?: string; pipeline_id?: string };

interface MoveStageButtonProps {
  leadId: string;
  organizationId: string;
  variant: MoveStageVariant;
  pipeData: MoveStagePipeData | null;
}

const VARIANT_TO_PIPE_TYPE: Partial<Record<MoveStageVariant, string>> = {
  whatsapp: "whatsapp",
  confirmacao: "confirmacao",
  propostas: "propostas",
};

const VARIANT_TO_TABLE: Partial<
  Record<MoveStageVariant, "pipe_whatsapp" | "pipe_confirmacao" | "pipe_propostas" | "custom_pipe_entries">
> = {
  whatsapp: "pipe_whatsapp",
  confirmacao: "pipe_confirmacao",
  propostas: "pipe_propostas",
  custom: "custom_pipe_entries",
};

type StageRow = { id: string; name: string; position: number; stage_key: string };

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
  const { canMoveMeeting } = useLeadActionGates(leadId);

  const pipeType = VARIANT_TO_PIPE_TYPE[variant];
  const pipeTable = VARIANT_TO_TABLE[variant];
  const isCustom = variant === "custom";

  // Custom pipes need pipeline_id from pipeData to fetch their stages.
  const customPipelineId = isCustom
    ? (pipeData as { pipeline_id?: string } | null)?.pipeline_id ?? null
    : null;

  const canFetch = open && (isCustom ? !!customPipelineId : !!pipeType);

  const { data: stages = [] } = useQuery<StageRow[]>({
    queryKey: isCustom
      ? ["custom-pipeline-stages-for-move", customPipelineId]
      : ["pipeline-stages-for-move", variant, organizationId],
    queryFn: async () => {
      if (isCustom) {
        const { data } = await supabase
          .from("custom_pipeline_stages")
          .select("id, name, position, stage_key")
          .eq("organization_id", organizationId)
          .eq("pipeline_id", customPipelineId!)
          .order("position");
        return (data ?? []) as StageRow[];
      }
      if (!pipeType) return [];
      const { data } = await supabase
        .from("pipeline_stages")
        .select("id, name, position, stage_key")
        .eq("organization_id", organizationId)
        .eq("pipe_type", pipeType)
        .order("position");
      return (data ?? []) as StageRow[];
    },
    enabled: canFetch,
  });

  // Current stage identifier:
  //   - System pipes: pipeData.status (slug, matches stage.stage_key)
  //   - Custom pipes: pipeData.stage_id (uuid, matches stage.id)
  const currentStageKey = isCustom
    ? null
    : (pipeData as { status?: string } | null)?.status ?? null;
  const currentStageUuid = isCustom
    ? (pipeData as { stage_id?: string } | null)?.stage_id ?? null
    : null;

  const isCurrent = (s: StageRow) =>
    isCustom ? s.id === currentStageUuid : s.stage_key === currentStageKey;

  const handleMove = async (stage: StageRow) => {
    if (!pipeTable || !pipeData?.id) {
      toast.error("Pipe sem registro pra mover");
      return;
    }
    if (isCurrent(stage)) {
      setOpen(false);
      return;
    }
    setMoving(true);
    try {
      // System pipes: write stage_key into the view's `status` column.
      // Custom pipes: write uuid into custom_pipe_entries.stage_id.
      const payload: Record<string, string> = isCustom
        ? { stage_id: stage.id }
        : { status: stage.stage_key };

      const { error } = await (supabase
        .from(pipeTable) as any)
        .update(payload)
        .eq("id", pipeData.id);
      if (error) throw error;

      logAction({
        leadId,
        action: "stage_changed",
        description: `Movido para "${stage.name}"`,
      });
      qc.invalidateQueries({ queryKey: ["lead-pipes", leadId] });
      qc.invalidateQueries({ queryKey: ["lead-timeline", leadId] });
      qc.invalidateQueries({ queryKey: [pipeTable] });
      qc.invalidateQueries({ queryKey: ["lead_all_pipelines", leadId] });
      toast.success("Stage atualizado");
      setOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao mover";
      toast.error(msg);
    } finally {
      setMoving(false);
    }
  };

  const disabled =
    !pipeTable ||
    !pipeData?.id ||
    (isCustom && !customPipelineId) ||
    !canMoveMeeting.allowed;

  // StageProgressBar still takes the old `currentStageId` prop. For system
  // pipes we don't have the uuid of the current stage on hand without a
  // lookup, so pass the matching stage's `id` if found.
  const currentStageIdForBar = stages.find(isCurrent)?.id ?? null;

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
              <StageProgressBar stages={stages} currentStageId={currentStageIdForBar} />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {stages.map((s) => {
              const current = isCurrent(s);
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={moving}
                  onClick={() => handleMove(s)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors",
                    current && "bg-muted text-foreground",
                  )}
                >
                  <span className="truncate">{s.name}</span>
                  {current && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                  {moving && !current && (
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
