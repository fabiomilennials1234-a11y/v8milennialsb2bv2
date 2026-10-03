/**
 * Mudança manual da gaveta do lead — Lead · Cliente · Indefinido.
 *
 * 🔴 **Grava `classificacao_manual = true` junto, e é isso que faz o botão
 * existir de verdade.** A lei do ERP roda em toda sincronização (06:00, todo
 * dia). Sem essa marca, a escolha feita aqui seria desfeita na madrugada
 * seguinte: o usuário move, some no outro dia, e ninguém entende por quê.
 *
 * O mesmo princípio já vale para o responsável em `propagate_erp_owner_to_leads`
 * — o ERP não é dono da verdade sobre trabalho feito dentro do CRM.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  LEAD_CLASSIFICACAO_CONFIG,
  type LeadClassificacao,
} from "../lib/lead-classificacao";

export function useLeadClassificacao() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      leadId,
      classificacao,
    }: {
      leadId: string;
      classificacao: LeadClassificacao;
    }) => {
      /**
       * O cast existe porque `types.ts` está ATRASADO em relação a prod — não
       * porque o campo não exista.
       *
       * `types.ts` é gerado do banco, e `classificacao`/`classificacao_manual`
       * já estão aplicadas em produção (`20270922000000`). Regenerar resolveria
       * o tipo — e foi tentado —, mas expõe **15 erros** em `useExcluirNegocio`,
       * `useCrossPipeMove`, `useLeadAllPipelines`, `useCustomPipelines` e
       * `stageTransition`: código de outras frentes escrito contra o schema
       * antigo, que só compila porque o `types.ts` commitado também é antigo.
       *
       * Arrastar 15 erros alheios para dentro deste PR seria pior que o cast.
       * Quando alguém regenerar os tipos, isto some sozinho.
       */
      const patch: Record<string, unknown> = {
        classificacao,
        classificacao_manual: true,
      };

      const { error } = await supabase
        .from("leads")
        .update(patch)
        .eq("id", leadId);

      if (error) throw error;
      return { leadId, classificacao };
    },
    onSuccess: ({ classificacao }) => {
      // A lista é paginada e a contagem por gaveta muda junto — invalidar a
      // raiz `leads` é o que mantém seletor e lista contando a mesma coisa.
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({
        title: `Movido para ${LEAD_CLASSIFICACAO_CONFIG[classificacao].label}`,
        description:
          "A sincronização do ERP não vai mais alterar a classificação deste lead.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Não foi possível mudar a classificação",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    },
  });
}
