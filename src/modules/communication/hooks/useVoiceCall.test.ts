import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startCallRequest = vi.fn();
const endCallRequest = vi.fn();
const exchangeSdp = vi.fn();
const requestStreamToken = vi.fn();

vi.mock("@/modules/communication/lib/torquecallsApi", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/communication/lib/torquecallsApi")
  >("@/modules/communication/lib/torquecallsApi");
  return {
    ...actual,
    startCall: (...args: unknown[]) => startCallRequest(...args),
    endCall: (...args: unknown[]) => endCallRequest(...args),
    exchangeSdp: (...args: unknown[]) => exchangeSdp(...args),
    requestStreamToken: (...args: unknown[]) => requestStreamToken(...args),
  };
});

const subscribeSessionEvents = vi.fn();
vi.mock("@/modules/communication/lib/torquecallsEvents", () => ({
  subscribeSessionEvents: (...args: unknown[]) => subscribeSessionEvents(...args),
}));

vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));

// O caminho de áudio real precisa de AudioWorklet, que o jsdom não tem — e
// encenar Web Audio aqui provaria só que a encenação funciona. O que ESTE
// arquivo testa é o ciclo de vida que o hook controla: quando a captura sobe,
// o que ela recebe e quando ela cai. O formato dos bytes é provado em
// `lib/voicePcm.test.ts`, sobre código puro.
const pcmSessionStop = vi.fn();
const startPcmAudio = vi.fn();

vi.mock("@/modules/communication/lib/voicePcmSession", () => ({
  startPcmAudio: (...args: unknown[]) => startPcmAudio(...args),
}));

import { CallDeniedError } from "@/modules/communication/lib/torquecallsApi";
import { useVoiceCall } from "./useVoiceCall";

const SESSION = "tc-sess";
const LEAD = "c1111111-1111-1111-1111-111111111111";

function fakeTrack() {
  return { stop: vi.fn(), enabled: true, kind: "audio" };
}

function installMedia(getUserMedia: () => Promise<unknown>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

function fakeDataChannel() {
  return {
    label: "pcm",
    readyState: "connecting",
    binaryType: "blob",
    send: vi.fn(),
    close: vi.fn(),
    onmessage: null as ((ev: MessageEvent) => void) | null,
  };
}

function installPeerConnection() {
  const channel = fakeDataChannel();
  const pc = {
    addTrack: vi.fn(),
    getSenders: vi.fn(() => []),
    close: vi.fn(),
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "v=0 offer" })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    iceGatheringState: "complete",
    localDescription: { sdp: "v=0 offer" },
    connectionState: "new" as RTCPeerConnectionState,
    ontrack: null,
    // Tipado porque os testes DISPARAM este handler. O `connectionState` mudar
    // sozinho não notifica ninguém: quem prova que a fase não vem mais daqui é
    // um teste que chama a função na mão.
    onconnectionstatechange: null as (() => void) | null,
  };
  // Precisa ser construtível: o hook faz `new RTCPeerConnection()`, e uma arrow
  // function não pode ser chamada com `new`.
  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
    function RTCPeerConnectionStub() {
      return pc;
    } as unknown as typeof RTCPeerConnection;
  return { pc, channel };
}

/** Chamada autorizada e atendida, do jeito que a edge function responde. */
const AUTHORIZED = {
  callId: "call-1",
  tcCallId: "0E65AD6F1122334455667788990011FF",
  peer: "554891005289",
  media: "m",
  ctl: "c",
  vpsUrl: "https://vps.test",
};

const TC_CALL_ID = AUTHORIZED.tcCallId;

/**
 * Encenação do stream de eventos da VPS.
 *
 * Fiel em três detalhes que decidem os testes abaixo:
 *   - o primeiro evento chega no instante da assinatura (`SnapshotFn` em
 *     `cmd/server/broker.go` emite `session-list` para todo assinante novo);
 *   - a promessa só assenta quando o stream morre — no real, quando a conexão
 *     cai ou o `AbortSignal` dispara;
 *   - `onEvent` recebe evento de TODA a organização, não só da chamada deste
 *     operador. É por isso que existe teste de evento alheio.
 */
