/**
 * `redactSecrets` — PII de COMPRADOR (documento fiscal e e-mail).
 *
 * Estas chaves entraram no mapa quando o billing passou a existir: até então
 * não havia comprador no produto, e quem escreveu a redação original já tinha
 * pensado em PII de LEAD (telefone mascarado, não apagado).
 *
 * O teste que mais importa aqui é o NEGATIVO em duas frentes: o documento não
 * sai reconstruível, e o e-mail não sai. E um que registra o limite honesto da
 * abordagem — lista de padrões é por NOME DE CHAVE, e frase não tem chave.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { redactSecrets } from "./logger.ts";

Deno.test("cpfCnpj é mascarado até os dois últimos dígitos", () => {
  const out = redactSecrets({ cpfCnpj: "12345678901" }) as Record<string, string>;
  assertEquals(out.cpfCnpj, "*********01");
  assert(!out.cpfCnpj.includes("12345678"), "o miolo não pode sobreviver");
});

Deno.test("CNPJ formatado perde a pontuação e o corpo", () => {
  const out = redactSecrets({ buyer_tax_id: "12.345.678/0001-95" }) as Record<string, string>;
  assertEquals(out.buyer_tax_id, "************95");
});

Deno.test("as variações de nome de chave são pegas", () => {
  const out = redactSecrets({
    cpf: "11122233396",
    cnpj: "12345678000195",
    tax_id: "11122233396",
    documento: "11122233396",
  }) as Record<string, string>;
  for (const [k, v] of Object.entries(out)) {
    assert(v.endsWith("96") || v.endsWith("95"), `${k} devia terminar nos verificadores`);
    assert(v.startsWith("*"), `${k} devia estar mascarado`);
  }
});

Deno.test("documento curto demais vira REDACTED — mascarar 3 dígitos revelaria o número", () => {
  const out = redactSecrets({ cpf: "123" }) as Record<string, string>;
  assertEquals(out.cpf, "***REDACTED***");
});

Deno.test("e-mail é redigido INTEIRO, não mascarado", () => {
  // Assimetria deliberada em relação ao telefone: e-mail identifica sozinho e
  // costuma ser a credencial de acesso. Correlação se faz por user_id.
  const out = redactSecrets({ buyer_email: "fulano@empresa.com.br" }) as Record<string, string>;
  assertEquals(out.buyer_email, "***REDACTED***");
});

Deno.test("PII aninhada também é redigida — o vazamento não precisa estar na raiz", () => {
  const out = redactSecrets({
    charge: { buyer: { email: "a@b.com", cpfCnpj: "12345678901" }, id: "chg_1" },
  }) as Record<string, Record<string, Record<string, string>>>;
  assertEquals(out.charge.buyer.email, "***REDACTED***");
  assertEquals(out.charge.buyer.cpfCnpj, "*********01");
  // O que NÃO é PII sobrevive: sem isso a redação inviabilizaria o diagnóstico.
  assertEquals((out.charge as unknown as Record<string, string>).id, "chg_1");
});

Deno.test("credencial vence documento quando a chave casa as duas listas", () => {
  // `isSensitiveKey` é avaliado primeiro, de propósito: um "tax_token" é
  // credencial antes de ser documento.
  const out = redactSecrets({ tax_token: "12345678901" }) as Record<string, string>;
  assertEquals(out.tax_token, "***REDACTED***");
});

Deno.test("telefone continua MASCARADO e não apagado — a regra antiga não regride", () => {
  const out = redactSecrets({ phone: "5511987654321" }) as Record<string, string>;
  assert(out.phone.startsWith("5511"), "o prefixo tem que sobreviver para correlacionar");
  assert(out.phone.endsWith("4321"));
  assert(out.phone.includes("*"));
});

Deno.test("LIMITE DECLARADO: frase não tem chave, então PII em texto de erro atravessa", () => {
  // Este teste NÃO descreve um defeito a consertar aqui — descreve por que a
  // lista de padrões não basta. A regra é não interpolar PII em mensagem de
  // erro; para identificar a linha, use o id do registro.
  const out = redactSecrets({
    error_message: "cliente inválido: cpf 12345678901",
  }) as Record<string, string>;
  assert(out.error_message.includes("12345678901"),
    "documenta o limite: a redação é por nome de chave, e uma frase não tem chave");
});

Deno.test("nome do comprador é redigido — no ramo CPF ele é nome civil, não razão social", () => {
  // O nome da chave engana: `legal_name` soa a razão social, mas a coluna
  // guarda o nome que o gateway exige, e a tabela admite comprador pessoa
  // FÍSICA. Nesse ramo é o nome civil de alguém — não é público em lugar
  // nenhum. O argumento "é público" vale para metade da tabela e falha na
  // outra, e é a metade que falha que decide.
  const out = redactSecrets({
    buyer_legal_name: "Padaria Aurora LTDA",
    razao_social: "João da Silva",
  }) as Record<string, string>;
  assertEquals(out.buyer_legal_name, "***REDACTED***");
  assertEquals(out.razao_social, "***REDACTED***");
});

Deno.test("nome de LEAD não é razão social — a lista não cobre o que não pediu", () => {
  // `name` e `company` de lead seguem em claro: são o vocabulário do CRM, e
  // sobre-redigir aqui apagaria o diagnóstico de metade dos fluxos.
  const out = redactSecrets({ name: "Contato X", company: "Empresa Y" }) as Record<string, string>;
  assertEquals(out.name, "Contato X");
  assertEquals(out.company, "Empresa Y");
});
