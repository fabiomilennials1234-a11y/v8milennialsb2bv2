/**
 * `useConnectNotificame` sob o modelo de SUBCONTA POR ORG — a camada do browser.
 *
 * O RISCO CENTRAL DA FATIA, e o que este arquivo tranca: existe UM caminho que
 * cria no fornecedor um objeto IRREMOVÍVEL e FATURÁVEL, e ele tem que ser
 * exatamente o clique do usuário. Na versão anterior não era: a sonda de MOUNT
 * provisionava, de modo que abrir Configurações → WhatsApp criava a subconta sem
 * ninguém clicar em nada — e um master passeando pelas orgs criava uma em nome
 * de CADA org cuja tela ele abrisse. A correção é um MODO no corpo da chamada:
 * `mode:"status"` (leitura pura, o que o mount manda) e `mode:"connect"` (o
 * único que provisiona, e que só o clique manda). É essa separação que os casos
 * do bloco 1 cobram — pelo CORPO da chamada, não por "quantas chamadas houve",
 * porque a leitura pura pode acontecer à vontade e a escrita não.
 *
 * Os outros quatro eixos:
 *   • PRIMEIRO CLIQUE — sem subconta ainda não existe `start_url`. A janela abre
 *     assim mesmo, SÍNCRONA no gesto (senão o bloqueador do Safari/Firefox mata
 *     a feature), e é NAVEGADA quando o `connect` responde. Esperar a URL para só
 *     então abrir é o bug clássico que este teste impede.
 *   • SESSÃO — o `session_id` (que carrega a BASELINE de canais fotografada no
 *     clique) viaja pelo NOSSO canal start→finish. Nunca pelo `postMessage` do
 *     terceiro: o contrato verificado daquele payload é `{status}` e só.
 *   • ORDEM — a chamada `mode:"connect"` só pode partir DEPOIS do `window.open`.
 *   • VAZAMENTO — o token da CONTA-MÃE (raio de explosão = todas as orgs) não
 *     pode aparecer em NADA que o browser toque: nem no retorno do hook, nem num
 *     toast, nem num body de invoke.
 *
 * Este arquivo NÃO substitui `notificame-connect-hook.test.tsx`; ele cobre o que
 * o modelo de subconta acrescentou.
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
/** Token da CONTA-MÃE. Não pode existir em lugar nenhum deste arquivo além daqui. */
const PARENT_TOKEN = "11111111-1111-4111-8111-111111111111";
/** Token da SUBCONTA da org — é ele que viaja na querystring do popup, por contrato. */
const SUB_TOKEN = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "sess-9a7f";

const START_URL =
  `https://api.notificame.com.br/v2/oauth/meta/start` +
  `?company_uuid=${SUB_TOKEN}&redirect_origin=https%3A%2F%2Ftorquecrm.com.br&type=whatsapp`;

/** Sonda de mount de uma org que JÁ tem subconta: a URL vem pré-carregada. */
const STATUS_OK = { data: { configured: true, start_url: START_URL, session_id: null }, error: null };
/**
 * Sonda de mount de uma org SEM subconta ainda. `start_url: null` com
 * `configured: true` NÃO é indisponibilidade — é "ainda não provisionada", e o
 * botão tem que continuar vivo.
 */
const STATUS_UNPROVISIONED = {
  data: { configured: true, start_url: null, session_id: null },
  error: null,
};
const CONNECT_OK = {
  data: { configured: true, start_url: START_URL, session_id: SESSION_ID },
  error: null,
};
const FINISH_OK = {
  data: { instance_id: "inst-1", channel_id: "ch_1", phone_number: "5511988887777", status: "connected" },
  error: null,
};

function fnHttpError(status: number, body: Record<string, unknown>) {
  return Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: new Response(JSON.stringify(body), { status }),
  });
}

type InvokeResult = { data: unknown; error: unknown };

/**
 * Roteia por FUNÇÃO e por `mode`: a sonda de mount (`status`, leitura pura) e o
 * provisionamento do clique (`connect`, o único que gasta dinheiro) são a MESMA
 * edge function com corpos diferentes. Essa distinção É o contrato desta fatia,
 * e é por isso que o dublê a enxerga em vez de contar chamadas.
 */
