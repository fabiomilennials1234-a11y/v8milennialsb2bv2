import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { tothSituacao, tothSituacaoLabel } from "./toth-situacao.ts";

Deno.test("tothSituacao — cadastro do ERP › raiz do metadata › coluna", () => {
  assertEquals(tothSituacao("1", "0", "0"), "1");
  assertEquals(tothSituacao(null, "3", "0"), "3");
  assertEquals(tothSituacao(undefined, "  ", "0"), "0");
  assertEquals(tothSituacao(2, null, null), "2");
  assertEquals(tothSituacao(null, null, null), null);
});

Deno.test("tothSituacaoLabel — a legenda da ficha do lead; código novo aparece como veio", () => {
  assertEquals(tothSituacaoLabel("0"), "Ativo");
  assertEquals(tothSituacaoLabel("1"), "Inativo");
  assertEquals(tothSituacaoLabel("2"), "Bloqueado");
  assertEquals(tothSituacaoLabel(" 3 "), "Inconsistente");
  assertEquals(tothSituacaoLabel("7"), "Situação 7");
  assertEquals(tothSituacaoLabel(null), null);
  assertEquals(tothSituacaoLabel(""), null);
});
