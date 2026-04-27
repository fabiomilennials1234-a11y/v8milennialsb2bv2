/**
 * @deprecated Use LeadDetailDrawer + ConfirmacaoContext instead. This component is kept for reference only.
 */
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
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
import { motion, AnimatePresence } from "framer-motion";
import { 
  Calendar as CalendarIcon, 
  User, 
  Building2, 
  Mail, 
  Phone, 
  Star,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MessageSquare,
  History,
  Edit3,
  Save,
  X,
  TrendingUp,
  Users,
  FileText,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  UserCheck
} from "lucide-react";
import { format, formatDistanceToNow, isToday, isTomorrow, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useConfirmacaoOverdueDays, isConfirmacaoOverdue } from "@/hooks/useOrganizationSettings";
import { useUpdatePipeConfirmacao, useDeletePipeConfirmacao, PipeConfirmacaoStatus, statusColumns } from "@/hooks/usePipeConfirmacao";
import { useCreatePipeProposta } from "@/hooks/usePipePropostas";
import { useLeadHistory } from "@/hooks/useLeadHistory";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useDeleteLead } from "@/hooks/useLeads";
import { useResponsibleMembers } from "@/hooks/useTeamMembers";
import { CompareceuModal } from "./CompareceuModal";
import { toast } from "sonner";

interface ConfirmacaoDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: any;
  onSuccess?: () => void;
}

const originConfig: Record<string, { label: string; color: string; icon: string }> = {
  whatsapp: { label: "WhatsApp", color: "bg-green-500/10 text-green-500 border-green-500/20", icon: "💬" },
  meta_ads: { label: "Meta Ads", color: "bg-blue-500/10 text-blue-500 border-blue-500/20", icon: "📱" },
  outro: { label: "Outros", color: "bg-muted text-muted-foreground border-border", icon: "📋" },
  site: { label: "Site", color: "bg-teal-500/10 text-teal-500 border-teal-500/20", icon: "🌐" },
  remarketing: { label: "Remarketing", color: "bg-orange-500/10 text-orange-500 border-orange-500/20", icon: "🔄" },
  google_ads: { label: "Google Ads", color: "bg-red-500/10 text-red-500 border-red-500/20", icon: "🔍" },
  cal: { label: "Cal.com", color: "bg-purple-500/10 text-purple-500 border-purple-500/20", icon: "📅" },
};

function getMeetingUrgency(
  meetingDate: Date | null,
  status?: string,
  updatedAt?: string | null,
  overdueDays?: number
) {
  // Atrasada = X dias sem interação (configurável)
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

  const now = new Date();
  const days = differenceInDays(meetingDate, now);

  if (isToday(meetingDate)) {
    return { label: "Hoje!", color: "text-warning", urgency: "today" };
  }
  if (isTomorrow(meetingDate)) {
    return { label: "Amanhã", color: "text-orange-500", urgency: "tomorrow" };
  }
  if (days <= 3) {
    return { label: `Em ${days} dias`, color: "text-yellow-500", urgency: "soon" };
  }
  return { label: `Em ${days} dias`, color: "text-muted-foreground", urgency: "normal" };
}

