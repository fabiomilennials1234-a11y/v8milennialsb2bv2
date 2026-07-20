// deno-lint-ignore-file no-explicit-any
/**
 * message-gateway — Unified WhatsApp message sending gateway.
 *
 * Single entry point for ALL outbound WhatsApp messages across the system.
 * Centralizes: instance resolution, phone normalization, dedup, rate limit,
 * provider dispatch, persistence, and structured logging.
 *
 * Feature-flagged per org (`unified_message_gateway`). When OFF, returns
 * { delegated: false } and caller falls back to legacy code path.
 */

import {
  resolveDispatchContext,
  normalizeBrazilianPhone,
  sendTextViaInstance,
  sendAudioViaInstance,
  sendMediaViaInstance,
  sendMenuViaInstance,
  sendPixButtonViaInstance,
  resolveInstance,
  type ResolvedDispatchContext,
} from "./whatsapp-dispatch.ts";
import type { WhatsAppInstance } from "./whatsapp-client.ts";
import { getWhatsAppProvider } from "./whatsapp-client.ts";
import { logRuntime } from "./logger.ts";
import { guardAutomaticSend } from "./send-window.ts";

// ============================================================================
// Types
// ============================================================================

export type MessageSource =
  | "copilot"
  | "workflow"
  | "manual"
  | "campaign"
  | "pipe"
  | "mass";

export type GatewayMessageType =
  | "text"
  | "audio"
  | "image"
  | "video"
  | "document"
  | "sticker"
  | "menu"
  | "pix_button";

export interface GatewaySendRequest {
  organization_id: string;
  phone: string;
  content: string | null;
  message_type: GatewayMessageType;
  source: MessageSource;

  media_url?: string;
  /** Original filename for document sends (shown by WhatsApp). Ignored by other types. */
  filename?: string;
  instance_id?: string;
  lead_id?: string;
  track_id?: string;
  humanize?: boolean;
  smart_split?: boolean;
  caption?: string;
  menu_options?: {
    type: "button" | "list" | "poll" | "carousel";
    choices: string[];
    footer?: string;
    selectableCount?: number;
  };
  pix_payload?: {
    pixkey: string;
    pixkeyType: "cpf" | "cnpj" | "email" | "phone" | "random";
    amount: number;
    merchantName: string;
  };

  triggered_by?: string;
  workflow_execution_id?: string;
  delay?: number;
  reply_id?: string;
}

export interface GatewaySendResult {
  success: boolean;
  /** false = flag OFF, caller must use legacy path */
  delegated: boolean;
  message_id?: string;
  provider_message_id?: string;
  parts_sent?: number;
  error?: string;
  error_code?: string;
  duration_ms?: number;
}

type StepStatus = "ok" | "skipped" | "failed" | "duplicate_blocked" | "exceeded";

interface StepLog {
  flag_check: StepStatus;
  phone_normalize: StepStatus;
  instance_resolve: StepStatus;
  dedup_check: StepStatus;
  rate_limit: StepStatus;
  provider_send: StepStatus | string;
  persist: StepStatus | string;
}

// ============================================================================
// Feature flag cache (same pattern as instance-write-guard.ts)
// ============================================================================

const gatewayFlagCache = new Map<string, { enabled: boolean; expiresAt: number }>();
const GATEWAY_FLAG_TTL_MS = 30_000;
const GATEWAY_FLAG_KEY = "unified_message_gateway";

export async function isGatewayEnabled(
  supabase: any,
  organizationId: string,
): Promise<boolean> {
  const cached = gatewayFlagCache.get(organizationId);
  if (cached && Date.now() < cached.expiresAt) return cached.enabled;

  let enabled = false;

  const { data: override } = await supabase
    .from("organization_features")
    .select("enabled, expires_at")
    .eq("organization_id", organizationId)
    .eq("feature_key", GATEWAY_FLAG_KEY)
    .maybeSingle();

  if (override) {
    const notExpired = !override.expires_at || new Date(override.expires_at) > new Date();
    if (notExpired) {
      enabled = !!override.enabled;
      gatewayFlagCache.set(organizationId, {
        enabled,
        expiresAt: Date.now() + GATEWAY_FLAG_TTL_MS,
      });
      return enabled;
    }
  }

  const { data: globalFlag } = await supabase
    .from("feature_flags")
    .select("default_enabled")
    .eq("key", GATEWAY_FLAG_KEY)
    .maybeSingle();

  enabled = !!globalFlag?.default_enabled;
  gatewayFlagCache.set(organizationId, {
    enabled,
    expiresAt: Date.now() + GATEWAY_FLAG_TTL_MS,
  });
  return enabled;
}

