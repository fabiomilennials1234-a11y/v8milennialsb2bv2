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

// ─── wait_business_window — semântica "janela = horário de envio" ──────────
//
// Trava de comportamento para a mudança de 2026-08-19. Usa `time-context` REAL
// (não mockado) + relógio congelado: o que está sob teste é a aritmética de
// agenda, e mockar o resolver testaria o mock.
//
// Formas exercitadas — todas medidas em prod:
//   Chique    — 1 janela seg-sex 08:00-18:00 com `hold_until:` (alvo VAZIO)
//   Bertin    — Comercial seg-sex 09:00-21:00 `pass` + sáb/dom `hold_until:Comercial`
//   Happyneis — 3 janelas `route:` (workflow ATIVO — trava de regressão)
//   Goletric  — nó LEGADO sem `windows[]` (624 execuções já escalonadas)

import { afterEach } from "vitest";
import {
  computeNextSendWindowStart,
  windowSpanMinutes,
} from "../../supabase/functions/_shared/copilot/time-context";

afterEach(() => {
  vi.useRealTimers();
});

/** Como `baseMock()`, mas devolve também `getInserted` (steps gravados). */
const wbwMock = () => {
  const m = createMockSupabase();
  m.mockTable("workflow_execution_steps", []);
  m.mockTable("workflow_executions", []);
  m.mockTable("workflow_split_events", []);
  m.mockTable("workflow_split_assignments", []);
  return m;
};

/** Captura o payload literal de cada `.update()` em workflow_executions. */
function trackExecutionUpdates(sb: any): Record<string, unknown>[] {
  const captured: Record<string, unknown>[] = [];
  const originalFrom = sb.from.bind(sb);
  sb.from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "workflow_executions") {
      const originalUpdate = chain.update.bind(chain);
      chain.update = (vals: Record<string, unknown>) => {
        captured.push({ ...vals });
        return originalUpdate(vals);
      };
    }
    return chain;
  };
  return captured;
}

/** Só os updates que agendam ou encerram — o heartbeat por nó é ruído aqui. */
const schedulingUpdates = (ups: Record<string, unknown>[]) =>
  ups.filter((u) => "next_run_at" in u || "status" in u);

const BRT = (iso: string) => new Date(`${iso}-03:00`);

// 2026-08-19 é quarta-feira. Ancoragem dos dias usados abaixo:
const WED_10H = BRT("2026-08-19T10:00:00");
const FRI_20H = BRT("2026-08-21T20:00:00");
const SAT_10H = BRT("2026-08-22T10:00:00");
const SAT_12H = BRT("2026-08-22T12:00:00");
const MON_08H = BRT("2026-08-24T08:00:00");
const MON_09H = BRT("2026-08-24T09:00:00");

const CHIQUE_WINDOWS = [
  {
    id: "w-chique",
    name: "Comercial",
    days: ["mon", "tue", "wed", "thu", "fri"],
    start: "08:00",
    end: "18:00",
    action: "hold_until:", // alvo VAZIO — 7 workflows da Chique
  },
];

const BERTIN_WINDOWS = [
  {
    id: "w-bertin-1",
    name: "Comercial",
    days: ["mon", "tue", "wed", "thu", "fri"],
    start: "09:00",
    end: "21:00",
    action: "pass",
  },
  {
    id: "w-bertin-2",
    name: "Janela 2",
    days: ["sat", "sun"],
    start: "00:01",
    end: "23:59",
    action: "hold_until:Comercial", // bloqueio deliberado de fim de semana
  },
];

const HAPPYNEIS_WINDOWS = [
  {
    id: "w-h1",
    name: "Horário Comercial",
    days: ["mon", "tue", "wed", "thu", "fri"],
    start: "08:00",
    end: "18:00",
    action: "route:Horário Comercial",
  },
  {
    id: "w-h2",
    name: "Fora do Horário Comercial",
    days: ["mon", "tue", "wed", "thu", "fri"],
    start: "18:01",
    end: "07:59",
    action: "route:Fora do Horário Comercial",
  },
  {
    id: "w-h3",
    name: "Final de semana",
    days: ["sat", "sun"],
    start: "00:00",
    end: "23:59",
    action: "route:Final de semana",
  },
];

