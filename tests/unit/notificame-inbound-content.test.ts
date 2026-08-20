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
import {
  buildInboundChannelMessageRow,
  pickInterlocutorDeSaida,
  pickProviderMessageId,
} from "../../supabase/functions/_shared/notificame-inbound.ts";
import {
  AMOSTRAS_INSTAGRAM,
  CLIQUE_DE_BOTAO,
  CONVERSA_CHIQUE,
  SAIDAS_DO_APLICATIVO,
} from "./__fixtures__/notificame-inbound-real.ts";
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
    // mensagens de mídia recebidas nas 2 caixas de Instagram têm `media_url`
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

/**
 * O ID ESTÁVEL DA MENSAGEM RECEBIDA.
 *
 * Medido em produção: 6 de 6 mensagens de entrada da Chique têm
 * `providerMessageId` no corpo, e 0 de 6 o têm na coluna. O dado chega e é
 * descartado.
 *
 * Isso não é cosmético: é ele que identifica a mensagem numa REAÇÃO
 * (`reaction.message_id`) e numa RESPOSTA CITADA (`messageId` na raiz do
 * corpo). Sem ele, reagir ou citar uma mensagem que o cliente mandou é
 * impossível — não há o que apontar.
 *
 * ⚠️ NÃO é o `external_id`. Aquele é o id do EVENTO (`message.id`), e ele MUDA a
 * cada callback do mesmo envio — foi por isso que os status de entrega se
 * perderam antes de a coluna existir.
 */
describe("provider_message_id no inbound", () => {
  it("a linha carrega o id estável do fornecedor", () => {
    const row = buildInboundChannelMessageRow({
      organizationId: "org-1",
      target: { kind: "whatsapp", instanceId: "inst-1" },
      externalId: "38c2bfb2-1b12-464d-accd-50caf8b90903",
      contact: { externalId: "554884334050", name: null, avatarUrl: null, handle: null },
      contactExternalId: "554884334050",
      content: { content: "Sim", mediaUrl: null, messageType: "button" },
      providerMessageId: pickProviderMessageId(CLIQUE_DE_BOTAO),
      timestampIso: "2026-08-19T22:27:33.000Z",
      rawPayload: CLIQUE_DE_BOTAO,
    });

    expect(row.provider_message_id).toMatch(/^U2hTM01ZaXNNL0VhWk5tWG9uTFBPMmM3/);
    // E continua DIFERENTE do id do evento — os dois vivem em colunas próprias.
    expect(row.provider_message_id).not.toBe(row.external_id);
  });

  it("corpo sem o campo deixa a coluna nula — nunca uma string vazia", () => {
    // `''` casaria com qualquer outra linha vazia da org num JOIN por id, e
    // colaria reações na mensagem errada.
    expect(pickProviderMessageId({ message: { id: "x" } })).toBeNull();
  });
});

/**
 * AS RESPOSTAS QUE O VENDEDOR DEU PELO APLICATIVO.
 *
 * Medido em produção: 193 eventos descartados entre 17 e 19/08/2026, em 51
 * conversas, sob o rótulo `unreadable_direction` — que MENTE. A direção é
 * `"OUT"` e o parser a lê perfeitamente; o guard parkava tudo que não fosse
 * `incoming`.
 *
 * O efeito na tela: em 51 conversas o cliente aparece falando sozinho. Metade do
 * diálogo não existe.
 *
 * ⚠️ E o interlocutor TROCA DE LADO. No evento de saída `message.to` é o
 * cliente, `message.from` é o id do CANAL — não uma pessoa — e `visitor`
 * descreve QUEM MANDOU, o vendedor. Ler o contato como se fosse entrada criaria
 * uma conversa fantasma, endereçada ao id do canal e batizada com o nome de quem
 * respondeu.
 */
