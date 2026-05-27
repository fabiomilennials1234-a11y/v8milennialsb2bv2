import { useState, useEffect, useRef } from "react";
import {
  MessageSquare,
  QrCode,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ArrowRight,
  ChevronRight,
  Smartphone,
  Info,
} from "lucide-react";
import {
  useCreateWhatsAppInstance,
  useRefreshQRCode,
  useCheckConnectionStatus,
  useWhatsAppInstances,
} from "@/modules/communication/hooks/useWhatsAppInstances";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const GUIDE_STEPS = [
  { icon: Smartphone, text: "Abra o WhatsApp no seu celular" },
  { icon: QrCode, text: "Toque em Dispositivos vinculados → Vincular dispositivo" },
  { icon: QrCode, text: "Escaneie o QR Code abaixo com a câmera" },
  { icon: CheckCircle2, text: "Aguarde a conexão ser confirmada (≤ 30s)" },
];

interface Props {
  onNext: () => void;
}

export function StepWhatsApp({ onNext }: Props) {
  const instances = useWhatsAppInstances();
  const createInstance = useCreateWhatsAppInstance();
  const refreshQR = useRefreshQRCode();
  const checkStatus = useCheckConnectionStatus();

  const [phase, setPhase] = useState<"form" | "qr" | "connected">("form");
  const [instanceName, setInstanceName] = useState("principal");
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check if already has a connected instance
  const connectedInstance = instances.data?.find((i) => i.status === "connected");
  useEffect(() => {
    if (connectedInstance) setPhase("connected");
  }, [connectedInstance]);

  // Poll status every 4s while in QR phase
  useEffect(() => {
    if (phase !== "qr" || !instanceId) return;

    pollRef.current = setInterval(async () => {
      try {
        const result = await checkStatus.mutateAsync({ instance_id: instanceId });
        if (result?.status === "connected") {
          clearInterval(pollRef.current!);
          setPhase("connected");
        }
      } catch {
        // ignore transient poll errors
      }
    }, 4000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [phase, instanceId]);

  const handleCreate = async () => {
    if (!instanceName.trim()) return;
    try {
      const result = await createInstance.mutateAsync({
        instance_name: instanceName.trim(),
      });
      setInstanceId(result.id);
      setQrCode(result.qr_code ?? null);
      setPhase("qr");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar instância");
    }
  };

  const handleRefreshQR = async () => {
    if (!instanceId) return;
    try {
      const res = await refreshQR.mutateAsync({ instance_id: instanceId });
      setQrCode(res.instance.qr_code ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar QR Code");
    }
  };

  if (phase === "connected") {
    return (
      <div className="space-y-6 text-center">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
        </div>
        <div>
          <h3 className="text-xl font-bold tracking-tight">WhatsApp conectado!</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Sua instância está ativa. Leads e conversas já funcionam.
          </p>
        </div>
        <button
          onClick={onNext}
          className="w-full py-3.5 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
        >
          Continuar
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (phase === "qr") {
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-semibold">Escaneie o QR Code</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Siga as instruções abaixo para vincular seu WhatsApp.
          </p>
        </div>

        {/* Guide steps */}
        <div className="space-y-2">
          {GUIDE_STEPS.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-primary">{i + 1}</span>
              </div>
              <p className="text-sm text-muted-foreground">{step.text}</p>
            </div>
          ))}
        </div>

        {/* QR Code display */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-48 h-48 rounded-2xl border border-border/60 bg-white flex items-center justify-center overflow-hidden">
            {qrCode ? (
              <img
                src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                alt="QR Code WhatsApp"
                className="w-full h-full object-contain p-2"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <QrCode className="w-10 h-10 opacity-30" />
                <span className="text-xs">Aguardando QR</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              Aguardando conexão...
            </div>
            <button
              onClick={handleRefreshQR}
              disabled={refreshQR.isPending}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn("w-3 h-3", refreshQR.isPending && "animate-spin")} />
              Novo QR
            </button>
          </div>
        </div>

        <div className="flex items-start gap-2 p-3 rounded-xl bg-muted/30 border border-border/40">
          <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            QR Code expira em 60 segundos. Se expirar, clique em &quot;Novo QR&quot;.
          </p>
        </div>

        <button
          onClick={onNext}
          className="w-full py-2.5 px-4 rounded-xl text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
        >
          Conectar depois
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Phase: form
  return (
    <div className="space-y-6">
      <div>
        <div className="w-10 h-10 rounded-xl bg-[#25D366]/10 flex items-center justify-center mb-3">
          <MessageSquare className="w-5 h-5 text-[#25D366]" />
        </div>
        <h3 className="text-lg font-semibold">Conecte o WhatsApp</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Vincule um número para receber e enviar mensagens diretamente no Torque.
        </p>
      </div>

      {/* What you'll unlock */}
      <div className="space-y-2 p-4 rounded-xl bg-muted/30 border border-border/40">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          O que você desbloqueia
        </p>
        {[
          "Receber leads diretamente do WhatsApp",
          "Chat unificado com histórico de conversas",
          "Agente IA respondendo automaticamente",
          "Disparos em massa para campanhas",
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
            <p className="text-xs text-muted-foreground">{item}</p>
          </div>
        ))}
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Nome da instância
        </label>
        <input
          type="text"
          placeholder="Ex: principal, vendas, suporte"
          value={instanceName}
          onChange={(e) => setInstanceName(e.target.value)}
          className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-border/60 bg-muted/30 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:bg-background transition-all"
        />
        <p className="text-[11px] text-muted-foreground/70 mt-1">
          Identificador interno — não aparece para os seus leads
        </p>
      </div>

      <div className="space-y-2">
        <button
          onClick={handleCreate}
          disabled={!instanceName.trim() || createInstance.isPending}
          className="w-full py-3 px-4 rounded-xl bg-[#25D366] text-white font-medium text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-all"
        >
          {createInstance.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Criando instância...</>
          ) : (
            <><QrCode className="w-4 h-4" /> Gerar QR Code</>
          )}
        </button>

        <button
          onClick={onNext}
          className="w-full py-2.5 px-4 rounded-xl text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
        >
          Conectar depois
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
