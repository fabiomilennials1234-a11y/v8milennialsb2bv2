/**
 * `upsertPipeEntryDetailed` cria posição no funil SEM consultar política por
 * organização.
 *
 * Esta suíte nasceu travando o gate de `deal_manual_only` (ADR-0023 decisão 3).
 * O gate foi removido em #1774 — pelo ADR-0030 §2 quem autoriza a criação é a
 * ferramenta que chamou (Workflow ativo, chave de API escopada), não uma flag na
 * organização. Os casos continuam aqui, virados do avesso: agora eles provam que
 * a criação é INCONDICIONAL, e ficam vermelhos se alguém reintroduzir uma leitura
 * de flag no caminho do INSERT.
 *
 * O que NÃO mudou, e a suíte segue guardando: a distinção entre criar e mover.
 * O ramo de UPDATE nunca dependeu de política, e continua movendo card que já
 * existe.
 */
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertPipeEntry, upsertPipeEntryDetailed } from "./pipeline-adapter.ts";

type Row = Record<string, unknown>;

interface QueryResult {
  data: Row | Row[] | null;
  error: { message: string } | null;
}

interface FakeState {
  /** `true` se o adapter consultou `organizations` — não deve consultar. */
  leuOrganizations?: boolean;
  /**
   * O que `organizations.feature_flags` devolve. Fica no fake de propósito: é
   * assim que se prova que o adapter NÃO lê mais a flag — mesmo com
   * `deal_manual_only: true` na linha da org, o INSERT acontece.
   */
  flagsDaOrg: Row;
  entries: Row[];
  inserted: Row[];
  updated: { id: string; payload: Row }[];
}

interface FakeBuilder {
  select: (columns?: string) => FakeBuilder;
  eq: (column?: string, value?: string) => FakeBuilder;
  in: () => FakeBuilder;
  order: () => FakeBuilder;
  limit: () => Promise<QueryResult>;
  maybeSingle: () => Promise<QueryResult>;
  single: () => Promise<QueryResult>;
  insert: (row: Row) => FakeBuilder;
  update: (row: Row) => FakeBuilder;
  /** Aguardável em qualquer ponto — o ramo de UPDATE termina em `.eq()`. */
  then: <T>(onOk: (r: QueryResult) => T, onErr?: (e: unknown) => T) => Promise<T>;
}

/**
 * Fake do PostgREST cobrindo o caminho: `pipelines` (resolvePipelineId),
 * `organizations` (ninguém deveria mais tocar) e `pipeline_entries` (leitura +
 * escrita). `readPipeEntries` termina em `.limit()`, o update em `.eq()`, e o
 * insert em `.single()` — daí o builder ser encadeável E aguardável.
 *
 * `state.leuOrganizations` registra se o adapter foi buscar a linha da org: é o
 * controle positivo da remoção do gate.
 */
function fakeSupabase(state: FakeState): SupabaseClient {
  const build = (table: string): FakeBuilder => {
    let mode: "select" | "insert" | "update" = "select";
    let pending: Row = {};
    let lastEqId = "";

    const resolve = (): QueryResult => {
      if (table === "pipelines") return { data: { id: "pipe-1" }, error: null };
      if (table === "organizations") {
        state.leuOrganizations = true;
        return { data: { feature_flags: state.flagsDaOrg }, error: null };
      }
      if (table === "pipeline_entries") {
        if (mode === "insert") {
          state.inserted.push(pending);
          return { data: { id: "entry-nova" }, error: null };
        }
        if (mode === "update") {
          state.updated.push({ id: lastEqId, payload: pending });
          return { data: null, error: null };
        }
        return { data: state.entries, error: null };
      }
      return { data: null, error: null };
    };

    const builder: FakeBuilder = {
      select: () => builder,
      eq: (column?: string, value?: string) => {
        if (column === "id" && value) lastEqId = value;
        return builder;
      },
      in: () => builder,
      order: () => builder,
      limit: () => Promise.resolve(resolve()),
      maybeSingle: () => Promise.resolve(resolve()),
      single: () => Promise.resolve(resolve()),
      insert: (row: Row) => {
        mode = "insert";
        pending = row;
        return builder;
      },
      update: (row: Row) => {
        mode = "update";
        pending = row;
        return builder;
      },
      then: (onOk, onErr) => Promise.resolve(resolve()).then(onOk, onErr),
    };
    return builder;
  };

  return { from: (table: string) => build(table) } as unknown as SupabaseClient;
}

function makeState(over: Partial<FakeState> = {}): FakeState {
  return { flagsDaOrg: {}, entries: [], inserted: [], updated: [], leuOrganizations: false, ...over };
}

/**
 * `resolvePipelineId` tem cache module-level por `${orgId}:${slug}`. Cada teste
 * usa uma org distinta para não herdar o pipeline resolvido do teste anterior.
 */
function org(name: string): string {
  return `org-${name}`;
}

Deno.test("sem entry → CRIA a posição no funil", async () => {
  const state = makeState();
  const result = await upsertPipeEntryDetailed(fakeSupabase(state), {
    leadId: "lead-1", orgId: org("cria"), slug: "whatsapp", stageKey: "novo",
  });
  assertEquals(result.status, "created");
  assertEquals(state.inserted.length, 1);
});

Deno.test("#1774: org com deal_manual_only ainda ligada na linha → CRIA do mesmo jeito", async () => {
  // O gate morreu. Se voltar, este caso fica vermelho — é a razão de a flag
  // continuar no fake.
  const state = makeState({ flagsDaOrg: { deal_manual_only: true } });
  const result = await upsertPipeEntryDetailed(fakeSupabase(state), {
    leadId: "lead-1", orgId: org("flag-ignorada"), slug: "whatsapp", stageKey: "novo",
  });
  assertEquals(result.status, "created");
  assertEquals(state.inserted.length, 1);
});

Deno.test("#1774: o adapter não consulta mais `organizations` no caminho do INSERT", async () => {
  // Controle positivo da remoção: o fake grava a leitura. Uma query por lead num
  // import de milhares de linhas era o custo que o cache de 30s existia para
  // amortizar — sem gate, não há query nenhuma a amortizar.
  const state = makeState();
  await upsertPipeEntryDetailed(fakeSupabase(state), {
    leadId: "lead-1", orgId: org("sem-query-de-org"), slug: "whatsapp", stageKey: "novo",
  });
  assertEquals(state.leuOrganizations, false);
});

Deno.test("entry EXISTENTE → move (criar e mover seguem sendo caminhos distintos)", async () => {
  const state = makeState({
    entries: [{ id: "entry-1", lead_id: "lead-1", stage_key: "novo", closed_at: null, metadata: {} }],
  });
  const result = await upsertPipeEntryDetailed(fakeSupabase(state), {
    leadId: "lead-1", orgId: org("move"), slug: "whatsapp", stageKey: "agendado",
  });
  assertEquals(result.status, "updated");
  assertEquals(state.updated.length, 1);
  assertEquals(state.updated[0].payload.stage_key, "agendado");
  assertEquals(state.inserted.length, 0);
});

Deno.test("upsertPipeEntry (assinatura fina) devolve o id quando cria", async () => {
  const state = makeState();
  const id = await upsertPipeEntry(fakeSupabase(state), {
    leadId: "lead-1", orgId: org("id"), slug: "confirmacao", stageKey: "reuniao_marcada",
  });
  assertEquals(id, "entry-nova");
  assertEquals(state.inserted.length, 1);
});
