import { useState, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  useDroppable,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CampanhaStage, CampanhaLead, useUpdateCampanhaLead, useDeleteCampanhaLead, useExtractLeadToPipe, type CampanhaPipeAutomation } from "@/hooks/useCampanhas";
import { useDeleteLead } from "@/hooks/useLeads";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { Phone, Mail, Building2, GripVertical, User, DollarSign, Star, Tag, Trash2, Edit2, Filter, MessageSquare, Save, X, Search } from "lucide-react";
import { toast } from "sonner";
import { openWhatsApp } from "@/lib/whatsapp";
import { LeadDetailModal } from "@/components/leads/LeadDetailModal";
import { LeadModal } from "@/components/leads/LeadModal";
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

interface CampanhaKanbanProps {
  campanhaId: string;
  stages: CampanhaStage[];
  leads: CampanhaLead[];
  pipeAutomations?: CampanhaPipeAutomation[];
  organizationId?: string;
  campanhaName?: string;
  onMoveToConfirmacao: (lead: CampanhaLead) => void;
  onExtractToPipe?: (lead: CampanhaLead) => void;
}

interface KanbanCardProps {
  lead: CampanhaLead;
  isReuniao: boolean;
  onMoveToConfirmacao: (lead: CampanhaLead) => void;
  onExtractToPipe?: (lead: CampanhaLead) => void;
  onCardClick: (leadId: string) => void;
  onEdit: (leadId: string) => void;
  onDelete: (lead: CampanhaLead) => void;
  onUpdateNotes: (leadId: string, notes: string) => Promise<void>;
}

const originLabels: Record<string, string> = {
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  outro: "Outros",
  site: "Site",
  remarketing: "Remarketing",
  google_ads: "Google Ads",
  cal: "Cal.com",
};

const originColors: Record<string, string> = {
  whatsapp: "bg-success/10 text-success border-success/20",
  meta_ads: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  outro: "bg-muted text-muted-foreground border-border",
  site: "bg-teal-500/10 text-teal-600 border-teal-500/20",
  remarketing: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  google_ads: "bg-red-500/10 text-red-600 border-red-500/20",
  cal: "bg-chart-1/10 text-chart-1 border-chart-1/20",
};

// Format faturamento for display - converts snake_case values to readable format
const formatFaturamento = (value: string): string => {
  if (!value) return "";
  
  // Handle snake_case format from CSV (e.g., "r$100_mil_a_r$250_mil" → "R$100 mil a R$250 mil")
  let formatted = value
    .replace(/_/g, " ")
    .replace(/r\$/gi, "R$")
    .replace(/\s+/g, " ")
    .trim();
  
  // Capitalize properly if starts with R$
  if (formatted.toLowerCase().startsWith("r$")) {
    formatted = "R$" + formatted.substring(2);
  }
  
  // Handle common patterns
  if (formatted.includes("1 milhão") || formatted.includes("+1 milhão")) {
    return "+1 Milhão";
  }
  
  return formatted;
};