function routeInvoke(h: { probe?: InvokeResult; connect?: InvokeResult; finish?: InvokeResult } = {}) {
  invokeMock.mockImplementation((name: string, opts?: { body?: Record<string, unknown> }) => {
    if (name === "notificame-channel-start") {
      const provisioning = opts?.body?.mode === "connect";
      if (provisioning) return Promise.resolve(h.connect ?? CONNECT_OK);
      return Promise.resolve(h.probe ?? STATUS_OK);
    }
    if (name === "notificame-channel-finish") return Promise.resolve(h.finish ?? FINISH_OK);
    return Promise.resolve({ data: null, error: null });
  });
}

const startCalls = () => invokeMock.mock.calls.filter((c) => c[0] === "notificame-channel-start");
const bodyOf = (c: unknown[]) => (c[1] as { body?: Record<string, unknown> })?.body ?? {};
/** Leitura pura. Pode acontecer à vontade — nada nasce no fornecedor. */
const probeCalls = () => startCalls().filter((c) => bodyOf(c).mode !== "connect");
/** O ÚNICO caminho que provisiona. Só o clique pode produzi-lo. */
const connectCalls = () => startCalls().filter((c) => bodyOf(c).mode === "connect");
const finishCalls = () => invokeMock.mock.calls.filter((c) => c[0] === "notificame-channel-finish");

function stubPopup() {
  return {
    closed: false,
    close: vi.fn(),
    focus: vi.fn(),
    // `location.href` é o que navega a janela aberta em branco no primeiro
    // clique da org. Sem ele no dublê, o teste da navegação seria decorativo.
    location: { href: "about:blank" },
    document: { write: vi.fn(), close: vi.fn() },
  } as unknown as Window;
}

function setup({ enabled = true, qc }: { enabled?: boolean; qc?: QueryClient } = {}) {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useConnectNotificame({ enabled }), { wrapper });
  return { ...view, invalidateSpy, client };
}

async function post(origin: string, data: unknown) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { origin, data }));
    await Promise.resolve();
  });
}

/**
 * Envelhece o resultado da sonda no cache, sem mexer em timers.
 *
 * Sem isto, um remount imediato NÃO refetcharia nem com `staleTime: 5*60_000` —
 * o dado ainda estaria fresco — e o teste passaria verde numa implementação que
 * re-provisiona depois de cinco minutos, que é exatamente a regressão temida.
 */
function ageProbe(qc: QueryClient, ms: number) {
  for (const q of qc.getQueryCache().findAll({ queryKey: ["notificame_start_url"] })) {
    (q.state as unknown as { dataUpdatedAt: number }).dataUpdatedAt = Date.now() - ms;
  }
}

function invalidatedInstances(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.some((c) => {
    const key = (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
    return Array.isArray(key) && key[0] === "whatsapp_instances";
  });
}

/** Tudo que o browser toca, num só lugar, para a varredura de segredo. */
function browserSurface(hookResult: unknown) {
  const toastArgs = (["success", "error", "info", "warning", "message"] as const).flatMap(
    (k) => (toast[k] as unknown as { mock: { calls: unknown[][] } }).mock.calls,
  );
  return {
    hookResult,
    toastArgs,
    invokeArgs: invokeMock.mock.calls,
  };
}

function deepScan(value: unknown, secret: string, path = "$"): string[] {
  const hits: string[] = [];
  if (typeof value === "string") {
    if (value.includes(secret)) hits.push(path);
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...deepScan(v, secret, `${path}[${i}]`)));
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      hits.push(...deepScan(v, secret, `${path}.${k}`));
    }
  }
  return hits;
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

// ═════════════════════════════════════════════════════════════════════════════
// 1. MONTAR A TELA NÃO PODE CRIAR CONTA NO FORNECEDOR
// ═════════════════════════════════════════════════════════════════════════════