export function _resetGatewayFlagCache(): void {
  gatewayFlagCache.clear();
}

// ============================================================================
// Rate limit
// ============================================================================

const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_MAX = 30;

async function checkRateLimit(
  supabase: any,
  instanceId: string,
): Promise<"ok" | "exceeded"> {
  try {
    const { data } = await supabase.rpc("check_rate_limit", {
      client_identifier: `whatsapp:${instanceId}`,
      p_limit: RATE_LIMIT_MAX,
      window_seconds: RATE_LIMIT_WINDOW,
    });
    return data === true || data === null ? "ok" : "exceeded";
  } catch {
    return "ok";
  }
}

async function incrementRateLimit(
  supabase: any,
  instanceId: string,
): Promise<void> {
  try {
    await supabase.rpc("check_rate_limit", {
      client_identifier: `whatsapp:${instanceId}`,
      p_limit: 999999,
      window_seconds: RATE_LIMIT_WINDOW,
    });
  } catch {
    // Non-fatal
  }
}

// ============================================================================
// Dedup
// ============================================================================

async function checkDedup(
  supabase: any,
  trackId: string | undefined,
  orgId: string,
): Promise<"ok" | "duplicate_blocked"> {
  if (!trackId) return "ok";

  const { data } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("organization_id", orgId)
    .eq("message_id", trackId)
    .maybeSingle();

  return data ? "duplicate_blocked" : "ok";
}

// ============================================================================
// Persistence
// ============================================================================

async function persistMessage(
  supabase: any,
  params: {
    organization_id: string;
    instance_id: string;
    message_id: string;
    phone: string;
    content: string | null;
    message_type: string;
    source: MessageSource;
    lead_id?: string;
    media_url?: string;
  },
): Promise<"ok" | string> {
  try {
    const { error } = await supabase.from("whatsapp_messages").upsert(
      {
        organization_id: params.organization_id,
        instance_id: params.instance_id,
        message_id: params.message_id,
        remote_jid: params.phone + "@s.whatsapp.net",
        phone_number: params.phone,
        direction: "outgoing",
        message_type: params.message_type === "text" ? "conversation" : params.message_type,
        content: params.content,
        media_url: params.media_url ?? null,
        status: "sent",
        timestamp: new Date().toISOString(),
        lead_id: params.lead_id ?? null,
        sent_by_ai: params.source !== "manual",
        sent_source: params.source === "campaign" || params.source === "pipe" || params.source === "mass"
          ? "workflow"
          : params.source === "copilot"
            ? "copilot"
            : params.source === "workflow"
              ? "workflow"
              : "manual",
      },
      { onConflict: "message_id,instance_id", ignoreDuplicates: false },
    );
    if (error) return error.message;
    return "ok";
  } catch (e) {
    return (e as Error).message;
  }
}

// ============================================================================
// Provider dispatch
// ============================================================================

async function dispatchToProvider(
  supabase: any,
  instance: WhatsAppInstance,
  normalizedPhone: string,
  req: GatewaySendRequest,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  switch (req.message_type) {
    case "text":
      return sendTextViaInstance(supabase, instance, normalizedPhone, req.content ?? "", {
        trackSource: req.source,
        trackId: req.track_id,
        delay: req.delay,
        replyId: req.reply_id,
      });

    case "audio":
      return sendAudioViaInstance(supabase, instance, normalizedPhone, req.media_url ?? "", {
        trackSource: req.source,
        trackId: req.track_id,
      });

    case "menu":
      if (!req.menu_options) return { success: false, error: "menu_options required" };
      return sendMenuViaInstance(supabase, instance, normalizedPhone, {
        type: req.menu_options.type,
        text: req.content ?? "",
        choices: req.menu_options.choices,
        footer: req.menu_options.footer,
        selectableCount: req.menu_options.selectableCount,
      }, {
        trackSource: req.source,
        trackId: req.track_id,
        delay: req.delay,
      });

    case "pix_button":
      if (!req.pix_payload) return { success: false, error: "pix_payload required" };
      return sendPixButtonViaInstance(supabase, instance, normalizedPhone, {
        pixkey: req.pix_payload.pixkey,
        pixkeyType: req.pix_payload.pixkeyType,
        amount: req.pix_payload.amount,
        merchantName: req.pix_payload.merchantName,
        text: req.content ?? undefined,
      }, {
        trackSource: req.source,
        trackId: req.track_id,
        delay: req.delay,
      });

    case "image":
    case "video":
    case "document":
    case "sticker":
      return sendMediaViaInstance(supabase, instance, normalizedPhone, {
        type: req.message_type,
        file: req.media_url ?? "",
        filename: req.filename,
        caption: req.caption,
      }, {
        trackSource: req.source,
        trackId: req.track_id,
      });

    default:
      return { success: false, error: `Unsupported message_type: ${req.message_type}` };
  }
}

