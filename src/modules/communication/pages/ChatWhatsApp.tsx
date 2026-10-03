import { useEffect } from "react";
import { ChatShellWithContext } from "@/modules/communication/components/chat/ChatShellWithContext";
import { useOrganization } from "@/modules/identity";
import { trackModuleVisit } from "@/lib/analytics";

/**
 * O Coach IA (`CoachingSidebar`) saiu desta tela — decisão do CTO, 02/10: ele
 * abria sempre vazio, porque a conversa ativa nunca chegava até ele
 * (`conversationId` ficava `null`). Volta quando estiver ligado à conversa
 * aberta; o componente continua em `engagement/components/ai/`.
 */
export default function ChatWhatsApp() {
  const { organizationId } = useOrganization();

  useEffect(() => { trackModuleVisit("chat_whatsapp", organizationId); }, [organizationId]);

  // V5: a rota é full-bleed (sem padding do <main>). O respiro de 12 px no
  // desktop é o mesmo da lateral flutuante — as colunas do chat ficam
  // alinhadas com ela, pousadas na bancada.
  return (
    <div className="flex flex-1 min-h-0 p-2 md:p-3">
      <div className="flex flex-col flex-1 min-w-0">
        <ChatShellWithContext />
      </div>
    </div>
  );
}
