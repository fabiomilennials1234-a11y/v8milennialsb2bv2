/**
 * Editor inline de data de reunião pro funil mergeado, montado dentro do modal
 * do lead (ADR-0004). Slot do PipeOpsPort: implementação vive em pipelines,
 * renderizada por leads (CrossPipePanel) — mesma inversão do RescheduleModal.
 *
 * Grava meeting_date na entry whatsapp:agendado E cria o evento no Google
 * Calendar (paridade com o fluxo legacy de Agendamentos).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { MergedMeetingEditorSlotProps } from "@/modules/leads";
import { useSetMeetingDate } from "../../hooks/model/useSetMeetingDate";
import { useCreateMeetingEvent } from "../../hooks/model/useCreateMeetingEvent";

/** ISO → "YYYY-MM-DDTHH:mm" (datetime-local, hora local do navegador). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MergedMeetingEditor({
  entryId,
  leadId,
  leadName,
  leadCompany,
  leadPhone,
  currentMeetingDate,
  locked,
}: MergedMeetingEditorSlotProps) {
  const [value, setValue] = useState<string>(toLocalInput(currentMeetingDate));
  const setMeetingDate = useSetMeetingDate();
  const createEvent = useCreateMeetingEvent();
  const pending = setMeetingDate.isPending || createEvent.isPending;

  // Nome do lead pro título do evento (CrossPipePanel pode não passar).
  const { data: fetchedName } = useQuery({
    queryKey: ["lead-name", leadId],
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("name, company, phone").eq("id", leadId).single();
      return data;
    },
    enabled: !leadName && !!leadId,
    staleTime: 60_000,
  });
  const resolvedName = leadName ?? fetchedName?.name ?? null;
  const resolvedCompany = leadCompany ?? fetchedName?.company ?? null;
  const resolvedPhone = leadPhone ?? fetchedName?.phone ?? null;

  const save = () => {
    if (!value) return;
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return;
    const meetingDate = dt.toISOString();

    setMeetingDate.mutate(
      { entryId, meetingDate },
      {
        onSuccess: () => {
          toast.success("Data da reunião salva.");
          if (leadId && resolvedName) {
            createEvent.mutate(
              { leadId, leadName: resolvedName, leadCompany: resolvedCompany, leadPhone: resolvedPhone, meetingDateISO: meetingDate },
              {
                onSuccess: (r) => {
                  if (r?.meetLink) toast.success("Evento criado no Google Calendar (link do Meet gerado).");
                  else if (createEvent.calendarConnected) toast.success("Evento criado no Google Calendar.");
                },
                onError: () => toast.warning("Data salva, mas falhou criar o evento no Google Calendar."),
              },
            );
          }
        },
      },
    );
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs flex items-center gap-1.5">
        <CalendarClock className="w-3.5 h-3.5" /> Data e hora da reunião
      </Label>
      <Input
        type="datetime-local"
        value={value}
        disabled={locked || pending}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button size="sm" className="w-full" onClick={save} disabled={locked || pending || !value}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Salvar reunião
      </Button>
    </div>
  );
}
