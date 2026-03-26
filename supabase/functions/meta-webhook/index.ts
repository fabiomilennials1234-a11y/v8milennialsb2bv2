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
import { getCampaignResponsibleAssignment } from "../_shared/campaign-distribution.ts";

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

    await logRuntime({
      module: "webhook",
      action: "meta_process",
      status: "success",
      payloadSnapshot: { object: payload.object, entries: payload.entry?.length || 0 },
    });

    // Meta espera 200 rapido para nao reenviar
    return new Response("OK", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}));

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
