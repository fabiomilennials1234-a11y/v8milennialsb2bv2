/**
 * Ciclo de vida do popup Seamless (`useConnectNotificame`) — fatia 1.
 *
 * Cobre os quatro modos de falha que custam caro nesta fatia, todos observáveis
 * pelo comportamento do hook (nunca por "qual função interna foi chamada"):
 *
 *   1. SEGURANÇA — mensagem de `postMessage` com origem FORJADA não pode
 *      disparar o `notificame-channel-finish`. Quem chama o finish manda vincular
 *      à SUA org o próximo canal livre da nossa conta-mãe: o canal de outro
 *      cliente. Vem com CONTROLE POSITIVO na sequência (a origem legítima logo
 *      depois dispara), senão o teste passaria num hook que nunca escuta nada.
 *   2. `status` != "channel-success" é FALHA — nunca sucesso otimista.
 *   3. Popup BLOQUEADO pelo navegador — o motivo do clique ser síncrono. Um
 *      `await` antes do `window.open` mata a feature no Safari/Firefox.
 *   4. HTTP 200 com CORPO DE ERRO do fornecedor (`{"error":{"code":"Hub404"}}`)
 *      é FALHA. Esta é a armadilha real do NotificaMe, e ela tem duas camadas: a
 *      de baixo (`listChannels`) está travada em `notificame-api-contract.test.ts`;
 *      esta aqui é a de cima — se o envelope de erro escapar pela edge function
 *      com status 2xx, `functions.invoke` devolve `error: null` e o hook NÃO pode
 *      comemorar nem invalidar a lista de instâncias.
 *
 *   + estado INERTE (falta `company_uuid`/token): a fatia nasce assim em prod.
 *
 * Sem rede: `supabase.functions.invoke`, `window.open` e o `postMessage` são
 * controlados aqui.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { invokeMock, teamMemberMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  teamMemberMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => teamMemberMock(),
}));

import { toast } from "sonner";
import { NOTIFICAME_ORIGIN } from "@/modules/communication/lib/notificame-message";
import { useConnectNotificame } from "@/modules/communication/hooks/useConnectNotificame";

// ── fixtures ─────────────────────────────────────────────────────────────────

const ORG = "org-1";
const START_URL =
  "https://api.notificame.com.br/v2/oauth/meta/start" +
  "?company_uuid=cu-1&redirect_origin=https%3A%2F%2Ftorquecrm.com.br&type=whatsapp";

/** `notificame-channel-start` com secrets presentes. */
const START_OK = { data: { configured: true, start_url: START_URL }, error: null };

/**
 * `notificame-channel-start` SEM secrets — HTTP **200** de propósito
 * (`functions.invoke` embrulha não-2xx e esconde o corpo; é este corpo que faz o
 * card nascer desabilitado COM MOTIVO).
 */
const INERT_REASON = "NotificaMe ainda não configurado (company_uuid pendente)";
const START_INERT = {
  data: { configured: false, code: "not_configured", reason: INERT_REASON },
  error: null,
};

const FINISH_OK = {
  data: {
    instance_id: "inst-1",
    channel_id: "ch_1",
    phone_number: "5511988887777",
    status: "connected",
  },
  error: null,
};

/** Erro do `functions.invoke` para não-2xx (shape do FunctionsHttpError). */
function fnHttpError(status: number, body: Record<string, unknown>) {
  return Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: new Response(JSON.stringify(body), { status }),
  });
}

type InvokeResult = { data: unknown; error: unknown };

function routeInvoke(h: { start?: InvokeResult; finish?: InvokeResult } = {}) {
  invokeMock.mockImplementation((name: string) => {
    if (name === "notificame-channel-start") return Promise.resolve(h.start ?? START_OK);
    if (name === "notificame-channel-finish") return Promise.resolve(h.finish ?? FINISH_OK);
    return Promise.resolve({ data: null, error: null });
  });
}

function finishCalls() {
  return invokeMock.mock.calls.filter((c) => c[0] === "notificame-channel-finish");
}

function stubPopup() {
  return { closed: false, close: vi.fn(), focus: vi.fn() } as unknown as Window;
}

function setup({ enabled = true }: { enabled?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useConnectNotificame({ enabled }), { wrapper });
  return { ...view, invalidateSpy };
}

