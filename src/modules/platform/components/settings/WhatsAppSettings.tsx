import { useState, useEffect, useMemo, useRef } from "react";
import { format } from "date-fns";
import {
  MessageSquare,
  MessageCircle,
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
  Smartphone,
  Gauge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FocusCard, FocusTile, InkPanel, InkRow, InkSplit, KpiRow, KpiTile, ValueUnit } from "@/components/ui/bento";
import { cn } from "@/lib/utils";
import { AcaoDoCabecalho, PilulaDeEstado, RotuloMicro } from "./settings-ui";
import { botaoNoOuroPrimario, botaoNoOuroSecundario } from "./settings-classes";
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
  type ProviderProfile,
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
import { notifyError } from "@/shared/errors";

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
        notifyError(error, { fallback: "Não foi possível gerar QR Code." });
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

/**
 * O contador de envios da instância (o mesmo `useMessageLimits` de antes),
 * agora como sub-bloco do cartão de ouro. Sem limite configurado, não aparece.
 */
function LimiteDeMensagens({ instanceId, organizationId }: { instanceId: string; organizationId?: string }) {
  const { data, isLoading } = useMessageLimits(instanceId, organizationId);
  if (isLoading || !data) return null;
  const current = typeof data.current === "number" ? data.current : 0;
  const limit = typeof data.limit === "number" ? data.limit : 0;
  if (limit <= 0) return null;
  const pct = Math.round((current / limit) * 100);
  const isHigh = pct >= 80;
  return (
    <FocusTile>
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-primary-foreground/65">
        <Activity className="h-3 w-3" aria-hidden />
        Mensagens enviadas
      </p>
      <p className="mt-1 text-[1rem] font-extrabold tabular-nums tracking-[-0.02em]">
        {current.toLocaleString("pt-BR")}
        <span className="ml-1 text-[11px] font-bold text-primary-foreground/60">de {limit.toLocaleString("pt-BR")}</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary-foreground/15">
        <div
          className={cn("h-full rounded-full transition-all", isHigh ? "bg-destructive" : "bg-primary-foreground")}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </FocusTile>
  );
}

/** Recursos que o provedor do número suporta (perfil em `whatsapp-provider.ts`). */
const RECURSOS_DO_PROVEDOR: { chave: keyof ProviderProfile["capabilities"]; rotulo: string }[] = [
  { chave: "menu", rotulo: "Menus" },
  { chave: "pix", rotulo: "Botão Pix" },
  { chave: "reactions", rotulo: "Reações" },
  { chave: "edit", rotulo: "Editar mensagem" },
  { chave: "pin", rotulo: "Fixar mensagem" },
  { chave: "historySync", rotulo: "Histórico" },
  { chave: "massSend", rotulo: "Envio em massa" },
  { chave: "templates", rotulo: "Templates" },
  { chave: "window24h", rotulo: "Janela de 24 h" },
];

const ROTULO_DO_ESTADO: Record<string, string> = {
  connected: "Conectada",
  connecting: "Conectando",
  error: "Erro",
};

function tomDoEstado(status: string): "bom" | "aviso" | "ruim" {
  if (status === "connected") return "bom";
  if (status === "connecting") return "aviso";
  return "ruim";
}

