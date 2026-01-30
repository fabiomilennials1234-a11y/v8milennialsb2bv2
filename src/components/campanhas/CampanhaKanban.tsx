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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CampanhaStage, CampanhaLead, useUpdateCampanhaLead, useDeleteCampanhaLead } from "@/hooks/useCampanhas";
import { useDeleteLead } from "@/hooks/useLeads";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { Phone, Mail, Building2, GripVertical, User, DollarSign, Star, Tag, Trash2, Edit2, Filter, MessageSquare, Save, X } from "lucide-react";
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
  onMoveToConfirmacao: (lead: CampanhaLead) => void;
}

interface KanbanCardProps {
  lead: CampanhaLead;
  isReuniao: boolean;
  onMoveToConfirmacao: (lead: CampanhaLead) => void;
  onCardClick: (leadId: string) => void;
  onEdit: (leadId: string) => void;
  onDelete: (lead: CampanhaLead) => void;
  onUpdateNotes: (leadId: string, notes: string) => Promise<void>;
}

const originLabels: Record<string, string> = {
  calendly: "Calendly",
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  cal: "Cal.com",
  outro: "Outro",
  remarketing: "Remarketing",
  base_clientes: "Base Clientes",
  parceiro: "Parceiro",
  indicacao: "Indicação",
  quiz: "Quiz",
  site: "Site",
  organico: "Orgânico",
  ambos: "Ambos",
  zydon: "Zydon",
};

const originColors: Record<string, string> = {
  calendly: "bg-chart-1/10 text-chart-1 border-chart-1/20",
  whatsapp: "bg-success/10 text-success border-success/20",
  meta_ads: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  cal: "bg-primary/10 text-primary border-primary/20",
  outro: "bg-muted text-muted-foreground border-border",
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

function KanbanCardItem({ lead, isReuniao, onMoveToConfirmacao, onCardClick, onEdit, onDelete, onUpdateNotes }: KanbanCardProps) {
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
            {leadData?.closer && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <User className="w-3 h-3" />
                <span className="truncate max-w-[70px]">Closer: {leadData.closer.name}</span>
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

          {/* Move to Confirmação button */}
          {isReuniao && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2 text-xs h-7"
              onClick={(e) => {
                e.stopPropagation();
                onMoveToConfirmacao(lead);
              }}
            >
              Enviar para Confirmação
            </Button>
          )}
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
  onCardClick,
  onEdit,
  onDelete,
  onUpdateNotes,
}: {
  stage: CampanhaStage;
  leads: CampanhaLead[];
  isReuniao: boolean;
  onMoveToConfirmacao: (lead: CampanhaLead) => void;
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
  onMoveToConfirmacao,
}: CampanhaKanbanProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [editLeadId, setEditLeadId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CampanhaLead | null>(null);
  const [sdrFilter, setSdrFilter] = useState<string>("all");
  const updateLead = useUpdateCampanhaLead();
  const deleteCampanhaLead = useDeleteCampanhaLead();
  const deleteLead = useDeleteLead();
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

  // Filter leads by SDR
  const filteredLeads = useMemo(() => {
    if (sdrFilter === "all") return leads;
    if (sdrFilter === "none") return leads.filter((l) => !l.sdr_id);
    return leads.filter((l) => l.sdr_id === sdrFilter);
  }, [leads, sdrFilter]);

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

      // Get the target lead's stage to check if it's reunião marcada
      const targetLeadStage = stages.find((s) => s.id === targetLead.stage_id);

      try {
        await updateLead.mutateAsync({
          id: leadId,
          campanha_id: campanhaId,
          stage_id: targetLead.stage_id,
        });
        
        // If moved to a "reunião marcada" stage, automatically trigger move to confirmação
        if (targetLeadStage && isReuniaoMarcadaStage(targetLeadStage.name)) {
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

    try {
      await updateLead.mutateAsync({
        id: leadId,
        campanha_id: campanhaId,
        stage_id: targetStage.id,
      });
      
      // If moved to a "reunião marcada" stage, automatically trigger move to confirmação
      if (isReuniaoMarcadaStage(targetStage.name)) {
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
      <div className="flex items-center gap-3 mb-4 p-3 bg-muted/30 rounded-lg">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filtrar por Vendedor:</span>
        </div>
        <Select value={sdrFilter} onValueChange={setSdrFilter}>
          <SelectTrigger className="w-[200px]">
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
        {sdrFilter !== "all" && (
          <Button variant="ghost" size="sm" onClick={() => setSdrFilter("all")}>
            Limpar filtro
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