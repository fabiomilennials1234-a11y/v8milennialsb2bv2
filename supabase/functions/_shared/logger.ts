/**
 * Runtime logger for Supabase Edge Functions
 *
 * Inserts structured log records into the runtime_logs table.
 * Never throws — silently fails to avoid breaking the main flow.
 *
 * Security: all payloads pass through redactSecrets() before persisting.
 * Over-redaction (e.g. user_token_count matched by "token") is intentional —
 * security > debug verbosity.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logError } from "./error-boundary.ts";

/**
 * Key patterns to redact (case-insensitive substring match on key name).
 * Over-redaction is acceptable — a false positive loses debug info,
 * a false negative leaks a credential.
 */
const SENSITIVE_KEY_PATTERNS = [
  "uazapi_token",
  "admin_token",
  "admintoken",
  "token",
  "apikey",
  "api_key",
  "api-key",
  "authorization",
  "webhook_secret",
  "x-uazapi-webhook-secret",
  "bearer",
  "password",
  "secret",
];

const REDACTED = "***REDACTED***";
const BEARER_RE = /^(Bearer|Basic)\s+\S+/i;

/**
 * Returns true if the given key name should have its value redacted.
 * Match is case-insensitive substring: if the key contains any sensitive
 * pattern, it is redacted.
 */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Redacts a string value: if it starts with "Bearer " or "Basic ",
 * preserves the prefix and replaces the credential portion.
 */
function redactString(value: string): string {
  if (BEARER_RE.test(value)) {
    const spaceIdx = value.indexOf(" ");
    return value.slice(0, spaceIdx + 1) + REDACTED;
  }
  return value;
}

/**
 * Pure function. Deep-clones input and replaces sensitive values with
 * "***REDACTED***". Handles objects, arrays, primitives, null, undefined.
 * Circular references are detected via a WeakSet and replaced with the
 * string "[Circular]" to prevent stack overflow.
 *
 * Over-redaction note: any key whose name CONTAINS a sensitive pattern
 * (e.g. "user_token_count") will be redacted. This is intentional.
 *
 * @param input - Any JSON-like value
 * @param _seen - Internal WeakSet for circular reference tracking
 */
export function redactSecrets(input: unknown, _seen?: WeakSet<object>): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return redactString(input);
  if (typeof input !== "object") return input;

  // Circular reference guard
  const seen = _seen ?? new WeakSet<object>();
  if (seen.has(input as object)) return "[Circular]";
  seen.add(input as object);

  if (Array.isArray(input)) {
    const result = (input as unknown[]).map((item) => redactSecrets(item, seen));
    seen.delete(input as object);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      // Preserve Bearer/Basic prefix even when key is sensitive
      if (typeof value === "string" && BEARER_RE.test(value)) {
        const spaceIdx = value.indexOf(" ");
        result[key] = value.slice(0, spaceIdx + 1) + REDACTED;
      } else {
        result[key] = REDACTED;
      }
    } else {
      result[key] = redactSecrets(value, seen);
    }
  }

  seen.delete(input as object);
  return result;
}

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
  // Onda 2 / T2.B.2: telemetria de performance + custo LLM
  durationMs?: number;
  tokens?: { prompt?: number; completion?: number; model?: string };
  // RC.1: chain-of-thought capturado do agente (extraído de <thinking>...</thinking>)
  reasoning?: string;
}

/**
 * Inserts a runtime_logs record using the service role key.
 * Never throws — if the insert fails, it silently logs to console and returns.
 * All payloadSnapshot data is passed through redactSecrets() before persisting.
 */
export async function logRuntime(params: LogRuntimeParams): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const sanitizedPayload = params.payloadSnapshot
      ? (redactSecrets(params.payloadSnapshot) as Record<string, unknown>)
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
      duration_ms: params.durationMs ?? null,
      prompt_tokens: params.tokens?.prompt ?? null,
      completion_tokens: params.tokens?.completion ?? null,
      llm_model: params.tokens?.model ?? null,
      reasoning: params.reasoning ?? null,
    });
  } catch (err) {
    console.warn("[logRuntime] Failed to write log (non-fatal):", err);
    // Surface persistent insert failures to runtime logs instead of swallowing them.
    // A CHECK/enum drift can silently drop an entire module's logs (incident
    // 2026-06-24: 'whatsapp' missing from runtime_logs_module_check dropped 100%
    // of WhatsApp telemetry for days, hiding the inbound outage). logError
    // never throws, so this stays strictly non-fatal on the hot path.
    try {
      await logError(err, {
        functionName: "logRuntime",
        organizationId: params.organizationId,
        extra: {
          log_module: params.module,
          log_action: params.action,
          log_status: params.status,
        },
      });
    } catch {
      // never let observability reporting break the caller
    }
  }
}
