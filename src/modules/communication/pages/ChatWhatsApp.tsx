import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { ChatShellWithContext } from "@/modules/communication/components/chat/ChatShellWithContext";
import { useOrganization } from "@/modules/identity";
import { trackModuleVisit } from "@/lib/analytics";
import { marcadorDeAbrirConversa } from "@/modules/platform/lib/abrir-aviso";

/**
 * O Coach IA (`CoachingSidebar`) saiu desta tela — decisão do CTO, 02/10: ele
 * abria sempre vazio, porque a conversa ativa nunca chegava até ele
 * (`conversationId` ficava `null`). Volta quando estiver ligado à conversa
 * aberta; o componente continua em `engagement/components/ai/`.
 */
export default function ChatWhatsApp() {
  const { organizationId } = useOrganization();
  const location = useLocation();

  useEffect(() => { trackModuleVisit("chat_whatsapp", organizationId); }, [organizationId]);

  // Clique em aviso com o chat já aberto (`navegarParaAviso`): marcador novo =
  // shell novo, que relê `?instance=&phone=`. A chave sai no RENDER, não num
  // efeito: os efeitos do shell rodam antes dos desta página, e o shell antigo
  // limparia os params novos da URL antes de ser trocado. Params limpos (state
  // some no `replace`) não remontam: só marcador NOVO conta.
  const marcador = marcadorDeAbrirConversa(location.state);
  const ultimoMarcador = useRef(marcador);
  const montagem = useRef(0);
  if (marcador !== undefined && marcador !== ultimoMarcador.current) {
    ultimoMarcador.current = marcador;
    montagem.current += 1;
  }

  // V5: a rota é full-bleed (sem padding do <main>). O respiro de 12 px no
  // desktop é o mesmo da lateral flutuante — as colunas do chat ficam
  // alinhadas com ela, pousadas na bancada.
  return (
    <div className="flex flex-1 min-h-0 p-2 md:p-3">
      <div className="flex flex-col flex-1 min-w-0">
        <ChatShellWithContext key={montagem.current} />
      </div>
    </div>
  );
}
