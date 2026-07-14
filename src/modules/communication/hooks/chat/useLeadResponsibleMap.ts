/**
 * useLeadResponsibleMap — mapa lead_id → responsável ("vendedor") do lead.
 *
 * A conversa do chat não carrega um vínculo próprio de vendedor: ela aponta pra
 * um lead (`ChatContact.lead_id`), e é o LEAD que tem o responsável. Este hook
 * resolve esse mapa para os leads visíveis na lista, para o filtro "por vendedor"
 * decidir a quem cada conversa pertence — sem migração de schema.
 *
 * IMPORTANTE: a atribuição moderna grava os campos CANÔNICOS
 * `pre_sale_responsible_id` (SDR) e `sale_responsible_id` (closer); o legado
 * `responsible_id` fica NULL nesses casos. Ler só `responsible_id` (como era)
 * deixava o filtro "minhas conversas" furado — leads atribuídos pela UI nova não
 * apareciam. Resolvemos por COALESCE(pre_sale, sale, responsible_id): o "dono" da
 * conversa é o pré-venda; cai pro closer e depois pro legado. Cobre o caso comum
 * de 1 vendedor por lead. (Dual-owner SDR≠closer atribui ao pré-venda — follow-up.)
 *
 * Recebe só os lead_ids presentes na lista (bounded), então o `.in()` é pequeno.
 * Filtra por organization_id por segurança multi-tenant.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Linha mínima de lead p/ resolver o responsável do chat. */
export interface LeadResponsibleRow {
  pre_sale_responsible_id?: string | null;
  sale_responsible_id?: string | null;
  responsible_id?: string | null;
}

/**
 * Resolve o "dono" da conversa: pré-venda → venda → legado. Pura e testável.
 * Corrige o furo do filtro "minhas conversas" (atribuição moderna grava só
 * pre_sale/sale; ler só responsible_id deixava o lead sem dono no chat).
 */
export function resolveLeadResponsible(row: LeadResponsibleRow): string | null {
  return (
    row.pre_sale_responsible_id ??
    row.sale_responsible_id ??
    row.responsible_id ??
    null
  );
}

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
        .select("id, pre_sale_responsible_id, sale_responsible_id, responsible_id")
        .eq("organization_id", organizationId)
        .in("id", sortedIds);

      if (error) throw error;

      const map = new Map<string, string | null>();
      for (const row of data ?? []) {
        map.set(row.id as string, resolveLeadResponsible(row as LeadResponsibleRow));
      }
      return map;
    },
    enabled: !!organizationId && sortedIds.length > 0,
    staleTime: 60_000,
  });

  return data ?? new Map<string, string | null>();
}
