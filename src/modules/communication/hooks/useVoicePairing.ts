import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createVoiceSession,
  pairVoiceSession,
  requestStreamToken,
  VoiceControlError,
} from "@/modules/communication/lib/torquecallsApi";
import {
  subscribeSessionEvents,
  type SessionEvent,
} from "@/modules/communication/lib/torquecallsEvents";

export type PairingStatus =
  | "ocioso" | "criando" | "aguardando-qr" | "qr-na-tela" | "pareado" | "falhou";

/**
 * Orquestra o pareamento de um número.
 *
 * O QR vive só aqui, em memória, e é descartado assim que o pareamento
 * conclui: quem o lê pareia o WhatsApp da organização, então ele não fica na
 * tela nem um segundo a mais do que precisa.
 */
export function useVoicePairing() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<PairingStatus>("ocioso");
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  // Guardado para que `retry` saiba recomeçar quando a falha aconteceu antes
  // de existir sessão.
  const instanceRef = useRef<string | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionRef.current = null;
    setStatus("ocioso");
    setQr(null);
    setError(null);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleEvent = useCallback((event: SessionEvent) => {
    // O stream é da organização inteira. Sem este filtro, o QR de outro
    // número apareceria no modal errado.
    if (event.sessionId && event.sessionId !== sessionRef.current) return;

    if (event.type === "session-qr" && typeof event.qr === "string") {
      setQr(event.qr);
      setStatus("qr-na-tela");
      return;
    }
    if (event.type === "auth-state" && event.paired === true) {
      setQr(null);
      setStatus("pareado");
      abortRef.current?.abort();
      abortRef.current = null;
      void queryClient.invalidateQueries({ queryKey: ["voip_sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp_instances"] });
    }
  }, [queryClient]);

  const start = useCallback(async (whatsappInstanceId: string) => {
    instanceRef.current = whatsappInstanceId;
    setError(null);
    setQr(null);
    setStatus("criando");
    try {
      const { tcSessionId } = await createVoiceSession({ whatsappInstanceId });
      sessionRef.current = tcSessionId;

      const stream = await requestStreamToken({ tcSessionId, pair: true });
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("aguardando-qr");

      void subscribeSessionEvents({
        vpsUrl: stream.vpsUrl,
        token: stream.token,
        onEvent: handleEvent,
        signal: controller.signal,
      }).catch(() => {
        if (controller.signal.aborted) return;
        setStatus("falhou");
        setError("A conexão com o servidor de voz caiu. Tente de novo.");
      });
    } catch (err) {
      setStatus("falhou");
      setError(
        err instanceof VoiceControlError
          ? err.message
          : "Não foi possível iniciar o pareamento.",
      );
    }
  }, [handleEvent]);

  /**
   * Tentar de novo NÃO recria a sessão. Se recriasse, três tentativas
   * frustradas deixariam três sessões órfãs e estourariam o teto da
   * organização — e o cliente veria "limite atingido" logo depois de falhar
   * ao conectar o primeiro número.
   */
  const retry = useCallback(async () => {
    const tcSessionId = sessionRef.current;
    // Falhou antes de a sessão existir (gate, teto, rede): aí sim é caso de
    // criar. A decisão fica aqui, e não na tela, porque só o hook sabe se
    // chegou a existir sessão.
    if (!tcSessionId) {
      if (instanceRef.current) await start(instanceRef.current);
      return;
    }
    setError(null);
    setQr(null);
    setStatus("aguardando-qr");
    try {
      await pairVoiceSession({ tcSessionId });
    } catch (err) {
      setStatus("falhou");
      setError(
        err instanceof VoiceControlError ? err.message : "Não foi possível gerar outro código.",
      );
    }
  }, [start]);

  return { status, qr, error, start, retry, cancel };
}
