import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TriggerPanel } from "./sidebar-panels/TriggerPanel";
import { ActionPanel } from "./sidebar-panels/ActionPanel";
import { ConditionPanel } from "./sidebar-panels/ConditionPanel";
import { DelayPanel } from "./sidebar-panels/DelayPanel";
import { CopilotPanel } from "./sidebar-panels/CopilotPanel";
import { WaitResponsePanel } from "./sidebar-panels/WaitResponsePanel";
import { SplitAbPanel } from "./sidebar-panels/SplitAbPanel";
import { WebhookCallPanel } from "./sidebar-panels/WebhookCallPanel";
import { GotoPanel } from "./sidebar-panels/GotoPanel";
import { NODE_LABELS } from "@/types/workflow";
import type { WorkflowNode, WorkflowNodeData } from "@/types/workflow";

interface WorkflowSidebarProps {
  selectedNode: WorkflowNode | null;
  onClose: () => void;
  onUpdateNode: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
  allNodes?: WorkflowNode[];
}

export function WorkflowSidebar({
  selectedNode,
  onClose,
  onUpdateNode,
  allNodes = [],
}: WorkflowSidebarProps) {
  if (!selectedNode) return null;

  const nodeData = selectedNode.data as unknown as WorkflowNodeData;
  const nodeType = nodeData.type;
  const title = NODE_LABELS[nodeType] || "Configuração";

  const handleUpdate = (updates: Partial<WorkflowNodeData>) => {
    onUpdateNode(selectedNode.id, updates);
  };

  const renderPanel = () => {
    switch (nodeType) {
      case "trigger":
        return <TriggerPanel data={nodeData as any} onUpdate={handleUpdate} />;
      case "action":
        return <ActionPanel data={nodeData as any} onUpdate={handleUpdate} />;
      case "condition":
        return <ConditionPanel data={nodeData as any} onUpdate={handleUpdate} />;
      case "delay":
        return <DelayPanel data={nodeData as any} onUpdate={handleUpdate} />;
      case "copilot":
        return <CopilotPanel data={nodeData as any} onUpdate={handleUpdate} />;
      case "wait_response":
        return <WaitResponsePanel data={nodeData as any} onUpdate={handleUpdate} />;
      case "split_ab":
        return <SplitAbPanel data={nodeData as any} onUpdate={handleUpdate} />;
      case "webhook_call":
        return <WebhookCallPanel data={nodeData as any} onUpdate={handleUpdate} />;
      case "goto":
        return <GotoPanel data={nodeData as any} onUpdate={handleUpdate} allNodes={allNodes} />;
      case "end":
        return (
          <p className="text-sm text-muted-foreground p-4">
            Este nó encerra o workflow. Não há configurações adicionais.
          </p>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-[360px] border-l bg-card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">Configurar {title}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {renderPanel()}
        </div>
      </ScrollArea>
    </div>
  );
}
