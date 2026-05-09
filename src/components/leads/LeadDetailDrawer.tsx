/**
 * LeadDetailDrawer — unified detail modal for all funnels
 *
 * 5 tabs:
 *   1. Dados       — two-column layout (form + sidebar with quick-note, tags, etc.)
 *   2. Histórico   — advanced timeline (useLeadTimeline + filters)
 *   3. Contexto    — variant-specific funnel actions (meeting, products, orders…)
 *   4. Chat        — ConversationHistoryTab
 *   5. Pipeline    — journey across all pipes
 *
 * Layout: Dialog central, max-w-[900px], max-h-[90vh]
 */

import { useState, useEffect, useMemo, memo, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  User,
  Building2,
  Mail,
  Phone,
  Flame,
  Bot,
  MessageSquare,
  Calendar,
  DollarSign,
  CheckCircle,
  ArrowRight,
  History,
  Loader2,
  Search,
  Activity,
  CalendarDays,
  Clock,
  BarChart3,
  Tag,
  MoreVertical,
  Trash2,
  Plus,
  Type,
  Hash,
  List,
  ToggleLeft,
  Send,
  PhoneCall,
  Target,
  Edit2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToggleLeadAI, useUpdateLead, useDeleteLead } from "@/hooks/useLeads";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useTrackView } from "@/hooks/useTrackView";
import { useLeadTimeline } from "@/hooks/useLeadTimeline";
import type { TimelineSource, TimelinePeriod } from "@/hooks/useLeadTimeline";
import {
  useLeadCustomFields,
  useLeadCustomFieldValues,
  useSaveCustomFieldValue,
} from "@/hooks/useLeadCustomFields";
import { useResponsibleMembers } from "@/hooks/useTeamMembers";
import { useTags } from "@/hooks/useTags";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ConversationHistoryTab } from "./ConversationHistoryTab";
import { TimelineItem } from "./TimelineItem";
import { FieldChangelogTimeline } from "./FieldChangelogTimeline";
import { ScheduleFollowUpButton } from "@/components/followups/ScheduleFollowUpButton";
import { ScheduleMessageModal } from "@/components/chat/ScheduleMessageModal";
import { LogCallModal } from "@/components/calls/LogCallModal";
import { EmailComposer } from "@/components/email/EmailComposer";
import { SmsSendDialog } from "@/components/sms/SmsSendDialog";
import { AiEmailWriter } from "@/components/ai/AiEmailWriter";
import { ORIGIN_COLORS } from "./LeadCard";
import { LeadChecklistSection } from "./LeadChecklistSection";
import { LeadContactsSection } from "./LeadContactsSection";
import { cn } from "@/lib/utils";
import { useOpenWhatsAppChat, formatPhoneForWhatsApp } from "@/lib/whatsapp";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useToast } from "@/hooks/use-toast";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DrawerVariant =
  | "whatsapp"
  | "confirmacao"
  | "propostas"
  | "followup"
  | "custom"
  | "upsell_client"
  | "upsell_campanha"
  | "leads"; // leads table

export interface LeadDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string | null;
  variant: DrawerVariant;
  /** Pipe-specific data (pipe_whatsapp row, pipe_confirmacao row, etc.) */
  pipeData?: any;
  /** Called after successful save/mutation */
  onSuccess?: () => void;
  /** Render the Contexto do funil tab content (variant-specific) */
  renderFunnelContext?: (props: { lead: any; pipeData: any; onSuccess?: () => void }) => ReactNode;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const VARIANT_LABELS: Record<DrawerVariant, string> = {
  whatsapp: "Qualificação",
  confirmacao: "Confirmação",
  propostas: "Propostas",
  followup: "Follow-ups",
  custom: "Pipeline",
  upsell_client: "Upsell",
  upsell_campanha: "Upsell",
  leads: "Leads",
};

const SOURCE_FILTER_OPTIONS: { value: TimelineSource | "all" | "pipeline"; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "manual", label: "Manual" },
  { value: "agent", label: "Copilot" },
  { value: "automation", label: "Automação" },
  { value: "system", label: "Sistema" },
  { value: "pipeline", label: "Pipeline" },
];

const PERIOD_OPTIONS: { value: TimelinePeriod; label: string }[] = [
  { value: "all", label: "Tudo" },
  { value: "today", label: "Hoje" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
];

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  agent: "Copilot",
  automation: "Automação",
  system: "Sistema",
};

// ─── Component ──────────────────────────────────────────────────────────────

