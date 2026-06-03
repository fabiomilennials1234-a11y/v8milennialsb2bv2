import type { WorkflowNode, WorkflowEdge, GotoNodeData } from "@/types/workflow";

/**
 * A copyable slice of a workflow graph: a set of nodes plus the edges whose
 * BOTH endpoints live inside that set (internal edges only). Edges that cross
 * the selection boundary are intentionally dropped — they reference nodes that
 * are not being cloned.
 */
export interface WorkflowSelection {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** Offset applied to pasted nodes so they don't overlap the originals. */
export const PASTE_OFFSET = { x: 60, y: 60 } as const;

/** Trigger is singular per workflow — never copyable nor pastable. */
function isCopyable(node: WorkflowNode): boolean {
  return node.type !== "trigger";
}

/**
 * Extracts the currently selected, copyable nodes plus their internal edges.
 *
 * - Trigger nodes are filtered out (a workflow has exactly one trigger; cloning
 *   it would produce an invalid graph).
 * - Only edges whose source AND target are both in the selection are kept.
 */
export function extractSelection(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): WorkflowSelection {
  const selected = nodes.filter((n) => n.selected && isCopyable(n));
  const selectedIds = new Set(selected.map((n) => n.id));
  const internalEdges = edges.filter(
    (e) => selectedIds.has(e.source) && selectedIds.has(e.target)
  );
  return { nodes: selected, edges: internalEdges };
}

/** Deep clone of plain (JSON-serializable) node data. */
function cloneData<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

/**
 * Clones a selection into a fresh, independent subgraph.
 *
 * - New node ids are minted via `genNodeId(type)` (shared with the editor's
 *   counter so ids stay globally unique within the graph).
 * - Edges are remapped to the new node ids; `sourceHandle`/`targetHandle` are
 *   PRESERVED verbatim (split_ab variant handles like `variant_a` live in the
 *   node data, which is cloned untouched, so the handle remains valid).
 * - GotoNode.targetNodeId is remapped when the target is inside the selection;
 *   when the target is outside, the original reference is kept (the jump still
 *   points at a real, existing node).
 * - Pasted nodes are marked `selected: true`; originals should be deselected by
 *   the caller. Positions are offset so the clone is visible.
 */
export function cloneSelection(
  selection: WorkflowSelection,
  genNodeId: (type: string) => string,
  offset: { x: number; y: number } = PASTE_OFFSET
): WorkflowSelection {
  const copyable = selection.nodes.filter(isCopyable);

  // Build old -> new id map first so edges and goto refs can be remapped.
  const idMap = new Map<string, string>();
  for (const node of copyable) {
    idMap.set(node.id, genNodeId(String(node.type)));
  }

  const clonedNodes: WorkflowNode[] = copyable.map((node) => {
    const newId = idMap.get(node.id)!;
    const data = cloneData(node.data);

    // Remap internal goto targets; leave external targets as-is.
    if (data.type === "goto") {
      const goto = data as GotoNodeData;
      if (goto.targetNodeId && idMap.has(goto.targetNodeId)) {
        goto.targetNodeId = idMap.get(goto.targetNodeId)!;
      }
    }

    return {
      ...node,
      id: newId,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      data,
      selected: true,
    };
  });

  const clonedEdges: WorkflowEdge[] = selection.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((edge, i) => {
      const source = idMap.get(edge.source)!;
      const target = idMap.get(edge.target)!;
      return {
        ...edge,
        id: `${source}__${target}__${i}`,
        source,
        target,
        // sourceHandle / targetHandle preserved verbatim — variant handles are
        // valid because node.data (which defines them) is cloned untouched.
        selected: false,
      };
    });

  return { nodes: clonedNodes, edges: clonedEdges };
}
