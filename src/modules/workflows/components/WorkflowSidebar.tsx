import { getGuidedConditionFields } from '../lib/guided-condition-summary';
import { useState } from 'react';
import { X, Trash2, AlertTriangle, Copy, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TriggerPanel } from "./sidebar-panels/TriggerPanel";
import { ActionPanel } from "./sidebar-panels/ActionPanel";
import { ConditionPanel } from "./sidebar-panels/ConditionPanel";
import { GuidedConditionPanel } from "./sidebar-panels/GuidedConditionPanel";
import { WorkflowDataGrantPanel } from "./sidebar-panels/WorkflowDataGrantPanel";
import { DelayPanel } from "./sidebar-panels/DelayPanel";
import { CopilotPanel } from "./sidebar-panels/CopilotPanel";
import { WaitResponsePanel } from "./sidebar-panels/WaitResponsePanel";
import { SplitAbPanel } from "./sidebar-panels/SplitAbPanel";
import { WebhookCallPanel } from "./sidebar-panels/WebhookCallPanel";
import { GotoPanel } from "./sidebar-panels/GotoPanel";
import { WaitBusinessWindowPanel } from "./sidebar-panels/WaitBusinessWindowPanel";
import { AssignResponsiblePanel } from "./sidebar-panels/AssignResponsiblePanel";
import { CodeJsonPanel } from "./sidebar-panels/CodeJsonPanel";
import { CodeJavascriptPanel } from "./sidebar-panels/CodeJavascriptPanel";
import { CodeHttpsPanel } from "./sidebar-panels/CodeHttpsPanel";
import { NODE_LABELS } from "@/types/workflow";
import type { WorkflowNode, WorkflowNodeData, ConditionNodeData } from "@/types/workflow";

/**
 * Fields that reference org-specific resources.
 * When null, they indicate the node needs configuration after import.
 */
const ORG_SPECIFIC_ID_FIELDS: Record<string, string> = {
  whatsappInstanceId: "Instância WhatsApp",
  // Recuo da Instance Routing Policy (ADR-0025) — também é uma Instance da org,
  // então um workflow importado precisa avisar que ele ficou por configurar.
  fallbackInstanceId: "Instância de recuo",
  campaignId: "Campanha",
  campaignStageId: "Etapa da Campanha",
  campaignTemplateId: "Template da Campanha",
  templateSourceId: "Fonte do Template",
  assigneeId: "Responsável",
  notifyMemberId: "Membro para Notificação",
  meetingCloserId: "Vendedor da Reunião",
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

function getLegacyConditionReview(data: ConditionNodeData): { details: string; source: Record<string, unknown> } | null {
  const review = data.legacyConditionReview;
  if (!review || typeof review !== "object" || Array.isArray(review)) return null;
  const value = review as Record<string, unknown>;
  if (typeof value.details !== "string" || !value.source || typeof value.source !== "object" || Array.isArray(value.source)) return null;
  return { details: value.details, source: value.source as Record<string, unknown> };
}

interface WorkflowSidebarProps {
  actorId?: string;
  workflowId?: string;
  canManageDataGrant?: boolean;
  organizationId?: string;
  selectedNode: WorkflowNode | null;
  onClose: () => void;
  onUpdateNode: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
  onDeleteNode?: (nodeId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
  allNodes?: WorkflowNode[];
}

export function WorkflowSidebar({
  actorId,
  workflowId,
  canManageDataGrant = false,
  organizationId,
  selectedNode,
  onClose,
  onUpdateNode,
  onDeleteNode,
  onDuplicateNode,
  allNodes = [],
}: WorkflowSidebarProps) {
  const [expanded, setExpanded] = useState(false);
  if (!selectedNode) return null;

  const nodeData = selectedNode.data as unknown as WorkflowNodeData;
  const nodeType = nodeData.type;
  // Trigger is singular per workflow — never duplicable.
  const canDuplicate = nodeType !== "trigger";
  const guided = nodeType === 'condition' && Boolean((nodeData as ConditionNodeData).guidedCondition);
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
        if ((nodeData as ConditionNodeData).guidedCondition) {
          const legacyReview = getLegacyConditionReview(nodeData as ConditionNodeData);
          const source = legacyReview?.source;
          return <>{legacyReview && <div role="note" className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm">
            <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div><p className="font-medium">Correção pendente da regra antiga</p>
                <p className="mt-1 text-muted-foreground">Antes: {String(source?.field ?? "sem campo")} · {String(source?.operator ?? "sem operador")}{source?.value ? ` · ${String(source.value)}` : ""}</p>
                <p className="mt-1 text-muted-foreground">{legacyReview.details}</p>
              </div></div>
          </div>}<GuidedConditionPanel
            key={`${actorId}:${organizationId}:${selectedNode.id}`}
            actorId={actorId ?? ''}
            organizationId={organizationId ?? ''}
            condition={(nodeData as ConditionNodeData).guidedCondition!}
            onChange={guidedCondition => handleUpdate({ guidedCondition, legacyConditionReview: undefined })}
          />{workflowId && organizationId && <WorkflowDataGrantPanel
            key={`${actorId}:${organizationId}:${workflowId}`}
            actorId={actorId ?? ''}
            workflowId={workflowId} organizationId={organizationId} canManage={canManageDataGrant}
            requiredFields={getGuidedConditionFields((nodeData as ConditionNodeData).guidedCondition!)}
          />}</>;
        }
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
      case "code_json":
        return <CodeJsonPanel data={nodeData as any} onUpdate={handleUpdate} />;
      case "code_javascript":
        return <CodeJavascriptPanel data={nodeData as any} onUpdate={handleUpdate} />;
      case "code_https":
        return <CodeHttpsPanel data={nodeData as any} onUpdate={handleUpdate} />;
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
    <div role="complementary" aria-label={`Configurar ${title}`} className="min-w-0 max-w-full shrink-0 border-l bg-card flex flex-col h-full" style={{ width: guided && expanded ? 640 : 360 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">Configurar {title}</h3>
        <div className="flex items-center gap-1">
        {guided && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={expanded ? 'Reduzir painel' : 'Ampliar painel'} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>
          {expanded ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>}
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Fechar painel" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
        </div>
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

      {/* Actions */}
      {(onDeleteNode || (onDuplicateNode && canDuplicate)) && (
        <div className="px-4 py-3 border-t space-y-2">
          {onDuplicateNode && canDuplicate && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => onDuplicateNode(selectedNode.id)}
            >
              <Copy className="w-4 h-4 mr-2" />
              Duplicar Nó
            </Button>
          )}
          {onDeleteNode && (
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={() => onDeleteNode(selectedNode.id)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Excluir Nó
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
