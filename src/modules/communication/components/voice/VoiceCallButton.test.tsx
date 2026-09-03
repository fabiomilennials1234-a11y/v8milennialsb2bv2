import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallableVoiceNumber } from "@/modules/communication/hooks/useVoipSession";
import type { VoiceCallState } from "@/modules/communication/hooks/useVoiceCall";

// Radix (dropdown + Popper) usa APIs de ponteiro e ResizeObserver que o jsdom
// não implementa. Sem estes stubs o menu nem abre, e o teste da escolha viraria
// um falso vermelho sobre o ambiente em vez de sobre o produto.
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
  (globalThis as Record<string, unknown>).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let numbers: CallableVoiceNumber[] = [];
/** Cada `tcSessionId` que o `useVoiceCall` recebeu, na ordem dos renders. */
let sessoesRecebidas: Array<string | null> = [];
let fase: VoiceCallState["phase"] = "idle";
const start = vi.fn();

vi.mock("@/modules/communication/hooks/useVoipSession", () => ({
  useCallableVoiceNumbers: () => ({ numbers, isLoading: false }),
  // A lista de RECEBER responde outra pergunta e não decide botão nenhum. Ela
  // entra no dublê porque o `VoiceCallProvider`, que estes testes montam de
  // verdade, a consome desde a fatia do toque de entrada.
  useAnswerableVoiceNumbers: () => ({ numbers, isLoading: false }),
}));

/**
 * Toda consulta que alguém tentar fazer ao banco a partir do botão. Desde
 * 2026-09-02 a resposta certa é NENHUMA: "vê o lead → pode ligar", e quem
 * decide se o lead está na tela é a RLS. Se este dublê registrar uma leitura
 * de `leads`, alguém reintroduziu a pergunta de dono que sumia o botão do SDR.
 */
const tabelasConsultadas: string[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      tabelasConsultadas.push(table);
      throw new Error(`o botão de ligar consultou "${table}" — ele não deveria consultar nada`);
    },
  },
}));

/**
 * As ligações que ENTRAM não têm nada a ver com o botão de discar, e o hook real
 * abriria uma conexão de rede aqui dentro. O dublê devolve lista vazia; o que
 * elas fazem tem suíte própria em `useIncomingVoiceCalls.test.ts`.
 */
vi.mock("@/modules/communication/hooks/useIncomingVoiceCalls", () => ({
  useIncomingVoiceCalls: () => ({
    calls: [],
    ringSilenced: false,
    dispensar: vi.fn(),
    restaurar: vi.fn(),
  }),
  // Sem oferta atendida não há dígitos para resolver, e o hook real devolve
  // `null` para telefone sem cadastro — que é 47% deles.
  useIncomingCallerName: () => null,
}));

vi.mock("@/modules/communication/hooks/useVoiceCall", () => ({
  useVoiceCall: (tcSessionId: string | null) => {
    sessoesRecebidas.push(tcSessionId);
    return {
      state: {
        phase: fase,
        error: null,
        errorCode: null,
        endReason: null,
        callId: null,
        peer: null,
        muted: false,
        elapsedSeconds: 0,
      } satisfies VoiceCallState,
      start,
      hangup: vi.fn(),
      toggleMute: vi.fn(),
      dismiss: vi.fn(),
    };
  },
}));

// O painel monta WebRTC de verdade; aqui só o botão está em julgamento.
vi.mock("./VoiceCallPanel", () => ({ VoiceCallPanel: () => null }));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm-1" }),
}));

import { VoiceCallProvider, useVoiceCallContext } from "./VoiceCallProvider";
import { VoiceCallButton } from "./VoiceCallButton";

const COMERCIAL: CallableVoiceNumber = {
  tcSessionId: "tc-1",
  instanceId: "i-1",
  instanceName: "Comercial",
};
const SUPORTE: CallableVoiceNumber = {
  tcSessionId: "tc-2",
  instanceId: "i-2",
  instanceName: "Suporte",
};

