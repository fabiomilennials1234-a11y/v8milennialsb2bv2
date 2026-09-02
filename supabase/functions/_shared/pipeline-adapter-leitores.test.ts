/* eslint-disable @typescript-eslint/no-explicit-any -- Dublê de teste. O cliente Supabase falso é um builder encadeável que devolve a si mesmo; tipá-lo com precisão exigiria enumerar a superfície inteira do SDK sem ganhar segurança nenhuma no teste. A intenção já estava declarada ao linter do Deno (deno-lint-ignore no-explicit-any) — isto diz o mesmo ao ESLint, que também passou a ler estes arquivos. */
/**
 * Leitores do Negócio — o achatamento N→1, um por um e em lote.
 *
 * Fecha `inv:H4-07`. Depois do M1 (queda dos três cadeados) um lead pode ter
 * MAIS DE UM Negócio no mesmo funil. Todo leitor precisa então responder a
 * mesma pergunta — "qual dos N?" — e responder IGUAL, senão o Copilot lê uma
 * etapa, o workflow lê outra, e a divergência aparece como mensagem com etapa
 * errada, não como erro.
 *
 * O critério é `pickActiveEntry`: **a aberta ganha; empatou, a primeira da
 * ordem do SQL** (`closed_at` nulls first, depois `stage_changed_at`,
 * `created_at`, `id` — todos descendentes). O que se prova aqui é que
 * `getPipeEntry` (um lead) e `getPipeEntriesByLeads` (lote) aplicam esse mesmo
 * critério, e que a degradação é silenciosa para o lado seguro: leitura que
 * falha devolve "sem entry" em vez de estourar num caminho de leitura.
 */

import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { getPipeEntry, getPipeEntriesByLeads } from "./pipeline-adapter.ts";

interface Linha {
  id: string;
  lead_id: string;
  stage_key: string;
  closed_at: string | null;
}

/**
 * Fake do query builder. `pipeline_entries` devolve as linhas NA ORDEM em que
 * o teste as escreve — que é o contrato real: quem ordena é o Postgres, e
 * `pickActiveEntry` depende dessa ordem já vir pronta.
 */
// deno-lint-ignore no-explicit-any
function fakeSupabase(opts: {
  pipelineId?: string | null;
  entries?: Linha[];
  erro?: boolean;
}): any {
  return {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () =>
          Promise.resolve(
            opts.pipelineId === null
              ? { data: null, error: { message: "sem funil" } }
              : {
                data: {
                  id: opts.pipelineId ?? "pipe-1",
                  slug: "whatsapp",
                  name: "Oportunidades",
                  type: "system",
                  is_active: true,
                },
                error: null,
              },
          ),
        then: (resolve: (v: { data: Linha[] | null; error: unknown }) => unknown) =>
          resolve(
            opts.erro
              ? { data: null, error: { message: "boom" } }
              : { data: opts.entries ?? [], error: null },
          ),
      };
      if (table !== "pipelines" && table !== "pipeline_entries") {
        throw new Error(`tabela inesperada no leitor: ${table}`);
      }
      return builder;
    },
  };
}

const ABERTA = (id: string, lead: string, stage: string): Linha => ({
  id,
  lead_id: lead,
  stage_key: stage,
  closed_at: null,
});
const FECHADA = (id: string, lead: string, stage: string, quando = "2026-01-01"): Linha => ({
  id,
  lead_id: lead,
  stage_key: stage,
  closed_at: quando,
});

// Cada caso usa um org diferente: `resolvePipelineId` guarda cache de módulo
// por `org:slug`, e reaproveitar org faria um caso herdar o funil do anterior.
let n = 0;
const org = () => `org-${++n}`;

Deno.test("getPipeEntry — com uma só entry, devolve ela", async () => {
  const sb = fakeSupabase({ entries: [ABERTA("e1", "l1", "agendado")] });

  const entry = await getPipeEntry(sb, "l1", org(), "whatsapp");

  assertEquals(entry?.stage_key, "agendado");
});

Deno.test("getPipeEntry — com N, a ABERTA ganha, mesmo não sendo a primeira", async () => {
  const sb = fakeSupabase({
    entries: [FECHADA("e1", "l1", "perdido"), ABERTA("e2", "l1", "respondeu")],
  });

  const entry = await getPipeEntry(sb, "l1", org(), "whatsapp");

  assertEquals(entry?.id, "e2");
  assertEquals(entry?.stage_key, "respondeu");
});

Deno.test("getPipeEntry — todas fechadas: a primeira da ordem do SQL", async () => {
  const sb = fakeSupabase({
    entries: [FECHADA("e9", "l1", "vendido", "2026-06-01"), FECHADA("e8", "l1", "perdido", "2026-01-01")],
  });

  const entry = await getPipeEntry(sb, "l1", org(), "whatsapp");

  assertEquals(entry?.id, "e9");
});

Deno.test("getPipeEntry — sem entry nenhuma devolve null", async () => {
  const sb = fakeSupabase({ entries: [] });

  assertEquals(await getPipeEntry(sb, "l1", org(), "whatsapp"), null);
});

Deno.test("getPipeEntry — org sem o funil devolve null, sem tentar ler entries", async () => {
  const sb = fakeSupabase({ pipelineId: null });

  assertEquals(await getPipeEntry(sb, "l1", org(), "whatsapp"), null);
});

Deno.test("getPipeEntry — leitura que falha degrada para null (caminho de leitura não estoura)", async () => {
  const sb = fakeSupabase({ erro: true });

  assertEquals(await getPipeEntry(sb, "l1", org(), "whatsapp"), null);
});

Deno.test("getPipeEntriesByLeads — um por lead, com o MESMO critério do leitor unitário", async () => {
  const sb = fakeSupabase({
    entries: [
      // l1 tem duas: a aberta tem que ganhar
      FECHADA("a1", "l1", "perdido"),
      ABERTA("a2", "l1", "abordado"),
      // l2 tem só uma
      ABERTA("b1", "l2", "novo"),
      // l3 tem duas, ambas fechadas: vale a primeira da ordem
      FECHADA("c1", "l3", "vendido", "2026-06-01"),
      FECHADA("c2", "l3", "perdido", "2026-01-01"),
    ],
  });

  const linhas = await getPipeEntriesByLeads(sb, ["l1", "l2", "l3"], org(), "whatsapp");

  assertEquals(linhas.length, 3);
  assertEquals(linhas.find((e) => e.lead_id === "l1")?.id, "a2");
  assertEquals(linhas.find((e) => e.lead_id === "l2")?.id, "b1");
  assertEquals(linhas.find((e) => e.lead_id === "l3")?.id, "c1");
});

Deno.test("getPipeEntriesByLeads — lista vazia sai na hora, sem ir ao banco", async () => {
  const sb = {
    from() {
      throw new Error("não deveria consultar o banco com lista vazia");
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  assertEquals(await getPipeEntriesByLeads(sb, [], "org-x", "whatsapp"), []);
});

Deno.test("getPipeEntriesByLeads — erro de leitura devolve lista vazia, não meia lista", async () => {
  const sb = fakeSupabase({ erro: true });

  assertEquals(await getPipeEntriesByLeads(sb, ["l1", "l2"], org(), "whatsapp"), []);
});

Deno.test("getPipeEntriesByLeads — lead sem entry simplesmente não aparece", async () => {
  const sb = fakeSupabase({ entries: [ABERTA("z1", "l1", "novo")] });

  const linhas = await getPipeEntriesByLeads(sb, ["l1", "l2"], org(), "whatsapp");

  assertEquals(linhas.length, 1);
  assertEquals(linhas[0].lead_id, "l1");
});
