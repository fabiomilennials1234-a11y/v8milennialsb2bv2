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
import userEvent from "@testing-library/user-event";
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
}));

// ─── a fronteira de rede ─────────────────────────────────────────────────────

let tokensPedidos: string[] = [];
let entregarEvento: ((e: SessionEvent) => void) | null = null;

/**
 * Toda a fronteira de rede da voz, espionada — e não só o pedaço que interessa.
 *
 * `rejectCall` e `endCall` estão aqui porque a decisão da fatia sobre RECUSAR é
 * uma NEGATIVA: recusar no CRM não fala com a VPS. Uma negativa só vale se o
 * caminho que ela proíbe existir no dublê; sem estes dois, "não chamou rejeitar"
 * passaria porque a função nem estava lá para ser chamada.
 */
const acceptCallNaRede = vi.fn();
const rejectCallNaRede = vi.fn();
const endCallNaRede = vi.fn();

vi.mock("@/modules/communication/lib/torquecallsApi", () => ({
  requestStreamToken: async (args: { tcSessionId: string }) => {
    tokensPedidos.push(args.tcSessionId);
    return { token: "tok", expiresAt: 0, renewInMs: 45_000, vpsUrl: "https://vps.test" };
  },
  acceptCall: (...a: unknown[]) => acceptCallNaRede(...a),
  rejectCall: (...a: unknown[]) => rejectCallNaRede(...a),
  endCall: (...a: unknown[]) => endCallNaRede(...a),
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

/**
 * Dirige `busy` sem uma chamada de verdade — e o dublê de `answer` PROJETA o que
 * o real faz, não uma constante.
 *
 * A parte que importa é a fase: o `useVoiceCall` de verdade entra em
 * `accepting` no ATO do clique, antes de qualquer ida à rede, e é dela que sai o
 * `busy` do provider (via `FASES_EM_CURSO`) e o `ringEnabled: !busy` do tom. Um
 * dublê que devolvesse uma promessa sem mexer na fase seria mais frouxo que o
 * real exatamente no eixo que esta fatia criou — e "atender cala o toque"
 * passaria sem que atender calasse coisa nenhuma.
 *
 * `resultadoDoAnswer` encena o desfecho: `false` é o atendimento que não
 * aconteceu (microfone negado, celular pegou primeiro), e o real volta ao
 * repouso nesse caso.
 */
let fase: CallPhase = "idle";
let resultadoDoAnswer = true;
const answerNoHook = vi.fn();
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
    answer: (offer: unknown) => {
      answerNoHook(offer);
      fase = "accepting";
      return Promise.resolve(resultadoDoAnswer).then((ok) => {
        if (!ok) fase = "idle";
        return ok;
      });
    },
    hangup: vi.fn(),
    toggleMute: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm-1", role: "member" }),
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

import { VoiceCallProvider, useVoiceCallContext } from "./VoiceCallProvider";
import type { IncomingVoiceCall } from "@/modules/communication/hooks/useIncomingVoiceCalls";

const JID = "555185960716@s.whatsapp.net";

/**
 * O caminho de quem FORJA o pedido.
 *
 * Esconder o botão não fecha nada: `answerIncoming` é superfície de contexto, e
 * qualquer tela do produto — ou qualquer console — pode chamá-la com uma oferta
 * inventada. Este componente é exatamente esse chamador, e existe para que o
 * gate seja exercido pelo lado por onde ele pode ser burlado.
 */
let forjar: (call: IncomingVoiceCall) => void = () => {};
function Forjador() {
  const { answerIncoming } = useVoiceCallContext();
  forjar = answerIncoming;
  return null;
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <VoiceCallProvider>
        <Forjador />
      </VoiceCallProvider>
    </QueryClientProvider>,
  );
}

/** Uma oferta como a que o stream monta, para o caminho forjado. */
function oferta(over: Partial<IncomingVoiceCall> = {}): IncomingVoiceCall {
  return {
    tcSessionId: "tc-entrada",
    tcCallId: "call-forjada",
    instanceName: "Só Entrada",
    peerDigits: "555185960716",
    offeredAt: 1_700_000_000_000,
    ...over,
  };
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
  resultadoDoAnswer = true;
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

// ─── ATENDER (E4) ────────────────────────────────────────────────────────────

describe("atender a ligação que entra", () => {
  it("o clique em Atender leva a oferta INTEIRA ao atendimento", async () => {
    const user = userEvent.setup();
    await montarComStream();
    ofertar("tc-entrada", "call-1");
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: /Atender/ }));

    expect(answerNoHook).toHaveBeenCalledTimes(1);
    // A SESSÃO da oferta, e não a preferência de discagem (`tc-saida`), é o que
    // decide a autorização e por onde o `endCall` vai sair depois.
    expect(answerNoHook).toHaveBeenCalledWith({
      tcSessionId: "tc-entrada",
      tcCallId: "call-1",
      peerDigits: "555185960716",
    });
  });

  /**
   * O cartão sai e o TOM CALA no clique — antes de qualquer ida à rede.
   *
   * A decisão é do vendedor; a tela responde a ela, não à latência. Um provider
   * que esperasse a resposta do servidor deixaria o telefone tocando no fone de
   * quem já apertou atender.
   */
  it("atender tira o cartão da tela e cala o tom", async () => {
    const user = userEvent.setup();
    await montarComStream();
    ofertar("tc-entrada", "call-1");
    await screen.findByRole("alert");
    expect(startIncomingRing).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Atender/ }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(pararTom).toHaveBeenCalled();
  });

  /**
   * A OFERTA VOLTA quando o atendimento falha por algo que o vendedor conserta.
   *
   * Microfone negado é o caso comum na primeira ligação de cada pessoa, e a
   * ligação continua tocando de verdade: engolir o cartão tiraria dele a segunda
   * tentativa por um erro que é dele para resolver.
   */
  it("o atendimento que falha devolve o cartão à tela", async () => {
    const user = userEvent.setup();
    resultadoDoAnswer = false;
    await montarComStream();
    ofertar("tc-entrada", "call-1");
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: /Atender/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  /**
   * A segunda oferta segue tocando quando a primeira é atendida.
   *
   * DUAS de propósito: com uma só na tela, um provider que dispensasse a lista
   * inteira em vez da oferta clicada seria indistinguível do certo — o mesmo
   * mutante de truncamento que sobrevivia à suíte com fixture de um elemento.
   */
  it("atender uma não apaga a outra que está tocando", async () => {
    const user = userEvent.setup();
    await montarComStream();
    ofertar("tc-entrada", "call-1", "555185960716@s.whatsapp.net");
    ofertar("tc-entrada-2", "call-2", "554899887766@s.whatsapp.net");
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));

    await user.click(screen.getAllByRole("button", { name: /Atender/ })[0]);

    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    expect(screen.getByText("(48) 99988-7766")).toBeInTheDocument();
  });
});

