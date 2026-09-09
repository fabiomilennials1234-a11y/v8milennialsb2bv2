import { memo, useCallback, useState } from "react";
import { X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useViewport } from "@/shared/hooks/use-viewport";
import { useOnlineStatus } from "@/modules/platform/hooks/useOnlineStatus";
import { useLeadSheet } from "../hooks/useLeadSheet";
import { useLeadDetail } from "../hooks/useLeadDetail";
import { useLeadDetailRealtime } from "../hooks/useLeadDetailRealtime";
import { useToggleLeadAI, useDeleteLead } from "../../../hooks/useLeads";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { toast } from "sonner";
import { LeadModalHeader } from "./header/LeadModalHeader";
import { LeadModalToolbar } from "./LeadModalToolbar";
import { LeadInfoColumn } from "./body/LeadInfoColumn";
import { LeadActivityColumn } from "./activity/LeadActivityColumn";
import { CrossPipePanel } from "./pipes/CrossPipePanel";
import { LeadModalSkeleton } from "./LeadModalSkeleton";
import { LeadVisibilityState } from "./LeadVisibilityState";
import { LeadDetailBanners } from "./LeadDetailBanners";
import { useAuth } from "@/modules/identity";
import { ScheduleMessageModal } from "@/modules/communication/components/chat/ScheduleMessageModal";
import { LogCallModal } from "@/modules/engagement/components/calls/LogCallModal";
import { EmailComposer } from "@/modules/communication/components/email/EmailComposer";
import { SmsSendDialog } from "@/modules/communication/components/sms/SmsSendDialog";
import { AiEmailWriter } from "@/modules/communication/components/ai/AiEmailWriter";
import { cn } from "@/lib/utils";
import type { QualificationTier } from "./types";

interface LeadDetailDialogProps {
  /** Renderiza side modais quando o conteúdo principal está aberto. */
  children?: never;
}

