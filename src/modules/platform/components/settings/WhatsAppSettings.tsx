import { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Plus,
  Trash2,
  RefreshCw,
  QrCode,
  CheckCircle2,
  XCircle,
  Loader2,
  LogOut,
  Users,
  Activity,
  Phone,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  useWhatsAppInstances,
  useCreateWhatsAppInstance,
  useRefreshQRCode,
  useCheckConnectionStatus,
  useDeleteWhatsAppInstance,
  useLogoutInstance,
  WhatsAppInstance,
} from "@/modules/communication/hooks/useWhatsAppInstances";
import {
  WhatsAppProviderChooser,
  getProviderProfile,
  useConnectWhatsAppCloud,
  useConnectNotificame,
  NotificameOperacaoCard,
  NotificameTemplatesCard,
} from "@/modules/communication";
import { useFeatureFlag } from "../../hooks/useFeatureFlag";
import { useCanManageWhatsApp, useIdentity } from "@/modules/identity";
import { useTeamMembers } from "@/modules/identity";
import {
  useAllowedMembersForInstance,
  useSetAllowedMembersForInstance,
} from "@/modules/communication/hooks/useWhatsAppInstanceAllowedMembers";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useOrgQuotas } from "@/modules/identity";
import { useMessageLimits } from "@/modules/communication/hooks/useMessageLimits";
import { HistorySyncPanel } from "@/modules/communication/components/chat/history-sync/HistorySyncPanel";
import { formatPhoneBR } from "@/shared/format/phone";
import { toast } from "sonner";

/**
 * Derives effective instance status from `status` + `session_dead_since`.
 *
 * `whatsapp_instances.status` is updated by provider webhooks. When a WhatsApp
 * account is scanned on a different device, Uazapi/Evolution never fires the
 * disconnect webhook, so `status` stays frozen on "connected" indefinitely.
 *
 * `session_dead_since` is the source of truth — populated by the
 * `whatsapp-session-watchdog` cron, which actively polls the provider every
 * 10 min. When set, the session is dead regardless of what `status` says.
 *
 * Until the watchdog backfills `status` itself, this UI-side derivation keeps
 * the settings page in sync with the global red SessionDeadBanner.
 */
export function deriveInstanceStatus(
  instance: Pick<WhatsAppInstance, "status" | "session_dead_since">,
): string {
  if (instance.session_dead_since) return "disconnected";
  return instance.status ?? "disconnected";
}

/**
 * Exported for `tests/unit/whatsapp-qr-modal-rotation.test.tsx`, which drives it
 * through a live pairing window and asserts the rendered QR follows the
 * provider's rotation. That is the one property whose absence produced the
 * "Escaneie o QR code novamente" screen on the customer's phone, and it is not
 * observable from the hook alone — it lives in this component's state wiring.
 */
