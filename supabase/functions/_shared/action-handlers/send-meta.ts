/**
 * send_meta_message / send_semi_automatic action handlers.
 * Extracted from workflow-action-handler.ts.
 */

import type { ActionInput, ActionResult } from "./types.ts";
import { resolveVariables } from "./whatsapp-helpers.ts";
import { governGate } from "./send-governor.ts";

// ─── Meta Message (Instagram / Facebook) ───────────────────────────────────

export async function sendMetaMessage(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendMetaMessage" };
  }

  // Send Governor gate. No WhatsApp instance here, so jitter + caps are inert; only
  // the channel-agnostic quiet-hours guard applies (don't DM a lead at 3am). Flag
  // OFF = no-op, so this never changes Meta behaviour until the governor is enabled.
  const metaGate = await governGate({
    supabase, organizationId, params, executionContext, sendClass: "automation",
  });
  if (metaGate.defer) return metaGate.result;

  const channel = (params.metaChannel as string) || "instagram";
  const message = (params.metaMessage as string) || "";
  const resolved = await resolveVariables(supabase, leadId, message, executionContext);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const res = await fetch(`${supabaseUrl}/functions/v1/send-meta-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      organization_id: organizationId,
      lead_id: leadId,
      channel,
      message: resolved,
    }),
  });

  if (!res.ok) return { success: false, error: `Meta message failed: ${await res.text()}` };
  return { success: true, message: `Meta ${channel} message sent` };
}

// ─── Semi-automatic (approval queue) ───────────────────────────────────────

export async function sendSemiAutomatic(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendSemiAutomatic" };
  }

  const message = (params.semiAutoMessage as string) || "";
  const resolved = await resolveVariables(supabase, leadId, message, executionContext);

  const { error } = await supabase.from("scheduled_pipe_messages").insert({
    lead_id: leadId,
    organization_id: organizationId,
    message_content: resolved,
    status: "waiting_approval",
    approver_id: params.semiAutoApprover || null,
    source: "workflow",
    scheduled_at: new Date().toISOString(),
  });

  if (error) return { success: false, error: error.message };
  return { success: true, message: "Semi-automatic message queued for approval" };
}
