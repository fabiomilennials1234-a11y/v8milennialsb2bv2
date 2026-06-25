/**
 * StepMonitor — "Acompanhar" (#910 UI).
 *
 * Post-release view: a live in-progress card (which daily lot is in flight,
 * sent/queued, next batch), pause/cancel controls, and a transparent report
 * (delivered, no-WhatsApp, skipped by recency, duplicates, + new Leads created).
 * Progress math is the pure `monitorSnapshot`. The real recipient feed,
 * pause/cancel mutations, and CRM-bell emission are backend — TODO(#910):
 * wire blast-plan controls + the live subscription; here they are mocked/no-op.
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Pause,
  Play,
  Ban,
  CalendarClock,
  Bell,
  Check,
  PhoneOff,
  History,
  CopyX,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { planBlast } from "@/modules/campaigns/lib/blast-planning";
import type { DisparoDraft } from "./wizard-machine";
import { monitorSnapshot } from "./monitor-progress";

interface StepMonitorProps {
  draft: DisparoDraft;
}

export function StepMonitor({ draft }: StepMonitorProps) {
  const [paused, setPaused] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  const plan = useMemo(
    () =>
      planBlast({
        totalRecipients: draft.audienceCount,
        numbers: draft.numbers.filter((n) => n.selected).map((n) => ({ id: n.id, cap: n.cap })),
        startDateIso: draft.startDateIso,
      }),
    [draft.audienceCount, draft.numbers, draft.startDateIso],
  );

  // TODO(#910): real sent count from the live recipient feed. Mock = first lot.
  const sentTotal = plan.lots[0]?.dayTotal ?? 0;
  const snap = monitorSnapshot(plan, sentTotal);

  // TODO(#910): real report from blast_plan_recipients outcomes. Mock breakdown.
  const noWhatsapp = Math.round(draft.audienceCount * 0.02);
  const skippedRecency = Math.round(draft.audienceCount * 0.04);
  const duplicates = Math.round(draft.audienceCount * 0.01);
  const delivered = snap.sent;

  return (
    <div className="mx-auto max-w-xl space-y-6 py-2">
      <div className="flex flex-col items-center text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary"
        >
          <CheckCircle2 className="h-7 w-7" strokeWidth={2} />
        </motion.div>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
          {cancelled ? "Disparo cancelado" : "Disparo em andamento"}
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {cancelled
            ? "Os contatos já enviados receberam a mensagem. O restante foi interrompido."
            : "Sua mensagem está sendo enviada no ritmo escolhido. Pause quando quiser."}
        </p>
      </div>

      {/* In-progress card */}
      {!cancelled && (
        <div className="rounded-2xl border border-border/70 bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              Lote {snap.batchCurrent} de {snap.batchTotal}
            </p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                paused
                  ? "bg-amber-500/10 text-amber-500"
                  : "bg-emerald-500/10 text-emerald-500",
              )}
            >
              {paused ? "Pausado" : "Enviando"}
            </span>
          </div>

          <Progress value={snap.pct} className="mt-3 h-2" />

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              <span className="font-medium tabular-nums text-foreground">{snap.sent}</span> enviados
            </span>
            <span>
              <span className="font-medium tabular-nums text-foreground">{snap.queued}</span> na fila
            </span>
          </div>

          {snap.batchCurrent < snap.batchTotal && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              Próximo lote amanhã, no horário escolhido.
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? (
                <>
                  <Play className="mr-1.5 h-3.5 w-3.5" /> Retomar
                </>
              ) : (
                <>
                  <Pause className="mr-1.5 h-3.5 w-3.5" /> Pausar
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                // TODO(#910): real cancel mutation + confirmation dialog.
                if (window.confirm("Cancelar o restante do disparo? Já enviados permanecem.")) {
                  setCancelled(true);
                }
              }}
            >
              <Ban className="mr-1.5 h-3.5 w-3.5" /> Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Transparent report */}
      <div className="rounded-2xl border border-border/70 bg-card p-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Relatório
        </p>
        <ul className="mt-3 space-y-2.5 text-sm">
          <ReportRow icon={Check} tone="ok" label="Enviados" value={delivered} />
          <ReportRow icon={PhoneOff} tone="muted" label="Sem WhatsApp válido" value={noWhatsapp} />
          <ReportRow icon={History} tone="muted" label="Ignorados (receberam há pouco)" value={skippedRecency} />
          <ReportRow icon={CopyX} tone="muted" label="Duplicados" value={duplicates} />
          <li className="border-t border-border/60 pt-2.5">
            <ReportRow icon={UserPlus} tone="accent" label="Novos leads criados" value={0} hint="da planilha" />
          </li>
        </ul>
      </div>

      <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/70">
        <Bell className="h-3.5 w-3.5" />
        Você recebe um aviso aqui no sistema quando cada lote termina.
      </p>
    </div>
  );
}

function ReportRow({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: typeof Check;
  tone: "ok" | "muted" | "accent";
  label: string;
  value: number;
  hint?: string;
}) {
  const toneClass =
    tone === "ok" ? "text-emerald-500" : tone === "accent" ? "text-primary" : "text-muted-foreground";
  return (
    <div className="flex items-center gap-2.5">
      <Icon className={cn("h-4 w-4 shrink-0", toneClass)} />
      <span className="flex-1 text-foreground">{label}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}
