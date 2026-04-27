// src/lib/workflowPortability.ts

import type { Workflow, WorkflowNode, WorkflowEdge } from "@/types/workflow";
import type {
  ExportedWorkflowFile,
  ExternalReference,
  ExternalReferenceType,
  ImportReport,
  ImportReportItem,
  ValidationResult,
} from "@/types/workflowPortability";
import { CURRENT_SCHEMA_VERSION } from "@/types/workflowPortability";
import type { WorkflowInsert } from "@/types/workflow";

// =====================================================
// ORG-SPECIFIC FIELD REGISTRY
// =====================================================

interface OrgFieldSpec {
  type: ExternalReferenceType;
  hintField?: string;
}

/** Fields in ActionNodeData that reference org-specific resources */
const ACTION_ORG_FIELDS: Record<string, OrgFieldSpec> = {
  whatsappInstanceId: { type: "whatsapp_instance", hintField: "whatsappInstanceName" },
  campaignId: { type: "campaign", hintField: "campaignName" },
  campaignStageId: { type: "campaign_stage", hintField: "campaignStageName" },
  campaignTemplateId: { type: "campaign_template", hintField: "campaignTemplateName" },
  templateSourceId: { type: "template_source" },
  assigneeId: { type: "team_member", hintField: "assigneeName" },
  notifyMemberId: { type: "team_member", hintField: "notifyMemberName" },
  meetingCloserId: { type: "team_member" },
  semiAutoApprover: { type: "team_member" },
  aiAgentId: { type: "copilot_agent", hintField: "aiAgentName" },
  tagId: { type: "tag", hintField: "tagName" },
  tinyProductId: { type: "tinyerp_product", hintField: "tinyProductName" },
  audioId: { type: "audio_media", hintField: "audioName" },
  audioSourceId: { type: "audio_media" },
};

/** Fields in CopilotNodeData that reference org-specific resources */
const COPILOT_ORG_FIELDS: Record<string, OrgFieldSpec> = {
  agentId: { type: "copilot_agent", hintField: "agentName" },
};

/** Fields in AssignResponsibleNodeData that reference org-specific resources */
const ASSIGN_RESPONSIBLE_ORG_FIELDS: Record<string, OrgFieldSpec> = {
  assigneeId: { type: "team_member", hintField: "assigneeName" },
};

/** Fields in TriggerConfig that reference org-specific resources */
const TRIGGER_CONFIG_ORG_FIELDS: Record<string, OrgFieldSpec> = {
  pipeline_id: { type: "custom_pipeline" },
  campaign_id: { type: "campaign" },
  tag_id: { type: "tag", hintField: "tag_name" },
};

// =====================================================
// EXPORT
// =====================================================

function extractRefsFromData(
  nodeId: string,
  data: Record<string, unknown>,
  registry: Record<string, OrgFieldSpec>,
): { cleaned: Record<string, unknown>; refs: ExternalReference[] } {
  const cleaned = { ...data };
  const refs: ExternalReference[] = [];

  for (const [field, spec] of Object.entries(registry)) {
    const value = data[field];
    if (value != null && value !== "") {
      const hint = spec.hintField ? String(data[spec.hintField] ?? "") : "";
      refs.push({
        nodeId,
        field,
        type: spec.type,
        originalValue: String(value),
        hint,
      });
      cleaned[field] = null;
      if (spec.hintField && spec.hintField !== field) {
        cleaned[spec.hintField] = null;
      }
    }
  }

  return { cleaned, refs };
}

function getOrgFieldsForNode(nodeType: string): Record<string, OrgFieldSpec> {
  switch (nodeType) {
    case "action":
      return ACTION_ORG_FIELDS;
    case "copilot":
      return COPILOT_ORG_FIELDS;
    case "assign_responsible":
      return ASSIGN_RESPONSIBLE_ORG_FIELDS;
    default:
      return {};
  }
}