interface FakeStream {
  emit: (event: Record<string, unknown>) => void;
  signal: AbortSignal;
}
let streams: FakeStream[] = [];

function installStream() {
  streams = [];
  requestStreamToken.mockResolvedValue({
    token: "stream-token",
    expiresAt: Date.now() + 60_000,
    renewInMs: 45_000,
    vpsUrl: "https://vps.test",
  });
  subscribeSessionEvents.mockImplementation(
    (args: { onEvent: (e: Record<string, unknown>) => void; signal: AbortSignal }) => {
      streams.push({ emit: args.onEvent, signal: args.signal });
      args.onEvent({ type: "session-list", sessions: [] });
      return new Promise<void>((resolve) => {
        args.signal.addEventListener("abort", () => resolve());
      });
    },
  );
}

/** Uma chamada que chegou até `ringing`, pronta para receber evento da VPS. */
async function callInRinging() {
  const track = fakeTrack();
  installMedia(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
  const { pc } = installPeerConnection();
  startCallRequest.mockResolvedValueOnce(AUTHORIZED);
  exchangeSdp.mockResolvedValueOnce("v=0 answer");

  const { result, unmount } = renderHook(() => useVoiceCall(SESSION));
  await act(async () => {
    await result.current.start(LEAD);
  });
  return { result, unmount, pc, track };
}

/** Empurra um evento do stream como se tivesse vindo da VPS. */
async function emit(event: Record<string, unknown>) {
  await act(async () => {
    streams[0].emit(event);
  });
}

describe("useVoiceCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Devolver Promise é parte do contrato: o hook encadeia `.catch` para não
    // deixar rejeição solta quando encerra a chamada num caminho de erro.
    endCallRequest.mockResolvedValue(undefined);
    startPcmAudio.mockResolvedValue({ enqueue: vi.fn(), stop: pcmSessionStop });
    installPeerConnection();
    installStream();
  });

  // O invariante mais caro deste fluxo. Se o microfone for pedido DEPOIS de
  // discar, uma permissão negada deixa o telefone do lead tocando sem ninguém do
  // outro lado: gasta cota, incomoda o cliente e conta como tentativa.
  it("NÃO disca quando o microfone é negado", async () => {
    installMedia(() => Promise.reject(new Error("NotAllowedError")));

    const { result } = renderHook(() => useVoiceCall(SESSION));
    await act(async () => {
      await result.current.start(LEAD);
    });

    expect(startCallRequest).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe("failed");
    expect(result.current.state.errorCode).toBe("mic_denied");
  });

  it("solta o microfone quando a autorização é recusada", async () => {
    const track = fakeTrack();
    installMedia(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
    startCallRequest.mockRejectedValueOnce(new CallDeniedError("consent_missing"));

    const { result } = renderHook(() => useVoiceCall(SESSION));
    await act(async () => {
      await result.current.start(LEAD);
    });

    // Sem isto o indicador de microfone do navegador fica aceso depois de uma
    // chamada que nem aconteceu — e o vendedor conclui, com razão, que o sistema
    // continua ouvindo.
    expect(track.stop).toHaveBeenCalled();
    expect(result.current.state.errorCode).toBe("consent_missing");
    expect(result.current.state.error).toMatch(/autorizou receber liga/i);
  });

  // A chamada já foi autorizada e pode estar tocando. Abandonar o fluxo sem
  // avisar o servidor deixaria a linha ocupada até o reaper passar.
  it("encerra no servidor quando a mídia falha depois de autorizar", async () => {
    const track = fakeTrack();
    installMedia(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
    startCallRequest.mockResolvedValueOnce({
      callId: "call-1",
      tcCallId: "0E65AD6F1122334455667788990011FF",
      peer: "554891005289",
      media: "m",
      ctl: "c",
      vpsUrl: "https://vps.test",
    });
    exchangeSdp.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useVoiceCall(SESSION));
    await act(async () => {
      await result.current.start(LEAD);
    });

    await waitFor(() =>
      expect(endCallRequest).toHaveBeenCalledWith({
        tcSessionId: SESSION,
        callId: "call-1",
        organizationId: "org-1",
      }),
    );
    expect(result.current.state.phase).toBe("failed");
  });

  it("chega em ringing depois da troca de SDP", async () => {
    const { result } = await callInRinging();

    expect(result.current.state.phase).toBe("ringing");
    expect(result.current.state.peer).toBe("554891005289");
    // O telefone só entra na requisição vindo do servidor: o hook nunca o lê do
    // lead nem o recebe por parâmetro.
    expect(startCallRequest).toHaveBeenCalledWith({
      tcSessionId: SESSION,
      leadId: LEAD,
      organizationId: "org-1",
    });
  });

  // Regressão ao vivo (2026-07-30): master sem `organization_id` no corpo de
  // `startCall`/`endCall` batia em 400 "Master must provide organization_id"
  // (`_shared/voip/caller.ts`) ao tentar ligar pelo botão do chat. Este hook é
  // quem o `VoiceCallButton` usa via `VoiceCallProvider` — sem o repasse aqui,
  // o defeito reaparece neste botão mesmo depois de consertado no pareamento.
  it("repassa organizationId pro endCall também no encerramento normal (hangup)", async () => {
    const track = fakeTrack();
    installMedia(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
    startCallRequest.mockResolvedValueOnce({
      callId: "call-1",
      tcCallId: "0E65AD6F1122334455667788990011FF",
      peer: "554891005289",
      media: "m",
      ctl: "c",
      vpsUrl: "https://vps.test",
    });
    exchangeSdp.mockResolvedValueOnce("v=0 answer");

    const { result } = renderHook(() => useVoiceCall(SESSION));
    await act(async () => {
      await result.current.start(LEAD);
    });
    await act(async () => {
      await result.current.hangup();
    });

    expect(endCallRequest).toHaveBeenCalledWith({
      tcSessionId: SESSION,
      callId: "call-1",
      organizationId: "org-1",
    });
  });

  // ─── Transporte de áudio ────────────────────────────────────────────────────
  // Defeito medido em produção (2026-07-30): a chamada conectava, o cronômetro
  // corria e não havia som em nenhum dos dois sentidos. As duas pontas falavam
  // transportes diferentes — a VPS lê PCM de um canal de dados `pcm` que o
  // NAVEGADOR tem que abrir, e o navegador mandava faixa RTP. Nenhum dos lados
  // acusava erro: cada um achava que tinha cumprido a sua parte.

  it("cria o canal `pcm` ANTES da oferta", async () => {
    const track = fakeTrack();
    installMedia(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
    const { pc } = installPeerConnection();
    startCallRequest.mockResolvedValueOnce(AUTHORIZED);
    exchangeSdp.mockResolvedValueOnce("v=0 answer");

    const { result } = renderHook(() => useVoiceCall(SESSION));
    await act(async () => {
      await result.current.start(LEAD);
    });

    expect(pc.createDataChannel).toHaveBeenCalledWith("pcm", expect.anything());
    // ESTA é a asserção que importa. Um canal criado DEPOIS de `createOffer` não
    // entra no SDP: a VPS nunca vê `m=application`, nunca recebe o canal, e a
    // chamada volta a conectar muda — sem erro em lugar nenhum.
    expect(pc.createDataChannel.mock.invocationCallOrder[0]).toBeLessThan(
      pc.createOffer.mock.invocationCallOrder[0],
    );
  });

  it("não pede faixa de mídia RTP — a VPS não emite nem aceita nenhuma", async () => {
    const track = fakeTrack();
    installMedia(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
    const { pc } = installPeerConnection();
    startCallRequest.mockResolvedValueOnce(AUTHORIZED);
    exchangeSdp.mockResolvedValueOnce("v=0 answer");

    const { result } = renderHook(() => useVoiceCall(SESSION));
    await act(async () => {
      await result.current.start(LEAD);
    });

    expect(pc.addTrack).not.toHaveBeenCalled();
  });

  // Mesma lógica do microfone-antes-de-discar, no topo do arquivo: se o áudio
  // não puder subir, o telefone do lead não pode tocar.
  it("levanta a captura ANTES de discar, e não disca se ela falhar", async () => {
    const track = fakeTrack();
    installMedia(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
    startPcmAudio.mockRejectedValueOnce(new Error("sem AudioWorklet"));

    const { result } = renderHook(() => useVoiceCall(SESSION));
    await act(async () => {
      await result.current.start(LEAD);
    });

    expect(startCallRequest).not.toHaveBeenCalled();
    expect(result.current.state.errorCode).toBe("audio_unsupported");
    expect(track.stop).toHaveBeenCalled();
  });

  // O pacer da VPS (`cmd/server/pacer.go`) encerra a chamada com excesso
  // sustentado. Guardar quadros enquanto o canal não abre e despejá-los depois
  // é exatamente a rajada que ele mata — então o quadro sem canal MORRE.
  it("descarta o quadro capturado enquanto o canal não está aberto", async () => {
    const track = fakeTrack();
    installMedia(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
    const { channel } = installPeerConnection();
    startCallRequest.mockResolvedValueOnce(AUTHORIZED);
    exchangeSdp.mockResolvedValueOnce("v=0 answer");

    const { result } = renderHook(() => useVoiceCall(SESSION));
    await act(async () => {
      await result.current.start(LEAD);
    });

    const send = startPcmAudio.mock.calls[0][0].send as (f: ArrayBuffer) => void;
    channel.readyState = "connecting";
    send(new ArrayBuffer(640));
    expect(channel.send).not.toHaveBeenCalled();

    channel.readyState = "open";
    send(new ArrayBuffer(640));
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it("o teardown fecha o canal, para a captura e solta o microfone", async () => {
    const track = fakeTrack();
    installMedia(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
    const { pc, channel } = installPeerConnection();
    startCallRequest.mockResolvedValueOnce(AUTHORIZED);
    exchangeSdp.mockResolvedValueOnce("v=0 answer");

    const { result } = renderHook(() => useVoiceCall(SESSION));
    await act(async () => {
      await result.current.start(LEAD);
    });
    await act(async () => {
      await result.current.hangup();
    });

    // Canal: a VPS aceita UM canal `pcm` por chamada e recusa o segundo. Deixar
    // o antigo aberto queima o slot da próxima ligação.
    expect(channel.close).toHaveBeenCalled();
    // Captura: sem isto o AudioContext segue vivo consumindo o microfone.
    expect(pcmSessionStop).toHaveBeenCalled();
    // Microfone: é o que apaga a bolinha vermelha do navegador.
    expect(track.stop).toHaveBeenCalled();
    expect(pc.close).toHaveBeenCalled();
  });

  it("não abre um segundo canal `pcm` quando start é chamado duas vezes", async () => {
    const track = fakeTrack();
    installMedia(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
    const { pc } = installPeerConnection();
    startCallRequest.mockResolvedValue(AUTHORIZED);
    exchangeSdp.mockResolvedValue("v=0 answer");

    const { result } = renderHook(() => useVoiceCall(SESSION));
    await act(async () => {
      await Promise.all([result.current.start(LEAD), result.current.start(LEAD)]);
    });

    // O segundo canal é recusado pela VPS e registrado como aviso; pior, o duplo
    // clique no botão discaria duas vezes para o mesmo lead.
    expect(pc.createDataChannel).toHaveBeenCalledTimes(1);
    expect(startCallRequest).toHaveBeenCalledTimes(1);
  });

  it("sem sessão de voz não pede microfone nem disca", async () => {
    const getUserMedia = vi.fn();
    installMedia(getUserMedia);

    const { result } = renderHook(() => useVoiceCall(null));
    await act(async () => {
      await result.current.start(LEAD);
    });

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(startCallRequest).not.toHaveBeenCalled();
    expect(result.current.state.errorCode).toBe("session_not_found");
  });

  // ─── A fase vem do stream, não do RTCPeerConnection ──────────────────────────
  // Três defeitos vividos em produção (2026-07-30), uma raiz só: o navegador não
  // ouvia os eventos de chamada da VPS e derivava a fase inteira do
  // `connectionState`. Isso é a mídia navegador↔VPS de pé — que sobe ENQUANTO o
  // telefone ainda toca — e não diz nada sobre a pessoa ter atendido, nem sobre
  // ela ter desligado.

  it("NÃO vira `active` quando a mídia conecta — isso não é atender", async () => {
    const { result, pc } = await callInRinging();

    // O momento exato do defeito: a `RTCPeerConnection` fecha o caminho com a
    // VPS em ~200ms, muito antes de o telefone do lead ser atendido. A tela
    // dizia "Em chamada" e o cronômetro corria com o telefone ainda tocando.
    await act(async () => {
      pc.connectionState = "connected";
      pc.onconnectionstatechange?.();
    });

    expect(result.current.state.phase).toBe("ringing");
    expect(result.current.state.elapsedSeconds).toBe(0);
  });

  it("vira `active` quando a VPS diz que ESTA chamada foi atendida", async () => {
    const { result } = await callInRinging();

    await emit({
      type: "call-status",
      sessionId: SESSION,
      id: TC_CALL_ID,
      status: "connected",
      peer: "554891005289",
      startedAt: Date.now(),
    });

    expect(result.current.state.phase).toBe("active");
  });

  it("ignora o `connected` da chamada de OUTRO operador da mesma org", async () => {
    const { result } = await callInRinging();

    // O stream é da organização inteira (`publish` filtra por org, não por
    // chamada). Sem o filtro por id, o colega atender o telefone dele fazia
    // esta tela dizer "Em chamada" — e o `call-ended` dele derrubaria esta
    // ligação.
    await emit({
      type: "call-status",
      sessionId: SESSION,
      id: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
      status: "connected",
    });

    expect(result.current.state.phase).toBe("ringing");
  });

  it("ignora evento sem identidade de chamada — fail-closed", async () => {
    const { result } = await callInRinging();

    await emit({ type: "call-ended", sessionId: SESSION, reason: "declined" });

    expect(result.current.state.phase).toBe("ringing");
  });

  it("`call-ended` desta chamada encerra a tela com o motivo da VPS", async () => {
    const { result } = await callInRinging();

    await emit({
      type: "call-ended",
      sessionId: SESSION,
      id: TC_CALL_ID,
      reason: "declined",
      endedAt: Date.now(),
    });

    expect(result.current.state.phase).toBe("ended");
    expect(result.current.state.endReason).toMatch(/recusou/i);
  });

  it("a mídia caindo depois não reescreve o motivo verdadeiro", async () => {
    const { result, pc } = await callInRinging();

    await emit({ type: "call-ended", sessionId: SESSION, id: TC_CALL_ID, reason: "timeout" });
    // Desligar derruba a mídia: este `failed` chega SEMPRE, logo depois. Sem
    // guarda ele trocaria "não atendeu" por "a conexão caiu" — o motivo
    // verdadeiro pelo sintoma, e o vendedor tentaria de novo pelo motivo errado.
    await act(async () => {
      pc.connectionState = "failed";
      pc.onconnectionstatechange?.();
    });

    expect(result.current.state.endReason).toMatch(/não atendeu/i);
    // E não pode virar um segundo encerramento no servidor.
    expect(endCallRequest).toHaveBeenCalledTimes(1);
  });

  it("`call-status: ended` também encerra — o mesmo fato por outro evento", async () => {
    const { result } = await callInRinging();

    await emit({ type: "call-status", sessionId: SESSION, id: TC_CALL_ID, status: "ended" });

    expect(result.current.state.phase).toBe("ended");
  });

  // O sintoma 2 do CTO, palavra por palavra: "a pessoa desligou a chamada sem
  // querer, fui tentar ligar novamente e disse que eu já estava em chamada".
  // Duas travas ao mesmo tempo — a fase presa em `ending` deixava o
  // `VoiceCallProvider` com `busy: true` (botão desabilitado, título "Você já
  // está em uma chamada"), e a linha em `voip_calls` seguia aberta, fazendo o
  // governor devolver `operator_busy` na tentativa seguinte.
  it("libera o operador quando o outro lado desliga", async () => {
    const { result } = await callInRinging();

    await emit({ type: "call-ended", sessionId: SESSION, id: TC_CALL_ID, reason: "user_ended" });

    // Frente: `ended` não conta como ocupado — dá para discar de novo agora.
    expect(result.current.state.phase).not.toBe("ending");
    expect(result.current.state.phase).not.toBe("active");
    // Servidor: sem webhook de fim de chamada (S11 não existe), a linha só é
    // liberada porque o navegador avisa. Sem isto o operador fica `operator_busy`
    // até o reaper passar.
    await waitFor(() =>
      expect(endCallRequest).toHaveBeenCalledWith({
        tcSessionId: SESSION,
        callId: "call-1",
        organizationId: "org-1",
      }),
    );
  });

  // O sintoma 1: "ao tentar desligar ele buga e fica Encerrando para sempre".
  // `connectionState` indo para `failed`/`disconnected` parava a fase em
  // `ending` — e NADA levava dali para `idle`. O botão Desligar fica
  // desabilitado nessa fase, então nem o operador podia sair.
  it("não fica preso em `ending` quando a mídia morre", async () => {
    const { result, pc } = await callInRinging();

    await act(async () => {
      pc.connectionState = "failed";
      pc.onconnectionstatechange?.();
    });

    await waitFor(() => expect(result.current.state.phase).not.toBe("ending"));
    expect(["idle", "ended", "failed"]).toContain(result.current.state.phase);
  });

  it("desligar termina em `idle` mesmo quando o servidor recusa o encerramento", async () => {
    const { result } = await callInRinging();
    endCallRequest.mockRejectedValueOnce(new CallDeniedError("call_not_found"));

    await act(async () => {
      await result.current.hangup();
    });

    expect(result.current.state.phase).toBe("idle");
  });

  // ─── Ciclo de vida do stream ────────────────────────────────────────────────

  it("abre o stream ANTES de discar", async () => {
    await callInRinging();

    // Se o stream subisse depois, o `connected` de quem atende rápido chegaria
    // sem ninguém ouvindo e a tela ficaria em "Chamando…" durante a conversa
    // inteira. Ordem é o conserto; não há relógio nem tentativa depois.
    expect(subscribeSessionEvents).toHaveBeenCalledTimes(1);
    expect(requestStreamToken.mock.invocationCallOrder[0]).toBeLessThan(
      startCallRequest.mock.invocationCallOrder[0],
    );
    expect(subscribeSessionEvents.mock.invocationCallOrder[0]).toBeLessThan(
      startCallRequest.mock.invocationCallOrder[0],
    );
  });

  it("não pede o stream de pareamento — aquele token carrega o QR", async () => {
    await callInRinging();

    // `pair: true` exige `voip.session.manage` e faz o QR trafegar no stream.
    // Uma chamada não precisa de nenhum dos dois.
    expect(requestStreamToken).toHaveBeenCalledWith({
      tcSessionId: SESSION,
      organizationId: "org-1",
    });
  });

  it("o teardown aborta o stream", async () => {
    const { result } = await callInRinging();
    expect(streams[0].signal.aborted).toBe(false);

    await act(async () => {
      await result.current.hangup();
    });

    // Um stream por chamada que não é abortado é uma conexão SSE vazada por
    // ligação — e um ouvinte de uma chamada morta reagindo a evento novo.
    expect(streams[0].signal.aborted).toBe(true);
  });

  it("o desmonte aborta o stream", async () => {
    const { unmount } = await callInRinging();

    unmount();

    expect(streams[0].signal.aborted).toBe(true);
  });

  it("não disca quando o stream de eventos não sobe", async () => {
    const track = fakeTrack();
    installMedia(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
    requestStreamToken.mockRejectedValueOnce(new Error("sem stream"));

    const { result } = renderHook(() => useVoiceCall(SESSION));
    await act(async () => {
      await result.current.start(LEAD);
    });

    // Mesma doutrina do microfone e do worklet: o que não puder ser observado
    // não deve fazer o telefone do lead tocar. Chamada sem stream é chamada que
    // nunca sai de "Chamando…" e trava o operador — falhar antes custa zero.
    expect(startCallRequest).not.toHaveBeenCalled();
    expect(result.current.state.errorCode).toBe("stream_failed");
    expect(track.stop).toHaveBeenCalled();
  });
});
