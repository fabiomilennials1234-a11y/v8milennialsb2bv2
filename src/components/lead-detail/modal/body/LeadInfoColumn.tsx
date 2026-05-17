import { memo } from "react";
import { Separator } from "@/components/ui/separator";
import { InfoBlockFilled } from "./InfoBlockFilled";
import { InfoBlockMissing } from "./InfoBlockMissing";
import { InfoBlockTracking } from "./InfoBlockTracking";

interface LeadInfoColumnProps {
  lead: Record<string, unknown> & { id: string };
}

export const LeadInfoColumn = memo(function LeadInfoColumn({ lead }: LeadInfoColumnProps) {
  return (
    <div className="overflow-y-auto px-6 py-5 space-y-6 min-h-0">
      <InfoBlockFilled lead={lead as Parameters<typeof InfoBlockFilled>[0]["lead"]} />
      <Separator className="opacity-30" />
      <InfoBlockMissing lead={lead} />
      <Separator className="opacity-30" />
      <InfoBlockTracking lead={lead} />
    </div>
  );
});