/** Mesma chave que `usePersistedState` monta: v8:ui:{tela}:{org}:{membro}. */
const CHAVE = "v8:ui:voice-call-number:org-1:tm-1";

function lembrar(tcSessionId: string) {
  const agora = Date.now();
  localStorage.setItem(
    CHAVE,
    JSON.stringify({
      value: tcSessionId,
      savedAt: new Date(agora).toISOString(),
      expiresAt: new Date(agora + 86_400_000).toISOString(),
    }),
  );
}

/**
 * O provider é montado na raiz do app, DENTRO do QueryClientProvider — é de lá
 * que ele invalida as ligações da conversa quando a chamada termina (S13).
 * Montá-lo sem cliente aqui seria testá-lo num contexto que não existe.
 */
function comQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function montar(props: Partial<React.ComponentProps<typeof VoiceCallButton>> = {}) {
  return render(
    comQueryClient(
      <VoiceCallProvider>
        <VoiceCallButton leadId="lead-1" leadName="Fábrica Silva" {...props} />
      </VoiceCallProvider>,
    ),
  );
}

/** O que o `useVoiceCall` está segurando no render mais recente. */
const sessaoAtual = () => sessoesRecebidas[sessoesRecebidas.length - 1];

const botaoLigar = () => screen.getByRole("button", { name: /^ligar$/i });
const seletor = () => screen.queryByRole("button", { name: /trocar o número/i });

beforeEach(() => {
  localStorage.clear();
  numbers = [];
  sessoesRecebidas = [];
  fase = "idle";
  tabelasConsultadas.length = 0;
  start.mockClear();
});

