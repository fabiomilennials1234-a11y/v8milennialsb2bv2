/**
 * A FIAÇÃO das ligações que entram — o provider real, sem dublê no meio.
 *
 * ─── Por que este arquivo existe ────────────────────────────────────────────
 * Porque os outros dois testes do provider dublam `useIncomingVoiceCalls`
 * INTEIRO e devolvem **a mesma constante** para `useCallableVoiceNumbers` e
 * `useAnswerableVoiceNumbers`. Isso é um dublê mais frouxo que o real
 * exatamente no eixo que a fatia existe para criar — e o preço foi medido:
 * trocar `useAnswerableVoiceNumbers()` por `useCallableVoiceNumbers()` no
 * provider **desfazia a inversão do gate** e a suíte ficava inteira verde.
 *
 * Se as duas listas são a mesma no teste, trocar uma pela outra não muda nada.
 * Aqui elas são **deliberadamente diferentes**: um número só para LIGAR, outro
 * só para RECEBER. Toda asserção deste arquivo depende dessa diferença.
 *
 * ─── O que fica real ────────────────────────────────────────────────────────
 * `useIncomingVoiceCalls` (o hook de verdade, com o stream), `IncomingCallPanel`
 * e `VoiceCallPanel`. Dublados só a fronteira de rede (token + stream), o tom, e
 * `useVoiceCall` — este último para poder dirigir `busy` sem uma chamada real.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallPhase, VoiceCallState } from "@/modules/communication/hooks/useVoiceCall";
import type { SessionEvent } from "@/modules/communication/lib/torquecallsEvents";

// ─── as DUAS listas, diferentes de propósito ─────────────────────────────────

/** Só para LIGAR. Nenhuma ligação que entre por ele deve tocar. */
const SO_PARA_LIGAR = {
  tcSessionId: "tc-saida",
  instanceId: "i-saida",
  instanceName: "Só Saída",
};
/**
 * DOIS números só para RECEBER, e o segundo não é decoração.
 *
 * Com um número só na lista, `answerable.slice(0, 1)` no provider é a IDENTIDADE
 * — um truncamento que some com a segunda ligação de um vendedor que atende dois
 * números não seria visto por teste nenhum. Medido: aquele mutante sobrevivia à
 * suíte inteira de 621 arquivos, e a causa era exatamente este fixture ter um
 * elemento.
 */
const SO_PARA_RECEBER = {
  tcSessionId: "tc-entrada",
  instanceId: "i-entrada",
  instanceName: "Só Entrada",
};
const SO_PARA_RECEBER_2 = {
  tcSessionId: "tc-entrada-2",
  instanceId: "i-entrada-2",
  instanceName: "Só Entrada 2",
};

vi.mock("@/modules/communication/hooks/useVoipSession", () => ({
  useCallableVoiceNumbers: () => ({ numbers: [SO_PARA_LIGAR], isLoading: false }),
  useAnswerableVoiceNumbers: () => ({
    numbers: [SO_PARA_RECEBER, SO_PARA_RECEBER_2],
    isLoading: false,
  }),
  useCanCallLead: () => true,
}));

// ─── a fronteira de rede ─────────────────────────────────────────────────────

let tokensPedidos: string[] = [];
let entregarEvento: ((e: SessionEvent) => void) | null = null;

vi.mock("@/modules/communication/lib/torquecallsApi", () => ({
  requestStreamToken: async (args: { tcSessionId: string }) => {
    tokensPedidos.push(args.tcSessionId);
    return { token: "tok", expiresAt: 0, renewInMs: 45_000, vpsUrl: "https://vps.test" };
  },
}));

vi.mock("@/modules/communication/lib/torquecallsEvents", () => ({
  subscribeSessionEvents: (args: {
    onEvent: (e: SessionEvent) => void;
    signal: AbortSignal;
  }) =>
    new Promise<void>((resolve) => {
      entregarEvento = args.onEvent;
      args.signal.addEventListener("abort", () => {
        entregarEvento = null;
        resolve();
      });
    }),
}));

const pararTom = vi.fn();
let silenciarTom = false;
const startIncomingRing = vi.fn(
  (opts?: { onSilenced?: () => void; onAudible?: () => void }) => {
    if (silenciarTom) opts?.onSilenced?.();
    else opts?.onAudible?.();
    return { stop: pararTom };
  },
);

vi.mock("@/modules/communication/lib/voiceRingback", () => ({
  startIncomingRing: (...a: unknown[]) =>
    (startIncomingRing as unknown as (...x: unknown[]) => unknown)(...a),
}));

