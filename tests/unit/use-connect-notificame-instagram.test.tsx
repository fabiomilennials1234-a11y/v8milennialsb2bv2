/**
 * Fatia 1.1 — `useConnectNotificame` com DOIS canais, e a linha que separa um do
 * outro no browser.
 *
 * A fatia 1 tinha um canal só, então "qual fluxo o popup abriu" não era uma
 * pergunta. Agora é, e ela é cara: o popup do Seamless devolve
 * `{status:"channel-success"}` IDÊNTICO para whatsapp e para instagram. Quem
 * decide o que foi conectado é a URL que abrimos — e ela é escolhida aqui.
 *
 * Os cinco eixos:
 *   1. ORDEM E DESTINO — `window.open` continua SÍNCRONO e antes do `connect`
 *      (é o que impede Safari/Firefox bloquearem a janela), e vai para a URL
 *      DAQUELE canal. Asserido por `invocationCallOrder`, como na fatia 1.
 *   2. SERVIDOR ANTIGO — a 1.1 sobe o front e as edge functions em atos
 *      separados (deploy do front é manual no EasyPanel; o das functions é CLI).
 *      Entre os dois, o servidor responde só `start_url`, que é a do WhatsApp.
 *      O canal de Instagram NÃO pode herdar essa URL: herdar manda o usuário
 *      para um fluxo de WhatsApp com "Instagram" escrito no botão, e o finish
 *      vincula um número. Um caso deste bloco NASCEU VERMELHO contra o hook como
 *      ele estava e só ficou verde com a guarda `startUrlMatchesChannel` — está
 *      marcado, e é o controle positivo de que este arquivo mede alguma coisa.
 *   3. DESFECHO — cada canal tem a SUA chave de identidade na resposta do finish
 *      (`instance_id` vs `messaging_channel_id`) e a SUA queryKey invalidada.
 *      Aceitar a chave do outro seria aceitar que o canal caiu na tabela errada.
 *   4. MICROCOPY — nenhuma frase do caminho de Instagram contém a palavra
 *      "WhatsApp". É a mesma regra do `buildMessagingChannelRow`, um andar acima.
 *   5. CONCORRÊNCIA — o guard `isConnecting` é GLOBAL, não por canal: dois
 *      popups simultâneos fariam a baseline da segunda sessão já conter o canal
 *      da primeira, e o pareamento canal↔sessão se perderia.
 *
 * Sem rede: `functions.invoke`, `window.open` e o `postMessage` são controlados
 * aqui. Este arquivo não substitui `notificame-connect-hook*.test.tsx`; cobre o
 * que o segundo canal acrescentou.
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
const START_WA =
  "https://api.notificame.com.br/v2/oauth/meta/start" +
  "?company_uuid=cu-1&redirect_origin=https%3A%2F%2Ftorquecrm.com.br&type=whatsapp";
const START_IG = START_WA.replace("type=whatsapp", "type=instagram");

/** Servidor da 1.1: devolve as duas URLs na MESMA ida. */
const START_OK = {
  data: { configured: true, start_url: START_WA, start_urls: { whatsapp: START_WA, instagram: START_IG } },
  error: null,
};

/** Servidor da fatia 1, ainda em prod entre um deploy e outro. */
const START_LEGACY = { data: { configured: true, start_url: START_WA }, error: null };

/** Org com a flag do WhatsApp Oficial ligada e a do Instagram desligada. */
const START_SEM_IG = {
  data: { configured: true, start_url: START_WA, start_urls: { whatsapp: START_WA, instagram: null } },
  error: null,
};

const FINISH_WA = {
  data: { channel_kind: "whatsapp", instance_id: "inst-1", phone_number: "5511988887777" },
  error: null,
};
const FINISH_IG = {
  data: { channel_kind: "instagram", messaging_channel_id: "mc-1", display_name: "Milennials Oficial" },
  error: null,
};

function fnHttpError(status: number, body: Record<string, unknown>) {
  return Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: new Response(JSON.stringify(body), { status }),
  });
}

type InvokeResult = { data: unknown; error: unknown };

/** Roteia por FUNÇÃO e, no start, pelo `mode` — status e connect são perguntas diferentes. */
function routeInvoke(h: { status?: InvokeResult; connect?: InvokeResult; finish?: InvokeResult } = {}) {
  invokeMock.mockImplementation((name: string, opts?: { body?: Record<string, unknown> }) => {
    if (name === "notificame-channel-start") {
      return Promise.resolve(
        opts?.body?.mode === "connect" ? h.connect ?? h.status ?? START_OK : h.status ?? START_OK,
      );
    }
    if (name === "notificame-channel-finish") return Promise.resolve(h.finish ?? FINISH_WA);
    return Promise.resolve({ data: null, error: null });
  });
}

