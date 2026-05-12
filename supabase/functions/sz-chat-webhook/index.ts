import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from "../_shared/logger.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { findLeadByPhoneOrEmail, associateMessagesToLead, getOrCreateLead } from "../_shared/lead-service.ts";
import { smartSplitMessage, type NaturalMessagingConfig } from "../_shared/natural-messaging.ts";
import { isCopilotCanceled, logCopilotCancellation } from "../_shared/copilot/cancellation.ts";

/**
 * SZ.chat Webhook Receiver
 *
 * Receives webhook events from SZ.chat (Alamaster):
 * - client_message: New messages from contacts
 * - attendance_transfer / humanTransferAgent: Session transferred to our team
 * - enter_queue / waitStart: Session entered queue (same flow as transfer)
 * - attendance_finish / humanFinish: Session ended on SZ.chat side
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const DEFAULT_BATCH_WAIT_SECONDS = 8;
const DELAY_BETWEEN_MESSAGES_MS = 1500;
const MAX_MESSAGE_LENGTH = 350;

// ─── Types ───────────────────────────────────────────────────────────────────

interface SzChatWebhookPayload {
  data: Record<string, unknown>;
  webhook: {
    app: string;
    host: string;
    key: string;   // Event type
    label: string;
  };
}

interface SzChatConfig {
  id: string;
  organization_id: string;
  api_url: string;
  api_token: string | null;
  channel_id: string | null;
  whatsapp_instance_id: string | null;
  team_mappings: Record<string, string>;
  webhook_secret: string | null;
  is_active: boolean;
  whatsapp_instances?: {
    id: string;
    instance_name: string;
    copilot_agent_id: string | null;
    copilot_agents?: {
      id: string;
      name: string;
      is_active: boolean;
      availability: Record<string, unknown> | null;
      response_delay_seconds: number | null;
      attend_unknown_contacts: boolean | null;
      natural_messaging_config: NaturalMessagingConfig | null;
    } | null;
  } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize phone number: strip non-digits, add "55" prefix for Brazilian numbers.
 */
function normalizePhone(raw: string | undefined | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  // Already has country code 55
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  // Looks like a Brazilian number without country code (10-11 digits)
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

/**
 * Check if the agent is within its configured schedule.
 */
function isWithinSchedule(availability: Record<string, unknown> | null | undefined): boolean {
  if (!availability || typeof availability !== "object") return true;
  const mode = availability.mode as string | undefined;
  if (!mode || mode === "always") return true;

  const timezone = (availability.timezone as string) || "America/Sao_Paulo";
  const days = Array.isArray(availability.days) ? availability.days as string[] : [];
  const start = (availability.start as string) || "00:00";
  const end = (availability.end as string) || "23:59";

  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase();
    const hour = parts.find((p) => p.type === "hour")?.value || "00";
    const minute = parts.find((p) => p.type === "minute")?.value || "00";
    const current = `${hour}:${minute}`;

    const dayMap: Record<string, string> = {
      mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun",
    };
    const currentDay = weekday ? dayMap[weekday.slice(0, 3)] : undefined;
    if (days.length > 0 && currentDay && !days.includes(currentDay)) return false;

    return current >= start && current <= end;
  } catch (error) {
    console.warn("[SZ Chat Webhook] Schedule check failed, defaulting to allowed:", error);
    return true;
  }
}

/**
 * Split a long message into smaller chunks for WhatsApp delivery.
 */
