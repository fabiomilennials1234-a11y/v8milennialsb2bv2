/**
 * executeMoveEntryStage (SCRUM-628).
 *
 * Executor do auto-avanço novo: move O NEGÓCIO lido no turn (entry_id) em
 * qualquer funil, move-only (ADR-0023 §3 — nunca upsert). A resolução de refs
 * do advance_stage vive no moveStage compartilhado (SCRUM-627).
 */

import { describe, it, expect } from "vitest";
import "../../helpers/deno-mock";
import { executeMoveEntryStage } from "../../../supabase/functions/_shared/actions/move-card.ts";

/** Query-recorder no estilo do tool-executor.test — thenable, com resultado por tabela. */
function mockSupabase(results: Record<string, unknown> = {}) {
  const queries: Array<{ table: string; filters: [string, unknown][] } & Record<string, unknown>> = [];
  const from = (table: string) => {
    const q: { table: string; filters: [string, unknown][] } & Record<string, unknown> = {
      table,
      filters: [] as [string, unknown][],
    };
    queries.push(q);
    // deno-lint-ignore no-explicit-any equivalente não existe aqui; o builder é
    // deliberadamente dinâmico — tipagem estrutural mínima:
    const b: Record<string, (...args: never[]) => unknown> & { then?: unknown } = {
      select: () => b,
      update: (vals: unknown) => { q.update = vals; return b; },
      insert: (vals: unknown) => { q.insert = vals; return b; },
      upsert: (vals: unknown) => { q.upsert = vals; return b; },
      eq: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve({ data: results[table] ?? null, error: null }),
      single: () => Promise.resolve({ data: results[table] ?? null, error: results[table] ? null : { message: "not found" } }),
      then: (resolve: (r: unknown) => unknown) => resolve({ data: results[table] ?? [], error: null }),
    };
    return b;
  };
  return { sb: { from } as never, queries };
}

const ORG = "org-1";
const ENTRY = {
  id: "entry-1", organization_id: ORG, lead_id: "lead-1", pipeline_id: "pipe-x", stage_key: "entrada",
};
const STAGES = [
  { id: "st-entrada", stage_key: "entrada" },
  { id: "st-contato", stage_key: "contato_feito" },
];

describe("executeMoveEntryStage", () => {
  it("move a entry por id, validando a etapa contra as ativas do funil dela", async () => {
    const { sb, queries } = mockSupabase({ pipeline_entries: ENTRY, pipeline_stages: STAGES });
    const result = await executeMoveEntryStage(sb, {
      entry_id: "entry-1", lead_id: "lead-1", new_stage: "contato_feito", stage_id: "st-contato",
    }, ORG);

    expect(result.success).toBe(true);
    expect(result.data?.target_stage).toBe("contato_feito");
    const upd = queries.find((x) => x.table === "pipeline_entries" && x.update)!;
    expect(upd.update).toMatchObject({ stage_key: "contato_feito" });
    expect(upd.filters).toContainEqual(["id", "entry-1"]);
    // Move-only: nenhum insert/upsert em lugar nenhum (§3).
    expect(queries.some((x) => x.insert || x.upsert)).toBe(false);
  });

  it("negócio que sumiu entre enfileirar e executar → erro claro, nada escrito", async () => {
    const { sb, queries } = mockSupabase({ pipeline_stages: STAGES });
    const result = await executeMoveEntryStage(sb, { entry_id: "entry-morta", new_stage: "x" }, ORG);
    expect(result.success).toBe(false);
    expect(queries.some((x) => x.update || x.insert || x.upsert)).toBe(false);
  });

  it("entry de outra org é recusada (defesa em profundidade, service-role)", async () => {
    const { sb } = mockSupabase({
      pipeline_entries: { ...ENTRY, organization_id: "org-EVIL" },
      pipeline_stages: STAGES,
    });
    const result = await executeMoveEntryStage(sb, { entry_id: "entry-1", new_stage: "contato_feito" }, ORG);
    expect(result.success).toBe(false);
    expect(result.error).toContain("outra organização");
  });

  it("etapa que não é ativa do funil → recusa (nunca mover para etapa fantasma)", async () => {
    const { sb } = mockSupabase({ pipeline_entries: ENTRY, pipeline_stages: STAGES });
    const result = await executeMoveEntryStage(sb, { entry_id: "entry-1", new_stage: "fantasma" }, ORG);
    expect(result.success).toBe(false);
  });

  it("já na etapa de destino → sucesso idempotente sem escrita", async () => {
    const { sb, queries } = mockSupabase({ pipeline_entries: ENTRY, pipeline_stages: STAGES });
    const result = await executeMoveEntryStage(sb, { entry_id: "entry-1", new_stage: "entrada" }, ORG);
    expect(result.success).toBe(true);
    expect(queries.some((x) => x.update)).toBe(false);
  });
});
