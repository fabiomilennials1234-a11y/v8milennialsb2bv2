import { useState, useEffect } from "react";
import {
  User,
  Phone,
  Tag,
  Plus,
  Loader2,
  Target,
  ArrowRight,
  Check,
  ExternalLink,
  X,
  ChevronDown,
  GitBranch,
  History,
} from "lucide-react";
import { LeadHeader } from "@/components/lead/header/LeadHeader";
import { LeadTabHistory } from "@/components/lead/tabs/LeadTabHistory";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useLeadByPhone,
  useCreateLeadFromWhatsApp,
  type LeadDestination,
} from "@/hooks/useWhatsAppLeadIntegration";
import {
  useLeadAllPipelines,
  useAddLeadToStandardPipe,
  useMoveLeadInStandardPipe,
  useRemoveLeadFromStandardPipe,
  type PipelineStatus,
  type StandardPipelineStatus,
  type CustomPipelineStatus,
} from "@/hooks/useLeadAllPipelines";
import {
  useAddLeadToCustomPipe,
  useMoveLeadInCustomPipe,
  useRemoveLeadFromCustomPipe,
  useCustomPipelines,
  useCustomPipelineStages,
} from "@/hooks/useCustomPipelines";
import { useUpdateLead } from "@/hooks/useLeads";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useCampanhas, useCampanhaStages } from "@/hooks/useCampanhas";
import { useTeamMembers, useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useAllPipelineStageOptions } from "@/hooks/usePipelineStages";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TimelineItem } from "@/components/leads/TimelineItem";
import { useLeadTimelineCompact } from "@/hooks/useLeadTimeline";
import type { TimelineEvent } from "@/hooks/useLeadTimeline";
import { originOptions } from "@/lib/lead/lead-origins";
import {
  DEST_TO_PIPE_TYPE,
  isStandardDestination,
} from "@/lib/lead/lead-destinations";
import {
  getPipelineKey,
  getPipelineLabel,
  getPipelineColor,
  isInPipeline,
  getCurrentStageLabel,
  getCurrentStageId,
  getNormalizedStages,
} from "@/lib/lead/pipeline-adapters";

export interface LeadDetailContentProps {
  phoneNumber: string;
  pushName?: string | null;
  onClose?: () => void;
  showHeader?: boolean;
}

