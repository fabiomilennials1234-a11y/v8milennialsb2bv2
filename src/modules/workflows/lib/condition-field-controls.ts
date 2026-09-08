import type { ConditionOperator } from "@/types/workflow";

export type ConditionValueKind = "text" | "number" | "date" | "boolean" | "select";
const EMPTY: ConditionOperator[] = ["is_empty", "is_not_empty"];
const EXACT: ConditionOperator[] = ["equals", "not_equals", ...EMPTY];
const TEXT: ConditionOperator[] = ["equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with", ...EMPTY];
const NUMBER: ConditionOperator[] = ["equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal", ...EMPTY];
export const RESPONSIBLE_FIELDS = new Set(["pre_sale_responsible_id", "sale_responsible_id", "any_responsible", "sdr_id"]);
export const NUMERIC_FIELDS = new Set(["rating", "score", "deal_value", "days_in_stage"]);
export const OBSERVED_FIELDS = new Set(["segment", "urgency", "faturamento"]);
export const UNSUPPORTED_FIELDS: Record<string, string> = {
  last_message: "Última mensagem", message_count: "Quantidade de mensagens", days_since_contact: "Dias sem contato",
};
export const VALUELESS_OPERATORS = new Set(["is_empty", "is_not_empty", "is_true", "is_false"]);

export function conditionValueKind(field: string, customType?: ConditionValueKind): ConditionValueKind {
  if (field.startsWith("custom.")) return customType ?? "text";
  if (field === "has_open_deal") return "boolean";
  if (NUMERIC_FIELDS.has(field)) return "number";
  return "text";
}

export function conditionOperators(field: string, customType?: ConditionValueKind): ConditionOperator[] {
  if (field === "tag" || field === "tags") return ["has_tag", "not_has_tag", ...EMPTY];
  if (field === "stage" || field === "stage_id") return ["in_stage", "not_in_stage", ...EMPTY];
  if (RESPONSIBLE_FIELDS.has(field) || field === "origin") return EXACT;
  const kind = conditionValueKind(field, customType);
  if (kind === "number") return NUMBER;
  if (kind === "boolean") return [...EXACT, "is_true", "is_false"];
  // Date values are ISO dates; the legacy evaluator supports exact comparison,
  // not date arithmetic. Do not offer numeric comparisons that parse only the year.
  if (kind === "date" || kind === "select") return EXACT;
  return TEXT;
}

export function defaultConditionOperator(field: string, customType?: ConditionValueKind): ConditionOperator {
  if (field === "tags" || field === "tag") return "has_tag";
  if (field === "stage_id" || field === "stage") return "in_stage";
  if (field.startsWith("utm_") || field === "custom" || (field.startsWith("custom.") && (!customType || customType === "text"))) return "contains";
  return "equals";
}
