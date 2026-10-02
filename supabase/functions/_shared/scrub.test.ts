/**
 * scrub — o que sai da função para log e telemetria (ADR-0038).
 */
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { scrubPii, scrubText, stripQuery } from "./scrub.ts";

Deno.test("scrubPii: telefone, e-mail, CPF e CNPJ mascarados; UUID e JID preservados", () => {
  assertEquals(scrubPii("tel 5511987654321"), "tel 5511*****4321");
  assertEquals(scrubPii("joao@empresa.com.br"), "j***@empresa.com.br");
  assertEquals(scrubPii("5511987654321@s.whatsapp.net"), "5511*****4321@s.whatsapp.net");
  assertEquals(scrubPii("123.456.789-01 e 12.345.678/0001-90"), "***.***.***-01 e **.***.***/****-90");
  assertEquals(
    scrubPii("lead 550e8400-e29b-41d4-a716-446655440000"),
    "lead 550e8400-e29b-41d4-a716-446655440000",
  );
});

Deno.test("stripQuery corta query e fragmento", () => {
  assertEquals(stripQuery("https://x/functions/v1/fn?phone=5511987654321#t"), "https://x/functions/v1/fn");
});

Deno.test("scrubText: o erro de fetch do Deno traz a URL inteira — o token da query não sai", () => {
  assertEquals(
    scrubText("error sending request for url (https://graph.facebook.com/v19.0/me?access_token=EAAG123): timed out"),
    "error sending request for url (https://graph.facebook.com/v19.0/me): timed out",
  );
  assertEquals(
    scrubText("falhou para 5511987654321 em https://x/y?t=1"),
    "falhou para 5511*****4321 em https://x/y",
  );
});
