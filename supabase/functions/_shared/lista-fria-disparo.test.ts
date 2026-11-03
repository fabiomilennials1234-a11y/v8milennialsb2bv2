import { assertEquals } from "@std/assert";
import {
  dentroDaJanela,
  relogioDeBrasilia,
  textoDaJanela,
  variaveisDesconhecidas,
} from "./lista-fria-disparo.ts";

Deno.test("variaveisDesconhecidas aceita as quatro que o disparo preenche", () => {
  assertEquals(variaveisDesconhecidas("Oi {{primeiro_nome}}, da {empresa}! {{ nome }} / {segmento}"), []);
});

Deno.test("variaveisDesconhecidas aponta a que sairia vazia, sem repetir", () => {
  assertEquals(
    variaveisDesconhecidas("Oi, aqui é {{responsavel}}. Fala {responsavel} ou {{cidade}}"),
    ["responsavel", "cidade"],
  );
});

Deno.test("variaveisDesconhecidas ignora spintax", () => {
  assertEquals(variaveisDesconhecidas("{Oi|Olá|E aí} {{nome}}"), []);
});

Deno.test("relogioDeBrasilia converte UTC para -03:00", () => {
  assertEquals(relogioDeBrasilia(new Date("2026-11-03T16:15:00Z")), "2026-11-03T13:15");
  // Meia-noite de Brasília não vira "24:00".
  assertEquals(relogioDeBrasilia(new Date("2026-11-04T03:05:00Z")), "2026-11-04T00:05");
});

Deno.test("dentroDaJanela: terça às 13h15 de Brasília está dentro", () => {
  assertEquals(dentroDaJanela(new Date("2026-11-03T16:15:00Z")), true);
});

Deno.test("dentroDaJanela: terça às 23h de Brasília está fora", () => {
  assertEquals(dentroDaJanela(new Date("2026-11-04T02:00:00Z")), false);
});

Deno.test("dentroDaJanela: a janela é [08h, 20h): 08h00 entra, 20h00 não", () => {
  assertEquals(dentroDaJanela(new Date("2026-11-03T11:00:00Z")), true);
  assertEquals(dentroDaJanela(new Date("2026-11-03T22:59:00Z")), true);
  assertEquals(dentroDaJanela(new Date("2026-11-03T23:00:00Z")), false);
});

Deno.test("dentroDaJanela: domingo ao meio-dia está fora", () => {
  // 2026-11-08 é domingo.
  assertEquals(dentroDaJanela(new Date("2026-11-08T15:00:00Z")), false);
});

Deno.test("textoDaJanela descreve dias e horas", () => {
  assertEquals(textoDaJanela(), "seg, ter, qua, qui, sex, sáb, das 08h às 20h (Brasília)");
});
