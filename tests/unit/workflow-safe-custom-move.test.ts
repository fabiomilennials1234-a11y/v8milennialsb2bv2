// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";
import { moveCustomStageSafely } from "../../supabase/functions/_shared/action-handlers/move-stage-safe";
import type { ActionInput } from "../../supabase/functions/_shared/action-handlers/types";

vi.mock("../../supabase/functions/_shared/action-handlers/move-stage.ts", () => ({ moveStage: vi.fn() }));
import { moveStage } from "../../supabase/functions/_shared/action-handlers/move-stage";
import { executeWorkflowAction } from "../../supabase/functions/_shared/workflow-action-handler";

const rpcName = "workflow_move_custom_entry_safely";
function setup() {
  const mock = createMockSupabase();
  const input: ActionInput = {
    supabase: mock.sb, organizationId: "org", leadId: "lead", entryId: "entry", dealId: null,
    conversationId: null,
    params: { target_pipe: "pipe", target_stage: "talking", expected_stage_ids: ["waiting"] },
  };
  return { ...mock, input };
}
beforeEach(() => vi.resetAllMocks());

describe("opt-in exact custom entry movement", () => {
  it("passes the org, lead and exact execution entry to the atomic operation", async () => {
    const m = setup();
    m.mockRpc(rpcName, { status: "moved", entry_id: "entry", stage_key: "talking" });
    expect(await moveCustomStageSafely(m.input)).toMatchObject({ success: true, data: { status: "moved", entry_id: "entry" } });
    expect(m.getRpcCalls()).toEqual([{ name: rpcName, params: {
      p_organization_id: "org", p_lead_id: "lead", p_entry_id: "entry", p_pipeline_id: "pipe",
      p_target_stage: "talking", p_expected_stage_ids: ["waiting"],
    } }]);
    expect(m.getUpdated("pipeline_entries")).toEqual([]);
  });
  it("delegates absent identity to the database's single-entry check", async () => {
    const m = setup();
    m.mockRpc(rpcName, { status: "skipped", reason: "ambiguous_or_missing_entry" });
    expect(await moveCustomStageSafely({ ...m.input, entryId: null })).toMatchObject({ success: true, data: { status: "skipped" } });
    expect(m.getRpcCalls()[0].params).toMatchObject({ p_entry_id: null });
  });
  it.each([{}, { expected_stage_ids: [] }, { expected_stage_ids: [null] }])("fails closed on missing/incompatible configuration %j", async params => {
    const m = setup();
    expect(await moveCustomStageSafely({ ...m.input, params })).toMatchObject({ success: false, retryable: false });
    expect(m.getRpcCalls()).toEqual([]);
  });
  it.each(["22023", "42501", "40P01"])("does not fall back to legacy writes after RPC error %s", async code => {
    const m = setup();
    vi.spyOn(m.sb, "rpc").mockResolvedValue({ data: null, error: { code, message: "failed" } });
    expect(await moveCustomStageSafely(m.input)).toMatchObject({ success: false, retryable: code === "40P01" });
    expect(m.getUpdated("pipeline_entries")).toEqual([]);
    expect(moveStage).not.toHaveBeenCalled();
  });
  it("requires an explicit database outcome", async () => {
    const m = setup(); m.mockRpc(rpcName, {});
    expect(await moveCustomStageSafely(m.input)).toMatchObject({ success: false, retryable: false });
  });
  it.each([undefined, false, "true"])("retains the existing handler unless the flag is boolean true (%s)", async flag => {
    const m = setup();
    vi.mocked(moveStage).mockResolvedValue({ success: true, data: { target_stage: "talking" } });
    await executeWorkflowAction({ supabase: m.sb, organizationId: "org", leadId: "lead", entryId: "entry", executionContext: {},
      nodeData: { actionType: "move_stage", pipelineId: "pipe", targetStage: "talking", safeCustomMove: flag } });
    expect(moveStage).toHaveBeenCalledOnce();
    expect(m.getRpcCalls().filter(x => x.name === rpcName)).toEqual([]);
  });
  it("routes opt-in nodes through the guard and retains a skipped outcome for diagnostics", async () => {
    const m = setup(); m.mockRpc(rpcName, { status: "skipped", reason: "stage_changed_or_closed", entry_id: "entry" });
    const result = await executeWorkflowAction({ supabase: m.sb, organizationId: "org", leadId: "lead", entryId: "entry", executionContext: {},
      nodeData: { actionType: "move_stage", pipelineId: "pipe", targetStage: "talking", safeCustomMove: true, expectedStageIds: ["waiting"] } });
    expect(result).toMatchObject({ success: true, data: { status: "skipped", reason: "stage_changed_or_closed" } });
    expect(moveStage).not.toHaveBeenCalled();
    expect(m.getRpcCalls()[0].params).toMatchObject({ p_entry_id: "entry", p_expected_stage_ids: ["waiting"] });
  });
});