describe("o mount não provisiona — só o clique gasta dinheiro", () => {
  it("MOUNT: a sonda manda mode:'status' e NENHUMA chamada mode:'connect' parte", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isConfigured).toBe(true));

    expect(probeCalls()).toHaveLength(1);
    expect(
      bodyOf(probeCalls()[0]).mode,
      "a sonda de mount tem que declarar o modo de LEITURA por extenso",
    ).toBe("status");
    expect(
      connectCalls(),
      "montar a tela disparou o caminho que cria uma subconta IRREMOVÍVEL e faturável",
    ).toHaveLength(0);
  });

  it(
    "MOUNT DE ORG SEM SUBCONTA: nada é provisionado e o botão continua VIVO " +
      "(start_url null não é indisponibilidade)",
    async () => {
      // Este é o caso do master passeando pelas orgs: cada tela aberta era uma
      // subconta nova. Aqui a tela abre, reporta estado, e não cria nada.
      routeInvoke({ probe: STATUS_UNPROVISIONED });
      const { result } = setup();
      await waitFor(() => expect(result.current.isConfigLoading).toBe(false));

      expect(connectCalls()).toHaveLength(0);
      expect(
        result.current.isConfigured,
        "org sem subconta ficou com o card desabilitado — o clique é que provisiona",
      ).toBe(true);
      expect(result.current.configReason).toBeNull();
    },
  );

  it("REMOUNT + REFOCUS 10 minutos depois seguem sem provisionar nada", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = setup({ qc });
    await waitFor(() => expect(first.result.current.isConfigured).toBe(true));

    first.unmount();
    // O envelhecimento é o que dá dente ao teste: sem ele o dado ainda estaria
    // fresco por qualquer `staleTime` e o remount não refetcharia de todo jeito.
    ageProbe(qc, 10 * 60_000);

    const second = setup({ qc });
    await waitFor(() => expect(second.result.current.isConfigured).toBe(true));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // A leitura pura podia até repetir sem dano; o que NÃO pode repetir — nem
    // acontecer uma vez — é o modo que provisiona.
    expect(connectCalls()).toHaveLength(0);
    expect(probeCalls(), "a sonda perdeu o cache e virou chamada por remount").toHaveLength(1);
  });

  it(
    "TRAVA EXPLÍCITA da decisão: a query da sonda declara staleTime Infinity e " +
      "nenhum refetch automático",
    async () => {
      // Asserção de CONFIGURAÇÃO, e de propósito: o caso acima só pega
      // regressões que produzem um refetch observável no jsdom. Baixar
      // `staleTime` sem mexer nos `refetchOn*` não produz refetch nenhum aqui —
      // e ainda assim é a regressão que, em produção, transforma a sonda numa
      // chamada por reconexão de rede (`refetchOnReconnect` é default true).
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { result } = setup({ qc });
      await waitFor(() => expect(result.current.isConfigured).toBe(true));

      const q = qc.getQueryCache().findAll({ queryKey: ["notificame_start_url"] })[0];
      const opts = (q as unknown as { options: Record<string, unknown> }).options;
      expect(opts.staleTime).toBe(Infinity);
      expect(opts.refetchOnMount).toBe(false);
      expect(opts.refetchOnWindowFocus).toBe(false);
    },
  );

  it("CONTROLE POSITIVO: o CLIQUE — e só ele — produz a chamada mode:'connect'", async () => {
    // Sem este caso, todo o bloco acima passaria numa implementação que nunca
    // provisiona nada e deixa a feature morta.
    const { result } = setup();
    await waitFor(() => expect(result.current.isConfigured).toBe(true));
    expect(connectCalls()).toHaveLength(0);

    act(() => {
      result.current.connectNotificame();
    });

    await waitFor(() => expect(connectCalls()).toHaveLength(1));
    expect(bodyOf(connectCalls()[0]).mode).toBe("connect");
  });

  it("estado `isProvisioning` é distinto de `isConfigLoading` — criar subconta demora visivelmente", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isConfigLoading).toBe(false));
    expect(
      Object.keys(result.current),
      "sem isProvisioning a UI mostra 'indisponível' enquanto a conta está sendo criada",
    ).toContain("isProvisioning");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. PRIMEIRO CLIQUE DA ORG — a janela abre ANTES de a URL existir
