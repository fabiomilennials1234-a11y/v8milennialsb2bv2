import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Building, Phone, Mail, User, Tag, Plus, Type, Hash, Calendar, List, ToggleLeft, Clock, History, UserPlus, UserCheck, ArrowRight, Edit2, FileText, CheckCircle, XCircle, CalendarX, DollarSign, TrendingUp, Trash2, Package, ListTodo, CheckSquare, Bot, Loader2, ChevronDown, ChevronUp, Users, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsapp";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTeamMembers, useCurrentTeamMember, useResponsibleMembers } from "@/modules/identity";
import { useCreateLead, useUpdateLead } from "../../hooks/useLeads";
import { useLeadOrigins } from "../../hooks/useLeadOrigins";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import {
  useLeadCustomFields,
  useLeadCustomFieldValues,
  useSaveCustomFieldValue,
  type CustomField,
} from "../../hooks/useLeadCustomFields";
import { useLeadHistory } from "../../hooks/useLeadTimeline";
import { ScheduleFollowUpButton } from "@/modules/engagement/components/followups/ScheduleFollowUpButton";
import { usePipeOps } from "../../pipe-ops";
import { destinosDeSistema } from "@/contracts/pipe";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { BR_UFS } from "@/shared/format/br-uf";

interface LeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: any;
  onSuccess?: (newLeadId?: string) => void;
  defaultResponsibleId?: string | null;
  /** Hide pipe/funnel selector — used when the caller already handles pipe insertion (e.g. PipeWhatsapp) */
  skipPipeSelector?: boolean;
}

interface FormData {
  name: string;
  company: string;
  email: string;
  phone: string;
  origin: string;
  segment: string;
  faturamento: string;
  uf: string;
  urgency: string;
  notes: string;
  responsible_id: string | null;
}

const ACTION_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  lead_created: { icon: <UserPlus className="w-3.5 h-3.5" />, label: "Lead criado", color: "bg-blue-500/20 text-blue-600" },
  stage_changed: { icon: <ArrowRight className="w-3.5 h-3.5" />, label: "Etapa alterada", color: "bg-yellow-500/20 text-yellow-600" },
  responsible_assigned: { icon: <UserCheck className="w-3.5 h-3.5" />, label: "Responsavel atribuido", color: "bg-green-500/20 text-green-600" },
  field_updated: { icon: <Edit2 className="w-3.5 h-3.5" />, label: "Campo atualizado", color: "bg-muted text-muted-foreground" },
  note_added: { icon: <FileText className="w-3.5 h-3.5" />, label: "Nota adicionada", color: "bg-muted text-muted-foreground" },
  meeting_scheduled: { icon: <Calendar className="w-3.5 h-3.5" />, label: "Reuniao agendada", color: "bg-blue-500/20 text-blue-600" },
  meeting_attended: { icon: <CheckCircle className="w-3.5 h-3.5" />, label: "Compareceu", color: "bg-green-500/20 text-green-600" },
  meeting_missed: { icon: <XCircle className="w-3.5 h-3.5" />, label: "Nao compareceu", color: "bg-red-500/20 text-red-600" },
  meeting_deleted: { icon: <CalendarX className="w-3.5 h-3.5" />, label: "Reuniao removida", color: "bg-red-500/20 text-red-600" },
  proposal_created: { icon: <DollarSign className="w-3.5 h-3.5" />, label: "Proposta criada", color: "bg-purple-500/20 text-purple-600" },
  proposal_status_changed: { icon: <TrendingUp className="w-3.5 h-3.5" />, label: "Status da proposta", color: "bg-yellow-500/20 text-yellow-600" },
  proposal_deleted: { icon: <Trash2 className="w-3.5 h-3.5" />, label: "Proposta removida", color: "bg-red-500/20 text-red-600" },
  product_linked: { icon: <Package className="w-3.5 h-3.5" />, label: "Produto vinculado", color: "bg-purple-500/20 text-purple-600" },
  followup_created: { icon: <ListTodo className="w-3.5 h-3.5" />, label: "Tarefa criada", color: "bg-blue-500/20 text-blue-600" },
  followup_completed: { icon: <CheckSquare className="w-3.5 h-3.5" />, label: "Tarefa concluida", color: "bg-green-500/20 text-green-600" },
  ai_toggled: { icon: <Bot className="w-3.5 h-3.5" />, label: "IA", color: "bg-primary/20 text-primary" },
  copilot_interaction: { icon: <Bot className="w-3.5 h-3.5" />, label: "Copilot atendeu", color: "bg-primary/20 text-primary" },
};

