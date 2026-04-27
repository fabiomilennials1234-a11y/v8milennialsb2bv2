import { X, Trash2, AlertTriangle } from "lucide-react";
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
import { WaitBusinessWindowPanel } from "./sidebar-panels/WaitBusinessWindowPanel";
import { AssignResponsiblePanel } from "./sidebar-panels/AssignResponsiblePanel";
import { NODE_LABELS } from "@/types/workflow";
import type { WorkflowNode, WorkflowNodeData } from "@/types/workflow";

/**
 * Fields that reference org-specific resources.
 * When null, they indicate the node needs configuration after import.
 */
const ORG_SPECIFIC_ID_FIELDS: Record<string, string> = {
  whatsappInstanceId: "Instância WhatsApp",
  campaignId: "Campanha",
  campaignStageId: "Estágio da Campanha",
  campaignTemplateId: "Template da Campanha",
  templateSourceId: "Fonte do Template",
  assigneeId: "Responsável",
  notifyMemberId: "Membro para Notificação",
  meetingCloserId: "Closer da Reunião",
  semiAutoApprover: "Aprovador Semi-Automático",
  aiAgentId: "Agente de IA",
  tagId: "Tag",
  tinyProductId: "Produto TinyERP",
  agentId: "Agente Copilot",
};

function getUnresolvedFields(data: Record<string, unknown>): string[] {
  const unresolved: string[] = [];
  for (const [field, label] of Object.entries(ORG_SPECIFIC_ID_FIELDS)) {
    if (field in data && data[field] === null) {
      unresolved.push(label);
    }
  }
  return unresolved;
}

interface WorkflowSidebarProps {
  selectedNode: WorkflowNode | null;
  onClose: () => void;
  onUpdateNode: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
  onDeleteNode?: (nodeId: string) => void;
  allNodes?: WorkflowNode[];
}

export function WorkflowSidebar({
  selectedNode,
  onClose,
  onUpdateNode,
  onDeleteNode,
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
      case "wait_business_window":
        return <WaitBusinessWindowPanel data={nodeData as any} onUpdate={handleUpdate} />;
      case "assign_responsible":
        return <AssignResponsiblePanel data={nodeData as any} onUpdate={handleUpdate} />;
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

      {/* Unresolved references warning */}
      {(() => {
        const unresolved = getUnresolvedFields(nodeData as unknown as Record<string, unknown>);
        if (unresolved.length === 0) return null;
        return (
          <div className="mx-4 mt-3 p-3 rounded-md border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950">
            <div className="flex items-center gap-2 text-sm font-medium text-orange-700 dark:text-orange-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Configuração pendente
            </div>
            <ul className="mt-1.5 text-xs text-orange-600 dark:text-orange-400 space-y-0.5 pl-6 list-disc">
              {unresolved.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {renderPanel()}
        </div>
      </ScrollArea>

      {/* Delete button */}
      {onDeleteNode && (
        <div className="px-4 py-3 border-t">
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => onDeleteNode(selectedNode.id)}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Excluir Nó
          </Button>
        </div>
      )}
    </div>
  );
}
