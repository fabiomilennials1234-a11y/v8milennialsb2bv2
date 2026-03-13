import { useEffect } from "react";
import { WhatsAppChat } from "@/components/chat/WhatsAppChat";
import { useOrganization } from "@/hooks/useOrganization";
import { trackModuleVisit } from "@/lib/analytics";

export default function ChatWhatsApp() {
  const { organizationId } = useOrganization();
  useEffect(() => { trackModuleVisit("chat_whatsapp", organizationId); }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <WhatsAppChat />
    </div>
  );
}