const wbwDefinition = (windows: unknown[], extraData: Record<string, unknown> = {}) => ({
  nodes: [
    { id: "t1", type: "trigger", data: {} },
    { id: "bw1", type: "wait_business_window", data: { windows, timezone: "America/Sao_Paulo", ...extraData } },
    { id: "a1", type: "action", data: { actionType: "add_tag" } },
  ],
  edges: [
    { id: "e1", source: "t1", target: "bw1" },
    { id: "e2", source: "bw1", target: "a1" },
  ],
});

const runWbw = (sb: any, definition: unknown, over: Record<string, unknown> = {}) =>
  executeWorkflow({
    supabase: sb,
    executionId: "exec-1",
    workflowId: "wf-1",
    organizationId: "org-1",
    leadId: "lead-1",
    definition: definition as any,
    loopLimit: 10,
    context: {},
    ...over,
  });

describe("computeNextSendWindowStart", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  it("devolve a abertura MAIS PRÓXIMA entre N janelas, não a da primeira da lista", () => {
    // Sexta 20:00. Comercial (seg-sex) só reabre segunda; a janela de sábado
    // abre antes. Varrer janela por janela e ficar com a primeira erraria isso.
    const windows = [
      { name: "Comercial", days: ["mon", "tue", "wed", "thu", "fri"], start: "08:00", end: "18:00" },
      { name: "Plantão sábado", days: ["sat"], start: "09:00", end: "12:00" },
    ];
    const next = computeNextSendWindowStart(windows, "America/Sao_Paulo", FRI_20H);
    expect(next?.toISOString()).toBe(BRT("2026-08-22T09:00:00").toISOString());
  });

  it("resolve janela que cruza a meia-noite", () => {
    const windows = [{ name: "Madrugada", days: ["sat"], start: "22:00", end: "06:00" }];
    const next = computeNextSendWindowStart(windows, "America/Sao_Paulo", SAT_12H);
    expect(next?.toISOString()).toBe(BRT("2026-08-22T22:00:00").toISOString());
  });

  it("devolve o próprio instante quando já está dentro de uma janela", () => {
    const windows = [{ name: "Comercial", days: ["wed"], start: "08:00", end: "18:00" }];
    const next = computeNextSendWindowStart(windows, "America/Sao_Paulo", WED_10H);
    expect(next?.toISOString()).toBe(WED_10H.toISOString());
  });

  it("devolve null para lista vazia e para janelas sem dias", () => {
    expect(computeNextSendWindowStart([], "America/Sao_Paulo", WED_10H)).toBeNull();
    expect(
      computeNextSendWindowStart(
        [{ name: "Órfã", days: [], start: "08:00", end: "18:00" }],
        "America/Sao_Paulo",
        WED_10H,
      ),
    ).toBeNull();
  });

  it("windowSpanMinutes trata mesmo-dia e wrap de meia-noite", () => {
    expect(windowSpanMinutes({ start: "08:00", end: "18:00" })).toBe(600);
    expect(windowSpanMinutes({ start: "22:00", end: "06:00" })).toBe(480);
    expect(windowSpanMinutes({ start: "00:01", end: "23:59" })).toBe(1438);
  });
});

