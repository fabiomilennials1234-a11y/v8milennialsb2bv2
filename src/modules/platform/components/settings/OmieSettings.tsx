/**
 * Configurações do ERP Omie.
 *
 * Conecta/desconecta via app_key + app_secret e escolhe o modo de reconciliação
 * de cliente (erp_sync_mode). Sync de dados e camada financeira chegam nas fases
 * seguintes (ADR-0020). O ERP é a fonte da verdade do dinheiro; o CRM, da relação.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Landmark,
  CheckCircle2,
  XCircle,
  Loader2,
  Link2,
  Unlink,
  Clock,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  useOmieStatus,
  useConnectOmie,
  useDisconnectOmie,
  useSyncOmieClientes,
  useSyncOmiePedidos,
  useUpdateOmieSyncMode,
  useErpProvider,
  type OmieSyncMode,
} from "@/modules/integrations";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const SYNC_MODE_LABELS: Record<OmieSyncMode, { label: string; hint: string }> = {
  off: {
    label: "Desligado",
    hint: "Conecta, mas não sincroniza dados de cliente.",
  },
  enrich_only: {
    label: "Enriquecer (recomendado)",
    hint: "O ERP só preenche campos vazios. Nome, responsável e tags do CRM nunca são sobrescritos.",
  },
  canonical: {
    label: "ERP canônico",
    hint: "O ERP sobrescreve os campos do cliente no CRM. Use só se confia mais no dado do ERP.",
  },
};

export function OmieSettings() {
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");

  const { data: status, isLoading, isFetching } = useOmieStatus();
  const connectOmie = useConnectOmie();
  const disconnectOmie = useDisconnectOmie();
  const syncClientes = useSyncOmieClientes();
  const syncPedidos = useSyncOmiePedidos();
  const updateSyncMode = useUpdateOmieSyncMode();
  const erp = useErpProvider();

  const isSyncing = syncClientes.isPending || syncPedidos.isPending;
  const handleSync = async () => {
    // Clientes primeiro — pedidos casam com clientes já sincronizados.
    await syncClientes.mutateAsync();
    await syncPedidos.mutateAsync();
  };

  const showLoading = isLoading || isFetching;
  const isConnected = status?.connected ?? false;

  const handleConnect = async () => {
    if (!appKey.trim() || !appSecret.trim()) return;
    await connectOmie.mutateAsync({ appKey: appKey.trim(), appSecret: appSecret.trim() });
    setAppKey("");
    setAppSecret("");
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
        <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
          <Landmark className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <h3 className="font-semibold">Omie</h3>
          <p className="text-sm text-muted-foreground">
            Traz faturamento e contas a receber do ERP para a Carteira
          </p>
        </div>
        <Badge variant={isConnected ? "default" : "secondary"} className="ml-auto">
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

      {/* Not connected */}
      {!isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-2 border-dashed border-muted-foreground/25 rounded-xl p-6 space-y-4"
        >
          <div className="text-center space-y-2">
            <Landmark className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Conecte sua conta Omie para trazer clientes, pedidos, notas fiscais e inadimplência para a Carteira.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="omie-app-key" className="text-xs">
              App Key
            </Label>
            <Input
              id="omie-app-key"
              type="password"
              placeholder="Cole aqui a App Key do seu app Omie..."
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="omie-app-secret" className="text-xs">
              App Secret
            </Label>
            <Input
              id="omie-app-secret"
              type="password"
              placeholder="Cole aqui o App Secret..."
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">
              Gere um app em Omie &gt; Painel do Desenvolvedor &gt; Minhas Aplicações. As credenciais ficam criptografadas e nunca voltam ao navegador.
            </p>
          </div>

          <Button
            onClick={handleConnect}
            disabled={!appKey.trim() || !appSecret.trim() || connectOmie.isPending}
            className="w-full"
          >
            {connectOmie.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Validando com a Omie...
              </>
            ) : (
              <>
                <Link2 className="w-4 h-4 mr-2" />
                Validar e Conectar
              </>
            )}
          </Button>
        </motion.div>
      )}

      {/* Connected */}
      {isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Connection info */}
          <div className="bg-muted/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{status?.account_name || "Omie"}</p>
                {status?.connected_at && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" />
                    Conectado{" "}
                    {formatDistanceToNow(new Date(status.connected_at), {
                      addSuffix: true,
                      locale: ptBR,
                    })}
                  </p>
                )}
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                  >
                    <Unlink className="w-3.5 h-3.5 mr-1.5" />
                    Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar o Omie?</AlertDialogTitle>
                    <AlertDialogDescription>
                      A sincronização será desativada e as credenciais serão removidas. Os dados já
                      trazidos para a Carteira não são afetados.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => disconnectOmie.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Desconectar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            {status?.last_error && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg p-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{status.last_error}</span>
              </div>
            )}
          </div>

          {/* On-demand sync */}
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSync}
              disabled={isSyncing}
            >
              {isSyncing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Sincronizar agora
            </Button>
            {status?.last_clientes_sync_at && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />
                Clientes:{" "}
                {formatDistanceToNow(new Date(status.last_clientes_sync_at), {
                  addSuffix: true,
                  locale: ptBR,
                })}
              </p>
            )}
            {status?.last_pedidos_sync_at && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />
                Pedidos:{" "}
                {formatDistanceToNow(new Date(status.last_pedidos_sync_at), {
                  addSuffix: true,
                  locale: ptBR,
                })}
              </p>
            )}
          </div>

          {/* Sync mode */}
          <div className="space-y-2 border-t pt-4">
            <Label className="text-sm">Modo de sincronização de cliente</Label>
            <Select
              value={status?.erp_sync_mode ?? "enrich_only"}
              onValueChange={(v) => updateSyncMode.mutate(v as OmieSyncMode)}
              disabled={updateSyncMode.isPending}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SYNC_MODE_LABELS) as OmieSyncMode[]).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {SYNC_MODE_LABELS[mode].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {SYNC_MODE_LABELS[status?.erp_sync_mode ?? "enrich_only"].hint}
            </p>
          </div>

          {/* Info box — the money layer */}
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 text-xs text-muted-foreground">
            <p className="font-medium text-amber-500 mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />O que o Omie traz para a Carteira:
            </p>
            <ul className="space-y-1">
              {[
                { text: "Clientes e pedidos do ERP, casados por CNPJ", live: true },
                { text: "Faturamento (NF-e) — separa o vendido do faturado", live: erp.can("fetchNfe") },
                { text: "Títulos e contas a receber — pago, aberto, atrasado", live: erp.can("receivables") },
                { text: "Inadimplência e receita em risco por cliente", live: erp.can("receivables") },
              ].map((f) => (
                <li key={f.text} className="flex items-start gap-1.5">
                  <span className={f.live ? "text-amber-500" : "text-muted-foreground/40"}>•</span>
                  <span className={f.live ? "" : "text-muted-foreground/60"}>
                    {f.text}
                    {!f.live && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/50">
                        · em breve
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      )}
    </div>
  );
}
