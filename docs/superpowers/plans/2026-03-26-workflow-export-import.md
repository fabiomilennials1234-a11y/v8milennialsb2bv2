# Workflow Export/Import Between Organizations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to export a visual workflow automation as `.json` from one organization and import it into another, with org-specific dependencies left unconfigured for manual resolution.

**Architecture:** Client-side serialization/deserialization module (`src/lib/workflowPortability.ts`) with a declarative registry of org-specific fields. Export strips org-bound IDs and records them as external references. Import regenerates all node IDs, creates the workflow as `is_active: false`, and shows a report of pending configurations. No new Edge Functions — RLS enforces org isolation.

**Tech Stack:** TypeScript, React (hooks + components), Supabase client, Vitest, React Flow types, shadcn/ui components, Lucide icons, Sonner toasts.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| CREATE | `src/types/workflowPortability.ts` | Types for export format, external refs, import report |
| CREATE | `src/lib/workflowPortability.ts` | Core serialization/deserialization, field registry, validation |
| CREATE | `tests/unit/workflowPortability.test.ts` | Unit tests for export/import logic |
| CREATE | `src/hooks/useWorkflowPortability.ts` | React hooks wrapping export/import for UI |
| CREATE | `src/components/automacoes/WorkflowImportDialog.tsx` | Import dialog with upload, validation, report |
| MODIFY | `src/pages/Automacoes.tsx` | Add import button + export action on cards |
| MODIFY | `src/components/automacoes/WorkflowToolbar.tsx` | Add export button in editor |
| MODIFY | `src/components/automacoes/WorkflowSidebar.tsx` | Show unresolved ref warnings on nodes |

---

### Task 1: Types for the Export/Import Format

**Files:**
- Create: `src/types/workflowPortability.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/types/workflowPortability.ts

import type {
  WorkflowTriggerType,
  WorkflowDefinition,
  TriggerConfig,
} from "./workflow";

// =====================================================
// SCHEMA VERSION
// =====================================================

export const CURRENT_SCHEMA_VERSION = "1.0";

// =====================================================
// EXTERNAL REFERENCE (org-specific dependency)
// =====================================================

export type ExternalReferenceType =
  | "whatsapp_instance"
  | "campaign"
  | "campaign_stage"
  | "campaign_template"
  | "template_source"
  | "team_member"
  | "copilot_agent"
  | "tag"
  | "tinyerp_product"
  | "audio_media"
  | "image_media"
  | "custom_pipeline"
  | "pipeline_stage";

export interface ExternalReference {
  /** Which node this reference belongs to ("trigger" for trigger_config refs) */
  nodeId: string;
  /** The field name in node data or trigger config */
  field: string;
  /** Category of the referenced resource */
  type: ExternalReferenceType;
  /** Original value from source org (for display only, never reused) */
  originalValue: string;
  /** Human-readable hint (e.g. instance name, agent name) */
  hint: string;
}

// =====================================================
// EXPORTED WORKFLOW FILE FORMAT
// =====================================================

export interface ExportedWorkflowFile {
  schemaVersion: string;
  exportedAt: string;
  sourceDescription: string;
  workflow: {
    name: string;
    description: string | null;
    trigger_type: WorkflowTriggerType;
    trigger_config: TriggerConfig;
    loop_limit: number;
    definition: WorkflowDefinition;
  };
  externalReferences: ExternalReference[];
}

// =====================================================
// IMPORT REPORT
// =====================================================

export type ImportReportItemStatus = "success" | "warning" | "pending";

export interface ImportReportItem {
  status: ImportReportItemStatus;
  message: string;
}

export interface ImportReport {
  workflowId: string;
  workflowName: string;
  items: ImportReportItem[];
  unresolvedCount: number;
  totalNodes: number;
}

// =====================================================
// VALIDATION RESULT
// =====================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit src/types/workflowPortability.ts 2>&1 | head -20`

Expected: No errors (or only unrelated errors from the broader project). The file imports existing types from `./workflow` so those must resolve.

- [ ] **Step 3: Commit**

```bash
git add src/types/workflowPortability.ts
git commit -m "feat(workflow-portability): add types for export/import format"
```

---

### Task 2: Core Serialization/Deserialization Module

**Files:**
- Create: `src/lib/workflowPortability.ts`

