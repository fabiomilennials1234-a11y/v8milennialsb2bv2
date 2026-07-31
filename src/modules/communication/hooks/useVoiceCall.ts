/**
 * Máquina de estado da chamada de voz do operador (TorqueCalls, S14).
 *
 * A ordem das etapas é a parte que importa, e ela é o inverso da intuição:
 * o MICROFONE e o CAMINHO DE ÁUDIO são preparados ANTES de discar.
 *
 * Pedir depois seria pior de duas maneiras. O navegador só concede microfone
 * dentro de um gesto do usuário — depois de um `await` de rede a permissão
 * costuma ser negada sem diálogo, e o vendedor vê "sem áudio" sem entender por
 * quê. E, mais caro que isso: se a permissão falhar depois da autorização, o
 * telefone do lead já tocou. Ligação que toca e não fala é a pior saída possível
 * — gasta a cota, incomoda o cliente e conta como tentativa. Pela mesma razão o
 * AudioContext e o worklet de captura sobem antes de autorizar: navegador sem
 * AudioWorklet não pode fazer o telefone do lead tocar.
 *
 * ─── Transporte do áudio ─────────────────────────────────────────────────────
 * A VPS NÃO troca mídia RTP com o navegador. Ela abre a chamada, negocia
 * WebRTC e espera que o navegador crie um canal de dados rotulado `pcm`, por
 * onde trafega PCM cru — Int16 LE, 16 kHz, mono — nos dois sentidos
 * (`cmd/server/bridge.go`). Ela nunca chama `AddTrack`.
 *
 * Este hook já mandou faixa RTP e esperou faixa RTP de volta. O resultado era o
 * pior defeito possível: a chamada conectava, o cronômetro corria, a tela dizia
 * "Em chamada" — e não havia som em nenhum dos dois sentidos, sem erro em lado
 * nenhum. Cada ponta achava que tinha feito a sua parte.
 *
 * ─── De onde vem a FASE ──────────────────────────────────────────────────────
 * Da VPS, pelo stream de eventos — nunca do `RTCPeerConnection`.
 *
 * A distinção não é acadêmica; ela custou três defeitos em produção no mesmo
 * dia. `pc.connectionState === "connected"` significa que a mídia entre o
 * NAVEGADOR e a VPS está de pé, e isso acontece em ~200 ms, enquanto o telefone
 * do lead ainda toca. Derivar "Em chamada" daí fazia a tela anunciar uma
 * conversa que não tinha começado, com o cronômetro correndo.
 *
 * O inverso era pior. O `RTCPeerConnection` não tem como saber que a pessoa do
 * outro lado desligou: quem sabe é a VPS, que fala WhatsApp. Sem ouvi-la, o
 * navegador seguia achando que estava em chamada, o pedido de desligar batia
 * numa chamada que já não existia, e a fase parava em `ending` — com o botão
 * Desligar desabilitado e o `VoiceCallProvider` reportando `busy: true` para
 * sempre. O sintoma que o operador via era "diz que eu já estou em chamada".
 *
 * Quem manda, portanto:
 *   - `call-status` com `status: "connected"`  → atendeu   → `active`
 *   - `call-ended` (ou `status: "ended"`)      → acabou    → `ended`
 * `connectionState` sobrou com um papel só: `failed` é mídia morta, e mídia
 * morta encerra a chamada em vez de estacionar a tela.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useOrganization } from "@/modules/identity";
import {
  CallDeniedError,
  endCall as endCallRequest,
  exchangeSdp,
  requestStreamToken,
  startCall as startCallRequest,
} from "@/modules/communication/lib/torquecallsApi";
import {
  subscribeSessionEvents,
  type SessionEvent,
} from "@/modules/communication/lib/torquecallsEvents";
import {
  startPcmAudio,
  type PcmAudioSession,
} from "@/modules/communication/lib/voicePcmSession";

/** Rótulo exigido pela VPS. Qualquer outro é ignorado por ela, em silêncio. */
const PCM_CHANNEL_LABEL = "pcm";

