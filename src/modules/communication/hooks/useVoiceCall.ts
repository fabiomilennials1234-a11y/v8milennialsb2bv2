/**
 * Máquina de estado da chamada de voz do operador (TorqueCalls, S14).
 *
 * A ordem das etapas é a parte que importa, e ela é o inverso da intuição:
 * o MICROFONE é pedido ANTES de discar.
 *
 * Pedir depois seria pior de duas maneiras. O navegador só concede microfone
 * dentro de um gesto do usuário — depois de um `await` de rede a permissão
 * costuma ser negada sem diálogo, e o vendedor vê "sem áudio" sem entender por
 * quê. E, mais caro que isso: se a permissão falhar depois da autorização, o
 * telefone do lead já tocou. Ligação que toca e não fala é a pior saída possível
 * — gasta a cota, incomoda o cliente e conta como tentativa.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useOrganization } from "@/modules/identity";
import {
  CallDeniedError,
  endCall as endCallRequest,
  exchangeSdp,
  startCall as startCallRequest,
} from "@/modules/communication/lib/torquecallsApi";

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<number | null>(null);

  /** Solta microfone, PeerConnection e áudio remoto. Idempotente de propósito:
   *  é chamada no erro, no encerramento e no unmount, e as três podem coincidir. */
  const teardown = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;

    // Parar as trilhas é o que apaga o indicador de microfone do navegador.
    // Sem isto o vendedor continua vendo a bolinha vermelha depois de desligar e
    // conclui, com razão, que o sistema ainda está ouvindo.
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;

    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.remove();
      audioRef.current = null;
    }
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

  const start = useCallback(
    async (leadId: string) => {
      if (!tcSessionId) {
        fail("Nenhum número de chamadas configurado.", "session_not_found");
        return;
      }

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

      // 2. Autorização: governor, consentimento, cota. Só aqui o telefone toca.
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

      // 3. WebRTC. O áudio remoto toca num <audio> criado aqui e destruído no
      //    teardown — anexar ao DOM da árvore React faria a chamada morrer com a
      //    primeira re-renderização que desmontasse o painel.
      try {
        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        mic.getTracks().forEach((t) => pc.addTrack(t, mic));

        const audio = document.createElement("audio");
        audio.autoplay = true;
        document.body.appendChild(audio);
        audioRef.current = audio;
        pc.ontrack = (ev) => {
          audio.srcObject = ev.streams[0];
        };

        pc.onconnectionstatechange = () => {
          const st = pc.connectionState;
          if (st === "connected") {
            if (startedAtRef.current === null) startedAtRef.current = Date.now();
            setState((s) => (s.phase === "ending" ? s : { ...s, phase: "active" }));
          } else if (st === "failed" || st === "disconnected" || st === "closed") {
            setState((s) => (s.phase === "idle" ? s : { ...s, phase: "ending" }));
          }
        };

        const offer = await pc.createOffer({ offerToReceiveAudio: true });
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
    },
    [tcSessionId, fail, organizationId],
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
