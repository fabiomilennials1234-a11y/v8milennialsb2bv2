import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useNodesState, useEdgesState } from "@xyflow/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { WorkflowCanvas } from "@/components/automacoes/WorkflowCanvas";
import { WorkflowToolbar } from "@/components/automacoes/WorkflowToolbar";
import { WorkflowSidebar } from "@/components/automacoes/WorkflowSidebar";
import {
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
} from "@/hooks/useWorkflows";
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeData,
  WorkflowNodeType,
  TriggerNodeData,
  ActionNodeData,
  ConditionNodeData,
  DelayNodeData,
  CopilotNodeData,
  EndNodeData,
  WaitResponseNodeData,
  SplitAbNodeData,
  WebhookCallNodeData,
  GotoNodeData,
} from "@/types/workflow";

const DEFAULT_TRIGGER_NODE: WorkflowNode = {
  id: "trigger-1",
  type: "trigger",
  position: { x: 400, y: 50 },
  data: {
    type: "trigger",
    triggerType: "lead_created",
    config: {},
    label: "Trigger",
  } as TriggerNodeData,
};

function createDefaultNodeData(type: WorkflowNodeType): WorkflowNodeData {
  switch (type) {
    case "trigger":
      return { type: "trigger", triggerType: "lead_created", config: {}, label: "Trigger" } as TriggerNodeData;
    case "action":
      return { type: "action", actionType: "send_whatsapp", label: "Ação" } as ActionNodeData;
    case "condition":
      return { type: "condition", label: "Condição", field: "", operator: "equals", value: "" } as ConditionNodeData;
    case "delay":
      return { type: "delay", label: "Delay", amount: 1, unit: "hours" } as DelayNodeData;
    case "copilot":
      return { type: "copilot", label: "Copilot", agentId: "", agentName: "" } as CopilotNodeData;
    case "end":
      return { type: "end", label: "Fim" } as EndNodeData;
    case "wait_response":
      return { type: "wait_response", label: "Esperar Resposta", timeoutHours: 24, timeoutMinutes: 0, channel: "any" } as WaitResponseNodeData;
    case "split_ab":
      return { type: "split_ab", label: "Split A/B", splitPercentA: 50, variantALabel: "A", variantBLabel: "B" } as SplitAbNodeData;
    case "webhook_call":
      return { type: "webhook_call", label: "Webhook", url: "", method: "POST", bodyTemplate: "", outputVariable: "" } as WebhookCallNodeData;
    case "goto":
      return { type: "goto", label: "Ir Para", targetNodeId: "", targetNodeLabel: "" } as GotoNodeData;
  }
}

let nodeIdCounter = 1;

