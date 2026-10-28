import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildReplyContext,
  extractQuotedMessageId,
  extractQuotedParticipant,
  extractQuotedText,
  looksLikeMessageId,
  stripQuotedPrefix,
} from "./quoted-text.ts";

Deno.test("looksLikeMessageId: id hex longo é id, texto normal não", () => {
  assertEquals(looksLikeMessageId("3EB0CEDD31B834C6863D67"), true);
  assertEquals(looksLikeMessageId("ABCDEF0123456789ABCD"), true);
  assertEquals(looksLikeMessageId("bom dia"), false);
  assertEquals(looksLikeMessageId("500k"), false);
  assertEquals(looksLikeMessageId("R$ 3.000,00"), false);
  assertEquals(looksLikeMessageId("café"), false);
});

Deno.test("REGRESSÃO: data.quoted como id não vira texto citado", () => {
  // Bug da Carol: chat mostrava [Em resposta a: "3EB0CEDD31B834C6863D67"].
  assertEquals(extractQuotedText({ quoted: "3EB0CEDD31B834C6863D67" }), null);
});

Deno.test("data.quotedText legítimo ainda é extraído", () => {
  assertEquals(extractQuotedText({ quotedText: "esse é o valor" }), "esse é o valor");
});

Deno.test("data.quoted string curta de texto ainda passa", () => {
  assertEquals(extractQuotedText({ quoted: "500k" }), "500k");
});

Deno.test("quotedMessage objeto com conversation é extraído", () => {
  assertEquals(
    extractQuotedText({ contextInfo: { quotedMessage: { conversation: "quanto custa?" } } }),
    "quanto custa?",
  );
});

Deno.test("quoted de mídia sem legenda vira placeholder tipado", () => {
  assertEquals(extractQuotedText({ quotedMessage: { imageMessage: {} } }), "[imagem]");
});

Deno.test("sem quoted retorna null", () => {
  assertEquals(extractQuotedText({ text: "oi" }), null);
  assertEquals(extractQuotedText(null), null);
});

Deno.test("extractQuotedMessageId: data.quoted string-id (fixture torquesdr-live-shapes)", () => {
  assertEquals(extractQuotedMessageId({ quoted: "3EB0CEDD31B834C6863D67" }), "3EB0CEDD31B834C6863D67");
});

Deno.test("extractQuotedMessageId: stanzaID em content.contextInfo e contextInfo (payload real do botão)", () => {
  assertEquals(
    extractQuotedMessageId({ quoted: "3EB0CEDD31B834C6863D67", content: { contextInfo: { stanzaID: "ABC123" } } }),
    "ABC123",
  );
  assertEquals(extractQuotedMessageId({ contextInfo: { stanzaId: "XYZ" } }), "XYZ");
  assertEquals(
    extractQuotedMessageId({ message: { extendedTextMessage: { contextInfo: { stanzaID: "EXT1" } } } }),
    "EXT1",
  );
});

Deno.test("extractQuotedMessageId: texto curto em data.quoted NÃO é id; sem citação é null", () => {
  assertEquals(extractQuotedMessageId({ quoted: "500k" }), null);
  assertEquals(extractQuotedMessageId({ text: "oi" }), null);
  assertEquals(extractQuotedMessageId(null), null);
  assertEquals(extractQuotedMessageId({ quoted: { id: "Q9" } }), "Q9");
  assertEquals(extractQuotedMessageId({ replyid: "R1" }), "R1");
});

Deno.test("extractQuotedParticipant", () => {
  assertEquals(extractQuotedParticipant({ contextInfo: { participant: "5511900000001@s.whatsapp.net" } }), "5511900000001@s.whatsapp.net");
  assertEquals(extractQuotedParticipant({}), null);
});

Deno.test("stripQuotedPrefix: aspas retas, curvas, multilinha e aspas internas", () => {
  assertEquals(stripQuotedPrefix('[Em resposta a: "quanto custa?"]\nR$ 500'), "R$ 500");
  assertEquals(stripQuotedPrefix("[Em resposta a: “linha1\nlinha2”]\nok"), "ok");
  assertEquals(stripQuotedPrefix('[Em resposta a: "ele disse "sim" ontem"]\nok'), "ok");
  assertEquals(stripQuotedPrefix("sem prefixo"), "sem prefixo");
});

Deno.test("buildReplyContext: original gravada manda (texto limpo, id e direção da linha)", () => {
  assertEquals(
    buildReplyContext({
      quotedId: "A1",
      payloadText: "texto do payload",
      original: { message_id: "5511:A1", content: '[Em resposta a: "x"]\nminha msg', message_type: "text", direction: "outgoing" },
      citingDirection: "incoming",
    }),
    { messageId: "5511:A1", text: "minha msg", direction: "outgoing" },
  );
});

Deno.test("buildReplyContext: original só-mídia vira rótulo", () => {
  assertEquals(
    buildReplyContext({
      quotedId: "A1", payloadText: null, citingDirection: "incoming",
      original: { message_id: "5511:A1", content: null, message_type: "image", direction: "outgoing" },
    })?.text,
    "Imagem",
  );
});

Deno.test("buildReplyContext: original ausente usa payload; direção = outra ponta, participant desempata", () => {
  assertEquals(
    buildReplyContext({ quotedId: "A1", payloadText: "oi?", original: null, citingDirection: "incoming" }),
    { messageId: "A1", text: "oi?", direction: "outgoing" },
  );
  assertEquals(
    buildReplyContext({ quotedId: "A1", payloadText: "oi?", original: null, citingDirection: "outgoing" })?.direction,
    "incoming",
  );
  assertEquals(
    buildReplyContext({ quotedId: "A1", payloadText: "oi?", original: null, citingDirection: "incoming", participantIsSelf: false })?.direction,
    "incoming",
  );
});

Deno.test("buildReplyContext: sem id ou sem texto e sem original → null", () => {
  assertEquals(buildReplyContext({ quotedId: null, payloadText: "x", original: null, citingDirection: "incoming" }), null);
  assertEquals(buildReplyContext({ quotedId: "A1", payloadText: null, original: null, citingDirection: "incoming" }), null);
});
