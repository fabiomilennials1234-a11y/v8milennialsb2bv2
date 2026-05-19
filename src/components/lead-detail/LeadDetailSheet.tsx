import { memo, useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeadSheet } from "./hooks/useLeadSheet";
import { useLeadDetail } from "./hooks/useLeadDetail";
import type { DrawerVariant } from "./legacy/drawer-variant";
import { useToggleLeadAI, useDeleteLead } from "@/hooks/useLeads";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LeadDetailHeader } from "./LeadDetailHeader";
import { LeadDetailProperties } from "./LeadDetailProperties";
import { LeadDetailFocus } from "./LeadDetailFocus";
import { LeadDetailFunnelContext } from "./LeadDetailFunnelContext";
import { LeadDetailTimeline } from "./LeadDetailTimeline";
import { LeadDetailNotes } from "./LeadDetailNotes";
import { ScheduleMessageModal } from "@/components/chat/ScheduleMessageModal";
import { LogCallModal } from "@/components/calls/LogCallModal";
import { EmailComposer } from "@/components/email/EmailComposer";
import { SmsSendDialog } from "@/components/sms/SmsSendDialog";
import { AiEmailWriter } from "@/components/ai/AiEmailWriter";
import { toast } from "sonner";
import { useToast } from "@/hooks/use-toast";

export const LeadDetailSheet = memo(function LeadDetailSheet() {
  const { isOpen, leadId, close } = useLeadSheet();
  // Legacy modal — pre-#300 DrawerVariant payload no longer travels through
  // the context. The legacy sheet renders the generic "leads" view; pipe-
  // specific behaviors live exclusively in CrossPipePanel (V2).
  const variant: DrawerVariant = "leads";
  const pipeData: { id?: string; stage_id?: string } | null = null;
  const { lead, isLoading, pipelineData } = useLeadDetail(leadId, isOpen);
  const toggleAIMutation = useToggleLeadAI();
  const deleteLead = useDeleteLead();
  const logAction = useLogLeadAction();
  const { toast: hookToast } = useToast();

  const [activeTab, setActiveTab] = useState("atividade");
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [emailWriterOpen, setEmailWriterOpen] = useState(false);
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);
  const [optimisticAiDisabled, setOptimisticAiDisabled] = useState<boolean | null>(null);

  // Fetch pipeline stages for progress bar
  const { data: stages = [] } = useQuery({
    queryKey: ["pipeline-stages-for-variant", variant, lead?.organization_id],
    queryFn: async () => {
      if (!lead?.organization_id) return [];
      if (variant === "whatsapp") {
        const { data } = await supabase
          .from("pipeline_stages")
          .select("id, name")
          .eq("organization_id", lead.organization_id)
          .eq("pipe_type", "whatsapp")
          .order("position");
        return data || [];
      }
      return [];
    },
    enabled: !!lead?.organization_id && isOpen,
  });

  const currentStageId = (() => {
    if (variant === "whatsapp" && pipeData?.stage_id) return pipeData.stage_id as string;
    return null;
  })();

  const currentAiDisabled =
    optimisticAiDisabled !== null ? optimisticAiDisabled : (lead?.ai_disabled ?? false);

  const handleToggleAI = useCallback(
    (enabled: boolean) => {
      if (!lead) return;
      setOptimisticAiDisabled(!enabled);
      toggleAIMutation.mutate(
        { leadId: lead.id, disabled: !enabled },
        {
          onSuccess: () => {
            logAction({
              leadId: lead.id,
              action: "ai_toggled",
              description: enabled ? "IA ativada" : "IA desativada",
            });
            hookToast({ title: enabled ? "IA ativada" : "IA desativada" });
          },
          onError: () => {
            hookToast({
              title: "Erro",
              description: "Não foi possível alterar IA.",
              variant: "destructive",
            });
            setOptimisticAiDisabled(null);
          },
        }
      );
    },
    [lead, toggleAIMutation, logAction, hookToast]
  );

  const handleDelete = useCallback(async () => {
    if (!lead) return;
    const confirmed = window.confirm(`Excluir "${lead.name}"? Ação irreversível.`);
    if (!confirmed) return;
    try {
      await deleteLead.mutateAsync(lead.id);
      toast.success("Lead excluído!");
      close();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro ao excluir lead";
      toast.error(msg);
    }
  }, [lead, deleteLead, close]);

  if (!isOpen) return null;

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-5 space-y-3 border-b border-border">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="flex-1 p-4">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }

  if (!lead) return null;

  return (
    <div className="flex flex-col h-full">
      <LeadDetailHeader
        lead={lead}
        variant={variant}
        stages={stages}
        currentStageId={currentStageId}
        currentAiDisabled={currentAiDisabled}
        onToggleAI={handleToggleAI}
        onClose={close}
        onOpenScheduleModal={() => setScheduleModalOpen(true)}
        onOpenCallModal={() => setCallModalOpen(true)}
        onOpenEmailWriter={() => setEmailWriterOpen(true)}
        onOpenEmailComposer={() => setEmailComposerOpen(true)}
        onOpenSmsDialog={() => setSmsDialogOpen(true)}
        onDelete={handleDelete}
      />

      <div className="flex flex-1 min-h-0">
        {/* Left: Properties */}
        <LeadDetailProperties lead={lead} pipelineData={pipelineData} />

        {/* Right: Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-w-0">
          <LeadDetailFocus leadId={lead.id} />
          <LeadDetailFunnelContext lead={lead} variant={variant} pipeData={pipeData} />

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="h-9 p-0.5 bg-muted/50 mb-4 w-full">
              <TabsTrigger value="atividade" className="text-xs flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                Atividade
              </TabsTrigger>
              <TabsTrigger value="notas" className="text-xs flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                Notas
              </TabsTrigger>
            </TabsList>
            <TabsContent value="atividade" className="m-0">
              <LeadDetailTimeline leadId={lead.id} />
            </TabsContent>
            <TabsContent value="notas" className="m-0">
              <LeadDetailNotes
                leadId={lead.id}
                organizationId={lead.organization_id}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Modals */}
      {lead.phone && scheduleModalOpen && (
        <ScheduleMessageModal
          open={scheduleModalOpen}
          onOpenChange={setScheduleModalOpen}
          leadId={lead.id}
          leadName={lead.name}
          phoneNumber={lead.phone}
        />
      )}
      {callModalOpen && (
        <LogCallModal
          open={callModalOpen}
          onOpenChange={setCallModalOpen}
          leadId={lead.id}
          leadName={lead.name}
        />
      )}
      {emailWriterOpen && (
        <AiEmailWriter
          open={emailWriterOpen}
          onOpenChange={setEmailWriterOpen}
          leadId={lead.id}
          leadName={lead.name}
        />
      )}
      {emailComposerOpen && lead.email && (
        <EmailComposer
          defaultTo={lead.email}
          leadId={lead.id}
          compact
          onClose={() => setEmailComposerOpen(false)}
          onSent={() => setEmailComposerOpen(false)}
        />
      )}
      {smsDialogOpen && lead.phone && (
        <SmsSendDialog
          open={smsDialogOpen}
          onOpenChange={setSmsDialogOpen}
          leadId={lead.id}
          phoneNumber={lead.phone}
          leadName={lead.name}
        />
      )}
    </div>
  );
});
