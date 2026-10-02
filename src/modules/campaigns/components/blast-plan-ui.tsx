/**
 * blast-plan-ui — o vocabulário comum de um Blast Plan no painel de Disparos.
 *
 * O mesmo plano aparece em dois lugares (o cartão da grade e o cartão de ouro
 * "Disparo em foco"), e os dois precisam dizer as MESMAS coisas: rótulo de
 * status, próximo lote, origem do público, números do progresso e — sobretudo —
 * os mesmos controles (pausar/retomar/editar/cancelar) com os mesmos diálogos.
 * Tudo isso mora aqui uma vez; os cartões só desenham.
 */
import { useMemo, useState } from "react";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { blastOutcome } from "@/modules/campaigns/lib/blast-outcome";
import {
  useBlastPlanControl,
  useUpdateBlastPlan,
  type BlastPlan,
  type BlastPlanProgress,
} from "@/modules/campaigns/hooks/useBlastPlans";
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

// ─── Status ──────────────────────────────────────────────────────────────
// Tom do selo por ciclo de vida. Ouro = rodando; neutro = parado/feito;
// vermelho = cancelado ou falha. O selo se lê sozinho, sem legenda.
export type BlastTone = "gold" | "neutral" | "bad";

export const STATUS_META: Record<BlastPlan["status"], { label: string; tone: BlastTone }> = {
  active: { label: "Ativo", tone: "gold" },
  paused: { label: "Pausado", tone: "neutral" },
  // "Concluído" seria mentira: liberar todos os lotes não prova que o WhatsApp
  // entregou (blast-outcome.ts).
  completed: { label: "Lotes liberados", tone: "neutral" },
  cancelled: { label: "Cancelado", tone: "bad" },
};

export const STATUS_PILL: Record<BlastTone, string> = {
  gold: "border-transparent bg-primary-soft text-primary-soft-foreground",
  neutral: "border-border bg-muted/60 text-muted-foreground",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
};

export const STATUS_DOT: Record<BlastTone, string> = {
  gold: "bg-primary",
  neutral: "bg-muted-foreground",
  bad: "bg-destructive",
};

/** Selo do plano, já corrigido pelo desfecho real (falha vence "Lotes liberados"). */
export function planStatus(plan: BlastPlan, progress?: BlastPlanProgress) {
  const outcome = blastOutcome(plan.status, progress);
  if (outcome.failed && plan.status !== "cancelled") return { label: outcome.title, tone: "bad" as const };
  return STATUS_META[plan.status];
}

/** "hoje" / "amanhã" / "dd MMM". "—" quando não há mais lote a liberar. */
export function nextReleaseLabel(plan: BlastPlan): string {
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

/** HH:MM do lote diário. */
export function releaseTime(plan: BlastPlan): string {
  return (plan.release_time ?? "09:00").slice(0, 5);
}

/** O plano não tem nome próprio: o título é a primeira linha da mensagem. */
export function firstLine(message: string): string {
  const line = message.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line || "Sem mensagem";
}

/**
 * Origem do público lida de `blast_plans.source` — o que o assistente gravou.
 * Planos antigos com outro formato voltam `null` (melhor calar que adivinhar).
 */
export function audienceOrigin(
  plan: BlastPlan,
  funnelName: (pipelineId: string) => string | undefined,
): string | null {
  const src = plan.source;
  if (!src || typeof src !== "object") return null;
  if (src.type === "planilha") {
    const file = typeof src.fileName === "string" && src.fileName ? src.fileName : null;
    return file ? `Planilha · ${file}` : "Planilha";
  }
  if (src.source === "estagio") {
    if (src.funnelScope === "all") return "Todos os funis";
    const pid = typeof src.pipelineId === "string" ? src.pipelineId : plan.pipeline_id ?? null;
    const name = pid ? funnelName(pid) : undefined;
    return name ? `Funil · ${name}` : "Funil";
  }
  return null;
}

export interface BlastFigures {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  pending: number;
  /** % processado (enviados + ignorados + falhas) sobre o público. */
  pct: number;
}

/**
 * Os números do plano. Prefere a contagem por destinatário; enquanto ela não
 * chega, cai para a razão de lotes — a barra de um plano vivo nunca lê vazia.
 * `failed` (sent reclassificado pelo sync do poll, ADR-0016/#948) conta como
 * processado, mas nunca soma em "enviados".
 */
export function useBlastFigures(plan: BlastPlan, progress?: BlastPlanProgress): BlastFigures {
  return useMemo(() => {
    const total = progress?.total ?? plan.total_recipients ?? 0;
    const sent = progress?.sent ?? 0;
    const skipped = progress?.skipped ?? 0;
    const failed = progress?.failed ?? 0;
    const pending = progress?.pending ?? Math.max(0, total - sent - skipped - failed);
    const processed = sent + skipped + failed;
    const lotPct = plan.lots_total > 0 ? Math.round((plan.lots_released / plan.lots_total) * 100) : 0;
    const recipientPct = total > 0 ? Math.round((processed / total) * 100) : 0;
    return { total, sent, skipped, failed, pending, pct: progress ? recipientPct : lotPct };
  }, [progress, plan.total_recipients, plan.lots_total, plan.lots_released]);
}

/**
 * Controles do plano — pausar, retomar, editar (mensagem + horário) e cancelar
 * com confirmação. Devolve os handlers e os diálogos, que o chamador monta FORA
 * de qualquer área clicável (eventos React borbulham pela árvore mesmo com
 * portal: um clique no modal abriria o drill-down do cartão).
 */
export function useBlastPlanActions(plan: BlastPlan) {
  const control = useBlastPlanControl();
  const update = useUpdateBlastPlan();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editMessage, setEditMessage] = useState(plan.message);
  const [editTime, setEditTime] = useState(releaseTime(plan));

  const runControl = async (action: "pause" | "resume" | "cancel") => {
    try {
      await control.mutateAsync({ plan_id: plan.id, action });
      toast.success(
        action === "pause" ? "Disparo pausado" : action === "resume" ? "Disparo retomado" : "Disparo cancelado",
      );
    } catch (e) {
      toast.error((e as Error).message || "Não foi possível atualizar o disparo");
    }
  };

  const openEdit = () => {
    // Semeia o formulário com o valor atual do plano a cada abertura.
    setEditMessage(plan.message);
    setEditTime(releaseTime(plan));
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

  const dialogs = (
    <>
      {/* Editar — só mensagem e horário. O público é imutável (ADR-0003). */}
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

      {/* Cancelar — ação irreversível pede uma parada deliberada. */}
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

  return {
    pending: control.isPending,
    pause: () => runControl("pause"),
    resume: () => runControl("resume"),
    openEdit,
    askCancel: () => setConfirmCancel(true),
    dialogs,
  };
}