function iniciaisDe(nome: string | null | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Quem pode responder no número — a mesma lista do diálogo "Vendedores". */
function QuemAtende({ instanceId, nomes }: { instanceId: string; nomes: Map<string, string> }) {
  const { data: permitidos = [], isLoading } = useAllowedMembersForInstance(instanceId);
  const pessoas = permitidos.map((p) => nomes.get(p.team_member_id) ?? null);
  return (
    <FocusTile>
      <p className="text-[11px] font-bold text-primary-foreground/65">Quem atende esta caixa</p>
      {isLoading ? (
        <p className="mt-1 text-[1rem] font-extrabold opacity-50">—</p>
      ) : pessoas.length === 0 ? (
        <p className="mt-1 text-[13px] font-bold leading-snug">Só administradores e master</p>
      ) : (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="flex -space-x-1.5" aria-hidden>
            {pessoas.slice(0, 4).map((nome, i) => (
              <span
                key={i}
                className="grid h-6 w-6 place-items-center rounded-full border-2 border-primary bg-tinta text-[9px] font-extrabold text-tinta-foreground"
              >
                {iniciaisDe(nome)}
              </span>
            ))}
          </span>
          <span className="text-[13px] font-bold tabular-nums">
            {pessoas.length} {pessoas.length === 1 ? "pessoa" : "pessoas"}
          </span>
        </div>
      )}
    </FocusTile>
  );
}

/**
 * Cartão de ouro da instância em foco. Só reapresenta o que a tela já tinha
 * por instância (número, última conexão, quem atende, envios, sessão caída) e
 * as MESMAS ações — com as mesmas condições de provedor e permissão.
 */
function FocoDaInstancia({
  instance,
  nomesDaEquipe,
  podeGerir,
  podeEscolherQuemAtende,
  verificando,
  desconectando,
  onQuemAtende,
  onQrCode,
  onVerificar,
  onDesconectar,
  onRemover,
}: {
  instance: WhatsAppInstance;
  nomesDaEquipe: Map<string, string>;
  podeGerir: boolean;
  podeEscolherQuemAtende: boolean;
  verificando: boolean;
  desconectando: boolean;
  onQuemAtende: () => void;
  onQrCode: () => void;
  onVerificar: () => void;
  onDesconectar: () => void;
  onRemover: () => void;
}) {
  const status = deriveInstanceStatus(instance);
  const isLive = status === "connected";
  const perfil = getProviderProfile(instance.provider);
  // Só o caminho QR (Uazapi/Evolution) tem QR Code, logout e "checar
  // status": os três caem no `whatsapp-api-proxy` → `getWhatsAppProvider`,
  // que na fatia 1 não conhece `notificame` e responde "Unknown
  // provider". Esconder é o fail-closed correto — o botão não existe
  // em vez de existir e explodir.
  const isQrProvider = perfil.connectKind === "qr";
  const recursos = RECURSOS_DO_PROVEDOR.filter((r) => perfil.capabilities[r.chave]);
  const qrPrimario = !isLive && isQrProvider;

  return (
    <FocusCard className="gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-primary-foreground/70">
            {perfil.official ? "API oficial" : "API não oficial"} ({perfil.label})
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-[1.55rem] font-extrabold leading-[1.12] tracking-[-0.03em] max-sm:text-[1.3rem]">
              {instance.instance_name}
            </h3>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-tinta px-2.5 py-1 text-[11px] font-bold text-tinta-foreground">
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  status === "connected" ? "bg-success" : status === "connecting" ? "bg-warning" : "bg-destructive",
                )}
              />
              {ROTULO_DO_ESTADO[status] ?? "Desconectada"}
            </span>
          </div>
          {instance.phone_number ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-primary-foreground/80">
              <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{isLive ? "Número conectado:" : "Último número:"}</span>
              <span className="whitespace-nowrap font-mono font-bold tabular-nums text-primary-foreground">
                {formatPhoneBR(instance.phone_number)}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-primary-foreground/70">Sem número registrado</p>
          )}
        </div>
        {podeGerir && (
          <button
            type="button"
            onClick={onRemover}
            aria-label={`Remover instância ${instance.instance_name}`}
            title="Remover instância"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-primary-foreground/15 bg-primary-foreground/[.07] transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
        <FocusTile>
          <p className="text-[11px] font-bold text-primary-foreground/65">{isLive ? "Conectada desde" : "Última conexão"}</p>
          <p className="mt-1 text-[1rem] font-extrabold tabular-nums tracking-[-0.02em]">
            {instance.last_connection_at ? format(new Date(instance.last_connection_at), "dd/MM/yyyy HH:mm") : "—"}
          </p>
        </FocusTile>
        <QuemAtende instanceId={instance.id} nomes={nomesDaEquipe} />
        {isLive && <LimiteDeMensagens instanceId={instance.id} organizationId={instance.organization_id} />}
      </div>

      {recursos.length > 0 && (
        <FocusTile className="flex flex-wrap items-center gap-1.5 py-2.5">
          <span className="mr-1 text-[11px] font-bold text-primary-foreground/65">Recursos desta API</span>
          {recursos.map((r) => (
            <span
              key={r.chave}
              className="rounded-full bg-primary-foreground/[.12] px-2.5 py-0.5 text-[11px] font-bold"
            >
              {r.rotulo}
            </span>
          ))}
        </FocusTile>
      )}

      {instance.session_dead_since && (
        <p className="flex items-start gap-2 rounded-2xl bg-primary-foreground/[.1] px-3 py-2.5 text-[12.5px] font-semibold">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Sessão deslogada
            {instance.session_dead_reason ? `: ${instance.session_dead_reason}` : ""}.
            {isQrProvider ? " Rescaneie o QR Code pra reconectar." : ""}
          </span>
        </p>
      )}

      {!perfil.official && (
        <p className="flex items-start gap-2 rounded-2xl bg-primary-foreground/[.07] px-3 py-2.5 text-[12px] leading-relaxed text-primary-foreground/80">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Conexão via <strong className="text-primary-foreground">API não oficial</strong> do WhatsApp — o número pode
            ser banido pela Meta (política da Meta, não falha do Torque). Aqueça números novos aos poucos e evite disparos
            em massa.
          </span>
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2">
        {qrPrimario && (
          <button type="button" onClick={onQrCode} className={botaoNoOuroPrimario}>
            <QrCode />
            {instance.qr_code ? "Ver QR Code" : "Reconectar"}
          </button>
        )}
        {podeEscolherQuemAtende && (
          <button
            type="button"
            onClick={onQuemAtende}
            title="Definir quem pode responder neste número"
            className={qrPrimario ? botaoNoOuroSecundario : botaoNoOuroPrimario}
          >
            <Users />
            Vendedores
          </button>
        )}
        {isQrProvider && (
          <button type="button" onClick={onVerificar} disabled={verificando} className={botaoNoOuroSecundario}>
            <RefreshCw className={cn(verificando && "animate-spin")} />
            Verificar status
          </button>
        )}
        {isLive && isQrProvider && (
          <button
            type="button"
            onClick={onDesconectar}
            disabled={desconectando}
            className={cn(botaoNoOuroSecundario, "sm:ml-auto")}
          >
            <LogOut />
            Desconectar
          </button>
        )}
      </div>
    </FocusCard>
  );
}

export function WhatsAppSettings({ embedded = false }: { embedded?: boolean } = {}) {
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
  const [focoId, setFocoId] = useState<string | null>(null);
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
      notifyError(e, { fallback: "Não foi possível salvar." });
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

  // O aviso de "API não oficial" só é verdade sobre números que conectam por QR.
  // Com um canal oficial (Meta Cloud / NotificaMe) na tela, a frase mentiria —
  // e mentir sobre risco de ban é pior que não avisar. Sem instância nenhuma o
  // aviso continua, porque o caminho padrão de criação ainda é o Uazapi.
  const hasQrInstance = instances.some(
    (i) => getProviderProfile(i.provider).connectKind === "qr",
  );
  const showUnofficialWarning = instances.length === 0 || hasQrInstance;

  // V5: lista em tinta + cartão de ouro da instância em foco. A seleção é
  // estado local; o padrão é a primeira instância.
  const foco = instances.find((i) => i.id === focoId) ?? instances[0] ?? null;
  const conectadas = instances.filter((i) => deriveInstanceStatus(i) === "connected").length;
  const nomesDaEquipe = useMemo(
    () => new Map(teamMembers.map((m) => [m.id, m.name] as [string, string])),
    [teamMembers],
  );
  const provedores = Array.from(new Set(instances.map((i) => getProviderProfile(i.provider).label)));
  const abrirCriacao = () => (showChooser ? setIsChooserOpen(true) : setIsCreateDialogOpen(true));

  const acoesDoCabecalho = (
    <AcaoDoCabecalho>
      <Button
        onClick={handleTestConnection}
        variant="outline"
        disabled={isTestingConnection}
        title="Testa a conexão do Torque com o provedor"
      >
        {isTestingConnection ? (
          <>
            <Loader2 className="animate-spin" />
            Testando...
          </>
        ) : (
          <>
            <RefreshCw />
            Testar Conexão
          </>
        )}
      </Button>
      {canManage && (
        <Button onClick={abrirCriacao} disabled={!whatsappQuota.can_add}>
          <Plus />
          Nova Instância
        </Button>
      )}
    </AcaoDoCabecalho>
  );

  const notaDoPainel = (
    <span className="flex flex-wrap items-center gap-2">
      {apiStatus !== "unknown" && (
        <PilulaDeEstado tom={apiStatus === "connected" ? "bom" : "ruim"}>
          {apiStatus === "connected" ? "API Conectada" : "API Desconectada"}
        </PilulaDeEstado>
      )}
      {provedores.length > 0 && (
        <span className="text-[11.5px] text-tinta-muted">Provedor: {provedores.join(" · ")}</span>
      )}
    </span>
  );

  const avisoDeLimite =
    canManage && !whatsappQuota.can_add ? (
      <p className="mb-2 flex items-start gap-2 rounded-2xl bg-destructive/15 px-3 py-2.5 text-[12px] text-destructive-strong">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Limite atingido ({whatsappQuota.current_usage}/{whatsappQuota.effective_limit}). Entre em contato para contratar mais.
      </p>
    ) : null;

  const listaDeInstancias = (
    <>
      {avisoDeLimite}
      {instances.map((instance) => {
        const status = deriveInstanceStatus(instance);
        const selecionada = instance.id === foco?.id;
        const perfil = getProviderProfile(instance.provider);
        return (
          <InkRow key={instance.id} selected={selecionada} onClick={() => setFocoId(instance.id)}>
            <span
              className={cn(
                "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px]",
                selecionada
                  ? "bg-primary-foreground text-primary"
                  : status === "connected"
                    ? "bg-success/15 text-success-strong"
                    : "bg-destructive/15 text-destructive-strong",
              )}
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold">{instance.instance_name}</span>
              <span
                className={cn(
                  "mt-0.5 block truncate text-[11.5px]",
                  selecionada ? "text-primary-foreground/70" : "text-tinta-muted",
                )}
              >
                {perfil.official ? "API oficial" : "API não oficial"}
                {instance.phone_number ? ` · ${formatPhoneBR(instance.phone_number)}` : ""}
              </span>
            </span>
            <PilulaDeEstado tom={tomDoEstado(status)} selecionada={selecionada}>
              {ROTULO_DO_ESTADO[status] ?? "Desconectada"}
            </PilulaDeEstado>
          </InkRow>
        );
      })}
      {canManage && (
        <button
          type="button"
          onClick={abrirCriacao}
          disabled={!whatsappQuota.can_add}
          className="mt-1.5 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-3 py-3.5 text-[13px] font-semibold text-tinta-muted transition-colors hover:border-white/25 hover:text-tinta-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Nova Instância WhatsApp
        </button>
      )}
    </>
  );

  const cartaoDeFoco = foco ? (
    <FocoDaInstancia
      instance={foco}
      nomesDaEquipe={nomesDaEquipe}
      podeGerir={canManage}
      podeEscolherQuemAtende={canManage && isAdmin}
      verificando={checkStatus.isPending}
      desconectando={logout.isPending}
      onQuemAtende={() => {
        setVendedoresDirty(false);
        setVendedoresInstance(foco);
      }}
      onQrCode={() => setQrCodeInstanceId(foco.id)}
      onVerificar={() => handleCheckStatus(foco.id)}
      onDesconectar={() => handleLogout(foco.id)}
      onRemover={() => setDeleteInstanceId({ id: foco.id, name: foco.instance_name })}
    />
  ) : null;

  const focoAoVivo = foco ? deriveInstanceStatus(foco) === "connected" : false;

  return (
    <div className="space-y-4">
      {acoesDoCabecalho}

      {!embedded && !isLoading && (
        <KpiRow cols={2}>
          <KpiTile
            label="Instâncias conectadas"
            value={
              <>
                {conectadas}
                <ValueUnit>de {instances.length}</ValueUnit>
              </>
            }
            icon={Smartphone}
            tone={instances.length > 0 && conectadas === instances.length ? "good" : "bad"}
            note={
              instances.length === 0
                ? "Nenhum número cadastrado"
                : conectadas === instances.length
                  ? "Todas conectadas"
                  : `${instances.length - conectadas} aguardando reconexão`
            }
          >
            {instances.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {instances.slice(0, 4).map((i) => {
                  const ok = deriveInstanceStatus(i) === "connected";
                  return (
                    <span
                      key={i.id}
                      className={cn(
                        "inline-flex max-w-[160px] items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold",
                        ok ? "bg-success/10 text-success-strong" : "bg-destructive/10 text-destructive",
                      )}
                    >
                      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-success" : "bg-destructive")} />
                      <span className="truncate">{i.instance_name}</span>
                    </span>
                  );
                })}
                {instances.length > 4 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-foreground/70">
                    +{instances.length - 4}
                  </span>
                )}
              </div>
            )}
          </KpiTile>
          <KpiTile
            label="Limite do plano"
            value={
              whatsappQuota.is_unlimited ? (
                "Sem limite"
              ) : (
                <>
                  {whatsappQuota.current_usage}
                  <ValueUnit>de {whatsappQuota.effective_limit} instâncias</ValueUnit>
                </>
              )
            }
            icon={Gauge}
            tone={whatsappQuota.can_add ? "neutral" : "warn"}
            note={
              whatsappQuota.is_unlimited
                ? "O plano não limita números"
                : whatsappQuota.can_add
                  ? `${Math.max(0, whatsappQuota.effective_limit - whatsappQuota.current_usage)} vaga(s) livre(s)`
                  : "Limite atingido"
            }
          >
            {!whatsappQuota.is_unlimited && whatsappQuota.effective_limit > 0 && (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", whatsappQuota.can_add ? "bg-primary" : "bg-destructive")}
                  style={{
                    width: `${Math.min(100, Math.round((whatsappQuota.current_usage / whatsappQuota.effective_limit) * 100))}%`,
                  }}
                />
              </div>
            )}
          </KpiTile>
        </KpiRow>
      )}

      {errorDetails && (
        <div className="rounded-card border border-destructive/20 bg-destructive/10 p-3">
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
        <InkPanel title="Instâncias WhatsApp">
          <div className="space-y-2" aria-busy>
            {[1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-2xl bg-white/[.06]" />
            ))}
          </div>
        </InkPanel>
      ) : instances.length === 0 ? (
        <InkPanel title="Instâncias WhatsApp" count="0 números">
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[.07] text-primary">
              <MessageSquare className="h-6 w-6" aria-hidden />
            </span>
            <p className="mt-3 text-[15px] font-bold">Nenhuma instância WhatsApp cadastrada</p>
            {showUnofficialWarning && (
              <p className="mt-2 max-w-md text-[12.5px] leading-relaxed text-tinta-muted">
                O caminho padrão conecta pela <strong className="text-tinta-foreground">API não oficial</strong> do
                WhatsApp — o número pode ser banido pela Meta (política da Meta, não falha do Torque). Aqueça
                números novos aos poucos e evite disparos em massa.
              </p>
            )}
            {canManage && (
              // Mesma porta que o botão do topo: a org NOVA é justamente o público
              // mais provável do número oficial, e mandá-la direto pro dialog
              // Uazapi a deixava sem sequer ver que existe outro caminho.
              <Button onClick={abrirCriacao} variant="outline" className="mt-5 text-foreground">
                Criar primeira instância
              </Button>
            )}
          </div>
        </InkPanel>
      ) : embedded ? (
        // Dentro do modal da integração não há largura para lista + foco lado
        // a lado: o foco vem primeiro e a lista embaixo.
        <InkPanel
          title="Instâncias WhatsApp"
          count={`${instances.length} ${instances.length === 1 ? "número" : "números"}`}
          actions={notaDoPainel}
        >
          <div className="flex flex-col gap-3">
            {cartaoDeFoco}
            <div className="flex flex-col gap-0.5">{listaDeInstancias}</div>
          </div>
        </InkPanel>
      ) : (
        <InkSplit
          title="Instâncias WhatsApp"
          count={`${instances.length} ${instances.length === 1 ? "número" : "números"}`}
          actions={notaDoPainel}
          list={listaDeInstancias}
          detail={cartaoDeFoco}
        />
      )}

      {/* O que se opera no número conectado: importar histórico e, no canal
          oficial, templates e operação. Era um bloco dentro de cada cartão de
          instância; agora acompanha a instância em foco. */}
      {foco && focoAoVivo && (
        <Card>
          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="min-w-0">
              <RotuloMicro>Operação do número</RotuloMicro>
              <h3 className="mt-0.5 truncate text-base font-bold tracking-tight">{foco.instance_name}</h3>
            </div>
            <HistorySyncPanel instanceId={foco.id} />
            {/* Só o canal oficial tem template HSM — o QR não tem o
                conceito, e pedir a lista dele devolveria 422. O card
                também se apaga sozinho quando o servidor diz que o canal
                não usa templates. */}
            {foco.provider === "notificame" && (
              <>
                <NotificameTemplatesCard instanceId={foco.id} />
                {/* Saúde do número, bloqueados e o link de consentimento —
                    as três coisas que se operam no número e não têm lugar
                    dentro de uma conversa. */}
                <NotificameOperacaoCard instanceId={foco.id} />
              </>
            )}
          </CardContent>
        </Card>
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
              Os usuários selecionados terão acesso às conversas e notificações deste número. Sem seleção, apenas administradores e master poderão acessá-lo.
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