/**
 * Um datagrama de áudio que chega tarde não vale nada — retransmitir só empurra
 * atraso para dentro da conversa. Daí `maxRetransmits: 0`: o SCTP abandona o
 * quadro perdido em vez de segurar a fila esperando por ele.
 *
 * `ordered` FICA LIGADO, e isso é deliberado. O formato do canal é PCM cru, sem
 * número de sequência: se dois quadros trocarem de lugar na rede, não há como
 * detectar nem corrigir — os 20 ms saem fora de ordem e a voz sai picotada. Com
 * entrega ordenada + confiabilidade parcial, o SCTP pula o que foi abandonado
 * (FORWARD-TSN) e entrega o resto na ordem: some o bloqueio de cabeça de fila
 * da retransmissão sem abrir mão da ordem, que aqui é o que carrega o sinal.
 */
const PCM_CHANNEL_INIT: RTCDataChannelInit = { ordered: true, maxRetransmits: 0 };

/**
 * Motivos que a VPS manda em `call-ended` (`internal/voip/core/types.go`).
 *
 * Traduzidos porque a diferença entre eles é a informação que decide o próximo
 * passo do vendedor: "não atendeu" pede outra tentativa mais tarde, "recusou"
 * não pede nenhuma, e "ocupado" pede uma agora.
 */
const END_REASON_MESSAGES: Record<string, string> = {
  user_ended: "Chamada encerrada.",
  declined: "A pessoa recusou a chamada.",
  timeout: "A pessoa não atendeu.",
  busy: "A linha estava ocupada.",
  cancelled: "A chamada foi cancelada.",
  failed: "A chamada caiu.",
  do_not_disturb: "O aparelho está em Não Perturbe.",
  unknown: "Chamada encerrada.",
  /** Não vem da VPS: é o nosso próprio diagnóstico de mídia morta. */
  media_failed: "A conexão de áudio caiu.",
};

/**
 * Teto para o stream ficar de pé antes de o telefone tocar.
 *
 * Não é um limiar de qualidade nem uma tentativa de adivinhar a rede: é o prazo
 * máximo que a discagem espera pela confirmação de que o assinante já está na
 * lista do broker. O caminho normal não chega perto — a VPS emite `session-list`
 * no instante em que o assinante entra (`SnapshotFn`, `cmd/server/broker.go`),
 * então o primeiro evento volta junto com os cabeçalhos. O teto existe só para
 * que uma VPS muda não deixe o vendedor olhando para um botão travado.
 */
const STREAM_OPEN_GRACE_MS = 2000;

export type CallPhase =
  | "idle"
  | "requesting_mic"
  | "authorizing"
  | "negotiating"
  | "ringing"
  | "active"
  | "ending"
  /** Terminal e informativo: a chamada acabou e o operador ainda não leu por quê. */
  | "ended"
  | "failed";

export interface VoiceCallState {
  phase: CallPhase;
  /** Mensagem já em português, pronta para a tela. */
  error: string | null;
  /** Código cru da recusa, para telemetria e para decidir o que oferecer. */
  errorCode: string | null;
  /** Por que a chamada acabou, em português. Só preenchido na fase `ended`. */
  endReason: string | null;
  callId: string | null;
  peer: string | null;
  muted: boolean;
  /** Segundos desde que a mídia ficou de pé. Zero enquanto não conectou. */
  elapsedSeconds: number;
}

const INITIAL: VoiceCallState = {
  phase: "idle",
  error: null,
  errorCode: null,
  endReason: null,
  callId: null,
  peer: null,
  muted: false,
  elapsedSeconds: 0,
};

