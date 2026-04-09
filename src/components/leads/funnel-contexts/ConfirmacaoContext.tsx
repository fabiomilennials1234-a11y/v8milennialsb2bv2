/**
 * Contexto do funil: Confirmação de Reunião
 *
 * Status grid, meeting date editor, notes, quick status actions,
 * compareceu modal integration, delete meeting/lead.
 */

import { useState, useEffect } from "react";
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  XCircle,
  Edit3,
  Save,
  Loader2,
  Plus,
  Trash2,
  Users,
  Pencil,
  UserCheck,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useConfirmacaoOverdueDays, isConfirmacaoOverdue } from "@/hooks/useOrganizationSettings";
import { useUpdatePipeConfirmacao, useDeletePipeConfirmacao, type PipeConfirmacaoStatus, statusColumns } from "@/hooks/usePipeConfirmacao";
import { useCreatePipeProposta } from "@/hooks/usePipePropostas";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useDeleteLead } from "@/hooks/useLeads";
import { useResponsibleMembers } from "@/hooks/useTeamMembers";
import { CompareceuModal } from "@/components/confirmacao/CompareceuModal";
import { RescheduleModal } from "@/components/confirmacao/RescheduleModal";
import { cn } from "@/lib/utils";
import { format, differenceInDays, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface ConfirmacaoContextProps {
  lead: any;
  pipeData: any; // pipe_confirmacao row (with .lead nested)
  onSuccess?: () => void;
}

function getMeetingUrgency(
  meetingDate: Date | null,
  status?: string,
  updatedAt?: string | null,
  overdueDays?: number
) {
  if (
    overdueDays != null &&
    overdueDays >= 1 &&
    updatedAt != null &&
    status != null &&
    isConfirmacaoOverdue(status, updatedAt, overdueDays)
  ) {
    return { label: "Atrasada", color: "text-destructive", urgency: "overdue" };
  }
  if (!meetingDate) return { label: "Sem data", color: "text-muted-foreground", urgency: "none" };

  const days = differenceInDays(meetingDate, new Date());
  if (isToday(meetingDate)) return { label: "Hoje!", color: "text-warning", urgency: "today" };
  if (isTomorrow(meetingDate)) return { label: "Amanhã", color: "text-orange-500", urgency: "tomorrow" };
  if (days <= 3) return { label: `Em ${days} dias`, color: "text-yellow-500", urgency: "soon" };
  return { label: `Em ${days} dias`, color: "text-muted-foreground", urgency: "normal" };
}

export function ConfirmacaoContext({ lead, pipeData: item, onSuccess }: ConfirmacaoContextProps) {
  const overdueDays = useConfirmacaoOverdueDays();
  const [isEditingMeeting, setIsEditingMeeting] = useState(false);
  const [isEditingOwners, setIsEditingOwners] = useState(false);
  const [editedNotes, setEditedNotes] = useState(item?.notes || "");
  const [editedStatus, setEditedStatus] = useState<PipeConfirmacaoStatus>(item?.status || "reuniao_marcada");
  const [editedDate, setEditedDate] = useState<Date | undefined>(item?.meeting_date ? new Date(item.meeting_date) : undefined);
  const [editedTime, setEditedTime] = useState(item?.meeting_date ? format(new Date(item.meeting_date), "HH:mm") : "10:00");
  const [editedResponsibleId, setEditedResponsibleId] = useState<string | null>(item?.responsible_id || null);
  const [isSavingMeeting, setIsSavingMeeting] = useState(false);
  const [isSavingOwners, setIsSavingOwners] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);
  const [isCompareceuModalOpen, setIsCompareceuModalOpen] = useState(false);
  const [isProcessingCompareceu, setIsProcessingCompareceu] = useState(false);

  const updatePipeConfirmacao = useUpdatePipeConfirmacao();
  const deletePipeConfirmacao = useDeletePipeConfirmacao();
  const deleteLead = useDeleteLead();
  const createPipeProposta = useCreatePipeProposta();
  const logAction = useLogLeadAction();
  const { data: responsibleMembers = [] } = useResponsibleMembers();

  useEffect(() => {
    if (item) {
      setEditedNotes(item.notes || "");
      setEditedStatus(item.status || "reuniao_marcada");
      setEditedDate(item.meeting_date ? new Date(item.meeting_date) : undefined);
      setEditedTime(item.meeting_date ? format(new Date(item.meeting_date), "HH:mm") : "10:00");
      setEditedResponsibleId(item.responsible_id || null);
    }
  }, [item?.id]);

  if (!item) {
    return <p className="text-sm text-muted-foreground text-center py-8">Nenhum dado de confirmação encontrado.</p>;
  }

  const meetingDate = item.meeting_date ? new Date(item.meeting_date) : null;
  const urgency = getMeetingUrgency(meetingDate, item.status, item.updated_at, overdueDays);
  const currentStatus = statusColumns.find((s) => s.id === item.status);
  const getMemberName = (id: string | null | undefined) => responsibleMembers.find((m) => m.id === id)?.name;

  const handleSaveMeeting = async () => {
    if (editedStatus === "compareceu" && item.status !== "compareceu") {
      setIsCompareceuModalOpen(true);
      return;
    }

    setIsSavingMeeting(true);
    try {
      const updates: Record<string, unknown> = {
        id: item.id,
        notes: editedNotes ?? null,
        status: editedStatus,
        leadId: item.lead_id,
        assignedTo: editedResponsibleId || item.responsible_id,
      };

      if (editedDate) {
        const parts = editedTime.trim().split(":");
        const hours = Math.min(23, Math.max(0, parseInt(parts[0], 10) || 0));
        const minutes = Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0));
        const dt = new Date(editedDate);
        dt.setHours(hours, minutes, 0, 0);
        if (!Number.isNaN(dt.getTime())) updates.meeting_date = dt.toISOString();
      } else {
        updates.meeting_date = null;
      }

      await updatePipeConfirmacao.mutateAsync(updates);

      if (editedNotes !== item.notes) logAction({ leadId: item.lead_id, action: "note_added", description: editedNotes || "Observação removida" });
      if (editedStatus !== item.status) {
        const label = statusColumns.find((s) => s.id === editedStatus)?.title;
        logAction({ leadId: item.lead_id, action: "stage_changed", description: `Status alterado para "${label}" na Confirmação` });
      }

      toast.success("Reunião atualizada!");
      setIsEditingMeeting(false);
      onSuccess?.();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao atualizar reunião");
    } finally {
      setIsSavingMeeting(false);
    }
  };

  const handleCompareceuConfirm = async (responsibleId: string | null) => {
    setIsProcessingCompareceu(true);
    try {
      await updatePipeConfirmacao.mutateAsync({ id: item.id, status: "compareceu" as PipeConfirmacaoStatus, responsible_id: responsibleId, leadId: item.lead_id, assignedTo: responsibleId });
      await createPipeProposta.mutateAsync({ lead_id: item.lead_id, responsible_id: responsibleId, status: "marcar_compromisso" });
      logAction({ leadId: item.lead_id, action: "meeting_attended", description: "Lead compareceu e foi movido para Gestão de Propostas" });
      toast.success("Lead movido para Gestão de Propostas!");
      setIsCompareceuModalOpen(false);
      setIsEditingMeeting(false);
      onSuccess?.();
    } catch {
      toast.error("Erro ao processar comparecimento");
    } finally {
      setIsProcessingCompareceu(false);
    }
  };

  const handleQuickStatusChange = async (newStatus: PipeConfirmacaoStatus) => {
    if (newStatus === "compareceu") { setIsCompareceuModalOpen(true); return; }
    if (newStatus === "remarcar") { setIsRescheduleModalOpen(true); return; }
    try {
      const label = statusColumns.find((s) => s.id === newStatus)?.title;
      logAction({ leadId: item.lead_id, action: "stage_changed", description: `Status alterado para "${label}" na Confirmação` });
      await updatePipeConfirmacao.mutateAsync({ id: item.id, status: newStatus, leadId: item.lead_id, assignedTo: item.responsible_id });
      toast.success("Status atualizado!");
      onSuccess?.();
    } catch {
      toast.error("Erro ao atualizar status");
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setIsAddingNote(true);
    try {
      logAction({ leadId: item.lead_id, action: "note_added", description: newNote });
      const updatedNotes = item.notes ? `${item.notes}\n\n[${format(new Date(), "dd/MM/yyyy HH:mm")}] ${newNote}` : newNote;
      await updatePipeConfirmacao.mutateAsync({ id: item.id, notes: updatedNotes, leadId: item.lead_id, assignedTo: item.responsible_id });
      toast.success("Nota adicionada!");
      setNewNote("");
      onSuccess?.();
    } catch {
      toast.error("Erro ao adicionar nota");
    } finally {
      setIsAddingNote(false);
    }
  };

  const handleDeleteMeeting = async () => {
    try {
      logAction({ leadId: item.lead_id, action: "meeting_deleted", description: "Reunião de confirmação removida" });
      await deletePipeConfirmacao.mutateAsync(item.id);
      toast.success("Reunião excluída!");
      onSuccess?.();
    } catch {
      toast.error("Erro ao excluir reunião");
    }
  };

  return (
    <div className="space-y-6">
      {/* Meeting Date Card */}
      <div
        className={cn(
          "rounded-xl border p-4 text-center",
          urgency.urgency === "overdue" && "border-destructive/50 bg-destructive/5",
          urgency.urgency === "today" && "border-warning/50 bg-warning/5",
          urgency.urgency === "tomorrow" && "border-orange-500/50 bg-orange-500/5",
          urgency.urgency === "soon" && "border-yellow-500/50 bg-yellow-500/5",
          urgency.urgency === "normal" && "border-border bg-card",
          urgency.urgency === "none" && "border-border bg-muted/50"
        )}
      >
        <CalendarIcon className={cn("w-6 h-6 mx-auto mb-2", urgency.color)} />
        {meetingDate ? (
          <>
            <p className="text-2xl font-bold">{format(meetingDate, "dd")}</p>
            <p className="text-sm text-muted-foreground">{format(meetingDate, "MMMM", { locale: ptBR })}</p>
            <p className="text-lg font-medium mt-1">{format(meetingDate, "HH:mm")}</p>
            <p className={cn("text-xs font-medium mt-1", urgency.color)}>{urgency.label}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Sem data definida</p>
        )}
      </div>

      {/* Current Status */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Status:</span>
        <Badge
          variant="outline"
          style={{ backgroundColor: `${currentStatus?.color}15`, borderColor: `${currentStatus?.color}40`, color: currentStatus?.color }}
        >
          {currentStatus?.title}
        </Badge>
      </div>

      {/* Quick Status Actions */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Ações Rápidas</h3>
        <div className="grid grid-cols-2 gap-2">
          {statusColumns
            .filter((s) => !["compareceu", "perdido"].includes(s.id))
            .map((status) => (
              <Button
                key={status.id}
                variant={item.status === status.id ? "default" : "outline"}
                className="justify-start h-auto py-2.5 text-sm"
                style={item.status === status.id ? { backgroundColor: status.color, borderColor: status.color } : {}}
                onClick={() => handleQuickStatusChange(status.id)}
                disabled={item.status === status.id}
              >
                <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: status.color }} />
                {status.title}
              </Button>
            ))}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
          <Button className="bg-success hover:bg-success/90 h-auto py-3" onClick={() => handleQuickStatusChange("compareceu")}>
            <CheckCircle2 className="w-4 h-4 mr-2" />
            <div className="text-left">
              <p className="font-semibold text-sm">Compareceu</p>
              <p className="text-[10px] opacity-80">Move para Propostas</p>
            </div>
          </Button>
          <Button variant="destructive" className="h-auto py-3" onClick={() => handleQuickStatusChange("perdido")}>
            <XCircle className="w-4 h-4 mr-2" />
            <div className="text-left">
              <p className="font-semibold text-sm">Perdido</p>
              <p className="text-[10px] opacity-80">Encerrar lead</p>
            </div>
          </Button>
        </div>
      </div>

      {/* Responsável */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Responsável
          </h3>
          {!isEditingOwners && (
            <Button variant="ghost" size="sm" onClick={() => setIsEditingOwners(true)}>
              <Pencil className="w-3.5 h-3.5 mr-1" />
              Editar
            </Button>
          )}
        </div>
        {isEditingOwners ? (
          <div className="space-y-3 p-3 border border-primary/20 rounded-lg bg-primary/5">
            <Select value={editedResponsibleId || "none"} onValueChange={(v) => setEditedResponsibleId(v === "none" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {responsibleMembers.map((m) => (<SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setIsEditingOwners(false)}>Cancelar</Button>
              <Button size="sm" onClick={async () => {
                setIsSavingOwners(true);
                try {
                  if (editedResponsibleId !== item.responsible_id) {
                    const name = getMemberName(editedResponsibleId) || "Nenhum";
                    logAction({ leadId: item.lead_id, action: "responsible_assigned", description: `Responsável alterado para "${name}"` });
                  }
                  await updatePipeConfirmacao.mutateAsync({ id: item.id, responsible_id: editedResponsibleId, leadId: item.lead_id, assignedTo: editedResponsibleId || null });
                  toast.success("Responsável atualizado!");
                  setIsEditingOwners(false);
                  onSuccess?.();
                } catch { toast.error("Erro ao atualizar"); }
                finally { setIsSavingOwners(false); }
              }} disabled={isSavingOwners}>
                {isSavingOwners ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                Salvar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <UserCheck className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{getMemberName(editedResponsibleId) || "Não atribuído"}</p>
              <p className="text-xs text-muted-foreground">Responsável</p>
            </div>
          </div>
        )}
      </div>

      {/* Notes + Edit */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            Observações
          </h3>
          <Button variant="ghost" size="sm" onClick={() => setIsEditingMeeting(!isEditingMeeting)}>
            <Edit3 className="w-3.5 h-3.5 mr-1" />
            {isEditingMeeting ? "Cancelar" : "Editar"}
          </Button>
        </div>

        {isEditingMeeting ? (
          <div className="space-y-3 p-4 border border-primary/20 rounded-xl bg-primary/5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={editedStatus} onValueChange={(v) => setEditedStatus(v as PipeConfirmacaoStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{statusColumns.map((s) => (<SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Data da Reunião</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="w-4 h-4 mr-2" />
                      {editedDate ? format(editedDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={editedDate} onSelect={setEditedDate} locale={ptBR} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Horário</Label>
              <Input type="time" value={editedTime} onChange={(e) => setEditedTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Observações</Label>
              <Textarea value={editedNotes} onChange={(e) => setEditedNotes(e.target.value)} rows={3} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setIsEditingMeeting(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleSaveMeeting} disabled={isSavingMeeting}>
                {isSavingMeeting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                Salvar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-muted/50 min-h-[60px]">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{item.notes || "Nenhuma observação."}</p>
            </div>
            <div className="flex gap-2">
              <Textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Nota rápida..." rows={2} className="flex-1" />
              <Button onClick={handleAddNote} disabled={!newNote.trim() || isAddingNote} className="self-end">
                {isAddingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div className="pt-4 border-t border-border flex gap-2">
        <Button variant="destructive" size="sm" onClick={() => setDeleteConfirmOpen(true)}>
          <Trash2 className="w-4 h-4 mr-1" />
          Excluir Reunião
        </Button>
      </div>

      {/* Dialogs */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Reunião</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta reunião? O lead continuará existindo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMeeting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RescheduleModal
        open={isRescheduleModalOpen}
        onOpenChange={setIsRescheduleModalOpen}
        pipeItem={item ? { ...item, lead } : null}
        onSuccess={() => onSuccess?.()}
      />

      <CompareceuModal
        open={isCompareceuModalOpen}
        onOpenChange={setIsCompareceuModalOpen}
        onConfirm={handleCompareceuConfirm}
        leadName={lead?.name || "Lead"}
        currentResponsibleId={editedResponsibleId || item.responsible_id}
        isLoading={isProcessingCompareceu}
      />
    </div>
  );
}
