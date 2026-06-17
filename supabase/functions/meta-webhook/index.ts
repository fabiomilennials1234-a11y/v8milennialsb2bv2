import { withSentry } from '../_shared/sentry.ts';
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
import { logRuntime } from "../_shared/logger.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getCampaignResponsibleAssignment } from "../_shared/campaign-distribution.ts";
import { timingSafeCompare } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_WEBHOOK_VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN")!;

Deno.serve(withSentry('meta-webhook', async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── GET: Webhook verification ──────────────────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token && timingSafeCompare(token, META_WEBHOOK_VERIFY_TOKEN)) {
      console.log("[meta-webhook] Webhook verified successfully");
      return new Response(challenge, { status: 200, headers: withSecurityHeaders({}) });
    }

    console.error("[meta-webhook] Verification failed - invalid token");
    return new Response("Forbidden", { status: 403, headers: withSecurityHeaders({}) });
  }

  // ── POST: Webhook events ───────────────────────────────────────────────
  if (req.method === "POST") {
    const body = await req.text();

    // Verificar assinatura HMAC
    const signature = req.headers.get("x-hub-signature-256");
    if (!verifyWebhookSignature(body, signature)) {
      console.error("[meta-webhook] Invalid signature");
      return new Response("Unauthorized", { status: 401, headers: withSecurityHeaders({}) });
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Bad Request", { status: 400, headers: withSecurityHeaders({}) });
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
        } else if (payload.object === "whatsapp_business_account") {
          // WhatsApp Cloud API — SLICE 4. Inbound lands in whatsapp_messages
          // (the live chat surface), NOT channel_messages. See
          // docs/meta-cloud-cert/CERTIFICATION.md §5 + rules 8/11.
          await processWhatsAppCloudEntry(supabase, entry as WhatsAppCloudEntry);
        }
      } catch (err) {
        console.error(`[meta-webhook] Error processing entry ${entry.id}:`, err);
      }
    }

    await logRuntime({
      module: "webhook",
      action: "meta_process",
      status: "success",
      payloadSnapshot: { object: payload.object, entries: payload.entry?.length || 0 },
    });

    // Meta espera 200 rapido para nao reenviar
    return new Response("OK", { status: 200, headers: withSecurityHeaders({}) });
  }

  return new Response("Method Not Allowed", { status: 405, headers: withSecurityHeaders({}) });
}));

// ── Types ──────────────────────────────────────────────────────────────────

interface WebhookPayload {
  object: "page" | "instagram" | "whatsapp_business_account";
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

// Campos do lead que podem ser mapeados via field_mappings
const MAPPABLE_LEAD_FIELDS = new Set([
  "name", "email", "phone", "company", "segment", "urgency",
  "faturamento", "notes", "utm_campaign", "utm_source", "utm_medium",
  "utm_content", "utm_term", "meta_campaign_id", "meta_adset_id", "meta_ad_id",
]);

interface FieldMapping {
  meta_field: string;
  lead_field: string;
}

/**
 * Aplica field_mappings para extrair dados do formulario Meta para campos do lead.
 * Fallback para mapeamento padrao se nao houver mappings configurados.
 */
function applyFieldMappings(
  formFields: Record<string, string>,
  mappings: FieldMapping[] | null | undefined
): Record<string, string | null> {
  const leadData: Record<string, string | null> = {};

  if (mappings && mappings.length > 0) {
    // Usar mapeamentos configurados pelo usuario
    for (const mapping of mappings) {
      if (MAPPABLE_LEAD_FIELDS.has(mapping.lead_field) && formFields[mapping.meta_field]) {
        leadData[mapping.lead_field] = formFields[mapping.meta_field];
      }
    }
  }

  // Fallback: campos essenciais se nao foram mapeados
  if (!leadData.name) {
    leadData.name = formFields.full_name
      || (formFields.first_name
        ? `${formFields.first_name} ${formFields.last_name || ""}`.trim()
        : null)
      || "Lead Meta Ads";
  }
  if (!leadData.email) {
    leadData.email = formFields.email || null;
  }
  if (!leadData.phone) {
    leadData.phone = formFields.phone_number || formFields.phone || null;
  }
  if (!leadData.company) {
    leadData.company = formFields.company_name || formFields.company || null;
  }

  return leadData;
}

// ── UTM Enrichment (Milennials only) ─────────────────────────────────────

const MILENNIALS_ORG_ID = Deno.env.get("MILENNIALS_ORG_ID") || "";
const META_ADS_ACCESS_TOKEN_ENV = Deno.env.get("META_ADS_ACCESS_TOKEN") || "";
const GRAPH_API_VERSION_UTM = "v21.0";

/**
 * Attempts to fetch campaign/adset/ad names from Meta Graph API
 * for a given leadgen event. Returns UTM fields to merge into the lead.
 * NEVER throws — returns empty object on any failure.
 */
async function enrichUtmFromLeadgen(
  leadgenId: string
): Promise<Record<string, string>> {
  try {
    if (!META_ADS_ACCESS_TOKEN_ENV) return {};

    // Step 1: Get ad_id from leadgen
    const leadgenRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION_UTM}/${leadgenId}?fields=ad_id&access_token=${META_ADS_ACCESS_TOKEN_ENV}`
    );
    const leadgenJson = await leadgenRes.json();
    const adId = leadgenJson?.ad_id;
    if (!adId) return {};

    // Step 2: Get campaign/adset/ad hierarchy from ad
    const adRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION_UTM}/${adId}?fields=name,adset{id,name},campaign{id,name}&access_token=${META_ADS_ACCESS_TOKEN_ENV}`
    );
    const adJson = await adRes.json();
    if (adJson.error) return {};

