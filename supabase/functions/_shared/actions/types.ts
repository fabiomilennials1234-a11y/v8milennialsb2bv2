/**
 * Tipos compartilhados pelos handlers de AI Actions.
 *
 * Mantidos isolados pra evitar ciclos de import entre handlers e o dispatcher.
 */

export interface ActionRecord {
  id: string;
  organization_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  action_type: string;
  payload: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Action types enfileirados por callers (workflow `copilot` node em
 * workflow-executor.ts:344, kanban rules legacy) que ainda não têm handler real.
 *
 * Tratados como noop com log explícito (status=skipped) em vez de
 * "Tipo de ação desconhecido" → retry → dead_letter.
 */
export const NOOP_ACTION_TYPES: ReadonlySet<string> = new Set<string>([
  "generate_message",
  "send_product_material",
]);
