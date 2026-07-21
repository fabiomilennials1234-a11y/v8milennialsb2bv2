import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";

// Mock the heavy dependencies before importing
vi.mock("../../supabase/functions/_shared/workflow-condition-evaluator.ts", () => ({
  evaluateCondition: vi.fn().mockResolvedValue(true),
  getLeadTags: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../supabase/functions/_shared/workflow-action-handler.ts", () => ({
  executeWorkflowAction: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

vi.mock("../../supabase/functions/_shared/followupSchedule.ts", () => ({
  getNextSendTime: vi.fn().mockReturnValue(new Date()),
}));

import { executeWorkflow } from "../../supabase/functions/_shared/workflow-executor";
import { executeWorkflowAction } from "../../supabase/functions/_shared/workflow-action-handler";
import { createMockSupabase } from "../helpers/supabase-mock";

describe("executeWorkflow", () => {
  it("fails when no trigger node exists", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition: { nodes: [], edges: [] },
      loopLimit: 10,
      context: {},
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("No trigger node");
    expect(result.stepsExecuted).toBe(0);
  });

  it("completes a simple trigger → action workflow", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);
    mockTable("workflow_split_events", []);

    const definition = {
      nodes: [
        { id: "trigger-1", type: "trigger", data: { triggerType: "lead_created" } },
        { id: "action-1", type: "action", data: { actionType: "add_tag", tagName: "Ouro" } },
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context: {},
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.stepsExecuted).toBeGreaterThan(0);
  });

  it("handles trigger → condition → action (true path)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);
    mockTable("workflow_split_events", []);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "c1", type: "condition", data: { conditionMode: "field", field: "rating", operator: "greater_than", value: "3" } },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "c1" },
        { id: "e2", source: "c1", target: "a1", sourceHandle: "source-true" },
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context: {},
    });

    expect(result.stepsExecuted).toBeGreaterThan(0);
  });

  it("detects loop limit", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);

    // Circular: trigger → action → back to action (loop)
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "a1" },
        { id: "e2", source: "a1", target: "a1" }, // self-loop
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 3,
      context: {},
    });

    expect(result.status).toBe("loop_limit_reached");
  });

  it("handles delay node → pauses execution", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "d1", type: "delay", data: { delayMinutes: 60 } },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "d1" },
        { id: "e2", source: "d1", target: "a1" },
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context: {},
    });

    // Delay node pauses or completes depending on implementation — either is valid
    expect(["paused", "completed"]).toContain(result.status);
    expect(result.stepsExecuted).toBeGreaterThan(0);
  });

  it("handles wait_response node → waiting_response status", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "wr1", type: "wait_response", data: { timeoutMinutes: 1440 } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "wr1" },
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context: {},
    });

    expect(result.status).toBe("waiting_response");
  });

  it("handles split_ab node → picks a path", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);
    mockTable("workflow_split_events", []);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "ab1", type: "split_ab", data: { splitPercent: 50 } },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
        { id: "a2", type: "action", data: { actionType: "remove_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "ab1" },
        { id: "e2", source: "ab1", target: "a1", sourceHandle: "source-a" },
        { id: "e3", source: "ab1", target: "a2", sourceHandle: "source-b" },
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context: {},
    });

    expect(result.stepsExecuted).toBeGreaterThan(0);
  });

  it("handles copilot node", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "cp1", type: "copilot", data: { agentId: "agent-1", action: "send_message" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "cp1" },
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context: {},
    });

    expect(result.stepsExecuted).toBeGreaterThan(0);
  });

  it("handles webhook_call node", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "wh1", type: "webhook_call", data: { url: "https://example.com/hook", method: "POST" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "wh1" },
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context: {},
    });

    expect(result.stepsExecuted).toBeGreaterThan(0);
  });

  it("handles wait_business_window node", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "bw1", type: "wait_business_window", data: { startHour: 8, endHour: 18 } },
        { id: "a1", type: "action", data: { actionType: "send_whatsapp" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "bw1" },
        { id: "e2", source: "bw1", target: "a1" },
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context: {},
    });

    expect(result.stepsExecuted).toBeGreaterThan(0);
  });

  it("handles assign_responsible node", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "ar1", type: "assign_responsible", data: { teamMemberId: "tm-1", mode: "specific" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "ar1" },
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context: {},
    });

    expect(result.stepsExecuted).toBeGreaterThan(0);
  });

  it("handles goto node", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "g1", type: "goto", data: { targetNodeId: "a1" } },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "g1" },
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 5,
      context: {},
    });

    expect(result.stepsExecuted).toBeGreaterThan(0);
  });

  it("handles multiple sequential actions", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);
    mockTable("workflow_split_events", []);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
        { id: "a2", type: "action", data: { actionType: "update_rating" } },
        { id: "a3", type: "action", data: { actionType: "assign_responsible" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "a1" },
        { id: "e2", source: "a1", target: "a2" },
        { id: "e3", source: "a2", target: "a3" },
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context: {},
    });

    expect(result.success).toBe(true);
    expect(result.stepsExecuted).toBeGreaterThanOrEqual(3);
  });

  it("handles condition false path", async () => {
    const { evaluateCondition } = await import("../../supabase/functions/_shared/workflow-condition-evaluator");
    (evaluateCondition as any).mockResolvedValueOnce(false);

    const { sb, mockTable } = createMockSupabase();
    mockTable("workflow_execution_steps", []);
    mockTable("workflow_executions", []);
    mockTable("workflow_split_events", []);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "c1", type: "condition", data: {} },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
        { id: "a2", type: "action", data: { actionType: "remove_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "c1" },
        { id: "e2", source: "c1", target: "a1", sourceHandle: "source-true" },
        { id: "e3", source: "c1", target: "a2", sourceHandle: "source-false" },
      ],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context: {},
    });

    expect(result.stepsExecuted).toBeGreaterThan(0);
  });

  // ── Send Governor defer handling ──────────────────────────────────────────
  describe("Send Governor defer", () => {
    const DEFINITION = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "a1", type: "action", data: { actionType: "send_whatsapp" } },
      ],
      edges: [{ id: "e1", source: "t1", target: "a1" }],
    };

    it("reschedules the node without failing, advancing, or counting a retry", async () => {
      const { sb, mockTable, getUpdated } = createMockSupabase();
      mockTable("workflow_execution_steps", []);
      // Seed the execution row so the mock records .update().eq('id', …) writes.
      mockTable("workflow_executions", [{ id: "exec-1", status: "running" }]);
      mockTable("workflow_split_events", []);

      const deferUntil = new Date(Date.now() + 3_600_000).toISOString();
      vi.mocked(executeWorkflowAction).mockResolvedValueOnce({ success: true, deferUntil });

      const context: Record<string, unknown> = {};
      const result = await executeWorkflow({
        supabase: sb, executionId: "exec-1", workflowId: "wf-1",
        organizationId: "org-1", leadId: "lead-1",
        definition: DEFINITION, loopLimit: 10, context,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("paused");
      // Defer counter bumped, retry counter untouched.
      expect((context._defer_counts as Record<string, number>).a1).toBe(1);
      expect(context._retry_counts).toBeUndefined();
      expect(context._governor_deferred).toBe("a1");
      // Execution rescheduled at deferUntil, still pinned to the SAME node.
      const updates = getUpdated("workflow_executions");
      const deferUpdate = updates.find((u) => u.next_run_at === deferUntil);
      expect(deferUpdate).toBeTruthy();
      expect(deferUpdate!.current_node_id).toBe("a1");
      expect(deferUpdate!.status).toBe("running");
    });

    it("resumes and sends on the next pass (defer marker cleared)", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("workflow_execution_steps", []);
      mockTable("workflow_executions", []);
      mockTable("workflow_split_events", []);

      // Resume: currentNodeId pinned to a1, one prior defer recorded.
      vi.mocked(executeWorkflowAction).mockResolvedValueOnce({ success: true });

      const context: Record<string, unknown> = {
        _defer_counts: { a1: 1 },
        _governor_deferred: "a1",
      };
      const result = await executeWorkflow({
        supabase: sb, executionId: "exec-1", workflowId: "wf-1",
        organizationId: "org-1", leadId: "lead-1",
        definition: DEFINITION, loopLimit: 10, context,
        currentNodeId: "a1",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("completed");
      // Marker cleared once the node no longer defers.
      expect(context._governor_deferred).toBeUndefined();
    });
  });
});