function KanbanCardItem({ lead, isReuniao, onMoveToConfirmacao, onExtractToPipe, onCardClick, onEdit, onDelete, onUpdateNotes }: KanbanCardProps) {
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(lead.notes || "");
  const [isSaving, setIsSaving] = useState(false);
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-drag-handle]') || target.closest('textarea')) {
      return;
    }
    if (lead.lead_id) {
      onCardClick(lead.lead_id);
    }
  };

  const handleSaveNotes = async () => {
    setIsSaving(true);
    try {
      await onUpdateNotes(lead.id, notesValue);
      setIsEditingNotes(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelNotes = () => {
    setNotesValue(lead.notes || "");
    setIsEditingNotes(false);
  };

  const leadData = lead.lead;

  return (
    <div ref={setNodeRef} style={style}>
      <Card 
        className="bg-card hover:border-primary/30 transition-colors cursor-pointer group"
        onClick={handleCardClick}
      >
        <CardContent className="p-3 space-y-2">
          {/* Header with drag handle and actions */}
          <div className="flex items-start gap-2">
            <div
              {...attributes}
              {...listeners}
              data-drag-handle
              className="cursor-grab active:cursor-grabbing mt-1"
            >
              <GripVertical className="w-4 h-4 text-muted-foreground" />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-sm truncate">
                  {leadData?.name}
                  {leadData?.company && (
                    <span className="text-muted-foreground font-normal"> / {leadData.company}</span>
                  )}
                </h4>
                {/* Rating stars */}
                {leadData?.rating && leadData.rating > 0 && (
                  <div className="flex items-center gap-0.5">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className={`w-2.5 h-2.5 ${
                          i < Math.ceil((leadData.rating || 0) / 2)
                            ? "fill-chart-5 text-chart-5"
                            : "text-muted-foreground/30"
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  if (lead.lead_id) onEdit(lead.lead_id);
                }}
              >
                <Edit2 className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(lead);
                }}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {/* Contact Info Row */}
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {leadData?.phone && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  openWhatsApp(leadData.phone!);
                }}
              >
                <Phone className="w-3 h-3" />
              </Button>
            )}
            {leadData?.email && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(`mailto:${leadData.email}`);
                }}
              >
                <Mail className="w-3 h-3" />
              </Button>
            )}
            {leadData?.email && (
              <span className="text-muted-foreground truncate max-w-[120px]">{leadData.email}</span>
            )}
          </div>

          {/* Faturamento - Highlighted */}
          {leadData?.faturamento && (
            <div className="bg-gradient-to-r from-chart-5/20 to-chart-5/5 rounded-md px-2 py-1.5 border border-chart-5/30">
              <div className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-chart-5" />
                <span className="text-xs font-semibold text-chart-5">
                  {formatFaturamento(leadData.faturamento)}
                </span>
              </div>
            </div>
          )}

          {/* Badges Row - Segment, Origin */}
          <div className="flex flex-wrap gap-1">
            {leadData?.segment && (
              <Badge variant="secondary" className="text-xs">
                {leadData.segment}
              </Badge>
            )}
            {leadData?.origin && (
              <Badge variant="outline" className={`text-xs ${originColors[leadData.origin] || originColors.outro}`}>
                {originLabels[leadData.origin] || leadData.origin}
              </Badge>
            )}
          </div>

          {/* Tags */}
          {leadData?.lead_tags && leadData.lead_tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {leadData.lead_tags.slice(0, 3).map((lt) => (
                <Badge
                  key={lt.tag?.id}
                  variant="outline"
                  className="text-xs"
                  style={{ 
                    borderColor: lt.tag?.color || undefined, 
                    backgroundColor: lt.tag?.color ? `${lt.tag.color}20` : undefined 
                  }}
                >
                  <Tag className="w-2.5 h-2.5 mr-0.5" />
                  {lt.tag?.name}
                </Badge>
              ))}
              {leadData.lead_tags.length > 3 && (
                <Badge variant="secondary" className="text-xs">
                  +{leadData.lead_tags.length - 3}
                </Badge>
              )}
            </div>
          )}

          {/* Team Assignment */}
          <div className="flex items-center gap-3 pt-1 border-t border-border text-xs">
            {lead.sdr && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <User className="w-3 h-3" />
                <span className="truncate max-w-[70px]">SDR: {lead.sdr.name}</span>
              </div>
            )}
            {lead.closer && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <User className="w-3 h-3" />
                <span className="truncate max-w-[70px]">Closer: {lead.closer.name}</span>
              </div>
            )}
          </div>

          {/* Campaign-specific Notes (editable) */}
          <div className="space-y-1">
            {isEditingNotes ? (
              <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                <Textarea
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  placeholder="Adicionar observações sobre este lead..."
                  className="text-xs min-h-[60px] resize-none"
                  autoFocus
                />
                <div className="flex gap-1 justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleCancelNotes}
                    disabled={isSaving}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-success hover:text-success"
                    onClick={handleSaveNotes}
                    disabled={isSaving}
                  >
                    <Save className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <div 
                className="flex items-start gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded p-1.5 cursor-pointer hover:bg-muted transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditingNotes(true);
                }}
              >
                <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                <span className={`line-clamp-2 ${!lead.notes ? "italic" : ""}`}>
                  {lead.notes || "Clique para adicionar observações..."}
                </span>
              </div>
            )}
          </div>

          {/* Lead notes from the lead table (read-only) */}
          {leadData?.notes && (
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground dark:text-muted-foreground/90 rounded p-1.5 border border-dashed border-border">
              <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
              <span className="line-clamp-2">{leadData.notes}</span>
            </div>
          )}

          {/* Actions: Enviar para pipe (qualquer etapa) e Enviar para Confirmação (só reunião) */}
          <div className="flex flex-col gap-1.5 mt-2">
            {onExtractToPipe && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs h-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onExtractToPipe(lead);
                }}
              >
                Enviar para pipe
              </Button>
            )}
            {isReuniao && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs h-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveToConfirmacao(lead);
                }}
              >
                Enviar para Confirmação
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KanbanColumn({
  stage,
  leads,
  isReuniao,
  onMoveToConfirmacao,
  onExtractToPipe,
  onCardClick,
  onEdit,
  onDelete,
  onUpdateNotes,
}: {
  stage: CampanhaStage;
  leads: CampanhaLead[];
  isReuniao: boolean;
  onMoveToConfirmacao: (lead: CampanhaLead) => void;
  onExtractToPipe?: (lead: CampanhaLead) => void;
  onCardClick: (leadId: string) => void;
  onEdit: (leadId: string) => void;
  onDelete: (lead: CampanhaLead) => void;
  onUpdateNotes: (leadId: string, notes: string) => Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
  });

  return (
    <div 
      ref={setNodeRef}
      className={`flex flex-col min-w-[300px] max-w-[300px] bg-muted/30 dark:bg-muted/50 rounded-lg transition-all duration-200 border border-border ${
        isOver ? "ring-2 ring-primary/50 bg-primary/5 dark:bg-primary/10" : ""
      }`}
    >
      <div
        className="p-3 border-b flex items-center justify-between bg-card/50 dark:bg-card/30"
        style={{ borderBottomColor: stage.color || "#3B82F6" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: stage.color || "#3B82F6" }}
          />
          <h3 className="font-semibold text-sm text-foreground">{stage.name}</h3>
        </div>
        <Badge variant="secondary" className="text-xs">
          {leads.length}
        </Badge>
      </div>

      <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[calc(100vh-400px)]">
        <SortableContext
          items={leads.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {leads.map((lead) => (
            <KanbanCardItem
              key={lead.id}
              lead={lead}
              isReuniao={isReuniao}
              onMoveToConfirmacao={onMoveToConfirmacao}
              onExtractToPipe={onExtractToPipe}
              onCardClick={onCardClick}
              onEdit={onEdit}
              onDelete={onDelete}
              onUpdateNotes={onUpdateNotes}
            />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Nenhum lead
          </div>
        )}
      </div>
    </div>
  );
}

export function CampanhaKanban({
  campanhaId,
  stages,
  leads,
  pipeAutomations = [],
  organizationId,
  campanhaName = "",
  onMoveToConfirmacao,
  onExtractToPipe,
}: CampanhaKanbanProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [editLeadId, setEditLeadId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CampanhaLead | null>(null);
  const [sdrFilter, setSdrFilter] = useState<string>("all");
  const [closerFilter, setCloserFilter] = useState<string>("all");
  const [nameFilter, setNameFilter] = useState("");
  const updateLead = useUpdateCampanhaLead();
  const deleteCampanhaLead = useDeleteCampanhaLead();
  const deleteLead = useDeleteLead();
  const extractToPipe = useExtractLeadToPipe();
  const { data: teamMembers = [] } = useTeamMembers();

  // Get unique SDRs from campaign leads
  const sdrs = useMemo(() => {
    const sdrMap = new Map<string, { id: string; name: string }>();
    leads.forEach((l) => {
      if (l.sdr) {
        sdrMap.set(l.sdr.id, l.sdr);
      }
    });
    return Array.from(sdrMap.values());
  }, [leads]);

  // Get unique Closers from campaign leads
  const closers = useMemo(() => {
    const closerMap = new Map<string, { id: string; name: string }>();
    leads.forEach((l) => {
      if (l.closer) {
        closerMap.set(l.closer.id, l.closer);
      }
    });
    return Array.from(closerMap.values());
  }, [leads]);

  // Normaliza texto para busca (sem acentos, minúsculo)
  const normalizeForSearch = (s: string) =>
    (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Filter leads by SDR and by name
  // Also filter out "ghost leads" where RLS blocks the lead data (lead relation is null)
  const filteredLeads = useMemo(() => {
    let list = leads.filter((l) => l.lead != null);
    if (sdrFilter !== "all") {
      if (sdrFilter === "none") list = list.filter((l) => !l.sdr_id);
      else list = list.filter((l) => l.sdr_id === sdrFilter);
    }
    if (closerFilter !== "all") {
      if (closerFilter === "none") list = list.filter((l) => !l.closer_id);
      else list = list.filter((l) => l.closer_id === closerFilter);
    }
    const search = nameFilter.trim();
    if (search) {
      const norm = normalizeForSearch(search);
      list = list.filter((l) => {
        const name = normalizeForSearch(l.lead?.name ?? "");
        const company = normalizeForSearch(l.lead?.company ?? "");
        return name.includes(norm) || company.includes(norm);
      });
    }
    return list;
  }, [leads, sdrFilter, closerFilter, nameFilter]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  // Helper to check if a stage is a "reunião marcada" stage
  const isReuniaoMarcadaStage = (stageName: string): boolean => {
    const normalized = stageName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return normalized.includes("reuniao") || normalized.includes("meeting") || normalized.includes("marcada");
  };

  // Handle updating notes for a campaign lead
  const handleUpdateNotes = async (leadId: string, notes: string) => {
    try {
      await updateLead.mutateAsync({
        id: leadId,
        campanha_id: campanhaId,
        notes,
      });
      toast.success("Observação salva");
    } catch (error) {
      toast.error("Erro ao salvar observação");
      throw error;
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const leadId = active.id as string;
    const overId = over.id as string;

    const targetStage = stages.find((s) => s.id === overId);
    if (!targetStage) {
      const targetLead = leads.find((l) => l.id === overId);
      if (!targetLead) return;

      const lead = leads.find((l) => l.id === leadId);
      if (!lead || lead.stage_id === targetLead.stage_id) return;

      const targetLeadStage = stages.find((s) => s.id === targetLead.stage_id);
      const automation = pipeAutomations.find((a) => a.campanha_stage_id === targetLead.stage_id);

      try {
        await updateLead.mutateAsync({
          id: leadId,
          campanha_id: campanhaId,
          stage_id: targetLead.stage_id,
        });

        if (automation && organizationId) {
          await extractToPipe.mutateAsync({
            campanha_lead_id: lead.id,
            campanha_id: campanhaId,
            lead_id: lead.lead_id,
            target_pipe: automation.target_pipe,
            stage: automation.pipe_stage,
            organization_id: organizationId,
            sdr_id: lead.sdr_id ?? undefined,
            closer_id: lead.closer_id ?? lead.lead?.closer_id ?? undefined,
            campaign_name: campanhaName,
          });
          toast.success("Lead enviado para o pipe pela automação");
        } else if (automation && !organizationId) {
          toast.warning("Automação configurada mas organização não definida; lead permanece na campanha.");
        } else if (targetLeadStage && isReuniaoMarcadaStage(targetLeadStage.name)) {
          onMoveToConfirmacao(lead);
        } else {
          toast.success("Lead movido com sucesso");
        }
      } catch (error) {
        toast.error("Erro ao mover lead");
      }
      return;
    }

    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage_id === targetStage.id) return;

    const automation = pipeAutomations.find((a) => a.campanha_stage_id === targetStage.id);

    try {
      await updateLead.mutateAsync({
        id: leadId,
        campanha_id: campanhaId,
        stage_id: targetStage.id,
      });

      if (automation && organizationId) {
        await extractToPipe.mutateAsync({
          campanha_lead_id: lead.id,
          campanha_id: campanhaId,
          lead_id: lead.lead_id,
          target_pipe: automation.target_pipe,
          stage: automation.pipe_stage,
          organization_id: organizationId,
          sdr_id: lead.sdr_id ?? undefined,
          closer_id: lead.closer_id ?? lead.lead?.closer_id ?? undefined,
          campaign_name: campanhaName,
        });
        toast.success("Lead enviado para o pipe pela automação");
      } else if (automation && !organizationId) {
        toast.warning("Automação configurada mas organização não definida; lead permanece na campanha.");
      } else if (isReuniaoMarcadaStage(targetStage.name)) {
        onMoveToConfirmacao(lead);
      } else {
        toast.success("Lead movido com sucesso");
      }
    } catch (error) {
      toast.error("Erro ao mover lead");
    }
  };

  const handleDragOver = (event: DragOverEvent) => {};

  const handleCardClick = (leadId: string) => {
    setSelectedLeadId(leadId);
  };

  const handleEdit = (leadId: string) => {
    setEditLeadId(leadId);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    try {
      // First remove from campaign
      await deleteCampanhaLead.mutateAsync({ 
        id: deleteTarget.id, 
        campanha_id: campanhaId 
      });
      
      // Then delete the lead itself
      if (deleteTarget.lead_id) {
        await deleteLead.mutateAsync(deleteTarget.lead_id);
      }
      
      toast.success("Lead excluído com sucesso");
    } catch (error) {
      toast.error("Erro ao excluir lead");
    } finally {
      setDeleteTarget(null);
    }
  };

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null;
  const reuniaoStage = stages.find((s) => s.is_reuniao_marcada);

  return (
    <>
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-muted/30 rounded-lg">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Filtrar por nome do lead"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            className="w-[220px] h-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Vendedor:</span>
        </div>
        <Select value={sdrFilter} onValueChange={setSdrFilter}>
          <SelectTrigger className="w-[200px] h-9">
            <SelectValue placeholder="Todos os vendedores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os vendedores</SelectItem>
            <SelectItem value="none">Sem vendedor atribuído</SelectItem>
            {sdrs.map((sdr) => (
              <SelectItem key={sdr.id} value={sdr.id}>
                {sdr.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {closers.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Closer:</span>
            </div>
            <Select value={closerFilter} onValueChange={setCloserFilter}>
              <SelectTrigger className="w-[200px] h-9">
                <SelectValue placeholder="Todos os closers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os closers</SelectItem>
                <SelectItem value="none">Sem closer atribuído</SelectItem>
                {closers.map((closer) => (
                  <SelectItem key={closer.id} value={closer.id}>
                    {closer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        {(sdrFilter !== "all" || closerFilter !== "all" || nameFilter.trim()) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSdrFilter("all");
              setCloserFilter("all");
              setNameFilter("");
            }}
          >
            Limpar filtros
          </Button>
        )}
        <div className="ml-auto text-sm text-muted-foreground">
          {filteredLeads.length} de {leads.length} leads
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <KanbanColumn
              key={stage.id}
              stage={stage}
              leads={filteredLeads.filter((l) => l.stage_id === stage.id)}
              isReuniao={stage.id === reuniaoStage?.id}
              onMoveToConfirmacao={onMoveToConfirmacao}
              onExtractToPipe={onExtractToPipe}
              onCardClick={handleCardClick}
              onEdit={handleEdit}
              onDelete={setDeleteTarget}
              onUpdateNotes={handleUpdateNotes}
            />
          ))}
        </div>

        <DragOverlay>
          {activeLead && (
            <Card className="bg-card shadow-lg">
              <CardContent className="p-3">
                <h4 className="font-medium text-sm">{activeLead.lead?.name}</h4>
              </CardContent>
            </Card>
          )}
        </DragOverlay>
      </DndContext>

      {/* Lead Detail Modal */}
      <LeadDetailModal
        open={!!selectedLeadId}
        onOpenChange={(open) => !open && setSelectedLeadId(null)}
        leadId={selectedLeadId}
        onEdit={() => {
          if (selectedLeadId) {
            setEditLeadId(selectedLeadId);
            setSelectedLeadId(null);
          }
        }}
      />

      {/* Edit Lead Modal */}
      {editLeadId && (
        <LeadModal
          open={!!editLeadId}
          onOpenChange={(open) => !open && setEditLeadId(null)}
          lead={leads.find((l) => l.lead_id === editLeadId)?.lead}
          onSuccess={() => setEditLeadId(null)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o lead "{deleteTarget?.lead?.name}"? 
              Esta ação irá remover o lead permanentemente de todos os pipes e não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}