describe("VoiceCallButton — quantos números o vendedor tem", () => {
  it("nenhum número ao alcance: o botão some inteiro", () => {
    numbers = [];
    montar();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // Este é o caso de TODA a base hoje. A mudança não pode custar nada a ele.
  it("um número: nada muda — botão simples, sem seletor, sem clique a mais", async () => {
    numbers = [COMERCIAL];
    const user = userEvent.setup();
    montar();

    expect(seletor()).not.toBeInTheDocument();
    expect(screen.queryByText("Comercial")).not.toBeInTheDocument();

    await user.click(botaoLigar());
    expect(start).toHaveBeenCalledWith("lead-1");
    expect(sessaoAtual()).toBe("tc-1");
  });

  it("dois números: o seletor aparece e diz por qual vai sair a ligação", () => {
    numbers = [COMERCIAL, SUPORTE];
    montar();
    expect(seletor()).toBeInTheDocument();
    expect(screen.getByText("Comercial")).toBeInTheDocument();
  });

  // O gesto de sempre — um clique, e disca — não pode ganhar um passo só
  // porque a organização passou a ter dois números.
  it("dois números: ligar continua a UM clique, pelo número mostrado", async () => {
    numbers = [COMERCIAL, SUPORTE];
    const user = userEvent.setup();
    montar();
    await user.click(botaoLigar());
    expect(start).toHaveBeenCalledWith("lead-1");
    expect(sessaoAtual()).toBe("tc-1");
  });
});

describe("VoiceCallButton — vê o lead → pode ligar", () => {
  // Até 2026-09-02 o botão perguntava "este lead é dele?" — lendo colunas
  // legadas de responsável, nem sequer as canônicas `pre_sale_responsible_id`/
  // `sale_responsible_id` — e sumia quando não era. Como só ~8% dos leads com conversa
  // têm dono, sumia justamente para o SDR que estava no chat — na Milennials,
  // 3 conversas abertas, 3 leads de outros donos, botão nenhum. A condição
  // agora é a mesma da tela: se o lead está aqui, a RLS de `leads` já disse
  // que ele pode ser visto, e ver é poder ligar. O servidor confere a mesma
  // RLS (`lead_not_visible`).
  it("lead que NÃO é dele: o botão aparece, e sem perguntar nada ao banco", () => {
    numbers = [COMERCIAL];
    montar({ leadId: "lead-de-um-colega" });
    expect(botaoLigar()).toBeInTheDocument();
    expect(tabelasConsultadas).toEqual([]);
  });

  it("com dois números, as duas metades aparecem em lead que não é dele", () => {
    numbers = [COMERCIAL, SUPORTE];
    montar({ leadId: "lead-de-um-colega" });
    expect(botaoLigar()).toBeInTheDocument();
    expect(seletor()).toBeInTheDocument();
  });

  // Sem lead não há destino: o servidor deriva o número do lead, e é essa
  // derivação que sustenta consentimento, fronteira e teto por número.
  it("sem lead não há botão, mesmo com número ao alcance", () => {
    numbers = [COMERCIAL];
    montar({ leadId: null });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disca pelo lead da tela, seja ele de quem for", async () => {
    numbers = [COMERCIAL];
    const user = userEvent.setup();
    montar({ leadId: "lead-de-um-colega", leadName: "Colega Ltda" });
    await user.click(botaoLigar());
    expect(start).toHaveBeenCalledWith("lead-de-um-colega");
  });
});

describe("VoiceCallButton — a variante ícone, para os cards e o celular", () => {
  // O mesmo botão, sem rótulo, em 32px. Mesma regra: sem número ao alcance
  // ou sem lead, some. O nome acessível continua "Ligar" — leitor de tela e
  // teste não precisam saber de qual variante se trata.
  it("nenhum número ao alcance: some inteiro", () => {
    numbers = [];
    montar({ variant: "icon" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("um número: um botão só, com o ícone e sem seletor, que disca em um clique", async () => {
    numbers = [COMERCIAL];
    const user = userEvent.setup();
    montar({ variant: "icon" });

    expect(seletor()).not.toBeInTheDocument();
    expect(screen.queryByText("Comercial")).not.toBeInTheDocument();
    await user.click(botaoLigar());
    expect(start).toHaveBeenCalledWith("lead-1");
    expect(sessaoAtual()).toBe("tc-1");
  });

  it("dois números: ligar continua a um clique e a seta abre a escolha", async () => {
    numbers = [COMERCIAL, SUPORTE];
    const user = userEvent.setup();
    montar({ variant: "icon" });

    await user.click(botaoLigar());
    expect(start).toHaveBeenCalledWith("lead-1");
    expect(sessaoAtual()).toBe("tc-1");

    await user.click(seletor()!);
    await user.click(await screen.findByRole("menuitemradio", { name: "Suporte" }));
    expect(sessaoAtual()).toBe("tc-2");
  });

  // O card do lead e o cabeçalho do celular são clicáveis por baixo: abrem a
  // ficha ou a conversa. Ligar não pode abrir nada além da chamada.
  it("o clique não vaza para o container", async () => {
    numbers = [COMERCIAL];
    const porBaixo = vi.fn();
    const user = userEvent.setup();
    render(
      comQueryClient(
        <VoiceCallProvider>
          <div onClick={porBaixo} onPointerDown={porBaixo}>
            <VoiceCallButton variant="icon" leadId="lead-1" />
          </div>
        </VoiceCallProvider>,
      ),
    );
    await user.click(botaoLigar());
    expect(start).toHaveBeenCalledWith("lead-1");
    expect(porBaixo).not.toHaveBeenCalled();
  });

  it("o grupo de duas metades não recorta o anel de foco e é da família rounded-lg", () => {
    numbers = [COMERCIAL, SUPORTE];
    montar({ variant: "icon" });
    const grupo = botaoLigar().parentElement!;
    expect(grupo.className).not.toMatch(/overflow-hidden/);
    expect(grupo.className).toMatch(/\brounded-lg\b/);
  });

  it("em chamada, as duas metades ficam travadas", () => {
    numbers = [COMERCIAL, SUPORTE];
    fase = "active";
    montar({ variant: "icon" });
    expect(botaoLigar()).toBeDisabled();
    expect(seletor()).toBeDisabled();
  });
});

describe("VoiceCallButton — o acabamento do grupo", () => {
  // O anel de foco dos botões é um `outline` com `outline-offset-2`, desenhado
  // FORA da borda: `overflow-hidden` no grupo o recorta e apaga o foco de
  // teclado, que o DESIGN.md §5 lista como reprovação. E `--radius` é a família
  // (§4) — `rounded-lg` é o raio do botão de um número só e do vizinho no
  // cabeçalho; qualquer outro quebra a linha.
  it("o grupo não recorta o anel de foco nem inventa raio próprio", () => {
    numbers = [COMERCIAL, SUPORTE];
    montar();
    const grupo = botaoLigar().parentElement!;
    expect(grupo.className).not.toMatch(/overflow-hidden/);
    expect(grupo.className).toMatch(/\brounded-lg\b/);
  });
});

describe("VoiceCallButton — a escolha do número chega até a chamada", () => {
  it("escolher outro número troca a sessão por onde a ligação sai", async () => {
    numbers = [COMERCIAL, SUPORTE];
    const user = userEvent.setup();
    montar();
    expect(sessaoAtual()).toBe("tc-1");

    await user.click(seletor()!);
    await user.click(await screen.findByRole("menuitemradio", { name: "Suporte" }));

    expect(sessaoAtual()).toBe("tc-2");
    await user.click(botaoLigar());
    expect(start).toHaveBeenCalledWith("lead-1");
    expect(sessaoAtual()).toBe("tc-2");
  });

  it("a escolha do vendedor é lembrada na próxima montagem", () => {
    numbers = [COMERCIAL, SUPORTE];
    lembrar("tc-2");
    montar();
    expect(sessaoAtual()).toBe("tc-2");
    expect(screen.getByText("Suporte")).toBeInTheDocument();
  });

  // O número saiu do alcance dele. Um alerta sobre isso não o ajuda a ligar.
  it("escolha lembrada que sumiu da lista cai na primeira, sem avisar e sem quebrar", () => {
    numbers = [COMERCIAL, SUPORTE];
    lembrar("tc-que-sumiu");
    montar();
    expect(sessaoAtual()).toBe("tc-1");
    expect(screen.getByText("Comercial")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("escolha lembrada de um número só dele não vaza para lista vazia", () => {
    numbers = [];
    lembrar("tc-2");
    montar();
    expect(sessaoAtual()).toBe(null);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("VoiceCallButton — durante a chamada", () => {
  // Trocar o número no meio da chamada apontaria `hangup`/`endCall` para a
  // sessão errada, e a linha ficaria aberta segurando a cota do operador.
  it("em chamada, as duas metades ficam travadas", () => {
    numbers = [COMERCIAL, SUPORTE];
    fase = "active";
    montar();
    expect(botaoLigar()).toBeDisabled();
    expect(seletor()).toBeDisabled();
  });

  it("chamada encerrada não trava: dá para discar de novo sem fechar aviso", () => {
    numbers = [COMERCIAL, SUPORTE];
    fase = "ended";
    montar();
    expect(botaoLigar()).not.toBeDisabled();
    expect(seletor()).not.toBeDisabled();
  });

  // A trava do botão é o que o vendedor VÊ. Ela não prova que a troca está
  // fechada: qualquer outra tela que pegue o contexto chama `selectNumber`
  // direto, sem passar por atributo `disabled` nenhum. A guarda tem que estar
  // no ponto por onde toda troca passa — e é isso que este teste prende.
  it("a troca é recusada no provider, não só desabilitada no botão", async () => {
    numbers = [COMERCIAL, SUPORTE];
    fase = "active";
    const user = userEvent.setup();

    function OutraTela() {
      const voice = useVoiceCallContext();
      return (
        <button type="button" onClick={() => voice.selectNumber(SUPORTE.tcSessionId)}>
          trocar por fora
        </button>
      );
    }

    render(
      comQueryClient(
        <VoiceCallProvider>
          <OutraTela />
        </VoiceCallProvider>,
      ),
    );

    expect(sessaoAtual()).toBe("tc-1");
    await user.click(screen.getByRole("button", { name: "trocar por fora" }));
    expect(sessaoAtual()).toBe("tc-1");
  });
});