function LeadDetailContent({ onClose, isMobile }: { onClose: () => void; isMobile: boolean }) {
  const { leadId, defaultExpandedPipeEntryId } = useLeadSheet();
  const { lead, isLoading, visibility, metadata, isFetching, failureCount } = useLeadDetail(leadId, true);
  const isOnline = useOnlineStatus();
  useLeadDetailRealtime(leadId, true, lead?.organization_id ?? null);
  const { user } = useAuth();
  // PRD #284 #314 — default tab por contexto de abertura:
  // origem kanban (pipeData via defaultExpandedPipeEntryId) → "pipes"; senão "info".
  const [mobileTab, setMobileTab] = useState<string>(
    defaultExpandedPipeEntryId ? "pipes" : "info",
  );
  const toggleAI = useToggleLeadAI();
  const deleteLead = useDeleteLead();
  const logAction = useLogLeadAction();

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [emailWriterOpen, setEmailWriterOpen] = useState(false);
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [optimisticAi, setOptimisticAi] = useState<boolean | null>(null);

  const aiDisabled = optimisticAi !== null ? optimisticAi : Boolean(lead?.ai_disabled);

  const handleToggleAI = useCallback((enabled: boolean) => {
    if (!lead) return;
    setOptimisticAi(!enabled);
    toggleAI.mutate(
      { leadId: lead.id, disabled: !enabled },
      {
        onSuccess: () => {
          logAction({
            leadId: lead.id,
            action: "ai_toggled",
            description: enabled ? "IA ativada" : "IA desativada",
          });
          toast.success(enabled ? "IA ativada" : "IA desativada");
        },
        onError: () => {
          setOptimisticAi(null);
          toast.error("Falha ao alternar IA");
        },
      }
    );
  }, [lead, toggleAI, logAction]);

  const handleDelete = useCallback(async () => {
    if (!lead) return;
    if (!window.confirm(`Excluir "${lead.name}"? Ação irreversível.`)) return;
    try {
      await logAction({
        leadId: lead.id,
        action: "lead_deleted",
        description: `Lead "${lead.name}" excluído`,
        tier: 1,
        metadata: { lead_name: lead.name },
      });
      await deleteLead.mutateAsync(lead.id);
      toast.success("Lead excluído");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao excluir";
      toast.error(msg);
    }
  }, [lead, deleteLead, logAction, onClose]);

  if (visibility === "loading" || isLoading) {
    return <LeadModalSkeleton />;
  }

  if (visibility !== "exists" || !lead) {
    return (
      <div className="flex flex-col h-full relative">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute right-3 top-3 h-8 w-8 z-10 rounded-full hover:bg-muted"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </Button>
        <LeadVisibilityState
          visibility={visibility === "exists" ? "not_found" : visibility}
          metadata={metadata}
          onClose={onClose}
        />
      </div>
    );
  }

  const leadAny = lead as any;
  const leadForHeader = {
    id: lead.id,
    organization_id: lead.organization_id ?? "",
    name: lead.name,
    // Só o cabeçalho recebe o código; `lead.name` segue limpo para os
    // `leadName` de mensagem/agendamento logo abaixo.
    erp_code: leadAny.erp_code ?? null,
    company: lead.company,
    phone: lead.phone,
    avatar_url: leadAny.avatar_url ?? null,
    created_at: lead.created_at,
    pre_sale_responsible: leadAny.pre_sale_responsible ?? null,
    sale_responsible:     leadAny.sale_responsible ?? null,
    pre_qualification_tier: (leadAny.pre_qualification_tier ?? null) as QualificationTier | null,
    qualification_tier:     (leadAny.qualification_tier ?? null) as QualificationTier | null,
  };

  const headerBlock = (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="absolute right-3 top-3 h-8 w-8 z-10 rounded-full hover:bg-muted"
        aria-label="Fechar"
      >
        <X className="w-4 h-4" />
      </Button>

      <LeadDetailBanners
        isOnline={isOnline}
        isFetching={isFetching}
        failureCount={failureCount}
      />

      <LeadModalHeader lead={leadForHeader} />

      <fieldset
        disabled={!isOnline}
        className="contents"
        aria-disabled={!isOnline}
      >
        <LeadModalToolbar
          lead={{
            id: lead.id,
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
            responsible_id: lead.responsible_id,
          }}
          aiDisabled={aiDisabled}
          onToggleAI={handleToggleAI}
          onOpenCallModal={() => setCallOpen(true)}
          onOpenEmailComposer={() => setEmailComposerOpen(true)}
          onOpenEmailWriter={() => setEmailWriterOpen(true)}
          onOpenScheduleModal={() => setScheduleOpen(true)}
          onOpenSmsDialog={() => setSmsOpen(true)}
          onDelete={handleDelete}
          onClose={onClose}
        />
      </fieldset>
    </>
  );

  const subModals = (
    <>
      {scheduleOpen && lead.phone && (
        <ScheduleMessageModal
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          leadId={lead.id}
          leadName={lead.name}
          phoneNumber={lead.phone}
        />
      )}
      {callOpen && (
        <LogCallModal
          open={callOpen}
          onOpenChange={setCallOpen}
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
      {smsOpen && lead.phone && (
        <SmsSendDialog
          open={smsOpen}
          onOpenChange={setSmsOpen}
          leadId={lead.id}
          phoneNumber={lead.phone}
          leadName={lead.name}
        />
      )}
    </>
  );

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {headerBlock}

      {isMobile ? (
        <Tabs value={mobileTab} onValueChange={setMobileTab} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-3 mt-2 grid grid-cols-3" data-testid="lead-modal-mobile-tabs">
            <TabsTrigger value="info" data-testid="tab-info">Info</TabsTrigger>
            <TabsTrigger value="pipes" data-testid="tab-pipes">Negócios</TabsTrigger>
            <TabsTrigger value="atividade" data-testid="tab-atividade">Atividade</TabsTrigger>
          </TabsList>
          <TabsContent value="info" className="flex-1 min-h-0 overflow-y-auto m-0">
            <LeadInfoColumn lead={lead as Record<string, unknown> & { id: string }} />
          </TabsContent>
          <TabsContent value="pipes" className="flex-1 min-h-0 overflow-y-auto m-0 px-4 pt-4">
            <CrossPipePanel
              leadId={lead.id}
              organizationId={lead.organization_id ?? ""}
              defaultExpandedPipeEntryId={defaultExpandedPipeEntryId}
              userId={user?.id ?? null}
            />
          </TabsContent>
          <TabsContent value="atividade" className="flex-1 min-h-0 m-0 flex flex-col">
            <LeadActivityColumn leadId={lead.id} organizationId={lead.organization_id ?? ""} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="grid grid-cols-12 flex-1 min-h-0">
          <div className="col-span-12 md:col-span-7 min-h-0 overflow-y-auto">
            <div className="px-6 pt-5">
              <CrossPipePanel
                leadId={lead.id}
                organizationId={lead.organization_id ?? ""}
                defaultExpandedPipeEntryId={defaultExpandedPipeEntryId}
                userId={user?.id ?? null}
              />
            </div>
            <LeadInfoColumn lead={lead as Record<string, unknown> & { id: string }} />
          </div>
          <div className="col-span-12 md:col-span-5 min-h-0 overflow-y-auto">
            <LeadActivityColumn leadId={lead.id} organizationId={lead.organization_id ?? ""} />
          </div>
        </div>
      )}

      {subModals}
    </div>
  );
}

export const LeadDetailDialogV2 = memo(function LeadDetailDialogV2(_props: LeadDetailDialogProps) {
  const { isOpen, close } = useLeadSheet();
  const { isMobile } = useViewport();

  if (!isOpen) return null;

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
        <SheetContent
          side="bottom"
          className="h-[90vh] p-0 overflow-hidden flex flex-col rounded-t-2xl"
          aria-describedby={undefined}
        >
          <LeadDetailContent onClose={close} isMobile={isMobile} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-sm bg-black/60" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%]",
            "w-[min(1440px,calc(100vw-32px))] h-[min(940px,calc(100vh-32px))]",
            "rounded-2xl border border-border/50 bg-card shadow-2xl overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "duration-200"
          )}
        >
          <DialogPrimitive.Title className="sr-only">Detalhes do lead</DialogPrimitive.Title>
          <LeadDetailContent onClose={close} isMobile={isMobile} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
});
