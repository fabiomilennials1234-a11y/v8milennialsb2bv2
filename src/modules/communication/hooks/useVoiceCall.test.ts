import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startCallRequest = vi.fn();
const endCallRequest = vi.fn();
const exchangeSdp = vi.fn();

vi.mock("@/modules/communication/lib/torquecallsApi", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/communication/lib/torquecallsApi")
  >("@/modules/communication/lib/torquecallsApi");
  return {
    ...actual,
    startCall: (...args: unknown[]) => startCallRequest(...args),
    endCall: (...args: unknown[]) => endCallRequest(...args),
    exchangeSdp: (...args: unknown[]) => exchangeSdp(...args),
  };
});

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

function installPeerConnection() {
  const pc = {
    addTrack: vi.fn(),
    getSenders: vi.fn(() => []),
    close: vi.fn(),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "v=0 offer" })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    iceGatheringState: "complete",
    localDescription: { sdp: "v=0 offer" },
    connectionState: "new",
    ontrack: null,
    onconnectionstatechange: null,
  };
  // Precisa ser construtível: o hook faz `new RTCPeerConnection()`, e uma arrow
  // function não pode ser chamada com `new`.
  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
    function RTCPeerConnectionStub() {
      return pc;
    } as unknown as typeof RTCPeerConnection;
  return pc;
}

describe("useVoiceCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Devolver Promise é parte do contrato: o hook encadeia `.catch` para não
    // deixar rejeição solta quando encerra a chamada num caminho de erro.
    endCallRequest.mockResolvedValue(undefined);
    installPeerConnection();
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
      expect(endCallRequest).toHaveBeenCalledWith({ tcSessionId: SESSION, callId: "call-1" }),
    );
    expect(result.current.state.phase).toBe("failed");
  });

  it("chega em ringing depois da troca de SDP", async () => {
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

    expect(result.current.state.phase).toBe("ringing");
    expect(result.current.state.peer).toBe("554891005289");
    // O telefone só entra na requisição vindo do servidor: o hook nunca o lê do
    // lead nem o recebe por parâmetro.
    expect(startCallRequest).toHaveBeenCalledWith({ tcSessionId: SESSION, leadId: LEAD });
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
});
