/**
 * AI Action Executor — executa ações do Copilot enfileiradas em pending_ai_actions
 *
 * Toda lógica que antes era executada inline nas tools do AgentEngine
 * agora vive aqui e é chamada pelo worker process-ai-actions.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeString } from "./validation.ts";
import { promoveShadowLead } from "./lead-service.ts";
import { getValidAccessToken, logCalendarOp } from "./google-calendar-utils.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActionRecord {
  id: string;
  organization_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  action_type: string;
  payload: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
}

// ─── Immediate Transfer (synchronous, called inline by agent-engine) ──────────

/**
 * Immediate transfer: sets ai_disabled + WAITING_HUMAN synchronously.
 * Called inline from agent-engine before enqueueing side-effects.
 * Does NOT create notifications or lead_history (that's the queue's job).
 */
export async function immediateTransferHuman(
  supabase: SupabaseClient,
  leadId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error: leadError } = await supabase
      .from("leads")
      .update({ ai_disabled: true, ai_disabled_at: new Date().toISOString() })
      .eq("id", leadId);

    if (leadError) {
      console.warn("[immediateTransferHuman] Failed to update lead:", leadError.message);
      return { success: false, error: leadError.message };
    }

    const { error: convError } = await supabase
      .from("conversations")
      .update({ state: "WAITING_HUMAN" })
      .eq("lead_id", leadId);

    if (convError) {
      console.warn("[immediateTransferHuman] Failed to update conversation:", convError.message);
    }

    console.log("[immediateTransferHuman] Transfer executed immediately for lead:", leadId);
    return { success: true };
  } catch (err) {
    console.warn("[immediateTransferHuman] Unexpected error:", err);
    return { success: false, error: String(err) };
  }
}

// ─── Action → lead_history mapping ────────────────────────────────────────────

interface HistoryMapping {
  action: string;
  descriptionFn: (payload: Record<string, unknown>, result: ActionResult) => string;
  source: "agent" | "automation" | "system";
}

const ACTION_HISTORY_MAP: Record<string, HistoryMapping> = {
  schedule_meeting: {
    action: "meeting_scheduled",
    descriptionFn: (p) => `Reunião agendada para ${p.preferred_date || "data não informada"} pelo Copilot`,
    source: "agent",
  },
  create_lead: {
    action: "lead_created",
    descriptionFn: (p) => `Lead criado pelo Copilot: ${p.name || "sem nome"}`,
    source: "agent",
  },
  update_lead: {
    action: "field_updated",
    descriptionFn: (p) => {
      const updates = p.updates as Record<string, unknown> | undefined;
      const fields = updates ? Object.keys(updates).join(", ") : "campos";
      return `Campos atualizados pelo Copilot: ${fields}`;
    },
    source: "agent",
  },
  transfer_to_human: {
    action: "ai_toggled",
    descriptionFn: () => "Transferido para atendimento humano pelo Copilot",
    source: "agent",
  },
  transfer_to_human_notify: {
    action: "ai_toggled",
    descriptionFn: (p) => `Copilot transferiu: ${p.reason || "sem motivo informado"}`,
    source: "agent",
  },
  transfer_sz_chat: {
    action: "ai_toggled",
    descriptionFn: (p) => `Copilot transferiu para setor SZ.chat: ${p.target_team_name || "setor não informado"}`,
    source: "agent",
  },
  update_qualification_score: {
    action: "field_updated",
    descriptionFn: (p) => `Score de qualificação atualizado para ${p.score || 0} pelo Copilot`,
    source: "agent",
  },
  advance_stage: {
    action: "stage_changed",
    descriptionFn: (p) => {
      const pipeLabels: Record<string, string> = {
        whatsapp: "WhatsApp", confirmacao: "Confirmação", propostas: "Propostas",
        upsell_base: "Carteira Base", upsell_gestao: "Carteira Gestão", campanha: "Campanhas",
      };
      const pipe = pipeLabels[(p.target_pipe as string) || "whatsapp"] || p.target_pipe;
      return `Movido para ${p.target_stage} em ${pipe} pelo Copilot`;
    },
    source: "agent",
  },
  confirm_meeting: {
    action: "meeting_attended",
    descriptionFn: (p) => {
      const type = p.confirmation_type === "confirmed" ? "confirmada" : "pré-confirmada";
      return `Reunião ${type} pelo Copilot`;
    },
    source: "agent",
  },
  advance_confirmation_stage: {
    action: "stage_changed",
    descriptionFn: (p) => `Movido para ${p.target_stage} no funil Confirmação pelo Copilot`,
    source: "agent",
  },
  create_custom_field: {
    action: "field_updated",
    descriptionFn: (p) => `Campo personalizado "${p.field_name}" criado pelo Copilot`,
    source: "agent",
  },
  automation_qualify: {
    action: "stage_changed",
    descriptionFn: () => "Lead qualificado pelo Copilot",
    source: "automation",
  },
  automation_disqualify: {
    action: "stage_changed",
    descriptionFn: () => "Lead desqualificado pelo Copilot",
    source: "automation",
  },
  automation_need_human: {
    action: "ai_toggled",
    descriptionFn: () => "Transferido para humano por automação do Copilot",
    source: "automation",
  },
  update_pipeline_stage: {
    action: "stage_changed",
    descriptionFn: (p) => `Pipeline atualizado para ${p.new_stage} pelo Copilot`,
    source: "agent",
  },
  send_document: {
    action: "document_sent",
    descriptionFn: (payload) =>
      `Documento "${payload.file_name || 'arquivo'}" enviado ao lead via WhatsApp`,
    source: "agent",
  },
};

