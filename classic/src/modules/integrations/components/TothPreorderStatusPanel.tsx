import { RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useTothPreorder, TothPreorderReadError } from "../hooks/useTothPreorder";
import { getTothPreorderStatus } from "../lib/toth-preorder-status";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function TothPreorderStatusPanel({ dealId }: { dealId: string }) {
  const { query, enabled } = useTothPreorder(dealId);
  if (!enabled) return null;

  // React Query retains cached data on a failed refetch. Never display that
  // cached operation after access is revoked, or present it as current on error.
  if (query.error) {
    const denied = query.error instanceof TothPreorderReadError && query.error.kind === "access_denied";
    return (
      <Alert>
        <AlertTitle>Situação do pré-pedido indisponível</AlertTitle>
        <AlertDescription>{denied ? "Você não tem acesso à situação deste pré-pedido." : "Não foi possível confirmar a situação atual do pré-pedido."}</AlertDescription>
        {!denied && <Button type="button" variant="outline" className="mt-3" disabled={query.isFetching} onClick={() => void query.refetch()}>
          Atualizar situação
        </Button>}
      </Alert>
    );
  }

  const operation = query.data?.operation;
  if (!operation) return null;
  const status = getTothPreorderStatus(operation);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Situação do pré-pedido</CardTitle>
        <CardDescription>{status.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Situação informada pelo ERP">
          <Badge variant={status.destructive ? "destructive" : "secondary"}>{status.label}</Badge>
          {status.secondaryLabel && <Badge variant="outline">{status.secondaryLabel}</Badge>}
        </div>
        {status.localNotice && <Alert><AlertDescription>{status.localNotice}</AlertDescription></Alert>}
        <dl className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
          {operation.external_id && <div><dt className="text-muted-foreground">Código no ERP</dt><dd>{operation.external_id}</dd></div>}
          <div><dt className="text-muted-foreground">Versão do rascunho</dt><dd>{operation.draft_revision}</dd></div>
          {status.approvalConfirmed && operation.approved_total != null && <div>
            <dt className="text-muted-foreground">Total aprovado no ERP</dt><dd>{currency.format(operation.approved_total)}</dd>
          </div>}
          <div><dt className="text-muted-foreground">Última atualização registrada</dt><dd>{new Date(operation.updated_at).toLocaleString("pt-BR")}</dd></div>
        </dl>
      </CardContent>
      <CardFooter>
        <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw data-icon="inline-start" />{query.isFetching ? "Atualizando…" : "Atualizar situação"}
        </Button>
      </CardFooter>
    </Card>
  );
}
