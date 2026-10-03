import { memo } from "react";
import { Separator } from "@/components/ui/separator";
import { InfoBlockFilled } from "./InfoBlockFilled";
import { InfoBlockMissing } from "./InfoBlockMissing";
import { InfoBlockTracking } from "./InfoBlockTracking";
import { LeadCustomFieldsBlock } from "./LeadCustomFieldsBlock";
import { useLeadActionGates } from "../../hooks/useLeadActionGates";

interface LeadInfoColumnProps {
  lead: Record<string, unknown> & { id: string };
}

export const LeadInfoColumn = memo(function LeadInfoColumn({ lead }: LeadInfoColumnProps) {
  const gates = useLeadActionGates(lead.id);
  return (
    <div className="px-6 py-5 space-y-6">
      <InfoBlockFilled lead={lead as Parameters<typeof InfoBlockFilled>[0]["lead"]} />
      <Separator className="bg-border/60" />
      <LeadCustomFieldsBlock leadId={lead.id} editable={gates.canEditField.allowed} />
      <Separator className="bg-border/60" />
      <InfoBlockMissing lead={lead} />
      <Separator className="bg-border/60" />
      <InfoBlockTracking lead={lead} />
    </div>
  );
});