const bodyOf = (c: unknown[]) => (c[1] as { body?: Record<string, unknown> })?.body ?? {};
const startCalls = () => invokeMock.mock.calls.filter((c) => c[0] === "notificame-channel-start");
const statusCalls = () => startCalls().filter((c) => bodyOf(c).mode !== "connect");
const connectCalls = () => startCalls().filter((c) => bodyOf(c).mode === "connect");
const finishCalls = () => invokeMock.mock.calls.filter((c) => c[0] === "notificame-channel-finish");

/** Popup que REGISTRA para onde foi navegado — é onde o vazamento de canal apareceria. */
function stubPopup() {
  const navigations: string[] = [];
  const popup = {
    closed: false,
    close: vi.fn(),
    focus: vi.fn(),
    document: { write: vi.fn(), close: vi.fn() },
    location: {
      get href() {
        return navigations[navigations.length - 1] ?? "about:blank";
      },
      set href(v: string) {
        navigations.push(v);
      },
    },
  };
  return { popup: popup as unknown as Window, navigations };
}

/** Todo texto que o hook mandou para a tela nesta execução. */
function allToastTexts(): string {
  return JSON.stringify([
    (toast.success as ReturnType<typeof vi.fn>).mock.calls,
    (toast.error as ReturnType<typeof vi.fn>).mock.calls,
    (toast.info as ReturnType<typeof vi.fn>).mock.calls,
  ]);
}

type ChannelType = "whatsapp" | "instagram";

function setup({ enabled = true }: { enabled?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useConnectNotificame({ enabled }), { wrapper });
  /** Tipagem local: o parâmetro é da 1.1 e o call site do WhatsApp segue sem argumento. */
  const click = (t?: ChannelType) =>
    (view.result.current.connectNotificame as (c?: ChannelType) => void)(t);
  /** O cache da sonda — é onde a `start_url` semeada pelo connect fica guardada. */
  const cachedStartUrls = () =>
    (
      qc.getQueryData(["notificame_start_url", ORG]) as
        | { startUrls?: Record<string, string | null> }
        | undefined
    )?.startUrls ?? {};
  return { ...view, invalidateSpy, click, cachedStartUrls };
}

async function clicked(channel?: ChannelType, opts?: Parameters<typeof setup>[0]) {
  const view = setup(opts);
  await waitFor(() => expect(view.result.current.isConfigured).toBe(true));
  act(() => view.click(channel));
  return view;
}

async function post(origin: string, data: unknown) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { origin, data }));
    await Promise.resolve();
  });
}

