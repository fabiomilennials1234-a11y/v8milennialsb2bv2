import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import {
  SELECT_BUSCA_CLIENTE,
  filtrosDaBuscaCliente,
  paraClienteAgenda,
  type ClienteParaAgenda,
  type LinhaBuscaCliente,
} from "@/shared/format/cliente-agenda";
import { termoDeBusca } from "@/shared/format/termo-de-busca";

export type ClienteBuscado = ClienteParaAgenda;

/**
 * Busca de cliente para agendar: nome, empresa ou código do ERP — a Café acha
 * cliente pelo código. Telefone não busca (pedido da Café). A RLS de `leads`
 * recorta o que a pessoa pode ver; 20 é teto de UI. Mesma regra e mesmo
 * formato do "Nova agenda" do Comando (`useBuscaClientesAgenda`).
 */
export function useBuscaClientes(termo: string) {
  const { organizationId } = useOrganization();
  const limpo = termoDeBusca(termo);
  return useQuery({
    queryKey: ["agendamento", "busca-clientes", organizationId, limpo],
    enabled: !!organizationId && limpo.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<ClienteBuscado[]> => {
      const { data, error } = await supabase
        .from("leads")
        .select(SELECT_BUSCA_CLIENTE)
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .is("lead_phones.deleted_at", null)
        .or(filtrosDaBuscaCliente(limpo).join(","))
        .order("name", { ascending: true })
        .limit(20);
      if (error) throw error;
      return ((data ?? []) as unknown as LinhaBuscaCliente[]).map(paraClienteAgenda);
    },
  });
}

/**
 * O mesmo cliente da busca, por id — para quem abre o diálogo já sabendo o
 * lead (card do funil, ficha): sem isto o modal não saberia os contatos dele.
 */
export function useClienteParaAgenda(leadId: string | null) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["agendamento", "cliente", organizationId, leadId],
    enabled: !!organizationId && !!leadId,
    staleTime: 30_000,
    queryFn: async (): Promise<ClienteBuscado | null> => {
      const { data, error } = await supabase
        .from("leads")
        .select(SELECT_BUSCA_CLIENTE)
        .eq("organization_id", organizationId as string)
        .eq("id", leadId as string)
        .is("deleted_at", null)
        .is("lead_phones.deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data ? paraClienteAgenda(data as unknown as LinhaBuscaCliente) : null;
    },
  });
}