// ─── Main Router ──────────────────────────────────────────────────────────────

export async function executeAiAction(
  supabase: SupabaseClient,
  action: ActionRecord,
): Promise<ActionResult> {
  const { action_type, payload, organization_id, lead_id } = action;

  let result: ActionResult;

  switch (action_type) {
    case "schedule_meeting":
      result = await executeScheduleMeeting(supabase, payload, organization_id);
      break;
    case "create_lead":
      result = await executeCreateLead(supabase, payload, organization_id);
      break;
    case "update_crm":
      return { success: true, message: "UPDATE_CRM - integração externa (placeholder)" };
    case "update_lead":
      result = await executeUpdateLead(supabase, payload, organization_id);
      break;
    case "transfer_to_human":
      result = await executeTransferHuman(supabase, payload);
      break;
    case "transfer_to_human_notify":
      result = await executeTransferHumanNotify(supabase, payload, organization_id, lead_id);
      break;
    case "update_qualification_score":
      result = await executeUpdateQualificationScore(supabase, payload);
      break;
    case "advance_stage":
      result = await executeAdvanceStage(supabase, payload, organization_id);
      break;
    case "confirm_meeting":
      result = await executeConfirmMeeting(supabase, payload);
      break;
    case "advance_confirmation_stage":
      result = await executeAdvanceConfirmationStage(supabase, payload, organization_id);
      break;
    case "create_custom_field":
      result = await executeCreateCustomField(supabase, payload, organization_id);
      break;
    case "automation_qualify":
    case "automation_disqualify":
    case "automation_need_human":
      result = await executeAutomation(supabase, payload, organization_id, lead_id);
      break;
    case "update_pipeline_stage":
      result = await executeUpdatePipelineStage(supabase, payload, organization_id);
      break;
    case "transfer_sz_chat":
      result = await executeTransferSzChat(supabase, lead_id, organization_id, payload);
      break;
    case "send_document":
      result = await executeSendDocument(supabase, payload, organization_id, lead_id);
      break;
    default:
      return { success: false, error: `Tipo de ação desconhecido: ${action_type}` };
  }

  // Log to lead_history on success
  if (result.success) {
    const resolvedLeadId = lead_id
      || (payload.lead_id as string)
      || (result.data?.lead_id as string);

    if (resolvedLeadId) {
      await logToLeadHistory(supabase, {
        leadId: resolvedLeadId,
        organizationId: organization_id,
        actionType: action_type,
        payload,
        result,
      });
    }
  }

  return result;
}

// ─── Lead History Logger ──────────────────────────────────────────────────────

async function logToLeadHistory(
  supabase: SupabaseClient,
  params: {
    leadId: string;
    organizationId: string;
    actionType: string;
    payload: Record<string, unknown>;
    result: ActionResult;
  },
): Promise<void> {
  try {
    const mapping = ACTION_HISTORY_MAP[params.actionType];
    if (!mapping) return;

    // Skip for stage-related actions — PG triggers (trg_pipe_*_stage_change) handle these
    const STAGE_AI_ACTIONS = ["advance_stage", "advance_confirmation_stage", "automation_qualify", "automation_disqualify", "update_pipeline_stage"];
    if (STAGE_AI_ACTIONS.includes(params.actionType)) return;

    await supabase.from("lead_history").insert({
      lead_id: params.leadId,
      action: mapping.action,
      description: `Copilot: ${mapping.descriptionFn(params.payload, params.result)}`,
      source: mapping.source,
      organization_id: params.organizationId,
      metadata: {
        action_type: params.actionType,
        ...(params.result.data || {}),
      },
      created_by: null,
    });
  } catch (err) {
    console.warn("[ai-action-executor] Failed to log to lead_history (non-fatal):", err);
  }
}

// ─── Tool Executors ───────────────────────────────────────────────────────────

