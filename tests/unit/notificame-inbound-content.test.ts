/**
 * A leitura do conteúdo de um evento de entrada do NotificaMe.
 *
 * O que este módulo produz é o que a conversa MOSTRA. Quando ele não reconhece
 * um corpo, a mensagem não some do banco — ela aparece na tela como
 * "[Mensagem não suportada]", que é pior: o vendedor sabe que o cliente falou e
 * não sabe o quê.
 */
import { describe, expect, it } from "vitest";

import { normalizarConteudo } from "../../supabase/functions/_shared/notificame-content.ts";
import { buildInboundChannelMessageRow } from "../../supabase/functions/_shared/notificame-inbound.ts";
import { AMOSTRAS_INSTAGRAM, CLIQUE_DE_BOTAO, CONVERSA_CHIQUE } from "./__fixtures__/notificame-inbound-real.ts";
import { CONTATO_DOC, ESCOLHA_DE_LISTA_DOC, LOCALIZACAO_DOC } from "./__fixtures__/notificame-inbound-doc.ts";

describe("clique de botão", () => {
  it("vira texto legível e guarda a escolha", () => {
    // Medido em produção: este corpo entrou com `content` nulo e a conversa da
    // Chique mostrou "[Mensagem não suportada]" para um "Sim" que o cliente
    // clicou. O título do botão É a resposta — é o que ele veria no WhatsApp.
    const r = normalizarConteudo(CLIQUE_DE_BOTAO);

    expect(r.content).toBe("Sim");
    expect(r.metadata.tipo).toBe("resposta");
    expect(r.metadata.resposta).toEqual({ titulo: "Sim", payload: "Sim" });
  });
});

describe("citação", () => {
  it("lê o `context` que acompanha a resposta", () => {
    // O clique de botão sempre responde a UMA mensagem — a que levava o botão.
    // Sem esta chave a bolha fica solta na thread: "Sim" para quê?
    //
    // `context.from` é o remetente da mensagem CITADA. Aqui é `5555924815238`,
    // o número da própria Chique: o cliente respondeu a algo NOSSO.
    const r = normalizarConteudo(CLIQUE_DE_BOTAO);

    expect(r.metadata.citacao).toEqual({
      providerMessageId:
        "U2hTM01ZaXNNL0VhWk5tWG9uTFBPMkdxcnFoN1psZGtHcnd0M0g2NW92MkRsZ0ZjYjVJdEk0cXR6NVpIajQvL2RmaDVmcDFMaDRSUU1Mc2EreDFCOUE9PQ==",
      de: "5555924815238",
    });
  });
});