function splitMessageIntoChunks(message: string, maxLength: number = MAX_MESSAGE_LENGTH): string[] {
  if (message.length <= maxLength) return [message.trim()];

  const chunks: string[] = [];
  const paragraphs = message.split(/\n\n+/).filter(p => p.trim());
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 2 <= maxLength) {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    } else if (paragraph.length > maxLength) {
      if (currentChunk.trim()) { chunks.push(currentChunk.trim()); currentChunk = ""; }
      const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(s => s.trim());
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length + 1 <= maxLength) {
          currentChunk += (currentChunk ? " " : "") + sentence;
        } else {
          if (currentChunk.trim()) chunks.push(currentChunk.trim());
          if (sentence.length > maxLength) {
            const words = sentence.split(/\s+/);
            currentChunk = "";
            for (const word of words) {
              if (currentChunk.length + word.length + 1 <= maxLength) {
                currentChunk += (currentChunk ? " " : "") + word;
              } else {
                if (currentChunk.trim()) chunks.push(currentChunk.trim());
                currentChunk = word;
              }
            }
          } else {
            currentChunk = sentence;
          }
        }
      }
    } else {
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks.filter(c => c.trim());
}

// ─── AI / Send helpers ───────────────────────────────────────────────────────

/**
 * Call agent-message edge function to process the message with AI.
 */
