/**
 * O que a bolha desenha, decidido fora dela.
 *
 * A `MessagePrimitives` hoje decide por comparação de string de `message_type`,
 * e a lista de apelidos cresce a cada provedor: `buttonResponseMessage`,
 * `listResponse`, `ContactsArrayMessage`, `PinInChatMessage`. Aqui a decisão sai
 * do `metadata` normalizado, que é forma NOSSA — provedor novo não pede apelido
 * novo, e a regra fica testável sem renderizar nada.
 */
import { describe, expect, it } from "vitest";

import { botoesDaMensagem, citacaoDaMensagem, lerBolha } from "./inbound-metadata";

describe("lerBolha", () => {
  it("clique de botão vira resposta, com o texto que o cliente viu", () => {
    // Medido em produção na Chique: esta linha existe com `content` nulo e a
    // conversa mostra "[Mensagem não suportada]" para um "Sim" clicado.
    const b = lerBolha({
      content: "Sim",
      media_url: null,
      message_type: "button",
      metadata: { tipo: "resposta", resposta: { titulo: "Sim", payload: "Sim" } },
    });

    expect(b).toEqual({ tipo: "resposta", titulo: "Sim" });
  });

  it("sem metadata, cai no comportamento de hoje — nada regride", () => {
    // Toda linha gravada antes desta fatia tem `metadata` nulo, e as ~30 orgs da
    // Uazapi nunca terão a coluna. O caminho antigo continua valendo.
    const b = lerBolha({
      content: "oi",
      media_url: null,
      message_type: "text",
      metadata: null,
    });

    expect(b).toEqual({ tipo: "texto", texto: "oi" });
  });
});

describe("mídia", () => {
  it("usa a URL do metadata, que é a do NOSSO storage depois do espelho", () => {
    // `media_url` e `metadata.midia.url` apontam para o mesmo lugar no caminho
    // feliz. Divergem quando o espelhamento falhou e a coluna guardou a URL do
    // fornecedor: aí a do metadata é a que carrega `espelhada: false`, e é essa
    // a verdade sobre o que a bolha está exibindo.
    const b = lerBolha({
      content: null,
      media_url: "https://nosso.storage/a.ogg",
      message_type: "audio",
      metadata: {
        tipo: "midia",
        midia: {
          url: "https://nosso.storage/a.ogg",
          especie: "audio",
          mime: "audio/ogg",
          nome: "ig_messaging_cdn",
          espelhada: true,
        },
      },
    });

    expect(b).toEqual({
      tipo: "midia",
      url: "https://nosso.storage/a.ogg",
      especie: "audio",
      nome: "ig_messaging_cdn",
    });
  });
});

describe("localização, contato, link e reação", () => {
  it("localização entrega a coordenada — sem ela não há mapa", () => {
    const b = lerBolha({
      content: null,
      media_url: null,
      message_type: "location",
      metadata: {
        tipo: "localizacao",
        localizacao: { latitude: -25.510785, longitude: -48.310882, nome: "Loja", endereco: "Rua X, 1" },
      },
    });

    expect(b).toEqual({
      tipo: "localizacao",
      latitude: -25.510785,
      longitude: -48.310882,
      nome: "Loja",
      endereco: "Rua X, 1",
    });
  });

  it("contato entrega o cartão inteiro, não a palavra 'contato'", () => {
    const b = lerBolha({
      content: "Fulano",
      media_url: null,
      message_type: "contacts",
      metadata: {
        tipo: "contato",
        contatos: [{ nome: "Fulano", telefones: [{ numero: "+5544999", waId: "5544999" }], emails: [] }],
      },
    });

    expect(b.tipo).toBe("contato");
    expect(b.tipo === "contato" && b.contatos[0].telefones[0].numero).toBe("+5544999");
  });

  it("reel vira link, e carrega a espécie para a bolha saber o que dizer", () => {
    const b = lerBolha({
      content: null,
      media_url: null,
      message_type: "ig_reel",
      metadata: { tipo: "link", link: { url: "https://www.instagram.com/reel/Dc/", especie: "reel" } },
    });

    expect(b).toEqual({ tipo: "link", url: "https://www.instagram.com/reel/Dc/", especie: "reel" });
  });

  it("reação carrega o alvo — ela pertence a OUTRA mensagem", () => {
    // Quem consome decide o que fazer com isso: uma reação desenhada como bolha
    // própria é uma linha solta dizendo "👍" sem dizer a quê.
    const b = lerBolha({
      content: "👍",
      media_url: null,
      message_type: "reaction",
      metadata: { tipo: "reacao", reacao: { emoji: "👍", alvoProviderMessageId: "dGg3" } },
    });

    expect(b).toEqual({ tipo: "reacao", emoji: "👍", alvo: "dGg3" });
  });
});

describe("botoesDaMensagem", () => {
  it("devolve os rótulos de um template enviado com botões", () => {
    // Acréscimo, e não um tipo de bolha próprio: o template já tem selo e texto
    // desenhados pelo caminho de sempre. Os botões entram COMO FAIXA embaixo,
    // que é onde o WhatsApp os põe.
    expect(botoesDaMensagem({ tipo: "template", botoes: ["Recebi", "Ver pedido"] }))
      .toEqual(["Recebi", "Ver pedido"]);
  });

  it("qualquer outra coisa devolve lista vazia", () => {
    for (const m of [null, undefined, {}, { tipo: "texto" }, { tipo: "template" }, "x"]) {
      expect(botoesDaMensagem(m)).toEqual([]);
    }
  });
});

describe("citacaoDaMensagem", () => {
  it("devolve o alvo de uma mensagem que responde a outra", () => {
    // O parser de entrada grava `citacao` desde a fatia do recebimento, e a tela
    // nunca a desenhou: o clique de botão do cliente aparecia solto, sem dizer a
    // QUE ele respondeu. O dado estava no banco o tempo todo.
    expect(
      citacaoDaMensagem({
        tipo: "resposta",
        citacao: { providerMessageId: "U2hTM01ZaXNN", de: "5555924815238" },
      }),
    ).toEqual({ providerMessageId: "U2hTM01ZaXNN", de: "5555924815238" });
  });

  it("mensagem sem citação devolve nulo", () => {
    for (const m of [null, undefined, {}, { tipo: "texto" }, { tipo: "resposta" }]) {
      expect(citacaoDaMensagem(m)).toBeNull();
    }
  });

  it("citação sem id é como não ter citação", () => {
    // Desenhar uma barra de citação vazia diria ao vendedor que a mensagem
    // responde a algo, sem dizer a quê — pior que não desenhar nada.
    expect(citacaoDaMensagem({ tipo: "resposta", citacao: { providerMessageId: "", de: null } }))
      .toBeNull();
  });
});
