/**
 * Split A/B — tag override tests for workflow-executor.ts
 *
 * Covers the priority chain: tag override > sticky assignment > weighted random.
 * - lead WITH a variant's tag → that variant wins, even if the roll would pick another
 * - lead WITHOUT any matching tag → sticky/random behaviour is unchanged
 * - tag match is case-insensitive (by name)
 * - tag rule overrides a pre-existing sticky assignment
 * - first variant (array order) with a matching tag wins
 * - no variant declares tags → getLeadTags is never queried (no regression / no extra query)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "../../tests/helpers/deno-mock";

const mockGetLeadTags = vi.hoisted(() => vi.fn().mockResolvedValue(""));
vi.mock("../../supabase/functions/_shared/workflow-condition-evaluator.ts", () => ({
  evaluateCondition: vi.fn().mockResolvedValue(true),
  getLeadTags: mockGetLeadTags,
}));

vi.mock("../../supabase/functions/_shared/workflow-action-handler.ts", () => ({
  executeWorkflowAction: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

vi.mock("../../supabase/functions/_shared/followupSchedule.ts", () => ({
  getNextSendTime: vi.fn().mockReturnValue(new Date()),
}));

import { executeWorkflow } from "../../supabase/functions/_shared/workflow-executor";
import { createMockSupabase } from "../helpers/supabase-mock";

// Two-path split with tags only on variant "b". Math.random is stubbed to 0
// in tests so the *weighted roll* always lands on the first variant ("a") —
// any time "b" is chosen it can only be due to a tag override.
function twoPathDefinition(variants: unknown[]) {
  return {
    nodes: [
      { id: "t1", type: "trigger", data: {} },
      { id: "ab1", type: "split_ab", data: { variants } },
      { id: "a1", type: "action", data: { actionType: "add_tag" } },
      { id: "a2", type: "action", data: { actionType: "remove_tag" } },
    ],
    edges: [
      { id: "e1", source: "t1", target: "ab1" },
      { id: "e2", source: "ab1", target: "a1", sourceHandle: "variant_a" },
      { id: "e3", source: "ab1", target: "a2", sourceHandle: "variant_b" },
    ],
  };
}

function baseMock() {
  const ctx = createMockSupabase();
  ctx.mockTable("workflow_execution_steps", []);
  ctx.mockTable("workflow_executions", []);
  ctx.mockTable("workflow_split_events", []);
  ctx.mockTable("workflow_split_assignments", []);
  return ctx;
}

const run = (sb: any) =>
  executeWorkflow({
    supabase: sb,
    executionId: "exec-1",
    workflowId: "wf-1",
    organizationId: "org-1",
    leadId: "lead-1",
    definition: twoPathDefinition([
      { id: "a", label: "A", percentage: 50 },
      { id: "b", label: "B", percentage: 50, tags: ["VIP"] },
    ]),
    loopLimit: 10,
    context: {},
  });

describe("executeWorkflow — split_ab tag override", () => {
  beforeEach(() => {
    mockGetLeadTags.mockReset();
    // Roll always lands on the first variant ("a") absent a tag override.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forces the tagged variant even when the roll would pick another", async () => {
    mockGetLeadTags.mockResolvedValue("VIP");
    const { sb, getInserted } = baseMock();

    const result = await run(sb);
    expect(result.success).toBe(true);

    const assignments = getInserted("workflow_split_assignments");
    expect(assignments).toHaveLength(1);
    expect(assignments[0].variant_id).toBe("b");

    // Step records that the choice came from a tag, for traceability.
    const step = getInserted("workflow_execution_steps").find(
      (s: any) => s.node_type === "split_ab",
    );
    expect(step?.output_data?.matchedByTag).toBe(true);
    expect(step?.output_data?.matchedTag).toBe("VIP");
    expect(step?.output_data?.chosenVariantId).toBe("b");
  });

  it("falls back to weighted random when the lead has no matching tag", async () => {
    mockGetLeadTags.mockResolvedValue("Bronze,Prata");
    const { sb, getInserted } = baseMock();

    const result = await run(sb);
    expect(result.success).toBe(true);

    const assignments = getInserted("workflow_split_assignments");
    expect(assignments).toHaveLength(1);
    // roll = 0 → first variant "a"
    expect(assignments[0].variant_id).toBe("a");

    const step = getInserted("workflow_execution_steps").find(
      (s: any) => s.node_type === "split_ab",
    );
    expect(step?.output_data?.matchedByTag).toBe(false);
  });

  it("matches tags case-insensitively by name", async () => {
    // Variant declares lowercase tag; lead carries mixed case.
    mockGetLeadTags.mockResolvedValue("Vip");
    const ctx = baseMock();
    const res = await executeWorkflow({
      supabase: ctx.sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition: twoPathDefinition([
        { id: "a", label: "A", percentage: 50 },
        { id: "b", label: "B", percentage: 50, tags: ["vip"] },
      ]),
      loopLimit: 10,
      context: {},
    });

    expect(res.success).toBe(true);
    const assignments = ctx.getInserted("workflow_split_assignments");
    expect(assignments[0].variant_id).toBe("b");
  });

  it("overrides a pre-existing sticky assignment when a tag rule matches", async () => {
    mockGetLeadTags.mockResolvedValue("VIP");
    const ctx = baseMock();
    // Lead was previously stuck to variant "a".
    ctx.mockTable("workflow_split_assignments", [
      {
        workflow_id: "wf-1",
        node_id: "ab1",
        lead_id: "lead-1",
        variant_id: "a",
        variant_label: "A",
      },
    ]);

    const result = await run(ctx.sb);
    expect(result.success).toBe(true);

    // The override upsert switches the lead to "b" despite the sticky row.
    const assignments = ctx.getInserted("workflow_split_assignments");
    expect(assignments).toHaveLength(1);
    expect(assignments[0].variant_id).toBe("b");
  });

  it("picks the first variant (array order) when several match", async () => {
    mockGetLeadTags.mockResolvedValue("Ouro,Prata");
    const ctx = baseMock();
    const result = await executeWorkflow({
      supabase: ctx.sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition: twoPathDefinition([
        { id: "a", label: "A", percentage: 50, tags: ["Prata"] },
        { id: "b", label: "B", percentage: 50, tags: ["Ouro"] },
      ]),
      loopLimit: 10,
      context: {},
    });

    expect(result.success).toBe(true);
    const assignments = ctx.getInserted("workflow_split_assignments");
    // Both match, but "a" is first in the array.
    expect(assignments[0].variant_id).toBe("a");
  });

  it("never queries lead tags when no variant declares tags", async () => {
    const ctx = baseMock();
    const result = await executeWorkflow({
      supabase: ctx.sb,
      executionId: "exec-1",
      workflowId: "wf-1",
      organizationId: "org-1",
      leadId: "lead-1",
      definition: twoPathDefinition([
        { id: "a", label: "A", percentage: 50 },
        { id: "b", label: "B", percentage: 50 },
      ]),
      loopLimit: 10,
      context: {},
    });

    expect(result.success).toBe(true);
    expect(mockGetLeadTags).not.toHaveBeenCalled();
    // roll = 0 → first variant "a"
    const assignments = ctx.getInserted("workflow_split_assignments");
    expect(assignments[0].variant_id).toBe("a");
  });
});
