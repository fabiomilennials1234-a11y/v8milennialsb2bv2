/**
 * Confirmação do movimento livre do master no kanban da Operação (emenda ao
 * ADR-0018). Três perguntas, uma por destino que muda o que o cliente vê:
 *
 * - Concluído: o cliente não é avisado e só o master reabre.
 * - Aguardando confirmação: enviar a resposta pronta (lida aqui, antes) e
 *   marcar resolvido, OU só mudar o estado.
 * - Sair de Concluído: reabrir um chamado fechado.
 *
 * Os demais movimentos são diretos — sem diálogo.
 */

import { AlertTriangle, MessageSquareReply, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { OPERACAO_COLUMN_LABELS, type OperacaoMove } from "../../lib/operacao-kanban";

export interface PendingMove {
  ticketId: string;
  ticketTitle: string;
  move: OperacaoMove;
  /** A resposta pronta do diagnóstico, já sem espaços nas pontas. `null` = não há. */
  reply: string | null;
}

interface Props {
  pending: PendingMove | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (opts: { sendReply: boolean }) => void;
}

export function OperacaoMoveDialog({ pending, busy, onCancel, onConfirm }: Props) {
  const confirm = pending?.move.confirm ?? null;

  return (
    <AlertDialog open={!!pending && !!confirm} onOpenChange={(v) => !v && !busy && onCancel()}>
      <AlertDialogContent className="max-w-lg">
        {pending && confirm === "fechar" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
                Concluir o chamado?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-foreground">{pending.ticketTitle}</p>
                  <p>O cliente não será avisado. O chamado fecha e só o master consegue reabrir.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
              <Button disabled={busy} onClick={() => onConfirm({ sendReply: false })}>
                {busy ? "Concluindo…" : "Confirmar"}
              </Button>
            </AlertDialogFooter>
          </>
        )}

        {pending && confirm === "reabrir" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-muted-foreground" aria-hidden />
                Reabrir chamado fechado?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-foreground">{pending.ticketTitle}</p>
                  <p>
                    O chamado volta para {OPERACAO_COLUMN_LABELS[pending.move.landsIn]}. O cliente não é avisado e
                    isso não conta como reabertura dele.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
              <Button disabled={busy} onClick={() => onConfirm({ sendReply: false })}>
                {busy ? "Reabrindo…" : "Reabrir chamado"}
              </Button>
            </AlertDialogFooter>
          </>
        )}

        {pending && confirm === "resposta" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Marcar como resolvido</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm">
                  <p className="font-medium text-foreground">{pending.ticketTitle}</p>
                  {pending.reply ? (
                    <>
                      <p>Esta é a resposta que o cliente vai receber:</p>
                      <blockquote
                        className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/40 p-3 text-foreground"
                        aria-label="Resposta que será enviada ao cliente"
                      >
                        {pending.reply}
                      </blockquote>
                    </>
                  ) : (
                    <p>Sem resposta pronta no diagnóstico: dá para só mudar o estado.</p>
                  )}
                  <p>Resolvido fecha sozinho em 7 dias se o cliente não reabrir.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:space-x-0">
              <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
              <Button variant="outline" disabled={busy} onClick={() => onConfirm({ sendReply: false })}>
                Só mudar o estado, sem enviar
              </Button>
              <Button
                className="gap-1.5"
                disabled={busy || !pending.reply}
                onClick={() => onConfirm({ sendReply: true })}
              >
                <MessageSquareReply className="h-4 w-4" aria-hidden />
                Enviar resposta ao cliente e marcar resolvido
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
