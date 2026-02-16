/**
 * Wizard Configs - Exporta todas as configurações por tipo de copilot
 */

export { STEP_REGISTRY } from "./registry";
export { QUALIFICADOR_CONFIG } from "./qualificador.config";
export { SDR_CONFIG } from "./sdr.config";
export { FOLLOWUP_CONFIG } from "./followup.config";
export { AGENDADOR_CONFIG } from "./agendador.config";
export { PROSPECTADOR_CONFIG } from "./prospectador.config";
export type { WizardTypeConfig, StepRegistryEntry, KanbanRulePreset, SuggestedCapabilities } from "./types";

import type { AgentTemplateType } from "@/types/copilot";
import type { WizardTypeConfig } from "./types";
import { QUALIFICADOR_CONFIG } from "./qualificador.config";
import { SDR_CONFIG } from "./sdr.config";
import { FOLLOWUP_CONFIG } from "./followup.config";
import { AGENDADOR_CONFIG } from "./agendador.config";
import { PROSPECTADOR_CONFIG } from "./prospectador.config";

/** Mapa de todas as configs indexado por tipo */
export const WIZARD_CONFIGS: Record<string, WizardTypeConfig> = {
  qualificador: QUALIFICADOR_CONFIG,
  sdr: SDR_CONFIG,
  followup: FOLLOWUP_CONFIG,
  agendador: AGENDADOR_CONFIG,
  prospectador: PROSPECTADOR_CONFIG,
};

/** Retorna a config de wizard para um tipo de copilot */
export function getWizardConfig(type: string): WizardTypeConfig | null {
  return WIZARD_CONFIGS[type] || null;
}

/** Retorna todos os tipos disponíveis (sem custom) */
export function getAvailableWizardTypes(): AgentTemplateType[] {
  return Object.keys(WIZARD_CONFIGS) as AgentTemplateType[];
}