export const LeadDetailDrawer = memo(function LeadDetailDrawer({
  open,
  onOpenChange,
  leadId,
  variant,
  pipeData,
  onSuccess,
  renderFunnelContext,
}: LeadDetailDrawerProps) {
  const { toast: hookToast } = useToast();
  const queryClient = useQueryClient();
  const toggleAIMutation = useToggleLeadAI();
  const openWhatsApp = useOpenWhatsAppChat();
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();
  const logAction = useLogLeadAction();
  const [optimisticAiDisabled, setOptimisticAiDisabled] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState("dados");
  const [quickNote, setQuickNote] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [emailWriterOpen, setEmailWriterOpen] = useState(false);
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);

  // ─── Lead query ─────────────────────────────────────────
  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead-detail", leadId],
    queryFn: async () => {
      if (!leadId) return null;

      const { data, error } = await supabase
        .from("leads")
        .select(`
          *,
          responsible:team_members!leads_responsible_id_fkey(id, name),
          sdr:team_members!leads_sdr_id_fkey(id, name),
          closer:team_members!leads_closer_id_fkey(id, name),
          pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(id, name),
          sale_responsible:team_members!leads_sale_responsible_id_fkey(id, name),
          lead_tags(
            tag:tags(id, name, color)
          )
        `)
        .eq("id", leadId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!leadId && open,
  });

  useTrackView(
    open && leadId ? "lead" : undefined,
    open ? (leadId ?? undefined) : undefined,
    lead?.name,
  );

  // ─── Pipeline query ─────────────────────────────────────
  const { data: pipelineData } = useQuery({
    queryKey: ["lead-pipes", leadId],
    queryFn: async () => {
      if (!leadId) return null;

      const [whatsapp, confirmacao, propostas, customEntries, followUps] = await Promise.all([
        supabase.from("pipe_whatsapp").select("*").eq("lead_id", leadId),
        supabase.from("pipe_confirmacao").select("*").eq("lead_id", leadId),
        supabase.from("pipe_propostas").select("*").eq("lead_id", leadId),
        supabase.from("custom_pipe_entries").select("*, stage:custom_pipeline_stages(name, color), pipeline:custom_pipelines(name)").eq("lead_id", leadId),
        supabase.from("follow_ups").select("*").eq("lead_id", leadId),
      ]);

      return {
        whatsapp: whatsapp.data || [],
        confirmacao: confirmacao.data || [],
        propostas: propostas.data || [],
        customEntries: customEntries.data || [],
        followUps: followUps.data || [],
      };
    },
    enabled: !!leadId && open,
  });

  // ─── Timeline ───────────────────────────────────────────
  const timeline = useLeadTimeline(open ? leadId ?? undefined : undefined);

  // ─── Custom fields ──────────────────────────────────────
  const { data: customFields = [] } = useLeadCustomFields();
  const { data: fieldValues = [] } = useLeadCustomFieldValues(leadId || null);
  const saveFieldValue = useSaveCustomFieldValue();
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const responsibleMembers = useResponsibleMembers();
  const { data: allTags = [] } = useTags();
  const [togglingTagId, setTogglingTagId] = useState<string | null>(null);

  const toggleLeadTag = async (tagId: string) => {
    if (!lead) return;
    setTogglingTagId(tagId);
    try {
      const existing = lead.lead_tags?.find((lt: any) => lt.tag?.id === tagId);
      if (existing) {
        await supabase.from("lead_tags").delete().eq("lead_id", lead.id).eq("tag_id", tagId);
      } else {
        await supabase.from("lead_tags").insert({ lead_id: lead.id, tag_id: tagId });
      }
      queryClient.invalidateQueries({ queryKey: ["lead-detail"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
    } catch {
      toast.error("Erro ao atualizar etiqueta");
    } finally {
      setTogglingTagId(null);
    }
  };

  // ─── Edit form state ───────────────────────────────────
  const [formData, setFormData] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    origin: "outro",
    rating: 5,
    segment: "",
    faturamento: "",
    urgency: "",
    notes: "",
    responsible_id: "" as string | null,
    pre_sale_responsible_id: "" as string | null,
    sale_responsible_id: "" as string | null,
  });
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open && lead) {
      setFormData({
        name: lead.name || "",
        company: lead.company || "",
        email: lead.email || "",
        phone: lead.phone || "",
        origin: lead.origin || "outro",
        rating: lead.rating || 5,
        segment: lead.segment || "",
        faturamento: lead.faturamento || "",
        urgency: lead.urgency || "",
        notes: lead.notes || "",
        responsible_id: lead.responsible_id || "",
        pre_sale_responsible_id: lead.pre_sale_responsible_id || "",
        sale_responsible_id: lead.sale_responsible_id || "",
      });
      setIsDirty(false);
      setOptimisticAiDisabled(null);
      setActiveTab("dados");
      setQuickNote("");
    }
  }, [open, lead?.id]);

  // Sync custom field values
  const fieldValuesKey = useMemo(
    () => fieldValues.map(fv => `${fv.field_id}:${fv.value ?? ""}`).join(","),
    [fieldValues]
  );

  useEffect(() => {
    if (leadId && fieldValues.length > 0) {
      const values: Record<string, string> = {};
      fieldValues.forEach((fv) => {
        values[fv.field_id] = fv.value || "";
      });
      setCustomValues(values);
    } else {
      setCustomValues({});
    }
  }, [leadId, fieldValuesKey]);

  // ─── Handlers ───────────────────────────────────────────
  const handleFieldChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  // Auto-save responsible change immediately (no need to click Salvar)
  const handleResponsibleChange = async (newResponsibleId: string | null) => {
    if (!lead) return;
    // Update local state immediately for instant UI feedback
    setFormData((prev) => ({ ...prev, responsible_id: newResponsibleId }));

    try {
      await updateLead.mutateAsync({
        id: lead.id,
        responsible_id: newResponsibleId,
      });
      const responsibleName = responsibleMembers.find((m) => m.id === newResponsibleId)?.name || "Nenhum";
      logAction({ leadId: lead.id, action: "responsible_assigned", description: `Responsável alterado para "${responsibleName}"` });
      queryClient.invalidateQueries({ queryKey: ["lead-detail", leadId] });
      toast.success(`Responsável alterado para "${responsibleName}"`);
      onSuccess?.();
    } catch (error: any) {
      // Revert on failure
      setFormData((prev) => ({ ...prev, responsible_id: lead.responsible_id || "" }));
      toast.error(`Erro ao alterar responsável: ${error?.message || "Erro desconhecido"}`);
    }
  };

  const handlePreSaleResponsibleChange = async (newId: string | null) => {
    if (!lead) return;
    setFormData((prev) => ({ ...prev, pre_sale_responsible_id: newId }));
    try {
      await updateLead.mutateAsync({
        id: lead.id,
        pre_sale_responsible_id: newId,
      });
      const name = responsibleMembers.find((m) => m.id === newId)?.name || "Nenhum";
      logAction({ leadId: lead.id, action: "pre_sale_responsible_assigned", description: `Resp. Pré-Venda alterado para "${name}"` });
      queryClient.invalidateQueries({ queryKey: ["lead-detail", leadId] });
      toast.success(`Resp. Pré-Venda: "${name}"`);
      onSuccess?.();
    } catch (error: any) {
      setFormData((prev) => ({ ...prev, pre_sale_responsible_id: lead.pre_sale_responsible_id || "" }));
      toast.error(`Erro ao alterar responsável: ${error?.message || "Erro desconhecido"}`);
    }
  };

  const handleSaleResponsibleChange = async (newId: string | null) => {
    if (!lead) return;
    setFormData((prev) => ({ ...prev, sale_responsible_id: newId }));
    try {
      await updateLead.mutateAsync({
        id: lead.id,
        sale_responsible_id: newId,
      });
      const name = responsibleMembers.find((m) => m.id === newId)?.name || "Nenhum";
      logAction({ leadId: lead.id, action: "sale_responsible_assigned", description: `Resp. Venda alterado para "${name}"` });
      queryClient.invalidateQueries({ queryKey: ["lead-detail", leadId] });
      toast.success(`Resp. Venda: "${name}"`);
      onSuccess?.();
    } catch (error: any) {
      setFormData((prev) => ({ ...prev, sale_responsible_id: lead.sale_responsible_id || "" }));
      toast.error(`Erro ao alterar responsável: ${error?.message || "Erro desconhecido"}`);
    }
  };

  const handleSave = async () => {
    if (!lead) return;
    setIsSaving(true);

    try {
      const payload = {
        id: lead.id,
        name: formData.name,
        company: formData.company || null,
        email: formData.email || null,
        phone: formData.phone || null,
        origin: formData.origin as any,
        rating: formData.rating,
        segment: formData.segment || null,
        faturamento: formData.faturamento || null,
        urgency: formData.urgency || null,
        notes: formData.notes || null,
        responsible_id: formData.responsible_id || null,
      };

      await updateLead.mutateAsync(payload);

      // Log changed fields
      const changes: string[] = [];
      if (formData.name !== lead.name) changes.push("nome");
      if (formData.company !== (lead.company || "")) changes.push("empresa");
      if (formData.email !== (lead.email || "")) changes.push("email");
      if (formData.phone !== (lead.phone || "")) changes.push("telefone");
      if (formData.segment !== (lead.segment || "")) changes.push("segmento");
      if (formData.notes !== (lead.notes || "")) changes.push("observações");
      // Note: responsible_id changes are auto-saved via handleResponsibleChange (no need to log here)
      if (changes.length > 0) {
        logAction({ leadId: lead.id, action: "field_updated", description: `Campos atualizados: ${changes.join(", ")}` });
      }

      // Save custom field values
      if (Object.keys(customValues).length > 0) {
        for (const [fieldId, value] of Object.entries(customValues)) {
          if (value !== undefined) {
            await saveFieldValue.mutateAsync({
              leadId: lead.id,
              fieldId,
              value: value || null,
            });
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["lead-detail", leadId] });
      toast.success("Lead atualizado!");
      setIsDirty(false);
      onSuccess?.();
    } catch (error: any) {
      toast.error(`Erro ao salvar lead: ${error?.message || "Erro desconhecido"}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveQuickNote = async () => {
    if (!lead || !quickNote.trim()) return;
    setIsSavingNote(true);
    try {
      // Direct insert for reliability (logAction swallows errors)
      const { data: { user } } = await supabase.auth.getUser();
      const { data: member } = user
        ? await supabase.from("team_members").select("name").eq("user_id", user.id).maybeSingle()
        : { data: null };
      const userName = member?.name || user?.email?.split("@")[0] || "Usuário";

      const { error } = await supabase.from("lead_history").insert({
        lead_id: lead.id,
        action: "note_added",
        description: `${userName}: ${quickNote.trim()}`,
        created_by: user?.id || null,
        organization_id: lead.organization_id || null,
      });

      if (error) throw error;

      // Invalidate all timeline/history query variants so the UI updates
      queryClient.invalidateQueries({ queryKey: ["lead-timeline", lead.id] });
      queryClient.invalidateQueries({ queryKey: ["lead-history", lead.id] });
      queryClient.invalidateQueries({ queryKey: ["lead_history", lead.id] });
      queryClient.invalidateQueries({ queryKey: ["lead-history-compact", lead.id] });
      toast.success("Nota adicionada!");
      setQuickNote("");
    } catch (err: any) {
      console.error("[QuickNote] Erro:", err);
      toast.error(err?.message || "Erro ao salvar nota");
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleDeleteLead = async () => {
    if (!lead) return;
    const confirmed = window.confirm(`Tem certeza que deseja excluir o lead "${lead.name}"? Esta ação não pode ser desfeita.`);
    if (!confirmed) return;
    try {
      await deleteLead.mutateAsync(lead.id);
      toast.success("Lead excluído!");
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao excluir lead");
    }
  };

  const handleToggleAI = (checked: boolean) => {
    if (!lead) return;
    setOptimisticAiDisabled(!checked);
    toggleAIMutation.mutate(
      { leadId: lead.id, disabled: !checked },
      {
        onSuccess: () => {
          logAction({ leadId: lead.id, action: "ai_toggled", description: checked ? "IA ativada" : "IA desativada" });
          hookToast({
            title: checked ? "IA ativada" : "IA desativada",
            description: checked
              ? "A IA voltará a responder mensagens deste lead."
              : "A IA não responderá mais mensagens deste lead.",
          });
          // Não limpar optimistic — useEffect sync cuida disso
        },
        onError: () => {
          hookToast({ title: "Erro", description: "Não foi possível alterar o status da IA.", variant: "destructive" });
          setOptimisticAiDisabled(null);
        },
      }
    );
  };

  // ─── Render helpers ────────────────────────────────────
  const fmtCurrency = (value: number | null | undefined) => {
    if (!value) return "R$ 0";
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(value);
  };

  const initials = (name: string | undefined) =>
    (name || "?")
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  const currentAiDisabled = optimisticAiDisabled !== null ? optimisticAiDisabled : (lead?.ai_disabled ?? false);

  // Sincronizar: quando a prop refletir o valor otimista, limpar estado otimista
  useEffect(() => {
    if (optimisticAiDisabled !== null && lead?.ai_disabled === optimisticAiDisabled) {
      setOptimisticAiDisabled(null);
    }
  }, [lead?.ai_disabled, optimisticAiDisabled]);

  // Compute relative dates for footer
  const createdAgo = lead?.created_at
    ? formatDistanceToNow(new Date(lead.created_at), { addSuffix: true, locale: ptBR })
    : null;
  const lastActivityDate = timeline.data?.metrics?.lastContact
    ?? lead?.updated_at
    ?? lead?.created_at;
  const lastActivity = lastActivityDate
    ? formatDistanceToNow(new Date(lastActivityDate), { addSuffix: true, locale: ptBR })
    : null;

  if (!open) return null;

  // ─── Render ─────────────────────────────────────────────
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] p-0 overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : lead ? (
          <>
            {/* ─── Header ─────────────────────────────── */}
            <div className="p-6 pb-4 border-b border-border bg-gradient-to-r from-primary/5 to-transparent shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-xl font-bold text-primary">{initials(lead.name)}</span>
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold truncate">{lead.name}</h2>
                    {lead.company && (
                      <p className="text-muted-foreground flex items-center gap-1 mt-0.5 text-sm">
                        <Building2 className="w-4 h-4 shrink-0" />
                        <span className="truncate">{lead.company}</span>
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {/* Origin badge */}
                      {(() => {
                        const oc = ORIGIN_COLORS[lead.origin] || ORIGIN_COLORS.outro;
                        return (
                          <Badge
                            variant="outline"
                            className="text-xs"
                            style={{ backgroundColor: oc.bg, color: oc.text, borderColor: `${oc.text}30` }}
                          >
                            {oc.label}
                          </Badge>
                        );
                      })()}
                      {/* Urgency badge */}
                      {lead.urgency && (
                        <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-600 border-orange-500/20">
                          {lead.urgency}
                        </Badge>
                      )}
                      {/* Funnel badge */}
                      <Badge variant="outline" className="text-xs">
                        {VARIANT_LABELS[variant]}
                      </Badge>
                      {/* Calor */}
                      {lead.rating != null && lead.rating > 0 && (() => {
                        const info = lead.rating >= 8
                          ? { color: "text-red-500", bg: "bg-red-500/10 border-red-500/30" }
                          : lead.rating >= 4
                          ? { color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/30" }
                          : { color: "text-blue-500", bg: "bg-blue-500/10 border-blue-500/30" };
                        return (
                          <Badge variant="outline" className={cn("text-xs gap-1", info.bg)}>
                            <Flame className={cn("w-3 h-3", info.color)} />
                            <span className={info.color}>{lead.rating}</span>
                          </Badge>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* Header actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* WhatsApp */}
                  {lead.phone && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => openWhatsApp(formatPhoneForWhatsApp(lead.phone))}
                    >
                      <MessageSquare className="w-4 h-4 text-green-600" />
                      WhatsApp
                    </Button>
                  )}

                  {/* Ação do dia */}
                  {leadId && (
                    <ScheduleFollowUpButton
                      leadId={leadId}
                      leadName={lead.name}
                      defaultAssignedTo={lead.responsible_id || undefined}
                      variant="button"
                      size="sm"
                    />
                  )}


                  {leadId && lead?.phone && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setScheduleModalOpen(true)}
                      className="gap-1.5"
                    >
                      <Clock className="w-4 h-4" />
                      Agendar mensagem
                    </Button>
                  )}

                  {/* Menu */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="h-8 w-8">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {/* AI Toggle */}
                      <DropdownMenuItem
                        onClick={(e) => { e.preventDefault(); handleToggleAI(!currentAiDisabled ? false : true); }}
                      >
                        <Bot className="w-4 h-4 mr-2" />
                        {currentAiDisabled ? "Ativar IA" : "Desativar IA"}
                      </DropdownMenuItem>
                      {lead.phone && (
                        <DropdownMenuItem asChild>
                          <a href={`tel:${(lead.phone || "").replace(/\D/g, "")}`}>
                            <PhoneCall className="w-4 h-4 mr-2" />
                            Ligar
                          </a>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setCallModalOpen(true)}>
                        <PhoneCall className="w-4 h-4 mr-2" />
                        Registrar ligação
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEmailWriterOpen(true)}>
                        <Mail className="w-4 h-4 mr-2" />
                        Redigir email com IA
                      </DropdownMenuItem>
                      {lead.phone && (
                        <DropdownMenuItem asChild>
                          <Link
                            to={`/chat-whatsapp?phone=${encodeURIComponent(formatPhoneForWhatsApp(lead.phone) || lead.phone)}`}
                            onClick={() => onOpenChange(false)}
                          >
                            <Send className="w-4 h-4 mr-2" />
                            Enviar mensagem
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {lead.email && (
                        <DropdownMenuItem onClick={() => setEmailComposerOpen(true)}>
                          <Mail className="w-4 h-4 mr-2" />
                          Enviar email
                        </DropdownMenuItem>
                      )}
                      {lead.phone && (
                        <DropdownMenuItem onClick={() => setSmsDialogOpen(true)}>
                          <Phone className="w-4 h-4 mr-2" />
                          Enviar SMS
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>

            {/* ─── Tabs ───────────────────────────────── */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
              <div className="px-6 pt-2 shrink-0">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="dados">Dados</TabsTrigger>
                  <TabsTrigger value="historico">Histórico</TabsTrigger>
                  <TabsTrigger value="contexto">Contexto do funil</TabsTrigger>
                  <TabsTrigger value="ai" className="flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5" />
                    Chat
                  </TabsTrigger>
                  <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
                </TabsList>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0">
                {/* ─── Tab 1: Dados (Two-Column Layout) ── */}
                <TabsContent value="dados" className="p-6 pt-4 m-0">
                  <div className="flex gap-6">
                    {/* ─── Left Column (main content) ─── */}
                    <div className="flex-1 min-w-0 space-y-6">
                      {/* CONTATO */}
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Contato</h3>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-1.5">
                            <Label htmlFor="dd-phone" className="text-xs">Telefone</Label>
                            <Input
                              id="dd-phone"
                              value={formData.phone}
                              onChange={(e) => handleFieldChange("phone", e.target.value)}
                              placeholder="(11) 99999-0000"
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="dd-email" className="text-xs">Email</Label>
                            <Input
                              id="dd-email"
                              type="email"
                              value={formData.email}
                              onChange={(e) => handleFieldChange("email", e.target.value)}
                              placeholder="email@empresa.com"
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="dd-company" className="text-xs">Empresa</Label>
                            <Input
                              id="dd-company"
                              value={formData.company}
                              onChange={(e) => handleFieldChange("company", e.target.value)}
                              placeholder="Nome da empresa"
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="dd-faturamento" className="text-xs">Faturamento</Label>
                            <Input
                              id="dd-faturamento"
                              value={formData.faturamento}
                              onChange={(e) => handleFieldChange("faturamento", e.target.value)}
                              placeholder="R$ 100.000"
                            />
                          </div>
                        </div>
                      </div>

                      {/* OBSERVAÇÕES */}
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Observações</h3>
                        <Textarea
                          value={formData.notes}
                          onChange={(e) => handleFieldChange("notes", e.target.value)}
                          placeholder="Anotações sobre o lead..."
                          rows={3}
                        />
                      </div>

                      {/* EMAIL COMPOSER — inline when open */}
                      {emailComposerOpen && (
                        <div>
                          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Enviar Email</h3>
                          <EmailComposer
                            defaultTo={lead.email || ""}
                            leadId={lead.id}
                            compact
                            onClose={() => setEmailComposerOpen(false)}
                            onSent={() => setEmailComposerOpen(false)}
                          />
                        </div>
                      )}

                      {/* HISTÓRICO RECENTE — last 3 events */}
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
                          Histórico recente
                        </h3>
                        {timeline.isLoading ? (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                          </div>
                        ) : timeline.data && timeline.data.events.length > 0 ? (
                          <div className="space-y-0">
                            {timeline.data.events.slice(0, 3).map((event, index) => (
                              <TimelineItem
                                key={event.id}
                                event={event}
                                isLast={index === Math.min(2, timeline.data!.events.length - 1)}
                              />
                            ))}
                            {timeline.data.events.length > 3 && (
                              <button
                                onClick={() => setActiveTab("historico")}
                                className="w-full text-left text-sm text-primary hover:underline py-2 flex items-center gap-1"
                              >
                                Ver histórico completo
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground py-2">
                            Nenhum histórico registrado.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* ─── Right Sidebar ─── */}
                    <div className="w-[240px] shrink-0 space-y-5">
                      {/* RESPONSÁVEL PRÉ-VENDA */}
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Resp. Pré-Venda</h3>
                        <Select
                          value={formData.pre_sale_responsible_id || "none"}
                          onValueChange={(v) => handlePreSaleResponsibleChange(v === "none" ? null : v)}
                        >
                          <SelectTrigger className="h-9">
                            {formData.pre_sale_responsible_id && formData.pre_sale_responsible_id !== "none" ? (
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                                  <span className="text-[9px] font-bold text-blue-500">
                                    {initials(responsibleMembers.find(m => m.id === formData.pre_sale_responsible_id)?.name)}
                                  </span>
                                </div>
                                <span className="truncate text-sm">
                                  {responsibleMembers.find(m => m.id === formData.pre_sale_responsible_id)?.name || "—"}
                                </span>
                              </div>
                            ) : (
                              <SelectValue placeholder="Selecionar..." />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Nenhum</SelectItem>
                            {responsibleMembers.map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* RESPONSÁVEL VENDA */}
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Resp. Venda</h3>
                        <Select
                          value={formData.sale_responsible_id || "none"}
                          onValueChange={(v) => handleSaleResponsibleChange(v === "none" ? null : v)}
                        >
                          <SelectTrigger className="h-9">
                            {formData.sale_responsible_id && formData.sale_responsible_id !== "none" ? (
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                                  <span className="text-[9px] font-bold text-emerald-500">
                                    {initials(responsibleMembers.find(m => m.id === formData.sale_responsible_id)?.name)}
                                  </span>
                                </div>
                                <span className="truncate text-sm">
                                  {responsibleMembers.find(m => m.id === formData.sale_responsible_id)?.name || "—"}
                                </span>
                              </div>
                            ) : (
                              <SelectValue placeholder="Selecionar..." />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Nenhum</SelectItem>
                            {responsibleMembers.map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* ETIQUETAS */}
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Etiquetas</h3>
                        <div className="flex flex-wrap gap-1.5">
                          {lead.lead_tags?.map((lt: any) => (
                            <Badge
                              key={lt.tag?.id}
                              variant="outline"
                              className="text-xs cursor-pointer hover:opacity-70 transition-opacity"
                              style={{
                                backgroundColor: `${lt.tag?.color}20`,
                                borderColor: `${lt.tag?.color}40`,
                                color: lt.tag?.color,
                              }}
                              onClick={() => toggleLeadTag(lt.tag?.id)}
                            >
                              {lt.tag?.name} ×
                            </Badge>
                          ))}
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                              >
                                <Plus className="w-3 h-3" /> Adicionar
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-48 p-2" align="start">
                              <p className="text-xs font-semibold text-muted-foreground mb-2">Selecionar etiqueta</p>
                              {allTags.length === 0 ? (
                                <p className="text-xs text-muted-foreground">Nenhuma etiqueta cadastrada</p>
                              ) : (
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                  {allTags.map((t) => {
                                    const isAssigned = lead.lead_tags?.some((lt: any) => lt.tag?.id === t.id);
                                    return (
                                      <button
                                        key={t.id}
                                        type="button"
                                        disabled={togglingTagId === t.id}
                                        onClick={() => toggleLeadTag(t.id)}
                                        className={cn(
                                          "w-full flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-accent transition-colors text-left",
                                          isAssigned && "bg-accent"
                                        )}
                                      >
                                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color || "#888" }} />
                                        <span className="truncate flex-1">{t.name}</span>
                                        {isAssigned && <CheckCircle className="w-3 h-3 text-primary shrink-0" />}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>

                      {/* ADICIONAR NOTA */}
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Adicionar nota</h3>
                        <Textarea
                          value={quickNote}
                          onChange={(e) => setQuickNote(e.target.value)}
                          placeholder="Escreva uma nota rápida..."
                          rows={3}
                          className="text-sm resize-none"
                        />
                        <div className="flex justify-end mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!quickNote.trim() || isSavingNote}
                            onClick={handleSaveQuickNote}
                          >
                            {isSavingNote ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                            Salvar
                          </Button>
                        </div>
                      </div>

                      {/* CHECKLISTS */}
                      {lead?.id && <LeadChecklistSection leadId={lead.id} />}

                      {/* CONTATOS */}
                      {lead?.id && <LeadContactsSection leadId={lead.id} />}

                      {/* SEGMENTO */}
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Segmento</h3>
                        <Input
                          value={formData.segment}
                          onChange={(e) => handleFieldChange("segment", e.target.value)}
                          placeholder="Ex: Tecnologia, Varejo..."
                          className="h-8 text-sm"
                        />
                      </div>

                      {/* URGÊNCIA */}
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Urgência</h3>
                        <Select
                          value={formData.urgency || "none"}
                          onValueChange={(v) => handleFieldChange("urgency", v === "none" ? "" : v)}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Selecionar..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Nenhuma</SelectItem>
                            <SelectItem value="imediato">Imediato</SelectItem>
                            <SelectItem value="1-mes">1 mês</SelectItem>
                            <SelectItem value="2-3-meses">2-3 meses</SelectItem>
                            <SelectItem value="6-meses">6+ meses</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* CRIADO EM */}
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Criado em</h3>
                        <p className="text-sm font-medium">
                          {lead.created_at ? format(new Date(lead.created_at), "dd/MM/yyyy") : "—"}
                        </p>
                      </div>

                      {/* CALOR DO LEAD */}
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
                          <Flame className={cn("w-3.5 h-3.5", formData.rating >= 8 ? "text-red-500" : formData.rating >= 4 ? "text-amber-500" : "text-blue-500")} />
                          Calor do Lead
                          <span className={cn("ml-auto text-sm font-bold", formData.rating >= 8 ? "text-red-500" : formData.rating >= 4 ? "text-amber-500" : "text-blue-500")}>
                            {formData.rating || 0}
                          </span>
                        </h3>
                        <Slider
                          min={1}
                          max={10}
                          step={1}
                          value={[formData.rating || 1]}
                          onValueChange={([v]) => handleFieldChange("rating", v)}
                          className="mb-1.5"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span className={formData.rating <= 3 ? "text-blue-500 font-semibold" : ""}>Frio</span>
                          <span className={formData.rating >= 4 && formData.rating <= 7 ? "text-amber-500 font-semibold" : ""}>Morno</span>
                          <span className={formData.rating >= 8 ? "text-red-500 font-semibold" : ""}>Quente</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Advanced details — visible section */}
                  {(customFields.length > 0 || lead.utm_campaign || lead.utm_source) && (
                    <div className="mt-6 border-t pt-4 space-y-4">
                      {/* Nome + Origem */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Nome *</Label>
                          <Input
                            value={formData.name}
                            onChange={(e) => handleFieldChange("name", e.target.value)}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs">Origem</Label>
                          <Select
                            value={formData.origin}
                            onValueChange={(v) => handleFieldChange("origin", v)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(ORIGIN_COLORS).map(([key, { label }]) => (
                                <SelectItem key={key} value={key}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Custom fields */}
                        {customFields.map((field) => {
                          const value = customValues[field.id] || "";
                          const FieldIcon = ({ text: Type, number: Hash, date: Calendar, select: List, boolean: ToggleLeft } as any)[field.field_type] || Type;

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
                                  onValueChange={(v) => { setCustomValues({ ...customValues, [field.id]: v }); setIsDirty(true); }}
                                >
                                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                  <SelectContent>
                                    {(field.field_options || []).map((opt: string) => (
                                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : field.field_type === "boolean" ? (
                                <Select
                                  value={value}
                                  onValueChange={(v) => { setCustomValues({ ...customValues, [field.id]: v }); setIsDirty(true); }}
                                >
                                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="true">Sim</SelectItem>
                                    <SelectItem value="false">Não</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : field.field_type === "date" ? (
                                <Input
                                  type="date"
                                  value={value}
                                  onChange={(e) => { setCustomValues({ ...customValues, [field.id]: e.target.value }); setIsDirty(true); }}
                                />
                              ) : field.field_type === "number" ? (
                                <Input
                                  type="number"
                                  value={value}
                                  onChange={(e) => { setCustomValues({ ...customValues, [field.id]: e.target.value }); setIsDirty(true); }}
                                  placeholder={`Digite ${field.field_name.toLowerCase()}...`}
                                />
                              ) : (
                                <Input
                                  value={value}
                                  onChange={(e) => { setCustomValues({ ...customValues, [field.id]: e.target.value }); setIsDirty(true); }}
                                  placeholder={`Digite ${field.field_name.toLowerCase()}...`}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* UTM */}
                      {(lead.utm_campaign || lead.utm_source || lead.utm_medium || lead.utm_content || lead.utm_term) && (
                        <div>
                          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Marketing (UTM)</h3>
                          <div className="grid grid-cols-2 gap-3">
                            {lead.utm_campaign && (
                              <div className="p-3 bg-muted rounded-lg">
                                <p className="text-xs text-muted-foreground mb-1">utm_campaign</p>
                                <p className="font-medium text-sm break-words">{lead.utm_campaign}</p>
                              </div>
                            )}
                            {lead.utm_source && (
                              <div className="p-3 bg-muted rounded-lg">
                                <p className="text-xs text-muted-foreground mb-1">utm_source</p>
                                <p className="font-medium text-sm break-words">{lead.utm_source}</p>
                              </div>
                            )}
                            {lead.utm_medium && (
                              <div className="p-3 bg-muted rounded-lg">
                                <p className="text-xs text-muted-foreground mb-1">utm_medium</p>
                                <p className="font-medium text-sm break-words">{lead.utm_medium}</p>
                              </div>
                            )}
                            {lead.utm_content && (
                              <div className="p-3 bg-muted rounded-lg">
                                <p className="text-xs text-muted-foreground mb-1">utm_content</p>
                                <p className="font-medium text-sm break-words">{lead.utm_content}</p>
                              </div>
                            )}
                            {lead.utm_term && (
                              <div className="p-3 bg-muted rounded-lg">
                                <p className="text-xs text-muted-foreground mb-1">utm_term</p>
                                <p className="font-medium text-sm break-words">{lead.utm_term}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>

                {/* ─── Tab 2: Histórico ───────────────── */}
                <TabsContent value="historico" className="p-6 pt-4 m-0">
                  {/* Metrics */}
                  {timeline.data?.metrics && timeline.data.metrics.total > 0 && (
                    <div className="grid grid-cols-4 gap-2 mb-4">
                      <div className="rounded-lg bg-muted p-2.5">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Activity className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">Interações</span>
                        </div>
                        <p className="text-base font-semibold">{timeline.data.metrics.total}</p>
                      </div>
                      <div className="rounded-lg bg-muted p-2.5">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">Dias</span>
                        </div>
                        <p className="text-base font-semibold">{timeline.data.metrics.daysSinceFirstContact}</p>
                      </div>
                      <div className="rounded-lg bg-muted p-2.5">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">Último</span>
                        </div>
                        <p className="text-xs font-medium">
                          {timeline.data.metrics.lastContact
                            ? formatDistanceToNow(new Date(timeline.data.metrics.lastContact), { addSuffix: true, locale: ptBR })
                            : "—"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted p-2.5">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">Top fonte</span>
                        </div>
                        <p className="text-xs font-medium">
                          {timeline.data.metrics.topSource
                            ? SOURCE_LABELS[timeline.data.metrics.topSource] || timeline.data.metrics.topSource
                            : "—"}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Source Filters */}
                  <div className="flex gap-1 mb-3 flex-wrap">
                    {SOURCE_FILTER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => timeline.updateFilters({ source: opt.value })}
                        className={cn(
                          "text-xs px-2.5 py-1 rounded-full border transition-colors",
                          timeline.filters.source === opt.value
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:bg-muted"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Period + Search */}
                  <div className="flex gap-2 mb-4">
                    <div className="flex gap-1">
                      {PERIOD_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => timeline.updateFilters({ period: opt.value })}
                          className={cn(
                            "text-[10px] px-2 py-0.5 rounded border transition-colors",
                            timeline.filters.period === opt.value
                              ? "bg-muted-foreground/10 text-foreground border-muted-foreground/30"
                              : "text-muted-foreground border-transparent hover:bg-muted"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Buscar..."
                        value={timeline.filters.search}
                        onChange={(e) => timeline.updateFilters({ search: e.target.value })}
                        className="h-7 pl-7 text-xs"
                      />
                    </div>
                  </div>

                  {/* Events */}
                  {timeline.isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : timeline.data && timeline.data.events.length > 0 ? (
                    <div className="space-y-0">
                      {timeline.data.events.map((event, index) => (
                        <TimelineItem
                          key={event.id}
                          event={event}
                          isLast={index === timeline.data!.events.length - 1 && !timeline.data!.hasMore}
                        />
                      ))}
                      {timeline.data.hasMore && (
                        <button
                          onClick={timeline.loadMore}
                          className="w-full text-center text-sm text-primary hover:underline py-2"
                        >
                          Carregar mais ({timeline.data.totalFiltered - timeline.data.events.length} restantes)
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <History className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        {timeline.filters.source !== "all" || timeline.filters.search
                          ? "Nenhum evento neste filtro."
                          : "Nenhum histórico registrado."}
                      </p>
                    </div>
                  )}

                  {/* Field-level changelog */}
                  {leadId && (
                    <div className="mt-6 pt-4 border-t border-border">
                      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3 flex items-center gap-1.5">
                        <Edit2 className="w-3.5 h-3.5" />
                        Alteracoes de campos
                      </h3>
                      <FieldChangelogTimeline leadId={leadId} limit={20} />
                    </div>
                  )}
                </TabsContent>

                {/* ─── Tab 3: Contexto do funil ────────── */}
                <TabsContent value="contexto" className="p-6 pt-4 m-0">
                  {renderFunnelContext ? (
                    renderFunnelContext({ lead, pipeData, onSuccess })
                  ) : (
                    <div className="text-center py-12">
                      <History className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        Nenhuma ação específica para este funil.
                      </p>
                    </div>
                  )}
                </TabsContent>

                {/* ─── Tab 4: Chat ────────────────────── */}
                <TabsContent value="ai" className="m-0 flex-1 flex flex-col min-h-0 h-[500px]">
                  <ConversationHistoryTab leadId={lead.id} leadName={lead.name} leadPhone={lead.phone} />
                </TabsContent>

                {/* ─── Tab 5: Pipeline ────────────────── */}
                <TabsContent value="pipeline" className="p-6 pt-4 space-y-6 m-0">
                  {/* Stats */}
                  <div className="grid grid-cols-4 gap-3">
                    <StatCard label="WhatsApp" value={pipelineData?.whatsapp?.length || 0} icon={MessageSquare} />
                    <StatCard label="Reuniões" value={pipelineData?.confirmacao?.length || 0} icon={Calendar} />
                    <StatCard label="Propostas" value={pipelineData?.propostas?.length || 0} icon={DollarSign} />
                    <StatCard
                      label="Vendas"
                      value={pipelineData?.propostas?.filter((p: any) => p.status === "vendido").length || 0}
                      icon={CheckCircle}
                      variant="success"
                    />
                  </div>

                  {/* Pipeline Progress */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold">Jornada do Lead</h3>

                    {/* WhatsApp */}
                    {pipelineData?.whatsapp?.map((item: any) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3 p-3 bg-muted rounded-lg"
                      >
                        <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                          <MessageSquare className="w-5 h-5 text-success" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">Qualificação</p>
                          <p className="text-xs text-muted-foreground">Status: {item.status}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      </motion.div>
                    ))}

                    {/* Confirmacao */}
                    {pipelineData?.confirmacao?.map((item: any) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3 p-3 bg-muted rounded-lg"
                      >
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Calendar className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">Confirmação de Reunião</p>
                          <p className="text-xs text-muted-foreground">
                            Status: {item.status}
                            {item.meeting_date && ` • ${format(new Date(item.meeting_date), "dd/MM HH:mm")}`}
                          </p>
                        </div>
                        <Badge variant={item.status === "compareceu" ? "default" : "outline"}>
                          {item.status}
                        </Badge>
                      </motion.div>
                    ))}

                    {/* Propostas */}
                    {pipelineData?.propostas?.map((item: any) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg",
                          item.status === "vendido" ? "bg-success/10" : "bg-muted"
                        )}
                      >
                        <div
                          className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center",
                            item.status === "vendido" ? "bg-success/20" : "bg-chart-5/10"
                          )}
                        >
                          <DollarSign
                            className={cn(
                              "w-5 h-5",
                              item.status === "vendido" ? "text-success" : "text-chart-5"
                            )}
                          />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">Proposta</p>
                          <p className="text-xs text-muted-foreground">
                            {item.product_type?.toUpperCase()} • {fmtCurrency(item.sale_value)}
                          </p>
                        </div>
                        <Badge
                          variant={item.status === "vendido" ? "default" : "outline"}
                          className={item.status === "vendido" ? "bg-success text-success-foreground" : ""}
                        >
                          {item.status}
                        </Badge>
                      </motion.div>
                    ))}

                    {/* Custom Pipeline Entries */}
                    {pipelineData?.customEntries?.map((item: any) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3 p-3 bg-muted rounded-lg"
                      >
                        <div className="w-10 h-10 rounded-full bg-chart-4/10 flex items-center justify-center">
                          <Target className="w-5 h-5 text-chart-4" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">{item.pipeline?.name || "Pipeline Customizado"}</p>
                          <p className="text-xs text-muted-foreground">
                            Etapa: {item.stage?.name || "—"}
                          </p>
                        </div>
                        {item.stage?.color && (
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.stage.color }} />
                        )}
                      </motion.div>
                    ))}

                    {/* Follow-ups */}
                    {pipelineData?.followUps?.map((item: any) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3 p-3 bg-muted rounded-lg"
                      >
                        <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                          <Clock className="w-5 h-5 text-orange-500" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">{item.title || "Follow-up"}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.due_date ? format(new Date(item.due_date), "dd/MM HH:mm") : "Sem data"}
                            {item.priority && ` • ${item.priority}`}
                          </p>
                        </div>
                        <Badge variant={item.status === "completed" ? "default" : "outline"}>
                          {item.status === "completed" ? "Concluído" : item.status === "archived" ? "Arquivado" : "Pendente"}
                        </Badge>
                      </motion.div>
                    ))}

                    {!pipelineData?.whatsapp?.length && !pipelineData?.confirmacao?.length && !pipelineData?.propostas?.length && !pipelineData?.customEntries?.length && !pipelineData?.followUps?.length && (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        Este lead ainda não entrou em nenhum pipeline.
                      </p>
                    )}
                  </div>
                </TabsContent>
              </div>
            </Tabs>

            {/* ─── Footer ─────────────────────────────── */}
            <div className="p-4 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
              <p className="text-xs text-muted-foreground">
                {createdAgo && `Criado ${createdAgo}`}
                {createdAgo && lastActivity && " · "}
                {lastActivity && `Última atividade ${lastActivity}`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDeleteLead}
                  disabled={deleteLead.isPending}
                >
                  {deleteLead.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                  Excluir lead
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving || !isDirty}
                >
                  {isSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  Salvar
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-6 text-center">
            <p className="text-muted-foreground">Lead não encontrado.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>

    {leadId && lead?.phone && (
      <ScheduleMessageModal
        open={scheduleModalOpen}
        onOpenChange={setScheduleModalOpen}
        leadId={leadId}
        leadName={lead?.name || ""}
        phoneNumber={lead?.phone || ""}
      />
    )}

    <LogCallModal
      open={callModalOpen}
      onOpenChange={setCallModalOpen}
      leadId={leadId ?? undefined}
      leadName={lead?.name}
      phoneNumber={lead?.phone ?? undefined}
    />

    {lead?.phone && (
      <SmsSendDialog
        open={smsDialogOpen}
        onOpenChange={setSmsDialogOpen}
        leadId={leadId ?? undefined}
        leadName={lead?.name}
        phoneNumber={lead.phone}
      />
    )}

    <AiEmailWriter
      open={emailWriterOpen}
      onOpenChange={setEmailWriterOpen}
      leadId={leadId ?? undefined}
      leadName={lead?.name}
    />
    </>
  );
});

// ─── StatCard helper ────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  variant = "default",
}: {
  label: string;
  value: string | number;
  icon: any;
  variant?: "default" | "success" | "warning" | "destructive";
}) {
  const variantClasses = {
    default: "bg-muted",
    success: "bg-success/10",
    warning: "bg-warning/10",
    destructive: "bg-destructive/10",
  };

  const iconClasses = {
    default: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };

  return (
    <div className={cn("rounded-lg p-3", variantClasses[variant])}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("w-4 h-4", iconClasses[variant])} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
