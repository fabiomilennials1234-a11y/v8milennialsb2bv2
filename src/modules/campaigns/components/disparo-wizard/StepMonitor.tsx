/**
 * StepMonitor — "Acompanhar" (#910, real wiring).
 *
 * Post-release view: a live in-progress card (which daily lot is in flight,
 * sent/queued, next batch), pause/cancel controls, and a transparent report.
 * Progress is REAL: `useBlastPlanProgress` reads blast_plan_recipients outcomes
 * and a `useRealtimeSubscription` on blast_plans + blast_plan_recipients keeps
 * it live; pause/cancel go through `useBlastPlanControl` (the service_role edge
 * control plane). The batch math stays the pure `monitorSnapshot`. The plan's
 * own row (status, lots) comes from `useBlastPlans`.
 */
import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Pause,
  Play,
  Ban,
  CalendarClock,
  Bell,
  Check,
  Clock3,
  ListChecks,
  MoveRight,
  UserPlus,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { planBlast } from "@/modules/campaigns/lib/blast-planning";
import {
  useBlastPlans,
  useBlastPlanProgress,
  useBlastPlanControl,
} from "@/modules/campaigns/hooks/useBlastPlans";
import type { DisparoDraft } from "./wizard-machine";
import { monitorSnapshot } from "./monitor-progress";
import { useBlastPlanRecipients } from "@/modules/campaigns/hooks/useBlastPlanRecipients";
import {
  skipReasonLabel,
  failureReasonLabel,
} from "@/modules/campaigns/lib/blast-recipient-view";

interface StepMonitorProps {
  draft: DisparoDraft;
  planId: string | null;
}

