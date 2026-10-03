/**
 * Status do pedido no TinyERP
 *
 * Exibe se um pedido foi enviado para o TinyERP, número do pedido,
 * status da NF-e, link para download do PDF e permite envio manual.
 */

import { Database, Send, CheckCircle2, Loader2, FileText, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTinyErpStatus, useTinyErpOrderMapping, useTinyErpPushOrder, useTinyErpFetchNfe } from "@/modules/carteira/hooks/useTinyErp";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface TinyErpOrderStatusProps {
  pipePropostaId: string;
}

const nfeStatusLabels: Record<string, string> = {
  autorizada: "Autorizada",
  cancelada: "Cancelada",
  denegada: "Denegada",
  pendente: "Pendente",
};

export function TinyErpOrderStatus({ pipePropostaId }: TinyErpOrderStatusProps) {
  const { data: tinyStatus } = useTinyErpStatus();
  const { data: orderMapping, isLoading } = useTinyErpOrderMapping(pipePropostaId);
  const pushOrder = useTinyErpPushOrder();
  const fetchNfe = useTinyErpFetchNfe();

  // Don't render if TinyERP not connected
  if (!tinyStatus?.connected) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Verificando TinyERP...
      </div>
    );
  }

  // Order already pushed
  if (orderMapping) {
    const hasNfeLink = !!orderMapping.nfe_link;
    const hasNfeId = !!orderMapping.tiny_nfe_id;
    const nfeStatus = orderMapping.nfe_status || orderMapping.tiny_nfe_status;

    return (
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="w-4 h-4 text-blue-500" />
            TinyERP
          </div>
          <Badge variant="default" className="text-[10px]">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Enviado
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          {orderMapping.tiny_order_number && (
            <div>
              <span className="font-medium">Pedido:</span> #{orderMapping.tiny_order_number}
            </div>
          )}
          {(hasNfeId || nfeStatus) && (
            <div className="flex items-center gap-1">
              <FileText className="w-3 h-3" />
              <span className="font-medium">NF-e:</span>{" "}
              {orderMapping.nfe_numero ? `#${orderMapping.nfe_numero} — ` : ""}
              {nfeStatusLabels[nfeStatus || ""] || nfeStatus || "—"}
            </div>
          )}
          {orderMapping.last_synced_at && (
            <div>
              Atualizado {formatDistanceToNow(new Date(orderMapping.last_synced_at), { addSuffix: true, locale: ptBR })}
            </div>
          )}
        </div>

        {/* NF-e actions */}
        <div className="flex gap-2">
          {hasNfeLink && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => window.open(orderMapping.nfe_link!, "_blank")}
            >
              <Download className="w-3 h-3 mr-1" />
              Baixar NF-e
            </Button>
          )}
          {orderMapping.tiny_order_id && !hasNfeLink && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() =>
                fetchNfe.mutate({
                  tinyOrderId: orderMapping.tiny_order_id!,
                  idNotaFiscal: orderMapping.tiny_nfe_id || undefined,
                })
              }
              disabled={fetchNfe.isPending}
            >
              {fetchNfe.isPending ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3 mr-1" />
              )}
              Buscar NF-e
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Order not pushed yet — show manual push button
  return (
    <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Database className="w-4 h-4" />
        TinyERP
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => pushOrder.mutate(pipePropostaId)}
        disabled={pushOrder.isPending}
      >
        {pushOrder.isPending ? (
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
        ) : (
          <Send className="w-3.5 h-3.5 mr-1.5" />
        )}
        Enviar Pedido
      </Button>
    </div>
  );
}
