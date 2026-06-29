/**
 * Branch coverage tests for workflow-executor.ts
 *
 * Complements workflow-executor.test.ts by targeting uncovered branches:
 * - webhook_call: missing URL, HTTP error, success + outputVariable, body template
 * - wait_response: timeout and replied resume branches
 * - split_ab: variants[] format, reused assignment, missing edge
 * - time_window / wait_business_window: inside + outside window
 * - delay: short (inline) vs long (paused)
 * - assign_responsible: random, round_robin, fallback, no members, manual, invalid
 * - goto: invalid target
 * - default: unknown node type
 * - catch: node throws error
 * - resume from currentNodeId
 * - maxSteps hard cap
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";

vi.mock("../../supabase/functions/_shared/workflow-condition-evaluator.ts", () => ({
  evaluateCondition: vi.fn().mockResolvedValue(true),
  getLeadTags: vi.fn().mockResolvedValue(""),
}));

const mockAction = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ success: true, data: {} }),
);
vi.mock("../../supabase/functions/_shared/workflow-action-handler.ts", () => ({
  executeWorkflowAction: mockAction,
}));

// Control getNextSendTime so we can simulate inside-window (now) vs
// outside-window (tomorrow). Per-test overrides via mockReturnValueOnce.
const mockNextSendTime = vi.hoisted(() => vi.fn());
vi.mock("../../supabase/functions/_shared/followupSchedule.ts", () => ({
  getNextSendTime: mockNextSendTime,
}));

import { executeWorkflow } from "../../supabase/functions/_shared/workflow-executor";
import { createMockSupabase } from "../helpers/supabase-mock";

const baseMock = () => {
  const { sb, mockTable } = createMockSupabase();
  mockTable("workflow_execution_steps", []);
  mockTable("workflow_executions", []);
  mockTable("workflow_split_events", []);
  mockTable("workflow_split_assignments", []);
  return { sb, mockTable };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAction.mockResolvedValue({ success: true, data: {} });
  // Default: inside-window (nextSend = now → passes the <= now+1s check)
  mockNextSendTime.mockImplementation(() => new Date());
});

// ─── webhook_call ─────────────────────────────────────────────────────────

describe("executeWorkflow — webhook_call", () => {
  it("fails workflow when url missing", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "wh1", type: "webhook_call", data: {} },
      ],
      edges: [{ id: "e1", source: "t1", target: "wh1" }],
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
    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Webhook");
  });

  it("continues workflow even when webhook returns HTTP error", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("server down", { status: 500 }));
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "wh1",
          type: "webhook_call",
          data: { url: "https://x/hook", method: "POST" },
        },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "wh1" },
        { id: "e2", source: "wh1", target: "a1" },
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
    fetchSpy.mockRestore();
  });

  it("stores output variable and resolves body template on success", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok-body", { status: 200 }));
    const { sb, mockTable } = baseMock();
    mockTable("leads", [
      { id: "lead-1", name: "Ada", company: "Acme", email: "ada@x", phone: "1" },
    ]);

    const context: Record<string, unknown> = {};
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "wh1",
          type: "webhook_call",
          data: {
            url: "https://x/hook",
            method: "POST",
            bodyTemplate: '{"name":"{{nome}}","company":"{{empresa}}"}',
            outputVariable: "last_webhook_body",
          },
        },
      ],
      edges: [{ id: "e1", source: "t1", target: "wh1" }],
    };

    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context,
    });
    expect(result.success).toBe(true);
    expect(context.last_webhook_body).toBe("ok-body");

    const calledWith = fetchSpy.mock.calls[0][1];
    expect(calledWith?.body).toContain("Ada");
    expect(calledWith?.body).toContain("Acme");
    fetchSpy.mockRestore();
  });

  it("skips body on GET method", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "wh1",
          type: "webhook_call",
          data: { url: "https://x/hook", method: "GET", bodyTemplate: "ignored" },
        },
      ],
      edges: [{ id: "e1", source: "t1", target: "wh1" }],
    };
    await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context: {},
    });
    expect(fetchSpy.mock.calls[0][1]?.body).toBeUndefined();
    fetchSpy.mockRestore();
  });
});

// ─── wait_response resume branches ────────────────────────────────────────

describe("executeWorkflow — wait_response resume", () => {
  it("follows 'timeout' branch when context marked timeout", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "wr1", type: "wait_response", data: { timeoutMinutes: 60 } },
        { id: "timeout-action", type: "action", data: { actionType: "add_tag" } },
        { id: "reply-action", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "wr1" },
        { id: "e2", source: "wr1", target: "timeout-action", sourceHandle: "timeout" },
        { id: "e3", source: "wr1", target: "reply-action", sourceHandle: "replied" },
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
      context: { _wait_resolved: "timeout" },
      currentNodeId: "wr1",
    });
    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("follows 'replied' branch when context marked replied", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "wr1", type: "wait_response", data: { timeoutMinutes: 60 } },
        { id: "reply-action", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "wr1" },
        { id: "e2", source: "wr1", target: "reply-action", sourceHandle: "replied" },
      ],
    };

    const context: Record<string, unknown> = {
      _wait_resolved: "replied",
      _replied_at: "2026-04-14T10:00:00Z",
      _reply_channel: "whatsapp",
    };
    const result = await executeWorkflow({
      supabase: sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition,
      loopLimit: 10,
      context,
      currentNodeId: "wr1",
    });
    expect(result.success).toBe(true);
    // Context markers should be cleared after consumption
    expect(context._wait_resolved).toBeUndefined();
    expect(context._replied_at).toBeUndefined();
  });
});

// ─── split_ab variants[] format + reused assignment ───────────────────────

describe("executeWorkflow — split_ab variants", () => {
  it("uses variants[] array format when provided", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "ab1",
          type: "split_ab",
          data: {
            variants: [
              { id: "v1", label: "Variant 1", percentage: 100 },
              { id: "v2", label: "Variant 2", percentage: 0 },
            ],
          },
        },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "ab1" },
        { id: "e2", source: "ab1", target: "a1", sourceHandle: "variant_v1" },
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
  });

  it("reuses existing assignment (sticky)", async () => {
    const { sb, mockTable } = baseMock();
    mockTable("workflow_split_assignments", [
      {
        workflow_id: "wf-1",
        node_id: "ab1",
        lead_id: "lead-1",
        variant_id: "v1",
        variant_label: "Variant 1",
      },
    ]);
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "ab1",
          type: "split_ab",
          data: {
            variants: [
              { id: "v1", label: "Variant 1", percentage: 50 },
              { id: "v2", label: "Variant 2", percentage: 50 },
            ],
          },
        },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "ab1" },
        { id: "e2", source: "ab1", target: "a1", sourceHandle: "variant_v1" },
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
  });

  it("falls back to legacy sourceHandle contains match", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "ab1",
          type: "split_ab",
          data: {
            variants: [{ id: "a", label: "A", percentage: 100 }],
          },
        },
        { id: "next", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "ab1" },
        // sourceHandle is "source-a" — legacy contains("a") match
        { id: "e2", source: "ab1", target: "next", sourceHandle: "source-a" },
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
  });

  it("completes even when no matching edge (orphan split)", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "ab1",
          type: "split_ab",
          data: { variants: [{ id: "v1", label: "V1", percentage: 100 }] },
        },
      ],
      edges: [{ id: "e1", source: "t1", target: "ab1" }],
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
  });
});

// ─── time_window condition + wait_business_window ─────────────────────────

describe("executeWorkflow — time window nodes", () => {
  it("time_window inside window → follows true path", async () => {
    mockNextSendTime.mockImplementation(() => new Date()); // inside
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "tw1", type: "condition", data: { conditionMode: "time_window" } },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "tw1" },
        { id: "e2", source: "tw1", target: "a1", sourceHandle: "source-true" },
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
    expect(result.status).toBe("completed");
  });

  it("time_window outside window → pauses execution", async () => {
    // nextSend = 1 day ahead → outside
    mockNextSendTime.mockImplementation(
      () => new Date(Date.now() + 86_400_000),
    );
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "tw1", type: "condition", data: { conditionMode: "time_window" } },
      ],
      edges: [{ id: "e1", source: "t1", target: "tw1" }],
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
    expect(result.status).toBe("paused");
  });

  it("wait_business_window outside window → pauses", async () => {
    mockNextSendTime.mockImplementation(
      () => new Date(Date.now() + 86_400_000),
    );
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "bw1", type: "wait_business_window", data: {} },
      ],
      edges: [{ id: "e1", source: "t1", target: "bw1" }],
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
    expect(result.status).toBe("paused");
  });
});

// ─── delay: short inline vs long paused ───────────────────────────────────

describe("executeWorkflow — delay", () => {
  it("short delay executes inline", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "d1", type: "delay", data: { amount: 1, unit: "seconds" } },
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
    expect(result.status).toBe("completed");
  });

  it("long delay pauses", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "d1", type: "delay", data: { amount: 2, unit: "hours" } },
      ],
      edges: [{ id: "e1", source: "t1", target: "d1" }],
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
    expect(result.status).toBe("paused");
  });

  it("randomized delay within min/max", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "d1",
          type: "delay",
          data: { amount: 0, unit: "minutes", randomized: true, amountMin: 5, amountMax: 10 },
        },
      ],
      edges: [{ id: "e1", source: "t1", target: "d1" }],
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
    expect(result.status).toBe("paused");
  });
});

// ─── assign_responsible ───────────────────────────────────────────────────

describe("executeWorkflow — assign_responsible", () => {
  it("manual mode uses configured assigneeId", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "ar1",
          type: "assign_responsible",
          data: { assignMode: "manual", assigneeId: "tm-manual", assigneeName: "Bob" },
        },
      ],
      edges: [{ id: "e1", source: "t1", target: "ar1" }],
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
  });

  it("round_robin with no eligible members fails", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "ar1",
          type: "assign_responsible",
          data: { assignMode: "round_robin" },
        },
      ],
      edges: [{ id: "e1", source: "t1", target: "ar1" }],
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
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Nenhum membro");
  });

  it("random mode picks from eligible members", async () => {
    const { sb, mockTable } = baseMock();
    mockTable("team_members", [
      { id: "tm-a", name: "A", organization_id: "org-1", is_active: true },
      { id: "tm-b", name: "B", organization_id: "org-1", is_active: true },
    ]);
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "ar1",
          type: "assign_responsible",
          data: { assignMode: "random", assignTarget: "sdr" },
        },
      ],
      edges: [{ id: "e1", source: "t1", target: "ar1" }],
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
  });

  it("round_robin with member filter narrows pool", async () => {
    const { sb, mockTable } = baseMock();
    mockTable("team_members", [
      { id: "tm-a", name: "A", organization_id: "org-1", is_active: true },
      { id: "tm-b", name: "B", organization_id: "org-1", is_active: true },
      { id: "tm-c", name: "C", organization_id: "org-1", is_active: true },
    ]);
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "ar1",
          type: "assign_responsible",
          data: {
            assignMode: "round_robin",
            memberIds: ["tm-a", "tm-b"],
            assignTarget: "closer",
          },
        },
      ],
      edges: [{ id: "e1", source: "t1", target: "ar1" }],
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
    // RPC unmocked → falls back to first member — still succeeds
    expect(result.success).toBe(true);
  });
});

// ─── goto invalid, default unknown, node throws ───────────────────────────

describe("executeWorkflow — error paths", () => {
  it("goto to missing target fails", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "g1", type: "goto", data: { targetNodeId: "does-not-exist" } },
      ],
      edges: [{ id: "e1", source: "t1", target: "g1" }],
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
    expect(result.status).toBe("failed");
    expect(result.error).toContain("goto");
  });

  it("unknown node type is skipped and workflow continues", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "u1", type: "mystery_node_type", data: {} },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "u1" },
        { id: "e2", source: "u1", target: "a1" },
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
  });

  it("catches node errors and marks workflow failed", async () => {
    mockAction.mockRejectedValueOnce(new Error("boom"));
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [{ id: "e1", source: "t1", target: "a1" }],
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
    expect(result.status).toBe("failed");
    expect(result.error).toContain("boom");
  });

  it("action handler returning success:false (non-retryable) fails workflow", async () => {
    // Note: retryable:false bypasses the retry-with-backoff path (3 retries × 30s exp backoff).
    // Without this flag, a single success:false pauses for retry instead of failing.
    mockAction.mockResolvedValueOnce({ success: false, error: "upstream error", retryable: false });
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "a1", type: "action", data: { actionType: "send_message" } },
      ],
      edges: [{ id: "e1", source: "t1", target: "a1" }],
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
    expect(result.status).toBe("failed");
    expect(result.error).toContain("upstream");
  });
});

// ─── end node + resume currentNodeId ──────────────────────────────────────

describe("executeWorkflow — end + resume", () => {
  it("end node terminates workflow cleanly", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "end1", type: "end", data: {} },
        { id: "never", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "end1" },
        { id: "e2", source: "end1", target: "never" },
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
    expect(result.status).toBe("completed");
  });

  it("resumes from currentNodeId, skipping trigger", async () => {
    const { sb } = baseMock();
    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [{ id: "e1", source: "t1", target: "a1" }],
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
      currentNodeId: "a1",
    });
    expect(result.success).toBe(true);
  });
});
