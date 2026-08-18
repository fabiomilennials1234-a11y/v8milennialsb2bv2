/**
 * Configurações do ERP Toth.
 *
 * Duas coisas separam esta tela da do Omie e da do Tiny, e as duas vêm da forma
 * do Toth — não de gosto:
 *
 *  1. **O endereço é do cliente.** O Toth roda dentro da rede de cada empresa,
 *     então não há "conta" a conectar: há um servidor a apontar. O campo de
 *     endereço é o primeiro da tela e dá leitura imediata do que foi digitado.
 *
 *  2. **O tráfego pode ser sem TLS.** O endereço entregue pela Café Jurerê é
 *     `http://`. Em vez de aceitar em silêncio ou barrar de vez, a tela mostra o
 *     risco no momento em que ele aparece e exige um aceite explícito — e depois
 *     mantém o aviso visível enquanto durar, porque quem abre a tela meses depois
 *     não é necessariamente quem configurou.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Server,
  CheckCircle2,
  XCircle,
  Loader2,
  Link2,
  Unlink,
  Clock,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  Lock,
  Users,
  Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  useTothStatus,
  useConnectToth,
  useDisconnectToth,
  useSyncTothClientes,
  useSyncTothCobrancas,
  useUpdateTothSyncMode,
  readTothEndpoint,
  canSubmitTothConnection,
  TOTH_CAPABILITIES,
  type TothSyncMode,
} from "@/modules/integrations";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const SYNC_MODE_LABELS: Record<TothSyncMode, { label: string; hint: string }> = {
  off: {
    label: "Desligado",
    hint: "Mantém a conexão, mas não sincroniza dados de cliente.",
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

const PLACEHOLDER = "https://erp.suaempresa.com.br/toth/services";

/**
 * A lista sai do manifesto, não de texto solto: quando o fornecedor entregar o
 * endpoint de pedidos e `TOTH_CAPABILITIES.syncPedidos` virar `true`, a tela
 * acompanha sozinha. Duas listas separadas divergem — e a que mente é sempre a
 * da tela, porque ninguém a relê.
 */
const CAPABILITY_LINES = [
  { text: "Clientes do ERP, casados por CNPJ", live: TOTH_CAPABILITIES.syncClientes },
  { text: "Cobranças em aberto, pagas e atrasadas", live: TOTH_CAPABILITIES.receivables },
  { text: "Pedidos de venda", live: TOTH_CAPABILITIES.syncPedidos },
  { text: "Faturamento (NF-e)", live: TOTH_CAPABILITIES.fetchNfe },
];

