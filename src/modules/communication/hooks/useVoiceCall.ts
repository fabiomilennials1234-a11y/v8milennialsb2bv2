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
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useOrganization } from "@/modules/identity";
import {
  CallDeniedError,
  endCall as endCallRequest,
  exchangeSdp,
  startCall as startCallRequest,
} from "@/modules/communication/lib/torquecallsApi";
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

export type CallPhase =
  | "idle"
  | "requesting_mic"
  | "authorizing"
  | "negotiating"
  | "ringing"
  | "active"
  | "ending"
  | "failed";

export interface VoiceCallState {
  phase: CallPhase;
  /** Mensagem já em português, pronta para a tela. */
  error: string | null;
  /** Código cru da recusa, para telemetria e para decidir o que oferecer. */
  errorCode: string | null;
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
  const startedAtRef = useRef<number | null>(null);
  /** Sobe a cada teardown. Invalida um `startPcmAudio` que ainda esteja em voo. */
  const audioGenRef = useRef(0);
  /** Trava de reentrância: dois cliques não podem virar duas chamadas. */
  const startingRef = useRef(false);

  /** Solta microfone, canal, caminho de áudio e PeerConnection. Idempotente de
   *  propósito: é chamada no erro, no encerramento e no unmount, e as três podem
   *  coincidir. */
  const teardown = useCallback(() => {
    audioGenRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;

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

        // 3. Autorização: governor, consentimento, cota. Só aqui o telefone toca.
        setState((s) => ({ ...s, phase: "authorizing" }));
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

        setState((s) => ({ ...s, phase: "negotiating", callId: call.callId, peer: call.peer }));

        // 4. WebRTC — só canal de dados, nenhuma faixa de mídia.
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

          pc.onconnectionstatechange = () => {
            const st = pc.connectionState;
            if (st === "connected") {
              if (startedAtRef.current === null) startedAtRef.current = Date.now();
              setState((s) => (s.phase === "ending" ? s : { ...s, phase: "active" }));
            } else if (st === "failed" || st === "disconnected" || st === "closed") {
              setState((s) => (s.phase === "idle" ? s : { ...s, phase: "ending" }));
            }
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
    [tcSessionId, fail, organizationId, sendPcm],
  );

  const hangup = useCallback(async () => {
    const callId = state.callId;
    setState((s) => ({ ...s, phase: "ending" }));
    teardown();

    if (tcSessionId && callId) {
      try {
        await endCallRequest({ tcSessionId, callId, organizationId: organizationId ?? undefined });
      } catch {
        // Encerrar no servidor falhou, mas a mídia local já caiu e o `ctl` de 30
        // minutos ainda vale. O reaper fecha a linha. Travar a tela num erro que
        // o vendedor não pode resolver seria pior que seguir.
      }
    }
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
