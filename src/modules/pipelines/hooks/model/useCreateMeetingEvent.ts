/**
 * Cria o evento no Google Calendar para uma reunião do funil mergeado (ADR-0004).
 *
 * Mesmo caminho do fluxo legacy (AddMeetingModal/RescheduleModal): POST direto
 * pra edge function `google-calendar-events`. Mira o pipe whatsapp:agendado pro
 * meet_link (em vez de confirmacao). Best-effort: se o usuário não tem calendário
 * conectado, vira no-op silencioso (não bloqueia o agendamento).
 */
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/modules/identity";
import { useGoogleCalendarStatus } from "@/modules/integrations/hooks/useGoogleCalendar";

interface CreateMeetingEventArgs {
  leadId: string;
  leadName: string;
  leadCompany?: string | null;
  leadPhone?: string | null;
  meetingDateISO: string;
}

export function useCreateMeetingEvent() {
  const { session } = useAuth();
  const { data: calStatus } = useGoogleCalendarStatus();

  const mutation = useMutation({
    mutationFn: async (args: CreateMeetingEventArgs): Promise<{ meetLink: string | null } | null> => {
      // Sem conexão de calendário → no-op (não falha o agendamento).
      if (!calStatus?.connected || !session?.access_token || !session.user?.id) return null;

      const start = new Date(args.meetingDateISO);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const url = `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "")}/functions/v1/google-calendar-events`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `${args.leadName} - Reunião`,
          description: [args.leadName, args.leadCompany, args.leadPhone].filter(Boolean).join(" · "),
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          timezone: "America/Sao_Paulo",
          lead_id: args.leadId,
          calendar_owner_id: session.user.id,
          pipe_slug: "whatsapp",
          pipe_stage_key: "agendado",
        }),
      });
      if (!res.ok) throw new Error(`google-calendar-events ${res.status}`);
      const data = await res.json().catch(() => ({}));
      return { meetLink: data?.meet_link ?? null };
    },
  });

  return { ...mutation, calendarConnected: !!calStatus?.connected };
}
