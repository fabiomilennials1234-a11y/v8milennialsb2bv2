/**
 * A sessão de voz da organização — o número pelo qual as chamadas saem.
 *
 * Devolve `null` enquanto não houver uma sessão `open`. Isso é o normal, não é
 * erro: a feature nasce desligada e a maioria das organizações nunca vai parear
 * um número de voz. A UI usa este `null` para NÃO mostrar o botão de ligar, em
 * vez de mostrar um botão que sempre falha.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

export interface VoipSession {
  tc_session_id: string;
  name: string | null;
  jid: string | null;
  status: string;
}

export function useVoipSession() {
  const { organizationId } = useOrganization();

  return useQuery<VoipSession | null>({
    queryKey: ["voip_session", organizationId],
    enabled: !!organizationId,
    // A sessão muda de estado por pareamento e por queda de conexão, não por
    // interação da tela. Recarregar a cada foco só geraria consulta.
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("voip_sessions")
        .select("tc_session_id, name, jid, status")
        .eq("organization_id", organizationId!)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();

      if (error) {
        // RLS devolve vazio para quem não pode ver; erro aqui é infraestrutura.
        // Tratar como "sem voz" mantém a tela funcionando sem o botão.
        return null;
      }
      return (data as VoipSession | null) ?? null;
    },
  });
}