export function LeadDetailContent({
  phoneNumber,
  pushName,
  onClose,
  showHeader = false,
}: LeadDetailContentProps) {
  const [activeTab, setActiveTab] = useState("info");
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCampanhaId, setSelectedCampanhaId] = useState<string | null>(null);
  const [isAddingToCampanha, setIsAddingToCampanha] = useState(false);

  // Campos de criação
  const [createOrigin, setCreateOrigin] = useState("whatsapp");
  const [createSdrId, setCreateSdrId] = useState<string>("");
  const [createDestination, setCreateDestination] = useState<LeadDestination>("qualificacao");
  const [createCampanhaId, setCreateCampanhaId] = useState<string>("");
  const [createCustomPipelineId, setCreateCustomPipelineId] = useState<string>("");
  const [createCustomStageId, setCreateCustomStageId] = useState<string>("");
  const [createStageId, setCreateStageId] = useState<string>("");

  // Pipeline tab: expanding/adding states
  const [expandedPipeline, setExpandedPipeline] = useState<string | null>(null);
  const [addingToPipeline, setAddingToPipeline] = useState<string | null>(null);
  const [addStageId, setAddStageId] = useState<string>("");

  const [formData, setFormData] = useState({
    name: "",
    company: "",
    email: "",
    rating: 0,
    notes: "",
  });

  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: lead, isLoading: leadLoading, refetch: refetchLead } = useLeadByPhone(phoneNumber);
  const { data: allPipelines = [], isLoading: pipelinesLoading } = useLeadAllPipelines(lead?.id || null);
  const { data: campanhas = [] } = useCampanhas();
  const { data: campanhaStages = [] } = useCampanhaStages(
    (createDestination === "campanha" ? createCampanhaId : selectedCampanhaId) || undefined
  );

  // Dynamic stages from pipeline_stages (replaces hardcoded stage lists)
  const { stagesByPipe: dynamicStagesByPipe } = useAllPipelineStageOptions();

  // Custom pipelines for creation dropdown
  const { data: customPipelines = [] } = useCustomPipelines();
  const { data: customPipeStages = [] } = useCustomPipelineStages(
    createDestination === "custom" ? createCustomPipelineId : undefined
  );

  const createLead = useCreateLeadFromWhatsApp();
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();

  // Timeline: últimos 8 eventos com refresh automático
  const { data: recentHistory = [] } = useLeadTimelineCompact(lead?.id);

  // Pipeline mutations
  const addToStandard = useAddLeadToStandardPipe();
  const moveInStandard = useMoveLeadInStandardPipe();
  const removeFromStandard = useRemoveLeadFromStandardPipe();
  const addToCustom = useAddLeadToCustomPipe();
  const moveInCustom = useMoveLeadInCustomPipe();
  const removeFromCustom = useRemoveLeadFromCustomPipe();

  const activeCampanhas = campanhas.filter((c) => c.is_active);

  useEffect(() => {
    if (lead) {
      setFormData({
        name: lead.name || "",
        company: lead.company || "",
        email: lead.email || "",
        rating: lead.rating || 0,
        notes: lead.notes || "",
      });
      setIsCreating(false);
    } else if (!leadLoading) {
      setFormData({
        name: pushName || "",
        company: "",
        email: "",
        rating: 0,
        notes: "",
      });
      setIsCreating(true);
      if (teamMember?.id && !createSdrId) {
        setCreateSdrId(teamMember.id);
      }
    }
  }, [lead, leadLoading, pushName, teamMember?.id]);

  // Reset stage when destination changes
  useEffect(() => {
    setCreateStageId("");
    setCreateCustomStageId("");
    setCreateCustomPipelineId("");
  }, [createDestination]);

  useEffect(() => {
    setCreateCustomStageId("");
  }, [createCustomPipelineId]);

  // ─── Dynamic stage definitions for creation dropdown ─────────
  const getStandardStages = (dest: string) => {
    const pipeType = DEST_TO_PIPE_TYPE[dest];
    if (!pipeType || !dynamicStagesByPipe[pipeType]) return [];
    return dynamicStagesByPipe[pipeType].map(s => ({ id: s.value, label: s.label }));
  };

  const standardStagesForCreate = getStandardStages(createDestination);
  const isStandardDest = isStandardDestination(createDestination);

  // ─── Handlers ─────────────────────────────────────────────────

  const handleCreateLead = async () => {
    try {
      const result = await createLead.mutateAsync({
        phone: phoneNumber,
        pushName: formData.name || pushName,
        origin: createOrigin,
        sdrId: createSdrId || undefined,
        destination: createDestination,
        campanhaId: createDestination === "campanha" ? createCampanhaId : undefined,
        customPipelineId: createDestination === "custom" ? createCustomPipelineId : undefined,
        customStageId: createDestination === "custom" ? createCustomStageId : undefined,
      });

      // If standard destination with specific stage (not default first)
      if (isStandardDest && createStageId && result.leadId) {
        // The hook inserts with default stage, we may need to update if different
        // For now, we handle this by updating after creation if stage differs
        // Compare against the first dynamic stage to decide if we need to update
        const firstDynamicStage = standardStagesForCreate[0]?.id || "";
        if (createStageId && createStageId !== firstDynamicStage) {
          // Need to update the pipe status
          const tableMap: Record<string, string> = {
            qualificacao: "pipe_whatsapp",
            confirmacao: "pipe_confirmacao",
            propostas: "pipe_propostas",
          };
          await supabase
            .from(tableMap[createDestination])
            .update({ status: createStageId })
            .eq("lead_id", result.leadId);
        }
      }

      if (result.isNew && (formData.company || formData.email || formData.notes)) {
        await updateLead.mutateAsync({
          id: result.leadId,
          company: formData.company || null,
          email: formData.email || null,
          notes: formData.notes || null,
          rating: formData.rating || null,
        });
      }

      logAction({ leadId: result.leadId, action: "lead_created", description: `Lead "${formData.name || pushName}" criado via WhatsApp` });
      toast.success("Lead criado com sucesso!");
      refetchLead();
      setIsCreating(false);
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar lead");
    }
  };

  const handleUpdateLead = async () => {
    if (!lead) return;
    try {
      await updateLead.mutateAsync({
        id: lead.id,
        name: formData.name,
        company: formData.company || null,
        email: formData.email || null,
        rating: formData.rating || null,
        notes: formData.notes || null,
      });
      logAction({ leadId: lead.id, action: "field_updated", description: "Dados do lead atualizados via chat" });
      toast.success("Lead atualizado!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar");
    }
  };

  const handleAddToCampanha = async () => {
    if (!lead || !selectedCampanhaId || !campanhaStages.length) return;

    setIsAddingToCampanha(true);
    try {
      const firstStage = campanhaStages.sort((a, b) => a.position - b.position)[0];

      const { data: existing } = await supabase
        .from("campanha_leads")
        .select("id")
        .eq("campanha_id", selectedCampanhaId)
        .eq("lead_id", lead.id)
        .maybeSingle();

      if (existing) {
        toast.info("Lead já está nesta campanha");
        setIsAddingToCampanha(false);
        return;
      }

      const { error } = await supabase.from("campanha_leads").insert({
        campanha_id: selectedCampanhaId,
        lead_id: lead.id,
        stage_id: firstStage.id,
        responsible_id: teamMember?.id || null,
        sdr_id: teamMember?.id || null,
      });

      if (error) throw error;

      toast.success("Lead adicionado à campanha!");
      queryClient.invalidateQueries({ queryKey: ["campanha_leads"] });
      setSelectedCampanhaId(null);
    } catch (error: any) {
      toast.error(error.message || "Erro ao adicionar à campanha");
    } finally {
      setIsAddingToCampanha(false);
    }
  };

  // ─── Pipeline tab handlers ────────────────────────────────────

  const handleMoveStage = async (pipeline: PipelineStatus, newStageId: string) => {
    if (!lead) return;
    try {
      if (pipeline.type === "standard" && pipeline.pipeId) {
        await moveInStandard.mutateAsync({
          pipeId: pipeline.pipeId,
          pipeType: pipeline.pipeType,
          newStageId,
        });
        const stageName = pipeline.stages.find((s) => s.id === newStageId)?.label;
        toast.success(`Movido para "${stageName}"`);
      } else if (pipeline.type === "custom" && pipeline.entryId) {
        await moveInCustom.mutateAsync({
          entry_id: pipeline.entryId,
          pipeline_id: pipeline.pipelineId,
          new_stage_id: newStageId,
        });
        const stageName = pipeline.stages.find((s) => s.id === newStageId)?.name;
        toast.success(`Movido para "${stageName}"`);
      }
      setExpandedPipeline(null);
    } catch {
      toast.error("Erro ao mover lead");
    }
  };

  const handleRemoveFromPipeline = async (pipeline: PipelineStatus) => {
    if (!lead) return;
    try {
      if (pipeline.type === "standard" && pipeline.pipeId) {
        await removeFromStandard.mutateAsync({
          pipeId: pipeline.pipeId,
          pipeType: pipeline.pipeType,
        });
        toast.success(`Removido de "${pipeline.label}"`);
      } else if (pipeline.type === "custom" && pipeline.entryId) {
        await removeFromCustom.mutateAsync({
          entry_id: pipeline.entryId,
          pipeline_id: pipeline.pipelineId,
        });
        toast.success(`Removido de "${pipeline.pipelineName}"`);
      }
    } catch {
      toast.error("Erro ao remover lead");
    }
  };

  const handleAddToPipeline = async (pipeline: PipelineStatus) => {
    if (!lead || !addStageId) return;
    try {
      if (pipeline.type === "standard") {
        await addToStandard.mutateAsync({
          leadId: lead.id,
          pipeType: pipeline.pipeType,
          stageId: addStageId,
        });
        toast.success(`Adicionado a "${pipeline.label}"`);
      } else if (pipeline.type === "custom") {
        await addToCustom.mutateAsync({
          pipeline_id: pipeline.pipelineId,
          lead_id: lead.id,
          stage_id: addStageId,
        });
        toast.success(`Adicionado a "${pipeline.pipelineName}"`);
      }
      setAddingToPipeline(null);
      setAddStageId("");
    } catch (error: any) {
      if (error.message?.includes("duplicate")) {
        toast.info("Lead já está neste funil");
      } else {
        toast.error("Erro ao adicionar lead");
      }
    }
  };

  const isLoading = leadLoading;

  const isCreateDisabled = () => {
    if (createLead.isPending || !formData.name) return true;
    if (createDestination === "campanha" && !createCampanhaId) return true;
    if (createDestination === "custom" && (!createCustomPipelineId || !createCustomStageId)) return true;
    if (isStandardDest && !createStageId) return true;
    return false;
  };

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {showHeader && (
        <LeadHeader
          name={lead?.name || pushName || phoneNumber}
          phoneNumber={phoneNumber}
          hasLead={!!lead}
        />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !lead && isCreating ? (
        /* ─── CREATION FORM ─────────────────────────────────── */
        <div className="space-y-4 py-4 overflow-y-auto px-6">
          <div className="text-center pb-4">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <Plus className="w-8 h-8 text-primary" />
            </div>
            <h3 className="font-semibold text-lg">Criar Novo Lead</h3>
            <p className="text-sm text-muted-foreground">
              Este contato ainda não está no CRM. Preencha os dados para criar um lead.
            </p>
          </div>

          <div className="grid gap-4">
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
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@exemplo.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Observações sobre o lead..."
                rows={3}
              />
            </div>

            <Separator />

            <div className="grid gap-2">
              <Label htmlFor="origin">Origem *</Label>
              <Select value={createOrigin} onValueChange={setCreateOrigin}>
                <SelectTrigger id="origin">
                  <SelectValue placeholder="Selecione a origem" />
                </SelectTrigger>
                <SelectContent>
                  {originOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="responsible">Responsável</Label>
              <Select value={createSdrId} onValueChange={setCreateSdrId}>
                <SelectTrigger id="responsible">
                  <SelectValue placeholder="Selecione o responsável" />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers.map((member: any) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* ─── Expanded Destination Dropdown ─── */}
            <div className="grid gap-2">
              <Label htmlFor="destination">Destino</Label>
              <Select
                value={createDestination === "custom" ? `custom:${createCustomPipelineId}` : createDestination}
                onValueChange={(v) => {
                  if (v.startsWith("custom:")) {
                    setCreateDestination("custom");
                    setCreateCustomPipelineId(v.replace("custom:", ""));
                  } else {
                    setCreateDestination(v as LeadDestination);
                  }
                }}
              >
                <SelectTrigger id="destination">
                  <SelectValue placeholder="Selecione o destino" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Funis Padrão</SelectLabel>
                    <SelectItem value="qualificacao">Qualificação</SelectItem>
                    <SelectItem value="confirmacao">Confirmação</SelectItem>
                    <SelectItem value="propostas">Propostas</SelectItem>
                  </SelectGroup>
                  {customPipelines.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Funis Customizados</SelectLabel>
                      {customPipelines.map((pipe) => (
                        <SelectItem key={pipe.id} value={`custom:${pipe.id}`}>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: pipe.color }}
                            />
                            {pipe.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel>Outros</SelectLabel>
                    <SelectItem value="campanha">Campanha</SelectItem>
                    <SelectItem value="none">Nenhum</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* Stage selector for standard pipelines */}
            {isStandardDest && (
              <div className="grid gap-2">
                <Label>Etapa</Label>
                <Select value={createStageId} onValueChange={setCreateStageId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a etapa..." />
                  </SelectTrigger>
                  <SelectContent>
                    {standardStagesForCreate.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Stage selector for custom pipeline */}
            {createDestination === "custom" && createCustomPipelineId && (
              <div className="grid gap-2">
                <Label>Etapa</Label>
                <Select value={createCustomStageId} onValueChange={setCreateCustomStageId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a etapa..." />
                  </SelectTrigger>
                  <SelectContent>
                    {customPipeStages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                          {s.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Campaign selector */}
            {createDestination === "campanha" && (
              <div className="grid gap-2">
                <Label htmlFor="create-campanha">Campanha</Label>
                <Select value={createCampanhaId} onValueChange={setCreateCampanhaId}>
                  <SelectTrigger id="create-campanha">
                    <SelectValue placeholder="Selecione a campanha..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeCampanhas.map((campanha) => (
                      <SelectItem key={campanha.id} value={campanha.id}>
                        <div className="flex items-center gap-2">
                          <Target className="w-4 h-4" />
                          {campanha.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            {onClose && (
              <Button variant="outline" className="flex-1" onClick={onClose}>
                Cancelar
              </Button>
            )}
            <Button
              className={onClose ? "flex-1" : "w-full"}
              onClick={handleCreateLead}
              disabled={isCreateDisabled()}
            >
              {createLead.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Criar Lead
            </Button>
          </div>
        </div>
      ) : lead ? (
        /* ─── LEAD EXISTS: TABS ─────────────────────────────── */
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-4 mx-6 w-[calc(100%-3rem)]">
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="campanha">Campanhas</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4 px-6 pb-4">
            {/* ─── TAB: INFO ─── */}
            <TabsContent value="info" className="mt-0 space-y-4">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-name">Nome</Label>
                  <Input
                    id="edit-name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-company">Empresa</Label>
                  <Input
                    id="edit-company"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-rating">Rating (0-10)</Label>
                  <Input
                    id="edit-rating"
                    type="number"
                    min="0"
                    max="10"
                    value={formData.rating}
                    onChange={(e) => setFormData({ ...formData, rating: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-notes">Notas</Label>
                  <Textarea
                    id="edit-notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                  />
                </div>
              </div>

              {lead.lead_tags && lead.lead_tags.length > 0 && (
                <div className="space-y-2">
                  <Label>Tags</Label>
                  <div className="flex flex-wrap gap-1">
                    {lead.lead_tags.map((lt: any) => (
                      <Badge
                        key={lt.tag.id}
                        variant="outline"
                        style={{
                          backgroundColor: `${lt.tag.color}20`,
                          borderColor: `${lt.tag.color}40`,
                          color: lt.tag.color,
                        }}
                      >
                        <Tag className="w-3 h-3 mr-1" />
                        {lt.tag.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => window.open(`/leads?id=${lead.id}`, "_blank")}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Ver Completo
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handleUpdateLead}
                  disabled={updateLead.isPending}
                >
                  {updateLead.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Salvar
                </Button>
              </div>
            </TabsContent>

            {/* ─── TAB: PIPELINE (UNIFIED) ─── */}
            <TabsContent value="pipeline" className="mt-0 space-y-3">
              <div className="text-center pb-2">
                <h4 className="font-medium flex items-center justify-center gap-2">
                  <GitBranch className="w-4 h-4" />
                  Funis
                </h4>
                <p className="text-sm text-muted-foreground">Gerencie o lead em todos os funis</p>
              </div>

              {pipelinesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-2">
                  {allPipelines.map((pipeline) => {
                    const key = getPipelineKey(pipeline);
                    const label = getPipelineLabel(pipeline);
                    const color = getPipelineColor(pipeline);
                    const inPipe = isInPipeline(pipeline);
                    const currentLabel = getCurrentStageLabel(pipeline);
                    const currentId = getCurrentStageId(pipeline);
                    const stages = getNormalizedStages(pipeline);
                    const isExpanded = expandedPipeline === key;
                    const isAdding = addingToPipeline === key;

                    return (
                      <div
                        key={key}
                        className="border rounded-lg overflow-hidden"
                      >
                        {/* Pipeline row */}
                        <div className="flex items-center gap-3 p-3">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="font-medium text-sm flex-1 min-w-0 truncate">
                            {label}
                          </span>

                          {inPipe ? (
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant="secondary"
                                className="text-xs cursor-pointer"
                                onClick={() => setExpandedPipeline(isExpanded ? null : key)}
                              >
                                {currentLabel}
                                <ChevronDown className={cn(
                                  "w-3 h-3 ml-1 transition-transform",
                                  isExpanded && "rotate-180"
                                )} />
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => handleRemoveFromPipeline(pipeline)}
                              >
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                setAddingToPipeline(isAdding ? null : key);
                                setAddStageId("");
                              }}
                            >
                              <Plus className="w-3.5 h-3.5 mr-1" />
                              Adicionar
                            </Button>
                          )}
                        </div>

                        {/* Expanded: move stage */}
                        {isExpanded && inPipe && (
                          <div className="border-t bg-muted/30 p-3 space-y-1.5">
                            <span className="text-xs text-muted-foreground">Mover para:</span>
                            <div className="grid grid-cols-1 gap-1">
                              {stages.map((stage) => {
                                const isCurrent = stage.id === currentId;
                                return (
                                  <Button
                                    key={stage.id}
                                    variant={isCurrent ? "default" : "outline"}
                                    size="sm"
                                    className={cn("justify-start h-8 text-xs", isCurrent && "pointer-events-none")}
                                    style={isCurrent ? { backgroundColor: stage.color } : { borderColor: `${stage.color}60` }}
                                    onClick={() => !isCurrent && handleMoveStage(pipeline, stage.id)}
                                    disabled={moveInStandard.isPending || moveInCustom.isPending}
                                  >
                                    <div
                                      className="w-2.5 h-2.5 rounded-full mr-2 shrink-0"
                                      style={{ backgroundColor: stage.color }}
                                    />
                                    <span className="flex-1 text-left">{stage.name}</span>
                                    {isCurrent && <Check className="w-3.5 h-3.5" />}
                                  </Button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Adding: select stage */}
                        {isAdding && !inPipe && (
                          <div className="border-t bg-muted/30 p-3 space-y-2">
                            <span className="text-xs text-muted-foreground">Selecione a etapa:</span>
                            <Select value={addStageId} onValueChange={setAddStageId}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Etapa..." />
                              </SelectTrigger>
                              <SelectContent>
                                {stages.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    <div className="flex items-center gap-2">
                                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                                      {s.name}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {addStageId && (
                              <Button
                                size="sm"
                                className="w-full h-8 text-xs"
                                onClick={() => handleAddToPipeline(pipeline)}
                                disabled={addToStandard.isPending || addToCustom.isPending}
                              >
                                {(addToStandard.isPending || addToCustom.isPending) ? (
                                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                ) : (
                                  <Plus className="w-3.5 h-3.5 mr-1" />
                                )}
                                Adicionar
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {allPipelines.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <GitBranch className="w-10 h-10 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Nenhum funil disponível</p>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ─── TAB: CAMPANHAS ─── */}
            <TabsContent value="campanha" className="mt-0 space-y-4">
              <div className="text-center pb-2">
                <h4 className="font-medium">Campanhas</h4>
                <p className="text-sm text-muted-foreground">Vincule este lead a uma campanha ativa</p>
              </div>

              {activeCampanhas.length > 0 ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Selecione uma campanha</Label>
                    <Select value={selectedCampanhaId || ""} onValueChange={setSelectedCampanhaId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Escolha uma campanha..." />
                      </SelectTrigger>
                      <SelectContent>
                        {activeCampanhas.map((campanha) => (
                          <SelectItem key={campanha.id} value={campanha.id}>
                            <div className="flex items-center gap-2">
                              <Target className="w-4 h-4" />
                              {campanha.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedCampanhaId && (
                    <Button
                      className="w-full"
                      onClick={handleAddToCampanha}
                      disabled={isAddingToCampanha || !campanhaStages.length}
                    >
                      {isAddingToCampanha ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 mr-2" />
                      )}
                      Adicionar à Campanha
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Target className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-muted-foreground">Nenhuma campanha ativa no momento</p>
                </div>
              )}
            </TabsContent>

            {/* ─── TAB: HISTÓRICO (últimos 8 eventos) ─── */}
            <TabsContent value="history" className="mt-0 space-y-0">
              <LeadTabHistory
                leadId={lead?.id}
                events={recentHistory as TimelineEvent[]}
              />
            </TabsContent>
          </div>
        </Tabs>
      ) : null}
    </div>
  );
}