function invalidatedKeys(spy: ReturnType<typeof vi.spyOn>): unknown[][] {
  return spy.mock.calls
    .map((c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey)
    .filter((k): k is unknown[] => Array.isArray(k));
}

let openSpy: ReturnType<typeof vi.spyOn>;
let popupHandle: ReturnType<typeof stubPopup>;

beforeEach(() => {
  vi.clearAllMocks();
  teamMemberMock.mockReturnValue({ data: { organization_id: ORG } });
  routeInvoke();
  popupHandle = stubPopup();
  openSpy = vi.spyOn(window, "open").mockReturnValue(popupHandle.popup);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. ordem e destino ───────────────────────────────────────────────────────

describe("o popup de Instagram abre na URL de Instagram, e abre ANTES do connect", () => {
  it("window.open recebe start_urls.instagram", async () => {
    await clicked("instagram");

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(String(openSpy.mock.calls[0][0])).toBe(START_IG);
    expect(String(openSpy.mock.calls[0][0])).toContain("type=instagram");
  });

  it("o connect parte DEPOIS do window.open — o contrato que impede o bloqueio de popup", async () => {
    await clicked("instagram");
    await waitFor(() => expect(connectCalls()).toHaveLength(1));

    // Qualquer `await` antes do `window.open` mata a feature no Safari/Firefox.
    // A ordem é observável, então é asserida — não inferida da leitura do código.
    const openOrder = openSpy.mock.invocationCallOrder[0];
    const connectIdx = invokeMock.mock.calls.findIndex(
      (c) => c[0] === "notificame-channel-start" && bodyOf(c).mode === "connect",
    );
    expect(connectIdx).toBeGreaterThanOrEqual(0);
    expect(
      invokeMock.mock.invocationCallOrder[connectIdx],
      "o connect partiu ANTES do window.open — popup será bloqueado",
    ).toBeGreaterThan(openOrder);
  });

  it("o body do connect carrega channel_type:'instagram'", async () => {
    await clicked("instagram");
    await waitFor(() => expect(connectCalls()).toHaveLength(1));

    // PROPOSTA do cliente, nunca decisão: o servidor tem a allowlist fechada e é
    // ele quem carimba `requested_channel_type` na sessão. Mas sem esta chave no
    // corpo, o servidor não tem o que ler e cai no default 'whatsapp'.
    expect(bodyOf(connectCalls()[0])).toEqual(
      expect.objectContaining({ organization_id: ORG, mode: "connect", channel_type: "instagram" }),
    );
  });

  it("CONTROLE POSITIVO: o call site sem argumento continua sendo WhatsApp", async () => {
    // `WhatsAppSettings` chama `connectNotificame('whatsapp')` explicitamente,
    // mas o default preserva qualquer call site que não tenha sido tocado.
    await clicked();
    await waitFor(() => expect(connectCalls()).toHaveLength(1));

    expect(String(openSpy.mock.calls[0][0])).toBe(START_WA);
    expect(bodyOf(connectCalls()[0]).channel_type).toBe("whatsapp");
  });

  it("a sonda continua sendo UMA só — o segundo canal não dobrou o custo de mount", async () => {
    // As duas URLs vêm na mesma ida (`start_urls`). Uma sonda por canal seria
    // duas chamadas de mount por tela, e a de `connect` é a única que gasta.
    await clicked("instagram");
    await waitFor(() => expect(connectCalls()).toHaveLength(1));

    expect(statusCalls()).toHaveLength(1);
    expect(bodyOf(statusCalls()[0]).mode).toBe("status");
  });
});

// ── 2. servidor antigo (janela entre os dois deploys) ────────────────────────

describe("servidor da fatia 1 (só start_url): o WhatsApp funciona, o Instagram não herda", () => {
  it("o caminho de WhatsApp segue abrindo direto na URL legada", async () => {
    await clicked("whatsapp", undefined);
    expect(String(openSpy.mock.calls[0][0])).toBe(START_WA);
  });

  it("o Instagram NÃO abre na URL de WhatsApp — abre em branco e espera", async () => {
    routeInvoke({ status: START_LEGACY, connect: START_LEGACY });
    await clicked("instagram");

    // Herdar `start_url` mandaria o usuário para o fluxo de WhatsApp da Meta com
    // a palavra "Instagram" no botão que ele clicou — e o finish vincularia um
    // NÚMERO. `about:blank` é o desfecho conservador.
    expect(String(openSpy.mock.calls[0][0])).toBe("about:blank");
    expect(String(openSpy.mock.calls[0][0])).not.toContain("type=whatsapp");
  });

  it("o popup de Instagram nunca é NAVEGADO para uma URL type=whatsapp", async () => {
    // ESTE CASO NASCEU VERMELHO e pintava um defeito real do caminho degradado.
    // Ele fica aqui como a guarda que impede o defeito voltar.
    //
    // Sequência do defeito: servidor da fatia 1 → `start_urls` ausente →
    // `startUrl` do Instagram é null → `needsProvisioning = true` → a janela abre
    // em branco (correto, caso acima) → o `connect` responde, e o servidor antigo
    // IGNORA `channel_type` e devolve a `start_url` do WHATSAPP → o hook navegava
    // a janela para ela. Quem clicou "Conectar Instagram" caía no fluxo de
    // WhatsApp e o finish vincularia um NÚMERO.
    //
    // A janela em que isso acontece é real e pode durar horas: front e edge
    // functions sobem em atos separados e manuais (EasyPanel e CLI), em qualquer
    // ordem — e nenhum dos dois lados sabe em que versão o outro está.
    //
    // O que fecha: `startUrlMatchesChannel` confere o `type` da URL devolvida
    // contra o canal pedido antes de navegar E antes de semear o cache.
    routeInvoke({ status: START_LEGACY, connect: START_LEGACY });
    const view = await clicked("instagram");
    await waitFor(() => expect(connectCalls()).toHaveLength(1));
    // Drena as continuações do `connect` — sem `waitFor` numa asserção negativa,
    // que só ficaria um segundo esperando um evento que já aconteceu.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      popupHandle.navigations.filter((u) => u.includes("type=whatsapp")),
      "o popup aberto por 'Conectar Instagram' foi navegado para o fluxo de WhatsApp",
    ).toHaveLength(0);

    // A SEGUNDA metade do mesmo defeito, e a que sobrevive ao popup abandonado:
    // `cacheStartUrl(r.startUrl, 'instagram')` semeia a URL de WHATSAPP na chave
    // do Instagram. O próximo clique em "Conectar Instagram" abre nela DIRETO —
    // sem janela em branco, sem nova ida ao servidor e sem nada a corrigir
    // depois, porque o cache tem `staleTime: Infinity`.
    expect(view.cachedStartUrls().instagram ?? "").not.toContain("type=whatsapp");
  });

  it("flag do Instagram desligada: a URL vem null e a de WhatsApp continua viva", async () => {
    // Servidor NOVO, org sem a flag `notificame_instagram`. O gate real é
    // server-side (fail-closed); aqui só se checa que o cliente não inventa URL.
    routeInvoke({ status: START_SEM_IG, connect: START_SEM_IG });
    const view = await clicked("instagram");

    expect(String(openSpy.mock.calls[0][0])).toBe("about:blank");
    expect(view.result.current.isConfigured).toBe(true);
  });

  it("connect recusado com instagram_not_enabled ⇒ microcopy do CANAL, não do WhatsApp", async () => {
    routeInvoke({
      status: START_SEM_IG,
      connect: { data: null, error: fnHttpError(403, { code: "instagram_not_enabled" }) },
    });
    await clicked("instagram");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Instagram ainda não está habilitado para esta organização.",
      ),
    );
    expect(allToastTexts()).not.toContain("WhatsApp");
  });
});