export function ConfirmacaoDetailModal({ open, onOpenChange, item, onSuccess }: ConfirmacaoDetailModalProps) {
  const overdueDays = useConfirmacaoOverdueDays();
  const [isEditingMeeting, setIsEditingMeeting] = useState(false);
  const [isEditingOwners, setIsEditingOwners] = useState(false);
  const [editedNotes, setEditedNotes] = useState("");
  const [editedStatus, setEditedStatus] = useState<PipeConfirmacaoStatus>("reuniao_marcada");
  const [editedDate, setEditedDate] = useState<Date | undefined>();
  const [editedTime, setEditedTime] = useState("10:00");
  const [editedResponsibleId, setEditedResponsibleId] = useState<string | null>(null);
  const [isSavingMeeting, setIsSavingMeeting] = useState(false);
  const [isSavingOwners, setIsSavingOwners] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteLeadConfirmOpen, setDeleteLeadConfirmOpen] = useState(false);
  
  // Compareceu modal state
  const [isCompareceuModalOpen, setIsCompareceuModalOpen] = useState(false);
  const [isProcessingCompareceu, setIsProcessingCompareceu] = useState(false);

  const updatePipeConfirmacao = useUpdatePipeConfirmacao();
  const deletePipeConfirmacao = useDeletePipeConfirmacao();
  const deleteLead = useDeleteLead();
  const createPipeProposta = useCreatePipeProposta();
  const { data: leadHistory, isLoading: historyLoading } = useLeadHistory(item?.lead_id);
  const logAction = useLogLeadAction();
  const { data: responsibleMembers = [] } = useResponsibleMembers();

  // Sync state with item when it changes
  useEffect(() => {
    if (item) {
      setEditedNotes(item.notes || "");
      setEditedStatus(item.status || "reuniao_marcada");
      setEditedDate(item.meeting_date ? new Date(item.meeting_date) : undefined);
      setEditedTime(item.meeting_date ? format(new Date(item.meeting_date), "HH:mm") : "10:00");
      setEditedResponsibleId(item?.responsible_id || null);
      setIsEditingMeeting(false);
      setIsEditingOwners(false);
      setNewNote("");
      setIsAddingNote(false);
    }
  }, [item]);

  if (!item) return null;

  const lead = item.lead;
  const meetingDate = item.meeting_date ? new Date(item.meeting_date) : null;
  const urgency = getMeetingUrgency(
    meetingDate,
    item?.status,
    item?.updated_at,
    overdueDays
  );
  const origin = originConfig[lead?.origin as keyof typeof originConfig] || originConfig.outro;
  const currentStatus = statusColumns.find(s => s.id === item.status);

  const getMemberName = (id: string | null | undefined) =>
    responsibleMembers.find((m) => m.id === id)?.name;

  const responsibleName = getMemberName(editedResponsibleId) || "Não atribuído";

  const handleSaveMeeting = async () => {
    // If changing to compareceu, open the compareceu modal instead
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
        const meetingDateTime = new Date(editedDate);
        meetingDateTime.setHours(hours, minutes, 0, 0);
        if (!Number.isNaN(meetingDateTime.getTime())) {
          updates.meeting_date = meetingDateTime.toISOString();
        }
      } else {
        updates.meeting_date = null;
      }

      // Salvar primeiro a reunião (data, horário, status, observações) para garantir que funcione mesmo se lead_history falhar por RLS
      await updatePipeConfirmacao.mutateAsync(updates);

      if (editedNotes !== item.notes) {
        logAction({ leadId: item.lead_id, action: "note_added", description: editedNotes || "Observação removida" });
      }
      if (editedStatus !== item.status) {
        const newStatusLabel = statusColumns.find((s) => s.id === editedStatus)?.title;
        logAction({ leadId: item.lead_id, action: "stage_changed", description: `Status alterado para "${newStatusLabel}" na Confirmação` });
      }

      toast.success("Reunião atualizada com sucesso!");
      setIsEditingMeeting(false);
      onSuccess?.();
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : typeof (error as { message?: string })?.message === "string"
            ? (error as { message: string }).message
            : "Erro ao atualizar reunião";
      toast.error(message);
      console.error("Erro ao salvar data/hora da reunião:", error);
    } finally {
      setIsSavingMeeting(false);
    }
  };

  const handleCompareceuConfirm = async (responsibleId: string | null) => {
    setIsProcessingCompareceu(true);
    try {
      // Update confirmacao with responsible and status
      await updatePipeConfirmacao.mutateAsync({
        id: item.id,
        status: "compareceu" as PipeConfirmacaoStatus,
        responsible_id: responsibleId,
        leadId: item.lead_id,
        assignedTo: responsibleId,
      });

      // Create proposta with selected responsible
      await createPipeProposta.mutateAsync({
        lead_id: item.lead_id,
        responsible_id: responsibleId,
        status: "marcar_compromisso",
      });

      logAction({ leadId: item.lead_id, action: "meeting_attended", description: "Lead compareceu e foi movido para Gestão de Propostas" });

      toast.success("Lead movido para Gestão de Propostas!");
      setIsCompareceuModalOpen(false);
      setIsEditingMeeting(false);
      onSuccess?.();
    } catch (error) {
      toast.error("Erro ao processar comparecimento");
    } finally {
      setIsProcessingCompareceu(false);
    }
  };

  const handleSaveOwners = async () => {
    setIsSavingOwners(true);
    try {
      if (editedResponsibleId !== item.responsible_id) {
        const name = getMemberName(editedResponsibleId) || "Nenhum";
        logAction({ leadId: item.lead_id, action: "responsible_assigned", description: `Responsável alterado para "${name}"` });
      }

      await updatePipeConfirmacao.mutateAsync({
        id: item.id,
        responsible_id: editedResponsibleId,
        leadId: item.lead_id,
        assignedTo: editedResponsibleId || null,
      });

      toast.success("Responsáveis atualizados!");
      setIsEditingOwners(false);
      onSuccess?.();
    } catch (error) {
      toast.error("Erro ao atualizar responsáveis");
    } finally {
      setIsSavingOwners(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    
    setIsAddingNote(true);
    try {
      logAction({ leadId: item.lead_id, action: "note_added", description: newNote });
      
      // Also update the pipe_confirmacao notes
      const updatedNotes = item.notes 
        ? `${item.notes}\n\n[${format(new Date(), "dd/MM/yyyy HH:mm")}] ${newNote}`
        : newNote;
      
      await updatePipeConfirmacao.mutateAsync({
        id: item.id,
        notes: updatedNotes,
        leadId: item.lead_id,
        assignedTo: item.responsible_id,
      });

      toast.success("Nota adicionada!");
      setNewNote("");
      onSuccess?.();
    } catch (error) {
      toast.error("Erro ao adicionar nota");
    } finally {
      setIsAddingNote(false);
    }
  };

  const handleQuickStatusChange = async (newStatus: PipeConfirmacaoStatus) => {
    // If changing to compareceu, open the compareceu modal instead
    if (newStatus === "compareceu") {
      setIsCompareceuModalOpen(true);
      return;
    }

    try {
      const newStatusLabel = statusColumns.find(s => s.id === newStatus)?.title;
      
      logAction({ leadId: item.lead_id, action: "stage_changed", description: `Status alterado para "${newStatusLabel}" na Confirmação` });

      await updatePipeConfirmacao.mutateAsync({
        id: item.id,
        status: newStatus,
        leadId: item.lead_id,
        assignedTo: item.responsible_id,
      });
      toast.success("Status atualizado!");
      onSuccess?.();
    } catch (error) {
      toast.error("Erro ao atualizar status");
    }
  };

  const handleDeleteMeeting = async () => {
    try {
      logAction({ leadId: item.lead_id, action: "meeting_deleted", description: "Reunião de confirmação removida" });
      await deletePipeConfirmacao.mutateAsync(item.id);
      toast.success("Reunião excluída com sucesso!");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error("Erro ao excluir reunião");
    }
  };

  const handleDeleteLead = async () => {
    try {
      await deleteLead.mutateAsync(item.lead_id);
      toast.success("Lead excluído com sucesso!");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error("Erro ao excluir lead");
    }
  };

  // Combine real history with pipe events
  const allEvents = [
    { date: item.created_at, action: "Reunião criada", type: "create", description: null },
    ...(leadHistory || []).map(h => ({
      date: h.created_at,
      action: h.action,
      type: h.action.includes("Status") ? "status" : "note",
      description: h.description,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden p-0">
        {/* Header with gradient */}
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6 border-b border-border">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <Badge variant="outline" className={origin.color}>
                  <span className="mr-1">{origin.icon}</span>
                  {origin.label}
                </Badge>
                <Badge 
                  variant="outline" 
                  style={{ 
                    backgroundColor: `${currentStatus?.color}15`, 
                    borderColor: `${currentStatus?.color}40`,
                    color: currentStatus?.color 
                  }}
                >
                  {currentStatus?.title}
                </Badge>
              </div>
              <DialogTitle className="text-2xl flex items-center gap-3">
                {lead?.name || "Lead"}
                <div className="flex items-center gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={cn(
                        "w-4 h-4",
                        i < (lead?.rating || 0)
                          ? "text-primary fill-primary"
                          : "text-muted-foreground/30"
                      )}
                    />
                  ))}
                </div>
              </DialogTitle>
              <div className="flex items-center gap-4 mt-2 text-muted-foreground">
                {lead?.company && (
                  <span className="flex items-center gap-1.5">
                    <Building2 className="w-4 h-4" />
                    {lead.company}
                  </span>
                )}
                {lead?.segment && (
                  <span className="flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4" />
                    {lead.segment}
                  </span>
                )}
              </div>
            </div>

            {/* Meeting Date Card */}
            <motion.div 
              className={cn(
                "rounded-xl border p-4 min-w-[180px] text-center",
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
            </motion.div>
          </div>
        </div>

        {/* Tabs Content */}
        <Tabs defaultValue="details" className="flex-1">
          <div className="px-6 border-b border-border">
            <TabsList className="bg-transparent h-12 gap-4">
              <TabsTrigger value="details" className="data-[state=active]:bg-primary/10">
                <FileText className="w-4 h-4 mr-2" />
                Detalhes
              </TabsTrigger>
              <TabsTrigger value="actions" className="data-[state=active]:bg-primary/10">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Ações Rápidas
              </TabsTrigger>
              <TabsTrigger value="history" className="data-[state=active]:bg-primary/10">
                <History className="w-4 h-4 mr-2" />
                Histórico
                {leadHistory && leadHistory.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {leadHistory.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="p-6 overflow-y-auto max-h-[50vh]">
            <TabsContent value="details" className="mt-0 space-y-6">
              {/* Contact Info */}
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="font-semibold flex items-center gap-2">
                    <User className="w-4 h-4 text-primary" />
                    Informações de Contato
                  </h3>
                  <div className="space-y-3">
                    {lead?.email && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{lead.email}</span>
                      </div>
                    )}
                    {lead?.phone && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                        <Phone className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{lead.phone}</span>
                      </div>
                    )}
                    {lead?.faturamento && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                        <TrendingUp className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">
                          Faturamento: R$ {lead.faturamento.toLocaleString("pt-BR")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" />
                      Responsáveis
                    </h3>
                    {!isEditingOwners && (
                      <Button variant="ghost" size="sm" onClick={() => setIsEditingOwners(true)}>
                        <Pencil className="w-4 h-4 mr-1" />
                        Editar
                      </Button>
                    )}
                  </div>

                  {isEditingOwners ? (
                    <div className="space-y-4 p-4 border border-primary/20 rounded-xl bg-primary/5">
                      <div className="space-y-2">
                        <Label>Responsável</Label>
                        <Select
                          value={editedResponsibleId || "none"}
                          onValueChange={(v) => setEditedResponsibleId(v === "none" ? null : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Nenhum</SelectItem>
                            {responsibleMembers.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setIsEditingOwners(false)}>
                          Cancelar
                        </Button>
                        <Button onClick={handleSaveOwners} disabled={isSavingOwners}>
                          {isSavingOwners ? (
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4 mr-1" />
                          )}
                          Salvar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                          <UserCheck className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{responsibleName}</p>
                          <p className="text-xs text-muted-foreground">Responsável</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-primary" />
                    Observações
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => setIsEditingMeeting(!isEditingMeeting)}>
                    <Edit3 className="w-4 h-4 mr-1" />
                    {isEditingMeeting ? "Cancelar" : "Editar"}
                  </Button>
                </div>

                {isEditingMeeting ? (
                  <div className="space-y-4 p-4 border border-primary/20 rounded-xl bg-primary/5">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Select value={editedStatus} onValueChange={(v) => setEditedStatus(v as PipeConfirmacaoStatus)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {statusColumns.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Data da Reunião</Label>
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

                    <div className="space-y-2">
                      <Label>Horário</Label>
                      <Input type="time" value={editedTime} onChange={(e) => setEditedTime(e.target.value)} />
                    </div>

                    <div className="space-y-2">
                      <Label>Observações</Label>
                      <Textarea
                        value={editedNotes}
                        onChange={(e) => setEditedNotes(e.target.value)}
                        placeholder="Observações sobre a reunião..."
                        rows={4}
                      />
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setIsEditingMeeting(false)}>
                        Cancelar
                      </Button>
                      <Button onClick={handleSaveMeeting} disabled={isSavingMeeting}>
                        {isSavingMeeting ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4 mr-1" />
                        )}
                        Salvar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-muted/50 min-h-[80px]">
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{item.notes || "Nenhuma observação registrada."}</p>
                    </div>

                    {/* Quick Add Note */}
                    <div className="flex gap-2">
                      <Textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="Adicionar uma nota rápida..."
                        rows={2}
                        className="flex-1"
                      />
                      <Button onClick={handleAddNote} disabled={!newNote.trim() || isAddingNote} className="self-end">
                        {isAddingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Tags */}
              {lead?.lead_tags?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {lead.lead_tags.map((lt: any) => (
                      <Badge 
                        key={lt.tag?.id} 
                        variant="secondary"
                        style={{ backgroundColor: `${lt.tag?.color}20`, color: lt.tag?.color }}
                      >
                        {lt.tag?.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="actions" className="mt-0 space-y-6">
              <h3 className="font-semibold">Ações Rápidas de Confirmação</h3>
              
              <div className="grid grid-cols-2 gap-3">
                {statusColumns.filter(s => !["compareceu", "perdido"].includes(s.id)).map((status) => (
                  <Button
                    key={status.id}
                    variant={item.status === status.id ? "default" : "outline"}
                    className="justify-start h-auto py-3"
                    style={item.status === status.id ? { 
                      backgroundColor: status.color,
                      borderColor: status.color 
                    } : {}}
                    onClick={() => handleQuickStatusChange(status.id)}
                    disabled={item.status === status.id}
                  >
                    <div 
                      className="w-3 h-3 rounded-full mr-2" 
                      style={{ backgroundColor: status.color }}
                    />
                    {status.title}
                  </Button>
                ))}
              </div>

              <div className="border-t border-border pt-6">
                <h3 className="font-semibold mb-4">Finalizar Reunião</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Button 
                    className="bg-success hover:bg-success/90 h-auto py-4"
                    onClick={() => handleQuickStatusChange("compareceu")}
                  >
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    <div className="text-left">
                      <p className="font-semibold">Compareceu</p>
                      <p className="text-xs opacity-80">Move para Propostas</p>
                    </div>
                  </Button>
                  <Button 
                    variant="destructive"
                    className="h-auto py-4"
                    onClick={() => handleQuickStatusChange("perdido")}
                  >
                    <XCircle className="w-5 h-5 mr-2" />
                    <div className="text-left">
                      <p className="font-semibold">Perdido</p>
                      <p className="text-xs opacity-80">Encerrar lead</p>
                    </div>
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="history" className="mt-0">
              <div className="space-y-4">
                <h3 className="font-semibold">Linha do Tempo</h3>
                
                {historyLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : allEvents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <History className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>Nenhum histórico encontrado</p>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
                    
                    {allEvents.map((event, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="relative pl-10 pb-6"
                      >
                        <div className={cn(
                          "absolute left-2 w-5 h-5 rounded-full border-2 border-background flex items-center justify-center",
                          event.type === "create" && "bg-primary",
                          event.type === "status" && "bg-chart-2",
                          event.type === "note" && "bg-chart-3"
                        )}>
                          {event.type === "create" && <CalendarIcon className="w-3 h-3 text-primary-foreground" />}
                          {event.type === "status" && <CheckCircle2 className="w-3 h-3 text-white" />}
                          {event.type === "note" && <MessageSquare className="w-3 h-3 text-white" />}
                        </div>
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-sm font-medium">{event.action}</p>
                          {event.description && (
                            <p className="text-sm text-muted-foreground mt-1">{event.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            {format(new Date(event.date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                            <span className="mx-2">•</span>
                            {formatDistanceToNow(new Date(event.date), { addSuffix: true, locale: ptBR })}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {/* Footer with delete actions */}
        <div className="border-t border-border p-4 flex justify-between">
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Excluir Reunião
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteLeadConfirmOpen(true)}
              className="text-destructive hover:text-destructive border-destructive/30"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Excluir Lead
            </Button>
          </div>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>

      {/* Delete Meeting Confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Reunião</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta reunião marcada? O lead continuará existindo na base.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteMeeting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir Reunião
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Lead Confirmation */}
      <AlertDialog open={deleteLeadConfirmOpen} onOpenChange={setDeleteLeadConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o lead "{lead?.name}"? Esta ação irá remover também todas as reuniões, propostas e follow-ups associados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteLead}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir Lead
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Compareceu Modal */}
      <CompareceuModal
        open={isCompareceuModalOpen}
        onOpenChange={setIsCompareceuModalOpen}
        onConfirm={handleCompareceuConfirm}
        leadName={lead?.name || "Lead"}
        currentResponsibleId={editedResponsibleId || item.responsible_id}
        isLoading={isProcessingCompareceu}
      />
    </Dialog>
  );
}
