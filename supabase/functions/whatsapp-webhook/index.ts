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
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { upsertPipeEntry } from "../_shared/pipeline-adapter.ts";
import { authorFromWebhookEcho } from "../_shared/message-authorship.ts";
import { isCopilotCanceled, logCopilotCancellation } from "../_shared/copilot/cancellation.ts";
import {
  downloadAndPersistMedia,
  enqueueMediaJob,
  isWhatsAppCdnUrl as isWhatsAppCdnUrlShared,
  stampMediaJob,
} from "../_shared/whatsapp-media.ts";
import { shouldPersistMedia } from "./group-media-gate.ts";
import { timingSafeCompare, checkRateLimitPersistent } from "../_shared/auth.ts";
import { extractOwnerNumber } from "../_shared/whatsapp-owner.ts";
import {
  DLQ_REPLAY_MAX_ATTEMPTS,
  makePoisonChecker,
  POISON_DROP_LOG_SAMPLE,
} from "./poison-denylist.ts";
import { extractQuotedText } from "./quoted-text.ts";
import { extractInteractiveSelection } from "./interactive-reply.ts";
import {
  buildMessageIdCandidates,
  extractRawMessageIds,
  mapReceiptStatus,
} from "./message-id.ts";

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

// ============================================================================
// In-memory rate limit (follow-up: KV/Redis before prod volume)
// ============================================================================

const rateLimitState = new Map<string, { count: number; resetAt: number }>();

// ============================================================================
// Poison-token early-drop (ERR-4) — ghost instances still webhook-bound on the
// Uazapi side. Verdict derived from the DLQ itself (see poison-denylist.ts);
// same per-isolate lifetime as rateLimitState above.
// ============================================================================

const isPoisonToken = makePoisonChecker({
  countExhausted: async (token) => {
    try {
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { count, error } = await supabase
        .from("whatsapp_webhook_dlq")
        .select("id", { count: "exact", head: true })
        .eq("reason", "unknown_instance")
        .is("resolved_at", null)
        .gte("attempts", DLQ_REPLAY_MAX_ATTEMPTS)
        .eq("payload->>token", token);
      if (error) return null;
      return count ?? 0;
    } catch {
      return null;
    }
  },
});
let poisonDropsSinceBoot = 0;

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
// Constant-time secret comparison — uses shared timingSafeCompare from auth.ts
// (handles length-mismatch without leaking timing info)
// ============================================================================

// ============================================================================
// Interfaces — pipeline types
// ============================================================================

export interface NormalizedMessage {
  organization_id: string;
  instance_id: string;
  message_id: string | null;
  remote_jid: string;
  phone_number: string | null;
  direction: string;
  message_type: string;
  content: string | null;
  media_url: string | null;
  push_name: string | null;
  status: string;
  timestamp: string;
  raw_payload: Record<string, unknown>;
  is_group: boolean;
  received_via?: string;
}

export interface PersistedMessage {
  organization_id: string;
  instance_id: string;
  message_id: string;
  phone_number: string;
  content: string | null;
  direction: string;
  message_type: string;
  push_name: string | null;
  media_url: string | null;
}

const COPILOT_MEDIA_TYPES = new Set(["audio", "ptt", "image", "video", "document"]);

export function computeShouldTriggerCopilot(normalized: {
  direction: string;
  content: string | null;
  phone_number: string | null;
  message_type: string;
  media_url: string | null;
}): boolean {
  if (normalized.direction !== "incoming") return false;
  if (!normalized.phone_number) return false;

  const hasTextContent = !!normalized.content && normalized.content.trim().length > 0;
  if (hasTextContent) return true;

  return COPILOT_MEDIA_TYPES.has(normalized.message_type) && !!normalized.media_url;
}


export interface ReactionContext {
  shouldTriggerCopilot: boolean;
  shouldResolveWaitResponse: boolean;
  isGroup: boolean;
  replaySource: string | null;
  conversationId?: string | null;
}

// ============================================================================
// Event handlers
// ============================================================================

type ResolvedInstance = {
  id: string;
  organization_id: string;
  instance_name: string;
  /**
   * Número dono da linha. É o prefixo do `message_id` composto que gravamos
   * (`<phone_number>:<ID>`) — bate em 100% das linhas do prod (32.637/32.637 em
   * 24h), enquanto `raw_payload->>'owner'` falta em algumas. Ver
   * `buildMessageIdCandidates`.
   */
  phone_number: string | null;
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
    .select("id, organization_id, instance_name, phone_number")
    .eq("id", data.instance_id)
    .maybeSingle();

  if (!inst) return null;
  return inst as ResolvedInstance;
}

// Uazapi V2 sometimes omits instance_id at the top level but still sends the
// per-instance token. Resolve by uazapi_token as a defensive fallback.
async function resolveInstanceByToken(
  supabase: ReturnType<typeof createClient>,
  uazapiToken: string
): Promise<ResolvedInstance | null> {
  const { data, error } = await supabase
    .from("whatsapp_instance_secrets")
    .select("instance_id")
    .eq("uazapi_token", uazapiToken)
    .maybeSingle();

  if (error || !data) return null;

  const { data: inst } = await supabase
    .from("whatsapp_instances")
    .select("id, organization_id, instance_name, phone_number")
    .eq("id", data.instance_id)
    .maybeSingle();

  if (!inst) return null;
  return inst as ResolvedInstance;
}