This is the heart of the feature. It contains:
1. `ORG_SPECIFIC_FIELDS` — declarative registry of which fields in which contexts are org-bound
2. `exportWorkflow()` — takes a Workflow, returns an ExportedWorkflowFile
3. `validateImportFile()` — validates a parsed JSON object
4. `prepareImport()` — takes an ExportedWorkflowFile, returns a WorkflowInsert + ImportReport

- [ ] **Step 1: Create the module with the org-specific field registry and export function**

```typescript
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

/**
 * Each entry maps a field name to its reference type and an optional
 * "hint field" — a sibling field that contains a human-readable label
 * (e.g. whatsappInstanceName for whatsappInstanceId).
 *
 * Fields listed here will be:
 *   - Nullified in the exported definition
 *   - Recorded in externalReferences[] with their original value + hint
 *   - Left null on import (pending manual configuration)
 */
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
      // Also null out the hint field (it's only useful as display context)
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

  // 3. Clean audioUrl (only clear Supabase storage URLs, keep external)
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
    workflowId: "", // will be filled after DB insert
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
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | grep workflowPortability | head -10`

Expected: No errors from these files.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflowPortability.ts
git commit -m "feat(workflow-portability): core export/import serialization module"
```

---

### Task 3: Unit Tests for the Core Module

**Files:**
- Create: `tests/unit/workflowPortability.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/unit/workflowPortability.test.ts

import { describe, it, expect } from "vitest";
import {
  exportWorkflow,
  validateImportFile,
  prepareImport,
  parseWorkflowFile,
} from "@/lib/workflowPortability";
import { CURRENT_SCHEMA_VERSION } from "@/types/workflowPortability";
import type { Workflow } from "@/types/workflow";
import type { ExportedWorkflowFile } from "@/types/workflowPortability";

// =====================================================
// FIXTURES
// =====================================================

function createMockWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-original-id",
    organization_id: "org-123",
    name: "Test Workflow",
    description: "A test workflow",
    is_active: true,
    trigger_type: "stage_changed",
    trigger_config: {
      pipe_type: "whatsapp",
      pipeline_id: "pipeline-org-uuid",
      stages: ["stage-1"],
    },
    loop_limit: 10,
    created_by: "user-uuid-123",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    definition: {
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 400, y: 50 },
          data: {
            type: "trigger",
            triggerType: "stage_changed",
            config: { pipe_type: "whatsapp", pipeline_id: "pipeline-org-uuid", stages: ["stage-1"] },
            label: "Trigger",
          },
        },
        {
          id: "action-1",
          type: "action",
          position: { x: 400, y: 200 },
          data: {
            type: "action",
            actionType: "send_whatsapp",
            label: "Enviar mensagem",
            whatsappInstanceId: "instance-uuid-456",
            whatsappInstanceName: "Instância Principal",
            messageTemplate: "Olá {{nome}}!",
          },
        },
        {
          id: "action-2",
          type: "action",
          position: { x: 400, y: 350 },
          data: {
            type: "action",
            actionType: "assign_sdr",
            label: "Atribuir SDR",
            assigneeId: "member-uuid-789",
            assigneeName: "João Silva",
            assignMode: "specific",
          },
        },
        {
          id: "copilot-1",
          type: "copilot",
          position: { x: 400, y: 500 },
          data: {
            type: "copilot",
            label: "Copilot",
            agentId: "agent-uuid-abc",
            agentName: "Qualificador",
          },
        },
        {
          id: "goto-1",
          type: "goto",
          position: { x: 400, y: 650 },
          data: {
            type: "goto",
            label: "Voltar",
            targetNodeId: "action-1",
            targetNodeLabel: "Enviar mensagem",
          },
        },
        {
          id: "end-1",
          type: "end",
          position: { x: 400, y: 800 },
          data: { type: "end", label: "Fim" },
        },
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
        { id: "e2", source: "action-1", target: "action-2" },
        { id: "e3", source: "action-2", target: "copilot-1" },
        { id: "e4", source: "copilot-1", target: "goto-1" },
        { id: "e5", source: "goto-1", target: "end-1" },
      ],
    },
    ...overrides,
  } as Workflow;
}

function createValidExportFile(overrides?: Partial<ExportedWorkflowFile>): ExportedWorkflowFile {
  const wf = createMockWorkflow();
  const exported = exportWorkflow(wf, "Test Org");
  return { ...exported, ...overrides };
}

// =====================================================
// EXPORT TESTS
// =====================================================

