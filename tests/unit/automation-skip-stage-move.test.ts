/* eslint-disable @typescript-eslint/no-explicit-any -- dublês de Supabase/OpenRouter: forma estrutural, não tipada */
/**
 * executeAutomation × ADVANCE_STAGE explícito do mesmo turno.
 *
 * A automação (onQualify/onDisqualify/onNeedHuman com moveToStage/moveToPipe)
 * e o advance_stage do turno vão para a fila sem ordem garantida no claim. Com
 * `skip_stage_move` no payload (o engine põe quando o plano tem ADVANCE_STAGE)
 * a automação não move card de funil — a etapa escolhida no turno vence. O
 * resto da automação (ai_disabled, tags, notificação) segue.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal("Deno", { env: { get: () => undefined, toObject: () => ({}) }, serve: () => {} });

vi.mock("../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  upsertPipeEntry: vi.fn(async () => ({})),
  upsertPipeEntryDetailed: vi.fn(async () => ({ status: "updated" })),
  deletePipeEntry: vi.fn(async () => {}),
  resolveActiveStageKey: vi.fn(async (_s: unknown, _o: unknown, _p: unknown, requested: string) => requested),
  tryResolvePipelineId: vi.fn(async () => "pipe-target-uuid"),
}));
vi.mock("../../supabase/functions/_shared/lead-service.ts", () => ({
  promoveShadowLead: vi.fn(async () => false),
}));

import { executeAutomation } from "../../supabase/functions/_shared/actions/qualify-lead.ts";
import {
  deletePipeEntry,
  upsertPipeEntry,
  upsertPipeEntryDetailed,
} from "../../supabase/functions/_shared/pipeline-adapter.ts";

const ORG = "org-1";
const LEAD = "lead-1";

function fakeSupabase() {
  const updates: Array<{ table: string; payload: unknown }> = [];
  const chain: any = {};
  for (const m of ["select", "eq", "maybeSingle", "single", "insert", "upsert"]) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: any) => resolve({ data: { id: "tag-1", name: "Ana" }, error: null });
  const client: any = {
    from: vi.fn((table: string) => ({
      ...chain,
      update: vi.fn((payload: unknown) => { updates.push({ table, payload }); return chain; }),
    })),
  };
  return { client, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("executeAutomation — skip_stage_move", () => {
  it("need_human + moveToStage SEM skip → move o card (controle)", async () => {
    const { client } = fakeSupabase();
    const r = await executeAutomation(client, {
      action_type: "need_human", action_config: { moveToStage: "atendimento_humano" }, pipeline_ref: "vendas",
    }, ORG, LEAD);
    expect(r.success).toBe(true);
    expect(upsertPipeEntryDetailed).toHaveBeenCalledTimes(1);
  });

  it("need_human + moveToStage COM skip → não move; ai_disabled continua sendo gravado", async () => {
    const { client, updates } = fakeSupabase();
    const r = await executeAutomation(client, {
      action_type: "need_human", action_config: { moveToStage: "atendimento_humano", addTags: ["quente"] },
      pipeline_ref: "vendas", skip_stage_move: true,
    }, ORG, LEAD);
    expect(r.success).toBe(true);
    expect(upsertPipeEntryDetailed).not.toHaveBeenCalled();
    expect(upsertPipeEntry).not.toHaveBeenCalled();
    expect(updates.find((u) => u.table === "leads")?.payload).toMatchObject({ ai_disabled: true });
    expect(client.from).toHaveBeenCalledWith("lead_tags");
  });

  it("qualify + moveToStage COM skip → não move", async () => {
    const { client } = fakeSupabase();
    await executeAutomation(client, {
      action_type: "qualify", action_config: { moveToStage: "qualificado" }, pipeline_ref: "vendas", skip_stage_move: true,
    }, ORG, LEAD);
    expect(upsertPipeEntryDetailed).not.toHaveBeenCalled();
  });

  it("disqualify + moveToPipe (funil) COM skip → não cria nem apaga entry", async () => {
    const { client } = fakeSupabase();
    await executeAutomation(client, {
      action_type: "disqualify", action_config: { moveToPipe: { pipe: "pos_venda", stage: "perdido" } },
      pipeline_ref: "vendas", skip_stage_move: true,
    }, ORG, LEAD);
    expect(upsertPipeEntry).not.toHaveBeenCalled();
    expect(deletePipeEntry).not.toHaveBeenCalled();
  });

  it("disqualify + moveToPipe (funil) SEM skip → move (controle)", async () => {
    const { client } = fakeSupabase();
    await executeAutomation(client, {
      action_type: "disqualify", action_config: { moveToPipe: { pipe: "pos_venda", stage: "perdido" } }, pipeline_ref: "vendas",
    }, ORG, LEAD);
    expect(upsertPipeEntry).toHaveBeenCalledTimes(1);
    expect(deletePipeEntry).toHaveBeenCalledTimes(1);
  });

  it("skip_stage_move só vale com true literal (string 'true' não desliga o move)", async () => {
    const { client } = fakeSupabase();
    await executeAutomation(client, {
      action_type: "need_human", action_config: { moveToStage: "atendimento_humano" }, pipeline_ref: "vendas", skip_stage_move: "true",
    }, ORG, LEAD);
    expect(upsertPipeEntryDetailed).toHaveBeenCalledTimes(1);
  });
});
