/**
 * LeadDetailContent — shell canônico (Onda 3.1, C10).
 *
 * Path canônico: src/components/lead/LeadDetailContent.tsx
 * Legacy re-export: src/components/chat/LeadDetailContent.tsx
 *
 * Compõe: LeadHeader, LeadCreateForm, LeadTabInfo, LeadTabPipe,
 *          LeadTabCampanhas, LeadTabHistory.
 * Props inalteradas: { phoneNumber, pushName?, onClose?, showHeader? }
 */

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadHeader } from "@/components/lead/header/LeadHeader";
import { LeadTabHistory } from "@/components/lead/tabs/LeadTabHistory";
import { LeadTabInfo } from "@/components/lead/tabs/LeadTabInfo";
import { LeadTabPipe } from "@/components/lead/tabs/LeadTabPipe";
import { LeadTabCampanhas } from "@/components/lead/tabs/LeadTabCampanhas";
import { LeadCreateForm } from "@/components/lead/create/LeadCreateForm";
import {
  useLeadByPhone,
  useCreateLeadFromWhatsApp,
} from "@/hooks/useWhatsAppLeadIntegration";
import {
  useLeadAllPipelines,
  useAddLeadToStandardPipe,
  useMoveLeadInStandardPipe,
  useRemoveLeadFromStandardPipe,
  type PipelineStatus,
} from "@/hooks/useLeadAllPipelines";
import {
  useAddLeadToCustomPipe,
  useMoveLeadInCustomPipe,
  useRemoveLeadFromCustomPipe,
} from "@/hooks/useCustomPipelines";
import { useUpdateLead } from "@/hooks/useLeads";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useCampanhas, useCampanhaStages } from "@/hooks/useCampanhas";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLeadTimelineCompact } from "@/hooks/useLeadTimeline";
import type { TimelineEvent } from "@/hooks/useLeadTimeline";
import type { CreateLeadPayload } from "@/components/lead/create/LeadCreateForm";
import type { LeadContactFormData } from "@/components/lead/info/LeadContactInfo";

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
  const [selectedCampanhaId, setSelectedCampanhaId] = useState<string | null>(null);
  const [isAddingToCampanha, setIsAddingToCampanha] = useState(false);
  const [formData, setFormData] = useState<LeadContactFormData>({
    name: "",
    company: "",
    email: "",
    rating: 0,
    notes: "",
  });

  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const { data: lead, isLoading: leadLoading, refetch: refetchLead } = useLeadByPhone(phoneNumber);
  const { data: allPipelines = [], isLoading: pipelinesLoading } = useLeadAllPipelines(lead?.id ?? null);
  const { data: campanhas = [] } = useCampanhas();
  const { data: campanhaStages = [] } = useCampanhaStages(selectedCampanhaId ?? undefined);
  const { data: recentHistory = [] } = useLeadTimelineCompact(lead?.id);

  const createLead = useCreateLeadFromWhatsApp();
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const addToStandard = useAddLeadToStandardPipe();
  const moveInStandard = useMoveLeadInStandardPipe();
  const removeFromStandard = useRemoveLeadFromStandardPipe();
  const addToCustom = useAddLeadToCustomPipe();
  const moveInCustom = useMoveLeadInCustomPipe();
  const removeFromCustom = useRemoveLeadFromCustomPipe();

  const activeCampanhas = campanhas.filter((c) => c.is_active);
  const isMutating =
    addToStandard.isPending || moveInStandard.isPending ||
    removeFromStandard.isPending || addToCustom.isPending ||
    moveInCustom.isPending || removeFromCustom.isPending;

  // Hydrate form when lead loads
  useEffect(() => {
    if (lead) {
      setFormData({
        name: lead.name || "",
        company: lead.company || "",
        email: lead.email || "",
        rating: lead.rating || 0,
        notes: lead.notes || "",
      });
    } else if (!leadLoading) {
      setFormData({ name: pushName || "", company: "", email: "", rating: 0, notes: "" });
    }
  }, [lead, leadLoading, pushName]);

  // ─── Handlers ────────────────────────────────────────────────

  const handleCreateLead = async (payload: CreateLeadPayload) => {
    const result = await createLead.mutateAsync({
      phone: payload.phone,
      pushName: payload.name || pushName,
      origin: payload.origin,
      sdrId: payload.sdrId,
      destination: payload.destination,
      campanhaId: payload.campanhaId,
      customPipelineId: payload.customPipelineId,
      customStageId: payload.customStageId,
    });

    // Move to specific stage if not default
    if (payload.stageId && result.leadId) {
      const tableMap: Record<string, string> = {
        qualificacao: "pipe_whatsapp",
        confirmacao: "pipe_confirmacao",
        propostas: "pipe_propostas",
      };
      const table = tableMap[payload.destination];
      if (table) {
        await supabase.from(table).update({ status: payload.stageId }).eq("lead_id", result.leadId);
      }
    }

    if (result.isNew && (payload.company || payload.email || payload.notes)) {
      await updateLead.mutateAsync({
        id: result.leadId,
        company: payload.company || null,
        email: payload.email || null,
        notes: payload.notes || null,
        rating: payload.rating || null,
      });
    }

    logAction({ leadId: result.leadId, action: "lead_created", description: `Lead "${payload.name}" criado via WhatsApp` });
    toast.success("Lead criado com sucesso!");
    refetchLead();
  };

  const handleUpdateLead = async () => {
    if (!lead) return;
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
  };

  const handleAddToCampanha = async () => {
    if (!lead || !selectedCampanhaId || !campanhaStages.length) return;
    setIsAddingToCampanha(true);
    try {
      const firstStage = campanhaStages.sort((a, b) => a.position - b.position)[0];
      const { data: existing } = await supabase.from("campanha_leads").select("id")
        .eq("campanha_id", selectedCampanhaId).eq("lead_id", lead.id).maybeSingle();
      if (existing) { toast.info("Lead já está nesta campanha"); return; }
      const { error } = await supabase.from("campanha_leads").insert({
        campanha_id: selectedCampanhaId, lead_id: lead.id,
        stage_id: firstStage.id, responsible_id: teamMember?.id || null, sdr_id: teamMember?.id || null,
      });
      if (error) throw error;
      toast.success("Lead adicionado à campanha!");
      queryClient.invalidateQueries({ queryKey: ["campanha_leads"] });
      setSelectedCampanhaId(null);
    } finally {
      setIsAddingToCampanha(false);
    }
  };

  const handleMoveStage = async (pipeline: PipelineStatus, newStageId: string) => {
    if (!lead) return;
    if (pipeline.type === "standard" && pipeline.pipeId) {
      await moveInStandard.mutateAsync({ pipeId: pipeline.pipeId, pipeType: pipeline.pipeType, newStageId });
      const stageName = pipeline.stages.find((s) => s.id === newStageId)?.label;
      toast.success(`Movido para "${stageName}"`);
    } else if (pipeline.type === "custom" && pipeline.entryId) {
      await moveInCustom.mutateAsync({ entry_id: pipeline.entryId, pipeline_id: pipeline.pipelineId, new_stage_id: newStageId });
      const stageName = pipeline.stages.find((s) => s.id === newStageId)?.name;
      toast.success(`Movido para "${stageName}"`);
    }
  };

  const handleRemoveFromPipeline = async (pipeline: PipelineStatus) => {
    if (!lead) return;
    if (pipeline.type === "standard" && pipeline.pipeId) {
      await removeFromStandard.mutateAsync({ pipeId: pipeline.pipeId, pipeType: pipeline.pipeType });
      toast.success(`Removido de "${pipeline.label}"`);
    } else if (pipeline.type === "custom" && pipeline.entryId) {
      await removeFromCustom.mutateAsync({ entry_id: pipeline.entryId, pipeline_id: pipeline.pipelineId });
      toast.success(`Removido de "${pipeline.pipelineName}"`);
    }
  };

  const handleAddToPipeline = async (pipeline: PipelineStatus, stageId: string) => {
    if (!lead) return;
    try {
      if (pipeline.type === "standard") {
        await addToStandard.mutateAsync({ leadId: lead.id, pipeType: pipeline.pipeType, stageId });
        toast.success(`Adicionado a "${pipeline.label}"`);
      } else if (pipeline.type === "custom") {
        await addToCustom.mutateAsync({ pipeline_id: pipeline.pipelineId, lead_id: lead.id, stage_id: stageId });
        toast.success(`Adicionado a "${pipeline.pipelineName}"`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.includes("duplicate")) { toast.info("Lead já está neste funil"); }
      else { toast.error("Erro ao adicionar lead"); }
    }
  };

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {showHeader && (
        <LeadHeader name={lead?.name || pushName || phoneNumber} phoneNumber={phoneNumber} hasLead={!!lead} />
      )}

      {leadLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !lead ? (
        <LeadCreateForm
          phoneNumber={phoneNumber}
          pushName={pushName}
          onSubmit={handleCreateLead}
          onCancel={onClose}
          isSubmitting={createLead.isPending}
        />
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-4 mx-6 w-[calc(100%-3rem)]">
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="campanha">Campanhas</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4 px-6 pb-4">
            <TabsContent value="info" className="mt-0">
              <LeadTabInfo
                leadId={lead.id}
                formData={formData}
                onChange={setFormData}
                onSave={handleUpdateLead}
                isSaving={updateLead.isPending}
                qualificationScore={lead.qualification_score}
                origin={lead.origin}
                originDetail={lead.origin_detail}
                leadTags={lead.lead_tags as { tag: { id: string; name: string; color: string } }[]}
                responsible={lead.responsible as { id: string; name: string } | null}
                sdr={lead.sdr as { id: string; name: string } | null}
                closer={lead.closer as { id: string; name: string } | null}
              />
            </TabsContent>

            <TabsContent value="pipeline" className="mt-0">
              <LeadTabPipe
                pipelines={allPipelines}
                isLoadingPipelines={pipelinesLoading}
                recentHistory={recentHistory as TimelineEvent[]}
                onMoveStage={handleMoveStage}
                onRemoveFromPipeline={handleRemoveFromPipeline}
                onAddToPipeline={handleAddToPipeline}
                isMutating={isMutating}
              />
            </TabsContent>

            <TabsContent value="campanha" className="mt-0">
              <LeadTabCampanhas
                activeCampanhas={activeCampanhas}
                selectedCampanhaId={selectedCampanhaId}
                onSelectCampanha={setSelectedCampanhaId}
                onAddToCampanha={handleAddToCampanha}
                isAdding={isAddingToCampanha}
                hasStages={campanhaStages.length > 0}
              />
            </TabsContent>

            <TabsContent value="history" className="mt-0 space-y-0">
              <LeadTabHistory leadId={lead.id} events={recentHistory as TimelineEvent[]} />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
}
