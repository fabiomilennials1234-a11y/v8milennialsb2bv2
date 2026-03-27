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
