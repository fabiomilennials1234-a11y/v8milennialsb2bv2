import { useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useVoicePairing } from "@/modules/communication/hooks/useVoicePairing";

interface VoicePairingDialogProps {
  instanceId: string;
  instanceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal de pareamento self-service da voz (TorqueCalls).
 *
 * O QR é credencial: quem o lê pareia o WhatsApp da organização inteira. Por
 * isso ele só existe em memória (dentro de `useVoicePairing`) e nunca é
 * persistido, logado, ou colocado em atributo que vaze pra log/telemetria.
 */
export function VoicePairingDialog({
  instanceId,
  instanceName,
  open,
  onOpenChange,
}: VoicePairingDialogProps) {
  const { status, qr, error, start, cancel, retry } = useVoicePairing();

  // Guarda o instanceId para o qual `start` já disparou nesta abertura — não
  // o `status`. Colocar `status` nas dependências do efeito acopla o gatilho
  // de abertura às transições internas do próprio hook (start muda o status
  // que o efeito observa), criando risco de laço. Um ref imune ao status
  // garante exatamente uma chamada por abertura, e reseta ao fechar para que
  // reabrir dispare de novo.
  const startedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      startedForRef.current = null;
      cancel();
      return;
    }
    if (startedForRef.current !== instanceId) {
      startedForRef.current = instanceId;
      void start(instanceId);
    }
  }, [open, instanceId, start, cancel]);

  const isLoading = status === "ocioso" || status === "criando" || status === "aguardando-qr";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ativar voz em {instanceName}</DialogTitle>
          <DialogDescription>
            No celular: WhatsApp → Aparelhos conectados → Conectar aparelho.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[18rem] flex-col items-center justify-center gap-4">
          {isLoading && (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">Gerando o código…</p>
            </>
          )}

          {status === "qr-na-tela" && qr && (
            <>
              {/* Fundo branco fixo mesmo no tema escuro: leitor de QR precisa
                  de contraste alto e consistente entre celulares, e o
                  produto é dark-first por padrão — este é o ponto exato onde
                  a exceção se justifica. */}
              <div data-testid="voice-pairing-qr" className="rounded-lg bg-white p-4">
                <QRCodeSVG value={qr} size={224} level="L" />
              </div>
              <p className="text-sm text-muted-foreground">
                O código se renova sozinho a cada poucos segundos.
              </p>
            </>
          )}

          {status === "pareado" && (
            <>
              <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
              <p className="text-sm font-medium">Voz ativada em {instanceName}.</p>
              <Button onClick={() => onOpenChange(false)}>Concluir</Button>
            </>
          )}

          {status === "falhou" && (
            <>
              <TriangleAlert className="h-8 w-8 text-destructive" aria-hidden="true" />
              <p className="max-w-sm text-center text-sm">{error}</p>
              {/* Só `retry`, nunca `start`: o hook decide sozinho entre pedir
                  QR novo na sessão existente e recomeçar do zero, porque só
                  ele sabe se chegou a existir sessão. Chamar `start` aqui
                  criaria sessão nova a cada tentativa e estouraria o teto de
                  sessões da organização com órfãs. */}
              <Button variant="outline" onClick={() => void retry()}>
                Tentar de novo
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
