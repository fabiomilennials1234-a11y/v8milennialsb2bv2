/**
 * Workflow Action Handler — implements all 30 workflow action types
 *
 * Each handler returns { success, message?, error?, data? }.
 * On success, logs to lead_history with source: 'automation'.
 * Uses existing shared modules (outbound-sender, audio-sender, etc.)
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendAudioViaProvider } from "./audio-sender.ts";
import { getWhatsAppProvider } from "./whatsapp-client.ts";
import { getTimeBasedVariables } from "./time-variables.ts";
import { getPipeEntry, upsertPipeEntry, updatePipeEntryById, deletePipeEntry } from "./pipeline-adapter.ts";

export interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: Record<string, unknown>;
}

interface ActionContext {
  supabase: SupabaseClient;
  organizationId: string;
  leadId: string;
  nodeData: Record<string, unknown>;
  executionContext: Record<string, unknown>;
}

// ─── Variable substitution ──────────────────────────────────────────────────

async function resolveVariables(
  supabase: SupabaseClient,
  leadId: string,
  template: string,
  executionContext?: Record<string, unknown>,
): Promise<string> {
  if (!template || !template.includes("{{")) return template;

  // First pass: resolve execution context variables (e.g., {{ai_message}} from previous nodes)
  if (executionContext) {
    for (const [key, val] of Object.entries(executionContext)) {
      if (val !== null && val !== undefined && typeof val !== "object") {
        template = template.replaceAll(`{{${key}}}`, String(val));
      }
    }
    // If all variables resolved, return early
    if (!template.includes("{{")) return template;
  }

  const { data: lead } = await supabase
    .from("leads")
    .select(
      "name, company, email, phone, pipe_whatsapp, qualification_score, rating, " +
      "sdr_id, closer_id, responsible_id, organization_id, " +
      "faturamento, segment, urgency, notes, origin",
    )
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return template;

  let result = template;

  // Standard variables
  const vars: Record<string, string> = {
    nome:       lead.name || "",
    empresa:    lead.company || "",
    email:      lead.email || "",
    telefone:   lead.phone || "",
    estagio:    lead.pipe_whatsapp || "",
    score:      String(lead.qualification_score ?? ""),
    rating:     String(lead.rating ?? ""),
    faturamento: String(lead.faturamento ?? ""),
    segmento:   lead.segment || "",
    urgencia:   lead.urgency || "",
    observacoes: lead.notes || "",
    origem:     lead.origin || "",
  };

  // Sistema: saudacao, data_hoje, hora_atual — resolved at send time with correct timezone
  if (template.includes("{{saudacao}}") || template.includes("{{data_hoje}}") || template.includes("{{hora_atual}}")) {
    const timeVars = getTimeBasedVariables();
    vars.saudacao = timeVars.saudacao;
    vars.data_hoje = timeVars.data;
    vars.hora_atual = timeVars.hora;
  }

  // SDR name (legado)
  if (template.includes("{{sdr}}") && lead.sdr_id) {
    const { data: member } = await supabase
      .from("team_members")
      .select("name")
      .eq("id", lead.sdr_id)
      .maybeSingle();
    vars.sdr = member?.name || "";
  }
  // Closer name (legado)
  if (template.includes("{{closer}}") && lead.closer_id) {
    const { data: member } = await supabase
      .from("team_members")
      .select("name")
      .eq("id", lead.closer_id)
      .maybeSingle();
    vars.closer = member?.name || "";
  }
  // Responsável (unified) — name and phone
  if (
    (template.includes("{{responsavel}}") ||
      template.includes("{{responsavel_telefone}}")) &&
    lead.responsible_id
  ) {
    const { data: member } = await supabase
      .from("team_members")
      .select("name, phone")
      .eq("id", lead.responsible_id)
      .maybeSingle();
    vars.responsavel = (member as { name?: string; phone?: string })?.name || "";
    vars.responsavel_telefone = (member as { name?: string; phone?: string })?.phone || "";
  }

  // Nome da empresa do CRM (organizations.name)
  if (template.includes("{{nome_empresa_crm}}") && lead.organization_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", lead.organization_id)
      .maybeSingle();
    vars.nome_empresa_crm = org?.name || "";
  }

  // Data da reunião (pipeline_entries confirmacao → metadata.meeting_date)
  if (template.includes("{{data_reuniao}}")) {
    const confEntry = await getPipeEntry(supabase, leadId, lead.organization_id, "confirmacao");
    const rawDate = (confEntry?.metadata as Record<string, unknown>)?.meeting_date as string | undefined;
    vars.data_reuniao = rawDate
      ? new Date(rawDate).toLocaleDateString("pt-BR")
      : "";
  }

  // Valor da proposta (pipeline_entries propostas → metadata.sale_value)
  if (template.includes("{{valor_proposta}}")) {
    const propEntry = await getPipeEntry(supabase, leadId, lead.organization_id, "propostas");
    const saleValue = (propEntry?.metadata as Record<string, unknown>)?.sale_value as number | undefined;
    vars.valor_proposta = saleValue != null
      ? new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(saleValue)
      : "";
  }

  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }

  // Campaign variables: {{campanha_nome}}, {{campanha_estagio}}
  if (template.includes("{{campanha_nome}}") || template.includes("{{campanha_estagio}}")) {
    const { data: campLead } = await supabase
      .from("campanha_leads")
      .select("campanha_id, stage_id, campanhas(name), campanha_stages(name)")
      .eq("lead_id", leadId)
      .limit(1)
      .maybeSingle();
    if (campLead) {
      vars.campanha_nome = (campLead as any).campanhas?.name || "";
      vars.campanha_estagio = (campLead as any).campanha_stages?.name || "";
    }
  }

  // AI variables: {{ai_resumo}}, {{ai_sentimento}}, {{ai_temperatura}}, {{ai_proxima_acao}}
  if (template.includes("{{ai_")) {
    const { data: aiSummary } = await supabase
      .from("conversation_summaries")
      .select("summary, sentiment, lead_temperature, next_action")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (aiSummary) {
      vars.ai_resumo = (aiSummary as any).summary || "";
      vars.ai_sentimento = (aiSummary as any).sentiment || "";
      vars.ai_temperatura = (aiSummary as any).lead_temperature || "";
      vars.ai_proxima_acao = (aiSummary as any).next_action || "";
    }
  }

  // Second pass for late-bound vars (campaign + AI)
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }

  // Custom fields: {{custom.campo}}
  const customMatches = result.match(/\{\{custom\.([^}]+)\}\}/g);
  if (customMatches) {
    const orgId = lead.organization_id;
    for (const match of customMatches) {
      const fieldName = match.replace("{{custom.", "").replace("}}", "");
      let val = "";
      if (orgId) {
        const { data: field } = await supabase
          .from("lead_custom_fields")
          .select("id")
          .eq("organization_id", orgId)
          .eq("field_name", fieldName)
          .maybeSingle();
        if (field) {
          const { data: fv } = await supabase
            .from("lead_custom_field_values")
            .select("value")
            .eq("lead_id", leadId)
            .eq("field_id", field.id)
            .maybeSingle();
          val = fv?.value || "";
        }
      }
      result = result.replaceAll(match, val);
    }
  }

  return result;
}

// ─── WhatsApp helpers ───────────────────────────────────────────────────────

async function getWhatsAppInstance(
  supabase: SupabaseClient,
  organizationId: string,
  instanceId?: string,
): Promise<{ instanceId: string; instanceName: string; instance: any } | null> {
  let resolved: any = null;

  if (instanceId) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("id", instanceId)
      .maybeSingle();
    resolved = data;
  }

  if (!resolved) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("organization_id", organizationId)
      .in("status", ["open", "connected"])
      .limit(1)
      .maybeSingle();
    resolved = data;
  }

  if (!resolved) return null;
  return {
    instanceId: resolved.id,
    instanceName: resolved.instance_name,
    instance: resolved,
  };
}

async function getLeadPhone(supabase: SupabaseClient, leadId: string): Promise<string | null> {
  const { data } = await supabase.from("leads").select("phone").eq("id", leadId).maybeSingle();
  if (!data?.phone) return null;
  let phone = String(data.phone).replace(/\D/g, "");
  if (!phone.startsWith("55")) phone = "55" + phone;
  return phone;
}

// ─── Lead history logger ────────────────────────────────────────────────────

async function logToHistory(
  supabase: SupabaseClient,
  leadId: string,
  organizationId: string,
  action: string,
  description: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from("lead_history").insert({
      lead_id: leadId,
      organization_id: organizationId,
      action,
      description: `Workflow: ${description}`,
      source: "automation",
      metadata: metadata || null,
      created_by: null,
    });
  } catch (err) {
    console.warn("[workflow-action] Failed to log history:", err);
  }
}

// ─── Main Router ────────────────────────────────────────────────────────────

export async function executeWorkflowAction(ctx: ActionContext): Promise<ActionResult> {
  const actionType = ctx.nodeData.actionType as string;

  let result: ActionResult;

  switch (actionType) {
    // ── Communication ──
    case "send_whatsapp":
      result = await handleSendWhatsApp(ctx);
      break;
    case "send_whatsapp_audio":
      result = await handleSendWhatsAppAudio(ctx);
      break;
    case "send_whatsapp_image":
      result = await handleSendWhatsAppImage(ctx);
      break;
    case "send_whatsapp_template":
      result = await handleSendWhatsAppTemplate(ctx);
      break;
    case "send_meta_message":
      result = await handleSendMetaMessage(ctx);
      break;
    case "send_semi_automatic":
      result = await handleSendSemiAutomatic(ctx);
      break;

    // ── Uazapi-only interactive messages ──
    case "send_whatsapp_menu":
      result = await handleSendWhatsAppMenu(ctx);
      break;
    case "send_whatsapp_pix_button":
      result = await handleSendWhatsAppPixButton(ctx);
      break;

    // ── Lead Management ──
    case "move_stage":
      result = await handleMoveStage(ctx);
      break;
    case "add_tag":
      result = await handleAddTag(ctx);
      break;
    case "remove_tag":
      result = await handleRemoveTag(ctx);
      break;
    case "update_lead_field":
      result = await handleUpdateLeadField(ctx);
      break;
    case "update_custom_field":
      result = await handleUpdateCustomField(ctx);
      break;
    case "update_rating":
      result = await handleUpdateRating(ctx);
      break;
    case "calculate_score":
      result = await handleCalculateScore(ctx);
      break;
    case "duplicate_to_pipe":
      result = await handleDuplicateToPipe(ctx);
      break;
    case "remove_from_pipe":
      result = await handleRemoveFromPipe(ctx);
      break;
    case "mark_as_lost":
      result = await handleMarkAsLost(ctx);
      break;

    // ── Campaigns ──
    case "add_to_campaign":
      result = await handleAddToCampaign(ctx);
      break;
    case "remove_from_campaign":
      result = await handleRemoveFromCampaign(ctx);
      break;
    case "move_campaign_stage":
      result = await handleMoveCampaignStage(ctx);
      break;
    case "send_campaign_message":
      result = await handleSendCampaignMessage(ctx);
      break;
    case "pause_campaign_sequence":
      result = await handlePauseCampaignSequence(ctx);
      break;
    case "resume_campaign_sequence":
      result = await handleResumeCampaignSequence(ctx);
      break;

    // ── Calendar ──
    case "create_calendar_event":
      result = await handleCreateCalendarEvent(ctx);
      break;
    case "schedule_meeting":
      result = await handleScheduleMeeting(ctx);
      break;

    // ── TinyERP ──
    case "create_tinyerp_order":
      result = await handleTinyErpOrder(ctx, "tinyerp-push-order");
      break;
    case "create_tinyerp_upsell_order":
      result = await handleTinyErpOrder(ctx, "tinyerp-push-upsell-order");
      break;

    // ── Team ──
    case "assign_responsible":
      result = await handleAssignResponsible(ctx);
      break;
    case "assign_sdr":
      result = await handleAssign(ctx, "sdr");
      break;
    case "assign_closer":
      result = await handleAssign(ctx, "closer");
      break;
    case "notify_team_member":
      result = await handleNotifyTeamMember(ctx);
      break;

    // ── Follow-up ──
    case "create_followup":
      result = await handleCreateFollowup(ctx);
      break;

    // ── AI ──
    case "generate_ai_message":
      result = await handleGenerateAiMessage(ctx);
      break;
    case "summarize_conversation":
      result = await handleInvokeEdgeFunction(ctx, "summarize-conversation");
      // Store AI summary variables in execution context for downstream nodes
      if (result.success && result.data) {
        const d = result.data as Record<string, unknown>;
        if (d.summary) ctx.executionContext.ai_resumo = d.summary;
        if (d.sentiment) ctx.executionContext.ai_sentimento = d.sentiment;
        if (d.lead_temperature) ctx.executionContext.ai_temperatura = d.lead_temperature;
        if (d.next_action) ctx.executionContext.ai_proxima_acao = d.next_action;
      }
      break;
    case "evaluate_conversation":
      result = await handleInvokeEdgeFunction(ctx, "evaluate-agent-conversation");
      break;

    default:
      return { success: false, error: `Unknown action type: ${actionType}` };
  }

  // Log to lead_history on success
  // Skip for stage-related actions — PG triggers (trg_pipe_*_stage_change) handle these
  const STAGE_ACTIONS = ["move_stage", "duplicate_to_pipe", "remove_from_pipe", "mark_as_lost"];
  if (result.success && !STAGE_ACTIONS.includes(actionType)) {
    await logToHistory(
      ctx.supabase,
      ctx.leadId,
      ctx.organizationId,
      actionType,
      result.message || actionType,
      { action_type: actionType, ...(result.data || {}) },
    );
  }

  return result;
}

// ─── Communication Handlers ─────────────────────────────────────────────────

async function handleSendWhatsApp(ctx: ActionContext): Promise<ActionResult> {
  const wa = await getWhatsAppInstance(ctx.supabase, ctx.organizationId, ctx.nodeData.whatsappInstanceId as string);
  if (!wa) return { success: false, error: "WhatsApp instance not available" };

  const phone = await getLeadPhone(ctx.supabase, ctx.leadId);
  if (!phone) return { success: false, error: "Lead has no phone" };

  const template = ctx.nodeData.messageTemplate as string || "";
  const message = await resolveVariables(ctx.supabase, ctx.leadId, template, ctx.executionContext);
  if (!message) return { success: false, error: "Empty message template" };

  const { sendTextViaInstance } = await import("./whatsapp-dispatch.ts");
  const sendResult = await sendTextViaInstance(ctx.supabase, wa.instance, phone, message, {
    trackSource: "workflow-action",
    trackId: ctx.executionId,
  });

  if (!sendResult.success) {
    return { success: false, error: `WhatsApp send failed: ${sendResult.error}` };
  }

  // Use provider's real message ID so the inbound webhook echo UPSERTs this same row
  // instead of creating a duplicate. Preserves sent_by_ai: true.
  const messageId = sendResult.messageId || `wf_${crypto.randomUUID()}`;

  await ctx.supabase.from("whatsapp_messages").upsert({
    organization_id: ctx.organizationId,
    instance_id: wa.instanceId,
    message_id: messageId,
    remote_jid: phone + "@s.whatsapp.net",
    phone_number: phone,
    direction: "outgoing",
    message_type: "conversation",
    content: message,
    timestamp: new Date().toISOString(),
    status: "sent",
    sent_by_ai: true,
  }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });

  return { success: true, message: "WhatsApp text sent" };
}

async function handleSendWhatsAppAudio(ctx: ActionContext): Promise<ActionResult> {
  const wa = await getWhatsAppInstance(ctx.supabase, ctx.organizationId, ctx.nodeData.whatsappInstanceId as string);
  if (!wa) return { success: false, error: "WhatsApp instance not available" };

  const phone = await getLeadPhone(ctx.supabase, ctx.leadId);
  if (!phone) return { success: false, error: "Lead has no phone" };

  const audioUrl = ctx.nodeData.audioUrl as string;
  if (!audioUrl) return { success: false, error: "No audio URL configured" };

  const provider = await getWhatsAppProvider(wa.instance, ctx.supabase);
  const result = await sendAudioViaProvider(provider, phone, audioUrl, {
    trackSource: "workflow-action-audio",
    trackId: (ctx as unknown as { executionId?: string }).executionId,
  });
  if (!result.success) return { success: false, error: result.error || "Audio send failed" };

  const messageId = result.messageId || `wf_${crypto.randomUUID()}`;

  await ctx.supabase.from("whatsapp_messages").upsert({
    organization_id: ctx.organizationId,
    instance_id: wa.instanceId,
    message_id: messageId,
    remote_jid: phone + "@s.whatsapp.net",
    phone_number: phone,
    direction: "outgoing",
    message_type: "audio",
    content: null,
    media_url: audioUrl,
    timestamp: new Date().toISOString(),
    status: "sent",
    sent_by_ai: true,
  }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });

  return { success: true, message: "WhatsApp audio sent" };
}

async function handleSendWhatsAppImage(ctx: ActionContext): Promise<ActionResult> {
  const wa = await getWhatsAppInstance(ctx.supabase, ctx.organizationId, ctx.nodeData.whatsappInstanceId as string);
  if (!wa) return { success: false, error: "WhatsApp instance not available" };

  const phone = await getLeadPhone(ctx.supabase, ctx.leadId);
  if (!phone) return { success: false, error: "Lead has no phone" };

  const imageUrl = ctx.nodeData.imageUrl as string;
  if (!imageUrl) return { success: false, error: "No image URL configured" };

  const caption = ctx.nodeData.imageCaption as string || "";
  const resolvedCaption = await resolveVariables(ctx.supabase, ctx.leadId, caption, ctx.executionContext);

  const { sendMediaViaInstance } = await import("./whatsapp-dispatch.ts");
  const sendResult = await sendMediaViaInstance(
    ctx.supabase,
    wa.instance,
    phone,
    { type: "image", file: imageUrl, caption: resolvedCaption },
    { trackSource: "workflow-action", trackId: ctx.executionId }
  );

  if (!sendResult.success) return { success: false, error: `Image send failed: ${sendResult.error}` };
  return { success: true, message: "WhatsApp image sent" };
}

async function handleSendWhatsAppTemplate(ctx: ActionContext): Promise<ActionResult> {
  const wa = await getWhatsAppInstance(ctx.supabase, ctx.organizationId, ctx.nodeData.whatsappInstanceId as string);
  if (!wa) return { success: false, error: "WhatsApp instance not available" };

  const phone = await getLeadPhone(ctx.supabase, ctx.leadId);
  if (!phone) return { success: false, error: "Lead has no phone" };

  const templateId = ctx.nodeData.templateId as string;
  if (!templateId) return { success: false, error: "No template configured" };

  // Fetch template from DB
  const { data: tpl } = await ctx.supabase
    .from("whatsapp_templates")
    .select("name, content")
    .eq("id", templateId)
    .maybeSingle();

  if (!tpl) return { success: false, error: "Template not found" };

  const message = await resolveVariables(ctx.supabase, ctx.leadId, tpl.content || "", ctx.executionContext);

  const { sendTextViaInstance } = await import("./whatsapp-dispatch.ts");
  const sendResult = await sendTextViaInstance(ctx.supabase, wa.instance, phone, message, {
    trackSource: "workflow-action-template",
    trackId: ctx.executionId,
  });

  if (!sendResult.success) return { success: false, error: `Template send failed: ${sendResult.error}` };
  return { success: true, message: `Template "${tpl.name}" sent` };
}

// ─── Uazapi-only interactive messages ──────────────────────────────────────

async function handleSendWhatsAppMenu(ctx: ActionContext): Promise<ActionResult> {
  const wa = await getWhatsAppInstance(ctx.supabase, ctx.organizationId, ctx.nodeData.whatsappInstanceId as string);
  if (!wa) return { success: false, error: "WhatsApp instance not available" };

  const phone = await getLeadPhone(ctx.supabase, ctx.leadId);
  if (!phone) return { success: false, error: "Lead has no phone" };

  const menuType = (ctx.nodeData.menuType as string) || "button";
  if (!["button", "list", "poll", "carousel"].includes(menuType)) {
    return { success: false, error: `Invalid menuType: ${menuType}` };
  }

  const rawText = (ctx.nodeData.menuText as string) || "";
  const text = await resolveVariables(ctx.supabase, ctx.leadId, rawText, ctx.executionContext);
  if (!text) return { success: false, error: "Empty menu text" };

  const rawChoices = ctx.nodeData.menuChoices as string[] | undefined;
  if (!Array.isArray(rawChoices) || rawChoices.length === 0) {
    return { success: false, error: "Menu requires at least one choice" };
  }
  const choices = await Promise.all(
    rawChoices.map((c) => resolveVariables(ctx.supabase, ctx.leadId, c, ctx.executionContext))
  );

  const footer = ctx.nodeData.menuFooter
    ? await resolveVariables(ctx.supabase, ctx.leadId, ctx.nodeData.menuFooter as string, ctx.executionContext)
    : undefined;

  const { sendMenuViaInstance } = await import("./whatsapp-dispatch.ts");
  const sendResult = await sendMenuViaInstance(
    ctx.supabase,
    wa.instance,
    phone,
    {
      type: menuType as "button" | "list" | "poll" | "carousel",
      text,
      choices,
      footer,
      selectableCount: ctx.nodeData.menuSelectableCount as number | undefined,
    },
    { trackSource: "workflow-action-menu", trackId: ctx.executionId }
  );

  if (!sendResult.success) return { success: false, error: `Menu send failed: ${sendResult.error}` };

  const messageId = sendResult.messageId || `wf_menu_${crypto.randomUUID()}`;
  await ctx.supabase.from("whatsapp_messages").upsert({
    organization_id: ctx.organizationId,
    instance_id: wa.instanceId,
    message_id: messageId,
    remote_jid: `${phone}@s.whatsapp.net`,
    phone_number: phone,
    direction: "outgoing",
    message_type: menuType,
    content: text,
    status: "sent",
    lead_id: ctx.leadId,
    timestamp: new Date().toISOString(),
    sent_by_ai: true,
  }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });

  return { success: true, message: `WhatsApp ${menuType} menu sent` };
}

async function handleSendWhatsAppPixButton(ctx: ActionContext): Promise<ActionResult> {
  const wa = await getWhatsAppInstance(ctx.supabase, ctx.organizationId, ctx.nodeData.whatsappInstanceId as string);
  if (!wa) return { success: false, error: "WhatsApp instance not available" };

  const phone = await getLeadPhone(ctx.supabase, ctx.leadId);
  if (!phone) return { success: false, error: "Lead has no phone" };

  const pixkey = ctx.nodeData.pixkey as string;
  const pixkeyType = ctx.nodeData.pixkeyType as string;
  const amount = Number(ctx.nodeData.pixAmount ?? 0);
  const merchantName = ctx.nodeData.pixMerchantName as string;

  if (!pixkey || !pixkeyType || !merchantName || !(amount > 0)) {
    return { success: false, error: "Missing PIX config (pixkey/pixkeyType/pixAmount/merchantName)" };
  }
  if (!["cpf", "cnpj", "email", "phone", "random"].includes(pixkeyType)) {
    return { success: false, error: `Invalid pixkeyType: ${pixkeyType}` };
  }

  const rawText = (ctx.nodeData.pixText as string) || "";
  const text = rawText
    ? await resolveVariables(ctx.supabase, ctx.leadId, rawText, ctx.executionContext)
    : undefined;

  const { sendPixButtonViaInstance } = await import("./whatsapp-dispatch.ts");
  const sendResult = await sendPixButtonViaInstance(
    ctx.supabase,
    wa.instance,
    phone,
    {
      pixkey,
      pixkeyType: pixkeyType as "cpf" | "cnpj" | "email" | "phone" | "random",
      amount,
      merchantName,
      text,
    },
    { trackSource: "workflow-action-pix", trackId: ctx.executionId }
  );

  if (!sendResult.success) return { success: false, error: `PIX button failed: ${sendResult.error}` };

  const messageId = sendResult.messageId || `wf_pix_${crypto.randomUUID()}`;
  await ctx.supabase.from("whatsapp_messages").upsert({
    organization_id: ctx.organizationId,
    instance_id: wa.instanceId,
    message_id: messageId,
    remote_jid: `${phone}@s.whatsapp.net`,
    phone_number: phone,
    direction: "outgoing",
    message_type: "pix_button",
    content: text || `[PIX R$ ${amount.toFixed(2)}]`,
    status: "sent",
    lead_id: ctx.leadId,
    timestamp: new Date().toISOString(),
    sent_by_ai: true,
  }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });

  return { success: true, message: "PIX button sent" };
}

async function handleSendMetaMessage(ctx: ActionContext): Promise<ActionResult> {
  const channel = ctx.nodeData.metaChannel as string || "instagram";
  const message = ctx.nodeData.metaMessage as string || "";
  const resolved = await resolveVariables(ctx.supabase, ctx.leadId, message, ctx.executionContext);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const res = await fetch(`${supabaseUrl}/functions/v1/send-meta-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      organization_id: ctx.organizationId,
      lead_id: ctx.leadId,
      channel,
      message: resolved,
    }),
  });

  if (!res.ok) return { success: false, error: `Meta message failed: ${await res.text()}` };
  return { success: true, message: `Meta ${channel} message sent` };
}

async function handleSendSemiAutomatic(ctx: ActionContext): Promise<ActionResult> {
  const message = ctx.nodeData.semiAutoMessage as string || "";
  const resolved = await resolveVariables(ctx.supabase, ctx.leadId, message, ctx.executionContext);

  const { error } = await ctx.supabase.from("scheduled_pipe_messages").insert({
    lead_id: ctx.leadId,
    organization_id: ctx.organizationId,
    message_content: resolved,
    status: "waiting_approval",
    approver_id: ctx.nodeData.semiAutoApprover || null,
    source: "workflow",
    scheduled_at: new Date().toISOString(),
  });

  if (error) return { success: false, error: error.message };
  return { success: true, message: "Semi-automatic message queued for approval" };
}

// ─── Lead Management Handlers ───────────────────────────────────────────────

async function handleMoveStage(ctx: ActionContext): Promise<ActionResult> {
  const pipeType = ctx.nodeData.pipeType as string || "whatsapp";
  const targetStage = ctx.nodeData.targetStage as string;
  if (!targetStage) return { success: false, error: "No target stage configured" };

  switch (pipeType) {
    case "whatsapp": {
      await ctx.supabase.from("leads").update({ pipe_whatsapp: targetStage }).eq("id", ctx.leadId);
      await upsertPipeEntry(ctx.supabase, {
        leadId: ctx.leadId, orgId: ctx.organizationId, slug: "whatsapp", stageKey: targetStage,
      });
      break;
    }
    case "confirmacao": {
      await upsertPipeEntry(ctx.supabase, {
        leadId: ctx.leadId, orgId: ctx.organizationId, slug: "confirmacao", stageKey: targetStage,
      });
      break;
    }
    case "propostas": {
      await upsertPipeEntry(ctx.supabase, {
        leadId: ctx.leadId, orgId: ctx.organizationId, slug: "propostas", stageKey: targetStage,
      });
      break;
    }
    case "upsell_base":
      await ctx.supabase.from("upsell_clients").update({ tipo_cliente_tempo: targetStage }).eq("lead_id", ctx.leadId);
      break;
    case "upsell_gestao":
      await ctx.supabase.from("upsell_clients").update({ gestao_stage: targetStage }).eq("lead_id", ctx.leadId);
      break;
    default: {
      // Custom pipeline — pipeType is the custom pipeline UUID
      const customPipelineId = pipeType;

      // targetStage is the custom_pipeline_stages.id
      const { data: stageRow } = await ctx.supabase
        .from("custom_pipeline_stages")
        .select("id, is_final_positive, target_pipeline_id, target_stage_id, target_pipe_type, target_stage_key")
        .eq("id", targetStage)
        .eq("pipeline_id", customPipelineId)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();

      if (!stageRow) {
        return { success: false, error: `Custom stage ${targetStage} not found in pipeline ${customPipelineId}` };
      }

      // Upsert into custom_pipe_entries
      const { data: existingEntry } = await ctx.supabase
        .from("custom_pipe_entries")
        .select("id")
        .eq("lead_id", ctx.leadId)
        .eq("pipeline_id", customPipelineId)
        .maybeSingle();

      if (existingEntry) {
        await ctx.supabase
          .from("custom_pipe_entries")
          .update({ stage_id: targetStage, stage_changed_at: new Date().toISOString() })
          .eq("id", existingEntry.id);
      } else {
        await ctx.supabase.from("custom_pipe_entries").insert({
          lead_id: ctx.leadId,
          organization_id: ctx.organizationId,
          pipeline_id: customPipelineId,
          stage_id: targetStage,
          entered_at: new Date().toISOString(),
          stage_changed_at: new Date().toISOString(),
        });
      }

      // Auto-transition on success stage
      if (stageRow.is_final_positive) {
        if (stageRow.target_pipeline_id && stageRow.target_stage_id) {
          // Transition to another custom pipeline
          const { data: targetEntry } = await ctx.supabase
            .from("custom_pipe_entries").select("id")
            .eq("lead_id", ctx.leadId).eq("pipeline_id", stageRow.target_pipeline_id).maybeSingle();
          if (targetEntry) {
            await ctx.supabase.from("custom_pipe_entries")
              .update({ stage_id: stageRow.target_stage_id, stage_changed_at: new Date().toISOString() })
              .eq("id", targetEntry.id);
          } else {
            await ctx.supabase.from("custom_pipe_entries").insert({
              lead_id: ctx.leadId, organization_id: ctx.organizationId,
              pipeline_id: stageRow.target_pipeline_id, stage_id: stageRow.target_stage_id,
              entered_at: new Date().toISOString(), stage_changed_at: new Date().toISOString(),
            });
          }
        } else if (stageRow.target_pipe_type && stageRow.target_stage_key) {
          // Transition to standard pipeline — reuse handleMoveStage logic
          const transitionPipe = stageRow.target_pipe_type;
          const transitionStage = stageRow.target_stage_key;
          if (transitionPipe === "whatsapp" || transitionPipe === "confirmacao" || transitionPipe === "propostas") {
            if (transitionPipe === "whatsapp") {
              await ctx.supabase.from("leads").update({ pipe_whatsapp: transitionStage }).eq("id", ctx.leadId);
            }
            await upsertPipeEntry(ctx.supabase, {
              leadId: ctx.leadId, orgId: ctx.organizationId, slug: transitionPipe, stageKey: transitionStage,
            });
          } else if (transitionPipe === "upsell_base") {
            await ctx.supabase.from("upsell_clients").update({ tipo_cliente_tempo: transitionStage }).eq("lead_id", ctx.leadId);
          } else if (transitionPipe === "upsell_gestao") {
            await ctx.supabase.from("upsell_clients").update({ gestao_stage: transitionStage }).eq("lead_id", ctx.leadId);
          }
        }
      }
    }
  }

  return { success: true, message: `Moved to ${targetStage} in ${pipeType}`, data: { pipeType, targetStage } };
}

async function handleAddTag(ctx: ActionContext): Promise<ActionResult> {
  const tagName = ctx.nodeData.tagName as string;
  const tagId = ctx.nodeData.tagId as string;

  let resolvedTagId = tagId;
  if (!resolvedTagId && tagName) {
    let { data: tag } = await ctx.supabase.from("tags").select("id")
      .eq("name", tagName).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!tag) {
      const { data: newTag } = await ctx.supabase
        .from("tags").insert({ name: tagName, color: "#6366f1", organization_id: ctx.organizationId }).select("id").single();
      tag = newTag;
    }
    resolvedTagId = tag?.id;
  }
  if (!resolvedTagId) return { success: false, error: "No tag configured" };

  await ctx.supabase.from("lead_tags").upsert(
    { lead_id: ctx.leadId, tag_id: resolvedTagId },
    { onConflict: "lead_id,tag_id", ignoreDuplicates: true },
  );

  return { success: true, message: `Tag "${tagName || tagId}" added` };
}

async function handleRemoveTag(ctx: ActionContext): Promise<ActionResult> {
  const tagId = ctx.nodeData.tagId as string;
  const tagName = ctx.nodeData.tagName as string;

  let resolvedTagId = tagId;
  if (!resolvedTagId && tagName) {
    const { data: tag } = await ctx.supabase.from("tags").select("id")
      .eq("name", tagName).eq("organization_id", ctx.organizationId).maybeSingle();
    resolvedTagId = tag?.id;
  }
  if (!resolvedTagId) return { success: false, error: "Tag not found" };

  await ctx.supabase.from("lead_tags").delete().eq("lead_id", ctx.leadId).eq("tag_id", resolvedTagId);
  return { success: true, message: `Tag "${tagName || tagId}" removed` };
}

async function handleUpdateLeadField(ctx: ActionContext): Promise<ActionResult> {
  const fieldName = ctx.nodeData.fieldName as string;
  const fieldValue = ctx.nodeData.fieldValue as string;
  if (!fieldName) return { success: false, error: "No field name configured" };

  const resolved = await resolveVariables(ctx.supabase, ctx.leadId, fieldValue || "");
  await ctx.supabase.from("leads").update({ [fieldName]: resolved }).eq("id", ctx.leadId);

  return { success: true, message: `Field "${fieldName}" updated`, data: { fieldName, fieldValue: resolved } };
}

async function handleUpdateCustomField(ctx: ActionContext): Promise<ActionResult> {
  const fieldName = ctx.nodeData.customFieldName as string;
  const fieldValue = ctx.nodeData.customFieldValue as string || "";
  if (!fieldName) return { success: false, error: "No custom field name configured" };

  const { data: field } = await ctx.supabase
    .from("lead_custom_fields")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("field_name", fieldName)
    .maybeSingle();

  if (!field) return { success: false, error: `Custom field "${fieldName}" not found` };

  const resolved = await resolveVariables(ctx.supabase, ctx.leadId, fieldValue);

  await ctx.supabase.from("lead_custom_field_values").upsert(
    { lead_id: ctx.leadId, field_id: field.id, value: resolved, updated_at: new Date().toISOString() },
    { onConflict: "lead_id,field_id" },
  );

  return { success: true, message: `Custom field "${fieldName}" updated to "${resolved}"` };
}

async function handleUpdateRating(ctx: ActionContext): Promise<ActionResult> {
  const rating = Number(ctx.nodeData.ratingValue ?? 0);
  const clamped = Math.min(10, Math.max(0, rating));

  await ctx.supabase.from("leads").update({ rating: clamped }).eq("id", ctx.leadId);
  return { success: true, message: `Rating updated to ${clamped}` };
}

async function handleCalculateScore(ctx: ActionContext): Promise<ActionResult> {
  const { error } = await ctx.supabase.from("pending_ai_actions").insert({
    organization_id: ctx.organizationId,
    lead_id: ctx.leadId,
    action_type: "update_qualification_score",
    payload: { source: "workflow" },
    status: "pending",
  });

  if (error) return { success: false, error: error.message };
  return { success: true, message: "Score calculation queued" };
}

async function handleDuplicateToPipe(ctx: ActionContext): Promise<ActionResult> {
  const targetPipeType = ctx.nodeData.targetPipeType as string || "whatsapp";
  const targetPipeStage = ctx.nodeData.targetPipeStage as string || "novo";

  // Copy lead data to target pipe
  const { data: lead } = await ctx.supabase
    .from("leads")
    .select("*")
    .eq("id", ctx.leadId)
    .maybeSingle();

  if (!lead) return { success: false, error: "Lead not found" };

  if (targetPipeType === "whatsapp" || targetPipeType === "confirmacao" || targetPipeType === "propostas") {
    await upsertPipeEntry(ctx.supabase, {
      leadId: ctx.leadId, orgId: ctx.organizationId,
      slug: targetPipeType, stageKey: targetPipeStage,
    });
    if (targetPipeType === "whatsapp") {
      await ctx.supabase.from("leads").update({ pipe_whatsapp: targetPipeStage }).eq("id", ctx.leadId);
    }
  }

  return { success: true, message: `Duplicated to ${targetPipeType}/${targetPipeStage}` };
}

async function handleRemoveFromPipe(ctx: ActionContext): Promise<ActionResult> {
  const pipeType = ctx.nodeData.pipeType as string || "whatsapp";

  if (pipeType === "whatsapp" || pipeType === "confirmacao" || pipeType === "propostas") {
    await deletePipeEntry(ctx.supabase, ctx.leadId, ctx.organizationId, pipeType);
    if (pipeType === "whatsapp") {
      await ctx.supabase.from("leads").update({ pipe_whatsapp: null }).eq("id", ctx.leadId);
    }
  }

  return { success: true, message: `Removed from ${pipeType}` };
}

async function handleMarkAsLost(ctx: ActionContext): Promise<ActionResult> {
  const pipeType = ctx.nodeData.pipeType as string || "propostas";
  const reason = ctx.nodeData.lostReason as string || "";

  if (pipeType === "propostas" || pipeType === "whatsapp" || pipeType === "confirmacao") {
    const entry = await getPipeEntry(ctx.supabase, ctx.leadId, ctx.organizationId, pipeType as "propostas" | "whatsapp" | "confirmacao");
    if (entry) {
      const metaUpdate = pipeType === "propostas" ? { loss_reason_id: reason } : {};
      await updatePipeEntryById(ctx.supabase, entry.id, { stageKey: "perdido", metadata: metaUpdate });
    }
  }

  await logToHistory(ctx.supabase, ctx.leadId, ctx.organizationId, "marked_lost",
    `Marcado como perdido em ${pipeType}: ${reason}`, { pipeType, reason });

  return { success: true, message: `Marked as lost in ${pipeType}` };
}

// ─── Campaign Handlers ──────────────────────────────────────────────────────

async function handleAddToCampaign(ctx: ActionContext): Promise<ActionResult> {
  const campaignId = ctx.nodeData.campaignId as string;
  if (!campaignId) return { success: false, error: "No campaign configured" };

  // Get first stage of campaign
  const { data: firstStage } = await ctx.supabase
    .from("campanha_stages")
    .select("id")
    .eq("campanha_id", campaignId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { error } = await ctx.supabase.from("campanha_leads").upsert(
    {
      campanha_id: campaignId,
      lead_id: ctx.leadId,
      stage_id: firstStage?.id || null,
    },
    { onConflict: "campanha_id,lead_id", ignoreDuplicates: true },
  );

  if (error) return { success: false, error: error.message };
  return { success: true, message: `Added to campaign ${ctx.nodeData.campaignName || campaignId}` };
}

async function handleRemoveFromCampaign(ctx: ActionContext): Promise<ActionResult> {
  const campaignId = ctx.nodeData.campaignId as string;
  if (!campaignId) return { success: false, error: "No campaign configured" };

  await ctx.supabase.from("campanha_leads").delete()
    .eq("campanha_id", campaignId).eq("lead_id", ctx.leadId);

  return { success: true, message: `Removed from campaign` };
}

async function handleMoveCampaignStage(ctx: ActionContext): Promise<ActionResult> {
  const campaignId = ctx.nodeData.campaignId as string;
  const stageName = ctx.nodeData.campaignStageName as string;
  const stageId = ctx.nodeData.campaignStageId as string;

  if (!campaignId) return { success: false, error: "No campaign configured" };

  let resolvedStageId = stageId;
  if (!resolvedStageId && stageName) {
    const { data: stage } = await ctx.supabase
      .from("campanha_stages")
      .select("id")
      .eq("campanha_id", campaignId)
      .ilike("name", stageName)
      .maybeSingle();
    resolvedStageId = stage?.id;
  }

  if (!resolvedStageId) return { success: false, error: "Campaign stage not found" };

  await ctx.supabase.from("campanha_leads")
    .update({ stage_id: resolvedStageId })
    .eq("campanha_id", campaignId)
    .eq("lead_id", ctx.leadId);

  return { success: true, message: `Moved to campaign stage "${stageName || stageId}"` };
}

async function handleSendCampaignMessage(ctx: ActionContext): Promise<ActionResult> {
  const campaignId = ctx.nodeData.campaignId as string;
  const templateId = ctx.nodeData.campaignTemplateId as string;
  if (!campaignId) return { success: false, error: "No campaign configured" };
  if (!templateId) return { success: false, error: "No template configured" };

  const { data: template } = await ctx.supabase
    .from("campaign_templates")
    .select("content, message_type, audio_url")
    .eq("id", templateId)
    .maybeSingle();

  if (!template) return { success: false, error: "Template not found" };

  const message = await resolveVariables(ctx.supabase, ctx.leadId, template.content || "", ctx.executionContext);

  const wa = await getWhatsAppInstance(ctx.supabase, ctx.organizationId, ctx.nodeData.whatsappInstanceId as string);
  if (!wa) return { success: false, error: "WhatsApp instance not available" };

  const phone = await getLeadPhone(ctx.supabase, ctx.leadId);
  if (!phone) return { success: false, error: "Lead has no phone" };

  const isAudio = template.message_type === "audio" && template.audio_url;

  const { sendTextViaInstance, sendAudioViaInstance } = await import("./whatsapp-dispatch.ts");
  const sendResult = isAudio
    ? await sendAudioViaInstance(ctx.supabase, wa.instance, phone, template.audio_url, {
        trackSource: "workflow-campaign-message",
        trackId: ctx.executionId,
      })
    : await sendTextViaInstance(ctx.supabase, wa.instance, phone, message, {
        trackSource: "workflow-campaign-message",
        trackId: ctx.executionId,
      });

  if (!sendResult.success) return { success: false, error: `Campaign message send failed: ${sendResult.error}` };

  const messageId = sendResult.messageId || `wf_camp_${crypto.randomUUID()}`;

  await ctx.supabase.from("whatsapp_messages").upsert({
    organization_id: ctx.organizationId,
    instance_id: wa.instanceId,
    message_id: messageId,
    remote_jid: phone + "@s.whatsapp.net",
    phone_number: phone,
    direction: "outgoing",
    message_type: isAudio ? "audio" : "conversation",
    content: isAudio ? null : message,
    media_url: isAudio ? template.audio_url : null,
    timestamp: new Date().toISOString(),
    status: "sent",
    sent_by_ai: true,
  }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });

  return { success: true, message: `Campaign message sent` };
}

async function handlePauseCampaignSequence(ctx: ActionContext): Promise<ActionResult> {
  const campaignId = ctx.nodeData.campaignId as string;
  if (!campaignId) return { success: false, error: "No campaign configured" };

  const { error } = await ctx.supabase
    .from("scheduled_campaign_messages")
    .update({ status: "cancelled" })
    .eq("lead_id", ctx.leadId)
    .eq("campanha_id", campaignId)
    .eq("status", "scheduled");

  if (error) return { success: false, error: error.message };
  return { success: true, message: "Campaign sequence paused" };
}

async function handleResumeCampaignSequence(ctx: ActionContext): Promise<ActionResult> {
  const campaignId = ctx.nodeData.campaignId as string;
  if (!campaignId) return { success: false, error: "No campaign configured" };

  const { error } = await ctx.supabase
    .from("scheduled_campaign_messages")
    .update({
      status: "scheduled",
      scheduled_at: new Date().toISOString(),
    })
    .eq("lead_id", ctx.leadId)
    .eq("campanha_id", campaignId)
    .eq("status", "cancelled");

  if (error) return { success: false, error: error.message };
  return { success: true, message: "Campaign sequence resumed" };
}

// ─── Calendar Handlers ──────────────────────────────────────────────────────

async function handleCreateCalendarEvent(ctx: ActionContext): Promise<ActionResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const title = await resolveVariables(ctx.supabase, ctx.leadId, ctx.nodeData.eventTitle as string || "Evento");
  const description = await resolveVariables(ctx.supabase, ctx.leadId, ctx.nodeData.eventDescription as string || "");

  const res = await fetch(`${supabaseUrl}/functions/v1/google-calendar-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      organization_id: ctx.organizationId,
      lead_id: ctx.leadId,
      title,
      description,
      duration_minutes: ctx.nodeData.eventDurationMinutes || 60,
    }),
  });

  if (!res.ok) return { success: false, error: `Calendar event failed: ${await res.text()}` };
  return { success: true, message: "Calendar event created" };
}

async function handleScheduleMeeting(ctx: ActionContext): Promise<ActionResult> {
  const { error } = await ctx.supabase.from("pending_ai_actions").insert({
    organization_id: ctx.organizationId,
    lead_id: ctx.leadId,
    action_type: "schedule_meeting",
    payload: {
      source: "workflow",
      preferred_date: ctx.nodeData.meetingDate || null,
      closer_id: ctx.nodeData.meetingCloserId || null,
    },
    status: "pending",
  });

  if (error) return { success: false, error: error.message };
  return { success: true, message: "Meeting scheduling queued" };
}

// ─── TinyERP Handler ────────────────────────────────────────────────────────

async function handleTinyErpOrder(ctx: ActionContext, functionName: string): Promise<ActionResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      organization_id: ctx.organizationId,
      lead_id: ctx.leadId,
      product_id: ctx.nodeData.tinyProductId || null,
    }),
  });

  if (!res.ok) return { success: false, error: `TinyERP order failed: ${await res.text()}` };
  return { success: true, message: `TinyERP order created via ${functionName}` };
}

// ─── Team Handlers ──────────────────────────────────────────────────────────

/**
 * Atribui responsável ao lead (sdr_id, closer_id, responsible_id).
 * Node único que substitui assign_sdr e assign_closer separados.
 */
