import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { Aviso } from "../lib/aviso-stream";

/**
 * Avisos da org inteira — o sino em visão "Todos" (flag `visao_meu_todos`).
 *
 * Lê `avisos_visao_geral`, que só responde a admin da org com a flag: um
 * evento que avisou N pessoas chega como UMA linha, com quem recebeu em
 * `destinatarios`. Só leitura — o lido segue sendo de quem recebeu, por isso
 * esta lista não marca nada.
 *
 * Sem tempo real de propósito: o canal de Avisos é endereçado ao próprio
 * usuário (RLS por `user_id`). A visão geral relê ao abrir o sino e a cada
 * minuto com ele aberto.
 */
export interface AvisoDaOrg extends Aviso {
  destinatarios: string[];
}

const TETO = 50;
const RELEITURA_MS = 60_000;

/** `types.ts` vem de PROD e só conhece a função depois do apply + gen types. */
type RpcNaoTipada = (
  nome: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export function useAvisosVisaoGeral({ enabled }: { enabled: boolean }) {
  const { organizationId, isReady } = useOrganization();
  const habilitado = enabled && isReady && !!organizationId;

  return useQuery({
    queryKey: ["avisos-visao-geral", organizationId],
    enabled: habilitado,
    queryFn: async (): Promise<AvisoDaOrg[]> => {
      const rpc = supabase.rpc.bind(supabase) as unknown as RpcNaoTipada;
      const { data, error } = await rpc("avisos_visao_geral", {
        p_organization_id: organizationId,
        p_limit: TETO,
      });
      if (error) throw error;
      return ((data ?? []) as AvisoDaOrg[]).map((a) => ({ ...a, destinatarios: a.destinatarios ?? [] }));
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: habilitado ? RELEITURA_MS : false,
    refetchIntervalInBackground: false,
  });
}