describe("exportWorkflow", () => {
  it("produces a file with correct schemaVersion", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("includes exportedAt timestamp", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    expect(result.exportedAt).toBeTruthy();
    expect(() => new Date(result.exportedAt)).not.toThrow();
  });

  it("preserves workflow name, description, trigger_type, loop_limit", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    expect(result.workflow.name).toBe("Test Workflow");
    expect(result.workflow.description).toBe("A test workflow");
    expect(result.workflow.trigger_type).toBe("stage_changed");
    expect(result.workflow.loop_limit).toBe(10);
  });

  it("does NOT export organization_id, created_by, id, timestamps", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const json = JSON.stringify(result);
    expect(json).not.toContain("org-123");
    expect(json).not.toContain("user-uuid-123");
    expect(json).not.toContain("wf-original-id");
  });

  it("nullifies whatsappInstanceId in action nodes", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const actionNode = result.workflow.definition.nodes.find((n) => n.id === "action-1");
    const data = actionNode!.data as Record<string, unknown>;
    expect(data.whatsappInstanceId).toBeNull();
    expect(data.whatsappInstanceName).toBeNull();
  });

  it("nullifies assigneeId in action nodes", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const actionNode = result.workflow.definition.nodes.find((n) => n.id === "action-2");
    const data = actionNode!.data as Record<string, unknown>;
    expect(data.assigneeId).toBeNull();
    expect(data.assigneeName).toBeNull();
  });

  it("nullifies agentId in copilot nodes", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const copilotNode = result.workflow.definition.nodes.find((n) => n.id === "copilot-1");
    const data = copilotNode!.data as Record<string, unknown>;
    expect(data.agentId).toBeNull();
    expect(data.agentName).toBeNull();
  });

  it("nullifies pipeline_id in trigger config", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const config = result.workflow.trigger_config as Record<string, unknown>;
    expect(config.pipeline_id).toBeNull();
  });

  it("preserves non-org fields (messageTemplate, actionType, positions)", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const actionNode = result.workflow.definition.nodes.find((n) => n.id === "action-1");
    const data = actionNode!.data as Record<string, unknown>;
    expect(data.messageTemplate).toBe("Olá {{nome}}!");
    expect(data.actionType).toBe("send_whatsapp");
    expect(actionNode!.position).toEqual({ x: 400, y: 200 });
  });

  it("records all org-specific refs in externalReferences", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    // Expected refs: whatsappInstanceId, assigneeId, agentId, pipeline_id = 4 refs
    expect(result.externalReferences.length).toBe(4);
    const types = result.externalReferences.map((r) => r.type);
    expect(types).toContain("whatsapp_instance");
    expect(types).toContain("team_member");
    expect(types).toContain("copilot_agent");
    expect(types).toContain("custom_pipeline");
  });

  it("includes hints for named references", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    const whatsappRef = result.externalReferences.find((r) => r.type === "whatsapp_instance");
    expect(whatsappRef!.hint).toBe("Instância Principal");
    const memberRef = result.externalReferences.find((r) => r.type === "team_member");
    expect(memberRef!.hint).toBe("João Silva");
  });

  it("preserves edges unchanged", () => {
    const wf = createMockWorkflow();
    const result = exportWorkflow(wf);
    expect(result.workflow.definition.edges.length).toBe(5);
  });
});

// =====================================================
// VALIDATION TESTS
// =====================================================

describe("validateImportFile", () => {
  it("accepts a valid export file", () => {
    const file = createValidExportFile();
    const result = validateImportFile(file);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects non-object input", () => {
    const result = validateImportFile("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("não é um objeto JSON");
  });

  it("rejects null input", () => {
    const result = validateImportFile(null);
    expect(result.valid).toBe(false);
  });

  it("rejects array input", () => {
    const result = validateImportFile([1, 2, 3]);
    expect(result.valid).toBe(false);
  });

  it("rejects missing schemaVersion", () => {
    const file = createValidExportFile();
    const { schemaVersion, ...noVersion } = file;
    const result = validateImportFile(noVersion);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("schemaVersion");
  });

  it("rejects incompatible schemaVersion", () => {
    const file = createValidExportFile({ schemaVersion: "99.0" });
    const result = validateImportFile(file);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("incompatível");
  });

  it("rejects missing workflow block", () => {
    const result = validateImportFile({ schemaVersion: CURRENT_SCHEMA_VERSION });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("workflow"))).toBe(true);
  });

  it("rejects missing workflow.name", () => {
    const file = createValidExportFile();
    (file.workflow as any).name = undefined;
    const result = validateImportFile(file);
    expect(result.valid).toBe(false);
  });

  it("rejects missing definition.nodes", () => {
    const file = createValidExportFile();
    (file.workflow.definition as any).nodes = "not-array";
    const result = validateImportFile(file);
    expect(result.valid).toBe(false);
  });
});

