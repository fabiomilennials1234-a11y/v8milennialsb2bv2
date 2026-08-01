import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

export interface VoipSession {
  tcSessionId: string;
  name: string | null;
  jid: string | null;
  status: string;
  whatsappInstanceId: string;
}

/**
 * Todas as sessões de voz da organização.
 *
 * `useCallableVoiceNumbers` devolve só os números por onde o vendedor logado
 * pode ligar — sessão `open`, voz ligada e instância ao alcance dele. A tela de
 * integração precisa do resto também: uma sessão `pending` é justamente a que
 * está esperando o QR ser escaneado, e sumir com ela deixaria o cliente sem
 * saber o que aconteceu.
 */
export function useVoipSessions() {
  const { organizationId } = useOrganization();

  return useQuery<VoipSession[]>({
    queryKey: ["voip_sessions", organizationId],
    enabled: !!organizationId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("voip_sessions")
        .select("tc_session_id, name, jid, status, whatsapp_instance_id")
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: true });

      if (error) throw error;

      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        tcSessionId: r.tc_session_id as string,
        name: (r.name as string) ?? null,
        jid: (r.jid as string) ?? null,
        status: r.status as string,
        whatsappInstanceId: r.whatsapp_instance_id as string,
      }));
    },
  });
}

/**
 * Quantos números de voz esta organização pode ter. A tela precisa disso para
 * mostrar o teto ANTES de o cliente esbarrar num 409.
 *
 * O teto mora aqui e não em `useOrganization` porque aquele contexto não
 * expõe o objeto da organização — só `organizationId`, `role`, `orgType` e
 * `timezone`.
 */
export function useVoiceSessionsCap() {
  const { organizationId } = useOrganization();

  return useQuery<number>({
    queryKey: ["voice_sessions_cap", organizationId],
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("organizations")
        .select("voice_sessions_cap")
        .eq("id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      // Mesmo default da coluna. Ausência de linha não deve virar teto zero,
      // que trancaria a tela inteira por um erro de leitura.
      return (data?.voice_sessions_cap as number | undefined) ?? 10;
    },
  });
}