describe("wait_business_window — forma Chique (hold_until: com alvo vazio)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  it("DENTRO da janela → segue no mesmo tick, sem escrever next_run_at", async () => {
    vi.setSystemTime(WED_10H);
    const { sb } = baseMock();
    const updates = trackExecutionUpdates(sb);

    const result = await runWbw(sb, wbwDefinition(CHIQUE_WINDOWS));

    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    // Critério de aceite 1: nenhuma escrita de agendamento.
    expect(updates.some((u) => "next_run_at" in u)).toBe(false);
    // E o nó a jusante rodou.
    expect(mockAction).toHaveBeenCalledTimes(1);
  });

  it("DENTRO da janela, em resume recente → segue igual", async () => {
    vi.setSystemTime(WED_10H);
    const { sb } = baseMock();
    const updates = trackExecutionUpdates(sb);

    const result = await runWbw(sb, wbwDefinition(CHIQUE_WINDOWS), {
      currentNodeId: "bw1",
      nextRunAt: new Date(WED_10H.getTime() - 5 * 60_000).toISOString(),
    });

    expect(result.status).toBe("completed");
    expect(updates.some((u) => "next_run_at" in u)).toBe(false);
    expect(mockAction).toHaveBeenCalledTimes(1);
  });

  it("FORA da janela → uma escrita, running, next_run_at = próxima segunda 08:00 + jitter", async () => {
    vi.setSystemTime(SAT_10H);
    const { sb, getInserted } = wbwMock();
    const updates = trackExecutionUpdates(sb);

    const result = await runWbw(sb, wbwDefinition(CHIQUE_WINDOWS));

    expect(result.success).toBe(true);
    expect(result.status).toBe("paused");
    expect(mockAction).not.toHaveBeenCalled();

    const scheduling = schedulingUpdates(updates).filter((u) => "next_run_at" in u);
    expect(scheduling).toHaveLength(1);
    expect(scheduling[0].status).toBe("running");

    const scheduled = new Date(scheduling[0].next_run_at as string);
    const offsetMs = scheduled.getTime() - MON_08H.getTime();
    expect(offsetMs).toBeGreaterThanOrEqual(0);
    expect(offsetMs).toBeLessThan(30 * 60_000);
    // Critério de aceite 2: estritamente futuro. Passado/presente = livelock.
    expect(scheduled.getTime()).toBeGreaterThan(SAT_10H.getTime());

    const step = getInserted("workflow_execution_steps").at(-1) as any;
    expect(step.output_data.roleResolved).toBe("none");
    expect(step.output_data.jitterMs).toBe(offsetMs);
    expect(step.output_data.insideWindow).toBe(false);
  });
});

describe("wait_business_window — forma Bertin (blackout de fim de semana)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  it("sábado ao meio-dia → dorme até segunda 09:00 (+jitter), NÃO passa", async () => {
    vi.setSystemTime(SAT_12H);
    const { sb, getInserted } = wbwMock();
    const updates = trackExecutionUpdates(sb);

    const result = await runWbw(sb, wbwDefinition(BERTIN_WINDOWS));

    expect(result.status).toBe("paused");
    // A garantia que importa: nenhuma mensagem sai no fim de semana.
    expect(mockAction).not.toHaveBeenCalled();

    const scheduling = schedulingUpdates(updates).filter((u) => "next_run_at" in u);
    expect(scheduling).toHaveLength(1);
    const scheduled = new Date(scheduling[0].next_run_at as string);
    const offsetMs = scheduled.getTime() - MON_09H.getTime();
    expect(offsetMs).toBeGreaterThanOrEqual(0);
    expect(offsetMs).toBeLessThan(30 * 60_000);

    const step = getInserted("workflow_execution_steps").at(-1) as any;
    // Casou a janela de bloqueio: insideWindow=true, papel blackout.
    expect(step.output_data.insideWindow).toBe(true);
    expect(step.output_data.roleResolved).toBe("blackout");
    expect(step.output_data.activeWindow).toBe("Janela 2");
    expect(step.output_data.scannedPool).toBe("send");
  });

  it("terça 10:00 → dentro de Comercial, passa", async () => {
    vi.setSystemTime(BRT("2026-08-18T10:00:00"));
    const { sb } = baseMock();
    const updates = trackExecutionUpdates(sb);

    const result = await runWbw(sb, wbwDefinition(BERTIN_WINDOWS));

    expect(result.status).toBe("completed");
    expect(updates.some((u) => "next_run_at" in u)).toBe(false);
    expect(mockAction).toHaveBeenCalledTimes(1);
  });
});

