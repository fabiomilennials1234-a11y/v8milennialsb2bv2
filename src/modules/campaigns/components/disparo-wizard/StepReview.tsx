/**
 * StepReview — "Revisão" (#904 shell).
 *
 * Read-only confirmation before firing. Reuses the real pure cores: `planBlast`
 * for the day-by-day breakdown and `nextValidSendTime` for the first valid send
 * inside the quiet-hours window. The actual dispatch happens on RELEASE (footer
 * "Enviar disparo") — real send is TODO(#910); here it just creates the draft
 * locally and advances to the monitor step.
 */
import { useMemo } from "react";
import { Users, MessageSquare, MoveRight, Smartphone, Clock, Paperclip } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { planBlast, nextValidSendTime, DEFAULT_QUIET_WINDOW } from "@/modules/campaigns/lib/blast-planning";
import { StepHeader } from "./StepHeader";
import { selectedDailyCapacity, type DisparoDraft, type DisparoStepId, eyebrowDoPasso } from "./wizard-machine";

interface StepReviewProps {
  draft: DisparoDraft;
  /** Volta ao passo que decide aquela linha ("Editar"). */
  onEdit?: (step: DisparoStepId) => void;
}

function Row({
  icon: Icon,
  label,
  step,
  onEdit,
  children,
}: {
  icon: React.ElementType;
  label: string;
  step?: DisparoStepId;
  onEdit?: (step: DisparoStepId) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-card text-foreground/70 shadow-relevo">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">{label}</p>
        <div className="mt-0.5 text-sm text-foreground">{children}</div>
      </div>
      {step && onEdit && (
        <button
          type="button"
          onClick={() => onEdit(step)}
          aria-label={`Editar ${label.toLowerCase()}`}
          className="shrink-0 rounded-full border border-input bg-card px-3 py-1 text-xs font-semibold text-foreground/80 shadow-relevo transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Editar
        </button>
      )}
    </div>
  );
}

export function StepReview({ draft, onEdit }: StepReviewProps) {
  const capacity = selectedDailyCapacity(draft);
  const plan = useMemo(
    () =>
      planBlast({
        totalRecipients: draft.audienceCount,
        numbers: draft.numbers.filter((n) => n.selected).map((n) => ({ id: n.id, cap: n.cap })),
        startDateIso: draft.startDateIso,
      }),
    [draft.audienceCount, draft.numbers, draft.startDateIso],
  );

  const firstSend = useMemo(() => {
    const iso = nextValidSendTime(DEFAULT_QUIET_WINDOW, `${draft.startDateIso}T09:00`);
    try {
      return format(parseISO(iso), "EEEE, dd 'de' MMMM 'às' HH:mm", { locale: ptBR });
    } catch {
      return iso;
    }
  }, [draft.startDateIso]);

  const selectedNumbers = draft.numbers.filter((n) => n.selected);

  return (
    <div className="space-y-7">
      <StepHeader
        kicker={eyebrowDoPasso("review")}
        title="Tudo certo?"
        subtitle="Confira antes de enviar. Depois de iniciado, o disparo segue sozinho — você acompanha e pode pausar a qualquer momento."
      />

      <div className="divide-y divide-border/60 overflow-hidden rounded-[18px] bg-muted/50">
        <Row icon={Users} label="Pra quem" step="audience" onEdit={onEdit}>
          <span className="font-medium">{draft.audienceLabel || "—"}</span>
          <span className="text-muted-foreground">
            {" · "}
            {draft.audienceCount.toLocaleString("pt-BR")} contatos
          </span>
        </Row>

        <Row icon={MessageSquare} label="Mensagem" step="message" onEdit={onEdit}>
          <p className="line-clamp-3 whitespace-pre-wrap text-foreground/90">
            {draft.message.trim() || "—"}
          </p>
          {draft.media && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5" />
              {draft.media.name}
            </p>
          )}
        </Row>

        <Row icon={MoveRight} label="Depois do envio" step="postsend" onEdit={onEdit}>
          {draft.postSendMode === "move" && draft.postSendStageId ? (
            <>
              <span className="font-medium">{draft.postSendLabel}</span>
              <span className="text-muted-foreground"> · movido no envio de cada mensagem</span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Sem movimentação — contatos ficam onde estão
            </span>
          )}
        </Row>

        <Row icon={Smartphone} label="Velocidade" step="speed" onEdit={onEdit}>
          {selectedNumbers.map((n) => n.label).join(", ") || "—"}
          <span className="text-muted-foreground">
            {" · "}
            {capacity.toLocaleString("pt-BR")}/dia
            {plan.dayCount > 0 && ` · ${plan.dayCount} ${plan.dayCount === 1 ? "dia" : "dias"}`}
          </span>
        </Row>

        <Row icon={Clock} label="Primeiro envio">
          <span className="capitalize">{firstSend}</span>
        </Row>
      </div>

      {/* Day-by-day plan — only when it spans multiple days */}
      {plan.isPlan && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
            Distribuição por dia
          </p>
          <div className="flex flex-wrap gap-1.5">
            {plan.lots.map((lot) => (
              <div
                key={lot.dateIso}
                className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-center"
              >
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {format(parseISO(lot.dateIso), "dd MMM", { locale: ptBR })}
                </p>
                <p className="text-xs font-semibold tabular-nums text-foreground">
                  {lot.dayTotal.toLocaleString("pt-BR")}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
