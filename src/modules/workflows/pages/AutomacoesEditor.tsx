import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useNodesState, useEdgesState } from "@xyflow/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  extractSelection,
  cloneSelection,
  type WorkflowSelection,
} from "@/modules/workflows/lib/clipboard";
import { upgradeWorkflowNodes } from "@/modules/workflows/lib/upgradeLegacyMessageNode";
import { UNIFIED_MESSAGE_NODE_FLAG } from "@/types/workflow";
import { useFeatureFlag } from "@/modules/platform";

import { WorkflowCanvas } from "@/modules/workflows/components/WorkflowCanvas";
import { WorkflowToolbar } from "@/modules/workflows/components/WorkflowToolbar";
import { WorkflowSidebar } from "@/modules/workflows/components/WorkflowSidebar";
import { WorkflowAnalytics } from "@/modules/workflows/components/WorkflowAnalytics";
import { EnrollmentCriteria, EMPTY_ENROLLMENT } from "@/modules/workflows/components/EnrollmentCriteria";
import { ReenrollmentConfig, DEFAULT_REENROLLMENT } from "@/modules/workflows/components/ReenrollmentConfig";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
} from "@/modules/workflows/hooks/useWorkflows";
import { useExportWorkflow } from "@/modules/workflows/hooks/useWorkflowPortability";
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
  WaitBusinessWindowNodeData,
  AssignResponsibleNodeData,
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
      return { type: "condition", label: "Condição", field: "", operator: "equals", value: "", conditionMode: "field" } as ConditionNodeData;
    case "delay":
      return { type: "delay", label: "Delay", amount: 1, unit: "hours" } as DelayNodeData;
    case "copilot":
      return { type: "copilot", label: "Copilot", agentId: "", agentName: "" } as CopilotNodeData;
    case "end":
      return { type: "end", label: "Fim" } as EndNodeData;
    case "wait_response":
      return { type: "wait_response", label: "Esperar Resposta", timeoutHours: 24, timeoutMinutes: 0, channel: "any" } as WaitResponseNodeData;
    case "split_ab":
      return {
        type: "split_ab",
        label: "Split A/B",
        variants: [
          { id: "a", label: "A", percentage: 50 },
          { id: "b", label: "B", percentage: 50 },
        ],
      } as SplitAbNodeData;
    case "webhook_call":
      return { type: "webhook_call", label: "Webhook", url: "", method: "POST", bodyTemplate: "", outputVariable: "" } as WebhookCallNodeData;
    case "goto":
      return { type: "goto", label: "Ir Para", targetNodeId: "", targetNodeLabel: "" } as GotoNodeData;
    case "wait_business_window":
      return {
        type: "wait_business_window",
        label: "Janela Comercial",
        days: ["seg", "ter", "qua", "qui", "sex"],
        startTime: "08:00",
        endTime: "18:00",
        timezone: "America/Sao_Paulo",
      } as WaitBusinessWindowNodeData;
    case "assign_responsible":
      return {
        type: "assign_responsible",
        label: "Definir Responsável",
        assignMode: "round_robin",
        assignTarget: "responsible",
      } as AssignResponsibleNodeData;
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
  const handleExport = useExportWorkflow();

  const [name, setName] = useState("Novo Workflow");
  const [isActive, setIsActive] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [enrollment, setEnrollment] = useState(EMPTY_ENROLLMENT);
  const [reenrollment, setReenrollment] = useState(DEFAULT_REENROLLMENT);

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([DEFAULT_TRIGGER_NODE]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowEdge>([]);

  // Node unificado gateado por org (ADR-0012). Fail-closed: só converte os nós
  // legados quando a flag está ON para a org corrente.
  const { enabled: unifiedEnabled, isLoading: unifiedLoading } =
    useFeatureFlag(UNIFIED_MESSAGE_NODE_FLAG);

  // In-memory clipboard for copy/paste of node subgraphs (same editor only).
  const clipboardRef = useRef<WorkflowSelection | null>(null);

  // Mint a fresh, globally-unique node id from the shared counter.
  const genNodeId = useCallback((type: string) => `${type}-${nodeIdCounter++}`, []);

  // Load workflow data when editing
  useEffect(() => {
    // Aguarda a flag resolver antes de inicializar, para não migrar nós com o
    // valor fail-closed (false) e depois "pular" para o convertido.
    if (workflow && !initialized && !unifiedLoading) {
      setName(workflow.name);
      setIsActive(workflow.is_active);
      if (workflow.definition?.nodes?.length) {
        // Lazy migration (ADR-0012): legacy WhatsApp send nodes become the
        // unified send_whatsapp_message node; persisted on next save. Gateado
        // por org — orgs sem a flag mantêm os nós legados intactos.
        setNodes(
          unifiedEnabled
            ? upgradeWorkflowNodes(workflow.definition.nodes)
            : workflow.definition.nodes,
        );
        setEdges(workflow.definition.edges || []);
        // Track max node id for counter
        const maxId = workflow.definition.nodes.reduce((max, n) => {
          const num = parseInt(n.id.split("-").pop() || "0");
          return num > max ? num : max;
        }, 0);
        nodeIdCounter = maxId + 1;
      }
      // Load enrollment/reenrollment from DB columns
      const wf = workflow as any;
      if (wf.enrollment_criteria && typeof wf.enrollment_criteria === "object") {
        setEnrollment({
          enabled: wf.enrollment_criteria.enabled ?? false,
          match_all: wf.enrollment_criteria.match_all ?? true,
          conditions: wf.enrollment_criteria.conditions ?? [],
        });
      }
      if (wf.re_enrollment_enabled != null) {
        setReenrollment({
          enabled: wf.re_enrollment_enabled ?? false,
          cooldown_days: wf.re_enrollment_cooldown_days ?? 30,
          max_times: wf.re_enrollment_max_times ?? 1,
        });
      }
      setInitialized(true);
    }
  }, [workflow, initialized, setNodes, setEdges, unifiedEnabled, unifiedLoading]);

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
      const newId = genNodeId(type);
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
    [nodes, setNodes, genNodeId]
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

      // Clean up orphaned edges when split_ab variants change
      if ("variants" in dataUpdates && Array.isArray((dataUpdates as any).variants)) {
        const validHandles = new Set(
          ((dataUpdates as any).variants as { id: string }[]).map(
            (v) => `variant_${v.id}`
          )
        );
        setEdges((eds) =>
          eds.filter((e) => {
            if (e.source !== nodeId) return true;
            if (!e.sourceHandle) return true;
            return validHandles.has(e.sourceHandle);
          })
        );
      }
    },
    [setNodes, setEdges]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
    },
    [setNodes, setEdges]
  );

  // Paste a cloned selection into the graph: deselect originals, append clones,
  // select the clones, and focus the single pasted node (if exactly one).
  const pasteSelection = useCallback(
    (selection: WorkflowSelection) => {
      const cloned = cloneSelection(selection, genNodeId);
      if (cloned.nodes.length === 0) return 0;
      setNodes((nds) => [
        ...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
        ...cloned.nodes,
      ]);
      if (cloned.edges.length > 0) {
        setEdges((eds) => [...eds, ...cloned.edges]);
      }
      setSelectedNodeId(cloned.nodes.length === 1 ? cloned.nodes[0].id : null);
      return cloned.nodes.length;
    },
    [genNodeId, setNodes, setEdges]
  );

  // Ctrl/Cmd+C — capture selected copyable nodes + internal edges to clipboard.
  const handleCopy = useCallback((): number => {
    const selection = extractSelection(nodes, edges);
    if (selection.nodes.length === 0) return 0;
    clipboardRef.current = selection;
    toast.success(`${selection.nodes.length} nó(s) copiado(s)`);
    return selection.nodes.length;
  }, [nodes, edges]);

  // Ctrl/Cmd+V — paste the clipboard contents (no-op if empty).
  const handlePaste = useCallback((): number => {
    const clip = clipboardRef.current;
    if (!clip || clip.nodes.length === 0) return 0;
    const count = pasteSelection(clip);
    if (count > 0) toast.success(`${count} nó(s) colado(s)`);
    return count;
  }, [pasteSelection]);

  // Ctrl/Cmd+D — duplicate the current selection without touching the clipboard.
  // Falls back to the sidebar-selected node when nothing is multi-selected.
  const handleDuplicate = useCallback((): number => {
    let selection = extractSelection(nodes, edges);
    if (selection.nodes.length === 0 && selectedNodeId) {
      const node = nodes.find((n) => n.id === selectedNodeId && n.type !== "trigger");
      if (node) selection = { nodes: [node], edges: [] };
    }
    if (selection.nodes.length === 0) return 0;
    const count = pasteSelection(selection);
    if (count > 0) toast.success(`${count} nó(s) duplicado(s)`);
    return count;
  }, [nodes, edges, selectedNodeId, pasteSelection]);

  // Duplicate a single node by id (sidebar "Duplicar" button).
  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || node.type === "trigger") return;
      const count = pasteSelection({ nodes: [node], edges: [] });
      if (count > 0) toast.success("Nó duplicado");
    },
    [nodes, pasteSelection]
  );

  // Keyboard shortcuts — ignored while typing in form fields.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (e.key.toLowerCase()) {
        case "c":
          if (handleCopy() > 0) e.preventDefault();
          break;
        case "v":
          if (handlePaste() > 0) e.preventDefault();
          break;
        case "d":
          e.preventDefault(); // always — overrides browser "bookmark"
          handleDuplicate();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCopy, handlePaste, handleDuplicate]);

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

    // Build extra fields for enrollment/reenrollment
    const extraFields = {
      enrollment_criteria: enrollment,
      re_enrollment_enabled: reenrollment.enabled,
      re_enrollment_cooldown_days: reenrollment.cooldown_days,
      re_enrollment_max_times: reenrollment.max_times,
    };

    try {
      if (isNew) {
        const result = await createWorkflow.mutateAsync({
          name,
          is_active: isActive,
          trigger_type: triggerData.triggerType,
          trigger_config: triggerData.config,
          definition,
          ...extraFields,
        } as any);
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
          ...extraFields,
        } as any);
        toast.success("Workflow salvo!");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar workflow");
    }
  }, [name, isActive, nodes, edges, isNew, id, createWorkflow, updateWorkflow, navigate, enrollment, reenrollment]);

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
        workflowId={id}
        onExport={!isNew && workflow ? () => handleExport(workflow) : undefined}
        onOpenSettings={() => setSettingsOpen(true)}
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
          onDeleteNode={handleDeleteNode}
          onDuplicateNode={handleDuplicateNode}
          allNodes={nodes as any}
        />
      </div>

      {/* Workflow Settings Sheet — enrollment + reenrollment + analytics */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent className="sm:max-w-lg p-0 flex flex-col">
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/50">
            <SheetTitle>Configuracoes do workflow</SheetTitle>
          </SheetHeader>
          <Tabs defaultValue="enrollment" className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="mx-6 mt-3 w-auto justify-start bg-muted/50">
              <TabsTrigger value="enrollment">Inscricao</TabsTrigger>
              <TabsTrigger value="reenrollment">Re-inscricao</TabsTrigger>
              {!isNew && id && <TabsTrigger value="analytics">Analytics</TabsTrigger>}
            </TabsList>

            <TabsContent value="enrollment" className="flex-1 overflow-hidden mt-0">
              <ScrollArea className="h-full">
                <div className="px-6 py-4">
                  <EnrollmentCriteria value={enrollment} onChange={setEnrollment} />
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="reenrollment" className="flex-1 overflow-hidden mt-0">
              <ScrollArea className="h-full">
                <div className="px-6 py-4">
                  <ReenrollmentConfig value={reenrollment} onChange={setReenrollment} />
                </div>
              </ScrollArea>
            </TabsContent>

            {!isNew && id && (
              <TabsContent value="analytics" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full">
                  <div className="px-6 py-4">
                    <WorkflowAnalytics workflowId={id} />
                  </div>
                </ScrollArea>
              </TabsContent>
            )}
          </Tabs>
        </SheetContent>
      </Sheet>
    </div>
  );
}
