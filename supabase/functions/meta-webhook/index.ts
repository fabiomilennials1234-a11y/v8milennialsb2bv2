/**
 * meta-webhook
 *
 * Recebe todos os eventos do Meta (Facebook/Instagram):
 * - GET: Verificacao de webhook (hub.verify_token)
 * - POST: Eventos de messaging (Messenger/Instagram) e leadgen (Lead Ads)
 *
 * Webhook URL: ${SUPABASE_URL}/functions/v1/meta-webhook
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifyWebhookSignature,
  getLeadgenData,
} from "../_shared/meta-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_WEBHOOK_VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN")!;

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── GET: Webhook verification ──────────────────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === META_WEBHOOK_VERIFY_TOKEN) {
      console.log("[meta-webhook] Webhook verified successfully");
      return new Response(challenge, { status: 200 });
    }

    console.error("[meta-webhook] Verification failed - invalid token");
    return new Response("Forbidden", { status: 403 });
  }

  // ── POST: Webhook events ───────────────────────────────────────────────
  if (req.method === "POST") {
    const body = await req.text();

    // Verificar assinatura HMAC
    const signature = req.headers.get("x-hub-signature-256");
    if (!verifyWebhookSignature(body, signature)) {
      console.error("[meta-webhook] Invalid signature");
      return new Response("Unauthorized", { status: 401 });
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    console.log(`[meta-webhook] Received ${payload.object} event with ${payload.entry?.length || 0} entries`);

    // Processar cada entry
    for (const entry of payload.entry || []) {
      try {
        if (payload.object === "page") {
          // Messenger messages
          await processMessengerEntry(supabase, entry);
        } else if (payload.object === "instagram") {
          // Instagram Direct messages
          await processInstagramEntry(supabase, entry);
        }
      } catch (err) {
        console.error(`[meta-webhook] Error processing entry ${entry.id}:`, err);
      }
    }

    // Meta espera 200 rapido para nao reenviar
    return new Response("OK", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
});

// ── Types ──────────────────────────────────────────────────────────────────

interface WebhookPayload {
  object: "page" | "instagram";
  entry: WebhookEntry[];
}

interface WebhookEntry {
  id: string; // page_id or ig_account_id
  time: number;
  messaging?: MessagingEvent[];
  changes?: ChangeEvent[];
}

interface MessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload: { url?: string };
    }>;
  };
  postback?: {
    title: string;
    payload: string;
  };
}

interface ChangeEvent {
  field: string;
  value: {
    leadgen_id?: string;
    page_id?: string;
    form_id?: string;
    created_time?: number;
  };
}

// ── Messenger Processing ─────────────────────────────────────────────────

async function processMessengerEntry(
  supabase: ReturnType<typeof createClient>,
  entry: WebhookEntry
) {
  const pageId = entry.id;

  // Processar mensagens
  for (const event of entry.messaging || []) {
    if (event.message) {
      await saveIncomingMessage(supabase, {
        channel: "messenger",
        pageId,
        senderId: event.sender.id,
        recipientId: event.recipient.id,
        externalId: event.message.mid,
        text: event.message.text || null,
        attachments: event.message.attachments || [],
        timestamp: event.timestamp,
      });
    }
  }

  // Processar leadgen events
  for (const change of entry.changes || []) {
    if (change.field === "leadgen" && change.value.leadgen_id) {
      await processLeadgen(supabase, pageId, change.value.leadgen_id);
    }
  }
}

// ── Instagram Processing ─────────────────────────────────────────────────

async function processInstagramEntry(
  supabase: ReturnType<typeof createClient>,
  entry: WebhookEntry
) {
  const igAccountId = entry.id;

  for (const event of entry.messaging || []) {
    if (event.message) {
      await saveIncomingMessage(supabase, {
        channel: "instagram",
        pageId: igAccountId,
        senderId: event.sender.id,
        recipientId: event.recipient.id,
        externalId: event.message.mid,
        text: event.message.text || null,
        attachments: event.message.attachments || [],
        timestamp: event.timestamp,
      });
    }
  }
}

// ── Save Incoming Message ────────────────────────────────────────────────

interface IncomingMessageData {
  channel: "messenger" | "instagram";
  pageId: string;
  senderId: string;
  recipientId: string;
  externalId: string;
  text: string | null;
  attachments: Array<{ type: string; payload: { url?: string } }>;
  timestamp: number;
}

async function saveIncomingMessage(
  supabase: ReturnType<typeof createClient>,
  data: IncomingMessageData
) {
  // Determinar se e incoming (sender != page) ou outgoing (sender == page)
  // Para Messenger: comparar sender.id com page_id
  // Para Instagram: comparar com ig_account_id
  const isOutgoing = data.senderId === data.pageId;
  const direction = isOutgoing ? "outgoing" : "incoming";

  // Buscar pagina para obter organization_id
  const pageColumn = data.channel === "instagram" ? "instagram_account_id" : "page_id";
  const { data: page, error: pageError } = await supabase
    .from("meta_pages")
    .select("organization_id, page_id")
    .eq(pageColumn, data.pageId)
    .eq("is_active", true)
    .single();

  if (pageError || !page) {
    console.error(`[meta-webhook] Page not found for ${data.channel} ${data.pageId}:`, pageError);
    return;
  }

  // Determinar tipo de mensagem e conteudo
  let messageType = "text";
  let content = data.text;
  let mediaUrl: string | null = null;

  if (data.attachments.length > 0) {
    const attachment = data.attachments[0];
    messageType = attachment.type || "file";
    mediaUrl = attachment.payload?.url || null;
    if (!content) {
      content = `[${messageType}]`;
    }
  }

  // Buscar lead associado pelo sender_id (via mensagens anteriores ou meta_sender_id no lead)
  let leadId: string | null = null;
  const { data: existingMsg } = await supabase
    .from("channel_messages")
    .select("lead_id")
    .eq("sender_id", isOutgoing ? data.recipientId : data.senderId)
    .eq("organization_id", page.organization_id)
    .not("lead_id", "is", null)
    .limit(1)
    .single();

  if (existingMsg?.lead_id) {
    leadId = existingMsg.lead_id;
  }

  // Salvar mensagem
  const { error: insertError } = await supabase
    .from("channel_messages")
    .upsert(
      {
        organization_id: page.organization_id,
        channel: data.channel,
        page_id: page.page_id,
        external_id: data.externalId,
        sender_id: isOutgoing ? data.recipientId : data.senderId,
        direction,
        message_type: messageType,
        content,
        media_url: mediaUrl,
        status: direction === "incoming" ? "received" : "sent",
        lead_id: leadId,
        timestamp: new Date(data.timestamp).toISOString(),
        raw_payload: data,
      },
      { onConflict: "external_id,channel,organization_id" }
    );

  if (insertError) {
    console.error(`[meta-webhook] Error saving message:`, insertError);
  } else {
    console.log(`[meta-webhook] Saved ${data.channel} message ${data.externalId} (${direction})`);
  }
}

// ── Lead Ads Processing ──────────────────────────────────────────────────

async function processLeadgen(
  supabase: ReturnType<typeof createClient>,
  pageId: string,
  leadgenId: string
) {
  console.log(`[meta-webhook] Processing leadgen ${leadgenId} for page ${pageId}`);

  // Buscar pagina para obter token e org
  const { data: page, error: pageError } = await supabase
    .from("meta_pages")
    .select("organization_id, page_access_token, id")
    .eq("page_id", pageId)
    .eq("is_active", true)
    .single();

  if (pageError || !page) {
    console.error(`[meta-webhook] Page not found for leadgen:`, pageError);
    return;
  }

  // Buscar dados do lead via Graph API
  let leadData;
  try {
    leadData = await getLeadgenData(leadgenId, page.page_access_token);
  } catch (err) {
    console.error(`[meta-webhook] Error fetching leadgen data:`, err);
    return;
  }

  // Extrair campos do formulario
  const fields: Record<string, string> = {};
  for (const field of leadData.field_data || []) {
    fields[field.name] = field.values?.[0] || "";
  }

  const name = fields.full_name || fields.first_name
    ? `${fields.first_name || ""} ${fields.last_name || ""}`.trim()
    : fields.full_name || "Lead Meta Ads";
  const email = fields.email || null;
  const phone = fields.phone_number || fields.phone || null;

  // Verificar se lead ja existe (por email ou telefone)
  let existingLeadId: string | null = null;

  if (phone) {
    const normalizedPhone = phone.replace(/\D/g, "").slice(-10);
    const { data: existingLead } = await supabase
      .from("leads")
      .select("id")
      .eq("organization_id", page.organization_id)
      .like("phone", `%${normalizedPhone}`)
      .limit(1)
      .single();

    if (existingLead) existingLeadId = existingLead.id;
  }

  if (!existingLeadId && email) {
    const { data: existingLead } = await supabase
      .from("leads")
      .select("id")
      .eq("organization_id", page.organization_id)
      .eq("email", email)
      .limit(1)
      .single();

    if (existingLead) existingLeadId = existingLead.id;
  }

  if (existingLeadId) {
    console.log(`[meta-webhook] Lead already exists: ${existingLeadId}`);
    // Atualizar dados se necessario
    await supabase
      .from("leads")
      .update({
        ...(phone && !email ? {} : {}),
        metadata: { ...fields, leadgen_id: leadgenId, form_id: leadData.form_id },
      })
      .eq("id", existingLeadId);
    return;
  }

  // Criar novo lead
  const { data: newLead, error: leadError } = await supabase
    .from("leads")
    .insert({
      organization_id: page.organization_id,
      name,
      email,
      phone,
      origin: "meta_ads",
      metadata: { ...fields, leadgen_id: leadgenId, form_id: leadData.form_id },
    })
    .select("id")
    .single();

  if (leadError) {
    console.error(`[meta-webhook] Error creating lead:`, leadError);
    return;
  }

  console.log(`[meta-webhook] Created lead ${newLead.id} from leadgen ${leadgenId}`);

  // Verificar configs de leadgen para acoes pos-captura
  const { data: configs } = await supabase
    .from("meta_leadgen_configs")
    .select("*")
    .eq("meta_page_id", page.id)
    .eq("is_active", true)
    .or(`form_id.eq.${leadData.form_id},form_id.is.null`);

  if (configs?.length) {
    const config = configs.find((c) => c.form_id === leadData.form_id) || configs[0];

    // Aplicar tags automaticas
    if (config.auto_tag?.length) {
      for (const tagName of config.auto_tag) {
        const { data: tag } = await supabase
          .from("tags")
          .select("id")
          .eq("organization_id", page.organization_id)
          .eq("name", tagName)
          .single();

        if (tag) {
          await supabase.from("lead_tags").upsert(
            { lead_id: newLead.id, tag_id: tag.id },
            { onConflict: "lead_id,tag_id" }
          );
        }
      }
    }

    // Vincular a campanha
    if (config.assign_to_campaign_id) {
      await supabase.from("campanha_leads").insert({
        campanha_id: config.assign_to_campaign_id,
        lead_id: newLead.id,
        stage: "novo",
      });
    }
  }
}
