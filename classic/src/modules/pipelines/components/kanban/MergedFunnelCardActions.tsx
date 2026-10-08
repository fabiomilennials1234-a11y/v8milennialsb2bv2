/**
 * Ações de card por stage no funil mergeado Oportunidades (ADR-0004, Slice 4 + fix).
 *
 * Renderiza o controle por stage:
 *   - agendado        → botão de confirmação (date-aware)
 *   - remarcar        → CTA "Nova data → Agendado" (reseta confirmação)
 *   - nao_compareceu  → "Remarcar" + "Marcar perdido" (loss reason)
 *
 * NÃO renderiza mais o "foco da reunião" (dia + horário). No S6 a data virou
 * linha de primeira classe do próprio card (`LeadCardData.date`), regida só
 * pelo dado — mantê-la aqui também desenharia a MESMA reunião duas vezes no
 * card das orgs que têm a flag do funil mergeado.
 *
 * Os BOTÕES seguem gateados em `merged_opportunity_funnel` (é comportamento
 * do funil mergeado, não do produto todo). Render slot: LeadCard.extraActions.
 */
import { useState } from "react";
import { CalendarPlus, RotateCcw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import type { StageRole } from "@/contracts/pipe";
import { ehEtapaDeReuniao } from "../../lib/etapa-de-reuniao";
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
  /** Papel semântico da etapa, resolvido no cliente pelo board (ADR-0017 §1). */
  stageRole?: StageRole | null;
  meetingDate?: string | null;
  confirmationStatus?: ConfirmationStatus | null;
  /** Stage is_final_negative da org — destino do "Marcar perdido". */
  lostStageKey?: string | null;
  onMoveStage: (toStageKey: string) => void;
  leadId?: string | null;
  leadName?: string | null;
  leadCompany?: string | null;
  leadPhone?: string | null;
}

export function MergedFunnelCardActions({
  entryId,
  stageKey,
  stageRole,
  meetingDate,
  confirmationStatus,
  lostStageKey,
  onMoveStage,
  leadId,
  leadName,
  leadCompany,
  leadPhone,
}: MergedFunnelCardActionsProps) {
  const { hasFeature } = useOrgFeatures();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [lossOpen, setLossOpen] = useState(false);
  const markLost = useMarkLost();

  if (!hasFeature("merged_opportunity_funnel")) return null;
  if (!ehEtapaDeReuniao(stageKey, stageRole, meetingDate)) return null;

  // ── Controle por stage ──
  let control: React.ReactNode = null;

  if (stageKey === "agendado") {
    control = (
      <MeetingConfirmationButton
        entryId={entryId}
        stageKey={stageKey}
        meetingDate={meetingDate}
        confirmationStatus={confirmationStatus}
        leadId={leadId}
        leadName={leadName}
        leadCompany={leadCompany}
        leadPhone={leadPhone}
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
        <SetMeetingDateModal
          open={rescheduleOpen}
          onOpenChange={setRescheduleOpen}
          entryId={entryId}
          leadId={leadId}
          leadName={leadName}
          leadCompany={leadCompany}
          leadPhone={leadPhone}
          variant="reschedule"
        />
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

  if (!control) return null;

  return <div className="flex flex-col gap-1.5">{control}</div>;
}
