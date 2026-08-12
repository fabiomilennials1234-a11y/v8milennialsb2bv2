/**
 * O gate de `deal_manual_only` dentro de `upsertPipeEntryDetailed`.
 *
 * ADR-0023 decisão 3 proíbe CRIAR Negócio por ingest/integração/automação — não
 * proíbe MOVER. Toda a correção mora nessa distinção, e é ela que estes testes
 * travam: com a flag ligada, o ramo de INSERT some e o de UPDATE continua
 * intacto. Se alguém "simplificar" o gate para o topo da função, o Copilot para
 * de mover cards que já existem e ninguém descobre por uma tela.
 */
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertPipeEntry, upsertPipeEntryDetailed } from "./pipeline-adapter.ts";
import { __resetDealPolicyCache } from "./deal-policy.ts";

type Row = Record<string, unknown>;

interface QueryResult {
  data: Row | Row[] | null;
  error: { message: string } | null;
}

interface FakeState {
  manualOnly: boolean;
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
 * Fake do PostgREST cobrindo as três tabelas do caminho: `pipelines`
 * (resolvePipelineId), `organizations` (isDealManualOnly) e `pipeline_entries`
 * (leitura + escrita). `readPipeEntries` termina em `.limit()`, o update em
 * `.eq()`, e o insert em `.single()` — daí o builder ser encadeável E aguardável.
 */
function fakeSupabase(state: FakeState): SupabaseClient {
  const build = (table: string): FakeBuilder => {
    let mode: "select" | "insert" | "update" = "select";
    let pending: Row = {};
    let lastEqId = "";

    const resolve = (): QueryResult => {
      if (table === "pipelines") return { data: { id: "pipe-1" }, error: null };
      if (table === "organizations") {
        return {
          data: { feature_flags: state.manualOnly ? { deal_manual_only: true } : {} },
          error: null,
        };
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
  return { manualOnly: false, entries: [], inserted: [], updated: [], ...over };
}

/**
 * `resolvePipelineId` tem cache module-level por `${orgId}:${slug}`. Cada teste
 * usa uma org distinta para não herdar o pipeline resolvido do teste anterior —
 * e `__resetDealPolicyCache` zera o cache da flag pelo mesmo motivo.
 */
function org(name: string): string {
  __resetDealPolicyCache();
  return `org-${name}`;
}

Deno.test("flag OFF + sem entry → CRIA o Negócio (comportamento histórico intacto)", async () => {
  const state = makeState();
  const result = await upsertPipeEntryDetailed(fakeSupabase(state), {
    leadId: "lead-1", orgId: org("off-cria"), slug: "whatsapp", stageKey: "novo",
  });
  assertEquals(result.status, "created");
  assertEquals(state.inserted.length, 1);
});

Deno.test("flag ON + sem entry → NÃO cria, e diz por quê", async () => {
  const state = makeState({ manualOnly: true });
  const result = await upsertPipeEntryDetailed(fakeSupabase(state), {
    leadId: "lead-1", orgId: org("on-nao-cria"), slug: "whatsapp", stageKey: "novo",
  });
  assertEquals(result.status, "skipped_deal_manual_only");
  assertEquals(state.inserted.length, 0);
});

Deno.test("flag ON + entry EXISTENTE → move normalmente (decisão 3 proíbe criar, não mover)", async () => {
  const state = makeState({
    manualOnly: true,
    entries: [{ id: "entry-1", lead_id: "lead-1", stage_key: "novo", closed_at: null, metadata: {} }],
  });
  const result = await upsertPipeEntryDetailed(fakeSupabase(state), {
    leadId: "lead-1", orgId: org("on-move"), slug: "whatsapp", stageKey: "agendado",
  });
  assertEquals(result.status, "updated");
  assertEquals(state.updated.length, 1);
  assertEquals(state.updated[0].payload.stage_key, "agendado");
  assertEquals(state.inserted.length, 0);
});

Deno.test("upsertPipeEntry (assinatura fina) devolve null no skip — nunca um id falso", async () => {
  const state = makeState({ manualOnly: true });
  // 34 call sites usam esta forma. Devolver sentinela em vez de null faria
  // `pipe_proposta_items.pipe_proposta_id` apontar para nada.
  const id = await upsertPipeEntry(fakeSupabase(state), {
    leadId: "lead-1", orgId: org("on-null"), slug: "propostas", stageKey: "enviada",
  });
  assertEquals(id, null);
  assertEquals(state.inserted.length, 0);
});

Deno.test("upsertPipeEntry devolve o id quando cria de verdade", async () => {
  const state = makeState();
  const id = await upsertPipeEntry(fakeSupabase(state), {
    leadId: "lead-1", orgId: org("off-id"), slug: "confirmacao", stageKey: "reuniao_marcada",
  });
  assertEquals(id, "entry-nova");
});