describe("quem não está na lista do número não atende", () => {
  /**
   * O gate, exercido pelo lado por onde ele pode ser burlado: chamando
   * `answerIncoming` direto, com uma oferta forjada para um número que este
   * vendedor só pode USAR PARA LIGAR.
   */
  it("uma oferta forjada para número fora do alcance não vira atendimento", async () => {
    await montarComStream();

    act(() => forjar(oferta({ tcSessionId: "tc-saida", instanceName: "Só Saída" })));

    expect(answerNoHook).not.toHaveBeenCalled();
    expect(acceptCallNaRede).not.toHaveBeenCalled();
  });

  /**
   * O CONTROLE POSITIVO, e sem ele o caso acima não prova nada.
   *
   * É a mesma chamada, forjada do mesmo jeito, pelo mesmo caminho — muda só a
   * sessão. Se ela também não atendesse, a asserção negativa de cima estaria
   * passando porque `answerIncoming` está quebrada, porque a oferta tem forma
   * errada, ou porque o dublê não fia nada — e não porque o gate funciona.
   */
  it("a MESMA oferta forjada, num número ao alcance, atende — controle positivo", async () => {
    await montarComStream();

    act(() => forjar(oferta({ tcSessionId: "tc-entrada" })));

    expect(answerNoHook).toHaveBeenCalledWith(
      expect.objectContaining({ tcSessionId: "tc-entrada" }),
    );
  });

  /**
   * Em chamada, nem pelo caminho forjado. O botão já vem desabilitado, mas a
   * guarda tem de morar no ponto por onde todo atendimento passa: o servidor
   * recusaria com `operator_busy` e o índice `idx_voip_calls_one_live_per_operator`
   * recusaria a segunda linha viva do mesmo operador.
   */
  it("já em chamada, o atendimento forjado é recusado", async () => {
    fase = "active";
    await montarComStream();

    act(() => forjar(oferta({ tcSessionId: "tc-entrada" })));

    expect(answerNoHook).not.toHaveBeenCalled();
  });

  /**
   * A CONSEQUÊNCIA da classificação de `accepting` como fase EM CURSO, exercida
   * pelo produto e não pela partição.
   *
   * Enquanto se atende a primeira, a segunda não pode ser atendida: o servidor
   * recusaria com `operator_busy` e o índice
   * `idx_voip_calls_one_live_per_operator` recusaria a segunda linha viva do
   * mesmo operador. Com `accepting` no repouso, `busy` seria `false` no meio do
   * atendimento e este caminho passaria — é o mesmo mutante que o guardião de
   * `callPhases` mata, morrendo aqui pela segunda vez, do lado do comportamento.
   */
  it("atendendo uma, a segunda não é atendida por baixo", async () => {
    const user = userEvent.setup();
    await montarComStream();
    ofertar("tc-entrada", "call-1");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: /Atender/ }));
    await waitFor(() => expect(answerNoHook).toHaveBeenCalledTimes(1));

    act(() => forjar(oferta({ tcSessionId: "tc-entrada-2", tcCallId: "call-2" })));

    expect(answerNoHook).toHaveBeenCalledTimes(1);
  });
});

