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
import { upsertPipeEntry } from "../_shared/pipeline-adapter.ts";

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
const UAZAPI_BASE_URL = Deno.env.get("UAZAPI_BASE_URL") ?? "";

const MEDIA_PERSIST_TIMEOUT_MS = 25_000;
const MIME_TO_EXT: Record<string, string> = {
  "audio/ogg": "ogg", "audio/ogg; codecs=opus": "ogg",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac",
  "audio/webm": "webm", "audio/wav": "wav",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/webm": "webm",
  "application/pdf": "pdf", "application/octet-stream": "bin",
};

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

function isWhatsAppCdnUrl(url: string): boolean {
  return url.includes(".whatsapp.net/") || url.includes(".whatsapp.com/");
}

async function persistMediaToStorage(
  sb: ReturnType<typeof createClient>,
  instance: ResolvedInstance,
  messageId: string,
  messageType: string,
) {
  if (!UAZAPI_BASE_URL) return;

  const { data: secrets } = await sb
    .from("whatsapp_instance_secrets")
    .select("uazapi_token")
    .eq("instance_id", instance.id)
    .maybeSingle();
  if (!secrets?.uazapi_token) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIA_PERSIST_TIMEOUT_MS);
  try {
    const res = await fetch(`${UAZAPI_BASE_URL}/message/download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: secrets.uazapi_token,
      },
      body: JSON.stringify({ id: messageId }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return;

    const result = await res.json();
    const rawB64: string = result.base64 ?? "";
    const mimetype: string = result.mimetype ?? "application/octet-stream";
    if (!rawB64) return;

    const pure = rawB64.includes(",") ? rawB64.split(",")[1] : rawB64;
    const bin = Uint8Array.from(atob(pure), (c) => c.charCodeAt(0));

    const ext = MIME_TO_EXT[mimetype] ?? mimetype.split("/")[1] ?? "bin";
    const path = `whatsapp-media/${instance.organization_id}/${messageId}.${ext}`;

    const { error: upErr } = await sb.storage
      .from("media")
      .upload(path, bin, { contentType: mimetype, upsert: true });
    if (upErr) {
      console.error(`[webhook] storage upload failed: ${upErr.message}`);
      return;
    }

    const { data: urlData } = sb.storage.from("media").getPublicUrl(path);
    if (urlData?.publicUrl) {
      await sb
        .from("whatsapp_messages")
        .update({ media_url: urlData.publicUrl })
        .eq("message_id", messageId)
        .eq("instance_id", instance.id);
    }
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") {
      console.warn(`[webhook] media persist timeout for ${messageId}`);
    } else {
      console.error(`[webhook] media persist error for ${messageId}:`, err);
    }
  }
}

function normalizeMessage(data: any, instance: ResolvedInstance) {
  const fromMe = data.fromMe === true || data.fromme === true;
  const direction = fromMe ? "outgoing" : "incoming";
  const remoteJid = data.chatid ?? data.remoteJid ?? data.from ?? data.to ?? "";
  const phoneNumber = String(remoteJid).split("@")[0] ?? null;
  const messageId = data.id ?? data.messageid ?? data.key?.id ?? null;

  const rawType: string =
    data.type ??
    data.messageType ??
    (data.text ? "text" : data.media ? "media" : "unknown");

  const MESSAGE_TYPE_MAP: Record<string, string> = {
    stickerMessage: "sticker",
    StickerMessage: "sticker",
    imageMessage: "image",
    ImageMessage: "image",
    videoMessage: "video",
    VideoMessage: "video",
    audioMessage: "audio",
    AudioMessage: "audio",
    documentMessage: "document",
    DocumentMessage: "document",
    pttMessage: "ptt",
    PttMessage: "ptt",
    conversation: "text",
    extendedTextMessage: "text",
    ExtendedTextMessage: "text",
    buttonsResponseMessage: "buttonResponse",
    listResponseMessage: "listResponse",
  };
  const messageType = MESSAGE_TYPE_MAP[rawType] ?? rawType;

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

  const mediaUrl =
    data.mediaUrl ??
    data.media?.url ??
    data.message?.stickerMessage?.url ??
    data.message?.imageMessage?.url ??
    data.message?.videoMessage?.url ??
    data.message?.audioMessage?.url ??
    data.message?.documentMessage?.url ??
    null;

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

  // Skip group messages — phone_number derived from group JID (120363...@g.us)
  // pollutes the leads table with ghost contacts named after the first speaker.
  // Parity with history-sync-worker which already filters @g.us.
  if (String(normalized.remote_jid).endsWith("@g.us")) {
    await logRuntime({
      organizationId: instance.organization_id,
      module: "webhook",
      action: "uazapi_group_message_skipped",
      status: "ok",
      payloadSnapshot: {
        instance_id: instance.id,
        remote_jid: normalized.remote_jid,
        message_id: normalized.message_id,
      },
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
    return;
  }

  // Fire-and-forget: download encrypted WhatsApp CDN media and persist to Storage
  if (normalized.media_url && isWhatsAppCdnUrl(normalized.media_url) && normalized.message_id) {
    persistMediaToStorage(supabase, instance, normalized.message_id, normalized.message_type)
      .catch((err) => console.error(`[webhook] media persist fire-forget:`, err));
  }

  // Resolve any waiting workflow executions for this phone — must run BEFORE
  // agent-message dispatch so the workflow advances to its "replied" branch
  // before further automation kicks in. Fire-and-forget; failures are logged
  // but never break the webhook (idempotent — RPC is safe to call when nothing waits).
  if (normalized.direction === "incoming" && normalized.phone_number) {
    supabase
      .rpc("resolve_wait_response_by_phone", {
        p_phone: normalized.phone_number,
        p_organization_id: instance.organization_id,
        p_channel: "whatsapp",
      })
      .then(({ error }) => {
        if (error) {
          void logRuntime({
            organizationId: instance.organization_id,
            module: "workflow",
            action: "resolve_wait_response_failed",
            status: "error",
            payloadSnapshot: {
              instance_id: instance.id,
              error: error.message,
            },
          });
        }
      });
  }

  // Bridge to Copilot — previously missing: whatsapp-webhook only persisted
  // messages and never invoked agent-message, leaving Uazapi-backed orgs with
  // a silent Copilot. Parity with sz-chat-webhook and evolution-webhook.
  //
  // Rules:
  //   - only incoming messages (outgoing echoes are already filtered by
  //     excludeMessages in Uazapi, but guard defensively)
  //   - must have text content (media without caption is skipped for now)
  //   - fire-and-forget: we do not await to keep webhook latency low.
  //     agent-message itself handles ai_disabled / WAITING_HUMAN / batching.
  if (
    normalized.direction === "incoming" &&
    normalized.content &&
    normalized.content.trim().length > 0 &&
    normalized.phone_number
  ) {
    const agentMessagePayload = {
      from: normalized.phone_number,
      message: normalized.content,
      channel: "whatsapp",
      organization_id: instance.organization_id,
      push_name: normalized.push_name,
      incoming_message_type: normalized.message_type,
    };

    // Fire-and-forget. Errors are logged but do NOT fail the webhook.
    fetch(`${SUPABASE_URL}/functions/v1/agent-message`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(agentMessagePayload),
    })
      .then((res) => {
        if (!res.ok) {
          console.error(
            `[whatsapp-webhook] agent-message returned ${res.status} for message ${normalized.message_id}`,
          );
          void logRuntime({
            organizationId: instance.organization_id,
            module: "webhook",
            action: "uazapi_agent_message_failed",
            status: "error",
            payloadSnapshot: {
              instance_id: instance.id,
              message_id: normalized.message_id,
              http_status: res.status,
            },
          });
        }
      })
      .catch((err) => {
        console.error(
          `[whatsapp-webhook] agent-message fetch threw for message ${normalized.message_id}:`,
          err,
        );
        void logRuntime({
          organizationId: instance.organization_id,
          module: "webhook",
          action: "uazapi_agent_message_error",
          status: "error",
          payloadSnapshot: {
            instance_id: instance.id,
            message_id: normalized.message_id,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      });

    void logRuntime({
      organizationId: instance.organization_id,
      module: "webhook",
      action: "uazapi_agent_message_dispatched",
      status: "success",
      payloadSnapshot: {
        instance_id: instance.id,
        message_id: normalized.message_id,
        channel: "whatsapp",
      },
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
      await upsertPipeEntry(supabase, {
        leadId: targetLeadId,
        orgId: instance.organization_id,
        slug: "propostas",
        stageKey: "pago",
        metadata: { paid_at: new Date().toISOString() },
      });

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

  const { data: prevInstance } = await supabase
    .from("whatsapp_instances")
    .select("status")
    .eq("id", instance.id)
    .maybeSingle();
  const previousStatus = prevInstance?.status;

  await supabase
    .from("whatsapp_instances")
    .update({ status: mapped, updated_at: new Date().toISOString() })
    .eq("id", instance.id);

  // Auto-sync: trigger default history sync on first connect
  if (mapped === "connected" && previousStatus !== "connected") {
    await maybeAutoSync(supabase, instance);
  }
}

async function maybeAutoSync(
  supabase: ReturnType<typeof createClient>,
  instance: ResolvedInstance,
) {
  try {
    const cutoff = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const { data: recentJobs } = await supabase
      .from("history_sync_jobs")
      .select("id")
      .eq("instance_id", instance.id)
      .in("status", ["queued", "running", "completed"])
      .gte("created_at", cutoff)
      .limit(1);

    if (recentJobs && recentJobs.length > 0) return;

    await supabase.from("history_sync_jobs").insert({
      organization_id: instance.organization_id,
      instance_id: instance.id,
      scope: "default",
      max_days: 30,
      max_messages_per_chat: 500,
      max_chats: 100,
      status: "queued",
      triggered_by: "auto_connect",
    });
  } catch {
    // Never block webhook processing on auto-sync failure
  }
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
