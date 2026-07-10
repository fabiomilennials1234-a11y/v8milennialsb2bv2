/**
 * useLeadResponsibleMap — mapa lead_id → responsible_id (o "vendedor" do lead).
 *
 * A conversa do chat não carrega um vínculo próprio de vendedor: ela aponta pra
 * um lead (`ChatContact.lead_id`), e é o LEAD que tem o responsável
 * (`leads.responsible_id`, FK → team_members.id). Este hook resolve esse mapa
 * para os leads atualmente visíveis na lista, para que o filtro "por vendedor"
 * possa decidir a quem cada conversa pertence — sem migração de schema.
 *
 * Recebe só os lead_ids presentes na lista (bounded pelo limite da conversa),
 * então o `.in()` é pequeno. Filtra por organization_id por segurança multi-tenant.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * @param leadIds  IDs dos leads visíveis (derivados dos contatos da lista).
 * @param organizationId  org atual (multi-tenancy).
 * @returns Map<leadId, responsibleId | null>. Vazio enquanto carrega/sem leads.
 */
export function useLeadResponsibleMap(
  leadIds: string[],
  organizationId: string | null,
) {
  // Chave estável: ordena os ids pra não refetchar quando só muda a ordem.
  const sortedIds = [...leadIds].sort();

  const { data } = useQuery({
    queryKey: ["lead-responsible-map", organizationId, sortedIds],
    queryFn: async (): Promise<Map<string, string | null>> => {
      if (!organizationId || sortedIds.length === 0) {
        return new Map();
      }
      const { data, error } = await supabase
        .from("leads")
        .select("id, responsible_id")
        .eq("organization_id", organizationId)
        .in("id", sortedIds);

      if (error) throw error;

      const map = new Map<string, string | null>();
      for (const row of data ?? []) {
        map.set(row.id as string, (row.responsible_id as string | null) ?? null);
      }
      return map;
    },
    enabled: !!organizationId && sortedIds.length > 0,
    staleTime: 60_000,
  });

  return data ?? new Map<string, string | null>();
}
