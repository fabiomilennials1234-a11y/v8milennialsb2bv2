/**
 * Runtime logger for Supabase Edge Functions
 *
 * Inserts structured log records into the runtime_logs table.
 * Never throws — silently fails to avoid breaking the main flow.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SENSITIVE_KEYS = /password|token|secret|key|authorization/i;

interface LogRuntimeParams {
  organizationId?: string;
  module: string;
  action: string;
  status: "success" | "error" | "skipped";
  payloadSnapshot?: Record<string, unknown>;
  errorMessage?: string;
  entityType?: string;
  entityId?: string;
  triggeredBy?: string;
}

/**
 * Inserts a runtime_logs record using the service role key.
 * Never throws — if the insert fails, it silently logs to console and returns.
 */
export async function logRuntime(params: LogRuntimeParams): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const sanitizedPayload = params.payloadSnapshot
      ? sanitize(params.payloadSnapshot)
      : undefined;

    await supabase.from("runtime_logs").insert({
      organization_id: params.organizationId || null,
      module: params.module,
      action: params.action,
      status: params.status,
      payload_snapshot: sanitizedPayload || null,
      error_message: params.errorMessage || null,
      entity_type: params.entityType || null,
      entity_id: params.entityId || null,
      triggered_by: params.triggeredBy || null,
    });
  } catch (err) {
    console.warn("[logRuntime] Failed to write log (non-fatal):", err);
  }
}

/**
 * Recursively removes sensitive fields from an object.
 */
function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(key)) {
      result[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = sanitize(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}