export function TothSettings() {
  const [endpoint, setEndpoint] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedInsecure, setAcceptedInsecure] = useState(false);
  const [confirmCanonical, setConfirmCanonical] = useState(false);

  const { data: status, isLoading } = useTothStatus();
  const connect = useConnectToth();
  const disconnect = useDisconnectToth();
  const syncClientes = useSyncTothClientes();
  const syncCobrancas = useSyncTothCobrancas();
  const updateSyncMode = useUpdateTothSyncMode();

  const reading = readTothEndpoint(endpoint);
  const canSubmit = canSubmitTothConnection({ endpoint, user, password, acceptedInsecure });
  const isConnected = status?.connected ?? false;

  const handleConnect = async () => {
    if (!canSubmit) return;
    await connect.mutateAsync({
      baseUrl: endpoint.trim(),
      user: user.trim(),
      password,
      allowInsecureTransport: reading.insecure,
    });
    setEndpoint("");
    setUser("");
    setPassword("");
    setAcceptedInsecure(false);
  };

  // Cobranças são consultadas por CNPJ de cliente já casado, então a ordem
  // importa de verdade: sem clientes sincronizados, não há de quem cobrar.
  const handleSyncAll = async () => {
    await syncClientes.mutateAsync();
    await syncCobrancas.mutateAsync();
  };

  const handleSyncModeChange = (v: TothSyncMode) => {
    if (v === "canonical" && status?.erp_sync_mode !== "canonical") setConfirmCanonical(true);
    else updateSyncMode.mutate(v);
  };

  const isSyncing = syncClientes.isPending || syncCobrancas.isPending;
  const neverSyncedClients = !status?.last_clientes_sync_at;

  if (isLoading) {
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
        <div className="w-10 h-10 rounded-lg bg-sky-500/10 flex items-center justify-center">
          <Server className="w-5 h-5 text-sky-500" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold">Toth</h3>
          <p className="text-sm text-muted-foreground">
            ERP instalado no servidor da sua empresa
          </p>
        </div>
        <Badge variant={isConnected ? "default" : "secondary"} className="ml-auto shrink-0">
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

      {/* ─── Não conectado ─────────────────────────────────────────────── */}
      {!isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-2 border-dashed border-muted-foreground/25 rounded-xl p-6 space-y-4"
        >
          <div className="text-center space-y-2">
            <Server className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Aponte o Torque para o endereço do seu Toth e traga clientes e cobranças para a
              Carteira.
            </p>
          </div>

          {/* Endereço — o campo que não existe nos outros ERPs */}
          <div className="space-y-2">
            <Label htmlFor="toth-endpoint" className="text-xs">
              Endereço da API
            </Label>
            <Input
              id="toth-endpoint"
              type="url"
              inputMode="url"
              placeholder={PLACEHOLDER}
              value={endpoint}
              onChange={(e) => {
                setEndpoint(e.target.value);
                // Trocar o endereço invalida o aceite: quem consentiu com um
                // servidor sem TLS não consentiu com outro qualquer.
                setAcceptedInsecure(false);
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={reading.verdict === "invalido"}
              className={cn(
                reading.verdict === "invalido" && "border-destructive focus-visible:ring-destructive",
                reading.verdict === "inseguro" && "border-amber-500/60 focus-visible:ring-amber-500",
                reading.verdict === "ok" && "border-emerald-500/50",
              )}
            />
            {reading.verdict === "ok" && (
              <p className="text-[11px] text-emerald-500 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Conexão criptografada com {reading.host}
              </p>
            )}
            {reading.verdict === "invalido" && (
              <p className="text-[11px] text-destructive flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                {reading.message}
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="toth-user" className="text-xs">
                Usuário
              </Label>
              <Input
                id="toth-user"
                placeholder="Usuário da integração"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="toth-password" className="text-xs">
                Senha
              </Label>
              <Input
                id="toth-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                autoComplete="off"
              />
            </div>
          </div>

          {/* Aceite de tráfego sem TLS — aparece só quando o risco é real */}
          {reading.verdict === "inseguro" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2.5 overflow-hidden"
            >
              <p className="text-xs font-medium text-amber-500 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                Este endereço não usa criptografia
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {reading.message} Peça ao responsável pela rede um endereço{" "}
                <span className="font-medium text-foreground">https://</span> — um túnel reverso ou
                um proxy com certificado resolve sem abrir porta no firewall.
              </p>
              <label className="flex items-start gap-2 cursor-pointer group">
                <Checkbox
                  id="toth-accept-insecure"
                  checked={acceptedInsecure}
                  onCheckedChange={(v) => setAcceptedInsecure(v === true)}
                  className="mt-0.5 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                />
                <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
                  Entendo o risco e autorizo a conexão sem criptografia
                </span>
              </label>
            </motion.div>
          )}

          <Button onClick={handleConnect} disabled={!canSubmit || connect.isPending} className="w-full">
            {connect.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Testando o acesso ao ERP...
              </>
            ) : (
              <>
                <Link2 className="w-4 h-4 mr-2" />
                Validar e Conectar
              </>
            )}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            O Torque faz um login de teste antes de salvar. As credenciais ficam criptografadas e
            nunca voltam ao navegador.
          </p>
        </motion.div>
      )}

      {/* ─── Conectado ─────────────────────────────────────────────────── */}
      {isConnected && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Aviso permanente — não some depois do dia da configuração */}
          {status?.insecure_transport && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-amber-500">Conexão sem criptografia</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Este ERP responde em <code className="text-foreground">http://</code>, então a
                  senha e o token trafegam em texto claro. Assim que houver um endereço{" "}
                  <span className="text-foreground">https://</span>, reconecte usando ele.
                </p>
              </div>
            </div>
          )}

          <div className="bg-muted/30 rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate" title={status?.base_url ?? undefined}>
                  {status?.base_url ?? "Toth"}
                </p>
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
                    className="text-destructive hover:text-destructive shrink-0"
                  >
                    <Unlink className="w-3.5 h-3.5 mr-1.5" />
                    Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar o Toth?</AlertDialogTitle>
                    <AlertDialogDescription>
                      A sincronização para e as credenciais são apagadas do cofre. Os clientes e as
                      cobranças já trazidos para a Carteira não são afetados.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => disconnect.mutate()}
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
                <span className="break-words">{status.last_error}</span>
              </div>
            )}
          </div>

          {/* Sincronização — a ordem é parte da informação */}
          <div className="space-y-3">
            <Button variant="outline" className="w-full" onClick={handleSyncAll} disabled={isSyncing}>
              {isSyncing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Sincronizar agora
            </Button>

            <div className="grid gap-2 sm:grid-cols-2">
              <SyncRow
                icon={<Users className="w-3.5 h-3.5" />}
                label="Clientes"
                at={status?.last_clientes_sync_at ?? null}
                busy={syncClientes.isPending}
                onRun={() => syncClientes.mutate()}
                disabled={isSyncing}
              />
              <SyncRow
                icon={<Receipt className="w-3.5 h-3.5" />}
                label="Cobranças"
                at={status?.last_cobrancas_sync_at ?? null}
                busy={syncCobrancas.isPending}
                onRun={() => syncCobrancas.mutate()}
                disabled={isSyncing || neverSyncedClients}
                note={
                  neverSyncedClients
                    ? "Sincronize os clientes primeiro — as cobranças são buscadas por CNPJ."
                    : undefined
                }
              />
            </div>
          </div>

          {/* Modo de sincronização */}
          <div className="space-y-2 border-t pt-4">
            <Label className="text-sm">Modo de sincronização de cliente</Label>
            <Select
              value={status?.erp_sync_mode ?? "enrich_only"}
              onValueChange={(v) => handleSyncModeChange(v as TothSyncMode)}
              disabled={updateSyncMode.isPending}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SYNC_MODE_LABELS) as TothSyncMode[]).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {SYNC_MODE_LABELS[mode].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p
              className={cn(
                "text-[11px]",
                status?.erp_sync_mode === "canonical"
                  ? "text-amber-500 flex items-start gap-1"
                  : "text-muted-foreground",
              )}
            >
              {status?.erp_sync_mode === "canonical" && (
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              )}
              {SYNC_MODE_LABELS[status?.erp_sync_mode ?? "enrich_only"].hint}
            </p>
          </div>

          <AlertDialog open={confirmCanonical} onOpenChange={setConfirmCanonical}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Ativar modo ERP canônico?</AlertDialogTitle>
                <AlertDialogDescription>
                  O ERP passa a{" "}
                  <strong>
                    sobrescrever nome, telefone, e-mail e empresa de TODOS os clientes
                  </strong>{" "}
                  da carteira com o dado do Toth, e <strong>cria leads-stub</strong> para clientes
                  do ERP que ainda não existem no CRM. A curadoria feita pela equipe é substituída.{" "}
                  <strong>Não há como desfazer.</strong>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    updateSyncMode.mutate("canonical");
                    setConfirmCanonical(false);
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Ativar canônico
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* O que entra, e o que ainda não dá para saber */}
          <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-3 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-sky-500">O que o Toth traz para a Carteira:</p>
            <ul className="space-y-1">
              {CAPABILITY_LINES.map((line) => (
                <li key={line.text} className="flex items-start gap-1.5">
                  <span className={line.live ? "text-sky-500" : "text-muted-foreground/40"}>•</span>
                  <span className={line.live ? "" : "text-muted-foreground/60"}>
                    {line.text}
                    {!line.live && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/50">
                        · falta o endpoint no ERP
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] leading-relaxed border-t border-sky-500/15 pt-2">
              <span className="text-foreground">Limitação atual do ERP:</span> o retorno de
              cobranças não informa a data do pagamento, só o valor pago. Por isso um pagamento
              parcial continua aparecendo como em aberto, e ainda não é possível medir prazo médio
              de recebimento.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function SyncRow({
  icon,
  label,
  at,
  busy,
  onRun,
  disabled,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  at: string | null;
  busy: boolean;
  onRun: () => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={onRun}
          disabled={disabled || busy}
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Sincronizar"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {at
          ? formatDistanceToNow(new Date(at), { addSuffix: true, locale: ptBR })
          : "Nunca sincronizado"}
      </p>
      {note && <p className="text-[11px] text-amber-500/80 leading-snug">{note}</p>}
    </div>
  );
}
