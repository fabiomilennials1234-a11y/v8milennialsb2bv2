import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { termoDeBusca } from "@/shared/format/termo-de-busca";

export interface ClienteBuscado {
  id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  erp_code: string | null;
}

/**
 * Busca de cliente para agendar: nome, empresa, código do ERP ou telefone — a
 * Café acha cliente pelo código. A RLS de `leads` recorta o que a pessoa pode
 * ver; 20 é teto de UI.
 */
export function useBuscaClientes(termo: string) {
  const { organizationId } = useOrganization();
  const limpo = termoDeBusca(termo);
  const digitos = limpo.replace(/\D/g, "");
  return useQuery({
    queryKey: ["agendamento", "busca-clientes", organizationId, limpo],
    enabled: !!organizationId && limpo.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<ClienteBuscado[]> => {
      const filtros = [`name.ilike.%${limpo}%`, `company.ilike.%${limpo}%`, `erp_code.ilike.%${limpo}%`];
      if (digitos.length >= 4) filtros.push(`phone_digits.ilike.%${digitos}%`);
      const { data, error } = await supabase
        .from("leads")
        .select("id, name, company, phone, erp_code")
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .or(filtros.join(","))
        .order("name", { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ClienteBuscado[];
    },
  });
}