/** Dirige `busy` sem uma chamada de verdade. */
let fase: CallPhase = "idle";
vi.mock("@/modules/communication/hooks/useVoiceCall", () => ({
  useVoiceCall: () => ({
    state: {
      phase: fase,
      error: null,
      errorCode: null,
      endReason: null,
      callId: null,
      peer: null,
      muted: false,
      elapsedSeconds: 0,
    } as VoiceCallState,
    start: vi.fn(),
    hangup: vi.fn(),
    toggleMute: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm-1", role: "membro" }),
}));

/** O nome de quem liga tem suíte própria; aqui só não pode ir ao banco. */
vi.mock("@/modules/communication/hooks/chat/useConversationCalls", () => ({
  invalidateConversationCalls: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b = {
        select: () => b,
        eq: () => b,
        is: () => b,
        in: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return b;
    },
  },
}));

import { VoiceCallProvider } from "./VoiceCallProvider";

const JID = "555185960716@s.whatsapp.net";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <VoiceCallProvider>
        <div />
      </VoiceCallProvider>
    </QueryClientProvider>,
  );
}

/** A VPS anuncia uma oferta, na ordem real (`incoming` e o `call-status` atrás). */
function ofertar(sessionId: string, id: string, peer = JID) {
  act(() => {
    entregarEvento?.({ type: "incoming", sessionId, id, peer, offeredAt: 1_700_000_000_000 });
    entregarEvento?.({
      type: "call-status",
      sessionId,
      id,
      status: "ringing",
      peer,
    } as unknown as SessionEvent);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tokensPedidos = [];
  entregarEvento = null;
  silenciarTom = false;
  fase = "idle";
});

async function montarComStream() {
  const utils = montar();
  await waitFor(() => expect(entregarEvento).not.toBeNull());
  return utils;
}

describe("o provider consome a lista de RECEBER, não a de ligar", () => {
  /**
   * O mutante que a suíte antiga deixava vivo: trocar
   * `useAnswerableVoiceNumbers()` por `useCallableVoiceNumbers()` em
   * `VoiceCallProvider.tsx`. Com as duas listas diferentes, ele morre aqui — o
   * token sai para a sessão errada.
   */
  it("o stream é aberto para a sessão da lista de RECEBER", async () => {
    await montarComStream();
    expect(tokensPedidos).toEqual(["tc-entrada"]);
  });

  it("a ligação que entra pelo número de RECEBER toca", async () => {
    await montarComStream();

    ofertar("tc-entrada", "call-1");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Só Entrada/)).toBeInTheDocument();
    expect(startIncomingRing).toHaveBeenCalledTimes(1);
  });

  /**
   * O outro lado da inversão, e o controle positivo do teste acima: o número que
   * ele só pode USAR PARA LIGAR não deve tocar. Sem este caso, a asserção
   * anterior passaria mesmo com o provider ignorando a distinção.
   */
  it("a ligação que entra pelo número de SÓ LIGAR não toca nem aparece", async () => {
    await montarComStream();

    ofertar("tc-saida", "call-2");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(startIncomingRing).not.toHaveBeenCalled();
  });

  /**
   * A lista de RECEBER chega ao hook INTEIRA.
   *
   * O vendedor que atende dois números tem de tocar nos dois. Um provider que
   * passasse só o primeiro (`answerable.slice(0, 1)`) deixaria o segundo mudo — e
   * esse mutante sobrevivia à suíte INTEIRA enquanto este fixture tinha um
   * número só, porque cortar uma lista de um em um é identidade.
   */
  it("a ligação que entra pelo SEGUNDO número de receber também toca", async () => {
    await montarComStream();

    ofertar("tc-entrada-2", "call-3");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Só Entrada 2/)).toBeInTheDocument();
    expect(startIncomingRing).toHaveBeenCalledTimes(1);
  });
});

