import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  SelectionMode,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { TriggerNode } from "./nodes/TriggerNode";
import { ActionNode } from "./nodes/ActionNode";
import { ConditionNode } from "./nodes/ConditionNode";
import { DelayNode } from "./nodes/DelayNode";
import { CopilotNode } from "./nodes/CopilotNode";
import { EndNode } from "./nodes/EndNode";
import { WaitResponseNode } from "./nodes/WaitResponseNode";
import { SplitAbNode } from "./nodes/SplitAbNode";
import { WebhookCallNode } from "./nodes/WebhookCallNode";
import { GotoNode } from "./nodes/GotoNode";
import { WaitBusinessWindowNode } from "./nodes/WaitBusinessWindowNode";
import { AssignResponsibleNode } from "./nodes/AssignResponsibleNode";
import { CodeJsonNode } from "./nodes/CodeJsonNode";
import { CodeJavascriptNode } from "./nodes/CodeJavascriptNode";
import { CodeHttpsNode } from "./nodes/CodeHttpsNode";
import { AnimatedEdge } from "./edges/AnimatedEdge";
import { SelectionAutoPan } from "./SelectionAutoPan";
import type { WorkflowNode, WorkflowEdge } from "@/types/workflow";

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
  delay: DelayNode,
  copilot: CopilotNode,
  end: EndNode,
  wait_response: WaitResponseNode,
  split_ab: SplitAbNode,
  webhook_call: WebhookCallNode,
  goto: GotoNode,
  wait_business_window: WaitBusinessWindowNode,
  assign_responsible: AssignResponsibleNode,
  code_json: CodeJsonNode,
  code_javascript: CodeJavascriptNode,
  code_https: CodeHttpsNode,
};

const edgeTypes: EdgeTypes = {
  animated: AnimatedEdge,
};

interface WorkflowCanvasProps {
  initialNodes: WorkflowNode[];
  initialEdges: WorkflowEdge[];
  onNodesChange: ReturnType<typeof useNodesState>[2];
  onEdgesChange: ReturnType<typeof useEdgesState>[2];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  setEdges: ReturnType<typeof useEdgesState>[1];
  onNodeClick: (nodeId: string) => void;
  onPaneClick: () => void;
  /** Captura um snapshot do estado atual ANTES de uma mudança (para undo/redo). */
  onTakeSnapshot?: () => void;
}

export function WorkflowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setEdges,
  onNodeClick,
  onPaneClick,
  onTakeSnapshot,
}: WorkflowCanvasProps) {
  const onConnect = useCallback(
    (params: Connection) => {
      onTakeSnapshot?.();
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "animated",
            animated: true,
          },
          eds
        )
      );
    },
    [setEdges, onTakeSnapshot]
  );

  // Snapshot ao começar a arrastar um nó — assim o undo restaura a posição anterior.
  const handleNodeDragStart = useCallback(() => {
    onTakeSnapshot?.();
  }, [onTakeSnapshot]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: any) => {
      onNodeClick(node.id);
    },
    [onNodeClick]
  );

  // Protege o nó Trigger: ele é obrigatório pra salvar, então nunca pode sair
  // numa exclusão em massa. Filtra-o do conjunto a remover; se a seleção só
  // tinha o trigger, cancela a exclusão.
  const onBeforeDelete = useCallback(
    async ({ nodes: toDelete, edges: edgesToDelete }: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) => {
      const deletableNodes = toDelete.filter((n) => n.type !== "trigger");
      if (toDelete.length > 0 && deletableNodes.length === 0) return false;
      if (deletableNodes.length > 0 || edgesToDelete.length > 0) onTakeSnapshot?.();
      return { nodes: deletableNodes, edges: edgesToDelete };
    },
    [onTakeSnapshot]
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      type: "animated",
      animated: true,
    }),
    []
  );

  return (
    <div className="flex-1 h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onNodeDragStart={handleNodeDragStart}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={["Backspace", "Delete"]}
        onBeforeDelete={onBeforeDelete}
        // Seleção em massa estilo "área de trabalho":
        // Shift OU Ctrl/Cmd + arrastar = desenha a caixa de seleção (marquee).
        // Shift OU Ctrl/Cmd + clique = soma/remove um nó da seleção.
        // Arrastar sem modificador segue movendo o canvas (pan), como antes.
        // Com a seleção pronta: Delete/Backspace exclui em massa e Ctrl+C/Ctrl+V copia/cola.
        selectionMode={SelectionMode.Partial}
        selectionKeyCode={["Shift", "Meta", "Control"]}
        multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        selectionOnDrag={false}
        className="bg-background"
      >
        <SelectionAutoPan />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          className="!bg-background"
          color="hsl(var(--muted-foreground) / 0.2)"
        />
        <Controls
          className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent"
        />
        <MiniMap
          className="!bg-card !border-border !shadow-md"
          nodeColor="hsl(var(--primary) / 0.3)"
          maskColor="hsl(var(--background) / 0.7)"
        />
      </ReactFlow>
    </div>
  );
}
