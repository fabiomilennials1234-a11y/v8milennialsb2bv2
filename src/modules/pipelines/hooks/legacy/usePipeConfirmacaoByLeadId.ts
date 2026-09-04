import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type PipeConfirmacaoRow = Tables<"pipe_confirmacao">;

/**
 * Fetch the lead's most recent entrada do funil de Confirmação (or null when the
 * lead isn't in it yet).
 *
 * Lê da projeção canônica `negocio_projetado` (funil_sistema = "confirmacao"),
 * que substitui o espelho pipe_confirmacao.
 *
 * O consumidor (`MeetingFieldBlock`) lê `pipeData.status`. Na projeção essa
 * coluna chama `stage_key`, então o alias do PostgREST devolve as duas — sem o
 * alias, `status` vem `undefined`, o select de etapa cai no default
 * "reuniao_marcada", `dirty` fica preso em true e o Salvar REBAIXA a etapa do
 * card no banco sem o usuário ter tocado no campo.
 */
export function usePipeConfirmacaoByLeadId(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ["pipe_confirmacao_by_lead", leadId],
    enabled: !!leadId,
    staleTime: 30_000,
    queryFn: async (): Promise<PipeConfirmacaoRow | null> => {
      if (!leadId) return null;
      const { data, error } = await supabase
        .from("negocio_projetado")
        .select("*, status:stage_key")
        .eq("funil_sistema", "confirmacao")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as PipeConfirmacaoRow | null) ?? null;
    },
  });
}
