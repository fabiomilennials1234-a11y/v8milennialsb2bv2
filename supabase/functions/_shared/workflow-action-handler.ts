/**
 * Workflow Action Handler — implements all 30 workflow action types
 *
 * Each handler returns { success, message?, error?, data? }.
 * On success, logs to lead_history with source: 'automation'.
 * Uses existing shared modules (outbound-sender, audio-sender, etc.)
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTimeBasedVariables } from "./time-variables.ts";
import { getPipeEntry } from "./pipeline-adapter.ts";
import { moveStage as sharedMoveStage } from "./action-handlers/move-stage.ts";
import { addTag as sharedAddTag, removeTag as sharedRemoveTag } from "./action-handlers/tag-operations.ts";
import { updateLeadField as sharedUpdateLeadField, updateCustomField as sharedUpdateCustomField, updateRating as sharedUpdateRating } from "./action-handlers/lead-field-operations.ts";
import { duplicateToPipe as sharedDuplicateToPipe, removeFromPipe as sharedRemoveFromPipe, markAsLost as sharedMarkAsLost } from "./action-handlers/pipe-operations.ts";
import { sendWhatsApp as sharedSendWhatsApp } from "./action-handlers/send-whatsapp.ts";
import { sendWhatsAppAudio as sharedSendWhatsAppAudio, sendWhatsAppImage as sharedSendWhatsAppImage, sendWhatsAppSticker as sharedSendWhatsAppSticker } from "./action-handlers/send-whatsapp-media.ts";
import { sendWhatsAppTemplate as sharedSendWhatsAppTemplate, sendWhatsAppMenu as sharedSendWhatsAppMenu, sendWhatsAppPixButton as sharedSendWhatsAppPixButton } from "./action-handlers/send-whatsapp-rich.ts";
import { sendMetaMessage as sharedSendMetaMessage, sendSemiAutomatic as sharedSendSemiAutomatic } from "./action-handlers/send-meta.ts";
import { addToCampaign as sharedAddToCampaign, removeFromCampaign as sharedRemoveFromCampaign, moveCampaignStage as sharedMoveCampaignStage, pauseCampaignSequence as sharedPauseCampaignSequence, resumeCampaignSequence as sharedResumeCampaignSequence } from "./action-handlers/campaign-operations.ts";
import { createCalendarEvent as sharedCreateCalendarEvent } from "./action-handlers/calendar-operations.ts";
import { createTinyerpOrder as sharedCreateTinyerpOrder, createTinyerpUpsellOrder as sharedCreateTinyerpUpsellOrder } from "./action-handlers/tinyerp-operations.ts";
import { assignResponsible as sharedAssignResponsible, assignSdr as sharedAssignSdr, assignCloser as sharedAssignCloser, notifyTeamMember as sharedNotifyTeamMember } from "./action-handlers/team-operations.ts";
import { createFollowup as sharedCreateFollowup } from "./action-handlers/followup-operations.ts";
import { applyChecklist as sharedApplyChecklist } from "./action-handlers/checklist-operations.ts";
import { sendCampaignMessage as sharedSendCampaignMessage } from "./action-handlers/send-campaign-message.ts";
import { generateAiMessage as sharedGenerateAiMessage, summarizeConversation as sharedSummarizeConversation, evaluateConversation as sharedEvaluateConversation, queueScheduleMeeting as sharedQueueScheduleMeeting } from "./action-handlers/ai-operations.ts";

export interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: Record<string, unknown>;
  retryable?: boolean;
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

// getWhatsAppInstance, getLeadPhone, enforceWhatsAppRateLimit — REMOVED: now in action-handlers/whatsapp-helpers.ts

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

// ─── Context → ActionInput adapter ─────────────────────────────────────────

function toActionInput(ctx: ActionContext) {
  return {
    supabase: ctx.supabase,
    organizationId: ctx.organizationId,
    leadId: ctx.leadId,
    conversationId: null as string | null,
    params: {
      ...ctx.nodeData,
      _executionId: (ctx as unknown as { executionId?: string }).executionId,
    },
    executionContext: ctx.executionContext,
  };
}

// ─── Main Router ────────────────────────────────────────────────────────────

export async function executeWorkflowAction(ctx: ActionContext): Promise<ActionResult> {
  const actionType = ctx.nodeData.actionType as string;

  let result: ActionResult;

  switch (actionType) {
    // ── Communication (delegated to action-handlers/) ──
    case "send_whatsapp":
      result = await sharedSendWhatsApp(toActionInput(ctx));
      break;
    case "send_whatsapp_audio":
      result = await sharedSendWhatsAppAudio(toActionInput(ctx));
      break;
    case "send_whatsapp_image":
      result = await sharedSendWhatsAppImage(toActionInput(ctx));
      break;
    case "send_whatsapp_sticker":
      result = await sharedSendWhatsAppSticker(toActionInput(ctx));
      break;
    case "send_whatsapp_template":
      result = await sharedSendWhatsAppTemplate(toActionInput(ctx));
      break;
    case "send_meta_message":
      result = await sharedSendMetaMessage(toActionInput(ctx));
      break;
    case "send_semi_automatic":
      result = await sharedSendSemiAutomatic(toActionInput(ctx));
      break;

    // ── Unified "Enviar Mensagem" node — dispatch by messageType (ADR-0012) ──
    case "send_whatsapp_message": {
      // Semi-automatic: route the whole message through SDR approval before send
      // instead of auto-sending (ADR-0012).
      if (ctx.nodeData.semiAutomatic) {
        const semiInput = toActionInput(ctx);
        semiInput.params.semiAutoMessage =
          (ctx.nodeData.semiAutoMessage as string) ||
          (ctx.nodeData.messageTemplate as string) ||
          (ctx.nodeData.imageCaption as string) ||
          "";
        result = await sharedSendSemiAutomatic(semiInput);
        break;
      }
      const messageType = (ctx.nodeData.messageType as string) || "texto";
      switch (messageType) {
        case "texto": {
          // "Gerar com IA" mode: generate into a variable first, then send the
          // resolved text in the same node (ADR-0012). Mirrors generate_ai_message.
          if ((ctx.nodeData.templateMode as string) === "ai") {
            const aiInput = toActionInput(ctx);
            const aiPromptRaw = (ctx.nodeData.aiPrompt as string) || "";
            if (aiPromptRaw && ctx.leadId) {
              aiInput.params.aiPrompt = await resolveVariables(ctx.supabase, ctx.leadId, aiPromptRaw, ctx.executionContext);
            }
            const aiResult = await sharedGenerateAiMessage(aiInput);
            if (!aiResult.success) { result = aiResult; break; }
            const outputVar = (ctx.nodeData.aiOutputVariable as string) || "ai_message";
            if (aiResult.data && aiResult.data[outputVar] != null) {
              ctx.executionContext[outputVar] = aiResult.data[outputVar];
            }
          }
          result = await sharedSendWhatsApp(toActionInput(ctx));
          break;
        }
        case "imagem":
          result = await sharedSendWhatsAppImage(toActionInput(ctx));
          break;
        case "audio":
          result = await sharedSendWhatsAppAudio(toActionInput(ctx));
          break;
        case "sticker":
          result = await sharedSendWhatsAppSticker(toActionInput(ctx));
          break;
        case "menu":
          result = await sharedSendWhatsAppMenu(toActionInput(ctx));
          break;
        case "pix":
          result = await sharedSendWhatsAppPixButton(toActionInput(ctx));
          break;
        default:
          return { success: false, error: `Unknown message type: ${messageType}`, retryable: false };
      }
      break;
    }

    // ── Uazapi-only interactive messages (delegated to action-handlers/) ──
    case "send_whatsapp_menu":
      result = await sharedSendWhatsAppMenu(toActionInput(ctx));
      break;
    case "send_whatsapp_pix_button":
      result = await sharedSendWhatsAppPixButton(toActionInput(ctx));
      break;

    // ── Lead Management ──
    case "move_stage": {
      const pipeType = ctx.nodeData.pipeType as string || "whatsapp";
      const targetStage = ctx.nodeData.targetStage as string;
      if (!targetStage) { result = { success: false, error: "No target stage configured" }; break; }
      result = await sharedMoveStage({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { target_stage: targetStage, target_pipe: pipeType },
      });
      if (result.success && result.data) {
        result.data = { pipeType, targetStage: result.data.target_stage };
      }
      break;
    }
    case "add_tag":
      result = await sharedAddTag({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { tagId: ctx.nodeData.tagId, tagName: ctx.nodeData.tagName },
      });
      break;
    case "remove_tag":
      result = await sharedRemoveTag({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { tagId: ctx.nodeData.tagId, tagName: ctx.nodeData.tagName },
      });
      break;
    case "update_lead_field": {
      const ulfFieldValue = ctx.nodeData.fieldValue as string || "";
      const ulfResolved = await resolveVariables(ctx.supabase, ctx.leadId, ulfFieldValue);
      result = await sharedUpdateLeadField({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { fieldName: ctx.nodeData.fieldName, fieldValue: ulfResolved },
      });
      break;
    }
    case "update_custom_field": {
      const ucfFieldValue = ctx.nodeData.customFieldValue as string || "";
      const ucfResolved = await resolveVariables(ctx.supabase, ctx.leadId, ucfFieldValue);
      result = await sharedUpdateCustomField({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { customFieldName: ctx.nodeData.customFieldName, customFieldValue: ucfResolved },
      });
      break;
    }
    case "update_rating":
      result = await sharedUpdateRating({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { ratingValue: ctx.nodeData.ratingValue },
      });
      break;
    case "calculate_score":
      result = await handleCalculateScore(ctx);
      break;
    case "duplicate_to_pipe":
      result = await sharedDuplicateToPipe({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { targetPipeType: ctx.nodeData.targetPipeType, targetPipeStage: ctx.nodeData.targetPipeStage },
      });
      break;
    case "remove_from_pipe":
      result = await sharedRemoveFromPipe({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { pipeType: ctx.nodeData.pipeType },
      });
      break;
    case "mark_as_lost":
      result = await sharedMarkAsLost({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { pipeType: ctx.nodeData.pipeType, lostReason: ctx.nodeData.lostReason },
      });
      break;

    // ── Campaigns ──
    case "add_to_campaign":
      result = await sharedAddToCampaign({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { campaignId: ctx.nodeData.campaignId, campaignName: ctx.nodeData.campaignName },
      });
      break;
    case "remove_from_campaign":
      result = await sharedRemoveFromCampaign({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { campaignId: ctx.nodeData.campaignId },
      });
      break;
    case "move_campaign_stage":
      result = await sharedMoveCampaignStage({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { campaignId: ctx.nodeData.campaignId, campaignStageName: ctx.nodeData.campaignStageName, campaignStageId: ctx.nodeData.campaignStageId },
      });
      break;
    case "send_campaign_message":
      result = await sharedSendCampaignMessage(toActionInput(ctx));
      break;
    case "pause_campaign_sequence":
      result = await sharedPauseCampaignSequence({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { campaignId: ctx.nodeData.campaignId },
      });
      break;
    case "resume_campaign_sequence":
      result = await sharedResumeCampaignSequence({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { campaignId: ctx.nodeData.campaignId },
      });
      break;

    // ── Calendar ──
    case "create_calendar_event": {
      const evtTitle = await resolveVariables(ctx.supabase, ctx.leadId, ctx.nodeData.eventTitle as string || "Evento");
      const evtDesc = await resolveVariables(ctx.supabase, ctx.leadId, ctx.nodeData.eventDescription as string || "");
      result = await sharedCreateCalendarEvent({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { eventTitle: evtTitle, eventDescription: evtDesc, eventDurationMinutes: ctx.nodeData.eventDurationMinutes },
      });
      break;
    }
    case "schedule_meeting":
      result = await sharedQueueScheduleMeeting(toActionInput(ctx));
      break;

    // ── TinyERP ──
    case "create_tinyerp_order":
      result = await sharedCreateTinyerpOrder({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { tinyProductId: ctx.nodeData.tinyProductId },
      });
      break;
    case "create_tinyerp_upsell_order":
      result = await sharedCreateTinyerpUpsellOrder({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { tinyProductId: ctx.nodeData.tinyProductId },
      });
      break;

    // ── Team ──
    case "assign_responsible":
      result = await sharedAssignResponsible({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { assigneeId: ctx.nodeData.assigneeId, assignMode: ctx.nodeData.assignMode },
      });
      break;
    case "assign_sdr":
      result = await sharedAssignSdr({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { assigneeId: ctx.nodeData.assigneeId, assignMode: ctx.nodeData.assignMode, campaignId: ctx.nodeData.campaignId, pipeType: ctx.nodeData.pipeType },
      });
      break;
    case "assign_closer":
      result = await sharedAssignCloser({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { assigneeId: ctx.nodeData.assigneeId, assignMode: ctx.nodeData.assignMode, campaignId: ctx.nodeData.campaignId, pipeType: ctx.nodeData.pipeType },
      });
      break;
    case "notify_team_member": {
      const notifyMsg = await resolveVariables(ctx.supabase, ctx.leadId, ctx.nodeData.notifyMessage as string || "");
      result = await sharedNotifyTeamMember({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { notifyMemberId: ctx.nodeData.notifyMemberId, notifyMessage: notifyMsg },
      });
      break;
    }

    // ── Follow-up ──
    case "create_followup": {
      const fuTitle = await resolveVariables(ctx.supabase, ctx.leadId, ctx.nodeData.followupTitle as string || "Follow-up");
      const fuDesc = await resolveVariables(ctx.supabase, ctx.leadId, ctx.nodeData.followupDescription as string || "");
      result = await sharedCreateFollowup({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { followupTitle: fuTitle, followupDescription: fuDesc, followupPriority: ctx.nodeData.followupPriority },
      });
      break;
    }

    // ── Checklists ──
    case "apply_checklist":
      result = await sharedApplyChecklist({
        supabase: ctx.supabase, organizationId: ctx.organizationId, leadId: ctx.leadId,
        conversationId: null,
        params: { checklistTemplateId: ctx.nodeData.checklistTemplateId },
      });
      break;

    // ── AI (delegated to action-handlers/ai-operations.ts) ──
    case "generate_ai_message": {
      const aiInput = toActionInput(ctx);
      // Pre-resolve variables in aiPrompt before passing to handler
      const aiPromptRaw = (ctx.nodeData.aiPrompt as string) || "";
      if (aiPromptRaw && ctx.leadId) {
        aiInput.params.aiPrompt = await resolveVariables(ctx.supabase, ctx.leadId, aiPromptRaw, ctx.executionContext);
      }
      result = await sharedGenerateAiMessage(aiInput);
      // Propagate output variable to execution context
      if (result.success && result.data) {
        const outputVar = (ctx.nodeData.aiOutputVariable as string) || "ai_message";
        if (result.data[outputVar]) {
          ctx.executionContext[outputVar] = result.data[outputVar];
        }
      }
      break;
    }
    case "summarize_conversation":
      result = await sharedSummarizeConversation(toActionInput(ctx));
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
      result = await sharedEvaluateConversation(toActionInput(ctx));
      break;

    default:
      return { success: false, error: `Unknown action type: ${actionType}`, retryable: false };
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
// handleSendWhatsApp — REMOVED: replaced by sharedSendWhatsApp (action-handlers/send-whatsapp.ts)

// handleSendWhatsAppAudio — REMOVED: replaced by sharedSendWhatsAppAudio (action-handlers/send-whatsapp-media.ts)
// handleSendWhatsAppImage — REMOVED: replaced by sharedSendWhatsAppImage (action-handlers/send-whatsapp-media.ts)
// handleSendWhatsAppSticker — REMOVED: replaced by sharedSendWhatsAppSticker (action-handlers/send-whatsapp-media.ts)
// handleSendWhatsAppTemplate — REMOVED: replaced by sharedSendWhatsAppTemplate (action-handlers/send-whatsapp-rich.ts)
// handleSendWhatsAppMenu — REMOVED: replaced by sharedSendWhatsAppMenu (action-handlers/send-whatsapp-rich.ts)
// handleSendWhatsAppPixButton — REMOVED: replaced by sharedSendWhatsAppPixButton (action-handlers/send-whatsapp-rich.ts)
// handleSendMetaMessage — REMOVED: replaced by sharedSendMetaMessage (action-handlers/send-meta.ts)
// handleSendSemiAutomatic — REMOVED: replaced by sharedSendSemiAutomatic (action-handlers/send-meta.ts)

// ─── Lead Management Handlers ───────────────────────────────────────────────
// handleMoveStage — REMOVED: replaced by sharedMoveStage (action-handlers/move-stage.ts)
// handleAddTag — REMOVED: replaced by sharedAddTag (action-handlers/tag-operations.ts)
// handleRemoveTag — REMOVED: replaced by sharedRemoveTag (action-handlers/tag-operations.ts)
// handleUpdateLeadField — REMOVED: replaced by sharedUpdateLeadField (action-handlers/lead-field-operations.ts)
// handleUpdateCustomField — REMOVED: replaced by sharedUpdateCustomField (action-handlers/lead-field-operations.ts)
// handleUpdateRating — REMOVED: replaced by sharedUpdateRating (action-handlers/lead-field-operations.ts)
// handleDuplicateToPipe — REMOVED: replaced by sharedDuplicateToPipe (action-handlers/pipe-operations.ts)
// handleRemoveFromPipe — REMOVED: replaced by sharedRemoveFromPipe (action-handlers/pipe-operations.ts)
// handleMarkAsLost — REMOVED: replaced by sharedMarkAsLost (action-handlers/pipe-operations.ts)

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

// handleSendCampaignMessage — REMOVED: replaced by sharedSendCampaignMessage (action-handlers/send-campaign-message.ts)
// handleScheduleMeeting — REMOVED: replaced by sharedQueueScheduleMeeting (action-handlers/ai-operations.ts)
// handleGenerateAiMessage — REMOVED: replaced by sharedGenerateAiMessage (action-handlers/ai-operations.ts)
// handleInvokeEdgeFunction (summarize/evaluate) — REMOVED: replaced by sharedSummarizeConversation / sharedEvaluateConversation (action-handlers/ai-operations.ts)
