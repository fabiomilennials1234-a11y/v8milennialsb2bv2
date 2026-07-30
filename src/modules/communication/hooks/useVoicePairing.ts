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
  // `createVoiceSession`/`requestStreamToken` não aceitam AbortSignal, e
  // `abortRef` só passa a existir DEPOIS que a primeira delas resolve. Se
  // `cancel()` (ou o desmonte) disparar dentro dessa janela, não há nada para
  // abortar — e quando a chamada em voo resolve, a continuação reescreveria
  // `sessionRef`/`abortRef`/status e ressuscitaria um fluxo já cancelado,
  // podendo deixar sessão órfã sem ninguém para usar. Cada `start` incrementa
  // a geração; ao voltar de um `await`, uma geração desatualizada é sinal para
  // abandonar em silêncio, sem tocar em estado.
  const generationRef = useRef(0);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    sessionRef.current = null;
    // Sem isto, um `retry` chamado depois de cancelar cai no ramo "sem
    // sessão" e cria uma sessão nova em silêncio — o operador cancelou e o
    // hook segue tentando de qualquer jeito.
    instanceRef.current = null;
    setStatus("ocioso");
    setQr(null);
    setError(null);
  }, []);

  useEffect(() => () => {
    generationRef.current += 1;
    abortRef.current?.abort();
  }, []);

  const handleEvent = useCallback((event: SessionEvent) => {
    // O stream é da organização INTEIRA, e `sessionId` é opcional no tipo.
    // Por isso o filtro é fail-closed: só passa evento que se identifica E
    // bate com a sessão corrente. A forma permissiva (`event.sessionId &&
    // event.sessionId !== atual`) deixava evento anônimo passar como se fosse
    // meu — com dois admins pareando números diferentes ao mesmo tempo, um
    // veria o QR do outro. O QR é credencial: quem o lê pareia o WhatsApp da
    // organização. Identidade ausente é identidade errada.
    if (event.sessionId !== sessionRef.current) return;

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

  /**
   * Abre (ou reabre) o stream de eventos de uma sessão já criada.
   *
   * Extraído porque `start` E `retry` precisam dele. Sem isto, `retry` pedia
   * QR novo com o stream antigo já morto: o backend emitia o evento e não
   * havia mais ninguém ouvindo, e o estado ficava preso em `aguardando-qr`
   * para sempre — sem erro nenhum. Falha silenciosa é o modo que este projeto
   * mais paga caro.
   */
  const openStream = useCallback(async (tcSessionId: string, generation: number) => {
    // Aborta um stream anterior (o caso do `retry` reabrindo em cima de um
    // que já morreu) para nunca deixar dois vivos ao mesmo tempo.
    abortRef.current?.abort();

    const stream = await requestStreamToken({ tcSessionId, pair: true });
    // Cancelado/desmontado enquanto esperava o token: não há mais tela para
    // atualizar, e criar o controller agora ressuscitaria um fluxo morto.
    if (generationRef.current !== generation) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("aguardando-qr");

    void subscribeSessionEvents({
      vpsUrl: stream.vpsUrl,
      token: stream.token,
      onEvent: handleEvent,
      signal: controller.signal,
    })
      .then(() => {
        // O stream terminou sozinho (sem abort) e o pareamento não concluiu.
        // Sem este ramo o estado ficaria parado esperando um evento que não
        // vem mais — a mesma falha silenciosa, por outra porta.
        if (controller.signal.aborted || generationRef.current !== generation) return;
        // Forma funcional: se um `auth-state` pareou bem no instante em que o
        // stream também terminava, não sobrescrever "pareado" com "falhou".
        setStatus((atual) => (atual === "pareado" ? atual : "falhou"));
        setError((atual) => atual ?? "A conexão com o servidor de voz caiu. Tente de novo.");
      })
      .catch(() => {
        if (controller.signal.aborted || generationRef.current !== generation) return;
        setStatus("falhou");
        setError("A conexão com o servidor de voz caiu. Tente de novo.");
      });
  }, [handleEvent]);

  const start = useCallback(async (whatsappInstanceId: string) => {
    const generation = ++generationRef.current;
    instanceRef.current = whatsappInstanceId;
    setError(null);
    setQr(null);
    setStatus("criando");
    try {
      const { tcSessionId } = await createVoiceSession({ whatsappInstanceId });
      if (generationRef.current !== generation) return; // cancelado enquanto a sessão era criada
      sessionRef.current = tcSessionId;
      await openStream(tcSessionId, generation);
    } catch (err) {
      if (generationRef.current !== generation) return;
      setStatus("falhou");
      setError(
        err instanceof VoiceControlError
          ? err.message
          : "Não foi possível iniciar o pareamento.",
      );
    }
  }, [openStream]);

  /**
   * Tentar de novo NÃO recria a sessão. Se recriasse, três tentativas
   * frustradas deixariam três sessões órfãs e estourariam o teto da
   * organização — e o cliente veria "limite atingido" logo depois de falhar
   * ao conectar o primeiro número.
   *
   * Reabre o stream ANTES de pedir o QR novo: se a ordem fosse invertida, o
   * backend poderia emitir o evento antes de existir alguém ouvindo, e o
   * pareamento morreria em silêncio de novo.
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
    const generation = generationRef.current;
    setError(null);
    setQr(null);
    try {
      await openStream(tcSessionId, generation);
      // `cancel()` pode ter disparado enquanto o stream reabria (antes de
      // `abortRef` existir para abortar). Sem este retorno, `pairVoiceSession`
      // ainda pediria QR novo pro backend depois que o operador já desistiu.
      if (generationRef.current !== generation) return;
      await pairVoiceSession({ tcSessionId });
    } catch (err) {
      if (generationRef.current !== generation) return;
      setStatus("falhou");
      setError(
        err instanceof VoiceControlError ? err.message : "Não foi possível gerar outro código.",
      );
    }
  }, [start, openStream]);

  return { status, qr, error, start, retry, cancel };
}
