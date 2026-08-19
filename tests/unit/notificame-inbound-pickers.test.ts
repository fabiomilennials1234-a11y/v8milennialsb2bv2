/**
 * `_shared/notificame-inbound.ts` — TODO o julgamento sobre o corpo de um evento
 * de entrada do NotificaMe, medido PICKER A PICKER.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ESTE ARQUIVO NÃO FIXA O FORMATO. FIXA O JULGAMENTO.                      ║
 * ║                                                                          ║
 * ║  Nenhum evento real foi observado; todo alias do módulo é DERIVADO DE     ║
 * ║  DOC, e a doc do fornecedor já se provou errada uma vez. Um teste que     ║
 * ║  dissesse "o campo se chama `channelId`" seria um teste que fixa um       ║
 * ║  chute — e ficaria VERDE no dia em que o formato real chegasse diferente. ║
 * ║                                                                          ║
 * ║  O que dá para asserir HOJE, e é o que está aqui, são as invariantes que  ║
 * ║  não dependem do formato:                                                ║
 * ║                                                                          ║
 * ║    ausência ⇒ `null`, nunca um valor inventado;                           ║
 * ║    `''`/`'   '` ⇒ ausência, nunca chave vazia;                            ║
 * ║    tipo errado ⇒ ausência, nunca `[object Object]`;                       ║
 * ║    alias alternativo ⇒ mesma resposta (tolerância barata);                ║
 * ║    valor DESCONHECIDO ⇒ `null`/`unknown`, nunca "assuma o caso comum";     ║
 * ║    PALAVRA de canal ≠ ID de canal;                                        ║
 * ║    a chave `type` responde a UMA pergunta por vez, decidida pelo VALOR.    ║
 * ║                                                                          ║
 * ║  Quando o primeiro payload real chegar (parkado em                        ║
 * ║  `notificame_webhook_events.payload`), o que muda são os ALIASES do       ║
 * ║  módulo. Estas asserções continuam valendo — é para isso que elas são     ║
 * ║  escritas sobre o comportamento, e não sobre os nomes dos campos.         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Complemento de `notificame-webhook-inbound.test.ts`, que exerce o HANDLER
 * (rota, tenant, idempotência, parking). Aqui não há rede, banco, nem Deno: o
 * módulo é puro e não importa nada.
 */
import { describe, it, expect } from "vitest";
import {
  buildInboundChannelMessageRow,
  buildPayloadSnapshot,
  pickAccountHandle,
  pickChannelId,
  pickChannelWord,
  pickContact,
  pickContent,
  pickExternalId,
  pickTimestampIso,
  readDirection,
  readEventType,
} from "../../supabase/functions/_shared/notificame-inbound.ts";

/**
 * As formas de "não veio" que TODO picker precisa tratar igual. Um `null` no meio
 * do caminho (`{message: null}` sob o alias `message.id`) é a que mais quebra: ela
 * seria um TypeError dentro do `withErrorBoundary` — 500 para o fornecedor e o
 * corpo cru perdido, que é exatamente o que a fila existe para impedir.
 */
const NAO_OBJETOS: unknown[] = [
  undefined,
  null,
  "",
  "uma string solta",
  42,
  true,
  [],
  {},
];

// ═══════════════════════════════════════════════════════════════════════════
// 1. pickExternalId — o id DA MENSAGEM. A regra que não relaxa.
// ═══════════════════════════════════════════════════════════════════════════