export default function AutomacoesEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === "novo";

  // Pre-configured trigger from URL (e.g. from Kanban badge)
  const preConfiguredTrigger = useMemo(() => {
    const trigger = searchParams.get("trigger");
    if (trigger !== "stage_changed") return null;
    const pipe_type = searchParams.get("pipe_type") || "";
    const pipeline_id = searchParams.get("pipeline_id") || "";
    const stage = searchParams.get("stage") || "";
    const stage_name = searchParams.get("stage_name") || "";
    return { pipe_type, pipeline_id, stage, stage_name };
  }, [searchParams]);

  const { data: workflow, isLoading } = useWorkflow(isNew ? undefined : id);
  const createWorkflow = useCreateWorkflow();
  const updateWorkflow = useUpdateWorkflow();

  const [name, setName] = useState("Novo Workflow");
  const [isActive, setIsActive] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([DEFAULT_TRIGGER_NODE]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowEdge>([]);

  // Load workflow data when editing
  useEffect(() => {
    if (workflow && !initialized) {
      setName(workflow.name);
      setIsActive(workflow.is_active);
      if (workflow.definition?.nodes?.length) {
        setNodes(workflow.definition.nodes);
        setEdges(workflow.definition.edges || []);
        // Track max node id for counter
        const maxId = workflow.definition.nodes.reduce((max, n) => {
          const num = parseInt(n.id.split("-").pop() || "0");
          return num > max ? num : max;
        }, 0);
        nodeIdCounter = maxId + 1;
      }
      setInitialized(true);
    }
  }, [workflow, initialized, setNodes, setEdges]);

  // For new workflows, apply pre-configured trigger if present
  useEffect(() => {
    if (isNew && !initialized) {
      if (preConfiguredTrigger) {
        const config: Record<string, unknown> = {};
        if (preConfiguredTrigger.pipe_type) config.pipe_type = preConfiguredTrigger.pipe_type;
        if (preConfiguredTrigger.pipeline_id) config.pipeline_id = preConfiguredTrigger.pipeline_id;
        if (preConfiguredTrigger.stage) config.stages = [preConfiguredTrigger.stage];

        const triggerNode: WorkflowNode = {
          id: "trigger-1",
          type: "trigger",
          position: { x: 400, y: 50 },
          data: {
            type: "trigger",
            triggerType: "stage_changed",
            config,
            label: preConfiguredTrigger.stage_name
              ? `Quando entra em "${preConfiguredTrigger.stage_name}"`
              : "Mudança de Estágio",
          } as TriggerNodeData,
        };
        setNodes([triggerNode]);
        setName(
          preConfiguredTrigger.stage_name
            ? `Automação — ${preConfiguredTrigger.stage_name}`
            : "Novo Workflow"
        );
      }
      setInitialized(true);
    }
  }, [isNew, initialized, preConfiguredTrigger, setNodes]);

  const handleAddNode = useCallback(
    (type: WorkflowNodeType) => {
      const newId = `${type}-${nodeIdCounter++}`;
      // Place below the last node
      const maxY = nodes.reduce((max, n) => Math.max(max, n.position.y), 0);
      const newNode: WorkflowNode = {
        id: newId,
        type,
        position: { x: 400, y: maxY + 150 },
        data: createDefaultNodeData(type),
      };
      setNodes((nds) => [...nds, newNode]);
      setSelectedNodeId(newId);
    },
    [nodes, setNodes]
  );

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleUpdateNode = useCallback(
    (nodeId: string, dataUpdates: Partial<WorkflowNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, ...dataUpdates } as any }
            : n
        )
      );
    },
    [setNodes]
  );

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      toast.error("Dê um nome ao workflow");
      return;
    }

    const triggerNode = nodes.find((n) => n.type === "trigger");
    if (!triggerNode) {
      toast.error("O workflow precisa de um nó Trigger");
      return;
    }

    const triggerData = triggerNode.data as unknown as TriggerNodeData;
    const definition = { nodes, edges };

    try {
      if (isNew) {
        const result = await createWorkflow.mutateAsync({
          name,
          is_active: isActive,
          trigger_type: triggerData.triggerType,
          trigger_config: triggerData.config,
          definition,
        });
        toast.success("Workflow criado!");
        navigate(`/automacoes/${result.id}`, { replace: true });
      } else {
        await updateWorkflow.mutateAsync({
          id: id!,
          name,
          is_active: isActive,
          trigger_type: triggerData.triggerType,
          trigger_config: triggerData.config,
          definition,
        });
        toast.success("Workflow salvo!");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar workflow");
    }
  }, [name, isActive, nodes, edges, isNew, id, createWorkflow, updateWorkflow, navigate]);

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId) || null
    : null;

  const isSaving = createWorkflow.isPending || updateWorkflow.isPending;

  if (!isNew && isLoading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] -m-6">
      <WorkflowToolbar
        name={name}
        onNameChange={setName}
        isActive={isActive}
        onToggleActive={() => setIsActive(!isActive)}
        onSave={handleSave}
        isSaving={isSaving}
        onAddNode={handleAddNode}
        isNew={isNew}
      />

      <div className="flex flex-1 overflow-hidden">
        <WorkflowCanvas
          initialNodes={nodes}
          initialEdges={edges}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          setEdges={setEdges}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
        />

        <WorkflowSidebar
          selectedNode={selectedNode as any}
          onClose={() => setSelectedNodeId(null)}
          onUpdateNode={handleUpdateNode}
          allNodes={nodes as any}
        />
      </div>
    </div>
  );
}