export function QRCodeModal({
  instanceId,
  instances,
  isOpen,
  onClose,
}: {
  instanceId: string | null;
  instances: WhatsAppInstance[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const refreshQR = useRefreshQRCode();
  const checkStatus = useCheckConnectionStatus();
  const [pairCode, setPairCode] = useState<string | null>(null);
  // The QR the user is actually looking at. Held here, not in the row: the
  // provider rotates it every ~20s and `whatsapp_instances` is SELECT-able by
  // every member of the org, so a continuously-refreshed stored code would be a
  // live pairing credential sitting in a table a non-admin can read. Transient
  // state is both the safer and the simpler home for it.
  const [liveQr, setLiveQr] = useState<string | null>(null);
  const [pairMode, setPairMode] = useState<"qr" | "code">("qr");
  const [phoneInput, setPhoneInput] = useState("");
  const [, setIsChecking] = useState(false);

  // Always read fresh data from the query cache via instances prop
  const instance = instances.find((i) => i.id === instanceId) ?? null;

  const effectiveStatus = instance ? deriveInstanceStatus(instance) : null;

  // Tracks which (instance, mode) pairing we have already kicked off, so the
  // effect below runs once per opening instead of on every re-render.
  const kickedRef = useRef<string | null>(null);

  // Ask the provider to (re)start pairing when the modal opens.
  //
  // The guard here used to be `!instance.qr_code`, which made this a one-shot
  // for the lifetime of the row: `useCreateWhatsAppInstance` already stores a QR
  // at creation time, so on every subsequent open the condition was false and we
  // rendered that original code — by then long dead — with no way for the user to
  // tell. Keying off the instance instead means opening the modal always starts a
  // live pairing attempt; the 3s poll below then keeps the displayed code in step
  // with the provider's ~20s rotation.
  useEffect(() => {
    if (!isOpen || !instance?.id) return;
    if (effectiveStatus === "connected" || pairMode !== "qr") return;

    const key = `${instance.id}:${pairMode}`;
    if (kickedRef.current === key) return;
    kickedRef.current = key;

    refreshQR
      .mutateAsync({ instance_id: instance.id })
      .then((res) => {
        setPairCode(res.paircode ?? null);
        if (res.instance.qr_code) setLiveQr(res.instance.qr_code);
      })
      .catch((error) => {
        kickedRef.current = null; // allow a retry on the next open
        console.error("Erro ao gerar QR Code:", error);
        toast.error(error.message || "Erro ao gerar QR Code");
      });
  }, [isOpen, instance?.id, effectiveStatus, pairMode]);

  // Drop the code the moment it stops being useful — on close, and on connect.
  //
  // Closing: reopening must pair afresh, never flash the previous session's
  // code, which the provider has already retired.
  //
  // Connecting: the code was just consumed. Before this fix lived in component
  // state, the connect branch of the poll nulled `qr_code` in the row and the
  // cache refresh took the image away for free; holding it locally means we own
  // that cleanup. Leaving it on screen would park a spent pairing credential
  // under a green "Conectado" badge.
  useEffect(() => {
    if (!isOpen || effectiveStatus === "connected") {
      kickedRef.current = null;
      setLiveQr(null);
      setPairCode(null);
    }
  }, [isOpen, effectiveStatus]);

  // Poll connection status every 3s — stops when connected (real connection,
  // not stale `status='connected'` + session_dead_since).
  //
  // This poll is also what keeps the QR alive: `checkStatus` hands back the
  // provider's current code on every tick (3s poll vs ~20s rotation, so the
  // image on screen is never more than one tick behind). It is handed back, not
  // stored — see the note on `liveQr` above for why the row is the wrong home.
  useEffect(() => {
    if (!isOpen || !instance || effectiveStatus === "connected") return;

    const interval = setInterval(async () => {
      if (instance.id) {
        setIsChecking(true);
        try {
          const res = await checkStatus.mutateAsync({ instance_id: instance.id });
          // Null-guarded on both: a tick that lands mid-rotation and reports no
          // code must not blank the one the user is pointing a camera at (or
          // typing into their phone).
          if (res?.qrcode) setLiveQr(res.qrcode);
          if (res?.paircode) setPairCode(res.paircode);
        } catch (error) {
          console.error("Erro ao verificar status:", error);
        } finally {
          setIsChecking(false);
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isOpen, instance?.id, effectiveStatus]);

  const handleRefreshQR = async () => {
    if (!instance?.id) return;
    try {
      const res = await refreshQR.mutateAsync({ instance_id: instance.id });
      setPairCode(res.paircode ?? null);
      if (res.instance.qr_code) setLiveQr(res.instance.qr_code);
      toast.success("QR Code atualizado!");
    } catch (error: any) {
      const errorMessage = error.message || "Erro ao atualizar QR Code";
      toast.error(errorMessage);
      console.error("Erro ao atualizar QR Code:", error);
    }
  };

  const handleRequestPairCode = async () => {
    if (!instance?.id) return;
    const phone = phoneInput.replace(/\D/g, "");
    if (phone.length < 10) {
      toast.error("Informe o número com DDD (ex: 11987654321)");
      return;
    }
    try {
      const res = await refreshQR.mutateAsync({
        instance_id: instance.id,
        phone,
      });
      if (!res.paircode) {
        toast.error("Provedor não retornou código de pareamento. Use o QR.");
        return;
      }
      setPairCode(res.paircode);
      toast.success("Código gerado! Insira no WhatsApp do celular.");
    } catch (error: any) {
      const errorMessage = error.message || "Erro ao gerar código de pareamento";
      toast.error(errorMessage);
    }
  };

  if (!instance) return null;

  // Uazapi/Evolution conectam por QR/código de pareamento — API NÃO oficial.
  // Meta Cloud é oficial e conecta por Embedded Signup (nunca cai neste modal),
  // então o aviso de banimento só faz sentido para a instância não oficial.
  const isOfficial = getProviderProfile(instance.provider).official;

  // Prefer the freshly-polled code; fall back to whatever the row carries only
  // as a first paint, before the first tick lands. Never show anything once
  // connected — rows that predate this fix can still carry a spent code, and the
  // fallback would happily paint it next to a green "Conectado" badge.
  const displayedQr =
    effectiveStatus === "connected" ? null : liveQr ?? instance.qr_code;
  const qrCodeData = displayedQr?.startsWith("data:image")
    ? displayedQr
    : `data:image/png;base64,${displayedQr}`;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp</DialogTitle>
          <DialogDescription>
            Escolha como conectar: QR code ou código numérico de pareamento
          </DialogDescription>
        </DialogHeader>

        {!isOfficial && (
          <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p>
              <strong>API não oficial:</strong> o número pode ser banido pela Meta
              (política da Meta, não falha do Torque). Aqueça o número aos poucos.
            </p>
          </div>
        )}

        <div className="flex gap-2 mb-2">
          <Button
            size="sm"
            variant={pairMode === "qr" ? "default" : "outline"}
            onClick={() => setPairMode("qr")}
          >
            <QrCode className="w-4 h-4 mr-2" />
            QR Code
          </Button>
          <Button
            size="sm"
            variant={pairMode === "code" ? "default" : "outline"}
            onClick={() => setPairMode("code")}
          >
            Código numérico
          </Button>
        </div>

        <div className="flex flex-col items-center gap-4 py-4">
          {pairMode === "qr" ? (
            refreshQR.isPending ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
              </div>
            ) : displayedQr ? (
              <>
                <div className="p-4 bg-card rounded-lg border border-border">
                  <img src={qrCodeData} alt="QR Code WhatsApp" className="w-64 h-64" />
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  Abra o WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho
                  e escaneie este código.
                </p>
                <p className="text-xs text-muted-foreground text-center">
                  O código se renova sozinho a cada poucos segundos — escaneie sempre
                  o que estiver na tela.
                </p>
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">QR Code não disponível</p>
              </div>
            )
          ) : (
            <div className="w-full space-y-3">
              <div className="space-y-2">
                <Label htmlFor="pair-phone">Número do WhatsApp (com DDD)</Label>
                <Input
                  id="pair-phone"
                  type="tel"
                  placeholder="11987654321"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  disabled={refreshQR.isPending}
                />
              </div>
              <Button
                onClick={handleRequestPairCode}
                disabled={refreshQR.isPending || phoneInput.trim().length === 0}
                className="w-full"
              >
                {refreshQR.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                Gerar código
              </Button>
              {pairCode && (
                <div className="p-4 rounded-lg border border-border text-center">
                  <p className="text-xs text-muted-foreground mb-2">
                    Insira este código no WhatsApp do celular:
                  </p>
                  <p className="font-mono text-2xl tracking-widest">{pairCode}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Abra WhatsApp → Aparelhos conectados → Conectar com código do telefone.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Badge
              variant={
                effectiveStatus === "connected"
                  ? "default"
                  : effectiveStatus === "connecting"
                  ? "secondary"
                  : "destructive"
              }
            >
              {effectiveStatus === "connected" && (
                <CheckCircle2 className="w-3 h-3 mr-1" />
              )}
              {effectiveStatus === "connecting" && (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              )}
              {effectiveStatus !== "connected" && effectiveStatus !== "connecting" && (
                <XCircle className="w-3 h-3 mr-1" />
              )}
              {effectiveStatus === "connected"
                ? "Conectado"
                : effectiveStatus === "connecting"
                ? "Conectando..."
                : "Desconectado"}
            </Badge>
          </div>

          {effectiveStatus === "connected" && instance.phone_number && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Phone className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium text-foreground tabular-nums">
                {formatPhoneBR(instance.phone_number)}
              </span>
            </p>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          {pairMode === "qr" && (
            <Button variant="outline" onClick={handleRefreshQR} disabled={refreshQR.isPending}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Atualizar QR Code
            </Button>
          )}
          {effectiveStatus === "connected" && <Button onClick={onClose}>Concluído</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MessageLimitsCard({ instanceId, organizationId }: { instanceId: string; organizationId?: string }) {
  const { data, isLoading } = useMessageLimits(instanceId, organizationId);
  if (isLoading || !data) return null;
  const current = typeof data.current === "number" ? data.current : 0;
  const limit = typeof data.limit === "number" ? data.limit : 0;
  if (limit <= 0) return null;
  const pct = Math.round((current / limit) * 100);
  const isHigh = pct >= 80;
  return (
    <div className="flex items-center gap-3 text-xs">
      <Activity className={`h-3.5 w-3.5 shrink-0 ${isHigh ? "text-amber-500" : "text-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between mb-1">
          <span className="text-muted-foreground">Mensagens enviadas</span>
          <span className={isHigh ? "text-amber-500 font-medium" : "text-muted-foreground"}>
            {current.toLocaleString()} / {limit.toLocaleString()}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isHigh ? "bg-amber-500" : "bg-primary"}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function WhatsAppSettings() {
  // Meta Cloud (slice 3/7) is behind a flag until Meta App Review + the Meta
  // migrations are applied. Flag OFF → the connections UI is byte-identical to
  // today (direct Uazapi create dialog, no provider chip).
  const metaCloudFlag = useFeatureFlag("meta_cloud");
  // NotificaMe (canal oficial via BSP, fatia 1) atrás da própria flag jsonb.
  // Flag OFF → esta tela é byte-idêntica ao que era antes da fatia.
  const notificameFlag = useFeatureFlag("notificame");
  // Meta WhatsApp Cloud CONNECTION (Embedded Signup). INERT until Meta App
  // Review + VITE_META_WA_CONFIG_ID — `connectWhatsAppCloud` toasts a graceful
  // "configuração pendente" and aborts when unconfigured (no crash).
  const { connectWhatsAppCloud } = useConnectWhatsAppCloud();
  // Mesma permissão que libera "Nova Instância". Declarada AQUI, antes do
  // NotificaMe, porque é ela que decide se a sonda dele chega a rodar.
  const { canManage } = useCanManageWhatsApp();
  // Quem responde em qual número deixou de ser preferência de tela e virou GATE
  // de acesso no servidor: `whatsapp_readable_instance_ids` (SCRUM-649) lê
  // `whatsapp_instance_allowed_members` para decidir quais caixas a pessoa
  // enxerga na Caixa de Entrada Unificada. A escrita dessa tabela passou a
  // exigir admin da org na mesma migration — senão o membro se põe na lista da
  // caixa proibida com um POST e o gate vira auto-serviço. `canManage` sozinho
  // NÃO basta aqui: ele cai em `whatsapp.manage_instances`, que o catálogo vivo
  // entrega a todo membro ativo (`is_admin_only = false, default_value = true`).
  // Sem este `isAdmin`, o botão continuaria aparecendo e o "Salvar" levaria
  // erro de RLS.
  const { isAdmin } = useIdentity();
  // NotificaMe Seamless.
  //
  // A sonda de mount é LEITURA PURA (`mode:"status"` na edge function). Isto é
  // uma correção, não um detalhe: antes, abrir esta aba PROVISIONAVA uma subconta
  // no fornecedor — objeto IRREMOVÍVEL e faturável — sem ninguém clicar em nada,
  // e um master passeando pelas orgs criava uma em nome de CADA org cuja tela ele
  // abrisse. Provisionar agora acontece SÓ no clique.
  //
  // `enabled` soma `canManage` porque o único caminho até `connectNotificame` é o
  // chooser, e o chooser só abre pelos botões que já dependem de `canManage`.
  // Sondar para quem não pode abrir a porta é chamada gasta à toa. O gate que
  // VALE, porém, é o do servidor — que exige ADMIN OU MASTER, degrau acima desta
  // feature permission (ela nasce liberada para todo membro ativo). Um membro com
  // `canManage` e sem admin recebe 403 e o card nasce desabilitado com o motivo:
  // a credencial da subconta NÃO é rotacionável, então entregá-la ao browser
  // errado é irreversível.
  //
  // INERT enquanto faltarem os secrets do fornecedor: `isConfigured=false` +
  // `configReason` legível fazem o card nascer desabilitado COM MOTIVO, em vez de
  // só avisar por toast depois do clique. `isProvisioning` é um TERCEIRO estado —
  // o popup já abriu e a subconta está sendo criada no fornecedor —, e ele merece
  // microcopy própria porque é o único em que esperar resolve.
  const {
    connectNotificame,
    isConfigured: notificameConfigured,
    configReason: notificameReason,
    isConfigLoading: notificameConfigLoading,
    isProvisioning: notificameProvisioning,
  } = useConnectNotificame({ enabled: notificameFlag.enabled && canManage });
  // Qualquer um dos dois caminhos oficiais ligado ⇒ a escolha da API vira uma
  // decisão explícita, e o chooser substitui o dialog Uazapi direto.
  const showChooser = metaCloudFlag.enabled || notificameFlag.enabled;
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isChooserOpen, setIsChooserOpen] = useState(false);
  const [instanceName, setInstanceName] = useState("");
  const [qrCodeInstanceId, setQrCodeInstanceId] = useState<string | null>(null);
  const [deleteInstanceId, setDeleteInstanceId] = useState<{ id: string; name: string } | null>(null);
  const [vendedoresInstance, setVendedoresInstance] = useState<WhatsAppInstance | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [apiStatus, setApiStatus] = useState<"unknown" | "connected" | "error">("unknown");
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  const { data: instances = [], isLoading } = useWhatsAppInstances();
  const { data: teamMembers = [] } = useTeamMembers();
  const createInstance = useCreateWhatsAppInstance();
  const deleteInstance = useDeleteWhatsAppInstance();
  const checkStatus = useCheckConnectionStatus();
  const logout = useLogoutInstance();
  // `canManage` sobe para o topo do componente (junto do NotificaMe) — a sonda
  // do canal oficial depende dele para nem sair do lugar.
  const { getQuota } = useOrgQuotas();
  const whatsappQuota = getQuota("max_whatsapp_instances");
  const { data: allowedMembers = [] } = useAllowedMembersForInstance(vendedoresInstance?.id ?? null);
  const setAllowedMembers = useSetAllowedMembersForInstance();
  const [selectedVendedores, setSelectedVendedores] = useState<Set<string>>(new Set());
  const [vendedoresDirty, setVendedoresDirty] = useState(false);

  // Alvo da confirmação de remoção. O aviso depende do PROVIDER, não só de "não
  // é QR": o canal oficial da Meta some e pronto; o do NotificaMe deixa para
  // trás uma subconta que é PRESERVADA de propósito.
  const deleteTarget = deleteInstanceId
    ? instances.find((i) => i.id === deleteInstanceId.id) ?? null
    : null;
  const deleteTargetIsQr = getProviderProfile(deleteTarget?.provider).connectKind === "qr";

  const allowedIdsStr = useMemo(
    () => allowedMembers.map((a) => a.team_member_id).sort().join(","),
    [allowedMembers]
  );
  useEffect(() => {
    if (vendedoresInstance && !vendedoresDirty) {
      setSelectedVendedores(new Set(allowedMembers.map((a) => a.team_member_id)));
    }
  }, [vendedoresInstance?.id, allowedIdsStr]);

  const handleSaveVendedores = async () => {
    if (!vendedoresInstance) return;
    try {
      await setAllowedMembers.mutateAsync({
        whatsappInstanceId: vendedoresInstance.id,
        teamMemberIds: Array.from(selectedVendedores),
      });
      toast.success("Vendedores atualizados. Somente os selecionados poderão responder neste número.");
      setVendedoresDirty(false);
      setVendedoresInstance(null);
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    }
  };

  const toggleVendedor = (teamMemberId: string) => {
    setSelectedVendedores((prev) => {
      const next = new Set(prev);
      if (next.has(teamMemberId)) next.delete(teamMemberId);
      else next.add(teamMemberId);
      return next;
    });
    setVendedoresDirty(true);
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setErrorDetails(null);
    try {
      const { data, error } = await supabase.functions.invoke<{ results: Array<{ service: string; status: string; error?: string }> }>("check-api-health");
      if (error) throw new Error(error.message);
      const evolution = data?.results?.find((r) => r.service === "Evolution API");
      if (evolution?.status === "connected") {
        setApiStatus("connected");
        toast.success("Conexão Evolution API bem-sucedida!");
      } else {
        setApiStatus("error");
        const msg = evolution?.error || evolution?.status || "Serviço indisponível";
        setErrorDetails(msg);
        toast.error(`Falha Evolution API: ${msg}`);
      }
    } catch (error: any) {
      setApiStatus("error");
      const errorMsg = error.message || "Erro desconhecido ao testar conexão";
      setErrorDetails(errorMsg);
      toast.error(`Erro ao testar conexão: ${errorMsg}`);
      console.error("Erro ao testar conexão:", error);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleCreate = async () => {
    if (!instanceName.trim()) {
      toast.error("Nome da instância é obrigatório");
      return;
    }

    setErrorDetails(null);
    try {
      const newInstance = await createInstance.mutateAsync({
        instance_name: instanceName.trim(),
      });
      toast.success("Instância criada! Escaneie o QR code para conectar.");
      setIsCreateDialogOpen(false);
      setInstanceName("");
      setQrCodeInstanceId(newInstance.id);
      setApiStatus("connected");
    } catch (error: any) {
      setApiStatus("error");
      const errorMessage = error.message || "Erro ao criar instância";
      const statusCode = error.status ? ` (Status: ${error.status})` : "";
      const fullMessage = `${errorMessage}${statusCode}`;
      
      setErrorDetails(fullMessage);
      toast.error(fullMessage, {
        description: error.errorData?.message || error.statusText || "",
        duration: 5000,
      });
      console.error("Erro detalhado ao criar instância:", {
        message: error.message,
        status: error.status,
        statusText: error.statusText,
        errorData: error.errorData,
        stack: error.stack,
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteInstanceId) return;
    const target = deleteInstanceId;
    setDeleteInstanceId(null);
    const toastId = toast.loading("Removendo instância...");
    try {
      await deleteInstance.mutateAsync({
        id: target.id,
        instance_name: target.name,
      });
      toast.success("Instância removida com sucesso.", { id: toastId });
    } catch (error: any) {
      const errorMessage = error.message || "Erro ao remover instância";
      toast.error(errorMessage, { id: toastId });
      console.error("Erro ao remover instância:", error);
    }
  };

  const handleCheckStatus = async (instanceId: string) => {
    try {
      await checkStatus.mutateAsync({ instance_id: instanceId });
      toast.success("Status atualizado!");
    } catch (error: any) {
      const errorMessage = error.message || "Erro ao verificar status";
      toast.error(errorMessage);
      console.error("Erro ao verificar status:", error);
    }
  };

  const handleLogout = async (instanceId: string) => {
    try {
      await logout.mutateAsync({ instance_id: instanceId });
      toast.success("Logout realizado!");
    } catch (error: any) {
      const errorMessage = error.message || "Erro ao fazer logout";
      toast.error(errorMessage);
      console.error("Erro ao fazer logout:", error);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "connected":
        return (
          <Badge className="bg-success/20 text-success border-success/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Conectado
          </Badge>
        );
      case "connecting":
        return (
          <Badge className="bg-warning/20 text-warning border-warning/30">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Conectando
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive">
            <XCircle className="w-3 h-3 mr-1" />
            Erro
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            <XCircle className="w-3 h-3 mr-1" />
            Desconectado
          </Badge>
        );
    }
  };

  // O aviso de "API não oficial" só é verdade sobre números que conectam por QR.
  // Com um canal oficial (Meta Cloud / NotificaMe) na tela, a frase mentiria —
  // e mentir sobre risco de ban é pior que não avisar. Sem instância nenhuma o
  // aviso continua, porque o caminho padrão de criação ainda é o Uazapi.
  const hasQrInstance = instances.some(
    (i) => getProviderProfile(i.provider).connectKind === "qr",
  );
  const showUnofficialWarning = instances.length === 0 || hasQrInstance;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Instâncias WhatsApp</h3>
          <p className="text-sm text-muted-foreground">
            Gerencie suas conexões WhatsApp via Evolution API
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleTestConnection}
            variant="outline"
            size="sm"
            disabled={isTestingConnection}
            className="gap-2"
          >
            {isTestingConnection ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Testando...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Testar Conexão
              </>
            )}
          </Button>
          {apiStatus !== "unknown" && (
            <Badge
              variant={apiStatus === "connected" ? "default" : "destructive"}
              className="gap-1"
            >
              {apiStatus === "connected" ? (
                <>
                  <CheckCircle2 className="w-3 h-3" />
                  API Conectada
                </>
              ) : (
                <>
                  <XCircle className="w-3 h-3" />
                  API Desconectada
                </>
              )}
            </Badge>
          )}
          {!whatsappQuota.is_unlimited && (
            <Badge variant="outline" className="text-xs">
              {whatsappQuota.current_usage} de {whatsappQuota.effective_limit} instâncias
            </Badge>
          )}
          {canManage && (
            <Button
              onClick={() =>
                showChooser ? setIsChooserOpen(true) : setIsCreateDialogOpen(true)
              }
              size="sm"
              className="gap-2"
              disabled={!whatsappQuota.can_add}
            >
              <Plus className="w-4 h-4" />
              Nova Instância
            </Button>
          )}
          {canManage && !whatsappQuota.can_add && (
            <p className="text-xs text-destructive">
              Limite atingido ({whatsappQuota.current_usage}/{whatsappQuota.effective_limit}). Entre em contato para contratar mais.
            </p>
          )}
        </div>
      </div>

      {showUnofficialWarning && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>
            Conexão via <strong>API não oficial</strong> do WhatsApp — o número pode ser
            banido pela Meta (política da Meta, não falha do Torque). Aqueça números novos
            aos poucos e evite disparos em massa.
          </p>
        </div>
      )}

      {errorDetails && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Erro Detalhado:</p>
              <p className="text-xs text-muted-foreground mt-1 break-all">{errorDetails}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(errorDetails);
                toast.success("Erro copiado para a área de transferência");
              }}
            >
              Copiar
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : instances.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Nenhuma instância WhatsApp cadastrada</p>
          {canManage && (
            // Mesma porta que o botão do topo: a org NOVA é justamente o público
            // mais provável do número oficial, e mandá-la direto pro dialog
            // Uazapi a deixava sem sequer ver que existe outro caminho.
            <Button
              onClick={() =>
                showChooser ? setIsChooserOpen(true) : setIsCreateDialogOpen(true)
              }
              variant="outline"
              className="mt-4"
            >
              Criar primeira instância
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {instances.map((instance) => {
            const effectiveStatus = deriveInstanceStatus(instance);
            const isLive = effectiveStatus === "connected";
            // Só o caminho QR (Uazapi/Evolution) tem QR Code, logout e "checar
            // status": os três caem no `whatsapp-api-proxy` → `getWhatsAppProvider`,
            // que na fatia 1 não conhece `notificame` e responde "Unknown
            // provider". Esconder é o fail-closed correto — o botão não existe
            // em vez de existir e explodir.
            const isQrProvider = getProviderProfile(instance.provider).connectKind === "qr";
            return (
            <motion.div
              key={instance.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 border rounded-lg bg-card hover:border-primary/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="font-medium">{instance.instance_name}</h4>
                    {getStatusBadge(effectiveStatus)}
                    {showChooser && (
                      <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                        {getProviderProfile(instance.provider).label}
                      </Badge>
                    )}
                  </div>
                  {instance.phone_number && (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {isLive ? "Número conectado: " : "Último número: "}
                        <span className="font-medium text-foreground tabular-nums">
                          {formatPhoneBR(instance.phone_number)}
                        </span>
                      </span>
                    </p>
                  )}
                  {instance.last_connection_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Última conexão:{" "}
                      {new Date(instance.last_connection_at).toLocaleString("pt-BR")}
                    </p>
                  )}
                  {instance.session_dead_since && (
                    <p className="text-xs text-destructive mt-1">
                      Sessão deslogada
                      {instance.session_dead_reason
                        ? `: ${instance.session_dead_reason}`
                        : ""}
                      .{isQrProvider ? " Rescaneie o QR Code pra reconectar." : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {canManage && isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setVendedoresDirty(false);
                        setVendedoresInstance(instance);
                      }}
                      title="Definir quem pode responder neste número"
                    >
                      <Users className="w-4 h-4 mr-2" />
                      Vendedores
                    </Button>
                  )}
                  {!isLive && isQrProvider && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setQrCodeInstanceId(instance.id)}
                    >
                      <QrCode className="w-4 h-4 mr-2" />
                      {instance.qr_code ? "Ver QR Code" : "Reconectar"}
                    </Button>
                  )}
                  {isQrProvider && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCheckStatus(instance.id)}
                      disabled={checkStatus.isPending}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  )}
                  {isLive && isQrProvider && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLogout(instance.id)}
                      disabled={logout.isPending}
                    >
                      <LogOut className="w-4 h-4" />
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDeleteInstanceId({
                          id: instance.id,
                          name: instance.instance_name,
                        })
                      }
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>

              {isLive && (
                <div className="mt-4 space-y-4 pt-4 border-t border-border/40">
                  <MessageLimitsCard instanceId={instance.id} organizationId={instance.organization_id} />
                  <HistorySyncPanel instanceId={instance.id} />
                  {/* Só o canal oficial tem template HSM — o QR não tem o
                      conceito, e pedir a lista dele devolveria 422. O card
                      também se apaga sozinho quando o servidor diz que o canal
                      não usa templates. */}
                  {instance.provider === "notificame" && (
                    <>
                      <NotificameTemplatesCard instanceId={instance.id} />
                      {/* Saúde do número, bloqueados e o link de consentimento —
                          as três coisas que se operam no número e não têm lugar
                          dentro de uma conversa. */}
                      <NotificameOperacaoCard instanceId={instance.id} />
                    </>
                  )}
                </div>
              )}
            </motion.div>
            );
          })}
        </div>
      )}

      {/* Provider chooser — Uazapi QR vs Meta Oficial vs WhatsApp Oficial (NotificaMe) */}
      <WhatsAppProviderChooser
        open={isChooserOpen}
        onOpenChange={setIsChooserOpen}
        onChooseUazapi={() => setIsCreateDialogOpen(true)}
        // MESMA REGRA DO NOTIFICAME, e ela estava faltando aqui: handler ausente
        // ⇒ o card da Meta nem renderiza. Antes o card era incondicional e a flag
        // `meta_cloud` decidia só se o diálogo abria — então uma org só-NotificaMe
        // via o Embedded Signup oferecido e clicava num caminho que ela não tem.
        onChooseMeta={
          metaCloudFlag.enabled
            ? () => {
                void connectWhatsAppCloud();
              }
            : undefined
        }
        // Handler ausente ⇒ o card do NotificaMe nem renderiza (flag OFF).
        //
        // O `"whatsapp"` é EXPLÍCITO, não default. O mesmo hook agora conecta
        // Instagram, e passar `connectNotificame` cru aqui deixaria o canal ser
        // decidido por omissão — além de entregar o evento de clique como
        // primeiro argumento se algum dia este handler for ligado direto a um
        // `onClick`. Este diálogo é sobre número de WhatsApp e diz isso na
        // chamada.
        onChooseNotificame={notificameFlag.enabled ? () => connectNotificame("whatsapp") : undefined}
        // Motivo preenchido ⇒ card visível, desabilitado e explicando por quê.
        // Três esperas distintas, três frases distintas: sonda em voo; subconta
        // sendo criada no fornecedor (o popup JÁ abriu — é o clique que
        // provisiona, e desabilitar aqui é o que impede um segundo clique
        // enquanto a conta nasce); e indisponível de verdade — que agora inclui
        // "você não é admin", já que o servidor exige admin ou master.
        notificameDisabledReason={
          notificameConfigLoading
            ? "Verificando disponibilidade..."
            : notificameProvisioning
              ? "Preparando sua conta oficial..."
              : notificameConfigured
                ? null
                : notificameReason
        }
      />

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Instância WhatsApp</DialogTitle>
            <DialogDescription>
              Crie uma nova instância para conectar um número WhatsApp
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <div className="space-y-1.5 text-xs leading-relaxed text-amber-800 dark:text-amber-200/90">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Atenção: esta é a API não oficial do WhatsApp
              </p>
              <p>
                Este número pode ser <span className="font-medium">bloqueado ou banido pela própria Meta</span>{" "}
                (dona do WhatsApp). Quando isso acontece, <span className="font-medium">não é falha nem culpa do Torque</span> —
                o sistema apenas conecta o seu WhatsApp; quem decide banir é a Meta.
              </p>
              <p>O banimento costuma acontecer por sinais que a Meta monitora, principalmente:</p>
              <ul className="ml-4 list-disc space-y-0.5">
                <li>
                  <span className="font-medium">Número/conta muito novo</span> (sem "aquecimento"): disparar muita mensagem
                  logo de cara aumenta o risco.
                </li>
                <li>
                  <span className="font-medium">Volume alto de mensagens</span> em pouco tempo, ou muitos envios para
                  contatos que não te responderam.
                </li>
              </ul>
              <p>
                A Meta vem <span className="font-medium">restringindo o uso de APIs não oficiais</span> justamente para
                empurrar as empresas a migrarem para a <span className="font-medium">API Oficial (WhatsApp Business API)</span>,
                que é paga, porém não tem esse risco de banimento por política.
              </p>
              <p className="text-amber-700 dark:text-amber-200/80">
                💡 Recomendação: aqueça o número aos poucos (comece com poucos envios e vá aumentando), evite disparos em
                massa para quem não respondeu e, se o número for essencial para o negócio, considere a API Oficial.
              </p>
            </div>
          </div>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="instance-name">Nome da Instância</Label>
              <Input
                id="instance-name"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                placeholder="Ex: whatsapp-principal"
              />
              <p className="text-xs text-muted-foreground">
                Use apenas letras, números e hífens
              </p>
            </div>
          </div>
          {errorDetails && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-xs text-destructive break-all">{errorDetails}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsCreateDialogOpen(false);
              setErrorDetails(null);
            }}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={createInstance.isPending}>
              {createInstance.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Criando...
                </>
              ) : (
                "Criar Instância"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Code Modal */}
      <QRCodeModal
        instanceId={qrCodeInstanceId}
        instances={instances}
        isOpen={!!qrCodeInstanceId}
        onClose={() => {
          const closingInstance = instances.find((i) => i.id === qrCodeInstanceId);
          setQrCodeInstanceId(null);
          if (closingInstance?.instance_name) {
            handleCheckStatus(closingInstance.id);
          }
        }}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteInstanceId}
        onOpenChange={() => setDeleteInstanceId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Instância?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A instância será removida permanentemente.
            </AlertDialogDescription>
            {/*
              Dívida (i) da fatia 1, dita em voz alta em vez de silenciada: o
              reaper só limpa o lado do fornecedor para `provider='uazapi'`. Um
              canal oficial removido aqui continua existindo lá — foi esse mesmo
              padrão que gerou 87 instâncias órfãs na Uazapi.

              No NotificaMe a frase é OUTRA, e não é um aviso de dívida: a conta
              oficial da organização sobrevive à remoção do canal DE PROPÓSITO.
              É ela que faz uma reconexão reaproveitar a conta existente em vez
              de criar outra no fornecedor — e conta criada lá é irremovível e
              faturável. Dizer só "ficou órfão" esconderia o desenho.
            */}
            {deleteTarget && !deleteTargetIsQr && (
              deleteTarget.provider === "notificame" ? (
                <p className="text-sm text-muted-foreground">
                  O número deixa de funcionar aqui, mas a conta oficial da sua organização é
                  mantida — é ela que permite reconectar depois sem abrir uma conta nova no
                  provedor. O canal em si continua existindo lá; a remoção é manual.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  O canal continua ativo no provedor — a remoção lá ainda é manual.
                </p>
              )
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Vendedores que podem responder neste número */}
      <Dialog
        open={!!vendedoresInstance}
        onOpenChange={(open) => {
          if (!open) {
            setVendedoresInstance(null);
            setVendedoresDirty(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Quem pode responder neste número?
            </DialogTitle>
            <DialogDescription>
              Somente os vendedores selecionados poderão responder no chat deste número. Deixe nenhum selecionado para todos da organização poderem responder.
            </DialogDescription>
          </DialogHeader>
          {vendedoresInstance && (
            <p className="text-sm font-medium text-muted-foreground">
              Número: {vendedoresInstance.instance_name}
              {vendedoresInstance.phone_number && ` (${vendedoresInstance.phone_number})`}
            </p>
          )}
          <div className="max-h-64 overflow-y-auto space-y-2 py-2">
            {teamMembers
              .filter((m) => m.is_active)
              .map((member) => (
                <label
                  key={member.id}
                  className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedVendedores.has(member.id)}
                    onCheckedChange={() => toggleVendedor(member.id)}
                  />
                  <span className="font-medium">{member.name}</span>
                  <span className="text-xs text-muted-foreground">({member.role})</span>
                </label>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVendedoresInstance(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSaveVendedores}
              disabled={setAllowedMembers.isPending || !vendedoresDirty}
            >
              {setAllowedMembers.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
