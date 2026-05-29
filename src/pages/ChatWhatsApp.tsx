import { useEffect } from "react";
import { ChatShellWithContext } from "@/components/chat/ChatShellWithContext";
import { useOrganization } from "@/hooks/useOrganization";
import { trackModuleVisit } from "@/lib/analytics";

export default function ChatWhatsApp() {
  const { organizationId } = useOrganization();

  useEffect(() => { trackModuleVisit("chat_whatsapp", organizationId); }, [organizationId]);

  return (
    <div className="flex flex-1 min-h-0 p-2">
      <div className="flex flex-col flex-1 min-w-0">
        <ChatShellWithContext />
      </div>
    </div>
  );
}
