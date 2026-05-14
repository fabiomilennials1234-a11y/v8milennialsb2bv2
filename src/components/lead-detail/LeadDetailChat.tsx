import { memo } from "react";
import { ConversationHistoryTab } from "@/components/leads/ConversationHistoryTab";

interface LeadDetailChatProps {
  leadId: string;
  leadName: string;
  leadPhone: string | null;
}

export const LeadDetailChat = memo(function LeadDetailChat({ leadId, leadName, leadPhone }: LeadDetailChatProps) {
  return (
    <div className="h-[500px]">
      <ConversationHistoryTab leadId={leadId} leadName={leadName} leadPhone={leadPhone} />
    </div>
  );
});