// ═════════════════════════════════════════════════════════════════════════════

describe("primeiro clique (org ainda sem subconta)", () => {
  async function firstClick(connect?: InvokeResult) {
    routeInvoke({ probe: STATUS_UNPROVISIONED, ...(connect ? { connect } : {}) });
    const popup = stubPopup();
    openSpy.mockReturnValue(popup);
    const view = setup();
    await waitFor(() => expect(view.result.current.isConfigured).toBe(true));
    act(() => {
      view.result.current.connectNotificame();
    });
    return { ...view, popup };
  }

  it(
    "a janela abre SÍNCRONA no gesto mesmo sem URL, e é NAVEGADA quando o " +
      "connect responde",
    async () => {
      const { popup } = await firstClick();

      // Síncrono: o `act` acima não faz flush de microtasks. Se o hook esperasse
      // o provisionamento para só então abrir, esta asserção estaria vermelha —
      // e o Safari/Firefox bloqueariam a janela em produção.
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(String(openSpy.mock.calls[0][0])).toBe("about:blank");

      await waitFor(() => expect((popup as unknown as { location: { href: string } }).location.href)
        .toBe(START_URL));
      expect(popup.close).not.toHaveBeenCalled();
    },
  );

  it("a URL provisionada é SEMEADA no cache — o segundo clique já abre no fornecedor", async () => {
    const { result, popup } = await firstClick();
    await waitFor(() => expect((popup as unknown as { location: { href: string } }).location.href)
      .toBe(START_URL));

    // Conclui o primeiro fluxo para destravar `isConnecting`.
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });
    await waitFor(() => expect(result.current.isConnecting).toBe(false));

    const second = stubPopup();
    openSpy.mockReturnValue(second);
    act(() => {
      result.current.connectNotificame();
    });
    expect(
      String(openSpy.mock.calls[1][0]),
      "o segundo clique reabriu em branco — a URL provisionada não foi guardada",
    ).toBe(START_URL);
  });

  it(
    "provisionamento FALHOU: a janela em branco é FECHADA com motivo, e o " +
      "botão não fica preso em spinner",
    async () => {
      const { result, popup } = await firstClick({
        data: {
          configured: false,
          code: "subaccount_provision_failed",
          reason: "Não foi possível preparar sua conta oficial. Tente de novo em instantes.",
        },
        error: null,
      });

      await waitFor(() => expect(popup.close).toHaveBeenCalled());
      await waitFor(() => expect(result.current.isConnecting).toBe(false));
      expect(result.current.isProvisioning).toBe(false);
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/conta oficial/i));
      expect(finishCalls(), "um provisionamento falho não pode vincular canal nenhum").toHaveLength(0);
    },
  );

  it("provisioning_in_progress no clique é aviso retentável, não tela quebrada", async () => {
    const { result, popup } = await firstClick({
      data: { configured: false, code: "provisioning_in_progress" },
      error: null,
    });

    await waitFor(() => expect(popup.close).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isConnecting).toBe(false));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/preparando sua conta/i));
    // O card volta ao estado utilizável: clicar de novo é o caminho de saída.
    expect(result.current.isConfigured).toBe(true);
  });

  it("403 no connect (não-admin que passou pelo card) fecha a janela dizendo por quê", async () => {
    const { result, popup } = await firstClick({
      data: null,
      error: fnHttpError(403, {
        error: "Apenas administradores podem conectar o WhatsApp Oficial",
        code: "permission_denied",
      }),
    });

    await waitFor(() => expect(popup.close).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isConnecting).toBe(false));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/administradores/i));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. SESSÃO — baseline pelo nosso canal, depois do window.open
// ═════════════════════════════════════════════════════════════════════════════

