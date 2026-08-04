/**
 * O cartão de quem está ligando.
 *
 * O que está em julgamento aqui é o que o vendedor LÊ com o telefone tocando —
 * quem é, e por qual número. O comportamento do stream e do tom tem suíte
 * própria em `useIncomingVoiceCalls.test.ts`; este arquivo dubla só a resolução
 * do nome, que é a única consulta que o cartão faz.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Telefone canônico → nome. O que não estiver aqui é contato sem cadastro. */
let cadastro: Record<string, string> = {};
const nomesPerguntados: string[] = [];

vi.mock("@/modules/communication/hooks/useIncomingVoiceCalls", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/communication/hooks/useIncomingVoiceCalls")>();
  return {
    ...actual,
    // O dublê PROJETA o contrato do hook real: recebe DÍGITOS e devolve nome ou
    // `null`. Um dublê que devolvesse sempre um nome esconderia justamente o
    // caso dos 47%, que é o que este arquivo existe para provar.
    useIncomingCallerName: (peerDigits: string) => {
      nomesPerguntados.push(peerDigits);
      return cadastro[peerDigits] ?? null;
    },
  };
});

import { IncomingCallPanel } from "./IncomingCallPanel";
import type { IncomingVoiceCall } from "@/modules/communication/hooks/useIncomingVoiceCalls";

function oferta(over: Partial<IncomingVoiceCall> & { tcCallId: string }): IncomingVoiceCall {
  return {
    tcSessionId: "tc-a",
    instanceName: "Comercial",
    peerDigits: "555185960716",
    offeredAt: 1_700_000_000_000,
    ...over,
  };
}

/**
 * As duas ações do cartão, espionadas.
 *
 * `onAnswer`/`onDismiss` recebem a OFERTA inteira, e não um par de ids: quem
 * atende precisa da sessão dela para autorizar, e um cartão que devolvesse só o
 * `tcCallId` obrigaria o provider a procurar de qual sessão era — reabrindo, na
 * ponta, a premissa de que o id sozinho identifica a chamada.
 */
const atender = vi.fn();
const recusar = vi.fn();

/** O cartão com as duas ações fiadas; `busy` é o vendedor já em outra chamada. */
function Painel(props: {
  calls: IncomingVoiceCall[];
  silenced: boolean;
  busy?: boolean;
}) {
  return (
    <IncomingCallPanel
      calls={props.calls}
      silenced={props.silenced}
      busy={props.busy ?? false}
      onAnswer={atender}
      onDismiss={recusar}
    />
  );
}

beforeEach(() => {
  cadastro = {};
  nomesPerguntados.length = 0;
  atender.mockClear();
  recusar.mockClear();
});

