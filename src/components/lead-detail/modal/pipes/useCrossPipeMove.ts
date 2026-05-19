import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";

/**
 * useCrossPipeMove — unified stage-move hook for both system and custom
 * pipes. Replaces the popover logic that previously lived in
 * `MoveStageButton`. Returns a `move` callback plus a `pendingStageKey`
 * marker for optimistic-loading UI (StageSegment overlay/pulse).
 *
 * Contract per pipe family:
 *  - System pipes (whatsapp / confirmacao / propostas): write
 *    `{ status: stage_key }` into the compat view `pipe_<tipo>`, keyed by
 *    `pipeId` (= pipeline_entries.id).
 *  - Custom pipes: write `{ stage_id: <uuid> }` into
 *    `custom_pipe_entries`, keyed by `entryId`.
 *
 * Invalidates the queries the CrossPipePanel + activity column rely on.
 */

export type CrossPipeMoveTarget =
  | {
      kind: "system";
      pipeTable: "pipe_whatsapp" | "pipe_confirmacao" | "pipe_propostas";
      pipeId: string;
      stageKey: string;
      stageLabel: string;
    }
  | {
      kind: "custom";
      entryId: string;
      stageId: string;
      stageLabel: string;
    };

export interface UseCrossPipeMoveResult {
  /** Stage key/id currently being persisted (or null when idle). */
  pendingStageKey: string | null;
  /** True while any move is in flight. */
  isMoving: boolean;
  /** Stage key/id that just succeeded — drives the flash animation. */
  recentlyMovedStageKey: string | null;
  move: (target: CrossPipeMoveTarget) => Promise<void>;
}

export function useCrossPipeMove(leadId: string): UseCrossPipeMoveResult {
  const qc = useQueryClient();
  const logAction = useLogLeadAction();
  const [pendingStageKey, setPendingStageKey] = useState<string | null>(null);
  const [recentlyMovedStageKey, setRecentlyMovedStageKey] = useState<string | null>(null);

  const move = useCallback(
    async (target: CrossPipeMoveTarget) => {
      const targetKey = target.kind === "system" ? target.stageKey : target.stageId;
      setPendingStageKey(targetKey);
      try {
        if (target.kind === "system") {
          const { error } = await (supabase.from(target.pipeTable) as any)
            .update({ status: target.stageKey })
            .eq("id", target.pipeId);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("custom_pipe_entries")
            .update({
              stage_id: target.stageId,
              stage_changed_at: new Date().toISOString(),
            })
            .eq("id", target.entryId);
          if (error) throw error;
        }

        logAction({
          leadId,
          action: "stage_changed",
          description: `Movido para "${target.stageLabel}"`,
        });

        qc.invalidateQueries({ queryKey: ["lead_all_pipelines", leadId] });
        qc.invalidateQueries({ queryKey: ["lead-pipes", leadId] });
        qc.invalidateQueries({ queryKey: ["lead-timeline", leadId] });
        if (target.kind === "system") {
          qc.invalidateQueries({ queryKey: [target.pipeTable] });
        } else {
          qc.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
        }

        // Flash success on the now-current stage.
        setRecentlyMovedStageKey(targetKey);
        // Cool down so the animation runs every move.
        window.setTimeout(() => {
          setRecentlyMovedStageKey((cur) => (cur === targetKey ? null : cur));
        }, 360);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao mover";
        toast.error(msg);
      } finally {
        setPendingStageKey(null);
      }
    },
    [leadId, logAction, qc],
  );

  return useMemo(
    () => ({ pendingStageKey, isMoving: pendingStageKey !== null, recentlyMovedStageKey, move }),
    [pendingStageKey, recentlyMovedStageKey, move],
  );
}
