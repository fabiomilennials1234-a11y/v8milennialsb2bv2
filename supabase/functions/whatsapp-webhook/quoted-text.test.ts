import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractQuotedText, looksLikeMessageId } from "./quoted-text.ts";

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