describe("quem está ligando", () => {
  it("com cadastro, mostra o nome — e o telefone ao lado, para conferir homônimo", () => {
    cadastro["555185960716"] = "Maria Souza";
    render(<Painel calls={[oferta({ tcCallId: "c1" })]} silenced={false} />);

    expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    expect(screen.getByText(/\(51\) 98596-0716/)).toBeInTheDocument();
  });

  /**
   * O caso que decide o desenho do cartão: **47% dos contatos não têm lead**, e
   * a ligação de um cliente novo é a mais valiosa que entra aqui. Um cartão que
   * dependesse do cadastro estaria em branco em quase metade das ligações.
   */
  it("sem cadastro, o TELEFONE é o título — não um espaço vazio", () => {
    render(<Painel calls={[oferta({ tcCallId: "c1" })]} silenced={false} />);

    expect(screen.getByText("(51) 98596-0716")).toBeInTheDocument();
    // E o telefone aparece UMA vez: como título, não repetido na segunda linha.
    expect(screen.getAllByText(/98596-0716/)).toHaveLength(1);
  });

  /**
   * O JID chega SEM o nono dígito (`555185960716`). Mostrado como veio, ele
   * viraria `(51) 8596-0716` — oito dígitos, um número que não existe, que o
   * vendedor não reconhece e que ele não consegue retornar. É a mesma diferença
   * de formato que já custou ligações inteiras nesta base.
   */
  it("o nono dígito que o JID não traz é reposto antes de exibir", () => {
    render(<Painel calls={[oferta({ tcCallId: "c1" })]} silenced={false} />);

    expect(screen.getByText("(51) 98596-0716")).toBeInTheDocument();
    expect(screen.queryByText("(51) 8596-0716")).not.toBeInTheDocument();
  });

  // Conta LID, oferta de grupo, `From` vazio — a VPS as deixa passar e a ligação
  // é real. Dizer que não dá para identificar é melhor que um cartão em branco.
  it("sem telefone utilizável, ainda mostra um cartão", () => {
    render(<Painel calls={[oferta({ tcCallId: "c1", peerDigits: "" })]} silenced={false} />);

    expect(screen.getByText("Número não identificado")).toBeInTheDocument();
  });

  // Por qual número ele está entrando. Com dois números na organização, é a
  // única coisa que diz ao vendedor de qual frente é a ligação.
  it("diz por qual número a ligação está entrando", () => {
    render(
      <Painel
        calls={[oferta({ tcCallId: "c1", instanceName: "Suporte" })]}
        silenced={false}
      />,
    );

    expect(screen.getByText(/Suporte/)).toBeInTheDocument();
  });

  it("sem ligação nenhuma, não renderiza nada", () => {
    const { container } = render(<Painel calls={[]} silenced={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  // O cartão pergunta com os dígitos CRUS, e quem canoniza para casar com o lead
  // é o hook. Canonizar aqui antes de perguntar normalizaria duas vezes — e o
  // dia em que as duas normalizações discordarem, o nome some sem erro nenhum.
  it("pergunta o nome com os dígitos como vieram, sem pré-tratar", () => {
    render(<Painel calls={[oferta({ tcCallId: "c1" })]} silenced={false} />);
    expect(nomesPerguntados).toEqual(["555185960716"]);
  });
});

describe("duas ligações ao mesmo tempo não se atropelam", () => {
  it("as duas aparecem, cada uma com o seu número", () => {
    cadastro["555185960716"] = "Maria Souza";
    render(
      <Painel
        calls={[
          oferta({ tcCallId: "c1" }),
          oferta({ tcCallId: "c2", peerDigits: "554899887766", instanceName: "Suporte" }),
        ]}
        silenced={false}
      />,
    );

    expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    expect(screen.getByText("(48) 99988-7766")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  // Sem teto, a coluna sai da tela por cima e leva junto a que chegou primeiro.
  // A partir da quarta, o que ajuda é saber QUANTAS são.
  it("acima do teto, as mais recentes ficam e o resto vira uma contagem", () => {
    render(
      <Painel
        calls={[
          oferta({ tcCallId: "c1", peerDigits: "554811111111" }),
          oferta({ tcCallId: "c2", peerDigits: "554822222222" }),
          oferta({ tcCallId: "c3", peerDigits: "554833333333" }),
          oferta({ tcCallId: "c4", peerDigits: "554844444444" }),
          oferta({ tcCallId: "c5", peerDigits: "554855555555" }),
        ]}
        silenced={false}
      />,
    );

    expect(screen.getAllByRole("alert")).toHaveLength(3);
    expect(screen.getByText(/\+2 outras ligações/)).toBeInTheDocument();
    // A mais NOVA nunca é a que fica escondida.
    expect(screen.getByText("(48) 95555-5555")).toBeInTheDocument();
    expect(screen.queryByText("(48) 91111-1111")).not.toBeInTheDocument();
  });

  it("uma escondida só, no singular", () => {
    render(
      <Painel
        calls={[
          oferta({ tcCallId: "c1", peerDigits: "554811111111" }),
          oferta({ tcCallId: "c2", peerDigits: "554822222222" }),
          oferta({ tcCallId: "c3", peerDigits: "554833333333" }),
          oferta({ tcCallId: "c4", peerDigits: "554844444444" }),
        ]}
        silenced={false}
      />,
    );

    expect(screen.getByText(/\+1 outra ligação/)).toBeInTheDocument();
  });

  it("no teto exato, nenhuma contagem sobra na tela", () => {
    render(
      <Painel
        calls={[
          oferta({ tcCallId: "c1", peerDigits: "554811111111" }),
          oferta({ tcCallId: "c2", peerDigits: "554822222222" }),
          oferta({ tcCallId: "c3", peerDigits: "554833333333" }),
        ]}
        silenced={false}
      />,
    );

    expect(screen.getAllByRole("alert")).toHaveLength(3);
    expect(screen.queryByText(/outra/)).not.toBeInTheDocument();
  });
});

describe("o toque que o navegador calou", () => {
  /**
   * MEDIDO em Chromium 147: numa página que ninguém tocou desde que carregou, o
   * `AudioContext` nasce `suspended` e o `resume()` nunca assenta. O toque de
   * quem RECEBE é o único do produto que não nasce de um clique, então é o único
   * que cai nesse caso.
   *
   * Um toque que não soa é pior que nenhum, porque ninguém descobre — e o que
   * torna isso descobrível é esta linha na tela.
   */
  it("avisa que está sem som, e diz o que fazer a respeito", () => {
    render(<Painel calls={[oferta({ tcCallId: "c1" })]} silenced />);

    expect(screen.getByText(/Sem som/)).toBeInTheDocument();
    // O aviso tem de dizer a AÇÃO, não só o sintoma: um clique em qualquer lugar
    // destrava, e o vendedor não tem como adivinhar isso.
    expect(screen.getByText(/clicar na página/)).toBeInTheDocument();
  });

  it("com som, nenhum aviso ocupa espaço", () => {
    render(<Painel calls={[oferta({ tcCallId: "c1" })]} silenced={false} />);

    expect(screen.queryByText(/Sem som/)).not.toBeInTheDocument();
  });
});

describe("o cartão não inventa cor nem esconde o telefone", () => {
  // Cor literal em componente é bug: os tokens do tema é que decidem, e os dois
  // temas são primários neste produto.
  it("usa só tokens de tema, nenhum hex nem rgb solto", () => {
    const { container } = render(
      <Painel calls={[oferta({ tcCallId: "c1" })]} silenced />,
    );
    const classes = [...container.querySelectorAll("*")]
      .map((el) => el.getAttribute("class") ?? "")
      .join(" ");

    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(classes).not.toMatch(/\brgb\(|\bhsl\(/);
  });

  // O leitor de tela precisa anunciar sem esperar o foco: o vendedor pode estar
  // com os olhos em outra janela, e a ligação dura segundos.
  it("é anunciado com urgência para quem usa leitor de tela", () => {
    render(<Painel calls={[oferta({ tcCallId: "c1" })]} silenced={false} />);

    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });
});

describe("as duas ações do cartão", () => {
  it("Atender devolve a OFERTA inteira, com a sessão por onde ela entrou", async () => {
    const user = userEvent.setup();
    const chamada = oferta({ tcCallId: "c1", tcSessionId: "tc-comercial" });
    render(<Painel calls={[chamada]} silenced={false} />);

    await user.click(screen.getByRole("button", { name: /Atender/ }));

    expect(atender).toHaveBeenCalledTimes(1);
    expect(atender).toHaveBeenCalledWith(chamada);
    // Atender NÃO é recusar. Sem esta linha, um cartão que chamasse os dois
    // manipuladores no mesmo clique passaria na asserção de cima.
    expect(recusar).not.toHaveBeenCalled();
  });

  it("Recusar devolve a mesma oferta, e não atende nada", async () => {
    const user = userEvent.setup();
    const chamada = oferta({ tcCallId: "c1" });
    render(<Painel calls={[chamada]} silenced={false} />);

    await user.click(screen.getByRole("button", { name: /Recusar/ }));

    expect(recusar).toHaveBeenCalledWith(chamada);
    expect(atender).not.toHaveBeenCalled();
  });

  /**
   * DOIS cartões, e a razão é a mesma que fez o fixture do provider ter dois
   * números: com um só na tela, um cartão que ignorasse a própria oferta e
   * devolvesse "a primeira da lista" seria a IDENTIDADE, e nenhum teste veria.
   */
  it("cada cartão atende a SUA ligação, não a primeira da lista", async () => {
    const user = userEvent.setup();
    const primeira = oferta({ tcCallId: "c1", peerDigits: "555185960716" });
    const segunda = oferta({ tcCallId: "c2", peerDigits: "554899887766" });
    render(<Painel calls={[primeira, segunda]} silenced={false} />);

    const botoes = screen.getAllByRole("button", { name: /Atender/ });
    expect(botoes).toHaveLength(2);
    await user.click(botoes[1]);

    expect(atender).toHaveBeenCalledWith(segunda);
  });

  /**
   * Em chamada, atender está FECHADO — e não escondido.
   *
   * O vendedor não pode atender a segunda (o servidor recusaria com
   * `operator_busy`, e o índice `idx_voip_calls_one_live_per_operator` recusaria
   * a linha), mas o cartão continua sendo informação: alguém está ligando, e ele
   * decide se corta a conversa atual. Esconder o botão apagaria a explicação.
   */
  it("em outra chamada, Atender fica desabilitado e diz por quê", () => {
    render(<Painel calls={[oferta({ tcCallId: "c1" })]} silenced={false} busy />);

    const botao = screen.getByRole("button", { name: /Atender/ });
    expect(botao).toBeDisabled();
    expect(botao.getAttribute("title") ?? "").toMatch(/já está em uma chamada/i);
  });

  /**
   * Recusar continua ABERTO em chamada — controle positivo do caso acima. Sem
   * ele, um cartão que desabilitasse os DOIS botões passaria na asserção de
   * cima pelo motivo errado, e o vendedor em conversa ficaria com um cartão
   * empilhado na tela sem forma nenhuma de tirá-lo.
   */
  it("em outra chamada, Recusar continua clicável", async () => {
    const user = userEvent.setup();
    const chamada = oferta({ tcCallId: "c1" });
    render(<Painel calls={[chamada]} silenced={false} busy />);

    const botao = screen.getByRole("button", { name: /Recusar/ });
    expect(botao).not.toBeDisabled();
    await user.click(botao);
    expect(recusar).toHaveBeenCalledWith(chamada);
  });

  /**
   * O rótulo "Recusar" promete o oposto do que a ação faz — soa como desligar na
   * cara do cliente. A decisão da fatia é que ele NÃO encerra nada: sai da tela
   * deste vendedor, e a ligação segue no celular e nos colegas. Se o produto não
   * disser isso em algum lugar, o vendedor evita o botão por medo, ou o usa
   * achando que dispensou o cliente.
   */
  it("Recusar explica que não desliga a ligação de ninguém", () => {
    render(<Painel calls={[oferta({ tcCallId: "c1" })]} silenced={false} />);

    const titulo = screen.getByRole("button", { name: /Recusar/ }).getAttribute("title") ?? "";
    expect(titulo).toMatch(/continua tocando/i);
    expect(titulo).toMatch(/celular/i);
  });
});