describe("wait_business_window — forma Happyneis (3 rotas, regressão)", () => {
  const routedDefinition = () => ({
    nodes: [
      { id: "t1", type: "trigger", data: {} },
      {
        id: "bw1",
        type: "wait_business_window",
        data: { windows: HAPPYNEIS_WINDOWS, timezone: "America/Sao_Paulo", mode: "route" },
      },
      { id: "hc", type: "action", data: { actionType: "add_tag", label: "comercial" } },
      { id: "fora", type: "action", data: { actionType: "add_tag", label: "fora" } },
      { id: "fds", type: "action", data: { actionType: "add_tag", label: "fds" } },
    ],
    edges: [
      { id: "e1", source: "t1", target: "bw1" },
      { id: "e2", source: "bw1", target: "hc", sourceHandle: "Horário Comercial" },
      { id: "e3", source: "bw1", target: "fora", sourceHandle: "Fora do Horário Comercial" },
      { id: "e4", source: "bw1", target: "fds", sourceHandle: "Final de semana" },
    ],
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  const routeCases: Array<[string, Date, string]> = [
    ["horário comercial", WED_10H, "hc"],
    ["fora do horário", BRT("2026-08-19T22:00:00"), "fora"],
    ["final de semana", SAT_12H, "fds"],
  ];

  for (const [label, clock, expectedTarget] of routeCases) {
    it(`${label} → roteia pelo sourceHandle correspondente`, async () => {
      vi.setSystemTime(clock);
      const { sb, getInserted } = wbwMock();
      const result = await runWbw(sb, routedDefinition());

      expect(result.success).toBe(true);
      const steps = getInserted("workflow_execution_steps") as any[];
      const wbwStep = steps.find((s) => s.node_type === "wait_business_window");
      expect(wbwStep.output_data.roleResolved).toBe("route");
      expect(wbwStep.output_data.routedTo).toEqual([expectedTarget]);
      // Exatamente um ramo executou.
      expect(mockAction).toHaveBeenCalledTimes(1);
    });
  }
});

describe("wait_business_window — guarda de resume vencido (24h)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  it("agendado há 25h → cancelled, expired:stale_resume_24h, ZERO nós a jusante", async () => {
    vi.setSystemTime(WED_10H);
    const { sb, getInserted } = wbwMock();
    const updates = trackExecutionUpdates(sb);

    const result = await runWbw(sb, wbwDefinition(CHIQUE_WINDOWS), {
      currentNodeId: "bw1",
      nextRunAt: new Date(WED_10H.getTime() - 25 * 60 * 60_000).toISOString(),
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("cancelled");
    expect(result.error).toBe("expired:stale_resume_24h");

    // ESTA é a asserção que prova que nenhum WhatsApp saiu.
    expect(mockAction).not.toHaveBeenCalled();

    const terminal = updates.find((u) => u.status === "cancelled")!;
    expect(terminal).toBeDefined();
    expect(terminal.error).toBe("expired:stale_resume_24h");
    expect(terminal.completed_at).toBeTruthy();
    expect(terminal.next_run_at).toBeNull();

    const step = getInserted("workflow_execution_steps").at(-1) as any;
    expect(step.status).toBe("skipped");
    expect(step.output_data.roleResolved).toBe("expired");
  });

  it("agendado há 23h → NÃO expira (dentro do limite)", async () => {
    vi.setSystemTime(WED_10H);
    const { sb } = baseMock();
    const result = await runWbw(sb, wbwDefinition(CHIQUE_WINDOWS), {
      currentNodeId: "bw1",
      nextRunAt: new Date(WED_10H.getTime() - 23 * 60 * 60_000).toISOString(),
    });
    expect(result.status).toBe("completed");
    expect(mockAction).toHaveBeenCalledTimes(1);
  });

  it("nextRunAt ausente ou inválido não dispara a guarda", async () => {
    vi.setSystemTime(WED_10H);
    for (const bad of [null, undefined, "não é data"]) {
      vi.clearAllMocks();
      mockAction.mockResolvedValue({ success: true, data: {} });
      const { sb } = baseMock();
      const result = await runWbw(sb, wbwDefinition(CHIQUE_WINDOWS), {
        currentNodeId: "bw1",
        nextRunAt: bad,
      });
      expect(result.status).toBe("completed");
    }
  });
});

describe("wait_business_window — jitter determinístico", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SAT_10H);
  });

  const scheduleFor = async (executionId: string): Promise<number> => {
    const { sb } = baseMock();
    const updates = trackExecutionUpdates(sb);
    await runWbw(sb, wbwDefinition(CHIQUE_WINDOWS), { executionId });
    const scheduling = schedulingUpdates(updates).find((u) => "next_run_at" in u)!;
    return new Date(scheduling.next_run_at as string).getTime();
  };

  // Timeout no DEFAULT de propósito. Estes testes rodam o executor inteiro, e o
  // executor varre minuto a minuto até a próxima abertura — então a duração
  // deles é o gate de regressão de performance da varredura. Um timeout
  // generoso aqui converteria lentidão em silêncio: foi assim que 3 formatters
  // `Intl` construídos por sonda passaram despercebidos na primeira rodada.
  it("a MESMA execução cai sempre no mesmo minuto", async () => {
    const a = await scheduleFor("exec-estavel");
    const b = await scheduleFor("exec-estavel");
    expect(a).toBe(b);
  });

  it("execuções diferentes se espalham", async () => {
    const values: number[] = [];
    for (const id of ["exec-a", "exec-b", "exec-c", "exec-d", "exec-e", "exec-f"]) {
      values.push(await scheduleFor(id));
    }
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it("o jitter nunca vaza pelo fim da janela", async () => {
    // Janela curta: 08:00-08:20 (20 min) → teto do jitter = 10 min, não 30.
    const shortWindow = [{
      id: "w-curta", name: "Curta", days: ["mon"], start: "08:00", end: "08:20", action: "pass",
    }];
    const { sb } = baseMock();
    const updates = trackExecutionUpdates(sb);
    await runWbw(sb, wbwDefinition(shortWindow), { executionId: "exec-curta" });

    const scheduling = schedulingUpdates(updates).find((u) => "next_run_at" in u)!;
    const scheduled = new Date(scheduling.next_run_at as string);
    const offsetMs = scheduled.getTime() - MON_08H.getTime();
    expect(offsetMs).toBeGreaterThanOrEqual(0);
    expect(offsetMs).toBeLessThan(10 * 60_000);
  });
});

