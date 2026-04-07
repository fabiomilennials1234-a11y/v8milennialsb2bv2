import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
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
import { AnimatedEdge } from "./edges/AnimatedEdge";
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
}

export function WorkflowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setEdges,
  onNodeClick,
  onPaneClick,
}: WorkflowCanvasProps) {
  const onConnect = useCallback(
    (params: Connection) => {
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
    [setEdges]
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: any) => {
      onNodeClick(node.id);
    },
    [onNodeClick]
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
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={["Backspace", "Delete"]}
        className="bg-background"
      >
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
