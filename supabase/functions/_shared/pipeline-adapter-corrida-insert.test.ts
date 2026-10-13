/**
 * `upsertPipeEntryDetailed` perdendo a corrida do INSERT.
 *
 * Webhook e workflow de "lead criado" leem "sem card" ao mesmo tempo e os dois
 * inserem. Desde 20271119000000 o índice `uq_pipeline_entries_um_card_sem_negocio`
 * recusa o segundo com 23505. O adapter tem de reler e ANDAR com o card de quem
 * ganhou — não devolver `write_failed`, que vira `success:false` na ação.
 *
 * E só uma volta: se a releitura também perder, falha em vez de girar.
 */
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertPipeEntryDetailed } from "./pipeline-adapter.ts";

type Row = Record<string, unknown>;

interface QueryResult {
  data: Row | Row[] | null;
  error: { message: string; code?: string } | null;
}

const UNIQUE_VIOLATION = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "uq_pipeline_entries_um_card_sem_negocio"',
};

interface FakeState {
  /** Leituras sucessivas de pipeline_entries, uma por chamada. */
  leituras: Row[][];
  /** Resultado de cada INSERT, em ordem. */
  inserts: QueryResult[];
  inserted: Row[];
  updated: { id: string; payload: Row }[];
}

function fakeSupabase(state: FakeState): SupabaseClient {
  const build = (table: string) => {
    let mode: "select" | "insert" | "update" = "select";
    let pending: Row = {};
    let lastEqId = "";

    const resolve = (): QueryResult => {
      if (table === "pipelines") {
        return {
          data: { id: "pipe-1", slug: "whatsapp", name: "Oportunidades", type: "system", is_active: true },
          error: null,
        };
      }
      if (table === "pipeline_entries") {
        if (mode === "insert") {
          state.inserted.push(pending);
          return state.inserts.shift() ?? { data: { id: "entry-nova" }, error: null };
        }
        if (mode === "update") {
          state.updated.push({ id: lastEqId, payload: pending });
          return { data: null, error: null };
        }
        return { data: state.leituras.shift() ?? [], error: null };
      }
      return { data: null, error: null };
    };

    // deno-lint-ignore no-explicit-any
    const builder: any = {
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
      then: (onOk: (r: QueryResult) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onOk, onErr),
    };
    return builder;
  };
  return { from: build } as unknown as SupabaseClient;
}

const params = { leadId: "lead-1", orgId: "org-1", slug: "whatsapp", stageKey: "qualificado" } as const;

Deno.test("23505 no insert: relê e anda com o card de quem ganhou a corrida", async () => {
  const state: FakeState = {
    leituras: [
      [], // a nossa leitura: ainda não há card
      [{ id: "entry-do-workflow", stage_key: "novo_lead", metadata: {}, closed_at: null }],
    ],
    inserts: [{ data: null, error: UNIQUE_VIOLATION }],
    inserted: [],
    updated: [],
  };

  const result = await upsertPipeEntryDetailed(fakeSupabase(state), params);

  assertEquals(result, { status: "updated", entryId: "entry-do-workflow" });
  assertEquals(state.inserted.length, 1);
  assertEquals(state.updated.map((u) => [u.id, u.payload.stage_key]), [["entry-do-workflow", "qualificado"]]);
});

Deno.test("23505 de novo na segunda volta: falha, não gira", async () => {
  const state: FakeState = {
    leituras: [[], []],
    inserts: [
      { data: null, error: UNIQUE_VIOLATION },
      { data: null, error: UNIQUE_VIOLATION },
    ],
    inserted: [],
    updated: [],
  };

  const result = await upsertPipeEntryDetailed(fakeSupabase(state), params);

  assertEquals(result, { status: "write_failed" });
  assertEquals(state.inserted.length, 2);
});

Deno.test("outro erro de insert não é tratado como corrida", async () => {
  const state: FakeState = {
    leituras: [[]],
    inserts: [{ data: null, error: { code: "23503", message: "fk" } }],
    inserted: [],
    updated: [],
  };

  const result = await upsertPipeEntryDetailed(fakeSupabase(state), params);

  assertEquals(result, { status: "write_failed" });
  assertEquals(state.inserted.length, 1);
});
