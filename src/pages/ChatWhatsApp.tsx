import { useEffect } from "react";
import { featureFlags } from "@/lib/feature-flags";
import { WhatsAppChat } from "@/components/chat/WhatsAppChat";
import { ChatShellWithContext } from "@/components/chat/ChatShellWithContext";
import { useOrganization } from "@/hooks/useOrganization";
import { trackModuleVisit } from "@/lib/analytics";

export default function ChatWhatsApp() {
  const { organizationId } = useOrganization();
  useEffect(() => { trackModuleVisit("chat_whatsapp", organizationId); }, [organizationId]);

  if (featureFlags.chatOnda2b) {
    return (
      <div className="flex flex-col flex-1 min-h-0 h-full p-2">
        <ChatShellWithContext />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <WhatsAppChat />
    </div>
  );
}