describe("sessão de conexão (baseline)", () => {
  async function clicked() {
    const view = setup();
    await waitFor(() => expect(view.result.current.isConfigured).toBe(true));
    act(() => {
      view.result.current.connectNotificame();
    });
    return view;
  }

  it("o connect parte DEPOIS do window.open — nunca antes", async () => {
    await clicked();

    // O `window.open` acontece DENTRO do `act` síncrono: se o hook desse
    // qualquer `await` antes dele, esta asserção já estaria vermelha — que é
    // exatamente o que o bloqueador de pop-up faz no Safari/Firefox.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(String(openSpy.mock.calls[0][0])).toBe(START_URL);
    expect(connectCalls()).toHaveLength(1);

    // E a ORDEM entre os dois, que é o contrato de verdade. Não se assere
    // AUSÊNCIA da chamada aqui: disparar o connect de forma síncrona logo após o
    // open é o desenho correto — adiá-lo por timer abriria janela para o clique
    // ser desfeito antes de a foto dos canais ser tirada.
    const openOrder = openSpy.mock.invocationCallOrder[0];
    const connectIdx = invokeMock.mock.calls.findIndex(
      (c) => c[0] === "notificame-channel-start" && bodyOf(c).mode === "connect",
    );
    expect(connectIdx).toBeGreaterThanOrEqual(0);
    expect(
      invokeMock.mock.invocationCallOrder[connectIdx],
      "a chamada de provisionamento partiu ANTES do window.open",
    ).toBeGreaterThan(openOrder);
  });

  it("o finish carrega o session_id junto do organization_id", async () => {
    await clicked();
    await waitFor(() => expect(connectCalls()).toHaveLength(1));
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });

    await waitFor(() => expect(finishCalls()).toHaveLength(1));
    expect(finishCalls()[0][1]).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({ organization_id: ORG, session_id: SESSION_ID }),
      }),
    );
  });

  it(
    "sessão indisponível não derruba o fluxo: o popup já tem destino (a org JÁ " +
      "tinha subconta), e o finish degrada para o caminho sem baseline",
    async () => {
      // Distinção que o hook precisa fazer: connect que falha COM a janela já
      // apontada para o fornecedor não é motivo para derrubar o fluxo — o
      // provisionamento era no-op e só a foto se perdeu. Já a janela EM BRANCO
      // (bloco 2) tem que ser fechada, senão fica em branco para sempre.
      routeInvoke({ connect: { data: null, error: new Error("listChannels falhou") } });
      await clicked();
      await post(NOTIFICAME_ORIGIN, { status: "channel-success" });

      await waitFor(() => expect(finishCalls()).toHaveLength(1));
      const body = (finishCalls()[0][1] as { body?: Record<string, unknown> })?.body ?? {};
      expect(body.organization_id).toBe(ORG);
      expect(body.session_id ?? null).toBeNull();
    },
  );

  // O retry do finish espera FINISH_RETRY_DELAY_MS (2s) entre tentativas; o
  // `waitFor` padrão desiste em 1s. O timeout explícito é o que separa "não
  // retentou" de "o teste não esperou o suficiente".
  it("ambiguous_channel COM sessão é retentável (2+ só acontece sob concorrência real)", async () => {
    routeInvoke({
      finish: { data: null, error: fnHttpError(409, { code: "ambiguous_channel", candidates: 2 }) },
    });
    await clicked();
    await waitFor(() => expect(connectCalls()).toHaveLength(1));
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });

    await waitFor(() => expect(finishCalls().length).toBeGreaterThan(1), { timeout: 8_000 });
    // A microcopy antiga ("resolva no painel do NotificaMe") virou mentira sob
    // subconta: nós é que detemos o token; o cliente não tem painel onde entrar.
    const mensagens = (toast.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0]))
      .join(" | ");
    expect(mensagens).not.toMatch(/painel do NotificaMe/i);
  }, 20_000);

  it(
    "CONTROLE NEGATIVO: ambiguous_channel SEM sessão NÃO é retentado — sem " +
      "baseline, ambíguo é estado parado e retentar só repete o mesmo erro",
    async () => {
      routeInvoke({
        // Connect OK, mas a FOTO falhou ⇒ o finish vai sem `session_id`.
        connect: { data: { configured: true, start_url: START_URL, session_id: null }, error: null },
        finish: { data: null, error: fnHttpError(409, { code: "ambiguous_channel", candidates: 2 }) },
      });
      await clicked();
      await waitFor(() => expect(connectCalls()).toHaveLength(1));
      await post(NOTIFICAME_ORIGIN, { status: "channel-success" });

      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      // Uma janela larga o suficiente para um retry indevido aparecer.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 2_500));
      });
      expect(finishCalls()).toHaveLength(1);
    },
    20_000,
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. PERMISSÃO — o servidor exige ADMIN, e o hook precisa dizer por quê
// ═════════════════════════════════════════════════════════════════════════════
//
// O gate do servidor subiu de degrau nesta revisão: `whatsapp.manage_instances`
// nasce `default_value = true` / `is_admin_only = false` no seed, então TODO
// membro ativo passava por ela — e passar significa receber, no próprio browser,
// o token da subconta, que é IMUTÁVEL e não tem revogação. Agora é admin ou
// master. O que o browser pode fazer a respeito é UMA coisa só: nunca deixar o
// 403 virar tela quebrada, e dizer QUEM pode em vez de "erro".

