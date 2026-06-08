/**
 * Ações de card por stage no funil mergeado Oportunidades (ADR-0004, Slice 4 + fix).
 *
 * Renderiza:
 * - foco da reunião (dia + horário) sempre que há meeting_date num stage de reunião
 * - o controle por stage:
 *   - agendado        → botão de confirmação (date-aware)
 *   - remarcar        → CTA "Nova data → Agendado" (reseta confirmação)
 *   - nao_compareceu  → "Remarcar" + "Marcar perdido" (loss reason)
 *
 * Auto-gateia na flag merged_opportunity_funnel. Render slot: LeadCard.extraActions.
 */
import { useState } from "react";
import { CalendarPlus, RotateCcw, XCircle, CalendarClock } from "lucide-react";
import { format, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import type { ConfirmationStatus } from "../../lib/confirmation-button";
import { useMarkLost } from "../../hooks/model/useMergedFunnelActions";
import { MeetingConfirmationButton } from "./MeetingConfirmationButton";
import { SetMeetingDateModal } from "./SetMeetingDateModal";
import { LossReasonDialog } from "./LossReasonDialog";

const SMALL_BTN =
  "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border text-xs font-semibold transition-colors";

const MEETING_STAGES = new Set(["agendado", "remarcar", "compareceu", "nao_compareceu"]);

export interface MergedFunnelCardActionsProps {
  entryId: string;
  stageKey?: string | null;
  meetingDate?: string | null;
  confirmationStatus?: ConfirmationStatus | null;
  /** Stage is_final_negative da org — destino do "Marcar perdido". */
  lostStageKey?: string | null;
  onMoveStage: (toStageKey: string) => void;
}

/** Cor do foco de data por stage/confirmação. */
function dateToneClass(stageKey: string, status: ConfirmationStatus | null | undefined): string {
  if (stageKey === "compareceu") return "text-green-600 bg-green-500/10 border-green-500/25";
  if (stageKey === "nao_compareceu") return "text-destructive bg-destructive/10 border-destructive/25";
  if (stageKey === "remarcar") return "text-amber-600 bg-amber-500/10 border-amber-500/25";
  // agendado: segue o status de confirmação
  if (status === "confirmado") return "text-green-600 bg-green-500/10 border-green-500/25";
  if (status === "pre_confirmado") return "text-amber-600 bg-amber-500/10 border-amber-500/25";
  return "text-muted-foreground bg-muted/40 border-border";
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

  if (!hasFeature("merged_opportunity_funnel") || !stageKey || !MEETING_STAGES.has(stageKey)) return null;

  // ── Foco da reunião: dia + horário ──
  const parsed = meetingDate ? new Date(meetingDate) : null;
  const dateLine =
    parsed && isValid(parsed) ? (
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-semibold",
          dateToneClass(stageKey, confirmationStatus),
        )}
      >
        <CalendarClock className="w-3.5 h-3.5 shrink-0" />
        <span className="capitalize">{format(parsed, "EEE, dd/MM", { locale: ptBR })}</span>
        <span className="opacity-70">·</span>
        <span>{format(parsed, "HH:mm", { locale: ptBR })}</span>
      </div>
    ) : null;

  // ── Controle por stage ──
  let control: React.ReactNode = null;

  if (stageKey === "agendado") {
    control = (
      <MeetingConfirmationButton
        entryId={entryId}
        stageKey={stageKey}
        meetingDate={meetingDate}
        confirmationStatus={confirmationStatus}
      />
    );
  } else if (stageKey === "remarcar") {
    control = (
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
  } else if (stageKey === "nao_compareceu") {
    control = (
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

  if (!dateLine && !control) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {dateLine}
      {control}
    </div>
  );
}
