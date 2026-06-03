import { describe, it, expect } from "vitest";
import { extractSelection, cloneSelection, PASTE_OFFSET } from "./clipboard";
import type {
  WorkflowNode,
  WorkflowEdge,
  ActionNodeData,
  GotoNodeData,
  SplitAbNodeData,
  TriggerNodeData,
} from "@/types/workflow";

// ---- factories -------------------------------------------------------------

function actionNode(
  id: string,
  selected: boolean,
  extra: Partial<ActionNodeData> = {}
): WorkflowNode {
  return {
    id,
    type: "action",
    position: { x: 100, y: 100 },
    selected,
    data: {
      type: "action",
      actionType: "send_whatsapp",
      label: "Ação",
      messageTemplate: "msg X",
      ...extra,
    } as ActionNodeData,
  };
}

function gotoNode(id: string, targetNodeId: string, selected: boolean): WorkflowNode {
  return {
    id,
    type: "goto",
    position: { x: 200, y: 200 },
    selected,
    data: {
      type: "goto",
      label: "Ir Para",
      targetNodeId,
    } as GotoNodeData,
  };
}

function splitNode(id: string, selected: boolean): WorkflowNode {
  return {
    id,
    type: "split_ab",
    position: { x: 300, y: 300 },
    selected,
    data: {
      type: "split_ab",
      label: "Split A/B",
      variants: [
        { id: "a", label: "A", percentage: 50 },
        { id: "b", label: "B", percentage: 50 },
      ],
    } as SplitAbNodeData,
  };
}

function triggerNode(selected: boolean): WorkflowNode {
  return {
    id: "trigger-1",
    type: "trigger",
    position: { x: 0, y: 0 },
    selected,
    data: {
      type: "trigger",
      triggerType: "lead_created",
      config: {},
      label: "Trigger",
    } as TriggerNodeData,
  };
}

function edge(id: string, source: string, target: string, sourceHandle?: string): WorkflowEdge {
  return { id, source, target, sourceHandle, type: "animated", animated: true };
}

/** Deterministic id generator mirroring the editor's counter. */
function makeGen() {
  let n = 100;
  return (type: string) => `${type}-${n++}`;
}

// ---- extractSelection ------------------------------------------------------

describe("extractSelection", () => {
  it("returns only selected, copyable nodes", () => {
    const nodes = [actionNode("a", true), actionNode("b", false)];
    const sel = extractSelection(nodes, []);
    expect(sel.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("excludes the trigger even when selected", () => {
    const nodes = [triggerNode(true), actionNode("a", true)];
    const sel = extractSelection(nodes, []);
    expect(sel.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("keeps only edges with BOTH endpoints inside the selection", () => {
    const nodes = [actionNode("a", true), actionNode("b", true), actionNode("c", false)];
    const edges = [
      edge("e-ab", "a", "b"), // internal — kept
      edge("e-bc", "b", "c"), // crosses boundary — dropped
      edge("e-ca", "c", "a"), // crosses boundary — dropped
    ];
    const sel = extractSelection(nodes, edges);
    expect(sel.edges.map((e) => e.id)).toEqual(["e-ab"]);
  });

  it("returns empty selection when nothing is selected", () => {
    const sel = extractSelection([actionNode("a", false)], []);
    expect(sel.nodes).toHaveLength(0);
    expect(sel.edges).toHaveLength(0);
  });
});

// ---- cloneSelection --------------------------------------------------------

describe("cloneSelection", () => {
  it("mints new ids and offsets position; clone is independent of original", () => {
    const original = actionNode("a", true);
    const sel = { nodes: [original], edges: [] };
    const cloned = cloneSelection(sel, makeGen());

    expect(cloned.nodes).toHaveLength(1);
    const clone = cloned.nodes[0];
    expect(clone.id).not.toBe("a");
    expect(clone.id).toBe("action-100");
    expect(clone.position).toEqual({ x: 100 + PASTE_OFFSET.x, y: 100 + PASTE_OFFSET.y });
    expect(clone.selected).toBe(true);

    // Mutating the clone must not touch the original.
    (clone.data as ActionNodeData).messageTemplate = "mutated";
    expect((original.data as ActionNodeData).messageTemplate).toBe("msg X");
  });

  it("remaps internal edges to new node ids", () => {
    const sel = {
      nodes: [actionNode("a", true), actionNode("b", true)],
      edges: [edge("e-ab", "a", "b")],
    };
    const cloned = cloneSelection(sel, makeGen());
    const [na, nb] = cloned.nodes;
    expect(cloned.edges).toHaveLength(1);
    expect(cloned.edges[0].source).toBe(na.id);
    expect(cloned.edges[0].target).toBe(nb.id);
    expect(cloned.edges[0].id).not.toBe("e-ab");
  });

  it("remaps goto target when it is INSIDE the selection", () => {
    const sel = {
      nodes: [gotoNode("g", "a", true), actionNode("a", true)],
      edges: [],
    };
    const cloned = cloneSelection(sel, makeGen());
    const clonedGoto = cloned.nodes.find((n) => n.type === "goto")!;
    const clonedTarget = cloned.nodes.find((n) => n.type === "action")!;
    expect((clonedGoto.data as GotoNodeData).targetNodeId).toBe(clonedTarget.id);
  });

  it("keeps goto target as-is when it is OUTSIDE the selection", () => {
    const sel = { nodes: [gotoNode("g", "external-node", true)], edges: [] };
    const cloned = cloneSelection(sel, makeGen());
    expect((cloned.nodes[0].data as GotoNodeData).targetNodeId).toBe("external-node");
  });

  it("preserves split_ab variant sourceHandle while remapping the source node", () => {
    const sel = {
      nodes: [splitNode("s", true), actionNode("a", true)],
      edges: [edge("e", "s", "a", "variant_a")],
    };
    const cloned = cloneSelection(sel, makeGen());
    const clonedSplit = cloned.nodes.find((n) => n.type === "split_ab")!;
    expect(cloned.edges[0].source).toBe(clonedSplit.id);
    expect(cloned.edges[0].sourceHandle).toBe("variant_a");
  });

  it("filters trigger nodes out of the clone", () => {
    const sel = { nodes: [triggerNode(true), actionNode("a", true)], edges: [] };
    const cloned = cloneSelection(sel, makeGen());
    expect(cloned.nodes).toHaveLength(1);
    expect(cloned.nodes[0].type).toBe("action");
  });

  it("produces unique edge ids for parallel edges", () => {
    const sel = {
      nodes: [splitNode("s", true), actionNode("a", true)],
      edges: [
        edge("e1", "s", "a", "variant_a"),
        edge("e2", "s", "a", "variant_b"),
      ],
    };
    const cloned = cloneSelection(sel, makeGen());
    const ids = cloned.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