async function executeScheduleMeeting(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const lead_id = params.lead_id as string;
  const preferred_date = params.preferred_date as string;
  const preferred_time = params.preferred_time as string | undefined;

  if (!lead_id || !preferred_date) {
    return { success: false, error: "lead_id e preferred_date são obrigatórios" };
  }

  // 1. Atualizar lead e pipe_confirmacao
  await supabase.from("leads").update({ compromisso_date: preferred_date }).eq("id", lead_id);

  const { data: existing } = await supabase
    .from("pipe_confirmacao")
    .select("id")
    .eq("lead_id", lead_id)
    .maybeSingle();

  let pipeId: string | null = existing?.id ?? null;

  if (existing) {
    await supabase
      .from("pipe_confirmacao")
      .update({ status: "reuniao_marcada", meeting_date: preferred_date })
      .eq("id", existing.id);
  } else {
    const { data: inserted } = await supabase
      .from("pipe_confirmacao")
      .insert({
        lead_id,
        organization_id: tenantId,
        status: "reuniao_marcada",
        meeting_date: preferred_date,
      })
      .select("id")
      .single();
    pipeId = inserted?.id ?? null;
  }

  // 2. Tentar Google Calendar (graceful degradation)
  let meetLink: string | null = null;
  try {
    const { data: lead } = await supabase
      .from("leads")
      .select("name, email, responsible_id, sdr_id")
      .eq("id", lead_id)
      .maybeSingle();

    const responsibleUserId = lead?.responsible_id ?? lead?.sdr_id ?? null;

    if (responsibleUserId) {
      const tokenData = await getValidAccessToken(responsibleUserId, supabase);

      if (tokenData) {
        const time = preferred_time || "09:00";
        const startIso = `${preferred_date}T${time}:00`;
        const [h, m] = time.split(":").map(Number);
        const endHour = String(h + 1).padStart(2, "0");
        const endIso = `${preferred_date}T${endHour}:${String(m).padStart(2, "0")}:00`;
        const timezone = "America/Sao_Paulo";

        const googleEvent: Record<string, unknown> = {
          summary: `Reunião com ${lead?.name || "Lead"}`,
          start: { dateTime: startIso, timeZone: timezone },
          end: { dateTime: endIso, timeZone: timezone },
          attendees: lead?.email ? [{ email: lead.email }] : [],
          conferenceData: {
            createRequest: {
              requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
          extendedProperties: {
            private: { lead_id, system: "v8milennialsb2b" },
          },
        };

        const googleRes = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokenData.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(googleEvent),
          },
        );

        if (googleRes.ok) {
          const createdEvent = await googleRes.json();
          meetLink =
            createdEvent.conferenceData?.entryPoints?.find(
              (ep: Record<string, string>) => ep.entryPointType === "video",
            )?.uri ??
            createdEvent.hangoutLink ??
            null;

          if (pipeId && meetLink) {
            await supabase
              .from("pipe_confirmacao")
              .update({ meet_link: meetLink })
              .eq("id", pipeId);
          }

          await logCalendarOp(supabase, {
            userId: responsibleUserId,
            operation: "create_event",
            status: "success",
            googleEventId: createdEvent.id,
            localReferenceId: lead_id,
            localReferenceType: "lead",
            requestPayload: { preferred_date, preferred_time, lead_id },
            responsePayload: { id: createdEvent.id, meet_link: meetLink },
            initiatedBy: "ai_agent",
          });
        } else {
          const errText = await googleRes.text();
          console.warn("[ai-action-executor] Google Calendar failed:", errText);
          await logCalendarOp(supabase, {
            userId: responsibleUserId,
            operation: "create_event",
            status: "failed",
            localReferenceId: lead_id,
            localReferenceType: "lead",
            errorMessage: errText,
            requestPayload: { preferred_date, preferred_time, lead_id },
            initiatedBy: "ai_agent",
          });
        }
      }
    }
  } catch (calendarErr) {
    console.warn("[ai-action-executor] Google Calendar error (non-fatal):", calendarErr);
  }

  return {
    success: true,
    message: meetLink ? "Reunião agendada e evento criado no Google Calendar" : "Reunião agendada",
    data: { meeting_date: preferred_date, ...(meetLink ? { meet_link: meetLink } : {}) },
  };
}

async function executeCreateLead(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const { name, email, phone, company } = params;
  if (!name || !tenantId) {
    return { success: false, error: "name e tenant_id são obrigatórios" };
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({ name, email, phone, company, origin: "web", organization_id: tenantId })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, message: "Lead criado", data: { lead_id: lead.id } };
}

