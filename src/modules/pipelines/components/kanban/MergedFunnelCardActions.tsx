/**
 * Ações de card por stage no funil mergeado Oportunidades (ADR-0004, Slice 4).
 *
 * Renderiza o controle certo conforme o stage:
 * - agendado        → botão de confirmação (date-aware)
 * - remarcar        → CTA "Nova data → Agendado" (reseta confirmação)
 * - nao_compareceu  → "Remarcar" + "Marcar perdido" (loss reason)
 *
 * Auto-gateia na flag merged_opportunity_funnel. Render slot: LeadCard.extraActions.
 */
import { useState } from "react";
import { CalendarPlus, RotateCcw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import type { ConfirmationStatus } from "../../lib/confirmation-button";
import { useMarkLost } from "../../hooks/model/useMergedFunnelActions";
import { MeetingConfirmationButton } from "./MeetingConfirmationButton";
import { SetMeetingDateModal } from "./SetMeetingDateModal";
import { LossReasonDialog } from "./LossReasonDialog";

const SMALL_BTN =
  "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border text-xs font-semibold transition-colors";

export interface MergedFunnelCardActionsProps {
  entryId: string;
  stageKey?: string | null;
  meetingDate?: string | null;
  confirmationStatus?: ConfirmationStatus | null;
  /** Stage is_final_negative da org — destino do "Marcar perdido". */
  lostStageKey?: string | null;
  onMoveStage: (toStageKey: string) => void;
}

export function MergedFunnelCardActions({
  entryId,
  stageKey,
  meetingDate,
  confirmationStatus,
  lostStageKey,
  onMoveStage,
}: MergedFunnelCardActionsProps) {
  const { hasFeature } = useOrgFeatures();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [lossOpen, setLossOpen] = useState(false);
  const markLost = useMarkLost();

  if (!hasFeature("merged_opportunity_funnel")) return null;

  if (stageKey === "agendado") {
    return (
      <MeetingConfirmationButton
        entryId={entryId}
        stageKey={stageKey}
        meetingDate={meetingDate}
        confirmationStatus={confirmationStatus}
      />
    );
  }

  if (stageKey === "remarcar") {
    return (
      <>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setRescheduleOpen(true); }}
          className={cn(SMALL_BTN, "w-full border-dashed border-amber-500/40 text-amber-600 hover:bg-amber-500/8")}
        >
          <CalendarPlus className="w-3.5 h-3.5" />
          Nova data → Agendado
        </button>
        <SetMeetingDateModal open={rescheduleOpen} onOpenChange={setRescheduleOpen} entryId={entryId} variant="reschedule" />
      </>
    );
  }

  if (stageKey === "nao_compareceu") {
    return (
      <>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMoveStage("remarcar"); }}
            className={cn(SMALL_BTN, "border-amber-500/40 text-amber-600 hover:bg-amber-500/8")}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Remarcar
          </button>
          {lostStageKey && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLossOpen(true); }}
              className={cn(SMALL_BTN, "border-destructive/40 text-destructive hover:bg-destructive/8")}
            >
              <XCircle className="w-3.5 h-3.5" />
              Perdido
            </button>
          )}
        </div>
        {lostStageKey && (
          <LossReasonDialog
            open={lossOpen}
            onOpenChange={setLossOpen}
            pending={markLost.isPending}
            onConfirm={(lossReasonId) =>
              markLost.mutate(
                { entryId, lostStageKey, lossReasonId },
                { onSuccess: () => setLossOpen(false) },
              )
            }
          />
        )}
      </>
    );
  }

  return null;
}