const FALLBACK_CONFIG = { icon: <Clock className="w-3.5 h-3.5" />, label: "", color: "bg-muted text-muted-foreground" };

const SOURCE_BADGE_LM: Record<string, { label: string; className: string }> = {
  agent: { label: "Copilot", className: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
  automation: { label: "Automação", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  system: { label: "Sistema", className: "bg-muted text-muted-foreground border-border" },
};

const SOURCE_ICON_COLOR_LM: Record<string, string> = {
  agent: "bg-purple-500/20 text-purple-600",
  automation: "bg-blue-500/20 text-blue-600",
  system: "bg-muted text-muted-foreground",
};

function TimelineItem({ action, description, date, source, isLast }: { action: string; description?: string; date: string; source?: string; isLast?: boolean }) {
  const config = ACTION_CONFIG[action] || FALLBACK_CONFIG;
  const displayLabel = config.label || action;
  const iconColor = (source && source !== "manual" && SOURCE_ICON_COLOR_LM[source]) || config.color;
  const badge = source && source !== "manual" ? SOURCE_BADGE_LM[source] : null;

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", iconColor)}>
          {config.icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-border mt-2" />}
      </div>
      <div className="flex-1 pb-6">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm">{displayLabel}</p>
          {badge && (
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium", badge.className)}>
              {badge.label}
            </span>
          )}
        </div>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        <p className="text-xs text-muted-foreground mt-1">
          {formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR })}
        </p>
      </div>
    </div>
  );
}

function SidebarSection({
  icon: Icon,
  label,
  children,
  defaultOpen = false
}: {
  icon: any;
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="flex-1 text-left">{label}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
          {children}
        </div>
      )}
    </div>
  );
}

