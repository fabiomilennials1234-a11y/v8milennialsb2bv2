import { memo } from "react";
import { LeadIdentityBlock } from "./LeadIdentityBlock";
import { LeadActionsBlock } from "./LeadActionsBlock";
import type { MoveStagePipeData } from "./MoveStageButton";
import type { DrawerVariant } from "../../hooks/useLeadSheet";
import type { QualificationTier } from "../types";

interface LeadModalHeaderProps {
  lead: {
    id: string;
    organization_id: string;
    name?: string | null;
    company?: string | null;
    phone?: string | null;
    avatar_url?: string | null;
    created_at?: string | null;
    pre_sale_responsible?: { id: string; name: string; avatar_url?: string | null } | null;
    sale_responsible?: { id: string; name: string; avatar_url?: string | null } | null;
    pre_qualification_tier?: QualificationTier | null;
    qualification_tier?: QualificationTier | null;
  };
  variant: DrawerVariant;
  pipeData: MoveStagePipeData | null;
}

export const LeadModalHeader = memo(function LeadModalHeader({
  lead,
  variant,
  pipeData,
}: LeadModalHeaderProps) {
  return (
    <div className="pl-6 pr-14 py-5 border-b border-border/40 bg-gradient-to-br from-primary/[0.03] via-transparent to-transparent">
      <div className="flex items-start gap-6">
        <LeadIdentityBlock lead={lead} />
        <div className="h-20 w-px bg-border/40 shrink-0 self-center" aria-hidden />
        <LeadActionsBlock
          leadId={lead.id}
          organizationId={lead.organization_id}
          variant={variant}
          pipeData={pipeData}
          preSaleResponsible={lead.pre_sale_responsible ?? null}
          saleResponsible={lead.sale_responsible ?? null}
          preQualificationTier={lead.pre_qualification_tier ?? null}
          qualificationTier={lead.qualification_tier ?? null}
        />
      </div>
    </div>
  );
});
