import { useState, useMemo, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Plus, Calendar, Loader2, LayoutGrid, List, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DraggableKanbanBoard, DraggableItem, KanbanColumn } from "@/components/kanban/DraggableKanbanBoard";
import { usePipeConfirmacao, useUpdatePipeConfirmacao, PipeConfirmacaoStatus } from "@/hooks/usePipeConfirmacao";
import { usePipelineStages, stagesToColumns } from "@/hooks/usePipelineStages";
import { ManagePipelineStagesModal } from "@/components/pipelines/ManagePipelineStagesModal";
import { useCreatePipeProposta } from "@/hooks/usePipePropostas";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { LeadModal } from "@/components/leads/LeadModal";
import { AddMeetingModal } from "@/components/confirmacao/AddMeetingModal";
import { ConfirmacaoDetailModal } from "@/components/confirmacao/ConfirmacaoDetailModal";
import { ConfirmacaoStats } from "@/components/confirmacao/ConfirmacaoStats";
import { ConfirmacaoCard } from "@/components/confirmacao/ConfirmacaoCard";
import { ConfirmacaoFilters, OriginFilter, TimeFilter, UrgencyFilter } from "@/components/confirmacao/ConfirmacaoFilters";
import { MeetingTimeline } from "@/components/confirmacao/MeetingTimeline";
import { CompareceuModal } from "@/components/confirmacao/CompareceuModal";
import { format, isToday, startOfWeek, endOfWeek, isWithinInterval, isTomorrow, isPast, startOfDay, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface ConfirmacaoCardData extends DraggableItem {
  name: string;
  company: string;
  email?: string;
  phone?: string;
  meetingDate?: string;
  meetingDateTime?: Date;
  rating: number;
  origin: "calendly" | "whatsapp" | "meta_ads" | "outro";
  sdr?: string;
  closer?: string;
  sdrId?: string | null;
  closerId?: string | null;
  tags: string[];
  leadId: string;
  faturamento?: number;
  segment?: string;
  urgency?: string;
  status?: string;
  confirmacaoId?: string;
  isConfirmed?: boolean;
}

// Calculate correct status based on meeting date using CALENDAR DAYS (not hours)
// Note: pre_confirmada and confirmada_no_dia are NOT used as statuses anymore
// They are visual states controlled by is_confirmed field
function calculateStatusByDate(meetingDate: Date | null, currentStatus: PipeConfirmacaoStatus): PipeConfirmacaoStatus | null {
  if (!meetingDate) return null;
  
  // Don't auto-update terminal statuses
  if (["compareceu", "perdido", "remarcar"].includes(currentStatus)) {
    // Check if remarcar should be updated (meeting date was changed to future)
    if (currentStatus === "remarcar") {
      if (!isPast(startOfDay(meetingDate)) || isToday(meetingDate)) {
        // Meeting is no longer overdue, recalculate
      } else {
        return null; // Still overdue
      }
    } else {
      return null;
    }
  }
  
  const today = startOfDay(new Date());
  const meetingDay = startOfDay(meetingDate);
  
  // Use differenceInCalendarDays to count actual calendar days, not 24h periods
  const calendarDays = differenceInCalendarDays(meetingDay, today);
  
  // If meeting day is in the past (negative days), it's overdue - should remarcar
  if (calendarDays < 0) {
    return "remarcar";
  }
  
  // If meeting is today (0 days)
  if (calendarDays === 0) {
    return "confirmacao_no_dia";
  }
  
  // If meeting is tomorrow (1 day) - D-1
  if (calendarDays === 1) {
    return "confirmar_d1";
  }
  
  // If meeting is in 2 days - D-2
  if (calendarDays === 2) {
    return "confirmar_d2";
  }
  
  // If meeting is in 3 days - D-3
  if (calendarDays === 3) {
    return "confirmar_d3";
  }
  
  // If meeting is in 4-5 days - D-5
  if (calendarDays === 4 || calendarDays === 5) {
    return "confirmar_d5";
  }
  
  // If meeting is more than 5 days away
  if (calendarDays > 5) {
    return "reuniao_marcada";
  }
  
  return null;
}

export default function PipeConfirmacao() {
  const [searchQuery, setSearchQuery] = useState("");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("all");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedSdrId, setSelectedSdrId] = useState<string>("all");
  const [selectedCloserId, setSelectedCloserId] = useState<string>("all");
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [isMeetingModalOpen, setIsMeetingModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isStagesModalOpen, setIsStagesModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<any>(null);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [viewMode, setViewMode] = useState<"kanban" | "timeline">("kanban");
  
  // Compareceu modal state
  const [isCompareceuModalOpen, setIsCompareceuModalOpen] = useState(false);
  const [pendingCompareceuItem, setPendingCompareceuItem] = useState<any>(null);
  const [isProcessingCompareceu, setIsProcessingCompareceu] = useState(false);
  
  const { data: pipeData, isLoading, refetch } = usePipeConfirmacao();
  const { data: pipelineStages = [] } = usePipelineStages("confirmacao");
  const { data: teamMembers = [] } = useTeamMembers();
  const updatePipeConfirmacao = useUpdatePipeConfirmacao();
  const createPipeProposta = useCreatePipeProposta();

  // Transform team members for filter
  const teamMemberOptions = useMemo(() => 
    teamMembers.map(m => ({
      id: m.id,
      name: m.name,
      role: m.role as "sdr" | "closer" | "admin"
    })), 
    [teamMembers]
  );

  // Auto-update statuses based on meeting dates
  const autoUpdateStatuses = useCallback(async () => {
    if (!pipeData) return;
    
    const terminalStatuses: PipeConfirmacaoStatus[] = ["compareceu", "perdido"];
    
    for (const item of pipeData) {
      // Skip terminal statuses
      if (terminalStatuses.includes(item.status as PipeConfirmacaoStatus)) continue;
      
      // Skip remarcar status unless it's no longer overdue (meeting date changed)
      if (item.status === "remarcar") {
        const meetingDate = item.meeting_date ? new Date(item.meeting_date) : null;
        if (meetingDate && (isPast(meetingDate) && !isToday(meetingDate))) {
          continue; // Still overdue, keep in remarcar
        }
      }
      
      const meetingDate = item.meeting_date ? new Date(item.meeting_date) : null;
      const calculatedStatus = calculateStatusByDate(meetingDate, item.status as PipeConfirmacaoStatus);
      
      if (calculatedStatus && calculatedStatus !== item.status) {
        try {
          await updatePipeConfirmacao.mutateAsync({
            id: item.id,
            status: calculatedStatus,
            leadId: item.lead_id,
            assignedTo: item.sdr_id || item.closer_id,
          });
        } catch (error) {
          console.error("Error auto-updating status:", error);
        }
      }
    }
  }, [pipeData, updatePipeConfirmacao]);

  // Run auto-update on mount and when data changes
  useEffect(() => {
    autoUpdateStatuses();
  }, [pipeData?.length]); // Only run when data length changes to avoid infinite loops

  const transformToCard = (item: any): ConfirmacaoCardData => {
    const lead = item.lead;
    return {
      id: item.id,
      name: lead?.name || "Sem nome",
      company: lead?.company || "Sem empresa",
      email: lead?.email,
      phone: lead?.phone,
      meetingDate: item.meeting_date 
        ? format(new Date(item.meeting_date), "dd MMM, HH:mm", { locale: ptBR })
        : undefined,
      meetingDateTime: item.meeting_date ? new Date(item.meeting_date) : undefined,
      rating: lead?.rating || 0,
      origin: lead?.origin || "outro",
      sdr: item.sdr?.name || lead?.sdr?.name,
      closer: item.closer?.name || lead?.closer?.name,
      sdrId: item.sdr_id,
      closerId: item.closer_id,
      tags: lead?.lead_tags?.map((lt: any) => lt.tag?.name).filter(Boolean) || [],
      leadId: item.lead_id,
      faturamento: lead?.faturamento,
      segment: lead?.segment,
      urgency: lead?.urgency,
      status: item.status,
      confirmacaoId: item.id,
      isConfirmed: item.is_confirmed || false,
    };
  };

  // Converte etapas do banco para o formato do Kanban (com fallback)
  const statusColumns = useMemo(() => {
    if (pipelineStages.length === 0) {
      // Fallback para etapas padrão enquanto carrega
      return [
        { id: "reuniao_marcada", title: "Reunião Marcada", color: "#6366f1" },
        { id: "confirmar_d5", title: "Confirmar D-5", color: "#8b5cf6" },
        { id: "confirmar_d3", title: "Confirmar D-3", color: "#a855f7" },
        { id: "confirmar_d2", title: "Confirmar D-2", color: "#f59e0b" },
        { id: "confirmar_d1", title: "Confirmar D-1", color: "#f97316" },
        { id: "confirmacao_no_dia", title: "Confirmação no Dia", color: "#ef4444" },
        { id: "remarcar", title: "Remarcar 📅", color: "#f97316" },
        { id: "compareceu", title: "Compareceu ✓", color: "#22c55e" },
        { id: "perdido", title: "Perdido ✗", color: "#ef4444" },
      ];
    }
    return stagesToColumns(pipelineStages);
  }, [pipelineStages]);

  const columns = useMemo((): KanbanColumn<ConfirmacaoCardData>[] => {
    if (!pipeData) return statusColumns.map(col => ({ ...col, items: [] }));

    const now = new Date();
    const weekStart = startOfWeek(now, { locale: ptBR });
    const weekEnd = endOfWeek(now, { locale: ptBR });

    return statusColumns.map(col => {
      const columnItems = pipeData
        .filter(item => item.status === col.id)
        .filter(item => {
          const lead = item.lead;
          const matchesSearch = searchQuery === "" || 
            lead?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            lead?.company?.toLowerCase().includes(searchQuery.toLowerCase());
          
          let matchesOrigin = originFilter === "all" || lead?.origin === originFilter;
          
          let matchesUrgency = urgencyFilter === "all" || lead?.urgency === urgencyFilter;
          
          let matchesTime = true;
          if (timeFilter === "today" && item.meeting_date) {
            matchesTime = isToday(new Date(item.meeting_date));
          } else if (timeFilter === "tomorrow" && item.meeting_date) {
            matchesTime = isTomorrow(new Date(item.meeting_date));
          } else if (timeFilter === "week" && item.meeting_date) {
            matchesTime = isWithinInterval(new Date(item.meeting_date), { start: weekStart, end: weekEnd });
          } else if (timeFilter === "overdue" && item.meeting_date) {
            matchesTime = isPast(new Date(item.meeting_date)) && !isToday(new Date(item.meeting_date));
          }

          const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(item.status);
          
          // SDR/Closer filters
          const matchesSdr = selectedSdrId === "all" || item.sdr_id === selectedSdrId;
          const matchesCloser = selectedCloserId === "all" || item.closer_id === selectedCloserId;
          
          return matchesSearch && matchesOrigin && matchesUrgency && matchesTime && matchesStatus && matchesSdr && matchesCloser;
        })
        // Sort by meeting date - closest meetings first
        .sort((a, b) => {
          const dateA = a.meeting_date ? new Date(a.meeting_date).getTime() : Infinity;
          const dateB = b.meeting_date ? new Date(b.meeting_date).getTime() : Infinity;
          return dateA - dateB;
        })
        .map(transformToCard);

      return { ...col, items: columnItems };
    });
  }, [pipeData, searchQuery, originFilter, urgencyFilter, timeFilter, selectedStatuses, selectedSdrId, selectedCloserId]);

  const handleStatusChange = async (itemId: string, newStatus: string) => {
    const item = pipeData?.find(p => p.id === itemId);
    if (!item) return;

    // If moving to compareceu, open modal to select SDR/Closer
    if (newStatus === "compareceu") {
      setPendingCompareceuItem(item);
      setIsCompareceuModalOpen(true);
      return;
    }

    try {
      await updatePipeConfirmacao.mutateAsync({ 
        id: itemId, 
        status: newStatus as PipeConfirmacaoStatus,
        leadId: item.lead_id,
        assignedTo: item.sdr_id || item.closer_id,
      });
      toast.success("Status atualizado!");
    } catch (error) {
      toast.error("Erro ao atualizar status");
    }
  };

  const handleCompareceuConfirm = async (sdrId: string | null, closerId: string | null) => {
    if (!pendingCompareceuItem) return;
    
    setIsProcessingCompareceu(true);
    try {
      // Update confirmacao with SDR and Closer
      await updatePipeConfirmacao.mutateAsync({ 
        id: pendingCompareceuItem.id, 
        status: "compareceu" as PipeConfirmacaoStatus,
        sdr_id: sdrId,
        closer_id: closerId,
        leadId: pendingCompareceuItem.lead_id,
        assignedTo: sdrId || closerId,
      });

      // Create proposta with selected closer
      await createPipeProposta.mutateAsync({
        lead_id: pendingCompareceuItem.lead_id,
        closer_id: closerId,
        status: "marcar_compromisso",
      });

      toast.success("Lead movido para Gestão de Propostas!");
      setIsCompareceuModalOpen(false);
      setPendingCompareceuItem(null);
    } catch (error) {
      toast.error("Erro ao processar comparecimento");
    } finally {
      setIsProcessingCompareceu(false);
    }
  };

  const handleCardClick = (card: ConfirmacaoCardData) => {
    const item = pipeData?.find(p => p.id === card.id);
    if (item) {
      setSelectedItem(item);
      setIsDetailModalOpen(true);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold flex items-center gap-2"
          >
            <Calendar className="w-6 h-6 text-primary" />
            Confirmação de Reunião
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Arraste os cards para alterar o status • Compareceu → move para Propostas
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center border rounded-lg p-1">
            <Button 
              variant={viewMode === "kanban" ? "secondary" : "ghost"} 
              size="sm"
              onClick={() => setViewMode("kanban")}
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
            <Button 
              variant={viewMode === "timeline" ? "secondary" : "ghost"} 
              size="sm"
              onClick={() => setViewMode("timeline")}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={() => setIsStagesModalOpen(true)}>
            <Settings2 className="w-4 h-4 mr-2" />
            Etapas
          </Button>
          <Button size="sm" className="gradient-gold" onClick={() => setIsMeetingModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nova Reunião
          </Button>
        </div>
      </div>

      {/* Stats */}
      <ConfirmacaoStats data={pipeData || []} />

      {/* Filters */}
      <ConfirmacaoFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        originFilter={originFilter}
        onOriginFilterChange={setOriginFilter}
        timeFilter={timeFilter}
        onTimeFilterChange={setTimeFilter}
        urgencyFilter={urgencyFilter}
        onUrgencyFilterChange={setUrgencyFilter}
        selectedStatuses={selectedStatuses}
        onStatusesChange={setSelectedStatuses}
        statusOptions={statusColumns}
        teamMembers={teamMemberOptions}
        selectedSdrId={selectedSdrId}
        onSdrFilterChange={setSelectedSdrId}
        selectedCloserId={selectedCloserId}
        onCloserFilterChange={setSelectedCloserId}
      />

      {/* Content */}
      {viewMode === "kanban" ? (
        <DraggableKanbanBoard
          columns={columns}
          onStatusChange={handleStatusChange}
          renderCard={(card) => (
            <ConfirmacaoCard 
              card={card} 
              onClick={() => handleCardClick(card)}
            />
          )}
        />
      ) : (
        <MeetingTimeline 
          meetings={pipeData || []} 
          onMeetingClick={(meeting) => {
            setSelectedItem(meeting);
            setIsDetailModalOpen(true);
          }}
        />
      )}

      {/* Modals */}
      <LeadModal
        open={isLeadModalOpen}
        onOpenChange={setIsLeadModalOpen}
        lead={editingLead}
        onSuccess={() => {
          refetch();
          setEditingLead(null);
        }}
      />

      <AddMeetingModal
        open={isMeetingModalOpen}
        onOpenChange={setIsMeetingModalOpen}
        onSuccess={refetch}
      />

      <ConfirmacaoDetailModal
        open={isDetailModalOpen}
        onOpenChange={setIsDetailModalOpen}
        item={selectedItem}
        onSuccess={refetch}
      />

      <CompareceuModal
        open={isCompareceuModalOpen}
        onOpenChange={setIsCompareceuModalOpen}
        onConfirm={handleCompareceuConfirm}
        leadName={pendingCompareceuItem?.lead?.name || "Lead"}
        currentSdrId={pendingCompareceuItem?.sdr_id}
        currentCloserId={pendingCompareceuItem?.closer_id}
        isLoading={isProcessingCompareceu}
      />

      <ManagePipelineStagesModal
        open={isStagesModalOpen}
        onOpenChange={setIsStagesModalOpen}
        pipelineType="confirmacao"
        stages={pipelineStages}
      />
    </div>
  );
}