describe("recusar sai da lista — não encerra a ligação de ninguém", () => {
  /**
   * A decisão da fatia, e a razão dela: a MESMA ligação toca para todos os
   * vendedores da lista do número e no celular ao mesmo tempo. Um deles dizendo
   * "agora não" não fala pelos outros. Mandar `/reject` derrubaria a chamada
   * para os colegas que estavam prestes a atender e para o aparelho na mão dele
   * — e o ADR-0027 registra que o CRM nunca recusa a oferta ao WhatsApp.
   */
  it("recusar não fala com a VPS", async () => {
    const user = userEvent.setup();
    await montarComStream();
    ofertar("tc-entrada", "call-1");
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: /Recusar/ }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(rejectCallNaRede).not.toHaveBeenCalled();
    expect(endCallNaRede).not.toHaveBeenCalled();
    expect(acceptCallNaRede).not.toHaveBeenCalled();
    // E ninguém entrou em chamada: recusar não é atender.
    expect(answerNoHook).not.toHaveBeenCalled();
  });

  it("recusar cala o tom", async () => {
    const user = userEvent.setup();
    await montarComStream();
    ofertar("tc-entrada", "call-1");
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: /Recusar/ }));

    await waitFor(() => expect(pararTom).toHaveBeenCalled());
  });

  /**
   * Recusar UMA não recusa as outras. Duas ofertas de propósito, pelo mesmo
   * motivo de sempre: cortar uma lista de um elemento é a identidade.
   */
  it("recusar uma deixa a outra tocando", async () => {
    const user = userEvent.setup();
    await montarComStream();
    ofertar("tc-entrada", "call-1", "555185960716@s.whatsapp.net");
    ofertar("tc-entrada-2", "call-2", "554899887766@s.whatsapp.net");
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));

    await user.click(screen.getAllByRole("button", { name: /Recusar/ })[0]);

    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    expect(screen.getByText("(48) 99988-7766")).toBeInTheDocument();
  });

  /**
   * E a oferta recusada NÃO VOLTA.
   *
   * A VPS retransmite `incoming` — é a razão de existir o dedupe por par. Sem a
   * marca sobrevivendo à retransmissão, o cartão que o vendedor acabou de tirar
   * da frente reapareceria sozinho em segundos, e o toque com ele.
   */
  it("a oferta recusada não volta quando a VPS retransmite", async () => {
    const user = userEvent.setup();
    await montarComStream();
    ofertar("tc-entrada", "call-1");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: /Recusar/ }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());

    ofertar("tc-entrada", "call-1");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("a corrida com o celular", () => {
  /**
   * Atender pelo CELULAR fecha a tela do CRM.
   *
   * O evento chega pelo mesmo stream, e é o mesmo fim de sempre: a oferta deixou
   * de esperar por este vendedor. Ele não precisa fechar nada.
   */
  it("o celular atendendo tira o cartão sozinho", async () => {
    await montarComStream();
    ofertar("tc-entrada", "call-1");
    await screen.findByRole("alert");

    act(() => {
      entregarEvento?.({
        type: "incoming-claimed",
        sessionId: "tc-entrada",
        id: "call-1",
      } as unknown as SessionEvent);
    });

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(pararTom).toHaveBeenCalled();
  });

  /**
   * Controle positivo do caso acima: o mesmo evento, para a chamada de OUTRA
   * sessão, não pode fechar este cartão. Sem ele, um provider que apagasse tudo
   * a cada `incoming-claimed` passaria na asserção anterior.
   */
  it("o celular atendendo a OUTRA ligação não mexe nesta", async () => {
    await montarComStream();
    ofertar("tc-entrada", "call-1");
    await screen.findByRole("alert");

    act(() => {
      entregarEvento?.({
        type: "incoming-claimed",
        sessionId: "tc-entrada-2",
        id: "call-1",
      } as unknown as SessionEvent);
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  /**
   * O cliente desistindo também fecha a tela — o vendedor não fica com um cartão
   * de uma ligação que já morreu. Mesma máquina, outro motivo.
   */
  it("o cliente desistindo tira o cartão sozinho", async () => {
    await montarComStream();
    ofertar("tc-entrada", "call-1");
    await screen.findByRole("alert");

    act(() => {
      entregarEvento?.({
        type: "call-ended",
        sessionId: "tc-entrada",
        id: "call-1",
        reason: "timeout",
      } as unknown as SessionEvent);
    });

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