export function useVoiceCall(tcSessionId: string | null) {
  // Mesma exigência de `_shared/voip/caller.ts`: master não pertence a uma
  // organização só, e sem este campo `startCall`/`endCall` voltam 400 pra
  // qualquer master que tente discar.
  const { organizationId } = useOrganization();
  const [state, setState] = useState<VoiceCallState>(INITIAL);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<PcmAudioSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Vida do stream de eventos. Separado do `abortRef` da troca de SDP porque os
   *  dois têm ciclos diferentes: o SDP acaba, o stream dura a chamada inteira. */
  const streamAbortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<number | null>(null);
  /**
   * Identidade da chamada corrente, em ref e não em estado.
   *
   * O ouvinte do stream é registrado UMA vez, no começo da chamada, e precisa
   * comparar cada evento com a chamada atual. Lido do estado, ele leria o valor
   * do render em que foi criado — que é `null`, porque o stream sobe antes de a
   * chamada existir. `tcCallId` é a identidade que a VPS usa; `callId` é a do
   * ledger do CRM, e é a que o `endCall` espera.
   */
  const tcCallIdRef = useRef<string | null>(null);
  const callIdRef = useRef<string | null>(null);
  /** Sobe a cada teardown. Invalida um `startPcmAudio` que ainda esteja em voo. */
  const audioGenRef = useRef(0);
  /** Trava de reentrância: dois cliques não podem virar duas chamadas. */
  const startingRef = useRef(false);

  /** Solta microfone, canal, caminho de áudio, stream de eventos e
   *  PeerConnection. Idempotente de propósito: é chamada no erro, no
   *  encerramento e no unmount, e as três podem coincidir. */
  const teardown = useCallback(() => {
    audioGenRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;

    // O stream morre junto com a chamada. Deixá-lo aberto vaza uma conexão SSE
    // por ligação e, pior, deixa um ouvinte de chamada morta reagindo a evento
    // novo — o `call-ended` da PRÓXIMA ligação derrubaria a tela dela.
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;

    // Sem zerar a identidade, um evento atrasado da chamada que acabou de morrer
    // ainda casaria com o filtro.
    tcCallIdRef.current = null;
    callIdRef.current = null;

    // O canal fecha ANTES do PeerConnection: a VPS aceita um único canal `pcm`
    // por chamada e recusa o segundo. Deixar o antigo pendurado queima o slot.
    if (channelRef.current) {
      channelRef.current.onmessage = null;
      try {
        channelRef.current.close();
      } catch {
        // Canal já derrubado junto com o transporte.
      }
      channelRef.current = null;
    }

    // Derruba AudioContext, worklet de captura e reprodução. Sem isto o grafo de
    // áudio segue vivo puxando o microfone depois de a chamada morrer.
    audioRef.current?.stop();
    audioRef.current = null;

    pcRef.current?.close();
    pcRef.current = null;

    // Parar as trilhas é o que apaga o indicador de microfone do navegador.
    // Sem isto o vendedor continua vendo a bolinha vermelha depois de desligar e
    // conclui, com razão, que o sistema ainda está ouvindo.
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;

    startedAtRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  // Cronômetro da chamada. Roda só quando há mídia de pé.
  useEffect(() => {
    if (state.phase !== "active") return;
    const id = setInterval(() => {
      const started = startedAtRef.current;
      if (started) {
        setState((s) => ({ ...s, elapsedSeconds: Math.floor((Date.now() - started) / 1000) }));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [state.phase]);

  const fail = useCallback(
    (message: string, code: string | null) => {
      teardown();
      setState({ ...INITIAL, phase: "failed", error: message, errorCode: code });
    },
    [teardown],
  );

  /**
   * A chamada acabou por decisão de fora: o outro lado desligou, o WhatsApp
   * derrubou, ou a mídia morreu. NÃO é o operador clicando em Desligar — esse
   * caminho é o `hangup`, e ele volta direto para `idle` porque quem desligou
   * já sabe por quê.
   *
   * Avisar o servidor é obrigatório aqui, e é o conserto do "disse que eu já
   * estava em chamada". A VPS encerra a chamada dela, mas o `voip_calls` do CRM
   * não tem quem o feche — o webhook de fim de chamada (S11) ainda não existe.
   * Sem este aviso a linha fica aberta segurando a cota do operador, e a
   * tentativa seguinte volta `operator_busy` até o reaper passar.
   */
  const finish = useCallback(
    (reason: string | null) => {
      // Só a PRIMEIRA causa vale. Desligar derruba a mídia, então o `failed` do
      // `RTCPeerConnection` chega logo depois de todo `call-ended` — e sem esta
      // guarda ele reescreveria "A pessoa recusou a chamada" por "A conexão de
      // áudio caiu", trocando o motivo verdadeiro por um sintoma. O ref é
      // zerado pelo teardown, então ele é exatamente "há chamada viva aqui".
      if (!tcCallIdRef.current) return;

      const callId = callIdRef.current;
      teardown();
      setState({
        ...INITIAL,
        phase: "ended",
        endReason: END_REASON_MESSAGES[reason ?? "unknown"] ?? END_REASON_MESSAGES.unknown,
      });
      if (tcSessionId && callId) {
        void endCallRequest({
          tcSessionId,
          callId,
          organizationId: organizationId ?? undefined,
        }).catch(() => {
          // `endCall` já trata "essa chamada não existe mais" como sucesso. O
          // que sobra aqui é rede caída — e o `ctl` de 30 minutos mais o reaper
          // do servidor cobrem esse caso. Travar a tela não cobriria nada.
        });
      }
    },
    [teardown, tcSessionId, organizationId],
  );

  /**
   * Único lugar que decide a fase a partir da VPS.
   *
   * O stream é da ORGANIZAÇÃO inteira — `publish` (`cmd/server/broker.go`)
   * filtra por org, não por chamada. Chegam aqui os eventos das ligações de
   * todos os colegas. O filtro é fail-closed, como em `useVoicePairing`: evento
   * sem identidade não é meu. A forma permissiva ("passa se não disser de quem
   * é") faria o `call-ended` do colega fechar a minha tela no meio da conversa.
   */
  const handleCallEvent = useCallback(
    (event: SessionEvent) => {
      const id = typeof event.id === "string" ? event.id : null;
      if (!id || id !== tcCallIdRef.current) return;

      if (event.type === "call-status") {
        if (event.status === "connected") {
          // AQUI, e só aqui, a pessoa atendeu. O cronômetro nasce deste
          // instante — não do momento em que a mídia com a VPS ficou de pé.
          if (startedAtRef.current === null) startedAtRef.current = Date.now();
          setState((s) =>
            s.phase === "negotiating" || s.phase === "ringing" ? { ...s, phase: "active" } : s,
          );
          return;
        }
        if (event.status !== "ended") return;
      } else if (event.type !== "call-ended") {
        return;
      }

      finish(typeof event.reason === "string" ? event.reason : null);
    },
    [finish],
  );

  /**
   * Entrega um quadro capturado ao canal, ou o joga fora.
   *
   * Jogar fora é a parte deliberada. O pacer da VPS (`cmd/server/pacer.go`)
   * encerra a chamada quando recebe mais de 16000 amostras/s sustentado por 3 s.
   * Enfileirar os quadros enquanto o canal ainda não abriu e despejá-los na
   * abertura seria exatamente essa rajada — o conserto do silêncio viraria uma
   * chamada derrubada. O worklet produz em tempo real; quadro sem canal morre.
   */
  const sendPcm = useCallback((frame: ArrayBuffer) => {
    const channel = channelRef.current;
    if (channel?.readyState !== "open") return;
    try {
      channel.send(frame);
    } catch {
      // O canal caiu entre o teste e o envio; o teardown resolve o resto.
    }
  }, []);

  /**
   * Abre o stream de eventos e só volta quando a VPS já nos vê.
   *
   * A ORDEM é o conserto, e a alternativa foi descartada de propósito. Abrir o
   * stream depois de discar deixa uma janela em que a pessoa pode atender antes
   * de existir alguém ouvindo: o `call-status: connected` é publicado para os
   * assinantes daquele instante e some — o broker não reenvia. A tela ficaria
   * em "Chamando…" durante a conversa inteira, e um `call-ended` perdido a
   * deixaria presa para sempre. Nenhum relógio conserta um evento que não
   * chegou; abrir antes conserta.
   *
   * "Já nos vê" é o primeiro evento recebido. A VPS emite `session-list` para
   * todo assinante novo, no instante da inscrição (`SnapshotFn`), então esse
   * primeiro evento é a confirmação de que a inscrição entrou na lista do
   * broker — que é exatamente o que precisa ser verdade antes de o telefone
   * tocar. `subscribeSessionEvents` não serve para isso: a promessa dele só
   * assenta quando o stream MORRE.
   */
  const openEventStream = useCallback(
    async (sessionId: string) => {
      // `pair: true` fica de fora: aquele token faz o QR de pareamento trafegar
      // no stream e exige `voip.session.manage`. Uma chamada não precisa de
      // nenhum dos dois, e credencial pedida à toa é credencial vazada à toa.
      const stream = await requestStreamToken({
        tcSessionId: sessionId,
        organizationId: organizationId ?? undefined,
      });

      const controller = new AbortController();
      streamAbortRef.current = controller;

      let markOpen!: () => void;
      const opened = new Promise<void>((resolve) => {
        markOpen = resolve;
      });

      void subscribeSessionEvents({
        vpsUrl: stream.vpsUrl,
        token: stream.token,
        onEvent: (event) => {
          markOpen();
          handleCallEvent(event);
        },
        signal: controller.signal,
      })
        .catch(() => {
          // O stream caiu. A chamada em si continua viva na VPS e o operador
          // ainda tem o botão Desligar; o que se perde é a atualização de fase.
        })
        .finally(markOpen);

      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        opened,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, STREAM_OPEN_GRACE_MS);
        }),
      ]);
      clearTimeout(timer);
    },
    [handleCallEvent, organizationId],
  );

  const start = useCallback(
    async (leadId: string) => {
      if (!tcSessionId) {
        fail("Nenhum número de chamadas configurado.", "session_not_found");
        return;
      }
      // Duplo clique no botão discaria duas vezes para o mesmo lead e abriria um
      // segundo canal `pcm`, que a VPS recusa.
      if (startingRef.current || pcRef.current) return;
      startingRef.current = true;

      try {
        // 1. MICROFONE PRIMEIRO. Ver o comentário no topo do arquivo.
        setState({ ...INITIAL, phase: "requesting_mic" });
        let mic: MediaStream;
        try {
          mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
        } catch {
          fail(
            "Não foi possível usar o microfone. Autorize o acesso no navegador e tente de novo.",
            "mic_denied",
          );
          return;
        }
        micRef.current = mic;

        // 2. CAMINHO DE ÁUDIO, ainda antes de discar. O AudioContext e o worklet
        //    de captura vivem fora da árvore do React — pela mesma razão que o
        //    <audio> antigo vivia: um remount do painel derrubaria o áudio no
        //    meio da conversa. Falhar aqui é falhar sem tocar o telefone do lead.
        const generation = audioGenRef.current;
        let audio: PcmAudioSession;
        try {
          audio = await startPcmAudio({ stream: mic, send: sendPcm });
        } catch {
          fail(
            "Este navegador não conseguiu preparar o áudio da chamada. Atualize o navegador e tente de novo.",
            "audio_unsupported",
          );
          return;
        }
        if (generation !== audioGenRef.current) {
          // Desligaram (ou desmontaram) enquanto o worklet carregava.
          audio.stop();
          return;
        }
        audioRef.current = audio;

        // 3. STREAM DE EVENTOS, ainda antes de discar — mesma doutrina do
        //    microfone e do worklet, pelo mesmo motivo: o que não puder ser
        //    OBSERVADO não deve fazer o telefone do lead tocar. Uma chamada sem
        //    stream nunca sai de "Chamando…", nunca descobre que o outro lado
        //    desligou e deixa o operador travado — falhar aqui custa zero,
        //    porque nada tocou ainda.
        setState((s) => ({ ...s, phase: "authorizing" }));
        try {
          await openEventStream(tcSessionId);
        } catch {
          fail(
            "Não foi possível acompanhar o estado da chamada. Tente de novo.",
            "stream_failed",
          );
          return;
        }

        // 4. Autorização: governor, consentimento, cota. Só aqui o telefone toca.
        let call;
        try {
          call = await startCallRequest({
            tcSessionId,
            leadId,
            organizationId: organizationId ?? undefined,
          });
        } catch (e) {
          if (e instanceof CallDeniedError) fail(e.message, e.code);
          else fail(e instanceof Error ? e.message : "Falha ao iniciar a chamada", null);
          return;
        }

        if (!call.tcCallId) {
          fail("A chamada foi autorizada mas não chegou ao WhatsApp.", "no_tc_call_id");
          return;
        }

        // A identidade tem que existir ANTES do primeiro `await` seguinte: o
        // stream já está aberto e o `connected` de quem atende rápido pode
        // chegar durante a troca de SDP. Sem estas duas linhas, esse evento cai
        // no filtro por não bater com nada.
        tcCallIdRef.current = call.tcCallId;
        callIdRef.current = call.callId;
        setState((s) => ({ ...s, phase: "negotiating", callId: call.callId, peer: call.peer }));

        // 5. WebRTC — só canal de dados, nenhuma faixa de mídia.
        try {
          const pc = new RTCPeerConnection();
          pcRef.current = pc;

          // O canal TEM que nascer aqui, antes de `createOffer`. O SDP é uma
          // fotografia do estado do PeerConnection no momento da oferta: canal
          // criado depois não gera `m=application`, a VPS nunca recebe o canal,
          // e a chamada volta a conectar muda — sem erro em lado nenhum.
          const channel = pc.createDataChannel(PCM_CHANNEL_LABEL, PCM_CHANNEL_INIT);
          channel.binaryType = "arraybuffer";
          channel.onmessage = (ev: MessageEvent) => {
            // A VPS manda 960 amostras (60 ms) por mensagem, sem cabeçalho.
            if (ev.data instanceof ArrayBuffer) audioRef.current?.enqueue(ev.data);
          };
          channelRef.current = channel;

          // O `connectionState` NÃO decide mais a fase — ver o cabeçalho do
          // arquivo. `connected` aqui é a mídia navegador↔VPS de pé, que sobe
          // enquanto o telefone ainda toca; quem diz que a pessoa atendeu é a
          // VPS, por `call-status`.
          //
          // `disconnected` também saiu: em WebRTC ele é transitório e costuma se
          // recuperar sozinho. Tratá-lo como fim parava a tela em "Encerrando…"
          // no primeiro soluço de rede, e de lá não havia volta.
          //
          // Sobra `failed`, que é terminal de verdade. E ele ENCERRA em vez de
          // estacionar: uma chamada sem áudio não é uma chamada, e deixar a fase
          // em `ending` é o que travava o operador para sempre.
          pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed") finish("media_failed");
          };

          // Sem `offerToReceiveAudio`: pedir uma faixa que a VPS nunca vai
          // preencher só suja o SDP com um `m=audio` morto.
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await waitForIceGathering(pc);

          abortRef.current = new AbortController();
          const answer = await exchangeSdp({
            vpsUrl: call.vpsUrl,
            tcSessionId,
            tcCallId: call.tcCallId,
            mediaToken: call.media,
            sdpOffer: pc.localDescription?.sdp ?? offer.sdp ?? "",
            signal: abortRef.current.signal,
          });

          await pc.setRemoteDescription({ type: "answer", sdp: answer });
          setState((s) => ({ ...s, phase: "ringing" }));
        } catch (e) {
          // A chamada JÁ foi autorizada e pode já estar tocando. Encerrar no
          // servidor é obrigatório aqui: abandonar o fluxo deixaria o telefone do
          // lead tocando sem ninguém do outro lado.
          void endCallRequest({
            tcSessionId,
            callId: call.callId,
            organizationId: organizationId ?? undefined,
          }).catch(() => {});
          fail(e instanceof Error ? e.message : "Falha ao estabelecer o áudio", "media_failed");
          return;
        }
      } finally {
        startingRef.current = false;
      }
    },
    [tcSessionId, fail, finish, openEventStream, organizationId, sendPcm],
  );

  /**
   * O operador desligou. Volta para `idle` sem cartão de motivo: quem desligou
   * já sabe por quê, e um aviso a mais seria só mais um clique entre ele e a
   * próxima ligação.
   *
   * `callIdRef` vem antes de `state.callId` porque o teardown pode ter zerado o
   * estado antes deste clique ser processado, e desligar sem avisar o servidor
   * é o que deixa a linha presa.
   */
  const hangup = useCallback(async () => {
    const callId = callIdRef.current ?? state.callId;
    setState((s) => ({ ...s, phase: "ending" }));
    teardown();

    if (tcSessionId && callId) {
      try {
        await endCallRequest({ tcSessionId, callId, organizationId: organizationId ?? undefined });
      } catch {
        // `endCall` já trata "essa chamada não existe mais" como sucesso; o que
        // sobra é rede caída. A mídia local já caiu e o `ctl` de 30 minutos
        // ainda vale, então o reaper fecha a linha. Travar a tela num erro que o
        // vendedor não pode resolver seria pior que seguir.
      }
    }
    // Fora do `if` e sem condição de fase: é ESTA linha que garante que
    // "Encerrando…" nunca é um estado final.
    setState(INITIAL);
  }, [state.callId, tcSessionId, teardown, organizationId]);

  const toggleMute = useCallback(() => {
    const tracks = micRef.current?.getAudioTracks() ?? [];
    const next = !(tracks[0]?.enabled === false);
    tracks.forEach((t) => {
      t.enabled = !next;
    });
    setState((s) => ({ ...s, muted: next }));
  }, []);

  const dismiss = useCallback(() => setState(INITIAL), []);

  return { state, start, hangup, toggleMute, dismiss };
}

/**
 * Espera o ICE terminar de juntar candidatos.
 *
 * A VPS troca SDP em UMA requisição — não há canal para trickle ICE. Mandar a
 * oferta antes de os candidatos entrarem produz uma oferta sem caminho de rede,
 * e o sintoma é uma chamada que conecta e não tem áudio.
 *
 * O teto de 3s existe porque `icegatheringstatechange` pode não chegar a
 * `complete` quando um servidor STUN não responde; nesse caso os candidatos
 * locais já bastam em rede local ou via ICE-TCP.
 */
function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 3000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}
