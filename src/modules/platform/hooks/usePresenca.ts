/**
 * "Tem alguém olhando agora."
 *
 * O push só sai para quem NÃO está com o CRM na frente — repetir no bolso o que
 * a pessoa está lendo na tela é o caminho mais curto para ela desligar tudo.
 * Descobrir isso exige um sinal que só o navegador tem.
 *
 * Não serve `auth.sessions` (sobrevive à aba fechada) nem a conexão de realtime
 * (sobrevive à aba escondida). O sinal é a visibilidade da aba, carimbada a
 * cada minuto — barato o bastante para ser contínuo, curto o bastante para o
 * push de 2 minutos confiar nele.
 */

import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth, useOrganization } from "@/modules/identity";

const INTERVALO_MS = 60_000;

/**
 * types.ts é gerado de PROD e ainda não conhece fn_registrar_presenca — a
 * função nasce na migration desta entrega. Regenerar os tipos depois do deploy
 * dispensa esta ponte.
 */
type ClienteComPresenca = {
  rpc: (
    fn: "fn_registrar_presenca",
    args: { p_organization_id: string },
  ) => Promise<{ error: { message: string } | null }>;
};

export function usePresenca(): void {
  const { user } = useAuth();
  const { organizationId } = useOrganization();

  useEffect(() => {
    if (!user?.id || !organizationId) return;

    let vivo = true;

    const carimbar = () => {
      if (!vivo) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      // `void builder` NÃO dispara requisição: o construtor do PostgREST é
      // preguiçoso — o fetch acontece dentro do `then`. A primeira versão disto
      // nunca chamou o servidor, e a tabela de presença ficou vazia em produção
      // com 90 leituras do sino no mesmo minuto. Precisa de `.then`.
      void (supabase as unknown as ClienteComPresenca)
        .rpc("fn_registrar_presenca", { p_organization_id: organizationId })
        .then(
          () => undefined,
          () => undefined,
        );
    };

    carimbar();
    const id = window.setInterval(carimbar, INTERVALO_MS);
    // Voltar para a aba carimba na hora: esperar até um minuto para "existir"
    // deixaria o push sair para quem acabou de voltar.
    document.addEventListener("visibilitychange", carimbar);

    return () => {
      vivo = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", carimbar);
    };
  }, [organizationId, user?.id]);
}