describe("evento de saída", () => {
  it("o interlocutor é o DESTINATÁRIO, não o remetente", () => {
    const contato = pickInterlocutorDeSaida(SAIDAS_DO_APLICATIVO["text"]);

    // O IGSID do cliente, que está em `message.to`. O `message.from` deste
    // mesmo corpo é `ff596caa-…`, o id da CAIXA — e é isso que `pickContact`
    // devolveria se fosse reusado aqui.
    expect(contato?.externalId).toBe("24613954364877163");
  });

  it("NÃO usa o `visitor` como contato — ali está quem respondeu", () => {
    // `visitor.name` no evento de saída é o operador. Gravá-lo como contato
    // renomearia o cliente com o nome do vendedor em toda tela do CRM.
    const contato = pickInterlocutorDeSaida(SAIDAS_DO_APLICATIVO["text"]);

    expect(contato?.name).toBeNull();
    expect(contato?.avatarUrl).toBeNull();
  });

  it("corpo sem destinatário não vira contato — nunca o id do canal", () => {
    // `message.from` no evento de saída é o id do CANAL. Aceitá-lo como
    // interlocutor criaria uma conversa com a própria caixa.
    expect(pickInterlocutorDeSaida({ message: { from: "3cff29b0-7c9c" } })).toBeNull();
  });

  it("o conteúdo é lido pelo MESMO parser da entrada", () => {
    // Uma resposta do vendedor é uma mensagem como outra qualquer: texto, áudio,
    // imagem. Só o endereçamento muda.
    const r = normalizarConteudo(SAIDAS_DO_APLICATIVO["text"]);
    // Uma frase de vendedor, de um corpo real — a prova mais direta do que
    // estava sendo jogado fora.
    expect(r.content).toBe("Claro, me fala seu número para te chamar pfv");
  });
});

describe("a linha de uma resposta do aplicativo", () => {
  const corpo = SAIDAS_DO_APLICATIVO["text"];

  const linha = () => {
    const conteudo = normalizarConteudo(corpo);
    const contato = pickInterlocutorDeSaida(corpo)!;
    return buildInboundChannelMessageRow({
      organizationId: "org-1",
      target: { kind: "instagram", messagingChannelId: "ch-1" },
      externalId: "d067fe36-df12-48f5-b9a9-3480f4897ca3",
      contact: contato,
      contactExternalId: contato.externalId,
      content: conteudo,
      metadata: conteudo.metadata,
      providerMessageId: pickProviderMessageId(corpo),
      direction: "outgoing",
      timestampIso: "2026-08-19T21:29:18.000Z",
      rawPayload: corpo,
    });
  };

  it("nasce como SAÍDA e com status de enviada", () => {
    // ⚠️ `'outgoing'` LITERAL. O CHECK `channel_messages_direction_check` aceita
    // só ('incoming','outgoing'); `'out'` — a palavra do fornecedor — derrubaria
    // a gravação DEPOIS de a mensagem já ter sido enviada de verdade.
    const r = linha();
    expect(r.direction).toBe("outgoing");
    expect(r.status).toBe("sent");
  });

  it("agrupa na conversa do CLIENTE, e não numa nova", () => {
    // `contact_external_id` é o eixo da thread: se a saída entrar com outro
    // valor, a resposta do vendedor abre uma segunda conversa e nenhuma das duas
    // fica completa.
    expect(linha().contact_external_id).toBe("24613954364877163");
  });

  it("não atribui remetente — quem mandou fomos nós", () => {
    // `sender_name` alimenta o cabeçalho e a lista. Preenchê-lo com o `visitor`
    // do corpo poria o nome do vendedor no lugar do cliente.
    const r = linha();
    expect(r.sender_id).toBeNull();
    expect(r.sender_name).toBeNull();
  });

  it("continua idempotente pela mesma chave", () => {
    expect(linha().external_id).toBe("d067fe36-df12-48f5-b9a9-3480f4897ca3");
    expect(linha().provider_message_id).not.toBeNull();
  });
});