async function triggerAgentMessage(
  organizationId: string,
  phoneNumber: string,
  messageText: string,
  pushName?: string,
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    console.log("[SZ Chat Webhook] Triggering agent-message for:", {
      organizationId, phoneNumber, pushName,
      messagePreview: messageText.substring(0, 50),
    });

    const response = await fetch(`${SUPABASE_URL}/functions/v1/agent-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        from: phoneNumber,
        message: messageText,
        channel: "whatsapp",
        organization_id: organizationId,
        push_name: pushName,
        incoming_message_type: "text",
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[SZ Chat Webhook] Agent-message error:", result);
      return { success: false, error: result.error || "Agent processing failed" };
    }

    console.log("[SZ Chat Webhook] Agent-message response:", {
      hasMessage: !!result.message, state: result.state, action: result.action,
    });

    return { success: true, message: result.message };
  } catch (error) {
    console.error("[SZ Chat Webhook] Error calling agent-message:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Send a response back via the sz-chat-send edge function.
 */
async function sendViaSzChat(
  organizationId: string,
  phoneNumber: string,
  message: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/sz-chat-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        action: "send_message",
        organization_id: organizationId,
        phone_number: phoneNumber,
        message,
      }),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      console.error("[SZ Chat Webhook] sz-chat-send error:", result);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[SZ Chat Webhook] Error calling sz-chat-send:", error);
    return false;
  }
}

/**
 * Send a response split into multiple messages (with optional natural messaging).
 */
async function sendSzChatResponse(
  organizationId: string,
  phoneNumber: string,
  message: string,
  naturalMessagingConfig?: NaturalMessagingConfig | null,
  supabase?: ReturnType<typeof createClient>,
): Promise<boolean> {
  // Cancellation gate (RC-cancel, 2026-04-26): per-chunk check antes de cada
  // setTimeout/sendViaSzChat. Para envio se user desativou copilot mid-flight.
  // supabase opcional pra backwards-compat — se ausente, não faz check.
  const checkCanceled = async (): Promise<boolean> => {
    if (!supabase) return false;
    const r = await isCopilotCanceled(supabase, organizationId, phoneNumber);
    return r.canceled;
  };

  // Use smart split if natural messaging is enabled
  if (naturalMessagingConfig?.enabled) {
    const { chunks, delays } = await smartSplitMessage(message, naturalMessagingConfig);
    console.log("[SZ Chat Webhook] Natural messaging: sending", chunks.length, "message(s) to:", phoneNumber);

    let allSent = true;
    let chunksSent = 0;
    for (let i = 0; i < chunks.length; i++) {
      const delay = delays[i] || 0;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (await checkCanceled()) {
        console.log("[SZ Chat Webhook] Copilot canceled mid-flight; aborting after", chunksSent, "of", chunks.length, "chunk(s)");
        logCopilotCancellation({
          organizationId,
          gate: "sz_chat_chunks",
          phone: phoneNumber,
          chunksSent,
          chunksTotal: chunks.length,
        });
        return chunksSent > 0;
      }
      const sent = await sendViaSzChat(organizationId, phoneNumber, chunks[i]);
      if (!sent) {
        allSent = false;
        console.error("[SZ Chat Webhook] Failed to send natural chunk", i + 1, "of", chunks.length);
      } else {
        chunksSent++;
        console.log("[SZ Chat Webhook] Sent natural chunk", i + 1, "of", chunks.length, "- length:", chunks[i].length, "delay:", delay, "ms");
      }
    }
    return allSent;
  }

  // Fallback: classic split by size
  const chunks = splitMessageIntoChunks(message);
  console.log("[SZ Chat Webhook] Sending response in", chunks.length, "message(s) to:", phoneNumber);

  let allSent = true;
  let chunksSent = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_MESSAGES_MS));
    }
    if (await checkCanceled()) {
      console.log("[SZ Chat Webhook] Copilot canceled mid-flight (fallback split); aborting after", chunksSent, "of", chunks.length);
      logCopilotCancellation({
        organizationId,
        gate: "sz_chat_chunks",
        phone: phoneNumber,
        chunksSent,
        chunksTotal: chunks.length,
      });
      return chunksSent > 0;
    }
    const sent = await sendViaSzChat(organizationId, phoneNumber, chunks[i]);
    if (!sent) {
      allSent = false;
      console.error("[SZ Chat Webhook] Failed to send chunk", i + 1, "of", chunks.length);
    } else {
      chunksSent++;
    }
  }
  return allSent;
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

/**
 * Handle client_message event — incoming message from contact.
 * Only processes messages with origin "contact".
 */
async function handleClientMessage(
  supabase: ReturnType<typeof createClient>,
  config: SzChatConfig,
  data: Record<string, unknown>,
): Promise<void> {
  const origin = data.origin as string | undefined;
  if (origin !== "contact") {
    console.log("[SZ Chat Webhook] Ignoring non-contact message, origin:", origin);
    return;
  }

  const messageText = data.message as string | undefined;
  if (!messageText || !messageText.trim()) {
    console.log("[SZ Chat Webhook] Empty message, skipping");
    return;
  }

  const rawPhone = (data.platform_id as string) || "";
  const phoneNumber = normalizePhone(rawPhone);
  if (!phoneNumber) {
    console.warn("[SZ Chat Webhook] No phone number in payload, skipping");
    return;
  }

  const pushName = (data.name as string) || null;
  const sessionId = (data._id as string) || (data.session_id as string) || null;
  const organizationId = config.organization_id;
  const instanceId = config.whatsapp_instances?.id || null;
  const instance = config.whatsapp_instances;
  const agent = instance?.copilot_agents;

  // Check if there is an active session for this phone in our system
  if (sessionId) {
    const { data: activeSession } = await supabase
      .from("sz_chat_sessions")
      .select("id, status")
      .eq("organization_id", organizationId)
      .eq("sz_chat_session_id", sessionId)
      .eq("status", "active")
      .maybeSingle();

    if (!activeSession) {
      console.log("[SZ Chat Webhook] No active session found for session_id:", sessionId, "— message will still be saved");
    }
  }

  // Generate a unique message_id for this message
  const messageId = `sz_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // Save incoming message to whatsapp_messages — upsert preserves first row
  // if the same webhook event is replayed.
  const { error: msgError } = await supabase.from("whatsapp_messages").upsert({
    organization_id: organizationId,
    instance_id: instanceId,
    message_id: messageId,
    remote_jid: `${phoneNumber}@s.whatsapp.net`,
    phone_number: phoneNumber,
    direction: "incoming",
    message_type: "text",
    content: messageText,
    push_name: pushName,
    status: "received",
    timestamp: new Date().toISOString(),
    raw_payload: data,
  }, { onConflict: "message_id,instance_id", ignoreDuplicates: true });

  if (msgError) {
    console.error("[SZ Chat Webhook] Error saving message:", msgError);
  } else {
    console.log("[SZ Chat Webhook] Message saved:", { phone: phoneNumber, messageId });
  }

  // Auto-unarchive conversation on incoming message
  if (instanceId) {
    await supabase
      .from("whatsapp_conversations")
      .update({ archived_at: null })
      .eq("instance_id", instanceId)
      .eq("phone_number", phoneNumber)
      .not("archived_at", "is", null);
  }

  // Associate message to existing lead
  await associateMessageToExistingLead(supabase, organizationId, phoneNumber);

  // Resolve any waiting workflow executions for this phone (fire-and-forget).
  // Safe if nothing is waiting — RPC returns 0 quickly.
  supabase
    .rpc("resolve_wait_response_by_phone", {
      p_phone: phoneNumber,
      p_organization_id: organizationId,
      p_channel: "whatsapp",
    })
    .then(({ error }) => {
      if (error) {
        console.warn("[SZ Chat Webhook] resolve_wait_response_by_phone failed:", error.message);
      }
    });

  // Check if we have a linked and active agent
  const hasAgent = instance?.copilot_agent_id && agent?.is_active;

  // If agent has attend_unknown_contacts, create shadow lead if needed
  if (hasAgent && agent?.attend_unknown_contacts === true) {
    const existingLead = await findLeadByPhoneOrEmail(supabase, organizationId, phoneNumber);
    if (!existingLead) {
      console.log("[SZ Chat Webhook] Creating shadow lead for unknown contact:", phoneNumber);
      const shadowResult = await getOrCreateLead(supabase, {
        organizationId,
        phone: phoneNumber,
        pushName,
        isShadow: true,
      });
      if (shadowResult?.lead) {
        await associateMessagesToLead(supabase, organizationId, phoneNumber, shadowResult.lead.id);
        console.log("[SZ Chat Webhook] Shadow lead created:", shadowResult.lead.id);
      }
    }
  }

  if (!hasAgent) {
    console.log("[SZ Chat Webhook] No active agent linked, skipping AI processing");
    return;
  }

  // Check availability schedule
  const availability = agent?.availability || null;
  if (!isWithinSchedule(availability)) {
    console.log("[SZ Chat Webhook] Agent outside schedule, skipping response");
    return;
  }

  // F5b 2026-04-26: canonical check (phone_ai_preferences first, fallback leads).
  // Antes lia só leadForAiCheck.ai_disabled (denormalizado).
  const preBatchCancel = await isCopilotCanceled(supabase, organizationId, phoneNumber);
  if (preBatchCancel.canceled) {
    console.log("[SZ Chat Webhook] AI disabled for phone (pre-batch), skipping copilot:", {
      phone: phoneNumber,
      source: preBatchCancel.source,
    });
    return;
  }

  // =====================================================
  // MESSAGE BATCHING: Wait for more messages from the lead
  // =====================================================
  const batchWaitSeconds = agent?.response_delay_seconds || DEFAULT_BATCH_WAIT_SECONDS;

  console.log("[SZ Chat Webhook] Starting batch wait:", {
    seconds: batchWaitSeconds, messageId, phone: phoneNumber,
  });

  await new Promise((resolve) => setTimeout(resolve, batchWaitSeconds * 1000));

  // Check if THIS message is still the latest unprocessed
  const { data: latestUnprocessed, error: checkError } = await supabase
    .from("whatsapp_messages")
    .select("message_id")
    .eq("organization_id", organizationId)
    .eq("phone_number", phoneNumber)
    .eq("direction", "incoming")
    .is("processed_by_agent_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (checkError || !latestUnprocessed) {
    console.log("[SZ Chat Webhook] No unprocessed messages found, skipping");
    return;
  }

  // If a newer message arrived, let that one handle the batch
  if (latestUnprocessed.message_id !== messageId) {
    console.log("[SZ Chat Webhook] Newer message exists, letting it handle the batch:", {
      thisMessageId: messageId,
      latestMessageId: latestUnprocessed.message_id,
    });
    return;
  }

  // This is the latest message — gather ALL unprocessed messages
  const { data: pendingMessages, error: fetchError } = await supabase
    .from("whatsapp_messages")
    .select("message_id, content, created_at")
    .eq("organization_id", organizationId)
    .eq("phone_number", phoneNumber)
    .eq("direction", "incoming")
    .is("processed_by_agent_at", null)
    .not("content", "is", null)
    .order("created_at", { ascending: true });

  if (fetchError || !pendingMessages || pendingMessages.length === 0) {
    console.log("[SZ Chat Webhook] No pending messages to process");
    return;
  }

  // Concatenate all pending messages
  const batchedMessageText = pendingMessages
    .map((m: { content: string }) => m.content)
    .filter((c: string) => c && c.trim())
    .join("\n\n");

  // F5b 2026-04-26: re-check pós-batch via fonte canônica.
  const postBatchCancel = await isCopilotCanceled(supabase, organizationId, phoneNumber);
  if (postBatchCancel.canceled) {
    console.log("[SZ Chat Webhook] AI disabled for phone (post-batch), skipping copilot:", {
      phone: phoneNumber,
      source: postBatchCancel.source,
    });
    // Mark messages as processed to avoid reprocessing
    const skipMsgIds = pendingMessages.map((m: { message_id: string }) => m.message_id);
    await supabase
      .from("whatsapp_messages")
      .update({ processed_by_agent_at: new Date().toISOString() })
      .in("message_id", skipMsgIds);
    return;
  }

  console.log("[SZ Chat Webhook] Processing batched messages:", {
    agentName: agent?.name,
    phone: phoneNumber,
    messageCount: pendingMessages.length,
    totalLength: batchedMessageText.length,
  });

  // Call agent-message for AI processing
  const agentResult = await triggerAgentMessage(
    organizationId,
    phoneNumber,
    batchedMessageText,
    pushName || undefined,
  );

  // Mark ALL messages as processed
  const allMessageIds = pendingMessages.map((m: { message_id: string }) => m.message_id);
  const { error: markError } = await supabase
    .from("whatsapp_messages")
    .update({ processed_by_agent_at: new Date().toISOString() })
    .in("message_id", allMessageIds);

  if (markError) {
    console.warn("[SZ Chat Webhook] Error marking messages as processed:", markError);
  } else {
    console.log("[SZ Chat Webhook] Marked", allMessageIds.length, "messages as processed");
  }

  // If agent returned a response, send it back via SZ.chat and save outgoing message
  if (agentResult.success && agentResult.message) {
    const rawNaturalConfig = agent?.natural_messaging_config;
    const naturalConfig: NaturalMessagingConfig = rawNaturalConfig?.enabled != null
      ? rawNaturalConfig as NaturalMessagingConfig
      : { enabled: true, intensity: "natural" };

    const sent = await sendSzChatResponse(
      organizationId,
      phoneNumber,
      agentResult.message,
      naturalConfig,
      supabase,
    );

    if (sent) {
      // Save outgoing message record — agent reply is the source of truth.
      const { error: outMsgError } = await supabase.from("whatsapp_messages").upsert({
        organization_id: organizationId,
        instance_id: instanceId,
        message_id: `agent_sz_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        remote_jid: `${phoneNumber}@s.whatsapp.net`,
        phone_number: phoneNumber,
        direction: "outgoing",
        message_type: "text",
        content: agentResult.message,
        status: "sent",
        timestamp: new Date().toISOString(),
        sent_by_ai: true,
      }, { onConflict: "message_id,instance_id", ignoreDuplicates: true });

      if (outMsgError) {
        console.error("[SZ Chat Webhook] Error saving outgoing message:", outMsgError);
      } else {
        console.log("[SZ Chat Webhook] Outgoing agent message saved");
      }
    }
  } else if (!agentResult.success) {
    console.warn("[SZ Chat Webhook] Agent processing failed:", agentResult.error);
  }
}

/**
 * Handle attendance_transfer / enter_queue events — session transferred to our team.
 * Creates/finds the lead, upserts the session, and re-enables AI.
 */
async function handleTransferOrQueue(
  supabase: ReturnType<typeof createClient>,
  config: SzChatConfig,
  data: Record<string, unknown>,
): Promise<void> {
  const organizationId = config.organization_id;
  const sessionId = (data._id as string) || (data.session_id as string) || null;
  const rawPhone = (data.platform_id as string) || "";
  const phoneNumber = normalizePhone(rawPhone);
  const contactName = (data.name as string) || null;
  const contactId = (data.contact_id as string) || null;
  const platform = (data.platform as string) || "WhatsApp";
  const instanceId = config.whatsapp_instances?.id || null;

  if (!phoneNumber) {
    console.warn("[SZ Chat Webhook] Transfer event missing phone number, skipping");
    return;
  }

  console.log("[SZ Chat Webhook] Handling transfer/queue event:", {
    sessionId, phoneNumber, contactName, platform,
  });

  // 1. Get or create lead
  const leadResult = await getOrCreateLead(supabase, {
    organizationId,
    phone: phoneNumber,
    name: contactName,
    pushName: contactName,
    origin: "sz_chat",
  });

  if (leadResult?.lead) {
    // 2. Associate existing unlinked messages to this lead
    await associateMessagesToLead(supabase, organizationId, phoneNumber, leadResult.lead.id);

    // 3. Re-enable AI on lead (clear ai_disabled flag)
    const { error: aiError } = await supabase
      .from("leads")
      .update({
        ai_disabled: false,
        ai_disabled_at: null,
        ai_disabled_by: null,
      })
      .eq("id", leadResult.lead.id);

    if (aiError) {
      console.warn("[SZ Chat Webhook] Error re-enabling AI on lead:", aiError);
    } else {
      console.log("[SZ Chat Webhook] AI re-enabled on lead:", leadResult.lead.id);
    }

    // Also reset conversation state to allow copilot to process
    const { error: convError } = await supabase
      .from("conversations")
      .update({ state: "AI_ACTIVE" })
      .eq("lead_id", leadResult.lead.id)
      .eq("organization_id", organizationId);

    if (convError) {
      console.warn("[SZ Chat Webhook] Error resetting conversation state:", convError);
    }
  }

  // 4. Upsert sz_chat_sessions
  if (sessionId) {
    const { error: sessionError } = await supabase
      .from("sz_chat_sessions")
      .upsert(
        {
          organization_id: organizationId,
          sz_chat_session_id: sessionId,
          lead_id: leadResult?.lead?.id || null,
          phone_number: phoneNumber,
          contact_name: contactName,
          sz_chat_contact_id: contactId,
          sz_chat_channel_id: config.channel_id,
          sz_chat_platform: platform,
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "sz_chat_session_id,organization_id" }
      );

    if (sessionError) {
      console.error("[SZ Chat Webhook] Error upserting session:", sessionError);
    } else {
      console.log("[SZ Chat Webhook] Session upserted:", sessionId);
    }
  }

  // 5. Auto-unarchive conversation
  if (instanceId) {
    await supabase
      .from("whatsapp_conversations")
      .update({ archived_at: null })
      .eq("instance_id", instanceId)
      .eq("phone_number", phoneNumber)
      .not("archived_at", "is", null);
  }
}

/**
 * Handle attendance_finish event — session ended on SZ.chat side.
 */
async function handleFinish(
  supabase: ReturnType<typeof createClient>,
  config: SzChatConfig,
  data: Record<string, unknown>,
): Promise<void> {
  const organizationId = config.organization_id;
  const sessionId = (data._id as string) || (data.session_id as string) || null;

  if (!sessionId) {
    console.warn("[SZ Chat Webhook] Finish event missing session_id, skipping");
    return;
  }

  console.log("[SZ Chat Webhook] Handling finish event:", { sessionId });

  const { error } = await supabase
    .from("sz_chat_sessions")
    .update({ status: "finished", updated_at: new Date().toISOString() })
    .eq("sz_chat_session_id", sessionId)
    .eq("organization_id", organizationId);

  if (error) {
    console.error("[SZ Chat Webhook] Error finishing session:", error);
  } else {
    console.log("[SZ Chat Webhook] Session finished:", sessionId);
  }
}

// ─── Shared helper ───────────────────────────────────────────────────────────

/**
 * Associate messages to an existing lead (never creates a new one).
 */
async function associateMessageToExistingLead(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  phoneNumber: string,
): Promise<void> {
  const lead = await findLeadByPhoneOrEmail(supabase, organizationId, phoneNumber);
  if (lead) {
    await associateMessagesToLead(supabase, organizationId, phoneNumber, lead.id);
    console.log("[SZ Chat Webhook] Messages associated to existing lead:", lead.id);
  }
}

// ─── Security ────────────────────────────────────────────────────────────────

/**
 * Validate webhook secret against the config.
 * Returns the matching config, or null if validation fails.
 */
function validateWebhookSecret(
  req: Request,
  configs: SzChatConfig[],
): SzChatConfig | null {
  const secret = req.headers.get("x-webhook-secret") || req.headers.get("x-sz-webhook-key");

  // If a secret header is provided, find the config that matches
  if (secret) {
    const matched = configs.find(c => c.webhook_secret && c.webhook_secret === secret);
    if (matched) return matched;

    // Secret provided but no match — check if any config requires a secret
    const anyWithSecret = configs.some(c => !!c.webhook_secret);
    if (anyWithSecret) {
      console.warn("[SZ Chat Webhook] Secret mismatch");
      return null;
    }
  }

  // No secret provided — if any config has a secret configured, reject
  const anyWithSecret = configs.some(c => !!c.webhook_secret);
  if (anyWithSecret) {
    console.warn("[SZ Chat Webhook] No secret header but config requires one");
    return null;
  }

  // No secrets configured anywhere — fallback to first active config
  return configs[0] || null;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(withSentry('sz-chat-webhook', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only POST is allowed
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const payload: SzChatWebhookPayload = await req.json();
    const eventKey = payload.webhook?.key;

    console.log("[SZ Chat Webhook] Received event:", {
      key: eventKey,
      label: payload.webhook?.label,
      app: payload.webhook?.app,
    });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load all active SZ.chat configs with joined whatsapp_instances → copilot_agents
    const { data: configs, error: configError } = await supabase
      .from("sz_chat_config")
      .select("*, whatsapp_instances:whatsapp_instance_id(id, instance_name, copilot_agent_id, copilot_agents:copilot_agent_id(id, name, is_active, availability, response_delay_seconds, attend_unknown_contacts, natural_messaging_config))")
      .eq("is_active", true);

    if (configError || !configs || configs.length === 0) {
      console.warn("[SZ Chat Webhook] No active SZ.chat configs found");
      // Return 200 to prevent SZ.chat retries
      return new Response(
        JSON.stringify({ success: true, message: "No active configuration" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validate webhook secret and find the matching config
    const config = validateWebhookSecret(req, configs as SzChatConfig[]);
    if (!config) {
      console.warn("[SZ Chat Webhook] Webhook secret validation failed");
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Route events to handlers
    switch (eventKey) {
      case "client_message":
        await handleClientMessage(supabase, config, payload.data);
        break;

      case "attendance_transfer":
      case "humanTransferAgent":
      case "enter_queue":
      case "waitStart":
        await handleTransferOrQueue(supabase, config, payload.data);
        break;

      case "attendance_finish":
      case "humanFinish":
        await handleFinish(supabase, config, payload.data);
        break;

      default:
        console.log("[SZ Chat Webhook] Unhandled event:", eventKey);
    }

    await logRuntime({
      organizationId: config.organization_id,
      module: "sz_chat",
      action: "webhook_process",
      status: "success",
      payloadSnapshot: { event: eventKey },
    });

    // Always return 200 to SZ.chat to prevent retries
    return new Response(
      JSON.stringify({ success: true, event: eventKey }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[SZ Chat Webhook] Error:", error);
    await logRuntime({
      module: "sz_chat",
      action: "webhook_process",
      status: "error",
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    // Always return 200 to SZ.chat even on errors to prevent retries
    return new Response(
      JSON.stringify({ success: true, message: "Processed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