    return {
      utm_source: "facebook",
      utm_medium: "paid",
      utm_campaign: adJson.campaign?.name || "",
      utm_content: adJson.adset?.name || "",
      utm_term: adJson.name || "",
      meta_campaign_id: adJson.campaign?.id || "",
      meta_adset_id: adJson.adset?.id || "",
      meta_ad_id: adId,
    };
  } catch (err) {
    console.warn(`[meta-webhook] UTM enrichment failed (non-fatal):`, err);
    return {};
  }
}

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
  const formFields: Record<string, string> = {};
  for (const field of leadData.field_data || []) {
    formFields[field.name] = field.values?.[0] || "";
  }

  // Buscar config de leadgen (com field_mappings)
  const { data: configs } = await supabase
    .from("meta_leadgen_configs")
    .select("*")
    .eq("meta_page_id", page.id)
    .eq("is_active", true)
    .or(`form_id.eq.${leadData.form_id},form_id.is.null`);

  const config = configs?.length
    ? configs.find((c: { form_id: string | null }) => c.form_id === leadData.form_id) || configs[0]
    : null;

  // Aplicar mapeamento de campos
  const mappedFields = applyFieldMappings(
    formFields,
    config?.field_mappings as FieldMapping[] | null
  );

  const name = mappedFields.name || "Lead Meta Ads";
  const email = mappedFields.email || null;
  const phone = mappedFields.phone || null;

  // ── UTM Enrichment (Milennials org only, never blocks lead creation) ──
  let utmFields: Record<string, string> = {};
  if (page.organization_id === MILENNIALS_ORG_ID && MILENNIALS_ORG_ID) {
    utmFields = await enrichUtmFromLeadgen(leadgenId);
  }

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
    console.log(`[meta-webhook] Lead already exists: ${existingLeadId}, updating...`);
    // Atualizar com campos mapeados
    const updateData: Record<string, unknown> = {
      metadata: { ...formFields, leadgen_id: leadgenId, form_id: leadData.form_id },
    };
    // Atualizar campos mapeados no lead existente (exceto name que pode ter sido editado)
    if (email) updateData.email = email;
    if (phone) updateData.phone = phone;
    if (mappedFields.company) updateData.company = mappedFields.company;
    if (mappedFields.segment) updateData.segment = mappedFields.segment;
    if (mappedFields.notes) updateData.notes = mappedFields.notes;

    // Apply UTM enrichment fields (only if not already set on lead)
    for (const [key, value] of Object.entries(utmFields)) {
      if (value && !mappedFields[key]) {
        updateData[key] = value;
      }
    }

    await supabase.from("leads").update(updateData).eq("id", existingLeadId);
    return;
  }

  // Montar objeto do novo lead com todos os campos mapeados
  const newLeadData: Record<string, unknown> = {
    organization_id: page.organization_id,
    name,
    email,
    phone,
    origin: "meta_ads",
    metadata: { ...formFields, leadgen_id: leadgenId, form_id: leadData.form_id },
  };

  // Apply UTM enrichment fields (only if not already set via field_mappings)
  for (const [key, value] of Object.entries(utmFields)) {
    if (value && !mappedFields[key]) {
      newLeadData[key] = value;
    }
  }

  // Adicionar campos extras mapeados
  for (const [field, value] of Object.entries(mappedFields)) {
    if (value && !["name", "email", "phone"].includes(field) && MAPPABLE_LEAD_FIELDS.has(field)) {
      newLeadData[field] = value;
    }
  }

  // Criar novo lead
  const { data: newLead, error: leadError } = await supabase
    .from("leads")
    .insert(newLeadData)
    .select("id")
    .single();

  if (leadError) {
    console.error(`[meta-webhook] Error creating lead:`, leadError);
    return;
  }

  console.log(`[meta-webhook] Created lead ${newLead.id} from leadgen ${leadgenId}`);

  // Aplicar acoes pos-captura do config
  if (config) {
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

    // Vincular a campanha com distribuição automática
    if (config.assign_to_campaign_id) {
      const campaignId = config.assign_to_campaign_id;

      // Buscar primeiro stage da campanha para usar como stage_id
      const { data: firstStage } = await supabase
        .from("campanha_stages")
        .select("id")
        .eq("campanha_id", campaignId)
        .order("position", { ascending: true })
        .limit(1)
        .single();

      if (!firstStage) {
        console.warn(`[meta-webhook] Campaign ${campaignId} has no stages, skipping campaign placement`);
      } else {
        // Auto-distribuir SDR via round-robin RPC
        const sdrId = await getCampaignResponsibleAssignment(supabase, campaignId);

        // Auto-distribuir Closer via RPC
        let closerId: string | null = null;
        const { data: nextCloserId } = await supabase.rpc("get_next_campaign_closer", {
          p_campaign_id: campaignId,
        });
        if (nextCloserId) closerId = nextCloserId;

        const responsibleId = closerId || sdrId;

        const insertPayload: Record<string, unknown> = {
          campanha_id: campaignId,
          lead_id: newLead.id,
          stage_id: firstStage.id,
          sdr_id: sdrId,
          closer_id: closerId,
          responsible_id: responsibleId,
          pre_sale_responsible_id: sdrId,
          sale_responsible_id: closerId,
        };

        const { error: clInsertErr } = await supabase.from("campanha_leads").insert(insertPayload);
        if (clInsertErr) {
          console.error(`[meta-webhook] campanha_leads insert failed:`, clInsertErr);
        } else {
          // Update lead-level assignment
          if (responsibleId) {
            const leadAssign: Record<string, unknown> = { responsible_id: responsibleId };
            if (sdrId) leadAssign.sdr_id = sdrId;
            if (closerId) leadAssign.closer_id = closerId;
            if (sdrId) leadAssign.pre_sale_responsible_id = sdrId;
            if (closerId) leadAssign.sale_responsible_id = closerId;
            await supabase.from("leads").update(leadAssign).eq("id", newLead.id);
          }
          console.log(`[meta-webhook] Lead ${newLead.id} placed in campaign ${campaignId}, responsible: ${responsibleId}`);
        }
      }
    }

    // Inserir no pipe
    if (config.assign_to_pipe) {
      const pipeTable = `pipe_${config.assign_to_pipe}`;
      const stage = config.assign_to_stage || "novo";

      try {
        await supabase.from(pipeTable).insert({
          organization_id: page.organization_id,
          lead_id: newLead.id,
          status: stage,
        });
        console.log(`[meta-webhook] Lead ${newLead.id} added to ${pipeTable} stage ${stage}`);
      } catch (pipeErr) {
        console.error(`[meta-webhook] Error adding to ${pipeTable}:`, pipeErr);
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 4 — WhatsApp Cloud API inbound
//
// Locked decisions (docs/meta-cloud-cert/CERTIFICATION.md §5 + rules 8/11):
//  - Inbound lands in `whatsapp_messages` (the live chat surface), NOT
//    channel_messages. Resolution requires a provisioned phone_number_id →
//    whatsapp_instances(provider='meta_cloud') row.
//  - The REAL Meta `wamid` is the `message_id` so status callbacks
//    (sent/delivered/read/failed) update the right row.
//  - Per-WABA binding (Rule 11): trust ONLY a provisioned
//    whatsapp_instance_secrets.meta_phone_number_id mapping. Reject inbound with
//    no matching active instance — never trust an arbitrary payload id.
//  - Always return 200 (handled by the POST handler). Unresolved phone_number_id
//    is logged, never 5xx — prevents Meta retry storms.
//  - Media (image/audio/video/document) arrives as a Cloud media_id, NOT a URL.
//    We store the id; the authenticated /<media-id> download is a later slice.
// ════════════════════════════════════════════════════════════════════════════

// ── WA Cloud webhook types ──────────────────────────────────────────────────

interface WhatsAppCloudEntry {
  id: string; // WABA id
  changes?: WhatsAppCloudChange[];
}

interface WhatsAppCloudChange {
  field: string; // "messages" for inbound + statuses
  value: WhatsAppCloudValue;
}

interface WhatsAppCloudValue {
  messaging_product?: string; // "whatsapp"
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: Array<{
    wa_id?: string;
    profile?: { name?: string };
  }>;
  messages?: WhatsAppCloudMessage[];
  statuses?: WhatsAppCloudStatus[];
}

interface WhatsAppCloudMessage {
  id: string; // wamid
  from: string; // sender phone (no @ suffix)
  timestamp: string; // epoch seconds (string)
  type: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  video?: { id?: string; caption?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  voice?: { id?: string; mime_type?: string };
  document?: { id?: string; caption?: string; filename?: string; mime_type?: string };
  sticker?: { id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string } }>;
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  reaction?: { message_id?: string; emoji?: string };
  context?: { from?: string; id?: string };
  errors?: Array<{ code?: number; title?: string }>;
}

interface WhatsAppCloudStatus {
  id: string; // wamid the status refers to
  status: string; // sent | delivered | read | failed
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string }>;
}

export interface MetaCloudResolvedInstance {
  instance_id: string;
  organization_id: string;
}

// WA Cloud → whatsapp_messages.message_type (mirrors the Uazapi MESSAGE_TYPE_MAP
// vocabulary used by the live chat + copilot).
const WA_CLOUD_TYPE_MAP: Record<string, string> = {
  text: "text",
  image: "image",
  video: "video",
  audio: "audio",
  voice: "ptt",
  document: "document",
  sticker: "sticker",
  location: "location",
  contacts: "contact",
  button: "buttonResponse",
  interactive: "buttonResponse",
  reaction: "reaction",
  order: "order",
  system: "system",
  unknown: "unknown",
  unsupported: "unknown",
};

/**
 * Maps a single WA Cloud media-bearing message to the (type, content, mediaId)
 * triple. WA Cloud sends a `media_id`, NOT a downloadable URL — we store the id
 * in media_url and let a later slice perform the authenticated download.
 * Pure + exported for unit testing.
 */
export function normalizeCloudMessage(
  msg: WhatsAppCloudMessage,
  contactName: string | null,
): {
  message_id: string;
  phone_number: string;
  message_type: string;
  content: string | null;
  media_url: string | null;
  push_name: string | null;
  timestamp: string;
} {
  const messageType = WA_CLOUD_TYPE_MAP[msg.type] ?? msg.type ?? "unknown";

  let content: string | null = null;
  let mediaId: string | null = null;

  switch (msg.type) {
    case "text":
      content = msg.text?.body ?? null;
      break;
    case "image":
      mediaId = msg.image?.id ?? null;
      content = msg.image?.caption ?? null;
      break;
    case "video":
      mediaId = msg.video?.id ?? null;
      content = msg.video?.caption ?? null;
      break;
    case "audio":
      mediaId = msg.audio?.id ?? null;
      break;
    case "voice":
      mediaId = msg.voice?.id ?? null;
      break;
    case "document":
      mediaId = msg.document?.id ?? null;
      content = msg.document?.caption ?? msg.document?.filename ?? null;
      break;
    case "sticker":
      mediaId = msg.sticker?.id ?? null;
      break;
    case "location": {
      const lat = msg.location?.latitude;
      const lng = msg.location?.longitude;
      if (lat != null && lng != null) content = `📍 ${lat}, ${lng}`;
      break;
    }
    case "contacts": {
      const name = msg.contacts?.[0]?.name?.formatted_name;
      content = name ? `👤 ${name}` : "👤 Contato compartilhado";
      break;
    }
    case "button":
      // Template quick-reply button tap.
      content = msg.button?.text ?? msg.button?.payload ?? null;
      break;
    case "interactive":
      content =
        msg.interactive?.button_reply?.title ??
        msg.interactive?.list_reply?.title ??
        msg.interactive?.button_reply?.id ??
        msg.interactive?.list_reply?.id ??
        null;
      break;
    case "reaction":
      content = msg.reaction?.emoji ?? null;
      break;
    default:
      content = null;
  }

  // epoch seconds (string) → ISO. Fall back to now on a malformed timestamp.
  const tsSeconds = Number(msg.timestamp);
  const timestamp = Number.isFinite(tsSeconds) && tsSeconds > 0
    ? new Date(tsSeconds * 1000).toISOString()
    : new Date().toISOString();

  return {
    message_id: msg.id,
    phone_number: msg.from,
    message_type: messageType,
    content,
    media_url: mediaId, // Cloud media_id — download deferred to a later slice.
    push_name: contactName,
    timestamp,
  };
}

/**
 * Per-WABA binding (Rule 11). Resolves the provisioned org/instance for a
 * Cloud phone_number_id strictly via whatsapp_instance_secrets.meta_phone_number_id
 * → whatsapp_instances (provider='meta_cloud', is_active). Returns null when no
 * provisioned active row exists — the caller logs + drops (still 200). NEVER
 * trusts an arbitrary payload id.
 */
async function resolveMetaCloudInstance(
  supabase: ReturnType<typeof createClient>,
  phoneNumberId: string,
): Promise<MetaCloudResolvedInstance | null> {
  if (!phoneNumberId) return null;

  const { data: secret, error: secretErr } = await supabase
    .from("whatsapp_instance_secrets")
    .select("instance_id, organization_id")
    .eq("meta_phone_number_id", phoneNumberId)
    .maybeSingle();

  if (secretErr || !secret?.instance_id) return null;

  // Confirm a live meta_cloud instance still backs this mapping (the secrets row
  // could outlive a deactivated/repurposed instance). Trust only an active
  // provider='meta_cloud' row.
  const { data: inst, error: instErr } = await supabase
    .from("whatsapp_instances")
    .select("id, organization_id, provider, is_active")
    .eq("id", secret.instance_id)
    .eq("provider", "meta_cloud")
    .maybeSingle();

  if (instErr || !inst) return null;
  if ((inst as { is_active?: boolean }).is_active === false) return null;

  return {
    instance_id: inst.id as string,
    organization_id: (inst.organization_id ?? secret.organization_id) as string,
  };
}

/**
 * Persists one inbound Cloud message into whatsapp_messages using the idempotent
 * webhook upsert contract (onConflict message_id,instance_id +
 * ignoreDuplicates:true). The real wamid is the message_id so status callbacks
 * land on this row.
 */
async function persistCloudMessage(
  supabase: ReturnType<typeof createClient>,
  resolved: MetaCloudResolvedInstance,
  msg: WhatsAppCloudMessage,
  contactName: string | null,
): Promise<void> {
  const n = normalizeCloudMessage(msg, contactName);
  if (!n.message_id || !n.phone_number) {
    console.error(
      `[meta-webhook] Cloud message missing id/from; dropping (instance ${resolved.instance_id})`,
    );
    return;
  }

  // Idempotent webhook upsert — global write contract
  // (tests/unit/whatsapp-messages-idempotency-contract.test.ts). Inbound is an
  // echo-safe write: never overwrite a first row (ignoreDuplicates:true).
  const { error } = await supabase
    .from("whatsapp_messages")
    .upsert(
      {
        organization_id: resolved.organization_id,
        instance_id: resolved.instance_id,
        message_id: n.message_id, // real wamid → status callbacks land here
        remote_jid: `${n.phone_number}@s.whatsapp.net`,
        phone_number: n.phone_number,
        direction: "incoming",
        message_type: n.message_type,
        content: n.content,
        media_url: n.media_url, // Cloud media_id (download deferred)
        push_name: n.push_name,
        status: "received",
        timestamp: n.timestamp,
        raw_payload: msg as unknown as Record<string, unknown>,
        received_via: "webhook",
      },
      { onConflict: "message_id,instance_id", ignoreDuplicates: true },
    );

  if (error) {
    console.error(`[meta-webhook] Cloud message upsert failed:`, error.message);
    await logRuntime({
      organizationId: resolved.organization_id,
      module: "webhook",
      action: "meta_cloud_message_upsert_error",
      status: "error",
      payloadSnapshot: {
        instance_id: resolved.instance_id,
        message_id: n.message_id,
        error: error.message,
      },
    });
    return;
  }

  console.log(
    `[meta-webhook] Saved WA Cloud inbound ${n.message_id} (${n.message_type}) for instance ${resolved.instance_id}`,
  );
}

/**
 * Reflects a WA Cloud delivery status (sent/delivered/read/failed) onto the
 * matching outbound whatsapp_messages row, keyed by the real wamid. No-op if the
 * status is unknown or the row hasn't been written yet (echo ordering tolerated).
 */
async function applyCloudStatus(
  supabase: ReturnType<typeof createClient>,
  resolved: MetaCloudResolvedInstance,
  status: WhatsAppCloudStatus,
): Promise<void> {
  const wamid = status.id;
  const mapped = String(status.status ?? "").toLowerCase();
  const ALLOWED = new Set(["sent", "delivered", "read", "failed"]);
  if (!wamid || !ALLOWED.has(mapped)) return;

  await supabase
    .from("whatsapp_messages")
    .update({ status: mapped })
    .eq("message_id", wamid)
    .eq("instance_id", resolved.instance_id);
}

/**
 * Processes one WA Cloud `entry`: iterates its `changes[]` where
 * field === 'messages', resolves the provisioned instance per change (each
 * change carries its own metadata.phone_number_id), then persists inbound
 * messages and applies status updates. Exported for unit testing.
 */
export async function processWhatsAppCloudEntry(
  supabase: ReturnType<typeof createClient>,
  entry: WhatsAppCloudEntry,
): Promise<void> {
  for (const change of entry.changes ?? []) {
    if (change.field !== "messages") continue;

    const value = change.value ?? {};
    const phoneNumberId = value.metadata?.phone_number_id ?? "";

    const resolved = await resolveMetaCloudInstance(supabase, phoneNumberId);
    if (!resolved) {
      // Rule 11: unprovisioned phone_number_id is rejected (logged + dropped).
      // Returning 200 is the caller's job — never 5xx (Meta retry storm).
      console.warn(
        `[meta-webhook] WA Cloud inbound for unprovisioned phone_number_id ${phoneNumberId} — dropping`,
      );
      await logRuntime({
        module: "webhook",
        action: "meta_cloud_unprovisioned_phone_number_id",
        status: "error",
        payloadSnapshot: {
          waba_id: entry.id,
          phone_number_id: phoneNumberId,
          messages: value.messages?.length ?? 0,
          statuses: value.statuses?.length ?? 0,
        },
      });
      continue;
    }

    // Contact push_name map keyed by wa_id (Cloud sends it in value.contacts[]).
    const nameByWaId = new Map<string, string>();
    for (const c of value.contacts ?? []) {
      if (c.wa_id && c.profile?.name) nameByWaId.set(c.wa_id, c.profile.name);
    }

    // Inbound messages
    for (const msg of value.messages ?? []) {
      const contactName = nameByWaId.get(msg.from) ?? null;
      await persistCloudMessage(supabase, resolved, msg, contactName);
    }

    // Delivery / read / failure statuses
    for (const status of value.statuses ?? []) {
      await applyCloudStatus(supabase, resolved, status);
    }
  }
}
