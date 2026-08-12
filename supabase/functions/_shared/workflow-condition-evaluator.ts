/**
 * Workflow Condition Evaluator
 *
 * Evaluates condition nodes against lead data.
 * Supports all 21 condition operators defined in the workflow editor.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPipeEntry } from "./pipeline-adapter.ts";

export interface ConditionParams {
  field: string;
  operator: string;
  value: string;
}

interface LeadData {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  segment?: string;
  rating?: number;
  qualification_score?: number;
  organization_id?: string;
  // `pipe_whatsapp` saiu daqui de propósito (ADR-0023 §10): declará-la sinaliza
  // campo suportado, e o valor congela depois do MOVE. O campo do editor é
  // `stage`, resolvido pelo negócio logo abaixo.
  origin?: string;
  sdr_id?: string;
  closer_id?: string;
  responsible_id?: string;
  pre_sale_responsible_id?: string;
  sale_responsible_id?: string;
  urgency?: string;
  faturamento?: string;
  notes?: string;
  [key: string]: unknown;
}

/**
 * Evaluates a condition against a lead, returning true/false.
 */
export async function evaluateCondition(
  supabase: SupabaseClient,
  leadId: string,
  condition: ConditionParams,
): Promise<boolean> {
  const { field, operator, value } = condition;

  // Fetch lead data
  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return false;
  const leadData = lead as LeadData;

  // Resolve field value
  let fieldValue: unknown;

  if (field.startsWith("custom.")) {
    // Custom field: custom.campo_name
    const customFieldName = field.substring(7);
    fieldValue = await getCustomFieldValue(supabase, leadId, customFieldName, leadData);
  } else if (field === "tags") {
    // Special: tags field — returns comma-separated tag names
    fieldValue = await getLeadTags(supabase, leadId);
  } else if (field === "stage") {
    // ADR-0023 §10: a etapa é a do NEGÓCIO, não a da coluna espelho do lead.
    //
    // Este é o pior dos leitores de `leads.pipe_whatsapp`, e por isso o mais
    // urgente: a partir do L2 o negócio SAI de Oportunidades por UPDATE, e o
    // gatilho `sync_pipeline_entry_to_lead_pipe_whatsapp` resolve o slug por
    // `NEW.pipeline_id` — que já é `propostas`. Ele não escreve, e a coluna
    // CONGELA na última etapa de whatsapp em vez de esvaziar. Uma condição de
    // automação comparando `stage` passaria a casar SEMPRE contra um estado que
    // o negócio não ocupa mais. Não é envio faltando: é envio errado, repetido,
    // sem nada na tela denunciando.
    const waEntry = await getPipeEntry(
      supabase, leadId, leadData.organization_id as string, "whatsapp",
    );
    fieldValue = waEntry?.stage_key || "";
  } else if (field === "score") {
    fieldValue = leadData.qualification_score ?? 0;
  } else if (field === "any_responsible") {
    // Matches if EITHER the pre-sales or the sales responsible satisfies the operator.
    return compareAnyResponsible(
      leadData.pre_sale_responsible_id,
      leadData.sale_responsible_id,
      operator,
      value,
    );
  } else {
    fieldValue = leadData[field];
  }

  return compare(fieldValue, operator, value);
}

/**
 * Evaluates an operator against BOTH responsible columns (pré-vendas + vendas),
 * for the `any_responsible` pseudo-field. Reuses `compare` per column and
 * combines with the semantically correct boolean:
 * - equals / default        → OR  (either column matches)
 * - not_equals              → AND (neither column matches)
 * - is_empty                → AND (both columns empty)
 * - is_not_empty            → OR  (at least one column set)
 */
export function compareAnyResponsible(
  preSale: unknown,
  sale: unknown,
  operator: string,
  value: string,
): boolean {
  switch (operator) {
    case "not_equals":
    case "is_empty":
      return compare(preSale, operator, value) && compare(sale, operator, value);
    default:
      return compare(preSale, operator, value) || compare(sale, operator, value);
  }
}

