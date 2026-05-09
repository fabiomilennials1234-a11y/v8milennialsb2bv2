/**
 * LeadDetailContent — shell canônico (Onda 3.1, C12).
 *
 * Path canônico: src/components/lead/LeadDetailContent.tsx
 * Legacy re-export: src/components/chat/LeadDetailContent.tsx
 *
 * Compõe: LeadHeader, LeadCreateForm, LeadTabInfo, LeadTabPipe,
 *          LeadTabCampanhas, LeadTabHistory.
 * Props inalteradas: { phoneNumber, pushName?, onClose?, showHeader? }
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadHeader } from "@/components/lead/header/LeadHeader";
import { LeadTabHistory } from "@/components/lead/tabs/LeadTabHistory";
import { LeadTabInfo } from "@/components/lead/tabs/LeadTabInfo";
import { LeadTabPipe } from "@/components/lead/tabs/LeadTabPipe";
import { LeadTabCampanhas } from "@/components/lead/tabs/LeadTabCampanhas";
import { LeadCreateForm } from "@/components/lead/create/LeadCreateForm";
import { LeadChecklistSection } from "@/components/leads/LeadChecklistSection";
import { useLeadByPhone } from "@/hooks/useWhatsAppLeadIntegration";
import { useLeadAllPipelines } from "@/hooks/useLeadAllPipelines";
import { useLeadForm } from "@/hooks/lead/useLeadForm";
import { useLeadCampaignsAttach } from "@/hooks/lead/useLeadCampaignsAttach";
import { useLeadPipeHandlers } from "@/hooks/lead/useLeadPipeHandlers";
import { useLeadCreateHandler } from "@/hooks/lead/useLeadCreateHandler";
import { useLeadTimelineCompact } from "@/hooks/useLeadTimeline";
import type { TimelineEvent } from "@/hooks/useLeadTimeline";

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

  const { data: lead, isLoading: leadLoading, refetch: refetchLead } = useLeadByPhone(phoneNumber);
  const { data: allPipelines = [], isLoading: pipelinesLoading } = useLeadAllPipelines(lead?.id ?? null);
  const { data: recentHistory = [] } = useLeadTimelineCompact(lead?.id);

  const { formData, onChange, save: saveForm, isSaving } = useLeadForm(lead, pushName);
  const campanhasAttach = useLeadCampaignsAttach();
  const pipeHandlers = useLeadPipeHandlers(lead?.id);
  const { create: createLead, isPending: isCreating } = useLeadCreateHandler({
    pushName,
    onSuccess: refetchLead,
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {showHeader && (
        <LeadHeader
          name={lead?.name || pushName || phoneNumber}
          phoneNumber={phoneNumber}
          hasLead={!!lead}
        />
      )}

      {leadLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !lead ? (
        <LeadCreateForm
          phoneNumber={phoneNumber}
          pushName={pushName}
          onSubmit={createLead}
          onCancel={onClose}
          isSubmitting={isCreating}
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
            <TabsContent value="info" className="mt-0 space-y-5">
              <LeadTabInfo
                leadId={lead.id}
                formData={formData}
                onChange={onChange}
                onSave={saveForm}
                isSaving={isSaving}
                qualificationScore={lead.qualification_score}
                origin={lead.origin}
                originDetail={lead.origin_detail}
                leadTags={lead.lead_tags as { tag: { id: string; name: string; color: string } }[]}
                responsible={lead.responsible as { id: string; name: string } | null}
                sdr={lead.sdr as { id: string; name: string } | null}
                closer={lead.closer as { id: string; name: string } | null}
              />
              <div className="border-t pt-4 space-y-4">
                <LeadChecklistSection leadId={lead.id} />
              </div>
            </TabsContent>

            <TabsContent value="pipeline" className="mt-0">
              <LeadTabPipe
                pipelines={allPipelines}
                isLoadingPipelines={pipelinesLoading}
                recentHistory={recentHistory as TimelineEvent[]}
                onMoveStage={pipeHandlers.moveStage}
                onRemoveFromPipeline={pipeHandlers.removeFromPipeline}
                onAddToPipeline={pipeHandlers.addToPipeline}
                isMutating={pipeHandlers.isMutating}
              />
            </TabsContent>

            <TabsContent value="campanha" className="mt-0">
              <LeadTabCampanhas
                activeCampanhas={campanhasAttach.activeCampanhas}
                selectedCampanhaId={campanhasAttach.selectedCampanhaId}
                onSelectCampanha={campanhasAttach.onSelectCampanha}
                onAddToCampanha={() => campanhasAttach.attach(lead.id)}
                isAdding={campanhasAttach.isAttaching}
                hasStages={campanhasAttach.hasStages}
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
