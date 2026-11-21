import { assertEquals } from "@std/assert";
import { ufBrasileira, UFS_BRASILEIRAS } from "./br-uf.ts";

Deno.test("as 27 de leads_uf_check, nem uma a mais", () => {
  // Copiadas à mão do CHECK no baseline (20260101000000), na ordem de lá.
  const doCheck = [
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
    "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SE", "SP", "TO",
  ];
  assertEquals([...UFS_BRASILEIRAS].sort(), [...doCheck].sort());
  assertEquals(new Set(UFS_BRASILEIRAS).size, 27);
});

Deno.test("U1–U3 do pgTAP: a mesma resposta de public.uf_brasileira", () => {
  assertEquals(ufBrasileira(" sc "), "SC");
  assertEquals(ufBrasileira("EX"), null);
  assertEquals(ufBrasileira(""), null);
});

Deno.test("fora das 27 é null: par de letras qualquer, nome do estado, não-texto", () => {
  const foraDasUfs = ["XX", "ex", "S", "SCC", "S C", "Santa Catarina", "   ", null, undefined, 42, {}];
  for (const valor of foraDasUfs) {
    assertEquals(ufBrasileira(valor), null, `ufBrasileira(${JSON.stringify(valor)})`);
  }
});

Deno.test("toda UF volta a si mesma, em qualquer caixa e com espaço em volta", () => {
  for (const uf of UFS_BRASILEIRAS) {
    assertEquals(ufBrasileira(uf), uf);
    assertEquals(ufBrasileira(uf.toLowerCase()), uf);
    assertEquals(ufBrasileira(` ${uf}\t`), uf);
  }
});
