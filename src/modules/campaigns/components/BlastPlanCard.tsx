/**
 * BlastPlanCard — single Blast Plan row in the Disparos panel (#707/#709).
 *
 * One card === one plan. Owns its own `useBlastPlanProgress` (hooks can't run in
 * a loop), renders the operational read-out (status pill, message preview, audience,
 * lots, next release, progress bar) and the pause/resume/cancel controls.
 *
 * Operational-dashboard feel (Linear/Stripe): the progress bar + status pill carry
 * the signal. Everything else stays quiet and scannable.
 */
import { useMemo, useState } from "react";
import {
  useBlastPlanProgress,
  useBlastPlanControl,
  useUpdateBlastPlan,
  type BlastPlan,
} from "@/modules/campaigns/hooks/useBlastPlans";
import {
  processados,
  saiuDaFila,
} from "@/modules/campaigns/lib/blast-delivery-summary";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pause, Play, X, Loader2, Users, Layers, CalendarClock, Pencil } from "lucide-react";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Status presentation ─────────────────────────────────────────────────
// Quiet pills — color-coded by lifecycle. Gold = running, muted = idle/done,
// destructive = cancelled. Each pill reads on its own, no legend needed.
const STATUS_META: Record<
  BlastPlan["status"],
  { label: string; dot: string; pill: string }