describe("o cartão chega inteiro à tela", () => {
  // O hook devolve a lista; se o provider truncar (passar só a primeira, por
  // exemplo), duas ligações simultâneas viram uma — e "duas ao mesmo tempo não
  // podem se atropelar" é requisito da fatia.
  it("duas ofertas viram DOIS cartões", async () => {
    await montarComStream();

    ofertar("tc-entrada", "call-1", "555185960716@s.whatsapp.net");
    ofertar("tc-entrada", "call-2", "554899887766@s.whatsapp.net");

    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(screen.getByText("(51) 98596-0716")).toBeInTheDocument();
    expect(screen.getByText("(48) 99988-7766")).toBeInTheDocument();
  });

  /**
   * A CHAVE do React é o quarto lugar da identidade — e o único em que o próprio
   * React reclama quando a premissa não vale.
   *
   * Duas sessões podem receber o MESMO `tcCallId`, porque ele vem do stanza
   * remoto. Com `key={call.tcCallId}` os dois cartões renderizam certo hoje, mas
   * o React avisa que chave duplicada "não é suportado e pode mudar numa versão
   * futura" — ou seja, é a mesma premissa derrubada nos outros três lugares,
   * deixada exatamente onde a plataforma diz que ela não vale.
   */
  it("dois cartões com o MESMO id remoto não geram chave duplicada", async () => {
    const erros: unknown[] = [];
    const espiao = vi.spyOn(console, "error").mockImplementation((...a) => erros.push(a));
    try {
      await montarComStream();

      ofertar("tc-entrada", "id-colidido", "555185960716@s.whatsapp.net");
      ofertar("tc-entrada-2", "id-colidido", "554899887766@s.whatsapp.net");

      await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
      const texto = erros.map((e) => JSON.stringify(e)).join(" ");
      expect(texto).not.toMatch(/same key|duplicate key|Encountered two children/i);
    } finally {
      espiao.mockRestore();
    }
  });

  /**
   * `ringSilenced` tem de ATRAVESSAR o provider até o cartão. Ele nasce no hook
   * (o navegador barrou o áudio) e só serve se virar pixel: um toque que não soa
   * é pior que nenhum porque ninguém descobre, e o único lugar onde alguém
   * descobre é esta linha.
   */
  it("o aviso de sem-som atravessa o provider e chega ao cartão", async () => {
    silenciarTom = true;
    await montarComStream();

    ofertar("tc-entrada", "call-1");

    expect(await screen.findByText(/Sem som/)).toBeInTheDocument();
  });

  it("com som, o aviso não aparece", async () => {
    await montarComStream();

    ofertar("tc-entrada", "call-1");

    await screen.findByRole("alert");
    expect(screen.queryByText(/Sem som/)).not.toBeInTheDocument();
  });
});

describe("em chamada: o cartão aparece, o tom cala", () => {
  /**
   * `ringEnabled: !busy`. Um tom no fone por cima de uma conversa em andamento é
   * hostil, e ele não poderia atender a segunda de qualquer jeito — mas o cartão
   * é informação, não interrupção, e some se o provider tratar as duas coisas
   * como uma.
   */
  it("com uma chamada ativa, a oferta APARECE sem tocar", async () => {
    fase = "active";
    await montarComStream();

    ofertar("tc-entrada", "call-1");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(startIncomingRing).not.toHaveBeenCalled();
  });

  it("sem chamada ativa, a mesma oferta toca — controle positivo", async () => {
    fase = "idle";
    await montarComStream();

    ofertar("tc-entrada", "call-1");

    await screen.findByRole("alert");
    expect(startIncomingRing).toHaveBeenCalledTimes(1);
  });
});

describe("a pilha do canto", () => {
  /**
   * Os dois painéis dividem o mesmo canto. Antes cada um carregava o próprio
   * `fixed bottom-6 right-6`, o que bastava enquanto só existia um; com a
   * chamada que entra podendo aparecer durante uma conversa em curso, dois
   * elementos ancorados no mesmo ponto se cobrem.
   */
  it("cartão de entrada e painel de chamada convivem na MESMA pilha", async () => {
    fase = "active";
    const { container } = await montarComStream();

    ofertar("tc-entrada", "call-1");
    await screen.findByRole("alert");

    const pilha = container.querySelector(".fixed.bottom-6.right-6");
    expect(pilha).not.toBeNull();
    // Os dois são filhos da MESMA pilha: nenhum deles se ancora por conta.
    expect(pilha!.querySelector('[role="alert"]')).not.toBeNull();
    expect(pilha!.textContent).toContain("Em chamada");
    // E ninguém reintroduziu uma âncora própria dentro da pilha.
    expect(pilha!.querySelectorAll(".fixed")).toHaveLength(0);
  });

  // A faixa vazia da coluna não pode engolir cliques da tela atrás dela.
  it("a pilha não intercepta cliques onde não há cartão", async () => {
    const { container } = await montarComStream();
    const pilha = container.querySelector(".fixed.bottom-6.right-6");
    expect(pilha!.className).toContain("pointer-events-none");
  });
});
