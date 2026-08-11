import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildInv5AlertText,
  buildInv5PayloadFromRows,
  INV5_MAX_TABELAS_NO_TEXTO,
  INV5_MAX_VIOLACOES_NO_PAYLOAD,
} from "./inv5-alert.ts";

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

Deno.test("carimba QUANDO o estado foi verificado, e diz que reconfere sozinho", () => {
  const texto = buildInv5AlertText({ total: 1, violacoes: [{ tabela: "x", grantees: ["anon"] }] }, QUANDO);
  // O alerta fala do estado de AGORA, não do resultado da varredura diária —
  // exposição efêmera (nasce 10:00, some 16:00) não aparece em varredura
  // nenhuma, e é a forma que a intervenção manual em produção tem.
  assertStringIncludes(texto, "Estado verificado em 2026-08-12 04:17 UTC");
  assertStringIncludes(texto, "reconfere a cada 2 minutos");
  assertEquals(texto.includes("Varredura que disparou"), false);
});

Deno.test("LACUNA v3: total sem detalhe não anuncia resto — '…e mais 137' abaixo de 'payload sem detalhe' lê como número errado", () => {
  const texto = buildInv5AlertText({ total: 137, violacoes: [] }, QUANDO);
  assertStringIncludes(texto, "137 tabelas estão legíveis");
  assertStringIncludes(texto, "payload sem detalhe");
  assertEquals(texto.includes("…e mais"), false);
});

Deno.test("linhas vivas do detector viram uma entrada por TABELA, com os grantees juntos", () => {
  const payload = buildInv5PayloadFromRows([
    { schemaname: "public", tablename: "_bkp_x", grantee: "authenticated" },
    { schemaname: "public", tablename: "_bkp_x", grantee: "anon" },
    { schemaname: "public", tablename: "_bkp_a", grantee: "anon" },
  ]);
  // 3 linhas, 2 tabelas: o alerta conta TABELA, não par tabela+grantee — senão
  // uma tabela exposta aos dois roles vira "2 tabelas expostas".
  assertEquals(payload.total, 2);
  assertEquals(payload.violacoes?.[0].tabela, "_bkp_a");
  assertEquals(payload.violacoes?.[1].grantees, ["anon", "authenticated"]);
});

Deno.test("detector vazio é total 0 — é o sinal de 'consertaram, cala a boca'", () => {
  assertEquals(buildInv5PayloadFromRows([]).total, 0);
});

Deno.test("linha sem tablename não vira violação fantasma", () => {
  assertEquals(buildInv5PayloadFromRows([{ grantee: "anon" } as never]).total, 0);
});

Deno.test("o caminho ao vivo respeita o mesmo teto de 50 da varredura SQL, e o total continua real", () => {
  const rows = Array.from({ length: 137 }, (_, i) => ({
    tablename: `t${String(i).padStart(3, "0")}`,
    grantee: "anon",
  }));
  const payload = buildInv5PayloadFromRows(rows);
  // O registro não cresce sem teto — restrição que a varredura SQL já tinha e
  // que o caminho ao vivo tinha deixado cair.
  assertEquals(payload.violacoes?.length, INV5_MAX_VIOLACOES_NO_PAYLOAD);
  assertEquals(payload.truncado, true);
  // ...e cortar a lista nunca reporta menos violação do que existe.
  assertEquals(payload.total, 137);
  assertStringIncludes(buildInv5AlertText(payload, QUANDO), "137 tabelas estão legíveis");
});

Deno.test("abaixo do teto não marca truncado", () => {
  const payload = buildInv5PayloadFromRows([{ tablename: "t", grantee: "anon" }]);
  assertEquals(payload.truncado, false);
});
