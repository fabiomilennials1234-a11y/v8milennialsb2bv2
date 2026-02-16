/**
 * Tipos para o sistema de Wizard Configuration-Driven
 *
 * Cada tipo de copilot define quais steps são mostrados,
 * em que ordem, com quais defaults e validações.
 */

import type { ComponentType } from "react";
import type { AgentTemplateType, CopilotWizardData } from "@/types/copilot";
import type { KanbanRuleForm } from "@/hooks/useAgentKanbanRules";

/** Registro de um step no wizard */
export interface StepRegistryEntry {
  component: ComponentType;
  title: string;
  fieldToValidate: keyof CopilotWizardData | (keyof CopilotWizardData)[];
}

/** Regra kanban sugerida por tipo de copilot */
export interface KanbanRulePreset {
  pipe_type: string;
  stage_name: string;
  goal: string;
  behavior: string;
  allowed_actions: string[];
  forbidden_actions: string[];
}

/** Capabilities sugeridas por tipo */
export interface SuggestedCapabilities {
  can_qualify_lead: boolean;
  can_schedule_meeting: boolean;
  can_send_followup: boolean;
  can_update_crm: boolean;
  can_answer_faq: boolean;
  can_create_lead: boolean;
  can_transfer_human: boolean;
}

/** Configuração completa de um tipo de wizard */
export interface WizardTypeConfig {
  type: AgentTemplateType;
  label: string;
  description: string;
  /** IDs dos steps a exibir (na ordem) */
  steps: string[];
  /** Defaults específicos para este tipo */
  defaults: Partial<CopilotWizardData>;
  /** Regras kanban sugeridas para pré-popular */
  suggestedKanbanRules: KanbanRulePreset[];
  /** Capabilities auto-setadas ao criar */
  suggestedCapabilities: SuggestedCapabilities;
}