describe("pickExternalId — sem id do fornecedor, `null`, e o chamador parka", () => {
  it("lê o alias canônico", () => {
    expect(pickExternalId({ id: "mid-001" })).toBe("mid-001");
  });

  it.each([
    ["message_id", { message_id: "a" }],
    ["messageId", { messageId: "a" }],
    ["mid", { mid: "a" }],
    ["externalId", { externalId: "a" }],
    ["external_id", { external_id: "a" }],
    ["message.id (aninhado)", { message: { id: "a" } }],
    ["message.mid (aninhado)", { message: { mid: "a" } }],
    ["data.id (aninhado)", { data: { id: "a" } }],
    ["data.message_id (aninhado)", { data: { message_id: "a" } }],
  ])("alias alternativo %s produz a mesma resposta", (_nome, body) => {
    expect(pickExternalId(body)).toBe("a");
  });

  it("a ORDEM da lista é preferência: o alias mais específico ganha", () => {
    // Existe para o dia em que o corpo trouxer dois. Sem ordem estável, o mesmo
    // evento poderia render external_id diferente entre versões — e a UNIQUE
    // deixaria de absorver a reentrega.
    expect(pickExternalId({ id: "topo", message_id: "outro", message: { id: "fundo" } }))
      .toBe("topo");
  });

  it.each(NAO_OBJETOS)("campo ausente em %s ⇒ null (nunca um id sintético)", (body) => {
    expect(pickExternalId(body)).toBeNull();
  });

  it("`message: null` sob o alias `message.id` NÃO lança — devolve null", () => {
    // Um TypeError aqui viraria 500 dentro do withErrorBoundary, e o corpo cru
    // (o único ativo de um evento que não entendemos) se perderia.
    expect(() => pickExternalId({ message: null })).not.toThrow();
    expect(pickExternalId({ message: null })).toBeNull();
  });

  it.each([
    ["string vazia", ""],
    ["só espaços", "   "],
    ["tab e newline", "\t\n "],
  ])("valor %s conta como AUSÊNCIA", (_nome, valor) => {
    // `''` passaria por `typeof === 'string'` e viraria um external_id vazio, que
    // colide com TODA outra mensagem vazia da mesma org na UNIQUE: mensagens
    // diferentes se absorveriam como reentrega uma da outra.
    expect(pickExternalId({ id: valor })).toBeNull();
  });

  it("valor vazio no primeiro alias NÃO bloqueia o próximo", () => {
    expect(pickExternalId({ id: "  ", message_id: "mid-real" })).toBe("mid-real");
  });

  it("apara o valor — a chave gravada não carrega espaço de borda", () => {
    // ' mid-1 ' e 'mid-1' são a MESMA mensagem para o fornecedor; se fossem chaves
    // diferentes para nós, a reentrega viraria linha nova.
    expect(pickExternalId({ id: "  mid-1  " })).toBe("mid-1");
  });

  it.each([
    ["booleano", true],
    ["objeto", { nested: "x" }],
    ["array", ["x"]],
    ["null explícito", null],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("tipo errado (%s) conta como ausência, não vira texto", (_nome, valor) => {
    // Sem esta guarda, `String({})` gravaria '[object Object]' como external_id —
    // um valor que COLIDE com toda outra mensagem malformada da org.
    expect(pickExternalId({ id: valor })).toBeNull();
  });

  it("id NUMÉRICO é aceito e vira string (o `mid` da Meta às vezes chega assim)", () => {
    expect(pickExternalId({ id: 1755100000123 })).toBe("1755100000123");
    expect(pickExternalId({ id: 0 })).toBe("0");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. pickChannelId — o ID do canal. NUNCA a palavra, NUNCA o destinatário.
// ═══════════════════════════════════════════════════════════════════════════

describe("pickChannelId — id do canal no fornecedor", () => {
  it.each([
    ["channelId", { channelId: "ch_1" }],
    ["channel_id", { channel_id: "ch_1" }],
    ["channelUuid", { channelUuid: "ch_1" }],
    ["channel_uuid", { channel_uuid: "ch_1" }],
    ["channel.id", { channel: { id: "ch_1" } }],
    ["channel.uuid", { channel: { uuid: "ch_1" } }],
    ["data.channelId", { data: { channelId: "ch_1" } }],
    ["data.channel_id", { data: { channel_id: "ch_1" } }],
  ])("alias alternativo %s produz a mesma resposta", (_nome, body) => {
    expect(pickChannelId(body)).toBe("ch_1");
  });

  it.each(NAO_OBJETOS)("campo ausente em %s ⇒ null (o handler desempata pela org)", (body) => {
    expect(pickChannelId(body)).toBeNull();
  });

  it("string vazia conta como ausência — e cai no próximo alias", () => {
    expect(pickChannelId({ channelId: "   " })).toBeNull();
    expect(pickChannelId({ channelId: "", channel_id: "ch_2" })).toBe("ch_2");
  });

  it("tipo errado conta como ausência", () => {
    expect(pickChannelId({ channelId: { id: "ch" } })).toBeNull();
    expect(pickChannelId({ channelId: true })).toBeNull();
  });

  // ── A armadilha central: PALAVRA ≠ ID ────────────────────────────────────
  describe("o payload traz a PALAVRA do canal em vez de um id", () => {
    it.each(["instagram", "INSTAGRAM", "Instagram", "ig", "IG", "whatsapp", "wa", "facebook", "fb", "messenger"])(
      "`channel: '%s'` NÃO vira id de canal",
      (palavra) => {
        // Se a palavra virasse identificador, o handler procuraria em
        // messaging_channels um canal com external_channel_id = 'instagram', não
        // acharia, e TODO evento de TODA org pararia em `unresolved_channel` — com
        // o sintoma apontando para o banco, não para o picker.
        expect(pickChannelId({ channel: palavra })).toBeNull();
      },
    );

    it("`channel` fora do vocabulário só vira id se for UUID", () => {
      // ⚠️ ESTE TESTE MUDOU, e a produção é a razão. A partição era por VALOR
      // ("palavra conhecida ⇒ não é id; o resto ⇒ é id") e isso pressupunha que
      // qualquer coisa fora do nosso vocabulário fosse um identificador.
      //
      // O corpo real do fornecedor traz `channel: "whatsapp_business_account"` —
      // uma PALAVRA que o vocabulário não listava. Pela regra antiga ela virava
      // "id" e ia buscar um canal com esse nome, que não existe.
      //
      // Exigir UUID fecha a porta para qualquer palavra futura sem precisar
      // catalogá-la uma a uma — que é o que a regra antiga exigiria, e o motivo
      // pelo qual ela falhou na primeira palavra nova.
      expect(pickChannelId({ channel: "ch_ig_org_a" })).toBeNull();
      expect(pickChannelId({ channel: "whatsapp_business_account" })).toBeNull();
      expect(pickChannelId({ channel: "d1205fbe-99c7-4744-ac6b-899cfbf03179" }))
        .toBe("d1205fbe-99c7-4744-ac6b-899cfbf03179");
    });

    it("`channel` só é consultado DEPOIS dos aliases inequívocos", () => {
      expect(pickChannelId({ channel: "ch_do_channel", channelId: "ch_do_channelId" }))
        .toBe("ch_do_channelId");
    });

    it("um `channel` com a PALAVRA não anula um `channelId` legítimo", () => {
      expect(pickChannelId({ channel: "instagram", channelId: "ch_1" })).toBe("ch_1");
    });
  });

  // ── Regressão: `to`/`destination` são o DESTINATÁRIO, não o canal ────────
  describe("`to` e `destination` NÃO resolvem canal (regressão)", () => {
    it("`to.id` sozinho ⇒ null, e o handler desempata pelo canal único da org", () => {
      // ⚠️ Num evento de ENTRADA, `to` é NÓS — e "nós" não é uma entidade só: pode
      // ser o id do canal, o IGSID da conta, o page id ou o @usuário.
      // `external_channel_id` casa com exatamente UMA delas.
      //
      // O custo é assimétrico: se `to.id` FOSSE o id do canal, tirá-lo daqui não
      // perde nada (o desempate por org resolve e o raw_payload ensina). Se NÃO
      // for, mantê-lo DESLIGA esse desempate e parka TODO evento de TODA org em
      // `unresolved_channel`, para sempre.
      expect(pickChannelId({ to: { id: "17841400000000000" } })).toBeNull();
    });

    it("`destination` sozinho ⇒ null (mesmo motivo)", () => {
      expect(pickChannelId({ destination: "17841400000000000" })).toBeNull();
    });

    it("o arquivo é COERENTE: `to.*` é identidade da NOSSA conta, e só", () => {
      // `pickAccountHandle` lê `to.username`. `to.*` não pode significar "nossa
      // conta" numa função e "id do canal" na outra.
      const body = { to: { id: "17841400000000000", username: "@milennials" } };
      expect(pickChannelId(body)).toBeNull();
      expect(pickAccountHandle(body)).toBe("milennials");
    });

    it("um `to.id` presente NÃO atrapalha um `channelId` legítimo", () => {
      expect(pickChannelId({ to: { id: "conta" }, channelId: "ch_1" })).toBe("ch_1");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. pickChannelWord — a PALAVRA. Serve para CONFERIR, nunca para escolher.
// ═══════════════════════════════════════════════════════════════════════════

describe("pickChannelWord — a palavra de canal declarada pelo remetente", () => {
  it.each([
    ["channel", { channel: "instagram" }],
    ["channel_type", { channel_type: "instagram" }],
    ["channelType", { channelType: "instagram" }],
  ])("alias alternativo %s produz a mesma resposta", (_nome, body) => {
    expect(pickChannelWord(body)).toBe("instagram");
  });

  it("preserva a CAIXA original (quem normaliza é normalizeSeamlessType)", () => {
    expect(pickChannelWord({ channel: "Instagram" })).toBe("Instagram");
    expect(pickChannelWord({ channel: "IG" })).toBe("IG");
  });

  it.each(NAO_OBJETOS)("ausente em %s ⇒ null — e o handler NÃO confere nada", (body) => {
    // `null` significa "o corpo não declarou canal que eu reconheça", nunca
    // "conferi e passou".
    expect(pickChannelWord(body)).toBeNull();
  });

  it("string vazia conta como ausência", () => {
    expect(pickChannelWord({ channel: "  " })).toBeNull();
  });

  it("tipo errado conta como ausência", () => {
    expect(pickChannelWord({ channel: { type: "instagram" } })).toBeNull();
    expect(pickChannelWord({ channel: 7 })).toBeNull();
  });

  it("valor FORA do vocabulário ⇒ null (não é palavra de canal)", () => {
    expect(pickChannelWord({ channel: "ch_ig_org_a" })).toBeNull();
    // …e na outra pergunta também é null desde que o id passou a exigir UUID:
    // uma string arbitrária não é palavra NEM identificador.
    expect(pickChannelId({ channel: "ch_ig_org_a" })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. A CHAVE `type` — uma chave, três reivindicações
// ═══════════════════════════════════════════════════════════════════════════

describe("`type` responde a UMA pergunta por vez, e quem decide é o VALOR", () => {
  it("`type: 'instagram'` é PALAVRA DE CANAL, e não evento desconhecido", () => {
    expect(pickChannelWord({ type: "instagram" })).toBe("instagram");
    expect(readEventType({ type: "instagram" })).toBe("unknown");
  });

  it("`type: 'MESSAGE'` é EVENTO, e não palavra de canal", () => {
    expect(readEventType({ type: "MESSAGE" })).toBe("message");
    expect(pickChannelWord({ type: "MESSAGE" })).toBeNull();
  });

  it("`type: 'text'` (tipo de CONTEÚDO) não responde nem uma nem outra", () => {
    expect(readEventType({ type: "text" })).toBe("unknown");
    expect(pickChannelWord({ type: "text" })).toBeNull();
  });

  it("REGRESSÃO: `type` de canal NÃO cega o alias `event` do evento", () => {
    // ⚠️ Este é o defeito que a separação desfaz. Com `type` DENTRO da lista de
    // alias de readEventType, quem decidia era a ORDEM: `firstNonEmpty` parava em
    // 'instagram', devolvia `unknown`, e o handler PARKAVA uma mensagem
    // perfeitamente legível que trazia `event: 'MESSAGE'` logo ao lado.
    const body = { type: "instagram", event: "MESSAGE" };
    expect(readEventType(body)).toBe("message");
    expect(pickChannelWord(body)).toBe("instagram");
  });

  it("REGRESSÃO simétrica: `type` de evento NÃO cega o alias `channel_type`", () => {
    const body = { type: "MESSAGE", channel_type: "instagram" };
    expect(readEventType(body)).toBe("message");
    expect(pickChannelWord(body)).toBe("instagram");
  });

  it("o mesmo corpo alimenta as DUAS perguntas sem uma roubar a resposta da outra", () => {
    const body = { type: "instagram", eventType: "MESSAGE", channelId: "ch_1" };
    expect(readEventType(body)).toBe("message");
    expect(pickChannelWord(body)).toBe("instagram");
    expect(pickChannelId(body)).toBe("ch_1");
  });

  it("alias INEQUÍVOCO é AUTORITATIVO: `type` não o desmente", () => {
    // Um alias posterior não pode sobrepor uma declaração explícita do remetente.
    expect(readEventType({ eventType: "MESSAGE_REACTION", type: "MESSAGE" })).toBe("unknown");
    expect(pickChannelWord({ channel: "MESSAGE", type: "instagram" })).toBeNull();
  });

  it("alias inequívoco VAZIO não é declaração — a busca continua", () => {
    expect(readEventType({ eventType: "  ", type: "MESSAGE" })).toBe("message");
    expect(pickChannelWord({ channel: "", type: "instagram" })).toBe("instagram");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. readEventType
// ═══════════════════════════════════════════════════════════════════════════

describe("readEventType — desconhecido PARKA, nunca é descartado", () => {
  it.each([
    ["eventType", { eventType: "MESSAGE" }],
    ["event_type", { event_type: "MESSAGE" }],
    ["event", { event: "MESSAGE" }],
    ["type (ambíguo, mas o valor classifica)", { type: "MESSAGE" }],
  ])("alias alternativo %s ⇒ message", (_nome, body) => {
    expect(readEventType(body)).toBe("message");
  });

  it.each(["MESSAGE", "message", "  Message  ", "messages", "message_received", "MESSAGE-RECEIVED", "message received"])(
    "tolerante em caixa, espaço e separador: '%s' ⇒ message",
    (valor) => {
      expect(readEventType({ eventType: valor })).toBe("message");
    },
  );

  it.each(["MESSAGE_STATUS", "message_status", "MessageStatus", "MESSAGE-STATUS", "status"])(
    "'%s' ⇒ message_status",
    (valor) => {
      expect(readEventType({ eventType: valor })).toBe("message_status");
    },
  );

  it.each(NAO_OBJETOS)("ausente em %s ⇒ unknown (parka, não descarta)", (body) => {
    expect(readEventType(body)).toBe("unknown");
  });

  it("valor vazio ⇒ unknown", () => {
    expect(readEventType({ eventType: "   " })).toBe("unknown");
  });

  it("tipo errado ⇒ unknown", () => {
    expect(readEventType({ eventType: { kind: "MESSAGE" } })).toBe("unknown");
    expect(readEventType({ eventType: true })).toBe("unknown");
  });

  it.each(["MESSAGE_REACTION", "DELIVERY", "read", "coisa_nova"])(
    "vocabulário desconhecido ('%s') ⇒ unknown, e o corpo é GUARDADO pelo handler",
    (valor) => {
      // Descartar produziria o pior sintoma possível: silêncio, indistinguível de
      // "ninguém mandou nada".
      expect(readEventType({ eventType: valor })).toBe("unknown");
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. readDirection — o vocabulário é o do BANCO
// ═══════════════════════════════════════════════════════════════════════════

describe("readDirection — traduz para incoming|outgoing, e desconhecido é null", () => {
  it.each(["in", "IN", "inbound", "incoming", "received", "  Received  "])(
    "'%s' ⇒ incoming",
    (valor) => {
      expect(readDirection({ direction: valor })).toBe("incoming");
    },
  );

  it.each(["out", "OUT", "outbound", "outgoing", "sent"])("'%s' ⇒ outgoing", (valor) => {
    expect(readDirection({ direction: valor })).toBe("outgoing");
  });

  it("NUNCA devolve o literal do fornecedor — 'inbound' vira 'incoming'", () => {
    // `'inbound'` VIOLA channel_messages_direction_check, que aceita exatamente
    // ('incoming','outgoing'). O mesmo engano deixou useIncomingMessageToast.ts:51
    // morto por construção: ele compara com 'inbound', valor que nenhum writer
    // jamais pôde gravar.
    expect(readDirection({ direction: "inbound" })).toBe("incoming");
    expect(["incoming", "outgoing"]).toContain(readDirection({ direction: "inbound" }));
  });

  it.each([
    ["criteria.direction", { criteria: { direction: "IN" } }],
    ["message.direction", { message: { direction: "IN" } }],
    ["data.direction", { data: { direction: "IN" } }],
  ])("alias alternativo %s produz a mesma resposta", (_nome, body) => {
    expect(readDirection(body)).toBe("incoming");
  });

  it.each(NAO_OBJETOS)("ausente em %s ⇒ null (não há default)", (body) => {
    // Assumir `incoming` por omissão gravaria uma mensagem NOSSA como se o cliente
    // a tivesse enviado — erro que a UI mostra invertido e que nenhum log denuncia.
    expect(readDirection(body)).toBeNull();
  });

  it("valor vazio ⇒ null", () => {
    expect(readDirection({ direction: "  " })).toBeNull();
  });

  it("tipo errado ⇒ null", () => {
    expect(readDirection({ direction: { value: "in" } })).toBeNull();
    expect(readDirection({ direction: 1 })).toBeNull();
  });

  it.each(["LATERAL", "unknown", "both", "i", "o"])(
    "valor desconhecido ('%s') ⇒ null, nunca um chute",
    (valor) => {
      expect(readDirection({ direction: valor })).toBeNull();
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. pickContact — o INTERLOCUTOR, nunca "o remetente"
// ═══════════════════════════════════════════════════════════════════════════

describe("pickContact — quem está do outro lado", () => {
  it("lê os quatro campos do corpo esperado", () => {
    const c = pickContact({
      from: { id: "igsid-777", name: "Fulana", username: "fulana", picture: "https://x/y.jpg" },
    });
    expect(c).toEqual({
      externalId: "igsid-777",
      name: "Fulana",
      avatarUrl: "https://x/y.jpg",
      handle: "fulana",
    });
  });

  it.each([
    ["contact.id", { contact: { id: "igsid-777" } }],
    ["contact.external_id", { contact: { external_id: "igsid-777" } }],
    ["from.id", { from: { id: "igsid-777" } }],
    ["from (string solta)", { from: "igsid-777" }],
    ["sender.id", { sender: { id: "igsid-777" } }],
    ["senderId", { senderId: "igsid-777" }],
    ["sender_id", { sender_id: "igsid-777" }],
    ["user.id", { user: { id: "igsid-777" } }],
    ["message.from", { message: { from: "igsid-777" } }],
    ["data.from", { data: { from: "igsid-777" } }],
  ])("alias alternativo %s produz o mesmo externalId", (_nome, body) => {
    expect(pickContact(body).externalId).toBe("igsid-777");
  });

  it.each([
    ["contact.name", { contact: { name: "Fulana" } }],
    ["contact.profile.name", { contact: { profile: { name: "Fulana" } } }],
    ["sender.name", { sender: { name: "Fulana" } }],
    ["senderName", { senderName: "Fulana" }],
    ["sender_name", { sender_name: "Fulana" }],
    ["user.name", { user: { name: "Fulana" } }],
    ["profile.name", { profile: { name: "Fulana" } }],
  ])("alias alternativo %s produz o mesmo name", (_nome, body) => {
    expect(pickContact(body).name).toBe("Fulana");
  });

  it.each([
    ["contact.picture", { contact: { picture: "u" } }],
    ["contact.profile_pic", { contact: { profile_pic: "u" } }],
    ["contact.avatar", { contact: { avatar: "u" } }],
    ["from.picture", { from: { picture: "u" } }],
    ["sender.avatar", { sender: { avatar: "u" } }],
    ["profile.picture", { profile: { picture: "u" } }],
  ])("alias alternativo %s produz o mesmo avatarUrl", (_nome, body) => {
    expect(pickContact(body).avatarUrl).toBe("u");
  });

  it.each([
    ["contact.username", { contact: { username: "h" } }],
    ["contact.handle", { contact: { handle: "h" } }],
    ["from.username", { from: { username: "h" } }],
    ["sender.username", { sender: { username: "h" } }],
    ["profile.username", { profile: { username: "h" } }],
  ])("alias alternativo %s produz o mesmo handle", (_nome, body) => {
    expect(pickContact(body).handle).toBe("h");
  });

  it.each(NAO_OBJETOS)("corpo %s ⇒ os quatro campos null, sem lançar", (body) => {
    expect(pickContact(body)).toEqual({
      externalId: null,
      name: null,
      avatarUrl: null,
      handle: null,
    });
  });

  it("`from: null` sob o alias `from.id` NÃO lança", () => {
    expect(() => pickContact({ from: null })).not.toThrow();
    expect(pickContact({ from: null }).externalId).toBeNull();
  });

  it("string vazia conta como ausência em TODOS os campos", () => {
    // Um contact_external_id vazio agruparia numa conversa só todos os
    // interlocutores anônimos da org.
    const c = pickContact({ from: { id: "  ", name: "", username: "", picture: "   " } });
    expect(c).toEqual({ externalId: null, name: null, avatarUrl: null, handle: null });
  });

  it("tipo errado conta como ausência", () => {
    expect(pickContact({ from: { id: { v: 1 } } }).externalId).toBeNull();
    expect(pickContact({ from: { id: true } }).externalId).toBeNull();
  });

  it("id NUMÉRICO do interlocutor é aceito (IGSID chega assim em alguns corpos)", () => {
    expect(pickContact({ from: { id: 17841400000000000 } }).externalId)
      .toBe(String(17841400000000000));
  });

  it("um campo cosmético ausente NÃO derruba a identidade", () => {
    // Identidade é obrigatória; nome e foto são cosméticos. Se a ausência de nome
    // anulasse o externalId, a conversa inteira sumiria por um rótulo.
    const c = pickContact({ from: { id: "igsid-777" } });
    expect(c.externalId).toBe("igsid-777");
    expect(c.name).toBeNull();
    expect(c.avatarUrl).toBeNull();
  });

  it("a PALAVRA do canal no corpo não vira interlocutor", () => {
    expect(pickContact({ channel: "instagram" }).externalId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. pickAccountHandle — a NOSSA conta, jamais o interlocutor
// ═══════════════════════════════════════════════════════════════════════════

describe("pickAccountHandle — identidade da nossa caixa", () => {
  it.each([
    ["account.username", { account: { username: "milennials" } }],
    ["account.handle", { account: { handle: "milennials" } }],
    ["to.username", { to: { username: "milennials" } }],
    ["to.handle", { to: { handle: "milennials" } }],
    ["recipient.username", { recipient: { username: "milennials" } }],
    ["channel.username", { channel: { username: "milennials" } }],
    ["channel.handle", { channel: { handle: "milennials" } }],
  ])("alias alternativo %s produz a mesma resposta", (_nome, body) => {
    expect(pickAccountHandle(body)).toBe("milennials");
  });

  it("tira o `@` da frente — a coluna guarda o handle, não a menção", () => {
    expect(pickAccountHandle({ account: { username: "@milennials" } })).toBe("milennials");
    expect(pickAccountHandle({ account: { username: "milennials" } })).toBe("milennials");
  });

  it("NÃO lê os aliases do interlocutor — nem `from`, nem `sender`, nem `profile`", () => {
    // Gravar o handle do interlocutor como identidade da nossa conta exibiria, na
    // lista de caixas, o nome de um cliente qualquer como identidade da empresa.
    const body = {
      from: { username: "@cliente_qualquer" },
      sender: { username: "@outro_cliente" },
      profile: { username: "@mais_um" },
      contact: { username: "@e_mais_um" },
    };
    expect(pickAccountHandle(body)).toBeNull();
    // ⚠️ COM o `@`: `pickContact` NÃO apara a menção, `pickAccountHandle` apara.
    // A assimetria é real e está fixada aqui de propósito, não elogiada: hoje ela
    // é inofensiva porque `contact.handle` não é escrito em `channel_messages`
    // (`buildInboundChannelMessageRow` não o usa). No dia em que uma coluna de
    // handle do INTERLOCUTOR existir, os dois formatos precisam convergir — e
    // este teste é que vai ficar vermelho para lembrar.
    expect(pickContact(body).handle).toBe("@e_mais_um");
  });

  it.each(NAO_OBJETOS)("ausente em %s ⇒ null (backfill best-effort não acontece)", (body) => {
    expect(pickAccountHandle(body)).toBeNull();
  });

  it("string vazia e só-`@` contam como ausência de conteúdo", () => {
    expect(pickAccountHandle({ account: { username: "  " } })).toBeNull();
    // '@' sozinho vira '' — não é handle, e gravá-lo apagaria o rótulo da caixa.
    expect(pickAccountHandle({ account: { username: "@" } })).toBe("");
  });

  it("tipo errado ⇒ null", () => {
    expect(pickAccountHandle({ account: { username: { v: "x" } } })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. pickContent — cosmético: NUNCA parka
// ═══════════════════════════════════════════════════════════════════════════

describe("pickContent — texto, mídia e tipo", () => {
  it.each([
    ["content", { content: "oi" }],
    ["text", { text: "oi" }],
    ["body", { body: "oi" }],
    ["message.text", { message: { text: "oi" } }],
    ["message.body", { message: { body: "oi" } }],
    ["message.content", { message: { content: "oi" } }],
    ["data.text", { data: { text: "oi" } }],
    ["contents.0.text (array)", { contents: [{ type: "text", text: "oi" }] }],
  ])("alias alternativo %s produz o mesmo texto", (_nome, body) => {
    expect(pickContent(body).content).toBe("oi");
  });

  it.each([
    ["media_url", { media_url: "u" }],
    ["mediaUrl", { mediaUrl: "u" }],
    ["attachment.url", { attachment: { url: "u" } }],
    ["attachments.0.url (array)", { attachments: [{ url: "u" }] }],
    ["message.media_url", { message: { media_url: "u" } }],
    ["contents.0.url (array)", { contents: [{ url: "u" }] }],
    ["url", { url: "u" }],
  ])("alias alternativo %s produz a mesma mídia", (_nome, body) => {
    expect(pickContent(body).mediaUrl).toBe("u");
  });

  it.each(NAO_OBJETOS)("corpo %s ⇒ sem texto, sem mídia, tipo 'text'", (body) => {
    // channel_messages.message_type é NOT NULL DEFAULT 'text'. O default do picker
    // é o MESMO da coluna, de propósito.
    expect(pickContent(body)).toEqual({ content: null, mediaUrl: null, messageType: "text" });
  });

  it("conteúdo ilegível NÃO vira ausência de mensagem — só de texto", () => {
    // Parkar por causa do texto esconderia a conversa inteira por um campo
    // cosmético que o raw_payload já preserva.
    const c = pickContent({ coisa_estranha: { texto: "oi" } });
    expect(c.content).toBeNull();
    expect(c.messageType).toBe("text");
  });

  it("string vazia conta como ausência", () => {
    expect(pickContent({ content: "   " }).content).toBeNull();
  });

  it("tipo errado conta como ausência", () => {
    expect(pickContent({ content: { text: "oi" } }).content).toBeNull();
    expect(pickContent({ media_url: ["u"] }).mediaUrl).toBeNull();
  });

  it("tipo DECLARADO ganha, e é normalizado em caixa baixa", () => {
    expect(pickContent({ message_type: "IMAGE" }).messageType).toBe("image");
    expect(pickContent({ messageType: "Audio" }).messageType).toBe("audio");
    expect(pickContent({ message: { type: "video" } }).messageType).toBe("video");
    expect(pickContent({ contents: [{ type: "FILE" }] }).messageType).toBe("file");
  });

  it("sem tipo declarado, a MÍDIA decide: 'media'; senão 'text'", () => {
    expect(pickContent({ media_url: "u" }).messageType).toBe("media");
    expect(pickContent({ content: "oi" }).messageType).toBe("text");
  });

  it("tipo declarado VAZIO cai no derivado, não em ''", () => {
    // messageType '' passaria pelo NOT NULL e viraria um tipo que nenhuma UI
    // reconhece.
    expect(pickContent({ message_type: "   ", media_url: "u" }).messageType).toBe("media");
    expect(pickContent({ message_type: "   " }).messageType).toBe("text");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. pickTimestampIso — o relógio LOCAL não mora aqui
// ═══════════════════════════════════════════════════════════════════════════

describe("pickTimestampIso — só o instante DECLARADO pelo corpo", () => {
  it("epoch em SEGUNDOS vira ISO", () => {
    expect(pickTimestampIso({ timestamp: 1755100000 }))
      .toBe(new Date(1755100000 * 1000).toISOString());
  });

  it("epoch em MILISSEGUNDOS vira ISO", () => {
    // O corte de 1e11 separa por ordem de grandeza: 1e11 segundos seria o ano 5138.
    expect(pickTimestampIso({ timestamp: 1755100000123 }))
      .toBe(new Date(1755100000123).toISOString());
  });

  it("string ISO já pronta é preservada como instante", () => {
    expect(pickTimestampIso({ timestamp: "2026-08-13T18:04:00.000Z" }))
      .toBe("2026-08-13T18:04:00.000Z");
  });

  it.each([
    ["created_at", { created_at: "2026-08-13T18:04:00.000Z" }],
    ["createdAt", { createdAt: "2026-08-13T18:04:00.000Z" }],
    ["message.timestamp", { message: { timestamp: "2026-08-13T18:04:00.000Z" } }],
  ])("alias alternativo %s produz o mesmo instante", (_nome, body) => {
    expect(pickTimestampIso(body)).toBe("2026-08-13T18:04:00.000Z");
  });

  it.each(NAO_OBJETOS)("ausente em %s ⇒ null (o fallback mora no handler)", (body) => {
    // Manter o relógio FORA deste módulo é o que permite asserir, por grep, que
    // nenhum caminho de identidade toca Date.now().
    expect(pickTimestampIso(body)).toBeNull();
  });

  it.each(["ontem de tarde", "   ", "não é data"])(
    "valor ilegível ('%s') ⇒ null, nunca Invalid Date",
    (valor) => {
      expect(pickTimestampIso({ timestamp: valor })).toBeNull();
    },
  );

  it.each([
    ["zero", 0],
    ["negativo", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("número inválido (%s) ⇒ null", (_nome, valor) => {
    expect(pickTimestampIso({ timestamp: valor })).toBeNull();
  });

  it("tipo errado ⇒ null", () => {
    expect(pickTimestampIso({ timestamp: { seconds: 1755100000 } })).toBeNull();
    expect(pickTimestampIso({ timestamp: true })).toBeNull();
  });

  it("um timestamp ilegível NÃO 'pula' para o alias seguinte", () => {
    // `??` encadeia por AUSÊNCIA do caminho, não por ilegibilidade do valor: um
    // `timestamp` presente e podre é a declaração do fornecedor, e a decisão de
    // usar o relógio é do handler — em UM lugar só.
    expect(pickTimestampIso({ timestamp: "ontem", created_at: "2026-08-13T18:04:00.000Z" }))
      .toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. buildInboundChannelMessageRow — os literais que o CHECK exige
// ═══════════════════════════════════════════════════════════════════════════

describe("buildInboundChannelMessageRow — a linha de channel_messages", () => {
  const params = () => ({
    organizationId: "org-1",
    target: { kind: "instagram" as const, messagingChannelId: "ch-1" },
    externalId: "mid-1",
    contact: {
      externalId: "igsid-777",
      name: "Fulana",
      avatarUrl: "https://x/y.jpg",
      handle: "fulana",
    },
    contactExternalId: "igsid-777",
    content: { content: "oi", mediaUrl: null, messageType: "text" },
    timestampIso: "2026-08-13T18:04:00.000Z",
    rawPayload: { qualquer: "coisa", nested: [{ a: 1 }] },
  });

  it("monta a linha inteira, sem inventar campo", () => {
    expect(buildInboundChannelMessageRow(params())).toEqual({
      organization_id: "org-1",
      channel: "instagram",
      messaging_channel_id: "ch-1",
      instance_id: null,
      contact_external_id: "igsid-777",
      external_id: "mid-1",
      direction: "incoming",
      message_type: "text",
      content: "oi",
      media_url: null,
      status: "received",
      sender_id: "igsid-777",
      sender_name: "Fulana",
      sender_profile_pic: "https://x/y.jpg",
      // Campo novo (2026-08-17): o @ do interlocutor virou coluna. Este teste
      // fixa a forma INTEIRA de propósito — é ele que obriga a decisão a ser
      // consciente quando alguém acrescenta campo à linha.
      contact_handle: "fulana",
      remote_jid: null,
      phone_number: null,
      instance_id: null,
      page_id: null,
      lead_id: null,
      timestamp: "2026-08-13T18:04:00.000Z",
      raw_payload: { qualquer: "coisa", nested: [{ a: 1 }] },
      // Campo novo (2026-08-19): a leitura normalizada do corpo. NULO aqui
      // porque quem chamou não passou nenhuma — e nulo significa "ainda não
      // normalizada", que é o que o backfill procura.
      metadata: null,
    });
  });

  it("`direction` é 'incoming' LITERAL — 'inbound' violaria o CHECK", () => {
    expect(buildInboundChannelMessageRow(params()).direction).toBe("incoming");
  });

  it("phone_number e remote_jid são NULL — NUNCA string vazia", () => {
    // `normalizePhone('')` devolve `''`, e `''` casa com `''`: todos os contatos de
    // Instagram da org colapsariam num contato só. E dois caminhos EXECUTAM esse
    // campo (formatPhoneForWhatsApp, LeadContactModal) — um handle ali vira
    // tentativa de discar para um @usuário.
    const row = buildInboundChannelMessageRow(params());
    expect(row.phone_number).toBeNull();
    expect(row.remote_jid).toBeNull();
    expect(row.instance_id).toBeNull();
    expect(row.page_id).toBeNull();
    expect(row.lead_id).toBeNull();
  });

  it("o corpo cru vai INTEGRAL, por referência — nem recorte, nem redação", () => {
    const p = params();
    expect(buildInboundChannelMessageRow(p).raw_payload).toBe(p.rawPayload);
  });

  it("quem AGRUPA é contact_external_id, e ele é independente de sender_id", () => {
    // O defeito a não copiar é useMetaMessages.ts, que casa a thread por
    // sender_id = external_user_id: na mensagem de SAÍDA o sender é a PÁGINA, e a
    // saída nunca aparece na conversa. Os dois campos são passados SEPARADOS de
    // propósito — é o que deixa o outbound entrar sem reescrever o inbound.
    const p = params();
    const row = buildInboundChannelMessageRow({
      ...p,
      contact: { ...p.contact, externalId: "quem-enviou" },
      contactExternalId: "com-quem-se-conversa",
    });
    expect(row.contact_external_id).toBe("com-quem-se-conversa");
    expect(row.sender_id).toBe("quem-enviou");
  });

  it("campos cosméticos ausentes viram NULL, e a linha nasce assim mesmo", () => {
    const p = params();
    const row = buildInboundChannelMessageRow({
      ...p,
      contact: { externalId: "igsid-777", name: null, avatarUrl: null, handle: null },
      content: { content: null, mediaUrl: null, messageType: "text" },
    });
    expect(row.sender_name).toBeNull();
    expect(row.sender_profile_pic).toBeNull();
    expect(row.content).toBeNull();
    expect(row.external_id).toBe("mid-1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. buildPayloadSnapshot — só escalares NOSSOS vão para runtime_logs
// ═══════════════════════════════════════════════════════════════════════════

describe("buildPayloadSnapshot — o que pode ir para o log", () => {
  it("preenche o que recebe", () => {
    expect(buildPayloadSnapshot({
      sourceIp: "203.0.113.10",
      subaccountHint: "sub-1",
      channelHint: "ch_1",
      eventType: "message",
      reason: "unhandled_event",
      organizationId: "org-1",
      messagingChannelId: "ch-uuid",
    })).toEqual({
      source_ip: "203.0.113.10",
      subaccount_hint: "sub-1",
      channel_hint: "ch_1",
      event_type: "message",
      reason: "unhandled_event",
      organization_id: "org-1",
      messaging_channel_id: "ch-uuid",
    });
  });

  it("o formato é ESTÁVEL: campo omitido vira null, e nunca some", () => {
    // Chave que some faz o operador ler ausência de dado como ausência de evento.
    expect(Object.keys(buildPayloadSnapshot({})).sort()).toEqual([
      "channel_hint",
      "event_type",
      "messaging_channel_id",
      "organization_id",
      "reason",
      "source_ip",
      "subaccount_hint",
    ]);
    expect(Object.values(buildPayloadSnapshot({})).every((v) => v === null)).toBe(true);
  });

  it("NÃO tem por onde receber o corpo do fornecedor", () => {
    // redactSecrets redige por NOME DE CHAVE; um JSON.stringify do payload sob uma
    // chave nossa (o que whatsapp-webhook L1470 faz com raw_truncated) não casa
    // chave nenhuma e atravessa token inteiro para uma tabela lida por humanos.
    // A assinatura desta função é a guarda: só escalares nomeados entram.
    const snap = buildPayloadSnapshot({ sourceIp: "1.2.3.4" });
    expect(JSON.stringify(snap)).not.toContain("payload");
    expect(Object.keys(snap)).toHaveLength(7);
  });
});

/**
 * ─── O PRIMEIRO PAYLOAD REAL DE MENSAGEM (2026-08-17, 17:25 UTC) ─────────────
 *
 * Até aqui, TODOS os aliases deste módulo vieram de documentação e do SDK.
 * Quando a primeira mensagem de verdade chegou, ela entrou com `content` e
 * `sender_name` VAZIOS — o chat mostrou "[Mensagem não suportada]" — e só o
 * IGSID foi lido, porque `message.from` por acaso já estava na lista.
 *
 * O fornecedor aninha tudo sob `message`, e os aliases paravam um nível acima.
 *
 * ⚠️ A INVERSÃO QUE CUSTA CARO: em `visitor`, o campo `name` é o @ do
 * Instagram (`m.montemezzo`) e `firstName` é o nome humano (`Marcelo
 * Montemezzo`). Ler `visitor.name` como nome faria o CRM chamar o cliente pelo
 * @ em toda tela, e-mail e disparo. Os dois testes abaixo fixam a direção certa.
 *
 * Cópia FIEL do corpo recebido, com o avatar encurtado.
 */
const PAYLOAD_REAL_IG = {
  id: "55500cf5-ac1a-424c-acfa-4e67dcbed893",
  type: "MESSAGE",
  channel: "instagram",
  direction: "IN",
  timestamp: "2026-08-17 05:25:02 pm",
  subscriptionId: "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
  message: {
    id: "55500cf5-ac1a-424c-acfa-4e67dcbed893",
    to: "3cff29b0-7c9c-4d10-9001-0d1597f55aaf",
    from: "1527557648673564",
    channel: "instagram",
    visitor: {
      name: "m.montemezzo",
      picture: "https://scontent-iad6-1.cdninstagram.com/v/t51.82787-19/685923097.jpg",
      lastName: "",
      firstName: "Marcelo Montemezzo",
    },
    contents: [{ text: "Fala Gipp", type: "text" }],
    direction: "IN",
    timestamp: "2026-08-17 05:25:02 pm",
  },
};

describe("pickContent — contra o primeiro payload REAL", () => {
  it("lê o texto de message.contents[0].text", () => {
    // Era `contents.0.text` na lista, sem o prefixo `message.` — um nível acima
    // de onde o fornecedor põe. Resultado: mensagem sem texto na tela.
    expect(pickContent(PAYLOAD_REAL_IG).content).toBe("Fala Gipp");
  });

  it("classifica como texto, e não cai no fallback de mídia", () => {
    expect(pickContent(PAYLOAD_REAL_IG).messageType).toBe("text");
    expect(pickContent(PAYLOAD_REAL_IG).mediaUrl).toBeNull();
  });
});

describe("pickContact — contra o primeiro payload REAL", () => {
  it("lê o IGSID de message.from", () => {
    expect(pickContact(PAYLOAD_REAL_IG).externalId).toBe("1527557648673564");
  });

  it("o NOME humano vem de visitor.firstName — nunca de visitor.name", () => {
    expect(pickContact(PAYLOAD_REAL_IG).name).toBe("Marcelo Montemezzo");
  });

  it("o @ vem de visitor.name — e é ele que o detector de duplicatas usa", () => {
    // Este campo é o segundo sinal de identidade entre um lead de Instagram e um
    // de WhatsApp. O handoff desta fatia afirmava que o payload NÃO trazia o
    // handle do interlocutor; a primeira mensagem real provou o contrário.
    expect(pickContact(PAYLOAD_REAL_IG).handle).toBe("m.montemezzo");
  });

  it("lê o avatar de visitor.picture", () => {
    expect(pickContact(PAYLOAD_REAL_IG).avatarUrl).toContain("cdninstagram.com");
  });
});

describe("buildInboundChannelMessageRow — o @ do contato vira COLUNA", () => {
  /**
   * O handle chegava no corpo e morria no `raw_payload`. Preso lá dentro ele não
   * é pesquisável nem casável: o detector de duplicatas precisa comparar o @ do
   * Instagram com o que o vendedor anotou no lead, e ninguém faz isso varrendo
   * jsonb de dez mil linhas.
   */
  it("grava contact_handle a partir do contato lido", () => {
    const row = buildInboundChannelMessageRow({
      organizationId: "org-1",
      target: { kind: "instagram" as const, messagingChannelId: "canal-1" },
      externalId: "msg-1",
      contact: pickContact(PAYLOAD_REAL_IG),
      contactExternalId: "1527557648673564",
      content: pickContent(PAYLOAD_REAL_IG),
      timestampIso: "2026-08-17T17:25:02.000Z",
      rawPayload: PAYLOAD_REAL_IG,
    });

    expect(row.contact_handle).toBe("m.montemezzo");
    // O nome humano continua no seu lugar — a inversão do fornecedor não vaza.
    expect(row.sender_name).toBe("Marcelo Montemezzo");
    expect(row.content).toBe("Fala Gipp");
  });

  it("corpo sem handle grava null, e não string vazia", () => {
    const semHandle = { message: { from: "999", contents: [{ text: "oi", type: "text" }] } };
    const row = buildInboundChannelMessageRow({
      organizationId: "org-1",
      target: { kind: "instagram" as const, messagingChannelId: "canal-1" },
      externalId: "msg-2",
      contact: pickContact(semHandle),
      contactExternalId: "999",
      content: pickContent(semHandle),
      timestampIso: "2026-08-17T17:25:02.000Z",
      rawPayload: semHandle,
    });

    expect(row.contact_handle).toBeNull();
  });
});