export function exportWorkflow(workflow: Workflow, orgName?: string): ExportedWorkflowFile {
  const allRefs: ExternalReference[] = [];

  // 1. Clean nodes
  const cleanedNodes: WorkflowNode[] = workflow.definition.nodes.map((node) => {
    const nodeData = node.data as Record<string, unknown>;
    const registry = getOrgFieldsForNode(String(nodeData.type));
    const { cleaned, refs } = extractRefsFromData(node.id, nodeData, registry);
    allRefs.push(...refs);

    // Clean assign_responsible memberIds array (org-specific team member IDs)
    if (String(nodeData.type) === "assign_responsible" && Array.isArray(cleaned.memberIds) && (cleaned.memberIds as unknown[]).length > 0) {
      allRefs.push({
        nodeId: node.id,
        field: "memberIds",
        type: "team_member" as ExternalReferenceType,
        originalValue: JSON.stringify(cleaned.memberIds),
        hint: `${(cleaned.memberIds as unknown[]).length} membros`,
      });
      cleaned.memberIds = [];
    }

    // Also clean trigger node's embedded config (mirrors trigger_config at top level)
    if (String(nodeData.type) === "trigger" && typeof cleaned.config === "object" && cleaned.config !== null) {
      const embeddedConfig = { ...(cleaned.config as Record<string, unknown>) };
      const { cleaned: cleanedEmbedded, refs: embeddedRefs } = extractRefsFromData(
        node.id,
        embeddedConfig,
        TRIGGER_CONFIG_ORG_FIELDS,
      );
      // Avoid duplicate refs (trigger_config refs already captured in step 2)
      // but still nullify the embedded values
      cleaned.config = cleanedEmbedded;
    }

    return { ...node, data: cleaned as any };
  });

  // 2. Clean trigger config
  const triggerConfig = { ...workflow.trigger_config } as Record<string, unknown>;
  const { cleaned: cleanedTriggerConfig, refs: triggerRefs } = extractRefsFromData(
    "__trigger__",
    triggerConfig,
    TRIGGER_CONFIG_ORG_FIELDS,
  );
  allRefs.push(...triggerRefs);

  // 3. Clean audioUrl/imageUrl (only clear Supabase storage URLs, keep external)
  cleanedNodes.forEach((node) => {
    const data = node.data as Record<string, unknown>;
    if (typeof data.audioUrl === "string" && data.audioUrl.includes("supabase")) {
      allRefs.push({
        nodeId: node.id,
        field: "audioUrl",
        type: "audio_media",
        originalValue: data.audioUrl as string,
        hint: String(data.audioName ?? ""),
      });
      (data as any).audioUrl = null;
    }
    if (typeof data.imageUrl === "string" && data.imageUrl.includes("supabase")) {
      allRefs.push({
        nodeId: node.id,
        field: "imageUrl",
        type: "image_media",
        originalValue: data.imageUrl as string,
        hint: "",
      });
      (data as any).imageUrl = null;
    }
  });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sourceDescription: orgName ? `Exportado de "${orgName}"` : "Exportado",
    workflow: {
      name: workflow.name,
      description: workflow.description,
      trigger_type: workflow.trigger_type,
      trigger_config: cleanedTriggerConfig as any,
      loop_limit: workflow.loop_limit,
      definition: {
        nodes: cleanedNodes,
        edges: workflow.definition.edges,
      },
    },
    externalReferences: allRefs,
  };
}

// =====================================================
// VALIDATION
// =====================================================

export function validateImportFile(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { valid: false, errors: ["Arquivo inválido: não é um objeto JSON."] };
  }

  const obj = data as Record<string, unknown>;

  // Schema version
  if (!obj.schemaVersion) {
    errors.push("Campo obrigatório ausente: schemaVersion");
  } else if (obj.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    errors.push(
      `Versão incompatível: esperada "${CURRENT_SCHEMA_VERSION}", recebida "${obj.schemaVersion}"`,
    );
  }

  // Workflow block
  if (!obj.workflow || typeof obj.workflow !== "object") {
    errors.push("Campo obrigatório ausente: workflow");
    return { valid: false, errors };
  }

  const wf = obj.workflow as Record<string, unknown>;

  if (!wf.name || typeof wf.name !== "string") {
    errors.push("Campo obrigatório ausente: workflow.name");
  }
  if (!wf.trigger_type || typeof wf.trigger_type !== "string") {
    errors.push("Campo obrigatório ausente: workflow.trigger_type");
  }
  if (!wf.definition || typeof wf.definition !== "object") {
    errors.push("Campo obrigatório ausente: workflow.definition");
  } else {
    const def = wf.definition as Record<string, unknown>;
    if (!Array.isArray(def.nodes)) {
      errors.push("workflow.definition.nodes deve ser um array");
    }
    if (!Array.isArray(def.edges)) {
      errors.push("workflow.definition.edges deve ser um array");
    }
  }

  // External references (optional but must be array if present)
  if (obj.externalReferences !== undefined && !Array.isArray(obj.externalReferences)) {
    errors.push("externalReferences deve ser um array");
  }

  return { valid: errors.length === 0, errors };
}