describe("wait_business_window — todo success:false escreve linha terminal", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  it("route sem edge correspondente → failed COM completed_at", async () => {
    vi.setSystemTime(WED_10H);
    const { sb } = baseMock();
    const updates = trackExecutionUpdates(sb);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "bw1",
          type: "wait_business_window",
          data: {
            windows: [{
              id: "w1", name: "Comercial", days: ["wed"],
              start: "08:00", end: "18:00", action: "route:orfa",
            }],
            timezone: "America/Sao_Paulo",
          },
        },
      ],
      edges: [{ id: "e1", source: "t1", target: "bw1" }],
    };

    const result = await runWbw(sb, definition);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");

    const terminal = updates.find((u) => u.status === "failed")!;
    expect(terminal).toBeDefined();
    expect(terminal.completed_at).toBeTruthy();
    expect(String(terminal.error)).toContain("orfa");
  });

  it("nenhuma janela abre em 14 dias → cancelled + expired:no_send_window", async () => {
    vi.setSystemTime(WED_10H);
    const { sb } = baseMock();
    const updates = trackExecutionUpdates(sb);

    const definition = wbwDefinition([{
      id: "w-orfa", name: "Órfã", days: [], start: "08:00", end: "18:00", action: "pass",
    }]);

    const result = await runWbw(sb, definition);

    expect(result.status).toBe("cancelled");
    expect(result.error).toBe("expired:no_send_window");
    expect(mockAction).not.toHaveBeenCalled();

    const terminal = updates.find((u) => u.status === "cancelled")!;
    expect(terminal.completed_at).toBeTruthy();
    expect(terminal.next_run_at).toBeNull();
    expect(terminal.error).toBe("expired:no_send_window");
  });

  it("todas as janelas são blackout e uma está ativa → cancelled, nunca livelock", async () => {
    // Sem janela de envio, o fallback varre TODAS as janelas — e a ativa casaria
    // no offset 0, devolvendo `now`. A guarda R2 converte isso em terminal em
    // vez de gravar next_run_at <= now (que seria reclamado a cada minuto).
    vi.setSystemTime(WED_10H);
    const { sb } = baseMock();
    const updates = trackExecutionUpdates(sb);

    const definition = wbwDefinition([{
      id: "w-bl", name: "Bloqueio", days: ["wed"],
      start: "08:00", end: "18:00", action: "hold_until:Inexistente",
    }]);

    const result = await runWbw(sb, definition);

    expect(result.status).toBe("cancelled");
    expect(result.error).toBe("expired:window_resolution_loop");
    expect(mockAction).not.toHaveBeenCalled();

    const terminal = updates.find((u) => u.status === "cancelled")!;
    expect(terminal.completed_at).toBeTruthy();
    expect(terminal.next_run_at).toBeNull();
    // Nunca gravou agendamento no passado/presente.
    expect(updates.some((u) => typeof u.next_run_at === "string")).toBe(false);
  });
});

