import { useState, useMemo, useCallback, useEffect } from "react";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { useViewport } from "@/shared/hooks/use-viewport";
import { motion } from "framer-motion";
import {
  Fuel,
  Search,
  Filter,
  Star,
  Phone,
  Mail,
  Building,
  Calendar,
  Tag,
  MoreHorizontal,
  Plus,
  X,
  Edit2,
  Eye,
  ChevronDown,
  FileDown,
  History,
  CircleDashed,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeads, useLeadsCount, useCreateLead, useUpdateLead, useDeleteLead, LEADS_PAGE_SIZE, type Lead } from "../hooks/useLeads";
import { ExportLeadsModal } from "../components/leads/ExportLeadsModal";
import { ImportHistoryPanel } from "../components/leads/ImportHistoryPanel";
import { QUALIFICATION_TIER_CONFIG } from "../components/lead-detail/modal/qualification-config";
import { QUALIFICATION_TIERS } from "../components/lead-detail/modal/types";
import { LeadPanelProvider, useLeadSheet, LeadDetailSheet } from "../components/lead-detail";
import { LeadPanelLayout } from "@/modules/platform/components/layout/LeadPanelLayout";
import { useCanDo } from "@/modules/identity";
import { useFeaturePermission } from "@/modules/identity";
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
import { Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useBulkSelection } from "@/shared/hooks/useBulkSelection";
import { BulkActionBar } from "@/modules/leads/components/bulk-actions/BulkActionBar";
import { SavedViewsDropdown } from "@/modules/platform/components/saved-views/SavedViewsDropdown";
import { useSearchParams } from "react-router-dom";
import { useTeamMembers, useCurrentTeamMember, useResponsibleMembers } from "@/modules/identity";
import { usePipeOps } from "../pipe-ops";
import { getPipelineTypeName } from "@/contracts/pipe";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/modules/identity";
import { trackModuleVisit } from "@/lib/analytics";
import { checkPhoneBeforeCreate, phoneConflictMessage } from "../lib/phone-conflict";

const originLabels: Record<string, string> = {
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  outro: "Outros",
  site: "Site",
  remarketing: "Remarketing",
  google_ads: "Google Ads",
  cal: "Cal.com",
  indicacao: "Indicação",
};