async function executeUpdateLead(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const lead_id = params.lead_id as string;
  const updates = params.updates as Record<string, unknown>;

  if (!lead_id || !updates || typeof updates !== "object" || Object.keys(updates).length === 0) {
    return { success: false, error: "lead_id e updates são obrigatórios" };
  }

  const UPDATE_LEAD_STANDARD_FIELDS = ["company", "segment", "urgency", "faturamento", "rating"];

  const { data: lead } = await supabase
    .from("leads")
    .select("id, notes")
    .eq("id", lead_id)
    .eq("organization_id", tenantId)
    .maybeSingle();

  if (!lead) return { success: false, error: "Lead não encontrado" };

  const { data: customFields } = await supabase
    .from("lead_custom_fields")
    .select("id, field_name")
    .eq("organization_id", tenantId);

  const customFieldMap = new Map(
    (customFields || []).map((f: { id: string; field_name: string }) => [f.field_name, f.id]),
  );

  const leadUpdates: Record<string, unknown> = {};
  const customFieldUpdates: { field_id: string; value: string }[] = [];
  const notesToAppend: string[] = [];
  const now = new Date();
  const datePrefix = `[IA - ${now.getDate().toString().padStart(2, "0")}/${(now.getMonth() + 1).toString().padStart(2, "0")}/${now.getFullYear()} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}]`;

  for (const [key, rawValue] of Object.entries(updates)) {
    if (rawValue == null) continue;
    const strVal = String(rawValue).trim();
    if (strVal === "") continue;
    const sanitized = sanitizeString(strVal, 2000) ?? "";

    if (UPDATE_LEAD_STANDARD_FIELDS.includes(key)) {
      if (key === "rating") {
        const num = parseInt(sanitized, 10);
        if (!isNaN(num) && num >= 0 && num <= 10) leadUpdates[key] = num;
      } else {
        leadUpdates[key] = sanitized;
      }
    } else if (customFieldMap.has(key)) {
      customFieldUpdates.push({ field_id: customFieldMap.get(key)!, value: sanitized });
    } else {
      notesToAppend.push(`${datePrefix} ${key}: ${sanitized}`);
    }
  }

  if (Object.keys(leadUpdates).length > 0) {
    await supabase.from("leads").update(leadUpdates).eq("id", lead_id).eq("organization_id", tenantId);
  }
  if (notesToAppend.length > 0) {
    const newNotes = notesToAppend.join("\n");
    const updatedNotes = lead.notes ? `${lead.notes}\n\n${newNotes}` : newNotes;
    await supabase
      .from("leads")
      .update({ notes: sanitizeString(updatedNotes, 5000) ?? updatedNotes })
      .eq("id", lead_id)
      .eq("organization_id", tenantId);
  }
  for (const cf of customFieldUpdates) {
    await supabase.from("lead_custom_field_values").upsert(
      { lead_id, field_id: cf.field_id, value: cf.value, updated_at: new Date().toISOString() },
      { onConflict: "lead_id,field_id" },
    );
  }

  return { success: true, message: "Lead atualizado", data: { lead_id } };
}

async function executeUpdateQualificationScore(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const leadId = params.lead_id as string;
  const score = Math.min(100, Math.max(0, Number(params.score) || 0));

  if (!leadId) return { success: false, error: "lead_id é obrigatório" };

  await supabase.from("leads").update({ qualification_score: score }).eq("id", leadId);

  return { success: true, message: `Score atualizado: ${score}`, data: { score } };
}

async function executeTransferHuman(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const lead_id = params.lead_id as string;
  if (!lead_id) return { success: false, error: "lead_id é obrigatório" };

  await supabase
    .from("leads")
    .update({ ai_disabled: true, ai_disabled_at: new Date().toISOString() })
    .eq("id", lead_id);

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("lead_id", lead_id)
    .maybeSingle();

  if (conversation) {
    await supabase.from("conversations").update({ state: "WAITING_HUMAN" }).eq("id", conversation.id);
  }

  return { success: true, message: "Conversa transferida para humano" };
}

/**
 * Side-effects only: notification + lead_history (via generic logger).
 * The actual ai_disabled + WAITING_HUMAN was already set by immediateTransferHuman.
 */
async function executeTransferHumanNotify(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  organizationId: string,
  leadId: string | null,
): Promise<ActionResult> {
  if (!leadId) return { success: false, error: "lead_id é obrigatório" };

  const reason = (params.reason as string) || "sem motivo informado";

  const { data: lead } = await supabase
    .from("leads")
    .select("name, company, responsible_id")
    .eq("id", leadId)
    .single();

  const leadLabel = lead?.name
    ? lead.company ? `${lead.name} - ${lead.company}` : lead.name
    : "Lead";

  let notifyUserIds: string[] = [];

  if (lead?.responsible_id) {
    const { data: member } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("id", lead.responsible_id)
      .not("user_id", "is", null)
      .single();

    if (member?.user_id) {
      notifyUserIds = [member.user_id];
    }
  }

  if (notifyUserIds.length === 0) {
    const { data: members } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .not("user_id", "is", null);

    notifyUserIds = (members ?? []).map((m) => m.user_id).filter(Boolean) as string[];
  }

  for (const userId of notifyUserIds) {
    try {
      await supabase.from("notifications").insert({
        organization_id: organizationId,
        user_id: userId,
        type: "transfer_to_human",
        title: "Lead precisa de atendimento humano",
        description: `${leadLabel}: ${reason}`,
        lead_id: leadId,
        link: "/pipe-whatsapp",
      });
    } catch (notifErr) {
      console.warn("[executeTransferHumanNotify] Failed to create notification:", notifErr);
    }
  }

  console.log(`[executeTransferHumanNotify] Notified ${notifyUserIds.length} user(s) for lead ${leadId}`);
  return { success: true, message: `Notificação enviada para ${notifyUserIds.length} usuário(s)` };
}

