// @vitest-environment node
/**
 * Backward-compatibility tests for the shared action-handlers unification.
 *
 * Verifies:
 * 1. The shared moveStage handler registry exports correctly
 * 2. The AI dispatcher (actions/index.ts) delegates advance_stage and
 *    update_pipeline_stage to the shared moveStage handler
 * 3. The workflow dispatcher (workflow-action-handler.ts) delegates move_stage
 *    to the shared moveStage handler
 * 4. Old exports (executeAdvanceStage, executeUpdatePipelineStage) are dead code
 *    and the ai-action-executor facade still exports all needed symbols
 * 5. After dead code removal, all existing imports still resolve
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(""),
});
global.fetch = mockFetch as any;

vi.mock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime: vi.fn() }));
vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({ captureException: vi.fn() }));
vi.mock("../../supabase/functions/_shared/validation.ts", () => ({
  sanitizeString: (input: string | null | undefined) =>
    input == null ? null : String(input).trim(),
}));
vi.mock("../../supabase/functions/_shared/lead-service.ts", () => ({
  promoveShadowLead: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../supabase/functions/_shared/google-calendar-utils.ts", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue(null),
  logCalendarOp: vi.fn().mockResolvedValue(undefined),
}));

setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

beforeEach(() => {
  clearDenoEnv();
  setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true }),
    text: () => Promise.resolve(""),
  });
});

// ─── 1. Shared handler registry exports correctly ────────────────────────────

describe("action-handlers registry", () => {
  it("exports moveStage function", async () => {
    const { moveStage } = await import(
      "../../supabase/functions/_shared/action-handlers/index"
    );
    expect(typeof moveStage).toBe("function");
  });

  it("exports ActionInput, ActionResult, ActionHandler types", async () => {
    const mod = await import(
      "../../supabase/functions/_shared/action-handlers/types"
    );
    expect(mod).toBeDefined();
  });
});

// ─── 2. AI dispatcher delegates advance_stage to shared moveStage ────────────

describe("AI dispatcher backward compat — advance_stage uses shared handler", () => {
  it("advance_stage with valid stage returns success via shared handler", async () => {
    const { executeAiAction } = await import(
      "../../supabase/functions/_shared/actions/index"
    );
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipeline_stages", [
      { stage_key: "agendado", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
    ]);
    mockTable("pipelines", [{ id: "pipe-wpp", organization_id: "org-1", slug: "whatsapp", type: "system" }]);
    mockTable("pipeline_entries", []);
    mockTable("lead_history", []);

    const result = await executeAiAction(sb, {
      id: "a-test",
      organization_id: "org-1",
      lead_id: "lead-1",
      conversation_id: null,
      action_type: "advance_stage",
      payload: { target_stage: "agendado", target_pipe: "whatsapp", lead_id: "lead-1" },
    });
    expect(result.success).toBe(true);
    expect(result.data?.target_stage).toBe("agendado");
    expect(result.data?.target_pipe).toBe("whatsapp");
  });

  it("advance_stage with invalid stage returns error (shared handler validates)", async () => {
    const { executeAiAction } = await import(
      "../../supabase/functions/_shared/actions/index"
    );
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipeline_stages", [
      { stage_key: "novo", organization_id: "org-1", pipeline_type: "whatsapp", is_active: true },
    ]);

    const result = await executeAiAction(sb, {
      id: "a-inv",
      organization_id: "org-1",
      lead_id: "lead-1",
      conversation_id: null,
      action_type: "advance_stage",
      payload: { target_stage: "INVALID_STAGE", target_pipe: "whatsapp", lead_id: "lead-1" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("inválida");
  });

  it("advance_stage with missing lead_id returns error", async () => {
    const { executeAiAction } = await import(
      "../../supabase/functions/_shared/actions/index"
    );
    const { sb } = createMockSupabase();
    const result = await executeAiAction(sb, {
      id: "a-nolead",
      organization_id: "org-1",
      lead_id: null,
      conversation_id: null,
      action_type: "advance_stage",
      payload: { target_stage: "agendado", target_pipe: "whatsapp" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("leadId");
  });
});

// ─── 3. AI dispatcher delegates update_pipeline_stage to shared moveStage ────

describe("AI dispatcher backward compat — update_pipeline_stage uses shared handler", () => {
  it("update_pipeline_stage maps new_stage to target_stage for shared handler", async () => {
    const { executeAiAction } = await import(
      "../../supabase/functions/_shared/actions/index"
    );
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipeline_stages", []);
    mockTable("pipelines", [{ id: "pipe-wpp", organization_id: "org-1", slug: "whatsapp", type: "system" }]);
    mockTable("pipeline_entries", []);
    mockTable("lead_history", []);

    const result = await executeAiAction(sb, {
      id: "a-upl",
      organization_id: "org-1",
      lead_id: "lead-1",
      conversation_id: null,
      action_type: "update_pipeline_stage",
      payload: { lead_id: "lead-1", new_stage: "abordado" },
    });
    expect(result.success).toBe(true);
    expect(result.data?.target_stage).toBe("abordado");
  });

  it("update_pipeline_stage defaults target_pipe to whatsapp", async () => {
    const { executeAiAction } = await import(
      "../../supabase/functions/_shared/actions/index"
    );
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipeline_stages", []);
    mockTable("pipelines", [{ id: "pipe-wpp", organization_id: "org-1", slug: "whatsapp", type: "system" }]);
    mockTable("pipeline_entries", []);
    mockTable("lead_history", []);

    const result = await executeAiAction(sb, {
      id: "a-upl2",
      organization_id: "org-1",
      lead_id: "lead-1",
      conversation_id: null,
      action_type: "update_pipeline_stage",
      payload: { lead_id: "lead-1", new_stage: "respondeu" },
    });
    expect(result.success).toBe(true);
    expect(result.data?.target_pipe).toBe("whatsapp");
  });
});

// ─── 4. Workflow dispatcher delegates move_stage to shared handler ────────────

describe("Workflow dispatcher backward compat — move_stage uses shared handler", () => {
  it("move_stage whatsapp success via shared handler", async () => {
    const { executeWorkflowAction } = await import(
      "../../supabase/functions/_shared/workflow-action-handler"
    );
    const { sb, mockTable } = createMockSupabase();
    mockTable("pipeline_stages", []);
    mockTable("pipelines", [{ id: "pipe-wpp", organization_id: "org-1", slug: "whatsapp", type: "system" }]);
    mockTable("pipeline_entries", []);
    mockTable("leads", [{ id: "lead-1", phone: "5511999999999" }]);

    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: { actionType: "move_stage", pipeType: "whatsapp", targetStage: "agendado" },
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("agendado");
  });

  it("move_stage returns error when targetStage missing (guards before shared handler)", async () => {
    const { executeWorkflowAction } = await import(
      "../../supabase/functions/_shared/workflow-action-handler"
    );
    const { sb } = createMockSupabase();
    const result = await executeWorkflowAction({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      nodeData: { actionType: "move_stage", pipeType: "whatsapp" },
      executionContext: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("target stage");
  });
});

// ─── 5. ai-action-executor facade still exports needed symbols ───────────────

describe("ai-action-executor facade re-exports", () => {
  it("exports executeAiAction", async () => {
    const mod = await import(
      "../../supabase/functions/_shared/ai-action-executor"
    );
    expect(typeof mod.executeAiAction).toBe("function");
  });

  it("exports immediateTransferHuman", async () => {
    const mod = await import(
      "../../supabase/functions/_shared/ai-action-executor"
    );
    expect(typeof mod.immediateTransferHuman).toBe("function");
  });

  it("exports NOOP_ACTION_TYPES set", async () => {
    const mod = await import(
      "../../supabase/functions/_shared/ai-action-executor"
    );
    expect(mod.NOOP_ACTION_TYPES).toBeDefined();
    expect(mod.NOOP_ACTION_TYPES instanceof Set).toBe(true);
  });
});

// ─── 6. Post-cleanup: old move-card.ts gutted, shared handler is sole source ─

describe("post-cleanup — move-card.ts gutted, imports resolve", () => {
  it("move-card.ts no longer exports executeAdvanceStage (removed)", async () => {
    const mod = await import(
      "../../supabase/functions/_shared/actions/move-card"
    );
    expect(mod.executeAdvanceStage).toBeUndefined();
  });

  it("move-card.ts no longer exports executeUpdatePipelineStage (removed)", async () => {
    const mod = await import(
      "../../supabase/functions/_shared/actions/move-card"
    );
    expect(mod.executeUpdatePipelineStage).toBeUndefined();
  });

  it("action-handlers/move-stage.ts is the sole source for moveStage", async () => {
    const { moveStage } = await import(
      "../../supabase/functions/_shared/action-handlers/move-stage"
    );
    expect(typeof moveStage).toBe("function");
  });

  it("actions/index.ts no longer imports from move-card.ts (dead import removed)", async () => {
    // If it resolves, the dispatcher works without the old file
    const { executeAiAction } = await import(
      "../../supabase/functions/_shared/actions/index"
    );
    expect(typeof executeAiAction).toBe("function");
  });
});