const originColors: Record<string, string> = {
  whatsapp: "bg-green-500/10 text-green-600 border-green-500/20",
  meta_ads: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  outro: "bg-muted text-muted-foreground border-muted",
  site: "bg-teal-500/10 text-teal-600 border-teal-500/20",
  remarketing: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  google_ads: "bg-red-500/10 text-red-600 border-red-500/20",
  cal: "bg-chart-1/10 text-chart-1 border-chart-1/20",
  indicacao: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

interface LeadFormData {
  name: string;
  company: string;
  email: string;
  phone: string;
  origin: string;
  rating: number;
  segment: string;
  faturamento: string;
  urgency: string;
  notes: string;
  responsible_id: string | null;
  pre_sale_responsible_id: string | null;
  sale_responsible_id: string | null;
  compromisso_date: string;
}

const initialFormData: LeadFormData = {
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
  responsible_id: null,
  pre_sale_responsible_id: null,
  sale_responsible_id: null,
  compromisso_date: "",
};

function StarRating({ rating, onRate, readonly = false }: { rating: number; onRate?: (r: number) => void; readonly?: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onRate?.(star)}
          className={`${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"} transition-transform`}
        >
          <Star
            className={`w-3.5 h-3.5 ${
              star <= rating
                ? "fill-chart-5 text-chart-5"
                : "text-muted-foreground/30"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Persisted filter state — scoped per org + user, TTL 24 h
// ---------------------------------------------------------------------------
type LeadsFilterState = {
  searchQuery: string;
  filterOrigin: string;
  filterRating: string;
  filterQualification: string;
};

const DEFAULT_LEADS_FILTERS: LeadsFilterState = {
  searchQuery: "",
  filterOrigin: "all",
  filterRating: "all",
  filterQualification: "all",
};

/**
 * Normaliza um instante vindo da query string (`?from=`/`?to=`). Devolve
 * `undefined` se ausente ou não-parseável — URL adulterada não pode virar um
 * `gte("created_at", "lixo")` que derruba a listagem inteira.
 */
function parseInstantParam(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/**
 * Formata um instante no fuso da org (`organizations.timezone`), não no do
 * browser. Sem isso a lista rotula um lead de 21:30 BRT com a data do dia
 * seguinte pra quem acessa de outro fuso, e o número da lista deixa de bater
 * com o do card do Comando — que corta o dia no fuso da org (ver `zoned-day.ts`).
 */
function formatDayInTz(value: string | Date, timeZone?: string | null): string {
  const date = typeof value === "string" ? new Date(value) : value;
  try {
    return date.toLocaleDateString("pt-BR", timeZone ? { timeZone } : undefined);
  } catch {
    // IANA que o Intl do runtime rejeita (mesma divergência Postgres/ICU tratada
    // em zoned-day.ts) — degrada pro fuso do browser em vez de quebrar a página.
    return date.toLocaleDateString("pt-BR");
  }
}

function LeadsInner() {
  const { openLead } = useLeadSheet();
  const [filterState, setFilterState] = usePersistedState(
    "leads",
    DEFAULT_LEADS_FILTERS
  );

  const { searchQuery, filterOrigin, filterRating } = filterState;
  const filterQualification = filterState.filterQualification ?? "all";

  const setSearchQuery = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, searchQuery: v })),
    [setFilterState]
  );
  const setFilterOrigin = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, filterOrigin: v })),
    [setFilterState]
  );
  const setFilterRating = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, filterRating: v })),
    [setFilterState]
  );
  const setFilterQualification = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, filterQualification: v })),
    [setFilterState]
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const [activeViewId, setActiveViewId] = useState<string | null>(searchParams.get("view"));
  const handleActiveViewChange = useCallback((viewId: string | null) => {
    setActiveViewId(viewId);
    setSearchParams(viewId ? { view: viewId } : {}, { replace: true });
  }, [setSearchParams]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isImportHistoryOpen, setIsImportHistoryOpen] = useState(false);
  const { allowed: canExport } = useCanDo("export_leads");
  const { allowed: canCreateLead } = useCanDo("create_lead");
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [formData, setFormData] = useState<LeadFormData>(initialFormData);
  const { organizationId, timezone: orgTimezone } = useOrganization();
  useEffect(() => { trackModuleVisit("leads", organizationId); }, []);

  // #313 — deep link via mention notification:
  // /leads?lead=<id>&comment=<id> opens the modal automatically. The
  // `comment` param is consumed inside ActivityFeed (highlight + scroll).
  // Only fires once per lead-id transition to avoid reopening on hot-reload.
  const deepLinkLeadId = searchParams.get("lead");
  useEffect(() => {
    if (deepLinkLeadId) openLead(deepLinkLeadId);
  }, [deepLinkLeadId, openLead]);

  const [page, setPage] = useState(0);
  // Filtro por estado (?uf=) — deep-link vindo da aba Mapa do Comando
  const ufFilter = searchParams.get("uf")?.toUpperCase() || undefined;
  // Janela de criação (?from=&to=) — deep-link do card "Leads" do Comando.
  // Os limites já vêm cortados na fronteira de dia do fuso da org por
  // `computePeriodRange`, então a lista reproduz exatamente a contagem do card.
  const createdFrom = parseInstantParam(searchParams.get("from"));
  const createdTo = parseInstantParam(searchParams.get("to"));
  const hasCreatedRange = !!createdFrom || !!createdTo;
  const clearCreatedRange = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("from");
      next.delete("to");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const filterParams = { page, searchQuery, filterOrigin, filterRating, filterQualification, filterUf: ufFilter, createdFrom, createdTo };
  const { data: leads = [], isLoading } = useLeads(filterParams);
  const { data: totalLeads } = useLeadsCount({ searchQuery, filterOrigin, filterRating, filterQualification, filterUf: ufFilter, createdFrom, createdTo });
  const { data: teamMembers = [] } = useTeamMembers();
  const totalPages = Math.ceil((totalLeads ?? 0) / LEADS_PAGE_SIZE);
  const { data: currentTeamMember, isLoading: isLoadingTeamMember, isFetching: isFetchingTeamMember } = useCurrentTeamMember();
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const { allowed: canDeleteLead } = useFeaturePermission("leads.delete");

  const responsibleMembers = useResponsibleMembers();
  const bulk = useBulkSelection();
  const allLeadIds = useMemo(() => leads.map((l: Lead) => l.id), [leads]);
  const { isMobile } = useViewport();

  // ── Pipe/funnel selection for new leads ──
  const {
    useCustomPipelines,
    useCustomPipelineStages,
    useAddLeadToCustomPipe,
    useAllPipelineStageOptions,
    useCreatePipeWhatsapp,
    useCreatePipeConfirmacao,
    useCreatePipeProposta,
  } = usePipeOps();
  const [selectedPipe, setSelectedPipe] = useState("");
  const [selectedStage, setSelectedStage] = useState("");
  const { data: customPipelines = [] } = useCustomPipelines();
  const customPipelineId = selectedPipe.startsWith("custom:") ? selectedPipe.slice(7) : undefined;
  const { data: customStages = [] } = useCustomPipelineStages(customPipelineId);
  const { stagesByPipe } = useAllPipelineStageOptions();
  const createPipeWhatsapp = useCreatePipeWhatsapp();
  const createPipeConfirmacao = useCreatePipeConfirmacao();
  const createPipeProposta = useCreatePipeProposta();
  const addLeadToCustomPipe = useAddLeadToCustomPipe();

  const pipeOptions = useMemo(() => {
    const standard = [
      { value: "std:whatsapp", label: getPipelineTypeName("whatsapp") },
      { value: "std:confirmacao", label: getPipelineTypeName("confirmacao") },
      { value: "std:propostas", label: getPipelineTypeName("propostas") },
    ];
    const custom = customPipelines.map(p => ({ value: `custom:${p.id}`, label: p.name }));
    return [...standard, ...custom];
  }, [customPipelines]);

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

  useEffect(() => {
    if (selectedPipe && stageOptions.length > 0 && !selectedStage) {
      setSelectedStage(stageOptions[0].value);
    }
  }, [selectedPipe, stageOptions, selectedStage]);

  // Reset para página 0 quando filtros mudam
  useEffect(() => {
    setPage(0);
  }, [searchQuery, filterOrigin, filterRating, filterQualification, createdFrom, createdTo]);

  const stats = useMemo(() => {
    const total = totalLeads ?? leads.length;
    const highRating = leads.filter((l: Lead) => (l.rating || 0) >= 7).length;
    const thisMonth = leads.filter((l: Lead) => {
      const date = new Date(l.created_at);
      const now = new Date();
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).length;
    const withSDR = leads.filter((l: Lead) => l.responsible_id).length;

    return { total, highRating, thisMonth, withSDR };
  }, [leads, totalLeads]);

  const handleOpenDialog = (lead?: any) => {
    if (lead) {
      setEditingLead(lead);
      setFormData({
        name: lead.name || "",
        company: lead.company || "",
        email: lead.email || "",
        phone: lead.phone || "",
        origin: lead.origin || "outro",
        rating: lead.rating || 5,
        segment: lead.segment || "",
        faturamento: lead.faturamento,
        urgency: lead.urgency || "",
        notes: lead.notes || "",
        responsible_id: lead.responsible_id,
        pre_sale_responsible_id: lead.pre_sale_responsible_id,
        sale_responsible_id: lead.sale_responsible_id,
        compromisso_date: lead.compromisso_date ? lead.compromisso_date.slice(0, 16) : "",
      });
    } else {
      setEditingLead(null);
      setFormData(initialFormData);
      setSelectedPipe("");
      setSelectedStage("");
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    // Verificar se ainda está carregando
    if (isLoadingTeamMember || isFetchingTeamMember) {
      toast.info("Carregando informações da organização...");
      return;
    }

    // Verificar se tem organization_id
    if (!currentTeamMember?.organization_id) {
      toast.error(
        "Você precisa estar vinculado a uma organização. Execute o script SQL 'SOLUCAO_DEFINITIVA_RLS.sql' no Supabase Dashboard e recarregue a página.",
        { duration: 10000 }
      );
      console.error("❌ Team member sem organization_id:", {
        currentTeamMember,
        hasTeamMember: !!currentTeamMember,
        organizationId: currentTeamMember?.organization_id,
        isLoading: isLoadingTeamMember,
        isFetching: isFetchingTeamMember,
      });
      return;
    }

    try {
      const payload = {
        ...formData,
        origin: formData.origin as any,
        faturamento: formData.faturamento || null,
        responsible_id: formData.responsible_id || null,
        pre_sale_responsible_id: formData.pre_sale_responsible_id || null,
        sale_responsible_id: formData.sale_responsible_id || null,
        compromisso_date: formData.compromisso_date ? new Date(formData.compromisso_date).toISOString() : null,
        organization_id: currentTeamMember.organization_id,
      };

      if (editingLead) {
        await updateLead.mutateAsync({ id: editingLead.id, ...payload });
        toast.success("Lead atualizado!");
      } else {
        // Mesma pré-checagem do LeadModal: quem barra é o índice único do banco,
        // e a checagem daqui usa a mesma chave. Sem isso, este formulário —
        // que é o da página de Leads, não o modal — continuava despejando a
        // mensagem crua do Postgres na tela.
        const phoneGate = await checkPhoneBeforeCreate(
          currentTeamMember.organization_id,
          formData.phone
        );

        if (phoneGate?.kind === "block") {
          toast.error(phoneGate.message, { duration: 10000 });
          return;
        }

        if (phoneGate?.kind === "confirm" && !window.confirm(phoneGate.message)) {
          return;
        }

        const newLead = await createLead.mutateAsync(payload);

        // Insert lead into selected funnel/stage
        let pipeInserted = false;
        if (newLead?.id && selectedPipe && selectedStage) {
          try {
            if (selectedPipe === "std:whatsapp") {
              await createPipeWhatsapp.mutateAsync({ lead_id: newLead.id, status: selectedStage, organization_id: currentTeamMember!.organization_id });
            } else if (selectedPipe === "std:confirmacao") {
              await createPipeConfirmacao.mutateAsync({ lead_id: newLead.id, status: selectedStage, organization_id: currentTeamMember!.organization_id });
            } else if (selectedPipe === "std:propostas") {
              await createPipeProposta.mutateAsync({ lead_id: newLead.id, status: selectedStage, organization_id: currentTeamMember!.organization_id });
            } else if (selectedPipe.startsWith("custom:")) {
              await addLeadToCustomPipe.mutateAsync({ pipeline_id: selectedPipe.slice(7), lead_id: newLead.id, stage_id: selectedStage });
            }
            pipeInserted = true;
          } catch (pipeError: any) {
            console.error("Erro ao inserir lead no funil:", pipeError);
            toast.error("Lead criado, mas houve erro ao inseri-lo no funil.");
          }
        }

        const pipeName = pipeInserted ? pipeOptions.find(p => p.value === selectedPipe)?.label : null;
        toast.success(pipeName ? `Lead criado e adicionado ao funil ${pipeName}!` : "Lead criado!");
      }
      setIsDialogOpen(false);
      setFormData(initialFormData);
      setEditingLead(null);
    } catch (error: any) {
      console.error("❌ Erro ao salvar lead:", {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        fullError: error,
      });
      
      // Rede de segurança do índice único: a pré-checagem pode não ter visto o
      // conflito (duas abas, webhook no meio do caminho, ou edição trocando o
      // telefone — esta última nem passa pela pré-checagem).
      const phoneMessage = await phoneConflictMessage(
        error,
        currentTeamMember?.organization_id,
        formData.phone
      );

      if (phoneMessage) {
        toast.error(phoneMessage, { duration: 10000 });
      } else if (error?.code === '42501' || error?.message?.includes('permission denied')) {
        toast.error("Erro de permissão. Verifique as políticas RLS no Supabase.");
      } else if (error?.code === '23503' || error?.message?.includes('foreign key')) {
        toast.error("Erro: organização não encontrada. Execute o script SQL de vinculação.");
      } else {
        toast.error(`Erro ao salvar lead: ${error?.message || 'Erro desconhecido'}`);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-2xl font-bold"
          >
            Tanque de Combustível
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Gerencie todo o combustível da sua máquina de vendas
          </p>
        </div>

        <Button variant="ghost" size="icon" onClick={() => setIsImportHistoryOpen(true)} title="Histórico de importações">
          <History className="w-4 h-4" />
        </Button>
        <Button variant="outline" onClick={() => setIsExportModalOpen(true)} disabled={!canExport} className="gap-2">
          <FileDown className="w-4 h-4" />
          Exportar
        </Button>
        <Button onClick={() => handleOpenDialog()} className="gap-2" disabled={!canCreateLead}>
          <Plus className="w-4 h-4" />
          Novo Lead
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="stat-card"
        >
          <p className="stat-card-label">Total de Leads</p>
          <p className="text-xl font-bold">{stats.total}</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="stat-card"
        >
          <p className="stat-card-label">Alta Qualidade (7+)</p>
          <p className="text-xl font-bold text-chart-5">{stats.highRating}</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="stat-card"
        >
          <p className="stat-card-label">Este Mês</p>
          <p className="text-xl font-bold text-primary">{stats.thisMonth}</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="stat-card"
        >
          <p className="stat-card-label">Com Responsável</p>
          <p className="text-xl font-bold text-success">{stats.withSDR}</p>
        </motion.div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, empresa, email ou telefone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterOrigin} onValueChange={setFilterOrigin}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas Origens</SelectItem>
            {Object.entries(originLabels).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterRating} onValueChange={setFilterRating}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Rating" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Ratings</SelectItem>
            <SelectItem value="high">Alta (7-10)</SelectItem>
            <SelectItem value="medium">Média (4-6)</SelectItem>
            <SelectItem value="low">Baixa (0-3)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterQualification} onValueChange={setFilterQualification}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Qualificação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas Qualificações</SelectItem>
            {QUALIFICATION_TIERS.map((tier) => {
              const cfg = QUALIFICATION_TIER_CONFIG[tier];
              const Icon = cfg.icon;
              return (
                <SelectItem key={tier} value={tier}>
                  <span className="flex items-center gap-2">
                    <Icon className={cn("w-3.5 h-3.5", cfg.colorClass)} />
                    {cfg.label}
                  </span>
                </SelectItem>
              );
            })}
            <SelectItem value="none">
              <span className="flex items-center gap-2">
                <CircleDashed className="w-3.5 h-3.5 text-muted-foreground" />
                Sem qualificação
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <SavedViewsDropdown
          entityType="leads"
          currentFilters={filterState}
          defaultFilters={DEFAULT_LEADS_FILTERS}
          onApplyFilters={(f) => setFilterState(() => f)}
          activeViewId={activeViewId}
          onActiveViewChange={handleActiveViewChange}
        />
      </div>

      {/* Chip da janela de criação — sem isso o deep-link do Comando filtra a
          lista silenciosamente e o usuário lê "sumiram leads". */}
      {hasCreatedRange && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 py-1 pl-2.5 pr-1.5 font-medium">
            <Calendar className="h-3.5 w-3.5" />
            {createdFrom && createdTo
              ? formatDayInTz(createdFrom, orgTimezone) === formatDayInTz(createdTo, orgTimezone)
                ? `Criados em ${formatDayInTz(createdFrom, orgTimezone)}`
                : `Criados entre ${formatDayInTz(createdFrom, orgTimezone)} e ${formatDayInTz(createdTo, orgTimezone)}`
              : createdFrom
                ? `Criados a partir de ${formatDayInTz(createdFrom, orgTimezone)}`
                : `Criados até ${formatDayInTz(createdTo!, orgTimezone)}`}
            <button
              type="button"
              onClick={clearCreatedRange}
              aria-label="Remover filtro de período"
              className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-background/80"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        </div>
      )}

      {/* Table (desktop) / Card list (mobile) */}
      <div className={cn("rounded-lg overflow-hidden", !isMobile && "border border-border")}>
        {isMobile ? (
          <div className="space-y-2.5 py-0.5">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))
            ) : leads.length === 0 ? (
              <div className="rounded-xl border border-border py-10 text-center text-sm text-muted-foreground">
                Nenhum lead encontrado
              </div>
            ) : (
              leads.map((lead: Lead) => (
                <div
                  key={lead.id}
                  onClick={() => openLead(lead.id)}
                  className={cn(
                    "rounded-xl border border-border bg-card p-3.5 transition-colors active:bg-muted/50",
                    bulk.isSelected(lead.id) && "border-primary/40 bg-primary/5",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{lead.name}</p>
                      {lead.company && (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <Building className="h-3 w-3 shrink-0" />
                          {lead.company}
                        </p>
                      )}
                    </div>
                    <StarRating rating={lead.rating || 0} readonly />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={originColors[lead.origin] || originColors.outro}>
                      {originLabels[lead.origin] || lead.origin}
                    </Badge>
                    {lead.pre_sale_responsible?.name && (
                      <Badge variant="outline" className="border-blue-500/30 text-xs text-blue-400">
                        {lead.pre_sale_responsible.name}
                      </Badge>
                    )}
                    {lead.sale_responsible?.name && (
                      <Badge variant="outline" className="border-emerald-500/30 text-xs text-emerald-400">
                        {lead.sale_responsible.name}
                      </Badge>
                    )}
                  </div>
                  {(lead.phone || lead.email) && (
                    <div className="mt-2 flex flex-col gap-0.5">
                      {lead.phone && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" />
                          {lead.phone}
                        </span>
                      )}
                      {lead.email && (
                        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate">{lead.email}</span>
                        </span>
                      )}
                    </div>
                  )}
                  <div className="mt-2 border-t border-border/60 pt-2">
                    <span className="text-[11px] text-muted-foreground">
                      {formatDayInTz(lead.created_at, orgTimezone)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={allLeadIds.length > 0 && allLeadIds.every(id => bulk.isSelected(id))}
                  onCheckedChange={() => bulk.selectAll(allLeadIds)}
                />
              </TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Nenhum lead encontrado
                </TableCell>
              </TableRow>
            ) : (
              leads.map((lead: Lead) => (
                <TableRow key={lead.id} className={cn("cursor-pointer hover:bg-muted/50", bulk.isSelected(lead.id) && "bg-primary/5")} onClick={() => openLead(lead.id)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={bulk.isSelected(lead.id)}
                      onCheckedChange={() => bulk.toggle(lead.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{lead.name}</p>
                      {lead.company && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Building className="w-3 h-3" />
                          {lead.company}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {lead.email && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {lead.email}
                        </p>
                      )}
                      {lead.phone && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {lead.phone}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={originColors[lead.origin] || originColors.outro}>
                      {originLabels[lead.origin] || lead.origin}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StarRating rating={lead.rating || 0} readonly />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      {lead.pre_sale_responsible?.name && (
                        <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400">
                          {lead.pre_sale_responsible.name}
                        </Badge>
                      )}
                      {lead.sale_responsible?.name && (
                        <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-400">
                          {lead.sale_responsible.name}
                        </Badge>
                      )}
                      {!lead.pre_sale_responsible?.name && !lead.sale_responsible?.name && (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {formatDayInTz(lead.created_at, orgTimezone)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleOpenDialog(lead)}>
                          <Edit2 className="w-4 h-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setLeadToDelete(lead);
                            setDeleteConfirmOpen(true);
                          }}
                          className="text-destructive focus:text-destructive"
                          disabled={!canDeleteLead}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        )}

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <span className="text-sm text-muted-foreground">
              Página {page + 1} de {totalPages} ({totalLeads} leads)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </div>

      <ExportLeadsModal
        open={isExportModalOpen}
        onOpenChange={setIsExportModalOpen}
        listFilters={{ searchQuery, filterOrigin, filterRating, filterQualification, filterUf: ufFilter, createdFrom, createdTo }}
      />

      <Dialog open={isImportHistoryOpen} onOpenChange={setIsImportHistoryOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Histórico de importações</DialogTitle>
          </DialogHeader>
          <ImportHistoryPanel />
        </DialogContent>
      </Dialog>

      {/* Lead Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) { setSelectedPipe(""); setSelectedStage(""); } }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingLead ? "Editar Lead" : "Novo Lead"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Nome *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Nome do lead"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="company">Empresa</Label>
                <Input
                  id="company"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  placeholder="Nome da empresa"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="email@empresa.com"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(11) 99999-9999"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="origin">Origem</Label>
                <Select
                  value={formData.origin}
                  onValueChange={(v) => setFormData({ ...formData, origin: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(originLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Rating (0-10)</Label>
                <div className="py-2">
                  <StarRating
                    rating={formData.rating}
                    onRate={(r) => setFormData({ ...formData, rating: r })}
                  />
                </div>
              </div>
            </div>

            {/* FUNIL — only visible when creating a new lead */}
            {!editingLead && (
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Adicionar ao Funil</Label>
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
                  <div className="grid gap-2">
                    <Label>Etapa Inicial</Label>
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
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="segment">Segmento</Label>
                <Input
                  id="segment"
                  value={formData.segment}
                  onChange={(e) => setFormData({ ...formData, segment: e.target.value })}
                  placeholder="Ex: Tecnologia, Varejo..."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="faturamento">Faturamento</Label>
                <Input
                  id="faturamento"
                  value={formData.faturamento}
                  onChange={(e) => setFormData({ ...formData, faturamento: e.target.value })}
                  placeholder="Ex: R$ 100.000, Acima de 1M..."
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Resp. Pré-Venda</Label>
                <Select
                  value={formData.pre_sale_responsible_id || "none"}
                  onValueChange={(v) => setFormData({ ...formData, pre_sale_responsible_id: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {responsibleMembers.map(member => (
                      <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Resp. Venda</Label>
                <Select
                  value={formData.sale_responsible_id || "none"}
                  onValueChange={(v) => setFormData({ ...formData, sale_responsible_id: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {responsibleMembers.map(member => (
                      <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="compromisso_date">Compromisso Marcado</Label>
                <Input
                  id="compromisso_date"
                  type="datetime-local"
                  value={formData.compromisso_date}
                  onChange={(e) => setFormData({ ...formData, compromisso_date: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="urgency">Urgência</Label>
                <Input
                  id="urgency"
                  value={formData.urgency}
                  onChange={(e) => setFormData({ ...formData, urgency: e.target.value })}
                  placeholder="Ex: Alta, Média, Baixa..."
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Observações</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Anotações sobre o lead..."
                rows={3}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={createLead.isPending || updateLead.isPending}>
              {editingLead ? "Salvar" : "Criar Lead"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Action Bar */}
      <BulkActionBar selectedIds={bulk.selectedIds} onClear={bulk.clearSelection} leadIds={allLeadIds} />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o lead "{leadToDelete?.name}"? Esta ação irá remover também todas as reuniões, propostas e follow-ups associados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (leadToDelete) {
                  try {
                    await deleteLead.mutateAsync(leadToDelete.id);
                    toast.success("Lead excluído com sucesso!");
                    setLeadToDelete(null);
                  } catch (error) {
                    toast.error("Erro ao excluir lead");
                  }
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function Leads() {
  return (
    <LeadPanelProvider>
      <LeadPanelLayout panel={<LeadDetailSheet />}>
        <LeadsInner />
      </LeadPanelLayout>
    </LeadPanelProvider>
  );
}