// =====================================================
// IMPORT (prepare)
// =====================================================

function generateId(): string {
  return crypto.randomUUID();
}

export function prepareImport(file: ExportedWorkflowFile): {
  workflowInsert: WorkflowInsert;
  report: ImportReport;
} {
  const wf = file.workflow;
  const reportItems: ImportReportItem[] = [];

  // 1. Build ID remap table: old node ID → new node ID
  const idMap = new Map<string, string>();
  for (const node of wf.definition.nodes) {
    idMap.set(node.id, generateId());
  }

  // 2. Remap nodes
  const remappedNodes: WorkflowNode[] = wf.definition.nodes.map((node) => {
    const newId = idMap.get(node.id)!;
    const data = { ...node.data } as Record<string, unknown>;

    // Remap goto targetNodeId
    if (data.type === "goto" && typeof data.targetNodeId === "string" && data.targetNodeId) {
      const newTargetId = idMap.get(data.targetNodeId);
      if (newTargetId) {
        data.targetNodeId = newTargetId;
      } else {
        data.targetNodeId = "";
        data.targetNodeLabel = "";
        reportItems.push({
          status: "warning",
          message: `Nó "${data.label || newId}": referência "Ir Para" não encontrada no workflow.`,
        });
      }
    }

    return {
      ...node,
      id: newId,
      data: data as any,
    };
  });

  // 3. Remap edges
  const remappedEdges: WorkflowEdge[] = wf.definition.edges
    .map((edge) => {
      const newSource = idMap.get(edge.source);
      const newTarget = idMap.get(edge.target);
      if (!newSource || !newTarget) return null;
      return {
        ...edge,
        id: generateId(),
        source: newSource,
        target: newTarget,
      };
    })
    .filter((e): e is WorkflowEdge => e !== null);

  // 4. Report unresolved external references
  const refs = file.externalReferences || [];
  for (const ref of refs) {
    const hintLabel = ref.hint ? ` ("${ref.hint}")` : "";
    reportItems.push({
      status: "pending",
      message: `Dependência pendente: ${ref.type}${hintLabel} no campo "${ref.field}" — necessita configuração manual.`,
    });
  }

  // 5. Report success items
  reportItems.unshift(
    {
      status: "success",
      message: `${remappedNodes.length} nós importados.`,
    },
    {
      status: "success",
      message: `${remappedEdges.length} conexões importadas.`,
    },
    {
      status: "success",
      message: `Trigger: ${wf.trigger_type}`,
    },
    {
      status: "warning",
      message: "Workflow importado como INATIVO — ative manualmente após configurar dependências.",
    },
  );

  const workflowInsert: WorkflowInsert = {
    name: `${wf.name} (importado)`,
    description: wf.description,
    is_active: false,
    trigger_type: wf.trigger_type,
    trigger_config: wf.trigger_config,
    loop_limit: wf.loop_limit ?? 10,
    definition: {
      nodes: remappedNodes,
      edges: remappedEdges,
    },
  };

  const report: ImportReport = {
    workflowId: "",
    workflowName: workflowInsert.name,
    items: reportItems,
    unresolvedCount: refs.length,
    totalNodes: remappedNodes.length,
  };

  return { workflowInsert, report };
}

// =====================================================
// FILE HELPERS
// =====================================================

export function downloadWorkflowJson(file: ExportedWorkflowFile, filename: string): void {
  const json = JSON.stringify(file, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseWorkflowFile(jsonString: string): {
  data: ExportedWorkflowFile | null;
  error: string | null;
} {
  try {
    const parsed = JSON.parse(jsonString);
    const validation = validateImportFile(parsed);
    if (!validation.valid) {
      return { data: null, error: validation.errors.join("\n") };
    }
    return { data: parsed as ExportedWorkflowFile, error: null };
  } catch {
    return { data: null, error: "JSON inválido: o arquivo não pôde ser lido." };
  }
}