// ============================================================================
// Main entry point
// ============================================================================

export async function sendMessage(
  supabase: any,
  req: GatewaySendRequest,
): Promise<GatewaySendResult> {
  const startMs = Date.now();
  const steps: StepLog = {
    flag_check: "skipped",
    phone_normalize: "skipped",
    instance_resolve: "skipped",
    dedup_check: "skipped",
    rate_limit: "skipped",
    provider_send: "skipped",
    persist: "skipped",
  };

  // ── Step 1: Feature flag ─────────────────────────────────────────────────
  const flagEnabled = await isGatewayEnabled(supabase, req.organization_id);
  if (!flagEnabled) {
    steps.flag_check = "skipped";
    await logRuntime({
      organizationId: req.organization_id,
      module: "outbound",
      action: "send_delegated",
      status: "skipped",
      payloadSnapshot: { source: req.source, message_type: req.message_type },
      triggeredBy: req.triggered_by,
    });
    return { success: false, delegated: false, duration_ms: Date.now() - startMs };
  }
  steps.flag_check = "ok";

  // ── Step 1.5: Janela de envio automático ─────────────────────────────────
  // Barra sends automáticos (workflow/campanha/pipe/mass) fora do horário.
  // Manual (source='manual') passa. delegated:true + success:false → o caller
  // NÃO cai no fallback legado (que é reservado a flag OFF / delegated:false);
  // e se caísse, o backstop em whatsapp-dispatch bloquearia de novo.
  const windowGuard = await guardAutomaticSend(supabase, req.organization_id, req.source);
  if (!windowGuard.allowed) {
    await logRuntime({
      organizationId: req.organization_id,
      module: "outbound",
      action: "send",
      status: "skipped",
      reasoning: "OUTSIDE_SEND_WINDOW",
      payloadSnapshot: {
        source: req.source,
        message_type: req.message_type,
        next_valid_at: windowGuard.nextValidAt?.toISOString() ?? null,
      },
      triggeredBy: req.triggered_by,
    });
    return {
      success: false,
      delegated: true,
      error: "Outside automatic send window",
      error_code: "send_window_blocked",
      duration_ms: Date.now() - startMs,
    };
  }

  // ── Step 2: Normalize phone ──────────────────────────────────────────────
  const normalizedPhone = normalizeBrazilianPhone(req.phone);
  if (!normalizedPhone) {
    steps.phone_normalize = "failed";
    const result = buildErrorResult(startMs, "invalid_phone", "Phone normalization failed");
    await logSend(req, result, steps, { normalizedPhone: null });
    return result;
  }
  steps.phone_normalize = "ok";

  // ── Step 3: Dedup ────────────────────────────────────────────────────────
  const dedupResult = await checkDedup(supabase, req.track_id, req.organization_id);
  steps.dedup_check = dedupResult;
  if (dedupResult === "duplicate_blocked") {
    const result: GatewaySendResult = {
      success: false,
      delegated: true,
      error: "Duplicate message blocked",
      error_code: "duplicate_blocked",
      duration_ms: Date.now() - startMs,
    };
    await logRuntime({
      organizationId: req.organization_id,
      module: "outbound",
      action: "send",
      status: "skipped",
      payloadSnapshot: buildPayload(req, steps, { normalizedPhone, track_id: req.track_id }),
      triggeredBy: req.triggered_by,
    });
    return result;
  }

  // ── Step 4: Resolve instance ─────────────────────────────────────────────
  let instance: WhatsAppInstance | null = null;
  let instanceName: string | null = null;

  try {
    if (req.instance_id) {
      const { data } = await supabase
        .from("whatsapp_instances")
        .select("*")
        .eq("id", req.instance_id)
        .eq("organization_id", req.organization_id)
        .maybeSingle();
      instance = data as WhatsAppInstance | null;
    } else {
      const ctx = await resolveDispatchContext(supabase, {
        organization_id: req.organization_id,
        phone: normalizedPhone,
        lead_id: req.lead_id,
        require_connected: true,
      });
      instance = ctx.instance;
    }
    if (instance) {
      instanceName = (instance as any).instance_name ?? null;
    }
  } catch (e) {
    steps.instance_resolve = "failed";
    const result = buildErrorResult(startMs, "instance_resolve_failed", (e as Error).message);
    await logSend(req, result, steps, { normalizedPhone });
    return result;
  }

  if (!instance) {
    steps.instance_resolve = "failed";
    const result = buildErrorResult(startMs, "no_instance", "No WhatsApp instance available");
    await logSend(req, result, steps, { normalizedPhone });
    return result;
  }
  steps.instance_resolve = "ok";

  const instanceId = (instance as any).id as string;

  // ── Step 5: Rate limit ───────────────────────────────────────────────────
  const rlResult = await checkRateLimit(supabase, instanceId);
  steps.rate_limit = rlResult;
  if (rlResult === "exceeded") {
    const result = buildErrorResult(startMs, "rate_limited", `Rate limit exceeded for instance ${instanceId}`);
    await logSend(req, result, steps, { normalizedPhone, instanceId, instanceName });
    return result;
  }

  // ── Step 6: Provider dispatch ────────────────────────────────────────────
  const sendResult = await dispatchToProvider(supabase, instance, normalizedPhone, req);
  if (!sendResult.success) {
    steps.provider_send = sendResult.error ?? "failed";
    const result = buildErrorResult(startMs, "provider_error", sendResult.error ?? "Provider send failed");
    result.provider_message_id = sendResult.messageId;
    await logSend(req, result, steps, { normalizedPhone, instanceId, instanceName });
    return result;
  }
  steps.provider_send = "ok";

  // ── Step 7: Increment rate limit ─────────────────────────────────────────
  await incrementRateLimit(supabase, instanceId);

  // ── Step 8: Persist ──────────────────────────────────────────────────────
  const messageId = sendResult.messageId || req.track_id || crypto.randomUUID();
  const persistResult = await persistMessage(supabase, {
    organization_id: req.organization_id,
    instance_id: instanceId,
    message_id: messageId,
    phone: normalizedPhone,
    content: req.content,
    message_type: req.message_type,
    source: req.source,
    lead_id: req.lead_id,
    media_url: req.media_url,
  });
  steps.persist = persistResult;

  if (persistResult !== "ok") {
    const result: GatewaySendResult = {
      success: false,
      delegated: true,
      message_id: messageId,
      provider_message_id: sendResult.messageId,
      error: `Message sent but persist failed: ${persistResult}`,
      error_code: "persist_failed",
      duration_ms: Date.now() - startMs,
    };
    await logRuntime({
      organizationId: req.organization_id,
      module: "outbound",
      action: "send",
      status: "error",
      entityType: "whatsapp_messages",
      entityId: messageId,
      errorMessage: `MESSAGE_SENT_BUT_PERSIST_FAILED: ${persistResult}`,
      reasoning: "MESSAGE_SENT_BUT_PERSIST_FAILED",
      triggeredBy: req.triggered_by,
      durationMs: Date.now() - startMs,
      payloadSnapshot: buildPayload(req, steps, {
        normalizedPhone,
        instanceId,
        instanceName,
        provider_message_id: sendResult.messageId,
      }),
    });
    return result;
  }

  // ── Step 9: Log success ──────────────────────────────────────────────────
  const finalResult: GatewaySendResult = {
    success: true,
    delegated: true,
    message_id: messageId,
    provider_message_id: sendResult.messageId,
    parts_sent: 1,
    duration_ms: Date.now() - startMs,
  };

  await logSend(req, finalResult, steps, {
    normalizedPhone,
    instanceId,
    instanceName,
    provider_message_id: sendResult.messageId,
  });

  return finalResult;
}

