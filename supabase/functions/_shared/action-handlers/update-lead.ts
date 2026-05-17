import type { ActionInput, ActionResult } from "./types.ts";

const ALLOWED_FIELDS = new Set([
  "name",
  "email",
  "phone",
  "company_name",
  "rating",
  "notes",
  "status",
  "temperature",
]);

export async function updateLead(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for updateLead" };
  }

  const fields = params.fields as Record<string, unknown> | undefined;
  if (!fields || typeof fields !== "object" || Object.keys(fields).length === 0) {
    return { success: false, error: "fields param is required and must be a non-empty object" };
  }

  // Filter only allowed fields
  const safeFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED_FIELDS.has(key)) {
      safeFields[key] = value;
    }
  }

  if (Object.keys(safeFields).length === 0) {
    return { success: false, error: "No allowed fields provided. Allowed: " + [...ALLOWED_FIELDS].join(", ") };
  }

  const { error } = await supabase
    .from("leads")
    .update(safeFields)
    .eq("id", leadId)
    .eq("organization_id", organizationId);

  if (error) {
    return { success: false, error: `DB update failed: ${error.message}` };
  }

  const count = Object.keys(safeFields).length;
  return {
    success: true,
    message: `Updated ${count} field${count > 1 ? "s" : ""}`,
    data: { updated_fields: Object.keys(safeFields), count },
  };
}