describe("mídia", () => {
  it("acha o arquivo em `fileUrl` — o campo que o fornecedor usa de verdade", () => {
    // A CAUSA-RAIZ da fatia. `pickContent` procura `contents[0].url`; o
    // fornecedor manda `fileUrl`. Resultado medido em produção: 100% das
    // mensagens de mídia recebidas nas 4 caixas de Instagram têm `media_url`
    // NULO — 14 reels, 8 áudios, 2 imagens — e a conversa mostra
    // "[Mídia indisponível]" para um áudio que o cliente mandou.
    const r = normalizarConteudo(AMOSTRAS_INSTAGRAM["audio"]);

    expect(r.mediaUrl).toMatch(/^https:\/\/lookaside\.fbsbx\.com\/ig_messaging_cdn\//);
    expect(r.metadata.tipo).toBe("midia");
  });

  it("NÃO acredita no `fileMimeType` do fornecedor", () => {
    // Ele declara "text/html" para áudio, imagem, reel e story — todos os
    // corpos reais medidos. Gravar isso como content-type faria o navegador
    // tentar RENDERIZAR o áudio como página.
    const r = normalizarConteudo(AMOSTRAS_INSTAGRAM["audio"]);

    expect(r.metadata.midia?.mime).not.toBe("text/html");
    // O tipo declarado no envelope é confiável; o mime não é.
    expect(r.metadata.midia?.especie).toBe("audio");
  });
});

describe("conteúdo que é PÁGINA, não arquivo", () => {
  it("reel compartilhado vira link, e nunca mídia", () => {
    // Corpo real: `fileUrl` é `https://www.instagram.com/reel/DcAMx69vMsr/` —
    // uma página. Tratar como arquivo tem dois desfechos ruins, os dois já
    // previsíveis: o espelhamento baixaria HTML e o serviria como se fosse
    // vídeo, e a bolha, sem extensão reconhecível na URL, desenharia um botão
    // de "baixar documento" para algo que é um post.
    const r = normalizarConteudo(AMOSTRAS_INSTAGRAM["ig_reel"]);

    expect(r.metadata.tipo).toBe("link");
    expect(r.metadata.link?.url).toBe("https://www.instagram.com/reel/DcAMx69vMsr/");
    expect(r.metadata.link?.especie).toBe("reel");
    expect(r.mediaUrl).toBeNull();
    expect(r.metadata.midia).toBeUndefined();
  });

  it("post e story compartilhados são ARQUIVO — o CDN entrega o binário", () => {
    // Diferente do reel: `ig_post` e `story_mention` vêm com URL do
    // `lookaside.fbsbx.com`, que devolve o arquivo. A distinção é o HOST, não o
    // nome do tipo.
    for (const tipo of ["ig_post", "story_mention"]) {
      const r = normalizarConteudo(AMOSTRAS_INSTAGRAM[tipo]);
      expect(r.metadata.tipo, tipo).toBe("midia");
      expect(r.mediaUrl, tipo).toContain("lookaside.fbsbx.com");
    }
  });
});

describe("reação", () => {
  it("guarda o emoji e A QUAL mensagem ele pertence", () => {
    // 7 reações já entraram nas caixas de Instagram e todas viraram uma linha
    // muda na conversa. Uma reação não é uma mensagem: é um adorno numa
    // mensagem que já existe — e sem `reaction_to` não há como colá-la de volta.
    //
    // `reaction_to.providerMessageId` casa com a coluna `provider_message_id`,
    // que existe desde 2026-08-19 justamente porque `message.id` muda a cada
    // callback do mesmo envio.
    const r = normalizarConteudo(AMOSTRAS_INSTAGRAM["reaction"]);

    expect(r.metadata.tipo).toBe("reacao");
    expect(r.metadata.reacao?.emoji).toBe("👍");
    expect(r.metadata.reacao?.alvoProviderMessageId).toMatch(/^dGg3ZzQwYnh3cFMwcWl2VDRFb0VD/);
  });
});

describe("postback — o botão do Instagram", () => {
  it("é clique de botão, mesmo o fornecedor declarando `text`", () => {
    // Descoberto pelo teste de conjunto abaixo, não por leitura de doc: a doc
    // não menciona `postback` em lugar nenhum. Um cliente real clicou em
    // "Liberar catálogo" e a conversa gravou uma linha vazia.
    //
    // O `type` do envelope diz "text" e MENTE — a única pista é a chave
    // `postback`. Por isso a leitura é por CHAVE PRESENTE e não por tipo
    // declarado, aqui e no botão do WhatsApp.
    const r = normalizarConteudo(AMOSTRAS_INSTAGRAM["text"]);

    expect(r.content).toBe("Liberar catálogo");
    expect(r.metadata.tipo).toBe("resposta");
    expect(r.metadata.resposta?.payload).toBe("ACT::fb208a323c1a3e6a2059909870cee8ab");
    // O postback carrega o alvo dentro dele — é a mensagem que levava o botão.
    expect(r.metadata.citacao?.providerMessageId).toMatch(/^dGg3ZzQwYnh3cFMwcWl2VDRFb0VD/);
  });
});

/**
 * REDE DE SEGURANÇA — a conversa real, do jeito que ela é.
 *
 * Os testes acima cobrem um caso por vez. Este roda o parser sobre TODOS os
 * corpos que produção já viu e afirma a única coisa que o vendedor percebe:
 * toda mensagem que o cliente mandou tem algo para mostrar na tela.
 *
 * É o teste que teria pegado, sozinho, o `fileUrl` e o clique de botão.
 */
function temOQueMostrar(r: ReturnType<typeof normalizarConteudo>): boolean {
  return (
    r.content !== null ||
    r.mediaUrl !== null ||
    r.metadata.link !== undefined ||
    r.metadata.tipo === "reacao"
  );
}

describe("a conversa real, inteira", () => {
  it("nenhuma mensagem da caixa oficial da Chique fica ilegível", () => {
    const ilegiveis = CONVERSA_CHIQUE
      .map((corpo) => ({ corpo, r: normalizarConteudo(corpo) }))
      .filter(({ r }) => !temOQueMostrar(r))
      .map(({ corpo }) => JSON.stringify((corpo as { message?: { contents?: unknown } }).message?.contents));

    expect(ilegiveis).toEqual([]);
  });

  it("nenhum tipo já visto nas caixas de Instagram fica ilegível", () => {
    const ilegiveis = Object.entries(AMOSTRAS_INSTAGRAM)
      .filter(([, corpo]) => !temOQueMostrar(normalizarConteudo(corpo)))
      .map(([tipo]) => tipo);

    expect(ilegiveis).toEqual([]);
  });
});

describe("localização", () => {
  it("lê coordenada, nome e endereço", () => {
    // A bolha hoje escreve "Localização compartilhada" e para aí — sem
    // coordenada não há mapa, e sem endereço o vendedor não sabe para onde
    // mandar a entrega.
    const r = normalizarConteudo(LOCALIZACAO_DOC);

    expect(r.metadata.tipo).toBe("localizacao");
    expect(r.metadata.localizacao).toEqual({
      latitude: -25.510785,
      longitude: -48.310882,
      nome: "Name of location",
      endereco: "Address of location",
    });
  });

  it("coordenada zero é coordenada — não é ausência", () => {
    // `0` é falsy e o golfo da Guiné existe. Um teste de verdade aqui vale mais
    // que a doc: o formato veio dela, e ela não fala de valor ausente.
    const r = normalizarConteudo({
      message: { contents: [{ type: "location", latitude: 0, longitude: 0 }] },
    });

    expect(r.metadata.localizacao?.latitude).toBe(0);
    expect(r.metadata.localizacao?.longitude).toBe(0);
  });
});

describe("contato compartilhado", () => {
  it("lê nome, telefone e e-mail — o cartão inteiro", () => {
    // A bolha hoje diz "Contato compartilhado" e nada mais. O vendedor recebe o
    // telefone do comprador e precisa pedir de novo, por escrito.
    const r = normalizarConteudo(CONTATO_DOC);

    expect(r.metadata.tipo).toBe("contato");
    expect(r.metadata.contatos).toEqual([
      {
        nome: "Notificame Test",
        telefones: [{ numero: "+55 44 99999-9999", waId: "5544999999999" }],
        emails: ["test@example.com"],
      },
    ]);
  });

  it("o nome vira o texto da linha — é o que aparece na lista de conversas", () => {
    // Sem isto a conversa aparece em branco na lista lateral, que mostra o
    // `content` da última mensagem.
    expect(normalizarConteudo(CONTATO_DOC).content).toBe("Notificame Test");
  });
});

describe("escolha de lista", () => {
  it("é resposta, igual ao clique de botão — o cliente escolheu uma opção", () => {
    // Mesma natureza do botão: o cliente tocou numa opção que NÓS oferecemos. A
    // bolha e a automação tratam os dois do mesmo jeito, e por isso o tipo é o
    // mesmo — o que muda é só de onde a escolha foi lida.
    const r = normalizarConteudo(ESCOLHA_DE_LISTA_DOC);

    expect(r.content).toBe("Cabo de aço 6mm");
    expect(r.metadata.tipo).toBe("resposta");
    expect(r.metadata.resposta).toEqual({ titulo: "Cabo de aço 6mm", payload: "sku-4471" });
  });
});

describe("a linha gravada carrega o metadata", () => {
  it("leva a leitura normalizada para a coluna", () => {
    // Sem isto o parser existe e não chega em lugar nenhum: a bolha continua
    // lendo `content` nulo e desenhando "[Mensagem não suportada]".
    const conteudo = normalizarConteudo(CLIQUE_DE_BOTAO);
    const row = buildInboundChannelMessageRow({
      organizationId: "org-1",
      target: { kind: "whatsapp", instanceId: "inst-1" },
      externalId: "ext-1",
      contact: { externalId: "554884334050", name: null, avatarUrl: null, handle: null },
      contactExternalId: "554884334050",
      content: conteudo,
      metadata: conteudo.metadata,
      timestampIso: "2026-08-19T22:27:33.000Z",
      rawPayload: CLIQUE_DE_BOTAO,
    });

    expect(row.content).toBe("Sim");
    expect(row.metadata).toEqual(conteudo.metadata);
  });

  it("sem metadata a coluna fica NULA — nunca `{}`", () => {
    // `{}` diria "normalizada, e não achei nada", que é diferente de "ainda não
    // normalizada". O backfill distingue os dois pelo NULL.
    const row = buildInboundChannelMessageRow({
      organizationId: "org-1",
      target: { kind: "instagram", messagingChannelId: "ch-1" },
      externalId: "ext-2",
      contact: { externalId: "igsid", name: null, avatarUrl: null, handle: null },
      contactExternalId: "igsid",
      content: { content: "oi", mediaUrl: null, messageType: "text" },
      timestampIso: "2026-08-19T22:27:33.000Z",
      rawPayload: {},
    });

    expect(row.metadata).toBeNull();
  });
});
