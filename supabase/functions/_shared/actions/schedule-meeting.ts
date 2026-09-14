/**
 * AI Action handlers — agendamento de reuniões.
 *
 *  - executeScheduleMeeting: cria reunião em meetings + Google Calendar
 *  - executeConfirmMeeting: marca confirmação (pré ou no-dia)
 *  - executeAdvanceConfirmationStage: move stage no funil de confirmação
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildDateInTimezone,
  loadAgentTimeContext,
  resolveActiveWindow,
} from "../copilot/time-context.ts";
import {
  getValidAccessToken,
  logCalendarOp,
} from "../google-calendar-utils.ts";
import { getPipeEntry, updatePipeEntryById } from "../pipeline-adapter.ts";
import { enqueueAiAction } from "../ai-queue.ts";
import { scheduleMeeting } from "../action-handlers/schedule-meeting.ts";
import type { ActionResult } from "./types.ts";

export async function executeScheduleMeeting(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  tenantId: string,
  conversationId: string | null,
): Promise<ActionResult> {
  const lead_id = params.lead_id as string;
  const preferred_date = params.preferred_date as string;
  const preferred_time = params.preferred_time as string | undefined;

  if (!lead_id || !preferred_date) {
    return { success: false, error: "lead_id e preferred_date são obrigatórios" };
  }

  let meetingTimezone = "America/Sao_Paulo";
  // F5b: Time-Aware validation
  if (conversationId) {
    const ctx = await loadAgentTimeContext(supabase, conversationId);
    meetingTimezone = ctx?.availability?.timezone || meetingTimezone;
    const windows = ctx?.behavior_windows ?? [];
    const anyWithBehavior = windows.some((w) => (w.behavior || "").trim().length > 0);
    if (anyWithBehavior) {
      const tz = ctx?.availability?.timezone || "America/Sao_Paulo";
      const targetDate = buildDateInTimezone(preferred_date, preferred_time || "09:00", tz);
      if (targetDate) {
        const slotCtx = resolveActiveWindow(
          { behavior_windows: windows, availability: ctx?.availability ?? null },
          targetDate,
        );
        if (!slotCtx || !slotCtx.hasBehavior) {
          return {
            success: false,
            error: `Horário ${preferred_date} ${preferred_time || "09:00"} cai fora de janela comercial configurada do agente. Escolha um horário dentro de uma janela ativa.`,
          };
        }
      }
    }
  }

  const start = preferred_date.includes("T")
    ? new Date(preferred_date)
    : buildDateInTimezone(preferred_date, preferred_time || "09:00", meetingTimezone);
  if (!start || !Number.isFinite(start.getTime())) return { success: false, error: "Data de reunião inválida" };
  const scheduled = await scheduleMeeting({
    supabase, organizationId: tenantId, leadId: lead_id,
    entryId: typeof params.pipeline_entry_id === "string" ? params.pipeline_entry_id : null,
    dealId: typeof params.deal_id === "string" ? params.deal_id : null,
    conversationId,
    params: { date: start.toISOString(), title: params.title, notes: params.notes, assigned_to: params.assigned_to,
      external_ref: `automation:meeting:${params.pipeline_entry_id ?? lead_id}:${start.toISOString()}` },
  });
  if (!scheduled.success) return scheduled;
  const meetingId = scheduled.data?.meeting_id;
  if (scheduled.data?.idempotent) return { success: true, message: "Reunião já agendada", data: scheduled.data };

  // 2. Tentar Google Calendar (graceful degradation)
  let meetLink: string | null = null;
  try {
    const { data: lead } = await supabase
      .from("leads")
      .select("name, email, responsible_id, sdr_id")
      .eq("id", lead_id)
      .eq("organization_id", tenantId)
      .maybeSingle();

    const responsibleUserId = lead?.responsible_id ?? lead?.sdr_id ?? null;

    if (responsibleUserId) {
      const tokenData = await getValidAccessToken(responsibleUserId, supabase);

      if (tokenData) {
        const startIso = start.toISOString();
        const endIso = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
        const timezone = meetingTimezone;

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

          if (meetingId && meetLink) {
            await supabase.from("meetings").update({ meet_link: meetLink, google_event_id: createdEvent.id })
              .eq("id", meetingId).eq("organization_id", tenantId);
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
          console.warn("[executeScheduleMeeting] Google Calendar failed:", errText);
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
    console.warn("[executeScheduleMeeting] Google Calendar error (non-fatal):", calendarErr);
  }

  // 3. Notificação WhatsApp para equipe (determinístico, não-fatal).
  // Enfileira ação separada — desacopla retry/timeout do agendamento em si.
  // Recipiente resolvido pelo handler via handoff_notify_phones do agente.
  try {
    await enqueueAiAction(supabase, {
      organizationId: tenantId,
      leadId: lead_id,
      conversationId: conversationId || undefined,
      actionType: "schedule_meeting_whatsapp_notify",
      payload: {
        lead_id,
        meeting_date: preferred_date,
        meeting_time: preferred_time || "09:00",
        ...(meetLink ? { meet_link: meetLink } : {}),
      },
      idempotencyKey: `meeting_wa_notify_${lead_id}_${preferred_date}`,
    });
  } catch (notifyErr) {
    console.warn("[executeScheduleMeeting] Failed to enqueue WhatsApp notify (non-fatal):", notifyErr);
  }

  return {
    success: true,
    message: meetLink ? "Reunião agendada e evento criado no Google Calendar" : "Reunião agendada",
    data: { meeting_id: meetingId, meeting_date: start.toISOString(), ...(meetLink ? { meet_link: meetLink } : {}) },
  };
}

export async function executeConfirmMeeting(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  tenantId: string,
): Promise<ActionResult> {
  const lead_id = params.lead_id as string;
  const confirmationType = (params.confirmation_type as string) || "pre_confirmed";

  if (!lead_id) return { success: false, error: "lead_id é obrigatório" };

  const existing = await getPipeEntry(supabase, lead_id, tenantId, "confirmacao");

  if (!existing) {
    return { success: false, error: "Lead não encontrado no pipe de confirmação" };
  }

  await updatePipeEntryById(supabase, existing.id, {
    metadata: { is_confirmed: true },
  });

  if (confirmationType === "confirmed") {
    await updatePipeEntryById(supabase, existing.id, {
      stageKey: "confirmacao_no_dia",
    });
    return {
      success: true,
      message: "Reunião confirmada no dia",
      data: { confirmation_type: "confirmed" },
    };
  }

  return {
    success: true,
    message: "Reunião pré-confirmada",
    data: { confirmation_type: "pre_confirmed" },
  };
}

export async function executeAdvanceConfirmationStage(
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
          "reuniao_marcada",
          "confirmar_d5",
          "confirmar_d3",
          "confirmar_d1",
          "confirmacao_no_dia",
          "remarcar",
          "compareceu",
          "perdido",
        ];

  const normalizedStage = String(targetStage).trim().toLowerCase();
  if (!stageKeys.some((k: string) => k.toLowerCase() === normalizedStage)) {
    return { success: false, error: `Etapa inválida. Use: ${stageKeys.join(", ")}` };
  }

  const finalStage =
    stageKeys.find((k: string) => k.toLowerCase() === normalizedStage) || normalizedStage;

  const existing = await getPipeEntry(supabase, lead_id, tenantId, "confirmacao");

  if (!existing) {
    return { success: false, error: "Lead não encontrado no pipe de confirmação" };
  }

  await updatePipeEntryById(supabase, existing.id, { stageKey: finalStage });

  return {
    success: true,
    message: `Lead movido para ${finalStage} no pipe de confirmação`,
    data: { target_stage: finalStage },
  };
}
