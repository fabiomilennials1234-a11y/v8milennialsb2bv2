// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";
import { executeWorkflow } from "../../supabase/functions/_shared/workflow-executor";
import * as legacyMove from "../../supabase/functions/_shared/action-handlers/move-stage";

type ExecutionParams = Parameters<typeof executeWorkflow>[0];
const rollout = readFileSync(new URL("../../scripts/rollouts/riofix-20261002/riofix-archived-reply.sql", import.meta.url), "utf8");
const encodedDefinition = rollout.match(/\$definition\$([\s\S]*?)\$definition\$/)?.[1];
if (!encodedDefinition) throw new Error("Definição do rollout Riofix não encontrada");
const definition: ExecutionParams["definition"] = JSON.parse(encodedDefinition);
const org = "36971ff5-fd73-4f30-a733-04bf8c90e5b6";
const pipeline = "a9a2f3cb-63fe-4ca1-a453-f27002cc4944";
const workflow = "9dd137e9-e6cb-4ca2-8351-975a0982ecaf";
const lead = "11111111-1111-4111-8111-111111111111";
const exactEntry = "22222222-2222-4222-8222-222222222222";
const neighborEntry = "33333333-3333-4333-8333-333333333333";
const deal = "44444444-4444-4444-8444-444444444444";
const rpcName = "workflow_move_custom_entry_safely";
const stages = [
  ["novo_lead", "29949eb4-f241-4d0f-abcd-4000350601d9"],
  ["esperando_resposta", "90dfc706-6e1b-42f6-994e-536ff2b82b10"],
  ["sem_resposta", "93f7b170-1064-44fc-9f25-f95c1e46d2ae"],
  ["futuro", "383e8362-f876-4412-bc13-beca2e4195a5"],
  ["proposta", "70d2ac81-d1e7-4636-b7b7-405dfc78bde4"],
  ["conversando", "8a923b49-de12-4a79-b133-d08855aa8ce4"],
];

interface RpcResponse {
  data: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
}

const moved: RpcResponse = { data: { status: "moved", entry_id: exactEntry, stage_key: "conversando" }, error: null };
const fetchProvider = vi.fn(() => { throw new Error("O retorno do arquivado não pode chamar um provedor"); });