export function LeadModal({
  open,
  onOpenChange,
  lead,
  onSuccess,
  defaultResponsibleId,
  skipPipeSelector
}: LeadModalProps) {
  const isEditing = !!lead;

  const [formData, setFormData] = useState<FormData>(() => ({
    name: lead?.name || "",
    company: lead?.company || "",
    email: lead?.email || "",
    phone: lead?.phone || "",
    origin: lead?.origin || "outro",
    segment: lead?.segment || "",
    faturamento: lead?.faturamento || "",
    uf: lead?.uf || "",
    urgency: lead?.urgency || "",
    notes: lead?.notes || "",
    responsible_id: lead?.responsible_id || defaultResponsibleId || "",
  }));

  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [historyLimit, setHistoryLimit] = useState(50);

  const { data: teamMembers = [] } = useTeamMembers();
  const { origins: leadOrigins } = useLeadOrigins();
  const { data: history, isLoading: historyLoading } = useLeadHistory(lead?.id || null);
  const { data: currentTeamMember, refetch: refetchTeamMember, isLoading: isLoadingTeamMember, isFetching: isFetchingTeamMember } = useCurrentTeamMember();
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();

  const { data: customFields = [] } = useLeadCustomFields();
  const { data: fieldValues = [] } = useLeadCustomFieldValues(lead?.id || null);
  const saveFieldValue = useSaveCustomFieldValue();

  // ── Pipe/funnel selection (creation mode only) ──
  const [selectedPipe, setSelectedPipe] = useState("");
  const [selectedStage, setSelectedStage] = useState("");
  // Pipe-ops via porta injetada (arch-deepening Fase 7 — leads não importa pipelines direto).
  const {
    useCustomPipelines,
    useCustomPipelineStages,
    useAllPipelineStageOptions,
    useCreatePipeWhatsapp,
    useCreatePipeConfirmacao,
    useCreatePipeProposta,
    useAddLeadToCustomPipe,
    useSystemPipes,
  } = usePipeOps();
  const { data: customPipelines = [] } = useCustomPipelines();
  const { data: systemPipes } = useSystemPipes();
  const customPipelineId = selectedPipe.startsWith("custom:") ? selectedPipe.slice(7) : undefined;
  const { data: customStages = [] } = useCustomPipelineStages(customPipelineId);
  const { stagesByPipe } = useAllPipelineStageOptions();
  const createPipeWhatsapp = useCreatePipeWhatsapp();
  const createPipeConfirmacao = useCreatePipeConfirmacao();
  const createPipeProposta = useCreatePipeProposta();
  const addLeadToCustomPipe = useAddLeadToCustomPipe();

  const showPipeSelector = !isEditing && !skipPipeSelector;

  // Funis de sistema REAIS da org, com o nome que ELA usa (SCRUM-608/641):
  // org sem o funil (linha de display ausente) ou com ele oculto não recebe a
  // opção — oferecer criaria negócio num funil que ela não tem, sem erro.
  const pipeOptions = useMemo(() => {
    const standard = destinosDeSistema(systemPipes).map(d => ({
      value: `std:${d.pipeType}`,
      label: d.label,
    }));
    const custom = customPipelines.map(p => ({ value: `custom:${p.id}`, label: p.name }));
    return [...standard, ...custom];
  }, [systemPipes, customPipelines]);

  const stageOptions = useMemo(() => {
    if (selectedPipe.startsWith("std:")) {
      const pipeType = selectedPipe.slice(4);
      return (stagesByPipe[pipeType] || []).map(s => ({ value: s.value, label: s.label }));
    }
    if (selectedPipe.startsWith("custom:") && customStages.length > 0) {
      return customStages.map(s => ({ value: s.id, label: s.name }));
    }
    return [];
  }, [selectedPipe, stagesByPipe, customStages]);

  // Auto-select first stage when pipe changes or stages load
  useEffect(() => {
    if (selectedPipe && stageOptions.length > 0 && !selectedStage) {
      setSelectedStage(stageOptions[0].value);
    }
  }, [selectedPipe, stageOptions, selectedStage]);

  const fieldValuesKey = lead?.id ?? "";
  const fieldValuesSnapshot = fieldValues.length > 0
    ? JSON.stringify(fieldValues.map((fv) => ({ field_id: fv.field_id, value: fv.value ?? "" })))
    : "";

  useEffect(() => {
    if (lead?.id && fieldValues.length > 0) {
      const values: Record<string, string> = {};
      fieldValues.forEach((fv) => {
        values[fv.field_id] = fv.value || "";
      });
      setCustomValues(values);
    } else {
      setCustomValues({});
    }
  }, [fieldValuesKey, fieldValuesSnapshot]);

  const responsibleMembers = useResponsibleMembers();

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error("Nome e obrigatorio");
      return;
    }

    if (isLoadingTeamMember || isFetchingTeamMember) {
      toast.info("Carregando informacoes da organizacao...");
      return;
    }

    if (!currentTeamMember?.organization_id) {
      const { data: refreshedTeamMember } = await refetchTeamMember();

      if (!refreshedTeamMember?.organization_id) {
        toast.error(
          "Voce precisa estar vinculado a uma organizacao. Execute o script SQL 'SOLUCAO_DEFINITIVA_RLS.sql' no Supabase Dashboard e recarregue a pagina.",
          { duration: 10000 }
        );
        console.error("Team member sem organization_id:", {
          currentTeamMember,
          refreshedTeamMember,
          hasTeamMember: !!currentTeamMember,
          organizationId: currentTeamMember?.organization_id,
          isLoading: isLoadingTeamMember,
          isFetching: isFetchingTeamMember,
        });
        return;
      }

      if (refreshedTeamMember?.organization_id) {
        currentTeamMember.organization_id = refreshedTeamMember.organization_id;
      }
    }

    try {
      const ufChanged = formData.uf !== (lead?.uf || "");
      const payload = {
        ...formData,
        origin: formData.origin as any,
        faturamento: formData.faturamento || null,
        uf: formData.uf || null,
        // resposta explícita vence DDD e nunca é sobrescrita por ele
        uf_source: formData.uf ? (ufChanged ? "manual" : lead?.uf_source ?? "manual") : null,
        responsible_id: formData.responsible_id || null,
        organization_id: currentTeamMember.organization_id,
      };

      let leadId = lead?.id;

      if (isEditing) {
        await updateLead.mutateAsync({ id: lead.id, ...payload });
        const changes: string[] = [];
        if (formData.name !== lead.name) changes.push("nome");
        if (formData.company !== (lead.company || "")) changes.push("empresa");
        if (formData.email !== (lead.email || "")) changes.push("email");
        if (formData.phone !== (lead.phone || "")) changes.push("telefone");
        if (formData.segment !== (lead.segment || "")) changes.push("segmento");
        if (formData.uf !== (lead.uf || "")) changes.push("estado");
        if (formData.notes !== (lead.notes || "")) changes.push("observacoes");
        if (formData.responsible_id !== (lead.responsible_id || null)) changes.push("Responsavel");
        if (changes.length > 0) {
          logAction({ leadId: lead.id, action: "field_updated", description: `Campos atualizados: ${changes.join(", ")}` });
        }
        if (formData.responsible_id !== (lead.responsible_id || null)) {
          const responsibleName = responsibleMembers.find(m => m.id === formData.responsible_id)?.name || "Nenhum";
          logAction({ leadId: lead.id, action: "responsible_assigned", description: `Responsavel alterado para "${responsibleName}"` });
        }
      } else {
        // Dedup check: verify if lead with same phone/email already exists
        if (formData.phone || formData.email) {
          const filters: string[] = [];
          if (formData.phone) filters.push(`phone.eq.${formData.phone}`);
          if (formData.email) filters.push(`email.eq.${formData.email}`);

          const { data: existingLeads } = await supabase
            .from("leads")
            .select("id, name, phone, email")
            .eq("organization_id", currentTeamMember.organization_id)
            .or(filters.join(","))
            .limit(1);

          if (existingLeads && existingLeads.length > 0) {
            const existing = existingLeads[0];
            const matchField = existing.phone === formData.phone ? "telefone" : "email";
            const confirmed = window.confirm(
              `Já existe um lead com este ${matchField}: "${existing.name}". Deseja criar mesmo assim?`
            );
            if (!confirmed) return;
          }
        }

        const newLead = await createLead.mutateAsync(payload);
        leadId = newLead.id;
        logAction({ leadId: newLead.id, action: "lead_created", description: `Lead "${formData.name}" criado` });
      }

      if (leadId && Object.keys(customValues).length > 0) {
        for (const [fieldId, value] of Object.entries(customValues)) {
          if (value !== undefined) {
            await saveFieldValue.mutateAsync({
              leadId,
              fieldId,
              value: value || null,
            });
          }
        }
      }

      // Insert lead into selected funnel/stage
      let pipeInserted = false;
      if (showPipeSelector && !isEditing && leadId && selectedPipe && selectedStage) {
        try {
          if (selectedPipe === "std:whatsapp") {
            await createPipeWhatsapp.mutateAsync({ lead_id: leadId, status: selectedStage, organization_id: currentTeamMember.organization_id });
          } else if (selectedPipe === "std:confirmacao") {
            await createPipeConfirmacao.mutateAsync({ lead_id: leadId, status: selectedStage, organization_id: currentTeamMember.organization_id });
          } else if (selectedPipe === "std:propostas") {
            await createPipeProposta.mutateAsync({ lead_id: leadId, status: selectedStage, organization_id: currentTeamMember.organization_id });
          } else if (selectedPipe.startsWith("custom:")) {
            await addLeadToCustomPipe.mutateAsync({ pipeline_id: selectedPipe.slice(7), lead_id: leadId, stage_id: selectedStage });
          }
          pipeInserted = true;
        } catch (pipeError: any) {
          console.error("Erro ao inserir lead no funil:", pipeError);
          toast.error("Lead criado, mas houve erro ao inseri-lo no funil.");
        }
      }

      const pipeName = pipeInserted ? pipeOptions.find(p => p.value === selectedPipe)?.label : null;
      toast.success(isEditing ? "Lead atualizado!" : (pipeName ? `Lead criado e adicionado ao funil ${pipeName}!` : "Lead criado!"));
      onOpenChange(false);
      onSuccess?.(isEditing ? undefined : leadId);
    } catch (error: any) {
      console.error("Erro ao salvar lead:", {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        fullError: error,
      });

      if (error?.code === '42501' || error?.message?.includes('permission denied')) {
        toast.error("Erro de permissao. Verifique as politicas RLS no Supabase.");
      } else if (error?.code === '23503' || error?.message?.includes('foreign key')) {
        toast.error("Erro: organizacao nao encontrada. Execute o script SQL de vinculacao.");
      } else {
        toast.error(`Erro ao salvar lead: ${error?.message || 'Erro desconhecido'}`);
      }
    }
  };

  useEffect(() => {
    if (open) {
      setFormData({
        name: lead?.name || "",
        company: lead?.company || "",
        email: lead?.email || "",
        phone: lead?.phone || "",
        origin: lead?.origin || "outro",
            segment: lead?.segment || "",
        faturamento: lead?.faturamento || "",
        uf: lead?.uf || "",
        urgency: lead?.urgency || "",
        notes: lead?.notes || "",
        responsible_id: lead?.responsible_id || defaultResponsibleId || "",
      });
      setSelectedPipe("");
      setSelectedStage("");
    }
  }, [open, lead, defaultResponsibleId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[750px] max-h-[90vh] overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            {isEditing ? "Editar Lead" : "Novo Lead"}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="dados" className="w-full">
          <div className="px-6">
            <TabsList className={cn("grid w-full", isEditing ? "grid-cols-2" : "grid-cols-1")}>
              <TabsTrigger value="dados">Dados</TabsTrigger>
              {isEditing && (
                <TabsTrigger value="history" className="gap-1">
                  <History className="w-3 h-3" />
                  Historico
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <TabsContent value="dados" className="m-0">
            <ScrollArea className="h-[calc(90vh-200px)] max-h-[500px]">
              <div className="flex gap-6 px-6 py-4">
                {/* Coluna Esquerda - 70% */}
                <div className="flex-1 min-w-0 space-y-6">

                  {/* CONTATO */}
                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Contato</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="name" className="text-xs">Nome *</Label>
                        <Input
                          id="name"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          placeholder="Nome do lead"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="company" className="text-xs">Empresa</Label>
                        <div className="relative">
                          <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            id="company"
                            value={formData.company}
                            onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                            placeholder="Nome da empresa"
                            className="pl-9"
                          />
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="email" className="text-xs">Email</Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            id="email"
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            placeholder="email@empresa.com"
                            className="pl-9"
                          />
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="phone" className="text-xs">Telefone</Label>
                        <div className="relative">
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            id="phone"
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            placeholder="(11) 99999-9999"
                            className="pl-9"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CAMPOS PERSONALIZADOS */}
                  {customFields.length > 0 && (
                    <div>
                      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Campos Personalizados</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {customFields.map((field) => {
                          const value = customValues[field.id] || "";
                          const FieldIcon = {
                            text: Type,
                            number: Hash,
                            date: Calendar,
                            select: List,
                            boolean: ToggleLeft,
                          }[field.field_type] || Type;

                          return (
                            <div key={field.id} className="grid gap-1.5">
                              <Label className="flex items-center gap-1.5 text-xs">
                                <FieldIcon className="w-3 h-3 text-muted-foreground" />
                                {field.field_name}
                                {field.is_required && <span className="text-destructive">*</span>}
                              </Label>

                              {field.field_type === "select" ? (
                                <Select
                                  value={value}
                                  onValueChange={(v) => setCustomValues({ ...customValues, [field.id]: v })}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Selecione..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(field.field_options || []).map((opt: string) => (
                                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : field.field_type === "boolean" ? (
                                <Select
                                  value={value}
                                  onValueChange={(v) => setCustomValues({ ...customValues, [field.id]: v })}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Selecione..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="true">Sim</SelectItem>
                                    <SelectItem value="false">Nao</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : field.field_type === "date" ? (
                                <Input
                                  type="date"
                                  value={value}
                                  onChange={(e) => setCustomValues({ ...customValues, [field.id]: e.target.value })}
                                />
                              ) : field.field_type === "number" ? (
                                <Input
                                  type="number"
                                  value={value}
                                  onChange={(e) => setCustomValues({ ...customValues, [field.id]: e.target.value })}
                                  placeholder={`Digite ${field.field_name.toLowerCase()}...`}
                                />
                              ) : (
                                <Input
                                  value={value}
                                  onChange={(e) => setCustomValues({ ...customValues, [field.id]: e.target.value })}
                                  placeholder={`Digite ${field.field_name.toLowerCase()}...`}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* FUNIL — only visible when creating a new lead */}
                  {showPipeSelector && (
                    <div>
                      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Funil</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Adicionar ao Funil</Label>
                          <Select
                            value={selectedPipe}
                            onValueChange={(v) => { setSelectedPipe(v); setSelectedStage(""); }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Nenhum (opcional)" />
                            </SelectTrigger>
                            <SelectContent>
                              {pipeOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {selectedPipe && stageOptions.length > 0 && (
                          <div className="grid gap-1.5">
                            <Label className="text-xs">Etapa Inicial</Label>
                            <Select value={selectedStage} onValueChange={setSelectedStage}>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione..." />
                              </SelectTrigger>
                              <SelectContent>
                                {stageOptions.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* DETALHES */}
                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Detalhes</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="origin" className="text-xs">Origem</Label>
                        <Select
                          value={formData.origin}
                          onValueChange={(v) => setFormData({ ...formData, origin: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {leadOrigins.map((o) => (
                              <SelectItem key={o.slug} value={o.slug}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="segment" className="text-xs">Segmento</Label>
                        <Input
                          id="segment"
                          value={formData.segment}
                          onChange={(e) => setFormData({ ...formData, segment: e.target.value })}
                          placeholder="Ex: Tecnologia, Varejo..."
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="faturamento" className="text-xs">Faturamento</Label>
                        <Input
                          id="faturamento"
                          value={formData.faturamento}
                          onChange={(e) => setFormData({ ...formData, faturamento: e.target.value })}
                          placeholder="Ex: R$ 100.000, Acima de 1M..."
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="uf" className="text-xs">Estado</Label>
                        <Select
                          value={formData.uf || "none"}
                          onValueChange={(v) => setFormData({ ...formData, uf: v === "none" ? "" : v })}
                        >
                          <SelectTrigger id="uf">
                            <SelectValue placeholder="Selecione o estado" />
                          </SelectTrigger>
                          <SelectContent className="max-h-64">
                            <SelectItem value="none">Não informado</SelectItem>
                            {BR_UFS.map((u) => (
                              <SelectItem key={u.code} value={u.code}>{u.code} — {u.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="urgency" className="text-xs">Urgencia</Label>
                        <Input
                          id="urgency"
                          value={formData.urgency}
                          onChange={(e) => setFormData({ ...formData, urgency: e.target.value })}
                          placeholder="Ex: Alta, Media, Baixa..."
                        />
                      </div>

                      {/* Indicacao para adicionar novos campos */}
                      <div className="col-span-2 flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
                        <Plus className="w-3 h-3" />
                        <span>Gerencie campos em Configuracoes do Funil</span>
                      </div>
                    </div>
                  </div>

                  {/* Tags (read-only display) */}
                  {lead?.lead_tags?.length > 0 && (
                    <div>
                      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Etiquetas</h3>
                      <div className="flex flex-wrap gap-2">
                        {lead.lead_tags.map((lt: any) => (
                          <Badge
                            key={lt.tag.id}
                            variant="outline"
                            style={{
                              backgroundColor: `${lt.tag.color}20`,
                              borderColor: `${lt.tag.color}40`,
                              color: lt.tag.color
                            }}
                          >
                            <Tag className="w-3 h-3 mr-1" />
                            {lt.tag.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* OBSERVACOES */}
                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Observacoes</h3>
                    <Textarea
                      id="notes"
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="Anotacoes sobre o lead..."
                      rows={3}
                    />
                  </div>
                </div>

                {/* Coluna Direita - Sidebar de acoes (30%) */}
                <div className="w-[200px] shrink-0 space-y-2">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Acoes</p>

                  {/* Responsaveis */}
                  <SidebarSection icon={Users} label="Responsavel">
                    <div className="grid gap-2">
                      <Label>Responsavel</Label>
                      <Select
                        value={formData.responsible_id || "none"}
                        onValueChange={(v) => setFormData(prev => ({ ...prev, responsible_id: v === "none" ? null : v }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o responsavel" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nenhum</SelectItem>
                          {responsibleMembers.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </SidebarSection>

                  {/* Etiquetas */}
                  <SidebarSection icon={Tag} label="Etiquetas">
                    {lead?.lead_tags?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {lead.lead_tags.map((lt: any) => (
                          <Badge
                            key={lt.tag?.id}
                            variant="outline"
                            className="text-[10px]"
                            style={{
                              backgroundColor: `${lt.tag?.color}20`,
                              borderColor: `${lt.tag?.color}40`,
                              color: lt.tag?.color
                            }}
                          >
                            {lt.tag?.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Nenhuma etiqueta</p>
                    )}
                  </SidebarSection>

                  {/* Agendar Tarefa */}
                  {isEditing && lead?.id && (
                    <ScheduleFollowUpButton
                      leadId={lead.id}
                      leadName={lead.name}
                      defaultAssignedTo={formData.responsible_id || undefined}
                      variant="button"
                      size="sm"
                    />
                  )}

                  {/* Enviar Mensagem */}
                  {formData.phone.trim() && (
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2 text-sm"
                      asChild
                    >
                      <Link
                        to={`/chat-whatsapp?phone=${encodeURIComponent(formatPhoneForWhatsApp(formData.phone) || formData.phone)}`}
                        onClick={() => onOpenChange(false)}
                      >
                        <Send className="w-4 h-4 text-muted-foreground" />
                        Enviar Mensagem
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {isEditing && (
            <TabsContent value="history" className="m-0">
              <ScrollArea className="h-[calc(90vh-200px)] max-h-[500px]">
                <div className="px-6 py-4">
                  {historyLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : history && history.length > 0 ? (
                    <div className="space-y-0">
                      {history.slice(0, historyLimit).map((item, index) => (
                        <TimelineItem
                          key={item.id}
                          action={item.action}
                          description={item.description || undefined}
                          date={item.created_at}
                          source={(item as Record<string, unknown>).source as string || "manual"}
                          isLast={index === Math.min(history.length, historyLimit) - 1}
                        />
                      ))}
                      {history.length > historyLimit && (
                        <button
                          onClick={() => setHistoryLimit((prev) => prev + 50)}
                          className="w-full text-center text-sm text-primary hover:underline py-2"
                        >
                          Carregar mais ({history.length - historyLimit} restantes)
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <History className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        Nenhum historico registrado.
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          )}
        </Tabs>

        <div className="flex justify-end gap-2 px-6 pb-6 pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createLead.isPending || updateLead.isPending}
          >
            {isEditing ? "Salvar Alteracoes" : "Criar Lead"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