// Defensive instance-id picker: tolerates Uazapi V2 schema variations.
// - Treats empty / whitespace strings as missing (?? would let "" through).
// - Tries multiple camel/Pascal/snake aliases observed in V2 payloads.
// Returns the first non-empty candidate or null.
function pickInstanceId(
  payload: Record<string, unknown> | null | undefined,
  pathInstanceId?: string,
): string | null {
  const p: Record<string, unknown> = payload ?? {};
  const candidates: unknown[] = [
    p.instance,
    p.instance_id,
    p.instanceId,
    p.InstanceId,
    p.InstanceID,
    p.instanceID,
    pathInstanceId,
    p.instanceName,
    p.InstanceName,
  ];
  for (const c of candidates) {
    if (typeof c === "string") {
      const trimmed = c.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

// Pick a per-instance Uazapi token from payload variants when present.
function pickUazapiToken(payload: Record<string, unknown> | null | undefined): string | null {
  const p: Record<string, unknown> = payload ?? {};
  const candidates: unknown[] = [p.token, p.Token, p.instance_token, p.instanceToken];
  for (const c of candidates) {
    if (typeof c === "string") {
      const trimmed = c.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

/**
 * Guarda na DLQ um evento que não deu para processar. Devolve `true` se a linha
 * foi mesmo gravada.
 *
 * O RETORNO É O PONTO. Antes esta função devolvia `void` e engolia a falha de
 * insert, e quem chamava respondia 200 de qualquer jeito — sob a premissa de que
 * responder não-2xx faria o Uazapi reentregar e amplificar a carga durante um
 * incidente. A premissa está certa; a conclusão, invertida.
 *
 * No incidente de 2026-08-06 o banco saturou: `resolveInstance` não conseguia
 * conexão, o insert na DLQ falhava pelo mesmo motivo, e o webhook respondia 200.
 * O Uazapi tomava aquilo como entrega concluída e nunca reenviava. Resultado: 42
 * minutos de mensagem de cliente perdida em definitivo — e uma DLQ com 2 linhas,
 * porque nem a rede de segurança conseguia escrever.
 *
 * A regra que fica: 200 significa "está guardado". Se a DLQ gravou, o evento
 * está salvo e o cron de replay o recupera — 200 é honesto. Se a DLQ não gravou,
 * nada foi persistido em lugar nenhum, e a única resposta verdadeira é 5xx, para
 * que o provedor reentregue.
 *
 * Sobre a amplificação: ela continua sendo um risco real, mas agora só ocorre no
 * caso raro em que a própria DLQ está fora — e reentrega com backoff custa menos
 * que a conversa perdida de um cliente.
 */
async function enqueueDlq(
  supabase: ReturnType<typeof createClient>,
  input: {
    source_ip: string | null;
    url_path: string;
    event: string;
    reason: string;
    payload: unknown;
    resolved_instance_id?: string;
  },
): Promise<boolean> {
  try {
    const row: Record<string, unknown> = {
      source_ip: input.source_ip,
      url_path: input.url_path,
      event: input.event,
      reason: input.reason,
      payload: input.payload as Record<string, unknown>,
    };
    if (input.resolved_instance_id) row.resolved_instance_id = input.resolved_instance_id;
    const { error } = await supabase.from("whatsapp_webhook_dlq").insert(row);
    if (error) {
      console.error("[whatsapp-webhook] dlq insert failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[whatsapp-webhook] dlq insert threw:", err);
    return false;
  }
}

/**
 * Resposta para evento que não pôde ser processado, coerente com o que de fato
 * foi persistido: 200 se a DLQ o guardou, 503 se não guardou nada.
 */
function dlqOutcomeResponse(persisted: boolean, reason: string): Response {
  if (persisted) return genericResponse(200);
  return genericResponse(503, { error: "dlq_unavailable", reason });
}

// Best-effort media persist with DLQ semantics. Always enqueues a
// whatsapp_media_jobs row first (idempotent UPSERT) so a missed inline
// attempt is recoverable by the whatsapp-media-retry cron.
async function persistMediaToStorage(
  sb: ReturnType<typeof createClient>,
  instance: ResolvedInstance,
  messageId: string,
  messageType: string,
  sourceUrl: string,
) {
  if (!UAZAPI_BASE_URL) return;

  await enqueueMediaJob(sb, {
    instanceId: instance.id,
    organizationId: instance.organization_id,
    messageId,
    sourceUrl,
    messageType,
  });

  const result = await downloadAndPersistMedia(
    sb,
    UAZAPI_BASE_URL,
    {
      instanceId: instance.id,
      organizationId: instance.organization_id,
      messageId,
      sourceUrl,
      messageType,
    },
    { timeoutMs: MEDIA_PERSIST_TIMEOUT_MS },
  );

  await stampMediaJob(
    sb,
    null,
    { messageId, instanceId: instance.id },
    result,
  );

  if (!result.ok) {
    console.warn(`[webhook] media persist failed for ${messageId}: ${result.error}`);
  }
}


function normalizeMessage(data: any, instance: ResolvedInstance) {
  const fromMe = data.fromMe === true || data.fromme === true;
  const direction = fromMe ? "outgoing" : "incoming";

  // Phone resolution: _phone_jid (injected from webhook envelope) is most reliable.
  // Uazapi V2 may send chatid as LID (@lid suffix) instead of phone JID (@s.whatsapp.net).
  const rawJid = data._phone_jid ?? data.chatid ?? data.remoteJid ?? data.from ?? data.to ?? "";
  const jidStr = String(rawJid);
  const resolvedJid = jidStr.includes("@lid")
    ? String(data._phone_jid ?? data.sender_pn ?? data.from ?? "")
    : jidStr;
  const phoneNumber = resolvedJid.split("@")[0] || null;
  const messageId = data.id ?? data.messageid ?? data.key?.id ?? null;

  let rawType: string =
    data.type ??
    data.messageType ??
    (data.text ? "text" : data.media ? "media" : "unknown");
  // Uazapi sends type:"media" as generic bucket — resolve to actual type
  if (rawType === "media" && (data.mediaType || data.messageType)) {
    rawType = data.mediaType ?? data.messageType;
  }

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
    Conversation: "text",
    extendedTextMessage: "text",
    ExtendedTextMessage: "text",
    buttonsResponseMessage: "buttonResponse",
    ButtonsResponseMessage: "buttonResponse",
    listResponseMessage: "listResponse",
    ListResponseMessage: "listResponse",
    locationMessage: "location",
    LocationMessage: "location",
    liveLocationMessage: "location",
    LiveLocationMessage: "location",
    livelocation: "location",
    contactMessage: "contact",
    ContactMessage: "contact",
    contactsArrayMessage: "contact",
    ContactsArrayMessage: "contact",
    contact_array: "contact",
    vcard: "contact",
    reactionMessage: "reaction",
    ReactionMessage: "reaction",
    pollCreationMessage: "poll",
    PollCreationMessage: "poll",
    NativeFlowMessage: "interactive",
    ButtonsMessage: "interactive",
    ListMessage: "interactive",
    collection: "interactive",
    list: "interactive",
    AlbumMessage: "album",
    TemplateMessage: "template",
    PinInChatMessage: "system",
    ptv: "video",
    PtvMessage: "video",
    gif: "video",
    motion_video: "video",
    motion_photo: "image",
    "1p_sticker": "sticker",
    user_created_sticker: "sticker",
    avatar_sticker: "sticker",
    url: "text",
    error: "text",
  };
  const messageType = MESSAGE_TYPE_MAP[rawType] ?? rawType;

  // Interactive menu responses — extract selected choice to the content column
  // so downstream (agent-message) sees the choice as if it were a plain text
  // reply. Uazapi manda essa resposta como type:"text" + text:"" com a escolha
  // em content.selectedDisplayText / buttonOrListid — ver extractInteractiveSelection.
  let content = data.text ?? data.caption ?? data.body ?? data.content?.text ?? null;
  if (!content || (typeof content === "string" && !content.trim())) {
    const selection = extractInteractiveSelection(data);
    if (selection) content = selection;
  }
  if (messageType === "location" && !content) {
    const lat = data.degreesLatitude ?? data.latitude ?? data.content?.degreesLatitude;
    const lng = data.degreesLongitude ?? data.longitude ?? data.content?.degreesLongitude;
    if (lat != null && lng != null) content = `📍 ${lat}, ${lng}`;
  }
  if (messageType === "contact" && !content) {
    const vcard = data.displayName ?? data.vcard ?? data.content?.displayName ?? data.content?.vcard;
    if (typeof vcard === "string") {
      const fnMatch = vcard.match(/FN:(.+)/);
      content = fnMatch ? `👤 ${fnMatch[1]}` : `👤 Contato compartilhado`;
    } else {
      content = "👤 Contato compartilhado";
    }
  }

  // Reply/quoted context: fold the quoted message into content so the copilot
  // sees what the lead is pointing at. Without this, a reply like "esse é o
  // valor" (quoting a "500k" bubble) reaches the LLM stripped of the value and
  // the agent answers "o valor não carregou".
  const quotedText = extractQuotedText(data);
  if (quotedText) {
    const quotedLabel =
      quotedText.length > 280 ? `${quotedText.slice(0, 280)}…` : quotedText;
    content = content
      ? `[Em resposta a: "${quotedLabel}"]\n${content}`
      : `[Em resposta a: "${quotedLabel}"]`;
  }

  const mediaUrl =
    data.mediaUrl ??
    data.media?.url ??
    (data.fileURL && data.fileURL !== "" ? data.fileURL : null) ??
    data.content?.URL ??
    data.message?.stickerMessage?.url ??
    data.message?.imageMessage?.url ??
    data.message?.videoMessage?.url ??
    data.message?.audioMessage?.url ??
    data.message?.documentMessage?.url ??
    null;

  let tsRaw =
    data.timestamp ??
    data.messageTimestamp ??
    Math.floor(Date.now() / 1000);
  // Uazapi V2 sends messageTimestamp in milliseconds; detect and convert
  const tsSeconds = Number(tsRaw) > 1e12 ? Math.floor(Number(tsRaw) / 1000) : Number(tsRaw);

  const isGroup = jidStr.endsWith("@g.us") || resolvedJid.endsWith("@g.us");

  return {
    organization_id: instance.organization_id,
    instance_id: instance.id,
    message_id: messageId,
    remote_jid: resolvedJid,
    phone_number: phoneNumber,
    direction,
    message_type: messageType,
    content,
    media_url: mediaUrl,
    push_name: data.pushName ?? data.senderName ?? null,
    status: direction === "incoming" ? "received" : "sent",
    timestamp: new Date(tsSeconds * 1000).toISOString(),
    raw_payload: data as Record<string, unknown>,
    is_group: isGroup,
    // Autoria (SCRUM-593): quem enviou pela caixa de entrada volta no eco do
    // `track_id`. Robô e envio espelhado do aparelho continuam sem autor.
    sent_by_team_member_id: authorFromWebhookEcho(
      data as Record<string, unknown>,
      direction as "incoming" | "outgoing",
      instance.id,
    ),
  };
}

// ============================================================================
// triggerReactions — fire-and-forget reactions after message persistence
// ============================================================================

/**
 * Dispatches post-persist reactions: workflow resolution + copilot AI response.
 * All errors are swallowed — webhook always returns 200.
 */
export async function triggerReactions(
  supabase: ReturnType<typeof createClient>,
  persisted: PersistedMessage,
  context: ReactionContext,
): Promise<void> {
  // Groups: persist-only, no downstream reactions
  if (context.isGroup) return;

  // 1. Resolve waiting workflow executions (fire-and-forget)
  if (context.shouldResolveWaitResponse) {
    supabase
      .rpc("resolve_wait_response_by_phone", {
        p_phone: persisted.phone_number,
        p_organization_id: persisted.organization_id,
        p_channel: "whatsapp",
      })
      .then(({ error }) => {
        if (error) {
          void logRuntime({
            organizationId: persisted.organization_id,
            module: "workflow",
            action: "resolve_wait_response_failed",
            status: "error",
            payloadSnapshot: {
              instance_id: persisted.instance_id,
              error: error.message,
            },
          });
        }
      });
  }

  // 2. Copilot dispatch — queue for batching instead of direct call
  if (!context.shouldTriggerCopilot) return;

  // Media → resolve to a FETCHABLE Storage URL before handing it to the copilot.
  // The raw Uazapi/WhatsApp media URL (.enc) expires + needs auth, so the
  // transcription step (resolveMediaContent) can't download it → it falls back
  // to a placeholder and the IA goes mute. Persist on-demand (idempotent) and
  // pass the copilot the Storage public URL instead. Graceful: on failure we
  // keep the raw URL (transcription degrades to placeholder, never throws).
  // Fix 2026-06-22: inbound audio/image understanding was broken platform-wide.
  let copilotMediaUrl: string | null = persisted.media_url ?? null;
  if (copilotMediaUrl && UAZAPI_BASE_URL && COPILOT_MEDIA_TYPES.has(persisted.message_type)) {
    try {
      const persistResult = await downloadAndPersistMedia(
        supabase,
        UAZAPI_BASE_URL,
        {
          instanceId: persisted.instance_id,
          organizationId: persisted.organization_id,
          messageId: persisted.message_id,
          sourceUrl: copilotMediaUrl,
          messageType: persisted.message_type,
        },
        { timeoutMs: 15_000 },
      );
      if (persistResult.ok && persistResult.publicUrl) {
        copilotMediaUrl = persistResult.publicUrl;
      } else {
        console.warn(
          `[whatsapp-webhook] copilot media persist failed (${persistResult.ok ? "no_public_url" : persistResult.error}) — using raw url for ${persisted.message_id}`,
        );
      }
    } catch (e) {
      console.warn(`[whatsapp-webhook] copilot media resolve threw: ${(e as Error).message}`);
    }
  }

  // Fila durável (copilot_message_queue) — rollout canário por org via env
  // COPILOT_QUEUE_ENABLED_ORGS (csv de org_ids, ou "*" p/ todas). Fora da
  // allowlist a entrega segue no caminho fallback abaixo (fetch + waitUntil,
  // já provado). Quando habilitada: enfileira → trigger pg_net dispara o
  // copilot-batch-processor, que gera+entrega+retry de forma durável.
  // Vazia (default) = comportamento idêntico ao atual p/ todas as orgs.
  const queueEnabledOrgs = (Deno.env.get("COPILOT_QUEUE_ENABLED_ORGS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const queueEnabled = queueEnabledOrgs.includes("*")
    || queueEnabledOrgs.includes(persisted.organization_id);

  if (queueEnabled) {
    // FK da fila → whatsapp_messages.id (uuid). persisted.message_id é o id
    // externo do WhatsApp (text); resolve o uuid da linha entrante.
    const { data: waRow } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("message_id", persisted.message_id)
      .eq("instance_id", persisted.instance_id)
      .maybeSingle();

    if (waRow?.id) {
      // batch_key é coluna GERADA (phone || ':' || organization_id) — NÃO inserir.
      const batchKey = `${persisted.phone_number}:${persisted.organization_id}`;
      const { error: queueError } = await supabase
        .from("copilot_message_queue")
        .insert({
          organization_id: persisted.organization_id,
          conversation_id: context.conversationId ?? null,
          message_id: waRow.id,
          phone: persisted.phone_number,
        });

      if (!queueError) {
        void logRuntime({
          organizationId: persisted.organization_id,
          module: "webhook",
          action: "copilot_queued",
          status: "success",
          payloadSnapshot: {
            instance_id: persisted.instance_id,
            message_id: persisted.message_id,
            batch_key: batchKey,
            channel: "whatsapp",
          },
        });
        return; // worker (trigger pg_net) entrega de forma durável
      }
      console.error("[whatsapp-webhook] Queue insert failed, falling back to direct call:", queueError.message);
    } else {
      console.warn("[whatsapp-webhook] Queue: whatsapp_messages.id não resolvido — fallback");
    }
  }

  // FALLBACK: call agent-message directly (existing code)
  const agentMessagePayload = {
    from: persisted.phone_number,
    message: persisted.content,
    channel: "whatsapp",
    organization_id: persisted.organization_id,
    push_name: persisted.push_name,
    incoming_message_type: persisted.message_type,
    media_url: copilotMediaUrl,
    // Quem conhece a Instance é este webhook. O gatilho `lead_replied` filtra
    // por número de origem, mas dispara lá dentro do agent-message — sem este
    // campo a identidade do número se perde no caminho e o filtro "só o número
    // do Closer" vira "qualquer número", em silêncio.
    instance_id: persisted.instance_id,
  };

  // A entrega da resposta da IA (fetch agent-message → enviar chunks) roda DEPOIS
  // do 200 deste webhook. Sem EdgeRuntime.waitUntil o isolate do Supabase Edge
  // pode ser reciclado antes do .then() rodar (agent-message leva 6–26s + sleeps
  // por chunk) → a mensagem fica persistida em conversation_messages mas NUNCA é
  // enviada ao WhatsApp ("IA parou de responder"). waitUntil mantém o isolate
  // vivo até a entrega terminar, sem bloquear o 200. (RC 2026-06-24)
  const aiDeliveryPromise = fetch(`${SUPABASE_URL}/functions/v1/agent-message`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(agentMessagePayload),
  })
    .then(async (res) => {
      if (!res.ok) {
        console.error(
          `[whatsapp-webhook] agent-message returned ${res.status} for message ${persisted.message_id}`,
        );
        void logRuntime({
          organizationId: persisted.organization_id,
          module: "webhook",
          action: "uazapi_agent_message_failed",
          status: "error",
          payloadSnapshot: {
            instance_id: persisted.instance_id,
            message_id: persisted.message_id,
            http_status: res.status,
          },
        });
        return;
      }

      const agentData = await res.json().catch(() => null);
      if (!agentData || agentData.skipped) return;

      const parts: string[] = agentData.messages ?? (agentData.message ? [agentData.message] : []);
      if (parts.length === 0) return;

      try {
        const { sendTextViaInstance } = await import("../_shared/whatsapp-dispatch.ts");
        const { data: fullInstance } = await supabase
          .from("whatsapp_instances")
          .select("*")
          .eq("id", persisted.instance_id)
          .maybeSingle();
        if (!fullInstance) {
          console.error("[whatsapp-webhook] Instance not found for AI response delivery:", persisted.instance_id);
          return;
        }

        let chunksSent = 0;
        let canceledMidDelivery = false;
        // #1156 — id da INBOUND (estável entre retries). NÃO crypto.randomUUID: nonce
        // por-chamada re-gerava a cada retry → idk novo → reply inteira reenviada e o
        // barAt=2 do idk virava código morto. Com o id persistido, o retry do chunk i
        // reusa o mesmo idk → conflito → hit=2 → barAt=2 dispara → retry idempotente.
        const dedupNonce = persisted.message_id;
        for (let i = 0; i < parts.length; i++) {
          const text = parts[i]?.trim();
          if (!text) continue;

          if (i > 0) await new Promise((r) => setTimeout(r, 1200 + Math.random() * 800));

          // RC-cancel: per-part cancellation gate
          const cancelCheck = await isCopilotCanceled(
            supabase,
            persisted.organization_id,
            persisted.phone_number,
          );
          if (cancelCheck.canceled) {
            canceledMidDelivery = true;
            logCopilotCancellation({
              organizationId: persisted.organization_id,
              gate: "outbound_chunks",
              phone: persisted.phone_number,
              chunksSent,
              chunksTotal: parts.length,
              source: cancelCheck.source,
            });
            console.log(
              `[whatsapp-webhook] Copilot canceled mid-delivery; aborting after ${chunksSent} of ${parts.length} part(s)`,
            );
            break;
          }

          const sendResult = await sendTextViaInstance(
            supabase, fullInstance, persisted.phone_number, text,
            {
              trackSource: "copilot",
              // idk só multi-chunk: chunks distintos da MESMA reply não colidem
              // no dedup por conteúdo. Single-chunk sem idk → pega loop. #1156.
              idempotencyKey: parts.length > 1 ? `wh:${dedupNonce}:${i}` : undefined,
            },
          );

          const msgId = sendResult.messageId
            ?? `agent_wh_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

          await supabase.from("whatsapp_messages").upsert({
            organization_id: persisted.organization_id,
            instance_id: persisted.instance_id,
            message_id: msgId,
            remote_jid: `${persisted.phone_number}@s.whatsapp.net`,
            phone_number: persisted.phone_number,
            direction: "outgoing",
            message_type: "text",
            content: text,
            status: sendResult.success ? "sent" : "failed",
            timestamp: new Date().toISOString(),
            sent_by_ai: true,
            sent_source: "copilot",
          }, { onConflict: "message_id,instance_id", ignoreDuplicates: true });

          if (!sendResult.success) {
            console.error("[whatsapp-webhook] AI response send failed:", sendResult.error);
            void logRuntime({
              organizationId: persisted.organization_id,
              module: "webhook",
              action: "copilot_response_send_failed",
              status: "error",
              payloadSnapshot: {
                instance_id: persisted.instance_id,
                phone: persisted.phone_number,
                error: sendResult.error,
                part: i,
              },
            });
          } else {
            chunksSent++;
          }
        }

        if (canceledMidDelivery) {
          console.log(`[whatsapp-webhook] AI response partial: ${chunksSent} of ${parts.length} part(s) delivered before cancellation`);
        } else {
          console.log(`[whatsapp-webhook] AI response delivered: ${parts.length} part(s) to ${persisted.phone_number}`);
        }
      } catch (deliveryErr) {
        console.error("[whatsapp-webhook] AI response delivery error:", deliveryErr);
        void logRuntime({
          organizationId: persisted.organization_id,
          module: "webhook",
          action: "copilot_response_delivery_error",
          status: "error",
          payloadSnapshot: {
            instance_id: persisted.instance_id,
            phone: persisted.phone_number,
            error: deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr),
          },
        });
      }
    })
    .catch((err) => {
      console.error(
        `[whatsapp-webhook] agent-message fetch threw for message ${persisted.message_id}:`,
        err,
      );
      void logRuntime({
        organizationId: persisted.organization_id,
        module: "webhook",
        action: "uazapi_agent_message_error",
        status: "error",
        payloadSnapshot: {
          instance_id: persisted.instance_id,
          message_id: persisted.message_id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    });

  // Mantém o isolate vivo até a entrega terminar (ver comentário no fetch acima).
  if (typeof (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil === "function") {
    (globalThis as { EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime.waitUntil(aiDeliveryPromise);
  }

  void logRuntime({
    organizationId: persisted.organization_id,
    module: "webhook",
    action: "uazapi_agent_message_dispatched",
    status: "success",
    payloadSnapshot: {
      instance_id: persisted.instance_id,
      message_id: persisted.message_id,
      channel: "whatsapp",
    },
  });
}

// ============================================================================
// persistMessage — upsert normalized message into whatsapp_messages
// ============================================================================

export async function persistMessage(
  supabase: ReturnType<typeof createClient>,
  instance: ResolvedInstance,
  normalized: NormalizedMessage,
  replayTag: string | null,
): Promise<PersistedMessage | null> {
  // Group messages: capture-by-default (BL-WA-05) but skip downstream lead /
  // copilot / pipeline side-effects. Org can opt out via
  // organizations.capture_groups = false (restores legacy drop behavior).
  if (normalized.is_group) {
    let captureGroups = true;
    try {
      const { data: org } = await supabase
        .from("organizations")
        .select("capture_groups")
        .eq("id", instance.organization_id)
        .maybeSingle();
      if (org && (org as any).capture_groups === false) captureGroups = false;
    } catch (_) {
      // best-effort — default to capture if the lookup fails
    }

    if (!captureGroups) {
      await logRuntime({
        organizationId: instance.organization_id,
        module: "webhook",
        action: "uazapi_group_message_skipped",
        status: "success",
        payloadSnapshot: {
          instance_id: instance.id,
          remote_jid: normalized.remote_jid,
          message_id: normalized.message_id,
          reason: "capture_groups_off",
        },
      });
      return null;
    }
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
    const parked = await enqueueDlq(supabase, {
      source_ip: null,
      url_path: "",
      event: "messages",
      reason: "upsert_failed",
      payload: normalized as unknown as Record<string, unknown>,
      resolved_instance_id: instance.id,
    });
    // Falhou gravar a mensagem E falhou estacioná-la na DLQ: não sobrou cópia
    // em lugar nenhum. Propagar é o que faz o handler responder 5xx e o provedor
    // reentregar. Devolver null aqui — como era antes — levava a um 200 que
    // afirmava ao Uazapi uma entrega que nunca houve.
    if (!parked) {
      throw new Error("message_lost: upsert e DLQ falharam para a mesma mensagem");
    }
    return null;
  }

  // Best-effort: download encrypted WhatsApp CDN media and persist to Storage.
  // Ver shouldPersistMedia — grupo não desce mídia.
  if (shouldPersistMedia(normalized)) {
    persistMediaToStorage(
      supabase,
      instance,
      normalized.message_id!,
      normalized.message_type,
      normalized.media_url!,
    ).catch((err) => console.error(`[webhook] media persist fire-forget:`, err));
  }

  // Group messages: persist + log, then signal "no reactions"
  if (normalized.is_group) {
    await logRuntime({
      organizationId: instance.organization_id,
      module: "webhook",
      action: "uazapi_group_message_captured",
      status: "success",
      payloadSnapshot: {
        instance_id: instance.id,
        remote_jid: normalized.remote_jid,
        message_id: normalized.message_id,
      },
    });
    return null;
  }

  return {
    organization_id: normalized.organization_id,
    instance_id: normalized.instance_id,
    message_id: normalized.message_id!,
    phone_number: normalized.phone_number!,
    content: normalized.content,
    direction: normalized.direction,
    message_type: normalized.message_type,
    push_name: normalized.push_name,
    media_url: normalized.media_url,
  };
}

// ============================================================================
// handleMessagesEvent — ~20 LOC pipeline
// ============================================================================

async function handleMessagesEvent(
  supabase: ReturnType<typeof createClient>,
  instance: ResolvedInstance,
  data: any,
  receivedVia: "webhook" | "dlq_replay" = "webhook",
) {
  const normalized = normalizeMessage(data, instance) as NormalizedMessage;
  normalized.received_via = receivedVia;

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

  const persisted = await persistMessage(
    supabase, instance, normalized,
    receivedVia === "dlq_replay" ? "dlq_replay" : null,
  );
  if (!persisted) return; // DLQ'd, group-only, or upsert failed

  if (normalized.is_group) return; // groups: persist only

  await triggerReactions(supabase, persisted, {
    shouldTriggerCopilot: computeShouldTriggerCopilot(normalized),
    shouldResolveWaitResponse: normalized.direction === "incoming" && !!normalized.phone_number,
    isGroup: normalized.is_group,
    replaySource: receivedVia === "dlq_replay" ? "dlq_replay" : null,
  });
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
  const rawIds = extractRawMessageIds(data);
  if (rawIds.length === 0) return;

  const messageIds = [
    ...new Set(
      rawIds.flatMap((id) =>
        buildMessageIdCandidates(id, instance.phone_number, data.owner),
      ),
    ),
  ];

  // ── ReadReceipt → status ──────────────────────────────────────────────────
  // Só vale para mensagens NOSSAS (outgoing): um receipt com IsFromMe=true é o
  // operador lendo a mensagem do contato, e gravar isso sobrescreveria o
  // `received` da linha incoming.
  const receiptStatus = mapReceiptStatus(data.status);
  if (receiptStatus && data.fromMe !== true) {
    const { data: touched, error } = await supabase
      .from("whatsapp_messages")
      .update({ status: receiptStatus })
      .in("message_id", messageIds)
      .eq("instance_id", instance.id)
      .eq("direction", "outgoing")
      .select("id");

    // Falha silenciosa foi exatamente o que escondeu esse bug: 0 linhas afetadas
    // não é erro no PostgREST, então o handler logava `success` gravando nada.
    // `error` = falha real de banco (alerta). `skipped` = receipt de mensagem que
    // não temos (legítimo: anterior à instância, ou enviada fora do CRM) — fica
    // contável sem poluir o stream de erro.
    if (error || !touched || touched.length === 0) {
      await logRuntime({
        organizationId: instance.organization_id,
        module: "webhook",
        action: "uazapi_receipt_unmatched",
        status: error ? "error" : "skipped",
        errorMessage: error?.message ?? "no_row_matched",
        payloadSnapshot: {
          instance_id: instance.id,
          message_ids: messageIds,
          receipt_status: receiptStatus,
        },
      });
    }
  }

  const update: Record<string, unknown> = {};
  if (data.edited) update.edited = true;
  if (data.deleted) {
    // NÃO gravar status='deleted': viola whatsapp_messages_status_check.
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
      .in("message_id", messageIds)
      .eq("instance_id", instance.id)
      .limit(1)
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
    .in("message_id", messageIds)
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
    .select("status, phone_number")
    .eq("id", instance.id)
    .maybeSingle();
  const previousStatus = prevInstance?.status;

  const update: Record<string, unknown> = {
    status: mapped,
    updated_at: new Date().toISOString(),
  };

  // Capture the connected account's own number so the settings UI can show
  // which number is live. The connection event sometimes carries it
  // (owner/jid/wid). Never overwrite a known number with nothing.
  if (mapped === "connected" && !prevInstance?.phone_number) {
    const ownerFromEvent = extractOwnerNumber(data);
    if (ownerFromEvent) update.phone_number = ownerFromEvent;
  }

  await supabase
    .from("whatsapp_instances")
    .update(update)
    .eq("id", instance.id);

  if (mapped === "connected" && previousStatus !== "connected") {
    // Auto-sync: trigger default history sync on first connect
    await maybeAutoSync(supabase, instance);
  }

  // NOTE: no provider probe here. This handler runs on the webhook 200-ack path
  // (inside the PROCESSING_TIMEOUT_MS budget); a slow getStatus would force a
  // 500 → Uazapi retry storm — forbidden for this 🔴 area. When the connection
  // event doesn't embed the owner number, the backfill is owned by the
  // `whatsapp-session-watchdog` cron, which already fetches /instance/all and
  // persists phone_number off the ack path. The settings poll path
  // (useCheckConnectionStatus) also fills it on the next status check.
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
    headers: withSecurityHeaders({ "Content-Type": "application/json" }),
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
  withErrorBoundary("whatsapp-webhook", async (req: Request) => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname.endsWith("/health")) {
      return genericResponse(200, { ok: true });
    }


    if (req.method !== "POST") return genericResponse(405);

    const sourceIp =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("cf-connecting-ip") ??
      "unknown";

    // Replay provenance: whatsapp-dlq-replay sets x-replay-source so we can
    // tag the resulting row with received_via='dlq_replay'.
    const replaySource: "webhook" | "dlq_replay" =
      req.headers.get("x-replay-source") === "dlq-replay" ? "dlq_replay" : "webhook";

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

    // URL formats supported:
    //   /whatsapp-webhook/<SECRET>                         — instance from payload
    //   /whatsapp-webhook/<SECRET>/<INSTANCE_ID>           — instance from URL
    //   /whatsapp-webhook/<SECRET>/<INSTANCE_ID>/<EVENT>   — instance + event from URL
    //   /whatsapp-webhook/<SECRET>/<EVENT>                 — legacy addUrlEvents
    const KNOWN_EVENTS = new Set(["messages", "messages_update", "connection", "payment", "payment_response"]);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const idx = pathSegments.findIndex((s) => s === "whatsapp-webhook");
    const pathSecret = idx >= 0 ? pathSegments[idx + 1] : undefined;
    const seg2 = idx >= 0 ? pathSegments[idx + 2] : undefined;
    const seg3 = idx >= 0 ? pathSegments[idx + 3] : undefined;

    let pathInstanceId: string | undefined;
    let pathEvent: string | undefined;
    if (seg2 && seg3) {
      pathInstanceId = seg2;
      pathEvent = seg3;
    } else if (seg2) {
      if (KNOWN_EVENTS.has(seg2)) {
        pathEvent = seg2;
      } else {
        pathInstanceId = seg2;
      }
    }

    if (
      !pathSecret ||
      !UAZAPI_WEBHOOK_SECRET ||
      !timingSafeCompare(pathSecret, UAZAPI_WEBHOOK_SECRET)
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

    // Uazapi V2 sends event name in EventType (PascalCase), not event.
    // payload.event in V2 is the event DATA object, not the type string.
    const rawEvent =
      (typeof payload.event === "string" ? payload.event : null) ??
      (typeof payload.EventType === "string" ? payload.EventType : null) ??
      pathEvent ??
      "unknown";
    const event = rawEvent.toLowerCase();

    // pathInstanceId (from URL) is the reliable Uazapi instance ID for reconfigured instances.
    // Defensive picker tolerates Uazapi V2 schema variations (empty strings, camel/Pascal/snake aliases).
    const uazapiInstanceId = pickInstanceId(payload, pathInstanceId);
    const uazapiToken = pickUazapiToken(payload);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Persistent rate limit — authoritative check (in-memory is first-line only)
    const persistentRl = await checkRateLimitPersistent(
      supabase,
      `whatsapp-webhook:${sourceIp}`,
      RATE_LIMIT_MAX,
      Math.floor(RATE_LIMIT_WINDOW_MS / 1000),
    );
    if (!persistentRl.allowed) {
      await logRuntime({
        module: "webhook",
        action: "uazapi_rate_limit_persistent",
        status: "error",
        payloadSnapshot: { source_ip: sourceIp, remaining: persistentRl.remaining },
      });
      return genericResponse(429, { error: "rate_limited" });
    }

    if (!uazapiInstanceId && !uazapiToken) {
      const rawSnippet = (() => {
        try { return JSON.stringify(payload).slice(0, 2048); } catch { return "[unserializable]"; }
      })();
      await logRuntime({
        module: "webhook",
        action: "uazapi_missing_instance",
        status: "error",
        payloadSnapshot: {
          source_ip: sourceIp,
          event,
          url_path: url.pathname,
          keys: Object.keys(payload).slice(0, 15),
          raw_truncated: rawSnippet,
        },
      });
      const parked = await enqueueDlq(supabase, {
        source_ip: sourceIp,
        url_path: url.pathname,
        event,
        reason: "missing_instance",
        payload,
      });
      return dlqOutcomeResponse(parked, "missing_instance");
    }

    let instance: ResolvedInstance | null = null;
    if (uazapiInstanceId) {
      instance = await resolveInstance(supabase, uazapiInstanceId);
    }
    if (!instance && uazapiToken) {
      instance = await resolveInstanceByToken(supabase, uazapiToken);
      if (instance) {
        await logRuntime({
          module: "webhook",
          action: "uazapi_resolved_by_token_fallback",
          status: "success",
          payloadSnapshot: {
            instance_id: instance.id,
            organization_id: instance.organization_id,
            event,
            had_instance_id_candidate: !!uazapiInstanceId,
          },
        });
      }
    }
    if (!instance) {
      // ERR-4 early-drop: a token whose DLQ rows already exhausted replay will
      // never resolve — 200 without enqueueing (no DLQ row, no error log).
      // Sampled "skipped" log keeps the drop volume observable in runtime_logs.
      if (uazapiToken && (await isPoisonToken(uazapiToken))) {
        poisonDropsSinceBoot += 1;
        if (poisonDropsSinceBoot % POISON_DROP_LOG_SAMPLE === 1) {
          await logRuntime({
            module: "webhook",
            action: "uazapi_unknown_instance_dropped",
            status: "skipped",
            payloadSnapshot: {
              event,
              instance_ref: uazapiToken.slice(0, 8),
              drops_since_boot: poisonDropsSinceBoot,
            },
          });
        }
        return genericResponse(200);
      }
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
      const parked = await enqueueDlq(supabase, {
        source_ip: sourceIp,
        url_path: url.pathname,
        event,
        reason: "unknown_instance",
        payload,
      });
      return dlqOutcomeResponse(parked, "unknown_instance");
    }

    try {
      await withTimeout(
        (async () => {
          switch (event) {
            case "messages": {
              // Uazapi V2: message object in payload.message. Legacy: payload.data.
              const msgData = payload.data
                ?? (typeof payload.message === "object" && payload.message ? payload.message : null)
                ?? payload;
              // Uazapi V2: payload.chat has the phone JID; message.chatid may be LID
              if (payload.chat && typeof payload.chat === "string") {
                msgData._phone_jid = payload.chat;
              }
              await handleMessagesEvent(supabase, instance, msgData, replaySource);
              break;
            }
            case "messages_update": {
              // Uazapi V2: update data in payload.event (object) with PascalCase fields
              let updateData = payload.data;
              if (!updateData && typeof payload.event === "object" && payload.event !== null) {
                const ev = payload.event;
                updateData = {
                  id: ev.MessageIDs?.[0] ?? ev.messageid,
                  // MessageIDs é array: um receipt pode cobrir várias mensagens.
                  ids: Array.isArray(ev.MessageIDs) ? ev.MessageIDs : undefined,
                  status: ev.Type ?? ev.type,
                  chatid: ev.chatid ?? ev.Chat,
                  // IsFromMe distingue "o contato leu a minha" (false) de "eu li a
                  // dele" (true) — sem isso o receipt sobrescreve linha incoming.
                  fromMe: ev.IsFromMe ?? ev.isFromMe,
                  // Fallback do prefixo do message_id composto quando a instância
                  // ainda não tem phone_number gravado.
                  owner: payload.owner,
                };
              }
              await handleMessagesUpdateEvent(supabase, instance, updateData ?? payload);
              break;
            }
            case "connection":
              await handleConnectionEvent(
                supabase,
                instance,
                payload.data ?? { status: payload.state, state: payload.state },
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
                  keys: Object.keys(payload).slice(0, 15),
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
  timingSafeCompare,
  normalizeMessage,
  handleConnectionEvent,
  rateLimitState,
  RATE_LIMIT_MAX,
  REPLAY_WINDOW_MS,
};