describe("wait_business_window — caminho LEGACY intocado (Goletric)", () => {
  it("sem windows[], usa getNextSendTime e agenda com o valor dele", async () => {
    const legacyNext = new Date(Date.now() + 86_400_000);
    mockNextSendTime.mockImplementation(() => legacyNext);
    const { sb } = baseMock();
    const updates = trackExecutionUpdates(sb);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        {
          id: "bw1",
          type: "wait_business_window",
          // Forma exata do nó legado: chaves PT, sem windows[].
          data: { days: ["seg", "ter", "qua", "qui", "sex"], startTime: "08:00", endTime: "18:00" },
        },
      ],
      edges: [{ id: "e1", source: "t1", target: "bw1" }],
    };

    const result = await runWbw(sb, definition);

    expect(result.status).toBe("paused");
    expect(mockNextSendTime).toHaveBeenCalled();
    const scheduling = schedulingUpdates(updates).find((u) => "next_run_at" in u)!;
    // Sem jitter, sem arredondamento: o valor do agendador legado, cru.
    expect(scheduling.next_run_at).toBe(legacyNext.toISOString());
    expect(scheduling.status).toBe("running");
  });

  it("sem windows[] e dentro da janela → passa, sem agendar", async () => {
    mockNextSendTime.mockImplementation(() => new Date());
    const { sb } = baseMock();
    const updates = trackExecutionUpdates(sb);

    const definition = {
      nodes: [
        { id: "t1", type: "trigger", data: {} },
        { id: "bw1", type: "wait_business_window", data: { days: ["seg"], startTime: "08:00", endTime: "18:00" } },
        { id: "a1", type: "action", data: { actionType: "add_tag" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "bw1" },
        { id: "e2", source: "bw1", target: "a1" },
      ],
    };

    const result = await runWbw(sb, definition);

    expect(result.status).toBe("completed");
    expect(updates.some((u) => "next_run_at" in u)).toBe(false);
    expect(mockAction).toHaveBeenCalledTimes(1);
  });
});