beforeEach(() => {
  // Só observa o caminho legado: sua implementação não é substituída.
  vi.spyOn(legacyMove, "moveStage");
  vi.stubGlobal("fetch", fetchProvider);
  fetchProvider.mockClear();
});
afterEach(() => {
  expect(fetchProvider).not.toHaveBeenCalled();
  expect(legacyMove.moveStage).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(stageKey = "sem_resposta", responses: RpcResponse[] = [moved]) {
  const db = createMockSupabase();
  const queued = {
    id: "execution", workflow_id: workflow, organization_id: org, lead_id: lead,
    pipeline_entry_id: exactEntry, deal_id: deal, status: "running",
    context: { pipeline_entry_id: exactEntry, deal_id: deal, riofix_archived_reply: true },
  };
  const neighbor = { id: neighborEntry, lead_id: lead, organization_id: org, pipeline_id: pipeline,
    stage_key: "proposta", closed_at: null, created_at: "2026-10-02", stage_changed_at: "2026-10-02" };
  function putStage(key: string) {
    db.mockTable("pipeline_entries", [neighbor, {
      id: exactEntry, deal_id: deal, lead_id: lead, organization_id: org, pipeline_id: pipeline,
      stage_key: key, closed_at: null, created_at: "2026-09-01", stage_changed_at: "2026-09-01",
    }]);
  }
  putStage(stageKey);
  db.mockTable("leads", [{ id: lead, organization_id: org }]);
  db.mockTable("pipeline_stages", stages.map(([stage_key, id]) => ({ id, stage_key, organization_id: org, pipeline_id: pipeline })));
  db.mockTable("deals", [{ id: deal, organization_id: org, source_lead_id: lead, outcome: "open" }]);
  db.mockTable("workflow_executions", [queued]);
  const from = vi.spyOn(db.sb, "from");
  const pending = [...responses];
  let beforeRpc: (() => void) | undefined;
  const rpc = vi.spyOn(db.sb, "rpc").mockImplementation((name: string) => {
    expect(name).toBe(rpcName);
    beforeRpc?.();
    const response = pending.shift();
    if (!response) throw new Error("RPC extra inesperada");
    return Promise.resolve(response);
  });
  const params: ExecutionParams = {
    supabase: db.sb, executionId: queued.id, workflowId: queued.workflow_id,
    organizationId: queued.organization_id, leadId: queued.lead_id,
    // Mesma passagem do worker: identidade na coluna da execução, também presente no context.
    entryId: queued.pipeline_entry_id, dealId: queued.deal_id, context: { ...queued.context },
    definition, loopLimit: 20,
  };
  function assertNoDirectMovementOrSend() {
    expect(db.getUpdated("pipeline_entries")).toEqual([]);
    expect(db.getInserted("whatsapp_messages")).toEqual([]);
    expect(from.mock.calls.some(([table]) => ["negocio_projetado", "pipelines", "whatsapp_instances"].includes(String(table)))).toBe(false);
  }
  return { ...db, rpc, params, putStage, assertNoDirectMovementOrSend,
    beforeRpc: (callback: () => void) => { beforeRpc = callback; } };
}

function expectExactRpc(rpc: ReturnType<typeof setup>["rpc"], times = 1) {
  expect(rpc).toHaveBeenCalledTimes(times);
  for (const call of rpc.mock.calls) expect(call).toEqual([rpcName, {
    p_organization_id: org, p_lead_id: lead, p_entry_id: exactEntry, p_pipeline_id: pipeline,
    p_target_stage: "8a923b49-de12-4a79-b133-d08855aa8ce4",
    p_expected_stage_ids: stages.slice(0, 4).map(([, id]) => id),
  }]);
}

describe("Riofix: grafo publicado de resposta arquivada com executor real", () => {
  it.each(stages.slice(0, 4).map(([key]) => key))("retoma %s pelo negócio enfileirado, mesmo havendo outro mais recente", async stageKey => {
    const db = setup(stageKey);
    expect(await executeWorkflow(db.params)).toMatchObject({ success: true, status: "completed" });
    expectExactRpc(db.rpc);
    expect(db.getInserted("workflow_execution_steps")).toContainEqual(expect.objectContaining({
      node_id: "falando", status: "success", output_data: expect.objectContaining({
        success: true, data: expect.objectContaining({ status: "moved", entry_id: exactEntry }),
      }),
    }));
    db.assertNoDirectMovementOrSend();
  });

  it("preserva avanço manual ocorrido antes de o worker avaliar as condições", async () => {
    const db = setup("proposta");
    expect(await executeWorkflow(db.params)).toMatchObject({ success: true, status: "completed" });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.getInserted("workflow_execution_steps").filter(row => row.node_type === "condition")).toHaveLength(4);
    db.assertNoDirectMovementOrSend();
  });

  it("aceita o skipped atômico quando a etapa avança depois de a condição passar", async () => {
    const db = setup("sem_resposta", [{ data: { status: "skipped", reason: "stage_changed_or_closed", entry_id: exactEntry }, error: null }]);
    db.beforeRpc(() => {
      expect(db.getInserted("workflow_execution_steps")).toContainEqual(expect.objectContaining({
        node_id: "etapa-2", output_data: { result: true },
      }));
      db.putStage("proposta");
    });
    expect(await executeWorkflow(db.params)).toMatchObject({ success: true, status: "completed" });
    expectExactRpc(db.rpc);
    expect(db.getInserted("workflow_execution_steps")).toContainEqual(expect.objectContaining({
      node_id: "falando", status: "success", output_data: expect.objectContaining({
        data: expect.objectContaining({ status: "skipped", reason: "stage_changed_or_closed" }),
      }),
    }));
    db.assertNoDirectMovementOrSend();
  });

  it("reagenda 55P03 e preserva ganho no resume sem cair no movimento legado", async () => {
    const db = setup("sem_resposta", [
      { data: null, error: { code: "55P03", message: "could not obtain lock" } },
      { data: { status: "skipped", reason: "deal_closed_or_missing", entry_id: exactEntry }, error: null },
    ]);
    const before = Date.now();
    expect(await executeWorkflow(db.params)).toMatchObject({ success: true, status: "paused" });
    const { data: saved } = await db.sb.from("workflow_executions").select("*").eq("id", "execution").single();
    expect(saved).toMatchObject({ status: "running", current_node_id: "falando", context: { _retry_counts: { falando: 1 } } });
    expect(Date.parse(saved.next_run_at)).toBeGreaterThanOrEqual(before + 30_000);
    const conditionCount = db.getInserted("workflow_execution_steps").filter(row => row.node_type === "condition").length;
    db.mockTable("deals", [{ id: deal, organization_id: org, source_lead_id: lead, outcome: "won" }]);
    // O resultado do RPC modela o banco após o ganho; o teste SQL verifica esse predicado.
    expect(await executeWorkflow({ ...db.params, entryId: saved.pipeline_entry_id, dealId: saved.deal_id,
      context: saved.context, currentNodeId: saved.current_node_id, loopCounters: saved.loop_counters,
      nextRunAt: saved.next_run_at,
    })).toMatchObject({ success: true, status: "completed" });
    expectExactRpc(db.rpc, 2);
    expect(db.getInserted("workflow_execution_steps").filter(row => row.node_type === "condition")).toHaveLength(conditionCount);
    expect(db.getInserted("workflow_execution_steps")).toContainEqual(expect.objectContaining({
      node_id: "falando", status: "success", output_data: expect.objectContaining({
        retry_attempt: 1, data: expect.objectContaining({ status: "skipped", reason: "deal_closed_or_missing" }),
      }),
    }));
    db.assertNoDirectMovementOrSend();
  });
});