async function executeTransferSzChat(
  supabase: SupabaseClient,
  leadId: string | null,
  organizationId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  if (!leadId) return { success: false, error: "lead_id é obrigatório" };

  const { data: session } = await supabase
    .from("sz_chat_sessions").select("sz_chat_session_id")
    .eq("lead_id", leadId).eq("organization_id", organizationId).eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!session?.sz_chat_session_id) {
    return { success: false, error: "No active SZ.chat session for this lead" };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const res = await fetch(`${supabaseUrl}/functions/v1/sz-chat-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
    body: JSON.stringify({
      action: "transfer_back", organization_id: organizationId,
      session_id: session.sz_chat_session_id,
      target_team_name: params.target_team_name, target_team_id: params.target_team_id,
    }),
  });

  const result = await res.json();
  if (!res.ok || !result.success) {
    return { success: false, error: result.error || "Transfer failed" };
  }

  await supabase.from("leads")
    .update({ ai_disabled: true, ai_disabled_at: new Date().toISOString() })
    .eq("id", leadId);

  return { success: true, message: "Conversa transferida para setor SZ.chat" };
}

async function executeAdvanceStage(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const lead_id = params.lead_id as string;
  const target_stage = params.target_stage as string;
  const target_pipe = (params.target_pipe as string) || "whatsapp";

  if (!lead_id || !target_stage) {
    return { success: false, error: "lead_id e target_stage são obrigatórios" };
  }

  const normalizedStage = String(target_stage).trim().toLowerCase();

  // Validar etapa contra pipeline_stages
  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("stage_key")
    .eq("organization_id", tenantId)
    .eq("pipeline_type", target_pipe)
    .eq("is_active", true);

  const validKeys = (stages || []).map((s: { stage_key: string }) => s.stage_key);
  const stageKeys =
    validKeys.length > 0
      ? validKeys
      : target_pipe === "whatsapp"
        ? ["novo", "abordado", "respondeu", "esfriou", "agendado"]
        : [];

  if (stageKeys.length > 0 && !stageKeys.some((k: string) => k.toLowerCase() === normalizedStage)) {
    return { success: false, error: `Etapa inválida para funil ${target_pipe}. Use: ${stageKeys.join(", ")}` };
  }

  const finalStage = stageKeys.find((k: string) => k.toLowerCase() === normalizedStage) || normalizedStage;

  switch (target_pipe) {
    case "whatsapp":
      await supabase.from("leads").update({ pipe_whatsapp: finalStage }).eq("id", lead_id);
      await upsertPipeWhatsapp(supabase, lead_id, tenantId, finalStage);
      break;
    case "confirmacao":
    case "propostas":
      await executeMoveToPipe(supabase, lead_id, tenantId, target_pipe, finalStage);
      break;
    case "upsell_base":
      await supabase.from("upsell_clients").update({ tipo_cliente_tempo: finalStage }).eq("lead_id", lead_id);
      break;
    case "upsell_gestao":
      await supabase.from("upsell_clients").update({ gestao_stage: finalStage }).eq("lead_id", lead_id);
      break;
    case "campanha": {
      const { data: campStage } = await supabase
        .from("campanha_stages")
        .select("id")
        .ilike("name", finalStage)
        .limit(1)
        .maybeSingle();
      if (campStage) {
        await supabase.from("campanha_leads").update({ stage_id: campStage.id }).eq("lead_id", lead_id);
      }
      break;
    }
    default:
      return { success: false, error: `Funil não suportado: ${target_pipe}` };
  }

  const pipeLabels: Record<string, string> = {
    whatsapp: "WhatsApp",
    confirmacao: "Confirmação",
    propostas: "Propostas",
    upsell_base: "Carteira Base",
    upsell_gestao: "Carteira Gestão",
    campanha: "Campanhas",
  };

  return {
    success: true,
    message: `Lead movido para ${finalStage} no funil ${pipeLabels[target_pipe] || target_pipe}`,
    data: { target_stage: finalStage, target_pipe },
  };
}

async function executeConfirmMeeting(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const lead_id = params.lead_id as string;
  const confirmationType = (params.confirmation_type as string) || "pre_confirmed";

  if (!lead_id) return { success: false, error: "lead_id é obrigatório" };

  const { data: existing } = await supabase
    .from("pipe_confirmacao")
    .select("id, status")
    .eq("lead_id", lead_id)
    .maybeSingle();

  if (!existing) {
    return { success: false, error: "Lead não encontrado no pipe de confirmação" };
  }

  await supabase.from("pipe_confirmacao").update({ is_confirmed: true }).eq("id", existing.id);

  if (confirmationType === "confirmed") {
    await supabase.from("pipe_confirmacao").update({ status: "confirmacao_no_dia" }).eq("id", existing.id);
    return { success: true, message: "Reunião confirmada no dia", data: { confirmation_type: "confirmed" } };
  }

  return { success: true, message: "Reunião pré-confirmada", data: { confirmation_type: "pre_confirmed" } };
}

async function executeAdvanceConfirmationStage(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const lead_id = params.lead_id as string;
  const targetStage = params.target_stage as string;

  if (!lead_id || !targetStage) {
    return { success: false, error: "lead_id e target_stage são obrigatórios" };
  }

  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("stage_key")
    .eq("organization_id", tenantId)
    .eq("pipeline_type", "confirmacao")
    .eq("is_active", true);

  const validKeys = (stages || []).map((s: { stage_key: string }) => s.stage_key);
  const stageKeys =
    validKeys.length > 0
      ? validKeys
      : [
          "reuniao_marcada", "confirmar_d5", "confirmar_d3", "confirmar_d1",
          "confirmacao_no_dia", "remarcar", "compareceu", "perdido",
        ];

  const normalizedStage = String(targetStage).trim().toLowerCase();
  if (!stageKeys.some((k: string) => k.toLowerCase() === normalizedStage)) {
    return { success: false, error: `Etapa inválida. Use: ${stageKeys.join(", ")}` };
  }

  const finalStage = stageKeys.find((k: string) => k.toLowerCase() === normalizedStage) || normalizedStage;

  const { data: existing } = await supabase
    .from("pipe_confirmacao")
    .select("id")
    .eq("lead_id", lead_id)
    .maybeSingle();

  if (!existing) {
    return { success: false, error: "Lead não encontrado no pipe de confirmação" };
  }

  await supabase.from("pipe_confirmacao").update({ status: finalStage }).eq("id", existing.id);

  return { success: true, message: `Lead movido para ${finalStage} no pipe de confirmação`, data: { target_stage: finalStage } };
}

async function executeCreateCustomField(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const { field_name, field_type, field_options, initial_value } = params as {
    field_name?: string;
    field_type?: string;
    field_options?: string[];
    initial_value?: string;
  };
  const currentLeadId = params.current_lead_id as string | undefined;

  if (!field_name || !field_type) {
    return { success: false, error: "field_name e field_type são obrigatórios" };
  }

  const validTypes = ["text", "number", "date", "select", "boolean"];
  if (!validTypes.includes(field_type)) {
    return { success: false, error: `field_type inválido. Use: ${validTypes.join(", ")}` };
  }

  if (field_type === "select" && (!field_options || !Array.isArray(field_options) || field_options.length === 0)) {
    return { success: false, error: "field_options obrigatório para tipo select" };
  }

  const { data: existing } = await supabase
    .from("lead_custom_fields")
    .select("id")
    .eq("organization_id", tenantId)
    .eq("field_name", field_name)
    .maybeSingle();

  let fieldId: string;

  if (existing) {
    fieldId = existing.id;
  } else {
    const { data: maxOrder } = await supabase
      .from("lead_custom_fields")
      .select("display_order")
      .eq("organization_id", tenantId)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextOrder = (maxOrder?.display_order ?? 0) + 1;

    const { data: newField, error: createError } = await supabase
      .from("lead_custom_fields")
      .insert({
        organization_id: tenantId,
        field_name,
        field_type,
        field_options: field_type === "select" ? field_options : null,
        is_required: false,
        display_order: nextOrder,
      })
      .select("id")
      .single();

    if (createError) {
      return { success: false, error: `Erro ao criar campo: ${createError.message}` };
    }
    fieldId = newField.id;
  }

  if (initial_value && currentLeadId) {
    await supabase
      .from("lead_custom_field_values")
      .upsert(
        {
          lead_id: currentLeadId,
          field_id: fieldId,
          value: String(initial_value).trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "lead_id,field_id" },
      );
  }

  return {
    success: true,
    message: existing
      ? `Campo "${field_name}" já existia${initial_value ? ` (valor: ${initial_value})` : ""}`
      : `Campo "${field_name}" criado${initial_value ? ` (valor: ${initial_value})` : ""}`,
    data: { field_id: fieldId, field_name },
  };
}

// ─── Automation Executor ──────────────────────────────────────────────────────

async function executeAutomation(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  organizationId: string,
  leadId: string | null,
): Promise<ActionResult> {
  if (!leadId) return { success: false, error: "lead_id é obrigatório para automação" };

  const actionConfig = payload.action_config as Record<string, unknown>;
  const actionType = payload.action_type as string;

  if (!actionConfig) return { success: false, error: "action_config ausente no payload" };

  // Promover shadow lead antes de executar ações
  if (actionType === "qualify" || actionType === "disqualify") {
    const moveToPipe = actionConfig.moveToPipe as { pipe?: string; stage?: string } | undefined;
    const destination =
      moveToPipe && moveToPipe.stage
        ? { pipe: moveToPipe.pipe || "whatsapp", stage: moveToPipe.stage }
        : {
            pipe: "whatsapp",
            stage: (actionConfig.moveToStage as string) || (actionType === "qualify" ? "respondeu" : "esfriou"),
          };

    await promoveShadowLead(supabase, leadId, organizationId, destination);
  }

  // Atualizar lead
  const updates: Record<string, unknown> = {};

  if (actionType === "need_human") {
    updates.ai_disabled = true;
    updates.ai_disabled_at = new Date().toISOString();
  }

  if (actionConfig.moveToStage) {
    updates.pipe_whatsapp = actionConfig.moveToStage;
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase.from("leads").update(updates).eq("id", leadId);
    if (updateError) {
      console.warn("[ai-action-executor] Failed to update lead:", updateError);
    } else if (actionConfig.moveToStage) {
      await upsertPipeWhatsapp(supabase, leadId, organizationId, actionConfig.moveToStage as string);
    }
  }

  // Adicionar tags
  const addTags = actionConfig.addTags as string[] | undefined;
  if (addTags && addTags.length > 0) {
    for (const tagName of addTags) {
      let { data: tag } = await supabase.from("tags").select("id").eq("name", tagName).maybeSingle();

      if (!tag) {
        const { data: newTag } = await supabase
          .from("tags")
          .insert({ name: tagName, color: "#6366f1" })
          .select()
          .single();
        tag = newTag;
      }

      if (tag) {
        await supabase.from("lead_tags").upsert(
          { lead_id: leadId, tag_id: tag.id },
          { onConflict: "lead_id,tag_id", ignoreDuplicates: true },
        );
      }
    }
  }

  // Notificar usuário
  if (actionConfig.notifyUserId && actionType === "need_human") {
    try {
      const { data: lead } = await supabase.from("leads").select("name, company").eq("id", leadId).single();
      const leadLabel = lead?.name
        ? lead.company
          ? `${lead.name} - ${lead.company}`
          : lead.name
        : "Lead";

      await supabase.from("notifications").insert({
        organization_id: organizationId,
        user_id: actionConfig.notifyUserId,
        type: "transfer_to_human",
        title: "Lead precisa de atendimento humano",
        description: `${leadLabel} solicitou transferência para um especialista.`,
        lead_id: leadId,
        link: "/pipe-whatsapp",
      });
    } catch (notifErr) {
      console.warn("[ai-action-executor] Failed to create notification:", notifErr);
    }
  }

  // Mover para outro pipe
  const moveToPipe = actionConfig.moveToPipe as { pipe?: string; stage?: string } | undefined;
  if (moveToPipe && moveToPipe.stage) {
    if (moveToPipe.pipe === "confirmacao" || moveToPipe.pipe === "propostas") {
      await executeMoveToPipe(supabase, leadId, organizationId, moveToPipe.pipe, moveToPipe.stage);
    } else if (moveToPipe.pipe === "upsell_base") {
      await supabase.from("upsell_clients").update({ tipo_cliente_tempo: moveToPipe.stage }).eq("lead_id", leadId);
    } else if (moveToPipe.pipe === "upsell_gestao") {
      await supabase.from("upsell_clients").update({ gestao_stage: moveToPipe.stage }).eq("lead_id", leadId);
    }
  }

  return { success: true, message: `Automação ${actionType} executada` };
}

// ─── Pipeline Stage Update ────────────────────────────────────────────────────

async function executeUpdatePipelineStage(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  organizationId: string,
): Promise<ActionResult> {
  const leadId = params.lead_id as string;
  const newStage = params.new_stage as string;

  if (!leadId || !newStage) {
    return { success: false, error: "lead_id e new_stage são obrigatórios" };
  }

  await supabase.from("leads").update({ pipe_whatsapp: newStage }).eq("id", leadId);
  await upsertPipeWhatsapp(supabase, leadId, organizationId, newStage);

  return { success: true, message: `Pipeline atualizado para ${newStage}`, data: { new_stage: newStage } };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function executeMoveToPipe(
  supabase: SupabaseClient,
  leadId: string,
  organizationId: string,
  pipe: string,
  stage: string,
) {
  try {
    if (pipe === "confirmacao") {
      const { data: existing } = await supabase
        .from("pipe_confirmacao")
        .select("id")
        .eq("lead_id", leadId)
        .maybeSingle();

      if (existing) {
        await supabase.from("pipe_confirmacao").update({ status: stage }).eq("id", existing.id);
      } else {
        await supabase.from("pipe_confirmacao").insert({
          lead_id: leadId,
          organization_id: organizationId,
          status: stage,
        });
      }
    } else {
      const { data: existing } = await supabase
        .from("pipe_propostas")
        .select("id")
        .eq("lead_id", leadId)
        .maybeSingle();

      if (existing) {
        await supabase.from("pipe_propostas").update({ status: stage }).eq("id", existing.id);
      } else {
        await supabase.from("pipe_propostas").insert({
          lead_id: leadId,
          organization_id: organizationId,
          status: stage,
        });
      }
    }

    // Remover do pipe WhatsApp
    await supabase.from("pipe_whatsapp").delete().eq("lead_id", leadId);
  } catch (e) {
    console.warn("[ai-action-executor] Failed to execute moveToPipe:", e);
  }
}

async function upsertPipeWhatsapp(
  supabase: SupabaseClient,
  leadId: string,
  organizationId: string,
  status: string,
) {
  try {
    const { data: existing } = await supabase
      .from("pipe_whatsapp")
      .select("id")
      .eq("lead_id", leadId)
      .maybeSingle();

    if (existing) {
      await supabase.from("pipe_whatsapp").update({ status }).eq("id", existing.id);
    } else {
      await supabase.from("pipe_whatsapp").insert({ lead_id: leadId, organization_id: organizationId, status });
    }
  } catch (e) {
    console.warn("[ai-action-executor] Failed to upsert pipe_whatsapp:", e);
  }
}

// ── Send Document to Lead via WhatsApp ───────────────────────────────────────

async function executeSendDocument(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  organizationId: string,
  leadId: string | null,
): Promise<ActionResult> {
  const documentId = payload.document_id as string;
  const caption = payload.caption as string | undefined;

  if (!documentId) {
    return { success: false, error: "document_id is required" };
  }
  if (!leadId) {
    return { success: false, error: "lead_id is required to send document" };
  }

  // 1. Buscar documento e metadados
  const { data: doc, error: docError } = await supabase
    .from("copilot_agent_documents")
    .select("id, file_name, file_path, mime_type, organization_id, file_type")
    .eq("id", documentId)
    .eq("organization_id", organizationId)
    .single();

  if (docError || !doc) {
    return { success: false, error: `Document not found: ${docError?.message || "not found"}` };
  }

  // 2. Gerar URL assinada (valida por 1 hora)
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("agent-documents")
    .createSignedUrl(doc.file_path, 3600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return { success: false, error: `Failed to generate signed URL: ${signedUrlError?.message || "unknown"}` };
  }

  // 3. Buscar telefone do lead e instancia WhatsApp
  const { data: lead } = await supabase
    .from("leads")
    .select("phone")
    .eq("id", leadId)
    .single();

  if (!lead?.phone) {
    return { success: false, error: "Lead has no phone number" };
  }

  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("instance_name")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (!instance?.instance_name) {
    return { success: false, error: "No active WhatsApp instance found" };
  }

  // 4. Enviar via Evolution API
  const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
  const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return { success: false, error: "Evolution API not configured" };
  }

  let phone = lead.phone.replace(/\D/g, "");
  if (!phone.startsWith("55")) phone = "55" + phone;

  // Detect media type based on file_type column (image/video/document)
  const fileType = (doc as any).file_type || "document";
  let mediatype = "document";
  let messageType = "document";
  if (fileType === "image" || (doc.mime_type && doc.mime_type.startsWith("image/"))) {
    mediatype = "image";
    messageType = "image";
  } else if (fileType === "video" || (doc.mime_type && doc.mime_type.startsWith("video/"))) {
    mediatype = "video";
    messageType = "video";
  }

  const sendBody: Record<string, unknown> = {
    number: phone,
    mediatype,
    media: signedUrlData.signedUrl,
    fileName: doc.file_name,
  };
  if (caption) sendBody.caption = caption;

  try {
    const response = await fetch(
      `${EVOLUTION_API_URL}/message/sendMedia/${instance.instance_name}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
        body: JSON.stringify(sendBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Evolution API error: HTTP ${response.status}: ${errorText}` };
    }

    const sendResult = await response.json();

    // 5. Registrar mensagem de saida
    await supabase.from("whatsapp_messages").insert({
      organization_id: organizationId,
      message_id: sendResult.key?.id || `doc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      remote_jid: `${phone}@s.whatsapp.net`,
      phone_number: phone,
      direction: "outgoing",
      message_type: messageType,
      content: caption || `[${messageType === "image" ? "Imagem" : messageType === "video" ? "Video" : "Documento"}: ${doc.file_name}]`,
      media_url: signedUrlData.signedUrl,
      status: "sent",
      timestamp: new Date().toISOString(),
      sent_by_ai: true,
    }).catch(e => console.warn("[executeSendDocument] Failed to log outgoing message:", e));

    return {
      success: true,
      message: `Documento "${doc.file_name}" enviado com sucesso`,
      data: { file_name: doc.file_name, message_id: sendResult.key?.id },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to send document: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