export function StepMonitor({ draft, planId }: StepMonitorProps) {
  // Live feed: a row change on either table re-pulls the plan + its progress.
  useRealtimeSubscription("blast_plans", ["blast_plans", "blast_plan_recipients"]);
  useRealtimeSubscription("blast_plan_recipients", ["blast_plan_recipients"]);

  const { data: plans } = useBlastPlans();
  const plan = useMemo(() => plans?.find((p) => p.id === planId) ?? null, [plans, planId]);
  const { data: progress } = useBlastPlanProgress(planId);

  // ⚠️ A verdade do Disparo é POR PESSOA, e vem da FILA — não de um contador
  // agregado nem do job do fornecedor (ADR-0028 §4, critério 7).
  //
  // O defeito que o épico nomeia é exatamente este: o disparo real da Distetica
  // terminou com `sent=1, failed=0` e ninguém conseguiu dizer QUEM recebeu,
  // porque o estado morava num contador do lote em vez de na pessoa. O contador
  // continua ali como resumo; o que não podia faltar é a lista.
  const { data: destinatarios } = useBlastPlanRecipients(plan);
  const control = useBlastPlanControl();

  // Pure plan math drives the batch/lot copy; the real sent count comes from the
  // recipient outcomes (fall back to the local plan estimate before it loads).
  const localPlan = useMemo(
    () =>
      planBlast({
        totalRecipients: draft.audienceCount,
        numbers: draft.numbers.filter((n) => n.selected).map((n) => ({ id: n.id, cap: n.cap })),
        startDateIso: draft.startDateIso,
      }),
    [draft.audienceCount, draft.numbers, draft.startDateIso],
  );

  const total = progress?.total ?? plan?.total_recipients ?? draft.audienceCount;
  const sent = progress?.sent ?? 0;
  const skipped = progress?.skipped ?? 0;
  // sent → failed reclassificado pelo sync (ADR-0016/#948) segue processado:
  // o monitor não pode "andar pra trás" quando uma entrega falha.
  const failed = progress?.failed ?? 0;
  const processed = sent + skipped + failed;
  const pending = progress?.pending ?? Math.max(0, total - processed);
  const snap = monitorSnapshot(localPlan, processed);
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  const status = plan?.status ?? "active";
  const paused = status === "paused";
  const cancelled = status === "cancelled";
  const completed = status === "completed";
  const terminal = cancelled || completed;

  const batchTotal = plan?.lots_total ?? snap.batchTotal;
  const batchCurrent = plan ? Math.min(plan.lots_released, plan.lots_total) || 1 : snap.batchCurrent;

  const runControl = async (action: "pause" | "resume" | "cancel") => {
    if (!planId) return;
    if (action === "cancel" && !window.confirm("Cancelar o restante do disparo? Já enviados permanecem.")) {
      return;
    }
    try {
      await control.mutateAsync({ plan_id: planId, action });
      toast.success(
        action === "pause" ? "Disparo pausado" : action === "resume" ? "Disparo retomado" : "Disparo cancelado",
      );
    } catch (e) {
      toast.error((e as Error).message ?? "Não foi possível atualizar o disparo");
    }
  };

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
          {cancelled ? "Disparo cancelado" : completed ? "Disparo concluído" : "Disparo em andamento"}
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {cancelled
            ? "Os contatos já enviados receberam a mensagem. O restante foi interrompido."
            : completed
              ? "Todos os lotes foram enviados. Veja o relatório abaixo."
              : "Sua mensagem está sendo enviada no ritmo escolhido. Pause quando quiser."}
        </p>
      </div>

      {/* In-progress card */}
      {!terminal && (
        <div className="rounded-2xl border border-border/70 bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              Lote {batchCurrent} de {batchTotal}
            </p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                paused ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500",
              )}
            >
              {paused ? "Pausado" : "Enviando"}
            </span>
          </div>

          <Progress value={pct} className="mt-3 h-2" />

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              <span className="font-medium tabular-nums text-foreground">{sent.toLocaleString("pt-BR")}</span> enviados
            </span>
            <span>
              <span className="font-medium tabular-nums text-foreground">{pending.toLocaleString("pt-BR")}</span> na fila
            </span>
          </div>

          {batchCurrent < batchTotal && (
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
              disabled={control.isPending || !planId}
              onClick={() => runControl(paused ? "resume" : "pause")}
            >
              {control.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : paused ? (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Pause className="mr-1.5 h-3.5 w-3.5" />
              )}
              {paused ? "Retomar" : "Pausar"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={control.isPending || !planId}
              onClick={() => runControl("cancel")}
            >
              <Ban className="mr-1.5 h-3.5 w-3.5" /> Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Post-send destination note — only when the plan moves leads on send */}
      {!terminal && draft.postSendMode === "move" && draft.postSendStageId && (
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/70">
          <MoveRight className="h-3.5 w-3.5" />
          Contatos enviados vão pra {draft.postSendLabel}.
        </p>
      )}

      {/* Transparent report — real recipient outcomes */}
      <div className="rounded-2xl border border-border/70 bg-card p-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Relatório</p>
        <ul className="mt-3 space-y-2.5 text-sm">
          <ReportRow icon={Check} tone="ok" label="Enviados" value={sent} />
          <ReportRow icon={Clock3} tone="muted" label="Na fila" value={pending} />
          <ReportRow icon={ListChecks} tone="muted" label="Ignorados" value={skipped} hint="sem WhatsApp / recência / duplicados" />
          <li className="border-t border-border/60 pt-2.5">
            <ReportRow icon={UserPlus} tone="accent" label="Total no público" value={total} />
          </li>
        </ul>
      </div>

      {/* Pessoa a pessoa — a resposta para "quem recebeu?" */}
      <div className="rounded-2xl border border-border/70 bg-card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Pessoa a pessoa
          </p>
          <span className="text-[11px] text-muted-foreground/70">
            {(destinatarios ?? []).length} no público
          </span>
        </div>

        {!destinatarios && (
          <p className="mt-3 text-sm text-muted-foreground">Carregando os destinatários…</p>
        )}

        {destinatarios && destinatarios.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Nenhum destinatário neste Disparo.
          </p>
        )}

        <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
          {(destinatarios ?? []).map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm odd:bg-muted/30"
            >
              <span className="min-w-0 truncate">
                {r.name ?? r.phone ?? "Contato sem nome"}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {estadoDoDestinatario(r)}
              </span>
            </li>
          ))}
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
      {hint && <span className="hidden text-[11px] text-muted-foreground sm:inline">{hint}</span>}
      <span className="font-semibold tabular-nums text-foreground">{value.toLocaleString("pt-BR")}</span>
    </div>
  );
}

/**
 * O estado de UMA pessoa, em português e com o motivo quando existe.
 *
 * "Falhou" sozinho manda o operador adivinhar se o problema é dele, do número da
 * pessoa ou da Meta — e é essa adivinhação que o épico veio acabar.
 */
function estadoDoDestinatario(r: {
  status: string;
  reason: string | null;
  lot_index: number;
}): string {
  switch (r.status) {
    case "sent":
      return "Enviado";
    case "failed":
      return failureReasonLabel(r.reason);
    case "skipped":
      return skipReasonLabel(r.reason);
    default:
      return r.lot_index > 0 ? `Na fila · lote ${r.lot_index + 1}` : "Na fila";
  }
}
