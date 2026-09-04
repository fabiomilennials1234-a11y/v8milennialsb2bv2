import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

import { calcularCicloDeRecompra, type CicloDeRecompra } from "../lib/reorder-cycle";

/**
 * Tempo médio de recompra dos leads visíveis, em lote.
 *
 * Lê as DATAS das duas fontes de compra e recalcula — não reaproveita
 * `useLeadsSalesMetrics.cycleDays` nem `upsell_clients.reorder_cycle_days`,
 * embora ambos existam. Os dois são médias JÁ AGREGADAS, cada uma sobre metade
 * do histórico; unir médias não devolve a média da união. Para o cliente que
 * fechou pelo funil em janeiro e lançou pedidos em março e maio, só as datas
 * juntas dizem que o ciclo é de dois meses.
 *
 * Estorno: uma linha de `sale_events` com `reversed_event_id` preenchido
 * cancela a venda que ela aponta — mesma semântica de `useLeadsSalesMetrics`.
 * Pedido `rejected` não é compra (medido em prod: 786 approved, 2 rejected).
 *
 * Multi-tenancy: as duas queries filtram `organization_id` além da RLS.
 */
export type LeadReorderCycleMap = Record<string, CicloDeRecompra>;

interface SaleRow {
  id: string;
  lead_id: string | null;
  event_type: string | null;
  sold_at: string | null;
  reversed_event_id: string | null;
}

/**
 * Pedido já resolvido ao lead dono.
 *
 * `upsell_orders` aponta para `upsell_clients`, não para `leads` — a tradução
 * acontece em duas consultas simples em vez de um embed `!inner` com filtro em
 * coluna aninhada. O embed cabia numa chamada só, mas depende do PostgREST
 * enxergar a relação e devolve forma diferente (objeto ou array) conforme a
 * cardinalidade inferida; duas queries indexadas por id não têm essa aresta.
 */
interface OrderRow {
  sold_at: string | null;
  leadId: string | null;
}

/**
 * Junta as linhas cruas das duas fontes em datas por lead e calcula o ciclo.
 * Pura para poder ser testada pela borda (faltam 7 dias, venceu, mesma venda
 * nas duas fontes) sem forjar `sold_at`, que os triggers impedem.
 */
export function computeReorderCycles(
  vendas: SaleRow[],
  pedidos: OrderRow[],
  leadIds: readonly string[],
  agora: number = Date.now(),
): LeadReorderCycleMap {
  const cancelados = new Set<string>();
  for (const v of vendas) {
    if (v.reversed_event_id) cancelados.add(v.reversed_event_id);
  }

  const datasPorLead = new Map<string, string[]>();
  const guarda = (leadId: string | null, quando: string | null) => {
    if (!leadId || !quando) return;
    const lista = datasPorLead.get(leadId) ?? [];
    lista.push(quando);
    datasPorLead.set(leadId, lista);
  };

  for (const v of vendas) {
    if (v.reversed_event_id) continue; // a linha é o estorno, não a venda
    if (cancelados.has(v.id)) continue; // venda estornada
    if (v.event_type && v.event_type !== "sale") continue; // sale_lost não é compra
    guarda(v.lead_id, v.sold_at);
  }

  for (const p of pedidos) {
    guarda(p.leadId, p.sold_at);
  }

  const map: LeadReorderCycleMap = {};
  for (const leadId of leadIds) {
    map[leadId] = calcularCicloDeRecompra(datasPorLead.get(leadId) ?? [], agora);
  }
  return map;
}

export function useLeadsReorderCycle(leadIds: string[]) {
  const { organizationId, isReady } = useOrganization();

  // Ordena para a queryKey ser estável independente da ordem de renderização —
  // mesmo contrato de `useLeadsCarteiraMetrics` e `useLeadsSalesMetrics`.
  const ids = [...leadIds].sort();

  return useQuery<LeadReorderCycleMap>({
    queryKey: ["leads-reorder-cycle", organizationId, ids],
    queryFn: async () => {
      if (!organizationId || ids.length === 0) return {};

      const [vendas, clientes] = await Promise.all([
        supabase
          .from("sale_events")
          .select("id, lead_id, event_type, sold_at, reversed_event_id")
          .eq("organization_id", organizationId)
          .in("lead_id", ids),
        supabase
          .from("upsell_clients")
          .select("id, lead_id")
          .eq("organization_id", organizationId)
          .in("lead_id", ids),
      ]);

      if (vendas.error) throw vendas.error;
      if (clientes.error) throw clientes.error;

      // Lead → cliente de carteira. Sem nenhum, a segunda consulta não sai:
      // a maioria das orgs não tem carteira, e um `IN ()` vazio é ida e volta
      // à rede para receber zero linha.
      const leadPorCliente = new Map<string, string>();
      for (const c of clientes.data ?? []) {
        if (c.id && c.lead_id) leadPorCliente.set(c.id, c.lead_id);
      }

      let pedidos: OrderRow[] = [];
      if (leadPorCliente.size > 0) {
        const { data, error } = await supabase
          .from("upsell_orders")
          .select("client_id, sold_at")
          .eq("organization_id", organizationId)
          .eq("approval_status", "approved")
          .in("client_id", [...leadPorCliente.keys()]);

        if (error) throw error;
        pedidos = (data ?? []).map((p) => ({
          sold_at: p.sold_at,
          leadId: p.client_id ? (leadPorCliente.get(p.client_id) ?? null) : null,
        }));
      }

      return computeReorderCycles((vendas.data ?? []) as SaleRow[], pedidos, ids);
    },
    enabled: isReady && ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
