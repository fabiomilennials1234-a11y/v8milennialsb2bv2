/**
 * `{{estagio}}` — a etapa vem do NEGÓCIO, nunca do espelho legado.
 *
 * Fecha `inv:H4-06` (ADR-0023 §10). `leads.pipe_whatsapp` é espelho: quando o
 * negócio sai de Qualificação por MOVE, o gatilho resolve o slug por
 * `NEW.pipeline_id` e não escreve — a coluna CONGELA na última etapa de
 * whatsapp. Uma mensagem montada a partir dela sai com uma etapa que o negócio
 * não ocupa mais, e o cliente lê "você está em Agendado" quando ele está em
 * Proposta enviada. Ninguém vê campo vazio para desconfiar: o texto fica
 * plausível e errado, que é o pior modo de falha de template.
 *
 * O caso mais forte desta suíte é o que afirma a AUSÊNCIA: a query de `leads`
 * não pede `pipe_whatsapp`. Enquanto a coluna não estiver na lista de select,
 * ninguém a lê aqui por acidente.
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { resolveVariables } from "./whatsapp-helpers.ts";

interface EntryFake {
  id: string;
  lead_id: string;
  stage_key: string;
  closed_at: string | null;
}

const LEAD = {
  name: "Bar do Zé",
  company: "Bar do Zé Ltda",
  email: "",
  phone: "",
  qualification_score: null,
  rating: null,
  sdr_id: null,
  closer_id: null,
  responsible_id: null,
  organization_id: "org-1",
  faturamento: null,
  segment: "",
  urgency: "",
  notes: "",
  origin: "",
};

// deno-lint-ignore no-explicit-any
function fakeSupabase(opts: { entries?: EntryFake[]; semFunil?: boolean; capturaSelect?: string[] }): any {
  return {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: (cols?: string) => {
          if (table === "leads" && cols && opts.capturaSelect) opts.capturaSelect.push(cols);
          return builder;
        },
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => {
          if (table === "leads") return Promise.resolve({ data: LEAD, error: null });
          if (table === "pipelines") {
            return Promise.resolve(
              opts.semFunil
                ? { data: null, error: { message: "sem funil" } }
                : { data: { id: "pipe-1" }, error: null },
            );
          }
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (v: { data: unknown[]; error: unknown }) => unknown) =>
          resolve({ data: table === "pipeline_entries" ? (opts.entries ?? []) : [], error: null }),
      };
      return builder;
    },
  };
}

let n = 0;
/** Org nova por caso: `resolvePipelineId` guarda cache de módulo por `org:slug`. */
const leadNovo = () => `lead-${++n}`;

Deno.test("{{estagio}} sai do stage_key do Negócio", async () => {
  const sb = fakeSupabase({
    entries: [{ id: "e1", lead_id: "l1", stage_key: "respondeu", closed_at: null }],
  });

  const texto = await resolveVariables(sb, leadNovo(), "Você está em {{estagio}}.");

  assertEquals(texto, "Você está em respondeu.");
});

Deno.test("com N negócios no funil, vale a etapa do ABERTO — mesmo critério dos outros leitores", async () => {
  const sb = fakeSupabase({
    entries: [
      { id: "e1", lead_id: "l1", stage_key: "perdido", closed_at: "2026-01-01" },
      { id: "e2", lead_id: "l1", stage_key: "agendado", closed_at: null },
    ],
  });

  const texto = await resolveVariables(sb, leadNovo(), "{{estagio}}");

  assertEquals(texto, "agendado");
});

Deno.test("lead sem Negócio no funil rende etapa VAZIA, não a etapa velha do espelho", async () => {
  const sb = fakeSupabase({ entries: [] });

  const texto = await resolveVariables(sb, leadNovo(), "[{{estagio}}]");

  assertEquals(texto, "[]");
});

Deno.test("org sem o funil também rende vazio, sem estourar o envio", async () => {
  const sb = fakeSupabase({ semFunil: true });

  const texto = await resolveVariables(sb, leadNovo(), "[{{estagio}}]");

  assertEquals(texto, "[]");
});

Deno.test("a query de leads NÃO pede pipe_whatsapp — o espelho não é lido aqui", async () => {
  const capturaSelect: string[] = [];
  const sb = fakeSupabase({
    entries: [{ id: "e1", lead_id: "l1", stage_key: "novo", closed_at: null }],
    capturaSelect,
  });

  await resolveVariables(sb, leadNovo(), "{{estagio}} {{nome}}");

  // Toda leitura de `leads` neste caminho, não só a primeira: basta uma pedir a
  // coluna para o espelho voltar a ser fonte.
  assertEquals(capturaSelect.length > 0, true);
  for (const cols of capturaSelect) {
    assertEquals(cols.includes("pipe_whatsapp"), false);
  }
  // E continua pedindo o que a personalização precisa.
  assertStringIncludes(capturaSelect[0], "organization_id");
  assertStringIncludes(capturaSelect[0], "name");
});

Deno.test("template sem variável não vai ao banco", async () => {
  const sb = {
    from() {
      throw new Error("não deveria consultar o banco sem variável no template");
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  assertEquals(await resolveVariables(sb, "l1", "Bom dia!"), "Bom dia!");
});
