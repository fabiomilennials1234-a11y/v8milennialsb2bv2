/**
 * AI Action handlers — CRUD do lead.
 *
 *  - executeCreateLead: cria novo lead via Copilot
 *  - executeUpdateLead: atualiza campos padrão / custom / notas
 *  - executeCreateCustomField: cria campo personalizado e opcionalmente preenche
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeString } from "../validation.ts";
import type { ActionResult } from "./types.ts";

const UPDATE_LEAD_STANDARD_FIELDS = ["company", "segment", "urgency", "faturamento", "rating"];

export async function executeCreateLead(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const { name, email, phone, company } = params;
  if (!name || !tenantId) {
    return { success: false, error: "name e tenant_id são obrigatórios" };
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({ name, email, phone, company, origin: "web", organization_id: tenantId })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, message: "Lead criado", data: { lead_id: lead.id } };
}

export async function executeUpdateLead(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const lead_id = params.lead_id as string;
  const updates = params.updates as Record<string, unknown>;

  if (
    !lead_id ||
    !updates ||
    typeof updates !== "object" ||
    Object.keys(updates).length === 0
  ) {
    return { success: false, error: "lead_id e updates são obrigatórios" };
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("id, notes")
    .eq("id", lead_id)
    .eq("organization_id", tenantId)
    .maybeSingle();

  if (!lead) return { success: false, error: "Lead não encontrado" };

  const { data: customFields } = await supabase
    .from("lead_custom_fields")
    .select("id, field_name")
    .eq("organization_id", tenantId);

  const customFieldMap = new Map(
    (customFields || []).map((f: { id: string; field_name: string }) => [f.field_name, f.id]),
  );

  const leadUpdates: Record<string, unknown> = {};
  const customFieldUpdates: { field_id: string; value: string }[] = [];
  const notesToAppend: string[] = [];
  const now = new Date();
  const datePrefix = `[IA - ${now.getDate().toString().padStart(2, "0")}/${(now.getMonth() + 1).toString().padStart(2, "0")}/${now.getFullYear()} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}]`;

  for (const [key, rawValue] of Object.entries(updates)) {
    if (rawValue == null) continue;
    const strVal = String(rawValue).trim();
    if (strVal === "") continue;
    const sanitized = sanitizeString(strVal, 2000) ?? "";

    if (UPDATE_LEAD_STANDARD_FIELDS.includes(key)) {
      if (key === "rating") {
        const num = parseInt(sanitized, 10);
        if (!isNaN(num) && num >= 0 && num <= 10) leadUpdates[key] = num;
      } else {
        leadUpdates[key] = sanitized;
      }
    } else if (customFieldMap.has(key)) {
      customFieldUpdates.push({ field_id: customFieldMap.get(key)!, value: sanitized });
    } else {
      notesToAppend.push(`${datePrefix} ${key}: ${sanitized}`);
    }
  }

  if (Object.keys(leadUpdates).length > 0) {
    await supabase
      .from("leads")
      .update(leadUpdates)
      .eq("id", lead_id)
      .eq("organization_id", tenantId);
  }
  if (notesToAppend.length > 0) {
    const newNotes = notesToAppend.join("\n");
    const updatedNotes = lead.notes ? `${lead.notes}\n\n${newNotes}` : newNotes;
    await supabase
      .from("leads")
      .update({ notes: sanitizeString(updatedNotes, 5000) ?? updatedNotes })
      .eq("id", lead_id)
      .eq("organization_id", tenantId);
  }
  for (const cf of customFieldUpdates) {
    await supabase.from("lead_custom_field_values").upsert(
      {
        lead_id,
        field_id: cf.field_id,
        value: cf.value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lead_id,field_id" },
    );
  }

  return { success: true, message: "Lead atualizado", data: { lead_id } };
}

export async function executeCreateCustomField(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const { field_name, field_type, field_options, initial_value } = params as {
    field_name?: string;
    field_type?: string;
    field_options?: string[];
    initial_value?: string;
  };
  const currentLeadId = params.current_lead_id as string | undefined;

  if (!field_name || !field_type) {
    return { success: false, error: "field_name e field_type são obrigatórios" };
  }

  const validTypes = ["text", "number", "date", "select", "boolean"];
  if (!validTypes.includes(field_type)) {
    return { success: false, error: `field_type inválido. Use: ${validTypes.join(", ")}` };
  }

  if (
    field_type === "select" &&
    (!field_options || !Array.isArray(field_options) || field_options.length === 0)
  ) {
    return { success: false, error: "field_options obrigatório para tipo select" };
  }

  const { data: existing } = await supabase
    .from("lead_custom_fields")
    .select("id")
    .eq("organization_id", tenantId)
    .eq("field_name", field_name)
    .maybeSingle();

  let fieldId: string;

  if (existing) {
    fieldId = existing.id;
  } else {
    const { data: maxOrder } = await supabase
      .from("lead_custom_fields")
      .select("display_order")
      .eq("organization_id", tenantId)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextOrder = (maxOrder?.display_order ?? 0) + 1;

    const { data: newField, error: createError } = await supabase
      .from("lead_custom_fields")
      .insert({
        organization_id: tenantId,
        field_name,
        field_type,
        field_options: field_type === "select" ? field_options : null,
        is_required: false,
        display_order: nextOrder,
      })
      .select("id")
      .single();

    if (createError) {
      return { success: false, error: `Erro ao criar campo: ${createError.message}` };
    }
    fieldId = newField.id;
  }

  if (initial_value && currentLeadId) {
    await supabase.from("lead_custom_field_values").upsert(
      {
        lead_id: currentLeadId,
        field_id: fieldId,
        value: String(initial_value).trim(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lead_id,field_id" },
    );
  }

  return {
    success: true,
    message: existing
      ? `Campo "${field_name}" já existia${initial_value ? ` (valor: ${initial_value})` : ""}`
      : `Campo "${field_name}" criado${initial_value ? ` (valor: ${initial_value})` : ""}`,
    data: { field_id: fieldId, field_name },
  };
}
