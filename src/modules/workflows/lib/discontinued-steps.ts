import { isDiscontinuedGuidedField } from "@/contracts/workflows/guided-fields";
import { isDiscontinuedAction, isDiscontinuedTrigger } from "@/types/workflow";

/**
 * Passos de score/rating do lead (descontinuados — CTO, 2026-10-02) dentro de
 * uma definição salva. Lê `unknown` de propósito: definições vêm do banco, de
 * templates e de importação, e nenhuma delas é confiável quanto à forma.
 */

/** Campos do condicional legado (não guiado) que liam score/rating. */
const DISCONTINUED_LEGACY_CONDITION_FIELDS = new Set(["score", "rating"]);

type Data = Record<string, unknown>;

function guidedHasDiscontinued(condition: unknown): boolean {
  if (!condition || typeof condition !== "object") return false;
  const c = condition as Data;
  if (Array.isArray(c.children)) return c.children.some(guidedHasDiscontinued);
  return isDiscontinuedGuidedField(c.field);
}

/** O nó em si é um passo descontinuado? */
export function isDiscontinuedNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const { type, data } = node as { type?: unknown; data?: unknown };
  const d = (data && typeof data === "object" ? data : {}) as Data;
  if (type === "trigger") return isDiscontinuedTrigger(d.triggerType as string | undefined);
  if (type === "action") return isDiscontinuedAction(d.actionType as string | undefined);
  if (type === "condition") {
    if (d.guidedCondition) return guidedHasDiscontinued(d.guidedCondition);
    return typeof d.field === "string" && DISCONTINUED_LEGACY_CONDITION_FIELDS.has(d.field);
  }
  return false;
}

/** Quantos passos descontinuados a definição carrega (0 = nenhum). */
export function countDiscontinuedSteps(definition: unknown): number {
  const nodes = definition && typeof definition === "object" ? (definition as { nodes?: unknown }).nodes : undefined;
  return Array.isArray(nodes) ? nodes.filter(isDiscontinuedNode).length : 0;
}