/** Entrega uma mensagem à janela, como o popup faria. */
async function post(origin: string, data: unknown) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { origin, data }));
    await Promise.resolve();
  });
}

function invalidatedInstances(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.some((c) => {
    const key = (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
    return Array.isArray(key) && key[0] === "whatsapp_instances";
  });
}

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  teamMemberMock.mockReturnValue({ data: { organization_id: ORG } });
  routeInvoke();
  openSpy = vi.spyOn(window, "open").mockReturnValue(stubPopup());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. estado INERTE ─────────────────────────────────────────────────────────

describe("estado inerte (sem configuração)", () => {
  it("expõe isConfigured=false + o MOTIVO legível antes de qualquer clique", async () => {
    routeInvoke({ start: START_INERT });
    const { result } = setup();

    await waitFor(() => expect(result.current.isConfigLoading).toBe(false));
    expect(result.current.isConfigured).toBe(false);
    expect(result.current.configReason).toContain("NotificaMe ainda não configurado");
  });

  it("clicar não abre popup, não chama o finish e explica o motivo", async () => {
    routeInvoke({ start: START_INERT });
    const { result } = setup();
    // Esperar a SONDA terminar, não só `isConfigured===false`: durante o voo o
    // hook responde "verificando disponibilidade", que é outro estado.
    await waitFor(() => expect(result.current.isConfigLoading).toBe(false));

    act(() => {
      result.current.connectNotificame();
    });

    expect(openSpy).not.toHaveBeenCalled();
    expect(finishCalls()).toHaveLength(0);
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("NotificaMe ainda não configurado"));
    expect(toast.error).not.toHaveBeenCalled(); // inerte não é quebrado
  });

  it("start indisponível (erro de transporte) também mantém o botão inerte", async () => {
    routeInvoke({ start: { data: null, error: new Error("boom") } });
    const { result } = setup();
    await waitFor(() => expect(result.current.isConfigLoading).toBe(false));

    expect(result.current.isConfigured).toBe(false);
    act(() => {
      result.current.connectNotificame();
    });
    expect(openSpy).not.toHaveBeenCalled();
    expect(finishCalls()).toHaveLength(0);
  });

  it("flag desligada não pré-carrega nada nem abre popup", async () => {
    const { result } = setup({ enabled: false });

    await waitFor(() => expect(result.current.isConfigured).toBe(false));
    act(() => {
      result.current.connectNotificame();
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});

// ── 2. popup ─────────────────────────────────────────────────────────────────

describe("abertura do popup", () => {
  it("abre a URL PRÉ-CARREGADA de forma SÍNCRONA no clique", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isConfigured).toBe(true));

    // `act` com callback síncrono não faz flush de microtasks: se o hook desse
    // `await` antes do `window.open`, a asserção abaixo ficaria vermelha — que é
    // exatamente o que o bloqueador de pop-up faz no Safari/Firefox.
    act(() => {
      result.current.connectNotificame();
    });

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(String(openSpy.mock.calls[0][0])).toBe(START_URL);
    expect(result.current.isConnecting).toBe(true);
  });

  it("POPUP BLOQUEADO (window.open → null): avisa e NÃO fica preso em isConnecting", async () => {
    openSpy.mockReturnValue(null);
    const { result } = setup();
    await waitFor(() => expect(result.current.isConfigured).toBe(true));

    act(() => {
      result.current.connectNotificame();
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/pop-?ups?/i));
    expect(result.current.isConnecting).toBe(false);
    expect(finishCalls()).toHaveLength(0);
  });

  it("popup bloqueado não deixa listener pendurado", async () => {
    openSpy.mockReturnValue(null);
    const { result } = setup();
    await waitFor(() => expect(result.current.isConfigured).toBe(true));
    act(() => {
      result.current.connectNotificame();
    });

    // Uma mensagem legítima que chegue DEPOIS de um clique abortado não pode
    // vincular canal nenhum — não há conexão em curso.
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });
    expect(finishCalls()).toHaveLength(0);
  });
});

// ── 3. postMessage: origem forjada + status ──────────────────────────────────

