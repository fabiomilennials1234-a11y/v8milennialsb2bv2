/**
 * AI Action handlers — agendamento de reuniões.
 *
 *  - executeScheduleMeeting: cria entrada em pipe_confirmacao + Google Calendar
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

  // F5b: Time-Aware validation — bloqueia slot fora de janela com behavior preenchido.
  // Janela com behavior vazio = "off-hours window" (canned/sem instrução), não permite agendar.
  // Apenas se agente tiver behavior_windows configurado (≥1 janela com behavior); caso contrário, pass-through.
  if (conversationId) {
    const ctx = await loadAgentTimeContext(supabase, conversationId);
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

  return {
    success: true,
    message: meetLink ? "Reunião agendada e evento criado no Google Calendar" : "Reunião agendada",
    data: { meeting_date: preferred_date, ...(meetLink ? { meet_link: meetLink } : {}) },
  };
}

export async function executeConfirmMeeting(
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
    await supabase
      .from("pipe_confirmacao")
      .update({ status: "confirmacao_no_dia" })
      .eq("id", existing.id);
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

  const { data: existing } = await supabase
    .from("pipe_confirmacao")
    .select("id")
    .eq("lead_id", lead_id)
    .maybeSingle();

  if (!existing) {
    return { success: false, error: "Lead não encontrado no pipe de confirmação" };
  }

  await supabase.from("pipe_confirmacao").update({ status: finalStage }).eq("id", existing.id);

  return {
    success: true,
    message: `Lead movido para ${finalStage} no pipe de confirmação`,
    data: { target_stage: finalStage },
  };
}
