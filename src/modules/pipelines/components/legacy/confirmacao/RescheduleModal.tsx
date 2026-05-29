import { useState, useEffect, useMemo, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CalendarIcon, Loader2, Video, RefreshCw } from "lucide-react";
import { format, differenceInCalendarDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useUpdatePipeConfirmacao, type PipeConfirmacaoStatus } from "@/modules/pipelines/hooks/legacy/usePipeConfirmacao";
import { useLogLeadAction } from "@/modules/leads";
import { useGoogleCalendarStatus } from "@/modules/integrations/hooks/useGoogleCalendar";
import { useCalendarSharing } from "@/modules/integrations/hooks/useGoogleCalendarSharing";
import { useAuth } from "@/modules/identity";
import { toast } from "sonner";

export type ReschedulingMode = "schedule" | "reschedule";

interface RescheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /**
   * "schedule" → contexto: marcar reunião (drag para "Reunião Marcada").
   * "reschedule" → contexto: remarcar reunião existente.
   */
  mode?: ReschedulingMode;
  /** pipe_confirmacao row */
  pipeItem: {
    id: string;
    lead_id: string;
    lead?: { name?: string; company?: string; phone?: string } | null;
    responsible_id?: string | null;
    sdr_id?: string | null;
    closer_id?: string | null;
    meeting_date?: string | null;
  } | null;
}

const COPY: Record<ReschedulingMode, {
  title: string;
  description: (leadName: string) => ReactNode;
  dateLabel: string;
  submitButton: string;
  submitting: string;
  actionLog: string;
  logDescription: (when: string) => string;
  gcalEventTitle: (leadName: string) => string;
  gcalEventNote: (leadName: string) => string;
  toastSuccess: string;
  toastSuccessWithMeet: { title: string; description: string };
  toastSuccessWithEvent: string;
  toastWarnGcal: string;
}> = {
  schedule: {
    title: "Agendar Reunião",
    description: (leadName) => <>Selecione o dia e horário da reunião com <span className="font-medium text-foreground">{leadName}</span></>,
    dateLabel: "Data *",
    submitButton: "Agendar",
    submitting: "Agendando...",
    actionLog: "meeting_scheduled",
    logDescription: (when) => `Reunião agendada para ${when}`,
    gcalEventTitle: (leadName) => `${leadName} - Reunião`,
    gcalEventNote: (leadName) => `Reunião com lead: ${leadName}`,
    toastSuccess: "Reunião agendada com sucesso!",
    toastSuccessWithMeet: { title: "Reunião agendada!", description: "Link do Google Meet gerado." },
    toastSuccessWithEvent: "Reunião agendada e evento criado no Google Calendar!",
    toastWarnGcal: "Não foi possível criar o evento no Google Calendar",
  },
  reschedule: {
    title: "Remarcar Reunião",
    description: (leadName) => <>Selecione o novo dia e horário para <span className="font-medium text-foreground">{leadName}</span></>,
    dateLabel: "Nova Data *",
    submitButton: "Remarcar",
    submitting: "Remarcando...",
    actionLog: "meeting_rescheduled",
    logDescription: (when) => `Reunião remarcada para ${when}`,
    gcalEventTitle: (leadName) => `${leadName} - Reunião (Remarcada)`,
    gcalEventNote: (leadName) => `Reunião remarcada com lead: ${leadName}`,
    toastSuccess: "Reunião remarcada com sucesso!",
    toastSuccessWithMeet: { title: "Reunião remarcada!", description: "Novo link do Google Meet gerado." },
    toastSuccessWithEvent: "Reunião remarcada e evento criado no Google Calendar!",
    toastWarnGcal: "Não foi possível criar o evento no Google Calendar",
  },
};

function calculateNewStatus(meetingDate: Date): PipeConfirmacaoStatus {
  const today = startOfDay(new Date());
  const meetingDay = startOfDay(meetingDate);
  const calendarDays = differenceInCalendarDays(meetingDay, today);

  if (calendarDays < 0) return "remarcar";
  if (calendarDays === 0) return "confirmacao_no_dia";
  if (calendarDays === 1) return "confirmar_d1";
  if (calendarDays === 2) return "confirmar_d2";
  if (calendarDays === 3) return "confirmar_d3";
  if (calendarDays <= 5) return "confirmar_d5";
  return "reuniao_marcada";
}