async function handleAssignResponsible(ctx: ActionContext): Promise<ActionResult> {
  let assigneeId = ctx.nodeData.assigneeId as string;
  const assignMode = ctx.nodeData.assignMode as string || "specific";

  if (assignMode === "round_robin") {
    // Org-scoped least-loaded distribution
    const { data: members } = await ctx.supabase
      .from("team_members")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("is_active", true);

    if (members && members.length > 0) {
      const counts = await Promise.all(
        members.map(async (m: { id: string }) => {
          const { count } = await ctx.supabase
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("responsible_id", m.id)
            .eq("organization_id", ctx.organizationId);
          return { id: m.id, count: count ?? 0 };
        }),
      );
      counts.sort((a, b) => a.count - b.count);
      assigneeId = counts[0].id;
    }
  }

  if (!assigneeId) return { success: false, error: "No team member to assign" };

  await ctx.supabase.from("leads").update({
    sdr_id: assigneeId,
    closer_id: assigneeId,
    responsible_id: assigneeId,
  }).eq("id", ctx.leadId);

  return { success: true, message: `Responsável atribuído`, data: { assigneeId } };
}

async function handleAssign(ctx: ActionContext, role: "sdr" | "closer"): Promise<ActionResult> {
  let assigneeId = ctx.nodeData.assigneeId as string;
  const assignMode = ctx.nodeData.assignMode as string || "specific";
  const field = role === "sdr" ? "sdr_id" : "closer_id";

  if (assignMode === "round_robin") {
    // Check if workflow node has campaign context
    const campaignId = ctx.nodeData.campaignId as string | undefined;
    // Check if workflow node has pipe context
    const pipeType = ctx.nodeData.pipeType as string | undefined;

    if (campaignId) {
      // Campaign-scoped distribution via atomic RPC
      const rpcName = role === "closer" ? "get_next_campaign_closer" : "get_next_campaign_sdr";
      const { data: nextId } = await ctx.supabase.rpc(rpcName, { p_campaign_id: campaignId });
      if (nextId) assigneeId = nextId;
    } else if (pipeType) {
      // Pipe-scoped distribution via atomic RPC
      const { data: nextId } = await ctx.supabase.rpc("get_next_pipe_sdr", {
        p_pipe_type: pipeType,
        p_organization_id: ctx.organizationId,
      });
      if (nextId) assigneeId = nextId;
    } else {
      // Fallback: org-scoped least-loaded (adds organization_id filter)
      const targetMetric = role === "sdr" ? "meetings" : "sales";
      const { data: members } = await ctx.supabase
        .from("team_members")
        .select("id")
        .eq("organization_id", ctx.organizationId)
        .eq("is_active", true)
        .eq("metric_type", targetMetric);

      if (members && members.length > 0) {
        const counts = await Promise.all(
          members.map(async (m: { id: string }) => {
            const { count } = await ctx.supabase
              .from("leads")
              .select("*", { count: "exact", head: true })
              .eq("responsible_id", m.id)
              .eq("organization_id", ctx.organizationId);
            return { id: m.id, count: count ?? 0 };
          }),
        );
        counts.sort((a, b) => a.count - b.count);
        assigneeId = counts[0].id;
      }
    }
  }

  if (!assigneeId) return { success: false, error: `No ${role} to assign` };

  await ctx.supabase.from("leads").update({ [field]: assigneeId, responsible_id: assigneeId }).eq("id", ctx.leadId);

  return { success: true, message: `Responsável atribuído`, data: { assigneeId, role } };
}

