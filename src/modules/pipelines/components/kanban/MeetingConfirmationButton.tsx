/**
 * Botão de confirmação de reunião no card (ADR-0004, Slice 2).
 *
 * Aparece só em cards no stage `agendado` quando a flag
 * `merged_opportunity_funnel` está ON. Label/cor são date-aware
 * (resolveConfirmButton). Clique persiste o status. Manual-only no v1.
 *
 * Sem meeting_date → não renderiza (o CTA "Definir data" é a Slice 3).
 */
import { useState } from "react";
import { Check, Clock, CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { resolveConfirmButton, type ConfirmationStatus } from "../../lib/confirmation-button";
import { useSetConfirmationStatus } from "../../hooks/model/useSetConfirmationStatus";
import { SetMeetingDateModal } from "./SetMeetingDateModal";

const ORG_TZ = "America/Sao_Paulo"; // sem campo de tz por org ainda — default

// Tons do botão em tokens (V5) — âmbar = `warning`, verde = `success`.
const TONE_CLASS: Record<string, string> = {
  neutral: "border-border bg-card text-muted-foreground hover:border-warning/60 hover:text-warning-strong",
  amber: "border-warning/50 bg-warning/15 text-warning-strong",
  green: "border-success/45 bg-success/10 text-success hover:bg-success/15",
};

export interface MeetingConfirmationButtonProps {
  entryId: string;
  stageKey?: string | null;
  meetingDate?: string | null;
  confirmationStatus?: ConfirmationStatus | null;
  leadId?: string | null;
  leadName?: string | null;
  leadCompany?: string | null;
  leadPhone?: string | null;
}

export function MeetingConfirmationButton({
  entryId,
  stageKey,
  meetingDate,
  confirmationStatus,
  leadId,
  leadName,
  leadCompany,
  leadPhone,
}: MeetingConfirmationButtonProps) {
  const { hasFeature } = useOrgFeatures();
  const setStatus = useSetConfirmationStatus();
  const [dateModalOpen, setDateModalOpen] = useState(false);

  if (!hasFeature("merged_opportunity_funnel") || stageKey !== "agendado") return null;

  const btn = resolveConfirmButton({
    meetingDate: meetingDate ?? null,
    confirmationStatus: confirmationStatus ?? "pendente",
    now: new Date(),
    orgTz: ORG_TZ,
  });

  // Sem data → CTA "Definir data" (abre modal). Slice 3.
  if (btn.action === "definir_data") {
    return (
      <>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDateModalOpen(true); }}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-full border border-dashed px-2 py-1.5 text-xs font-semibold transition-colors",
            "border-warning/50 text-warning-strong hover:bg-warning/10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <CalendarPlus className="w-3.5 h-3.5" />
          {btn.label}
        </button>
        <SetMeetingDateModal
          open={dateModalOpen}
          onOpenChange={setDateModalOpen}
          entryId={entryId}
          leadId={leadId}
          leadName={leadName}
          leadCompany={leadCompany}
          leadPhone={leadPhone}
        />
      </>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (btn.disabled || setStatus.isPending) return;
    if (btn.action === "pre_confirmar") setStatus.mutate({ entryId, status: "pre_confirmado" });
    else if (btn.action === "confirmar") setStatus.mutate({ entryId, status: "confirmado" });
  };

  const Icon = btn.tone === "neutral" ? Clock : Check;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={btn.disabled || setStatus.isPending}
      className={cn(
        "flex w-full items-center justify-center gap-1.5 rounded-full border px-2 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default disabled:opacity-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        TONE_CLASS[btn.tone],
        setStatus.isPending && "opacity-60",
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {btn.label}
    </button>
  );
}
