import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useLeads } from "@/hooks/useLeads";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useCreatePipeConfirmacao, PipeConfirmacaoStatus } from "@/hooks/usePipeConfirmacao";
import { toast } from "sonner";

interface AddMeetingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function AddMeetingModal({ open, onOpenChange, onSuccess }: AddMeetingModalProps) {
  const [email, setEmail] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string>("");
  const [meetingDate, setMeetingDate] = useState<Date | undefined>();
  const [meetingTime, setMeetingTime] = useState("10:00");
  const [sdrId, setSdrId] = useState<string>("");
  const [closerId, setCloserId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<PipeConfirmacaoStatus>("reuniao_marcada");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: leads, isLoading: leadsLoading } = useLeads();
  const { data: teamMembers, isLoading: membersLoading } = useTeamMembers();
  const createPipeConfirmacao = useCreatePipeConfirmacao();

  const sdrs = teamMembers?.filter(m => m.role === "sdr" && m.is_active) || [];
  const closers = teamMembers?.filter(m => m.role === "closer" && m.is_active) || [];

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

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setEmail("");
      setSelectedLeadId("");
      setMeetingDate(undefined);
      setMeetingTime("10:00");
      setSdrId("");
      setCloserId("");
      setNotes("");
      setStatus("reuniao_marcada");
    }
  }, [open]);

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

      await createPipeConfirmacao.mutateAsync({
        lead_id: selectedLeadId,
        meeting_date: meetingDateTime.toISOString(),
        sdr_id: sdrId || null,
        closer_id: closerId || null,
        notes: notes || null,
        status,
      });

      toast.success("Reunião adicionada com sucesso!");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao adicionar reunião");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Reunião</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
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

          {/* SDR & Closer */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>SDR Responsável</Label>
              <Select value={sdrId || "none"} onValueChange={(v) => setSdrId(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={membersLoading ? "Carregando..." : "Selecione"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {sdrs.filter(sdr => sdr.id).map((sdr) => (
                    <SelectItem key={sdr.id} value={sdr.id}>
                      {sdr.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Closer Responsável</Label>
              <Select value={closerId || "none"} onValueChange={(v) => setCloserId(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={membersLoading ? "Carregando..." : "Selecione"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {closers.filter(closer => closer.id).map((closer) => (
                    <SelectItem key={closer.id} value={closer.id}>
                      {closer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
