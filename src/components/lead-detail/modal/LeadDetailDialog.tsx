import { memo, useCallback, useState } from "react";
import { X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLeadSheet } from "../hooks/useLeadSheet";
import { useLeadDetail } from "../hooks/useLeadDetail";
import { useToggleLeadAI, useDeleteLead } from "@/hooks/useLeads";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { toast } from "sonner";
import { LeadModalHeader } from "./header/LeadModalHeader";
import { LeadModalToolbar } from "./LeadModalToolbar";
import { LeadInfoColumn } from "./body/LeadInfoColumn";
import { LeadActivityColumn } from "./activity/LeadActivityColumn";
import { MeetingFieldBlock } from "../cross-pipe/MeetingFieldBlock";
import { BudgetFieldBlock } from "../cross-pipe/BudgetFieldBlock";
import { usePipeConfirmacaoByLeadId } from "@/hooks/usePipeConfirmacaoByLeadId";
import { usePipePropostaByLeadId } from "@/hooks/usePipePropostaByLeadId";
import { ScheduleMessageModal } from "@/components/chat/ScheduleMessageModal";
import { LogCallModal } from "@/components/calls/LogCallModal";
import { EmailComposer } from "@/components/email/EmailComposer";
import { SmsSendDialog } from "@/components/sms/SmsSendDialog";
import { AiEmailWriter } from "@/components/ai/AiEmailWriter";
import { cn } from "@/lib/utils";
import type { QualificationTier } from "./types";

interface LeadDetailDialogProps {
  /** Renderiza side modais quando o conteúdo principal está aberto. */
  children?: never;
}

function LeadDetailContent({ onClose }: { onClose: () => void }) {
  const { leadId, variant, pipeData } = useLeadSheet();
  const { lead, isLoading } = useLeadDetail(leadId, true);
  const { data: confirmacaoData } = usePipeConfirmacaoByLeadId(leadId);
  const { data: propostaData } = usePipePropostaByLeadId(leadId);
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
      await deleteLead.mutateAsync(lead.id);
      toast.success("Lead excluído");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao excluir";
      toast.error(msg);
    }
  }, [lead, deleteLead, onClose]);

  if (isLoading || !lead) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-6 space-y-4 border-b border-border/40">
          <Skeleton className="h-14 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }

  const leadAny = lead as any;
  // Adapta tipos esperados pelos componentes (tier columns ainda fora do types.ts)
  const leadForHeader = {
    id: lead.id,
    organization_id: lead.organization_id ?? "",
    name: lead.name,
    company: lead.company,
    phone: lead.phone,
    avatar_url: leadAny.avatar_url ?? null,
    created_at: lead.created_at,
    pre_sale_responsible: leadAny.pre_sale_responsible ?? null,
    sale_responsible:     leadAny.sale_responsible ?? null,
    pre_qualification_tier: (leadAny.pre_qualification_tier ?? null) as QualificationTier | null,
    qualification_tier:     (leadAny.qualification_tier ?? null) as QualificationTier | null,
  };

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {/* Close button absoluto top-right */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="absolute right-3 top-3 h-8 w-8 z-10 rounded-full hover:bg-muted"
        aria-label="Fechar"
      >
        <X className="w-4 h-4" />
      </Button>

      <LeadModalHeader lead={leadForHeader} variant={variant} pipeData={pipeData} />

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

      <div className="grid grid-cols-12 flex-1 min-h-0">
        <div className="col-span-12 md:col-span-7 min-h-0 flex flex-col overflow-y-auto">
          <div className="px-6 pt-5 space-y-3">
            <MeetingFieldBlock
              leadId={lead.id}
              organizationId={lead.organization_id ?? ""}
              pipeData={confirmacaoData ?? null}
              locked={false}
            />
            <BudgetFieldBlock
              leadId={lead.id}
              organizationId={lead.organization_id ?? ""}
              pipeData={propostaData ?? null}
              locked={false}
            />
          </div>
          <LeadInfoColumn lead={lead as Record<string, unknown> & { id: string }} />
        </div>
        <div className="col-span-12 md:col-span-5 min-h-0 flex flex-col">
          <LeadActivityColumn leadId={lead.id} organizationId={lead.organization_id ?? ""} />
        </div>
      </div>

      {/* Sub-modais */}
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
    </div>
  );
}

export const LeadDetailDialog = memo(function LeadDetailDialog(_props: LeadDetailDialogProps) {
  const { isOpen, close } = useLeadSheet();
  const isMobile = useIsMobile();

  if (!isOpen) return null;

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
        <SheetContent
          side="bottom"
          className="h-[95vh] p-0 overflow-hidden flex flex-col"
          aria-describedby={undefined}
        >
          <LeadDetailContent onClose={close} />
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
          <LeadDetailContent onClose={close} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
});