> = {
  active: {
    label: "Ativo",
    dot: "bg-primary",
    pill: "border-primary/30 bg-primary/10 text-primary",
  },
  paused: {
    label: "Pausado",
    dot: "bg-muted-foreground",
    pill: "border-border bg-muted/60 text-muted-foreground",
  },
  completed: {
    label: "Concluído",
    dot: "bg-success",
    pill: "border-success/30 bg-success/10 text-success",
  },
  cancelled: {
    label: "Cancelado",
    dot: "bg-destructive",
    pill: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

/** Human "próximo lote" copy — amanhã / hoje / dd MMM. "—" once draining is done. */
function nextReleaseLabel(plan: BlastPlan): string {
  if (plan.status === "completed" || plan.status === "cancelled") return "—";
  if (!plan.next_release_date) return "—";
  try {
    const d = parseISO(plan.next_release_date);
    if (isToday(d)) return "hoje";
    if (isTomorrow(d)) return "amanhã";
    return format(d, "dd MMM", { locale: ptBR });
  } catch {
    return "—";
  }
}

function firstLine(message: string): string {
  const line = message.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line || "Sem mensagem";
}

interface BlastPlanCardProps {
  plan: BlastPlan;
  /** Drill-down (#944): card inteiro clicável → sheet da audiência congelada. */
  onOpen?: () => void;
}

export function BlastPlanCard({ plan, onOpen }: BlastPlanCardProps) {
  const { data: progress } = useBlastPlanProgress(plan);
  const control = useBlastPlanControl();
  const update = useUpdateBlastPlan();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editMessage, setEditMessage] = useState(plan.message);
  const [editTime, setEditTime] = useState((plan.release_time ?? "09:00").slice(0, 5));

  const status = STATUS_META[plan.status];
  const isActive = plan.status === "active";
  const isPaused = plan.status === "paused";
  const isTerminal = plan.status === "completed" || plan.status === "cancelled";

  // Progress: prefer recipient-level counts; fall back to lot ratio while the
  // recipient query is still loading so the bar never reads empty for a live plan.
  // As duas derivações vivem em `blast-delivery-summary.ts`, junto do resumo:
  // eram duas telas calculando a mesma soma, e um sétimo estado obrigaria a
  // lembrar das duas. `saiuDaFila` deixa `failed` DE FORA de propósito — ele tem
  // contador próprio logo ao lado, e somá-lo aqui contaria a mesma pessoa duas
  // vezes na mesma linha.
  const { total, saiu, delivered, skipped, failed, pct } = useMemo(() => {
    const t = progress?.total ?? plan.total_recipients ?? 0;
    const lotPct =
      plan.lots_total > 0 ? Math.round((plan.lots_released / plan.lots_total) * 100) : 0;
    if (!progress) {
      return { total: t, saiu: 0, delivered: 0, skipped: 0, failed: 0, pct: lotPct };
    }
    return {
      total: t,
      saiu: saiuDaFila(progress),
      delivered: progress.delivered,
      skipped: progress.skipped,
      failed: progress.failed,
      pct: t > 0 ? Math.round((processados(progress) / t) * 100) : 0,
    };
  }, [progress, plan.total_recipients, plan.lots_total, plan.lots_released]);

  const runControl = async (action: "pause" | "resume" | "cancel") => {
    try {
      await control.mutateAsync({ plan_id: plan.id, action });
      toast.success(
        action === "pause"
          ? "Disparo pausado"
          : action === "resume"
          ? "Disparo retomado"
          : "Disparo cancelado",
      );
    } catch (e) {
      toast.error((e as Error).message || "Não foi possível atualizar o disparo");
    }
  };

  const openEdit = () => {
    // Seed the form from the plan's current values each time it opens.
    setEditMessage(plan.message);
    setEditTime((plan.release_time ?? "09:00").slice(0, 5));
    setEditOpen(true);
  };

  const saveEdit = async () => {
    const message = editMessage.trim();
    if (!message) {
      toast.error("A mensagem não pode ficar vazia");
      return;
    }
    try {
      await update.mutateAsync({ plan_id: plan.id, message, release_time: editTime });
      toast.success("Disparo atualizado");
      setEditOpen(false);
    } catch (e) {
      toast.error((e as Error).message || "Não foi possível editar o disparo");
    }
  };

  return (
    // Card inteiro = alvo do drill-down (#944). Div interativa (não <button>)
    // porque os controles internos (pausar/editar/cancelar) são <button> reais —
    // eles param a propagação no container à direita. Os Dialogs ficam FORA da
    // div clicável: eventos React borbulham pela árvore de componentes mesmo
    // com portal, então dentro dela um clique no modal abriria o drill-down.
    <>
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? "Ver leads do disparo" : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      className={cn(
        "group rounded-xl border border-border/70 bg-card p-4 transition-colors duration-200",
        "hover:border-border",
        onOpen &&
          "cursor-pointer hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isTerminal && "opacity-75",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: status + message + meta */}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5",
                "text-[11px] font-semibold uppercase tracking-wide",
                status.pill,
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
              {status.label}
            </span>
            <p className="min-w-0 truncate text-sm font-medium text-foreground">
              {firstLine(plan.message)}
            </p>
          </div>

          {/* Meta strip — tabular, low-contrast labels, value in foreground */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              <span className="tabular-nums text-foreground/90">{total.toLocaleString("pt-BR")}</span>
              contatos
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              <span className="tabular-nums text-foreground/90">
                {plan.lots_released}/{plan.lots_total}
              </span>
              lotes
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              próximo lote:
              <span className="text-foreground/90">{nextReleaseLabel(plan)}</span>
            </span>
          </div>
        </div>

        {/* Right: controls — cliques aqui nunca abrem o drill-down */}
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {isActive && (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={control.isPending}
              onClick={() => runControl("pause")}
            >
              {control.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pause className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5 hidden sm:inline">Pausar</span>
            </Button>
          )}
          {isPaused && (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={control.isPending}
              onClick={() => runControl("resume")}
            >
              {control.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5 hidden sm:inline">Retomar</span>
            </Button>
          )}
          {!isTerminal && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-muted-foreground hover:text-foreground"
              disabled={control.isPending}
              onClick={openEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="ml-1.5 hidden sm:inline">Editar</span>
            </Button>
          )}
          {!isTerminal && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-muted-foreground hover:text-destructive"
              disabled={control.isPending}
              onClick={() => setConfirmCancel(true)}
            >
              <X className="h-3.5 w-3.5" />
              <span className="ml-1.5 hidden sm:inline">Cancelar</span>
            </Button>
          )}
        </div>
      </div>

      {/* Progress — the load-bearing element. Gold fill, skipped noted in copy. */}
      <div className="mt-3.5 space-y-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
              isTerminal && plan.status === "completed" ? "bg-success" : "bg-primary",
            )}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
          <span>
            <span className="text-foreground/80">{saiu.toLocaleString("pt-BR")}</span> enviados
            {/* Só o Canal Oficial tem confirmação de entrega (#1724); no Chip
                este número é sempre zero e o trecho não aparece. */}
            {delivered > 0 && (
              <span className="text-emerald-500"> · {delivered.toLocaleString("pt-BR")} entregues</span>
            )}
            {failed > 0 && (
              <span className="text-destructive"> · {failed.toLocaleString("pt-BR")} falhas</span>
            )}
            {skipped > 0 && (
              <span className="text-muted-foreground/70"> · {skipped.toLocaleString("pt-BR")} ignorados</span>
            )}
          </span>
          <span>{pct}%</span>
        </div>
      </div>

    </div>

      {/* Edit — message + release time only. The audience is immutable (ADR-0003). */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar disparo</DialogTitle>
            <DialogDescription>
              Altere a mensagem ou o horário de envio. O público é fixo e não pode ser alterado.
              A nova mensagem vale para os contatos que ainda não receberam.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`edit-msg-${plan.id}`} className="text-sm">
                Mensagem
              </Label>
              <Textarea
                id={`edit-msg-${plan.id}`}
                value={editMessage}
                onChange={(e) => setEditMessage(e.target.value)}
                rows={5}
                className="resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-time-${plan.id}`} className="text-sm">
                Horário do envio diário
              </Label>
              <Input
                id={`edit-time-${plan.id}`}
                type="time"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                className="w-36"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={update.isPending}>
              Cancelar
            </Button>
            <Button onClick={saveEdit} disabled={update.isPending} className="gap-2">
              {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation — irreversible action gets a deliberate stop */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar este disparo?</AlertDialogTitle>
            <AlertDialogDescription>
              Os lotes ainda não liberados não serão enviados. Os contatos já contactados
              permanecem. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => runControl("cancel")}
            >
              Cancelar disparo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