// ============================================================================
// Helpers
// ============================================================================

function buildErrorResult(
  startMs: number,
  errorCode: string,
  error: string,
): GatewaySendResult {
  return {
    success: false,
    delegated: true,
    error,
    error_code: errorCode,
    duration_ms: Date.now() - startMs,
  };
}

function buildPayload(
  req: GatewaySendRequest,
  steps: StepLog,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source: req.source,
    message_type: req.message_type,
    lead_id: req.lead_id ?? null,
    track_id: req.track_id ?? null,
    humanize: req.humanize ?? false,
    smart_split: req.smart_split ?? false,
    workflow_execution_id: req.workflow_execution_id ?? null,
    steps,
    ...extra,
  };
}

async function logSend(
  req: GatewaySendRequest,
  result: GatewaySendResult,
  steps: StepLog,
  extra: Record<string, unknown>,
): Promise<void> {
  await logRuntime({
    organizationId: req.organization_id,
    module: "outbound",
    action: "send",
    status: result.success ? "success" : "error",
    entityType: "whatsapp_messages",
    entityId: result.message_id,
    errorMessage: result.error,
    triggeredBy: req.triggered_by,
    durationMs: result.duration_ms,
    payloadSnapshot: buildPayload(req, steps, {
      provider_message_id: result.provider_message_id ?? null,
      parts_sent: result.parts_sent ?? null,
      ...extra,
    }),
  });
}
