// @vitest-environment node
/**
 * Unit tests for workflow trigger origin guard (#158).
 *
 * When fireTrigger is called with source='copilot', workflows containing
 * a 'copilot' node should be excluded to prevent loops:
 * copilot move → stage_changed → workflow → copilot node → copilot move → ...
 *
 * The dedup already prevents same-workflow re-fire, but the origin guard
 * is a semantic safety net for cross-workflow copilot chains.
 */

import { describe, it, expect } from "vitest";

interface WorkflowDefinition {
  nodes: { id: string; type: string; data: Record<string, unknown> }[];
  edges: { id: string; source: string; target: string }[];
}

function workflowHasCopilotNode(definition: WorkflowDefinition | null | undefined): boolean {
  if (!definition?.nodes) return false;
  return definition.nodes.some((n) => n.type === "copilot");
}

function shouldSkipWorkflow(params: {
  source?: string;
  definition: WorkflowDefinition | null;
}): boolean {
  if (params.source === "copilot" && workflowHasCopilotNode(params.definition)) {
    return true;
  }
  return false;
}

describe("workflowHasCopilotNode — detects copilot nodes in DAG", () => {
  it("returns false for null/undefined definition", () => {
    expect(workflowHasCopilotNode(null)).toBe(false);
    expect(workflowHasCopilotNode(undefined)).toBe(false);
  });

  it("returns false for empty nodes array", () => {
    expect(workflowHasCopilotNode({ nodes: [], edges: [] })).toBe(false);
  });

  it("returns false for workflow with only action/condition nodes", () => {
    const def: WorkflowDefinition = {
      nodes: [
        { id: "1", type: "trigger", data: {} },
        { id: "2", type: "action", data: { actionType: "move_stage" } },
        { id: "3", type: "condition", data: {} },
        { id: "4", type: "delay", data: {} },
      ],
      edges: [],
    };
    expect(workflowHasCopilotNode(def)).toBe(false);
  });

  it("returns true when a copilot node exists", () => {
    const def: WorkflowDefinition = {
      nodes: [
        { id: "1", type: "trigger", data: {} },
        { id: "2", type: "copilot", data: { agentId: "agent-x" } },
        { id: "3", type: "action", data: {} },
      ],
      edges: [],
    };
    expect(workflowHasCopilotNode(def)).toBe(true);
  });

  it("returns true even if copilot node is deep in the DAG", () => {
    const def: WorkflowDefinition = {
      nodes: [
        { id: "1", type: "trigger", data: {} },
        { id: "2", type: "condition", data: {} },
        { id: "3", type: "delay", data: {} },
        { id: "4", type: "action", data: {} },
        { id: "5", type: "copilot", data: { agentId: "agent-y" } },
      ],
      edges: [],
    };
    expect(workflowHasCopilotNode(def)).toBe(true);
  });
});

describe("shouldSkipWorkflow — origin guard logic", () => {
  const defWithCopilot: WorkflowDefinition = {
    nodes: [
      { id: "1", type: "trigger", data: {} },
      { id: "2", type: "copilot", data: { agentId: "x" } },
    ],
    edges: [],
  };

  const defWithoutCopilot: WorkflowDefinition = {
    nodes: [
      { id: "1", type: "trigger", data: {} },
      { id: "2", type: "action", data: { actionType: "send_message" } },
    ],
    edges: [],
  };

  it("skips copilot-containing workflow when source=copilot", () => {
    expect(shouldSkipWorkflow({ source: "copilot", definition: defWithCopilot })).toBe(true);
  });

  it("does NOT skip copilot-containing workflow when source is undefined", () => {
    expect(shouldSkipWorkflow({ source: undefined, definition: defWithCopilot })).toBe(false);
  });

  it("does NOT skip copilot-containing workflow when source=manual", () => {
    expect(shouldSkipWorkflow({ source: "manual", definition: defWithCopilot })).toBe(false);
  });

  it("does NOT skip non-copilot workflow even when source=copilot", () => {
    expect(shouldSkipWorkflow({ source: "copilot", definition: defWithoutCopilot })).toBe(false);
  });

  it("does NOT skip when definition is null", () => {
    expect(shouldSkipWorkflow({ source: "copilot", definition: null })).toBe(false);
  });
});
