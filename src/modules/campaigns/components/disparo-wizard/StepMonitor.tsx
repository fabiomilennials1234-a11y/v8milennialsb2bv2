/**
 * StepMonitor — "Acompanhar" (#904 shell).
 *
 * Post-release confirmation. The real blast creation + live recipient progress
 * is TODO(#910) (blast-plan-create + the Disparos list already render live
 * plans); here it confirms the draft and points the operator to the panel.
 */
import { motion } from "framer-motion";
import { CheckCircle2, Users, CalendarRange } from "lucide-react";
import { useMemo } from "react";
import { planBlast } from "@/modules/campaigns/lib/blast-planning";
import type { DisparoDraft } from "./wizard-machine";

interface StepMonitorProps {
  draft: DisparoDraft;
}

export function StepMonitor({ draft }: StepMonitorProps) {
  const plan = useMemo(
    () =>
      planBlast({
        totalRecipients: draft.audienceCount,
        numbers: draft.numbers.filter((n) => n.selected).map((n) => ({ id: n.id, cap: n.cap })),
        startDateIso: draft.startDateIso,
      }),
    [draft.audienceCount, draft.numbers, draft.startDateIso],
  );

  return (
    <div className="flex flex-col items-center py-6 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary"
      >
        <CheckCircle2 className="h-7 w-7" strokeWidth={2} />
      </motion.div>

      <h2 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
        Disparo iniciado
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Os contatos vão receber sua mensagem ao longo dos próximos dias, no ritmo escolhido.
        Acompanhe o progresso e pause quando quiser.
      </p>

      <div className="mt-7 grid w-full max-w-sm grid-cols-2 gap-3">
        <div className="rounded-xl border border-border/70 bg-card p-4 text-left">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Público
          </div>
          <p className="mt-1.5 text-xl font-semibold tabular-nums text-foreground">
            {draft.audienceCount.toLocaleString("pt-BR")}
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-card p-4 text-left">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <CalendarRange className="h-3.5 w-3.5" />
            Duração
          </div>
          <p className="mt-1.5 text-xl font-semibold tabular-nums text-foreground">
            {plan.dayCount} {plan.dayCount === 1 ? "dia" : "dias"}
          </p>
        </div>
      </div>
    </div>
  );
}
