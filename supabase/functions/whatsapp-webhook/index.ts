// deno-lint-ignore-file no-explicit-any
/**
 * whatsapp-webhook — Uazapi provider webhook ingress.
 *
 * URL format (configured in Uazapi via updateWebhook):
 *   https://<supabase-ref>.supabase.co/functions/v1/whatsapp-webhook/<SECRET>
 *
 * With addUrlEvents: true:
 *   .../whatsapp-webhook/<SECRET>/<event>
 *
 * Auth: secret path segment validated with constant-time compare.
 * Tenant resolution: lookup via whatsapp_instance_secrets.uazapi_instance_id.
 * Idempotency: UPSERT on (message_id, instance_id) — preserves contract from
 * commit 3066b5e. Echo elimination is server-side via excludeMessages filter
 * configured at instance creation (T2.2).
 *
 * Events supported Fase 2: messages, messages_update, connection.
 * Other events: 200 OK + unhandled_event log.
 *
 * verify_jwt = false (configured in config.toml).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";

// ============================================================================
// Config
// ============================================================================

const BODY_SIZE_LIMIT = 2 * 1024 * 1024; // 2MB
const PROCESSING_TIMEOUT_MS = 12_000;
const RATE_LIMIT_MAX = 1000; // per IP per minute
const RATE_LIMIT_WINDOW_MS = 60_000;
const REPLAY_WINDOW_MS = 5 * 60_000; // 5 minutes

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UAZAPI_WEBHOOK_SECRET = Deno.env.get("UAZAPI_WEBHOOK_SECRET") ?? "";

// ============================================================================
// In-memory rate limit (follow-up: KV/Redis before prod volume)
// ============================================================================

const rateLimitState = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const rec = rateLimitState.get(ip);
  if (!rec || rec.resetAt <= now) {
    rateLimitState.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (rec.count >= RATE_LIMIT_MAX) return { allowed: false, remaining: 0 };
  rec.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - rec.count };
}

// ============================================================================
// Constant-time secret comparison
// ============================================================================

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ============================================================================
// Event handlers
// ============================================================================

type ResolvedInstance = {
  id: string;
  organization_id: string;
  instance_name: string;
};

async function resolveInstance(
  supabase: ReturnType<typeof createClient>,
  uazapiInstanceId: string
): Promise<ResolvedInstance | null> {
  const { data, error } = await supabase
    .from("whatsapp_instance_secrets")
    .select("instance_id, organization_id")
    .eq("uazapi_instance_id", uazapiInstanceId)
    .maybeSingle();

  if (error || !data) return null;

  const { data: inst } = await supabase
    .from("whatsapp_instances")
    .select("id, organization_id, instance_name")
    .eq("id", data.instance_id)
    .maybeSingle();

  if (!inst) return null;
  return inst as ResolvedInstance;
}

function normalizeMessage(data: any, instance: ResolvedInstance) {
  const fromMe = data.fromMe === true || data.fromme === true;
  const direction = fromMe ? "outgoing" : "incoming";
  const remoteJid = data.chatid ?? data.remoteJid ?? data.from ?? data.to ?? "";
  const phoneNumber = String(remoteJid).split("@")[0] ?? null;
  const messageId = data.id ?? data.messageid ?? data.key?.id ?? null;

  const messageType =
    data.type ??
    data.messageType ??
    (data.text ? "text" : data.media ? "media" : "unknown");

  // Interactive menu responses — extract selected choice to the content
  // column so downstream (agent-message) sees the choice as if it were
  // a plain text reply from the lead.
  const isButtonResponse =
    messageType === "buttonResponse" ||
    messageType === "buttonResponseMessage";
  const isListResponse =
    messageType === "listResponse" || messageType === "listResponseMessage";

  let content = data.text ?? data.caption ?? data.body ?? null;
  if ((isButtonResponse || isListResponse) && !content) {
    content =
      data.selected ??
      data.selectedDisplayText ??
      data.selectedButtonId ??
      data.selectedRowId ??
      data.buttonResponse?.selectedDisplayText ??
      data.listResponse?.title ??
      null;
  }

  const mediaUrl = data.mediaUrl ?? data.media?.url ?? null;

  const tsSeconds =
    data.timestamp ??
    data.messageTimestamp ??
    Math.floor(Date.now() / 1000);

  return {
    organization_id: instance.organization_id,
    instance_id: instance.id,
    message_id: messageId,
    remote_jid: remoteJid,
    phone_number: phoneNumber,
    direction,
    message_type: messageType,
    content,
    media_url: mediaUrl,
    push_name: data.pushName ?? data.senderName ?? null,
    status: direction === "incoming" ? "received" : "sent",
    timestamp: new Date(Number(tsSeconds) * 1000).toISOString(),
    raw_payload: data as Record<string, unknown>,
  };
}

async function handleMessagesEvent(
  supabase: ReturnType<typeof createClient>,
  instance: ResolvedInstance,
  data: any
) {
  const normalized = normalizeMessage(data, instance);
  if (!normalized.message_id) {
    await logRuntime({
      organizationId: instance.organization_id,
      module: "webhook",
      action: "uazapi_missing_message_id",
      status: "error",
      payloadSnapshot: { instance_id: instance.id, type: normalized.message_type },
    });
    return;
  }

  const { error } = await supabase
    .from("whatsapp_messages")
    .upsert(normalized, {
      onConflict: "message_id,instance_id",
      ignoreDuplicates: true,
    });

  if (error) {
    await logRuntime({
      organizationId: instance.organization_id,
      module: "webhook",
      action: "uazapi_messages_upsert_error",
      status: "error",
      payloadSnapshot: { instance_id: instance.id, error: error.message },
    });
  }
}

async function handlePaymentResponseEvent(
  supabase: ReturnType<typeof createClient>,
  instance: ResolvedInstance,
  data: any
) {
  // Uazapi payload: { pixkey, amount, status: 'paid'|'pending'|'failed',
  //                   track_id, chatid, messageid }
  const status = String(data.status ?? "").toLowerCase();
  if (status !== "paid" && status !== "completed" && status !== "failed") {
    return;
  }

  const leadId = data.track_id ?? null;
  const remoteJid = data.chatid ?? data.remoteJid ?? null;

  // Reflect payment status into the related message row
  const messageId = data.messageid ?? data.id;
  if (messageId) {
    await supabase
      .from("whatsapp_messages")
      .update({ status: status === "failed" ? "failed" : "paid" })
      .eq("message_id", messageId)
      .eq("instance_id", instance.id);
  }

  // Move the proposal lead stage to "pago" on successful payment
  if (status === "paid" || status === "completed") {
    const targetLeadId = leadId
      ? leadId
      : remoteJid
      ? await (async () => {
          const { data: msg } = await supabase
            .from("whatsapp_messages")
            .select("lead_id")
            .eq("instance_id", instance.id)
            .eq("remote_jid", remoteJid)
            .not("lead_id", "is", null)
            .order("timestamp", { ascending: false })
            .limit(1)
            .maybeSingle();
          return (msg as any)?.lead_id ?? null;
        })()
      : null;

    if (targetLeadId) {
      await supabase
        .from("pipe_propostas")
        .update({ status: "pago", paid_at: new Date().toISOString() })
        .eq("lead_id", targetLeadId);

      await supabase.from("lead_history").insert({
        organization_id: instance.organization_id,
        lead_id: targetLeadId,
        action: "payment_confirmed",
        description: `PIX confirmado via Uazapi (R$ ${data.amount ?? "?"})`,
        source: "webhook",
        metadata: data as Record<string, unknown>,
      });
    }
  }

  await logRuntime({
    organizationId: instance.organization_id,
    module: "webhook",
    action: "uazapi_payment_response",
    status: status === "paid" || status === "completed" ? "success" : "error",
    payloadSnapshot: {
      instance_id: instance.id,
      lead_id: leadId,
      pix_status: status,
    },
  });
}

async function handleMessagesUpdateEvent(
  supabase: ReturnType<typeof createClient>,
  instance: ResolvedInstance,
  data: any
) {
  const messageId = data.id ?? data.messageid ?? data.key?.id;
  if (!messageId) return;

  const update: Record<string, unknown> = {};
  if (data.status) update.status = String(data.status).toLowerCase();
  if (data.edited) update.edited = true;
  if (data.deleted) {
    update.status = "deleted";
    update.deleted_at = new Date().toISOString();
  }

  // Pin/unpin (Uazapi action)
  if (data.pinned === true) update.pinned_at = new Date().toISOString();
  if (data.pinned === false) update.pinned_at = null;

  // Reactions — Uazapi sends { reactions: [{ emoji, from, count }] } or
  // { reaction: { emoji, from } } depending on event. Merge by emoji+from.
  if (data.reactions && Array.isArray(data.reactions)) {
    update.reactions = data.reactions;
  } else if (data.reaction && typeof data.reaction === "object") {
    // Fetch existing + merge
    const { data: current } = await supabase
      .from("whatsapp_messages")
      .select("reactions")
      .eq("message_id", messageId)
      .eq("instance_id", instance.id)
      .maybeSingle();
    const existing: any[] = Array.isArray(current?.reactions)
      ? (current!.reactions as any[])
      : [];
    const key = `${data.reaction.emoji}|${data.reaction.from ?? "them"}`;
    const idx = existing.findIndex(
      (r) => `${r.emoji}|${r.from ?? "them"}` === key
    );
    if (data.reaction.remove) {
      if (idx >= 0) existing.splice(idx, 1);
    } else if (idx >= 0) {
      existing[idx].count = (existing[idx].count ?? 1) + 1;
    } else {
      existing.push({
        emoji: data.reaction.emoji,
        from: data.reaction.from ?? "them",
        count: 1,
      });
    }
    update.reactions = existing;
  }

  if (Object.keys(update).length === 0) return;

  await supabase
    .from("whatsapp_messages")
    .update(update)
    .eq("message_id", messageId)
    .eq("instance_id", instance.id);
}

async function handleConnectionEvent(
  supabase: ReturnType<typeof createClient>,
  instance: ResolvedInstance,
  data: any
) {
  const state = String(data.status ?? data.state ?? "").toLowerCase();
  const statusMap: Record<string, string> = {
    connected: "connected",
    connecting: "connecting",
    disconnected: "disconnected",
    close: "disconnected",
    closed: "disconnected",
    open: "connected",
  };
  const mapped = statusMap[state] ?? "unknown";

  await supabase
    .from("whatsapp_instances")
    .update({ status: mapped, updated_at: new Date().toISOString() })
    .eq("id", instance.id);
}

// ============================================================================
// HTTP handler
// ============================================================================

function genericResponse(status: number, body?: unknown): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("processing_timeout")), ms)
    ),
  ]);
}

Deno.serve(
  withSentry("whatsapp-webhook", async (req: Request) => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname.endsWith("/health")) {
      return genericResponse(200, { ok: true });
    }

    if (req.method !== "POST") return genericResponse(405);

    const sourceIp =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("cf-connecting-ip") ??
      "unknown";

    const rl = checkRateLimit(sourceIp);
    if (!rl.allowed) {
      await logRuntime({
        module: "webhook",
        action: "uazapi_rate_limit",
        status: "error",
        payloadSnapshot: { source_ip: sourceIp },
      });
      return genericResponse(429, { error: "rate_limited" });
    }

    const pathSegments = url.pathname.split("/").filter(Boolean);
    const idx = pathSegments.findIndex((s) => s === "whatsapp-webhook");
    const pathSecret = idx >= 0 ? pathSegments[idx + 1] : undefined;
    const pathEvent = idx >= 0 ? pathSegments[idx + 2] : undefined;

    if (
      !pathSecret ||
      !UAZAPI_WEBHOOK_SECRET ||
      !timingSafeEqual(pathSecret, UAZAPI_WEBHOOK_SECRET)
    ) {
      await logRuntime({
        module: "webhook",
        action: "uazapi_auth_fail",
        status: "error",
        payloadSnapshot: {
          source_ip: sourceIp,
          path_secret_prefix: pathSecret ? pathSecret.slice(0, 8) : null,
        },
      });
      return genericResponse(404);
    }

    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (contentLength > BODY_SIZE_LIMIT) {
      return genericResponse(413, { error: "body_too_large" });
    }

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return genericResponse(400, { error: "invalid_json" });
    }

    if (!payload || typeof payload !== "object") {
      return genericResponse(400, { error: "invalid_payload" });
    }

    if (typeof payload.timestamp === "number") {
      const ageMs = Math.abs(Date.now() - payload.timestamp * 1000);
      if (ageMs > REPLAY_WINDOW_MS) {
        await logRuntime({
          module: "webhook",
          action: "uazapi_replay_rejected",
          status: "error",
          payloadSnapshot: {
            source_ip: sourceIp,
            age_ms: ageMs,
            event: payload.event,
          },
        });
        return genericResponse(400, { error: "stale_payload" });
      }
    }

    const event = payload.event ?? pathEvent ?? "unknown";
    const uazapiInstanceId = payload.instance ?? payload.instance_id ?? null;

    if (!uazapiInstanceId) {
      await logRuntime({
        module: "webhook",
        action: "uazapi_missing_instance",
        status: "error",
        payloadSnapshot: { source_ip: sourceIp, event },
      });
      return genericResponse(200);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const instance = await resolveInstance(supabase, uazapiInstanceId);
    if (!instance) {
      await logRuntime({
        module: "webhook",
        action: "uazapi_unknown_instance",
        status: "error",
        payloadSnapshot: {
          source_ip: sourceIp,
          event,
          uazapi_instance_id: uazapiInstanceId,
        },
      });
      return genericResponse(200);
    }

    try {
      await withTimeout(
        (async () => {
          switch (event) {
            case "messages":
              await handleMessagesEvent(supabase, instance, payload.data ?? payload);
              break;
            case "messages_update":
              await handleMessagesUpdateEvent(
                supabase,
                instance,
                payload.data ?? payload
              );
              break;
            case "connection":
              await handleConnectionEvent(
                supabase,
                instance,
                payload.data ?? payload
              );
              break;
            case "payment":
            case "payment_response":
              await handlePaymentResponseEvent(
                supabase,
                instance,
                payload.data ?? payload
              );
              break;
            default:
              await logRuntime({
                organizationId: instance.organization_id,
                module: "webhook",
                action: "uazapi_unhandled_event",
                status: "success",
                payloadSnapshot: {
                  event,
                  instance_id: instance.id,
                },
              });
          }
        })(),
        PROCESSING_TIMEOUT_MS
      );

      await logRuntime({
        organizationId: instance.organization_id,
        module: "webhook",
        action: "uazapi_process",
        status: "success",
        payloadSnapshot: { event, instance_id: instance.id },
      });

      return genericResponse(200, { ok: true });
    } catch (e) {
      await logRuntime({
        organizationId: instance.organization_id,
        module: "webhook",
        action: "uazapi_process_error",
        status: "error",
        payloadSnapshot: {
          event,
          instance_id: instance.id,
          error: (e as Error).message,
        },
      });
      return genericResponse(500, { error: "internal" });
    }
  })
);

export {
  checkRateLimit,
  timingSafeEqual,
  normalizeMessage,
  rateLimitState,
  RATE_LIMIT_MAX,
  REPLAY_WINDOW_MS,
};
