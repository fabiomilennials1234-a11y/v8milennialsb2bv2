import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2, CheckCircle2, AlertCircle, Video } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useLeads, useUpdateLead } from "@/modules/leads";
import { useResponsibleMembers } from "@/modules/identity";
import { useCreatePipeConfirmacao, useUpdatePipeConfirmacao, PipeConfirmacaoStatus } from "@/modules/pipelines/hooks/legacy/usePipeConfirmacao";
import { usePipelineId } from "@/modules/pipelines/hooks/model/usePipelineEntries";
import { moverNegocio } from "@/modules/pipelines/lib/moverNegocio";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { useGoogleCalendarStatus } from "@/modules/integrations/hooks/useGoogleCalendar";
import { useCalendarSharing } from "@/modules/integrations/hooks/useGoogleCalendarSharing";
import { useAuth } from "@/modules/identity";
import { toast } from "sonner";
import { logger } from "@/modules/platform";
import { getErrorMessage } from "@/shared/errors";

interface AddMeetingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /** When provided, the lead is pre-selected and locked (no email search / dropdown) */
  prefilledLeadId?: string;
  /**
   * When provided, pre-selects the SDR (pre-sale responsible) for the meeting.
   * Semantically this is the lead's `pre_sale_responsible_id`. If omitted, the
   * value is auto-populated from the lead when one is selected. Submitting
   * with a different value updates the lead before creating the pipe entry —
   * the DB trigger `snapshot_responsible_from_lead` then captures it into
   * `pipeline_entries.metadata.pre_sale_responsible_id`.
   */
  prefilledResponsibleId?: string | null;
  /**
   * Quando informado, o negócio EXISTENTE (`pipeline_entries.id`) é MOVIDO para
   * a Confirmação em vez de um card novo ser criado — ADR-0023 decisão 4.
   *
   * Existe porque este modal é a porta do "agendar reunião" arrastando o card no
   * funil WhatsApp (81 orgs). Sem isto, ele cria o card de Confirmação e a página
   * atualiza o de origem, que fica para trás: o mesmo negócio em dois funis.
   *
   * A ordem interna importa e está comentada no submit. Sem o prop, nada muda —
   * o outro chamador (a própria tela de Confirmação, onde "Nova Reunião" é
   * criação avulsa e não transição) continua criando card.
   */
  moveFromEntryId?: string | null;
  /**
   * Roda ANTES da escrita no funil de destino. É aqui que a página leva o card
   * de origem à etapa de sucesso — o UPDATE que produz `meeting_booked`, porque
   * o gatilho de métrica reage à TRANSIÇÃO para "agendado", não à permanência.
   * Se lançar, nada é escrito no destino.
   */
  beforeSubmit?: () => Promise<void>;
}

