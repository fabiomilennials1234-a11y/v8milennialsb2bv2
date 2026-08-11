import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildInv5AlertText, INV5_MAX_TABELAS_NO_TEXTO } from "./inv5-alert.ts";

const QUANDO = "2026-08-12T04:17:03.221Z";

Deno.test("nomeia a tabela E o grantee — quem acorda às 4h decide sem abrir o banco", () => {
  const texto = buildInv5AlertText(
    { total: 1, violacoes: [{ tabela: "_bkp_c7e4ba84_secrets", grantees: ["anon", "authenticated"] }] },
    QUANDO,
  );
  assertStringIncludes(texto, "_bkp_c7e4ba84_secrets");
  assertStringIncludes(texto, "anon, authenticated");
  assertStringIncludes(texto, "1 tabela está legível");
});

Deno.test("plural com mais de uma", () => {
  const texto = buildInv5AlertText(
    { total: 2, violacoes: [{ tabela: "a", grantees: ["anon"] }, { tabela: "b", grantees: ["anon"] }] },
    QUANDO,
  );
  assertStringIncludes(texto, "2 tabelas estão legíveis");
});

Deno.test("REGRESSÃO: o total vem do payload, não do tamanho da lista", () => {
  // A varredura trunca o array em 50 e mantém `total` real. Contar o array
  // reportaria MENOS violação do que existe — que é o defeito que o campo
  // `truncado` existe para impedir, e o pior erro possível num alerta de
  // segurança: subnotificar e parecer preciso.
  const violacoes = Array.from({ length: 50 }, (_, i) => ({ tabela: `t${i}`, grantees: ["anon"] }));
  const texto = buildInv5AlertText({ total: 137, truncado: true, violacoes }, QUANDO);
  assertStringIncludes(texto, "137 tabelas estão legíveis");
  assertStringIncludes(texto, `…e mais ${137 - INV5_MAX_TABELAS_NO_TEXTO}.`);
});

Deno.test("corta a lista no teto e diz quantas sobraram", () => {
  const violacoes = Array.from({ length: 12 }, (_, i) => ({ tabela: `tabela_${i}`, grantees: ["anon"] }));
  const texto = buildInv5AlertText({ total: 12, violacoes }, QUANDO);
  assertStringIncludes(texto, "tabela_0");
  assertStringIncludes(texto, `tabela_${INV5_MAX_TABELAS_NO_TEXTO - 1}`);
  assertEquals(texto.includes(`tabela_${INV5_MAX_TABELAS_NO_TEXTO}`), false);
  assertStringIncludes(texto, `…e mais ${12 - INV5_MAX_TABELAS_NO_TEXTO}.`);
});

Deno.test("sem sobra, não inventa '…e mais 0'", () => {
  const texto = buildInv5AlertText({ total: 1, violacoes: [{ tabela: "x", grantees: ["anon"] }] }, QUANDO);
  assertEquals(texto.includes("…e mais"), false);
});

Deno.test("payload malformado não derruba o alerta — alerta que não sai é pior que alerta feio", () => {
  const texto = buildInv5AlertText({} as never, QUANDO);
  assertStringIncludes(texto, "INV-5");
  assertStringIncludes(texto, "payload sem detalhe");
});

Deno.test("carrega o conserto, e proíbe o conserto errado", () => {
  const texto = buildInv5AlertText({ total: 1, violacoes: [{ tabela: "x", grantees: ["anon"] }] }, QUANDO);
  assertStringIncludes(texto, "ENABLE ROW LEVEL SECURITY");
  assertStringIncludes(texto, "REVOKE SELECT");
  // O default privilege é load-bearing: revogá-lo derruba o PostgREST inteiro.
  assertStringIncludes(texto, "NÃO mexa no `ALTER DEFAULT PRIVILEGES`");
});

Deno.test("carimba quando a varredura rodou", () => {
  const texto = buildInv5AlertText({ total: 1, violacoes: [{ tabela: "x", grantees: ["anon"] }] }, QUANDO);
  assertStringIncludes(texto, "2026-08-12 04:17 UTC");
});
