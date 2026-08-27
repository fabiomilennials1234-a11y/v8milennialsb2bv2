import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AttachedLeadTag {
  id: string; // lead_tags.id
  tag_id: string;
  tag: {
    id: string;
    name: string;
    color: string | null;
  };
}

/**
 * ── AS ETIQUETAS DE UM LEAD SÃO LIDAS POR DOIS CACHES, NÃO UM ─────────────
 * Esta chave (`["lead-tags", id]`) é a de quem EDITA. Mas a maior parte das
 * telas nunca a consulta: elas leem `lead_tags` de carona no `SELECT` do lead,
 * dentro de `["lead-detail", id]` (`useLeadDetail.ts:70-85`) — é de lá que saem
 * as pílulas da coluna do painel do Negócio (`useLeadCardData.ts:328`), o
 * `lead.etiquetas` do card do Negócio (`useDealCardData.ts:310`), o bloco de
 * Etiquetas da ficha e o `InfoBlockFilled` do modal.
 *
 * Invalidar só `lead-tags` conserta a barra que a pessoa acabou de usar e deixa
 * todas as outras exibindo a lista velha até alguém dar F5 — dois números para
 * a mesma coisa na mesma tela. Por isso as duas mutações abaixo derrubam
 * `lead-detail` também.
 */

/**
 * Toda tela que desenha etiqueta de lead, num lugar só.
 *
 * Além dos dois caches acima, os QUADROS leem `lead_tags` de carona no select
 * da entrada (`pipeline_entries` para os funis do sistema, `custom_pipe_entries`
 * para os custom) e desenham as pílulas no card — que é, justamente, o card de
 * onde o painel do Negócio foi aberto. Sem estas duas linhas, etiquetar dentro
 * do painel deixa o card ATRÁS dele com a lista velha até o próximo refetch do
 * quadro. É o mesmo conjunto que `useBulkTag` já invalida (`useBulkActions.ts`).
 */
function invalidarEtiquetasDoLead(qc: ReturnType<typeof useQueryClient>, leadId: string) {
  qc.invalidateQueries({ queryKey: ["lead-tags", leadId] });
  qc.invalidateQueries({ queryKey: ["lead-detail", leadId] });
  qc.invalidateQueries({ queryKey: ["leads"] });
  qc.invalidateQueries({ queryKey: ["lead-timeline", leadId] });
  qc.invalidateQueries({ queryKey: ["pipeline_entries"] });
  qc.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
}

/**
 * Read tags attached to a lead via the lead_tags junction table.
 */
export function useLeadTagsAttached(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ["lead-tags", leadId],
    enabled: !!leadId,
    staleTime: 30_000,
    queryFn: async (): Promise<AttachedLeadTag[]> => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from("lead_tags")
        .select("id, tag_id, tag:tags(id, name, color)")
        .eq("lead_id", leadId);
      if (error) throw error;
      return (data ?? []) as AttachedLeadTag[];
    },
  });
}

export function useAddLeadTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, tagId }: { leadId: string; tagId: string }) => {
      const { data, error } = await supabase
        .from("lead_tags")
        .insert({ lead_id: leadId, tag_id: tagId })
        .select("id, tag_id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => invalidarEtiquetasDoLead(qc, vars.leadId),
  });
}

export function useRemoveLeadTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadTagId, leadId }: { leadTagId: string; leadId: string }) => {
      /**
       * `count: "exact"` não é telemetria — é a única forma de saber se apagou.
       *
       * Um DELETE do supabase-js que não casa NENHUMA linha volta com
       * `error === null`: a RLS não recusa, ela FILTRA, e uma linha invisível é
       * indistinguível de uma linha que já não existe. Sem a contagem, quem
       * chama não tem como diferenciar "removi" de "não removi nada".
       *
       * ⚠️ E a contagem é DEVOLVIDA, não lançada. Zero linhas também é o
       * resultado CORRETO quando a etiqueta já tinha sido removida por outra
       * tela — o painel do Chat apaga por `lead_id`+`tag_id`
       * (`ContextPanelTabInfo`) e não invalida esta chave, então o cache daqui
       * fica velho por até `staleTime`. Se zero virasse `throw`, o `onSuccess`
       * não rodaria, a invalidação abaixo não aconteceria, e a pílula fantasma
       * ficaria PRESA na tela repetindo o mesmo erro a cada clique — o inverso
       * exato do que a contagem veio resolver. Quem decide a frase é a tela.
       */
      const { error, count } = await supabase
        .from("lead_tags")
        .delete({ count: "exact" })
        .eq("id", leadTagId);
      if (error) throw error;
      return { leadId, removidas: count ?? 0 };
    },
    onSuccess: (_data, vars) => invalidarEtiquetasDoLead(qc, vars.leadId),
  });
}