// =====================================================
// IMPORT TESTS
// =====================================================

describe("prepareImport", () => {
  it("generates new IDs for all nodes (never reuses source IDs)", () => {
    const file = createValidExportFile();
    const originalIds = file.workflow.definition.nodes.map((n) => n.id);
    const { workflowInsert } = prepareImport(file);
    const newIds = workflowInsert.definition.nodes.map((n) => n.id);

    // No new ID should match any original ID
    for (const newId of newIds) {
      expect(originalIds).not.toContain(newId);
    }
    // All new IDs should be unique
    expect(new Set(newIds).size).toBe(newIds.length);
  });

  it("remaps edge source and target to new node IDs", () => {
    const file = createValidExportFile();
    const { workflowInsert } = prepareImport(file);
    const nodeIds = new Set(workflowInsert.definition.nodes.map((n) => n.id));

    for (const edge of workflowInsert.definition.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("remaps goto targetNodeId to new node ID", () => {
    const file = createValidExportFile();
    const { workflowInsert } = prepareImport(file);
    const gotoNode = workflowInsert.definition.nodes.find(
      (n) => (n.data as Record<string, unknown>).type === "goto",
    );
    expect(gotoNode).toBeDefined();
    const data = gotoNode!.data as Record<string, unknown>;
    // The goto should point to the new ID of the node that was "action-1"
    const actionNode = workflowInsert.definition.nodes.find(
      (n) => (n.data as Record<string, unknown>).actionType === "send_whatsapp",
    );
    expect(data.targetNodeId).toBe(actionNode!.id);
  });

  it("creates workflow with is_active: false", () => {
    const file = createValidExportFile();
    const { workflowInsert } = prepareImport(file);
    expect(workflowInsert.is_active).toBe(false);
  });

  it("appends '(importado)' to name", () => {
    const file = createValidExportFile();
    const { workflowInsert } = prepareImport(file);
    expect(workflowInsert.name).toContain("(importado)");
  });

  it("generates new edge IDs", () => {
    const file = createValidExportFile();
    const originalEdgeIds = file.workflow.definition.edges.map((e) => e.id);
    const { workflowInsert } = prepareImport(file);
    for (const edge of workflowInsert.definition.edges) {
      expect(originalEdgeIds).not.toContain(edge.id);
    }
  });

  it("reports unresolved external references as pending", () => {
    const file = createValidExportFile();
    const { report } = prepareImport(file);
    expect(report.unresolvedCount).toBeGreaterThan(0);
    const pendingItems = report.items.filter((i) => i.status === "pending");
    expect(pendingItems.length).toBe(report.unresolvedCount);
  });

  it("includes success items for nodes and edges", () => {
    const file = createValidExportFile();
    const { report } = prepareImport(file);
    const successItems = report.items.filter((i) => i.status === "success");
    expect(successItems.length).toBeGreaterThan(0);
    expect(successItems.some((i) => i.message.includes("nós importados"))).toBe(true);
    expect(successItems.some((i) => i.message.includes("conexões importadas"))).toBe(true);
  });

  it("includes warning about inactive state", () => {
    const file = createValidExportFile();
    const { report } = prepareImport(file);
    const warningItems = report.items.filter((i) => i.status === "warning");
    expect(warningItems.some((i) => i.message.includes("INATIVO"))).toBe(true);
  });
});

// =====================================================
// PARSE/VALIDATE FILE
// =====================================================

describe("parseWorkflowFile", () => {
  it("parses valid JSON string", () => {
    const file = createValidExportFile();
    const json = JSON.stringify(file);
    const { data, error } = parseWorkflowFile(json);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("rejects invalid JSON", () => {
    const { data, error } = parseWorkflowFile("not json {{{");
    expect(data).toBeNull();
    expect(error).toContain("JSON inválido");
  });

  it("rejects valid JSON with invalid structure", () => {
    const { data, error } = parseWorkflowFile(JSON.stringify({ foo: "bar" }));
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});

// =====================================================
// ROUND-TRIP TEST
// =====================================================

describe("round-trip: export → import", () => {
  it("preserves workflow structure through export+import cycle", () => {
    const original = createMockWorkflow();
    const exported = exportWorkflow(original, "Org A");
    const { workflowInsert } = prepareImport(exported);

    // Same number of nodes and edges
    expect(workflowInsert.definition.nodes.length).toBe(original.definition.nodes.length);
    expect(workflowInsert.definition.edges.length).toBe(original.definition.edges.length);

    // Same node types in same order
    const originalTypes = original.definition.nodes.map((n) => (n.data as any).type);
    const importedTypes = workflowInsert.definition.nodes.map((n) => (n.data as any).type);
    expect(importedTypes).toEqual(originalTypes);

    // Trigger type preserved
    expect(workflowInsert.trigger_type).toBe(original.trigger_type);
  });

  it("never leaks source org IDs into import", () => {
    const original = createMockWorkflow();
    const exported = exportWorkflow(original);
    const { workflowInsert } = prepareImport(exported);
    const json = JSON.stringify(workflowInsert);

    // None of the org-specific UUIDs should appear
    expect(json).not.toContain("instance-uuid-456");
    expect(json).not.toContain("member-uuid-789");
    expect(json).not.toContain("agent-uuid-abc");
    expect(json).not.toContain("pipeline-org-uuid");
    expect(json).not.toContain("org-123");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/unit/workflowPortability.test.ts --reporter=verbose`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/workflowPortability.test.ts
git commit -m "test(workflow-portability): unit tests for export/import/validation"
```

---

### Task 4: React Hooks for Export/Import

**Files:**
- Create: `src/hooks/useWorkflowPortability.ts`

- [ ] **Step 1: Create the hooks file**

```typescript
// src/hooks/useWorkflowPortability.ts

import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrganization } from "@/hooks/useOrganization";
import { useCreateWorkflow } from "@/hooks/useWorkflows";
import {
  exportWorkflow,
  downloadWorkflowJson,
  parseWorkflowFile,
  prepareImport,
} from "@/lib/workflowPortability";
import type { Workflow } from "@/types/workflow";
import type { ImportReport } from "@/types/workflowPortability";

export function useExportWorkflow() {
  const { organizationName } = useOrganization();

  return useCallback(
    (workflow: Workflow) => {
      try {
        const file = exportWorkflow(workflow, organizationName ?? undefined);
        const safeName = workflow.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
        const filename = `workflow_${safeName}_${Date.now()}.json`;
        downloadWorkflowJson(file, filename);
        toast.success("Workflow exportado com sucesso!");
      } catch (err: any) {
        toast.error(err.message || "Erro ao exportar workflow");
      }
    },
    [organizationName],
  );
}

export function useImportWorkflow() {
  const createWorkflow = useCreateWorkflow();
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const [report, setReport] = useState<ImportReport | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const importMutation = useMutation({
    mutationFn: async (jsonString: string): Promise<ImportReport> => {
      // 1. Parse and validate
      const { data: file, error: parseError } = parseWorkflowFile(jsonString);
      if (!file || parseError) {
        throw new Error(parseError || "Arquivo inválido");
      }

      // 2. Prepare import (remap IDs, build report)
      const { workflowInsert, report } = prepareImport(file);

      // 3. Create in database
      const result = await createWorkflow.mutateAsync(workflowInsert);
      report.workflowId = result.id;

      return report;
    },
    onSuccess: (report) => {
      setReport(report);
      queryClient.invalidateQueries({ queryKey: ["workflows", organizationId] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Erro ao importar workflow");
    },
  });

  const openImport = useCallback(() => setIsOpen(true), []);
  const closeImport = useCallback(() => {
    setIsOpen(false);
    setReport(null);
  }, []);

  return {
    importWorkflow: importMutation.mutate,
    importWorkflowAsync: importMutation.mutateAsync,
    isImporting: importMutation.isPending,
    report,
    setReport,
    isOpen,
    openImport,
    closeImport,
  };
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep useWorkflowPortability | head -10`

Expected: No errors. If `organizationName` doesn't exist on the org hook, we'll use a fallback — check next step.

- [ ] **Step 3: Check if useOrganization exposes org name**

Run: `grep -n "organizationName\|organization_name\|orgName" src/hooks/useOrganization.ts | head -10`

If it doesn't return a name field, update the hook to use `organizationId` as fallback in `sourceDescription`. Replace `organizationName ?? undefined` with `undefined` and remove the destructuring of `organizationName`.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useWorkflowPortability.ts
git commit -m "feat(workflow-portability): React hooks for export/import"
```

---

### Task 5: Import Dialog Component

**Files:**
- Create: `src/components/automacoes/WorkflowImportDialog.tsx`

- [ ] **Step 1: Create the import dialog**

```tsx
// src/components/automacoes/WorkflowImportDialog.tsx

import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileJson,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ImportReport } from "@/types/workflowPortability";

interface WorkflowImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (jsonString: string) => void;
  isImporting: boolean;
  report: ImportReport | null;
}

const STATUS_CONFIG = {
  success: { icon: CheckCircle2, color: "text-green-500", badge: "default" as const },
  warning: { icon: AlertTriangle, color: "text-yellow-500", badge: "secondary" as const },
  pending: { icon: Clock, color: "text-orange-500", badge: "outline" as const },
};

export function WorkflowImportDialog({
  open,
  onClose,
  onImport,
  isImporting,
  report,
}: WorkflowImportDialogProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setFileName(file.name);

    if (!file.name.endsWith(".json")) {
      setFileError("Apenas arquivos .json são aceitos.");
      setFileContent(null);
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setFileError("Arquivo muito grande (máximo 5MB).");
      setFileContent(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      setFileContent(ev.target?.result as string);
    };
    reader.onerror = () => {
      setFileError("Erro ao ler o arquivo.");
    };
    reader.readAsText(file);
  }, []);

  const handleImport = useCallback(() => {
    if (!fileContent) return;
    onImport(fileContent);
  }, [fileContent, onImport]);

  const handleClose = useCallback(() => {
    setFileName(null);
    setFileContent(null);
    setFileError(null);
    onClose();
  }, [onClose]);

  const handleGoToWorkflow = useCallback(() => {
    if (report?.workflowId) {
      handleClose();
      navigate(`/automacoes/${report.workflowId}`);
    }
  }, [report, handleClose, navigate]);

  // Report view
  if (report) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              Workflow Importado
            </DialogTitle>
            <DialogDescription>
              "{report.workflowName}" — {report.totalNodes} nós
              {report.unresolvedCount > 0 && (
                <span className="text-orange-500 ml-1">
                  ({report.unresolvedCount} pendência{report.unresolvedCount > 1 ? "s" : ""})
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2 pr-4">
              {report.items.map((item, idx) => {
                const config = STATUS_CONFIG[item.status];
                const Icon = config.icon;
                return (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${config.color}`} />
                    <span className="text-muted-foreground">{item.message}</span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleClose}>
              Fechar
            </Button>
            <Button onClick={handleGoToWorkflow}>
              Abrir Workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Upload view
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Importar Workflow</DialogTitle>
          <DialogDescription>
            Selecione um arquivo .json exportado de outra organização.
            O workflow será criado como inativo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop zone */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-3 text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer"
          >
            {fileName ? (
              <>
                <FileJson className="w-8 h-8" />
                <span className="text-sm font-medium">{fileName}</span>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8" />
                <span className="text-sm">Clique para selecionar arquivo .json</span>
              </>
            )}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileSelect}
          />

          {fileError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4" />
              {fileError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleImport}
            disabled={!fileContent || isImporting || !!fileError}
          >
            {isImporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                Importando...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-1" />
                Importar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep WorkflowImportDialog | head -10`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/automacoes/WorkflowImportDialog.tsx
git commit -m "feat(workflow-portability): import dialog with upload, validation, and report"
```

---

### Task 6: Add Export Button to Workflow Toolbar (Editor)

**Files:**
- Modify: `src/components/automacoes/WorkflowToolbar.tsx`

- [ ] **Step 1: Add export button to the toolbar**

Add the `Download` icon import to the existing lucide import line:

In `src/components/automacoes/WorkflowToolbar.tsx`, find:
```typescript
import {
  ArrowLeft,
  Save,
  Loader2,
  Plus,
  Zap,
  Play,
  GitBranch,
  Clock,
  Bot,
  CircleStop,
  MessageCircle,
  Split,
  Globe,
  CornerDownRight,
  History,
} from "lucide-react";
```

Replace with:
```typescript
import {
  ArrowLeft,
  Save,
  Loader2,
  Plus,
  Zap,
  Play,
  GitBranch,
  Clock,
  Bot,
  CircleStop,
  MessageCircle,
  Split,
  Globe,
  CornerDownRight,
  History,
  Download,
} from "lucide-react";
```

Add `onExport` prop to the interface. Find:
```typescript
interface WorkflowToolbarProps {
  name: string;
  onNameChange: (name: string) => void;
  isActive: boolean;
  onToggleActive: () => void;
  onSave: () => void;
  isSaving: boolean;
  onAddNode: (type: WorkflowNodeType) => void;
  isNew: boolean;
  workflowId?: string;
}
```

Replace with:
```typescript
interface WorkflowToolbarProps {
  name: string;
  onNameChange: (name: string) => void;
  isActive: boolean;
  onToggleActive: () => void;
  onSave: () => void;
  isSaving: boolean;
  onAddNode: (type: WorkflowNodeType) => void;
  isNew: boolean;
  workflowId?: string;
  onExport?: () => void;
}
```

Add `onExport` to the destructuring. Find:
```typescript
  isNew,
  workflowId,
}: WorkflowToolbarProps) {
```

Replace with:
```typescript
  isNew,
  workflowId,
  onExport,
}: WorkflowToolbarProps) {
```

Add the export button right before the executions link. Find:
```tsx
        {/* Executions link */}
        {!isNew && workflowId && (
```

Insert before that block:
```tsx
        {/* Export */}
        {!isNew && onExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="w-4 h-4 mr-1" />
            Exportar
          </Button>
        )}

```

- [ ] **Step 2: Wire up export in AutomacoesEditor.tsx**

In `src/pages/AutomacoesEditor.tsx`, add the import:

Find:
```typescript
import {
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
} from "@/hooks/useWorkflows";
```

Replace with:
```typescript
import {
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
} from "@/hooks/useWorkflows";
import { useExportWorkflow } from "@/hooks/useWorkflowPortability";
```

Initialize the hook inside the component. Find:
```typescript
  const createWorkflow = useCreateWorkflow();
  const updateWorkflow = useUpdateWorkflow();
```

Add after:
```typescript
  const handleExport = useExportWorkflow();
```

Pass `onExport` to WorkflowToolbar. Find:
```tsx
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
      />
```

Replace with:
```tsx
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
      />
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep -E "WorkflowToolbar|AutomacoesEditor" | head -10`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/automacoes/WorkflowToolbar.tsx src/pages/AutomacoesEditor.tsx
git commit -m "feat(workflow-portability): export button in workflow editor toolbar"
```

---

### Task 7: Add Import Button + Export Action on Cards (List Page)

**Files:**
- Modify: `src/pages/Automacoes.tsx`

- [ ] **Step 1: Add imports and hooks**

In `src/pages/Automacoes.tsx`, add imports. Find:
```typescript
import {
  Plus,
  Workflow,
  Loader2,
  Play,
  Pause,
  Trash2,
  Edit,
  Clock,
  Zap,
  GitBranch,
  Tag,
  TrendingUp,
  Timer,
} from "lucide-react";
```

Replace with:
```typescript
import {
  Plus,
  Workflow,
  Loader2,
  Play,
  Pause,
  Trash2,
  Edit,
  Clock,
  Zap,
  GitBranch,
  Tag,
  TrendingUp,
  Timer,
  Download,
  Upload,
} from "lucide-react";
```

Find:
```typescript
import { useFeaturePermission } from "@/hooks/useUserRole";
```

Add after:
```typescript
import { useExportWorkflow, useImportWorkflow } from "@/hooks/useWorkflowPortability";
import { WorkflowImportDialog } from "@/components/automacoes/WorkflowImportDialog";
```

- [ ] **Step 2: Wire up hooks in the component**

Inside the `Automacoes` component, find:
```typescript
  const [deleteTarget, setDeleteTarget] = useState<WorkflowType | null>(null);
```

Add after:
```typescript
  const handleExport = useExportWorkflow();
  const {
    importWorkflow,
    isImporting,
    report: importReport,
    isOpen: isImportOpen,
    openImport,
    closeImport,
  } = useImportWorkflow();
```

- [ ] **Step 3: Add export button to workflow cards**

Find the export button section in the card actions. In the `renderWorkflowCard` function, find:
```tsx
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                disabled={!canDeleteAutomation}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(workflow);
                }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
```

Insert before that block:
```tsx
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  handleExport(workflow);
                }}
                title="Exportar workflow"
              >
                <Download className="w-4 h-4" />
              </Button>
```

- [ ] **Step 4: Add import button to header**

Find:
```tsx
        <Button onClick={() => navigate("/automacoes/novo")} disabled={!canCreateAutomation}>
          <Plus className="w-4 h-4 mr-2" />
          Novo Workflow
        </Button>
```

Replace with:
```tsx
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openImport} disabled={!canCreateAutomation}>
            <Upload className="w-4 h-4 mr-2" />
            Importar
          </Button>
          <Button onClick={() => navigate("/automacoes/novo")} disabled={!canCreateAutomation}>
            <Plus className="w-4 h-4 mr-2" />
            Novo Workflow
          </Button>
        </div>
```

- [ ] **Step 5: Add import dialog at the bottom of the component**

Find the closing `</AlertDialog>` at the end of the JSX. After it (but still inside the outer `<div>`), add:

```tsx

      {/* Import Dialog */}
      <WorkflowImportDialog
        open={isImportOpen}
        onClose={closeImport}
        onImport={(json) => importWorkflow(json)}
        isImporting={isImporting}
        report={importReport}
      />
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep Automacoes | head -10`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Automacoes.tsx
git commit -m "feat(workflow-portability): import button + export action on workflow cards"
```

---

### Task 8: Unresolved References Warning in Sidebar

**Files:**
- Modify: `src/components/automacoes/WorkflowSidebar.tsx`

- [ ] **Step 1: Add unresolved ref detection and warning banner**

In `src/components/automacoes/WorkflowSidebar.tsx`, add import. Find:
```typescript
import { X, Trash2 } from "lucide-react";
```

Replace with:
```typescript
import { X, Trash2, AlertTriangle } from "lucide-react";
```

Add a helper function and the org-field registry import. Find:
```typescript
import type { WorkflowNode, WorkflowNodeData } from "@/types/workflow";
```

Replace with:
```typescript
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
    // A field is "unresolved" if it exists in the data as null (was imported but not yet configured)
    if (field in data && data[field] === null) {
      unresolved.push(label);
    }
  }
  return unresolved;
}
```

Add the warning banner inside the sidebar. Find:
```tsx
      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {renderPanel()}
        </div>
      </ScrollArea>
```

Replace with:
```tsx
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
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | grep WorkflowSidebar | head -10`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/automacoes/WorkflowSidebar.tsx
git commit -m "feat(workflow-portability): unresolved ref warnings in sidebar"
```

---

### Task 9: Fix useOrganization Compatibility

**Files:**
- Modify: `src/hooks/useWorkflowPortability.ts` (if needed)

- [ ] **Step 1: Check if useOrganization exposes organization name**

Run: `grep -n "return" src/hooks/useOrganization.ts | head -5`

If `organizationName` is not in the return value, update `useExportWorkflow` to not depend on it.

In `src/hooks/useWorkflowPortability.ts`, if needed, find:
```typescript
  const { organizationName } = useOrganization();
```

Replace with:
```typescript
  const { organizationId } = useOrganization();
```

And find:
```typescript
        const file = exportWorkflow(workflow, organizationName ?? undefined);
```

Replace with:
```typescript
        const file = exportWorkflow(workflow);
```

- [ ] **Step 2: Run full test suite to confirm nothing broke**

Run: `npx vitest run tests/unit/workflowPortability.test.ts --reporter=verbose`

Expected: All tests pass.

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | tail -5`

Expected: No new errors introduced.

- [ ] **Step 4: Commit (only if changes were made)**

```bash
git add src/hooks/useWorkflowPortability.ts
git commit -m "fix(workflow-portability): adjust org name fallback for compatibility"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run tests/unit/ --reporter=verbose`

Expected: All tests pass, including the new workflowPortability tests.

- [ ] **Step 2: Run TypeScript compilation check**

Run: `npx tsc --noEmit 2>&1 | tail -20`

Expected: No errors from the new files.

- [ ] **Step 3: Verify build succeeds**

Run: `npx vite build 2>&1 | tail -10`

Expected: Build completes without errors.

- [ ] **Step 4: Final commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore(workflow-portability): final fixups and verification"
```
