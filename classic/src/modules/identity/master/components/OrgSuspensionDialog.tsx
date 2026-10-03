/**
 * OrgSuspensionDialog — confirmação de suspender / reativar uma organização.
 *
 * Existe porque suspender deixou de ser cosmético: agora corta acesso aos dados
 * (RLS), à API pública e ao motor de automação/IA/WhatsApp. E, quando a org tem
 * liberação de plano ativa, suspender REVOGA essa liberação — o master precisa
 * ver isso antes de clicar, não descobrir depois.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, PowerOff, Power } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface OrgSuspensionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  org: { id: string; name: string; billing_override: boolean } | null;
  /** true = suspender, false = reativar */
  suspend: boolean;
  pending?: boolean;
  onConfirm: (reason: string) => void;
}

const CONSEQUENCIAS = [
  "Todo mundo da org perde acesso aos dados — leads, funis, conversas. A tela vira o aviso de assinatura bloqueada.",
  "Chaves de API da org param de responder.",
  "O motor para: automações, disparo de WhatsApp e respostas do Copilot deixam de sair.",
  "Quem já estava logado continua autenticado, mas sem dado nenhum para ver.",
];

export function OrgSuspensionDialog({
  open,
  onOpenChange,
  org,
  suspend,
  pending = false,
  onConfirm,
}: OrgSuspensionDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!org) return null;

  const podeConfirmar = !pending && (!suspend || reason.trim().length >= 3);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {suspend ? (
              <PowerOff className="w-5 h-5 text-warning" />
            ) : (
              <Power className="w-5 h-5 text-success" />
            )}
            {suspend ? "Suspender" : "Reativar"} {org.name}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-sm">
              {suspend ? (
                <>
                  <ul className="space-y-1.5 text-muted-foreground">
                    {CONSEQUENCIAS.map((c) => (
                      <li key={c} className="flex gap-2">
                        <span className="text-muted-foreground/50 select-none">—</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>

                  {org.billing_override && (
                    <div className="flex gap-2.5 rounded-md border border-warning/30 bg-warning/10 p-3 text-warning-foreground">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
                      <p>
                        Esta org tem <strong>plano liberado</strong> (billing override).
                        Suspender revoga a liberação — sem isso a suspensão não bloqueia
                        nada. Reativar depois <strong>não</strong> devolve a liberação:
                        use “Liberar Plano” de novo.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">
                  A org volta para <strong>ativa</strong> e o acesso é restabelecido. A
                  liberação de plano <strong>não</strong> volta junto — se ela era
                  cortesia, libere o plano de novo depois.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {suspend && (
          <div className="space-y-2">
            <Label htmlFor="suspension-reason">Motivo</Label>
            <Textarea
              id="suspension-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: inadimplência há 60 dias, sem resposta do financeiro"
              rows={2}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Fica registrado no log de auditoria do Master, junto com a liberação revogada.
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={!podeConfirmar}
            onClick={(e) => {
              e.preventDefault();
              if (!podeConfirmar) return;
              onConfirm(reason.trim());
            }}
            className={
              suspend
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {pending ? "Aplicando…" : suspend ? "Suspender e cortar acesso" : "Reativar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
