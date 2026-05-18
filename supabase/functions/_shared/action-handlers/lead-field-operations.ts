import type { ActionInput, ActionResult } from "./types.ts";

/**
 * Update a standard lead field (name, company, phone, etc.).
 * Expects params.fieldName and params.fieldValue (pre-resolved if using variable templates).
 */
export async function updateLeadField(input: ActionInput): Promise<ActionResult> {
  const { supabase, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for updateLeadField" };
  }

  const fieldName = params.fieldName as string | undefined;
  const fieldValue = (params.fieldValue as string) ?? "";

  if (!fieldName) {
    return { success: false, error: "No field name configured" };
  }

  await supabase.from("leads").update({ [fieldName]: fieldValue }).eq("id", leadId);

  return {
    success: true,
    message: `Field "${fieldName}" updated`,
    data: { fieldName, fieldValue },
  };
}

/**
 * Update a custom field value for a lead.
 * Expects params.customFieldName and params.customFieldValue (pre-resolved).
 */
export async function updateCustomField(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for updateCustomField" };
  }

  const fieldName = params.customFieldName as string | undefined;
  const fieldValue = (params.customFieldValue as string) ?? "";

  if (!fieldName) {
    return { success: false, error: "No custom field name configured" };
  }

  // Find custom field definition for this org
  const { data: field } = await supabase
    .from("lead_custom_fields")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("field_name", fieldName)
    .maybeSingle();

  if (!field) {
    return { success: false, error: `Custom field "${fieldName}" not found` };
  }

  await supabase.from("lead_custom_field_values").upsert(
    {
      lead_id: leadId,
      field_id: field.id,
      value: fieldValue,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "lead_id,field_id" },
  );

  return { success: true, message: `Custom field "${fieldName}" updated to "${fieldValue}"` };
}

/**
 * Update lead rating (0-10 clamped).
 * Expects params.ratingValue (number or string).
 */
export async function updateRating(input: ActionInput): Promise<ActionResult> {
  const { supabase, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for updateRating" };
  }

  const rating = Number(params.ratingValue ?? 0);
  const clamped = Math.min(10, Math.max(0, rating));

  await supabase.from("leads").update({ rating: clamped }).eq("id", leadId);

  return { success: true, message: `Rating updated to ${clamped}` };
}