describe("postMessage", () => {
  async function connected() {
    const view = setup();
    await waitFor(() => expect(view.result.current.isConfigured).toBe(true));
    act(() => {
      view.result.current.connectNotificame();
    });
    return view;
  }

  it("SEGURANÇA: origem FORJADA é ignorada — e a legítima logo depois funciona", async () => {
    const { result } = await connected();

    for (const forjada of [
      "https://evil-notificame.com.br",
      "https://api.notificame.com.br.evil.io",
      "http://api.notificame.com.br",
      "https://hub.notificame.com.br",
    ]) {
      await post(forjada, { status: "channel-success" });
      await post(forjada, '{"status":"channel-success"}');
    }

    expect(finishCalls()).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
    expect(result.current.isConnecting).toBe(true); // segue esperando o de verdade

    // CONTROLE POSITIVO — sem isto, o bloco acima passaria num hook que
    // simplesmente nunca escuta `message`.
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });
    await waitFor(() => expect(finishCalls()).toHaveLength(1));
  });

  it("status != channel-success é FALHA declarada — não chama o finish", async () => {
    const { result } = await connected();

    await post(NOTIFICAME_ORIGIN, { status: "error" });

    expect(finishCalls()).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    await waitFor(() => expect(result.current.isConnecting).toBe(false));
  });

  it("depois de uma falha declarada, o listener está desarmado", async () => {
    await connected();
    await post(NOTIFICAME_ORIGIN, { status: "channel-error" });
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });

    expect(finishCalls()).toHaveLength(0);
  });

  it("ruído sem status é ignorado — não encerra a conexão em curso", async () => {
    const { result } = await connected();

    await post(NOTIFICAME_ORIGIN, "webpackHotUpdate");
    await post(NOTIFICAME_ORIGIN, { type: "react-devtools-bridge" });

    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.isConnecting).toBe(true);

    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });
    await waitFor(() => expect(finishCalls()).toHaveLength(1));
  });

  it("o finish carrega o organization_id no body (requireOrganization no servidor)", async () => {
    await connected();
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });

    await waitFor(() => expect(finishCalls()).toHaveLength(1));
    expect(finishCalls()[0][1]).toEqual(
      expect.objectContaining({ body: expect.objectContaining({ organization_id: ORG }) }),
    );
  });
});

// ── 4. resposta do finish ────────────────────────────────────────────────────

describe("resposta do notificame-channel-finish", () => {
  async function runWithFinish(finish: InvokeResult) {
    routeInvoke({ finish });
    const view = setup();
    await waitFor(() => expect(view.result.current.isConfigured).toBe(true));
    act(() => {
      view.result.current.connectNotificame();
    });
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });
    await waitFor(() => expect(finishCalls()).toHaveLength(1));
    return view;
  }

  it("HTTP 200 com CORPO DE ERRO do fornecedor NÃO é sucesso", async () => {
    // A armadilha real: se o envelope de erro do NotificaMe escapar pela edge
    // function com status 2xx, `functions.invoke` devolve `error: null`. Um hook
    // que confie em `!error` comemora uma conexão que não existe e invalida a
    // lista de instâncias, plantando um número fantasma na UI.
    const { result, invalidateSpy } = await runWithFinish({
      data: { error: { type: "OAuthException", code: "Hub404" } },
      error: null,
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(invalidatedInstances(invalidateSpy)).toBe(false);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isConnecting).toBe(false));
  });

  it("2xx sem instance_id também é falha (resposta inesperada)", async () => {
    const { invalidateSpy } = await runWithFinish({ data: {}, error: null });

    expect(toast.success).not.toHaveBeenCalled();
    expect(invalidatedInstances(invalidateSpy)).toBe(false);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("409 ambiguous_channel vira aviso, nunca sucesso", async () => {
    const { result, invalidateSpy } = await runWithFinish({
      data: null,
      error: fnHttpError(409, { error: "Mais de um canal sem dono", code: "ambiguous_channel" }),
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(invalidatedInstances(invalidateSpy)).toBe(false);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isConnecting).toBe(false));
  });

  it("CONTROLE POSITIVO: sucesso de verdade invalida a lista e avisa", async () => {
    const { result, invalidateSpy } = await runWithFinish(FINISH_OK);

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["whatsapp_instances", ORG] }),
    );
    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isConnecting).toBe(false));
  });
});