async function handleNotifyTeamMember(ctx: ActionContext): Promise<ActionResult> {
  const memberId = ctx.nodeData.notifyMemberId as string;
  if (!memberId) return { success: false, error: "No team member configured" };

  const message = await resolveVariables(ctx.supabase, ctx.leadId, ctx.nodeData.notifyMessage as string || "");

  // Get user_id from team_member
  const { data: member } = await ctx.supabase
    .from("team_members")
    .select("user_id, name")
    .eq("id", memberId)
    .maybeSingle();

  if (!member?.user_id) return { success: false, error: "Team member not found" };

  await ctx.supabase.from("notifications").insert({
    organization_id: ctx.organizationId,
    user_id: member.user_id,
    type: "workflow_notification",
    title: "Notificação de Workflow",
    description: message || "Ação de workflow executada",
    lead_id: ctx.leadId,
    link: "/pipe-whatsapp",
  });

  return { success: true, message: `Notification sent to ${member.name || memberId}` };
}

// ─── Follow-up Handler ──────────────────────────────────────────────────────

async function handleCreateFollowup(ctx: ActionContext): Promise<ActionResult> {
  const title = await resolveVariables(ctx.supabase, ctx.leadId, ctx.nodeData.followupTitle as string || "Follow-up");
  const description = await resolveVariables(ctx.supabase, ctx.leadId, ctx.nodeData.followupDescription as string || "");
  const priority = ctx.nodeData.followupPriority as string || "normal";

  // Get lead's responsible as assignee (fallback to legacy sdr_id/closer_id)
  const { data: lead } = await ctx.supabase
    .from("leads")
    .select("responsible_id, sdr_id, closer_id")
    .eq("id", ctx.leadId)
    .maybeSingle();

  const assignedTo = lead?.responsible_id || lead?.sdr_id || lead?.closer_id || null;

  const { error } = await ctx.supabase.from("follow_ups").insert({
    lead_id: ctx.leadId,
    assigned_to: assignedTo,
    title,
    description,
    priority,
    due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // +1 day
    is_automated: true,
    organization_id: ctx.organizationId,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, message: `Follow-up "${title}" created` };
}

// ─── AI Handlers ────────────────────────────────────────────────────────────

async function handleGenerateAiMessage(ctx: ActionContext): Promise<ActionResult> {
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!openRouterApiKey) {
    return { success: false, error: "OPENROUTER_API_KEY não configurada" };
  }

  const rawPrompt = (ctx.nodeData.aiPrompt as string) || "";
  if (!rawPrompt) {
    return { success: false, error: "Prompt de IA não configurado no nó" };
  }

  // Resolve variables in the prompt (e.g., {{nome}}, {{empresa}})
  const prompt = await resolveVariables(ctx.supabase, ctx.leadId, rawPrompt);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterApiKey}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials CRM - Workflow AI Message",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          {
            role: "system",
            content:
              "Você é um assistente de vendas B2B. Gere uma mensagem curta, natural e adequada para WhatsApp. " +
              "Não use saudações formais como 'Prezado' ou 'Caro'. Seja direto e conversacional. " +
              "Responda APENAS com o texto da mensagem, sem explicações.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `OpenRouter API error: ${response.status} ${errText}` };
    }

    const data = await response.json();
    const generatedMessage = data.choices?.[0]?.message?.content?.trim() || "";

    if (!generatedMessage) {
      return { success: false, error: "IA retornou mensagem vazia" };
    }

    // Store in execution context so next nodes can use {{ai_message}}
    const outputVar = (ctx.nodeData.aiOutputVariable as string) || "ai_message";
    ctx.executionContext[outputVar] = generatedMessage;

    return {
      success: true,
      message: `Mensagem gerada com sucesso (${generatedMessage.length} chars)`,
      data: { [outputVar]: generatedMessage },
    };
  } catch (err) {
    return { success: false, error: `Erro ao gerar mensagem: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function handleInvokeEdgeFunction(ctx: ActionContext, functionName: string): Promise<ActionResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      lead_id: ctx.leadId,
    }),
  });

  if (!res.ok) return { success: false, error: `${functionName} failed: ${await res.text()}` };

  let data: Record<string, unknown> | undefined;
  try {
    data = await res.json();
  } catch {
    // response may not be JSON
  }

  return { success: true, message: `${functionName} completed`, data };
}