export function compare(fieldValue: unknown, operator: string, conditionValue: string): boolean {
  const strField = fieldValue == null ? "" : String(fieldValue);
  const numField = Number(fieldValue);
  const numCondition = Number(conditionValue);

  switch (operator) {
    case "equals":
      return strField.toLowerCase() === conditionValue.toLowerCase();

    case "not_equals":
      return strField.toLowerCase() !== conditionValue.toLowerCase();

    case "contains":
      return strField.toLowerCase().includes(conditionValue.toLowerCase());

    case "not_contains":
      return !strField.toLowerCase().includes(conditionValue.toLowerCase());

    case "greater_than":
      return !isNaN(numField) && !isNaN(numCondition) && numField > numCondition;

    case "less_than":
      return !isNaN(numField) && !isNaN(numCondition) && numField < numCondition;

    case "greater_or_equal":
      return !isNaN(numField) && !isNaN(numCondition) && numField >= numCondition;

    case "less_or_equal":
      return !isNaN(numField) && !isNaN(numCondition) && numField <= numCondition;

    case "is_empty":
      return strField.trim() === "" || fieldValue == null;

    case "is_not_empty":
      return strField.trim() !== "" && fieldValue != null;

    case "has_tag":
      // fieldValue should be comma-separated tag names
      return strField.toLowerCase().split(",").map(t => t.trim()).includes(conditionValue.toLowerCase());

    case "not_has_tag":
      return !strField.toLowerCase().split(",").map(t => t.trim()).includes(conditionValue.toLowerCase());

    case "in_stage":
      return strField.toLowerCase() === conditionValue.toLowerCase();

    case "not_in_stage":
      return strField.toLowerCase() !== conditionValue.toLowerCase();

    case "starts_with":
      return strField.toLowerCase().startsWith(conditionValue.toLowerCase());

    case "ends_with":
      return strField.toLowerCase().endsWith(conditionValue.toLowerCase());

    case "in_list": {
      const list = conditionValue.split(",").map(v => v.trim().toLowerCase());
      return list.includes(strField.toLowerCase());
    }

    case "not_in_list": {
      const list = conditionValue.split(",").map(v => v.trim().toLowerCase());
      return !list.includes(strField.toLowerCase());
    }

    case "is_true":
      return strField === "true" || strField === "1" || fieldValue === true;

    case "is_false":
      return strField === "false" || strField === "0" || fieldValue === false || fieldValue == null;

    case "regex_match":
      try {
        return new RegExp(conditionValue, "i").test(strField);
      } catch {
        return false;
      }

    default:
      console.warn(`[workflow-condition] Unknown operator: ${operator}`);
      return false;
  }
}

async function getCustomFieldValue(
  supabase: SupabaseClient,
  leadId: string,
  fieldName: string,
  leadData: LeadData,
): Promise<string> {
  // Try to get from lead_custom_field_values
  const orgId = leadData.organization_id as string;
  if (!orgId) return "";

  const { data: field } = await supabase
    .from("lead_custom_fields")
    .select("id")
    .eq("organization_id", orgId)
    .eq("field_name", fieldName)
    .maybeSingle();

  if (!field) return "";

  const { data: val } = await supabase
    .from("lead_custom_field_values")
    .select("value")
    .eq("lead_id", leadId)
    .eq("field_id", field.id)
    .maybeSingle();

  return val?.value || "";
}

export async function getLeadTags(
  supabase: SupabaseClient,
  leadId: string,
): Promise<string> {
  const { data: tags } = await supabase
    .from("lead_tags")
    .select("tag:tags(name)")
    .eq("lead_id", leadId);

  if (!tags || tags.length === 0) return "";
  // Sem o `Database` gerado, o parser de tipos do postgrest-js chuta ARRAY para
  // o embed `tag:tags(name)`. A relação é muitos-para-um
  // (`lead_tags.tag_id → tags.id`) e o PostgREST devolve OBJETO — que é o que
  // este código lê. Asserção (e não `.returns<>()`, que é chamada de runtime no
  // builder) para que o acerto seja só de tipo.
  const tagRows = tags as unknown as Array<{ tag: { name: string | null } | null }>;
  return tagRows.map((t) => t.tag?.name || "").filter(Boolean).join(",");
}
