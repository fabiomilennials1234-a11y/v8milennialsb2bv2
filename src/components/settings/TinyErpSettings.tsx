/**
 * Componente de configurações do TinyERP
 *
 * Permite conectar/desconectar o TinyERP via API Token,
 * sincronizar produtos e configurar automações.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Database,
  CheckCircle2,
  XCircle,
  Loader2,
  Link2,
  Unlink,
  RefreshCw,
  Clock,
  Package,
  ShoppingCart,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useTinyErpStatus,
  useConnectTinyErp,
  useDisconnectTinyErp,
  useTinyErpSyncProducts,
  useTinyErpSyncLogs,
  useUpdateTinyErpSettings,
} from "@/modules/carteira/hooks/useTinyErp";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const operationLabels: Record<string, string> = {
  product_import: "Importação de Produtos",
  product_sync: "Sincronização de Produtos",
  order_push: "Envio de Pedido",
  order_status_update: "Status do Pedido",
  contact_sync: "Sincronização de Contatos",
  connection_test: "Teste de Conexão",
  webhook_received: "Webhook Recebido",
};

const statusBadges: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  success: { label: "Sucesso", variant: "default" },
  failed: { label: "Falhou", variant: "destructive" },
  pending: { label: "Pendente", variant: "outline" },
  partial: { label: "Parcial", variant: "secondary" },
};

export function TinyErpSettings() {
  const [apiToken, setApiToken] = useState("");

  const { data: status, isLoading, isFetching } = useTinyErpStatus();
  const connectTinyErp = useConnectTinyErp();
  const disconnectTinyErp = useDisconnectTinyErp();
  const syncProducts = useTinyErpSyncProducts();
  const updateSettings = useUpdateTinyErpSettings();
  const { data: syncLogs = [] } = useTinyErpSyncLogs(10);

  const showLoading = isLoading || isFetching;
  const isConnected = status?.connected ?? false;

  const handleConnect = async () => {
    if (!apiToken.trim()) return;
    await connectTinyErp.mutateAsync(apiToken.trim());
    setApiToken("");
  };

  if (showLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <Database className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h3 className="font-semibold">TinyERP</h3>
          <p className="text-sm text-muted-foreground">
            Sincronize produtos e envie pedidos automaticamente
          </p>
        </div>
        <Badge
          variant={isConnected ? "default" : "secondary"}
          className="ml-auto"
        >
          {isConnected ? (
            <>
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Conectado
            </>
          ) : (
            <>
              <XCircle className="w-3 h-3 mr-1" />
              Desconectado
            </>
          )}
        </Badge>
      </div>

      {/* Not Connected State */}
      {!isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-2 border-dashed border-muted-foreground/25 rounded-xl p-6 space-y-4"
        >
          <div className="text-center space-y-2">
            <Database className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Conecte seu TinyERP para sincronizar produtos e enviar pedidos automaticamente.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tinyerp-token" className="text-xs">
              Token de API do TinyERP
            </Label>
            <Input
              id="tinyerp-token"
              type="password"
              placeholder="Cole aqui o token da API do TinyERP..."
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            />
            <p className="text-[11px] text-muted-foreground">
              Encontre seu token em TinyERP &gt; Configuracoes &gt; Geral &gt; Token da API
            </p>
          </div>

          <Button
            onClick={handleConnect}
            disabled={!apiToken.trim() || connectTinyErp.isPending}
            className="w-full"
          >
            {connectTinyErp.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Testando conexao...
              </>
            ) : (
              <>
                <Link2 className="w-4 h-4 mr-2" />
                Testar e Conectar
              </>
            )}
          </Button>
        </motion.div>
      )}

      {/* Connected State */}
      {isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Connection Info */}
          <div className="bg-muted/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{status?.account_name || "TinyERP"}</p>
                {status?.cnpj && (
                  <p className="text-xs text-muted-foreground">CNPJ: {status.cnpj}</p>
                )}
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                    <Unlink className="w-3.5 h-3.5 mr-1.5" />
                    Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar TinyERP?</AlertDialogTitle>
                    <AlertDialogDescription>
                      A sincronizacao de produtos e envio automatico de pedidos serao desativados.
                      Os dados ja sincronizados nao serao afetados.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => disconnectTinyErp.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Desconectar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            {status?.connected_at && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Conectado {formatDistanceToNow(new Date(status.connected_at), { addSuffix: true, locale: ptBR })}
              </p>
            )}

            {status?.last_error && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg p-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{status.last_error}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={() => syncProducts.mutate()}
              disabled={syncProducts.isPending}
            >
              {syncProducts.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Package className="w-4 h-4 mr-2" />
              )}
              Sincronizar Produtos
            </Button>
          </div>

          {/* Sync last time */}
          {status?.last_product_sync_at && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />
              Ultima sincronizacao de produtos: {formatDistanceToNow(new Date(status.last_product_sync_at), { addSuffix: true, locale: ptBR })}
            </p>
          )}

          {/* Settings Toggles */}
          <div className="space-y-4 border-t pt-4">
            <h4 className="text-sm font-medium">Automacoes</h4>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                  Enviar pedidos automaticamente
                </Label>
                <p className="text-xs text-muted-foreground">
                  Ao fechar uma venda (status "vendido"), cria o pedido no TinyERP
                </p>
              </div>
              <Switch
                checked={status?.auto_push_orders ?? false}
                onCheckedChange={(checked) => updateSettings.mutate({ auto_push_orders: checked })}
              />
            </div>
          </div>

          {/* Sync History */}
          {syncLogs.length > 0 && (
            <div className="space-y-3 border-t pt-4">
              <h4 className="text-sm font-medium">Historico de Sincronizacao</h4>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {syncLogs.map((log) => {
                  const badge = statusBadges[log.status] || statusBadges.pending;
                  return (
                    <div key={log.id} className="flex items-center justify-between text-xs bg-muted/30 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={badge.variant} className="text-[10px] px-1.5 py-0">
                          {badge.label}
                        </Badge>
                        <span className="text-muted-foreground">
                          {operationLabels[log.operation] || log.operation}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        {(log.items_created > 0 || log.items_updated > 0) && (
                          <span>
                            {log.items_created > 0 && `+${log.items_created}`}
                            {log.items_created > 0 && log.items_updated > 0 && " / "}
                            {log.items_updated > 0 && `~${log.items_updated}`}
                          </span>
                        )}
                        <span>
                          {formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: ptBR })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Info Box */}
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 text-xs text-muted-foreground">
            <p className="font-medium text-blue-500 mb-1">O que a integracao faz:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Importa produtos do TinyERP para o catalogo do CRM</li>
              <li>Envia pedidos automaticamente ao fechar uma venda</li>
              <li>Acompanha status de NF-e emitidas</li>
            </ul>
          </div>
        </motion.div>
      )}
    </div>
  );
}