describe("permission_denied (gate server-side de admin)", () => {
  it("403 no finish vira microcopy de permissão e NÃO invalida a lista de instâncias", async () => {
    routeInvoke({
      finish: {
        data: null,
        error: fnHttpError(403, {
          error: "Você não tem permissão para conectar números nesta organização",
          code: "permission_denied",
        }),
      },
    });
    const view = setup();
    await waitFor(() => expect(view.result.current.isConfigured).toBe(true));
    act(() => {
      view.result.current.connectNotificame();
    });
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String((toast.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]))
      .toMatch(/administradores/i);
    expect(invalidatedInstances(view.invalidateSpy)).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it(
    "403 na sonda (membro não-admin) deixa o card inerte dizendo QUEM pode — " +
      "e clicar não abre janela nenhuma",
    async () => {
      routeInvoke({
        probe: {
          data: null,
          error: fnHttpError(403, {
            error: "Apenas administradores podem conectar o WhatsApp Oficial",
            code: "permission_denied",
          }),
        },
      });
      const { result } = setup();
      await waitFor(() => expect(result.current.isConfigLoading).toBe(false));

      expect(result.current.isConfigured).toBe(false);
      expect(result.current.configReason).toMatch(/administradores/i);

      act(() => {
        result.current.connectNotificame();
      });
      expect(openSpy).not.toHaveBeenCalled();
      expect(
        connectCalls(),
        "um não-admin conseguiu disparar o caminho que provisiona",
      ).toHaveLength(0);
    },
  );

  it("a razão mostrada ao não-admin NÃO ecoa a mensagem crua do servidor", async () => {
    // `withErrorBoundary` devolve `error.message` CRU, e uma falha ao falar com o
    // fornecedor pode carregar o token da conta-mãe nessa string. Só o `code` —
    // vocabulário fechado nosso — pode virar texto de tela.
    routeInvoke({
      probe: {
        data: null,
        error: fnHttpError(403, { error: `vazou ${PARENT_TOKEN}`, code: "permission_denied" }),
      },
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.isConfigLoading).toBe(false));

    expect(result.current.configReason).not.toContain(PARENT_TOKEN);
    expect(result.current.configReason).toMatch(/administradores/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. O token da conta-mãe nunca aparece em nada que o browser toque
// ═════════════════════════════════════════════════════════════════════════════

describe("não-vazamento do token da conta-mãe (asserção explícita)", () => {
  it("num fluxo COMPLETO de sucesso, nada exposto ao browser contém o token do pai", async () => {
    const view = setup();
    await waitFor(() => expect(view.result.current.isConfigured).toBe(true));
    act(() => {
      view.result.current.connectNotificame();
    });
    await waitFor(() => expect(connectCalls()).toHaveLength(1));
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });
    await waitFor(() => expect(finishCalls()).toHaveLength(1));

    const surface = browserSurface(view.result.current);
    expect(deepScan(surface, PARENT_TOKEN), "token da conta-mãe alcançável pelo browser").toEqual([]);

    // CONTROLE POSITIVO — o token da SUBCONTA PRECISA estar na URL do popup,
    // senão a varredura acima passaria num fluxo que nunca abriu janela nenhuma.
    expect(String(openSpy.mock.calls[0][0])).toContain(SUB_TOKEN);
  });

  it(
    "se o servidor vazar o token do pai numa resposta, o hook não o repete num toast " +
      "(defesa em profundidade — o `withErrorBoundary` devolve error.message CRU)",
    async () => {
      routeInvoke({
        probe: {
          data: null,
          error: fnHttpError(500, { error: `falha ao usar ${PARENT_TOKEN}`, code: "boom" }),
        },
      });
      const { result } = setup();
      await waitFor(() => expect(result.current.isConfigLoading).toBe(false));

      act(() => {
        result.current.connectNotificame();
      });

      const toastArgs = (["info", "error", "warning"] as const).flatMap(
        (k) => (toast[k] as unknown as { mock: { calls: unknown[][] } }).mock.calls,
      );
      expect(deepScan(toastArgs, PARENT_TOKEN), "o token do pai foi ecoado num toast").toEqual([]);
      expect(deepScan(result.current, PARENT_TOKEN)).toEqual([]);
    },
  );

  it("nenhum body de invoke carrega token — o browser só manda organization_id e session_id", async () => {
    const view = setup();
    await waitFor(() => expect(view.result.current.isConfigured).toBe(true));
    act(() => {
      view.result.current.connectNotificame();
    });
    await waitFor(() => expect(connectCalls()).toHaveLength(1));
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });
    await waitFor(() => expect(finishCalls()).toHaveLength(1));

    for (const call of invokeMock.mock.calls) {
      const body = (call[1] as { body?: Record<string, unknown> })?.body ?? {};
      expect(deepScan(body, PARENT_TOKEN)).toEqual([]);
      expect(deepScan(body, SUB_TOKEN), "o browser devolveu a credencial da subconta ao servidor").toEqual([]);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. postMessage forjado — sob subconta o dano mudou, a regra não
// ═════════════════════════════════════════════════════════════════════════════

describe("postMessage de origem forjada", () => {
  it("origem forjada não abre sessão, não chama o finish — e a legítima logo depois funciona", async () => {
    const view = setup();
    await waitFor(() => expect(view.result.current.isConfigured).toBe(true));
    act(() => {
      view.result.current.connectNotificame();
    });
    await waitFor(() => expect(connectCalls()).toHaveLength(1));

    for (const forjada of [
      "https://evil-notificame.com.br",
      "https://api.notificame.com.br.evil.io",
      "http://api.notificame.com.br",
      "https://hub.notificame.com.br",
    ]) {
      // Payload plausível e HOSTIL: tenta impor uma sessão (baseline) escolhida
      // pelo atacante, que é o que decide QUAL canal acaba vinculado.
      await post(forjada, { status: "channel-success", session_id: "sessao-do-atacante" });
      await post(forjada, JSON.stringify({ status: "channel-success", session_id: "sessao-do-atacante" }));
    }

    expect(finishCalls()).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
    expect(view.result.current.isConnecting).toBe(true);

    // CONTROLE POSITIVO — sem ele o bloco passaria num hook que nunca escuta.
    await post(NOTIFICAME_ORIGIN, { status: "channel-success" });
    await waitFor(() => expect(finishCalls()).toHaveLength(1));
  });

  it("o session_id do finish vem do NOSSO start, nunca do payload do terceiro", async () => {
    const view = setup();
    await waitFor(() => expect(view.result.current.isConfigured).toBe(true));
    act(() => {
      view.result.current.connectNotificame();
    });
    await waitFor(() => expect(connectCalls()).toHaveLength(1));

    // Mensagem LEGÍTIMA (origem correta) tentando impor outra sessão.
    await post(NOTIFICAME_ORIGIN, { status: "channel-success", session_id: "sessao-do-atacante" });

    await waitFor(() => expect(finishCalls()).toHaveLength(1));
    const body = (finishCalls()[0][1] as { body?: Record<string, unknown> })?.body ?? {};
    expect(body.session_id).toBe(SESSION_ID);
    expect(body.session_id).not.toBe("sessao-do-atacante");
  });
});
