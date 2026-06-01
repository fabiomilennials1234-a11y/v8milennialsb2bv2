import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { ChatShellWithContext } from "@/modules/communication/components/chat/ChatShellWithContext";
import { CoachingSidebar } from "@/modules/engagement/components/ai/CoachingSidebar";
import { useOrganization } from "@/modules/identity";
import { trackModuleVisit } from "@/lib/analytics";

export default function ChatWhatsApp() {
  const { organizationId } = useOrganization();
  const [coachingOpen, setCoachingOpen] = useState(false);
  // TODO: wire real conversationId from active chat selection
  const [activeConversationId] = useState<string | null>(null);

  useEffect(() => { trackModuleVisit("chat_whatsapp", organizationId); }, [organizationId]);

  return (
    <div className="flex flex-1 min-h-0 p-2">
      <div className="flex flex-col flex-1 min-w-0">
        <ChatShellWithContext />
      </div>
      <AnimatePresence>
        {coachingOpen && (
          <CoachingSidebar
            conversationId={activeConversationId}
            isOpen={coachingOpen}
            onToggle={() => setCoachingOpen(false)}
          />
        )}
      </AnimatePresence>
      {!coachingOpen && (
        <div className="shrink-0 flex items-start pt-3 pl-2">
          <CoachingSidebar
            conversationId={activeConversationId}
            isOpen={false}
            onToggle={() => setCoachingOpen(true)}
          />
        </div>
      )}
    </div>
  );
}