export function RescheduleModal({ open, onOpenChange, onSuccess, pipeItem, mode = "schedule" }: RescheduleModalProps) {
  const copy = COPY[mode];
  const [meetingDate, setMeetingDate] = useState<Date | undefined>();
  const [meetingTime, setMeetingTime] = useState("10:00");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Google Calendar
  const [createGoogleEvent, setCreateGoogleEvent] = useState(true);
  const [calendarOwnerId, setCalendarOwnerId] = useState("");

  const { session } = useAuth();
  const updatePipeConfirmacao = useUpdatePipeConfirmacao();
  const logAction = useLogLeadAction();
  const { data: calStatus } = useGoogleCalendarStatus();
  const { data: sharingData } = useCalendarSharing();

  const ownUserId = session?.user?.id ?? "";

  const calendarOptions = useMemo(() => {
    const opts: { id: string; label: string }[] = [];
    if (calStatus?.connected) {
      const emailLabel = calStatus.google_email ? ` (${calStatus.google_email})` : "";
      opts.push({ id: ownUserId, label: `Meu Calendário${emailLabel}` });
    }
    sharingData?.incoming
      ?.filter((s) => s.can_create_events)
      .forEach((share) => {
        if (share.owner?.name) {
          opts.push({ id: share.owner_id, label: share.owner.name });
        }
      });
    return opts;
  }, [calStatus, sharingData, ownUserId]);

  useEffect(() => {
    if (calendarOptions.length > 0 && !calendarOwnerId) {
      setCalendarOwnerId(calendarOptions[0].id);
    }
  }, [calendarOptions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset on open
  useEffect(() => {
    if (!open) {
      setMeetingDate(undefined);
      setMeetingTime("10:00");
      setCreateGoogleEvent(true);
      setCalendarOwnerId(calendarOptions[0]?.id ?? "");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!pipeItem) return;

    if (!meetingDate) {
      toast.error("Selecione a nova data da reunião");
      return;
    }

    setIsSubmitting(true);
    try {
      const [hours, minutes] = meetingTime.split(":");
      const meetingDateTime = new Date(meetingDate);
      meetingDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      const newStatus = calculateNewStatus(meetingDateTime);

      await updatePipeConfirmacao.mutateAsync({
        id: pipeItem.id,
        meeting_date: meetingDateTime.toISOString(),
        status: newStatus,
        leadId: pipeItem.lead_id,
        assignedTo: pipeItem.sdr_id || pipeItem.closer_id,
      });

      logAction({
        leadId: pipeItem.lead_id,
        action: copy.actionLog,
        description: copy.logDescription(format(meetingDateTime, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })),
      });

      // Google Calendar event
      if (createGoogleEvent && calendarOwnerId && session?.access_token) {
        try {
          const leadName = pipeItem.lead?.name ?? "Lead";
          const url = `${(import.meta.env.VITE_SUPABASE_URL as string ?? "").replace(/\/$/, "")}/functions/v1/google-calendar-events`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: copy.gcalEventTitle(leadName),
              description: [
                copy.gcalEventNote(leadName),
                pipeItem.lead?.company ? `Empresa: ${pipeItem.lead.company}` : null,
                pipeItem.lead?.phone ? `Telefone: ${pipeItem.lead.phone}` : null,
              ]
                .filter(Boolean)
                .join("\n"),
              start_at: meetingDateTime.toISOString(),
              end_at: new Date(meetingDateTime.getTime() + 60 * 60 * 1000).toISOString(),
              timezone: "America/Sao_Paulo",
              lead_id: pipeItem.lead_id,
              pipe_confirmacao_id: pipeItem.id,
              calendar_owner_id: calendarOwnerId,
            }),
          });

          if (res.ok) {
            const gcData = await res.json();
            if (gcData.meet_link) {
              toast.success(copy.toastSuccessWithMeet.title, { description: copy.toastSuccessWithMeet.description });
            } else {
              toast.success(copy.toastSuccessWithEvent);
            }
          } else {
            toast.success(copy.toastSuccess);
            toast.warning(copy.toastWarnGcal);
          }
        } catch {
          toast.success(copy.toastSuccess);
          toast.warning(copy.toastWarnGcal);
        }
      } else {
        toast.success(copy.toastSuccess);
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast.error(mode === "schedule" ? "Erro ao agendar reunião" : "Erro ao remarcar reunião");
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasCalendars = calendarOptions.length > 0;
  const leadName = pipeItem?.lead?.name ?? "Lead";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "schedule" ? <CalendarIcon className="w-5 h-5 text-primary" /> : <RefreshCw className="w-5 h-5 text-primary" />}
            {copy.title}
          </DialogTitle>
          <DialogDescription>
            {copy.description(leadName)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{copy.dateLabel}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !meetingDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {meetingDate ? format(meetingDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={meetingDate}
                    onSelect={setMeetingDate}
                    locale={ptBR}
                    disabled={(date) => date < startOfDay(new Date())}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Horário *</Label>
              <Input
                type="time"
                value={meetingTime}
                onChange={(e) => setMeetingTime(e.target.value)}
              />
            </div>
          </div>

          {/* Preview: where the card will land */}
          {meetingDate && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">O lead será movido para</p>
              <p className="text-sm font-semibold text-primary">
                {(() => {
                  const [h, m] = meetingTime.split(":");
                  const dt = new Date(meetingDate);
                  dt.setHours(parseInt(h), parseInt(m), 0, 0);
                  const status = calculateNewStatus(dt);
                  const labels: Record<string, string> = {
                    reuniao_marcada: "Reunião Marcada",
                    confirmar_d5: "Confirmar D-5",
                    confirmar_d3: "Confirmar D-3",
                    confirmar_d2: "Confirmar D-2",
                    confirmar_d1: "Confirmar D-1",
                    confirmacao_no_dia: "Confirmação no Dia",
                    remarcar: "Remarcar",
                  };
                  return labels[status] ?? status;
                })()}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {format(meetingDate, "EEEE, dd 'de' MMMM", { locale: ptBR })} as {meetingTime}
              </p>
            </div>
          )}

          {/* Google Calendar */}
          {hasCalendars && (
            <div className="rounded-lg border border-border/50 p-3 space-y-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">Google Calendar</span>
                </div>
                <Switch checked={createGoogleEvent} onCheckedChange={setCreateGoogleEvent} />
              </div>

              {createGoogleEvent && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Em qual agenda criar o evento?</Label>
                  <Select value={calendarOwnerId} onValueChange={setCalendarOwnerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a agenda" />
                    </SelectTrigger>
                    <SelectContent>
                      {calendarOptions.map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Um novo evento com Google Meet será criado para o novo horário.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || !meetingDate} className="gradient-gold">
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isSubmitting ? copy.submitting : copy.submitButton}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
