import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Esta organização classifica lead por CADASTRO NO ERP, ou pela RELAÇÃO?
 *
 * Decisão do CTO em 2026-09-04: a lei do ERP é **mandatória para quem tem a
 * integração feita**, e só para esses. Quem não tem integração segue a lei da
 * Relação — a mesma que a coluna "Relação" da lista já imprime
 * (`lead-relacao-situacao.ts`): comprou pelo funil OU tem pedido no ERP.
 *
 * O sinal é a flag que a própria lei do ERP já usa
 * (`toth_connections.classificar_leads_por_situacao`), e não um sinal novo:
 * ela é ligada exatamente quando a org tem a integração configurada e as
 * situações de cliente mapeadas. Medido em prod no mesmo dia — a Café Jurerê é
 * a **única** org com qualquer sinal de ERP (flag ligada, Toth conectado,
 * 12.675 de 12.683 leads com `erp_code`, 11.238 clientes com `erp_status`);
 * todas as demais têm zero.
 *
 * ⚠️ FALHA PARA A LEI DA RELAÇÃO. Enquanto a resposta não chega — e se a
 * consulta falhar — o hook devolve `false`. É a queda segura: a lei da Relação
 * deriva de dado que toda org tem (venda e pedido), enquanto a do ERP depende
 * de `erp_code`, que numa org sem integração é NULL em 100% das linhas e
 * jogaria a lista inteira na gaveta "lead" sem que ninguém entendesse por quê.
 */
export function useOrgUsaLeiDoErp(): { usaLeiDoErp: boolean; isLoading: boolean } {
  const { organizationId, isReady } = useOrganization();

  const { data, isLoading } = useQuery({
    queryKey: ["org-usa-lei-do-erp", organizationId],
    queryFn: async () => {
      if (!organizationId) return false;
      const { data, error } = await supabase
        .from("toth_connections")
        .select("classificar_leads_por_situacao, clientes_situacoes")
        .eq("organization_id", organizationId)
        .maybeSingle();

      // Org sem linha em `toth_connections` não tem integração — não é erro.
      if (error || !data) return false;

      const linha = data as {
        classificar_leads_por_situacao?: boolean | null;
        clientes_situacoes?: string | null;
      };

      // As DUAS condições, como na função do banco
      // (`apply_erp_lead_classification`): a flag sozinha, com
      // `clientes_situacoes` vazio, deixa a função no-op — e a coluna
      // `classificacao` fica em 'lead' para todo mundo. Rotear para a lei do
      // ERP nesse estado esconderia todos os clientes da org.
      return (
        linha.classificar_leads_por_situacao === true &&
        !!linha.clientes_situacoes?.trim()
      );
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  return { usaLeiDoErp: data === true, isLoading };
}