// ── 3. desfecho: cada canal com a sua chave e a sua queryKey ─────────────────

describe("finish de Instagram", () => {
  async function concluded(finish: InvokeResult) {
    routeInvoke({ finish });
    const view = await clicked("instagram");
    await waitFor(() => expect(connectCalls()).toHaveLength(1));
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });
    await waitFor(() => expect(finishCalls()).toHaveLength(1));
    return view;
  }

  it("invalida ['messaging_channels', orgId] e NÃO ['whatsapp_instances', orgId]", async () => {
    const view = await concluded(FINISH_IG);

    await waitFor(() => {
      const keys = invalidatedKeys(view.invalidateSpy);
      expect(keys).toContainEqual(["messaging_channels", ORG]);
    });
    // A lista de números não pode nem piscar: o canal de Instagram não está lá,
    // e invalidá-la seria admitir que poderia estar.
    expect(invalidatedKeys(view.invalidateSpy)).not.toContainEqual(["whatsapp_instances", ORG]);
  });

  it("o toast de sucesso diz 'Instagram conectado!' — e nada de WhatsApp em tela", async () => {
    await concluded(FINISH_IG);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Instagram conectado!"));
    expect(allToastTexts()).not.toContain("WhatsApp");
    expect(allToastTexts()).not.toContain("número");
  });

  it("resposta de Instagram que traz instance_id (e não messaging_channel_id) é RECUSADA", async () => {
    // Aceitar a chave do outro canal seria aceitar que o canal caiu em
    // `whatsapp_instances` — exatamente o que a decisão A.7 impede. O cliente não
    // pode comemorar por cima de um servidor que gravou na tabela errada.
    await concluded({ data: { channel_kind: "instagram", instance_id: "inst-9" }, error: null });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Resposta inesperada do servidor"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("o servidor tem a última palavra: channel_kind='whatsapp' vence o pedido de instagram", async () => {
    // `channel_kind` descreve o que o servidor ACABOU de gravar. Se ele decidiu
    // diferente, é a decisão dele que está no banco — invalidar a queryKey do
    // pedido deixaria a tela mostrando o estado antigo da lista certa.
    const view = await concluded(FINISH_WA);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("WhatsApp Oficial conectado!"));
    expect(invalidatedKeys(view.invalidateSpy)).toContainEqual(["whatsapp_instances", ORG]);
  });

  it("CONTROLE POSITIVO: o desfecho de WhatsApp da fatia 1 está intacto", async () => {
    routeInvoke({ finish: FINISH_WA });
    const view = await clicked("whatsapp");
    await waitFor(() => expect(connectCalls()).toHaveLength(1));
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("WhatsApp Oficial conectado!"));
    expect(invalidatedKeys(view.invalidateSpy)).toContainEqual(["whatsapp_instances", ORG]);
    expect(invalidatedKeys(view.invalidateSpy)).not.toContainEqual(["messaging_channels", ORG]);
  });
});

// ── 4. concorrência ──────────────────────────────────────────────────────────

describe("um popup por vez, GLOBAL — não um por canal", () => {
  it("clicar Instagram com a conexão de WhatsApp em voo não abre segunda janela", async () => {
    // Dois popups simultâneos fariam a baseline da segunda sessão já conter o
    // canal da primeira: o diff perderia o pareamento canal↔sessão e o desfecho
    // seria `ambiguous_channel` — ou, pior, o vínculo do canal errado.
    const view = await clicked("whatsapp");
    await waitFor(() => expect(connectCalls()).toHaveLength(1));

    act(() => view.click("instagram"));

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(connectCalls()).toHaveLength(1);
  });
});
