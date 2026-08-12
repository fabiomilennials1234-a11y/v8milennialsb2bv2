/**
 * PaymentLinksList — as propostas já geradas, com estado e revogação.
 *
 * NÃO MOSTRA COMPRADOR. Nome, documento e e-mail moram em
 * `payment_link_buyers`, fechada por REVOKE de `anon`, `authenticated` e
 * `service_role`. Abrir uma porta master-gated só para esta lista recriaria a
 * superfície que a fatia do comprador fechou — e por uma LISTA, que carregaria
 * PII de N propostas toda vez que a tela abrisse. Decisão fechada com quem é
 * dono da tabela.
 *
 * O ESTADO É DERIVADO, com precedência: pago vence revogado, revogado vence
 * expirado. Link pago e depois revogado continua PAGO — o dinheiro entrou, e
 * exibir "revogado" mandaria alguém procurar um pagamento que existe.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  usePaymentLinks,
  useRevokePaymentLink,
  linkState,
  type PaymentLinkRow,
  type PaymentLinkState,
} from "@/modules/billing";
import { useMasterOrganizations } from "../hooks/useMasterOrganizations";

const STATE_LABEL: Record<PaymentLinkState, string> = {
  paid: "Pago",
  revoked: "Revogada",
  expired: "Expirada",
  active: "Ativa",
};

const STATE_VARIANT: Record<PaymentLinkState, "default" | "secondary" | "outline" | "destructive"> = {
  paid: "default",
  revoked: "destructive",
  expired: "secondary",
  active: "outline",
};

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function PaymentLinksList() {
  const { data: links, isLoading } = usePaymentLinks();
  const { data: orgs } = useMasterOrganizations();
  const revoke = useRevokePaymentLink();
  const [revoking, setRevoking] = useState<PaymentLinkRow | null>(null);
  const [reason, setReason] = useState("");

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!links?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma proposta gerada ainda.
      </p>
    );
  }

  function targetLabel(row: PaymentLinkRow): string {
    if (row.target_kind === "new_org") return row.new_org_name ?? "(organização nova)";
    return orgs?.find((o) => o.id === row.organization_id)?.name ?? "(organização)";
  }

  return (
    <>
      <div className="space-y-2">
        {links.map((row) => {
          const state = linkState(row);
          return (
            <div
              key={row.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{targetLabel(row)}</p>
                  <Badge variant={STATE_VARIANT[state]}>{STATE_LABEL[state]}</Badge>
                  {row.manual_discount_cents ? (
                    <Badge variant="outline" className="text-warning border-warning/40">
                      desconto {brl(row.manual_discount_cents)}/mês
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {brl(row.amount_cents)} · gerada em {dateLabel(row.created_at)} · vence{" "}
                  {dateLabel(row.expires_at)}
                </p>
                {row.manual_discount_reason && (
                  <p className="text-xs text-muted-foreground truncate">
                    Motivo: {row.manual_discount_reason}
                  </p>
                )}
              </div>

              {state === "active" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRevoking(row);
                    setReason("");
                  }}
                >
                  Revogar
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revogar proposta</DialogTitle>
            <DialogDescription>
              O link deixa de resolver na hora. A linha permanece — revogação é estado, não
              deleção, e o histórico da proposta sobrevive.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="revoke-reason">Motivo</Label>
            <Input
              id="revoke-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: preço renegociado"
            />
            <p className="text-xs text-muted-foreground">
              Vai para a auditoria com o seu nome. Sem motivo, seis meses depois ninguém sabe se
              foi engano de preço ou desistência do cliente.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || revoke.isPending}
              onClick={async () => {
                if (!revoking) return;
                await revoke.mutateAsync({ linkId: revoking.id, reason: reason.trim() });
                setRevoking(null);
              }}
            >
              {revoke.isPending ? "Revogando…" : "Revogar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
