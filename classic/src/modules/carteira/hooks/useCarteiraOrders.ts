import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Aba Pedidos da Carteira — leitura.
 *
 * Lê pela RPC `carteira_list_orders` em vez de `supabase.from("upsell_orders")`
 * por um motivo concreto: a procedência do pedido depende de QUATRO caminhos
 * (notas_fiscais, tiny_order_id, tinyerp_order_mappings, external_source) e
 * resolvê-los no cliente custaria 2 round-trips extras por pedido — 100 numa
 * página de 50. A RPC já devolve `is_erp_linked` e `erp_source` resolvidos,
 * mais os itens agregados e o `total_count` da janela.
 *
 * Lista apenas pedidos APROVADOS — é o que o resto do módulo considera venda
 * real (todos os consumidores filtram `approval_status = 'approved'`).
 */

export interface CarteiraOrderItem {
  id: string | null;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit: string | null;
}

export interface CarteiraOrderRow {
  id: string;
  client_id: string;
  client_name: string;
  client_company: string | null;
  product_name: string;
  product_type: string;
  sale_value: number;
  sold_at: string;
  source: string | null;
  origin: string;
  notes: string | null;
  approval_status: string;
  closer_id: string | null;
  closer_name: string | null;
  sale_responsible_id: string | null;
  sale_responsible_name: string | null;
  approved_at: string | null;
  created_at: string;
  /** Pedido veio do ERP ⇒ read-only no CRM. */
  is_erp_linked: boolean;
  /** 'nfe' | 'tiny' | 'omie' | null (manual). */
  erp_source: string | null;
  items: CarteiraOrderItem[];
  total_count: number;
}

export interface UseCarteiraOrdersParams {
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Chave de cache da aba. Exportada porque a mutation invalida exatamente esta
 * raiz — deixar a string solta em dois arquivos é como queryKey desalinhada
 * nasce.
 */
export const CARTEIRA_ORDERS_KEY = "carteira_orders" as const;

/**
 * Query keys que uma mutação de pedido precisa invalidar.
 *
 * Editar mexe em `upsell_clients` (avg_ticket/lifetime_value/order_count são
 * recomputados de forma síncrona pelo trigger `trg_upsell_order_recalc_metrics`
 * quando muda sale_value, sold_at ou client_id) e portanto muda KPI e lista de
 * clientes. Invalidar só `carteira_orders` deixaria a carteira mostrando número
 * velho.
 */
export const CARTEIRA_ORDER_INVALIDATION_KEYS = [
  [CARTEIRA_ORDERS_KEY],
  ["upsell_orders"],
  ["portfolio-clients"],
  ["portfolio-kpis"],
  ["pending-orders"],
] as const;

export function useCarteiraOrders({
  search = "",
  limit = 50,
  offset = 0,
}: UseCarteiraOrdersParams = {}) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: [CARTEIRA_ORDERS_KEY, organizationId, search, limit, offset],
    queryFn: async (): Promise<CarteiraOrderRow[]> => {
      const { data, error } = await (supabase.rpc as any)("carteira_list_orders", {
        p_limit: limit,
        p_offset: offset,
        p_search: search.trim() || null,
        p_org_id: organizationId,
      });

      if (error) throw error;
      return (data ?? []) as CarteiraOrderRow[];
    },
    enabled: isReady && !!organizationId,
    // Dinheiro na tela: sem cache velho depois de uma edição.
    staleTime: 0,
  });
}