export function AddMeetingModal({
  open,
  onOpenChange,
  onSuccess,
  prefilledLeadId,
  prefilledResponsibleId,
  moveFromEntryId,
  beforeSubmit,
}: AddMeetingModalProps) {
  const [email, setEmail] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string>(prefilledLeadId ?? "");
  const [meetingDate, setMeetingDate] = useState<Date | undefined>();
  const [meetingTime, setMeetingTime] = useState("10:00");
  // `sdrId` is the lead's pre_sale_responsible_id. The DB trigger snapshots
  // this into pipeline_entries.metadata.pre_sale_responsible_id at INSERT.
  const [sdrId, setSdrId] = useState<string>(prefilledResponsibleId ?? "");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<PipeConfirmacaoStatus>("reuniao_marcada");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Google Calendar states
  const [createGoogleEvent, setCreateGoogleEvent] = useState(true);
  const [calendarOwnerId, setCalendarOwnerId] = useState<string>("");

  const { session } = useAuth();
  const { data: leads, isLoading: leadsLoading } = useLeads();
  const responsibleMembers = useResponsibleMembers();
  const createPipeConfirmacao = useCreatePipeConfirmacao();
  const updatePipeConfirmacao = useUpdatePipeConfirmacao();
  const { data: confirmacaoPipelineId } = usePipelineId("confirmacao");
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();

  // Google Calendar hooks
  const { data: calStatus } = useGoogleCalendarStatus();
  const { data: sharingData } = useCalendarSharing();

  const ownUserId = session?.user?.id ?? "";

  // Build list of calendars available to create events in
  const calendarOptions = useMemo(() => {
    const opts: { id: string; label: string }[] = [];
    if (calStatus?.connected) {
      const emailLabel = calStatus.google_email ? ` (${calStatus.google_email})` : "";
      opts.push({ id: ownUserId, label: `Meu Calendário${emailLabel}` });
    }
    // Incoming shares where the owner gave us permission to create events
    sharingData?.incoming
      ?.filter((s) => s.can_create_events)
      .forEach((share) => {
        if (share.owner?.name) {
          opts.push({ id: share.owner_id, label: share.owner.name });
        }
      });
    return opts;
  }, [calStatus, sharingData, ownUserId]);

  // Auto-select first available calendar
  useEffect(() => {
    if (calendarOptions.length > 0 && !calendarOwnerId) {
      setCalendarOwnerId(calendarOptions[0].id);
    }
  }, [calendarOptions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Find lead by email
  const foundLeadByEmail = useMemo(() => {
    if (!email.trim() || !leads) return null;
    return leads.find(lead =>
      lead.email?.toLowerCase().trim() === email.toLowerCase().trim()
    ) || null;
  }, [email, leads]);

  // Auto-select lead when found by email
  useEffect(() => {
    if (foundLeadByEmail) {
      setSelectedLeadId(foundLeadByEmail.id);
    }
  }, [foundLeadByEmail]);

  // Resolved lead for the currently selected id (used to pre-fill the SDR
  // field from the lead's `pre_sale_responsible_id`).
  const resolvedLead = useMemo(() => {
    if (!selectedLeadId || !leads) return null;
    return leads.find((l) => l.id === selectedLeadId) ?? null;
  }, [selectedLeadId, leads]);

  // Sync prefilled values when the modal opens or prefilled props change.
  useEffect(() => {
    if (open) {
      if (prefilledLeadId) setSelectedLeadId(prefilledLeadId);
      if (prefilledResponsibleId) setSdrId(prefilledResponsibleId);
    }
  }, [open, prefilledLeadId, prefilledResponsibleId]);

  // Auto-populate SDR from the lead's pre_sale_responsible_id whenever the
  // selected lead changes — unless the caller has explicitly pre-filled the
  // SDR via prefilledResponsibleId (we respect that override).
  useEffect(() => {
    if (!open) return;
    if (prefilledResponsibleId) return;
    const leadPreSale = (resolvedLead?.pre_sale_responsible_id as string | null) ?? "";
    setSdrId(leadPreSale);
  }, [open, resolvedLead, prefilledResponsibleId]);

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setEmail("");
      setSelectedLeadId(prefilledLeadId ?? "");
      setMeetingDate(undefined);
      setMeetingTime("10:00");
      setSdrId(prefilledResponsibleId ?? "");
      setNotes("");
      setStatus("reuniao_marcada");
      setCreateGoogleEvent(true);
      setCalendarOwnerId(calendarOptions[0]?.id ?? "");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!selectedLeadId) {
      toast.error("Selecione um lead");
      return;
    }

    if (!meetingDate) {
      toast.error("Selecione a data da reunião");
      return;
    }

    setIsSubmitting(true);

    try {
      // Combine date and time
      const [hours, minutes] = meetingTime.split(":");
      const meetingDateTime = new Date(meetingDate);
      meetingDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      // If the SDR selected here differs from what the lead currently has, write
      // it to the lead FIRST. The DB trigger `snapshot_responsible_from_lead`
      // then captures it into `pipeline_entries.metadata.pre_sale_responsible_id`
      // when we insert below. Lead = source of truth; metadata = snapshot.
      const desiredSdr = sdrId || null;
      const currentLeadSdr = (resolvedLead?.pre_sale_responsible_id as string | null) ?? null;
      if (desiredSdr !== currentLeadSdr) {
        await updateLead.mutateAsync({
          id: selectedLeadId,
          pre_sale_responsible_id: desiredSdr,
        });
      }

      // Passo do chamador ANTES de qualquer escrita no destino. Na tela do funil
      // WhatsApp é ele que leva o card de origem à etapa de sucesso — o UPDATE
      // que produz `meeting_booked`. Se lançar, nada abaixo acontece.
      if (beforeSubmit) await beforeSubmit();

      let pipeData: { id: string; lead_id: string; organization_id: string };

      if (moveFromEntryId) {
        /**
         * MOVER, não criar — ADR-0023 decisão 4.
         *
         * Três escritas, nesta ordem, e nenhuma é opcional:
         *  1. o `beforeSubmit` acima já levou a origem à etapa de sucesso;
         *  2. `moverNegocio` troca o funil na MESMA linha — nenhum card novo;
         *  3. o UPDATE abaixo grava a data da reunião no card que acabou de
         *     chegar. Ele é obrigatório: `findOrCreatePipelineEntry`, quando ACHA
         *     uma linha, devolve-a sem atualizar metadata nem etapa — então
         *     mover e depois chamar o create deixaria a reunião sem data.
         *
         * Na métrica isso fecha: o passo 1 emite `meeting_booked`, e o passo 3
         * cai no ramo de remarcação do gatilho (mesma etapa, data que era nula
         * passa a existir), que ATUALIZA o evento em vez de criar outro.
         */
        if (!confirmacaoPipelineId) {
          throw new Error("Funil de destino não encontrado nesta organização");
        }

        await moverNegocio({
          entryId: moveFromEntryId,
          targetPipelineId: confirmacaoPipelineId,
          targetStageKey: status,
          stageOrigem: null,
          assignedTo: desiredSdr,
        });

        await updatePipeConfirmacao.mutateAsync({
          id: moveFromEntryId,
          status,
          meeting_date: meetingDateTime.toISOString(),
          pre_sale_responsible_id: desiredSdr,
          notes: notes || null,
          leadId: selectedLeadId,
        });

        pipeData = { id: moveFromEntryId, lead_id: selectedLeadId, organization_id: "" };
      } else {
        pipeData = await createPipeConfirmacao.mutateAsync({
          lead_id: selectedLeadId,
          meeting_date: meetingDateTime.toISOString(),
          // Redundant client-side hint. Authoritative snapshot is still produced
          // by the DB trigger reading from `leads`.
          pre_sale_responsible_id: desiredSdr,
          notes: notes || null,
          status,
        });
      }

      const meetingWhen = format(meetingDateTime, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
      const trimmedNotes = notes.trim();
      logAction({
        leadId: selectedLeadId,
        action: "meeting_scheduled",
        // Inclui as observações na timeline do lead — antes só a data ia pro
        // histórico, então o que o vendedor digitava em "Observações" sumia.
        description: trimmedNotes
          ? `Reunião agendada para ${meetingWhen} — Obs: ${trimmedNotes}`
          : `Reunião agendada para ${meetingWhen}`,
      });

      // ── Cria evento no Google Calendar ───────────────────────────────────
      if (createGoogleEvent && calendarOwnerId && session?.access_token) {
        try {
          const lead = foundLeadByEmail ?? leads?.find((l) => l.id === selectedLeadId);
          const leadName = lead?.name ?? "Lead";

          const url = `${(import.meta.env.VITE_SUPABASE_URL as string ?? "").replace(/\/$/, "")}/functions/v1/google-calendar-events`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: `${leadName} - Reunião`,
              description: [
                `Reunião com lead: ${leadName}`,
                lead?.company ? `Empresa: ${lead.company}` : null,
                lead?.phone  ? `Telefone: ${lead.phone}`  : null,
                notes        ? `\nObservações: ${notes}`  : null,
              ]
                .filter(Boolean)
                .join("\n"),
              start_at:             meetingDateTime.toISOString(),
              end_at:               new Date(meetingDateTime.getTime() + 60 * 60 * 1000).toISOString(),
              timezone:             "America/Sao_Paulo",
              lead_id:              selectedLeadId,
              pipe_confirmacao_id:  pipeData.id,
              calendar_owner_id:    calendarOwnerId,
            }),
          });

          if (res.ok) {
            const gcData = await res.json();
            if (gcData.meet_link) {
              toast.success("Reunião criada!", {
                description: `Link do Google Meet gerado automaticamente.`,
              });
            } else {
              toast.success("Reunião adicionada e evento criado no Google Calendar!");
            }
          } else {
            const errData = await res.json().catch(() => ({}));
            console.warn("[AddMeetingModal] Google Calendar error:", errData);
            toast.success("Reunião adicionada com sucesso!");
            toast.warning("Não foi possível criar o evento no Google Calendar", {
              description: (errData as { message?: string }).message ?? "Verifique se o Google Calendar está conectado.",
            });
          }
        } catch (gcErr) {
          console.warn("[AddMeetingModal] Google Calendar error:", gcErr);
          toast.success("Reunião adicionada com sucesso!");
          toast.warning("Não foi possível criar o evento no Google Calendar");
        }
      } else {
        toast.success("Reunião adicionada com sucesso!");
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      const message = getErrorMessage(error);
      console.error("[AddMeetingModal] Falha ao adicionar reunião:", error);
      void logger.error(
        "Falha ao adicionar reunião",
        error instanceof Error ? error : new Error(String(error)),
        { resource: "pipelines", action: "add-meeting-failed", metadata: { leadId: selectedLeadId, status } },
      );
      toast.error("Erro ao adicionar reunião", { description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const statusOptions: { value: PipeConfirmacaoStatus; label: string }[] = [
    { value: "reuniao_marcada", label: "Reunião Marcada" },
    { value: "confirmar_d5", label: "Confirmar D-5" },
    { value: "confirmar_d3", label: "Confirmar D-3" },
    { value: "confirmar_d1", label: "Confirmar D-1" },
    { value: "confirmacao_no_dia", label: "Confirmação no Dia" },
    { value: "remarcar", label: "Remarcar" },
  ];

  const hasCalendars = calendarOptions.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Reunião</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Lead info (prefilled mode) or search + select (manual mode) */}
          {prefilledLeadId ? (
            <div className="space-y-1">
              <Label>Lead</Label>
              {(() => {
                const lead = leads?.find(l => l.id === prefilledLeadId);
                return lead ? (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    <span className="font-medium">{lead.name}</span>
                    {lead.company && <span className="text-muted-foreground">— {lead.company}</span>}
                  </div>
                ) : (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    {leadsLoading ? "Carregando..." : "Lead selecionado"}
                  </div>
                );
              })()}
            </div>
          ) : (
            <>
              {/* Email Search */}
              <div className="space-y-2">
                <Label>Email do Lead</Label>
                <div className="relative">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Digite o email para buscar lead existente..."
                    className={cn(
                      foundLeadByEmail && "border-green-500 pr-10"
                    )}
                  />
                  {email.trim() && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {foundLeadByEmail ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  )}
                </div>
                {email.trim() && (
                  <p className={cn(
                    "text-xs",
                    foundLeadByEmail ? "text-green-600" : "text-muted-foreground"
                  )}>
                    {foundLeadByEmail
                      ? `Lead encontrado: ${foundLeadByEmail.name}${foundLeadByEmail.company ? ` - ${foundLeadByEmail.company}` : ""}`
                      : "Nenhum lead encontrado com este email. Selecione manualmente abaixo."
                    }
                  </p>
                )}
              </div>

              {/* Lead Selection */}
              <div className="space-y-2">
                <Label>Lead *</Label>
                <Select
                  value={selectedLeadId}
                  onValueChange={setSelectedLeadId}
                  disabled={!!foundLeadByEmail}
                >
                  <SelectTrigger className={cn(foundLeadByEmail && "bg-muted")}>
                    <SelectValue placeholder={leadsLoading ? "Carregando..." : "Selecione um lead"} />
                  </SelectTrigger>
                  <SelectContent>
                    {leads?.filter(lead => lead.id).map((lead) => (
                      <SelectItem key={lead.id} value={lead.id}>
                        {lead.name} {lead.company && `- ${lead.company}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {foundLeadByEmail && (
                  <p className="text-xs text-muted-foreground">
                    Lead vinculado automaticamente pelo email
                  </p>
                )}
              </div>
            </>
          )}

          {/* Meeting Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data da Reunião *</Label>
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

          {/* Status */}
          <div className="space-y-2">
            <Label>Status Inicial</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as PipeConfirmacaoStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* SDR (pré-venda) — captured by trigger into metadata.pre_sale_responsible_id */}
          <div className="space-y-2">
            <Label>SDR (pré-venda)</Label>
            <Select value={sdrId || "none"} onValueChange={(v) => setSdrId(v === "none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {responsibleMembers.filter(m => m.id).map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações sobre a reunião..."
              rows={3}
            />
          </div>

          {/* Google Calendar Section */}
          {hasCalendars && (
            <div className="rounded-lg border border-border/50 p-3 space-y-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">Google Calendar</span>
                </div>
                <Switch
                  checked={createGoogleEvent}
                  onCheckedChange={setCreateGoogleEvent}
                />
              </div>

              {createGoogleEvent && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Em qual agenda criar o evento?
                  </Label>
                  <Select value={calendarOwnerId} onValueChange={setCalendarOwnerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a agenda" />
                    </SelectTrigger>
                    <SelectContent>
                      {calendarOptions.map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Um link do Google Meet será gerado automaticamente e salvo na reunião.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} className="gradient-gold">
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Adicionar Reunião
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
